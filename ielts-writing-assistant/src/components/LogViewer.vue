<template>
  <div class="log-viewer-container">
    <el-container>
      <el-header class="log-header">
        <div class="header-left">
          <h2>系统日志</h2>
          <el-tag :type="getStatusTagType(connectionStatus)">
            {{ connectionStatusText }}
          </el-tag>
        </div>
        <div class="header-right">
          <el-button @click="refreshLogs" :icon="Refresh" :loading="loading">
            刷新
          </el-button>
          <el-button @click="exportLogs" :icon="Download">
            导出日志
          </el-button>
          <el-button @click="clearLogs" :icon="Delete" type="danger">
            清空日志
          </el-button>
        </div>
      </el-header>

      <el-main class="log-main">
        <!-- 过滤器 -->
        <el-card class="filter-card">
          <el-row :gutter="20">
            <el-col :span="6">
              <el-select v-model="filters.level" placeholder="日志级别" clearable>
                <el-option label="全部" value="" />
                <el-option label="错误" value="ERROR" />
                <el-option label="警告" value="WARN" />
                <el-option label="信息" value="INFO" />
                <el-option label="调试" value="DEBUG" />
              </el-select>
            </el-col>
            <el-col :span="6">
              <el-select v-model="filters.source" placeholder="日志来源" clearable>
                <el-option label="全部" value="" />
                <el-option label="前端" value="frontend" />
                <el-option label="后端" value="backend" />
                <el-option label="AI服务" value="ai" />
                <el-option label="数据库" value="database" />
              </el-select>
            </el-col>
            <el-col :span="6">
              <el-date-picker
                v-model="filters.dateRange"
                type="datetimerange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                format="YYYY-MM-DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
              />
            </el-col>
            <el-col :span="6">
              <el-input
                v-model="filters.keyword"
                placeholder="搜索关键词"
                clearable
                @keyup.enter="filterLogs"
              >
                <template #append>
                  <el-button @click="filterLogs" :icon="Search" />
                </template>
              </el-input>
            </el-col>
          </el-row>
        </el-card>

        <!-- 统计信息 -->
        <el-card class="stats-card">
          <el-row :gutter="20">
            <el-col :span="6">
              <el-statistic title="总日志数" :value="statistics.total" />
            </el-col>
            <el-col :span="6">
              <el-statistic title="错误数" :value="statistics.error" value-style="color: #F56C6C" />
            </el-col>
            <el-col :span="6">
              <el-statistic title="警告数" :value="statistics.warn" value-style="color: #E6A23C" />
            </el-col>
            <el-col :span="6">
              <el-statistic title="最近更新" :value="statistics.lastUpdate" />
            </el-col>
          </el-row>
        </el-card>

        <!-- 日志列表 -->
        <el-card class="log-list-card">
          <div class="log-controls">
            <el-button @click="toggleAutoRefresh" :type="autoRefresh ? 'primary' : 'default'">
              {{ autoRefresh ? '停止自动刷新' : '开启自动刷新' }}
            </el-button>
            <el-switch v-model="showDetails" active-text="显示详情" />
            <el-switch v-model="realTimeMode" active-text="实时模式" />
          </div>

          <div class="log-list" ref="logListRef">
            <div
              v-for="(log, index) in filteredLogs"
              :key="log.id || index"
              class="log-item"
              :class="getLogItemClass(log.level)"
            >
              <div class="log-header" @click="toggleLogDetail(index)">
                <div class="log-meta">
                  <el-tag :type="getLevelTagType(log.level)" size="small">
                    {{ log.level }}
                  </el-tag>
                  <span class="log-time">{{ formatTime(log.timestamp) }}</span>
                  <span class="log-source">{{ log.source || 'system' }}</span>
                </div>
                <div class="log-message">
                  {{ log.message }}
                </div>
                <el-icon class="expand-icon" :class="{ expanded: expandedLogs[index] }">
                  <ArrowDown />
                </el-icon>
              </div>

              <el-collapse-transition>
                <div v-show="expandedLogs[index]" class="log-detail">
                  <el-descriptions :column="2" border size="small">
                    <el-descriptions-item label="时间戳">
                      {{ log.timestamp }}
                    </el-descriptions-item>
                    <el-descriptions-item label="级别">
                      <el-tag :type="getLevelTagType(log.level)">{{ log.level }}</el-tag>
                    </el-descriptions-item>
                    <el-descriptions-item label="来源">
                      {{ log.source || 'system' }}
                    </el-descriptions-item>
                    <el-descriptions-item label="请求ID" v-if="log.requestId">
                      {{ log.requestId }}
                    </el-descriptions-item>
                  </el-descriptions>

                  <div v-if="log.error" class="error-detail">
                    <h4>错误信息</h4>
                    <el-alert :title="log.error.message" type="error" show-icon :closable="false">
                      <template #default>
                        <pre>{{ log.error.stack }}</pre>
                      </template>
                    </el-alert>
                  </div>

                  <div v-if="log.context" class="context-detail">
                    <h4>上下文信息</h4>
                    <pre>{{ JSON.stringify(log.context, null, 2) }}</pre>
                  </div>
                </div>
              </el-collapse-transition>
            </div>
          </div>

          <div v-if="filteredLogs.length === 0" class="no-logs">
            <el-empty description="暂无日志数据" />
          </div>
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Download, Delete, Search, ArrowDown } from '@element-plus/icons-vue'

// 状态管理
const logs = ref([])
const loading = ref(false)
const connectionStatus = ref('connected')
const autoRefresh = ref(false)
const showDetails = ref(false)
const realTimeMode = ref(false)
const expandedLogs = ref({})
const logListRef = ref()
const refreshTimer = ref(null)

// 过滤器
const filters = reactive({
  level: '',
  source: '',
  dateRange: null,
  keyword: ''
})

// 统计信息
const statistics = reactive({
  total: 0,
  error: 0,
  warn: 0,
  info: 0,
  debug: 0,
  lastUpdate: new Date().toLocaleString()
})

// 计算属性
const connectionStatusText = computed(() => {
  const statusMap = {
    connected: '已连接',
    disconnected: '连接断开',
    error: '连接错误'
  }
  return statusMap[connectionStatus.value] || '未知状态'
})

const filteredLogs = computed(() => {
  let result = logs.value

  // 级别过滤
  if (filters.level) {
    result = result.filter(log => log.level === filters.level)
  }

  // 来源过滤
  if (filters.source) {
    result = result.filter(log => log.source === filters.source)
  }

  // 日期范围过滤
  if (filters.dateRange && filters.dateRange.length === 2) {
    const [start, end] = filters.dateRange
    result = result.filter(log => {
      const logTime = new Date(log.timestamp)
      return logTime >= new Date(start) && logTime <= new Date(end)
    })
  }

  // 关键词过滤
  if (filters.keyword) {
    const keyword = filters.keyword.toLowerCase()
    result = result.filter(log =>
      log.message.toLowerCase().includes(keyword) ||
      JSON.stringify(log.context || {}).toLowerCase().includes(keyword)
    )
  }

  return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
})

// 生命周期
onMounted(() => {
  loadLogs()
  startRealTimeMode()
})

onUnmounted(() => {
  stopAutoRefresh()
  stopRealTimeMode()
})

// 方法
const loadLogs = async () => {
  loading.value = true
  try {
    const response = await fetch('/api/logs')
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        logs.value = data.data
        updateStatistics()
        connectionStatus.value = 'connected'
      } else {
        ElMessage.error('加载日志失败: ' + data.message)
      }
    } else {
      connectionStatus.value = 'error'
      ElMessage.error('服务器连接失败')
    }
  } catch (error) {
    console.error('加载日志失败:', error)
    connectionStatus.value = 'disconnected'
    // 模拟日志数据用于演示
    loadMockLogs()
  } finally {
    loading.value = false
  }
}

const loadMockLogs = () => {
  logs.value = [
    {
      id: 1,
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: '应用启动成功',
      source: 'frontend',
      context: { version: '1.0.0', environment: 'development' }
    },
    {
      id: 2,
      timestamp: new Date(Date.now() - 10000).toISOString(),
      level: 'WARN',
      message: 'AI API 响应时间较长',
      source: 'ai',
      context: { provider: 'openrouter', duration: 5000, model: 'gpt-4' }
    },
    {
      id: 3,
      timestamp: new Date(Date.now() - 30000).toISOString(),
      level: 'ERROR',
      message: '数据库连接失败',
      source: 'backend',
      error: {
        message: 'Connection timeout',
        stack: 'Error: Connection timeout\n    at Database.connect (/app/src/database.js:45:15)'
      },
      context: { database: 'ielts_db', timeout: 30000 }
    }
  ]
  updateStatistics()
}

const updateStatistics = () => {
  statistics.total = logs.value.length
  statistics.error = logs.value.filter(log => log.level === 'ERROR').length
  statistics.warn = logs.value.filter(log => log.level === 'WARN').length
  statistics.info = logs.value.filter(log => log.level === 'INFO').length
  statistics.debug = logs.value.filter(log => log.level === 'DEBUG').length
  statistics.lastUpdate = new Date().toLocaleString()
}

const refreshLogs = () => {
  loadLogs()
}

const filterLogs = () => {
  // 过滤逻辑已在计算属性中实现
}

const clearLogs = async () => {
  try {
    await ElMessageBox.confirm('确定要清空所有日志吗？此操作不可撤销。', '确认清空', {
      type: 'warning'
    })

    loading.value = true
    const response = await fetch('/api/logs', { method: 'DELETE' })

    if (response.ok) {
      logs.value = []
      updateStatistics()
      ElMessage.success('日志已清空')
    } else {
      ElMessage.error('清空日志失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('清空日志失败:', error)
      ElMessage.error('清空日志失败')
    }
  } finally {
    loading.value = false
  }
}

const exportLogs = () => {
  const logText = filteredLogs.value.map(log => {
    const { timestamp, level, message, source, error, context } = log
    let logLine = `[${timestamp}] [${level}] [${source || 'system'}] ${message}`

    if (error) {
      logLine += `\nError: ${error.message}`
    }

    if (context && Object.keys(context).length > 0) {
      logLine += `\nContext: ${JSON.stringify(context, null, 2)}`
    }

    return logLine
  }).join('\n\n---\n\n')

  const blob = new Blob([logText], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `logs-${new Date().toISOString().split('T')[0]}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  ElMessage.success('日志已导出')
}

const toggleAutoRefresh = () => {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
}

const startAutoRefresh = () => {
  refreshTimer.value = setInterval(() => {
    loadLogs()
  }, 5000) // 每5秒刷新一次
}

const stopAutoRefresh = () => {
  if (refreshTimer.value) {
    clearInterval(refreshTimer.value)
    refreshTimer.value = null
  }
}

const startRealTimeMode = () => {
  if (realTimeMode.value && typeof EventSource !== 'undefined') {
    const eventSource = new EventSource('/api/logs/stream')

    eventSource.onmessage = (event) => {
      try {
        const newLog = JSON.parse(event.data)
        logs.value.unshift(newLog)
        updateStatistics()

        // 自动滚动到顶部
        nextTick(() => {
          if (logListRef.value) {
            logListRef.value.scrollTop = 0
          }
        })
      } catch (error) {
        console.error('解析实时日志失败:', error)
      }
    }

    eventSource.onerror = () => {
      console.error('实时日志连接错误')
      eventSource.close()
    }
  }
}

const stopRealTimeMode = () => {
  // 实时模式清理逻辑
}

const toggleLogDetail = (index) => {
  expandedLogs.value[index] = !expandedLogs.value[index]
}

const getStatusTagType = (status) => {
  const typeMap = {
    connected: 'success',
    disconnected: 'warning',
    error: 'danger'
  }
  return typeMap[status] || 'info'
}

const getLevelTagType = (level) => {
  const typeMap = {
    ERROR: 'danger',
    WARN: 'warning',
    INFO: 'primary',
    DEBUG: 'info'
  }
  return typeMap[level] || 'info'
}

const getLogItemClass = (level) => {
  return `log-item-${level.toLowerCase()}`
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleString()
}
</script>

<style scoped>
.log-viewer-container {
  height: 100vh;
  background: #f5f7fa;
}

.log-header {
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-left h2 {
  margin: 0;
  color: #2c3e50;
}

.header-right {
  display: flex;
  gap: 10px;
}

.log-main {
  padding: 20px;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.filter-card,
.stats-card,
.log-list-card {
  margin-bottom: 20px;
}

.log-controls {
  display: flex;
  gap: 15px;
  align-items: center;
  margin-bottom: 15px;
}

.log-list {
  max-height: 500px;
  overflow-y: auto;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
}

.log-item {
  border-bottom: 1px solid #f0f0f0;
  transition: all 0.2s;
}

.log-item:hover {
  background: #f8f9fa;
}

.log-item-error {
  border-left: 4px solid #F56C6C;
}

.log-item-warn {
  border-left: 4px solid #E6A23C;
}

.log-item-info {
  border-left: 4px solid #409EFF;
}

.log-item-debug {
  border-left: 4px solid #909399;
}

.log-header {
  display: flex;
  align-items: center;
  padding: 12px 15px;
  cursor: pointer;
  user-select: none;
}

.log-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 300px;
}

.log-time {
  font-size: 12px;
  color: #909399;
}

.log-source {
  font-size: 12px;
  color: #606266;
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
}

.log-message {
  flex: 1;
  color: #303133;
  font-size: 14px;
}

.expand-icon {
  transition: transform 0.2s;
  color: #909399;
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.log-detail {
  padding: 15px;
  background: #fafafa;
  border-top: 1px solid #f0f0f0;
}

.error-detail,
.context-detail {
  margin-top: 15px;
}

.error-detail h4,
.context-detail h4 {
  margin-bottom: 10px;
  color: #303133;
  font-size: 14px;
}

.error-detail pre,
.context-detail pre {
  background: #f5f5f5;
  padding: 10px;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

.no-logs {
  text-align: center;
  padding: 50px 20px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .log-header {
    flex-direction: column;
    gap: 10px;
    padding: 15px;
  }

  .log-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .log-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .log-meta {
    min-width: auto;
  }
}
</style>