const express = require('express')
const router = express.Router()
const { v4: uuidv4 } = require('uuid')
const OpenAI = require('openai')

// 模拟AI评估服务
class MockAIAssessment {
  async assessEssay(content, topic) {
    // 模拟AI处理时间
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 根据内容长度和简单规则生成模拟评分
    const wordCount = content.replace(/<[^>]*>/g, '').length
    let baseScore = 5.0

    // 根据字数调整分数
    if (wordCount >= 250) baseScore += 0.5
    if (wordCount >= 300) baseScore += 0.5
    if (wordCount >= 350) baseScore += 0.5

    // 添加随机波动
    const randomVariation = (Math.random() - 0.5) * 1.5
    let overallScore = Math.max(4.0, Math.min(8.5, baseScore + randomVariation))

    // 确定等级
    let level = '需要改进'
    if (overallScore >= 7.0) level = '优秀水平'
    else if (overallScore >= 6.0) level = '合格水平'
    else if (overallScore >= 5.0) level = '基础水平'

    return {
      overallScore: parseFloat(overallScore.toFixed(1)),
      level,
      description: this.generateDescription(overallScore),
      criteria: [
        {
          name: '任务回应',
          score: parseFloat((overallScore + (Math.random() - 0.5)).toFixed(1)),
          feedback: this.getCriteriaFeedback('task_response', overallScore)
        },
        {
          name: '连贯与衔接',
          score: parseFloat((overallScore + (Math.random() - 0.5)).toFixed(1)),
          feedback: this.getCriteriaFeedback('coherence', overallScore)
        },
        {
          name: '词汇资源',
          score: parseFloat((overallScore + (Math.random() - 0.5)).toFixed(1)),
          feedback: this.getCriteriaFeedback('vocabulary', overallScore)
        },
        {
          name: '语法准确性',
          score: parseFloat((overallScore + (Math.random() - 0.5)).toFixed(1)),
          feedback: this.getCriteriaFeedback('grammar', overallScore)
        }
      ],
      detailedFeedback: this.generateDetailedFeedback(overallScore),
      suggestions: this.generateSuggestions(overallScore)
    }
  }

  generateDescription(score) {
    if (score >= 7.0) {
      return '文章整体质量优秀，论点清晰，论证有力，语言运用熟练。'
    } else if (score >= 6.0) {
      return '文章质量良好，基本达到雅思写作要求，在语法和词汇方面还有提升空间。'
    } else if (score >= 5.0) {
      return '文章基本表达了观点，但在论证深度和语言准确性方面需要改进。'
    } else {
      return '文章需要大幅改进，建议重点加强语法基础和论证结构。'
    }
  }

  getCriteriaFeedback(criteria, score) {
    const feedbacks = {
      task_response: {
        high: '很好地回应了题目要求，观点明确，论证充分。',
        medium: '基本回应了题目要求，但论证可以更深入。',
        low: '未能完全回应题目要求，需要加强论证。'
      },
      coherence: {
        high: '文章结构清晰，段落衔接自然，逻辑性强。',
        medium: '文章结构基本合理，衔接词使用得当。',
        low: '文章结构需要改进，逻辑不够清晰。'
      },
      vocabulary: {
        high: '词汇使用丰富准确，展现了良好的词汇量。',
        medium: '词汇使用基本准确，但可以更加丰富多样。',
        low: '词汇量有限，存在一些用词不当的情况。'
      },
      grammar: {
        high: '语法准确，句式多样，几乎没有错误。',
        medium: '语法基本正确，存在少量错误。',
        low: '语法错误较多，需要加强基础语法学习。'
      }
    }

    const level = score >= 6.5 ? 'high' : score >= 5.5 ? 'medium' : 'low'
    return feedbacks[criteria][level]
  }

  generateDetailedFeedback(score) {
    const strengths = []
    const improvements = []

    if (score >= 6.0) {
      strengths.push(
        '文章结构清晰，段落划分合理',
        '论点明确，有适当的论证',
        '使用了多种句式结构',
        '词汇使用较为准确'
      )
    }

    if (score < 7.0) {
      improvements.push(
        '部分句子存在语法错误',
        '词汇使用可以更加丰富',
        '部分论证不够深入',
        '可以增加更多的例证'
      )
    }

    return [
      {
        title: '优点',
        items: strengths.length > 0 ? strengths : ['文章表达了基本的观点']
      },
      {
        title: '需要改进',
        items: improvements.length > 0 ? improvements : ['继续练习以提高写作水平']
      }
    ]
  }

  generateSuggestions(score) {
    const suggestions = []

    if (score < 6.0) {
      suggestions.push({
        title: '语法基础',
        content: '建议重点复习基础语法，特别是时态和主谓一致。',
        type: 'warning',
        icon: 'Warning',
        action: '查看语法练习'
      })
    }

    if (score < 7.0) {
      suggestions.push({
        title: '词汇提升',
        content: '多使用学术词汇和同义词替换，提高词汇的丰富性。',
        type: 'primary',
        icon: 'Star',
        action: '查看词汇推荐'
      })
    }

    if (score >= 6.0) {
      suggestions.push({
        title: '论证深化',
        content: '尝试提供更多的具体例子和深入分析，增强论证的说服力。',
        type: 'success',
        icon: 'TrendCharts',
        action: '查看论证技巧'
      })
    }

    return suggestions
  }
}

// 创建AI评估实例
const aiAssessment = new MockAIAssessment()

// 提交作文进行AI评估
router.post('/submit', async (req, res) => {
  try {
    const { writingId, content, topic } = req.body

    if (!writingId || !content) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    // 启动AI评估（实际项目中这里会调用真实的AI服务）
    const assessment = await aiAssessment.assessEssay(content, topic)

    // 保存评估结果
    const id = uuidv4()
    const stmt = req.db.prepare(`
      INSERT INTO assessment_results (
        id, writing_id, overall_score, level, description,
        criteria, detailed_feedback, suggestions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      writingId,
      assessment.overallScore,
      assessment.level,
      assessment.description,
      JSON.stringify(assessment.criteria),
      JSON.stringify(assessment.detailedFeedback),
      JSON.stringify(assessment.suggestions)
    )

    res.json({
      success: true,
      data: {
        id,
        ...assessment
      },
      message: '评估完成'
    })
  } catch (error) {
    console.error('AI评估失败:', error)
    res.status(500).json({
      success: false,
      message: 'AI评估失败'
    })
  }
})

// 获取评估结果
router.get('/results/:id', (req, res) => {
  try {
    const { id } = req.params

    const result = req.db.prepare('SELECT * FROM assessment_results WHERE id = ?').get(id)

    if (!result) {
      return res.status(404).json({
        success: false,
        message: '评估结果不存在'
      })
    }

    // 解析JSON字段
    const data = {
      ...result,
      criteria: JSON.parse(result.criteria),
      detailedFeedback: JSON.parse(result.detailed_feedback),
      suggestions: JSON.parse(result.suggestions)
    }

    // 移除原始JSON字段
    delete data.criteria
    delete data.detailed_feedback
    delete data.suggestions

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

    const result = req.db.prepare('SELECT * FROM assessment_results WHERE writing_id = ?').get(writingId)

    if (!result) {
      return res.status(404).json({
        success: false,
        message: '该写作记录暂无评估结果'
      })
    }

    // 解析JSON字段
    const data = {
      ...result,
      criteria: JSON.parse(result.criteria),
      detailedFeedback: JSON.parse(result.detailed_feedback),
      suggestions: JSON.parse(result.suggestions)
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