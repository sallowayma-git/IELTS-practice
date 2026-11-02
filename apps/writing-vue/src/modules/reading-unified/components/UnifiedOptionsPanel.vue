<template>
  <!-- Full-screen Options overlay: mirrors the rendered #settings-panel of the
       unified page (sticky 78px header, centered 760px column). The default
       slot carries host-only sections (coach, suite flow) in the same markup. -->
  <div
    id="settings-panel"
    class="is-open"
    role="dialog"
    aria-modal="true"
    aria-labelledby="options-title"
    tabindex="-1"
    @keydown="handleKeydown"
  >
    <header class="options-header">
      <h2 id="options-title" tabindex="-1">Options</h2>
      <button
        id="options-close-btn"
        class="options-close-button"
        type="button"
        aria-label="Close options"
        @click="$emit('close')"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </header>
    <main class="options-content">
      <div class="settings-section">
        <h3 class="settings-title">字号调整</h3>
        <div class="settings-options">
          <button
            v-for="size in fontSizes"
            :key="size.value"
            type="button"
            class="settings-option"
            :class="{ active: fontSize === size.value }"
            :data-size="size.value"
            @click="$emit('select-font', size.value)"
          >{{ size.label }}</button>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-title">背景颜色</h3>
        <div class="settings-options">
          <button type="button" class="settings-option" :class="{ active: !darkMode }" data-mode="light" @click="$emit('set-dark', false)">浅色</button>
          <button type="button" class="settings-option" :class="{ active: darkMode }" data-mode="dark" @click="$emit('set-dark', true)">深色</button>
        </div>
      </div>
      <div class="settings-section">
        <h3 class="settings-title">笔记与标注</h3>
        <p class="settings-hint">A 答案定位 · N 笔记高亮 · H 普通高亮 · Q 题卡</p>
        <div id="options-tools">
          <div id="reading-display-toggle-group" class="reading-display-toggle-group" aria-label="阅读显示控制">
            <button
              v-for="toggle in annotationToggles"
              :key="toggle.key"
              type="button"
              class="reading-display-toggle"
              :class="{ 'is-on': annotations[toggle.key] }"
              :data-highlight-toggle="toggle.key"
              :title="toggle.title"
              :aria-pressed="annotations[toggle.key] ? 'true' : 'false'"
              @click="$emit('toggle-annotation', toggle.key)"
            >{{ toggle.label }}</button>
            <button
              id="reading-question-nav-toggle"
              type="button"
              class="reading-display-toggle"
              :class="{ 'is-on': !questionNavCollapsed }"
              data-question-nav-toggle
              :title="questionNavCollapsed ? '显示题卡' : '隐藏题卡'"
              :aria-pressed="(!questionNavCollapsed).toString()"
              @click="$emit('toggle-question-nav')"
            >Q</button>
          </div>
        </div>
      </div>
      <slot />
      <div id="options-clear-answers-section" class="settings-section">
        <h3 class="settings-title">Actions</h3>
        <div class="settings-options">
          <button
            id="options-clear-answers"
            class="settings-option"
            type="button"
            :disabled="clearDisabled"
            @click="$emit('clear-answers')"
          >{{ clearLabel }}</button>
          <slot name="actions" />
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

defineProps({
  fontSize: { type: String, required: true },
  darkMode: { type: Boolean, required: true },
  annotations: { type: Object, required: true },
  questionNavCollapsed: { type: Boolean, default: false },
  clearDisabled: { type: Boolean, default: false },
  clearLabel: { type: String, default: 'Clear answers' }
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
  { value: 'small', label: '小' },
  { value: 'normal', label: '中' },
  { value: 'large', label: '大' }
]
const annotationToggles = [
  { key: 'locators', label: 'A', title: '显示/隐藏答案定位' },
  { key: 'notes', label: 'N', title: '显示/隐藏笔记高亮' },
  { key: 'highlights', label: 'H', title: '显示/隐藏普通高亮' }
]

function handleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  // Focus circle: keep Tab cycling inside the full-screen overlay like the
  // original panel does. offsetParent is null inside a fixed container, so
  // visibility is probed via getClientRects instead.
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
  document.getElementById('options-title')?.focus()
})
</script>
