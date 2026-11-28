<template>
  <!-- Exam chrome mirrors assets/generated/reading-exams/reading-practice-unified.html
       (skin: modules/reading-unified/styles/unified.css, generated). Host-only
       surfaces — coach, dictionary bubble, analysis — ride on top of it. -->
  <div
    id="runified-root"
    class="runified"
    :class="readingPageClassList"
    :data-suite-mode="activeSuiteSessionId ? 'true' : null"
  >
    <UnifiedExamHeader
      :title="pageTitle"
      :subtitle="headerSummary"
      :show-timer="Boolean(payload) && !materialMode"
      :timer-text="formattedTimer"
      :timer-running="timerRunning"
      :review-mode="reviewMode"
      :note-count="noteEntries.length"
      :notes-open="noteDrawerOpen"
      :options-open="settingsPanelOpen"
      :part-index="partIndex"
      :instruction="subHeaderInstruction"
      @toggle-timer="toggleTimer"
      @toggle-notes="noteDrawerOpen = !noteDrawerOpen"
      @toggle-options="toggleSettingsPanel"
    >
      <template v-if="materialMode" #heading><strong>{{ pageTitle }}</strong></template>
      <template v-if="materialMode" #controls>
        <button v-if="readerState" class="btn-text" type="button" :disabled="Boolean(readerProgressBusy)" @click="saveReaderPosition">
          {{ readerProgressBusy === 'save' ? '正在保存…' : '保存位置' }}
        </button>
        <button v-if="readerState" class="btn-text" type="button" :disabled="Boolean(readerProgressBusy || readerState.completedAt)" @click="updateReaderProgress({ kind: 'complete' })">
          {{ readerState.completedAt ? '已读完' : readerProgressBusy === 'complete' ? '正在标记…' : '标记读完' }}
        </button>
        <span v-if="readerProgressError" role="alert">{{ readerProgressError }}</span>
        <span v-else-if="readerState" role="status">{{ readerProgressMessage }}</span>
        <label>字号 <select :value="fontSize" @change="selectFontSize($event.target.value)"><option value="small">小</option><option value="normal">中</option><option value="large">大</option></select></label>
        <button class="btn-text" type="button" @click="setDarkMode(!darkMode)">{{ darkMode ? '浅色' : '深色' }}</button>
        <button class="btn-text" type="button" @click="handleLeave">返回阅读题库</button>
      </template>
    </UnifiedExamHeader>

    <div ref="settingsPanel" @keydown="handleSettingsDialogKeydown">
      <UnifiedOptionsPanel
        v-if="settingsPanelOpen && !materialMode"
        :font-size="fontSize"
        :dark-mode="darkMode"
        :annotations="annotations"
        :question-nav-collapsed="questionNavCollapsed"
        :clear-disabled="reviewMode || isMemorizeMode || resetButtonDisabled"
        @close="closeFloatingPanels"
        @select-font="selectFontSize"
        @set-dark="setDarkMode"
        @toggle-annotation="toggleAnnotation"
        @toggle-question-nav="setQuestionNavCollapsed(!questionNavCollapsed)"
        @clear-answers="handleResetButton"
      >
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
            >开启</button>
            <button
              class="settings-option"
              type="button"
              data-reading-coach-enabled="false"
              :class="{ active: readingCoachEnabled === false }"
              :disabled="readingCoachSettingSaving"
              @click="updateReadingCoachEnabled(false)"
            >关闭</button>
          </div>
          <p v-if="readingCoachSettingError" class="settings-hint" role="alert">{{ readingCoachSettingError }}</p>
        </div>
        <div v-if="activeSuiteSessionId" class="settings-section" id="suite-flow-mode-section">
          <h3 class="settings-title">套题流程模式</h3>
          <div class="settings-options">
            <button
              class="settings-option"
              type="button"
              data-suite-flow-mode="auto"
              :class="{ active: suiteAutoAdvance === true }"
              @click="setSuiteAutoAdvance(true)"
            >自动跳转下一篇</button>
            <button
              class="settings-option"
              type="button"
              data-suite-flow-mode="manual"
              :class="{ active: suiteAutoAdvance === false }"
              @click="setSuiteAutoAdvance(false)"
            >提交后停留回看</button>
          </div>
        </div>
        <template #actions>
          <button
            v-if="canSnapshot"
            id="options-snapshot"
            class="settings-option"
            type="button"
            @click="snapshotAnswers"
          >保存作答快照</button>
          <button
            id="options-leave"
            class="settings-option"
            type="button"
            :disabled="leaving"
            @click="handleLeave"
          >{{ returnLabel }}</button>
        </template>
      </UnifiedOptionsPanel>
    </div>

    <div ref="notesPanel" @keydown="handleNotesDialogKeydown">
      <UnifiedNotes
        v-if="!materialMode"
        v-model:text="notesText"
        :drawer-open="noteDrawerOpen"
        :editor-open="notesPanelOpen"
        :entries="noteEntries"
        :error="notesError"
        @open-editor="openNoteEditor"
        @close-editor="closeFloatingPanels"
        @close-drawer="noteDrawerOpen = false"
        @locate="locateNote"
      />
    </div>

    <UnifiedSelectionBar
      v-if="!materialMode"
      :visible="selectionToolbarVisible"
      :position="selectionToolbarStyle"
      :can-remove="selectionHasMark"
      @hold="keepSelectionToolbar = $event"
      @note="applySelectionNote"
      @remove="removeSelectionHighlight"
      :can-ask-coach="canAskCoachFromSelection"
      @highlight="applySelectionHighlight('highlight')"
      @ask-coach="askCoachFromSelection"
    />

    <ReadingDictionaryBubble
      v-if="dictionaryBubble.visible"
      :bubble="dictionaryBubble"
      @close="closeDictionaryBubble"
      @save="saveDictionaryBubbleWord"
    />

    <div v-if="isEndlessMode" class="endless-message" data-reading-endless-mode role="status" aria-live="polite">
      <span>{{ endlessStatusText }}</span>
      <div class="endless-actions">
        <button v-if="endlessNextAssetId" class="btn-text" type="button" :disabled="leaving" @click="goToNextEndlessAsset">下一篇</button>
        <button class="btn-text" type="button" :disabled="leaving" @click="stopEndlessMode">退出无尽模式</button>
      </div>
    </div>

    <p v-if="error" class="runified-status is-error" role="alert">
      <span>{{ error }}</span>
      <button class="btn-text" type="button" :disabled="loading || localRecordLoading" @click="loadAsset">重试</button>
      <router-link v-if="localRecord" :to="returnRoute">返回题库</router-link>
    </p>
    <p v-else-if="submitError" class="runified-status is-error" role="alert">{{ submitError }}</p>
    <p v-else-if="highlightRestoreWarning" class="runified-status is-error" role="status">{{ highlightRestoreWarning }}</p>
    <p v-else-if="snapshotMessage" class="runified-status snapshot-message" role="status" aria-live="polite">{{ snapshotMessage }}</p>
    <p v-if="reviewLoadError" class="runified-status is-error" role="alert" data-reading-review-error>
      <span>{{ reviewLoadError }}</span>
      <button class="btn-text" type="button" :disabled="reviewLoading" @click="retryProviderReview">{{ reviewLoading ? '正在重试…' : '重试复盘材料' }}</button>
    </p>
    <p v-if="submission?.recoveredDraftId" class="runified-status" role="status">已核对首次提交。等待期间修改的答案另存为未提交草稿，再次打开本题可继续。</p>
    <DraftSaveNotice v-if="!readOnlyMode" :error="draftError" :saving="draftSaving" @retry="draftQueue.flush()" />
    <LocalPracticeRecord v-if="localRecord && (!examReady || (reviewMode && !submission))" :record="localRecord" />
    <p v-if="loading || localRecordLoading" class="runified-status" role="status" aria-live="polite" aria-busy="true">正在加载阅读内容…</p>
    <p v-else-if="!asset && !error" class="runified-status" role="status">未找到阅读题目，返回练习库重新选择资源。</p>

    <p class="sr-only" aria-live="polite">{{ dragInteractionStatus }}</p>

    <div
      v-if="!loading && !localRecordLoading && asset && payload && (!localRecord || examReady)"
      ref="shellRef"
      class="shell"
      :class="{ 'review-mode': reviewMode, 'memorize-mode': isMemorizeMode }"
      data-practice-reading-page
      @click="handleWorkspaceClick"
      @keydown="handleWorkspaceKeydown"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <ReadingPassagePane
        ref="readingPassagePane"
        :passage-blocks="visiblePassageBlocks"
        :official-passage-notes="officialPassageNotes"
        :material="reviewMode || materialMode ? payload.studyMaterial : null"
        :material-error="materialError"
        :located-sentences="locatedSentences"
        :highlighted-sentences="readerHighlights"
        @retry-material="loadStudyMaterial"
      >
        <template v-if="readerBookmarks" #sentence-actions="{ sentence }">
          <button class="btn-text" type="button" :disabled="Boolean(readerBookmarkBusy)"
            :aria-pressed="readerBookmarks.includes(sentence.id)" @click.stop="toggleReaderBookmark(sentence.id)">
            {{ readerBookmarkBusy === sentence.id ? '正在保存…' : readerBookmarks.includes(sentence.id) ? '取消收藏' : '收藏本句' }}
          </button>
          <span v-if="readerBookmarkError?.id === sentence.id" role="alert">{{ readerBookmarkError.message }}</span>
          <ReaderSentenceAnnotations v-if="readerAnnotations" :key="asset.id + ':' + sentence.id"
            :asset-id="asset.id" :sentence-id="sentence.id" :annotations="readerAnnotations[sentence.id]"
            @update="rows => readerAnnotations[sentence.id] = rows" />
        </template>
      </ReadingPassagePane>

      <div
        v-if="!materialMode"
        id="divider"
        ref="dividerRef"
        :class="{ 'is-dragging': dividerDragging }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整原文与题目宽度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="dividerValue"
        tabindex="0"
        @pointerdown="startDividerDrag"
        @keydown="handleDividerKeydown"
      ></div>

      <ReadingQuestionPane
        v-if="!materialMode"
        :payload="visibleQuestionPayload"
        :is-memorize-mode="isMemorizeMode"
        :get-group-official-explanations="getGroupOfficialExplanations"
        :get-group-range="getGroupRange"
        :normalize-question-id="normalizeQuestionId"
        :get-display-label="getDisplayLabel"
        :format-review-answer="formatReviewAnswer"
        @question-input="handleQuestionInput"
        @locate-answer="locateAnswer"
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
          :attempt-review-enabled="featureFlags.readingAttemptReviewV1"
          :attempt-review-loading="attemptReviewLoading"
          :attempt-review-available="Boolean(attemptReviewComparison)"
          :attempt-review-comparison="attemptReviewComparison"
          :attempt-review-status="attemptReviewStatus"
          :attempt-review-error="attemptReviewError"
          :attempt-review-content="attemptReviewContent"
          :attempt-review-tool-calls="attemptReviewToolCalls"
          @retry-review="runAutomaticReviewCoach"
          @run-attempt-review="runAttemptReview"
          @jump="scrollToQuestion"
        />
        <SuitePassageNav
          v-if="activeSuiteSessionId"
          :can-prev="canNavigateSuiteReviewPrev"
          :can-next="canNavigateSuiteReviewNext"
          @navigate="navigateSuiteReview"
        />
      </ReadingQuestionPane>
    </div>

    <ReadingCoachPanel
      v-if="readingCoachEnabled && !materialMode"
      :submission="submission"
      :reading-coach-open="readingCoachOpen"
      :coach-loading="coachLoading"
      :coach-status-text="coachStatusText"
      :coach-notice="coachNotice"
      :coach-history-failed="coachHistoryFailed"
      :coach-retry-kind="coachRetryKind"
      :selected-context="selectedContext"
      :coach-transcript="coachTranscript"
      :coach-response="coachResponse"
      :coach-remembered="coachRemembered"
      :coach-quick-actions="coachQuickActions"
      :coach-selection-actions="coachSelectionActions"
      :coach-follow-ups="coachFollowUps"
      :coach-feedback="coachFeedback"
      :coach-adjustments="coachAdjustments"
      :coach-memory-cards="coachMemoryCards"
      :coach-reaskable-id="coachReaskableId"
      :coach-query="coachQuery"
      :can-ask-coach="canAskCoach"
      @toggle-panel="toggleReadingCoachPanel"
      @update:reading-coach-open="setReadingCoachOpen"
      @clear-selected-context="clearSelectedContext"
      @quick-action="runCoachQuickAction"
      @selection-action="runCoachSelectionAction"
      @follow-up="askCoachFollowUp"
      @feedback="submitCoachFeedback($event.messageId, $event.kind)"
      @memory-card-confirm="confirmCoachMemoryCard($event.messageId, $event.text)"
      @memory-card-dismiss="dismissCoachMemoryCard($event.messageId)"
      @reask="reaskCoachMessage"
      @retry="retryCoachQuery"
      @reload-history="reloadCoachHistory"
      @forget-remembered="forgetRememberedPreference"
      @update:coach-query="coachQuery = $event"
      @refresh-selected-context="refreshSelectedContext"
      @ask="askCoach"
    />

    <UnifiedPracticeNav
      v-if="!loading && !localRecordLoading && asset && payload && !materialMode && (!localRecord || examReady)"
      :question-order="idictationSections?.[idictationPart - 1]?.questionIds || payload.questionOrder || []"
      :display-map="payload.questionDisplayMap || {}"
      :category="idictationExam ? `P${idictationPart}` : navCategory"
      :sections="idictationSections"
      :has-answer="hasAnswer"
      :answer-comparison="submission?.answerComparison || null"
      :active-question-id="activeQuestionId"
      :review-mode="reviewMode"
      :submit-disabled="primaryButtonDisabled"
      :submit-label="primaryButtonLabel"
      :show-exit="reviewMode || isMemorizeMode"
      :show-reset="reviewMode || isMemorizeMode"
      :reset-disabled="resetButtonDisabled"
      :part-summaries="suitePartSummaries"
      :is-marked="isMarkedQuestion"
      :flags-read-only="readOnlyMode"
      @scroll-to-question="scrollToQuestion"
      @submit="handlePrimaryButton"
      @reset="handleResetButton"
      @leave="handleLeave"
      @open-part="openReadingPart"
      @toggle-marked-question="toggleMarkedQuestion"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DraftSaveNotice from '@/components/DraftSaveNotice.vue'
import { useDraftSaveQueue } from '@/modules/reading-unified/composables/useDraftSaveQueue.js'
import { useDraftLeaveGuard } from '@/modules/reading-unified/composables/useDraftLeaveGuard.js'
import { practiceReadingSuite, practiceSessions } from '@/api/practice-client.js'
import { loadLocalCompletedDetail } from '@/api/local-practice-record.js'
import { mapHistoryDetailToSubmission } from '@/api/history-repository.js'
import LocalPracticeRecord from '@/components/LocalPracticeRecord.vue'
import { learningRepository } from '@/api/learning-repository.js'
import { readingCoachSettingsApi } from '@/modules/practice-reading/api'
import { featureFlags } from '@/config/feature-flags.js'
import ReadingCoachPanel from '@/modules/practice-reading/components/ReadingCoachPanel.vue'
import ReadingPassagePane from '@/modules/practice-reading/components/ReadingPassagePane.vue'
import ReadingQuestionPane from '@/modules/practice-reading/components/ReadingQuestionPane.vue'
import ReadingReviewPanel from '@/modules/practice-reading/components/ReadingReviewPanel.vue'
import ReadingDictionaryBubble from '@/modules/practice-reading/components/ReadingDictionaryBubble.vue'
import SuitePassageNav from '@/modules/reading-unified/components/SuitePassageNav.vue'
import UnifiedExamHeader from '@/modules/reading-unified/components/UnifiedExamHeader.vue'
import UnifiedNotes from '@/modules/reading-unified/components/UnifiedNotes.vue'
import UnifiedOptionsPanel from '@/modules/reading-unified/components/UnifiedOptionsPanel.vue'
import UnifiedSelectionBar from '@/modules/reading-unified/components/UnifiedSelectionBar.vue'
import UnifiedPracticeNav from '@/modules/reading-unified/components/UnifiedPracticeNav.vue'
import { useMarkedQuestions } from '@/modules/reading-unified/composables/useMarkedQuestions.js'
import { useUnifiedDisplay } from '@/modules/reading-unified/composables/useUnifiedDisplay.js'
import { useUnifiedDivider } from '@/modules/reading-unified/composables/useUnifiedDivider.js'
import { useNativeAnswerControls } from '@/modules/reading-unified/composables/useNativeAnswerControls.js'
import { applyResultsToQuestionArea } from '@/modules/reading-unified/reviewMarks.js'
import { jiufen, isJiufenAsset } from '@/api/jiufen.js'
import { idictation, isIdictationMaterial, isIdictationReading } from '@/api/idictation.js'
import ReaderSentenceAnnotations from '../../../../plug/idictation/ReaderSentenceAnnotations.vue'
import { useReadingAsset } from '@/modules/practice-reading/useReadingAsset'
import { useReadingAnswers } from '@/modules/practice-reading/useReadingAnswers'
import { useReadingCoach } from '@/modules/practice-reading/useReadingCoach'
import { useReadingHighlights } from '@/modules/practice-reading/useReadingHighlights'
import { normalizeComparableText } from '@/modules/practice-reading/readingHighlightCore.js'
import { useReadingModeFlow } from '@/modules/practice-reading/useReadingModeFlow'
import { applyMemorizeLocatorHighlights, clearMemorizeLocatorHighlights } from '@/modules/practice-reading/memorizeLocators.js'
import { readSelectedContext } from '@/modules/practice-reading/selectionContext.js'
import { canSnapshotReadingAnswers, readingDraftOwnerMatches } from '@/modules/practice-reading/readingModeFlowCore.js'
import { useReadingTimer } from '@/modules/practice-reading/useReadingTimer'
import { useQuestionTimeline } from '@/modules/practice-reading/useQuestionTimeline'
import { useReadingAttempt } from '@/modules/practice-reading/useReadingAttempt'
import { useReadingUiPreferences } from '@/modules/practice-reading/useReadingUiPreferences'
import { useReadingInteractions } from '@/modules/practice-reading/useReadingInteractions'
import {
  escapeCss,
  normalizeQuestionId,
  resolveAnswerAliases as resolveAnswerAliasesFromIds
} from '@/modules/practice-reading/readingQuestionIds'
import { isTauriRuntime } from '@/api/tauri-bridge.js'
import { getOpenReadingDraft } from '@/api/reading-repository.js'
import {
  saveEndlessPassageDraft,
  saveSuitePassageDraft
} from '@/api/modes-repository.js'

const EXPLANATION_SPLIT_KINDS = new Set([
  'single_choice',
  'multi_choice',
  'true_false_not_given',
  'yes_no_not_given'
])
// Note highlights feed the Notes drawer, so they restore with plain highlights.
const RESTORED_ANNOTATION_KINDS = ['highlight', 'note']
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
  clearReadingAssetError,
  clearReadingAsset
} = useReadingAsset()
const materialMode = computed(() => {
  const current = String(props.assetId || route.params.assetId || '').trim()
  return isIdictationMaterial(current) || (asset.value?.id === current && payload.value?.practiceKind === 'material')
})
const idictationExam = computed(() => isIdictationReading(props.assetId || route.params.assetId))
const idictationPart = ref(1)
watch(() => props.assetId, () => { idictationPart.value = 1 })
const idictationSections = computed(() => idictationExam.value && payload.value
  ? [1, 2, 3].map(section => ({ section, questionIds: payload.value.questionGroups
    .filter(group => group.section === section).flatMap(group => group.questionIds) }))
  : null)
const visiblePassageBlocks = computed(() => {
  const blocks = payload.value?.passage?.blocks || []
  return idictationExam.value ? blocks.filter(block => block.blockId === `part-${idictationPart.value}`) : blocks
})
const visibleQuestionPayload = computed(() => idictationExam.value && payload.value
  ? { ...payload.value,
    questionOrder: idictationSections.value[idictationPart.value - 1].questionIds,
    questionGroups: payload.value.questionGroups.filter(group => group.section === idictationPart.value) }
  : payload.value)
async function openReadingPart(part) {
  if (!idictationExam.value) return openSuitePart(part)
  if (![1, 2, 3].includes(part)) return
  idictationPart.value = part
  await nextTick()
  syncDomAnswers()
  setReadOnlyDomControls(readOnlyMode.value)
}
const pageAlive = ref(true)
const examReady = ref(false)
const timerEnabled = computed(() => pageAlive.value && examReady.value && !materialMode.value)
let assetLoadGeneration = 0
const submitting = ref(false)
const leaving = ref(false)
const submitError = ref('')
const snapshotMessage = ref('')
const submission = ref(null)
const attemptReviewComparison = ref(null)
const attemptReviewLoading = ref(false)
const attemptReviewStatus = ref('idle')
const attemptReviewError = ref('')
const attemptReviewContent = ref('')
const attemptReviewToolCalls = ref([])
const suiteSession = ref(null)
const interactionCount = ref(0)
const endlessCountdown = ref(0)
const endlessNextAssetId = ref('')
const readingCoachEnabled = ref(true)
const readingCoachSettingSaving = ref(false)
const readingCoachSettingError = ref('')
const noteDrawerOpen = ref(false)
const {
  shellRef,
  dividerRef,
  dragging: dividerDragging,
  valueNow: dividerValue,
  startDrag: startDividerDrag,
  handleKeydown: handleDividerKeydown
} = useUnifiedDivider()
const {
  rootClassList: displayClassList,
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
// Answer timeline, visits and marks: one shared tracker for every practice
// surface, so a submitted ledger row always carries real change/visit/elapsed
// numbers instead of zeros.
const {
  answerTimeline,
  markedQuestions,
  activeQuestionId,
  flushActiveQuestionVisit,
  recordQuestionVisit,
  recordAnswerTimeline,
  hydrateFromDraftAnswers,
  hydrateFromSubmission,
  reset: resetQuestionTimeline,
  buildQuestionTimelineLite,
  buildPersistedQuestionTimeline
} = useQuestionTimeline({
  payloadSource: () => payload.value,
  readOnlySource: () => readOnlyMode.value,
  getRawAnswer: (questionId) => getRawAnswer(questionId),
  getDisplayLabel: (questionId) => getDisplayLabel(questionId),
  onInteraction: () => recordInteraction()
})

const { isMarkedQuestion, toggleMarkedQuestion } = useMarkedQuestions({
  markedQuestions,
  normalizeId: normalizeQuestionId,
  isReadOnly: () => readOnlyMode.value,
  onUserChange: () => scheduleDraftAutosave()
})
const readingPassagePane = ref(null)
const readerState = computed(() => materialMode.value ? payload.value?.readerState : null)
const readerProgressBusy = ref('')
const readerProgressError = ref('')
const readerProgressMessage = ref('')
const readerBookmarks = computed(() => materialMode.value && Array.isArray(payload.value?.readerBookmarks)
  ? payload.value.readerBookmarks : null)
const readerAnnotations = computed(() => materialMode.value ? payload.value?.readerAnnotations : null)
const readerHighlights = computed(() => Object.entries(readerAnnotations.value || {})
  .filter(([, rows]) => rows.some(row => row.kind === 'highlight')).map(([id]) => id))
const readerBookmarkBusy = ref('')
const readerBookmarkError = ref(null)
const materialError = ref('')
const reviewLoadError = ref('')
const localRecord = ref(null)
const localRecordLoading = ref(false)
const reviewLoading = ref(false)
const locatedSentences = ref([])

function saveReaderPosition() {
  const position = readingPassagePane.value?.readingPosition()
  if (position) void updateReaderProgress({ kind: 'save', ...position })
}

async function updateReaderProgress(action) {
  if (!readerState.value || readerProgressBusy.value || !asset.value?.id) return
  const current = payload.value
  readerProgressBusy.value = action.kind
  readerProgressError.value = ''
  readerProgressMessage.value = ''
  try {
    const state = await idictation.readerProgress(asset.value.id, action)
    if (payload.value === current) {
      current.readerState = state
      readerProgressMessage.value = action.kind === 'save' ? '阅读位置已保存' : '已标记读完'
    }
  } catch (error) {
    if (payload.value === current) readerProgressError.value = error?.message || String(error)
  } finally {
    readerProgressBusy.value = ''
  }
}

async function toggleReaderBookmark(id) {
  if (readerBookmarkBusy.value || !readerBookmarks.value || !asset.value?.id) return
  const current = payload.value
  const desired = !readerBookmarks.value.includes(id)
  readerBookmarkBusy.value = id
  readerBookmarkError.value = null
  try {
    const collected = await idictation.readerBookmark(asset.value.id, id, desired)
    if (payload.value === current) {
      current.readerBookmarks = current.readerBookmarks.filter(bookmark => bookmark !== id)
      if (collected) current.readerBookmarks.push(id)
    }
  } catch (error) {
    if (payload.value === current) readerBookmarkError.value = { id, message: error?.message || String(error) }
  } finally {
    readerBookmarkBusy.value = ''
  }
}

async function loadStudyMaterial() {
  const id = asset.value?.id
  if (!isJiufenAsset(id) || !reviewMode.value) return
  materialError.value = ''
  try {
    const attempt = submission.value?.attemptId || submission.value?.sessionId || props.sessionId || tauriAttemptId
    const material = await jiufen.studyMaterial(id, 'reading', attempt)
    if (asset.value?.id === id) payload.value.studyMaterial = material
  } catch (failure) {
    if (asset.value?.id === id) materialError.value = failure?.message || String(failure)
  }
}

async function locateAnswer(questionId) {
  locatedSentences.value = payload.value?.studyMaterial?.questions?.[questionId]?.sentenceIds || []
  await nextTick()
  const target = [...document.querySelectorAll('#left [data-study-sentence]')]
    .find(node => locatedSentences.value.includes(node.dataset.studySentence))
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } else {
    const translated = [...document.querySelectorAll('#left [data-translated-sentence]')]
      .find(node => locatedSentences.value.includes(node.dataset.translatedSentence))
    if (translated) {
      translated.closest('details').open = true
      translated.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
}

const readingAttempt = useReadingAttempt()
let tauriAttemptId = ''
let nativeControls = null
const draftQueue = useDraftSaveQueue(writeTauriDraft)
const { error: draftError, saving: draftSaving } = draftQueue
useDraftLeaveGuard(async () => {
  if (!canWriteDraft()) return
  if (submitting.value) return false
  if (activeSuiteSessionId.value || isEndlessMode.value) return draftQueue.flush()
  const wasRunning = timerRunning.value
  stopPracticeTimer()
  const saved = await (tauriAttemptId ? draftQueue.save() : draftQueue.flush())
  if (!saved && wasRunning) startPracticeTimer()
  return saved
}, (to, from) => to.path !== from.path ||
  ['mode', 'practiceMode', 'suiteSessionId'].some(key => to.query[key] !== from.query[key]))
let snapshotMessageTimer = null

const {
  settingsPanelOpen,
  notesPanelOpen,
  settingsPanel,
  notesPanel,
  notesTextarea,
  notesText,
  notesError,
  suiteAutoAdvance,
  initializeReadingPreferences,
  toggleSettingsPanel,
  toggleNotesPanel,
  handleSettingsDialogKeydown,
  handleNotesDialogKeydown,
  closeFloatingPanels,
  setSuiteAutoAdvance,
  loadReadingNotes,
  clearReadingNotesDraft
} = useReadingUiPreferences({
  assetSource: () => asset.value,
  persistenceEnabled: () => pageAlive.value && examReady.value && !materialMode.value
})

const activeSuiteSessionId = computed(() => {
  if (materialMode.value || idictationExam.value) return ''
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
const activeEndlessSessionId = computed(() => {
  if (materialMode.value || idictationExam.value) return ''
  return String(readRouteQueryValue('endlessSessionId') || '').trim()
})

function normalizePracticeModeQueryValue(value) {
  return String(value || '').trim().toLowerCase()
}

function shouldNormalizeLegacyMemorizeQuery() {
  return !materialMode.value && !String(props.sessionId || route.params.sessionId || '').trim()
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
  if (materialMode.value || idictationExam.value) return false
  const mode = normalizePracticeModeQueryValue(readRouteQueryValue('mode'))
  return mode === 'endless' && !activeSuiteSessionId.value
})
const isMemorizeMode = computed(() => {
  if (materialMode.value || idictationExam.value) return false
  const mode = normalizePracticeModeQueryValue(readRouteQueryValue('mode'))
  const practiceMode = normalizePracticeModeQueryValue(readRouteQueryValue('practiceMode'))
  return (mode === 'memorize' || practiceMode === 'memorize') && !props.sessionId
})
const activeMemorizeAttemptId = ref(String(readRouteQueryValue('memorizeAttemptId') || '').trim())
const headerSummary = computed(() => {
  if (materialMode.value) return '爱听写精读 · 原文与逐句翻译'
  if (!payload.value) return '正在准备阅读练习…'
  const category = payload.value.meta?.category || asset.value?.category || '阅读'
  const questionCount = Number(payload.value.questionCount ?? payload.value.questionOrder?.length) || 0
  const mode = activeSuiteSessionId.value
    ? '套题练习'
    : (isEndlessMode.value ? '无尽练习' : (isMemorizeMode.value ? '背题模式' : '单篇练习'))
  return `${category} · ${questionCount} 题 · ${mode}`
})
const returnRoute = computed(() => (
  activeSuiteSessionId.value
    ? { name: 'PracticeReadingSuite', params: { sessionId: activeSuiteSessionId.value } }
    : { name: 'PracticeLibrary' }
))
const returnLabel = computed(() => (activeSuiteSessionId.value ? '返回套题进度' : '返回练习库'))
const replaySessionId = computed(() => String(props.sessionId || route.params.sessionId || '').trim())
const reviewMode = computed(() => Boolean(replaySessionId.value || submission.value))
watch(submission, ready => { if (ready) void loadStudyMaterial() })
const readOnlyMode = computed(() => materialMode.value || reviewMode.value || isMemorizeMode.value)
const {
  answeredCount,
  initializeAnswers: initializeReadingAnswers,
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
  onTrack: recordAnswerTimeline,
  onSyncNative: syncNativeControl,
  onMutate: (_questionId, _value, metadata) => {
    clearSnapshotMessage()
    submitError.value = ''
    // User edits (typed, ticked or dropped) autosave; hydration is untracked.
    if (metadata.changed && metadata.options.track) scheduleDraftAutosave()
  }
})
const {
  getInteraction,
  getDisplayLabel,
  isDragDropControl,
  dragInteractionStatus,
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
  assignAnswer,
  recordQuestionVisit: (questionId) => recordQuestionVisit(questionId)
})
nativeControls = useNativeAnswerControls({
  payloadSource: () => payload.value,
  readOnlySource: () => readOnlyMode.value,
  getInteraction,
  getRawAnswer,
  getAnswerEntries,
  setAnswer,
  isDragDropControl,
  syncDropzoneControl,
  onAnswerInput: (questionIds) => {
    questionIds.forEach((questionId) => recordQuestionVisit(questionId))
  }
})
// Entering review marks options/dropzones; leaving it (reset) clears them.
watch(
  () => [submission.value?.answerComparison || null, payload.value, idictationPart.value],
  async ([comparison]) => {
    await nextTick()
    applyResultsToQuestionArea(
      reviewMode.value ? comparison : null,
      payload.value?.questionDisplayMap || null,
      nativeControls.resolveNativeQuestionIds
    )
  },
  { flush: 'post' }
)
const {
  timerRunning,
  suiteTimerState,
  formattedTimer,
  applySuiteTimerState,
  applyPracticeTimerState,
  getPracticeTimerSnapshot,
  resolvePracticeTiming,
  startPracticeTimer,
  stopPracticeTimer,
  toggleTimer: togglePracticeTimer,
  resetPracticeTimerClock,
  setPracticeTimerElapsedSeconds
} = useReadingTimer({
  enabled: timerEnabled,
  activeSuiteSessionId,
  reviewMode,
  suiteTimerSource: () => suiteSession.value?.timer,
  onAutoSubmit: () => submitAnswers()
})
const {
  coachQuery,
  coachLoading,
  coachError,
  coachResponse,
  coachRemembered,
  selectedContext,
  readingCoachOpen,
  llmReviewStatus,
  llmReviewMessage,
  canAskCoach,
  coachStatusText,
  coachTranscript,
  coachFollowUps,
  coachFeedback,
  coachAdjustments,
  coachMemoryCards,
  coachReaskableId,
  coachNotice,
  coachHistoryFailed,
  coachRetryKind,
  retryCoachQuery,
  reloadCoachHistory,
  resetReadingCoachState,
  setReadingCoachOpen,
  hydrateReadingCoachFromSubmission,
  toggleReadingCoachPanel,
  refreshSelectedContext,
  clearSelectedContext,
  askCoach,
  askCoachFollowUp,
  reaskCoachMessage,
  submitCoachFeedback,
  confirmCoachMemoryCard,
  dismissCoachMemoryCard,
  runCoachQuickAction,
  runCoachSelectionAction,
  runAutomaticReviewCoach,
  forgetRememberedPreference
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
  readCoachEnabled: () => readingCoachEnabled.value && !materialMode.value,
  readSelectedContext: () => readSelectedContext(getDisplayLabel),
  readActiveQuestionId: () => activeQuestionId.value,
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
// Same gate as the coach panel/FAB: a submitted attempt with the coach enabled.
const canAskCoachFromSelection = computed(() => Boolean(submission.value) && readingCoachEnabled.value)
const {
  selectionToolbarVisible,
  selectionToolbarStyle,
  selectionHasMark,
  keepSelectionToolbar,
  highlightSnapshot,
  highlightRestoreWarning,
  dictionaryBubble,
  normalizeHighlightSnapshot: normalizeHighlightSnapshotState,
  resetHighlightUiState: resetHighlightUiStateFromComposable,
  snapshotHighlights,
  restoreHighlightsFromRecords,
  applySelectionHighlight,
  applySelectionNote,
  removeSelectionHighlight,
  saveDictionaryBubbleWord,
  closeDictionaryBubble,
  attachHighlightDocumentListeners,
  detachHighlightDocumentListeners,
  hydrateHighlightsFromStore,
  getTextNodes
} = useReadingHighlights({
  assetIdSource: () => asset.value?.id || props.assetId,
  reviewModeSource: () => reviewMode.value || materialMode.value,
  getAttemptId: () => tauriAttemptId,
  ensureAttemptId: () => {
    if (materialMode.value || !examReady.value) return ''
    if (!tauriAttemptId) {
      tauriAttemptId = readingAttempt.newAttemptId()
    }
    return tauriAttemptId
  },
  onAttemptEnsured: () => {
    if (canWriteDraft()) void draftQueue.save()
  },
  onInteraction: () => recordInteraction(),
  notesText,
  toggleNotesPanel,
  contextMenuEnabledSource: () => canAskCoachFromSelection.value
})

// Capture the selection first: it is lost once focus moves to the coach panel.
function askCoachFromSelection() {
  if (!canAskCoachFromSelection.value) return
  const captured = readSelectedContext(getDisplayLabel)
  if (!captured?.text) return
  setReadingCoachOpen(true)
  void runCoachSelectionAction('explain_selection', captured, 'selection_bar')
}
const canSubmit = computed(() => Boolean(
  asset.value
  && payload.value
  && !loading.value
  && !submitting.value
  && !leaving.value
  && !readOnlyMode.value
  && examReady.value
))
const canSnapshot = computed(() => canSnapshotReadingAnswers({
  isTauriRuntime: isTauriRuntime(),
  hasAsset: Boolean(asset.value?.id),
  hasPayload: Boolean(payload.value),
  loading: loading.value,
  submitting: submitting.value,
  leaving: leaving.value,
  readOnly: readOnlyMode.value,
  isEndlessMode: isEndlessMode.value
}))
const canRecycleSubmittedAttempt = computed(() => Boolean(
  reviewMode.value
  && !idictationExam.value
  && !activeSuiteSessionId.value
  && !isEndlessMode.value
  && !String(props.sessionId || route.params.sessionId || '').trim()
  && !submitting.value
))
const readingPageClassList = computed(() => ({
  ...displayClassList.value,
  'reading-memorize-mode': isMemorizeMode.value,
  'reading-pane-resizing': dividerDragging.value,
  'exam-mode': !readOnlyMode.value,
  'material-mode': materialMode.value
}))
// Suite runs map passage n to Part n; single practice follows the category.
const navCategory = computed(() => (
  activeSuiteSessionId.value && currentSuitePassageIndex.value >= 0
    ? `P${currentSuitePassageIndex.value + 1}`
    : String(payload.value?.meta?.category || asset.value?.category || 'P1')
))
const partIndex = computed(() => {
  const match = navCategory.value.toUpperCase().match(/P([123])/)
  return match ? Number(match[1]) : 1
})
const subHeaderInstruction = computed(() => {
  const order = Array.isArray(payload.value?.questionOrder) ? payload.value.questionOrder : []
  const labels = order
    .map((questionId) => Number(String(getDisplayLabel(questionId)).match(/\d+/)?.[0]))
    .filter((value) => Number.isFinite(value))
  if (!labels.length) return ''
  const first = Math.min(...labels)
  const last = Math.max(...labels)
  return first === last
    ? `Read the text and answer question ${first}.`
    : `Read the text and answer questions ${first}-${last}.`
})
const noteEntries = computed(() => (
  (highlightSnapshot.value || []).filter((entry) => entry.kind === 'note')
))
const primaryButtonLabel = computed(() => {
  if (submitting.value) return '提交中…'
  if (isMemorizeMode.value) return '退出背题'
  if (reviewMode.value) return '已提交'
  return '提交作答'
})
const primaryButtonDisabled = computed(() => {
  if (isMemorizeMode.value) return leaving.value
  return !canSubmit.value
})
const resetButtonDisabled = computed(() => {
  if (isMemorizeMode.value) return leaving.value
  if (reviewMode.value) return !canRecycleSubmittedAttempt.value || leaving.value
  return submitting.value || leaving.value
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
          label: String(note?.label || `第 ${index + 1} 段`).trim(),
          text: String(note?.text || '').trim()
        }))
        .filter((note) => note.text)
    : []
})
const officialQuestionExplanationSections = computed(() => {
  const sections = officialReviewExplanations.value?.questionExplanations
  const normalized = Array.isArray(sections)
    ? sections
        .map((section, index) => normalizeOfficialQuestionExplanationSection(section, index))
        .filter(Boolean)
    : []
  if (!reviewMode.value) return normalized
  const existing = new Set(normalized.flatMap(section => section.items.map(item => item.questionId)))
  const recovered = Object.entries(payload.value?.studyMaterial?.questions || {})
    .filter(([id, item]) => !existing.has(id) && item.analyses?.length)
    .map(([questionId, item]) => ({
      questionId,
      questionNumber: getQuestionOfficialNumber(questionId),
      text: item.analyses.map(analysis => analysis.text).join('\n')
    }))
  if (recovered.length) {
    const official = normalized.find(section => section.sectionTitle === '官方解析')
    if (official) official.items.push(...recovered)
    else normalized.push({ sectionTitle: '官方解析', items: recovered, text: '', mode: '' })
  }
  return normalized
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
const canNavigateSuiteReviewPrev = computed(() => findSuiteReviewNavigationTarget('prev') !== null)
const canNavigateSuiteReviewNext = computed(() => findSuiteReviewNavigationTarget('next') !== null)
// The other two parts of the bottom nav show suite passages; a submitted one
// opens its review while this passage is itself in review.
const suitePartSummaries = computed(() => {
  if (!activeSuiteSessionId.value || !suiteSequence.value.length) return null
  const summaries = {}
  suiteSequence.value.forEach((entry, index) => {
    const sessionId = String(entry?.sessionId || entry?.attemptId || '').trim()
    const total = Number(entry?.scoreInfo?.totalQuestions) || null
    summaries[`p${index + 1}`] = {
      answeredCount: entry?.status === 'submitted' ? (total ?? 0) : 0,
      total: total ?? undefined,
      link: reviewMode.value && entry?.status === 'submitted' && sessionId
        ? { assetId: entry.assetId, sessionId }
        : null
    }
  })
  return summaries
})
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
          const questionLabel = `第 ${rawQuestionNumber || index + 1} 题`
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

function clearSnapshotMessage() {
  snapshotMessage.value = ''
  if (snapshotMessageTimer) {
    clearTimeout(snapshotMessageTimer)
    snapshotMessageTimer = null
  }
}

function showSnapshotMessage(message, durationMs = 4200) {
  clearSnapshotMessage()
  snapshotMessage.value = message
  snapshotMessageTimer = setTimeout(() => {
    snapshotMessage.value = ''
    snapshotMessageTimer = null
  }, durationMs)
}

function resetAttemptReviewState() {
  attemptReviewComparison.value = null
  attemptReviewLoading.value = false
  attemptReviewStatus.value = 'idle'
  attemptReviewError.value = ''
  attemptReviewContent.value = ''
  attemptReviewToolCalls.value = []
}

async function loadAttemptReviewComparison() {
  if (!featureFlags.readingAttemptReviewV1 || !submission.value?.attemptId || !asset.value?.id) {
    resetAttemptReviewState()
    return
  }
  attemptReviewLoading.value = true
  attemptReviewError.value = ''
  try {
    attemptReviewComparison.value = await learningRepository.compareAttemptsForAsset({
      assetId: asset.value.id,
      limit: 5,
      minimumGapHours: 12
    })
    attemptReviewStatus.value = 'idle'
  } catch (error) {
    attemptReviewComparison.value = null
    attemptReviewStatus.value = 'error'
    attemptReviewError.value = error?.message || '历次练习数据暂时不可用。'
  } finally {
    attemptReviewLoading.value = false
  }
}

async function runAttemptReview() {
  const attemptId = String(submission.value?.attemptId || '').trim()
  if (!featureFlags.readingAttemptReviewV1 || !attemptId || attemptReviewStatus.value === 'loading') return
  attemptReviewStatus.value = 'loading'
  attemptReviewError.value = ''
  attemptReviewContent.value = ''
  attemptReviewToolCalls.value = []
  try {
    const outcome = await learningRepository.runAttemptReview({ attemptId })
    attemptReviewContent.value = String(outcome?.content || '').trim()
    if (outcome?.runId) {
      const record = await learningRepository.getAgentRun(outcome.runId)
      attemptReviewToolCalls.value = Array.isArray(record?.toolCalls) ? record.toolCalls : []
    }
    attemptReviewStatus.value = 'success'
  } catch (error) {
    attemptReviewStatus.value = 'error'
    attemptReviewError.value = error?.message || 'AI 对比解读暂时不可用。'
  }
}

onMounted(async () => {
  await initializeReadingPreferences()
  if (!pageAlive.value) return
  await initializeDisplayPreferences()
  if (!pageAlive.value) return
  await loadReadingCoachPreference()
  if (!pageAlive.value) return
  await loadAsset()
})

onBeforeUnmount(() => {
  pageAlive.value = false
  assetLoadGeneration++
  // Leaving the page closes the coach stream; a late reply must not land in a
  // transcript nobody is looking at.
  resetReadingCoachState()
  flushActiveQuestionVisit()
  stopPracticeTimer()
  draftQueue.reset()
  clearEndlessTimer()
  if (isMemorizeMode.value) void finishActiveMemorizeSession()
  clearSnapshotMessage()
  detachHighlightDocumentListeners()
  clearReadingAsset()
})

onUpdated(() => {
  if (!asset.value?.id || !payload.value?.questionOrder?.length) {
    return
  }
  syncDomAnswers()
  if (readOnlyMode.value) {
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
    readOnly: readOnlyMode.value
  }),
  async ({ assetId, questionCount }) => {
    if (!assetId || !questionCount) {
      return
    }
    await nextTick()
    syncDomAnswers()
    if (readOnlyMode.value) {
      setReadOnlyDomControls(true)
    }
  },
  { flush: 'post' }
)

async function loadAsset() {
  if (!pageAlive.value) return
  const generation = ++assetLoadGeneration
  const isCurrent = () => pageAlive.value && generation === assetLoadGeneration
  examReady.value = false
  detachHighlightDocumentListeners()
  draftQueue.reset()
  tauriAttemptId = ''
  const normalizedAssetId = String(props.assetId || route.params.assetId || '').trim()
  const replaySessionId = String(props.sessionId || route.params.sessionId || '').trim()
  if (localRecord.value?.assetId !== normalizedAssetId
    || (replaySessionId && localRecord.value?.id !== replaySessionId)) localRecord.value = null
  if (!normalizedAssetId) {
    error.value = '缺少阅读资源编号'
    return
  }
  if (normalizeLegacyMemorizeQuery()) {
    return
  }

  clearReadingAssetError()
  submitError.value = ''
  clearSnapshotMessage()
  submission.value = null
  materialError.value = ''
  reviewLoadError.value = ''
  reviewLoading.value = false
  locatedSentences.value = []
  readerProgressError.value = ''
  readerProgressMessage.value = ''
  resetAttemptReviewState()
  suiteSession.value = null
  resetAttemptMetadata()
  resetReadingCoachState()
  closeFloatingPanels()
  resetHighlightUiStateFromComposable()
  clearReadingNotesDraft()
  clearEndlessTimer()
  resetPracticeTimerClock()
  endlessNextAssetId.value = ''
  let restoredTimer = null
  localRecordLoading.value = isJiufenAsset(normalizedAssetId) && Boolean(replaySessionId || route.query.resume === '1')
  try {
    let savedDraft = null
    let savedDetail = null
    if (isJiufenAsset(normalizedAssetId)) {
      if (replaySessionId) {
        savedDetail = await loadLocalCompletedDetail('reading', normalizedAssetId, replaySessionId).catch(failure => {
          if (isCurrent()) localRecord.value = null
          throw failure
        })
        if (!isCurrent()) return
        localRecord.value = savedDetail.attempt
      } else if (route.query.resume === '1') {
        savedDraft = await getOpenReadingDraft(normalizedAssetId)
        if (!isCurrent()) return
        localRecord.value = savedDraft.attempt
        if (!localRecord.value) throw new Error('这份草稿已不存在，请返回题库。')
      }
    }
    localRecordLoading.value = false
    const data = await loadReadingAsset(normalizedAssetId)
    if (!isCurrent() || !data) return
    if (materialMode.value) {
      initializeReadingAnswers(data.payload)
      await nextTick()
      if (!isCurrent()) return
      const sentenceId = route.query.sentenceId
      if (typeof sentenceId === 'string' && /^idictation-reader-\d+-v\d+-s\d+$/.test(sentenceId)) {
        const node = [...document.querySelectorAll('#left [data-study-sentence]')]
          .find(node => node.dataset.studySentence === sentenceId)
        if (node) {
          locatedSentences.value = [sentenceId]
          node.scrollIntoView({ block: 'center' })
          return
        }
      }
      readingPassagePane.value?.restoreReadingPosition(readerState.value?.position)
      return
    }
    examReady.value = true
    attachHighlightDocumentListeners()
    if (isEndlessMode.value && !(await reconcileEndlessRoute(isCurrent))) {
      return
    }
    if (!isCurrent()) return
    initializeReadingAnswers(data?.payload, { prefillAnswerKey: isMemorizeMode.value })
    loadReadingNotes()
    if (activeSuiteSessionId.value) {
      try {
        suiteSession.value = await practiceReadingSuite.get(activeSuiteSessionId.value)
        if (!isCurrent()) return
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
      await loadSubmittedSession(replaySessionId, isCurrent, savedDetail)
    } else if (isTauriRuntime() && !isMemorizeMode.value) {
      restoredTimer = await hydrateOpenDraft(
        normalizedAssetId,
        activeSuiteSessionId.value || null,
        activeEndlessSessionId.value || null,
        isCurrent,
        savedDraft
      )
    }
  } catch (loadError) {
    if (!isCurrent()) return
    console.error('加载阅读资源失败:', loadError)
    const message = loadError?.message || String(loadError)
    error.value = localRecord.value ? `九分题面暂不可用，已保留本地作答：${message}` : message
  } finally {
    if (isCurrent()) localRecordLoading.value = false
  }
  if (isCurrent() && examReady.value && !materialMode.value && asset.value && payload.value) {
    await ensureMemorizeSession(isCurrent)
    if (!isCurrent()) return
    await nextTick()
    if (!isCurrent()) return
    syncDomAnswers()
    if (isTauriRuntime()) {
      const attemptScope = tauriAttemptId || replaySessionId || null
      const passageDocument = getTextNodes(readingPassagePane.value?.$el).map(node => node.textContent || '').join('').trim()
      await hydrateHighlightsFromStore(asset.value.id, attemptScope, passageDocument || null, RESTORED_ANNOTATION_KINDS)
      if (!isCurrent()) return
    }
    restoreHighlightsFromRecords(highlightSnapshot.value)
    applyMemorizeStudyLayer()
    if (readOnlyMode.value) {
      setPracticeTimerElapsedSeconds(Math.max(0, Number(submission.value?.duration || 0)))
      setReadOnlyDomControls(true)
    } else if (restoredTimer?.running !== false) {
      // A draft paused by the student reopens paused.
      startPracticeTimer()
    }
  }
}

watch(
  () => [submission.value?.attemptId || '', asset.value?.id || ''],
  ([attemptId, assetId], previous) => {
    if (attemptId && assetId && (attemptId !== previous?.[0] || assetId !== previous?.[1])) {
      void loadAttemptReviewComparison()
    }
  },
  { flush: 'post' }
)

async function loadSubmittedSession(sessionId, isCurrent = () => true, savedDetail = null) {
  const loadedSubmission = savedDetail
    ? mapHistoryDetailToSubmission(savedDetail)
    : (await practiceSessions.getState('reading', sessionId))?.submission
  if (!isCurrent() || materialMode.value) return
  if (!loadedSubmission) {
    throw new Error('未找到可回放的阅读提交记录')
  }
  const expectedAssetId = String(asset.value?.id || '').trim()
  const actualAssetId = String(loadedSubmission.assetId || loadedSubmission.examId || '').trim()
  if (expectedAssetId && actualAssetId && expectedAssetId !== actualAssetId) {
    throw new Error('阅读回放记录与当前题目不匹配')
  }
  submission.value = loadedSubmission
  // Field contraction: store may omit correctAnswer; fill from asset answerKey for review UI.
  fillCorrectAnswersFromPayload(loadedSubmission)
  const attemptScope = String(loadedSubmission.sessionId || loadedSubmission.attemptId || sessionId || '').trim()
  if (isTauriRuntime() && asset.value?.id) {
    const persisted = await hydrateHighlightsFromStore(asset.value.id, attemptScope || null, null, RESTORED_ANNOTATION_KINDS)
    if (!isCurrent() || materialMode.value) return
    if (!persisted.length) {
      highlightSnapshot.value = normalizeHighlightSnapshotState(
        loadedSubmission.highlights || loadedSubmission.analysisArtifacts?.highlights || []
      )
    }
  } else {
    highlightSnapshot.value = normalizeHighlightSnapshotState(
      loadedSubmission.highlights || loadedSubmission.analysisArtifacts?.highlights || []
    )
  }
  hydrateReadingCoachFromSubmission(loadedSubmission, {
    open: false,
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
  if (!isCurrent() || materialMode.value) return
  syncDomAnswers()
  setReadOnlyDomControls(true)
  restoreHighlightsFromRecords(highlightSnapshot.value)
  restoreSubmittedViewport(loadedSubmission)
  await loadProviderReview(sessionId, isCurrent)
}

async function loadProviderReview(sessionId, isCurrent) {
  const currentPayload = payload.value
  const currentSubmission = submission.value
  const assetId = asset.value?.id
  const fetch = isJiufenAsset(assetId) ? jiufen.review : isIdictationReading(assetId) ? idictation.readingReview : null
  if (!fetch) return
  const active = () => isCurrent() && payload.value === currentPayload && submission.value === currentSubmission
  reviewLoading.value = true
  reviewLoadError.value = ''
  try {
    const review = await fetch(assetId, sessionId)
    if (!active()) return
    Object.assign(currentPayload, review)
    fillCorrectAnswersFromPayload(currentSubmission)
  } catch (failure) {
    if (active()) reviewLoadError.value = `官方复盘材料暂未加载，本地成绩和作答已保留：${failure?.message || String(failure)}`
  } finally {
    if (active()) reviewLoading.value = false
  }
}

function retryProviderReview() {
  if (reviewLoading.value || !submission.value) return
  const generation = assetLoadGeneration
  const sessionId = replaySessionId.value || submission.value.attemptId || submission.value.sessionId
  return loadProviderReview(sessionId, () => pageAlive.value && generation === assetLoadGeneration)
}

async function hydrateOpenDraft(assetId, suiteId = null, endlessSessionId = null, isCurrent = () => true, savedDraft = null) {
  try {
    const scope = { suiteId, endlessSessionId }
    const { attempt, timer } = savedDraft || await getOpenReadingDraft(
      assetId,
      String(suiteId || '').trim() || null,
      String(endlessSessionId || '').trim() || null
    )
    if (!isCurrent() || materialMode.value) return
    if (!attempt?.id) return
    if (!readingDraftOwnerMatches(attempt, scope)) {
      console.warn('忽略不属于当前阅读范围的草稿', {
        attemptId: attempt.id,
        scope,
        draftOwnerId: attempt.suiteId || attempt.suite_id || null
      })
      return
    }
    tauriAttemptId = String(attempt.id)
    if (timer) applyPracticeTimerState(timer)
    const answers = {}
    for (const entry of attempt.answers || []) {
      const questionId = String(entry.questionId || entry.question_id || '').trim()
      if (!questionId) continue
      if (entry.answer != null) answers[questionId] = entry.answer
    }
    hydrateFromDraftAnswers(attempt.answers)
    Object.entries(answers).forEach(([questionId, value]) => {
      assignAnswer(questionId, value)
    })
    showSnapshotMessage('已恢复未提交草稿。')
    return timer
  } catch (draftError) {
    console.warn('加载阅读草稿失败:', draftError)
  }
}

function fillCorrectAnswersFromPayload(loadedSubmission) {
  const comparison = loadedSubmission?.answerComparison
  const answerKey = payload.value?.answerKey || payload.value?.answers || null
  if (!comparison || typeof comparison !== 'object' || !answerKey || typeof answerKey !== 'object') {
    return
  }
  Object.keys(comparison).forEach((questionId) => {
    const row = comparison[questionId]
    if (!row || row.correctAnswer != null) return
    if (Object.prototype.hasOwnProperty.call(answerKey, questionId)) {
      row.correctAnswer = answerKey[questionId]
    }
  })
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
  resetQuestionTimeline()
  interactionCount.value = 0
}

function getCurrentScrollY() {
  if (typeof window === 'undefined') return 0
  const numeric = Number(window.scrollY)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0
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

function restoreSubmittedMetadata(loadedSubmission) {
  hydrateFromSubmission(loadedSubmission)
}

function resetAnswers() {
  if (readOnlyMode.value) {
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
  if (tauriAttemptId && canWriteDraft()) void draftQueue.save()
  showSnapshotMessage('已清空本页作答。')
}

async function recycleSubmittedAttempt() {
  if (!canRecycleSubmittedAttempt.value) {
    return
  }
  tauriAttemptId = ''
  submission.value = null
  clearSubmissionSnapshot()
  resetReadingCoachState()
  submitError.value = ''
  clearSnapshotMessage()
  resetAttemptMetadata()
  initializeReadingAnswers(payload.value, { prefillAnswerKey: isMemorizeMode.value })
  resetHighlightUiStateFromComposable()
  await nextTick()
  restoreHighlightsFromRecords([])
  syncDomAnswers()
  setReadOnlyDomControls(false)
  resetPracticeTimerClock()
  startPracticeTimer()
  showSnapshotMessage('已重置本篇练习，可重新作答。')
}

async function snapshotAnswers() {
  if (!canSnapshot.value) return false
  // Durable truth is Tauri SQLite draft; no Web Storage dual-write.
  try {
    if (!await draftQueue.save()) return false
    showSnapshotMessage('作答快照已保存。')
    return true
  } catch (_) {
    showSnapshotMessage('作答快照保存失败，请重试。')
    return false
  }
}

// Wrappers: useReadingAnswers needs the sync hook before the controls exist.
function handleQuestionInput(event) { return nativeControls.handleQuestionInput(event) }
function syncDomAnswers() {
  nativeControls.syncDomAnswers()
  // Non-reusable pools grey out cards already placed in a dropzone.
  syncPoolConsumedState()
}
function syncNativeControl(questionId, explicitValue) {
  return nativeControls?.syncNativeControl(questionId, explicitValue)
}

function scheduleDraftAutosave() {
  if (canWriteDraft()) draftQueue.schedule()
}

function canWriteDraft() {
  return isTauriRuntime() && examReady.value && Boolean(asset.value?.id) && !readOnlyMode.value
}

async function writeTauriDraft() {
  if (!canWriteDraft()) return
  flushActiveQuestionVisit()
  if (activeSuiteSessionId.value) {
    const { result } = await saveSuitePassageDraft({
      suiteId: activeSuiteSessionId.value,
      assetId: asset.value.id,
      assetRevision: asset.value.schemaVersion ?? null,
      assetFingerprint: asset.value.fingerprint || null,
      answers: snapshotAnswerMap(),
      markedQuestions: markedQuestions.value.slice(),
      questionTimeline: buildPersistedQuestionTimeline(),
      titleSnapshot: asset.value.title || asset.value.name || null,
      timerSnapshot: getPracticeTimerSnapshot()
    })
    suiteSession.value = result?.suiteSession || suiteSession.value
    tauriAttemptId = String(result?.attempt?.id || tauriAttemptId || '')
    return
  }
  if (isEndlessMode.value && activeEndlessSessionId.value) {
    const { result } = await saveEndlessPassageDraft({
      sessionId: activeEndlessSessionId.value,
      assetId: asset.value.id,
      assetRevision: asset.value.schemaVersion ?? null,
      assetFingerprint: asset.value.fingerprint || null,
      answers: snapshotAnswerMap(),
      markedQuestions: markedQuestions.value.slice(),
      questionTimeline: buildPersistedQuestionTimeline(),
      titleSnapshot: asset.value.title || asset.value.name || null,
      timerSnapshot: getPracticeTimerSnapshot()
    })
    tauriAttemptId = String(result?.attempt?.id || tauriAttemptId || '')
    return
  }
  if (!tauriAttemptId) tauriAttemptId = readingAttempt.newAttemptId()
  await readingAttempt.persistDraft({
    attemptId: tauriAttemptId,
    assetId: asset.value.id,
    assetRevision: asset.value.schemaVersion ?? null,
    assetFingerprint: asset.value.fingerprint || null,
    answers: snapshotAnswerMap(),
    markedQuestions: markedQuestions.value.slice(),
    questionTimeline: buildPersistedQuestionTimeline(),
    titleSnapshot: asset.value.title || asset.value.name || null,
    timerSnapshot: getPracticeTimerSnapshot()
  })
}

function toggleTimer() {
  if (materialMode.value || !examReady.value) return
  togglePracticeTimer()
  if (canWriteDraft()) void draftQueue.save()
}

const modeFlow = useReadingModeFlow({
  flushDraft: draftQueue.flush,
  router,
  routeQuerySource: () => route.query,
  assetSource: () => asset.value,
  submission,
  suiteSession,
  submitting,
  leaving,
  submitError,
  snapshotMessage,
  endlessCountdown,
  endlessNextAssetId,
  activeMemorizeAttemptId,
  activeSuiteSessionId,
  activeEndlessSessionId,
  isEndlessMode,
  isMemorizeMode,
  reviewMode,
  canSubmit,
  canRecycleSubmittedAttempt,
  suiteAutoAdvance,
  suiteSequence,
  currentSuitePassageIndex,
  returnRoute,
  getAttemptId: () => tauriAttemptId,
  setAttemptId: (id) => { tauriAttemptId = id },
  newAttemptId: () => readingAttempt.newAttemptId(),
  submitSingleAttempt: async (input) => {
    const result = await readingAttempt.submit(input)
    if ((isJiufenAsset(input.assetId) || isIdictationReading(input.assetId)) && result.raw?.review) {
      Object.assign(payload.value, result.raw.review)
    }
    return result
  },
  snapshotAnswerMap,
  markedQuestions,
  interactionCount,
  snapshotHighlights,
  highlightSnapshot,
  buildQuestionTimelineLite,
  buildPersistedQuestionTimeline,
  getPracticeTimerSnapshot,
  resolvePracticeTiming,
  getCurrentScrollY,
  flushActiveQuestionVisit,
  stopPracticeTimer,
  startPracticeTimer,
  setPracticeTimerElapsedSeconds,
  assignAnswer,
  syncDomAnswers,
  setReadOnlyDomControls,
  restoreHighlightsFromRecords,
  setReadingCoachOpen,
  resetAnswers,
  recycleSubmittedAttempt
})

function submitAnswers() { return modeFlow.submitAnswers() }
function snapshotSubmission() { return modeFlow.snapshotSubmission() }
function clearSubmissionSnapshot() { return modeFlow.clearSubmissionSnapshot() }
function clearEndlessTimer() { return modeFlow.clearEndlessTimer() }
function findSuiteReviewNavigationTarget(direction) { return modeFlow.findSuiteReviewNavigationTarget(direction) }
function navigateSuiteReview(direction) { return modeFlow.navigateSuiteReview(direction) }
function goToNextEndlessAsset() { return modeFlow.goToNextEndlessAsset() }
function stopEndlessMode() { return modeFlow.stopEndlessMode() }
async function handleLeave() {
  if (materialMode.value) return router.push({ name: 'PracticeLibrary', query: { view: 'browse' } })
  return modeFlow.handleLeave()
}
function reconcileEndlessRoute(isCurrent) { return modeFlow.reconcileEndlessRoute(isCurrent) }
function handleResetButton() { return modeFlow.handleResetButton() }
function handlePrimaryButton() { return modeFlow.handlePrimaryButton() }
function ensureMemorizeSession(isCurrent) { return modeFlow.ensureMemorizeSession(isCurrent) }
function finishActiveMemorizeSession() { return modeFlow.finishActiveMemorizeSession() }

function openSuitePart(link) {
  if (!link?.assetId || !link?.sessionId) return
  router.push({
    name: 'PracticeReadingReview',
    params: { assetId: link.assetId, sessionId: link.sessionId },
    query: { suiteSessionId: activeSuiteSessionId.value }
  })
}

function openNoteEditor() {
  if (!notesPanelOpen.value) toggleNotesPanel()
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

function applyMemorizeStudyLayer() {
  clearMemorizeLocatorHighlights()
  if (!isMemorizeMode.value || !payload.value?.answerKey) {
    return
  }
  Object.entries(payload.value.answerKey).forEach(([questionId, answer]) => {
    const text = formatReviewAnswer(answer)
    if (text) {
      applyMemorizeLocatorHighlights(questionId, text, getTextNodes)
    }
  })
  setReadOnlyDomControls(true)
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

function getLegacyResultClass(questionId) {
  const entry = getReviewEntry(questionId)
  if (entry?.isCorrect === true) return 'result-correct'
  if (entry?.isCorrect === false) return 'result-incorrect'
  return ''
}

async function scrollToQuestion(questionId) {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return
  if (idictationExam.value) {
    const section = idictationSections.value?.find(part => part.questionIds.includes(normalized))
    if (section && section.section !== idictationPart.value) await openReadingPart(section.section)
  }
  // Review navigation changes the visible focus without adding practice telemetry.
  activeQuestionId.value = normalized
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

function recordInteraction() {
  if (!readOnlyMode.value) {
    interactionCount.value += 1
  }
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
  return resolveAnswerAliasesFromIds(questionId, payload.value?.questionDisplayMap || null)
}

function getGroupRange(group) {
  const ids = Array.isArray(group.questionIds) ? group.questionIds : []
  if (!ids.length) return '题目'
  const labels = ids.map((questionId) => getDisplayLabel(questionId)).filter(Boolean)
  if (labels.length <= 1) return `第 ${labels[0] || ''} 题`
  return `第 ${labels[0]}-${labels[labels.length - 1]} 题`
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

<style src="../modules/reading-unified/styles/unified.css"></style>
<style src="../modules/practice-reading/styles/host-extras.css"></style>
<style scoped>
/* Fixed full-viewport mount: the exam owns the window, escaping the SPA
   shell padding (the skin itself lays out header/sub-header/shell/nav). */
#runified-root {
  position: fixed;
  inset: 0;
  z-index: 3000;
}
</style>
