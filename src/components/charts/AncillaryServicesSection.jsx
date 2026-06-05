import { useState, useEffect, useCallback } from 'react'
import {
  ComposedChart, LineChart, Line, Bar, Cell, ReferenceArea, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, legendStyle, fmtDate, ChartWrap, CompareTooltip, useLegendToggle } from './shared.jsx'
import { useZoom } from './useZoom.js'
import { fetchMeritOrderDay } from '../../data/index.js'

// ── Timestamp formatters ────────────────────────────────────────────────────

function fmtEnergyTs(v, resolution) {
  if (!v) return ''
  if (resolution === '1d' || resolution === '1w') return fmtDate(v.slice(0, 10))
  const date = v.slice(0, 10)
  const time = v.slice(11, 16)
  return `${fmtDate(date)} ${time}`
}

function fmtCapacityTs(v, resolution) {
  if (!v) return ''
  if (resolution === '1d') return fmtDate(v.slice(0, 10))
  const [date, time] = v.split('T')
  return `${fmtDate(date)} ${time}`
}

// ── Capacity resolution aggregation ────────────────────────────────────────

const CAPACITY_RESOLUTIONS = [
  { key: '4h', label: '4h' },
  { key: '1d', label: '1d' },
]

function aggregateAfrrCap1d(points) {
  const buckets = {}
  for (const pt of points) {
    const date = pt.timestamp.slice(0, 10)
    if (!buckets[date]) buckets[date] = { up: [], down: [], upMW: [], downMW: [] }
    if (pt.afrrCapacityUpPrice   != null) buckets[date].up.push(pt.afrrCapacityUpPrice)
    if (pt.afrrCapacityDownPrice != null) buckets[date].down.push(pt.afrrCapacityDownPrice)
    if (pt.afrrCapacityUpMW      != null) buckets[date].upMW.push(pt.afrrCapacityUpMW)
    if (pt.afrrCapacityDownMW    != null) buckets[date].downMW.push(pt.afrrCapacityDownMW)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      timestamp:             date,
      afrrCapacityUpPrice:   avg(b.up),
      afrrCapacityDownPrice: avg(b.down),
      afrrCapacityUpMW:      avg(b.upMW),
      afrrCapacityDownMW:    avg(b.downMW),
    }))
}

function aggregateFcr1d(points) {
  const buckets = {}
  for (const pt of points) {
    const date = pt.timestamp.slice(0, 10)
    if (!buckets[date]) buckets[date] = { prices: [], mws: [] }
    if (pt.price      != null) buckets[date].prices.push(pt.price)
    if (pt.capacityMW != null) buckets[date].mws.push(pt.capacityMW)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      timestamp:  date,
      price:      avg(b.prices),
      capacityMW: avg(b.mws),
    }))
}

// ── aFRR energy + FRR activation aggregation ───────────────────────────────

const ENERGY_RESOLUTIONS = [
  { key: '15m', label: '15m' },
  { key: '1h',  label: '1h'  },
  { key: '1d',  label: '1d'  },
  { key: '1w',  label: '1w'  },
]

const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null
const sum = arr => arr.reduce((s, v) => s + v, 0)

// ISO week key (Monday-based): YYYY-Www
function isoWeekKey(timestamp) {
  const d = new Date(timestamp.slice(0, 10) + 'T12:00:00Z')
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function aggregateEnergy1h(points) {
  const buckets = {}
  for (const pt of points) {
    const key = pt.timestamp.slice(0, 13)
    if (!buckets[key]) buckets[key] = { timestamp: pt.timestamp, up: [], down: [] }
    buckets[key].up.push(pt.afrrUpEnergyPrice)
    buckets[key].down.push(pt.afrrDownEnergyPrice)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { timestamp, up, down }]) => ({
      timestamp,
      afrrUpEnergyPrice:   avg(up),
      afrrDownEnergyPrice: avg(down),
    }))
}

function aggregateEnergy1d(points) {
  const buckets = {}
  for (const pt of points) {
    const date = pt.timestamp.slice(0, 10)
    if (!buckets[date]) buckets[date] = { up: [], down: [] }
    buckets[date].up.push(pt.afrrUpEnergyPrice)
    buckets[date].down.push(pt.afrrDownEnergyPrice)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { up, down }]) => ({
      timestamp: date,
      afrrUpEnergyPrice:   avg(up),
      afrrDownEnergyPrice: avg(down),
    }))
}

function aggregateEnergy1w(points) {
  const buckets = {}
  for (const pt of points) {
    const key = isoWeekKey(pt.timestamp)
    if (!buckets[key]) buckets[key] = { timestamp: pt.timestamp, up: [], down: [] }
    buckets[key].up.push(pt.afrrUpEnergyPrice)
    buckets[key].down.push(pt.afrrDownEnergyPrice)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { timestamp, up, down }]) => ({
      timestamp,
      afrrUpEnergyPrice:   avg(up),
      afrrDownEnergyPrice: avg(down),
    }))
}

function aggregateEnergy(points, resolution) {
  if (resolution === '1h') return aggregateEnergy1h(points)
  if (resolution === '1d') return aggregateEnergy1d(points)
  if (resolution === '1w') return aggregateEnergy1w(points)
  return points  // 15m — raw
}

// Aggregate FRR activation volumes at the same resolution as energy
function aggregateFrr1h(points) {
  const buckets = {}
  for (const pt of points) {
    const key = pt.timestamp.slice(0, 13)
    if (!buckets[key]) buckets[key] = { timestamp: pt.timestamp, up: [], down: [] }
    buckets[key].up.push(pt.activatedUpMw)
    buckets[key].down.push(pt.activatedDownMw)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { timestamp, up, down }]) => ({
      timestamp,
      activatedUpMw:   avg(up),
      activatedDownMw: avg(down),
    }))
}

function aggregateFrr1d(points) {
  const buckets = {}
  for (const pt of points) {
    const date = pt.timestamp.slice(0, 10)
    if (!buckets[date]) buckets[date] = { up: [], down: [] }
    buckets[date].up.push(pt.activatedUpMw)
    buckets[date].down.push(pt.activatedDownMw)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { up, down }]) => ({
      timestamp: date,
      activatedUpMw:   sum(up),   // weekly/daily: totals, not avg
      activatedDownMw: sum(down),
    }))
}

function aggregateFrr1w(points) {
  const buckets = {}
  for (const pt of points) {
    const key = isoWeekKey(pt.timestamp)
    if (!buckets[key]) buckets[key] = { timestamp: pt.timestamp, up: [], down: [] }
    buckets[key].up.push(pt.activatedUpMw)
    buckets[key].down.push(pt.activatedDownMw)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { timestamp, up, down }]) => ({
      timestamp,
      activatedUpMw:   sum(up),
      activatedDownMw: sum(down),
    }))
}

function aggregateFrr(points, resolution) {
  if (resolution === '1h') return aggregateFrr1h(points)
  if (resolution === '1d') return aggregateFrr1d(points)
  if (resolution === '1w') return aggregateFrr1w(points)
  return points  // 15m — raw
}

// ── Merit order helpers ─────────────────────────────────────────────────────

function ptuToTime(ptu) {
  // ptu 1–96: 1 = 00:00, 5 = 01:00, etc.
  const totalMinutes = (ptu - 1) * 15
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const m = String(totalMinutes % 60).padStart(2, '0')
  return `${h}:${m}`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

// Build average supply curve across all days that have data for a given PTU slot
function buildAverageCurve(allDayData, ptuIndex) {
  if (!allDayData?.length) return []
  const curvesByDay = allDayData
    .map(dayData => dayData?.ptus?.[ptuIndex]?.curve)
    .filter(Boolean)
  if (!curvesByDay.length) return []

  // Find max cumulative volume across all days
  const maxVol = Math.max(...curvesByDay.map(c => c[c.length - 1]?.cumVolume ?? 0))
  if (!maxVol) return []

  // Sample at regular volume intervals and average the price at each step
  const steps = 40
  const avgCurve = []
  for (let i = 0; i <= steps; i++) {
    const cumVol = (i / steps) * maxVol
    const prices = curvesByDay.map(curve => {
      // Find the price at this cumVolume (step function: last bid with cumVolume <= cumVol)
      let price = curve[0]?.price ?? null
      for (const bid of curve) {
        if (bid.cumVolume <= cumVol) price = bid.price
        else break
      }
      return price
    }).filter(p => p != null)
    if (prices.length) {
      avgCurve.push({ cumVolume: +cumVol.toFixed(1), price: +avg(prices).toFixed(2) })
    }
  }
  return avgCurve
}

// ── AI Summary block ────────────────────────────────────────────────────────

function fmtRangeDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function SummaryBlock({ text, loading, onGenerate, isStale, generatedDates, lastGenerated }) {
  const hasResult  = text !== undefined
  const rangeLabel = generatedDates
    ? `${fmtRangeDate(generatedDates.startDate)} – ${fmtRangeDate(generatedDates.endDate)}`
    : null

  return (
    <div className={`ai-summary-block${isStale ? ' ai-summary-stale-block' : ''}`}>
      <div className="ai-summary-header">
        <span className="ai-summary-label">
          AI Summary
          {rangeLabel && <span className="ai-summary-range"> · {rangeLabel}</span>}
        </span>
        <div className="ai-summary-header-right">
          {isStale && <span className="ai-stale-chip">⚠ Date range changed</span>}
          <button
            className={`ai-summary-btn${loading ? ' loading' : ''}${isStale ? ' stale' : ''}`}
            onClick={onGenerate}
            disabled={loading}
          >
            {loading
              ? <><span className="ai-btn-spinner" /> Generating…</>
              : hasResult ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>
      {hasResult && (
        loading
          ? <p className="ai-summary-text ai-summary-faded">{text || 'No data available for this section.'}</p>
          : text
            ? <p className="ai-summary-text">{text}</p>
            : <p className="ai-summary-unavailable">No data available for this section.</p>
      )}
      {hasResult && !loading && lastGenerated && (
        <p className="ai-summary-timestamp">Generated at {lastGenerated}</p>
      )}
    </div>
  )
}

// ── Merit Order chart component ─────────────────────────────────────────────

function MeritOrderChart({ startDate, endDate }) {
  const [selectedDate,   setSelectedDate]   = useState(today())
  const [selectedPtu,    setSelectedPtu]    = useState(1)
  const [dayData,        setDayData]        = useState(null)   // { date, ptus }
  const [allDayData,     setAllDayData]     = useState([])     // avg curve source
  const [loadingDay,     setLoadingDay]     = useState(false)
  const [error,          setError]          = useState(null)

  // Fetch the selected day
  useEffect(() => {
    let cancelled = false
    setLoadingDay(true)
    setError(null)
    fetchMeritOrderDay(selectedDate).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err); setDayData(null) }
      else setDayData(data)
      setLoadingDay(false)
    })
    return () => { cancelled = true }
  }, [selectedDate])

  // Fetch a sample of days for the average curve when the range changes
  useEffect(() => {
    if (!startDate || !endDate) return
    // Sample up to 7 days evenly spaced within the selected range
    const start = new Date(startDate + 'T00:00:00Z')
    const end   = new Date(endDate   + 'T00:00:00Z')
    const dayCount = Math.round((end - start) / 86400000) + 1
    const sampleCount = Math.min(dayCount, 7)
    const step = Math.max(1, Math.floor(dayCount / sampleCount))
    const dates = []
    for (let i = 0; i < sampleCount; i++) {
      const d = new Date(start.getTime() + i * step * 86400000)
      dates.push(d.toISOString().slice(0, 10))
    }
    let cancelled = false
    Promise.all(dates.map(d => fetchMeritOrderDay(d).then(r => r.data))).then(results => {
      if (!cancelled) setAllDayData(results.filter(Boolean))
    })
    return () => { cancelled = true }
  }, [startDate, endDate])

  // The active PTU index (0-based) in the ptus array
  const ptuIndex = selectedPtu - 1
  const ptusAvailable = dayData?.ptus?.length ?? 0
  const activePtu = dayData?.ptus?.[Math.min(ptuIndex, ptusAvailable - 1)]

  // Current supply curve
  const primaryCurve = activePtu?.curve ?? []

  // Average curve for this PTU slot across the sample days
  const avgCurve = buildAverageCurve(allDayData, Math.min(ptuIndex, (allDayData[0]?.ptus?.length ?? 1) - 1))

  // Clearing price = last bid price in the primary curve
  const clearingPrice = primaryCurve.length ? primaryCurve[primaryCurve.length - 1]?.price : null

  // Tightness: MW of bids above the clearing price
  const bidDepthAbove = clearingPrice != null
    ? primaryCurve.filter(b => b.price > clearingPrice).reduce((s, b, i, arr) => {
        const prevVol = i > 0 ? arr[i - 1].cumVolume : 0
        return s + (b.cumVolume - prevVol)
      }, 0)
    : null

  const avgBidDepthAbove = clearingPrice != null && avgCurve.length
    ? (() => {
        const total = avgCurve[avgCurve.length - 1]?.cumVolume ?? 0
        const above = avgCurve.filter(b => b.price > clearingPrice)
        const belowVol = above.length ? avgCurve.find(b => b.price <= clearingPrice)?.cumVolume ?? 0 : total
        return +(total - belowVol).toFixed(0)
      })()
    : null

  // Merge primary + average curves for the chart
  const chartData = (() => {
    if (!primaryCurve.length && !avgCurve.length) return []
    const allVols = new Set([
      ...primaryCurve.map(b => b.cumVolume),
      ...avgCurve.map(b => b.cumVolume),
    ])
    const sorted = [...allVols].sort((a, b) => a - b)
    return sorted.map(cumVol => {
      const pri = primaryCurve.findLast(b => b.cumVolume <= cumVol)
      const avc = avgCurve.findLast(b => b.cumVolume <= cumVol)
      return {
        cumVolume: cumVol,
        primaryPrice: pri?.price ?? null,
        avgPrice:     avc?.price ?? null,
      }
    })
  })()

  const tightnessAbove  = bidDepthAbove    != null ? Math.round(bidDepthAbove)    : null
  const tightnessAvg    = avgBidDepthAbove != null ? Math.round(avgBidDepthAbove) : null
  const tightnessGreen  = tightnessAbove != null && tightnessAvg != null && tightnessAbove >= tightnessAvg

  const tightnessLabel = tightnessAbove != null
    ? <span className="merit-tightness">
        Bid depth above clearing:
        <span style={{ color: tightnessGreen ? '#4ade80' : '#fbbf24', marginLeft: 4, fontWeight: 600 }}>
          {tightnessAbove} MW
        </span>
        {tightnessAvg != null && <span style={{ color: '#64748b' }}> vs {tightnessAvg} MW avg</span>}
      </span>
    : null

  const isLoading = loadingDay
  const isMock    = !loadingDay && !!error && !dayData

  const meritControls = (
    <div className="merit-date-selector">
      <button className="merit-nav-btn" onClick={() => { setSelectedDate(d => shiftDate(d, -1)); setSelectedPtu(1) }} title="Previous day">‹</button>
      <input
        type="date"
        className="merit-date-input"
        value={selectedDate}
        onChange={e => { setSelectedDate(e.target.value); setSelectedPtu(1) }}
        max={today()}
      />
      <button className="merit-nav-btn" onClick={() => { setSelectedDate(d => shiftDate(d, 1)); setSelectedPtu(1) }} title="Next day" disabled={selectedDate >= today()}>›</button>
    </div>
  )

  return (
    <ChartWrap
      title="aFRR Merit Order NL — Bid Stack"
      source="TenneT"
      isMock={isMock}
      isLoading={isLoading}
      controls={meritControls}
    >
      {/* Tightness indicator */}
      {tightnessLabel && <div style={{ paddingLeft: 8, paddingBottom: 4 }}>{tightnessLabel}</div>}

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 10, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="cumVolume"
            type="number"
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            tickFormatter={v => `${Math.round(v)}MW`}
            domain={['auto', 'auto']}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            width={55}
            tickFormatter={v => Number(v).toFixed(0)}
            label={{ value: 'EUR/MW/h', angle: -90, position: 'insideLeft', style: { fill: '#64748b', fontSize: 10 }, dx: -5 }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const primaryV = payload.find(p => p.dataKey === 'primaryPrice')?.value
              const avgV     = payload.find(p => p.dataKey === 'avgPrice')?.value
              const delta    = primaryV != null && avgV != null ? primaryV - avgV : null
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{Math.round(label)} MW cumulative</p>
                  {primaryV != null && (
                    <div className="chart-tooltip-row">
                      <span className="chart-tooltip-dot" style={{ background: COLORS.cyan }} />
                      <span className="chart-tooltip-name">Today</span>
                      <span className="chart-tooltip-val">{Number(primaryV).toFixed(2)}</span>
                    </div>
                  )}
                  {avgV != null && (
                    <div className="chart-tooltip-row">
                      <span className="chart-tooltip-dot" style={{ background: '#64748b' }} />
                      <span className="chart-tooltip-name">Period avg</span>
                      <span className="chart-tooltip-val">{Number(avgV).toFixed(2)}</span>
                    </div>
                  )}
                  {delta != null && (
                    <div className="chart-tooltip-row">
                      <span className="chart-tooltip-dot" style={{ background: 'transparent' }} />
                      <span className="chart-tooltip-name">Delta</span>
                      <span className={`chart-tooltip-val chart-tooltip-delta${delta >= 0 ? ' pos' : ' neg'}`}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )
            }}
          />
          <Line type="stepAfter" dataKey="primaryPrice" stroke={COLORS.cyan}  dot={false} strokeWidth={2}   name="Today"      isAnimationActive={false} connectNulls={false} />
          <Line type="stepAfter" dataKey="avgPrice"     stroke="#475569"       dot={false} strokeWidth={1.5} name="Period avg" isAnimationActive={false} strokeDasharray="4 3" connectNulls={false} />
          {clearingPrice != null && (
            <ReferenceLine y={clearingPrice} stroke="#f59e0b" strokeDasharray="3 2" strokeWidth={1.5} label={{ value: 'clear', position: 'right', style: { fill: '#f59e0b', fontSize: 10 } }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* PTU Scrubber */}
      <div className="merit-scrubber-wrap">
        <div className="merit-scrubber">
          {Array.from({ length: 96 }, (_, i) => (
            <button
              key={i}
              className={`merit-ptu-slot${selectedPtu === i + 1 ? ' active' : ''}`}
              onClick={() => setSelectedPtu(i + 1)}
              title={`PTU ${i + 1} — ${ptuToTime(i + 1)}`}
            />
          ))}
        </div>
        <div className="merit-scrubber-labels">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
        <div style={{ textAlign: 'center', color: '#64748b', fontSize: 11, marginTop: 2 }}>
          PTU {selectedPtu} — {ptuToTime(selectedPtu)}
        </div>
      </div>
    </ChartWrap>
  )
}

// ── Section ─────────────────────────────────────────────────────────────────

export default function AncillaryServicesSection({
  afrr, frrActivations, errors,
  startDate, endDate, selectedRange,
  narrative, loading, onGenerate, isStale, generatedDates, lastGenerated,
  dataLoading, frrLoading,
  compareEnabled, compareData, compareDates,
  selectedMarkets, crossMarketData, marketColors,
}) {
  const [energyRes,   setEnergyRes]   = useState('1h')
  const [afrrCapRes,  setAfrrCapRes]  = useState('4h')
  const [fcrRes,      setFcrRes]      = useState('4h')

  const lgd0 = useLegendToggle()   // aFRR capacity chart
  const lgd1 = useLegendToggle()   // FCR chart
  const lgd2 = useLegendToggle()   // energy chart

  const inRangeTs  = ts => { const d = ts?.slice(0, 10); return (!startDate || d >= startDate) && (!endDate || d <= endDate) }
  const inPrevTs   = ts => { const d = ts?.slice(0, 10); return (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate) }

  // ── aFRR Capacity ─────────────────────────────────────────────────────────
  const rawAfrrCap     = (afrr?.afrrHourly     ?? []).filter(d => inRangeTs(d.timestamp))
  const prevRawAfrrCap = compareEnabled ? (compareData?.afrr?.afrrHourly ?? []).filter(d => inPrevTs(d.timestamp)) : []
  const afrrCapData     = afrrCapRes === '1d' ? aggregateAfrrCap1d(rawAfrrCap)     : rawAfrrCap
  const prevAfrrCapData = afrrCapRes === '1d' ? aggregateAfrrCap1d(prevRawAfrrCap) : prevRawAfrrCap
  const mergedAfrrCapacity = afrrCapData.map((d, i) => ({
    ...d,
    prevAfrrCapacityUpPrice:   prevAfrrCapData[i]?.afrrCapacityUpPrice,
    prevAfrrCapacityDownPrice: prevAfrrCapData[i]?.afrrCapacityDownPrice,
  }))

  // ── FCR ───────────────────────────────────────────────────────────────────
  const rawFcr     = (afrr?.fcrHourly  ?? []).filter(d => inRangeTs(d.timestamp))
  const prevRawFcr = compareEnabled ? (compareData?.afrr?.fcrHourly ?? []).filter(d => inPrevTs(d.timestamp)) : []
  const fcrData     = fcrRes === '1d' ? aggregateFcr1d(rawFcr)     : rawFcr
  const prevFcrData = fcrRes === '1d' ? aggregateFcr1d(prevRawFcr) : prevRawFcr

  // Cross-market FCR overlay — daily avg lookup by date
  const cmByDate = {}
  for (const zone of (selectedMarkets || [])) {
    const zd = crossMarketData?.[zone]
    if (!zd) continue
    for (const { date, avg: zAvg } of zd.dailyAvg ?? []) {
      if (!cmByDate[date]) cmByDate[date] = {}
      cmByDate[date][zone] = zAvg
    }
  }

  const mergedFcr = fcrData.map((d, i) => {
    const date = d.timestamp?.slice(0, 10)
    const cm = cmByDate[date] ?? {}
    return {
      ...d,
      prevPrice: prevFcrData[i]?.price ?? null,
      deAvg: cm.DE ?? null,
      beAvg: cm.BE ?? null,
      frAvg: cm.FR ?? null,
    }
  })

  // ── Energy (TenneT 15-min) + FRR activations ──────────────────────────────
  const rawEnergy      = (afrr?.afrrEnergyRaw ?? []).filter(d => inRangeTs(d.timestamp))
  const prevRawEnergy  = compareEnabled ? (compareData?.afrr?.afrrEnergyRaw ?? []).filter(d => inPrevTs(d.timestamp)) : []
  const rawFrrAct      = Array.isArray(frrActivations) ? frrActivations.filter(d => inRangeTs(d.timestamp)) : []

  const energyData     = aggregateEnergy(rawEnergy,    energyRes)
  const prevEnergyData = aggregateEnergy(prevRawEnergy, energyRes)
  const frrActData     = aggregateFrr(rawFrrAct, energyRes)

  // Merge energy + FRR activations by index (same resolution, same timestamp alignment)
  const frrActMap = {}
  for (const pt of frrActData) { frrActMap[pt.timestamp.slice(0, 13)] = pt }

  const mergedEnergy = energyData.map((d, i) => {
    const key = d.timestamp?.slice(0, 13)
    const frr = frrActMap[key]
    return {
      ...d,
      prevAfrrUpEnergyPrice:   prevEnergyData[i]?.afrrUpEnergyPrice,
      prevAfrrDownEnergyPrice: prevEnergyData[i]?.afrrDownEnergyPrice,
      activatedUpMw:   frr?.activatedUpMw   ?? null,
      activatedDownMw: frr?.activatedDownMw ?? null,
    }
  })

  const isMock    = !!errors?.afrr
  const isMockFrr = !!errors?.frrActivations

  const zoom0 = useZoom(mergedAfrrCapacity, 'timestamp')
  const zoom1 = useZoom(mergedFcr,          'timestamp')
  const zoom2 = useZoom(mergedEnergy,       'timestamp')

  const afrrCapControls = (
    <div className="range-selector chart-resolution-selector">
      {CAPACITY_RESOLUTIONS.map(r => (
        <button key={r.key} className={`range-option${afrrCapRes === r.key ? ' active' : ''}`}
          onClick={() => { setAfrrCapRes(r.key); zoom0.reset() }}>
          {r.label}
        </button>
      ))}
    </div>
  )

  const fcrControls = (
    <div className="range-selector chart-resolution-selector">
      {CAPACITY_RESOLUTIONS.map(r => (
        <button key={r.key} className={`range-option${fcrRes === r.key ? ' active' : ''}`}
          onClick={() => { setFcrRes(r.key); zoom1.reset() }}>
          {r.label}
        </button>
      ))}
    </div>
  )

  const energyResControls = (
    <div className="range-selector chart-resolution-selector">
      {ENERGY_RESOLUTIONS.map(r => (
        <button
          key={r.key}
          className={`range-option${energyRes === r.key ? ' active' : ''}`}
          onClick={() => { setEnergyRes(r.key); zoom2.reset() }}
        >
          {r.label}
        </button>
      ))}
    </div>
  )

  const hasFrrData = !isMockFrr && rawFrrAct.length > 0

  return (
    <section className="asset-section">
      <h2 className="section-title">Ancillary Services</h2>

      {/* ── aFRR Capacity ──────────────────────────────────────────────── */}
      <ChartWrap title="aFRR Capacity NL — Price & Volume" source="ENTSO-E" isMock={isMock} isLoading={dataLoading} controls={afrrCapControls} zoomed={zoom0.isZoomed} onReset={zoom0.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={zoom0.displayData} margin={{ top: 8, right: 12, left: 10, bottom: 4 }} {...zoom0.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtCapacityTs(v, afrrCapRes)} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={60} />
            {/* Capacity MW — outer left axis */}
            <YAxis yAxisId="cap"   orientation="left" width={52} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}MW`} />
            {/* Price EUR/MW/h — inner left axis (wider to avoid truncation) */}
            <YAxis yAxisId="price" orientation="left" width={65} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend {...lgd0.legendProps} />
            <Bar yAxisId="cap" dataKey="afrrCapacityUpMW"   fill={COLORS.green} fillOpacity={0.18} name="Up Capacity (MW)"   hide={lgd0.isHidden('Up Capacity (MW)')}   isAnimationActive={false} />
            <Bar yAxisId="cap" dataKey="afrrCapacityDownMW" fill={COLORS.amber} fillOpacity={0.18} name="Down Capacity (MW)" hide={lgd0.isHidden('Down Capacity (MW)')} isAnimationActive={false} />
            <Line yAxisId="price" type="stepAfter" dataKey="afrrCapacityUpPrice"   stroke={COLORS.green} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="aFRR Up Price (EUR/MW/h)"   hide={lgd0.isHidden('aFRR Up Price (EUR/MW/h)')}   isAnimationActive={false} />
            <Line yAxisId="price" type="stepAfter" dataKey="afrrCapacityDownPrice" stroke={COLORS.amber} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="aFRR Down Price (EUR/MW/h)" hide={lgd0.isHidden('aFRR Down Price (EUR/MW/h)')} isAnimationActive={false} />
            {compareEnabled && <Line yAxisId="price" type="stepAfter" dataKey="prevAfrrCapacityUpPrice"   stroke={COLORS.green} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Up"   hide={lgd0.isHidden('Prev. Up')}   isAnimationActive={false} />}
            {compareEnabled && <Line yAxisId="price" type="stepAfter" dataKey="prevAfrrCapacityDownPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Down" hide={lgd0.isHidden('Prev. Down')} isAnimationActive={false} />}
            {zoom0.refArea.left && zoom0.refArea.right && (
              <ReferenceArea yAxisId="price" x1={zoom0.refArea.left} x2={zoom0.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartWrap>

      {/* ── FCR Capacity ───────────────────────────────────────────────── */}
      <ChartWrap title="FCR Capacity NL — Price & Volume" source="ENTSO-E" isMock={isMock} isLoading={dataLoading} controls={fcrControls} zoomed={zoom1.isZoomed} onReset={zoom1.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={zoom1.displayData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} {...zoom1.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtCapacityTs(v, fcrRes)} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={60} />
            <YAxis yAxisId="cap"   orientation="left" width={42} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}MW`} />
            <YAxis yAxisId="price" orientation="left" width={45} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend {...lgd1.legendProps} />
            <Bar  yAxisId="cap"   dataKey="capacityMW" fill={COLORS.purple} fillOpacity={0.18} name="FCR Capacity (MW)"           hide={lgd1.isHidden('FCR Capacity (MW)')}           isAnimationActive={false} />
            <Line yAxisId="price" type="stepAfter" dataKey="price" stroke={COLORS.purple} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="FCR Clearing Price (EUR/MW/h)" hide={lgd1.isHidden('FCR Clearing Price (EUR/MW/h)')} isAnimationActive={false} />
            {compareEnabled && <Line yAxisId="price" type="stepAfter" dataKey="prevPrice" stroke={COLORS.purple} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" hide={lgd1.isHidden('Prev. period')} isAnimationActive={false} />}
            {/* Cross-market overlay on FCR price chart */}
            {(selectedMarkets || []).includes('DE') && crossMarketData?.DE && (
              <Line yAxisId="price" type="monotone" dataKey="deAvg" stroke={marketColors?.DE ?? '#fbbf24'} dot={false} strokeWidth={1.5} name="DE avg" hide={lgd1.isHidden('DE avg')} isAnimationActive={false} />
            )}
            {(selectedMarkets || []).includes('BE') && crossMarketData?.BE && (
              <Line yAxisId="price" type="monotone" dataKey="beAvg" stroke={marketColors?.BE ?? '#a78bfa'} dot={false} strokeWidth={1.5} name="BE avg" hide={lgd1.isHidden('BE avg')} isAnimationActive={false} />
            )}
            {(selectedMarkets || []).includes('FR') && crossMarketData?.FR && (
              <Line yAxisId="price" type="monotone" dataKey="frAvg" stroke={marketColors?.FR ?? '#fb7185'} dot={false} strokeWidth={1.5} name="FR avg" hide={lgd1.isHidden('FR avg')} isAnimationActive={false} />
            )}
            {zoom1.refArea.left && zoom1.refArea.right && (
              <ReferenceArea yAxisId="price" x1={zoom1.refArea.left} x2={zoom1.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartWrap>

      {/* ── aFRR Energy Price + FRR Activation Overlay ─────────────── */}
      <ChartWrap
        title="aFRR Energy Price NL — Up / Down (EUR/MWh)"
        source={hasFrrData ? 'TenneT (energy + FRR)' : 'TenneT'}
        isMock={isMock}
        isLoading={dataLoading}
        controls={energyResControls}
        zoomed={zoom2.isZoomed}
        onReset={zoom2.reset}
      >
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={zoom2.displayData} margin={{ top: 8, right: 12, left: 10, bottom: 4 }} {...zoom2.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtEnergyTs(v, energyRes)} tick={{ fill: '#94a3b8', fontSize: energyRes === '1d' || energyRes === '1w' ? 11 : 10 }} minTickGap={60} />
            {/* Activation MW — left axis */}
            {hasFrrData && <YAxis yAxisId="vol" orientation="left" width={52} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${Math.round(v)}MW`} />}
            {/* Energy price EUR/MWh — right axis (or main left if no FRR) */}
            <YAxis yAxisId="price" orientation={hasFrrData ? 'right' : 'left'} width={45} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip labelFormatter={v => fmtEnergyTs(v, energyRes)} />} />
            <Legend {...lgd2.legendProps} />
            {/* FRR activation volume bars */}
            {hasFrrData && <Bar yAxisId="vol" dataKey="activatedUpMw"   fill="#4ade80" fillOpacity={0.25} name="FRR Up (MW)"   hide={lgd2.isHidden('FRR Up (MW)')}   isAnimationActive={false} />}
            {hasFrrData && <Bar yAxisId="vol" dataKey="activatedDownMw" fill="#f87171" fillOpacity={0.25} name="FRR Down (MW)" hide={lgd2.isHidden('FRR Down (MW)')} isAnimationActive={false} />}
            {/* Energy price lines */}
            <Line yAxisId="price" type="monotone" dataKey="afrrUpEnergyPrice"   stroke={COLORS.green} dot={false} strokeWidth={2} name="aFRR Up Energy (EUR/MWh)"   hide={lgd2.isHidden('aFRR Up Energy (EUR/MWh)')}   isAnimationActive={false} />
            <Line yAxisId="price" type="monotone" dataKey="afrrDownEnergyPrice" stroke={COLORS.amber} dot={false} strokeWidth={2} name="aFRR Down Energy (EUR/MWh)" hide={lgd2.isHidden('aFRR Down Energy (EUR/MWh)')} isAnimationActive={false} />
            {compareEnabled && <Line yAxisId="price" type="monotone" dataKey="prevAfrrUpEnergyPrice"   stroke={COLORS.green} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Up"   hide={lgd2.isHidden('Prev. Up')}   isAnimationActive={false} />}
            {compareEnabled && <Line yAxisId="price" type="monotone" dataKey="prevAfrrDownEnergyPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Down" hide={lgd2.isHidden('Prev. Down')} isAnimationActive={false} />}
            {zoom2.refArea.left && zoom2.refArea.right && (
              <ReferenceArea yAxisId="price" x1={zoom2.refArea.left} x2={zoom2.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartWrap>

      {/* ── Merit Order Supply Curve ────────────────────────────────── */}
      <MeritOrderChart startDate={startDate} endDate={endDate} />

      <SummaryBlock text={narrative} loading={loading} onGenerate={onGenerate} isStale={isStale} generatedDates={generatedDates} lastGenerated={lastGenerated} />
    </section>
  )
}
