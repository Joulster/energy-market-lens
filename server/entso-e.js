import { format, subDays, startOfDay } from 'date-fns'


const BASE_URL = 'https://web-api.tp.entsoe.eu/api'
const BIDDING_ZONE = '10YNL----------L'

function entsoeDate(date) {
  return format(date, 'yyyyMMddHHmm')
}

function periodStart() {
  return entsoeDate(startOfDay(subDays(new Date(), 30)))
}

function periodEnd() {
  return entsoeDate(startOfDay(new Date()))
}

function toEntsoeDate(isoStr, addDays = 0) {
  const d = startOfDay(new Date(isoStr))
  if (addDays) d.setUTCDate(d.getUTCDate() + addDays)
  return entsoeDate(d)
}

async function entsoeRequest(params) {
  const key = process.env.ENTSOE_API_KEY
  if (!key) throw new Error('ENTSOE_API_KEY not configured')

  const url = new URL(BASE_URL)
  url.searchParams.set('securityToken', key)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString())
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const reason = body.match(/<Text>([\s\S]*?)<\/Text>/)?.[1]?.trim()
      ?? body.match(/<code>([\s\S]*?)<\/code>/)?.[1]?.trim()
      ?? `status ${res.status}`
    throw new Error(`ENTSO-E ${res.status}: ${reason}`)
  }
  return res.text()
}

function parseXmlTimeSeries(xml) {
  const points = []
  const periodMatches = xml.matchAll(/<Period>([\s\S]*?)<\/Period>/g)

  for (const periodMatch of periodMatches) {
    const periodXml = periodMatch[1]
    const startMatch = periodXml.match(/<start>(.*?)<\/start>/)
    const resolutionMatch = periodXml.match(/<resolution>(.*?)<\/resolution>/)
    if (!startMatch) continue

    const startStr = startMatch[1].replace('T', ' ').replace('Z', '')
    const resolution = resolutionMatch ? resolutionMatch[1] : 'PT60M'
    const intervalHours = resolution === 'PT60M' ? 1 : resolution === 'PT30M' ? 0.5 : resolution === 'PT15M' ? 0.25 : 1

    const startDate = new Date(startStr + 'Z')
    const pointMatches = periodXml.matchAll(/<Point>[\s\S]*?<position>(\d+)<\/position>[\s\S]*?<price\.amount>([-\d.]+)<\/price\.amount>[\s\S]*?<\/Point>/g)

    for (const ptMatch of pointMatches) {
      const position = parseInt(ptMatch[1], 10)
      const price = parseFloat(ptMatch[2])
      const ts = new Date(startDate.getTime() + (position - 1) * intervalHours * 3600000)
      points.push({ ts, price })
    }
  }
  return points
}

// Format a UTC timestamp as YYYY-MM-DD in Amsterdam local time (CET/CEST).
// NL day-ahead delivery days run 00:00–24:00 CET, so all bucketing must use
// the Amsterdam timezone — not UTC and not server local time.
const AMS = 'Europe/Amsterdam'

function cetDate(ts) {
  return ts.toLocaleDateString('en-CA', { timeZone: AMS }) // en-CA → YYYY-MM-DD
}

function cetHour(ts) {
  return parseInt(ts.toLocaleString('en-GB', { timeZone: AMS, hour: '2-digit', hour12: false }), 10)
}

function aggregateToDailyAvg(points) {
  const byDay = {}
  for (const { ts, price } of points) {
    const day = cetDate(ts)
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(price)
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) => ({
      date,
      avg: prices.reduce((s, p) => s + p, 0) / prices.length,
    }))
}


function computeDailyHLA(points) {
  const byDay = {}
  for (const { ts, price } of points) {
    const day = cetDate(ts)
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(price)
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) => ({
      date,
      avg:  prices.reduce((s, p) => s + p, 0) / prices.length,
      high: Math.max(...prices),
      low:  Math.min(...prices),
    }))
}

function computePeakOffpeakSpread(points) {
  const byDay = {}
  for (const { ts, price } of points) {
    const day  = cetDate(ts)
    const hour = cetHour(ts)
    if (!byDay[day]) byDay[day] = { peak: [], offpeak: [] }
    if (hour >= 8 && hour < 20) byDay[day].peak.push(price)
    else byDay[day].offpeak.push(price)
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { peak, offpeak }]) => {
      const avgPeak    = peak.length    ? peak.reduce((s, p)    => s + p, 0) / peak.length    : null
      const avgOffpeak = offpeak.length ? offpeak.reduce((s, p) => s + p, 0) / offpeak.length : null
      return { date, spread: avgPeak !== null && avgOffpeak !== null ? avgPeak - avgOffpeak : null }
    })
}

function countNegativeHours(points) {
  // Aggregate to hourly averages in CET (handles both PT60M and PT15M resolution)
  const hourSums   = {}
  const hourCounts = {}
  for (const { ts, price } of points) {
    const key = `${cetDate(ts)}|${cetHour(ts)}`
    hourSums[key]   = (hourSums[key]   || 0) + price
    hourCounts[key] = (hourCounts[key] || 0) + 1
  }
  // Count hours with negative average price, bucketed by week
  const byWeek = {}
  for (const [key, total] of Object.entries(hourSums)) {
    const [day] = key.split('|')
    const avgPrice  = total / hourCounts[key]
    const d         = new Date(day + 'T00:00:00')
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay()) // Sunday
    const weekKey = weekStart.toISOString().slice(0, 10)
    if (!byWeek[weekKey]) byWeek[weekKey] = 0
    if (avgPrice < 0) byWeek[weekKey]++
  }
  return Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, count }))
}

export async function fetchDayAheadPrices(startDate, endDate) {
  const ps = startDate ? toEntsoeDate(startDate)       : periodStart()
  const pe = endDate   ? toEntsoeDate(endDate, 1) : periodEnd()
  const xml = await entsoeRequest({
    documentType: 'A44',
    in_Domain: BIDDING_ZONE,
    out_Domain: BIDDING_ZONE,
    periodStart: ps,
    periodEnd: pe,
  })

  const points = parseXmlTimeSeries(xml)
  if (!points.length) throw new Error('No price points parsed from response')

  return {
    dailyAvg: aggregateToDailyAvg(points),
    dailyHLA: computeDailyHLA(points),
    peakOffpeakSpread: computePeakOffpeakSpread(points),
    negativeHoursPerWeek: countNegativeHours(points),
    rawPoints: points,
  }
}

export async function fetchActualGeneration(startDate, endDate) {
  const ps = startDate ? toEntsoeDate(startDate) : periodStart()
  const pe = endDate   ? toEntsoeDate(endDate)   : periodEnd()
  const xml = await entsoeRequest({
      documentType: 'A75',
      processType: 'A16',
      in_Domain: BIDDING_ZONE,
      periodStart: ps,
      periodEnd: pe,
    })

    const solarPoints = []
    const windPoints = []

    const tsMatches = xml.matchAll(/<TimeSeries>([\s\S]*?)<\/TimeSeries>/g)
    for (const tsMatch of tsMatches) {
      const tsXml = tsMatch[1]
      const typeMatch = tsXml.match(/<MktPSRType>[\s\S]*?<psrType>(B\d+)<\/psrType>/)
      if (!typeMatch) continue
      const psr = typeMatch[1]
      if (psr !== 'B16' && psr !== 'B18' && psr !== 'B19') continue

      const periodMatches = tsXml.matchAll(/<Period>([\s\S]*?)<\/Period>/g)
      for (const periodMatch of periodMatches) {
        const periodXml = periodMatch[1]
        const startMatch = periodXml.match(/<start>(.*?)<\/start>/)
        if (!startMatch) continue
        const startDate = new Date(startMatch[1].replace('T', ' ').replace('Z', ''))
        const ptMatches = periodXml.matchAll(/<Point>[\s\S]*?<position>(\d+)<\/position>[\s\S]*?<quantity>([\d.]+)<\/quantity>[\s\S]*?<\/Point>/g)

        for (const ptMatch of ptMatches) {
          const pos = parseInt(ptMatch[1], 10)
          const qty = parseFloat(ptMatch[2])
          const ts = new Date(startDate.getTime() + (pos - 1) * 3600000)
          if (psr === 'B19') solarPoints.push({ ts, qty })
          else windPoints.push({ ts, qty })
        }
      }
    }

    const aggGen = (pts) =>
      Object.entries(
        pts.reduce((acc, { ts, qty }) => {
          const day = format(ts, 'yyyy-MM-dd')
          acc[day] = (acc[day] || []).concat(qty)
          return acc
        }, {})
      )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, vals]) => ({ date, avg: vals.reduce((s, v) => s + v, 0) / vals.length }))

    return {
      solar: aggGen(solarPoints),
      wind: aggGen(windPoints),
    }
}

// ── Balancing data (A73 capacity prices, A85 activated energy) ──────────────

function parseBalancingTimeSeries(xml) {
  // Flexible parser — tries price.amount, procurement_Price.amount, activation_Price.amount
  const points = []
  const periodMatches = xml.matchAll(/<Period>([\s\S]*?)<\/Period>/g)

  for (const periodMatch of periodMatches) {
    const periodXml = periodMatch[1]
    const startMatch = periodXml.match(/<start>(.*?)<\/start>/)
    if (!startMatch) continue

    const startDate = new Date(startMatch[1].replace('T', ' ').replace('Z', '') + 'Z')
    const resolution = periodXml.match(/<resolution>(.*?)<\/resolution>/)?.[1] ?? 'PT60M'
    const intervalHours = resolution === 'PT60M' ? 1 : resolution === 'PT30M' ? 0.5 : resolution === 'PT15M' ? 0.25 : 1

    for (const ptMatch of periodXml.matchAll(/<Point>([\s\S]*?)<\/Point>/g)) {
      const ptXml = ptMatch[1]
      const posMatch = ptXml.match(/<position>(\d+)<\/position>/)
      if (!posMatch) continue

      const valMatch =
        ptXml.match(/<price\.amount>([\d.+-]+)<\/price\.amount>/) ||
        ptXml.match(/<procurement_Price\.amount>([\d.+-]+)<\/procurement_Price\.amount>/) ||
        ptXml.match(/<activation_Price\.amount>([\d.+-]+)<\/activation_Price\.amount>/) ||
        ptXml.match(/<quantity>([\d.+-]+)<\/quantity>/)
      if (!valMatch) continue

      const position = parseInt(posMatch[1], 10)
      const value = parseFloat(valMatch[1])
      const ts = new Date(startDate.getTime() + (position - 1) * intervalHours * 3600000)
      points.push({ ts, value })
    }
  }
  return points
}

function dailyAvgFromPoints(points) {
  const byDay = {}
  for (const { ts, value } of points) {
    const day = format(ts, 'yyyy-MM-dd')
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(value)
  }
  return Object.fromEntries(
    Object.entries(byDay).map(([day, vals]) => [
      day,
      vals.reduce((s, v) => s + v, 0) / vals.length,
    ])
  )
}

export async function fetchBalancingData(startDate, endDate) {
  const ps = startDate ? toEntsoeDate(startDate) : periodStart()
  const pe = endDate   ? toEntsoeDate(endDate)   : periodEnd()

    // A73 = Procured Balancing Capacity (capacity prices)
    // A85 = Activated Balancing Energy  (energy prices)
    // businessType A96 = aFRR, A95 = FCR
    // flowDirection.direction A01 = Up, A02 = Down
    // ENTSO-E requires 'controlArea_Domain.mRID' (not just 'controlArea_Domain')
    const [afrrCapRes, fcrCapRes, afrrUpRes, afrrDownRes] = await Promise.allSettled([
      entsoeRequest({ documentType: 'A73', businessType: 'A96', 'type_MarketAgreement.Type': 'A01', 'controlArea_Domain.mRID': BIDDING_ZONE, periodStart: ps, periodEnd: pe }),
      entsoeRequest({ documentType: 'A73', businessType: 'A95', 'type_MarketAgreement.Type': 'A01', 'controlArea_Domain.mRID': BIDDING_ZONE, periodStart: ps, periodEnd: pe }),
      entsoeRequest({ documentType: 'A85', businessType: 'A96', 'flowDirection.direction': 'A01', 'controlArea_Domain.mRID': BIDDING_ZONE, periodStart: ps, periodEnd: pe }),
      entsoeRequest({ documentType: 'A85', businessType: 'A96', 'flowDirection.direction': 'A02', 'controlArea_Domain.mRID': BIDDING_ZONE, periodStart: ps, periodEnd: pe }),
    ])

    const extract = (res) => res.status === 'fulfilled' ? dailyAvgFromPoints(parseBalancingTimeSeries(res.value)) : {}

    const afrrCap  = extract(afrrCapRes)
    const fcrCap   = extract(fcrCapRes)
    const afrrUp   = extract(afrrUpRes)
    const afrrDown = extract(afrrDownRes)

    // Collect all dates seen across any source
    const dates = [...new Set([
      ...Object.keys(afrrCap),
      ...Object.keys(fcrCap),
      ...Object.keys(afrrUp),
      ...Object.keys(afrrDown),
    ])].sort()

    if (!dates.length) throw new Error('No balancing data parsed from ENTSO-E responses')

    const daily = dates.map(date => ({
      date,
      afrrCapacityPrice: afrrCap[date] ?? null,
      afrrUpEnergyPrice: afrrUp[date]  ?? null,
      afrrDownEnergyPrice: afrrDown[date] ?? null,
      fcrPrice: fcrCap[date] ?? null,
    }))


  return { daily }
}
