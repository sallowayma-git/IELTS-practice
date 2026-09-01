<template>
  <section class="practice-library" data-practice-reading-home data-library-ready>
    <header class="library-workspace-header">
      <div class="library-workspace-header__copy">
        <p class="library-workspace-header__eyebrow">Reading workspace</p>
        <h1 class="library-workspace-header__title">阅读练习</h1>
      </div>

      <nav class="library-view-tabs" aria-label="阅读工作区">
        <button
          v-for="item in libraryViews"
          :key="item.value"
          type="button"
          :class="['library-view-tabs__button', { active: activeView === item.value }]"
          :data-view="item.value"
          :aria-current="activeView === item.value ? 'page' : undefined"
          @click="showView(item.value)"
        >
          <span class="ui-emoji-icon" v-html="item.icon"></span>
          {{ item.label }}
        </button>
      </nav>
    </header>

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
      @open-reading-memorize="openReadingMemorize"
    />

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
      :class="['clock-overlay', { 'is-hidden': !clockOpen }]"
      role="dialog"
      aria-modal="true"
      aria-label="全屏时钟"
    >
      <div class="clock-overlay-inner" data-clock-role="overlay-inner">
        <button
          class="clock-action-btn clock-close-btn"
          type="button"
          aria-label="关闭时钟"
          @click="closeClockTool"
        >
          <svg class="fullscreen-icon icon-close" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <line x1="8" y1="8" x2="16" y2="16"></line>
            <line x1="16" y1="8" x2="8" y2="16"></line>
          </svg>
        </button>
        <time class="native-clock" :datetime="clockIso" aria-live="off">{{ clockText }}</time>
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
      :latest-asset-read-label="latestAssetReadLabel"
      v-model:library-config-open="libraryConfigOpen"
      :loading="loading"
      @load-reading-data="reloadReadingLibrary"
      @show-reading-library-config-list="showReadingLibraryConfigList"
      @open-global-settings="openGlobalSettings"
      @export-reading-archive="exportReadingArchive"
      @trigger-reading-archive-import="triggerReadingArchiveImport"
      @reading-archive-import-change="handleReadingArchiveImportChange"
    />

    <div v-if="pdfViewer.open" class="dialog-overlay pdf-viewer-overlay" @click.self="closePdfViewer">
      <section class="dialog pdf-viewer-dialog" role="dialog" aria-modal="true" :aria-label="pdfViewer.title">
        <div class="pdf-viewer-header">
          <strong>{{ pdfViewer.title }}</strong>
          <button class="btn-text" type="button" aria-label="关闭 PDF" @click="closePdfViewer">关闭</button>
        </div>
        <iframe class="pdf-viewer-frame" :src="pdfViewer.dataUrl" :title="pdfViewer.title"></iframe>
      </section>
    </div>

    <p v-if="localMessage" class="practice-local-message" role="status">{{ localMessage }}</p>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import { historyPercentage, safeDateMs, sortReadingHistory } from '@/modules/practice-reading/historyStats'
import { useTauriPreferences } from '@/composables/useTauriPreferences.js'
import { getScoreColor } from '@/utils/score-color'
import { createEndless, createMemorize } from '@/api/modes-repository.js'
import { getReadingPdfDataUrl, pickReadingPracticeAsset } from '@/api/reading-repository.js'

const router = useRouter()
const route = useRoute()
const preferences = useTauriPreferences()
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
  clockLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'
}

const libraryViews = [
  { value: 'overview', label: '总览', icon: icons.overview },
  { value: 'browse', label: '题库浏览', icon: icons.book },
  { value: 'practice', label: '练习记录', icon: icons.edit },
  { value: 'more', label: '更多', icon: icons.more },
  { value: 'settings', label: '数据工具', icon: icons.settings }
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
const clockOpen = ref(false)
const clockNow = ref(new Date())
let clockTimer = 0
const clockText = computed(() => clockNow.value.toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
}))
const clockIso = computed(() => clockNow.value.toISOString())
const libraryConfigOpen = ref(false)
const suiteModeSelectorOpen = ref(false)
const selectedSuiteFlowMode = ref(resolveSuitePreference().flowMode)
const selectedSuiteFrequencyScope = ref(resolveSuitePreference().frequencyScope)
const customSuiteDraft = ref(null)
const heatmapMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const readingAssets = ref([])
const readingHistory = ref([])
const readingSettingsPanel = ref(null)
const loading = ref(false)
const loadingHistory = ref(false)
const historyBusy = ref(false)
const creatingSuite = ref(false)
const error = ref('')
const historyError = ref('')
const suiteError = ref('')
const localMessage = ref('')
const pdfViewer = ref({ open: false, title: '', dataUrl: '' })
const bulkDeleteMode = ref(false)
const selectedHistoryIds = ref(new Set())
const latestAssetReadAt = ref(null)
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
const pdfAssetCount = computed(() => readingAssets.value.filter((asset) => Boolean(asset?.pdfOnly)).length)
const libraryStatusLabel = computed(() => readingAssets.value.length ? '本地索引已读取' : '尚未读取')
const latestAssetReadLabel = computed(() => latestAssetReadAt.value ? latestAssetReadAt.value.toLocaleString() : '尚未读取')
const customSuitePickedByCategory = computed(() => customSuiteDraft.value?.pickedByCategory || {})
const customSuiteCurrentCategory = computed(() => customSuiteCategories[customSuiteDraft.value?.stageIndex || 0] || 'P1')
const customSuiteReady = computed(() => customSuiteCategories.every((category) => Boolean(customSuitePickedByCategory.value[category]?.id)))

onMounted(async () => {
  await preferences.hydrate()
  browseRememberPosition.value = readBrowseRememberPosition()
  const suitePreference = resolveSuitePreference()
  selectedSuiteFlowMode.value = suitePreference.flowMode
  selectedSuiteFrequencyScope.value = suitePreference.frequencyScope
  syncViewFromRoute()
  loadReadingData()
  updateSegmentedIndicators()
  scheduleBrowsePositionRestore()
})

onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
})

watch(() => route.query.view, () => {
  syncViewFromRoute()
})

watch(activeView, (value) => {
  updateRouteView(value)
  nextTick(() => {
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

async function loadReadingData() {
  await Promise.all([
    loadAssets(),
    loadHistory()
  ])
}

async function loadAssets() {
  loading.value = true
  error.value = ''
  try {
    const result = await loadReadingAssets()
    readingAssets.value = Array.isArray(result?.data) ? result.data : []
    latestAssetReadAt.value = new Date()
    scheduleBrowsePositionRestore()
    return true
  } catch (loadError) {
    console.error('读取阅读题库失败:', loadError)
    readingAssets.value = []
    error.value = loadError?.message
      ? `阅读题库读取失败：${loadError.message}`
      : '阅读题库读取失败，请稍后重试'
    return false
  } finally {
    loading.value = false
  }
}

async function reloadReadingLibrary(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  if (await loadAssets()) {
    showLocalMessage('已重新读取本机题库索引')
  }
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
  if (libraryViews.some((item) => item.value === view)) {
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
  if (!libraryViews.some((item) => item.value === view)) return
  activeView.value = view
}

function openGlobalSettings(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  router.push({ name: 'Settings' }).catch(() => {})
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
  const value = preferences.get('browse_view_preferences_v2', {})
  return value && typeof value === 'object' ? value : {}
}

function writeBrowsePreferences(patch = {}) {
  preferences.set('browse_view_preferences_v2', {
    ...readBrowsePreferences(),
    ...(patch && typeof patch === 'object' ? patch : {})
  })
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
  if (asset.pdfOnly) {
    void viewPdf(asset)
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

async function startRandomPractice(category = 'all') {
  const normalizedCategory = category === 'all' ? 'all' : normalizeCategory(category)
  try {
    const picked = await pickReadingPracticeAsset(normalizedCategory)
    const assetId = String(picked?.assetId || '').trim()
    if (!assetId) throw new Error('阅读题库未返回可练习题目')
    const selected = readingAssets.value.find((asset) => String(asset?.id || '') === assetId)
    startReading(selected || { id: assetId })
  } catch (error) {
    console.error('随机阅读选题失败:', error)
    browseCategory(normalizedCategory, 'reading')
    showLocalMessage(error?.message ? `随机练习启动失败：${error.message}` : '随机练习启动失败')
  }
}

async function startEndlessMode() {
  if (!htmlAssetCount.value) {
    showLocalMessage('无尽模式：题库为空，请先加载题库')
    return
  }
  try {
    const { session } = await createEndless({
      poolPolicy: {
        categories: [],
        frequencyScope: 'all',
        excludeCompleted: true
      }
    })
    const sessionId = String(session?.id || '').trim()
    const assetId = String(session?.currentAssetId || '').trim()
    if (!sessionId || !assetId) {
      throw new Error('endless session create failed')
    }
    const title = readingAssets.value.find((asset) => String(asset.id) === assetId)?.title || assetId
    showLocalMessage(`无尽模式已启动，正在打开：${title}`)
    router.push({
      name: 'PracticeReading',
      params: { assetId },
      query: { mode: 'endless', endlessSessionId: sessionId }
    })
  } catch (error) {
    console.error('创建无尽模式失败:', error)
    showLocalMessage(error?.message ? `无尽模式启动失败：${error.message}` : '无尽模式启动失败')
  }
}

function openClockTool(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  clockNow.value = new Date()
  if (clockTimer) window.clearInterval(clockTimer)
  clockTimer = window.setInterval(() => { clockNow.value = new Date() }, 1000)
  clockOpen.value = true
}

function closeClockTool(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  clockOpen.value = false
  if (clockTimer) window.clearInterval(clockTimer)
  clockTimer = 0
}

async function openReadingMemorize() {
  const asset = filteredReadingAssets.value.find((entry) => entry?.id && hasReadingPracticePayload(entry))
    || readingAssets.value.find((entry) => entry?.id && hasReadingPracticePayload(entry))
  if (!asset) {
    showLocalMessage('阅读背题：没有可用于背题的阅读题，请先加载题库。')
    return
  }
  try {
    const { session } = await createMemorize({
      assetId: String(asset.id),
      titleSnapshot: asset.title || null
    })
    const attemptId = String(session?.attempt?.id || '').trim()
    if (!attemptId) throw new Error('memorize session missing attempt id')
    router.push({
      name: 'PracticeReading',
      params: { assetId: asset.id },
      query: {
        mode: 'memorize',
        practiceMode: 'memorize',
        memorizeAttemptId: attemptId
      }
    })
  } catch (error) {
    console.error('创建背题会话失败:', error)
    showLocalMessage(error?.message ? `阅读背题启动失败：${error.message}` : '阅读背题启动失败')
  }
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
  return preferences.get(key, '')
}

function writeLocalStorageValue(key, value) {
  preferences.set(key, String(value))
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
  const assetId = String(record?.assetId || record?.asset_id || record?.examId || '').trim()
  const sessionId = String(record?.sessionId || record?.session_id || record?.attemptId || record?.id || '').trim()
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
  return String(
    record?.suiteId
    || record?.suite_id
    || metadata.suiteSessionId
    || metadata.suite_session_id
    || ''
  ).trim()
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

async function exportReadingArchive() {
  if (historyBusy.value) return
  historyBusy.value = true
  try {
    const archive = requireReadingArchiveExport(await exportReadingHistoryArchive())
    downloadJsonFile(`ielts-reading-practice-export-${new Date().toISOString().slice(0, 10)}.json`, archive)
    showLocalMessage(`阅读记录已导出：${archive.count} 条`)
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
    const result = requireCommittedReadingArchiveImport(
      await importReadingHistoryArchive(payload)
    )
    await loadHistory()
    showLocalMessage(`阅读记录导入完成：${result?.imported || result?.importedCount || 0} 条`)
  } catch (error) {
    console.error('导入阅读记录失败:', error)
    showLocalMessage(error?.message ? `导入失败：${error.message}` : '导入失败，请检查 JSON 文件')
  } finally {
    historyBusy.value = false
  }
}

function requireReadingArchiveExport(value) {
  const archive = value && typeof value === 'object' ? value : null
  const count = Number(archive?.count)
  if (archive?.activity === 'reading' && Array.isArray(archive.submissions) && Number.isInteger(count) && count === archive.submissions.length) {
    return archive
  }
  const error = new Error('阅读归档导出未返回完整的 Rust 快照')
  error.code = 'reading.archive_export_failed'
  throw error
}

function requireCommittedReadingArchiveImport(result) {
  const failed = Number(result?.failed ?? result?.failedCount ?? 0)
  if (result?.committed === true && failed === 0) return result
  const report = Array.isArray(result?.report) ? result.report : []
  const error = new Error(report[0]?.message || '阅读记录导入未提交，原有数据未修改')
  error.code = 'reading.archive_import_failed'
  error.importResult = result
  throw error
}

function showReadingLibraryConfigList() {
  libraryConfigOpen.value = true
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

function hasReadingPracticePayload(asset) {
  const metadata = asset?.metadata || {}
  return !asset?.pdfOnly && Boolean(
    asset?.payloadRef
    || asset?.contentRef
    || metadata.dataKey
    || metadata.script
  )
}

async function viewPdf(asset) {
  if (!asset?.pdfOnly || !asset?.id) {
    showLocalMessage('此题不是 PDF 阅读资源。')
    return
  }
  try {
    const dataUrl = await getReadingPdfDataUrl(asset.id)
    pdfViewer.value = {
      open: true,
      title: asset.title || 'PDF 阅读资料',
      dataUrl: String(dataUrl || '')
    }
  } catch (error) {
    showLocalMessage(`PDF 打开失败：${error?.message || '资源不可用'}`)
  }
}

function closePdfViewer() {
  pdfViewer.value = { open: false, title: '', dataUrl: '' }
}

function showLocalMessage(message) {
  localMessage.value = message
  window.setTimeout(() => {
    if (localMessage.value === message) {
      localMessage.value = ''
    }
  }, 3200)
}

function updateSegmentedIndicators() {
  document.querySelectorAll('.practice-library .shui-segmented-control').forEach((control) => {
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
/*
 * This page owns reading-library state and geometry only. All colour, shadow,
 * blur, border and surface decisions belong to styles/opensource-skin.css.
 * Root every selector: extracted panel DOM must never leak legacy .view/.btn
 * rules into unrelated product routes.
 */
.practice-library {
  width: min(1200px, 100%);
  margin: 0 auto;
  padding: 8px 0 32px;
  display: grid;
  gap: 24px;
  min-width: 0;
}

.practice-library [hidden] {
  display: none !important;
}

.practice-library .library-workspace-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  min-width: 0;
}

.practice-library .library-workspace-header__copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.practice-library .library-workspace-header__eyebrow {
  margin: 0;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.practice-library .library-workspace-header__title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.7rem);
  line-height: 1;
}

.practice-library .library-view-tabs,
.practice-library .hero-panel__actions,
.practice-library .overview-section-actions,
.practice-library .hero-settings-actions,
.practice-library .hero-settings-links,
.practice-library .app-update-details-grid,
.practice-library .browse-frequency-filter,
.practice-library .shui-segmented-control,
.practice-library .practice-trend-options,
.practice-library .practice-custom-options,
.practice-library .custom-suite-picked-list,
.practice-library .exam-actions,
.practice-library .exam-list-empty-actions,
.practice-library .custom-suite-selection-actions,
.practice-library .suite-mode-selector-actions,
.practice-library .backup-entry-actions,
.practice-library .practice-heatmap__footer,
.practice-library .practice-heatmap__legend,
.practice-library .practice-radar-summary,
.practice-library .priority-accuracy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.practice-library .library-view-tabs {
  justify-content: flex-end;
  max-width: 100%;
  min-width: 0;
}

.practice-library .library-view-tabs__button,
.practice-library .browse-frequency-chip,
.practice-library .shui-segmented-btn,
.practice-library .practice-trend-option,
.practice-library .practice-custom-option,
.practice-library .suite-flow-option,
.practice-library .custom-suite-picked-chip,
.practice-library .practice-summary-toggle,
.practice-library .practice-custom-card__icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 7px 11px;
  border: 0;
  font: inherit;
  white-space: nowrap;
}

.practice-library .view {
  display: none;
  min-width: 0;
}

.practice-library .view.active {
  display: block;
}

.practice-library .hero-panel__header,
.practice-library .browse-title-bar,
.practice-library .practice-view__title-row,
.practice-library .practice-trend-card__header,
.practice-library .practice-trend-card__title-line,
.practice-library .practice-custom-card__header-actions,
.practice-library .practice-heatmap-month-controls,
.practice-library .priority-progress__head,
.practice-library .backup-list-header,
.practice-library .pdf-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.practice-library .hero-panel__header,
.practice-library .browse-title-bar {
  margin-bottom: 20px;
}

.practice-library .browse-title-bar {
  position: relative;
}

.practice-library .browse-title-trigger {
  display: inline-grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
}

.practice-library .browse-title-trigger .ui-emoji-icon,
.practice-library .browse-title-trigger svg {
  width: 18px;
  height: 18px;
}

.practice-library .browse-preference-panel {
  position: absolute;
  top: 48px;
  left: 0;
  z-index: 8;
  padding: 10px 12px;
}

.practice-library .browse-preference-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.practice-library .practice-history-header {
  justify-content: flex-start;
  gap: 20px;
}

.practice-library .practice-history-header > .hero-panel__actions:last-child {
  margin-left: auto;
}

.practice-library .hero-panel__title,
.practice-library .overview-section-title,
.practice-library .backup-list-title {
  margin: 0;
}

.practice-library .category-grid,
.practice-library .practice-stats,
.practice-library .practice-insights-grid,
.practice-library .more-tools-grid,
.practice-library .exam-list,
.practice-library .practice-history-list,
.practice-library .hero-settings-group,
.practice-library .practice-trend-card__metrics,
.practice-library .practice-radar-bars,
.practice-library .priority-progress-stack,
.practice-library .backup-list-scroll,
.practice-library .custom-suite-selection-bar,
.practice-library .custom-suite-selection-main,
.practice-library .suite-mode-selector-body,
.practice-library .suite-frequency-selector {
  display: grid;
  gap: 14px;
}

.practice-library .category-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.practice-library .practice-history-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.practice-library .overview-section-heading {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 2px 2px 4px;
}

.practice-library .overview-section-actions {
  gap: 10px;
  flex: 0 0 auto;
}

.practice-library .overview-section-actions .shui-glass-btn {
  min-width: 132px;
  justify-content: center;
  gap: 8px;
}

.practice-library .overview-action-glyph {
  display: inline-grid;
  width: 1.2em;
  height: 1.2em;
  place-items: center;
  font-size: 1.05em;
  font-weight: 700;
  line-height: 1;
}

.practice-library .category-card,
.practice-library .exam-item,
.practice-library .tool-card {
  min-width: 0;
}

.practice-library .category-card,
.practice-library .exam-item {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
}

.practice-library .category-card {
  min-height: 220px;
  gap: 18px;
}

.practice-library .category-header,
.practice-library .exam-info {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.practice-library .exam-info {
  align-items: flex-start;
}

.practice-library .exam-info > div,
.practice-library .tool-card-content,
.practice-library .record-info,
.practice-library .record-actions-container {
  min-width: 0;
}

.practice-library .category-icon {
  flex: 0 0 auto;
  font-size: 2rem;
}

.practice-library .category-title,
.practice-library .exam-info h4 {
  margin: 0;
  font-size: 1.06rem;
}

.practice-library .category-meta,
.practice-library .exam-meta,
.practice-library .hero-panel__muted,
.practice-library .more-view-subtitle {
  margin: 0;
  font-size: 0.9rem;
}

.practice-library .category-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: auto;
  padding-top: 20px;
}

.practice-library .search-box {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
}

.practice-library .search-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.practice-library .search-input-wrap,
.practice-library .browse-sort-wrapper {
  position: relative;
  min-width: 0;
}

.practice-library .search-input-wrap {
  flex: 1 1 auto;
}

.practice-library .search-leading-icon {
  position: absolute;
  top: 50%;
  left: 14px;
  z-index: 1;
  width: 17px;
  height: 17px;
  transform: translateY(-50%);
  pointer-events: none;
}

.practice-library .browse-sort-wrapper {
  flex: 0 0 min(190px, 40%);
  min-width: 130px;
}

.practice-library .search-input,
.practice-library .browse-sort-select,
.practice-library .suite-frequency-select {
  width: 100%;
  min-height: 42px;
  padding: 0 38px 0 14px;
  font: inherit;
}

.practice-library .search-input {
  padding-left: 42px;
}

.practice-library .practice-history-search-row {
  width: 100%;
  margin-bottom: 16px;
}

.practice-library .practice-history-search-row .search-input {
  padding-left: 14px;
}

.practice-library .practice-history-search-row .search-input-wrap {
  width: 100%;
}

.practice-library .search-clear-btn,
.practice-library .browse-sort-icon {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}

.practice-library .search-clear-btn {
  right: 10px;
  border: 0;
  padding: 6px;
  font: inherit;
}

.practice-library .browse-sort-icon {
  right: 12px;
  pointer-events: none;
}

.practice-library .shui-segmented-control {
  position: relative;
}

.practice-library .shui-segmented-indicator {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  pointer-events: none;
}

.practice-library .exam-list {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  align-content: start;
}

.practice-library .exam-actions {
  margin-top: auto;
}

.practice-library .exam-item-action-btn {
  flex: 1 1 120px;
}

.practice-library .exam-list-empty,
.practice-library .history-empty-placeholder,
.practice-library .practice-trend-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 180px;
  padding: 24px;
  text-align: center;
}

.practice-library .exam-list-empty-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
}

.practice-library .exam-list-empty-icon svg {
  width: 24px;
  height: 24px;
}

.practice-library .practice-stats,
.practice-library .practice-insights-grid,
.practice-library .more-tools-grid {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
}

.practice-library .practice-stats {
  margin-bottom: 20px;
}

.practice-library .hero-card {
  min-width: 0;
  padding: 18px;
}

.practice-library .hero-card__value,
.practice-library .stat-number {
  display: block;
  margin: 6px 0;
  font-size: clamp(1.6rem, 3vw, 2.35rem);
  line-height: 1;
}

.practice-library .practice-summary-toggle__glyph {
  position: relative;
  width: 14px;
  height: 14px;
}

.practice-library .practice-summary-toggle__glyph::before,
.practice-library .practice-summary-toggle__glyph::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 2px;
  content: '';
  transform: translate(-50%, -50%);
}

.practice-library .practice-summary-toggle[aria-expanded="false"] .practice-summary-toggle__glyph::after {
  transform: translate(-50%, -50%) rotate(90deg);
}

.practice-library .practice-summary-region {
  margin-top: 16px;
}

.practice-library .practice-summary-region[hidden] {
  display: none;
}

.practice-library .practice-trend-card,
.practice-library .practice-custom-card {
  position: relative;
  min-width: 0;
  min-height: 270px;
}

.practice-library .practice-trend-card__rotor,
.practice-library .practice-custom-card__rotor {
  position: relative;
  height: 100%;
  min-height: inherit;
  transform-style: preserve-3d;
  transition: transform var(--lg-duration-normal) var(--lg-easing-spring);
}

.practice-library .practice-custom-card.is-flipped .practice-custom-card__rotor {
  transform: rotateY(180deg);
}

.practice-library .practice-trend-card__face {
  display: grid;
  align-content: start;
  gap: 14px;
  height: 100%;
  min-height: inherit;
  padding: 18px;
  backface-visibility: hidden;
}

.practice-library .practice-trend-card__back {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
}

.practice-library .practice-trend-card__metric-value {
  display: block;
  font-size: 1.55rem;
  line-height: 1;
}

.practice-library .practice-trend-chart-shell,
.practice-library .practice-radar-chart-shell {
  position: relative;
  min-height: 126px;
}

.practice-library #practice-trend-canvas,
.practice-library #practice-radar-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: block;
  width: 100%;
  height: 100%;
}

.practice-library .practice-trend-bars {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10px, 1fr));
  align-items: end;
  gap: 5px;
  min-height: 116px;
}

.practice-library .practice-trend-bar {
  min-height: 8px;
}

.practice-library .practice-heatmap {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.practice-library .practice-heatmap__cell {
  aspect-ratio: 1;
  min-width: 0;
}

.practice-library .practice-heatmap__legend-cell {
  width: 13px;
  height: 13px;
}

.practice-library .practice-radar-bar {
  display: grid;
  grid-template-columns: minmax(76px, 1fr) minmax(90px, 2fr);
  align-items: center;
  gap: 10px;
}

.practice-library .practice-radar-bar__track,
.practice-library .priority-progress__track {
  overflow: hidden;
  height: 8px;
}

.practice-library .practice-radar-bar__fill,
.practice-library .priority-progress__fill {
  display: block;
  height: 100%;
}

.practice-library .priority-accuracy__orb {
  display: grid;
  place-items: center;
  width: 86px;
  aspect-ratio: 1;
  text-align: center;
}

.practice-library .history-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 16px;
}

.practice-library .record-result {
  display: contents;
}

.practice-library .practice-record-title {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.practice-library .practice-history-list > .loading,
.practice-library .practice-history-list > .history-empty-placeholder {
  grid-column: 1 / -1;
}

.practice-library .record-meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.practice-library .record-selection-hidden {
  display: none;
}

.practice-library .delete-record-btn {
  border: 0;
  padding: 6px;
  font: inherit;
}

.practice-library .tool-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 0;
  font: inherit;
  text-align: left;
}

.practice-library .tool-card-content h3,
.practice-library .hero-settings-group h3 {
  margin: 0 0 8px;
}

.practice-library .hero-settings-group > .hero-panel,
.practice-library .backup-list-card {
  padding: 18px;
}

.practice-library .settings-file-input {
  display: none;
}

.practice-library .system-info-surface,
.practice-library .app-update-details-row {
  display: grid;
  gap: 8px;
  padding: 14px;
}

.practice-library .backup-list-container {
  margin-top: 18px;
}

.practice-library .backup-list-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.practice-library .backup-list-scroll {
  max-height: min(52vh, 520px);
  margin-top: 14px;
  overflow: auto;
}

.practice-library .backup-entry {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
}

.practice-library .backup-entry-info {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.practice-library .backup-entry-id,
.practice-library .backup-entry-meta {
  overflow-wrap: anywhere;
}

.practice-library .suite-mode-selector-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
  place-items: center;
  padding: 20px;
}

.practice-library .suite-mode-selector-modal.show {
  display: grid;
}

.practice-library .suite-mode-selector-content {
  width: min(680px, 100%);
  max-height: min(80vh, 720px);
  overflow: auto;
  padding: 20px;
}

.practice-library .suite-flow-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.practice-library .suite-flow-option {
  min-height: 96px;
  align-items: flex-start;
  justify-content: flex-start;
  text-align: left;
}

.practice-library .suite-flow-option small {
  display: block;
  margin-top: 4px;
}

.practice-library .clock-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
}

.practice-library .clock-overlay {
  z-index: 300;
  padding: 24px;
}

.practice-library .clock-overlay.is-hidden {
  display: none;
}

.practice-library .clock-overlay-inner {
  position: relative;
  display: grid;
  place-items: center;
  min-width: min(680px, 90vw);
  min-height: min(360px, 64vh);
  padding: 48px;
}

.practice-library .clock-close-btn {
  position: absolute;
  top: 18px;
  right: 18px;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
}

.practice-library .native-clock {
  font-variant-numeric: tabular-nums;
  font-size: clamp(3rem, 12vw, 8rem);
  line-height: 1;
}

.practice-library .pdf-viewer-dialog {
  max-width: min(960px, calc(100vw - 32px));
  width: min(960px, calc(100vw - 32px));
  height: min(82vh, 760px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  padding: 18px;
}

.practice-library .pdf-viewer-frame {
  width: 100%;
  min-height: 0;
}

.practice-library .practice-local-message {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 400;
  max-width: min(420px, calc(100vw - 40px));
  margin: 0;
  padding: 12px 14px;
}

.practice-library .ui-emoji-icon {
  display: inline-flex;
  flex: 0 0 auto;
  width: 1em;
  height: 1em;
  vertical-align: -0.14em;
}

.practice-library .ui-emoji-icon svg,
.practice-library .tool-card-icon svg {
  width: 100%;
  height: 100%;
}

@media (max-width: 900px) {
  .practice-library {
    gap: 18px;
  }

  .practice-library .library-workspace-header,
  .practice-library .search-row,
  .practice-library .overview-section-heading,
  .practice-library .hero-panel__header,
  .practice-library .browse-title-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .practice-library .library-view-tabs {
    width: 100%;
    min-width: 0;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .practice-library .library-view-tabs::-webkit-scrollbar {
    display: none;
  }

  .practice-library .library-view-tabs__button {
    flex: 0 0 auto;
  }

  .practice-library .category-grid,
  .practice-library .practice-insights-grid,
  .practice-library .practice-history-list {
    grid-template-columns: 1fr;
  }

  .practice-library .browse-sort-wrapper {
    flex-basis: auto;
    width: 100%;
  }

  .practice-library .suite-flow-options {
    grid-template-columns: 1fr;
  }

  .practice-library .history-item {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .practice-library .history-item .record-info,
  .practice-library .history-item .record-result {
    grid-column: 1 / -1;
  }

  .practice-library .history-item:has(.record-selection:not(.record-selection-hidden)) .record-info {
    grid-column: 2;
  }

  .practice-library .history-item:has(.record-selection:not(.record-selection-hidden)) .record-result {
    grid-column: 2;
  }

  .practice-library .practice-history-header {
    gap: 12px;
  }

  .practice-library .practice-history-header > .hero-panel__actions {
    width: 100%;
  }

  .practice-library .practice-history-header > .hero-panel__actions:last-child {
    margin-left: 0;
  }

  .practice-library .record-result {
    display: flex;
    grid-column: 2;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .practice-library .record-actions-container {
    display: flex;
    min-width: 0;
    margin-left: auto;
  }

  .practice-library .record-percentage-container,
  .practice-library .record-actions-container {
    grid-column: auto;
  }
}

@media (max-width: 580px) {
  .practice-library .category-actions {
    grid-template-columns: 1fr;
  }

  .practice-library .tool-card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .practice-library .tool-card-arrow {
    display: none;
  }

  .practice-library .practice-radar-bar {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .practice-library .clock-overlay-inner {
    min-width: 0;
    width: 100%;
  }
}

@media (max-width: 360px) {
  .practice-library .practice-custom-card__front > .practice-trend-card__header {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
