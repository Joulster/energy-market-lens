/**
 * Customer Signals eval runner.
 *
 * Usage:
 *   LANGCHAIN_PROJECT=energy-market-lens-evals npm run eval:customer-signals
 *
 * NOTE: Makes real Sonnet + web_search API calls (3 examples × ~4 searches each).
 * Budget roughly $0.05–0.20 per run (customer signals use max_tokens: 6000).
 */

import 'dotenv/config'
import { evaluate } from 'langsmith/evaluation'
import { generateCustomerSignals } from '../server/claude.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataset   = JSON.parse(readFileSync(path.join(__dirname, 'datasets/customer-signals.json'), 'utf8'))

import {
  isNonEmptyArray,
  allItemsHaveRequiredFields,
  sourceContainsUrl,
  noNullSources,
} from './evaluators/regulatoryEvaluators.js'

async function customerSignalsTarget({ sources, companies, topics, lookback, systemPromptOverride }) {
  const { result } = await generateCustomerSignals(sources, companies, topics, lookback, systemPromptOverride)
  return { result }
}

const promptVersion = process.env.CUSTOMER_SIGNALS_PROMPT_VERSION ?? 'v1'

console.log(`Running customer-signals eval (prompt_version=${promptVersion}) against ${dataset.length} examples...`)
console.log('Warning: this makes live Sonnet + web_search calls (~$0.05–0.20 total).')

await evaluate(customerSignalsTarget, {
  data:             dataset,
  evaluators:       [
    isNonEmptyArray,
    allItemsHaveRequiredFields,
    sourceContainsUrl,
    noNullSources,
  ],
  experimentPrefix: 'customer-signals',
  metadata:         { promptVersion },
  maxConcurrency:   1,
})

console.log('Done. Check LangSmith Experiments tab for results.')
