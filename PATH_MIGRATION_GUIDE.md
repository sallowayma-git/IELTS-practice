# 路径迁移指南

## 概述

本文件记录了组件路径从 `js/components/` 迁移到 `js/legacy/` 的变更。

## 变更内容

### 迁移的组件

以下组件已从 `js/components/` 迁移到 `js/legacy/`：

1. **IndexValidator.js** → `js/legacy/IndexValidator.js`
2. **CommunicationTester.js** → `js/legacy/CommunicationTester.js`
3. **ErrorFixer.js** → `js/legacy/ErrorFixer.js`
4. **CommunicationRecovery.js** → `js/legacy/CommunicationRecovery.js`
5. **PerformanceOptimizer.js** → `js/legacy/PerformanceOptimizer.js`
6. **BrowseStateManager.js** → `js/legacy/BrowseStateManager.js`
7. **practiceRecordModal.js** → `js/legacy/practiceRecordModal.js`
8. **practiceHistoryEnhancer.js** → `js/legacy/practiceHistoryEnhancer.js`

### 保留在 js/components/ 的组件

以下组件仍保留在 `js/components/` 目录：

1. **PDFHandler.js** - 核心PDF处理功能
2. **DataIntegrityManager.js** - 数据完整性管理
3. **systemMaintenancePanel.js** - 系统维护面板

## 影响范围

### 更新的文件

#### 主题页面
- `.superdesign/design_iterations/ielts_academic_functional_2.html`
- `.superdesign/design_iterations/HP/practice.html`
- `.superdesign/design_iterations/HP/Welcome.html`
- `.superdesign/design_iterations/HP/setting.html`
- `.superdesign/design_iterations/my_melody_ielts_1.html`

#### 文档文件
- `SCRIPT_OWNERSHIP.md`
- `docs/hp_fix_audit.md`
- `docs/hp_requirements_refined.md`
- `CLEANUP_REPORT.md`

## 迁移原因

1. **架构整理**: 将主题页面特定的组件与核心组件分离
2. **向后兼容**: 提供存根文件避免主题页面功能中断
3. **清晰分类**: 明确区分核心组件和遗留组件

## 存根文件说明

迁移到 `js/legacy/` 的组件目前为存根文件，提供基本的接口以避免页面错误：

```javascript
/**
 * ComponentName - 主题页面存根
 * 原组件已迁移或弃用，此文件仅为向后兼容保留
 */

(function() {
    'use strict';

    console.log('[ComponentName] Legacy stub loaded - component has been migrated or deprecated');

    window.ComponentName = {
        init: function() {
            console.warn('[ComponentName] Legacy stub - functionality not available');
        }
    };

})();
```

## 未来计划

1. **功能迁移**: 评估主题页面实际需要的功能，考虑重新实现或迁移到新架构
2. **逐步弃用**: 在确认主题页面不再需要这些组件后，可以完全移除
3. **文档更新**: 继续更新相关文档以反映最新的架构

## 注意事项

- 核心页面（`index.html`, `test_file_protocol.html`）不受此迁移影响
- 测试框架已通过 `tests/compat-shims.js` 提供兼容层
- 新的开发应优先使用 `js/stores/` 和 `js/ui/` 中的组件

---

**更新日期**: 2025-10-01
**相关任务**: Task 51, Task 52, Task 53