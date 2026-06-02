import { format, subDays, startOfDay } from 'date-fns'
import AdmZip from 'adm-zip'


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

const ENTSOE_TIMEOUT_MS = 30_000          // 30 s — ENTSO-E is slow but usually responds
const ENTSOE_MAX_RETRIES = 3              // total attempts (1 original + 2 retries)
const ENTSOE_RETRY_BASE_MS = 1_000       // 1 s → 2 s → 4 s (exponential backoff)

// Status codes worth retrying (transient). 4xx errors (except 429) are config
// problems — no point retrying those.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

async function entsoeRequest(params, attempt = 1) {
  const key = process.env.ENTSOE_API_KEY
  if (!key) throw new Error('ENTSOE_API_KEY not configured')

  const url = new URL(BASE_URL)
  url.searchParams.set('securityToken', key)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  // Safe URL for logging — strip the API key
  const safeUrl = (() => {
    const u = new URL(url.toString())
    u.searchParams.set('securityToken', '***')
    return u.toString()
  })()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ENTSOE_TIMEOUT_MS)

  let res
  try {
    res = await fetch(url.toString(), { signal: controller.signal })
  } catch (err) {
    clearTimeout(timer)
    const isTimeout = err.name === 'AbortError'
    const msg = isTimeout
      ? `ENTSO-E request timed out after ${ENTSOE_TIMEOUT_MS / 1000}s`
      : `ENTSO-E network error: ${err.message}`
    if (attempt < ENTSOE_MAX_RETRIES) {
      const delay = ENTSOE_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(`  ↺ ${msg} — retrying in ${delay}ms (attempt ${attempt}/${ENTSOE_MAX_RETRIES}) [${safeUrl}]`)
      await new Promise(r => setTimeout(r, delay))
      return entsoeRequest(params, attempt + 1)
    }
    throw new Error(`${msg} (all ${ENTSOE_MAX_RETRIES} attempts exhausted)`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const reason = body.match(/<Text>([\s\S]*?)<\/Text>/)?.[1]?.trim()
      ?? body.match(/<code>([\s\S]*?)<\/code>/)?.[1]?.trim()
      ?? `status ${res.status}`
    const err = new Error(`ENTSO-E ${res.status}: ${reason}`)
    if (RETRYABLE_STATUSES.has(res.status) && attempt < ENTSOE_MAX_RETRIES) {
      const delay = ENTSOE_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(`  ↺ ${err.message} — retrying in ${delay}ms (attempt ${attempt}/${ENTSOE_MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, delay))
      return entsoeRequest(params, attempt + 1)
    }
    throw err
  }

  return res.text()
}

// Like entsoeRequest but returns a Buffer (for ZIP responses)
async function entsoeRequestBinary(params, attempt = 1) {
  const key = process.env.ENTSOE_API_KEY
  if (!key) throw new Error('ENTSOE_API_KEY not configured')

  const url = new URL(BASE_URL)
  url.searchParams.set('securityToken', key)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const safeUrl = (() => {
    const u = new URL(url.toString())
    u.searchParams.set('securityToken', '***')
    return u.toString()
  })()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ENTSOE_TIMEOUT_MS)

  let res
  try {
    res = await fetch(url.toString(), { signal: controller.signal })
  } catch (err) {
    clearTimeout(timer)
    const isTimeout = err.name === 'AbortError'
    const msg = isTimeout
      ? `ENTSO-E request timed out after ${ENTSOE_TIMEOUT_MS / 1000}s`
      : `ENTSO-E network error: ${err.message}`
    if (attempt < ENTSOE_MAX_RETRIES) {
      const delay = ENTSOE_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(`  ↺ ${msg} — retrying in ${delay}ms (attempt ${attempt}/${ENTSOE_MAX_RETRIES}) [${safeUrl}]`)
      await new Promise(r => setTimeout(r, delay))
      return entsoeRequestBinary(params, attempt + 1)
    }
    throw new Error(`${msg} (all ${ENTSOE_MAX_RETRIES} attempts exhausted)`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const reason = body.match(/<Text>([\s\S]*?)<\/Text>/)?.[1]?.trim()
      ?? body.match(/<code>([\s\S]*?)<\/code>/)?.[1]?.trim()
      ?? `status ${res.status}`
    const err = new Error(`ENTSO-E ${res.status}: ${reason}`)
    if (RETRYABLE_STATUSES.has(res.status) && attempt < ENTSOE_MAX_RETRIES) {
      const delay = ENTSOE_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(`  ↺ ${err.message} — retrying in ${delay}ms (attempt ${attempt}/${ENTSOE_MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, delay))
      return entsoeRequestBinary(params, attempt + 1)
    }
    throw err
  }

  return Buffer.from(await res.arrayBuffer())
}

// Extract the first XML file from a ZIP buffer. Returns the XML string.
function unzipXml(buffer) {
  const zip = new AdmZip(buffer)
  const entry = zip.getEntries().find(e => e.entryName.endsWith('.xml'))
  if (!entry) throw new Error('No XML found in ENTSO-E ZIP response')
  return entry.getData().toString('utf8')
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


function computeHourlyHLA(points) {
  const byDayHour = {}
  for (const { ts, price } of points) {
    const key = `${cetDate(ts)}|${String(cetHour(ts)).padStart(2, '0')}`
    if (!byDayHour[key]) byDayHour[key] = []
    byDayHour[key].push(price)
  }
  return Object.entries(byDayHour)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, prices]) => {
      const [date, hour] = key.split('|')
      return {
        date,
        hour: parseInt(hour, 10),
        avg:  prices.reduce((s, p) => s + p, 0) / prices.length,
        high: Math.max(...prices),
        low:  Math.min(...prices),
      }
    })
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

function aggregateHourlyAvgs(points) {
  // Shared first pass: aggregate 15m points to hourly CET averages
  // Returns { [date|hour]: avgPrice }
  const hourSums   = {}
  const hourCounts = {}
  for (const { ts, price } of points) {
    const key = `${cetDate(ts)}|${cetHour(ts)}`
    hourSums[key]   = (hourSums[key]   || 0) + price
    hourCounts[key] = (hourCounts[key] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(hourSums).map(([key, total]) => [key, total / hourCounts[key]])
  )
}

function countNegativeHours(points) {
  const hourlyAvgs = aggregateHourlyAvgs(points)
  const byWeek = {}
  for (const [key, avgPrice] of Object.entries(hourlyAvgs)) {
    const [day] = key.split('|')
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

function computeDailyNegativeHours(points) {
  // Same hourly aggregation as countNegativeHours — per day instead of per week
  // Guaranteed to sum to the same total as countNegativeHours over any date range
  const hourlyAvgs = aggregateHourlyAvgs(points)
  const byDay = {}
  for (const [key, avgPrice] of Object.entries(hourlyAvgs)) {
    const [day] = key.split('|')
    if (avgPrice < 0) byDay[day] = (byDay[day] || 0) + 1
  }
  return byDay // { 'YYYY-MM-DD': count }
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
    hourlyHLA: computeHourlyHLA(points),
    peakOffpeakSpread: computePeakOffpeakSpread(points),
    negativeHoursPerWeek: countNegativeHours(points),
    dailyNegativeHours: computeDailyNegativeHours(points),
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
    // Use CET date so ENTSO-E periods starting at 22:00 UTC (= 00:00 CET)
    // align with TenneT's CET-based dates
    const day = cetDate(ts)
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

// Fetch aFRR and FCR capacity procurement prices from ENTSO-E.
// Document type A81 (Contracted reserves), businessType B95 (Procured capacity).
// Process types: A51 = aFRR, A52 = FCR (per ENTSO-E balancing document mapping).
// Agreement type A01 = Daily (D-1 procurement used by TenneT NL).
// Response is a ZIP file containing XML — requires binary fetch + decompress.
// Returns { afrrCapacityByDay, fcrByDay } — plain date→price maps.
export async function fetchCapacityPrices(startDate, endDate) {
  const ps = startDate ? toEntsoeDate(startDate) : periodStart()
  const pe = endDate   ? toEntsoeDate(endDate, 1) : periodEnd()

  const base = {
    documentType: 'A81',
    businessType: 'B95',
    controlArea_Domain: BIDDING_ZONE,
    'type_MarketAgreement.Type': 'A01',
    periodStart: ps,
    periodEnd: pe,
  }

  const [afrrRes, fcrRes] = await Promise.allSettled([
    entsoeRequestBinary({ ...base, processType: 'A51' }),
    entsoeRequestBinary({ ...base, processType: 'A52' }),
  ])

  const extract = (res) => {
    if (res.status === 'rejected') return {}
    try {
      return dailyAvgFromPoints(parseBalancingTimeSeries(unzipXml(res.value)))
    } catch (e) {
      console.warn('ENTSO-E capacity ZIP parse error:', e.message)
      return {}
    }
  }

  if (afrrRes.status === 'rejected') console.warn('ENTSO-E aFRR capacity fetch failed:', afrrRes.reason?.message)
  if (fcrRes.status  === 'rejected') console.warn('ENTSO-E FCR capacity fetch failed:',  fcrRes.reason?.message)

  return {
    afrrCapacityByDay: extract(afrrRes),
    fcrByDay:          extract(fcrRes),
  }
}
