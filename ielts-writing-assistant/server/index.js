const express = require('express')
const cors = require('cors')
const path = require('path')
const Database = require('better-sqlite3')
const fs = require('fs')

// 导入中间件
const requestLogger = require('./middleware/requestLogger')
const errorHandler = require('./middleware/errorHandler')

// 导入路由
const writingRoutes = require('./routes/writing')
const assessmentRoutes = require('./routes/assessment')
const historyRoutes = require('./routes/history')
const settingsRoutes = require('./routes/settings')
const logsRoutes = require('./routes/logs')
const diagnosticRoutes = require('./routes/diagnostic')

const app = express()
const PORT = process.env.PORT || 3010

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
  try {
    // 读取并执行SQL架构文件
    const schemaPath = path.join(__dirname, 'database/schema.sql')
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8')

      // 分割SQL语句并执行
      const statements = schema
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

      statements.forEach(statement => {
        if (statement) {
          db.exec(statement)
        }
      })

      console.log('数据库架构初始化完成')
    } else {
      console.warn('数据库架构文件不存在，使用基础架构')
      initializeBasicDatabase()
    }

    // 插入默认系统管理员用户（如果没有用户的话）
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count
    if (userCount === 0) {
      const { v4: uuidv4 } = require('uuid')
      db.prepare(`
        INSERT INTO users (id, username, display_name, preferences)
        VALUES (?, ?, ?, ?)
      `).run(
        uuidv4(),
        'default_user',
        '默认用户',
        JSON.stringify({
          language: 'zh-CN',
          theme: 'light'
        })
      )
      console.log('默认用户创建完成')
    }

  } catch (error) {
    console.error('数据库初始化失败:', error)
    throw error
  }
}

// 基础数据库初始化（后备方案）
function initializeBasicDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS writing_records (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      topic_id TEXT NOT NULL,
      topic_title TEXT NOT NULL,
      topic_type TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      time_spent INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS assessment_results (
      id TEXT PRIMARY KEY,
      writing_id TEXT NOT NULL,
      overall_score REAL NOT NULL,
      level TEXT NOT NULL,
      description TEXT,
      task_response_score REAL,
      coherence_score REAL,
      vocabulary_score REAL,
      grammar_score REAL,
      detailed_feedback TEXT,
      suggestions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (writing_id) REFERENCES writing_records (id) ON DELETE CASCADE
    )
  `)

  console.log('基础数据库初始化完成')
}

// 中间件
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// 请求日志中间件
app.use(requestLogger())

// 数据库中间件 - 将数据库实例附加到请求对象
app.use((req, res, next) => {
  req.db = db
  next()
})

// API路由 - 直接使用，错误处理中间件会捕获异步错误
app.use('/api/writing', writingRoutes)
app.use('/api/assessment', require('./routes/assessment-new'))
app.use('/api/grammar', require('./routes/grammar'))
app.use('/api/analysis', require('./routes/analysis'))
app.use('/api/export', require('./routes/export'))
app.use('/api/history', historyRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/logs', logsRoutes)
app.use('/api/diagnostic', diagnosticRoutes)

// 错误处理中间件 - 必须在所有路由之后
app.use(errorHandler.middleware())

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '服务运行正常',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  })
})

// 系统状态API - 供前端诊断使用
app.get('/api/system/status', (req, res) => {
  try {
    const systemStatus = {
      success: true,
      data: {
        status: 'running',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        platform: process.platform,
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
        port: PORT,
        environment: process.env.NODE_ENV || 'development'
      }
    }
    res.json(systemStatus)
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取系统状态失败',
      error: error.message
    })
  }
})

// AI提供商状态API
app.get('/api/ai/providers', (req, res) => {
  try {
    // 这里应该从设置中读取实际的AI配置
    const aiProviders = {
      success: true,
      data: {
        providers: ['openai', 'gemini', 'deepseek', 'openrouter', 'mock'],
        default: 'mock', // 从配置中读取
        configured: ['mock'], // 实际已配置的提供商
        timestamp: new Date().toISOString()
      }
    }
    res.json(aiProviders)
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取AI提供商失败',
      error: error.message
    })
  }
})

// 数据库状态API
app.get('/api/database/status', (req, res) => {
  try {
    // 检查数据库连接
    const dbCheck = db.prepare('SELECT 1 as test').get()
    const dbStats = {
      success: true,
      data: {
        status: 'connected',
        type: 'SQLite',
        path: dbPath,
        size: 'N/A', // 可以通过fs.stat获取实际文件大小
        tables: ['users', 'topics', 'writing_records', 'assessment_results'],
        timestamp: new Date().toISOString(),
        testQuery: dbCheck ? 'success' : 'failed'
      }
    }
    res.json(dbStats)
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取数据库状态失败',
      error: error.message
    })
  }
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