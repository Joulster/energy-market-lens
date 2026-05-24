import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, legendStyle, fmtDate, ChartWrap, CompareTooltip } from './shared.jsx'

function buildWeeklyStdDev(imbalanceDaily) {
  if (!imbalanceDaily?.length) return []
  const byWeek = {}
  for (const { date, midPrice } of imbalanceDaily) {
    if (midPrice == null) continue
    const d = new Date(date)
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay())
    const key = weekStart.toISOString().slice(0, 10)
    if (!byWeek[key]) byWeek[key] = []
    byWeek[key].push(midPrice)
  }
  return Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, prices]) => {
      const mean = prices.reduce((s, v) => s + v, 0) / prices.length
      const variance = prices.reduce((s, v) => s + (v - mean) ** 2, 0) / prices.length
      return { week, stdDev: Math.sqrt(variance) }
    })
}

function fmtRangeDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

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

export default function BalancingSection({ imbalance, errors, startDate, endDate, narrative, loading, onGenerate, isStale, generatedDates, compareEnabled, compareData, compareDates }) {
  const inRange     = d => (!startDate              || d >= startDate)              && (!endDate              || d <= endDate)
  const inPrevRange = d => (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate)

  const imbalanceData    = (imbalance?.daily ?? []).filter(d => inRange(d.date))
  const weeklyStdDev     = buildWeeklyStdDev(imbalanceData)
  const isMock           = !!errors?.imbalance

  const prevImbalance    = compareEnabled ? (compareData?.imbalance?.daily ?? []).filter(d => inPrevRange(d.date)) : []
  const prevWeeklyStdDev = compareEnabled ? buildWeeklyStdDev(prevImbalance) : []

  const mergedImbalance  = imbalanceData.map((d, i)  => ({ ...d, prevMidPrice: prevImbalance[i]?.midPrice }))
  const mergedStdDev     = weeklyStdDev.map((d, i)   => ({ ...d, prevStdDev:   prevWeeklyStdDev[i]?.stdDev }))

  return (
    <section className="asset-section">
      <h2 className="section-title">Balancing</h2>

      <ChartWrap title="Imbalance Midprice NL (EUR/MWh)" source="TenneT" isMock={isMock}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={mergedImbalance} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="monotone" dataKey="midPrice" stroke={COLORS.amber} dot={false} strokeWidth={2} name="Imbalance Mid Price (EUR/MWh)" />
            {compareEnabled && <Line type="monotone" dataKey="prevMidPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" />}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="Imbalance Price Volatility — Std Dev per Week (EUR/MWh)" source="TenneT" isMock={isMock}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={mergedStdDev} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="week" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Bar dataKey="stdDev" fill={COLORS.purple} name="Weekly std dev of imbalance price (EUR/MWh)" radius={[2, 2, 0, 0]} />
            {compareEnabled && <Bar dataKey="prevStdDev" fill={COLORS.purple} fillOpacity={0.35} name="Prev. period" radius={[2, 2, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </ChartWrap>

      <SummaryBlock text={narrative} loading={loading} onGenerate={onGenerate} isStale={isStale} generatedDates={generatedDates} />
    </section>
  )
}
