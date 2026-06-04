<template>
  <section id="right" class="pane reading-pane question-panel" @input="$emit('question-input', $event)" @change="$emit('question-input', $event)">
    <div id="question-groups">
      <article
        v-for="group in payload.questionGroups"
        :key="group.groupId"
        class="unified-group question-group"
        :data-group-id="group.groupId"
        :data-question-group-id="group.groupId"
        :data-question-ids="(group.questionIds || []).join(',')"
        :data-group-kind="group.kind"
        :data-allow-option-reuse="group.allowOptionReuse === true ? 'true' : null"
      >
        <div v-if="group.leadHtml" class="reading-html unified-group__lead group-lead" v-html="group.leadHtml" />
        <div class="reading-html group-body" v-html="group.bodyHtml" />
        <section
          v-if="getGroupOfficialExplanations(group).length"
          class="reading-question-explanation-list"
          data-reading-official-explanations
        >
          <h5>{{ getGroupRange(group) }} 官方解析</h5>
          <article
            v-for="section in getGroupOfficialExplanations(group)"
            :key="group.groupId + ':' + section.sectionTitle"
            class="reading-explanation-section"
          >
            <div
              v-if="section.text && !section.items.length"
              class="reading-explanation-card reading-group-explanation"
            >
              <div class="reading-explanation-card__label">{{ section.sectionTitle }}</div>
              <div class="reading-explanation-card__text">{{ section.text }}</div>
            </div>
            <template v-else>
              <div
                v-for="item in section.items"
                :key="section.sectionTitle + ':' + item.questionNumber"
                class="reading-explanation-card reading-question-explanation-item"
                :data-reading-official-question-explanation="normalizeQuestionId(item.questionId || item.questionNumber)"
              >
                <div class="reading-explanation-card__label">Q{{ item.questionNumber }} 讲解</div>
                <div class="reading-explanation-card__text">{{ item.text }}</div>
              </div>
            </template>
          </article>
        </section>
      </article>
    </div>

    <section v-if="isMemorizeMode" class="reading-panel memorize-panel" data-reading-memorize-panel>
      <div class="panel-heading">
        <span class="panel-kicker">Memorize</span>
        <strong>背题模式 · {{ payload.questionCount }} 题</strong>
      </div>
      <div class="memorize-answer-grid">
        <div
          v-for="questionId in payload.questionOrder"
          :key="questionId"
          class="memorize-answer-card"
          :data-memorize-answer-question-id="questionId"
        >
          <span>{{ getDisplayLabel(questionId) }}</span>
          <strong>{{ formatReviewAnswer(payload.answerKey?.[questionId]) || '未提供' }}</strong>
        </div>
      </div>
    </section>

    <slot />
  </section>
</template>

<script setup>
defineProps({
  payload: { type: Object, required: true },
  isMemorizeMode: { type: Boolean, default: false },
  getGroupOfficialExplanations: { type: Function, required: true },
  getGroupRange: { type: Function, required: true },
  normalizeQuestionId: { type: Function, required: true },
  getDisplayLabel: { type: Function, required: true },
  formatReviewAnswer: { type: Function, required: true }
})

defineEmits(['question-input'])
</script>
