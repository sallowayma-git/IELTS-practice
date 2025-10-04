/**
 * 题库管理组合式函数
 * 提供题库相关操作的统一接口
 */

import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

export function useQuestionBank() {
  // 状态管理
  const isInitialized = ref(false)
  const isLoading = ref(false)
  const isImporting = ref(false)
  const currentImport = ref(null)

  // 题库数据
  const statistics = reactive({
    totalQuestions: 0,
    categories: {},
    tags: {},
    lastUpdated: null
  })

  const questions = ref([])
  const selectedQuestion = ref(null)

  // 查询参数
  const queryOptions = reactive({
    search: '',
    category: '',
    difficulty: '',
    limit: 50,
    offset: 0
  })

  // 分页信息
  const pagination = reactive({
    total: 0,
    current: 1,
    pageSize: 50
  })

  // 事件监听器
  const eventListeners = new Map()

  // 初始化
  const initialize = async () => {
    if (isInitialized.value) return

    isLoading.value = true
    try {
      await window.electronAPI.questionBank.initialize()
      isInitialized.value = true
      console.log('✅ 题库管理器初始化成功')
    } catch (error) {
      console.error('❌ 题库管理器初始化失败:', error)
      ElMessage.error('题库管理器初始化失败')
      throw error
    } finally {
      isLoading.value = false
    }
  }

  // 加载统计信息
  const loadStatistics = async () => {
    try {
      const stats = await window.electronAPI.questionBank.getStatistics()
      Object.assign(statistics, stats)
      return stats
    } catch (error) {
      console.error('加载统计信息失败:', error)
      throw error
    }
  }

  // 加载题目列表
  const loadQuestions = async (options = {}) => {
    if (!isInitialized.value) {
      await initialize()
    }

    isLoading.value = true
    try {
      const params = {
        ...queryOptions,
        ...options,
        limit: options.limit || queryOptions.limit,
        offset: options.offset || queryOptions.offset
      }

      const result = await window.electronAPI.questionBank.getQuestions(params)
      questions.value = result.questions
      pagination.total = result.total
      pagination.hasMore = result.hasMore

      return result
    } catch (error) {
      console.error('加载题目失败:', error)
      ElMessage.error('加载题目失败')
      throw error
    } finally {
      isLoading.value = false
    }
  }

  // 搜索题目
  const searchQuestions = async (searchTerm) => {
    queryOptions.search = searchTerm
    queryOptions.offset = 0
    pagination.current = 1

    return await loadQuestions()
  }

  // 按分类筛选
  const filterByCategory = async (category) => {
    queryOptions.category = category
    queryOptions.offset = 0
    pagination.current = 1

    return await loadQuestions()
  }

  // 按难度筛选
  const filterByDifficulty = async (difficulty) => {
    queryOptions.difficulty = difficulty
    queryOptions.offset = 0
    pagination.current = 1

    return await loadQuestions()
  }

  // 分页操作
  const goToPage = async (page) => {
    pagination.current = page
    queryOptions.offset = (page - 1) * queryOptions.limit

    return await loadQuestions()
  }

  const setPageSize = async (pageSize) => {
    queryOptions.limit = pageSize
    queryOptions.offset = 0
    pagination.current = 1
    pagination.pageSize = pageSize

    return await loadQuestions()
  }

  // 选择题目
  const selectQuestion = async (questionId) => {
    try {
      const question = await window.electronAPI.questionBank.getQuestionById(questionId)
      selectedQuestion.value = question
      return question
    } catch (error) {
      console.error('获取题目详情失败:', error)
      ElMessage.error('获取题目详情失败')
      throw error
    }
  }

  // 导入题库
  const importQuestionBank = async (directoryPath) => {
    if (!directoryPath) {
      ElMessage.warning('请选择题库目录')
      return null
    }

    isImporting.value = true
    try {
      const result = await window.electronAPI.questionBank.import(directoryPath)

      if (result.success) {
        currentImport.value = result.result
        await loadStatistics()
        await loadQuestions()
        ElMessage.success(`题库导入成功！共导入 ${result.result.importedQuestions} 道题目`)
      } else {
        ElMessage.error(`题库导入失败: ${result.error}`)
      }

      return result
    } catch (error) {
      console.error('题库导入失败:', error)
      ElMessage.error('题库导入失败')
      throw error
    } finally {
      isImporting.value = false
      currentImport.value = null
    }
  }

  // 选择题库目录
  const selectDirectory = async () => {
    try {
      const result = await window.electronAPI.questionBank.selectDirectory()

      if (!result.canceled) {
        return result.selectedPath
      }

      return null
    } catch (error) {
      console.error('选择目录失败:', error)
      ElMessage.error('选择目录失败')
      throw error
    }
  }

  // 刷新索引
  const refreshIndex = async () => {
    try {
      const result = await window.electronAPI.questionBank.refreshIndex()
      if (result.success) {
        await loadStatistics()
        await loadQuestions()
        ElMessage.success('索引刷新成功')
      } else {
        ElMessage.error(`索引刷新失败: ${result.error}`)
      }
      return result
    } catch (error) {
      console.error('刷新索引失败:', error)
      ElMessage.error('刷新索引失败')
      throw error
    }
  }

  // 创建备份
  const createBackup = async () => {
    try {
      const result = await window.electronAPI.questionBank.createBackup()
      if (result.success) {
        ElMessage.success('备份创建成功')
      } else {
        ElMessage.error(`备份创建失败: ${result.error}`)
      }
      return result
    } catch (error) {
      console.error('创建备份失败:', error)
      ElMessage.error('创建备份失败')
      throw error
    }
  }

  // 验证完整性
  const validateIntegrity = async () => {
    try {
      const result = await window.electronAPI.questionBank.validateIntegrity()
      if (result.valid) {
        ElMessage.success('题库完整性验证通过')
      } else {
        ElMessage.error(`完整性验证失败: ${result.error}`)
      }
      return result
    } catch (error) {
      console.error('完整性验证失败:', error)
      ElMessage.error('完整性验证失败')
      throw error
    }
  }

  // 获取状态
  const getStatus = async () => {
    try {
      const status = await window.electronAPI.questionBank.getStatus()
      return status
    } catch (error) {
      console.error('获取状态失败:', error)
      throw error
    }
  }

  // 清空筛选条件
  const clearFilters = async () => {
    queryOptions.search = ''
    queryOptions.category = ''
    queryOptions.difficulty = ''
    queryOptions.offset = 0
    pagination.current = 1

    return await loadQuestions()
  }

  // 重置状态
  const reset = () => {
    isInitialized.value = false
    isLoading.value = false
    isImporting.value = false
    currentImport.value = null
    questions.value = []
    selectedQuestion.value = null

    Object.assign(statistics, {
      totalQuestions: 0,
      categories: {},
      tags: {},
      lastUpdated: null
    })

    Object.assign(queryOptions, {
      search: '',
      category: '',
      difficulty: '',
      limit: 50,
      offset: 0
    })

    Object.assign(pagination, {
      total: 0,
      current: 1,
      pageSize: 50
    })
  }

  // 事件监听
  const addEventListener = (eventName, callback) => {
    const listener = (data) => {
      callback(data)
    }

    window.electronAPI.questionBank.on(eventName, listener)
    eventListeners.set(eventName, listener)

    return () => {
      window.electronAPI.questionBank.off(eventName, listener)
      eventListeners.delete(eventName)
    }
  }

  // 导入进度监听
  const onImportProgress = (callback) => {
    return addEventListener('import-progress', callback)
  }

  // 导入完成监听
  const onImportCompleted = (callback) => {
    return addEventListener('import-completed', callback)
  }

  // 导入失败监听
  const onImportFailed = (callback) => {
    return addEventListener('import-failed', callback)
  }

  // 清理资源
  const cleanup = () => {
    for (const [eventName, listener] of eventListeners) {
      window.electronAPI.questionBank.off(eventName, listener)
    }
    eventListeners.clear()
    reset()
  }

  // 生命周期钩子
  onMounted(() => {
    // 组件挂载时自动初始化
    initialize().then(() => {
      loadStatistics()
      loadQuestions()
    })
  })

  onUnmounted(() => {
    cleanup()
  })

  // 返回响应式状态和方法
  return {
    // 状态
    isInitialized,
    isLoading,
    isImporting,
    currentImport,
    statistics,
    questions,
    selectedQuestion,
    queryOptions,
    pagination,

    // 方法
    initialize,
    loadStatistics,
    loadQuestions,
    searchQuestions,
    filterByCategory,
    filterByDifficulty,
    goToPage,
    setPageSize,
    selectQuestion,
    importQuestionBank,
    selectDirectory,
    refreshIndex,
    createBackup,
    validateIntegrity,
    getStatus,
    clearFilters,
    reset,
    cleanup,

    // 事件监听
    addEventListener,
    onImportProgress,
    onImportCompleted,
    onImportFailed
  }
}

export default useQuestionBank