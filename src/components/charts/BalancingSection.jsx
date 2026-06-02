import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, legendStyle, fmtDate, ChartWrap, CompareTooltip, useLegendToggle } from './shared.jsx'
import { useZoom } from './useZoom.js'

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

export default function BalancingSection({ imbalance, errors, startDate, endDate, narrative, loading, onGenerate, isStale, generatedDates, lastGenerated, dataLoading, compareEnabled, compareData, compareDates }) {
  const inRange     = d => (!startDate              || d >= startDate)              && (!endDate              || d <= endDate)
  const inPrevRange = d => (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate)

  const imbalanceData    = (imbalance?.daily ?? []).filter(d => inRange(d.date))
  const weeklyStdDev     = buildWeeklyStdDev(imbalanceData)
  const isMock           = !!errors?.imbalance

  const prevImbalance    = compareEnabled ? (compareData?.imbalance?.daily ?? []).filter(d => inPrevRange(d.date)) : []
  const prevWeeklyStdDev = compareEnabled ? buildWeeklyStdDev(prevImbalance) : []

  const mergedImbalance  = imbalanceData.map((d, i)  => ({ ...d, prevMidPrice: prevImbalance[i]?.midPrice }))
  const mergedStdDev     = weeklyStdDev.map((d, i)   => ({ ...d, prevStdDev:   prevWeeklyStdDev[i]?.stdDev }))

  const lgd0 = useLegendToggle()   // imbalance midprice chart
  const lgd1 = useLegendToggle()   // std dev chart

  const zoom0 = useZoom(mergedImbalance, 'date')
  const zoom1 = useZoom(mergedStdDev, 'week')

  return (
    <section className="asset-section">
      <h2 className="section-title">Balancing</h2>

      <ChartWrap title="Imbalance Midprice NL (EUR/MWh)" source="TenneT" isMock={isMock} isLoading={dataLoading} zoomed={zoom0.isZoomed} onReset={zoom0.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={zoom0.displayData} {...chartProps} {...zoom0.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend {...lgd0.legendProps} />
            <Line type="monotone" dataKey="midPrice" stroke={COLORS.amber} dot={false} strokeWidth={2} name="Imbalance Mid Price (EUR/MWh)" hide={lgd0.isHidden('Imbalance Mid Price (EUR/MWh)')} />
            {compareEnabled && <Line type="monotone" dataKey="prevMidPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" hide={lgd0.isHidden('Prev. period')} />}
            {zoom0.refArea.left && zoom0.refArea.right && (
              <ReferenceArea x1={zoom0.refArea.left} x2={zoom0.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="Imbalance Price Volatility — Std Dev per Week (EUR/MWh)" source="TenneT" isMock={isMock} isLoading={dataLoading} zoomed={zoom1.isZoomed} onReset={zoom1.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={zoom1.displayData} {...chartProps} {...zoom1.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="week" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend {...lgd1.legendProps} />
            <Bar dataKey="stdDev" fill={COLORS.purple} name="Weekly std dev of imbalance price (EUR/MWh)" hide={lgd1.isHidden('Weekly std dev of imbalance price (EUR/MWh)')} radius={[2, 2, 0, 0]} />
            {compareEnabled && <Bar dataKey="prevStdDev" fill={COLORS.purple} fillOpacity={0.35} name="Prev. period" hide={lgd1.isHidden('Prev. period')} radius={[2, 2, 0, 0]} />}
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
