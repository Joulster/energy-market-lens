import { useState } from 'react'
import {
  ComposedChart, LineChart, Line, Bar, ReferenceArea,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { COLORS, chartProps, legendStyle, fmtDate, ChartWrap, CompareTooltip } from './shared.jsx'
import { useZoom } from './useZoom.js'

// ── Timestamp formatters ────────────────────────────────────────────────────

// TenneT timestamps are CET local strings: "2026-01-01T00:00:00"
// Slice directly — no timezone conversion needed.
function fmtEnergyTs(v, resolution) {
  if (!v) return ''
  if (resolution === '1d') return fmtDate(v.slice(0, 10))
  const date = v.slice(0, 10)
  const time = v.slice(11, 16)   // "HH:MM"
  return `${fmtDate(date)} ${time}`
}

// ENTSO-E capacity timestamps are CET: "2026-01-01T00:00"
function fmtCapacityTs(v, resolution) {
  if (!v) return ''
  if (resolution === '1d') return fmtDate(v.slice(0, 10))
  const [date, time] = v.split('T')
  return `${fmtDate(date)} ${time}`
}

// ── Capacity resolution aggregation (aFRR + FCR) ────────────────────────────

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

// ── aFRR energy aggregation ─────────────────────────────────────────────────

const ENERGY_RESOLUTIONS = [
  { key: '15m', label: '15m' },
  { key: '1h',  label: '1h'  },
  { key: '1d',  label: '1d'  },
]

const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

function aggregateEnergy1h(points) {
  const buckets = {}
  for (const pt of points) {
    const key = pt.timestamp.slice(0, 13)  // "YYYY-MM-DDTHH"
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

function aggregateEnergy(points, resolution) {
  if (resolution === '1h') return aggregateEnergy1h(points)
  if (resolution === '1d') return aggregateEnergy1d(points)
  return points  // 15m — raw
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

export default function AncillaryServicesSection({ afrr, errors, startDate, endDate, narrative, loading, onGenerate, isStale, generatedDates, lastGenerated, dataLoading, compareEnabled, compareData, compareDates }) {
  const [energyRes,   setEnergyRes]   = useState('1h')
  const [afrrCapRes,  setAfrrCapRes]  = useState('4h')
  const [fcrRes,      setFcrRes]      = useState('4h')

  const inRangeTs  = ts => { const d = ts?.slice(0, 10); return (!startDate || d >= startDate) && (!endDate || d <= endDate) }
  const inPrevTs   = ts => { const d = ts?.slice(0, 10); return (!compareDates?.startDate || d >= compareDates.startDate) && (!compareDates?.endDate || d <= compareDates.endDate) }

  // ── aFRR Capacity (ENTSO-E, aggregated by resolution) ─────────────────────
  const rawAfrrCap     = (afrr?.afrrHourly     ?? []).filter(d => inRangeTs(d.timestamp))
  const prevRawAfrrCap = compareEnabled ? (compareData?.afrr?.afrrHourly ?? []).filter(d => inPrevTs(d.timestamp)) : []
  const afrrCapData     = afrrCapRes === '1d' ? aggregateAfrrCap1d(rawAfrrCap)     : rawAfrrCap
  const prevAfrrCapData = afrrCapRes === '1d' ? aggregateAfrrCap1d(prevRawAfrrCap) : prevRawAfrrCap
  const mergedAfrrCapacity = afrrCapData.map((d, i) => ({
    ...d,
    prevAfrrCapacityUpPrice:   prevAfrrCapData[i]?.afrrCapacityUpPrice,
    prevAfrrCapacityDownPrice: prevAfrrCapData[i]?.afrrCapacityDownPrice,
  }))

  // ── FCR (ENTSO-E, aggregated by resolution) ────────────────────────────────
  const rawFcr     = (afrr?.fcrHourly  ?? []).filter(d => inRangeTs(d.timestamp))
  const prevRawFcr = compareEnabled ? (compareData?.afrr?.fcrHourly ?? []).filter(d => inPrevTs(d.timestamp)) : []
  const fcrData     = fcrRes === '1d' ? aggregateFcr1d(rawFcr)     : rawFcr
  const prevFcrData = fcrRes === '1d' ? aggregateFcr1d(prevRawFcr) : prevRawFcr
  const mergedFcr = fcrData.map((d, i) => ({
    ...d,
    prevPrice: prevFcrData[i]?.price ?? null,
  }))

  // ── Energy (TenneT 15-min, aggregated by selected resolution) ─────────────
  const rawEnergy     = (afrr?.afrrEnergyRaw     ?? []).filter(d => inRangeTs(d.timestamp))
  const prevRawEnergy = compareEnabled ? (compareData?.afrr?.afrrEnergyRaw ?? []).filter(d => inPrevTs(d.timestamp)) : []

  const energyData     = aggregateEnergy(rawEnergy,     energyRes)
  const prevEnergyData = aggregateEnergy(prevRawEnergy, energyRes)
  const mergedEnergy   = energyData.map((d, i) => ({
    ...d,
    prevAfrrUpEnergyPrice:   prevEnergyData[i]?.afrrUpEnergyPrice,
    prevAfrrDownEnergyPrice: prevEnergyData[i]?.afrrDownEnergyPrice,
  }))

  const isMock = !!errors?.afrr

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

  return (
    <section className="asset-section">
      <h2 className="section-title">Ancillary Services</h2>

      <ChartWrap title="aFRR Capacity NL — Price & Volume" source="ENTSO-E" isMock={isMock} isLoading={dataLoading} controls={afrrCapControls} zoomed={zoom0.isZoomed} onReset={zoom0.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={zoom0.displayData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} {...zoom0.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtCapacityTs(v, afrrCapRes)} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={60} />
            {/* Capacity MW — outer left axis */}
            <YAxis yAxisId="cap"   orientation="left" width={42} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}MW`} />
            {/* Price EUR/MW/h — inner left axis */}
            <YAxis yAxisId="price" orientation="left" width={45} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Bar yAxisId="cap" dataKey="afrrCapacityUpMW"   fill={COLORS.green} fillOpacity={0.18} name="Up Capacity (MW)"   isAnimationActive={false} />
            <Bar yAxisId="cap" dataKey="afrrCapacityDownMW" fill={COLORS.amber} fillOpacity={0.18} name="Down Capacity (MW)" isAnimationActive={false} />
            <Line yAxisId="price" type="stepAfter" dataKey="afrrCapacityUpPrice"   stroke={COLORS.green} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="aFRR Up Price (EUR/MW/h)"   isAnimationActive={false} />
            <Line yAxisId="price" type="stepAfter" dataKey="afrrCapacityDownPrice" stroke={COLORS.amber} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="aFRR Down Price (EUR/MW/h)" isAnimationActive={false} />
            {compareEnabled && <Line yAxisId="price" type="stepAfter" dataKey="prevAfrrCapacityUpPrice"   stroke={COLORS.green} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Up"   isAnimationActive={false} />}
            {compareEnabled && <Line yAxisId="price" type="stepAfter" dataKey="prevAfrrCapacityDownPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Down" isAnimationActive={false} />}
            {zoom0.refArea.left && zoom0.refArea.right && (
              <ReferenceArea yAxisId="price" x1={zoom0.refArea.left} x2={zoom0.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="FCR Capacity NL — Price & Volume" source="ENTSO-E" isMock={isMock} isLoading={dataLoading} controls={fcrControls} zoomed={zoom1.isZoomed} onReset={zoom1.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={zoom1.displayData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} {...zoom1.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtCapacityTs(v, fcrRes)} tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={60} />
            {/* Capacity MW — outer left axis */}
            <YAxis yAxisId="cap"   orientation="left" width={42} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}MW`} />
            {/* Price EUR/MW/h — inner left axis */}
            <YAxis yAxisId="price" orientation="left" width={45} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip />} />
            <Legend wrapperStyle={legendStyle} />
            <Bar  yAxisId="cap"   dataKey="capacityMW" fill={COLORS.purple} fillOpacity={0.18} name="FCR Capacity (MW)"           isAnimationActive={false} />
            <Line yAxisId="price" type="stepAfter" dataKey="price" stroke={COLORS.purple} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeWidth={2} name="FCR Clearing Price (EUR/MW/h)" isAnimationActive={false} />
            {compareEnabled && <Line yAxisId="price" type="stepAfter" dataKey="prevPrice" stroke={COLORS.purple} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. period" isAnimationActive={false} />}
            {zoom1.refArea.left && zoom1.refArea.right && (
              <ReferenceArea yAxisId="price" x1={zoom1.refArea.left} x2={zoom1.refArea.right} fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeOpacity={0.4} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartWrap>

      <ChartWrap title="aFRR Energy Price NL — Up / Down (EUR/MWh)" source="TenneT" isMock={isMock} isLoading={dataLoading} controls={energyResControls} zoomed={zoom2.isZoomed} onReset={zoom2.reset}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={zoom2.displayData} {...chartProps} {...zoom2.handlers} style={{ cursor: 'crosshair', userSelect: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="timestamp" tickFormatter={v => fmtEnergyTs(v, energyRes)} tick={{ fill: '#94a3b8', fontSize: energyRes === '1d' ? 11 : 10 }} minTickGap={60} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} tickFormatter={v => Number(v).toFixed(2)} />
            <Tooltip content={<CompareTooltip labelFormatter={v => fmtEnergyTs(v, energyRes)} />} />
            <Legend wrapperStyle={legendStyle} />
            <Line type="monotone" dataKey="afrrUpEnergyPrice"   stroke={COLORS.green} dot={false} strokeWidth={2} name="aFRR Up Energy (EUR/MWh)" isAnimationActive={false} />
            <Line type="monotone" dataKey="afrrDownEnergyPrice" stroke={COLORS.amber} dot={false} strokeWidth={2} name="aFRR Down Energy (EUR/MWh)" isAnimationActive={false} />
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrUpEnergyPrice"   stroke={COLORS.green} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Up" isAnimationActive={false} />}
            {compareEnabled && <Line type="monotone" dataKey="prevAfrrDownEnergyPrice" stroke={COLORS.amber} dot={false} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.45} name="Prev. Down" isAnimationActive={false} />}
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
