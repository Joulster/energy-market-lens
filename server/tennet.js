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
