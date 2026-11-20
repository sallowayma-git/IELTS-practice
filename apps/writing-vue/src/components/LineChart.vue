<template>
  <div :class="['line-chart-container', { 'is-compact': compact }]" ref="containerRef">
    <svg
      v-if="historyData.length > 0"
      class="line-chart"
      viewBox="0 0 600 240"
      @mouseleave="hoverIndex = null"
    >
      <!-- Grid Lines -->
      <g class="chart-grid">
        <line
          v-for="y in gridLineValues"
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
          v-for="y in gridLineValues"
          :key="'label-' + y"
          x="30"
          :y="getYPos(y)"
          class="axis-label y-axis-label"
        >
          {{ formatAxisLabel(y) }}
        </text>
      </g>

      <!-- Area under the line (kept for geometry; drawn without fill) -->
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
          r="3"
          class="data-point"
          :class="{ 'is-active': hoverIndex === index }"
          @mouseenter="hoverIndex = index"
        >
          <title>{{ visibleHistoryData[index].date }}: {{ formatPointValue(visibleHistoryData[index].score) }}</title>
        </circle>
        <!-- Wider invisible hit targets: r=3 is hard to aim at. -->
        <circle
          v-for="(point, index) in points"
          :key="'hit-' + index"
          :cx="point.x"
          :cy="point.y"
          r="12"
          class="data-point-hit"
          @mouseenter="hoverIndex = index"
        />
      </g>
    </svg>
    <!-- Hover score tip: positioned by viewBox ratio, so it tracks the point. -->
    <div
      v-if="hoverIndex !== null && points[hoverIndex]"
      class="chart-tip"
      :style="tipStyle"
      role="status"
    >
      <span class="chart-tip__date">{{ visibleHistoryData[hoverIndex].date }}</span>
      <span class="chart-tip__value">{{ formatPointValue(visibleHistoryData[hoverIndex].score) }}</span>
    </div>
    <div v-if="historyData.length === 0" class="empty-chart">
      <span>缺乏足够的数据绘制趋势图</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const containerRef = ref(null)
const hoverIndex = ref(null)

const props = defineProps({
  historyData: {
    type: Array,
    required: true,
    // Expected format: [{ date: '10/01', score: 6.5 }, { date: '10/02', score: 7.0 }]
  },
  minScore: {
    type: Number,
    default: 4.0
  },
  maxScore: {
    type: Number,
    default: 9.0
  },
  gridLines: {
    type: Array,
    default: null
  },
  scoreSuffix: {
    type: String,
    default: ' 分'
  },
  scorePrefix: {
    type: String,
    default: ''
  },
  axisLabelDecimals: {
    type: Number,
    default: 1
  },
  // Dashboard card: no baseline rule, no reserved bottom gutter.
  compact: {
    type: Boolean,
    default: false
  }
})

// Data swaps (dashboard series toggle) must not leave a stale hoverIndex
// pointing at a series the pointer is not over.
watch(() => props.historyData, () => { hoverIndex.value = null })

const width = 600
const height = 240
const padding = { top: 20, right: 20, bottom: 30, left: 40 }
const bottomPadding = computed(() => (props.compact ? 10 : padding.bottom))
const minScore = computed(() => Number.isFinite(props.minScore) ? props.minScore : 4.0)
const maxScore = computed(() => Number.isFinite(props.maxScore) && props.maxScore > minScore.value ? props.maxScore : 9.0)

const gridLineValues = computed(() => {
  if (Array.isArray(props.gridLines) && props.gridLines.length) {
    return props.gridLines
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
  }
  return [4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
})

const getYPos = (val) => {
  const range = maxScore.value - minScore.value
  const clamped = Math.max(minScore.value, Math.min(maxScore.value, Number(val) || minScore.value))
  const ratio = (clamped - minScore.value) / range
  return height - bottomPadding.value - ratio * (height - padding.top - bottomPadding.value)
}

const formatAxisLabel = (value) => Number(value || 0).toFixed(Math.max(0, Number(props.axisLabelDecimals || 0)))

const formatPointValue = (value) => `${props.scorePrefix}${Number(value || 0).toFixed(Math.max(0, Number(props.axisLabelDecimals || 0)))}${props.scoreSuffix}`

const visibleHistoryData = computed(() => props.historyData.slice(-15))

// SVG has no layout engine, so the tip anchors by percentage of the container
// (viewBox units / 600x240) with a fixed pixel offset for the stem. The tip
// pops above the point; when the point sits in the top band (high score) the
// tip would cross the container top, so it flips below. The band is measured
// from the real container height — no viewport-dependent magic numbers.
const TIP_STEM_PX = 12
const TIP_HEIGHT_PX = 34

const tipStyle = computed(() => {
  const point = points.value[hoverIndex.value]
  if (!point) return {}
  const leftPct = (point.x / width) * 100
  const topPct = (point.y / height) * 100
  const containerH = containerRef.value?.getBoundingClientRect().height || 0
  const aboveBandPct = containerH > 0 ? ((TIP_STEM_PX + TIP_HEIGHT_PX) / containerH) * 100 : 20
  const below = topPct < aboveBandPct
  const flip = leftPct > 72
  return {
    left: `${leftPct}%`,
    top: `calc(${topPct}% - ${TIP_STEM_PX}px)`,
    transform: flip
      ? `translate(calc(-100% - 10px), ${below ? `${TIP_STEM_PX + 6}px` : '-100%'})`
      : `translate(10px, ${below ? `${TIP_STEM_PX + 6}px` : '-100%'})`
  }
})

const points = computed(() => {
  if (visibleHistoryData.value.length === 0) return []
  if (visibleHistoryData.value.length === 1) {
    return [{
      x: width / 2,
      y: getYPos(visibleHistoryData.value[0].score)
    }]
  }
  
  const step = (width - padding.left - padding.right) / (visibleHistoryData.value.length - 1)
  return visibleHistoryData.value.map((d, i) => ({
    x: padding.left + i * step,
    y: getYPos(d.score)
  }))
})

// Straight segments: scores are discrete, a spline would overshoot between them.
const pathD = computed(() => {
  if (points.value.length === 0) return ''
  if (points.value.length === 1) {
    return `M ${padding.left} ${points.value[0].y} L ${width - padding.right} ${points.value[0].y}`
  }
  return points.value.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
})

// Area outline under the line
const areaD = computed(() => {
  if (!pathD.value) return ''
  const bottomY = height - bottomPadding.value
  if (points.value.length === 1) {
    return `${pathD.value} L ${width - padding.right} ${bottomY} L ${padding.left} ${bottomY} Z`
  }
  const startX = points.value[0].x
  const endX = points.value[points.value.length - 1].x
  return `${pathD.value} L ${endX} ${bottomY} L ${startX} ${bottomY} Z`
})
</script>

<style scoped>
/* Thin ink line on paper; hairline grid; no area wash. */
.line-chart-container {
  position: relative;
  width: 100%;
  aspect-ratio: 600 / 240; /* the viewBox: text is never stretched */
  overflow: hidden;
  border-bottom: 1px solid var(--anth-ink);
}

.line-chart-container.is-compact {
  border-bottom: 0;
}

.line-chart {
  display: block;
  width: 100%;
  height: 100%;
}

.chart-grid .grid-line {
  stroke: var(--anth-rule);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.y-labels .axis-label {
  fill: var(--anth-ink-faint);
  font-size: 11px;
  font-variant-numeric: lining-nums tabular-nums;
  text-anchor: end;
  dominant-baseline: middle;
}

.chart-line {
  fill: none;
  stroke: var(--anth-ink);
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.chart-area {
  fill: none;
  stroke: none;
}

.data-points .data-point {
  fill: var(--anth-canvas);
  stroke: var(--anth-ink);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.data-points .data-point:hover,
.data-points .data-point.is-active {
  fill: var(--anth-accent);
  stroke: var(--anth-accent);
}

/* Invisible aiming halo over each point; keeps the visible r=3 dot. */
.data-points .data-point-hit {
  fill: transparent;
  stroke: none;
  pointer-events: all;
}

.chart-tip {
  position: absolute;
  z-index: 5;
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 5px 10px;
  border: 1px solid var(--anth-ink);
  border-radius: var(--anth-radius-xs, 3px);
  background: var(--anth-surface-raised, #fff);
  box-shadow: var(--anth-shadow-1, 0 1px 4px rgba(0, 0, 0, 0.14));
  pointer-events: none;
  white-space: nowrap;
}

.chart-tip__date {
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-xs, 11px);
}

.chart-tip__value {
  color: var(--anth-ink);
  font-size: var(--anth-text-sm, 13px);
  font-weight: var(--anth-weight-medium);
  font-variant-numeric: lining-nums tabular-nums;
}

.empty-chart {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-sm);
}
</style>
