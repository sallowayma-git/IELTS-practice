<template>
  <div v-if="open" class="backup-list-container reading-library-config-list" data-reading-library-config-list>
    <div class="backup-list-card">
      <div class="backup-list-header">
        <h3 class="backup-list-title">
          <span class="backup-list-title-icon ui-icon-text" aria-hidden="true">题库</span>
          <span class="backup-list-title-text">本地题库信息</span>
        </h3>
        <button class="btn btn-secondary backup-list-dismiss" type="button" @click="$emit('close')">收起</button>
      </div>
      <div class="backup-list-scroll reading-library-config-scroll">
        <div class="backup-entry reading-library-config-entry" data-library-config-key="practice-reading-api">
          <div class="backup-entry-info">
            <strong class="backup-entry-id">桌面内置阅读题库</strong>
            <div class="backup-entry-meta">来源: Rust/SQLite 本地索引</div>
            <div class="backup-entry-meta">题目: {{ readingAssetCount }} 条 | HTML: {{ htmlAssetCount }} | PDF: {{ pdfAssetCount }}</div>
            <div class="backup-entry-meta">最近读取: {{ latestAssetReadLabel }}</div>
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
  latestAssetReadLabel: { type: String, default: '尚未读取' }
})

defineEmits(['close'])
</script>
