<template>
  <div class="weekly-report-body">
    <section
      v-for="block in week.blocks"
      :key="block.id"
      class="notebook-section notebook-block"
      :data-week-block="block.kind"
      :data-notebook-next="block.kind === 'next_week_plan' ? '' : undefined"
    >
      <h3><span class="notebook-mark" aria-hidden="true">§</span>{{ block.heading }}</h3>
      <p v-if="block.lead" class="notebook-prose notebook-lead">{{ block.lead }}</p>

      <div v-if="block.stats.length" class="notebook-stats notebook-block__stats">
        <div v-for="item in block.stats" :key="item.label" class="stat">
          <span class="stat-label">{{ item.label }}</span>
          <span class="stat-value">{{ item.value }}</span>
          <span v-if="item.delta" class="stat-delta">{{ item.delta }}</span>
        </div>
      </div>

      <component :is="CHARTS[block.chart.kind]" v-if="block.chart" :chart="block.chart" />

      <ul v-if="block.rows.length" class="notebook-notes notebook-block__rows">
        <li v-for="row in block.rows" :key="row.key"><span>{{ row.text }}</span></li>
      </ul>

      <p v-if="block.tags.length" class="notebook-block__tags">
        <span v-for="tag in block.tags" :key="tag.key" class="tag">{{ tag.text }}</span>
      </p>

      <ol v-if="block.plan" class="notebook-practice">
        <li v-for="item in block.plan.items" :key="item.key">
          <router-link v-if="item.link" class="text-link" :to="item.link"><strong>{{ item.label }}</strong></router-link>
          <strong v-else>{{ item.label }}</strong>
          <span>{{ item.probeLabel }}</span>
          <span class="notebook-practice__time">约 {{ item.minutes }} 分钟</span>
        </li>
      </ol>
      <p v-if="block.plan && block.plan.items.length > 1" class="section-meta">一共约 {{ block.plan.totalMinutes }} 分钟</p>
    </section>
  </div>
</template>
<script setup>
import WeeklyBandLine from '@/components/notebook/WeeklyBandLine.vue'
import WeeklyDayBars from '@/components/notebook/WeeklyDayBars.vue'
import WeeklyStackBar from '@/components/notebook/WeeklyStackBar.vue'
import WeeklyTypeBars from '@/components/notebook/WeeklyTypeBars.vue'
defineProps({ week: { type: Object, required: true } })
const CHARTS = { dayBars: WeeklyDayBars, hBars: WeeklyTypeBars, bandLine: WeeklyBandLine, stackBar: WeeklyStackBar }
</script>
<style scoped>
.notebook-stats {
  display: flex;
  flex-wrap: wrap;
  row-gap: var(--anth-space-3);
}

/* One data block: numbers, a small chart, then the links. The narrative's
   prose is WeeklyDetail's; a v3 block carries no sentence of its own. */
.notebook-block + .notebook-block {
  margin-top: var(--anth-space-5);
}

.notebook-block .notebook-lead {
  margin-bottom: var(--anth-space-2);
}

.notebook-block__stats {
  margin: var(--anth-space-2) 0;
}

.notebook-block__stats .stat-value {
  font-size: var(--anth-text-lg);
}

.notebook-block__rows {
  font-size: var(--anth-text-body-size);
  line-height: var(--anth-text-body-line);
}

.notebook-block__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: var(--anth-space-2) 0 0;
}

.notebook-section h3 {
  display: flex;
  align-items: baseline;
  gap: var(--anth-space-2);
  margin: 0 0 6px;
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
}

.notebook-prose,
.notebook-notes,
.notebook-practice {
  max-width: var(--anth-measure);
  margin: 0;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  line-height: var(--anth-text-body-lg-line);
}

.notebook-notes {
  display: grid;
  gap: 4px;
  margin-top: 6px;
  padding: 0;
  list-style: none;
}

.notebook-practice {
  display: grid;
  gap: 10px;
  padding-left: 1.4em;
}

.notebook-practice strong {
  display: block;
  font-weight: var(--anth-weight-semibold);
}

.notebook-practice .notebook-practice__time {
  margin-left: 8px;
  color: var(--anth-ink-muted);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
}
</style>
