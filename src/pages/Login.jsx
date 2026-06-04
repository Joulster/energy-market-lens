import { useState } from 'react'

const CONTACT_EMAIL = 'shobhit.chitkara@gmail.com'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [code,     setCode]     = useState('')
  const [status,   setStatus]   = useState('idle') // idle | sending | sent | verifying | error-unauth | error-invalid | error-other

  async function handleSendLink(e) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    try {
      const res  = await fetch('/auth/magic-link', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json()
      if (res.status === 403 && json.unauthorised) {
        setStatus('error-unauth')
      } else if (json.sent) {
        setStatus('sent')
      } else {
        setStatus('error-other')
      }
    } catch {
      setStatus('error-other')
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault()
    if (!code.trim()) return
    setStatus('verifying')
    try {
      const res  = await fetch('/auth/verify-code', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      const json = await res.json()
      if (json.ok) {
        window.location.href = '/'
      } else if (res.status === 401) {
        setStatus('error-invalid')
      } else {
        setStatus('error-other')
      }
    } catch {
      setStatus('error-other')
    }
  }

  // ── Sent — code entry screen ─────────────────────────────────────────────
  if (status === 'sent' || status === 'verifying' || status === 'error-invalid') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-title">Energy Market Lens</p>
          <p className="auth-tagline">Check your email for a code</p>
          <p className="auth-sent-detail" style={{ marginBottom: 20 }}>
            We sent a 6-digit code to <strong style={{ color: '#f1f5f9' }}>{email}</strong>.
          </p>
          <form onSubmit={handleVerifyCode}>
            <input
              className="auth-input"
              type="text"
              inputMode="numeric"
              placeholder="Enter code"
              value={code}
              onChange={e => setCode(e.target.value)}
              disabled={status === 'verifying'}
              autoFocus
              required
            />
            <button className="auth-btn" type="submit" disabled={status === 'verifying'}>
              {status === 'verifying' ? 'Verifying…' : 'Continue'}
            </button>
            {status === 'error-invalid' && (
              <p className="auth-error">Invalid or expired code. Check your email and try again.</p>
            )}
          </form>
          <button
            className="auth-signout-btn"
            style={{ marginTop: 16, background: 'none', border: 'none', color: '#475569', fontSize: 13, cursor: 'pointer' }}
            onClick={() => { setStatus('idle'); setCode('') }}
          >
            ← Use a different email
          </button>
        </div>
      </div>
    )
  }

  // ── Default — email entry screen ─────────────────────────────────────────
  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="auth-title">Energy Market Lens</p>
        <p className="auth-tagline">Market signals · regulatory watch · customer intelligence</p>

        <form onSubmit={handleSendLink}>
          <input
            className="auth-input"
            type="email"
            placeholder="Enter your email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={status === 'sending'}
            autoFocus
            required
          />
          <button className="auth-btn" type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send Code'}
          </button>
          {status === 'error-unauth' && (
            <p className="auth-error">
              Access is by invitation only. To request an account email{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="auth-link">{CONTACT_EMAIL}</a>.
            </p>
          )}
          {status === 'error-other' && (
            <p className="auth-error">Something went wrong. Please try again.</p>
          )}
        </form>
      </div>
    </div>
  )
}
