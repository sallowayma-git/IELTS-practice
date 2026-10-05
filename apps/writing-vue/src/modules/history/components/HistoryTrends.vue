<template>
  <section class="history-trends" aria-labelledby="history-trends-title">
    <h2 id="history-trends-title" class="heading-serif">走势</h2>

    <div class="history-trends__grid">
      <figure
        v-for="series in seriesList"
        :key="series.key"
        class="history-trend"
        :data-trend-scale="series.key"
      >
        <figcaption>
          <h3>{{ series.title }}</h3>
          <span>{{ caption(series) }}</span>
        </figcaption>
        <LineChart
          :historyData="series.data"
          :min-score="series.minScore"
          :max-score="series.maxScore"
          :grid-lines="series.gridLines"
          :score-prefix="series.scorePrefix"
          :score-suffix="series.scoreSuffix"
          :axis-label-decimals="series.axisLabelDecimals"
        />
      </figure>

      <div v-if="rows.length > 0" class="history-criteria" data-history-criteria>
        <h3>四项评分</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">评分项</th>
              <th scope="col">最新</th>
              <th scope="col">平均</th>
              <th scope="col">差值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <th scope="row">{{ row.label }}</th>
              <td>{{ row.latest }}</td>
              <td>{{ row.average }}</td>
              <td :class="differenceClass(row.diff)">{{ formatDifference(row.diff) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="history-criteria__note">{{ criteriaNote }}</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import LineChart from '@/components/LineChart.vue'

const props = defineProps({
  /** buildTrendSeries(...) entries, already filtered to the ones worth drawing. */
  seriesList: { type: Array, required: true },
  /** { count, latest, average, latestTaskType } for the writing criteria, or null. */
  criteria: { type: Object, default: null },
  /** What the criteria cover, e.g. "全部写作" or "Task 1". */
  criteriaScope: { type: String, default: '全部写作' }
})

const TASK_CRITERION = { task1: 'Task Achievement', task2: 'Task Response' }

const rows = computed(() => {
  const { criteria } = props
  if (!criteria || !(criteria.count > 0)) return []
  const labelled = [
    ['tr_ta', TASK_CRITERION[criteria.latestTaskType] || 'Task Criterion'],
    ['cc', 'Coherence & Cohesion'],
    ['lr', 'Lexical Resource'],
    ['gra', 'Grammatical Range']
  ]
  return labelled.map(([key, label]) => ({
    key,
    label,
    latest: criteria.latest[key].toFixed(1),
    average: criteria.average[key].toFixed(1),
    diff: criteria.latest[key] - criteria.average[key]
  }))
})

const criteriaNote = computed(() => `${props.criteriaScope}，共 ${props.criteria?.count ?? 0} 篇；差值为最新一篇减去平均。`)

const caption = (series) => (
  series.total > series.data.length ? `最近 ${series.data.length} 次` : `共 ${series.total} 次`
)

function formatDifference(diff) {
  if (diff > 0) return `+${diff.toFixed(1)}`
  return diff < 0 ? diff.toFixed(1) : '0.0'
}

function differenceClass(diff) {
  if (diff > 0) return 'is-up'
  return diff < 0 ? 'is-down' : 'is-flat'
}
</script>

<style scoped>
.history-trends {
  margin-top: 28px;
  padding-top: 14px;
  border-top: 1px solid var(--anth-ink);
}

.history-trends > h2 {
  margin: 0 0 16px;
  font-size: var(--anth-text-lg);
}

.history-trends__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 28px 48px;
}

.history-trend {
  min-width: 0;
  margin: 0;
}

.history-trend figcaption {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.history-trend h3,
.history-criteria h3 {
  margin: 0;
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  font-weight: var(--anth-weight-medium);
}

.history-trend figcaption span,
.history-criteria__note {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
  font-variant-numeric: lining-nums tabular-nums;
}

.history-criteria {
  min-width: 0;
}

.history-criteria h3 {
  margin-bottom: 8px;
}

.history-criteria table {
  table-layout: fixed;
}

.history-criteria :is(th, td):not(:first-child) {
  width: 4.5rem;
  padding-right: 0;
  text-align: right;
}

.history-criteria tbody th {
  font-weight: var(--anth-weight-normal);
  color: var(--anth-ink);
}

.history-criteria td.is-up { color: var(--anth-success); }
.history-criteria td.is-down { color: var(--anth-danger); }
.history-criteria td.is-flat { color: var(--anth-ink-faint); }

.history-criteria__note {
  margin: 8px 0 0;
}

@media (max-width: 760px) {
  .history-trends__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
