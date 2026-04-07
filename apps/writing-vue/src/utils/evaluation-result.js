function hasOwnKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

export const EVALUATION_CONTRACT_VERSION = 'v3'

export const TASK_ANALYSIS_LABELS = {
  task_fulfillment: '任务完成度',
  overview_quality: '概述质量',
  key_features_coverage: '关键特征覆盖',
  data_support_quality: '数据支撑质量',
  prompt_response_quality: '题目回应质量',
  position_clarity: '立场清晰度',
  argument_development: '论证展开',
  conclusion_effectiveness: '结论有效性'
}

export const BAND_RATIONALE_LABELS = {
  task_achievement: '任务完成度',
  coherence_cohesion: '连贯与衔接',
  lexical_resource: '词汇丰富度',
  grammatical_range: '语法范围与准确性'
}

export function normalizeMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value
}

export function normalizeList(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

export function parseEvaluationPayload(value) {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return {}

  try {
    return normalizeMap(JSON.parse(value))
  } catch {
    return {}
  }
}

export function normalizeReviewBlocks(value) {
  if (!Array.isArray(value)) return []

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      paragraph_index: typeof item.paragraph_index === 'number'
        ? item.paragraph_index
        : (typeof item.paragraph === 'number' ? item.paragraph : null),
      comment: typeof item.comment === 'string'
        ? item.comment.trim()
        : (typeof item.strength === 'string' ? item.strength.trim() : ''),
      analysis: typeof item.analysis === 'string'
        ? item.analysis.trim()
        : (typeof item.risk === 'string' ? item.risk.trim() : ''),
      feedback: typeof item.feedback === 'string' ? item.feedback.trim() : ''
    }))
    .filter((item) => item.comment || item.analysis || item.feedback)
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function coerceInteger(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? numeric : null
}

function normalizeSentenceError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const range = normalizeMap(value.range)
  const start = coerceInteger(range.start ?? value.start_pos)
  const end = coerceInteger(range.end ?? value.end_pos)
  const type = normalizeText(value.type)
  const word = normalizeText(value.word)
  const reason = normalizeText(value.reason)
  const correction = normalizeText(value.correction)

  if (!type || !word || !reason || !correction) return null
  if (start === null || end === null || start < 0 || end < start) return null

  return {
    type,
    word,
    reason,
    correction,
    range: {
      start,
      end,
      unit: 'utf16'
    }
  }
}

export function normalizeSentences(value) {
  if (!Array.isArray(value)) return []

  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const original = typeof item.original === 'string' ? item.original : ''
      if (!original.trim()) return null

      const normalized = {
        index: coerceInteger(item.index) ?? index,
        original,
        errors: Array.isArray(item.errors)
          ? item.errors.map(normalizeSentenceError).filter(Boolean)
          : []
      }

      const corrected = normalizeText(item.corrected)
      if (corrected) {
        normalized.corrected = corrected
      }

      return normalized
    })
    .filter(Boolean)
}

function coerceScore(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function pickText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) {
      return normalized
    }
  }
  return ''
}

function pickMap(...values) {
  for (const value of values) {
    const map = normalizeMap(value)
    if (hasOwnKeys(map)) {
      return map
    }
  }
  return {}
}

function pickList(...values) {
  for (const value of values) {
    const list = normalizeList(value)
    if (list.length > 0) {
      return list
    }
  }
  return []
}

function pickScore(...values) {
  for (const value of values) {
    const score = coerceScore(value)
    if (score !== null) {
      return score
    }
  }
  return null
}

function pickSentences(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value
    }
  }
  return []
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  return null
}

function pickBoolean(...values) {
  for (const value of values) {
    const normalized = normalizeBoolean(value)
    if (normalized !== null) {
      return normalized
    }
  }
  return false
}

export function resolveEvaluationConsumption(payload, overrides = {}) {
  const parsed = normalizeMap(parseEvaluationPayload(payload))
  const analysis = pickMap(parsed.analysis)
  const review = pickMap(parsed.review)
  const reviewStatusEnvelope = pickMap(
    overrides.review_status,
    parsed.review_status,
    review.review_status
  )
  const scoreEnvelope = pickMap(overrides.score, parsed.scorecard, parsed.score)
  const inputContext = pickMap(
    overrides.input_context,
    parsed.input_context,
    analysis.input_context
  )
  const reviewBlocks = normalizeReviewBlocks(
    parsed.review_blocks
    || parsed.paragraph_reviews
    || review.review_blocks
    || review.paragraph_reviews
  )
  const reviewDegraded = pickBoolean(
    overrides.review_degraded,
    parsed.review_degraded,
    review.review_degraded,
    reviewStatusEnvelope.degraded
  )
  const reviewStatus = {
    ...reviewStatusEnvelope,
    status: pickText(reviewStatusEnvelope.status, review.status, reviewDegraded ? 'degraded' : 'completed') || 'completed',
    degraded: reviewDegraded
  }
  const score = {
    total_score: pickScore(overrides.total_score, scoreEnvelope.total_score, parsed.total_score),
    task_achievement: pickScore(overrides.task_achievement, scoreEnvelope.task_achievement, parsed.task_achievement),
    coherence_cohesion: pickScore(overrides.coherence_cohesion, scoreEnvelope.coherence_cohesion, parsed.coherence_cohesion),
    lexical_resource: pickScore(overrides.lexical_resource, scoreEnvelope.lexical_resource, parsed.lexical_resource),
    grammatical_range: pickScore(overrides.grammatical_range, scoreEnvelope.grammatical_range, parsed.grammatical_range)
  }

  return {
    raw: parsed,
    contract_version: pickText(parsed.contract_version) || 'legacy',
    score,
    feedback: pickText(
      overrides.overall_feedback,
      overrides.feedback,
      parsed.overall_feedback,
      parsed.feedback,
      review.overall_feedback
    ),
    task_analysis: pickMap(
      overrides.task_analysis,
      parsed.task_analysis,
      analysis.task_analysis,
      review.task_analysis
    ),
    band_rationale: pickMap(
      overrides.band_rationale,
      parsed.band_rationale,
      analysis.band_rationale,
      review.band_rationale
    ),
    improvement_plan: pickList(
      overrides.improvement_plan,
      parsed.improvement_plan,
      analysis.improvement_plan,
      review.improvement_plan
    ),
    review_blocks: reviewBlocks,
    sentences: normalizeSentences(pickSentences(parsed.sentences, review.sentences)),
    rewrite_suggestions: pickList(parsed.rewrite_suggestions, review.rewrite_suggestions),
    input_context: inputContext,
    review_degraded: reviewDegraded,
    review_status: reviewStatus,
    topic_text: pickText(overrides.topic_text, parsed.topic_text, inputContext.topic_text),
    topic_source: pickText(overrides.topic_source, parsed.topic_source, inputContext.topic_source)
  }
}

export function buildEvaluationView(payload, overrides = {}) {
  const resolved = resolveEvaluationConsumption(payload, overrides)

  return {
    raw: resolved.raw,
    contractVersion: resolved.contract_version,
    score: resolved.score,
    overallFeedback: resolved.feedback,
    taskAnalysis: resolved.task_analysis,
    bandRationale: resolved.band_rationale,
    improvementPlan: resolved.improvement_plan,
    reviewBlocks: resolved.review_blocks,
    sentences: resolved.sentences,
    rewriteSuggestions: resolved.rewrite_suggestions,
    inputContext: resolved.input_context,
    reviewDegraded: resolved.review_degraded,
    reviewStatus: resolved.review_status,
    topicText: resolved.topic_text,
    topicSource: resolved.topic_source
  }
}

export function formatLabeledEntries(source, labels = {}) {
  return Object.entries(normalizeMap(source))
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => ({
      label: labels[key] || humanizeKey(key),
      value: value.trim()
    }))
}

function humanizeKey(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
