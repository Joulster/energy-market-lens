import { format, subDays } from 'date-fns'

const TENNET_BASE = 'https://www.tennet.eu/fileadmin/user_upload/The_Electricity_Market/Dutch_Specific/System_Management_-_Operational_Information'

async function fetchTennetCSV(path) {
  const res = await fetch(`${TENNET_BASE}/${path}`, {
    headers: { 'User-Agent': 'EnergyMarketLens/1.0' },
  })
  if (!res.ok) throw new Error(`TenneT responded ${res.status} for ${path}`)
  return res.text()
}

function parseCSVLines(csv, delimiter = ';') {
  const lines = csv.split('\n').filter(l => l.trim())
  if (!lines.length) return []
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/"/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(delimiter).map(v => v.trim().replace(/"/g, ''))
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
  })
}

export async function fetchImbalancePrices() {
  const now = new Date()
    const year = now.getFullYear()
    const quarter = Math.ceil((now.getMonth() + 1) / 3)
    const path = `Incidents_and_Capacity/Imbalance/Onbalans_Prijs_${year}_Q${quarter}.csv`

    const csv = await fetchTennetCSV(path)
    const rows = parseCSVLines(csv)

    const byDay = {}
    for (const row of rows) {
      const dateStr = row['DATE'] || row['Datum'] || row['date']
      const midPrice = parseFloat(row['MidPrice'] || row['Mid Price'] || row['midprice'] || '0')
      if (!dateStr || isNaN(midPrice)) continue

      const day = dateStr.slice(0, 10)
      if (!byDay[day]) byDay[day] = []
      byDay[day].push(midPrice)
    }

    const cutoff = format(subDays(new Date(), 30), 'yyyy-MM-dd')
    const daily = Object.entries(byDay)
      .filter(([d]) => d >= cutoff)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, prices]) => ({
        date,
        midPrice: prices.reduce((s, p) => s + p, 0) / prices.length,
        negativeHours: prices.filter(p => p < 0).length,
      }))

  return { daily }
}

export async function fetchAFRRData() {
  const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const path = `Regulating_Power/aFRR_Capacity_Prices_${year}_${month}.csv`

    const csv = await fetchTennetCSV(path)
    const rows = parseCSVLines(csv)

    const cutoff = format(subDays(new Date(), 30), 'yyyy-MM-dd')
    const byDay = {}

    for (const row of rows) {
      const dateStr = row['Date'] || row['date'] || row['DATE']
      if (!dateStr) continue
      const day = dateStr.slice(0, 10)
      if (day < cutoff) continue

      const capPrice = parseFloat(row['Capacity Price'] || row['CapacityPrice'] || '0')
      const upPrice = parseFloat(row['Up Energy Price'] || row['UpwardEnergyPrice'] || '0')
      const downPrice = parseFloat(row['Down Energy Price'] || row['DownwardEnergyPrice'] || '0')
      const fcrPrice = parseFloat(row['FCR Price'] || row['FCRPrice'] || '0')

      if (!byDay[day]) byDay[day] = { cap: [], up: [], down: [], fcr: [] }
      if (!isNaN(capPrice) && capPrice) byDay[day].cap.push(capPrice)
      if (!isNaN(upPrice) && upPrice) byDay[day].up.push(upPrice)
      if (!isNaN(downPrice) && downPrice) byDay[day].down.push(downPrice)
      if (!isNaN(fcrPrice) && fcrPrice) byDay[day].fcr.push(fcrPrice)
    }

    const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

    const daily = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        afrrCapacityPrice: avg(d.cap),
        afrrUpEnergyPrice: avg(d.up),
        afrrDownEnergyPrice: avg(d.down),
        fcrPrice: avg(d.fcr),
      }))

  return { daily }
}
