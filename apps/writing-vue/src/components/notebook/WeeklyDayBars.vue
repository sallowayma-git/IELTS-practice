<template>
  <figure class="weekly-chart">
    <svg class="weekly-chart__svg" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" :aria-label="chart.ariaLabel">
      <title>{{ chart.ariaLabel }}</title>
      <line class="weekly-chart__rule" :x1="0" :x2="WIDTH" :y1="TOP" :y2="TOP" />
      <line class="weekly-chart__base" :x1="0" :x2="WIDTH" :y1="BASE" :y2="BASE" />
      <g v-for="(day, index) in chart.days" :key="day.day">
        <rect
          v-for="bar in stack(day)"
          :key="bar.tone"
          :class="`weekly-chart__bar is-${bar.tone}`"
          :x="index * slot + (slot - bar.width) / 2"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
        />
        <text
          v-if="index % tickEvery === 0"
          class="weekly-chart__tick"
          :class="{ 'is-gap': day.gap }"
          :x="index * slot + slot / 2"
          :y="HEIGHT - 4"
        >{{ tickEvery > 1 ? day.tick.short : day.tick.weekday || day.tick.short }}</text>
      </g>
    </svg>
    <figcaption v-if="chart.legend.length" class="weekly-chart__legend" aria-hidden="true">
      <span v-for="item in chart.legend" :key="item.label" :class="`is-${item.tone}`">{{ item.label }}</span>
    </figcaption>
  </figure>
</template>

<script setup>
import { computed } from 'vue'
import './weekly-chart.css'

// One bar slot per day; a day with no data (gap) draws no bar, only its tick.
// The drawing keeps one width (a week's slots at least), so a short live week
// does not blow its bars up and a folded multi-week window thins its ticks.
const props = defineProps({ chart: { type: Object, required: true } })

const WIDTH = 360
const TOP = 6
const BASE = 74
const HEIGHT = 94
const MIN_TICK = 34
const TONES = ['ink', 'accent']

const slot = computed(() => WIDTH / Math.max(7, props.chart.days.length))
const tickEvery = computed(() => Math.max(1, Math.ceil(MIN_TICK / slot.value)))

function stack(day) {
  let y = BASE
  const width = Math.min(22, slot.value * 0.5)
  return day.values.map((value, index) => {
    const height = (Math.max(0, value) / props.chart.max) * (BASE - TOP)
    y -= height
    return { tone: TONES[index] || 'ink', y, height, width }
  }).filter((bar) => bar.height > 0)
}
</script>

