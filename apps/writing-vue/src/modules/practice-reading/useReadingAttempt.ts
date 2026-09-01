/**
 * Reading attempt view-model surface (Phase 6).
 * Practice pages consume this instead of assembling submission blobs.
 * Tauri-only product path.
 */

import {
  listReadingAssets,
  patchReadingAnswer,
  readingRepository,
  saveReadingDraft,
  submitReadingAttempt
} from '@/api/reading-repository.js'
import { isTauriRuntime } from '@/api/tauri-bridge.js'
import { READING_ACTIVITY, normalizeReadingRecordId } from './contracts'

type JsonMap = Record<string, unknown>

interface AnswerComparisonEntry {
  questionId?: string
  question_id?: string
  userAnswer?: unknown
  user_answer?: unknown
  correctAnswer?: unknown
  correct_answer?: unknown
  isCorrect?: boolean | null
  is_correct?: boolean | null
  weight?: number
  matchMode?: string
  match_mode?: string
  questionKind?: string | null
  question_kind?: string | null
}

interface ReadingAttemptSnapshot {
  id?: string
  assetId?: string
  status?: string
  correctCount?: number
  questionCount?: number
  scoreValue?: number | null
  durationMs?: number
  submittedAt?: string | null
  completedAt?: string | null
  titleSnapshot?: string | null
  [key: string]: unknown
}

interface ReadingScoreSnapshot {
  correct?: number
  total?: number
  accuracy?: number | null
  percentage?: number | null
  [key: string]: unknown
}

interface ReadingSubmitResult {
  attempt?: ReadingAttemptSnapshot
  score?: ReadingScoreSnapshot
  comparisons?: AnswerComparisonEntry[]
  idempotentReplay?: boolean
  [key: string]: unknown
}

interface SubmissionExtras {
  attemptId?: string | null
  assetId?: string | null
  answers?: JsonMap
  markedQuestions?: string[]
  questionTimeline?: ReadingQuestionProgress[]
  durationMs?: number | null
  titleSnapshot?: string | null
}

interface ReadingQuestionProgress {
  questionId: string
  changeCount?: number
  visitCount?: number
  elapsedMs?: number
  answeredAt?: string | null
}

interface PersistDraftInput {
  attemptId?: string | null
  assetId: string
  answers?: JsonMap
  markedQuestions?: string[]
  questionTimeline?: ReadingQuestionProgress[]
  assetRevision?: number | null
  assetFingerprint?: string | null
  titleSnapshot?: string | null
  idempotencyKey?: string | null
}

interface SubmitInput extends PersistDraftInput {
  durationMs?: number | null
}

interface ReadingAttemptDependencies {
  listReadingAssets?: typeof listReadingAssets
  saveReadingDraft?: typeof saveReadingDraft
  patchReadingAnswer?: typeof patchReadingAnswer
  submitReadingAttempt?: typeof submitReadingAttempt
  isTauri?: () => boolean
}

function newAttemptId() {
  return readingRepository.newKey('attempt')
}

function comparisonsToMap(comparisons: AnswerComparisonEntry[] | null | undefined) {
  const out: Record<string, {
    questionId: string
    userAnswer: unknown
    correctAnswer: unknown
    isCorrect: boolean | null
    weight: number
    matchMode: string
    questionKind: string | null
  }> = {}
  if (!Array.isArray(comparisons)) return out
  for (const entry of comparisons) {
    const qid = String(entry?.questionId || entry?.question_id || '').trim()
    if (!qid) continue
    out[qid] = {
      questionId: qid,
      userAnswer: entry.userAnswer ?? entry.user_answer ?? null,
      correctAnswer: entry.correctAnswer ?? entry.correct_answer ?? null,
      isCorrect: entry.isCorrect ?? entry.is_correct ?? null,
      weight: entry.weight ?? 1,
      matchMode: entry.matchMode ?? entry.match_mode ?? 'single',
      questionKind: entry.questionKind ?? entry.question_kind ?? null
    }
  }
  return out
}

/**
 * Map Tauri ReadingSubmitResult → legacy submission shape used by PracticeReadingPage.
 */
export function mapSubmitResultToSubmission(
  result: ReadingSubmitResult | null | undefined,
  extras: SubmissionExtras = {}
) {
  if (!result) return null
  const attempt = result.attempt || {}
  const score = result.score || {}
  const comparison = comparisonsToMap(result.comparisons)
  const correctCount = score.correct ?? attempt.correctCount ?? 0
  const questionCount = score.total ?? attempt.questionCount ?? 0
  const accuracy = score.accuracy ?? attempt.scoreValue ?? null
  return {
    sessionId: attempt.id || extras.attemptId || null,
    attemptId: attempt.id || extras.attemptId || null,
    assetId: attempt.assetId || extras.assetId || null,
    activity: READING_ACTIVITY,
    status: attempt.status || 'submitted',
    score: accuracy,
    correctCount,
    questionCount,
    percentage: score.percentage ?? (accuracy != null ? Math.round(Number(accuracy) * 1000) / 10 : null),
    duration: Math.round((attempt.durationMs || extras.durationMs || 0) / 1000),
    durationMs: attempt.durationMs || extras.durationMs || 0,
    answers: extras.answers || {},
    markedQuestions: extras.markedQuestions || [],
    questionTimelineLite: extras.questionTimeline || [],
    answerComparison: comparison,
    scoreSummary: score,
    scoreInfo: {
      correct: Number(correctCount) || 0,
      totalQuestions: Number(questionCount) || 0,
      percentage: score.percentage ?? (accuracy != null ? Math.round(Number(accuracy) * 1000) / 10 : 0)
    },
    submittedAt: attempt.submittedAt || attempt.completedAt || null,
    title: attempt.titleSnapshot || extras.titleSnapshot || null,
    source: 'tauri',
    idempotentReplay: Boolean(result.idempotentReplay)
  }
}

export function useReadingAttempt(options: ReadingAttemptDependencies = {}) {
  const deps = {
    listReadingAssets: options.listReadingAssets || listReadingAssets,
    saveReadingDraft: options.saveReadingDraft || saveReadingDraft,
    patchReadingAnswer: options.patchReadingAnswer || patchReadingAnswer,
    submitReadingAttempt: options.submitReadingAttempt || submitReadingAttempt,
    isTauri: options.isTauri || isTauriRuntime
  }

  function resolveReviewTarget(record: JsonMap | null | undefined) {
    const assetId = normalizeReadingRecordId(record?.assetId || record?.examId)
    const sessionId = normalizeReadingRecordId(record?.sessionId || record?.attemptId || record?.id)
    return {
      activity: READING_ACTIVITY,
      assetId,
      sessionId,
      ready: Boolean(assetId && sessionId)
    }
  }

  async function listAssets() {
    return deps.listReadingAssets()
  }

  /**
   * Persist draft answers via Tauri SQLite.
   */
  async function persistDraft({
    attemptId,
    assetId,
    answers,
    markedQuestions,
    questionTimeline,
    assetRevision,
    assetFingerprint,
    titleSnapshot,
    idempotencyKey
  }: PersistDraftInput) {
    const id = attemptId || newAttemptId()
    return deps.saveReadingDraft({
      attemptId: id,
      assetId,
      answers: answers || {},
      markedQuestions: markedQuestions || [],
      questionTimeline: questionTimeline || [],
      assetRevision: assetRevision ?? null,
      assetFingerprint: assetFingerprint || null,
      titleSnapshot: titleSnapshot || null,
      idempotencyKey: idempotencyKey || readingRepository.newKey('draft')
    })
  }

  async function patchAnswer(
    attemptId: string,
    questionId: string,
    answer: unknown,
    marked = false
  ) {
    return deps.patchReadingAnswer(attemptId, questionId, answer, marked)
  }

  /**
   * Idempotent submit. Returns `{ source, submission, raw }` where `submission`
   * matches the view-model PracticeReadingPage already renders.
   */
  async function submit({
    attemptId,
    assetId,
    assetRevision,
    assetFingerprint,
    answers,
    markedQuestions,
    questionTimeline,
    durationMs,
    titleSnapshot,
    idempotencyKey
  }: SubmitInput) {
    const id = attemptId || newAttemptId()
    const { source, result } = await deps.submitReadingAttempt({
      attemptId: id,
      assetId,
      assetRevision: assetRevision ?? null,
      assetFingerprint: assetFingerprint || null,
      answers: answers || {},
      markedQuestions: markedQuestions || [],
      questionTimeline: questionTimeline || [],
      durationMs: durationMs ?? null,
      titleSnapshot: titleSnapshot || null,
      idempotencyKey: idempotencyKey || readingRepository.newKey('submit')
    }) as { source: string; result: ReadingSubmitResult }
    return {
      source,
      raw: result,
      submission: mapSubmitResultToSubmission(result, {
        attemptId: id,
        assetId,
        answers,
        markedQuestions,
        questionTimeline,
        durationMs,
        titleSnapshot
      })
    }
  }

  return {
    resolveReviewTarget,
    listAssets,
    persistDraft,
    patchAnswer,
    submit,
    newAttemptId,
    isTauriRuntime: deps.isTauri,
    mapSubmitResultToSubmission
  }
}

export default useReadingAttempt
