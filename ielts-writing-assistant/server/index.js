const express = require('express')
const cors = require('cors')
const path = require('path')
const Database = require('better-sqlite3')
const fs = require('fs')

// 导入路由
const writingRoutes = require('./routes/writing')
const assessmentRoutes = require('./routes/assessment')
const historyRoutes = require('./routes/history')
const settingsRoutes = require('./routes/settings')

const app = express()
const PORT = process.env.PORT || 3001

// 创建数据库目录
const dbDir = path.join(__dirname, '../data')
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

// 初始化数据库
const dbPath = path.join(dbDir, 'ielts-writing.db')
const db = new Database(dbPath)

// 创建数据表
function initializeDatabase() {
  // 写作记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS writing_records (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      topic_title TEXT NOT NULL,
      topic_type TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      time_spent INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 评估结果表
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessment_results (
      id TEXT PRIMARY KEY,
      writing_id TEXT NOT NULL,
      overall_score REAL NOT NULL,
      level TEXT NOT NULL,
      description TEXT,
      criteria TEXT NOT NULL,
      detailed_feedback TEXT,
      suggestions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (writing_id) REFERENCES writing_records (id)
    )
  `)

  // 题目表
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      min_words INTEGER DEFAULT 250,
      time_limit INTEGER DEFAULT 2400,
      difficulty TEXT DEFAULT 'medium',
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 用户设置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  console.log('数据库初始化完成')
}

// 中间件
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  next()
})

// 数据库中间件 - 将数据库实例附加到请求对象
app.use((req, res, next) => {
  req.db = db
  next()
})

// API路由
app.use('/api/writing', writingRoutes)
app.use('/api/assessment', assessmentRoutes)
app.use('/api/history', historyRoutes)
app.use('/api/settings', settingsRoutes)

// 错误处理中间件 - 必须在所有路由之后
app.use((err, req, res, next) => {
  console.error('服务器错误:', err)
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  })
})

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '服务运行正常',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  })
})

// 获取应用信息
app.get('/api/info', (req, res) => {
  res.json({
    success: true,
    data: {
      name: '雅思AI作文评判助手',
      version: '1.0.0',
      description: '基于AI的雅思写作评估系统',
      features: [
        'AI智能评分',
        '实时反馈',
        '历史记录',
        '多维度评估',
        '个性化建议'
      ]
    }
  })
})

// 404处理
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  })
})

// 启动服务器
function startServer() {
  try {
    initializeDatabase()

    app.listen(PORT, () => {
      console.log(`🚀 服务器启动成功`)
      console.log(`📝 API服务: http://localhost:${PORT}`)
      console.log(`🏥 健康检查: http://localhost:${PORT}/api/health`)
      console.log(`📊 应用信息: http://localhost:${PORT}/api/info`)
    })
  } catch (error) {
    console.error('服务器启动失败:', error)
    process.exit(1)
  }
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...')
  db.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n正在关闭服务器...')
  db.close()
  process.exit(0)
})

startServer()