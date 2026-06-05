<template>
  <div id="settings-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'settings' }]" data-reading-settings>
    <div class="hero-panel__header">
      <h2 class="hero-panel__title heading-serif">⚙️ 系统设置</h2>
    </div>
    <div class="hero-settings-group">
      <div class="hero-panel hero-section system-management-panel">
        <h3 class="heading-serif">🔧 系统管理</h3>
        <p class="hero-panel__muted">系统工具和设置选项</p>
        <div class="hero-settings-actions">
          <button class="btn btn-warning hero-btn hero-btn--warn" id="clear-cache-btn" type="button" @click="$emit('clear-practice-cache', $event)">
            🗑️ 清除缓存
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="load-library-btn" type="button" @click="$emit('load-reading-data', $event)">
            📂 加载题库
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="theme-switcher-btn-entry" type="button" @click="$emit('switch-background-theme', $event)">
            🎨 主题切换
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="show-onboarding-btn" type="button" @click="$emit('start-onboarding-tour', $event)">
            🎯 显示引导
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
            题库配置切换
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="force-refresh-btn" type="button" data-action="force-refresh" @click="$emit('force-refresh-reading-data', $event)">
            🔄 强制刷新题库
          </button>
        </div>
      </div>

      <div class="hero-panel hero-section data-management-panel">
        <h3 class="heading-serif">💾 数据管理</h3>
        <p class="hero-panel__muted">数据备份、导入导出和完整性检查</p>
        <div class="hero-settings-actions">
          <button class="btn hero-btn data-mgmt-btn" id="create-backup-btn" type="button" :disabled="historyBusy" @click="$emit('create-reading-backup', $event)">
            💾 创建备份
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="backup-list-btn" type="button" @click="$emit('show-reading-backup-list', $event)">
            📋 备份列表
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="export-data-btn" type="button" :disabled="historyBusy" @click="$emit('export-reading-archive', 'export')">
            📤 导出数据
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="import-data-btn" type="button" :disabled="historyBusy" @click="$emit('trigger-reading-archive-import', $event)">
            📥 导入数据
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
        <h3 class="heading-serif">📊 系统信息</h3>
        <div class="hero-surface settings-system-info system-info-surface">
          <div class="settings-system-info__status system-info-status">题库状态: {{ libraryStatusLabel }}</div>
          <div>题目总数: <span id="total-exams">{{ readingAssets.length }}</span></div>
          <div>HTML题目: <span id="html-exams">{{ htmlAssetCount }}</span></div>
          <div>PDF题目: <span id="pdf-exams">{{ pdfAssetCount }}</span></div>
          <div>最后更新: <span id="last-update">{{ latestAssetSyncLabel }}</span></div>
        </div>
        <div class="app-update-actions">
          <button class="btn btn-secondary hero-btn hero-btn--ghost" id="check-updates-btn" type="button" data-update-action="open-modal" @click="$emit('open-update-manager', $event)">
            <span data-update-field="entry-action-label">查看更新</span>
          </button>
        </div>
        <div class="settings-footer hero-settings-links legacy-team-links">
          <a href="https://docs.qq.com/doc/DSXZhWUtqeVN0d1ZT" target="_blank" rel="noopener noreferrer" class="inline-hover-link settings-footer__feedback hero-settings-links__feedback">问题反馈</a>
          <a href="https://github.com/sallowayma-git" target="_blank" rel="noopener noreferrer" class="settings-footer__author hero-settings-links__github">Salloway呈现</a>
        </div>
      </div>
    </div>

    <div v-if="backupListOpen" class="backup-list-container" data-reading-backup-list>
      <div class="backup-list-card">
        <div class="backup-list-header">
          <h3 class="backup-list-title">
            <span class="backup-list-title-icon" aria-hidden="true">📋</span>
            <span class="backup-list-title-text">备份列表</span>
          </h3>
          <button class="btn btn-secondary backup-list-dismiss" type="button" @click="$emit('update:backupListOpen', false)">收起</button>
        </div>
        <div class="backup-list-scroll">
          <div v-if="!readingBackups.length" class="backup-list-empty">
            <div class="backup-list-empty-icon" aria-hidden="true">📂</div>
            <p class="backup-list-empty-text">暂无备份记录。</p>
            <p class="backup-list-empty-hint">创建手动备份后将显示在此列表中。</p>
          </div>
          <div v-for="backup in readingBackups" :key="backup.id" class="backup-entry" :data-backup-id="backup.id">
            <div class="backup-entry-info">
              <strong class="backup-entry-id">{{ backup.id }}</strong>
              <div class="backup-entry-meta">{{ formatBackupDate(backup) }}</div>
              <div class="backup-entry-meta">记录: {{ backup.count }} 条 | {{ backup.schemaVersion }}</div>
            </div>
            <div class="backup-entry-actions">
              <button class="btn btn-secondary" type="button" @click="$emit('download-reading-backup', backup)">下载</button>
              <button class="btn btn-success backup-entry-restore" type="button" :disabled="historyBusy" @click="$emit('restore-reading-backup', backup)">恢复</button>
              <button class="btn btn-warning hero-btn--warn" type="button" :disabled="historyBusy" @click="$emit('delete-reading-backup', backup.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ReadingLibraryConfigPanel
      :open="libraryConfigOpen"
      :reading-asset-count="readingAssets.length"
      :html-asset-count="htmlAssetCount"
      :pdf-asset-count="pdfAssetCount"
      :latest-asset-sync-label="latestAssetSyncLabel"
      :loading="loading"
      @close="$emit('update:libraryConfigOpen', false)"
      @load-reading-data="$emit('load-reading-data')"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ReadingLibraryConfigPanel from './ReadingLibraryConfigPanel.vue'

defineProps({
  activeView: { type: String, required: true },
  historyBusy: { type: Boolean, default: false },
  libraryStatusLabel: { type: String, default: '等待加载' },
  readingAssets: { type: Array, required: true },
  htmlAssetCount: { type: Number, default: 0 },
  pdfAssetCount: { type: Number, default: 0 },
  latestAssetSyncLabel: { type: String, default: '未同步' },
  backupListOpen: { type: Boolean, default: false },
  readingBackups: { type: Array, required: true },
  libraryConfigOpen: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  formatBackupDate: { type: Function, required: true }
})

defineEmits([
  'update:backupListOpen',
  'update:libraryConfigOpen',
  'clear-practice-cache',
  'load-reading-data',
  'switch-background-theme',
  'start-onboarding-tour',
  'show-reading-library-config-list',
  'force-refresh-reading-data',
  'create-reading-backup',
  'show-reading-backup-list',
  'export-reading-archive',
  'trigger-reading-archive-import',
  'reading-archive-import-change',
  'open-update-manager',
  'download-reading-backup',
  'restore-reading-backup',
  'delete-reading-backup'
])

const archiveInput = ref(null)

defineExpose({
  click() {
    archiveInput.value?.click()
  }
})
</script>
