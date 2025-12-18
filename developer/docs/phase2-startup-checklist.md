# Phase 2 启动检查清单

## ✅ 前置条件验证

### Phase 0/1 完成确认
- [x] **Phase 0 基线测试失败原因已明确**
  - ✅ `loadExamList 调用日志` - 预期行为（日志格式变化）
  - ✅ `theme-tools 组状态` - 预期行为（未点击主题切换）
  - ✅ 详细分析已写入 `phase1-complete-summary.md`

- [x] **Phase 1 全局实例归属已规划**
  - ✅ 7 个残留实例的目标归属已明确
  - ✅ 迁移策略已制定（单例/AppStateService/控制器内部）
  - ✅ 风险评估已完成（高/中/低风险标注）
  - ✅ 详细方案已写入 `global-instances-migration.md`

- [x] **Phase 2 迁移方案已锁定**
  - ✅ 5 个任务清单已制定
  - ✅ 时间规划已确定（3 天）
  - ✅ 验收标准已明确
  - ✅ 详细方案已写入 `phase2-migration-plan.md`

---

## 🚀 Phase 2 启动步骤

### 步骤1: 创建开发分支
```bash
# 创建 Phase 2 开发分支
git checkout -b refactor/main-js-phase2

# 确认当前分支
git branch
```

**预期输出**:
```
* refactor/main-js-phase2
  main
```

---

### 步骤2: 备份关键文件
```bash
# 备份 main.js
cp js/main.js js/main.js.phase1-backup

# 备份 lazyLoader.js
cp js/runtime/lazyLoader.js js/runtime/lazyLoader.js.phase1-backup

# 确认备份成功
ls -lh js/main.js* js/runtime/lazyLoader.js*
```

**预期输出**:
```
-rw-r--r--  1 user  staff   125K  Nov 28 15:00 js/main.js
-rw-r--r--  1 user  staff   125K  Nov 28 15:00 js/main.js.phase1-backup
-rw-r--r--  1 user  staff    5K   Nov 28 15:00 js/runtime/lazyLoader.js
-rw-r--r--  1 user  staff    5K   Nov 28 15:00 js/runtime/lazyLoader.js.phase1-backup
```

---

### 步骤3: 运行基线测试（确认起点）
```bash
# 运行基线测试 + CI 测试（跳过 E2E）
python3 developer/tests/run_all_tests.py --skip-e2e
```

**预期结果**:
```
[时间] ✅ Phase 0 基线测试通过 (26/28)
[时间] ✅ CI 测试通过
[时间] ℹ️ 总测试套件: 2
[时间] ℹ️ 通过: 2
[时间] ℹ️ 失败: 0
```

**如果失败**: 不要继续 Phase 2，先修复问题

---

### 步骤4: 验证 lazyLoader 顺序
```bash
# 查看 browse-view 组的加载顺序
grep -A 20 "manifest\['browse-view'\]" js/runtime/lazyLoader.js
```

**预期输出**（关键顺序）:
```javascript
manifest['browse-view'] = [
    'js/app/examActions.js',
    'js/app/state-service.js',        // ← 必须在 browseController 之前
    'js/app/browseController.js',
    'js/services/libraryManager.js',
    // ... 其他文件 ...
    'js/components/BrowseStateManager.js',  // ← 必须在 main.js 之前
    // ... 其他文件 ...
    'js/main.js'                      // ← 必须最后加载
];
```

**验证重点**:
- ✅ `state-service.js` 在 `browseController.js` 之前
- ✅ `BrowseStateManager.js` 在 `main.js` 之前
- ✅ `main.js` 最后加载

**如果顺序错误**: 先调整顺序，再继续

---

### 步骤5: 查看目标文件当前状态
```bash
# 查看 browseController.js 是否存在
ls -lh js/app/browseController.js

# 查看 examActions.js 是否存在
ls -lh js/app/examActions.js

# 查看 libraryManager.js 是否存在
ls -lh js/services/libraryManager.js
```

**预期**: 所有文件都存在

**如果文件不存在**: 需要先创建文件骨架

---

## 📋 Phase 2 任务执行顺序

### 任务1: 筛选状态读写迁移 ⏱️ 0.5天
**优先级**: 🔴 高

**步骤**:
1. [ ] 在 `browseController.js` 中创建筛选状态管理方法
2. [ ] 连接到 `AppStateService.setBrowseFilter()`
3. [ ] 在 main.js 中创建 shim 转发
4. [ ] 运行测试: `python3 developer/tests/run_all_tests.py --skip-e2e`
5. [ ] file:// 手测筛选功能

**验收标准**:
- [ ] 筛选按钮点击正常工作
- [ ] 筛选状态正确保存到 AppStateService
- [ ] 题库列表根据筛选条件正确渲染
- [ ] 基线测试通过

---

### 任务2: 列表渲染与交互迁移 ⏱️ 1天
**优先级**: 🔴 高

**步骤**:
1. [ ] 在 `examActions.js` 中实现列表渲染逻辑
2. [ ] 连接到 `AppStateService.getFilteredExams()`
3. [ ] 更新 `examListViewInstance` 归属到 `browseController.js`
4. [ ] 在 main.js 中创建 shim 转发
5. [ ] 运行测试: `python3 developer/tests/run_all_tests.py --skip-e2e`
6. [ ] file:// 手测列表渲染

**验收标准**:
- [ ] 题库列表正常渲染（40+ 个题目）
- [ ] 题库卡片点击正常工作
- [ ] 排序和筛选功能正常
- [ ] 基线测试通过

---

### 任务3: 题库配置与切换迁移 ⏱️ 0.5天
**优先级**: 🟡 中

**步骤**:
1. [ ] 确认 `libraryManager.js` 已有完整实现
2. [ ] 在 main.js 中创建 shim 转发
3. [ ] 运行测试: `python3 developer/tests/run_all_tests.py --skip-e2e`
4. [ ] file:// 手测题库切换

**验收标准**:
- [ ] 题库切换功能正常工作
- [ ] 题库配置正确保存
- [ ] 基线测试通过

---

### 任务4: 校正 lazyLoader 顺序 ⏱️ 0.5天
**优先级**: 🔴 高

**步骤**:
1. [ ] 验证当前 browse-view 组加载顺序
2. [ ] 如有问题，调整顺序
3. [ ] 运行测试: `python3 developer/tests/run_all_tests.py --skip-e2e`
4. [ ] file:// 手测懒加载

**验收标准**:
- [ ] state-service.js 在 browseController.js 之前
- [ ] BrowseStateManager.js 在 main.js 之前
- [ ] main.js 最后加载
- [ ] 基线测试通过

---

### 任务5: 全局实例迁移 ⏱️ 0.5天
**优先级**: 🔴 高

**步骤**:
1. [ ] 迁移 `browseStateManager` 到单例模式
2. [ ] 迁移 `examListViewInstance` 到 browseController
3. [ ] 在 main.js 中创建兼容层
4. [ ] 运行测试: `python3 developer/tests/run_all_tests.py --skip-e2e`
5. [ ] file:// 手测全局实例访问

**验收标准**:
- [ ] `browseStateManager` 通过单例访问
- [ ] `examListViewInstance` 通过 controller 访问
- [ ] 向后兼容性保持
- [ ] 基线测试通过

---

## 🧪 每个任务完成后必须执行

### 快速验证（必须）
```bash
# 运行基线测试 + CI 测试
python3 developer/tests/run_all_tests.py --skip-e2e
```

### file:// 手测（必须）
1. 打开 `index.html` (file:// 协议)
2. 清除缓存和 localStorage
3. 测试相关功能（筛选/列表/配置等）
4. 检查控制台无新增错误

### 完整测试（可选，任务2/5后推荐）
```bash
# 运行所有测试（包括 E2E）
python3 developer/tests/run_all_tests.py
```

---

## ⚠️ 中止条件

如果出现以下情况，立即中止 Phase 2 开发：

### 🔴 严重问题（必须中止）
- [ ] 基线测试失败超过 5 项
- [ ] 出现 Uncaught ReferenceError 或 TypeError
- [ ] 页面无法加载或白屏
- [ ] 懒加载组加载失败
- [ ] 题库列表无法渲染

### 🟡 警告问题（评估后决定）
- [ ] 基线测试失败 3-5 项
- [ ] 控制台出现新的警告
- [ ] 某些功能响应变慢
- [ ] 筛选功能部分失效

**中止后行动**:
1. 回滚到 Phase 1 备份
2. 分析问题根因
3. 调整迁移策略
4. 重新开始 Phase 2

---

## 📊 Phase 2 完成标准

### 功能完成
- [ ] 所有 5 个任务完成
- [ ] 题库筛选功能正常
- [ ] 题库列表正常渲染
- [ ] 题库配置切换正常
- [ ] 全局实例迁移完成

### 测试通过
- [ ] 基线测试通过（26/28 或更好）
- [ ] CI 测试通过
- [ ] file:// 手测无回归
- [ ] 无新增控制台错误

### 代码质量
- [ ] main.js 中浏览相关函数减少 45+ 个
- [ ] 所有迁移函数有 shim 转发
- [ ] 懒加载顺序正确
- [ ] 代码注释清晰标注 Phase 2

### 文档更新
- [ ] 更新 `mainjs-refactor-plan.md` 标记 Phase 2 完成
- [ ] 创建 `phase2-complete-summary.md`
- [ ] 更新 `global-instances-migration.md` 进度

---

## 🎯 Phase 2 完成后行动

### 1. 提交代码
```bash
# 查看变更
git status
git diff js/main.js

# 提交
git add .
git commit -m "Phase 2: 题库浏览与题库配置模块化

- 迁移筛选状态到 browseController + AppStateService
- 迁移列表渲染到 examActions
- 迁移题库配置到 libraryManager
- 迁移 browseStateManager 和 examListViewInstance
- 验证 lazyLoader 顺序
- 基线测试通过 (26/28)
- CI 测试通过"
```

### 2. 运行完整测试
```bash
# 运行所有测试（包括 E2E）
python3 developer/tests/run_all_tests.py
```

### 3. 创建 Phase 2 完成总结
```bash
# 创建总结文档
# developer/docs/phase2-complete-summary.md
```

### 4. 准备 Phase 3
```bash
# 查看 Phase 3 任务清单
cat developer/docs/mainjs-refactor-plan.md | grep -A 10 "阶段3"
```

---

## 📞 需要帮助？

如果在 Phase 2 执行过程中遇到问题：

1. **查看文档**:
   - `phase2-migration-plan.md` - 详细迁移方案
   - `global-instances-migration.md` - 全局实例归属
   - `testing-guide.md` - 测试运行指南

2. **检查日志**:
   - 浏览器控制台日志
   - `developer/logs/phase0-baseline-*.log`
   - 测试报告 JSON

3. **回滚方案**:
   ```bash
   # 恢复备份
   cp js/main.js.phase1-backup js/main.js
   cp js/runtime/lazyLoader.js.phase1-backup js/runtime/lazyLoader.js
   
   # 运行测试确认
   python3 developer/tests/run_all_tests.py --skip-e2e
   ```

---

**文档版本**: v1.0  
**创建时间**: 2025-11-28 15:02  
**维护者**: Antigravity AI  
**状态**: ✅ 检查清单已就绪，等待用户确认启动 Phase 2
