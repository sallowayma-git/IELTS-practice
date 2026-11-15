<template>
  <section class="listening-review" data-listening-review>
    <section
      v-for="group in groups"
      :key="group.groupId"
      class="listening-review__group"
    >
      <header class="listening-review__head">
        <h2 class="listening-review__title">
          {{ sectionLabel(group.section) }} · {{ kindLabel(group.kind) }}
        </h2>
        <p class="listening-review__range">{{ rangeLabel(group) }}</p>
      </header>
      <div v-if="group.leadHtml" class="listening-review__lead" v-html="group.leadHtml"></div>

      <article
        v-for="questionId in group.questionIds || []"
        :key="questionId"
        class="listening-review__row"
        :class="verdictClass(questionId)"
        :data-review-question-id="questionId"
      >
        <div class="listening-review__row-head">
          <p class="listening-review__question">第 {{ displayLabel(questionId) }} 题</p>
          <span class="listening-review__verdict">{{ verdictLabel(questionId) }}</span>
        </div>
        <dl class="listening-review__answers">
          <div>
            <dt>你的答案</dt>
            <dd>{{ formatAnswer(rowFor(questionId)?.userAnswer) || '未作答' }}</dd>
          </div>
          <div>
            <dt>正确答案</dt>
            <dd>{{ formatAnswer(answerKeyFor(questionId)) || '—' }}</dd>
          </div>
        </dl>
        <p v-if="explanationFor(questionId)" class="listening-review__explanation">
          {{ explanationFor(questionId) }}
        </p>
      </article>
    </section>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import {
  formatAnswerValue,
  listeningKindLabel,
  sectionLabel
} from '../listeningTags.js'
import { normalizeQuestionId } from '@/modules/practice-reading/readingQuestionIds'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  rows: { type: Array, default: () => [] },
  answerKey: { type: Object, default: () => ({}) },
  explanations: { type: Object, default: () => ({}) },
  displayMap: { type: Object, default: () => ({}) }
})

const rowsByQuestion = computed(() => {
  const map = {}
  for (const row of props.rows || []) {
    const questionId = normalizeQuestionId(row?.questionId)
    if (questionId) map[questionId] = row
  }
  return map
})

const answerKeyByQuestion = computed(() => {
  const map = {}
  for (const [rawKey, value] of Object.entries(props.answerKey || {})) {
    const questionId = normalizeQuestionId(rawKey)
    if (questionId) map[questionId] = value
  }
  return map
})

function rowFor(questionId) {
  return rowsByQuestion.value[normalizeQuestionId(questionId)] || null
}

function answerKeyFor(questionId) {
  return answerKeyByQuestion.value[normalizeQuestionId(questionId)]
}

function explanationFor(questionId) {
  return props.explanations?.[normalizeQuestionId(questionId)] || ''
}

function verdictLabel(questionId) {
  const isCorrect = rowFor(questionId)?.isCorrect
  if (isCorrect === true) return '正确'
  if (isCorrect === false) return '错误'
  return '未判定'
}

function verdictClass(questionId) {
  const isCorrect = rowFor(questionId)?.isCorrect
  if (isCorrect === true) return 'is-correct'
  if (isCorrect === false) return 'is-wrong'
  return ''
}

function displayLabel(questionId) {
  const normalized = normalizeQuestionId(questionId)
  return String(props.displayMap?.[normalized] || String(normalized).replace(/^q/i, ''))
}

function formatAnswer(value) {
  return formatAnswerValue(value)
}

function kindLabel(kind) {
  return listeningKindLabel(kind)
}

function rangeLabel(group) {
  const ids = Array.isArray(group?.questionIds) ? group.questionIds : []
  if (!ids.length) return ''
  const labels = ids.map(displayLabel).filter(Boolean)
  if (labels.length <= 1) return `第 ${labels[0] || ''} 题`
  return `第 ${labels[0]}-${labels[labels.length - 1]} 题`
}
</script>
