<template>
  <div class="line-chart-container" ref="containerRef">
    <svg
      v-if="historyData.length > 0"
      class="line-chart"
      viewBox="0 0 600 240"
      preserveAspectRatio="none"
    >
      <!-- Grid Lines -->
      <g class="chart-grid">
        <line
          v-for="y in gridLines"
          :key="'grid-' + y"
          x1="40"
          :y1="getYPos(y)"
          x2="580"
          :y2="getYPos(y)"
          class="grid-line"
        />
      </g>

      <!-- Y Axis Labels -->
      <g class="y-labels">
        <text
          v-for="y in gridLines"
          :key="'label-' + y"
          x="30"
          :y="getYPos(y)"
          class="axis-label y-axis-label"
        >
          {{ y.toFixed(1) }}
        </text>
      </g>

      <!-- Area Fill -->
      <path v-if="pathD" :d="areaD" class="chart-area" />

      <!-- Line -->
      <path v-if="pathD" :d="pathD" class="chart-line" />

      <!-- Data Points -->
      <g class="data-points">
        <circle
          v-for="(point, index) in points"
          :key="'point-' + index"
          :cx="point.x"
          :cy="point.y"
          r="4"
          class="data-point"
        >
          <title>{{ historyData[index].date }}: {{ historyData[index].score }} 分</title>
        </circle>
      </g>
    </svg>
    <div v-else class="empty-chart">
      <span>缺乏足够的数据绘制趋势图</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  historyData: {
    type: Array,
    required: true,
    // Expected format: [{ date: '10/01', score: 6.5 }, { date: '10/02', score: 7.0 }]
  }
})

const width = 600
const height = 240
const padding = { top: 20, right: 20, bottom: 30, left: 40 }
const minScore = 4.0
const maxScore = 9.0

const gridLines = [4.0, 5.0, 6.0, 7.0, 8.0, 9.0]

const getYPos = (val) => {
  const range = maxScore - minScore
  const ratio = (val - minScore) / range
  return height - padding.bottom - ratio * (height - padding.top - padding.bottom)
}

const points = computed(() => {
  if (props.historyData.length === 0) return []
  const validData = props.historyData.slice(-15) // Max 15 points
  if (validData.length === 1) {
    return [{
      x: width / 2,
      y: getYPos(validData[0].score)
    }]
  }
  
  const step = (width - padding.left - padding.right) / (validData.length - 1)
  return validData.map((d, i) => ({
    x: padding.left + i * step,
    y: getYPos(d.score)
  }))
})

// Generate Smooth curve using cubic bezier
const pathD = computed(() => {
  if (points.value.length === 0) return ''
  if (points.value.length === 1) {
    return `M ${padding.left} ${points.value[0].y} L ${width - padding.right} ${points.value[0].y}`
  }

  let d = `M ${points.value[0].x} ${points.value[0].y}`
  for (let i = 0; i < points.value.length - 1; i++) {
    const p1 = points.value[i]
    const p2 = points.value[i + 1]
    const ctrlX = (p1.x + p2.x) / 2
    d += ` C ${ctrlX} ${p1.y}, ${ctrlX} ${p2.y}, ${p2.x} ${p2.y}`
  }
  return d
})

// Gradient Area
const areaD = computed(() => {
  if (!pathD.value) return ''
  const bottomY = height - padding.bottom
  const startX = points.value[0].x
  const endX = points.value[points.value.length - 1].x
  return `${pathD.value} L ${endX} ${bottomY} L ${startX} ${bottomY} Z`
})
</script>

<style scoped>
.line-chart-container {
  width: 100%;
  height: 240px;
  background: var(--surface-0);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  overflow: hidden;
  position: relative;
}

.line-chart {
  width: 100%;
  height: 100%;
  display: block;
}

.chart-grid .grid-line {
  stroke: var(--line-1);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.y-labels .axis-label {
  fill: var(--text-muted);
  font-size: 11px;
  text-anchor: end;
  dominant-baseline: middle;
}

.chart-line {
  fill: none;
  stroke: var(--info-color);
  stroke-width: 3;
  stroke-linecap: round;
}

.chart-area {
  fill: rgba(56, 152, 236, 0.1);
}

.data-points .data-point {
  fill: var(--surface-0);
  stroke: var(--info-color);
  stroke-width: 2;
  transition: r 0.2s ease;
}

.data-points .data-point:hover {
  r: 6;
  fill: var(--info-color);
  stroke: var(--surface-0);
}

.empty-chart {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 14px;
}
</style>
