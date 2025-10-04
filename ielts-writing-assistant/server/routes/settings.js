const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')

// 获取用户设置
router.get('/', (req, res) => {
  try {
    const settings = {}

    const stmt = req.db.prepare('SELECT key, value FROM user_settings')
    const rows = stmt.all()

    rows.forEach(row => {
      try {
        settings[row.key] = JSON.parse(row.value)
      } catch (error) {
        settings[row.key] = row.value
      }
    })

    // 设置默认值
    const defaultSettings = {
      general: {
        language: 'zh-CN',
        theme: 'light',
        autoSave: true,
        saveInterval: 60
      },
      ai: {
        provider: 'openai',
        apiKey: '',
        model: 'gpt-3.5-turbo',
        speed: 'balanced',
        streaming: true
      },
      writing: {
        fontSize: 16,
        autoTimer: true,
        wordCountReminder: true,
        targetWords: 250,
        grammarCheck: true
      }
    }

    // 合并默认设置和用户设置
    Object.keys(defaultSettings).forEach(category => {
      if (!settings[category]) {
        settings[category] = defaultSettings[category]
      } else {
        settings[category] = { ...defaultSettings[category], ...settings[category] }
      }
    })

    res.json({
      success: true,
      data: settings
    })
  } catch (error) {
    console.error('获取设置失败:', error)
    res.status(500).json({
      success: false,
      message: '获取设置失败'
    })
  }
})

// 更新设置
router.put('/', (req, res) => {
  try {
    const { category, settings } = req.body

    if (!category || !settings) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    // 开始事务
    const transaction = req.db.transaction(() => {
      Object.keys(settings).forEach(key => {
        const value = JSON.stringify(settings[key])
        const fullKey = `${category}.${key}`

        const stmt = req.db.prepare(`
          INSERT OR REPLACE INTO user_settings (key, value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `)

        stmt.run(fullKey, value)
      })
    })

    transaction()

    res.json({
      success: true,
      message: '设置保存成功'
    })
  } catch (error) {
    console.error('更新设置失败:', error)
    res.status(500).json({
      success: false,
      message: '更新设置失败'
    })
  }
})

// 获取特定类别的设置
router.get('/:category', (req, res) => {
  try {
    const { category } = req.params

    const stmt = req.db.prepare('SELECT key, value FROM user_settings WHERE key LIKE ?')
    const rows = stmt.all(`${category}.%`)

    const settings = {}
    rows.forEach(row => {
      const key = row.key.replace(`${category}.`, '')
      try {
        settings[key] = JSON.parse(row.value)
      } catch (error) {
        settings[key] = row.value
      }
    })

    res.json({
      success: true,
      data: settings
    })
  } catch (error) {
    console.error('获取设置失败:', error)
    res.status(500).json({
      success: false,
      message: '获取设置失败'
    })
  }
})

// 测试AI连接
router.post('/test-ai-connection', async (req, res) => {
  try {
    const { provider, apiKey, model } = req.body

    if (!provider || !apiKey || !model) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    // 模拟测试连接
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 模拟不同提供商的测试结果
    let testResult = {
      success: true,
      provider,
      model,
      latency: Math.floor(Math.random() * 1000) + 500,
      message: '连接测试成功'
    }

    // 模拟失败情况
    if (apiKey === 'invalid-key') {
      testResult = {
        success: false,
        provider,
        model,
        error: 'API密钥无效',
        message: '连接测试失败'
      }
    }

    res.json({
      success: true,
      data: testResult
    })
  } catch (error) {
    console.error('测试AI连接失败:', error)
    res.status(500).json({
      success: false,
      message: '测试AI连接失败'
    })
  }
})

// 重置设置
router.post('/reset', (req, res) => {
  try {
    const { category } = req.body

    if (category) {
      // 重置特定类别的设置
      const stmt = req.db.prepare('DELETE FROM user_settings WHERE key LIKE ?')
      stmt.run(`${category}.%`)
    } else {
      // 重置所有设置
      const stmt = req.db.prepare('DELETE FROM user_settings')
      stmt.run()
    }

    res.json({
      success: true,
      message: '设置重置成功'
    })
  } catch (error) {
    console.error('重置设置失败:', error)
    res.status(500).json({
      success: false,
      message: '重置设置失败'
    })
  }
})

// 导出设置
router.get('/export', (req, res) => {
  try {
    const stmt = req.db.prepare('SELECT key, value FROM user_settings')
    const rows = stmt.all()

    const settings = {}
    rows.forEach(row => {
      try {
        settings[row.key] = JSON.parse(row.value)
      } catch (error) {
        settings[row.key] = row.value
      }
    })

    const exportData = {
      exportDate: new Date().toISOString(),
      version: '1.0.0',
      settings
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="ielts-writing-settings-${new Date().toISOString().slice(0, 10)}.json"`)
    res.json(exportData)
  } catch (error) {
    console.error('导出设置失败:', error)
    res.status(500).json({
      success: false,
      message: '导出设置失败'
    })
  }
})

// 导入设置
router.post('/import', (req, res) => {
  try {
    const { settings } = req.body

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        success: false,
        message: '无效的设置数据'
      })
    }

    // 开始事务
    const transaction = req.db.transaction(() => {
      Object.keys(settings).forEach(key => {
        const value = typeof settings[key] === 'object' ? JSON.stringify(settings[key]) : settings[key]

        const stmt = req.db.prepare(`
          INSERT OR REPLACE INTO user_settings (key, value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `)

        stmt.run(key, value)
      })
    })

    transaction()

    res.json({
      success: true,
      message: '设置导入成功'
    })
  } catch (error) {
    console.error('导入设置失败:', error)
    res.status(500).json({
      success: false,
      message: '导入设置失败'
    })
  }
})

// 获取存储信息
router.get('/storage-info', (req, res) => {
  try {
    const dbPath = req.db.filename
    const stats = fs.statSync(dbPath)

    // 获取记录数量
    const recordCount = req.db.prepare('SELECT COUNT(*) as count FROM writing_records').get().count

    // 获取缓存大小（模拟）
    const cacheSize = '512 KB'

    // 获取最后备份时间（模拟）
    const lastBackup = '2024-10-03 15:30:00'

    res.json({
      success: true,
      data: {
        dbSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
        recordCount,
        cacheSize,
        lastBackup,
        dbPath
      }
    })
  } catch (error) {
    console.error('获取存储信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取存储信息失败'
    })
  }
})

// 清除缓存
router.post('/clear-cache', (req, res) => {
  try {
    // 模拟清除缓存操作
    // 在实际应用中，这里可能清除临时文件、过期数据等

    res.json({
      success: true,
      message: '缓存清除成功'
    })
  } catch (error) {
    console.error('清除缓存失败:', error)
    res.status(500).json({
      success: false,
      message: '清除缓存失败'
    })
  }
})

module.exports = router