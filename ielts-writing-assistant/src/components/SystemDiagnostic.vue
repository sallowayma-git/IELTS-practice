<template>
  <div class="diagnostic-container">
    <el-container>
      <el-header class="diagnostic-header">
        <div class="header-left">
          <h2>系统诊断</h2>
          <el-tag :type="getOverallStatusTagType()">
            {{ overallStatusText }}
          </el-tag>
        </div>
        <div class="header-right">
          <el-button @click="runFullDiagnostic" :loading="diagnosing" type="primary">
            完整诊断
          </el-button>
          <el-button @click="exportReport" :icon="Download">
            导出报告
          </el-button>
        </div>
      </el-header>

      <el-main class="diagnostic-main">
        <!-- 系统概览 -->
        <el-card class="overview-card">
          <template #header>
            <span>系统概览</span>
          </template>
          <el-row :gutter="20">
            <el-col :span="6">
              <div class="overview-item">
                <div class="overview-icon" :class="getStatusClass(systemInfo.frontend.status)">
                  <el-icon><Monitor /></el-icon>
                </div>
                <div class="overview-content">
                  <div class="overview-title">前端系统</div>
                  <div class="overview-status">{{ systemInfo.frontend.status }}</div>
                  <div class="overview-detail">{{ systemInfo.frontend.version }}</div>
                </div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="overview-item">
                <div class="overview-icon" :class="getStatusClass(systemInfo.backend.status)">
                  <el-icon><Setting /></el-icon>
                </div>
                <div class="overview-content">
                  <div class="overview-title">后端服务</div>
                  <div class="overview-status">{{ systemInfo.backend.status }}</div>
                  <div class="overview-detail">{{ systemInfo.backend.port }}</div>
                </div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="overview-item">
                <div class="overview-icon" :class="getStatusClass(systemInfo.database.status)">
                  <el-icon><Coin /></el-icon>
                </div>
                <div class="overview-content">
                  <div class="overview-title">数据库</div>
                  <div class="overview-status">{{ systemInfo.database.status }}</div>
                  <div class="overview-detail">{{ systemInfo.database.type }}</div>
                </div>
              </div>
            </el-col>
            <el-col :span="6">
              <div class="overview-item">
                <div class="overview-icon" :class="getStatusClass(systemInfo.aiService.status)">
                  <el-icon><MagicStick /></el-icon>
                </div>
                <div class="overview-content">
                  <div class="overview-title">AI服务</div>
                  <div class="overview-status">{{ systemInfo.aiService.status }}</div>
                  <div class="overview-detail">{{ systemInfo.aiService.provider }}</div>
                </div>
              </div>
            </el-col>
          </el-row>
        </el-card>

        <!-- 详细诊断结果 -->
        <el-row :gutter="20">
          <!-- 系统性能 -->
          <el-col :span="12">
            <el-card class="performance-card">
              <template #header>
                <span>系统性能</span>
                <el-button @click="refreshPerformance" :icon="Refresh" size="small" text />
              </template>

              <div class="performance-item">
                <div class="perf-label">CPU使用率</div>
                <el-progress :percentage="performance.cpu" :color="getProgressColor(performance.cpu)" />
                <div class="perf-value">{{ performance.cpu }}%</div>
              </div>

              <div class="performance-item">
                <div class="perf-label">内存使用</div>
                <el-progress :percentage="performance.memory" :color="getProgressColor(performance.memory)" />
                <div class="perf-value">{{ performance.memoryUsed }} / {{ performance.memoryTotal }}</div>
              </div>

              <div class="performance-item">
                <div class="perf-label">磁盘使用</div>
                <el-progress :percentage="performance.disk" :color="getProgressColor(performance.disk)" />
                <div class="perf-value">{{ performance.diskUsed }} / {{ performance.diskTotal }}</div>
              </div>

              <div class="performance-item">
                <div class="perf-label">网络延迟</div>
                <div class="network-latency">
                  <el-tag :type="getLatencyTagType(performance.latency)">
                    {{ performance.latency }}ms
                  </el-tag>
                  <span class="latency-status">{{ getLatencyStatus(performance.latency) }}</span>
                </div>
              </div>
            </el-card>
          </el-col>

          <!-- 服务状态 -->
          <el-col :span="12">
            <el-card class="services-card">
              <template #header>
                <span>服务状态</span>
                <el-button @click="checkServices" :icon="Refresh" size="small" text />
              </template>

              <div class="service-list">
                <div
                  v-for="service in services"
                  :key="service.name"
                  class="service-item"
                  :class="getStatusClass(service.status)"
                >
                  <div class="service-info">
                    <div class="service-name">{{ service.name }}</div>
                    <div class="service-url">{{ service.url }}</div>
                  </div>
                  <div class="service-status">
                    <el-tag :type="getStatusTagType(service.status)" size="small">
                      {{ service.status }}
                    </el-tag>
                    <div class="service-response">{{ service.responseTime }}ms</div>
                  </div>
                </div>
              </div>
            </el-card>
          </el-col>
        </el-row>

        <!-- 问题检测 -->
        <el-card class="issues-card">
          <template #header>
            <span>问题检测</span>
            <el-badge :value="issues.length" type="danger" v-if="issues.length > 0" />
          </template>

          <div v-if="issues.length === 0" class="no-issues">
            <el-result icon="success" title="系统正常" sub-title="未发现任何问题">
              <template #extra>
                <el-button type="primary" @click="runFullDiagnostic">重新检测</el-button>
              </template>
            </el-result>
          </div>

          <div v-else class="issues-list">
            <div
              v-for="(issue, index) in issues"
              :key="index"
              class="issue-item"
              :class="getIssueSeverityClass(issue.severity)"
            >
              <div class="issue-header">
                <el-tag :type="getIssueSeverityTagType(issue.severity)">
                  {{ issue.severity }}
                </el-tag>
                <span class="issue-title">{{ issue.title }}</span>
                <el-button @click="fixIssue(index)" type="primary" size="small" v-if="issue.fixable">
                  修复
                </el-button>
              </div>
              <div class="issue-description">{{ issue.description }}</div>
              <div class="issue-suggestion" v-if="issue.suggestion">
                <strong>建议：</strong>{{ issue.suggestion }}
              </div>
            </div>
          </div>
        </el-card>

        <!-- 诊断历史 -->
        <el-card class="history-card">
          <template #header>
            <span>诊断历史</span>
            <el-button @click="clearHistory" size="small" text>清空历史</el-button>
          </template>

          <el-timeline>
            <el-timeline-item
              v-for="(record, index) in diagnosticHistory"
              :key="index"
              :timestamp="formatTime(record.timestamp)"
              :type="getTimelineType(record.overallStatus)"
            >
              <div class="history-item">
                <div class="history-status">{{ record.overallStatus }}</div>
                <div class="history-summary">{{ record.summary }}</div>
                <div class="history-issues" v-if="record.issues > 0">
                  发现 {{ record.issues }} 个问题
                </div>
              </div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Monitor, Setting, Coin, MagicStick, Refresh, Download } from '@element-plus/icons-vue'

// 状态管理
const diagnosing = ref(false)
const diagnosticHistory = ref([])

// 系统信息
const systemInfo = reactive({
  frontend: {
    status: 'normal',
    version: '1.0.0',
    uptime: '2小时30分'
  },
  backend: {
    status: 'normal',
    port: '3000',
    version: '1.0.0'
  },
  database: {
    status: 'normal',
    type: 'SQLite',
    size: '45MB'
  },
  aiService: {
    status: 'normal',
    provider: 'OpenRouter',
    model: 'GPT-4'
  }
})

// 性能数据
const performance = reactive({
  cpu: 25,
  memory: 60,
  memoryUsed: '2.1GB',
  memoryTotal: '8GB',
  disk: 35,
  diskUsed: '120GB',
  diskTotal: '500GB',
  latency: 45
})

// 服务状态
const services = ref([
  {
    name: '前端服务',
    url: 'http://localhost:5175',
    status: 'normal',
    responseTime: 12
  },
  {
    name: '后端API',
    url: 'http://localhost:3000',
    status: 'normal',
    responseTime: 25
  },
  {
    name: 'AI服务',
    url: 'OpenRouter API',
    status: 'warning',
    responseTime: 1250
  },
  {
    name: '数据库',
    url: 'SQLite',
    status: 'normal',
    responseTime: 3
  }
])

// 问题列表
const issues = ref([])

// 计算属性
const overallStatusText = computed(() => {
  const criticalIssues = issues.value.filter(issue => issue.severity === 'critical').length
  const warningIssues = issues.value.filter(issue => issue.severity === 'warning').length

  if (criticalIssues > 0) {
    return `严重问题 (${criticalIssues})`
  } else if (warningIssues > 0) {
    return `警告 (${warningIssues})`
  } else {
    return '系统正常'
  }
})

// 生命周期
onMounted(() => {
  runFullDiagnostic()
})

// 方法
const runFullDiagnostic = async () => {
  diagnosing.value = true
  issues.value = []

  try {
    // 模拟诊断过程
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 检查各个系统组件
    await checkSystemComponents()
    await checkPerformance()
    await checkServices()
    await detectIssues()

    // 记录诊断历史
    recordDiagnosticResult()

    ElMessage.success('系统诊断完成')
  } catch (error) {
    console.error('诊断失败:', error)
    ElMessage.error('系统诊断失败')
  } finally {
    diagnosing.value = false
  }
}

const checkSystemComponents = async () => {
  // 检查前端状态
  try {
    const response = await fetch('/api/health')
    if (response.ok) {
      systemInfo.frontend.status = 'normal'
    } else {
      systemInfo.frontend.status = 'error'
      issues.value.push({
        severity: 'critical',
        title: '前端服务异常',
        description: '前端服务响应异常，请检查服务状态',
        fixable: true,
        suggestion: '重启前端服务或检查网络连接'
      })
    }
  } catch (error) {
    systemInfo.frontend.status = 'error'
    issues.value.push({
      severity: 'critical',
      title: '前端服务不可达',
      description: '无法连接到前端服务',
      fixable: true,
      suggestion: '检查前端服务是否正常运行'
    })
  }

  // 检查后端状态
  try {
    const response = await fetch('http://localhost:3000/api/health')
    if (response.ok) {
      systemInfo.backend.status = 'normal'
    } else {
      systemInfo.backend.status = 'warning'
      issues.value.push({
        severity: 'warning',
        title: '后端服务响应异常',
        description: '后端服务返回异常状态码',
        fixable: false,
        suggestion: '检查后端日志排查问题'
      })
    }
  } catch (error) {
    systemInfo.backend.status = 'error'
    issues.value.push({
      severity: 'critical',
      title: '后端服务不可达',
      description: '无法连接到后端服务',
      fixable: true,
      suggestion: '启动后端服务'
    })
  }
}

const checkPerformance = async () => {
  // 模拟性能数据获取
  if (performance.memory > 80) {
    issues.value.push({
      severity: 'warning',
      title: '内存使用率过高',
      description: `当前内存使用率为 ${performance.memory}%`,
      fixable: false,
      suggestion: '关闭不必要的应用程序或增加内存'
    })
  }

  if (performance.latency > 1000) {
    issues.value.push({
      severity: 'warning',
      title: '网络延迟较高',
      description: `当前网络延迟为 ${performance.latency}ms`,
      fixable: false,
      suggestion: '检查网络连接或更换网络环境'
    })
  }
}

const checkServices = async () => {
  for (const service of services.value) {
    try {
      const startTime = Date.now()
      const response = await fetch(service.url, { method: 'HEAD' })
      const responseTime = Date.now() - startTime

      service.responseTime = responseTime
      service.status = response.ok ? 'normal' : 'warning'

      if (responseTime > 5000) {
        issues.value.push({
          severity: 'warning',
          title: `${service.name}响应缓慢`,
          description: `服务响应时间超过5秒`,
          fixable: false,
          suggestion: '检查服务性能或网络状况'
        })
      }
    } catch (error) {
      service.status = 'error'
      issues.value.push({
        severity: 'critical',
        title: `${service.name}不可达`,
        description: `无法连接到${service.name}`,
        fixable: service.name.includes('AI'),
        suggestion: service.name.includes('AI') ? '检查AI服务配置' : '检查服务状态'
      })
    }
  }
}

const detectIssues = () => {
  // 模拟一些常见问题检测
  if (Math.random() > 0.7) {
    issues.value.push({
      severity: 'info',
      title: '建议更新应用',
      description: '发现新版本可用',
      fixable: true,
      suggestion: '建议更新到最新版本以获得更好的体验'
    })
  }

  if (performance.disk > 90) {
    issues.value.push({
      severity: 'critical',
      title: '磁盘空间不足',
      description: `磁盘使用率达到 ${performance.disk}%`,
      fixable: true,
      suggestion: '清理磁盘空间或扩展存储容量'
    })
  }
}

const recordDiagnosticResult = () => {
  const record = {
    timestamp: new Date(),
    overallStatus: overallStatusText.value,
    summary: `系统检查完成，发现 ${issues.value.length} 个问题`,
    issues: issues.value.length
  }

  diagnosticHistory.value.unshift(record)

  // 保留最近10条记录
  if (diagnosticHistory.value.length > 10) {
    diagnosticHistory.value = diagnosticHistory.value.slice(0, 10)
  }
}

const refreshPerformance = async () => {
  // 模拟刷新性能数据
  performance.cpu = Math.floor(Math.random() * 50) + 10
  performance.memory = Math.floor(Math.random() * 40) + 40
  performance.latency = Math.floor(Math.random() * 100) + 20

  ElMessage.success('性能数据已更新')
}

const fixIssue = async (index) => {
  const issue = issues.value[index]

  try {
    ElMessage.info(`正在修复: ${issue.title}`)

    // 模拟修复过程
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 根据问题类型执行不同的修复逻辑
    if (issue.title.includes('前端服务')) {
      // 前端服务修复逻辑
      window.location.reload()
    } else if (issue.title.includes('AI服务')) {
      // AI服务修复逻辑
      systemInfo.aiService.status = 'normal'
      services.value.find(s => s.name === 'AI服务').status = 'normal'
    }

    issues.value.splice(index, 1)
    ElMessage.success('问题已修复')
  } catch (error) {
    ElMessage.error('修复失败: ' + error.message)
  }
}

const exportReport = () => {
  const report = {
    timestamp: new Date().toISOString(),
    systemInfo,
    performance,
    services: services.value,
    issues: issues.value,
    overallStatus: overallStatusText.value
  }

  const reportText = `
系统诊断报告
================
生成时间: ${new Date().toLocaleString()}

总体状态: ${overallStatusText.value}

系统信息
--------
前端: ${systemInfo.frontend.status} (${systemInfo.frontend.version})
后端: ${systemInfo.backend.status} (端口: ${systemInfo.backend.port})
数据库: ${systemInfo.database.status} (${systemInfo.database.type})
AI服务: ${systemInfo.aiService.status} (${systemInfo.aiService.provider})

性能数据
--------
CPU: ${performance.cpu}%
内存: ${performance.memory}% (${performance.memoryUsed}/${performance.memoryTotal})
磁盘: ${performance.disk}% (${performance.diskUsed}/${performance.diskTotal})
网络延迟: ${performance.latency}ms

服务状态
--------
${services.value.map(s => `${s.name}: ${s.status} (${s.responseTime}ms)`).join('\n')}

发现问题
--------
${issues.value.length > 0 ? issues.value.map(i => `[${i.severity}] ${i.title}: ${i.description}`).join('\n') : '无'}

================
报告结束
  `

  const blob = new Blob([reportText], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `diagnostic-report-${new Date().toISOString().split('T')[0]}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  ElMessage.success('诊断报告已导出')
}

const clearHistory = async () => {
  try {
    await ElMessageBox.confirm('确定要清空诊断历史吗？', '确认清空', {
      type: 'warning'
    })

    diagnosticHistory.value = []
    ElMessage.success('诊断历史已清空')
  } catch (error) {
    // 用户取消
  }
}

// 辅助方法
const getOverallStatusTagType = () => {
  const criticalIssues = issues.value.filter(issue => issue.severity === 'critical').length
  const warningIssues = issues.value.filter(issue => issue.severity === 'warning').length

  if (criticalIssues > 0) {
    return 'danger'
  } else if (warningIssues > 0) {
    return 'warning'
  } else {
    return 'success'
  }
}

const getStatusClass = (status) => {
  return `status-${status}`
}

const getStatusTagType = (status) => {
  const typeMap = {
    normal: 'success',
    warning: 'warning',
    error: 'danger',
    unknown: 'info'
  }
  return typeMap[status] || 'info'
}

const getProgressColor = (percentage) => {
  if (percentage < 50) return '#67C23A'
  if (percentage < 80) return '#E6A23C'
  return '#F56C6C'
}

const getLatencyTagType = (latency) => {
  if (latency < 100) return 'success'
  if (latency < 500) return 'warning'
  return 'danger'
}

const getLatencyStatus = (latency) => {
  if (latency < 100) return '良好'
  if (latency < 500) return '一般'
  return '较差'
}

const getIssueSeverityClass = (severity) => {
  return `issue-${severity}`
}

const getIssueSeverityTagType = (severity) => {
  const typeMap = {
    critical: 'danger',
    warning: 'warning',
    info: 'primary'
  }
  return typeMap[severity] || 'info'
}

const getTimelineType = (status) => {
  if (status.includes('严重')) return 'danger'
  if (status.includes('警告')) return 'warning'
  return 'success'
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleString()
}
</script>

<style scoped>
.diagnostic-container {
  height: 100vh;
  background: #f5f7fa;
}

.diagnostic-header {
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

.diagnostic-main {
  padding: 20px;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.overview-card,
.performance-card,
.services-card,
.issues-card,
.history-card {
  margin-bottom: 20px;
}

.overview-item {
  display: flex;
  align-items: center;
  padding: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.overview-icon {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 15px;
  font-size: 24px;
  color: white;
}

.overview-icon.status-normal {
  background: #67C23A;
}

.overview-icon.status-warning {
  background: #E6A23C;
}

.overview-icon.status-error {
  background: #F56C6C;
}

.overview-content {
  flex: 1;
}

.overview-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 5px;
}

.overview-status {
  font-size: 14px;
  color: #606266;
  margin-bottom: 3px;
}

.overview-detail {
  font-size: 12px;
  color: #909399;
}

.performance-item {
  margin-bottom: 20px;
}

.perf-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 14px;
  color: #606266;
}

.perf-value {
  font-size: 12px;
  color: #909399;
  margin-top: 5px;
}

.network-latency {
  display: flex;
  align-items: center;
  gap: 10px;
}

.latency-status {
  font-size: 12px;
  color: #606266;
}

.service-list {
  max-height: 300px;
  overflow-y: auto;
}

.service-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  margin-bottom: 10px;
  transition: all 0.2s;
}

.service-item:hover {
  background: #f8f9fa;
}

.service-item.status-normal {
  border-left: 4px solid #67C23A;
}

.service-item.status-warning {
  border-left: 4px solid #E6A23C;
}

.service-item.status-error {
  border-left: 4px solid #F56C6C;
}

.service-info {
  flex: 1;
}

.service-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 3px;
}

.service-url {
  font-size: 12px;
  color: #909399;
}

.service-status {
  text-align: right;
}

.service-response {
  font-size: 12px;
  color: #606266;
  margin-top: 3px;
}

.no-issues {
  text-align: center;
  padding: 50px 20px;
}

.issues-list {
  space-y: 15px;
}

.issue-item {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 15px;
  transition: all 0.2s;
}

.issue-item.issue-critical {
  border-left: 4px solid #F56C6C;
  background: #fef0f0;
}

.issue-item.issue-warning {
  border-left: 4px solid #E6A23C;
  background: #fdf6ec;
}

.issue-item.issue-info {
  border-left: 4px solid #409EFF;
  background: #ecf5ff;
}

.issue-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.issue-title {
  flex: 1;
  font-weight: 600;
  color: #303133;
}

.issue-description {
  color: #606266;
  margin-bottom: 8px;
  line-height: 1.5;
}

.issue-suggestion {
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}

.history-item {
  padding-left: 10px;
}

.history-status {
  font-weight: 600;
  color: #303133;
  margin-bottom: 5px;
}

.history-summary {
  color: #606266;
  margin-bottom: 3px;
}

.history-issues {
  font-size: 12px;
  color: #909399;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .diagnostic-header {
    flex-direction: column;
    gap: 10px;
    padding: 15px;
  }

  .overview-item {
    flex-direction: column;
    text-align: center;
  }

  .overview-icon {
    margin-right: 0;
    margin-bottom: 10px;
  }

  .service-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .service-status {
    text-align: left;
  }

  .issue-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>