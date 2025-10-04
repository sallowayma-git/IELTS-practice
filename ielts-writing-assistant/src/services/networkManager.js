/**
 * 网络配置管理服务
 * 处理网络配置、请求重试、缓存策略等
 */

import offlineManager from './offlineManager'

class NetworkManager {
  constructor() {
    this.config = {
      retryAttempts: 3,
      retryDelay: 1000,
      timeout: 10000,
      cacheTimeout: 300000, // 5分钟缓存
      enableOfflineMode: true,
      enableSmartRetry: true,
      enableCompression: true
    }

    this.cache = new Map()
    this.requestQueue = []
    this.isProcessingQueue = false
    this.listeners = new Map()

    this.initializeNetworkConfig()
  }

  /**
   * 初始化网络配置
   */
  async initializeNetworkConfig() {
    try {
      // 从本地存储加载配置
      const savedConfig = localStorage.getItem('networkConfig')
      if (savedConfig) {
        this.config = { ...this.config, ...JSON.parse(savedConfig) }
      }

      // 检测网络质量
      await this.detectNetworkQuality()

      // 设置网络状态监听
      this.setupNetworkListeners()

      console.log('网络管理器初始化完成')
    } catch (error) {
      console.error('网络管理器初始化失败:', error)
    }
  }

  /**
   * 检测网络质量
   */
  async detectNetworkQuality() {
    try {
      const startTime = Date.now()

      // 发送小请求测试延迟
      const response = await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-cache'
      })

      const latency = Date.now() - startTime

      // 获取网络连接信息
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection

      const networkQuality = {
        latency,
        effectiveType: connection?.effectiveType || 'unknown',
        downlink: connection?.downlink || null,
        rtt: connection?.rtt || null,
        saveData: connection?.saveData || false,
        online: navigator.onLine,
        timestamp: new Date().toISOString()
      }

      this.updateNetworkQuality(networkQuality)

      return networkQuality
    } catch (error) {
      console.error('网络质量检测失败:', error)
      return {
        latency: Infinity,
        effectiveType: 'unknown',
        online: navigator.onLine,
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * 更新网络质量信息
   */
  updateNetworkQuality(quality) {
    this.networkQuality = quality

    // 根据网络质量调整配置
    this.adaptToNetworkQuality(quality)

    this.emit('networkQualityChanged', quality)
  }

  /**
   * 根据网络质量调整配置
   */
  adaptToNetworkQuality(quality) {
    const { latency, effectiveType, saveData } = quality

    // 慢速网络时调整重试策略
    if (latency > 2000 || effectiveType === 'slow-2g' || effectiveType === '2g') {
      this.config.retryAttempts = 5
      this.config.retryDelay = 2000
      this.config.timeout = 15000
    } else if (latency > 1000 || effectiveType === '3g') {
      this.config.retryAttempts = 3
      this.config.retryDelay = 1500
      this.config.timeout = 12000
    } else {
      this.config.retryAttempts = 3
      this.config.retryDelay = 1000
      this.config.timeout = 10000
    }

    // 节省数据模式时禁用某些功能
    if (saveData) {
      this.config.enableCompression = true
      this.config.cacheTimeout = 600000 // 增加缓存时间到10分钟
    }

    this.saveConfig()
  }

  /**
   * 设置网络状态监听
   */
  setupNetworkListeners() {
    window.addEventListener('online', () => {
      this.handleNetworkChange('online')
    })

    window.addEventListener('offline', () => {
      this.handleNetworkChange('offline')
    })

    if (navigator.connection) {
      navigator.connection.addEventListener('change', () => {
        this.detectNetworkQuality()
      })
    }
  }

  /**
   * 处理网络状态变化
   */
  handleNetworkChange(status) {
    this.emit('networkStatusChanged', { status, online: status === 'online' })

    if (status === 'online') {
      // 网络恢复时处理队列中的请求
      this.processRequestQueue()
    }
  }

  /**
   * 发送HTTP请求
   */
  async request(url, options = {}) {
    const requestId = this.generateRequestId()
    const startTime = Date.now()

    try {
      // 检查缓存
      if (options.cache !== false && this.shouldUseCache(url, options)) {
        const cached = this.getCachedResponse(url)
        if (cached) {
          this.emit('requestCompleted', { requestId, url, cached: true, duration: Date.now() - startTime })
          return cached
        }
      }

      // 检查网络状态
      if (!navigator.onLine) {
        if (this.config.enableOfflineMode) {
          return this.handleOfflineRequest(url, options, requestId)
        } else {
          throw new Error('网络不可用')
        }
      }

      // 发送请求
      const response = await this.fetchWithRetry(url, options)
      const data = await this.parseResponse(response)

      // 缓存响应
      if (this.shouldCacheResponse(url, options, response)) {
        this.setCachedResponse(url, data)
      }

      this.emit('requestCompleted', {
        requestId,
        url,
        status: response.status,
        duration: Date.now() - startTime
      })

      return data
    } catch (error) {
      this.emit('requestFailed', {
        requestId,
        url,
        error: error.message,
        duration: Date.now() - startTime
      })

      // 离线模式处理
      if (this.config.enableOfflineMode && this.shouldRetryOffline(error)) {
        return this.handleOfflineRequest(url, options, requestId)
      }

      throw error
    }
  }

  /**
   * 带重试的fetch请求
   */
  async fetchWithRetry(url, options = {}) {
    let lastError

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

        const fetchOptions = {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          }
        }

        // 添加压缩支持
        if (this.config.enableCompression) {
          fetchOptions.headers['Accept-Encoding'] = 'gzip, deflate'
        }

        const response = await fetch(url, fetchOptions)
        clearTimeout(timeoutId)

        if (response.ok) {
          return response
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
      } catch (error) {
        lastError = error

        // 如果是最后一次尝试，直接抛出错误
        if (attempt === this.config.retryAttempts - 1) {
          throw error
        }

        // 网络错误时等待后重试
        if (this.shouldRetry(error)) {
          const delay = this.calculateRetryDelay(attempt)
          await this.sleep(delay)
        } else {
          throw error
        }
      }
    }

    throw lastError
  }

  /**
   * 解析响应数据
   */
  async parseResponse(response) {
    const contentType = response.headers.get('content-type')

    if (contentType && contentType.includes('application/json')) {
      return await response.json()
    } else if (contentType && contentType.includes('text/')) {
      return await response.text()
    } else {
      return await response.blob()
    }
  }

  /**
   * 处理离线请求
   */
  async handleOfflineRequest(url, options, requestId) {
    // 对于GET请求，尝试返回缓存数据
    if (!options.method || options.method === 'GET') {
      const cached = this.getCachedResponse(url, true) // 强制使用缓存
      if (cached) {
        this.emit('offlineFallback', { requestId, url, fallback: 'cache' })
        return cached
      }
    }

    // 对于写操作，添加到离线队列
    if (this.shouldQueueForSync(options)) {
      const queueItem = {
        type: this.getQueueItemType(url, options),
        url,
        options,
        timestamp: new Date().toISOString()
      }

      offlineManager.addToSyncQueue(queueItem)
      this.emit('offlineFallback', { requestId, url, fallback: 'queued' })

      // 返回模拟响应
      return this.createOfflineResponse(queueItem)
    }

    throw new Error('离线模式下无法完成此请求')
  }

  /**
   * 检查是否应该使用缓存
   */
  shouldUseCache(url, options) {
    // 只有GET请求使用缓存
    if (options.method && options.method !== 'GET') {
      return false
    }

    // 检查URL是否在缓存白名单中
    const cacheWhitelist = ['/api/topics', '/api/history', '/api/settings']
    return cacheWhitelist.some(path => url.includes(path))
  }

  /**
   * 检查是否应该缓存响应
   */
  shouldCacheResponse(url, options, response) {
    // 只缓存成功的GET请求
    if (response.status !== 200) return false
    if (options.method && options.method !== 'GET') return false

    return this.shouldUseCache(url, options)
  }

  /**
   * 获取缓存响应
   */
  getCachedResponse(url, force = false) {
    const cached = this.cache.get(url)
    if (!cached) return null

    // 检查缓存是否过期
    if (!force && Date.now() - cached.timestamp > this.config.cacheTimeout) {
      this.cache.delete(url)
      return null
    }

    return cached.data
  }

  /**
   * 设置缓存响应
   */
  setCachedResponse(url, data) {
    this.cache.set(url, {
      data,
      timestamp: Date.now()
    })

    // 限制缓存大小
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value
      this.cache.delete(oldestKey)
    }
  }

  /**
   * 检查是否应该重试
   */
  shouldRetry(error) {
    if (error.name === 'AbortError') return false
    if (error.message.includes('HTTP 4')) return false // 4xx错误不重试
    return this.config.enableSmartRetry
  }

  /**
   * 检查是否应该在离线时重试
   */
  shouldRetryOffline(error) {
    return error.name === 'TypeError' ||
           error.message.includes('network') ||
           error.message.includes('fetch')
  }

  /**
   * 检查是否应该加入同步队列
   */
  shouldQueueForSync(options) {
    const method = options.method || 'GET'
    const queueableMethods = ['POST', 'PUT', 'DELETE']
    return queueableMethods.includes(method)
  }

  /**
   * 获取队列项目类型
   */
  getQueueItemType(url, options) {
    if (url.includes('/writing')) return 'writing'
    if (url.includes('/assessment')) return 'assessment'
    if (url.includes('/settings')) return 'settings'
    return 'generic'
  }

  /**
   * 创建离线响应
   */
  createOfflineResponse(queueItem) {
    return {
      success: true,
      offline: true,
      message: '数据已保存到离线队列，将在联网后自动同步',
      queueId: queueItem.id,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * 计算重试延迟
   */
  calculateRetryDelay(attempt) {
    // 指数退避算法
    const baseDelay = this.config.retryDelay
    const maxDelay = 10000 // 最大10秒
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)

    // 添加随机抖动避免雷群效应
    const jitter = Math.random() * 1000
    return delay + jitter
  }

  /**
   * 处理请求队列
   */
  async processRequestQueue() {
    if (this.isProcessingQueue) return

    this.isProcessingQueue = true
    this.emit('queueProcessingStarted')

    try {
      const queue = offlineManager.getSyncQueue()
      let processed = 0
      let failed = 0

      for (const item of queue) {
        try {
          await this.request(item.url, item.options)
          offlineManager.removeFromSyncQueue(item.id)
          processed++
        } catch (error) {
          console.error('同步队列项目失败:', error)

          // 增加重试次数
          offlineManager.incrementRetryCount(item.id)

          // 如果超过最大重试次数，从队列中移除
          if (item.retryCount >= item.maxRetries) {
            offlineManager.removeFromSyncQueue(item.id)
            failed++
          }
        }

        // 避免请求过快
        await this.sleep(100)
      }

      this.emit('queueProcessingCompleted', { processed, failed })
    } catch (error) {
      console.error('处理请求队列失败:', error)
      this.emit('queueProcessingFailed', error)
    } finally {
      this.isProcessingQueue = false
    }
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.cache.clear()
    this.emit('cacheCleared')
  }

  /**
   * 获取网络统计信息
   */
  getNetworkStats() {
    const cacheSize = Array.from(this.cache.values())
      .reduce((total, item) => total + JSON.stringify(item.data).length, 0)

    return {
      networkQuality: this.networkQuality,
      config: this.config,
      cacheSize,
      cacheItems: this.cache.size,
      queueSize: offlineManager.getSyncQueue().length,
      isProcessingQueue: this.isProcessingQueue
    }
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig }
    this.saveConfig()
    this.emit('configUpdated', this.config)
  }

  /**
   * 保存配置到本地存储
   */
  saveConfig() {
    try {
      localStorage.setItem('networkConfig', JSON.stringify(this.config))
    } catch (error) {
      console.error('保存网络配置失败:', error)
    }
  }

  /**
   * 生成请求ID
   */
  generateRequestId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  /**
   * 睡眠函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
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
          console.error(`网络管理器事件回调执行失败 (${event}):`, error)
        }
      })
    }
  }
}

// 创建全局实例
const networkManager = new NetworkManager()

export default networkManager