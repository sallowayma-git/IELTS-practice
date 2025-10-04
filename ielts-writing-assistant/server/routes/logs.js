const express = require('express')
const router = express.Router()
const logger = require('../services/logger')
const fs = require('fs').promises
const path = require('path')

// 模拟日志存储（实际项目中应该使用数据库）
let logStore = []

// 获取日志列表
router.get('/', async (req, res) => {
  try {
    const { level, source, startDate, endDate, limit = 100 } = req.query

    let filteredLogs = logStore

    // 按级别过滤
    if (level) {
      filteredLogs = filteredLogs.filter(log => log.level === level)
    }

    // 按来源过滤
    if (source) {
      filteredLogs = filteredLogs.filter(log => log.source === source)
    }

    // 按日期范围过滤
    if (startDate) {
      const start = new Date(startDate)
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= start)
    }

    if (endDate) {
      const end = new Date(endDate)
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= end)
    }

    // 按时间倒序排列并限制数量
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    filteredLogs = filteredLogs.slice(0, parseInt(limit))

    res.json({
      success: true,
      data: filteredLogs,
      total: filteredLogs.length
    })
  } catch (error) {
    logger.error('获取日志失败', error)
    res.status(500).json({
      success: false,
      message: '获取日志失败: ' + error.message
    })
  }
})

// 添加日志
router.post('/', async (req, res) => {
  try {
    const { level, message, source = 'frontend', context, error } = req.body

    const logEntry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      source,
      context: {
        ...context,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      },
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : null
    }

    logStore.push(logEntry)

    // 保持日志库大小限制
    if (logStore.length > 10000) {
      logStore = logStore.slice(-5000) // 保留最新的5000条
    }

    // 记录到系统日志
    await logger.log(level, message, error, logEntry.context)

    res.json({
      success: true,
      data: logEntry
    })
  } catch (error) {
    logger.error('添加日志失败', error)
    res.status(500).json({
      success: false,
      message: '添加日志失败: ' + error.message
    })
  }
})

// 清空日志
router.delete('/', async (req, res) => {
  try {
    logStore = []

    await logger.info('日志已清空', {
      action: 'clear_logs',
      source: 'api'
    })

    res.json({
      success: true,
      message: '日志已清空'
    })
  } catch (error) {
    logger.error('清空日志失败', error)
    res.status(500).json({
      success: false,
      message: '清空日志失败: ' + error.message
    })
  }
})

// 获取日志统计
router.get('/stats', async (req, res) => {
  try {
    const stats = {
      total: logStore.length,
      error: logStore.filter(log => log.level === 'ERROR').length,
      warn: logStore.filter(log => log.level === 'WARN').length,
      info: logStore.filter(log => log.level === 'INFO').length,
      debug: logStore.filter(log => log.level === 'DEBUG').length,
      lastUpdate: logStore.length > 0 ? logStore[0].timestamp : null
    }

    // 按来源统计
    const sourceStats = {}
    logStore.forEach(log => {
      sourceStats[log.source] = (sourceStats[log.source] || 0) + 1
    })

    stats.bySource = sourceStats

    // 按小时统计（最近24小时）
    const hourlyStats = {}
    const now = new Date()
    for (let i = 0; i < 24; i++) {
      const hour = new Date(now.getTime() - i * 60 * 60 * 1000)
      const hourKey = hour.getHours() + ':00'
      hourlyStats[hourKey] = 0
    }

    logStore
      .filter(log => {
        const logTime = new Date(log.timestamp)
        const hoursDiff = (now - logTime) / (1000 * 60 * 60)
        return hoursDiff < 24
      })
      .forEach(log => {
        const logHour = new Date(log.timestamp).getHours() + ':00'
        hourlyStats[logHour]++
      })

    stats.byHour = hourlyStats

    res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    logger.error('获取日志统计失败', error)
    res.status(500).json({
      success: false,
      message: '获取日志统计失败: ' + error.message
    })
  }
})

// 导出日志
router.get('/export', async (req, res) => {
  try {
    const { format = 'json', level, source, startDate, endDate } = req.query

    let filteredLogs = logStore

    // 应用过滤条件
    if (level) {
      filteredLogs = filteredLogs.filter(log => log.level === level)
    }
    if (source) {
      filteredLogs = filteredLogs.filter(log => log.source === source)
    }
    if (startDate) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= new Date(startDate))
    }
    if (endDate) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= new Date(endDate))
    }

    const filename = `logs-${new Date().toISOString().split('T')[0]}`

    if (format === 'csv') {
      // CSV格式
      const csvHeader = 'Timestamp,Level,Source,Message,Context\n'
      const csvData = filteredLogs.map(log => {
        const contextStr = JSON.stringify(log.context || {}).replace(/"/g, '""')
        const messageStr = log.message.replace(/"/g, '""')
        return `"${log.timestamp}","${log.level}","${log.source}","${messageStr}","${contextStr}"`
      }).join('\n')

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`)
      res.send(csvHeader + csvData)
    } else {
      // JSON格式
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`)
      res.json({
        exportTime: new Date().toISOString(),
        total: filteredLogs.length,
        logs: filteredLogs
      })
    }
  } catch (error) {
    logger.error('导出日志失败', error)
    res.status(500).json({
      success: false,
      message: '导出日志失败: ' + error.message
    })
  }
})

// 实时日志流（Server-Sent Events）
router.get('/stream', (req, res) => {
  // 设置SSE响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  })

  // 发送连接确认
  res.write('event: connected\ndata: {"type":"connected","message":"实时日志连接已建立"}\n\n')

  // 监听新日志事件
  const onNewLog = (logEntry) => {
    res.write(`event: log\ndata: ${JSON.stringify(logEntry)}\n\n`)
  }

  // 模拟新日志监听
  const logInterval = setInterval(() => {
    if (Math.random() > 0.7) { // 30%概率生成新日志
      const mockLog = {
        id: Date.now() + Math.random(),
        timestamp: new Date().toISOString(),
        level: ['INFO', 'WARN', 'ERROR'][Math.floor(Math.random() * 3)],
        message: `实时测试日志 - ${new Date().toLocaleTimeString()}`,
        source: 'system',
        context: { stream: true }
      }
      onNewLog(mockLog)
    }
  }, 5000)

  // 处理客户端断开连接
  req.on('close', () => {
    clearInterval(logInterval)
    logger.info('实时日志客户端断开连接')
  })

  req.on('error', (error) => {
    clearInterval(logInterval)
    logger.error('实时日志连接错误', error)
  })
})

// 系统健康检查日志
router.post('/health', async (req, res) => {
  try {
    const { component, status, details } = req.body

    const healthLog = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      level: status === 'healthy' ? 'INFO' : status === 'warning' ? 'WARN' : 'ERROR',
      message: `组件健康检查: ${component} - ${status}`,
      source: 'health-check',
      context: {
        component,
        status,
        details,
        ip: req.ip
      }
    }

    logStore.push(healthLog)

    res.json({
      success: true,
      message: '健康检查日志已记录'
    })
  } catch (error) {
    logger.error('记录健康检查失败', error)
    res.status(500).json({
      success: false,
      message: '记录健康检查失败: ' + error.message
    })
  }
})

// 初始化一些示例日志
function initializeLogs() {
  const sampleLogs = [
    {
      id: Date.now() - 10000,
      timestamp: new Date(Date.now() - 10000).toISOString(),
      level: 'INFO',
      message: '系统启动完成',
      source: 'system',
      context: { version: '1.0.0', environment: 'development' }
    },
    {
      id: Date.now() - 8000,
      timestamp: new Date(Date.now() - 8000).toISOString(),
      level: 'WARN',
      message: 'AI API响应时间较长',
      source: 'ai',
      context: { provider: 'openrouter', duration: 5000, model: 'gpt-4' }
    },
    {
      id: Date.now() - 5000,
      timestamp: new Date(Date.now() - 5000).toISOString(),
      level: 'ERROR',
      message: '数据库连接失败',
      source: 'database',
      error: {
        message: 'Connection timeout',
        stack: 'Error: Connection timeout\n    at Database.connect (/app/src/database.js:45:15)'
      },
      context: { database: 'ielts_db', timeout: 30000 }
    }
  ]

  logStore.push(...sampleLogs)
}

// 初始化日志
initializeLogs()

module.exports = router