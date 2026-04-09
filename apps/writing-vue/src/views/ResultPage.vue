<template>
  <div class="result-page">
    <header class="result-hero">
      <div class="result-hero__copy">
        <span class="result-chip">AI Feedback</span>
        <h1 class="heading-serif">Results Analysis</h1>
      </div>

      <div class="result-hero__score card card-whisper">
        <span class="score-badge__label">AI Evaluation Summary</span>
        <div class="score-ring" :style="{ '--score-progress': ((Number(scoreData?.total_score) || 0) / 9).toFixed(3) }">
          <div class="score-ring__inner">
            <strong>{{ scoreData?.total_score ?? '-' }}</strong>
            <span>Overall Band</span>
          </div>
        </div>
        <span class="score-badge__meta">字数 {{ essayWordCount || '-' }}</span>
      </div>
    </header>

    <div class="result-layout">
      <section class="reading-panel card card-whisper">
        <div class="reading-head">
          <div>
            <h2 class="heading-serif">{{ viewMode === 'full' ? '作文原文' : `重点纠错（${sentences.length}句）` }}</h2>
          </div>
          <div class="view-switcher">
            <button :class="['view-btn', { active: viewMode === 'full' }]" @click="viewMode = 'full'">
              全文
            </button>
            <button :class="['view-btn', { active: viewMode === 'annotated' }]" @click="viewMode = 'annotated'">
              重点纠错
            </button>
          </div>
        </div>

        <div v-if="viewMode === 'full'" class="essay-view">
          <div v-if="essayText" class="essay-text">{{ essayText }}</div>
          <p v-else class="empty-hint">暂无作文原文。</p>
        </div>

        <div v-else-if="sentences.length > 0" class="annotated-view">
          <div class="bulk-controls">
            <button class="btn-link" @click="expandAll">全部展开</button>
            <button class="btn-link" @click="collapseAll">全部折叠</button>
          </div>

          <div
            v-for="(sentence, index) in sentences"
            :key="index"
            class="sentence-block"
          >
            <div class="sentence-header">
              <span class="sentence-index">[{{ index + 1 }}]</span>
              <span class="sentence-text" v-html="highlightErrors(sentence)"></span>
              <button
                v-if="sentence.errors && sentence.errors.length > 0"
                class="expand-btn"
                @click="toggleExpand(index)"
              >
                {{ expandedSentences.has(index) ? '收起' : '展开' }}
              </button>
            </div>

            <div
              v-if="sentence.errors && sentence.errors.length > 0 && expandedSentences.has(index)"
              class="error-details"
            >
              <div
                v-for="(err, errIdx) in sentence.errors"
                :key="errIdx"
                class="error-item"
              >
                <span :class="['error-type', `error-${err.type}`]">
                  {{ getErrorTypeLabel(err.type) }}
                </span>
                <div class="error-content">
                  <p class="error-word">{{ err.word }}</p>
                  <p class="error-reason">{{ err.reason }}</p>
                  <p class="error-correction">
                    建议修改为：<strong>{{ err.correction }}</strong>
                  </p>
                </div>
              </div>
              <div v-if="sentence.corrected" class="corrected-sentence">
                <strong>修正后：</strong>{{ sentence.corrected }}
              </div>
            </div>
          </div>
        </div>

        <div v-else class="original-view">
          <p class="empty-hint">{{ sentenceEmptyHint }}</p>
        </div>
      </section>

      <aside class="report-rail">
        <section v-if="topicText" class="rail-card card card-whisper">
          <div class="rail-head">
            <h3>题目要求</h3>
          </div>
          <p class="topic-text">{{ topicText }}</p>
        </section>

        <section class="rail-card card card-whisper">
          <div class="rail-head">
            <h3>分项评分</h3>
          </div>
          <div class="score-breakdown">
            <div class="breakdown-item">
              <div class="breakdown-header">
                <span class="breakdown-name">任务完成度</span>
                <span class="breakdown-score">{{ scoreData?.task_achievement ?? '-' }}</span>
              </div>
              <p class="breakdown-desc">Task Achievement / Task Response</p>
            </div>
            <div class="breakdown-item">
              <div class="breakdown-header">
                <span class="breakdown-name">连贯与衔接</span>
                <span class="breakdown-score">{{ scoreData?.coherence_cohesion ?? '-' }}</span>
              </div>
              <p class="breakdown-desc">Coherence and Cohesion</p>
            </div>
            <div class="breakdown-item">
              <div class="breakdown-header">
                <span class="breakdown-name">词汇丰富度</span>
                <span class="breakdown-score">{{ scoreData?.lexical_resource ?? '-' }}</span>
              </div>
              <p class="breakdown-desc">Lexical Resource</p>
            </div>
            <div class="breakdown-item">
              <div class="breakdown-header">
                <span class="breakdown-name">语法范围与准确性</span>
                <span class="breakdown-score">{{ scoreData?.grammatical_range ?? '-' }}</span>
              </div>
              <p class="breakdown-desc">Grammatical Range and Accuracy</p>
            </div>
          </div>
        </section>

        <section v-if="reviewDegraded" class="rail-card rail-card-warning card card-whisper">
          <div class="rail-head">
            <h3>详解降级提示</h3>
          </div>
          <p class="feedback-text">
            本次评测只完整返回了评分结果，段落和句级详解没有全部生成。建议稍后重试拿完整报告。
          </p>
        </section>

        <section v-if="feedback" class="rail-card card card-whisper">
          <div class="rail-head">
            <h3>整体改进建议</h3>
          </div>
          <p class="feedback-text">{{ feedback }}</p>
        </section>

        <section v-if="reviewBlocks.length > 0" class="rail-card card card-whisper">
          <div class="rail-head">
            <h3>段落详解</h3>
          </div>
          <div class="rationale-list">
            <div
              v-for="(item, index) in reviewBlocks"
              :key="`review-${index}`"
              class="rationale-item"
            >
              <span class="analysis-label">段落 {{ item.paragraph_index || (index + 1) }}</span>
              <p>{{ item.comment || item.analysis || item.feedback || '' }}</p>
            </div>
          </div>
        </section>

        <section v-if="taskAnalysisEntries.length > 0" class="rail-card card card-whisper">
          <div class="rail-head">
            <h3>任务诊断</h3>
          </div>
          <div class="analysis-grid">
            <div
              v-for="item in taskAnalysisEntries"
              :key="item.label"
              class="analysis-item"
            >
              <span class="analysis-label">{{ item.label }}</span>
              <p>{{ item.value }}</p>
            </div>
          </div>
        </section>

        <section v-if="bandRationaleEntries.length > 0" class="rail-card card card-whisper">
          <div class="rail-head">
            <h3>评分理由</h3>
          </div>
          <div class="rationale-list">
            <div
              v-for="item in bandRationaleEntries"
              :key="item.label"
              class="rationale-item"
            >
              <span class="analysis-label">{{ item.label }}</span>
              <p>{{ item.value }}</p>
            </div>
          </div>
        </section>

        <section v-if="improvementPlan.length > 0" class="rail-card card card-whisper">
          <div class="rail-head">
            <h3>提分计划</h3>
          </div>
          <ul class="plan-list">
            <li v-for="(item, index) in improvementPlan" :key="`${index}-${item}`">
              {{ item }}
            </li>
          </ul>
        </section>

        <div class="action-buttons">
          <button class="btn btn-brand" @click="writeNew">
            写新作文
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { essays as essaysApi } from '@/api/client.js'
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
  const essayId = route.query.essayId ? Number(route.query.essayId) : null

  if (essayId) {
    try {
      const detail = await essaysApi.getById(essayId)
      const evaluationView = buildEvaluationView(detail.evaluation_json, {
        score: {
          total_score: detail.total_score,
          task_achievement: detail.task_achievement,
          coherence_cohesion: detail.coherence_cohesion,
          lexical_resource: detail.lexical_resource,
          grammatical_range: detail.grammatical_range
        },
        task_analysis: detail.task_analysis,
        band_rationale: detail.band_rationale,
        improvement_plan: detail.improvement_plan,
        topic_text: detail.topic_text || detail.display_topic_title || '',
        topic_source: detail.topic_source || ''
      })

      essayText.value = detail.content || ''
      essayWordCount.value = detail.word_count || 0
      applyEvaluationView(evaluationView)
      return
    } catch (error) {
      console.warn('从数据库加载结果失败，降级读取 sessionStorage', error)
    }
  }

  const stored = sessionStorage.getItem(`evaluation_${props.sessionId}`)
  if (stored) {
    try {
      applyEvaluationView(buildEvaluationView(JSON.parse(stored)))
      return
    } catch (error) {
      console.warn('sessionStorage 结果解析失败，返回写作页', error)
    }
  }

  router.replace({ name: 'Compose' })
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
  sessionStorage.removeItem(`evaluation_${props.sessionId}`)
  router.push({ name: 'Compose' })
}
</script>

<style scoped>
.result-page {
  display: grid;
  gap: 22px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.result-hero {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
}

.result-hero__copy {
  display: grid;
  gap: 10px;
}

.result-chip {
  display: inline-flex;
  width: fit-content;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--primary-color);
  background: rgba(201, 100, 66, 0.12);
  border: 1px solid rgba(201, 100, 66, 0.24);
}

.result-hero__copy h1 {
  font-size: clamp(2.4rem, 4.4vw, 4.2rem);
  max-width: 13ch;
}

.result-hero__copy p:last-child {
  color: var(--text-secondary);
}

.result-hero__score {
  min-width: 220px;
  display: grid;
  gap: 12px;
  padding: 18px 20px;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.42));
  border: 1px solid rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.score-badge__label,
.score-badge__meta {
  color: var(--text-muted);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-transform: uppercase;
}

.score-ring {
  width: 118px;
  height: 118px;
  border-radius: 50%;
  margin: 0 auto;
  display: grid;
  place-items: center;
  background:
    conic-gradient(
      #5456aa calc((var(--score-progress, 0.8)) * 360deg),
      rgba(180, 184, 222, 0.32) 0
    );
  position: relative;
}

.score-ring::before {
  content: '';
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.8);
}

.score-ring__inner {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 2px;
}

.score-ring__inner strong {
  font-size: 2rem;
  line-height: 1;
  color: #5456aa;
}

.score-ring__inner span {
  font-size: 0.52rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.result-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
  gap: 20px;
  align-items: start;
}

.reading-panel,
.rail-card {
  padding: 22px;
}

.reading-panel {
  display: grid;
  gap: 18px;
  max-height: calc(100vh - 180px);
  overflow: auto;
  background: var(--lg-bg-elevated);
  border: 1px solid var(--lg-border-color);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.reading-head,
.rail-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
}

.reading-head h2,
.rail-head h3 {
  font-size: 1.55rem;
}

.rail-head span {
  color: var(--text-muted);
  font-size: 0.88rem;
}

.rail-card {
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.42));
  border: 1px solid rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.view-switcher {
  display: inline-flex;
  gap: 8px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.54);
  border: 1px solid var(--lg-border-color);
}

.view-btn {
  min-height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.view-btn.active {
  color: var(--text-primary);
  background: #fffdf8d1;
  box-shadow: var(--lg-shadow-subtle);
}

.essay-view,
.annotated-view,
.original-view {
  display: grid;
  gap: 14px;
}

.essay-text,
.empty-hint {
  padding: 20px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.48);
  border: 1px solid var(--lg-border-color);
  color: var(--text-secondary);
  line-height: 1.9;
  white-space: pre-wrap;
}

.empty-hint {
  margin: 0;
}

.bulk-controls {
  display: flex;
  gap: 16px;
}

.btn-link {
  color: var(--color-terracotta);
  text-decoration: underline;
  text-underline-offset: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  transition: color 0.15s;
}

.btn-link:hover {
  color: var(--color-coral);
}

.sentence-block {
  display: grid;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--lg-border-subtle);
}

.sentence-block:last-child {
  border-bottom: 0;
}

.sentence-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.sentence-index {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.sentence-text {
  flex: 1;
  line-height: 1.85;
}

.expand-btn {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--lg-border-color);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.62);
  cursor: pointer;
}

:deep(.highlight-grammar) {
  background: rgba(179, 86, 68, 0.18);
  border-bottom: 2px solid var(--error-grammar);
}

:deep(.highlight-spelling) {
  background: rgba(186, 122, 50, 0.18);
  border-bottom: 2px solid var(--error-spelling);
}

:deep(.highlight-word_choice) {
  background: rgba(86, 120, 153, 0.18);
  border-bottom: 2px solid var(--error-word-choice);
}

:deep(.highlight-sentence_structure) {
  background: rgba(122, 95, 152, 0.18);
  border-bottom: 2px solid var(--error-sentence-structure);
}

:deep(.highlight-coherence) {
  background: rgba(93, 135, 98, 0.18);
  border-bottom: 2px solid var(--error-coherence);
}

.error-details {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.48);
  border: 1px solid var(--lg-border-color);
}

.error-item {
  display: flex;
  gap: 12px;
}

.error-type {
  flex-shrink: 0;
  padding: 5px 9px;
  border-radius: 999px;
  color: #fffaf2;
  font-size: 0.75rem;
  font-weight: 700;
}

.error-grammar { background: var(--error-grammar); }
.error-spelling { background: var(--error-spelling); }
.error-word_choice { background: var(--error-word-choice); }
.error-sentence_structure { background: var(--error-sentence-structure); }
.error-coherence { background: var(--error-coherence); }

.error-content {
  display: grid;
  gap: 4px;
}

.error-word {
  font-weight: 700;
}

.error-reason,
.error-correction,
.corrected-sentence,
.topic-text,
.feedback-text,
.analysis-item p,
.rationale-item p,
.plan-list {
  color: var(--text-secondary);
}

.corrected-sentence {
  padding-top: 10px;
  border-top: 1px dashed var(--border-color);
}

.report-rail {
  display: grid;
  gap: 16px;
  max-height: calc(100vh - 180px);
  overflow: auto;
}

.score-breakdown,
.analysis-grid,
.rationale-list {
  display: grid;
  gap: 12px;
}

.breakdown-item {
  display: grid;
  gap: 4px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: rgba(186, 187, 255, 0.16);
}

.breakdown-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.breakdown-name {
  font-weight: 600;
}

.breakdown-score {
  font-size: 1.4rem;
  color: #393b8e;
}

.breakdown-desc,
.analysis-label {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.analysis-item,
.rationale-item {
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.74);
}

.action-buttons {
  justify-content: stretch;
}

.action-buttons .btn {
  width: 100%;
}

.analysis-label {
  display: inline-block;
  margin-bottom: 6px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.plan-list {
  margin: 0;
  padding-left: 18px;
}

.plan-list li + li {
  margin-top: 8px;
}

.rail-card-warning {
  border-color: rgba(166, 107, 45, 0.2);
  background: rgba(255, 246, 236, 0.9);
}

@media (max-width: 1080px) {
  .result-hero,
  .result-layout {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .reading-panel,
  .report-rail {
    max-height: none;
  }
}

@media (max-width: 720px) {
  .reading-panel,
  .rail-card {
    padding: 18px;
  }

  .reading-head,
  .sentence-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
