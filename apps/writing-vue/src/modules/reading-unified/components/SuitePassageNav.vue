<template>
  <!-- Suite passage arrows: mirrors #floating-passage-nav, shown by the skin
       only under [data-suite-mode="true"]. -->
  <div id="floating-passage-nav" class="floating-nav-box">
    <button
      id="float-prev-btn"
      class="float-nav-btn"
      type="button"
      title="上一篇"
      aria-label="上一篇"
      data-review-dir="prev"
      :disabled="!canPrev"
      @click="$emit('navigate', 'prev')"
    >
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
    </button>
    <button
      id="float-next-btn"
      class="float-nav-btn"
      type="button"
      title="下一篇"
      aria-label="下一篇"
      data-review-dir="next"
      :disabled="!canNext"
      @click="$emit('navigate', 'next')"
    >
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>
  </div>
</template>

<script setup>
defineProps({
  canPrev: { type: Boolean, default: false },
  canNext: { type: Boolean, default: false }
})

defineEmits(['navigate'])
</script>
