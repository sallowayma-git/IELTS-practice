<template>
  <div class="evaluating-page">
    <header class="evaluating-hero">
      <div class="evaluating-hero__copy">
        <p class="panel-label">Evaluation session</p>
        <h1>评分链路正在推进</h1>
        <p>{{ statusMessage }}</p>
      </div>

      <div class="evaluating-hero__badge surface-muted">
        <span class="badge-label">当前完成度</span>
        <strong>{{ progress }}%</strong>
      </div>
    </header>

    <div class="evaluating-layout">
      <section class="focus-panel surface">
        <div class="focus-head">
          <div>
            <p class="panel-label">Pipeline</p>
            <h2>{{ currentStageLabel }}</h2>
          </div>
          <div class="focus-meta">
            <span class="stage-summary">{{ stageMessage }}</span>
          </div>
        </div>

        <div class="progress-rail">
          <div class="progress-bar">
            <div class="progress-bar-fill" :style="{ width: `${progress}%` }"></div>
          </div>
          <span class="progress-text">{{ progress }}%</span>
        </div>

        <div class="stage-track">
          <span :class="['stage-chip', getStageClass('preparing')]">准备</span>
          <span :class="['stage-chip', getStageClass('scoring')]">评分</span>
          <span :class="['stage-chip', getStageClass('reviewing')]">详解</span>
          <span :class="['stage-chip', getStageClass('completed')]">完成</span>
        </div>

        <p v-if="scoreData && !isComplete" class="stage-hint">
          分数已出来，系统正在继续生成段落详解和句级问题定位。
        </p>

        <div v-if="scoreData" class="score-preview">
          <div class="score-summary">
            <span class="score-summary__label">总分</span>
            <strong class="score-summary__value">{{ scoreData.total_score ?? '-' }}</strong>
          </div>
          <div class="score-grid">
            <div class="score-card">
              <span>任务完成</span>
              <strong>{{ scoreData.task_achievement ?? '-' }}</strong>
            </div>
            <div class="score-card">
              <span>连贯衔接</span>
              <strong>{{ scoreData.coherence_cohesion ?? '-' }}</strong>
            </div>
            <div class="score-card">
              <span>词汇资源</span>
              <strong>{{ scoreData.lexical_resource ?? '-' }}</strong>
            </div>
            <div class="score-card">
              <span>语法范围</span>
              <strong>{{ scoreData.grammatical_range ?? '-' }}</strong>
            </div>
          </div>
        </div>
      </section>

      <aside class="status-rail">
        <section class="rail-card surface">
          <div class="rail-head">
            <h3>实时日志</h3>
            <span>最近 3 条</span>
          </div>

          <div v-if="recentLogs.length > 0" class="log-list">
            <div v-for="item in recentLogs" :key="item.id" class="log-item">
              <span class="log-time">{{ item.time }}</span>
              <span class="log-message">{{ item.message }}</span>
            </div>
          </div>
          <p v-else class="rail-empty">链路已启动，等待后台返回第一条进度消息。</p>
        </section>

        <section class="rail-card surface">
          <div class="rail-head">
            <h3>链路状态</h3>
            <span>结构化输出</span>
          </div>
          <div class="rail-stack">
            <p v-if="sentences.length > 0" class="status-pill">
              已分析 {{ sentences.length }} 个句子
            </p>
            <p v-if="analysisSummary.length > 0" class="status-pill">
              {{ analysisSummary.join(' · ') }}
            </p>
            <p v-if="providerPath.length > 0" class="provider-path">
              {{ providerPath.map(item => `${item.provider}/${item.model}(${item.status})`).join(' -> ') }}
            </p>
          </div>
        </section>

        <section v-if="error" class="rail-card rail-card-error surface">
          <div class="rail-head">
            <h3>链路异常</h3>
            <span>{{ error.code || 'error' }}</span>
          </div>
          <p class="error-copy">{{ error.message }}</p>
          <div class="error-actions">
            <button class="btn btn-primary" @click="handleRetry">
              重试
            </button>
            <button class="btn btn-secondary" @click="handleBack">
              返回编辑
            </button>
          </div>
        </section>

        <section class="rail-card surface-muted">
          <div class="rail-head">
            <h3>会话控制</h3>
            <span>Session</span>
          </div>
          <button class="btn btn-danger" @click="handleCancel">
            取消评分
          </button>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
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
  try {
    await evaluate.cancel(props.sessionId)
  } catch (err) {
    console.error('取消失败:', err)
  }
  router.push({ name: 'Compose' })
}

function handleRetry() {
  error.value = null
  router.push({ name: 'Compose' })
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
  display: grid;
  gap: 22px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.evaluating-hero {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
}

.evaluating-hero__copy {
  display: grid;
  gap: 10px;
}

.evaluating-hero__copy h1 {
  font-size: clamp(2.2rem, 4vw, 3.8rem);
  max-width: 10ch;
}

.evaluating-hero__copy p:last-child {
  color: var(--text-secondary);
  max-width: 60ch;
}

.evaluating-hero__badge {
  min-width: 190px;
  display: grid;
  gap: 10px;
  padding: 18px 20px;
}

.badge-label {
  color: var(--text-muted);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.evaluating-hero__badge strong {
  font-size: 2.4rem;
  line-height: 1;
}

.evaluating-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.75fr);
  gap: 20px;
  align-items: start;
}

.focus-panel,
.rail-card {
  padding: 22px;
}

.focus-panel {
  display: grid;
  gap: 18px;
}

.focus-head,
.rail-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
}

.focus-head h2,
.rail-head h3 {
  font-size: 1.6rem;
}

.focus-meta,
.rail-head span,
.stage-summary {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.progress-rail {
  display: grid;
  gap: 8px;
}

.progress-bar {
  height: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(143, 95, 63, 0.08);
}

.progress-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #7b5234 0%, #c59a73 100%);
  transition: width var(--duration-normal) var(--ease-standard);
}

.progress-text {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.stage-track {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stage-chip {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(143, 95, 63, 0.08);
  color: var(--text-muted);
  font-size: 0.86rem;
}

.stage-chip.active {
  color: #fff8f0;
  background: var(--primary-color);
}

.stage-chip.done {
  color: var(--success-color);
  background: rgba(83, 120, 93, 0.14);
}

.stage-hint {
  color: var(--text-secondary);
}

.score-preview {
  display: grid;
  gap: 16px;
  padding-top: 6px;
}

.score-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  border-radius: var(--radius-lg);
  background: rgba(255, 248, 239, 0.8);
}

.score-summary__label {
  color: var(--text-muted);
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.score-summary__value {
  font-size: 3rem;
  line-height: 1;
  color: var(--primary-color);
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.score-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: rgba(255, 252, 247, 0.82);
}

.score-card span {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.score-card strong {
  font-size: 1.4rem;
}

.status-rail {
  display: grid;
  gap: 16px;
}

.log-list,
.rail-stack {
  display: grid;
  gap: 10px;
}

.log-item {
  display: grid;
  grid-template-columns: 78px 1fr;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}

.log-item:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.log-time {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.log-message,
.rail-empty,
.provider-path {
  color: var(--text-secondary);
}

.provider-path {
  word-break: break-word;
}

.status-pill {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: rgba(143, 95, 63, 0.08);
  color: var(--text-primary);
}

.rail-card-error {
  border-color: rgba(162, 72, 54, 0.18);
  background: rgba(255, 246, 243, 0.9);
}

.error-copy {
  color: var(--danger-color);
}

.error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 1080px) {
  .evaluating-hero,
  .evaluating-layout {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}

@media (max-width: 720px) {
  .focus-panel,
  .rail-card {
    padding: 18px;
  }

  .score-grid {
    grid-template-columns: 1fr;
  }
}
</style>
