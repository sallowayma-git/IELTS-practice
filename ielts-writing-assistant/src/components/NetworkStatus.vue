<template>
  <div class="network-status">
    <!-- 网络状态指示器 -->
    <div class="network-indicator" :class="networkStatusClass" v-if="showIndicator">
      <el-icon><component :is="networkIcon" /></el-icon>
      <span>{{ networkStatusText }}</span>
    </div>

    <!-- 网络详情弹窗 -->
    <el-dialog v-model="showDetails" title="网络状态" width="400px">
      <div class="network-details">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="连接状态">
            <el-tag :type="getStatusTagType()">
              {{ networkStatusText }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="连接类型">
            {{ connectionType || '未知' }}
          </el-descriptions-item>
          <el-descriptions-item label="有效带宽">
            {{ effectiveBandwidth || '未知' }}
          </el-descriptions-item>
          <el-descriptions-item label="离线队列">
            {{ offlineQueue.length }} 个项目
          </el-descriptions-item>
          <el-descriptions-item label="上次同步">
            {{ lastSyncTime ? formatTime(lastSyncTime) : '从未同步' }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="network-actions" style="margin-top: 20px;">
          <el-button @click="testConnection" :loading="testing" type="primary">
            测试连接
          </el-button>
          <el-button @click="syncOfflineData" :loading="syncing" :disabled="!isOnline">
            同步离线数据
          </el-button>
          <el-button @click="clearOfflineData" type="danger">
            清空离线数据
          </el-button>
        </div>
      </div>
    </el-dialog>

    <!-- 同步进度 -->
    <el-dialog v-model="showSyncProgress" title="数据同步" width="500px" :close-on-click-modal="false">
      <div class="sync-progress">
        <el-progress :percentage="syncProgress" :status="syncStatus" />
        <div class="sync-info">
          <p>{{ syncMessage }}</p>
          <p v-if="syncDetails">已同步: {{ syncDetails.successed }} / {{ syncDetails.total }}</p>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection, Wifi, Warning, Loading } from '@element-plus/icons-vue'

// 状态管理
const isOnline = ref(navigator.onLine)
const connectionType = ref('')
const effectiveBandwidth = ref('')
const showIndicator = ref(false)
const showDetails = ref(false)
const showSyncProgress = ref(false)
const testing = ref(false)
const syncing = ref(false)

// 离线数据队列
const offlineQueue = ref([])
const lastSyncTime = ref(null)

// 同步进度
const syncProgress = ref(0)
const syncStatus = ref('success')
const syncMessage = ref('')
const syncDetails = ref(null)

// 计算属性
const networkStatusClass = computed(() => {
  if (!isOnline.value) return 'network-offline'
  if (connectionType.value === 'slow-2g' || connectionType.value === '2g') return 'network-slow'
  return 'network-online'
})

const networkStatusText = computed(() => {
  if (!isOnline.value) return '离线'
  if (connectionType.value === 'slow-2g') return '网络极慢'
  if (connectionType.value === '2g') return '网络很慢'
  if (connectionType.value === '3g') return '网络较慢'
  if (connectionType.value === '4g') return '网络良好'
  return '网络正常'
})

const networkIcon = computed(() => {
  if (!isOnline.value) return Warning
  if (syncing.value) return Loading
  if (connectionType.value && connectionType.value.includes('2g')) return Warning
  return isOnline.value ? Wifi : Connection
})

// 生命周期
onMounted(() => {
  initializeNetworkMonitoring()
  loadOfflineQueue()
})

onUnmounted(() => {
  cleanupNetworkMonitoring()
})

// 方法
const initializeNetworkMonitoring = () => {
  // 监听在线/离线状态变化
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  // 获取网络连接信息
  if ('connection' in navigator) {
    const connection = navigator.connection
    updateConnectionInfo(connection)

    connection.addEventListener('change', () => {
      updateConnectionInfo(connection)
    })
  }

  // 监听页面可见性变化
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // 定期检查网络状态
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      checkNetworkStatus()
    }
  }, 30000) // 30秒检查一次

  // 清理函数
  cleanupNetworkMonitoring = () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    clearInterval(interval)
  }
}

const updateConnectionInfo = (connection) => {
  connectionType.value = connection.effectiveType || connection.type || 'unknown'
  effectiveBandwidth.value = connection.downlink ? `${connection.downlink}Mbps` : 'unknown'

  // 根据网络质量调整应用行为
  adaptToNetworkQuality(connection)
}

const adaptToNetworkQuality = (connection) => {
  if (!connection) return

  const isSlowConnection = connection.effectiveType === 'slow-2g' ||
                          connection.effectiveType === '2g' ||
                          (connection.downlink && connection.downlink < 0.5)

  // 缓慢连接时减少数据传输
  if (isSlowConnection) {
    ElMessage.warning('检测到网络连接较慢，已启用数据节省模式')
    // 可以在这里应用数据节省策略
  }
}

const handleOnline = () => {
  isOnline.value = true
  showIndicator.value = false
  ElMessage.success('网络连接已恢复')

  // 自动同步离线数据
  if (offlineQueue.value.length > 0) {
    syncOfflineData()
  }
}

const handleOffline = () => {
  isOnline.value = false
  showIndicator.value = true
  ElMessage.warning('网络连接已断开，应用将进入离线模式')
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    checkNetworkStatus()
  }
}

const checkNetworkStatus = async () => {
  try {
    // 通过发送小请求测试网络连接
    const response = await fetch('/api/health', {
      method: 'HEAD',
      cache: 'no-cache',
      timeout: 5000
    })

    if (response.ok && !isOnline.value) {
      handleOnline()
    } else if (!response.ok && isOnline.value) {
      isOnline.value = false
      showIndicator.value = true
    }
  } catch (error) {
    if (isOnline.value) {
      isOnline.value = false
      showIndicator.value = true
    }
  }
}

const testConnection = async () => {
  testing.value = true
  try {
    const startTime = Date.now()
    const response = await fetch('/api/health')
    const latency = Date.now() - startTime

    if (response.ok) {
      ElMessage.success(`网络连接正常，延迟 ${latency}ms`)
    } else {
      ElMessage.error(`网络连接异常，状态码: ${response.status}`)
    }
  } catch (error) {
    ElMessage.error('网络连接测试失败: ' + error.message)
  } finally {
    testing.value = false
  }
}

const loadOfflineQueue = () => {
  try {
    const stored = localStorage.getItem('offlineQueue')
    if (stored) {
      offlineQueue.value = JSON.parse(stored)
    }

    const lastSync = localStorage.getItem('lastSyncTime')
    if (lastSync) {
      lastSyncTime.value = new Date(lastSync)
    }
  } catch (error) {
    console.error('加载离线队列失败:', error)
  }
}

const saveOfflineQueue = () => {
  try {
    localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue.value))
  } catch (error) {
    console.error('保存离线队列失败:', error)
  }
}

const addToOfflineQueue = (item) => {
  const queueItem = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    ...item
  }

  offlineQueue.value.push(queueItem)
  saveOfflineQueue()

  ElMessage.info('数据已添加到离线队列')
}

const syncOfflineData = async () => {
  if (!isOnline.value) {
    ElMessage.warning('请先连接到网络')
    return
  }

  if (offlineQueue.value.length === 0) {
    ElMessage.info('没有需要同步的离线数据')
    return
  }

  syncing.value = true
  showSyncProgress.value = true
  syncProgress.value = 0
  syncMessage.value = '开始同步离线数据...'
  syncStatus.value = 'success'

  const totalItems = offlineQueue.value.length
  let successCount = 0
  let errorCount = 0

  try {
    for (let i = 0; i < offlineQueue.value.length; i++) {
      const item = offlineQueue.value[i]

      try {
        await syncItem(item)
        successCount++

        // 更新同步进度
        syncProgress.value = Math.round(((i + 1) / totalItems) * 100)
        syncMessage.value = `正在同步: ${item.type || '数据'} (${i + 1}/${totalItems})`

        // 添加延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error) {
        console.error('同步项目失败:', error)
        errorCount++

        // 如果是网络错误，暂停同步
        if (error.name === 'NetworkError' || error.message.includes('network')) {
          syncMessage.value = '网络错误，暂停同步...'
          syncStatus.value = 'exception'
          break
        }
      }
    }

    // 更新同步详情
    syncDetails.value = {
      total: totalItems,
      successed: successCount,
      failed: errorCount
    }

    // 完成同步
    if (successCount === totalItems) {
      syncMessage.value = '所有数据同步成功'
      syncStatus.value = 'success'

      // 清空已同步的数据
      offlineQueue.value = []
      saveOfflineQueue()

      // 更新最后同步时间
      lastSyncTime.value = new Date()
      localStorage.setItem('lastSyncTime', lastSyncTime.value.toISOString())

      ElMessage.success(`成功同步 ${successCount} 条数据`)

      // 3秒后关闭进度对话框
      setTimeout(() => {
        showSyncProgress.value = false
      }, 3000)

    } else if (errorCount > 0) {
      syncMessage.value = `部分数据同步失败 (${successCount} 成功, ${errorCount} 失败)`
      syncStatus.value = 'warning'

      // 只保留同步失败的项目
      const failedItems = offlineQueue.value.slice(totalItems - errorCount)
      offlineQueue.value = failedItems
      saveOfflineQueue()

      ElMessage.warning(`部分数据同步失败，${errorCount} 条数据保留在离线队列中`)
    }

  } catch (error) {
    console.error('同步过程发生错误:', error)
    syncMessage.value = '同步过程发生错误: ' + error.message
    syncStatus.value = 'exception'
    ElMessage.error('数据同步失败')
  } finally {
    syncing.value = false
  }
}

const syncItem = async (item) => {
  // 根据不同的数据类型执行相应的同步逻辑
  switch (item.type) {
    case 'writing':
      return syncWritingData(item.data)
    case 'assessment':
      return syncAssessmentData(item.data)
    case 'settings':
      return syncSettingsData(item.data)
    default:
      return syncGenericData(item.data)
  }
}

const syncWritingData = async (data) => {
  const response = await fetch('/api/writing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })

  if (!response.ok) {
    throw new Error(`同步写作数据失败: ${response.statusText}`)
  }

  return response.json()
}

const syncAssessmentData = async (data) => {
  const response = await fetch('/api/assessment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })

  if (!response.ok) {
    throw new Error(`同步评估数据失败: ${response.statusText}`)
  }

  return response.json()
}

const syncSettingsData = async (data) => {
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })

  if (!response.ok) {
    throw new Error(`同步设置数据失败: ${response.statusText}`)
  }

  return response.json()
}

const syncGenericData = async (data) => {
  // 通用数据同步逻辑
  const { url, method = 'POST', payload } = data

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    throw new Error(`同步数据失败: ${response.statusText}`)
  }

  return response.json()
}

const clearOfflineData = async () => {
  try {
    await ElMessageBox.confirm('确定要清空所有离线数据吗？此操作不可撤销。', '确认清空', {
      type: 'warning'
    })

    offlineQueue.value = []
    saveOfflineQueue()

    ElMessage.success('离线数据已清空')
  } catch (error) {
    // 用户取消
  }
}

const getStatusTagType = () => {
  if (!isOnline.value) return 'danger'
  if (connectionType.value === 'slow-2g' || connectionType.value === '2g') return 'warning'
  return 'success'
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleString()
}

// 暴露方法给父组件
defineExpose({
  addToOfflineQueue,
  syncOfflineData,
  isOnline,
  offlineQueue
})
</script>

<style scoped>
.network-status {
  position: relative;
}

.network-indicator {
  position: fixed;
  top: 20px;
  right: 20px;
  background: white;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px 15px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  transition: all 0.3s ease;
}

.network-indicator.network-online {
  border-color: #67C23A;
  color: #67C23A;
}

.network-indicator.network-slow {
  border-color: #E6A23C;
  color: #E6A23C;
}

.network-indicator.network-offline {
  border-color: #F56C6C;
  color: #F56C6C;
}

.network-details {
  padding: 20px 0;
}

.network-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.sync-progress {
  text-align: center;
}

.sync-info {
  margin-top: 20px;
}

.sync-info p {
  margin: 8px 0;
  color: #606266;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .network-indicator {
    top: 10px;
    right: 10px;
    left: 10px;
    justify-content: center;
  }

  .network-actions {
    flex-direction: column;
  }
}
</style>