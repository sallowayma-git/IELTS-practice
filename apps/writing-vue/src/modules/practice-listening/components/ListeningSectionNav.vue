<template>
  <nav class="listening-section-nav" aria-label="听力章节">
    <button
      v-for="item in sections"
      :key="item.section"
      class="listening-section-nav__item"
      :class="{ 'is-active': item.section === activeSection }"
      type="button"
      :disabled="item.disabled"
      :aria-pressed="item.section === activeSection ? 'true' : 'false'"
      :aria-label="`${item.label}，${item.count} 题${item.disabled ? '（无题目）' : ''}`"
      @click="$emit('select', item.section)"
    >
      <span class="listening-section-nav__label">{{ item.label }}</span>
      <span class="listening-section-nav__count">{{ item.count }} 题</span>
    </button>
  </nav>
</template>

<script setup>
defineProps({
  sections: { type: Array, default: () => [] },
  activeSection: { type: Number, default: 1 }
})

defineEmits(['select'])
</script>
