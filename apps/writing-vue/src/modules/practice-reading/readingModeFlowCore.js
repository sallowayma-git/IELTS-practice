/**
 * Pure reading mode helpers: submission DTO mapping and suite navigation targets.
 * No Vue / DOM / network — Node tests own these shapes.
 */

export function mapTauriSubmissionToUi(rawSub, options = {}) {
  if (!rawSub) return null
  const assetId = options.assetId || null
  const answers = options.answers || {}
  const markedQuestions = Array.isArray(options.markedQuestions) ? options.markedQuestions : []
  const durationSec = Math.round(Number(options.durationSec) || 0)
  const source = options.source || 'tauri'
  const correctCount = rawSub.score && rawSub.score.correct
  const questionCount = rawSub.score && rawSub.score.total
  const percentage = rawSub.score && rawSub.score.percentage
  return {
    sessionId: rawSub.attempt && rawSub.attempt.id,
    attemptId: rawSub.attempt && rawSub.attempt.id,
    assetId,
    activity: 'reading',
    status: 'submitted',
    score: rawSub.score && rawSub.score.accuracy,
    correctCount,
    questionCount,
    percentage,
    scoreInfo: {
      correct: Number(correctCount) || 0,
      totalQuestions: Number(questionCount) || 0,
      percentage: Number.isFinite(Number(percentage)) ? Number(percentage) : 0
    },
    duration: durationSec,
    answers,
    markedQuestions,
    answerComparison: Object.fromEntries(
      (rawSub.comparisons || []).map((entry) => [
        entry.questionId,
        {
          questionId: entry.questionId,
          userAnswer: entry.userAnswer,
          correctAnswer: entry.correctAnswer,
          isCorrect: entry.isCorrect,
          weight: entry.weight,
          matchMode: entry.matchMode
        }
      ])
    ),
    source
  }
}

export function findNextActiveSuitePassage(sequence, currentAssetId) {
  const list = Array.isArray(sequence) ? sequence : []
  const current = String(currentAssetId || '').trim()
  return list.find((entry) => (
    entry?.status === 'active'
    && String(entry.assetId || '').trim()
    && String(entry.assetId || '').trim() !== current
  )) || null
}

export function buildSuiteReviewNavigationTarget(options = {}) {
  const {
    direction,
    currentIndex,
    sequence,
    suiteSessionId
  } = options
  const list = Array.isArray(sequence) ? sequence : []
  const index = Number(currentIndex)
  const offset = direction === 'prev' ? -1 : 1
  const targetIndex = index + offset
  const entry = list[targetIndex]
  const assetId = String(entry?.assetId || entry?.examId || '').trim()
  const sessionId = String(entry?.sessionId || entry?.attemptId || entry?.attempt_id || '').trim()
  if (!Number.isFinite(index) || index < 0 || !assetId) {
    return null
  }
  if (entry.status === 'submitted' && sessionId) {
    return {
      name: 'PracticeReadingReview',
      params: { assetId, sessionId },
      query: { suiteSessionId }
    }
  }
  if (entry.status === 'active') {
    return {
      name: 'PracticeReading',
      params: { assetId },
      query: { suiteSessionId }
    }
  }
  return null
}

export function buildEndlessNextRoute(nextAssetId, endlessSessionId) {
  const assetId = String(nextAssetId || '').trim()
  if (!assetId) return null
  const sessionId = String(endlessSessionId || '').trim()
  return {
    name: 'PracticeReading',
    params: { assetId },
    query: sessionId
      ? { mode: 'endless', endlessSessionId: sessionId }
      : { mode: 'endless' }
  }
}

/**
 * One availability predicate for the durable draft action. Modes which own
 * their own lifecycle (endless) and read-only views never pretend a draft was
 * persisted.
 */
export function canSnapshotReadingAnswers(options = {}) {
  return Boolean(
    options.isTauriRuntime
    && options.hasAsset
    && options.hasPayload
    && !options.loading
    && !options.submitting
    && !options.leaving
    && !options.readOnly
    && !options.isEndlessMode
  )
}

export default {
  mapTauriSubmissionToUi,
  findNextActiveSuitePassage,
  buildSuiteReviewNavigationTarget,
  buildEndlessNextRoute,
  canSnapshotReadingAnswers
}
