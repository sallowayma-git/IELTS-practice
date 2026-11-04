<template>
  <!-- Mark-for-review flag beside a question number in the bottom nav. The nav
       mounts it only while the number is hovered/focused or marked, so an idle
       nav carries no extra DOM. Read-only (review/replay) keeps a marked flag
       visible but inert: a plain image, not a control. -->
  <component
    :is="readOnly ? 'span' : 'button'"
    class="q-flag"
    :class="{ 'is-marked': marked || readOnly, 'is-static': readOnly }"
    v-bind="attrs"
    data-question-flag
    @click="!readOnly && $emit('toggle')"
  >
    <svg class="q-flag-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3.5 1.5v13" /><path class="q-flag-cloth" d="M3.5 2.5c2.2-1.4 3.6 1.2 5.6 0.2 1.6-0.8 2.7-0.7 3.9 0v5.4c-1.2-0.7-2.3-0.8-3.9 0-2 1-3.4-1.6-5.6-0.2z" /></svg>
  </component>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Display number of the question ("5", not "q5").
  label: { type: String, required: true },
  marked: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false }
})

defineEmits(['toggle'])

const attrs = computed(() => {
  if (props.readOnly) {
    const text = `第 ${props.label} 题已标记`
    return { role: 'img', 'aria-label': text, title: text }
  }
  const text = props.marked ? `取消标记第 ${props.label} 题` : `标记第 ${props.label} 题`
  return { type: 'button', 'aria-pressed': props.marked ? 'true' : 'false', 'aria-label': text, title: text }
})
</script>
