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

// Parse TenneT settlement-prices JSON into flat array of 15-min interval objects
function parseSettlementPoints(data) {
  const points = []
  for (const ts of data?.Response?.TimeSeries ?? []) {
    for (const pt of ts?.Period?.Points ?? []) {
      if (!pt.timeInterval_start) continue
      points.push({
        date:         pt.timeInterval_start.slice(0, 10),  // YYYY-MM-DD
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

// Imbalance mid price — (dispatch_up + dispatch_down) / 2, aggregated to daily
export async function fetchImbalancePrices(startDate, endDate) {
  const points = await fetchSettlementPrices(startDate, endDate)

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

  return { daily }
}

// aFRR energy prices from settlement-prices dispatch_up/down.
// afrrCapacityPrice (merit-order-list) and fcrPrice have no dedicated endpoint yet.
export async function fetchAFRRData(startDate, endDate) {
  const points = await fetchSettlementPrices(startDate, endDate)

  const byDay = {}
  for (const { date, dispatchUp, dispatchDown } of points) {
    if (!byDay[date]) byDay[date] = { up: [], down: [] }
    byDay[date].up.push(dispatchUp)
    byDay[date].down.push(dispatchDown)
  }

  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  const daily = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { up, down }]) => ({
      date,
      afrrCapacityPrice:   null,   // merit-order-list endpoint — not yet implemented
      afrrUpEnergyPrice:   avg(up),
      afrrDownEnergyPrice: avg(down),
      fcrPrice:            null,   // no dedicated TenneT endpoint available
    }))

  return { daily }
}
