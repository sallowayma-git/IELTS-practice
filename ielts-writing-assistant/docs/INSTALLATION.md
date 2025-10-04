# IELTS Writing Assistant 安装指南

**版本**: 1.0.0
**更新日期**: 2025-10-04
**适用平台**: Windows, macOS, Linux

## 📥 系统要求

### 最低配置

- **操作系统**:
  - Windows 10 (64位) 或更高版本
  - macOS 10.14 (Mojave) 或更高版本
  - Ubuntu 18.04 / CentOS 7 或等效 Linux 发行版
- **内存**: 4GB RAM (推荐 8GB 或更多)
- **存储空间**: 500MB 可用磁盘空间
- **网络**: 互联网连接 (用于 AI 服务和更新)

### 推荐配置

- **操作系统**: 最新版本的 Windows 11, macOS, 或 Linux
- **内存**: 8GB RAM 或更多
- **存储空间**: 1GB 可用磁盘空间
- **处理器**: 多核 CPU
- **网络**: 稳定的宽带连接

## 🚀 安装方式

### Windows 安装

#### 方式一：使用安装程序 (推荐)

1. **下载安装程序**
   - 访问 [GitHub Releases](https://github.com/your-username/ielts-writing-assistant/releases)
   - 下载最新的 `.exe` 安装程序文件

2. **运行安装程序**
   - 双击下载的 `.exe` 文件
   - 选择安装语言（中文或英文）
   - 点击"下一步"阅读并接受许可协议
   - 选择安装路径（默认：`C:\Program Files\IELTS Writing Assistant`）
   - 选择是否创建桌面快捷方式
   - 点击"安装"开始安装

3. **完成安装**
   - 等待安装进度条完成
   - 点击"完成"退出安装程序
   - 桌面会自动创建快捷方式

#### 方式二：使用便携版

1. **下载便携版**
   - 下载最新的 `.zip` 压缩包
   - 解压到任意文件夹

2. **运行应用**
   - 进入解压后的文件夹
   - 双击 `IELTS Writing Assistant.exe` 运行

### macOS 安装

#### 方式一：使用 DMG 文件 (推荐)

1. **下载 DMG 文件**
   - 访问 [GitHub Releases](https://github.com/your-username/ielts-writing-assistant/releases)
   - 下载最新的 `.dmg` 文件

2. **安装应用**
   - 双击 `.dmg` 文件打开安装器
   - 将应用图标拖拽到 Applications 文件夹
   - 等待复制完成

3. **首次运行**
   - 在 Launchpad 或 Applications 文件夹中找到应用
   - 右键点击应用，选择"打开"
   - 在安全提示中点击"打开"以信任开发者

#### 方式二：使用 Homebrew Cask

```bash
brew install --cask ielts-writing-assistant
```

### Linux 安装

#### 方式一：使用 AppImage (推荐)

1. **下载 AppImage**
   - 下载最新的 `.AppImage` 文件

2. **设置权限**
   ```bash
   chmod +x IELTS-Writing-Assistant-*.AppImage
   ```

3. **运行应用**
   ```bash
   ./IELTS-Writing-Assistant-*.AppImage
   ```

#### 方式二：使用 DEB 包 (Ubuntu/Debian)

1. **下载 DEB 包**
   - 下载最新的 `.deb` 文件

2. **安装包**
   ```bash
   sudo dpkg -i ielts-writing-assistant_*.deb
   sudo apt-get install -f  # 解决依赖问题
   ```

#### 方式三：使用 RPM 包 (RedHat/CentOS)

1. **下载 RPM 包**
   - 下载最新的 `.rpm` 文件

2. **安装包**
   ```bash
   sudo rpm -i ielts-writing-assistant-*.rpm
   ```

## ⚙️ 配置设置

### 首次启动配置

1. **语言设置**
   - 启动应用后，在设置页面选择界面语言
   - 支持简体中文和英语

2. **AI 服务配置**
   - 进入 AI 配置页面
   - 选择 AI 服务提供商
   - 输入 API 密钥
   - 测试连接确保配置正确

3. **写作偏好设置**
   - 设置字体大小
   - 配置自动保存间隔
   - 启用语法检查等选项

### 数据存储位置

- **Windows**: `%APPDATA%/IELTS Writing Assistant/`
- **macOS**: `~/Library/Application Support/IELTS Writing Assistant/`
- **Linux**: `~/.config/IELTS Writing Assistant/`

## 🔄 更新应用

### 自动更新

应用支持自动更新检查和安装：

1. **检查更新**
   - 应用启动时会自动检查更新
   - 也可在帮助菜单中手动检查更新

2. **下载更新**
   - 发现新版本时，会显示更新提示
   - 点击"下载更新"开始下载

3. **安装更新**
   - 下载完成后，会提示安装更新
   - 应用会自动重启并安装新版本

### 手动更新

如果自动更新失败，可以手动更新：

1. **访问 GitHub Releases**
2. **下载最新版本**
3. **覆盖安装**（便携版）或运行新安装程序

## 🛠️ 故障排除

### Windows 问题

#### 问题：安装时提示"无法验证发布者"
**解决方案**：
1. 右键点击安装程序，选择"属性"
2. 在"安全"选项卡中点击"仍然运行"

#### 问题：应用无法启动
**解决方案**：
1. 检查是否安装了最新的 .NET Framework
2. 以管理员身份运行应用
3. 检查防病毒软件是否误报

### macOS 问题

#### 问题：无法打开应用，提示"来自未识别的开发者"
**解决方案**：
1. 打开"系统偏好设置" > "安全性与隐私"
2. 在"通用"选项卡中点击"仍要打开"

#### 问题：应用闪退
**解决方案**：
1. 检查 macOS 版本是否兼容
2. 删除应用配置文件后重新安装
3. 查看系统日志以确定错误原因

### Linux 问题

#### 问题：AppImage 无法运行
**解决方案**：
1. 确保文件具有执行权限：`chmod +x *.AppImage`
2. 安装必要的依赖库：`sudo apt-get install libfuse2`
3. 尝试使用 `--no-sandbox` 参数运行

#### 问题：依赖库缺失
**解决方案**：
```bash
# Ubuntu/Debian
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxkbcommon0 libasound2

# RedHat/CentOS
sudo yum install nss libXtst xorg-x11-xauth xorg-x11-utils libappindicator-gtk3
```

## 📞 技术支持

如果遇到安装或使用问题：

1. **查看日志文件**：
   - Windows: `%APPDATA%/IELTS Writing Assistant/logs/`
   - macOS: `~/Library/Logs/IELTS Writing Assistant/`
   - Linux: `~/.config/IELTS Writing Assistant/logs/`

2. **联系支持**：
   - GitHub Issues: [项目 Issues 页面](https://github.com/your-repo/issues)
   - 邮件支持: support@ielts-writing-assistant.com
   - 用户社区: [社区论坛](https://community.ielts-writing-assistant.com)

3. **提交错误报告**：
   - 包含操作系统版本
   - 附上错误日志文件
   - 描述重现步骤

## 📄 卸载指南

### Windows

1. **通过控制面板卸载**
   - 打开"控制面板" > "程序和功能"
   - 找到 "IELTS Writing Assistant"
   - 点击"卸载"

2. **手动清理**
   - 删除安装目录
   - 清理用户数据文件夹

### macOS

1. **删除应用**
   - 将应用拖拽到废纸篓
   - 清空废纸篓

2. **清理数据**
   - 删除 `~/Library/Application Support/IELTS Writing Assistant/`
   - 删除 `~/Library/Preferences/com.ielts.assistant.app.plist`

### Linux

1. **卸载包**
   ```bash
   # Ubuntu/Debian
   sudo dpkg -r ielts-writing-assistant

   # RedHat/CentOS
   sudo rpm -e ielts-writing-assistant
   ```

2. **清理数据**
   ```bash
   rm -rf ~/.config/IELTS Writing Assistant/
   ```

---

**© 2025 IELTS Writing Assistant Team. 保留所有权利。**