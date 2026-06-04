import { useEffect, useRef, useState } from 'react'
import ChartsPanel    from './components/ChartsPanel/index.jsx'
import NarrativePanel from './components/NarrativePanel.jsx'
import { loadSourceData } from './data/index.js'
import { computeDates }   from './data/dateRange.js'
import { useUser }        from './components/AuthGate.jsx'

function getInitials(user) {
  if (user?.firstName) return user.firstName[0].toUpperCase()
  if (user?.email)     return user.email.split('@')[0][0].toUpperCase()
  return '?'
}

function Avatar() {
  const user = useUser()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div className="avatar-wrapper" ref={wrapRef}>
      <button className="avatar-btn" onClick={() => setOpen(o => !o)} title="Account">
        {getInitials(user)}
      </button>
      {open && (
        <div className="avatar-dropdown">
          <p className="avatar-dropdown-email">{user?.email ?? ''}</p>
          <div className="avatar-dropdown-divider" />
          <button
            className="avatar-signout-btn"
            onClick={() => { window.location.href = '/auth/logout' }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const EMPTY_DATA = { dayAhead: null, generation: null, imbalance: null, afrr: null,
                        errors: { dayAhead: null, generation: null, imbalance: null, afrr: null } }
  const SOURCES = ['dayAhead', 'generation', 'imbalance', 'afrr']

  const [marketData,   setMarketData]   = useState(EMPTY_DATA)
  const [dataLoading,  setDataLoading]  = useState({ dayAhead: true, generation: true, imbalance: true, afrr: true })
  const [selectedRange, setSelectedRange] = useState('90d')
  const [leftWidth,    setLeftWidth]    = useState(50)
  const [resizerTip,   setResizerTip]   = useState({ visible: false, x: 0, y: 0 })
  const bodyRef  = useRef(null)
  const dragging = useRef(false)

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

  useEffect(() => {
    setMarketData(EMPTY_DATA)
    setDataLoading({ dayAhead: true, generation: true, imbalance: true, afrr: true })
    const { startDate, endDate } = computeDates(selectedRange)
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
        <Avatar />
      </header>

      <div className="app-body" ref={bodyRef}>
        <ChartsPanel
          data={marketData}
          dataLoading={dataLoading}
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
        <NarrativePanel style={{ flex: `0 0 ${100 - leftWidth}%` }} />
      </div>

      {resizerTip.visible && (
        <div className="resizer-tooltip" style={{ left: resizerTip.x, top: resizerTip.y }}>
          Drag to resize
        </div>
      )}
    </div>
  )
}
