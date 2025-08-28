# IELTS考试系统 - 完整文档

## 系统概述

IELTS考试系统是一个基于Web的雅思考试练习平台，支持阅读理解练习、成绩记录和题库管理。本文档涵盖系统的技术架构、用户操作指南、故障排除和维护说明。

## 目录

1. [系统架构](#系统架构)
2. [用户操作指南](#用户操作指南)
3. [管理员指南](#管理员指南)
4. [故障排除](#故障排除)
5. [维护文档](#维护文档)
6. [技术参考](#技术参考)

---

## 系统架构

### 核心组件

#### 1. 主应用程序 (`improved-working-system.html`)
- 系统入口点和主界面
- 题库浏览和搜索功能
- 考试启动和窗口管理

#### 2. 考试数据索引 (`complete-exam-data.js`)
- 包含所有考试的元数据
- 文件路径和可用性信息
- 分类和频率标记

#### 3. 核心JavaScript模块
- `js/app.js` - 主应用逻辑
- `js/core/practiceRecorder.js` - 练习记录管理

#### 4. 系统组件 (`js/components/`)
- `ExamScanner.js` - 考试文件扫描器
- `IndexValidator.js` - 索引验证器
- `CommunicationTester.js` - 通信测试器
- `BrowseStateManager.js` - 浏览状态管理器
- `ErrorFixer.js` - 错误修复器
- `SystemIntegrationTester.js` - 系统集成测试器

### 文件结构

```
IELTS系统/
├── improved-working-system.html     # 主界面
├── complete-exam-data.js           # 考试索引
├── js/
│   ├── app.js                      # 主应用逻辑
│   ├── core/
│   │   └── practiceRecorder.js     # 练习记录
│   └── components/                 # 系统组件
│       ├── ExamScanner.js
│       ├── IndexValidator.js
│       ├── CommunicationTester.js
│       ├── BrowseStateManager.js
│       ├── ErrorFixer.js
│       └── SystemIntegrationTester.js
├── P1/                            # Part 1 考试文件
├── P2/                            # Part 2 考试文件
├── P3/                            # Part 3 考试文件
└── 其他资源文件/
```

---

## 用户操作指南

### 基本操作

#### 启动系统
1. 打开 `improved-working-system.html` 文件
2. 系统将自动加载考试索引
3. 主界面显示可用考试总数和分类统计

#### 浏览考试
1. **查看所有考试**: 点击主界面的"题库浏览"按钮
2. **按分类浏览**: 点击P1、P2或P3按钮查看特定分类
3. **搜索考试**: 使用搜索框输入关键词查找特定考试
4. **返回全部视图**: 在分类浏览后，点击主界面"题库浏览"可返回显示所有考试

#### 开始练习
1. 在考试列表中找到要练习的考试
2. 点击考试标题打开考试窗口
3. 按照考试界面的指示完成练习
4. 练习结果将自动保存到系统中

### 高级功能

#### 查看练习记录
- 系统自动记录每次练习的成绩和时间
- 可通过练习记录功能查看历史表现

#### 考试文件类型
- **HTML文件**: 交互式考试，支持在线答题和自动评分
- **PDF文件**: 静态考试材料，需要手动评分

---

## 管理员指南

### 系统维护

#### 添加新考试
1. 将考试文件放置在相应的P1、P2或P3目录中
2. 运行考试扫描器发现新文件
3. 更新 `complete-exam-data.js` 索引文件
4. 验证新考试的可访问性

#### 更新现有考试
1. 修改考试文件内容
2. 运行索引验证器检查一致性
3. 测试考试的通信功能
4. 更新相关元数据

#### 系统健康检查
定期运行以下检查：
- 考试文件完整性验证
- 索引准确性检查
- 通信功能测试
- 浏览功能验证

### 配置管理

#### 考试索引结构
```javascript
{
    id: "唯一标识符",
    title: "考试标题",
    path: "文件路径",
    category: "P1/P2/P3",
    hasHtml: true/false,
    hasPdf: true/false,
    frequency: "高/次/无标记"
}
```

#### 系统参数
- 考试窗口尺寸和位置
- 通信超时设置
- 扫描目录配置
- 错误处理策略

---

## 故障排除

### 常见问题

#### 1. 考试无法打开
**症状**: 点击考试标题后无响应或出现错误

**可能原因**:
- 文件路径错误
- 文件不存在
- 权限问题
- 浏览器安全限制

**解决方案**:
1. 检查文件是否存在于指定路径
2. 验证文件权限设置
3. 运行索引验证器修复路径问题
4. 检查浏览器安全设置

#### 2. 浏览功能异常
**症状**: 分类浏览后无法返回全部考试视图

**解决方案**:
1. 刷新页面重置浏览状态
2. 检查浏览状态管理器的工作状态
3. 清除浏览器缓存

#### 3. 练习记录丢失
**症状**: 完成练习后成绩未保存

**可能原因**:
- 通信功能故障
- 存储权限问题
- 考试窗口通信中断

**解决方案**:
1. 运行通信测试器检查连接状态
2. 检查本地存储权限
3. 重新测试考试的通信功能

#### 4. 搜索功能不工作
**症状**: 搜索无结果或结果不准确

**解决方案**:
1. 检查搜索关键词拼写
2. 验证考试索引的完整性
3. 重新加载考试数据

### 错误代码参考

| 错误代码 | 描述 | 解决方案 |
|---------|------|----------|
| E001 | 文件未找到 | 检查文件路径和存在性 |
| E002 | 通信超时 | 检查网络连接和考试窗口状态 |
| E003 | 索引损坏 | 重新生成考试索引 |
| E004 | 权限拒绝 | 检查文件和目录权限 |
| E005 | 浏览器兼容性 | 更新浏览器或使用推荐浏览器 |

---

## 维护文档

### 定期维护任务

#### 每周任务
- [ ] 运行系统健康检查
- [ ] 验证新添加的考试文件
- [ ] 检查练习记录的完整性
- [ ] 清理临时文件和缓存

#### 每月任务
- [ ] 完整的索引验证和修复
- [ ] 性能优化检查
- [ ] 备份考试数据和配置
- [ ] 更新系统文档

#### 季度任务
- [ ] 全面的系统测试
- [ ] 安全性检查和更新
- [ ] 用户反馈收集和分析
- [ ] 系统升级规划

### 备份策略

#### 关键文件备份
- `complete-exam-data.js` - 考试索引
- `improved-working-system.html` - 主界面
- `js/` 目录 - 所有JavaScript文件
- 练习记录数据

#### 备份频率
- 每日: 练习记录数据
- 每周: 系统配置文件
- 每月: 完整系统备份

### 性能监控

#### 关键指标
- 考试加载时间
- 搜索响应速度
- 内存使用情况
- 错误发生频率

#### 优化建议
- 定期清理未使用的考试文件
- 优化考试索引结构
- 压缩静态资源
- 实施缓存策略

---

## 技术参考

### API接口

#### 考试扫描器 (ExamScanner)
```javascript
// 扫描指定目录
ExamScanner.scanDirectory(path, options)

// 获取扫描结果
ExamScanner.getScanResults()

// 生成扫描报告
ExamScanner.generateReport()
```

#### 索引验证器 (IndexValidator)
```javascript
// 验证索引完整性
IndexValidator.validateIndex(examData)

// 修复索引问题
IndexValidator.fixIndexIssues(issues)

// 生成验证报告
IndexValidator.generateValidationReport()
```

#### 通信测试器 (CommunicationTester)
```javascript
// 测试单个考试通信
CommunicationTester.testExamCommunication(examId)

// 批量测试通信
CommunicationTester.testAllExams()

// 获取通信状态
CommunicationTester.getCommunicationStatus()
```

### 配置选项

#### 系统配置
```javascript
const systemConfig = {
    scanDirectories: ['P1', 'P2', 'P3'],
    communicationTimeout: 5000,
    maxConcurrentTests: 5,
    autoFixEnabled: true,
    debugMode: false
};
```

#### 浏览器兼容性
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

### 开发指南

#### 添加新组件
1. 在 `js/components/` 目录创建新文件
2. 实现标准接口方法
3. 添加错误处理和日志记录
4. 编写单元测试
5. 更新文档

#### 修改现有功能
1. 备份相关文件
2. 实施更改
3. 运行完整测试套件
4. 更新相关文档
5. 部署到测试环境验证

---

## 联系信息

如需技术支持或报告问题，请联系系统管理员。

**文档版本**: 1.0  
**最后更新**: 2025年8月28日  
**维护者**: Salloway