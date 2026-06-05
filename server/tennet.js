const TENNET_BASE = 'https://api.tennet.eu/publications/v1'
const TENNET_TIMEOUT_MS  = 30_000
const TENNET_MAX_RETRIES = 3
const TENNET_RETRY_BASE_MS = 1_000
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

// Convert YYYY-MM-DD → DD-MM-YYYY 00:00:00 (TenneT API date format)
function tennetFmt(isoDate) {
  const [y, m, d] = isoDate.split('-')
  return `${d}-${m}-${y} 00:00:00`
}

// Add n calendar days to a YYYY-MM-DD string, return YYYY-MM-DD
function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Split [startDate, endDate] (both inclusive, YYYY-MM-DD) into at-most-1-month
// chunks. The API accepts a max range of 1 calendar month per request.
function monthChunks(startDate, endDate) {
  const chunks = []
  let cur = startDate
  while (cur <= endDate) {
    const d = new Date(cur + 'T00:00:00Z')
    const lastOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10)
    const to = lastOfMonth < endDate ? lastOfMonth : endDate
    chunks.push({ from: cur, to })
    cur = addDays(to, 1)
  }
  return chunks
}

async function tennetRequest(endpoint, dateFrom, dateTo, attempt = 1) {
  const key = process.env.TENNET_API_KEY
  if (!key) throw new Error('TENNET_API_KEY not configured')

  // API uses exclusive end — add 1 day so dateTo (inclusive) is covered
  const exclusiveTo = addDays(dateTo, 1)

  const url = new URL(`${TENNET_BASE}/${endpoint}`)
  url.searchParams.set('date_from', tennetFmt(dateFrom))
  url.searchParams.set('date_to',   tennetFmt(exclusiveTo))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TENNET_TIMEOUT_MS)

  let res
  try {
    res = await fetch(url.toString(), {
      headers: { apikey: key, Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    const isTimeout = err.name === 'AbortError'
    const msg = isTimeout
      ? `TenneT request timed out after ${TENNET_TIMEOUT_MS / 1000}s`
      : `TenneT network error: ${err.message}`
    if (attempt < TENNET_MAX_RETRIES) {
      const delay = TENNET_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(`  ↺ ${msg} — retrying in ${delay}ms (attempt ${attempt}/${TENNET_MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, delay))
      return tennetRequest(endpoint, dateFrom, dateTo, attempt + 1)
    }
    throw new Error(`${msg} (all ${TENNET_MAX_RETRIES} attempts exhausted)`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`TenneT ${res.status}: ${body.slice(0, 200)}`)
    if (RETRYABLE_STATUSES.has(res.status) && attempt < TENNET_MAX_RETRIES) {
      const delay = TENNET_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(`  ↺ ${err.message} — retrying in ${delay}ms (attempt ${attempt}/${TENNET_MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, delay))
      return tennetRequest(endpoint, dateFrom, dateTo, attempt + 1)
    }
    throw err
  }

  return res.json()
}

// Parse TenneT settlement-prices JSON into flat array of 15-min interval objects.
// timeInterval_start is a CET local datetime string (e.g. "2026-01-01T00:00:00").
function parseSettlementPoints(data) {
  const points = []
  for (const ts of data?.Response?.TimeSeries ?? []) {
    for (const pt of ts?.Period?.Points ?? []) {
      if (!pt.timeInterval_start) continue
      points.push({
        timestamp:    pt.timeInterval_start,               // full CET datetime
        date:         pt.timeInterval_start.slice(0, 10),  // YYYY-MM-DD (for imbalance daily)
        dispatchUp:   parseFloat(pt.dispatch_up   ?? 0),
        dispatchDown: parseFloat(pt.dispatch_down ?? 0),
      })
    }
  }
  return points
}

// Fetch and concat settlement-prices across monthly chunks
async function fetchSettlementPrices(startDate, endDate) {
  const chunks = monthChunks(startDate, endDate)
  const all = []
  for (const { from, to } of chunks) {
    const data = await tennetRequest('settlement-prices', from, to)
    all.push(...parseSettlementPoints(data))
  }
  if (!all.length) throw new Error('No settlement price data returned from TenneT')
  return all
}

// ── Public fetchers ─────────────────────────────────────────────────────────

// Imbalance mid price — returns both:
//   rawPoints: 15-min CET timestamps with per-ISP midPrice (for frontend 1h aggregation)
//   daily:     daily average mid price (for 1d view)
export async function fetchImbalancePrices(startDate, endDate) {
  const points = await fetchSettlementPrices(startDate, endDate)

  // Raw 15-min midPrice points for frontend hourly aggregation
  const rawPoints = points.map(({ timestamp, dispatchUp, dispatchDown }) => ({
    timestamp,
    midPrice: (dispatchUp + dispatchDown) / 2,
  }))

  const byDay = {}
  for (const { date, dispatchUp, dispatchDown } of points) {
    if (!byDay[date]) byDay[date] = { up: [], down: [] }
    byDay[date].up.push(dispatchUp)
    byDay[date].down.push(dispatchDown)
  }

  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  const daily = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { up, down }]) => {
      const avgUp   = avg(up)
      const avgDown = avg(down)
      return {
        date,
        midPrice: avgUp != null && avgDown != null ? (avgUp + avgDown) / 2 : null,
      }
    })

  return { daily, rawPoints }
}

// aFRR energy prices from TenneT settlement-prices (dispatch_up / dispatch_down).
// Returns raw 15-min points so the frontend can aggregate to 15m / 1h / 1d.
// Capacity prices come from ENTSO-E A81 and are returned separately by the route.
export async function fetchAFRRData(startDate, endDate) {
  const points = await fetchSettlementPrices(startDate, endDate)
  const rawPoints = points.map(({ timestamp, dispatchUp, dispatchDown }) => ({
    timestamp,
    afrrUpEnergyPrice:   dispatchUp,
    afrrDownEnergyPrice: dispatchDown,
  }))
  return { rawPoints }
}

// ── Balance Delta ─────────────────────────────────────────────────────────────
//
// Endpoint: GET /publications/v1/balance-delta-high-res
// Rate limits: max 8 requests/day (historical), max range 4 hours per request
// Timestamps: UTC, format DD-MM-YYYY HH:MM:SS
// balanceDelta = Σ power_X_in  −  Σ power_X_out  (MW)

// Format a JS Date as "DD-MM-YYYY HH:MM:SS" (UTC) for balance-delta params
function tennetFmtUTCDatetime(d) {
  const iso = d.toISOString() // "YYYY-MM-DDTHH:MM:SS.mmmZ"
  const [y, m, day] = iso.slice(0, 10).split('-')
  const time = iso.slice(11, 19)
  return `${day}-${m}-${y} ${time}`
}

// Split [startDate, endDate] (inclusive, YYYY-MM-DD) into 4-hour UTC chunks.
// Each element: { from: "DD-MM-YYYY HH:MM:SS", to: "DD-MM-YYYY HH:MM:SS" }
function fourHourChunks(startDate, endDate) {
  const chunks = []
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
  let cur = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')
  end.setUTCDate(end.getUTCDate() + 1) // day after endDate = exclusive boundary
  while (cur < end) {
    const next = new Date(Math.min(cur.getTime() + FOUR_HOURS_MS, end.getTime()))
    chunks.push({ from: tennetFmtUTCDatetime(cur), to: tennetFmtUTCDatetime(next) })
    cur = next
  }
  return chunks
}

// Generic request helper for endpoints that take pre-formatted UTC datetime strings.
// Does NOT add +1 day. dateFrom/dateTo are "DD-MM-YYYY HH:MM:SS".
async function tennetRequestRaw(endpoint, dateFrom, dateTo, attempt = 1) {
  const key = process.env.TENNET_API_KEY
  if (!key) throw new Error('TENNET_API_KEY not configured')

  const url = new URL(`${TENNET_BASE}/${endpoint}`)
  url.searchParams.set('date_from', dateFrom)
  url.searchParams.set('date_to',   dateTo)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TENNET_TIMEOUT_MS)

  let res
  try {
    res = await fetch(url.toString(), {
      headers: { apikey: key, Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    const isTimeout = err.name === 'AbortError'
    const msg = isTimeout
      ? `TenneT ${endpoint} timed out after ${TENNET_TIMEOUT_MS / 1000}s`
      : `TenneT ${endpoint} network error: ${err.message}`
    if (attempt < TENNET_MAX_RETRIES) {
      const delay = TENNET_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(`  ↺ ${msg} — retrying in ${delay}ms (attempt ${attempt}/${TENNET_MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, delay))
      return tennetRequestRaw(endpoint, dateFrom, dateTo, attempt + 1)
    }
    throw new Error(`${msg} (all ${TENNET_MAX_RETRIES} attempts exhausted)`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`TenneT ${endpoint} ${res.status}: ${body.slice(0, 200)}`)
    if (RETRYABLE_STATUSES.has(res.status) && attempt < TENNET_MAX_RETRIES) {
      const delay = TENNET_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(`  ↺ ${err.message} — retrying in ${delay}ms (attempt ${attempt}/${TENNET_MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, delay))
      return tennetRequestRaw(endpoint, dateFrom, dateTo, attempt + 1)
    }
    throw err
  }

  return res.json()
}

function parseBalanceDeltaPoints(data) {
  const points = []
  for (const ts of data?.Response?.TimeSeries ?? []) {
    // Period is an array in the balance-delta-high-res response
    for (const period of ts?.Period ?? []) {
      for (const pt of period?.points ?? []) {
        if (!pt.timeInterval_start) continue
        const inPower = (parseFloat(pt.power_afrr_in    ?? 0)
                       + parseFloat(pt.power_igcc_in    ?? 0)
                       + parseFloat(pt.power_picasso_in ?? 0)
                       + parseFloat(pt.power_mari_in    ?? 0)
                       + parseFloat(pt.power_mfrrda_in  ?? 0))
        const outPower = (parseFloat(pt.power_afrr_out    ?? 0)
                        + parseFloat(pt.power_igcc_out    ?? 0)
                        + parseFloat(pt.power_picasso_out ?? 0)
                        + parseFloat(pt.power_mari_out    ?? 0)
                        + parseFloat(pt.power_mfrrda_out  ?? 0))
        points.push({
          timestamp:    pt.timeInterval_start,
          balanceDelta: +(inPower - outPower).toFixed(1),
        })
      }
    }
  }
  return points
}

// Max 8 requests/day to the historical endpoint. For ranges > 32 hours we trim
// to the most recent 8 chunks (≈32 h) to stay within the daily rate limit.
const MAX_BALANCE_DELTA_CHUNKS = 8

export async function fetchBalanceDelta(startDate, endDate) {
  let chunks = fourHourChunks(startDate, endDate)
  if (chunks.length > MAX_BALANCE_DELTA_CHUNKS) {
    console.warn(
      `[TenneT] balance-delta: ${chunks.length} chunks needed for ${startDate}–${endDate} `
      + `but daily limit is ${MAX_BALANCE_DELTA_CHUNKS}. Trimming to most recent ${MAX_BALANCE_DELTA_CHUNKS} chunks (~32 h).`
    )
    chunks = chunks.slice(-MAX_BALANCE_DELTA_CHUNKS)
  }
  const all = []
  for (const { from, to } of chunks) {
    const data = await tennetRequestRaw('balance-delta-high-res', from, to)
    all.push(...parseBalanceDeltaPoints(data))
  }
  if (!all.length) throw new Error('No balance delta data returned from TenneT')
  return all
}

// ── FRR Activations ───────────────────────────────────────────────────────────
//
// Endpoint: GET /publications/v1/frequency-restoration-reserve-activations
// Rate limits: 1500/day — generous
// Max range: 1 day per request → use day-by-day chunks
// Response: ts.Period.Points[] (Period = object, Points = capital-P array)
// Point fields: aFRR_up, aFRR_down, mfrrda_volume_up, mfrrda_volume_down,
//               absolute_total_volume, timeInterval_start

// Split [startDate, endDate] into individual calendar days.
// tennetRequest adds +1 day so from="YYYY-MM-DD" to="YYYY-MM-DD" → 24h window. ✓
function dayChunks(startDate, endDate) {
  const chunks = []
  let cur = startDate
  while (cur <= endDate) {
    chunks.push({ from: cur, to: cur })
    cur = addDays(cur, 1)
  }
  return chunks
}

function parseFRRActivationPoints(data) {
  const points = []
  for (const ts of data?.Response?.TimeSeries ?? []) {
    // Period is an object with a capital-P Points array
    for (const pt of ts?.Period?.Points ?? []) {
      if (!pt.timeInterval_start) continue
      // aFRR + mFRR-DA volumes cover the main balancing energy activations
      const upMw   = parseFloat(pt.aFRR_up          ?? 0)
                   + parseFloat(pt.mfrrda_volume_up  ?? 0)
      const downMw = parseFloat(pt.aFRR_down         ?? 0)
                   + parseFloat(pt.mfrrda_volume_down ?? 0)
      points.push({
        timestamp:       pt.timeInterval_start,
        activatedUpMw:   +upMw.toFixed(1),
        activatedDownMw: +downMw.toFixed(1),
      })
    }
  }
  return points
}

export async function fetchFRRActivations(startDate, endDate) {
  // Max 1 day per request — iterate day by day
  const chunks = dayChunks(startDate, endDate)
  const all = []
  for (const { from, to } of chunks) {
    const data = await tennetRequest('frequency-restoration-reserve-activations', from, to)
    all.push(...parseFRRActivationPoints(data))
  }
  if (!all.length) throw new Error('No FRR activation data returned from TenneT')
  return all
}

// ── Merit Order ───────────────────────────────────────────────────────────────
//
// Endpoint: GET /publications/v1/merit-order-list
// Rate limits: 600/day — need to be careful (24 req/day per daily fetch)
// Max range: 1 hour per request → 24 hourly requests per day
// Response: ts.Period.Points[] (Period = object, Points = capital-P array)
// Point fields: isp (1–96 PTU number), timeInterval_start, timeInterval_end,
//               Thresholds[] — each: { price_up, price_down, capacity_threshold }
//
// Supply curve: sort Thresholds by price_up ascending, accumulate capacity_threshold
// to build { cumVolume (MAW), price (EUR/MWh) } pairs.

function parseMeritOrderData(data, date) {
  const ptuBids = {} // isp → [{ priceUp, priceDown, capacity }]
  for (const ts of data?.Response?.TimeSeries ?? []) {
    for (const pt of ts?.Period?.Points ?? []) {
      const isp = pt.isp
      if (!isp) continue
      const thresholds = pt.Thresholds ?? []
      for (const t of thresholds) {
        const priceUp   = parseFloat(t.price_up          ?? 0)
        const priceDown = parseFloat(t.price_down         ?? 0)
        const capacity  = parseFloat(t.capacity_threshold ?? 0)
        if (!ptuBids[isp]) ptuBids[isp] = []
        ptuBids[isp].push({ priceUp, priceDown, capacity })
      }
    }
  }

  // Build supply curves per PTU sorted by up-regulation price (ascending)
  const ptus = Object.entries(ptuBids)
    .sort(([a], [b]) => +a - +b)
    .map(([ptu, bids]) => {
      const sorted = [...bids].sort((a, b) => a.priceUp - b.priceUp)
      let cumVol = 0
      return {
        ptu: +ptu,
        curve: sorted.map(b => {
          cumVol += b.capacity
          return { cumVolume: +cumVol.toFixed(1), price: +b.priceUp.toFixed(2) }
        }),
      }
    })

  return { date, ptus }
}

// Generate 24 hourly UTC datetime pairs for a single date (YYYY-MM-DD).
// Each: { from: "DD-MM-YYYY HH:00:00", to: "DD-MM-YYYY (HH+1):00:00" }
function meritOrderHourlyChunks(date) {
  const [y, m, d] = date.split('-')
  const chunks = []
  for (let h = 0; h < 24; h++) {
    const hStr = String(h).padStart(2, '0')
    let toStr
    if (h === 23) {
      // next day 00:00:00
      const nd = new Date(date + 'T00:00:00Z')
      nd.setUTCDate(nd.getUTCDate() + 1)
      const [ny, nm, ndd] = nd.toISOString().slice(0, 10).split('-')
      toStr = `${ndd}-${nm}-${ny} 00:00:00`
    } else {
      toStr = `${d}-${m}-${y} ${String(h + 1).padStart(2, '0')}:00:00`
    }
    chunks.push({ from: `${d}-${m}-${y} ${hStr}:00:00`, to: toStr })
  }
  return chunks
}

// Fetch merit order for a single day (server route caches per day in Redis).
// Makes 24 hourly requests (max range = 1 hour per call).
export async function fetchMeritOrderForDate(date) {
  const chunks = meritOrderHourlyChunks(date)
  const allData = { Response: { TimeSeries: [] } }
  for (const { from, to } of chunks) {
    const data = await tennetRequestRaw('merit-order-list', from, to)
    // Merge TimeSeries arrays from each hourly response
    const ts = data?.Response?.TimeSeries ?? []
    allData.Response.TimeSeries.push(...ts)
  }
  return parseMeritOrderData(allData, date)
}
