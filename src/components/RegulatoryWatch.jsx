import { useState } from 'react'

const DEFAULT_SOURCES = [
  { id: 1, name: 'ACM (Dutch energy regulator)',    url: 'https://www.acm.nl/nl/onderwerpen/energie',            enabled: true },
  { id: 2, name: 'TenneT Newsroom',                 url: 'https://www.tennet.eu/news/',                          enabled: true },
  { id: 3, name: 'ENTSO-E News',                    url: 'https://www.entsoe.eu/news/',                          enabled: true },
  { id: 4, name: 'Netbeheer Nederland',             url: 'https://www.netbeheernederland.nl/nieuws',             enabled: true },
  { id: 5, name: 'RVO (Netherlands Enterprise Agency)', url: 'https://www.rvo.nl/onderwerpen/energie',           enabled: true },
  { id: 6, name: 'EU Commission Energy',            url: 'https://energy.ec.europa.eu/news_en',                 enabled: true },
  { id: 7, name: 'ACER',                            url: 'https://www.acer.europa.eu/news-and-events/news',      enabled: true },
]

let nextId = DEFAULT_SOURCES.length + 1

export default function RegulatoryWatch({ regulatoryPrompt }) {
  const [sources, setSources]           = useState(DEFAULT_SOURCES)
  const [lookback, setLookback]         = useState(90)
  const [showSettings, setShowSettings] = useState(false)
  const [newName, setNewName]           = useState('')
  const [newUrl, setNewUrl]             = useState('')
  const [items, setItems]               = useState(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [lastUpdated, setLastUpdated]   = useState(null)
  const [fromCache, setFromCache]       = useState(false)
  const [showAll, setShowAll]           = useState(false)

  async function handleRefresh() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/regulatory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources, lookback, systemPrompt: regulatoryPrompt }),
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
  }

  function addSource() {
    const name = newName.trim(); const url = newUrl.trim()
    if (!name || !url) return
    setSources(prev => [...prev, { id: nextId++, name, url, enabled: true }])
    setNewName(''); setNewUrl('')
  }

  const displayedItems = items ? (showAll ? items : items.slice(0, 3)) : null

  return (
    <div className="reg-watch">
      <div className="reg-header">
        <div className="reg-header-left">
          <h2 className="narrative-title">Regulatory Watch</h2>
          {lastUpdated && (
            <span className="narrative-timestamp">
              {fromCache ? '📦 Cached · ' : ''}Updated {lastUpdated}
            </span>
          )}
        </div>
        <div className="reg-header-actions">
          <button className={`refresh-btn ${loading ? 'loading' : ''}`} onClick={handleRefresh} disabled={loading}>
            {loading ? 'Searching…' : 'Refresh'}
          </button>
          <button className={`gear-btn ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(v => !v)} title="Sources settings">
            ⚙
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="reg-settings">
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
          <p className="reg-settings-label" style={{ marginTop: '12px' }}>Lookback Window</p>
          <div className="cs-lookback-row">
            <input
              type="number"
              className="reg-input cs-lookback-input"
              min={30}
              max={180}
              value={lookback}
              onChange={e => setLookback(Math.min(180, Math.max(30, Number(e.target.value))))}
            />
            <span className="cs-lookback-unit">days</span>
          </div>
        </div>
      )}

      {error && <div className="narrative-error"><span className="error-icon">⚠</span> {error}</div>}

      {!items && !loading && !error && (
        <p className="narrative-empty">Click Refresh to search for recent regulatory developments across European energy markets.</p>
      )}

      {loading && (
        <div className="narrative-loading">
          <div className="pulse-dots"><span /><span /><span /></div>
          <p>Searching regulatory sources…</p>
        </div>
      )}

      {displayedItems && (
        <>
          <ul className="reg-items">
            {displayedItems.map((item, i) => {
              const isObj = typeof item.source === 'object'
              const label = isObj ? item.source.name : item.source.replace(/\s*\|?\s*https?:\/\/\S+/g, '').trim()
              const url   = isObj ? item.source.url   : (item.source.match(/https?:\/\/\S+/)?.[0] ?? '#')
              return (
                <li key={i} className="reg-item">
                  <p className="reg-change">{item.change}</p>
                  <p className="reg-implication">{item.implication}</p>
                  <div className="reg-item-footer">
                    {item.date && <span className="reg-item-date">{item.date}</span>}
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
