import { randomUUID } from 'node:crypto'
import type {
  ReadingAnswerComparisonEntry,
  ReadingPracticeAnalysisArtifacts,
  ReadingPracticeAnalysisSignals,
  ReadingPracticeAnswers,
  ReadingPracticeHighlightRecord,
  ReadingPracticeSingleAttemptAnalysis,
  ReadingPracticeSingleAttemptAnalysisInput,
  ReadingPracticePayload,
  ReadingPracticeQuestionTypePerformance,
  ReadingPracticeSubmission,
  ReadingPracticeQuestionTimelineEntry,
  ReadingQuestionInteraction
} from './contracts.js'

type AnyRecord = Record<string, unknown>

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeQuestionId(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  const direct = raw.match(/^q(\d+)$/)
  if (direct) return `q${Number(direct[1])}`
  const numeric = raw.match(/^(\d+)$/)
  return numeric ? `q${Number(numeric[1])}` : raw
}

function normalizeToken(value: unknown): string {
  if (value == null) return ''
  const cleaned = String(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'`()[\]{}<>.,;:!?]+|[\s"'`()[\]{}<>.,;:!?]+$/g, '')
  if (!cleaned) return ''

  const lowered = cleaned.toLowerCase()
  if (['true', 't', 'yes', 'y'].includes(lowered)) return 'true'
  if (['false', 'f', 'no', 'n'].includes(lowered)) return 'false'
  if (['ng', 'notgiven', 'not-given'].includes(lowered)) return 'not given'
  if (/^[a-z]$/i.test(cleaned)) return cleaned.toUpperCase()
  const leadingOption = cleaned.match(/^([A-Za-z])(?:[.)])?\s+/)
  if (leadingOption && cleaned.length > 2) return leadingOption[1].toUpperCase()
  return cleaned
}

function splitAnswerTokens(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeToken(entry)).filter(Boolean)
  }

  const raw = String(value == null ? '' : value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return []

  if (/^[A-Za-z](?:\s*[,/;，、]\s*[A-Za-z])+$/.test(raw)) {
    return raw.split(/[,/;，、]/).map((entry) => normalizeToken(entry)).filter(Boolean)
  }
  if (/^[A-Za-z](?:\s+[A-Za-z])+$/.test(raw)) {
    return raw.split(/\s+/).map((entry) => normalizeToken(entry)).filter(Boolean)
  }

  const normalized = normalizeToken(raw)
  return normalized ? [normalized] : []
}

function areTokensEquivalent(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeToken(left)
  const normalizedRight = normalizeToken(right)
  if (!normalizedLeft || !normalizedRight) return false
  if (normalizedLeft === normalizedRight) return true
  if (/^[A-Z]$/.test(normalizedLeft) || /^[A-Z]$/.test(normalizedRight)) return false
  const looseLeft = normalizedLeft.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const looseRight = normalizedRight.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return Boolean(looseLeft && looseLeft === looseRight)
}

function compareTokenSets(leftValues: unknown[], rightValues: unknown[]): boolean {
  const left = Array.from(new Set(leftValues.map((entry) => normalizeToken(entry)).filter(Boolean)))
  const right = Array.from(new Set(rightValues.map((entry) => normalizeToken(entry)).filter(Boolean)))
  return left.length === right.length
    && left.every((leftItem) => right.some((rightItem) => areTokensEquivalent(leftItem, rightItem)))
}

function toAnswerValue(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry == null ? '' : entry).trim()).filter(Boolean)
  }
  return String(value == null ? '' : value).trim()
}

function hasAnswer(value: string | string[]): boolean {
  return Array.isArray(value) ? value.some((entry) => String(entry || '').trim()) : Boolean(String(value || '').trim())
}

function formatAnswer(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).join(' / ')
  }
  return String(value == null ? '' : value).trim()
}

function questionKindMap(payload: ReadingPracticePayload): Map<string, string> {
  const result = new Map<string, string>()
  payload.questionGroups.forEach((group) => {
    const kind = String(group.kind || 'unknown').trim().toLowerCase() || 'unknown'
    group.questionIds.forEach((questionId) => {
      const normalized = normalizeQuestionId(questionId)
      if (normalized && (!result.has(normalized) || result.get(normalized) === 'unknown')) {
        result.set(normalized, kind)
      }
    })
  })
  return result
}

function getDisplayLabel(payload: ReadingPracticePayload, questionId: string): string {
  return String(payload.questionDisplayMap?.[questionId] || questionId.replace(/^q/i, '')).trim()
}

function normalizeAnswers(rawAnswers: unknown, questionOrder: string[]): ReadingPracticeAnswers {
  const source = isRecord(rawAnswers) ? rawAnswers : {}
  const output: ReadingPracticeAnswers = {}
  questionOrder.forEach((questionId) => {
    output[questionId] = toAnswerValue(source[questionId])
  })
  Object.entries(source).forEach(([rawKey, value]) => {
    const questionId = normalizeQuestionId(rawKey)
    if (!questionId || Object.prototype.hasOwnProperty.call(output, questionId)) return
    output[questionId] = toAnswerValue(value)
  })
  return output
}

function resolveMatchMode(
  correctAnswer: unknown,
  interaction?: ReadingQuestionInteraction
): ReadingAnswerComparisonEntry['matchMode'] {
  if (Array.isArray(correctAnswer) && interaction?.control === 'checkbox') return 'set'
  if (Array.isArray(correctAnswer)) return 'alternatives'
  return 'single'
}

function compareAnswer(
  userAnswer: string | string[],
  correctAnswer: unknown,
  interaction?: ReadingQuestionInteraction
) {
  const actualTokens = splitAnswerTokens(userAnswer)
  const expectedTokens = splitAnswerTokens(correctAnswer)
  const matchMode = resolveMatchMode(correctAnswer, interaction)

  if (!actualTokens.length && !expectedTokens.length) {
    return { isCorrect: null, actualTokens, expectedTokens, matchMode }
  }
  if (!actualTokens.length || !expectedTokens.length) {
    return { isCorrect: false, actualTokens, expectedTokens, matchMode }
  }
  if (matchMode === 'set') {
    return {
      isCorrect: compareTokenSets(actualTokens, expectedTokens),
      actualTokens,
      expectedTokens,
      matchMode
    }
  }
  if (matchMode === 'alternatives') {
    return {
      isCorrect: actualTokens.length === 1
        ? expectedTokens.some((token) => areTokensEquivalent(token, actualTokens[0]))
        : compareTokenSets(actualTokens, expectedTokens),
      actualTokens,
      expectedTokens,
      matchMode
    }
  }
  if (actualTokens.length > 1 || expectedTokens.length > 1) {
    return {
      isCorrect: compareTokenSets(actualTokens, expectedTokens),
      actualTokens,
      expectedTokens,
      matchMode
    }
  }
  return {
    isCorrect: areTokensEquivalent(actualTokens[0], expectedTokens[0]),
    actualTokens,
    expectedTokens,
    matchMode
  }
}

function questionWeight(correctAnswer: unknown, interaction?: ReadingQuestionInteraction): number {
  if (Array.isArray(correctAnswer) && interaction?.control === 'checkbox') {
    return Math.max(1, splitAnswerTokens(correctAnswer).length)
  }
  return 1
}

function normalizeDuration(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function normalizeEpochTimestamp(value: unknown): string | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? new Date(Math.floor(numeric)).toISOString() : null
}

function normalizeScrollY(value: unknown): number | null {
  const normalized = normalizeNonNegativeInteger(value)
  return normalized === null ? null : normalized
}

function normalizeTimerSnapshot(value: unknown): AnyRecord | null {
  if (!isRecord(value)) return null
  const output: AnyRecord = {}
  const numericFields = [
    'elapsedSeconds',
    'durationSeconds',
    'displaySeconds',
    'effectiveStartTimeMs',
    'effectiveEndTimeMs',
    'anchorMs',
    'limitSeconds',
    'pausedAtMs',
    'pausedOffsetMs',
    'actualEndTimeMs'
  ]
  numericFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(value, field)) return
    if (value[field] == null && field === 'pausedAtMs') {
      output[field] = null
      return
    }
    const normalized = normalizeNonNegativeInteger(value[field])
    if (normalized !== null) {
      output[field] = normalized
    }
  })
  if (typeof value.running === 'boolean') {
    output.running = value.running
  }
  const mode = typeof value.mode === 'string' ? value.mode.trim() : ''
  if (mode) output.mode = mode
  const source = typeof value.source === 'string' ? value.source.trim() : ''
  if (source) output.source = source
  return Object.keys(output).length ? output : null
}

function clampNumber(value: unknown, min = 0, max = 1): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.min(max, Math.max(min, numeric))
}

function roundNumber(value: unknown, digits = 4): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  const factor = 10 ** digits
  return Math.round(numeric * factor) / factor
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean)))
}

function normalizeHighlights(value: unknown): ReadingPracticeHighlightRecord[] {
  if (!Array.isArray(value)) return []
  const records: ReadingPracticeHighlightRecord[] = []
  value.forEach((entry) => {
    if (!isRecord(entry)) return
    const text = String(entry.text || entry.excerpt || '').trim()
    if (!text) return
    const scope = String(entry.scope || '').trim().toLowerCase()
    records.push({
      scope: scope === 'passage' || scope === 'questions' ? scope : 'unknown',
      text,
      kind: entry.kind === 'note' ? 'note' : 'highlight',
      questionId: normalizeQuestionId(entry.questionId) || null,
      startOffset: Number.isFinite(Number(entry.startOffset ?? entry.start)) ? Number(entry.startOffset ?? entry.start) : null,
      endOffset: Number.isFinite(Number(entry.endOffset ?? entry.end)) ? Number(entry.endOffset ?? entry.end) : null,
      before: String(entry.before || '').trim() || null,
      after: String(entry.after || '').trim() || null,
      occurrence: Number.isFinite(Number(entry.occurrence)) ? Math.max(0, Number(entry.occurrence)) : null,
      createdAt: normalizeIsoTimestamp(entry.createdAt) || null
    })
  })
  return records
}

function normalizeTimelineMap(value: unknown): Map<string, AnyRecord> {
  const timeline = new Map<string, AnyRecord>()
  if (!Array.isArray(value)) return timeline
  value.forEach((entry) => {
    if (!isRecord(entry)) return
    const questionId = normalizeQuestionId(entry.questionId)
    if (!questionId) return
    timeline.set(questionId, entry)
  })
  return timeline
}

function buildQuestionTimelineLite(
  attempt: AnyRecord,
  questionOrder: string[],
  answers: ReadingPracticeAnswers,
  endTime: string,
  payload: ReadingPracticePayload
): ReadingPracticeQuestionTimelineEntry[] {
  const source = normalizeTimelineMap(attempt.questionTimelineLite || attempt.questionTimeline)
  return questionOrder.map((questionId) => {
    const entry = source.get(questionId) || {}
    const answered = hasAnswer(answers[questionId])
    const fallbackAnsweredAt = answered ? endTime : null
    const visitCount = normalizeNonNegativeInteger(entry.visitCount)
    const elapsedMs = normalizeNonNegativeInteger(entry.elapsedMs ?? entry.durationMs)
    return {
      questionId,
      displayLabel: getDisplayLabel(payload, questionId),
      firstAnsweredAt: normalizeIsoTimestamp(entry.firstAnsweredAt) || fallbackAnsweredAt,
      lastAnsweredAt: normalizeIsoTimestamp(entry.lastAnsweredAt) || fallbackAnsweredAt,
      changeCount: Math.max(0, Math.round(Number(entry.changeCount) || 0)),
      ...(visitCount !== null ? { visitCount } : {}),
      ...(elapsedMs !== null ? { elapsedMs, durationMs: elapsedMs } : {})
    }
  })
}

function buildAnalysisSignals(
  attempt: AnyRecord,
  questionOrder: string[],
  answers: ReadingPracticeAnswers,
  questionTimelineLite: ReadingPracticeQuestionTimelineEntry[],
  duration: number,
  highlights: ReadingPracticeHighlightRecord[],
  markedQuestions: string[]
): ReadingPracticeAnalysisSignals {
  const questionCount = questionOrder.length
  const unansweredCount = questionOrder.reduce((count, questionId) => (
    hasAnswer(answers[questionId]) ? count : count + 1
  ), 0)
  const changedAnswerCount = questionTimelineLite.reduce((count, entry) => (
    entry.changeCount > 0 ? count + 1 : count
  ), 0)
  const answeredCount = Math.max(0, questionCount - unansweredCount)
  const explicitInteractionCount = Number(attempt.interactionCount ?? attempt.interactionsCount)
  const interactionCount = Number.isFinite(explicitInteractionCount) && explicitInteractionCount >= 0
    ? explicitInteractionCount
    : answeredCount
  return {
    questionCount,
    unansweredCount,
    changedAnswerCount,
    interactionDensity: roundNumber(interactionCount / Math.max(duration / 60, 1), 4),
    markedQuestionCount: markedQuestions.length,
    highlightCount: highlights.length
  }
}

function cloneQuestionTypePerformance(
  source: Record<string, ReadingPracticeQuestionTypePerformance>,
  confidence: number
): Record<string, ReadingPracticeQuestionTypePerformance> {
  const output: Record<string, ReadingPracticeQuestionTypePerformance> = {}
  Object.entries(source).forEach(([kind, entry]) => {
    output[kind] = {
      ...entry,
      questionIds: Array.isArray(entry.questionIds) ? entry.questionIds.slice() : [],
      confidence: roundNumber(entry.confidence ?? confidence, 4)
    }
  })
  return output
}

function getWeakestKind(questionTypePerformance: Record<string, ReadingPracticeQuestionTypePerformance>) {
  return Object.values(questionTypePerformance)
    .filter((entry) => entry.total > 0)
    .sort((left, right) => left.accuracy - right.accuracy || right.total - left.total)[0] || null
}

function buildSingleAttemptAnalysis(
  input: ReadingPracticeSingleAttemptAnalysisInput,
  wrongQuestions: string[]
): ReadingPracticeSingleAttemptAnalysis {
  const rateDenominator = input.analysisSignals.questionCount > 0 ? input.analysisSignals.questionCount : 1
  const unansweredRate = clampNumber(input.analysisSignals.unansweredCount / rateDenominator, 0, 1)
  const changedAnswerRate = clampNumber(input.analysisSignals.changedAnswerCount / rateDenominator, 0, 1)
  const weakestKind = getWeakestKind(input.questionTypePerformance)
  const diagnosis: ReadingPracticeSingleAttemptAnalysis['diagnosis'] = []

  if (input.accuracy < 0.6) {
    diagnosis.push({
      type: 'low_accuracy',
      severity: 'high',
      message: '正确率偏低，先复盘错题证据定位，再做同题型训练。',
      evidence: { accuracy: roundNumber(input.accuracy) }
    })
  }
  if (unansweredRate > 0.2) {
    diagnosis.push({
      type: 'unanswered',
      severity: 'medium',
      message: '未作答比例偏高，说明时间分配或定位策略不稳定。',
      evidence: { unansweredCount: input.analysisSignals.unansweredCount, unansweredRate: roundNumber(unansweredRate) }
    })
  }
  if (changedAnswerRate > 0.25) {
    diagnosis.push({
      type: 'answer_changes',
      severity: 'medium',
      message: '改答题目偏多，需要检查第一次定位证据是否可靠。',
      evidence: { changedAnswerCount: input.analysisSignals.changedAnswerCount, changedAnswerRate: roundNumber(changedAnswerRate) }
    })
  }
  if (weakestKind && weakestKind.accuracy < 0.8) {
    diagnosis.push({
      type: 'weak_question_kind',
      severity: weakestKind.accuracy < 0.5 ? 'high' : 'medium',
      message: `题型「${weakestKind.kind}」是本次最弱项。`,
      evidence: { kind: weakestKind.kind, correct: weakestKind.correct, total: weakestKind.total, accuracy: roundNumber(weakestKind.accuracy) }
    })
  }
  if (!diagnosis.length) {
    diagnosis.push({
      type: 'stable_attempt',
      severity: 'low',
      message: '本次作答结构稳定，优先复盘错题证据和可迁移规则。',
      evidence: { accuracy: roundNumber(input.accuracy), wrongQuestionCount: wrongQuestions.length }
    })
  }

  const nextActions: ReadingPracticeSingleAttemptAnalysis['nextActions'] = []
  if (wrongQuestions.length) {
    nextActions.push({
      type: 'review_wrong_questions',
      target: wrongQuestions.slice(0, 6).join(', '),
      instruction: '逐题核对原文定位句、题干改写和错误选项排除理由。',
      evidence: { wrongQuestions: wrongQuestions.slice(0, 12) }
    })
  }
  if (weakestKind) {
    nextActions.push({
      type: 'drill_question_kind',
      target: weakestKind.kind,
      instruction: `连续完成 2 组「${weakestKind.kind}」专项题，只记录定位线索和错因。`,
      evidence: { kind: weakestKind.kind, accuracy: roundNumber(weakestKind.accuracy) }
    })
  }
  if (unansweredRate > 0 || changedAnswerRate > 0) {
    nextActions.push({
      type: 'stabilize_timing',
      target: 'timing',
      instruction: '下一套题按题组限时推进，超过阈值先标记再跳过。',
      evidence: { unansweredRate: roundNumber(unansweredRate), changedAnswerRate: roundNumber(changedAnswerRate) }
    })
  }
  if (!nextActions.length) {
    nextActions.push({
      type: 'maintain_strength',
      target: 'mixed_review',
      instruction: '保留混合题复盘节奏，重点提炼本套题可复用的定位规则。',
      evidence: { accuracy: roundNumber(input.accuracy) }
    })
  }

  return {
    summary: {
      accuracy: roundNumber(input.accuracy),
      durationSec: input.durationSec,
      unansweredRate: roundNumber(unansweredRate),
      changedAnswerRate: roundNumber(changedAnswerRate)
    },
    radar: {
      byQuestionKind: Object.values(input.questionTypePerformance),
      byPassageCategory: input.category ? [{
        category: input.category,
        total: input.totalQuestions,
        correct: input.correctAnswers,
        accuracy: roundNumber(input.accuracy),
        confidence: input.confidence
      }] : []
    },
    diagnosis: diagnosis.slice(0, 4),
    nextActions: nextActions.slice(0, 3),
    confidence: input.confidence
  }
}

function buildSubmissionAnalysisFields(params: {
  payload: ReadingPracticePayload
  attempt: AnyRecord
  sessionId: string
  questionOrder: string[]
  answers: ReadingPracticeAnswers
  answerComparison: Record<string, ReadingAnswerComparisonEntry>
  scoreCorrect: number
  scoreTotal: number
  duration: number
  endTime: string
  questionTypePerformance: Record<string, ReadingPracticeQuestionTypePerformance>
  wrongQuestions: string[]
}): ReadingPracticeAnalysisArtifacts {
  const highlights = normalizeHighlights(params.attempt.highlights)
  const markedQuestions = normalizeStringArray(params.attempt.markedQuestions).map(normalizeQuestionId).filter(Boolean)
  const questionTimelineLite = buildQuestionTimelineLite(
    params.attempt,
    params.questionOrder,
    params.answers,
    params.endTime,
    params.payload
  )
  const analysisSignals = buildAnalysisSignals(
    params.attempt,
    params.questionOrder,
    params.answers,
    questionTimelineLite,
    params.duration,
    highlights,
    markedQuestions
  )
  const totalQuestions = params.scoreTotal
  const accuracy = totalQuestions > 0 ? params.scoreCorrect / totalQuestions : 0
  const unknownQuestions = Math.max(0, Number(params.questionTypePerformance.unknown?.total) || 0)
  const missingKindRatio = totalQuestions > 0 ? clampNumber(unknownQuestions / totalQuestions, 0, 1) : 1
  const baseConfidence = 0.75
  const confidence = roundNumber(clampNumber(baseConfidence * (1 - missingKindRatio), 0.2, 0.9), 4)
  const questionTypePerformance = cloneQuestionTypePerformance(params.questionTypePerformance, confidence)
  const input: ReadingPracticeSingleAttemptAnalysisInput = {
    version: '1.0.0',
    generatedAt: params.endTime,
    examId: params.payload.examId,
    sessionId: params.sessionId,
    type: 'reading',
    category: params.payload.meta.category ? String(params.payload.meta.category) : null,
    totalQuestions,
    correctAnswers: params.scoreCorrect,
    accuracy: roundNumber(accuracy),
    durationSec: params.duration,
    dataQuality: {
      confidence: baseConfidence,
      source: 'practice_reading_session'
    },
    analysisSignals,
    questionTimelineLite,
    questionTypePerformance,
    unknownQuestions,
    missingKindRatio: roundNumber(missingKindRatio),
    confidence,
    markedQuestions,
    highlights
  }
  const analysis = buildSingleAttemptAnalysis(input, params.wrongQuestions)
  return {
    highlights,
    markedQuestions,
    analysisSignals,
    questionTimelineLite,
    singleAttemptAnalysisInput: input,
    singleAttemptAnalysis: analysis,
    singleAttemptAnalysisLlm: params.attempt.singleAttemptAnalysisLlm || null
  }
}

export function createReadingPracticeSubmission(
  payload: ReadingPracticePayload,
  attempt: AnyRecord = {},
  settings: AnyRecord = {}
): ReadingPracticeSubmission {
  const now = new Date()
  const sessionId = typeof settings.sessionId === 'string' && settings.sessionId.trim()
    ? settings.sessionId.trim()
    : `reading-${randomUUID()}`
  const questionOrder = Array.isArray(payload.questionOrder) ? payload.questionOrder.map(normalizeQuestionId).filter(Boolean) : []
  const answers = normalizeAnswers(attempt.answers, questionOrder)
  const kinds = questionKindMap(payload)
  const answerComparison: Record<string, ReadingAnswerComparisonEntry> = {}
  const questionTypePerformance: Record<string, ReadingPracticeQuestionTypePerformance> = {}
  const selectedAnswers: Record<string, string> = {}
  const wrongQuestions: string[] = []
  let correct = 0
  let total = 0

  questionOrder.forEach((questionId) => {
    const userAnswer = Object.prototype.hasOwnProperty.call(answers, questionId) ? answers[questionId] : ''
    const correctAnswer = payload.answerKey[questionId]
    const interaction = payload.interactionModel[questionId]
    const comparison = compareAnswer(userAnswer, correctAnswer, interaction)
    const weight = questionWeight(correctAnswer, interaction)
    const questionKind = kinds.get(questionId) || 'unknown'
    const displayLabel = getDisplayLabel(payload, questionId)
    total += weight
    if (comparison.isCorrect === true) {
      correct += weight
    }
    if (hasAnswer(userAnswer)) {
      selectedAnswers[displayLabel] = formatAnswer(userAnswer)
    }
    if (comparison.isCorrect === false) {
      wrongQuestions.push(displayLabel)
    }

    if (!questionTypePerformance[questionKind]) {
      questionTypePerformance[questionKind] = {
        total: 0,
        correct: 0,
        accuracy: 0,
        questionIds: [],
        kind: questionKind
      }
    }
    questionTypePerformance[questionKind].total += weight
    if (comparison.isCorrect === true) {
      questionTypePerformance[questionKind].correct += weight
    }
    if (!questionTypePerformance[questionKind].questionIds.includes(questionId)) {
      questionTypePerformance[questionKind].questionIds.push(questionId)
    }

    answerComparison[questionId] = {
      questionId,
      displayLabel,
      userAnswer,
      correctAnswer,
      normalizedUserAnswer: comparison.actualTokens,
      normalizedCorrectAnswer: comparison.expectedTokens,
      isCorrect: comparison.isCorrect,
      weight,
      control: interaction?.control,
      source: interaction?.source,
      questionKind,
      matchMode: comparison.matchMode
    }
  })

  Object.values(questionTypePerformance).forEach((entry) => {
    entry.accuracy = entry.total > 0 ? entry.correct / entry.total : 0
  })

  const accuracy = total > 0 ? correct / total : 0
  const timerSnapshot = normalizeTimerSnapshot(attempt.timerSnapshot)
  const duration = normalizeDuration(
    attempt.duration
    ?? attempt.durationSec
    ?? attempt.elapsedSeconds
    ?? timerSnapshot?.durationSeconds
    ?? timerSnapshot?.elapsedSeconds
  )
  const endTime = normalizeIsoTimestamp(attempt.endTime)
    || normalizeEpochTimestamp(timerSnapshot?.actualEndTimeMs)
    || now.toISOString()
  const startTime = normalizeIsoTimestamp(attempt.startTime ?? attempt.startedAt)
    || normalizeEpochTimestamp(timerSnapshot?.effectiveStartTimeMs)
  const effectiveEndTimeMs = normalizeNonNegativeInteger(attempt.effectiveEndTimeMs ?? timerSnapshot?.effectiveEndTimeMs)
  const effectiveEndTime = normalizeIsoTimestamp(attempt.effectiveEndTime)
    || (effectiveEndTimeMs !== null ? new Date(effectiveEndTimeMs).toISOString() : null)
  const scrollY = normalizeScrollY(attempt.scrollY)
  const analysisFields = buildSubmissionAnalysisFields({
    payload,
    attempt,
    sessionId,
    questionOrder,
    answers,
    answerComparison,
    scoreCorrect: correct,
    scoreTotal: total,
    duration,
    endTime,
    questionTypePerformance,
    wrongQuestions
  })

  const submission: ReadingPracticeSubmission = {
    sessionId,
    activity: 'reading',
    status: 'submitted',
    assetId: payload.examId,
    examId: payload.examId,
    submittedAt: endTime,
    startTime,
    endTime,
    duration,
    readOnly: true,
    answers,
    correctAnswers: payload.answerKey,
    answerComparison,
    scoreInfo: {
      correct,
      total,
      totalQuestions: total,
      accuracy,
      percentage: Math.round(accuracy * 100),
      duration,
      source: 'practice_reading_session'
    },
    questionTypePerformance,
    highlights: analysisFields.highlights,
    markedQuestions: analysisFields.markedQuestions,
    analysisSignals: analysisFields.analysisSignals,
    questionTimelineLite: analysisFields.questionTimelineLite,
    singleAttemptAnalysisInput: analysisFields.singleAttemptAnalysisInput,
    singleAttemptAnalysis: analysisFields.singleAttemptAnalysis,
    singleAttemptAnalysisLlm: analysisFields.singleAttemptAnalysisLlm,
    analysisArtifacts: analysisFields,
    readingCoachSnapshot: null,
    readingCoachTranscript: [],
    coachContext: {
      submitted: true,
      score: Math.round(accuracy * 100),
      wrongQuestions,
      selectedAnswers
    },
    metadata: {
      examId: payload.examId,
      examTitle: payload.meta.title,
      title: payload.meta.title,
      category: payload.meta.category || '',
      frequency: payload.meta.frequency || '',
      type: 'reading',
      examType: 'reading',
      practiceMode: 'single',
      renderMode: 'vue-reading',
      questionCount: payload.questionCount,
      ...(timerSnapshot ? { timerSnapshot } : {}),
      ...(effectiveEndTime ? { effectiveEndTime } : {}),
      ...(effectiveEndTimeMs !== null ? { effectiveEndTimeMs } : {}),
      ...(scrollY !== null ? { scrollY } : {})
    },
    legacy: {
      eventType: 'PRACTICE_COMPLETE',
      renderMode: 'vue-reading',
      practiceMode: 'single'
    }
  }
  return submission
}
