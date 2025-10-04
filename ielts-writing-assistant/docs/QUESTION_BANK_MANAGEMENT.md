# 题库资源管理系统文档

**版本**: 1.0.0
**最后更新**: 2025-10-04
**状态**: ✅ 已完成

## 📋 概述

题库资源管理系统是IELTS写作AI评判助手的重要组成部分，提供完整的题库导入、索引、查询和管理功能。支持多种文件格式，具有智能解析、分类管理和搜索功能。

## 🎯 功能特性

### 核心功能
- **多格式支持**: JSON、Markdown、文本、CSV格式题库文件
- **智能解析**: 自动识别文件格式，智能提取题目信息
- **分类管理**: 按写作任务、听力、阅读、词汇自动分类
- **索引优化**: 高效的索引机制，支持快速查询
- **搜索功能**: 全文搜索、标签筛选、难度筛选
- **批量导入**: 支持目录批量导入，实时进度显示
- **数据备份**: 自动备份机制，防止数据丢失

### 高级功能
- **进度追踪**: 实时显示导入进度和状态
- **错误处理**: 详细的错误报告和恢复机制
- **缓存优化**: 智能缓存管理，提升查询性能
- **完整性验证**: 题库完整性检查和校验
- **统计报表**: 详细的题库统计信息

## 🏗️ 系统架构

### 服务层架构
```
electron/services/
├── QuestionBankService.js     # 核心题库服务
├── QuestionBankIPC.js          # IPC通信接口
└── LegacyService.js           # Legacy系统服务
```

### 数据结构
```
question-bank/
├── question-bank-index.json    # 题库索引文件
├── cache/                      # 缓存目录
├── backups/                    # 备份目录
└── temp/                       # 临时文件目录
```

### 索引结构
```json
{
  "version": "1.0",
  "createdAt": "2025-10-04T10:00:00.000Z",
  "updatedAt": "2025-10-04T10:00:00.000Z",
  "totalQuestions": 1250,
  "categories": {
    "writing-task1": {
      "count": 450,
      "questions": {
        "question-id": {
          "id": "question-id",
          "title": "题目标题",
          "content": "题目内容",
          "difficulty": "medium",
          "tags": ["教育", "科技"],
          "wordCount": 250,
          "createdAt": "2025-10-04T10:00:00.000Z",
          "sourceFile": "writing/task1/education.json",
          "indexedAt": "2025-10-04T10:00:00.000Z"
        }
      }
    }
  },
  "tags": ["教育", "科技", "环境", "健康"],
  "checksum": "md5-hash"
}
```

## 🚀 快速开始

### 1. 访问题库管理
1. 在设置页面点击"题库管理"菜单
2. 系统自动初始化题库服务
3. 查看当前题库状态和统计信息

### 2. 导入题库
1. 点击"导入题库"按钮
2. 选择包含题库文件的目录
3. 系统自动扫描和验证目录结构
4. 点击"开始导入"进行批量导入
5. 实时查看导入进度和结果

### 3. 浏览题目
1. 使用搜索框搜索题目
2. 按分类、难度筛选题目
3. 点击题目查看详细信息
4. 使用分页浏览大量题目

## 📁 支持的文件格式

### JSON格式
```json
{
  "title": "教育的重要性",
  "content": "教育在现代社会中扮演着重要角色...",
  "difficulty": "medium",
  "tags": ["教育", "社会"],
  "wordCount": 250
}
```

### Markdown格式
```markdown
# 教育的重要性

教育在现代社会中扮演着重要角色。它不仅关乎个人发展，也关系到国家未来。

**难度**: 中等
**标签**: #教育 #社会

教育能够提供知识和技能，帮助人们更好地适应社会发展的需要。
```

### CSV格式
```csv
标题,内容,难度,标签
教育的重要性,教育在现代社会中扮演着重要角色,medium,教育;社会
科技的影响,科技发展带来了诸多便利和挑战,hard,科技;环境
```

### 文本格式
```
环境问题

环境问题是当今社会面临的重要挑战之一。气候变化、空气污染、水资源短缺等问题需要我们共同面对和解决。

难度：中等
字数：180字
```

## 🗂️ 目录结构建议

为了获得最佳的导入效果，建议按以下结构组织题库文件：

```
question-bank/
├── writing/
│   ├── task1/
│   │   ├── academic.json
│   │   ├── education.json
│   │   └── technology.json
│   └── task2/
│       ├── opinion.json
│       ├── discussion.json
│       └── problem-solution.json
├── listening/
│   ├── conversation/
│   │   ├── daily-life.json
│   │   └── academic.json
│   └── lecture/
│       ├── environment.json
│       └── science.json
├── reading/
│   ├── academic/
│   │   ├── research-paper.json
│   │   └── journal-article.json
│   └── news/
│       ├── current-events.json
│       └── opinion-pieces.json
└── vocabulary/
    ├── academic-vocabulary.json
    ├── topic-vocabulary.json
    └── phrasal-verbs.json
```

## 🔧 API 接口

### 渲染进程API
```javascript
// 服务管理
await window.electronAPI.questionBank.initialize()
const status = await window.electronAPI.questionBank.getStatus()

// 题库导入
const directoryResult = await window.electronAPI.questionBank.selectDirectory()
const importResult = await window.electronAPI.questionBank.import(directoryResult.selectedPath)

// 题目查询
const questions = await window.electronAPI.questionBank.getQuestions({
  limit: 50,
  offset: 0,
  search: "教育",
  category: "writing-task2",
  difficulty: "medium"
})

// 题目详情
const question = await window.electronAPI.questionBank.getQuestionById("question-id")

// 统计信息
const statistics = await window.electronAPI.questionBank.getStatistics()

// 题库管理
const refreshResult = await window.electronAPI.questionBank.refreshIndex()
const backupResult = await window.electronAPI.questionBank.createBackup()
const validationResult = await window.electronAPI.questionBank.validateIntegrity()
```

### 事件监听
```javascript
// 监听导入进度
window.electronAPI.questionBank.on('import-progress', (data) => {
  console.log('导入进度:', data.progress, '%')
  console.log('当前文件:', data.currentFile)
})

// 监听导入完成
window.electronAPI.questionBank.on('import-completed', (result) => {
  console.log('导入完成:', result)
})

// 监听导入失败
window.electronAPI.questionBank.on('import-failed', (error) => {
  console.error('导入失败:', error)
})
```

## 🎨 用户界面

### 主要界面组件

#### QuestionBankManager
- **状态面板**: 显示题库统计信息和快速操作
- **浏览面板**: 题目列表、搜索、筛选、分页
- **详情对话框**: 题目完整信息和元数据
- **导入对话框**: 目录选择和导入控制
- **进度对话框**: 实时显示导入进度和状态

### 操作流程

#### 导入流程
1. 点击"导入题库"按钮
2. 选择题库目录
3. 系统验证目录结构
4. 开始导入文件
5. 实时显示进度
6. 完成导入报告

#### 查询流程
1. 使用搜索框输入关键词
2. 选择分类和难度筛选
3. 查看题目列表
4. 点击题目查看详情
5. 使用分页浏览更多

## 🔍 搜索和筛选

### 搜索功能
- **全文搜索**: 在题目标题和内容中搜索关键词
- **实时搜索**: 输入即搜，无需按回车
- **搜索建议**: 基于历史搜索提供建议
- **高亮显示**: 搜索结果中的关键词高亮

### 筛选功能
- **分类筛选**: 按写作任务1、写作任务2、听力、阅读、词汇筛选
- **难度筛选**: 按简单、中等、困难筛选
- **标签筛选**: 按标签组合筛选
- **字数筛选**: 按题目字数范围筛选

### 排序功能
- **相关度排序**: 按搜索相关度排序
- **时间排序**: 按创建时间或索引时间排序
- **难度排序**: 按难度等级排序
- **字数排序**: 按题目字数排序

## 📊 统计信息

### 基础统计
- **总题目数**: 题库中所有题目的总数
- **分类统计**: 各分类的题目数量
- **难度分布**: 简单、中等、困难题目的分布
- **标签统计**: 各标签的使用频率

### 高级统计
- **导入历史**: 导入操作的历史记录
- **文件统计**: 支持的文件类型和数量
- **字数分布**: 题目字数的分布情况
- **时间分析**: 题目创建和更新的时间分析

## 💾 数据管理

### 备份机制
- **自动备份**: 在重要操作前自动创建备份
- **手动备份**: 用户可手动创建备份
- **备份策略**: 保留最近10个备份文件
- **备份恢复**: 支持从备份文件恢复数据

### 缓存机制
- **查询缓存**: 缓存常用查询结果
- **文件缓存**: 缓存已解析的文件内容
- **智能清理**: 自动清理过期缓存
- **大小限制**: 限制缓存总大小（100MB）

### 数据完整性
- **校验和验证**: 使用MD5校验确保数据完整性
- **索引验证**: 验证索引文件的完整性
- **定期检查**: 定期检查数据一致性
- **错误报告**: 详细的错误报告和修复建议

## ⚡ 性能优化

### 索引优化
- **分批处理**: 大量题目分批处理，避免阻塞
- **增量更新**: 支持增量索引更新
- **压缩存储**: 索引数据压缩存储
- **内存管理**: 合理的内存使用策略

### 查询优化
- **索引查询**: 基于索引的快速查询
- **分页加载**: 分页加载大量数据
- **预加载机制**: 智能预加载相关数据
- **缓存命中**: 高缓存命中率

### 文件处理优化
- **异步处理**: 文件读写异步处理
- **批量操作**: 批量文件操作优化
- **错误恢复**: 文件读取失败的恢复机制
- **进度反馈**: 实时的处理进度反馈

## 🛡️ 安全机制

### 文件访问安全
- **路径验证**: 验证文件路径的合法性
- **权限检查**: 检查文件访问权限
- **沙箱隔离**: 在受限环境中处理文件
- **恶意文件检测**: 检测恶意文件内容

### 数据安全
- **数据加密**: 敏感数据加密存储
- **访问控制**: 基于角色的访问控制
- **操作日志**: 记录所有操作日志
- **数据脱敏**: 敏感信息脱敏处理

## 🔧 故障排除

### 常见问题

#### Q: 导入失败，提示"目录验证失败"
**A**: 确保选择的目录存在且包含题库文件，建议使用推荐的目录结构。

#### Q: 搜索结果为空
**A**: 检查搜索关键词是否正确，确保题库中有相关内容。

#### Q: 题目详情显示不完整
**A**: 检查源文件格式是否正确，确保题目信息完整。

#### Q: 导入速度很慢
**A**: 大量文件导入需要时间，请耐心等待，系统会显示实时进度。

### 错误代码说明

| 错误代码 | 说明 | 解决方案 |
|---------|------|----------|
| QB-001 | 目录不存在 | 检查目录路径是否正确 |
| QB-002 | 文件格式不支持 | 检查文件格式是否在支持列表中 |
| QB-003 | 文件解析失败 | 检查文件内容格式是否正确 |
| QB-004 | 索引创建失败 | 检查磁盘空间和权限 |
| QB-005 | 内存不足 | 关闭其他应用释放内存 |

## 📈 更新日志

### v1.0.0 (2025-10-04)
- ✅ 初始版本发布
- ✅ 支持多种文件格式导入
- ✅ 实现智能解析和分类
- ✅ 提供搜索和筛选功能
- ✅ 添加导入进度追踪
- ✅ 实现数据备份和恢复
- ✅ 提供统计信息展示

## 📞 技术支持

如需技术支持或报告问题，请联系开发团队：

- **GitHub Issues**: [项目Issues页面](https://github.com/your-repo/issues)
- **文档**: [项目文档](https://docs.your-project.com)
- **社区**: [用户社区](https://community.your-project.com)

## 📄 相关文档

- [用户手册](./USER_MANUAL.md)
- [开发者指南](./DEVELOPER_GUIDE.md)
- [API文档](./API_DOCUMENTATION.md)
- [部署指南](./DEPLOYMENT_GUIDE.md)