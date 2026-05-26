/**
 * Regulatory Watch eval runner.
 *
 * Usage:
 *   LANGCHAIN_PROJECT=energy-market-lens-evals npm run eval:regulatory
 *
 * NOTE: Makes real Sonnet + web_search API calls (3 examples × ~4 searches each).
 * Budget roughly $0.05–0.15 per run. Use sparingly.
 */

import 'dotenv/config'
import { evaluate } from 'langsmith/evaluation'
import { generateRegulatoryWatch } from '../server/claude.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataset   = JSON.parse(readFileSync(path.join(__dirname, 'datasets/regulatory.json'), 'utf8'))

import {
  isNonEmptyArray,
  allItemsHaveRequiredFields,
  dateFieldIsValidOrNull,
  sourceContainsUrl,
  noHallucinatedSourceDomains,
} from './evaluators/regulatoryEvaluators.js'

async function regulatoryTarget({ enabledSources, lookback, systemPromptOverride }) {
  const { result } = await generateRegulatoryWatch(enabledSources, lookback, systemPromptOverride)
  return { result }
}

function withNullFilter(fn) {
  return (run, example) => fn(run, example) ?? undefined
}

const promptVersion = process.env.REGULATORY_PROMPT_VERSION ?? 'v1'

console.log(`Running regulatory eval (prompt_version=${promptVersion}) against ${dataset.length} examples...`)
console.log('Warning: this makes live Sonnet + web_search calls (~$0.05–0.15 total).')

await evaluate(regulatoryTarget, {
  data:             dataset,
  evaluators:       [
    isNonEmptyArray,
    allItemsHaveRequiredFields,
    dateFieldIsValidOrNull,
    sourceContainsUrl,
    withNullFilter(noHallucinatedSourceDomains),
  ],
  experimentPrefix: 'regulatory',
  metadata:         { promptVersion },
  maxConcurrency:   1,  // Sonnet web_search is slower; run sequentially to avoid rate limits
})

console.log('Done. Check LangSmith Experiments tab for results.')
