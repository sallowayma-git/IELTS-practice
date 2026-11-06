<template>
  <div
    class="reading-coach-card"
    role="group"
    aria-label="学习偏好确认"
    data-reading-coach-card
    :data-reading-coach-card-message-id="card.messageId"
    :data-reading-coach-card-state="card.state"
  >
    <template v-if="card.state === 'pending'">
      <label class="reading-coach-card__title" :for="inputId">要记住这个学习偏好吗？</label>
      <textarea
        :id="inputId"
        ref="field"
        v-model="draft"
        class="reading-coach-card__input"
        rows="2"
        :maxlength="limit"
        :readonly="card.busy"
        :aria-describedby="countId"
        :aria-invalid="overLimit || empty ? 'true' : undefined"
        data-reading-coach-card-input
      />
      <div class="reading-coach-card__foot">
        <span
          :id="countId"
          class="reading-coach-card__count"
          :class="{ 'is-over': overLimit }"
          data-reading-coach-card-count
        >{{ length }}/{{ limit }}</span>
        <button
          ref="confirmButton"
          class="reading-coach-chip reading-coach-card__confirm"
          type="button"
          :disabled="card.busy || empty || overLimit"
          data-reading-coach-card-confirm
          @click="$emit('confirm', { messageId: card.messageId, text: draft })"
        >
          记住
        </button>
        <button
          class="reading-coach-chip"
          type="button"
          :disabled="card.busy"
          data-reading-coach-card-dismiss
          @click="$emit('dismiss', { messageId: card.messageId })"
        >
          忽略
        </button>
      </div>
    </template>
    <p
      class="reading-coach-card__status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-reading-coach-card-status
    ><template v-if="card.state === 'confirmed'">已记住{{ card.savedText ? `：${card.savedText}` : '这条学习偏好' }}<span class="reading-coach-card__hint">　可在记忆中心查看或修改</span></template><template v-else-if="card.busy">正在保存…</template></p>
    <p v-if="card.error" class="reading-coach-card__error" role="alert" data-reading-coach-card-error>{{ card.error }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { MEMORY_CARD_TEXT_LIMIT } from '../useReadingCoach'

const props = defineProps({
  card: { type: Object, required: true }
})

defineEmits(['confirm', 'dismiss'])

// Message ids are unique, so they make the label/description ids unique too.
const uid = `reading-coach-card-${props.card.messageId.replace(/[^\w-]/g, '')}`
const inputId = `${uid}-input`
const countId = `${uid}-count`
const limit = MEMORY_CARD_TEXT_LIMIT

// The learner's wording lives here, apart from the composer's draft: editing a
// card never touches a question they are in the middle of typing.
const draft = ref(props.card.text)
const field = ref(null)
const confirmButton = ref(null)

const length = computed(() => [...draft.value].length)
const empty = computed(() => !draft.value.trim())
const overLimit = computed(() => length.value > limit)

// A request that fails leaves the card open; the disabled button dropped
// focus, so hand it back to the action the learner just tried.
watch(() => props.card.busy, async (busy, wasBusy) => {
  if (busy || !wasBusy || props.card.state !== 'pending' || !props.card.error) return
  await nextTick()
  confirmButton.value?.focus({ preventScroll: true })
})
</script>
