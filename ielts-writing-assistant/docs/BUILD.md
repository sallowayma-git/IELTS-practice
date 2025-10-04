# 构建和部署指南

**版本**: 1.0.0
**更新日期**: 2025-10-04
**面向开发者**: 开发团队、发布工程师

## 📋 概述

本文档描述了如何构建 IELTS Writing Assistant 的桌面应用程序，包括开发环境搭建、构建流程、打包配置和发布流程。

## 🔧 开发环境准备

### 前置要求

- **Node.js**: 18.x 或更高版本
- **npm**: 9.x 或更高版本
- **Git**: 最新版本
- **Python**: 3.x (某些依赖包需要)

### 环境检查

```bash
# 检查 Node.js 版本
node --version

# 检查 npm 版本
npm --version

# 检查 Git 版本
git --version
```

### 环境配置

1. **复制环境配置文件**
   ```bash
   cp .env.example .env
   ```

2. **更新配置**
   编辑 `.env` 文件，设置以下重要变量：
   - `GITHUB_OWNER`: GitHub 用户名或组织名
   - `GITHUB_REPO`: 仓库名称
   - `NODE_ENV`: 环境类型（development/production）

3. **代码签名配置**（可选）
   - Windows: 设置 `CSC_LINK` 和 `CSC_KEY_PASSWORD`
   - macOS: 设置 `APPLE_ID`、`APPLE_ID_PASSWORD`、`APPLE_TEAM_ID`

## 📦 项目依赖安装

### 安装依赖

```bash
# 克隆项目
git clone https://github.com/your-username/ielts-writing-assistant.git
cd ielts-writing-assistant

# 安装依赖
npm install

# 安装 Electron 相关依赖
npm run postinstall
```

### 开发依赖说明

主要开发依赖包括：

- `electron`: 桌面应用框架
- `electron-builder`: 应用打包工具
- `vite`: 前端构建工具
- `electron-updater`: 自动更新功能
- `concurrently`: 并发运行脚本
- `wait-on`: 等待服务启动

## 🏗️ 构建流程

### 开发构建

```bash
# 启动开发环境
npm run dev

# 分别启动各个服务
npm run dev:vue      # 前端开发服务器
npm run dev:server   # 后端 API 服务器
npm run dev:electron # Electron 主进程
```

### 生产构建

```bash
# 构建前端应用
npm run build

# 构建 Electron 应用（当前平台）
npm run build:electron

# 构建所有平台
npm run dist:all

# 构建特定平台
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

### 构建脚本说明

| 脚本 | 说明 |
|------|------|
| `build` | 构建前端应用到 `dist/` 目录 |
| `build:electron` | 构建当前平台的 Electron 应用 |
| `build:win` | 构建 Windows 版本 |
| `build:mac` | 构建 macOS 版本 |
| `build:linux` | 构建 Linux 版本 |
| `dist` | 构建并打包到 `dist-electron/` |
| `dist:all` | 构建所有平台的版本 |
| `pack` | 打包但不分发（用于测试） |
| `release` | 构建并发布到 GitHub |

## 🔨 构建配置

### 构建配置

构建配置位于 `package.json` 的 `build` 字段中，包含：

- **应用信息**: 产品名称、应用ID、版权信息
- **目录配置**: 输出目录、资源目录、缓存目录
- **文件包含**: 要打包的文件和排除规则
- **平台配置**: Windows、macOS、Linux 的特定设置
- **发布配置**: 更新服务器和发布设置
- **脚本钩子**: 打包前后的自定义脚本

主要配置项：

```json
{
  "productName": "IELTS Writing Assistant",
  "appId": "com.ielts.assistant.app",
  "directories": {
    "output": "dist-electron",
    "buildResources": "build"
  },
  "files": [
    "dist/**/*",
    "server/**/*",
    "electron/**/*"
  ],
  "win": {
    "target": ["nsis", "portable"],
    "icon": "resources/icon.ico"
  },
  "mac": {
    "target": ["dmg", "zip"],
    "icon": "resources/icon.icns"
  },
  "linux": {
    "target": ["AppImage", "deb", "rpm"],
    "icon": "resources/icon.png"
  },
  "publish": {
    "provider": "github",
    "owner": "your-username",
    "repo": "ielts-writing-assistant"
  }
}
```

### 平台特定配置

#### Windows 配置

- **目标格式**: NSIS 安装程序和便携版
- **签名**: 支持 Code Signing 证书
- **安装器**: 自定义 NSIS 脚本
- **文件关联**: 支持 `.ielts` 文件类型

#### macOS 配置

- **目标格式**: DMG 磁盘映像和 ZIP 压缩包
- **公证**: 支持 Apple 公证服务
- **类别**: 教育类应用
- **权限**: 硬化运行时和沙箱

#### Linux 配置

- **目标格式**: AppImage、DEB、RPM
- **类别**: 教育类应用
- **桌面集成**: 支持 Linux 桌面环境

## 🚀 发布流程

### 版本管理

```bash
# 更新版本号
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0
```

### 发布准备

1. **更新版本信息**
   ```bash
   # 编辑 package.json 版本号
   # 更新 CHANGELOG.md
   ```

2. **生成应用图标**
   ```bash
   cd resources
   node create-icons.js
   ```

3. **测试构建**
   ```bash
   npm run pack
   ```

### 自动发布

```bash
# 发布到 GitHub Releases
npm run release

# 发布到特定平台
npm run release:win
npm run release:mac
npm run release:linux
```

### 手动发布

1. **构建所有平台**
   ```bash
   npm run dist:all
   ```

2. **创建 GitHub Release**
   - 登录 GitHub
   - 创建新 Release
   - 上传构建文件
   - 填写发布说明

3. **更新下载链接**
   - 更新官网下载链接
   - 更新文档中的链接

## 🔄 自动更新配置

### 更新服务器设置

应用支持从 GitHub Releases 自动更新，配置方式：

1. **环境变量配置**（推荐）
   ```bash
   # .env 文件
   UPDATE_PROVIDER=github
   GITHUB_OWNER=your-username
   GITHUB_REPO=ielts-writing-assistant
   GITHUB_PRIVATE=false
   ```

2. **运行时配置**
   ```javascript
   // 通过 API 配置
   await window.electronAPI.updater.configure({
     provider: 'github',
     owner: 'your-username',
     repo: 'ielts-writing-assistant',
     private: false
   })
   ```

3. **package.json 配置**
   ```json
   {
     "build": {
       "publish": {
         "provider": "github",
         "owner": "your-username",
         "repo": "ielts-writing-assistant"
       }
     }
   }
   ```

### 签名配置

#### Windows 代码签名

```bash
# 设置环境变量
export CSC_LINK="path/to/certificate.p12"
export CSC_KEY_PASSWORD="certificate_password"
```

#### macOS 代码签名

```bash
# 设置环境变量
export CSC_LINK="path/to/certificate.p12"
export CSC_KEY_PASSWORD="certificate_password"
export APPLE_ID="apple@id.com"
export APPLE_ID_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="team_id"
```

## 🧪 测试流程

### 本地测试

```bash
# 打包测试版本
npm run pack

# 测试安装程序
npm run dist

# 测试自动更新
npm run test:updater
```

### 平台测试

- **Windows**: 在 Windows 10/11 上测试安装程序和便携版
- **macOS**: 在 macOS 10.14+ 上测试 DMG 和自动更新
- **Linux**: 在主流发行版上测试 AppImage、DEB、RPM

### 自动化测试

```bash
# 运行单元测试
npm test

# 运行端到端测试
npm run test:e2e

# 运行集成测试
npm run test:integration
```

## 📊 构建优化

### 构建时间优化

1. **并行构建**
   ```bash
   # 使用并发构建
   npm run build:parallel
   ```

2. **缓存配置**
   ```bash
   # 清理缓存
   npm run clean
   ```

3. **增量构建**
   ```bash
   # 增量构建
   npm run build:incremental
   ```

### 包大小优化

1. **依赖优化**
   ```bash
   # 分析包大小
   npm run analyze:size

   # 移除未使用的依赖
   npm run prune:deps
   ```

2. **资源压缩**
   ```bash
   # 压缩图片资源
   npm run optimize:images

   # 压缩代码
   npm run optimize:code
   ```

## 🔍 故障排除

### 常见构建问题

#### 问题：构建失败，内存不足
**解决方案**：
```bash
# 增加 Node.js 内存限制
export NODE_OPTIONS="--max-old-space-size=4096"
```

#### 问题：Windows 构建签名失败
**解决方案**：
```bash
# 检查证书路径和密码
echo $CSC_LINK
echo $CSC_KEY_PASSWORD

# 重新导入证书
npm run import:cert
```

#### 问题：macOS 公证失败
**解决方案**：
```bash
# 检查 Apple ID 和密码
echo $APPLE_ID
echo $APPLE_ID_PASSWORD

# 手动公证
npm run notarize:manual
```

### 构建日志分析

```bash
# 查看详细构建日志
npm run build -- --verbose

# 分析构建性能
npm run analyze:build
```

## 📋 发布检查清单

### 发布前检查

- [ ] 版本号已更新
- [ ] CHANGELOG.md 已更新
- [ ] 所有测试通过
- [ ] 构建在所有平台上成功
- [ ] 安装程序测试通过
- [ ] 自动更新功能正常
- [ ] 签名和公证完成
- [ ] 文档已更新

### 发布后检查

- [ ] GitHub Release 创建成功
- [ ] 下载链接正常
- [ ] 自动更新可用
- [ ] 用户反馈收集
- [ ] 错误监控正常

## 📞 支持

如果遇到构建或发布问题：

1. **查看构建日志**: `dist-electron/builder-debug.log`
2. **检查 GitHub Actions**: 项目的 Actions 页面
3. **联系团队**: 开发团队内部渠道
4. **查阅文档**: [electron-builder 官方文档](https://www.electron.build/)

---

**© 2025 IELTS Writing Assistant Team. 保留所有权利。**