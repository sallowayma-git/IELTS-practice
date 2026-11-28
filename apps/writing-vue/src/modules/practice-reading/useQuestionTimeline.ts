/**
 * Per-question learning timeline shared by every practice surface.
 *
 * The ledger (crates/ielts-db/src/learning_events.rs) cannot infer effort from
 * a final answer: `firstTryCorrect` is `is_correct && change_count == 0`, and
 * the outcome payload carries `changeCount`, `visitCount` and `elapsedMs`. If a
 * page submits an empty timeline, every one of those fields is a zero and the
 * learner model over-reads skill it never saw. So the tracker lives in exactly
 * one place and every page that submits answers uses it.
 *
 * Rules (unchanged from the reading page this was extracted from):
 *   - a change is a different answer fingerprint than the previous one;
 *   - the first answer of a question is not a change;
 *   - a visit is counted when the learner moves to a different question;
 *   - elapsed time accrues to whichever question was active.
 */
import { reactive, ref, type Ref } from 'vue'
import { normalizeQuestionId } from './readingQuestionIds'
import { getAnswerFingerprint } from './useReadingAnswers'

export interface QuestionTimelineEntry {
  firstAnsweredAt: string | null
  lastAnsweredAt: string | null
  changeCount: number
  visitCount: number
  elapsedMs: number
  lastFingerprint: string
}

export interface QuestionTimelineLite {
  questionId: string
  displayLabel: string
  firstAnsweredAt: string | null
  lastAnsweredAt: string | null
  changeCount: number
  visitCount: number
  elapsedMs: number
  durationMs: number
}

export interface PersistedQuestionTimelineEntry {
  questionId: string
  changeCount: number
  visitCount: number
  elapsedMs: number
  answeredAt: string | null
}

interface QuestionTimelineOptions {
  payloadSource?: () => { questionOrder?: string[] } | null | undefined
  readOnlySource?: () => boolean | undefined
  getRawAnswer?: (questionId: string) => unknown
  getDisplayLabel?: (questionId: string) => string
  onInteraction?: () => void
}

/** Draft rows may arrive snake_case or camelCase; read either spelling. */
function readNumber(entry: Record<string, unknown> | null | undefined, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(entry?.[key])
    if (Number.isFinite(value)) return Math.max(0, value)
  }
  return 0
}

function readText(entry: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = entry?.[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}

export function useQuestionTimeline(options: QuestionTimelineOptions = {}) {
  const {
    payloadSource = () => null,
    readOnlySource = () => false,
    getRawAnswer = () => '',
    getDisplayLabel = (questionId: string) => questionId,
    onInteraction = () => {}
  } = options

  const answerTimeline = reactive<Record<string, QuestionTimelineEntry>>({})
  const markedQuestions = ref<string[]>([])
  const activeQuestionId: Ref<string> = ref('')
  const activeQuestionVisit = { questionId: '', startedAtMs: 0 }

  function isReadOnly() {
    return Boolean(readOnlySource())
  }

  function getOrCreateEntry(questionId: string): QuestionTimelineEntry | null {
    const normalized = normalizeQuestionId(questionId)
    if (!normalized) return null
    const current = answerTimeline[normalized] || {
      firstAnsweredAt: null,
      lastAnsweredAt: null,
      changeCount: 0,
      visitCount: 0,
      elapsedMs: 0,
      lastFingerprint: getAnswerFingerprint(getRawAnswer(normalized))
    }
    current.changeCount = Math.max(0, Number(current.changeCount) || 0)
    current.visitCount = Math.max(0, Number(current.visitCount) || 0)
    current.elapsedMs = Math.max(0, Number(current.elapsedMs) || 0)
    answerTimeline[normalized] = current
    return current
  }

  function flushActiveQuestionVisit(nowMs = Date.now()) {
    const questionId = activeQuestionVisit.questionId
    const startedAtMs = Number(activeQuestionVisit.startedAtMs) || 0
    if (!questionId || !startedAtMs || nowMs <= startedAtMs) return
    const entry = getOrCreateEntry(questionId)
    if (!entry) return
    entry.elapsedMs = Math.max(0, Number(entry.elapsedMs) || 0) + Math.max(0, nowMs - startedAtMs)
    activeQuestionVisit.startedAtMs = nowMs
  }

  function recordQuestionVisit(questionId: string) {
    if (isReadOnly()) return
    const normalized = normalizeQuestionId(questionId)
    if (!normalized) return
    activeQuestionId.value = normalized
    const nowMs = Date.now()
    if (activeQuestionVisit.questionId && activeQuestionVisit.questionId !== normalized) {
      flushActiveQuestionVisit(nowMs)
    }
    const entry = getOrCreateEntry(normalized)
    if (!entry) return
    if (activeQuestionVisit.questionId !== normalized) {
      entry.visitCount += 1
      activeQuestionVisit.questionId = normalized
    }
    activeQuestionVisit.startedAtMs = nowMs
  }

  function recordAnswerTimeline(questionId: string, previousFingerprint: string, nextFingerprint: string) {
    if (previousFingerprint === nextFingerprint) return
    onInteraction()
    const now = new Date().toISOString()
    recordQuestionVisit(questionId)
    const current = getOrCreateEntry(questionId)
    if (!current) return
    if (nextFingerprint && !current.firstAnsweredAt) current.firstAnsweredAt = now
    if (nextFingerprint) current.lastAnsweredAt = now
    // An empty previous fingerprint is the question's first answer, not a change.
    if (current.lastFingerprint && current.lastFingerprint !== nextFingerprint) {
      current.changeCount += 1
    }
    current.lastFingerprint = nextFingerprint
    answerTimeline[normalizeQuestionId(questionId)] = current
  }

  /** Restore from an open draft's answer rows (AttemptRecord.answers). */
  function hydrateFromDraftAnswers(entries: Array<Record<string, unknown>> | null | undefined) {
    const marked: string[] = []
    for (const entry of entries || []) {
      const questionId = normalizeQuestionId(entry?.questionId ?? entry?.question_id)
      if (!questionId) continue
      if (entry?.marked) marked.push(questionId)
      answerTimeline[questionId] = {
        firstAnsweredAt: readText(entry, 'answeredAt', 'answered_at'),
        lastAnsweredAt: readText(entry, 'answeredAt', 'answered_at'),
        changeCount: readNumber(entry, 'changeCount', 'change_count'),
        visitCount: readNumber(entry, 'visitCount', 'visit_count'),
        elapsedMs: readNumber(entry, 'elapsedMs', 'elapsed_ms'),
        lastFingerprint: getAnswerFingerprint(entry?.answer)
      }
    }
    if (marked.length) markedQuestions.value = marked
  }

  /** Restore from a submitted attempt's timeline (review mode). */
  function hydrateFromSubmission(submission: Record<string, any> | null | undefined) {
    markedQuestions.value = Array.isArray(submission?.markedQuestions)
      ? submission.markedQuestions.map(normalizeQuestionId).filter(Boolean)
      : []
    Object.keys(answerTimeline).forEach((key) => {
      delete answerTimeline[key]
    })
    const timeline = Array.isArray(submission?.questionTimelineLite) ? submission.questionTimelineLite : []
    for (const entry of timeline) {
      const questionId = normalizeQuestionId(entry?.questionId)
      if (!questionId) continue
      const elapsedMs = Math.max(0, Number(entry?.elapsedMs ?? entry?.durationMs) || 0)
      answerTimeline[questionId] = {
        firstAnsweredAt: entry?.firstAnsweredAt || null,
        lastAnsweredAt: entry?.lastAnsweredAt || null,
        changeCount: readNumber(entry, 'changeCount'),
        visitCount: readNumber(entry, 'visitCount'),
        elapsedMs,
        lastFingerprint: getAnswerFingerprint(submission?.answers?.[questionId])
      }
    }
  }

  function reset() {
    flushActiveQuestionVisit()
    activeQuestionVisit.questionId = ''
    activeQuestionVisit.startedAtMs = 0
    activeQuestionId.value = ''
    Object.keys(answerTimeline).forEach((key) => {
      delete answerTimeline[key]
    })
    markedQuestions.value = []
  }

  function buildQuestionTimelineLite(): QuestionTimelineLite[] {
    flushActiveQuestionVisit()
    const order = Array.isArray(payloadSource()?.questionOrder) ? payloadSource()!.questionOrder! : []
    return order.map((questionId) => {
      const entry = answerTimeline[questionId] || ({} as QuestionTimelineEntry)
      const elapsedMs = Math.max(0, Math.round(Number(entry.elapsedMs) || 0))
      return {
        questionId,
        displayLabel: getDisplayLabel(questionId),
        firstAnsweredAt: entry.firstAnsweredAt || null,
        lastAnsweredAt: entry.lastAnsweredAt || null,
        changeCount: Math.max(0, Number(entry.changeCount) || 0),
        visitCount: Math.max(0, Number(entry.visitCount) || 0),
        elapsedMs,
        durationMs: elapsedMs
      }
    })
  }

  function buildPersistedQuestionTimeline(
    timeline: QuestionTimelineLite[] = buildQuestionTimelineLite()
  ): PersistedQuestionTimelineEntry[] {
    return timeline.map((entry) => ({
      questionId: entry.questionId,
      changeCount: entry.changeCount,
      visitCount: entry.visitCount,
      elapsedMs: entry.elapsedMs,
      answeredAt: entry.lastAnsweredAt || entry.firstAnsweredAt || null
    }))
  }

  return {
    answerTimeline,
    markedQuestions,
    activeQuestionId,
    flushActiveQuestionVisit,
    recordQuestionVisit,
    recordAnswerTimeline,
    hydrateFromDraftAnswers,
    hydrateFromSubmission,
    reset,
    buildQuestionTimelineLite,
    buildPersistedQuestionTimeline
  }
}

export default useQuestionTimeline
