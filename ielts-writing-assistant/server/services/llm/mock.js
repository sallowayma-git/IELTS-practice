const BaseLLMService = require('./base')
const { buildScoringPrompt, buildGrammarPrompt } = require('../prompts/ielts-scoring-prompt')
const IELTSScoringEngine = require('../scoringEngine')

/**
 * Mock AI服务 - 用于开发测试
 * 使用专业雅思评分提示词和评分引擎生成高质量反馈
 */
class MockLLMService extends BaseLLMService {
  constructor(config) {
    super(config)
    this.responseTime = config.responseTime || 2000 // 模拟响应时间
    this.errorRate = config.errorRate || 0 // 错误率
    this.scoringEngine = new IELTSScoringEngine()
  }

  async testConnection() {
    // 模拟连接测试
    await this.delay(500)
    return Math.random() > 0.1 // 90%成功率
  }

  async assessEssay(params) {
    const startTime = Date.now()

    // 模拟处理时间
    await this.delay(this.responseTime)

    // 模拟随机错误
    if (Math.random() < this.errorRate) {
      throw new Error('模拟AI服务错误')
    }

    const result = this.generateMockResult(params)
    const evaluationTime = Date.now() - startTime

    return {
      ...result,
      metadata: {
        provider: 'Mock Service',
        model: 'mock-gpt-4',
        evaluationTime,
        tokenUsage: {
          input: this.estimateTokens(this.buildAssessmentPrompt(params)),
          output: this.estimateTokens(JSON.stringify(result)),
          total: this.estimateTokens(this.buildAssessmentPrompt(params)) + this.estimateTokens(JSON.stringify(result))
        },
        confidence: this.calculateConfidence(result)
      }
    }
  }

  async* assessEssayStream(params, onProgress) {
    const startTime = Date.now()
    const result = this.generateMockResult(params)

    // 模拟流式输出
    const stages = [
      { type: 'progress', progress: 0.2, message: '正在分析文章结构...' },
      { type: 'progress', progress: 0.4, message: '正在评估词汇使用...' },
      { type: 'progress', progress: 0.6, message: '正在检查语法准确性...' },
      { type: 'progress', progress: 0.8, message: '正在生成详细反馈...' }
    ]

    for (const stage of stages) {
      await this.delay(this.responseTime / stages.length)

      if (onProgress) {
        onProgress(stage)
      }

      yield {
        type: 'progress',
        content: stage,
        message: stage.message
      }
    }

    // 最终结果
    await this.delay(this.responseTime / stages.length)

    const evaluationTime = Date.now() - startTime

    yield {
      type: 'complete',
      content: {
        ...result,
        metadata: {
          provider: 'Mock Service',
          model: 'mock-gpt-4',
          evaluationTime,
          tokenUsage: {
            input: this.estimateTokens(this.buildAssessmentPrompt(params)),
            output: this.estimateTokens(JSON.stringify(result)),
            total: this.estimateTokens(this.buildAssessmentPrompt(params)) + this.estimateTokens(JSON.stringify(result))
          },
          confidence: this.calculateConfidence(result)
        }
      }
    }
  }

  getModelInfo() {
    return {
      name: 'Mock LLM Service',
      model: 'mock-gpt-4',
      provider: 'Development',
      capabilities: [
        'text-generation',
        'streaming',
        'mock-responses'
      ],
      limits: {
        maxTokens: 4096,
        maxInputTokens: 4096
      }
    }
  }

  generateMockResult(params) {
    // 使用专业评分引擎生成高质量评分
    const result = this.scoringEngine.generateDetailedAssessment(params)

    // 添加一些随机性，模拟真实AI的变化
    const variance = 0.1
    result.overall_score += (Math.random() - 0.5) * variance
    result.overall_score = Math.max(1.0, Math.min(9.0, parseFloat(result.overall_score.toFixed(1))))

    // 确保各项分数的一致性
    const scores = [result.task_response.score, result.coherence.score, result.vocabulary.score, result.grammar.score]
    scores.forEach(score => {
      score += (Math.random() - 0.5) * variance * 0.5
      score = Math.max(1.0, Math.min(9.0, parseFloat(score.toFixed(1))))
    })

    result.task_response.score = scores[0]
    result.coherence.score = scores[1]
    result.vocabulary.score = scores[2]
    result.grammar.score = scores[3]

    return result
  }

  generateDescription(score) {
    if (score >= 7.0) {
      return '文章整体质量优秀，论点清晰，论证有力，语言运用熟练。结构完整，逻辑性强，词汇使用准确丰富，语法掌握良好。'
    } else if (score >= 6.0) {
      return '文章质量良好，基本达到雅思写作要求。论点明确，结构合理，但在语法准确性和词汇多样性方面还有提升空间。'
    } else if (score >= 5.0) {
      return '文章基本表达了观点，但在论证深度和语言准确性方面需要改进。结构基本清晰，但存在一些语法和词汇使用问题。'
    } else {
      return '文章需要大幅改进，建议重点加强语法基础、词汇积累和文章结构组织。'
    }
  }

  generateCriteriaFeedback(criteria, score) {
    const feedbacks = {
      task_response: {
        high: '很好地回应了题目要求，观点明确，论证充分，论据有力。',
        medium: '基本回应了题目要求，但论证可以更深入，论据可以更充分。',
        low: '未能完全回应题目要求，论点不够明确，论证缺乏深度。'
      },
      coherence: {
        high: '文章结构清晰，段落衔接自然，逻辑性强，过渡词使用恰当。',
        medium: '文章结构基本合理，段落划分清楚，但部分段落间的衔接可以更自然。',
        low: '文章结构需要改进，段落划分不够清晰，逻辑关系不够明确。'
      },
      vocabulary: {
        high: '词汇使用丰富准确，展现了良好的词汇量，用词恰当，搭配合理。',
        medium: '词汇使用基本准确，但可以更加丰富多样，避免重复使用相同词汇。',
        low: '词汇量有限，存在一些用词不当的情况，需要扩大词汇量。'
      },
      grammar: {
        high: '语法准确，句式多样，几乎没有错误，能够熟练运用复杂句式。',
        medium: '语法基本正确，存在少量错误，句式使用基本得当。',
        low: '语法错误较多，需要加强基础语法学习，注意主谓一致和时态使用。'
      }
    }

    const level = score >= 6.5 ? 'high' : score >= 5.5 ? 'medium' : 'low'
    return feedbacks[criteria][level]
  }

  generateStrengths(score) {
    const allStrengths = [
      '文章结构清晰，段落划分合理',
      '论点明确，有适当的论证',
      '使用了多种句式结构',
      '词汇使用较为准确',
      '语法掌握较好',
      '过渡词使用恰当',
      '论据充分，例证贴切',
      '语言表达流畅'
    ]

    // 根据分数选择适当数量的优点
    const count = Math.floor(score / 2) + 2
    return this.shuffleArray(allStrengths).slice(0, Math.min(count, allStrengths.length))
  }

  generateImprovements(score) {
    const allImprovements = [
      '部分句子存在语法错误',
      '词汇使用可以更加丰富',
      '部分论证不够深入',
      '可以增加更多的例证',
      '段落间的衔接可以更自然',
      '避免重复使用相同的词汇',
      '注意主谓一致性',
      '时态使用需要更准确'
    ]

    const count = Math.floor((9 - score) / 2) + 1
    return this.shuffleArray(allImprovements).slice(0, Math.min(count, allImprovements.length))
  }

  generateSuggestions(score) {
    const suggestions = []

    if (score < 6.0) {
      suggestions.push({
        title: '语法基础',
        content: '建议重点复习基础语法，特别是时态、主谓一致和冠词使用。',
        type: 'high',
        action: '查看语法练习'
      })
    }

    if (score < 7.0) {
      suggestions.push({
        title: '词汇提升',
        content: '多使用学术词汇和同义词替换，提高词汇的丰富性和准确性。',
        type: 'medium',
        action: '查看词汇推荐'
      })
    }

    if (score >= 6.0) {
      suggestions.push({
        title: '论证深化',
        content: '尝试提供更多的具体例子和深入分析，增强论证的说服力。',
        type: 'low',
        action: '查看论证技巧'
      })
    }

    return suggestions
  }

  calculateConfidence(result) {
    // Mock服务的置信度基于分数一致性
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

  shuffleArray(array) {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 构建专业雅思评分提示词
  buildAssessmentPrompt(params) {
    const { content, topic, type = 'Task 2' } = params
    const wordCount = this.estimateTokens(content)
    const taskType = type === 'Task 1' ? 'Task 1 (Academic)' : 'Task 2 (Academic)'

    return buildScoringPrompt(
      content,
      taskType,
      topic?.title || 'IELTS Writing Task',
      wordCount,
      6.0 // 目标分数
    )
  }

  // 构建语法检查提示词
  buildGrammarPrompt(text) {
    return buildGrammarPrompt(text)
  }
}

module.exports = MockLLMService