<template>
  <div class="history-toolbar" role="toolbar" aria-label="历史工具栏">
    <input
      id="history-search"
      v-model="search"
      type="text"
      class="input history-toolbar__search"
      placeholder="搜索题目或作文内容"
      aria-label="搜索题目或作文内容"
      autocomplete="off"
    />

    <div class="history-toolbar__actions">
      <span v-if="filtered" class="history-toolbar__active">
        已筛选 ·
        <button type="button" class="btn btn-ghost btn-sm" data-history-clear-filters @click="$emit('clear')">清除</button>
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        aria-controls="history-filter-panel"
        :aria-expanded="filtersOpen ? 'true' : 'false'"
        data-history-toggle="filters"
        @click="filtersOpen = !filtersOpen"
      >
        筛选
      </button>
      <slot />
    </div>
  </div>
</template>

<script setup>
const search = defineModel('search', { type: String, default: '' })
const filtersOpen = defineModel('filtersOpen', { type: Boolean, default: false })

defineProps({
  /** Any filter (panel or search) is narrowing the list. */
  filtered: { type: Boolean, default: false }
})
defineEmits(['clear'])
</script>

<style scoped>
.history-toolbar {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-2) var(--anth-space-4);
  min-width: 0;
}

.history-toolbar__search {
  flex: 1 1 14rem;
  max-width: 22rem;
}

.history-toolbar__actions {
  display: flex;
  align-items: center;
  gap: var(--anth-space-2);
  margin-left: auto;
}

.history-toolbar__active {
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  white-space: nowrap;
}

.history-toolbar__actions [aria-expanded='true'] {
  color: var(--anth-ink);
}
</style>
