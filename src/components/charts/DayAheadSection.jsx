import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, legendStyle, fmtDate, ChartWrap, CompareTooltip } from './shared.jsx'

// ── Hourly price shape heatmap ─────────────────────────────────────────────

function buildHourlyShape(hourlyByDate) {
  if (!hourlyByDate) return []
  const totals = Array(24).fill(0)
  const counts = Array(24).fill(0)

  for (const dayPrices of Object.values(hourlyByDate)) {
    for (let h = 0; h < 24; h++) {
      const v = dayPrices[h] ?? dayPrices[String(h)]
      if (v != null && !isNaN(v)) {
        totals[h] += v
        counts[h]++
      }
    }
  }

  return Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}:00`,
    price: counts[h] ? totals[h] / counts[h] : null,
  }))
}

function barColor(price, min, max) {
  const t = Math.max(0, Math.min(1, (price - min) / (max - min || 1)))
  const r = Math.round(t < 0.5 ? t * 2 * 251 : 251 + (t - 0.5) * 2 * 4)
  const g = Math.round(t < 0.5 ? 191 - t * 2 * 67 : 124 - (t - 0.5) * 2 * 124)
  const b = Math.round(t < 0.5 ? 36 : 36 * (1 - (t - 0.5) * 2))
  return `rgb(${r},${g},${b})`
}

function HourlyShapeChart({ hourlyByDate }) {
  const data = buildHourlyShape(hourlyByDate)
  const prices = data.map(d => d.price).filter(v => v != null)
  const min = Math.min(...prices)
  const max = Math.max(...prices)

  return (
    <>
      <div className="hourly-shape">
        {data.map(({ hour, price }) => {
          const color = price != null ? barColor(price, min, max) : '#1e293b'
          const pct = price != null ? Math.max(0, Math.min(1, (price - min) / (max - min || 1))) : 0
          return (
            <div key={hour} className="hourly-bar-col" title={`${hour}: ${price != null ? price.toFixed(1) : 'N/A'} EUR/MWh`}>
              <div className="hourly-bar" style={{ height: `${20 + pct * 80}%`, background: color }} />
              <span className="hourly-label">{hour.slice(0, 2)}</span>
            </div>
          )
        })}
      </div>
      <div className="heatmap-legend">
        <span style={{ color: 'rgb(0,191,36)' }}>Low</span>
        <div className="heatmap-gradient" />
        <span style={{ color: 'rgb(255,0,0)' }}>High</span>
      </div>
    </>
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
function SummaryBlock({ text, loading, onGenerate, isStale, generatedDates }) {
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
    </div>
  )
}

// ── Section ────────────────────────────────────────────────────────────────

export default function DayAheadSection({ dayAhead, errors, startDate, endDate, narrative, loading, onGenerate, isStale, generatedDates, compareEnabled, compareData, compareDates }) {
  const inRange     = d => (!startDate              || d >= startDate)              && (!endDate              || d <= endDate)
  const inPrevRange = d => (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate)

  const dailyAvg     = (dayAhead?.dailyAvg ?? []).filter(d => inRange(d.date))
  const spreadData   = (dayAhead?.peakOffpeakSpread ?? []).filter(d => inRange(d.date))
  const negHoursData = (dayAhead?.negativeHoursPerWeek ?? []).filter(d => inRange(d.week))
  const hourlyByDate = dayAhead?.hourlyByDate
    ? Object.fromEntries(Object.entries(dayAhead.hourlyByDate).filter(([date]) => inRange(date)))
    : null
  const isMock = !!errors?.dayAhead

  const prevDailyAvg = compareEnabled ? (compareData?.dayAhead?.dailyAvg ?? []).filter(d => inPrevRange(d.date)) : []
  const prevSpread   = compareEnabled ? (compareData?.dayAhead?.peakOffpeakSpread ?? []).filter(d => inPrevRange(d.date)) : []
  const prevNegHours = compareEnabled ? (compareData?.dayAhead?.negativeHoursPerWeek ?? []).filter(d => inPrevRange(d.week)) : []

  const mergedAvg      = dailyAvg.map((d, i)     => ({ ...d, prevAvg:    prevDailyAvg[i]?.avg }))
  const mergedSpread   = spreadData.map((d, i)   => ({ ...d, prevSpread: prevSpread[i]?.spread }))
  const mergedNegHours = negHoursData.map((d, i) => ({ ...d, prevCount:  prevNegHours[i]?.count }))

  return (
    <section className="asset-section">
      <h2 className="section-title">Day-Ahead</h2>

      <ChartWrap title="Day-Ahead Price NL — Daily Average (EUR/MWh)" source="ENTSO-E" isMock={isMock}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={mergedAvg} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="monotone" dataKey="avg" stroke={COLORS.cyan} dot={false} strokeWidth={2} name="DA Price (EUR/MWh)" />
            {compareEnabled && <Line type="monotone" dataKey="prevAvg" stroke={COLORS.cyan} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" />}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="Day-Ahead Price Shape NL — Avg by Hour (EUR/MWh)" source="ENTSO-E" isMock={isMock}>
        <HourlyShapeChart hourlyByDate={hourlyByDate} />
      </ChartWrap>

      <ChartWrap title="Day-Ahead Spread NL — Peak minus Offpeak (EUR/MWh)" source="ENTSO-E" isMock={isMock}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={mergedSpread} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} />
            <Tooltip content={<CompareTooltip />} />
            <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" />
            <Legend wrapperStyle={legendStyle} />
            <Bar dataKey="spread" fill={COLORS.blue} name="Peak–Offpeak Spread (EUR/MWh)" radius={[2, 2, 0, 0]} />
            {compareEnabled && <Bar dataKey="prevSpread" fill={COLORS.blue} fillOpacity={0.35} name="Prev. period" radius={[2, 2, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="Negative Price Hours per Week NL" source="ENTSO-E" isMock={isMock}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={mergedNegHours} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="week" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={35} allowDecimals={false} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Bar dataKey="count" fill={COLORS.orange} name="Hours with negative DA price" radius={[2, 2, 0, 0]} />
            {compareEnabled && <Bar dataKey="prevCount" fill={COLORS.orange} fillOpacity={0.35} name="Prev. period" radius={[2, 2, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </ChartWrap>

      <SummaryBlock text={narrative} loading={loading} onGenerate={onGenerate} isStale={isStale} generatedDates={generatedDates} />
    </section>
  )
}
