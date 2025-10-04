/**
 * Legacy跨系统导航管理器
 * 管理主应用与Legacy系统之间的无缝导航体验
 */

import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

class LegacyNavigationManager {
  constructor() {
    // 路由实例
    this.router = null

    // 导航状态
    this.navigationState = reactive({
      isInLegacy: false,
      currentLegacyModule: null,
      previousRoute: null,
      navigationHistory: [],
      isTransitioning: false,
      transitionDirection: 'forward' // forward, backward
    })

    // 导航配置
    this.config = {
      // 过渡动画时长
      transitionDuration: 300,
      // 保存历史记录数量
      maxHistorySize: 20,
      // 是否启用过渡动画
      enableTransitions: true,
      // 自动保存用户进度
      autoSaveProgress: true,
      // 离开确认
      enableLeaveConfirmation: true
    }

    // 模块映射
    this.moduleMapping = {
      listening: {
        name: '听力练习',
        icon: 'headphones',
        color: '#409eff',
        route: '/legacy/listening',
        description: '通过音频和对话练习提高听力理解能力'
      },
      reading: {
        name: '阅读理解',
        icon: 'book-open',
        color: '#67c23a',
        route: '/legacy/reading',
        description: '练习学术文章阅读和理解能力'
      },
      vocabulary: {
        name: '词汇练习',
        icon: 'edit',
        color: '#e6a23c',
        route: '/legacy/vocabulary',
        description: '扩充词汇量，提高用词准确性'
      },
      index: {
        name: 'Legacy首页',
        icon: 'house',
        color: '#909399',
        route: '/legacy/index',
        description: 'Legacy系统主页'
      }
    }

    // 事件监听器
    this.eventListeners = new Map()

    // 过渡动画状态
    this.transitionState = reactive({
      isAnimating: false,
      progress: 0,
      type: 'slide' // slide, fade, scale
    })

    // 用户进度跟踪
    this.progressTracker = reactive({
      isEnabled: true,
      currentProgress: {},
      lastSaveTime: null
    })

    // 导航守卫
    this.navigationGuards = new Map()

    // 初始化
    this.initialized = false
  }

  /**
   * 初始化导航管理器
   */
  async initialize(router, options = {}) {
    try {
      this.router = router
      this.config = { ...this.config, ...options }

      // 设置路由守卫
      this.setupRouteGuards()

      // 设置事件监听
      this.setupEventListeners()

      // 恢复导航状态
      await this.restoreNavigationState()

      // 监听浏览器事件
      this.setupBrowserEvents()

      this.initialized = true
      console.log('✅ Legacy导航管理器初始化完成')

      return true
    } catch (error) {
      console.error('❌ Legacy导航管理器初始化失败:', error)
      return false
    }
  }

  /**
   * 设置路由守卫
   */
  setupRouteGuards() {
    // 前置守卫
    this.router.beforeEach(async (to, from, next) => {
      // 检查是否是Legacy路由
      const isLegacyRoute = to.meta?.isLegacy || to.path.startsWith('/legacy')
      const wasLegacyRoute = from.meta?.isLegacy || from.path.startsWith('/legacy')

      // 更新导航状态
      this.navigationState.isInLegacy = isLegacyRoute

      if (isLegacyRoute) {
        // 提取模块名称
        const moduleName = this.extractModuleNameFromRoute(to)
        this.navigationState.currentLegacyModule = moduleName

        // 保存历史记录
        this.addToNavigationHistory({
          from: from.path,
          to: to.path,
          timestamp: Date.now(),
          module: moduleName,
          type: 'legacy'
        })

        // 检查用户进度
        if (this.config.autoSaveProgress) {
          await this.checkUserProgress(moduleName)
        }
      } else {
        this.navigationState.currentLegacyModule = null
      }

      // 设置过渡方向
      if (this.isGoingBackward(to, from)) {
        this.navigationState.transitionDirection = 'backward'
      } else {
        this.navigationState.transitionDirection = 'forward'
      }

      // 执行导航守卫
      const guardResult = await this.executeNavigationGuards(to, from)
      if (guardResult === false) {
        return next(false)
      }

      next()
    })

    // 后置守卫
    this.router.afterEach((to, from) => {
      // 保存前一个路由
      this.navigationState.previousRoute = from.path

      // 触发导航完成事件
      this.emit('navigation-completed', {
        from: from.path,
        to: to.path,
        isInLegacy: this.navigationState.isInLegacy,
        module: this.navigationState.currentLegacyModule
      })

      // 停止过渡动画
      setTimeout(() => {
        this.navigationState.isTransitioning = false
      }, this.config.transitionDuration)
    })
  }

  /**
   * 设置事件监听
   */
  setupEventListeners() {
    // 监听Legacy系统事件
    window.addEventListener('message', this.handleLegacyMessage.bind(this))

    // 监听路由变化
    window.addEventListener('popstate', this.handlePopState.bind(this))

    // 监听页面可见性变化
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this))

    // 监听页面卸载
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this))
  }

  /**
   * 设置浏览器事件
   */
  setupBrowserEvents() {
    // 监听键盘快捷键
    document.addEventListener('keydown', this.handleKeyDown.bind(this))

    // 监听手势事件（移动端）
    this.setupGestureEvents()
  }

  /**
   * 导航到Legacy模块
   */
  async navigateToLegacy(moduleName, options = {}) {
    if (!this.initialized) {
      console.warn('导航管理器未初始化')
      return false
    }

    try {
      // 检查模块是否存在
      const moduleInfo = this.moduleMapping[moduleName]
      if (!moduleInfo) {
        throw new Error(`未知的Legacy模块: ${moduleName}`)
      }

      // 执行前置导航守卫
      const canNavigate = await this.executeNavigationGuards(
        { path: moduleInfo.route, meta: { isLegacy: true } },
        { path: this.router.currentRoute.value.path }
      )

      if (canNavigate === false) {
        return false
      }

      // 保存当前进度
      if (this.config.autoSaveProgress && this.navigationState.currentLegacyModule) {
        await this.saveUserProgress(this.navigationState.currentLegacyModule)
      }

      // 开始过渡动画
      if (this.config.enableTransitions) {
        this.startTransitionAnimation('forward')
      }

      // 更新状态
      this.navigationState.isTransitioning = true

      // 执行导航
      await this.router.push(moduleInfo.route)

      console.log(`🚀 导航到Legacy模块: ${moduleName}`)
      return true

    } catch (error) {
      console.error(`导航到Legacy模块失败: ${moduleName}`, error)
      ElMessage.error(`导航失败: ${error.message}`)
      return false
    }
  }

  /**
   * 从Legacy导航回主应用
   */
  async navigateBackToMain(targetRoute = '/', options = {}) {
    if (!this.initialized) {
      console.warn('导航管理器未初始化')
      return false
    }

    try {
      // 保存当前进度
      if (this.config.autoSaveProgress && this.navigationState.currentLegacyModule) {
        await this.saveUserProgress(this.navigationState.currentLegacyModule)
      }

      // 确认离开（如果有未保存的更改）
      if (this.config.enableLeaveConfirmation) {
        const hasUnsavedChanges = await this.hasUnsavedChanges()
        if (hasUnsavedChanges && !options.force) {
          const confirmed = await ElMessageBox.confirm(
            '您有未保存的更改，确定要离开吗？',
            '确认离开',
            {
              confirmButtonText: '离开',
              cancelButtonText: '取消',
              type: 'warning'
            }
          )
          if (!confirmed) {
            return false
          }
        }
      }

      // 开始过渡动画
      if (this.config.enableTransitions) {
        this.startTransitionAnimation('backward')
      }

      // 更新状态
      this.navigationState.isTransitioning = true

      // 执行导航
      await this.router.push(targetRoute)

      console.log(`🔙 从Legacy导航回主应用: ${targetRoute}`)
      return true

    } catch (error) {
      console.error('导航回主应用失败:', error)
      ElMessage.error(`导航失败: ${error.message}`)
      return false
    }
  }

  /**
   * 在Legacy模块间切换
   */
  async switchLegacyModule(targetModule, options = {}) {
    if (!this.navigationState.isInLegacy) {
      // 如果不在Legacy系统中，先导航到Legacy
      return this.navigateToLegacy(targetModule, options)
    }

    if (targetModule === this.navigationState.currentLegacyModule) {
      return true // 已经在目标模块中
    }

    try {
      // 保存当前模块进度
      if (this.config.autoSaveProgress) {
        await this.saveUserProgress(this.navigationState.currentLegacyModule)
      }

      // 开始过渡动画
      if (this.config.enableTransitions) {
        this.startTransitionAnimation('slide')
      }

      // 更新状态
      this.navigationState.isTransitioning = true

      // 执行模块切换
      const moduleInfo = this.moduleMapping[targetModule]
      await this.router.push(moduleInfo.route)

      console.log(`🔄 Legacy模块切换: ${this.navigationState.currentLegacyModule} -> ${targetModule}`)
      return true

    } catch (error) {
      console.error(`Legacy模块切换失败: ${targetModule}`, error)
      ElMessage.error(`模块切换失败: ${error.message}`)
      return false
    }
  }

  /**
   * 处理Legacy消息
   */
  handleLegacyMessage(event) {
    if (event.data.source !== 'legacy-app') return

    const { type, data } = event.data

    switch (type) {
      case 'legacy:navigate':
        this.handleLegacyNavigation(data)
        break
      case 'legacy:progress':
        this.handleLegacyProgress(data)
        break
      case 'legacy:ready':
        this.handleLegacyReady(data)
        break
    }
  }

  /**
   * 处理Legacy导航请求
   */
  async handleLegacyNavigation(data) {
    const { target, type, options = {} } = data

    switch (type) {
      case 'module':
        await this.switchLegacyModule(target, options)
        break
      case 'main':
        await this.navigateBackToMain(target, options)
        break
      case 'external':
        this.handleExternalNavigation(target, options)
        break
    }
  }

  /**
   * 处理Legacy进度更新
   */
  handleLegacyProgress(data) {
    const { module, progress } = data

    if (this.progressTracker.isEnabled) {
      this.progressTracker.currentProgress[module] = {
        ...progress,
        timestamp: Date.now()
      }

      // 自动保存进度
      if (this.config.autoSaveProgress) {
        this.debouncedSaveProgress(module)
      }
    }

    this.emit('progress-updated', { module, progress })
  }

  /**
   * 处理Legacy就绪事件
   */
  handleLegacyReady(data) {
    const { module } = data

    console.log(`📱 Legacy模块就绪: ${module}`)

    this.emit('legacy-module-ready', { module })

    // 恢复用户进度
    if (this.config.autoSaveProgress) {
      this.restoreUserProgress(module)
    }
  }

  /**
   * 开始过渡动画
   */
  startTransitionAnimation(type = 'slide') {
    this.transitionState.isAnimating = true
    this.transitionState.type = type
    this.transitionState.progress = 0

    const startTime = Date.now()
    const duration = this.config.transitionDuration

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      this.transitionState.progress = progress

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        this.transitionState.isAnimating = false
      }
    }

    requestAnimationFrame(animate)
  }

  /**
   * 添加到导航历史
   */
  addToNavigationHistory(entry) {
    this.navigationState.navigationHistory.push(entry)

    // 限制历史记录大小
    if (this.navigationState.navigationHistory.length > this.config.maxHistorySize) {
      this.navigationState.navigationHistory.shift()
    }

    // 保存到本地存储
    this.saveNavigationState()
  }

  /**
   * 从路由提取模块名称
   */
  extractModuleNameFromRoute(route) {
    const path = route.path
    const match = path.match(/\/legacy\/([^\/]+)/)
    return match ? match[1] : 'index'
  }

  /**
   * 检查是否后退导航
   */
  isGoingBackward(to, from) {
    // 简单判断：如果目标路由在历史记录中出现在前一个路由之前，则认为是后退
    const history = this.navigationState.navigationHistory
    const toIndex = history.findIndex(entry => entry.to === to.path)
    const fromIndex = history.findIndex(entry => entry.to === from.path)

    return toIndex !== -1 && fromIndex !== -1 && toIndex < fromIndex
  }

  /**
   * 检查用户进度
   */
  async checkUserProgress(module) {
    try {
      const progress = await this.loadUserProgress(module)
      if (progress) {
        this.progressTracker.currentProgress[module] = progress
        this.emit('progress-loaded', { module, progress })
      }
    } catch (error) {
      console.warn(`加载用户进度失败: ${module}`, error)
    }
  }

  /**
   * 保存用户进度
   */
  async saveUserProgress(module) {
    try {
      const progress = this.progressTracker.currentProgress[module]
      if (!progress) return

      // 保存到本地存储
      const key = `legacy_progress_${module}`
      localStorage.setItem(key, JSON.stringify(progress))

      // 保存到服务器（如果需要）
      if (this.config.syncToServer) {
        await this.syncProgressToServer(module, progress)
      }

      this.progressTracker.lastSaveTime = Date.now()
      this.emit('progress-saved', { module, progress })

    } catch (error) {
      console.error(`保存用户进度失败: ${module}`, error)
    }
  }

  /**
   * 恢复用户进度
   */
  async restoreUserProgress(module) {
    try {
      const progress = await this.loadUserProgress(module)
      if (progress) {
        // 发送进度恢复消息到Legacy系统
        this.sendMessageToLegacy({
          type: 'progress:restore',
          data: { module, progress }
        })

        this.emit('progress-restored', { module, progress })
      }
    } catch (error) {
      console.error(`恢复用户进度失败: ${module}`, error)
    }
  }

  /**
   * 加载用户进度
   */
  async loadUserProgress(module) {
    const key = `legacy_progress_${module}`
    const data = localStorage.getItem(key)

    if (data) {
      return JSON.parse(data)
    }

    return null
  }

  /**
   * 检查是否有未保存的更改
   */
  async hasUnsavedChanges() {
    // 检查当前模块是否有未保存的更改
    const module = this.navigationState.currentLegacyModule
    if (!module) return false

    const lastSave = this.progressTracker.lastSaveTime || 0
    const currentProgress = this.progressTracker.currentProgress[module]

    if (currentProgress && currentProgress.timestamp > lastSave) {
      return true
    }

    return false
  }

  /**
   * 发送消息到Legacy系统
   */
  sendMessageToLegacy(message) {
    if (window.legacyEventBridge) {
      window.legacyEventBridge.sendEvent('navigation', message)
    } else {
      // 回退到postMessage
      window.postMessage({
        type: 'navigation',
        data: message,
        source: 'main-app'
      }, '*')
    }
  }

  /**
   * 处理键盘快捷键
   */
  handleKeyDown(event) {
    // Alt + 左箭头：后退
    if (event.altKey && event.key === 'ArrowLeft') {
      this.goBack()
      event.preventDefault()
    }

    // Alt + 右箭头：前进
    if (event.altKey && event.key === 'ArrowRight') {
      this.goForward()
      event.preventDefault()
    }

    // Esc：退出Legacy系统
    if (event.key === 'Escape' && this.navigationState.isInLegacy) {
      this.navigateBackToMain()
      event.preventDefault()
    }
  }

  /**
   * 设置手势事件
   */
  setupGestureEvents() {
    let touchStartX = 0
    let touchStartY = 0

    document.addEventListener('touchstart', (event) => {
      touchStartX = event.touches[0].clientX
      touchStartY = event.touches[0].clientY
    })

    document.addEventListener('touchend', (event) => {
      if (!this.navigationState.isInLegacy) return

      const touchEndX = event.changedTouches[0].clientX
      const touchEndY = event.changedTouches[0].clientY
      const deltaX = touchEndX - touchStartX
      const deltaY = touchEndY - touchStartY

      // 水平滑动距离大于垂直滑动距离
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        if (deltaX > 0) {
          // 向右滑动：后退
          this.goBack()
        } else {
          // 向左滑动：前进
          this.goForward()
        }
      }
    })
  }

  /**
   * 处理浏览器历史操作
   */
  handlePopState(event) {
    // 处理浏览器后退/前进按钮
    this.emit('popstate', event)
  }

  /**
   * 处理页面可见性变化
   */
  handleVisibilityChange() {
    if (document.hidden) {
      // 页面隐藏时保存进度
      if (this.config.autoSaveProgress && this.navigationState.currentLegacyModule) {
        this.saveUserProgress(this.navigationState.currentLegacyModule)
      }
    } else {
      // 页面显示时检查状态
      this.emit('visibility-changed', { visible: !document.hidden })
    }
  }

  /**
   * 处理页面卸载
   */
  handleBeforeUnload(event) {
    // 如果有未保存的更改，显示确认对话框
    if (this.config.enableLeaveConfirmation) {
      this.hasUnsavedChanges().then(hasChanges => {
        if (hasChanges) {
          event.preventDefault()
          event.returnValue = '您有未保存的更改，确定要离开吗？'
        }
      })
    }
  }

  /**
   * 执行导航守卫
   */
  async executeNavigationGuards(to, from) {
    for (const [name, guard] of this.navigationGuards) {
      try {
        const result = await guard(to, from)
        if (result === false) {
          console.log(`导航被守卫阻止: ${name}`)
          return false
        }
      } catch (error) {
        console.error(`导航守卫执行失败: ${name}`, error)
      }
    }
    return true
  }

  /**
   * 添加导航守卫
   */
  addNavigationGuard(name, guard) {
    this.navigationGuards.set(name, guard)
  }

  /**
   * 移除导航守卫
   */
  removeNavigationGuard(name) {
    this.navigationGuards.delete(name)
  }

  /**
   * 防抖保存进度
   */
  debouncedSaveProgress(module) {
    if (this.saveProgressTimeout) {
      clearTimeout(this.saveProgressTimeout)
    }

    this.saveProgressTimeout = setTimeout(() => {
      this.saveUserProgress(module)
    }, 1000)
  }

  /**
   * 同步进度到服务器
   */
  async syncProgressToServer(module, progress) {
    // 实现服务器同步逻辑
    try {
      // 这里可以调用API同步到服务器
      console.log(`同步进度到服务器: ${module}`)
    } catch (error) {
      console.error('进度同步失败:', error)
    }
  }

  /**
   * 保存导航状态
   */
  saveNavigationState() {
    const state = {
      navigationHistory: this.navigationState.navigationHistory,
      currentLegacyModule: this.navigationState.currentLegacyModule,
      timestamp: Date.now()
    }

    localStorage.setItem('legacy_navigation_state', JSON.stringify(state))
  }

  /**
   * 恢复导航状态
   */
  async restoreNavigationState() {
    try {
      const savedState = localStorage.getItem('legacy_navigation_state')
      if (savedState) {
        const state = JSON.parse(savedState)

        // 检查状态是否过期（24小时）
        const isExpired = Date.now() - state.timestamp > 24 * 60 * 60 * 1000
        if (!isExpired) {
          this.navigationState.navigationHistory = state.navigationHistory || []
          this.navigationState.currentLegacyModule = state.currentLegacyModule
        }
      }
    } catch (error) {
      console.warn('恢复导航状态失败:', error)
    }
  }

  /**
   * 后退
   */
  goBack() {
    if (this.navigationState.isInLegacy) {
      this.navigateBackToMain()
    } else {
      this.router.back()
    }
  }

  /**
   * 前进
   */
  goForward() {
    this.router.forward()
  }

  /**
   * 获取导航统计
   */
  getNavigationStats() {
    return {
      isInLegacy: this.navigationState.isInLegacy,
      currentLegacyModule: this.navigationState.currentLegacyModule,
      historySize: this.navigationState.navigationHistory.length,
      isTransitioning: this.navigationState.isTransitioning,
      lastNavigation: this.navigationState.navigationHistory[this.navigationState.navigationHistory.length - 1],
      availableModules: Object.keys(this.moduleMapping)
    }
  }

  /**
   * 事件发射器
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data)
        } catch (error) {
          console.error(`事件监听器执行失败: ${event}`, error)
        }
      }
    }
  }

  /**
   * 添加事件监听器
   */
  on(event, listener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event).add(listener)
  }

  /**
   * 移除事件监听器
   */
  off(event, listener) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.delete(listener)
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 清理定时器
    if (this.saveProgressTimeout) {
      clearTimeout(this.saveProgressTimeout)
    }

    // 保存最终状态
    if (this.config.autoSaveProgress && this.navigationState.currentLegacyModule) {
      this.saveUserProgress(this.navigationState.currentLegacyModule)
    }

    this.saveNavigationState()

    // 清理事件监听器
    this.eventListeners.clear()
    this.navigationGuards.clear()

    this.initialized = false
    console.log('🧹 Legacy导航管理器资源清理完成')
  }
}

// 创建单例实例
const legacyNavigationManager = new LegacyNavigationManager()

// Vue组合式API
export function useLegacyNavigation() {
  const router = useRouter()

  // 初始化导航管理器
  if (!legacyNavigationManager.initialized) {
    legacyNavigationManager.initialize(router)
  }

  return {
    // 响应式状态
    navigationState: legacyNavigationManager.navigationState,
    transitionState: legacyNavigationManager.transitionState,
    progressTracker: legacyNavigationManager.progressTracker,

    // 导航方法
    navigateToLegacy: legacyNavigationManager.navigateToLegacy.bind(legacyNavigationManager),
    navigateBackToMain: legacyNavigationManager.navigateBackToMain.bind(legacyNavigationManager),
    switchLegacyModule: legacyNavigationManager.switchLegacyModule.bind(legacyNavigationManager),
    goBack: legacyNavigationManager.goBack.bind(legacyNavigationManager),
    goForward: legacyNavigationManager.goForward.bind(legacyNavigationManager),

    // 工具方法
    getNavigationStats: legacyNavigationManager.getNavigationStats.bind(legacyNavigationManager),
    addNavigationGuard: legacyNavigationManager.addNavigationGuard.bind(legacyNavigationManager),
    removeNavigationGuard: legacyNavigationManager.removeNavigationGuard.bind(legacyNavigationManager),

    // 事件处理
    on: legacyNavigationManager.on.bind(legacyNavigationManager),
    off: legacyNavigationManager.off.bind(legacyNavigationManager),

    // 模块信息
    moduleMapping: legacyNavigationManager.moduleMapping
  }
}

export default legacyNavigationManager