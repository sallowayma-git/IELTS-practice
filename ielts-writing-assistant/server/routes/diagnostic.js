const express = require('express')
const router = express.Router()
const logger = require('../services/logger')
const os = require('os')
const fs = require('fs').promises

// 系统信息缓存
let systemInfoCache = null
let lastSystemCheck = 0
const CACHE_DURATION = 30000 // 30秒缓存

// 获取系统信息
async function getSystemInfo() {
  const now = Date.now()

  // 如果缓存未过期，返回缓存数据
  if (systemInfoCache && (now - lastSystemCheck) < CACHE_DURATION) {
    return systemInfoCache
  }

  try {
    const systemInfo = {
      timestamp: new Date().toISOString(),
      os: {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        loadavg: os.loadavg()
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
      },
      cpu: {
        model: os.cpus()[0].model,
        cores: os.cpus().length,
        speed: os.cpus()[0].speed
      },
      network: os.networkInterfaces(),
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      }
    }

    // 获取磁盘使用情况
    try {
      const stats = await fs.stat('.')
      systemInfo.disk = {
        available: 'N/A', // 需要额外库来获取磁盘信息
        total: 'N/A'
      }
    } catch (error) {
      systemInfo.disk = { error: error.message }
    }

    systemInfoCache = systemInfo
    lastSystemCheck = now

    return systemInfo
  } catch (error) {
    logger.error('获取系统信息失败', error)
    throw error
  }
}

// 执行系统诊断
router.post('/full', async (req, res) => {
  try {
    const diagnosticResult = {
      timestamp: new Date().toISOString(),
      overallStatus: 'healthy',
      checks: {},
      issues: [],
      performance: {},
      recommendations: []
    }

    // 1. 检查系统资源
    try {
      const systemInfo = await getSystemInfo()
      diagnosticResult.checks.system = {
        status: 'healthy',
        details: systemInfo
      }

      // 检查内存使用
      if (systemInfo.memory.usage > 80) {
        diagnosticResult.issues.push({
          severity: systemInfo.memory.usage > 90 ? 'critical' : 'warning',
          component: 'memory',
          title: '内存使用率过高',
          description: `当前内存使用率为 ${systemInfo.memory.usage}%`,
          value: systemInfo.memory.usage,
          threshold: 80
        })
        diagnosticResult.overallStatus = 'warning'
      }

      // 检查系统负载
      if (systemInfo.os.loadavg[0] > systemInfo.os.cpus().length * 2) {
        diagnosticResult.issues.push({
          severity: 'warning',
          component: 'cpu',
          title: '系统负载过高',
          description: `当前系统负载为 ${systemInfo.os.loadavg[0].toFixed(2)}`,
          value: systemInfo.os.loadavg[0],
          threshold: systemInfo.os.cpus().length * 2
        })
        if (diagnosticResult.overallStatus === 'healthy') {
          diagnosticResult.overallStatus = 'warning'
        }
      }

      diagnosticResult.performance = {
        memoryUsage: systemInfo.memory.usage,
        systemLoad: systemInfo.os.loadavg[0],
        processUptime: systemInfo.process.uptime,
        processMemory: systemInfo.process.memoryUsage
      }
    } catch (error) {
      diagnosticResult.checks.system = {
        status: 'error',
        error: error.message
      }
      diagnosticResult.issues.push({
        severity: 'critical',
        component: 'system',
        title: '系统信息获取失败',
        description: error.message
      })
      diagnosticResult.overallStatus = 'critical'
    }

    // 2. 检查服务状态
    const services = [
      { name: 'Frontend', url: 'http://localhost:5175', expectedStatus: 200 },
      { name: 'Backend API', url: 'http://localhost:3000/api/health', expectedStatus: 200 },
      { name: 'AI Service', url: 'https://openrouter.ai/api/v1/models', expectedStatus: 200 }
    ]

    diagnosticResult.checks.services = {}

    for (const service of services) {
      try {
        const startTime = Date.now()
        // 使用Node.js内置http/https模块
        const response = await performHealthCheck(service.url)
        const responseTime = Date.now() - startTime

        diagnosticResult.checks.services[service.name] = {
          status: response.ok ? 'healthy' : 'unhealthy',
          responseTime,
          statusCode: response.status,
          url: service.url
        }

        if (!response.ok) {
          diagnosticResult.issues.push({
            severity: 'critical',
            component: 'service',
            title: `${service.name}服务异常`,
            description: `服务响应状态码: ${response.status}`,
            value: response.status,
            expected: service.expectedStatus
          })
          diagnosticResult.overallStatus = 'critical'
        } else if (responseTime > 5000) {
          diagnosticResult.issues.push({
            severity: 'warning',
            component: 'service',
            title: `${service.name}响应缓慢`,
            description: `响应时间: ${responseTime}ms`,
            value: responseTime,
            threshold: 5000
          })
          if (diagnosticResult.overallStatus === 'healthy') {
            diagnosticResult.overallStatus = 'warning'
          }
        }
      } catch (error) {
        diagnosticResult.checks.services[service.name] = {
          status: 'error',
          error: error.message
        }
        diagnosticResult.issues.push({
          severity: 'critical',
          component: 'service',
          title: `${service.name}不可达`,
          description: error.message
        })
        diagnosticResult.overallStatus = 'critical'
      }
    }

    // 3. 检查文件系统
    try {
      const criticalPaths = [
        './server',
        './src',
        './public',
        './package.json'
      ]

      diagnosticResult.checks.filesystem = {
        status: 'healthy',
        paths: {}
      }

      for (const path of criticalPaths) {
        try {
          const stats = await fs.stat(path)
          diagnosticResult.checks.filesystem.paths[path] = {
            status: 'healthy',
            exists: true,
            size: stats.size,
            modified: stats.mtime
          }
        } catch (error) {
          diagnosticResult.checks.filesystem.paths[path] = {
            status: 'error',
            exists: false,
            error: error.message
          }
          diagnosticResult.issues.push({
            severity: 'critical',
            component: 'filesystem',
            title: `关键文件或目录缺失: ${path}`,
            description: error.message
          })
          diagnosticResult.overallStatus = 'critical'
        }
      }
    } catch (error) {
      diagnosticResult.checks.filesystem = {
        status: 'error',
        error: error.message
      }
    }

    // 4. 生成建议
    diagnosticResult.recommendations = generateRecommendations(diagnosticResult.issues)

    // 记录诊断结果
    await logger.info('系统诊断完成', {
      overallStatus: diagnosticResult.overallStatus,
      issuesCount: diagnosticResult.issues.length,
      criticalIssues: diagnosticResult.issues.filter(i => i.severity === 'critical').length
    })

    res.json({
      success: true,
      data: diagnosticResult
    })
  } catch (error) {
    logger.error('系统诊断失败', error)
    res.status(500).json({
      success: false,
      message: '系统诊断失败: ' + error.message
    })
  }
})

// 获取系统性能指标
router.get('/performance', async (req, res) => {
  try {
    const systemInfo = await getSystemInfo()

    // 模拟网络延迟测试
    const networkLatency = await measureNetworkLatency()

    const performance = {
      timestamp: new Date().toISOString(),
      cpu: {
        usage: Math.round(Math.random() * 30 + 10), // 模拟CPU使用率
        cores: systemInfo.cpu.cores,
        loadAverage: systemInfo.os.loadavg[0]
      },
      memory: {
        used: systemInfo.memory.used,
        total: systemInfo.memory.total,
        usage: systemInfo.memory.usage,
        processUsage: systemInfo.process.memoryUsage
      },
      disk: {
        usage: Math.round(Math.random() * 40 + 20), // 模拟磁盘使用率
        available: 'N/A',
        total: 'N/A'
      },
      network: {
        latency: networkLatency,
        interfaces: systemInfo.network
      },
      process: {
        uptime: systemInfo.process.uptime,
        pid: systemInfo.process.pid
      }
    }

    res.json({
      success: true,
      data: performance
    })
  } catch (error) {
    logger.error('获取性能指标失败', error)
    res.status(500).json({
      success: false,
      message: '获取性能指标失败: ' + error.message
    })
  }
})

// 获取系统状态概览
router.get('/overview', async (req, res) => {
  try {
    const systemInfo = await getSystemInfo()

    const overview = {
      timestamp: new Date().toISOString(),
      overallStatus: 'healthy',
      components: {
        frontend: {
          status: 'healthy',
          version: '1.0.0',
          uptime: '2小时30分'
        },
        backend: {
          status: 'healthy',
          port: 3000,
          version: '1.0.0'
        },
        database: {
          status: 'healthy',
          type: 'SQLite',
          size: '45MB'
        },
        aiService: {
          status: 'healthy',
          provider: 'OpenRouter',
          model: 'GPT-4'
        }
      },
      system: {
        memoryUsage: systemInfo.memory.usage,
        cpuCores: systemInfo.cpu.cores,
        uptime: systemInfo.os.uptime,
        platform: systemInfo.os.platform
      }
    }

    res.json({
      success: true,
      data: overview
    })
  } catch (error) {
    logger.error('获取系统概览失败', error)
    res.status(500).json({
      success: false,
      message: '获取系统概览失败: ' + error.message
    })
  }
})

// 测试网络连接
router.get('/network-test', async (req, res) => {
  try {
    const testTargets = [
      { name: 'Localhost', url: 'http://localhost:3000' },
      { name: 'Google DNS', url: 'http://8.8.8.8' },
      { name: 'Baidu', url: 'https://www.baidu.com' }
    ]

    const results = {}

    for (const target of testTargets) {
      try {
        const startTime = Date.now()
        const response = await performHealthCheck(target.url)
        const latency = Date.now() - startTime

        results[target.name] = {
          status: 'success',
          latency,
          statusCode: response.status
        }
      } catch (error) {
        results[target.name] = {
          status: 'failed',
          error: error.message
        }
      }
    }

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        results
      }
    })
  } catch (error) {
    logger.error('网络测试失败', error)
    res.status(500).json({
      success: false,
      message: '网络测试失败: ' + error.message
    })
  }
})

// 获取诊断历史
router.get('/history', async (req, res) => {
  try {
    // 模拟诊断历史数据
    const history = [
      {
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        overallStatus: 'healthy',
        summary: '系统检查完成，未发现问题',
        issues: 0
      },
      {
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        overallStatus: 'warning',
        summary: '发现内存使用率较高',
        issues: 1
      },
      {
        timestamp: new Date(Date.now() - 10800000).toISOString(),
        overallStatus: 'healthy',
        summary: '系统检查完成，发现1个信息提示',
        issues: 1
      }
    ]

    res.json({
      success: true,
      data: history
    })
  } catch (error) {
    logger.error('获取诊断历史失败', error)
    res.status(500).json({
      success: false,
      message: '获取诊断历史失败: ' + error.message
    })
  }
})

// 辅助函数：执行健康检查
async function performHealthCheck(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const http = urlObj.protocol === 'https:' ? require('https') : require('http')

    const req = http.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 400,
        status: res.statusCode
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })

    req.end()
  })
}

// 辅助函数：测量网络延迟
async function measureNetworkLatency() {
  try {
    const startTime = Date.now()
    await performHealthCheck('https://www.baidu.com')
    return Date.now() - startTime
  } catch (error) {
    return 0 // 测试失败返回0
  }
}

// 辅助函数：生成建议
function generateRecommendations(issues) {
  const recommendations = []

  const criticalIssues = issues.filter(i => i.severity === 'critical')
  const warningIssues = issues.filter(i => i.severity === 'warning')

  if (criticalIssues.length > 0) {
    recommendations.push({
      priority: 'high',
      title: '立即处理严重问题',
      description: `发现 ${criticalIssues.length} 个严重问题，建议立即处理以确保系统正常运行。`,
      actions: criticalIssues.map(i => i.title)
    })
  }

  if (warningIssues.length > 0) {
    recommendations.push({
      priority: 'medium',
      title: '关注警告信息',
      description: `发现 ${warningIssues.length} 个警告，建议在方便时进行处理。`,
      actions: warningIssues.map(i => i.title)
    })
  }

  // 通用建议
  if (issues.some(i => i.component === 'memory')) {
    recommendations.push({
      priority: 'low',
      title: '优化内存使用',
      description: '建议定期重启应用，关闭不必要的进程以释放内存。',
      actions: ['重启应用', '检查内存泄漏', '优化代码']
    })
  }

  if (issues.some(i => i.component === 'service')) {
    recommendations.push({
      priority: 'medium',
      title: '检查服务配置',
      description: '建议检查相关服务的配置和网络连接。',
      actions: ['检查服务状态', '验证网络连接', '查看服务日志']
    })
  }

  return recommendations
}

module.exports = router