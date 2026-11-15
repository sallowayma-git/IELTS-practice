<template>
  <div
    class="listening-practice"
    :class="{ 'is-review': reviewMode }"
    data-listening-practice
    :data-review-mode="reviewMode ? 'true' : null"
  >
    <header class="listening-practice__header">
      <router-link class="listening-practice__back" :to="{ name: 'ListeningLibrary' }">
        ← 返回听力题库
      </router-link>
      <div class="listening-practice__heading">
        <p class="listening-practice__kicker">
          LISTENING · 听力{{ reviewMode ? ' · 复盘' : '' }}
        </p>
        <h1 class="heading-serif listening-practice__title">{{ pageTitle }}</h1>
        <p class="listening-practice__meta">{{ headerMeta }}</p>
      </div>
    </header>

    <p v-if="loading" class="listening-practice__status" role="status" aria-live="polite">
      正在加载听力内容…
    </p>

    <section v-else-if="error" class="listening-state" role="alert">
      <h2 class="listening-state__title">无法打开这套听力</h2>
      <p class="listening-state__desc">{{ error }}</p>
      <div class="listening-state__actions">
        <router-link class="btn btn-secondary" :to="{ name: 'ListeningLibrary' }">
          返回听力题库
        </router-link>
        <button class="btn btn-primary" type="button" @click="initialize">重试</button>
      </div>
    </section>

    <template v-else-if="payload">
      <div v-if="reviewMode && review" class="listening-score" data-listening-score>
        <p class="listening-score__value">
          <strong>{{ review.correctCount }}</strong>
          <span>/ {{ review.questionCount }}</span>
        </p>
        <p class="listening-score__percent">{{ review.percentage }}%</p>
        <p v-if="review.durationMs" class="listening-score__time">
          用时 {{ formatDurationMs(review.durationMs) }}
        </p>
        <p v-if="replayNotice" class="listening-score__note">{{ replayNotice }}</p>
      </div>

      <ListeningAudioBar
        :audio-url="audioUrl"
        :loading="audioLoading"
        :error="audioError"
        :duration-seconds="durationSeconds"
        @retry="loadAudio"
      />

      <template v-if="!reviewMode">
        <p v-if="draftRestored" class="listening-practice__notice" role="status">
          已恢复未提交草稿。
        </p>

        <ListeningSectionNav
          :sections="sectionNav"
          :active-section="activeSection"
          @select="selectSection"
        />

        <ListeningQuestionPane
          v-if="activeGroups.length"
          :groups="activeGroups"
          :display-map="displayMap"
          @question-input="handleQuestionInput"
        />
        <p v-else class="listening-practice__status" role="status">本节暂无题目。</p>

        <footer class="listening-practice__footer">
          <p class="listening-practice__progress" role="status">
            已作答 {{ answeredCount }} / {{ questionCount }} 题
          </p>
          <p v-if="submitError" class="listening-practice__error" role="alert">{{ submitError }}</p>
          <button
            class="btn btn-primary listening-practice__submit"
            type="button"
            :disabled="submitting"
            @click="submitAnswers"
          >
            {{ submitting ? '提交中…' : '提交作答' }}
          </button>
        </footer>
      </template>

      <template v-else>
        <p v-if="reviewLoading" class="listening-practice__status" role="status">正在加载复盘记录…</p>
        <section v-else-if="!review" class="listening-state" role="alert">
          <h2 class="listening-state__title">无法加载复盘记录</h2>
          <p class="listening-state__desc">{{ reviewError || '这条听力记录不存在或已被删除。' }}</p>
          <div class="listening-state__actions">
            <router-link class="btn btn-secondary" :to="{ name: 'ListeningLibrary' }">
              返回听力题库
            </router-link>
            <button class="btn btn-primary" type="button" @click="loadReview">重试</button>
          </div>
        </section>
        <ListeningReviewPanel
          v-else
          :groups="payload.questionGroups || []"
          :rows="review.rows"
          :answer-key="payload.answerKey || {}"
          :explanations="explanationMap"
          :display-map="displayMap"
        />
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ListeningAudioBar from '@/modules/practice-listening/components/ListeningAudioBar.vue'
import ListeningQuestionPane from '@/modules/practice-listening/components/ListeningQuestionPane.vue'
import ListeningReviewPanel from '@/modules/practice-listening/components/ListeningReviewPanel.vue'
import ListeningSectionNav from '@/modules/practice-listening/components/ListeningSectionNav.vue'
import { useListeningAsset } from '@/modules/practice-listening/useListeningAsset.js'
import { useListeningAudio } from '@/modules/practice-listening/useListeningAudio.js'
import {
  buildListeningExplanationMap,
  isDraftForAsset,
  mapHistoryDetailToListeningReview,
  useListeningAttempt
} from '@/modules/practice-listening/useListeningAttempt.js'
import {
  difficultyLabel,
  frequencyLabel,
  sectionLabel
} from '@/modules/practice-listening/listeningTags.js'
import { useReadingAnswers } from '@/modules/practice-reading/useReadingAnswers'
import { useQuestionTimeline } from '@/modules/practice-reading/useQuestionTimeline'
import { useNativeAnswerControls } from '@/modules/reading-unified/composables/useNativeAnswerControls.js'

const props = defineProps({
  assetId: { type: String, required: true },
  attemptId: { type: String, default: '' }
})

const route = useRoute()
const router = useRouter()

const reviewMode = computed(() => Boolean(props.attemptId) || route.name === 'PracticeListeningReview')
const reviewReplay = computed(() => String(route.query?.replay || '') === '1')
const replayNotice = computed(() => (reviewReplay.value ? '重复提交已按原结果返回。' : ''))

const loading = ref(true)
const error = ref('')
const submitting = ref(false)
const submitError = ref('')
const draftRestored = ref(false)
const activeSection = ref(1)
const review = ref(null)
const reviewLoading = ref(false)
const reviewError = ref('')
const startedAtMs = ref(Date.now())
const submitted = ref(false)

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
const headerMeta = computed(() => {
  const parts = []
  if (asset.value?.category) parts.push(asset.value.category)
  if (asset.value?.difficulty) parts.push(difficultyLabel(asset.value.difficulty))
  if (asset.value?.frequency) parts.push(frequencyLabel(asset.value.frequency))
  parts.push(`${questionCount.value} 题`)
  if (reviewMode.value) parts.push('复盘')
  return parts.join(' · ')
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
})))
const activeGroups = computed(() => (payload.value?.questionGroups || [])
  .filter((group) => Number(group?.section) === activeSection.value))

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
}

function selectSection(section) {
  const target = sectionNav.value.find((entry) => entry.section === section)
  if (!target || target.disabled) return
  // Opening a section is navigation: it ends the previous question's elapsed
  // clock and starts the section's first question, exactly like scrolling to a
  // question on the reading page.
  const firstQuestion = sectionFirstQuestion(section)
  if (firstQuestion) timeline.recordQuestionVisit(firstQuestion)
  if (section === activeSection.value) return
  activeSection.value = section
  void nextTick(() => syncDomAnswers())
}

function handleQuestionInput(event) {
  if (reviewMode.value) return
  nativeControls.handleQuestionInput(event)
}

function scheduleDraftSave() {
  if (reviewMode.value || !payload.value) return
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    draftTimer = null
    void saveDraftNow().catch((saveError) => {
      console.warn('听力草稿自动保存失败:', saveError)
    })
  }, 800)
}

async function saveDraftNow() {
  if (reviewMode.value || !payload.value || !asset.value?.id) return
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
    review.value = mapped
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
  if (submitting.value || reviewMode.value || !payload.value) return
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
    await loadListeningAsset(props.assetId)
    initializeAnswers(payload.value)
    activeSection.value = firstPresentSection()
    void loadAudio(props.assetId)
    if (reviewMode.value) {
      await loadReview()
    } else {
      await restoreDraft()
    }
  } catch (loadError) {
    console.error('加载听力练习失败:', loadError)
    error.value = assetError.value || loadError?.message || '听力练习加载失败'
  } finally {
    loading.value = false
    await nextTick()
    if (!reviewMode.value) syncDomAnswers()
  }
}

onMounted(initialize)

onBeforeUnmount(() => {
  if (draftTimer) {
    clearTimeout(draftTimer)
    draftTimer = null
  }
  timeline.flushActiveQuestionVisit()
  if (!reviewMode.value && !submitted.value && dirty) {
    void saveDraftNow().catch((saveError) => {
      console.warn('离开听力页面前保存草稿失败:', saveError)
    })
  }
})
</script>

<style src="../modules/practice-listening/styles/listening.css"></style>
