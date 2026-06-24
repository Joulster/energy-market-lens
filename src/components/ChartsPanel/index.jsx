import { useState, useEffect, useRef } from 'react'
import DayAheadSection from '../charts/DayAheadSection.jsx'
import BalancingSection from '../charts/BalancingSection.jsx'
import AncillaryServicesSection from '../charts/AncillaryServicesSection.jsx'
import { buildNarrativePayload, fetchSectionNarrative, loadAllMarketData, fetchCrossMarketPrices } from '../../data/index.js'
import { RANGE_OPTIONS, computeDates, computePrevDates } from '../../data/dateRange.js'
import { pushStatus } from '../StatusBar.jsx'

const SECTIONS = ['dayAhead', 'balancing', 'ancillaryServices']

const MARKET_OPTIONS = [
  { zone: 'DE', label: 'DE', color: '#fbbf24' },
  { zone: 'BE', label: 'BE', color: '#a78bfa' },
  { zone: 'FR', label: 'FR', color: '#fb7185' },
]

function makePerSection(value) {
  return Object.fromEntries(SECTIONS.map(s => [s, value]))
}

export default function ChartsPanel({ data, dataLoading, selectedRange, onRangeChange, style }) {
  const { dayAhead, generation, imbalance, afrr, balanceDelta, frrActivations, errors } = data

  // ── Per-section narrative state ───────────────────────────────────────────
  const [narratives,        setNarratives]        = useState(makePerSection(undefined))
  const [loadings,          setLoadings]          = useState(makePerSection(false))
  const [lastGeneratedMap,  setLastGeneratedMap]  = useState(makePerSection(null))
  const [generatedDatesMap, setGeneratedDatesMap] = useState(makePerSection(null))

  // ── Compare period ────────────────────────────────────────────────────────
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [compareData,    setCompareData]    = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)

  // ── Cross-market ──────────────────────────────────────────────────────────
  const [selectedMarkets,   setSelectedMarkets]   = useState([])
  const [crossMarketData,   setCrossMarketData]   = useState({})   // { DE: {dailyAvg, hourlyAvg}, ... }
  const [crossMarketLoading, setCrossMarketLoading] = useState({}) // { DE: true, ... }
  const [marketDropdownOpen, setMarketDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  const dates        = computeDates(selectedRange)
  const compareDates = compareEnabled ? computePrevDates(selectedRange) : null

  // Close dropdown when clicking outside
  useEffect(() => {
    function onClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setMarketDropdownOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Fetch compare period data
  useEffect(() => {
    if (!compareEnabled) { setCompareData(null); return }
    setCompareLoading(true)
    const { startDate, endDate } = computePrevDates(selectedRange)
    loadAllMarketData(startDate, endDate).then(d => {
      setCompareData(d)
      setCompareLoading(false)
    })
  }, [compareEnabled, selectedRange])

  // Fetch cross-market data when markets or date range changes
  useEffect(() => {
    if (!selectedMarkets.length) { setCrossMarketData({}); return }
    const { startDate, endDate } = computeDates(selectedRange)
    for (const zone of selectedMarkets) {
      setCrossMarketLoading(prev => ({ ...prev, [zone]: true }))
      fetchCrossMarketPrices(zone, startDate, endDate).then(({ data: zoneData, error }) => {
        setCrossMarketData(prev => ({ ...prev, [zone]: error ? null : zoneData }))
        setCrossMarketLoading(prev => ({ ...prev, [zone]: false }))
      })
    }
  }, [selectedMarkets, selectedRange])

  // Toggle a market zone on/off
  function toggleMarket(zone) {
    setSelectedMarkets(prev =>
      prev.includes(zone) ? prev.filter(z => z !== zone) : [...prev, zone]
    )
    // Clear data for de-selected zone
    if (selectedMarkets.includes(zone)) {
      setCrossMarketData(prev => { const next = { ...prev }; delete next[zone]; return next })
    }
  }

  // ── Per-section generate handler ──────────────────────────────────────────
  const SECTION_LABELS = { dayAhead: 'Day-Ahead', balancing: 'Balancing', ancillaryServices: 'Ancillary Services' }

  async function handleGenerateSection(section) {
    setLoadings(prev => ({ ...prev, [section]: true }))
    const datesSnapshot = { ...computeDates(selectedRange) }
    const forceRefresh  = narratives[section] !== undefined
    pushStatus(`Generating ${SECTION_LABELS[section] ?? section} summary...`)
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
          pushStatus(`${SECTION_LABELS[section] ?? section} summary ready`)
        } else {
          pushStatus(`${SECTION_LABELS[section] ?? section} summary loaded from cache`)
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

  const marketColors = Object.fromEntries(MARKET_OPTIONS.map(m => [m.zone, m.color]))

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

        <div className="toolbar-compare-controls">
          {/* Previous Period toggle */}
          <label className="compare-toggle">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={e => setCompareEnabled(e.target.checked)}
            />
            <span>{compareLoading ? 'Loading…' : 'Prev. period'}</span>
          </label>

          {/* Add Market multi-select */}
          <div className="market-select-wrapper" ref={dropdownRef}>
            <button
              className={`market-select-btn${selectedMarkets.length ? ' has-selection' : ''}`}
              onClick={() => setMarketDropdownOpen(o => !o)}
            >
              {selectedMarkets.length
                ? selectedMarkets.map(z => (
                    <span key={z} className="market-select-dot" style={{ background: marketColors[z] }} />
                  ))
                : null}
              Add Market
              <span className="market-select-chevron">▾</span>
            </button>
            {marketDropdownOpen && (
              <div className="market-select-dropdown">
                {MARKET_OPTIONS.map(({ zone, label, color }) => {
                  const isOn = selectedMarkets.includes(zone)
                  const isLoading = crossMarketLoading[zone]
                  return (
                    <button
                      key={zone}
                      className={`market-select-option${isOn ? ' active' : ''}`}
                      onClick={() => toggleMarket(zone)}
                    >
                      <span className="market-select-dot" style={{ background: color }} />
                      <span>{label}</span>
                      {isLoading && <span className="market-select-spinner" />}
                      {isOn && !isLoading && <span className="market-select-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
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
            dayAhead={dayAhead} generation={generation} errors={errors}
            startDate={dates.startDate} endDate={dates.endDate}
            narrative={narratives.dayAhead} loading={loadings.dayAhead}
            onGenerate={() => handleGenerateSection('dayAhead')}
            isStale={isSectionStale('dayAhead')}
            generatedDates={generatedDatesMap.dayAhead}
            lastGenerated={lastGeneratedMap.dayAhead}
            dataLoading={dataLoading?.dayAhead}
            genLoading={dataLoading?.generation}
            selectedMarkets={selectedMarkets}
            crossMarketData={crossMarketData}
            marketColors={marketColors}
            {...cmp}
          />
          <BalancingSection
            imbalance={imbalance} balanceDelta={balanceDelta} errors={errors}
            startDate={dates.startDate} endDate={dates.endDate}
            narrative={narratives.balancing} loading={loadings.balancing}
            onGenerate={() => handleGenerateSection('balancing')}
            isStale={isSectionStale('balancing')}
            generatedDates={generatedDatesMap.balancing}
            lastGenerated={lastGeneratedMap.balancing}
            dataLoading={dataLoading?.imbalance}
            balanceDeltaLoading={dataLoading?.balanceDelta}
            {...cmp}
          />
          <AncillaryServicesSection
            afrr={afrr} frrActivations={frrActivations} errors={errors}
            startDate={dates.startDate} endDate={dates.endDate}
            selectedRange={selectedRange}
            narrative={narratives.ancillaryServices} loading={loadings.ancillaryServices}
            onGenerate={() => handleGenerateSection('ancillaryServices')}
            isStale={isSectionStale('ancillaryServices')}
            generatedDates={generatedDatesMap.ancillaryServices}
            lastGenerated={lastGeneratedMap.ancillaryServices}
            dataLoading={dataLoading?.afrr}
            frrLoading={dataLoading?.frrActivations}
            selectedMarkets={selectedMarkets}
            crossMarketData={crossMarketData}
            marketColors={marketColors}
            {...cmp}
          />
        </>
      })()}
    </div>
  )
}
