import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

// 创建axios实例
const api = axios.create({
  baseURL: '/api',
  timeout: 30000 // 评估可能需要更长时间
})

function toScore(value) {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  if (Number.isNaN(num)) return null
  return Math.round(num * 10) / 10
}

function parseJsonValue(value, fallback) {
  if (!value && value !== 0) return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch (error) {
    return fallback
  }
}

function normalizeList(value) {
  if (!value && value !== 0) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      const parsed = parseJsonValue(trimmed, [])
      return Array.isArray(parsed) ? parsed : []
    }
    return trimmed.split(/\n+|;|,/).map(item => item.trim()).filter(Boolean)
  }
  return []
}

function normalizeTextList(value) {
  return normalizeList(value)
    .map(item => {
      if (!item && item !== 0) return null
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        if (item.text) return item.text
        if (item.content) return item.content
        if (item.message) return item.message
        return Object.values(item)
          .filter(Boolean)
          .map(part => part.toString().trim())
          .join(' ')
      }
      return item.toString()
    })
    .filter(Boolean)
}

function buildCriteria(rawScores, rawFeedback) {
  return [
    {
      key: 'taskAchievement',
      name: '任务回应',
      score: toScore(rawScores.taskAchievement),
      feedback: rawFeedback.taskAchievement || ''
    },
    {
      key: 'coherence',
      name: '连贯与衔接',
      score: toScore(rawScores.coherence),
      feedback: rawFeedback.coherence || ''
    },
    {
      key: 'lexicalResource',
      name: '词汇资源',
      score: toScore(rawScores.lexicalResource),
      feedback: rawFeedback.lexicalResource || ''
    },
    {
      key: 'grammar',
      name: '语法准确性',
      score: toScore(rawScores.grammar),
      feedback: rawFeedback.grammar || ''
    }
  ]
}

function normalizeAssessmentResult(raw = {}, extras = {}) {
  const taskScores = {
    taskAchievement:
      raw.task_response?.score ?? raw.task_response_score ?? raw.taskAchievement ?? null,
    coherence: raw.coherence?.score ?? raw.coherence_score ?? raw.coherence ?? null,
    lexicalResource: raw.vocabulary?.score ?? raw.vocabulary_score ?? raw.lexicalResource ?? null,
    grammar: raw.grammar?.score ?? raw.grammar_score ?? raw.grammar ?? null
  }

  const taskFeedback = {
    taskAchievement:
      raw.task_response?.feedback ?? raw.task_response_feedback ?? raw.taskAchievementFeedback ?? '',
    coherence: raw.coherence?.feedback ?? raw.coherence_feedback ?? raw.coherenceFeedback ?? '',
    lexicalResource:
      raw.vocabulary?.feedback ?? raw.vocabulary_feedback ?? raw.lexicalResourceFeedback ?? '',
    grammar: raw.grammar?.feedback ?? raw.grammar_feedback ?? raw.grammarFeedback ?? ''
  }

  const strengths = normalizeTextList(raw.strengths ?? extras.strengths)
  const improvements = normalizeTextList(raw.improvements ?? extras.improvements)
  const suggestions = normalizeList(raw.suggestions ?? extras.suggestions)

  const detailedRaw = parseJsonValue(raw.detailed_feedback ?? raw.detailedFeedback, null)
  const detailedFeedback = []

  if (strengths.length) {
    detailedFeedback.push({ title: '优点', items: strengths })
  }

  if (improvements.length) {
    detailedFeedback.push({ title: '需要改进', items: improvements })
  }

  if (detailedRaw?.criteriaBreakdown) {
    const breakdownItems = Object.entries(detailedRaw.criteriaBreakdown).map(([key, value]) => {
      const scoreText = value?.score !== undefined ? `${value.score.toFixed ? value.score.toFixed(1) : value.score}分` : '—'
      return `${key}: ${scoreText}${value?.bandDescription ? ` - ${value.bandDescription}` : ''}`
    })
    if (breakdownItems.length) {
      detailedFeedback.push({ title: '评分拆解', items: breakdownItems })
    }
  }

  if (Array.isArray(detailedRaw?.recommendations) && detailedRaw.recommendations.length) {
    detailedFeedback.push({ title: '系统建议', items: normalizeTextList(detailedRaw.recommendations) })
  }

  const tokenUsage = parseJsonValue(raw.token_usage ?? raw.tokenUsage, {})

  const metadata = {
    provider: raw.ai_provider || raw.metadata?.provider || extras.metadata?.provider || 'Unknown',
    model: raw.ai_model || raw.metadata?.model || extras.metadata?.model || '',
    evaluationTime:
      raw.evaluation_time ?? raw.metadata?.evaluationTime ?? extras.metadata?.evaluationTime ?? null,
    tokenUsage,
    confidence: raw.confidence_score ?? raw.metadata?.confidence ?? extras.metadata?.confidence ?? null,
    wordCount: raw.metadata?.wordCount ?? extras.metadata?.wordCount ?? extras.wordCount ?? null,
    paragraphCount: raw.metadata?.paragraphCount ?? extras.metadata?.paragraphCount ?? null,
    sentenceCount: raw.metadata?.sentenceCount ?? extras.metadata?.sentenceCount ?? null
  }

  const overallScoreValue = raw.overall_score ?? raw.totalScore ?? null
  const overallScore = overallScoreValue !== null ? toScore(overallScoreValue) : null

  return {
    id: raw.id ?? extras.id ?? null,
    writingId: extras.writingId ?? raw.writing_id ?? raw.writingId ?? null,
    overallScore,
    totalScore: overallScore,
    level: raw.level ?? extras.level ?? '',
    overallFeedback: raw.description ?? raw.overallFeedback ?? '',
    topicTitle: extras.topicTitle ?? raw.topic_title ?? raw.topicTitle ?? '',
    content: extras.content ?? raw.content ?? '',
    originalContent: extras.content ?? raw.content ?? '',
    createdAt: raw.created_at ?? extras.createdAt ?? null,
    metadata,
    taskAchievement: toScore(taskScores.taskAchievement),
    taskAchievementFeedback: taskFeedback.taskAchievement,
    coherence: toScore(taskScores.coherence),
    coherenceFeedback: taskFeedback.coherence,
    lexicalResource: toScore(taskScores.lexicalResource),
    lexicalResourceFeedback: taskFeedback.lexicalResource,
    grammar: toScore(taskScores.grammar),
    grammarFeedback: taskFeedback.grammar,
    criteria: buildCriteria(taskScores, taskFeedback),
    strengths,
    improvements,
    suggestions,
    detailedFeedback
  }
}

export const useAssessmentStore = defineStore('assessment', () => {
  // 状态
  const currentAssessment = ref(null)
  const assessmentHistory = ref([])
  const isLoading = ref(false)
  const error = ref(null)

  // 方法
  const getAssessmentById = async (assessmentId, options = {}) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get(`/assessment/results/${assessmentId}`)
      if (response.data.success) {
        const raw = response.data.data
        let extras = { writingId: raw.writing_id }

        if (options.includeContent !== false && raw.writing_id) {
          try {
            const writingResponse = await api.get(`/writing/records/${raw.writing_id}`)
            if (writingResponse.data.success) {
              const writing = writingResponse.data.data
              extras = {
                ...extras,
                content: writing.content,
                topicTitle: writing.topic_title,
                createdAt: writing.created_at
              }
            }
          } catch (fetchError) {
            console.warn('加载写作原文失败:', fetchError.message)
          }
        }

        const normalized = normalizeAssessmentResult(raw, extras)
        currentAssessment.value = normalized
        return normalized
      }
    } catch (err) {
      error.value = err.response?.data?.message || '获取评估结果失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const getAssessmentByWritingId = async (writingId, options = {}) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get(`/assessment/writing/${writingId}`)
      if (response.data.success) {
        const raw = response.data.data
        const extras = { writingId }

        if (options.includeContent !== false) {
          try {
            const writingResponse = await api.get(`/writing/records/${writingId}`)
            if (writingResponse.data.success) {
              const writing = writingResponse.data.data
              extras.content = writing.content
              extras.topicTitle = writing.topic_title
              extras.createdAt = writing.created_at
            }
          } catch (fetchError) {
            console.warn('加载写作原文失败:', fetchError.message)
          }
        }

        const normalized = normalizeAssessmentResult(raw, extras)
        currentAssessment.value = normalized
        return normalized
      }
    } catch (err) {
      error.value = err.response?.data?.message || '获取评估结果失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const submitForAssessment = async (writingData, extras = {}) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post('/assessment/submit', writingData)
      if (response.data.success) {
        const normalized = normalizeAssessmentResult(response.data.data, extras)
        currentAssessment.value = normalized
        return normalized
      }
    } catch (err) {
      error.value = err.response?.data?.message || '提交评估失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const setCurrentAssessment = (raw, extras = {}) => {
    currentAssessment.value = normalizeAssessmentResult(raw, extras)
    return currentAssessment.value
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
    setCurrentAssessment,
    clearAssessment,
    getScoreColor,
    getScoreLevel,
    formatSuggestions
  }
})