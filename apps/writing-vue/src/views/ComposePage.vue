<template>
  <div class="compose-page">
    <div v-if="showDraftNotification" class="draft-notification card">
      <div class="notification-content">
        <div class="notification-icon">💾</div>
        <div class="notification-text">
          <strong>检测到未保存的草稿</strong>
          <p>要恢复上次编辑的内容吗?</p>
        </div>
      </div>
      <div class="notification-actions">
        <button class="btn btn-secondary" @click="handleDiscardDraft">
          放弃
        </button>
        <button class="btn btn-primary" @click="handleRecoverDraft">
          恢复草稿
        </button>
      </div>
    </div>

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

      <div class="mode-section">
        <span class="section-label">写作模式</span>
        <div class="mode-toggle">
          <button
            :class="['mode-btn', { active: topicMode === 'free' }]"
            @click="topicMode = 'free'"
          >
            自由写作
          </button>
          <button
            :class="['mode-btn', { active: topicMode === 'bank' }]"
            @click="topicMode = 'bank'"
          >
            从题库选择
          </button>
        </div>
      </div>

      <div v-if="topicMode === 'free'" class="topic-bank card-subsection">
        <div class="field">
          <label for="custom-topic-text">{{ customTopicLabel }}</label>
          <textarea
            id="custom-topic-text"
            v-model="customTopicText"
            class="textarea topic-input"
            :placeholder="customTopicPlaceholder"
            rows="4"
          ></textarea>
        </div>
        <p class="topic-status">
          评分会结合题目要求判断 {{ taskType === 'task1' ? 'Task Achievement' : 'Task Response' }}，不填题目就是瞎判。
        </p>
      </div>

      <div v-if="topicMode === 'bank'" class="topic-bank card-subsection">
        <div class="topic-toolbar">
          <div class="field">
            <label for="topic-category">分类</label>
            <select id="topic-category" v-model="selectedCategory" class="select">
              <option value="">全部分类</option>
              <option
                v-for="option in categoryOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>

          <div class="field field-grow">
            <label for="topic-select">题目</label>
            <select
              id="topic-select"
              :value="selectedTopicId === null ? '' : String(selectedTopicId)"
              class="select"
              :disabled="topicLoading || topicsList.length === 0"
              @change="handleTopicChange"
            >
              <option value="">请选择题目</option>
              <option
                v-for="topic in topicsList"
                :key="topic.id"
                :value="String(topic.id)"
              >
                {{ getTopicOptionLabel(topic) }}
              </option>
            </select>
          </div>
        </div>

        <p v-if="topicLoading" class="topic-status">正在加载题库...</p>
        <p v-else-if="topicError" class="topic-status topic-status-error">{{ topicError }}</p>
        <p v-else-if="topicsList.length === 0" class="topic-status">
          当前条件下没有题目，换个分类试试。
        </p>
        <p v-else-if="selectedTopicId === null" class="topic-status">
          请选择题目后再提交评分。
        </p>

        <div v-if="selectedTopicText" class="topic-preview">
          <div class="topic-preview-header">
            <span class="section-label">当前题目</span>
            <span class="topic-meta">
              {{ currentTopicLabel }}
            </span>
          </div>
          <p>{{ selectedTopicText }}</p>
        </div>
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
      <div v-else-if="restoreNotice" class="restore-notice">
        {{ restoreNotice }}
      </div>
    </div>

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
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { evaluate, getErrorMessage, topics as topicsApi } from '@/api/client.js'
import { useDraft } from '@/composables/useDraft.js'

const router = useRouter()

const TASK2_CATEGORIES = [
  { value: 'education', label: '教育' },
  { value: 'technology', label: '科技' },
  { value: 'society', label: '社会' },
  { value: 'environment', label: '环境' },
  { value: 'health', label: '健康' },
  { value: 'culture', label: '文化' },
  { value: 'government', label: '政府' },
  { value: 'economy', label: '经济' }
]

const TASK1_CATEGORIES = [
  { value: 'bar_chart', label: '柱状图' },
  { value: 'pie_chart', label: '饼图' },
  { value: 'line_chart', label: '折线图' },
  { value: 'flow_chart', label: '流程图' },
  { value: 'map', label: '地图' },
  { value: 'table', label: '表格' },
  { value: 'process', label: '过程' },
  { value: 'mixed', label: '混合图' }
]

const taskType = ref('task2')
const topicMode = ref('free')
const selectedCategory = ref('')
const selectedTopicId = ref(null)
const topicsList = ref([])
const topicLoading = ref(false)
const topicError = ref('')
const customTopicText = ref('')
const content = ref('')
const isSubmitting = ref(false)
const error = ref('')
const restoreNotice = ref('')
const showConfirmDialog = ref(false)
const showDraftNotification = ref(false)
const isRestoringDraft = ref(false)
let topicsRequestSequence = 0

function invalidateTopicRequests() {
  topicsRequestSequence += 1
  topicLoading.value = false
  topicsList.value = []
}

const {
  scheduleSave,
  loadDraft,
  clearDraft,
  hasDraft,
  stopAutoSave
} = useDraft('compose-essay', () => ({
  task_type: taskType.value,
  topic_mode: topicMode.value,
  topic_id: topicMode.value === 'bank' ? selectedTopicId.value : null,
  topic_text: topicMode.value === 'free' ? customTopicText.value : selectedTopicText.value,
  category: selectedCategory.value,
  content: content.value,
  word_count: wordCount.value
}))

const categoryOptions = computed(() => (
  taskType.value === 'task1' ? TASK1_CATEGORIES : TASK2_CATEGORIES
))

function normalizeCategory(type = taskType.value, category = selectedCategory.value) {
  const options = type === 'task1' ? TASK1_CATEGORIES : TASK2_CATEGORIES
  return options.some((item) => item.value === category) ? category : ''
}

const selectedTopic = computed(() => (
  topicsList.value.find((topic) => topic.id === selectedTopicId.value) || null
))

const selectedTopicText = computed(() => (
  selectedTopic.value ? extractTextFromTiptap(selectedTopic.value.title_json) : ''
))

const currentTopicLabel = computed(() => {
  if (!selectedTopic.value) return ''
  const option = categoryOptions.value.find((item) => item.value === selectedTopic.value.category)
  return option ? option.label : selectedTopic.value.category
})

const customTopicLabel = computed(() => (
  taskType.value === 'task1' ? '图表题目或图示说明' : '写作题目'
))

const wordCount = computed(() => {
  const text = content.value.trim()
  if (!text) return 0
  return text.split(/\s+/).filter((word) => word.length > 0).length
})

const minWordCount = computed(() => taskType.value === 'task1' ? 150 : 250)
const targetWordCount = computed(() => taskType.value === 'task1' ? 180 : 280)
const isWordCountLow = computed(() => wordCount.value < minWordCount.value)

const placeholder = computed(() => {
  if (topicMode.value === 'bank' && selectedTopicText.value) {
    return `当前题目：\n${selectedTopicText.value}\n\n请在这里写作...`
  }

  return taskType.value === 'task1'
    ? '请输入您的 Task 1 作文...\n\n描述图表中的主要特征和趋势...'
    : '请输入您的 Task 2 作文...\n\n介绍您的观点和论据...'
})

const customTopicPlaceholder = computed(() => (
  taskType.value === 'task1'
    ? '请输入 Task 1 图表题目或图示说明，例如：The chart below shows...'
    : '请输入 Task 2 写作题目，例如：Some people think... To what extent do you agree or disagree?'
))

function getSubmitBlockReason() {
  if (content.value.trim().length === 0) {
    return '请先输入作文内容'
  }

  if (topicMode.value === 'free') {
    return customTopicText.value.trim().length > 0
      ? ''
      : '自由写作模式下必须先输入题目'
  }

  if (topicLoading.value) {
    return '题库还在加载中，请稍候再提交'
  }

  if (topicError.value) {
    return topicError.value || '题库加载失败，请稍后重试'
  }

  if (selectedTopicId.value === null) {
    return '题库模式下必须先选择题目'
  }

  if (!selectedTopic.value) {
    return '当前题目无效，请重新选择题目'
  }

  return ''
}

const canSubmit = computed(() => (
  !isSubmitting.value &&
  !getSubmitBlockReason()
))

onMounted(() => {
  if (hasDraft()) {
    showDraftNotification.value = true
  }
})

watch([taskType, topicMode, selectedCategory], async ([nextTaskType, nextMode], [prevTaskType, prevMode, prevCategory]) => {
  if (isRestoringDraft.value) return
  restoreNotice.value = ''

  if (
    nextTaskType !== prevTaskType ||
    nextMode !== prevMode ||
    selectedCategory.value !== prevCategory
  ) {
    selectedTopicId.value = null
  }

  const normalizedCategory = normalizeCategory(nextTaskType, selectedCategory.value)
  if (normalizedCategory !== selectedCategory.value) {
    selectedCategory.value = normalizedCategory
  }

  if (nextMode === 'bank') {
    await loadTopics(nextTaskType)
  } else {
    invalidateTopicRequests()
    topicError.value = ''
  }

  scheduleSave()
})

watch([content, selectedTopicId], () => {
  if (isRestoringDraft.value) return
  restoreNotice.value = ''
  scheduleSave()
})

watch(customTopicText, () => {
  if (isRestoringDraft.value) return
  restoreNotice.value = ''
  scheduleSave()
})

async function loadTopics(type = taskType.value) {
  const requestId = ++topicsRequestSequence
  const category = selectedCategory.value

  topicLoading.value = true
  topicError.value = ''
  topicsList.value = []

  try {
    const filters = { type }
    if (category) {
      filters.category = category
    }

    const result = await topicsApi.list(filters, { page: 1, limit: 500 })
    if (requestId !== topicsRequestSequence) {
      return
    }

    topicsList.value = Array.isArray(result.data) ? result.data : []

    const selectedStillExists = topicsList.value.some((topic) => topic.id === selectedTopicId.value)
    if (!selectedStillExists) {
      selectedTopicId.value = null
    }
  } catch (loadError) {
    if (requestId !== topicsRequestSequence) {
      return
    }
    console.error('加载题库失败:', loadError)
    topicError.value = loadError?.message
      ? `题库加载失败：${loadError.message}`
      : '题库加载失败，请稍后重试'
    topicsList.value = []
    selectedTopicId.value = null
  } finally {
    if (requestId === topicsRequestSequence) {
      topicLoading.value = false
    }
  }
}

async function handleRecoverDraft() {
  const draft = loadDraft()
  if (!draft) {
    showDraftNotification.value = false
    return
  }

  isRestoringDraft.value = true
  taskType.value = draft.task_type || 'task2'
  topicMode.value = draft.topic_mode || 'free'
  selectedCategory.value = normalizeCategory(draft.task_type || 'task2', draft.category || '')
  customTopicText.value = draft.topic_text || ''
  content.value = draft.content || ''
  selectedTopicId.value = draft.topic_id || null

  if (draft.topic_mode === 'bank') {
    await loadTopics(draft.task_type || 'task2')
    if (draft.topic_id !== null && selectedTopicId.value === null) {
      topicMode.value = 'free'
      selectedCategory.value = ''
      customTopicText.value = draft.topic_text || ''
      restoreNotice.value = draft.topic_text
        ? '草稿关联的题库题目已失效，已切换为自由写作并保留题目文本。'
        : '草稿关联的题库题目已失效，请重新输入题目或重新选题。'
    }
  }

  await nextTick()
  isRestoringDraft.value = false
  showDraftNotification.value = false
  scheduleSave()
}

function handleDiscardDraft() {
  clearDraft()
  showDraftNotification.value = false
  restoreNotice.value = ''
}

function handleTopicChange(event) {
  const value = event.target.value
  selectedTopicId.value = value ? Number(value) : null
  restoreNotice.value = ''
}

function getTopicOptionLabel(topic) {
  const text = extractTextFromTiptap(topic.title_json)
  return text.length > 90 ? `${text.slice(0, 90)}...` : text
}

function extractTextFromTiptap(json) {
  if (typeof json === 'string') {
    try {
      return extractTextFromTiptap(JSON.parse(json))
    } catch {
      return json
    }
  }

  if (!json || typeof json !== 'object') return ''
  if (json.type === 'text') return json.text || ''
  if (Array.isArray(json.content)) {
    return json.content.map((item) => extractTextFromTiptap(item)).join('')
  }
  return ''
}

async function handleSubmit() {
  if (!canSubmit.value) return

  const submitBlockReason = getSubmitBlockReason()
  if (submitBlockReason) {
    error.value = submitBlockReason
    return
  }

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
  if (isSubmitting.value) return

  const bankTopicId = topicMode.value === 'bank' ? (selectedTopic.value?.id ?? null) : null
  if (topicMode.value === 'bank' && bankTopicId === null) {
    error.value = '当前题目无效，请重新选择题目'
    return
  }

  isSubmitting.value = true
  error.value = ''
  restoreNotice.value = ''

  try {
    const result = await evaluate.start({
      task_type: taskType.value,
      topic_id: bankTopicId,
      topic_text: topicMode.value === 'free' ? customTopicText.value.trim() : null,
      content: content.value.trim(),
      word_count: wordCount.value
    })

    clearDraft()
    stopAutoSave()

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

.draft-notification {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  margin-bottom: 20px;
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.notification-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.notification-icon {
  font-size: 28px;
}

.notification-text strong {
  display: block;
  margin-bottom: 4px;
}

.notification-text p {
  margin: 0;
  opacity: 0.9;
}

.notification-actions {
  display: flex;
  gap: 10px;
}

.compose-container {
  padding: 28px;
}

.compose-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.compose-header h2 {
  margin: 0;
}

.task-type-selector,
.mode-toggle {
  display: inline-flex;
  gap: 8px;
}

.task-btn,
.mode-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.task-btn.active,
.mode-btn.active {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.task-info {
  margin-bottom: 18px;
  color: var(--text-secondary);
}

.task-info p {
  margin: 0;
}

.mode-section {
  margin-bottom: 18px;
}

.section-label {
  display: inline-block;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.card-subsection {
  margin-bottom: 18px;
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
}

.topic-toolbar {
  display: flex;
  gap: 14px;
  align-items: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 160px;
}

.field-grow {
  flex: 1;
}

.field label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.select,
.textarea {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px 14px;
  background: white;
  color: var(--text-primary);
  box-sizing: border-box;
}

.topic-status {
  margin: 12px 0 0;
  color: var(--text-secondary);
}

.topic-input {
  min-height: 120px;
  resize: vertical;
  line-height: 1.6;
}

.topic-status-error {
  color: #c2410c;
}

.topic-preview {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
}

.topic-preview-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.topic-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.topic-preview p {
  margin: 8px 0 0;
  white-space: pre-wrap;
  line-height: 1.6;
}

.editor-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.essay-input {
  min-height: 340px;
  resize: vertical;
  line-height: 1.7;
}

.editor-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.word-count {
  color: var(--text-secondary);
}

.word-count.warning {
  color: #dc2626;
}

.submit-btn {
  min-width: 120px;
}

.error-message {
  margin-top: 16px;
  color: #dc2626;
}

.restore-notice {
  margin-top: 16px;
  color: #9a3412;
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 20;
}

.dialog {
  max-width: 420px;
  width: 100%;
  padding: 24px;
}

.dialog h3 {
  margin-top: 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

@media (max-width: 720px) {
  .compose-header,
  .topic-toolbar,
  .editor-footer,
  .notification-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .task-type-selector,
  .mode-toggle {
    width: 100%;
  }

  .task-btn,
  .mode-btn {
    flex: 1;
  }

  .topic-preview-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
