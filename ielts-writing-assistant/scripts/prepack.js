/**
 * 预打包脚本
 * 在打包前执行必要的准备工作
 */

const fs = require('fs')
const path = require('path')

// 确保必要的目录存在
const ensureDirectories = () => {
  const directories = [
    'dist-electron',
    'resources',
    'build'
  ]

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log(`✅ 创建目录: ${dir}`)
    }
  })
}

// 清理旧的构建文件
const cleanOldBuilds = () => {
  const dirsToClean = ['dist-electron']

  dirsToClean.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      console.log(`🧹 清理目录: ${dir}`)
    }
  })
}

// 检查必要文件
const checkRequiredFiles = () => {
  const requiredFiles = [
    'electron/main.js',
    'electron/preload.js',
    'electron-builder.json',
    'package.json'
  ]

  const missingFiles = requiredFiles.filter(file => !fs.existsSync(file))

  if (missingFiles.length > 0) {
    console.error('❌ 缺少必要文件:')
    missingFiles.forEach(file => console.error(`  - ${file}`))
    process.exit(1)
  }
}

// 生成构建信息
const generateBuildInfo = () => {
  const buildInfo = {
    buildTime: new Date().toISOString(),
    version: require('../package.json').version,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  }

  fs.writeFileSync(
    path.join('dist', 'build-info.json'),
    JSON.stringify(buildInfo, null, 2)
  )

  console.log('✅ 生成构建信息文件')
}

// 主函数
const main = () => {
  console.log('🚀 开始预打包准备工作...')

  try {
    cleanOldBuilds()
    ensureDirectories()
    checkRequiredFiles()
    generateBuildInfo()

    console.log('✅ 预打包准备完成')
  } catch (error) {
    console.error('❌ 预打包准备失败:', error)
    process.exit(1)
  }
}

main()