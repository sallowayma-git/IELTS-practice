const BaseLLMService = require('./base')
const { GoogleGenerativeAI } = require('@google/generative-ai')

/**
 * Gemini服务实现
 */
class GeminiService extends BaseLLMService {
  constructor(config) {
    super(config)
    this.client = new GoogleGenerativeAI(config.apiKey)
    this.modelName = config.model || 'gemini-pro'
    this.maxTokens = config.maxTokens || 2000
    this.temperature = config.temperature || 0.3
  }

  async testConnection() {
    try {
      const model = this.client.getGenerativeModel({ model: this.modelName })
      const result = await model.generateContent('Hello, can you respond with "OK"?')
      const response = result.response

      return {
        success: true,
        latency: Date.now(),
        message: 'Gemini连接成功',
        model: this.modelName
      }
    } catch (error) {
      console.error('Gemini连接测试失败:', error.message)
      return {
        success: false,
        error: error.message,
        message: 'Gemini连接失败'
      }
    }
  }

  async evaluate(essay, topic, taskType) {
    try {
      const model = this.client.getGenerativeModel({ model: this.modelName })

      const prompt = this.buildPrompt(essay, topic, taskType)
      const result = await model.generateContent(prompt)
      const response = result.response
      const text = response.text()

      // 尝试解析JSON响应
      let evaluation
      try {
        evaluation = JSON.parse(text)
      } catch (parseError) {
        // 如果解析失败，尝试从文本中提取JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          evaluation = JSON.parse(jsonMatch[0])
        } else {
          throw new Error('无法解析AI响应为JSON格式')
        }
      }

      return {
        success: true,
        data: {
          ...evaluation,
          provider: 'Gemini',
          model: this.modelName,
          timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      console.error('Gemini评估失败:', error)
      return {
        success: false,
        error: error.message,
        provider: 'Gemini'
      }
    }
  }

  async evaluateStream(essay, topic, taskType, onProgress) {
    try {
      const model = this.client.getGenerativeModel({ model: this.modelName })

      const prompt = this.buildPrompt(essay, topic, taskType)

      const result = await model.generateContentStream(prompt)

      let accumulatedText = ''

      for await (const chunk of result.stream) {
        const chunkText = chunk.text()
        accumulatedText += chunkText

        // 尝试解析累积的文本
        try {
          const jsonMatch = accumulatedText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const partialEvaluation = JSON.parse(jsonMatch[0])
            onProgress({
              type: 'partial',
              data: partialEvaluation
            })
          }
        } catch (e) {
          // 还未形成完整JSON，继续累积
        }

        onProgress({
          type: 'chunk',
          data: chunkText
        })
      }

      // 最终解析
      let finalEvaluation
      try {
        const jsonMatch = accumulatedText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          finalEvaluation = JSON.parse(jsonMatch[0])
        } else {
          throw new Error('无法解析AI响应为JSON格式')
        }
      } catch (error) {
        throw new Error('流式响应解析失败')
      }

      onProgress({
        type: 'complete',
        data: {
          ...finalEvaluation,
          provider: 'Gemini',
          model: this.modelName,
          timestamp: new Date().toISOString()
        }
      })

    } catch (error) {
      console.error('Gemini流式评估失败:', error)
      onProgress({
        type: 'error',
        error: error.message,
        provider: 'Gemini'
      })
    }
  }

  buildPrompt(essay, topic, taskType) {
    const taskSpecificPrompt = taskType === 'task1'
      ? 'You are evaluating IELTS Writing Task 1 (Academic) which requires describing visual information.'
      : 'You are evaluating IELTS Writing Task 2 which requires writing an academic essay.'

    return `${taskSpecificPrompt}

Essay Topic: ${topic}

Essay Content:
${essay}

Please evaluate this essay based on IELTS writing criteria and provide a detailed assessment in the following JSON format:

{
  "total_score": 6.5,
  "task_achievement": 6.0,
  "coherence_cohesion": 7.0,
  "lexical_resource": 6.5,
  "grammatical_range": 6.0,
  "sentences": [
    {
      "index": 0,
      "original": "The original sentence text",
      "errors": [
        {
          "type": "grammar",
          "word": "incorrect_word",
          "start_pos": 0,
          "end_pos": 15,
          "reason": "Explanation of the error",
          "correction": "correct_word"
        }
      ],
      "corrected": "The corrected sentence"
    }
  ],
  "overall_feedback": "Detailed feedback on the essay's strengths and areas for improvement."
}

Provide only the JSON response without any additional text.`
  }

  getServiceInfo() {
    return {
      name: 'Google Gemini',
      provider: 'Google',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
      features: ['text-generation', 'streaming', 'json-mode'],
      website: 'https://ai.google.dev/'
    }
  }
}

module.exports = GeminiService