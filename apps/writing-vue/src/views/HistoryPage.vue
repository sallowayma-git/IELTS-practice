<template>
  <div class="workspace history-workspace">
    <div
      class="history-page scroll-region"
      :data-history-activity="view.activity || 'all'"
      :style="{ '--history-toolbar-h': `${toolbarHeight}px` }"
    >
      <header class="page-header">
        <div class="page-header-top">
          <div class="history-head__copy">
            <p class="page-header-kicker">HISTORY · 历史</p>
            <h1>练习记录</h1>
          </div>
        </div>
        <p class="page-header-desc history-summary" data-history-summary>{{ summary }}</p>
      </header>

      <!-- Sticky: activity tabs, search, and the selection bar when selecting -->
      <div ref="toolbarRef" class="toolbar is-sticky history-toolbar-bar">
        <div class="history-bar-row">
          <nav aria-label="练习类型">
            <div class="segmented toggle-group history-tabs" role="tablist">
              <button
                v-for="tab in tabs"
                :key="tab.value || 'all'"
                type="button"
                role="tab"
                class="segmented-item toggle-item"
                :aria-selected="view.activity === tab.value ? 'true' : 'false'"
                :data-history-tab="tab.value || 'all'"
                @click="selectActivity(tab.value)"
              >
                {{ tab.label }}
              </button>
            </div>
          </nav>

          <HistoryToolbar
            v-model:search="draft.search"
            v-model:filters-open="filtersOpen"
            :filtered="hasFilters(view)"
            @clear="clearAllFilters"
          >
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :aria-pressed="selecting ? 'true' : 'false'"
              :disabled="loading || total === 0"
              data-history-toggle="selection"
              @click="selecting = !selecting"
            >
              选择
            </button>
            <HistoryExportMenu :disabled="loading || total === 0" @export="exportAs" />
          </HistoryToolbar>
        </div>

        <HistorySelectionBar
          v-if="selecting"
          :count="selectedIds.length"
          :has-rows="records.length > 0"
          :clear-label="clearLabel"
          @delete="askDelete('batch')"
          @select-page="selectPage"
          @cancel="selecting = false"
          @clear-all="askDelete('all')"
        />
      </div>

      <HistoryFilterPanel
        v-if="filtersOpen"
        v-model:start-date="draft.startDate"
        v-model:end-date="draft.endDate"
        v-model:min-score="draft.minScore"
        v-model:max-score="draft.maxScore"
        :kind="view.kind"
        :score="activityConfig?.score ?? null"
        :kinds="activityConfig?.kinds ?? []"
        @update:kind="(kind) => update({ kind })"
      />

      <div
        v-if="pageNotice.message"
        :class="['page-notice', 'inline-message', `inline-message-${pageNotice.type}`, `notice-${pageNotice.type}`]"
        role="status"
      >
        <span>{{ pageNotice.message }}</span>
        <button class="btn btn-ghost btn-sm" type="button" @click="clearPageNotice" aria-label="关闭提示">关闭</button>
      </div>

      <div
        v-if="loading"
        class="loading history-list-state history-list-state--loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span class="history-state-spinner" aria-hidden="true"></span>
        <p class="state-message">加载历史记录中...</p>
      </div>

      <div
        v-else-if="error"
        class="error-state history-list-state history-list-state--error"
        role="alert"
        aria-live="assertive"
      >
        <div class="inline-message inline-message-error">
          <p>{{ error }}</p>
        </div>
        <button class="btn btn-secondary" type="button" @click="loadRecords()">重试</button>
      </div>

      <div
        v-else-if="records.length === 0 && hasFilters(view)"
        class="empty-state history-list-state history-list-state--filtered"
        role="status"
        aria-live="polite"
      >
        <h3>没有匹配的记录</h3>
        <p class="empty-state-desc">当前筛选条件下没有记录。</p>
        <div class="empty-state-action">
          <button class="btn btn-secondary btn-sm" type="button" @click="clearAllFilters">清除筛选</button>
        </div>
      </div>

      <div
        v-else-if="records.length === 0"
        class="empty-state history-list-state history-list-state--empty"
        role="status"
        aria-live="polite"
      >
        <h3>还没有练习记录</h3>
        <p class="empty-state-desc">{{ emptyText }}</p>
        <div v-if="startLinks.length > 0" class="empty-state-action history-start-links">
          <router-link
            v-for="(link, index) in startLinks"
            :key="link.to"
            :to="link.to"
            class="btn"
            :class="index === 0 ? 'btn-primary' : 'btn-secondary'"
          >
            {{ link.label }}
          </router-link>
        </div>
      </div>

      <HistoryRecordList
        v-else
        :records="records"
        :selecting="selecting"
        :selected-ids="selectedIds"
        @open="openRecord"
        @toggle="toggleSelection"
      />

      <nav v-if="total > PAGE_SIZE" class="history-pagination" aria-label="分页">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="view.page <= 1" @click="update({ page: view.page - 1 })">‹ 上一页</button>
        <span class="history-pagination__dot" aria-hidden="true">·</span>
        <span class="history-pagination__info t-num" aria-current="page">{{ view.page }} / {{ totalPages }}</span>
        <span class="history-pagination__dot" aria-hidden="true">·</span>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="view.page >= totalPages" @click="update({ page: view.page + 1 })">下一页 ›</button>
      </nav>

      <HistoryTrends
        v-if="trendSeries.length > 0"
        :series-list="trendSeries"
        :criteria="scopeCriteria"
        :criteria-scope="criteriaScope"
      />

      <HistoryDeleteDialog
        v-if="deleteMode"
        :key="deleteMode"
        :mode="deleteMode"
        :scope-label="view.activity ? scopeLabel : ''"
        :count="selectedIds.length"
        @cancel="deleteMode = ''"
        @confirm="executeDelete"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { essays as essaysApi } from '@/api/client.js'
import { historyRepository } from '@/api/history-repository.js'
import { debounce } from '@/utils/debounce.js'
import { createRequestGate } from '@/utils/request-gate.js'
import HistoryDeleteDialog from '@/modules/history/components/HistoryDeleteDialog.vue'
import HistoryExportMenu from '@/modules/history/components/HistoryExportMenu.vue'
import HistoryFilterPanel from '@/modules/history/components/HistoryFilterPanel.vue'
import HistoryRecordList from '@/modules/history/components/HistoryRecordList.vue'
import HistorySelectionBar from '@/modules/history/components/HistorySelectionBar.vue'
import HistoryToolbar from '@/modules/history/components/HistoryToolbar.vue'
import HistoryTrends from '@/modules/history/components/HistoryTrends.vue'
import { csvFilename, downloadTextFile } from '@/modules/history/export.js'
import { buildHistoryMarkdown, markdownFilename } from '@/modules/history/markdown.js'
import { ACTIVITIES, activityLabel, buildTrendSeries, summarizeRecords, toRecord } from '@/modules/history/records.js'
import {
  PAGE_SIZE,
  clearFilters,
  hasFilters,
  hasPanelFilters,
  normalizeView,
  parseView,
  sameView,
  serializeView,
  statisticsRange,
  summaryScopeLabel,
  switchActivity,
  toListQuery,
  validateView,
  viewScopeKey
} from '@/modules/history/view-state.js'

const route = useRoute()
const router = useRouter()

// ── View state: the URL is the single source of truth ────────────────
const view = computed(() => parseView(route.query))
const activityConfig = computed(() => ACTIVITIES[view.value.activity] ?? null)
const scopeLabel = computed(() => (view.value.activity ? activityLabel(view.value.activity) : '全部'))

function commit(next) {
  router.replace({ query: serializeView(next) }).catch(() => {})
}

/** Change part of the view; the page goes back to 1 unless it is given. */
function update(changes) {
  commit(normalizeView({ ...view.value, page: 1, ...changes }))
}

function selectActivity(activity) {
  if (activity !== view.value.activity) commit(switchActivity(view.value, activity))
}

function clearAllFilters() {
  commit(clearFilters(view.value))
}

// Text-like filters are typed into a draft and reach the URL after a pause;
// the URL flows back into the draft only when it says something else.
const draft = reactive({ search: '', startDate: '', endDate: '', minScore: '', maxScore: '' })
const draftOf = (source) => ({
  search: source.search,
  startDate: source.startDate,
  endDate: source.endDate,
  minScore: source.minScore ?? '',
  maxScore: source.maxScore ?? ''
})

watch(view, (next) => {
  const typed = normalizeView({ ...next, ...draft })
  if (!sameView(typed, next)) Object.assign(draft, draftOf(next))
}, { immediate: true })

const pushDraft = debounce(() => {
  const next = normalizeView({ ...view.value, ...draft })
  if (viewScopeKey(next) !== viewScopeKey(view.value)) commit({ ...next, page: 1 })
}, 300)
watch(draft, pushDraft)

// ── Data ─────────────────────────────────────────────────────────────
const records = ref([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const presentActivities = ref([])
// Everything in the current scope (all pages): feeds the summary and trends.
const scope = ref({ key: '', records: [], criteria: null })
const pageNotice = ref({ type: '', message: '' })

const listGate = createRequestGate()
const scopeGate = createRequestGate()
const presentGate = createRequestGate()

const totalPages = computed(() => Math.ceil(total.value / PAGE_SIZE))

const tabs = computed(() => {
  const visible = new Set(presentActivities.value)
  if (view.value.activity) visible.add(view.value.activity)
  return [
    { value: '', label: '全部' },
    ...Object.keys(ACTIVITIES)
      .filter((name) => visible.has(name))
      .map((name) => ({ value: name, label: activityLabel(name) }))
  ]
})

function setPageNotice(type, message) {
  pageNotice.value = { type: message ? type : '', message: message ? String(message).trim() : '' }
}

const clearPageNotice = () => setPageNotice('', '')

function failList(message) {
  error.value = message
  records.value = []
  total.value = 0
  scope.value = { key: '', records: [], criteria: null }
  scopeGate.invalidate()
}

async function loadRecords(forceScope = false) {
  const requestId = listGate.begin()
  const snapshot = view.value
  loading.value = true
  error.value = ''
  clearPageNotice()

  const invalid = validateView(snapshot)
  if (invalid) {
    failList(invalid)
    loading.value = false
    return
  }

  try {
    const offset = (snapshot.page - 1) * PAGE_SIZE
    const page = await historyRepository.listHistory(toListQuery(snapshot, { limit: PAGE_SIZE, offset }))
    if (!listGate.isCurrent(requestId)) return

    const pageTotal = Number(page.total || 0)
    const lastPage = Math.max(1, Math.ceil(pageTotal / PAGE_SIZE))
    if (snapshot.page > lastPage) return update({ page: lastPage })

    records.value = (page.items || []).map(toRecord)
    total.value = pageTotal
    keepVisibleSelections()
    refreshScope(snapshot, pageTotal, forceScope)
  } catch (err) {
    if (!listGate.isCurrent(requestId)) return
    console.error('加载历史记录失败:', err)
    failList(err.message || '加载失败，请重试')
  } finally {
    if (listGate.isCurrent(requestId)) loading.value = false
  }
}

function toCriteria(result) {
  if (!(result?.count > 0 && result.latest?.score && result.average)) return null
  const band = (score) => ({
    tr_ta: parseFloat(score.taskResponse || 0),
    cc: parseFloat(score.coherence || 0),
    lr: parseFloat(score.lexical || 0),
    gra: parseFloat(score.grammar || 0)
  })
  return {
    count: result.count,
    latest: band(result.latest.score),
    average: band(result.average),
    latestTaskType: result.latest.taskType
  }
}

async function loadCriteria(snapshot) {
  if (snapshot.activity !== 'writing') return null
  try {
    return toCriteria(await essaysApi.getStatistics(statisticsRange(snapshot)))
  } catch (err) {
    console.error('加载写作评分统计失败:', err)
    return null
  }
}

async function loadAllRecords(snapshot) {
  try {
    const { items } = await historyRepository.listHistoryAll(toListQuery(snapshot))
    return items.map(toRecord)
  } catch (err) {
    console.error('加载走势数据失败:', err)
    return []
  }
}

// Once per scope (filters + tab), not once per page; deletes force a reload.
async function refreshScope(snapshot, pageTotal, force) {
  const key = viewScopeKey(snapshot)
  if (!force && scope.value.key === key) return
  const requestId = scopeGate.begin()
  scope.value = { key, records: [], criteria: null }
  if (pageTotal === 0) return

  const [allRecords, criteria] = await Promise.all([loadAllRecords(snapshot), loadCriteria(snapshot)])
  if (scopeGate.isCurrent(requestId)) scope.value = { key, records: allRecords, criteria }
}

// Which activities have any record at all (independent of filters).
async function loadPresentActivities() {
  const requestId = presentGate.begin()
  const probes = await Promise.all(Object.keys(ACTIVITIES).map(async (name) => {
    try {
      const page = await historyRepository.listHistory({ activity: name, limit: 1 })
      return page.items.some((item) => item.activity === name) ? name : null
    } catch {
      return null
    }
  }))
  if (presentGate.isCurrent(requestId)) presentActivities.value = probes.filter(Boolean)
}

// ── Header sentence and trends (from the whole scope) ────────────────
const scopeReady = computed(() => scope.value.key === viewScopeKey(view.value))
const summary = computed(() => (
  scopeReady.value && !loading.value && !error.value
    ? summarizeRecords(scope.value.records, summaryScopeLabel(view.value))
    : ''
))
const trendSeries = computed(() => (
  scopeReady.value ? buildTrendSeries(scope.value.records).filter((series) => series.data.length >= 2) : []
))
const scopeCriteria = computed(() => (scopeReady.value ? scope.value.criteria : null))
const criteriaScope = computed(() => (view.value.kind === 'task1' ? 'Task 1' : view.value.kind === 'task2' ? 'Task 2' : '全部写作'))

// ── Empty states ─────────────────────────────────────────────────────
const emptyActivities = computed(() => (view.value.activity ? [view.value.activity] : Object.keys(ACTIVITIES)))
const startLinks = computed(() => emptyActivities.value.map((name) => ACTIVITIES[name].start).filter(Boolean))
const emptyText = computed(() => {
  if (view.value.activity) return ACTIVITIES[view.value.activity].empty
  const names = startLinks.value.length > 0
    ? emptyActivities.value.filter((name) => ACTIVITIES[name].start).map(activityLabel).join('或')
    : '练习'
  return `这里还是空的。完成一次${names}练习后，记录会按日期排在这里。`
})

// ── Filters panel / selection mode ───────────────────────────────────
const filtersOpen = ref(hasPanelFilters(view.value))
const selecting = ref(false)
const selectedIds = ref([])
const clearLabel = computed(() => (view.value.activity ? `清空${scopeLabel.value}全部记录` : '清空全部记录'))

function toggleSelection(id) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((selectedId) => selectedId !== id)
    : [...selectedIds.value, id]
}

const selectPage = () => { selectedIds.value = records.value.map((record) => record.id) }

function keepVisibleSelections() {
  const visible = new Set(records.value.map((record) => record.id))
  selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
}

watch(selecting, (on) => { if (!on) selectedIds.value = [] })
watch(() => records.value.length, (count) => { if (count === 0) selecting.value = false })

function openRecord(record) {
  if (!record.detailRoute) {
    setPageNotice('error', '这条记录缺少打开详情所需的信息')
    return
  }
  router.push(record.detailRoute)
}

// ── Delete (selection → 删除, or the scoped clear-all) ───────────────
const deleteMode = ref('') // '' | 'batch' | 'all'

function askDelete(mode) {
  if (mode === 'batch' && selectedIds.value.length === 0) return
  clearPageNotice()
  deleteMode.value = mode
}

async function executeDelete() {
  const mode = deleteMode.value
  deleteMode.value = ''
  try {
    if (mode === 'batch') await essaysApi.batchDelete(selectedIds.value)
    else await essaysApi.deleteAll(view.value.activity || null)
    selectedIds.value = []
    await Promise.all([loadRecords(true), loadPresentActivities()])
  } catch (err) {
    console.error('删除失败:', err)
    setPageNotice('error', `删除失败：${err.message || '请重试'}`)
  }
}

// ── Export (respects the tab and every filter) ───────────────────────
async function exportCsv(snapshot) {
  const { result } = await historyRepository.exportHistory('csv', toListQuery(snapshot, { limit: 10_000 }))
  const body = typeof result === 'string' ? result : (result?.body ?? '')
  if (!body) throw new Error('历史导出未返回内容')
  downloadTextFile(csvFilename(snapshot), body, 'text/csv;charset=utf-8;')
  return '历史 CSV 已导出。'
}

async function exportMarkdown(snapshot) {
  const { items } = await historyRepository.listHistoryAll(toListQuery(snapshot))
  if (items.length === 0) throw new Error('暂无可导出的练习记录')
  const markdown = buildHistoryMarkdown(items.map(toRecord), { scopeLabel: scopeLabel.value })
  downloadTextFile(markdownFilename(snapshot.activity), markdown, 'text/markdown;charset=utf-8')
  return `Markdown 已导出：${items.length} 条。`
}

const EXPORTERS = { csv: exportCsv, markdown: exportMarkdown }

async function exportAs(format) {
  clearPageNotice()
  const snapshot = view.value
  const invalid = validateView(snapshot)
  if (invalid) return setPageNotice('error', invalid)
  try {
    setPageNotice('success', await EXPORTERS[format](snapshot))
  } catch (err) {
    console.error(`导出 ${format} 失败:`, err)
    setPageNotice('error', `导出失败：${err.message || '请重试'}`)
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────
watch(() => JSON.stringify(view.value), () => loadRecords())

// The sticky toolbar's height: list-group titles stick just below it.
const toolbarRef = ref(null)
const toolbarHeight = ref(0)
let toolbarObserver = null

onMounted(() => {
  loadRecords()
  loadPresentActivities()
  if (toolbarRef.value && typeof ResizeObserver !== 'undefined') {
    toolbarObserver = new ResizeObserver(() => { toolbarHeight.value = toolbarRef.value?.offsetHeight ?? 0 })
    toolbarObserver.observe(toolbarRef.value)
  }
})

onBeforeUnmount(() => {
  listGate.invalidate()
  scopeGate.invalidate()
  presentGate.invalidate()
  toolbarObserver?.disconnect()
})
</script>

<style scoped>
/* The page is the scroll region; the header and sticky toolbar scroll with
   it, so only the workspace grid needs to claim the viewport height. */
.workspace.history-workspace {
  grid-template-rows: minmax(0, 1fr);
}

.history-page {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-5);
  min-width: 0;
  padding-bottom: var(--anth-space-8);
}

.history-head__copy {
  display: grid;
  gap: var(--anth-space-2);
  min-width: 0;
}

/* Reserve the summary line so the list does not jump when it arrives. */
.history-page .history-summary {
  min-height: 1.6em;
}

.history-toolbar-bar {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-2);
}

.history-bar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-2) var(--anth-space-4);
}

.history-tabs {
  max-width: 100%;
  overflow-x: auto;
}

.history-list-state {
  display: grid;
  justify-items: center;
  gap: var(--anth-space-3);
  min-height: 180px; /* loading, error and empty states never collapse to their text */
  padding: var(--anth-space-8) var(--anth-space-5);
  text-align: center;
}

@media (max-width: 640px) {
  .history-list-state {
    min-height: 160px;
  }
}

.history-list-state .inline-message {
  max-width: 34rem;
  text-align: left;
}

.history-state-spinner {
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--anth-rule-strong);
  border-top-color: var(--anth-accent);
  border-radius: 50%;
  animation: history-spin 0.9s linear infinite;
}

@keyframes history-spin {
  to { transform: rotate(1turn); }
}

@media (prefers-reduced-motion: reduce) {
  .history-state-spinner {
    animation: none;
  }
}

.history-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--anth-space-3);
}

.history-pagination__info {
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
}
</style>
