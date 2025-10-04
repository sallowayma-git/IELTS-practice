const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const path = require('path')
const { getIconPath } = require('./utils')
const isDev = process.env.NODE_ENV === 'development'

// 导入服务
const LegacyService = require('./services/LegacyService')
const QuestionBankService = require('./services/QuestionBankService')
const QuestionBankIPC = require('./services/QuestionBankIPC')
const UpdateService = require('./services/UpdateService')

// 保持对窗口对象的全局引用
let mainWindow
let legacyService
let questionBankService
let updateService

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: getIconPath(), // 使用跨平台图标解决方案
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false // 先不显示，等加载完成后再显示
  })

  // 加载应用
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // 开发环境下打开开发者工具
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 当窗口准备好显示时
  mainWindow.once('ready-to-show', async () => {
    mainWindow.show()
    mainWindow.focus()

    // 初始化更新服务
    try {
      updateService = new UpdateService()
      updateService.setMainWindow(mainWindow)

      // 在生产环境启用自动更新检查
      if (!isDev) {
        updateService.setupPeriodicCheck()
        console.log('✅ 更新服务初始化成功')
      } else {
        updateService.disableAutoUpdate()
        console.log('🔧 开发环境，自动更新已禁用')
      }
    } catch (error) {
      console.error('❌ 更新服务启动失败:', error)
    }

    // 初始化Legacy服务
    try {
      legacyService = new LegacyService()
      const legacyInitialized = await legacyService.initialize(mainWindow)
      if (legacyInitialized) {
        console.log('✅ Legacy服务初始化成功')
      } else {
        console.error('❌ Legacy服务初始化失败')
      }
    } catch (error) {
      console.error('❌ Legacy服务启动失败:', error)
    }

    // 初始化题库服务
    try {
      questionBankService = new QuestionBankService()
      const questionBankInitialized = await questionBankService.initialize()
      if (questionBankInitialized) {
        console.log('✅ 题库服务初始化成功')

        // 注册题库IPC处理器
        const questionBankIPC = new QuestionBankIPC(questionBankService)
        questionBankIPC.registerHandlers()
      } else {
        console.error('❌ 题库服务初始化失败')
      }
    } catch (error) {
      console.error('❌ 题库服务启动失败:', error)
    }
  })

  // 当窗口关闭时
  mainWindow.on('closed', () => {
    // 清理更新服务
    if (updateService) {
      updateService = null
    }

    // 清理Legacy服务
    if (legacyService) {
      legacyService.cleanup()
      legacyService = null
    }

    // 清理题库服务
    if (questionBankService) {
      questionBankService.cleanup()
      questionBankService = null
    }

    mainWindow = null
  })

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// 应用准备就绪时创建窗口
app.whenReady().then(() => {
  createWindow()
  createMenu()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 所有窗口关闭时退出应用 (macOS除外)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 创建应用菜单
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建写作',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu-new-writing')
          }
        },
        {
          label: '打开草稿',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow.webContents.send('menu-open-draft')
          }
        },
        { type: 'separator' },
        {
          label: '导出数据',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            mainWindow.webContents.send('menu-export-data')
          }
        },
        { type: 'separator' },
        {
          label: process.platform === 'darwin' ? '退出 雅思AI作文评判助手' : '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectall' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '工具',
      submenu: [
        {
          label: 'AI设置',
          click: () => {
            mainWindow.webContents.send('menu-ai-settings')
          }
        },
        {
          label: '偏好设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('menu-settings')
          }
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '用户手册',
          click: () => {
            shell.openExternal('https://docs.ielts-writing-assistant.com')
          }
        },
        {
          label: '检查更新',
          click: () => {
            mainWindow.webContents.send('menu-check-update')
          }
        },
        { type: 'separator' },
        {
          label: '关于',
          click: () => {
            mainWindow.webContents.send('menu-about')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// IPC 处理程序
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-platform', () => {
  return process.platform
})

ipcMain.handle('show-save-dialog', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return result
})

ipcMain.handle('show-open-dialog', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  return result
})

// 应用程序事件处理
app.on('browser-window-created', (event, window) => {
  window.webContents.on('before-input-event', (event, input) => {
    // 可以在这里处理全局快捷键
  })
})

// 防止多个实例
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 当运行第二个实例时，将焦点放在主窗口上
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// 导出legacyService实例供外部访问
global.legacyService = legacyService

console.log('雅思AI作文评判助手启动完成')