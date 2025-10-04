/**
 * 离线数据管理服务
 * 处理离线状态下的数据存储、同步和管理
 */

class OfflineManager {
  constructor() {
    this.storageKey = 'offlineData'
    this.queueKey = 'syncQueue'
    this.maxStorageSize = 50 * 1024 * 1024 // 50MB 最大存储限制
    this.maxQueueSize = 1000 // 最大队列项目数
    this.listeners = new Map()

    this.initializeStorage()
  }

  /**
   * 初始化离线存储
   */
  initializeStorage() {
    try {
      // 检查localStorage可用性
      const testKey = '__storage_test__'
      localStorage.setItem(testKey, 'test')
      localStorage.removeItem(testKey)

      // 初始化同步队列
      if (!localStorage.getItem(this.queueKey)) {
        localStorage.setItem(this.queueKey, JSON.stringify([]))
      }

      console.log('离线存储初始化成功')
    } catch (error) {
      console.error('离线存储初始化失败:', error)
      this.handleStorageError(error)
    }
  }

  /**
   * 添加数据到离线存储
   */
  async addToStorage(key, data, metadata = {}) {
    try {
      const storageItem = {
        key,
        data,
        metadata: {
          timestamp: new Date().toISOString(),
          size: this.getDataSize(data),
          ...metadata
        }
      }

      // 检查存储空间
      if (!this.checkStorageSpace(storageItem.size)) {
        this.cleanupOldData()
      }

      const offlineData = this.getOfflineStorage()
      offlineData[key] = storageItem

      localStorage.setItem(this.storageKey, JSON.stringify(offlineData))

      this.emit('dataAdded', { key, data, metadata })

      return true
    } catch (error) {
      console.error('添加离线数据失败:', error)
      this.handleStorageError(error)
      return false
    }
  }

  /**
   * 从离线存储获取数据
   */
  getFromStorage(key) {
    try {
      const offlineData = this.getOfflineStorage()
      return offlineData[key] || null
    } catch (error) {
      console.error('获取离线数据失败:', error)
      return null
    }
  }

  /**
   * 删除离线存储中的数据
   */
  removeFromStorage(key) {
    try {
      const offlineData = this.getOfflineStorage()
      delete offlineData[key]
      localStorage.setItem(this.storageKey, JSON.stringify(offlineData))

      this.emit('dataRemoved', { key })

      return true
    } catch (error) {
      console.error('删除离线数据失败:', error)
      return false
    }
  }

  /**
   * 添加项目到同步队列
   */
  addToSyncQueue(item) {
    try {
      const queueItem = {
        id: Date.now() + Math.random(),
        timestamp: new Date().toISOString(),
        retryCount: 0,
        maxRetries: 3,
        ...item
      }

      const queue = this.getSyncQueue()

      // 检查队列大小
      if (queue.length >= this.maxQueueSize) {
        // 移除最旧的项目
        queue.shift()
      }

      queue.push(queueItem)
      localStorage.setItem(this.queueKey, JSON.stringify(queue))

      this.emit('queueItemAdded', queueItem)

      return queueItem.id
    } catch (error) {
      console.error('添加同步队列项目失败:', error)
      return null
    }
  }

  /**
   * 获取同步队列
   */
  getSyncQueue() {
    try {
      const queue = localStorage.getItem(this.queueKey)
      return queue ? JSON.parse(queue) : []
    } catch (error) {
      console.error('获取同步队列失败:', error)
      return []
    }
  }

  /**
   * 从同步队列移除项目
   */
  removeFromSyncQueue(itemId) {
    try {
      const queue = this.getSyncQueue()
      const filteredQueue = queue.filter(item => item.id !== itemId)
      localStorage.setItem(this.queueKey, JSON.stringify(filteredQueue))

      this.emit('queueItemRemoved', { itemId })

      return true
    } catch (error) {
      console.error('移除同步队列项目失败:', error)
      return false
    }
  }

  /**
   * 更新同步队列项目
   */
  updateQueueItem(itemId, updates) {
    try {
      const queue = this.getSyncQueue()
      const itemIndex = queue.findIndex(item => item.id === itemId)

      if (itemIndex !== -1) {
        queue[itemIndex] = { ...queue[itemIndex], ...updates }
        localStorage.setItem(this.queueKey, JSON.stringify(queue))

        this.emit('queueItemUpdated', { itemId, updates })

        return true
      }

      return false
    } catch (error) {
      console.error('更新同步队列项目失败:', error)
      return false
    }
  }

  /**
   * 增加重试次数
   */
  incrementRetryCount(itemId) {
    return this.updateQueueItem(itemId, {
      retryCount: (this.getQueueItem(itemId)?.retryCount || 0) + 1,
      lastRetry: new Date().toISOString()
    })
  }

  /**
   * 获取队列项目
   */
  getQueueItem(itemId) {
    const queue = this.getSyncQueue()
    return queue.find(item => item.id === itemId)
  }

  /**
   * 清空同步队列
   */
  clearSyncQueue() {
    try {
      localStorage.setItem(this.queueKey, JSON.stringify([]))
      this.emit('queueCleared')
      return true
    } catch (error) {
      console.error('清空同步队列失败:', error)
      return false
    }
  }

  /**
   * 获取离线存储统计信息
   */
  getStorageStats() {
    try {
      const offlineData = this.getOfflineStorage()
      const queue = this.getSyncQueue()

      const storageSize = this.getDataSize(offlineData)
      const itemCount = Object.keys(offlineData).length
      const queueSize = queue.length

      const oldestItem = queue.length > 0
        ? new Date(Math.min(...queue.map(item => new Date(item.timestamp))))
        : null

      return {
        storageSize,
        storageSizeFormatted: this.formatBytes(storageSize),
        itemCount,
        queueSize,
        oldestItem,
        maxStorageSize: this.maxStorageSize,
        maxStorageSizeFormatted: this.formatBytes(this.maxStorageSize)
      }
    } catch (error) {
      console.error('获取存储统计失败:', error)
      return null
    }
  }

  /**
   * 清理旧数据
   */
  cleanupOldData() {
    try {
      const offlineData = this.getOfflineStorage()
      const items = Object.entries(offlineData)

      // 按时间排序，移除最旧的数据
      items.sort((a, b) => new Date(a[1].metadata.timestamp) - new Date(b[1].metadata.timestamp))

      let removedSize = 0
      const itemsToRemove = []

      for (const [key, item] of items) {
        if (removedSize >= this.maxStorageSize * 0.2) { // 移除20%的空间
          break
        }
        itemsToRemove.push(key)
        removedSize += item.metadata.size
      }

      itemsToRemove.forEach(key => delete offlineData[key])

      localStorage.setItem(this.storageKey, JSON.stringify(offlineData))

      this.emit('dataCleaned', { removedItems: itemsToRemove.length, freedSpace: removedSize })

      console.log(`清理了 ${itemsToRemove.length} 个旧数据项，释放 ${this.formatBytes(removedSize)} 空间`)
    } catch (error) {
      console.error('清理旧数据失败:', error)
    }
  }

  /**
   * 清理失败的重试项目
   */
  cleanupFailedRetries() {
    try {
      const queue = this.getSyncQueue()
      const filteredQueue = queue.filter(item => item.retryCount < item.maxRetries)
      const removedCount = queue.length - filteredQueue.length

      localStorage.setItem(this.queueKey, JSON.stringify(filteredQueue))

      this.emit('queueCleaned', { removedCount })

      return removedCount
    } catch (error) {
      console.error('清理失败重试项目失败:', error)
      return 0
    }
  }

  /**
   * 导出离线数据
   */
  exportOfflineData() {
    try {
      const offlineData = this.getOfflineStorage()
      const queue = this.getSyncQueue()
      const stats = this.getStorageStats()

      const exportData = {
        exportTime: new Date().toISOString(),
        stats,
        offlineData,
        syncQueue: queue
      }

      return exportData
    } catch (error) {
      console.error('导出离线数据失败:', error)
      return null
    }
  }

  /**
   * 导入离线数据
   */
  async importOfflineData(importData) {
    try {
      const { offlineData, syncQueue } = importData

      // 备份当前数据
      const backup = {
        offlineData: this.getOfflineStorage(),
        syncQueue: this.getSyncQueue()
      }

      // 导入数据
      localStorage.setItem(this.storageKey, JSON.stringify(offlineData))
      localStorage.setItem(this.queueKey, JSON.stringify(syncQueue))

      this.emit('dataImported', importData)

      return { success: true, backup }
    } catch (error) {
      console.error('导入离线数据失败:', error)
      return { success: false, error }
    }
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  /**
   * 移除事件监听
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)
      const index = callbacks.indexOf(callback)
      if (index !== -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`事件回调执行失败 (${event}):`, error)
        }
      })
    }
  }

  /**
   * 获取离线存储数据
   */
  getOfflineStorage() {
    try {
      const data = localStorage.getItem(this.storageKey)
      return data ? JSON.parse(data) : {}
    } catch (error) {
      console.error('获取离线存储失败:', error)
      return {}
    }
  }

  /**
   * 检查存储空间
   */
  checkStorageSpace(requiredSize) {
    try {
      const currentSize = this.getDataSize(this.getOfflineStorage())
      return (currentSize + requiredSize) < this.maxStorageSize
    } catch (error) {
      return false
    }
  }

  /**
   * 获取数据大小
   */
  getDataSize(data) {
    return new Blob([JSON.stringify(data)]).size
  }

  /**
   * 格式化字节数
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes'

    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * 处理存储错误
   */
  handleStorageError(error) {
    console.error('存储错误:', error)

    if (error.name === 'QuotaExceededError') {
      this.emit('storageQuotaExceeded')
      // 尝试清理数据
      this.cleanupOldData()
    } else if (error.name === 'SecurityError') {
      this.emit('storageSecurityError')
    }
  }
}

// 创建全局实例
const offlineManager = new OfflineManager()

export default offlineManager