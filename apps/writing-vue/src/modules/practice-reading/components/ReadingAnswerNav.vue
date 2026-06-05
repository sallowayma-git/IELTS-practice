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
          :aria-label="`${isMarkedQuestion(questionId) ? '取消标记' : '标记'} Question ${getDisplayLabel(questionId)}`"
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
        {{ answeredCount }}/{{ payload.questionCount }}
      </span>
      <router-link id="exit-btn" class="header-btn" :to="returnRoute">{{ returnLabel }}</router-link>
      <button id="reset-btn" class="header-btn" type="button" :disabled="resetButtonDisabled" @click="$emit('reset')">{{ resetButtonLabel }}</button>
      <button class="header-btn" type="button" :disabled="!asset || loading || submitting" @click="$emit('snapshot')">保存作答快照</button>
      <button id="submit-btn" class="submit-btn primary" type="button" :disabled="primaryButtonDisabled" @click="$emit('primary')">
        {{ primaryButtonLabel }}
      </button>
    </div>

    <p v-if="snapshotMessage" class="snapshot-message">{{ snapshotMessage }}</p>
  </nav>
</template>

<script setup>
defineProps({
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
  readOnlyMode: { type: Boolean, default: false },
  snapshotMessage: { type: String, default: '' },
  hasAnswer: { type: Function, required: true },
  isMarkedQuestion: { type: Function, required: true },
  getReviewClass: { type: Function, required: true },
  getLegacyNavStatus: { type: Function, required: true },
  isActiveQuestion: { type: Function, required: true },
  getDisplayLabel: { type: Function, required: true }
})

defineEmits([
  'scroll-to-question',
  'toggle-marked-question',
  'reset',
  'snapshot',
  'primary'
])
</script>
