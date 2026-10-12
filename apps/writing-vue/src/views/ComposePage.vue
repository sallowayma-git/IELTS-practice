<template>
  <div class="compose-page">
    <header class="page-header has-rule">
      <p class="page-header-kicker">WRITING · 写作</p>
      <h1>写作练习</h1>
      <p class="page-header-desc compose-meta">
        <span>Task {{ taskType === 'task1' ? '1' : '2' }}</span>
        <span>建议 <span class="t-num">{{ minWordCount }}–{{ targetWordCount }}</span> 词</span>
        <span>{{ topicMode === 'free' ? '自由写作' : '题库选题' }}</span>
      </p>
    </header>

    <section v-if="showDraftNotification" class="card draft-banner draft-notification">
      <div class="draft-banner__copy">
        <span class="page-header-kicker">草稿恢复</span>
        <strong>检测到未保存的草稿</strong>
        <p>可以直接恢复继续写，也可以丢弃后从空白工作台开始。</p>
      </div>
      <div class="draft-banner__actions">
        <button class="btn btn-ghost" @click="handleDiscardDraft">
          放弃
        </button>
        <button class="btn btn-secondary" @click="handleRecoverDraft">
          恢复草稿
        </button>
      </div>
    </section>

    <div class="practice-shell">
      <aside class="practice-left">
        <div class="config-toolbar">
          <div class="config-section">
            <span class="field-label">写作任务</span>
            <div class="segmented">
              <button
                :class="['segmented-item', 'task-btn', { active: taskType === 'task1' }]"
                @click="selectTaskType('task1')"
              >
                Task 1
              </button>
              <button
                :class="['segmented-item', 'task-btn', { active: taskType === 'task2' }]"
                @click="selectTaskType('task2')"
              >
                Task 2
              </button>
            </div>
          </div>

          <div class="config-section">
            <span class="field-label">题目来源</span>
            <div class="segmented">
              <button
                :class="['segmented-item', 'mode-btn', { active: topicMode === 'free' }]"
                @click="selectTopicMode('free')"
              >
                自由写作
              </button>
              <button
                :class="['segmented-item', 'mode-btn', { active: topicMode === 'bank' }]"
                @click="selectTopicMode('bank')"
              >
                从题库选择
              </button>
            </div>
          </div>
        </div>

        <section class="card prompt-card">
          <div v-if="topicMode === 'free'">
            <textarea
              id="custom-topic-text"
              v-model="customTopicText"
              class="textarea topic-input"
              :placeholder="customTopicPlaceholder"
              rows="4"
            ></textarea>
          </div>
          <div v-else class="prompt-content">
            <div class="inline-topic-selectors">
              <select id="topic-category" v-model="selectedCategory" class="select inline-select inline-select--category">
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
                class="select inline-select"
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

            <div v-if="topicLoading" class="topic-status">数据同步中...</div>
            <div v-else-if="topicError" class="topic-status topic-status--error">{{ topicError }}</div>
            <div v-else-if="selectedTopicText" class="prompt-selected">
              <p class="page-header-kicker">{{ currentTopicLabel }}</p>
              <p class="prompt-text t-body-lg">{{ selectedTopicText }}</p>
              <figure v-if="selectedTopicImage" class="prompt-image">
                <img :src="selectedTopicImage" :alt="`${currentTopicLabel} Task 1 图表`" />
              </figure>
            </div>
            <div v-else class="topic-status">
              {{ topicsList.length === 0 ? '当前分类下无记录' : '等待选择题目…' }}
            </div>
          </div>
        </section>

        <section class="card task-brief" aria-label="任务要求">
          <dl>
            <div>
              <dt>字数</dt>
              <dd>至少 {{ minWordCount }} 词，建议 {{ targetWordCount }} 词</dd>
            </div>
            <div>
              <dt>作答重点</dt>
              <dd>{{ taskType === 'task1' ? '描述图表中的主要特征和趋势' : '介绍您的观点和论据' }}</dd>
            </div>
            <div>
              <dt>提交</dt>
              <dd>字数不足时会先提醒确认，草稿自动保存在本机。</dd>
            </div>
          </dl>
        </section>
      </aside>

      <section class="compose-editor">
        <div class="editor-head">
          <h2>作文</h2>
          <p class="word-meta">目标 <span class="t-num">{{ targetWordCount }}</span> 词</p>
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
          class="textarea essay-input t-body-lg"
          :placeholder="placeholder"
          rows="18"
        ></textarea>

        <div class="editor-footer">
          <p class="word-status">
            <strong class="t-num" :class="{ 'is-warning': isWordCountLow }">{{ wordCount }}</strong>
            <span>词 · </span>
            <span :class="{ 'is-warning': isWordCountLow }">
              {{ isWordCountLow ? `至少 ${minWordCount} 词` : '已达到字数要求' }}
            </span>
          </p>

          <div class="editor-actions">
            <button class="btn btn-ghost" @click="scheduleSave">
              保存草稿
            </button>
            <button
              class="btn btn-primary btn-lg submit-btn"
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
      <div class="dialog">
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
import { useRoute, useRouter } from 'vue-router'
import { evaluate, resolveApiErrorMessage, topics as topicsApi } from '@/api/client.js'
import { useDraft } from '@/composables/useDraft.js'
import { writingTopicModeToAttemptMode } from '@/api/writing-mode.js'
import { createRequestGate } from '@/utils/request-gate.js'
import { extractTextFromTiptap, getTopicTitlePreview } from '@/utils/tiptap-text.js'
import {
  getWritingCategoryLabel,
  getWritingCategoryOptions,
  normalizeWritingCategory
} from '@/utils/writing-categories.js'

const router = useRouter()
const route = useRoute()

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
const topicsRequestGate = createRequestGate()

function getResumeAttemptId() {
  const raw = Array.isArray(route.query.resumeAttemptId)
    ? route.query.resumeAttemptId[0]
    : route.query.resumeAttemptId
  const attemptId = String(raw || '').trim()
  return /^attempt-[a-z0-9_-]{1,128}$/i.test(attemptId) ? attemptId : null
}

const resumeAttemptId = getResumeAttemptId()

function invalidateTopicRequests() {
  topicsRequestGate.invalidate()
  topicLoading.value = false
  topicsList.value = []
}

const {
  scheduleSave,
  loadDraft,
  clearDraft,
  discardDraft,
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
}), { attemptId: resumeAttemptId })

const categoryOptions = computed(() => getWritingCategoryOptions(taskType.value))

const selectedTopic = computed(() => (
  topicsList.value.find((topic) => topic.id === selectedTopicId.value) || null
))

const selectedTopicText = computed(() => (
  selectedTopic.value ? extractTextFromTiptap(selectedTopic.value.title_json) : ''
))

const selectedTopicImage = computed(() => {
  const image = String(selectedTopic.value?.image_path || selectedTopic.value?.image_url || '').trim()
  return /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(image) ? image : null
})

const currentTopicLabel = computed(() => {
  if (!selectedTopic.value) return ''
  return getWritingCategoryLabel(selectedTopic.value.category)
})


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

function getRouteTopicId() {
  const rawTopicId = Array.isArray(route.query.topicId)
    ? route.query.topicId[0]
    : route.query.topicId
  const topicId = String(rawTopicId || '').trim()
  return topicId && topicId.length <= 160 ? topicId : null
}

function resetComposeWorkspace() {
  isRestoringDraft.value = true
  taskType.value = 'task2'
  topicMode.value = 'free'
  selectedCategory.value = ''
  selectedTopicId.value = null
  topicsList.value = []
  topicLoading.value = false
  topicError.value = ''
  customTopicText.value = ''
  content.value = ''
  error.value = ''
  restoreNotice.value = ''
  showConfirmDialog.value = false
  showDraftNotification.value = false
  nextTick(() => {
    isRestoringDraft.value = false
  })
}

async function selectTaskType(nextTaskType) {
  const normalizedTaskType = nextTaskType === 'task1' ? 'task1' : 'task2'
  if (taskType.value === normalizedTaskType) return
  taskType.value = normalizedTaskType
  selectedTopicId.value = null
  const normalizedCategory = normalizeWritingCategory(normalizedTaskType, selectedCategory.value)
  if (normalizedCategory !== selectedCategory.value) {
    selectedCategory.value = normalizedCategory
  }
  if (topicMode.value === 'bank') {
    await loadTopics(normalizedTaskType)
  }
}

async function selectTopicMode(nextMode) {
  const normalizedMode = nextMode === 'bank' ? 'bank' : 'free'
  if (topicMode.value === normalizedMode) return
  topicMode.value = normalizedMode
  selectedTopicId.value = null
  restoreNotice.value = ''
  if (normalizedMode === 'bank') {
    await loadTopics(taskType.value)
  } else {
    invalidateTopicRequests()
    topicError.value = ''
  }
  scheduleSave()
}

async function hydrateEntryState(options = {}) {
  const hasExistingDraft = await hasDraft()
  if (getRouteTopicId()) {
    await hydrateFromPracticeAssetQuery({ preserveExistingDraft: hasExistingDraft })
  } else if (options.resetDefault && !hasExistingDraft) {
    resetComposeWorkspace()
  }

  if (hasExistingDraft) {
    showDraftNotification.value = true
  }
}

onMounted(async () => {
  await hydrateEntryState()
})

watch(() => route.name, async (nextName, previousName) => {
  if (nextName === 'Compose' && previousName && previousName !== 'Compose') {
    await hydrateEntryState({ resetDefault: true })
  }
})

watch(() => [route.query.topicId, route.query.taskType], async ([nextTopicId], [previousTopicId]) => {
  if (getRouteTopicId()) {
    await hydrateEntryState()
    return
  }
  if (route.name === 'Compose' && previousTopicId && !nextTopicId && !(await hasDraft())) {
    resetComposeWorkspace()
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

  const normalizedCategory = normalizeWritingCategory(nextTaskType, selectedCategory.value)
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
  const requestId = topicsRequestGate.begin()
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
    if (!topicsRequestGate.isCurrent(requestId)) {
      return
    }

    const pageItems = Array.isArray(result.data) ? result.data : []
    const requestedTopicId = selectedTopicId.value
    let resolvedItems = pageItems
    if (requestedTopicId && !pageItems.some((topic) => topic.id === requestedTopicId)) {
      const topic = await topicsApi.get(requestedTopicId)
      if (!topicsRequestGate.isCurrent(requestId)) {
        return
      }
      if (topic && topic.type === type) {
        resolvedItems = [topic, ...pageItems]
      }
    }
    topicsList.value = resolvedItems

    const selectedStillExists = topicsList.value.some((topic) => topic.id === selectedTopicId.value)
    if (!selectedStillExists) {
      selectedTopicId.value = null
    }
  } catch (loadError) {
    if (!topicsRequestGate.isCurrent(requestId)) {
      return
    }
    console.error('加载题库失败:', loadError)
    topicError.value = loadError?.message
      ? `题库加载失败：${loadError.message}`
      : '题库加载失败，请稍后重试'
    topicsList.value = []
    selectedTopicId.value = null
  } finally {
    if (topicsRequestGate.isCurrent(requestId)) {
      topicLoading.value = false
    }
  }
}

async function hydrateFromPracticeAssetQuery(options = {}) {
  const topicId = getRouteTopicId()
  if (!topicId) {
    return
  }

  try {
    isRestoringDraft.value = true
    const rawTaskType = Array.isArray(route.query.taskType)
      ? route.query.taskType[0]
      : route.query.taskType
    const normalizedTaskType = String(rawTaskType || '').trim().toLowerCase()
    taskType.value = normalizedTaskType === 'task1' ? 'task1' : 'task2'
    topicMode.value = 'bank'
    selectedCategory.value = ''
    selectedTopicId.value = topicId
    await loadTopics(taskType.value)
  } finally {
    isRestoringDraft.value = false
  }

  if (!options.preserveExistingDraft) {
    scheduleSave()
  }
}

async function handleRecoverDraft() {
  const draft = await loadDraft()
  if (!draft) {
    showDraftNotification.value = false
    return
  }

  isRestoringDraft.value = true
  let nextRestoreNotice = ''
  taskType.value = draft.task_type || 'task2'
  topicMode.value = draft.topic_mode || 'free'
  selectedCategory.value = normalizeWritingCategory(draft.task_type || 'task2', draft.category || '')
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

async function handleDiscardDraft() {
  await clearDraft()
  showDraftNotification.value = false
  restoreNotice.value = ''
}

function handleTopicChange(event) {
  const value = String(event.target.value || '').trim()
  selectedTopicId.value = value || null
  restoreNotice.value = ''
}

function getTopicOptionLabel(topic) {
  return getTopicTitlePreview(topic.title_json, { fallback: '', maxLength: 90 })
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
    const attemptMode = writingTopicModeToAttemptMode(topicMode.value)
    const payload = {
      task_type: taskType.value,
      topic_id: bankTopicId,
      topic_text: topicMode.value === 'free' ? customTopicText.value.trim() : (selectedTopicText.value || ''),
      content: content.value.trim(),
      word_count: wordCount.value
    }
    const result = await evaluate.start({
      sessionId: resumeAttemptId || undefined,
      task_type: payload.task_type,
      mode: attemptMode,
      topic_id: payload.topic_id,
      // Bank and free both need the prompt text for AI + history/result topic display.
      topic_text: payload.topic_text,
      content: payload.content,
      word_count: payload.word_count
    })

    if (!resumeAttemptId) {
      await discardDraft()
    }
    stopAutoSave()

    router.push({
      name: 'Evaluating',
      params: { sessionId: result.sessionId }
    })
  } catch (err) {
    console.error('提交失败:', err)
    if (err?.attemptId) {
      stopAutoSave()
      await router.push({ name: 'Evaluating', params: { sessionId: err.attemptId }, query: { startError: err.code || 'start_failed' } })
      return
    }
    // Prefer startEvaluation Chinese message over bare code mapping
    error.value = resolveApiErrorMessage(err, 'start_failed')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
/* Compose: task and prompt on the left, the essay on the right. Surfaces and controls come from the design system. */
.compose-page { display: grid; gap: var(--anth-space-6); min-width: 0; }

.practice-shell {
  display: grid;
  grid-template-columns: minmax(320px, 0.82fr) minmax(0, 1.18fr);
  align-items: start;
  min-width: 0;
}

.practice-left {
  display: grid;
  gap: var(--anth-space-5);
  min-width: 0;
  padding-right: 40px;
}

.compose-editor {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-3);
  min-width: 0;
  padding-left: 40px;
  border-left: 1px solid var(--anth-rule);
}

.compose-meta span + span::before { content: "·"; margin: 0 8px; }

.draft-banner { display: flex; align-items: center; justify-content: space-between; gap: var(--anth-space-5); }
.draft-banner__copy { display: grid; gap: 2px; min-width: 0; }
.draft-banner__copy p { margin: 0; color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); }
.draft-banner__actions,
.editor-actions { display: flex; align-items: center; gap: var(--anth-space-2); }

.config-toolbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--anth-space-4); }
.config-section { display: grid; gap: 6px; min-width: 0; }

.prompt-content,
.prompt-selected { display: grid; gap: var(--anth-space-3); }
.prompt-selected { padding-top: var(--anth-space-3); border-top: 1px solid var(--anth-rule); }
.inline-topic-selectors { display: flex; flex-wrap: wrap; gap: var(--anth-space-2); }
.inline-select { flex: 1 1 12rem; min-width: 0; }
.prompt-text { margin: 0; max-width: var(--anth-measure); white-space: pre-wrap; }
.prompt-image { margin: 0; padding-top: var(--anth-space-3); }
.prompt-image img { display: block; max-width: 100%; max-height: 300px; margin: 0 auto; }
.topic-status { color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }
.topic-status--error { color: var(--anth-danger); }

.task-brief dl { display: grid; gap: var(--anth-space-3); margin: 0; font-size: var(--anth-text-small-size); }
.task-brief dl > div { display: grid; grid-template-columns: 5.5em minmax(0, 1fr); gap: var(--anth-space-3); }
.task-brief dt { color: var(--anth-ink-muted); }
.task-brief dd { margin: 0; color: var(--anth-ink-soft); }

.editor-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--anth-space-3);
  padding-bottom: var(--anth-space-3);
  border-bottom: 1px solid var(--anth-ink);
}
.editor-head h2,
.word-meta { margin: 0; }
.word-meta { color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }
.editor-notices { display: grid; gap: 4px; }

/* Essay: a raised, large serif surface. Focus ring and border come from the design system. */
.essay-input {
  min-height: 460px;
  padding: var(--anth-space-5) var(--anth-space-6);
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  resize: vertical;
}

/* Footer bar: sticks under the essay, the one primary action sits on the right. */
.editor-footer {
  position: sticky;
  bottom: 0;
  z-index: var(--anth-z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-4);
  padding: var(--anth-space-3) 0;
  border-top: 1px solid var(--anth-rule);
  background: var(--anth-surface);
}

.word-status {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 0;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}
.word-status strong { color: var(--anth-ink-strong); font-size: var(--anth-text-body-size); font-weight: var(--anth-weight-semibold); }
.word-status .is-warning { color: var(--anth-warning); }

@media (max-width: 1100px) {
  .practice-shell { grid-template-columns: minmax(0, 1fr); gap: var(--anth-space-8); }
  .practice-left { padding-right: 0; }
  .compose-editor { padding-left: 0; border-left: 0; }
}

@media (max-width: 720px) {
  .config-toolbar { grid-template-columns: 1fr; }
  .draft-banner,
  .editor-footer { flex-direction: column; align-items: stretch; }
  .draft-banner__actions,
  .editor-actions { justify-content: space-between; }
  .essay-input { min-height: 360px; padding: var(--anth-space-4); }
}
</style>
