/**
 * 应用图标生成脚本
 * 使用 Jimp 创建不同平台的图标文件
 */

const Jimp = require('jimp')
const path = require('path')

// 图标尺寸配置
const iconSizes = {
  // Windows ICO
  ico: [16, 24, 32, 48, 64, 128, 256],

  // macOS ICNS
  icns: [16, 32, 64, 128, 256, 512, 1024],

  // Linux PNG
  png: [16, 24, 32, 48, 64, 128, 256, 512, 1024]
}

// 创建简单的图标（基于颜色和文字）
async function createIcon(size) {
  const image = new Jimp(size, size, 0x2E5090FF) // 蓝色背景

  // 添加简单的图案
  const margin = Math.floor(size * 0.1)
  const innerSize = size - (margin * 2)

  // 创建白色圆形背景
  const centerX = Math.floor(size / 2)
  const centerY = Math.floor(size / 2)
  const radius = Math.floor(innerSize / 2)

  // 使用 Jimp 绘制圆形（简化版本）
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2))
      if (distance < radius) {
        image.setPixelColor(0xFFFFFFFF, x, y) // 白色圆形
      }
    }
  }

  // 添加字母 "I" (代表 IELTS)
  const fontSize = Math.floor(size * 0.4)
  const textX = centerX - Math.floor(fontSize * 0.3)
  const textY = centerY - Math.floor(fontSize * 0.7)

  // 简化版本：用像素块绘制字母 "I"
  const letterSize = Math.floor(fontSize * 0.8)
  const letterX = textX
  const letterY = textY

  // 绘制字母 I
  for (let y = 0; y < letterSize; y++) {
    for (let x = 0; x < Math.floor(letterSize * 0.3); x++) {
      if (y < Math.floor(letterSize * 0.1) || y > Math.floor(letterSize * 0.9) ||
          (x >= Math.floor(letterSize * 0.1) && x < Math.floor(letterSize * 0.2))) {
        const pixelX = letterX + x
        const pixelY = letterY + y
        if (pixelX >= 0 && pixelX < size && pixelY >= 0 && pixelY < size) {
          image.setPixelColor(0x2E5090FF, pixelX, pixelY) // 蓝色字母
        }
      }
    }
  }

  return image
}

// 生成图标文件
async function generateIcons() {
  console.log('🎨 开始生成应用图标...')

  try {
    // 生成 Windows ICO
    console.log('生成 Windows ICO 图标...')
    const icoImages = []
    for (const size of iconSizes.ico) {
      const image = await createIcon(size)
      icoImages.push(image)
    }
    await Jimp.create(256, 256).composite(icoImages[icoImages.length - 1], 0, 0)
      .writeAsync(path.join(__dirname, 'icon.ico'))

    // 生成 macOS ICNS
    console.log('生成 macOS ICNS 图标...')
    const icnsImage = await createIcon(512)
    await icnsImage.writeAsync(path.join(__dirname, 'icon.icns'))

    // 生成 Linux PNG 图标
    console.log('生成 Linux PNG 图标...')
    for (const size of iconSizes.png) {
      const image = await createIcon(size)
      await image.writeAsync(path.join(__dirname, `icon-${size}x${size}.png`))
    }

    // 创建主要的 icon.png
    const mainIcon = await createIcon(256)
    await mainIcon.writeAsync(path.join(__dirname, 'icon.png'))

    console.log('✅ 图标生成完成!')
    console.log('📁 生成的文件:')
    console.log('  - resources/icon.ico (Windows)')
    console.log('  - resources/icon.icns (macOS)')
    console.log('  - resources/icon.png (Linux)')

  } catch (error) {
    console.error('❌ 图标生成失败:', error)
    console.log('📝 提示: 请确保已安装 jimp 包: npm install --save-dev jimp')
    process.exit(1)
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  generateIcons()
}

module.exports = { generateIcons, createIcon }