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
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { evaluate, getErrorMessage } from '@/api/client.js'

const props = defineProps({
  sessionId: {
    type: String,
    required: true
  }
})

const router = useRouter()
const route = useRoute()

const progress = ref(0)
const statusMessage = ref('正在准备评测...')
const scoreData = ref(null)
const sentences = ref([])
const feedback = ref('')
const error = ref(null)

// 存储完整结果用于传递到结果页
const fullResult = ref({
  sessionId: props.sessionId,
  score: null,
  sentences: [],
  feedback: ''
})

onMounted(() => {
  // 订阅评测事件
  evaluate.onEvent(handleEvent)
})

onUnmounted(() => {
  // 移除事件监听
  evaluate.removeEventListener()
})

function handleEvent(event) {
  // 只处理当前会话的事件
  if (event.sessionId !== props.sessionId) return

  switch (event.type) {
    case 'progress':
      progress.value = event.data.percent
      statusMessage.value = event.data.message
      break

    case 'score':
      scoreData.value = event.data
      fullResult.value.score = event.data
      break

    case 'sentence':
      sentences.value.push(event.data)
      fullResult.value.sentences.push(event.data)
      break

    case 'feedback':
      feedback.value = event.data
      fullResult.value.feedback = event.data
      break

    case 'complete':
      progress.value = 100
      statusMessage.value = '评分完成！'
      // 【临时方案】存储结果到 sessionStorage 供结果页使用
      // Phase 4+ 应改为 DB 持久层存储（同步 evaluation_records 表）
      sessionStorage.setItem(
        `evaluation_${props.sessionId}`,
        JSON.stringify(fullResult.value)
      )
      // 跳转到结果页
      setTimeout(() => {
        router.push({
          name: 'Result',
          params: { sessionId: props.sessionId }
        })
      }, 500)
      break

    case 'error':
      // 【错误展示优先级】优先使用 message，回退到 code 映射
      error.value = {
        code: event.data.code,
        message: event.data.message || getErrorMessage(event.data.code)
      }
      break
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
