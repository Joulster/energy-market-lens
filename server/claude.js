import Anthropic from '@anthropic-ai/sdk'
import { traceable } from 'langsmith/traceable'
import {
  NARRATIVE_PROMPT_DAY_AHEAD,
  NARRATIVE_PROMPT_BALANCING,
  NARRATIVE_PROMPT_ANCILLARY,
  REGULATORY_PROMPT,
  CUSTOMER_SIGNALS_PROMPT,
  PROMPT_VERSIONS,
} from './prompts.js'

// Client is created lazily so a missing API key doesn't crash the server on startup
let _client = null
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function periodStr(sectionData, startDate, endDate) {
  if (startDate && endDate) return `${startDate} to ${endDate}`
  const p = sectionData?.period
  return p ? `${p.from} to ${p.to}` : 'last 7 days'
}

// Call Haiku with a plain-text system prompt and user message.
// Returns the raw text response (stripped of code fences), or null if the
// model returned the literal string "null".
async function callHaiku(systemPrompt, userMessage) {
  const t0 = Date.now()
  const message = await getClient().messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 512,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  })
  const latencyMs = Date.now() - t0

  const textBlock = message.content.find(b => b.type === 'text')
  if (!textBlock) throw new Error('No text block in Claude response')

  const text = textBlock.text
    .replace(/^```(?:\w+)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  return {
    result:        text === 'null' ? null : text,
    _langsmithMeta: {
      inputTokens:         message.usage.input_tokens,
      outputTokens:        message.usage.output_tokens,
      cacheReadTokens:     message.usage.cache_read_input_tokens    ?? 0,
      cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
      model:               message.model,
      stopReason:          message.stop_reason,
      latencyMs,
    },
  }
}

// ── generateDayAheadNarrative ────────────────────────────────────────────────
export const generateDayAheadNarrative = traceable(
  async function generateDayAheadNarrative(sectionData, systemPromptOverride, startDate, endDate) {
    const systemPrompt = systemPromptOverride?.trim() || NARRATIVE_PROMPT_DAY_AHEAD
    const { dayAheadPrice, negativeHoursPerWeek } = sectionData

    const dailyHLAStr = dayAheadPrice?.dailyHLA?.length
      ? dayAheadPrice.dailyHLA.map(d =>
          `  ${d.date}: avg ${fmt(d.avg)}, high ${fmt(d.high)}, low ${fmt(d.low)}, negHours ${d.negativeHours}`
        ).join('\n')
      : '  N/A'

    const w = dayAheadPrice?.bestArbitrageWindow
    const arbitrageStr = w
      ? `Pre-computed arbitrage window (use these numbers directly — do not recompute):\n` +
        `  ${w.date}: charge ${w.chargeWindow.startHour}:00–${w.chargeWindow.endHour}:00 avg ${fmt(w.chargeWindow.avgPrice)} EUR/MWh` +
        ` | discharge ${w.dischargeWindow.startHour}:00–${w.dischargeWindow.endHour}:00 avg ${fmt(w.dischargeWindow.avgPrice)} EUR/MWh` +
        ` | spread ${fmt(w.dischargeWindow.avgPrice)} − (${fmt(w.chargeWindow.avgPrice)}) = ${fmt(w.spread)} EUR/MWh`
      : null

    const negHoursStr = negativeHoursPerWeek?.length
      ? negativeHoursPerWeek.map(d => `  ${d.week}: ${d.count} hours`).join('\n')
      : '  N/A'

    const userMessage =
`NL day-ahead price data for ${periodStr(sectionData, startDate, endDate)}:

Period average: ${fmt(dayAheadPrice?.avgEurMwh)} EUR/MWh
Period high: ${fmt(dayAheadPrice?.highEurMwh)} EUR/MWh
Period low: ${fmt(dayAheadPrice?.lowEurMwh)} EUR/MWh
Intra-period range: ${fmt(dayAheadPrice?.rangeEurMwh)} EUR/MWh
Total negative-price hours: ${dayAheadPrice?.negativeHours ?? 'N/A'}

Daily HLA:
${dailyHLAStr}

${arbitrageStr ?? 'No arbitrage window available.'}

Negative-price hours per week:
${negHoursStr}

Write the summary now.`

    return callHaiku(systemPrompt, userMessage)
  },
  {
    name:     'generateDayAheadNarrative',
    run_type: 'llm',
    metadata: { model: 'claude-haiku-4-5', prompt_version: PROMPT_VERSIONS.narrativeDayAhead },
  }
)

// ── generateBalancingNarrative ────────────────────────────────────────────────
export const generateBalancingNarrative = traceable(
  async function generateBalancingNarrative(sectionData, systemPromptOverride, startDate, endDate) {
    const systemPrompt = systemPromptOverride?.trim() || NARRATIVE_PROMPT_BALANCING
    const b = sectionData?.balancing

    if (!b) {
      return { result: null, _langsmithMeta: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, model: 'claude-haiku-4-5', stopReason: 'skipped', latencyMs: 0 } }
    }

    // Find the highest and lowest day for trend context
    const sorted = [...(b.daily ?? [])].sort((a, x) => a.midPrice - x.midPrice)
    const lowestDay  = sorted[0]
    const highestDay = sorted[sorted.length - 1]

    const dailyStr = b.daily?.length
      ? b.daily.map(d => `  ${d.date}: ${fmt(d.midPrice)}`).join('\n')
      : '  N/A'

    const userMessage =
`NL imbalance midprice data for ${periodStr(sectionData, startDate, endDate)}:

Period average: ${fmt(b.avgMidPriceEurMwh)} EUR/MWh
Period high: ${fmt(b.highMidPriceEurMwh)} EUR/MWh${highestDay ? ` (${highestDay.date})` : ''}
Period low: ${fmt(b.lowMidPriceEurMwh)} EUR/MWh${lowestDay ? ` (${lowestDay.date})` : ''}
Range (high − low): ${fmt(b.rangeEurMwh)} EUR/MWh

Daily mid prices:
${dailyStr}

Write the summary now.`

    return callHaiku(systemPrompt, userMessage)
  },
  {
    name:     'generateBalancingNarrative',
    run_type: 'llm',
    metadata: { model: 'claude-haiku-4-5', prompt_version: PROMPT_VERSIONS.narrativeBalancing },
  }
)

// ── generateAncillaryNarrative ────────────────────────────────────────────────
export const generateAncillaryNarrative = traceable(
  async function generateAncillaryNarrative(sectionData, systemPromptOverride, startDate, endDate) {
    const systemPrompt = systemPromptOverride?.trim() || NARRATIVE_PROMPT_ANCILLARY
    const a = sectionData?.ancillaryServices

    if (!a) {
      return { result: null, _langsmithMeta: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, model: 'claude-haiku-4-5', stopReason: 'skipped', latencyMs: 0 } }
    }

    const lines = []
    if (a.afrrCapacity) {
      lines.push('aFRR Capacity:')
      lines.push(`  Avg up clearing price: ${fmt(a.afrrCapacity.avgUpPriceEurMwPerH)} EUR/MW/h | Avg up procured: ${fmt(a.afrrCapacity.avgUpMW)} MW`)
      lines.push(`  Avg down clearing price: ${fmt(a.afrrCapacity.avgDownPriceEurMwPerH)} EUR/MW/h | Avg down procured: ${fmt(a.afrrCapacity.avgDownMW)} MW`)
    }
    if (a.afrrEnergy) {
      lines.push('aFRR Energy:')
      lines.push(`  Avg up activation price: ${fmt(a.afrrEnergy.avgUpEurMwh)} EUR/MWh`)
      lines.push(`  Avg down activation price: ${fmt(a.afrrEnergy.avgDownEurMwh)} EUR/MWh`)
    }
    if (a.fcr) {
      lines.push('FCR:')
      lines.push(`  Avg clearing price: ${fmt(a.fcr.avgPriceEurMwPerH)} EUR/MW/h | Avg procured: ${fmt(a.fcr.avgCapacityMW)} MW`)
    }
    if (!lines.length) {
      return { result: null, _langsmithMeta: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, model: 'claude-haiku-4-5', stopReason: 'skipped', latencyMs: 0 } }
    }

    const userMessage =
`NL ancillary services data for ${periodStr(sectionData, startDate, endDate)}:

${lines.join('\n')}

Write the summary now.`

    return callHaiku(systemPrompt, userMessage)
  },
  {
    name:     'generateAncillaryNarrative',
    run_type: 'llm',
    metadata: { model: 'claude-haiku-4-5', prompt_version: PROMPT_VERSIONS.narrativeAncillaryServices },
  }
)

// ── Bracket-depth JSON array extractor ───────────────────────────────────────
// Immune to greedy-regex failures caused by trailing text that contains ]
// (markdown links, footnotes, numbered references, etc.).
// Falls back to extracting all complete objects when the array is truncated.
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

// ── generateRegulatoryWatch ──────────────────────────────────────────────────
export const generateRegulatoryWatch = traceable(
  async function generateRegulatoryWatch(enabledSources, lookback, systemPromptOverride) {
    const today    = new Date().toISOString().slice(0, 10)
    const cutoff   = new Date()
    cutoff.setDate(cutoff.getDate() - lookback)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const sourceList = enabledSources
      .map((s, i) => `${i + 1}. ${s.name} — ${s.url}`)
      .join('\n')

    const basePrompt   = systemPromptOverride?.trim() || REGULATORY_PROMPT
    const systemPrompt = basePrompt
      .replace(/\[TODAY DATE\]/g, today)
      .replace(/\[CUTOFF DATE\]/g, cutoffStr)
      .replace(/\[LOOKBACK DAYS\]/g, lookback)
      .replace(/\[SOURCE LIST\]/g, sourceList)

    const t0 = Date.now()
    const message = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: 'Search for regulatory developments now. Use targeted queries that include the current year and month names to find recent publications.' }],
    })
    const latencyMs = Date.now() - t0

    const textBlocks = message.content.filter(b => b.type === 'text')
    const raw = textBlocks.at(-1)?.text ?? ''
    const result = parseJsonArray(raw)

    return {
      result,
      _langsmithMeta: {
        inputTokens:         message.usage.input_tokens,
        outputTokens:        message.usage.output_tokens,
        cacheReadTokens:     message.usage.cache_read_input_tokens    ?? 0,
        cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
        model:               message.model,
        stopReason:          message.stop_reason,
        latencyMs,
      },
    }
  },
  {
    name:     'generateRegulatoryWatch',
    run_type: 'llm',
    metadata: { model: 'claude-sonnet-4-6', prompt_version: PROMPT_VERSIONS.regulatory },
  }
)

// ── generateCustomerSignals ──────────────────────────────────────────────────
export const generateCustomerSignals = traceable(
  async function generateCustomerSignals(sources, companies, topics, lookback, systemPromptOverride) {
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

    const t0 = Date.now()
    const message = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: 'Search for customer signals now. Use targeted queries that include company names, the current year and month names to find recent publications.' }],
    })
    const latencyMs = Date.now() - t0

    const textBlocks = message.content.filter(b => b.type === 'text')
    const raw = textBlocks.at(-1)?.text ?? ''
    const result = parseJsonArray(raw)

    return {
      result,
      _langsmithMeta: {
        inputTokens:         message.usage.input_tokens,
        outputTokens:        message.usage.output_tokens,
        cacheReadTokens:     message.usage.cache_read_input_tokens    ?? 0,
        cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
        model:               message.model,
        stopReason:          message.stop_reason,
        latencyMs,
      },
    }
  },
  {
    name:     'generateCustomerSignals',
    run_type: 'llm',
    metadata: { model: 'claude-sonnet-4-6', prompt_version: PROMPT_VERSIONS.customerSignals },
  }
)
