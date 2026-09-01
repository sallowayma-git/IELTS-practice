<template>
  <div class="result-page">
    <section v-if="loadError" class="result-load-error glass-card" role="alert">
      <h1 class="heading-serif">无法加载评测结果</h1>
      <p>{{ loadError }}</p>
      <div class="result-load-error__actions">
        <button class="btn btn-brand" type="button" @click="loadResult">重试加载</button>
        <button class="btn btn-secondary" type="button" @click="writeNew">返回写作页</button>
      </div>
    </section>
    <div v-else class="result-layout">
      <!-- Left Column: Essay & Annotated Errors -->
      <section class="essay-panel card card-whisper result-panel--from-left">
        <header class="essay-head border-base">
          <div>
            <h1 class="heading-serif display-heading">Feedback &amp; Results</h1>
            <p class="topic-meta">IELTS Writing Evaluation</p>
          </div>
          <span class="word-badge">{{ essayWordCount }} Words</span>
        </header>

        <div v-if="topicText" class="glass-card mb-4 p-4">
          <h3 class="flex-align text-sm font-bold text-primary mb-2">
            <svg class="icon-inline mr-2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            {{ topicSourceLabel }}
          </h3>
          <p class="topic-meta">{{ topicText }}</p>
        </div>

        <div class="view-controls mb-4">
          <button :class="['btn', viewMode === 'full' ? 'btn-brand' : 'btn-warm-sand']" @click="viewMode = 'full'">Original View</button>
          <button v-if="sentences.length > 0" :class="['btn', viewMode === 'annotated' ? 'btn-brand' : 'btn-warm-sand']" @click="viewMode = 'annotated'">Annotated Errors</button>
        </div>

        <div class="essay-body custom-scroll" v-if="viewMode === 'full'">
            {{ essayText || 'No text found.' }}
        </div>
        
        <div class="essay-body custom-scroll" v-else>
           <div v-if="sentences.length > 0">
             <template v-for="(sentence, index) in sentences" :key="index">
               
               <component
                     :is="sentence.errors?.length > 0 ? 'button' : 'span'"
                     class="sentence-container"
                     :class="{'has-error': sentence.errors?.length > 0}"
                     :type="sentence.errors?.length > 0 ? 'button' : undefined"
                     :aria-expanded="sentence.errors?.length > 0 ? String(expandedSentences.has(index)) : undefined"
                     :aria-controls="sentence.errors?.length > 0 ? `sentence-errors-${index}` : undefined"
                     @click="sentence.errors?.length > 0 ? toggleExpand(index) : null"
               >
                 <span v-html="highlightErrors(sentence)"></span>
               </component>

               <div :id="`sentence-errors-${index}`" v-if="sentence.errors?.length > 0 && expandedSentences.has(index)" class="error-details glass-card shadow-elevated mb-3 mt-1">
                 <div v-for="(err, errIdx) in sentence.errors" :key="errIdx" class="error-item border-base-light pb-2 mb-2 last-no-border">
                    <div class="error-type mb-1" :class="'text-' + err.type.replace('_', '-')">
                      <svg class="icon-inline icon-inline--xs mr-1" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="13"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      <strong>{{ getErrorTypeLabel(err.type) }}</strong>
                    </div>
                    <div class="error-word mb-1">
                      <span class="label">原文: </span><span class="text-secondary line-through">{{ err.word }}</span>
                    </div>
                    <div class="error-reason text-sm text-secondary mb-1">
                      {{ err.reason }}
                    </div>
                    <div class="error-correction">
                      <span class="label">建议: </span><strong class="text-primary">{{ err.correction }}</strong>
                    </div>
                 </div>
                 <div class="corrected-sentence mt-3 pt-3 border-top-dashed text-primary font-bold">
                    <span class="label text-secondary font-normal text-xs mb-1 block">Revised Sentence:</span>
                    {{ sentence.corrected }}
                 </div>
               </div>
               
             </template>
           </div>
           <div v-else class="text-secondary italic">
              {{ sentenceEmptyHint }}
           </div>
        </div>
      </section>

      <!-- Right Column: Sidebar Analysis -->
      <aside class="right-panel result-panel--from-right custom-scroll">
        
        <!-- Score summary -->
        <div class="glass-card text-center relative overflow-hidden p-6 mb-4">
          <h3 class="font-bold text-lg mb-4 z-10 relative">AI Evaluation Summary</h3>
          <div class="score-ring-container">
            <svg class="score-svg" viewBox="0 0 192 192">
              <circle class="score-bg" cx="96" cy="96" r="80"></circle>
              <circle class="score-fill" cx="96" cy="96" r="80" 
                :style="{ strokeDashoffset: (2 * Math.PI * 80) - ((2 * Math.PI * 80) * ((Number(scoreData?.total_score) || 0) / 9)) }"></circle>
            </svg>
            <div class="score-info">
              <span class="score-total">{{ scoreData?.total_score ?? '-' }}</span>
              <span class="score-label">Overall Band</span>
            </div>
          </div>
        </div>

        <div v-if="reviewDegraded" class="degraded-warning mb-4">
          <h4 class="font-bold mb-1 flex-align">
              <svg class="icon-inline mr-2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              Analysis Degraded
          </h4>
          <p class="text-xs">{{ sentenceEmptyHint }}</p>
        </div>

        <!-- Metrics Grid -->
        <div class="metrics-grid mb-4">
          <div class="metric-card glass-card hover-lift p-4">
            <svg class="icon-inline icon-inline--metric text-primary mb-2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 11l3 3L22 4"></path>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
            <div class="metric-label">Task Response</div>
            <div class="metric-value">{{ scoreData?.task_achievement ?? '-' }}</div>
          </div>
          <div class="metric-card glass-card hover-lift p-4">
            <svg class="icon-inline icon-inline--metric text-primary mb-2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3v12"></path>
              <path d="M18 9v12"></path>
              <path d="M6 9h12"></path>
              <circle cx="6" cy="18" r="2"></circle>
              <circle cx="18" cy="6" r="2"></circle>
              <circle cx="18" cy="18" r="2"></circle>
            </svg>
            <div class="metric-label">Coherence</div>
            <div class="metric-value">{{ scoreData?.coherence_cohesion ?? '-' }}</div>
          </div>
          <div class="metric-card glass-card hover-lift p-4">
            <svg class="icon-inline icon-inline--metric text-primary mb-2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            <div class="metric-label">Lexical Resource</div>
            <div class="metric-value">{{ scoreData?.lexical_resource ?? '-' }}</div>
          </div>
          <div class="metric-card glass-card hover-lift p-4">
            <svg class="icon-inline icon-inline--metric text-primary mb-2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h16"></path>
              <path d="M6 16h12"></path>
              <path d="M8 12h8"></path>
              <path d="M10 4h4"></path>
              <path d="M9 8h6"></path>
            </svg>
            <div class="metric-label">Grammar</div>
            <div class="metric-value">{{ scoreData?.grammatical_range ?? '-' }}</div>
          </div>
        </div>

        <div v-if="feedback" class="glass-card mb-4">
          <h3 class="font-bold flex-align mb-3 text-sm">
            <svg class="icon-inline text-primary mr-2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 18h6"></path>
              <path d="M10 22h4"></path>
              <path d="M12 2a7 7 0 0 0-4 12.75c.58.4 1 1 1.2 1.67L9.5 18h5l.3-1.58c.2-.67.62-1.27 1.2-1.67A7 7 0 0 0 12 2z"></path>
            </svg>
            整体改进建议
          </h3>
          <p class="text-sm text-secondary leading-relaxed">{{ feedback }}</p>
        </div>

        <div v-if="improvementPlan && improvementPlan.length > 0" class="glass-card mb-4">
          <h3 class="font-bold flex-align mb-3 text-sm">
              <svg class="icon-inline text-primary mr-2" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4L14 13"></path>
                <path d="M18 5l1 1"></path>
              </svg>
              核心提分计划
          </h3>
          <ul class="plan-list">
              <li v-for="(item, idx) in improvementPlan" :key="idx" class="flex-align-start text-sm mb-2">
                  <span class="bullet"></span>
                  <span class="text-secondary leading-relaxed">{{ item }}</span>
              </li>
          </ul>
        </div>
        
        <div v-if="reviewBlocks && reviewBlocks.length > 0" class="glass-card mb-4">
          <h3 class="font-bold flex-align mb-3 text-sm">
            <svg class="icon-inline text-primary mr-2" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            段落详评
          </h3>
          <div class="rationale-list">
            <div v-for="(item, idx) in reviewBlocks" :key="idx" class="rationale-item border-base text-sm mb-3">
              <strong class="text-primary block text-xs uppercase mb-1">Paragraph {{ item.paragraph_index || (idx + 1) }}</strong>
              <span class="text-secondary block mt-1 leading-relaxed">{{ typeof item === 'object' ? (item.comment || item.analysis || item.feedback || '') : item }}</span>
            </div>
          </div>
        </div>

        <div v-if="bandRationaleEntries && bandRationaleEntries.length > 0" class="glass-card mb-4">
          <h3 class="font-bold flex-align mb-3 text-sm">
              <svg class="icon-inline text-primary mr-2" viewBox="0 0 24 24" aria-hidden="true">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              得分解析
          </h3>
          <div class="rationale-list">
            <div v-for="item in bandRationaleEntries" :key="item.label" class="rationale-item border-base text-sm mb-3">
              <strong class="text-primary block text-xs uppercase">{{ item.label }}</strong>
              <span class="text-secondary block mt-1 leading-relaxed">{{ item.value }}</span>
            </div>
          </div>
        </div>
        
        <div v-if="taskAnalysisEntries && taskAnalysisEntries.length > 0" class="glass-card mb-4">
          <h3 class="font-bold flex-align mb-3 text-sm">
              <svg class="icon-inline text-primary mr-2" viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
              任务诊断
          </h3>
          <div class="rationale-list">
            <div v-for="item in taskAnalysisEntries" :key="item.label" class="rationale-item border-base text-sm mb-3">
              <strong class="text-primary block text-xs uppercase">{{ item.label }}</strong>
              <span class="text-secondary block mt-1 leading-relaxed">{{ item.value }}</span>
            </div>
          </div>
        </div>

        <div class="mt-4 mb-4">
            <button @click="writeNew" class="btn btn-brand w-full p-4">
                回到主页练新题
            </button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
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
.result-page {
  animation: result-page-enter var(--lg-duration-normal) var(--lg-easing-spring);
}

.result-layout {
  display: flex;
  gap: 24px;
  max-width: 1600px;
  margin: 0 auto;
  height: calc(100vh - 120px);
}

.glass-card {
  background: var(--lg-bg-primary);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  border: 1px solid var(--lg-border-color);
  border-radius: var(--lg-radius-md);
  box-shadow: var(--lg-shadow-elevated);
  padding: 24px;
}
.shadow-elevated {
  box-shadow: var(--lg-shadow-high);
}

.essay-panel {
  flex: 1.2;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.right-panel {
  flex: 0.8;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding-right: 12px;
}

.border-base {
  border-bottom: 1px solid var(--lg-border-subtle);
  padding-bottom: 20px;
  margin-bottom: 24px;
}

.border-base-light {
  border-bottom: 1px dashed var(--lg-border-subtle);
}
.border-top-dashed {
  border-top: 1px dashed var(--lg-border-subtle);
}
.last-no-border:last-child {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 0;
}

.essay-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

.display-heading {
  font-size: 2rem;
  color: var(--atlas-ink);
  margin-bottom: 6px;
}

.topic-meta {
  color: var(--atlas-ink-soft);
  font-style: italic;
  font-size: 0.95rem;
  line-height: 1.5;
}

.word-badge {
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink);
  padding: 6px 14px;
  border-radius: 999px;
  font-weight: 500;
  font-size: 0.85rem;
}

.essay-body {
  flex: 1;
  white-space: pre-wrap;
  line-height: 2;
  color: var(--atlas-ink);
  font-size: 1.05rem;
  overflow-y: auto;
  padding-right: 12px;
}

.view-controls {
  display: flex;
  gap: 12px;
}

.view-controls .btn {
  padding: 8px 16px;
  font-size: 0.9rem;
  border-radius: 999px;
}

.sentence-container {
  display: inline;
  margin-right: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: inherit;
  transition:
    background var(--lg-duration-fast) var(--lg-easing-spring),
    border-color var(--lg-duration-fast) var(--lg-easing-spring);
}

.result-load-error {
  max-width: 640px;
  margin: 8vh auto;
  display: grid;
  gap: 14px;
}

.result-load-error h1,
.result-load-error p {
  margin: 0;
}

.result-load-error__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.has-error {
  cursor: pointer;
  border-bottom: 2px dashed var(--atlas-danger);
}

.has-error:hover {
  background: var(--atlas-library-danger);
}

.has-error:focus-visible {
  outline: 3px solid var(--atlas-accent-ring);
  outline-offset: 3px;
}

.error-details {
  display: block;   /* Important: inline to block transition inside text loop */
  padding: 16px;
  margin-left: 0;
  margin-right: 0;
}

.label {
  font-size: 0.8rem;
  color: var(--atlas-ink-soft);
  margin-right: 6px;
}
.line-through {
  text-decoration: line-through;
}

.uppercase { text-transform: uppercase; }
.mr-1 { margin-right: 4px; }
.mr-2 { margin-right: 8px; }
.mb-1 { margin-bottom: 4px; }
.mb-2 { margin-bottom: 8px; }
.mb-3 { margin-bottom: 12px; }
.mb-4 { margin-bottom: 16px; }
.mt-1 { margin-top: 4px; }
.mt-3 { margin-top: 12px; }
.mt-4 { margin-top: 16px; }
.pt-3 { padding-top: 12px; }
.pb-2 { padding-bottom: 8px; }
.p-4 { padding: 16px; }
.p-6 { padding: 24px; }
.w-full { width: 100%; }

.text-secondary { color: var(--atlas-ink-soft); }
.font-bold { font-weight: 600; }
.font-normal { font-weight: 400; }
.italic { font-style: italic; }
.block { display: block; }
.text-sm { font-size: 0.9rem; }
.text-xs { font-size: 0.8rem; }
.text-lg { font-size: 1.25rem; }
.leading-relaxed { line-height: 1.6; }

.flex-align {
  display: flex;
  align-items: center;
}

.icon-inline {
  width: 18px;
  height: 18px;
  min-width: 18px;
  min-height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon-inline--xs {
  width: 14px;
  height: 14px;
  min-width: 14px;
  min-height: 14px;
}

.icon-inline--metric {
  width: 22px;
  height: 22px;
  min-width: 22px;
  min-height: 22px;
}

.flex-align-start {
  display: flex;
  align-items: flex-start;
}

.score-ring-container {
  position: relative;
  width: 180px;
  height: 180px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.score-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  filter: drop-shadow(var(--lg-shadow-subtle));
}

.score-bg {
  fill: transparent;
  stroke: var(--lg-border-subtle);
  stroke-width: 14;
}

.score-fill {
  fill: transparent;
  stroke: var(--atlas-accent);
  stroke-width: 14;
  stroke-linecap: round;
  stroke-dasharray: 502;
  transition: stroke-dashoffset var(--lg-duration-slow) var(--lg-easing-spring);
}

.score-info {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.score-total {
  font-size: 3.5rem;
  font-weight: 700;
  color: var(--atlas-ink);
  line-height: 1;
}

.score-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--atlas-ink-soft);
  letter-spacing: 0.1em;
  margin-top: 4px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.metrics-grid > * {
  animation: atlas-rise-in var(--anth-duration-slow) var(--anth-ease-out) both;
}

.metrics-grid > *:nth-child(2) { animation-delay: 50ms; }
.metrics-grid > *:nth-child(3) { animation-delay: 100ms; }
.metrics-grid > *:nth-child(4) { animation-delay: 150ms; }

.metric-card {
  display: flex;
  flex-direction: column;
}

.metric-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--atlas-ink-soft);
  font-weight: 600;
  margin-top: 4px;
}

.metric-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--atlas-ink);
}

.hover-lift {
  transition: transform var(--lg-duration-fast) var(--lg-easing-spring);
}

.hover-lift:hover {
  transform: translateY(-4px);
}

.plan-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.bullet {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--atlas-accent);
  margin-top: 7px;
  margin-right: 12px;
  flex-shrink: 0;
}

.rationale-item:last-child {
  padding-bottom: 0;
  margin-bottom: 0;
  border-bottom: none;
}

.degraded-warning {
  background: var(--atlas-library-danger);
  border: 1px solid color-mix(in srgb, var(--atlas-danger) 30%, var(--lg-border-color));
  border-radius: var(--lg-radius-sm);
  padding: 16px;
  color: var(--atlas-danger);
}

@keyframes result-page-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes result-panel-enter-left {
  from { opacity: 0; transform: translateX(-24px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes result-panel-enter-right {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

.result-panel--from-left {
  animation: result-panel-enter-left var(--lg-duration-slow) var(--lg-easing-spring) both;
}

.result-panel--from-right {
  animation: result-panel-enter-right var(--lg-duration-slow) var(--lg-easing-spring) both;
}

/* Error highlights inside v-html */
:deep(.highlight-grammar) {
  background: var(--atlas-library-danger);
  border-bottom: 2px solid var(--atlas-danger);
}

:deep(.highlight-spelling) {
  background: var(--atlas-accent-soft);
  border-bottom: 2px solid var(--atlas-accent);
}

:deep(.highlight-word_choice) {
  background: var(--atlas-library-success);
  border-bottom: 2px solid var(--atlas-accent-alt);
}

:deep(.highlight-sentence_structure) {
  background: var(--lg-bg-interactive);
  border-bottom: 2px solid var(--atlas-ink-faint);
}

:deep(.highlight-coherence) {
  background: var(--atlas-accent-soft);
  border-bottom: 2px solid var(--atlas-accent-strong);
}

/* Custom Scroll for cards */
.custom-scroll::-webkit-scrollbar {
  width: 4px;
}
.custom-scroll::-webkit-scrollbar-thumb {
  background: var(--atlas-accent-ring);
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .result-page,
  .result-panel--from-left,
  .result-panel--from-right {
    animation: none;
  }

  .sentence-container,
  .hover-lift,
  .score-fill {
    transition: none;
  }
}
</style>
