<template>
  <div class="evaluating-page">
    <div class="evaluating-layout">
      <!-- Left: Essay Display with Typewriter -->
      <section class="essay-panel card card-whisper">
        <div class="essay-head border-base">
          <div>
            <h2 class="heading-serif display-heading">Essay Analysis</h2>
            <p class="topic-meta">{{ displayTopicText }}</p>
          </div>
          <span class="word-badge">{{ displayWordCount }} Words</span>
        </div>
        
        <div class="essay-body relative">
          <!-- Floating Loader watermark under the text -->
          <div class="floating-loader" :class="{'fade-out': progress > 98}">
            <svg class="xl-icon pulse" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 1.5V8h3.5L13 4.5zM8 11h8v1.5H8V11zm0 3h8v1.5H8V14zm0 3h5v1.5H8V17z"/>
            </svg>
            <p>Intelligence parsing layer...</p>
          </div>
          
          <!-- Text Typewriter layer -->
          <div class="typewriter-content" v-if="essayContentFull">
            {{ displayedEssayContent }}<span class="cursor-blink" v-if="progress < 100"></span>
          </div>
        </div>
      </section>

      <!-- Right: Analyzing Panel (glass style) -->
      <aside class="status-rail right-panel">
        <div class="ai-hero glass-card">
          <div class="orb-zone">
            <!-- Breathing aurora sphere -->
            <div class="aurora-sphere"></div>
            <div class="orb-inner">
              <span class="orb-percentage">{{ progress }}%</span>
            </div>
          </div>
          <h2 class="heading-serif">Intelligence at Work</h2>
          <p class="subtitle">Evaluating your essay against formal IELTS band descriptors.</p>
        </div>

        <section class="glass-card rail-section">
          <div class="rail-head">
            <h3>实时进度</h3>
            <span class="status-meta uppercase">{{ progress }}% / {{ currentStageLabel }}</span>
          </div>
          <div class="progress-rail mt-3">
            <div class="progress-bar">
              <div class="progress-bar-fill" :style="{ width: `${progress}%` }"></div>
            </div>
          </div>
        </section>

        <section class="glass-card rail-section flex-1 overflow-hidden flex-col">
          <div class="rail-head header-fixed">
            <h3>实时日志</h3>
            <span class="status-meta">Streaming</span>
          </div>
          <div v-if="recentLogs.length > 0" class="log-list custom-scroll">
            <div v-for="item in recentLogs" :key="item.id" class="log-item fade-in-up">
              <span class="log-time">{{ item.time }}</span>
              <span class="log-message">{{ item.message }}</span>
            </div>
          </div>
          <div v-else class="log-list empty-log">
             <p class="rail-empty">准备进入智能评测链路...</p>
          </div>
        </section>
        <div class="action-row mt-auto">
          <button class="btn btn-secondary w-full" :disabled="isRetrying || isComplete" @click="handleRetry">
            {{ isRetrying ? '重试中...' : '重试评分' }}
          </button>
          <button class="btn btn-warn w-full" :disabled="isRetrying" @click="handleCancel">
            取消评分
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { evaluate, getErrorMessage } from '@/api/client.js'
import {
  EVALUATION_CONTRACT_VERSION,
  normalizeList,
  normalizeMap,
  normalizeReviewBlocks,
  normalizeSentences
} from '@/utils/evaluation-result.js'

const props = defineProps({
  sessionId: {
    type: String,
    required: true
  }
})

const router = useRouter()

const progress = ref(0)
const statusMessage = ref('正在准备评测...')
const scoreData = ref(null)
const sentences = ref([])
const feedback = ref('')
const error = ref(null)
const providerPath = ref([])
const currentStage = ref('preparing')
const stageMessage = ref('正在准备评测...')
const isComplete = ref(false)
const hasNavigatedToResult = ref(false)
const analysisData = ref({})
const reviewData = ref({})
const timelineLogs = ref([])
const isRetrying = ref(false)
let eventListenerId = null
let lastPersistedCache = ''
let cachePersistRetryAt = 0
const seenEventSequences = new Set()
let lastLogSignature = ''

const fullResult = ref({
  contract_version: EVALUATION_CONTRACT_VERSION,
  sessionId: props.sessionId,
  score: null,
  scorecard: null,
  sentences: [],
  feedback: '',
  overall_feedback: '',
  analysis: {},
  review: {},
  task_analysis: {},
  band_rationale: {},
  improvement_plan: [],
  review_blocks: [],
  rewrite_suggestions: [],
  input_context: {},
  review_degraded: false,
  review_status: {},
  essayId: null,
  providerPath: [],
  stage: {
    key: 'preparing',
    label: '准备',
    message: '正在准备评测...'
  }
})

onMounted(() => {
  eventListenerId = evaluate.onEvent(handleEvent)
  void hydrateSessionState()
})

onUnmounted(() => {
  evaluate.removeEventListener(eventListenerId)
  eventListenerId = null
})

const analysisSummary = computed(() => {
  const summary = []
  if (Object.keys(normalizeMap(analysisData.value.task_analysis)).length > 0) {
    summary.push('任务诊断')
  }
  if (Object.keys(normalizeMap(analysisData.value.band_rationale)).length > 0) {
    summary.push('评分理由')
  }
  if (normalizeList(analysisData.value.improvement_plan).length > 0) {
    summary.push('提分计划')
  }
  return summary
})

const recentLogs = computed(() => timelineLogs.value.slice(-3))

const currentStageLabel = computed(() => stageLabel(currentStage.value, stageMessage.value))

const tempDraft = ref(null)

onMounted(() => {
  const cachedDraft = sessionStorage.getItem('temp_essay_' + props.sessionId)
  if (cachedDraft) {
    try {
      tempDraft.value = JSON.parse(cachedDraft)
    } catch(e) {}
  }
})

const essayContentFull = computed(() => {
  return tempDraft.value?.content || (fullResult.value.input_context?.content || '')
})

const displayedEssayContent = ref('')
const currentDisplayLength = ref(0)
let typewriterTimeout = null
// 三种打字速度（毫秒/字符）：慢 35，中 15，快 5
const typeSpeeds = [35, 15, 5]
let currentSpeed = 15

function startTypewriter(newProgress) {
  if (typewriterTimeout) clearTimeout(typewriterTimeout)
  
  const text = essayContentFull.value
  if (!text) return
  
  const targetRatio = Math.max(0, Math.min(100, newProgress)) / 100
  const targetLen = Math.floor(text.length * targetRatio)
  
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
        typewriterTimeout = setTimeout(tick, currentSpeed)
      }
    }
  }
  tick()
}

watch(progress, (newVal) => {
  currentSpeed = typeSpeeds[Math.floor(Math.random() * typeSpeeds.length)]
  startTypewriter(newVal)
})

const displayTopicText = computed(() => {
  return fullResult.value.input_context?.topic_text || tempDraft.value?.topic_text || 'Preparing assessment context...'
})

const displayWordCount = computed(() => {
  return fullResult.value.input_context?.word_count || tempDraft.value?.word_count || 0
})




function handleEvent(event) {
  if (!event || typeof event !== 'object') return
  if (event.sessionId !== props.sessionId) return
  if (typeof event.sequence === 'number') {
    if (seenEventSequences.has(event.sequence)) {
      return
    }
    seenEventSequences.add(event.sequence)
  }

  switch (event.type) {
    case 'progress':
      progress.value = event.data.percent
      statusMessage.value = event.data.message
      appendLog('progress', event.data.message, event)
      if (!isComplete.value) {
        const progressStage = inferStageFromProgress(event.data)
        applyStage(progressStage.key, progressStage.message)
      }
      break

    case 'stage':
      appendLog('stage', event.data?.message || `${event.data?.name || '评测'} ${event.data?.status || ''}`, event)
      applyStageFromPayload(event.data)
      if (
        String(event.data?.name || '').toLowerCase() === 'review'
        && String(event.data?.status || '').toLowerCase() === 'degraded'
      ) {
        fullResult.value.review_degraded = true
        fullResult.value.review_status = {
          stage: 'review',
          degraded: true,
          status: 'degraded',
          message: typeof event.data?.message === 'string' ? event.data.message : ''
        }
        persistCachedResult()
      }
      break

    case 'score':
      appendLog('score', '评分结果已生成', event)
      applyStage('scoring', '分数计算完成，正在准备详解...')
      scoreData.value = event.data
      fullResult.value.score = event.data
      fullResult.value.scorecard = event.data
      persistCachedResult()
      break

    case 'analysis':
      appendLog('analysis', '评分分析已生成', event)
      applyStage('scoring', '评分分析已生成，正在继续深度评审...')
      mergeAnalysis(event.data)
      persistCachedResult()
      break

    case 'review':
      appendLog('review', event.data?.review_degraded ? '详解降级，仅保留评分结果' : '段落详解已生成', event)
      applyStage('reviewing', '正在输出段落和句级详解...')
      mergeReview(event.data)
      persistCachedResult()
      break

    case 'sentence':
      appendLog('sentence', `句级诊断已更新（${sentences.value.length + 1}）`, event)
      mergeSentences(Array.isArray(event.data) ? event.data : [event.data])
      applyStage('reviewing', '正在输出段落和句级详解...')
      persistCachedResult()
      break

    case 'feedback':
      appendLog('feedback', '整体建议已生成', event)
      feedback.value = event.data
      fullResult.value.feedback = event.data
      fullResult.value.overall_feedback = event.data
      persistCachedResult()
      break

    case 'complete':
      appendLog('complete', '评测完成，正在跳转结果页', event)
      isComplete.value = true
      applyStage('completed', '评分完成！')
      progress.value = 100
      statusMessage.value = '评分完成！'
      fullResult.value.essayId = event.data?.essay_id || null
      fullResult.value.providerPath = event.data?.provider_path || []
      if (typeof event.data?.review_degraded === 'boolean') {
        fullResult.value.review_degraded = event.data.review_degraded
      }
      if (event.data?.review_status && typeof event.data.review_status === 'object') {
        fullResult.value.review_status = event.data.review_status
      }
      providerPath.value = fullResult.value.providerPath
      if (event.data?.analysis) {
        mergeAnalysis(event.data.analysis)
      }
      if (event.data?.review) {
        mergeReview(event.data.review)
      }
      if (Array.isArray(event.data?.sentences)) {
        mergeSentences(event.data.sentences)
      }
      if (typeof event.data?.overall_feedback === 'string' && event.data.overall_feedback.trim()) {
        feedback.value = event.data.overall_feedback
        fullResult.value.feedback = event.data.overall_feedback
        fullResult.value.overall_feedback = event.data.overall_feedback
      }
      persistCachedResult()
      void navigateToResult()
      break

    case 'error':
      appendLog('error', event.data?.message || getErrorMessage(event.data?.code), event)
      error.value = {
        code: event.data.code,
        message: event.data.message || getErrorMessage(event.data.code)
      }
      break

    case 'log':
      appendLog('log', event.data?.message || '评测日志更新', event)
      break
  }
}

async function hydrateSessionState() {
  try {
    const state = await evaluate.getSessionState(props.sessionId)
    const events = Array.isArray(state?.events) ? state.events : []
    for (const event of events) {
      handleEvent(event)
    }
  } catch (sessionError) {
    console.warn('读取评测会话状态失败:', sessionError)
  }
}

async function handleCancel() {
  if (isRetrying.value) return
  try {
    await evaluate.cancel(props.sessionId)
  } catch (err) {
    console.error('取消失败:', err)
  }
  router.push({ name: 'Compose' })
}

function buildRetryPayload() {
  const draft = normalizeMap(tempDraft.value)
  const inputContext = normalizeMap(fullResult.value.input_context)
  const rawTaskType = String(draft.task_type || inputContext.task_type || '').trim()
  const taskType = rawTaskType === 'task1' ? 'task1' : (rawTaskType === 'task2' ? 'task2' : '')
  const topicIdRaw = draft.topic_id ?? inputContext.topic_id
  const topicIdNumber = Number(topicIdRaw)
  const topicId = Number.isInteger(topicIdNumber) && topicIdNumber > 0 ? topicIdNumber : null
  const topicText = String(
    draft.topic_text
    || inputContext.topic_text
    || ''
  ).trim()
  const content = String(
    draft.content
    || inputContext.content
    || essayContentFull.value
    || ''
  ).trim()
  const wordCountRaw = Number(draft.word_count ?? inputContext.word_count)
  const wordCount = Number.isInteger(wordCountRaw) && wordCountRaw > 0
    ? wordCountRaw
    : (content ? content.split(/\s+/).filter((word) => word.length > 0).length : 0)

  if (!taskType || !content) {
    return null
  }

  if (topicId === null && !topicText) {
    return null
  }

  return {
    task_type: taskType,
    topic_id: topicId,
    topic_text: topicText,
    content,
    word_count: wordCount
  }
}

async function handleRetry() {
  if (isRetrying.value || isComplete.value) return

  error.value = null
  const retryPayload = buildRetryPayload()
  if (!retryPayload) {
    error.value = {
      code: 'start_failed',
      message: '缺少可重试的题目或作文内容，请返回写作页重新提交'
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

    const result = await evaluate.start({
      task_type: retryPayload.task_type,
      topic_id: retryPayload.topic_id,
      topic_text: retryPayload.topic_id ? null : retryPayload.topic_text,
      content: retryPayload.content,
      word_count: retryPayload.word_count
    })

    try {
      sessionStorage.setItem(`temp_essay_${result.sessionId}`, JSON.stringify(retryPayload))
    } catch (cacheError) {
      console.warn('重试会话草稿缓存写入失败', cacheError)
    }

    appendLog('system', '新会话已创建，正在重启评分流程。')
    await router.replace({
      name: 'Evaluating',
      params: { sessionId: result.sessionId }
    })
  } catch (retryError) {
    console.error('重试失败:', retryError)
    const code = String(retryError?.code || 'unknown_error')
    const message = retryError?.message || getErrorMessage(code)
    error.value = { code, message }
    appendLog('error', `重试失败：${message}`)
  } finally {
    isRetrying.value = false
  }
}

function handleBack() {
  router.push({ name: 'Compose' })
}

async function navigateToResult() {
  if (hasNavigatedToResult.value) return
  hasNavigatedToResult.value = true

  try {
    await router.replace({
      name: 'Result',
      params: { sessionId: props.sessionId },
      query: fullResult.value.essayId ? { essayId: String(fullResult.value.essayId) } : {}
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
  if (typeof fallbackMessage === 'string' && fallbackMessage.trim()) return fallbackMessage.trim()
  return '评测中'
}

function inferStageFromProgress(data) {
  const message = typeof data?.message === 'string' ? data.message : ''
  const percent = typeof data?.percent === 'number' ? data.percent : 0
  const lower = message.toLowerCase()

  if (percent >= 100 || lower.includes('完成')) {
    return { key: 'completed', message: message || '评分完成！' }
  }
  if (lower.includes('review') || lower.includes('详解') || lower.includes('句子')) {
    return { key: 'reviewing', message: message || '正在输出段落和句级详解...' }
  }
  if (lower.includes('score') || lower.includes('评分') || percent >= 20) {
    return { key: 'scoring', message: message || '正在进行评分...' }
  }
  return { key: 'preparing', message: message || '正在准备评测...' }
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
  fullResult.value.stage = {
    key: normalizedStage,
    label: stageLabel(normalizedStage, stageMessage.value),
    message: stageMessage.value
  }
}

function mergeAnalysis(payload) {
  const next = normalizeMap(payload)
  if (!Object.keys(next).length) return

  analysisData.value = {
    ...normalizeMap(analysisData.value),
    ...next
  }
  fullResult.value.analysis = {
    ...normalizeMap(fullResult.value.analysis),
    ...next
  }

  if (next.task_analysis) {
    fullResult.value.task_analysis = normalizeMap(next.task_analysis)
  }
  if (next.band_rationale) {
    fullResult.value.band_rationale = normalizeMap(next.band_rationale)
  }
  if (next.improvement_plan) {
    fullResult.value.improvement_plan = normalizeList(next.improvement_plan)
  }
  if (next.input_context) {
    fullResult.value.input_context = normalizeMap(next.input_context)
  }
}

function mergeReview(payload) {
  const next = normalizeMap(payload)
  if (!Object.keys(next).length) return
  const nextReviewBlocks = normalizeReviewBlocks(next.review_blocks || next.paragraph_reviews)

  reviewData.value = {
    ...normalizeMap(reviewData.value),
    ...next,
    ...(nextReviewBlocks.length ? {
      review_blocks: nextReviewBlocks,
      paragraph_reviews: nextReviewBlocks
    } : {})
  }
  fullResult.value.review = {
    ...normalizeMap(fullResult.value.review),
    ...next,
    ...(nextReviewBlocks.length ? {
      review_blocks: nextReviewBlocks,
      paragraph_reviews: nextReviewBlocks
    } : {})
  }

  if (Array.isArray(next.sentences)) {
    mergeSentences(next.sentences)
  }
  if (typeof next.overall_feedback === 'string' && next.overall_feedback.trim()) {
    feedback.value = next.overall_feedback
    fullResult.value.feedback = next.overall_feedback
    fullResult.value.overall_feedback = next.overall_feedback
  }
  if (next.improvement_plan) {
    const reviewPlan = normalizeList(next.improvement_plan)
    if (reviewPlan.length > 0) {
      fullResult.value.improvement_plan = reviewPlan
    }
  }
  if (nextReviewBlocks.length > 0) {
    fullResult.value.review_blocks = nextReviewBlocks
  }
  if (Array.isArray(next.rewrite_suggestions)) {
    fullResult.value.rewrite_suggestions = normalizeList(next.rewrite_suggestions)
  }
  if (typeof next.review_degraded === 'boolean') {
    fullResult.value.review_degraded = next.review_degraded
  }
  if (next.review_status && typeof next.review_status === 'object') {
    fullResult.value.review_status = next.review_status
  }
}

function mergeSentences(list) {
  const incoming = normalizeSentences(list)
  if (!incoming.length) return

  const map = new Map()
  const seed = normalizeSentences(fullResult.value.sentences)

  for (const item of seed) {
    const key = sentenceKey(item)
    if (key) map.set(key, item)
  }
  for (const item of incoming) {
    const key = sentenceKey(item)
    if (key) map.set(key, item)
  }

  const merged = Array.from(map.values())
  fullResult.value.sentences = merged
  sentences.value = merged
}

function sentenceKey(sentence) {
  if (!sentence || typeof sentence !== 'object') return ''
  if (typeof sentence.index === 'number') return `i:${sentence.index}`
  if (typeof sentence.original === 'string') return `o:${sentence.original}`
  return ''
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

function persistCachedResult() {
  if (typeof sessionStorage === 'undefined') {
    return
  }

  const now = Date.now()
  if (cachePersistRetryAt > now) {
    return
  }

  try {
    const serialized = JSON.stringify(fullResult.value)
    if (serialized === lastPersistedCache) {
      return
    }

    sessionStorage.setItem(`evaluation_${props.sessionId}`, serialized)
    lastPersistedCache = serialized
  } catch (error) {
    cachePersistRetryAt = now + 1000
    console.warn('评测缓存写入失败，继续使用内存态结果', error)
  }
}
</script>
<style scoped>
.evaluating-page {
  animation: fade-in 0.3s ease-out;
}

.evaluating-layout {
  display: flex;
  gap: 24px;
  max-width: 1600px;
  margin: 0 auto;
  height: calc(100vh - 120px);
}

.essay-panel {
  flex: 1.2;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  animation: slideFromRight 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.right-panel {
  flex: 0.8;
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: slideFromLeft 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.action-row {
  display: flex;
  gap: 10px;
}

.border-base {
  border-bottom: 1px solid var(--color-border-warm);
  padding-bottom: 20px;
  margin-bottom: 24px;
}

.essay-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

.display-heading {
  font-size: 2rem;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.topic-meta {
  color: var(--text-secondary);
  font-style: italic;
  font-size: 0.95rem;
}

.word-badge {
  background: var(--color-warm-sand);
  color: var(--text-primary);
  padding: 6px 14px;
  border-radius: 999px;
  font-weight: 500;
  font-size: 0.85rem;
}

.essay-body {
  flex: 1;
  overflow-y: auto;
  position: relative;
  padding-right: 12px;
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
  opacity: 0.15;
  pointer-events: none;
  transition: opacity 1s ease;
  z-index: 10;
}

.floating-loader p {
  font-size: 1.1rem;
  font-weight: 600;
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
  color: var(--text-primary);
  font-size: 1.05rem;
}

.cursor-blink {
  display: inline-block;
  width: 6px;
  height: 18px;
  background-color: var(--color-terracotta);
  margin-left: 4px;
  animation: blink 1s step-start infinite;
  vertical-align: middle;
}

@keyframes blink {
  50% { opacity: 0; }
}

.xl-icon {
  width: 5rem;
  height: 5rem;
  fill: currentColor;
  margin-bottom: 16px;
}

.pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.glass-card {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 16px;
  box-shadow: 0 8px 32px 0 rgba(77, 76, 72, 0.05);
  padding: 24px;
}

.ai-hero {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.orb-zone {
  position: relative;
  width: 140px;
  height: 140px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.aurora-sphere {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-parchment) 0%, var(--color-terracotta) 100%);
  filter: blur(20px);
  opacity: 0.4;
  animation: breathe 4s ease-in-out infinite alternate;
}

.orb-inner {
  position: relative;
  z-index: 10;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  border: 1px solid rgba(255,255,255,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
}

.orb-percentage {
  font-size: 1.5rem;
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--color-terracotta);
}

.ai-hero .heading-serif {
  font-size: 1.6rem;
  margin-bottom: 8px;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.rail-section {
  display: flex;
  flex-direction: column;
}

.rail-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.rail-head h3 {
  font-weight: 600;
  font-size: 1.1rem;
}

.status-meta {
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.uppercase {
  text-transform: uppercase;
}

.progress-rail {
  margin-top: 12px;
}

.progress-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--color-border-warm);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--color-terracotta);
  transition: width 0.3s ease;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
  overflow-y: auto;
}

.empty-log {
  align-items: center;
  justify-content: center;
  height: 100px;
  color: var(--text-secondary);
}

.log-item {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border-warm);
}

.log-item:last-child {
  border-bottom: none;
}

.log-time {
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-family: var(--font-mono);
}

.log-message {
  color: var(--text-primary);
  font-size: 0.9rem;
}

.btn-warn {
  background: var(--color-warm-sand);
  color: var(--text-primary);
  padding: 12px;
  border: 1px solid var(--color-border-cream);
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-warn:hover {
  background: #e1dfd4;
}

.w-full {
  width: 100%;
}
.mt-auto {
  margin-top: auto;
}

@keyframes breathe {
  0% { transform: scale(1); opacity: 0.3; }
  100% { transform: scale(1.15); opacity: 0.6; }
}

@keyframes slideFromRight {
  0% { transform: translateX(30px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@keyframes slideFromLeft {
  0% { transform: translateX(-30px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@keyframes pulse {
  50% { opacity: 0.2; }
}

@keyframes fadeInUp {
  from { transform: translateY(5px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.fade-in-up {
  animation: fadeInUp 0.4s ease forwards;
}

/* Custom Scroll */
.custom-scroll::-webkit-scrollbar {
  width: 4px;
}
.custom-scroll::-webkit-scrollbar-thumb {
  background: var(--color-ring-warm);
  border-radius: 4px;
}
</style>
