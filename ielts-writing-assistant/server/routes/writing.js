const express = require('express')
const router = express.Router()
const { v4: uuidv4 } = require('uuid')

const DEFAULT_LIMITS = {
  'Task 1': { minWords: 150, timeLimit: 1200 },
  'Task 2': { minWords: 250, timeLimit: 2400 }
}
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard'])

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

// 导入题库
router.post('/topics/import', (req, res) => {
  try {
    const { csv, records } = req.body || {}

    let parsedRecords = []
    if (typeof csv === 'string' && csv.trim().length > 0) {
      parsedRecords = parseCsvTopics(csv)
    } else if (Array.isArray(records)) {
      parsedRecords = records
    }

    if (!Array.isArray(parsedRecords) || parsedRecords.length === 0) {
      return res.status(400).json({
        success: false,
        message: '未提供有效的题库数据'
      })
    }

    const summary = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: []
    }

    const findExistingStmt = req.db.prepare('SELECT id FROM topics WHERE LOWER(title) = LOWER(?) LIMIT 1')
    const insertStmt = req.db.prepare(`
      INSERT INTO topics (
        id, title, type, content, min_words, time_limit, difficulty, category, tags, source, is_active, usage_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    const updateStmt = req.db.prepare(`
      UPDATE topics
      SET content = ?, min_words = ?, time_limit = ?, difficulty = ?, category = ?, tags = ?, source = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    const transaction = req.db.transaction(() => {
      parsedRecords.forEach((raw, index) => {
        try {
          const normalized = normalizeTopicRecord(raw)
          if (!normalized) {
            summary.skipped += 1
            return
          }

          const existing = findExistingStmt.get(normalized.title)
          if (existing?.id) {
            updateStmt.run(
              normalized.content,
              normalized.min_words,
              normalized.time_limit,
              normalized.difficulty,
              normalized.category,
              normalized.tags,
              normalized.source,
              existing.id
            )
            summary.updated += 1
          } else {
            insertStmt.run(
              uuidv4(),
              normalized.title,
              normalized.type,
              normalized.content,
              normalized.min_words,
              normalized.time_limit,
              normalized.difficulty,
              normalized.category,
              normalized.tags,
              normalized.source
            )
            summary.inserted += 1
          }
        } catch (error) {
          summary.errors.push({
            index,
            title: raw?.title || raw?.Title || '',
            message: error.message
          })
        }
      })
    })

    transaction()

    res.json({
      success: true,
      data: summary,
      message: `导入完成：新增 ${summary.inserted} 条，更新 ${summary.updated} 条，跳过 ${summary.skipped} 条`
    })
  } catch (error) {
    console.error('导入题库失败:', error)
    res.status(500).json({
      success: false,
      message: '导入题库失败'
    })
  }
})

// 获取题库统计信息
router.get('/topics/statistics', (req, res) => {
  try {
    const total = req.db.prepare('SELECT COUNT(*) as count FROM topics WHERE is_active = 1').get().count
    const typeStats = req.db
      .prepare(`SELECT type, COUNT(*) as count FROM topics WHERE is_active = 1 GROUP BY type`)
      .all()
    const difficultyStats = req.db
      .prepare(`SELECT difficulty, COUNT(*) as count FROM topics WHERE is_active = 1 GROUP BY difficulty`)
      .all()
    const latest = req.db
      .prepare('SELECT MAX(updated_at) as last_updated FROM topics')
      .get()

    res.json({
      success: true,
      data: {
        total,
        byType: typeStats,
        byDifficulty: difficultyStats,
        lastUpdated: latest?.last_updated || null
      }
    })
  } catch (error) {
    console.error('获取题库统计失败:', error)
    res.status(500).json({
      success: false,
      message: '获取题库统计失败'
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

function parseCsvTopics(csvText = '') {
  const lines = csvText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return []
  }

  const headers = splitCsvLine(lines.shift()).map(header => header.trim())

  return lines.map(line => {
    const values = splitCsvLine(line)
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})
  })
}

function splitCsvLine(line) {
  const cells = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  cells.push(current.trim())
  return cells
}

function normalizeTopicRecord(raw) {
  if (!raw) {
    throw new Error('题目数据为空')
  }

  const title = (raw.title || raw.Title || '').toString().trim()
  const content = (raw.content || raw.Content || raw.prompt || '').toString().trim()

  if (!title) {
    throw new Error('缺少题目标题')
  }

  if (!content) {
    throw new Error('缺少题目内容')
  }

  const type = normalizeTaskType(raw.type || raw.Type)
  const limits = DEFAULT_LIMITS[type] || DEFAULT_LIMITS['Task 2']

  const minWordsRaw = Number(
    raw.min_words || raw.minWords || raw.MinWords || raw['min words'] || limits.minWords
  )
  const minWords = Number.isFinite(minWordsRaw) && minWordsRaw > 0 ? Math.round(minWordsRaw) : limits.minWords

  const timeLimitRaw = Number(
    raw.time_limit || raw.timeLimit || raw.duration || raw.Duration || limits.timeLimit
  )
  const timeLimit = Number.isFinite(timeLimitRaw) && timeLimitRaw > 0 ? Math.round(timeLimitRaw) : limits.timeLimit

  const difficulty = normalizeDifficulty(raw.difficulty || raw.Difficulty)
  const category = (raw.category || raw.Category || '').toString().trim() || 'general'
  const tags = normalizeTags(raw.tags || raw.Tags)

  return {
    title,
    type,
    content: ensureHtmlContent(content),
    min_words: minWords,
    time_limit: timeLimit,
    difficulty,
    category,
    tags: JSON.stringify(tags),
    source: 'import:csv'
  }
}

function normalizeTaskType(value) {
  const text = (value || '').toString().toLowerCase()
  if (text.includes('2')) {
    return 'Task 2'
  }
  return 'Task 1'
}

function normalizeDifficulty(value) {
  const normalized = (value || '').toString().toLowerCase()
  if (ALLOWED_DIFFICULTIES.has(normalized)) {
    return normalized
  }
  return 'medium'
}

function normalizeTags(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map(tag => tag.toString().trim()).filter(Boolean)
  }
  return value
    .toString()
    .split(/[|,;]/)
    .map(tag => tag.trim())
    .filter(Boolean)
}

function ensureHtmlContent(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed
  }

  const escaped = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const paragraphs = escaped
    .split(/\n{2,}/)
    .map(block => block.replace(/\n/g, '<br />'))
    .filter(Boolean)

  return paragraphs.length > 0
    ? `<p>${paragraphs.join('</p><p>')}</p>`
    : `<p>${escaped}</p>`
}

module.exports = router