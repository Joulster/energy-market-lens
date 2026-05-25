// ── Client-side caches ─────────────────────────────────────────────────────
// Market data: keyed on full URL, 15-min TTL.
// Narrative:   keyed on startDate|endDate|systemPrompt, session-scoped (no TTL).
//              Historical ranges never change; the Regenerate button busts the
//              cache explicitly when the user wants a fresh result.
const CACHE_TTL_MS  = 15 * 60 * 1000
const cache         = new Map()   // market data
const narrativeCache = new Map()  // AI summaries

async function apiFetch(path) {
  const cached = cache.get(path)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value
  }
  try {
    const res = await fetch(path)
    if (!res.ok) return { ok: false, data: null, error: `HTTP ${res.status}` }
    const value = await res.json()
    if (value.ok) cache.set(path, { value, ts: Date.now() })
    return value
  } catch (err) {
    return { ok: false, data: null, error: err.message }
  }
}

export async function loadAllMarketData(startDate, endDate) {
  const qs = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : ''
  const [dayAhead, generation, imbalance, afrr] = await Promise.all([
    apiFetch(`/api/day-ahead-prices${qs}`),
    apiFetch(`/api/actual-generation${qs}`),
    apiFetch(`/api/imbalance-prices${qs}`),
    apiFetch(`/api/afrr${qs}`),
  ])

  return {
    dayAhead: dayAhead.data,
    generation: generation.data,
    imbalance: imbalance.data,
    afrr: afrr.data,
    errors: {
      dayAhead: dayAhead.ok ? null : dayAhead.error,
      generation: generation.ok ? null : generation.error,
      imbalance: imbalance.ok ? null : imbalance.error,
      afrr: afrr.ok ? null : afrr.error,
    },
  }
}

export async function fetchNarrative(marketData, systemPrompt, startDate, endDate, forceRefresh = false) {
  const cacheKey = `${startDate}|${endDate}|${systemPrompt}`

  if (!forceRefresh) {
    const cached = narrativeCache.get(cacheKey)
    if (cached) return { ok: true, narrative: cached, fromCache: true }
  }

  try {
    const res = await fetch('/api/narrative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketData, systemPrompt, startDate, endDate, forceRefresh }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (!json.ok) throw new Error(json.error || 'Narrative failed')
    narrativeCache.set(cacheKey, json.narrative)
    return { ok: true, narrative: json.narrative, fromCache: false }
  } catch (err) {
    return { ok: false, narrative: null, error: err.message }
  }
}

export function aggregateWeeklySummary(data, startDate, endDate) {
  const { dayAhead, generation, imbalance, afrr, errors = {} } = data
  let cutoffStr, todayStr
  if (startDate && endDate) {
    cutoffStr = startDate
    todayStr  = endDate
  } else {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    cutoffStr = cutoff.toISOString().slice(0, 10)
    todayStr  = new Date().toISOString().slice(0, 10)
  }

  const slice = (arr) => (arr || []).filter(d => d.date >= cutoffStr)

  const mean = (arr, key) => {
    const vals = arr.filter(d => d[key] != null).map(d => d[key])
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }

  const afrrSlice      = slice(afrr?.daily)
  const imbalanceSlice = slice(imbalance?.daily)
  const hlaSlice       = slice(dayAhead?.dailyHLA)
  const negHoursSlice  = (dayAhead?.negativeHoursPerWeek ?? []).filter(d => d.week >= cutoffStr)
  const solarSlice     = slice(generation?.solar)
  const windSlice      = slice(generation?.wind)

  const imbalanceMidVals = imbalanceSlice.map(d => d.midPrice).filter(Boolean)
  const imbalanceMean = imbalanceMidVals.length
    ? imbalanceMidVals.reduce((s, v) => s + v, 0) / imbalanceMidVals.length
    : null
  const imbalanceStdDev = imbalanceMidVals.length && imbalanceMean != null
    ? Math.sqrt(imbalanceMidVals.reduce((s, v) => s + (v - imbalanceMean) ** 2, 0) / imbalanceMidVals.length)
    : null

  const periodHigh = hlaSlice.length ? Math.max(...hlaSlice.map(d => d.high)) : null
  const periodLow  = hlaSlice.length ? Math.min(...hlaSlice.map(d => d.low))  : null
  const periodAvg  = mean(hlaSlice, 'avg')
  const negHours   = negHoursSlice.reduce((s, d) => s + (d.count || 0), 0)

  // Map internal keys to human-readable source names
  const SOURCE_LABELS = {
    imbalance: 'TenneT imbalance prices',
    afrr:      'TenneT aFRR/FCR prices',
    dayAhead:  'ENTSO-E day-ahead prices',
    generation:'ENTSO-E actual generation',
  }
  const unavailable = Object.entries(errors)
    .filter(([, err]) => err != null)
    .map(([key]) => SOURCE_LABELS[key] ?? key)

  return {
    period: { from: cutoffStr, to: todayStr },
    unavailable,
    dayAheadPrice: {
      avgEurMwh:         periodAvg,
      highEurMwh:        periodHigh,
      lowEurMwh:         periodLow,
      rangeEurMwh:       periodHigh != null && periodLow != null ? periodHigh - periodLow : null,
      negativeHours:     negHours,
      dailyHLA:          hlaSlice.map(d => ({ date: d.date, avg: +d.avg.toFixed(2), high: +d.high.toFixed(2), low: +d.low.toFixed(2) })),
    },
    battery: {
      afrrCapacityPriceAvg: mean(afrrSlice, 'afrrCapacityPrice'),
      afrrUpEnergyAvg:      mean(afrrSlice, 'afrrUpEnergyPrice'),
      afrrDownEnergyAvg:    mean(afrrSlice, 'afrrDownEnergyPrice'),
      fcrPriceAvg:          mean(afrrSlice, 'fcrPrice'),
      imbalanceMidPriceAvg: imbalanceMean,
      negativeHoursCount:   negHours,
    },
    solar: {
      dayAheadAvgPrice:            periodAvg,
      negativeHoursThisWeek:       negHours,
      nlGridTotalAvgGenMW:         mean(solarSlice, 'avg'),
    },
    wind: {
      dayAheadAvgPrice:            periodAvg,
      imbalanceMidPriceStdDev:     imbalanceStdDev,
    },
  }
}
