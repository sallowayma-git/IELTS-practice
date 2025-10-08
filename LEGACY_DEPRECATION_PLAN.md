# 遗留全局函数弃用计划

## 概述

本文档定义了测试框架中遗留全局函数的逐步弃用计划，引导开发者从旧API迁移到新架构API。

## 当前状态

### 已实现的兼容层

- **文件**: `tests/compat-shims.js`
- **状态**: ✅ 已实现
- **功能**: 为旧测试期望的全局函数提供代理

### 弃用警告机制

- **DEBUG模式警告**: ✅ 已实现
- **实现方式**: 在`tests/compat-shims.js`中使用`showDeprecationWarning()`
- **触发条件**: `window.__DEBUG__ = true`

## 弃用阶段计划

### 阶段 1: 警告期 (当前阶段)

**目标**: 在不破坏现有测试的前提下，引导开发者使用新API

**措施**:
- ✅ 在DEBUG模式下显示弃用警告
- ✅ 提供详细的API映射文档
- ✅ 兼容层确保功能正常工作

**警告示例**:
```javascript
[CompatShims] DEPRECATED: loadLibrary is deprecated. Use App.stores.exams.refreshExams() instead.
```

### 阶段 2: 迁移期

**目标**: 鼓励开发者逐步迁移到新API

**时间估计**: 2-4周

**措施**:
- 📋 创建迁移指南
- 📋 提供自动化迁移工具（如果需要）
- 📋 更新所有测试文档

**新API示例**:
```javascript
// 旧方式
await loadLibrary();

// 新方式
await App.stores.exams.refreshExams();
```

### 阶段 3: 过渡期

**目标**: 逐步减少对旧API的依赖

**时间估计**: 4-6周

**措施**:
- 📋 在测试框架中引入"严格模式"
- 📋 对未迁移的测试发出警告
- 📋 提供迁移检查工具

### 阶段 4: 弃用期

**目标**: 完全移除旧API支持

**时间估计**: 6-8周

**措施**:
- 📋 移除`tests/compat-shims.js`中的旧API代理
- 📋 更新测试框架以要求新API
- 📋 清理相关文档

## API映射表

### 题库管理

| 旧API | 新API | 状态 |
|-------|-------|------|
| `loadLibrary()` | `App.stores.exams.refreshExams()` | ✅ 代理已实现 |
| `refreshExamLibrary()` | `App.stores.exams.refreshExams()` | ✅ 代理已实现 |
| `loadExamLibrary()` | `App.stores.exams.loadExams()` | ✅ 代理已实现 |
| `showLibraryConfigListV2()` | `App.ui.settingsPanel.showLibraryConfigListV2()` | ✅ 代理已实现 |

### 数据管理

| 旧API | 新API | 状态 |
|-------|-------|------|
| `createManualBackup()` | `SettingsPanelAPI.createBackup()` | ✅ 代理已实现 |
| `exportAllData()` | `SettingsPanelAPI.exportData()` | ✅ 代理已实现 |
| `importData()` | `SettingsPanelAPI.importData()` | ✅ 代理已实现 |

### 搜索和筛选

| 旧API | 新API | 状态 |
|-------|-------|------|
| `searchExams(query)` | `App.ui.examBrowser.search(query)` | ✅ 代理已实现 |
| `filterByType(type)` | `App.ui.examBrowser.setType(type)` | ✅ 代理已实现 |
| `filterByCategory(category)` | `App.ui.examBrowser.setCategory(category)` | ✅ 代理已实现 |

## 迁移检查清单

### 开发者检查清单

- [ ] 启用DEBUG模式查看弃用警告
- [ ] 根据警告信息更新代码
- [ ] 测试功能是否正常工作
- [ ] 移除对旧API的调用
- [ ] 验证新API的正确性

### 测试框架检查清单

- [ ] 确认所有测试使用新API
- [ ] 移除兼容层依赖
- [ ] 更新测试文档
- [ ] 验证测试覆盖率

## 自动化工具

### 弃用检查器

创建一个工具来检查代码中的旧API使用：

```javascript
// 使用示例
const deprecationChecker = new LegacyDeprecationChecker();
const report = deprecationChecker.analyzeCode(code);
console.log(report);
```

### 迁移助手

提供自动迁移建议：

```javascript
// 使用示例
const migrationHelper = new MigrationHelper();
const suggestions = migrationHelper.getSuggestions(code);
console.log(suggestions);
```

## 实施时间表

| 阶段 | 开始时间 | 持续时间 | 主要任务 |
|------|----------|----------|----------|
| 阶段 1: 警告期 | ✅ 已完成 | 1周 | 实现兼容层和警告机制 |
| 阶段 2: 迁移期 | 📋 待开始 | 2-4周 | 创建迁移指南和工具 |
| 阶段 3: 过渡期 | 📋 计划中 | 4-6周 | 严格模式和检查工具 |
| 阶段 4: 弃用期 | 📋 计划中 | 6-8周 | 移除旧API支持 |

## 风险评估

### 高风险
- **现有测试失效**: 通过兼容层缓解
- **开发者迁移困难**: 提供详细文档和工具

### 中风险
- **时间估计不准确**: 根据实际情况调整
- **某些功能无法直接映射**: 需要重新设计

### 低风险
- **文档更新延迟**: 自动化文档生成
- **测试覆盖率下降**: 并行开发新测试

## 成功指标

### 量化指标
- [ ] 旧API调用数量减少90%
- [ ] 新API测试覆盖率达到100%
- [ ] 开发者满意度评分 > 4.5/5

### 质量指标
- [ ] 所有测试在新架构下正常运行
- [ ] 代码质量评分提升
- [ ] 文档完整性达到100%

## 应急计划

如果迁移过程中遇到重大问题：

1. **延迟弃用**: 推迟阶段4的时间表
2. **并行支持**: 同时支持新旧API更长时间
3. **回滚计划**: 保留兼容层作为备选方案
4. **社区支持**: 寻求开发者反馈和贡献

## 联系信息

如有问题或建议，请联系：
- **项目负责人**: 开发团队
- **文档更新**: 参考项目文档
- **技术支持**: 通过项目Issues反馈

---

**文档版本**: 1.0.0
**创建日期**: 2025-10-01
**最后更新**: 2025-10-01
**相关任务**: Task 62