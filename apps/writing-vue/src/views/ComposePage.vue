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
          <div class="compose-hero__copy">
            <span class="hero-chip">写作任务 {{ taskType === 'task1' ? '1' : '2' }}</span>
            <h1 class="heading-serif">沉浸式写作练习</h1>
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
.compose-page {
  position: relative;
  display: grid;
  gap: 18px;
  max-width: 1400px;
  margin: 0 auto;
  padding: 2px;
  color: var(--atlas-ink);
  background: transparent;
  border-radius: 32px;
  animation: compose-enter 360ms var(--lg-easing-spring, cubic-bezier(0.22, 1, 0.36, 1)) both;
}

.practice-shell {
  display: grid;
  grid-template-columns: minmax(350px, 0.86fr) minmax(0, 1.14fr);
  gap: 18px;
  min-height: calc(100vh - 168px);
}

.draft-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 17px 20px;
  border: 1px solid var(--lg-border-color);
  border-radius: 20px;
  background: var(--atlas-sheen), var(--lg-bg-primary);
  box-shadow: var(--lg-shadow-elevated);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.draft-banner__copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.draft-banner__copy strong {
  font-size: var(--anth-text-md);
  letter-spacing: -0.01em;
}

.draft-banner__copy p {
  color: var(--atlas-ink-soft);
  font-size: var(--anth-text-sm);
}

.draft-banner__actions {
  display: flex;
  gap: 12px;
}

.practice-left {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  max-height: calc(100vh - 168px);
  padding: 24px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--lg-border-color);
  border-radius: 26px;
  background: var(--lg-bg-primary);
  box-shadow: var(--lg-shadow-elevated);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
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
  font-size: clamp(1.85rem, 2.8vw, 2.55rem);
  line-height: 1.08;
  letter-spacing: -0.035em;
  color: var(--atlas-ink);
}

.hero-chip {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  min-height: 28px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--atlas-accent) 24%, var(--atlas-rim));
  color: var(--atlas-accent);
  font-size: var(--anth-text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.compose-hero__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.hero-metric {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: 15px;
  background: var(--lg-bg-interactive);
  box-shadow: var(--lg-shadow-subtle);
}

.hero-metric__label {
  font-size: var(--anth-text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--atlas-ink-soft);
}

.hero-metric strong {
  overflow: hidden;
  font-size: var(--anth-text-lg);
  font-weight: 700;
  line-height: 1.1;
  color: var(--atlas-ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compose-config-top {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.config-toolbar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 9px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: 19px;
  background: var(--lg-bg-toolbar);
  box-shadow: var(--lg-shadow-subtle);
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 3px;
}

.config-label {
  padding-left: 7px;
  font-size: var(--anth-text-xs);
  font-weight: 700;
  color: var(--atlas-ink-soft);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.field-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.select-sm {
  min-height: 40px;
  padding: 7px 12px;
  border-radius: 12px;
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
  border-radius: 18px;
}

.topic-status {
  padding: 15px;
  color: var(--atlas-ink-soft);
  font-size: var(--anth-text-sm);
  text-align: center;
  background: var(--lg-bg-interactive);
  border: 1px dashed var(--lg-border-subtle);
  border-radius: 16px;
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
  background: var(--lg-bg-interactive);
  padding: 18px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: 18px;
  box-shadow: var(--lg-shadow-subtle);
}

.prompt-image {
  margin: 14px 0 0;
  overflow: hidden;
  border: 1px solid var(--lg-border-subtle);
  border-radius: 16px;
  background: var(--lg-bg-primary);
}

.prompt-image img {
  display: block;
  width: 100%;
  max-height: 300px;
  object-fit: contain;
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
  min-width: 0;
  width: 100%;
}

.prompt-text {
  font-size: var(--anth-text-md);
  font-weight: 500;
  line-height: 1.75;
  color: var(--atlas-ink);
  white-space: pre-wrap;
}

.practice-right {
  position: relative;
}

.compose-editor {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 15px;
  min-width: 0;
  min-height: calc(100vh - 168px);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--lg-border-color);
  border-radius: 26px;
  background: var(--atlas-sheen), var(--lg-bg-primary);
  box-shadow: var(--lg-shadow-elevated);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 21px 24px 16px;
  border-bottom: 1px solid var(--lg-border-subtle);
  background: var(--lg-bg-toolbar);
}

.editor-head__copy {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 16px;
}

.editor-head__copy h2 {
  font-size: clamp(1.6rem, 2.5vw, 2.15rem);
  line-height: 1;
  letter-spacing: -0.035em;
  margin: 0;
  color: var(--atlas-ink);
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
  min-height: 42px;
  padding: 7px 13px;
  border-radius: var(--radius-full);
  background: var(--lg-bg-elevated);
  border: 1px solid var(--lg-border-color);
  box-shadow: var(--lg-shadow-subtle);
}

.word-badge span,
.word-meta,
.word-status__label {
  font-size: var(--anth-text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--atlas-ink-soft);
}

.word-badge strong {
  font-size: var(--anth-text-xl);
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--atlas-accent);
}

.word-badge.is-warning strong,
.word-status strong.is-warning {
  color: var(--danger-color);
}

.editor-notices {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 24px;
}

.essay-input {
  flex: 1;
  min-height: 450px;
  width: calc(100% - 40px);
  max-width: calc(100% - 40px);
  box-sizing: border-box;
  margin: 0 20px;
  padding: 24px;
  border: 1px solid var(--lg-border-color);
  border-radius: 20px;
  background: var(--lg-bg-elevated);
  font-size: var(--anth-text-lg);
  line-height: 1.8;
  color: var(--atlas-ink);
  box-shadow: var(--lg-shadow-subtle);
  resize: vertical;
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: calc(100% - 40px);
  max-width: calc(100% - 40px);
  box-sizing: border-box;
  margin: 0 20px 20px;
  padding: 12px;
  border: 1px solid var(--lg-border-color);
  border-radius: 18px;
  background: var(--lg-bg-interactive);
  box-shadow: var(--lg-shadow-subtle);
}

.word-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.word-status strong {
  font-size: var(--anth-text-md);
  color: var(--atlas-ink);
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
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: 999px;
  background: var(--lg-bg-interactive);
  box-shadow: var(--lg-shadow-subtle);
}

.toggle-item {
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--atlas-ink-soft);
  cursor: pointer;
  transition:
    color var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease),
    background var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease),
    box-shadow var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease),
    transform var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease);
}

.toggle-item:hover {
  color: var(--atlas-ink);
  background: var(--lg-bg-elevated);
}

.toggle-item.active {
  background: var(--color-brand-gradient);
  border-color: var(--atlas-button-brand-border);
  color: var(--text-inverse);
  box-shadow: var(--lg-shadow-subtle);
}

.toggle-item__label {
  overflow: hidden;
  font-size: var(--anth-text-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compose-page .dialog-actions {
  justify-content: flex-end;
}.compose-page :is(.textarea, .select) {
  width: 100%;
  color: var(--atlas-ink);
  border: 1px solid var(--lg-border-subtle);
  background: var(--lg-bg-elevated);
  box-shadow: var(--lg-shadow-subtle);
  transition:
    border-color var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease),
    box-shadow var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease),
    background var(--lg-duration-normal, 220ms) var(--lg-easing-spring, ease);
}

.compose-page :is(.textarea, .select)::placeholder {
  color: var(--atlas-ink-soft);
}

.compose-page :is(.textarea, .select):focus {
  outline: none;
  border-color: var(--atlas-accent-ring);
  background: var(--lg-bg-elevated);
  box-shadow:
    0 0 0 4px var(--atlas-accent-soft),
    var(--lg-shadow-subtle);
}

.compose-page .btn:active:not(:disabled),
.toggle-item:active {
  transform: scale(0.98);
}

.compose-page .btn:disabled {
  cursor: not-allowed;
  opacity: 0.52;
  box-shadow: none;
}

.compose-page :is(.btn, .toggle-item, .textarea, .select):focus-visible {
  outline: 3px solid var(--atlas-accent-ring);
  outline-offset: 3px;
}

@keyframes compose-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.992);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
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
    grid-template-columns: 1fr;
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

  .editor-actions {
    justify-content: flex-end;
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
    font-size: var(--anth-text-3xl);
  }

  .editor-head__stats {
    align-items: stretch;
  }

  .essay-input {
    width: calc(100% - 24px);
    max-width: calc(100% - 24px);
    margin: 0 12px;
    padding: 18px;
  }

  .editor-footer {
    width: calc(100% - 24px);
    max-width: calc(100% - 24px);
    margin: 0 12px 12px;
  }
}

@media (prefers-contrast: more) {
  .compose-page :is(.practice-left, .compose-editor, .draft-banner, .dialog) {
    background: var(--atlas-canvas-solid);
    border-color: var(--atlas-ink);
  }

  .compose-page :is(.textarea, .select, .toggle-group) {
    background: var(--atlas-canvas-solid);
    border-color: var(--atlas-ink);
  }
}
</style>
