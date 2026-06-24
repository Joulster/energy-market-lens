// Redis-backed monthly cache for expensive research calls (Regulatory Watch, Customer Signals).
// Falls back to a file-based JSON cache when REDIS_URL is not set (local dev without Redis).
// Cache keys include YYYY-MM so entries automatically become stale at the start of each month.

import Redis from 'ioredis'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir  = dirname(fileURLToPath(import.meta.url))
const CACHE_FILE = join(__dir, '..', '.cache', 'research-cache.json')

let _redis = null

function getRedis() {
  if (_redis) return _redis
  if (!process.env.REDIS_URL) return null
  _redis = new Redis(process.env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 })
  _redis.on('error', err => console.error('Redis error:', err.message))
  return _redis
}

function monthStr() {
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

function buildKey(namespace, fingerprint) {
  return `eml:${namespace}:${monthStr()}:${fingerprint}`
}

// Seconds remaining until the start of next month
function ttlSeconds() {
  const now  = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return Math.ceil((next - now) / 1000)
}

// File-based fallback — persists across server restarts so research calls aren't repeated locally
function readFileCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) } catch { return {} }
}

function writeFileCache(data) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2))
    console.log('[cache] written to', CACHE_FILE)
  } catch (err) {
    console.error('[cache] write error:', err.message, '| path:', CACHE_FILE)
  }
}

export async function getCached(namespace, fingerprint) {
  const key   = buildKey(namespace, fingerprint)
  const redis = getRedis()
  if (redis) {
    try {
      const raw = await redis.get(key)
      return raw ? JSON.parse(raw) : null
    } catch (err) {
      console.error('Redis get error:', err.message)
    }
  }
  return readFileCache()[key] ?? null
}

export async function setCached(namespace, fingerprint, items, ttl = ttlSeconds()) {
  const key   = buildKey(namespace, fingerprint)
  const entry = { items, cachedAt: new Date().toISOString() }
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(entry), 'EX', ttl)
      return
    } catch (err) {
      console.error('Redis set error:', err.message)
    }
  }
  const data = readFileCache()
  data[key]  = entry
  writeFileCache(data)
}
