<template>
  <div id="overview-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'overview' }]" data-reading-overview>
    <div class="overview-intro">
      <p class="hero-panel__subtitle">按篇章挑一篇开始，或用无尽与套题模式保持节奏。</p>
      <div class="overview-section-actions">
        <button
          class="btn shui-glass-btn"
          type="button"
          id="endless-mode-btn"
          data-action="start-endless-mode"
          data-overview-action="endless"
          @click="$emit('start-endless-mode', $event)"
        >
          无尽模式
        </button>
        <button
          class="btn btn-primary shui-glass-btn"
          type="button"
          data-action="start-suite-mode"
          data-overview-action="suite"
          data-start-reading-suite
          :disabled="creatingSuite"
          @click="$emit('open-suite-mode-selector', $event)"
        >
          {{ creatingSuite ? '创建中' : '套题模式' }}
        </button>
      </div>
    </div>

    <h2 class="overview-section-title">分篇练习</h2>
    <div class="category-grid" id="category-overview">
      <div
        v-for="entry in readingCategoryEntries"
        :key="entry.category"
        class="category-card"
        :data-reading-category-card="entry.category"
      >
        <div class="category-header">
          <div class="category-icon" aria-hidden="true">{{ entry.category }}</div>
          <div>
            <div class="category-title">{{ passageNames[entry.category] || entry.category }}</div>
            <div class="category-meta">{{ entry.total }} 篇题目</div>
          </div>
        </div>
        <div class="category-actions">
          <button
            class="btn-text"
            type="button"
            data-action="browse-category"
            :data-category="entry.category"
            data-type="reading"
            @click="$emit('browse-category', entry.category, 'reading')"
          >
            浏览题库
          </button>
          <button
            class="btn btn-secondary"
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
    <div v-if="error" class="inline-message inline-message-error">{{ error }}</div>
    <div v-if="suiteError" class="inline-message inline-message-error" data-reading-suite-error>{{ suiteError }}</div>
  </div>
</template>

<script setup>
const passageNames = { P1: '第一篇 · Passage 1', P2: '第二篇 · Passage 2', P3: '第三篇 · Passage 3' }

defineProps({
  activeView: { type: String, required: true },
  readingCategoryEntries: { type: Array, required: true },
  creatingSuite: { type: Boolean, default: false },
  error: { type: String, default: '' },
  suiteError: { type: String, default: '' },
  icons: { type: Object, required: true }
})

defineEmits([
  'start-endless-mode',
  'open-suite-mode-selector',
  'browse-category',
  'start-random-practice'
])
</script>
