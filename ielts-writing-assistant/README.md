# 雅思AI作文评判助手

基于Vue 3 + Electron + AI的桌面端雅思写作评估应用。

## 功能特性

- ✨ **智能AI评估**: 基于先进AI技术的专业写作评估
- 📊 **多维度评分**: 任务回应、连贯性、词汇、语法四个维度
- 📝 **实时反馈**: 流式AI响应，实时获取评估结果
- 📈 **历史记录**: 完整的练习历史和进步追踪
- ⚙️ **个性化设置**: 可配置的AI参数和写作偏好
- 💾 **本地存储**: SQLite数据库，数据安全可靠

## 技术栈

- **前端**: Vue 3 + Element Plus + TipTap + ECharts
- **桌面端**: Electron
- **后端**: Express.js + SQLite
- **AI服务**: OpenAI API / Azure OpenAI
- **构建工具**: Vite

## 📥 安装应用

### 用户安装

#### Windows

1. 下载最新的 `.exe` 安装程序
2. 双击运行并按照提示完成安装
3. 从桌面快捷方式启动应用

#### macOS

1. 下载最新的 `.dmg` 文件
2. 双击打开并将应用拖拽到 Applications 文件夹
3. 从 Launchpad 或 Applications 文件夹启动应用

#### Linux

1. 下载最新的 `.AppImage` 文件
2. 添加执行权限：`chmod +x *.AppImage`
3. 双击运行或在终端中执行

详细安装说明请参考：[安装指南](docs/INSTALLATION.md)

### 开发者设置

#### 环境要求

- Node.js >= 18
- npm >= 9

#### 安装依赖

```bash
# 进入项目目录
cd ielts-writing-assistant

# 安装依赖
npm install
```

### 纯静态离线体验

在网络受限或仅需验证前端交互流程的场景下，可以使用项目内置的 **静态体验版**：

```text
static/index.html
```

该页面仅依赖原生 HTML/CSS/JavaScript，可直接通过 `file://` 协议或任何静态文件服务器打开。

1. 打开 `static/index.html`，等待顶部状态提示从“JS 环境未预热”切换为“JS 环境已就绪”；
2. 随机题目按钮会在本地随机切换题库；
3. 在作文输入框中输入文本，实时观察词数、句数和词汇多样性统计；
4. 点击“开始评估”触发前端评分逻辑，并在右侧面板查看分项得分、反馈建议与历史记录。

该离线页面专为沙箱端到端测试设计：顶部会展示“静态离线演示模式”横幅以明确区别于 Vite 正式界面，主页包含需求文档中描述的写作评估、历史数据与设置卡片布局，并保留 Legacy 听力/阅读模块的入口提示，方便对照集成要求。

在静态模式下，点击“听力练习（Legacy）”或“阅读练习（Legacy）”按钮不会跳转实际页面，而是更新提示文案，提醒需在 Vue Router 中加载对应的 legacy 模块。

#### 开发模式

```bash
# 启动开发服务器
npm run dev
```

这将同时启动：
- Vue开发服务器 (http://localhost:5173)
- Express后端服务 (http://localhost:3001)
- Electron桌面应用

#### 构建应用

```bash
# 构建生产版本
npm run build

# 打包 Electron 应用
npm run build:electron

# 构建所有平台
npm run dist:all
```

详细构建说明请参考：[构建指南](docs/BUILD.md)

### 开发测试资产

所有沙箱演示、自动化脚本与临时校验工具统一存放在 `develop-test/` 目录，便于投产前一键移除：

- Python 自动化脚本与端到端测试：`develop-test/test-streaming-e2e.py`、`develop-test/verify-db-api-consistency.py`
- Shell / Node 辅助脚本：`develop-test/test-e2e-simple.sh`、`develop-test/test-fixes.js`
- 语法快速检查工具：`develop-test/quick-synt-check.py`

如需纳入正式构建，可直接排除整个目录，不会影响主业务代码。

### 生产构建

```bash
# 构建Web应用
npm run build

# 构建Electron应用
npm run build:electron
```

## 项目结构

```
ielts-writing-assistant/
├── src/                    # Vue前端源码
│   ├── components/         # Vue组件
│   ├── views/             # 页面视图
│   ├── stores/            # Pinia状态管理
│   ├── utils/             # 工具函数
│   └── router/            # 路由配置
├── electron/              # Electron主进程
│   ├── main.js           # 主进程入口
│   └── preload.js        # 预加载脚本
├── server/               # Express后端
│   ├── routes/           # API路由
│   ├── models/           # 数据模型
│   └── middleware/       # 中间件
├── templates/            # 题目模板
├── docs/                 # 文档
└── data/                 # 数据库文件
```

## API接口

### 写作相关
- `GET /api/writing/topics` - 获取题目列表
- `GET /api/writing/topics/:id` - 获取题目详情
- `POST /api/writing/records` - 保存写作记录
- `GET /api/writing/records/:id` - 获取写作记录

### 评估相关
- `POST /api/assessment/submit` - 提交作文评估
- `GET /api/assessment/results/:id` - 获取评估结果
- `GET /api/assessment/writing/:writingId` - 获取写作的评估结果

### 历史记录
- `GET /api/history/records` - 获取历史记录列表
- `GET /api/history/statistics` - 获取统计数据
- `DELETE /api/history/records/:id` - 删除记录
- `GET /api/history/export` - 导出历史记录

### 设置相关
- `GET /api/settings/` - 获取所有设置
- `PUT /api/settings/` - 更新设置
- `POST /api/settings/test-ai-connection` - 测试AI连接

## 开发指南

### 添加新功能

1. **前端组件**: 在`src/components/`中创建Vue组件
2. **页面路由**: 在`src/views/`中创建页面并配置路由
3. **API接口**: 在`server/routes/`中添加路由处理
4. **数据模型**: 在`server/models/`中定义数据模型

### 数据库操作

数据库使用SQLite，初始化脚本在`server/index.js`中。

### AI集成

当前使用模拟AI服务，生产环境需要配置真实的AI API密钥。

## 配置说明

### AI配置
在设置页面配置AI服务提供商和API密钥：
- OpenAI: 需要有效的OpenAI API密钥
- Azure OpenAI: 需要Azure配置信息
- 本地模型: 支持本地部署的AI模型

### 数据存储
- 数据库文件: `data/ielts-writing.db`
- 自动备份: 支持定期自动备份
- 导入导出: 支持JSON格式的数据导入导出

## 构建发布

### Windows
```bash
npm run build:electron
# 生成 dist-electron/ 文件夹
```

### macOS
```bash
npm run build:electron
# 生成 .dmg 安装包
```

### Linux
```bash
npm run build:electron
# 生成 .AppImage 文件
```

## 许可证

MIT License

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 🔄 自动更新

应用支持自动更新功能：

1. **检查更新**: 应用启动时自动检查新版本
2. **下载更新**: 后台静默下载更新包
3. **安装更新**: 重启应用并完成更新安装

如遇更新问题，可手动下载最新版本覆盖安装。

## 📖 文档

- [用户手册](docs/USER_MANUAL.md)
- [安装指南](docs/INSTALLATION.md)
- [构建指南](docs/BUILD.md)
- [API文档](docs/API_DOCUMENTATION.md)
- [题库管理文档](docs/QUESTION_BANK_MANAGEMENT.md)

## 🗺️ 路线图

### v1.1 (计划中)
- [ ] 更多AI模型支持
- [ ] 团队协作功能
- [ ] 云端同步
- [ ] 移动端支持

### v1.2 (计划中)
- [ ] 高级统计分析
- [ ] 自定义评估模板
- [ ] 语音输入功能
- [ ] 多语言界面

## 许可证

MIT License

## 贡献指南

我们欢迎所有形式的贡献：

1. **报告问题**: 在 GitHub Issues 中报告 Bug
2. **功能建议**: 提出新功能的想法和建议
3. **代码贡献**: 提交 Pull Request
4. **文档改进**: 帮助完善文档

### 开发规范

- 遵循 ESLint 代码规范
- 编写单元测试
- 更新相关文档
- 提交前运行 `npm run test`

## 📞 技术支持

- **GitHub Issues**: [提交问题](https://github.com/your-repo/issues)
- **用户社区**: [讨论区](https://github.com/your-repo/discussions)
- **邮件支持**: support@ielts-writing-assistant.com

---

**© 2025 IELTS Writing Assistant Team. 保留所有权利。**