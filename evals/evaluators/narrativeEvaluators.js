/**
 * Evaluators for the generateNarrative prompt.
 *
 * Each function receives (run, example) where:
 *   run.outputs — the object returned by narrativeTarget({ result })
 *   example     — the dataset entry { inputs, expected }
 *
 * Returns { key, score, comment? }
 *   score: 1 = pass, 0 = fail (fractional scores are allowed)
 */

export function hasRequiredKeys(run, example) {
  const output   = run.outputs?.result
  const required = example.expected?.hasAllKeys ?? ['dayAhead', 'balancing', 'ancillaryServices']
  if (!output || typeof output !== 'object') {
    return { key: 'has_required_keys', score: 0, comment: 'Output is not an object' }
  }
  const missing = required.filter(k => !(k in output))
  return {
    key:     'has_required_keys',
    score:   missing.length === 0 ? 1 : 0,
    comment: missing.length ? `Missing: ${missing.join(', ')}` : 'All keys present',
  }
}

export function balancingIsNull(run, example) {
  if (!example.expected?.balancingIsNull) return null  // not applicable for this example
  const output = run.outputs?.result
  const score  = output?.balancing === null ? 1 : 0
  return {
    key:     'balancing_is_null',
    score,
    comment: score ? 'OK' : `Expected null, got: ${JSON.stringify(output?.balancing)}`,
  }
}

export function ancillaryIsNull(run, example) {
  if (!example.expected?.ancillaryIsNull) return null
  const output = run.outputs?.result
  const score  = output?.ancillaryServices === null ? 1 : 0
  return {
    key:     'ancillary_is_null',
    score,
    comment: score ? 'OK' : `Expected null, got: ${JSON.stringify(output?.ancillaryServices)}`,
  }
}

export function dayAheadIsNonEmptyString(run) {
  const val   = run.outputs?.result?.dayAhead
  const score = typeof val === 'string' && val.trim().length > 20 ? 1 : 0
  return {
    key:     'day_ahead_is_string',
    score,
    comment: score ? `${val.length} chars` : `Got: ${JSON.stringify(val)}`,
  }
}

export function noMarkdownFences(run) {
  const text  = JSON.stringify(run.outputs?.result ?? '')
  const score = text.includes('```') ? 0 : 1
  return {
    key:     'no_markdown_fences',
    score,
    comment: score ? 'Clean' : 'Found ``` in output',
  }
}

export function noArbitrageSentence(run, example) {
  if (!example.expected?.noArbitrageSentence) return null
  const val   = run.outputs?.result?.dayAhead ?? ''
  // Arbitrage sentence typically contains "battery", "charge", or "discharge"
  const hasArbitrageLanguage = /battery|charg|discharg|arbitrage/i.test(val)
  const score = hasArbitrageLanguage ? 0 : 1
  return {
    key:     'no_arbitrage_sentence',
    score,
    comment: score ? 'Correctly omitted' : 'Found arbitrage language without window data',
  }
}

export function zeroNegHoursAcknowledged(run, example) {
  if (!example.expected?.zeroNegHours) return null
  const val   = run.outputs?.result?.dayAhead ?? ''
  // Should mention "zero", "no negative", or "0 negative" hours
  const acknowledgesZero = /zero|no negative|0 negative|no hours/i.test(val)
  const score = acknowledgesZero ? 1 : 0
  return {
    key:     'zero_neg_hours_acknowledged',
    score,
    comment: score ? 'OK' : 'Did not explicitly mention zero negative hours',
  }
}
