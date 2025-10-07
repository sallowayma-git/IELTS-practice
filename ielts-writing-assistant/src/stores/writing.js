import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

// 创建axios实例
const api = axios.create({
  baseURL: '/api',
  timeout: 10000
})

export const useWritingStore = defineStore('writing', () => {
  // 状态
  const currentTopic = ref(null)
  const writingContent = ref('')
  const wordCount = ref(0)
  const timerSeconds = ref(0)
  const isTimerRunning = ref(false)
  const timerInterval = ref(null)
  const isSubmitting = ref(false)
  const currentWritingId = ref(null)
  const taskType = ref('task1')
  const aiProvider = ref('openai')
  const aiModel = ref('gpt-4-turbo')

  // 计算属性
  const formattedTime = computed(() => {
    const minutes = Math.floor(timerSeconds.value / 60)
    const seconds = timerSeconds.value % 60
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  })

  const wordCountValid = computed(() => {
    return wordCount.value >= (currentTopic.value?.min_words || 250)
  })

  // 方法
  const selectTopic = async (topicId) => {
    try {
      const response = await api.get(`/writing/topics/${topicId}`)
      if (response.data.success) {
        currentTopic.value = response.data.data
        resetWriting()
      }
    } catch (error) {
      console.error('获取题目失败:', error)
      throw error
    }
  }

  const getRandomTopic = async (type = null) => {
    try {
      const params = type ? { taskType: type } : {}
      const response = await api.get('/writing/topics/random', { params })
      if (response.data.success && response.data.data) {
        currentTopic.value = response.data.data
        resetWriting()
        return
      }
      // 如果后端不支持随机接口，则回退到列表接口
      const fallbackParams = type ? { type, limit: 1 } : { limit: 1 }
      const fallbackResponse = await api.get('/writing/topics', { params: fallbackParams })
      if (fallbackResponse.data.success && Array.isArray(fallbackResponse.data.data) && fallbackResponse.data.data.length > 0) {
        currentTopic.value = fallbackResponse.data.data[0]
        resetWriting()
      }
    } catch (error) {
      console.error('获取随机题目失败:', error)
      currentTopic.value = {
        id: 'local-fallback',
        title: 'Some people think that universities should provide graduates with practical skills for the workplace.',
        type: 'task2',
        content:
          'Some people think that universities should provide graduates with the knowledge and skills needed in the workplace. Others think that university education should be more theoretical. Discuss both views and give your own opinion.',
        min_words: 250,
        time_limit: 40
      }
      resetWriting()
    }
  }

  const setTaskType = async (type) => {
    if (taskType.value === type) return
    taskType.value = type
    await getRandomTopic(type)
  }

  const setAiProvider = (provider) => {
    aiProvider.value = provider
  }

  const setAiModel = (model) => {
    aiModel.value = model
  }

  const updateContent = (content) => {
    writingContent.value = content
    updateWordCount(content)
  }

  const updateWordCount = (content) => {
    const text = content.replace(/<[^>]*>/g, '')
    const englishWords = text.match(/[a-zA-Z]+/g) || []
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || []
    wordCount.value = englishWords.length + chineseChars.length
  }

  const startTimer = () => {
    if (!isTimerRunning.value) {
      isTimerRunning.value = true
      timerInterval.value = setInterval(() => {
        timerSeconds.value++
      }, 1000)
    }
  }

  const stopTimer = () => {
    if (timerInterval.value) {
      clearInterval(timerInterval.value)
      timerInterval.value = null
    }
    isTimerRunning.value = false
  }

  const resetTimer = () => {
    stopTimer()
    timerSeconds.value = 0
  }

  const resetWriting = () => {
    writingContent.value = ''
    wordCount.value = 0
    resetTimer()
    currentWritingId.value = null
  }

  const saveDraft = async () => {
    try {
      if (!currentTopic.value || !writingContent.value) {
        return
      }

      const data = {
        topicId: currentTopic.value.id,
        topicTitle: currentTopic.value.title,
        topicType: currentTopic.value.type,
        content: writingContent.value,
        wordCount: wordCount.value,
        timeSpent: timerSeconds.value
      }

      if (currentWritingId.value) {
        // 更新现有记录
        await api.put(`/writing/records/${currentWritingId.value}`, data)
      } else {
        // 创建新记录
        const response = await api.post('/writing/records', data)
        if (response.data.success) {
          currentWritingId.value = response.data.data.id
        }
      }

      // 同时保存到localStorage作为备份
      localStorage.setItem('writing-draft', writingContent.value)

    } catch (error) {
      console.error('保存草稿失败:', error)
      throw error
    }
  }

  const loadDraft = async () => {
    try {
      // 优先从localStorage加载
      const localDraft = localStorage.getItem('writing-draft')
      if (localDraft) {
        writingContent.value = localDraft
        updateWordCount(localDraft)
      }
    } catch (error) {
      console.error('加载草稿失败:', error)
    }
  }

  const submitWriting = async (options = {}) => {
    if (!currentTopic.value || !writingContent.value) {
      throw new Error('缺少题目或内容')
    }

    if (!wordCountValid.value) {
      throw new Error(`字数不足，最少需要${currentTopic.value.min_words}词`)
    }

    isSubmitting.value = true

    try {
      // 先保存写作记录
      const data = {
        topicId: currentTopic.value.id,
        topicTitle: currentTopic.value.title,
        topicType: currentTopic.value.type,
        content: writingContent.value,
        wordCount: wordCount.value,
        timeSpent: timerSeconds.value
      }

      let writingId = currentWritingId.value
      if (!writingId) {
        const response = await api.post('/writing/records', data)
        if (response.data.success) {
          writingId = response.data.data.id
          currentWritingId.value = writingId
        }
      } else {
        await api.put(`/writing/records/${writingId}`, data)
      }

      // 提交AI评估
      const assessmentResponse = await api.post('/assessment/submit', {
        writingId,
        content: writingContent.value,
        topic: currentTopic.value,
        taskType: options.taskType || taskType.value,
        aiProvider: options.aiProvider || aiProvider.value,
        aiModel: options.aiModel || aiModel.value
      })

      if (assessmentResponse.data.success) {
        // 清除本地草稿
        localStorage.removeItem('writing-draft')
        return {
          result: assessmentResponse.data.data,
          writingId
        }
      }

    } catch (error) {
      console.error('提交写作失败:', error)
      throw error
    } finally {
      isSubmitting.value = false
    }
  }

  // 清理函数
  const cleanup = () => {
    stopTimer()
  }

  return {
    // 状态
    currentTopic,
    writingContent,
    wordCount,
    timerSeconds,
    isTimerRunning,
    isSubmitting,
    currentWritingId,
    taskType,
    aiProvider,
    aiModel,

    // 计算属性
    formattedTime,
    wordCountValid,

    // 方法
    selectTopic,
    getRandomTopic,
    setTaskType,
    setAiProvider,
    setAiModel,
    updateContent,
    startTimer,
    stopTimer,
    resetTimer,
    resetWriting,
    saveDraft,
    loadDraft,
    submitWriting,
    cleanup
  }
})