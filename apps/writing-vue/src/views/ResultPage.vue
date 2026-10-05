<template>
  <div class="result-page">
    <router-link v-if="historyBack" :to="historyBack" class="result-back" data-history-back>← 返回历史</router-link>
    <section v-if="loadError" class="result-load-error" role="alert">
      <h1 class="heading-serif">无法加载评测结果</h1>
      <p>{{ loadError }}</p>
      <div class="result-load-error__actions">
        <button class="btn btn-brand" type="button" @click="loadResult">重试加载</button>
        <button class="btn-text" type="button" @click="writeNew">返回写作页</button>
      </div>
    </section>
    <div v-else class="result-layout">
      <section class="essay-panel">
        <header class="essay-head">
          <h1 class="heading-serif display-heading">评测结果</h1>
          <p class="topic-meta">IELTS 写作 · {{ essayWordCount }} 词</p>
        </header>

        <div v-if="topicText" class="topic-block">
          <h2 class="topic-block__label">{{ topicSourceLabel }}</h2>
          <p class="topic-block__text">{{ topicText }}</p>
        </div>

        <div class="view-controls">
          <button :class="['btn', viewMode === 'full' ? 'btn-brand' : 'btn-warm-sand']" @click="viewMode = 'full'">原文</button>
          <button v-if="sentences.length > 0" :class="['btn', viewMode === 'annotated' ? 'btn-brand' : 'btn-warm-sand']" @click="viewMode = 'annotated'">逐句批注</button>
        </div>

        <div class="essay-body" v-if="viewMode === 'full'">{{ essayText || '没有找到作文正文。' }}</div>

        <div class="essay-body" v-else>
          <div v-if="sentences.length > 0">
            <template v-for="(sentence, index) in sentences" :key="index">
              <component
                :is="sentence.errors?.length > 0 ? 'button' : 'span'"
                class="sentence-container"
                :class="{ 'has-error': sentence.errors?.length > 0 }"
                :type="sentence.errors?.length > 0 ? 'button' : undefined"
                :aria-expanded="sentence.errors?.length > 0 ? String(expandedSentences.has(index)) : undefined"
                :aria-controls="sentence.errors?.length > 0 ? `sentence-errors-${index}` : undefined"
                @click="sentence.errors?.length > 0 ? toggleExpand(index) : null"
              >
                <span v-html="highlightErrors(sentence)"></span>
              </component>

              <div :id="`sentence-errors-${index}`" v-if="sentence.errors?.length > 0 && expandedSentences.has(index)" class="error-details">
                <div v-for="(err, errIdx) in sentence.errors" :key="errIdx" class="error-item">
                  <div class="error-type" :class="'text-' + err.type.replace('_', '-')">
                    <strong>{{ getErrorTypeLabel(err.type) }}</strong>
                  </div>
                  <div class="error-word">
                    <span class="label">原文</span><span class="line-through">{{ err.word }}</span>
                  </div>
                  <div class="error-reason">{{ err.reason }}</div>
                  <div class="error-correction">
                    <span class="label">建议</span><strong>{{ err.correction }}</strong>
                  </div>
                </div>
                <div class="corrected-sentence">
                  <span class="label">改写</span>
                  {{ sentence.corrected }}
                </div>
              </div>
            </template>
          </div>
          <div v-else class="essay-empty">{{ sentenceEmptyHint }}</div>
        </div>
      </section>

      <aside class="right-panel">
        <div class="glass-card score-summary">
          <h3>总评</h3>
          <div class="score-ring-container">
            <span class="score-total">{{ scoreData?.total_score ?? '-' }}</span>
            <span class="score-label">总分 Band</span>
            <span class="score-scale" aria-hidden="true">
              <span class="score-scale__mark" :style="{ left: `${Math.min(100, Math.max(0, (Number(scoreData?.total_score) || 0) / 9 * 100))}%` }"></span>
            </span>
            <span class="score-scale__ends" aria-hidden="true"><span>0</span><span>9</span></span>
          </div>
        </div>

        <div v-if="reviewDegraded" class="degraded-warning">
          <h4>详解已降级</h4>
          <p>{{ sentenceEmptyHint }}</p>
        </div>

        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-label">任务回应 Task Response</div>
            <div class="metric-value">{{ scoreData?.task_achievement ?? '-' }}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">连贯衔接 Coherence</div>
            <div class="metric-value">{{ scoreData?.coherence_cohesion ?? '-' }}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">词汇资源 Lexical</div>
            <div class="metric-value">{{ scoreData?.lexical_resource ?? '-' }}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">语法 Grammar</div>
            <div class="metric-value">{{ scoreData?.grammatical_range ?? '-' }}</div>
          </div>
        </div>

        <div v-if="feedback" class="glass-card">
          <h3>整体改进建议</h3>
          <p class="prose-text">{{ feedback }}</p>
        </div>

        <div v-if="improvementPlan && improvementPlan.length > 0" class="glass-card">
          <h3>核心提分计划</h3>
          <ol class="plan-list">
            <li v-for="(item, idx) in improvementPlan" :key="idx">{{ item }}</li>
          </ol>
        </div>

        <div v-if="reviewBlocks && reviewBlocks.length > 0" class="glass-card">
          <h3>段落详评</h3>
          <dl class="rationale-list">
            <div v-for="(item, idx) in reviewBlocks" :key="idx" class="rationale-item">
              <dt>第 {{ item.paragraph_index || (idx + 1) }} 段</dt>
              <dd>{{ typeof item === 'object' ? (item.comment || item.analysis || item.feedback || '') : item }}</dd>
            </div>
          </dl>
        </div>

        <div v-if="bandRationaleEntries && bandRationaleEntries.length > 0" class="glass-card">
          <h3>得分解析</h3>
          <dl class="rationale-list">
            <div v-for="item in bandRationaleEntries" :key="item.label" class="rationale-item">
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
        </div>

        <div v-if="taskAnalysisEntries && taskAnalysisEntries.length > 0" class="glass-card">
          <h3>任务诊断</h3>
          <dl class="rationale-list">
            <div v-for="item in taskAnalysisEntries" :key="item.label" class="rationale-item">
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
        </div>

        <div class="result-next">
          <button @click="writeNew" class="btn btn-brand">再写一篇</button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { essays as essaysApi } from '@/api/client.js'
import { historyReturnPath } from '@/modules/history/return.js'
import {
  BAND_RATIONALE_LABELS,
  TASK_ANALYSIS_LABELS,
  buildEvaluationView,
  formatLabeledEntries
} from '@/utils/evaluation-result.js'

const props = defineProps({
  sessionId: {
    type: String,
    required: true
  }
})

const router = useRouter()
const route = useRoute()
const historyBack = computed(() => historyReturnPath(route))

const viewMode = ref('full')
const expandedSentences = ref(new Set([0, 1, 2]))

const scoreData = ref(null)
const sentences = ref([])
const feedback = ref('')
const essayText = ref('')
const essayWordCount = ref(0)
const topicText = ref('')
const topicSource = ref('')
const taskAnalysis = ref({})
const bandRationale = ref({})
const improvementPlan = ref([])
const reviewBlocks = ref([])
const reviewDegraded = ref(false)
const loadError = ref('')

const ERROR_TYPE_LABELS = {
  grammar: '语法错误',
  spelling: '拼写错误',
  word_choice: '用词不当',
  sentence_structure: '句式问题',
  coherence: '逻辑连贯'
}

const taskAnalysisEntries = computed(() => (
  formatLabeledEntries(taskAnalysis.value, TASK_ANALYSIS_LABELS)
))

const bandRationaleEntries = computed(() => (
  formatLabeledEntries(bandRationale.value, BAND_RATIONALE_LABELS)
))

const topicSourceLabel = computed(() => {
  if (topicSource.value === 'topic_bank') return '题库题目'
  if (topicSource.value === 'custom_input') return '自定义题目'
  return '评测题目'
})

const sentenceEmptyHint = computed(() => (
  reviewDegraded.value
    ? '本次详解阶段已降级，本页仅展示评分与提分建议；句级纠错没有成功生成。'
    : '本次评测未返回句级纠错，说明模型没有识别出足够高价值的逐句修改点。'
))

onMounted(() => {
  loadResult()
})

async function loadResult() {
  loadError.value = ''
  try {
      const detail = await essaysApi.getById(props.sessionId)
      if (!detail) throw new Error('writing attempt not found')
      // essays.getById already runs adaptWritingHistoryDetail (V4 → UI)
      const evaluation = detail.evaluation || detail.evaluation_json || null
      const evaluationView = buildEvaluationView(evaluation?.result || evaluation?.result_json || evaluation, {
        score: {
          total_score: detail.total_score,
          task_achievement: detail.task_achievement,
          coherence_cohesion: detail.coherence_cohesion,
          lexical_resource: detail.lexical_resource,
          grammatical_range: detail.grammatical_range
        },
        overall_feedback: detail.overall_feedback || detail.feedback,
        task_analysis: detail.task_analysis,
        band_rationale: detail.band_rationale,
        improvement_plan: detail.improvement_plan,
        topic_text: detail.topic_text || detail.display_topic_title || '',
        topic_source: detail.topic_source || ''
      })

      essayText.value = detail.content || detail.contentText || detail.content_text || ''
      essayWordCount.value = detail.word_count || detail.wordCount || 0
      applyEvaluationView(evaluationView)
      return
  } catch (error) {
    console.warn('从 SQLite 加载结果失败', error)
    loadError.value = error?.message
      ? `结果读取失败：${error.message}`
      : '结果读取失败，请检查本地数据后重试。'
  }
}

function applyEvaluationView(view) {
  scoreData.value = view.score
  sentences.value = Array.isArray(view.sentences) ? view.sentences : []
  feedback.value = view.overallFeedback
  taskAnalysis.value = view.taskAnalysis
  bandRationale.value = view.bandRationale
  improvementPlan.value = view.improvementPlan
  reviewBlocks.value = view.reviewBlocks
  reviewDegraded.value = view.reviewDegraded === true

  if (!topicText.value && view.topicText) {
    topicText.value = view.topicText
  }
  if (!topicSource.value && view.topicSource) {
    topicSource.value = view.topicSource
  }
}

function getErrorTypeLabel(type) {
  return ERROR_TYPE_LABELS[type] || type
}

function highlightErrors(sentence) {
  if (!sentence.errors || sentence.errors.length === 0) {
    return escapeHtml(sentence.original)
  }

  const text = sentence.original
  let result = ''
  let lastIndex = 0

  const sortedErrors = [...sentence.errors].sort((a, b) => a.range.start - b.range.start)

  for (const err of sortedErrors) {
    const startPos = Math.max(0, Math.min(err.range.start, text.length))
    const endPos = Math.max(startPos, Math.min(err.range.end, text.length))

    if (startPos > lastIndex) {
      result += escapeHtml(text.substring(lastIndex, startPos))
    }

    const errorWord = text.substring(startPos, endPos)
    const colorClass = `highlight-${err.type}`
    result += `<span class="${colorClass}" title="${escapeHtml(err.reason)}">${escapeHtml(errorWord)}</span>`

    lastIndex = endPos
  }

  if (lastIndex < text.length) {
    result += escapeHtml(text.substring(lastIndex))
  }

  return result
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function toggleExpand(index) {
  if (expandedSentences.value.has(index)) {
    expandedSentences.value.delete(index)
  } else {
    expandedSentences.value.add(index)
  }
  expandedSentences.value = new Set(expandedSentences.value)
}

function expandAll() {
  expandedSentences.value = new Set(sentences.value.map((_, i) => i))
}

function collapseAll() {
  expandedSentences.value = new Set()
}

function writeNew() {
  router.push({ name: 'Compose' })
}
</script>
<style scoped>
/* Result: the essay reads as a page; the margin carries the marks. */
.result-back {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-bottom: 8px;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
  text-decoration: underline;
  text-decoration-color: var(--anth-border-strong);
  text-underline-offset: 3px;
}

.result-back:hover {
  color: var(--anth-ink);
  text-decoration-color: currentColor;
}

.result-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.85fr);
  align-items: start;
  gap: 56px;
}

.essay-panel,
.right-panel {
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

.topic-meta {
  margin: 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.topic-block {
  margin-top: 20px;
}

.topic-block__label {
  margin: 0 0 4px;
  color: var(--anth-ink-faint);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  font-weight: var(--anth-weight-normal);
}

.topic-block__text {
  margin: 0;
  max-width: var(--anth-measure);
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-serif);
  font-style: italic;
  line-height: var(--anth-leading-relaxed);
}

/* Original / annotated: text tabs. */
.view-controls {
  display: flex;
  gap: 24px;
  margin: 24px 0 18px;
  border-bottom: 1px solid var(--anth-rule);
}

.view-controls > .btn {
  min-height: 40px;
  margin-bottom: -1px;
  padding: 0 1px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--anth-ink-faint);
  font-weight: var(--anth-weight-normal);
}

.view-controls > .btn:hover:not(:disabled) {
  background: transparent;
  color: var(--anth-ink);
}

.view-controls > .btn-brand,
.view-controls > .btn-brand:hover:not(:disabled) {
  border-bottom-color: var(--anth-ink);
  background: transparent;
  color: var(--anth-ink-strong);
  font-weight: var(--anth-weight-medium);
}

.essay-body {
  max-width: var(--anth-measure);
  max-height: min(70vh, 900px);
  overflow-y: auto;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: 1.0625rem;
  line-height: 1.85;
  white-space: pre-wrap;
}

.essay-empty {
  color: var(--anth-ink-faint);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  white-space: normal;
}

.sentence-container {
  display: inline;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: inherit;
  text-align: left;
}

.sentence-container.has-error {
  min-height: 0;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--anth-border-strong);
  text-decoration-style: dotted;
  text-underline-offset: 4px;
}

.sentence-container.has-error[aria-expanded="true"] {
  text-decoration-color: var(--anth-ink);
}

/* An annotation is a marginal note set into the text. */
.error-details {
  display: grid;
  gap: 10px;
  margin: 10px 0 14px;
  padding: 2px 0 2px 16px;
  border-left: 2px solid var(--anth-ink);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  line-height: var(--anth-leading-normal);
  white-space: normal;
}

.error-item {
  display: grid;
  gap: 2px;
}

.error-type strong {
  font-weight: var(--anth-weight-semibold);
}

.text-grammar { color: var(--anth-danger); }
.text-spelling { color: var(--anth-warning); }
.text-word-choice { color: var(--anth-info); }
.text-sentence-structure { color: var(--anth-ink-soft); }
.text-coherence { color: var(--anth-success); }

.label {
  display: inline-block;
  min-width: 2.5em;
  margin-right: 8px;
  color: var(--anth-ink-faint);
}

.line-through {
  color: var(--anth-ink-soft);
  text-decoration: line-through;
}

.error-reason {
  color: var(--anth-ink-soft);
}

.corrected-sentence {
  padding-top: 8px;
  border-top: 1px solid var(--anth-rule);
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
}

/* Margin column */
.right-panel {
  display: grid;
  gap: 32px;
}

.right-panel > .glass-card {
  padding: 14px 0 0;
  border-top: 1px solid var(--anth-ink);
}

.right-panel h3 {
  margin: 0 0 12px;
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
}

.score-summary {
  padding-top: 14px;
}

.score-ring-container {
  display: grid;
  gap: 2px;
  width: 170px;
}

.score-total {
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: 3.25rem;
  font-weight: var(--anth-weight-semibold);
  line-height: 1;
  font-variant-numeric: lining-nums tabular-nums;
}

.score-label {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.score-scale {
  position: relative;
  height: 1px;
  margin-top: 14px;
  background: var(--anth-ink);
}

.score-scale__mark {
  position: absolute;
  top: -5px;
  width: 1px;
  height: 11px;
  background: var(--anth-accent);
  transform: translateX(-0.5px);
}

.score-scale__ends {
  display: flex;
  justify-content: space-between;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
  font-variant-numeric: lining-nums tabular-nums;
}

.degraded-warning {
  padding-left: 14px;
  border-left: 2px solid var(--anth-warning);
}

.degraded-warning h4 {
  margin: 0 0 4px;
  color: var(--anth-warning);
  font-size: var(--anth-text-sm);
}

.degraded-warning p {
  margin: 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

/* Criteria: a 2×2 ruled table of sub-scores. */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1.5px solid var(--anth-rule-heavy);
  border-bottom: 1.5px solid var(--anth-rule-heavy);
}

.metric-card {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px 10px 0;
  border-bottom: 1px solid var(--anth-rule);
}

.metric-card:nth-child(even) {
  padding: 10px 0 10px 14px;
  border-left: 1px solid var(--anth-rule);
}

.metric-card:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.metric-label {
  min-width: 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-xs);
}

.metric-value {
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-xl);
  font-variant-numeric: lining-nums tabular-nums;
}

.prose-text {
  margin: 0;
  color: var(--anth-ink);
  font-size: var(--anth-text-sm);
  line-height: var(--anth-leading-relaxed);
}

.plan-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 1.4em;
  color: var(--anth-ink);
  font-size: var(--anth-text-sm);
  line-height: var(--anth-leading-normal);
}

.plan-list li::marker {
  color: var(--anth-ink-faint);
  font-variant-numeric: lining-nums tabular-nums;
}

.rationale-list {
  display: grid;
  margin: 0;
}

.rationale-item {
  display: grid;
  gap: 2px;
  padding: 8px 0;
  border-top: 1px solid var(--anth-rule);
  font-size: var(--anth-text-sm);
}

.rationale-item:first-child {
  border-top: 0;
  padding-top: 0;
}

.rationale-item dt {
  color: var(--anth-ink-strong);
  font-weight: var(--anth-weight-semibold);
}

.rationale-item dd {
  margin: 0;
  color: var(--anth-ink-soft);
  line-height: var(--anth-leading-normal);
}

.result-next {
  padding-top: 8px;
}

.result-load-error {
  display: grid;
  gap: 12px;
  max-width: var(--anth-content-width-narrow);
}

.result-load-error h1 {
  margin: 0;
}

.result-load-error p {
  margin: 0;
  color: var(--anth-danger);
}

.result-load-error__actions {
  display: flex;
  align-items: center;
  gap: 20px;
}

@media (max-width: 1040px) {
  .result-layout {
    grid-template-columns: 1fr;
    gap: 48px;
  }

  .essay-body {
    max-height: none;
    overflow: visible;
  }
}

@media (max-width: 640px) {
  .metrics-grid {
    grid-template-columns: 1fr;
  }

  .metric-card,
  .metric-card:nth-child(even) {
    padding: 10px 0;
    border-left: 0;
    border-bottom: 1px solid var(--anth-rule);
  }

  .metric-card:last-child {
    border-bottom: 0;
  }
}
</style>
