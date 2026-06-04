import crypto     from 'crypto'
import express    from 'express'
import Redis      from 'ioredis'
import { WorkOS } from '@workos-inc/node'

const SESSION_COOKIE = 'eml_session'
const SESSION_TTL    = 604800 // 7 days in seconds

// ── WorkOS client (lazy — env vars loaded by index.js before first request) ─
let _workos = null
function getWorkOS() {
  if (!_workos) _workos = new WorkOS(process.env.WORKOS_API_KEY)
  return _workos
}

// ── Session store ──────────────────────────────────────────────────────────
// Independent Redis connection — doesn't share state with researchCache.js.
// Falls back to an in-memory Map when REDIS_URL is not set (local dev).
let _redis = null
const _memStore = new Map()

function getRedis() {
  if (_redis) return _redis
  if (!process.env.REDIS_URL) return null
  _redis = new Redis(process.env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 })
  _redis.on('error', err => console.error('[auth] Redis error:', err.message))
  return _redis
}

async function readSession(sessionId) {
  const key   = `session:${sessionId}`
  const redis = getRedis()
  if (redis) {
    try {
      const raw = await redis.get(key)
      return raw ? JSON.parse(raw) : null
    } catch (err) {
      console.error('[auth] Redis get error:', err.message)
    }
  }
  return _memStore.get(key) ?? null
}

async function writeSession(sessionId, user) {
  const key   = `session:${sessionId}`
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(user), 'EX', SESSION_TTL)
      return
    } catch (err) {
      console.error('[auth] Redis set error:', err.message)
    }
  }
  _memStore.set(key, user)
}

async function deleteSession(sessionId) {
  const key   = `session:${sessionId}`
  const redis = getRedis()
  if (redis) {
    try { await redis.del(key) } catch { /* ignore */ }
  }
  _memStore.delete(key)
}

// ── Cookie helpers ─────────────────────────────────────────────────────────
function cookieOptions(maxAge = 604800000) {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge,
  }
}

// ── Public helpers ─────────────────────────────────────────────────────────

// Used by the catch-all route in index.js to gate non-auth pages.
export async function getSession(req) {
  const sessionId = req.cookies?.[SESSION_COOKIE]
  if (!sessionId) return null
  return readSession(sessionId)
}

// Middleware applied to protected /api/* routes.
export async function requireAuth(req, res, next) {
  const sessionId = req.cookies?.[SESSION_COOKIE]
  if (!sessionId) return res.status(401).json({ message: 'unauthenticated' })
  const user = await readSession(sessionId)
  if (!user) return res.status(401).json({ message: 'unauthenticated' })
  req.user = user
  next()
}

// ── Auth router ────────────────────────────────────────────────────────────
export const authRouter = express.Router()

// GET /auth/login — React Router renders Login.jsx; pass to catch-all.
authRouter.get('/auth/login', (req, res, next) => next())

// GET /auth/unauthorised — React Router renders Unauthorised.jsx; pass to catch-all.
authRouter.get('/auth/unauthorised', (req, res, next) => next())

// POST /auth/magic-link — send a magic link email via WorkOS.
// Body: { email: string }
// NOTE: The brief refers to workos.userManagement.sendMagicAuthCode; the
//       actual method in @workos-inc/node v10 is createMagicAuth.
authRouter.post('/auth/magic-link', express.json(), async (req, res) => {
  const { email } = req.body ?? {}
  if (!email) return res.status(400).json({ error: 'email required' })

  try {
    await getWorkOS().userManagement.createMagicAuth({
      email,
      redirectUri: `${process.env.APP_BASE_URL}/auth/callback`,
    })
    return res.json({ sent: true })
  } catch (err) {
    // WorkOS returns an error when the user isn't provisioned.
    // Check common error shapes — exact code depends on WorkOS version.
    const msg    = (err?.message ?? '').toLowerCase()
    const status = err?.status ?? err?.rawData?.status ?? 0
    const code   = err?.code   ?? err?.rawData?.code   ?? ''
    const isUnprovisioned =
      code === 'user_not_found'         ||
      msg.includes('not found')         ||
      msg.includes('does not exist')    ||
      status === 404
    if (isUnprovisioned) return res.status(403).json({ unauthorised: true })

    console.error('[auth] magic-link error:', err.message)
    return res.status(500).json({ error: 'Internal error' })
  }
})

// GET /auth/callback — WorkOS redirects here after user clicks a magic link.
authRouter.get('/auth/callback', async (req, res) => {
  const { code } = req.query
  if (!code) return res.redirect('/auth/unauthorised')

  try {
    const { user } = await getWorkOS().userManagement.authenticateWithCode({
      code,
      clientId: process.env.WORKOS_CLIENT_ID,
    })
    if (!user) return res.redirect('/auth/unauthorised')

    const sessionId = crypto.randomUUID()
    await writeSession(sessionId, user)
    res.cookie(SESSION_COOKIE, sessionId, cookieOptions())
    return res.redirect('/')
  } catch (err) {
    console.error('[auth] callback error:', err.message)
    return res.redirect('/auth/unauthorised')
  }
})

// POST /auth/verify-code — user manually enters the OTP from their email.
// Body: { email: string, code: string }
authRouter.post('/auth/verify-code', express.json(), async (req, res) => {
  const { email, code } = req.body ?? {}
  if (!email || !code) return res.status(400).json({ error: 'email and code required' })

  try {
    const { user } = await getWorkOS().userManagement.authenticateWithMagicAuth({
      code,
      email,
      clientId: process.env.WORKOS_CLIENT_ID,
    })
    if (!user) return res.status(401).json({ error: 'invalid code' })

    const sessionId = crypto.randomUUID()
    await writeSession(sessionId, user)
    res.cookie(SESSION_COOKIE, sessionId, cookieOptions())
    return res.json({ ok: true })
  } catch (err) {
    console.error('[auth] verify-code error:', err.message)
    const isInvalid = (err?.code ?? '').includes('invalid') ||
                      (err?.message ?? '').toLowerCase().includes('invalid') ||
                      (err?.message ?? '').toLowerCase().includes('expired')
    return res.status(isInvalid ? 401 : 500).json({ error: isInvalid ? 'invalid or expired code' : 'Internal error' })
  }
})

// GET /auth/logout — clear session and redirect to login.
authRouter.get('/auth/logout', async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE]
  if (sessionId) await deleteSession(sessionId)
  res.cookie(SESSION_COOKIE, '', cookieOptions(0))
  return res.redirect('/auth/login')
})

// GET /api/auth/me — returns the current user (requires auth).
authRouter.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user)
})
