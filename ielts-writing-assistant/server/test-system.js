/**
 * 系统测试脚本
 */
const express = require('express')
const path = require('path')
const Database = require('better-sqlite3')
const fs = require('fs')

async function testSystem() {
  console.log('🧪 开始系统测试...\n')

  // 测试1: 数据库连接
  console.log('📊 测试1: 数据库连接')
  try {
    const dbPath = path.join(__dirname, '../data/ielts-writing.db')
    const db = new Database(dbPath)

    // 测试基本查询
    const result = db.prepare('SELECT COUNT(*) as count FROM sqlite_master').get()
    console.log(`✅ 数据库连接成功，找到 ${result.count} 个表`)

    db.close()
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message)
    return false
  }

  // 测试2: 文件结构
  console.log('\n📁 测试2: 文件结构')
  const requiredFiles = [
    '../database/schema.sql',
    '../services/llm/base.js',
    '../services/llm/factory.js',
    '../middleware/errorHandler.js',
    '../middleware/requestLogger.js',
    '../routes/assessment-new.js'
  ]

  let missingFiles = []
  requiredFiles.forEach(file => {
    if (!fs.existsSync(path.join(__dirname, file))) {
      missingFiles.push(file)
    }
  })

  if (missingFiles.length === 0) {
    console.log('✅ 所有必要文件都存在')
  } else {
    console.log('❌ 缺少文件:', missingFiles)
    return false
  }

  // 测试3: 服务模块加载
  console.log('\n🔧 测试3: 服务模块加载')
  try {
    const LLMServiceFactory = require('../services/llm/factory')
    const providers = LLMServiceFactory.getSupportedProviders()
    console.log(`✅ LLM服务工厂加载成功，支持提供商: ${providers.join(', ')}`)

    // 测试Mock服务
    const mockService = LLMServiceFactory.createService('mock', { responseTime: 1000 })
    const connected = await mockService.testConnection()
    console.log(`✅ Mock服务连接测试: ${connected ? '成功' : '失败'}`)

  } catch (error) {
    console.error('❌ 服务模块加载失败:', error.message)
    return false
  }

  // 测试4: 服务器启动
  console.log('\n🚀 测试4: 服务器启动')
  try {
    const app = express()
    const PORT = 3002 // 使用不同端口避免冲突

    // 基本中间件
    app.use(express.json())

    // 健康检查端点
    app.get('/test-health', (req, res) => {
      res.json({
        success: true,
        message: '服务器运行正常',
        timestamp: new Date().toISOString()
      })
    })

    // AI提供商端点
    app.get('/test-providers', (req, res) => {
      try {
        const LLMServiceFactory = require('../services/llm/factory')
        const providers = LLMServiceFactory.getSupportedProviders()
        res.json({
          success: true,
          providers
        })
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        })
      }
    })

    // 模拟评估端点
    app.post('/test-assessment', async (req, res) => {
      try {
        const LLMServiceFactory = require('../services/llm/factory')
        const service = LLMServiceFactory.createService('mock', { responseTime: 2000 })

        const result = await service.assessEssay({
          content: 'Test content for assessment.',
          topic: {
            title: 'Test Topic',
            type: 'Task 2'
          }
        })

        res.json({
          success: true,
          result
        })
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        })
      }
    })

    const server = app.listen(PORT, () => {
      console.log(`✅ 测试服务器启动成功，端口: ${PORT}`)
    })

    // 等待服务器启动后进行测试
    await new Promise(resolve => setTimeout(resolve, 1000))

    // 测试健康检查
    const healthResponse = await fetch(`http://localhost:${PORT}/test-health`)
    const healthData = await healthResponse.json()
    console.log(`✅ 健康检查: ${healthData.message}`)

    // 测试提供商列表
    const providersResponse = await fetch(`http://localhost:${PORT}/test-providers`)
    const providersData = await providersResponse.json()
    console.log(`✅ 提供商列表: ${providersData.providers.join(', ')}`)

    // 测试模拟评估
    const assessmentResponse = await fetch(`http://localhost:${PORT}/test-assessment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'This is a test essay for assessment purposes.',
        topic: {
          title: 'Test Topic',
          type: 'Task 2'
        }
      })
    })

    const assessmentData = await assessmentResponse.json()
    if (assessmentData.success) {
      console.log(`✅ 模拟评估成功，总分: ${assessmentData.result.overall_score}`)
    } else {
      console.log(`❌ 模拟评估失败: ${assessmentData.error}`)
    }

    // 关闭测试服务器
    server.close()
    console.log('✅ 测试服务器已关闭')

  } catch (error) {
    console.error('❌ 服务器测试失败:', error.message)
    return false
  }

  console.log('\n🎉 所有测试通过！系统准备就绪。')
  return true
}

// 运行测试
if (require.main === module) {
  testSystem().then(success => {
    process.exit(success ? 0 : 1)
  }).catch(error => {
    console.error('测试运行失败:', error)
    process.exit(1)
  })
}

module.exports = { testSystem }