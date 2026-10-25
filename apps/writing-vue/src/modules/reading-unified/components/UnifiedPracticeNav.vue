<template>
  <!-- Bottom practice nav: mirrors .practice-nav of the unified page. Single
       practice fills the section matching the asset category; the other two
       keep their placeholder totals and render as inactive strips. -->
  <div class="practice-nav" data-unified-practice-nav>
    <section
      v-for="part in partSections"
      :key="part.key"
      class="part-nav-section"
      :class="{ active: part.key === activePartKey, 'is-placeholder': part.placeholder }"
      :aria-label="`Part ${part.index} questions`"
    >
      <div class="part-nav-info">
        <div class="part-nav-name" :class="{ inactive: !part.placeholder && part.key !== activePartKey }">Part {{ part.index }}</div>
        <div class="part-nav-status">{{ part.answeredCount }} of {{ part.total }}</div>
      </div>
      <div v-if="!part.placeholder" class="part-nav-questions">
        <div
          v-for="question in part.questions"
          :key="question.questionId"
          class="q-column"
          :data-question-id="question.questionId"
          :data-part="part.key"
        >
          <div class="q-bar-segment" :class="question.status"></div>
          <button
            type="button"
            class="q-item"
            :class="[question.status, { active: question.questionId === activeQuestionId }]"
            :title="`第 ${question.label} 题`"
            @click="$emit('scroll-to-question', question.questionId)"
          >{{ question.label }}</button>
        </div>
      </div>
    </section>
    <div class="nav-controls-right">
      <button
        v-if="reviewMode"
        id="exit-btn"
        type="button"
        @click="$emit('leave')"
      >Exit</button>
      <button
        v-if="reviewMode"
        id="reset-btn"
        type="button"
        :disabled="resetDisabled"
        @click="$emit('reset')"
      >Reset</button>
      <button
        id="submit-btn"
        type="button"
        title="Submit"
        aria-label="Submit"
        :disabled="submitDisabled"
        :class="{ 'is-submitted': reviewMode }"
        @click="$emit('submit')"
      >
        <svg class="submit-btn-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  questionOrder: { type: Array, default: () => [] },
  displayMap: { type: Object, default: () => ({}) },
  category: { type: String, default: 'P1' },
  hasAnswer: { type: Function, required: true },
  answerComparison: { type: Object, default: null },
  activeQuestionId: { type: String, default: '' },
  reviewMode: { type: Boolean, default: false },
  submitDisabled: { type: Boolean, default: false },
  resetDisabled: { type: Boolean, default: false }
})

defineEmits(['scroll-to-question', 'submit', 'reset', 'leave'])

const PART_KEYS = ['p1', 'p2', 'p3']
const PART_TOTALS = { p1: 13, p2: 13, p3: 14 }

function partKeyFromCategory(category) {
  const normalized = String(category || '').toUpperCase()
  if (normalized === 'P2') return 'p2'
  if (normalized === 'P3') return 'p3'
  return 'p1'
}

function comparisonStatus(comparison, questionId, answered) {
  const entry = comparison?.[questionId]
  if (!entry) return answered ? 'answered' : ''
  if (entry.isCorrect === true) return 'correct'
  if (entry.isCorrect === false) {
    const partial = Number(entry.partialCorrectCount) || 0
    const weight = Number(entry.weight) || 1
    return partial > 0 && weight > 1 ? 'partial' : 'incorrect'
  }
  return 'unknown'
}

const activePartKey = computed(() => partKeyFromCategory(props.category))

const partSections = computed(() => (
  PART_KEYS.map((key, sectionIndex) => {
    const placeholder = key !== activePartKey.value
    if (placeholder) {
      return {
        key,
        index: sectionIndex + 1,
        placeholder: true,
        answeredCount: 0,
        total: PART_TOTALS[key],
        questions: []
      }
    }
    const questions = props.questionOrder.map((questionId) => {
      const answered = Boolean(props.hasAnswer(questionId))
      return {
        questionId,
        label: props.displayMap[questionId] || String(questionId).replace(/^q/i, ''),
        status: props.reviewMode
          ? comparisonStatus(props.answerComparison, questionId, answered)
          : (answered ? 'answered' : '')
      }
    })
    return {
      key,
      index: sectionIndex + 1,
      placeholder: false,
      answeredCount: questions.filter((question) => question.status && question.status !== 'unknown').length,
      total: questions.length,
      questions
    }
  })
))
</script>
