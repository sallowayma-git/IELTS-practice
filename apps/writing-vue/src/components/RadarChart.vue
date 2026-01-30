<template>
  <div class="radar-chart-container">
    <v-chart 
      ref="chartRef"
      class="chart" 
      :option="chartOption" 
      autoresize
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { RadarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
} from 'echarts/components'
import VChart from 'vue-echarts'

// Register ECharts components
use([
  CanvasRenderer,
  RadarChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
])

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

const chartRef = ref(null)

// Dimension labels based on task type
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

// Chart option
const chartOption = computed(() => {
  const currentData = dimensions.value.map(d => props.currentScores[d.key] || 0)
  const averageData = props.averageScores 
    ? dimensions.value.map(d => props.averageScores[d.key] || 0)
    : null

  const series = [{
    name: '本次作文',
    type: 'radar',
    data: [{
      value: currentData,
      name: '本次作文',
      lineStyle: {
        color: '#667eea',
        width: 2
      },
      areaStyle: {
        color: 'rgba(102, 126, 234, 0.2)'
      }
    }]
  }]

  if (averageData) {
    series.push({
      name: '历史平均',
      type: 'radar',
      data: [{
        value: averageData,
        name: '历史平均',
        lineStyle: {
          color: '#999',
          width: 2,
          type: 'dashed'
        },
        areaStyle: {
          color: 'rgba(153, 153, 153, 0.1)'
        }
      }]
    })
  }

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const data = params.data
        let result = `<strong>${data.name}</strong><br/>`
        dimensions.value.forEach((dim, index) => {
          result += `${dim.name.replace('\n', ' ')}: <strong>${data.value[index]}</strong><br/>`
        })
        return result
      }
    },
    legend: {
      data: averageData ? ['本次作文', '历史平均'] : ['本次作文'],
      bottom: 10,
      textStyle: {
        fontSize: 12
      }
    },
    radar: {
      indicator: dimensions.value.map(d => ({
        name: d.name,
        max: 9,
        min: 0
      })),
      splitNumber: 9,
      axisName: {
        color: '#666',
        fontSize: 11
      },
      splitLine: {
        lineStyle: {
          color: '#e0e0e0'
        }
      },
      splitArea: {
        show: true,
        areaStyle: {
          color: ['rgba(255, 255, 255, 0)', 'rgba(240, 240, 240, 0.3)']
        }
      }
    },
    series
  }
})

// Watch for prop changes and refresh chart
watch(() => [props.currentScores, props.averageScores, props.taskType], () => {
  if (chartRef.value) {
    chartRef.value.resize()
  }
}, { deep: true })
</script>

<style scoped>
.radar-chart-container {
  width: 100%;
  height: 100%;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chart {
  width: 100%;
  height: 400px;
}
</style>
