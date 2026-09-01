<template>
  <div class="evaluating-page">
    <div class="evaluating-layout">
      <!-- 作文内容与渐进式分析 -->
      <section class="essay-panel card card-whisper">
        <div class="essay-head border-base">
          <div>
            <h2 class="heading-serif display-heading">作文评测</h2>
            <p class="topic-meta">{{ displayTopicText }}</p>
          </div>
          <span class="word-badge">{{ displayWordCount }} 词</span>
        </div>
        
        <div class="essay-body relative">
          <!-- Floating Loader watermark under the text -->
          <div class="floating-loader" :class="{'fade-out': progress > 98}">
            <svg class="xl-icon pulse" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 1.5V8h3.5L13 4.5zM8 11h8v1.5H8V11zm0 3h8v1.5H8V14zm0 3h5v1.5H8V17z"/>
            </svg>
            <p>正在解析作文内容</p>
          </div>
          
          <!-- Text Typewriter layer -->
          <div class="typewriter-content" v-if="essayContentFull">
            {{ displayedEssayContent }}<span class="cursor-blink" v-if="progress < 100"></span>
          </div>
        </div>
      </section>

      <!-- 评测状态 -->
      <aside class="status-rail right-panel">
        <div class="ai-hero glass-card">
          <div class="orb-zone">
            <!-- Breathing aurora sphere -->
            <div class="aurora-sphere"></div>
            <div class="orb-inner">
              <span class="orb-percentage">{{ progress }}%</span>
            </div>
          </div>
          <h2 class="heading-serif">正在进行智能评测</h2>
          <p class="subtitle">正在依据 IELTS 评分标准分析你的作文。</p>
        </div>

        <section class="glass-card rail-section">
          <div class="rail-head">
            <h3>实时进度</h3>
            <span class="status-meta uppercase">{{ progress }}% / {{ currentStageLabel }}</span>
          </div>
          <div class="progress-rail mt-3" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`评测进度：${progress}%`">
            <div class="progress-bar">
              <div class="progress-bar-fill" :style="{ width: `${progress}%` }"></div>
            </div>
          </div>
        </section>

        <section v-if="error" class="glass-card rail-section evaluation-error" role="alert">
          <h3>评测未完成</h3>
          <p>{{ error.message }}</p>
          <p class="status-meta">作文已保存在本机；可直接重试，或取消后返回写作页继续修改。</p>
        </section>

        <section class="glass-card rail-section flex-1 overflow-hidden flex-col">
          <div class="rail-head header-fixed">
            <h3>实时日志</h3>
            <span class="status-meta" aria-hidden="true">实时更新</span>
          </div>
          <div v-if="recentLogs.length > 0" class="log-list custom-scroll" role="log" aria-live="polite" aria-relevant="additions text" aria-label="评测动态日志">
            <div v-for="item in recentLogs" :key="item.id" class="log-item fade-in-up">
              <span class="log-time">{{ item.time }}</span>
              <span class="log-message">{{ item.message }}</span>
            </div>
          </div>
          <div v-else class="log-list empty-log" role="status" aria-live="polite">
             <p class="rail-empty">准备进入评测流程…</p>
          </div>
        </section>
        <div class="action-row mt-auto">
          <button class="btn btn-secondary w-full" :disabled="isRetrying || isComplete" @click="handleRetry">
            {{ isRetrying ? '重试中...' : '重试评分' }}
          </button>
          <button class="btn btn-warn w-full" :disabled="isRetrying || isCancelling" @click="handleCancel">
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
.evaluating-page {
  --evaluate-accent: var(--atlas-accent);
  --evaluate-accent-alt: var(--atlas-accent-alt);
  --evaluate-ink: var(--atlas-ink);
  --evaluate-muted: var(--atlas-ink-soft);
  --evaluate-line: var(--atlas-line);
  --evaluate-rim: var(--atlas-rim);
  position: relative;
  isolation: isolate;
  max-width: 1400px;
  min-height: calc(100vh - 146px);
  margin: 0 auto;
  padding: 2px;
  color: var(--evaluate-ink);
  background: transparent;
  border-radius: 32px;
  animation: evaluate-page-enter 360ms var(--lg-easing-spring, cubic-bezier(0.22, 1, 0.36, 1)) both;
}

.evaluating-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.32fr) minmax(320px, 0.68fr);
  gap: 18px;
}

.essay-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  padding: 26px;
  border: 1px solid var(--evaluate-rim);
  border-radius: 26px;
  background: var(--atlas-glass);
  box-shadow: var(--atlas-shadow);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  animation: evaluate-panel-enter-right 440ms var(--lg-easing-spring, cubic-bezier(0.22, 1, 0.36, 1)) both;
}

.right-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: evaluate-panel-enter-left 440ms var(--lg-easing-spring, cubic-bezier(0.22, 1, 0.36, 1)) both;
}

.action-row {
  display: flex;
  gap: 9px;
  padding: 4px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: 18px;
  background: var(--lg-bg-toolbar);
  box-shadow: var(--lg-shadow-subtle);
}

.border-base {
  border-bottom: 1px solid var(--evaluate-line);
  padding-bottom: 18px;
  margin-bottom: 18px;
}

.essay-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}

.display-heading {
  font-size: clamp(1.7rem, 2.8vw, 2.28rem);
  color: var(--evaluate-ink);
  margin-bottom: 6px;
  letter-spacing: -0.035em;
}

.topic-meta {
  max-width: 58ch;
  color: var(--evaluate-muted);
  font-size: 0.94rem;
  line-height: 1.55;
}

.word-badge {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--atlas-accent-ring);
  background: var(--atlas-accent-soft);
  color: var(--evaluate-accent);
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.essay-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
  padding: 21px 22px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: 20px;
  background: var(--lg-bg-primary);
  box-shadow: var(--lg-shadow-subtle);
  overscroll-behavior: contain;
}

.floating-loader {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--evaluate-accent);
  opacity: 0.13;
  pointer-events: none;
  transition: opacity 320ms var(--lg-easing-spring, ease);
  z-index: 0;
}

.floating-loader p {
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.05rem;
  text-transform: uppercase;
}

.fade-out {
  opacity: 0 !important;
}

.typewriter-content {
  position: relative;
  z-index: 1;
  white-space: pre-wrap;
  line-height: 1.9;
  color: var(--evaluate-ink);
  font-size: 1.02rem;
}

.cursor-blink {
  display: inline-block;
  width: 5px;
  height: 17px;
  border-radius: 999px;
  background-color: var(--evaluate-accent);
  margin-left: 4px;
  animation: evaluate-blink 1s step-start infinite;
  vertical-align: middle;
}

@keyframes evaluate-blink {
  50% { opacity: 0; }
}

.xl-icon {
  width: 4.5rem;
  height: 4.5rem;
  fill: currentColor;
  margin-bottom: 12px;
}

.pulse {
  animation: evaluate-pulse 2.4s ease-in-out infinite;
}

.glass-card {
  position: relative;
  min-width: 0;
  border: 1px solid var(--evaluate-rim);
  border-radius: 22px;
  background: var(--atlas-glass-elevated);
  box-shadow: var(--lg-shadow-elevated);
  padding: 20px;
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.ai-hero {
  overflow: hidden;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 22px 22px;
  background: var(--atlas-glass-elevated);
}

.orb-zone {
  position: relative;
  width: 126px;
  height: 126px;
  margin-bottom: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.aurora-sphere {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: conic-gradient(
    from 210deg,
    rgba(193, 95, 60, 0.16),
    rgba(168, 75, 42, 0.72),
    rgba(184, 134, 47, 0.54),
    rgba(193, 95, 60, 0.16)
  );
  filter: blur(15px);
  opacity: 0.58;
  animation: evaluate-breathe 4.8s ease-in-out infinite alternate;
}

.orb-inner {
  position: relative;
  z-index: 10;
  width: 82px;
  height: 82px;
  border-radius: 50%;
  border: 1px solid rgba(241, 228, 220, 0.84);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.9), rgba(245, 244, 238, 0.64));
  box-shadow:
    0 10px 22px rgba(193, 95, 60, 0.16),
    inset 0 1px 1px rgba(255, 255, 255, 1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.orb-percentage {
  font-size: 1.45rem;
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--evaluate-accent);
  letter-spacing: -0.05em;
}

.ai-hero .heading-serif {
  font-size: 1.42rem;
  margin-bottom: 7px;
  color: var(--evaluate-ink);
  letter-spacing: -0.025em;
}

.subtitle {
  max-width: 33ch;
  color: var(--evaluate-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.rail-section {
  display: flex;
  flex-direction: column;
}

.rail-section.flex-1 {
  flex: 1;
  min-height: 170px;
}

.rail-section.flex-col {
  flex-direction: column;
}

.rail-section.overflow-hidden {
  overflow: hidden;
}

.rail-head {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  align-items: baseline;
}

.rail-head h3 {
  font-weight: 700;
  font-size: 1rem;
  color: var(--evaluate-ink);
}

.status-meta {
  overflow: hidden;
  color: var(--evaluate-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uppercase {
  text-transform: uppercase;
}

.progress-rail {
  margin-top: 14px;
}

.progress-bar {
  height: 7px;
  border-radius: 999px;
  background: var(--atlas-accent-soft);
  overflow: hidden;
  box-shadow: var(--lg-shadow-subtle);
}

.progress-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--atlas-accent);
  box-shadow: var(--lg-shadow-subtle);
  transition: width 320ms var(--lg-easing-spring, ease);
}

.log-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 14px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.empty-log {
  align-items: center;
  justify-content: center;
  min-height: 100px;
  color: var(--evaluate-muted);
}

.log-item {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  gap: 10px;
  padding: 11px 0;
  border-bottom: 1px solid var(--lg-border-subtle);
}

.log-item:last-child {
  border-bottom: none;
}

.log-time {
  color: var(--evaluate-muted);
  font-size: 0.74rem;
  font-family: var(--font-mono);
}

.log-message {
  color: var(--evaluate-ink);
  font-size: 0.86rem;
  line-height: 1.45;
}

.btn-warn {
  background: var(--lg-bg-interactive);
  color: var(--evaluate-ink);
}

.evaluating-page .btn {
  min-height: 40px;
  border: 1px solid var(--lg-border-color);
  border-radius: 13px;
  background: var(--lg-bg-interactive);
  color: var(--evaluate-ink);
  font-weight: 700;
  box-shadow:
    0 6px 14px rgba(31, 31, 31, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 0.88);
  transition:
    transform var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease),
    box-shadow var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease),
    background var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease);
}

.evaluating-page .btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--lg-bg-elevated);
  box-shadow:
    0 11px 20px rgba(31, 31, 31, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
}

.evaluating-page .btn-warn {
  border-color: var(--atlas-accent-ring);
  background: var(--atlas-accent-soft);
  color: var(--evaluate-accent);
}

.evaluating-page .btn:active:not(:disabled) {
  transform: scale(0.98);
}

.evaluating-page .btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  box-shadow: none;
}

.evaluating-page .btn:focus-visible {
  outline: 3px solid var(--atlas-accent-ring);
  outline-offset: 3px;
}

.w-full {
  width: 100%;
}
.mt-auto {
  margin-top: auto;
}

@keyframes evaluate-breathe {
  0% { transform: scale(1); opacity: 0.3; }
  100% { transform: scale(1.15); opacity: 0.6; }
}

@keyframes evaluate-panel-enter-right {
  from { transform: translateX(12px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes evaluate-panel-enter-left {
  from { transform: translateX(-12px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes evaluate-page-enter {
  from { opacity: 0; transform: translateY(8px) scale(0.992); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes evaluate-pulse {
  50% { opacity: 0.28; transform: scale(0.96); }
}

@keyframes evaluate-log-enter {
  from { transform: translateY(4px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.fade-in-up {
  animation: evaluate-log-enter 240ms var(--lg-easing-spring, ease) both;
}

.custom-scroll::-webkit-scrollbar {
  width: 6px;
}

.custom-scroll::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 4px;
  background: var(--atlas-accent-soft);
  background-clip: padding-box;
}

@media (max-width: 1040px) {
  .evaluating-layout {
    grid-template-columns: 1fr;
  }

  .essay-panel {
    min-height: min(62vh, 620px);
  }

  .right-panel {
    min-height: auto;
  }

  .rail-section.flex-1 {
    min-height: 220px;
  }
}

@media (max-width: 640px) {
  .evaluating-page {
    border-radius: 22px;
  }

  .essay-panel {
    padding: 18px;
    border-radius: 21px;
  }

  .essay-head,
  .action-row {
    flex-direction: column;
    align-items: stretch;
  }

  .word-badge {
    width: fit-content;
  }

  .essay-body {
    padding: 16px;
    border-radius: 16px;
  }

  .glass-card {
    padding: 17px;
    border-radius: 18px;
  }

  .log-item {
    grid-template-columns: 1fr;
    gap: 3px;
  }

  .action-row .btn {
    width: 100%;
  }
}

@media (prefers-contrast: more) {
  .evaluating-page :is(.essay-panel, .glass-card, .essay-body, .action-row) {
    background: #fff;
    border-color: #4a4a4a;
  }
}

@media (prefers-reduced-motion: reduce) {
  .evaluating-page,
  .evaluating-page *,
  .evaluating-page *::before,
  .evaluating-page *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
  }
}
</style>
