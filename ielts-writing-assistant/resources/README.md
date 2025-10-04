# 应用资源文件

此目录包含 IELTS Writing Assistant 应用程序所需的图标和资源文件。

## 文件说明

### 图标文件

- `icon.ico` - Windows 平台图标文件
- `icon.icns` - macOS 平台图标文件
- `icon.png` - Linux 平台主图标文件
- `icon-{size}x{size}.png` - 不同尺寸的 PNG 图标

### 安装程序图标

- `installer.ico` - Windows 安装程序图标
- `header-icon.ico` - Windows 安装程序头部图标

## 生成图标

要重新生成图标文件，请运行：

```bash
cd resources
node create-icons.js
```

### 前置要求

需要安装 `jimp` 图像处理库：

```bash
npm install --save-dev jimp
```

## 图标规范

### Windows (ICO)

- 支持 16x16 到 256x256 像素
- 包含多种尺寸以适应不同显示场景
- 32 位色深，支持透明度

### macOS (ICNS)

- 支持 16x16 到 1024x1024 像素
- 包含 @1x 和 @2x 版本
- 支持 Retina 显示

### Linux (PNG)

- 提供多种尺寸：16x16, 24x32, 32x32, 48x48, 64x64, 128x128, 256x256, 512x512
- 支持桌面环境和应用菜单显示
- PNG 格式，支持透明度

## 设计原则

- 简洁明了的识别性
- 在不同尺寸下保持清晰可辨
- 符合各平台的设计规范
- 体现应用的教育属性

## 更新说明

如需更新应用图标：

1. 修改 `create-icons.js` 中的生成逻辑
2. 运行生成脚本
3. 重新构建应用程序
4. 测试各平台的显示效果

## 注意事项

- 图标文件会被 electron-builder 自动打包
- 更改图标后需要清理旧的构建文件
- 确保所有平台的图标都已生成