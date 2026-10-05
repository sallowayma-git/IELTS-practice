<template>
  <div class="history-toolbar" role="toolbar" aria-label="历史工具栏">
    <input
      id="history-search"
      v-model="search"
      type="text"
      class="history-toolbar__search"
      placeholder="搜索题目或作文内容"
      aria-label="搜索题目或作文内容"
      autocomplete="off"
    />

    <div class="history-toolbar__actions">
      <span v-if="filtered" class="history-toolbar__active">
        已筛选 ·
        <button type="button" class="btn-text" data-history-clear-filters @click="$emit('clear')">清除</button>
      </span>
      <button
        type="button"
        class="btn-text history-toolbar__link"
        aria-controls="history-filter-panel"
        :aria-expanded="filtersOpen ? 'true' : 'false'"
        data-history-toggle="filters"
        @click="filtersOpen = !filtersOpen"
      >
        筛选
      </button>
      <button
        type="button"
        class="btn-text history-toolbar__link"
        :aria-pressed="selecting ? 'true' : 'false'"
        :disabled="disabled"
        data-history-toggle="selection"
        @click="selecting = !selecting"
      >
        选择
      </button>
      <div ref="menuRoot" class="history-menu">
        <button
          type="button"
          class="btn-text history-toolbar__link"
          aria-haspopup="menu"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          :disabled="disabled"
          data-history-toggle="export"
          @click="menuOpen = !menuOpen"
        >
          导出
        </button>
        <div v-if="menuOpen" class="history-menu__list" role="menu" aria-label="导出格式">
          <button type="button" role="menuitem" class="btn-text" data-history-export="csv" @click="pick('csv')">CSV</button>
          <button type="button" role="menuitem" class="btn-text" data-history-export="markdown" @click="pick('markdown')">Markdown</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const search = defineModel('search', { type: String, default: '' })
const filtersOpen = defineModel('filtersOpen', { type: Boolean, default: false })
const selecting = defineModel('selecting', { type: Boolean, default: false })

defineProps({
  /** Any filter (panel or search) is narrowing the list. */
  filtered: { type: Boolean, default: false },
  /** Nothing to select or export. */
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['clear', 'export'])

const menuOpen = ref(false)
const menuRoot = ref(null)

function pick(format) {
  menuOpen.value = false
  emit('export', format)
}

function closeMenuOutside(event) {
  if (menuOpen.value && !menuRoot.value?.contains(event.target)) menuOpen.value = false
}

function closeMenuOnEscape(event) {
  if (event.key === 'Escape') menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', closeMenuOutside)
  document.addEventListener('keydown', closeMenuOnEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenuOutside)
  document.removeEventListener('keydown', closeMenuOnEscape)
})
</script>

<style scoped>
.history-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 24px;
}

.history-toolbar__search {
  flex: 1 1 14rem;
  max-width: 22rem;
  min-width: 0;
  min-height: 40px;
}

.history-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0 20px;
  margin-left: auto;
}

.history-toolbar__active {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
  white-space: nowrap;
}

.history-toolbar__link {
  min-height: 44px;
  white-space: nowrap;
}

.history-toolbar__link[aria-expanded='true'],
.history-toolbar__link[aria-pressed='true'] {
  color: var(--anth-ink-strong);
  text-decoration-color: currentColor;
  font-weight: var(--anth-weight-medium);
}

.history-menu {
  position: relative;
}

.history-menu__list {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 5;
  display: grid;
  min-width: 8.5rem;
  padding: 4px 14px;
  border: 1px solid var(--anth-border-strong);
  border-radius: var(--anth-radius-sm);
  background: var(--anth-canvas);
}

.history-menu__list .btn-text {
  min-height: 40px;
  justify-content: flex-start;
}

@media (max-width: 640px) {
  .history-toolbar__search {
    flex-basis: 100%;
    max-width: none;
    min-height: 44px;
  }

  .history-toolbar__actions {
    width: 100%;
    justify-content: flex-start;
    gap: 0 24px;
    margin-left: 0;
  }

  .history-toolbar__link {
    min-width: 44px;
    justify-content: center;
  }
}
</style>
