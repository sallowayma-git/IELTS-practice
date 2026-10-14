<template>
  <figure class="weekly-chart">
    <svg class="weekly-chart__svg" :viewBox="`0 0 ${WIDTH} ${height}`" role="img" :aria-label="chart.ariaLabel">
      <title>{{ chart.ariaLabel }}</title>
      <g v-for="(row, index) in chart.rows" :key="row.key" :transform="`translate(0 ${index * ROW})`">
        <text class="weekly-chart__label" x="0" :y="ROW / 2" dominant-baseline="middle">{{ row.label }}</text>
        <rect class="weekly-chart__bar is-track" :x="LABEL" :y="(ROW - BAR) / 2" :width="scale(row.total)" :height="BAR" />
        <rect class="weekly-chart__bar is-accent" :x="LABEL" :y="(ROW - BAR) / 2" :width="scale(row.part)" :height="BAR" />
        <text class="weekly-chart__value" :x="WIDTH" :y="ROW / 2" text-anchor="end" dominant-baseline="middle">{{ row.text }}</text>
      </g>
    </svg>
    <figcaption class="weekly-chart__legend" aria-hidden="true">
      <span class="is-accent">错题</span>
      <span class="is-track">做过的题</span>
    </figcaption>
  </figure>
</template>

<script setup>
import { computed } from 'vue'
import './weekly-chart.css'

// Each row: the type's answered questions as a pale track, its misses in accent.
const props = defineProps({ chart: { type: Object, required: true } })

const WIDTH = 360
const LABEL = 100
const VALUE = 72
const ROW = 26
const BAR = 10

const height = computed(() => Math.max(1, props.chart.rows.length) * ROW)

function scale(value) {
  return (Math.max(0, value) / props.chart.max) * (WIDTH - LABEL - VALUE)
}
</script>

