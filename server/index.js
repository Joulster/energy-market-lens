import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import { traceable } from 'langsmith/traceable'
import { fetchDayAheadPrices, fetchActualGeneration, fetchCapacityPrices } from './entso-e.js'
import { fetchImbalancePrices, fetchAFRRData } from './tennet.js'
import { generateNarrative, generateRegulatoryWatch, generateCustomerSignals } from './claude.js'
import { getCached, setCached } from './researchCache.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const distDir    = path.join(__dirname, '..', 'dist')

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(express.static(distDir))

const PORT = process.env.PORT || 3001

// ── Market data cache helpers ─────────────────────────────────────────────────
// Historical ranges (endDate < today) never change → 24-hour TTL.
// Queries including today may update intraday → 1-hour TTL.
function marketDataTTL(endDate) {
  if (!endDate) return 3600
  const today = new Date().toISOString().slice(0, 10)
  return endDate < today ? 86400 : 3600
}

async function cachedMarketRoute(res, namespace, startDate, endDate, fetcher, salt = '') {
  const fingerprint = `${salt}${startDate ?? 'default'}|${endDate ?? 'default'}`
  const hit = await getCached(namespace, fingerprint)
  if (hit) return res.json({ ok: true, data: hit.items, fromCache: true })
  try {
    const data = await fetcher()
    await setCached(namespace, fingerprint, data, marketDataTTL(endDate))
    res.json({ ok: true, data })
  } catch (err) {
    console.error(`${namespace} error:`, err.message)
    res.json({ ok: false, error: err.message, data: null })
  }
}

app.get('/health', (req, res) => res.json({ ok: true }))

app.get('/api/day-ahead-prices', async (req, res) => {
  const { startDate, endDate } = req.query
  await cachedMarketRoute(res, 'market:day-ahead', startDate, endDate,
    () => fetchDayAheadPrices(startDate, endDate))
})

app.get('/api/actual-generation', async (req, res) => {
  const { startDate, endDate } = req.query
  await cachedMarketRoute(res, 'market:generation', startDate, endDate,
    () => fetchActualGeneration(startDate, endDate))
})

app.get('/api/imbalance-prices', async (req, res) => {
  const { startDate, endDate } = req.query
  await cachedMarketRoute(res, 'market:imbalance', startDate, endDate,
    () => fetchImbalancePrices(startDate, endDate))
})

app.get('/api/afrr', async (req, res) => {
  const { startDate, endDate } = req.query
  await cachedMarketRoute(res, 'market:afrr', startDate, endDate, async () => {
    // TenneT: energy prices (dispatch_up / dispatch_down from settlement-prices)
    // ENTSO-E: capacity prices (A81/B95, A51=aFRR A13, A52=FCR A01) — 4-h blocks
    const [tennet, entsoe] = await Promise.all([
      fetchAFRRData(startDate, endDate),
      fetchCapacityPrices(startDate, endDate).catch(err => {
        console.warn('ENTSO-E capacity prices fetch failed:', err.message)
        return { afrrHourly: [], fcrHourly: [] }
      }),
    ])
    return {
      afrrEnergyRaw: tennet.rawPoints,    // TenneT 15-min energy prices (Up / Down)
      afrrHourly:    entsoe.afrrHourly,   // ENTSO-E 4-h block capacity prices (Up + Down)
      fcrHourly:     entsoe.fcrHourly,    // ENTSO-E 4-h block FCR clearing price (symmetric)
    }
  }, 'v9|')
})

const NARRATIVE_TTL = 24 * 60 * 60 // 24 hours

// ── Traceable route handlers ──────────────────────────────────────────────────
// Each handler is wrapped so LangSmith shows a parent "route" trace containing
// the cache-hit decision. When fromCache is true, the child LLM span never fires
// — the trace correctly records 0 tokens for that request.

const _narrativeHandler = traceable(
  async function narrativeRoute({ marketData, systemPrompt, startDate, endDate, forceRefresh }) {
    const fingerprint = JSON.stringify({ startDate, endDate, prompt: systemPrompt ?? '' })
    if (!forceRefresh) {
      const hit = await getCached('narrative', fingerprint)
      if (hit) return { narrative: hit.items, fromCache: true, cachedAt: hit.cachedAt }
    }
    const { result: narrative } = await generateNarrative(marketData, systemPrompt, startDate, endDate)
    await setCached('narrative', fingerprint, narrative, NARRATIVE_TTL)
    return { narrative, fromCache: false, cachedAt: new Date().toISOString() }
  },
  { name: 'narrativeRoute', run_type: 'chain', metadata: { service: 'energy-market-lens' } }
)

const _regulatoryHandler = traceable(
  async function regulatoryRoute({ enabledSources, days, systemPrompt }) {
    const fingerprint = JSON.stringify({ urls: enabledSources.map(s => s.url), days, prompt: systemPrompt ?? '' })
    const hit = await getCached('regulatory', fingerprint)
    if (hit) return { items: hit.items, fromCache: true, cachedAt: hit.cachedAt }
    const { result: items } = await generateRegulatoryWatch(enabledSources, days, systemPrompt)
    await setCached('regulatory', fingerprint, items)
    return { items, fromCache: false, cachedAt: new Date().toISOString() }
  },
  { name: 'regulatoryRoute', run_type: 'chain', metadata: { service: 'energy-market-lens' } }
)

const _customerSignalsHandler = traceable(
  async function customerSignalsRoute({ sources, companies, topics, days, systemPrompt }) {
    const fingerprint = JSON.stringify({ urls: sources.map(s => s.url), companies, topics, days, prompt: systemPrompt ?? '' })
    const hit = await getCached('customer-signals', fingerprint)
    if (hit) return { items: hit.items, fromCache: true, cachedAt: hit.cachedAt }
    const { result: items } = await generateCustomerSignals(sources, companies, topics, days, systemPrompt)
    await setCached('customer-signals', fingerprint, items)
    return { items, fromCache: false, cachedAt: new Date().toISOString() }
  },
  { name: 'customerSignalsRoute', run_type: 'chain', metadata: { service: 'energy-market-lens' } }
)

app.post('/api/narrative', async (req, res) => {
  try {
    const { marketData, systemPrompt, startDate, endDate, forceRefresh } = req.body
    if (!marketData) return res.status(400).json({ error: 'marketData required' })
    const { narrative, fromCache, cachedAt } = await _narrativeHandler({ marketData, systemPrompt, startDate, endDate, forceRefresh })
    res.json({ ok: true, narrative, fromCache, cachedAt })
  } catch (err) {
    console.error('narrative error:', err.message)
    res.json({ ok: false, error: err.message, narrative: null })
  }
})

app.post('/api/regulatory', async (req, res) => {
  try {
    const { sources, lookback, systemPrompt } = req.body
    if (!sources || !Array.isArray(sources)) return res.status(400).json({ error: 'sources array required' })
    const enabledSources = sources.filter(s => s.enabled)
    if (enabledSources.length === 0) return res.status(400).json({ error: 'No enabled sources' })
    const days = Number.isInteger(lookback) ? lookback : 90
    const { items, fromCache, cachedAt } = await _regulatoryHandler({ enabledSources, days, systemPrompt })
    res.json({ ok: true, items, fromCache, cachedAt })
  } catch (err) {
    console.error('regulatory error:', err.message)
    res.json({ ok: false, error: err.message })
  }
})

app.post('/api/customer-signals', async (req, res) => {
  try {
    const { sources, companies, topics, lookback, systemPrompt } = req.body
    if (!sources  || !Array.isArray(sources)  || sources.length  === 0) return res.status(400).json({ error: 'sources must be a non-empty array'  })
    if (!companies|| !Array.isArray(companies)|| companies.length=== 0) return res.status(400).json({ error: 'companies must be a non-empty array' })
    if (!topics   || !Array.isArray(topics)   || topics.length   === 0) return res.status(400).json({ error: 'topics must be a non-empty array'    })
    const days = Number.isInteger(lookback) ? lookback : 90
    const { items, fromCache, cachedAt } = await _customerSignalsHandler({ sources, companies, topics, days, systemPrompt })
    res.json({ ok: true, items, fromCache, cachedAt })
  } catch (err) {
    console.error('customer-signals error:', err.message)
    res.json({ ok: false, error: err.message })
  }
})

// Catch-all: serve React app for any non-API route (client-side routing)
app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

app.listen(PORT, () => {
  console.log(`Energy Market Lens API server running on http://localhost:${PORT}`)
  if (!process.env.ENTSOE_API_KEY)    console.warn('  ⚠  ENTSOE_API_KEY not set — will use mock data')
  if (!process.env.ANTHROPIC_API_KEY) console.warn('  ⚠  ANTHROPIC_API_KEY not set — narrative disabled')
})
