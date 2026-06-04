<template>
  <template v-if="submission">
    <button
      id="reading-coach-fab"
      class="reading-coach-fab"
      type="button"
      data-reading-coach-fab
      @click="$emit('toggle-panel')"
    >
      AI 教练
    </button>
    <section
      id="reading-coach-panel"
      class="reading-coach-panel"
      :class="{ 'is-open': readingCoachOpen }"
      data-reading-coach-panel
    >
      <header class="reading-coach-panel__header">
        <span class="reading-coach-panel__title">Reading AI Coach V2</span>
        <button
          id="reading-coach-close"
          class="reading-coach-panel__close"
          type="button"
          aria-label="关闭"
          @click="$emit('update:reading-coach-open', false)"
        >
          ×
        </button>
      </header>
      <div
        id="reading-coach-status"
        class="reading-coach-panel__status"
        :class="{ 'is-error': Boolean(coachError), 'is-loading': coachLoading }"
        data-reading-coach-stream-status
      >
        {{ coachStatusText }}
      </div>
      <div v-if="selectedContext" class="reading-coach-panel__selected-context" data-reading-coach-selected-context>
        <span>{{ selectedContext.scope === 'question' ? '已选题目' : '已选原文' }}</span>
        <strong>{{ selectedContext.text }}</strong>
        <button class="btn-text" type="button" @click="$emit('clear-selected-context')">清除</button>
      </div>
      <div
        id="reading-coach-messages"
        class="reading-coach-panel__messages"
        data-reading-coach-transcript
      >
        <div v-if="!coachTranscript.length" class="reading-coach-msg assistant">
          你可以先问：这题怎么定位证据？
        </div>
        <div
          v-for="entry in coachTranscript"
          :key="entry.id"
          class="reading-coach-msg"
          :class="[entry.role, { error: entry.isError }]"
          :data-reading-coach-message="entry.role"
        >
          {{ entry.content }}
        </div>
        <div v-if="coachResponse" class="reading-coach-msg assistant coach-response" data-reading-coach-answer>
          {{ coachResponse.answer || coachResponse.message || '教练已返回结果。' }}
        </div>
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
        <input
          id="reading-coach-input"
          :value="coachQuery"
          class="reading-coach-panel__input"
          type="text"
          placeholder="问我：这题如何定位证据？"
          :disabled="coachLoading"
          @input="$emit('update:coach-query', $event.target.value)"
          @focus="$emit('refresh-selected-context')"
          @keydown.enter.prevent="$emit('ask')"
        />
        <button
          id="reading-coach-send"
          class="reading-coach-panel__send"
          type="button"
          :disabled="!canAskCoach"
          @click="$emit('ask')"
        >
          {{ coachLoading ? '分析中...' : '询问教练' }}
        </button>
      </div>
      <p v-if="coachError" class="reading-coach-panel__error">{{ coachError }}</p>
    </section>
  </template>
</template>

<script setup>
defineProps({
  submission: { type: Object, default: null },
  readingCoachOpen: { type: Boolean, default: false },
  coachError: { type: String, default: '' },
  coachLoading: { type: Boolean, default: false },
  coachStatusText: { type: String, default: '' },
  selectedContext: { type: Object, default: null },
  coachTranscript: { type: Array, default: () => [] },
  coachResponse: { type: Object, default: null },
  coachQuickActions: { type: Array, default: () => [] },
  coachSelectionActions: { type: Array, default: () => [] },
  coachFollowUps: { type: Array, default: () => [] },
  coachQuery: { type: String, default: '' },
  canAskCoach: { type: Boolean, default: false }
})

defineEmits([
  'toggle-panel',
  'update:reading-coach-open',
  'clear-selected-context',
  'quick-action',
  'selection-action',
  'follow-up',
  'update:coach-query',
  'refresh-selected-context',
  'ask'
])
</script>
