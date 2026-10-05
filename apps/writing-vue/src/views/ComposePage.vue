<template>
  <div class="compose-page">
    <section v-if="showDraftNotification" class="draft-banner draft-notification card card-whisper">
      <div class="draft-banner__copy">
        <span class="panel-label">草稿恢复</span>
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
          <h1 class="heading-serif">写作练习</h1>
          <p class="compose-hero__meta">
            <span>Task {{ taskType === 'task1' ? '1' : '2' }}</span>
            <span>建议 {{ minWordCount }}–{{ targetWordCount }} 词</span>
            <span>{{ topicMode === 'free' ? '自由写作' : '题库选题' }}</span>
          </p>
        </header>

        <section class="compose-config-top">
          <div class="config-toolbar">
            <div class="config-section">
              <span class="config-label">任务分配</span>
              <div class="toggle-group toggle-group--compact">
                <button
                  :class="['toggle-item', 'task-btn', { active: taskType === 'task1' }]"
                  @click="selectTaskType('task1')"
                >
                  <span class="toggle-item__label">Task 1</span>
                </button>
                <button
                  :class="['toggle-item', 'task-btn', { active: taskType === 'task2' }]"
                  @click="selectTaskType('task2')"
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
                  @click="selectTopicMode('free')"
                >
                  <span class="toggle-item__label">自由写作</span>
                </button>
                <button
                  :class="['toggle-item', 'mode-btn', { active: topicMode === 'bank' }]"
                  @click="selectTopicMode('bank')"
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
                  <figure v-if="selectedTopicImage" class="prompt-image">
                    <img :src="selectedTopicImage" :alt="`${currentTopicLabel} Task 1 图表`" />
                  </figure>
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
            <h2 class="heading-serif">作文</h2>
            <div class="word-meta">
              目标 <strong>{{ targetWordCount }}</strong> 词
            </div>
          </div>

          <div class="editor-head__stats">
            <div :class="['word-badge', { 'is-warning': isWordCountLow }]">
              <strong class="word-badge-value">{{ wordCount }}</strong>
              <span class="word-badge-label">词</span>
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
            <button class="btn-text" @click="scheduleSave">
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
/* Compose: the task on the left, the essay on the right, a hairline between. */
.compose-page {
  display: grid;
  gap: 24px;
  min-width: 0;
}

.practice-shell {
  display: grid;
  grid-template-columns: minmax(320px, 0.82fr) minmax(0, 1.18fr);
  align-items: start;
  gap: 0;
  min-width: 0;
}

.practice-left,
.compose-editor {
  min-width: 0;
  border: 0;
  background: var(--anth-canvas);
}

.practice-left {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 0 40px 0 0;
}

.compose-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: calc(100vh - 200px);
  padding: 0 0 0 40px;
  border-left: 1px solid var(--anth-rule);
}

/* Draft banner: a quiet note with a clay rule on the left. */
.draft-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 0 12px 16px;
}

.draft-banner__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.draft-banner__copy strong {
  color: var(--anth-ink-strong);
  font-weight: var(--anth-weight-medium);
}

.draft-banner__copy p {
  margin: 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

.draft-banner__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
}

/* Task column */
.compose-hero h1 {
  margin: 0;
  font-size: clamp(1.75rem, 3vw, 2.125rem);
  line-height: var(--anth-leading-tight);
}

.compose-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 10px 0 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.compose-hero__meta span + span::before {
  content: "·";
  margin-right: 10px;
  color: var(--anth-ink-faint);
}

.compose-config-top {
  display: grid;
  gap: 24px;
}

.config-toolbar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--anth-ink);
}

.config-section {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.prompt-display {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.topic-panel {
  display: grid;
  gap: 12px;
}

.topic-input {
  width: 100%;
  min-height: 140px;
  font-size: var(--anth-text-base);
  line-height: var(--anth-leading-normal);
}

.prompt-content {
  display: grid;
  gap: 14px;
}

.prompt-meta {
  display: grid;
  gap: 10px;
}

.prompt-title strong {
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-lg);
  font-weight: var(--anth-weight-semibold);
}

.field-row,
.inline-topic-selectors {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.inline-select {
  flex: 1 1 160px;
  min-width: 0;
  min-height: 38px;
}

.prompt-text {
  margin: 0;
  max-width: var(--anth-measure);
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
  line-height: var(--anth-leading-relaxed);
  white-space: pre-wrap;
}

.prompt-image {
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--anth-rule);
}

.prompt-image img {
  display: block;
  max-width: 100%;
  max-height: 300px;
  margin: 0 auto;
}

.topic-status {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.topic-status--error {
  color: var(--anth-danger);
}

/* Essay column */
.editor-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--anth-ink);
}

.editor-head__copy {
  display: flex;
  align-items: baseline;
  gap: 16px;
  min-width: 0;
}

.editor-head__copy h2 {
  margin: 0;
  font-size: var(--anth-text-xl);
}

.word-meta {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.word-meta strong {
  color: var(--anth-ink-soft);
  font-weight: var(--anth-weight-medium);
  font-variant-numeric: lining-nums tabular-nums;
}

.word-badge {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.word-badge strong {
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-xl);
  font-weight: var(--anth-weight-semibold);
  font-variant-numeric: lining-nums tabular-nums;
}

.word-badge.is-warning strong,
.word-status strong.is-warning {
  color: var(--anth-warning);
}

.editor-notices {
  display: grid;
  gap: 4px;
}

.essay-input {
  flex: 1;
  width: 100%;
  min-height: 460px;
  padding: 20px 22px;
  border-color: var(--anth-rule);
  background: var(--anth-surface-sunken);
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: 1.0625rem;
  line-height: 1.8;
  resize: vertical;
}

.essay-input::placeholder {
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-base);
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 4px;
}

.word-status {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: var(--anth-text-sm);
}

.word-status__label {
  color: var(--anth-ink-faint);
}

.word-status strong {
  color: var(--anth-success);
  font-weight: var(--anth-weight-medium);
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 20px;
}

/* The one clay action on this page. */
.compose-page .submit-btn {
  min-width: 132px;
  border-color: var(--anth-accent);
  background: var(--anth-accent);
  color: var(--anth-accent-contrast);
}

.compose-page .submit-btn:hover:not(:disabled) {
  border-color: var(--anth-accent-strong);
  background: var(--anth-accent-strong);
}

.compose-page .submit-btn:disabled {
  border-color: var(--anth-border-strong);
  background: transparent;
  color: var(--anth-ink-faint);
  opacity: 1;
}

.compose-page .toggle-group {
  gap: 20px;
}

@media (max-width: 1100px) {
  .practice-shell {
    grid-template-columns: 1fr;
    gap: 40px;
  }

  .practice-left {
    padding: 0;
  }

  .compose-editor {
    min-height: 0;
    padding: 24px 0 0;
    border-left: 0;
    border-top: 1px solid var(--anth-rule);
  }
}

@media (max-width: 720px) {
  .config-toolbar {
    grid-template-columns: 1fr;
  }

  .draft-banner,
  .editor-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .editor-actions {
    justify-content: space-between;
  }

  .essay-input {
    min-height: 360px;
    padding: 16px;
  }
}
</style>
