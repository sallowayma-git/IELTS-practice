const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')

// 获取所有供应商的API密钥状态
router.get('/status', (req, res) => {
  try {
    const envPath = path.join(__dirname, '../../.env')
    const envContent = fs.readFileSync(envPath, 'utf8')

    const providers = {
      openai: {
        hasKey: !!process.env.OPENAI_API_KEY,
        keyPreview: process.env.OPENAI_API_KEY ?
          `****${process.env.OPENAI_API_KEY.slice(-4)}` : null
      },
      gemini: {
        hasKey: !!process.env.GEMINI_API_KEY,
        keyPreview: process.env.GEMINI_API_KEY ?
          `****${process.env.GEMINI_API_KEY.slice(-4)}` : null
      },
      deepseek: {
        hasKey: !!process.env.DEEPSEEK_API_KEY,
        keyPreview: process.env.DEEPSEEK_API_KEY ?
          `****${process.env.DEEPSEEK_API_KEY.slice(-4)}` : null
      },
      openrouter: {
        hasKey: !!process.env.OPENROUTER_API_KEY,
        keyPreview: process.env.OPENROUTER_API_KEY ?
          `****${process.env.OPENROUTER_API_KEY.slice(-4)}` : null
      }
    }

    res.json({
      success: true,
      data: providers
    })
  } catch (error) {
    console.error('获取API密钥状态失败:', error)
    res.status(500).json({
      success: false,
      message: '获取API密钥状态失败'
    })
  }
})

// 保存API密钥到.env文件
router.post('/save', (req, res) => {
  try {
    const { provider, apiKey } = req.body

    if (!provider || !apiKey) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: provider 和 apiKey'
      })
    }

    const validProviders = ['openai', 'gemini', 'deepseek', 'openrouter']
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        message: '不支持的供应商'
      })
    }

    const envPath = path.join(__dirname, '../../.env')
    let envContent = fs.readFileSync(envPath, 'utf8')

    // 定义环境变量映射
    const envKeyMap = {
      openai: 'OPENAI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      openrouter: 'OPENROUTER_API_KEY'
    }

    const envKey = envKeyMap[provider]

    // 使用正则表达式查找并替换或添加API密钥
    const keyRegex = new RegExp(`^${envKey}=.*$`, 'm')

    if (keyRegex.test(envContent)) {
      // 替换现有的API密钥
      envContent = envContent.replace(keyRegex, `${envKey}=${apiKey}`)
    } else {
      // 添加新的API密钥
      envContent += `\n${envKey}=${apiKey}`
    }

    // 写入.env文件
    fs.writeFileSync(envPath, envContent)

    // 更新当前进程的环境变量
    process.env[envKey] = apiKey

    res.json({
      success: true,
      message: `${provider} API密钥保存成功`
    })
  } catch (error) {
    console.error('保存API密钥失败:', error)
    res.status(500).json({
      success: false,
      message: '保存API密钥失败'
    })
  }
})

// 删除API密钥
router.delete('/:provider', (req, res) => {
  try {
    const { provider } = req.params

    const validProviders = ['openai', 'gemini', 'deepseek', 'openrouter']
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        message: '不支持的供应商'
      })
    }

    const envPath = path.join(__dirname, '../../.env')
    let envContent = fs.readFileSync(envPath, 'utf8')

    // 定义环境变量映射
    const envKeyMap = {
      openai: 'OPENAI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      openrouter: 'OPENROUTER_API_KEY'
    }

    const envKey = envKeyMap[provider]

    // 使用正则表达式删除API密钥行
    const keyRegex = new RegExp(`^${envKey}=.*$\\s?`, 'm')
    envContent = envContent.replace(keyRegex, '')

    // 写入.env文件
    fs.writeFileSync(envPath, envContent)

    // 删除当前进程的环境变量
    delete process.env[envKey]

    res.json({
      success: true,
      message: `${provider} API密钥删除成功`
    })
  } catch (error) {
    console.error('删除API密钥失败:', error)
    res.status(500).json({
      success: false,
      message: '删除API密钥失败'
    })
  }
})

module.exports = router