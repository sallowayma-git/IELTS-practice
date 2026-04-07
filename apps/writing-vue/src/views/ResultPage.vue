<template>
  <div class="result-page">
    <div class="result-layout">
      <!-- 左侧：作文标注 -->
      <div class="left-panel card">
        <div class="panel-header">
          <h3>{{ viewMode === 'full' ? '作文原文' : `重点纠错（${sentences.length}句）` }}</h3>
          <div class="view-switcher">
            <button 
              :class="['view-btn', { active: viewMode === 'full' }]"
              @click="viewMode = 'full'"
            >
              全文
            </button>
            <button 
              :class="['view-btn', { active: viewMode === 'annotated' }]"
              @click="viewMode = 'annotated'"
            >
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
            <button class="btn-text" @click="expandAll">全部展开</button>
            <button class="btn-text" @click="collapseAll">全部折叠</button>
          </div>
          
          <div 
            v-for="(sentence, index) in sentences" 
            :key="index"
            class="sentence-block"
          >
            <div class="sentence-header">
              <span class="sentence-index">[{{ index + 1 }}]</span>
              <span 
                class="sentence-text"
                v-html="highlightErrors(sentence)"
              ></span>
              <button 
                v-if="sentence.errors && sentence.errors.length > 0"
                class="expand-btn"
                @click="toggleExpand(index)"
              >
                {{ expandedSentences.has(index) ? '收起' : '展开' }}
              </button>
            </div>
            
            <!-- 错误详情 -->
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
      </div>

      <!-- 右侧：评分详情 -->
      <div class="right-panel">
        <div v-if="topicText" class="topic-card card">
          <div class="topic-meta-row">
            <span class="topic-source">{{ topicSourceLabel }}</span>
            <span class="word-meta">字数 {{ essayWordCount || '-' }}</span>
          </div>
          <h4>题目要求</h4>
          <p class="topic-text">{{ topicText }}</p>
        </div>

        <!-- 总分 -->
        <div class="score-card card">
          <div class="total-score">
            <span class="score-value">{{ scoreData?.total_score ?? '-' }}</span>
            <span class="score-label">总分 Overall Band Score</span>
          </div>
        </div>

        <!-- 分项评分 -->
        <div class="breakdown-card card">
          <h4>分项评分</h4>
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
        </div>

        <div v-if="reviewDegraded" class="feedback-card card degraded-feedback-card">
          <h4>详解降级提示</h4>
          <p class="feedback-text">
            本次评测仅完成评分阶段，段落与句级详解未完整生成。建议稍后重试以获取完整详解。
          </p>
        </div>

        <!-- 整体建议 -->
        <div v-if="feedback" class="feedback-card card">
          <h4>整体改进建议</h4>
          <p class="feedback-text">{{ feedback }}</p>
        </div>

        <div v-if="reviewBlocks.length > 0" class="analysis-card card">
          <h4>段落详解</h4>
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
        </div>

        <div v-if="taskAnalysisEntries.length > 0" class="analysis-card card">
          <h4>任务诊断</h4>
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
        </div>

        <div v-if="bandRationaleEntries.length > 0" class="analysis-card card">
          <h4>评分理由</h4>
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
        </div>

        <div v-if="improvementPlan.length > 0" class="analysis-card card">
          <h4>提分计划</h4>
          <ul class="plan-list">
            <li v-for="(item, index) in improvementPlan" :key="`${index}-${item}`">
              {{ item }}
            </li>
          </ul>
        </div>

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <button class="btn btn-primary" @click="writeNew">
            📝 写新作文
          </button>
        </div>
      </div>
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
const expandedSentences = ref(new Set([0, 1, 2])) // 默认展开前3个

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

// 错误类型标签
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

  let text = sentence.original
  let result = ''
  let lastIndex = 0

  const sortedErrors = [...sentence.errors].sort((a, b) => {
    return a.range.start - b.range.start
  })

  for (const err of sortedErrors) {
    // 边界检查：防止越界
    const startPos = Math.max(0, Math.min(err.range.start, text.length))
    const endPos = Math.max(startPos, Math.min(err.range.end, text.length))
    
    // 添加错误前的普通文本
    if (startPos > lastIndex) {
      result += escapeHtml(text.substring(lastIndex, startPos))
    }
    
    // 添加高亮的错误词
    const errorWord = text.substring(startPos, endPos)
    const colorClass = `highlight-${err.type}`
    result += `<span class="${colorClass}" title="${escapeHtml(err.reason)}">${escapeHtml(errorWord)}</span>`
    
    lastIndex = endPos
  }

  // 添加剩余文本
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
  // 触发响应式更新
  expandedSentences.value = new Set(expandedSentences.value)
}

function expandAll() {
  expandedSentences.value = new Set(sentences.value.map((_, i) => i))
}

function collapseAll() {
  expandedSentences.value = new Set()
}

function writeNew() {
  // 清除存储的结果
  sessionStorage.removeItem(`evaluation_${props.sessionId}`)
  router.push({ name: 'Compose' })
}
</script>

<style scoped>
.result-page {
  padding: 0 20px;
}

.result-layout {
  display: grid;
  grid-template-columns: 60% 40%;
  gap: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.left-panel, .right-panel {
  max-height: calc(100vh - 140px);
  overflow-y: auto;
}

.left-panel {
  padding: 20px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-header h3 {
  font-size: 18px;
  color: var(--text-primary);
}

.view-switcher {
  display: flex;
  gap: 4px;
  background: var(--bg-light);
  padding: 4px;
  border-radius: 6px;
}

.view-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.view-btn.active {
  background: white;
  color: var(--primary-color);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.bulk-controls {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.btn-text {
  background: none;
  border: none;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 13px;
}

.btn-text:hover {
  text-decoration: underline;
}

.sentence-block {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.sentence-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.sentence-index {
  color: var(--text-muted);
  font-size: 13px;
  flex-shrink: 0;
}

.sentence-text {
  flex: 1;
  line-height: 1.8;
}

.expand-btn {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  background: white;
  border-radius: 4px;
  cursor: pointer;
}

/* 错误高亮颜色 */
:deep(.highlight-grammar) {
  background: rgba(245, 108, 108, 0.2);
  border-bottom: 2px solid var(--error-grammar);
  cursor: help;
}

:deep(.highlight-spelling) {
  background: rgba(230, 162, 60, 0.2);
  border-bottom: 2px solid var(--error-spelling);
  cursor: help;
}

:deep(.highlight-word_choice) {
  background: rgba(64, 158, 255, 0.2);
  border-bottom: 2px solid var(--error-word-choice);
  cursor: help;
}

:deep(.highlight-sentence_structure) {
  background: rgba(156, 39, 176, 0.2);
  border-bottom: 2px solid var(--error-sentence-structure);
  cursor: help;
}

:deep(.highlight-coherence) {
  background: rgba(103, 194, 58, 0.2);
  border-bottom: 2px solid var(--error-coherence);
  cursor: help;
}

.error-details {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.error-item {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.error-type {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  font-weight: 600;
  color: white;
}

.error-grammar { background: var(--error-grammar); }
.error-spelling { background: var(--error-spelling); }
.error-word_choice { background: var(--error-word-choice); }
.error-sentence_structure { background: var(--error-sentence-structure); }
.error-coherence { background: var(--error-coherence); }

.error-content {
  flex: 1;
}

.error-word {
  font-weight: 600;
  margin-bottom: 4px;
}

.error-reason {
  color: var(--text-secondary);
  font-size: 14px;
  margin-bottom: 4px;
}

.error-correction {
  font-size: 14px;
}

.corrected-sentence {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color);
  font-size: 14px;
  color: var(--success-color);
}

.original-view {
  line-height: 2;
}

.essay-view {
  min-height: 320px;
}

.essay-text {
  background: var(--bg-light);
  padding: 16px;
  border-radius: var(--border-radius);
  line-height: 1.9;
  white-space: pre-wrap;
}

.empty-hint {
  margin: 0;
  padding: 16px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
  color: var(--text-secondary);
}

/* 右侧面板 */
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.topic-card {
  background: linear-gradient(180deg, rgba(102, 126, 234, 0.08), rgba(102, 126, 234, 0.02));
}

.topic-meta-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.topic-source,
.word-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.topic-card h4,
.analysis-card h4 {
  font-size: 16px;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.topic-text {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.8;
  white-space: pre-wrap;
}

.score-card {
  text-align: center;
  padding: 32px;
}

.total-score .score-value {
  display: block;
  font-size: 64px;
  font-weight: 700;
  color: var(--primary-color);
}

.total-score .score-label {
  display: block;
  font-size: 14px;
  color: var(--text-muted);
  margin-top: 8px;
}

.breakdown-card h4,
.feedback-card h4 {
  font-size: 16px;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.score-breakdown {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.breakdown-item {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.breakdown-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.breakdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.breakdown-name {
  font-weight: 600;
  color: var(--text-primary);
}

.breakdown-score {
  font-size: 24px;
  font-weight: 700;
  color: var(--primary-color);
}

.breakdown-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}

.feedback-card {
  background: var(--bg-light);
}

.degraded-feedback-card {
  border: 1px solid rgba(194, 65, 12, 0.25);
  background: rgba(255, 237, 213, 0.55);
}

.feedback-text {
  color: var(--text-secondary);
  line-height: 1.8;
  white-space: pre-wrap;
}

.analysis-grid,
.rationale-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.analysis-item,
.rationale-item {
  padding: 12px 14px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.analysis-label {
  display: inline-block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.analysis-item p,
.rationale-item p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.plan-list {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
}

.plan-list li {
  line-height: 1.8;
  margin-bottom: 8px;
}

.action-buttons {
  display: flex;
  gap: 12px;
}

.action-buttons .btn {
  flex: 1;
}

@media (max-width: 900px) {
  .result-layout {
    grid-template-columns: 1fr;
  }
  
  .left-panel, .right-panel {
    max-height: none;
  }
}
</style>
