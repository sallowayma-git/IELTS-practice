function hasOwnKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

export const EVALUATION_CONTRACT_VERSION = 'v4'

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
    .map((item) => {
      const issues = Array.isArray(item.issues)
        ? item.issues.map((entry) => normalizeText(entry)).filter(Boolean)
        : []
      const comment = pickText(item.comment, item.summary, item.strength)
      const analysis = pickText(item.analysis, item.risk, issues.join('；'))
      const feedback = pickText(item.feedback)
      const paragraphIndex = coerceInteger(
        item.paragraph_index ?? item.paragraphIndex ?? item.paragraph
      )

      return {
        paragraph_index: paragraphIndex,
        comment,
        analysis,
        feedback
      }
    })
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
      // V4 SentenceFeedback uses `sentence`; legacy uses `original`
      const original = typeof item.original === 'string'
        ? item.original
        : (typeof item.sentence === 'string' ? item.sentence : '')
      if (!original.trim()) return null

      const errors = Array.isArray(item.errors)
        ? item.errors.map(normalizeSentenceError).filter(Boolean)
        : []

      // V4 may only provide kind + correction without range errors
      if (errors.length === 0) {
        const kind = pickText(item.kind, item.type)
        const correction = pickText(item.correction, item.corrected)
        if (kind && correction) {
          errors.push({
            type: kind,
            word: original.trim(),
            reason: kind,
            correction,
            range: {
              start: 0,
              end: original.length,
              unit: 'utf16'
            }
          })
        }
      }

      const normalized = {
        index: coerceInteger(item.index) ?? index,
        original,
        errors
      }

      const corrected = pickText(item.corrected, item.correction)
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

function extractEvaluationPayload(payload) {
  const parsed = normalizeMap(parseEvaluationPayload(payload))
  if (!hasOwnKeys(parsed)) return {}

  // WritingEvaluationRecord wraps V4 under `result`
  const nestedResult = parsed.result || parsed.result_json
  if (nestedResult && typeof nestedResult === 'object' && !Array.isArray(nestedResult)) {
    return normalizeMap(nestedResult)
  }
  return parsed
}

function isV4Evaluation(parsed) {
  const schema = parsed.schemaVersion ?? parsed.schema_version ?? parsed.contract_version
  if (schema === 4 || schema === '4' || schema === 'v4') return true
  const score = normalizeMap(parsed.score)
  if (score.taskResponse != null || score.task_response != null) return true
  if (score.overall != null && (score.coherence != null || score.lexical != null || score.grammar != null)) {
    return true
  }
  const feedback = parsed.feedback
  return !!(feedback && typeof feedback === 'object' && !Array.isArray(feedback) && (
    feedback.overall != null || Array.isArray(feedback.sentences) || Array.isArray(feedback.plan)
  ))
}

function countWords(text) {
  const normalized = normalizeText(text)
  if (!normalized) return 0
  return normalized.split(/\s+/).filter(Boolean).length
}

function normalizeTaskType(value) {
  const raw = normalizeText(value).toLowerCase().replace(/[\s-]+/g, '_')
  if (raw === 'task1' || raw === 'task_1' || raw === 't1') return 'task1'
  if (raw === 'task2' || raw === 'task_2' || raw === 't2') return 'task2'
  return raw || ''
}

export function resolveEvaluationConsumption(payload, overrides = {}) {
  const parsed = extractEvaluationPayload(payload)
  const analysis = pickMap(parsed.analysis)
  const review = pickMap(parsed.review)
  const diagnosis = pickMap(parsed.diagnosis)
  const degradation = pickMap(parsed.degradation)
  // V4 feedback is an object; legacy feedback may be a plain string
  const feedbackObject = (
    parsed.feedback
    && typeof parsed.feedback === 'object'
    && !Array.isArray(parsed.feedback)
  )
    ? normalizeMap(parsed.feedback)
    : {}
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
    || feedbackObject.paragraphs
    || review.review_blocks
    || review.paragraph_reviews
  )
  const hasDegradation = hasOwnKeys(degradation)
    || String(parsed.status || '').toLowerCase() === 'degraded'
  const reviewDegraded = pickBoolean(
    overrides.review_degraded,
    parsed.review_degraded,
    review.review_degraded,
    reviewStatusEnvelope.degraded,
    hasDegradation ? true : null
  )
  const reviewStatus = {
    ...reviewStatusEnvelope,
    status: pickText(
      reviewStatusEnvelope.status,
      review.status,
      degradation.stage,
      reviewDegraded ? 'degraded' : 'completed'
    ) || 'completed',
    degraded: reviewDegraded,
    reason: pickText(reviewStatusEnvelope.reason, degradation.reason)
  }
  const score = {
    total_score: pickScore(
      overrides.total_score,
      scoreEnvelope.total_score,
      scoreEnvelope.overall,
      parsed.total_score,
      parsed.overall
    ),
    task_achievement: pickScore(
      overrides.task_achievement,
      scoreEnvelope.task_achievement,
      scoreEnvelope.taskResponse,
      scoreEnvelope.task_response,
      scoreEnvelope.TR,
      scoreEnvelope.tr,
      parsed.task_achievement
    ),
    coherence_cohesion: pickScore(
      overrides.coherence_cohesion,
      scoreEnvelope.coherence_cohesion,
      scoreEnvelope.coherence,
      scoreEnvelope.CC,
      scoreEnvelope.cc,
      parsed.coherence_cohesion
    ),
    lexical_resource: pickScore(
      overrides.lexical_resource,
      scoreEnvelope.lexical_resource,
      scoreEnvelope.lexical,
      scoreEnvelope.LR,
      scoreEnvelope.lr,
      parsed.lexical_resource
    ),
    grammatical_range: pickScore(
      overrides.grammatical_range,
      scoreEnvelope.grammatical_range,
      scoreEnvelope.grammar,
      scoreEnvelope.GRA,
      scoreEnvelope.gra,
      parsed.grammatical_range
    )
  }

  const feedbackText = pickText(
    overrides.overall_feedback,
    overrides.feedback,
    parsed.overall_feedback,
    typeof parsed.feedback === 'string' ? parsed.feedback : '',
    feedbackObject.overall,
    review.overall_feedback
  )

  const contractVersion = pickText(parsed.contract_version)
    || (
      isV4Evaluation(parsed)
        || parsed.schemaVersion === 4
        || parsed.schema_version === 4
        ? 'v4'
        : ''
    )
    || 'legacy'

  return {
    raw: parsed,
    contract_version: contractVersion,
    score,
    feedback: feedbackText,
    task_analysis: pickMap(
      overrides.task_analysis,
      parsed.task_analysis,
      diagnosis.task,
      analysis.task_analysis,
      review.task_analysis
    ),
    band_rationale: pickMap(
      overrides.band_rationale,
      parsed.band_rationale,
      diagnosis.rationale,
      analysis.band_rationale,
      review.band_rationale
    ),
    improvement_plan: pickList(
      overrides.improvement_plan,
      parsed.improvement_plan,
      feedbackObject.plan,
      analysis.improvement_plan,
      review.improvement_plan
    ),
    review_blocks: reviewBlocks,
    sentences: normalizeSentences(pickSentences(
      overrides.sentences,
      parsed.sentences,
      feedbackObject.sentences,
      parsed.sentence_errors,
      review.sentences
    )),
    rewrite_suggestions: pickList(
      parsed.rewrite_suggestions,
      feedbackObject.rewrites,
      review.rewrite_suggestions
    ),
    input_context: inputContext,
    review_degraded: reviewDegraded,
    review_status: reviewStatus,
    topic_text: pickText(overrides.topic_text, parsed.topic_text, inputContext.topic_text),
    topic_source: pickText(overrides.topic_source, parsed.topic_source, inputContext.topic_source)
  }
}

/**
 * Single adapter for Result + History: HistoryDetailResponse / attempt+evaluation → UI shape.
 * Maps V4 nested fields (contentText, score.*, feedback.*) onto legacy UI keys.
 */
export function adaptWritingHistoryDetail(detail) {
  if (!detail || typeof detail !== 'object') return null

  const summary = normalizeMap(detail.summary)
  const attempt = normalizeMap(detail.attempt || detail)
  const evaluationRaw = detail.evaluation || detail.evaluation_json || attempt.evaluation || null
  const evaluationPayload = extractEvaluationPayload(evaluationRaw)

  const content = pickText(
    attempt.contentText,
    attempt.content_text,
    attempt.content,
    detail.content
  )
  const topicText = pickText(
    attempt.promptSnapshot,
    attempt.prompt_snapshot,
    attempt.titleSnapshot,
    attempt.title_snapshot,
    summary.title,
    detail.topic_text,
    detail.display_topic_title
  )
  const topicTitle = pickText(
    attempt.titleSnapshot,
    attempt.title_snapshot,
    summary.title,
    detail.topic_title,
    detail.display_topic_title,
    topicText
  ) || 'Untitled'

  const resolved = resolveEvaluationConsumption(evaluationPayload, {
    total_score: attempt.scoreValue ?? attempt.score_value ?? summary.scoreValue ?? summary.score_value,
    topic_text: topicText
  })

  const normalizedTaskType = normalizeTaskType(
    attempt.taskType
    || attempt.task_type
    || summary.taskType
    || summary.task_type
    || evaluationPayload.taskType
    || evaluationPayload.task_type
    || detail.task_type
  )
  const taskType = normalizedTaskType === 'task1' || normalizedTaskType === 'task2'
    ? normalizedTaskType
    : null

  const wordCount = coerceInteger(
    attempt.wordCount
    ?? attempt.word_count
    ?? detail.word_count
  ) ?? countWords(content)

  const submittedAt = pickText(
    attempt.submittedAt,
    attempt.submitted_at,
    summary.submittedAt,
    summary.submitted_at,
    detail.submitted_at
  )

  return {
    id: attempt.id || summary.id || detail.id,
    ...attempt,
    content,
    content_text: content,
    contentText: content,
    word_count: wordCount,
    wordCount,
    total_score: resolved.score.total_score,
    task_achievement: resolved.score.task_achievement,
    coherence_cohesion: resolved.score.coherence_cohesion,
    lexical_resource: resolved.score.lexical_resource,
    grammatical_range: resolved.score.grammatical_range,
    overall_feedback: resolved.feedback,
    feedback: resolved.feedback,
    task_analysis: resolved.task_analysis,
    band_rationale: resolved.band_rationale,
    improvement_plan: resolved.improvement_plan,
    review_blocks: resolved.review_blocks,
    sentences: resolved.sentences,
    topic_text: topicText,
    topic_title: topicTitle,
    display_topic_title: topicTitle,
    topic_source: pickText(attempt.topic_source, detail.topic_source, resolved.topic_source),
    submitted_at: submittedAt,
    task_type: taskType,
    model_name: pickText(detail.model_name, attempt.model, attempt.model_name),
    evaluation: evaluationPayload,
    evaluation_json: evaluationPayload,
    review_degraded: resolved.review_degraded,
    source: 'tauri'
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
