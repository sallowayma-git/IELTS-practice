/**
 * Electron 应用自动更新服务
 * 提供更新检查、下载和安装功能
 */

const { autoUpdater } = require('electron-updater')
const { app, dialog, ipcMain } = require('electron')
const log = require('electron-log')

class UpdateService {
  constructor() {
    this.mainWindow = null
    this.updateAvailable = false
    this.isCheckingForUpdates = false

    // 配置日志
    log.transports.file.level = 'info'
    autoUpdater.logger = log

    // 配置更新服务器 - 从环境变量或配置文件读取
    const updateConfig = {
      provider: process.env.UPDATE_PROVIDER || 'github',
      owner: process.env.GITHUB_OWNER || 'your-username',
      repo: process.env.GITHUB_REPO || 'ielts-writing-assistant',
      private: process.env.GITHUB_PRIVATE === 'true'
    }

    // 只在配置有效时设置更新服务器
    if (updateConfig.owner !== 'your-username' && updateConfig.repo !== 'ielts-writing-assistant') {
      autoUpdater.setFeedURL(updateConfig)
      log.info('更新服务器配置:', updateConfig)
    } else {
      log.warn('使用默认更新配置，请在生产环境中设置正确的环境变量')
    }

    this.setupEventHandlers()
    this.setupIPC()
  }

  setMainWindow(window) {
    this.mainWindow = window
  }

  setupEventHandlers() {
    // 检查更新开始
    autoUpdater.on('checking-for-update', () => {
      log.info('正在检查更新...')
      this.sendToMainWindow('update-status', { status: 'checking' })
    })

    // 发现新版本
    autoUpdater.on('update-available', (info) => {
      log.info('发现新版本:', info.version)
      this.updateAvailable = true
      this.sendToMainWindow('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
        currentVersion: app.getVersion()
      })
    })

    // 没有发现更新
    autoUpdater.on('update-not-available', (info) => {
      log.info('当前已是最新版本')
      this.sendToMainWindow('update-not-available', {
        currentVersion: app.getVersion()
      })
    })

    // 下载进度
    autoUpdater.on('download-progress', (progressObj) => {
      let log_message = "下载速度: " + progressObj.bytesPerSecond
      log_message = log_message + ' - 已下载: ' + progressObj.percent + '%'
      log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')'
      log.info(log_message)

      this.sendToMainWindow('download-progress', {
        percent: Math.round(progressObj.percent),
        transferred: progressObj.transferred,
        total: progressObj.total,
        bytesPerSecond: progressObj.bytesPerSecond
      })
    })

    // 下载完成
    autoUpdater.on('update-downloaded', (info) => {
      log.info('更新下载完成')
      this.sendToMainWindow('update-downloaded', {
        version: info.version
      })

      // 提示用户安装更新
      this.showUpdateDialog()
    })

    // 更新错误
    autoUpdater.on('error', (err) => {
      log.error('自动更新错误:', err)
      this.sendToMainWindow('update-error', {
        message: err.message
      })
    })
  }

  setupIPC() {
    // 检查更新
    ipcMain.handle('updater-check-for-updates', async () => {
      return await this.checkForUpdates()
    })

    // 下载更新
    ipcMain.handle('updater-download-update', async () => {
      return await this.downloadUpdate()
    })

    // 安装更新
    ipcMain.handle('updater-install-update', () => {
      this.installUpdate()
    })

    // 获取应用版本
    ipcMain.handle('updater-get-version', () => {
      return {
        current: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome
      }
    })

    // 获取更新状态
    ipcMain.handle('updater-get-status', () => {
      return {
        updateAvailable: this.updateAvailable,
        isChecking: this.isCheckingForUpdates
      }
    })

    // 配置更新服务器
    ipcMain.handle('updater-configure', async (event, config) => {
      return this.configureUpdateServer(config)
    })

    // 获取更新配置
    ipcMain.handle('updater-get-config', () => {
      return this.getUpdateConfig()
    })
  }

  async checkForUpdates() {
    if (this.isCheckingForUpdates) {
      return { success: false, message: '正在检查更新，请稍候...' }
    }

    this.isCheckingForUpdates = true

    try {
      const result = await autoUpdater.checkForUpdatesAndNotify()
      this.isCheckingForUpdates = false

      if (result && result.updateInfo) {
        return {
          success: true,
          updateAvailable: result.updateInfo.version !== app.getVersion(),
          updateInfo: result.updateInfo
        }
      }

      return {
        success: true,
        updateAvailable: false,
        message: '当前已是最新版本'
      }
    } catch (error) {
      this.isCheckingForUpdates = false
      log.error('检查更新失败:', error)
      return {
        success: false,
        message: error.message
      }
    }
  }

  async downloadUpdate() {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      log.error('下载更新失败:', error)
      return { success: false, message: error.message }
    }
  }

  installUpdate() {
    autoUpdater.quitAndInstall(false, true)
  }

  async showUpdateDialog() {
    if (!this.mainWindow) return

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      title: '更新已下载',
      message: '新版本已下载完成',
      detail: '是否立即安装更新？安装后应用将自动重启。',
      buttons: ['立即安装', '稍后安装'],
      defaultId: 0,
      cancelId: 1
    })

    if (result.response === 0) {
      this.installUpdate()
    }
  }

  sendToMainWindow(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  // 设置更新检查间隔（每小时检查一次）
  setupPeriodicCheck() {
    setInterval(async () => {
      if (!this.isCheckingForUpdates) {
        await this.checkForUpdates()
      }
    }, 60 * 60 * 1000) // 1小时
  }

  // 配置更新服务器
  configureUpdateServer(config) {
    const updateConfig = {
      provider: config.provider || 'github',
      owner: config.owner || process.env.GITHUB_OWNER || 'your-username',
      repo: config.repo || process.env.GITHUB_REPO || 'ielts-writing-assistant',
      private: config.private || process.env.GITHUB_PRIVATE === 'true'
    }

    if (updateConfig.owner !== 'your-username' && updateConfig.repo !== 'ielts-writing-assistant') {
      autoUpdater.setFeedURL(updateConfig)
      log.info('更新服务器已重新配置:', updateConfig)
      return true
    } else {
      log.warn('更新配置包含默认值，跳过配置')
      return false
    }
  }

  // 获取当前更新配置
  getUpdateConfig() {
    return {
      provider: process.env.UPDATE_PROVIDER || 'github',
      owner: process.env.GITHUB_OWNER || 'your-username',
      repo: process.env.GITHUB_REPO || 'ielts-writing-assistant',
      private: process.env.GITHUB_PRIVATE === 'true'
    }
  }

  // 禁用自动更新
  disableAutoUpdate() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
  }

  // 启用自动更新
  enableAutoUpdate() {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
  }
}

module.exports = UpdateService