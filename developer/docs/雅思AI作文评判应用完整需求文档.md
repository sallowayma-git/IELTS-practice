<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# 雅思AI作文评判应用完整需求文档

## 1. 项目概述

### 1.1 项目定位

本地桌面应用，面向雅思考生提供学术类（Academic）写作Task 1和Task 2的AI智能评分服务，支持详细的语法错误标注、分项评分、历史记录管理和题目库管理[^11][^12][^13]。

### 1.2 核心价值

- **本地运行**：无需担心数据隐私，所有数据存储在用户本地[^14][^15]
- **灵活配置**：支持OpenAI、OpenRouter、DeepSeek等多个LLM供应商[^16]
- **专业评分**：基于IELTS官方四项评分标准：Task Achievement/Response、Coherence and Cohesion、Lexical Resource、Grammatical Range and Accuracy[^11][^17]
- **实时反馈**：流式返回评分结果，即时展示错误标注[^18][^19]
- **历史追踪**：完整记录评分历史，支持对比分析[^20][^21]


### 1.3 整合需求

现有纯原生JavaScript实现的雅思听力和阅读练习系统需整合到本应用中，两系统业务逻辑完全分离，通过Vue Router统一管理导航，但保持各自独立运行[^22][^23]。

***

## 2. 技术架构

### 2.1 技术栈选型

#### 前端技术栈

- **框架**：Vue 3（Composition API + `<script setup>`语法）[^24][^25]
- **UI组件库**：Element Plus（成熟稳定，中文文档完善）[^26][^27][^28]
- **富文本编辑器**：Tiptap（Vue 3原生支持，现代化设计）[^29][^30][^31]
- **图表库**：Apache ECharts（企业级可靠，雷达图开箱即用）[^3][^5]
- **状态管理**：Pinia（Vue 3官方推荐，用于API配置、用户设置、草稿管理）[^24][^25]
- **路由管理**：Vue Router 4[^23]
- **国际化**：vue-i18n（支持中英文切换）[^32]
- **虚拟滚动**：vue-virtual-scroller（历史记录列表性能优化）[^21]


#### 后端技术栈

- **运行时**：Node.js 18+[^18]
- **Web框架**：Express（轻量级，SSE支持优秀）[^18][^33]
- **数据库**：SQLite（better-sqlite3同步API，性能最优）[^34][^35]
- **API客户端**：原生fetch（Node.js 18+原生支持）[^36]


#### 桌面应用

- **框架**：Electron（跨平台桌面应用）[^37][^32]
- **打包工具**：Electron Builder（支持Windows/macOS/Linux）[^38]


### 2.2 项目结构

```
ielts-writing-ai/
├── electron/                    # Electron主进程
│   ├── main.js                 # 主进程入口
│   ├── preload.js              # 预加载脚本
│   └── ipc-handlers.js         # IPC通信处理器
├── server/                      # Node.js后端
│   ├── app.js                  # Express服务器入口
│   ├── routes/
│   │   ├── evaluate.js         # 评分API路由
│   │   ├── topics.js           # 题目管理路由
│   │   ├── essays.js           # 历史记录路由
│   │   ├── api-config.js       # API配置路由
│   │   └── upload.js           # 图片上传路由
│   ├── services/
│   │   ├── llm.service.js      # LLM调用服务
│   │   ├── sse.service.js      # SSE流式服务
│   │   └── db.service.js       # 数据库服务
│   ├── db/
│   │   ├── schema.sql          # 数据库表结构
│   │   └── migrations/         # 数据库迁移脚本
│   └── utils/
│       ├── error-handler.js    # 错误处理
│       └── logger.js           # 日志记录
├── src/                         # Vue前端源码
│   ├── main.js                 # Vue应用入口
│   ├── App.vue                 # 根组件
│   ├── router/
│   │   └── index.js            # 路由配置
│   ├── store/                  # Pinia状态管理
│   │   ├── index.js            # Store入口
│   │   ├── api-config.js       # API配置Store
│   │   ├── user-settings.js    # 用户设置Store
│   │   └── draft.js            # 草稿管理Store
│   ├── views/                  # 页面组件
│   │   ├── WritingModule/      # 写作模块（详见组件树）
│   │   ├── LegacyWrapper.vue   # 原生JS页面包装器
│   │   ├── Settings.vue        # 设置页面
│   │   └── Welcome.vue         # 首次启动引导
│   ├── components/             # 通用组件
│   │   ├── EchartWrapper.vue   # ECharts封装组件
│   │   ├── TiptapEditor.vue    # Tiptap编辑器封装
│   │   └── ImageUploader.vue   # 图片上传组件
│   ├── composables/            # 组合式函数
│   │   ├── useSSE.js           # SSE流式连接Hook
│   │   ├── useDraft.js         # 草稿自动保存Hook
│   │   └── useHistory.js       # 历史记录Hook
│   ├── utils/
│   │   ├── api.js              # API请求封装
│   │   └── constants.js        # 常量定义
│   ├── locales/                # 国际化文件
│   │   ├── en.json             # 英文
│   │   └── zh-CN.json          # 简体中文
│   └── assets/                 # 静态资源
│       ├── styles/             # 全局样式
│       └── icons/              # 图标
├── legacy/                      # 原生JS听力阅读系统
│   ├── listening/
│   │   ├── index.html
│   │   ├── listening.js
│   │   └── listening.css
│   └── reading/
│       ├── index.html
│       ├── reading.js
│       └── reading.css
├── public/                      # 公共资源
│   └── default-topics.json     # 内置题库
└── package.json
```


***

## 3. 数据库设计

### 3.1 表结构定义

#### 3.1.1 topics（题目库表）

```sql
CREATE TABLE topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('task1', 'task2')),
  category TEXT NOT NULL,
  -- task1: 'bar_chart'/'pie_chart'/'line_chart'/'flow_chart'/'map'/'table'/'process'/'mixed'
  -- task2: 'education'/'technology'/'society'/'environment'/'health'/'culture'/'government'/'economy'
  difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 5),
  title_json TEXT NOT NULL,
  -- Tiptap JSON格式：{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}
  image_path TEXT,
  -- 相对路径，相对于userData/images/，例如："abc123.png"
  is_official INTEGER DEFAULT 0,
  -- 0: 用户自定义, 1: 官方内置题目
  usage_count INTEGER DEFAULT 0,
  -- 题目使用次数统计
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_topics_type ON topics(type);
CREATE INDEX idx_topics_category ON topics(category);
CREATE INDEX idx_topics_difficulty ON topics(difficulty);
```


#### 3.1.2 essays（作文记录表）

```sql
CREATE TABLE essays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER,
  -- 外键关联topics表，可为NULL（自由写作）
  task_type TEXT NOT NULL CHECK(task_type IN ('task1', 'task2')),
  content TEXT NOT NULL,
  -- 用户作文原文
  word_count INTEGER NOT NULL,
  llm_provider TEXT NOT NULL,
  -- 'openai' / 'openrouter' / 'deepseek'
  model_name TEXT NOT NULL,
  -- 例如 'gpt-4' / 'deepseek-chat'
  total_score REAL,
  -- 总分，0-9分，精确到0.5
  task_achievement REAL,
  -- Task 1: Task Achievement; Task 2: Task Response
  coherence_cohesion REAL,
  lexical_resource REAL,
  grammatical_range REAL,
  evaluation_json TEXT NOT NULL,
  -- 完整评分JSON（包含sentences数组、errors数组、overall_feedback）
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
);

CREATE INDEX idx_essays_submitted_at ON essays(submitted_at DESC);
CREATE INDEX idx_essays_task_type ON essays(task_type);
CREATE INDEX idx_essays_topic_id ON essays(topic_id);
CREATE INDEX idx_essays_total_score ON essays(total_score);
```


#### 3.1.3 api_configs（API配置表）

```sql
CREATE TABLE api_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_name TEXT NOT NULL UNIQUE,
  -- 配置名称，例如 "OpenAI GPT-4" / "DeepSeek V3"
  provider TEXT NOT NULL CHECK(provider IN ('openai', 'openrouter', 'deepseek')),
  base_url TEXT NOT NULL,
  -- 例如 "https://api.openai.com/v1" / "https://api.deepseek.com"
  api_key TEXT NOT NULL,
  default_model TEXT NOT NULL,
  -- 默认模型名称，例如 "gpt-4-turbo" / "deepseek-chat"
  is_enabled INTEGER DEFAULT 1,
  -- 0: 禁用, 1: 启用
  is_default INTEGER DEFAULT 0,
  -- 0: 非默认, 1: 默认配置（每次只能有一个）
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```


#### 3.1.4 app_settings（应用设置表）

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  -- 设置项名称，例如 'language' / 'temperature_mode' / 'max_tokens'
  value TEXT NOT NULL
  -- JSON格式存储值，例如 '"zh-CN"' / '{"task1":0.3,"task2":0.5}'
);

-- 预置默认设置
INSERT INTO app_settings (key, value) VALUES
  ('language', '"zh-CN"'),
  ('temperature_mode', '"balanced"'),
  ('temperature_task1', '0.3'),
  ('temperature_task2', '0.5'),
  ('max_tokens', '4096'),
  ('history_limit', '100'),
  ('auto_save_interval', '10000'),
  ('theme', '"light"');
```


#### 3.1.5 prompts（提示词配置表）

```sql
CREATE TABLE prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  -- 版本号，例如 "1.0.0" / "1.1.0"
  task_type TEXT NOT NULL CHECK(task_type IN ('task1', 'task2')),
  system_prompt TEXT NOT NULL,
  -- 系统提示词主体
  scoring_criteria TEXT NOT NULL,
  -- 评分标准详细描述（四项标准）
  output_format_example TEXT NOT NULL,
  -- 输出格式JSON示例
  is_active INTEGER DEFAULT 0,
  -- 0: 非激活, 1: 激活（每个task_type只能有一个激活版本）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 确保每个任务类型只有一个激活提示词
CREATE UNIQUE INDEX idx_prompts_active ON prompts(task_type, is_active) WHERE is_active = 1;
```


### 3.2 评分JSON结构规范

#### evaluation_json字段完整结构

```json
{
  "total_score": 6.5,
  "task_achievement": 6.0,
  "coherence_cohesion": 7.0,
  "lexical_resource": 6.5,
  "grammatical_range": 6.0,
  "sentences": [
    {
      "index": 0,
      "original": "The chart show the population growth in 2023.",
      "errors": [
        {
          "type": "grammar",
          "word": "show",
          "start_pos": 10,
          "end_pos": 14,
          "reason": "主谓不一致，主语'chart'为第三人称单数，动词应使用'shows'",
          "correction": "shows"
        }
      ],
      "corrected": "The chart shows the population growth in 2023."
    },
    {
      "index": 1,
      "original": "This is a well-written sentense without errors.",
      "errors": [
        {
          "type": "spelling",
          "word": "sentense",
          "start_pos": 26,
          "end_pos": 34,
          "reason": "拼写错误，正确拼写为'sentence'",
          "correction": "sentence"
        }
      ],
      "corrected": "This is a well-written sentence without errors."
    }
  ],
  "overall_feedback": "作文整体结构清晰，数据描述准确。语法方面需要注意主谓一致和时态使用。词汇选择较为恰当，但部分学术词汇使用不够精准。建议加强复杂句式的练习，提高语法准确性。"
}
```


#### 错误类型定义

| 类型 | 代码 | 颜色 | 说明 |
| :-- | :-- | :-- | :-- |
| 语法错误 | `grammar` | 红色 `#F56C6C` | 主谓不一致、时态错误、句式错误等 |
| 拼写错误 | `spelling` | 橙色 `#E6A23C` | 单词拼写错误 |
| 用词不当 | `word_choice` | 蓝色 `#409EFF` | 词汇使用不恰当、搭配错误 |
| 句式问题 | `sentence_structure` | 紫色 `#9C27B0` | 句子结构混乱、缺少成分 |
| 逻辑连贯性 | `coherence` | 绿色 `#67C23A` | 句子间逻辑关系不清晰 |


***

## 4. API接口设计

### 4.1 评分相关API

#### 4.1.1 创建评分任务

```
POST /api/evaluate
Content-Type: application/json

Request Body:
{
  "task_type": "task1",
  "topic_id": 123,
  "content": "The chart shows...",
  "word_count": 180,
  "api_config_id": 1
}

Response:
{
  "success": true,
  "session_id": "uuid-1234-5678",
  "message": "评分任务已创建"
}
```


#### 4.1.2 获取评分流式结果（SSE）

```
GET /api/evaluate/:sessionId/stream
Content-Type: text/event-stream

SSE事件流格式：
event: progress
data: {"type":"progress","step":"analyzing","progress":20,"message":"正在分析作文结构..."}

event: score
data: {"type":"score","data":{"total_score":6.5,"task_achievement":6.0,"coherence_cohesion":7.0,"lexical_resource":6.5,"grammatical_range":6.0}}

event: sentence
data: {"type":"sentence","data":{"index":0,"original":"...","errors":[...],"corrected":"..."}}

event: feedback
data: {"type":"feedback","data":"整体写作建议..."}

event: complete
data: {"type":"complete"}

event: error
data: {"type":"error","code":"invalid_api_key","message":"API密钥无效，请检查配置"}
```


#### 4.1.3 取消评分任务

```
DELETE /api/evaluate/:sessionId

Response:
{
  "success": true,
  "message": "评分任务已取消"
}
```


#### 4.1.4 保存评分结果

```
POST /api/essays
Content-Type: application/json

Request Body:
{
  "topic_id": 123,
  "task_type": "task1",
  "content": "...",
  "word_count": 180,
  "llm_provider": "openai",
  "model_name": "gpt-4-turbo",
  "total_score": 6.5,
  "task_achievement": 6.0,
  "coherence_cohesion": 7.0,
  "lexical_resource": 6.5,
  "grammatical_range": 6.0,
  "evaluation_json": "{...}"
}

Response:
{
  "success": true,
  "essay_id": 456,
  "message": "评分记录已保存"
}
```


### 4.2 题目管理API

#### 4.2.1 获取题目列表

```
GET /api/topics?type=task1&category=bar_chart&difficulty=3&page=1&limit=20

Response:
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "task1",
      "category": "bar_chart",
      "difficulty": 3,
      "title_json": "{...}",
      "image_path": "abc123.png",
      "is_official": 1,
      "usage_count": 15
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 20
}
```


#### 4.2.2 创建题目

```
POST /api/topics
Content-Type: application/json

Request Body:
{
  "type": "task1",
  "category": "pie_chart",
  "difficulty": 4,
  "title_json": "{\"type\":\"doc\",\"content\":[...]}",
  "image_path": "uploaded123.png"
}

Response:
{
  "success": true,
  "topic_id": 51,
  "message": "题目创建成功"
}
```


#### 4.2.3 更新题目

```
PUT /api/topics/:id
Content-Type: application/json

Request Body:
{
  "difficulty": 5,
  "title_json": "{...}"
}

Response:
{
  "success": true,
  "message": "题目更新成功"
}
```


#### 4.2.4 删除题目

```
DELETE /api/topics/:id

Response:
{
  "success": true,
  "message": "题目已删除"
}
```


### 4.3 历史记录API

#### 4.3.1 获取历史记录列表

```
GET /api/essays?task_type=task1&start_date=2025-01-01&end_date=2025-10-04&min_score=5&max_score=7&page=1&limit=20

Response:
{
  "success": true,
  "data": [
    {
      "id": 100,
      "topic_id": 10,
      "topic_title": "The chart shows...",
      "task_type": "task1",
      "word_count": 180,
      "total_score": 6.5,
      "submitted_at": "2025-10-04 10:30:00"
    }
  ],
  "total": 85,
  "page": 1,
  "limit": 20
}
```


#### 4.3.2 获取历史记录详情

```
GET /api/essays/:id

Response:
{
  "success": true,
  "data": {
    "id": 100,
    "topic_id": 10,
    "task_type": "task1",
    "content": "...",
    "word_count": 180,
    "llm_provider": "openai",
    "model_name": "gpt-4-turbo",
    "total_score": 6.5,
    "task_achievement": 6.0,
    "coherence_cohesion": 7.0,
    "lexical_resource": 6.5,
    "grammatical_range": 6.0,
    "evaluation_json": "{...}",
    "submitted_at": "2025-10-04 10:30:00"
  }
}
```


#### 4.3.3 删除历史记录

```
DELETE /api/essays/:id

Response:
{
  "success": true,
  "message": "记录已删除"
}
```


#### 4.3.4 批量删除历史记录

```
POST /api/essays/batch-delete
Content-Type: application/json

Request Body:
{
  "ids": [100, 101, 102]
}

Response:
{
  "success": true,
  "deleted_count": 3,
  "message": "已删除3条记录"
}
```


#### 4.3.5 清空所有历史记录

```
DELETE /api/essays/all

Response:
{
  "success": true,
  "message": "所有历史记录已清空"
}
```


#### 4.3.6 导出历史记录

```
GET /api/essays/export?format=csv&task_type=task1&start_date=2025-01-01

Response:
CSV文件下载（包含字段：提交时间、题目类型、字数、总分、四项分数）
```


#### 4.3.7 获取历史统计数据

```
GET /api/essays/statistics?range=recent10&task_type=task1

Response:
{
  "success": true,
  "data": {
    "average_total_score": 6.3,
    "average_task_achievement": 6.1,
    "average_coherence_cohesion": 6.5,
    "average_lexical_resource": 6.2,
    "average_grammatical_range": 6.4,
    "count": 10
  }
}
```


### 4.4 API配置管理API

#### 4.4.1 获取API配置列表

```
GET /api/configs

Response:
{
  "success": true,
  "data": [
    {
      "id": 1,
      "config_name": "OpenAI GPT-4",
      "provider": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-***",
      "default_model": "gpt-4-turbo",
      "is_enabled": 1,
      "is_default": 1
    }
  ]
}
```


#### 4.4.2 创建API配置

```
POST /api/configs
Content-Type: application/json

Request Body:
{
  "config_name": "DeepSeek V3",
  "provider": "deepseek",
  "base_url": "https://api.deepseek.com",
  "api_key": "sk-xxx",
  "default_model": "deepseek-chat"
}

Response:
{
  "success": true,
  "config_id": 2,
  "message": "API配置创建成功"
}
```


#### 4.4.3 测试API连接

```
POST /api/configs/:id/test

Response:
{
  "success": true,
  "message": "连接成功",
  "latency": 350
}
或
{
  "success": false,
  "error_code": "invalid_api_key",
  "message": "API密钥无效"
}
```


#### 4.4.4 更新API配置

```
PUT /api/configs/:id
Content-Type: application/json

Request Body:
{
  "api_key": "sk-new-key",
  "is_default": 1
}

Response:
{
  "success": true,
  "message": "配置更新成功"
}
```


#### 4.4.5 删除API配置

```
DELETE /api/configs/:id

Response:
{
  "success": true,
  "message": "配置已删除"
}
```


### 4.5 图片上传API

#### 4.5.1 上传图片

```
POST /api/upload/image
Content-Type: multipart/form-data

Form Data:
- file: (binary)

Response:
{
  "success": true,
  "image_path": "abc123.png",
  "thumbnail_path": "abc123_thumb.png",
  "message": "图片上传成功"
}
```


#### 4.5.2 删除图片

```
DELETE /api/upload/image/:filename

Response:
{
  "success": true,
  "message": "图片已删除"
}
```


### 4.6 提示词管理API

#### 4.6.1 获取当前激活提示词

```
GET /api/prompts/active?task_type=task1

Response:
{
  "success": true,
  "data": {
    "id": 1,
    "version": "1.0.0",
    "task_type": "task1",
    "system_prompt": "...",
    "scoring_criteria": "...",
    "output_format_example": "..."
  }
}
```


#### 4.6.2 导入提示词配置

```
POST /api/prompts/import
Content-Type: application/json

Request Body:
{
  "version": "1.1.0",
  "task1": {
    "system_prompt": "...",
    "scoring_criteria": "...",
    "output_format_example": "..."
  },
  "task2": {
    "system_prompt": "...",
    "scoring_criteria": "...",
    "output_format_example": "..."
  }
}

Response:
{
  "success": true,
  "message": "提示词配置已导入，版本：1.1.0"
}
```


#### 4.6.3 导出提示词配置

```
GET /api/prompts/export

Response:
JSON文件下载（包含当前激活的task1和task2提示词）
```


#### 4.6.4 更新提示词

```
PUT /api/prompts/:id
Content-Type: application/json

Request Body:
{
  "system_prompt": "...",
  "scoring_criteria": "..."
}

Response:
{
  "success": true,
  "message": "提示词更新成功"
}
```


### 4.7 应用设置API

#### 4.7.1 获取所有设置

```
GET /api/settings

Response:
{
  "success": true,
  "data": {
    "language": "zh-CN",
    "temperature_mode": "balanced",
    "temperature_task1": 0.3,
    "temperature_task2": 0.5,
    "max_tokens": 4096,
    "history_limit": 100
  }
}
```


#### 4.7.2 更新设置

```
PUT /api/settings
Content-Type: application/json

Request Body:
{
  "language": "en",
  "temperature_mode": "precise",
  "history_limit": 200
}

Response:
{
  "success": true,
  "message": "设置已更新"
}
```


### 4.8 错误代码映射

#### LLM供应商错误代码处理

| 错误代码 | 用户友好提示（中文） | User-friendly Message (English) |
| :-- | :-- | :-- |
| `invalid_api_key` | API密钥无效，请前往设置页面检查配置 | Invalid API key. Please check your configuration in Settings. |
| `insufficient_quota` | API余额不足，请充值后重试 | Insufficient API quota. Please recharge and try again. |
| `rate_limit_exceeded` | 请求频率超限，请稍后重试 | Rate limit exceeded. Please try again later. |
| `model_not_found` | 模型不存在，请检查模型名称配置 | Model not found. Please check the model name in configuration. |
| `timeout` | 请求超时（120秒），请检查网络连接或稍后重试 | Request timeout (120s). Please check network connection or try again later. |
| `network_error` | 网络连接失败，请检查网络设置 | Network connection failed. Please check network settings. |
| `server_error` | LLM服务商服务异常（5xx），请稍后重试 | LLM provider service error (5xx). Please try again later. |
| `invalid_response_format` | 评分数据解析失败，请点击"重试"按钮 | Failed to parse evaluation data. Please click "Retry" button. |


***

## 5. 前端组件树结构

### 5.1 完整组件层级

```
App.vue
├── Router View
    ├── Welcome.vue                          # 首次启动引导页
    │   ├── WelcomeStep1.vue                # 步骤1：欢迎介绍
    │   ├── WelcomeStep2.vue                # 步骤2：API配置
    │   │   └── ApiConfigForm.vue           # API配置表单组件
    │   └── WelcomeStep3.vue                # 步骤3：提示词导入
    │       └── PromptImporter.vue          # 提示词导入组件
    │
    ├── WritingModule/                       # 写作模块（主功能区）
    │   ├── WritingLayout.vue               # 写作模块布局容器
    │   │   ├── TopBar.vue                  # 顶部工具栏
    │   │   │   ├── TaskTypeTabs.vue        # Task 1/Task 2切换标签
    │   │   │   ├── ModelSelector.vue       # 模型选择下拉框
    │   │   │   └── SettingsButton.vue      # 设置按钮（齿轮图标）
    │   │   │
    │   │   ├── ComposePage.vue             # 作文输入页面
    │   │   │   ├── LeftPanel.vue           # 左侧面板
    │   │   │   │   ├── TopicSelector.vue   # 题目选择器
    │   │   │   │   │   ├── TopicFilter.vue # 题目筛选器（类型/话题/难度）
    │   │   │   │   │   └── TopicItem.vue   # 题目列表项（含缩略图）
    │   │   │   │   └── EssayEditor.vue     # 作文编辑器
    │   │   │   │       ├── EditorToolbar.vue # 编辑器工具栏（字体大小、撤销等）
    │   │   │   │       ├── EditorTextarea.vue # 文本输入区域
    │   │   │   │       ├── WordCounter.vue  # 字数统计组件
    │   │   │   │       └── SubmitButton.vue # 提交评分按钮
    │   │   │   │
    │   │   │   └── RightPanel.vue          # 右侧面板
    │   │   │       └── TopicDisplay.vue    # 题目展示区
    │   │   │           ├── TopicTitle.vue  # 题目标题（富文本渲染）
    │   │   │           └── TopicImage.vue  # 题目图片（Task 1）
    │   │   │
    │   │   ├── EvaluatingPage.vue          # 评分进度页面
    │   │   │   ├── ProgressIndicator.vue   # 进度指示器
    │   │   │   │   ├── ProgressBar.vue     # 进度条
    │   │   │   │   └── ProgressMessage.vue # 进度消息
    │   │   │   ├── StreamingPreview.vue    # 流式结果预览
    │   │   │   │   ├── ScorePreview.vue    # 分数预览（逐步显示）
    │   │   │   │   └── SentencePreview.vue # 句子错误预览（逐步显示）
    │   │   │   └── CancelButton.vue        # 取消按钮
    │   │   │
    │   │   └── ResultPage.vue              # 评分结果页面
    │   │       ├── LeftPanel.vue           # 左侧面板（作文展示）
    │   │       │   ├── ViewSwitcher.vue    # 视图切换器（原文/标注）
    │   │       │   ├── OriginalView.vue    # 原文视图
    │   │       │   └── AnnotatedView.vue   # 标注视图
    │   │       │       ├── SentenceBlock.vue # 句子块组件
    │   │       │       │   ├── SentenceText.vue # 句子文本（含高亮）
    │   │       │       │   │   └── ErrorHighlight.vue # 错误高亮组件（hover提示）
    │   │       │       │   └── ErrorDetails.vue # 错误详情（可折叠）
    │   │       │       │       ├── ErrorItem.vue # 单个错误项
    │   │       │       │       │   ├── ErrorType.vue # 错误类型图标
    │   │       │       │       │   ├── ErrorReason.vue # 错误原因
    │   │       │       │       │   └── ErrorCorrection.vue # 修正建议
    │   │       │       │       └── ExpandCollapseButton.vue # 展开/折叠按钮
    │   │       │       └── BulkControlBar.vue # 批量控制栏（全部展开/折叠）
    │   │       │
    │   │       └── RightPanel.vue          # 右侧面板（评分详情）
    │   │           ├── TotalScore.vue      # 总分显示
    │   │           ├── RadarChart.vue      # 雷达图（四项评分+历史对比）
    │   │           │   └── EchartWrapper.vue # ECharts封装组件
    │   │           ├── ScoreBreakdown.vue  # 分项评分详细说明
    │   │           │   └── ScoreItem.vue   # 单项评分组件
    │   │           │       ├── ScoreName.vue # 评分项名称
    │   │           │       ├── ScoreValue.vue # 分数值
    │   │           │       └── ScoreDescription.vue # 评分标准描述
    │   │           ├── OverallFeedback.vue # 整体改进建议
    │   │           ├── HistoryComparison.vue # 历史平均对比
    │   │           │   ├── ComparisonRangeSelector.vue # 对比范围选择器
    │   │           │   └── ComparisonChart.vue # 对比图表
    │   │           └── ActionButtons.vue   # 操作按钮组
    │   │               ├── RetryButton.vue # 重新评分按钮
    │   │               └── NewEssayButton.vue # 写新作文按钮
    │   │
    │   ├── HistoryPage.vue                 # 历史记录页面
    │   │   ├── HistoryToolbar.vue          # 工具栏
    │   │   │   ├── SearchBox.vue           # 搜索框
    │   │   │   ├── FilterPanel.vue         # 筛选面板
    │   │   │   │   ├── TaskTypeFilter.vue  # 任务类型筛选
    │   │   │   │   ├── DateRangeFilter.vue # 日期范围筛选
    │   │   │   │   └── ScoreRangeFilter.vue # 分数范围筛选
    │   │   │   ├── ExportButton.vue        # 导出CSV按钮
    │   │   │   └── BulkDeleteButton.vue    # 批量删除按钮
    │   │   │
    │   │   ├── HistoryList.vue             # 历史记录列表（虚拟滚动）
    │   │   │   ├── HistoryItem.vue         # 历史记录项
    │   │   │   │   ├── ItemCheckbox.vue    # 选择框
    │   │   │   │   ├── ItemPreview.vue     # 预览信息
    │   │   │   │   │   ├── TopicTitle.vue  # 题目标题
    │   │   │   │   │   ├── SubmitTime.vue  # 提交时间
    │   │   │   │   │   ├── WordCount.vue   # 字数
    │   │   │   │   │   └── TotalScore.vue  # 总分
    │   │   │   │   └── ItemActions.vue     # 操作按钮
    │   │   │   │       ├── ViewButton.vue  # 查看详情按钮
    │   │   │   │       └── DeleteButton.vue # 删除按钮
    │   │   │   └── VirtualScrollWrapper.vue # 虚拟滚动包装器
    │   │   │
    │   │   └── HistoryDetailModal.vue      # 历史记录详情弹窗
    │   │       ├── DetailHeader.vue        # 详情头部
    │   │       ├── DetailContent.vue       # 详情内容（复用ResultPage组件）
    │   │       └── DetailFooter.vue        # 详情底部
    │   │
    │   └── TopicManagePage.vue             # 题目管理页面
    │       ├── TopicToolbar.vue            # 工具栏
    │       │   ├── AddTopicButton.vue      # 添加题目按钮
    │       │   ├── ImportTopicsButton.vue  # 批量导入按钮
    │       │   └── FilterPanel.vue         # 筛选面板（复用）
    │       │
    │       ├── TopicList.vue               # 题目列表
    │       │   └── TopicCard.vue           # 题目卡片
    │       │       ├── TopicThumbnail.vue  # 缩略图
    │       │       ├── TopicInfo.vue       # 题目信息
    │       │       │   ├── TopicType.vue   # 题目类型标签
    │       │       │   ├── TopicCategory.vue # 题目分类标签
    │       │       │   ├── TopicDifficulty.vue # 难度星级
    │       │       │   └── UsageCount.vue  # 使用次数
    │       │       └── TopicActions.vue    # 操作按钮
    │       │           ├── EditButton.vue  # 编辑按钮
    │       │           └── DeleteButton.vue # 删除按钮
    │       │
    │       └── TopicEditorModal.vue        # 题目编辑器弹窗
    │           ├── EditorForm.vue          # 编辑表单
    │           │   ├── TypeSelector.vue    # 类型选择器
    │           │   ├── CategorySelector.vue # 分类选择器
    │           │   ├── DifficultySelector.vue # 难度选择器
    │           │   ├── TitleEditor.vue     # 标题编辑器
    │           │   │   └── TiptapEditor.vue # Tiptap富文本编辑器
    │           │   └── ImageUploader.vue   # 图片上传器
    │           │       ├── DropZone.vue    # 拖拽上传区域
    │           │       ├── FileSelector.vue # 文件选择器
    │           │       └── ImagePreview.vue # 图片预览
    │           └── EditorActions.vue       # 操作按钮
    │               ├── SaveButton.vue      # 保存按钮
    │               └── CancelButton.vue    # 取消按钮
    │
    ├── Settings.vue                         # 设置页面
    │   ├── SettingsTabs.vue                # 设置标签页
    │   │   ├── ApiConfigTab.vue            # API配置标签
    │   │   │   ├── ApiConfigList.vue       # API配置列表（表格）
    │   │   │   │   ├── ConfigRow.vue       # 配置行
    │   │   │   │   │   ├── ConfigInfo.vue  # 配置信息
    │   │   │   │   │   └── ConfigActions.vue # 操作按钮
    │   │   │   │   │       ├── TestButton.vue # 测试连接按钮
    │   │   │   │   │       ├── EditButton.vue # 编辑按钮
    │   │   │   │   │       ├── DeleteButton.vue # 删除按钮
    │   │   │   │   │       └── SetDefaultButton.vue # 设为默认按钮
    │   │   │   │   └── AddConfigButton.vue # 添加配置按钮
    │   │   │   └── ApiConfigDrawer.vue     # API配置抽屉
    │   │   │       ├── DrawerForm.vue      # 表单
    │   │   │       │   ├── NameInput.vue   # 配置名称输入
    │   │   │       │   ├── ProviderSelector.vue # 供应商选择器
    │   │   │       │   ├── BaseUrlInput.vue # Base URL输入（预设）
    │   │   │       │   ├── ApiKeyInput.vue # API密钥输入
    │   │   │       │   └── ModelInput.vue  # 模型名称输入
    │   │   │       └── DrawerActions.vue   # 操作按钮
    │   │   │
    │   │   ├── ModelParamsTab.vue          # 模型参数标签
    │   │   │   ├── TemperatureModeSelector.vue # 温度模式选择器
    │   │   │   │   ├── PreciseMode.vue     # 精确模式（0.3）
    │   │   │   │   ├── BalancedMode.vue    # 平衡模式（0.5）
    │   │   │   │   └── CreativeMode.vue    # 创意模式（0.8）
    │   │   │   ├── Task1ParamsPanel.vue    # Task 1参数面板
    │   │   │   ├── Task2ParamsPanel.vue    # Task 2参数面板
    │   │   │   └── MaxTokensInput.vue      # Max Tokens输入（固定4096）
    │   │   │
    │   │   ├── PromptsTab.vue              # 提示词管理标签
    │   │   │   ├── PromptVersionInfo.vue   # 当前版本信息
    │   │   │   │   ├── Task1Version.vue    # Task 1版本
    │   │   │   │   └── Task2Version.vue    # Task 2版本
    │   │   │   ├── PromptActions.vue       # 操作按钮组
    │   │   │   │   ├── ImportButton.vue    # 导入按钮（拖拽+选择）
    │   │   │   │   │   └── DropZone.vue    # 拖拽区域
    │   │   │   │   └── ExportButton.vue    # 导出按钮
    │   │   │   └── AdvancedPanel.vue       # 高级选项（折叠面板）
    │   │   │       ├── WarningMessage.vue  # 警告提示
    │   │   │       ├── EditPromptButton.vue # 编辑提示词按钮
    │   │   │       └── PromptEditorModal.vue # 提示词编辑器弹窗
    │   │   │           ├── EditorTabs.vue  # Task 1/Task 2标签
    │   │   │           ├── PromptTextarea.vue # 提示词文本域
    │   │   │           └── SaveButton.vue  # 保存按钮
    │   │   │
    │   │   ├── DataManageTab.vue           # 数据管理标签
    │   │   │   ├── HistoryManagePanel.vue  # 历史记录管理面板
    │   │   │   │   ├── HistoryLimitInput.vue # 记录保留数量输入
    │   │   │   │   └── ClearHistoryButton.vue # 清空历史按钮
    │   │   │   └── BackupPanel.vue         # 备份面板
    │   │   │       ├── RestoreButton.vue   # 恢复数据按钮
    │   │   │       └── RestoreOptions.vue  # 恢复选项（覆盖/合并）
    │   │   │
    │   │   └── AboutTab.vue                # 关于标签
    │   │       ├── AppInfo.vue             # 应用信息
    │   │       │   ├── AppLogo.vue         # 应用Logo
    │   │       │   ├── AppName.vue         # 应用名称
    │   │       │   ├── AppVersion.vue      # 当前版本
    │   │       │   └── Copyright.vue       # 版权信息
    │   │       ├── UpdateChecker.vue       # 更新检查器
    │   │       │   ├── CheckUpdateButton.vue # 检查更新按钮
    │   │       │   └── UpdateNotice.vue    # 更新提示
    │   │       ├── LogsPanel.vue           # 日志面板
    │   │       │   ├── ViewLogsButton.vue  # 查看日志按钮
    │   │       │   └── ClearLogsButton.vue # 清空日志按钮
    │   │       └── DevModeSwitch.vue       # 开发者模式开关（F12）
    │   │
    │   └── LanguageSelector.vue            # 语言选择器（顶部）
    │
    └── LegacyWrapper.vue                    # 原生JS页面包装器
        ├── IframeContainer.vue             # Iframe容器（隔离环境）
        └── ScriptLoader.vue                # 动态脚本加载器
```


### 5.2 核心Composables（组合式函数）

#### useSSE.js - SSE流式连接管理

```javascript
// 功能：
// - 创建SSE连接
// - 监听不同类型事件（progress/score/sentence/feedback/complete/error）
// - 自动重连机制（网络中断）
// - 连接关闭清理
// - 超时处理（120秒）

export function useSSE(sessionId) {
  const eventSource = ref(null)
  const isConnected = ref(false)
  const events = reactive({
    progress: [],
    score: null,
    sentences: [],
    feedback: null,
    error: null
  })
  
  // connect(), disconnect(), retry() 方法
  return { eventSource, isConnected, events, connect, disconnect, retry }
}
```


#### useDraft.js - 草稿自动保存管理

```javascript
// 功能：
// - 监听作文内容变化
// - 10秒自动保存到localStorage
// - Debounce防止输入卡顿
// - 草稿恢复提示
// - 多草稿管理（task1/task2分离）
// - 页面卸载前保存

export function useDraft(taskType) {
  const draftKey = computed(() => `ielts_writing_draft_${taskType}`)
  const content = ref('')
  const lastSaved = ref(null)
  
  // saveDraft(), loadDraft(), clearDraft(), hasDraft() 方法
  return { content, lastSaved, saveDraft, loadDraft, clearDraft, hasDraft }
}
```


#### useHistory.js - 历史记录管理

```javascript
// 功能：
// - 获取历史记录列表（分页+筛选）
// - SQL查询构造
// - 历史统计数据获取
// - 批量删除
// - 导出CSV

export function useHistory() {
  const historyList = ref([])
  const statistics = ref(null)
  const filters = reactive({
    taskType: null,
    startDate: null,
    endDate: null,
    minScore: null,
    maxScore: null
  })
  
  // fetchHistory(), deleteHistory(), exportHistory(), getStatistics() 方法
  return { historyList, statistics, filters, fetchHistory, deleteHistory, exportHistory, getStatistics }
}
```


#### useApiConfig.js - API配置管理

```javascript
// 功能：
// - 获取API配置列表
// - 测试API连接
// - 切换默认配置
// - 创建/更新/删除配置

export function useApiConfig() {
  const configs = ref([])
  const defaultConfig = computed(() => configs.value.find(c => c.is_default))
  
  // fetchConfigs(), testConfig(), setDefault(), createConfig(), updateConfig(), deleteConfig() 方法
  return { configs, defaultConfig, fetchConfigs, testConfig, setDefault, createConfig, updateConfig, deleteConfig }
}
```


#### useErrorHandler.js - 错误处理管理

```javascript
// 功能：
// - LLM错误代码映射
// - 用户友好提示生成
// - 错误日志记录
// - Toast/Message提示

export function useErrorHandler() {
  const errorMessages = {
    'invalid_api_key': { zh: 'API密钥无效...', en: 'Invalid API key...' },
    'insufficient_quota': { zh: 'API余额不足...', en: 'Insufficient quota...' },
    // ...更多错误码
  }
  
  // handleError(errorCode, lang), showErrorMessage(), logError() 方法
  return { handleError, showErrorMessage, logError }
}
```


***

## 6. 功能需求详细说明

### 6.1 首次启动引导

#### 6.1.1 欢迎页面

- 显示应用Logo、名称、简介
- 3步引导流程：欢迎→API配置→提示词导入
- 支持"跳过引导"按钮（直接进入主界面，但API未配置时限制功能）


#### 6.1.2 API配置引导

- 表单字段：配置名称、供应商类型（下拉选择）、Base URL（根据供应商自动填充预设值）、API密钥、默认模型名称
- "测试连接"按钮：验证API密钥有效性，显示连接状态和延迟
- 支持跳过（稍后在设置页面配置）


#### 6.1.3 提示词导入引导

- 说明提示词的作用
- 提供"导入配置文件"按钮（文件选择器）
- 显示内置默认提示词版本（v1.0.0）
- 支持跳过（使用默认提示词）


### 6.2 作文输入与评分

#### 6.2.1 题目选择

- **题目筛选**：
    - Task 1：按图表类型筛选（柱状图/饼图/折线图/流程图/地图/表格/混合图）
    - Task 2：按话题分类筛选（教育/科技/社会/环境/健康/文化/政府/经济）
    - 难度筛选：1-5星级
- **题目列表**：
    - 每项显示：缩略图（Task 1）、题目预览（富文本渲染前50字符）、类型标签、难度星级、使用次数
    - 支持滚动加载（虚拟滚动）
- **题目预览**：
    - 点击题目后，右侧面板显示完整题目内容（富文本渲染）
    - Task 1显示大图（点击放大）


#### 6.2.2 作文编辑器

- **文本输入**：
    - 大型多行文本框（最小高度400px）
    - 支持基础文本编辑快捷键：
        - Ctrl+Z：撤销
        - Ctrl+Y：重做
        - Ctrl+S：手动保存草稿
        - Ctrl+A：全选
- **字体大小调整**：
    - 工具栏提供字体大小下拉选择器（12px-20px）
    - 设置保存到用户偏好
- **字数统计**：
    - 实时显示当前字数
    - 显示位置：输入框底部右侧
    - 格式：`当前字数：180`
    - 超过字数限制（Task 1: 280词，Task 2: 390词）时字数变红色警告


#### 6.2.3 草稿自动保存

- 每10秒自动保存到localStorage
- 使用debounce延迟500ms，避免输入时卡顿
- 保存时显示Toast提示："草稿已自动保存"（2秒后消失）
- 草稿数据结构：

```json
{
  "task_type": "task1",
  "topic_id": 123,
  "content": "...",
  "word_count": 180,
  "last_saved": "2025-10-04T12:54:00Z"
}
```

- 页面加载时检测草稿：
    - 如有草稿，弹窗询问："检测到未完成的草稿（保存于{时间}），是否恢复？"
    - 提供"恢复"和"放弃"按钮
    - 恢复后自动填充题目和内容


#### 6.2.4 基础校验

- **字数不足提示**：
    - Task 1少于150词、Task 2少于250词时，弹窗确认："作文字数不足，建议至少达到{目标字数}词后再提交评分，当前{当前字数}词。是否仍要继续？"
    - 提供"继续提交"和"取消"按钮
- **空内容拦截**：
    - 作文内容为空或仅包含空格/换行时，提交按钮置灰
    - Hover显示Tooltip："请输入作文内容"
- **未选择题目处理**：
    - 允许不选择题目直接写作（自由写作模式）
    - 提交时topic_id为null


#### 6.2.5 提交评分

- 点击"提交评分"按钮后：

1. 创建评分任务（POST /api/evaluate）
2. 获取sessionId
3. 页面切换到"评分进度页面"
4. 建立SSE连接（GET /api/evaluate/:sessionId/stream）
5. 实时监听评分进度事件


#### 6.2.6 评分进度展示

- **进度指示器**：
    - 显示当前步骤：
        - "正在分析作文结构..."（progress: 0-30%）
        - "正在评估四项指标..."（progress: 30-70%）
        - "正在生成详细反馈..."（progress: 70-100%）
    - 进度条动画效果
- **流式结果预览**：
    - 收到`score`事件：显示总分和四项评分
    - 收到`sentence`事件：逐条显示句子错误标注（列表形式）
    - 收到`feedback`事件：显示整体改进建议
- **取消功能**：
    - 显示"取消评分"按钮
    - 点击后：

1. 关闭SSE连接
2. 发送DELETE请求取消任务
3. 返回作文输入页面
4. 恢复草稿内容


#### 6.2.7 错误处理

- **API调用错误**：
    - 收到`error`事件，根据错误代码显示用户友好提示
    - 提供"重试"按钮（重新创建任务）
    - 提供"返回编辑"按钮（返回输入页面）
- **格式错误降级**：
    - JSON解析失败时：

1. 显示错误提示："评分数据解析失败，请重试"
2. 提供"重试"按钮
3. 同时在折叠面板中显示LLM返回的原始文本（降级展示）
4. 记录错误到日志文件
- **超时处理**：
    - 120秒未收到`complete`事件，自动关闭连接
    - 显示超时提示："评分超时，请检查网络连接或稍后重试"
    - 提供"重试"按钮


### 6.3 评分结果展示

#### 6.3.1 页面布局

- 左右分栏布局，左侧占60%，右侧占40%
- 左侧：作文展示（原文/标注视图切换）
- 右侧：评分详情（从上到下：总分→雷达图→分项评分→整体建议→历史对比）


#### 6.3.2 视图切换

- **切换按钮位置**：左侧面板顶部
- **切换方式**：Radio Button，两个选项："原文视图" / "标注视图"
- **原文视图**：
    - 显示用户原始作文，无任何标注
    - 纯净阅读体验
- **标注视图**：
    - 显示句子块组件列表
    - 高亮显示错误单词
    - 折叠显示错误详情


#### 6.3.3 错误标注渲染

- **句子块组件**：
    - 每个句子独立渲染为一个块
    - 句子索引显示：`[^39] The chart shows...`
- **错误高亮**：
    - 根据错误类型使用不同颜色：
        - 语法错误：红色（\#F56C6C）
        - 拼写错误：橙色（\#E6A23C）
        - 用词不当：蓝色（\#409EFF）
        - 句式问题：紫色（\#9C27B0）
        - 逻辑连贯性：绿色（\#67C23A）
    - Hover悬浮显示Tooltip：错误原因（30字符内简短版本）
    - 点击错误单词：滚动定位到该句子位置（锚点定位）
- **错误详情折叠**：
    - 默认展开前3个句子的错误详情
    - 其余句子默认折叠
    - 每个句子块右侧显示"展开/折叠"按钮
    - 批量控制栏（顶部）：提供"全部展开"和"全部折叠"按钮
- **错误详情内容**：
    - 错误类型图标+名称
    - 错误原因（完整描述）
    - 修正建议："建议修改为：{correction}"
    - 修正后完整句子


#### 6.3.4 评分详情展示

- **总分显示**：
    - 大号字体显示总分（例如：6.5）
    - 副标题："总分 Overall Band Score"
    - 评分日期时间
- **雷达图**：
    - X轴：四项评分维度（中英文标注）
    - Y轴：0-9分刻度
    - 两条折线：
        - 当前作文分数（实线，蓝色）
        - 历史平均分（虚线，灰色）
    - 图例说明
    - Hover显示具体数值
- **分项评分详细说明**：
    - 每项显示：
        - 评分项名称（中英文）
        - 分数值（大号字体）
        - 评分标准简要描述（30-50字）
    - 四项分别展示：
        - Task Achievement/Response
        - Coherence and Cohesion
        - Lexical Resource
        - Grammatical Range and Accuracy
- **整体改进建议**：
    - 标题："整体改进建议 Overall Feedback"
    - 显示LLM生成的overall_feedback内容（支持多段落）
    - 样式：浅灰色背景卡片
- **历史平均对比**：
    - 对比范围选择器（下拉框）：
        - "全部历史"
        - "最近10次"
        - "本月"
        - "Task 1专项"
        - "Task 2专项"
    - 显示对比数据：
        - 当前作文 vs 历史平均（四项评分对比表格）
        - 差值显示（+0.5/-0.3，绿色/红色）
    - 首次评分时显示："暂无历史数据对比"


#### 6.3.5 操作按钮

- **重新评分按钮**：
    - 使用相同内容和题目，重新发起评分
    - 可能得到不同结果（LLM非确定性）
- **写新作文按钮**：
    - 返回作文输入页面
    - 清空当前内容和草稿
    - 保留题目选择


#### 6.3.6 评分保存

- 评分完成后自动保存到数据库（essays表）
- 保存内容：
    - 题目ID、作文内容、字数、模型信息
    - 总分、四项评分
    - 完整evaluation_json
    - 提交时间


### 6.4 历史记录管理

#### 6.4.1 历史记录列表

- **虚拟滚动**：
    - 使用vue-virtual-scroller
    - 每页显示20条记录
    - 滚动到底部自动加载下一页
- **记录项显示**：
    - 选择框（批量操作）
    - 题目标题（富文本渲染前30字符）
    - 提交时间（格式：2025-10-04 10:30）
    - 字数
    - 总分（大号字体）
    - 操作按钮：查看详情、删除


#### 6.4.2 筛选功能

- **筛选面板**：
    - 任务类型：全部/Task 1/Task 2（单选）
    - 日期范围：开始日期-结束日期（日期选择器）
    - 分数范围：最低分-最高分（数字输入框，0-9，步长0.5）
- **搜索框**：
    - 支持搜索题目标题或作文内容（通过SQL LIKE查询）
    - Debounce延迟300ms


#### 6.4.3 批量操作

- **批量删除**：
    - 勾选多条记录后，"批量删除"按钮激活
    - 点击后弹窗确认："确定删除选中的{数量}条记录？此操作不可恢复。"
    - 确认后发送POST /api/essays/batch-delete请求
    - 成功后Toast提示："已删除{数量}条记录"
- **一键清空**：
    - 工具栏提供"清空所有历史记录"按钮
    - 点击后弹窗二次确认："警告：此操作将删除所有历史记录，且不可恢复。请输入'确认删除'以继续。"
    - 输入匹配后才允许删除
    - 发送DELETE /api/essays/all请求


#### 6.4.4 导出功能

- **导出CSV**：
    - 工具栏提供"导出CSV"按钮
    - 导出当前筛选结果（不是全部记录）
    - CSV字段：提交时间、题目类型、题目标题、字数、总分、Task Achievement、Coherence \& Cohesion、Lexical Resource、Grammatical Range、模型名称
    - 文件名格式：`ielts-history-{日期}.csv`


#### 6.4.5 历史记录详情

- **详情弹窗**：
    - 点击"查看详情"按钮打开Modal弹窗
    - 弹窗内容复用ResultPage组件布局
    - 显示完整评分结果（左侧作文+右侧评分详情）
    - 不显示操作按钮（重新评分/写新作文）


#### 6.4.6 存储优化

- **自动清理策略**：
    - 设置页面提供"历史记录保留数量"输入框（默认100条）
    - 超过限制时，自动删除最早的记录
    - 删除时仅删除essays表记录，topics表不受影响


### 6.5 题目管理

#### 6.5.1 题目列表

- **卡片布局**：
    - 网格布局，每行3-4个卡片（响应式）
    - 卡片内容：
        - 缩略图（Task 1）或占位图标（Task 2）
        - 题目类型标签（颜色区分Task 1/Task 2）
        - 题目分类标签
        - 难度星级（1-5星）
        - 使用次数
        - 操作按钮：编辑、删除


#### 6.5.2 筛选功能

- 复用历史记录的筛选面板组件
- 筛选条件：任务类型、分类、难度
- 支持组合筛选


#### 6.5.3 添加题目

- **添加按钮**：工具栏显眼位置
- **编辑器弹窗**：
    - 表单字段：
        - 任务类型：下拉选择（Task 1/Task 2）
        - 分类：根据任务类型动态切换选项
            - Task 1：柱状图/饼图/折线图/流程图/地图/表格/过程/混合图
            - Task 2：教育/科技/社会/环境/健康/文化/政府/经济
        - 难度：星级选择器（1-5星）
        - 题目内容：Tiptap富文本编辑器
            - 支持格式：加粗、斜体、下划线、项目符号列表、有序列表
            - 工具栏简洁（仅必要功能）
        - 图片上传（仅Task 1）：
            - 拖拽上传区域
            - 文件选择器按钮
            - 支持格式：PNG/JPG
            - 文件大小限制：10MB
            - 上传后显示预览（可删除重新上传）
    - 保存按钮：验证必填字段后发送POST /api/topics请求
    - 取消按钮：关闭弹窗，放弃编辑


#### 6.5.4 编辑题目

- 点击"编辑"按钮打开编辑器弹窗
- 表单预填充现有数据
- 保存时发送PUT /api/topics/:id请求


#### 6.5.5 删除题目

- 点击"删除"按钮弹窗确认："确定删除该题目？关联的历史记录不会被删除。"
- 确认后发送DELETE /api/topics/:id请求
- 关联的图片文件同时删除（后端处理）


#### 6.5.6 批量导入

- **导入按钮**：工具栏提供"批量导入题目"按钮
- **导入格式**：JSON文件
- **JSON结构**：

```json
[
  {
    "type": "task1",
    "category": "bar_chart",
    "difficulty": 3,
    "title_json": "{...}",
    "image_path": "optional_image.png"
  }
]
```

- **导入流程**：

1. 选择JSON文件
2. 解析验证格式
3. 显示导入预览（题目数量、分类统计）
4. 确认导入
5. 后端批量插入数据库
6. 成功后Toast提示："已导入{数量}道题目"


#### 6.5.7 内置题库

- 应用首次安装时，自动导入内置题库（/public/default-topics.json）
- 内置题库包含：
    - Task 1：20道题目（各类型均衡分布）
    - Task 2：30道题目（各话题均衡分布）
- 标记为官方题目（is_official=1）
- 用户无法删除官方题目（删除按钮置灰+Tooltip提示）


### 6.6 系统设置

#### 6.6.1 设置页面布局

- **入口**：右上角齿轮图标按钮
- **布局**：全屏页面，顶部标签栏+内容区
- **标签页**：API配置、模型参数、提示词管理、数据管理、关于


#### 6.6.2 API配置

- **配置列表（表格）**：
    - 列：配置名称、供应商、模型、状态（启用/禁用开关）、默认（单选框）、操作
    - 操作按钮：测试连接、编辑、删除、设为默认
    
- **添加配置按钮**：表格上方

- **配置抽屉**：
    - 从右侧滑入的抽屉（Element Plus Drawer组件）
    - 表单字段：
        - 配置名称：文本输入
        - 供应商类型：下拉选择（OpenAI/OpenRouter/DeepSeek）
        - Base URL：文本输入，带预设值按钮
            - OpenAI：`https://api.openai.com/v1`
            - OpenRouter：`https://openrouter.ai/api/v1`
            - DeepSeek：`https://api.deepseek.com`
        - API密钥：密码输入（可显示/隐藏）
        - 默认模型名称：文本输入，提供常见模型建议列表
            - OpenAI：gpt-4-turbo, gpt-4, gpt-3.5-turbo
            - DeepSeek：deepseek-chat, deepseek-coder
    
    - 保存按钮：验证后发送POST /api/configs请求
    - 取消按钮：关闭抽屉
    
    - **测试连接功能**：
      - 点击"测试连接"按钮
      - 发送POST /api/configs/:id/test请求
      - 后端调用LLM供应商的测试端点（如/v1/models）
      - 显示结果：
        - 成功："✓ 连接成功 (延迟: 350ms)"，绿色提示
        - 失败："✗ 连接失败：{错误信息}"，红色提示
      - 测试期间按钮显示Loading状态
    - **删除配置**：
      - 点击"删除"按钮弹窗确认："确定删除该API配置？"
      - 如果是默认配置，警告："该配置为默认配置，删除后需要重新设置默认"
      - 确认后发送DELETE /api/configs/:id请求
    - **设为默认**：
      - 点击"设为默认"按钮
      - 发送PUT /api/configs/:id请求，设置is_default=1
      - 自动将其他配置的is_default设为0（后端处理）
      - Toast提示："已设置为默认配置"


    #### 6.6.3 模型参数
    
    - **温度模式选择器**：
      - 三个选项卡（Radio Group样式）：
        - 精确模式：temperature=0.3，适合客观评分
        - 平衡模式：temperature=0.5，推荐使用
        - 创意模式：temperature=0.8，适合生成详细建议
      - 选择后自动保存到app_settings表
    - **Task 1参数面板**：
      - 标题："Task 1 参数设置"
      - 显示当前温度值：0.3（只读，根据温度模式自动设置）
      - 说明文本："Task 1注重数据准确性和客观描述，建议使用较低温度"
    - **Task 2参数面板**：
      - 标题："Task 2 参数设置"
      - 显示当前温度值：0.5（只读，根据温度模式自动设置）
      - 说明文本："Task 2需要平衡客观评分和创意反馈，建议使用中等温度"
    - **Max Tokens设置**：
      - 显示固定值：4096
      - 灰色文本说明："Max Tokens已固定为4096，确保完整返回评分结果"
      - 不可编辑


    #### 6.6.4 提示词管理
    
    - **当前版本信息**：
      - 显示Task 1和Task 2各自的激活提示词版本
      - 卡片布局：
        - Task 1提示词：版本1.0.0，更新时间：2025-10-01
        - Task 2提示词：版本1.0.0，更新时间：2025-10-01
    - **导入提示词**：
      - 导入按钮："导入新版本提示词配置"
      - 支持两种方式：
        - **文件选择器**：点击按钮选择JSON文件
        - **拖拽上传**：拖拽区域显示虚线边框，提示"拖拽JSON文件到此处"
      - 上传后验证JSON格式：
        - 必需字段：version、task1、task2
        - task1/task2必需字段：system_prompt、scoring_criteria、output_format_example
      - 验证通过后弹窗预览：
        - 显示新版本号
        - 显示字符数统计
        - 提供"确认导入"和"取消"按钮
      - 确认后发送POST /api/prompts/import请求
      - 成功后Toast提示："提示词配置已更新至版本{version}"
      - 自动将旧版本设为非激活状态
    - **导出提示词**：
      - 导出按钮："导出当前配置"
      - 点击后下载JSON文件，文件名：`ielts-prompts-v{version}.json`
      - 文件内容包含当前激活的Task 1和Task 2提示词完整配置
    - **高级选项（折叠面板）**：
      - 位置：页面底部
      - 默认折叠状态
      - 标题："高级选项（仅供专业用户使用）"，灰色文本
      - 展开后显示：
        - 警告图标+警告文本："修改提示词可能影响评分准确性，建议仅在了解AI Prompt原理后操作"
        - "编辑提示词"按钮（危险样式，红色边框）
    - **提示词编辑器弹窗**：
      - 点击"编辑提示词"按钮，先弹窗二次确认：
        - 标题："⚠️ 警告"
        - 内容："修改提示词可能影响评分准确性，建议仅在了解原理后操作。错误的提示词可能导致评分失败。是否继续？"
        - 按钮："取消" / "我了解风险，继续编辑"
      - 确认后打开全屏Modal：
        - 顶部Tab切换：Task 1 / Task 2
        - 编辑器区域：
          - 三个文本域（Textarea）：
            - 系统提示词：高度300px，等宽字体
            - 评分标准：高度200px
            - 输出格式示例：高度200px
          - 每个文本域显示字符数统计
        - 底部操作按钮：
          - "验证格式"按钮：验证JSON格式是否正确
          - "保存"按钮：发送PUT /api/prompts/:id请求
          - "取消"按钮：关闭弹窗，不保存


    #### 6.6.5 数据管理
    
    - **历史记录管理面板**：
      - 标题："历史记录管理"
      - 设置项：
        - **记录保留数量**：
          - 标签："自动保留最近 N 条记录"
          - 数字输入框，默认值100，范围50-500
          - 说明："超过此数量时，将自动删除最早的记录"
          - 保存按钮：更新app_settings表
        - **清空历史记录**：
          - 危险按钮："清空所有历史记录"
          - 点击后弹窗二次确认：
            - 标题："⚠️ 警告"
            - 内容："此操作将删除所有历史记录，且不可恢复。请输入'确认删除'以继续。"
            - 文本输入框：用户需输入"确认删除"
            - 按钮："取消" / "确认清空"
          - 确认后发送DELETE /api/essays/all请求
          - 成功后Toast提示："已清空所有历史记录"
    - **备份恢复面板**：
      - 标题："数据备份与恢复"
      - **恢复数据**：
        - 说明："从备份文件恢复数据库和配置"
        - "选择备份文件"按钮：打开文件选择器，筛选.zip文件
        - 选择后显示文件名和大小
        - **恢复选项（Radio Group）**：
          - 覆盖模式：删除现有数据，完全使用备份数据
          - 合并模式：保留现有数据，仅导入备份中不存在的记录（基于ID）
        - "开始恢复"按钮：
          - 弹窗确认："确定{覆盖/合并}当前数据？"
          - 确认后发送POST /api/restore请求，上传.zip文件
          - 后端解压并恢复数据库
          - 显示进度条
          - 成功后Toast提示："数据恢复成功"
          - 自动刷新应用状态


    #### 6.6.6 关于页面
    
    - **应用信息区域**：
      - 应用Logo：居中显示，尺寸128x128px
      - 应用名称：
        - 英文："IELTS Writing AI Evaluator"
        - 中文："雅思AI作文评判助手"
      - 当前版本：v1.0.0
      - 版权信息："© 2025 [开发者名称]. All rights reserved."
      - 开源协议：MIT License（如适用）
    - **更新检查器**：
      - "检查更新"按钮
      - 点击后：
        - 显示Loading状态
        - 打开系统默认浏览器，访问GitHub Release页面或官网更新页面
        - 由于应用离线运行，无法自动检测，需用户手动查看
      - 更新说明文本："当前为离线应用，请手动访问官网查看最新版本"
    - **日志管理面板**：
      - **查看日志**：
        - "打开日志文件"按钮
        - 点击后调用Electron IPC，打开系统默认文本编辑器查看logs/app.log
      - **清空日志**：
        - "清空日志"按钮
        - 点击后弹窗确认："确定清空所有错误日志？"
        - 确认后发送DELETE /api/logs请求
        - 成功后Toast提示："日志已清空"
    - **开发者模式开关**：
      - Toggle Switch："开发者模式"
      - 开启后：
        - 显示提示："已开启开发者模式，按F12打开DevTools"
        - 允许按F12快捷键打开Electron DevTools
        - 显示更多调试信息（如API请求详情）
      - 关闭后：
        - F12快捷键失效
        - 隐藏调试信息


    ### 6.7 听力阅读系统整合
    
    #### 6.7.1 路由架构设计
    
    - **Vue Router配置**：
    
    ```javascript
    const routes = [
      {
        path: '/',
        redirect: '/writing' // 默认进入写作模块
      },
      {
        path: '/writing',
        component: WritingLayout, // Vue组件
        children: [
          { path: '', redirect: 'compose' },
          { path: 'compose', component: ComposePage },
          { path: 'result/:id', component: ResultPage },
          { path: 'history', component: HistoryPage },
          { path: 'topics', component: TopicManagePage }
        ]
      },
      {
        path: '/listening',
        component: LegacyWrapper, // 包装器组件
        meta: { legacyScript: '/legacy/listening/listening.js' }
      },
      {
        path: '/reading',
        component: LegacyWrapper,
        meta: { legacyScript: '/legacy/reading/reading.js' }
      },
      {
        path: '/settings',
        component: Settings
      },
      {
        path: '/welcome',
        component: Welcome
      }
    ]
    ```


    #### 6.7.2 LegacyWrapper组件实现
    
    - **功能**：
      - 提供容器div用于挂载原生JS页面
      - 动态加载对应的JavaScript文件
      - 监听路由变化，清理上一个页面的脚本和DOM
      - 隔离原生JS的全局变量，避免污染Vue应用
    - **实现细节**：
    
    ```javascript
    // LegacyWrapper.vue 伪代码
    <template>
      <div id="legacy-container" ref="container"></div>
    </template>
    
    <script setup>
    import { onMounted, onBeforeUnmount, ref } from 'vue'
    import { useRoute } from 'vue-router'
    
    const route = useRoute()
    const container = ref(null)
    let scriptElement = null
    
    onMounted(() => {
      const scriptPath = route.meta.legacyScript
      // 动态创建script标签
      scriptElement = document.createElement('script')
      scriptElement.src = scriptPath
      scriptElement.type = 'module' // 使用ES模块避免全局污染
      document.body.appendChild(scriptElement)
      
      // 加载对应的HTML内容
      fetch(scriptPath.replace('.js', '.html'))
        .then(res => res.text())
        .then(html => {
          container.value.innerHTML = html
        })
    })
    
    onBeforeUnmount(() => {
      // 清理脚本和DOM
      if (scriptElement) {
        document.body.removeChild(scriptElement)
      }
      container.value.innerHTML = ''
    })
    </script>
    ```


    #### 6.7.3 状态持久化
    
    - **草稿保存**：
      - 写作模块的草稿使用localStorage键名：
        - `ielts_writing_draft_task1`
        - `ielts_writing_draft_task2`
      - 听力/阅读系统如有需要，使用不同前缀：
        - `ielts_listening_progress`
        - `ielts_reading_progress`
    - **跨页面跳转**：
      - 用户从写作页跳转到听力页：
        - 离开写作页前，触发草稿自动保存（onBeforeUnmount钩子）
        - 返回写作页时，自动检测并恢复草稿
      - Electron窗口关闭前：
        - 监听`window.onbeforeunload`事件
        - 确保草稿已保存到localStorage


    #### 6.7.4 数据隔离
    
    - **API配置**：
      - 写作模块的API配置存储在SQLite数据库
      - 听力/阅读系统不访问API配置（业务逻辑分离）
    - **IPC通信**：
      - 如果听力/阅读系统需要文件操作（如音频播放、PDF加载），通过Electron IPC暴露接口
      - 在preload.js中统一定义：
    
    ```javascript
    contextBridge.exposeInMainWorld('electronAPI', {
      // 写作模块专用
      openFile: () => ipcRenderer.invoke('open-file'),
      saveFile: (data) => ipcRenderer.invoke('save-file', data),
      
      // 听力模块专用
      playAudio: (path) => ipcRenderer.invoke('play-audio', path),
      
      // 阅读模块专用
      loadPDF: (path) => ipcRenderer.invoke('load-pdf', path)
    })
    ```


    ### 6.8 多语言支持
    
    #### 6.8.1 i18n配置
    
    - **语言包文件结构**：
    
    ```
    src/locales/
    ├── en.json       # 英文语言包
    └── zh-CN.json    # 简体中文语言包
    ```
    
    - **语言包内容示例**：
    
    ```json
    // zh-CN.json
    {
      "common": {
        "save": "保存",
        "cancel": "取消",
        "delete": "删除",
        "confirm": "确认",
        "loading": "加载中..."
      },
      "writing": {
        "task1": "Task 1 - 图表描述",
        "task2": "Task 2 - 议论文",
        "wordCount": "字数：{count}",
        "submit": "提交评分",
        "evaluating": "正在评分..."
      },
      "scores": {
        "totalScore": "总分",
        "taskAchievement": "任务完成度",
        "coherenceCohesion": "连贯与衔接",
        "lexicalResource": "词汇资源",
        "grammaticalRange": "语法范围与准确性"
      },
      "errors": {
        "invalidApiKey": "API密钥无效，请前往设置页面检查配置",
        "insufficientQuota": "API余额不足，请充值后重试",
        "networkError": "网络连接失败，请检查网络设置"
      }
    }
    
    // en.json
    {
      "common": {
        "save": "Save",
        "cancel": "Cancel",
        "delete": "Delete",
        "confirm": "Confirm",
        "loading": "Loading..."
      },
      "writing": {
        "task1": "Task 1 - Academic Writing",
        "task2": "Task 2 - Essay Writing",
        "wordCount": "Word Count: {count}",
        "submit": "Submit for Evaluation",
        "evaluating": "Evaluating..."
      }
      // ...更多翻译
    }
    ```


    #### 6.8.2 语言检测与切换
    
    - **首次启动语言检测**：
      - 调用`navigator.language`获取系统语言
      - 如果是`zh`、`zh-CN`、`zh-TW`等，默认使用中文
      - 否则使用英文
      - 保存到app_settings表：`language: "zh-CN"` 或 `"en"`
    - **语言切换器**：
      - 位置：设置页面顶部显眼位置
      - 下拉选择器（Select组件）：
        - 中文简体（简体中文）
        - English（英语）
      - 选择后：
        - 更新app_settings表
        - 调用vue-i18n的`setLocale`方法
        - 全局UI立即切换语言
        - Toast提示："语言已切换至{语言名称}"


    #### 6.8.3 LLM评分语言
    
    - **提示词中指定输出语言**：
      - 在提示词配置的system_prompt中，根据用户选择的语言添加指令：
        - 中文："请使用简体中文输出评分结果和反馈建议"
        - 英文："Please output evaluation results and feedback in English"
      - 用户切换语言后，下次评分自动使用对应语言的提示词
    - **动态提示词调整**：
      - 不修改数据库中存储的提示词
      - 在API调用时，动态拼接语言指令到system_prompt开头


    ### 6.9 性能优化
    
    #### 6.9.1 虚拟滚动优化
    
    - **历史记录列表**：
      - 使用`vue-virtual-scroller`库
      - 配置：
        - 每项高度：80px（固定高度）
        - 缓冲区：5项（上下各预渲染5项）
        - 可见区域：根据窗口高度动态计算
      - 性能目标：支持1000+条记录流畅滚动


    #### 6.9.2 图片懒加载
    
    - **题目列表缩略图**：
      - 使用Element Plus的`el-image`组件，配置`lazy`属性
      - 占位图：灰色skeleton loading效果
      - 加载失败：显示默认占位图标
    - **缩略图生成策略**：
      - 用户上传图片时，后端自动生成150x150px缩略图
      - 使用Sharp库处理（Node.js）
      - 缩略图文件名：`{原文件名}_thumb.{扩展名}`
      - 列表显示时优先加载缩略图，点击查看详情时加载原图


    #### 6.9.3 数据库查询优化
    
    - **历史记录筛选**：
      - 前端发送筛选条件到后端
      - 后端构造SQL WHERE子句：
    
    ```sql
    SELECT * FROM essays 
    WHERE task_type = ? 
      AND submitted_at BETWEEN ? AND ? 
      AND total_score BETWEEN ? AND ?
    ORDER BY submitted_at DESC 
    LIMIT ? OFFSET ?
    ```
    
        - 使用索引提高查询速度（已在表结构中定义）
    
    - **历史统计聚合**：
      - 使用SQL聚合函数：
    
    ```sql
    SELECT 
      AVG(total_score) as avg_total,
      AVG(task_achievement) as avg_ta,
      AVG(coherence_cohesion) as avg_cc,
      AVG(lexical_resource) as avg_lr,
      AVG(grammatical_range) as avg_gr,
      COUNT(*) as count
    FROM essays
    WHERE task_type = ?
      AND submitted_at >= ?
    ```
    
        - 缓存统计结果（30秒过期），避免频繁计算


    #### 6.9.4 防抖与节流
    
    - **自动保存草稿**：
      - 使用lodash的`debounce`函数
      - 延迟500ms，避免用户输入时频繁触发
    - **搜索框输入**：
      - 使用`debounce`延迟300ms
      - 避免每次按键都触发API请求
    - **窗口大小调整**：
      - 使用`throttle`节流，每200ms最多执行一次
      - 优化响应式布局重新计算


    #### 6.9.5 代码分割与懒加载
    
    - **路由懒加载**：
      - 使用Vue Router的动态import：
    
    ```javascript
    const Settings = () => import('./views/Settings.vue')
    const HistoryPage = () => import('./views/WritingModule/HistoryPage.vue')
    ```
    
        - 减少首次加载体积
    
    - **组件懒加载**：
      - 非关键组件使用`defineAsyncComponent`：
    
    ```javascript
    const RadarChart = defineAsyncComponent(() => 
      import('./components/RadarChart.vue')
    )
    ```


    ### 6.10 错误处理与日志
    
    #### 6.10.1 错误日志记录
    
    - **日志文件位置**：`{userData}/logs/app.log`
    - **日志格式**：
    
    ```
    [2025-10-04 13:00:00] [ERROR] API调用失败
    Provider: openai
    Model: gpt-4-turbo
    Error Code: invalid_api_key
    Message: Incorrect API key provided
    Stack: ...
    ---
    ```
    
    - **记录内容**：
      - API调用失败
      - 数据库操作错误
      - 应用崩溃异常
      - SSE连接异常
      - 文件操作失败
    - **日志轮转**：
      - 单个日志文件最大10MB
      - 达到上限后自动创建新文件：`app.log.1`、`app.log.2`
      - 最多保留5个历史文件


    #### 6.10.2 全局错误处理
    
    - **Vue全局错误处理器**：
    
    ```javascript
    app.config.errorHandler = (err, instance, info) => {
      console.error('Vue Error:', err)
      // 记录到日志文件
      logError({
        type: 'Vue Error',
        message: err.message,
        stack: err.stack,
        component: instance?.$options.name,
        info
      })
      // 显示用户友好提示
      ElMessage.error('发生未知错误，请查看日志或联系支持')
    }
    ```
    
    - **Window全局错误捕获**：
    
    ```javascript
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled Promise Rejection:', event.reason)
      logError({
        type: 'Unhandled Promise',
        message: event.reason.message || event.reason,
        stack: event.reason.stack
      })
    })
    ```


    #### 6.10.3 用户友好错误提示
    
    - **Toast通知**：
      - 使用Element Plus的`ElMessage`组件
      - 错误类型：`error`（红色）
      - 显示时长：5秒（可手动关闭）
      - 提示文案使用i18n翻译
    - **错误页面**：
      - API密钥未配置：显示空状态页面，引导用户前往设置
      - 网络断开：显示网络错误提示，提供"重试"按钮
      - 严重错误：显示错误边界组件，提供"重新加载应用"按钮
    
    ***
    
    ## 7. 文件存储结构
    
    ### 7.1 userData目录完整结构
    
    ```
    {app.getPath('userData')}/
    ├── config.json                        # API配置文件（废弃，改用数据库）
    ├── database.db                        # SQLite数据库主文件
    ├── database.db-shm                    # SQLite共享内存文件
    ├── database.db-wal                    # SQLite Write-Ahead日志
    ├── images/                            # 题目图片目录
    │   ├── abc123.png                     # 原图
    │   ├── abc123_thumb.png               # 缩略图（150x150）
    │   ├── def456.jpg
    │   ├── def456_thumb.jpg
    │   └── ...
    ├── prompts/                           # 提示词配置目录
    │   ├── active/                        # 当前激活提示词
    │   │   ├── task1.json                 # Task 1激活版本
    │   │   └── task2.json                 # Task 2激活版本
    │   └── history/                       # 历史版本（供回退）
    │       ├── task1-v1.0.0.json
    │       ├── task1-v1.1.0.json
    │       └── task2-v1.0.0.json
    ├── logs/                              # 日志目录
    │   ├── app.log                        # 当前日志
    │   ├── app.log.1                      # 历史日志
    │   └── app.log.2
    ├── backups/                           # 数据备份目录
    │   ├── backup-20251004-130000.zip     # 自动/手动备份
    │   └── backup-20251003-120000.zip
    └── temp/                              # 临时文件目录
        └── upload_temp_xxx.png            # 上传图片临时文件
    ```


    ### 7.2 Windows/macOS/Linux路径差异
    
    - **Windows**：`C:\Users\{用户名}\AppData\Roaming\{appName}\`
    - **macOS**：`/Users/{用户名}/Library/Application Support/{appName}/`
    - **Linux**：`/home/{用户名}/.config/{appName}/`


    ### 7.3 备份文件结构
    
    ```
    backup-{timestamp}.zip
    ├── database.db                        # 完整数据库文件
    ├── images/                            # 所有图片文件
    │   └── ...
    ├── prompts/                           # 提示词配置
    │   └── ...
    └── manifest.json                      # 备份元数据
        {
          "version": "1.0.0",
          "timestamp": "2025-10-04T13:00:00Z",
          "essay_count": 85,
          "topic_count": 50,
          "app_version": "1.0.0"
        }
    ```


    ***
    
    ## 8. 提示词配置模板
    
    ### 8.1 JSON配置文件结构
    
    ```json
    {
      "version": "1.0.0",
      "task1": {
        "system_prompt": "You are an IELTS Writing Task 1 examiner...",
        "scoring_criteria": "详细的四项评分标准说明...",
        "output_format_example": "{...}"
      },
      "task2": {
        "system_prompt": "You are an IELTS Writing Task 2 examiner...",
        "scoring_criteria": "详细的四项评分标准说明...",
        "output_format_example": "{...}"
      }
    }
    ```


    ### 8.2 Task 1提示词模板示例
    
    ```json
    {
      "system_prompt": "You are an experienced IELTS Writing Task 1 examiner. Your task is to evaluate academic writing essays that describe visual information (charts, graphs, tables, diagrams, maps, or processes). You must assess the essay based on the official IELTS scoring criteria and provide detailed feedback.\n\nEvaluation Criteria:\n1. Task Achievement (0-9): How well the response fulfills the task requirements\n2. Coherence and Cohesion (0-9): Logical organization and linking of information\n3. Lexical Resource (0-9): Range and accuracy of vocabulary\n4. Grammatical Range and Accuracy (0-9): Variety and correctness of sentence structures\n\nYou must output your evaluation in strict JSON format as specified below.",
      
      "scoring_criteria": "Task Achievement:\n- Band 9: Fully satisfies all requirements, presents clear overview, accurate data\n- Band 7: Covers requirements, clear overview, key features well highlighted\n- Band 5: Addresses task but format may be inappropriate, mechanical description\n\nCoherence and Cohesion:\n- Band 9: Uses cohesion perfectly, paragraphing highly appropriate\n- Band 7: Logically organizes information, clear progression\n- Band 5: Presents information with some organization, inadequate/overuse of cohesive devices\n\nLexical Resource:\n- Band 9: Wide range of vocabulary, sophisticated control of lexical features\n- Band 7: Sufficient range of vocabulary, some less common items\n- Band 5: Limited vocabulary, noticeable errors that may cause difficulty\n\nGrammatical Range and Accuracy:\n- Band 9: Wide range of structures, full flexibility and accuracy\n- Band 7: Variety of complex structures, frequent error-free sentences\n- Band 5: Limited range of structures, frequent grammar errors",
      
      "output_format_example": "{\n  \"total_score\": 6.5,\n  \"task_achievement\": 6.0,\n  \"coherence_cohesion\": 7.0,\n  \"lexical_resource\": 6.5,\n  \"grammatical_range\": 6.0,\n  \"sentences\": [\n    {\n      \"index\": 0,\n      \"original\": \"The chart show the population growth.\",\n      \"errors\": [\n        {\n          \"type\": \"grammar\",\n          \"word\": \"show\",\n          \"start_pos\": 10,\n          \"end_pos\": 14,\n          \"reason\": \"Subject-verb agreement error. 'chart' is singular, verb should be 'shows'\",\n          \"correction\": \"shows\"\n        }\n      ],\n      \"corrected\": \"The chart shows the population growth.\"\n    }\n  ],\n  \"overall_feedback\": \"The essay provides a clear overview of the data presented in the chart. However, there are several grammatical errors that affect clarity...\"\n}"
    }
    ```


    ### 8.3 Task 2提示词模板示例
    
    ```json
    {
      "system_prompt": "You are an experienced IELTS Writing Task 2 examiner. Your task is to evaluate argumentative essays where candidates present their opinions on social issues. You must assess the essay based on the official IELTS scoring criteria and provide detailed feedback.\n\nEvaluation Criteria:\n1. Task Response (0-9): How well the response addresses all parts of the task\n2. Coherence and Cohesion (0-9): Logical organization and linking of ideas\n3. Lexical Resource (0-9): Range and accuracy of vocabulary\n4. Grammatical Range and Accuracy (0-9): Variety and correctness of sentence structures\n\nYou must output your evaluation in strict JSON format as specified below.",
      
      "scoring_criteria": "Task Response:\n- Band 9: Fully addresses all parts, develops position fully, relevant ideas\n- Band 7: Addresses all parts, clear position, main ideas extended and supported\n- Band 5: Addresses task only partially, unclear position, limited idea development\n\nCoherence and Cohesion:\n- Band 9: Skillful management of cohesion, paragraphing sufficiently and appropriately\n- Band 7: Logically organizes information, clear progression throughout\n- Band 5: Presents information with some organization, inadequate use of cohesive devices\n\nLexical Resource:\n- Band 9: Wide range of vocabulary, sophisticated control, rare minor errors\n- Band 7: Sufficient range, shows awareness of style and collocation\n- Band 5: Limited range, noticeable errors in spelling/word formation\n\nGrammatical Range and Accuracy:\n- Band 9: Wide range of structures, rare minor errors\n- Band 7: Variety of complex structures, good control, few errors\n- Band 5: Limited range, errors may cause difficulty for reader",
      
      "output_format_example": "{...similar to Task 1...}"
    }
    ```


    ***
    
    ## 9. 用户体验流程
    
    ### 9.1 首次使用流程
    
    ```
    1. 用户首次打开应用
       ↓
    2. 检测userData目录是否存在database.db
       ↓ (不存在)
    3. 显示欢迎引导页（Welcome.vue）
       ↓
    4. 步骤1：欢迎介绍 → 点击"下一步"
       ↓
    5. 步骤2：API配置
       - 用户输入配置信息
       - 点击"测试连接"验证
       - 点击"保存并继续"
       ↓
    6. 步骤3：提示词导入
       - 选项A：使用默认提示词（推荐）
       - 选项B：导入自定义配置文件
       - 点击"完成"
       ↓
    7. 自动导入内置题库（50道题目）
       ↓
    8. 进入主界面（WritingLayout）
       ↓
    9. 显示新手引导Tooltip（可选）
       - 指向题目选择区域："选择题目开始练习"
       - 指向设置按钮："在这里管理API配置和提示词"
    ```


    ### 9.2 标准评分流程
    
    ```
    1. 用户在ComposePage选择题目
       ↓
    2. 题目内容显示在右侧面板
       ↓
    3. 用户在左侧编辑器输入作文
       ↓ (自动保存草稿，10秒间隔)
    4. 字数统计实时更新
       ↓
    5. 点击"提交评分"按钮
       ↓
    6. 前端验证：
       - 内容非空？
       - 字数是否过少？（弹窗确认）
       ↓ (通过验证)
    7. 发送POST /api/evaluate创建任务
       ↓
    8. 获取sessionId
       ↓
    9. 页面切换至EvaluatingPage
       ↓
    10. 建立SSE连接（GET /api/evaluate/:sessionId/stream）
        ↓
    11. 监听SSE事件，实时更新UI：
        - progress事件 → 更新进度条
        - score事件 → 显示评分预览
        - sentence事件 → 显示错误标注预览
        - feedback事件 → 显示建议预览
        - complete事件 → 评分完成
        ↓
    12. 评分完成，保存到数据库（POST /api/essays）
        ↓
    13. 页面切换至ResultPage
        ↓
    14. 显示完整评分结果：
        - 左侧：作文标注视图
        - 右侧：评分详情+雷达图
        ↓
    15. 用户操作选项：
        - 查看历史记录
        - 写新作文
        - 重新评分
    ```


    ### 9.3 历史记录查询流程
    
    ```
    1. 用户点击"历史记录"菜单
       ↓
    2. 进入HistoryPage
       ↓
    3. 默认显示最近20条记录（虚拟滚动）
       ↓
    4. 用户使用筛选功能：
       - 选择任务类型：Task 1
       - 选择日期范围：最近一个月
       - 选择分数范围：6.0-7.5
       ↓
    5. 发送GET /api/essays?... 查询请求
       ↓
    6. 后端SQL查询，返回符合条件的记录
       ↓
    7. 列表更新显示筛选结果
       ↓
    8. 用户点击某条记录的"查看详情"
       ↓
    9. 打开HistoryDetailModal弹窗
       ↓
    10. 显示完整评分结果（复用ResultPage布局）
    ```


    ### 9.4 题目管理流程
    
    ```
    1. 用户进入TopicManagePage
       ↓
    2. 显示现有题目列表（官方题目50道+用户自定义）
       ↓
    3. 用户点击"添加题目"按钮
       ↓
    4. 打开TopicEditorModal
       ↓
    5. 用户填写表单：
       - 选择类型：Task 1
       - 选择分类：柱状图
       - 选择难度：3星
       - 输入题目内容（Tiptap富文本）
       - 上传图片（拖拽或选择）
       ↓
    6. 图片上传到后端（POST /api/upload/image）
       ↓
    7. 后端保存图片到userData/images/，生成缩略图
       ↓
    8. 返回图片路径
       ↓
    9. 用户点击"保存"
       ↓
    10. 发送POST /api/topics创建题目
        ↓
    11. 成功后Toast提示："题目创建成功"
        ↓
    12. 关闭弹窗，刷新题目列表
    ```


    ***
    
    ## 10. 开发优先级建议
    
    ### 10.1 第一阶段：核心功能（MVP）
    
    **目标**：实现基本的评分功能，支持单次评分和结果展示
    
    - [P0] Electron应用框架搭建
    - [P0] 数据库设计与初始化（SQLite）
    - [P0] 后端Express服务器+基础路由
    - [P0] 前端Vue 3项目初始化+Element Plus集成
    - [P0] API配置管理（CRUD）
    - [P0] 提示词配置管理（使用默认提示词）
    - [P0] 作文输入页面（ComposePage）
      - 简单题目输入框（暂不支持富文本）
      - 作文编辑器（基础Textarea）
      - 字数统计
      - 提交按钮
    - [P0] 评分流程实现
      - SSE流式返回
      - 进度展示
      - 错误处理
    - [P0] 评分结果展示（ResultPage）
      - 基础布局
      - 分数显示
      - 错误标注（简单高亮）
    - [P0] 打包为桌面应用（Electron Builder）
    
    **预计工时**：2-3周
    
    ### 10.2 第二阶段：增强功能
    
    **目标**：完善用户体验，增加题目库和历史记录管理
    
    - [P1] 题目库功能
      - 内置题库导入
      - 题目列表展示
      - 题目筛选
    - [P1] 题目管理功能
      - 题目CRUD
      - 图片上传与缩略图生成
      - 富文本编辑器（Tiptap集成）
    - [P1] 历史记录功能
      - 列表展示（虚拟滚动）
      - 筛选和搜索
      - 详情查看
    - [P1] 草稿自动保存
    - [P1] 雷达图展示（ECharts）
    - [P1] 历史平均对比
    - [P1] 错误详情折叠展开
    - [P1] 视图切换（原文/标注）
    
    **预计工时**：2-3周
    
    ### 10.3 第三阶段：高级功能
    
    **目标**：完善设置系统，优化性能，增加多语言支持
    
    - [P2] 系统设置页面
      - 模型参数配置
      - 提示词编辑器
      - 数据管理
    - [P2] 多语言支持（i18n）
    - [P2] 首次启动引导
    - [P2] 批量操作
      - 历史记录批量删除
      - 题目批量导入
    - [P2] 导出功能
      - 历史记录导出CSV
      - 提示词导出JSON
    - [P2] 数据备份与恢复
    - [P2] 性能优化
      - 图片懒加载
      - 数据库查询优化
      - 防抖节流
    - [P2] 错误日志系统
    
    **预计工时**：2周
    
    ### 10.4 第四阶段：听力阅读整合
    
    **目标**：整合现有听力阅读系统，实现统一应用
    
    - [P3] LegacyWrapper组件开发
    - [P3] 路由整合与状态持久化
    - [P3] IPC接口暴露（如需要）
    - [P3] 全局导航优化
    - [P3] 跨模块测试
    
    **预计工时**：1周
    
    ### 10.5 第五阶段：测试与优化
    
    **目标**：全面测试，修复bug，优化用户体验
    
    - [P2] 单元测试（关键功能）
    - [P2] 集成测试
    - [P2] 性能测试（大量历史记录场景）
    - [P2] 用户体验优化
    - [P2] 跨平台兼容性测试（Windows/macOS/Linux）
    - [P2] 代码签名（Windows/macOS）
    - [P2] 撰写用户文档
    
    **预计工时**：1-2周
    
    ***
    
    ## 11. 技术风险与应对策略
    
    ### 11.1 LLM响应质量
    
    **风险**：LLM返回的评分可能不准确或格式不符合预期
    **应对**：
    
    - 精心设计提示词，提供详细评分标准和输出格式示例
    - 使用JSON Schema约束输出格式（如OpenAI的function calling）
    - 实现格式验证和降级展示机制
    - 提供"重新评分"功能，允许用户多次尝试


    ### 11.2 API成本控制
    
    **风险**：用户频繁评分导致API成本过高
    **应对**：
    
    - 限制作文字数上限（Task 1: 280词，Task 2: 390词）
    - 在提交前显示字数警告
    - 教育用户合理使用（在文档中说明成本问题）
    - 可选：增加本地评分次数统计，提醒用户


    ### 11.3 SQLite并发问题
    
    **风险**：多个操作同时写入数据库可能导致锁定
    **应对**：
    
    - 使用better-sqlite3的同步API（天然避免并发）
    - 在Electron主进程中处理所有数据库操作
    - 渲染进程通过IPC调用主进程的数据库接口
    - 启用WAL模式提高并发性能


    ### 11.4 跨平台兼容性
    
    **风险**：不同操作系统的文件路径、权限、打包方式差异
    **应对**：
    
    - 统一使用Electron的`app.getPath()`API获取路径
    - 使用`path.join()`处理路径拼接
    - 在Windows/macOS/Linux上分别测试
    - 使用Electron Builder的自动化打包配置


    ### 11.5 大文件备份
    
    **风险**：数据库和图片文件过大，备份耗时长
    **应对**：
    
    - 使用流式压缩（archiver库）
    - 显示备份进度条
    - 设置历史记录自动清理策略（默认保留100条）
    - 图片压缩和缩略图优化
    
    ***
    
    ## 12. 后续扩展方向
    
    ### 12.1 离线AI模型支持
    
    - 集成Ollama或LocalAI，支持完全本地运行
    - 提供模型下载和管理功能
    - 在API配置中增加"本地模型"选项


    ### 12.2 协作功能
    
    - 支持多用户账号系统（需服务器）
    - 教师账号可查看学生的评分记录
    - 班级管理和进度追踪


    ### 12.3 学习分析
    
    - 生成学习报告（PDF导出）
    - 错误类型统计图表
    - 进步趋势分析


    ### 12.4 语音输入
    
    - 集成语音识别API
    - 支持口述作文，自动转文字


    ### 12.5 移动端版本
    
    - 使用Capacitor或React Native
    - 同步数据到云端
    
    ***
    
    ## 13. 总结
    
    本需求文档详细定义了雅思AI作文评判应用的完整功能、技术架构、数据库设计、API接口、前端组件树、用户体验流程和开发优先级。核心亮点包括：
    
    1. **技术栈**：Vue 3 + Element Plus + Tiptap + ECharts + Node.js + Express + SQLite + Electron
    2. **核心功能**：AI评分、错误标注、历史记录、题目管理、多语言支持
    3. **SSE流式返回**：实时展示评分进度，提升用户体验
    4. **离线优先**：数据存储在本地，保护用户隐私
    5. **可扩展性**：支持多个LLM供应商，提示词可配置更新
    6. **听力阅读整合**：通过LegacyWrapper组件整合现有系统
    
    开发团队可基于本文档进行技术实现，按照优先级分阶段交付功能，最终构建一个功能完善、用户体验优秀的雅思写作评判桌面应用。
    <span style="display:none">[^1][^2][^3][^4][^5][^6][^7]</span>
    
    三、 技术与架构的补充说明
    技术架构已经非常出色，以下是一些可以锦上添花的细节。
    详细的测试策略 (Testing Strategy)：
    在开发计划中可以更明确地定义测试策略，例如：
    单元测试：使用 Vitest 对核心的 Composable 函数和后端 Service 进行测试。
    组件测试：对关键的 Vue 组件进行隔离测试。
    端到端测试 (E2E)：使用 Playwright 或 Cypress 对核心用户流程（如注册API -> 写作文 -> 评分 -> 查看历史）进行自动化测试。
    数据迁移策略 (Data Migration Strategy)：
    文档中提到了 migrations/ 目录，可以进一步说明迁移机制。例如，应用启动时会检查数据库版本，并自动执行所有未应用的迁移脚本，以确保用户更新应用版本后数据库结构也能平滑升级。
    CI/CD (持续集成/持续部署)：
    可以建议建立一个简单的 CI/CD 流程（例如使用 GitHub Actions），实现代码提交后自动运行测试、代码检查和为三大平台（Windows/macOS/Linux）自动打包，提高开发效率和软件质量。
    
    <div align="center">⁂</div>
    
    [^1]: https://koreascience.kr/article/JAKO202517850403344.pdf
    
    [^2]: https://www.scribd.com/document/880044020/AI-Powered-IELTS-Writing-Evaluation-Models-Data-And-MVP-Design
    
    [^3]: https://www.sciencedirect.com/science/article/pii/S2772766123000101
    
    [^4]: https://lingocraft.net/en/how-it-works
    
    [^5]: https://dataloop.ai/library/model/chillies_mistral-7b-ielts-evaluator-q4/
    
    [^6]: https://files.eric.ed.gov/fulltext/EJ1463368.pdf
    
    [^7]: https://dl.acm.org/doi/10.1145/3709026.3709030


​    

<div align="center">⁂</div>

[^1]: https://blog.csdn.net/qq_22910257/article/details/144984293

[^2]: https://blog.csdn.net/m0_61729576/article/details/131515598

[^3]: https://juejin.cn/post/7227013497040896059

[^4]: https://www.cnblogs.com/zhongxu6868/articles/15894269.html

[^5]: https://developer.aliyun.com/article/1483127

[^6]: https://www.cnblogs.com/hwy6/p/14665674.html

[^7]: https://juejin.cn/post/7289247247514386487

[^8]: https://junlli.com/doc/6db44abb61871667a38575788fa50859

[^9]: https://wangchujiang.com/github-rank/repos.html

[^10]: https://gitee.com/huxiangli/vue2

[^11]: https://edvoy.com/exams/ielts-writing-score-calculator/

[^12]: https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail

[^13]: https://ieltstutorials.online/writing-assessment-criteria

[^14]: https://en.kelen.cc/posts/electron-local-data-storage-solutions

[^15]: https://stackoverflow.com/questions/61039792/electron-store-my-app-datas-in-userdata-path

[^16]: https://dev.to/manuelernestog/how-i-made-a-multi-agent-ai-sidebar-with-electron-and-svelte-2044

[^17]: https://ielts.com.au/australia/prepare/writing/how-your-ielts-writing-test-is-marked

[^18]: https://dev.to/serifcolakel/real-time-data-streaming-with-server-sent-events-sse-1gb2

[^19]: https://www.mindbowser.com/real-time-data-streaming-sse-nodejs-reactjs/

[^20]: https://www.reddit.com/r/electronjs/comments/lei8b1/electron_local_database/

[^21]: https://rxdb.info/electron-database.html

[^22]: https://stackoverflow.com/questions/53229357/vue-js-over-electron-on-an-existing-application

[^23]: https://vuejs.org/guide/extras/ways-of-using-vue

[^24]: https://www.uxpin.com/studio/blog/advanced-prototyping-techniques-with-vue-3-composition-api/

[^25]: https://www.javacodegeeks.com/2025/01/vue-3-in-2025-a-deep-dive-into-modern-web-development.html

[^26]: https://www.reddit.com/r/vuejs/comments/1ij0c3e/element_plus_or_naive_ui_for_admin_project/

[^27]: https://uibakery.io/blog/top-vue-component-libraries

[^28]: https://juejin.cn/post/7491615553418625034

[^29]: https://www.tiny.cloud/blog/best-vue-rich-text-editors/

[^30]: https://www.reddit.com/r/vuejs/comments/1c2al6u/which_vue_editor_library_quill_tiptap_or_lexical/

[^31]: https://liveblocks.io/blog/which-rich-text-editor-framework-should-you-choose-in-2025

[^32]: https://www.smashingmagazine.com/2020/07/desktop-apps-electron-vue-javascript/

[^33]: https://stackoverflow.com/questions/36249684/simple-way-to-implement-server-sent-events-in-node-js

[^34]: https://moldstud.com/articles/p-best-practices-for-database-schema-design-in-sqlite

[^35]: https://www.sqlite.org/appfileformat.html

[^36]: https://arxiv.org/html/2408.11061v1

[^37]: https://electronjs.org

[^38]: https://github.com/soulehshaikh99/create-vue-electron-app

[^39]: https://ielts.org/news-and-insights/ielts-writing-band-descriptors-and-key-assessment-criteria

