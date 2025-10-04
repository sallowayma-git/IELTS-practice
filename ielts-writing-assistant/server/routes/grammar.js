const express = require('express')
const router = express.Router()
const { v4: uuidv4 } = require('uuid')
const GrammarChecker = require('../services/grammarChecker')

// 创建语法检查器实例
const grammarChecker = new GrammarChecker()

// 保存语法标注到数据库
async function saveGrammarAnnotations(db, assessmentResultId, writingId, issues) {
  const savedAnnotations = []

  for (const issue of issues) {
    try {
      const annotationId = uuidv4()

      const stmt = db.prepare(`
        INSERT INTO evaluation_annotations (
          id, assessment_result_id, writing_id,
          start_index, end_index, error_text, suggested_text,
          category, severity, error_type,
          message, explanation,
          ai_model, ai_provider, confidence_score,
          status, user_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      stmt.run(
        annotationId,
        assessmentResultId,
        writingId,
        issue.startIndex,
        issue.endIndex,
        issue.text,
        issue.suggestion || null,
        issue.category,
        issue.severity,
        issue.id.replace('grammar_', ''), // 移除前缀，存储纯类型
        issue.message,
        null, // explanation - 可以后续扩展
        'grammar-checker', // ai_model
        'local', // ai_provider
        0.8, // confidence_score - 默认值
        'active', // status
        'pending' // user_action
      )

      savedAnnotations.push({
        id: annotationId,
        issueId: issue.id,
        startIndex: issue.startIndex,
        endIndex: issue.endIndex,
        category: issue.category,
        severity: issue.severity,
        message: issue.message
      })

    } catch (error) {
      console.error('保存语法标注失败:', error)
      // 继续处理其他标注，不中断整个流程
    }
  }

  return savedAnnotations
}

// 语法检查接口
router.post('/check', async (req, res, next) => {
  try {
    const { text, options = {}, writingId, assessmentResultId } = req.body

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        message: '请提供有效的文本内容'
      })
    }

    // 配置检查选项
    const checkOptions = {
      includeStyle: options.includeStyle !== false,
      includeSpelling: options.includeSpelling !== false,
      includePunctuation: options.includePunctuation !== false,
      maxIssues: options.maxIssues || 50
    }

    // 执行语法检查
    const result = grammarChecker.checkGrammar(text)

    // 限制返回的问题数量
    if (result.data.issues.length > checkOptions.maxIssues) {
      result.data.issues = result.data.issues.slice(0, checkOptions.maxIssues)
    }

    // 如果提供了评估结果ID，保存标注到数据库
    let savedAnnotations = []
    if (assessmentResultId && writingId) {
      savedAnnotations = await saveGrammarAnnotations(
        req.db,
        assessmentResultId,
        writingId,
        result.data.issues
      )
    }

    res.json({
      success: true,
      data: {
        ...result.data,
        savedAnnotations: savedAnnotations
      },
      message: '语法检查完成'
    })

  } catch (error) {
    console.error('语法检查失败:', error)
    next(error)
  }
})

// 应用语法建议接口
router.post('/apply-suggestions', async (req, res, next) => {
  try {
    const { text, suggestions } = req.body

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        message: '请提供有效的文本内容'
      })
    }

    if (!Array.isArray(suggestions)) {
      return res.status(400).json({
        success: false,
        message: '建议必须为数组格式'
      })
    }

    // 应用建议
    const correctedText = grammarChecker.applySuggestions(text, suggestions)

    res.json({
      success: true,
      data: {
        originalText: text,
        correctedText: correctedText,
        appliedSuggestions: suggestions.length
      },
      message: '语法建议应用成功'
    })

  } catch (error) {
    console.error('应用语法建议失败:', error)
    next(error)
  }
})

// 获取语法标注列表
router.get('/annotations/:assessmentResultId', (req, res) => {
  try {
    const { assessmentResultId } = req.params

    const annotations = req.db.prepare(`
      SELECT * FROM evaluation_annotations
      WHERE assessment_result_id = ? AND status = 'active'
      ORDER BY start_index ASC
    `).all(assessmentResultId)

    res.json({
      success: true,
      data: annotations,
      message: '获取语法标注成功'
    })

  } catch (error) {
    console.error('获取语法标注失败:', error)
    res.status(500).json({
      success: false,
      message: '获取语法标注失败'
    })
  }
})

// 更新语法标注状态
router.put('/annotations/:annotationId', async (req, res, next) => {
  try {
    const { annotationId } = req.params
    const { userAction, userNotes } = req.body

    if (!['accepted', 'rejected', 'ignored'].includes(userAction)) {
      return res.status(400).json({
        success: false,
        message: '无效的用户操作'
      })
    }

    const stmt = req.db.prepare(`
      UPDATE evaluation_annotations
      SET user_action = ?, user_notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    const result = stmt.run(userAction, userNotes || null, annotationId)

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: '语法标注不存在'
      })
    }

    res.json({
      success: true,
      message: '语法标注状态更新成功'
    })

  } catch (error) {
    console.error('更新语法标注状态失败:', error)
    next(error)
  }
})

// 获取语法规则列表
router.get('/rules', (req, res) => {
  try {
    const rules = grammarChecker.rules
    const rulesList = []

    Object.entries(rules).forEach(([category, categoryRules]) => {
      categoryRules.forEach((rule, index) => {
        rulesList.push({
          id: `${category}_${index}`,
          category: category,
          type: rule.type,
          description: rule.message,
          example: rule.pattern.toString()
        })
      })
    })

    res.json({
      success: true,
      data: rulesList,
      message: '获取语法规则成功'
    })

  } catch (error) {
    console.error('获取语法规则失败:', error)
    res.status(500).json({
      success: false,
      message: '获取语法规则失败'
    })
  }
})

// 批量检查接口（用于历史文章分析）
router.post('/batch-check', async (req, res, next) => {
  try {
    const { texts, options = {} } = req.body

    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供有效的文本数组'
      })
    }

    const results = []
    const maxConcurrent = options.maxConcurrent || 5

    // 分批处理，避免阻塞
    for (let i = 0; i < texts.length; i += maxConcurrent) {
      const batch = texts.slice(i, i + maxConcurrent)

      const batchPromises = batch.map(async (text, index) => {
        try {
          const result = grammarChecker.checkGrammar(text)
          return {
            index: i + index,
            success: true,
            data: result.data
          }
        } catch (error) {
          return {
            index: i + index,
            success: false,
            error: error.message
          }
        }
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
    }

    // 统计汇总
    const successfulChecks = results.filter(r => r.success)
    const totalIssues = successfulChecks.reduce((sum, r) => sum + r.data.issues.length, 0)
    const averageScore = successfulChecks.length > 0
      ? successfulChecks.reduce((sum, r) => sum + r.data.score, 0) / successfulChecks.length
      : 0

    res.json({
      success: true,
      data: {
        results: results,
        summary: {
          totalTexts: texts.length,
          successfulChecks: successfulChecks.length,
          totalIssues: totalIssues,
          averageGrammarScore: Math.round(averageScore)
        }
      },
      message: '批量语法检查完成'
    })

  } catch (error) {
    console.error('批量语法检查失败:', error)
    next(error)
  }
})

module.exports = router