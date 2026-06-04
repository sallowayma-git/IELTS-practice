<template>
  <div class="container hero-shell practice-library-legacy practice-library-open-source" data-practice-reading-home>
    <div class="hero-header">
      <h1 class="hero-brand-title" aria-label="IELTS Atlas">
        <span class="hero-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.5 20V8.2a2.7 2.7 0 0 1 2.7-2.7H10"></path>
            <path d="M19.5 20V8.2a2.7 2.7 0 0 0-2.7-2.7H14"></path>
            <path d="M7.2 16.8H10a2 2 0 0 1 2 2V6.5a2 2 0 0 0-2-2H7.2a2.7 2.7 0 0 0-2.7 2.7v11.6a2 2 0 0 1 2-2Z"></path>
            <path d="M16.8 16.8H14a2 2 0 0 0-2 2V6.5a2 2 0 0 1 2-2h2.8a2.7 2.7 0 0 1 2.7 2.7v11.6a2 2 0 0 0-2-2Z"></path>
            <path d="M9 9.5h1.3M13.7 9.5H15"></path>
          </svg>
        </span>
        <span class="hero-brand-text">IELTS Atlas</span>
        <span class="hero-brand-subtitle">项目仅授权ZYZ Reading Walks 提供分发，小红书号：276752989</span>
        <a
          href="https://www.xiaohongshu.com/user/profile/5b4d76744eacab058489e72f"
          target="_blank"
          rel="noopener noreferrer"
          class="hero-badge hero-badge--cta hero-badge--redbook"
          aria-label="小红书主页"
        >
          小红书
        </a>
        <a
          href="https://github.com/sallowayma-git/IELTS-practice"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-hover-link"
          aria-label="GitHub Repository"
        >
          <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
          </svg>
        </a>
      </h1>
    </div>

    <nav class="main-nav hero-nav" data-nav-controller="legacy" aria-label="主导航">
      <span class="hero-nav__liquid-indicator" aria-hidden="true"></span>
      <button
        v-for="item in legacyViews"
        :key="item.value"
        type="button"
        :class="['nav-btn', 'hero-nav__btn', { active: activeView === item.value || (activeView === 'vocab' && item.value === 'more') }]"
        :data-view="item.value"
        @click="showView(item.value)"
      >
        <span class="ui-emoji-icon" v-html="item.icon"></span>
        {{ item.label }}
      </button>
    </nav>

    <ReadingOverviewPanel
      :active-view="activeView"
      :reading-category-entries="readingCategoryEntries"
      :creating-suite="creatingSuite"
      :error="error"
      :suite-error="suiteError"
      :icons="icons"
      @start-endless-mode="startEndlessMode"
      @open-suite-mode-selector="openSuiteModeSelector"
      @browse-category="browseCategory"
      @start-random-practice="startRandomPractice"
    />

    <ReadingBrowsePanel
      :active-view="activeView"
      :browse-preference-panel-open="browsePreferencePanelOpen"
      v-model:browse-remember-position="browseRememberPosition"
      :browse-title="browseTitle"
      :type-filters="typeFilters"
      :selected-type="selectedType"
      v-model:keyword="keyword"
      :frequency-filters="frequencyFilters"
      :frequency-filter="frequencyFilter"
      v-model:sort-mode="sortMode"
      :error="error"
      :suite-error="suiteError"
      :loading="loading"
      :filtered-reading-assets="filteredReadingAssets"
      :custom-suite-draft="customSuiteDraft"
      :custom-suite-current-category="customSuiteCurrentCategory"
      :custom-suite-categories="customSuiteCategories"
      :custom-suite-picked-by-category="customSuitePickedByCategory"
      :custom-suite-ready="customSuiteReady"
      :creating-suite="creatingSuite"
      :icons="icons"
      :format-exam-meta-text="formatExamMetaText"
      @toggle-browse-preference="toggleBrowsePreference"
      @persist-browse-preference="persistBrowsePreference"
      @filter-by-type="filterByType"
      @clear-search="clearSearch"
      @toggle-frequency-filter="toggleFrequencyFilter"
      @retry-load="loadReadingData"
      @browse-primary-action="handleBrowsePrimaryAction"
      @view-pdf="viewPdf"
      @confirm-custom-suite-selection="confirmCustomSuiteSelection"
      @cancel-custom-suite-selection="cancelCustomSuiteSelection"
    />

    <ReadingHistoryPanel
      :active-view="activeView"
      :practice-summary-expanded="practiceSummaryExpanded"
      :history-stats="historyStats"
      :practice-trend-summary="practiceTrendSummary"
      :practice-trend-bars="practiceTrendBars"
      :practice-trend-ranges="practiceTrendRanges"
      :practice-trend-range="practiceTrendRange"
      v-model:practice-widget-selector-open="practiceWidgetSelectorOpen"
      :active-practice-widget="activePracticeWidget"
      :active-practice-widget-meta="activePracticeWidgetMeta"
      :heatmap-month-label="heatmapMonthLabel"
      :practice-heatmap-days="practiceHeatmapDays"
      :practice-heatmap-summary="practiceHeatmapSummary"
      :priority-insight="priorityInsight"
      :reading-radar-insight="readingRadarInsight"
      :practice-widget-options="practiceWidgetOptions"
      :selected-history-type="selectedHistoryType"
      :history-busy="historyBusy"
      :bulk-delete-button-label="bulkDeleteButtonLabel"
      v-model:history-keyword="historyKeyword"
      :history-error="historyError"
      :loading-history="loadingHistory"
      :filtered-history="filteredHistory"
      :bulk-delete-mode="bulkDeleteMode"
      :selected-history-ids="selectedHistoryIds"
      :format-record-date="formatRecordDate"
      :format-duration-short="formatDurationShort"
      :get-score-color="getScoreColor"
      :history-percentage="historyPercentage"
      @toggle-practice-summary="togglePracticeSummary"
      @select-practice-trend-range="selectPracticeTrendRange"
      @shift-heatmap-month="shiftHeatmapMonth"
      @select-practice-widget="selectPracticeWidget"
      @filter-records="filterRecords"
      @export-practice-markdown="exportPracticeMarkdown"
      @toggle-bulk-delete-mode="toggleBulkDeleteMode"
      @clear-practice-data="clearPracticeData"
      @history-item-click="handleHistoryItemClick"
      @toggle-history-selection="toggleHistorySelection"
      @open-reading-review="openReadingReview"
      @delete-history-record="deleteHistoryRecord"
    />

    <ReadingMoreToolsPanel
      :active-view="activeView"
      :icons="icons"
      @open-writing-entry="openWritingEntry"
      @open-clock-tool="openClockTool"
      @open-vocab-tool="openVocabTool"
      @open-reading-memorize="openReadingMemorize"
      @show-achievements-tool="showAchievementsTool"
    />

    <section id="vocab-view" :class="['view', { active: activeView === 'vocab' }]" data-view="vocab" :hidden="activeView !== 'vocab'">
      <div class="vocab-view-shell" data-vocab-role="root"></div>
    </section>

    <div id="achievements-modal" class="theme-modal">
      <div class="theme-modal-content achievements-modal-content">
        <div class="theme-modal-header">
          <h3>🏆 我的成就</h3>
          <button
            class="theme-modal-close"
            type="button"
            data-index-action="hide-achievements"
            data-action="hide-achievements"
            aria-label="关闭"
            @click="hideAchievementsTool"
          >
            ×
          </button>
        </div>
        <div class="theme-modal-body">
          <div class="achievements-grid" id="achievements-list"></div>
        </div>
      </div>
    </div>

    <ReadingSuiteSelector
      :suite-mode-selector-open="suiteModeSelectorOpen"
      :suite-flow-options="suiteFlowOptions"
      :selected-suite-flow-mode="selectedSuiteFlowMode"
      :suite-frequency-options="suiteFrequencyOptions"
      v-model:selected-suite-frequency-scope="selectedSuiteFrequencyScope"
      @close-suite-mode-selector="closeSuiteModeSelector"
      @select-suite-flow-mode="selectSuiteFlowMode"
    />

    <div
      id="fullscreen-clock-overlay"
      class="clock-overlay is-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="全屏时钟"
    >
      <div class="clock-overlay-inner controls-hidden" data-clock-role="overlay-inner">
        <button
          class="clock-action-btn clock-fullscreen-btn"
          type="button"
          data-action="toggle-clock-fullscreen"
          aria-label="切换全屏模式"
          aria-pressed="false"
        >
          <svg class="fullscreen-icon icon-enter" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <polyline points="4 9 4 4 9 4"></polyline>
            <line x1="4" y1="4" x2="10" y2="10"></line>
            <polyline points="20 15 20 20 15 20"></polyline>
            <line x1="20" y1="20" x2="14" y2="14"></line>
          </svg>
          <svg class="fullscreen-icon icon-exit" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <polyline points="15 9 20 9 20 4"></polyline>
            <line x1="20" y1="4" x2="14" y2="10"></line>
            <polyline points="9 15 4 15 4 20"></polyline>
            <line x1="4" y1="20" x2="10" y2="14"></line>
            <polyline points="20 15 20 20 15 20"></polyline>
            <line x1="20" y1="20" x2="14" y2="14"></line>
            <polyline points="4 9 4 4 9 4"></polyline>
            <line x1="4" y1="4" x2="10" y2="10"></line>
          </svg>
        </button>
        <button
          class="clock-action-btn clock-close-btn"
          type="button"
          data-action="close-clock"
          aria-label="关闭时钟"
        >
          <svg class="fullscreen-icon icon-close" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <line x1="8" y1="8" x2="16" y2="16"></line>
            <line x1="16" y1="8" x2="8" y2="16"></line>
          </svg>
        </button>
        <div class="clock-view-stack" data-clock-role="view-stack">
          <section class="clock-view is-active" data-clock-view="analog" aria-label="模拟指针时钟">
            <canvas id="analog-clock-canvas" aria-hidden="true"></canvas>
          </section>
          <section class="clock-view" data-clock-view="flip" aria-label="翻页时钟">
            <div class="flip-clock" id="flip-clock" aria-live="polite"></div>
          </section>
          <section class="clock-view" data-clock-view="digital" aria-label="数字时钟">
            <div class="digital-clock" id="digital-clock" aria-live="polite"></div>
          </section>
          <section class="clock-view" data-clock-view="ambient" aria-label="低对比度数字时钟">
            <div class="ambient-clock" id="ambient-clock" aria-live="polite"></div>
          </section>
        </div>
        <div class="clock-pagination" data-clock-role="pagination" aria-hidden="true">
          <button class="clock-dot is-active" type="button" data-target-view="analog" aria-label="切换到模拟指针时钟"></button>
          <button class="clock-dot" type="button" data-target-view="flip" aria-label="切换到翻页时钟"></button>
          <button class="clock-dot" type="button" data-target-view="digital" aria-label="切换到数字时钟"></button>
          <button class="clock-dot" type="button" data-target-view="ambient" aria-label="切换到低对比度数字时钟"></button>
        </div>
      </div>
    </div>

    <ReadingSettingsPanel
      ref="readingSettingsPanel"
      :active-view="activeView"
      :history-busy="historyBusy"
      :library-status-label="libraryStatusLabel"
      :reading-assets="readingAssets"
      :html-asset-count="htmlAssetCount"
      :pdf-asset-count="pdfAssetCount"
      :latest-asset-sync-label="latestAssetSyncLabel"
      v-model:backup-list-open="backupListOpen"
      :reading-backups="readingBackups"
      v-model:library-config-open="libraryConfigOpen"
      :loading="loading"
      :format-backup-date="formatBackupDate"
      @clear-practice-cache="clearPracticeCache"
      @load-reading-data="loadReadingData"
      @switch-background-theme="switchBackgroundTheme"
      @start-onboarding-tour="startOnboardingTour"
      @show-reading-library-config-list="showReadingLibraryConfigList"
      @force-refresh-reading-data="forceRefreshReadingData"
      @create-reading-backup="createReadingBackup"
      @show-reading-backup-list="showReadingBackupList"
      @export-reading-archive="exportReadingArchive"
      @trigger-reading-archive-import="triggerReadingArchiveImport"
      @reading-archive-import-change="handleReadingArchiveImportChange"
      @open-update-manager="openUpdateManager"
      @download-reading-backup="downloadReadingBackup"
      @restore-reading-backup="restoreReadingBackup"
      @delete-reading-backup="deleteReadingBackup"
    />


    <div id="theme-switcher-modal" class="theme-modal" :class="{ show: themeSwitcherOpen }">
      <div class="theme-modal-content">
        <div class="theme-modal-header">
          <h3 class="heading-serif">🎨 主题切换</h3>
          <button
            class="theme-modal-close"
            type="button"
            data-index-action="hide-theme-switcher"
            aria-label="关闭"
            @click="themeSwitcherOpen = false"
          >
            ×
          </button>
        </div>
        <div class="theme-modal-body">
          <div class="theme-options-viewport" role="presentation">
            <div class="theme-options theme-options-glass">
              <div
                v-for="theme in backgroundThemes"
                :key="theme.value"
                class="theme-card"
              >
                <div :class="['theme-card-bg', theme.previewClass]"></div>
                <div class="theme-card-glass-layer">
                  <div class="theme-card-header">
                    <h4 class="theme-card-title">{{ theme.title }}</h4>
                    <div class="theme-card-subtitle">
                      <span>{{ theme.subtitle }}</span>
                    </div>
                  </div>
                  <div class="theme-card-footer">
                    <span class="theme-card-tag">{{ theme.tag }}</span>
                    <button
                      class="theme-card-btn"
                      type="button"
                      data-index-action="switch-bg-theme"
                      :data-action-value="theme.value"
                      @click="applyBackgroundTheme(theme.value)"
                    >
                      应用
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="license-modal" :class="{ show: licenseModalVisible }">
      <div class="lm-card">
        <h2 class="lm-title">开源项目使用须知</h2>
        <div class="lm-body">
          <p>
            感谢使用！本项目是免费软件，采用 <strong>GPL-3.0 License</strong> 发布。
          </p>
          <p class="lm-warning">
            我们明确反对任何形式的倒卖、改名后二次分发、牟利、使用该项目商业引流等行为。
          </p>
          <p>
            本项目的初衷是自由使用、学习与改进，而不是作为倒卖工具获取不正当收益。
          </p>
          <p>
            腾讯文档：
            <a
              href="https://docs.qq.com/doc/DSXZhWUtqeVN0d1ZT"
              target="_blank"
              rel="noopener noreferrer"
              class="lm-warning"
            >
              问题反馈
            </a>
          </p>
          <div class="lm-info-box">
            <p>
              任何分发、修改或再发布行为，都必须遵守 GPL-3.0 协议，包括<strong>公开源码、保留开源许可，并尊重用户的自由</strong>。
            </p>
          </div>
        </div>
        <div class="lm-footer">
          <button class="lm-btn" type="button" data-index-action="accept-license" @click="acceptGplLicense">
            我已了解
          </button>
        </div>
      </div>
    </div>

    <p v-if="localMessage" class="practice-local-message" role="status">{{ localMessage }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  hideLegacyAchievements,
  mountLegacyVocabSessionView,
  openLegacyClockOverlay,
  openLegacyUpdateManager,
  showLegacyAchievements,
  startLegacyOnboardingTour,
  switchLegacyBackgroundTheme
} from '@/modules/legacy/legacyBridge'
import { resolveLegacyAssetUrl } from '@/modules/legacy/legacyScriptLoader'
import ReadingBrowsePanel from '@/modules/practice-reading/components/ReadingBrowsePanel.vue'
import ReadingHistoryPanel from '@/modules/practice-reading/components/ReadingHistoryPanel.vue'
import ReadingMoreToolsPanel from '@/modules/practice-reading/components/ReadingMoreToolsPanel.vue'
import ReadingOverviewPanel from '@/modules/practice-reading/components/ReadingOverviewPanel.vue'
import ReadingSettingsPanel from '@/modules/practice-reading/components/ReadingSettingsPanel.vue'
import ReadingSuiteSelector from '@/modules/practice-reading/components/ReadingSuiteSelector.vue'
import {
  buildBrowseTitle,
  filterReadingAssets,
  normalizeCategory,
  normalizeFrequency
} from '@/modules/practice-reading/browseFilters'
import { useReadingHistory } from '@/modules/practice-reading/useReadingHistory'
import { useReadingLibrary } from '@/modules/practice-reading/useReadingLibrary'
import { useReadingSuite } from '@/modules/practice-reading/useReadingSuite'
import { historyPercentage, sortReadingHistory } from '@/modules/practice-reading/historyStats'

const router = useRouter()
const route = useRoute()
const { loadReadingAssets } = useReadingLibrary()
const {
  loadReadingHistory,
  deleteReadingHistoryRecord,
  clearReadingHistory,
  exportReadingHistoryArchive,
  importReadingHistoryArchive,
  filterReadingHistory,
  computeHistoryStats,
  getPracticeTrendRecords,
  computePracticeTrendSummary,
  computePracticeTrendBars
} = useReadingHistory()
const { createReadingSuite } = useReadingSuite()
const ENDLESS_STATE_KEY = 'practice_reading_endless_state_v1'
const READING_BACKUP_STORAGE_KEY = 'practice_reading_archive_backups_v1'
const LICENSE_STORAGE_KEY = 'hasSeenGplLicense'
const MAX_READING_BACKUPS = 10
const SUITE_FLOW_MODE_STORAGE_KEY = 'suite_flow_mode'
const SUITE_FREQUENCY_SCOPE_STORAGE_KEY = 'suite_frequency_scope'
const SUITE_AUTO_ADVANCE_STORAGE_KEY = 'suite_auto_advance_after_submit'

const icons = {
  overview: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>',
  book: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
  more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>',
  settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
  suite: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 13h8M8 17h6"></path></svg>',
  endless: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8c2.2 0 4 1.8 4 4s-1.8 4-4 4c-1.9 0-3.1-1.1-4.4-2.7L11.4 12C10.1 10.4 8.9 9 7 9c-1.7 0-3 1.3-3 3s1.3 3 3 3c1.4 0 2.4-.8 3.6-2.2"></path><path d="M13.4 10.7C14.7 9.1 15.9 8 17 8"></path></svg>',
  editLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
  clockLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
  vocabLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
  achievementLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10"></path><path d="M17 4v8c0 2.8-2.2 5-5 5s-5-2.2-5-5V4"></path><path d="M15 4V2H9v2"></path><path d="M5 4H2v4c0 1.1.9 2 2 2h1"></path><path d="M19 4h3v4c0 1.1-.9 2-2 2h-1"></path></svg>',
  achievementSmall: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10"></path><path d="M17 4v8c0 2.8-2.2 5-5 5s-5-2.2-5-5V4"></path><path d="M15 4V2H9v2"></path><path d="M5 4H2v4c0 1.1.9 2 2 2h1"></path><path d="M19 4h3v4c0 1.1-.9 2-2 2h-1"></path></svg>'
}

const legacyViews = [
  { value: 'overview', label: '总览', icon: icons.overview },
  { value: 'browse', label: '题库浏览', icon: icons.book },
  { value: 'practice', label: '练习记录', icon: icons.edit },
  { value: 'more', label: '更多', icon: icons.more },
  { value: 'settings', label: '设置', icon: icons.settings }
]

const typeFilters = [
  { value: 'all', label: '全部' },
  { value: 'reading', label: '阅读' },
  { value: 'listening', label: '听力', hidden: true }
]

const frequencyFilters = [
  { value: 'high', label: '高频' },
  { value: 'medium', label: '中频' },
  { value: 'low', label: '低频' }
]

const practiceTrendRanges = [
  { value: 'recent10', label: '最近十次', limit: 10 },
  { value: 'last7d', label: '最近七天', days: 7 },
  { value: 'last30d', label: '最近一月', days: 30 },
  { value: 'recent20', label: '最近20次', limit: 20 }
]

const backgroundThemes = [
  {
    value: 'misty-mountain',
    title: '晨雾群山',
    subtitle: '⛰️ Misty Mountain',
    tag: '动态',
    previewClass: 'theme-bg-misty'
  },
  {
    value: 'teal-ocean',
    title: '深海孤航',
    subtitle: '⛵ Teal Ocean',
    tag: '动态',
    previewClass: 'theme-bg-ocean'
  },
  {
    value: 'floral-bloom',
    title: '落日雾花',
    subtitle: '🌸 Floral Bloom',
    tag: '静态',
    previewClass: 'theme-bg-floral'
  }
]

const practiceWidgetOptions = [
  {
    value: 'heatmap',
    label: '练习热力图',
    eyebrow: 'Heatmap',
    title: '练习热力图',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M8 2v4"></path><path d="M16 2v4"></path><path d="M3 10h18"></path><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 17h.01"></path></svg>'
  },
  {
    value: 'priority',
    label: '中高频余量',
    eyebrow: 'Focus',
    title: '中高频余量',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M22 20H2"></path></svg>'
  },
  {
    value: 'radar',
    label: '阅读错题雷达',
    eyebrow: 'Radar',
    title: '阅读错题雷达',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5Z"></path><path d="m3 8 9 13 9-13"></path><path d="M12 13v8"></path></svg>'
  }
]

const suiteFlowOptions = [
  { value: 'simulation', label: '模拟模式', description: '贴近官方机考' },
  { value: 'classic', label: '经典模式', description: '自动跳转' },
  { value: 'stationary', label: '驻足模式', description: '提交后停留回看' }
]

const suiteFrequencyOptions = [
  { value: 'high_medium', label: '高频 + 次高频' },
  { value: 'high', label: '仅高频' },
  { value: 'all', label: '全部频率（默认）' },
  { value: 'custom', label: '自选套题（P1/P2/P3）' }
]

const customSuiteCategories = ['P1', 'P2', 'P3']

const activeView = ref('overview')
const licenseModalVisible = ref(false)
const selectedCategory = ref('all')
const selectedType = ref('all')
const selectedHistoryType = ref('all')
const frequencyFilter = ref('all')
const keyword = ref('')
const historyKeyword = ref('')
const sortMode = ref('default')
const browsePreferencePanelOpen = ref(false)
const browseRememberPosition = ref(readBrowseRememberPosition())
const practiceSummaryExpanded = ref(true)
const practiceTrendRange = ref('recent10')
const activePracticeWidget = ref('heatmap')
const practiceWidgetSelectorOpen = ref(false)
const themeSwitcherOpen = ref(false)
const backupListOpen = ref(false)
const libraryConfigOpen = ref(false)
const suiteModeSelectorOpen = ref(false)
const selectedSuiteFlowMode = ref(resolveSuitePreference().flowMode)
const selectedSuiteFrequencyScope = ref(resolveSuitePreference().frequencyScope)
const customSuiteDraft = ref(null)
const heatmapMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const readingAssets = ref([])
const readingHistory = ref([])
const readingBackups = ref(readReadingBackups())
const readingSettingsPanel = ref(null)
const loading = ref(false)
const loadingHistory = ref(false)
const historyBusy = ref(false)
const creatingSuite = ref(false)
const error = ref('')
const historyError = ref('')
const suiteError = ref('')
const localMessage = ref('')
const bulkDeleteMode = ref(false)
const selectedHistoryIds = ref(new Set())
const latestAssetSyncAt = ref(null)
let pendingBrowsePositionRestore = false

const readingCategoryEntries = computed(() => ['P1', 'P2', 'P3'].map((category) => ({
  category,
  type: 'reading',
  total: countByCategory(category)
})))

const browseTitle = computed(() => {
  return buildBrowseTitle(selectedCategory.value, selectedType.value)
})

const filteredReadingAssets = computed(() => {
  return filterReadingAssets(readingAssets.value, {
    keyword: keyword.value,
    selectedType: selectedType.value,
    selectedCategory: selectedCategory.value,
    frequencyFilter: frequencyFilter.value,
    sortMode: sortMode.value
  })
})

const sortedHistory = computed(() => sortReadingHistory(readingHistory.value))

const filteredHistory = computed(() => {
  return filterReadingHistory(readingHistory.value, {
    keyword: historyKeyword.value,
    selectedHistoryType: selectedHistoryType.value
  })
})

const historyStats = computed(() => computeHistoryStats(readingHistory.value))

const practiceTrendRecords = computed(() => {
  return getPracticeTrendRecords(readingHistory.value, practiceTrendRange.value, practiceTrendRanges)
})

const practiceTrendSummary = computed(() => {
  return computePracticeTrendSummary(readingHistory.value, practiceTrendRange.value, practiceTrendRanges)
})

const practiceTrendBars = computed(() => computePracticeTrendBars(readingHistory.value, practiceTrendRange.value, practiceTrendRanges))

const priorityInsight = computed(() => {
  const buckets = {
    high: buildPriorityBucket('high'),
    medium: buildPriorityBucket('medium')
  }
  return buckets
})

const activePracticeWidgetMeta = computed(() => (
  practiceWidgetOptions.find((widget) => widget.value === activePracticeWidget.value)
  || practiceWidgetOptions[0]
))

const heatmapMonthLabel = computed(() => {
  const cursor = heatmapMonth.value
  const now = new Date()
  if (cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()) {
    return '本月'
  }
  return `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
})

const practiceHeatmapDays = computed(() => {
  const cursor = heatmapMonth.value
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const dailySets = new Map()
  const allActiveDays = new Map()
  readingHistory.value.forEach((record, index) => {
    const date = getRecordDate(record)
    const key = formatDateKey(date)
    const setId = getPracticeSetId(record, key, index)
    if (!key || !setId) return
    if (!allActiveDays.has(key)) allActiveDays.set(key, new Set())
    allActiveDays.get(key).add(setId)
    if (date.getFullYear() !== year || date.getMonth() !== month) return
    if (!dailySets.has(key)) dailySets.set(key, new Set())
    dailySets.get(key).add(setId)
  })
  const averageSetsPerActiveDay = allActiveDays.size
    ? Array.from(allActiveDays.values()).reduce((sum, set) => sum + set.size, 0) / allActiveDays.size
    : 1
  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(year, month, index + 1)
    const key = formatDateKey(date)
    const count = dailySets.get(key)?.size || 0
    return {
      key,
      label: `${month + 1}月${index + 1}日，做题 ${count} 套`,
      count,
      level: resolveHeatmapLevel(count, averageSetsPerActiveDay)
    }
  })
})

const practiceHeatmapSummary = computed(() => {
  const total = practiceHeatmapDays.value.reduce((sum, day) => sum + day.count, 0)
  if (!total) return `${heatmapMonthLabel.value}暂无练习记录`
  return `${heatmapMonthLabel.value}共做题 ${total} 套`
})

const readingRadarInsight = computed(() => {
  const counts = new Map()
  const records = sortedHistory.value.slice(0, 10)
  records.forEach((record) => {
    const performance = record?.metadata?.questionTypePerformance
      || record?.metadata?.analysisArtifacts?.questionTypePerformance
      || record?.metadata?.singleAttemptAnalysisInput?.questionTypePerformance
    if (!performance || typeof performance !== 'object') return
    Object.values(performance).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const total = Number(entry.total)
      const correct = Number(entry.correct ?? entry.correctAnswers)
      if (!Number.isFinite(total) || !Number.isFinite(correct)) return
      const wrong = Math.max(0, total - correct)
      if (!wrong) return
      const kind = normalizeQuestionKind(entry.kind || entry.type || 'unknown')
      counts.set(kind, (counts.get(kind) || 0) + wrong)
    })
  })
  const totalErrors = Array.from(counts.values()).reduce((sum, count) => sum + count, 0)
  const dataPoints = Array.from(counts.entries())
    .map(([type, count]) => ({
      type,
      label: formatQuestionKindLabel(type),
      count,
      percent: totalErrors ? Math.round((count / totalErrors) * 100) : 0
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
  return {
    recordCount: records.length,
    totalErrors,
    dataPoints,
    summary: totalErrors
      ? `最近${records.length}次阅读共 ${totalErrors} 道错题`
      : '最近10次阅读暂无可分类错题'
  }
})

const bulkDeleteButtonLabel = computed(() => {
  const selectedCount = selectedHistoryIds.value.size
  if (bulkDeleteMode.value) {
    return selectedCount > 0 ? `完成选择 (${selectedCount})` : '完成选择'
  }
  return selectedCount > 0 ? `批量删除 (${selectedCount})` : '批量删除'
})

const htmlAssetCount = computed(() => readingAssets.value.filter(hasReadingPracticePayload).length)
const pdfAssetCount = computed(() => readingAssets.value.filter((asset) => getPdfPath(asset)).length)
const libraryStatusLabel = computed(() => readingAssets.value.length ? '已加载完整索引' : '等待加载')
const latestAssetSyncLabel = computed(() => latestAssetSyncAt.value ? latestAssetSyncAt.value.toLocaleString() : '未同步')
const customSuitePickedByCategory = computed(() => customSuiteDraft.value?.pickedByCategory || {})
const customSuiteCurrentCategory = computed(() => customSuiteCategories[customSuiteDraft.value?.stageIndex || 0] || 'P1')
const customSuiteReady = computed(() => customSuiteCategories.every((category) => Boolean(customSuitePickedByCategory.value[category]?.id)))

onMounted(() => {
  syncViewFromRoute()
  loadReadingData()
  initLicenseModal()
  updateLiquidIndicator()
  updateSegmentedIndicators()
  scheduleBrowsePositionRestore()
})

watch(() => route.query.view, () => {
  syncViewFromRoute()
})

watch(activeView, (value) => {
  updateRouteView(value)
  nextTick(() => {
    updateLiquidIndicator()
    updateSegmentedIndicators()
    if (value === 'browse') {
      restoreBrowsePosition()
    }
  })
})

watch(selectedType, () => {
  nextTick(updateSegmentedIndicators)
})

watch(selectedHistoryType, () => {
  nextTick(updateSegmentedIndicators)
})

watch(filteredReadingAssets, () => {
  if (activeView.value === 'browse') {
    scheduleBrowsePositionRestore()
  }
})

async function loadReadingData(options = {}) {
  await Promise.all([
    loadAssets(options),
    loadHistory()
  ])
}

async function loadAssets(options = {}) {
  loading.value = true
  error.value = ''
  try {
    const result = await loadReadingAssets({ refresh: Boolean(options.refresh) })
    readingAssets.value = Array.isArray(result?.data) ? result.data : []
    latestAssetSyncAt.value = new Date()
    scheduleBrowsePositionRestore()
    if (options.refresh) {
      showLocalMessage('题库刷新完成')
    }
  } catch (loadError) {
    console.error('加载阅读题库失败:', loadError)
    readingAssets.value = []
    error.value = loadError?.message
      ? `阅读题库加载失败：${loadError.message}`
      : '阅读题库加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function forceRefreshReadingData(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  await loadReadingData({ refresh: true })
}

async function loadHistory() {
  loadingHistory.value = true
  historyError.value = ''
  try {
    const result = await loadReadingHistory()
    readingHistory.value = Array.isArray(result?.data) ? result.data : []
  } catch (loadError) {
    console.error('加载阅读练习记录失败:', loadError)
    readingHistory.value = []
    historyError.value = loadError?.message || '阅读练习记录加载失败'
  } finally {
    loadingHistory.value = false
  }
}

function syncViewFromRoute() {
  const rawView = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  const view = rawView === 'records' ? 'practice' : rawView
  if (view === 'vocab') {
    activeView.value = 'vocab'
    return
  }
  if (legacyViews.some((item) => item.value === view)) {
    activeView.value = view
  }
}

function updateRouteView(view) {
  const current = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  const nextView = view === 'overview' ? undefined : view
  if ((current || undefined) === nextView) return
  router.replace({
    query: {
      ...route.query,
      view: nextView
    }
  }).catch(() => {})
}

function showView(view) {
  if (!legacyViews.some((item) => item.value === view)) return
  activeView.value = view
}

function hasAcceptedLicense() {
  try {
    return window.localStorage?.getItem(LICENSE_STORAGE_KEY) === 'true'
  } catch (_) {
    return true
  }
}

function initLicenseModal() {
  if (hasAcceptedLicense()) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      licenseModalVisible.value = true
    })
  })
}

function acceptGplLicense(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    window.localStorage?.setItem(LICENSE_STORAGE_KEY, 'true')
  } catch (error) {
    console.warn('LocalStorage error:', error)
  }
  licenseModalVisible.value = false
}

function getRecordAssetKey(record) {
  return String(record?.assetId || record?.examId || record?.metadata?.assetId || record?.metadata?.examId || '').trim()
}

function getRecordAsset(record) {
  const assetKey = getRecordAssetKey(record)
  if (!assetKey) return null
  return readingAssets.value.find((asset) => String(asset?.id || '').trim() === assetKey) || null
}

function getRecordFrequency(record) {
  const direct = normalizeFrequency(record)
  if (direct !== 'unknown') return direct
  return normalizeFrequency(getRecordAsset(record))
}

function readBrowseRememberPosition() {
  const parsed = readBrowsePreferences()
  if (Object.prototype.hasOwnProperty.call(parsed, 'autoScrollEnabled')) {
    return Boolean(parsed.autoScrollEnabled)
  }
  return true
}

function readBrowsePreferences() {
  try {
    const raw = localStorage.getItem('browse_view_preferences_v2')
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {}
  return {}
}

function writeBrowsePreferences(patch = {}) {
  try {
    localStorage.setItem('browse_view_preferences_v2', JSON.stringify({
      ...readBrowsePreferences(),
      ...(patch && typeof patch === 'object' ? patch : {})
    }))
  } catch (_) {}
}

function persistBrowsePreference() {
  writeBrowsePreferences({ autoScrollEnabled: Boolean(browseRememberPosition.value) })
  browsePreferencePanelOpen.value = false
  showLocalMessage(browseRememberPosition.value
    ? '已开启列表位置记录，将自动恢复到上次答题的位置'
    : '已关闭列表位置记录')
}

function toggleBrowsePreference(event) {
  event?.preventDefault?.()
  browsePreferencePanelOpen.value = !browsePreferencePanelOpen.value
}

function buildPriorityBucket(frequency) {
  const assets = readingAssets.value.filter((asset) => normalizeFrequency(asset) === frequency)
  const records = readingHistory.value.filter((record) => getRecordFrequency(record) === frequency)
  const practicedAssetIds = new Set(records.map(getRecordAssetKey).filter(Boolean))
  const practiced = assets.length
    ? assets.filter((asset) => practicedAssetIds.has(String(asset?.id || '').trim())).length
    : practicedAssetIds.size || records.length
  const total = assets.length || practiced
  const totalAccuracy = records.reduce((sum, record) => sum + historyPercentage(record), 0)
  return {
    total,
    practiced,
    percent: total ? Math.round((practiced / total) * 100) : 0,
    accuracy: records.length ? Math.round(totalAccuracy / records.length) : 0
  }
}

function countByCategory(category) {
  return readingAssets.value.filter((asset) => normalizeCategory(asset.category) === category).length
}

function filterByType(type) {
  selectedType.value = type === 'reading' ? 'reading' : 'all'
  if (selectedType.value === 'all') {
    selectedCategory.value = 'all'
  }
}

function filterRecords(type) {
  selectedHistoryType.value = type === 'reading' ? 'reading' : 'all'
}

function browseCategory(category, type = 'reading') {
  selectedCategory.value = category === 'all' ? 'all' : normalizeCategory(category)
  selectedType.value = type === 'reading' ? 'reading' : 'all'
  activeView.value = 'browse'
}

function toggleFrequencyFilter(value) {
  const normalized = frequencyFilters.some((filter) => filter.value === value) ? value : 'all'
  frequencyFilter.value = frequencyFilter.value === normalized ? 'all' : normalized
}

function togglePracticeSummary() {
  practiceSummaryExpanded.value = !practiceSummaryExpanded.value
}

function selectPracticeTrendRange(value) {
  if (!practiceTrendRanges.some((range) => range.value === value)) return
  practiceTrendRange.value = value
}

function selectPracticeWidget(value) {
  if (!practiceWidgetOptions.some((widget) => widget.value === value)) return
  activePracticeWidget.value = value
  practiceWidgetSelectorOpen.value = false
}

function shiftHeatmapMonth(delta) {
  const cursor = heatmapMonth.value
  heatmapMonth.value = new Date(cursor.getFullYear(), cursor.getMonth() + Number(delta || 0), 1)
}

function clearSearch() {
  keyword.value = ''
}

function saveBrowsePosition(asset) {
  if (!browseRememberPosition.value || !asset?.id) return
  writeBrowsePreferences({
    autoScrollEnabled: true,
    lastAssetId: String(asset.id),
    lastCategory: selectedCategory.value,
    lastType: selectedType.value,
    lastFrequencyFilter: frequencyFilter.value,
    lastKeyword: keyword.value,
    lastSortMode: sortMode.value,
    lastUpdatedAt: new Date().toISOString()
  })
}

function restoreBrowsePosition() {
  if (!browseRememberPosition.value || activeView.value !== 'browse') return false
  const prefs = readBrowsePreferences()
  const assetId = String(prefs.lastAssetId || '').trim()
  if (!assetId) return false
  const targetAsset = readingAssets.value.find((asset) => String(asset?.id || '').trim() === assetId)
  if (!targetAsset) return false

  const normalizedType = prefs.lastType === 'reading' ? 'reading' : 'all'
  const normalizedCategory = String(prefs.lastCategory || '').trim()
  const normalizedFrequency = frequencyFilters.some((filter) => filter.value === prefs.lastFrequencyFilter)
    ? prefs.lastFrequencyFilter
    : 'all'
  const normalizedSort = ['default', 'frequency-desc', 'difficulty-desc'].includes(prefs.lastSortMode)
    ? prefs.lastSortMode
    : 'default'

  if (selectedType.value !== normalizedType) selectedType.value = normalizedType
  if (selectedCategory.value !== (normalizedCategory || 'all')) selectedCategory.value = normalizedCategory || 'all'
  if (frequencyFilter.value !== normalizedFrequency) frequencyFilter.value = normalizedFrequency
  if (sortMode.value !== normalizedSort) sortMode.value = normalizedSort
  if (keyword.value !== String(prefs.lastKeyword || '')) keyword.value = String(prefs.lastKeyword || '')

  nextTick(() => {
    const escapedAssetId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(assetId)
      : assetId.replace(/["\\]/g, '\\$&')
    const target = document.querySelector(`.exam-item[data-reading-asset-id="${escapedAssetId}"]`)
    target?.scrollIntoView?.({ block: 'center', behavior: 'auto' })
  })
  return true
}

function scheduleBrowsePositionRestore() {
  if (pendingBrowsePositionRestore) return
  pendingBrowsePositionRestore = true
  nextTick(() => {
    pendingBrowsePositionRestore = false
    restoreBrowsePosition()
  })
}

function startReading(asset) {
  if (!asset?.id) return
  if (!hasReadingPracticePayload(asset) && getPdfPath(asset)) {
    viewPdf(asset)
    return
  }
  saveBrowsePosition(asset)
  router.push({
    name: 'PracticeReading',
    params: { assetId: asset.id }
  })
}

function handleBrowsePrimaryAction(asset) {
  if (customSuiteDraft.value) {
    selectCustomSuiteAsset(asset)
    return
  }
  startReading(asset)
}

function startRandomPractice(category = 'all') {
  const normalizedCategory = category === 'all' ? 'all' : normalizeCategory(category)
  const pool = readingAssets.value.filter((asset) => (
    asset?.id
    && asset.activity === 'reading'
    && hasReadingPracticePayload(asset)
    && (normalizedCategory === 'all' || normalizeCategory(asset.category) === normalizedCategory)
  ))
  const selected = pool[Math.floor(Math.random() * pool.length)]
  if (!selected) {
    browseCategory(normalizedCategory, 'reading')
    return
  }
  startReading(selected)
}

function startEndlessMode() {
  const pool = readingAssets.value.filter((asset) => (
    asset?.id
    && asset.activity === 'reading'
    && hasReadingPracticePayload(asset)
  ))
  const selected = pool[Math.floor(Math.random() * pool.length)]
  if (!selected) {
    showLocalMessage('无尽模式：题库为空，请先加载题库')
    return
  }
  try {
    window.sessionStorage?.setItem(ENDLESS_STATE_KEY, JSON.stringify({
      active: true,
      startedAt: new Date().toISOString(),
      currentAssetId: selected.id,
      pool: pool.map((asset) => ({
        id: asset.id,
        title: asset.title,
        category: asset.category
      }))
    }))
  } catch (_) {
    // best-effort endless state; route query still keeps the mode active.
  }
  showLocalMessage(`无尽模式已启动，正在打开：${selected.title}`)
  router.push({
    name: 'PracticeReading',
    params: { assetId: selected.id },
    query: { mode: 'endless' }
  })
}

async function startOnboardingTour(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    await startLegacyOnboardingTour()
  } catch (error) {
    console.error('打开引导流程失败:', error)
    showLocalMessage(error?.message ? `引导打开失败：${error.message}` : '引导打开失败，请稍后重试。')
  }
}

async function openUpdateManager(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    await openLegacyUpdateManager()
  } catch (error) {
    console.error('打开更新管理失败:', error)
    showLocalMessage(error?.message ? `更新检查打开失败：${error.message}` : '更新检查打开失败，请稍后重试。')
  }
}

async function openClockTool(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    await openLegacyClockOverlay()
  } catch (error) {
    console.error('打开全屏时钟失败:', error)
    showLocalMessage(error?.message ? `全屏时钟打开失败：${error.message}` : '全屏时钟打开失败，请稍后重试。')
  }
}

async function openVocabTool(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  activeView.value = 'vocab'
  await nextTick()
  try {
    await mountLegacyVocabSessionView('#vocab-view')
  } catch (error) {
    console.error('打开单词背诵失败:', error)
    showLocalMessage(error?.message ? `单词背诵打开失败：${error.message}` : '单词背诵打开失败，请稍后重试。')
  }
}

async function showAchievementsTool(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    await showLegacyAchievements()
  } catch (error) {
    console.error('打开成就面板失败:', error)
    showLocalMessage(error?.message ? `成就面板打开失败：${error.message}` : '成就面板打开失败，请稍后重试。')
  }
}

function openReadingMemorize() {
  const asset = filteredReadingAssets.value.find((entry) => entry?.id && hasReadingPracticePayload(entry))
    || readingAssets.value.find((entry) => entry?.id && hasReadingPracticePayload(entry))
  if (!asset) {
    showLocalMessage('阅读背题：没有可用于背题的阅读题，请先加载题库。')
    return
  }
  router.push({
    name: 'PracticeReading',
    params: { assetId: asset.id },
    query: {
      mode: 'memorize',
      practiceMode: 'memorize'
    }
  })
}

function hideAchievementsTool(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  if (hideLegacyAchievements()) {
    return
  }
  document.getElementById('achievements-modal')?.classList.remove('show')
}

function openWritingEntry(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  router.push({ name: 'Compose' })
}

function normalizeSuiteFlowMode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return suiteFlowOptions.some((option) => option.value === normalized) ? normalized : ''
}

function normalizeSuiteFrequencyScope(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high' || normalized === 'only_high' || normalized === '仅高频' || normalized === '高频') return 'high'
  if (
    normalized === 'high_medium'
    || normalized === 'high-medium'
    || normalized === 'highmedium'
    || normalized === 'high+medium'
    || normalized === '高频+次高频'
    || normalized === '高频次高频'
  ) return 'high_medium'
  if (normalized === 'all' || normalized === 'default' || normalized === '全部' || normalized === '全部频率') return 'all'
  if (normalized === 'custom' || normalized === '自选套题') return 'custom'
  return suiteFrequencyOptions.some((option) => option.value === normalized) ? normalized : ''
}

function readLocalStorageValue(key) {
  try {
    return window.localStorage?.getItem(key) || ''
  } catch (_) {
    return ''
  }
}

function writeLocalStorageValue(key, value) {
  try {
    window.localStorage?.setItem(key, String(value))
  } catch (_) {
    // storage is best-effort in packaged and browser-test contexts.
  }
}

function resolveSuitePreference(overrides = {}) {
  const flowMode = normalizeSuiteFlowMode(overrides.flowMode)
    || normalizeSuiteFlowMode(readLocalStorageValue(SUITE_FLOW_MODE_STORAGE_KEY))
    || 'classic'
  const frequencyScope = normalizeSuiteFrequencyScope(overrides.frequencyScope)
    || normalizeSuiteFrequencyScope(readLocalStorageValue(SUITE_FREQUENCY_SCOPE_STORAGE_KEY))
    || 'all'
  const autoAdvanceAfterSubmit = flowMode !== 'stationary'
  return {
    flowMode,
    frequencyScope,
    autoAdvanceAfterSubmit
  }
}

function persistSuitePreference(partial = {}) {
  const next = resolveSuitePreference(partial)
  writeLocalStorageValue(SUITE_FLOW_MODE_STORAGE_KEY, next.flowMode)
  writeLocalStorageValue(SUITE_FREQUENCY_SCOPE_STORAGE_KEY, next.frequencyScope)
  writeLocalStorageValue(SUITE_AUTO_ADVANCE_STORAGE_KEY, next.autoAdvanceAfterSubmit ? 'true' : 'false')
  return next
}

function openSuiteModeSelector(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  const preference = resolveSuitePreference()
  selectedSuiteFlowMode.value = preference.flowMode
  selectedSuiteFrequencyScope.value = preference.frequencyScope
  suiteModeSelectorOpen.value = true
}

function closeSuiteModeSelector() {
  if (creatingSuite.value) return
  suiteModeSelectorOpen.value = false
}

function selectSuiteFlowMode(mode, options = {}) {
  const normalized = normalizeSuiteFlowMode(mode)
  if (!normalized) return
  selectedSuiteFlowMode.value = normalized
  if (options.start) {
    if (selectedSuiteFrequencyScope.value === 'custom') {
      startCustomSuiteSelection()
    } else {
      void startReadingSuite()
    }
  }
}

function buildCustomSuiteExamEntry(asset) {
  if (!asset?.id) return null
  return {
    id: String(asset.id),
    assetId: String(asset.id),
    examId: String(asset.examId || asset.id),
    title: String(asset.title || asset.id),
    category: normalizeCategory(asset.category),
    frequency: normalizeFrequency(asset),
    type: 'reading'
  }
}

function startCustomSuiteSelection() {
  const preference = persistSuitePreference({
    flowMode: selectedSuiteFlowMode.value,
    frequencyScope: 'custom'
  })
  const missingCategory = customSuiteCategories.find((category) => !readingAssets.value.some((asset) => (
    asset?.id
    && asset.activity === 'reading'
    && hasReadingPracticePayload(asset)
    && normalizeCategory(asset.category) === category
  )))
  if (missingCategory) {
    suiteError.value = `当前题库缺少 ${missingCategory} 阅读题目，无法启动自选流程。`
    return
  }
  customSuiteDraft.value = {
    status: 'selecting',
    stageIndex: 0,
    categories: customSuiteCategories.slice(),
    pickedByCategory: {},
    pickedOrder: [],
    flowMode: preference.flowMode,
    frequencyScope: 'custom',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  suiteModeSelectorOpen.value = false
  suiteError.value = ''
  selectedCategory.value = 'P1'
  selectedType.value = 'reading'
  frequencyFilter.value = 'all'
  keyword.value = ''
  activeView.value = 'browse'
}

function selectCustomSuiteAsset(asset) {
  const entry = buildCustomSuiteExamEntry(asset)
  if (!entry || !hasReadingPracticePayload(asset)) {
    showLocalMessage('自选套题只能选择可练习的阅读题目。')
    return
  }
  const expectedCategory = customSuiteCurrentCategory.value
  if (entry.category !== expectedCategory) {
    showLocalMessage(`当前需要选择 ${expectedCategory} 阅读题目。`)
    return
  }
  const draft = customSuiteDraft.value
  if (!draft) return
  const pickedByCategory = {
    ...(draft.pickedByCategory || {}),
    [expectedCategory]: entry
  }
  const pickedOrder = customSuiteCategories
    .map((category) => pickedByCategory[category])
    .filter(Boolean)
  const nextStageIndex = Math.min(pickedOrder.length, customSuiteCategories.length - 1)
  customSuiteDraft.value = {
    ...draft,
    status: pickedOrder.length === customSuiteCategories.length ? 'ready' : 'selecting',
    stageIndex: nextStageIndex,
    pickedByCategory,
    pickedOrder,
    updatedAt: new Date().toISOString()
  }
  const nextCategory = customSuiteCategories[nextStageIndex]
  if (nextCategory && pickedOrder.length < customSuiteCategories.length) {
    selectedCategory.value = nextCategory
    selectedType.value = 'reading'
  }
  showLocalMessage(pickedOrder.length === customSuiteCategories.length
    ? '三篇自选已完成，请确认套题。'
    : `已选择 ${expectedCategory}，继续选择 ${nextCategory}。`)
}

async function confirmCustomSuiteSelection() {
  const draft = customSuiteDraft.value
  const pickedOrder = Array.isArray(draft?.pickedOrder) ? draft.pickedOrder : []
  if (!draft || !customSuiteReady.value || pickedOrder.length !== customSuiteCategories.length) {
    showLocalMessage('当前尚未完成三篇自选，请继续选择后再确认。')
    return
  }
  await startReadingSuite(null, {
    sequence: customSuiteCategories.map((category) => customSuitePickedByCategory.value[category].assetId),
    frequencyScope: 'custom',
    closeSelector: false
  })
}

function cancelCustomSuiteSelection() {
  customSuiteDraft.value = null
  selectedCategory.value = 'all'
  selectedType.value = 'all'
  activeView.value = 'browse'
  showLocalMessage('已取消自选套题。')
}

async function startReadingSuite(event, options = {}) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  creatingSuite.value = true
  suiteError.value = ''
  try {
    const preference = persistSuitePreference({
      flowMode: selectedSuiteFlowMode.value,
      frequencyScope: options.frequencyScope || selectedSuiteFrequencyScope.value
    })
    const createPayload = {
      flowMode: preference.flowMode,
      frequencyScope: preference.frequencyScope
    }
    if (Array.isArray(options.sequence) && options.sequence.length) {
      createPayload.sequence = options.sequence
    }
    const suite = await createReadingSuite(createPayload)
    const sessionId = String(suite?.sessionId || '').trim()
    if (!sessionId) {
      throw new Error('套题 session 创建失败')
    }
    if (options.closeSelector !== false) {
      suiteModeSelectorOpen.value = false
    }
    customSuiteDraft.value = null
    router.push({
      name: 'PracticeReadingSuite',
      params: { sessionId }
    })
  } catch (createError) {
    console.error('创建阅读套题失败:', createError)
    suiteError.value = createError?.message
      ? `阅读套题创建失败：${createError.message}`
      : '阅读套题创建失败，请稍后重试'
  } finally {
    creatingSuite.value = false
  }
}

function openReadingReview(record) {
  const assetId = String(record?.assetId || record?.examId || '').trim()
  const sessionId = String(record?.sessionId || '').trim()
  if (!assetId || !sessionId) return
  const suiteSessionId = getReadingHistorySuiteSessionId(record)
  const target = {
    name: 'PracticeReadingReview',
    params: { assetId, sessionId }
  }
  if (suiteSessionId) {
    target.query = { suiteSessionId }
  }
  router.push(target)
}

function getReadingHistorySuiteSessionId(record) {
  const metadata = record?.metadata || {}
  return String(metadata.suiteSessionId || metadata.suite_session_id || '').trim()
}

function handleHistoryItemClick(record, event) {
  if (bulkDeleteMode.value) {
    toggleHistorySelection(record.id)
    return
  }
  const actionTarget = event.target?.closest?.('[data-record-action]')
  if (actionTarget) return
  openReadingReview(record)
}

function toggleHistorySelection(recordId) {
  const id = String(recordId || '').trim()
  if (!id) return
  const next = new Set(selectedHistoryIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedHistoryIds.value = next
}

async function toggleBulkDeleteMode() {
  if (historyBusy.value) return
  if (!bulkDeleteMode.value) {
    selectedHistoryIds.value = new Set()
    bulkDeleteMode.value = true
    showLocalMessage('批量管理模式已开启，点击记录进行选择')
    return
  }

  const selectedIds = Array.from(selectedHistoryIds.value)
  if (selectedIds.length === 0) {
    bulkDeleteMode.value = false
    return
  }

  if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 条记录吗？此操作不可恢复。`)) {
    bulkDeleteMode.value = false
    selectedHistoryIds.value = new Set()
    return
  }

  historyBusy.value = true
  try {
    await Promise.all(selectedIds.map((recordId) => deleteReadingHistoryRecord(recordId)))
    selectedHistoryIds.value = new Set()
    bulkDeleteMode.value = false
    await loadHistory()
    showLocalMessage(`已删除 ${selectedIds.length} 条练习记录`)
  } catch (error) {
    console.error('批量删除练习记录失败:', error)
    showLocalMessage(error?.message ? `批量删除失败：${error.message}` : '批量删除失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

async function deleteHistoryRecord(record) {
  const recordId = String(record?.id || '').trim()
  if (!recordId || historyBusy.value) return
  const title = record?.title || '无标题'
  const date = formatRecordDate(record)
  if (!window.confirm(`确定要删除这条练习记录吗？\n\n题目: ${title}\n时间: ${date}\n\n此操作不可恢复。`)) {
    return
  }

  historyBusy.value = true
  try {
    await deleteReadingHistoryRecord(recordId)
    selectedHistoryIds.value = new Set(Array.from(selectedHistoryIds.value).filter((id) => id !== recordId))
    await loadHistory()
    showLocalMessage('记录已删除')
  } catch (error) {
    console.error('删除练习记录失败:', error)
    showLocalMessage(error?.message ? `删除记录失败：${error.message}` : '删除记录失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

async function clearPracticeData() {
  if (historyBusy.value) return
  if (!window.confirm('确定要清除所有阅读练习记录吗？此操作不可恢复。')) {
    return
  }

  historyBusy.value = true
  try {
    const result = await clearReadingHistory()
    selectedHistoryIds.value = new Set()
    bulkDeleteMode.value = false
    await loadHistory()
    showLocalMessage(`练习记录已清除${result?.deletedCount ? `：${result.deletedCount} 条` : ''}`)
  } catch (error) {
    console.error('清除练习记录失败:', error)
    showLocalMessage(error?.message ? `清除记录失败：${error.message}` : '清除记录失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

function exportPracticeMarkdown() {
  const records = filteredHistory.value
  if (!records.length) {
    showLocalMessage('暂无可导出的练习记录')
    return
  }
  const lines = [
    '# 阅读练习记录',
    '',
    `导出时间: ${new Date().toLocaleString()}`,
    `记录数量: ${records.length}`,
    ''
  ]
  records.forEach((record, index) => {
    lines.push(
      `## ${index + 1}. ${record.title || '无标题'}`,
      '',
      `- 提交时间: ${formatRecordDate(record)}`,
      `- 用时: ${formatDurationShort(record.duration)}`,
      `- 正确率: ${historyPercentage(record)}%`,
      `- 得分: ${Number(record.correctAnswers || record.score || 0)} / ${Number(record.totalQuestions || 0)}`,
      `- Session: ${record.sessionId || ''}`,
      `- Asset: ${record.assetId || record.examId || ''}`,
      ''
    )
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `reading-practice-records-${new Date().toISOString().slice(0, 10)}.md`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  showLocalMessage('Markdown 导出完成')
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function normalizeReadingBackupEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const archive = entry.archive && typeof entry.archive === 'object' ? entry.archive : null
  if (!archive || archive.activity !== 'reading' || !Array.isArray(archive.submissions)) return null
  const createdAt = String(entry.createdAt || archive.exportedAt || new Date().toISOString())
  const id = String(entry.id || `reading-backup-${createdAt}`).replace(/[^A-Za-z0-9._:-]/g, '-')
  return {
    id,
    createdAt,
    schemaVersion: String(archive.schemaVersion || 'practice-history-archive.v1'),
    count: Number(archive.count || archive.submissions.length || 0),
    archive
  }
}

function readReadingBackups() {
  try {
    const raw = localStorage.getItem(READING_BACKUP_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.map(normalizeReadingBackupEntry).filter(Boolean)
      : []
  } catch (_) {
    return []
  }
}

function persistReadingBackups(backups) {
  const normalized = Array.isArray(backups)
    ? backups.map(normalizeReadingBackupEntry).filter(Boolean).slice(0, MAX_READING_BACKUPS)
    : []
  readingBackups.value = normalized
  try {
    localStorage.setItem(READING_BACKUP_STORAGE_KEY, JSON.stringify(normalized))
  } catch (error) {
    console.warn('保存阅读备份索引失败:', error)
    showLocalMessage('本地备份索引保存失败，请使用导出文件备份。')
  }
}

function formatBackupDate(backup) {
  const timestamp = String(backup?.createdAt || backup?.archive?.exportedAt || '').trim()
  if (!timestamp) return '未知时间'
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString()
}

async function createReadingBackup() {
  if (historyBusy.value) return
  historyBusy.value = true
  try {
    const archive = await exportReadingHistoryArchive()
    const createdAt = new Date().toISOString()
    const backup = normalizeReadingBackupEntry({
      id: `reading-backup-${createdAt.replace(/[:.]/g, '-')}`,
      createdAt,
      archive
    })
    if (!backup) {
      throw new Error('备份数据结构无效')
    }
    persistReadingBackups([backup, ...readingBackups.value.filter((entry) => entry.id !== backup.id)])
    backupListOpen.value = true
    libraryConfigOpen.value = false
    showLocalMessage(`阅读记录备份完成：${backup.count} 条`)
  } catch (error) {
    console.error('创建阅读备份失败:', error)
    showLocalMessage(error?.message ? `备份失败：${error.message}` : '备份失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

function showReadingBackupList() {
  readingBackups.value = readReadingBackups()
  backupListOpen.value = true
  libraryConfigOpen.value = false
  if (!readingBackups.value.length) {
    showLocalMessage('暂无备份记录')
  }
}

function downloadReadingBackup(backup) {
  const normalized = normalizeReadingBackupEntry(backup)
  if (!normalized) {
    showLocalMessage('备份数据无效，无法下载')
    return
  }
  downloadJsonFile(`${normalized.id}.json`, normalized.archive)
  showLocalMessage('备份文件已下载')
}

async function restoreReadingBackup(backup) {
  if (historyBusy.value) return
  const normalized = normalizeReadingBackupEntry(backup)
  if (!normalized) {
    showLocalMessage('备份数据无效，无法恢复')
    return
  }
  if (!window.confirm(`确定要恢复备份 ${normalized.id} 吗？当前阅读练习记录将被替换。`)) {
    return
  }

  historyBusy.value = true
  try {
    await clearReadingHistory()
    const result = await importReadingHistoryArchive(normalized.archive)
    selectedHistoryIds.value = new Set()
    bulkDeleteMode.value = false
    await loadHistory()
    showLocalMessage(`备份恢复完成：${result?.importedCount || 0} 条，跳过 ${result?.skippedCount || 0} 条`)
  } catch (error) {
    console.error('恢复阅读备份失败:', error)
    showLocalMessage(error?.message ? `恢复失败：${error.message}` : '恢复失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

function deleteReadingBackup(backupId) {
  const id = String(backupId || '').trim()
  if (!id) return
  if (!window.confirm(`确定要删除备份 ${id} 吗？此操作不可恢复。`)) {
    return
  }
  persistReadingBackups(readingBackups.value.filter((backup) => backup.id !== id))
  showLocalMessage('备份已删除')
}

async function exportReadingArchive(mode = 'export') {
  if (historyBusy.value) return
  historyBusy.value = true
  try {
    const archive = await exportReadingHistoryArchive()
    const prefix = mode === 'backup' ? 'ielts-reading-practice-backup' : 'ielts-reading-practice-export'
    downloadJsonFile(`${prefix}-${new Date().toISOString().slice(0, 10)}.json`, archive)
    showLocalMessage(`阅读记录${mode === 'backup' ? '备份' : '导出'}完成：${archive?.count || 0} 条`)
  } catch (error) {
    console.error('导出阅读记录失败:', error)
    showLocalMessage(error?.message ? `导出失败：${error.message}` : '导出失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

function triggerReadingArchiveImport() {
  if (historyBusy.value) return
  readingSettingsPanel.value?.click()
}

async function handleReadingArchiveImportChange(event) {
  const input = event?.target
  const file = input?.files?.[0]
  if (!file) return
  try {
    await importReadingArchiveFile(file)
  } finally {
    if (input) {
      input.value = ''
    }
  }
}

async function importReadingArchiveFile(file) {
  historyBusy.value = true
  try {
    const text = await file.text()
    const payload = JSON.parse(text)
    const result = await importReadingHistoryArchive(payload)
    await loadHistory()
    showLocalMessage(`阅读记录导入完成：${result?.importedCount || 0} 条，跳过 ${result?.skippedCount || 0} 条`)
  } catch (error) {
    console.error('导入阅读记录失败:', error)
    showLocalMessage(error?.message ? `导入失败：${error.message}` : '导入失败，请检查 JSON 文件')
  } finally {
    historyBusy.value = false
  }
}

function showReadingLibraryConfigList() {
  libraryConfigOpen.value = true
  backupListOpen.value = false
}

function formatRecordDate(record) {
  const value = String(record?.submittedAt || record?.endTime || record?.startTime || '').trim()
  return value ? new Date(value).toLocaleString() : '未知时间'
}

function getRecordDate(record) {
  const timestamp = safeDateMs(record?.submittedAt || record?.endTime || record?.startTime)
  return timestamp ? new Date(timestamp) : null
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getPracticeSetId(record, dateKey, index) {
  const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {}
  const suiteSessionId = String(metadata.suiteSessionId || metadata.suite_session_id || '').trim()
  if (suiteSessionId) return `suite:${suiteSessionId}`
  const sessionId = String(record?.sessionId || metadata.sessionId || '').trim()
  if (sessionId) return `session:${sessionId}`
  const assetId = String(record?.assetId || record?.examId || metadata.assetId || metadata.examId || '').trim()
  if (assetId && dateKey) return `asset:${dateKey}:${assetId}`
  return dateKey ? `record:${dateKey}:${index}` : ''
}

function resolveHeatmapLevel(count, averageSetsPerActiveDay) {
  if (!count) return 0
  const baseline = Math.max(1, Number(averageSetsPerActiveDay) || 1)
  if (count >= baseline * 2.4) return 4
  if (count >= baseline * 1.6) return 3
  if (count >= baseline) return 2
  return 1
}

function formatDurationShort(durationSec) {
  const seconds = Math.max(0, Math.round(Number(durationSec || 0)))
  if (!seconds) return '0秒'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (!minutes) return `${rest}秒`
  return `${minutes}分${rest ? `${rest}秒` : ''}`
}

function getScoreColor(percentage) {
  if (percentage >= 85) return '#16a34a'
  if (percentage >= 70) return '#ca8a04'
  if (percentage >= 55) return '#ea580c'
  return '#dc2626'
}

function normalizeQuestionKind(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[\s_-]+/g, '_') || 'unknown'
}

function formatQuestionKindLabel(value) {
  const labels = {
    matching_headings: '标题匹配',
    true_false_not_given: '判断题',
    yes_no_not_given: '判断题',
    multiple_choice: '选择题',
    summary_completion: '摘要填空',
    sentence_completion: '句子填空',
    table_completion: '表格填空',
    matching_information: '信息匹配',
    matching_features: '特征匹配',
    matching_sentence_endings: '句尾匹配',
    short_answer: '简答题',
    unknown: '未分类'
  }
  const normalized = normalizeQuestionKind(value)
  return labels[normalized] || normalized.split('_').filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join(' ')
}

function formatExamMetaText(asset) {
  const category = normalizeCategory(asset.category)
  const frequency = asset.metadata?.frequency || asset.difficulty || ''
  const label = frequency ? ` | ${frequency}` : ''
  return `${category} | reading${label}`
}

function getPdfPath(asset) {
  return asset?.metadata?.shuiPdf
    || asset?.metadata?.legacyPath
    || asset?.metadata?.pdfPath
    || asset?.metadata?.pdfFilename
    || asset?.metadata?.legacyFilename
    || ''
}

function hasReadingPracticePayload(asset) {
  const metadata = asset?.metadata || {}
  return Boolean(
    asset?.payloadRef
    || metadata.dataKey
    || metadata.script
  )
}

function viewPdf(asset) {
  const pdfPath = String(getPdfPath(asset) || '').trim()
  if (!pdfPath) {
    showLocalMessage('此题暂未提供 PDF。')
    return
  }
  const targetUrl = resolveLegacyAssetUrl(pdfPath)
  const opened = window.open(
    targetUrl,
    `reading_pdf_${String(asset?.id || Date.now()).replace(/[^A-Za-z0-9_-]/g, '_')}`,
    'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes'
  )
  if (!opened) {
    showLocalMessage('PDF 打开失败：请检查弹窗拦截设置。')
    return
  }
  showLocalMessage(`正在打开 PDF：${pdfPath}`)
}

function clearPracticeCache() {
  const removablePrefixes = [
    'practice_reading_answers_',
    'practice_reading_submission_'
  ]
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index) || ''
    if (removablePrefixes.some((prefix) => key.startsWith(prefix))) {
      sessionStorage.removeItem(key)
    }
  }
  showLocalMessage('阅读练习临时缓存已清除。')
}

function switchBackgroundTheme() {
  themeSwitcherOpen.value = true
}

function applyBackgroundTheme(themeName) {
  const nextTheme = backgroundThemes.some((theme) => theme.value === themeName)
    ? themeName
    : 'misty-mountain'
  if (!switchLegacyBackgroundTheme(nextTheme)) {
    try {
      localStorage.setItem('three_bg_theme', nextTheme)
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('shui-bg-theme-change', { detail: { theme: nextTheme } }))
  }
  themeSwitcherOpen.value = false
  const label = backgroundThemes.find((theme) => theme.value === nextTheme)?.title || nextTheme
  showLocalMessage(`主题已切换：${label}`)
}

function showLocalMessage(message) {
  localMessage.value = message
  window.setTimeout(() => {
    if (localMessage.value === message) {
      localMessage.value = ''
    }
  }, 3200)
}

function updateLiquidIndicator() {
  const nav = document.querySelector('.practice-library-legacy .hero-nav')
  if (!nav) return
  const indicator = nav.querySelector('.hero-nav__liquid-indicator')
  const active = nav.querySelector('.hero-nav__btn.active')
  if (!indicator || !active) return
  const navRect = nav.getBoundingClientRect()
  const activeRect = active.getBoundingClientRect()
  const inset = 3
  indicator.style.left = `${Math.max(0, activeRect.left - navRect.left + inset)}px`
  indicator.style.top = `${Math.max(0, activeRect.top - navRect.top + inset)}px`
  indicator.style.width = `${Math.max(16, activeRect.width - inset * 2)}px`
  indicator.style.height = `${Math.max(16, activeRect.height - inset * 2)}px`
  nav.classList.add('hero-nav--liquid-ready')
}

function updateSegmentedIndicators() {
  document.querySelectorAll('.practice-library-legacy .shui-segmented-control').forEach((control) => {
    const indicator = control.querySelector('.shui-segmented-indicator')
    const active = control.querySelector('.shui-segmented-btn.active, .shui-segmented-btn[aria-pressed="true"]')
    if (!indicator || !active) return
    indicator.style.width = `${active.offsetWidth}px`
    indicator.style.transform = `translateX(${active.offsetLeft}px)`
    indicator.style.opacity = '1'
  })
}
</script>

<style>
.practice-library-legacy {
  --color-white: #fff;
  --color-gray-50: #f8fafc;
  --color-gray-100: #f1f5f9;
  --color-gray-200: #e2e8f0;
  --color-gray-300: #cbd5e1;
  --color-gray-400: #94a3b8;
  --color-gray-500: #64748b;
  --color-gray-600: #475569;
  --color-gray-700: #334155;
  --color-gray-800: #1e293b;
  --color-gray-900: #0f172a;
  --color-brand-primary: #667eea;
  --color-brand-secondary: #764ba2;
  --color-brand-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-info: #3b82f6;
  --space-xs: 8px;
  --space-sm: 12px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-3xl: 1.875rem;
  --font-size-4xl: 2.25rem;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --line-height-tight: 1.25;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
  --border-radius-full: 999px;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.08);
  --shadow-md: 0 8px 24px rgba(15, 23, 42, 0.12);
  --shadow-lg: 0 16px 40px rgba(15, 23, 42, 0.15);
  --transition-normal: 180ms ease;
  position: relative;
  z-index: 1;
  max-width: 1200px;
  margin: 0 auto;
  padding: clamp(32px, 5vw, 72px) clamp(16px, 5vw, 48px) 80px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.hero-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero-header h1 {
  width: 100%;
  margin: 0;
  font-size: clamp(2.2rem, 4.5vw, 3.4rem);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--color-gray-900);
}

.hero-brand-title {
  flex-wrap: wrap;
  row-gap: 10px;
}

.hero-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: clamp(44px, 5vw, 58px);
  height: clamp(44px, 5vw, 58px);
  border-radius: 16px;
  color: #0f2143;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 16px 34px rgba(15, 23, 42, 0.1),
    inset 0 1px 1px rgba(255, 255, 255, 0.72),
    inset 0 -1px 1px rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
}

.hero-brand-text {
  font-family: Georgia, 'Times New Roman', 'WenKai', serif;
  font-size: clamp(2.45rem, 5.2vw, 4.35rem);
  font-weight: 700;
  line-height: 0.96;
  letter-spacing: 0;
  color: #08172f;
  text-shadow:
    0 1px 0 rgba(255, 255, 255, 0.62),
    0 18px 40px rgba(15, 23, 42, 0.16);
}

.hero-brand-subtitle {
  flex: 1 1 320px;
  min-width: 240px;
  color: rgba(51, 65, 85, 0.72);
  font-size: clamp(0.86rem, 1.4vw, 1rem);
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0;
}

.hero-brand-title .inline-hover-link {
  margin-left: auto;
  margin-right: 20px;
  color: inherit;
  display: flex;
  align-items: center;
  transition: opacity 0.2s;
}

.hero-brand-title .inline-hover-link:hover {
  opacity: 0.7;
}

.hero-badge {
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  color: var(--color-white);
}

.hero-badge--redbook {
  background: #ff1c1c;
  box-shadow: 0 12px 30px rgba(255, 77, 79, 0.35);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.hero-nav {
  position: relative;
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 6px;
  margin-bottom: 0;
  flex-wrap: wrap;
  background: rgba(245, 245, 247, 0.55);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 -1px 1px rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  overflow: hidden;
  isolation: isolate;
}

.hero-nav__liquid-indicator {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1;
  pointer-events: none;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.05));
  box-shadow:
    inset 0 2px 3px rgba(255, 255, 255, 0.9),
    inset 0 -2px 5px rgba(255, 255, 255, 0.2),
    inset 0 0 10px rgba(255, 255, 255, 0.4),
    0 4px 12px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  opacity: 0;
  transition: left 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.15), top 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.15), width 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.15), height 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.15), opacity 0.22s ease;
}

.hero-nav.hero-nav--liquid-ready .hero-nav__liquid-indicator {
  opacity: 1;
}

.nav-btn,
.hero-nav__btn {
  flex: 1;
  position: relative;
  z-index: 2;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(60, 60, 67, 0.7);
  padding: 10px 14px;
  border-radius: 999px;
  font-size: 0.95rem;
  font-weight: 600;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: color 260ms ease, background 260ms ease, box-shadow 260ms ease;
}

.hero-nav__btn:hover {
  color: rgba(0, 0, 0, 0.85);
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 0.7);
}

.hero-nav__btn.active {
  color: #1d1d1f;
  background: transparent;
  box-shadow: none;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
}

.view {
  display: none;
  background: #f2f2f2;
  padding: var(--space-2xl);
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-lg);
  border: 2px solid #737373;
  min-height: 400px;
}

.view.active {
  display: block;
}

.view > h2 {
  margin-bottom: var(--space-xl);
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-gray-900);
}

.heading-serif {
  font-family: var(--font-family-display);
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-md);
}

.overview-section-heading {
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.overview-section-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-gray-800);
}

.overview-section-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  border: none;
}

.category-card {
  background: rgba(255, 252, 247, 0.95);
  background-image: linear-gradient(135deg, rgba(252, 214, 172, 0.32), rgba(173, 228, 210, 0.28)), linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(250, 244, 236, 0.9));
  padding: var(--space-xl);
  border-radius: var(--border-radius-xl);
  border: 1px solid rgba(232, 189, 145, 0.35);
  transition: all var(--transition-normal);
  box-shadow: 0 18px 46px rgba(215, 180, 140, 0.2), 0 10px 28px rgba(53, 192, 161, 0.14);
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(14px);
}

.category-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(120deg, #f6b26b 0%, #35c0a1 100%);
  opacity: 0.9;
}

.category-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 22px 58px rgba(92, 119, 230, 0.2), 0 12px 30px rgba(124, 231, 255, 0.16);
  border-color: rgba(232, 189, 145, 0.5);
}

.category-header {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-lg);
}

.category-icon {
  font-size: 2.5rem;
  margin-right: var(--space-lg);
  opacity: 0.8;
}

.category-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-gray-900);
  margin-bottom: var(--space-xs);
}

.category-meta {
  font-size: var(--font-size-sm);
  color: var(--color-gray-600);
  font-weight: var(--font-weight-medium);
}

.category-card .category-actions {
  display: flex;
  gap: var(--space-md);
  margin-top: var(--space-xl);
  flex-wrap: nowrap;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  min-height: 40px;
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--border-radius-lg);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-normal);
  white-space: nowrap;
  background: #bf755a;
  color: #f2f2f2;
}

.btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #bf755a, #a0654a);
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  pointer-events: none;
}

.btn-secondary {
  background: #525918;
  color: #f2f2f2;
}

.btn-secondary:hover:not(:disabled) {
  background: linear-gradient(135deg, #525918, #3a3d10);
  box-shadow: var(--shadow-md);
}

.btn-warning {
  background: #bf75a5;
}

.btn-info {
  background: #bf755a;
}

.btn-outline {
  background: rgba(255, 255, 255, 0.94);
  color: #2f3a3f;
  border: 1px solid rgba(232, 189, 145, 0.35);
}

.btn-sm {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--font-size-xs);
}

.btn-text {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-brand-primary);
  font-weight: 600;
  cursor: pointer;
}

.browse-title-bar,
.hero-panel__header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: var(--space-xl);
}

.browse-title-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.36);
  cursor: pointer;
}

#browse-title {
  margin: 0;
  font-size: var(--font-size-3xl);
}

#type-filter-buttons,
.shui-filter-group,
.hero-panel__actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

#type-filter-buttons {
  margin-left: auto;
}

.shui-filter-btn.active {
  background: var(--color-brand-gradient);
}

.search-box {
  margin-bottom: var(--space-xl);
  position: relative;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-input-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.search-input {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--color-gray-300);
  border-radius: var(--border-radius-lg);
  padding: 0 42px 0 14px;
  background: rgba(255, 255, 255, 0.85);
}

.search-clear-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  background: transparent;
  color: var(--color-gray-500);
  cursor: pointer;
}

.browse-sort-wrapper {
  position: relative;
  min-width: 160px;
}

.browse-sort-select {
  width: 100%;
  min-height: 44px;
  appearance: none;
  border: 1px solid var(--color-gray-300);
  border-radius: var(--border-radius-lg);
  padding: 0 36px 0 14px;
  background: rgba(255, 255, 255, 0.85);
}

.browse-sort-icon {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
}

.exam-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-md);
  max-height: 72vh;
  overflow-y: auto;
  padding-left: var(--space-sm);
  align-content: start;
}

.exam-item {
  background: rgba(255, 252, 247, 0.95);
  padding: var(--space-lg);
  border-radius: var(--border-radius-xl);
  border: 1px solid transparent;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  transition: all var(--transition-normal);
  box-shadow: 0 18px 46px rgba(215, 180, 140, 0.2), 0 10px 28px rgba(53, 192, 161, 0.14);
  position: relative;
  backdrop-filter: blur(12px);
}

.exam-item:hover {
  transform: translateY(-3px);
  border-color: rgba(232, 189, 145, 0.5);
  background: linear-gradient(140deg, rgba(252, 226, 199, 0.96), rgba(188, 228, 213, 0.9));
}

.exam-info {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex: 1;
}

.exam-info h4 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-gray-900);
  line-height: var(--line-height-tight);
}

.exam-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  font-size: var(--font-size-sm);
  color: #3a4148;
  font-weight: var(--font-weight-medium);
  margin-top: var(--space-xs);
  padding: 6px 10px;
  border-radius: var(--border-radius-lg);
  background: rgba(232, 189, 145, 0.18);
}

.exam-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
  width: 100%;
}

.exam-item-action-btn {
  opacity: 0.95;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--border-radius-lg);
  border: 1px solid rgba(232, 189, 145, 0.4);
  background: linear-gradient(135deg, #f6b26b, #35c0a1);
  color: #0f1416;
  box-shadow: 0 8px 20px rgba(215, 180, 140, 0.14), 0 4px 10px rgba(53, 192, 161, 0.12);
}

.exam-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-2xl) var(--space-xl);
  text-align: center;
  border-radius: var(--border-radius-xl);
  background: rgba(226, 232, 240, 0.16);
  border: 1px dashed rgba(148, 163, 184, 0.4);
  color: var(--color-gray-700);
}

.exam-list-empty-icon {
  font-size: 2.5rem;
}

.exam-list-empty-text {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}

.exam-list-empty-hint {
  font-size: var(--font-size-sm);
  color: var(--color-gray-500);
}

.history-empty-placeholder {
  text-align: center;
  padding: 40px;
  opacity: 0.7;
}

.history-empty-placeholder__icon {
  font-size: 3em;
  margin-bottom: 15px;
}

.history-empty-placeholder__note {
  font-size: 0.9em;
  margin-top: 10px;
}

.practice-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-xl);
  margin-bottom: var(--space-2xl);
}

.stat-card {
  background: #f2f2f2;
  padding: var(--space-xl);
  border-radius: var(--border-radius-xl);
  text-align: center;
  border: 2px solid #737373;
  box-shadow: var(--shadow-lg);
  transition: all var(--transition-normal);
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(10px);
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--color-brand-gradient);
}

.stat-number {
  font-size: var(--font-size-4xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-brand-primary);
  margin-bottom: var(--space-sm);
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-gray-600);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.practice-history {
  background: linear-gradient(135deg, #e8e8e8 0%, #ffffff 50%, #e8e8e8 100%);
  border-radius: var(--border-radius-xl);
  padding: var(--space-xl);
  border: 2px solid #737373;
}

.practice-history-header {
  justify-content: flex-start;
}

.practice-history-header > .hero-panel__actions:last-child {
  margin-left: auto;
}

.practice-history-search-row {
  margin-bottom: var(--space-lg);
}

.practice-history-list {
  display: grid;
  gap: var(--space-md);
}

.history-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: var(--space-md);
  align-items: center;
  padding: var(--space-lg);
  border-radius: var(--border-radius-xl);
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.24);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}

.history-item:hover {
  box-shadow: var(--shadow-md);
}

.record-selection-hidden {
  display: none;
}

.practice-record-title {
  color: var(--color-gray-900);
  text-decoration: none;
}

.practice-record-title:hover {
  color: var(--color-brand-primary);
}

.record-meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  color: var(--color-gray-600);
  margin-top: 6px;
}

.record-percentage {
  font-size: 1.3rem;
  font-weight: var(--font-weight-bold);
}

.delete-record-btn {
  border: 0;
  background: transparent;
  cursor: pointer;
  opacity: 0.72;
}

.more-tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-lg);
  margin-top: var(--space-xl);
}

.tool-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-md);
  align-items: center;
  padding: var(--space-xl);
  border-radius: var(--border-radius-xl);
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.78);
  text-align: left;
  cursor: pointer;
}

.tool-card-content h3 {
  margin: 0 0 6px;
}

.tool-card-content p,
.more-view-subtitle,
.hero-panel__muted {
  color: var(--color-gray-600);
  margin: 0;
}

.achievements-modal-content {
  max-width: 720px;
}

.achievements-grid {
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 12px;
  padding: 18px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.achievements-grid::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.hero-settings-group {
  display: grid;
  gap: var(--space-xl);
}

.hero-settings-actions,
.hero-settings-links,
.app-update-details-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
}

.app-update-details-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
  min-width: 220px;
  padding: var(--space-md);
  border-radius: var(--border-radius-lg);
  background: rgba(255, 255, 255, 0.66);
}

.hero-settings-links a {
  color: var(--color-brand-primary);
  font-weight: 600;
}

.inline-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-top: 16px;
  border-radius: var(--border-radius-lg);
}

.inline-message-error {
  color: #7f1d1d;
  background: rgba(254, 226, 226, 0.72);
  border: 1px solid rgba(248, 113, 113, 0.4);
}

.loading {
  text-align: center;
  padding: var(--space-2xl);
  color: var(--color-gray-600);
}

.spinner {
  border: 3px solid var(--color-gray-200);
  border-radius: var(--border-radius-full);
  border-top: 3px solid var(--color-brand-primary);
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 0 auto var(--space-lg);
}

.ui-emoji-icon {
  display: inline-flex;
  width: 1em;
  height: 1em;
  color: currentColor;
  vertical-align: -0.14em;
  flex: 0 0 auto;
}

.ui-emoji-icon :deep(svg),
.tool-card-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
}

.practice-local-message {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 50;
  max-width: min(420px, calc(100vw - 48px));
  padding: 12px 16px;
  border-radius: var(--border-radius-lg);
  color: var(--color-gray-900);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--shadow-lg);
  border: 1px solid rgba(148, 163, 184, 0.28);
}

.is-hidden {
  display: none !important;
}

.theme-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.3s ease, visibility 0s linear 0.3s;
  z-index: 2000;
}

.theme-modal.show {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition: opacity 0.3s ease;
}

.theme-modal-content {
  width: min(900px, 92vw);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 24px;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  transform: scale(0.95);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.theme-modal.show .theme-modal-content {
  transform: scale(1);
}

.theme-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 32px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.theme-modal-header h3 {
  margin: 0;
  color: #0f172a;
  font-size: 1.75rem;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0;
}

.theme-modal-close {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 50%;
  color: #64748b;
  background: rgba(0, 0, 0, 0.05);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
}

.theme-modal-close:hover {
  color: #0f172a;
  background: rgba(0, 0, 0, 0.1);
  transform: rotate(90deg);
}

.theme-modal-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

#license-modal {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
    sans-serif;
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 244, 239, 0.88);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.35s ease, visibility 0s linear 0.35s;
  z-index: 9999;
}

#license-modal.show {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition: opacity 0.35s ease;
}

#license-modal .lm-card {
  max-width: 480px;
  width: calc(100% - 48px);
  background: #fffefb;
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 16px;
  padding: 32px;
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.07),
    0 24px 48px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-sizing: border-box;
  transform: translateY(8px);
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

#license-modal.show .lm-card {
  transform: translateY(0);
}

.clock-overlay {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  z-index: 1200;
  transition:
    opacity var(--transition-normal),
    visibility var(--transition-normal);
}

.clock-overlay.is-hidden {
  display: none !important;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

#license-modal .lm-title {
  color: #1a1614;
  font-size: 22px;
  line-height: 32px;
  font-weight: 600;
  margin: 0 0 24px 0;
}

#license-modal .lm-body {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: left;
}

#license-modal .lm-body p {
  margin: 0;
  color: #5a534e;
  font-size: 15px;
  line-height: 24px;
}

#license-modal .lm-body .lm-warning {
  color: #c06025;
  font-weight: 600;
}

#license-modal .lm-body strong {
  color: #1a1614;
  font-weight: 600;
}

#license-modal .lm-info-box {
  padding: 14px 16px;
  background: #f8f5f0;
  border: 1px solid #ede7dc;
  border-radius: 10px;
}

#license-modal .lm-footer {
  margin-top: 24px;
  width: 100%;
  display: flex;
  justify-content: center;
}

#license-modal .lm-btn {
  background: #1a1614;
  color: #fffefb;
  border: none;
  border-radius: 8px;
  padding: 12px 40px;
  font-size: 15px;
  line-height: 24px;
  font-weight: 500;
  cursor: pointer;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 2px 4px rgba(0, 0, 0, 0.2),
    0 4px 8px rgba(0, 0, 0, 0.1);
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.12s ease;
}

#license-modal .lm-btn:hover {
  background: #2e2521;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.1) inset,
    0 4px 10px rgba(0, 0, 0, 0.22),
    0 8px 20px rgba(0, 0, 0, 0.12);
  transform: translateY(-1px);
}

#license-modal .lm-btn:active {
  background: #0f0c0b;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.05) inset,
    0 1px 3px rgba(0, 0, 0, 0.2);
  transform: translateY(0);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .practice-library-legacy {
    padding: 28px 16px 48px;
  }

  .hero-header h1 {
    flex-wrap: wrap;
  }

  .hero-brand-title .inline-hover-link {
    margin-left: 0;
  }

  .category-grid {
    grid-template-columns: 1fr;
  }

  .overview-section-heading,
  .browse-title-bar,
  .hero-panel__header,
  .search-row {
    align-items: stretch;
    flex-direction: column;
  }

  #type-filter-buttons {
    margin-left: 0;
  }

  .exam-list {
    grid-template-columns: 1fr;
    padding-left: 0;
  }

  .history-item {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .record-percentage-container,
  .record-actions-container {
    grid-column: 2;
  }
}

/* Vue port of opensource@ec47b29 index.html + heroui-bridge.css.
   Keep the legacy DOM/API contract above; this layer restores the actual product skin. */
.practice-library-open-source {
  --shui-shell-max-width: 1400px;
  --shui-panel-bg: rgba(255, 255, 255, 0.25);
  --shui-panel-border: rgba(255, 255, 255, 0.4);
  --shui-panel-shadow: 0 20px 40px rgba(0, 0, 0, 0.1),
    inset 0 1px 1px rgba(255, 255, 255, 0.6),
    inset 0 -1px 1px rgba(255, 255, 255, 0.1);
  --shui-surface-bg: rgba(255, 255, 255, 0.65);
  --shui-surface-border: rgba(148, 163, 184, 0.35);
  --shui-text-strong: var(--color-gray-900);
  --shui-text-muted: rgba(51, 65, 85, 0.7);
  --shui-accent: var(--color-brand-primary);
  --shui-accent-alt: var(--color-brand-secondary);
  --shui-gradient-start: #ffd89b;
  --shui-gradient-end: #6accc7;
  --shui-radius-xl: 28px;
  --shui-radius-lg: 20px;
  --shui-radius-md: 16px;
  --shui-radius-sm: 12px;
  --shui-blur: 32px;
  --bauhaus-text-main: #0f172a;
  --bauhaus-text-muted: #64748b;
  --bauhaus-accent-red: #dc2626;
  --bauhaus-accent-blue: #2563eb;
  --bauhaus-accent-dark: #334155;
  --bloom-surface: rgba(255, 252, 247, 0.95);
  --bloom-border: rgba(232, 189, 145, 0.35);
  --bloom-border-strong: rgba(232, 189, 145, 0.5);
  --bloom-sheen: linear-gradient(135deg, rgba(252, 214, 172, 0.32), rgba(173, 228, 210, 0.28));
  --bloom-highlight: linear-gradient(120deg, #f6b26b 0%, #35c0a1 100%);
  --bloom-shadow: 0 18px 46px rgba(215, 180, 140, 0.2), 0 10px 28px rgba(53, 192, 161, 0.14);
  max-width: var(--shui-shell-max-width);
  color: var(--shui-text-strong);
}

.practice-library-open-source * {
  letter-spacing: normal;
}

.practice-library-open-source .hero-header h1 {
  color: var(--shui-text-strong);
  font-family: var(--font-family-base, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-weight: 700;
  letter-spacing: 0;
}

.practice-library-open-source .view.hero-panel {
  background: var(--shui-panel-bg);
  border-radius: var(--shui-radius-xl);
  border: 1px solid var(--shui-panel-border);
  padding: clamp(28px, 4vw, 48px);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur));
  -webkit-backdrop-filter: blur(var(--shui-blur));
  min-height: 400px;
}

.practice-library-open-source .hero-panel__header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.practice-library-open-source .hero-panel__title {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 600;
  color: var(--shui-text-strong);
}

.practice-library-open-source .hero-panel__actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.practice-library-open-source .hero-nav {
  background: rgba(245, 245, 247, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 -1px 1px rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
}

.practice-library-open-source .hero-nav__liquid-indicator {
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.05));
  box-shadow:
    inset 0 2px 3px rgba(255, 255, 255, 0.9),
    inset 0 -2px 5px rgba(255, 255, 255, 0.2),
    inset 0 0 10px rgba(255, 255, 255, 0.4),
    0 4px 12px rgba(0, 0, 0, 0.06);
}

.practice-library-open-source .hero-nav__btn {
  color: rgba(60, 60, 67, 0.7);
  background: transparent;
  box-shadow: none;
  text-shadow: none;
}

.practice-library-open-source .hero-nav__btn:hover {
  color: rgba(0, 0, 0, 0.85);
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 0.7);
}

.practice-library-open-source .hero-nav__btn.active {
  color: #1d1d1f;
  background: transparent;
  box-shadow: none;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
}

.practice-library-open-source .category-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.practice-library-open-source .overview-section-heading {
  grid-column: 1 / -1;
  margin-bottom: 0;
}

.practice-library-open-source .overview-section-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--color-gray-800);
}

.practice-library-open-source .overview-section-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  border: none;
}

.practice-library-open-source .category-card {
  background: var(--bloom-surface);
  background-image: var(--bloom-sheen), linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(250, 244, 236, 0.9));
  border: 1px solid var(--bloom-border);
  border-radius: var(--shui-radius-lg);
  box-shadow: 0 24px 50px rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

.practice-library-open-source .category-card::before {
  background: rgba(255, 255, 255, 0.3);
  box-shadow: none;
}

.practice-library-open-source .category-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, rgba(255, 216, 155, 0.08), rgba(106, 204, 199, 0.08));
  pointer-events: none;
  mix-blend-mode: screen;
}

.practice-library-open-source .category-card:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 0 35px 60px rgba(15, 23, 42, 0.25);
}

.practice-library-open-source .category-card > * {
  position: relative;
  z-index: 1;
}

.practice-library-open-source .btn,
.practice-library-open-source .hero-btn,
.practice-library-open-source .hero-panel .btn,
.practice-library-open-source .exam-item-action-btn {
  color: #0f172a;
}

.practice-library-open-source .hero-btn,
.practice-library-open-source .hero-panel .btn:not(.hero-btn) {
  border-radius: var(--shui-radius-sm);
  border: none;
  background-image: linear-gradient(135deg, var(--shui-gradient-start), var(--shui-gradient-end));
  color: #0f172a;
  padding: 10px 18px;
  font-weight: 600;
  transition: transform var(--transition-normal), box-shadow var(--transition-normal), background-image var(--transition-normal);
  box-shadow: 0 18px 35px rgba(0, 0, 0, 0.15);
}

.practice-library-open-source .hero-btn:hover,
.practice-library-open-source .hero-panel .btn:not(.hero-btn):hover,
.practice-library-open-source .hero-btn:focus-visible,
.practice-library-open-source .hero-panel .btn:not(.hero-btn):focus-visible {
  transform: translateY(-1px);
  box-shadow: 0 22px 45px rgba(0, 0, 0, 0.22);
}

.practice-library-open-source .hero-btn--ghost,
.practice-library-open-source .hero-panel .btn.btn-secondary {
  background-image: none;
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.5);
  color: var(--shui-text-strong);
  box-shadow: none;
}

.practice-library-open-source .hero-btn--warn,
.practice-library-open-source .hero-panel .btn.btn-warning {
  background-image: linear-gradient(135deg, rgba(255, 216, 155, 0.85), rgba(255, 216, 155, 1));
  color: #3b1f00;
}

.practice-library-open-source .shui-glass-btn {
  position: relative;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 999px;
  color: var(--shui-text-strong);
  font-weight: 600;
  padding: 8px 20px;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.05),
    inset 0 1px 1px rgba(255, 255, 255, 0.8),
    inset 0 -1px 1px rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background-image: none;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
}

.practice-library-open-source .shui-glass-btn:hover,
.practice-library-open-source .shui-glass-btn:focus-visible {
  background: rgba(255, 255, 255, 0.35);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.1),
    inset 0 1px 2px rgba(255, 255, 255, 1),
    inset 0 -1px 1px rgba(255, 255, 255, 0.3);
  transform: translateY(-2px) scale(1.02);
  border-color: rgba(255, 255, 255, 0.65);
}

.practice-library-open-source .shui-segmented-control {
  display: inline-flex;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  padding: 4px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  gap: 2px;
  position: relative;
  isolation: isolate;
}

.practice-library-open-source .shui-segmented-indicator {
  position: absolute;
  top: 4px;
  left: 0;
  height: calc(100% - 8px);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.65);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.12),
    inset 0 1px 1px rgba(255, 255, 255, 1),
    inset 0 -1px 1px rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.8);
  transition: transform 0.4s cubic-bezier(0.25, 1, 0.3, 1), width 0.4s cubic-bezier(0.25, 1, 0.3, 1), opacity 0.2s ease;
  z-index: 0;
  pointer-events: none;
}

.practice-library-open-source .shui-segmented-btn {
  position: relative;
  z-index: 1;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--shui-text-muted);
  font-weight: 600;
  padding: 6px 16px;
  font-size: 0.9rem;
  cursor: pointer;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
  transition: color 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.practice-library-open-source .shui-segmented-btn:hover,
.practice-library-open-source .shui-segmented-btn.active,
.practice-library-open-source .shui-segmented-btn[aria-pressed="true"] {
  color: var(--shui-text-strong);
}

.practice-library-open-source .browse-frequency-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.34);
  box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
}

.practice-library-open-source .browse-frequency-chip {
  min-height: 34px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--shui-text-muted);
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.22s ease, border-color 0.22s ease, color 0.22s ease, transform 0.22s ease;
}

.practice-library-open-source .browse-frequency-chip:hover,
.practice-library-open-source .browse-frequency-chip.active,
.practice-library-open-source .browse-frequency-chip[aria-pressed="true"] {
  color: var(--shui-text-strong);
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(255, 255, 255, 0.78);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.09), inset 0 1px 1px rgba(255, 255, 255, 0.95);
}

.practice-library-open-source .browse-frequency-chip:hover {
  transform: translateY(-1px);
}

.practice-library-open-source .category-card .btn[data-action="browse-category"],
.practice-library-open-source .category-card .btn[data-action="start-random-practice"] {
  background-image: none;
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.55);
  color: #0f172a;
  box-shadow: 0 18px 35px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.practice-library-open-source .category-card .btn[data-action="browse-category"]:hover,
.practice-library-open-source .category-card .btn[data-action="start-random-practice"]:hover,
.practice-library-open-source .category-card .btn[data-action="browse-category"]:focus-visible,
.practice-library-open-source .category-card .btn[data-action="start-random-practice"]:focus-visible {
  background: rgba(255, 255, 255, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 22px 45px rgba(15, 23, 42, 0.18);
}

.practice-library-open-source #browse-view .exam-item-action-btn {
  background: rgba(255, 255, 255, 0.35);
  background-image: none;
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  border-radius: var(--shui-radius-sm);
  color: #1d1d1f;
  font-weight: 600;
  padding: 8px 16px;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  transform: translateY(0) scale(1);
}

.practice-library-open-source #browse-view .exam-item-action-btn:hover,
.practice-library-open-source #browse-view .exam-item-action-btn:focus-visible {
  background: rgba(255, 255, 255, 0.58);
  box-shadow:
    0 8px 20px rgba(0, 0, 0, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 1);
  transform: translateY(-1px) scale(1.01);
  border-color: rgba(255, 255, 255, 0.75);
}

.practice-library-open-source #browse-view .exam-item-action-btn[data-action="start"] {
  background: linear-gradient(135deg, rgba(255, 216, 155, 0.3), rgba(106, 204, 199, 0.25));
  border-color: rgba(255, 216, 155, 0.4);
  color: #2d5a58;
}

.practice-library-open-source #browse-view .exam-item-action-btn[data-action="start"]:hover {
  background: linear-gradient(135deg, rgba(255, 216, 155, 0.5), rgba(106, 204, 199, 0.4));
  border-color: rgba(106, 204, 199, 0.5);
  box-shadow:
    0 8px 20px rgba(106, 204, 199, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 1);
}

.practice-library-open-source .hero-card {
  position: relative;
  padding: 32px;
  border-radius: var(--shui-radius-lg);
  background: var(--shui-panel-bg);
  border: 1px solid var(--shui-panel-border);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur));
  -webkit-backdrop-filter: blur(var(--shui-blur));
  overflow: hidden;
}

.practice-library-open-source .hero-card::before {
  display: none;
}

.practice-library-open-source .hero-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at top right, rgba(255, 255, 255, 0.65), transparent 55%);
  pointer-events: none;
}

.practice-library-open-source .hero-card__label,
.practice-library-open-source .stat-label {
  font-size: 0.95rem;
  color: var(--shui-text-muted);
  text-transform: uppercase;
}

.practice-library-open-source .hero-card__value,
.practice-library-open-source .stat-number {
  font-size: clamp(2.4rem, 4vw, 3.1rem);
  font-weight: 700;
  margin-top: 16px;
  color: var(--shui-text-strong);
}

.practice-library-open-source .practice-view__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.practice-library-open-source .practice-summary-toggle {
  position: relative;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.72), 0 8px 18px rgba(15, 23, 42, 0.08);
  cursor: pointer;
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
}

.practice-library-open-source .practice-summary-toggle__glyph {
  position: absolute;
  inset: 0;
  display: block;
}

.practice-library-open-source .practice-summary-toggle__glyph::before,
.practice-library-open-source .practice-summary-toggle__glyph::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 2px;
  border-radius: 999px;
  background: var(--shui-text-strong);
  transition: transform 0.22s ease;
}

.practice-library-open-source .practice-summary-toggle__glyph::before {
  transform: translate(-80%, -50%) rotate(45deg);
}

.practice-library-open-source .practice-summary-toggle__glyph::after {
  transform: translate(-20%, -50%) rotate(-45deg);
}

.practice-library-open-source .practice-summary-toggle[aria-expanded="false"] .practice-summary-toggle__glyph::before {
  transform: translate(-80%, -50%) rotate(-45deg);
}

.practice-library-open-source .practice-summary-toggle[aria-expanded="false"] .practice-summary-toggle__glyph::after {
  transform: translate(-20%, -50%) rotate(45deg);
}

.practice-library-open-source .practice-summary-region {
  display: block;
  margin-bottom: 24px;
}

.practice-library-open-source .practice-summary-region[hidden] {
  display: none;
}

.practice-library-open-source .practice-insights-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
  gap: 18px;
  margin-bottom: 26px;
}

.practice-library-open-source .practice-trend-card,
.practice-library-open-source .practice-custom-card {
  position: relative;
  min-height: 270px;
  border-radius: var(--shui-radius-lg);
  color: var(--shui-text-strong);
  perspective: 1200px;
  outline: none;
}

.practice-library-open-source .practice-trend-card__rotor,
.practice-library-open-source .practice-custom-card__rotor {
  position: relative;
  min-height: 270px;
  border-radius: inherit;
  transition: transform 0.62s cubic-bezier(0.16, 1, 0.3, 1);
  transform-style: preserve-3d;
}

.practice-library-open-source .practice-custom-card.is-flipped .practice-custom-card__rotor {
  transform: rotateY(180deg);
}

.practice-library-open-source .practice-trend-card__face {
  min-height: 270px;
  padding: 24px;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(24px) saturate(155%);
  -webkit-backdrop-filter: blur(24px) saturate(155%);
}

.practice-library-open-source .practice-trend-card__face {
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.practice-library-open-source .practice-trend-card:not(.practice-custom-card) .practice-trend-card__back {
  display: none;
}

.practice-library-open-source .practice-custom-card .practice-trend-card__face {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.practice-library-open-source .practice-custom-card .practice-custom-card__back {
  transform: rotateY(180deg);
}

.practice-library-open-source .practice-trend-card__header,
.practice-library-open-source .practice-trend-card__title-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.practice-library-open-source .practice-trend-card__eyebrow {
  margin: 0 0 6px;
  color: var(--shui-text-muted);
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}

.practice-library-open-source .practice-trend-card__title {
  margin: 0;
  font-size: 1.1rem;
  color: var(--shui-text-strong);
}

.practice-library-open-source .practice-trend-card__metrics {
  display: flex;
  gap: 14px;
  text-align: right;
}

.practice-library-open-source .practice-trend-card__metric-value {
  display: block;
  font-size: 1.35rem;
  font-weight: 800;
}

.practice-library-open-source .practice-trend-card__metric-label {
  color: var(--shui-text-muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.practice-library-open-source .practice-trend-card__range {
  align-self: flex-start;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.5);
  color: var(--shui-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.practice-library-open-source .practice-trend-chart-shell {
  position: relative;
  height: 132px;
  margin-top: 28px;
  border-radius: var(--shui-radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.2));
  border: 1px solid rgba(255, 255, 255, 0.38);
  overflow: hidden;
}

.practice-library-open-source #practice-trend-canvas {
  display: none;
}

.practice-library-open-source .practice-trend-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--shui-text-muted);
  font-weight: 700;
}

.practice-library-open-source .practice-trend-bars {
  position: absolute;
  inset: 14px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.practice-library-open-source .practice-trend-bar {
  flex: 1 1 0;
  min-width: 8px;
  border-radius: 999px 999px 4px 4px;
  background: linear-gradient(180deg, rgba(106, 204, 199, 0.95), rgba(255, 216, 155, 0.78));
  box-shadow: 0 8px 18px rgba(53, 192, 161, 0.16);
}

.practice-library-open-source .practice-trend-options,
.practice-library-open-source .practice-custom-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.practice-library-open-source .practice-trend-option,
.practice-library-open-source .practice-custom-option {
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35);
  color: var(--shui-text-strong);
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
}

.practice-library-open-source .practice-trend-option.active,
.practice-library-open-source .practice-custom-option.active {
  background: linear-gradient(135deg, rgba(255, 216, 155, 0.72), rgba(106, 204, 199, 0.56));
}

.practice-library-open-source .practice-custom-card__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.practice-library-open-source .practice-heatmap-month-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.45);
}

.practice-library-open-source .practice-heatmap-month-label {
  min-width: 42px;
  text-align: center;
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--shui-text-muted);
}

.practice-library-open-source .practice-custom-card__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.52);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.36);
  color: var(--shui-text-strong);
  cursor: pointer;
}

.practice-library-open-source .practice-custom-widget-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.practice-library-open-source .practice-heatmap {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  margin-top: 20px;
}

.practice-library-open-source .practice-heatmap__cell {
  aspect-ratio: 1;
  min-width: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.36);
  border: 1px solid rgba(255, 255, 255, 0.36);
}

.practice-library-open-source .practice-heatmap__cell--1,
.practice-library-open-source .practice-heatmap__legend-cell--1 {
  background: rgba(191, 237, 205, 0.9);
}

.practice-library-open-source .practice-heatmap__cell--2,
.practice-library-open-source .practice-heatmap__legend-cell--2 {
  background: rgba(130, 220, 161, 0.92);
}

.practice-library-open-source .practice-heatmap__cell--3,
.practice-library-open-source .practice-heatmap__legend-cell--3 {
  background: rgba(69, 191, 99, 0.92);
}

.practice-library-open-source .practice-heatmap__cell--4,
.practice-library-open-source .practice-heatmap__legend-cell--4 {
  background: rgba(31, 143, 70, 0.94);
}

.practice-library-open-source .practice-heatmap__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  color: var(--shui-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.practice-library-open-source .practice-heatmap__legend {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.practice-library-open-source .practice-heatmap__legend-cell {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.36);
  border: 1px solid rgba(255, 255, 255, 0.4);
}

.practice-library-open-source .practice-radar-chart-shell {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 160px;
  align-items: center;
  justify-content: center;
  margin-top: 18px;
  border-radius: var(--shui-radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.2));
  border: 1px solid rgba(255, 255, 255, 0.38);
  overflow: hidden;
}

.practice-library-open-source #practice-radar-canvas {
  display: none;
}

.practice-library-open-source .practice-radar-bars {
  display: grid;
  width: 100%;
  gap: 10px;
  padding: 16px;
}

.practice-library-open-source .practice-radar-bar {
  display: grid;
  grid-template-columns: minmax(80px, 0.8fr) minmax(0, 1fr) 28px;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--shui-text-muted);
}

.practice-library-open-source .practice-radar-bar__track {
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
  overflow: hidden;
}

.practice-library-open-source .practice-radar-bar__fill {
  display: block;
  width: max(8px, var(--radar-value));
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(255, 216, 155, 0.94), rgba(106, 204, 199, 0.86));
}

.practice-library-open-source .practice-radar-summary {
  margin: 10px 0 0;
  color: var(--shui-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
  text-align: center;
}

.practice-library-open-source .priority-progress-stack {
  display: grid;
  gap: 16px;
  margin-top: 28px;
}

.practice-library-open-source .priority-progress__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--shui-text-strong);
  font-weight: 800;
}

.practice-library-open-source .priority-progress__track {
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.44);
  border: 1px solid rgba(255, 255, 255, 0.45);
  overflow: hidden;
}

.practice-library-open-source .priority-progress__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(255, 216, 155, 0.94), rgba(106, 204, 199, 0.86));
  transition: width 0.28s ease;
}

.practice-library-open-source .priority-accuracy {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 24px;
}

.practice-library-open-source .priority-accuracy__orb {
  min-height: 88px;
  display: grid;
  place-items: center;
  padding: 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.48);
  text-align: center;
}

.practice-library-open-source .priority-accuracy__orb span {
  display: block;
  font-size: 1.3rem;
  font-weight: 800;
}

.practice-library-open-source .priority-accuracy__orb small {
  color: var(--shui-text-muted);
  font-weight: 700;
}

.practice-library-open-source .practice-history.hero-panel {
  background: var(--shui-panel-bg);
  border: 1px solid var(--shui-panel-border);
  border-radius: var(--shui-radius-xl);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur));
  -webkit-backdrop-filter: blur(var(--shui-blur));
}

.practice-library-open-source .practice-history-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 8px;
}

.practice-library-open-source .history-item {
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  padding: 16px 24px;
  border-radius: var(--shui-radius-md);
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow:
    0 12px 24px rgba(15, 23, 42, 0.08),
    inset 0 1px 1px rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.practice-library-open-source .history-item:hover {
  transform: translateY(-1px);
  box-shadow:
    0 18px 30px rgba(15, 23, 42, 0.12),
    inset 0 1px 1px rgba(255, 255, 255, 0.85);
}

.practice-library-open-source .suite-mode-selector-modal {
  z-index: 9999;
}

.practice-library-open-source .suite-mode-selector-content {
  width: min(420px, 92vw);
  border-radius: 16px;
}

.practice-library-open-source .suite-mode-selector-subtitle {
  margin: 6px 0 0;
  color: var(--shui-text-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.practice-library-open-source .suite-mode-selector-body {
  display: grid;
  gap: 18px;
}

.practice-library-open-source .suite-flow-options {
  display: grid;
  gap: 10px;
}

.practice-library-open-source .suite-flow-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 14px 16px;
  border: 2px solid transparent;
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.82);
  color: var(--shui-text-strong);
  text-align: left;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.practice-library-open-source .suite-flow-option small {
  color: var(--shui-text-muted);
  font-size: 0.78rem;
  font-weight: 500;
}

.practice-library-open-source .suite-flow-option:hover,
.practice-library-open-source .suite-flow-option:focus-visible {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.92);
}

.practice-library-open-source .suite-flow-option.active,
.practice-library-open-source .suite-flow-option[aria-pressed="true"] {
  border-color: rgba(102, 126, 234, 0.78);
  background: rgba(102, 126, 234, 0.1);
  box-shadow: 0 0 0 1px rgba(102, 126, 234, 0.58);
}

.practice-library-open-source .suite-frequency-selector {
  display: grid;
  gap: 8px;
  color: var(--shui-text-strong);
  font-size: 0.86rem;
  font-weight: 800;
}

.practice-library-open-source .suite-frequency-select {
  width: 100%;
  min-height: 44px;
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.5);
  border-radius: 10px;
  padding: 0 14px;
  background: rgba(255, 255, 255, 0.86);
  color: var(--shui-text-strong);
  font: inherit;
}

.practice-library-open-source .suite-mode-selector-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.practice-library-open-source .custom-suite-selection-bar {
  display: grid;
  gap: 12px;
  margin: 14px 0 18px;
  padding: 14px 16px;
  border-radius: var(--shui-radius-md);
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 12px 24px rgba(15, 23, 42, 0.08),
    inset 0 1px 1px rgba(255, 255, 255, 0.74);
}

.practice-library-open-source .custom-suite-selection-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--shui-text-strong);
  font-size: 0.92rem;
}

.practice-library-open-source .custom-suite-selection-main span {
  color: var(--shui-text-muted);
  font-weight: 700;
}

.practice-library-open-source .custom-suite-picked-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.practice-library-open-source .custom-suite-picked-chip {
  display: inline-flex;
  max-width: 100%;
  min-height: 30px;
  align-items: center;
  border-radius: 999px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.52);
  border: 1px solid rgba(148, 163, 184, 0.34);
  color: var(--shui-text-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.practice-library-open-source .custom-suite-picked-chip.filled {
  background: rgba(102, 126, 234, 0.12);
  border-color: rgba(102, 126, 234, 0.38);
  color: var(--shui-text-strong);
}

.practice-library-open-source .custom-suite-selection-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.practice-library-open-source .hero-surface,
.practice-library-open-source .app-update-details-row {
  background: var(--shui-surface-bg);
  border-radius: var(--shui-radius-lg);
  border: 1px solid var(--shui-surface-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.practice-library-open-source #settings-view {
  margin-top: 20px;
}

.practice-library-open-source #settings-view .hero-settings-group {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
}

.practice-library-open-source #settings-view .hero-panel {
  position: relative;
  overflow: hidden;
  padding: 32px;
  border-radius: var(--shui-radius-lg);
  border: 1px solid var(--shui-panel-border);
  background: var(--shui-panel-bg);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.3s ease, border-color 0.3s ease;
}

.practice-library-open-source #settings-view .hero-panel:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.7);
  box-shadow:
    0 30px 60px rgba(0, 0, 0, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}

.practice-library-open-source #settings-view .hero-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.practice-library-open-source #settings-view .hero-panel > * {
  position: relative;
  z-index: 1;
}

.practice-library-open-source #settings-view h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 0.5rem;
  color: var(--bauhaus-text-main);
  font-size: 1.25rem;
  font-weight: 700;
}

.practice-library-open-source #settings-view .hero-panel__muted {
  margin: 0 0 24px;
  color: var(--bauhaus-text-muted);
  font-size: 0.9rem;
}

.practice-library-open-source #settings-view .hero-settings-actions {
  display: flex;
  flex-flow: row wrap;
  gap: 12px;
  margin-top: 8px;
}

.practice-library-open-source #settings-view .hero-settings-actions .btn {
  flex: 1 1 auto;
  min-width: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.practice-library-open-source #settings-view .btn {
  position: relative;
  z-index: 1;
  overflow: hidden;
  padding: 10px 24px;
  border: none;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.practice-library-open-source #settings-view .btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.2), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.practice-library-open-source #settings-view .btn:hover {
  transform: translateY(-3px) scale(1.02);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
}

.practice-library-open-source #settings-view .btn:hover::after {
  opacity: 1;
}

.practice-library-open-source #settings-view #clear-cache-btn {
  color: var(--bauhaus-accent-red);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(220, 38, 38, 0.2);
}

.practice-library-open-source #settings-view #clear-cache-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-red);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(220, 38, 38, 0.3);
}

.practice-library-open-source #settings-view #load-library-btn,
.practice-library-open-source #settings-view #library-config-btn,
.practice-library-open-source #settings-view #force-refresh-btn,
.practice-library-open-source #settings-view #theme-switcher-btn-entry,
.practice-library-open-source #settings-view #show-onboarding-btn {
  color: var(--bauhaus-text-main);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.15);
}

.practice-library-open-source #settings-view #load-library-btn:hover,
.practice-library-open-source #settings-view #library-config-btn:hover,
.practice-library-open-source #settings-view #force-refresh-btn:hover,
.practice-library-open-source #settings-view #theme-switcher-btn-entry:hover,
.practice-library-open-source #settings-view #show-onboarding-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-blue);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(37, 99, 235, 0.3);
}

.practice-library-open-source #settings-view .data-mgmt-btn {
  color: var(--bauhaus-accent-dark);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.15);
}

.practice-library-open-source #settings-view .data-mgmt-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-dark);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.25);
}

.practice-library-open-source #settings-view .settings-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.practice-library-open-source #settings-view .system-info-surface {
  display: grid;
  gap: 4px;
  margin-top: 15px;
  padding: 16px;
  line-height: 1.8;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.practice-library-open-source #settings-view .system-info-status {
  color: var(--color-success);
}

.practice-library-open-source #settings-view .legacy-team-links {
  display: block;
  margin-top: 30px;
  padding-top: 20px;
  text-align: center;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.practice-library-open-source #settings-view .legacy-team-links a {
  display: block;
  text-decoration: none;
  font-size: 0.9em;
  transition: opacity 0.2s, color 0.3s ease;
}

.practice-library-open-source #settings-view .hero-settings-links__feedback {
  margin-bottom: 12px;
  color: #ff1c1c;
  font-weight: 700;
}

.practice-library-open-source #settings-view .hero-settings-links__github {
  color: gray;
}

.practice-library-open-source .backup-list-container {
  width: 100%;
  max-width: 1080px;
  margin: 28px auto 0;
}

.practice-library-open-source .backup-list-card {
  width: 100%;
  padding: 24px;
  color: var(--shui-text-strong);
  background: var(--shui-panel-bg);
  border: 1px solid var(--shui-panel-border);
  border-radius: var(--shui-radius-lg);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--shui-blur)) saturate(150%);
}

.practice-library-open-source .backup-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.practice-library-open-source .backup-list-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--bauhaus-text-main);
  font-size: 1.18rem;
  font-weight: 800;
}

.practice-library-open-source .backup-list-title-icon {
  font-size: 1.45rem;
}

.practice-library-open-source .backup-list-scroll {
  max-height: 640px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.practice-library-open-source .backup-entry {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--shui-radius-md);
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow:
    0 12px 24px rgba(15, 23, 42, 0.08),
    inset 0 1px 1px rgba(255, 255, 255, 0.7);
  transition: transform 0.24s ease, box-shadow 0.24s ease, background 0.24s ease;
}

.practice-library-open-source .backup-entry:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.68);
  box-shadow:
    0 18px 30px rgba(15, 23, 42, 0.12),
    inset 0 1px 1px rgba(255, 255, 255, 0.85);
}

.practice-library-open-source .backup-entry-info {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.practice-library-open-source .backup-entry-id {
  color: var(--bauhaus-text-main);
  word-break: break-word;
}

.practice-library-open-source .backup-entry-meta {
  color: var(--bauhaus-text-muted);
  font-size: 0.86rem;
  font-weight: 700;
}

.practice-library-open-source .backup-entry-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.practice-library-open-source .backup-list-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 28px 18px;
  color: var(--bauhaus-text-main);
  background: rgba(255, 255, 255, 0.5);
  border: 1px dashed rgba(255, 255, 255, 0.62);
  border-radius: var(--shui-radius-md);
}

.practice-library-open-source .backup-list-empty-icon {
  font-size: 2rem;
  margin-bottom: 8px;
}

.practice-library-open-source .backup-list-empty-text,
.practice-library-open-source .backup-list-empty-hint {
  margin: 4px 0 0;
}

.practice-library-open-source .backup-list-empty-hint {
  color: var(--bauhaus-text-muted);
  font-size: 0.88rem;
}

.practice-library-open-source .reading-library-config-scroll {
  grid-template-columns: 1fr;
}

.practice-library-open-source #more-view .tool-card {
  border-radius: var(--shui-radius-lg);
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: 0 22px 44px rgba(0, 0, 0, 0.18);
  transition: transform var(--transition-normal), box-shadow var(--transition-normal), background var(--transition-normal);
  color: var(--shui-text-strong);
}

.practice-library-open-source #more-view .tool-card:hover,
.practice-library-open-source #more-view .tool-card:focus-visible {
  transform: translateY(-2px);
  box-shadow: 0 28px 52px rgba(0, 0, 0, 0.22);
  background: rgba(255, 255, 255, 0.38);
}

@media (max-width: 900px) {
  .practice-library-open-source .hero-nav {
    flex-direction: column;
  }

  .practice-library-open-source .category-grid,
  .practice-library-open-source .practice-history-list {
    grid-template-columns: 1fr;
  }

  .practice-library-open-source .overview-section-heading,
  .practice-library-open-source .browse-title-bar,
  .practice-library-open-source .hero-panel__header,
  .practice-library-open-source .search-row {
    align-items: stretch;
    flex-direction: column;
  }

  .practice-library-open-source #type-filter-buttons {
    margin-left: 0;
  }

  .practice-library-open-source .hero-panel__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .practice-library-open-source #settings-view .hero-settings-group {
    grid-template-columns: 1fr;
  }

  .practice-library-open-source .history-item {
    grid-template-columns: auto minmax(0, 1fr);
  }
}
</style>
