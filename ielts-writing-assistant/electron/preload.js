const { contextBridge, ipcRenderer } = require('electron')

// 向渲染进程暴露API
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // 文件操作
  showSaveDialog: () => ipcRenderer.invoke('show-save-dialog'),
  showOpenDialog: () => ipcRenderer.invoke('show-open-dialog'),

  // 菜单事件监听
  onMenuAction: (callback) => {
    const menuActions = [
      'menu-new-writing',
      'menu-open-draft',
      'menu-export-data',
      'menu-ai-settings',
      'menu-settings',
      'menu-check-update',
      'menu-about'
    ]

    menuActions.forEach(action => {
      ipcRenderer.on(action, callback)
    })
  },

  // 移除监听器
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  },

  // Legacy系统API
  legacy: {
    // BrowserView管理
    createBrowserView: (options) => ipcRenderer.invoke('legacy:create-browser-view', options),
    activateBrowserView: (viewId) => ipcRenderer.invoke('legacy:activate-browser-view', viewId),
    deactivateBrowserView: (viewId) => ipcRenderer.invoke('legacy:deactivate-browser-view', viewId),
    destroyBrowserView: (viewId) => ipcRenderer.invoke('legacy:destroy-browser-view', viewId),
    resizeBrowserView: (viewId, bounds) => ipcRenderer.invoke('legacy:resize-browser-view', viewId, bounds),
    reloadBrowserView: (viewId) => ipcRenderer.invoke('legacy:reload-browser-view', viewId),
    executeJavaScript: (viewId, code) => ipcRenderer.invoke('legacy:execute-javascript', viewId, code),

    // 资源管理器方法调用
    resourceManager: {
      initialize: () => ipcRenderer.invoke('legacy:resource-manager-initialize'),
      checkLegacySystem: () => ipcRenderer.invoke('legacy:resource-manager-check-legacy-system'),
      getModuleUrl: (moduleName) => ipcRenderer.invoke('legacy:resource-manager-get-module-url', moduleName),
      getAvailableModules: () => ipcRenderer.invoke('legacy:resource-manager-get-available-modules'),
      getModuleInfo: (moduleName) => ipcRenderer.invoke('legacy:resource-manager-get-module-info', moduleName),
      hasModule: (moduleName) => ipcRenderer.invoke('legacy:resource-manager-has-module', moduleName),
      getResourcePath: (relativePath) => ipcRenderer.invoke('legacy:resource-manager-get-resource-path', relativePath),
      hasResource: (relativePath) => ipcRenderer.invoke('legacy:resource-manager-has-resource', relativePath)
    },

    // 通信
    sendMessage: (viewId, message) => ipcRenderer.invoke('legacy:send-message', viewId, message),

    // 存储操作
    storage: {
      get: (key) => ipcRenderer.invoke('legacy:storage-get', key),
      set: (key, value) => ipcRenderer.invoke('legacy:storage-set', key, value),
      remove: (key) => ipcRenderer.invoke('legacy:storage-remove', key),
      clear: () => ipcRenderer.invoke('legacy:storage-clear')
    },

    // 文件系统操作
    fs: {
      readFile: (filePath) => ipcRenderer.invoke('legacy:fs-readFile', filePath),
      writeFile: (filePath, data) => ipcRenderer.invoke('legacy:fs-writeFile', filePath, data),
      exists: (filePath) => ipcRenderer.invoke('legacy:fs-exists', filePath),
      allowedPaths: () => ipcRenderer.invoke('legacy:fs-allowedPaths')
    },

    // 网络请求
    fetch: (url, options) => ipcRenderer.invoke('legacy:fetch', url, options),

    // 窗口控制
    window: {
      minimize: () => ipcRenderer.invoke('legacy:window-minimize'),
      maximize: () => ipcRenderer.invoke('legacy:window-maximize'),
      close: () => ipcRenderer.invoke('legacy:window-close'),
      setTitle: (title) => ipcRenderer.invoke('legacy:window-setTitle', title)
    },

    // 开发者工具
    dev: {
      openDevTools: () => ipcRenderer.invoke('legacy:dev-openDevTools')
    },

    // 事件监听
    on: (channel, callback) => {
      const validChannels = [
        'legacy:command',
        'legacy:navigate',
        'legacy:reload',
        'legacy:config',
        'legacy:event',
        'legacy:browserview-event'
      ]
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, callback)
      }
    },

    // BrowserView事件监听
    onBrowserViewEvent: (eventType, callback) => {
      ipcRenderer.on(`legacy:browserview-${eventType}`, callback)
    },

    removeBrowserViewEventListener: (eventType, callback) => {
      ipcRenderer.removeListener(`legacy:browserview-${eventType}`, callback)
    },

    // 发送事件
    send: (channel, data) => {
      const validChannels = [
        'legacy:ready',
        'legacy:module-loaded',
        'legacy:event',
        'legacy:command',
        'legacy:error',
        'legacy:log'
      ]
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data)
      }
    },

    // 一次性监听
    once: (channel, callback) => {
      const validChannels = [
        'legacy:ready',
        'legacy:destroy'
      ]
      if (validChannels.includes(channel)) {
        ipcRenderer.once(channel, callback)
      }
    }
  },

  // 题库管理API
  questionBank: {
    // 服务管理
    initialize: () => ipcRenderer.invoke('questionbank:initialize'),
    getStatus: () => ipcRenderer.invoke('questionbank:get-status'),

    // 题库导入
    selectDirectory: () => ipcRenderer.invoke('questionbank:select-directory'),
    import: (selectedPath) => ipcRenderer.invoke('questionbank:import', selectedPath),

    // 题目查询
    getQuestions: (options) => ipcRenderer.invoke('questionbank:get-questions', options),
    getQuestionById: (questionId) => ipcRenderer.invoke('questionbank:get-question-by-id', questionId),
    getStatistics: () => ipcRenderer.invoke('questionbank:get-statistics'),

    // 题库管理
    refreshIndex: () => ipcRenderer.invoke('questionbank:refresh-index'),
    validateIntegrity: () => ipcRenderer.invoke('questionbank:validate-integrity'),
    createBackup: () => ipcRenderer.invoke('questionbank:create-backup'),

    // 事件监听
    addEventListener: (eventName, callback) => {
      return ipcRenderer.invoke('questionbank:add-event-listener', eventName)
    },
    removeEventListener: (listenerId) => ipcRenderer.invoke('questionbank:remove-event-listener', listenerId),

    // 事件订阅
    on: (eventName, callback) => {
      const validEvents = [
        'service-initialized',
        'service-error',
        'import-started',
        'import-progress',
        'import-completed',
        'import-failed',
        'index-loaded',
        'index-saved'
      ]
      if (validEvents.includes(eventName)) {
        ipcRenderer.on(`questionbank:event-${eventName}`, callback)
      }
    },

    // 移除事件监听
    off: (eventName, callback) => {
      ipcRenderer.removeListener(`questionbank:event-${eventName}`, callback)
    }
  },

  // 自动更新API
  updater: {
    // 检查更新
    checkForUpdates: () => ipcRenderer.invoke('updater-check-for-updates'),

    // 下载更新
    downloadUpdate: () => ipcRenderer.invoke('updater-download-update'),

    // 安装更新
    installUpdate: () => ipcRenderer.invoke('updater-install-update'),

    // 获取版本信息
    getVersion: () => ipcRenderer.invoke('updater-get-version'),

    // 获取更新状态
    getStatus: () => ipcRenderer.invoke('updater-get-status'),

    // 配置更新服务器
    configure: (config) => ipcRenderer.invoke('updater-configure', config),

    // 获取更新配置
    getConfig: () => ipcRenderer.invoke('updater-get-config'),

    // 事件监听
    on: (eventName, callback) => {
      const validEvents = [
        'update-status',
        'update-available',
        'update-not-available',
        'download-progress',
        'update-downloaded',
        'update-error'
      ]
      if (validEvents.includes(eventName)) {
        ipcRenderer.on(eventName, callback)
      }
    },

    // 移除事件监听
    off: (eventName, callback) => {
      ipcRenderer.removeListener(eventName, callback)
    }
  }
})

// 开发环境下暴露更多调试工具
if (process.env.NODE_ENV === 'development') {
  contextBridge.exposeInMainWorld('devAPI', {
    openDevTools: () => ipcRenderer.send('open-dev-tools'),
    reload: () => ipcRenderer.send('reload-window')
  })
}

console.log('Preload script loaded')