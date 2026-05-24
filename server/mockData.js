import { format, subDays, startOfDay } from 'date-fns'

function days30() {
  return Array.from({ length: 30 }, (_, i) =>
    format(subDays(new Date(), 29 - i), 'yyyy-MM-dd')
  )
}

function weeks() {
  const result = []
  for (let i = 4; i >= 0; i--) {
    result.push(format(subDays(new Date(), i * 7), 'yyyy-MM-dd'))
  }
  return result
}

function rng(seed) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function randn(r, mean, std) {
  const u = r(), v = r()
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function generateMockDayAheadPrices() {
  const r = rng(42)
  const dates = days30()

  let price = 65
  const dailyAvg = dates.map(date => {
    price = Math.max(0, price + randn(r, -2, 12))
    return { date, avg: price }
  })

  const hourlyByDate = {}
  for (const { date } of dailyAvg) {
    hourlyByDate[date] = {}
    for (let h = 0; h < 24; h++) {
      const base = dailyAvg.find(d => d.date === date)?.avg ?? 60
      const solarDip = h >= 10 && h <= 15 ? -20 * Math.sin(Math.PI * (h - 10) / 5) : 0
      const morningPeak = h >= 7 && h <= 9 ? 15 : 0
      const eveningPeak = h >= 18 && h <= 20 ? 12 : 0
      const nightTrough = h >= 1 && h <= 5 ? -15 : 0
      hourlyByDate[date][h] = Math.max(-50, base + solarDip + morningPeak + eveningPeak + nightTrough + randn(r, 0, 5))
    }
  }

  const peakOffpeakSpread = dates.map(date => ({
    date,
    spread: 15 + randn(r, 0, 8),
  }))

  const negativeHoursPerWeek = weeks().map(week => ({
    week,
    count: Math.floor(Math.max(0, randn(r, 3, 4))),
  }))

  return { dailyAvg, hourlyByDate, peakOffpeakSpread, negativeHoursPerWeek }
}

export function generateMockGeneration() {
  const r = rng(77)
  const dates = days30()

  const solar = dates.map(date => ({
    date,
    avg: Math.max(0, 1200 + randn(r, 0, 600)),
  }))

  let windBase = 2000
  const wind = dates.map(date => {
    windBase = Math.max(200, windBase + randn(r, 0, 500))
    return { date, avg: windBase }
  })

  return { solar, wind }
}

export function generateMockImbalance() {
  const r = rng(13)
  const dates = days30()
  let mid = 55

  const daily = dates.map(date => {
    mid += randn(r, 0, 25)
    const allPrices = Array.from({ length: 96 }, () => mid + randn(r, 0, 40))
    return {
      date,
      midPrice: mid,
      negativeHours: allPrices.filter(p => p < 0).length,
    }
  })

  return { daily }
}

export function generateMockAFRR() {
  const r = rng(99)
  const dates = days30()
  let cap = 12, up = 140, down = 130, fcr = 18

  const daily = dates.map(date => {
    cap = Math.max(0, cap + randn(r, 0, 3))
    up = Math.max(0, up + randn(r, 0, 20))
    down = Math.max(0, down + randn(r, 0, 20))
    fcr = Math.max(0, fcr + randn(r, 0, 4))
    return {
      date,
      afrrCapacityPrice: cap,
      afrrUpEnergyPrice: up,
      afrrDownEnergyPrice: down,
      fcrPrice: fcr,
    }
  })

  return { daily }
}

export function aggregateWeeklySummary(allData) {
  const last7 = format(subDays(new Date(), 7), 'yyyy-MM-dd')

  const slice = (arr) =>
    (arr || []).filter(d => d.date >= last7)

  const mean = (arr, key) => {
    const vals = arr.filter(d => d[key] != null).map(d => d[key])
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }

  const { afrr, imbalance, dayAhead, generation } = allData

  return {
    battery: {
      afrrCapacityPriceAvg: mean(slice(afrr?.daily), 'afrrCapacityPrice'),
      afrrUpEnergyAvg: mean(slice(afrr?.daily), 'afrrUpEnergyPrice'),
      afrrDownEnergyAvg: mean(slice(afrr?.daily), 'afrrDownEnergyPrice'),
      fcrPriceAvg: mean(slice(afrr?.daily), 'fcrPrice'),
      imbalanceMidPriceAvg: mean(slice(imbalance?.daily), 'midPrice'),
      dayAheadSpreadAvg: mean(slice(dayAhead?.peakOffpeakSpread), 'spread'),
      negativeHoursCount: slice(imbalance?.daily).reduce((s, d) => s + (d.negativeHours || 0), 0),
    },
    solar: {
      dayAheadAvgPrice: mean(slice(dayAhead?.dailyAvg), 'avg'),
      negativeHoursThisWeek: slice(imbalance?.daily).reduce((s, d) => s + (d.negativeHours || 0), 0),
      avgGenMW: mean(slice(generation?.solar), 'avg'),
    },
    wind: {
      dayAheadAvgPrice: mean(slice(dayAhead?.dailyAvg), 'avg'),
      avgGenMW: mean(slice(generation?.wind), 'avg'),
      imbalanceMidPriceStdDev: (() => {
        const vals = slice(imbalance?.daily).map(d => d.midPrice).filter(Boolean)
        if (!vals.length) return null
        const m = vals.reduce((s, v) => s + v, 0) / vals.length
        return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length)
      })(),
    },
  }
}
