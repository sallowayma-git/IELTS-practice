<template>
  <div class="evaluating-page">
    <div class="evaluating-layout">
      <section class="essay-panel">
        <header class="essay-head">
          <h1 class="heading-serif">作文评测</h1>
          <p class="word-count">IELTS 写作 · {{ displayWordCount }} 词</p>
        </header>

        <div class="topic-block">
          <h2 class="topic-block__label">评测题目</h2>
          <p class="topic-block__text">{{ displayTopicText }}</p>
        </div>

        <div class="essay-body">
          <p v-if="!essayContentFull" class="essay-placeholder">正在读取作文内容…</p>
          <div v-else class="typewriter-content">
            {{ displayedEssayContent }}<span class="cursor-blink" v-if="progress < 100"></span>
          </div>
        </div>
      </section>

      <aside class="status-rail">
        <section class="rail-progress">
          <h2 class="heading-serif">{{ error ? '评分未完成' : '正在评分' }}</h2>
          <div v-if="error" class="evaluation-error" role="alert">
            <p>{{ error.message }}</p>
            <p class="status-meta">作文已保存在本机；可直接重试，或取消后返回写作页继续修改。</p>
          </div>
          <p v-else class="subtitle">依据 IELTS 写作评分标准逐项分析。</p>
          <p class="progress-figure"><span>{{ progress }}</span>%</p>
          <div class="progress-rail" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`评测进度：${progress}%`">
            <div class="progress-bar">
              <div class="progress-bar-fill" :style="{ width: `${progress}%` }"></div>
            </div>
          </div>
          <p class="stage-label" :class="{ 'stage-label--failed': error }">{{ currentStageLabel }}</p>
        </section>

        <section class="rail-section rail-log">
          <h3>过程记录</h3>
          <div v-if="recentLogs.length > 0" class="log-list" role="log" aria-live="polite" aria-relevant="additions text" aria-label="评测动态日志">
            <div v-for="item in recentLogs" :key="item.id" class="log-item">
              <span class="log-time">{{ item.time }}</span>
              <span class="log-message">{{ item.message }}</span>
            </div>
          </div>
          <div v-else class="log-list empty-log" role="status" aria-live="polite">
            <p class="rail-empty">准备进入评测流程…</p>
          </div>
        </section>

        <div class="action-row">
          <button :class="['btn', error ? 'btn-brand' : 'btn-text']" :disabled="isRetrying || isComplete" @click="handleRetry">
            {{ isRetrying ? '重试中...' : '重试评分' }}
          </button>
          <button class="btn-text" :disabled="isRetrying || isCancelling" @click="handleCancel">
            {{ isCancelling ? '正在返回写作…' : '取消评分' }}
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { evaluate, getErrorMessage, resolveApiErrorMessage } from '@/api/client.js'
import { getDraft } from '@/api/writing-repository.js'
import { normalizeMap } from '@/utils/evaluation-result.js'

const props = defineProps({
  sessionId: {
    type: String,
    required: true
  }
})

const router = useRouter()
const route = useRoute()

const progress = ref(0)
const statusMessage = ref('正在准备评测...')
const sentences = ref([])
const feedback = ref('')
const error = ref(null)
const currentStage = ref('preparing')
const stageMessage = ref('正在准备评测...')
const isComplete = ref(false)
const hasNavigatedToResult = ref(false)
const timelineLogs = ref([])
const isRetrying = ref(false)
const isCancelling = ref(false)
const currentEvaluationId = ref(null)
let eventListenerId = null
const seenEventSequences = new Set()
let lastLogSignature = ''

const fullResult = ref({
  id: '',
  status: 'queued',
  stage: 'preparing',
  score: null,
  feedback: null
})

onMounted(() => {
  eventListenerId = evaluate.onEvent(handleEvent)
  if (route.query.startError) {
    error.value = { code: String(route.query.startError), message: getErrorMessage(String(route.query.startError)) }
    currentStage.value = 'failed'
    stageMessage.value = error.value.message
    appendLog('error', error.value.message)
  }
  void hydrateSessionState()
})

onUnmounted(() => {
  evaluate.removeEventListener(eventListenerId)
  eventListenerId = null
})

const recentLogs = computed(() => timelineLogs.value.slice(-3))

const currentStageLabel = computed(() => stageLabel(currentStage.value, stageMessage.value))

const tempDraft = ref(null)

const essayContentFull = computed(() => {
  return tempDraft.value?.content || ''
})

const displayedEssayContent = ref('')
const currentDisplayLength = ref(0)
let typewriterTimeout = null
const TYPEWRITER_INTERVAL_MS = 15

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function startTypewriter(newProgress) {
  if (typewriterTimeout) clearTimeout(typewriterTimeout)
  
  const text = essayContentFull.value
  if (!text) return
  
  const targetRatio = Math.max(0, Math.min(100, newProgress)) / 100
  const targetLen = Math.floor(text.length * targetRatio)

  if (prefersReducedMotion()) {
    currentDisplayLength.value = targetLen
    displayedEssayContent.value = text.substring(0, targetLen)
    return
  }
  
  if (currentDisplayLength.value >= targetLen && newProgress < 100) return
  
  const tick = () => {
    if (currentDisplayLength.value < targetLen) {
      const gap = targetLen - currentDisplayLength.value
      let step = gap > 80 ? Math.floor(gap / 25) + 1 : 1
      
      currentDisplayLength.value += step
      if (currentDisplayLength.value > targetLen) {
        currentDisplayLength.value = targetLen
      }
      displayedEssayContent.value = text.substring(0, currentDisplayLength.value)
      
      if (currentDisplayLength.value < text.length) {
        typewriterTimeout = setTimeout(tick, TYPEWRITER_INTERVAL_MS)
      }
    }
  }
  tick()
}

watch(progress, (newVal) => {
  startTypewriter(newVal)
})

const displayTopicText = computed(() => {
  return tempDraft.value?.topic_text || '正在读取题目内容…'
})

const displayWordCount = computed(() => {
  return tempDraft.value?.word_count || 0
})




function handleEvent(event) {
  if (!event || typeof event !== 'object') return
  if (event.sessionId !== props.sessionId) return
  if (
    currentEvaluationId.value
    && event.evaluationId
    && event.evaluationId !== currentEvaluationId.value
  ) return
  if (typeof event.sequence === 'number') {
    if (seenEventSequences.has(event.sequence)) {
      return
    }
    seenEventSequences.add(event.sequence)
  }

  switch (event.type) {
    case 'stage':
      appendLog('stage', stageLabel(event.data?.stage), event)
      applyStageFromPayload(event.data)
      break

    case 'score':
      appendLog('score', '评分结果已生成', event)
      applyStage('scoring', '分数计算完成，正在准备详解...')
      fullResult.value.score = event.data
      break

    case 'review':
      appendLog('review', '段落详解已生成', event)
      applyStage('reviewing', '正在输出段落和句级详解...')
      feedback.value = event.data?.overall || ''
      sentences.value = Array.isArray(event.data?.sentences) ? event.data.sentences : []
      fullResult.value.feedback = event.data
      break

    case 'complete':
      appendLog('complete', '评测完成，正在跳转结果页', event)
      isComplete.value = true
      applyStage('completed', '评分完成！')
      progress.value = 100
      statusMessage.value = '评分完成！'
      if (event.data?.evaluation && typeof event.data.evaluation === 'object') {
        fullResult.value = { ...fullResult.value, ...event.data.evaluation }
      }
      void navigateToResult()
      break

    case 'error':
      appendLog('error', event.data?.message || getErrorMessage(event.data?.code), event)
      error.value = {
        code: event.data.code,
        message: event.data.message || getErrorMessage(event.data.code)
      }
      currentStage.value = 'failed'
      stageMessage.value = error.value.message
      statusMessage.value = error.value.message
      break

    case 'cancelled':
      appendLog('cancelled', '评测已取消，作文草稿已保留', event)
      error.value = null
      break

    case 'log':
      appendLog('log', event.data?.message || '评测日志更新', event)
      break
  }
}

async function hydrateSessionState() {
  try {
    const { draft } = await getDraft(props.sessionId)
    if (draft) {
      tempDraft.value = {
        task_type: draft.taskType || draft.task_type || '',
        mode: draft.mode || '',
        topic_id: String(draft.assetId ?? draft.asset_id ?? '').trim(),
        topic_text: draft.promptSnapshot || draft.prompt_snapshot || '',
        content: draft.contentText || draft.content_text || '',
        word_count: draft.wordCount ?? draft.word_count ?? 0
      }
    }
    const state = await evaluate.getSessionState(props.sessionId)
    currentEvaluationId.value = state.evaluationId
    if (tempDraft.value && !tempDraft.value.task_type) {
      tempDraft.value.task_type = state.evaluation?.taskType || ''
    }
    const events = Array.isArray(state?.events) ? state.events : []
    for (const event of events) {
      handleEvent(event)
    }
  } catch (sessionError) {
    console.warn('读取评测会话状态失败:', sessionError)
  }
}

async function handleCancel() {
  if (isRetrying.value || isCancelling.value) return
  isCancelling.value = true
  try {
    if (currentEvaluationId.value) {
      try {
        const cancelled = await evaluate.cancel(props.sessionId)
        if (!cancelled?.cancelled) {
          appendLog('system', '原评测已结束或无法取消；将保留原记录并创建可编辑副本。')
        }
      } catch (cancelError) {
        // Editing must not depend on best-effort cancellation. The clone command
        // snapshots immutable input, so a provider that finishes late can only
        // affect the original historical attempt.
        console.warn('取消旧评测失败，继续创建可编辑副本:', cancelError)
        appendLog('system', '原评测未确认取消；已继续创建独立可编辑副本。')
      }
    }
    const draft = await evaluate.cloneDraft(props.sessionId)
    const attemptId = draft.attemptId || draft.attempt_id
    await router.push({
      name: 'Compose',
      query: { resumeAttemptId: attemptId }
    })
  } catch (err) {
    console.error('取消并创建可编辑副本失败:', err)
    const message = resolveApiErrorMessage(err, String(err?.code || 'cancel_failed'))
    error.value = { code: 'cancel_failed', message }
    appendLog('error', `取消失败：${message}`)
  } finally {
    isCancelling.value = false
  }
}

function retryTaskType() {
  const value = String(tempDraft.value?.task_type || '').trim()
  return value === 'task1' || value === 'task2' ? value : null
}

async function handleRetry() {
  if (isRetrying.value || isComplete.value) return

  error.value = null
  const taskType = retryTaskType()
  if (!taskType) {
    error.value = {
      code: 'start_failed',
      message: '缺少可重试的写作任务类型，请返回写作页重新提交'
    }
    appendLog('error', error.value.message)
    return
  }

  isRetrying.value = true
  appendLog('system', '正在重新发起评测请求...')

  try {
    try {
      await evaluate.cancel(props.sessionId)
    } catch (cancelError) {
      console.warn('重试前取消旧会话失败，继续创建新会话', cancelError)
    }

    const result = await evaluate.retry({
      sessionId: props.sessionId,
      task_type: taskType,
      retryOf: currentEvaluationId.value
    })

    currentEvaluationId.value = result.evaluationId
    seenEventSequences.clear()
    isComplete.value = false
    progress.value = 0
    applyStage('preparing', '正在准备评测...')
    appendLog('system', '新会话已创建，正在重启评分流程。')
  } catch (retryError) {
    console.error('重试失败:', retryError)
    const code = String(retryError?.code || 'unknown_error')
    const message = resolveApiErrorMessage(retryError, code)
    error.value = { code, message }
    appendLog('error', `重试失败：${message}`)
  } finally {
    isRetrying.value = false
  }
}

async function handleBack() {
  if (!isComplete.value) await handleCancel()
}

async function navigateToResult() {
  if (hasNavigatedToResult.value) return
  hasNavigatedToResult.value = true

  try {
    await router.replace({
      name: 'Result',
      params: { sessionId: props.sessionId },
      query: {}
    })
  } catch (err) {
    hasNavigatedToResult.value = false
    console.error('跳转结果页失败:', err)
  }
}

function stageLabel(key, fallbackMessage = '') {
  if (key === 'preparing') return '准备中'
  if (key === 'scoring') return '评分中'
  if (key === 'reviewing') return '详解生成中'
  if (key === 'completed') return '已完成'
  if (key === 'failed') return '评测失败'
  if (typeof fallbackMessage === 'string' && fallbackMessage.trim()) return fallbackMessage.trim()
  return '评测中'
}

function applyStageFromPayload(data) {
  const stage = normalizeMap(data)
  const rawKey = typeof stage.name === 'string'
    ? stage.name
    : (typeof stage.stage === 'string' ? stage.stage : '')
  const key = mapStageKey(rawKey)
  const message = typeof stage.message === 'string' ? stage.message : statusMessage.value
  applyStage(key, message)
}

function mapStageKey(rawKey) {
  const key = String(rawKey || '').toLowerCase()
  if (!key) return currentStage.value
  if (['prepare', 'preparing', 'starting', 'start'].includes(key)) return 'preparing'
  if (['score', 'scoring', 'analysis', 'stage1', 'scoring_stage'].includes(key)) return 'scoring'
  if (['review', 'reviewing', 'stage2', 'detail', 'rewrite'].includes(key)) return 'reviewing'
  if (key === 'finalizing') return 'reviewing'
  if (['complete', 'completed', 'done', 'finish', 'finished'].includes(key)) return 'completed'
  return currentStage.value
}

function applyStage(stageKey, message) {
  const normalizedStage = mapStageKey(stageKey)
  currentStage.value = normalizedStage
  stageMessage.value = typeof message === 'string' && message.trim()
    ? message
    : stageLabel(normalizedStage)
  statusMessage.value = stageMessage.value
  fullResult.value.stage = normalizedStage
  const stageProgress = { preparing: 10, scoring: 45, reviewing: 80, completed: 100 }
  progress.value = Math.max(progress.value, stageProgress[normalizedStage] || 0)
}

function getStageClass(chip) {
  if (chip === currentStage.value) return 'active'
  if (currentStage.value === 'completed') return 'done'
  const order = ['preparing', 'scoring', 'reviewing', 'completed']
  if (order.indexOf(chip) < order.indexOf(currentStage.value)) return 'done'
  return ''
}

function appendLog(kind, message, event = null) {
  const text = String(message || '').trim()
  if (!text) return

  const signature = [
    kind,
    typeof event?.sequence === 'number' ? event.sequence : '',
    text
  ].join(':')
  if (signature === lastLogSignature) {
    return
  }
  lastLogSignature = signature

  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  timelineLogs.value = [
    ...timelineLogs.value,
    {
      id: signature,
      kind,
      time,
      message: text
    }
  ].slice(-30)
}

</script>
<style scoped>
/* Evaluating: the essay as a page of prose, progress as a quiet margin note. */
.evaluating-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(260px, 0.8fr);
  align-items: start;
  gap: 56px;
}

.essay-panel {
  min-width: 0;
}

.essay-head {
  display: grid;
  gap: 6px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--anth-rule);
}

.essay-head h1 {
  margin: 0;
  font-size: clamp(1.75rem, 3vw, 2.125rem);
}

.word-count {
  margin: 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.topic-block {
  margin: 20px 0 28px;
}

.topic-block__label {
  margin: 0 0 4px;
  color: var(--anth-ink-faint);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  font-weight: var(--anth-weight-normal);
}

.topic-block__text {
  max-width: var(--anth-measure);
  margin: 0;
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-serif);
  font-style: italic;
  line-height: var(--anth-leading-relaxed);
}

.essay-body {
  min-height: 320px;
}

.typewriter-content {
  max-width: var(--anth-measure);
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: 1.0625rem;
  line-height: 1.85;
  white-space: pre-wrap;
}

.essay-placeholder {
  margin: 0;
  color: var(--anth-ink-faint);
}

.cursor-blink {
  display: inline-block;
  width: 1px;
  height: 1.1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--anth-ink);
  animation: evaluating-blink 1s steps(1) infinite;
}

@keyframes evaluating-blink {
  50% { opacity: 0; }
}

.status-rail {
  position: sticky;
  top: calc(var(--anth-nav-height) + 24px);
  display: grid;
  gap: 28px;
  min-width: 0;
}

.rail-progress {
  padding-top: 14px;
  border-top: 1px solid var(--anth-ink);
}

.rail-progress h2 {
  margin: 0;
  font-size: var(--anth-text-lg);
}

.subtitle {
  margin: 4px 0 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

.evaluation-error {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--anth-danger);
}

.evaluation-error p {
  margin: 0;
  color: var(--anth-danger);
  font-size: var(--anth-text-sm);
}

.evaluation-error .status-meta {
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-xs);
}

.progress-figure {
  margin: 20px 0 8px;
  color: var(--anth-ink-faint);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-lg);
  font-variant-numeric: lining-nums tabular-nums;
}

.progress-figure span {
  color: var(--anth-ink-strong);
  font-size: 2.75rem;
  line-height: 1;
}

.progress-bar {
  height: 2px;
  background: var(--anth-rule);
}

.progress-bar-fill {
  height: 100%;
  background: var(--anth-ink);
  transition: width var(--anth-duration-slow) var(--anth-ease);
}

/* Stage: a word with a square marker. */
.stage-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

.stage-label::before {
  content: "";
  width: 7px;
  height: 7px;
  background: var(--anth-ink);
}

.stage-label--failed {
  color: var(--anth-danger);
}

.stage-label--failed::before {
  background: var(--anth-danger);
}

.rail-section h3 {
  margin: 0 0 8px;
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  font-weight: var(--anth-weight-semibold);
}

.log-list {
  display: grid;
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--anth-rule);
}

.log-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--anth-border-subtle);
  font-size: var(--anth-text-xs);
  animation: atlas-fade-in var(--anth-duration-normal) var(--anth-ease) both;
}

.log-time {
  color: var(--anth-ink-faint);
  font-variant-numeric: lining-nums tabular-nums;
}

.log-message {
  color: var(--anth-ink-soft);
}

.rail-empty {
  margin: 0;
  padding: 10px 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.action-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

@media (max-width: 960px) {
  .evaluating-layout {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .status-rail {
    position: static;
    order: -1;
  }

  .essay-body {
    min-height: 0;
  }
}
</style>
