<template>
  <div id="reading-preferences-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'settings' }]" data-reading-settings>
    <div class="hero-panel__header">
      <h2 class="hero-panel__title heading-serif">阅读题库与归档</h2>
    </div>
    <div class="hero-settings-group">
      <div class="hero-panel hero-section global-settings-bridge-panel">
        <h3 class="heading-serif">全局设置入口</h3>
        <p class="hero-panel__muted">主题、更新、引导和系统级选项已统一迁移到全局设置页。</p>
        <div class="hero-settings-actions">
          <button class="btn hero-btn data-mgmt-btn" id="open-global-settings-btn" type="button" @click="$emit('open-global-settings', $event)">
            打开全局设置
          </button>
        </div>
      </div>

      <div class="hero-panel hero-section reading-preferences-panel">
        <h3 class="heading-serif">阅读题库</h3>
        <p class="hero-panel__muted">题库由桌面应用的 Rust/SQLite 本地索引提供；重新读取只会读取本机索引，不存在远程题库源切换。</p>
        <div class="hero-settings-actions">
          <button class="btn hero-btn data-mgmt-btn" id="load-library-btn" type="button" :disabled="loading" @click="$emit('load-reading-data', $event)">
            重新读取本机题库
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="library-config-btn" type="button" data-action="library-config" @click="$emit('show-reading-library-config-list', $event)">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ui-emoji-icon" aria-hidden="true">
              <line x1="4" y1="21" x2="4" y2="14"></line>
              <line x1="4" y1="10" x2="4" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12" y2="3"></line>
              <line x1="20" y1="21" x2="20" y2="16"></line>
              <line x1="20" y1="12" x2="20" y2="3"></line>
              <line x1="1" y1="14" x2="7" y2="14"></line>
              <line x1="9" y1="8" x2="15" y2="8"></line>
              <line x1="17" y1="16" x2="23" y2="16"></line>
            </svg>
            查看题库来源
          </button>
        </div>
      </div>

      <div class="hero-panel hero-section data-management-panel">
        <h3 class="heading-serif">阅读记录归档</h3>
        <p class="hero-panel__muted">导出由 Rust/SQLite 生成的完整归档；导入会先完整校验，失败时不会写入任何记录。</p>
        <div class="hero-settings-actions">
          <button class="btn hero-btn data-mgmt-btn" id="export-data-btn" type="button" :disabled="historyBusy" @click="$emit('export-reading-archive', 'export')">
            导出归档
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="import-data-btn" type="button" :disabled="historyBusy" @click="$emit('trigger-reading-archive-import', $event)">
            导入归档
          </button>
          <input
            ref="archiveInput"
            class="settings-file-input"
            data-reading-archive-import-input
            type="file"
            accept="application/json,.json"
            @change="$emit('reading-archive-import-change', $event)"
          />
        </div>
      </div>

      <div class="hero-panel hero-section system-info-panel">
        <h3 class="heading-serif">阅读题库状态</h3>
        <div class="hero-surface settings-system-info system-info-surface">
          <div class="settings-system-info__status system-info-status">题库状态: {{ libraryStatusLabel }}</div>
          <div>题目总数: <span id="total-exams">{{ readingAssets.length }}</span></div>
          <div>HTML题目: <span id="html-exams">{{ htmlAssetCount }}</span></div>
          <div>PDF题目: <span id="pdf-exams">{{ pdfAssetCount }}</span></div>
          <div>最近读取: <span id="last-update">{{ latestAssetReadLabel }}</span></div>
        </div>
        <div class="settings-footer hero-settings-links legacy-team-links">
          <a href="https://docs.qq.com/doc/DSXZhWUtqeVN0d1ZT" target="_blank" rel="noopener noreferrer" class="inline-hover-link settings-footer__feedback hero-settings-links__feedback">问题反馈</a>
          <a href="https://github.com/sallowayma-git" target="_blank" rel="noopener noreferrer" class="settings-footer__author hero-settings-links__github">Salloway呈现</a>
        </div>
      </div>
    </div>

    <ReadingLibraryConfigPanel
      :open="libraryConfigOpen"
      :reading-asset-count="readingAssets.length"
      :html-asset-count="htmlAssetCount"
      :pdf-asset-count="pdfAssetCount"
      :latest-asset-read-label="latestAssetReadLabel"
      @close="$emit('update:libraryConfigOpen', false)"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ReadingLibraryConfigPanel from './ReadingLibraryConfigPanel.vue'

defineProps({
  activeView: { type: String, required: true },
  historyBusy: { type: Boolean, default: false },
  libraryStatusLabel: { type: String, default: '尚未读取' },
  readingAssets: { type: Array, required: true },
  htmlAssetCount: { type: Number, default: 0 },
  pdfAssetCount: { type: Number, default: 0 },
  latestAssetReadLabel: { type: String, default: '尚未读取' },
  libraryConfigOpen: { type: Boolean, default: false },
  loading: { type: Boolean, default: false }
})

defineEmits([
  'update:libraryConfigOpen',
  'open-global-settings',
  'load-reading-data',
  'show-reading-library-config-list',
  'export-reading-archive',
  'trigger-reading-archive-import',
  'reading-archive-import-change'
])

const archiveInput = ref(null)

defineExpose({
  click() {
    archiveInput.value?.click()
  }
})
</script>
