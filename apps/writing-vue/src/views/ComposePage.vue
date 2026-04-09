<template>
  <div class="compose-page">
    <section v-if="showDraftNotification" class="draft-banner draft-notification card card-whisper">
      <div class="draft-banner__copy">
        <span class="panel-label">Draft Recovery</span>
        <strong>检测到未保存的草稿</strong>
        <p>可以直接恢复继续写，也可以丢弃后从空白工作台开始。</p>
      </div>
      <div class="draft-banner__actions">
        <button class="btn btn-secondary btn-warm-sand" @click="handleDiscardDraft">
          放弃
        </button>
        <button class="btn btn-primary btn-warm-sand" @click="handleRecoverDraft">
          恢复草稿
        </button>
      </div>
    </section>

    <div class="practice-shell">
      <aside class="practice-left card card-whisper">
        <header class="compose-hero">
          <div class="compose-hero__copy">
            <span class="hero-chip">Writing Task {{ taskType === 'task1' ? '1' : '2' }}</span>
            <h1 class="heading-serif">Immersive Writing Practice</h1>
          </div>

          <div class="compose-hero__metrics">
            <div class="hero-metric">
              <span class="hero-metric__label">建议字数</span>
              <strong>{{ minWordCount }} - {{ targetWordCount }}</strong>
            </div>
            <div class="hero-metric">
              <span class="hero-metric__label">题目来源</span>
              <strong>{{ topicMode === 'free' ? '自由写作' : '题库选题' }}</strong>
            </div>
            <div class="hero-metric">
              <span class="hero-metric__label">当前字数</span>
              <strong>{{ wordCount }}</strong>
            </div>
          </div>
        </header>

        <section class="compose-config-top">
          <div class="config-toolbar">
            <div class="config-section">
              <span class="config-label">任务分配</span>
              <div class="toggle-group toggle-group--compact">
                <button
                  :class="['toggle-item', 'task-btn', { active: taskType === 'task1' }]"
                  @click="taskType = 'task1'"
                >
                  <span class="toggle-item__label">Task 1</span>
                </button>
                <button
                  :class="['toggle-item', 'task-btn', { active: taskType === 'task2' }]"
                  @click="taskType = 'task2'"
                >
                  <span class="toggle-item__label">Task 2</span>
                </button>
              </div>
            </div>

            <div class="config-section">
              <span class="config-label">题目来源</span>
              <div class="toggle-group toggle-group--compact">
                <button
                  :class="['toggle-item', 'mode-btn', { active: topicMode === 'free' }]"
                  @click="topicMode = 'free'"
                >
                  <span class="toggle-item__label">自由写作</span>
                </button>
                <button
                  :class="['toggle-item', 'mode-btn', { active: topicMode === 'bank' }]"
                  @click="topicMode = 'bank'"
                >
                  <span class="toggle-item__label">从题库选择</span>
                </button>
              </div>
            </div>
          </div>

          <div class="prompt-display">
            <div v-if="topicMode === 'free'" class="topic-panel">
              <textarea
                id="custom-topic-text"
                v-model="customTopicText"
                class="textarea topic-input"
                :placeholder="customTopicPlaceholder"
                rows="4"
              ></textarea>
            </div>
            <div v-else class="topic-panel">
              <div class="prompt-content">
                <div class="prompt-meta">
                  <div class="prompt-title">
                    <strong v-if="selectedTopicText">{{ currentTopicLabel }}</strong>
                    <strong v-else style="opacity: 0.6;">等待选择题目...</strong>
                  </div>
                  <div class="field-row inline-topic-selectors">
                    <select id="topic-category" v-model="selectedCategory" class="select select-sm inline-select">
                      <option value="">全部分类</option>
                      <option
                        v-for="option in categoryOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                    <select
                      id="topic-select"
                      :value="selectedTopicId === null ? '' : String(selectedTopicId)"
                      class="select select-sm inline-select"
                      :disabled="topicLoading || topicsList.length === 0"
                      @change="handleTopicChange"
                    >
                      <option value="">选择具体考题</option>
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

                <div v-if="topicLoading" class="topic-status">数据同步中...</div>
                <div v-else-if="topicError" class="topic-status topic-status--error">{{ topicError }}</div>
                <div v-else-if="selectedTopicText">
                  <p class="prompt-text">{{ selectedTopicText }}</p>
                </div>
                <div v-else class="topic-status topic-status-plain">
                  <span v-if="topicsList.length === 0" style="opacity: 0.5;">当前分类下无记录</span>
                  <span v-else style="opacity: 0.5;"></span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </aside>

      <section class="practice-right compose-editor card">
        <div class="editor-head">
          <div class="editor-head__copy">
            <h2 class="heading-serif">作文输入</h2>
            <div class="word-meta">
              目标 <strong>{{ targetWordCount }}</strong> 词
            </div>
          </div>

          <div class="editor-head__stats">
            <div :class="['word-badge', { 'is-warning': isWordCountLow }]">
              <span class="word-badge-label">字数</span>
              <strong class="word-badge-value">{{ wordCount }}</strong>
            </div>
          </div>
        </div>

        <div v-if="error || restoreNotice" class="editor-notices">
          <div v-if="error" class="inline-message inline-message-error error-message">
            <span>{{ error }}</span>
          </div>
          <div v-if="restoreNotice" :class="['inline-message', 'restore-notice']">
            <span>{{ restoreNotice }}</span>
          </div>
        </div>

        <textarea
          v-model="content"
          class="textarea essay-input"
          :placeholder="placeholder"
          rows="18"
        ></textarea>

        <div class="editor-footer">
          <div class="word-status">
            <span class="word-status__label">提交限制</span>
            <strong :class="{ 'is-warning': isWordCountLow }">
              {{ isWordCountLow ? `至少 ${minWordCount} 词` : '已达到字数要求' }}
            </strong>
          </div>

          <div class="editor-actions">
            <button class="btn btn-secondary" @click="scheduleSave">
              保存草稿
            </button>
            <button
              class="btn btn-brand submit-btn"
              :disabled="!canSubmit"
              @click="handleSubmit"
            >
              {{ isSubmitting ? '提交中...' : '提交评分' }}
            </button>
          </div>
        </div>
      </section>
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
          <button class="btn btn-warm-sand" @click="showConfirmDialog = false">
            取消
          </button>
          <button class="btn btn-brand" @click="confirmSubmit">
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
  let nextRestoreNotice = ''
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
      nextRestoreNotice = draft.topic_text
        ? '草稿关联的题库题目已失效，已切换为自由写作并保留题目文本。'
        : '草稿关联的题库题目已失效，请重新输入题目或重新选题。'
    }
  }

  await nextTick()
  restoreNotice.value = nextRestoreNotice
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
    const payload = {
      task_type: taskType.value,
      topic_id: bankTopicId,
      topic_text: topicMode.value === 'free' ? customTopicText.value.trim() : (selectedTopicText.value || ''),
      content: content.value.trim(),
      word_count: wordCount.value
    }
    const result = await evaluate.start({
      task_type: payload.task_type,
      topic_id: payload.topic_id,
      topic_text: topicMode.value === 'free' ? customTopicText.value.trim() : null,
      content: payload.content,
      word_count: payload.word_count
    })

    try {
      sessionStorage.setItem('temp_essay_' + result.sessionId, JSON.stringify(payload))
    } catch(err) { console.warn(err) }

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
  display: grid;
  gap: 20px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.practice-shell {
  display: grid;
  grid-template-columns: minmax(360px, 0.84fr) minmax(0, 1.16fr);
  gap: 24px;
  min-height: calc(100vh - 176px);
}

.draft-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px;
  background: var(--lg-bg-elevated);
  border: 1px solid var(--lg-border-color);
}

.draft-banner__copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.draft-banner__copy strong {
  font-size: 18px;
}

.draft-banner__copy p {
  color: var(--text-secondary);
  font-size: 14px;
}

.draft-banner__actions {
  display: flex;
  gap: 12px;
}

.practice-left {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-height: calc(100vh - 176px);
  padding: 24px;
  overflow: auto;
}

.compose-hero {
  display: grid;
  gap: 12px;
}

.compose-hero__copy {
  display: grid;
  gap: 8px;
}

.compose-hero__copy h1 {
  font-size: clamp(1.8rem, 2.8vw, 2.7rem);
  line-height: 1.05;
  letter-spacing: -0.02em;
}

.hero-chip {
  display: inline-flex;
  width: fit-content;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(201, 100, 66, 0.14);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.compose-hero__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.hero-metric {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.52);
  border: 1px solid var(--lg-border-color);
}

.hero-metric__label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hero-metric strong {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.1;
}

.compose-config-top {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.config-toolbar {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--lg-border-color);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding-left: 6px;
}

.field-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.select-sm {
  min-height: 38px;
  padding: 6px 12px;
  border-radius: 999px;
}

.prompt-display {
  display: flex;
  flex-direction: column;
}

.topic-panel {
  display: flex;
  flex-direction: column;
}

.topic-input {
  min-height: 132px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
}

.topic-status {
  padding: 16px;
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
  background: rgba(255, 255, 255, 0.4);
  border-radius: var(--radius-md);
  border: 1px dashed var(--lg-border-color);
}

.topic-status--error {
  color: var(--danger-color);
  border-color: var(--danger-color);
}

.topic-status-plain {
  border: none;
  background: transparent;
  padding: 0;
}

.prompt-content {
  background: rgba(255, 255, 255, 0.5);
  padding: 18px;
  border-radius: 16px;
  border: 1px solid var(--lg-border-color);
}

.prompt-meta {
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.prompt-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.inline-topic-selectors {
  gap: 8px;
}

.inline-select {
  min-width: 138px;
}

.prompt-text {
  font-size: 17px;
  font-weight: 500;
  line-height: 1.8;
  color: var(--text-primary);
  white-space: pre-wrap;
}

.practice-right {
  position: relative;
}

.compose-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: calc(100vh - 176px);
  padding: 0;
}

.compose-editor::before,
.compose-editor::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
  z-index: -1;
}

.compose-editor::before {
  width: 320px;
  height: 320px;
  top: -120px;
  right: -90px;
  background: radial-gradient(circle, rgba(167, 186, 255, 0.28), transparent 70%);
}

.compose-editor::after {
  width: 280px;
  height: 260px;
  left: -70px;
  bottom: -110px;
  background: radial-gradient(circle, rgba(216, 233, 183, 0.34), transparent 70%);
}

.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.36);
  background: rgba(255, 255, 255, 0.24);
}

.editor-head__copy {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 16px;
}

.editor-head__copy h2 {
  font-size: clamp(1.65rem, 2.5vw, 2.2rem);
  line-height: 1;
  letter-spacing: -0.02em;
  margin: 0;
}

.editor-head__stats {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.word-badge {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 8px 13px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid var(--lg-border-color);
}

.word-badge span,
.word-meta,
.word-status__label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.word-badge strong {
  font-size: 24px;
  line-height: 1;
  letter-spacing: -0.02em;
}

.word-badge.is-warning strong,
.word-status strong.is-warning {
  color: var(--danger-color);
}

.editor-notices {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 22px;
}

.essay-input {
  flex: 1;
  min-height: 460px;
  width: calc(100% - 36px);
  max-width: calc(100% - 36px);
  box-sizing: border-box;
  margin: 0 18px;
  padding: 26px 24px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.76);
  font-size: 18px;
  line-height: 1.8;
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.75);
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: calc(100% - 36px);
  max-width: calc(100% - 36px);
  box-sizing: border-box;
  margin: 0 18px 18px;
  padding: 14px 14px 6px;
  border-radius: 999px;
  background: linear-gradient(to top, rgba(255, 255, 255, 0.46), rgba(255, 255, 255, 0.2));
}

.word-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.word-status strong {
  font-size: 16px;
  color: var(--text-primary);
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.submit-btn {
  min-width: 138px;
}

.toggle-group {
  display: flex;
  gap: 6px;
}

.toggle-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 13px;
  border: 1px solid var(--lg-border-color);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.45);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}

.toggle-item:hover {
  background: rgba(255, 255, 255, 0.72);
}

.toggle-item.active {
  background: linear-gradient(135deg, var(--color-terracotta), var(--color-coral));
  border-color: rgba(201, 100, 66, 0.4);
  color: var(--color-ivory);
  box-shadow: 0 6px 16px rgba(201, 100, 66, 0.28);
}

.toggle-item__label {
  font-size: 13px;
  font-weight: 600;
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
  overflow: visible;
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

@media (max-width: 1240px) {
  .practice-shell {
    grid-template-columns: 1fr;
  }

  .practice-left,
  .compose-editor {
    max-height: none;
    min-height: 0;
  }

  .config-toolbar {
    flex-direction: column;
    align-items: stretch;
    border-radius: 18px;
  }
}

@media (max-width: 900px) {
  .compose-hero__metrics {
    grid-template-columns: 1fr;
  }

  .prompt-meta {
    flex-direction: column;
    align-items: stretch;
  }

  .inline-topic-selectors {
    flex-direction: column;
  }

  .editor-footer {
    border-radius: 16px;
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 720px) {
  .draft-banner,
  .editor-head,
  .editor-footer,
  .editor-actions,
  .draft-banner__actions {
    flex-direction: column;
    align-items: stretch;
  }

  .compose-hero__copy h1 {
    font-size: 32px;
  }

  .editor-head__stats {
    align-items: stretch;
  }

  .practice-left {
    padding: 18px;
  }

  .essay-input {
    margin: 0 12px;
    padding: 18px;
  }
}
</style>
