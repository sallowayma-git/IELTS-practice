<template>
  <div class="list history-list">
    <section v-for="group in groups" :key="group.key" class="history-day" :data-history-day="group.key">
      <h2 class="list-group-title history-day__title">{{ group.label }}</h2>
      <div class="history-day__rows">
        <div
          v-for="record in group.records"
          :key="record.id"
          class="list-row history-row"
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
          <span v-if="selecting" class="list-row-lead">
            <input class="history-row__check" type="checkbox" tabindex="-1" aria-hidden="true" :checked="isSelected(record.id)" />
          </span>

          <span class="list-row-main history-row__main">
            <span class="list-row-title history-row__title">{{ record.title }}</span>
            <span class="list-row-meta">
              <span class="tag history-row__kind" :class="[record.kind, kindTone(record)]">{{ activityLabel(record.activity) }}</span>
              <span v-if="recordMetaLine(record)">{{ recordMetaLine(record) }}</span>
            </span>
          </span>

          <span class="list-row-trail history-row__score">
            <span class="tag tag-neutral t-num">{{ record.score.display }}</span>
            <span class="history-row__label">{{ record.score.label }}</span>
          </span>
        </div>
      </div>
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

const KIND_TONE = { reading: 'tag-success', task1: 'tag-info', task2: 'tag-accent' }
const kindTone = (record) => KIND_TONE[record.kind] || 'tag-neutral'

const groups = computed(() => groupByDay(props.records))
const selected = computed(() => new Set(props.selectedIds))

const isSelected = (id) => selected.value.has(id)

function activate(record) {
  emit(props.selecting ? 'toggle' : 'open', props.selecting ? record.id : record)
}
</script>

<style scoped>
/* Titles stick just below the sticky toolbar (its height is set by the page). */
.history-list .list-group-title {
  top: var(--history-toolbar-h, 0px);
}

/* A record title wraps instead of ellipsis: a long title must stay readable. */
.atlas-paper .history-row__title {
  overflow: visible;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* No lead column outside selection mode. */
.history-row:not(.is-selecting) {
  grid-template-columns: minmax(0, 1fr) auto;
}

/* The row is the checkbox; the input only draws the state. */
.history-row__check {
  pointer-events: none;
}

.history-row__label {
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}
</style>
