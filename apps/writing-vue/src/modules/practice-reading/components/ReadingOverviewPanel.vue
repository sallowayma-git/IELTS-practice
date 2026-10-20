<template>
  <section class="card dash-start" aria-labelledby="dash-start-title" data-reading-overview>
    <div class="panel-header">
      <h3 id="dash-start-title">开始练习</h3>
      <span class="section-meta">阅读按篇章，写作按任务</span>
    </div>
    <p class="dash-group-label">阅读</p>
    <div class="list category-grid" id="category-overview">
      <div
        v-for="entry in readingCategoryEntries"
        :key="entry.category"
        class="list-row category-card"
        :data-reading-category-card="entry.category"
      >
        <div class="list-row-lead category-icon" aria-hidden="true">{{ entry.category }}</div>
        <div class="list-row-main category-main">
          <span class="list-row-title category-title">{{ passageNames[entry.category] || entry.category }}</span>
          <span :class="['category-meta', { 'is-pending': entry.total === null }]">{{ entry.total === null ? '—' : `${entry.total} 篇题目` }}</span>
        </div>
        <div class="list-row-trail category-actions">
          <button
            class="btn btn-ghost btn-sm btn-text"
            type="button"
            data-action="browse-category"
            :data-category="entry.category"
            data-type="reading"
            @click="$emit('browse-category', entry.category, 'reading')"
          >
            浏览
          </button>
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            data-action="start-random-practice"
            :data-category="entry.category"
            data-type="reading"
            @click="$emit('start-random-practice', entry.category, 'reading')"
          >
            随机练习
          </button>
        </div>
      </div>
    </div>
    <p class="dash-group-label">写作</p>
    <div class="list category-grid" data-writing-grid>
      <div
        v-for="entry in writingEntries"
        :key="entry.type"
        class="list-row category-card"
        :data-writing-card="entry.type"
      >
        <div class="list-row-lead category-icon" aria-hidden="true">{{ entry.label }}</div>
        <div class="list-row-main category-main">
          <span class="list-row-title category-title">{{ entry.title }}</span>
        </div>
        <div class="list-row-trail category-actions">
          <button
            class="btn btn-ghost btn-sm btn-text"
            type="button"
            data-action="browse-writing"
            :data-type="entry.type"
            @click="$emit('browse-writing', entry.type)"
          >
            浏览
          </button>
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            data-action="random-writing"
            :data-type="entry.type"
            @click="$emit('random-writing', entry.type)"
          >
            随机一题
          </button>
        </div>
      </div>
    </div>
    <MascotState v-if="error" kind="error" data-reading-library-error :title="error">
      <div class="empty-state-action">
        <button class="btn btn-secondary btn-sm" type="button" @click="$emit('retry-load', $event)">重试</button>
      </div>
    </MascotState>
    <div v-if="suiteError" class="inline-message inline-message-error" data-reading-suite-error>{{ suiteError }}</div>
  </section>
</template>

<script setup>
import MascotState from '@/components/mascot/MascotState.vue'
const passageNames = { P1: '第一篇', P2: '第二篇', P3: '第三篇' }

defineProps({
  readingCategoryEntries: { type: Array, required: true },
  writingEntries: { type: Array, default: () => [] },
  error: { type: String, default: '' },
  suiteError: { type: String, default: '' }
})

defineEmits(['browse-category', 'start-random-practice', 'retry-load', 'browse-writing', 'random-writing'])
</script>

<style scoped>
/* Rows sit on the card surface: no inner box, hairline between rows only. */
.dash-start {
  padding-bottom: var(--anth-space-4);
}

.dash-start .list {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}

.dash-start .category-card {
  grid-template-columns: 36px minmax(0, 1fr) auto;
  min-height: 0;
  padding: var(--anth-space-3) 0;
  background: transparent;
}

.dash-start .category-card:hover {
  background: transparent;
}

.dash-start .category-icon {
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-h2-size);
  font-weight: var(--anth-weight-semibold);
  line-height: 1;
}

.dash-start .category-main {
  flex-direction: row;
  align-items: baseline;
  column-gap: var(--anth-space-2);
  min-width: 0;
}

/* Group labels: tiny muted captions that split reading rows from writing rows. */
.dash-start .dash-group-label {
  margin: var(--anth-space-3) 0 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-caption-size);
}

.dash-start .category-meta {
  flex: none;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  white-space: nowrap;
}

.dash-start .category-meta.is-pending {
  color: var(--anth-ink-faint);
}

.dash-start .category-actions {
  flex-wrap: nowrap;
  gap: var(--anth-space-2);
}

@media (max-width: 520px) {
  .dash-start {
    padding: var(--anth-space-4);
  }

  .dash-start .category-card {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .dash-start .category-actions {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
