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

export function buildNarrativePayload(data, startDate, endDate) {
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

  const hlaSlice      = slice(dayAhead?.dailyHLA)
  const negHoursSlice = (dayAhead?.negativeHoursPerWeek ?? []).filter(d => d.week >= cutoffStr)

  const periodHigh = hlaSlice.length ? Math.max(...hlaSlice.map(d => d.high)) : null
  const periodLow  = hlaSlice.length ? Math.min(...hlaSlice.map(d => d.low))  : null
  const periodAvg  = mean(hlaSlice, 'avg')
  const negHours   = negHoursSlice.reduce((s, d) => s + (d.count || 0), 0)

  // Per-day negative hour counts from hourly HLA (hour avg < 0)
  const negHoursByDay = {}
  for (const d of (dayAhead?.hourlyHLA ?? [])) {
    if (d.date >= cutoffStr && d.avg < 0) {
      negHoursByDay[d.date] = (negHoursByDay[d.date] || 0) + 1
    }
  }

  // Hourly HLA only for days where the daily low was negative
  const negativeDays = new Set(hlaSlice.filter(d => d.low < 0).map(d => d.date))
  const hourlyHLAForNegativeDays = (dayAhead?.hourlyHLA ?? [])
    .filter(d => d.date >= cutoffStr && negativeDays.has(d.date))
    .map(d => ({ date: d.date, hour: d.hour, avg: +d.avg.toFixed(2), high: +d.high.toFixed(2), low: +d.low.toFixed(2) }))

  // Pre-compute charge/discharge window averages per negative-price day
  // Charge window = contiguous block of hours with avg < 0
  // Discharge window = highest-average contiguous 3-hour block on the same day
  const arbitrageWindows = []
  for (const date of [...negativeDays].sort()) {
    const dayHours = hourlyHLAForNegativeDays.filter(d => d.date === date).sort((a, b) => a.hour - b.hour)
    const negHours = dayHours.filter(d => d.avg < 0)
    if (!negHours.length) continue

    const chargeAvg = +(negHours.reduce((s, d) => s + d.avg, 0) / negHours.length).toFixed(2)
    const chargeStart = negHours[0].hour
    const chargeEnd   = negHours[negHours.length - 1].hour

    // Best 3-hour discharge window (highest avg) after the charge block ends
    const postCharge = dayHours.filter(d => d.hour > chargeEnd)
    let bestDischarge = null
    for (let i = 0; i <= postCharge.length - 3; i++) {
      const window = postCharge.slice(i, i + 3)
      const avg = +(window.reduce((s, d) => s + d.avg, 0) / 3).toFixed(2)
      if (!bestDischarge || avg > bestDischarge.avg) {
        bestDischarge = { avg, startHour: window[0].hour, endHour: window[2].hour }
      }
    }
    // Fall back to single best hour if fewer than 3 post-charge hours exist
    if (!bestDischarge && postCharge.length) {
      const best = postCharge.reduce((a, b) => a.avg > b.avg ? a : b)
      bestDischarge = { avg: best.avg, startHour: best.hour, endHour: best.hour }
    }
    if (!bestDischarge) continue

    const spread = +(bestDischarge.avg - chargeAvg).toFixed(2)
    arbitrageWindows.push({
      date,
      chargeWindow:    { startHour: chargeStart, endHour: chargeEnd, avgPrice: chargeAvg },
      dischargeWindow: { startHour: bestDischarge.startHour, endHour: bestDischarge.endHour, avgPrice: bestDischarge.avg },
      spread,
    })
  }

  return {
    period: { from: cutoffStr, to: todayStr },
    dayAheadPrice: {
      avgEurMwh:   periodAvg,
      highEurMwh:  periodHigh,
      lowEurMwh:   periodLow,
      rangeEurMwh: periodHigh != null && periodLow != null ? periodHigh - periodLow : null,
      negativeHours: negHours,
      dailyHLA:    hlaSlice.map(d => ({ date: d.date, avg: +d.avg.toFixed(2), high: +d.high.toFixed(2), low: +d.low.toFixed(2), negativeHours: negHoursByDay[d.date] ?? 0 })),
      hourlyHLAForNegativeDays,
      arbitrageWindows,
    },
    negativeHoursPerWeek: negHoursSlice.map(d => ({ week: d.week, count: d.count })),
  }
}
