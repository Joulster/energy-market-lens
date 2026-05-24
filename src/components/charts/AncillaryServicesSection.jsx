import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, legendStyle, fmtDate, ChartWrap, CompareTooltip } from './shared.jsx'

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

export default function AncillaryServicesSection({ afrr, errors, startDate, endDate, narrative, loading, onGenerate, isStale, generatedDates, compareEnabled, compareData, compareDates }) {
  const inRange     = d => (!startDate              || d >= startDate)              && (!endDate              || d <= endDate)
  const inPrevRange = d => (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate)

  const afrrData = (afrr?.daily ?? []).filter(d => inRange(d.date))
  const isMock   = !!errors?.afrr

  const prevAfrr   = compareEnabled ? (compareData?.afrr?.daily ?? []).filter(d => inPrevRange(d.date)) : []
  const mergedAfrr = afrrData.map((d, i) => ({
    ...d,
    prevAfrrCapacityPrice:  prevAfrr[i]?.afrrCapacityPrice,
    prevFcrPrice:           prevAfrr[i]?.fcrPrice,
    prevAfrrUpEnergyPrice:  prevAfrr[i]?.afrrUpEnergyPrice,
    prevAfrrDownEnergyPrice: prevAfrr[i]?.afrrDownEnergyPrice,
  }))

  return (
    <section className="asset-section">
      <h2 className="section-title">Ancillary Services</h2>

      <ChartWrap title="aFRR Capacity Price NL (EUR/MW/h)" source="ENTSO-E" isMock={isMock}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={mergedAfrr} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="monotone" dataKey="afrrCapacityPrice" stroke={COLORS.blue} dot={false} strokeWidth={2} name="aFRR Capacity Price (EUR/MW/h)" />
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrCapacityPrice" stroke={COLORS.blue} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" />}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="FCR Clearing Price NL (EUR/MW/h)" source="ENTSO-E" isMock={isMock}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={mergedAfrr} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="monotone" dataKey="fcrPrice" stroke={COLORS.purple} dot={false} strokeWidth={2} name="FCR Clearing Price (EUR/MW/h)" />
            {compareEnabled && <Line type="monotone" dataKey="prevFcrPrice" stroke={COLORS.purple} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" />}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="aFRR Energy Price NL — Up / Down (EUR/MWh)" source="ENTSO-E" isMock={isMock}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={mergedAfrr} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="monotone" dataKey="afrrUpEnergyPrice"   stroke={COLORS.green} dot={false} strokeWidth={2} name="aFRR Up Energy (EUR/MWh)" />
            <Line type="monotone" dataKey="afrrDownEnergyPrice" stroke={COLORS.amber} dot={false} strokeWidth={2} name="aFRR Down Energy (EUR/MWh)" />
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrUpEnergyPrice"   stroke={COLORS.green} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Up" />}
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrDownEnergyPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Down" />}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <SummaryBlock text={narrative} loading={loading} onGenerate={onGenerate} isStale={isStale} generatedDates={generatedDates} />
    </section>
  )
}
