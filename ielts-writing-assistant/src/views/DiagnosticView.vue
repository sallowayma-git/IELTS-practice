<template>
  <div class="diagnostic-view">
    <el-tabs v-model="activeTab" type="border-card" @tab-click="handleTabClick">
      <el-tab-pane label="系统诊断" name="diagnostic">
        <SystemDiagnostic />
      </el-tab-pane>
      <el-tab-pane label="日志查看" name="logs">
        <LogViewer />
      </el-tab-pane>
      <el-tab-pane label="性能监控" name="performance">
        <div class="performance-monitor">
          <el-container>
            <el-header class="monitor-header">
              <h2>实时性能监控</h2>
              <div class="monitor-controls">
                <el-button @click="toggleMonitoring" :type="monitoring ? 'danger' : 'primary'">
                  {{ monitoring ? '停止监控' : '开始监控' }}
                </el-button>
                <el-button @click="clearCharts" :icon="Delete">清空图表</el-button>
              </div>
            </el-header>

            <el-main class="monitor-main">
              <!-- 实时性能图表 -->
              <el-row :gutter="20">
                <el-col :span="12">
                  <el-card class="chart-card">
                    <template #header>
                      <span>CPU使用率</span>
                    </template>
                    <div ref="cpuChart" class="chart-container"></div>
                  </el-card>
                </el-col>
                <el-col :span="12">
                  <el-card class="chart-card">
                    <template #header>
                      <span>内存使用率</span>
                    </template>
                    <div ref="memoryChart" class="chart-container"></div>
                  </el-card>
                </el-col>
              </el-row>

              <el-row :gutter="20" style="margin-top: 20px;">
                <el-col :span="12">
                  <el-card class="chart-card">
                    <template #header>
                      <span>网络延迟</span>
                    </template>
                    <div ref="networkChart" class="chart-container"></div>
                  </el-card>
                </el-col>
                <el-col :span="12">
                  <el-card class="chart-card">
                    <template #header>
                      <span>响应时间</span>
                    </template>
                    <div ref="responseChart" class="chart-container"></div>
                  </el-card>
                </el-col>
              </el-row>

              <!-- 性能统计 -->
              <el-card class="stats-card" style="margin-top: 20px;">
                <template #header>
                  <span>性能统计</span>
                </template>
                <el-row :gutter="20">
                  <el-col :span="6">
                    <el-statistic title="平均CPU" :value="performanceStats.avgCpu" suffix="%" />
                  </el-col>
                  <el-col :span="6">
                    <el-statistic title="平均内存" :value="performanceStats.avgMemory" suffix="%" />
                  </el-col>
                  <el-col :span="6">
                    <el-statistic title="平均延迟" :value="performanceStats.avgLatency" suffix="ms" />
                  </el-col>
                  <el-col :span="6">
                    <el-statistic title="监控时长" :value="performanceStats.monitorTime" suffix="分钟" />
                  </el-col>
                </el-row>
              </el-card>
            </el-main>
          </el-container>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import SystemDiagnostic from '@/components/SystemDiagnostic.vue'
import LogViewer from '@/components/LogViewer.vue'
import * as echarts from 'echarts'

// 状态管理
const activeTab = ref('diagnostic')
const monitoring = ref(false)
const monitorTimer = ref(null)

// 图表引用
const cpuChart = ref()
const memoryChart = ref()
const networkChart = ref()
const responseChart = ref()

// 图表实例
let cpuChartInstance = null
let memoryChartInstance = null
let networkChartInstance = null
let responseChartInstance = null

// 性能数据
const performanceData = ref({
  cpu: [],
  memory: [],
  network: [],
  response: [],
  timestamps: []
})

const performanceStats = ref({
  avgCpu: 0,
  avgMemory: 0,
  avgLatency: 0,
  monitorTime: 0
})

// 生命周期
onMounted(() => {
  if (activeTab.value === 'performance') {
    initCharts()
  }
})

onUnmounted(() => {
  stopMonitoring()
  disposeCharts()
})

// 方法
const handleTabClick = (tab) => {
  if (tab.name === 'performance') {
    nextTick(() => {
      initCharts()
    })
  } else {
    stopMonitoring()
  }
}

const initCharts = () => {
  if (!cpuChart.value || !memoryChart.value || !networkChart.value || !responseChart.value) {
    return
  }

  // 初始化CPU图表
  cpuChartInstance = echarts.init(cpuChart.value)
  cpuChartInstance.setOption(getChartOption('CPU使用率', '%', '#409EFF'))

  // 初始化内存图表
  memoryChartInstance = echarts.init(memoryChart.value)
  memoryChartInstance.setOption(getChartOption('内存使用率', '%', '#67C23A'))

  // 初始化网络图表
  networkChartInstance = echarts.init(networkChart.value)
  networkChartInstance.setOption(getChartOption('网络延迟', 'ms', '#E6A23C'))

  // 初始化响应时间图表
  responseChartInstance = echarts.init(responseChart.value)
  responseChartInstance.setOption(getChartOption('响应时间', 'ms', '#F56C6C'))
}

const getChartOption = (title, unit, color) => {
  return {
    title: {
      text: title,
      left: 'center',
      textStyle: {
        fontSize: 14,
        color: '#303133'
      }
    },
    tooltip: {
      trigger: 'axis',
      formatter: function (params) {
        return `${params[0].name}<br/>${params[0].value}${unit}`
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: [],
      axisLabel: {
        fontSize: 10
      }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        fontSize: 10,
        formatter: `{value}${unit}`
      }
    },
    series: [{
      type: 'line',
      smooth: true,
      lineStyle: {
        color: color,
        width: 2
      },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color + '40' },
          { offset: 1, color: color + '10' }
        ])
      },
      data: []
    }]
  }
}

const toggleMonitoring = () => {
  if (monitoring.value) {
    stopMonitoring()
  } else {
    startMonitoring()
  }
}

const startMonitoring = () => {
  monitoring.value = true
  ElMessage.success('开始性能监控')

  // 清空历史数据
  performanceData.value = {
    cpu: [],
    memory: [],
    network: [],
    response: [],
    timestamps: []
  }

  // 每2秒采集一次数据
  monitorTimer.value = setInterval(() => {
    collectPerformanceData()
    updateCharts()
    updateStats()
  }, 2000)
}

const stopMonitoring = () => {
  if (monitorTimer.value) {
    clearInterval(monitorTimer.value)
    monitorTimer.value = null
  }
  monitoring.value = false
  ElMessage.info('已停止性能监控')
}

const collectPerformanceData = () => {
  // 模拟性能数据采集
  const now = new Date()
  const timeStr = now.toLocaleTimeString()

  const cpuValue = Math.floor(Math.random() * 40) + 20
  const memoryValue = Math.floor(Math.random() * 30) + 50
  const networkValue = Math.floor(Math.random() * 100) + 30
  const responseValue = Math.floor(Math.random() * 200) + 50

  // 保持最近20个数据点
  const maxDataPoints = 20

  performanceData.value.timestamps.push(timeStr)
  performanceData.value.cpu.push(cpuValue)
  performanceData.value.memory.push(memoryValue)
  performanceData.value.network.push(networkValue)
  performanceData.value.response.push(responseValue)

  if (performanceData.value.timestamps.length > maxDataPoints) {
    performanceData.value.timestamps.shift()
    performanceData.value.cpu.shift()
    performanceData.value.memory.shift()
    performanceData.value.network.shift()
    performanceData.value.response.shift()
  }
}

const updateCharts = () => {
  if (!cpuChartInstance || !memoryChartInstance || !networkChartInstance || !responseChartInstance) {
    return
  }

  // 更新CPU图表
  cpuChartInstance.setOption({
    xAxis: {
      data: performanceData.value.timestamps
    },
    series: [{
      data: performanceData.value.cpu
    }]
  })

  // 更新内存图表
  memoryChartInstance.setOption({
    xAxis: {
      data: performanceData.value.timestamps
    },
    series: [{
      data: performanceData.value.memory
    }]
  })

  // 更新网络图表
  networkChartInstance.setOption({
    xAxis: {
      data: performanceData.value.timestamps
    },
    series: [{
      data: performanceData.value.network
    }]
  })

  // 更新响应时间图表
  responseChartInstance.setOption({
    xAxis: {
      data: performanceData.value.timestamps
    },
    series: [{
      data: performanceData.value.response
    }]
  })
}

const updateStats = () => {
  const cpuData = performanceData.value.cpu
  const memoryData = performanceData.value.memory
  const networkData = performanceData.value.network

  if (cpuData.length > 0) {
    performanceStats.value.avgCpu = Math.round(cpuData.reduce((a, b) => a + b, 0) / cpuData.length)
    performanceStats.value.avgMemory = Math.round(memoryData.reduce((a, b) => a + b, 0) / memoryData.length)
    performanceStats.value.avgLatency = Math.round(networkData.reduce((a, b) => a + b, 0) / networkData.length)
    performanceStats.value.monitorTime = Math.floor(cpuData.length * 2 / 60) // 每2秒一次数据
  }
}

const clearCharts = () => {
  // 清空数据
  performanceData.value = {
    cpu: [],
    memory: [],
    network: [],
    response: [],
    timestamps: []
  }

  performanceStats.value = {
    avgCpu: 0,
    avgMemory: 0,
    avgLatency: 0,
    monitorTime: 0
  }

  // 更新图表
  updateCharts()

  ElMessage.success('已清空图表数据')
}

const disposeCharts = () => {
  if (cpuChartInstance) {
    cpuChartInstance.dispose()
    cpuChartInstance = null
  }
  if (memoryChartInstance) {
    memoryChartInstance.dispose()
    memoryChartInstance = null
  }
  if (networkChartInstance) {
    networkChartInstance.dispose()
    networkChartInstance = null
  }
  if (responseChartInstance) {
    responseChartInstance.dispose()
    responseChartInstance = null
  }
}
</script>

<style scoped>
.diagnostic-view {
  height: 100vh;
  background: #f5f7fa;
}

.performance-monitor {
  height: 100%;
}

.monitor-header {
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
}

.monitor-header h2 {
  margin: 0;
  color: #2c3e50;
}

.monitor-controls {
  display: flex;
  gap: 10px;
}

.monitor-main {
  padding: 20px;
  height: calc(100vh - 120px);
  overflow-y: auto;
}

.chart-card {
  margin-bottom: 20px;
}

.chart-container {
  height: 300px;
  width: 100%;
}

.stats-card {
  background: white;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .monitor-header {
    flex-direction: column;
    gap: 10px;
    padding: 15px;
  }

  .chart-container {
    height: 250px;
  }
}
</style>