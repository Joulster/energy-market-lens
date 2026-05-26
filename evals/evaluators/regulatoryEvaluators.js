/**
 * Evaluators for generateRegulatoryWatch and generateCustomerSignals.
 *
 * Each function receives (run, example) where:
 *   run.outputs — the object returned by the target function
 *   example     — the dataset entry { inputs, expected }
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// ── Shared evaluators (used by both regulatory and customer-signals) ─────────

export function isNonEmptyArray(run) {
  const items = run.outputs?.result
  const score = Array.isArray(items) && items.length > 0 ? 1 : 0
  return {
    key:     'is_non_empty_array',
    score,
    comment: score ? `${items.length} items` : `Got: ${JSON.stringify(items)?.slice(0, 80)}`,
  }
}

export function allItemsHaveRequiredFields(run, example) {
  const items    = run.outputs?.result
  const required = example.expected?.requiredFields ?? []
  if (!Array.isArray(items) || items.length === 0 || required.length === 0) {
    return { key: 'required_fields', score: 0, comment: 'Empty array or no required fields' }
  }
  const results = items.map(item => required.every(k => k in item && item[k] !== null && item[k] !== undefined))
  const passing = results.filter(Boolean).length
  const score   = passing / results.length
  return {
    key:     'required_fields',
    score,
    comment: `${passing}/${results.length} items have all required fields`,
  }
}

// ── Regulatory-specific evaluators ───────────────────────────────────────────

export function dateFieldIsValidOrNull(run) {
  const items = run.outputs?.result
  if (!Array.isArray(items) || items.length === 0) return { key: 'valid_dates', score: 0, comment: 'Empty' }
  const scores = items.map(item => item.date === null || ISO_DATE.test(item.date) ? 1 : 0)
  const score  = scores.reduce((a, b) => a + b, 0) / scores.length
  const bad    = scores.filter(s => s === 0).length
  return {
    key:     'valid_dates',
    score,
    comment: bad ? `${bad} items have invalid date format` : 'All dates valid or null',
  }
}

export function sourceContainsUrl(run) {
  const items = run.outputs?.result
  if (!Array.isArray(items) || items.length === 0) return { key: 'source_has_url', score: 0, comment: 'Empty' }
  const scores = items.map(item => {
    const s = typeof item.source === 'string' ? item.source : JSON.stringify(item.source ?? '')
    return /https?:\/\/\S+/.test(s) ? 1 : 0
  })
  const score = scores.reduce((a, b) => a + b, 0) / scores.length
  const bad   = scores.filter(s => s === 0).length
  return {
    key:     'source_has_url',
    score,
    comment: bad ? `${bad} items missing URL in source` : 'All sources include URL',
  }
}

export function noHallucinatedSourceDomains(run, example) {
  if (!example.expected?.noHallucinatedDomains) return null
  const items         = run.outputs?.result
  const allowedDomains = (example.inputs?.enabledSources ?? example.inputs?.sources ?? [])
    .map(s => {
      try { return new URL(s.url).hostname } catch { return s.url }
    })
  if (!Array.isArray(items) || allowedDomains.length === 0) {
    return { key: 'no_hallucinated_sources', score: 1, comment: 'N/A — no sources to check' }
  }
  const scores = items.map(item => {
    const src = typeof item.source === 'string' ? item.source : JSON.stringify(item.source ?? '')
    // Allow if the source string contains any allowed domain
    return allowedDomains.some(d => src.includes(d)) ? 1 : 0
  })
  const score = scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1)
  const bad   = scores.filter(s => s === 0).length
  return {
    key:     'no_hallucinated_sources',
    score,
    comment: bad
      ? `${bad} items reference domains not in enabled sources`
      : 'All sources are from enabled list',
  }
}

// ── Customer-signals-specific evaluators ─────────────────────────────────────

export function noNullSources(run) {
  const items = run.outputs?.result
  if (!Array.isArray(items) || items.length === 0) return { key: 'no_null_sources', score: 0, comment: 'Empty' }
  const scores = items.map(item =>
    item.source !== null && item.source !== undefined && item.source !== '' ? 1 : 0
  )
  const score = scores.reduce((a, b) => a + b, 0) / scores.length
  return {
    key:     'no_null_sources',
    score,
    comment: score === 1 ? 'All items have source' : `${scores.filter(s => s === 0).length} items missing source`,
  }
}
