<template>
  <div class="score-analysis-panel">
    <el-card>
      <template #header>
        <div class="panel-header">
          <span class="panel-title">
            <el-icon><TrendCharts /></el-icon>
            评分趋势分析
          </span>
          <div class="panel-controls">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              size="small"
              @change="loadAnalysisData"
            />
            <el-button
              size="small"
              @click="refreshData"
              :loading="loading"
            >
              刷新
            </el-button>
          </div>
        </div>
      </template>

      <!-- 趋势统计 -->
      <div class="trend-stats" v-if="trendData">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-statistic title="总练习次数" :value="trendData.totalAttempts" />
          </el-col>
          <el-col :span="6">
            <el-statistic title="平均总分" :value="trendData.averageScore" :precision="1" />
          </el-col>
          <el-col :span="6">
            <el-statistic
              title="最高分"
              :value="trendData.highestScore"
              :precision="1"
              value-style="color: #67c23a"
            />
          </el-col>
          <el-col :span="6">
            <el-statistic
              title="进步幅度"
              :value="trendData.improvement"
              :precision="1"
              :value-style="{ color: trendData.improvement >= 0 ? '#67c23a' : '#f56c6c' }"
            >
              <template #suffix>分</template>
            </el-statistic>
          </el-col>
        </el-row>
      </div>

      <!-- 评分趋势图 -->
      <div class="trend-chart" v-if="trendData">
        <h4>评分趋势图</h4>
        <div ref="trendChartRef" class="chart-container"></div>
      </div>

      <!-- 评分对比选择 -->
      <div class="comparison-section">
        <h4>评分对比</h4>
        <div class="comparison-selector">
          <el-select
            v-model="selectedComparisons"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="选择要对比的评分记录"
            style="width: 100%"
            @change="updateComparison"
          >
            <el-option
              v-for="record in assessmentHistory"
              :key="record.id"
              :label="`${record.date} - ${record.topicTitle} (${record.overallScore}分)`"
              :value="record.id"
            />
          </el-select>
        </div>
      </div>

      <!-- 雷达图对比 -->
      <div class="radar-chart" v-if="comparisonData.length > 0">
        <h4>评分对比雷达图</h4>
        <div ref="radarChartRef" class="chart-container"></div>
      </div>

      <!-- 详细对比表格 -->
      <div class="comparison-table" v-if="comparisonData.length > 0">
        <h4>详细评分对比</h4>
        <el-table :data="comparisonTableData" border>
          <el-table-column prop="criteria" label="评分维度" width="120" />
          <el-table-column
            v-for="record in comparisonData"
            :key="record.id"
            :label="record.date"
            width="100"
          >
            <template #default="scope">
              <span :style="getScoreStyle(scope.row[record.id])">
                {{ scope.row[record.id] }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="average" label="平均值" width="100">
            <template #default="scope">
              <strong>{{ scope.row.average }}</strong>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 空状态 -->
      <el-empty
        v-else-if="!loading && assessmentHistory.length === 0"
        description="暂无评分数据"
        :image-size="100"
      >
        <template #image>
          <el-icon size="100" color="#c0c4cc"><TrendCharts /></el-icon>
        </template>
        <el-button type="primary" @click="$router.push('/writing')">
          开始写作练习
        </el-button>
      </el-empty>

      <!-- 加载状态 -->
      <div v-else-if="loading" class="loading-state">
        <el-skeleton :rows="4" animated />
        <p style="text-align: center; margin-top: 16px; color: #909399;">
          正在加载分析数据...
        </p>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { TrendCharts } from '@element-plus/icons-vue'
import * as echarts from 'echarts'

const props = defineProps({
  userId: {
    type: String,
    default: 'default_user'
  }
})

const emit = defineEmits(['record-selected'])

// 状态
const loading = ref(false)
const dateRange = ref([])
const assessmentHistory = ref([])
const selectedComparisons = ref([])
const trendData = ref(null)
const comparisonData = ref([])

// 图表引用
const trendChartRef = ref()
const radarChartRef = ref()
let trendChart = null
let radarChart = null

// 计算属性
const comparisonTableData = computed(() => {
  if (comparisonData.value.length === 0) return []

  const criteria = ['任务回应', '连贯与衔接', '词汇资源', '语法准确性']

  return criteria.map(criteriaName => {
    const row = { criteria: criteriaName }
    let sum = 0
    let count = 0

    comparisonData.value.forEach(record => {
      const score = getCriteriaScore(record, criteriaName)
      row[record.id] = score
      sum += score
      count += 1
    })

    row.average = count > 0 ? (sum / count).toFixed(1) : '-'
    return row
  })
})

// 方法
const loadAnalysisData = async () => {
  loading.value = true

  try {
    // 加载历史评分数据
    const response = await fetch('/api/analysis/score-trends', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: props.userId,
        dateRange: dateRange.value
      })
    })

    if (!response.ok) {
      throw new Error('获取分析数据失败')
    }

    const data = await response.json()

    if (data.success) {
      assessmentHistory.value = data.data.history
      trendData.value = data.data.trends

      // 自动选择最近的几次评分进行对比
      if (assessmentHistory.value.length > 1) {
        selectedComparisons.value = assessmentHistory.value
          .slice(-3)
          .map(record => record.id)
        updateComparison()
      }

      await nextTick()
      renderTrendChart()
    }
  } catch (error) {
    console.error('加载分析数据失败:', error)
    ElMessage.error('加载分析数据失败')
  } finally {
    loading.value = false
  }
}

const refreshData = () => {
  loadAnalysisData()
}

const updateComparison = () => {
  comparisonData.value = assessmentHistory.value.filter(record =>
    selectedComparisons.value.includes(record.id)
  )

  nextTick(() => {
    renderRadarChart()
  })
}

const renderTrendChart = () => {
  if (!trendChartRef.value || !trendData.value) return

  if (trendChart) {
    trendChart.dispose()
  }

  trendChart = echarts.init(trendChartRef.value)

  const option = {
    title: {
      text: '评分趋势',
      left: 'center',
      textStyle: {
        fontSize: 16
      }
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        let result = params[0].axisValue + '<br/>'
        params.forEach(param => {
          result += `${param.seriesName}: ${param.value}分<br/>`
        })
        return result
      }
    },
    legend: {
      data: ['总分', '任务回应', '连贯与衔接', '词汇资源', '语法准确性'],
      bottom: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: trendData.value.dates,
      axisLabel: {
        rotate: 45
      }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 9,
      interval: 1
    },
    series: [
      {
        name: '总分',
        type: 'line',
        data: trendData.value.overallScores,
        itemStyle: { color: '#409eff' },
        lineStyle: { width: 3 }
      },
      {
        name: '任务回应',
        type: 'line',
        data: trendData.value.taskResponseScores,
        itemStyle: { color: '#67c23a' }
      },
      {
        name: '连贯与衔接',
        type: 'line',
        data: trendData.value.coherenceScores,
        itemStyle: { color: '#e6a23c' }
      },
      {
        name: '词汇资源',
        type: 'line',
        data: trendData.value.vocabularyScores,
        itemStyle: { color: '#f56c6c' }
      },
      {
        name: '语法准确性',
        type: 'line',
        data: trendData.value.grammarScores,
        itemStyle: { color: '#909399' }
      }
    ]
  }

  trendChart.setOption(option)
}

const renderRadarChart = () => {
  if (!radarChartRef.value || comparisonData.value.length === 0) return

  if (radarChart) {
    radarChart.dispose()
  }

  radarChart = echarts.init(radarChartRef.value)

  const indicators = [
    { name: '任务回应', max: 9 },
    { name: '连贯与衔接', max: 9 },
    { name: '词汇资源', max: 9 },
    { name: '语法准确性', max: 9 }
  ]

  const series = comparisonData.value.map((record, index) => {
    const colors = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399']

    return {
      name: record.date,
      type: 'radar',
      data: [
        {
          value: [
            record.task_response_score,
            record.coherence_score,
            record.vocabulary_score,
            record.grammar_score
          ],
          name: record.topicTitle,
          itemStyle: { color: colors[index % colors.length] }
        }
      ]
    }
  })

  const option = {
    title: {
      text: '评分对比雷达图',
      left: 'center',
      textStyle: {
        fontSize: 16
      }
    },
    tooltip: {
      trigger: 'item'
    },
    legend: {
      data: comparisonData.value.map(record => record.date),
      bottom: 0
    },
    radar: {
      indicator: indicators,
      center: ['50%', '55%'],
      radius: '65%'
    },
    series: series
  }

  radarChart.setOption(option)
}

const getCriteriaScore = (record, criteriaName) => {
  const criteriaMap = {
    '任务回应': record.task_response_score,
    '连贯与衔接': record.coherence_score,
    '词汇资源': record.vocabulary_score,
    '语法准确性': record.grammar_score
  }

  return criteriaMap[criteriaName] || 0
}

const getScoreStyle = (score) => {
  if (score >= 7) return { color: '#67c23a', fontWeight: 'bold' }
  if (score >= 6) return { color: '#e6a23c' }
  return { color: '#f56c6c' }
}

// 窗口大小变化时重新渲染图表
const handleResize = () => {
  if (trendChart) trendChart.resize()
  if (radarChart) radarChart.resize()
}

// 生命周期
onMounted(() => {
  // 设置默认日期范围为最近30天
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)
  dateRange.value = [start, end]

  loadAnalysisData()

  window.addEventListener('resize', handleResize)
})

// 清理
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (trendChart) trendChart.dispose()
  if (radarChart) radarChart.dispose()
})
</script>

<style scoped>
.score-analysis-panel {
  height: 100%;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: bold;
  font-size: 16px;
}

.panel-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.trend-stats {
  margin-bottom: 24px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.trend-chart,
.radar-chart {
  margin-bottom: 24px;
}

.comparison-section {
  margin-bottom: 24px;
}

.comparison-selector {
  margin-top: 12px;
}

.chart-container {
  width: 100%;
  height: 400px;
  margin-top: 16px;
}

.comparison-table {
  margin-top: 24px;
}

.comparison-table h4 {
  margin-bottom: 16px;
  color: #303133;
}

.loading-state {
  padding: 20px;
}

h4 {
  color: #303133;
  margin: 0 0 16px 0;
  font-weight: 500;
}
</style>