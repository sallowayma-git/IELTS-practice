<template>
  <figure class="weekly-chart">
    <svg class="weekly-chart__svg" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" :aria-label="chart.ariaLabel">
      <title>{{ chart.ariaLabel }}</title>
      <g v-for="grid in grids" :key="grid">
        <line class="weekly-chart__rule" :x1="LEFT" :x2="WIDTH" :y1="y(grid)" :y2="y(grid)" />
        <text class="weekly-chart__value" :x="LEFT - 8" :y="y(grid)" text-anchor="end" dominant-baseline="middle">{{ grid }}</text>
      </g>
      <path v-if="points.length > 1" class="weekly-chart__line" :d="path" />
      <g v-for="point in points" :key="point.key">
        <circle class="weekly-chart__dot" :cx="point.x" :cy="point.y" r="4" />
        <text class="weekly-chart__label" :x="point.x" :y="point.y - 10" text-anchor="middle">{{ point.value }}</text>
        <text class="weekly-chart__tick" :x="point.x" :y="HEIGHT - 4">{{ point.label }}</text>
      </g>
    </svg>
  </figure>
</template>

<script setup>
import { computed } from 'vue'
import './weekly-chart.css'

// Essay bands in the order they were written, on the IELTS band scale.
const props = defineProps({ chart: { type: Object, required: true } })

const WIDTH = 360
const HEIGHT = 130
const LEFT = 28
const TOP = 18
const BOTTOM = 106

const grids = computed(() => {
  const values = []
  for (let value = props.chart.min; value <= props.chart.max; value += 1) values.push(value)
  return values
})

function y(value) {
  const { min, max } = props.chart
  const clamped = Math.min(max, Math.max(min, value))
  return BOTTOM - ((clamped - min) / (max - min)) * (BOTTOM - TOP)
}

const points = computed(() => {
  const list = props.chart.points
  const span = WIDTH - LEFT - 24
  const step = list.length > 1 ? span / (list.length - 1) : 0
  return list.map((point, index) => ({
    ...point,
    x: list.length > 1 ? LEFT + 12 + index * step : LEFT + span / 2,
    y: y(point.value)
  }))
})

const path = computed(() => points.value.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '))
</script>

