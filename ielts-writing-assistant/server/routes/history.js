const express = require('express')
const router = express.Router()

// 获取历史记录列表
router.get('/records', (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      scoreRange,
      startDate,
      endDate,
      keyword
    } = req.query

    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = `
      SELECT
        wr.*,
        ar.overall_score,
        ar.level,
        ar.created_at as assessment_date,
        ar.id as assessment_id
      FROM writing_records wr
      LEFT JOIN assessment_results ar ON wr.id = ar.writing_id
      WHERE 1=1
    `
    const params = []
    let countQuery = 'SELECT COUNT(*) as total FROM writing_records wr WHERE 1=1'
    const countParams = []

    // 题目类型筛选
    if (type) {
      query += ' AND wr.topic_type = ?'
      countQuery += ' AND wr.topic_type = ?'
      params.push(type)
      countParams.push(type)
    }

    // 分数范围筛选
    if (scoreRange) {
      let scoreCondition = ''
      switch (scoreRange) {
        case 'below6':
          scoreCondition = ' AND ar.overall_score < 6'
          break
        case '6to6.5':
          scoreCondition = ' AND ar.overall_score >= 6 AND ar.overall_score <= 6.5'
          break
        case 'above7':
          scoreCondition = ' AND ar.overall_score >= 7'
          break
      }
      if (scoreCondition) {
        query += scoreCondition
        countQuery += scoreCondition
      }
    }

    // 日期范围筛选
    if (startDate) {
      query += ' AND DATE(wr.created_at) >= ?'
      countQuery += ' AND DATE(wr.created_at) >= ?'
      params.push(startDate)
      countParams.push(startDate)
    }

    if (endDate) {
      query += ' AND DATE(wr.created_at) <= ?'
      countQuery += ' AND DATE(wr.created_at) <= ?'
      params.push(endDate)
      countParams.push(endDate)
    }

    // 关键词搜索
    if (keyword) {
      query += ' AND wr.topic_title LIKE ?'
      countQuery += ' AND wr.topic_title LIKE ?'
      params.push(`%${keyword}%`)
      countParams.push(`%${keyword}%`)
    }

    // 排序和分页
    query += ' ORDER BY wr.created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit), offset)

    // 执行查询
    const records = req.db.prepare(query).all(...params)
    const countResult = req.db.prepare(countQuery).get(...countParams)
    const total = countResult.total

    // 格式化数据
    const formattedRecords = records.map(record => ({
      id: record.id,
      assessmentId: record.assessment_id,
      date: record.created_at,
      assessmentDate: record.assessment_date,
      topic: record.topic_title,
      type: record.topic_type,
      wordCount: record.word_count,
      timeSpent: record.time_spent,
      score: record.overall_score,
      level: record.level,
      content: record.content
    }))

    res.json({
      success: true,
      data: {
        records: formattedRecords,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    })
  } catch (error) {
    console.error('获取历史记录失败:', error)
    res.status(500).json({
      success: false,
      message: '获取历史记录失败'
    })
  }
})

// 获取统计数据
router.get('/statistics', (req, res) => {
  try {
    const stats = {}

    // 总练习次数
    const totalCountResult = req.db.prepare('SELECT COUNT(*) as count FROM writing_records').get()
    stats.totalCount = totalCountResult.count

    // 平均分数
    const avgScoreResult = req.db.prepare(`
      SELECT AVG(overall_score) as avg_score
      FROM assessment_results
      WHERE overall_score IS NOT NULL
    `).get()
    stats.averageScore = avgScoreResult.avg_score ? parseFloat(avgScoreResult.avg_score.toFixed(1)) : 0

    // 最高分数
    const maxScoreResult = req.db.prepare(`
      SELECT MAX(overall_score) as max_score
      FROM assessment_results
      WHERE overall_score IS NOT NULL
    `).get()
    stats.highestScore = maxScoreResult.max_score || 0

    // 本月练习次数
    const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
    const monthlyCountResult = req.db.prepare(`
      SELECT COUNT(*) as count
      FROM writing_records
      WHERE strftime('%Y-%m', created_at) = ?
    `).get(currentMonth)
    stats.monthlyCount = monthlyCountResult.count

    // 按类型统计
    const typeStatsResult = req.db.prepare(`
      SELECT
        topic_type,
        COUNT(*) as count,
        AVG(ar.overall_score) as avg_score
      FROM writing_records wr
      LEFT JOIN assessment_results ar ON wr.id = ar.writing_id
      GROUP BY topic_type
    `).all()
    stats.byType = typeStatsResult

    // 分数分布统计
    const scoreDistributionResult = req.db.prepare(`
      SELECT
        CASE
          WHEN overall_score >= 7 THEN '7.0+'
          WHEN overall_score >= 6 THEN '6.0-6.9'
          WHEN overall_score >= 5 THEN '5.0-5.9'
          ELSE 'Below 5.0'
        END as score_range,
        COUNT(*) as count
      FROM assessment_results
      WHERE overall_score IS NOT NULL
      GROUP BY score_range
      ORDER BY
        CASE score_range
          WHEN '7.0+' THEN 1
          WHEN '6.0-6.9' THEN 2
          WHEN '5.0-5.9' THEN 3
          ELSE 4
        END
    `).all()
    stats.scoreDistribution = scoreDistributionResult

    // 进步趋势（最近10次记录）
    const progressResult = req.db.prepare(`
      SELECT
        ar.overall_score,
        wr.created_at
      FROM writing_records wr
      LEFT JOIN assessment_results ar ON wr.id = ar.writing_id
      WHERE ar.overall_score IS NOT NULL
      ORDER BY wr.created_at DESC
      LIMIT 10
    `).all()
    stats.recentProgress = progressResult.reverse() // 按时间正序

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    console.error('获取统计数据失败:', error)
    res.status(500).json({
      success: false,
      message: '获取统计数据失败'
    })
  }
})

// 删除历史记录
router.delete('/records/:id', async (req, res) => {
  try {
    const { id } = req.params

    // 开始事务
    const transaction = req.db.transaction(() => {
      // 先删除相关的评估结果
      req.db.prepare('DELETE FROM assessment_results WHERE writing_id = ?').run(id)

      // 删除写作记录
      const stmt = req.db.prepare('DELETE FROM writing_records WHERE id = ?')
      const result = stmt.run(id)

      return result.changes
    })

    const changes = transaction()

    if (changes === 0) {
      return res.status(404).json({
        success: false,
        message: '记录不存在'
      })
    }

    res.json({
      success: true,
      message: '记录删除成功'
    })
  } catch (error) {
    console.error('删除历史记录失败:', error)
    res.status(500).json({
      success: false,
      message: '删除历史记录失败'
    })
  }
})

// 批量删除历史记录
router.delete('/records', async (req, res) => {
  try {
    const { ids } = req.body

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供要删除的记录ID列表'
      })
    }

    // 开始事务
    const transaction = req.db.transaction(() => {
      const placeholders = ids.map(() => '?').join(',')

      // 删除相关的评估结果
      req.db.prepare(`DELETE FROM assessment_results WHERE writing_id IN (${placeholders})`).run(...ids)

      // 删除写作记录
      const stmt = req.db.prepare(`DELETE FROM writing_records WHERE id IN (${placeholders})`)
      const result = stmt.run(...ids)

      return result.changes
    })

    const changes = transaction()

    res.json({
      success: true,
      data: { deletedCount: changes },
      message: `成功删除${changes}条记录`
    })
  } catch (error) {
    console.error('批量删除历史记录失败:', error)
    res.status(500).json({
      success: false,
      message: '批量删除历史记录失败'
    })
  }
})

// 导出历史记录
router.get('/export', (req, res) => {
  try {
    const { format = 'json', type, startDate, endDate } = req.query

    let query = `
      SELECT
        wr.*,
        ar.overall_score,
        ar.level,
        ar.description,
        ar.criteria,
        ar.detailed_feedback,
        ar.suggestions
      FROM writing_records wr
      LEFT JOIN assessment_results ar ON wr.id = ar.writing_id
      WHERE 1=1
    `
    const params = []

    // 筛选条件
    if (type) {
      query += ' AND wr.topic_type = ?'
      params.push(type)
    }

    if (startDate) {
      query += ' AND DATE(wr.created_at) >= ?'
      params.push(startDate)
    }

    if (endDate) {
      query += ' AND DATE(wr.created_at) <= ?'
      params.push(endDate)
    }

    query += ' ORDER BY wr.created_at DESC'

    const records = req.db.prepare(query).all(...params)

    // 格式化数据
    const exportData = records.map(record => ({
      id: record.id,
      date: record.created_at,
      topic: {
        id: record.topic_id,
        title: record.topic_title,
        type: record.topic_type
      },
      content: {
        text: record.content,
        wordCount: record.word_count,
        timeSpent: record.time_spent
      },
      assessment: record.overall_score ? {
        overallScore: record.overall_score,
        level: record.level,
        description: record.description,
        criteria: record.criteria ? JSON.parse(record.criteria) : null,
        detailedFeedback: record.detailed_feedback ? JSON.parse(record.detailed_feedback) : null,
        suggestions: record.suggestions ? JSON.parse(record.suggestions) : null,
        date: record.created_at
      } : null
    }))

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="ielts-writing-history-${new Date().toISOString().slice(0, 10)}.json"`)
      res.json({
        exportDate: new Date().toISOString(),
        totalCount: exportData.length,
        records: exportData
      })
    } else {
      res.status(400).json({
        success: false,
        message: '不支持的导出格式'
      })
    }
  } catch (error) {
    console.error('导出历史记录失败:', error)
    res.status(500).json({
      success: false,
      message: '导出历史记录失败'
    })
  }
})

module.exports = router