import { computed, ref, unref } from 'vue'
import { readingCoachApi, readingSessionApi } from './api'

const AUTOMATIC_REVIEW_QUERY = '请复盘我本次错题，按优先级给出训练建议'

function readSource(source) {
  return typeof source === 'function' ? source() : unref(source)
}

function normalizeCoachTranscript(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const snapshot = entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : null
      const content = String(entry.content || entry.text || snapshot?.answer || snapshot?.message || '').trim()
      if (!content) return null
      return {
        id: String(entry.id || entry.createdAt || `coach_${index}`),
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        content,
        isError: Boolean(entry.isError),
        followUps: Array.isArray(entry.followUps)
          ? entry.followUps
          : (Array.isArray(snapshot?.followUps) ? snapshot.followUps : []),
        snapshot
      }
    })
    .filter(Boolean)
    .slice(-40)
}

function hasLlmReview(submission) {
  return Boolean(
    submission?.singleAttemptAnalysisLlm
    || submission?.analysisArtifacts?.singleAttemptAnalysisLlm
  )
}

function formatCoachStreamMessage(streamEvent, mode = 'coach') {
  const eventName = String(streamEvent?.event || streamEvent?.type || '').trim()
  const payload = streamEvent?.data && typeof streamEvent.data === 'object' ? streamEvent.data : {}
  const detail = payload.data && typeof payload.data === 'object' ? payload.data : payload
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

function formatLlmFailureStatusMessage(error) {
  const code = String(error?.code || '').trim().toLowerCase()
  const rawMessage = String(error?.message || '').trim()
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

export function useReadingCoach(options = {}) {
  const coachQuery = ref('这题怎么定位证据？')
  const coachLoading = ref(false)
  const coachError = ref('')
  const coachResponse = ref(null)
  const selectedContext = ref(null)
  const coachStreamMessage = ref('')
  const readingCoachOpen = ref(false)
  const llmReviewStatus = ref('idle')
  const llmReviewMessage = ref('')
  let coachRequestSequence = 0

  const submission = computed(() => readSource(options.submissionSource))
  const singleAttemptAnalysisLlm = computed(() => (
    submission.value?.singleAttemptAnalysisLlm
    || submission.value?.analysisArtifacts?.singleAttemptAnalysisLlm
    || null
  ))
  const coachTranscript = computed(() => normalizeCoachTranscript(submission.value?.readingCoachTranscript))
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

  function setSubmission(nextSubmission) {
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
  }

  function setReadingCoachOpen(value) {
    readingCoachOpen.value = isReadingCoachEnabled() && Boolean(value)
  }

  function hydrateReadingCoachFromSubmission(nextSubmission, hydrateOptions = {}) {
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
    coachResponse.value = nextSubmission?.readingCoachSnapshot || null
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

  function normalizeCoachQuestionNumber(value) {
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
      return fromCoachContext.map((item) => String(item || '').trim()).filter(Boolean)
    }
    return Object.values(submission.value?.answerComparison || {})
      .filter((entry) => entry?.isCorrect === false)
      .map((entry) => String(entry.displayLabel || options.getDisplayLabel?.(entry.questionId)).replace(/^q/i, '').trim())
      .filter(Boolean)
  }

  function formatReviewAnswer(value) {
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
    return Object.values(submission.value?.answerComparison || {}).reduce((accumulator, entry) => {
      const questionNumber = String(entry?.displayLabel || options.getDisplayLabel?.(entry?.questionId)).replace(/^q/i, '').trim()
      const answer = formatReviewAnswer(entry?.userAnswer)
      if (questionNumber && answer) {
        accumulator[questionNumber] = answer
      }
      return accumulator
    }, {})
  }

  function resolveCoachFocusQuestionNumbers(context = selectedContext.value) {
    if (Array.isArray(context?.questionNumbers) && context.questionNumbers.length) {
      return context.questionNumbers
    }
    const wrongQuestions = resolveCoachWrongQuestions()
    if (wrongQuestions.length) {
      return wrongQuestions.slice(0, 3)
    }
    if (typeof document !== 'undefined') {
      const active = document.activeElement
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

  function buildCoachPayload(query, payloadOptions = {}) {
    options.flushActiveQuestionVisit?.()
    const action = String(payloadOptions.action || 'chat').trim() || 'chat'
    const surface = String(payloadOptions.surface || (action === 'review_set' ? 'review_workspace' : 'chat_widget')).trim()
    const promptKind = String(payloadOptions.promptKind || 'freeform').trim() || 'freeform'
    const context = refreshSelectedContext()
    return {
      examId: submission.value?.examId || readSource(options.assetIdSource),
      sessionId: submission.value?.sessionId || '',
      mode: resolveCoachMode(),
      query: String(query || '').trim(),
      locale: 'zh',
      surface,
      action,
      promptKind,
      selectedText: context?.text || '',
      selectedContext: context || null,
      focusQuestionNumbers: resolveCoachFocusQuestionNumbers(context),
      history: coachTranscript.value
        .map((entry) => ({ role: entry.role, content: entry.content }))
        .filter((entry) => entry.content.trim())
        .slice(-8),
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

  function resolveCoachPresetQuery(action) {
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

  function appendLocalCoachError(message) {
    if (!submission.value) return
    const transcript = Array.isArray(submission.value.readingCoachTranscript)
      ? submission.value.readingCoachTranscript.slice()
      : []
    transcript.push({
      role: 'assistant',
      content: String(message || '阅读教练请求失败').trim(),
      createdAt: new Date().toISOString(),
      isError: true
    })
    setSubmission({
      ...submission.value,
      readingCoachTranscript: transcript
    })
  }

  function isCurrentSubmission(expectedSessionId) {
    const normalized = String(expectedSessionId || '').trim()
    return Boolean(normalized && String(submission.value?.sessionId || '').trim() === normalized)
  }

  function handleCoachStreamEvent(streamEvent, { expectedSessionId, mode = 'coach' } = {}) {
    if (!isCurrentSubmission(expectedSessionId)) return
    const nextMessage = formatCoachStreamMessage(streamEvent, mode)
    if (!nextMessage) return
    if (mode === 'review') {
      llmReviewMessage.value = nextMessage
    } else {
      coachStreamMessage.value = nextMessage
    }
  }

  async function refreshSubmissionFromHistory(expectedSessionId, refreshOptions = {}) {
    if (!isCurrentSubmission(expectedSessionId)) {
      return null
    }
    try {
      const state = await readingSessionApi.getState(expectedSessionId)
      const refreshedSubmission = state?.submission || null
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

  function mergeCoachResultIntoSubmission(response, query, llmPatch = null, meta = {}, expectedSessionId = '') {
    if (!submission.value || (expectedSessionId && !isCurrentSubmission(expectedSessionId))) {
      return
    }
    const snapshot = response && typeof response === 'object' ? response : { value: response }
    const now = new Date().toISOString()
    const transcript = Array.isArray(submission.value.readingCoachTranscript)
      ? submission.value.readingCoachTranscript.slice()
      : []
    const normalizedQuery = String(query || '').trim()
    if (normalizedQuery) {
      transcript.push({
        role: 'user',
        content: normalizedQuery,
        createdAt: now,
        surface: String(meta.surface || 'review_workspace'),
        action: String(meta.action || 'review_set')
      })
    }
    transcript.push({
      role: 'assistant',
      content: String(snapshot.answer || snapshot.message || '').trim(),
      createdAt: now,
      snapshot
    })

    const nextSubmission = {
      ...submission.value,
      readingCoachSnapshot: snapshot,
      readingCoachTranscript: transcript
    }
    if (llmPatch && typeof llmPatch === 'object') {
      nextSubmission.singleAttemptAnalysisLlm = llmPatch
    }
    setSubmission(nextSubmission)
  }

  async function sendCoachQuery(query, queryOptions = {}) {
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
      coachResponse.value = response
      const refreshedSubmission = await refreshSubmissionFromHistory(expectedSessionId)
      if (!refreshedSubmission) {
        mergeCoachResultIntoSubmission(
          response,
          normalizedQuery,
          response?.singleAttemptAnalysisLlm || null,
          requestPayload,
          expectedSessionId
        )
      }
      options.snapshotSubmission?.()
      return response
    } catch (coachFailure) {
      console.error('阅读教练请求失败:', coachFailure)
      if (!isReadingCoachEnabled()) {
        return null
      }
      if (!isCurrentSubmission(expectedSessionId)) {
        return null
      }
      coachError.value = coachFailure?.message
        ? `阅读教练请求失败：${coachFailure.message}`
        : '阅读教练请求失败，请稍后重试'
      const refreshedSubmission = await refreshSubmissionFromHistory(expectedSessionId, { preserveCoachResponse: false })
      if (!refreshedSubmission) {
        appendLocalCoachError(coachError.value)
      }
      options.snapshotSubmission?.()
      return null
    } finally {
      if (coachRequestSequence === requestId && isCurrentSubmission(expectedSessionId)) {
        coachLoading.value = false
        coachStreamMessage.value = ''
      }
    }
  }

  async function runAutomaticReviewCoach(reviewOptions = {}) {
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
      const llmPatch = response?.singleAttemptAnalysisLlm || null
      coachResponse.value = response
      const refreshedSubmission = await refreshSubmissionFromHistory(expectedSessionId)
      if (!refreshedSubmission) {
        mergeCoachResultIntoSubmission(response, AUTOMATIC_REVIEW_QUERY, llmPatch, requestPayload, expectedSessionId)
      }
      llmReviewStatus.value = 'success'
      llmReviewMessage.value = 'AI 复盘已更新'
      options.snapshotSubmission?.()
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
      const refreshedSubmission = await refreshSubmissionFromHistory(expectedSessionId, { preserveCoachResponse: false })
      if (!refreshedSubmission) {
        appendLocalCoachError(llmReviewMessage.value)
      }
      options.snapshotSubmission?.()
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

  async function askCoachFollowUp(query) {
    if (!isReadingCoachEnabled()) {
      return
    }
    await sendCoachQuery(query, {
      surface: 'chat_widget',
      action: 'chat',
      promptKind: 'followup'
    })
  }

  async function runCoachQuickAction(actionId) {
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

  async function runCoachSelectionAction(actionId) {
    if (!isReadingCoachEnabled()) {
      return
    }
    refreshSelectedContext()
    if (!selectedContext.value?.text) {
      coachError.value = '请先选中题干或原文片段。'
      return
    }
    const action = String(actionId || 'explain_selection').trim()
    const queryMap = {
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

  function queueAutomaticReviewRefresh(sessionId) {
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
