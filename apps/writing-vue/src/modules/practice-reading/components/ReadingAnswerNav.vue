<template>
  <nav
    v-if="asset && payload"
    class="practice-nav answer-panel"
    data-reading-answer-nav
  >
    <div class="title">题目导航</div>

    <div class="questions answer-list" id="question-nav">
      <div
        v-for="questionId in payload.questionOrder"
        :key="questionId"
        class="question-nav-entry"
        :class="[
          { answered: hasAnswer(questionId), marked: isMarkedQuestion(questionId) },
          getReviewClass(questionId),
          getLegacyNavStatus(questionId),
          { active: isActiveQuestion(questionId) }
        ]"
        :data-answer-question-id="questionId"
        :data-question-id="questionId"
      >
        <button
          type="button"
          class="q-item answer-item"
          :class="[
            { answered: hasAnswer(questionId), marked: isMarkedQuestion(questionId) },
            getReviewClass(questionId),
            getLegacyNavStatus(questionId),
            { active: isActiveQuestion(questionId) }
          ]"
          :data-question-id="questionId"
          @click="$emit('scroll-to-question', questionId)"
        >
          {{ getDisplayLabel(questionId) }}
        </button>
        <button
          type="button"
          class="mark-question-button"
          :class="{ active: isMarkedQuestion(questionId) }"
          :disabled="readOnlyMode"
          :aria-label="`第 ${getDisplayLabel(questionId)} 题${isMarkedQuestion(questionId) ? '取消标记' : '标记'}`"
          @click.stop="$emit('toggle-marked-question', questionId)"
        >
          !
        </button>
      </div>
    </div>

    <div class="controls answer-actions">
      <div v-if="suiteSession" class="suite-progress-mini" data-reading-suite-progress-mini>
        <div>
          <span>套题</span>
          <strong>{{ suiteSession.aggregate.submittedPassages }}/{{ suiteSession.aggregate.totalPassages }} · {{ suiteSession.aggregate.percentage }}%</strong>
        </div>
      </div>
      <span class="reading-stat reading-progress" data-reading-answer-progress>
        已作答 {{ answeredCount }}/{{ payload.questionCount }}
      </span>
      <router-link v-slot="{ href }" :to="returnRoute" custom>
        <a
          id="exit-btn"
          class="header-btn"
          :href="href"
          :aria-disabled="leaving ? 'true' : undefined"
          :tabindex="leaving ? -1 : undefined"
          @click="handleLeave"
        >{{ leaving ? '退出中…' : returnLabel }}</a>
      </router-link>
      <button id="reset-btn" class="header-btn" type="button" :disabled="resetButtonDisabled" @click="$emit('reset')">{{ resetButtonLabel }}</button>
      <button class="header-btn" type="button" :disabled="!canSnapshot" @click="$emit('snapshot')">保存作答快照</button>
      <button id="submit-btn" class="submit-btn primary" type="button" :disabled="primaryButtonDisabled" @click="$emit('primary')">
        {{ primaryButtonLabel }}
      </button>
    </div>

  </nav>
</template>

<script setup>
const props = defineProps({
  asset: { type: Object, default: null },
  payload: { type: Object, default: null },
  suiteSession: { type: Object, default: null },
  answeredCount: { type: Number, default: 0 },
  returnRoute: { type: [Object, String], required: true },
  returnLabel: { type: String, required: true },
  resetButtonDisabled: { type: Boolean, default: false },
  resetButtonLabel: { type: String, required: true },
  primaryButtonDisabled: { type: Boolean, default: false },
  primaryButtonLabel: { type: String, required: true },
  loading: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  leaving: { type: Boolean, default: false },
  readOnlyMode: { type: Boolean, default: false },
  canSnapshot: { type: Boolean, default: false },
  hasAnswer: { type: Function, required: true },
  isMarkedQuestion: { type: Function, required: true },
  getReviewClass: { type: Function, required: true },
  getLegacyNavStatus: { type: Function, required: true },
  isActiveQuestion: { type: Function, required: true },
  getDisplayLabel: { type: Function, required: true }
})

const emit = defineEmits([
  'scroll-to-question',
  'toggle-marked-question',
  'leave',
  'reset',
  'snapshot',
  'primary'
])

function handleLeave(event) {
  event.preventDefault()
  if (props.leaving) return
  emit('leave')
}
</script>
