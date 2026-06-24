import { useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, Cell,
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

const DELTA_RESOLUTIONS = [
  { key: '15m', label: '15m' },
  { key: '1h',  label: '1h'  },
]

// Group 15-min TenneT points into hourly averages.
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

// Aggregate balance delta 15-min points to hourly averages
function aggregateDelta1h(rawPoints) {
  const buckets = {}
  for (const pt of rawPoints) {
    const key = pt.timestamp.slice(0, 13)
    if (!buckets[key]) buckets[key] = { timestamp: pt.timestamp, vals: [] }
    buckets[key].vals.push(pt.balanceDelta)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { timestamp, vals }]) => ({
      timestamp,
      balanceDelta: vals.reduce((s, v) => s + v, 0) / vals.length,
    }))
}

function fmtImbalanceTs(v, resolution) {
  if (!v) return ''
  if (resolution === '1d') return fmtDate(v.slice(0, 10))
  const date = v.slice(0, 10)
  const hour = v.slice(11, 13)
  return `${fmtDate(date)} ${hour}h`
}

function fmtDeltaTs(v, resolution) {
  if (!v) return ''
  if (resolution === '15m') {
    const date = v.slice(0, 10)
    const time = v.slice(11, 16)
    return `${fmtDate(date)} ${time}`
  }
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

export default function BalancingSection({
  imbalance, balanceDelta, errors,
  startDate, endDate,
  narrative, loading, onGenerate, isStale, generatedDates, lastGenerated,
  dataLoading, balanceDeltaLoading,
  compareEnabled, compareData, compareDates,
}) {
  const [resolution,  setResolution]  = useState('1d')
  const [deltaRes,    setDeltaRes]    = useState('15m')

  const inRange     = d => (!startDate              || d >= startDate)              && (!endDate              || d <= endDate)
  const inPrevRange = d => (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate)

  // ── Imbalance midprice ────────────────────────────────────────────────────
  const dailyData = (imbalance?.daily ?? [])
    .filter(d => inRange(d.date))
    .map(d => ({ timestamp: d.date, midPrice: d.midPrice }))
  const prevDailyData = compareEnabled
    ? (compareData?.imbalance?.daily ?? [])
        .filter(d => inPrevRange(d.date))
        .map(d => ({ timestamp: d.date, midPrice: d.midPrice }))
    : []

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

  // ── Balance delta ─────────────────────────────────────────────────────────
  const rawDeltaPoints = Array.isArray(balanceDelta)
    ? balanceDelta.filter(d => inRange(d.timestamp?.slice(0, 10)))
    : []
  const deltaData = deltaRes === '1h'
    ? aggregateDelta1h(rawDeltaPoints)
    : rawDeltaPoints

  const isMock      = !!errors?.imbalance
  const isMockDelta = !!errors?.balanceDelta

  const lgd0 = useLegendToggle()
  const lgd1 = useLegendToggle()
  const zoom0 = useZoom(mergedImbalance, 'timestamp')
  const zoom1 = useZoom(deltaData,       'timestamp')

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

  const deltaResControls = (
    <div className="range-selector chart-resolution-selector">
      {DELTA_RESOLUTIONS.map(r => (
        <button
          key={r.key}
          className={`range-option${deltaRes === r.key ? ' active' : ''}`}
          onClick={() => { setDeltaRes(r.key); zoom1.reset() }}
        >
          {r.label}
        </button>
      ))}
    </div>
  )

  return (
    <section className="asset-section">
      <h2 className="section-title">Balancing</h2>

      {/* ── Imbalance Midprice ───────────────────────────────────────── */}
      <ChartWrap title="Imbalance Midprice NL (EUR/MWh)" source="TenneT" isMock={isMock} isLoading={dataLoading} controls={resolutionControls} zoomed={zoom0.isZoomed} onReset={zoom0.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={zoom0.displayData} {...chartProps} {...zoom0.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DDDDDD" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtImbalanceTs(v, resolution)} tick={{ fill: '#5A5A5A', fontSize: 11, fontFamily: 'var(--font-mono)' }} minTickGap={60} />
            <YAxis tick={{ fill: '#5A5A5A', fontSize: 11, fontFamily: 'var(--font-mono)' }} width={45} tickFormatter={v => Number(v).toFixed(2)} />
            <ReferenceLine y={0} stroke={COLORS.brick} strokeDasharray="4 2" />
            <Tooltip content={<CompareTooltip />} />
            <Legend {...lgd0.legendProps} />
            <Line type="monotone" dataKey="midPrice" stroke={COLORS.black} dot={false} strokeWidth={2} name="Imbalance Mid Price (EUR/MWh)" hide={lgd0.isHidden('Imbalance Mid Price (EUR/MWh)')} isAnimationActive={false} />
            {compareEnabled && <Line type="monotone" dataKey="prevMidPrice" stroke={COLORS.textMuted} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.6} name="Prev. period" hide={lgd0.isHidden('Prev. period')} isAnimationActive={false} />}
            {zoom0.refArea.left && zoom0.refArea.right && (
              <ReferenceArea x1={zoom0.refArea.left} x2={zoom0.refArea.right} fill={COLORS.textMuted} fillOpacity={0.1} stroke={COLORS.textMuted} strokeOpacity={0.4} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      {/* ── System Balance Delta ─────────────────────────────────────── */}
      <ChartWrap title="System Balance Delta NL (MW)" source="TenneT" isMock={isMockDelta} isLoading={balanceDeltaLoading} controls={deltaResControls} zoomed={zoom1.isZoomed} onReset={zoom1.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={zoom1.displayData} {...chartProps} {...zoom1.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }} barCategoryGap="1%">
            <CartesianGrid strokeDasharray="3 3" stroke="#DDDDDD" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtDeltaTs(v, deltaRes)} tick={{ fill: '#5A5A5A', fontSize: 11, fontFamily: 'var(--font-mono)' }} minTickGap={60} />
            <YAxis tick={{ fill: '#5A5A5A', fontSize: 11, fontFamily: 'var(--font-mono)' }} width={52} tickFormatter={v => Math.round(v)} />
            <ReferenceLine y={0} stroke={COLORS.brick} strokeDasharray="4 2" strokeWidth={1.5} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const val = payload[0]?.value
                return (
                  <div className="chart-tooltip">
                    <p className="chart-tooltip-label">{fmtDeltaTs(label, deltaRes)}</p>
                    <div className="chart-tooltip-row">
                      <span className="chart-tooltip-dot" style={{ background: val >= 0 ? COLORS.teal : COLORS.brick }} />
                      <span className="chart-tooltip-name">Balance Delta</span>
                      <span className="chart-tooltip-val">{val != null ? `${val > 0 ? '+' : ''}${Math.round(val)} MW` : '—'}</span>
                    </div>
                  </div>
                )
              }}
            />
            <Legend {...lgd1.legendProps} />
            <Bar
              dataKey="balanceDelta"
              name="Balance Delta (MW)"
              hide={lgd1.isHidden('Balance Delta (MW)')}
              isAnimationActive={false}
              radius={[1, 1, 0, 0]}
            >
              {(zoom1.displayData || []).map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.balanceDelta >= 0 ? `${COLORS.teal}66` : `${COLORS.brick}66`}
                  stroke={entry.balanceDelta >= 0 ? COLORS.teal : COLORS.brick}
                  strokeWidth={0.5}
                />
              ))}
            </Bar>
            {zoom1.refArea.left && zoom1.refArea.right && (
              <ReferenceArea x1={zoom1.refArea.left} x2={zoom1.refArea.right} fill={COLORS.textMuted} fillOpacity={0.1} stroke={COLORS.textMuted} strokeOpacity={0.4} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </ChartWrap>

      <SummaryBlock text={narrative} loading={loading} onGenerate={onGenerate} isStale={isStale} generatedDates={generatedDates} lastGenerated={lastGenerated} />
    </section>
  )
}
