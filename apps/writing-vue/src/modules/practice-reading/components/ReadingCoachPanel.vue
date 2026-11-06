<template>
  <template v-if="submission">
    <button
      id="reading-coach-fab"
      ref="fab"
      class="reading-coach-fab"
      type="button"
      aria-controls="reading-coach-panel"
      :aria-expanded="readingCoachOpen ? 'true' : 'false'"
      data-reading-coach-fab
      @click="$emit('toggle-panel')"
    >
      AI 教练
    </button>
    <section
      id="reading-coach-panel"
      ref="panel"
      class="reading-coach-panel"
      :class="{ 'is-open': readingCoachOpen }"
      aria-label="AI 教练"
      tabindex="-1"
      data-reading-coach-panel
      @keydown.esc.stop="onPanelEscape"
    >
      <header class="reading-coach-panel__header">
        <span class="reading-coach-panel__title">AI 教练</span>
        <button
          id="reading-coach-close"
          class="reading-coach-panel__close"
          type="button"
          aria-label="收起 AI 教练"
          title="收起（Esc）"
          @click="collapse"
        >
          ×
        </button>
      </header>
      <div
        id="reading-coach-status"
        class="reading-coach-panel__status"
        :class="{ 'is-loading': coachLoading }"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-reading-coach-stream-status
      >
        {{ coachStatusText }}
      </div>
      <div v-if="coachNotice" class="reading-coach-panel__notice" role="alert" data-reading-coach-notice>
        <span>{{ coachNotice }}</span>
        <button
          v-if="coachHistoryFailed"
          class="reading-coach-chip"
          type="button"
          data-reading-coach-reload
          @click="$emit('reload-history')"
        >
          重新加载
        </button>
      </div>
      <div v-if="selectedContext" class="reading-coach-panel__selected-context" data-reading-coach-selected-context>
        <span>{{ selectedContext.scope === 'question' ? '已选题目' : '已选原文' }}</span>
        <strong>{{ selectedContext.text }}</strong>
        <button class="btn-text" type="button" @click="$emit('clear-selected-context')">清除</button>
      </div>
      <div
        id="reading-coach-messages"
        ref="log"
        class="reading-coach-panel__messages"
        role="log"
        aria-label="对话记录"
        aria-live="polite"
        aria-relevant="additions"
        :aria-busy="coachLoading ? 'true' : 'false'"
        tabindex="0"
        data-reading-coach-transcript
        @scroll.passive="onLogScroll"
      >
        <div v-if="!coachTranscript.length" class="reading-coach-msg assistant">
          你可以先问：这题怎么定位证据？
        </div>
        <template v-for="entry in coachTranscript" :key="entry.id">
          <div
            class="reading-coach-msg"
            :class="[entry.role, { error: entry.isError }]"
            :data-reading-coach-message="entry.role"
            :aria-busy="entry.status === 'streaming' ? 'true' : undefined"
          >
            <ReadingCoachMessageText v-if="entry.role === 'assistant' && !entry.isError" :content="entry.content" />
            <template v-else>{{ entry.content }}</template>
          </div>
          <div
            v-if="entry.id === retryEntryId"
            class="reading-coach-retry"
            role="group"
            aria-label="失败后的操作"
            data-reading-coach-retry
            :data-reading-coach-retry-kind="coachRetryKind"
          >
            <button
              v-if="coachRetryKind === 'truncated'"
              class="reading-coach-chip"
              type="button"
              data-reading-coach-retry-mode="short"
              @click="$emit('retry', 'short')"
            >
              简短回答重试
            </button>
            <button
              v-if="coachRetryKind === 'context'"
              class="reading-coach-chip"
              type="button"
              data-reading-coach-retry-mode="compact"
              @click="$emit('retry', 'compact')"
            >
              缩短选中内容后重试
            </button>
            <p
              v-if="coachRetryKind === 'context_limit'"
              class="reading-coach-retry-note"
              data-reading-coach-retry-note
            >
              题目和原文已经无法再精简，同样的请求还会超出模型的上下文长度。请换用上下文更大的模型后再试。
            </p>
            <button
              v-if="coachRetryKind !== 'context' && coachRetryKind !== 'context_limit'"
              class="reading-coach-chip"
              type="button"
              data-reading-coach-retry-mode="same"
              @click="$emit('retry', 'same')"
            >
              重试
            </button>
          </div>
          <div
            v-if="isFeedbackEligible(entry)"
            class="reading-coach-feedback"
            role="group"
            aria-label="这条回答对你有用吗"
            data-reading-coach-feedback
            :data-reading-coach-feedback-message-id="entry.id"
            :data-reading-coach-feedback-state="feedbackFor(entry.id)?.status || 'idle'"
          >
            <button
              v-for="option in primaryOptions"
              :key="option.kind"
              class="reading-coach-feedback__option"
              :class="{ 'is-selected': isOptionSelected(entry.id, option.kind) }"
              type="button"
              :aria-pressed="isOptionSelected(entry.id, option.kind) ? 'true' : 'false'"
              :disabled="isOptionLocked(entry.id, option.kind)"
              :data-reading-coach-feedback-kind="option.kind"
              @click="$emit('feedback', { messageId: entry.id, kind: option.kind })"
            >
              {{ option.label }}
            </button>
            <button
              class="reading-coach-feedback__option reading-coach-feedback__more"
              type="button"
              :aria-expanded="feedbackMenuId === entry.id ? 'true' : 'false'"
              :aria-controls="feedbackMenuDomId(entry.id)"
              data-reading-coach-feedback-menu-toggle
              @click="toggleFeedbackMenu(entry.id, $event)"
            >
              讲得不对劲？
            </button>
            <button
              v-if="entry.id === coachReaskableId"
              class="reading-coach-feedback__option"
              type="button"
              :disabled="coachLoading"
              data-reading-coach-feedback-reask
              @click="$emit('reask', entry.id)"
            >
              换个讲法
            </button>
            <span
              v-if="feedbackNote(entry.id) === 'saved'"
              class="reading-coach-feedback__note"
              data-reading-coach-feedback-note="saved"
            >已记下</span>
            <span
              v-else-if="feedbackNote(entry.id) === 'failed'"
              class="reading-coach-feedback__note is-error"
              data-reading-coach-feedback-note="failed"
            >没保存上，可以再点一次</span>
            <span
              v-if="coachStrategyLabel(entry)"
              class="reading-coach-feedback__strategy"
              data-reading-coach-strategy
            >讲法：{{ coachStrategyLabel(entry) }}</span>
            <div
              v-if="feedbackMenuId === entry.id"
              :id="feedbackMenuDomId(entry.id)"
              class="reading-coach-feedback__menu"
              role="group"
              aria-label="哪里讲得不对劲"
              data-reading-coach-feedback-menu
              @keydown.esc.stop.prevent="closeFeedbackMenu(true)"
            >
              <button
                v-for="option in menuOptions"
                :key="option.kind"
                class="reading-coach-feedback__option"
                :class="{ 'is-selected': isOptionSelected(entry.id, option.kind) }"
                type="button"
                :aria-pressed="isOptionSelected(entry.id, option.kind) ? 'true' : 'false'"
                :disabled="isOptionLocked(entry.id, option.kind)"
                :data-reading-coach-feedback-kind="option.kind"
                @click="$emit('feedback', { messageId: entry.id, kind: option.kind })"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <ReadingCoachMemoryCard
            v-if="coachMemoryCards[entry.id]"
            :key="`card-${entry.id}`"
            :card="coachMemoryCards[entry.id]"
            @confirm="onCardAction('memory-card-confirm', $event)"
            @dismiss="onCardAction('memory-card-dismiss', $event)"
          />
        </template>
      </div>
      <div v-if="showJump" class="reading-coach-panel__jump" data-reading-coach-jump>
        <button class="reading-coach-chip" type="button" @click="scrollToLatest">↓ 查看最新</button>
      </div>
      <div id="reading-coach-actions" class="reading-coach-panel__actions" data-reading-coach-actions>
        <button
          v-for="action in coachQuickActions"
          :key="action.id"
          class="reading-coach-chip"
          type="button"
          :disabled="coachLoading"
          :data-coach-action="action.id"
          :data-reading-coach-action="action.id"
          @click="$emit('quick-action', action.id)"
        >
          {{ action.label }}
        </button>
      </div>
      <div v-if="selectedContext" class="reading-coach-panel__actions" data-reading-coach-selection-tools>
        <button
          v-for="action in coachSelectionActions"
          :key="action.id"
          class="reading-coach-chip"
          type="button"
          :disabled="coachLoading"
          :data-reading-coach-selection-action="action.id"
          @click="$emit('selection-action', action.id)"
        >
          {{ action.label }}
        </button>
      </div>
      <div v-if="coachFollowUps.length" id="reading-coach-followups" class="reading-coach-panel__followups" data-reading-coach-followups>
        <button
          v-for="text in coachFollowUps"
          :key="text"
          class="reading-coach-chip"
          type="button"
          :disabled="coachLoading"
          data-coach-followup="1"
          @click="$emit('follow-up', text)"
        >
          {{ text }}
        </button>
      </div>
      <div class="reading-coach-panel__composer">
        <textarea
          id="reading-coach-input"
          ref="input"
          :value="coachQuery"
          class="reading-coach-panel__input"
          rows="1"
          aria-label="向 AI 教练提问"
          placeholder="问我：这题如何定位证据？"
          enterkeyhint="send"
          @input="onInput"
          @focus="$emit('refresh-selected-context')"
          @keydown.enter="onEnter"
        />
        <button
          id="reading-coach-send"
          class="reading-coach-panel__send"
          type="button"
          :disabled="!canAskCoach"
          @click="ask"
        >
          {{ coachLoading ? '分析中...' : '询问教练' }}
        </button>
      </div>
    </section>
  </template>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import {
  READING_COACH_ADJUSTMENT_OPTIONS,
  READING_COACH_FEEDBACK_OPTIONS,
  coachStrategyLabel,
  isFeedbackEligible
} from '../useReadingCoach'
import ReadingCoachMemoryCard from './ReadingCoachMemoryCard.vue'
import ReadingCoachMessageText from './ReadingCoachMessageText.vue'

const props = defineProps({
  submission: { type: Object, default: null },
  readingCoachOpen: { type: Boolean, default: false },
  coachLoading: { type: Boolean, default: false },
  coachStatusText: { type: String, default: '' },
  coachNotice: { type: String, default: '' },
  coachHistoryFailed: { type: Boolean, default: false },
  coachRetryKind: { type: String, default: '' },
  selectedContext: { type: Object, default: null },
  coachTranscript: { type: Array, default: () => [] },
  coachQuickActions: { type: Array, default: () => [] },
  coachSelectionActions: { type: Array, default: () => [] },
  coachFollowUps: { type: Array, default: () => [] },
  coachFeedback: { type: Object, default: () => ({}) },
  coachAdjustments: { type: Object, default: () => ({}) },
  coachMemoryCards: { type: Object, default: () => ({}) },
  coachReaskableId: { type: String, default: '' },
  coachQuery: { type: String, default: '' },
  canAskCoach: { type: Boolean, default: false }
})

const emit = defineEmits([
  'toggle-panel',
  'update:reading-coach-open',
  'clear-selected-context',
  'quick-action',
  'selection-action',
  'follow-up',
  'feedback',
  'memory-card-confirm',
  'memory-card-dismiss',
  'reask',
  'retry',
  'reload-history',
  'update:coach-query',
  'refresh-selected-context',
  'ask'
])

// Two verdict buttons stay in the row; "讲错了" and the how-to-explain-next-time
// adjustments sit one tap away behind "讲得不对劲？".
const primaryOptions = READING_COACH_FEEDBACK_OPTIONS.filter((option) => !option.menu)
const menuOptions = [...READING_COACH_FEEDBACK_OPTIONS.filter((option) => option.menu), ...READING_COACH_ADJUSTMENT_OPTIONS]
const adjustmentKinds = new Set(READING_COACH_ADJUSTMENT_OPTIONS.map((option) => option.kind))
// Within this distance of the end the log counts as "following" the newest text.
const FOLLOW_THRESHOLD_PX = 48

const fab = ref(null)
const panel = ref(null)
const log = ref(null)
const input = ref(null)
const showJump = ref(false)
const feedbackMenuId = ref('')
// The card whose confirm/dismiss we just forwarded: focus returns to the box once it settles.
const cardActionId = ref('')

// The failure note is only actionable while it is still the newest row.
const retryEntryId = computed(() => {
  const last = props.coachTranscript[props.coachTranscript.length - 1]
  return props.coachRetryKind && last && last.isError && !last.persisted ? last.id : ''
})

const tail = computed(() => {
  const last = props.coachTranscript[props.coachTranscript.length - 1]
  return { id: last?.id || '', role: last?.role || '', size: last?.content?.length || 0 }
})

function feedbackFor(messageId) {
  return props.coachFeedback?.[messageId] || null
}

// One feedback per message: locked while saving and once saved; a failed
// save unlocks so the learner can try again.
function isFeedbackLocked(messageId) {
  const state = feedbackFor(messageId)
  return Boolean(state && state.status !== 'failed')
}

function adjustmentStatus(messageId, kind) {
  return props.coachAdjustments?.[messageId]?.[kind] || ''
}

function isOptionSelected(messageId, kind) {
  if (adjustmentKinds.has(kind)) return adjustmentStatus(messageId, kind) === 'saved'
  return feedbackFor(messageId)?.kind === kind
}

// A verdict is locked once given (any verdict locks the others); an adjustment
// only locks itself, and unlocks again if its save failed.
function isOptionLocked(messageId, kind) {
  if (!adjustmentKinds.has(kind)) return isFeedbackLocked(messageId)
  const status = adjustmentStatus(messageId, kind)
  return status === 'saving' || status === 'saved'
}

function feedbackNote(messageId) {
  const statuses = [feedbackFor(messageId)?.status, ...Object.values(props.coachAdjustments?.[messageId] || {})]
  if (statuses.includes('failed')) return 'failed'
  return statuses.includes('saved') ? 'saved' : ''
}

function feedbackMenuDomId(messageId) {
  return `reading-coach-feedback-menu-${String(messageId).replace(/[^\w-]/g, '')}`
}

function toggleFeedbackMenu(messageId, event) {
  feedbackMenuId.value = feedbackMenuId.value === messageId ? '' : messageId
  if (!feedbackMenuId.value) event.currentTarget?.focus({ preventScroll: true })
}

// Esc folds the menu and keeps focus on its toggle, not on the page behind.
function closeFeedbackMenu(restoreFocus = false) {
  const toggle = restoreFocus
    ? log.value?.querySelector(`[data-reading-coach-feedback-message-id="${feedbackMenuId.value}"] [data-reading-coach-feedback-menu-toggle]`)
    : null
  feedbackMenuId.value = ''
  toggle?.focus({ preventScroll: true })
}

function onCardAction(event, payload) {
  cardActionId.value = payload.messageId
  emit(event, payload)
}

// A touch keyboard covers half the panel, so focus only jumps into the input
// for fine pointers; touch users tap it themselves.
function hasFinePointer() {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(pointer: fine)').matches
}

function focusInput() {
  if (input.value && hasFinePointer()) input.value.focus({ preventScroll: true })
}

function fitInput() {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
}

function onInput(event) {
  emit('update:coach-query', event.target.value)
  fitInput()
}

function ask() {
  emit('ask')
  focusInput()
}

// Enter sends, Shift+Enter breaks the line. Enter that confirms an IME
// candidate (Chinese/Japanese input) must not send the half-typed question.
function onEnter(event) {
  if (event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  ask()
}

function collapse() {
  fab.value?.focus({ preventScroll: true })
  emit('update:reading-coach-open', false)
}

function onPanelEscape(event) {
  if (event.isComposing || !props.readingCoachOpen) return
  collapse()
}

function isAtEnd() {
  const el = log.value
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX
}

function onLogScroll() {
  if (isAtEnd()) showJump.value = false
}

function scrollToLatest() {
  const el = log.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  showJump.value = false
}

// New text follows the reader only while they are at the end; scrolled up
// they keep their place and get a way back. Their own question always scrolls.
// "At the end" is measured from the DOM just before it grows, not from the
// last scroll event, which may not have fired yet.
watch(tail, async (next, previous) => {
  const follow = isAtEnd() || (next.role === 'user' && next.id !== previous.id)
  await nextTick()
  if (follow) scrollToLatest()
  else showJump.value = true
}, { flush: 'pre' })

watch(() => props.readingCoachOpen, async (open) => {
  if (!open) return
  emit('refresh-selected-context')
  await nextTick()
  scrollToLatest()
  fitInput()
  if (hasFinePointer()) focusInput()
  else panel.value?.focus({ preventScroll: true })
})

watch(() => props.coachQuery, () => nextTick(fitInput))

// Once the card the learner just acted on is settled (receipt or gone) they are
// back to asking; a failed save keeps the card open and the card manages focus.
watch(() => props.coachMemoryCards, (cards) => {
  const id = cardActionId.value
  if (!id) return
  const card = cards[id]
  if (card?.busy) return
  cardActionId.value = ''
  if (!card || card.state === 'confirmed') focusInput()
})

// Disabling a button that holds focus (a chip, send) drops focus to the page;
// once the reply lands, hand it back to the box.
watch(() => props.coachLoading, (loading, wasLoading) => {
  if (!wasLoading || loading || !props.readingCoachOpen) return
  const active = document.activeElement
  if (!active || active === document.body) focusInput()
})
</script>
