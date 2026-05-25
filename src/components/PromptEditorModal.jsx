import { useState, useEffect, useRef } from 'react'

const TABS = [
  { key: 'narrative',       label: 'Market Outlook'    },
  { key: 'regulatory',      label: 'Regulatory Watch'  },
  { key: 'customerSignals', label: 'Customer Signals'  },
]

export default function PromptEditorModal({ prompts, defaults, onSave, onClose }) {
  const [activeTab, setActiveTab]   = useState('narrative')
  const [drafts, setDrafts]         = useState({ ...prompts })
  const [savedKey, setSavedKey]     = useState(null)
  const overlayRef                  = useRef(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSave(key) {
    onSave(key, drafts[key])
    setSavedKey(key)
    setTimeout(() => setSavedKey(null), 1800)
  }

  function handleReset(key) {
    setDrafts(prev => ({ ...prev, [key]: defaults[key] }))
    onSave(key, defaults[key])
  }

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div className="prompt-modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="prompt-modal" role="dialog" aria-modal="true">

        {/* Header */}
        <div className="prompt-modal-header">
          <span className="prompt-modal-title">Test a Prompt</span>
          <button className="prompt-modal-close" onClick={onClose} title="Close">✕</button>
        </div>

        {/* Tabs */}
        <div className="prompt-tabs">
          {TABS.map(tab => {
            const isModified = drafts[tab.key] !== defaults[tab.key]
            return (
              <button
                key={tab.key}
                className={`prompt-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {isModified && <span className="prompt-tab-dot" title="Modified" />}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {TABS.map(tab => (
          <div key={tab.key} className={`prompt-tab-panel ${activeTab === tab.key ? 'active' : ''}`}>
            <textarea
              className="prompt-textarea"
              rows={14}
              value={drafts[tab.key]}
              onChange={e => setDrafts(prev => ({ ...prev, [tab.key]: e.target.value }))}
              spellCheck={false}
            />
            <p className="prompt-note">
              Changes apply on next Refresh. Edits are session-only — to make a prompt permanent, update it in <code>server/prompts.js</code>.
              {tab.key !== 'narrative' && ' Placeholders [TODAY DATE], [CUTOFF DATE], [SOURCE LIST] are replaced at runtime.'}
            </p>
            <div className="prompt-modal-actions">
              <button className="prompt-save-btn" onClick={() => handleSave(tab.key)}>
                {savedKey === tab.key ? '✓ Applied' : 'Try Now'}
              </button>
              <button
                className="prompt-reset-btn"
                onClick={() => handleReset(tab.key)}
                disabled={drafts[tab.key] === defaults[tab.key]}
              >
                Reset to default
              </button>
            </div>
          </div>
        ))}

      </div>
    </div>
  )
}
