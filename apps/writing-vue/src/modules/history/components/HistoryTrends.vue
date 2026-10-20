<template>
  <section class="card history-trends" aria-labelledby="history-trends-title">
    <div class="panel-header">
      <h2 id="history-trends-title">走势</h2>
    </div>

    <div class="history-trends__grid">
      <figure
        v-for="series in seriesList"
        :key="series.key"
        class="history-trend"
        :data-trend-scale="series.key"
      >
        <figcaption class="history-trend__head">
          <h3>{{ series.title }}</h3>
          <span class="t-small history-trend__caption">{{ caption(series) }}</span>
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
        <table class="table">
          <thead>
            <tr>
              <th scope="col">评分项</th>
              <th scope="col" class="num">最新</th>
              <th scope="col" class="num">平均</th>
              <th scope="col" class="num">差值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <th scope="row">{{ row.label }}</th>
              <td class="num">{{ row.latest }}</td>
              <td class="num">{{ row.average }}</td>
              <td :class="['num', differenceClass(row.diff)]">{{ formatDifference(row.diff) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="field-help history-criteria__note">{{ criteriaNote }}</p>
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
/* A dashboard-style card: the header is the title row, each chart is a tile inside it. */
.atlas-paper .history-trends {
  display: grid;
  gap: var(--anth-space-4);
}

.history-trends__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: var(--anth-space-6) var(--anth-space-8);
}

@media (max-width: 640px) {
  .history-trends__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.history-trend,
.history-criteria {
  min-width: 0;
  margin: 0;
  padding: var(--anth-space-4);
  border: 1px solid var(--anth-card-border);
  border-radius: var(--anth-radius-card);
  background: var(--anth-surface-raised);
}

.history-trend__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--anth-space-3);
  margin-bottom: var(--anth-space-2);
}

.history-trend__head h3,
.history-criteria h3 {
  margin: 0;
  font-size: var(--anth-text-body-size);
}

.history-trend__caption {
  color: var(--anth-ink-muted);
}

.history-criteria h3 {
  margin-bottom: var(--anth-space-2);
}

.history-criteria__note {
  margin: var(--anth-space-2) 0 0;
}

.history-criteria .is-up { color: var(--anth-success); }
.history-criteria .is-down { color: var(--anth-danger); }
.history-criteria .is-flat { color: var(--anth-ink-muted); }

@media (max-width: 760px) {
  .history-trends__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
