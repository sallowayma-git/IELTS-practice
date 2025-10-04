const path = require('path')
const fs = require('fs')

/**
 * 获取适合当前平台的图标路径
 */
function getIconPath() {
  const assetsPath = path.join(__dirname, '../assets')
  const platform = process.platform

  // 按优先级尝试不同的图标格式
  const iconCandidates = []

  switch (platform) {
    case 'win32':
      iconCandidates.push('icon.ico', 'icon.png', 'icon.svg')
      break
    case 'linux':
      iconCandidates.push('icon.png', 'icon.svg', 'icon.ico')
      break
    case 'darwin':
      iconCandidates.push('icon.icns', 'icon.svg', 'icon.png')
      break
    default:
      iconCandidates.push('icon.png', 'icon.svg')
  }

  for (const iconFile of iconCandidates) {
    const iconPath = path.join(assetsPath, iconFile)
    if (fs.existsSync(iconPath)) {
      return iconPath
    }
  }

  // 如果没有找到任何图标文件，返回undefined让Electron使用默认图标
  console.warn('No suitable icon file found, using default icon')
  return undefined
}

module.exports = {
  getIconPath
}