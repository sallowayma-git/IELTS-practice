<template>
  <section id="history-filter-panel" class="history-filters" aria-label="筛选">
    <div class="history-filters__field">
      <label for="history-start-date">日期范围</label>
      <div class="history-filters__range">
        <input id="history-start-date" v-model="startDate" type="date" :max="endDate || today" aria-label="开始日期" />
        <span>至</span>
        <input id="history-end-date" v-model="endDate" type="date" :min="startDate" :max="today" aria-label="结束日期" />
      </div>
    </div>

    <div class="history-filters__field">
      <label for="history-min-score">{{ score?.label ?? '分数范围' }}</label>
      <div class="history-filters__range">
        <input
          id="history-min-score"
          v-model="minScore"
          type="number"
          :min="bounds.min"
          :max="bounds.max"
          :step="bounds.step"
          :disabled="!score"
          :placeholder="score ? `最低${score.unit}` : '先选择阅读或写作'"
          aria-label="最低分数"
        />
        <span>至</span>
        <input
          id="history-max-score"
          v-model="maxScore"
          type="number"
          :min="bounds.min"
          :max="bounds.max"
          :step="bounds.step"
          :disabled="!score"
          :placeholder="score ? `最高${score.unit}` : '先选择阅读或写作'"
          aria-label="最高分数"
        />
      </div>
      <p v-if="!score" class="history-filters__hint">阅读与写作的分数不是同一把尺子，请先选择一个标签再按分数筛选。</p>
    </div>

    <div v-if="kinds.length > 0" class="history-filters__field history-filters__field--wide">
      <span class="history-filters__label" id="history-kind-label">题型</span>
      <div class="toggle-group history-kinds" role="group" aria-labelledby="history-kind-label">
        <button
          v-for="option in kindOptions"
          :key="option.value || 'all'"
          type="button"
          class="toggle-item"
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
  gap: 16px 40px;
  padding: 16px 0 18px;
  border-top: 1px solid var(--anth-rule);
  border-bottom: 1px solid var(--anth-rule);
}

.history-filters__field {
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
}

.history-filters__field--wide {
  grid-column: 1 / -1;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 4px 24px;
}

.history-filters__field > label,
.history-filters__label {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.history-filters__range {
  display: flex;
  align-items: center;
  gap: 10px;
}

.history-filters__range > input {
  flex: 1 1 0;
  min-width: 0;
  min-height: 40px;
}

.history-filters__range > span {
  flex: 0 0 auto;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
}

.history-filters__hint {
  margin: 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
  line-height: 1.5;
}

.history-kinds .toggle-item {
  min-height: 36px;
}

@media (max-width: 640px) {
  .history-filters {
    grid-template-columns: minmax(0, 1fr);
  }

  .history-filters__range > input,
  .history-kinds .toggle-item {
    min-height: 44px;
  }

  .history-filters__field--wide {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
