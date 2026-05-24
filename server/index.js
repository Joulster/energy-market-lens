import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import { fetchDayAheadPrices, fetchActualGeneration, fetchBalancingData } from './entso-e.js'
import { fetchImbalancePrices } from './tennet.js'
import { generateNarrative, generateRegulatoryWatch, generateCustomerSignals } from './claude.js'
import { getCached, setCached } from './researchCache.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const distDir    = path.join(__dirname, '..', 'dist')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(distDir))

const PORT = process.env.PORT || 3001

app.get('/health', (req, res) => res.json({ ok: true }))

app.get('/api/day-ahead-prices', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    const data = await fetchDayAheadPrices(startDate, endDate)
    res.json({ ok: true, data })
  } catch (err) {
    console.error('day-ahead-prices error:', err.message)
    res.json({ ok: false, error: err.message, data: null })
  }
})

app.get('/api/actual-generation', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    const data = await fetchActualGeneration(startDate, endDate)
    res.json({ ok: true, data })
  } catch (err) {
    console.error('actual-generation error:', err.message)
    res.json({ ok: false, error: err.message, data: null })
  }
})

app.get('/api/imbalance-prices', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    const data = await fetchImbalancePrices(startDate, endDate)
    res.json({ ok: true, data })
  } catch (err) {
    // TenneT CSV API is decommissioned — awaiting new developer API token
    res.json({ ok: false, error: 'TenneT API unavailable — token pending', data: null })
  }
})

app.get('/api/afrr', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    const data = await fetchBalancingData(startDate, endDate)
    res.json({ ok: true, data })
  } catch (err) {
    // TenneT NL does not publish A73/A85 balancing data to ENTSO-E TP
    res.json({ ok: false, error: 'Balancing data unavailable — TenneT token pending', data: null })
  }
})

app.post('/api/narrative', async (req, res) => {
  try {
    const { marketData, systemPrompt, startDate, endDate } = req.body
    if (!marketData) return res.status(400).json({ error: 'marketData required' })
    const narrative = await generateNarrative(marketData, systemPrompt, startDate, endDate)
    res.json({ ok: true, narrative })
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

    const fingerprint = JSON.stringify({ urls: enabledSources.map(s => s.url), days, prompt: systemPrompt ?? '' })
    const hit = await getCached('regulatory', fingerprint)
    if (hit) return res.json({ ok: true, items: hit.items, fromCache: true, cachedAt: hit.cachedAt })

    const items = await generateRegulatoryWatch(enabledSources, days, systemPrompt)
    await setCached('regulatory', fingerprint, items)
    res.json({ ok: true, items, fromCache: false, cachedAt: new Date().toISOString() })
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

    const fingerprint = JSON.stringify({ urls: sources.map(s => s.url), companies, topics, days, prompt: systemPrompt ?? '' })
    const hit = await getCached('customer-signals', fingerprint)
    if (hit) return res.json({ ok: true, items: hit.items, fromCache: true, cachedAt: hit.cachedAt })

    const items = await generateCustomerSignals(sources, companies, topics, days, systemPrompt)
    await setCached('customer-signals', fingerprint, items)
    res.json({ ok: true, items, fromCache: false, cachedAt: new Date().toISOString() })
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
