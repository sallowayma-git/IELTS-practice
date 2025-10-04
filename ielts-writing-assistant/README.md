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

## 快速开始

### 环境要求

- Node.js >= 20
- npm >= 9

### 安装依赖

```bash
# 进入项目目录
cd ielts-writing-assistant

# 安装依赖
npm install
```

### 开发模式

```bash
# 启动开发服务器
npm run dev
```

这将同时启动：
- Vue开发服务器 (http://localhost:5173)
- Express后端服务 (http://localhost:3001)
- Electron桌面应用

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

## 支持

如有问题或建议，请提交Issue或联系开发团队。