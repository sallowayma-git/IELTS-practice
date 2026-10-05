<template>
  <div class="history-list">
    <section v-for="group in groups" :key="group.key" class="history-day" :data-history-day="group.key">
      <h2 class="history-day__head">{{ group.label }}</h2>
      <ul class="history-day__rows">
        <li v-for="record in group.records" :key="record.id" class="history-item">
          <div
            class="history-row"
            :class="{ 'is-selecting': selecting, 'is-selected': isSelected(record.id) }"
            :data-history-id="record.id"
            :data-history-activity="record.activity"
            :role="selecting ? 'checkbox' : 'link'"
            :aria-checked="selecting ? String(isSelected(record.id)) : undefined"
            :aria-label="selecting ? `选择历史记录：${record.title}` : undefined"
            tabindex="0"
            @click="activate(record)"
            @keydown.enter.prevent="activate(record)"
            @keydown.space.prevent="activate(record)"
          >
            <span v-if="selecting" class="history-row__box" aria-hidden="true"></span>

            <span class="history-row__main">
              <span class="history-row__title">{{ record.title }}</span>
              <span class="history-row__meta">
                <span class="history-row__kind" :class="record.kind">{{ activityLabel(record.activity) }}</span>
                <span v-if="recordMetaLine(record)">· {{ recordMetaLine(record) }}</span>
              </span>
            </span>

            <span class="history-row__score">
              <strong>{{ record.score.display }}</strong>
              <span>{{ record.score.label }}</span>
            </span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { activityLabel, groupByDay, recordMetaLine } from '../records.js'

const props = defineProps({
  records: { type: Array, required: true },
  selecting: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] }
})
const emit = defineEmits(['open', 'toggle'])

const groups = computed(() => groupByDay(props.records))
const selected = computed(() => new Set(props.selectedIds))

const isSelected = (id) => selected.value.has(id)

function activate(record) {
  emit(props.selecting ? 'toggle' : 'open', props.selecting ? record.id : record)
}
</script>

<style scoped>
.history-list {
  border-top: 1.5px solid var(--anth-rule-heavy);
  border-bottom: 1.5px solid var(--anth-rule-heavy);
}

.history-day + .history-day {
  border-top: 1px solid var(--anth-rule);
}

.history-day__head {
  margin: 0;
  padding: 12px 0 0;
  color: var(--anth-ink-faint);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-xs);
  font-weight: var(--anth-weight-normal);
  line-height: var(--anth-leading-snug);
}

.history-day__rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 44px;
  padding: 6px 4px 6px 0;
  border-bottom: 1px solid var(--anth-border-subtle);
  cursor: pointer;
}

.history-item:last-child > .history-row {
  border-bottom: 0;
}

.history-row.is-selecting {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.history-row:hover {
  background: var(--anth-surface-hover);
}

.history-row.is-selected {
  background: var(--anth-accent-softer);
}

/* A drawn box, not a control: the row itself is the checkbox. */
.history-row__box {
  position: relative;
  width: 16px;
  height: 16px;
  border: 1px solid var(--anth-ink-soft);
  border-radius: var(--anth-radius-sm);
  background: var(--anth-canvas);
}

.is-selected .history-row__box {
  border-color: var(--anth-ink);
  background: var(--anth-ink);
}

.is-selected .history-row__box::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 0;
  width: 4px;
  height: 9px;
  border: solid var(--anth-canvas);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(40deg);
}

.history-row__main {
  display: grid;
  gap: 0;
  min-width: 0;
}

.history-row__kind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--anth-ink-soft);
}

.history-row__kind::before {
  content: '';
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  background: var(--anth-ink);
}

.history-row__kind.reading::before { background: var(--anth-success); }
.history-row__kind.task1::before { background: var(--anth-info); }
.history-row__kind.task2::before { background: var(--anth-accent); }
.history-row__kind.unlabeled::before {
  border: 1px solid var(--anth-ink-faint);
  background: transparent;
}

.history-row__title {
  overflow-wrap: anywhere;
  color: var(--anth-ink-strong);
  font-size: var(--anth-text-base);
  font-weight: var(--anth-weight-medium);
  line-height: var(--anth-leading-snug);
}

.history-row:hover .history-row__title {
  text-decoration: underline;
  text-decoration-color: var(--anth-border-strong);
  text-underline-offset: 3px;
}

.history-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 6px;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
  line-height: 1.5;
  font-variant-numeric: lining-nums tabular-nums;
}

.history-row__score {
  display: grid;
  justify-items: end;
  min-width: 3.5rem;
  line-height: 1.3;
  font-variant-numeric: lining-nums tabular-nums;
}

.history-row__score strong {
  color: var(--anth-ink-strong);
  font-size: 1.0625rem;
  font-weight: var(--anth-weight-semibold);
  line-height: 1.2;
}

.history-row__score span {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
}

@media (max-width: 640px) {
  .history-row {
    padding: 9px 2px 9px 0;
  }
}
</style>
