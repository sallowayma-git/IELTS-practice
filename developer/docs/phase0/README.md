# Phase 0 文档索引

本目录包含 Phase 0（基线盘点与安全阀）的所有文档。

## 📋 核心文档

### 1. [inventory.md](./inventory.md)
**全局变量/函数归属清单**
- 140+ 函数归属清单
- 10 个全局变量迁移目标
- 10 大功能模块分类
- 12 个必须保留的全局 API 标注

### 2. [dependency-diagram.md](./dependency-diagram.md)
**加载顺序与依赖关系图**
- 6 类可视化依赖图（Mermaid 格式）
- 加载时序图
- 模块依赖关系图
- 函数迁移流向图
- 懒加载触发点流程图
- 全局 API 兼容层映射图
- 阶段化迁移路线图

### 3. [baseline-test-manual.md](./baseline-test-manual.md)
**基线测试手册（手动测试版）**
- 7 个测试项详细步骤
- 预期结果和异常行为识别
- 测试记录表格
- 日志保存方法

### 4. [checklist.md](./checklist.md)
**快速检查清单**
- 已完成项汇总
- 待执行项（基线测试）
- 下一步行动指南
- 文档快速链接

### 5. [summary.md](./summary.md)
**阶段0完成总结**
- 已完成工作汇总
- 待用户执行任务
- 下一步行动建议
- 关键数据统计

### 6. [complete-summary.md](./complete-summary.md)
**Phase 0 完成 + 测试优化总结**
- 完整工作总结
- 测试覆盖率统计
- 新增文件清单
- 下一步行动计划

## 🧪 测试相关

### 自动化测试脚本
- `developer/tests/baseline/phase0_baseline_playwright.py` - Playwright 基线测试
- `developer/tests/run_all_tests.py` - 统一测试运行器

### 测试指南
- `developer/docs/testing-guide.md` - 测试运行快速指南

## 📊 报告位置

### 测试报告
- `developer/tests/baseline/reports/` - 基线测试报告
- `developer/tests/e2e/reports/` - E2E 测试报告
- `developer/tests/reports/` - 综合测试报告

### 日志
- `developer/logs/` - 基线测试文本日志

## 🎯 快速开始

### 查看归属清单
```bash
cat developer/docs/phase0/inventory.md
```

### 查看依赖图
```bash
cat developer/docs/phase0/dependency-diagram.md
```

### 运行基线测试
```bash
python developer/tests/baseline/phase0_baseline_playwright.py
```

### 运行所有测试
```bash
python developer/tests/run_all_tests.py
```

## 📚 相关文档

- **重构计划**: `developer/docs/mainjs-refactor-plan.md`
- **测试指南**: `developer/docs/testing-guide.md`

---

**状态**: ✅ Phase 0 完成  
**更新时间**: 2025-11-28  
**维护者**: Antigravity AI
