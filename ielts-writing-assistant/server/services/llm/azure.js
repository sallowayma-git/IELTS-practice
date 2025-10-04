const BaseLLMService = require('./base')
const OpenAI = require('openai')

/**
 * Azure OpenAI服务实现
 */
class AzureOpenAIService extends BaseLLMService {
  constructor(config) {
    super(config)
    this.client = new OpenAI({
      apiKey: config.apiKey,
      azure: {
        endpoint: config.endpoint,
        apiVersion: config.apiVersion || '2024-02-15-preview',
        deployment: config.deployment
      }
    })
    this.deployment = config.deployment
    this.maxTokens = config.maxTokens || 2000
    this.temperature = config.temperature || 0.3
  }

  async testConnection() {
    try {
      const response = await this.client.chat.completions.create({
        model: this.deployment,
        messages: [{ role: 'user', content: 'Hello, can you respond with "OK"?' }],
        max_tokens: 10
      })

      return response.choices[0]?.message?.content?.toLowerCase().includes('ok')
    } catch (error) {
      console.error('Azure OpenAI连接测试失败:', error.message)
      return false
    }
  }

  async assessEssay(params) {
    const startTime = Date.now()
    const prompt = this.buildAssessmentPrompt(params)
    const inputTokens = this.estimateTokens(prompt)

    try {
      const response = await this.client.chat.completions.create({
        model: this.deployment,
        messages: [
          {
            role: 'system',
            content: '你是一位经验丰富的雅思写作评分官，具有丰富的教学和评分经验。请严格按照雅思官方评分标准进行评估。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      })

      const content = response.choices[0].message.content
      const result = this.parseResponse(content)

      if (!this.validateResult(result)) {
        throw new Error('AI评估结果格式不正确')
      }

      const outputTokens = this.estimateTokens(content)
      const evaluationTime = Date.now() - startTime

      return {
        ...result,
        metadata: {
          provider: 'Azure OpenAI',
          model: this.deployment,
          evaluationTime,
          tokenUsage: {
            input: inputTokens,
            output: outputTokens,
            total: inputTokens + outputTokens
          },
          confidence: this.calculateConfidence(result)
        }
      }
    } catch (error) {
      console.error('Azure OpenAI评估失败:', error)
      throw this.formatError(error)
    }
  }

  async* assessEssayStream(params, onProgress) {
    const startTime = Date.now()
    const prompt = this.buildAssessmentPrompt(params)
    const inputTokens = this.estimateTokens(prompt)
    let accumulatedContent = ''

    try {
      const stream = await this.client.chat.completions.create({
        model: this.deployment,
        messages: [
          {
            role: 'system',
            content: '你是一位经验丰富的雅思写作评分官，具有丰富的教学和评分经验。请严格按照雅思官方评分标准进行评估。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: true
      })

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          accumulatedContent += content

          try {
            const partialResult = this.parseResponse(accumulatedContent)
            if (this.validateResult(partialResult)) {
              yield {
                type: 'progress',
                content: partialResult,
                accumulated: accumulatedContent
              }

              if (onProgress) {
                onProgress({
                  stage: 'processing',
                  progress: Math.min(accumulatedContent.length / 1000, 0.9),
                  message: '正在分析AI评估结果...'
                })
              }
            }
          } catch (error) {
            // 还没形成完整的JSON，继续累积
          }
        }
      }

      const finalResult = this.parseResponse(accumulatedContent)
      if (!this.validateResult(finalResult)) {
        throw new Error('AI评估结果格式不正确')
      }

      const outputTokens = this.estimateTokens(accumulatedContent)
      const evaluationTime = Date.now() - startTime

      yield {
        type: 'complete',
        content: {
          ...finalResult,
          metadata: {
            provider: 'Azure OpenAI',
            model: this.deployment,
            evaluationTime,
            tokenUsage: {
              input: inputTokens,
              output: outputTokens,
              total: inputTokens + outputTokens
            },
            confidence: this.calculateConfidence(finalResult)
          }
        }
      }

    } catch (error) {
      console.error('Azure OpenAI流式评估失败:', error)
      yield {
        type: 'error',
        error: this.formatError(error)
      }
    }
  }

  getModelInfo() {
    return {
      name: 'Azure OpenAI',
      model: this.deployment,
      provider: 'Microsoft Azure',
      capabilities: [
        'text-generation',
        'streaming',
        'enterprise-grade',
        'data-privacy'
      ],
      limits: {
        maxTokens: 4096,
        maxInputTokens: 4096 - this.maxTokens
      }
    }
  }

  calculateConfidence(result) {
    const scores = [
      result.task_response?.score || 0,
      result.coherence?.score || 0,
      result.vocabulary?.score || 0,
      result.grammar?.score || 0
    ]

    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length

    const confidence = Math.max(0, 1 - variance / 4)
    return Math.round(confidence * 100) / 100
  }
}

module.exports = AzureOpenAIService