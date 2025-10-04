/**
 * Electron Legacy系统服务
 * 管理Legacy系统的BrowserView、通信和资源
 */

const { BrowserView, app, ipcMain, session, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const LegacyResourceManager = require('../legacy/LegacyResourceManager')

class LegacyService {
  constructor() {
    this.browserViews = new Map() // 存储多个BrowserView实例
    this.resourceManager = new LegacyResourceManager()
    this.activeView = null // 当前活跃的BrowserView
    this.isInitialized = false
    this.config = {
      defaultWidth: 1200,
      defaultHeight: 800,
      minWidth: 800,
      minHeight: 600
    }
    this.eventHandlers = new Map() // 事件处理器
    this.interceptors = new Map() // 请求拦截器
  }

  /**
   * 初始化Legacy服务
   */
  async initialize(mainWindow) {
    try {
      this.mainWindow = mainWindow

      // 初始化资源管理器
      await this.resourceManager.initialize()

      // 设置IPC监听器
      this.setupIpcHandlers()

      // 设置会话拦截器
      this.setupSessionInterceptors()

      this.isInitialized = true
      console.log('✅ Legacy服务初始化完成')

      return true
    } catch (error) {
      console.error('❌ Legacy服务初始化失败:', error)
      return false
    }
  }

  /**
   * 创建BrowserView
   */
  async createBrowserView(options = {}) {
    const viewId = options.id || this.generateViewId()

    try {
      // 合并默认配置
      const config = {
        ...this.config,
        ...options
      }

      // 创建BrowserView - preload路径在主进程中设置
      const browserView = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: path.join(__dirname, '..', 'preload', 'legacy-preload.js'),
          webSecurity: true,
          allowRunningInsecureContent: false,
          experimentalFeatures: false,
          ...config.webPreferences
        }
      })

      // 设置BrowserView大小和位置
      if (config.bounds) {
        browserView.setBounds(config.bounds)
      } else {
        const { width, height } = this.mainWindow.getBounds()
        browserView.setBounds({
          x: 0,
          y: 0,
          width: width || this.config.defaultWidth,
          height: height || this.config.defaultHeight
        })
      }

      // 添加到管理器
      this.browserViews.set(viewId, {
        view: browserView,
        config,
        createdAt: Date.now(),
        isActive: false
      })

      // 设置事件监听器
      this.setupBrowserViewEvents(viewId, browserView)

      // 加载URL
      if (config.src) {
        await browserView.webContents.loadURL(config.src)
      }

      console.log(`✅ BrowserView创建成功: ${viewId}`)
      return viewId

    } catch (error) {
      console.error(`❌ BrowserView创建失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 设置BrowserView事件监听器
   */
  setupBrowserViewEvents(viewId, browserView) {
    const webContents = browserView.webContents

    // 页面加载完成
    webContents.on('did-finish-load', () => {
      this.emitEvent('browserView-finish-load', { viewId })
      this.sendBrowserViewEvent(viewId, 'finish-load', { viewId })
      console.log(`📄 BrowserView页面加载完成: ${viewId}`)
    })

    // 页面加载失败
    webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      const eventData = {
        viewId,
        errorCode,
        errorDescription,
        url: validatedURL
      }
      this.emitEvent('browserView-fail-load', eventData)
      this.sendBrowserViewEvent(viewId, 'fail-load', eventData)
      console.error(`❌ BrowserView页面加载失败: ${viewId}, ${errorCode} - ${errorDescription}`)
    })

    // DOM准备就绪
    webContents.on('dom-ready', () => {
      const eventData = { viewId }
      this.emitEvent('browserView-dom-ready', eventData)
      this.sendBrowserViewEvent(viewId, 'dom-ready', eventData)

      // 注入CSS样式
      this.injectStyles(viewId)

      // 检查Legacy应用是否就绪
      this.checkLegacyAppReady(viewId)
    })

    // 控制台消息
    webContents.on('console-message', (event, level, message, line, sourceId) => {
      const eventData = {
        viewId,
        level: ['debug', 'info', 'warning', 'error'][level] || 'info',
        message,
        line,
        sourceId
      }
      this.emitEvent('browserView-console', eventData)
      this.sendBrowserViewEvent(viewId, 'console-message', eventData)
    })

    // 页面标题变化
    webContents.on('page-title-updated', (event, title) => {
      const eventData = { viewId, title }
      this.emitEvent('browserView-title-updated', eventData)
      this.sendBrowserViewEvent(viewId, 'title-updated', eventData)
    })

    // 导航完成
    webContents.on('did-navigate', (event, url) => {
      const eventData = { viewId, url }
      this.emitEvent('browserView-navigated', eventData)
      this.sendBrowserViewEvent(viewId, 'navigated', eventData)
    })

    // 新窗口打开
    webContents.setWindowOpenHandler(({ url }) => {
      // 在默认浏览器中打开外部链接
      if (url.startsWith('http://') || url.startsWith('https://')) {
        require('electron').shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    // 权限请求处理
    webContents.on('permission-request', (event, permission, callback) => {
      // 默认拒绝权限请求，确保安全
      callback(false)
    })
  }

  /**
   * 发送BrowserView事件到渲染进程
   */
  sendBrowserViewEvent(viewId, eventType, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(`legacy:browserview-${eventType}`, {
        viewId,
        timestamp: Date.now(),
        ...data
      })
    }
  }

  /**
   * 注入CSS样式
   */
  async injectStyles(viewId) {
    const viewData = this.browserViews.get(viewId)
    if (!viewData) return

    try {
      const cssPath = path.join(__dirname, '..', 'styles', 'legacy-injection.css')
      if (fs.existsSync(cssPath)) {
        const css = fs.readFileSync(cssPath, 'utf8')
        await viewData.view.webContents.insertCSS(css)
        console.log(`🎨 CSS样式注入成功: ${viewId}`)
      }
    } catch (error) {
      console.warn(`⚠️ CSS样式注入失败: ${viewId}`, error.message)
    }
  }

  /**
   * 检查Legacy应用是否就绪
   */
  async checkLegacyAppReady(viewId) {
    const viewData = this.browserViews.get(viewId)
    if (!viewData) return

    try {
      const isReady = await viewData.view.webContents.executeJavaScript(`
        typeof window.app !== 'undefined' &&
        typeof window.app.initialize === 'function'
      `)

      if (isReady) {
        this.emitEvent('legacy-app-ready', { viewId })
        console.log(`✅ Legacy应用就绪: ${viewId}`)
      } else {
        // 重试检查
        setTimeout(() => this.checkLegacyAppReady(viewId), 500)
      }
    } catch (error) {
      // 跨域或其他错误，忽略
      console.warn(`⚠️ Legacy应用就绪检查失败: ${viewId}`, error.message)
    }
  }

  /**
   * 激活BrowserView
   */
  async activateBrowserView(viewId) {
    const viewData = this.browserViews.get(viewId)
    if (!viewData) {
      throw new Error(`BrowserView不存在: ${viewId}`)
    }

    try {
      // 停用当前活跃的View
      if (this.activeView && this.activeView !== viewId) {
        const activeData = this.browserViews.get(this.activeView)
        if (activeData) {
          activeData.isActive = false
        }
      }

      // 激活新的View
      viewData.isActive = true
      this.activeView = viewId

      // 设置为主窗口的BrowserView
      this.mainWindow.setBrowserView(viewData.view)

      // 调整大小
      const { width, height } = this.mainWindow.getBounds()
      viewData.view.setBounds({
        x: 0,
        y: 0,
        width,
        height
      })

      this.emitEvent('browserView-activated', { viewId })
      console.log(`🎯 BrowserView激活成功: ${viewId}`)

      return true
    } catch (error) {
      console.error(`❌ BrowserView激活失败: ${viewId}`, error.message)
      throw error
    }
  }

  /**
   * 停用BrowserView
   */
  deactivateBrowserView(viewId) {
    const viewData = this.browserViews.get(viewId)
    if (!viewData) return false

    viewData.isActive = false

    if (this.activeView === viewId) {
      this.activeView = null
      this.mainWindow.removeBrowserView(viewData.view)
    }

    this.emitEvent('browserView-deactivated', { viewId })
    console.log(`⏹️ BrowserView停用: ${viewId}`)

    return true
  }

  /**
   * 销毁BrowserView
   */
  destroyBrowserView(viewId) {
    const viewData = this.browserViews.get(viewId)
    if (!viewData) return false

    // 停用View
    this.deactivateBrowserView(viewId)

    // 销毁WebContents
    viewData.view.webContents.destroy()

    // 从管理器中移除
    this.browserViews.delete(viewId)

    this.emitEvent('browserView-destroyed', { viewId })
    console.log(`🗑️ BrowserView销毁成功: ${viewId}`)

    return true
  }

  /**
   * 调整BrowserView大小
   */
  resizeBrowserView(viewId, bounds) {
    const viewData = this.browserViews.get(viewId)
    if (!viewData) return false

    viewData.view.setBounds(bounds)
    viewData.config.bounds = bounds

    this.emitEvent('browserView-resized', { viewId, bounds })
    return true
  }

  /**
   * 重新加载BrowserView
   */
  reloadBrowserView(viewId) {
    const viewData = this.browserViews.get(viewId)
    if (!viewData) return false

    viewData.view.webContents.reload()
    this.emitEvent('browserView-reloaded', { viewId })
    console.log(`🔄 BrowserView重新加载: ${viewId}`)

    return true
  }

  /**
   * 执行JavaScript代码
   */
  async executeJavaScript(viewId, code) {
    const viewData = this.browserViews.get(viewId)
    if (!viewData) {
      throw new Error(`BrowserView不存在: ${viewId}`)
    }

    try {
      const result = await viewData.view.webContents.executeJavaScript(code)
      return result
    } catch (error) {
      console.error(`❌ JavaScript执行失败: ${viewId}`, error.message)
      throw error
    }
  }

  /**
   * 发送消息到Legacy应用
   */
  async sendMessageToLegacy(viewId, message) {
    const code = `
      if (window.legacyApp && window.legacyApp.eventManager) {
        window.legacyApp.eventManager.emit('${message.type}', ${JSON.stringify(message.data)});
      }
    `

    return this.executeJavaScript(viewId, code)
  }

  /**
   * 设置IPC处理器
   */
  setupIpcHandlers() {
    // BrowserView管理
    ipcMain.handle('legacy:create-browser-view', async (event, options) => {
      return this.createBrowserView(options)
    })

    ipcMain.handle('legacy:activate-browser-view', async (event, viewId) => {
      return this.activateBrowserView(viewId)
    })

    ipcMain.handle('legacy:deactivate-browser-view', async (event, viewId) => {
      return this.deactivateBrowserView(viewId)
    })

    ipcMain.handle('legacy:destroy-browser-view', async (event, viewId) => {
      return this.destroyBrowserView(viewId)
    })

    ipcMain.handle('legacy:resize-browser-view', async (event, viewId, bounds) => {
      return this.resizeBrowserView(viewId, bounds)
    })

    ipcMain.handle('legacy:reload-browser-view', async (event, viewId) => {
      return this.reloadBrowserView(viewId || this.activeView)
    })

    ipcMain.handle('legacy:execute-javascript', async (event, viewId, code) => {
      return this.executeJavaScript(viewId || this.activeView, code)
    })

    // 资源管理器方法调用
    ipcMain.handle('legacy:resource-manager-initialize', async () => {
      return await this.resourceManager.initialize()
    })

    ipcMain.handle('legacy:resource-manager-check-legacy-system', async () => {
      return await this.resourceManager.checkLegacySystemExists()
    })

    ipcMain.handle('legacy:resource-manager-get-module-url', async (event, moduleName) => {
      return await this.resourceManager.getModuleUrl(moduleName)
    })

    ipcMain.handle('legacy:resource-manager-get-available-modules', async () => {
      return await this.resourceManager.getAvailableModules()
    })

    ipcMain.handle('legacy:resource-manager-get-module-info', async (event, moduleName) => {
      return this.resourceManager.getModuleInfo(moduleName)
    })

    ipcMain.handle('legacy:resource-manager-has-module', async (event, moduleName) => {
      return this.resourceManager.hasModule(moduleName)
    })

    ipcMain.handle('legacy:resource-manager-get-resource-path', async (event, relativePath) => {
      return this.resourceManager.getResourcePath(relativePath)
    })

    ipcMain.handle('legacy:resource-manager-has-resource', async (event, relativePath) => {
      return this.resourceManager.hasResource(relativePath)
    })

    // 通信
    ipcMain.handle('legacy:send-message', async (event, viewId, message) => {
      return this.sendMessageToLegacy(viewId || this.activeView, message)
    })

    // 存储操作
    ipcMain.handle('legacy:storage-get', async (event, key) => {
      // 实现安全存储操作
      return this.getStorageData(key)
    })

    ipcMain.handle('legacy:storage-set', async (event, key, value) => {
      return this.setStorageData(key, value)
    })

    ipcMain.handle('legacy:storage-remove', async (event, key) => {
      return this.removeStorageData(key)
    })

    ipcMain.handle('legacy:storage-clear', async () => {
      return this.clearStorageData()
    })

    // 文件系统操作
    ipcMain.handle('legacy:fs-readFile', async (event, filePath) => {
      return this.readAllowedFile(filePath)
    })

    ipcMain.handle('legacy:fs-writeFile', async (event, filePath, data) => {
      return this.writeAllowedFile(filePath, data)
    })

    ipcMain.handle('legacy:fs-exists', async (event, filePath) => {
      return this.checkAllowedFileExists(filePath)
    })

    ipcMain.handle('legacy:fs-allowedPaths', async () => {
      return this.getAllowedPaths()
    })

    // 网络请求
    ipcMain.handle('legacy:fetch', async (event, url, options) => {
      return this.secureFetch(url, options)
    })

    // 窗口控制
    ipcMain.handle('legacy:window-minimize', () => {
      this.mainWindow.minimize()
    })

    ipcMain.handle('legacy:window-maximize', () => {
      if (this.mainWindow.isMaximized()) {
        this.mainWindow.unmaximize()
      } else {
        this.mainWindow.maximize()
      }
    })

    ipcMain.handle('legacy:window-close', () => {
      this.mainWindow.close()
    })

    ipcMain.handle('legacy:window-setTitle', (event, title) => {
      this.mainWindow.setTitle(title)
    })

    // 开发者工具
    ipcMain.handle('legacy:dev-openDevTools', () => {
      const activeData = this.browserViews.get(this.activeView)
      if (activeData) {
        activeData.view.webContents.openDevTools()
      }
    })
  }

  /**
   * 设置会话拦截器
   */
  setupSessionInterceptors() {
    const legacySession = session.fromPartition('legacy-session')

    // 拦截网络请求
    legacySession.webRequest.onBeforeRequest((details, callback) => {
      const { url, method } = details

      // 安全检查
      if (!this.isUrlAllowed(url)) {
        callback({ cancel: true })
        return
      }

      callback({ cancel: false })
    })

    // 拦截响应头
    legacySession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders }

      // 安全头设置
      responseHeaders['Content-Security-Policy'] = [
        "default-src 'self' 'unsafe-inline' data: blob:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "connect-src 'self' ws: wss:; " +
        "img-src 'self' data: blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "font-src 'self' data:; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "frame-ancestors 'none';"
      ]

      callback({ responseHeaders })
    })
  }

  /**
   * URL安全检查
   */
  isUrlAllowed(url) {
    try {
      const parsedUrl = new URL(url)
      const allowedProtocols = ['http:', 'https:', 'file:', 'data:']

      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        return false
      }

      // 检查域名白名单
      const allowedDomains = [
        'localhost',
        '127.0.0.1',
        '0.0.0.0'
      ]

      if (parsedUrl.protocol.startsWith('http') &&
          !allowedDomains.includes(parsedUrl.hostname)) {
        return false
      }

      return true
    } catch (error) {
      return false
    }
  }

  /**
   * 安全存储操作
   */
  getStorageData(key) {
    // 实现安全的数据读取
    const storagePath = path.join(app.getPath('userData'), 'legacy-storage.json')
    try {
      const data = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
      return data[key] || null
    } catch (error) {
      return null
    }
  }

  setStorageData(key, value) {
    // 实现安全的数据写入
    const storagePath = path.join(app.getPath('userData'), 'legacy-storage.json')
    try {
      let data = {}
      if (fs.existsSync(storagePath)) {
        data = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
      }
      data[key] = value
      fs.writeFileSync(storagePath, JSON.stringify(data, null, 2))
      return true
    } catch (error) {
      return false
    }
  }

  removeStorageData(key) {
    return this.setStorageData(key, undefined)
  }

  clearStorageData() {
    const storagePath = path.join(app.getPath('userData'), 'legacy-storage.json')
    try {
      fs.writeFileSync(storagePath, '{}')
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * 允许的文件路径检查
   */
  getAllowedPaths() {
    return [
      path.join(app.getPath('userData'), 'legacy-data'),
      path.join(__dirname, '..', 'resources'),
      this.resourceManager.resourcePath
    ]
  }

  isPathAllowed(filePath) {
    const allowedPaths = this.getAllowedPaths()
    return allowedPaths.some(allowedPath =>
      filePath.startsWith(allowedPath) || filePath === allowedPath
    )
  }

  async readAllowedFile(filePath) {
    if (!this.isPathAllowed(filePath)) {
      throw new Error('文件路径不被允许')
    }
    return fs.promises.readFile(filePath, 'utf8')
  }

  async writeAllowedFile(filePath, data) {
    if (!this.isPathAllowed(filePath)) {
      throw new Error('文件路径不被允许')
    }

    // 确保目录存在
    const dir = path.dirname(filePath)
    await fs.promises.mkdir(dir, { recursive: true })

    return fs.promises.writeFile(filePath, data, 'utf8')
  }

  checkAllowedFileExists(filePath) {
    if (!this.isPathAllowed(filePath)) {
      return false
    }
    return fs.existsSync(filePath)
  }

  /**
   * 安全网络请求
   */
  async secureFetch(url, options = {}) {
    if (!this.isUrlAllowed(url)) {
      throw new Error('URL不被允许')
    }

    const fetch = require('node-fetch')
    return fetch(url, options)
  }

  /**
   * 事件发射器
   */
  emitEvent(eventName, data) {
    // 发送到主窗口
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('legacy:event', {
        event: eventName,
        data,
        timestamp: Date.now()
      })
    }

    // 调用事件处理器
    const handlers = this.eventHandlers.get(eventName)
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data)
        } catch (error) {
          console.error(`事件处理器执行失败: ${eventName}`, error)
        }
      })
    }
  }

  /**
   * 添加事件监听器
   */
  addEventListener(eventName, handler) {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set())
    }
    this.eventHandlers.get(eventName).add(handler)
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(eventName, handler) {
    const handlers = this.eventHandlers.get(eventName)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventName)
      }
    }
  }

  /**
   * 生成View ID
   */
  generateViewId() {
    return `legacy-view-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取活跃的BrowserView信息
   */
  getActiveBrowserView() {
    if (!this.activeView) return null

    const viewData = this.browserViews.get(this.activeView)
    if (!viewData) return null

    return {
      id: this.activeView,
      isActive: viewData.isActive,
      createdAt: viewData.createdAt,
      config: viewData.config,
      url: viewData.view.webContents.getURL()
    }
  }

  /**
   * 获取所有BrowserView信息
   */
  getAllBrowserViews() {
    return Array.from(this.browserViews.entries()).map(([id, data]) => ({
      id,
      isActive: data.isActive,
      createdAt: data.createdAt,
      config: data.config,
      url: data.view.webContents.getURL()
    }))
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 销毁所有BrowserView
    for (const [viewId] of this.browserViews) {
      this.destroyBrowserView(viewId)
    }

    // 清理事件监听器
    this.eventHandlers.clear()

    this.activeView = null
    this.isInitialized = false

    console.log('🧹 Legacy服务资源清理完成')
  }
}

module.exports = LegacyService