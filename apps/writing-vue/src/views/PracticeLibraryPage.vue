<template>
  <section class="practice-library" :class="{ workspace: activeView === 'browse' }" data-practice-reading-home data-library-ready>
    <div class="library-chrome">
    <header class="page-header library-workspace-header">
      <div class="page-header-top">
        <div class="library-workspace-header__copy">
          <p class="page-header-kicker">{{ headerKicker }}</p>
          <div class="library-workspace-header__title-row">
            <h1 class="library-workspace-header__title">{{ headerTitle }}</h1>
            <MoodMascot
              v-if="activeView === 'overview' && overviewMood"
              class="overview-mood"
              :mood="overviewMood"
              :size="48"
              :label="`最近状态：${moodLabel(overviewMood)}`"
            />
          </div>
        </div>
        <div v-if="activeView === 'overview'" class="page-header-actions">
          <button class="btn btn-secondary" type="button" data-action="write-essay" @click="startCompose">
            写一篇
          </button>
          <button
            class="btn btn-secondary"
            type="button"
            id="endless-mode-btn"
            data-action="start-endless-mode"
            data-overview-action="endless"
            @click="startEndlessMode"
          >
            无尽模式
          </button>
          <button
            class="btn btn-primary"
            type="button"
            data-action="start-suite-mode"
            data-overview-action="suite"
            data-start-reading-suite
            :disabled="creatingSuite"
            @click="openSuiteModeSelector"
          >
            {{ creatingSuite ? '创建中' : '套题模式' }}
          </button>
        </div>
      </div>
      <p v-if="activeView === 'overview'" class="page-header-desc">最近的练习、成绩走势和下一步。</p>
    </header>

    </div>

    <div class="library-body">
    <DashboardOverview
      v-if="activeView === 'overview'"
      @mood="overviewMood = $event"
      :reading-category-entries="readingCategoryEntries"
      :error="error"
      :suite-error="suiteError"
      :library-loaded="libraryLoaded"
      :total-assets="readingAssets.length"
      :html-asset-count="htmlAssetCount"
      :pdf-asset-count="pdfAssetCount"
      :latest-asset-read-label="latestAssetReadLabel"
      @browse-category="browseCategory"
      @start-random-practice="startRandomPractice"
      @retry-load="loadAssets"
      @open-reading-data-settings="openReadingDataSettings"
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
          class="btn btn-icon clock-close-btn"
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

    </div>

    <div v-if="pdfViewer.open" class="dialog-overlay pdf-viewer-overlay" @click.self="closePdfViewer">
      <section class="dialog pdf-viewer-dialog" role="dialog" aria-modal="true" :aria-label="pdfViewer.title">
        <div class="dialog-header pdf-viewer-header">
          <strong>{{ pdfViewer.title }}</strong>
          <button class="btn btn-ghost btn-sm btn-text" type="button" aria-label="关闭 PDF" @click="closePdfViewer">关闭</button>
        </div>
        <iframe class="pdf-viewer-frame" :src="pdfViewer.dataUrl" :title="pdfViewer.title"></iframe>
      </section>
    </div>

    <p v-if="localMessage" class="practice-local-message" role="status">{{ localMessage }}</p>
  </section>
</template>

<script setup>
import MoodMascot from '@/components/mascot/MoodMascot.vue'
import { moodLabel } from '@/components/mascot/moodFor.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ReadingBrowsePanel from '@/modules/practice-reading/components/ReadingBrowsePanel.vue'
import ReadingMoreToolsPanel from '@/modules/practice-reading/components/ReadingMoreToolsPanel.vue'
import DashboardOverview from '@/modules/dashboard/components/DashboardOverview.vue'
import { formatTodayLabel } from '@/modules/dashboard/dashboardCore.js'
import ReadingSuiteSelector from '@/modules/practice-reading/components/ReadingSuiteSelector.vue'
import {
  buildBrowseTitle,
  filterReadingAssets,
  normalizeCategory,
  normalizeFrequency
} from '@/modules/practice-reading/browseFilters'
import { hasReadingPracticePayload } from '@/modules/practice-reading/readingAssetCore'
import { LIBRARY_LOAD_FAILURE, libraryFailureMessage } from '@/modules/practice-reading/libraryFailure'
import { useReadingLibrary } from '@/modules/practice-reading/useReadingLibrary'
import { useReadingSuite } from '@/modules/practice-reading/useReadingSuite'
import { useTauriPreferences } from '@/composables/useTauriPreferences.js'
import { createEndless, createMemorize } from '@/api/modes-repository.js'
import { getReadingPdfDataUrl, pickReadingPracticeAsset } from '@/api/reading-repository.js'

const router = useRouter()
const route = useRoute()
const preferences = useTauriPreferences()
const { loadReadingAssets } = useReadingLibrary()
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

// Views are switched from the top nav through the `view` query.
const LIBRARY_VIEWS = new Set(['overview', 'browse', 'more'])

const typeFilters = [
  { value: 'all', label: '全部' },
  { value: 'reading', label: '阅读' },
  { value: 'listening', label: '听力', hidden: true }
]

const frequencyFilters = [
  { value: 'high', label: '高频' },
  { value: 'medium', label: '次高频' },
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
const suiteModeSelectorOpen = ref(false)
const selectedSuiteFlowMode = ref(resolveSuitePreference().flowMode)
const selectedSuiteFrequencyScope = ref(resolveSuitePreference().frequencyScope)
const customSuiteDraft = ref(null)
const readingAssets = ref([])
// Counts are only real once the index has been read; until then they are unknown, not zero.
const libraryLoaded = ref(false)
const loading = ref(false)
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
  const kind = typeof route.query.kind === 'string' ? route.query.kind : ''
  const assets = kind ? readingAssets.value.filter((asset) => (asset.questionKinds || []).includes(kind)) : readingAssets.value
  return filterReadingAssets(assets, {
    keyword: keyword.value,
    selectedType: selectedType.value,
    selectedCategory: selectedCategory.value,
    frequencyFilter: frequencyFilter.value,
    sortMode: sortMode.value
  })
})

const htmlAssetCount = computed(() => readingAssets.value.filter(hasReadingPracticePayload).length)
const pdfAssetCount = computed(() => readingAssets.value.filter((asset) => Boolean(asset?.pdfOnly)).length)
const latestAssetReadLabel = computed(() => latestAssetReadAt.value ? latestAssetReadAt.value.toLocaleString() : '尚未读取')
const customSuitePickedByCategory = computed(() => customSuiteDraft.value?.pickedByCategory || {})
const customSuiteCurrentCategory = computed(() => customSuiteCategories[customSuiteDraft.value?.stageIndex || 0] || 'P1')
const customSuiteReady = computed(() => customSuiteCategories.every((category) => Boolean(customSuitePickedByCategory.value[category]?.id)))

const todayLabel = formatTodayLabel()
const LIBRARY_HEADERS = Object.freeze({
  browse: Object.freeze({ kicker: '题库 · 阅读', title: '阅读题库' }),
  more: Object.freeze({ kicker: 'READING · 阅读', title: '阅读练习' })
})
const libraryHeader = computed(() => LIBRARY_HEADERS[activeView.value] || LIBRARY_HEADERS.more)
const headerKicker = computed(() => (activeView.value === 'overview' ? todayLabel : libraryHeader.value.kicker))
const headerTitle = computed(() => (activeView.value === 'overview' ? '总览' : libraryHeader.value.title))
const overviewMood = ref('')

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

// Old deep links into the reading record tab land on the unified history page.
const LEGACY_RECORD_VIEWS = new Set(['practice', 'records'])

function syncViewFromRoute() {
  // No view query is the overview — the top nav's 总览 link drops the query.
  const view = (Array.isArray(route.query.view) ? route.query.view[0] : route.query.view) || 'overview'
  if (LEGACY_RECORD_VIEWS.has(view)) {
    router.replace({ name: 'History', query: { activity: 'reading' } }).catch(() => {})
    return
  }
  if (view === 'settings') {
    // The reading data tools moved into the global settings page.
    openReadingDataSettings()
    return
  }
  if (LIBRARY_VIEWS.has(view)) {
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

function startCompose() {
  router.push({ name: 'Compose' }).catch(() => {})
}

function openReadingDataSettings() {
  router.push({ name: 'Settings', hash: '#settings-reading' }).catch(() => {})
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
 * Library home (route /). Look and components come from
 * styles/design-system/components, including the workspace frame and height.
 * Rooted at .atlas-paper [data-practice-reading-home] so it wins over
 * opensource-skin.css and page.css without touching the exam routes.
 */
.atlas-paper [data-practice-reading-home] [hidden] { display: none !important; }
.atlas-paper [data-practice-reading-home] .view { display: none; min-width: 0; }
.atlas-paper [data-practice-reading-home] .view.active { display: block; }

.atlas-paper [data-practice-reading-home] .library-workspace-header {
  margin-bottom: var(--anth-space-6);
  padding-top: 0;
  padding-bottom: 0;
  border-bottom: 0;
}

.atlas-paper [data-practice-reading-home] .library-workspace-header .page-header-top { align-items: flex-end; }
.atlas-paper [data-practice-reading-home] .library-workspace-header__copy { display: grid; gap: var(--anth-space-1); }
.atlas-paper [data-practice-reading-home] .library-workspace-header__title-row {
  display: flex;
  align-items: center;
  gap: var(--anth-space-3);
}

.atlas-paper [data-practice-reading-home] .library-workspace-header__title {
  font-size: var(--anth-text-h1-size);
  line-height: var(--anth-text-h1-line);
}

/* CJK glyphs sit high in their line box; lift the mascot onto the title's visual centre. */
.atlas-paper [data-practice-reading-home] .library-workspace-header__title-row .overview-mood {
  transform: translateY(-5px);
}

.atlas-paper [data-practice-reading-home] .library-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── Browse: workspace. Toolbar auto, list fills the rest and scrolls ── */
.atlas-paper [data-practice-reading-home] #browse-view.active {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

.atlas-paper [data-practice-reading-home] .browse-toolbar { display: grid; gap: var(--anth-space-3); }

.atlas-paper [data-practice-reading-home] .browse-title-bar {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--anth-space-3);
}
.atlas-paper [data-practice-reading-home] .browse-title-bar .hero-panel__title {
  margin: 0;
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-h2-size);
  line-height: var(--anth-text-h2-line);
}
.atlas-paper [data-practice-reading-home] .browse-title-bar > .shui-segmented-control { margin-left: auto; }
.atlas-paper [data-practice-reading-home] .browse-preference-panel {
  position: absolute;
  top: 44px;
  left: 0;
  z-index: var(--anth-z-raised);
  padding: var(--anth-space-2) var(--anth-space-3);
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-md);
  background: var(--anth-surface-raised);
  box-shadow: var(--anth-shadow-2);
}
.atlas-paper [data-practice-reading-home] .browse-preference-option { display: inline-flex; align-items: center; gap: var(--anth-space-2); white-space: nowrap; }

.atlas-paper [data-practice-reading-home] .search-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--anth-space-3); }
.atlas-paper [data-practice-reading-home] .search-input-wrap { position: relative; flex: 1 1 240px; min-width: 0; }
.atlas-paper [data-practice-reading-home] .search-input { padding: 0 36px; }
.atlas-paper [data-practice-reading-home] .search-leading-icon {
  position: absolute;
  top: 50%;
  left: 12px;
  width: 15px;
  height: 15px;
  color: var(--anth-ink-muted);
  transform: translateY(-50%);
  pointer-events: none;
}
.atlas-paper [data-practice-reading-home] .search-clear-btn { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); }
.atlas-paper [data-practice-reading-home] .browse-sort-wrapper { flex: 0 0 180px; min-width: 130px; }
/* The native select draws its own chevron in the design system. */
.atlas-paper [data-practice-reading-home] .browse-sort-icon { display: none; }

.atlas-paper [data-practice-reading-home] .browse-body { display: flex; flex-direction: column; min-height: 0; }
.atlas-paper [data-practice-reading-home] #exam-list-container {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--anth-space-3) 0 var(--anth-space-5);
}
.atlas-paper [data-practice-reading-home] .exam-list { flex: 0 0 auto; }

.atlas-paper [data-practice-reading-home] .loading {
  display: grid;
  place-items: center;
  gap: var(--anth-space-2);
  padding: var(--anth-space-8) 0;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}
.atlas-paper [data-practice-reading-home] .spinner {
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--anth-rule-strong);
  border-top-color: var(--anth-accent);
  border-radius: 50%;
  animation: practice-library-spin 0.9s linear infinite;
}
@keyframes practice-library-spin { to { transform: rotate(360deg); } }

.atlas-paper [data-practice-reading-home] .custom-suite-selection-bar { display: grid; gap: var(--anth-space-3); margin-top: var(--anth-space-4); }
.atlas-paper [data-practice-reading-home] .custom-suite-selection-main { display: grid; gap: 2px; }
.atlas-paper [data-practice-reading-home] .custom-suite-selection-main span,
.atlas-paper [data-practice-reading-home] .custom-suite-picked-chip { color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }
.atlas-paper [data-practice-reading-home] .custom-suite-picked-list { display: flex; flex-wrap: wrap; gap: var(--anth-space-1) var(--anth-space-4); }
.atlas-paper [data-practice-reading-home] .custom-suite-picked-chip.filled { color: var(--anth-ink); }
.atlas-paper [data-practice-reading-home] .custom-suite-selection-actions { display: flex; flex-wrap: wrap; gap: var(--anth-space-2); }

/* ── More tools: three interactive cards in a column ─────────────────── */
.atlas-paper [data-practice-reading-home] .more-view-subtitle { margin: 0 0 var(--anth-space-4); color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); }
.atlas-paper [data-practice-reading-home] .more-tools-grid { display: grid; gap: var(--anth-space-3); }
.atlas-paper [data-practice-reading-home] .tool-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--anth-space-4);
  width: 100%;
  font-family: var(--anth-font-sans);
  text-align: left;
}
.atlas-paper [data-practice-reading-home] .tool-card-content h3 {
  margin: 0 0 var(--anth-space-1);
  font-size: var(--anth-text-h3-size);
  line-height: var(--anth-text-h3-line);
}
.atlas-paper [data-practice-reading-home] .tool-card-content p {
  max-width: 64ch;
  margin: 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
}
.atlas-paper [data-practice-reading-home] .tool-card-arrow { color: var(--anth-accent-ink); font-size: var(--anth-text-small-size); white-space: nowrap; }

/* ── Library settings: panels in a two-column grid ───────────────────── */
.atlas-paper [data-practice-reading-home] .hero-settings-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--anth-space-5); }
.atlas-paper [data-practice-reading-home] .hero-settings-group > .hero-panel { min-width: 0; }
.atlas-paper [data-practice-reading-home] .hero-settings-group h3 {
  margin: 0 0 var(--anth-space-1);
  font-size: var(--anth-text-h3-size);
  line-height: var(--anth-text-h3-line);
}
.atlas-paper [data-practice-reading-home] .hero-panel__muted { max-width: 64ch; margin: 0 0 var(--anth-space-3); color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); }
.atlas-paper [data-practice-reading-home] .hero-settings-actions { display: flex; flex-wrap: wrap; gap: var(--anth-space-2); }
.atlas-paper [data-practice-reading-home] .system-info-surface { display: grid; gap: 6px; color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); font-variant-numeric: tabular-nums; }
.atlas-paper [data-practice-reading-home] .hero-settings-links { display: flex; flex-wrap: wrap; gap: var(--anth-space-4); margin-top: var(--anth-space-3); font-size: var(--anth-text-small-size); }
.atlas-paper [data-practice-reading-home] .settings-file-input { display: none; }

.atlas-paper [data-practice-reading-home] .backup-list-container { margin-top: var(--anth-space-6); }
.atlas-paper [data-practice-reading-home] .backup-list-header { display: flex; align-items: center; justify-content: space-between; gap: var(--anth-space-3); }
.atlas-paper [data-practice-reading-home] .backup-list-scroll { max-height: min(52vh, 520px); overflow: auto; }
.atlas-paper [data-practice-reading-home] .backup-entry { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--anth-space-3); padding: var(--anth-space-3) 0; }
.atlas-paper [data-practice-reading-home] .backup-entry-info { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.atlas-paper [data-practice-reading-home] .backup-entry-meta { color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }

/* ── Suite flow dialog: .dialog-overlay > .dialog (shadow-2) ─────────── */
/* Overlays are not .dialog-overlay while closed: the global scroll lock matches
   * that class, so a permanently present overlay would lock the page. */
.atlas-paper [data-practice-reading-home] .suite-mode-selector-modal {
  position: fixed;
  inset: 0;
  z-index: var(--anth-z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--anth-space-5);
  background: var(--anth-scrim);
}

.atlas-paper [data-practice-reading-home] .suite-mode-selector-modal:not(.show) { display: none; }
.atlas-paper [data-practice-reading-home] .suite-mode-selector-content .dialog-header h3 {
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-h2-size);
  line-height: var(--anth-text-h2-line);
}
.atlas-paper [data-practice-reading-home] .suite-mode-selector-subtitle { margin: var(--anth-space-1) 0 0; color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); }
.atlas-paper [data-practice-reading-home] .suite-flow-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 var(--anth-space-4); border-bottom: 1px solid var(--anth-rule); }
.atlas-paper [data-practice-reading-home] .suite-flow-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--anth-space-1);
  min-height: 96px;
  padding: var(--anth-space-3) var(--anth-space-1) var(--anth-space-3) 0;
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
.atlas-paper [data-practice-reading-home] .suite-flow-option span { font-weight: var(--anth-weight-medium); }
.atlas-paper [data-practice-reading-home] .suite-flow-option small { color: var(--anth-ink-muted); font-size: var(--anth-text-caption-size); line-height: var(--anth-text-small-line); }
.atlas-paper [data-practice-reading-home] .suite-flow-option:hover { border-top-color: var(--anth-ink-soft); }
.atlas-paper [data-practice-reading-home] .suite-flow-option.active { border-top-color: var(--anth-accent); }
.atlas-paper [data-practice-reading-home] .suite-frequency-selector { display: grid; gap: 6px; margin-top: var(--anth-space-4); color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); }
.atlas-paper [data-practice-reading-home] .suite-mode-selector-actions { display: flex; justify-content: flex-end; gap: var(--anth-space-2); margin: var(--anth-space-4) 0 var(--anth-space-5); }

/* ── Clock overlay: fullscreen .dialog-overlay ───────────────────────── */
.atlas-paper [data-practice-reading-home] .clock-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--anth-z-overlay);
  display: grid;
  place-items: center;
  padding: var(--anth-space-5);
  background: var(--anth-scrim);
}

.atlas-paper [data-practice-reading-home] .clock-overlay.is-hidden { display: none; }
.atlas-paper [data-practice-reading-home] .clock-overlay-inner {
  position: relative;
  display: grid;
  place-items: center;
  min-width: min(680px, 90vw);
  min-height: min(360px, 64vh);
  padding: var(--anth-space-8);
}
.atlas-paper [data-practice-reading-home] .clock-close-btn { position: absolute; top: var(--anth-space-3); right: var(--anth-space-3); }
.atlas-paper [data-practice-reading-home] .native-clock {
  font-family: var(--anth-font-serif);
  font-size: clamp(3rem, 12vw, 8rem);
  font-variant-numeric: lining-nums tabular-nums;
  line-height: 1;
}

/* ── PDF viewer: .dialog with header and a full-height frame ─────────── */
.atlas-paper [data-practice-reading-home] .pdf-viewer-dialog { --dialog-width: min(960px, calc(100vw - 32px)); height: min(82vh, 760px); padding: 0; }
.atlas-paper [data-practice-reading-home] .pdf-viewer-header { padding: var(--anth-space-3) var(--anth-space-4); }
.atlas-paper [data-practice-reading-home] .pdf-viewer-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.atlas-paper [data-practice-reading-home] .pdf-viewer-frame { flex: 1 1 auto; width: 100%; min-height: 0; border: 0; }

.atlas-paper [data-practice-reading-home] .practice-local-message {
  position: fixed;
  right: var(--anth-space-5);
  bottom: var(--anth-space-5);
  z-index: var(--anth-z-toast);
  max-width: min(420px, calc(100vw - 40px));
}
.atlas-paper [data-practice-reading-home] .ui-emoji-icon { display: inline-flex; width: 1em; height: 1em; vertical-align: -0.14em; }
.atlas-paper [data-practice-reading-home] .ui-emoji-icon svg { width: 100%; height: 100%; }

/* ── Narrow widths: columns stack, toolbars wrap ─────────────────────── */
@media (max-width: 900px) {
  .atlas-paper [data-practice-reading-home] .library-home-grid,
  .atlas-paper [data-practice-reading-home] .hero-settings-group,
  .atlas-paper [data-practice-reading-home] .suite-flow-options { grid-template-columns: minmax(0, 1fr); }
  .atlas-paper [data-practice-reading-home] .browse-title-bar > .shui-segmented-control { flex-basis: 100%; margin-left: 0; }
  .atlas-paper [data-practice-reading-home] .browse-sort-wrapper { flex: 1 1 100%; }
}

@media (max-width: 640px) {
  .atlas-paper [data-practice-reading-home] .custom-suite-picked-chip { width: 100%; }
  .atlas-paper [data-practice-reading-home] .custom-suite-selection-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 580px) {
  .atlas-paper [data-practice-reading-home] .tool-card-arrow { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .atlas-paper [data-practice-reading-home] .spinner { animation: none; }
}
</style>
