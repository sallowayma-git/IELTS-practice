<template>
  <!-- Exam header: mirrors .header of the unified page — IELTS mark, timer
       (click to start/stop), connection/diagnostics marks, Notes, Options. -->
  <header class="header">
    <div class="header-left">
      <div class="ielts-brand">IELTS</div>
      <div class="candidate-details">
        <button
          v-if="showTimer"
          id="timer"
          type="button"
          :class="{ paused: !timerRunning && !reviewMode }"
          :disabled="reviewMode"
          title="点击启停"
          data-reading-timer
          @click="$emit('toggle-timer')"
        >{{ timerText }}</button>
      </div>
      <div style="display: none;">
        <h1 id="exam-title">{{ title }}</h1>
        <p id="exam-subtitle">{{ subtitle }}</p>
      </div>
    </div>
    <div class="header-right">
      <!-- Connection + diagnostics exist only for the opensource host bridge;
           rendered as inert status marks for visual parity. -->
      <div class="header-status" id="connection-indicator" role="status" aria-label="Connected">
        <svg class="header-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
        <span class="sr-only">Connected</span>
      </div>
      <button class="header-btn" id="messages-indicator" type="button" title="错误与诊断" aria-label="错误与诊断" tabindex="-1">
        <svg class="header-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      </button>
      <button
        id="notes-drawer-btn"
        class="header-btn reading-notes-btn"
        type="button"
        title="Notes"
        aria-label="Notes"
        aria-controls="reading-note-drawer"
        :aria-expanded="notesOpen"
        @click="$emit('toggle-notes')"
      >
        <svg class="header-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16l4 4v13.5A1.5 1.5 0 0 1 18.5 22h-13A1.5 1.5 0 0 1 4 20.5z"/><polyline points="15 3 15 8 20 8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>
        <span v-if="noteCount" class="reading-note-count" aria-hidden="true">{{ noteCount }}</span>
      </button>
      <button
        id="settings-btn"
        class="header-btn"
        type="button"
        aria-label="Options"
        aria-controls="settings-panel"
        aria-haspopup="dialog"
        :aria-expanded="optionsOpen"
        @click="$emit('toggle-options')"
      >
        <svg class="header-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </div>
  </header>
  <div class="sub-header-bar">
    <div id="sub-header-part">Part {{ partIndex }}</div>
    <div id="sub-header-instruction">{{ instruction }}</div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  showTimer: { type: Boolean, default: true },
  timerText: { type: String, default: '' },
  timerRunning: { type: Boolean, default: false },
  reviewMode: { type: Boolean, default: false },
  noteCount: { type: Number, default: 0 },
  notesOpen: { type: Boolean, default: false },
  optionsOpen: { type: Boolean, default: false },
  partIndex: { type: Number, default: 1 },
  instruction: { type: String, default: '' }
})

defineEmits(['toggle-timer', 'toggle-notes', 'toggle-options'])
</script>
