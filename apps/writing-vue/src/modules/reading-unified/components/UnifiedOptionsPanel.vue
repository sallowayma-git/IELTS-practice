<template>
  <!-- Full-screen Options overlay: mirrors #settings-panel of the unified page
       (non-transparent white page, sticky 78px header, centered 760px column). -->
  <div
    id="settings-panel"
    class="unified-options-panel is-open"
    role="dialog"
    aria-modal="true"
    aria-labelledby="options-title"
    tabindex="-1"
    @keydown="handleKeydown"
  >
    <header class="options-header">
      <h2 id="options-title">Options</h2>
      <button
        id="options-close-btn"
        type="button"
        aria-label="Close options"
        @click="$emit('close')"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>
      </button>
    </header>
    <main class="options-content">
      <section class="settings-section">
        <h3>字号</h3>
        <div class="settings-option-group" role="radiogroup" aria-label="Font size">
          <button
            v-for="size in fontSizes"
            :key="size.value"
            type="button"
            class="settings-option"
            :class="{ active: fontSize === size.value }"
            :data-size="size.value"
            :style="{ fontSize: size.preview }"
            @click="$emit('select-font', size.value)"
          >A</button>
        </div>
      </section>
      <section class="settings-section">
        <h3>背景颜色</h3>
        <div class="settings-option-group" role="radiogroup" aria-label="Background colour">
          <button
            type="button"
            class="settings-option"
            :class="{ active: !darkMode }"
            data-mode="light"
            @click="$emit('set-dark', false)"
          ><span class="mode-swatch mode-light" aria-hidden="true"></span>Standard</button>
          <button
            type="button"
            class="settings-option"
            :class="{ active: darkMode }"
            data-mode="dark"
            @click="$emit('set-dark', true)"
          ><span class="mode-swatch mode-dark" aria-hidden="true"></span>Night</button>
        </div>
      </section>
      <section class="settings-section">
        <h3>笔记与标注</h3>
        <p class="settings-help">A 答案定位 · N 笔记高亮 · H 普通高亮 · Q 题卡</p>
        <div class="settings-option-group">
          <button
            v-for="toggle in annotationToggles"
            :key="toggle.key"
            type="button"
            class="reading-display-toggle"
            :class="{ 'is-on': annotations[toggle.key] }"
            :data-highlight-toggle="toggle.key"
            :aria-pressed="annotations[toggle.key] ? 'true' : 'false'"
            @click="$emit('toggle-annotation', toggle.key)"
          >{{ toggle.label }}</button>
          <button
            type="button"
            class="reading-display-toggle"
            :class="{ 'is-on': !questionNavCollapsed }"
            aria-pressed="true"
            @click="$emit('toggle-question-nav')"
          >Q</button>
        </div>
      </section>
      <section class="settings-section">
        <h3>Actions</h3>
        <button
          id="options-clear-answers"
          type="button"
          :disabled="clearDisabled"
          @click="$emit('clear-answers')"
        >清空作答</button>
      </section>
    </main>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

defineProps({
  fontSize: { type: String, required: true },
  darkMode: { type: Boolean, required: true },
  annotations: { type: Object, required: true },
  questionNavCollapsed: { type: Boolean, default: false },
  clearDisabled: { type: Boolean, default: false }
})

const emit = defineEmits([
  'close',
  'select-font',
  'set-dark',
  'toggle-annotation',
  'toggle-question-nav',
  'clear-answers'
])

const fontSizes = [
  { value: 'small', preview: '12px' },
  { value: 'normal', preview: '14px' },
  { value: 'large', preview: '16px' },
  { value: 'xlarge', preview: '18px' }
]
const annotationToggles = [
  { key: 'locators', label: 'A' },
  { key: 'notes', label: 'N' },
  { key: 'highlights', label: 'H' }
]

const panelRef = ref(null)

function handleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  // Focus circle: keep Tab cycling inside the full-screen overlay like the
  // original panel does. Note offsetParent is null inside a fixed container,
  // so visibility is probed via getClientRects instead.
  if (event.key !== 'Tab') return
  const panel = document.getElementById('settings-panel')
  if (!panel) return
  const focusable = Array.from(
    panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((node) => !node.disabled && (node.getClientRects().length > 0 || node === document.activeElement))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !panel.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  // Focus circle: the original panel traps Tab inside the overlay.
  panelRef.value = document.getElementById('settings-panel')
  panelRef.value?.focus()
})
</script>
