<template>
  <div id="overview-view" :class="['view', 'hero-section', { active: activeView === 'overview' }]" data-reading-overview>
    <section class="section">
      <div class="section-head">
        <h2 class="overview-section-title">分篇练习</h2>
        <span class="section-meta">按篇章浏览题库，或随机抽一篇</span>
      </div>
      <div class="list category-grid" id="category-overview">
        <div
          v-for="entry in readingCategoryEntries"
          :key="entry.category"
          class="list-row category-card"
          :data-reading-category-card="entry.category"
        >
          <div class="list-row-lead category-icon" aria-hidden="true">{{ entry.category }}</div>
          <div class="list-row-main">
            <div class="list-row-title category-title">{{ passageNames[entry.category] || entry.category }}</div>
            <div class="list-row-meta">
              <span :class="['category-meta', { 'is-pending': entry.total === null }]">{{ entry.total === null ? '—' : `${entry.total} 篇题目` }}</span>
            </div>
          </div>
          <div class="list-row-trail category-actions">
            <button
              class="btn btn-ghost btn-sm btn-text"
              type="button"
              data-action="browse-category"
              :data-category="entry.category"
              data-type="reading"
              @click="$emit('browse-category', entry.category, 'reading')"
            >
              浏览题库
            </button>
            <button
              class="btn btn-secondary btn-sm"
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
    </section>
    <div v-if="error" class="inline-message inline-message-error" data-reading-library-error>
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-sm btn-text" type="button" @click="$emit('retry-load', $event)">重试</button>
    </div>
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
  'start-random-practice',
  'retry-load'
])
</script>
