import { useEffect, useRef, useState } from 'react'
import ChartsPanel from './components/ChartsPanel/index.jsx'
import NarrativePanel from './components/NarrativePanel.jsx'
import PromptEditorModal from './components/PromptEditorModal.jsx'
import { loadSourceData } from './data/index.js'
import { computeDates } from './data/dateRange.js'
import {
  DEFAULT_NARRATIVE_PROMPT_DAY_AHEAD,
  DEFAULT_NARRATIVE_PROMPT_BALANCING,
  DEFAULT_NARRATIVE_PROMPT_ANCILLARY,
  DEFAULT_REGULATORY_PROMPT,
  DEFAULT_CUSTOMER_SIGNALS_PROMPT,
} from './data/defaultPrompts.js'

const PROMPT_DEFAULTS = {
  narrativeDayAhead:          DEFAULT_NARRATIVE_PROMPT_DAY_AHEAD,
  narrativeBalancing:         DEFAULT_NARRATIVE_PROMPT_BALANCING,
  narrativeAncillaryServices: DEFAULT_NARRATIVE_PROMPT_ANCILLARY,
  regulatory:                 DEFAULT_REGULATORY_PROMPT,
  customerSignals:            DEFAULT_CUSTOMER_SIGNALS_PROMPT,
}

function MagicPencilLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Pencil rotated -45deg */}
      <g transform="rotate(-45, 14, 14)">
        <rect x="11" y="3" width="6" height="3" rx="1" fill="#f87171" />
        <rect x="11" y="6" width="6" height="1.5" fill="#fca5a5" opacity="0.6" />
        <rect x="11" y="7.5" width="6" height="11" fill="currentColor" />
        <path d="M11 18.5 L17 18.5 L14 23.5 Z" fill="#d97706" />
        <path d="M12.5 20.5 L15.5 20.5 L14 23.5 Z" fill="#334155" />
      </g>
      {/* Sparkles */}
      <path d="M21 5.5 L21.5 4 L22 5.5 L23.5 6 L22 6.5 L21.5 8 L21 6.5 L19.5 6 Z" fill="#818cf8" />
      <path d="M5 10.5 L5.35 9.5 L5.7 10.5 L6.7 10.85 L5.7 11.2 L5.35 12.2 L5 11.2 L4 10.85 Z" fill="#34d399" />
      <path d="M22 19 L22.3 18.1 L22.6 19 L23.5 19.3 L22.6 19.6 L22.3 20.5 L22 19.6 L21.1 19.3 Z" fill="#60a5fa" />
    </svg>
  )
}

export default function App() {
  const EMPTY_DATA = { dayAhead: null, generation: null, imbalance: null, afrr: null,
                        errors: { dayAhead: null, generation: null, imbalance: null, afrr: null } }
  const SOURCES = ['dayAhead', 'generation', 'imbalance', 'afrr']

  const [marketData, setMarketData]   = useState(EMPTY_DATA)
  const [dataLoading, setDataLoading] = useState({ dayAhead: true, generation: true, imbalance: true, afrr: true })
  const [selectedRange, setSelectedRange]   = useState('90d')
  const [promptSettings, setPromptSettings] = useState({ ...PROMPT_DEFAULTS })
  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [leftWidth, setLeftWidth]           = useState(50)
  const [resizerTip, setResizerTip]         = useState({ visible: false, x: 0, y: 0 })
  const bodyRef   = useRef(null)
  const dragging  = useRef(false)

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current || !bodyRef.current) return
      const { left, width } = bodyRef.current.getBoundingClientRect()
      const pct = ((e.clientX - left) / width) * 100
      setLeftWidth(Math.min(Math.max(pct, 35), 80))
    }
    function onMouseUp() { dragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',  onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',  onMouseUp)
    }
  }, [])

  function handlePromptSave(key, value) {
    setPromptSettings(prev => ({ ...prev, [key]: value }))
  }

  const anyPromptModified = Object.keys(PROMPT_DEFAULTS).some(
    k => promptSettings[k] !== PROMPT_DEFAULTS[k]
  )

  useEffect(() => {
    // Reset to loading state immediately so charts show skeletons on range change
    setMarketData(EMPTY_DATA)
    setDataLoading({ dayAhead: true, generation: true, imbalance: true, afrr: true })

    const { startDate, endDate } = computeDates(selectedRange)

    // Fire each source independently — charts render as soon as their own data arrives
    for (const source of SOURCES) {
      loadSourceData(source, startDate, endDate).then(({ data, error }) => {
        setMarketData(prev => ({
          ...prev,
          [source]: data,
          errors: { ...prev.errors, [source]: error },
        }))
        setDataLoading(prev => ({ ...prev, [source]: false }))
      })
    }
  }, [selectedRange])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-brand">
          <h1 className="app-title">Energy Market Lens — NL <span className="beta-tag">beta</span></h1>
          <span className="app-subtitle">NL energy market intelligence · multi-horizon view</span>
        </div>
        <button
          className={`header-prompt-btn${anyPromptModified ? ' modified' : ''}`}
          onClick={() => setShowPromptEditor(true)}
          title="Edit system prompts"
        >
          <MagicPencilLogo />
          Prompts
        </button>
      </header>

      <div className="app-body" ref={bodyRef}>
        <ChartsPanel
          data={marketData}
          dataLoading={dataLoading}
          narrativePrompts={promptSettings}
          selectedRange={selectedRange}
          onRangeChange={setSelectedRange}
          style={{ flex: `0 0 ${leftWidth}%` }}
        />
        <div
          className="panel-resizer"
          onMouseEnter={e => setResizerTip({ visible: true,  x: e.clientX, y: e.clientY })}
          onMouseMove ={e => setResizerTip({ visible: true,  x: e.clientX, y: e.clientY })}
          onMouseLeave={  () => setResizerTip(t => ({ ...t, visible: false }))}
          onMouseDown ={() => { dragging.current = true; document.body.style.cursor = 'col-resize'; setResizerTip(t => ({ ...t, visible: false })) }}
        />
        <NarrativePanel
          promptSettings={promptSettings}
          style={{ flex: `0 0 ${100 - leftWidth}%` }}
        />
      </div>

      {resizerTip.visible && (
        <div className="resizer-tooltip" style={{ left: resizerTip.x, top: resizerTip.y }}>
          Drag to resize
        </div>
      )}

      {showPromptEditor && (
        <PromptEditorModal
          prompts={promptSettings}
          defaults={PROMPT_DEFAULTS}
          onSave={handlePromptSave}
          onClose={() => setShowPromptEditor(false)}
        />
      )}
    </div>
  )
}
