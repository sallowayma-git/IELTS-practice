<template>
  <section id="history-filter-panel" class="card history-filters" aria-label="筛选">
    <div class="field">
      <label class="field-label" for="history-start-date">日期范围</label>
      <div class="history-filters__range">
        <input id="history-start-date" v-model="startDate" type="date" class="input" :max="endDate || today" aria-label="开始日期" />
        <span class="t-small">至</span>
        <input id="history-end-date" v-model="endDate" type="date" class="input" :min="startDate" :max="today" aria-label="结束日期" />
      </div>
    </div>

    <div class="field">
      <label class="field-label" for="history-min-score">{{ score?.label ?? '分数范围' }}</label>
      <div class="history-filters__range">
        <input
          id="history-min-score"
          v-model="minScore"
          type="number"
          class="input"
          :min="bounds.min"
          :max="bounds.max"
          :step="bounds.step"
          :disabled="!score"
          :placeholder="score ? `最低${score.unit}` : '先选择阅读或写作'"
          aria-label="最低分数"
        />
        <span class="t-small">至</span>
        <input
          id="history-max-score"
          v-model="maxScore"
          type="number"
          class="input"
          :min="bounds.min"
          :max="bounds.max"
          :step="bounds.step"
          :disabled="!score"
          :placeholder="score ? `最高${score.unit}` : '先选择阅读或写作'"
          aria-label="最高分数"
        />
      </div>
      <p v-if="!score" class="field-help">阅读与写作的分数不是同一把尺子，请先选择一个标签再按分数筛选。</p>
    </div>

    <div v-if="kinds.length > 0" class="field history-filters__kinds">
      <span id="history-kind-label" class="field-label">题型</span>
      <div class="segmented toggle-group history-kinds" role="group" aria-labelledby="history-kind-label">
        <button
          v-for="option in kindOptions"
          :key="option.value || 'all'"
          type="button"
          class="segmented-item toggle-item"
          :aria-pressed="kind === option.value ? 'true' : 'false'"
          :data-history-kind="option.value || 'all'"
          @click="kind = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const startDate = defineModel('startDate', { type: String, default: '' })
const endDate = defineModel('endDate', { type: String, default: '' })
const minScore = defineModel('minScore', { default: '' })
const maxScore = defineModel('maxScore', { default: '' })
const kind = defineModel('kind', { type: String, default: '' })

const props = defineProps({
  /** The active activity's ACTIVITIES[..].score, or null (mixed tab). */
  score: { type: Object, default: null },
  /** The active activity's ACTIVITIES[..].kinds. */
  kinds: { type: Array, default: () => [] }
})

const today = new Date().toISOString().split('T')[0]
const bounds = computed(() => props.score ?? { min: 0, max: 9, step: 0.5 })
const kindOptions = computed(() => [{ value: '', label: '全部题型' }, ...props.kinds])
</script>

<style scoped>
.history-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--anth-space-4) var(--anth-space-6);
}

.history-filters__range {
  display: flex;
  align-items: center;
  gap: var(--anth-space-3);
}

.history-filters__range > .input {
  flex: 1 1 0;
}

.history-filters__range > .t-small {
  flex: 0 0 auto;
  color: var(--anth-ink-muted);
}

.history-filters__kinds {
  grid-column: 1 / -1;
}

@media (max-width: 640px) {
  .history-filters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
