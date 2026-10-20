<template>
  <div class="history-list">
    <section v-for="group in groups" :key="group.key" class="history-day" :data-history-day="group.key">
      <h2 class="list-group-title history-day__title">{{ group.label }}</h2>
      <div class="history-day__grid">
        <HistoryRecordCard
          v-for="record in group.records"
          :key="record.id"
          :record="record"
          :selecting="selecting"
          :selected="selected.has(record.id)"
          @open="emit('open', $event)"
          @toggle="emit('toggle', $event)"
        />
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { groupByDay } from '../records.js'
import HistoryRecordCard from './HistoryRecordCard.vue'

const props = defineProps({
  records: { type: Array, required: true },
  selecting: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] }
})
const emit = defineEmits(['open', 'toggle'])

const groups = computed(() => groupByDay(props.records))
const selected = computed(() => new Set(props.selectedIds))
</script>

<style scoped>
.history-list {
  display: grid;
  gap: var(--anth-space-6);
  min-width: 0;
}

.history-day {
  display: grid;
  gap: var(--anth-space-3);
  min-width: 0;
}

/* Day heading: a quiet caption, not the sticky list band it was before. */
.atlas-paper .history-day__title {
  position: static;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-small-size);
  font-weight: var(--anth-weight-semibold);
  letter-spacing: 0;
  line-height: var(--anth-text-small-line);
  text-transform: none;
}

.history-day__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  gap: var(--anth-space-4);
  min-width: 0;
}
</style>
