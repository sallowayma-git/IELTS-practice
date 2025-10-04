<template>
  <div class="legacy-wrapper">
    <!-- 桌面端使用 BrowserView -->
    <template v-if="isElectron && !useIframe">
      <div class="browser-view-container">
        <div v-if="loading" class="loading-overlay">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在加载Legacy系统...</span>
        </div>
        <div v-if="error" class="error-overlay">
          <el-icon><Warning /></el-icon>
          <span>{{ error }}</span>
          <el-button @click="reload" type="primary">重试</el-button>
        </div>
      </div>
    </template>

    <!-- Web端或备选方案使用 iframe -->
    <template v-else>
      <div class="iframe-container">
        <div v-if="loading" class="loading-overlay">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在加载Legacy系统...</span>
        </div>
        <iframe
          ref="iframeRef"
          :src="legacyUrl"
          frameborder="0"
          @load="onIframeLoad"
          @error="onIframeError"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
        <div v-if="error" class="error-overlay">
          <el-icon><Warning /></el-icon>
          <span>{{ error }}</span>
          <el-button @click="reload" type="primary">重试</el-button>
        </div>
      </div>
    </template>

    <!-- 控制面板 -->
    <div class="control-panel">
      <div class="module-selector">
        <el-select v-model="selectedModule" placeholder="选择模块" @change="loadModule">
          <el-option
            v-for="module in availableModules"
            :key="module.name"
            :label="module.title"
            :value="module.name"
          />
        </el-select>
      </div>
      <div class="actions">
        <el-button @click="reload" :icon="Refresh" circle title="刷新" />
        <el-button @click="goBack" :icon="ArrowLeft" circle title="返回" />
        <el-button @click="toggleFullscreen" :icon="FullScreen" circle title="全屏" />
      </div>
    </div>

    <!-- 通信日志面板（开发模式） -->
    <div v-if="showDebugPanel" class="debug-panel">
      <el-collapse v-model="debugPanelActive">
        <el-collapse-item title="Legacy通信日志" name="logs">
          <div class="log-container">
            <div
              v-for="(log, index) in communicationLogs"
              :key="index"
              :class="['log-entry', log.type]"
            >
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <span class="log-direction">{{ log.direction }}</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, Warning, Refresh, ArrowLeft, FullScreen } from '@element-plus/icons-vue'

// Props
const props = defineProps({
  // Legacy系统入口URL
  entryUrl: {
    type: String,
    default: ''
  },
  // 是否使用iframe（在Electron中可选择BrowserView）
  useIframe: {
    type: Boolean,
    default: false
  },
  // 是否显示调试面板
  showDebugPanel: {
    type: Boolean,
    default: process.env.NODE_ENV === 'development'
  },
  // 自动加载的模块
  autoLoadModule: {
    type: String,
    default: ''
  }
})

// Emits
const emit = defineEmits([
  'legacy-ready',
  'legacy-error',
  'module-loaded',
  'module-unloaded',
  'legacy-event',
  'communication-log'
])

// 响应式数据
const loading = ref(true)
const error = ref('')
const selectedModule = ref('')
const availableModules = ref([])
const legacyUrl = ref('')
const iframeRef = ref(null)
const communicationLogs = ref([])
const debugPanelActive = ref(['logs'])
const isElectron = ref(false)
const isFullscreen = ref(false)

// Legacy应用状态
const legacyAppReady = ref(false)
const currentModule = ref(null)

// BrowserView管理
const browserViewId = ref(null)

// 计算属性
const canGoBack = computed(() => {
  return currentModule.value !== null
})

// 生命周期
onMounted(async () => {
  // 检测是否在Electron环境中
  isElectron.value = !!(window.electronAPI && window.electronAPI.legacy)

  try {
    await initializeLegacyWrapper()
    await loadAvailableModules()

    if (props.autoLoadModule) {
      selectedModule.value = props.autoLoadModule
      await loadModule()
    }
  } catch (err) {
    handleError('Legacy系统初始化失败', err)
  }
})

onUnmounted(() => {
  cleanup()
})

// 方法
async function initializeLegacyWrapper() {
  loading.value = true
  error.value = ''

  try {
    // 设置通信桥梁
    setupCommunicationBridge()

    // 获取Legacy系统入口URL
    if (isElectron.value) {
      // Electron环境：使用资源管理器API
      await window.electronAPI.legacy.resourceManager.initialize()

      if (props.entryUrl) {
        legacyUrl.value = props.entryUrl
      } else {
        // 使用默认的Legacy入口
        legacyUrl.value = await window.electronAPI.legacy.resourceManager.getModuleUrl('index')
      }

      // 设置BrowserView
      if (!props.useIframe) {
        await setupBrowserView()
      }
    } else {
      // Web环境：直接使用URL
      legacyUrl.value = props.entryUrl || '/legacy/index.html'
    }

    addLog('info', 'OUTGOING', 'LegacyWrapper初始化完成')
  } catch (err) {
    throw new Error(`Legacy系统初始化失败: ${err.message}`)
  }
}

async function setupBrowserView() {
  if (!isElectron.value) return

  try {
    // 创建BrowserView并存储ID
    browserViewId.value = await window.electronAPI.legacy.createBrowserView({
      src: legacyUrl.value,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
        // preload路径在主进程中设置，渲染进程无法直接访问path模块
      }
    })

    console.log(`✅ BrowserView创建成功: ${browserViewId.value}`)

    // 监听BrowserView事件
    window.electronAPI.legacy.onBrowserViewEvent('dom-ready', handleBrowserViewReady)
    window.electronAPI.legacy.onBrowserViewEvent('did-fail-load', handleBrowserViewError)
    window.electronAPI.legacy.onBrowserViewEvent('console-message', handleBrowserViewConsole)

    console.log('✅ BrowserView事件监听器设置完成')
  } catch (err) {
    throw new Error(`BrowserView设置失败: ${err.message}`)
  }
}

function setupCommunicationBridge() {
  // 设置消息监听器
  window.addEventListener('message', handleWindowMessage)

  // 设置定时器检查Legacy应用是否就绪
  const readyCheckInterval = setInterval(() => {
    if (legacyAppReady.value) {
      clearInterval(readyCheckInterval)
      return
    }

    checkLegacyAppReady()
  }, 500)

  // 10秒超时
  setTimeout(() => {
    if (!legacyAppReady.value) {
      clearInterval(readyCheckInterval)
      handleError('Legacy应用加载超时')
    }
  }, 10000)
}

function checkLegacyAppReady() {
  try {
    if (isElectron.value && !props.useIframe && browserViewId.value) {
      // BrowserView环境
      window.electronAPI.legacy.executeJavaScript(browserViewId.value, `
        typeof window.app !== 'undefined' && typeof window.app.initialize === 'function'
      `).then(result => {
        if (result) {
          onLegacyAppReady()
        }
      })
    } else if (iframeRef.value && iframeRef.value.contentWindow) {
      // iframe环境
      const iframeWindow = iframeRef.value.contentWindow
      if (iframeWindow.app && typeof iframeWindow.app.initialize === 'function') {
        onLegacyAppReady()
      }
    }
  } catch (err) {
    // 跨域或其他错误，忽略
  }
}

async function onLegacyAppReady() {
  legacyAppReady.value = true
  loading.value = false

  addLog('success', 'INCOMING', 'Legacy应用已就绪')

  // 初始化Legacy应用
  try {
    await initializeLegacyApp()
    emit('legacy-ready')
  } catch (err) {
    handleError('Legacy应用初始化失败', err)
  }
}

async function initializeLegacyApp() {
  const initCommand = {
    type: 'init',
    config: {
      apiEndpoint: '/api/legacy',
      userId: getCurrentUserId(),
      sessionId: generateSessionId()
    }
  }

  await sendLegacyCommand(initCommand)
}

function handleWindowMessage(event) {
  if (event.origin !== window.location.origin && !isLegacyOrigin(event.origin)) {
    return
  }

  const { type, data, source } = event.data

  if (source !== 'legacy-app') return

  addLog('info', 'INCOMING', `${type}: ${JSON.stringify(data)}`)

  switch (type) {
    case 'legacy:ready':
      onLegacyAppReady()
      break
    case 'legacy:module-loaded':
      handleModuleLoaded(data)
      break
    case 'legacy:event':
      handleLegacyEvent(data)
      break
    case 'legacy:command':
      handleLegacyCommand(data)
      break
    case 'legacy:error':
      handleError('Legacy应用错误', data)
      break
  }
}

function handleBrowserViewReady(event) {
  loading.value = false
  addLog('success', 'SYSTEM', 'BrowserView已就绪')

  // 开始检查Legacy应用是否就绪
  checkLegacyAppReady()
}

function handleBrowserViewError(event) {
  const { errorCode, errorDescription } = event
  handleError(`BrowserView加载失败 (${errorCode})`, new Error(errorDescription))
}

function handleBrowserViewConsole(event) {
  const { level, message, line, sourceId } = event

  if (props.showDebugPanel) {
    addLog(level === 'error' ? 'error' : 'info', 'CONSOLE', `${message} (${line})`)
  }
}

function handleIframeLoad() {
  loading.value = false
  addLog('success', 'SYSTEM', 'iframe已加载')

  // 开始检查Legacy应用是否就绪
  checkLegacyAppReady()
}

function handleIframeError(event) {
  handleError('iframe加载失败', new Error(event.message))
}

async function loadAvailableModules() {
  try {
    if (isElectron.value) {
      availableModules.value = await window.electronAPI.legacy.resourceManager.getAvailableModules()
    } else {
      // Web环境：使用默认模块
      availableModules.value = [
        { name: 'listening', title: '听力练习' },
        { name: 'reading', title: '阅读练习' },
        { name: 'vocabulary', title: '词汇练习' }
      ]
    }
  } catch (err) {
    console.warn('获取可用模块失败:', err)
    availableModules.value = []
  }
}

async function loadModule() {
  if (!selectedModule.value) return

  try {
    loading.value = true
    error.value = ''

    const command = {
      type: 'load-module',
      module: selectedModule.value
    }

    await sendLegacyCommand(command)
    addLog('info', 'OUTGOING', `加载模块: ${selectedModule.value}`)
  } catch (err) {
    handleError('模块加载失败', err)
  } finally {
    loading.value = false
  }
}

async function unloadModule() {
  if (!currentModule.value) return

  try {
    const command = {
      type: 'unload-module'
    }

    await sendLegacyCommand(command)
    currentModule.value = null
    addLog('info', 'OUTGOING', '卸载当前模块')
    emit('module-unloaded')
  } catch (err) {
    handleError('模块卸载失败', err)
  }
}

function handleModuleLoaded(data) {
  currentModule.value = data.module
  loading.value = false

  addLog('success', 'INCOMING', `模块已加载: ${data.module}`)
  emit('module-loaded', data)
}

function handleLegacyEvent(data) {
  const { event, eventData } = data

  addLog('info', 'INCOMING', `Legacy事件: ${event}`)
  emit('legacy-event', { event, data: eventData })
}

function handleLegacyCommand(command) {
  addLog('info', 'INCOMING', `Legacy命令: ${command.type}`)

  // 处理来自Legacy应用的命令
  switch (command.type) {
    case 'get-data':
      handleGetDataCommand(command)
      break
    case 'save-data':
      handleSaveDataCommand(command)
      break
    default:
      console.warn('未处理的Legacy命令:', command)
  }
}

function handleGetDataCommand(command) {
  // 获取数据的处理逻辑
  // 这里可以与主应用的数据存储交互
  sendLegacyResponse({
    type: 'data-response',
    requestId: command.requestId,
    data: {}
  })
}

function handleSaveDataCommand(command) {
  // 保存数据的处理逻辑
  // 这里可以与主应用的数据存储交互
  sendLegacyResponse({
    type: 'save-response',
    requestId: command.requestId,
    success: true
  })
}

async function sendLegacyCommand(command) {
  try {
    if (isElectron.value && !props.useIframe && browserViewId.value) {
      // BrowserView环境
      await window.electronAPI.legacy.executeJavaScript(browserViewId.value, `
        if (window.legacyApp && window.legacyApp.eventManager) {
          window.legacyApp.eventManager.emit('legacy:command', ${JSON.stringify(command)});
        }
      `)
    } else if (iframeRef.value && iframeRef.value.contentWindow) {
      // iframe环境
      iframeRef.value.contentWindow.postMessage({
        type: 'legacy:command',
        data: command,
        source: 'main-app'
      }, '*')
    }

    addLog('info', 'OUTGOING', `命令: ${command.type}`)
  } catch (err) {
    throw new Error(`发送Legacy命令失败: ${err.message}`)
  }
}

function sendLegacyResponse(response) {
  // 发送响应给Legacy应用
  sendLegacyCommand(response)
}

function reload() {
  loading.value = true
  error.value = ''
  currentModule.value = null
  legacyAppReady.value = false

  if (isElectron.value && !props.useIframe && browserViewId.value) {
    window.electronAPI.legacy.reloadBrowserView(browserViewId.value)
  } else if (iframeRef.value) {
    iframeRef.value.src = iframeRef.value.src
  }

  addLog('info', 'SYSTEM', '重新加载Legacy系统')
}

function goBack() {
  if (currentModule.value) {
    unloadModule()
  } else {
    // 返回到主应用
    window.history.back()
  }
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value

  if (isFullscreen.value) {
    document.documentElement.requestFullscreen?.()
  } else {
    document.exitFullscreen?.()
  }
}

function handleError(message, error = null) {
  console.error(message, error)
  loading.value = false
  error.value = message

  addLog('error', 'SYSTEM', message)
  emit('legacy-error', { message, error })

  ElMessage.error(message)
}

function addLog(type, direction, message) {
  const log = {
    type,
    direction,
    message,
    timestamp: Date.now()
  }

  communicationLogs.value.unshift(log)

  // 限制日志数量
  if (communicationLogs.value.length > 100) {
    communicationLogs.value = communicationLogs.value.slice(0, 100)
  }

  emit('communication-log', log)
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString()
}

function isLegacyOrigin(origin) {
  // 检查是否为Legacy系统的源
  return origin.includes('localhost') || origin.includes('127.0.0.1')
}

function getCurrentUserId() {
  // 获取当前用户ID
  return window.app?.config?.user?.id || 'anonymous'
}

function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function cleanup() {
  // 清理资源
  window.removeEventListener('message', handleWindowMessage)

  if (isElectron.value && !props.useIframe && browserViewId.value) {
    console.log(`🗑️ 销毁BrowserView: ${browserViewId.value}`)
    window.electronAPI.legacy.destroyBrowserView(browserViewId.value)
    browserViewId.value = null
  }
}
</script>

<style scoped>
.legacy-wrapper {
  position: relative;
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.iframe-container,
.browser-view-container {
  position: relative;
  flex: 1;
  width: 100%;
  overflow: hidden;
}

iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}

.loading-overlay,
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.95);
  z-index: 10;
  gap: 1rem;
}

.loading-overlay .el-icon {
  font-size: 2rem;
  color: #409eff;
}

.error-overlay .el-icon {
  font-size: 2rem;
  color: #f56c6c;
}

.control-panel {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 1rem;
  align-items: center;
  background: white;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 20;
}

.module-selector {
  min-width: 150px;
}

.actions {
  display: flex;
  gap: 0.5rem;
}

.debug-panel {
  position: absolute;
  bottom: 1rem;
  left: 1rem;
  right: 1rem;
  max-width: 600px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 20;
}

.log-container {
  max-height: 200px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 0.85rem;
}

.log-entry {
  display: flex;
  gap: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid #f0f0f0;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  color: #909399;
  min-width: 80px;
}

.log-direction {
  color: #606266;
  min-width: 80px;
  font-weight: bold;
}

.log-message {
  flex: 1;
  word-break: break-all;
}

.log-entry.info .log-message {
  color: #606266;
}

.log-entry.success .log-message {
  color: #67c23a;
}

.log-entry.error .log-message {
  color: #f56c6c;
}

/* 全屏模式 */
.legacy-wrapper:fullscreen {
  background: white;
}

.legacy-wrapper:fullscreen .control-panel {
  position: fixed;
  top: 1rem;
  right: 1rem;
}

.legacy-wrapper:fullscreen .debug-panel {
  position: fixed;
  bottom: 1rem;
  left: 1rem;
}
</style>