import { useState, useEffect } from 'react'
import DayAheadSection from '../charts/DayAheadSection.jsx'
import BalancingSection from '../charts/BalancingSection.jsx'
import AncillaryServicesSection from '../charts/AncillaryServicesSection.jsx'
import { aggregateWeeklySummary, fetchNarrative, loadAllMarketData } from '../../data/index.js'
import { RANGE_OPTIONS, computeDates, computePrevDates } from '../../data/dateRange.js'

export default function ChartsPanel({ data, narrativePrompt, selectedRange, onRangeChange, style }) {
  const { dayAhead, imbalance, afrr, errors } = data

  const [narrative, setNarrative]           = useState(undefined)
  const [loading, setLoading]               = useState(false)
  const [lastGenerated, setLastGenerated]   = useState(null)
  const [generatedDates, setGeneratedDates] = useState(null)
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [compareData, setCompareData]       = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)

  const dates        = computeDates(selectedRange)
  const compareDates = compareEnabled ? computePrevDates(selectedRange) : null

  useEffect(() => {
    if (!compareEnabled) { setCompareData(null); return }
    setCompareLoading(true)
    const { startDate, endDate } = computePrevDates(selectedRange)
    loadAllMarketData(startDate, endDate).then(d => {
      setCompareData(d)
      setCompareLoading(false)
    })
  }, [compareEnabled, selectedRange])

  const isStale = generatedDates && (
    generatedDates.startDate !== dates.startDate ||
    generatedDates.endDate   !== dates.endDate
  )

  async function handleGenerate() {
    setLoading(true)
    const datesSnapshot  = { ...computeDates(selectedRange) }
    const forceRefresh   = narrative !== undefined  // true when Regenerate, false on first Generate
    try {
      const summary = aggregateWeeklySummary(data, datesSnapshot.startDate, datesSnapshot.endDate)
      const result  = await fetchNarrative(summary, narrativePrompt, datesSnapshot.startDate, datesSnapshot.endDate, forceRefresh)
      if (result.ok) {
        setNarrative(result.narrative)
        setGeneratedDates(datesSnapshot)
        if (!result.fromCache) setLastGenerated(new Date().toLocaleTimeString())
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="charts-panel" style={style}>

      <h2 className="panel-heading">Market Signals</h2>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="charts-toolbar">
        <div className="range-selector">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`range-option${selectedRange === opt.key ? ' active' : ''}`}
              onClick={() => onRangeChange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <label className="compare-toggle">
          <input
            type="checkbox"
            checked={compareEnabled}
            onChange={e => setCompareEnabled(e.target.checked)}
          />
          <span>{compareLoading ? 'Loading…' : 'Compare prev. period'}</span>
        </label>
        {lastGenerated && (
          <span className="toolbar-last-generated">Summary last generated: {lastGenerated}</span>
        )}
      </div>

      {(() => {
        const cmp = {
          compareEnabled: compareEnabled && !compareLoading && !!compareData,
          compareData,
          compareDates,
        }
        return <>
          <DayAheadSection
            dayAhead={dayAhead} errors={errors}
            startDate={dates.startDate} endDate={dates.endDate}
            narrative={narrative?.dayAhead} loading={loading}
            onGenerate={handleGenerate} isStale={isStale} generatedDates={generatedDates}
            {...cmp}
          />
          <BalancingSection
            imbalance={imbalance} errors={errors}
            startDate={dates.startDate} endDate={dates.endDate}
            narrative={narrative?.balancing} loading={loading}
            onGenerate={handleGenerate} isStale={isStale} generatedDates={generatedDates}
            {...cmp}
          />
          <AncillaryServicesSection
            afrr={afrr} errors={errors}
            startDate={dates.startDate} endDate={dates.endDate}
            narrative={narrative?.ancillaryServices} loading={loading}
            onGenerate={handleGenerate} isStale={isStale} generatedDates={generatedDates}
            {...cmp}
          />
        </>
      })()}
    </div>
  )
}
