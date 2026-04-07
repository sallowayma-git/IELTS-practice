<template>
  <div class="compose-page">
    <section v-if="showDraftNotification" class="draft-banner draft-notification surface">
      <div class="draft-banner__copy">
        <span class="panel-label">Draft Recovery</span>
        <strong>检测到未保存的草稿</strong>
        <p>可以直接恢复继续写，也可以丢弃后从空白工作台开始。</p>
      </div>
      <div class="draft-banner__actions">
        <button class="btn btn-secondary" @click="handleDiscardDraft">
          放弃
        </button>
        <button class="btn btn-primary" @click="handleRecoverDraft">
          恢复草稿
        </button>
      </div>
    </section>

    <header class="compose-hero">
      <div class="compose-hero__copy">
        <span class="panel-label">Writing Workspace</span>
        <h1>先把题目钉住，再把正文写满。</h1>
        <h2 class="legacy-heading">作文输入</h2>
        <p>
          这个页面只做写作链路里真正有价值的事情：选任务、定题目、写正文、看字数、提交评分。
        </p>
      </div>

      <div class="compose-hero__metrics surface-muted">
        <div class="hero-metric">
          <span class="hero-metric__label">当前任务</span>
          <strong>Task {{ taskType === 'task1' ? '1' : '2' }}</strong>
        </div>
        <div class="hero-metric">
          <span class="hero-metric__label">建议字数</span>
          <strong>{{ minWordCount }} - {{ targetWordCount }}</strong>
        </div>
        <div class="hero-metric">
          <span class="hero-metric__label">题目来源</span>
          <strong>{{ topicMode === 'free' ? '自由写作' : '题库选题' }}</strong>
        </div>
      </div>
    </header>

    <div class="compose-layout">
      <section class="compose-editor surface">
        <div class="editor-head">
          <div class="editor-head__copy">
            <span class="panel-label">Essay Draft</span>
            <h2>正文工作面</h2>
            <p>只管把文章写清楚。题目和任务规则在右侧，提交动作在底部。</p>
          </div>

          <div class="editor-head__stats">
            <div :class="['word-badge', { 'is-warning': isWordCountLow }]">
              <span>当前字数</span>
              <strong>{{ wordCount }}</strong>
            </div>
            <div class="word-meta">
              目标 {{ targetWordCount }} 词
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
          rows="15"
        ></textarea>

        <div class="editor-footer">
          <div class="word-status">
            <span class="word-status__label">提交阈值</span>
            <strong :class="{ 'is-warning': isWordCountLow }">
              {{ isWordCountLow ? `至少 ${minWordCount} 词` : '字数已达最低要求' }}
            </strong>
          </div>

          <div class="editor-actions">
            <p class="submit-hint">
              {{ canSubmit ? '准备好后即可提交评分。' : getSubmitBlockReason() }}
            </p>
            <button
              class="btn btn-primary submit-btn"
              :disabled="!canSubmit"
              @click="handleSubmit"
            >
              {{ isSubmitting ? '提交中...' : '提交评分' }}
            </button>
          </div>
        </div>
      </section>

      <aside class="compose-sidebar">
        <section class="compose-panel surface">
          <span class="panel-label">Task Setup</span>
          <div class="panel-header">
            <h2>任务设定</h2>
            <p>{{ taskType === 'task1' ? '图表描述题' : '议论文 / 观点题' }}</p>
          </div>

          <div class="toggle-group">
            <button
              :class="['toggle-item', 'task-btn', { active: taskType === 'task1' }]"
              @click="taskType = 'task1'"
            >
              <span class="toggle-item__label">Task 1</span>
              <span class="toggle-item__meta">150-180 词</span>
            </button>
            <button
              :class="['toggle-item', 'task-btn', { active: taskType === 'task2' }]"
              @click="taskType = 'task2'"
            >
              <span class="toggle-item__label">Task 2</span>
              <span class="toggle-item__meta">250-280 词</span>
            </button>
          </div>

          <p class="panel-note">
            {{ taskType === 'task1'
              ? '评分重点是图表信息覆盖、关键信息提炼与比较表达。'
              : '评分重点是立场完整、论证推进和段落衔接。'
            }}
          </p>
        </section>

        <section class="compose-panel surface">
          <span class="panel-label">Prompt Source</span>
          <div class="panel-header">
            <h2>题目来源</h2>
            <p>评分必须绑定题目，否则 Task Response 会漂。</p>
          </div>

          <div class="toggle-group toggle-group--compact">
            <button
              :class="['toggle-item', 'mode-btn', { active: topicMode === 'free' }]"
              @click="topicMode = 'free'"
            >
              <span class="toggle-item__label">自由写作</span>
              <span class="toggle-item__meta">手动输入题目</span>
            </button>
            <button
              :class="['toggle-item', 'mode-btn', { active: topicMode === 'bank' }]"
              @click="topicMode = 'bank'"
            >
              <span class="toggle-item__label">从题库选择</span>
              <span class="toggle-item__meta">调用已有题目</span>
            </button>
          </div>

          <div v-if="topicMode === 'free'" class="topic-panel">
            <label for="custom-topic-text">{{ customTopicLabel }}</label>
            <textarea
              id="custom-topic-text"
              v-model="customTopicText"
              class="textarea topic-input"
              :placeholder="customTopicPlaceholder"
              rows="6"
            ></textarea>
          </div>

          <div v-else class="topic-panel">
            <div class="field-grid">
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

            <div v-if="topicLoading" class="topic-status">题库加载中...</div>
            <div v-else-if="topicError" class="topic-status topic-status--error">{{ topicError }}</div>
            <div v-else-if="topicsList.length === 0" class="topic-status">当前分类下没有题目。</div>
            <div v-else-if="selectedTopicId === null" class="topic-status">先选中题目，再提交评分。</div>

            <div v-if="selectedTopicText" class="topic-preview">
              <div class="topic-preview__meta">
                <span>当前题目</span>
                <strong>{{ currentTopicLabel }}</strong>
              </div>
              <p>{{ selectedTopicText }}</p>
            </div>
          </div>
        </section>

        <section class="compose-panel surface-muted">
          <span class="panel-label">Checklist</span>
          <div class="panel-header">
            <h2>提交前检查</h2>
            <p>不要让模型替你猜题目，也不要用不成形的草稿浪费一次完整评测。</p>
          </div>

          <ul class="checklist">
            <li v-if="taskType === 'task1'">有没有覆盖图表中的主要趋势、比较和异常点。</li>
            <li v-else>有没有明确立场，并且每段都在推进立场而不是重复。</li>
            <li>题目是否已经绑定，自由写作和题库模式二选一，不要空着。</li>
            <li>正文尽量达到建议字数，再提交评测链路。</li>
          </ul>
        </section>
      </aside>
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
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.legacy-heading {
  font-family: var(--font-family-base);
  font-size: 0.98rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  text-transform: uppercase;
}

.draft-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px;
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
}

.draft-banner__actions {
  display: flex;
  gap: 12px;
}

.compose-hero {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 24px;
}

.compose-hero__copy {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 860px;
}

.compose-hero__copy h1 {
  font-family: var(--font-family-display);
  font-size: clamp(42px, 6vw, 74px);
  line-height: 0.92;
  letter-spacing: -0.05em;
}

.compose-hero__copy p {
  max-width: 720px;
  font-size: 16px;
  color: var(--text-secondary);
}

.compose-hero__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  min-width: 420px;
  padding: 16px;
}

.hero-metric {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  padding: 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 251, 246, 0.46);
  border: 1px solid rgba(90, 73, 60, 0.08);
}

.hero-metric__label {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hero-metric strong {
  font-family: var(--font-family-display);
  font-size: 28px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.04em;
}

.compose-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.7fr);
  gap: 20px;
}

.compose-editor,
.compose-panel {
  padding: 24px;
}

.compose-editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 720px;
}

.editor-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
}

.editor-head__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-head__copy h2,
.panel-header h2 {
  font-family: var(--font-family-display);
  font-size: 34px;
  line-height: 0.96;
  letter-spacing: -0.04em;
}

.editor-head__copy p,
.panel-header p {
  color: var(--text-secondary);
}

.editor-head__stats {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  min-width: 150px;
}

.word-badge {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 132px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 251, 246, 0.84);
  border: 1px solid var(--line-1);
}

.word-badge span,
.word-meta,
.word-status__label {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.word-badge strong {
  font-family: var(--font-family-display);
  font-size: 30px;
  line-height: 1;
  letter-spacing: -0.05em;
}

.word-badge.is-warning strong,
.word-status strong.is-warning {
  color: var(--danger-color);
}

.editor-notices {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.essay-input {
  flex: 1;
  min-height: 520px;
  padding: 24px;
  border-radius: var(--radius-xl);
  background:
    linear-gradient(180deg, rgba(255, 251, 246, 0.92), rgba(248, 242, 233, 0.96));
  font-size: 16px;
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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
  gap: 14px;
}

.submit-hint {
  font-size: 13px;
  color: var(--text-secondary);
  max-width: 320px;
  text-align: right;
}

.submit-btn {
  min-width: 138px;
}

.compose-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.compose-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.panel-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toggle-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.toggle-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--line-1);
  border-radius: var(--radius-md);
  background: rgba(255, 251, 246, 0.56);
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) ease,
    background-color var(--duration-fast) ease,
    color var(--duration-fast) ease,
    transform var(--duration-fast) ease;
}

.toggle-item:hover {
  transform: translateY(-1px);
  border-color: var(--line-strong);
}

.toggle-item.active {
  background: var(--ink-1);
  border-color: var(--ink-1);
  color: #fcf7ef;
}

.toggle-item__label {
  font-size: 15px;
  font-weight: 700;
}

.toggle-item__meta {
  font-size: 12px;
  color: inherit;
  opacity: 0.78;
}

.panel-note,
.topic-status {
  color: var(--text-secondary);
  font-size: 14px;
}

.topic-status--error {
  color: var(--danger-color);
}

.topic-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.topic-input {
  min-height: 176px;
}

.field-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-grow {
  flex: 1;
}

.topic-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--line-1);
}

.topic-preview__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--text-muted);
}

.topic-preview__meta strong {
  color: var(--text-primary);
}

.topic-preview p {
  white-space: pre-wrap;
  color: var(--text-primary);
}

.checklist {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
}

.checklist li {
  margin-bottom: 10px;
  line-height: 1.7;
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

@media (max-width: 1180px) {
  .compose-hero {
    flex-direction: column;
  }

  .compose-hero__metrics {
    min-width: 0;
  }

  .compose-layout {
    grid-template-columns: 1fr;
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
    font-size: 44px;
  }

  .compose-hero__metrics {
    grid-template-columns: 1fr;
  }

  .toggle-group {
    width: 100%;
    grid-template-columns: 1fr;
  }

  .editor-head__stats {
    align-items: stretch;
  }

  .submit-hint {
    max-width: none;
    text-align: left;
  }
}
</style>
