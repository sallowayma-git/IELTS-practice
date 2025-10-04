import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

// 创建axios实例
const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  timeout: 30000 // 评估可能需要更长时间
})

export const useAssessmentStore = defineStore('assessment', () => {
  // 状态
  const currentAssessment = ref(null)
  const assessmentHistory = ref([])
  const isLoading = ref(false)
  const error = ref(null)

  // 方法
  const getAssessmentById = async (assessmentId) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get(`/assessment/results/${assessmentId}`)
      if (response.data.success) {
        currentAssessment.value = response.data.data
        return response.data.data
      }
    } catch (err) {
      error.value = err.response?.data?.message || '获取评估结果失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const getAssessmentByWritingId = async (writingId) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get(`/assessment/writing/${writingId}`)
      if (response.data.success) {
        currentAssessment.value = response.data.data
        return response.data.data
      }
    } catch (err) {
      error.value = err.response?.data?.message || '获取评估结果失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const submitForAssessment = async (writingData) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post('/assessment/submit', writingData)
      if (response.data.success) {
        currentAssessment.value = response.data.data
        return response.data.data
      }
    } catch (err) {
      error.value = err.response?.data?.message || '提交评估失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const clearAssessment = () => {
    currentAssessment.value = null
    error.value = null
  }

  const getScoreColor = (score) => {
    if (score >= 7) return '#67C23A'
    if (score >= 6) return '#E6A23C'
    return '#F56C6C'
  }

  const getScoreLevel = (score) => {
    if (score >= 7) return '优秀水平'
    if (score >= 6) return '合格水平'
    if (score >= 5) return '基础水平'
    return '需要改进'
  }

  const formatSuggestions = (suggestions) => {
    if (!suggestions) return []
    return Array.isArray(suggestions) ? suggestions : []
  }

  return {
    // 状态
    currentAssessment,
    assessmentHistory,
    isLoading,
    error,

    // 方法
    getAssessmentById,
    getAssessmentByWritingId,
    submitForAssessment,
    clearAssessment,
    getScoreColor,
    getScoreLevel,
    formatSuggestions
  }
})