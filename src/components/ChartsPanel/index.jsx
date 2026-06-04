import { useState, useEffect } from 'react'
import DayAheadSection from '../charts/DayAheadSection.jsx'
import BalancingSection from '../charts/BalancingSection.jsx'
import AncillaryServicesSection from '../charts/AncillaryServicesSection.jsx'
import { buildNarrativePayload, fetchSectionNarrative, loadAllMarketData } from '../../data/index.js'
import { RANGE_OPTIONS, computeDates, computePrevDates } from '../../data/dateRange.js'

const SECTIONS = ['dayAhead', 'balancing', 'ancillaryServices']

function makePerSection(value) {
  return Object.fromEntries(SECTIONS.map(s => [s, value]))
}

export default function ChartsPanel({ data, dataLoading, selectedRange, onRangeChange, style }) {
  const { dayAhead, imbalance, afrr, errors } = data

  // ── Per-section narrative state ───────────────────────────────────────────
  const [narratives,      setNarratives]      = useState(makePerSection(undefined))
  const [loadings,        setLoadings]        = useState(makePerSection(false))
  const [lastGeneratedMap, setLastGeneratedMap] = useState(makePerSection(null))
  const [generatedDatesMap, setGeneratedDatesMap] = useState(makePerSection(null))

  // ── Compare period ────────────────────────────────────────────────────────
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [compareData,    setCompareData]    = useState(null)
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

  // ── Per-section generate handler ──────────────────────────────────────────
  async function handleGenerateSection(section) {
    setLoadings(prev => ({ ...prev, [section]: true }))
    const datesSnapshot = { ...computeDates(selectedRange) }
    const forceRefresh  = narratives[section] !== undefined  // Regenerate on second click
    try {
      const fullPayload = buildNarrativePayload(data, datesSnapshot.startDate, datesSnapshot.endDate)
      const result = await fetchSectionNarrative(
        section, fullPayload, undefined,
        datesSnapshot.startDate, datesSnapshot.endDate,
        forceRefresh
      )
      if (result.ok) {
        setNarratives(prev => ({ ...prev, [section]: result.narrative }))
        setGeneratedDatesMap(prev => ({ ...prev, [section]: datesSnapshot }))
        if (!result.fromCache) {
          setLastGeneratedMap(prev => ({ ...prev, [section]: new Date().toLocaleTimeString() }))
        }
      }
    } finally {
      setLoadings(prev => ({ ...prev, [section]: false }))
    }
  }

  // ── Stale check per section ───────────────────────────────────────────────
  function isSectionStale(section) {
    const gd = generatedDatesMap[section]
    return gd && (gd.startDate !== dates.startDate || gd.endDate !== dates.endDate)
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
          <label className="compare-toggle">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={e => setCompareEnabled(e.target.checked)}
            />
            <span>{compareLoading ? 'Loading…' : 'Compare previous period'}</span>
          </label>
        </div>
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
            narrative={narratives.dayAhead} loading={loadings.dayAhead}
            onGenerate={() => handleGenerateSection('dayAhead')}
            isStale={isSectionStale('dayAhead')}
            generatedDates={generatedDatesMap.dayAhead}
            lastGenerated={lastGeneratedMap.dayAhead}
            dataLoading={dataLoading?.dayAhead}
            {...cmp}
          />
          <BalancingSection
            imbalance={imbalance} errors={errors}
            startDate={dates.startDate} endDate={dates.endDate}
            narrative={narratives.balancing} loading={loadings.balancing}
            onGenerate={() => handleGenerateSection('balancing')}
            isStale={isSectionStale('balancing')}
            generatedDates={generatedDatesMap.balancing}
            lastGenerated={lastGeneratedMap.balancing}
            dataLoading={dataLoading?.imbalance}
            {...cmp}
          />
          <AncillaryServicesSection
            afrr={afrr} errors={errors}
            startDate={dates.startDate} endDate={dates.endDate}
            narrative={narratives.ancillaryServices} loading={loadings.ancillaryServices}
            onGenerate={() => handleGenerateSection('ancillaryServices')}
            isStale={isSectionStale('ancillaryServices')}
            generatedDates={generatedDatesMap.ancillaryServices}
            lastGenerated={lastGeneratedMap.ancillaryServices}
            dataLoading={dataLoading?.afrr}
            {...cmp}
          />
        </>
      })()}
    </div>
  )
}
