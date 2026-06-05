<template>
  <div v-if="open" class="backup-list-container reading-library-config-list" data-reading-library-config-list>
    <div class="backup-list-card">
      <div class="backup-list-header">
        <h3 class="backup-list-title">
          <span class="backup-list-title-icon" aria-hidden="true">🗂️</span>
          <span class="backup-list-title-text">题库配置</span>
        </h3>
        <button class="btn btn-secondary backup-list-dismiss" type="button" @click="$emit('close')">收起</button>
      </div>
      <div class="backup-list-scroll reading-library-config-scroll">
        <div class="backup-entry reading-library-config-entry" data-library-config-key="practice-reading-api">
          <div class="backup-entry-info">
            <strong class="backup-entry-id">默认阅读题库</strong>
            <div class="backup-entry-meta">来源: Practice API / reading assets</div>
            <div class="backup-entry-meta">题目: {{ readingAssetCount }} 条 | HTML: {{ htmlAssetCount }} | PDF: {{ pdfAssetCount }}</div>
            <div class="backup-entry-meta">最后更新: {{ latestAssetSyncLabel }}</div>
          </div>
          <div class="backup-entry-actions">
            <button class="btn btn-secondary" type="button" :disabled="loading" @click="$emit('load-reading-data')">刷新</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  open: { type: Boolean, default: false },
  readingAssetCount: { type: Number, default: 0 },
  htmlAssetCount: { type: Number, default: 0 },
  pdfAssetCount: { type: Number, default: 0 },
  latestAssetSyncLabel: { type: String, default: '未同步' },
  loading: { type: Boolean, default: false }
})

defineEmits(['close', 'load-reading-data'])
</script>
