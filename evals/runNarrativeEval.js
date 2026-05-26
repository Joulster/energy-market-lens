/**
 * Narrative eval runner.
 *
 * Usage:
 *   LANGCHAIN_PROJECT=energy-market-lens-evals npm run eval:narrative
 *
 * Runs each fixture in evals/datasets/narrative.json through generateNarrative,
 * scores outputs, and reports results in the LangSmith Experiments tab.
 *
 * NOTE: Run locally only — this makes real Haiku API calls.
 * Use LANGCHAIN_PROJECT=energy-market-lens-evals to keep eval traces separate
 * from production traces.
 */

import 'dotenv/config'
import { evaluate } from 'langsmith/evaluation'
import { generateNarrative } from '../server/claude.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataset   = JSON.parse(readFileSync(path.join(__dirname, 'datasets/narrative.json'), 'utf8'))

import {
  hasRequiredKeys,
  balancingIsNull,
  ancillaryIsNull,
  dayAheadIsNonEmptyString,
  noMarkdownFences,
  noArbitrageSentence,
  zeroNegHoursAcknowledged,
} from './evaluators/narrativeEvaluators.js'

// LangSmith evaluate() passes the inputs object to this function.
async function narrativeTarget({ marketData, systemPromptOverride, startDate, endDate }) {
  const { result } = await generateNarrative(marketData, systemPromptOverride, startDate, endDate)
  return { result }
}

// Null-filtering wrapper: some evaluators return null when not applicable
// (e.g. noArbitrageSentence only runs when expected.noArbitrageSentence is set).
// LangSmith ignores null evaluator results automatically — we filter them here
// for compatibility with both langsmith@0.7.x and newer versions.
function withNullFilter(evaluatorFn) {
  return function filteredEvaluator(run, example) {
    const result = evaluatorFn(run, example)
    return result ?? undefined  // undefined results are skipped by evaluate()
  }
}

const promptVersion = process.env.NARRATIVE_PROMPT_VERSION ?? 'v1'

console.log(`Running narrative eval (prompt_version=${promptVersion}) against ${dataset.length} examples...`)

await evaluate(narrativeTarget, {
  data:             dataset,
  evaluators:       [
    hasRequiredKeys,
    withNullFilter(balancingIsNull),
    withNullFilter(ancillaryIsNull),
    dayAheadIsNonEmptyString,
    noMarkdownFences,
    withNullFilter(noArbitrageSentence),
    withNullFilter(zeroNegHoursAcknowledged),
  ],
  experimentPrefix: 'narrative',
  metadata:         { promptVersion },
  maxConcurrency:   2,
})

console.log('Done. Check LangSmith Experiments tab for results.')
