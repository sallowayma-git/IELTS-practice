<template>
  <div id="more-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'more' }]" data-reading-more>
    <div class="hero-panel__header">
      <h2 class="hero-panel__title heading-serif">更多工具</h2>
    </div>
    <p class="more-view-subtitle">探索额外的学习辅助功能，助你高效备考。</p>
    <div class="more-tools-grid">
      <button class="tool-card tool-card--featured" type="button" id="writing-entry-btn" @click="$emit('open-writing-entry', $event)">
        <div class="tool-card-icon" v-html="icons.editLarge"></div>
        <div class="tool-card-content">
          <h3>写作评分</h3>
          <p>AI驱动的雅思写作评分系统，获取专业四维度评分与详细反馈。</p>
        </div>
        <div class="tool-card-arrow">进入</div>
      </button>
      <button class="tool-card" type="button" data-action="open-clock" @click="$emit('open-clock-tool', $event)">
        <div class="tool-card-icon" v-html="icons.clockLarge"></div>
        <div class="tool-card-content">
          <h3>全屏时钟</h3>
          <p>全屏数字时钟，实时显示系统时间，适合专注练习时计时。</p>
        </div>
        <div class="tool-card-arrow">进入</div>
      </button>
      <button class="tool-card" type="button" data-action="open-reading-memorize" @click="$emit('open-reading-memorize', $event)">
        <div class="tool-card-icon ui-icon-text" aria-hidden="true">工具</div>
        <div class="tool-card-content">
          <h3>阅读背题</h3>
          <p>复用统一阅读页，查看答案、解析与定位高亮，并可切换测试。</p>
        </div>
        <div class="tool-card-arrow">进入</div>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activeView: { type: String, required: true },
  icons: { type: Object, required: true }
})

defineEmits([
  'open-writing-entry',
  'open-clock-tool',
  'open-reading-memorize'
])
</script>
