/**
 * LLM服务基类
 * 定义所有AI服务提供商必须实现的接口
 */
class BaseLLMService {
  constructor(config) {
    this.config = config
    this.name = this.constructor.name
  }

  /**
   * 测试连接
   * @returns {Promise<boolean>} 连接是否成功
   */
  async testConnection() {
    throw new Error('testConnection method must be implemented')
  }

  /**
   * 评估作文
   * @param {Object} params 评估参数
   * @param {string} params.content 作文内容
   * @param {Object} params.topic 题目信息
   * @param {string} params.type 评估类型
   * @returns {Promise<Object>} 评估结果
   */
  async assessEssay(params) {
    throw new Error('assessEssay method must be implemented')
  }

  /**
   * 流式评估作文
   * @param {Object} params 评估参数
   * @param {Function} onProgress 进度回调
   * @returns {AsyncGenerator} 流式生成器
   */
  async* assessEssayStream(params, onProgress) {
    throw new Error('assessEssayStream method must be implemented')
  }

  /**
   * 获取模型信息
   * @returns {Object} 模型信息
   */
  getModelInfo() {
    throw new Error('getModelInfo method must be implemented')
  }

  /**
   * 计算token使用量
   * @param {string} text 文本内容
   * @returns {number} token数量
   */
  estimateTokens(text) {
    // 简单估算：英文按4个字符=1个token，中文按1个字符=1个token
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length
    const otherChars = text.length - englishChars
    return Math.ceil(englishChars / 4) + otherChars
  }

  /**
   * 构建评估提示词
   * @param {Object} params 评估参数
   * @returns {string} 提示词
   */
  buildAssessmentPrompt(params) {
    const { content, topic, type = 'full' } = params

    const basePrompt = `你是一位专业的雅思写作评分官，请评估以下${topic.type === 'Task 1' ? '图表描述' : '议论文'}写作。

题目：${topic.title}
题目类型：${topic.type}
题目内容：
${topic.content}

学生作文：
${content}

请按照雅思官方评分标准，从以下四个维度进行评分（每个维度0-9分）：

1. 任务回应 (Task Response / Task Achievement)
2. 连贯与衔接 (Coherence and Cohesion)
3. 词汇资源 (Lexical Resource)
4. 语法准确性 (Grammatical Range and Accuracy)

请提供详细的评估，包括：
- 总分（0-9分）
- 各维度分数和评语
- 文章优点分析
- 需要改进的地方
- 具体的提升建议

请以JSON格式返回结果：
{
  "overall_score": 6.5,
  "level": "合格水平",
  "description": "总体评价...",
  "task_response": {
    "score": 6.5,
    "feedback": "任务回应评语..."
  },
  "coherence": {
    "score": 6.0,
    "feedback": "连贯性评语..."
  },
  "vocabulary": {
    "score": 6.5,
    "feedback": "词汇评语..."
  },
  "grammar": {
    "score": 7.0,
    "feedback": "语法评语..."
  },
  "strengths": ["优点1", "优点2"],
  "improvements": ["改进点1", "改进点2"],
  "suggestions": [
    {
      "title": "建议标题",
      "content": "建议内容",
      "type": "priority", // high, medium, low
      "action": "可执行的操作"
    }
  ]
}`

    return basePrompt
  }

  /**
   * 解析AI响应
   * @param {string} response AI响应内容
   * @returns {Object} 解析后的结果
   */
  parseResponse(response) {
    try {
      // 尝试从响应中提取JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }

      // 如果没有找到JSON，尝试解析整个响应
      return JSON.parse(response)
    } catch (error) {
      console.error('解析AI响应失败:', error)
      throw new Error('AI响应格式错误，无法解析')
    }
  }

  /**
   * 验证评估结果
   * @param {Object} result 评估结果
   * @returns {boolean} 是否有效
   */
  validateResult(result) {
    const requiredFields = [
      'overall_score',
      'task_response',
      'coherence',
      'vocabulary',
      'grammar'
    ]

    for (const field of requiredFields) {
      if (!(field in result)) {
        console.error(`评估结果缺少必要字段: ${field}`)
        return false
      }
    }

    // 验证分数范围
    const scores = [
      result.overall_score,
      result.task_response?.score,
      result.coherence?.score,
      result.vocabulary?.score,
      result.grammar?.score
    ]

    for (const score of scores) {
      if (typeof score !== 'number' || score < 0 || score > 9) {
        console.error(`无效分数: ${score}`)
        return false
      }
    }

    return true
  }

  /**
   * 获取错误信息
   * @param {Error} error 错误对象
   * @returns {Object} 格式化的错误信息
   */
  formatError(error) {
    return {
      success: false,
      error: error.message,
      provider: this.name,
      timestamp: new Date().toISOString()
    }
  }
}

module.exports = BaseLLMService