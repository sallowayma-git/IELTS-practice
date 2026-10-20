<template>
  <div class="result-page atlas-result">
    <header class="page-header result-header has-rule">
      <div class="page-header-top">
        <div class="result-header__copy">
          <p class="page-header-kicker">IELTS 写作 · {{ essayWordCount }} 词</p>
          <h1 class="display-heading">评测结果</h1>
        </div>
        <div class="result-header__meta">
          <div class="score-total-row">
            <span class="score-label stat-label">总分 Band</span>
            <span class="score-total t-display t-num">{{ scoreData?.total_score ?? '-' }}</span>
          </div>
          <div class="page-header-actions">
            <router-link v-if="historyBack" :to="historyBack" class="btn btn-secondary" data-history-back>← 返回历史</router-link>
            <button class="btn btn-primary" type="button" @click="writeNew">再写一篇</button>
          </div>
        </div>
      </div>
    </header>

    <section v-if="loadError" class="result-load-error card" role="alert">
      <h2>无法加载评测结果</h2>
      <p>{{ loadError }}</p>
      <div class="result-load-error__actions">
        <button class="btn btn-secondary" type="button" @click="loadResult">重试加载</button>
        <button class="btn btn-link" type="button" @click="writeNew">返回写作页</button>
      </div>
    </section>
    <div v-else class="result-layout">
      <section class="essay-panel card">
        <div v-if="topicText" class="topic-block">
          <p class="topic-block__label">{{ topicSourceLabel }}</p>
          <p class="topic-block__text quote t-body-lg">{{ topicText }}</p>
        </div>

        <div class="view-controls">
          <button :class="['btn', viewMode === 'full' ? 'btn-brand' : 'btn-warm-sand']" @click="viewMode = 'full'">原文</button>
          <button v-if="sentences.length > 0" :class="['btn', viewMode === 'annotated' ? 'btn-brand' : 'btn-warm-sand']" @click="viewMode = 'annotated'">逐句批注</button>
        </div>

        <div class="essay-body scroll-region t-body-lg" v-if="viewMode === 'full'">{{ essayText || '没有找到作文正文。' }}</div>

        <div class="essay-body scroll-region t-body-lg" v-else>
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
              </component>{{ ' ' }}

              <div :id="`sentence-errors-${index}`" v-if="sentence.errors?.length > 0 && expandedSentences.has(index)" class="error-details">
                <div v-for="(err, errIdx) in sentence.errors" :key="errIdx" class="error-item">
                  <div class="error-type" :class="'text-' + err.type.replace('_', '-')">
                    <strong>{{ getErrorTypeLabel(err.type) }}</strong>
                  </div>
                  <div class="error-word">
                    <span class="label">原文</span><span class="line-through">{{ err.word }}</span>
                  </div>
                  <div v-if="err.reason && err.reason !== err.type" class="error-reason">{{ err.reason }}</div>
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
          <div v-else class="essay-empty t-small">{{ sentenceEmptyHint }}</div>
        </div>
      </section>

      <aside class="right-panel" aria-label="评测说明">
        <section class="result-section card" aria-labelledby="score-heading">
          <div class="panel-header">
            <h2 id="score-heading">评分表</h2>
            <span class="section-meta">四项标准</span>
          </div>
          <table class="table criteria-table">
            <thead>
              <tr>
                <th scope="col">评分标准</th>
                <th scope="col" class="num">Band</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in criteriaRows" :key="row.key">
                <th scope="row">{{ row.label }} <span class="tag tag-neutral criterion-code">{{ row.code }}</span></th>
                <td class="num">{{ row.band }}</td>
              </tr>
            </tbody>
          </table>
          <dl v-if="rationaleRows.length > 0" class="rationale-list">
            <div v-for="row in rationaleRows" :key="row.key" class="rationale-item">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.reason }}</dd>
            </div>
          </dl>
        </section>

        <div v-if="reviewDegraded" class="inline-message inline-message-warning degraded-note">
          <h4>详解已降级</h4>
          <p>{{ sentenceEmptyHint }}</p>
        </div>

        <section v-if="feedback" class="result-section card">
          <div class="panel-header"><h2>整体改进建议</h2></div>
          <p class="result-prose">{{ feedback }}</p>
        </section>

        <section v-if="improvementPlan && improvementPlan.length > 0" class="result-section card">
          <div class="panel-header"><h2>核心提分计划</h2></div>
          <ol class="plan-list">
            <li v-for="(item, idx) in improvementPlan" :key="idx"><span>{{ item }}</span></li>
          </ol>
        </section>

        <section v-if="reviewBlocks && reviewBlocks.length > 0" class="result-section card">
          <div class="panel-header"><h2>段落详评</h2></div>
          <dl class="rationale-list">
            <div v-for="(item, idx) in reviewBlocks" :key="idx" class="rationale-item">
              <dt>第 {{ item.paragraph_index || (idx + 1) }} 段</dt>
              <dd>{{ typeof item === 'object' ? (item.comment || item.analysis || item.feedback || '') : item }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="taskAnalysisEntries && taskAnalysisEntries.length > 0" class="result-section card">
          <div class="panel-header"><h2>任务诊断</h2></div>
          <dl class="rationale-list">
            <div v-for="item in taskAnalysisEntries" :key="item.label" class="rationale-item">
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { essays as essaysApi } from '@/api/client.js'
import { historyReturnPath } from '@/modules/history/return.js'
import { errorKindLabel, isErrorKind } from '@/modules/writing/errorKinds.js'
import {
  BAND_RATIONALE_LABELS,
  TASK_ANALYSIS_LABELS,
  buildEvaluationView,
  formatLabeledEntries,
  normalizeMap
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

const CRITERIA = [
  { key: 'task_achievement', label: '任务回应', code: 'TR' },
  { key: 'coherence_cohesion', label: '连贯与衔接', code: 'CC' },
  { key: 'lexical_resource', label: '词汇资源', code: 'LR' },
  { key: 'grammatical_range', label: '语法范围与准确性', code: 'GRA' }
]

const criteriaRows = computed(() => (
  CRITERIA.map((item) => ({
    ...item,
    band: scoreData.value?.[item.key] ?? '-'
  }))
))

// Standard criteria first, then any extra rationale keys the engine returned (never dropped).
const rationaleRows = computed(() => {
  const rationale = normalizeMap(bandRationale.value)
  const standardKeys = new Set(CRITERIA.map((item) => item.key))
  const standard = CRITERIA
    .filter((item) => typeof rationale[item.key] === 'string' && rationale[item.key].trim())
    .map((item) => ({ key: item.key, label: item.label, reason: rationale[item.key].trim() }))
  const extra = Object.entries(rationale)
    .filter(([key, value]) => !standardKeys.has(key) && typeof value === 'string' && value.trim())
    .map(([key, value]) => ({ key, label: BAND_RATIONALE_LABELS[key] || key, reason: value.trim() }))
  return [...standard, ...extra]
})

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
  if (isErrorKind(type)) return errorKindLabel(type)
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
    const title = err.reason && err.reason !== err.type ? err.reason : getErrorTypeLabel(err.type)
    result += `<span class="${colorClass}" title="${escapeHtml(title)}">${escapeHtml(errorWord)}</span>`

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
/* Result: a marking sheet. Essay card on the left, criteria and feedback rules on the right. */
.result-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.85fr);
  align-items: start;
  gap: var(--anth-space-9);
}


.score-total-row {
  display: flex;
  align-items: baseline;
  gap: var(--anth-space-3);
}

/* Score and actions share the header's trailing column. */
.result-header__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--anth-space-3);
}

.result-header__meta .page-header-actions {
  margin: 0;
}

/* Quote: prose set off by a left rule. */
.quote {
  margin: 0;
  padding-left: var(--anth-space-4);
  border-left: 2px solid var(--anth-rule-strong);
}

.topic-block__label {
  margin: 0 0 var(--anth-space-1);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}

.topic-block__text {
  max-width: var(--anth-measure);
  color: var(--anth-ink-soft);
  font-style: italic;
}

/* Original / annotated: text tabs reuse the button box, drawn as an underline. */
.view-controls {
  display: flex;
  gap: var(--anth-space-5);
  margin: var(--anth-space-5) 0 var(--anth-space-4);
  border-bottom: 1px solid var(--anth-rule);
}

.view-controls > .btn {
  --btn-bg: transparent;
  --btn-bg-hover: transparent;
  --btn-bg-active: transparent;
  --btn-fg: var(--anth-ink-muted);
  --btn-fg-hover: var(--anth-ink);
  --btn-border: transparent;
  --btn-border-hover: transparent;
  --btn-shadow: none;
  height: 40px;
  margin: 0 0 -1px;
  padding: 0 2px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  font-weight: var(--anth-weight-regular);
}

.view-controls > .btn-brand {
  --btn-fg: var(--anth-ink);
  --btn-border-hover: var(--anth-ink);
  border-bottom-color: var(--anth-ink);
  font-weight: var(--anth-weight-medium);
}

/* Essay body: serif reading column, bounded by the scroll region. */
.essay-body {
  max-width: var(--anth-measure);
  max-height: min(70vh, 900px);
  color: var(--anth-ink);
  white-space: pre-wrap;
}


.sentence-container {
  display: inline;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.sentence-container.has-error {
  cursor: pointer;
  text-decoration: underline dotted var(--anth-border-strong);
  text-underline-offset: 4px;
}

.sentence-container.has-error[aria-expanded="true"] {
  text-decoration-color: var(--anth-ink);
}

/* An annotation is a marginal note set into the text. */
.error-details {
  display: grid;
  gap: var(--anth-space-3);
  margin: var(--anth-space-3) 0 var(--anth-space-4);
  padding: 2px 0 2px var(--anth-space-4);
  border-left: 2px solid var(--anth-ink);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-small-size);
  line-height: var(--anth-text-small-line);
  white-space: normal;
}

.text-grammar { color: var(--anth-danger); }
.text-spelling { color: var(--anth-warning); }
.text-word-choice { color: var(--anth-info); }
.text-sentence-structure { color: var(--anth-ink-soft); }
.text-coherence { color: var(--anth-success); }

.label {
  display: inline-block;
  min-width: 2.5em;
  margin-right: var(--anth-space-2);
  color: var(--anth-ink-muted);
}

.line-through {
  text-decoration: line-through;
}

.corrected-sentence {
  padding-top: var(--anth-space-2);
  border-top: 1px solid var(--anth-rule);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
}

/* Right column: design-system cards, one idea per card. */
.right-panel {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-4);
  min-width: 0;
}

.criteria-table td.num {
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-h2-size);
}

.criteria-table + .rationale-list {
  margin-top: var(--anth-space-3);
}

.criterion-code {
  margin-left: var(--anth-space-2);
}

.rationale-list {
  display: grid;
  margin: 0;
}

.rationale-item {
  display: grid;
  gap: 2px;
  padding: var(--anth-space-2) 0;
  border-top: 1px solid var(--anth-rule);
  font-size: var(--anth-text-small-size);
}

.rationale-item:first-child {
  padding-top: 0;
  border-top: 0;
}

.rationale-item dt {
  color: var(--anth-ink-strong);
  font-weight: var(--anth-weight-semibold);
}

.rationale-item dd {
  margin: 0;
  color: var(--anth-ink-soft);
  line-height: var(--anth-text-small-line);
}

.degraded-note h4 {
  margin: 0 0 var(--anth-space-1);
  font-size: var(--anth-text-small-size);
  font-weight: var(--anth-weight-semibold);
}

/* Feedback reads as a commentary column, not a second essay. */
.result-prose {
  max-width: var(--anth-measure);
  margin: 0;
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  line-height: var(--anth-text-body-lg-line);
}

.plan-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: plan;
}

.plan-list li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--anth-space-3);
  padding: var(--anth-space-3) 0;
  border-top: 1px solid var(--anth-rule);
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-body-size);
  line-height: var(--anth-text-body-line);
  counter-increment: plan;
}

.plan-list li:first-child {
  padding-top: 0;
  border-top: 0;
}

.plan-list li::before {
  content: counter(plan, decimal-leading-zero);
  color: var(--anth-ink-muted);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-small-size);
  font-variant-numeric: tabular-nums;
}

.result-load-error {
  display: grid;
  gap: var(--anth-space-3);
  max-width: var(--anth-content-width-narrow);
}

.result-load-error h2,
.result-load-error p {
  margin: 0;
  color: var(--anth-danger);
}

.result-load-error__actions {
  display: flex;
  align-items: center;
  gap: var(--anth-space-5);
}

@media (max-width: 1040px) {
  .result-layout {
    grid-template-columns: 1fr;
    gap: var(--anth-space-8);
  }

  .essay-body {
    max-height: none;
    overflow: visible;
  }
}

@media (max-width: 640px) {
  .result-header__meta {
    align-items: flex-start;
  }
}
</style>
