import { computed, ref, unref } from 'vue'
import { readingCoachApi, readingSessionApi } from './api'

// The whole-attempt AI review is opt-in: nothing in this module starts it on
// submit or replay. It runs only from the review chip / retry button, and the
// host returns the stored answer when one already exists.
const AUTOMATIC_REVIEW_QUERY = '请复盘我本次错题，按优先级给出训练建议'

type AnyRecord = Record<string, any>
type StreamMode = 'coach' | 'review'
type LlmReviewStatus = 'idle' | 'running' | 'success' | 'failed'

export type ReadingCoachOptions = {
  submissionSource?: unknown
  assetIdSource?: unknown
  setSubmission?: (next: AnyRecord) => void
  readCoachEnabled?: () => boolean
  readSelectedContext?: () => AnyRecord | null | undefined
  getDisplayLabel?: (questionId: string) => string
  formatReviewAnswer?: (value: unknown) => string
  resolveCoachMode?: () => string
  flushActiveQuestionVisit?: () => void
  onSubmissionHydrated?: (submission: AnyRecord) => void
  snapshotSubmission?: () => void
}

type CoachTranscriptEntry = {
  id: string
  role: 'assistant' | 'user'
  status: string
  content: string
  isError: boolean
  /** True only for user/assistant rows read back from coach_list_messages (real coach message ids). */
  persisted: boolean
  followUps: unknown[]
  snapshot: AnyRecord | null
}

// Subset of the Rust CoachFeedbackKind enum offered in the panel. Labels are
// Chinese; values are the snake_case wire names (see memory-repository.js).
// These are the *verdicts*: the host keeps one per answer, so the panel locks
// after the first. `menu` options live behind "讲得不对劲?" instead of the row.
export const READING_COACH_FEEDBACK_OPTIONS = [
  { kind: 'thumbs_up', label: '有帮助' },
  { kind: 'thumbs_down', label: '没帮助' },
  { kind: 'incorrect', label: '讲错了', menu: true }
] as const

// Adjustments say *how* to explain next time. They are not verdicts: any number
// of them may stack on one answer, each recorded once (idempotent per kind).
export const READING_COACH_ADJUSTMENT_OPTIONS = [
  { kind: 'too_long', label: '太长了' },
  { kind: 'too_short', label: '太简略' },
  { kind: 'too_abstract', label: '太抽象' },
  { kind: 'need_example', label: '想要例子' },
  { kind: 'need_step_by_step', label: '想分步讲' },
  { kind: 'not_relevant', label: '答非所问' }
] as const

export type ReadingCoachFeedbackKind = typeof READING_COACH_FEEDBACK_OPTIONS[number]['kind']
export type ReadingCoachAdjustmentKind = typeof READING_COACH_ADJUSTMENT_OPTIONS[number]['kind']

export type ReadingCoachFeedbackState = {
  kind: ReadingCoachFeedbackKind | null
  status: 'saving' | 'saved' | 'failed'
}

export type ReadingCoachAdjustmentStatus = 'saving' | 'saved' | 'failed'
export type ReadingCoachAdjustmentState = Partial<Record<ReadingCoachAdjustmentKind, ReadingCoachAdjustmentStatus>>

// The strategyId the host stamps on an answer, in the learner's words.
const COACH_STRATEGY_LABELS: Record<string, string> = {
  evidence_first_v1: '先讲证据',
  example_first_v1: '先给例子',
  step_by_step_v1: '分步讲解',
  contrastive_v1: '对比辨析',
  socratic_prompt_v1: '提问引导',
  concise_direct_v1: '简洁直给'
}

export const MEMORY_CARD_TEXT_LIMIT = 300

// What a preference card does in the learner's words, per host error code.
const MEMORY_CARD_NOT_FOUND = '找不到这条对话，请刷新后再试'
const MEMORY_CARD_RETRY = '保存失败，请重试'
const MEMORY_CARD_ERRORS: Record<string, string> = {
  'memory_card.invalid_text': '这条偏好为空、太长或包含不能保存的内容，请修改后再试',
  'memory_card.rejected': '这条偏好已经记过，或与已有设置冲突',
  'memory_card.no_source': MEMORY_CARD_NOT_FOUND,
  'memory_card.not_found': MEMORY_CARD_NOT_FOUND,
  'memory_card.persistence_failed': MEMORY_CARD_RETRY
}

/** What this view knows of a card besides the host's `memoryCardState`. */
type MemoryCardLocal = { status: 'saving' | 'confirmed' | 'dismissed' | 'failed'; text?: string; error?: string }

/** One card as the panel draws it. Dismissed and superseded cards have no view. */
export type CoachMemoryCardView = {
  messageId: string
  noteIndex: number
  /** The coach's suggested wording, the box's initial value. */
  text: string
  state: 'pending' | 'confirmed'
  /** The wording just saved; empty when the card was confirmed in an earlier visit. */
  savedText: string
  /** A request is in flight (any card): no second one may start. */
  busy: boolean
  error: string
}

const READING_COACH_REASK_QUERY = '没太懂，换个讲法把刚才这个问题再讲一遍'

// A failed request offers a way forward instead of a dead-end error bubble.
// "short" asks for a brief answer (truncated output); "compact" resends with a
// clipped selection and a slim attempt context (context exceeded).
export type CoachRetryMode = 'same' | 'short' | 'compact'
export type CoachRetryKind = '' | 'plain' | 'truncated' | 'context'

type CoachRetry = {
  code: string
  /** The typed question a failed send put back in the box; retrying consumes it. */
  draft: string
  run: (mode: CoachRetryMode) => Promise<unknown>
}

export const COACH_SHORT_ANSWER_SUFFIX = '（请用不超过 5 句话简要回答）'
const COMPACT_SELECTION_LIMIT = 200
const DRAFT_LIMIT = 20
// Every transcript row the host never stored (pending question, streamed text,
// failure note) carries this prefix; hydration and a new request sweep them.
const LOCAL_ENTRY_PREFIX = 'coach-local-'

// Composer drafts live with their thread: switching attempt stashes the current
// one and brings back the one typed there before. The page is rebuilt per route,
// so the store outlives any one composable instance.
const coachDrafts = new Map<string, string>()

type PayloadOptions = {
  action?: string
  surface?: string
  promptKind?: string
  /** Resend with a clipped selection and slim attempt context. */
  compact?: boolean
  /** Persisted assistant message this query explicitly re-asks (M6-06 link). */
  reaskParentId?: string
}

type HydrateOptions = {
  open?: boolean
  successMessage?: string
  pendingIfMissing?: boolean
  pendingMessage?: string
}

type StreamHandleOptions = {
  expectedSessionId?: string
  mode?: StreamMode
}

type RefreshOptions = {
  preserveCoachResponse?: boolean
}

type ReviewOptions = {
  expectedSessionId?: string
  force?: boolean
}

function readSource(source: unknown): any {
  return typeof source === 'function' ? (source as () => unknown)() : unref(source as any)
}

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' ? (value as AnyRecord) : null
}

function errorField(error: unknown, key: 'code' | 'message'): string {
  const record = asRecord(error)
  return record ? String(record[key] || '').trim() : ''
}

function normalizeCoachTranscript(value: unknown, limit = 40): CoachTranscriptEntry[] {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => {
      const row = asRecord(entry)
      if (!row) return null
      const snapshot = asRecord(row.snapshot) || asRecord(row.structuredPayload)
      const content = String(row.content || snapshot?.answer || snapshot?.message || '').trim()
      if (!content) return null
      return {
        id: String(row.id || row.createdAt || `coach_${index}`),
        role: row.role === 'assistant' || row.role === 'system' ? 'assistant' as const : 'user' as const,
        status: String(row.status || (row.role === 'assistant' ? 'completed' : '')).toLowerCase(),
        content,
        isError: Boolean(row.isError || String(row.status || '').toLowerCase() === 'failed'),
        // System rows render as assistant bubbles but are not assistant messages.
        persisted: Boolean(row.id) && row.role !== 'system',
        followUps: Array.isArray(row.followUps)
          ? row.followUps
          : (Array.isArray(snapshot?.followUps) ? snapshot!.followUps : []),
        snapshot
      }
    })
    .filter((entry): entry is CoachTranscriptEntry => Boolean(entry))
    .slice(-limit)
}

function isLocalEntry(entry: CoachTranscriptEntry): boolean {
  return entry.id.startsWith(LOCAL_ENTRY_PREFIX)
}

function isPanelFeedbackKind(kind: unknown): kind is ReadingCoachFeedbackKind {
  return READING_COACH_FEEDBACK_OPTIONS.some((option) => option.kind === kind)
}

/** Durable verdict rows (coach_list_feedback) as panel state, keyed by message id. */
export function feedbackStateFromRecords(records: unknown): Record<string, ReadingCoachFeedbackState> {
  const state: Record<string, ReadingCoachFeedbackState> = {}
  for (const item of Array.isArray(records) ? records : []) {
    const row = asRecord(item)
    const messageId = String(row?.coachMessageId || '').trim()
    if (!messageId || state[messageId] || !isPanelFeedbackKind(row?.feedbackKind)) continue
    state[messageId] = { kind: row!.feedbackKind, status: 'saved' }
  }
  return state
}

/**
 * Coach generation always continues from the latest persisted turn, so
 * "explain that again" is only honest for the answer that ends the thread.
 * Local/system notes are not turns; an older answer, or a thread ending in a
 * user message or failed answer, offers no re-ask target.
 */
export function latestReaskableId(transcript: CoachTranscriptEntry[]): string {
  const last = [...transcript].reverse().find((entry) => entry.persisted)
  return isFeedbackEligible(last) ? last!.id : ''
}

export function isFeedbackEligible(entry: CoachTranscriptEntry | null | undefined): boolean {
  return Boolean(
    entry
    && entry.persisted
    && entry.role === 'assistant'
    && entry.status === 'completed'
    && !entry.isError
  )
}

function isAdjustmentKind(kind: unknown): kind is ReadingCoachAdjustmentKind {
  return READING_COACH_ADJUSTMENT_OPTIONS.some((option) => option.kind === kind)
}

/** Durable adjustment rows (coach_list_feedback) as panel state, keyed by message id. */
export function adjustmentStateFromRecords(records: unknown): Record<string, ReadingCoachAdjustmentState> {
  const state: Record<string, ReadingCoachAdjustmentState> = {}
  for (const item of Array.isArray(records) ? records : []) {
    const row = asRecord(item)
    const messageId = String(row?.coachMessageId || '').trim()
    if (!messageId || !isAdjustmentKind(row?.feedbackKind)) continue
    state[messageId] = { ...state[messageId], [row!.feedbackKind]: 'saved' }
  }
  return state
}

/** The Chinese name of the explanation strategy behind an answer; '' for old answers or unknown ids. */
export function coachStrategyLabel(entry: CoachTranscriptEntry | null | undefined): string {
  const id = entry?.snapshot?.strategyId
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(COACH_STRATEGY_LABELS, id)
    ? COACH_STRATEGY_LABELS[id]
    : ''
}

function memoryCardOf(entry: CoachTranscriptEntry): { noteIndex: number; text: string } | null {
  const card = asRecord(entry.snapshot?.memoryCard)
  const text = typeof card?.text === 'string' ? card.text.trim() : ''
  const noteIndex = card?.noteIndex
  if (!isFeedbackEligible(entry) || !text) return null
  return typeof noteIndex === 'number' && Number.isInteger(noteIndex) && noteIndex >= 0 ? { noteIndex, text } : null
}

// What the learner did with a card: the host's word first (it survives reloads),
// then what this view just did.
function memoryCardDecision(entry: CoachTranscriptEntry, local: MemoryCardLocal | undefined): 'confirmed' | 'dismissed' | '' {
  const saved = entry.snapshot?.memoryCardState
  if (saved === 'confirmed' || saved === 'dismissed') return saved
  return local?.status === 'confirmed' || local?.status === 'dismissed' ? local.status : ''
}

/**
 * Which preference cards the panel shows, by message id. A decided card is
 * settled: confirmed stays as a one-line receipt, dismissed disappears. Of the
 * undecided ones only the newest keeps its buttons; older ones fold away so the
 * conversation never fills with questions.
 */
export function memoryCardViews(
  transcript: CoachTranscriptEntry[],
  local: Record<string, MemoryCardLocal>
): Record<string, CoachMemoryCardView> {
  const busy = Object.values(local).some((item) => item.status === 'saving')
  const views: CoachMemoryCardView[] = []
  for (const entry of transcript) {
    const card = memoryCardOf(entry)
    const decision = memoryCardDecision(entry, local[entry.id])
    if (!card || decision === 'dismissed') continue
    views.push({
      messageId: entry.id,
      ...card,
      state: decision === 'confirmed' ? 'confirmed' : 'pending',
      savedText: decision === 'confirmed' ? (local[entry.id]?.text || '') : '',
      busy,
      error: local[entry.id]?.status === 'failed' ? (local[entry.id].error || '') : ''
    })
  }
  const pending = views.filter((view) => view.state === 'pending')
  const newest = pending[pending.length - 1]
  return Object.fromEntries(
    views.filter((view) => view.state === 'confirmed' || view === newest).map((view) => [view.messageId, view])
  )
}

function memoryCardFailure(failure: unknown): MemoryCardLocal {
  const code = errorField(failure, 'code')
  // Dismiss lost a race with a confirm: the card is settled, show it so.
  if (code === 'memory_card.already_confirmed') return { status: 'confirmed' }
  return { status: 'failed', error: MEMORY_CARD_ERRORS[code] || MEMORY_CARD_RETRY }
}

function hasLlmReview(submission: AnyRecord | null | undefined): boolean {
  return Boolean(
    submission?.singleAttemptAnalysisLlm
    || submission?.analysisArtifacts?.singleAttemptAnalysisLlm
  )
}

function formatCoachStreamMessage(streamEvent: unknown, mode: StreamMode = 'coach'): string {
  const event = asRecord(streamEvent) || {}
  const eventName = String(event.event || event.type || '').trim()
  const payload = asRecord(event.data) || {}
  const detail = asRecord(payload.data) || payload
  if (eventName === 'start') return mode === 'review' ? 'AI 复盘已启动...' : '教练已连接...'
  if (eventName === 'cache_hit') return '命中已缓存复盘上下文...'
  if (eventName === 'route') return '正在判断问题意图...'
  if (eventName === 'retrieval') {
    const chunkCount = Number(detail.chunkCount || 0)
    return chunkCount > 0 ? `RAG 已检索 ${chunkCount} 条证据...` : 'RAG 正在检索证据...'
  }
  if (eventName === 'generation_start') return mode === 'review' ? '正在生成错因复盘...' : '正在生成教练回答...'
  if (eventName === 'model_delta') return mode === 'review' ? '正在写入复盘结论...' : '正在组织回答...'
  if (eventName === 'generation_complete') return mode === 'review' ? '复盘生成完成，正在落库...' : '回答生成完成，正在同步记录...'
  if (eventName === 'complete') return mode === 'review' ? 'AI 复盘已更新' : '教练已返回结果'
  if (eventName === 'generation_error' || eventName === 'error') return mode === 'review' ? 'AI 复盘失败' : '教练请求失败'
  return ''
}

// Learner-facing text for the typed coach failures the host reports. Null for
// every other code, which keeps the provider's own message.
function coachFailureDetail(error: unknown): string | null {
  const code = errorField(error, 'code').toLowerCase()
  if (code === 'coach.output_truncated') return '回答过长，已被截断，请换个更具体的问题再试'
  if (code === 'coach.context_exceeded') return '内容超出模型上下文长度，请缩短选中的原文或问题后再试'
  if (code === 'coach.auth_failed') return 'API 密钥无效或没有权限，请到设置里检查密钥后再试'
  if (code === 'coach.rate_limited') return '请求过于频繁或额度已用完，请稍后再试'
  if (code === 'coach.timeout') return '模型响应超时，请重试'
  return null
}

function formatLlmFailureStatusMessage(error: unknown): string {
  const code = errorField(error, 'code').toLowerCase()
  const rawMessage = errorField(error, 'message')
  const detail = coachFailureDetail(error)
  if (detail) {
    return `AI 复盘暂不可用：${detail}`
  }
  if (code === 'coach_locked_until_submit') {
    return 'AI 复盘暂不可用：请先完成并提交本轮作答。'
  }
  if (code === 'local_api_unavailable') {
    return 'AI 复盘暂不可用：未发现本地服务。'
  }
  if (code === 'invalid_response_format') {
    return 'AI 复盘暂不可用：服务返回格式异常。'
  }
  if (rawMessage && rawMessage.length <= 140 && !/failed to fetch|http:|https:|file:/i.test(rawMessage)) {
    return `AI 复盘暂不可用：${rawMessage}`
  }
  return 'AI 复盘暂不可用，请稍后重试。'
}

export function useReadingCoach(options: ReadingCoachOptions = {}) {
  const coachQuery = ref('')
  const coachLoading = ref(false)
  const coachError = ref('')
  const coachResponse = ref<any>(null)
  const selectedContext = ref<AnyRecord | null>(null)
  const coachStreamMessage = ref('')
  const readingCoachOpen = ref(false)
  const llmReviewStatus = ref<LlmReviewStatus>('idle')
  const llmReviewMessage = ref('')
  const coachTranscriptState = ref<CoachTranscriptEntry[]>([])
  const coachThreadId = ref('')
  const coachFeedback = ref<Record<string, ReadingCoachFeedbackState>>({})
  const coachAdjustments = ref<Record<string, ReadingCoachAdjustmentState>>({})
  const memoryCardLocal = ref<Record<string, MemoryCardLocal>>({})
  // Notices that belong to no transcript row (history load failed, nothing
  // selected) and the way forward from the last failed request.
  const coachNotice = ref('')
  const coachHistoryFailed = ref(false)
  const coachRetry = ref<CoachRetry | null>(null)
  let draftSessionId = ''
  let localEntrySequence = 0
  let coachRequestSequence = 0
  let coachHydrationSequence = 0
  // Bumped by every reset: a request that started before one never writes back.
  let coachEpoch = 0
  // Token of the one request whose streamed deltas may still show. Bumped to
  // close the stream (reset, hydrate, or the request settling), so a late delta
  // from an old request cannot re-add a bubble.
  let coachStreamToken = 0

  const submission = computed(() => readSource(options.submissionSource))
  const singleAttemptAnalysisLlm = computed(() => (
    submission.value?.singleAttemptAnalysisLlm
    || submission.value?.analysisArtifacts?.singleAttemptAnalysisLlm
    || null
  ))
  const coachTranscript = computed(() => coachTranscriptState.value)
  const coachFollowUpSource = computed(() => {
    const transcript = coachTranscript.value
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const entry = transcript[index]
      if (entry.role !== 'assistant') continue
      const followUps = Array.isArray(entry.followUps)
        ? entry.followUps
        : (Array.isArray(entry.snapshot?.followUps) ? entry.snapshot.followUps : [])
      const normalized = followUps.map((item) => String(item || '').trim()).filter(Boolean)
      if (normalized.length) {
        return { entry, followUps: normalized.slice(0, 3) }
      }
    }
    return null
  })
  const coachFollowUps = computed(() => coachFollowUpSource.value?.followUps || [])
  const coachReaskableId = computed(() => latestReaskableId(coachTranscriptState.value))
  const coachMemoryCards = computed(() => memoryCardViews(coachTranscriptState.value, memoryCardLocal.value))
  const canAskCoach = computed(() => Boolean(submission.value && coachQuery.value.trim() && !coachLoading.value))
  const coachRetryKind = computed<CoachRetryKind>(() => {
    const code = coachRetry.value?.code
    if (!coachRetry.value) return ''
    if (code === 'coach.output_truncated') return 'truncated'
    if (code === 'coach.context_exceeded') return 'context'
    return 'plain'
  })
  // Failures land in the transcript as an error message; the status line only
  // narrates an in-flight request.
  const coachStatusText = computed(() => (
    coachLoading.value ? (coachStreamMessage.value || 'AI 教练正在思考...') : ''
  ))
  const isReadingCoachEnabled = () => {
    if (typeof options.readCoachEnabled === 'function') {
      return Boolean(options.readCoachEnabled())
    }
    return true
  }

  function setSubmission(nextSubmission: AnyRecord) {
    if (typeof options.setSubmission === 'function') {
      options.setSubmission(nextSubmission)
    }
  }

  // Ends the current stream: its late deltas are ignored and its provisional
  // bubble is dropped.
  function closeCoachStream() {
    coachStreamToken += 1
    coachTranscriptState.value = coachTranscriptState.value.filter((entry) => entry.status !== 'streaming')
  }

  function stashCoachDraft() {
    if (!draftSessionId) return
    coachDrafts.delete(draftSessionId)
    if (coachQuery.value.trim()) coachDrafts.set(draftSessionId, coachQuery.value)
    while (coachDrafts.size > DRAFT_LIMIT) {
      coachDrafts.delete(coachDrafts.keys().next().value as string)
    }
  }

  function bindCoachDraft(sessionId: string) {
    if (sessionId === draftSessionId) return
    stashCoachDraft()
    draftSessionId = sessionId
    coachQuery.value = coachDrafts.get(sessionId) || ''
  }

  function resetReadingCoachState() {
    coachHydrationSequence += 1
    coachEpoch += 1
    closeCoachStream()
    stashCoachDraft()
    draftSessionId = ''
    coachQuery.value = ''
    coachNotice.value = ''
    coachHistoryFailed.value = false
    coachRetry.value = null
    coachError.value = ''
    coachResponse.value = null
    coachStreamMessage.value = ''
    coachLoading.value = false
    readingCoachOpen.value = false
    selectedContext.value = null
    llmReviewStatus.value = 'idle'
    llmReviewMessage.value = ''
    coachTranscriptState.value = []
    coachThreadId.value = ''
    coachFeedback.value = {}
    coachAdjustments.value = {}
    memoryCardLocal.value = {}
  }

  function setReadingCoachOpen(value: unknown) {
    readingCoachOpen.value = isReadingCoachEnabled() && Boolean(value)
  }

  async function hydratePersistedCoachMessages(sessionId: string) {
    const hydrationId = ++coachHydrationSequence
    closeCoachStream()
    coachHistoryFailed.value = false
    if (!sessionId) {
      coachTranscriptState.value = []
      coachThreadId.value = ''
      return
    }
    try {
      const result = asRecord(await readingCoachApi.listMessages(
        sessionId,
        String(readSource(options.assetIdSource) || '') || null
      )) || {}
      if (!isCurrentSubmission(sessionId) || hydrationId !== coachHydrationSequence) return
      coachThreadId.value = String(result.threadId || '')
      const entries = normalizeCoachTranscript(result.messages, Array.isArray(result.messages) ? result.messages.length : 40)
      // A question sent while the history was loading keeps its pending bubble;
      // its reply replaces the whole list anyway.
      const inFlight = coachLoading.value ? coachTranscriptState.value.filter(isLocalEntry) : []
      coachTranscriptState.value = [...entries.slice(-40), ...inFlight]
      const latestAssistant = [...coachTranscriptState.value].reverse().find((entry) => (
        entry.role === 'assistant' && entry.status === 'completed' && !entry.isError
      ))
      if (latestAssistant) {
        coachResponse.value = latestAssistant.snapshot || { answer: latestAssistant.content }
      }
      const latestReview = [...entries].reverse().find((entry) => (
        entry.role === 'user' && String(entry.snapshot?.action || '') === 'review_set'
      ))
      if (coachThreadId.value) void hydrateCoachFeedback(sessionId, hydrationId, coachThreadId.value)
      if (latestReview) {
        const terminal = [...entries].reverse().find((entry) => (
          entry.role === 'assistant'
          && String(entry.snapshot?.userMessageId || '') === latestReview.id
          && (entry.status === 'completed' || entry.status === 'failed')
        ))
        llmReviewStatus.value = terminal?.status === 'completed' ? 'success' : terminal?.status === 'failed' ? 'failed' : 'idle'
        llmReviewMessage.value = terminal?.status === 'completed'
          ? 'AI 复盘已载入'
          : terminal?.status === 'failed' ? `AI 复盘失败：${terminal.content}` : 'AI 复盘待补全'
      }
    } catch (error) {
      if (!isCurrentSubmission(sessionId) || hydrationId !== coachHydrationSequence) return
      coachError.value = errorField(error, 'message') || 'AI 教练历史加载失败'
      coachHistoryFailed.value = true
      coachNotice.value = '对话记录加载失败，已有的对话可能暂时看不到。'
    }
  }

  function reloadCoachHistory() {
    const sessionId = String(submission.value?.sessionId || submission.value?.attemptId || '').trim()
    if (!sessionId || coachLoading.value) return
    coachNotice.value = ''
    coachError.value = ''
    void hydratePersistedCoachMessages(sessionId)
  }

  // A verdict is stored once per answer; reloading must show it as already
  // given so the panel never offers a second, silently ignored choice.
  async function hydrateCoachFeedback(sessionId: string, hydrationId: number, threadId: string) {
    try {
      const records = await readingCoachApi.listFeedback(threadId)
      if (!isCurrentSubmission(sessionId) || hydrationId !== coachHydrationSequence) return
      coachFeedback.value = { ...feedbackStateFromRecords(records), ...coachFeedback.value }
      mergeAdjustments(adjustmentStateFromRecords(records))
    } catch (feedbackFailure) {
      console.warn('阅读教练反馈加载失败:', feedbackFailure)
    }
  }

  // What the host already holds is the floor; what this view is doing right now wins.
  function mergeAdjustments(saved: Record<string, ReadingCoachAdjustmentState>) {
    const merged = { ...coachAdjustments.value }
    for (const [messageId, kinds] of Object.entries(saved)) {
      merged[messageId] = { ...kinds, ...merged[messageId] }
    }
    coachAdjustments.value = merged
  }

  function hydrateReadingCoachFromSubmission(nextSubmission: AnyRecord | null | undefined, hydrateOptions: HydrateOptions = {}) {
    if (!isReadingCoachEnabled()) {
      readingCoachOpen.value = false
      coachResponse.value = null
      llmReviewStatus.value = 'idle'
      llmReviewMessage.value = ''
      return
    }
    if (hydrateOptions.open) {
      readingCoachOpen.value = true
    }
    closeCoachStream()
    coachResponse.value = null
    const sessionId = String(nextSubmission?.sessionId || nextSubmission?.attemptId || '').trim()
    bindCoachDraft(sessionId)
    if (sessionId) void hydratePersistedCoachMessages(sessionId)
    if (hasLlmReview(nextSubmission)) {
      llmReviewStatus.value = 'success'
      llmReviewMessage.value = hydrateOptions.successMessage || 'AI 复盘已载入'
    } else if (hydrateOptions.pendingIfMissing) {
      llmReviewStatus.value = 'idle'
      llmReviewMessage.value = hydrateOptions.pendingMessage || 'AI 复盘待补全'
    }
  }

  function toggleReadingCoachPanel() {
    if (!submission.value || !isReadingCoachEnabled()) return
    readingCoachOpen.value = !readingCoachOpen.value
  }

  function refreshSelectedContext() {
    const nextContext = typeof options.readSelectedContext === 'function'
      ? options.readSelectedContext()
      : null
    if (nextContext) {
      selectedContext.value = nextContext
    }
    return selectedContext.value
  }

  function clearSelectedContext() {
    selectedContext.value = null
  }

  function normalizeCoachQuestionNumber(value: unknown) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const exactNumber = raw.match(/^\d+$/)
    const qNumber = raw.match(/\bq(\d+)\b/i) || raw.match(/^q(\d+)/i)
    const numeric = exactNumber?.[0] || qNumber?.[1] || ''
    if (!numeric) return ''
    const questionId = `q${Number(numeric)}`
    const displayLabel = typeof options.getDisplayLabel === 'function'
      ? options.getDisplayLabel(questionId)
      : numeric
    return String(displayLabel || numeric).replace(/^q/i, '').trim()
  }

  function resolveCoachWrongQuestions() {
    const fromCoachContext = Array.isArray(submission.value?.coachContext?.wrongQuestions)
      ? submission.value.coachContext.wrongQuestions
      : []
    if (fromCoachContext.length) {
      return fromCoachContext.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    }
    return Object.values(submission.value?.answerComparison || {})
      .filter((entry: any) => entry?.isCorrect === false)
      .map((entry: any) => String(entry.displayLabel || options.getDisplayLabel?.(entry.questionId)).replace(/^q/i, '').trim())
      .filter(Boolean)
  }

  function formatReviewAnswer(value: unknown) {
    return typeof options.formatReviewAnswer === 'function'
      ? options.formatReviewAnswer(value)
      : String(value == null ? '' : value).trim()
  }

  function resolveCoachSelectedAnswers() {
    const fromCoachContext = submission.value?.coachContext?.selectedAnswers
    if (fromCoachContext && typeof fromCoachContext === 'object') {
      return Object.fromEntries(
        Object.entries(fromCoachContext)
          .map(([questionNumber, answer]) => [String(questionNumber).replace(/^q/i, '').trim(), formatReviewAnswer(answer)])
          .filter(([questionNumber, answer]) => questionNumber && answer)
      )
    }
    return Object.values(submission.value?.answerComparison || {}).reduce((accumulator: Record<string, string>, entry: any) => {
      const questionNumber = String(entry?.displayLabel || options.getDisplayLabel?.(entry?.questionId)).replace(/^q/i, '').trim()
      const answer = formatReviewAnswer(entry?.userAnswer)
      if (questionNumber && answer) {
        accumulator[questionNumber] = answer
      }
      return accumulator
    }, {} as Record<string, string>)
  }

  function resolveCoachFocusQuestionNumbers(context: AnyRecord | null = selectedContext.value) {
    if (Array.isArray(context?.questionNumbers) && context.questionNumbers.length) {
      return context.questionNumbers
    }
    const wrongQuestions = resolveCoachWrongQuestions()
    if (wrongQuestions.length) {
      return wrongQuestions.slice(0, 3)
    }
    if (typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null
      const raw = active?.getAttribute?.('name') || active?.id || ''
      const focused = normalizeCoachQuestionNumber(raw)
      if (focused) return [focused]
    }
    return []
  }

  function resolveCoachMode() {
    if (typeof options.resolveCoachMode === 'function') {
      return options.resolveCoachMode()
    }
    return 'single'
  }

  function compactSelectedContext(context: AnyRecord | null, compact: boolean) {
    if (!context || !compact) return context
    return { ...context, text: String(context.text || '').slice(0, COMPACT_SELECTION_LIMIT) }
  }

  function buildCoachPayload(query: unknown, payloadOptions: PayloadOptions = {}) {
    options.flushActiveQuestionVisit?.()
    const action = String(payloadOptions.action || 'chat').trim() || 'chat'
    const surface = String(payloadOptions.surface || (action === 'review_set' ? 'review_workspace' : 'chat_widget')).trim()
    const promptKind = String(payloadOptions.promptKind || 'freeform').trim() || 'freeform'
    const compact = Boolean(payloadOptions.compact)
    const context = compactSelectedContext(refreshSelectedContext(), compact)
    return {
      examId: submission.value?.examId || readSource(options.assetIdSource),
      sessionId: submission.value?.sessionId || '',
      mode: resolveCoachMode(),
      content: String(query || '').trim(),
      locale: 'zh',
      surface,
      action,
      promptKind,
      selectedText: context?.text || '',
      selectedContext: context || null,
      focusQuestionNumbers: resolveCoachFocusQuestionNumbers(context),
      attemptContext: buildAttemptContext(compact)
    }
  }

  // The slim form keeps what the coach needs to talk about this attempt (score,
  // wrong questions) and drops the bulky telemetry.
  function buildAttemptContext(compact: boolean) {
    const current = submission.value
    return {
      submitted: true,
      score: current?.coachContext?.score ?? current?.scoreInfo?.percentage ?? null,
      wrongQuestions: resolveCoachWrongQuestions(),
      selectedAnswers: compact ? {} : resolveCoachSelectedAnswers(),
      analysisSignals: compact ? null : (current?.analysisSignals || current?.analysisArtifacts?.analysisSignals || null),
      markedQuestions: !compact && Array.isArray(current?.markedQuestions) ? current.markedQuestions : [],
      questionTimelineLite: !compact && Array.isArray(current?.questionTimelineLite) ? current.questionTimelineLite : [],
      questionTypePerformance: compact ? {} : (current?.questionTypePerformance || {})
    }
  }

  function resolveCoachPresetQuery(action: string) {
    const focusNumbers = resolveCoachFocusQuestionNumbers()
    const focusText = focusNumbers.length ? `（重点看 Q${focusNumbers.join(', Q')}）` : ''
    if (action === 'hint') {
      return `给我当前题目的提示，不要直接给答案${focusText}`.trim()
    }
    if (action === 'explain') {
      return `解释当前题该如何定位证据并排除干扰项${focusText}`.trim()
    }
    if (action === 'review') {
      return `${AUTOMATIC_REVIEW_QUERY}${focusText}`.trim()
    }
    if (action === 'similar') {
      return `推荐与我薄弱题型类似的训练方向${focusText}`.trim()
    }
    return ''
  }

  function localCoachEntry(
    role: CoachTranscriptEntry['role'],
    status: string,
    content: string,
    isError = false
  ): CoachTranscriptEntry {
    localEntrySequence += 1
    return {
      id: `${LOCAL_ENTRY_PREFIX}${localEntrySequence}`,
      role,
      status,
      content,
      isError,
      persisted: false,
      followUps: [],
      snapshot: null
    }
  }

  function appendLocalCoachError(message: unknown) {
    coachTranscriptState.value = [
      ...coachTranscriptState.value,
      localCoachEntry('assistant', 'failed', String(message || '阅读教练请求失败').trim(), true)
    ]
  }

  // A request starts from a clean slate: last failure's note and retry offer
  // are gone, and the question shows at once instead of after the reply.
  function beginCoachRequest(question: string) {
    coachLoading.value = true
    coachError.value = ''
    coachNotice.value = ''
    coachRetry.value = null
    coachResponse.value = null
    coachStreamMessage.value = '教练已连接...'
    coachTranscriptState.value = [
      ...coachTranscriptState.value.filter((entry) => !isLocalEntry(entry)),
      localCoachEntry('user', 'pending', question)
    ]
  }

  function finishCoachRequest(requestId: number, isLive: () => boolean) {
    if (coachRequestSequence !== requestId || !isLive()) return
    coachLoading.value = false
    coachStreamMessage.value = ''
  }

  // Streamed answer text shown before the reply is validated and persisted. The
  // entry is never persisted: the final reply replaces it, and a failure drops it.
  function appendProvisionalCoachText(id: string, text: string) {
    const transcript = coachTranscriptState.value
    coachTranscriptState.value = transcript.some((entry) => entry.id === id)
      ? transcript.map((entry) => (entry.id === id ? { ...entry, content: entry.content + text } : entry))
      : [...transcript, { ...localCoachEntry('assistant', 'streaming', text), id }]
  }

  function dropProvisionalCoachText(id: string) {
    coachTranscriptState.value = coachTranscriptState.value.filter((entry) => entry.id !== id)
  }

  function isCurrentSubmission(expectedSessionId: unknown) {
    const normalized = String(expectedSessionId || '').trim()
    return Boolean(normalized && String(submission.value?.sessionId || '').trim() === normalized)
  }

  function handleCoachStreamEvent(streamEvent: unknown, { expectedSessionId, mode = 'coach' }: StreamHandleOptions = {}) {
    if (!isCurrentSubmission(expectedSessionId)) return
    const nextMessage = formatCoachStreamMessage(streamEvent, mode)
    if (!nextMessage) return
    if (mode === 'review') llmReviewMessage.value = nextMessage
    coachStreamMessage.value = nextMessage
  }

  async function refreshSubmissionFromHistory(expectedSessionId: string, refreshOptions: RefreshOptions = {}) {
    if (!isCurrentSubmission(expectedSessionId)) {
      return null
    }
    try {
      const state = asRecord(await readingSessionApi.getState(expectedSessionId))
      const refreshedSubmission = asRecord(state?.submission)
      if (!refreshedSubmission || !isCurrentSubmission(expectedSessionId)) {
        return null
      }
      setSubmission(refreshedSubmission)
      coachResponse.value = refreshedSubmission.readingCoachSnapshot || (refreshOptions.preserveCoachResponse === false ? null : coachResponse.value)
      options.onSubmissionHydrated?.(refreshedSubmission)
      return refreshedSubmission
    } catch (refreshFailure) {
      console.warn('刷新阅读教练持久化状态失败:', refreshFailure)
      return null
    }
  }

  function applyCoachResponse(response: unknown) {
    coachHydrationSequence += 1
    const snapshot = asRecord(response) || { value: response }
    coachResponse.value = snapshot
    if (Array.isArray(snapshot.messages)) {
      coachTranscriptState.value = normalizeCoachTranscript(snapshot.messages)
    }
    coachThreadId.value = String(snapshot.threadId || coachThreadId.value || '')
  }

  async function sendCoachQuery(query: unknown, queryOptions: PayloadOptions = {}) {
    const normalizedQuery = String(query || '').trim()
    if (!isReadingCoachEnabled() || !submission.value?.sessionId || !normalizedQuery || coachLoading.value) {
      return null
    }
    const expectedSessionId = String(submission.value.sessionId || '').trim()
    const requestId = ++coachRequestSequence
    const provisionalId = `${LOCAL_ENTRY_PREFIX}stream-${requestId}`
    const streamToken = ++coachStreamToken
    const streamIsOpen = () => streamToken === coachStreamToken
    const epoch = coachEpoch
    const isLive = () => epoch === coachEpoch && isCurrentSubmission(expectedSessionId)
    beginCoachRequest(normalizedQuery)
    try {
      const requestPayload = buildCoachPayload(normalizedQuery, queryOptions)
      const response = await readingCoachApi.query(requestPayload, expectedSessionId, {
        onEvent: (event) => handleCoachStreamEvent(event, { expectedSessionId, mode: 'coach' }),
        onDelta: (text) => {
          if (streamIsOpen() && isLive()) appendProvisionalCoachText(provisionalId, text)
        }
      })
      if (!isReadingCoachEnabled() || !isLive()) {
        return response
      }
      applyCoachResponse(response)
      const reaskParentId = String(queryOptions.reaskParentId || '').trim()
      const newUserMessageId = String(asRecord(asRecord(response)?.userMessage)?.id || '').trim()
      if (reaskParentId && newUserMessageId) {
        void linkReask(reaskParentId, newUserMessageId)
      }
      return response
    } catch (coachFailure) {
      console.error('阅读教练请求失败:', coachFailure)
      if (!isReadingCoachEnabled() || !isLive()) {
        return null
      }
      const failureMessage = errorField(coachFailure, 'message')
      const detail = coachFailureDetail(coachFailure)
      coachError.value = detail
        ? `阅读教练请求失败：${detail}`
        : failureMessage
          ? `阅读教练请求失败：${failureMessage}`
          : '阅读教练请求失败，请稍后重试'
      offerCoachRetry(coachFailure, normalizedQuery.replace(COACH_SHORT_ANSWER_SUFFIX, ''), (mode) => sendCoachQuery(
        mode === 'short' ? `${normalizedQuery.replace(COACH_SHORT_ANSWER_SUFFIX, '')}${COACH_SHORT_ANSWER_SUFFIX}` : normalizedQuery,
        { ...queryOptions, compact: mode === 'compact' }
      ))
      appendLocalCoachError(coachError.value)
      return null
    } finally {
      if (streamIsOpen()) closeCoachStream()
      dropProvisionalCoachText(provisionalId)
      finishCoachRequest(requestId, isLive)
    }
  }

  function offerCoachRetry(failure: unknown, draft: string, run: CoachRetry['run']) {
    coachRetry.value = { code: errorField(failure, 'code').toLowerCase(), draft, run }
  }

  function retryCoachQuery(mode: CoachRetryMode = 'same') {
    const retry = coachRetry.value
    if (!retry || coachLoading.value) return Promise.resolve(null)
    if (retry.draft && coachQuery.value.trim() === retry.draft) coachQuery.value = ''
    return retry.run(mode)
  }

  async function runAutomaticReviewCoach(reviewOptions: ReviewOptions = {}) {
    const expectedSessionId = String(reviewOptions.expectedSessionId || submission.value?.sessionId || '').trim()
    if (!isReadingCoachEnabled()) {
      llmReviewStatus.value = 'idle'
      llmReviewMessage.value = ''
      return
    }
    if (!expectedSessionId || llmReviewStatus.value === 'running' || coachLoading.value) {
      return
    }
    if (!isCurrentSubmission(expectedSessionId)) {
      return
    }
    if (singleAttemptAnalysisLlm.value && !reviewOptions.force) {
      llmReviewStatus.value = 'success'
      llmReviewMessage.value = 'AI 复盘已更新'
      return
    }

    const requestId = ++coachRequestSequence
    const epoch = coachEpoch
    const isLive = () => epoch === coachEpoch && isCurrentSubmission(expectedSessionId)
    llmReviewStatus.value = 'running'
    llmReviewMessage.value = 'AI 正在复盘错题...'
    beginCoachRequest(AUTOMATIC_REVIEW_QUERY)
    try {
      const requestPayload = buildCoachPayload(AUTOMATIC_REVIEW_QUERY, {
        surface: 'review_workspace',
        action: 'review_set',
        promptKind: 'preset'
      })
      const response = await readingCoachApi.query(requestPayload, expectedSessionId, {
        onEvent: (event) => handleCoachStreamEvent(event, { expectedSessionId, mode: 'review' })
      })
      if (!isReadingCoachEnabled()) {
        llmReviewStatus.value = 'idle'
        llmReviewMessage.value = ''
        return
      }
      if (!isLive()) {
        return
      }
      applyCoachResponse(response)
      const assistantText = String(
        asRecord(response)?.answer
        || asRecord(asRecord(response)?.assistantMessage)?.content
        || ''
      ).trim()
      if (assistantText || hasLlmReview(submission.value)) {
        llmReviewStatus.value = 'success'
        llmReviewMessage.value = 'AI 复盘已更新'
      } else {
        // Coach text reply is not structured review — do not fake success.
        llmReviewStatus.value = 'failed'
        llmReviewMessage.value = 'AI 已回复，但未返回结构化复盘字段。'
      }
    } catch (reviewFailure) {
      console.error('自动阅读复盘失败:', reviewFailure)
      if (!isReadingCoachEnabled()) {
        llmReviewStatus.value = 'idle'
        llmReviewMessage.value = ''
        return
      }
      if (!isLive()) {
        return
      }
      llmReviewStatus.value = 'failed'
      llmReviewMessage.value = formatLlmFailureStatusMessage(reviewFailure)
      offerCoachRetry(reviewFailure, '', () => runAutomaticReviewCoach({ expectedSessionId }))
      appendLocalCoachError(llmReviewMessage.value)
    } finally {
      finishCoachRequest(requestId, isLive)
    }
  }

  async function askCoach() {
    if (!isReadingCoachEnabled() || !canAskCoach.value) {
      return
    }
    const query = coachQuery.value.trim()
    const sessionId = String(submission.value?.sessionId || '').trim()
    coachQuery.value = ''
    const response = await sendCoachQuery(query, {
      surface: 'chat_widget',
      action: 'chat',
      promptKind: 'freeform'
    })
    // A failed question goes back into the box, unless the learner has already
    // typed something else or moved to another attempt.
    if (response == null && !coachQuery.value.trim() && isCurrentSubmission(sessionId)) {
      coachQuery.value = query
    }
  }

  // M6-06: a re-ask link only ties an answer to an explicit "ask about that
  // again" (a follow-up chip offered by that answer, or the re-ask button).
  // A freshly typed question is a new question and is never linked. Linking
  // is bookkeeping: a failure is logged and never surfaces in the chat.
  async function linkReask(parentAssistantMessageId: string, newUserMessageId: string) {
    try {
      await readingCoachApi.recordReaskLink(parentAssistantMessageId, newUserMessageId)
    } catch (linkFailure) {
      console.warn('阅读教练追问关联记录失败:', linkFailure)
    }
  }

  function findFeedbackEligibleEntry(messageId: unknown) {
    const id = String(messageId || '').trim()
    if (!id) return null
    const entry = coachTranscriptState.value.find((item) => item.id === id)
    return isFeedbackEligible(entry) ? entry! : null
  }

  async function askCoachFollowUp(query: unknown) {
    if (!isReadingCoachEnabled()) {
      return
    }
    const sourceId = coachFollowUpSource.value?.entry.id || ''
    await sendCoachQuery(query, {
      surface: 'chat_widget',
      action: 'chat',
      promptKind: 'followup',
      reaskParentId: sourceId && sourceId === coachReaskableId.value ? sourceId : ''
    })
  }

  async function reaskCoachMessage(messageId: unknown) {
    if (!isReadingCoachEnabled()) {
      return
    }
    const entry = findFeedbackEligibleEntry(messageId)
    if (!entry || entry.id !== coachReaskableId.value) return
    await sendCoachQuery(READING_COACH_REASK_QUERY, {
      surface: 'chat_widget',
      action: 'chat',
      promptKind: 'reask',
      reaskParentId: entry.id
    })
  }

  // M6-05: one verdict per assistant message. The backend keeps the first
  // verdict and returns it for any later one, so the saved state shows the
  // durable kind; a failed save clears the selection so the learner can retry.
  async function submitCoachFeedback(messageId: unknown, feedbackKind: unknown) {
    if (isAdjustmentKind(feedbackKind)) return submitCoachAdjustment(messageId, feedbackKind)
    const entry = findFeedbackEligibleEntry(messageId)
    const option = READING_COACH_FEEDBACK_OPTIONS.find((item) => item.kind === feedbackKind)
    if (!entry || !option) return
    const current = coachFeedback.value[entry.id]
    if (current && current.status !== 'failed') return
    const sessionId = String(submission.value?.sessionId || '').trim()
    coachFeedback.value = { ...coachFeedback.value, [entry.id]: { kind: option.kind, status: 'saving' } }
    let next: ReadingCoachFeedbackState
    try {
      const record = asRecord(await readingCoachApi.recordFeedback(entry.id, option.kind))
      const durableKind = isPanelFeedbackKind(record?.feedbackKind) ? record!.feedbackKind : option.kind
      next = { kind: durableKind, status: 'saved' }
    } catch (feedbackFailure) {
      console.warn('阅读教练反馈保存失败:', feedbackFailure)
      next = { kind: null, status: 'failed' }
    }
    if (!isCurrentSubmission(sessionId)) return
    coachFeedback.value = { ...coachFeedback.value, [entry.id]: next }
  }

  // "Too long", "want an example"...: each kind is recorded once per answer and
  // never locks the others. A failed save unlocks that one kind for a retry.
  async function submitCoachAdjustment(messageId: unknown, kind: ReadingCoachAdjustmentKind) {
    const entry = findFeedbackEligibleEntry(messageId)
    if (!entry) return
    const current = coachAdjustments.value[entry.id]?.[kind]
    if (current === 'saving' || current === 'saved') return
    const setStatus = (status: ReadingCoachAdjustmentStatus) => {
      coachAdjustments.value = {
        ...coachAdjustments.value,
        [entry.id]: { ...coachAdjustments.value[entry.id], [kind]: status }
      }
    }
    setStatus('saving')
    try {
      await readingCoachApi.recordFeedback(entry.id, kind)
      setStatus('saved')
    } catch (feedbackFailure) {
      console.warn('阅读教练反馈保存失败:', feedbackFailure)
      setStatus('failed')
    }
  }

  // One preference-card request at a time, whichever card it is for. The result
  // is keyed by message id, which is unique, so a late answer is always filed
  // under the right card even after the learner has moved to another attempt.
  async function settleMemoryCard(messageId: string, request: () => Promise<MemoryCardLocal>) {
    const setLocal = (next: MemoryCardLocal) => {
      memoryCardLocal.value = { ...memoryCardLocal.value, [messageId]: next }
    }
    setLocal({ status: 'saving' })
    try {
      setLocal(await request())
    } catch (failure) {
      console.warn('阅读教练偏好卡片操作失败:', failure)
      setLocal(memoryCardFailure(failure))
    }
  }

  function startableMemoryCard(messageId: unknown): CoachMemoryCardView | null {
    const card = coachMemoryCards.value[String(messageId || '')]
    return card && card.state === 'pending' && !card.busy ? card : null
  }

  async function confirmCoachMemoryCard(messageId: unknown, text: unknown) {
    const card = startableMemoryCard(messageId)
    if (!card) return
    const wording = String(text ?? '').split(/\s+/).filter(Boolean).join(' ')
    if (!wording || [...wording].length > MEMORY_CARD_TEXT_LIMIT) {
      memoryCardLocal.value = {
        ...memoryCardLocal.value,
        [card.messageId]: { status: 'failed', error: MEMORY_CARD_ERRORS['memory_card.invalid_text'] }
      }
      return
    }
    await settleMemoryCard(card.messageId, async () => {
      await readingCoachApi.confirmMemoryCard(card.messageId, card.noteIndex, wording)
      return { status: 'confirmed', text: wording }
    })
  }

  async function dismissCoachMemoryCard(messageId: unknown) {
    const card = startableMemoryCard(messageId)
    if (!card) return
    await settleMemoryCard(card.messageId, async () => {
      await readingCoachApi.dismissMemoryCard(card.messageId, card.noteIndex)
      return { status: 'dismissed' }
    })
  }

  async function runCoachQuickAction(actionId: unknown) {
    if (!isReadingCoachEnabled()) {
      return
    }
    const action = String(actionId || '').trim()
    if (action === 'review') {
      await runAutomaticReviewCoach()
      return
    }
    const query = resolveCoachPresetQuery(action)
    if (!query) return
    await sendCoachQuery(query, {
      surface: 'chat_widget',
      action: action === 'similar' ? 'recommend_drills' : 'chat',
      promptKind: 'preset'
    })
  }

  async function runCoachSelectionAction(actionId: unknown) {
    if (!isReadingCoachEnabled()) {
      return
    }
    refreshSelectedContext()
    if (!selectedContext.value?.text) {
      coachError.value = '请先选中题干或原文片段。'
      coachNotice.value = coachError.value
      return
    }
    const action = String(actionId || 'explain_selection').trim()
    const queryMap: Record<string, string> = {
      explain_selection: '解释我选中的内容，并说明它和题目定位有什么关系',
      locate_evidence: '根据我选中的内容定位相关证据',
      find_paraphrases: '找出我选中内容里的同义替换和关键词'
    }
    await sendCoachQuery(queryMap[action] || queryMap.explain_selection, {
      surface: 'selection_popover',
      action,
      promptKind: 'preset'
    })
  }

  return {
    coachQuery,
    coachLoading,
    coachError,
    coachResponse,
    selectedContext,
    coachStreamMessage,
    readingCoachOpen,
    llmReviewStatus,
    llmReviewMessage,
    canAskCoach,
    coachStatusText,
    coachTranscript,
    coachFollowUps,
    coachFeedback,
    coachAdjustments,
    coachMemoryCards,
    coachReaskableId,
    coachNotice,
    coachHistoryFailed,
    coachRetryKind,
    retryCoachQuery,
    reloadCoachHistory,
    resetReadingCoachState,
    setReadingCoachOpen,
    hydrateReadingCoachFromSubmission,
    toggleReadingCoachPanel,
    refreshSelectedContext,
    clearSelectedContext,
    askCoach,
    askCoachFollowUp,
    reaskCoachMessage,
    submitCoachFeedback,
    confirmCoachMemoryCard,
    dismissCoachMemoryCard,
    runCoachQuickAction,
    runCoachSelectionAction,
    runAutomaticReviewCoach,
    isCurrentSubmission,
    buildCoachPayload
  }
}
