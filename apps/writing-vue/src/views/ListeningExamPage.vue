<template>
  <div
    class="runified listening-exam"
    :class="{ 'is-review': reviewMode, 'reading-pane-resizing': dragging }"
    data-listening-practice
    :data-review-mode="reviewMode ? 'true' : null"
  >
    <UnifiedExamHeader :title="pageTitle" :subtitle="headerMeta" :show-timer="false"
      :part-index="activeSection" :instruction="headerMeta">
      <template #heading><h1 class="listening-exam__title">{{ pageTitle }}</h1></template>
      <template #controls>
        <router-link class="listening-exam__back" :to="{ name: 'ListeningLibrary' }">返回听力题库</router-link>
      </template>
    </UnifiedExamHeader>

    <main class="listening-exam__workspace">
      <p v-if="loading" class="listening-practice__status" role="status" aria-live="polite">正在加载听力内容…</p>
      <section v-else-if="error" class="listening-state" role="alert">
        <h2 class="listening-state__title">无法打开这套听力</h2>
        <p class="listening-state__desc">{{ error }}</p>
        <button class="btn btn-primary" type="button" @click="initialize">重试</button>
      </section>
      <template v-else-if="payload">
        <ListeningAudioBar
          ref="audioBar"
          :audio-url="onlineAudio ? onlineAudio[activeSection] : audioUrl"
          :source-playback="sourcePlayback"
          :loading="audioLoading || (isPreview && previewPlayback.busy.value)"
          :error="audioError || (isPreview ? previewAudioError : '')" :duration-seconds="durationSeconds"
          @retry="loadPracticeAudio"
          @timeupdate="audioTime = $event"
          @playing-change="audioPlaying = $event"
        />
        <p v-if="isPreview" class="listening-practice__notice">
          {{ previewPartTracks ? '按 Part 播放，切换后可播放该 Part 的录音。' : '整卷播放，换 Part 不会重置音轨。' }}
          作答仅保留在本页。
        </p>
        <div v-if="reviewMode && review" class="listening-score" data-listening-score aria-label="听力成绩">
          <p class="listening-score__value">答对 <strong>{{ review.correctCount }}</strong><span>/ {{ review.questionCount }}</span></p>
          <p class="listening-score__percent">{{ review.percentage }}%</p>
          <p v-if="review.durationMs" class="listening-score__time">用时 {{ formatDurationMs(review.durationMs) }}</p>
          <p v-if="replayNotice" class="listening-score__note">{{ replayNotice }}</p>
        </div>
        <p v-if="reviewLoading" class="listening-practice__status" role="status">正在加载复盘记录…</p>
        <section v-else-if="reviewMode && !review" class="listening-state" role="alert">
          <p>{{ reviewError || '这条听力记录不存在或已被删除。' }}</p>
          <button type="button" @click="loadReview">重试</button>
        </section>
        <div v-else ref="shellRef" class="listening-exam__content" :class="{ shell: reviewMode }">
          <section v-if="reviewMode" id="left" class="listening-exam__pane listening-transcript" data-study-transcript aria-labelledby="listening-transcript-heading">
            <header class="listening-exam__pane-header">
              <h2 id="listening-transcript-heading">听力原文</h2>
              <label v-if="hasTranslation" class="listening-transcript__toggle"><input v-model="showTranslation" type="checkbox"> 逐句翻译</label>
            </header>
            <div class="listening-exam__pane-body" tabindex="0" aria-label="听力原文与逐句翻译">
              <p v-if="materialError" class="listening-practice__error" role="alert">{{ materialError }} <button type="button" @click="loadStudyMaterial">重试</button></p>
              <p v-else-if="materialLoading" class="listening-practice__status" role="status">正在加载原文…</p>
              <p v-else-if="!activeMaterial?.paragraphs?.length" class="listening-practice__status">本节暂无原文。</p>
              <template v-else>
                <div v-for="(paragraph, index) in activeMaterial.paragraphs" :key="paragraph.id" class="listening-transcript__paragraph">
                  <p v-if="paragraph.speaker && paragraph.speaker !== activeMaterial.paragraphs[index - 1]?.speaker" class="listening-transcript__speaker">{{ paragraph.speaker }}</p>
                  <div v-for="sentence in paragraph.sentences" :key="sentence.id" :data-study-sentence="sentence.id"
                    class="listening-transcript__sentence" :class="{ 'is-located': locatedSentences.includes(sentence.id), 'is-playing': isPlaying(sentence) }">
                    <button v-if="sentence.startSeconds != null && sentence.endSeconds != null" type="button"
                      class="listening-transcript__play" :data-play-sentence="sentence.id"
                      :aria-label="`播放本句 ${formatAudioTime(sentence.startSeconds)}`" :title="`播放本句 ${formatAudioTime(sentence.startSeconds)}`"
                      @click="playSentence(sentence)">
                      <span aria-hidden="true">▶</span><time>{{ formatAudioTime(sentence.startSeconds) }}</time>
                    </button>
                    <div class="listening-transcript__text">
                      <span>{{ sentence.text }}</span>
                      <p v-if="showTranslation && sentence.translation" class="listening-transcript__translation">{{ sentence.translation }}</p>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </section>
          <div v-if="reviewMode" id="divider" ref="dividerRef" role="separator" tabindex="0"
            aria-label="调整原文与题目宽度" aria-orientation="vertical" aria-controls="left right"
            :aria-valuenow="valueNow" aria-valuemin="0" aria-valuemax="100" :class="{ 'is-dragging': dragging }"
            @pointerdown="startDrag" @keydown="handleKeydown"></div>
          <section id="right" class="listening-exam__pane" aria-label="听力题目与解析">
            <div v-if="reviewMode" class="listening-exam__pane-header listening-exam__view-switch" role="group" aria-label="复盘内容">
              <button type="button" :aria-pressed="reviewView === 'questions'" aria-controls="listening-question-content"
                @click="reviewView = 'questions'">题目</button>
              <button type="button" :aria-pressed="reviewView === 'answers'" aria-controls="listening-answer-content"
                @click="reviewView = 'answers'">答案与解析</button>
            </div>
            <div class="listening-exam__pane-body" tabindex="0" aria-label="听力题目与解析内容">
              <p v-if="draftRestored && !reviewMode" class="listening-practice__notice" role="status">已恢复未提交草稿。</p>
              <p v-if="submitError" class="listening-practice__error" role="alert">{{ submitError }}</p>
              <div id="listening-question-content" v-show="!reviewMode || reviewView === 'questions'">
                <ListeningQuestionPane v-if="activeGroups.length" :groups="activeGroups" :display-map="displayMap"
                  @question-input="handleQuestionInput" />
                <p v-else role="status">本节暂无题目。</p>
              </div>
              <div v-if="reviewMode && review" id="listening-answer-content" v-show="reviewView === 'answers'">
                <ListeningReviewPanel :groups="activeGroups" :rows="review.rows"
                  :answer-key="payload.answerKey || {}" :explanations="explanationMap" :display-map="displayMap"
                  :material="payload.studyMaterial" :active-question-id="activeQuestionId"
                  @locate-answer="locateAnswer" @show-question="showReviewQuestion" />
              </div>
            </div>
          </section>
        </div>
        <p v-if="!reviewMode" class="listening-practice__progress sr-only" role="status">已作答 {{ answeredCount }} / {{ questionCount }} 题</p>
      </template>
    </main>
    <ReadingCoachPanel
      v-if="reviewMode && isJiufenAsset(props.assetId)"
      :submission="coachSubmission"
      :reading-coach-open="readingCoachOpen"
      :coach-notice="coachNotice"
      :coach-history-failed="coachHistoryFailed"
      :coach-retry-kind="coachRetryKind"
      :coach-adjustments="coachAdjustments"
      :coach-memory-cards="coachMemoryCards"
      :coach-loading="coachLoading"
      :coach-status-text="coachStatusText"
      :selected-context="selectedContext"
      :coach-transcript="coachTranscript"
      :coach-response="coachResponse"
      :coach-remembered="coachRemembered"
      :coach-quick-actions="coachQuickActions"
      :coach-selection-actions="coachSelectionActions"
      :coach-follow-ups="coachFollowUps"
      :coach-feedback="coachFeedback"
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
      @reask="reaskCoachMessage"
      @retry="retryCoachQuery"
      @reload-history="reloadCoachHistory"
      @memory-card-confirm="confirmCoachMemoryCard($event.messageId, $event.text)"
      @memory-card-dismiss="dismissCoachMemoryCard($event.messageId)"
      @forget-remembered="forgetRememberedPreference"
      @update:coach-query="coachQuery = $event"
      @refresh-selected-context="refreshSelectedContext"
      @ask="askCoach"
    />

    <UnifiedPracticeNav
      :sections="navSections" :question-order="activeQuestionOrder" :display-map="displayMap"
      :category="`P${activeSection}`" :has-answer="hasAnswer" :active-question-id="activeQuestionId"
      :review-mode="reviewMode" :answer-comparison="answerComparison"
      :submit-disabled="loading || !payload || submitting || reviewMode || isPreview"
      :submit-label="isPreview ? '暂不支持交卷' : submitting ? '提交中…' : reviewMode ? '已提交' : '提交作答'"
      @open-part="selectSection" @scroll-to-question="focusQuestion" @submit="submitAnswers"
    />
  </div>
</template>

<script setup>
import '@/modules/reading-unified/styles/unified.css'
import '@/modules/practice-reading/styles/host-extras.css'
import ReadingCoachPanel from '@/modules/practice-reading/components/ReadingCoachPanel.vue'
import { useReadingCoach } from '@/modules/practice-reading/useReadingCoach'
import { jiufen, isJiufenAsset } from '@/api/jiufen.js'
import { isIdictationListeningPreview } from '@/api/idictation.js'
import { useArticlePlayback } from '../../../../plug/idictation/useArticlePlayback.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ListeningAudioBar from '@/modules/practice-listening/components/ListeningAudioBar.vue'
import ListeningQuestionPane from '@/modules/practice-listening/components/ListeningQuestionPane.vue'
import ListeningReviewPanel from '@/modules/practice-listening/components/ListeningReviewPanel.vue'
import UnifiedExamHeader from '@/modules/reading-unified/components/UnifiedExamHeader.vue'
import UnifiedPracticeNav from '@/modules/reading-unified/components/UnifiedPracticeNav.vue'
import { useListeningAsset } from '@/modules/practice-listening/useListeningAsset.js'
import { useListeningAudio } from '@/modules/practice-listening/useListeningAudio.js'
import {
  buildListeningExplanationMap,
  isDraftForAsset,
  mapHistoryDetailToListeningReview,
  useListeningAttempt
} from '@/modules/practice-listening/useListeningAttempt.js'
import { sectionLabel } from '@/modules/practice-listening/listeningTags.js'
import { useReadingAnswers } from '@/modules/practice-reading/useReadingAnswers'
import { useQuestionTimeline } from '@/modules/practice-reading/useQuestionTimeline'
import { useNativeAnswerControls } from '@/modules/reading-unified/composables/useNativeAnswerControls.js'
import { useUnifiedDivider } from '@/modules/reading-unified/composables/useUnifiedDivider.js'
import { applyResultsToQuestionArea } from '@/modules/reading-unified/reviewMarks.js'

const props = defineProps({
  assetId: { type: String, required: true },
  attemptId: { type: String, default: '' }
})

const route = useRoute()
const router = useRouter()
const isPreview = computed(() => isIdictationListeningPreview(props.assetId))

const reviewMode = computed(() => Boolean(props.attemptId) || route.name === 'PracticeListeningReview')
const reviewReplay = computed(() => String(route.query?.replay || '') === '1')
const replayNotice = computed(() => (reviewReplay.value ? '重复提交已按原结果返回。' : ''))

const loading = ref(true)
const error = ref('')
const submitting = ref(false)
const submitError = ref('')
const draftRestored = ref(false)
const activeSection = ref(1)
const activeQuestionId = ref('')
const onlineAudio = ref(null)
const audioBar = ref(null)
const audioTime = ref(0)
const audioPlaying = ref(false)
const materialLoading = ref(false)
const materialError = ref('')
const reviewView = ref('answers')
const showTranslation = ref(false)
const locatedSentences = ref([])
const review = ref(null)
const reviewLoading = ref(false)
const reviewError = ref('')
const coachSubmission = ref(null)
const coachQuickActions = []
const coachSelectionActions = []
const {
  coachQuery, coachLoading, coachError, coachResponse, coachRemembered, selectedContext,
  readingCoachOpen, canAskCoach, coachStatusText, coachTranscript, coachFollowUps,
  coachFeedback, coachReaskableId, toggleReadingCoachPanel, setReadingCoachOpen, refreshSelectedContext,
  clearSelectedContext, askCoach, askCoachFollowUp, reaskCoachMessage, submitCoachFeedback,
  runCoachQuickAction, runCoachSelectionAction, forgetRememberedPreference,
  hydrateReadingCoachFromSubmission, coachNotice, coachHistoryFailed, coachRetryKind,
  coachAdjustments, coachMemoryCards, retryCoachQuery, reloadCoachHistory,
  confirmCoachMemoryCard, dismissCoachMemoryCard
} = useReadingCoach({
  activity: 'listening',
  submissionSource: () => coachSubmission.value,
  assetIdSource: () => props.assetId,
  setSubmission: value => { coachSubmission.value = value },
  resolveCoachMode: () => 'review',
  readSelectedContext: () => activeQuestionId.value ? {
    scope: 'question', text: `第 ${payload.value?.questionDisplayMap?.[activeQuestionId.value] || activeQuestionId.value} 题`,
    questionIds: [activeQuestionId.value],
    questionNumbers: [payload.value?.questionDisplayMap?.[activeQuestionId.value] || activeQuestionId.value.replace('q', '')]
  } : null,
  getDisplayLabel: id => payload.value?.questionDisplayMap?.[id] || id,
  formatReviewAnswer: value => Array.isArray(value) ? value.join(', ') : String(value ?? '')
})
const startedAtMs = ref(Date.now())
const submitted = ref(false)
const { shellRef, dividerRef, dragging, valueNow, startDrag, handleKeydown } = useUnifiedDivider()

const {
  asset,
  payload,
  error: assetError,
  loadListeningAsset
} = useListeningAsset()
const {
  audioUrl,
  loading: audioLoading,
  error: audioError,
  loadAudio
} = useListeningAudio()
const listeningAttempt = useListeningAttempt()
const previewPlayback = useArticlePlayback()
const previewSource = ref(null)
const previewPartTracks = computed(() => previewSource.value?.trackIds)
const previewTrack = computed(() => previewPartTracks.value?.[activeSection.value] || previewSource.value?.trackId || '')
const previewAudioError = computed(() => previewTrack.value
  ? previewPlayback.error.value || previewPlayback.state.value?.error || ''
  : '当前试题没有可播放音轨')
const sourcePlayback = computed(() => {
  if (!isPreview.value || !previewTrack.value) return null
  const state = previewPlayback.state.value?.mediaId === previewTrack.value ? previewPlayback.state.value : null
  return {
    state,
    toggle: () => state && state.currentTime < state.duration - 0.02
      ? previewPlayback.toggle() : previewPlayback.play(previewTrack.value),
    seek: previewPlayback.seek,
    volume: previewPlayback.changeVolume
  }
})

const attemptId = ref(String(props.attemptId || '').trim())
let draftKey = ''
let submitKey = ''
let draftTimer = null
let hydrating = false
let dirty = false

// The ledger stores changeCount / visitCount / elapsedMs / firstTryCorrect per
// question. A page that submits an empty timeline makes all four zero, so the
// same tracker the reading page uses owns this state here too.
const timeline = useQuestionTimeline({
  payloadSource: () => payload.value,
  readOnlySource: () => reviewMode.value,
  getRawAnswer: (questionId) => getRawAnswer(questionId),
  getDisplayLabel: (questionId) => String(
    payload.value?.questionDisplayMap?.[questionId] || String(questionId || '').replace(/^q/i, '')
  )
})

const {
  questionOrder,
  answeredCount,
  hasAnswer,
  initializeAnswers,
  assignAnswer,
  setAnswer,
  getRawAnswer,
  getAnswerEntries,
  snapshotAnswers
} = useReadingAnswers({
  payloadSource: () => payload.value,
  readOnlySource: () => reviewMode.value,
  onTrack: timeline.recordAnswerTimeline,
  onMutate: (_questionId, _value, metadata) => {
    if (!hydrating && metadata?.changed) {
      dirty = true
      scheduleDraftSave()
    }
  }
})

const nativeControls = useNativeAnswerControls({
  payloadSource: () => payload.value,
  readOnlySource: () => reviewMode.value,
  getInteraction: (questionId) => payload.value?.interactionModel?.[questionId] || null,
  getRawAnswer,
  getAnswerEntries,
  setAnswer,
  isDragDropControl: () => false,
  syncDropzoneControl: () => {},
  onAnswerInput: (questionIds) => {
    questionIds.forEach((questionId) => timeline.recordQuestionVisit(questionId))
    if (!hydrating) scheduleDraftSave()
  }
})

const pageTitle = computed(() => review.value?.title || asset.value?.title || '听力练习')
const questionCount = computed(() => Number(payload.value?.questionCount) || questionOrder.value.length || 0)
const displayMap = computed(() => payload.value?.questionDisplayMap || {})
const durationSeconds = computed(() => Number(asset.value?.durationSeconds) || 0)
const explanationMap = computed(() => buildListeningExplanationMap(payload.value?.reviewExplanations))
const activeMaterial = computed(() => payload.value?.studyMaterial?.parts?.find(part => Number(part.section) === activeSection.value))
const hasTranslation = computed(() => activeMaterial.value?.paragraphs?.some(paragraph => paragraph.sentences.some(sentence => sentence.translation)))

async function loadStudyMaterial() {
  if (!isJiufenAsset(props.assetId) || !reviewMode.value) return
  const id = props.assetId
  const attempt = props.attemptId
  materialError.value = ''
  materialLoading.value = true
  try {
    const material = await jiufen.studyMaterial(id, 'listening', attempt)
    if (props.assetId === id && props.attemptId === attempt) payload.value.studyMaterial = material
  } catch (failure) {
    if (props.assetId === id && props.attemptId === attempt) materialError.value = failure?.message || String(failure)
  } finally {
    if (props.assetId === id && props.attemptId === attempt) materialLoading.value = false
  }
}

function isPlaying(sentence) {
  return audioPlaying.value && sentence.startSeconds != null && sentence.endSeconds != null
    && audioTime.value >= sentence.startSeconds && audioTime.value < sentence.endSeconds
}

function formatAudioTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function playSentence(sentence) {
  return audioBar.value?.playSegment(sentence.startSeconds, sentence.endSeconds)
}

async function locateAnswer(questionId) {
  const location = payload.value?.studyMaterial?.questions?.[questionId]
  const part = payload.value?.studyMaterial?.parts?.find(part => part.id === location?.partId)
  if (!part) return
  selectSection(Number(part.section))
  activeQuestionId.value = questionId
  locatedSentences.value = location.sentenceIds || []
  await nextTick()
  const target = [...document.querySelectorAll('[data-study-sentence]')]
    .find(node => locatedSentences.value.includes(node.dataset.studySentence))
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
const headerMeta = computed(() => {
  const labels = activeQuestionOrder.value.map(id => displayMap.value[id] || id.replace(/^q/i, ''))
  if (!labels.length) return ''
  const range = labels.length > 1 ? `${labels[0]}–${labels.at(-1)}` : labels[0]
  return reviewMode.value ? `Questions ${range} · 听力复盘` : `Listen and answer questions ${range}.`
})

const sectionCounts = computed(() => {
  const counts = new Map()
  for (const group of payload.value?.questionGroups || []) {
    const section = Number(group?.section)
    if (!section) continue
    const count = Array.isArray(group?.questionIds) ? group.questionIds.length : 0
    counts.set(section, (counts.get(section) || 0) + count)
  }
  return counts
})
const sectionNav = computed(() => [1, 2, 3, 4].map((section) => ({
  section,
  label: sectionLabel(section),
  count: sectionCounts.value.get(section) || 0,
  disabled: !(sectionCounts.value.get(section) > 0)
})).filter(entry => !payload.value?.idictationJijing || questionCount.value !== 10 || !entry.disabled))
const activeGroups = computed(() => (payload.value?.questionGroups || [])
  .filter((group) => Number(group?.section) === activeSection.value))
const activeQuestionOrder = computed(() => activeGroups.value.flatMap(group => group.questionIds || []))
const navSections = computed(() => sectionNav.value.map(item => ({
  section: item.section,
  questionIds: (payload.value?.questionGroups || [])
    .filter(group => Number(group.section) === item.section)
    .flatMap(group => group.questionIds || [])
})))
const answerComparison = computed(() => Object.fromEntries(
  (review.value?.rows || []).map(row => [row.questionId, { ...row, correctAnswer: payload.value?.answerKey?.[row.questionId] }])
))

async function focusQuestion(questionId) {
  activeQuestionId.value = questionId
  if (!reviewMode.value) timeline.recordQuestionVisit(questionId)
  await nextTick()
  if (reviewMode.value && reviewView.value === 'answers') {
    document.querySelector(`[data-review-question-id="${questionId}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    return
  }
  const control = Array.from(document.querySelectorAll('#question-groups [name]'))
    .find(node => nativeControls.resolveNativeQuestionIds(node).includes(questionId))
  control?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (!reviewMode.value) control?.focus({ preventScroll: true })
}

async function showReviewQuestion(questionId) {
  reviewView.value = 'questions'
  await focusQuestion(questionId)
}

function firstPresentSection() {
  const count = sectionCounts.value.get(1) || 0
  if (count > 0) return 1
  const present = [...sectionCounts.value.keys()].sort((left, right) => left - right)[0]
  return present || 1
}

function sectionFirstQuestion(section) {
  for (const group of payload.value?.questionGroups || []) {
    if (Number(group?.section) !== section) continue
    const first = Array.isArray(group?.questionIds) ? String(group.questionIds[0] || '') : ''
    if (first) return first
  }
  return ''
}

function syncDomAnswers() {
  nativeControls.syncDomAnswers()
  if (reviewMode.value) {
    applyResultsToQuestionArea(answerComparison.value, displayMap.value, nativeControls.resolveNativeQuestionIds)
  }
}

function selectSection(section) {
  const target = sectionNav.value.find((entry) => entry.section === section)
  if (!target || target.disabled) return
  // Opening a section is navigation: it ends the previous question's elapsed
  // clock and starts the section's first question, exactly like scrolling to a
  // question on the reading page.
  const firstQuestion = sectionFirstQuestion(section)
  activeQuestionId.value = firstQuestion
  if (firstQuestion && !reviewMode.value) timeline.recordQuestionVisit(firstQuestion)
  if (section === activeSection.value) return
  if (previewPartTracks.value) previewPlayback.suspend()
  activeSection.value = section
  locatedSentences.value = []
  void nextTick(() => {
    syncDomAnswers()
    document.querySelectorAll('.listening-exam__pane-body').forEach(pane => { pane.scrollTop = 0 })
  })
}

function handleQuestionInput(event) {
  if (reviewMode.value) return
  activeQuestionId.value = nativeControls.resolveNativeQuestionIds(event.target)[0] || activeQuestionId.value
  nativeControls.handleQuestionInput(event)
}

function scheduleDraftSave() {
  if (isPreview.value || reviewMode.value || !payload.value) return
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    draftTimer = null
    void saveDraftNow().catch((saveError) => {
      console.warn('听力草稿自动保存失败:', saveError)
    })
  }, 800)
}

async function saveDraftNow() {
  if (isPreview.value || reviewMode.value || !payload.value || !asset.value?.id) return
  if (!attemptId.value) attemptId.value = listeningAttempt.newAttemptId()
  if (!draftKey) draftKey = listeningAttempt.newIdempotencyKey('draft')
  // Flush first: the open question's elapsed time belongs to this save.
  timeline.flushActiveQuestionVisit()
  await listeningAttempt.persistDraft({
    attemptId: attemptId.value,
    assetId: asset.value.id,
    assetRevision: asset.value.schemaVersion,
    assetFingerprint: asset.value.fingerprint,
    answers: snapshotAnswers(),
    markedQuestions: timeline.markedQuestions.value.slice(),
    questionTimeline: timeline.buildPersistedQuestionTimeline(),
    titleSnapshot: pageTitle.value,
    timerSnapshot: null,
    idempotencyKey: draftKey
  })
}

async function restoreDraft() {
  const draft = await listeningAttempt.fetchOpenDraft(props.assetId)
  if (!draft) return
  if (!isDraftForAsset(draft, props.assetId)) {
    console.warn('忽略不属于当前听力资源的草稿', {
      assetId: props.assetId,
      draftAssetId: draft.assetId ?? draft.asset_id,
      draftId: draft.id
    })
    return
  }
  attemptId.value = String(draft.id || '').trim()
  const startedAt = Date.parse(draft.startedAt || '')
  if (Number.isFinite(startedAt) && startedAt > 0) startedAtMs.value = startedAt
  hydrating = true
  try {
    // Restore the timeline before answers: assigning a hydrated answer must
    // never look like a learner edit, and the saved change/visit counts own
    // that question from here on.
    timeline.hydrateFromDraftAnswers(draft.answers)
    for (const entry of draft.answers || []) {
      const questionId = String(entry?.questionId ?? entry?.question_id ?? '').trim()
      if (!questionId) continue
      const answer = entry.answer
      if (answer == null || answer === '') continue
      if (assignAnswer(questionId, answer)) draftRestored.value = true
    }
  } finally {
    hydrating = false
  }
}

async function loadReview() {
  if (!reviewMode.value) return
  reviewLoading.value = true
  reviewError.value = ''
  try {
    const detail = await listeningAttempt.fetchReviewDetail(props.attemptId)
    const mapped = mapHistoryDetailToListeningReview(detail)
    if (mapped.assetId && mapped.assetId !== props.assetId) {
      throw new Error('复盘记录与当前听力资源不匹配')
    }
    if (isJiufenAsset(props.assetId)) {
      Object.assign(payload.value, await jiufen.review(props.assetId, props.attemptId))
    }
    review.value = mapped
    if (isJiufenAsset(props.assetId)) {
      coachSubmission.value = { ...mapped, sessionId: props.attemptId, examId: props.assetId,
        answerComparison: Object.fromEntries(mapped.rows.map(row => [row.questionId, row])) }
      hydrateReadingCoachFromSubmission(coachSubmission.value)
    }
    void loadStudyMaterial()
    Object.entries(mapped.answers).forEach(([id, answer]) => assignAnswer(id, answer))
    await nextTick()
    syncDomAnswers()
  } catch (loadError) {
    console.warn('加载听力复盘记录失败:', loadError)
    review.value = null
    reviewError.value = loadError?.message
      ? `复盘记录加载失败：${loadError.message}`
      : '复盘记录加载失败，请稍后重试'
  } finally {
    reviewLoading.value = false
  }
}

async function submitAnswers() {
  if (isPreview.value || submitting.value || reviewMode.value || !payload.value) return
  submitting.value = true
  submitError.value = ''
  if (draftTimer) {
    clearTimeout(draftTimer)
    draftTimer = null
  }
  try {
    if (!attemptId.value) attemptId.value = listeningAttempt.newAttemptId()
    if (!submitKey) submitKey = listeningAttempt.newIdempotencyKey('submit')
    // Flush first: the open question's elapsed time belongs to this submit.
    timeline.flushActiveQuestionVisit()
    const { submission } = await listeningAttempt.submit({
      attemptId: attemptId.value,
      assetId: asset.value.id,
      assetRevision: asset.value.schemaVersion,
      assetFingerprint: asset.value.fingerprint,
      answers: snapshotAnswers(),
      markedQuestions: timeline.markedQuestions.value.slice(),
      questionTimeline: timeline.buildPersistedQuestionTimeline(),
      durationMs: Math.max(0, Date.now() - startedAtMs.value),
      titleSnapshot: pageTitle.value,
      idempotencyKey: submitKey
    })
    if (!submission.attemptId) {
      throw new Error('提交结果缺少作答编号')
    }
    submitted.value = true
    await router.replace({
      name: 'PracticeListeningReview',
      params: { assetId: asset.value.id, attemptId: submission.attemptId },
      query: submission.idempotentReplay ? { replay: '1' } : {}
    })
  } catch (submitFailure) {
    console.warn('提交听力作答失败:', submitFailure)
    submitError.value = submitFailure?.message
      ? `提交失败：${submitFailure.message}`
      : '提交失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

function formatDurationMs(value) {
  const totalSeconds = Math.max(0, Math.round((Number(value) || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const rest = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`
}

async function loadPracticeAudio() {
  if (isPreview.value) {
    if (previewTrack.value) await previewPlayback.play(previewTrack.value)
    return
  }
  if (!isJiufenAsset(props.assetId)) return loadAudio(props.assetId)
  audioLoading.value = true
  audioError.value = ''
  try {
    onlineAudio.value = await jiufen.listeningAudio(props.assetId)
    if (!Object.keys(onlineAudio.value).length) audioError.value = '当前试题没有可播放音轨'
  } catch (failure) {
    audioError.value = failure?.message || String(failure)
  } finally {
    audioLoading.value = false
  }
}

async function initialize() {
  loading.value = true
  error.value = ''
  submitError.value = ''
  review.value = null
  reviewError.value = ''
  draftRestored.value = false
  submitted.value = false
  dirty = false
  timeline.reset()
  try {
    if (isPreview.value && reviewMode.value) throw new Error('此试卷没有可复盘的交卷记录')
    await loadListeningAsset(props.assetId)
    initializeAnswers(payload.value)
    activeSection.value = firstPresentSection()
    activeQuestionId.value = sectionFirstQuestion(activeSection.value)
    if (isPreview.value) {
      const source = payload.value?.idictationPlayback
      previewSource.value = source || null
      if (source?.sessionId) await previewPlayback.attach(source.sessionId)
    } else {
      void loadPracticeAudio()
    }
    if (reviewMode.value) {
      await loadReview()
    } else if (!isPreview.value) {
      await restoreDraft()
    }
  } catch (loadError) {
    console.error('加载听力练习失败:', loadError)
    error.value = assetError.value || loadError?.message || '听力练习加载失败'
  } finally {
    loading.value = false
    await nextTick()
    syncDomAnswers()
  }
}

onMounted(initialize)

onBeforeUnmount(() => {
  if (draftTimer) {
    clearTimeout(draftTimer)
    draftTimer = null
  }
  timeline.flushActiveQuestionVisit()
  if (!isPreview.value && !reviewMode.value && !submitted.value && dirty) {
    void saveDraftNow().catch((saveError) => {
      console.warn('离开听力页面前保存草稿失败:', saveError)
    })
  }
})
</script>

<style src="../modules/practice-listening/styles/listening.css"></style>
