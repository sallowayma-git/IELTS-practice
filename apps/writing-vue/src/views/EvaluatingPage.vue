<template>
  <div class="evaluating-page">
    <div class="evaluating-container card">
      <div class="evaluating-header">
        <div class="logo-animated">🤖</div>
        <h2>AI 正在评分...</h2>
        <p class="status-message">{{ statusMessage }}</p>
      </div>

      <!-- 进度条 -->
      <div class="progress-section">
        <div class="progress-bar">
          <div 
            class="progress-bar-fill"
            :style="{ width: `${progress}%` }"
          ></div>
        </div>
        <div class="progress-text">{{ progress }}%</div>
      </div>

      <div class="stage-section">
        <div class="stage-title">当前阶段：{{ currentStageLabel }}</div>
        <div class="stage-track">
          <span :class="['stage-chip', getStageClass('preparing')]">准备</span>
          <span :class="['stage-chip', getStageClass('scoring')]">评分</span>
          <span :class="['stage-chip', getStageClass('reviewing')]">详解</span>
          <span :class="['stage-chip', getStageClass('completed')]">完成</span>
        </div>
        <p v-if="scoreData && !isComplete" class="stage-hint">
          分数已生成，正在输出段落与句级详解...
        </p>
      </div>

      <div class="live-log-section card-subsection">
        <div class="live-log-header">
          <h3>实时进度</h3>
          <span class="live-log-hint">仅显示最近 3 条</span>
        </div>
        <div class="live-log-list">
          <div v-for="item in recentLogs" :key="item.id" class="live-log-item">
            <span class="live-log-time">{{ item.time }}</span>
            <span class="live-log-message">{{ item.message }}</span>
          </div>
        </div>
      </div>

      <!-- 流式预览 -->
      <div v-if="scoreData" class="preview-section">
        <h3>评分预览</h3>
        <div class="score-preview">
          <div class="score-item">
            <span class="score-label">总分</span>
            <span class="score-value">{{ scoreData.total_score ?? '-' }}</span>
          </div>
          <div class="score-grid">
            <div class="score-item small">
              <span class="score-label">任务完成</span>
              <span class="score-value">{{ scoreData.task_achievement ?? '-' }}</span>
            </div>
            <div class="score-item small">
              <span class="score-label">连贯衔接</span>
              <span class="score-value">{{ scoreData.coherence_cohesion ?? '-' }}</span>
            </div>
            <div class="score-item small">
              <span class="score-label">词汇资源</span>
              <span class="score-value">{{ scoreData.lexical_resource ?? '-' }}</span>
            </div>
            <div class="score-item small">
              <span class="score-label">语法范围</span>
              <span class="score-value">{{ scoreData.grammatical_range ?? '-' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 句子预览 -->
      <div v-if="sentences.length > 0" class="sentences-preview">
        <h4>已分析 {{ sentences.length }} 个句子</h4>
      </div>

      <div v-if="analysisSummary.length > 0" class="sentences-preview">
        <h4>评分分析已生成</h4>
        <p class="provider-path">{{ analysisSummary.join(' · ') }}</p>
      </div>

      <div v-if="providerPath.length > 0" class="sentences-preview">
        <h4>供应商路径</h4>
        <p class="provider-path">
          {{ providerPath.map(item => `${item.provider}/${item.model}(${item.status})`).join(' -> ') }}
        </p>
      </div>

      <!-- 操作按钮 -->
      <div class="actions">
        <button class="btn btn-danger" @click="handleCancel">
          取消评分
        </button>
      </div>

      <!-- 错误显示 -->
      <div v-if="error" class="error-message">
        <p>⚠️ {{ error.message }}</p>
        <div class="error-actions">
          <button class="btn btn-primary" @click="handleRetry">
            重试
          </button>
          <button class="btn btn-secondary" @click="handleBack">
            返回编辑
          </button>
        </div>
      </div>
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

// 存储完整结果用于传递到结果页
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
  // 订阅评测事件
  eventListenerId = evaluate.onEvent(handleEvent)
  void hydrateSessionState()
})

onUnmounted(() => {
  // 移除事件监听
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
  // 只处理当前会话的事件
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
      // 保留兜底缓存，优先使用 DB 记录
      persistCachedResult()
      void navigateToResult()
      break

    case 'error':
      appendLog('error', event.data?.message || getErrorMessage(event.data?.code), event)
      // 【错误展示优先级】优先使用 message，回退到 code 映射
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
  // 返回 Compose 页重新提交
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
  max-width: 700px;
  margin: 0 auto;
  padding-top: 40px;
}

.evaluating-container {
  text-align: center;
  padding: 40px;
}

.evaluating-header {
  margin-bottom: 32px;
}

.logo-animated {
  font-size: 64px;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.evaluating-header h2 {
  font-size: 28px;
  color: var(--text-primary);
  margin: 16px 0 8px;
}

.status-message {
  color: var(--text-secondary);
  font-size: 16px;
}

.progress-section {
  margin-bottom: 32px;
}

.progress-bar {
  height: 12px;
  background: var(--bg-light);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
  transition: width 0.5s ease;
}

.progress-text {
  font-size: 14px;
  color: var(--text-muted);
}

.stage-section {
  margin-bottom: 24px;
  text-align: left;
}

.stage-title {
  margin-bottom: 10px;
  font-size: 14px;
  color: var(--text-secondary);
}

.stage-track {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.stage-chip {
  font-size: 12px;
  line-height: 1;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--bg-light);
  color: var(--text-muted);
}

.stage-chip.active {
  background: rgba(102, 126, 234, 0.14);
  color: var(--primary-color);
}

.stage-chip.done {
  background: rgba(103, 194, 58, 0.14);
  color: var(--success-color);
}

.stage-hint {
  margin-top: 10px;
  margin-bottom: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.live-log-section {
  text-align: left;
  margin-bottom: 24px;
  padding: 14px 16px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.live-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.live-log-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text-primary);
}

.live-log-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.live-log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.live-log-item {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 10px;
  font-size: 13px;
  line-height: 1.4;
}

.live-log-time {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.live-log-message {
  color: var(--text-primary);
  word-break: break-word;
}

.preview-section {
  text-align: left;
  margin-bottom: 24px;
}

.preview-section h3 {
  font-size: 18px;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.score-preview {
  background: var(--bg-light);
  border-radius: var(--border-radius);
  padding: 20px;
}

.score-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}

.score-item .score-label {
  color: var(--text-secondary);
}

.score-item .score-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--primary-color);
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.score-item.small .score-value {
  font-size: 18px;
}

.sentences-preview {
  background: var(--bg-light);
  padding: 12px 16px;
  border-radius: var(--border-radius);
  margin-bottom: 24px;
}

.sentences-preview h4 {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.provider-path {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
  word-break: break-all;
}

.actions {
  margin-top: 24px;
}

.error-message {
  background: rgba(245, 108, 108, 0.1);
  padding: 20px;
  border-radius: var(--border-radius);
  margin-top: 24px;
  text-align: left;
}

.error-message p {
  color: var(--danger-color);
  margin-bottom: 16px;
}

.error-actions {
  display: flex;
  gap: 12px;
}
</style>
