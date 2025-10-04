const express = require('express')
const router = express.Router()
const { v4: uuidv4 } = require('uuid')

// 获取写作题目列表
router.get('/topics', (req, res) => {
  try {
    const { type, difficulty, limit = 10 } = req.query

    let query = 'SELECT * FROM topics WHERE is_active = 1'
    const params = []

    if (type) {
      query += ' AND type = ?'
      params.push(type)
    }

    if (difficulty) {
      query += ' AND difficulty = ?'
      params.push(difficulty)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(parseInt(limit))

    const topics = req.db.prepare(query).all(...params)

    res.json({
      success: true,
      data: topics,
      total: topics.length
    })
  } catch (error) {
    console.error('获取题目列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取题目列表失败'
    })
  }
})

// 获取单个题目详情
router.get('/topics/:id', (req, res) => {
  try {
    const { id } = req.params

    const topic = req.db.prepare('SELECT * FROM topics WHERE id = ? AND is_active = 1').get(id)

    if (!topic) {
      return res.status(404).json({
        success: false,
        message: '题目不存在'
      })
    }

    res.json({
      success: true,
      data: topic
    })
  } catch (error) {
    console.error('获取题目详情失败:', error)
    res.status(500).json({
      success: false,
      message: '获取题目详情失败'
    })
  }
})

// 保存写作记录
router.post('/records', (req, res) => {
  try {
    const {
      topicId,
      topicTitle,
      topicType,
      content,
      wordCount,
      timeSpent
    } = req.body

    if (!topicId || !content || !wordCount) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    const id = uuidv4()

    const stmt = req.db.prepare(`
      INSERT INTO writing_records (
        id, topic_id, topic_title, topic_type, content, word_count, time_spent
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(id, topicId, topicTitle, topicType, content, wordCount, timeSpent)

    res.json({
      success: true,
      data: { id },
      message: '写作记录保存成功'
    })
  } catch (error) {
    console.error('保存写作记录失败:', error)
    res.status(500).json({
      success: false,
      message: '保存写作记录失败'
    })
  }
})

// 获取写作记录
router.get('/records/:id', (req, res) => {
  try {
    const { id } = req.params

    const record = req.db.prepare('SELECT * FROM writing_records WHERE id = ?').get(id)

    if (!record) {
      return res.status(404).json({
        success: false,
        message: '写作记录不存在'
      })
    }

    res.json({
      success: true,
      data: record
    })
  } catch (error) {
    console.error('获取写作记录失败:', error)
    res.status(500).json({
      success: false,
      message: '获取写作记录失败'
    })
  }
})

// 更新写作记录
router.put('/records/:id', (req, res) => {
  try {
    const { id } = req.params
    const { content, wordCount, timeSpent } = req.body

    const stmt = req.db.prepare(`
      UPDATE writing_records
      SET content = ?, word_count = ?, time_spent = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    const result = stmt.run(content, wordCount, timeSpent, id)

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: '写作记录不存在'
      })
    }

    res.json({
      success: true,
      message: '写作记录更新成功'
    })
  } catch (error) {
    console.error('更新写作记录失败:', error)
    res.status(500).json({
      success: false,
      message: '更新写作记录失败'
    })
  }
})

// 删除写作记录
router.delete('/records/:id', (req, res) => {
  try {
    const { id } = req.params

    // 先删除相关的评估结果
    req.db.prepare('DELETE FROM assessment_results WHERE writing_id = ?').run(id)

    // 删除写作记录
    const stmt = req.db.prepare('DELETE FROM writing_records WHERE id = ?')
    const result = stmt.run(id)

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: '写作记录不存在'
      })
    }

    res.json({
      success: true,
      message: '写作记录删除成功'
    })
  } catch (error) {
    console.error('删除写作记录失败:', error)
    res.status(500).json({
      success: false,
      message: '删除写作记录失败'
    })
  }
})

module.exports = router