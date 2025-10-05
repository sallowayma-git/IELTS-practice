const BaseLLMService = require('./base')

/**
 * OpenRouter API服务
 */
class OpenRouterService extends BaseLLMService {
  constructor(config) {
    super(config)
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY
    this.model = config.model || process.env.DEFAULT_AI_MODEL || 'openai/gpt-4o'
    this.baseURL = config.baseURL || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    this.appName = config.appName || process.env.OPENROUTER_APP_NAME || 'IELTS Writing Assistant'
    this.siteUrl = config.siteUrl || process.env.OPENROUTER_SITE_URL || 'https://ielts-assistant.app'
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
      console.error('OpenRouter连接测试失败:', error)
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
      throw new Error(`OpenRouter评估失败: ${error.message}`)
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
      throw new Error(`OpenRouter流式评估失败: ${error.message}`)
    }
  }

  /**
   * 获取模型信息
   */
  getModelInfo() {
    return {
      provider: 'openrouter',
      model: this.model,
      baseUrl: this.baseURL,
      appName: this.appName,
      siteUrl: this.siteUrl,
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

      // 过滤出适合写作评估的模型
      const models = response.data.data.filter(model => {
        return model.id.includes('gpt') ||
               model.id.includes('claude') ||
               model.id.includes('gemini') ||
               model.id.includes('deepseek')
      }).slice(0, 20) // 只取前20个模型

      return {
        models: models,
        default: 'openai/gpt-4o'
      }
    } catch (error) {
      // 返回已知模型列表
      return {
        models: [
          { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o' },
          { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
          { id: 'openai/gpt-4', name: 'OpenAI GPT-4' },
          { id: 'openai/gpt-3.5-turbo', name: 'OpenAI GPT-3.5 Turbo' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'Anthropic Claude 3.5 Sonnet' },
          { id: 'anthropic/claude-3.5-haiku', name: 'Anthropic Claude 3.5 Haiku' },
          { id: 'google/gemini-2.0-flash-exp', name: 'Google Gemini 2.0 Flash Exp' },
          { id: 'google/gemini-1.5-pro', name: 'Google Gemini 1.5 Pro' },
          { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
          { id: 'deepseek/deepseek-coder', name: 'DeepSeek Coder' }
        ],
        default: 'openai/gpt-4o'
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
        'Content-Type': 'application/json',
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.appName
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
        throw new Error(`OpenRouter API错误 (${error.response.status}): ${error.response.data?.error?.message || error.response.statusText}`)
      } else if (error.request) {
        throw new Error('OpenRouter API无响应，请检查网络连接')
      } else {
        throw new Error(`OpenRouter请求失败: ${error.message}`)
      }
    }
  }
}

module.exports = OpenRouterService