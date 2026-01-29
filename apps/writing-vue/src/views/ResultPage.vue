<template>
  <div class="result-page">
    <div class="result-layout">
      <!-- 左侧：作文标注 -->
      <div class="left-panel card">
        <div class="panel-header">
          <h3>作文标注</h3>
          <div class="view-switcher">
            <button 
              :class="['view-btn', { active: viewMode === 'annotated' }]"
              @click="viewMode = 'annotated'"
            >
              标注视图
            </button>
            <button 
              :class="['view-btn', { active: viewMode === 'original' }]"
              @click="viewMode = 'original'"
            >
              原文视图
            </button>
          </div>
        </div>

        <!-- 标注视图 -->
        <div v-if="viewMode === 'annotated'" class="annotated-view">
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

        <!-- 原文视图 -->
        <div v-else class="original-view">
          <p v-for="(sentence, index) in sentences" :key="index" class="original-sentence">
            {{ sentence.original }}
          </p>
        </div>
      </div>

      <!-- 右侧：评分详情 -->
      <div class="right-panel">
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

        <!-- 整体建议 -->
        <div v-if="feedback" class="feedback-card card">
          <h4>整体改进建议</h4>
          <p class="feedback-text">{{ feedback }}</p>
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
import { useRouter } from 'vue-router'

const props = defineProps({
  sessionId: {
    type: String,
    required: true
  }
})

const router = useRouter()

const viewMode = ref('annotated')
const expandedSentences = ref(new Set([0, 1, 2])) // 默认展开前3个

const scoreData = ref(null)
const sentences = ref([])
const feedback = ref('')

// 错误类型标签
const ERROR_TYPE_LABELS = {
  grammar: '语法错误',
  spelling: '拼写错误',
  word_choice: '用词不当',
  sentence_structure: '句式问题',
  coherence: '逻辑连贯'
}

onMounted(() => {
  // 从 sessionStorage 读取评测结果
  const stored = sessionStorage.getItem(`evaluation_${props.sessionId}`)
  if (stored) {
    const data = JSON.parse(stored)
    scoreData.value = data.score
    sentences.value = data.sentences || []
    feedback.value = data.feedback || ''
  }
})

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

  // 按位置排序错误
  const sortedErrors = [...sentence.errors].sort((a, b) => a.start_pos - b.start_pos)

  for (const err of sortedErrors) {
    // 添加错误前的普通文本
    if (err.start_pos > lastIndex) {
      result += escapeHtml(text.substring(lastIndex, err.start_pos))
    }
    
    // 添加高亮的错误词
    const errorWord = text.substring(err.start_pos, err.end_pos)
    const colorClass = `highlight-${err.type}`
    result += `<span class="${colorClass}" title="${escapeHtml(err.reason)}">${escapeHtml(errorWord)}</span>`
    
    lastIndex = err.end_pos
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

.original-sentence {
  margin-bottom: 8px;
}

/* 右侧面板 */
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.feedback-text {
  color: var(--text-secondary);
  line-height: 1.8;
  white-space: pre-wrap;
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
