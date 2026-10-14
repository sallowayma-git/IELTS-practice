<template>
  <figure class="weekly-chart">
    <svg class="weekly-chart__svg" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" :aria-label="chart.ariaLabel">
      <title>{{ chart.ariaLabel }}</title>
      <rect
        v-for="bar in bars"
        :key="bar.label"
        :class="`weekly-chart__bar is-${bar.tone}`"
        :x="bar.x"
        y="0"
        :width="bar.width"
        :height="HEIGHT"
      />
    </svg>
    <figcaption class="weekly-chart__legend" aria-hidden="true">
      <span v-for="bar in chart.segments" :key="bar.label" :class="`is-${bar.tone}`">{{ bar.label }}</span>
    </figcaption>
  </figure>
</template>

<script setup>
import { computed } from 'vue'
import './weekly-chart.css'

// One bar split by outcome, each part as wide as its share of the questions.
const props = defineProps({ chart: { type: Object, required: true } })

const WIDTH = 360
const HEIGHT = 12

const bars = computed(() => {
  let x = 0
  return props.chart.segments.filter((segment) => segment.value > 0).map((segment) => {
    const width = (segment.value / props.chart.total) * WIDTH
    const bar = { ...segment, x, width }
    x += width
    return bar
  })
})
</script>

