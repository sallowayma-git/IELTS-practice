const express = require('express')
const router = express.Router()
const { v4: uuidv4 } = require('uuid')
const LLMServiceFactory = require('../services/llm/factory')

// AI评估服务管理器
class AssessmentService {
  constructor() {
    this.currentService = null
    this.currentConfig = null
  }

  // 初始化AI服务
  async initializeService(config) {
    try {
      const provider = config.provider || 'mock'
      const service = LLMServiceFactory.createService(provider, config)

      // 测试连接
      const isConnected = await service.testConnection()
      if (!isConnected) {
        throw new Error(`${provider}服务连接失败`)
      }

      this.currentService = service
      this.currentConfig = config

      console.log(`AI服务初始化成功: ${provider}`)
      return true
    } catch (error) {
      console.error('AI服务初始化失败:', error)
      throw error
    }
  }

  // 获取当前服务
  getService() {
    if (!this.currentService) {
      throw new Error('AI服务未初始化')
    }
    return this.currentService
  }

  // 评估作文
  async assessEssay(params) {
    try {
      const service = this.getService()
      return await service.assessEssay(params)
    } catch (error) {
      console.error('AI评估失败:', error)
      throw error
    }
  }

  // 流式评估作文
  async* assessEssayStream(params, onProgress) {
    try {
      const service = this.getService()
      yield* service.assessEssayStream(params, onProgress)
    } catch (error) {
      console.error('AI流式评估失败:', error)
      throw error
    }
  }
}

// 创建评估服务实例
const assessmentService = new AssessmentService()

// 初始化默认AI服务
assessmentService.initializeService({
  provider: 'mock',
  responseTime: 2000,
  errorRate: 0
}).catch(console.error)

// 配置AI服务
router.post('/configure', async (req, res) => {
  try {
    const { provider, config } = req.body

    if (!provider) {
      return res.status(400).json({
        success: false,
        message: '缺少提供商信息'
      })
    }

    const serviceConfig = { provider, ...config }
    await assessmentService.initializeService(serviceConfig)

    res.json({
      success: true,
      message: 'AI服务配置成功',
      data: {
        provider,
        model: assessmentService.getService().getModelInfo()
      }
    })
  } catch (error) {
    console.error('配置AI服务失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '配置AI服务失败'
    })
  }
})

// 测试AI服务连接
router.post('/test-connection', async (req, res) => {
  try {
    const { provider, config } = req.body

    const success = await LLMServiceFactory.testProvider(provider, config)

    res.json({
      success: true,
      data: {
        provider,
        connected: success
      }
    })
  } catch (error) {
    console.error('测试连接失败:', error)
    res.status(500).json({
      success: false,
      message: error.message || '测试连接失败'
    })
  }
})

// 获取支持的AI提供商
router.get('/providers', (req, res) => {
  try {
    const providers = LLMServiceFactory.getSupportedProviders()

    res.json({
      success: true,
      data: providers
    })
  } catch (error) {
    console.error('获取提供商列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取提供商列表失败'
    })
  }
})

// 提交作文进行AI评估
router.post('/submit', async (req, res, next) => {
  try {
    const { writingId, content, topic, streaming = false } = req.body

    if (!writingId || !content || !topic) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    // 验证字数
    const textContent = content.replace(/<[^>]*>/g, '')
    const wordCount = textContent.match(/[a-zA-Z]+/g)?.length || 0
    const chineseChars = textContent.match(/[\u4e00-\u9fa5]/g)?.length || 0
    const totalWords = wordCount + chineseChars

    if (totalWords < (topic.min_words || 250)) {
      return res.status(400).json({
        success: false,
        message: `字数不足，最少需要${topic.min_words || 250}词`
      })
    }

    const assessmentParams = {
      content,
      topic,
      type: 'full'
    }

    if (streaming) {
      // 流式响应 - 使用Server-Sent Events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      })

      // 发送开始事件
      res.write(`data: ${JSON.stringify({
        type: 'start',
        message: 'AI评估开始...'
      })}\n\n`)

      try {
        // 流式评估
        for await (const chunk of assessmentService.assessEssayStream(
          assessmentParams,
          (progress) => {
            res.write(`data: ${JSON.stringify({
              type: 'progress',
              ...progress
            })}\n\n`)
          }
        )) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)

          if (chunk.type === 'complete') {
            // 保存评估结果到数据库
            const savedResult = await saveAssessmentResult(req.db, writingId, chunk.content)
            // 将保存的ID添加到结果中
            chunk.content.id = savedResult.id
            res.write(`data: ${JSON.stringify(chunk)}\n\n`)
            break
          }

          if (chunk.type === 'error') {
            throw new Error(chunk.error.message)
          }
        }

        // 发送完成事件
        res.write(`data: ${JSON.stringify({
          type: 'end',
          message: 'AI评估完成'
        })}\n\n`)

      } catch (error) {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          message: error.message
        })}\n\n`)
      }

      res.end()
      return
    }

    // 普通评估
    const result = await assessmentService.assessEssay(assessmentParams)

    // 保存评估结果到数据库
    const savedResult = await saveAssessmentResult(req.db, writingId, result)

    res.json({
      success: true,
      data: {
        id: savedResult.id,
        ...result
      },
      message: '评估完成'
    })

  } catch (error) {
    console.error('AI评估失败:', error)
    next(error)
  }
})

// 保存评估结果到数据库
async function saveAssessmentResult(db, writingId, result) {
  const id = uuidv4()

  const stmt = db.prepare(`
    INSERT INTO assessment_results (
      id, writing_id, overall_score, level, description,
      task_response_score, task_response_feedback,
      coherence_score, coherence_feedback,
      vocabulary_score, vocabulary_feedback,
      grammar_score, grammar_feedback,
      detailed_feedback, suggestions, strengths, improvements,
      ai_model, ai_provider, evaluation_time, token_usage, confidence_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    writingId,
    result.overall_score,
    result.level,
    result.description,
    result.task_response?.score,
    result.task_response?.feedback,
    result.coherence?.score,
    result.coherence?.feedback,
    result.vocabulary?.score,
    result.vocabulary?.feedback,
    result.grammar?.score,
    result.grammar?.feedback,
    JSON.stringify(result.strengths || []),
    JSON.stringify(result.improvements || []),
    JSON.stringify(result.suggestions || []),
    result.metadata?.model || 'unknown',
    result.metadata?.provider || 'unknown',
    result.metadata?.evaluationTime || 0,
    JSON.stringify(result.metadata?.tokenUsage || {}),
    result.metadata?.confidence || 0
  )

  return { id }
}

// 获取评估结果
router.get('/results/:id', (req, res) => {
  try {
    const { id } = req.params

    const result = req.db.prepare(`
      SELECT *,
             detailed_feedback as detailedFeedback,
             suggestions as suggestionsJson
      FROM assessment_results
      WHERE id = ?
    `).get(id)

    if (!result) {
      return res.status(404).json({
        success: false,
        message: '评估结果不存在'
      })
    }

    // 解析JSON字段
    const data = {
      ...result,
      strengths: JSON.parse(result.strengths || '[]'),
      improvements: JSON.parse(result.improvements || '[]'),
      suggestions: JSON.parse(result.suggestions || '[]'),
      tokenUsage: JSON.parse(result.token_usage || '{}')
    }

    // 移除原始JSON字段
    delete data.detailedFeedback
    delete data.suggestionsJson

    res.json({
      success: true,
      data
    })
  } catch (error) {
    console.error('获取评估结果失败:', error)
    res.status(500).json({
      success: false,
      message: '获取评估结果失败'
    })
  }
})

// 获取写作记录的评估结果
router.get('/writing/:writingId', (req, res) => {
  try {
    const { writingId } = req.params

    const result = req.db.prepare(`
      SELECT *,
             detailed_feedback as detailedFeedback,
             suggestions as suggestionsJson
      FROM assessment_results
      WHERE writing_id = ?
    `).get(writingId)

    if (!result) {
      return res.status(404).json({
        success: false,
        message: '该写作记录暂无评估结果'
      })
    }

    // 解析JSON字段
    const data = {
      ...result,
      strengths: JSON.parse(result.strengths || '[]'),
      improvements: JSON.parse(result.improvements || '[]'),
      suggestions: JSON.parse(result.suggestions || '[]'),
      tokenUsage: JSON.parse(result.token_usage || '{}')
    }

    res.json({
      success: true,
      data
    })
  } catch (error) {
    console.error('获取评估结果失败:', error)
    res.status(500).json({
      success: false,
      message: '获取评估结果失败'
    })
  }
})

module.exports = router