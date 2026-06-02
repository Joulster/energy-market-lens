import { useState } from 'react'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, fmtDate, ChartWrap, CompareTooltip, useLegendToggle } from './shared.jsx'
import { useZoom } from './useZoom.js'

// ── Resolution helpers ──────────────────────────────────────────────────────

const RESOLUTIONS = [
  { key: '1h', label: '1h' },
  { key: '1d', label: '1d' },
]

// Group 15-min TenneT points into hourly averages.
// Timestamps are CET local strings: "2026-01-01T00:15:00"
function aggregateImbalance1h(rawPoints) {
  const buckets = {}
  for (const pt of rawPoints) {
    const key = pt.timestamp.slice(0, 13)  // "YYYY-MM-DDTHH"
    if (!buckets[key]) buckets[key] = { timestamp: pt.timestamp, prices: [] }
    buckets[key].prices.push(pt.midPrice)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { timestamp, prices }]) => ({
      timestamp,
      midPrice: prices.reduce((s, v) => s + v, 0) / prices.length,
    }))
}

function fmtImbalanceTs(v, resolution) {
  if (!v) return ''
  if (resolution === '1d') return fmtDate(v.slice(0, 10))
  const date = v.slice(0, 10)
  const hour = v.slice(11, 13)
  return `${fmtDate(date)} ${hour}h`
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

// ── Section ─────────────────────────────────────────────────────────────────

export default function BalancingSection({ imbalance, errors, startDate, endDate, narrative, loading, onGenerate, isStale, generatedDates, lastGenerated, dataLoading, compareEnabled, compareData, compareDates }) {
  const [resolution, setResolution] = useState('1d')

  const inRange     = d => (!startDate              || d >= startDate)              && (!endDate              || d <= endDate)
  const inPrevRange = d => (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate)

  // 1d — use pre-aggregated daily data, normalise key to 'timestamp'
  const dailyData = (imbalance?.daily ?? [])
    .filter(d => inRange(d.date))
    .map(d => ({ timestamp: d.date, midPrice: d.midPrice }))
  const prevDailyData = compareEnabled
    ? (compareData?.imbalance?.daily ?? [])
        .filter(d => inPrevRange(d.date))
        .map(d => ({ timestamp: d.date, midPrice: d.midPrice }))
    : []

  // 1h — aggregate raw 15-min points on the frontend
  const rawPoints = (imbalance?.rawPoints ?? []).filter(d => inRange(d.timestamp?.slice(0, 10)))
  const prevRawPoints = compareEnabled
    ? (compareData?.imbalance?.rawPoints ?? []).filter(d => inPrevRange(d.timestamp?.slice(0, 10)))
    : []
  const hourlyData     = aggregateImbalance1h(rawPoints)
  const prevHourlyData = compareEnabled ? aggregateImbalance1h(prevRawPoints) : []

  const chartData     = resolution === '1h' ? hourlyData     : dailyData
  const prevChartData = resolution === '1h' ? prevHourlyData : prevDailyData

  const mergedImbalance = chartData.map((d, i) => ({
    ...d,
    prevMidPrice: prevChartData[i]?.midPrice,
  }))

  const isMock = !!errors?.imbalance

  const lgd0 = useLegendToggle()
  const zoom0 = useZoom(mergedImbalance, 'timestamp')

  const resolutionControls = (
    <div className="range-selector chart-resolution-selector">
      {RESOLUTIONS.map(r => (
        <button
          key={r.key}
          className={`range-option${resolution === r.key ? ' active' : ''}`}
          onClick={() => { setResolution(r.key); zoom0.reset() }}
        >
          {r.label}
        </button>
      ))}
    </div>
  )

  return (
    <section className="asset-section">
      <h2 className="section-title">Balancing</h2>

      <ChartWrap title="Imbalance Midprice NL (EUR/MWh)" source="TenneT" isMock={isMock} isLoading={dataLoading} controls={resolutionControls} zoomed={zoom0.isZoomed} onReset={zoom0.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={zoom0.displayData} {...chartProps} {...zoom0.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtImbalanceTs(v, resolution)} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={60} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} tickFormatter={v => Number(v).toFixed(2)} />
            <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" />
            <Tooltip content={<CompareTooltip />} />
            <Legend {...lgd0.legendProps} />
            <Line type="monotone" dataKey="midPrice" stroke={COLORS.amber} dot={false} strokeWidth={2} name="Imbalance Mid Price (EUR/MWh)" hide={lgd0.isHidden('Imbalance Mid Price (EUR/MWh)')} isAnimationActive={false} />
            {compareEnabled && <Line type="monotone" dataKey="prevMidPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" hide={lgd0.isHidden('Prev. period')} isAnimationActive={false} />}
            {zoom0.refArea.left && zoom0.refArea.right && (
              <ReferenceArea x1={zoom0.refArea.left} x2={zoom0.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <SummaryBlock text={narrative} loading={loading} onGenerate={onGenerate} isStale={isStale} generatedDates={generatedDates} lastGenerated={lastGenerated} />
    </section>
  )
}
