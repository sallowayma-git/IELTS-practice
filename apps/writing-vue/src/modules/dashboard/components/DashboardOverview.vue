<template>
  <div id="overview-view" class="view active" data-dashboard>
    <div class="dash">
    <MascotState v-if="dataError" kind="error" data-dashboard-error :title="dataError">
      <div class="empty-state-action">
        <button class="btn btn-secondary btn-sm" type="button" @click="load">重试</button>
      </div>
    </MascotState>

    <div class="dash-kpis" data-dashboard-kpis>
      <article v-for="tile in tiles" :key="tile.key" class="card kpi" :data-kpi="tile.key">
        <p class="stat-label">{{ tile.label }}</p>
        <p class="stat-value t-num">{{ tile.value }}</p>
        <p class="kpi-sub t-num">{{ tile.sub }}</p>
        <p v-if="tile.delta" :class="['stat-delta', 't-num', tile.delta.tone && `is-${tile.delta.tone}`]">{{ tile.delta.text }}</p>
      </article>
    </div>

    <div class="dash-row">
      <section class="card dash-trend" aria-labelledby="dash-trend-title" data-dashboard-trend>
        <div class="panel-header">
          <h3 id="dash-trend-title">成绩走势</h3>
          <div v-if="series.length > 1" class="segmented toggle-group" role="group" aria-label="走势类型">
            <button
              v-for="item in series"
              :key="item.key"
              type="button"
              class="segmented-item toggle-item"
              :aria-pressed="item.key === activeSeries?.key ? 'true' : 'false'"
              :data-trend-toggle="item.key"
              @click="selectedTrendKey = item.key"
            >
              {{ activityLabel(item.key) }}
            </button>
          </div>
        </div>
        <LineChart
          v-if="activeSeries"
          compact
          :history-data="activeSeries.data"
          :min-score="activeSeries.minScore"
          :max-score="activeSeries.maxScore"
          :grid-lines="activeSeries.gridLines"
          :score-prefix="activeSeries.scorePrefix"
          :score-suffix="activeSeries.scoreSuffix"
          :axis-label-decimals="activeSeries.axisLabelDecimals"
        />
        <div v-else-if="loaded" class="dash-empty">
          <p>完成第一篇练习后，这里会出现走势。</p>
          <button class="btn btn-secondary btn-sm" type="button" @click="$emit('start-random-practice', 'all', 'reading')">随机开始一篇阅读</button>
        </div>
        <p v-else class="dash-empty">读取中…</p>
      </section>

      <ReadingOverviewPanel
        :reading-category-entries="readingCategoryEntries"
        :writing-entries="WRITING_ENTRIES"
        :error="error"
        :suite-error="suiteError"
        @browse-writing="browseWriting"
        @random-writing="randomWriting"
        @browse-category="(...args) => $emit('browse-category', ...args)"
        @start-random-practice="(...args) => $emit('start-random-practice', ...args)"
        @retry-load="(...args) => $emit('retry-load', ...args)"
      />
    </div>

    <section class="card dash-recent" aria-labelledby="dash-recent-title" data-dashboard-recent>
      <div class="panel-header">
        <h3 id="dash-recent-title">最近练习</h3>
        <RouterLink class="btn btn-ghost btn-sm" to="/history" data-dashboard-link="history">查看全部 →</RouterLink>
      </div>
      <div v-if="recent.length" class="list">
        <button
          v-for="item in recent"
          :key="item.record.id"
          type="button"
          class="list-row dash-record"
          :data-record-id="item.record.id"
          :disabled="!item.record.detailRoute"
          @click="openRecord(item.record)"
        >
          <span class="dash-tag list-row-lead" :data-activity="item.record.activity">{{ activityLabel(item.record.activity) }}</span>
          <span class="list-row-main">
            <span class="list-row-title">{{ item.record.title }}</span>
            <span class="list-row-meta">{{ recordDetail(item.record) }}</span>
          </span>
          <span class="dash-record__score list-row-trail">
            <span class="t-num">{{ item.record.score.display }}</span>
            <span class="dash-record__time">{{ item.ago }}</span>
          </span>
        </button>
      </div>
      <MascotState
        v-else-if="loaded"
        kind="empty"
        class="dash-empty-state"
        desc="还没有练习记录。完成一篇阅读或写作后，会出现在这里。"
      />
      <p v-else class="dash-empty">读取中…</p>
    </section>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import LineChart from '@/components/LineChart.vue'
import MascotState from '@/components/mascot/MascotState.vue'
import ReadingOverviewPanel from '@/modules/practice-reading/components/ReadingOverviewPanel.vue'
import { useDashboard } from '@/modules/dashboard/useDashboard.js'
import { formatAverage, formatDelta } from '@/modules/dashboard/dashboardCore.js'
import { activityLabel, recordDetail } from '@/modules/history/records.js'
import { trendMood } from '@/components/mascot/moodFor.js'

defineProps({
  readingCategoryEntries: { type: Array, required: true },
  error: { type: String, default: '' },
  suiteError: { type: String, default: '' }
})

const emit = defineEmits([
  'browse-category',
  'start-random-practice',
  'retry-load',
  'mood'
])

const router = useRouter()
const { dashboard, loaded, error: dataError, load } = useDashboard()
const ready = computed(() => loaded.value && !dataError.value)

const series = computed(() => dashboard.value.trendSeries)
const selectedTrendKey = ref('')
const activeSeries = computed(() => {
  const key = series.value.some((item) => item.key === selectedTrendKey.value)
    ? selectedTrendKey.value
    : dashboard.value.defaultTrendKey
  return series.value.find((item) => item.key === key) || null
})

const recent = computed(() => dashboard.value.recent)

// Overview mood is only shown when the numbers are real; the header reads it via @mood.
const trend = computed(() => trendMood({
  delta: { reading: dashboard.value.reading.delta, writing: dashboard.value.writing.delta },
  streak: dashboard.value.streak,
  count: dashboard.value.reading.count + dashboard.value.writing.count
}))
watch(() => (ready.value ? trend.value : ''), (mood) => emit('mood', mood), { immediate: true })

function weekTile() {
  const { week } = dashboard.value
  return {
    key: 'week',
    label: '本周练习',
    value: ready.value ? String(week.total) : '—',
    sub: `阅读 ${week.reading} · 写作 ${week.writing}`,
    delta: null
  }
}

function averageTile(activity, label) {
  const average = dashboard.value[activity]
  const delta = formatDelta(activity, average.delta)
  const hasValue = ready.value && average.value !== null
  return {
    key: activity,
    label,
    value: hasValue ? formatAverage(activity, average.value) : '—',
    sub: hasValue ? `最近 ${average.count} 次` : '—',
    delta: hasValue && delta.text ? { text: `较前 10 次 ${delta.text}`, tone: delta.tone } : null
  }
}

function streakTile() {
  const { streak, lastLabel } = dashboard.value
  return {
    key: 'streak',
    label: '连续练习',
    value: ready.value ? `${streak} 天` : '—',
    sub: lastLabel ? `最近一次：${lastLabel}` : '暂无记录',
    delta: null
  }
}

const tiles = computed(() => [
  weekTile(),
  averageTile('reading', '阅读正确率'),
  averageTile('writing', '写作 Band'),
  streakTile()
])

function openRecord(record) {
  if (!record.detailRoute) return
  router.push(record.detailRoute).catch(() => {})
}

const WRITING_ENTRIES = Object.freeze([
  { type: 'task1', label: 'T1', title: '小作文 · 图表描述' },
  { type: 'task2', label: 'T2', title: '大作文 · 议论文' }
])

function browseWriting(type) {
  router.push({ name: 'TopicManage', query: { type } }).catch(() => {})
}

function randomWriting(type) {
  router.push({ name: 'Compose', query: { taskType: type } }).catch(() => {})
}
</script>

<style scoped>
.dash {
  display: grid;
  gap: var(--anth-space-5);
  min-width: 0;
}

.dash-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--anth-space-4);
}

.kpi {
  display: grid;
  align-content: start;
  gap: var(--anth-space-1);
  padding: var(--anth-space-4) var(--anth-space-5);
}

.kpi-sub,
.kpi .stat-delta {
  margin: 0;
}

.kpi-sub {
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  line-height: var(--anth-text-small-line);
}

/* "写作 Band" is a label, not a shouted caption. */
.kpi[data-kpi="writing"] .stat-label {
  letter-spacing: normal;
  text-transform: none;
}

.dash-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--anth-space-5);
  align-items: stretch;
}

.dash-trend,
.dash-recent {
  min-width: 0;
}

.dash-empty {
  display: grid;
  justify-items: start;
  gap: var(--anth-space-3);
  margin: 0;
  padding: var(--anth-space-5) 0;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}

.dash-error {
  display: flex;
  align-items: center;
  gap: var(--anth-space-2);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}

/* Recent attempts: rows sit on the card surface, hairline between rows. */
.dash-recent > .list {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}

.dash-recent .dash-record {
  width: 100%;
  padding: var(--anth-space-3) 0;
  border: 0;
  border-bottom: 1px solid var(--anth-rule);
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dash-recent .dash-record:last-child {
  border-bottom: 0;
}

.dash-recent .dash-record:hover {
  background: transparent;
}

.dash-recent .dash-record:not(:disabled):hover .list-row-title {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.dash-recent .dash-record:disabled {
  cursor: default;
}

.dash-recent .dash-record:focus-visible {
  outline: none;
  box-shadow: var(--anth-focus-ring);
}

.dash-record__score {
  display: grid;
  justify-items: end;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.dash-record__time {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-caption-size);
}

.dash-tag {
  padding: 2px 8px;
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-xs);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-caption-size);
  white-space: nowrap;
}

.dash-tag[data-activity="writing"] {
  border-color: var(--anth-accent);
  color: var(--anth-accent);
}

@media (max-width: 900px) {
  .dash-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dash-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 520px) {
  .dash-kpis {
    grid-template-columns: minmax(0, 1fr);
  }

  .dash-trend,
  .dash-recent {
    padding: var(--anth-space-4);
  }
}
</style>
