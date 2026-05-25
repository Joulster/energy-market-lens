import Anthropic from '@anthropic-ai/sdk'
import { NARRATIVE_PROMPT, REGULATORY_PROMPT, CUSTOMER_SIGNALS_PROMPT } from './prompts.js'

// Client is created lazily so a missing API key doesn't crash the server on startup
let _client = null
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

export async function generateNarrative(marketData, systemPromptOverride, startDate, endDate) {
  const { period, dayAheadPrice, negativeHoursPerWeek } = marketData
  const systemPrompt = systemPromptOverride?.trim() || NARRATIVE_PROMPT

  const periodStr = (startDate && endDate)
    ? `${startDate} to ${endDate}`
    : period
    ? `${period.from} to ${period.to}`
    : 'last 7 days'

  const dailyHLAStr = dayAheadPrice?.dailyHLA?.length
    ? dayAheadPrice.dailyHLA.map(d => `  ${d.date}: avg ${fmt(d.avg)}, high ${fmt(d.high)}, low ${fmt(d.low)}, negHours ${d.negativeHours}`).join('\n')
    : '  N/A'

  const w = dayAheadPrice?.bestArbitrageWindow
  const arbitrageStr = w
    ? `  ${w.date}: charge ${w.chargeWindow.startHour}:00–${w.chargeWindow.endHour}:00 avg ${fmt(w.chargeWindow.avgPrice)} EUR/MWh` +
      ` | discharge ${w.dischargeWindow.startHour}:00–${w.dischargeWindow.endHour}:00 avg ${fmt(w.dischargeWindow.avgPrice)} EUR/MWh` +
      ` | spread ${fmt(w.dischargeWindow.avgPrice)} − (${fmt(w.chargeWindow.avgPrice)}) = ${fmt(w.spread)} EUR/MWh`
    : null

  const negHoursStr = negativeHoursPerWeek?.length
    ? negativeHoursPerWeek.map(d => `  ${d.week}: ${d.count} hours`).join('\n')
    : '  N/A'

  const userMessage = `NL energy market data for ${periodStr}:

Chart 1 — Day-Ahead Price NL (EUR/MWh):
- Period average: ${fmt(dayAheadPrice?.avgEurMwh)}
- Period high: ${fmt(dayAheadPrice?.highEurMwh)}
- Period low: ${fmt(dayAheadPrice?.lowEurMwh)}
- Intra-period range (high minus low): ${fmt(dayAheadPrice?.rangeEurMwh)}
- Negative price hours total: ${dayAheadPrice?.negativeHours ?? 'N/A'}
- Daily HLA breakdown:
${dailyHLAStr}
${arbitrageStr ? `- Pre-computed arbitrage windows (use these numbers directly — do not recompute):\n${arbitrageStr}\n` : ''}
Chart 2 — Negative Price Hours per Week:
${negHoursStr}

Write the briefing JSON now.`

  const message = await getClient().messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = message.content.find(b => b.type === 'text')
  if (!textBlock) throw new Error('No text block in Claude response')

  const stripped = textBlock.text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON found in Claude response')

  return JSON.parse(jsonMatch[0])
}

// Bracket-depth JSON array extractor — immune to greedy-regex failures caused by
// trailing text that contains ] (markdown links, footnotes, numbered references, etc.).
// Falls back to extracting all complete objects when the array is truncated (max_tokens hit).
function parseJsonArray(text) {
  const stripped = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  const start = stripped.indexOf('[')
  if (start === -1) throw new Error('No JSON array found in Claude response')

  // Happy path: find the matching closing bracket
  let depth = 0
  for (let i = start; i < stripped.length; i++) {
    if      (stripped[i] === '[') depth++
    else if (stripped[i] === ']') {
      depth--
      if (depth === 0) return JSON.parse(stripped.slice(start, i + 1))
    }
  }

  // Array was truncated (hit max_tokens) — salvage all complete objects
  const objects = []
  let j = 0
  while (j < stripped.length) {
    if (stripped[j] === '{') {
      let od = 0
      const os = j
      while (j < stripped.length) {
        if      (stripped[j] === '{') od++
        else if (stripped[j] === '}') { od--; if (od === 0) { j++; break } }
        j++
      }
      try { objects.push(JSON.parse(stripped.slice(os, j))) } catch { /* skip malformed */ }
    } else {
      j++
    }
  }
  if (objects.length) return objects
  throw new Error('Unclosed JSON array in Claude response')
}

function fmt(val) {
  if (val == null || isNaN(val)) return 'N/A'
  return Number(val).toFixed(2)
}

export async function generateRegulatoryWatch(enabledSources, lookback, systemPromptOverride) {
  const today    = new Date().toISOString().slice(0, 10)
  const cutoff   = new Date()
  cutoff.setDate(cutoff.getDate() - lookback)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const sourceList = enabledSources
    .map((s, i) => `${i + 1}. ${s.name} — ${s.url}`)
    .join('\n')

  const basePrompt  = systemPromptOverride?.trim() || REGULATORY_PROMPT
  const systemPrompt = basePrompt
    .replace(/\[TODAY DATE\]/g, today)
    .replace(/\[CUTOFF DATE\]/g, cutoffStr)
    .replace(/\[SOURCE LIST\]/g, sourceList)

  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: 'Search for regulatory developments now. Use targeted queries that include the current year and month names to find recent publications.' }],
  })

  const textBlocks = message.content.filter(b => b.type === 'text')
  const raw = textBlocks.at(-1)?.text ?? ''
  return parseJsonArray(raw)
}

export async function generateCustomerSignals(sources, companies, topics, lookback, systemPromptOverride) {
  const today    = new Date().toISOString().slice(0, 10)
  const cutoff   = new Date()
  cutoff.setDate(cutoff.getDate() - lookback)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const sourceList  = sources.map((s, i) => `${i + 1}. ${s.name} — ${s.url}`).join('\n')
  const companyList = companies.join(', ')
  const topicList   = topics.join(', ')

  const basePrompt   = systemPromptOverride?.trim() || CUSTOMER_SIGNALS_PROMPT
  const systemPrompt = basePrompt
    .replace(/\[TODAY DATE\]/g, today)
    .replace(/\[CUTOFF DATE\]/g, cutoffStr)
    .replace(/\[SOURCE LIST\]/g, sourceList)
    .replace(/\[COMPANY LIST\]/g, companyList)
    .replace(/\[TOPIC LIST\]/g, topicList)

  const message = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: systemPrompt,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: 'Search for customer signals now. Use targeted queries that include company names, the current year and month names to find recent publications.' }],
  })

  const textBlocks = message.content.filter(b => b.type === 'text')
  const raw = textBlocks.at(-1)?.text ?? ''
  return parseJsonArray(raw)
}
