# 安装和配置指南

本指南将帮助您完成考试总览系统的安装、配置和部署。

## 📋 系统要求

### 最低要求
- **操作系统**: Windows 7+, macOS 10.12+, Linux (任何现代发行版)
- **浏览器**: Chrome 70+, Firefox 65+, Safari 12+, Edge 79+
- **内存**: 至少2GB可用RAM
- **存储**: 至少500MB可用磁盘空间
- **网络**: 本地网络访问（用于开发服务器）

### 推荐配置
- **操作系统**: Windows 10+, macOS 12+, Ubuntu 20.04+
- **浏览器**: Chrome 90+, Firefox 85+, Safari 14+, Edge 90+
- **内存**: 4GB或更多RAM
- **存储**: 2GB或更多可用空间（用于题库文件）
- **显示器**: 1920x1080或更高分辨率

## 🔧 安装步骤

### 方法一：直接下载安装

1. **下载项目文件**
   ```bash
   # 如果有Git，可以克隆仓库
   git clone https://github.com/your-username/exam-overview-system.git
   cd exam-overview-system
   
   # 或者直接下载ZIP文件并解压
   ```

2. **验证文件结构**
   确保您的目录结构如下：
   ```
   exam-overview-system/
   ├── index.html
   ├── css/
   ├── js/
   ├── P1（12+8）/
   ├── P2（14+2）/
   ├── P3 （20+6）/
   └── README.md
   ```

3. **设置Web服务器**
   
   由于浏览器安全限制，您需要通过Web服务器访问系统：

   **选项A: Python HTTP服务器**
   ```bash
   # 在项目根目录运行
   python -m http.server 8000
   # 或者 Python 2
   python -m SimpleHTTPServer 8000
   ```

   **选项B: Node.js HTTP服务器**
   ```bash
   # 安装http-server
   npm install -g http-server
   # 在项目根目录运行
   http-server -p 8000
   ```

   **选项C: PHP内置服务器**
   ```bash
   php -S localhost:8000
   ```

4. **访问系统**
   - 打开浏览器
   - 访问 `http://localhost:8000`
   - 系统将自动初始化

### 方法二：使用开发环境

如果您是开发者或需要修改系统，推荐使用以下方法：

1. **安装Node.js和npm**
   - 从 [nodejs.org](https://nodejs.org/) 下载并安装
   - 验证安装：`node --version` 和 `npm --version`

2. **安装项目依赖**
   ```bash
   cd exam-overview-system
   npm install
   ```

3. **运行开发服务器**
   ```bash
   npm run dev
   # 或者
   npm start
   ```

4. **运行测试**
   ```bash
   npm test
   ```

## 📁 题库配置

### 题库文件结构

系统要求题库文件按特定结构组织：

```
项目根目录/
├── P1（12+8）/
│   ├── 1.高频(网页由窦立盛老师制作)/
│   │   ├── 1.A Brief History of Tea 茶叶简史/
│   │   │   └── P1 - A Brief History of Tea【高】.html
│   │   ├── 2.Fishbourne Roman Palace 菲什本罗马宫殿(躺)/
│   │   │   └── P1 - Fishbourne Roman Palace【高】.html
│   │   └── ...
│   └── 2.次高频(网页由窦立盛老师制作)/
│       ├── 1.A survivor's story 幸存者的故事（躺）/
│       └── ...
├── P2（14+2）/
│   ├── 1.高频(网页由窦立盛老师制作)/
│   └── 2.次高频(网页由窦立盛老师制作)/
└── P3 （20+6）/
    ├── 1.高频(网页由🕊️制作)/
    └── 2.次高频(网页由🕊️制作)/
```

### 文件命名规范

**目录命名**:
- 主分类：`P1（12+8）`, `P2（14+2）`, `P3 （20+6）`
- 频率分类：`1.高频(制作者信息)`, `2.次高频(制作者信息)`
- 题目目录：`序号.英文标题 中文标题`

**HTML文件命名**:
- 格式：`P[1-3] - 英文标题【高/次】.html`
- 示例：`P1 - A Brief History of Tea【高】.html`

### 添加新题目

1. **创建题目目录**
   ```bash
   mkdir "P1（12+8）/1.高频(网页由窦立盛老师制作)/新题目目录"
   ```

2. **放置HTML文件**
   - 将题目HTML文件放入对应目录
   - 确保文件名符合命名规范
   - 验证HTML文件可以正常打开

3. **刷新题库索引**
   - 在系统中点击"系统维护"
   - 选择"重新扫描题库"
   - 等待扫描完成

## ⚙️ 系统配置

### 基本配置

系统首次运行时会自动创建配置文件，您可以通过设置面板修改：

**存储配置**:
```javascript
{
  "storage": {
    "type": "localStorage",
    "prefix": "exam_system_",
    "version": "1.0.0",
    "autoBackup": true,
    "backupInterval": 86400000  // 24小时
  }
}
```

**扫描配置**:
```javascript
{
  "scanner": {
    "cacheTimeout": 86400000,  // 24小时
    "maxRetries": 3,
    "timeout": 30000,  // 30秒
    "includePatterns": ["*.html"],
    "excludePatterns": ["**/node_modules/**"]
  }
}
```

### 高级配置

**性能优化**:
```javascript
{
  "performance": {
    "enableCache": true,
    "cacheSize": 100,  // 缓存项目数
    "lazyLoading": true,
    "batchSize": 50,  // 批处理大小
    "debounceDelay": 300  // 防抖延迟(ms)
  }
}
```

**用户界面**:
```javascript
{
  "ui": {
    "theme": "light",  // light, dark, auto
    "language": "zh-CN",
    "animations": true,
    "notifications": true,
    "autoSave": true,
    "reminderTime": "19:00"
  }
}
```

## 🌐 部署配置

### 本地部署

**Apache配置** (`.htaccess`):
```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ index.html [QSA,L]

# 启用GZIP压缩
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/plain
    AddOutputFilterByType DEFLATE text/html
    AddOutputFilterByType DEFLATE text/xml
    AddOutputFilterByType DEFLATE text/css
    AddOutputFilterByType DEFLATE application/xml
    AddOutputFilterByType DEFLATE application/xhtml+xml
    AddOutputFilterByType DEFLATE application/rss+xml
    AddOutputFilterByType DEFLATE application/javascript
    AddOutputFilterByType DEFLATE application/x-javascript
</IfModule>

# 设置缓存
<IfModule mod_expires.c>
    ExpiresActive on
    ExpiresByType text/css "access plus 1 year"
    ExpiresByType application/javascript "access plus 1 year"
    ExpiresByType image/png "access plus 1 year"
    ExpiresByType image/jpg "access plus 1 year"
    ExpiresByType image/jpeg "access plus 1 year"
</IfModule>
```

**Nginx配置**:
```nginx
server {
    listen 80;
    server_name localhost;
    root /path/to/exam-overview-system;
    index index.html;

    # 启用GZIP
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # 静态文件缓存
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # HTML文件不缓存
    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 处理单页应用路由
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 网络部署

**GitHub Pages部署**:
1. 将项目推送到GitHub仓库
2. 在仓库设置中启用GitHub Pages
3. 选择源分支（通常是main或gh-pages）
4. 访问 `https://username.github.io/repository-name`

**Netlify部署**:
1. 连接GitHub仓库到Netlify
2. 设置构建命令（如果需要）：`npm run build`
3. 设置发布目录：`./`
4. 部署完成后获得访问URL

**Vercel部署**:
1. 安装Vercel CLI：`npm i -g vercel`
2. 在项目目录运行：`vercel`
3. 按提示完成配置
4. 获得部署URL

## 🔒 安全配置

### 内容安全策略 (CSP)

在HTML头部添加CSP头：
```html
<meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    font-src 'self';
    connect-src 'self';
">
```

### HTTPS配置

**使用Let's Encrypt (Linux)**:
```bash
# 安装Certbot
sudo apt-get install certbot

# 获取证书
sudo certbot certonly --webroot -w /path/to/exam-overview-system -d yourdomain.com

# 配置自动续期
sudo crontab -e
# 添加：0 12 * * * /usr/bin/certbot renew --quiet
```

### 访问控制

**基本认证** (Apache):
```apache
AuthType Basic
AuthName "Exam System Access"
AuthUserFile /path/to/.htpasswd
Require valid-user
```

**IP白名单** (Nginx):
```nginx
location / {
    allow 192.168.1.0/24;
    allow 10.0.0.0/8;
    deny all;
    try_files $uri $uri/ /index.html;
}
```

## 🔧 故障排除

### 常见安装问题

**问题1: 无法启动Web服务器**
```bash
# 检查端口是否被占用
netstat -an | grep :8000
# 或使用其他端口
python -m http.server 8001
```

**问题2: 题库扫描失败**
- 检查文件路径是否正确
- 确认HTML文件存在且可访问
- 查看浏览器控制台错误信息
- 尝试手动访问题目文件

**问题3: 浏览器兼容性问题**
- 更新浏览器到最新版本
- 检查JavaScript是否启用
- 清除浏览器缓存和Cookie
- 尝试使用隐私模式

**问题4: 存储权限问题**
- 检查LocalStorage是否启用
- 确认不在隐私模式下运行
- 清理浏览器存储空间
- 检查浏览器安全设置

### 性能优化

**优化加载速度**:
1. 启用GZIP压缩
2. 设置适当的缓存策略
3. 压缩CSS和JavaScript文件
4. 优化图片大小和格式

**减少内存使用**:
1. 及时清理不用的数据
2. 限制同时打开的题目数量
3. 定期重启浏览器
4. 使用浏览器任务管理器监控

### 日志和调试

**启用调试模式**:
```javascript
// 在浏览器控制台中运行
localStorage.setItem('exam_system_debug', 'true');
location.reload();
```

**查看系统日志**:
- 打开浏览器开发者工具 (F12)
- 切换到Console标签页
- 查看错误和警告信息
- 使用Network标签页检查网络请求

**导出诊断信息**:
1. 进入系统维护面板
2. 点击"系统诊断"
3. 导出诊断报告
4. 将报告发送给技术支持

## 📞 技术支持

如果您在安装过程中遇到问题，请：

1. **查看文档**: 首先查阅本指南和FAQ
2. **检查日志**: 查看浏览器控制台错误信息
3. **搜索问题**: 在GitHub Issues中搜索类似问题
4. **提交问题**: 创建新的Issue并提供详细信息

**提交问题时请包含**:
- 操作系统和版本
- 浏览器类型和版本
- 错误信息截图
- 复现步骤
- 系统诊断报告

---

安装完成后，请参阅[用户手册](user-manual.md)了解如何使用系统。