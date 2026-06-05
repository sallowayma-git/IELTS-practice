<template>
  <div class="reading-page" :class="readingPageClassList" :style="readingPageStyle">
    <header class="reading-header header">
      <div class="header-content">
        <h1 id="exam-title">{{ pageTitle }}</h1>
        <p id="exam-subtitle">{{ headerSummary }}</p>
      </div>
      <div
        v-if="showSuiteReviewNav"
        id="review-nav-bar"
        class="review-nav-bar"
        :data-review-index="suiteReviewNavIndex"
        :data-review-total="suiteReviewNavTotal"
        data-view-mode="review"
      >
        <button
          type="button"
          data-review-dir="prev"
          :disabled="!canNavigateSuiteReviewPrev"
          @click="navigateSuiteReview('prev')"
        >
          上一题
        </button>
        <button
          type="button"
          data-review-dir="next"
          :disabled="!canNavigateSuiteReviewNext"
          @click="navigateSuiteReview('next')"
        >
          下一题
        </button>
      </div>
      <div class="reading-header-actions header-controls">
        <button
          v-if="payload"
          id="timer"
          class="reading-stat reading-timer"
          type="button"
          :class="{ paused: !timerRunning && !reviewMode }"
          :disabled="reviewMode"
          :title="timerRunning ? '暂停计时' : '继续计时'"
          data-reading-timer
          @click="toggleTimer"
        >
          {{ formattedTimer }}
        </button>
        <button
          v-if="payload"
          class="header-btn"
          id="settings-btn"
          title="Settings"
          type="button"
          @click="toggleSettingsPanel"
        >
          ☰
        </button>
        <button
          v-if="payload"
          class="header-btn"
          id="note-btn"
          type="button"
          @click="toggleNotesPanel"
        >
          Note
        </button>
      </div>
    </header>

    <div v-if="error" class="inline-message inline-message-error">
      <span>{{ error }}</span>
      <button class="btn-text" type="button" @click="loadAsset">重试</button>
    </div>

    <div v-if="loading" class="surface loading">正在加载阅读题目...</div>

    <div v-if="submitError" class="inline-message inline-message-error">
      <span>{{ submitError }}</span>
    </div>

    <div
      id="settings-panel"
      class="reading-floating-panel reading-settings-panel"
      v-show="settingsPanelOpen"
    >
      <div class="settings-section">
        <h3 class="settings-title">字号调整</h3>
        <div class="settings-options">
          <button
            v-for="option in fontSizeOptions"
            :key="option.value"
            class="settings-option"
            :class="{ active: readingFontSize === option.value }"
            type="button"
            :data-size="option.value"
            :style="option.style"
            @click="selectReadingFont(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-title">背景颜色</h3>
        <div class="settings-options">
          <button
            v-for="option in themeModeOptions"
            :key="option.value"
            class="settings-option"
            :class="{ active: readingThemeMode === option.value }"
            type="button"
            :data-mode="option.value"
            @click="selectReadingTheme(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div class="settings-section" id="reading-coach-setting-section">
        <h3 class="settings-title">AI 教练</h3>
        <div class="settings-options">
          <button
            class="settings-option"
            type="button"
            data-reading-coach-enabled="true"
            :class="{ active: readingCoachEnabled === true }"
            :disabled="readingCoachSettingSaving"
            @click="updateReadingCoachEnabled(true)"
          >
            开启
          </button>
          <button
            class="settings-option"
            type="button"
            data-reading-coach-enabled="false"
            :class="{ active: readingCoachEnabled === false }"
            :disabled="readingCoachSettingSaving"
            @click="updateReadingCoachEnabled(false)"
          >
            关闭
          </button>
        </div>
        <p v-if="readingCoachSettingError" class="settings-help settings-help-error">
          {{ readingCoachSettingError }}
        </p>
      </div>
      <div
        v-if="activeSuiteSessionId"
        class="settings-section"
        id="suite-flow-mode-section"
      >
        <h3 class="settings-title">套题流程模式</h3>
        <div class="settings-options">
          <button
            class="settings-option"
            type="button"
            data-suite-flow-mode="auto"
            :class="{ active: suiteAutoAdvance === true }"
            @click="setSuiteAutoAdvance(true)"
          >
            自动跳转下一篇
          </button>
          <button
            class="settings-option"
            type="button"
            data-suite-flow-mode="manual"
            :class="{ active: suiteAutoAdvance === false }"
            @click="setSuiteAutoAdvance(false)"
          >
            提交后停留回看
          </button>
        </div>
      </div>
    </div>

    <div
      id="notes-panel"
      class="reading-floating-panel reading-notes-panel"
      v-show="notesPanelOpen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-panel-title"
    >
      <header>
        <h3 id="notes-panel-title">Notes</h3>
        <button id="close-note" type="button" @click="closeFloatingPanels">Close</button>
      </header>
      <textarea v-model="notesText" aria-label="阅读笔记"></textarea>
    </div>
    <div class="overlay" v-show="settingsPanelOpen || notesPanelOpen" @click="closeFloatingPanels"></div>

    <div
      id="selbar"
      class="reading-selection-toolbar"
      v-show="selectionToolbarVisible"
      :style="selectionToolbarStyle"
      @mousedown.prevent="keepSelectionToolbar = true"
      @mouseup="keepSelectionToolbar = false"
    >
      <button type="button" id="btnHL" data-role="highlight" @click="applySelectionHighlight('highlight')">Highlight</button>
      <button type="button" id="btnUH" data-role="remove-highlight" @click="removeSelectionHighlight">Remove</button>
      <button type="button" id="btnNote" data-role="note" @click="applySelectionNote">Note</button>
    </div>

    <div
      v-if="dictionaryBubble.visible"
      id="review-highlight-dictionary-bubble"
      class="review-highlight-dictionary-bubble"
      role="dialog"
      aria-live="polite"
      :style="{ left: `${dictionaryBubble.left}px`, top: `${dictionaryBubble.top}px` }"
    >
      <div class="vocab-bubble-head">
        <div>
          <h4 class="vocab-term">{{ dictionaryBubble.term }}</h4>
          <div v-if="dictionaryBubble.meta" class="vocab-meta">{{ dictionaryBubble.meta }}</div>
        </div>
        <button class="vocab-close" type="button" aria-label="关闭" @click="closeDictionaryBubble">×</button>
      </div>
      <template v-if="dictionaryBubble.parts.length">
        <div
          v-for="part in dictionaryBubble.parts"
          :key="part.term + part.meaning"
          class="vocab-part"
        >
          <div class="vocab-term vocab-part-term">{{ part.term }}</div>
          <div v-if="part.meta" class="vocab-meta">{{ part.meta }}</div>
          <div v-if="part.meaning" class="vocab-section">
            <div class="vocab-label">中文释义</div>
            <div class="vocab-text">{{ part.meaning }}</div>
          </div>
          <div v-if="part.definition" class="vocab-section">
            <div class="vocab-label">英文释义</div>
            <div class="vocab-text">{{ part.definition }}</div>
          </div>
        </div>
      </template>
      <div v-else class="vocab-section">
        <div class="vocab-label">{{ dictionaryBubble.found ? '释义' : '未收录' }}</div>
        <div class="vocab-text">{{ dictionaryBubble.meaning || '未找到该高亮内容。可先加入阅读高亮生词，后续在单词背诵中补充释义。' }}</div>
      </div>
      <div v-if="dictionaryBubble.definition" class="vocab-section">
        <div class="vocab-label">英文释义</div>
        <div class="vocab-text">{{ dictionaryBubble.definition }}</div>
      </div>
      <div v-if="dictionaryBubble.example" class="vocab-section">
        <div class="vocab-label">例句</div>
        <div class="vocab-text">{{ dictionaryBubble.example }}</div>
      </div>
      <div v-if="dictionaryBubble.sourceLine" class="vocab-section">
        <div class="vocab-label">来源</div>
        <div class="vocab-text">{{ dictionaryBubble.sourceLine }}</div>
      </div>
      <div class="vocab-actions">
        <button
          class="vocab-add"
          type="button"
          :disabled="dictionaryBubble.saved"
          @click="saveDictionaryBubbleWord"
        >
          {{ dictionaryBubble.saved ? '已加入' : '加入生词本' }}
        </button>
      </div>
    </div>

    <div v-if="isEndlessMode" class="inline-message endless-message" data-reading-endless-mode>
      <span>{{ endlessStatusText }}</span>
      <div class="endless-actions">
        <button v-if="endlessNextAssetId" class="btn-text" type="button" @click="goToNextEndlessAsset">下一篇</button>
        <button class="btn-text" type="button" @click="stopEndlessMode">退出无尽模式</button>
      </div>
    </div>

    <section
      v-if="!loading && asset && payload"
      class="reading-workspace shell"
      :class="{ 'review-mode': reviewMode, 'memorize-mode': isMemorizeMode }"
      :style="readingWorkspaceStyle"
      data-practice-reading-page
      @click="handleWorkspaceClick"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <ReadingPassagePane
        :passage-blocks="payload.passage.blocks"
        :official-passage-notes="officialPassageNotes"
      />

      <div
        id="divider"
        :class="{ 'is-dragging': dividerDragging }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整原文和题目宽度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(leftPanePercent)"
        tabindex="0"
        @pointerdown="startDividerDrag"
        @keydown="handleDividerKeydown"
      ></div>

      <ReadingQuestionPane
        :payload="payload"
        :is-memorize-mode="isMemorizeMode"
        :get-group-official-explanations="getGroupOfficialExplanations"
        :get-group-range="getGroupRange"
        :normalize-question-id="normalizeQuestionId"
        :get-display-label="getDisplayLabel"
        :format-review-answer="formatReviewAnswer"
        @question-input="handleQuestionInput"
      >
        <ReadingReviewPanel
          :submission="submission"
          :payload="payload"
          :analysis-signals="analysisSignals"
          :single-attempt-analysis="singleAttemptAnalysis"
          :single-attempt-analysis-llm="singleAttemptAnalysisLlm"
          :llm-review-status="llmReviewStatus"
          :llm-review-message="llmReviewMessage"
          :single-attempt-llm-diagnosis="singleAttemptLlmDiagnosis"
          :single-attempt-llm-actions="singleAttemptLlmActions"
          :single-attempt-llm-question-analyses="singleAttemptLlmQuestionAnalyses"
          :analysis-kind-rows="analysisKindRows"
          :format-duration="formatDuration"
          :format-density="formatDensity"
          :get-severity-label="getSeverityLabel"
          :get-question-kind-label="getQuestionKindLabel"
          :get-review-class="getReviewClass"
          :get-display-label="getDisplayLabel"
          :format-review-answer="formatReviewAnswer"
          :get-legacy-result-class="getLegacyResultClass"
          :get-review-label="getReviewLabel"
          @retry-review="runAutomaticReviewCoach"
        />
      </ReadingQuestionPane>
    </section>

    <ReadingCoachPanel
      v-if="readingCoachEnabled"
      :submission="submission"
      :reading-coach-open="readingCoachOpen"
      :coach-error="coachError"
      :coach-loading="coachLoading"
      :coach-status-text="coachStatusText"
      :selected-context="selectedContext"
      :coach-transcript="coachTranscript"
      :coach-response="coachResponse"
      :coach-quick-actions="coachQuickActions"
      :coach-selection-actions="coachSelectionActions"
      :coach-follow-ups="coachFollowUps"
      :coach-query="coachQuery"
      :can-ask-coach="canAskCoach"
      @toggle-panel="toggleReadingCoachPanel"
      @update:reading-coach-open="setReadingCoachOpen"
      @clear-selected-context="clearSelectedContext"
      @quick-action="runCoachQuickAction"
      @selection-action="runCoachSelectionAction"
      @follow-up="askCoachFollowUp"
      @update:coach-query="coachQuery = $event"
      @refresh-selected-context="refreshSelectedContext"
      @ask="askCoach"
    />

    <ReadingAnswerNav
      v-if="!loading && asset && payload"
      :asset="asset"
      :payload="payload"
      :suite-session="suiteSession"
      :answered-count="answeredCount"
      :return-route="returnRoute"
      :return-label="returnLabel"
      :reset-button-disabled="resetButtonDisabled"
      :reset-button-label="resetButtonLabel"
      :primary-button-disabled="primaryButtonDisabled"
      :primary-button-label="primaryButtonLabel"
      :loading="loading"
      :submitting="submitting"
      :read-only-mode="readOnlyMode"
      :snapshot-message="snapshotMessage"
      :has-answer="hasAnswer"
      :is-marked-question="isMarkedQuestion"
      :get-review-class="getReviewClass"
      :get-legacy-nav-status="getLegacyNavStatus"
      :is-active-question="isActiveQuestion"
      :get-display-label="getDisplayLabel"
      @scroll-to-question="scrollToQuestion"
      @toggle-marked-question="toggleMarkedQuestion"
      @reset="handleResetButton"
      @snapshot="snapshotAnswers"
      @primary="handlePrimaryButton"
    />

    <section v-if="!loading && !asset" class="surface empty-state">
      <strong>未找到阅读题目</strong>
      <span>返回练习库重新选择资源。</span>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { practiceReadingSuite, practiceSessions } from '@/api/practice-client.js'
import { readingCoachSettingsApi } from '@/modules/practice-reading/api'
import ReadingAnswerNav from '@/modules/practice-reading/components/ReadingAnswerNav.vue'
import ReadingCoachPanel from '@/modules/practice-reading/components/ReadingCoachPanel.vue'
import ReadingPassagePane from '@/modules/practice-reading/components/ReadingPassagePane.vue'
import ReadingQuestionPane from '@/modules/practice-reading/components/ReadingQuestionPane.vue'
import ReadingReviewPanel from '@/modules/practice-reading/components/ReadingReviewPanel.vue'
import { useReadingAsset } from '@/modules/practice-reading/useReadingAsset'
import { useReadingAnswers } from '@/modules/practice-reading/useReadingAnswers'
import { useReadingCoach } from '@/modules/practice-reading/useReadingCoach'
import { useReadingHighlights } from '@/modules/practice-reading/useReadingHighlights'
import { useReadingTimer } from '@/modules/practice-reading/useReadingTimer'

const ENDLESS_STATE_KEY = 'practice_reading_endless_state_v1'
const ENDLESS_COUNTDOWN_SEC = 5
const READING_NOTES_STORAGE_PREFIX = 'practice_reading_notes_'
const SUITE_AUTO_ADVANCE_STORAGE_KEY = 'suite_auto_advance_after_submit'
const VOCAB_FALLBACK_STORAGE_KEY = 'exam_system_vocab_list_reading_highlights'
const DICTIONARY_WORDLIST_SCRIPTS = [
  'assets/wordlists/ecdict_reading.bundle.js',
  'assets/wordlists/ielts_core.bundle.js'
]
const DICTIONARY_SERVICE_SCRIPT = 'js/core/dictionaryService.js'
const EXPLANATION_SPLIT_KINDS = new Set([
  'single_choice',
  'multi_choice',
  'true_false_not_given',
  'yes_no_not_given'
])
const coachQuickActions = [
  { id: 'hint', label: '给我提示' },
  { id: 'explain', label: '解释这题' },
  { id: 'review', label: '复盘错题' },
  { id: 'similar', label: '推荐同类题' }
]
const coachSelectionActions = [
  { id: 'explain_selection', label: '解释选中' },
  { id: 'locate_evidence', label: '定位证据' },
  { id: 'find_paraphrases', label: '同义替换' }
]
const fontSizeOptions = [
  { value: 'normal', label: 'A' },
  { value: 'large', label: 'A', style: { fontSize: '1.1rem' } },
  { value: 'xlarge', label: 'A', style: { fontSize: '1.25rem' } }
]
const themeModeOptions = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const props = defineProps({
  assetId: {
    type: String,
    required: true
  },
  sessionId: {
    type: String,
    default: ''
  },
  suiteSessionId: {
    type: String,
    default: ''
  }
})

const route = useRoute()
const router = useRouter()
const {
  asset,
  payload,
  loading,
  error,
  loadReadingAsset,
  loadReadingAssetPool,
  clearReadingAssetError
} = useReadingAsset()
const submitting = ref(false)
const submitError = ref('')
const snapshotMessage = ref('')
const submission = ref(null)
const suiteSession = ref(null)
const answerTimeline = reactive({})
const markedQuestions = ref([])
const interactionCount = ref(0)
const currentDragPayload = ref(null)
const endlessCountdown = ref(0)
const endlessNextAssetId = ref('')
const settingsPanelOpen = ref(false)
const notesPanelOpen = ref(false)
const notesText = ref('')
const readingFontSize = ref('normal')
const readingThemeMode = ref('light')
const readingCoachEnabled = ref(true)
const readingCoachSettingSaving = ref(false)
const readingCoachSettingError = ref('')
const suiteAutoAdvance = ref(true)
const leftPanePercent = ref(50)
const dividerDragging = ref(false)
let endlessTimer = null
let lastSelectionRange = null
let currentHighlightNode = null
let dividerPointerId = null
let suppressReadingNotesPersist = false
let reviewDictionaryRuntimePromise = null
const runtimeScriptPromises = new Map()
const activeQuestionVisit = {
  questionId: '',
  startedAtMs: 0
}
const activeQuestionId = ref('')

const activeSuiteSessionId = computed(() => {
  const fromProp = String(props.suiteSessionId || '').trim()
  const fromQuery = Array.isArray(route.query.suiteSessionId)
    ? route.query.suiteSessionId[0]
    : route.query.suiteSessionId
  return fromProp || String(fromQuery || '').trim()
})
const pageTitle = computed(() => payload.value?.meta?.title || asset.value?.title || '阅读练习')
function readRouteQueryValue(key) {
  const value = route.query?.[key]
  return Array.isArray(value) ? value[0] : value
}

function normalizePracticeModeQueryValue(value) {
  return String(value || '').trim().toLowerCase()
}

function shouldNormalizeLegacyMemorizeQuery() {
  return !String(props.sessionId || route.params.sessionId || '').trim()
    && !activeSuiteSessionId.value
    && normalizePracticeModeQueryValue(readRouteQueryValue('mode')) === 'review'
    && !normalizePracticeModeQueryValue(readRouteQueryValue('practiceMode'))
}

function normalizeLegacyMemorizeQuery() {
  if (!shouldNormalizeLegacyMemorizeQuery()) return false
  router.replace({
    name: route.name || 'PracticeReading',
    params: route.params,
    query: {
      ...route.query,
      mode: 'memorize',
      practiceMode: 'memorize'
    }
  })
  return true
}

const isEndlessMode = computed(() => {
  const mode = normalizePracticeModeQueryValue(readRouteQueryValue('mode'))
  return mode === 'endless' && !activeSuiteSessionId.value
})
const isMemorizeMode = computed(() => {
  const mode = normalizePracticeModeQueryValue(readRouteQueryValue('mode'))
  const practiceMode = normalizePracticeModeQueryValue(readRouteQueryValue('practiceMode'))
  return (mode === 'memorize' || practiceMode === 'memorize') && !props.sessionId
})
const headerSummary = computed(() => {
  if (!payload.value) return '从统一 Practice API 加载阅读题目。'
  const category = payload.value.meta?.category || asset.value?.category || 'Reading'
  const mode = activeSuiteSessionId.value
    ? 'Vue 套题阅读链路'
    : (isEndlessMode.value ? '无尽模式' : (isMemorizeMode.value ? '背题模式' : 'Vue 原生阅读链路'))
  return `${category} · ${payload.value.questionCount} 题 · ${mode}`
})
const returnRoute = computed(() => (
  activeSuiteSessionId.value
    ? { name: 'PracticeReadingSuite', params: { sessionId: activeSuiteSessionId.value } }
    : { name: 'PracticeLibrary' }
))
const returnLabel = computed(() => (activeSuiteSessionId.value ? '返回套题进度' : '返回练习库'))
const reviewMode = computed(() => Boolean(submission.value))
const readOnlyMode = computed(() => reviewMode.value || isMemorizeMode.value)
const {
  answeredCount,
  initializeAnswers: initializeReadingAnswers,
  assignAnswer,
  setAnswer,
  toggleAnswerOption,
  getAnswerValue,
  getRawAnswer,
  getAnswerEntries,
  hasAnswer,
  isOptionSelected,
  snapshotAnswers: snapshotAnswerMap,
  getAnswerFingerprint
} = useReadingAnswers({
  payloadSource: () => payload.value,
  readOnlySource: reviewMode,
  onTrack: recordAnswerTimeline,
  onSyncNative: syncNativeControl,
  onMutate: () => {
    snapshotMessage.value = ''
    submitError.value = ''
  }
})
const {
  elapsedSeconds,
  timerRunning,
  suiteTimerState,
  formattedTimer,
  applySuiteTimerState,
  getPracticeTimerSnapshot,
  resolvePracticeTiming,
  installPracticeTimerBridge,
  removePracticeTimerBridge,
  startPracticeTimer,
  stopPracticeTimer,
  toggleTimer,
  resetPracticeTimerClock,
  setPracticeTimerElapsedSeconds
} = useReadingTimer({
  activeSuiteSessionId,
  reviewMode,
  suiteTimerSource: () => suiteSession.value?.timer
})
const {
  coachQuery,
  coachLoading,
  coachError,
  coachResponse,
  selectedContext,
  readingCoachOpen,
  llmReviewStatus,
  llmReviewMessage,
  canAskCoach,
  coachStatusText,
  coachTranscript,
  coachFollowUps,
  resetReadingCoachState,
  setReadingCoachOpen,
  hydrateReadingCoachFromSubmission,
  toggleReadingCoachPanel,
  refreshSelectedContext,
  clearSelectedContext,
  askCoach,
  askCoachFollowUp,
  runCoachQuickAction,
  runCoachSelectionAction,
  runAutomaticReviewCoach,
  queueAutomaticReviewRefresh
} = useReadingCoach({
  submissionSource: () => submission.value,
  setSubmission: (nextSubmission) => {
    submission.value = nextSubmission
  },
  assetIdSource: () => submission.value?.examId || asset.value?.id || props.assetId,
  resolveCoachMode: () => {
    if (activeSuiteSessionId.value) return 'suite'
    if (isEndlessMode.value) return 'endless'
    return props.sessionId || route.params.sessionId ? 'review' : 'single'
  },
  readCoachEnabled: () => readingCoachEnabled.value,
  readSelectedContext,
  getDisplayLabel,
  formatReviewAnswer,
  flushActiveQuestionVisit,
  snapshotSubmission,
  onSubmissionHydrated: (loadedSubmission) => {
    restoreSubmittedMetadata(loadedSubmission)
    if (loadedSubmission?.answers) {
      Object.entries(loadedSubmission.answers).forEach(([questionId, value]) => {
        assignAnswer(questionId, value)
      })
    }
    syncDomAnswers()
  }
})
const {
  selectionToolbarVisible,
  selectionToolbarStyle,
  keepSelectionToolbar,
  highlightSnapshot,
  dictionaryBubble,
  normalizeHighlightSnapshot: normalizeHighlightSnapshotState,
  resetHighlightUiState: resetHighlightUiStateFromComposable
} = useReadingHighlights()
const canSubmit = computed(() => Boolean(asset.value && payload.value && !loading.value && !submitting.value && !readOnlyMode.value))
const canRecycleSubmittedAttempt = computed(() => Boolean(
  reviewMode.value
  && !activeSuiteSessionId.value
  && !isEndlessMode.value
  && !String(props.sessionId || route.params.sessionId || '').trim()
  && !submitting.value
))
const readingPageClassList = computed(() => ({
  [`font-${readingFontSize.value}`]: true,
  'dark-mode': readingThemeMode.value === 'dark',
  'reading-memorize-mode': isMemorizeMode.value,
  'reading-pane-resizing': dividerDragging.value
}))
const readingPageStyle = computed(() => ({
  '--reading-font-scale': readingFontSize.value === 'xlarge' ? '1.18' : (readingFontSize.value === 'large' ? '1.08' : '1')
}))
const readingWorkspaceStyle = computed(() => ({
  '--reading-left-pane-width': `${leftPanePercent.value}%`
}))
const primaryButtonLabel = computed(() => {
  if (submitting.value) return '提交中...'
  if (isMemorizeMode.value) return 'Exit'
  if (reviewMode.value) return '已提交'
  return 'Submit'
})
const primaryButtonDisabled = computed(() => {
  if (isMemorizeMode.value) return false
  return !canSubmit.value
})
const resetButtonLabel = computed(() => {
  if (isMemorizeMode.value) return '重置测试'
  return 'Reset'
})
const resetButtonDisabled = computed(() => {
  if (isMemorizeMode.value) return false
  if (reviewMode.value) return !canRecycleSubmittedAttempt.value
  return submitting.value
})
const endlessStatusText = computed(() => {
  if (endlessCountdown.value > 0 && endlessNextAssetId.value) {
    return `无尽模式：${endlessCountdown.value} 秒后进入下一篇`
  }
  return '无尽模式进行中，提交后会自动进入下一篇。'
})
const officialReviewExplanations = computed(() => (
  reviewMode.value && payload.value?.reviewExplanations
    ? payload.value.reviewExplanations
    : null
))
const officialPassageNotes = computed(() => {
  const notes = officialReviewExplanations.value?.passageNotes
  return Array.isArray(notes)
    ? notes
        .map((note, index) => ({
          label: String(note?.label || `Paragraph ${index + 1}`).trim(),
          text: String(note?.text || '').trim()
        }))
        .filter((note) => note.text)
    : []
})
const officialQuestionExplanationSections = computed(() => {
  const sections = officialReviewExplanations.value?.questionExplanations
  return Array.isArray(sections)
    ? sections
        .map((section, index) => normalizeOfficialQuestionExplanationSection(section, index))
        .filter(Boolean)
    : []
})
const suiteSequence = computed(() => (
  Array.isArray(suiteSession.value?.sequence) ? suiteSession.value.sequence : []
))
const currentSuitePassageIndex = computed(() => {
  const currentAssetId = String(asset.value?.id || props.assetId || route.params.assetId || '').trim()
  if (!currentAssetId) return -1
  return suiteSequence.value.findIndex((entry) => (
    String(entry?.assetId || '').trim() === currentAssetId
    || String(entry?.examId || '').trim() === currentAssetId
  ))
})
const suiteReviewNavIndex = computed(() => Math.max(0, currentSuitePassageIndex.value))
const suiteReviewNavTotal = computed(() => suiteSequence.value.length || 0)
const showSuiteReviewNav = computed(() => Boolean(
  reviewMode.value
  && activeSuiteSessionId.value
  && suiteSequence.value.length > 1
  && currentSuitePassageIndex.value >= 0
))
const canNavigateSuiteReviewPrev = computed(() => findSuiteReviewNavigationTarget('prev') !== null)
const canNavigateSuiteReviewNext = computed(() => findSuiteReviewNavigationTarget('next') !== null)
const analysisSignals = computed(() => submission.value?.analysisSignals || submission.value?.analysisArtifacts?.analysisSignals || null)
const singleAttemptAnalysis = computed(() => submission.value?.singleAttemptAnalysis || submission.value?.analysisArtifacts?.singleAttemptAnalysis || null)
const singleAttemptAnalysisLlm = computed(() => (
  submission.value?.singleAttemptAnalysisLlm
  || submission.value?.analysisArtifacts?.singleAttemptAnalysisLlm
  || null
))
const singleAttemptLlmDiagnosis = computed(() => (
  Array.isArray(singleAttemptAnalysisLlm.value?.diagnosis)
    ? singleAttemptAnalysisLlm.value.diagnosis
        .map((entry, index) => ({
          code: String(entry?.code || entry?.type || `coach_diag_${index + 1}`),
          reason: String(entry?.reason || entry?.message || '').trim()
        }))
        .filter((entry) => entry.reason)
    : []
))
const singleAttemptLlmActions = computed(() => (
  Array.isArray(singleAttemptAnalysisLlm.value?.nextActions)
    ? singleAttemptAnalysisLlm.value.nextActions
        .map((entry, index) => ({
          type: String(entry?.type || `coach_action_${index + 1}`),
          target: String(entry?.target || 'reading').trim() || 'reading',
          instruction: String(entry?.instruction || entry?.action || '').trim()
        }))
        .filter((entry) => entry.instruction)
    : []
))
const singleAttemptLlmQuestionAnalyses = computed(() => (
  Array.isArray(singleAttemptAnalysisLlm.value?.reviewQuestionAnalyses)
    ? singleAttemptAnalysisLlm.value.reviewQuestionAnalyses
        .map((entry, index) => {
          const rawQuestionNumber = String(entry?.questionNumber || entry?.questionId || '').replace(/^q/i, '').trim()
          const questionLabel = rawQuestionNumber ? `Q${rawQuestionNumber}` : `Q${index + 1}`
          return {
            questionLabel,
            likelyMistake: String(entry?.likelyMistake || '').trim(),
            whyUserChoseWrong: String(entry?.whyUserChoseWrong || '').trim(),
            whyCorrectAnswerWorks: String(entry?.whyCorrectAnswerWorks || '').trim(),
            whyWrongAnswerFails: String(entry?.whyWrongAnswerFails || '').trim(),
            nextRule: String(entry?.nextRule || '').trim()
          }
        })
        .filter((entry) => (
          entry.likelyMistake
          || entry.whyUserChoseWrong
          || entry.whyCorrectAnswerWorks
          || entry.whyWrongAnswerFails
          || entry.nextRule
        ))
    : []
))
const analysisKindRows = computed(() => {
  const rows = singleAttemptAnalysis.value?.radar?.byQuestionKind
  if (Array.isArray(rows) && rows.length) {
    return rows
  }
  const fallback = submission.value?.questionTypePerformance || {}
  return Object.values(fallback)
})

onMounted(async () => {
  initializeReadingPreferences()
  installPracticeTimerBridge()
  document.addEventListener('selectionchange', handleSelectionChange)
  document.addEventListener('click', handleDocumentClick, true)
  await loadReadingCoachPreference()
  await loadAsset()
})

onBeforeUnmount(() => {
  flushActiveQuestionVisit()
  clearEndlessTimer()
  stopPracticeTimer()
  removePracticeTimerBridge()
  document.removeEventListener('selectionchange', handleSelectionChange)
  document.removeEventListener('click', handleDocumentClick, true)
  removeDividerDragListeners()
})

onUpdated(() => {
  if (!asset.value?.id || !payload.value?.questionOrder?.length) {
    return
  }
  syncDomAnswers()
  if (reviewMode.value) {
    setReadOnlyDomControls(true)
  }
})

watch(() => props.assetId, () => {
  loadAsset()
})

watch(() => props.sessionId, () => {
  loadAsset()
})

watch(() => activeSuiteSessionId.value, () => {
  loadAsset()
})

watch(() => [readRouteQueryValue('mode'), readRouteQueryValue('practiceMode')], () => {
  loadAsset()
})

watch(
  () => ({
    assetId: asset.value?.id || '',
    questionCount: Array.isArray(payload.value?.questionOrder) ? payload.value.questionOrder.length : 0,
    answers: JSON.stringify(snapshotAnswerMap()),
    review: reviewMode.value
  }),
  async ({ assetId, questionCount }) => {
    if (!assetId || !questionCount) {
      return
    }
    await nextTick()
    syncDomAnswers()
    if (reviewMode.value) {
      setReadOnlyDomControls(true)
    }
  },
  { flush: 'post' }
)

async function loadAsset() {
  const normalizedAssetId = String(props.assetId || route.params.assetId || '').trim()
  const replaySessionId = String(props.sessionId || route.params.sessionId || '').trim()
  if (!normalizedAssetId) {
    error.value = '缺少阅读资源编号'
    return
  }
  if (normalizeLegacyMemorizeQuery()) {
    return
  }

  clearReadingAssetError()
  submitError.value = ''
  snapshotMessage.value = ''
  submission.value = null
  suiteSession.value = null
  resetAttemptMetadata()
  resetReadingCoachState()
  closeFloatingPanels()
  resetHighlightUiStateFromComposable()
  suppressReadingNotesPersist = true
  notesText.value = ''
  suppressReadingNotesPersist = false
  clearEndlessTimer()
  resetPracticeTimerClock()
  endlessNextAssetId.value = ''
  try {
    const data = await loadReadingAsset(normalizedAssetId)
    initializeReadingAnswers(data?.payload, { prefillAnswerKey: isMemorizeMode.value })
    loadReadingNotes()
    if (activeSuiteSessionId.value) {
      try {
        suiteSession.value = await practiceReadingSuite.get(activeSuiteSessionId.value)
        applySuiteTimerState()
      } catch (suiteLoadError) {
        if (!replaySessionId) {
          throw suiteLoadError
        }
        console.warn('加载套题进度失败，继续回放已提交阅读记录:', suiteLoadError)
        suiteSession.value = null
      }
    }
    if (replaySessionId) {
      await loadSubmittedSession(replaySessionId)
    }
  } catch (loadError) {
    console.error('加载阅读资源失败:', loadError)
  }
  if (asset.value && payload.value) {
    await nextTick()
    syncDomAnswers()
    restoreHighlightsFromRecords(highlightSnapshot.value)
    applyMemorizeStudyLayer()
    if (readOnlyMode.value) {
      setPracticeTimerElapsedSeconds(Math.max(0, Number(submission.value?.duration || 0)))
      setReadOnlyDomControls(true)
    } else {
      startPracticeTimer()
    }
  }
}

async function loadSubmittedSession(sessionId) {
  const state = await practiceSessions.getState('reading', sessionId)
  const loadedSubmission = state?.submission || null
  if (!loadedSubmission) {
    throw new Error('未找到可回放的阅读提交记录')
  }
  const expectedAssetId = String(asset.value?.id || '').trim()
  const actualAssetId = String(loadedSubmission.assetId || loadedSubmission.examId || '').trim()
  if (expectedAssetId && actualAssetId && expectedAssetId !== actualAssetId) {
    throw new Error('阅读回放记录与当前题目不匹配')
  }
  submission.value = loadedSubmission
  highlightSnapshot.value = normalizeHighlightSnapshotState(loadedSubmission.highlights || loadedSubmission.analysisArtifacts?.highlights || [])
  hydrateReadingCoachFromSubmission(loadedSubmission, {
    open: true,
    pendingIfMissing: true,
    successMessage: 'AI 复盘已载入',
    pendingMessage: 'AI 复盘待补全'
  })
  restoreSubmittedMetadata(loadedSubmission)
  if (loadedSubmission.answers) {
    Object.entries(loadedSubmission.answers).forEach(([questionId, value]) => {
      assignAnswer(questionId, value)
    })
  }
  await nextTick()
  syncDomAnswers()
  setReadOnlyDomControls(true)
  restoreHighlightsFromRecords(highlightSnapshot.value)
  restoreSubmittedViewport(loadedSubmission)
  if (readingCoachEnabled.value) {
    if (!loadedSubmission.singleAttemptAnalysisLlm && !loadedSubmission.analysisArtifacts?.singleAttemptAnalysisLlm) {
      queueAutomaticReviewRefresh(loadedSubmission.sessionId)
    }
  }
}

function restoreSubmittedViewport(loadedSubmission) {
  const scrollY = Number(loadedSubmission?.metadata?.scrollY ?? loadedSubmission?.scrollY)
  if (!Number.isFinite(scrollY) || scrollY <= 0 || typeof window === 'undefined') {
    return
  }
  window.requestAnimationFrame(() => {
    window.scrollTo(0, Math.max(0, Math.round(scrollY)))
  })
}

function resetAttemptMetadata() {
  flushActiveQuestionVisit()
  activeQuestionVisit.questionId = ''
  activeQuestionVisit.startedAtMs = 0
  activeQuestionId.value = ''
  Object.keys(answerTimeline).forEach((key) => {
    delete answerTimeline[key]
  })
  markedQuestions.value = []
  interactionCount.value = 0
}

function getCurrentScrollY() {
  if (typeof window === 'undefined') return 0
  const numeric = Number(window.scrollY)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0
}

function initializeReadingPreferences() {
  try {
    const storedFont = window.localStorage?.getItem('reading_font_size')
    if (fontSizeOptions.some((option) => option.value === storedFont)) {
      readingFontSize.value = storedFont
    }
  } catch (_) {}
  try {
    const storedTheme = window.localStorage?.getItem('reading_theme_mode')
    if (themeModeOptions.some((option) => option.value === storedTheme)) {
      readingThemeMode.value = storedTheme
    }
  } catch (_) {}
  try {
    const storedSuiteFlow = window.localStorage?.getItem(SUITE_AUTO_ADVANCE_STORAGE_KEY)
    if (storedSuiteFlow === 'true' || storedSuiteFlow === 'false') {
      suiteAutoAdvance.value = storedSuiteFlow === 'true'
    }
  } catch (_) {}
}

async function loadReadingCoachPreference() {
  readingCoachSettingError.value = ''
  try {
    readingCoachEnabled.value = await readingCoachSettingsApi.getEnabled()
  } catch (error) {
    readingCoachEnabled.value = true
    console.warn('加载阅读 AI 教练设置失败，继续使用默认开启:', error)
  }
  if (!readingCoachEnabled.value) {
    resetReadingCoachState()
  }
}

function syncReadingCoachStateWithSetting(enabled) {
  if (!enabled) {
    resetReadingCoachState()
    return
  }
  if (submission.value) {
    hydrateReadingCoachFromSubmission(submission.value, {
      pendingIfMissing: true,
      successMessage: 'AI 复盘已载入',
      pendingMessage: 'AI 复盘待补全'
    })
  }
}

async function updateReadingCoachEnabled(enabled) {
  const normalized = Boolean(enabled)
  if (readingCoachSettingSaving.value || readingCoachEnabled.value === normalized) {
    return
  }
  const previous = readingCoachEnabled.value
  readingCoachEnabled.value = normalized
  readingCoachSettingError.value = ''
  syncReadingCoachStateWithSetting(normalized)
  readingCoachSettingSaving.value = true
  try {
    await readingCoachSettingsApi.updateEnabled(normalized)
  } catch (error) {
    readingCoachEnabled.value = previous
    syncReadingCoachStateWithSetting(previous)
    readingCoachSettingError.value = 'AI 教练设置保存失败，请稍后重试。'
    console.error('保存阅读 AI 教练设置失败:', error)
  } finally {
    readingCoachSettingSaving.value = false
  }
}

function toggleSettingsPanel() {
  const nextVisible = !settingsPanelOpen.value
  closeFloatingPanels()
  settingsPanelOpen.value = nextVisible
}

function toggleNotesPanel() {
  const nextVisible = !notesPanelOpen.value
  closeFloatingPanels()
  notesPanelOpen.value = nextVisible
  if (nextVisible) {
    nextTick(() => {
      document.querySelector('#notes-panel textarea')?.focus?.()
    })
  }
}

function closeFloatingPanels() {
  settingsPanelOpen.value = false
  notesPanelOpen.value = false
}

function selectReadingFont(value) {
  if (!fontSizeOptions.some((option) => option.value === value)) {
    return
  }
  readingFontSize.value = value
  try {
    window.localStorage?.setItem('reading_font_size', value)
  } catch (_) {}
}

function selectReadingTheme(value) {
  if (!themeModeOptions.some((option) => option.value === value)) {
    return
  }
  readingThemeMode.value = value
  syncDropzoneThemeStyles()
  nextTick(() => syncDropzoneThemeStyles())
  try {
    window.localStorage?.setItem('reading_theme_mode', value)
  } catch (_) {}
}

function setSuiteAutoAdvance(value) {
  suiteAutoAdvance.value = Boolean(value)
  try {
    window.localStorage?.setItem(SUITE_AUTO_ADVANCE_STORAGE_KEY, String(suiteAutoAdvance.value))
  } catch (_) {}
}

function loadReadingNotes() {
  if (!asset.value?.id) {
    suppressReadingNotesPersist = true
    notesText.value = ''
    suppressReadingNotesPersist = false
    return
  }
  try {
    suppressReadingNotesPersist = true
    notesText.value = window.localStorage?.getItem(`${READING_NOTES_STORAGE_PREFIX}${asset.value.id}`) || ''
  } catch (_) {
    notesText.value = ''
  } finally {
    suppressReadingNotesPersist = false
  }
}

function persistReadingNotes() {
  if (suppressReadingNotesPersist) {
    return
  }
  if (!asset.value?.id) {
    return
  }
  try {
    window.localStorage?.setItem(`${READING_NOTES_STORAGE_PREFIX}${asset.value.id}`, notesText.value || '')
  } catch (_) {}
}

watch(notesText, persistReadingNotes)

function restoreSubmittedMetadata(loadedSubmission) {
  markedQuestions.value = Array.isArray(loadedSubmission?.markedQuestions)
    ? loadedSubmission.markedQuestions.map(normalizeQuestionId).filter(Boolean)
    : []
  Object.keys(answerTimeline).forEach((key) => {
    delete answerTimeline[key]
  })
  const timeline = Array.isArray(loadedSubmission?.questionTimelineLite) ? loadedSubmission.questionTimelineLite : []
  timeline.forEach((entry) => {
    const questionId = normalizeQuestionId(entry?.questionId)
    if (!questionId) return
    const elapsedMs = Math.max(0, Number(entry.elapsedMs ?? entry.durationMs) || 0)
    answerTimeline[questionId] = {
      firstAnsweredAt: entry.firstAnsweredAt || null,
      lastAnsweredAt: entry.lastAnsweredAt || null,
      changeCount: Math.max(0, Number(entry.changeCount) || 0),
      visitCount: Math.max(0, Number(entry.visitCount) || 0),
      elapsedMs,
      lastFingerprint: getAnswerFingerprint(loadedSubmission.answers?.[questionId])
    }
  })
}

function getInteraction(questionId) {
  return payload.value?.interactionModel?.[questionId] || null
}

function getDisplayLabel(questionId) {
  return payload.value?.questionDisplayMap?.[questionId] || String(questionId).replace(/^q/i, '')
}

function isChoiceControl(questionId) {
  const interaction = getInteraction(questionId)
  return ['radio', 'checkbox', 'select'].includes(interaction?.control)
}

function isDragDropControl(questionId) {
  return getInteraction(questionId)?.control === 'dragdrop'
}

function getOptions(questionId) {
  const interaction = getInteraction(questionId)
  return Array.isArray(interaction?.options) ? interaction.options : []
}

function isMultiValueCheckbox(questionId) {
  const interaction = getInteraction(questionId)
  const correctAnswer = payload.value?.answerKey?.[questionId]
  return interaction?.control === 'checkbox' && Array.isArray(correctAnswer)
}

function getDragDropGroup(questionId) {
  return payload.value?.questionGroups?.find((group) => (
    Array.isArray(group.questionIds) && group.questionIds.includes(questionId)
  )) || null
}

function getDragDropGroupQuestionIds(questionId) {
  const group = getDragDropGroup(questionId)
  return Array.isArray(group?.questionIds) ? group.questionIds : [questionId]
}

function allowsDragOptionReuse(questionId) {
  const interaction = getInteraction(questionId)
  if (typeof interaction?.allowOptionReuse === 'boolean') {
    return interaction.allowOptionReuse
  }
  return Boolean(getDragDropGroup(questionId)?.allowOptionReuse)
}

function getSelectedOption(questionId) {
  const value = getAnswerValue(questionId)
  return getOptions(questionId).find((option) => String(option.value || '').trim() === value) || null
}

function getSelectedOptionLabel(questionId) {
  const option = getSelectedOption(questionId)
  return option?.label || getAnswerValue(questionId) || '未作答'
}

function findQuestionUsingDragOption(questionId, optionValue) {
  const normalizedOption = String(optionValue || '').trim()
  if (!normalizedOption || allowsDragOptionReuse(questionId)) {
    return ''
  }
  return getDragDropGroupQuestionIds(questionId).find((candidateId) => (
    candidateId !== questionId && String(getRawAnswer(candidateId) || '').trim() === normalizedOption
  )) || ''
}

function isDragOptionUnavailable(questionId, optionValue) {
  return Boolean(findQuestionUsingDragOption(questionId, optionValue))
}

function isMarkedQuestion(questionId) {
  const normalized = normalizeQuestionId(questionId)
  return Boolean(normalized && markedQuestions.value.includes(normalized))
}

function toggleMarkedQuestion(questionId) {
  if (reviewMode.value) {
    return
  }
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return
  recordInteraction()
  markedQuestions.value = isMarkedQuestion(normalized)
    ? markedQuestions.value.filter((entry) => entry !== normalized)
    : [...markedQuestions.value, normalized]
}

function setDragDropAnswer(questionId, value, options = {}) {
  if (reviewMode.value) {
    return
  }
  const normalizedValue = String(value || '').trim()
  const sourceQuestionId = normalizeQuestionId(options.sourceQuestionId)
  recordQuestionVisit(questionId)
  if (!normalizedValue) {
    assignAnswer(questionId, '', { ...options, track: true })
    return
  }

  const currentValue = getAnswerValue(questionId)
  if (sourceQuestionId && sourceQuestionId !== questionId && isDragDropControl(sourceQuestionId)) {
    assignAnswer(questionId, normalizedValue, { syncNative: true, track: true })
    assignAnswer(sourceQuestionId, currentValue, { syncNative: true, track: true })
    return
  }

  if (findQuestionUsingDragOption(questionId, normalizedValue)) {
    return
  }
  assignAnswer(questionId, normalizedValue, { ...options, track: true })
}

function clearDragDropAnswer(questionId) {
  if (reviewMode.value) {
    return
  }
  assignAnswer(questionId, '', { syncNative: true, track: true })
}

function dropOnAnswerSlot(questionId, event) {
  if (reviewMode.value) {
    return
  }
  const dragPayload = getDragPayloadFromEvent(event)
  if (!dragPayload?.value) {
    return
  }
  setDragDropAnswer(questionId, dragPayload.value, {
    sourceQuestionId: dragPayload.sourceQuestionId,
    syncNative: true
  })
}

function handleWorkspaceClick(event) {
  const clearTarget = event.target?.closest?.('[data-dropzone-clear]')
  if (!clearTarget) {
    return
  }
  const questionId = normalizeQuestionId(clearTarget.dataset.sourceQuestionId)
  if (questionId) {
    clearDragDropAnswer(questionId)
  }
}

function handleDragStart(event) {
  if (reviewMode.value) {
    event.preventDefault()
    return
  }
  const source = event.target?.closest?.('[data-drag-value], [data-answer-value], .drag-item, .draggable-word, .card')
  const dragPayload = buildDragPayloadFromElement(source)
  if (!dragPayload?.value) {
    event.preventDefault()
    return
  }
  currentDragPayload.value = dragPayload
  source?.classList?.add('dragging')
  event.dataTransfer?.setData('text/plain', JSON.stringify(dragPayload))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
  }
}

function handleDragEnd(event) {
  event.target?.closest?.('.dragging')?.classList?.remove('dragging')
  clearDragHoverState()
  currentDragPayload.value = null
}

function handleDragOver(event) {
  if (reviewMode.value) {
    return
  }
  const dropzone = getNativeDropzoneElement(event.target)
  const pool = getDragPoolElement(event.target)
  if (!dropzone && !pool) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = pool ? 'move' : 'copy'
  }
  ;(dropzone || pool).classList.add('drag-over')
}

function handleDragLeave(event) {
  const target = getNativeDropzoneElement(event.target) || getDragPoolElement(event.target)
  const related = event.relatedTarget
  if (target && related && target.contains(related)) {
    return
  }
  target?.classList?.remove('drag-over')
}

function handleDrop(event) {
  if (reviewMode.value) {
    return
  }
  const dragPayload = getDragPayloadFromEvent(event)
  if (!dragPayload?.value && !dragPayload?.sourceQuestionId) {
    return
  }

  const dropzone = getNativeDropzoneElement(event.target)
  if (dropzone) {
    const questionId = resolveDropzoneQuestionId(dropzone)
    if (!questionId || !isDragDropControl(questionId) || !dragPayload.value) {
      return
    }
    event.preventDefault()
    dropzone.classList.remove('drag-over')
    setDragDropAnswer(questionId, dragPayload.value, {
      sourceQuestionId: dragPayload.sourceQuestionId,
      syncNative: true
    })
    return
  }

  const pool = getDragPoolElement(event.target)
  if (pool && dragPayload.sourceQuestionId) {
    event.preventDefault()
    pool.classList.remove('drag-over')
    clearDragDropAnswer(dragPayload.sourceQuestionId)
  }
}

function getDragPayloadFromEvent(event) {
  const raw = event?.dataTransfer?.getData('text/plain')
  const parsed = parseDragPayload(raw)
  return parsed?.value || parsed?.sourceQuestionId ? parsed : currentDragPayload.value
}

function parseDragPayload(rawValue) {
  if (!rawValue) {
    return null
  }
  try {
    const parsed = JSON.parse(rawValue)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return {
      value: String(parsed.value || '').trim(),
      label: String(parsed.label || parsed.value || '').trim(),
      sourceQuestionId: normalizeQuestionId(parsed.sourceQuestionId)
    }
  } catch (_) {
    const fallback = String(rawValue || '').trim()
    return fallback ? { value: fallback, label: fallback, sourceQuestionId: '' } : null
  }
}

function buildDragPayloadFromElement(element) {
  if (!element) {
    return null
  }
  const dataset = element.dataset || {}
  const sourceDropzone = getNativeDropzoneElement(element)
  const sourceQuestionId = normalizeQuestionId(dataset.sourceQuestionId)
    || (sourceDropzone ? resolveDropzoneQuestionId(sourceDropzone) : '')
  const value = String(
    dataset.dragValue
    || dataset.answerValue
    || dataset.heading
    || dataset.option
    || dataset.word
    || dataset.key
    || dataset.value
    || element.getAttribute?.('value')
    || inferDragValueFromLabel(element.textContent)
    || ''
  ).trim()
  const label = String(
    dataset.dragLabel
    || dataset.answerLabel
    || dataset.word
    || dataset.value
    || element.textContent
    || value
  ).trim()
  return value ? { value, label: label || value, sourceQuestionId } : null
}

function inferDragValueFromLabel(label) {
  const text = String(label || '').trim()
  if (!text) {
    return ''
  }
  const leading = text.match(/^([A-Za-z])(?:[.)])?\s+/)
  if (leading) {
    return leading[1].toUpperCase()
  }
  const roman = text.match(/^([ivxlcdm]+)(?:[.)])?\s+/i)
  return roman ? roman[1].toLowerCase() : text
}

function resetAnswers() {
  if (reviewMode.value) {
    return
  }
  initializeReadingAnswers(payload.value, { prefillAnswerKey: isMemorizeMode.value })
  resetAttemptMetadata()
  if (activeSuiteSessionId.value && suiteTimerState.value) {
    applySuiteTimerState()
  } else {
    resetPracticeTimerClock()
  }
  startPracticeTimer()
  syncDomAnswers()
  snapshotMessage.value = '已清空本页作答。'
}

async function recycleSubmittedAttempt() {
  if (!canRecycleSubmittedAttempt.value) {
    return
  }
  submission.value = null
  clearSubmissionSnapshot()
  resetReadingCoachState()
  submitError.value = ''
  snapshotMessage.value = ''
  resetAttemptMetadata()
  initializeReadingAnswers(payload.value, { prefillAnswerKey: isMemorizeMode.value })
  resetHighlightUiStateFromComposable()
  await nextTick()
  Object.values(getHighlightRoots()).forEach((root) => unwrapHighlights(root))
  syncDomAnswers()
  setReadOnlyDomControls(false)
  resetPracticeTimerClock()
  startPracticeTimer()
  snapshotMessage.value = '已重置本篇练习，可重新作答。'
}

function snapshotAnswers() {
  if (!asset.value?.id) return
  const key = `practice_reading_answers_${asset.value.id}`
  const snapshot = {
    assetId: asset.value.id,
    savedAt: new Date().toISOString(),
    answers: snapshotAnswerMap(),
    markedQuestions: markedQuestions.value.slice(),
    questionTimelineLite: buildQuestionTimelineLite(),
    highlights: snapshotHighlights(),
    scrollY: getCurrentScrollY(),
    timerSnapshot: getPracticeTimerSnapshot()
  }
  try {
    window.sessionStorage?.setItem(key, JSON.stringify(snapshot))
    snapshotMessage.value = '作答快照已保存到当前会话。'
  } catch (_) {
    snapshotMessage.value = '当前环境无法写入会话缓存。'
  }
}

function handleQuestionInput(event) {
  if (reviewMode.value) {
    return
  }
  const target = event.target
  if (!target || !target.name) {
    return
  }

  if (target.type === 'checkbox') {
    collectCheckboxGroup(target.name)
    return
  }

  const questionId = normalizeQuestionId(target.name)
  if (!questionId) return
  recordQuestionVisit(questionId)

  if (target.type === 'radio') {
    if (target.checked) {
      setAnswer(questionId, target.value)
    }
    return
  }

  setAnswer(questionId, target.value)
}

function collectCheckboxGroup(name) {
  const questionIds = expandQuestionSequence(name)
  if (!questionIds.length) {
    return
  }
  questionIds.forEach((questionId) => recordQuestionVisit(questionId))
  const checkedValues = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${escapeCss(name)}"]`))
    .filter((input) => input.checked)
    .map((input) => String(input.value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'en'))

  if (questionIds.length === 1 && isMultiValueCheckbox(questionIds[0])) {
    setAnswer(questionIds[0], checkedValues)
    return
  }

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
  if (typeof document === 'undefined') {
    return
  }
  const interaction = getInteraction(questionId)
  if (interaction?.control === 'dragdrop') {
    syncDropzoneControl(questionId, explicitValue)
    return
  }
  const names = new Set(resolveAnswerAliases(questionId))
  if (interaction?.name) {
    names.add(interaction.name)
  }

  if (interaction?.control === 'checkbox' && interaction.name) {
    const groupIds = expandQuestionSequence(interaction.name)
    const selectedValues = new Set()
    groupIds.forEach((id) => {
      const value = getRawAnswer(id)
      if (Array.isArray(value)) {
        value.map((entry) => String(entry || '').trim()).filter(Boolean).forEach((entry) => selectedValues.add(entry))
        return
      }
      const normalized = String(value || '').trim()
      if (normalized) {
        selectedValues.add(normalized)
      }
    })
    document.querySelectorAll(`input[type="checkbox"][name="${escapeCss(interaction.name)}"]`).forEach((input) => {
      input.checked = selectedValues.has(String(input.value || '').trim())
      input.disabled = reviewMode.value
    })
    return
  }

  names.forEach((name) => {
    const escaped = escapeCss(name)
    document.querySelectorAll(`input[type="radio"][name="${escaped}"]`).forEach((input) => {
      input.checked = String(input.value || '').trim() === String(explicitValue || '').trim()
      input.disabled = reviewMode.value
    })
    document.querySelectorAll(`input[type="text"][name="${escaped}"], textarea[name="${escaped}"]`).forEach((input) => {
      input.value = String(explicitValue || '')
      input.disabled = reviewMode.value
    })
  })
}

function syncDropzoneControl(questionId, explicitValue = getRawAnswer(questionId)) {
  const dropzones = findNativeDropzonesByQuestionId(questionId)
  if (!dropzones.length) {
    return
  }
  const value = String(Array.isArray(explicitValue) ? explicitValue[0] || '' : explicitValue || '').trim()
  const option = getOptions(questionId).find((entry) => String(entry.value || '').trim() === value)
  const label = option?.label || value
  dropzones.forEach((dropzone) => {
    dropzone.dataset.answerValue = value
    dropzone.dataset.answerLabel = label
    dropzone.dataset.sourceQuestionId = questionId
    dropzone.setAttribute('data-vue-dropzone', 'true')
    dropzone.classList.toggle('dropzone-filled', Boolean(value))
    dropzone.classList.toggle('dropzone-empty', !value)
    dropzone.setAttribute('aria-disabled', reviewMode.value ? 'true' : 'false')
    applyDropzoneThemeStyle(dropzone)

    const holder = ensureDropzoneHolder(dropzone)
    if (!holder) {
      return
    }
    holder.innerHTML = ''
    if (!value) {
      return
    }

    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'drag-item dragdrop-chip dragdrop-chip-assigned'
    chip.textContent = label
    chip.dataset.answerValue = value
    chip.dataset.answerLabel = label
    chip.dataset.sourceQuestionId = questionId
    chip.dataset.dropzoneClear = 'true'
    chip.draggable = !reviewMode.value
    chip.disabled = reviewMode.value
    holder.appendChild(chip)
  })
}

function applyDropzoneThemeStyle(dropzone) {
  if (!dropzone) {
    return
  }
  if (dropzone.classList?.contains('drop-target-summary')) {
    dropzone.style.removeProperty('--reading-dropzone-bg')
    dropzone.style.removeProperty('--reading-dropzone-border')
    dropzone.style.backgroundColor = ''
    dropzone.style.borderColor = ''
    dropzone.querySelectorAll?.('.drag-item, .dragdrop-chip').forEach((chip) => {
      chip.style.backgroundColor = ''
      chip.style.borderColor = ''
      chip.style.color = ''
    })
    return
  }
  const isDark = readingThemeMode.value === 'dark'
  dropzone.style.setProperty('--reading-dropzone-bg', isDark ? '#1e293b' : '#eff6ff')
  dropzone.style.setProperty('--reading-dropzone-border', isDark ? '#475569' : '#93c5fd')
  dropzone.style.backgroundColor = isDark ? '#1e293b' : ''
  dropzone.style.borderColor = isDark ? '#475569' : ''
  dropzone.querySelectorAll?.('.drag-item, .dragdrop-chip').forEach((chip) => {
    chip.style.backgroundColor = isDark ? '#334155' : ''
    chip.style.borderColor = isDark ? '#64748b' : ''
    chip.style.color = isDark ? '#f8fafc' : ''
  })
}

function syncDropzoneThemeStyles() {
  if (typeof document === 'undefined') {
    return
  }
  document.querySelectorAll('.paragraph-dropzone, .match-dropzone, .drop-target-summary, [data-vue-dropzone="true"]').forEach((dropzone) => {
    applyDropzoneThemeStyle(dropzone)
  })
}

function ensureDropzoneHolder(dropzone) {
  if (!dropzone) {
    return null
  }
  if (dropzone.classList.contains('drop-target-summary')) {
    return dropzone
  }
  let holder = dropzone.querySelector('.dropped-items')
  if (!holder) {
    holder = document.createElement('div')
    holder.className = 'dropped-items'
    dropzone.appendChild(holder)
  }
  return holder
}

function findNativeDropzonesByQuestionId(questionId) {
  const matches = []
  const seen = new Set()
  const aliases = resolveAnswerAliases(questionId)
  for (const alias of aliases) {
    const escaped = escapeCss(alias)
    const selector = [
      `.paragraph-dropzone[data-question="${escaped}"]`,
      `.paragraph-dropzone[data-question-id="${escaped}"]`,
      `.paragraph-dropzone[data-target="${escaped}"]`,
      `.match-dropzone[data-question="${escaped}"]`,
      `.match-dropzone[data-question-id="${escaped}"]`,
      `.match-dropzone[data-target="${escaped}"]`,
      `.drop-target-summary[data-question="${escaped}"]`,
      `.drop-target-summary[data-question-id="${escaped}"]`,
      `.dropzone[data-question="${escaped}"]`,
      `.dropzone[data-question-id="${escaped}"]`,
      `.dropzone[data-target="${escaped}"]`,
      `#${escaped}-dropzone`,
      `#${escaped}-target`
    ].join(', ')
    document.querySelectorAll(selector).forEach((direct) => {
      if (!seen.has(direct)) {
        seen.add(direct)
        matches.push(direct)
      }
    })
    const anchor = document.getElementById(`${alias}-anchor`)
    const anchored = anchor?.querySelector?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary')
      || anchor?.parentElement?.querySelector?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary')
    if (anchored && !seen.has(anchored)) {
      seen.add(anchored)
      matches.push(anchored)
    }
  }
  return matches
}

function getNativeDropzoneElement(target) {
  return target?.closest?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary') || null
}

function getDragPoolElement(target) {
  return target?.closest?.('.headings-pool, .options-pool, .cardpool, .option-pool, .pool-items, #word-options, .dragdrop-options') || null
}

function resolveDropzoneQuestionId(dropzone) {
  if (!dropzone) {
    return ''
  }
  const dataset = dropzone.dataset || {}
  const direct = normalizeQuestionId(dataset.sourceQuestionId || dataset.question || dataset.questionId || dataset.target)
  if (direct) {
    return direct
  }
  const anchor = dropzone.closest?.('[id$="-anchor"]')
  const match = String(anchor?.id || '').match(/q\d+/i)
  return match ? normalizeQuestionId(match[0]) : ''
}

function clearDragHoverState() {
  document.querySelectorAll('.drag-over, .dragging').forEach((element) => {
    element.classList.remove('drag-over', 'dragging')
  })
}

function setReadOnlyDomControls(readOnly) {
  if (typeof document === 'undefined') {
    return
  }
  document.querySelectorAll('.question-panel input, .question-panel textarea, .question-panel select').forEach((control) => {
    control.disabled = Boolean(readOnly)
  })
  payload.value?.questionOrder?.forEach((questionId) => {
    if (isDragDropControl(questionId)) {
      syncDropzoneControl(questionId)
    }
  })
}

function getHighlightRoots() {
  if (typeof document === 'undefined') {
    return {}
  }
  return {
    passage: document.getElementById('left'),
    questions: document.getElementById('question-groups')
  }
}

function isInsideExplanationNode(node) {
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node
  return Boolean(element?.closest?.('.reading-explanation-card, .reading-group-explanation, .reading-question-explanation, .reading-question-explanation-list'))
}

function getTextNodes(root) {
  const nodes = []
  if (!root || typeof document === 'undefined') {
    return nodes
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || isInsideExplanationNode(node)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  let node = walker.nextNode()
  while (node) {
    nodes.push(node)
    node = walker.nextNode()
  }
  return nodes
}

function getText(root) {
  return getTextNodes(root).map((node) => node.textContent || '').join('')
}

function unwrapHighlights(root) {
  if (!root) {
    return
  }
  root.querySelectorAll('.hl, .memorize-locator-highlight').forEach((highlight) => {
    if (isInsideExplanationNode(highlight)) {
      return
    }
    const parent = highlight.parentNode
    if (!parent) return
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight)
    }
    parent.removeChild(highlight)
    parent.normalize()
  })
}

function resolveRangeFromOffsets(root, start, end) {
  const nodes = getTextNodes(root)
  let offset = 0
  let startNode = null
  let endNode = null
  let startOffset = 0
  let endOffset = 0
  nodes.some((node) => {
    const text = node.textContent || ''
    const nextOffset = offset + text.length
    if (!startNode && start >= offset && start <= nextOffset) {
      startNode = node
      startOffset = Math.max(0, start - offset)
    }
    if (!endNode && end >= offset && end <= nextOffset) {
      endNode = node
      endOffset = Math.max(0, end - offset)
    }
    offset = nextOffset
    return Boolean(startNode && endNode)
  })
  if (!startNode || !endNode) {
    return null
  }
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

function normalizeComparableText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function applyHighlightKind(node, kind = 'highlight') {
  node.classList.add('hl')
  node.classList.add('review-dictionary-highlight')
  node.dataset.hlType = kind === 'note' ? 'note' : 'highlight'
  node.setAttribute('tabindex', '0')
  node.setAttribute('role', 'button')
  node.setAttribute('aria-label', `查看释义：${normalizeComparableText(node.textContent)}`)
}

function normalizeHighlightSnapshot(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const text = normalizeComparableText(entry.text || entry.excerpt)
      if (!text) return null
      const scope = String(entry.scope || '').trim().toLowerCase()
      const startOffset = Number(entry.startOffset ?? entry.start)
      const endOffset = Number(entry.endOffset ?? entry.end)
      return {
        scope: scope === 'passage' || scope === 'questions' ? scope : 'unknown',
        text,
        kind: entry.kind === 'note' ? 'note' : 'highlight',
        questionId: normalizeQuestionId(entry.questionId) || null,
        startOffset: Number.isFinite(startOffset) ? startOffset : null,
        endOffset: Number.isFinite(endOffset) ? endOffset : null,
        before: normalizeComparableText(entry.before),
        after: normalizeComparableText(entry.after),
        occurrence: Number.isFinite(Number(entry.occurrence)) ? Math.max(0, Number(entry.occurrence)) : 0,
        createdAt: entry.createdAt || new Date().toISOString()
      }
    })
    .filter(Boolean)
}

function snapshotHighlights() {
  const roots = getHighlightRoots()
  const records = []
  Object.entries(roots).forEach(([scope, root]) => {
    if (!root) return
    const fullText = getText(root)
    const cursorByText = new Map()
    const seenByText = new Map()
    root.querySelectorAll('.hl').forEach((node) => {
      if (isInsideExplanationNode(node)) return
      const text = normalizeComparableText(node.textContent)
      if (!text) return
      const key = `${scope}::${text}`
      const occurrence = seenByText.get(key) || 0
      seenByText.set(key, occurrence + 1)
      let cursor = cursorByText.get(key) || 0
      let hit = -1
      for (let index = 0; index <= occurrence; index += 1) {
        hit = fullText.indexOf(text, cursor)
        if (hit < 0) break
        cursor = hit + text.length
      }
      if (hit < 0) return
      cursorByText.set(key, cursor)
      const endOffset = hit + text.length
      records.push({
        scope,
        text,
        kind: node.dataset.hlType === 'note' ? 'note' : 'highlight',
        questionId: resolveHighlightQuestionId(node),
        startOffset: hit,
        endOffset,
        before: fullText.slice(Math.max(0, hit - 20), hit),
        after: fullText.slice(endOffset, endOffset + 20),
        occurrence,
        createdAt: node.dataset.createdAt || new Date().toISOString()
      })
    })
  })
  highlightSnapshot.value = records
  return records
}

function resolveHighlightQuestionId(node) {
  const element = node?.closest?.('[data-answer-question-id], [data-review-question-id], [data-question], [data-question-id], [name]')
  return normalizeQuestionId(
    element?.dataset?.answerQuestionId
    || element?.dataset?.reviewQuestionId
    || element?.dataset?.question
    || element?.dataset?.questionId
    || element?.getAttribute?.('name')
  ) || null
}

function restoreHighlightsFromRecords(records = []) {
  const roots = getHighlightRoots()
  Object.values(roots).forEach((root) => unwrapHighlights(root))
  normalizeHighlightSnapshot(records).forEach((record) => {
    const root = roots[record.scope]
    if (root) {
      applyHighlightRecord(root, record)
    }
  })
}

function applyHighlightRecord(root, record) {
  const fullText = getText(root)
  if (!fullText || !record?.text) {
    return false
  }
  const candidates = []
  const start = Number(record.startOffset)
  const end = Number(record.endOffset)
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    candidates.push({ start, end })
  }
  let cursor = 0
  let hit = -1
  for (let index = 0; index <= (Number(record.occurrence) || 0); index += 1) {
    hit = fullText.indexOf(record.text, cursor)
    if (hit < 0) break
    cursor = hit + record.text.length
  }
  if (hit >= 0) {
    candidates.push({ start: hit, end: hit + record.text.length })
  }
  const normalizedNeedle = normalizeComparableText(record.text)
  if (normalizedNeedle && hit < 0) {
    const pattern = new RegExp(normalizedNeedle.split(/\s+/).map(escapeRegExp).join('\\s+'), 'g')
    const matched = pattern.exec(fullText)
    if (matched) {
      candidates.push({ start: matched.index, end: matched.index + matched[0].length })
    }
  }
  for (const candidate of candidates) {
    const range = resolveRangeFromOffsets(root, candidate.start, candidate.end)
    if (!range || range.collapsed) continue
    const span = document.createElement('span')
    applyHighlightKind(span, record.kind)
    span.dataset.createdAt = record.createdAt || new Date().toISOString()
    try {
      range.surroundContents(span)
      return true
    } catch (_) {}
  }
  return false
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function closeSelectionToolbar() {
  selectionToolbarVisible.value = false
  keepSelectionToolbar.value = false
  lastSelectionRange = null
  currentHighlightNode = null
}

function handleSelectionChange() {
  window.setTimeout(() => {
    if (keepSelectionToolbar.value) return
    const selection = window.getSelection?.()
    if (!selection || !selection.rangeCount || selection.isCollapsed) {
      if (!currentHighlightNode) {
        selectionToolbarVisible.value = false
      }
      return
    }
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer
    const roots = Object.values(getHighlightRoots()).filter(Boolean)
    const insideRoot = roots.some((root) => root.contains(container))
    const highlightNode = container?.closest?.('.hl') || null
    if (!insideRoot && !highlightNode) {
      closeSelectionToolbar()
      return
    }
    lastSelectionRange = range.cloneRange()
    currentHighlightNode = highlightNode
    positionSelectionToolbar(range.getBoundingClientRect())
  }, 10)
}

function positionSelectionToolbar(rect) {
  const top = window.scrollY + rect.top - 44
  const left = window.scrollX + rect.left + (rect.width / 2) - 110
  selectionToolbarStyle.top = `${Math.max(8, Math.round(top > 0 ? top : window.scrollY + rect.bottom + 8))}px`
  selectionToolbarStyle.left = `${Math.max(8, Math.round(left))}px`
  selectionToolbarVisible.value = true
}

function applySelectionHighlight(kind = 'highlight') {
  if (!lastSelectionRange || lastSelectionRange.collapsed || currentHighlightNode) {
    return
  }
  const span = document.createElement('span')
  applyHighlightKind(span, kind)
  span.dataset.createdAt = new Date().toISOString()
  try {
    lastSelectionRange.surroundContents(span)
  } catch (_) {
    return
  }
  window.getSelection?.()?.removeAllRanges()
  snapshotHighlights()
  recordInteraction()
  closeSelectionToolbar()
}

function applySelectionNote() {
  if (currentHighlightNode) {
    applyHighlightKind(currentHighlightNode, 'note')
    appendNoteText(currentHighlightNode.textContent)
    snapshotHighlights()
    recordInteraction()
    closeSelectionToolbar()
    toggleNotesPanel()
    return
  }
  const selectedText = normalizeComparableText(lastSelectionRange?.toString?.())
  applySelectionHighlight('note')
  if (selectedText) {
    appendNoteText(selectedText)
    toggleNotesPanel()
  }
}

function appendNoteText(text) {
  const value = normalizeComparableText(text)
  if (!value) return
  notesText.value += `${notesText.value ? '\n\n' : ''}> ${value}\n`
}

function removeSelectionHighlight() {
  let target = currentHighlightNode
  if (!target && lastSelectionRange) {
    const ancestor = lastSelectionRange.commonAncestorContainer
    target = (ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor)?.closest?.('.hl') || null
  }
  if (target?.parentNode) {
    const parent = target.parentNode
    while (target.firstChild) {
      parent.insertBefore(target.firstChild, target)
    }
    parent.removeChild(target)
    parent.normalize()
    snapshotHighlights()
    recordInteraction()
  }
  window.getSelection?.()?.removeAllRanges()
  closeSelectionToolbar()
}

function handleDocumentClick(event) {
  const target = event.target
  const highlight = target?.closest?.('.hl')
  if (highlight && Object.values(getHighlightRoots()).some((root) => root?.contains(highlight))) {
    openDictionaryBubble(highlight)
    return
  }
  if (target?.closest?.('#selbar, #review-highlight-dictionary-bubble, #settings-panel, #notes-panel, #settings-btn, #note-btn')) {
    return
  }
  if (!keepSelectionToolbar.value) {
    selectionToolbarVisible.value = false
  }
  closeDictionaryBubble()
}

function closeDictionaryBubble() {
  dictionaryBubble.visible = false
  dictionaryBubble.term = ''
  dictionaryBubble.meaning = ''
  dictionaryBubble.definition = ''
  dictionaryBubble.example = ''
  dictionaryBubble.meta = ''
  dictionaryBubble.sourceLine = ''
  dictionaryBubble.parts = []
  dictionaryBubble.phonetic = ''
  dictionaryBubble.partOfSpeech = ''
  dictionaryBubble.sourceLabel = ''
  dictionaryBubble.license = ''
  dictionaryBubble.found = false
  dictionaryBubble.saved = false
  currentHighlightNode = null
}

async function openDictionaryBubble(highlight) {
  const term = normalizeComparableText(highlight?.textContent)
  if (!term) return
  const rect = highlight.getBoundingClientRect()
  dictionaryBubble.term = term
  dictionaryBubble.meaning = '正在加载本地词典...'
  dictionaryBubble.definition = ''
  dictionaryBubble.example = ''
  dictionaryBubble.meta = '本地词典'
  dictionaryBubble.sourceLine = ''
  dictionaryBubble.parts = []
  dictionaryBubble.phonetic = ''
  dictionaryBubble.partOfSpeech = ''
  dictionaryBubble.sourceLabel = ''
  dictionaryBubble.license = ''
  dictionaryBubble.found = false
  dictionaryBubble.saved = false
  dictionaryBubble.left = Math.max(12, Math.round(Math.min(rect.left, window.innerWidth - 360)))
  dictionaryBubble.top = Math.max(12, Math.round(rect.bottom + 8))
  dictionaryBubble.visible = true
  currentHighlightNode = highlight
  try {
    await ensureReviewDictionaryRuntime()
  } catch (error) {
    console.warn('加载阅读高亮词典失败:', error)
  }
  if (currentHighlightNode !== highlight || !dictionaryBubble.visible) {
    return
  }
  const lookup = lookupLocalWord(term)
  applyDictionaryLookupToBubble(lookup, term)
}

function resolveRuntimeAssetUrl(relativePath) {
  const normalized = String(relativePath || '').replace(/^\/+/, '')
  try {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.pathname.includes('/dist/writing/')) {
      return new URL(`../../${normalized}`, currentUrl.href).href
    }
  } catch (_) {}
  return `/${normalized}`
}

function loadRuntimeScript(relativePath) {
  if (runtimeScriptPromises.has(relativePath)) return runtimeScriptPromises.get(relativePath)
  const existing = document.querySelector(`script[data-reading-runtime-script="${relativePath}"]`)
  if (existing) {
    const promise = Promise.resolve()
    runtimeScriptPromises.set(relativePath, promise)
    return promise
  }
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = resolveRuntimeAssetUrl(relativePath)
    script.async = false
    script.dataset.readingRuntimeScript = relativePath
    script.onload = () => resolve()
    script.onerror = () => {
      runtimeScriptPromises.delete(relativePath)
      reject(new Error(`加载阅读运行时脚本失败：${relativePath}`))
    }
    document.head.appendChild(script)
  })
  runtimeScriptPromises.set(relativePath, promise)
  return promise
}

function ensureReviewDictionaryRuntime() {
  if (
    window.DictionaryService?.lookup
    && window.__LOCAL_DICTIONARIES__?.ecdict?.entries?.length
    && window.__EMBEDDED_WORDLISTS__?.ielts_core?.length
  ) {
    return Promise.resolve()
  }
  if (!reviewDictionaryRuntimePromise) {
    reviewDictionaryRuntimePromise = Promise.all(DICTIONARY_WORDLIST_SCRIPTS.map(loadRuntimeScript))
      .then(() => loadRuntimeScript(DICTIONARY_SERVICE_SCRIPT))
      .then(() => {
        window.DictionaryService?.init?.()
      })
      .catch((error) => {
        reviewDictionaryRuntimePromise = null
        throw error
      })
  }
  return reviewDictionaryRuntimePromise
}

function formatDictionaryLookupMeaning(result) {
  if (!result || typeof result !== 'object') {
    return ''
  }
  if (Array.isArray(result.parts) && result.parts.length) {
    return result.parts
      .map((part) => {
        const label = normalizeComparableText(part.term || part.lemma || part.requested)
        const meaning = normalizeComparableText(part.zh || part.meaning || part.en || part.definition)
        return [label, meaning].filter(Boolean).join(': ')
      })
      .filter(Boolean)
      .join('；')
  }
  return normalizeComparableText(result.zh || result.meaning || result.en || result.definition || result.example)
}

function formatDictionaryLookupMeta(result) {
  if (!result || typeof result !== 'object') {
    return ''
  }
  return [
    result.phonetic ? `/${normalizeComparableText(result.phonetic)}/` : '',
    normalizeComparableText(result.pos || result.partOfSpeech),
    normalizeComparableText(result.sourceLabel || (result.source === 'ecdict' ? 'ECDICT' : '本地词典'))
  ].filter(Boolean).join(' · ')
}

function normalizeDictionaryLookupPart(part) {
  if (!part || typeof part !== 'object') {
    return null
  }
  const term = normalizeComparableText(part.term || part.lemma || part.requested)
  const meaning = normalizeComparableText(part.zh || part.meaning)
  const definition = normalizeComparableText(part.en || part.definition)
  if (!term && !meaning && !definition) {
    return null
  }
  return {
    term: term || '高亮词',
    meta: formatDictionaryLookupMeta(part),
    meaning,
    definition
  }
}

function normalizeDictionaryLookupResult(result, fallbackTerm) {
  if (!result || typeof result !== 'object') {
    return {
      found: false,
      term: normalizeComparableText(fallbackTerm),
      meaning: '',
      definition: '',
      example: '',
      meta: '本地词典',
      sourceLine: '',
      parts: [],
      phonetic: '',
      partOfSpeech: '',
      sourceLabel: '本地词典',
      license: ''
    }
  }
  const parts = Array.isArray(result.parts)
    ? result.parts.map(normalizeDictionaryLookupPart).filter(Boolean)
    : []
  const sourceLabel = normalizeComparableText(result.sourceLabel || (result.source === 'ecdict' ? 'ECDICT' : '本地词典'))
  const license = normalizeComparableText(result.license)
  return {
    found: Boolean(result.found),
    term: normalizeComparableText(result.term || result.lemma || result.requested || fallbackTerm),
    meaning: normalizeComparableText(result.zh || result.meaning),
    definition: normalizeComparableText(result.en || result.definition),
    example: normalizeComparableText(result.example),
    meta: parts.length ? '' : formatDictionaryLookupMeta({ ...result, sourceLabel }),
    sourceLine: sourceLabel ? [sourceLabel, license].filter(Boolean).join(' · ') : '',
    parts,
    phonetic: normalizeComparableText(result.phonetic),
    partOfSpeech: normalizeComparableText(result.pos || result.partOfSpeech),
    sourceLabel,
    license
  }
}

function applyDictionaryLookupToBubble(lookup, fallbackTerm) {
  const normalized = normalizeDictionaryLookupResult(lookup, fallbackTerm)
  dictionaryBubble.term = normalized.term || normalizeComparableText(fallbackTerm)
  dictionaryBubble.meaning = normalized.meaning || (normalized.parts.length ? '' : normalized.definition)
  dictionaryBubble.definition = normalized.parts.length ? '' : normalized.definition
  dictionaryBubble.example = normalized.example
  dictionaryBubble.meta = normalized.meta || (normalized.found ? normalized.sourceLabel : '本地词典')
  dictionaryBubble.sourceLine = normalized.sourceLine
  dictionaryBubble.parts = normalized.parts
  dictionaryBubble.phonetic = normalized.phonetic
  dictionaryBubble.partOfSpeech = normalized.partOfSpeech
  dictionaryBubble.sourceLabel = normalized.sourceLabel
  dictionaryBubble.license = normalized.license
  dictionaryBubble.found = normalized.found
}

function lookupLocalWord(term) {
  const normalized = normalizeComparableText(term)
  try {
    const service = window.DictionaryService
    if (service?.lookup) {
      const result = service.lookup(normalized)
      if (result?.found) {
        return normalizeDictionaryLookupResult(result, normalized)
      }
    }
  } catch (_) {}
  const list = readVocabFallbackList()
  const existing = list.words.find((word) => String(word.word || '').trim().toLowerCase() === normalized.toLowerCase())
  return existing
    ? normalizeDictionaryLookupResult({
      found: true,
      term: existing.word,
      meaning: existing.meaning || existing.definition || existing.note || '',
      example: existing.example || '',
      sourceLabel: '本地生词本'
    }, normalized)
    : normalizeDictionaryLookupResult({ found: false, term: normalized }, normalized)
}

function readVocabFallbackList() {
  try {
    const raw = window.localStorage?.getItem(VOCAB_FALLBACK_STORAGE_KEY)
    if (!raw) return { words: [] }
    const parsed = JSON.parse(raw)
    const data = parsed && Object.prototype.hasOwnProperty.call(parsed, 'data') ? parsed.data : parsed
    return data && typeof data === 'object' && Array.isArray(data.words) ? data : { words: [] }
  } catch (_) {
    return { words: [] }
  }
}

function writeVocabFallbackList(list) {
  try {
    window.localStorage?.setItem(VOCAB_FALLBACK_STORAGE_KEY, JSON.stringify({
      data: list,
      timestamp: Date.now(),
      version: '1.0.0',
      compressed: false
    }))
    return true
  } catch (_) {
    return false
  }
}

function saveDictionaryBubbleWord() {
  const word = normalizeComparableText(dictionaryBubble.term)
  if (!word) return
  const now = new Date().toISOString()
  const list = readVocabFallbackList()
  const normalizedKey = word.toLowerCase()
  const existingIndex = list.words.findIndex((entry) => String(entry.word || '').trim().toLowerCase() === normalizedKey)
  const record = {
    id: `reading-highlight-${normalizedKey.replace(/[^a-z0-9]+/g, '-')}`,
    word,
    meaning: dictionaryBubble.meaning || dictionaryBubble.definition || '待补充释义',
    example: dictionaryBubble.example || '',
    note: [
      dictionaryBubble.phonetic ? `音标: ${dictionaryBubble.phonetic}` : '',
      dictionaryBubble.partOfSpeech ? `词性: ${dictionaryBubble.partOfSpeech}` : '',
      dictionaryBubble.sourceLabel ? `来源: ${dictionaryBubble.sourceLabel}` : '来源: 阅读高亮',
      dictionaryBubble.license ? `许可: ${dictionaryBubble.license}` : ''
    ].filter(Boolean).join('；'),
    timestamp: Date.now(),
    source: 'reading-highlight',
    createdAt: existingIndex >= 0 ? list.words[existingIndex].createdAt || now : now,
    updatedAt: now
  }
  if (existingIndex >= 0) {
    list.words.splice(existingIndex, 1, { ...list.words[existingIndex], ...record })
  } else {
    list.words.push(record)
  }
  list.id = list.id || 'reading-highlights'
  list.name = list.name || '阅读高亮生词'
  list.source = list.source || 'reading-highlight'
  list.updatedAt = now
  dictionaryBubble.saved = writeVocabFallbackList(list)
}

async function submitAnswers() {
  if (!canSubmit.value) {
    return
  }
  submitting.value = true
  submitError.value = ''
  snapshotMessage.value = ''
  flushActiveQuestionVisit()
  stopPracticeTimer()
  try {
    const timerSnapshot = getPracticeTimerSnapshot()
    const timing = resolvePracticeTiming(1, timerSnapshot)
    const endTime = new Date(timing.endTimeMs).toISOString()
    const effectiveEndTime = new Date(timing.effectiveEndTimeMs).toISOString()
    const durationSec = timing.duration
    const attempt = {
      answers: snapshotAnswerMap(),
      markedQuestions: markedQuestions.value.slice(),
      highlights: snapshotHighlights(),
      questionTimelineLite: buildQuestionTimelineLite(),
      interactionCount: interactionCount.value,
      startTime: new Date(timing.startTimeMs).toISOString(),
      endTime,
      durationSec,
      timerSnapshot,
      effectiveEndTime,
      effectiveEndTimeMs: timing.effectiveEndTimeMs,
      scrollY: getCurrentScrollY()
    }
    const result = activeSuiteSessionId.value
      ? await practiceReadingSuite.submitPassage(activeSuiteSessionId.value, asset.value.id, { attempt })
      : await practiceSessions.create({
        activity: 'reading',
        assetId: asset.value.id,
        attempt
    })
    submission.value = result?.submission || null
    setReadingCoachOpen(Boolean(submission.value && readingCoachEnabled.value))
    suiteSession.value = result?.suiteSession || suiteSession.value
    if (submission.value?.answers) {
      Object.entries(submission.value.answers).forEach(([questionId, value]) => {
        assignAnswer(questionId, value)
      })
    }
    await nextTick()
    syncDomAnswers()
    setReadOnlyDomControls(true)
    restoreHighlightsFromRecords(submission.value?.highlights || submission.value?.analysisArtifacts?.highlights || highlightSnapshot.value)
    setPracticeTimerElapsedSeconds(Math.max(durationSec, Number(submission.value?.duration || 0)))
    snapshotSubmission()
    if (readingCoachEnabled.value) {
      const reviewPromise = runAutomaticReviewCoach({ expectedSessionId: submission.value?.sessionId })
      await reviewPromise
    }
    maybeAdvanceSuitePassage()
    scheduleEndlessNext()
  } catch (submitFailure) {
    console.error('提交阅读练习失败:', submitFailure)
    submitError.value = submitFailure?.message
      ? `阅读提交失败：${submitFailure.message}`
      : '阅读提交失败，请稍后重试'
    if (!reviewMode.value) {
      startPracticeTimer()
    }
  } finally {
    submitting.value = false
  }
}

function snapshotSubmission() {
  if (!asset.value?.id || !submission.value) return
  try {
    window.sessionStorage?.setItem(`practice_reading_submission_${asset.value.id}`, JSON.stringify(submission.value))
  } catch (_) {
    // best-effort session cache
  }
}

function clearSubmissionSnapshot() {
  if (!asset.value?.id) return
  try {
    window.sessionStorage?.removeItem(`practice_reading_submission_${asset.value.id}`)
  } catch (_) {
    // best-effort session cache cleanup
  }
}

function clearEndlessTimer() {
  if (endlessTimer) {
    window.clearInterval(endlessTimer)
    endlessTimer = null
  }
  endlessCountdown.value = 0
}

function readEndlessState() {
  try {
    const parsed = JSON.parse(window.sessionStorage?.getItem(ENDLESS_STATE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function writeEndlessState(patch = {}) {
  const nextState = {
    ...readEndlessState(),
    ...patch,
    active: patch.active !== undefined ? Boolean(patch.active) : true,
    updatedAt: new Date().toISOString()
  }
  try {
    window.sessionStorage?.setItem(ENDLESS_STATE_KEY, JSON.stringify(nextState))
  } catch (_) {
    // best-effort continuity state
  }
  return nextState
}

async function getEndlessPool() {
  const state = readEndlessState()
  const storedPool = Array.isArray(state.pool)
    ? state.pool.filter((entry) => entry?.id)
    : []
  if (storedPool.length) {
    return storedPool
  }

  const result = await loadReadingAssetPool()
  const pool = Array.isArray(result?.data)
    ? result.data.filter((entry) => entry?.id).map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category
    }))
    : []
  if (pool.length) {
    writeEndlessState({ active: true, pool })
  }
  return pool
}

function pickNextEndlessAsset(pool) {
  const currentAssetId = String(asset.value?.id || route.params.assetId || '').trim()
  const candidates = pool.filter((entry) => String(entry.id || '').trim() && String(entry.id) !== currentAssetId)
  const usablePool = candidates.length ? candidates : pool
  return usablePool[Math.floor(Math.random() * usablePool.length)] || null
}

async function scheduleEndlessNext() {
  if (!isEndlessMode.value || activeSuiteSessionId.value) {
    return
  }
  try {
    const pool = await getEndlessPool()
    const nextAsset = pickNextEndlessAsset(pool)
    if (!nextAsset?.id) {
      stopEndlessMode()
      submitError.value = '无尽模式：题库为空，已退出。'
      return
    }
    endlessNextAssetId.value = String(nextAsset.id)
    writeEndlessState({
      active: true,
      currentAssetId: nextAsset.id,
      lastCompletedAssetId: asset.value?.id || route.params.assetId || '',
      pool
    })
    clearEndlessTimer()
    endlessCountdown.value = ENDLESS_COUNTDOWN_SEC
    endlessTimer = window.setInterval(() => {
      endlessCountdown.value -= 1
      if (endlessCountdown.value <= 0) {
        goToNextEndlessAsset()
      }
    }, 1000)
  } catch (error) {
    console.error('无尽模式续题失败:', error)
    submitError.value = error?.message ? `无尽模式续题失败：${error.message}` : '无尽模式续题失败，请返回总览重试'
  }
}

function findNextSuitePassage() {
  const sequence = Array.isArray(suiteSession.value?.sequence) ? suiteSession.value.sequence : []
  return sequence.find((entry) => entry?.status === 'active' && String(entry.assetId || '').trim() !== String(asset.value?.id || '').trim()) || null
}

function findSuiteReviewNavigationTarget(direction) {
  const currentIndex = currentSuitePassageIndex.value
  const offset = direction === 'prev' ? -1 : 1
  const targetIndex = currentIndex + offset
  const entry = suiteSequence.value[targetIndex]
  const assetId = String(entry?.assetId || entry?.examId || '').trim()
  if (currentIndex < 0 || !assetId) {
    return null
  }
  if (entry.status === 'submitted' && entry.sessionId) {
    return {
      name: 'PracticeReadingReview',
      params: {
        assetId,
        sessionId: entry.sessionId
      },
      query: {
        suiteSessionId: activeSuiteSessionId.value
      }
    }
  }
  if (entry.status === 'active') {
    return {
      name: 'PracticeReading',
      params: { assetId },
      query: {
        suiteSessionId: activeSuiteSessionId.value
      }
    }
  }
  return null
}

function navigateSuiteReview(direction) {
  const target = findSuiteReviewNavigationTarget(direction)
  if (target) {
    router.push(target)
  }
}

function maybeAdvanceSuitePassage() {
  if (!activeSuiteSessionId.value || !suiteAutoAdvance.value) {
    return
  }
  const nextPassage = findNextSuitePassage()
  if (!nextPassage?.assetId) {
    return
  }
  router.push({
    name: 'PracticeReading',
    params: { assetId: nextPassage.assetId },
    query: { suiteSessionId: activeSuiteSessionId.value }
  })
}

function goToNextEndlessAsset() {
  const nextAssetId = String(endlessNextAssetId.value || '').trim()
  if (!nextAssetId) return
  clearEndlessTimer()
  router.push({
    name: 'PracticeReading',
    params: { assetId: nextAssetId },
    query: { mode: 'endless' }
  })
}

function stopEndlessMode() {
  clearEndlessTimer()
  endlessNextAssetId.value = ''
  try {
    window.sessionStorage?.removeItem(ENDLESS_STATE_KEY)
  } catch (_) {}
  router.push({
    name: 'PracticeLibrary'
  })
}

function startDividerDrag(event) {
  if (!event || (Number.isFinite(Number(event.button)) && event.button > 0)) {
    return
  }
  const shell = document.querySelector('.reading-workspace.shell')
  if (!shell) return
  event.preventDefault()
  dividerDragging.value = true
  dividerPointerId = event.pointerId
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  document.addEventListener('pointermove', handleDividerDrag)
  document.addEventListener('pointerup', stopDividerDrag)
  document.addEventListener('pointercancel', stopDividerDrag)
  handleDividerDrag(event)
}

function handleDividerDrag(event) {
  if (!dividerDragging.value || !event) {
    return
  }
  const shell = document.querySelector('.reading-workspace.shell')
  if (!shell) return
  const rect = shell.getBoundingClientRect()
  if (!rect.width) return
  const percent = ((event.clientX - rect.left) / rect.width) * 100
  leftPanePercent.value = Math.max(34, Math.min(66, percent))
}

function stopDividerDrag(event) {
  if (!dividerDragging.value) {
    return
  }
  dividerDragging.value = false
  const divider = document.getElementById('divider')
  try {
    if (divider && dividerPointerId != null) {
      divider.releasePointerCapture?.(dividerPointerId)
    } else if (divider && event?.pointerId != null) {
      divider.releasePointerCapture?.(event.pointerId)
    }
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
  } else if (event.key === 'Home') {
    event.preventDefault()
    leftPanePercent.value = 40
  } else if (event.key === 'End') {
    event.preventDefault()
    leftPanePercent.value = 60
  }
}

function handleResetButton() {
  if (isMemorizeMode.value) {
    router.push({
      name: 'PracticeReading',
      params: { assetId: asset.value?.id || props.assetId },
      query: activeSuiteSessionId.value ? { suiteSessionId: activeSuiteSessionId.value } : {}
    })
    return
  }
  if (canRecycleSubmittedAttempt.value) {
    recycleSubmittedAttempt()
    return
  }
  resetAnswers()
  restoreHighlightsFromRecords(highlightSnapshot.value)
}

function handlePrimaryButton() {
  if (isMemorizeMode.value) {
    router.push(returnRoute.value)
    return
  }
  submitAnswers()
}

function applyMemorizeStudyLayer() {
  clearMemorizeLocatorHighlights()
  if (!isMemorizeMode.value || !payload.value?.answerKey) {
    return
  }
  Object.entries(payload.value.answerKey).forEach(([questionId, answer]) => {
    const text = formatReviewAnswer(answer)
    if (text) {
      applyMemorizeLocatorHighlights(questionId, text)
    }
  })
  setReadOnlyDomControls(true)
}

function applyMemorizeLocatorHighlights(questionId, answerText) {
  const root = document.getElementById('left')
  if (!root) return
  const tokens = String(answerText || '')
    .split(/[;,/|]/)
    .map((entry) => entry.replace(/^\s*[A-Z]\.\s*/, '').trim())
    .filter((entry) => entry.length >= 3)
    .slice(0, 3)
  tokens.forEach((token) => {
    wrapTextMatches(root, token, {
      className: 'memorize-locator-highlight',
      attrs: {
        'data-memorize-question-id': questionId
      },
      limit: 1,
      skipSelector: '.hl, .memorize-locator-highlight'
    })
  })
}

function clearMemorizeLocatorHighlights() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('.memorize-locator-highlight').forEach((node) => {
    const parent = node.parentNode
    if (!parent) return
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node)
    }
    parent.removeChild(node)
    parent.normalize()
  })
}

function wrapTextMatches(root, needle, options = {}) {
  const text = normalizeComparableText(needle)
  if (!root || text.length < 3) {
    return []
  }
  const matches = []
  const className = options.className || 'hl'
  const attrs = options.attrs || {}
  const limit = Math.max(1, Number(options.limit) || 20)
  const skipSelector = options.skipSelector || '.hl'
  const nodes = getTextNodes(root)
  for (let index = 0; index < nodes.length && matches.length < limit; index += 1) {
    let current = nodes[index]
    if (current.parentElement?.closest?.(skipSelector)) {
      continue
    }
    while (current && matches.length < limit) {
      const source = current.nodeValue || ''
      const hit = source.toLowerCase().indexOf(text.toLowerCase())
      if (hit < 0) break
      const matchedNode = current.splitText(hit)
      const remainder = matchedNode.splitText(text.length)
      const span = document.createElement('span')
      span.className = className
      Object.entries(attrs).forEach(([key, value]) => {
        if (value != null) {
          span.setAttribute(key, String(value))
        }
      })
      matchedNode.parentNode.insertBefore(span, matchedNode)
      span.appendChild(matchedNode)
      matches.push(span)
      current = remainder
    }
  }
  return matches
}

function readSelectedContext() {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return null
  }
  const selection = window.getSelection()
  const text = selection && typeof selection.toString === 'function'
    ? String(selection.toString() || '').trim()
    : ''
  if (!text) {
    return null
  }
  const element = resolveSelectionElement(selection)
  const questionNumbers = collectSelectedQuestionNumbers(element)
  const paragraphLabels = collectSelectedParagraphLabels(element)
  const scope = element?.closest?.('.question-panel, .question-group, [data-answer-question-id], [data-review-question-id]')
    ? 'question'
    : 'passage'
  return {
    text: text.slice(0, 500),
    scope,
    questionNumbers,
    paragraphLabels
  }
}

function resolveSelectionElement(selection) {
  const nodes = [selection?.anchorNode, selection?.focusNode].filter(Boolean)
  for (const node of nodes) {
    const element = node.nodeType === 3 ? node.parentElement : node
    if (element && typeof element.closest === 'function') {
      return element
    }
  }
  return null
}

function normalizeSelectedQuestionNumber(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const exactNumber = raw.match(/^\d+$/)
  const qNumber = raw.match(/\bq(\d+)\b/i) || raw.match(/^q(\d+)/i)
  const numeric = exactNumber?.[0] || qNumber?.[1] || ''
  if (!numeric) return ''
  const questionId = normalizeQuestionId(`q${Number(numeric)}`)
  return String(getDisplayLabel(questionId) || numeric).replace(/^q/i, '').trim()
}

function collectSelectedQuestionNumbers(element) {
  if (!element || typeof element.closest !== 'function') {
    return []
  }
  const candidates = []
  const direct = element.closest('[data-answer-question-id], [data-review-question-id], [data-question-ids], [data-question], [data-question-id], [name], [id]')
  if (direct?.dataset?.questionIds) {
    candidates.push(...String(direct.dataset.questionIds).split(','))
  }
  if (direct?.dataset?.answerQuestionId) {
    candidates.push(direct.dataset.answerQuestionId)
  }
  if (direct?.dataset?.reviewQuestionId) {
    candidates.push(direct.dataset.reviewQuestionId)
  }
  if (direct?.dataset?.question) {
    candidates.push(direct.dataset.question)
  }
  if (direct?.dataset?.questionId) {
    candidates.push(direct.dataset.questionId)
  }
  const name = direct?.getAttribute?.('name')
  if (name) candidates.push(name)
  if (direct?.id) candidates.push(direct.id)

  const group = element.closest('[data-question-ids]')
  if (group?.dataset?.questionIds) {
    candidates.push(...String(group.dataset.questionIds).split(','))
  }
  return Array.from(new Set(candidates.map(normalizeSelectedQuestionNumber).filter(Boolean)))
}

function collectSelectedParagraphLabels(element) {
  if (!element || typeof element.closest !== 'function') {
    return []
  }
  const labels = []
  const paragraph = element.closest('[data-paragraph], [data-paragraph-label], .passage-block, .paragraph-wrapper')
  if (paragraph?.dataset?.paragraph) {
    labels.push(paragraph.dataset.paragraph)
  }
  if (paragraph?.dataset?.paragraphLabel) {
    labels.push(paragraph.dataset.paragraphLabel)
  }
  const text = String(paragraph?.textContent || element.textContent || '').trim()
  const match = text.match(/^(?:paragraph\s*)?([A-H])\b/i)
  if (match?.[1]) {
    labels.push(match[1])
  }
  return Array.from(new Set(labels.map((item) => String(item || '').replace(/^paragraph\s*/i, '').trim().toUpperCase()).filter(Boolean)))
}

function getReviewEntry(questionId) {
  return submission.value?.answerComparison?.[questionId] || null
}

function getReviewClass(questionId) {
  const entry = getReviewEntry(questionId)
  if (!entry) return ''
  if (entry.isCorrect === true) return 'review-correct'
  if (entry.isCorrect === false) return 'review-incorrect'
  return 'review-neutral'
}

function getLegacyNavStatus(questionId) {
  const entry = getReviewEntry(questionId)
  if (entry?.isCorrect === true) return 'correct'
  if (entry?.isCorrect === false) return 'incorrect'
  return hasAnswer(questionId) ? 'answered' : ''
}

function isActiveQuestion(questionId) {
  const normalized = normalizeQuestionId(questionId)
  return Boolean(normalized && activeQuestionId.value === normalized)
}

function getLegacyResultClass(questionId) {
  const entry = getReviewEntry(questionId)
  if (entry?.isCorrect === true) return 'result-correct'
  if (entry?.isCorrect === false) return 'result-incorrect'
  return ''
}

function scrollToQuestion(questionId) {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return
  recordQuestionVisit(normalized)
  const aliases = resolveAnswerAliases(normalized).map((entry) => escapeCss(entry))
  const directSelectors = aliases.flatMap((alias) => [
    `#${alias}-anchor`,
    `.question-panel [data-question="${alias}"]`,
    `.question-panel [data-question-id="${alias}"]`,
    `.question-panel [name="${alias}"]`
  ])
  const directTarget = directSelectors
    .map((selector) => document.querySelector(selector))
    .find(Boolean)
  if (directTarget) {
    directTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }
  const groupTarget = Array.from(document.querySelectorAll('.question-panel [data-question-ids]')).find((group) => {
    const ids = String(group.dataset.questionIds || '')
      .split(',')
      .map((entry) => normalizeQuestionId(entry))
      .filter(Boolean)
    return ids.includes(normalized)
  })
  groupTarget?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

function getReviewLabel(questionId) {
  const entry = getReviewEntry(questionId)
  if (!entry) return ''
  if (entry.isCorrect === true) return '正确'
  if (entry.isCorrect === false) return '错误'
  return '未判定'
}

function formatReviewAnswer(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).join(' / ')
  }
  return String(value == null ? '' : value).trim()
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(totalSeconds / 60)
  const rest = totalSeconds % 60
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`
}

function formatDensity(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0'
}

function getSeverityLabel(severity) {
  const labels = {
    high: '高',
    medium: '中',
    low: '低'
  }
  return labels[severity] || '提示'
}

function getOrCreateQuestionTimelineEntry(questionId) {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return null
  const current = answerTimeline[normalized] || {
    firstAnsweredAt: null,
    lastAnsweredAt: null,
    changeCount: 0,
    visitCount: 0,
    elapsedMs: 0,
    lastFingerprint: getAnswerFingerprint(getRawAnswer(normalized))
  }
  current.changeCount = Math.max(0, Number(current.changeCount) || 0)
  current.visitCount = Math.max(0, Number(current.visitCount) || 0)
  current.elapsedMs = Math.max(0, Number(current.elapsedMs) || 0)
  answerTimeline[normalized] = current
  return current
}

function flushActiveQuestionVisit(nowMs = Date.now()) {
  const questionId = activeQuestionVisit.questionId
  const startedAtMs = Number(activeQuestionVisit.startedAtMs) || 0
  if (!questionId || !startedAtMs || nowMs <= startedAtMs) {
    return
  }
  const entry = getOrCreateQuestionTimelineEntry(questionId)
  if (!entry) return
  entry.elapsedMs = Math.max(0, Number(entry.elapsedMs) || 0) + Math.max(0, nowMs - startedAtMs)
  activeQuestionVisit.startedAtMs = nowMs
}

function recordQuestionVisit(questionId) {
  if (reviewMode.value) {
    return
  }
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return
  activeQuestionId.value = normalized
  const nowMs = Date.now()
  if (activeQuestionVisit.questionId && activeQuestionVisit.questionId !== normalized) {
    flushActiveQuestionVisit(nowMs)
  }
  const entry = getOrCreateQuestionTimelineEntry(normalized)
  if (!entry) return
  if (activeQuestionVisit.questionId !== normalized) {
    entry.visitCount += 1
    activeQuestionVisit.questionId = normalized
  }
  activeQuestionVisit.startedAtMs = nowMs
}

function recordInteraction() {
  if (!reviewMode.value) {
    interactionCount.value += 1
  }
}

function recordAnswerTimeline(questionId, previousFingerprint, nextFingerprint) {
  const changed = previousFingerprint !== nextFingerprint
  if (!changed) {
    return
  }
  recordInteraction()
  const now = new Date().toISOString()
  recordQuestionVisit(questionId)
  const current = getOrCreateQuestionTimelineEntry(questionId)
  if (!current) return
  if (nextFingerprint && !current.firstAnsweredAt) {
    current.firstAnsweredAt = now
  }
  if (nextFingerprint) {
    current.lastAnsweredAt = now
  }
  if (current.lastFingerprint && current.lastFingerprint !== nextFingerprint) {
    current.changeCount += 1
  }
  current.lastFingerprint = nextFingerprint
  answerTimeline[questionId] = current
}

function buildQuestionTimelineLite() {
  flushActiveQuestionVisit()
  const order = Array.isArray(payload.value?.questionOrder) ? payload.value.questionOrder : []
  return order.map((questionId) => {
    const entry = answerTimeline[questionId] || {}
    const elapsedMs = Math.max(0, Math.round(Number(entry.elapsedMs) || 0))
    return {
      questionId,
      displayLabel: getDisplayLabel(questionId),
      firstAnsweredAt: entry.firstAnsweredAt || null,
      lastAnsweredAt: entry.lastAnsweredAt || null,
      changeCount: Math.max(0, Number(entry.changeCount) || 0),
      visitCount: Math.max(0, Number(entry.visitCount) || 0),
      elapsedMs,
      durationMs: elapsedMs
    }
  })
}

function normalizeOfficialQuestionExplanationSection(section, index) {
  const rawItems = Array.isArray(section?.items) ? section.items : []
  const items = rawItems
    .map((item) => {
      const questionNumber = Number(item?.questionNumber)
      const text = String(item?.text || '').trim()
      if (!Number.isFinite(questionNumber) || !text) return null
      return {
        questionNumber,
        questionId: normalizeQuestionId(item?.questionId || questionNumber),
        text
      }
    })
    .filter(Boolean)
  const text = String(section?.text || '').trim()
  if (!items.length && !text) return null
  return {
    sectionTitle: String(section?.sectionTitle || `题目讲解 ${index + 1}`).trim(),
    mode: String(section?.mode || '').trim(),
    questionRange: normalizeOfficialQuestionRange(section?.questionRange),
    text,
    items
  }
}

function normalizeOfficialQuestionRange(range) {
  const start = Number(range?.start)
  const end = Number(range?.end)
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

function getQuestionOfficialNumber(questionId) {
  const normalized = normalizeQuestionId(questionId)
  const displayNumber = Number(String(payload.value?.questionDisplayMap?.[normalized] || '').match(/\d+/)?.[0])
  if (Number.isFinite(displayNumber)) return displayNumber
  const internalNumber = Number(String(normalized || '').replace(/^q/i, ''))
  return Number.isFinite(internalNumber) ? internalNumber : null
}

function getGroupOfficialQuestionNumbers(group) {
  return (Array.isArray(group?.questionIds) ? group.questionIds : [])
    .map((questionId) => getQuestionOfficialNumber(questionId))
    .filter((value) => Number.isFinite(value))
}

function sectionOverlapsOfficialNumbers(section, questionNumbers) {
  if (!questionNumbers.length) return false
  const itemNumbers = new Set((section.items || []).map((item) => Number(item.questionNumber)).filter((value) => Number.isFinite(value)))
  if (questionNumbers.some((value) => itemNumbers.has(value))) return true
  const range = section.questionRange
  if (!range) return false
  return questionNumbers.some((value) => value >= range.start && value <= range.end)
}

function getGroupOfficialExplanations(group) {
  if (!reviewMode.value) return []
  const questionNumbers = getGroupOfficialQuestionNumbers(group)
  if (!questionNumbers.length) return []
  const splitMode = EXPLANATION_SPLIT_KINDS.has(String(group?.kind || ''))
  return officialQuestionExplanationSections.value
    .filter((section) => sectionOverlapsOfficialNumbers(section, questionNumbers))
    .map((section) => {
      const matchedItems = (section.items || []).filter((item) => questionNumbers.includes(Number(item.questionNumber)))
      const groupMode = section.mode === 'group' || (!splitMode && section.text)
      return {
        ...section,
        text: groupMode || (!matchedItems.length && section.text) ? section.text : '',
        items: groupMode ? [] : matchedItems
      }
    })
    .filter((section) => section.text || section.items.length)
}

function resolveAnswerAliases(questionId) {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return []
  const numeric = normalized.replace(/^q/i, '')
  const displayLabel = String(payload.value?.questionDisplayMap?.[normalized] || '').trim()
  return Array.from(new Set([
    normalized,
    numeric,
    `question${numeric}`,
    displayLabel,
    displayLabel ? `q${displayLabel}` : ''
  ].filter(Boolean)))
}

function normalizeQuestionId(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  const direct = raw.match(/^q(\d+)$/)
  if (direct) return `q${Number(direct[1])}`
  const numeric = raw.match(/^(\d+)$/)
  return numeric ? `q${Number(numeric[1])}` : raw
}

function expandQuestionSequence(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase()
  const numbers = (value.match(/\d+/g) || []).map((entry) => Number(entry))
  if ((value.includes('-') || value.includes('–')) && numbers.length === 2 && numbers[1] >= numbers[0]) {
    const ids = []
    for (let current = numbers[0]; current <= numbers[1]; current += 1) {
      ids.push(`q${current}`)
    }
    return ids
  }
  if ((value.includes('_') || value.includes('-') || value.includes('–')) && numbers.length >= 2) {
    return numbers.map((entry) => `q${entry}`)
  }
  const normalized = normalizeQuestionId(value)
  return normalized ? [normalized] : []
}

function escapeCss(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(value))
  }
  return String(value).replace(/["\\]/g, '\\$&')
}

function getGroupRange(group) {
  const ids = Array.isArray(group.questionIds) ? group.questionIds : []
  if (!ids.length) return 'Questions'
  const labels = ids.map((questionId) => getDisplayLabel(questionId)).filter(Boolean)
  if (labels.length <= 1) return `Question ${labels[0] || ''}`
  return `Questions ${labels[0]}-${labels[labels.length - 1]}`
}

function getQuestionKindLabel(kind) {
  const labels = {
    matching: '匹配题',
    table_completion: '表格题',
    summary_completion: '摘要填空',
    multi_choice: '多选题',
    true_false_not_given: '判断题'
  }
  return labels[kind] || kind || '题组'
}

</script>

<style>
.reading-page {
  display: grid;
  gap: 20px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.reading-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 10px 2px 4px;
}

.reading-header h1 {
  margin-top: 6px;
  font-size: clamp(1.85rem, 2.6vw, 3rem);
}

.reading-header p {
  max-width: 760px;
  margin-top: 8px;
  color: var(--text-secondary);
}

.eyebrow,
.panel-kicker {
  color: var(--primary-color);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.reading-header-actions,
.answer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.reading-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 0.28fr);
  gap: 20px;
  align-items: start;
}

.reading-main {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.reading-panel,
.answer-panel {
  padding: 22px;
}

.panel-heading,
.answer-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.panel-heading strong,
.answer-count {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.reading-html {
  color: var(--text-primary);
}

.reading-html h2,
.reading-html h3,
.reading-html h4,
.reading-html h5 {
  margin: 18px 0 10px;
  font-family: var(--font-family-display);
}

.reading-html p {
  margin: 10px 0;
}

.reading-html table {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0;
  background: rgba(255, 255, 255, 0.46);
}

.reading-html th,
.reading-html td {
  padding: 9px 10px;
  border: 1px solid rgba(41, 39, 56, 0.12);
  vertical-align: top;
}

.reading-html input[type="radio"],
.reading-html input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--primary-color);
}

.reading-html .paragraph-dropzone,
.reading-html .match-dropzone,
.reading-html .drop-target-summary {
  min-height: 36px;
  margin: 8px 0;
  padding: 8px 10px;
  border: 1px dashed rgba(201, 100, 66, 0.42);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.38);
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.reading-html .dropzone-filled {
  border-style: solid;
  border-color: rgba(35, 143, 91, 0.46);
  background: rgba(35, 143, 91, 0.12);
}

.reading-html .drag-over,
.dragdrop-slot.drag-over {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(201, 100, 66, 0.13);
}

.reading-html .pool-items,
.reading-html .options-pool,
.reading-html .headings-pool {
  transition: background 0.16s ease, box-shadow 0.16s ease;
}

.reading-html .pool-items.drag-over,
.reading-html .options-pool.drag-over,
.reading-html .headings-pool.drag-over {
  background: rgba(201, 100, 66, 0.08);
  box-shadow: inset 0 0 0 1px rgba(201, 100, 66, 0.26);
}

.question-group {
  padding: 18px 0;
  border-top: 1px solid var(--lg-border-subtle);
}

.question-group:first-of-type {
  padding-top: 0;
  border-top: 0;
}

.group-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.snapshot-message {
  margin-top: 12px;
  color: var(--warning-color);
  font-size: 0.86rem;
}

.answer-panel {
  position: sticky;
  top: 92px;
  display: grid;
  gap: 16px;
}

.answer-panel h2 {
  font-size: 1.25rem;
}

.answer-status {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.answer-status > div {
  padding: 10px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.34);
}

.answer-status span {
  display: block;
  color: var(--text-muted);
  font-size: 0.74rem;
}

.answer-status strong {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
  font-size: 0.92rem;
}

.suite-progress-mini {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid rgba(49, 95, 103, 0.22);
  border-radius: var(--radius-md);
  background: rgba(106, 204, 199, 0.1);
}

.suite-progress-mini span {
  color: var(--text-muted);
  font-size: 0.74rem;
}

.suite-progress-mini strong {
  color: var(--text-primary);
  font-size: 0.92rem;
}

.answer-list {
  display: grid;
  gap: 8px;
  max-height: min(62vh, 720px);
  overflow: auto;
  padding-right: 4px;
}

.answer-item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.mark-question-button {
  min-height: 22px;
  border: 1px solid rgba(41, 39, 56, 0.14);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.38);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 800;
}

.mark-question-button.active {
  border-color: rgba(201, 100, 66, 0.42);
  background: rgba(201, 100, 66, 0.14);
  color: var(--primary-color);
}

.mark-question-button:disabled {
  cursor: default;
  opacity: 0.7;
}

.answer-checkbox-list {
  display: grid;
  gap: 6px;
}

.answer-checkbox-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.answer-checkbox-option input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary-color);
}

.answer-dragdrop {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.dragdrop-slot {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 5px 7px;
  border: 1px dashed rgba(41, 39, 56, 0.2);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.32);
  font-size: 0.84rem;
}

.dragdrop-slot.filled {
  border-style: solid;
  border-color: rgba(35, 143, 91, 0.36);
  background: rgba(35, 143, 91, 0.1);
}

.dragdrop-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dragdrop-chip,
.reading-html .dragdrop-chip {
  min-height: 30px;
  max-width: 100%;
  padding: 5px 9px;
  border: 1px solid rgba(41, 39, 56, 0.14);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.62);
  color: var(--text-secondary);
  cursor: grab;
  font: inherit;
  font-size: 0.82rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
  text-align: left;
}

.dragdrop-chip:disabled,
.reading-html .dragdrop-chip:disabled {
  cursor: default;
  opacity: 0.76;
}

.dragdrop-chip-assigned,
.reading-html .dragdrop-chip-assigned {
  border-color: rgba(35, 143, 91, 0.36);
  background: rgba(35, 143, 91, 0.14);
  color: var(--text-primary);
}

.dragdrop-option.selected {
  border-color: rgba(35, 143, 91, 0.42);
  background: rgba(35, 143, 91, 0.14);
}

.dragdrop-option:disabled:not(.selected) {
  cursor: not-allowed;
  opacity: 0.38;
}

.dragdrop-chip.dragging,
.reading-html .dragging {
  opacity: 0.58;
}

.dragdrop-select {
  width: 100%;
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.score-grid > div {
  padding: 12px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.38);
}

.score-grid span {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.score-grid strong {
  display: block;
  margin-top: 4px;
  font-size: 1.1rem;
}

.review-analysis {
  display: grid;
  gap: 16px;
  margin: 4px 0 20px;
  padding: 16px 0 2px;
  border-top: 1px solid var(--lg-border-subtle);
  border-bottom: 1px solid var(--lg-border-subtle);
}

.llm-review-status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

.llm-review-status > strong {
  min-width: 0;
  flex: 1;
}

.llm-review-retry {
  flex: 0 0 auto;
}

.analysis-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.analysis-strip > div {
  min-width: 0;
  padding: 10px 0;
}

.analysis-strip span {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.analysis-strip strong {
  display: block;
  margin-top: 3px;
  color: var(--text-primary);
  font-size: 1.05rem;
}

.analysis-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.llm-analysis-body {
  align-items: start;
}

.llm-question-analysis-list {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
  min-width: 0;
}

.llm-question-analysis {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--lg-border-subtle);
  color: var(--text-secondary);
  font-size: 0.86rem;
}

.llm-question-analysis > strong {
  color: var(--text-primary);
}

.llm-question-analysis dl {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px 10px;
  margin: 0;
}

.llm-question-analysis dt {
  color: var(--text-muted);
}

.llm-question-analysis dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.analysis-body h3 {
  margin-bottom: 8px;
  font-size: 0.94rem;
}

.analysis-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.analysis-list li {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.analysis-list strong {
  color: var(--text-primary);
}

.analysis-kind-bars {
  display: grid;
  gap: 8px;
  padding-bottom: 14px;
}

.kind-bar-row {
  display: grid;
  grid-template-columns: minmax(92px, 0.24fr) minmax(0, 1fr) 54px;
  gap: 10px;
  align-items: center;
  color: var(--text-secondary);
  font-size: 0.86rem;
}

.kind-bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(41, 39, 56, 0.1);
}

.kind-bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--success-color);
}

.review-table,
.results-table {
  width: 100%;
  border-collapse: collapse;
  overflow-wrap: anywhere;
}

.review-table th,
.review-table td,
.results-table th,
.results-table td {
  padding: 10px;
  border-bottom: 1px solid var(--lg-border-subtle);
  text-align: left;
  vertical-align: top;
}

.review-table th,
.results-table th {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.review-correct td:last-child,
.result-correct {
  color: var(--success-color);
  font-weight: 700;
}

.review-incorrect td:last-child,
.result-incorrect {
  color: var(--danger-color);
  font-weight: 700;
}

@media (max-width: 1100px) {
  .reading-header,
  .reading-workspace {
    grid-template-columns: 1fr;
  }

  .reading-header {
    align-items: stretch;
    flex-direction: column;
  }

  .answer-panel {
    position: static;
  }

  .score-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analysis-strip,
  .analysis-body {
    grid-template-columns: 1fr;
  }
}

/* Legacy opensource reading exam shell: compact header, split panes, bottom question nav. */
.reading-page {
  --reading-line: #d7dde5;
  --reading-panel: #ffffff;
  --reading-panel-alt: #edf2f9;
  --reading-text: #1f2937;
  --reading-muted: #64748b;
  --reading-accent: #2563eb;
  --reading-success: #15803d;
  --reading-danger: #b91c1c;
  --reading-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
  --reading-dropzone-bg: #eff6ff;
  --reading-dropzone-border: #93c5fd;
  --reading-dropzone-drag-bg: #dbeafe;
  --reading-dropzone-drag-border: var(--reading-accent);
  --reading-pool-drag-bg: rgba(37, 99, 235, 0.08);
  --reading-drag-item-bg: #eff6ff;
  --reading-drag-item-border: #bfdbfe;
  --reading-nav-height: 72px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
  padding-bottom: var(--reading-nav-height);
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  color: var(--reading-text);
  font-family: "SF Pro Text", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
}

.reading-page *,
.reading-page *::before,
.reading-page *::after {
  box-sizing: border-box;
}

.reading-page.dark-mode {
  --reading-line: #334155;
  --reading-panel: #1e293b;
  --reading-panel-alt: #0f172a;
  --reading-text: #f8fafc;
  --reading-muted: #cbd5e1;
  --reading-dropzone-bg: #1e293b;
  --reading-dropzone-border: #475569;
  --reading-dropzone-drag-bg: #1e3a8a;
  --reading-dropzone-drag-border: #3b82f6;
  --reading-pool-drag-bg: rgba(59, 130, 246, 0.2);
  --reading-drag-item-bg: #334155;
  --reading-drag-item-border: #64748b;
  background: #020617;
  color: var(--reading-text);
}

.reading-header.header {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 67px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--reading-line);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.header-content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.reading-header h1 {
  margin: 0;
  color: var(--reading-text);
  font-family: inherit;
  font-size: 1.1rem;
  font-weight: 700;
  line-height: 1.4;
}

.reading-header p {
  max-width: none;
  margin: 0;
  color: var(--reading-muted);
  font-size: 0.92rem;
}

#review-nav-bar {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transform: translate(-50%, -50%);
}

#review-nav-bar button {
  border: 1px solid rgba(148, 163, 184, 0.6);
  border-radius: 6px;
  padding: 4px 10px;
  background: #fff;
  color: #0f172a;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

#review-nav-bar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.reading-page.dark-mode #review-nav-bar button {
  border-color: rgba(148, 163, 184, 0.42);
  background: #1e293b;
  color: #f8fafc;
}

.header-controls,
.reading-header-actions,
.answer-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.reading-stat,
.header-btn,
.practice-nav .controls button,
.submit-btn {
  min-height: 36px;
  border: 1px solid var(--reading-line);
  border-radius: 4px;
  background: var(--reading-panel);
  color: var(--reading-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.92rem;
  line-height: 1.2;
  padding: 8px 12px;
  text-decoration: none;
}

.reading-stat {
  cursor: default;
  font-weight: 700;
}

.reading-timer:not(:disabled) {
  cursor: pointer;
  transition: opacity 0.2s ease, background 0.2s ease;
}

.reading-timer:not(:disabled):hover {
  opacity: 0.85;
}

.reading-timer.paused {
  opacity: 0.5;
}

.reading-timer:disabled {
  cursor: default;
}

.header-btn:hover:not(:disabled),
.practice-nav .controls button:hover:not(:disabled) {
  background: #f1f5f9;
}

.header-btn:disabled,
.practice-nav .controls button:disabled,
.submit-btn:disabled {
  cursor: default;
  opacity: 0.56;
}

.submit-btn {
  border-color: var(--reading-accent) !important;
  background: var(--reading-accent) !important;
  color: #ffffff !important;
  font-weight: 600;
}

.reading-page.dark-mode .reading-header.header {
  border-bottom-color: var(--reading-line);
  background: rgba(30, 41, 59, 0.94);
}

.reading-page.dark-mode .reading-floating-panel {
  border-color: var(--reading-line);
  background: var(--reading-panel);
  color: var(--reading-text);
}

.reading-page.dark-mode .reading-stat,
.reading-page.dark-mode .header-btn,
.reading-page.dark-mode .practice-nav .controls button,
.reading-page.dark-mode .practice-nav .q-item {
  border-color: var(--reading-line);
  background: var(--reading-panel-alt);
  color: #f8fafc;
}

.reading-page.dark-mode .header-btn:hover:not(:disabled),
.reading-page.dark-mode .practice-nav .controls button:hover:not(:disabled),
.reading-page.dark-mode .practice-nav .q-item:hover {
  background: #334155;
}

.reading-page.dark-mode .submit-btn {
  background: var(--reading-accent) !important;
  color: #ffffff !important;
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 2500;
  background: rgba(15, 23, 42, 0.18);
}

.reading-floating-panel {
  position: fixed;
  z-index: 2600;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #ffffff;
  color: var(--reading-text);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
}

.reading-settings-panel {
  top: 60px;
  right: 20px;
  display: block;
  width: min(260px, calc(100vw - 28px));
  padding: 16px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
}

.reading-settings-panel .settings-section {
  margin-bottom: 16px;
}

.reading-settings-panel .settings-section:last-child {
  margin-bottom: 0;
}

.settings-title {
  color: var(--reading-muted);
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0 0 8px;
}

.settings-options {
  display: flex;
  gap: 8px;
}

.settings-option {
  flex: 1;
  border: 1px solid var(--reading-line);
  border-radius: 4px;
  background: var(--reading-panel-alt);
  color: var(--reading-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.86rem;
  padding: 8px;
  text-align: center;
}

.settings-option.active {
  border-color: var(--reading-accent);
  background: var(--reading-accent);
  color: #ffffff;
}

.reading-notes-panel {
  top: 50%;
  left: 50%;
  display: flex;
  width: min(400px, calc(100vw - 28px));
  height: min(300px, calc(100vh - 120px));
  max-height: min(300px, calc(100vh - 120px));
  flex-direction: column;
  padding: 0;
  transform: translate(-50%, -50%);
}

.reading-notes-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--reading-line);
  font-weight: 600;
}

.reading-notes-panel h3 {
  margin: 0;
  font-size: 1rem;
}

.reading-notes-panel textarea {
  flex: 1;
  min-height: 0;
  padding: 16px;
  border: none;
  background: transparent;
  color: var(--reading-text);
  font-family: inherit;
  resize: none;
}

.reading-notes-panel textarea:focus {
  outline: none;
}

.reading-selection-toolbar {
  position: absolute;
  z-index: 1000;
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 6px;
  background: #1e293b;
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.reading-selection-toolbar button {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: white;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  padding: 6px 12px;
}

.reading-selection-toolbar button:hover {
  background: #334155;
}

.reading-html .hl,
.review-dictionary-highlight {
  background-color: #72361c;
  color: #fff;
  cursor: pointer;
}

.reading-html .hl[data-hl-type="note"] {
  background-color: #0369d9;
  color: #fff;
}

.reading-html .memorize-locator-highlight {
  border-radius: 3px;
  background: rgba(187, 247, 208, 0.85);
  box-shadow: inset 0 -2px 0 rgba(22, 163, 74, 0.36);
}

.review-highlight-dictionary-bubble {
  position: fixed;
  z-index: 2800;
  width: min(340px, calc(100vw - 24px));
  max-height: min(420px, calc(100vh - 24px));
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
}

.vocab-bubble-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.vocab-term {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 1rem;
  font-weight: 700;
}

.vocab-part {
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  padding-top: 7px;
  margin-top: 7px;
}

.vocab-part:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.vocab-part-term {
  font-size: 0.94rem;
}

.vocab-meta,
.vocab-label {
  color: var(--reading-muted);
  font-size: 0.78rem;
}

.vocab-meta {
  margin-top: 2px;
  overflow-wrap: anywhere;
}

.vocab-label {
  font-weight: 700;
}

.vocab-section {
  margin-top: 8px;
}

.vocab-text {
  color: #334155;
  font-size: 0.88rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.vocab-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.vocab-close,
.vocab-add {
  border: 1px solid var(--reading-line);
  border-radius: 6px;
  background: #ffffff;
  color: var(--reading-text);
  cursor: pointer;
  font: inherit;
  padding: 6px 10px;
}

.vocab-add {
  border-color: var(--reading-accent);
  background: var(--reading-accent);
  color: #ffffff;
  font-weight: 700;
}

.vocab-add:disabled {
  cursor: default;
  opacity: 0.78;
}

.reading-workspace.shell {
  --reading-left-pane-width: clamp(360px, 50%, calc(100% - 360px));
  --reading-divider-width: 10px;
  flex: 1 1 auto;
  display: grid;
  grid-template-columns:
    minmax(280px, var(--reading-left-pane-width))
    var(--reading-divider-width)
    minmax(320px, 1fr);
  width: 100%;
  min-height: 0;
  height: auto;
  overflow: hidden;
}

.pane {
  overflow: auto;
  background: var(--reading-panel);
  padding: 22px;
  min-width: 0;
}

#left {
  min-width: 0;
}

#divider {
  border-right: 1px solid var(--reading-line);
  border-left: 1px solid var(--reading-line);
  background: linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%);
  cursor: ew-resize;
  outline: none;
  position: relative;
  touch-action: none;
  user-select: none;
}

#divider::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 48px;
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.55);
  box-shadow: -3px 0 0 rgba(100, 116, 139, 0.28), 3px 0 0 rgba(100, 116, 139, 0.28);
  transform: translate(-50%, -50%);
}

#divider:hover,
#divider:focus-visible,
#divider.is-dragging {
  border-color: #60a5fa;
  background: linear-gradient(180deg, #dbeafe 0%, #93c5fd 100%);
}

#right {
  min-width: 0;
  background: var(--reading-panel-alt);
  padding: 12px 14px;
}

.reading-page.dark-mode #divider {
  border-color: var(--reading-line);
  background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
}

.reading-page.dark-mode #divider::before {
  background: rgba(203, 213, 225, 0.62);
  box-shadow: -3px 0 0 rgba(203, 213, 225, 0.32), 3px 0 0 rgba(203, 213, 225, 0.32);
}

.reading-page.dark-mode #divider:hover,
.reading-page.dark-mode #divider:focus-visible,
.reading-page.dark-mode #divider.is-dragging {
  border-color: #60a5fa;
  background: linear-gradient(180deg, #1e3a8a 0%, #1d4ed8 100%);
}

.reading-html {
  color: var(--reading-text);
}

.reading-html h2,
.reading-html h3,
.reading-html h4,
.reading-html h5 {
  margin: 18px 0 10px;
  color: var(--reading-text);
  font-family: inherit;
}

.reading-html p,
#left p,
#right p {
  margin: 0 0 14px;
  line-height: 1.7;
}

.reading-html label {
  display: block;
  margin: 8px 0;
  line-height: 1.55;
}

.reading-html .choice-item label,
.reading-html .checkbox-options label,
.reading-html .options-list label,
.reading-html .multiple-choice-options label,
.reading-html .matching-options label,
.reading-html .mcq-group label,
.reading-html .radio-options label,
.reading-html .radio-group label,
.reading-html .multiple-choice label,
.reading-html .true-false-ng label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
  cursor: pointer;
  line-height: 1.5;
}

.reading-html .choice-item label input[type="checkbox"],
.reading-html .checkbox-options label input[type="checkbox"],
.reading-html .options-list label input[type="checkbox"],
.reading-html .choice-item label input[type="radio"],
.reading-html .multiple-choice-options label input[type="radio"],
.reading-html .matching-options label input[type="radio"],
.reading-html .mcq-group label input[type="radio"],
.reading-html .radio-options label input[type="radio"],
.reading-html .radio-group label input[type="radio"],
.reading-html .multiple-choice label input[type="radio"],
.reading-html .true-false-ng label input[type="radio"] {
  flex-shrink: 0;
  margin-top: 4px;
  cursor: pointer;
}

.reading-html input[type="text"],
.reading-html textarea,
.reading-html select,
.practice-nav select,
.practice-nav input[type="text"] {
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #ffffff;
  color: var(--reading-text);
  font: inherit;
  min-height: 32px;
  padding: 6px 8px;
}

.reading-html input[type="radio"],
.reading-html input[type="checkbox"],
.practice-nav input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--reading-accent);
  vertical-align: middle;
}

.reading-html table {
  width: 100%;
  margin: 14px 0;
  border-collapse: collapse;
  background: #ffffff;
}

.reading-page.dark-mode .reading-html input[type="text"],
.reading-page.dark-mode .reading-html textarea,
.reading-page.dark-mode .reading-html select,
.reading-page.dark-mode .practice-nav select,
.reading-page.dark-mode .practice-nav input[type="text"] {
  border-color: var(--reading-line);
  background: var(--reading-panel-alt);
  color: var(--reading-text);
}

.reading-page.dark-mode .reading-html table {
  background: var(--reading-panel);
}

.reading-html th,
.reading-html td {
  padding: 8px 10px;
  border: 1px solid var(--reading-line);
  vertical-align: top;
}

.reading-html .table-section {
  margin-top: 12px;
  overflow-x: auto;
  padding: 10px 12px;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: var(--reading-panel);
}

.reading-html .table-section table {
  width: 100%;
  margin: 0;
  table-layout: fixed;
  border-collapse: collapse;
}

.reading-html .table-section thead th {
  padding: 10px 8px;
  border: 1px solid var(--reading-line);
  background: var(--reading-panel-alt);
  text-align: center;
  font-weight: 700;
}

.reading-html .table-section tbody td {
  padding: 10px 10px;
  border: 1px solid var(--reading-line);
  vertical-align: top;
  line-height: 1.45;
}

.reading-html .table-section thead th:first-child,
.reading-html .table-section tbody td:first-child {
  width: 16%;
}

.reading-html .table-section thead th:nth-child(2),
.reading-html .table-section tbody td:nth-child(2) {
  width: 20%;
}

.reading-html .table-section thead th:nth-child(3),
.reading-html .table-section tbody td:nth-child(3) {
  width: 64%;
}

.reading-html .table-section ul {
  margin: 0;
  padding-left: 20px;
}

.reading-html .table-section li + li {
  margin-top: 6px;
}

.reading-html .table-section input.blank {
  display: inline-block;
  min-width: 120px;
  max-width: 180px;
  width: 40%;
  padding: 2px 6px;
  border: 1px solid var(--reading-line);
  border-radius: 4px;
  background: var(--reading-panel);
  color: var(--reading-text);
  vertical-align: middle;
}

.unified-group.question-group {
  margin-bottom: 16px;
  padding: 0;
  border: 0;
  border-radius: 4px;
}

.unified-group__lead {
  margin-bottom: 12px;
}

.reading-html .group {
  margin-bottom: 0;
  padding: 18px 22px;
  border: 1px solid var(--reading-line);
  border-radius: 4px;
  background: var(--reading-panel);
  box-shadow: var(--reading-shadow);
}

#results.review-panel {
  margin: 18px 0 0;
  padding: 18px;
  border: 1px solid var(--reading-line);
  border-radius: 4px;
  background: var(--reading-panel);
  box-shadow: var(--reading-shadow);
}

.reading-page.dark-mode .reading-html .group,
.reading-page.dark-mode #results.review-panel {
  border-color: var(--reading-line);
  background: var(--reading-panel);
}

.reading-explanation-panel {
  display: grid;
  gap: 10px;
  margin: 14px 0 22px;
}

.reading-explanation-card {
  margin: 10px 0 14px;
  padding: 10px 12px;
  border: 1px solid rgba(37, 99, 235, 0.22);
  border-left: 4px solid rgba(37, 99, 235, 0.9);
  border-radius: 8px;
  background: rgba(239, 246, 255, 0.75);
}

.reading-explanation-card__label {
  margin-bottom: 6px;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
}

.reading-explanation-card__text {
  color: #1f2937;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.reading-group-explanation,
.reading-question-explanation {
  margin-top: 10px;
}

.reading-question-explanation-list {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}

.reading-question-explanation-list h5 {
  margin: 0 0 8px;
  color: #1d4ed8;
  font-size: 13px;
  font-weight: 700;
}

.reading-question-explanation-item {
  margin: 8px 0;
}

.reading-html .question-item,
.reading-html .match-question-item,
.reading-html .choice-item {
  margin-bottom: 12px;
}

.reading-html .paragraph-dropzone,
.reading-html .match-dropzone,
.dragdrop-slot {
  display: flex;
  min-height: 40px;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 2px dashed var(--reading-dropzone-border);
  border-radius: 4px;
  background: var(--reading-dropzone-bg);
  color: var(--reading-muted);
  transition: border-color 0.16s ease, background 0.16s ease;
}

.reading-page.dark-mode .reading-html .paragraph-dropzone,
.reading-page.dark-mode .reading-html .match-dropzone,
.reading-page.dark-mode .reading-html [data-vue-dropzone="true"],
.reading-page.dark-mode .dragdrop-slot {
  border-color: #475569 !important;
  background: #1e293b !important;
  color: var(--reading-muted);
}

.reading-html .paragraph-dropzone.drag-over,
.reading-html .match-dropzone.drag-over,
.reading-html .drag-over,
.dragdrop-slot.drag-over {
  border-color: var(--reading-dropzone-drag-border);
  background: var(--reading-dropzone-drag-bg);
  box-shadow: none;
}

.reading-page.dark-mode .reading-html .paragraph-dropzone.drag-over,
.reading-page.dark-mode .reading-html .match-dropzone.drag-over,
.reading-page.dark-mode .reading-html [data-vue-dropzone="true"].drag-over,
.reading-page.dark-mode .reading-html .drag-over,
.reading-page.dark-mode .dragdrop-slot.drag-over {
  border-color: #3b82f6 !important;
  background: #1e3a8a !important;
}

.reading-html .paragraph-dropzone.dropzone-filled,
.reading-html .match-dropzone.dropzone-filled,
.dragdrop-slot.filled {
  border-style: solid;
}

.reading-html .drop-target-summary {
  position: relative;
  display: inline-flex;
  min-width: 80px;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  margin: 0 4px;
  padding: 0 8px;
  border: 0;
  border-bottom: 2px solid var(--reading-muted);
  border-radius: 4px 4px 0 0;
  background: rgba(0, 0, 0, 0.02);
  box-shadow: none;
  vertical-align: bottom;
  transition: all 0.2s ease;
}

.reading-html .drop-target-summary.drag-over {
  border-bottom-color: var(--reading-accent);
  background: #dbeafe;
}

.reading-html .drop-target-summary.dropzone-filled {
  border-bottom-color: var(--reading-success);
  background: #dcfce7;
  color: var(--reading-success);
  font-weight: 600;
}

.reading-html .drop-target-summary .drag-item,
.reading-html .drop-target-summary .dragdrop-chip {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: grab;
  font-weight: inherit;
}

.reading-page.dark-mode .reading-html .drop-target-summary {
  background: rgba(255, 255, 255, 0.04);
}

.reading-page.dark-mode .reading-html .drop-target-summary.drag-over {
  background: #1e3a8a;
}

.reading-page.dark-mode .reading-html .drop-target-summary.dropzone-filled {
  background: #064e3b;
  color: #dcfce7;
}

.reading-html .paragraph-label {
  color: var(--reading-muted);
  font-size: 0.9rem;
  font-weight: 700;
  white-space: nowrap;
}

.reading-html .pool-items,
.reading-html .options-pool,
.reading-html .headings-pool,
.reading-html .dropped-items,
.dragdrop-options {
  display: flex;
  min-height: 40px;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
}

.reading-html .pool-items.drag-over,
.reading-html .options-pool.drag-over,
.reading-html .headings-pool.drag-over {
  border-color: var(--reading-accent);
  background: var(--reading-pool-drag-bg);
  box-shadow: none;
}

.reading-page.dark-mode .reading-html .pool-items.drag-over,
.reading-page.dark-mode .reading-html .options-pool.drag-over,
.reading-page.dark-mode .reading-html .headings-pool.drag-over {
  border-color: var(--reading-dropzone-drag-border);
  background: var(--reading-pool-drag-bg);
}

.reading-html .dropped-items:empty::after {
  content: "拖到这里";
  color: #7b8a98;
  font-size: 0.82rem;
}

.reading-page.dark-mode .reading-html .dropped-items:empty::after {
  color: #94a3b8;
}

.reading-html .drag-item,
.dragdrop-chip,
.reading-html .dragdrop-chip {
  min-height: 32px;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--reading-drag-item-border);
  border-radius: 4px;
  background: var(--reading-drag-item-bg);
  color: var(--reading-text);
  cursor: grab;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
  text-align: left;
  user-select: none;
}

.reading-page.dark-mode .reading-html .drag-item,
.reading-page.dark-mode .dragdrop-chip,
.reading-page.dark-mode .reading-html .dragdrop-chip {
  border-color: #64748b !important;
  background: #334155 !important;
  color: #f8fafc;
}

.reading-html .drag-item.dragging,
.dragdrop-chip.dragging,
.reading-html .dragging {
  opacity: 0.55;
}

.reading-html .drag-item--assigned,
.dragdrop-chip-assigned,
.reading-html .dragdrop-chip-assigned {
  border-style: solid;
  border-color: var(--reading-drag-item-border);
  background: var(--reading-drag-item-bg);
}

.reading-page.dark-mode .reading-html .drag-item--assigned,
.reading-page.dark-mode .dragdrop-chip-assigned,
.reading-page.dark-mode .reading-html .dragdrop-chip-assigned {
  border-color: #64748b !important;
  background: #334155 !important;
}

.dragdrop-option.selected {
  border-color: #93c5fd;
  background: #dbeafe;
}

.reading-page.dark-mode .dragdrop-option.selected {
  border-color: #3b82f6;
  background: #1e40af;
  color: #ffffff;
}

.dragdrop-option:disabled:not(.selected) {
  cursor: not-allowed;
  opacity: 0.38;
}

.practice-nav {
  position: fixed;
  top: auto;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 16px;
  height: var(--reading-nav-height);
  min-height: var(--reading-nav-height);
  padding: 12px 18px;
  border-top: 1px solid var(--reading-line);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.06);
  overflow: visible;
}

.reading-page.dark-mode .practice-nav {
  border-color: var(--reading-line);
  background: var(--reading-panel);
}

.practice-nav .title {
  flex: 0 0 auto;
  color: var(--reading-muted);
  font-weight: 700;
  white-space: nowrap;
}

.practice-nav .questions {
  display: flex;
  max-height: none;
  flex: 1 1 auto;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  overflow-y: visible;
  padding: 0;
}

.practice-nav .question-nav-entry {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}

.practice-nav .q-item {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  border: 1px solid var(--reading-line);
  border-radius: 4px;
  background: var(--reading-panel);
  color: var(--reading-text);
  cursor: pointer;
  font-size: 0.9rem;
}

.practice-nav .controls {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 8px;
  margin-left: auto;
}

.practice-nav .q-item:hover {
  background: #f1f5f9;
}

.practice-nav .q-item.answered {
  border-color: #93c5fd;
  background: #dbeafe;
}

.practice-nav .q-item.active,
.practice-nav .q-item.answered.active {
  border-color: var(--reading-accent);
  background: #eff6ff;
  color: var(--reading-accent);
  font-weight: 600;
}

.reading-page.dark-mode .practice-nav .q-item.answered {
  border-color: #3b82f6;
  background: #1e3a8a;
  color: #ffffff;
}

.reading-page.dark-mode .practice-nav .q-item.active,
.reading-page.dark-mode .practice-nav .q-item.answered.active {
  border-color: var(--reading-accent);
  background: #1e40af;
  color: #ffffff;
}

.practice-nav .q-item.correct,
.practice-nav .q-item.review-correct {
  border-color: var(--reading-success);
  background: #dcfce7;
  color: var(--reading-success);
}

.reading-page.dark-mode .practice-nav .q-item.correct,
.reading-page.dark-mode .practice-nav .q-item.review-correct {
  border-color: var(--reading-success);
  background: #064e3b;
  color: #dcfce7;
}

.practice-nav .q-item.incorrect,
.practice-nav .q-item.review-incorrect {
  border-color: var(--reading-danger);
  background: #fee2e2;
  color: var(--reading-danger);
}

.reading-page.dark-mode .practice-nav .q-item.incorrect,
.reading-page.dark-mode .practice-nav .q-item.review-incorrect {
  border-color: var(--reading-danger);
  background: #7f1d1d;
  color: #fee2e2;
}

.practice-nav .q-item.marked::after {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 10px;
  height: 10px;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: #f59e0b;
  content: "";
}

.mark-question-button {
  min-width: 18px;
  min-height: 18px;
  margin-left: -4px;
  padding: 0 4px;
  border: 1px solid rgba(100, 116, 139, 0.45);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--reading-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
}

.reading-page.dark-mode .mark-question-button {
  border-color: #475569;
  background: rgba(15, 23, 42, 0.82);
  color: var(--reading-muted);
}

.mark-question-button.active {
  border-color: #f59e0b;
  background: #fffbeb;
  color: #b45309;
}

.mark-question-button:disabled {
  cursor: default;
  opacity: 0.62;
}

.dragdrop-select {
  width: 100%;
}

.suite-progress-mini {
  display: grid;
  min-height: 36px;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}

.suite-progress-mini span {
  display: block;
  color: var(--reading-muted);
  font-size: 0.72rem;
}

.suite-progress-mini strong {
  display: block;
  color: var(--reading-text);
  font-size: 0.86rem;
}

.snapshot-message {
  position: absolute;
  right: 18px;
  bottom: calc(100% + 8px);
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  background: #fffbeb;
  color: #92400e;
  font-size: 0.86rem;
  box-shadow: var(--reading-shadow);
}

.panel-kicker {
  color: var(--reading-accent);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.panel-heading,
.answer-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.score-grid > div,
.analysis-strip > div {
  padding: 10px 12px;
  border: 1px solid var(--reading-line);
  border-radius: 8px;
  background: #f8fafc;
}

.score-grid span,
.analysis-strip span {
  display: block;
  color: var(--reading-muted);
  font-size: 0.75rem;
}

.score-grid strong,
.analysis-strip strong {
  display: block;
  margin-top: 3px;
  color: var(--reading-text);
}

.review-analysis {
  display: grid;
  gap: 16px;
  margin: 4px 0 20px;
  padding: 16px 0 2px;
  border-top: 1px solid var(--reading-line);
  border-bottom: 1px solid var(--reading-line);
}

.llm-review-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.llm-review-status > strong {
  min-width: 0;
  flex: 1;
}

.analysis-strip,
.analysis-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.llm-question-analysis-list {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
}

.llm-question-analysis {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--reading-line);
  color: #475569;
  font-size: 0.86rem;
}

.llm-question-analysis > strong {
  color: var(--reading-text);
}

.llm-question-analysis dl {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px 10px;
  margin: 0;
}

.llm-question-analysis dt {
  color: var(--reading-muted);
}

.llm-question-analysis dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.analysis-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.analysis-list li {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
  color: #475569;
  font-size: 0.88rem;
}

.kind-bar-row {
  display: grid;
  grid-template-columns: minmax(92px, 0.24fr) minmax(0, 1fr) 54px;
  gap: 10px;
  align-items: center;
  color: #475569;
  font-size: 0.86rem;
}

.kind-bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}

.kind-bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--reading-success);
}

.review-table,
.results-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
  overflow-wrap: anywhere;
  font-size: 0.92rem;
}

.review-table th,
.review-table td,
.results-table th,
.results-table td {
  padding: 8px 10px;
  border: 1px solid var(--reading-line);
  text-align: center;
  vertical-align: top;
}

.review-correct td:last-child,
.result-correct {
  color: var(--reading-success);
  font-weight: 700;
}

.review-incorrect td:last-child,
.result-incorrect {
  color: var(--reading-danger);
  font-weight: 700;
}

.reading-coach-fab {
  position: fixed;
  right: 16px;
  bottom: 20px;
  z-index: 9999;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #0f766e, #0e7490);
  color: #ffffff;
  box-shadow: 0 12px 24px rgba(15, 118, 110, 0.28);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  touch-action: none;
  user-select: none;
}

.reading-coach-panel {
  position: fixed;
  right: 16px;
  bottom: 70px;
  z-index: 9999;
  display: none;
  overflow: hidden;
  width: min(380px, calc(100vw - 24px));
  max-height: min(68vh, 560px);
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 22px 40px rgba(15, 23, 42, 0.24);
  touch-action: none;
}

.reading-coach-panel.is-open {
  display: flex;
  flex-direction: column;
}

.reading-coach-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.3);
  background: #f8fafc;
}

.reading-coach-panel__title {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
}

.reading-coach-panel__close {
  border: 0;
  background: transparent;
  color: #334155;
  cursor: pointer;
  font-size: 16px;
}

.reading-coach-panel__status,
.reading-coach-panel__error {
  min-height: 22px;
  padding: 8px 12px 0;
  color: #0f766e;
  font-size: 12px;
}

.reading-coach-panel__status.is-error,
.reading-coach-panel__error {
  color: #b91c1c;
}

.reading-coach-panel__messages {
  display: grid;
  flex: 1;
  gap: 8px;
  overflow: auto;
  padding: 10px 12px;
  background: #f8fafc;
}

.reading-coach-msg {
  padding: 8px 10px;
  border-radius: 10px;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.reading-coach-msg.user {
  justify-self: end;
  background: #dbeafe;
  color: #1e3a8a;
}

.reading-coach-msg.assistant {
  justify-self: start;
  border: 1px solid rgba(148, 163, 184, 0.26);
  background: #ffffff;
  color: #0f172a;
}

.reading-coach-msg.error {
  border-color: rgba(185, 28, 28, 0.35);
  color: #991b1b;
}

.reading-coach-panel__actions,
.reading-coach-panel__followups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 0;
}

.reading-coach-chip {
  padding: 4px 8px;
  border: 1px solid rgba(15, 118, 110, 0.28);
  border-radius: 999px;
  background: #ffffff;
  color: #0f766e;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
}

.reading-coach-chip:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.reading-coach-panel__selected-context {
  display: grid;
  gap: 6px;
  padding: 8px 12px 0;
  color: #334155;
  font-size: 12px;
}

.reading-coach-panel__selected-context span {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.reading-coach-panel__selected-context strong {
  max-height: 4.8em;
  overflow: hidden;
  font-weight: 600;
  line-height: 1.5;
}

.reading-coach-panel__composer {
  display: flex;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.3);
  background: #ffffff;
}

.reading-coach-panel__input {
  flex: 1;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
}

.reading-coach-panel__send {
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: #0f766e;
  color: #ffffff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}

.reading-coach-panel__send:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 980px) {
  .reading-coach-panel {
    right: 8px;
    left: 8px;
    bottom: 64px;
    width: auto;
    max-height: 70vh;
  }

  .reading-coach-fab {
    right: 10px;
    bottom: 12px;
  }

  .reading-page {
    --reading-nav-height: 112px;
    min-height: 100vh;
    height: auto;
    overflow: auto;
    padding-bottom: var(--reading-nav-height);
  }

  .reading-header.header {
    align-items: flex-start;
    flex-direction: column;
  }

  .reading-workspace.shell {
    display: block;
    height: auto;
    overflow: visible;
    min-height: 0;
  }

  #left,
  #right {
    width: 100%;
    min-width: 0;
    flex: none;
  }

  #divider {
    display: none;
  }

  .practice-nav {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 10px;
    height: var(--reading-nav-height);
    overflow-y: auto;
  }

  .practice-nav .questions {
    order: 3;
    flex-basis: 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
  }

  .practice-nav .controls {
    margin-left: 0;
    width: 100%;
    justify-content: flex-end;
  }

  .reading-html .table-section input.blank {
    width: 100%;
    max-width: none;
    margin-top: 4px;
  }

  .score-grid,
  .analysis-strip,
  .analysis-body {
    grid-template-columns: 1fr;
  }
}
</style>
