import { ref, reactive } from 'vue'
import axios from 'axios'

export function useApiKeys() {
  const loading = ref(false)
  const apiKeys = reactive({
    openai: { hasKey: false, keyPreview: null },
    gemini: { hasKey: false, keyPreview: null },
    deepseek: { hasKey: false, keyPreview: null },
    openrouter: { hasKey: false, keyPreview: null }
  })

  // 获取所有API密钥状态
  const fetchApiKeysStatus = async () => {
    try {
      loading.value = true
      const response = await axios.get('/api/api-keys/status')
      if (response.data.success) {
        Object.assign(apiKeys, response.data.data)
      }
    } catch (error) {
      console.error('获取API密钥状态失败:', error)
    } finally {
      loading.value = false
    }
  }

  // 保存API密钥
  const saveApiKey = async (provider, apiKey) => {
    try {
      const response = await axios.post('/api/api-keys/save', {
        provider,
        apiKey
      })

      if (response.data.success) {
        // 更新本地状态
        apiKeys[provider] = {
          hasKey: true,
          keyPreview: `****${apiKey.slice(-4)}`
        }
        return true
      }
      return false
    } catch (error) {
      console.error('保存API密钥失败:', error)
      throw error
    }
  }

  // 删除API密钥
  const deleteApiKey = async (provider) => {
    try {
      const response = await axios.delete(`/api/api-keys/${provider}`)

      if (response.data.success) {
        // 更新本地状态
        apiKeys[provider] = {
          hasKey: false,
          keyPreview: null
        }
        return true
      }
      return false
    } catch (error) {
      console.error('删除API密钥失败:', error)
      throw error
    }
  }

  return {
    loading,
    apiKeys,
    fetchApiKeysStatus,
    saveApiKey,
    deleteApiKey
  }
}