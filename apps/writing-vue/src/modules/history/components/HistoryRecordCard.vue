<template>
  <div
    class="card history-card history-row"
    :class="{ 'is-selecting': selecting, 'is-selected': selected }"
    :data-history-id="record.id"
    :data-history-activity="record.activity"
    :role="selecting ? 'checkbox' : 'link'"
    :aria-checked="selecting ? String(selected) : undefined"
    :aria-label="selecting ? `选择历史记录：${record.title}` : undefined"
    tabindex="0"
    @click="activate"
    @keydown.enter.prevent="activate"
    @keydown.space.prevent="activate"
  >
    <div class="history-card__body">
      <div class="history-card__top">
        <div class="history-card__tags">
          <input
            v-if="selecting"
            class="history-card__check"
            type="checkbox"
            tabindex="-1"
            aria-hidden="true"
            :checked="selected"
          />
          <span class="tag history-row__kind" :class="[record.kind, kindTone]">{{ activityLabel(record.activity) }}</span>
          <span v-if="detail" class="tag tag-neutral">{{ detail }}</span>
        </div>

        <div class="history-row__score">
          <span class="history-row__score-value t-num" :class="toneClass">{{ record.score.display }}</span>
          <span class="history-row__label">{{ record.score.label }}</span>
        </div>
      </div>

      <h3 class="history-row__title">{{ record.title }}</h3>
      <p class="history-row__meta t-num">{{ timeLine }}</p>
    </div>

    <footer v-if="!selecting" class="history-card__footer">
      <!-- No handler of its own: the click (or Enter/Space) bubbles to the card. -->
      <button type="button" class="btn btn-ghost btn-sm history-card__open">查看详情</button>
    </footer>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { activityLabel, recordDetail, recordTimeLine, scoreTone } from '../records.js'

const props = defineProps({
  record: { type: Object, required: true },
  selecting: { type: Boolean, default: false },
  selected: { type: Boolean, default: false }
})
const emit = defineEmits(['open', 'toggle'])

const KIND_TONE = { reading: 'tag-success', task1: 'tag-info', task2: 'tag-accent' }
const kindTone = computed(() => KIND_TONE[props.record.kind] || 'tag-neutral')
const detail = computed(() => recordDetail(props.record))
const timeLine = computed(() => recordTimeLine(props.record))
const toneClass = computed(() => {
  const tone = scoreTone(props.record)
  return tone ? `is-${tone}` : ''
})

function activate() {
  if (props.selecting) emit('toggle', props.record.id)
  else emit('open', props.record)
}
</script>

<style scoped>
/* Record cards mirror the library cards (ReadingBrowsePanel .reading-card). */
.atlas-paper .history-card.history-row {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--anth-card-border);
  border-radius: var(--anth-radius-card);
  background: var(--anth-surface-raised);
  box-shadow: var(--anth-shadow-1);
  cursor: pointer;
  transition: transform var(--anth-duration-fast) var(--anth-ease), box-shadow var(--anth-duration-fast) var(--anth-ease);
}

@media (hover: hover) and (pointer: fine) {
  .atlas-paper .history-card.history-row:hover {
    transform: translateY(-2px);
    box-shadow: var(--anth-shadow-2);
  }
}

.atlas-paper .history-card.history-row:focus-visible {
  outline: 2px solid var(--anth-accent-ring);
  outline-offset: 2px;
}

/* Selection: the accent outline replaces the hover lift. */
.atlas-paper .history-card.history-row.is-selected {
  border-color: var(--anth-accent);
  box-shadow: 0 0 0 1px var(--anth-accent), var(--anth-shadow-1);
}

.history-card__body {
  display: grid;
  flex: 1 1 auto;
  align-content: start;
  gap: var(--anth-space-3);
  min-width: 0;
  padding: var(--anth-space-4) var(--anth-space-4) var(--anth-space-3);
}

.history-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--anth-space-2);
  min-width: 0;
}

.history-card__tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--anth-space-1);
  min-width: 0;
}

.history-card__check {
  width: 16px;
  height: 16px;
  margin: 0 var(--anth-space-1) 0 0;
  accent-color: var(--anth-accent);
  pointer-events: none;
}

/* Score block: the figure is the card's loudest element after the title. */
.history-row__score {
  display: grid;
  flex-shrink: 0;
  justify-items: end;
  min-width: 0;
  justify-self: end;
}

.history-row__score-value {
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: 24px;
  font-weight: var(--anth-weight-semibold);
  line-height: 1.1;
}

.history-row__score-value.is-success { color: var(--anth-success); }
.history-row__score-value.is-warning { color: var(--anth-warning); }
.history-row__score-value.is-danger { color: var(--anth-danger); }

.history-row__label {
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-caption-size);
  letter-spacing: var(--anth-tracking-caption);
  text-transform: uppercase;
}

/* Serif prose, two lines at most; a long title wraps instead of clipping. */
.atlas-paper .history-row__title {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  font-weight: var(--anth-weight-medium);
  line-height: var(--anth-text-body-lg-line);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.history-row__meta {
  margin: 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
}

.history-card__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--anth-space-2);
  margin-top: auto;
  padding: var(--anth-space-3) var(--anth-space-4);
  border-top: 1px solid var(--anth-rule);
}

.history-card__open {
  color: var(--anth-accent-strong);
}

@media (prefers-reduced-motion: reduce) {
  .atlas-paper .history-card.history-row {
    transition: none;
  }
}
</style>
