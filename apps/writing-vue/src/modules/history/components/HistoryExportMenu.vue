<template>
  <div ref="menuRoot" class="history-menu">
    <button
      type="button"
      class="btn btn-secondary"
      aria-haspopup="menu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :disabled="disabled"
      data-history-toggle="export"
      @click="menuOpen = !menuOpen"
    >
      导出
    </button>
    <div v-if="menuOpen" class="list history-menu__list" role="menu" aria-label="导出格式">
      <button type="button" role="menuitem" class="btn btn-ghost" data-history-export="csv" @click="pick('csv')">CSV</button>
      <button type="button" role="menuitem" class="btn btn-ghost" data-history-export="markdown" @click="pick('markdown')">Markdown</button>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  /** Nothing to export. */
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['export'])

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
.history-menu {
  position: relative;
}

/* Floats above the sticky toolbar that follows it in the page. */
.history-menu__list {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: var(--anth-z-overlay);
  display: grid;
  min-width: 9rem;
  padding: var(--anth-space-1);
}

.history-menu__list .btn {
  justify-content: flex-start;
  width: 100%;
  border-color: transparent;
  box-shadow: none;
}
</style>
