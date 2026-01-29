<template>
  <div class="compose-page">
    <div class="compose-container card">
      <div class="compose-header">
        <h2>作文输入</h2>
        <div class="task-type-selector">
          <button 
            :class="['task-btn', { active: taskType === 'task1' }]"
            @click="taskType = 'task1'"
          >
            Task 1
          </button>
          <button 
            :class="['task-btn', { active: taskType === 'task2' }]"
            @click="taskType = 'task2'"
          >
            Task 2
          </button>
        </div>
      </div>

      <div class="task-info">
        <p v-if="taskType === 'task1'">
          📊 Task 1：图表描述题，建议 150-180 词
        </p>
        <p v-else>
          📝 Task 2：议论文，建议 250-280 词
        </p>
      </div>

      <div class="editor-section">
        <textarea 
          v-model="content"
          class="textarea essay-input"
          :placeholder="placeholder"
          rows="15"
        ></textarea>
        
        <div class="editor-footer">
          <div :class="['word-count', { warning: isWordCountLow }]">
            字数：{{ wordCount }} / {{ targetWordCount }}
          </div>
          <button 
            class="btn btn-primary submit-btn"
            :disabled="!canSubmit"
            @click="handleSubmit"
          >
            {{ isSubmitting ? '提交中...' : '提交评分' }}
          </button>
        </div>
      </div>

      <div v-if="error" class="error-message">
        ⚠️ {{ error }}
      </div>
    </div>

    <!-- 字数不足确认弹窗 -->
    <div v-if="showConfirmDialog" class="dialog-overlay">
      <div class="dialog card">
        <h3>字数不足提醒</h3>
        <p>
          作文字数不足，建议至少达到 <strong>{{ minWordCount }}</strong> 词后再提交评分。
          <br>当前字数：<strong>{{ wordCount }}</strong> 词
        </p>
        <p>是否仍要继续？</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="showConfirmDialog = false">
            取消
          </button>
          <button class="btn btn-primary" @click="confirmSubmit">
            继续提交
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { evaluate, getErrorMessage } from '@/api/client.js'

const router = useRouter()

const taskType = ref('task2')
const content = ref('')
const isSubmitting = ref(false)
const error = ref('')
const showConfirmDialog = ref(false)

// 计算属性
const wordCount = computed(() => {
  const text = content.value.trim()
  if (!text) return 0
  return text.split(/\s+/).filter(w => w.length > 0).length
})

const minWordCount = computed(() => taskType.value === 'task1' ? 150 : 250)
const targetWordCount = computed(() => taskType.value === 'task1' ? 180 : 280)

const isWordCountLow = computed(() => wordCount.value < minWordCount.value)

const placeholder = computed(() => 
  taskType.value === 'task1' 
    ? '请输入您的 Task 1 作文...\n\n描述图表中的主要特征和趋势...'
    : '请输入您的 Task 2 作文...\n\n介绍您的观点和论据...'
)

const canSubmit = computed(() => {
  return content.value.trim().length > 0 && !isSubmitting.value
})

// 提交处理
async function handleSubmit() {
  if (!canSubmit.value) return
  
  // 字数不足时显示确认弹窗
  if (isWordCountLow.value) {
    showConfirmDialog.value = true
    return
  }
  
  await submitEssay()
}

async function confirmSubmit() {
  showConfirmDialog.value = false
  await submitEssay()
}

async function submitEssay() {
  isSubmitting.value = true
  error.value = ''
  
  try {
    const result = await evaluate.start({
      task_type: taskType.value,
      topic_id: null, // 自由写作模式
      content: content.value.trim(),
      word_count: wordCount.value
    })
    
    // 跳转到评测进度页
    router.push({
      name: 'Evaluating',
      params: { sessionId: result.sessionId }
    })
  } catch (err) {
    console.error('提交失败:', err)
    error.value = getErrorMessage(err.code)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
.compose-page {
  max-width: 900px;
  margin: 0 auto;
}

.compose-container {
  background: white;
}

.compose-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.compose-header h2 {
  font-size: 24px;
  color: var(--text-primary);
}

.task-type-selector {
  display: flex;
  gap: 8px;
}

.task-btn {
  padding: 8px 20px;
  font-size: 14px;
  font-weight: 600;
  border: 2px solid var(--primary-color);
  background: transparent;
  color: var(--primary-color);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.task-btn.active {
  background: var(--primary-color);
  color: white;
}

.task-btn:hover:not(.active) {
  background: rgba(102, 126, 234, 0.1);
}

.task-info {
  background: var(--bg-light);
  padding: 12px 16px;
  border-radius: var(--border-radius);
  margin-bottom: 16px;
}

.task-info p {
  margin: 0;
  color: var(--text-secondary);
}

.editor-section {
  margin-bottom: 16px;
}

.essay-input {
  min-height: 350px;
  font-size: 16px;
}

.editor-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

.word-count {
  font-size: 14px;
  color: var(--text-muted);
}

.word-count.warning {
  color: var(--warning-color);
  font-weight: 600;
}

.submit-btn {
  min-width: 140px;
}

.error-message {
  background: rgba(245, 108, 108, 0.1);
  color: var(--danger-color);
  padding: 12px 16px;
  border-radius: var(--border-radius);
}

/* 弹窗样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  max-width: 400px;
  width: 90%;
  padding: 24px;
}

.dialog h3 {
  margin-bottom: 12px;
  color: var(--text-primary);
}

.dialog p {
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

.dialog-actions .btn {
  padding: 10px 20px;
}
</style>
