/**
 * Legacy系统事件桥接服务
 * 管理Legacy应用与主应用之间的会话和事件通信
 */

const EventEmitter = require('events')

class LegacyEventBridge extends EventEmitter {
  constructor(legacyService) {
    super()
    this.legacyService = legacyService
    this.sessions = new Map() // 会话管理
    this.eventQueue = new Map() // 事件队列
    this.interceptors = new Map() // 事件拦截器
    this.handlers = new Map() // 事件处理器
    this.isConnected = false
    this.retryAttempts = 0
    this.maxRetries = 5
    this.heartbeatInterval = null

    // 会话配置
    this.sessionConfig = {
      timeout: 30000, // 30秒超时
      heartbeatInterval: 5000, // 5秒心跳
      maxQueueSize: 100, // 最大队列大小
      persistence: true // 是否持久化会话
    }
  }

  /**
   * 初始化事件桥接
   */
  async initialize() {
    try {
      // 设置事件监听器
      this.setupEventListeners()

      // 启动心跳检测
      this.startHeartbeat()

      // 恢复持久化会话
      if (this.sessionConfig.persistence) {
        await this.restoreSessions()
      }

      this.isConnected = true
      console.log('✅ Legacy事件桥接初始化完成')

      return true
    } catch (error) {
      console.error('❌ Legacy事件桥接初始化失败:', error)
      return false
    }
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 监听Legacy服务事件
    this.legacyService.addEventListener('legacy-app-ready', (data) => {
      this.handleLegacyAppReady(data)
    })

    this.legacyService.addEventListener('browserView-finish-load', (data) => {
      this.handleBrowserViewLoad(data)
    })

    this.legacyService.addEventListener('browserView-dom-ready', (data) => {
      this.handleBrowserViewReady(data)
    })

    // 监听IPC消息
    if (process.type === 'browser') {
      this.setupIpcListeners()
    }
  }

  /**
   * 设置IPC监听器（主进程）
   */
  setupIpcListeners() {
    const { ipcMain } = require('electron')

    // Legacy会话管理
    ipcMain.handle('legacy:session-create', async (event, options) => {
      return this.createSession(options)
    })

    ipcMain.handle('legacy:session-destroy', async (event, sessionId) => {
      return this.destroySession(sessionId)
    })

    ipcMain.handle('legacy:session-get', async (event, sessionId) => {
      return this.getSession(sessionId)
    })

    ipcMain.handle('legacy:session-list', async () => {
      return this.getAllSessions()
    })

    // 事件发送
    ipcMain.handle('legacy:event-send', async (event, sessionId, eventName, data) => {
      return this.sendEventToLegacy(sessionId, eventName, data)
    })

    ipcMain.handle('legacy:event-broadcast', async (event, eventName, data) => {
      return this.broadcastEvent(eventName, data)
    })

    // 事件订阅
    ipcMain.handle('legacy:event-subscribe', async (event, sessionId, eventName) => {
      return this.subscribeToEvent(sessionId, eventName, event.sender.id)
    })

    ipcMain.handle('legacy:event-unsubscribe', async (event, sessionId, eventName) => {
      return this.unsubscribeFromEvent(sessionId, eventName, event.sender.id)
    })

    // 命令执行
    ipcMain.handle('legacy:command-execute', async (event, sessionId, command) => {
      return this.executeCommand(sessionId, command)
    })

    // 数据同步
    ipcMain.handle('legacy:sync-data', async (event, sessionId, data) => {
      return this.syncData(sessionId, data)
    })
  }

  /**
   * 创建会话
   */
  async createSession(options = {}) {
    const sessionId = options.sessionId || this.generateSessionId()
    const viewId = options.viewId || this.legacyService.activeView

    if (!viewId) {
      throw new Error('没有活跃的BrowserView')
    }

    const session = {
      id: sessionId,
      viewId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'active',
      userId: options.userId || 'anonymous',
      module: options.module || 'unknown',
      events: new Set(),
      subscribers: new Map(),
      data: new Map(),
      queue: [],
      config: { ...this.sessionConfig, ...options.config }
    }

    this.sessions.set(sessionId, session)

    // 创建事件队列
    this.eventQueue.set(sessionId, [])

    console.log(`📱 Legacy会话创建: ${sessionId} (View: ${viewId})`)
    this.emit('session-created', { sessionId, session })

    // 持久化会话
    if (session.config.persistence) {
      await this.persistSession(sessionId)
    }

    return sessionId
  }

  /**
   * 销毁会话
   */
  async destroySession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }

    // 清理事件队列
    this.eventQueue.delete(sessionId)

    // 通知所有订阅者
    session.subscribers.forEach((subscribers, eventName) => {
      subscribers.forEach(subscriberId => {
        this.notifySubscriber(subscriberId, 'session-destroyed', {
          sessionId,
          reason: 'destroyed'
        })
      })
    })

    // 删除会话
    this.sessions.delete(sessionId)

    console.log(`🗑️ Legacy会话销毁: ${sessionId}`)
    this.emit('session-destroyed', { sessionId })

    // 清理持久化数据
    if (session.config.persistence) {
      await this.removePersistedSession(sessionId)
    }

    return true
  }

  /**
   * 获取会话
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return null
    }

    // 更新活动时间
    session.lastActivity = Date.now()

    return {
      id: session.id,
      viewId: session.viewId,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      status: session.status,
      userId: session.userId,
      module: session.module,
      events: Array.from(session.events),
      subscriberCount: Array.from(session.subscribers.values())
        .reduce((total, subs) => total + subs.size, 0),
      queueSize: session.queue.length,
      config: session.config
    }
  }

  /**
   * 获取所有会话
   */
  getAllSessions() {
    return Array.from(this.sessions.keys()).map(sessionId =>
      this.getSession(sessionId)
    ).filter(Boolean)
  }

  /**
   * 处理Legacy应用就绪
   */
  async handleLegacyAppReady(data) {
    const { viewId } = data

    // 为就绪的BrowserView创建会话
    const sessionId = await this.createSession({
      viewId,
      module: 'main'
    })

    // 发送初始化命令
    await this.sendEventToLegacy(sessionId, 'app:initialized', {
      sessionId,
      timestamp: Date.now(),
      config: {
        apiEndpoint: '/api/legacy',
        features: {
          events: true,
          storage: true,
          sync: true
        }
      }
    })

    console.log(`🎯 Legacy应用就绪，会话已创建: ${sessionId}`)
  }

  /**
   * 处理BrowserView加载完成
   */
  handleBrowserViewLoad(data) {
    const { viewId } = data
    this.emit('browser-view-loaded', { viewId })
  }

  /**
   * 处理BrowserView DOM就绪
   */
  handleBrowserViewReady(data) {
    const { viewId } = data

    // 注入事件桥接脚本
    this.injectEventBridgeScript(viewId)

    this.emit('browser-view-ready', { viewId })
  }

  /**
   * 注入事件桥接脚本
   */
  async injectEventBridgeScript(viewId) {
    const script = `
      (function() {
        'use strict';

        // 创建事件桥接对象
        window.legacyEventBridge = {
          sessionId: null,
          isConnected: false,
          eventQueue: [],

          // 初始化桥接
          initialize: function(sessionId) {
            this.sessionId = sessionId;
            this.isConnected = true;

            // 设置消息监听器
            window.addEventListener('message', this.handleMessage.bind(this));

            // 发送就绪事件
            this.sendEvent('bridge:ready', {
              sessionId: sessionId,
              timestamp: Date.now()
            });

            console.log('Legacy事件桥接已初始化:', sessionId);
          },

          // 发送事件
          sendEvent: function(eventName, data) {
            const event = {
              type: eventName,
              data: data,
              sessionId: this.sessionId,
              timestamp: Date.now(),
              source: 'legacy-app'
            };

            if (window.electronAPI && window.electronAPI.legacy) {
              window.electronAPI.legacy.send('legacy:event', event);
            } else {
              // Web环境使用postMessage
              window.parent.postMessage(event, '*');
            }
          },

          // 处理消息
          handleMessage: function(event) {
            if (event.data.source !== 'main-app') return;

            const { type, data } = event.data;

            switch (type) {
              case 'event':
                this.handleIncomingEvent(data);
                break;
              case 'command':
                this.handleCommand(data);
                break;
            }
          },

          // 处理传入事件
          handleIncomingEvent: function(eventData) {
            if (window.legacyApp && window.legacyApp.eventManager) {
              window.legacyApp.eventManager.emit(eventData.event, eventData.data);
            }

            // 触发自定义事件
            const customEvent = new CustomEvent(eventData.event, {
              detail: eventData.data
            });
            document.dispatchEvent(customEvent);
          },

          // 处理命令
          handleCommand: function(commandData) {
            if (window.legacyApp && window.legacyApp.commandHandler) {
              window.legacyApp.commandHandler.handle(commandData);
            }
          },

          // 订阅事件
          subscribe: function(eventName, callback) {
            document.addEventListener(eventName, function(event) {
              callback(event.detail);
            });
          },

          // 断开连接
          disconnect: function() {
            this.isConnected = false;
            this.sendEvent('bridge:disconnected', {
              sessionId: this.sessionId,
              timestamp: Date.now()
            });
          }
        };

        // 自动初始化（如果有会话ID）
        if (window.LEGACY_SESSION_ID) {
          window.legacyEventBridge.initialize(window.LEGACY_SESSION_ID);
        }
      })();
    `

    try {
      await this.legacyService.executeJavaScript(viewId, script)
      console.log(`💉 事件桥接脚本注入成功: ${viewId}`)
    } catch (error) {
      console.error(`❌ 事件桥接脚本注入失败: ${viewId}`, error)
    }
  }

  /**
   * 发送事件到Legacy应用
   */
  async sendEventToLegacy(sessionId, eventName, data) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`)
    }

    const event = {
      id: this.generateEventId(),
      eventName,
      data,
      sessionId,
      timestamp: Date.now(),
      source: 'main-app'
    }

    try {
      // 检查是否有拦截器
      if (this.interceptors.has(eventName)) {
        const interceptors = this.interceptors.get(eventName)
        for (const interceptor of interceptors) {
          const result = await interceptor(event)
          if (result === false) {
            return false // 拦截事件
          }
          if (result && typeof result === 'object') {
            event.data = result.data || event.data
          }
        }
      }

      // 发送到Legacy应用
      const success = await this.legacyService.sendMessageToLegacy(session.viewId, {
        type: 'event',
        data: event
      })

      if (success) {
        // 更新会话活动时间
        session.lastActivity = Date.now()

        // 记录事件
        session.events.add(event.id)

        console.log(`📤 事件发送到Legacy: ${eventName} (${sessionId})`)
        this.emit('event-sent', { sessionId, event })
      }

      return success
    } catch (error) {
      console.error(`❌ 事件发送失败: ${eventName}`, error)

      // 添加到重试队列
      this.addToRetryQueue(sessionId, event)

      return false
    }
  }

  /**
   * 广播事件到所有会话
   */
  async broadcastEvent(eventName, data) {
    const promises = []

    for (const sessionId of this.sessions.keys()) {
      promises.push(this.sendEventToLegacy(sessionId, eventName, data))
    }

    const results = await Promise.allSettled(promises)
    const successful = results.filter(result => result.status === 'fulfilled' && result.value).length

    console.log(`📻 事件广播完成: ${eventName} (成功: ${successful}/${results.length})`)

    return successful
  }

  /**
   * 订阅事件
   */
  subscribeToEvent(sessionId, eventName, subscriberId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`)
    }

    if (!session.subscribers.has(eventName)) {
      session.subscribers.set(eventName, new Set())
    }

    session.subscribers.get(eventName).add(subscriberId)

    console.log(`👂 事件订阅: ${eventName} (${sessionId}, ${subscriberId})`)

    return true
  }

  /**
   * 取消订阅事件
   */
  unsubscribeFromEvent(sessionId, eventName, subscriberId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }

    const subscribers = session.subscribers.get(eventName)
    if (subscribers) {
      subscribers.delete(subscriberId)

      if (subscribers.size === 0) {
        session.subscribers.delete(eventName)
      }
    }

    console.log(`🔇 取消事件订阅: ${eventName} (${sessionId}, ${subscriberId})`)

    return true
  }

  /**
   * 执行命令
   */
  async executeCommand(sessionId, command) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`)
    }

    const enhancedCommand = {
      ...command,
      id: this.generateCommandId(),
      sessionId,
      timestamp: Date.now(),
      source: 'main-app'
    }

    try {
      const success = await this.legacyService.sendMessageToLegacy(session.viewId, {
        type: 'command',
        data: enhancedCommand
      })

      if (success) {
        session.lastActivity = Date.now()
        console.log(`⚡ 命令执行: ${command.type} (${sessionId})`)
      }

      return success
    } catch (error) {
      console.error(`❌ 命令执行失败: ${command.type}`, error)
      return false
    }
  }

  /**
   * 数据同步
   */
  async syncData(sessionId, data) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`)
    }

    // 存储数据
    session.data.set(data.key, {
      value: data.value,
      timestamp: Date.now(),
      synced: true
    })

    // 发送同步事件
    await this.sendEventToLegacy(sessionId, 'data:sync', {
      key: data.key,
      value: data.value,
      timestamp: Date.now()
    })

    console.log(`🔄 数据同步: ${data.key} (${sessionId})`)

    return true
  }

  /**
   * 添加事件拦截器
   */
  addEventInterceptor(eventName, interceptor) {
    if (!this.interceptors.has(eventName)) {
      this.interceptors.set(eventName, new Set())
    }
    this.interceptors.get(eventName).add(interceptor)
  }

  /**
   * 移除事件拦截器
   */
  removeEventInterceptor(eventName, interceptor) {
    const interceptors = this.interceptors.get(eventName)
    if (interceptors) {
      interceptors.delete(interceptor)
      if (interceptors.size === 0) {
        this.interceptors.delete(eventName)
      }
    }
  }

  /**
   * 添加到重试队列
   */
  addToRetryQueue(sessionId, event) {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.queue.push(event)

    // 限制队列大小
    if (session.queue.length > session.config.maxQueueSize) {
      session.queue.shift()
    }
  }

  /**
   * 处理重试队列
   */
  async processRetryQueue(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session || session.queue.length === 0) return

    const events = [...session.queue]
    session.queue = []

    for (const event of events) {
      try {
        await this.sendEventToLegacy(sessionId, event.eventName, event.data)
      } catch (error) {
        console.error(`重试事件发送失败: ${event.eventName}`, error)
      }
    }
  }

  /**
   * 启动心跳检测
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      await this.checkSessionHealth()
    }, this.sessionConfig.heartbeatInterval)
  }

  /**
   * 检查会话健康状态
   */
  async checkSessionHealth() {
    const now = Date.now()
    const timeout = this.sessionConfig.timeout
    const expiredSessions = []

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > timeout) {
        expiredSessions.push(sessionId)
      }
    }

    // 清理过期会话
    for (const sessionId of expiredSessions) {
      console.log(`⏰ 会话超时，自动清理: ${sessionId}`)
      await this.destroySession(sessionId)
    }

    // 处理重试队列
    for (const sessionId of this.sessions.keys()) {
      await this.processRetryQueue(sessionId)
    }
  }

  /**
   * 持久化会话
   */
  async persistSession(sessionId) {
    // 这里可以实现会话的持久化存储
    // 例如保存到文件或数据库
  }

  /**
   * 恢复会话
   */
  async restoreSessions() {
    // 这里可以实现会话的恢复逻辑
    // 例如从文件或数据库加载会话
  }

  /**
   * 移除持久化会话
   */
  async removePersistedSession(sessionId) {
    // 这里可以实现持久化会话的删除
  }

  /**
   * 通知订阅者
   */
  notifySubscriber(subscriberId, eventName, data) {
    // 发送通知给渲染进程
    if (process.type === 'browser') {
      const { BrowserWindow } = require('electron')
      const windows = BrowserWindow.getAllWindows()

      windows.forEach(window => {
        window.webContents.send('legacy:notification', {
          subscriberId,
          eventName,
          data,
          timestamp: Date.now()
        })
      })
    }
  }

  /**
   * 生成会话ID
   */
  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 生成事件ID
   */
  generateEventId() {
    return `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 生成命令ID
   */
  generateCommandId() {
    return `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const activeSessions = this.sessions.size
    const totalSubscribers = Array.from(this.sessions.values())
      .reduce((total, session) => {
        return total + Array.from(session.subscribers.values())
          .reduce((subTotal, subs) => subTotal + subs.size, 0)
      }, 0)

    const queuedEvents = Array.from(this.sessions.values())
      .reduce((total, session) => total + session.queue.length, 0)

    return {
      isConnected: this.isConnected,
      activeSessions,
      totalSubscribers,
      queuedEvents,
      retryAttempts: this.retryAttempts,
      uptime: process.uptime()
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 停止心跳
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    // 销毁所有会话
    const sessionIds = Array.from(this.sessions.keys())
    for (const sessionId of sessionIds) {
      this.destroySession(sessionId)
    }

    // 清理拦截器
    this.interceptors.clear()

    // 移除所有监听器
    this.removeAllListeners()

    this.isConnected = false
    console.log('🧹 Legacy事件桥接资源清理完成')
  }
}

module.exports = LegacyEventBridge