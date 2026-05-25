import { useState, useEffect } from 'react'

const DEFAULT_SOURCES = [
  { id: 1,  name: 'Recharge News',           url: 'https://rechargenews.com',                           enabled: true },
  { id: 2,  name: 'Energy Monitor',          url: 'https://energymonitor.ai',                           enabled: true },
  { id: 3,  name: 'PV Tech',                 url: 'https://pvtech.org',                                 enabled: true },
  { id: 4,  name: 'Energy Storage News',     url: 'https://www.energy-storage.news',                    enabled: true },
  { id: 5,  name: 'Enlit Europe',            url: 'https://enlit.world',                                enabled: true },
  { id: 6,  name: 'WindEurope Newsroom',     url: 'https://windeurope.org/newsroom',                    enabled: true },
  { id: 7,  name: 'Energeia (NL)',           url: 'https://energeia.nl',                                enabled: true },
  { id: 8,  name: 'New Energy Coalition',    url: 'https://www.newenergycoalition.org/news',            enabled: true },
]

const DEFAULT_COMPANIES = [
  'Statkraft','Engie','Axpo','RWE','Vattenfall','Orsted',
  'Entrix','Flower','Sympower','EDF','E.ON','Alliander','Elia',
]

const DEFAULT_TOPICS = [
  'battery storage','aFRR','flexibility markets','hybrid power plants',
  'VPP software','ancillary services','grid flexibility','demand response',
]

let nextId = DEFAULT_SOURCES.length + 1

function TagInput({ tags, onChange, placeholder }) {
  const [input, setInput] = useState('')

  function add() {
    const val = input.trim()
    if (!val || tags.includes(val)) { setInput(''); return }
    onChange([...tags, val])
    setInput('')
  }

  function remove(tag) {
    onChange(tags.filter(t => t !== tag))
  }

  return (
    <div className="cs-tag-section">
      <div className="cs-tags">
        {tags.map(tag => (
          <span key={tag} className="cs-tag">
            {tag}
            <button className="cs-tag-remove" onClick={() => remove(tag)} title="Remove">×</button>
          </span>
        ))}
      </div>
      <div className="cs-tag-input-row">
        <input
          className="reg-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={placeholder}
        />
        <button className="reg-add-btn" onClick={add}>Add</button>
      </div>
    </div>
  )
}

export default function CustomerSignals({ customerSignalsPrompt }) {
  const [sources, setSources]         = useState(DEFAULT_SOURCES)
  const [companies, setCompanies]     = useState(DEFAULT_COMPANIES)
  const [topics, setTopics]           = useState(DEFAULT_TOPICS)
  const [lookback, setLookback]       = useState(90)
  const [showSettings, setShowSettings] = useState(false)
  const [newName, setNewName]         = useState('')
  const [newUrl, setNewUrl]           = useState('')
  const [items, setItems]             = useState(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [fromCache, setFromCache]     = useState(false)
  const [showAll, setShowAll]         = useState(false)
  const [dirty, setDirty]             = useState(false)

  // Auto-fetch on mount — cache hit is near-instant for repeat visits
  useEffect(() => { handleRefresh() }, [])

  async function handleRefresh() {
    setLoading(true)
    setError(null)
    setDirty(false)
    try {
      const enabledSources = sources.filter(s => s.enabled)
      const res = await fetch('/api/customer-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: enabledSources,
          companies,
          topics,
          lookback,
          systemPrompt: customerSignalsPrompt,
        }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Request failed'); return }
      setItems(data.items)
      setFromCache(data.fromCache ?? false)
      setLastUpdated(new Date(data.cachedAt ?? Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))
      setShowAll(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function toggleSource(id) {
    setSources(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s))
    setDirty(true)
  }

  function addSource() {
    const name = newName.trim(); const url = newUrl.trim()
    if (!name || !url) return
    setSources(prev => [...prev, { id: nextId++, name, url, enabled: true }])
    setNewName(''); setNewUrl('')
    setDirty(true)
  }

  function parseSource(item) {
    if (typeof item.source === 'object') return { label: item.source.name, url: item.source.url }
    const label = item.source.replace(/\s*\|?\s*https?:\/\/\S+/g, '').trim()
    const url   = item.source.match(/https?:\/\/\S+/)?.[0] ?? '#'
    return { label, url }
  }

  const displayedItems = items ? (showAll ? items : items.slice(0, 3)) : null

  return (
    <div className="reg-watch">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="reg-header">
        <div className="reg-header-left">
          <h2 className="narrative-title">Customer Signals</h2>
          {lastUpdated && (
            <span className="narrative-timestamp">
              {fromCache ? '📦 Cached · ' : ''}Updated {lastUpdated}
            </span>
          )}
        </div>
        <div className="reg-header-actions">
          {(loading || (error && !items)) && (
            <button className={`refresh-btn ${loading ? 'loading' : ''}`} onClick={handleRefresh} disabled={loading}>
              {loading ? 'Searching…' : 'Retry'}
            </button>
          )}
          <button
            className={`gear-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(v => !v)}
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* ── Settings panel ─────────────────────────────────────────── */}
      {showSettings && (
        <div className="reg-settings">

          {/* Section 1: Sources */}
          <p className="reg-settings-label">Sources</p>
          <ul className="reg-source-list">
            {sources.map(s => (
              <li key={s.id} className="reg-source-item">
                <label className="reg-toggle">
                  <input type="checkbox" checked={s.enabled} onChange={() => toggleSource(s.id)} />
                  <span className="reg-toggle-track" />
                </label>
                <div className="reg-source-info">
                  <span className="reg-source-name">{s.name}</span>
                  <a className="reg-source-url" href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>
                </div>
              </li>
            ))}
          </ul>
          <div className="reg-add-source">
            <input className="reg-input" placeholder="Source name" value={newName} onChange={e => setNewName(e.target.value)} />
            <input className="reg-input" placeholder="https://..." value={newUrl} onChange={e => setNewUrl(e.target.value)} />
            <button className="reg-add-btn" onClick={addSource}>Add</button>
          </div>

          {/* Section 2: Companies to Watch */}
          <p className="reg-settings-label cs-settings-label">Companies to Watch</p>
          <TagInput tags={companies} onChange={v => { setCompanies(v); setDirty(true) }} placeholder="Company name…" />

          {/* Section 3: Topics */}
          <p className="reg-settings-label cs-settings-label">Topics</p>
          <TagInput tags={topics} onChange={v => { setTopics(v); setDirty(true) }} placeholder="Topic…" />

          {/* Section 4: Lookback */}
          <p className="reg-settings-label cs-settings-label">Lookback Window</p>
          <div className="range-selector">
            {[30, 60, 90, 180].map(d => (
              <button
                key={d}
                className={`range-option${lookback === d ? ' active' : ''}`}
                onClick={() => { setLookback(d); setDirty(true) }}
              >{d}d</button>
            ))}
          </div>
          <div className="reg-settings-footer">
            <button className={`reg-regenerate-btn${dirty ? ' active' : ''}`} onClick={() => { setShowSettings(false); handleRefresh() }}>
              Regenerate
            </button>
          </div>

        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && (
        <div className="narrative-error">
          <span className="error-icon">⚠</span> {error}
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────── */}
      {loading && (
        <div className="narrative-loading">
          <div className="pulse-dots"><span /><span /><span /></div>
          <p>Scanning industry sources…</p>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────── */}
      {displayedItems && (
        <>
          <ul className="reg-items">
            {displayedItems.map((item, i) => {
              const { label, url } = parseSource(item)
              return (
                <li key={i} className="reg-item">
                  <p className="cs-signal">{item.signal}</p>
                  <p className="cs-context">{item.context}</p>
                  <p className="cs-implication">{item.implication}</p>
                  <div className="reg-item-footer">
                    <a className="reg-source-link" href={url} target="_blank" rel="noopener noreferrer">{label}</a>
                  </div>
                </li>
              )
            })}
          </ul>
          {items.length > 3 && (
            <button className="reg-show-all" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show less ▲' : `Show all ${items.length} items ▼`}
            </button>
          )}
        </>
      )}

    </div>
  )
}
