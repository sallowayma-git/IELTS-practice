<template>
  <!-- Review-mode dictionary lookup for a highlighted word (host-only). -->
  <div
    id="review-highlight-dictionary-bubble"
    class="review-highlight-dictionary-bubble"
    role="dialog"
    aria-live="polite"
    :style="{ left: `${bubble.left}px`, top: `${bubble.top}px` }"
  >
    <div class="vocab-bubble-head">
      <div>
        <h4 class="vocab-term">{{ bubble.term }}</h4>
        <div v-if="bubble.meta" class="vocab-meta">{{ bubble.meta }}</div>
      </div>
      <button class="vocab-close" type="button" aria-label="关闭" @click="$emit('close')">×</button>
    </div>
    <template v-if="bubble.parts.length">
      <div v-for="part in bubble.parts" :key="part.term + part.meaning" class="vocab-part">
        <div class="vocab-term vocab-part-term">{{ part.term }}</div>
        <div v-if="part.meta" class="vocab-meta">{{ part.meta }}</div>
        <div v-if="part.meaning" class="vocab-section">
          <div class="vocab-label">中文释义</div>
          <div class="vocab-text">{{ part.meaning }}</div>
        </div>
        <div v-if="part.definition" class="vocab-section">
          <div class="vocab-label">英文释义</div>
          <div class="vocab-text">{{ part.definition }}</div>
        </div>
      </div>
    </template>
    <div v-else class="vocab-section">
      <div class="vocab-label">{{ bubble.found ? '释义' : '未收录' }}</div>
      <div class="vocab-text">{{ bubble.meaning || '未找到该高亮内容。可先加入阅读高亮生词，后续在单词背诵中补充释义。' }}</div>
    </div>
    <div v-for="section in extraSections" :key="section.label" class="vocab-section">
      <div class="vocab-label">{{ section.label }}</div>
      <div class="vocab-text">{{ section.text }}</div>
    </div>
    <div class="vocab-actions">
      <button class="vocab-add" type="button" :disabled="bubble.saved" @click="$emit('save')">
        {{ bubble.saved ? '已加入' : '加入生词本' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  bubble: { type: Object, required: true }
})

defineEmits(['close', 'save'])

const extraSections = computed(() => [
  { label: '英文释义', text: props.bubble.definition },
  { label: '例句', text: props.bubble.example },
  { label: '来源', text: props.bubble.sourceLine }
].filter((section) => section.text))
</script>
