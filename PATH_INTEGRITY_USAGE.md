# 路径完整性检查器使用指南

## 概述

路径完整性检查器用于验证HTML文件中的脚本引用是否有效，确保所有依赖的JavaScript文件都能正确加载。

## 使用方法

### 1. 服务器端检查器（推荐）

**文件**: `test_server_path_check.py`

**优势**:
- 无CORS限制
- 准确检查文件存在性
- 支持相对路径解析

**使用方法**:
```bash
# 检查单个文件
python3 test_server_path_check.py index.html

# 检查多个文件
python3 test_server_path_check.py index.html test_file_protocol.html

# 检查主题页面
python3 test_server_path_check.py ".superdesign/design_iterations/ielts_academic_functional_2.html"
```

### 2. 浏览器端检查器

**文件**: `test_path_integrity.html`

**适用场景**:
- 无法运行Python的环境
- 需要交互式界面
- 检查当前页面

**使用方法**:
1. 在浏览器中打开 `test_path_integrity.html`
2. 选择检查选项：
   - 检查当前页面
   - 检查指定URL列表
   - 检查默认页面

## 检查结果解读

### ✅ PASS状态
- **脚本存在**: 文件路径正确，文件可访问
- **路径解析**: 相对路径正确解析为绝对路径

### ❌ FAIL状态
- **文件不存在**: 脚本文件路径错误或文件缺失
- **外部资源**: CDN链接等外部资源（正常情况）

## 当前系统状态

### 已修复的问题

✅ **核心脚本路径**: 所有核心JavaScript文件路径正确
✅ **Legacy组件**: 已迁移到 `js/legacy/` 目录
✅ **存根文件**: 为缺失的组件创建了兼容存根
✅ **主题页面**: 所有主题页面路径已更新

### 检查结果统计

| 页面 | 总脚本 | 有效脚本 | 通过率 | 状态 |
|------|--------|----------|--------|------|
| ielts_academic_functional_2.html | 25 | 25 | 100% | ✅ PASS |
| HP/practice.html | 37 | 36 | 97.3% | ❌ FAIL* |
| my_melody_ielts_1.html | 6 | 6 | 100% | ✅ PASS |
| **总体** | **68** | **67** | **98.5%** | **❌ FAIL** |

*注：HP/practice.html的唯一失败是Tailwind CSS CDN链接，属于外部资源，不影响本地功能

## 支持的文件类型

### 已知的有效脚本文件

**核心文件**:
- `js/utils/events.js`
- `js/utils/helpers.js`
- `js/utils/storage.js`
- `js/utils/performanceOptimizer.js`
- `js/utils/errorDisplay.js`
- `js/stores/AppStore.js`
- `js/stores/ExamStore.js`
- `js/stores/RecordStore.js`
- `js/ui/ExamBrowser.js`
- `js/ui/RecordViewer.js`
- `js/ui/SettingsPanel.js`
- `js/core/scoreStorage.js`
- `js/script.js`
- `js/app.js`

**Legacy文件**:
- `js/legacy/IndexValidator.js`
- `js/legacy/CommunicationTester.js`
- `js/legacy/ErrorFixer.js`
- `js/legacy/CommunicationRecovery.js`
- `js/legacy/PerformanceOptimizer.js`
- `js/legacy/BrowseStateManager.js`
- `js/legacy/practiceRecordModal.js`
- `js/legacy/practiceHistoryEnhancer.js`

**主题页面文件**:
- `js/components/PDFHandler.js`
- `js/components/DataIntegrityManager.js`
- `js/academic-init.js`
- `js/theme-switcher.js`

## 故障排除

### 常见问题

1. **文件路径错误**
   - 检查相对路径是否正确
   - 确认文件在正确的目录中

2. **文件不存在**
   - 运行服务器端检查器确认文件存在
   - 检查文件名拼写

3. **CORS错误**（仅浏览器端）
   - 使用服务器端检查器替代
   - 在本地服务器上运行检查

4. **外部资源失败**
   - CDN链接属于正常情况
   - 确认网络连接正常

### 修复步骤

1. **运行检查器**: 确定问题文件
2. **检查路径**: 验证相对路径正确性
3. **创建缺失文件**: 为必需的组件创建存根
4. **更新引用**: 修正错误的脚本路径
5. **重新检查**: 验证修复结果

## 最佳实践

1. **定期检查**: 在重大更改后运行路径检查
2. **使用服务器端检查器**: 获得最准确的结果
3. **维护文件列表**: 更新已知的有效文件列表
4. **及时修复**: 发现问题时立即修复路径引用

## 相关文档

- [PATH_MIGRATION_GUIDE.md](PATH_MIGRATION_GUIDE.md) - 路径迁移指南
- [LEGACY_DEPRECATION_PLAN.md](LEGACY_DEPRECATION_PLAN.md) - 遗留组件弃用计划

---

**更新日期**: 2025-10-01
**维护者**: 开发团队
**版本**: 1.0.0