<template>
  <div
    id="question-groups"
    class="listening-question-pane"
    data-listening-question-groups
    @input="$emit('question-input', $event)"
    @change="$emit('question-input', $event)"
  >
    <article
      v-for="group in groups"
      :key="group.groupId"
      class="listening-group unified-group"
      :data-group-id="group.groupId"
      :data-question-group-id="group.groupId"
      :data-question-ids="(group.questionIds || []).join(',')"
      :data-group-kind="group.kind"
    >
      <header v-if="!hasQuestionRange(group)" class="listening-group__head">
        <p class="listening-group__range">{{ rangeLabel(group) }}</p>
        <p class="listening-group__kind">{{ kindLabel(group.kind) }}</p>
      </header>
      <div
        v-if="group.leadHtml"
        class="listening-group__lead"
        v-html="group.leadHtml"
      ></div>
      <div class="listening-group__body group-body" v-html="group.bodyHtml"></div>
    </article>
  </div>
</template>

<script setup>
import { listeningKindLabel, sectionLabel } from '../listeningTags.js'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  displayMap: { type: Object, default: () => ({}) }
})

defineEmits(['question-input'])

function displayLabel(questionId) {
  return String(props.displayMap?.[questionId] || String(questionId || '').replace(/^q/i, ''))
}

function hasQuestionRange(group) {
  return /\bQuestions?\s+\d/i.test(String(group.leadHtml || '').replace(/<[^>]*>/g, ' '))
}

function rangeLabel(group) {
  const ids = Array.isArray(group?.questionIds) ? group.questionIds : []
  if (!ids.length) return sectionLabel(group?.section)
  const labels = ids.map(displayLabel).filter(Boolean)
  if (labels.length <= 1) return `Question ${labels[0] || ''}`
  return `Questions ${labels[0]}–${labels[labels.length - 1]}`
}

function kindLabel(kind) {
  return listeningKindLabel(kind)
}
</script>
