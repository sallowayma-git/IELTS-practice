const BaseLLMService = require('./base')

/**
 * DeepSeek API服务
 */
class DeepSeekService extends BaseLLMService {
  constructor(config) {
    super(config)
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY
    this.model = config.model || process.env.DEFAULT_AI_MODEL || 'deepseek-chat'
    this.baseURL = config.baseURL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      const response = await this.makeRequest('/models', {
        method: 'GET'
      })
      return !!response.data
    } catch (error) {
      console.error('DeepSeek连接测试失败:', error)
      return false
    }
  }

  /**
   * 生成评估
   */
  async generateEvaluation(prompt, essay) {
    const fullPrompt = `${prompt}\n\n作文内容：\n${essay}`

    try {
      const response = await this.makeRequest('/chat/completions', {
        method: 'POST',
        data: {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: '你是一个专业的雅思写作考官，请按照评分标准对作文进行评估。'
            },
            {
              role: 'user',
              content: fullPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        }
      })

      return {
        content: response.data.choices[0].message.content,
        usage: response.data.usage
      }
    } catch (error) {
      throw new Error(`DeepSeek评估失败: ${error.message}`)
    }
  }

  /**
   * 流式生成评估
   */
  async *generateEvaluationStream(prompt, essay) {
    const fullPrompt = `${prompt}\n\n作文内容：\n${essay}`

    try {
      const response = await this.makeRequest('/chat/completions', {
        method: 'POST',
        data: {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: '你是一个专业的雅思写作考官，请按照评分标准对作文进行评估。'
            },
            {
              role: 'user',
              content: fullPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000,
          stream: true
        },
        responseType: 'stream'
      })

      for await (const chunk of this.parseSSE(response.data)) {
        if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
          yield chunk.choices[0].delta.content || ''
        }
      }
    } catch (error) {
      throw new Error(`DeepSeek流式评估失败: ${error.message}`)
    }
  }

  /**
   * 获取模型信息
   */
  getModelInfo() {
    return {
      provider: 'deepseek',
      model: this.model,
      baseUrl: this.baseURL,
      apiKey: this.apiKey ? '***' + this.apiKey.slice(-4) : '未配置'
    }
  }

  /**
   * 获取可用模型
   */
  async getAvailableModels() {
    try {
      const response = await this.makeRequest('/models', {
        method: 'GET'
      })

      return {
        models: response.data.data || [],
        default: 'deepseek-chat'
      }
    } catch (error) {
      // 返回已知模型列表
      return {
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat' },
          { id: 'deepseek-coder', name: 'DeepSeek Coder' }
        ],
        default: 'deepseek-chat'
      }
    }
  }

  /**
   * 发送HTTP请求
   */
  async makeRequest(endpoint, options) {
    const axios = require('axios')
    const url = `${this.baseURL}${endpoint}`

    const config = {
      method: options.method || 'GET',
      url,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    }

    if (options.data) {
      config.data = options.data
    }

    if (options.responseType) {
      config.responseType = options.responseType
    }

    try {
      const response = await axios(config)
      return response
    } catch (error) {
      if (error.response) {
        throw new Error(`DeepSeek API错误 (${error.response.status}): ${error.response.data?.error?.message || error.response.statusText}`)
      } else if (error.request) {
        throw new Error('DeepSeek API无响应，请检查网络连接')
      } else {
        throw new Error(`DeepSeek请求失败: ${error.message}`)
      }
    }
  }
}

module.exports = DeepSeekService