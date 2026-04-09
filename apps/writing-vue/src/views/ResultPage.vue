<template>
  <div class="result-page">
    <div class="result-layout">
      <!-- Left Column: Essay & Annotated Errors -->
      <section class="essay-panel card card-whisper" style="animation: slideFromLeft 0.6s ease-out;">
        <header class="essay-head border-base">
          <div>
            <h1 class="heading-serif display-heading">Feedback &amp; Results</h1>
            <p class="topic-meta">IELTS Writing Evaluation</p>
          </div>
          <span class="word-badge">{{ essayWordCount }} Words</span>
        </header>

        <div v-if="topicText" class="glass-card mb-4 p-4">
          <h3 class="flex-align text-sm font-bold text-primary mb-2">
            <span class="material-symbols-outlined mr-2">menu_book</span>
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
               
               <span class="sentence-container"
                     :class="{'has-error': sentence.errors?.length > 0}"
                     @click="sentence.errors?.length > 0 ? toggleExpand(index) : null"
               >
                 <span v-html="highlightErrors(sentence)"></span>
               </span>

               <component :is="'div'" v-if="sentence.errors?.length > 0 && expandedSentences.has(index)" class="error-details glass-card shadow-elevated mb-3 mt-1">
                 <div v-for="(err, errIdx) in sentence.errors" :key="errIdx" class="error-item border-base-light pb-2 mb-2 last-no-border">
                    <div class="error-type mb-1" :class="'text-' + err.type.replace('_', '-')">
                      <span class="material-symbols-outlined mr-1" style="font-size: 14px;">error</span>
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
               </component>
               
             </template>
           </div>
           <div v-else class="text-secondary italic">
              {{ sentenceEmptyHint }}
           </div>
        </div>
      </section>

      <!-- Right Column: Sidebar Analysis -->
      <aside class="right-panel custom-scroll" style="animation: slideFromRight 0.6s ease-out; flex: 0.8 !important;">
        
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
              <span class="material-symbols-outlined mr-2">warning</span>
              Analysis Degraded
          </h4>
          <p class="text-xs">{{ sentenceEmptyHint }}</p>
        </div>

        <!-- Metrics Grid -->
        <div class="metrics-grid mb-4">
          <div class="metric-card glass-card hover-lift p-4">
            <span class="material-symbols-outlined text-primary mb-2">assignment_turned_in</span>
            <div class="metric-label">Task Response</div>
            <div class="metric-value">{{ scoreData?.task_achievement ?? '-' }}</div>
          </div>
          <div class="metric-card glass-card hover-lift p-4">
            <span class="material-symbols-outlined text-primary mb-2">account_tree</span>
            <div class="metric-label">Coherence</div>
            <div class="metric-value">{{ scoreData?.coherence_cohesion ?? '-' }}</div>
          </div>
          <div class="metric-card glass-card hover-lift p-4">
            <span class="material-symbols-outlined text-primary mb-2">menu_book</span>
            <div class="metric-label">Lexical Resource</div>
            <div class="metric-value">{{ scoreData?.lexical_resource ?? '-' }}</div>
          </div>
          <div class="metric-card glass-card hover-lift p-4">
            <span class="material-symbols-outlined text-primary mb-2">spellcheck</span>
            <div class="metric-label">Grammar</div>
            <div class="metric-value">{{ scoreData?.grammatical_range ?? '-' }}</div>
          </div>
        </div>

        <div v-if="feedback" class="glass-card mb-4">
          <h3 class="font-bold flex-align mb-3 text-sm">
            <span class="material-symbols-outlined text-primary mr-2">lightbulb</span>
            整体改进建议
          </h3>
          <p class="text-sm text-secondary leading-relaxed">{{ feedback }}</p>
        </div>

        <div v-if="improvementPlan && improvementPlan.length > 0" class="glass-card mb-4">
          <h3 class="font-bold flex-align mb-3 text-sm">
              <span class="material-symbols-outlined text-primary mr-2">build</span>
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
            <span class="material-symbols-outlined text-primary mr-2">segment</span>
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
              <span class="material-symbols-outlined text-primary mr-2">analytics</span>
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
              <span class="material-symbols-outlined text-primary mr-2">query_stats</span>
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
  animation: fade-in 0.3s ease-out;
}

.result-layout {
  display: flex;
  gap: 24px;
  max-width: 1600px;
  margin: 0 auto;
  height: calc(100vh - 120px);
}

.glass-card {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 16px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.03);
  padding: 24px;
}
.shadow-elevated {
  box-shadow: 0 10px 30px rgba(0,0,0,0.1);
}

.essay-panel {
  flex: 1.2;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.right-panel {
  flex: 0.8 !important;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding-right: 12px;
}

.border-base {
  border-bottom: 1px solid var(--color-border-warm);
  padding-bottom: 20px;
  margin-bottom: 24px;
}

.border-base-light {
  border-bottom: 1px dashed var(--color-border-warm);
}
.border-top-dashed {
  border-top: 1px dashed var(--color-border-warm);
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
  color: var(--text-primary);
  margin-bottom: 6px;
}

.topic-meta {
  color: var(--text-secondary);
  font-style: italic;
  font-size: 0.95rem;
  line-height: 1.5;
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
  white-space: pre-wrap;
  line-height: 2;
  color: var(--text-primary);
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
  transition: all 0.2s;
}

.has-error {
  cursor: pointer;
  border-bottom: 2px dashed var(--color-error);
}

.has-error:hover {
  background: rgba(181, 51, 51, 0.05); /* very light error red */
}

.error-details {
  display: block;   /* Important: inline to block transition inside text loop */
  padding: 16px;
  margin-left: 0;
  margin-right: 0;
}

.label {
  font-size: 0.8rem;
  color: var(--text-secondary);
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

.text-primary { color: var(--color-terracotta); }
.text-secondary { color: var(--color-olive-gray); }
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
  filter: drop-shadow(0 4px 6px rgba(0,0,0,0.05));
}

.score-bg {
  fill: transparent;
  stroke: var(--color-border-warm);
  stroke-width: 14;
}

.score-fill {
  fill: transparent;
  stroke: var(--color-terracotta);
  stroke-width: 14;
  stroke-linecap: round;
  stroke-dasharray: 502;
  transition: stroke-dashoffset 1s ease-out;
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
  color: var(--text-primary);
  line-height: 1;
}

.score-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 0.1em;
  margin-top: 4px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.metric-card {
  display: flex;
  flex-direction: column;
}

.metric-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  font-weight: 600;
  margin-top: 4px;
}

.metric-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--text-primary);
}

.hover-lift {
  transition: transform 0.2s;
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
  background: var(--color-terracotta);
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
  background: rgba(181, 51, 51, 0.1);
  border: 1px solid rgba(181, 51, 51, 0.3);
  border-radius: 12px;
  padding: 16px;
  color: var(--color-error);
}

@keyframes slideFromRight {
  0% { transform: translateX(30px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@keyframes slideFromLeft {
  0% { transform: translateX(-30px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

/* Error highlights inside v-html */
:deep(.highlight-grammar) {
  background: rgba(181, 51, 51, 0.1);
  border-bottom: 2px solid var(--color-error);
}

:deep(.highlight-spelling) {
  background: rgba(201, 100, 66, 0.1);
  border-bottom: 2px solid var(--color-terracotta);
}

:deep(.highlight-word_choice) {
  background: rgba(56, 152, 236, 0.1);
  border-bottom: 2px solid var(--color-focus-blue);
}

:deep(.highlight-sentence_structure) {
  background: rgba(135, 134, 127, 0.15);
  border-bottom: 2px solid var(--color-stone-gray);
}

:deep(.highlight-coherence) {
  background: rgba(94, 93, 89, 0.15);
  border-bottom: 2px solid var(--color-olive-gray);
}

/* Custom Scroll for cards */
.custom-scroll::-webkit-scrollbar {
  width: 4px;
}
.custom-scroll::-webkit-scrollbar-thumb {
  background: var(--color-ring-warm);
  border-radius: 4px;
}
</style>
