import { useState } from 'react'
import {
  ComposedChart, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, legendStyle, fmtDate, ChartWrap, CompareTooltip, useLegendToggle } from './shared.jsx'
import { useZoom } from './useZoom.js'

// Format a UTC ISO string as a short CET date+time label
function fmtCetDateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Amsterdam',
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
}

function fmtCetDateTimeShort(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Amsterdam',
    month: 'short', day: 'numeric',
    hour: '2-digit',
    hour12: false,
  })
}

function RawPriceTooltip({ active, payload, label, resolution }) {
  if (!active || !payload?.length) return null
  const d     = payload[0]?.payload
  const price = d?.price
  const prev  = d?.prevPrice
  const delta = price != null && prev != null ? price - prev : null
  const fmtLabel = label ? (resolution === '1d' ? fmtDate(label) : fmtCetDateTime(label)) : ''
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{fmtLabel}</p>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-dot" style={{ background: COLORS.cyan }} />
        <span className="chart-tooltip-name">DA Price</span>
        <span className="chart-tooltip-val">{price != null ? Number(price).toFixed(2) : '—'}</span>
        {delta != null && (
          <span className={`chart-tooltip-delta${delta >= 0 ? ' pos' : ' neg'}`}>
            {delta > 0 ? '+' : ''}{delta.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  )
}

// ISO week number → "W20"
function fmtWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return `W${weekNo}`
}

// ── Resolution switcher helpers ────────────────────────────────────────────

const RESOLUTIONS = [
  { key: '15m', label: '15m' },
  { key: '1h',  label: '1h'  },
  { key: '1d',  label: '1d'  },
]

const AMS = 'Europe/Amsterdam'

function toAmsDate(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: AMS })
}
function toAmsHour(ts) {
  return parseInt(new Date(ts).toLocaleString('en-GB', { timeZone: AMS, hour: '2-digit', hour12: false }), 10)
}

function aggregateHLA_1h(rawPoints) {
  const buckets = {}
  for (const { ts, price } of rawPoints) {
    const key = `${toAmsDate(ts)}|${toAmsHour(ts)}`
    if (!buckets[key]) buckets[key] = { ts, prices: [] }
    buckets[key].prices.push(price)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { ts, prices }]) => ({
      ts,
      avg:  prices.reduce((s, p) => s + p, 0) / prices.length,
      high: Math.max(...prices),
      low:  Math.min(...prices),
    }))
}

function aggregateHLA_1d(rawPoints) {
  const buckets = {}
  for (const { ts, price } of rawPoints) {
    const date = toAmsDate(ts)
    if (!buckets[date]) buckets[date] = []
    buckets[date].push(price)
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) => ({
      ts: date,
      avg:  prices.reduce((s, p) => s + p, 0) / prices.length,
      high: Math.max(...prices),
      low:  Math.min(...prices),
    }))
}

// ── Range bar chart (High / Avg / Low) ────────────────────────────────────

// Custom Bar shape: thin range bar low→high, bright tick at average.
// Recharts positions y=pixel(high), y+height=pixel(low) via range dataKey.
function HLABar({ x, y, width, height, high, low, avg }) {
  if (!height || high === low) return null
  const avgPx  = y + height * (high - avg) / (high - low)
  const midX   = x + width / 2
  const barW   = Math.max(width * 0.25, 1.5)
  const tickW  = Math.max(width * 0.85, 3)
  return (
    <g>
      {/* Low-to-high range spine */}
      <rect x={midX - barW / 2} y={y} width={barW} height={height} fill="#1e3a5f" rx={1} />
      {/* High cap */}
      <rect x={x + (width - tickW) / 2} y={y} width={tickW} height={2} fill="#7dd3fc" rx={1} />
      {/* Low cap */}
      <rect x={x + (width - tickW) / 2} y={y + height - 2} width={tickW} height={2} fill="#475569" rx={1} />
      {/* Average tick */}
      <rect x={x + (width - tickW) / 2} y={avgPx - 1.5} width={tickW} height={3} fill={COLORS.cyan} rx={1} />
    </g>
  )
}

function HLATooltip({ active, payload, label, resolution }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const fmtLabel = label ? (resolution === '1d' ? fmtDate(label) : fmtCetDateTime(label)) : ''
  const rows = [
    { name: 'High', val: d.high, prev: d.prevHigh, color: '#7dd3fc' },
    { name: 'Avg',  val: d.avg,  prev: d.prevAvg,  color: COLORS.cyan },
    { name: 'Low',  val: d.low,  prev: d.prevLow,  color: '#64748b' },
  ]
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{fmtLabel}</p>
      {rows.map(({ name, val, prev, color }) => {
        const delta = val != null && prev != null ? val - prev : null
        return (
          <div key={name} className="chart-tooltip-row">
            <span className="chart-tooltip-dot" style={{ background: color }} />
            <span className="chart-tooltip-name">{name}</span>
            <span className="chart-tooltip-val">{val != null ? Number(val).toFixed(2) : '—'}</span>
            {delta != null && (
              <span className={`chart-tooltip-delta${delta >= 0 ? ' pos' : ' neg'}`}>
                {delta > 0 ? '+' : ''}{delta.toFixed(2)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── AI Summary block ────────────────────────────────────────────────────────

function fmtRangeDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// text === undefined  → not yet generated
// text === null       → Claude returned null (data unavailable)
// text === string     → show the text
// isStale             → dates have changed since generation; show amber warning
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

// ── Section ────────────────────────────────────────────────────────────────

export default function DayAheadSection({ dayAhead, errors, startDate, endDate, narrative, loading, onGenerate, isStale, generatedDates, lastGenerated, dataLoading, compareEnabled, compareData, compareDates }) {
  const [resolution, setResolution] = useState('15m')

  const lgd0 = useLegendToggle()   // Day-Ahead price chart
  const lgd1 = useLegendToggle()   // Negative hours chart

  const inRange     = d => (!startDate              || d >= startDate)              && (!endDate              || d <= endDate)
  const inPrevRange = d => (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate)

  const rawPoints = (dayAhead?.rawPoints ?? []).filter(p => {
    const d = p.ts?.slice(0, 10)
    return inRange(d)
  }).map(p => ({ ts: p.ts, price: p.price }))

  const isCandlestick = resolution !== '15m'

  const chartData = resolution === '15m' ? rawPoints
    : resolution === '1h' ? aggregateHLA_1h(rawPoints)
    : aggregateHLA_1d(rawPoints)

  const prevRawPoints = compareEnabled
    ? (compareData?.dayAhead?.rawPoints ?? []).filter(p => {
        const d = p.ts?.slice(0, 10)
        return inPrevRange(d)
      }).map(p => ({ ts: p.ts, price: p.price }))
    : []

  const prevChartData = compareEnabled
    ? (resolution === '15m' ? prevRawPoints
      : resolution === '1h' ? aggregateHLA_1h(prevRawPoints)
      : aggregateHLA_1d(prevRawPoints))
    : []

  // 15m: merge prevPrice for line compare; 1h/1d: merge prevHigh/Avg/Low for range bar compare
  const mergedChartData = resolution === '15m'
    ? chartData.map((d, i) => ({ ...d, prevPrice: prevChartData[i]?.price }))
    : chartData.map((d, i) => ({
        ...d,
        prevHigh: prevChartData[i]?.high,
        prevAvg:  prevChartData[i]?.avg,
        prevLow:  prevChartData[i]?.low,
      }))

  // Y-axis domain for HLA bars — covers current high/low range + prev avg when compare is on
  const hlaDomain = (() => {
    if (!isCandlestick || !chartData.length) return ['auto', 'auto']
    const lows    = chartData.map(d => d.low).filter(v => v != null)
    const highs   = chartData.map(d => d.high).filter(v => v != null)
    const prevAvgs = compareEnabled ? prevChartData.map(d => d.avg).filter(v => v != null) : []
    const minV  = Math.min(...lows,  ...prevAvgs)
    const maxV  = Math.max(...highs, ...prevAvgs)
    const pad   = (maxV - minV) * 0.06
    return [minV - pad, maxV + pad]
  })()

  const tickFmt = resolution === '1d' ? fmtDate : fmtCetDateTimeShort

  const negHoursData = (dayAhead?.negativeHoursPerWeek ?? []).filter(d => inRange(d.week))
  const isMock = !!errors?.dayAhead

  const prevNegHours = compareEnabled ? (compareData?.dayAhead?.negativeHoursPerWeek ?? []).filter(d => inPrevRange(d.week)) : []

  const mergedNegHours = negHoursData.map((d, i) => ({ ...d, prevCount: prevNegHours[i]?.count }))

  const zoom0 = useZoom(mergedChartData, 'ts')
  const zoom1 = useZoom(mergedNegHours, 'week')

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
      <h2 className="section-title">Day-Ahead</h2>

      <ChartWrap title="Day-Ahead Price NL (EUR/MWh)" source="ENTSO-E" isMock={isMock} isLoading={dataLoading} error={errors?.dayAhead} controls={resolutionControls} zoomed={zoom0.isZoomed} onReset={zoom0.reset}>
        <ResponsiveContainer width="100%" height={220}>
          {isCandlestick ? (
            <ComposedChart data={zoom0.displayData} {...chartProps} {...zoom0.handlers} barCategoryGap="1%" style={{ cursor: 'crosshair', userSelect: 'none' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="ts" tickFormatter={tickFmt} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={60} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} domain={hlaDomain} tickFormatter={v => Number(v).toFixed(2)} />
              <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" />
              <Tooltip content={<HLATooltip resolution={resolution} />} />
              <Legend {...lgd0.legendProps} />
              <Bar dataKey={d => [d.low, d.high]} shape={<HLABar />} isAnimationActive={false} name="DA Price H/L/Avg" hide={lgd0.isHidden('DA Price H/L/Avg')} />
              {compareEnabled && <Line type="monotone" dataKey="prevAvg" stroke={COLORS.cyan} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Previous period avg" hide={lgd0.isHidden('Previous period avg')} isAnimationActive={false} />}
              {zoom0.refArea.left && zoom0.refArea.right && (
                <ReferenceArea x1={zoom0.refArea.left} x2={zoom0.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
              )}
            </ComposedChart>
          ) : (
            <LineChart data={zoom0.displayData} {...chartProps} {...zoom0.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="ts" tickFormatter={fmtCetDateTimeShort} tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={60} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} domain={['auto', 'auto']} tickFormatter={v => Number(v).toFixed(2)} />
              <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" />
              <Tooltip content={<RawPriceTooltip resolution={resolution} />} />
              <Legend {...lgd0.legendProps} />
              <Line type="monotone" dataKey="price" stroke={COLORS.cyan} dot={false} strokeWidth={1.5} name="DA Price (EUR/MWh)" hide={lgd0.isHidden('DA Price (EUR/MWh)')} isAnimationActive={false} />
              {compareEnabled && <Line type="monotone" dataKey="prevPrice" stroke={COLORS.cyan} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" hide={lgd0.isHidden('Prev. period')} isAnimationActive={false} />}
              {zoom0.refArea.left && zoom0.refArea.right && (
                <ReferenceArea x1={zoom0.refArea.left} x2={zoom0.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
              )}
            </LineChart>
          )}
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="Negative Price Hours per Week NL" source="ENTSO-E" isMock={isMock} isLoading={dataLoading} error={errors?.dayAhead} zoomed={zoom1.isZoomed} onReset={zoom1.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={zoom1.displayData} {...chartProps} {...zoom1.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="week" tickFormatter={fmtWeek} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={35} allowDecimals={false} />
            <Tooltip content={<CompareTooltip />} labelFormatter={fmtWeek} />
            <Legend {...lgd1.legendProps} />
            <Bar dataKey="count" fill={COLORS.orange} name="Hours with negative DA price" hide={lgd1.isHidden('Hours with negative DA price')} radius={[2, 2, 0, 0]} />
            {compareEnabled && <Bar dataKey="prevCount" fill={COLORS.orange} fillOpacity={0.35} name="Prev. period" hide={lgd1.isHidden('Prev. period')} radius={[2, 2, 0, 0]} />}
            {zoom1.refArea.left && zoom1.refArea.right && (
              <ReferenceArea x1={zoom1.refArea.left} x2={zoom1.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </ChartWrap>

      <SummaryBlock text={narrative} loading={loading} onGenerate={onGenerate} isStale={isStale} generatedDates={generatedDates} lastGenerated={lastGenerated} />
    </section>
  )
}
