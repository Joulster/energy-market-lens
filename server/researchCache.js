// Monthly in-memory cache for expensive research calls (Regulatory Watch, Customer Signals).
// Cache key includes the YYYY-MM string so entries automatically become stale at the start
// of each month without any explicit TTL bookkeeping.

const store = new Map()

function monthStr() {
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

function buildKey(namespace, fingerprint) {
  return `${namespace}:${monthStr()}:${fingerprint}`
}

export function getCached(namespace, fingerprint) {
  return store.get(buildKey(namespace, fingerprint)) ?? null
}

export function setCached(namespace, fingerprint, items) {
  store.set(buildKey(namespace, fingerprint), {
    items,
    cachedAt: new Date().toISOString(),
  })
}
