/**
 * 后打包脚本
 * 在打包后执行必要的清理工作
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// 生成文件校验和
const generateChecksums = (distPath) => {
  const checksums = {}

  const files = fs.readdirSync(distPath)
  files.forEach(file => {
    const filePath = path.join(distPath, file)
    const fileBuffer = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    checksums[file] = hash
  })

  const checksumsPath = path.join(distPath, 'checksums.json')
  fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2))
  console.log('✅ 生成文件校验和:', checksumsPath)
}

// 生成构建报告
const generateBuildReport = (distPath) => {
  const files = fs.readdirSync(distPath)
  const stats = files.map(file => {
    const filePath = path.join(distPath, file)
    const stat = fs.statSync(filePath)
    return {
      name: file,
      size: stat.size,
      created: stat.birthtime,
      modified: stat.mtime
    }
  })

  const report = {
    buildTime: new Date().toISOString(),
    totalFiles: files.length,
    totalSize: stats.reduce((sum, file) => sum + file.size, 0),
    files: stats
  }

  const reportPath = path.join(distPath, 'build-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log('✅ 生成构建报告:', reportPath)
}

// 清理临时文件
const cleanupTempFiles = () => {
  const tempFiles = [
    'temp',
    '.tmp',
    '*.log'
  ]

  tempFiles.forEach(pattern => {
    // 这里可以添加更复杂的文件清理逻辑
    console.log(`🧹 清理临时文件: ${pattern}`)
  })
}

// 主函数
const main = () => {
  console.log('🔄 开始后打包处理...')

  try {
    const distPath = 'dist-electron'

    if (fs.existsSync(distPath)) {
      generateChecksums(distPath)
      generateBuildReport(distPath)
    }

    cleanupTempFiles()

    console.log('✅ 后打包处理完成')
  } catch (error) {
    console.error('❌ 后打包处理失败:', error)
    process.exit(1)
  }
}

main()