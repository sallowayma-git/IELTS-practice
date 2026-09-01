import { computed, ref, unref } from 'vue'
import { readingCoachApi, readingSessionApi } from './api'

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
  content: string
  isError: boolean
  followUps: unknown[]
  snapshot: AnyRecord | null
}

type PayloadOptions = {
  action?: string
  surface?: string
  promptKind?: string
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

function normalizeCoachTranscript(value: unknown): CoachTranscriptEntry[] {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => {
      const row = asRecord(entry)
      if (!row) return null
      const snapshot = asRecord(row.snapshot) || asRecord(row.structuredPayload)
      const content = String(row.content || snapshot?.answer || snapshot?.message || '').trim()
      if (!content) return null
      return {
        id: String(row.id || row.createdAt || `coach_${index}`),
        role: row.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content,
        isError: Boolean(row.isError || String(row.status || '').toLowerCase() === 'failed'),
        followUps: Array.isArray(row.followUps)
          ? row.followUps
          : (Array.isArray(snapshot?.followUps) ? snapshot!.followUps : []),
        snapshot
      }
    })
    .filter((entry): entry is CoachTranscriptEntry => Boolean(entry))
    .slice(-40)
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

function formatLlmFailureStatusMessage(error: unknown): string {
  const code = errorField(error, 'code').toLowerCase()
  const rawMessage = errorField(error, 'message')
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
  const coachQuery = ref('这题怎么定位证据？')
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
  let coachRequestSequence = 0

  const submission = computed(() => readSource(options.submissionSource))
  const singleAttemptAnalysisLlm = computed(() => (
    submission.value?.singleAttemptAnalysisLlm
    || submission.value?.analysisArtifacts?.singleAttemptAnalysisLlm
    || null
  ))
  const coachTranscript = computed(() => coachTranscriptState.value)
  const coachFollowUps = computed(() => {
    const transcript = coachTranscript.value
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const entry = transcript[index]
      if (entry.role !== 'assistant') continue
      const followUps = Array.isArray(entry.followUps)
        ? entry.followUps
        : (Array.isArray(entry.snapshot?.followUps) ? entry.snapshot.followUps : [])
      const normalized = followUps.map((item) => String(item || '').trim()).filter(Boolean)
      if (normalized.length) {
        return normalized.slice(0, 3)
      }
    }
    return []
  })
  const canAskCoach = computed(() => Boolean(submission.value && coachQuery.value.trim() && !coachLoading.value))
  const coachStatusText = computed(() => {
    if (coachLoading.value) return coachStreamMessage.value || 'AI 教练正在思考...'
    if (coachError.value) return coachError.value
    return ''
  })
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

  function resetReadingCoachState() {
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
  }

  function setReadingCoachOpen(value: unknown) {
    readingCoachOpen.value = isReadingCoachEnabled() && Boolean(value)
  }

  async function hydratePersistedCoachMessages(sessionId: string) {
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
      if (!isCurrentSubmission(sessionId)) return
      coachThreadId.value = String(result.threadId || '')
      coachTranscriptState.value = normalizeCoachTranscript(result.messages)
      const latestAssistant = [...coachTranscriptState.value].reverse().find((entry) => entry.role === 'assistant')
      if (latestAssistant) {
        coachResponse.value = latestAssistant.snapshot || { answer: latestAssistant.content }
      }
      const hasPersistedReview = coachTranscriptState.value.some((entry) => (
        entry.role === 'user' && String(entry.snapshot?.action || '') === 'review_set'
      ))
      if (hasPersistedReview) {
        llmReviewStatus.value = 'success'
        llmReviewMessage.value = 'AI 复盘已载入'
      }
    } catch (error) {
      if (!isCurrentSubmission(sessionId)) return
      coachError.value = errorField(error, 'message') || 'AI 教练历史加载失败'
    }
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
    coachResponse.value = null
    const sessionId = String(nextSubmission?.sessionId || nextSubmission?.attemptId || '').trim()
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

  function buildCoachPayload(query: unknown, payloadOptions: PayloadOptions = {}) {
    options.flushActiveQuestionVisit?.()
    const action = String(payloadOptions.action || 'chat').trim() || 'chat'
    const surface = String(payloadOptions.surface || (action === 'review_set' ? 'review_workspace' : 'chat_widget')).trim()
    const promptKind = String(payloadOptions.promptKind || 'freeform').trim() || 'freeform'
    const context = refreshSelectedContext()
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
      attemptContext: {
        submitted: true,
        score: submission.value?.coachContext?.score ?? submission.value?.scoreInfo?.percentage ?? null,
        wrongQuestions: resolveCoachWrongQuestions(),
        selectedAnswers: resolveCoachSelectedAnswers(),
        analysisSignals: submission.value?.analysisSignals || submission.value?.analysisArtifacts?.analysisSignals || null,
        markedQuestions: Array.isArray(submission.value?.markedQuestions) ? submission.value.markedQuestions : [],
        questionTimelineLite: Array.isArray(submission.value?.questionTimelineLite) ? submission.value.questionTimelineLite : [],
        questionTypePerformance: submission.value?.questionTypePerformance || {}
      }
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

  function appendLocalCoachError(message: unknown) {
    coachTranscriptState.value = [...coachTranscriptState.value, {
      id: `coach-error-${Date.now()}`,
      role: 'assistant',
      content: String(message || '阅读教练请求失败').trim(),
      isError: true,
      followUps: [],
      snapshot: null
    }]
  }

  function isCurrentSubmission(expectedSessionId: unknown) {
    const normalized = String(expectedSessionId || '').trim()
    return Boolean(normalized && String(submission.value?.sessionId || '').trim() === normalized)
  }

  function handleCoachStreamEvent(streamEvent: unknown, { expectedSessionId, mode = 'coach' }: StreamHandleOptions = {}) {
    if (!isCurrentSubmission(expectedSessionId)) return
    const nextMessage = formatCoachStreamMessage(streamEvent, mode)
    if (!nextMessage) return
    if (mode === 'review') {
      llmReviewMessage.value = nextMessage
    } else {
      coachStreamMessage.value = nextMessage
    }
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
    coachLoading.value = true
    coachError.value = ''
    coachResponse.value = null
    coachStreamMessage.value = '教练已连接...'
    try {
      const requestPayload = buildCoachPayload(normalizedQuery, queryOptions)
      const response = await readingCoachApi.query(requestPayload, expectedSessionId, {
        onEvent: (event) => handleCoachStreamEvent(event, { expectedSessionId, mode: 'coach' })
      })
      if (!isReadingCoachEnabled()) {
        return response
      }
      if (!isCurrentSubmission(expectedSessionId)) {
        return response
      }
      applyCoachResponse(response)
      return response
    } catch (coachFailure) {
      console.error('阅读教练请求失败:', coachFailure)
      if (!isReadingCoachEnabled()) {
        return null
      }
      if (!isCurrentSubmission(expectedSessionId)) {
        return null
      }
      const failureMessage = errorField(coachFailure, 'message')
      coachError.value = failureMessage
        ? `阅读教练请求失败：${failureMessage}`
        : '阅读教练请求失败，请稍后重试'
      appendLocalCoachError(coachError.value)
      return null
    } finally {
      if (coachRequestSequence === requestId && isCurrentSubmission(expectedSessionId)) {
        coachLoading.value = false
        coachStreamMessage.value = ''
      }
    }
  }

  async function runAutomaticReviewCoach(reviewOptions: ReviewOptions = {}) {
    const expectedSessionId = String(reviewOptions.expectedSessionId || submission.value?.sessionId || '').trim()
    if (!isReadingCoachEnabled()) {
      llmReviewStatus.value = 'idle'
      llmReviewMessage.value = ''
      return
    }
    if (!expectedSessionId || llmReviewStatus.value === 'running') {
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

    llmReviewStatus.value = 'running'
    llmReviewMessage.value = 'AI 正在复盘错题...'
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
      if (!isCurrentSubmission(expectedSessionId)) {
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
      if (!isCurrentSubmission(expectedSessionId)) {
        return
      }
      llmReviewStatus.value = 'failed'
      llmReviewMessage.value = formatLlmFailureStatusMessage(reviewFailure)
      appendLocalCoachError(llmReviewMessage.value)
    }
  }

  async function askCoach() {
    if (!isReadingCoachEnabled() || !canAskCoach.value) {
      return
    }
    const query = coachQuery.value.trim()
    await sendCoachQuery(query, {
      surface: 'chat_widget',
      action: 'chat',
      promptKind: 'freeform'
    })
  }

  async function askCoachFollowUp(query: unknown) {
    if (!isReadingCoachEnabled()) {
      return
    }
    await sendCoachQuery(query, {
      surface: 'chat_widget',
      action: 'chat',
      promptKind: 'followup'
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

  function queueAutomaticReviewRefresh(sessionId: unknown) {
    const expectedSessionId = String(sessionId || '').trim()
    if (!expectedSessionId) return
    Promise.resolve().then(() => {
      if (!isReadingCoachEnabled() || !isCurrentSubmission(expectedSessionId) || singleAttemptAnalysisLlm.value || llmReviewStatus.value === 'running') {
        return null
      }
      return runAutomaticReviewCoach({ expectedSessionId })
    }).catch((refreshFailure) => {
      console.warn('补全阅读回放 AI 复盘失败:', refreshFailure)
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
    resetReadingCoachState,
    setReadingCoachOpen,
    hydrateReadingCoachFromSubmission,
    toggleReadingCoachPanel,
    refreshSelectedContext,
    clearSelectedContext,
    askCoach,
    askCoachFollowUp,
    runCoachQuickAction,
    runCoachSelectionAction,
    runAutomaticReviewCoach,
    queueAutomaticReviewRefresh,
    isCurrentSubmission,
    buildCoachPayload
  }
}
