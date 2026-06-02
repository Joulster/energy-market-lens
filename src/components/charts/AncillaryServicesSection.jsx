import {
  LineChart, Line, ReferenceArea,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, legendStyle, fmtDate, ChartWrap, CompareTooltip } from './shared.jsx'
import { useZoom } from './useZoom.js'

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

export default function AncillaryServicesSection({ afrr, errors, startDate, endDate, narrative, loading, onGenerate, isStale, generatedDates, lastGenerated, dataLoading, compareEnabled, compareData, compareDates }) {
  const inRange     = d => (!startDate              || d >= startDate)              && (!endDate              || d <= endDate)
  const inPrevRange = d => (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate)

  const afrrData   = (afrr?.daily    ?? []).filter(d => inRange(d.date))
  const fcrHourly  = (afrr?.fcrHourly ?? []).filter(d => {
    const date = d.timestamp?.slice(0, 10)
    return (!startDate || date >= startDate) && (!endDate || date <= endDate)
  })
  const isMock = !!errors?.afrr

  const prevAfrr   = compareEnabled ? (compareData?.afrr?.daily ?? []).filter(d => inPrevRange(d.date)) : []
  const mergedAfrr = afrrData.map((d, i) => ({
    ...d,
    prevAfrrCapacityUpPrice:   prevAfrr[i]?.afrrCapacityUpPrice,
    prevAfrrCapacityDownPrice: prevAfrr[i]?.afrrCapacityDownPrice,
    prevAfrrUpEnergyPrice:     prevAfrr[i]?.afrrUpEnergyPrice,
    prevAfrrDownEnergyPrice:   prevAfrr[i]?.afrrDownEnergyPrice,
  }))

  // FCR compare: align previous period by index
  const prevFcrHourly = compareEnabled ? (compareData?.afrr?.fcrHourly ?? []).filter(d => {
    const date = d.timestamp?.slice(0, 10)
    return (!compareDates?.startDate || date >= compareDates.startDate) && (!compareDates?.endDate || date <= compareDates.endDate)
  }) : []
  const mergedFcr = fcrHourly.map((d, i) => ({
    ...d,
    prevPrice: prevFcrHourly[i]?.price ?? null,
  }))

  const zoom0 = useZoom(mergedAfrr, 'date')
  const zoom1 = useZoom(mergedFcr,  'timestamp')
  const zoom2 = useZoom(mergedAfrr, 'date')

  return (
    <section className="asset-section">
      <h2 className="section-title">Ancillary Services</h2>

      <ChartWrap title="aFRR Capacity Price NL (EUR/MW/h)" source="ENTSO-E" isMock={isMock} isLoading={dataLoading} zoomed={zoom0.isZoomed} onReset={zoom0.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={zoom0.displayData} {...chartProps} {...zoom0.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="monotone" dataKey="afrrCapacityUpPrice"   stroke={COLORS.green} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="aFRR Capacity Up (EUR/MW/h)" />
            <Line type="monotone" dataKey="afrrCapacityDownPrice" stroke={COLORS.amber} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="aFRR Capacity Down (EUR/MW/h)" />
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrCapacityUpPrice"   stroke={COLORS.green} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Up" />}
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrCapacityDownPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Down" />}
            {zoom0.refArea.left && zoom0.refArea.right && (
              <ReferenceArea x1={zoom0.refArea.left} x2={zoom0.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="FCR Clearing Price NL (EUR/MW/h)" source="ENTSO-E" isMock={isMock} isLoading={dataLoading} zoomed={zoom1.isZoomed} onReset={zoom1.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={zoom1.displayData} {...chartProps} {...zoom1.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="timestamp"
              tickFormatter={v => {
                if (!v) return ''
                const [date, time] = v.split('T')
                return `${fmtDate(date)} ${time}`
              }}
              tick={{ fill: '#94a3b8', fontSize: 10 }}
            />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="stepAfter" dataKey="price" stroke={COLORS.purple} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="FCR Clearing Price (EUR/MW/h)" />
            {compareEnabled && <Line type="stepAfter" dataKey="prevPrice" stroke={COLORS.purple} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" />}
            {zoom1.refArea.left && zoom1.refArea.right && (
              <ReferenceArea x1={zoom1.refArea.left} x2={zoom1.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="aFRR Energy Price NL — Up / Down (EUR/MWh)" source="TenneT" isMock={isMock} isLoading={dataLoading} zoomed={zoom2.isZoomed} onReset={zoom2.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={zoom2.displayData} {...chartProps} {...zoom2.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="monotone" dataKey="afrrUpEnergyPrice"   stroke={COLORS.green} dot={false} strokeWidth={2} name="aFRR Up Energy (EUR/MWh)" />
            <Line type="monotone" dataKey="afrrDownEnergyPrice" stroke={COLORS.amber} dot={false} strokeWidth={2} name="aFRR Down Energy (EUR/MWh)" />
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrUpEnergyPrice"   stroke={COLORS.green} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Up" />}
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrDownEnergyPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Down" />}
            {zoom2.refArea.left && zoom2.refArea.right && (
              <ReferenceArea x1={zoom2.refArea.left} x2={zoom2.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartWrap>

      <SummaryBlock text={narrative} loading={loading} onGenerate={onGenerate} isStale={isStale} generatedDates={generatedDates} lastGenerated={lastGenerated} />
    </section>
  )
}
