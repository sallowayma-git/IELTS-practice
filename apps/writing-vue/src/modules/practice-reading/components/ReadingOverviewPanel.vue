<template>
  <div id="overview-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'overview' }]" data-reading-overview>
    <div class="hero-panel__header">
      <h2 class="hero-panel__title heading-serif">📊 学习总览</h2>
    </div>
    <div class="category-grid" id="category-overview">
      <div class="overview-section-heading">
        <h3 class="overview-section-title">阅读</h3>
        <div class="overview-section-actions">
          <button
            class="btn shui-glass-btn"
            type="button"
            id="endless-mode-btn"
            data-action="start-endless-mode"
            data-overview-action="endless"
            @click="$emit('start-endless-mode', $event)"
          >
            <span class="ui-emoji-icon" v-html="icons.endless"></span>
            <span>无尽模式</span>
          </button>
          <button
            class="btn shui-glass-btn"
            type="button"
            data-action="start-suite-mode"
            data-overview-action="suite"
            data-start-reading-suite
            :disabled="creatingSuite"
            @click="$emit('open-suite-mode-selector', $event)"
          >
            <span class="ui-emoji-icon" v-html="icons.suite"></span>
            <span>{{ creatingSuite ? '创建中' : '套题模式' }}</span>
          </button>
        </div>
      </div>

      <div
        v-for="entry in readingCategoryEntries"
        :key="entry.category"
        class="category-card"
        :data-reading-category-card="entry.category"
      >
        <div class="category-header">
          <div class="category-icon">📖</div>
          <div>
            <div class="category-title">{{ entry.category }} 阅读</div>
            <div class="category-meta">{{ entry.total }} 篇</div>
          </div>
        </div>
        <div class="category-actions">
          <button
            class="btn"
            type="button"
            data-action="browse-category"
            :data-category="entry.category"
            data-type="reading"
            @click="$emit('browse-category', entry.category, 'reading')"
          >
            📚 浏览题库
          </button>
          <button
            class="btn btn-secondary"
            type="button"
            data-action="start-random-practice"
            :data-category="entry.category"
            data-type="reading"
            @click="$emit('start-random-practice', entry.category, 'reading')"
          >
            🎲 随机练习
          </button>
        </div>
      </div>
    </div>
    <div v-if="error" class="inline-message inline-message-error">{{ error }}</div>
    <div v-if="suiteError" class="inline-message inline-message-error" data-reading-suite-error>{{ suiteError }}</div>
  </div>
</template>

<script setup>
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
