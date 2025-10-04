const express = require('express')
const router = express.Router()

// 评分趋势分析接口
router.post('/score-trends', async (req, res, next) => {
  try {
    const { userId = 'default_user', dateRange } = req.body

    // 构建查询条件
    let whereClause = `WHERE wr.user_id = ?`
    const params = [userId]

    if (dateRange && dateRange.length === 2) {
      whereClause += ` AND wr.created_at BETWEEN ? AND ?`
      params.push(dateRange[0], dateRange[1])
    }

    // 查询用户的评分历史
    const query = `
      SELECT
        ar.id,
        ar.writing_id,
        ar.overall_score,
        ar.task_response_score,
        ar.coherence_score,
        ar.vocabulary_score,
        ar.grammar_score,
        ar.level,
        ar.description,
        ar.created_at,
        wr.topic_title,
        wr.topic_type,
        wr.word_count,
        wr.time_spent
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      ${whereClause}
      ORDER BY ar.created_at DESC
      LIMIT 50
    `

    const history = req.db.prepare(query).all(...params)

    if (history.length === 0) {
      return res.json({
        success: true,
        data: {
          history: [],
          trends: null
        },
        message: '暂无评分数据'
      })
    }

    // 计算趋势数据
    const trends = calculateTrends(history)

    res.json({
      success: true,
      data: {
        history: history.map(record => ({
          ...record,
          date: new Date(record.created_at).toLocaleDateString('zh-CN')
        })),
        trends: trends
      },
      message: '评分趋势分析完成'
    })

  } catch (error) {
    console.error('评分趋势分析失败:', error)
    next(error)
  }
})

// 评分统计接口
router.get('/statistics/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params

    // 查询基础统计数据
    const statsQuery = `
      SELECT
        COUNT(*) as total_attempts,
        AVG(ar.overall_score) as average_score,
        MAX(ar.overall_score) as highest_score,
        MIN(ar.overall_score) as lowest_score,
        AVG(ar.task_response_score) as avg_task_response,
        AVG(ar.coherence_score) as avg_coherence,
        AVG(ar.vocabulary_score) as avg_vocabulary,
        AVG(ar.grammar_score) as avg_grammar
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      WHERE wr.user_id = ?
    `

    const stats = req.db.prepare(statsQuery).get(userId)

    // 查询最近的评分，用于计算进步幅度
    const recentQuery = `
      SELECT ar.overall_score
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      WHERE wr.user_id = ?
      ORDER BY ar.created_at DESC
      LIMIT 2
    `

    const recentScores = req.db.prepare(recentQuery).all(userId)

    let improvement = 0
    if (recentScores.length === 2) {
      improvement = recentScores[0].overall_score - recentScores[1].overall_score
    }

    // 查询各分数段分布
    const distributionQuery = `
      SELECT
        CASE
          WHEN ar.overall_score >= 7.5 THEN '7.5-9.0'
          WHEN ar.overall_score >= 6.5 THEN '6.5-7.4'
          WHEN ar.overall_score >= 5.5 THEN '5.5-6.4'
          ELSE '0.0-5.4'
        END as score_range,
        COUNT(*) as count
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      WHERE wr.user_id = ?
      GROUP BY score_range
      ORDER BY score_range DESC
    `

    const distribution = req.db.prepare(distributionQuery).all(userId)

    res.json({
      success: true,
      data: {
        totalAttempts: stats.total_attempts || 0,
        averageScore: Math.round((stats.average_score || 0) * 10) / 10,
        highestScore: Math.round((stats.highest_score || 0) * 10) / 10,
        lowestScore: Math.round((stats.lowest_score || 0) * 10) / 10,
        improvement: Math.round(improvement * 10) / 10,
        criteriaAverages: {
          taskResponse: Math.round((stats.avg_task_response || 0) * 10) / 10,
          coherence: Math.round((stats.avg_coherence || 0) * 10) / 10,
          vocabulary: Math.round((stats.avg_vocabulary || 0) * 10) / 10,
          grammar: Math.round((stats.avg_grammar || 0) * 10) / 10
        },
        distribution: distribution
      },
      message: '统计数据获取成功'
    })

  } catch (error) {
    console.error('获取统计数据失败:', error)
    next(error)
  }
})

// 详细对比数据接口
router.post('/comparison', async (req, res, next) => {
  try {
    const { assessmentIds } = req.body

    if (!Array.isArray(assessmentIds) || assessmentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供有效的评估ID列表'
      })
    }

    const placeholders = assessmentIds.map(() => '?').join(',')
    const query = `
      SELECT
        ar.id,
        ar.overall_score,
        ar.task_response_score,
        ar.coherence_score,
        ar.vocabulary_score,
        ar.grammar_score,
        ar.level,
        ar.created_at,
        wr.topic_title,
        wr.topic_type,
        wr.word_count
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      WHERE ar.id IN (${placeholders})
      ORDER BY ar.created_at ASC
    `

    const comparisons = req.db.prepare(query).all(...assessmentIds)

    res.json({
      success: true,
      data: comparisons.map(record => ({
        ...record,
        date: new Date(record.created_at).toLocaleDateString('zh-CN')
      })),
      message: '对比数据获取成功'
    })

  } catch (error) {
    console.error('获取对比数据失败:', error)
    next(error)
  }
})

// 进步报告接口
router.get('/progress-report/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params
    const { period = '30' } = req.query // 默认30天

    // 计算时间范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - parseInt(period))

    // 查询指定时期内的评分数据
    const query = `
      SELECT
        ar.overall_score,
        ar.task_response_score,
        ar.coherence_score,
        ar.vocabulary_score,
        ar.grammar_score,
        ar.created_at,
        wr.topic_type
      FROM assessment_results ar
      JOIN writing_records wr ON ar.writing_id = wr.id
      WHERE wr.user_id = ?
        AND ar.created_at BETWEEN ? AND ?
      ORDER BY ar.created_at ASC
    `

    const records = req.db.prepare(query).all(userId, startDate.toISOString(), endDate.toISOString())

    if (records.length === 0) {
      return res.json({
        success: true,
        data: {
          period: parseInt(period),
          totalAttempts: 0,
          improvement: 0,
          detailedAnalysis: null
        },
        message: '指定时期内无评分数据'
      })
    }

    // 分析进步情况
    const analysis = analyzeProgress(records, period)

    res.json({
      success: true,
      data: analysis,
      message: '进步报告生成成功'
    })

  } catch (error) {
    console.error('生成进步报告失败:', error)
    next(error)
  }
})

// 辅助函数：计算趋势数据
function calculateTrends(history) {
  const reversed = history.slice().reverse() // 按时间正序

  return {
    totalAttempts: history.length,
    averageScore: Math.round(
      (history.reduce((sum, record) => sum + record.overall_score, 0) / history.length) * 10
    ) / 10,
    highestScore: Math.max(...history.map(record => record.overall_score)),
    lowestScore: Math.min(...history.map(record => record.overall_score)),
    improvement: history.length >= 2
      ? Math.round((history[0].overall_score - history[history.length - 1].overall_score) * 10) / 10
      : 0,
    dates: reversed.map(record => new Date(record.created_at).toLocaleDateString('zh-CN')),
    overallScores: reversed.map(record => record.overall_score),
    taskResponseScores: reversed.map(record => record.task_response_score),
    coherenceScores: reversed.map(record => record.coherence_score),
    vocabularyScores: reversed.map(record => record.vocabulary_score),
    grammarScores: reversed.map(record => record.grammar_score)
  }
}

// 辅助函数：分析进步情况
function analyzeProgress(records, period) {
  const totalAttempts = records.length
  const averageScore = Math.round(
    (records.reduce((sum, record) => sum + record.overall_score, 0) / totalAttempts) * 10
  ) / 10

  let improvement = 0
  if (totalAttempts >= 2) {
    improvement = Math.round(
      (records[records.length - 1].overall_score - records[0].overall_score) * 10
    ) / 10
  }

  // 按Task类型分析
  const task1Records = records.filter(record => record.topic_type === 'Task 1')
  const task2Records = records.filter(record => record.topic_type === 'Task 2')

  const task1Avg = task1Records.length > 0
    ? Math.round((task1Records.reduce((sum, record) => sum + record.overall_score, 0) / task1Records.length) * 10) / 10
    : 0

  const task2Avg = task2Records.length > 0
    ? Math.round((task2Records.reduce((sum, record) => sum + record.overall_score, 0) / task2Records.length) * 10) / 10
    : 0

  // 分析各维度进步
  const criteriaProgress = {}
  const criteriaFields = [
    'task_response_score',
    'coherence_score',
    'vocabulary_score',
    'grammar_score'
  ]

  criteriaFields.forEach(field => {
    const scores = records.map(record => record[field])
    if (scores.length >= 2) {
      const criteriaImprovement = Math.round((scores[scores.length - 1] - scores[0]) * 10) / 10
      criteriaProgress[field] = criteriaImprovement
    }
  })

  return {
    period: parseInt(period),
    totalAttempts,
    averageScore,
    improvement,
    taskAnalysis: {
      task1: { count: task1Records.length, average: task1Avg },
      task2: { count: task2Records.length, average: task2Avg }
    },
    criteriaProgress,
    startDate: new Date(records[0].created_at).toLocaleDateString('zh-CN'),
    endDate: new Date(records[records.length - 1].created_at).toLocaleDateString('zh-CN')
  }
}

module.exports = router