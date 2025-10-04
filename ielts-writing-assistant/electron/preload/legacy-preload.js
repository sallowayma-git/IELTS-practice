/**
 * Legacy系统预加载脚本
 * 为Legacy系统提供安全的API接口
 */

const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的API给Legacy系统
contextBridge.exposeInMainWorld('electronLegacyAPI', {
  // 通信API
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

  on: (channel, callback) => {
    const validChannels = [
      'legacy:command',
      'legacy:navigate',
      'legacy:reload',
      'legacy:config'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args))
    }
  },

  once: (channel, callback) => {
    const validChannels = [
      'legacy:ready',
      'legacy:destroy'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.once(channel, (event, ...args) => callback(...args))
    }
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  },

  // 系统信息API
  getSystemInfo: () => {
    return {
      platform: process.platform,
      version: process.version,
      electronVersion: process.versions.electron
    }
  },

  // 存储API（安全版本）
  storage: {
    get: (key) => ipcRenderer.invoke('legacy:storage-get', key),
    set: (key, value) => ipcRenderer.invoke('legacy:storage-set', key, value),
    remove: (key) => ipcRenderer.invoke('legacy:storage-remove', key),
    clear: () => ipcRenderer.invoke('legacy:storage-clear')
  },

  // 文件系统API（受限访问）
  fs: {
    readFile: (path) => ipcRenderer.invoke('legacy:fs-readFile', path),
    writeFile: (path, data) => ipcRenderer.invoke('legacy:fs-writeFile', path, data),
    exists: (path) => ipcRenderer.invoke('legacy:fs-exists', path),
    // 只允许访问特定目录
    allowedPaths: () => ipcRenderer.invoke('legacy:fs-allowedPaths')
  },

  // 网络请求API
  fetch: async (url, options = {}) => {
    return ipcRenderer.invoke('legacy:fetch', url, options)
  },

  // 窗口控制API
  window: {
    minimize: () => ipcRenderer.invoke('legacy:window-minimize'),
    maximize: () => ipcRenderer.invoke('legacy:window-maximize'),
    close: () => ipcRenderer.invoke('legacy:window-close'),
    setTitle: (title) => ipcRenderer.invoke('legacy:window-setTitle', title)
  },

  // 开发者工具API（仅开发模式）
  dev: {
    openDevTools: () => {
      if (process.env.NODE_ENV === 'development') {
        ipcRenderer.invoke('legacy:dev-openDevTools')
      }
    },
    log: (...args) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Legacy]', ...args)
        ipcRenderer.send('legacy:log', { level: 'log', args })
      }
    },
    error: (...args) => {
      if (process.env.NODE_ENV === 'development') {
        console.error('[Legacy]', ...args)
        ipcRenderer.send('legacy:log', { level: 'error', args })
      }
    }
  }
})

// Legacy系统事件处理
window.addEventListener('DOMContentLoaded', () => {
  // 通知主应用Legacy页面已加载
  window.electronLegacyAPI.send('legacy:ready', {
    url: window.location.href,
    timestamp: Date.now()
  })

  // 监听页面卸载事件
  window.addEventListener('beforeunload', () => {
    window.electronLegacyAPI.send('legacy:unload', {
      url: window.location.href,
      timestamp: Date.now()
    })
  })

  // 错误处理
  window.addEventListener('error', (event) => {
    window.electronLegacyAPI.send('legacy:error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      timestamp: Date.now()
    })
  })

  // 未处理的Promise拒绝
  window.addEventListener('unhandledrejection', (event) => {
    window.electronLegacyAPI.send('legacy:error', {
      message: 'Unhandled Promise Rejection',
      reason: event.reason,
      timestamp: Date.now()
    })
  })
})

// 设置Legacy应用的全局配置
window.LEGACY_CONFIG = {
  electronAPI: window.electronLegacyAPI,
  isElectron: true,
  version: '1.0.0',
  features: {
    storage: true,
    network: true,
    window: true,
    dev: process.env.NODE_ENV === 'development'
  }
}

// 开发模式下的调试工具
if (process.env.NODE_ENV === 'development') {
  window.LEGACY_DEBUG = {
    send: (type, data) => {
      console.log(`[Legacy Debug Send] ${type}:`, data)
      window.electronLegacyAPI.send(type, data)
    },
    on: (channel, callback) => {
      console.log(`[Legacy Debug Listen] ${channel}`)
      window.electronLegacyAPI.on(channel, (event, ...args) => {
        console.log(`[Legacy Debug Receive] ${channel}:`, args)
        callback(...args)
      })
    }
  }
}