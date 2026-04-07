<template>
  <div class="radar-chart-container">
    <svg
      class="chart"
      viewBox="0 0 320 320"
      role="img"
      :aria-label="chartLabel"
    >
      <g class="radar-grid">
        <polygon
          v-for="level in gridLevels"
          :key="`grid-${level}`"
          class="radar-grid-level"
          :points="gridPolygons[level - 1]"
        />
        <line
          v-for="axis in axisLines"
          :key="axis.key"
          class="radar-axis-line"
          :x1="center"
          :y1="center"
          :x2="axis.x"
          :y2="axis.y"
        />
      </g>

      <g class="radar-series">
        <polygon
          v-if="averagePolygon"
          class="radar-series-polygon average"
          :points="averagePolygon"
        />
        <polygon
          class="radar-series-polygon current"
          :points="currentPolygon"
        />

        <circle
          v-for="point in currentPoints"
          :key="`current-point-${point.key}`"
          class="radar-point current"
          :cx="point.x"
          :cy="point.y"
          r="4"
        />
        <circle
          v-for="point in averagePoints"
          :key="`average-point-${point.key}`"
          class="radar-point average"
          :cx="point.x"
          :cy="point.y"
          r="3"
        />
      </g>

      <g class="radar-labels">
        <text
          v-for="label in labelPositions"
          :key="label.key"
          class="radar-label"
          :x="label.x"
          :y="label.y"
          :text-anchor="label.textAnchor"
          :dominant-baseline="label.baseline"
        >
          <tspan
            v-for="(line, index) in label.lines"
            :key="`${label.key}-${index}`"
            :x="label.x"
            :dy="index === 0 ? 0 : 14"
          >
            {{ line }}
          </tspan>
        </text>
      </g>
    </svg>

    <div class="chart-legend">
      <span class="legend-item">
        <span class="legend-swatch current"></span>
        本次作文
      </span>
      <span v-if="averagePolygon" class="legend-item">
        <span class="legend-swatch average"></span>
        历史平均
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  RADAR_MAX_SCORE,
  buildRadarPoint,
  buildRadarPolygon,
  formatRadarPoints
} from '@/utils/radar-chart.js'

const props = defineProps({
  currentScores: {
    type: Object,
    required: true,
    // Expected: { tr_ta: 7.0, cc: 6.5, lr: 7.5, gra: 6.0 }
  },
  averageScores: {
    type: Object,
    default: null,
    // Expected: { tr_ta: 6.8, cc: 6.2, lr: 7.0, gra: 6.5 } or null
  },
  taskType: {
    type: String,
    default: 'task2', // task1 or task2
    validator: (value) => ['task1', 'task2'].includes(value)
  }
})

const chartSize = 320
const center = chartSize / 2
const outerRadius = 104
const labelRadius = 136
const gridLevels = [1, 2, 3, 4, 5]

const dimensions = computed(() => {
  if (props.taskType === 'task1') {
    return [
      { name: 'TR\nTask Achievement', key: 'tr_ta' },
      { name: 'CC\nCoherence & Cohesion', key: 'cc' },
      { name: 'LR\nLexical Resource', key: 'lr' },
      { name: 'GRA\nGrammatical Range', key: 'gra' }
    ]
  } else {
    return [
      { name: 'TA\nTask Response', key: 'tr_ta' },
      { name: 'CC\nCoherence & Cohesion', key: 'cc' },
      { name: 'LR\nLexical Resource', key: 'lr' },
      { name: 'GRA\nGrammatical Range', key: 'gra' }
    ]
  }
})

const currentValues = computed(() => dimensions.value.map(d => props.currentScores?.[d.key] || 0))
const averageValues = computed(() => {
  if (!props.averageScores) return null
  return dimensions.value.map(d => props.averageScores?.[d.key] || 0)
})

const currentPoints = computed(() => (
  buildRadarPolygon({
    values: currentValues.value,
    centerX: center,
    centerY: center,
    radius: outerRadius,
    maxScore: RADAR_MAX_SCORE
  }).map((point, index) => ({
    ...point,
    key: dimensions.value[index].key
  }))
))

const averagePoints = computed(() => {
  if (!averageValues.value) return []
  return buildRadarPolygon({
    values: averageValues.value,
    centerX: center,
    centerY: center,
    radius: outerRadius,
    maxScore: RADAR_MAX_SCORE
  }).map((point, index) => ({
    ...point,
    key: dimensions.value[index].key
  }))
})

const currentPolygon = computed(() => formatRadarPoints(currentPoints.value))
const averagePolygon = computed(() => (
  averagePoints.value.length > 0 ? formatRadarPoints(averagePoints.value) : ''
))

const gridPolygons = computed(() => (
  gridLevels.map((level) => (
    formatRadarPoints(
      buildRadarPolygon({
        values: dimensions.value.map(() => (RADAR_MAX_SCORE / gridLevels.length) * level),
        centerX: center,
        centerY: center,
        radius: outerRadius,
        maxScore: RADAR_MAX_SCORE
      })
    )
  ))
))

const axisLines = computed(() => (
  dimensions.value.map((dimension, index) => {
    const point = buildRadarPoint({
      index,
      totalDimensions: dimensions.value.length,
      value: RADAR_MAX_SCORE,
      centerX: center,
      centerY: center,
      radius: outerRadius
    })
    return {
      key: dimension.key,
      x: point.x,
      y: point.y
    }
  })
))

const labelPositions = computed(() => (
  dimensions.value.map((dimension, index) => {
    const point = buildRadarPoint({
      index,
      totalDimensions: dimensions.value.length,
      value: RADAR_MAX_SCORE,
      centerX: center,
      centerY: center,
      radius: labelRadius
    })
    const horizontalBias = point.x - center
    const verticalBias = point.y - center
    return {
      key: dimension.key,
      x: point.x,
      y: point.y,
      lines: String(dimension.name).split('\n'),
      textAnchor: horizontalBias > 18 ? 'start' : horizontalBias < -18 ? 'end' : 'middle',
      baseline: verticalBias > 18 ? 'hanging' : verticalBias < -18 ? 'auto' : 'middle'
    }
  })
))

const chartLabel = computed(() => {
  const summary = dimensions.value.map((dimension) => (
    `${dimension.key}:${props.currentScores?.[dimension.key] || 0}`
  )).join(', ')
  return `历史评分雷达图，当前分数 ${summary}`
})
</script>

<style scoped>
.radar-chart-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.chart {
  width: 100%;
  max-width: 420px;
  height: auto;
  overflow: visible;
}

.radar-grid-level {
  fill: rgba(240, 240, 240, 0.28);
  stroke: #d7dce5;
  stroke-width: 1;
}

.radar-axis-line {
  stroke: #d7dce5;
  stroke-width: 1;
}

.radar-series-polygon {
  stroke-width: 2.5;
  stroke-linejoin: round;
}

.radar-series-polygon.current {
  fill: rgba(58, 122, 254, 0.20);
  stroke: #3a7afe;
}

.radar-series-polygon.average {
  fill: rgba(128, 135, 148, 0.08);
  stroke: #808794;
  stroke-dasharray: 6 4;
}

.radar-point {
  stroke: #ffffff;
  stroke-width: 1.5;
}

.radar-point.current {
  fill: #3a7afe;
}

.radar-point.average {
  fill: #808794;
}

.radar-label {
  fill: #586275;
  font-size: 11px;
  font-weight: 600;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 18px;
  color: var(--text-secondary);
  font-size: 13px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.legend-swatch {
  width: 18px;
  height: 10px;
  border-radius: 999px;
}

.legend-swatch.current {
  background: rgba(58, 122, 254, 0.9);
}

.legend-swatch.average {
  background: linear-gradient(90deg, #808794 60%, rgba(128, 135, 148, 0.18) 60%);
}

@media (max-width: 640px) {
  .radar-label {
    font-size: 10px;
  }

  .chart-legend {
    font-size: 12px;
  }
}
</style>
