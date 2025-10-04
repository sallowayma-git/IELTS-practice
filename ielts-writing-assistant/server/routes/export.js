const express = require('express')
const router = express.Router()
const { Parser } = require('json2csv')

// 导出数量估算接口
router.post('/estimate', async (req, res, next) => {
  try {
    const { filters = {}, userId = 'default_user' } = req.body

    // 构建查询条件（与其他导出接口保持一致）
    let whereClause = `WHERE wr.user_id = ?`
    const params = [userId]

    if (filters.type) {
      whereClause += ` AND wr.topic_type = ?`
      params.push(filters.type === 'task1' ? 'Task 1' : 'Task 2')
    }

    if (filters.scoreRange) {
      const scoreCondition = getScoreRangeCondition(filters.scoreRange)
      if (scoreCondition) {
        whereClause += ` AND ${scoreCondition.condition}`
        params.push(...scoreCondition.params)
      }
    }

    if (filters.dateRange && filters.dateRange.length === 2) {
      whereClause += ` AND ar.created_at BETWEEN ? AND ?`
      params.push(filters.dateRange[0], filters.dateRange[1])
    }

    if (filters.keyword) {
      whereClause += ` AND (wr.topic_title LIKE ? OR wr.content LIKE ?)`
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`)
    }

    // 查询数量
    const countQuery = `
      SELECT COUNT(*) as count
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      ${whereClause}
    `

    const result = req.db.prepare(countQuery).get(...params)

    res.json({
      success: true,
      data: {
        count: result.count || 0
      },
      message: '导出估算完成'
    })

  } catch (error) {
    console.error('导出估算失败:', error)
    next(error)
  }
})

// CSV导出接口
router.post('/csv', async (req, res, next) => {
  try {
    const { filters = {}, userId = 'default_user' } = req.body

    // 构建查询条件 - 基于当前筛选条件
    let whereClause = `WHERE wr.user_id = ?`
    const params = [userId]

    // 应用筛选条件
    if (filters.type) {
      whereClause += ` AND wr.topic_type = ?`
      params.push(filters.type === 'task1' ? 'Task 1' : 'Task 2')
    }

    if (filters.scoreRange) {
      const scoreCondition = getScoreRangeCondition(filters.scoreRange)
      if (scoreCondition) {
        whereClause += ` AND ${scoreCondition.condition}`
        params.push(...scoreCondition.params)
      }
    }

    if (filters.dateRange && filters.dateRange.length === 2) {
      whereClause += ` AND ar.created_at BETWEEN ? AND ?`
      params.push(filters.dateRange[0], filters.dateRange[1])
    }

    if (filters.keyword) {
      whereClause += ` AND (wr.topic_title LIKE ? OR wr.content LIKE ?)`
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`)
    }

    // 查询筛选后的记录
    const query = `
      SELECT
        ar.created_at as submissionTime,
        wr.topic_type as topicType,
        wr.topic_title as topicTitle,
        wr.word_count as wordCount,
        ar.overall_score as overallScore,
        ar.task_response_score as taskAchievement,
        ar.coherence_score as coherenceCohesion,
        ar.vocabulary_score as lexicalResource,
        ar.grammar_score as grammaticalRange,
        ar.ai_model as modelName,
        wr.content as originalContent,
        ar.task_response_feedback as taskAchievementFeedback,
        ar.coherence_feedback as coherenceCohesionFeedback,
        ar.vocabulary_feedback as lexicalResourceFeedback,
        ar.grammar_feedback as grammaticalRangeFeedback,
        ar.level as proficiencyLevel,
        ar.description as overallFeedback,
        ar.strengths as strengths,
        ar.improvements as improvements,
        ar.suggestions as suggestions,
        wr.time_spent as timeSpent
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      ${whereClause}
      ORDER BY ar.created_at DESC
    `

    const records = req.db.prepare(query).all(...params)

    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        message: '没有符合筛选条件的记录可导出'
      })
    }

    // 转换数据格式以匹配CSV字段要求
    const csvData = records.map(record => {
      // 解析JSON字段
      const strengths = record.strengths ? JSON.parse(record.strengths) : []
      const improvements = record.improvements ? JSON.parse(record.improvements) : []
      const suggestions = record.suggestions ? JSON.parse(record.suggestions) : []

      return {
        提交时间: new Date(record.submissionTime).toLocaleString('zh-CN'),
        题目类型: record.topicType,
        题目标题: record.topicTitle,
        字数: record.wordCount,
        总分: record.overallScore,
        TaskAchievement: record.taskAchievement,
        CoherenceCohesion: record.coherenceCohesion,
        LexicalResource: record.lexicalResource,
        GrammaticalRange: record.grammaticalRange,
        模型名称: record.modelName || 'Unknown',
        // 额外字段（不显示在主要CSV中，但用于JSON导出）
        原文内容: record.originalContent,
        TaskAchievement反馈: record.taskAchievementFeedback,
        CoherenceCohesion反馈: record.coherenceCohesionFeedback,
        LexicalResource反馈: record.lexicalResourceFeedback,
        GrammaticalRange反馈: record.grammaticalRangeFeedback,
        熟练度等级: record.proficiencyLevel,
        总体反馈: record.overallFeedback,
        优点: strengths.join('; '),
        改进建议: improvements.join('; '),
        详细建议: suggestions.map(s => typeof s === 'string' ? s : s.content || s).join('; '),
        用时: `${Math.floor(record.timeSpent / 60)}分${record.timeSpent % 60}秒`
      }
    })

    // 定义CSV字段顺序（严格按需求文档）
    const csvFields = [
      '提交时间',
      '题目类型',
      '题目标题',
      '字数',
      '总分',
      'TaskAchievement',
      'CoherenceCohesion',
      'LexicalResource',
      'GrammaticalRange',
      '模型名称'
    ]

    // 生成CSV内容
    const json2csvParser = new Parser({
      fields: csvFields,
      header: true,
      encoding: 'utf8',
      withBOM: true // 支持中文显示
    })

    const csv = json2csvParser.parse(csvData)

    // 生成文件名
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const filename = `ielts-history-${today}.csv`

    // 设置响应头
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)

    res.send(csv)

  } catch (error) {
    console.error('CSV导出失败:', error)
    next(error)
  }
})

// JSON导出接口（包含完整数据和语法标注）
router.post('/json', async (req, res, next) => {
  try {
    const { filters = {}, userId = 'default_user', includeAnnotations = false } = req.body

    // 构建查询条件（与CSV相同）
    let whereClause = `WHERE wr.user_id = ?`
    const params = [userId]

    if (filters.type) {
      whereClause += ` AND wr.topic_type = ?`
      params.push(filters.type === 'task1' ? 'Task 1' : 'Task 2')
    }

    if (filters.scoreRange) {
      const scoreCondition = getScoreRangeCondition(filters.scoreRange)
      if (scoreCondition) {
        whereClause += ` AND ${scoreCondition.condition}`
        params.push(...scoreCondition.params)
      }
    }

    if (filters.dateRange && filters.dateRange.length === 2) {
      whereClause += ` AND ar.created_at BETWEEN ? AND ?`
      params.push(filters.dateRange[0], filters.dateRange[1])
    }

    if (filters.keyword) {
      whereClause += ` AND (wr.topic_title LIKE ? OR wr.content LIKE ?)`
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`)
    }

    // 查询基础数据
    const query = `
      SELECT
        ar.*,
        wr.topic_type,
        wr.topic_title,
        wr.word_count,
        wr.time_spent,
        wr.content as originalContent,
        wr.created_at as writingCreatedAt
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      ${whereClause}
      ORDER BY ar.created_at DESC
    `

    const records = req.db.prepare(query).all(...params)

    // 如果需要包含语法标注，查询标注数据
    if (includeAnnotations) {
      for (const record of records) {
        const annotationsQuery = `
          SELECT * FROM evaluation_annotations
          WHERE assessment_result_id = ? AND status = 'active'
          ORDER BY start_index ASC
        `
        record.annotations = req.db.prepare(annotationsQuery).all(record.id)
      }
    }

    // 构建JSON数据结构
    const exportData = {
      metadata: {
        exportTime: new Date().toISOString(),
        userId: userId,
        totalRecords: records.length,
        filters: filters,
        includeAnnotations: includeAnnotations
      },
      records: records.map(record => {
        // 解析JSON字段
        const strengths = record.strengths ? JSON.parse(record.strengths) : []
        const improvements = record.improvements ? JSON.parse(record.improvements) : []
        const suggestions = record.suggestions ? JSON.parse(record.suggestions) : []

        return {
          id: record.id,
          writingId: record.writing_id,
          submissionTime: record.created_at,
          writingTime: record.writingCreatedAt,
          topic: {
            type: record.topic_type,
            title: record.topic_title
          },
          content: {
            original: record.originalContent,
            wordCount: record.word_count,
            timeSpent: record.time_spent
          },
          assessment: {
            overallScore: record.overall_score,
            level: record.level,
            description: record.description,
            criteria: {
              taskAchievement: {
                score: record.task_response_score,
                feedback: record.task_response_feedback
              },
              coherenceCohesion: {
                score: record.coherence_score,
                feedback: record.coherence_feedback
              },
              lexicalResource: {
                score: record.vocabulary_score,
                feedback: record.vocabulary_feedback
              },
              grammaticalRange: {
                score: record.grammar_score,
                feedback: record.grammar_feedback
              }
            },
            detailedFeedback: {
              strengths: strengths,
              improvements: improvements,
              suggestions: suggestions
            }
          },
          ai: {
            model: record.ai_model,
            provider: record.ai_provider,
            evaluationTime: record.evaluation_time,
            confidenceScore: record.confidence_score
          },
          annotations: record.annotations || [] // 语法标注（如果包含）
        }
      })
    }

    // 生成文件名
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const filename = `ielts-history-${today}.json`

    // 设置响应头
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)

    res.json({
      success: true,
      data: exportData,
      message: 'JSON导出成功'
    })

  } catch (error) {
    console.error('JSON导出失败:', error)
    next(error)
  }
})

// 导入校验接口
router.post('/import/validate', async (req, res, next) => {
  try {
    const { importData, format = 'json' } = req.body

    if (!importData) {
      return res.status(400).json({
        success: false,
        message: '请提供导入数据'
      })
    }

    const validationResult = await validateImportData(importData, format)

    res.json({
      success: true,
      data: validationResult,
      message: '导入数据校验完成'
    })

  } catch (error) {
    console.error('导入校验失败:', error)
    next(error)
  }
})

// 执行导入接口
router.post('/import/execute', async (req, res, next) => {
  try {
    const { importData, format = 'json', userId = 'default_user' } = req.body

    // 先进行校验
    const validation = await validateImportData(importData, format)
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: '导入数据校验失败',
        errors: validation.errors
      })
    }

    // 执行导入
    const importResult = await executeImport(importData, format, userId, req.db)

    res.json({
      success: true,
      data: importResult,
      message: '数据导入成功'
    })

  } catch (error) {
    console.error('执行导入失败:', error)
    next(error)
  }
})

// 辅助函数：获取分数范围条件
function getScoreRangeCondition(scoreRange) {
  const conditions = {
    'below6': {
      condition: 'ar.overall_score < ?',
      params: [6.0]
    },
    '6to6.5': {
      condition: 'ar.overall_score >= ? AND ar.overall_score <= ?',
      params: [6.0, 6.5]
    },
    'above7': {
      condition: 'ar.overall_score >= ?',
      params: [7.0]
    }
  }

  return conditions[scoreRange] || null
}

// 辅助函数：校验导入数据
async function validateImportData(importData, format) {
  const result = {
    isValid: true,
    errors: [],
    warnings: [],
    summary: {
      totalRecords: 0,
      validRecords: 0,
      invalidRecords: 0
    }
  }

  try {
    let records = []

    if (format === 'json') {
      if (!importData.records || !Array.isArray(importData.records)) {
        result.isValid = false
        result.errors.push('JSON格式错误：缺少records数组')
        return result
      }
      records = importData.records
    } else if (format === 'csv') {
      // CSV格式校验（这里简化处理，实际应该解析CSV）
      if (!Array.isArray(importData)) {
        result.isValid = false
        result.errors.push('CSV格式错误：数据应该是数组格式')
        return result
      }
      records = importData
    }

    result.summary.totalRecords = records.length

    // 校验每条记录
    records.forEach((record, index) => {
      const recordErrors = []

      // 必需字段校验
      if (!record.assessment || !record.assessment.overallScore) {
        recordErrors.push('缺少overallScore')
      }

      if (!record.topic || !record.topic.title) {
        recordErrors.push('缺少topic.title')
      }

      if (!record.content || !record.content.original) {
        recordErrors.push('缺少content.original')
      }

      // 分数范围校验
      if (record.assessment) {
        const scores = [
          record.assessment.overallScore,
          record.assessment.criteria?.taskAchievement?.score,
          record.assessment.criteria?.coherenceCohesion?.score,
          record.assessment.criteria?.lexicalResource?.score,
          record.assessment.criteria?.grammaticalRange?.score
        ]

        scores.forEach(score => {
          if (score !== undefined && (score < 0 || score > 9)) {
            recordErrors.push(`分数超出范围(0-9): ${score}`)
          }
        })
      }

      if (recordErrors.length > 0) {
        result.isValid = false
        result.errors.push(`记录${index + 1}: ${recordErrors.join(', ')}`)
        result.summary.invalidRecords++
      } else {
        result.summary.validRecords++
      }
    })

    // 警告检查
    if (result.summary.validRecords === 0) {
      result.warnings.push('没有有效的记录可以导入')
    }

  } catch (error) {
    result.isValid = false
    result.errors.push(`数据解析错误: ${error.message}`)
  }

  return result
}

// 辅助函数：执行导入
async function executeImport(importData, format, userId, db) {
  const result = {
    importedRecords: 0,
    skippedRecords: 0,
    errors: []
  }

  try {
    let records = []

    if (format === 'json') {
      records = importData.records
    } else if (format === 'csv') {
      records = importData
    }

    const { v4: uuidv4 } = require('uuid')

    for (const record of records) {
      try {
        // 检查是否已存在相同的记录（基于提交时间和题目）
        const existingCheck = db.prepare(`
          SELECT COUNT(*) as count FROM assessment_results ar
          JOIN writing_records wr ON ar.writing_id = wr.id
          WHERE wr.user_id = ?
            AND wr.topic_title = ?
            AND ar.created_at = ?
        `).get(userId, record.topic.title, record.submissionTime)

        if (existingCheck.count > 0) {
          result.skippedRecords++
          continue
        }

        // 创建写作记录
        const writingId = uuidv4()
        const writingStmt = db.prepare(`
          INSERT INTO writing_records (
            id, user_id, topic_id, topic_title, topic_type,
            content, word_count, time_spent, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        writingStmt.run(
          writingId,
          userId,
          uuidv4(), // 生成一个虚拟的topic_id
          record.topic.title,
          record.topic.type,
          record.content.original,
          record.content.wordCount || 0,
          record.content.timeSpent || 0,
          'assessed',
          record.writingTime || record.submissionTime
        )

        // 创建评估结果
        const assessmentId = uuidv4()
        const assessmentStmt = db.prepare(`
          INSERT INTO assessment_results (
            id, writing_id, overall_score, level, description,
            task_response_score, task_response_feedback,
            coherence_score, coherence_feedback,
            vocabulary_score, vocabulary_feedback,
            grammar_score, grammar_feedback,
            detailed_feedback, suggestions, strengths, improvements,
            ai_model, ai_provider, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        assessmentStmt.run(
          assessmentId,
          writingId,
          record.assessment.overallScore,
          record.assessment.level || '未定义',
          record.assessment.description || '',
          record.assessment.criteria?.taskAchievement?.score,
          record.assessment.criteria?.taskAchievement?.feedback,
          record.assessment.criteria?.coherenceCohesion?.score,
          record.assessment.criteria?.coherenceCohesion?.feedback,
          record.assessment.criteria?.lexicalResource?.score,
          record.assessment.criteria?.lexicalResource?.feedback,
          record.assessment.criteria?.grammaticalRange?.score,
          record.assessment.criteria?.grammaticalRange?.feedback,
          JSON.stringify(record.assessment.detailedFeedback || {}),
          JSON.stringify(record.assessment.detailedFeedback?.suggestions || []),
          JSON.stringify(record.assessment.detailedFeedback?.strengths || []),
          JSON.stringify(record.assessment.detailedFeedback?.improvements || []),
          record.ai?.model || 'Imported',
          record.ai?.provider || 'Import',
          record.submissionTime
        )

        // 导入语法标注（如果有）
        if (record.annotations && Array.isArray(record.annotations)) {
          const annotationStmt = db.prepare(`
            INSERT INTO evaluation_annotations (
              id, assessment_result_id, writing_id,
              start_index, end_index, error_text, suggested_text,
              category, severity, error_type, message,
              status, user_action, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)

          for (const annotation of record.annotations) {
            annotationStmt.run(
              uuidv4(),
              assessmentId,
              writingId,
              annotation.start_index || 0,
              annotation.end_index || 0,
              annotation.error_text || '',
              annotation.suggested_text || '',
              annotation.category || 'grammar',
              annotation.severity || 'warning',
              annotation.error_type || 'imported',
              annotation.message || '',
              'active',
              'pending',
              new Date().toISOString()
            )
          }
        }

        result.importedRecords++

      } catch (error) {
        result.errors.push(`导入记录失败: ${error.message}`)
      }
    }

  } catch (error) {
    throw new Error(`导入执行失败: ${error.message}`)
  }

  return result
}

module.exports = router