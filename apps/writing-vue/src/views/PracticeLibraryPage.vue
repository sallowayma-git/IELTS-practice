<template>
  <section class="practice-library" data-practice-reading-home data-library-ready>
    <header class="library-workspace-header">
      <div class="library-workspace-header__copy">
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
      @retry-load="loadAssets"
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
      @retry-load="loadAssets"
      @browse-primary-action="handleBrowsePrimaryAction"
      @view-pdf="viewPdf"
      @confirm-custom-suite-selection="confirmCustomSuiteSelection"
      @cancel-custom-suite-selection="cancelCustomSuiteSelection"
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
import { LIBRARY_LOAD_FAILURE, libraryFailureMessage } from '@/modules/practice-reading/libraryFailure'
import { useReadingHistory } from '@/modules/practice-reading/useReadingHistory'
import { useReadingLibrary } from '@/modules/practice-reading/useReadingLibrary'
import { useReadingSuite } from '@/modules/practice-reading/useReadingSuite'
import { useTauriPreferences } from '@/composables/useTauriPreferences.js'
import { createEndless, createMemorize } from '@/api/modes-repository.js'
import { getReadingPdfDataUrl, pickReadingPracticeAsset } from '@/api/reading-repository.js'

const router = useRouter()
const route = useRoute()
const preferences = useTauriPreferences()
const { loadReadingAssets } = useReadingLibrary()
const { exportReadingHistoryArchive, importReadingHistoryArchive } = useReadingHistory()
const { createReadingSuite } = useReadingSuite()
const SUITE_FLOW_MODE_STORAGE_KEY = 'suite_flow_mode'
const SUITE_FREQUENCY_SCOPE_STORAGE_KEY = 'suite_frequency_scope'
const SUITE_AUTO_ADVANCE_STORAGE_KEY = 'suite_auto_advance_after_submit'

const icons = {
  overview: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>',
  book: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
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
const frequencyFilter = ref('all')
const keyword = ref('')
const sortMode = ref('default')
const browsePreferencePanelOpen = ref(false)
const browseRememberPosition = ref(readBrowseRememberPosition())
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
const readingAssets = ref([])
// Counts are only real once the index has been read; until then they are unknown, not zero.
const libraryLoaded = ref(false)
const readingSettingsPanel = ref(null)
const loading = ref(false)
const historyBusy = ref(false)
const creatingSuite = ref(false)
const error = ref('')
const suiteError = ref('')
const localMessage = ref('')
const pdfViewer = ref({ open: false, title: '', dataUrl: '' })
const latestAssetReadAt = ref(null)
let pendingBrowsePositionRestore = false

const readingCategoryEntries = computed(() => ['P1', 'P2', 'P3'].map((category) => ({
  category,
  type: 'reading',
  total: libraryLoaded.value ? countByCategory(category) : null
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
  loadAssets()
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

watch(filteredReadingAssets, () => {
  if (activeView.value === 'browse') {
    scheduleBrowsePositionRestore()
  }
})

async function loadAssets() {
  loading.value = true
  error.value = ''
  try {
    const result = await loadReadingAssets()
    // The API layer guarantees an array; anything else is a real failure, not an empty library.
    if (!Array.isArray(result?.data)) throw new Error('reading library returned no asset list')
    readingAssets.value = result.data
    libraryLoaded.value = true
    latestAssetReadAt.value = new Date()
    scheduleBrowsePositionRestore()
    return true
  } catch (loadError) {
    // Technical detail (IPC/DB/shape errors) is for the console, never the learner.
    console.error('读取阅读题库失败:', loadError)
    readingAssets.value = []
    libraryLoaded.value = false
    error.value = LIBRARY_LOAD_FAILURE
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

// Old deep links into the reading record tab land on the unified history page.
const LEGACY_RECORD_VIEWS = new Set(['practice', 'records'])

function syncViewFromRoute() {
  const view = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  if (LEGACY_RECORD_VIEWS.has(view)) {
    router.replace({ name: 'History', query: { activity: 'reading' } }).catch(() => {})
    return
  }
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

function countByCategory(category) {
  return readingAssets.value.filter((asset) => normalizeCategory(asset.category) === category).length
}

function filterByType(type) {
  selectedType.value = type === 'reading' ? 'reading' : 'all'
  if (selectedType.value === 'all') {
    selectedCategory.value = 'all'
  }
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
    showLocalMessage(libraryFailureMessage('随机练习启动失败', error))
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
      throw new Error('无尽模式未返回有效会话')
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
    showLocalMessage(libraryFailureMessage('无尽模式启动失败', error))
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
    if (!attemptId) throw new Error('背题会话未返回有效编号')
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
    showLocalMessage(libraryFailureMessage('阅读背题启动失败', error))
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
      throw new Error('套题未返回有效会话')
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
    suiteError.value = libraryFailureMessage('阅读套题创建失败', createError)
  } finally {
    creatingSuite.value = false
  }
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
    showLocalMessage(libraryFailureMessage('导出失败', error))
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
    showLocalMessage(`阅读记录导入完成：${result?.imported || result?.importedCount || 0} 条`)
  } catch (error) {
    console.error('导入阅读记录失败:', error)
    showLocalMessage(libraryFailureMessage('导入失败', error, '请检查 JSON 文件'))
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
    console.error('打开 PDF 失败:', error)
    showLocalMessage(libraryFailureMessage('PDF 打开失败', error, '资源不可用'))
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
 * Reading library — paper layout. Every selector is rooted at
 * .practice-library so the shared reading components restyle here without
 * leaking into the frozen exam routes. Shared vocabulary (buttons, inputs,
 * text tabs, rules) comes from styles/opensource-skin.css.
 */
.practice-library {
  display: grid;
  gap: 0;
  min-width: 0;
  color: var(--anth-ink);
}

.practice-library [hidden] {
  display: none !important;
}

/* ── Header: title left, text tabs right ───────────────────────────── */
.practice-library .library-workspace-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  min-width: 0;
  padding-bottom: 0;
}

.practice-library .library-workspace-header__copy {
  min-width: 0;
  padding-bottom: 18px;
}

.practice-library .library-view-tabs {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 24px;
  max-width: 100%;
  min-width: 0;
}

.practice-library .library-view-tabs__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin-bottom: -1px;
  padding: 0 1px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--anth-ink-faint);
  font: inherit;
  font-size: var(--anth-text-base);
  white-space: nowrap;
  cursor: pointer;
}

.practice-library .library-view-tabs__button:hover {
  color: var(--anth-ink);
}

.practice-library .library-view-tabs__button.active {
  border-bottom-color: var(--anth-ink);
  color: var(--anth-ink-strong);
  font-weight: var(--anth-weight-medium);
}

/* ── Views ─────────────────────────────────────────────────────────── */
.practice-library .view {
  display: none;
  min-width: 0;
  padding: 0;
}

.practice-library .view.active {
  display: block;
}

.practice-library :is(.hero-panel__header, .browse-title-bar, .backup-list-header, .pdf-viewer-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.practice-library :is(.hero-panel__header, .browse-title-bar) {
  margin-bottom: 20px;
}

.practice-library :is(.hero-panel__title, .overview-section-title, .backup-list-title) {
  margin: 0;
  font-size: var(--anth-text-lg);
  line-height: var(--anth-leading-snug);
}

.practice-library :is(.hero-panel__actions, .overview-section-actions, .hero-settings-actions,
  .hero-settings-links, .browse-frequency-filter,
  .custom-suite-picked-list, .exam-actions, .exam-list-empty-actions, .custom-suite-selection-actions,
  .suite-mode-selector-actions, .backup-entry-actions) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.practice-library :is(.category-grid, .more-tools-grid,
  .exam-list, .hero-settings-group, .backup-list-scroll, .custom-suite-selection-bar,
  .custom-suite-selection-main, .suite-mode-selector-body, .suite-frequency-selector) {
  display: grid;
  gap: 14px;
}

/* ── Overview: an index of passages ────────────────────────────────── */
.practice-library .overview-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 40px;
}

.practice-library .hero-panel__subtitle {
  margin: 0;
  max-width: var(--anth-measure);
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-md);
  line-height: var(--anth-leading-relaxed);
}

.practice-library .overview-section-actions {
  flex: 0 0 auto;
  gap: 10px;
}

.practice-library .overview-section-title {
  margin-bottom: 8px;
}

.practice-library .category-grid {
  gap: 0;
  border-bottom: 1px solid var(--anth-rule);
}

.practice-library .category-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-width: 0;
  padding: 18px 0;
}

.practice-library :is(.category-header, .exam-info) {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
}

.practice-library .category-icon {
  flex: 0 0 3.25rem;
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: 1.75rem;
  line-height: 1;
}

.practice-library :is(.category-title, .exam-info h4) {
  margin: 0;
  color: var(--anth-ink-strong);
  font-size: var(--anth-text-md);
  font-weight: var(--anth-weight-medium);
}

.practice-library :is(.category-meta, .exam-meta, .hero-panel__muted, .more-view-subtitle) {
  margin: 2px 0 0;
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

/* Counts not read yet: a faint placeholder, not a value that looks like text. */
.practice-library .category-meta.is-pending {
  color: var(--anth-ink-faint);
}

.practice-library .category-actions {
  display: flex;
  align-items: center;
  gap: 20px;
}

/* ── Browse: filters, search, ruled list ───────────────────────────── */
.practice-library .browse-title-bar {
  position: relative;
  justify-content: flex-start;
}

.practice-library .browse-title-bar > .shui-segmented-control {
  margin-left: auto;
}

.practice-library .browse-title-trigger {
  display: inline-grid;
  width: 36px;
  height: 36px;
  min-height: 36px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 1px solid var(--anth-border-strong);
  border-radius: var(--anth-radius-sm);
  background: transparent;
  color: var(--anth-ink-soft);
  cursor: pointer;
}

.practice-library .browse-title-trigger:hover {
  border-color: var(--anth-ink);
  color: var(--anth-ink);
}

.practice-library .browse-title-dot {
  display: none;
}

.practice-library :is(.browse-title-trigger .ui-emoji-icon, .browse-title-trigger svg) {
  width: 16px;
  height: 16px;
}

.practice-library .browse-preference-panel {
  position: absolute;
  top: 44px;
  left: 0;
  z-index: var(--anth-z-raised);
  padding: 10px 12px;
  border: 1px solid var(--anth-ink);
  background: var(--anth-canvas);
}

.practice-library .browse-preference-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.practice-library .search-box {
  margin-bottom: 8px;
}

.practice-library .search-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

.practice-library :is(.search-input-wrap, .browse-sort-wrapper) {
  position: relative;
  min-width: 0;
}

.practice-library .search-input-wrap {
  flex: 1 1 auto;
}

.practice-library .search-leading-icon {
  position: absolute;
  top: 50%;
  left: 12px;
  z-index: 1;
  width: 15px;
  height: 15px;
  color: var(--anth-ink-faint);
  transform: translateY(-50%);
  pointer-events: none;
}

.practice-library .browse-sort-wrapper {
  flex: 0 0 min(180px, 40%);
  min-width: 130px;
}

.practice-library :is(.search-input, .browse-sort-select, .suite-frequency-select) {
  width: 100%;
  min-height: 40px;
  padding: 0 34px 0 12px;
  font: inherit;
  font-size: var(--anth-text-sm);
  appearance: none;
}

.practice-library .search-input {
  padding-left: 36px;
}

.practice-library :is(.search-clear-btn, .browse-sort-icon) {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  color: var(--anth-ink-faint);
}

.practice-library .search-clear-btn {
  right: 6px;
  display: grid;
  place-items: center;
  min-height: 0;
  padding: 6px;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.practice-library .browse-sort-icon {
  right: 12px;
  pointer-events: none;
}

.practice-library .browse-frequency-filter {
  gap: 16px;
}

.practice-library .browse-frequency-chip {
  min-height: 40px;
  padding: 0 1px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--anth-ink-faint);
  font: inherit;
  font-size: var(--anth-text-sm);
  white-space: nowrap;
  cursor: pointer;
}

.practice-library .browse-frequency-chip:hover {
  color: var(--anth-ink);
}

.practice-library .browse-frequency-chip.active {
  border-bottom-color: var(--anth-ink);
  color: var(--anth-ink-strong);
}

.practice-library .exam-list {
  gap: 0;
  align-content: start;
  border-bottom: 1px solid var(--anth-rule);
}

.practice-library .exam-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 12px 0;
}

.practice-library .exam-item:hover {
  background: var(--anth-surface-hover);
}

.practice-library :is(.exam-info > div, .tool-card-content) {
  min-width: 0;
}

.practice-library .exam-actions {
  flex: 0 0 auto;
  flex-wrap: nowrap;
}

.practice-library .exam-item-action-btn {
  padding: 5px 12px;
}

.practice-library .exam-list-empty {
  display: grid;
  place-items: center;
  gap: 6px;
  min-height: 160px;
  padding: 24px;
  text-align: center;
}

.practice-library .exam-list-empty-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
}

.practice-library .exam-list-empty-icon svg {
  width: 22px;
  height: 22px;
}

.practice-library .exam-list-empty-text {
  margin: 0;
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
}

/* Custom suite workflow: a ruled strip under the list. */
.practice-library .custom-suite-selection-bar {
  min-width: 0;
  margin-top: 24px;
  padding: 16px 0;
  border-top: 1px solid var(--anth-ink);
}

.practice-library .custom-suite-selection-main {
  min-width: 0;
  gap: 2px;
}

.practice-library .custom-suite-selection-main span {
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

.practice-library .custom-suite-picked-list {
  gap: 6px 20px;
}

.practice-library .custom-suite-picked-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  max-width: 100%;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
  white-space: normal;
  overflow-wrap: anywhere;
}

.practice-library .custom-suite-picked-chip::before {
  content: "";
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border: 1px solid currentColor;
}

.practice-library .custom-suite-picked-chip.filled {
  color: var(--anth-ink);
}

.practice-library .custom-suite-picked-chip.filled::before {
  background: currentColor;
}

/* ── Practice records ──────────────────────────────────────────────── */

/* Summary figures read as one booktabs row, not tiles. */

/* The widget picker swaps faces with a fade, not a 3D flip. */

/* In selection mode the whole row toggles selection; the title is just text. */

/* ── More tools: an annotated list ─────────────────────────────────── */
.practice-library .more-view-subtitle {
  margin: -8px 0 20px;
}

.practice-library .more-tools-grid {
  gap: 0;
  border-bottom: 1px solid var(--anth-rule);
}

.practice-library .tool-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-width: 0;
  padding: 18px 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.practice-library .tool-card:hover {
  background: var(--anth-surface-hover);
}

.practice-library .tool-card-content h3 {
  margin: 0 0 4px;
  font-size: var(--anth-text-md);
}

.practice-library .tool-card-content p {
  margin: 0;
  max-width: var(--anth-measure);
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

.practice-library .tool-card-arrow {
  color: var(--anth-accent-strong);
  font-size: var(--anth-text-sm);
  white-space: nowrap;
}

/* ── Library settings ──────────────────────────────────────────────── */
.practice-library .hero-settings-group {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 32px 40px;
}

.practice-library :is(.hero-settings-group > .hero-panel, .backup-list-card) {
  padding: 16px 0 0;
  border-top: 1px solid var(--anth-ink);
  background: var(--anth-canvas);
}

.practice-library .hero-settings-group h3 {
  margin: 0 0 6px;
  font-size: var(--anth-text-md);
}

.practice-library .hero-settings-group .hero-panel__muted {
  margin: 0 0 14px;
  max-width: var(--anth-measure);
  line-height: var(--anth-leading-normal);
}

.practice-library .settings-file-input {
  display: none;
}

.practice-library :is(.system-info-surface, .app-update-details-row) {
  display: grid;
  gap: 6px;
  padding: 10px 0;
  border-top: 0;
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.practice-library .hero-settings-links {
  gap: 20px;
  margin-top: 12px;
  font-size: var(--anth-text-sm);
}

.practice-library .hero-settings-links a {
  color: var(--anth-accent-strong);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.practice-library .backup-list-container {
  margin-top: 32px;
}

.practice-library .backup-list-scroll {
  max-height: min(52vh, 520px);
  margin-top: 12px;
  overflow: auto;
}

.practice-library .backup-entry {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
}

.practice-library .backup-entry-info {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.practice-library :is(.backup-entry-id, .backup-entry-meta) {
  overflow-wrap: anywhere;
}

/* ── Suite flow dialog ─────────────────────────────────────────────── */
.practice-library .suite-mode-selector-modal {
  position: fixed;
  inset: 0;
  z-index: var(--anth-z-floating);
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
  padding: 24px;
}

.practice-library .theme-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.practice-library .theme-modal-header h3 {
  margin: 0 0 4px;
  font-size: var(--anth-text-lg);
}

.practice-library .suite-mode-selector-subtitle {
  margin: 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

.practice-library .theme-modal-close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  border: 1px solid var(--anth-border-strong);
  border-radius: var(--anth-radius-sm);
  background: transparent;
  color: var(--anth-ink-soft);
  font-size: 1.125rem;
  cursor: pointer;
}

.practice-library .suite-flow-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 16px;
  border-bottom: 1px solid var(--anth-rule);
}

.practice-library .suite-flow-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 4px;
  min-height: 96px;
  padding: 14px 4px 14px 0;
  border: 0;
  border-top: 2px solid var(--anth-rule);
  border-radius: 0;
  background: transparent;
  color: var(--anth-ink);
  font: inherit;
  text-align: left;
  white-space: normal;
  cursor: pointer;
}

.practice-library .suite-flow-option span {
  font-weight: var(--anth-weight-medium);
}

.practice-library .suite-flow-option small {
  display: block;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
  line-height: var(--anth-leading-normal);
}

.practice-library .suite-flow-option:hover {
  border-top-color: var(--anth-ink-soft);
}

.practice-library .suite-flow-option.active {
  border-top-color: var(--anth-ink);
}

.practice-library .suite-frequency-selector {
  gap: 6px;
  margin-top: 16px;
  font-size: var(--anth-text-sm);
}

.practice-library .suite-mode-selector-actions {
  justify-content: flex-end;
  margin-top: 8px;
}

/* ── Clock, PDF viewer, toast ──────────────────────────────────────── */
.practice-library .clock-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--lg-bg-scrim);
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
  top: 16px;
  right: 16px;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--anth-border-strong);
  border-radius: var(--anth-radius-sm);
  background: transparent;
  color: var(--anth-ink-soft);
  cursor: pointer;
}

.practice-library .clock-close-btn svg {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  stroke-width: 1.8;
}

.practice-library .native-clock {
  font-size: clamp(3rem, 12vw, 8rem);
  line-height: 1;
}

.practice-library .pdf-viewer-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  width: min(960px, calc(100vw - 32px));
  max-width: min(960px, calc(100vw - 32px));
  height: min(82vh, 760px);
  padding: 18px;
}

.practice-library .pdf-viewer-frame {
  width: 100%;
  min-height: 0;
  border: 1px solid var(--anth-rule);
}

.practice-library .practice-local-message {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: var(--anth-z-toast);
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

.practice-library .ui-emoji-icon svg {
  width: 100%;
  height: 100%;
}

.practice-library .loading {
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 32px 0;
}

.practice-library .spinner {
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--anth-rule);
  border-top-color: var(--anth-ink);
  border-radius: 50%; /* sanctioned: a progress glyph, not a surface */
  animation: practice-library-spin 0.9s linear infinite;
}

@keyframes practice-library-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .practice-library :is(.library-workspace-header, .search-row, .overview-intro, .hero-panel__header:not(.browse-title-bar)) {
    align-items: stretch;
    flex-direction: column;
  }

  .practice-library .browse-title-bar {
    flex-wrap: wrap;
  }

  .practice-library .library-workspace-header__copy {
    padding-bottom: 4px;
  }

  .practice-library .library-view-tabs {
    justify-content: flex-start;
  }

  .practice-library .browse-title-bar > .shui-segmented-control {
    flex-basis: 100%;
    margin-left: 0;
  }

  .practice-library .hero-settings-group {
    grid-template-columns: 1fr;
  }

  .practice-library .browse-sort-wrapper {
    flex-basis: auto;
    width: 100%;
  }

  .practice-library .suite-flow-options {
    grid-template-columns: 1fr;
  }

  .practice-library .suite-flow-option {
    min-height: 0;
  }

}

@media (max-width: 640px) {
  .practice-library .library-view-tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 8px;
    width: 100%;
  }

  .practice-library .library-view-tabs__button {
    justify-content: flex-start;
    white-space: normal;
  }
}

@media (max-width: 580px) {
  .practice-library .category-card {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .practice-library .exam-item {
    flex-wrap: wrap;
  }

  .practice-library .custom-suite-picked-list .custom-suite-picked-chip {
    width: 100%;
  }

  .practice-library .custom-suite-selection-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .practice-library .tool-card-arrow {
    display: none;
  }

  .practice-library .clock-overlay-inner {
    width: 100%;
    min-width: 0;
  }
}

</style>
