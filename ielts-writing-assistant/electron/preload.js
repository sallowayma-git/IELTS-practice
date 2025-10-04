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