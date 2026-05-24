// Weekly in-memory cache for expensive research calls (Regulatory Watch, Customer Signals).
// Cache key includes the ISO week string (YYYY-Www) so entries automatically become stale
// at the start of each Monday without any explicit TTL bookkeeping.

const store = new Map()

function weekStr() {
  const d = new Date()
  // ISO week: find Monday of the current week
  const day = d.getUTCDay() || 7          // treat Sunday as 7
  d.setUTCDate(d.getUTCDate() - day + 1)  // rewind to Monday
  return d.toISOString().slice(0, 10)      // YYYY-MM-DD of that Monday
}

function buildKey(namespace, fingerprint) {
  return `${namespace}:${weekStr()}:${fingerprint}`
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
