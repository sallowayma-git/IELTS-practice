import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

// 创建axios实例
const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  timeout: 10000
})

export const useSettingsStore = defineStore('settings', () => {
  // 状态
  const settings = ref({
    general: {
      language: 'zh-CN',
      theme: 'light',
      autoSave: true,
      saveInterval: 60
    },
    ai: {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      speed: 'balanced',
      streaming: true
    },
    writing: {
      fontSize: 16,
      autoTimer: true,
      wordCountReminder: true,
      targetWords: 250,
      grammarCheck: true
    }
  })

  const isLoading = ref(false)
  const error = ref(null)

  // 方法
  const loadSettings = async () => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get('/settings/')
      if (response.data.success) {
        settings.value = response.data.data
      }
    } catch (err) {
      error.value = err.response?.data?.message || '加载设置失败'
      // 使用默认设置
      console.warn('加载设置失败，使用默认设置:', err)
    } finally {
      isLoading.value = false
    }
  }

  const saveSettings = async (category, categorySettings) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.put('/settings/', {
        category,
        settings: categorySettings
      })

      if (response.data.success) {
        // 更新本地状态
        settings.value[category] = { ...settings.value[category], ...categorySettings }

        // 同时保存到localStorage作为备份
        localStorage.setItem(`settings-${category}`, JSON.stringify(categorySettings))
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || '保存设置失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const getCategorySettings = (category) => {
    return settings.value[category] || {}
  }

  const updateSetting = (category, key, value) => {
    if (settings.value[category]) {
      settings.value[category][key] = value
    }
  }

  const resetSettings = async (category = null) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post('/settings/reset', { category })

      if (response.data.success) {
        if (category) {
          // 重置特定类别
          const defaultSettings = getDefaultSettings()
          settings.value[category] = defaultSettings[category]
        } else {
          // 重置所有设置
          settings.value = getDefaultSettings()
        }
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || '重置设置失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const testAIConnection = async (aiConfig) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post('/settings/test-ai-connection', aiConfig)

      if (response.data.success) {
        return response.data.data
      }
    } catch (err) {
      error.value = err.response?.data?.message || '测试连接失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const exportSettings = async () => {
    try {
      const response = await api.get('/settings/export')
      if (response.data.success) {
        return response.data
      }
    } catch (err) {
      error.value = err.response?.data?.message || '导出设置失败'
      throw err
    }
  }

  const importSettings = async (settingsData) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post('/settings/import', { settings: settingsData })

      if (response.data.success) {
        // 重新加载设置
        await loadSettings()
      }

      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || '导入设置失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const getStorageInfo = async () => {
    try {
      const response = await api.get('/settings/storage-info')
      if (response.data.success) {
        return response.data.data
      }
    } catch (err) {
      error.value = err.response?.data?.message || '获取存储信息失败'
      throw err
    }
  }

  const clearCache = async () => {
    try {
      const response = await api.post('/settings/clear-cache')
      if (response.data.success) {
        return response.data
      }
    } catch (err) {
      error.value = err.response?.data?.message || '清除缓存失败'
      throw err
    }
  }

  // 获取默认设置
  const getDefaultSettings = () => {
    return {
      general: {
        language: 'zh-CN',
        theme: 'light',
        autoSave: true,
        saveInterval: 60
      },
      ai: {
        provider: 'openai',
        apiKey: '',
        model: 'gpt-3.5-turbo',
        speed: 'balanced',
        streaming: true
      },
      writing: {
        fontSize: 16,
        autoTimer: true,
        wordCountReminder: true,
        targetWords: 250,
        grammarCheck: true
      }
    }
  }

  // 从localStorage加载设置作为后备
  const loadFromLocalStorage = () => {
    try {
      Object.keys(settings.value).forEach(category => {
        const saved = localStorage.getItem(`settings-${category}`)
        if (saved) {
          const categorySettings = JSON.parse(saved)
          settings.value[category] = { ...settings.value[category], ...categorySettings }
        }
      })
    } catch (error) {
      console.warn('从localStorage加载设置失败:', error)
    }
  }

  return {
    // 状态
    settings,
    isLoading,
    error,

    // 方法
    loadSettings,
    saveSettings,
    getCategorySettings,
    updateSetting,
    resetSettings,
    testAIConnection,
    exportSettings,
    importSettings,
    getStorageInfo,
    clearCache,
    loadFromLocalStorage
  }
})