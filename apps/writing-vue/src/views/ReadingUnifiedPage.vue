<template>
  <div
    id="runified-root"
    class="runified"
    :class="rootClassList"
    :style="{ '--reading-left-pane-width': `${leftPanePercent}%` }"
    @click="handleWorkspaceClick"
    @keydown="handleWorkspaceKeydown"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <header class="header">
      <div class="header-left">
        <div class="ielts-brand">IELTS</div>
        <div class="candidate-details">
          <span
            id="timer"
            :class="{ paused: !timerRunning }"
            title="点击启停"
            @click="toggleTimer"
          >{{ timerText }}</span>
        </div>
      </div>
      <div class="header-right">
        <!-- Connection + diagnostics indicators exist only for the opensource
             host bridge; rendered as inert status marks for visual parity. -->
        <div class="header-status" id="connection-indicator" role="status" aria-label="Connected">
          <svg class="header-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          <span class="sr-only">Connected</span>
        </div>
        <button class="header-btn" id="messages-indicator" type="button" title="错误与诊断" aria-label="错误与诊断" tabindex="-1">
          <svg class="header-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </button>
        <button
          id="notes-drawer-btn"
          type="button"
          class="header-btn reading-notes-btn"
          title="Notes"
          aria-label="Notes"
          @click="noteDrawerOpen = !noteDrawerOpen"
        >
          <svg class="header-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16l4 4v13.5A1.5 1.5 0 0 1 18.5 22h-13A1.5 1.5 0 0 1 4 20.5z"/><polyline points="15 3 15 8 20 8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>
          <span v-if="noteCount" class="reading-note-count">{{ noteCount }}</span>
        </button>
        <button id="settings-btn" type="button" class="header-btn" aria-label="Options" aria-haspopup="dialog" @click="optionsOpen = true">
          <svg class="header-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
    </header>

    <div class="sub-header-bar">
      <span id="sub-header-part">Part {{ partIndex }}</span>
      <span id="sub-header-instruction">{{ subHeaderInstruction }}</span>
    </div>

    <div v-if="loadError" class="runified-error">
      <strong>题目加载失败</strong>
      <span>{{ loadError }}</span>
    </div>

    <div class="shell" v-show="!loading">
      <section id="left" class="pane reading-html">
        <template v-for="(block, index) in passageBlocks" :key="block.blockId || index">
          <div v-html="block.html || block.bodyHtml"></div>
          <div
            v-if="passageNotes[index]"
            class="reading-explanation-card reading-passage-explanation"
          >
            <div class="reading-explanation-card__label">{{ passageNotes[index].label }}</div>
            <div class="reading-explanation-card__text">{{ passageNotes[index].text }}</div>
          </div>
        </template>
      </section>

      <div
        id="divider"
        role="separator"
        aria-label="拖拽调整分栏宽度"
        aria-orientation="vertical"
        @pointerdown="startDividerDrag"
        @keydown="handleDividerKeydown"
      ></div>

      <section
        id="right"
        class="pane question-panel"
        @input="handleQuestionInput"
        @change="handleQuestionInput"
      >
        <div id="question-groups">
          <article
            v-for="group in questionGroups"
            :key="group.groupId"
            class="unified-group"
            :data-group-id="group.groupId"
            :data-allow-option-reuse="group.allowOptionReuse === true ? 'true' : null"
          >
            <div
              class="reading-html"
              v-html="group.bodyHtml || group.leadHtml"
            ></div>
            <section
              v-if="groupExplanations[group.groupId]?.length"
              class="reading-question-explanation-list"
            >
              <h5>{{ groupRangeLabel(group) }} 官方解析</h5>
              <template v-for="section in groupExplanations[group.groupId]" :key="group.groupId + ':' + section.sectionTitle">
                <div v-if="section.text && !section.items.length" class="reading-explanation-card reading-group-explanation">
                  <div class="reading-explanation-card__label">{{ section.sectionTitle }}</div>
                  <div class="reading-explanation-card__text">{{ section.text }}</div>
                </div>
                <div
                  v-for="item in section.items"
                  v-else
                  :key="section.sectionTitle + ':' + item.questionNumber"
                  class="reading-explanation-card reading-question-explanation-item"
                >
                  <div class="reading-explanation-card__label">Q{{ item.questionNumber }} 讲解</div>
                  <div class="reading-explanation-card__text">{{ item.text }}</div>
                </div>
              </template>
            </section>
          </article>
        </div>

        <div v-if="reviewMode && submission" id="results">
          <div class="results-header-bar">
            <div class="results-header-summary">
              <h4>答题结果</h4>
              <p class="results-score-text">得分 {{ submission.scoreInfo.correct }} / {{ submission.scoreInfo.totalQuestions }} · {{ submission.scoreInfo.percentage }}%</p>
            </div>
          </div>
          <table class="results-table">
            <thead>
              <tr>
                <th>题号</th>
                <th>你的答案</th>
                <th>正确答案</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in resultRows" :key="row.questionId">
                <td><button type="button" class="question-jump-btn" @click="scrollToQuestion(row.questionId)">{{ row.label }}</button></td>
                <td>{{ row.userAnswer }}</td>
                <td>{{ row.correctAnswer }}</td>
                <td :class="row.statusClass">{{ row.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div
      id="selbar"
      :class="{ 'is-open': selectionToolbarVisible }"
      :style="selectionToolbarStyle"
      @mousedown.prevent="keepSelectionToolbar = true"
      @mouseup="keepSelectionToolbar = false"
    >
      <button type="button" id="btnNote" @click="applySelectionNote">Note</button>
      <button type="button" id="btnUH" @click="removeSelectionHighlight">Remove</button>
      <button type="button" id="btnHL" @click="applySelectionHighlight('highlight')">Highlight</button>
    </div>

    <aside id="reading-note-drawer" :class="{ open: noteDrawerOpen }" aria-label="阅读笔记">
      <header class="reading-note-drawer-head">
        <div class="reading-note-drawer-title">
          <h3>Notes</h3>
        </div>
        <button class="reading-note-close" type="button" aria-label="关闭笔记列表" @click="noteDrawerOpen = false">×</button>
      </header>
      <div class="reading-note-list">
        <p v-if="!noteEntries.length" class="reading-note-empty">尚无笔记。划选原文后选择 Note 即可添加。</p>
        <div v-for="(note, index) in noteEntries" :key="note.id || note.text + index" class="reading-note-row">
          <button class="reading-note-open" type="button" :title="note.text" @click="locateNote(note)">{{ note.text }}</button>
        </div>
      </div>
    </aside>

    <UnifiedPracticeNav
      v-if="payload && !loading"
      :question-order="payload.questionOrder || []"
      :display-map="payload.questionDisplayMap || {}"
      :category="payload.meta?.category || asset?.category || 'P1'"
      :has-answer="hasAnswer"
      :answer-comparison="submission?.answerComparison || null"
      :active-question-id="activeQuestionId"
      :review-mode="reviewMode"
      :submit-disabled="!canSubmit"
      :reset-disabled="resetDisabled"
      @scroll-to-question="scrollToQuestion"
      @submit="submitAnswers"
      @reset="handleReset"
      @leave="handleLeaveReview"
    />

    <UnifiedOptionsPanel
      v-if="optionsOpen"
      :font-size="fontSize"
      :dark-mode="darkMode"
      :annotations="annotations"
      :question-nav-collapsed="questionNavCollapsed"
      :clear-disabled="reviewMode"
      @close="optionsOpen = false"
      @select-font="selectFontSize"
      @set-dark="setDarkMode"
      @toggle-annotation="toggleAnnotation"
      @toggle-question-nav="setQuestionNavCollapsed(!questionNavCollapsed)"
      @clear-answers="handleReset"
    />

    <p v-if="submitError" class="runified-status-error" role="alert">{{ submitError }}</p>
    <p class="sr-only" aria-live="polite">{{ dragInteractionStatus }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getOpenReadingDraft } from '@/api/reading-repository.js'
import { isTauriRuntime } from '@/api/tauri-bridge.js'
import { useReadingAsset } from '@/modules/practice-reading/useReadingAsset'
import { useReadingAnswers } from '@/modules/practice-reading/useReadingAnswers'
import { useReadingHighlights } from '@/modules/practice-reading/useReadingHighlights'
import { useReadingInteractions } from '@/modules/practice-reading/useReadingInteractions'
import { useReadingTimer } from '@/modules/practice-reading/useReadingTimer'
import { useReadingAttempt } from '@/modules/practice-reading/useReadingAttempt'
import { normalizeComparableText } from '@/modules/practice-reading/readingHighlightCore.js'
import {
  escapeCss,
  expandQuestionSequence,
  normalizeQuestionId,
  resolveAnswerAliases as resolveAnswerAliasesFromIds
} from '@/modules/practice-reading/readingQuestionIds'
import UnifiedOptionsPanel from '@/modules/reading-unified/components/UnifiedOptionsPanel.vue'
import UnifiedPracticeNav from '@/modules/reading-unified/components/UnifiedPracticeNav.vue'
import { useUnifiedDisplay } from '@/modules/reading-unified/composables/useUnifiedDisplay.js'
import {
  buildResultRows,
  normalizeExplanationSections,
  sectionsForGroup
} from '@/modules/reading-unified/explanationCore.js'

const props = defineProps({
  assetId: { type: String, required: true }
})

const route = useRoute()
const router = useRouter()
const {
  rootClassList,
  fontSize,
  darkMode,
  annotations,
  questionNavCollapsed,
  initializeDisplayPreferences,
  selectFontSize,
  toggleAnnotation,
  setDarkMode,
  setQuestionNavCollapsed
} = useUnifiedDisplay()
const {
  asset,
  payload,
  loading,
  error,
  loadReadingAsset
} = useReadingAsset()
const readingAttempt = useReadingAttempt()

const submitting = ref(false)
const submitError = ref('')
const submission = ref(null)
const reviewExplanations = ref(null)
const optionsOpen = ref(false)
const noteDrawerOpen = ref(false)
const activeQuestionId = ref('')
const leftPanePercent = ref(50)
let dividerDragging = false
let dividerPointerId = null
let draftAutosaveTimer = null
let tauriAttemptId = ''

const reviewMode = computed(() => Boolean(submission.value))
const readOnlyMode = computed(() => reviewMode.value)
const loadError = computed(() => (error.value ? String(error.value.message || error.value) : ''))

const {
  answeredCount,
  initializeAnswers,
  assignAnswer,
  setAnswer,
  getAnswerValue,
  getRawAnswer,
  getAnswerEntries,
  hasAnswer,
  snapshotAnswers: snapshotAnswerMap
} = useReadingAnswers({
  payloadSource: () => payload.value,
  readOnlySource: readOnlyMode,
  onSyncNative: syncNativeControl,
  onMutate: () => { submitError.value = '' }
})

const {
  dragInteractionStatus,
  getInteraction,
  getDisplayLabel,
  isDragDropControl,
  handleWorkspaceClick,
  handleWorkspaceKeydown,
  handleDragStart,
  handleDragEnd,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  syncDropzoneControl,
  syncPoolConsumedState,
  setReadOnlyDomControls
} = useReadingInteractions({
  payloadSource: () => payload.value,
  readOnlyModeSource: readOnlyMode,
  getAnswerValue,
  getRawAnswer,
  assignAnswer
})

const {
  elapsedSeconds,
  timerRunning,
  formattedTimer,
  applyPracticeTimerState,
  getPracticeTimerSnapshot,
  startPracticeTimer,
  stopPracticeTimer,
  toggleTimer: togglePracticeTimer,
  resetPracticeTimerClock,
  setPracticeTimerElapsedSeconds
} = useReadingTimer({
  reviewMode,
  onAutoSubmit: () => submitAnswers()
})

const {
  selectionToolbarVisible,
  selectionToolbarStyle,
  keepSelectionToolbar,
  highlightSnapshot,
  resetHighlightUiState,
  applySelectionHighlight,
  applySelectionNote,
  removeSelectionHighlight,
  attachHighlightDocumentListeners,
  detachHighlightDocumentListeners,
  hydrateHighlightsFromStore,
  restoreHighlightsFromRecords
} = useReadingHighlights({
  assetIdSource: () => asset.value?.id || props.assetId,
  reviewModeSource: () => reviewMode.value,
  getAttemptId: () => tauriAttemptId,
  ensureAttemptId: () => {
    if (!tauriAttemptId) {
      tauriAttemptId = readingAttempt.newAttemptId()
    }
    return tauriAttemptId
  },
  onAttemptEnsured: () => { void persistTauriDraft() },
  onInteraction: () => {}
})

const canSubmit = computed(() => Boolean(
  asset.value
  && payload.value
  && !loading.value
  && !submitting.value
  && !readOnlyMode.value
))
const resetDisabled = computed(() => submitting.value || (!reviewMode.value && answeredCount.value === 0))
// The original freezes the timer at its elapsed value on submit (paused style);
// it never shows a textual replacement.
const timerText = computed(() => formattedTimer.value)

const partIndex = computed(() => {
  const category = String(payload.value?.meta?.category || asset.value?.category || 'P1').toUpperCase()
  if (category === 'P2') return 2
  if (category === 'P3') return 3
  return 1
})
const subHeaderInstruction = computed(() => {
  // Mirrors the original: "Read the text and answer questions 1-13." derived
  // from the display labels of the loaded exam.
  const order = Array.isArray(payload.value?.questionOrder) ? payload.value.questionOrder : []
  if (!order.length) return ''
  const displayMap = payload.value?.questionDisplayMap || {}
  const labels = order
    .map((questionId) => Number(String(displayMap[questionId] || String(questionId).replace(/^q/i, '')).match(/\d+/)?.[0]))
    .filter((value) => Number.isFinite(value))
  if (!labels.length) return ''
  const first = Math.min(...labels)
  const last = Math.max(...labels)
  return first === last
    ? `Read the text and answer question ${first}.`
    : `Read the text and answer questions ${first}-${last}.`
})
const passageBlocks = computed(() => (
  Array.isArray(payload.value?.passage?.blocks) ? payload.value.passage.blocks : []
))
const questionGroups = computed(() => (
  Array.isArray(payload.value?.questionGroups) ? payload.value.questionGroups : []
))

const explanationSections = computed(() => (
  normalizeExplanationSections(reviewExplanations.value?.questionExplanations)
))
const passageNotes = computed(() => {
  const notes = reviewExplanations.value?.passageNotes
  return Array.isArray(notes)
    ? notes
        .map((note, index) => ({
          label: String(note?.label || `第 ${index + 1} 段`).trim(),
          text: String(note?.text || '').trim()
        }))
        .filter((note) => note.text)
    : []
})
const groupExplanations = computed(() => {
  const map = {}
  if (!reviewMode.value) return map
  for (const group of questionGroups.value) {
    map[group.groupId] = sectionsForGroup(explanationSections.value, group, payload.value?.questionDisplayMap || {})
  }
  return map
})
const resultRows = computed(() => (
  buildResultRows(
    submission.value?.answerComparison || {},
    payload.value?.questionOrder || [],
    payload.value?.questionDisplayMap || {}
  )
))
const noteEntries = computed(() => (
  highlightSnapshot.value.filter((entry) => entry.kind === 'note')
))
const noteCount = computed(() => noteEntries.value.length)

onMounted(async () => {
  await initializeDisplayPreferences()
  attachHighlightDocumentListeners()
  await loadAsset()
})

onBeforeUnmount(() => {
  stopPracticeTimer()
  if (!reviewMode.value && isTauriRuntime()) {
    void persistTauriDraft().catch((unmountError) => {
      console.warn('unified reading page: draft save on unmount failed', unmountError)
    })
  }
  if (draftAutosaveTimer) {
    clearTimeout(draftAutosaveTimer)
    draftAutosaveTimer = null
  }
  detachHighlightDocumentListeners()
  removeDividerDragListeners()
})

onUpdated(() => {
  if (!asset.value?.id || !payload.value?.questionOrder?.length) return
  syncDomAnswers()
  if (readOnlyMode.value) setReadOnlyDomControls(true)
})

watch(() => props.assetId, () => { void loadAsset() })

watch(
  () => ({
    assetId: asset.value?.id || '',
    answers: JSON.stringify(snapshotAnswerMap()),
    readOnly: readOnlyMode.value
  }),
  async () => {
    if (!asset.value?.id) return
    await nextTick()
    syncDomAnswers()
    syncPoolConsumedState()
    if (readOnlyMode.value) setReadOnlyDomControls(true)
  },
  { flush: 'post' }
)

// Post-submit feedback: mirror the original applyResultsToQuestionArea — mark
// chosen options green/red and dropzones correct/wrong inside the question area.
// canonicalToken mirrors the bundle's canonicalizeAnswerToken: punctuation and
// boolean foldings, single letters uppercased, everything else case-preserved.
function canonicalToken(value) {
  const cleaned = String(value ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'`()[\]{}<>.,;:!?]+|[\s"'`()[\]{}<>.,;:!?]+$/g, '')
  if (!cleaned) return ''
  const lowered = cleaned.toLowerCase()
  if (['true', 't', 'yes', 'y'].includes(lowered)) return 'true'
  if (['false', 'f', 'no', 'n'].includes(lowered)) return 'false'
  if (['ng', 'notgiven', 'not-given'].includes(lowered)) return 'not given'
  if (/^[a-z]$/i.test(cleaned)) return cleaned.toUpperCase()
  const leadingOption = cleaned.match(/^([A-Za-z])[.)]\s+/)
  if (leadingOption && cleaned.length > 2) return leadingOption[1].toUpperCase()
  return cleaned
}

function collectChoiceInputs(questionId) {
  const inputs = []
  for (const alias of resolveAnswerAliasesFromIds(questionId, payload.value?.questionDisplayMap || null)) {
    const escaped = escapeCss(alias)
    document.querySelectorAll(
      `input[type="radio"][name="${escaped}"], input[type="checkbox"][name="${escaped}"]`
    ).forEach((input) => inputs.push(input))
  }
  return inputs
}

function applyResultsToQuestionArea() {
  document.querySelectorAll(
    '.option-correct, .option-wrong, .drop-target-summary.correct, .drop-target-summary.wrong, .paragraph-dropzone.correct, .paragraph-dropzone.wrong, .match-dropzone.correct, .match-dropzone.wrong, [data-result-filled="true"]'
  ).forEach((node) => {
    node.classList.remove('correct', 'wrong', 'option-correct', 'option-wrong')
    if (node.dataset?.resultFilled === 'true') {
      node.classList.remove('dropzone-filled')
      delete node.dataset.resultFilled
    }
  })
  const comparison = submission.value?.answerComparison || {}
  const groupEntries = new Map()
  Object.values(comparison).forEach((entry) => {
    const questionId = normalizeQuestionId(entry?.questionId)
    const inputNodes = collectChoiceInputs(questionId)
    if (!inputNodes.length) return
    const correctValues = (Array.isArray(entry?.correctAnswer) ? entry.correctAnswer : [entry?.correctAnswer])
      .map(canonicalToken)
      .filter(Boolean)
    if (!correctValues.length) return
    const groupKey = inputNodes[0].name || questionId
    if (!groupEntries.has(groupKey)) {
      groupEntries.set(groupKey, { inputs: inputNodes, correctValues: new Set(), userValues: new Set() })
    }
    const group = groupEntries.get(groupKey)
    correctValues.forEach((value) => group.correctValues.add(value))
    ;(Array.isArray(entry?.userAnswer) ? entry.userAnswer : [entry?.userAnswer])
      .map(canonicalToken)
      .filter(Boolean)
      .forEach((value) => group.userValues.add(value))
  })
  groupEntries.forEach((group) => {
    group.inputs.forEach((input) => {
      const target = input.closest('label') || input.parentElement
      const value = canonicalToken(input.value)
      if (!target || !value) return
      if (group.correctValues.has(value)) {
        target.classList.add('option-correct')
      } else if (input.checked || group.userValues.has(value)) {
        target.classList.add('option-wrong')
      }
    })
  })
  Object.values(comparison).forEach((entry) => {
    const questionId = normalizeQuestionId(entry?.questionId)
    if (collectChoiceInputs(questionId).length) return
    if (entry?.isCorrect !== true && entry?.isCorrect !== false) return
    for (const alias of resolveAnswerAliasesFromIds(questionId, payload.value?.questionDisplayMap || null)) {
      const escaped = escapeCss(alias)
      const dropzone = document.querySelector(
        `.drop-target-summary[data-question="${escaped}"], .paragraph-dropzone[data-question="${escaped}"], .match-dropzone[data-question="${escaped}"]`
      )
      if (dropzone) {
        dropzone.classList.add(entry.isCorrect ? 'correct' : 'wrong')
        if (!dropzone.classList.contains('dropzone-filled')) {
          dropzone.classList.add('dropzone-filled')
          dropzone.dataset.resultFilled = 'true'
        }
        break
      }
    }
  })
}

// Runs on both transitions: entering review applies marks, leaving review
// (Reset) clears them — the clearing pass at the top handles the empty case.
watch(reviewMode, async () => {
  await nextTick()
  applyResultsToQuestionArea()
})

async function loadAsset() {
  const normalizedAssetId = String(props.assetId || route.params.assetId || '').trim()
  if (!normalizedAssetId) return
  submission.value = null
  reviewExplanations.value = null
  submitError.value = ''
  resetHighlightUiState()
  resetPracticeTimerClock()
  try {
    const data = await loadReadingAsset(normalizedAssetId)
    initializeAnswers(data?.payload)
    if (isTauriRuntime()) {
      await hydrateOpenDraft(normalizedAssetId)
    }
  } catch (assetError) {
    console.error('unified reading page: load failed', assetError)
    return
  }
  if (asset.value && payload.value) {
    await nextTick()
    syncDomAnswers()
    if (isTauriRuntime()) {
      await hydrateHighlightsFromStore(asset.value.id, tauriAttemptId || null, null)
    }
    restoreHighlightsFromRecords(highlightSnapshot.value)
    if (readOnlyMode.value) {
      setPracticeTimerElapsedSeconds(Math.max(0, Number(submission.value?.duration || 0)))
      setReadOnlyDomControls(true)
    } else {
      startPracticeTimer()
    }
  }
}

async function hydrateOpenDraft(assetIdValue) {
  try {
    const { attempt, timer } = await getOpenReadingDraft(assetIdValue, null, null)
    if (!attempt?.id) return
    tauriAttemptId = String(attempt.id)
    if (timer) applyPracticeTimerState(timer)
    for (const entry of attempt.answers || []) {
      const questionId = String(entry.questionId || entry.question_id || '').trim()
      if (questionId && entry.answer != null) {
        setAnswer(questionId, entry.answer)
      }
    }
  } catch (draftError) {
    console.warn('unified reading page: draft hydration failed', draftError)
  }
}

function handleQuestionInput(event) {
  if (readOnlyMode.value) return
  const target = event.target
  if (!target || !target.name) return
  if (target.type === 'checkbox') {
    collectCheckboxGroup(target.name)
    scheduleDraftAutosave()
    return
  }
  const questionId = normalizeQuestionId(target.name)
  if (!questionId) return
  if (target.type === 'radio') {
    if (target.checked) {
      setAnswer(questionId, target.value)
      scheduleDraftAutosave()
    }
    return
  }
  setAnswer(questionId, target.value)
  scheduleDraftAutosave()
}

function collectCheckboxGroup(name) {
  const questionIds = expandQuestionSequence(name)
  if (!questionIds.length) return
  const checkedValues = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${escapeCss(name)}"]`))
    .filter((input) => input.checked)
    .map((input) => String(input.value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'en'))
  questionIds.forEach((questionId, index) => {
    setAnswer(questionId, checkedValues[index] || '')
  })
}

function syncDomAnswers() {
  getAnswerEntries().forEach(([questionId, value]) => {
    syncNativeControl(questionId, value)
  })
}

function syncNativeControl(questionId, explicitValue = getRawAnswer(questionId)) {
  if (typeof document === 'undefined') return
  const interaction = getInteraction(questionId)
  // Bundled payloads carry no interactionModel: questions whose native markup
  // has dropzones route to the dropzone sync (isDragDropControl falls back).
  if (interaction?.control === 'dragdrop' || (!interaction?.control && isDragDropControl(questionId))) {
    syncDropzoneControl(questionId, explicitValue)
    return
  }
  const names = new Set(resolveAnswerAliasesFromIds(questionId, payload.value?.questionDisplayMap || null))
  if (interaction?.name) names.add(interaction.name)
  names.forEach((name) => {
    const escaped = escapeCss(name)
    document.querySelectorAll(`input[type="radio"][name="${escaped}"]`).forEach((input) => {
      input.checked = String(input.value || '').trim() === String(explicitValue || '').trim()
      input.disabled = readOnlyMode.value
    })
    document.querySelectorAll(`input[type="text"][name="${escaped}"], textarea[name="${escaped}"]`).forEach((input) => {
      input.value = String(explicitValue || '')
      input.disabled = readOnlyMode.value
    })
  })
}

function scheduleDraftAutosave() {
  if (!isTauriRuntime() || readOnlyMode.value) return
  if (draftAutosaveTimer) clearTimeout(draftAutosaveTimer)
  draftAutosaveTimer = setTimeout(() => {
    draftAutosaveTimer = null
    void persistTauriDraft().catch((draftError) => {
      console.warn('unified reading page: draft autosave failed', draftError)
    })
  }, 800)
}

async function persistTauriDraft() {
  if (!isTauriRuntime() || !asset.value?.id || readOnlyMode.value) return
  if (!tauriAttemptId) tauriAttemptId = readingAttempt.newAttemptId()
  await readingAttempt.persistDraft({
    attemptId: tauriAttemptId,
    assetId: asset.value.id,
    assetRevision: asset.value.schemaVersion ?? null,
    assetFingerprint: asset.value.fingerprint || null,
    answers: snapshotAnswerMap(),
    markedQuestions: [],
    questionTimeline: [],
    titleSnapshot: asset.value.title || asset.value.name || null,
    timerSnapshot: getPracticeTimerSnapshot()
  })
}

function handleReset() {
  if (reviewMode.value) {
    // Post-submit Reset: back to a fresh practice attempt, like the unified page.
    submission.value = null
    reviewExplanations.value = null
    tauriAttemptId = ''
    resetHighlightUiState()
    initializeAnswers(payload.value)
    resetPracticeTimerClock()
    void nextTick(() => {
      syncDomAnswers()
      setReadOnlyDomControls(false)
      startPracticeTimer()
    })
    return
  }
  if (submitting.value || answeredCount.value === 0) return
  if (!window.confirm('确定要清空全部作答吗？')) return
  initializeAnswers(payload.value)
  void nextTick(() => {
    syncDomAnswers()
  })
}

async function submitAnswers() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = ''
  stopPracticeTimer()
  try {
    await nextTick()
    const { submission: nextSubmission } = await readingAttempt.submit({
      attemptId: tauriAttemptId || undefined,
      assetId: asset.value.id,
      assetRevision: asset.value.schemaVersion ?? null,
      assetFingerprint: asset.value.fingerprint || null,
      answers: snapshotAnswerMap(),
      markedQuestions: [],
      questionTimeline: [],
      durationMs: Math.max(0, elapsedSeconds.value) * 1000,
      titleSnapshot: asset.value.title || null
    })
    submission.value = nextSubmission
    setPracticeTimerElapsedSeconds(Math.max(0, Number(nextSubmission?.duration || 0)))
    await nextTick()
    syncDomAnswers()
    setReadOnlyDomControls(true)
    await loadExplanations()
  } catch (submitFailure) {
    submitError.value = submitFailure?.message || '提交失败，请重试。'
    startPracticeTimer()
  } finally {
    submitting.value = false
  }
}

function loadExplanations() {
  // Explanations ride inside the exam payload itself (same source as
  // PracticeReadingPage's officialReviewExplanations); no separate IPC fetch.
  reviewExplanations.value = payload.value?.reviewExplanations || null
}

function handleLeaveReview() {
  // Exit review: go back to where the user came from; the practice library
  // (route '/' / PracticeLibrary) is the fallback when history is empty.
  if (window.history?.state?.back == null) {
    router.push({ name: 'PracticeLibrary' })
    return
  }
  router.back()
}

function scrollToQuestion(questionId) {
  const normalized = normalizeQuestionId(questionId)
  const aliases = resolveAnswerAliasesFromIds(normalized, payload.value?.questionDisplayMap || null)
  const candidates = [normalized, ...aliases]
  for (const alias of candidates) {
    const anchor = document.getElementById(`${alias}-anchor`)
    if (anchor) {
      anchor.scrollIntoView({ block: 'center', behavior: 'smooth' })
      activeQuestionId.value = normalized
      return
    }
  }
  for (const alias of candidates) {
    const control = document.querySelector(`[name="${escapeCss(alias)}"]`)
    if (control) {
      control.closest('.question-item, .unified-group, li, p')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      activeQuestionId.value = normalized
      return
    }
  }
}

function groupRangeLabel(group) {
  const ids = Array.isArray(group.questionIds) ? group.questionIds : []
  if (!ids.length) return '题目'
  const labels = ids.map((questionId) => getDisplayLabel(questionId)).filter(Boolean)
  if (labels.length <= 1) return `第 ${labels[0] || ''} 题`
  return `第 ${labels[0]}-${labels[labels.length - 1]} 题`
}

function locateNote(note) {
  // Persisted notes carry an annotation id; unsynced ones are located by their text.
  let anchor = note.id
    ? document.querySelector(`[data-note-id="${escapeCss(note.id)}"], [data-annotation-id="${escapeCss(note.id)}"]`)
    : null
  if (!anchor) {
    const candidates = document.querySelectorAll('#left .hl[data-hl-type="note"], #left .hl[data-note-id]')
    anchor = Array.from(candidates).find((node) => normalizeComparableText(node.textContent) === note.text) || null
  }
  if (!anchor) return
  anchor.scrollIntoView({ block: 'center', behavior: 'smooth' })
  anchor.classList.add('reading-note-flash')
  setTimeout(() => anchor.classList.remove('reading-note-flash'), 1200)
}

function startDividerDrag(event) {
  if (!event || (Number.isFinite(Number(event.button)) && event.button > 0)) return
  const shell = document.querySelector('.runified .shell')
  if (!shell) return
  event.preventDefault()
  dividerDragging = true
  dividerPointerId = event.pointerId
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  document.addEventListener('pointermove', handleDividerDrag)
  document.addEventListener('pointerup', stopDividerDrag)
  document.addEventListener('pointercancel', stopDividerDrag)
  handleDividerDrag(event)
}

function handleDividerDrag(event) {
  if (!dividerDragging || !event) return
  const shell = document.querySelector('.runified .shell')
  if (!shell) return
  const rect = shell.getBoundingClientRect()
  if (!rect.width) return
  const percent = ((event.clientX - rect.left) / rect.width) * 100
  leftPanePercent.value = Math.max(34, Math.min(66, percent))
}

function stopDividerDrag(event) {
  dividerDragging = false
  const divider = document.getElementById('divider')
  try {
    if (divider && dividerPointerId != null) divider.releasePointerCapture?.(dividerPointerId)
  } catch (_) {}
  dividerPointerId = null
  removeDividerDragListeners()
}

function removeDividerDragListeners() {
  document.removeEventListener('pointermove', handleDividerDrag)
  document.removeEventListener('pointerup', stopDividerDrag)
  document.removeEventListener('pointercancel', stopDividerDrag)
}

function handleDividerKeydown(event) {
  const step = event.shiftKey ? 8 : 3
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    leftPanePercent.value = Math.max(34, leftPanePercent.value - step)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    leftPanePercent.value = Math.min(66, leftPanePercent.value + step)
  }
}
</script>

<style scoped>
/* The unified skin ships as a plain stylesheet scoped under .runified (loaded
   below via the src attribute); the page itself only adds the fixed
   full-viewport mount that escapes the SPA shell padding. */
#runified-root {
  position: fixed;
  inset: 0;
  z-index: 3000;
}
.runified-error {
  grid-row: 3;
  align-self: center;
  justify-self: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--incorrect);
}
.runified-status-error {
  position: fixed;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  margin: 0;
  padding: 8px 14px;
  background: var(--incorrect-bg);
  color: var(--incorrect);
  border: 1px solid var(--incorrect);
  font-size: 13px;
  z-index: 5000;
}
.reading-note-empty {
  padding: 10px;
  color: #64748b;
  font-size: 13px;
}
</style>

<style src="@/modules/reading-unified/styles/unified.css"></style>
