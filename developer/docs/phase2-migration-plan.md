# Phase 2 迁移方案：全局实例归属与浏览模块化

## 🎯 Phase 2 目标

**题库浏览与题库配置模块化**

---

## 📋 全局实例迁移计划

### Phase 1 残留的全局实例（7个）

以下实例当前仍在 `js/main.js` 中，必须在 Phase 2-3 迁移：

#### 1. 浏览相关实例（Phase 2 处理）

| 实例名 | 当前位置 | 目标归属 | 迁移方式 | 风险等级 |
|--------|---------|---------|---------|---------|
| `browseStateManager` | main.js | `js/components/BrowseStateManager.js` | 单例模式，通过 `BrowseStateManager.getInstance()` 访问 | 低 |
| `examListViewInstance` | main.js | `js/app/browseController.js` | 内部私有变量，通过 controller 方法访问 | 中 |

**迁移策略**:
```javascript
// browseStateManager - 已有单例实现
// 在 main.js 中改为：
Object.defineProperty(window, 'browseStateManager', {
    get: function() {
        if (window.BrowseStateManager && typeof window.BrowseStateManager.getInstance === 'function') {
            return window.BrowseStateManager.getInstance();
        }
        return null;
    },
    configurable: true
});

// examListViewInstance - 迁移到 browseController
// 在 browseController.js 中：
let examListViewInstance = null;
export function getExamListView() {
    return examListViewInstance;
}
export function setExamListView(instance) {
    examListViewInstance = instance;
}
```

---

#### 2. 练习相关实例（Phase 3 处理）

| 实例名 | 当前位置 | 目标归属 | 迁移方式 | 风险等级 |
|--------|---------|---------|---------|---------|
| `practiceDashboardViewInstance` | main.js | `js/components/PracticeDashboardView.js` | 单例模式，通过 `PracticeDashboardView.getInstance()` 访问 | 低 |
| `practiceListScroller` | main.js | `js/components/PracticeHistoryEnhancer.js` | 内部私有变量，通过 enhancer 方法访问 | 低 |

**迁移策略**:
```javascript
// practiceDashboardViewInstance - 单例模式
Object.defineProperty(window, 'practiceDashboardViewInstance', {
    get: function() {
        if (window.PracticeDashboardView && typeof window.PracticeDashboardView.getInstance === 'function') {
            return window.PracticeDashboardView.getInstance();
        }
        return null;
    },
    configurable: true
});

// practiceListScroller - 迁移到 PracticeHistoryEnhancer
// 在 PracticeHistoryEnhancer 中：
let practiceListScroller = null;
function getScroller() {
    return practiceListScroller;
}
function setScroller(scroller) {
    practiceListScroller = scroller;
}
```

---

#### 3. PDF/导航相关实例（Phase 4 处理）

| 实例名 | 当前位置 | 目标归属 | 迁移方式 | 风险等级 |
|--------|---------|---------|---------|---------|
| `pdfHandler` | main.js | `js/components/PDFHandler.js` | 单例模式，通过 `PDFHandler.getInstance()` 访问 | 低 |
| `legacyNavigationController` | main.js | `js/presentation/navigation-controller.js` | 单例模式，通过 `NavigationController.getInstance()` 访问 | 中 |

**迁移策略**:
```javascript
// pdfHandler - 单例模式
Object.defineProperty(window, 'pdfHandler', {
    get: function() {
        if (window.PDFHandler && typeof window.PDFHandler.getInstance === 'function') {
            return window.PDFHandler.getInstance();
        }
        return null;
    },
    configurable: true
});

// legacyNavigationController - 单例模式
Object.defineProperty(window, 'legacyNavigationController', {
    get: function() {
        if (window.NavigationController && typeof window.NavigationController.getInstance === 'function') {
            return window.NavigationController.getInstance();
        }
        return null;
    },
    configurable: true
});
```

---

#### 4. 应用主实例（Phase 1 已处理）

| 实例名 | 当前位置 | 目标归属 | 迁移方式 | 风险等级 |
|--------|---------|---------|---------|---------|
| `app` | main.js | `js/app.js` + `js/app/main-entry.js` | 唯一入口，main.js 仅 shim | 低 |

**当前状态**:
```javascript
// main.js 中保留向后兼容
let app = null;

// 实际实例由 app.js 创建
// main-entry.js 确保初始化
```

**Phase 2 行动**: 无需额外迁移，保持现状

---

## 🔧 Phase 2 详细任务清单

### 任务1: 筛选状态读写迁移 ⏱️ 0.5天

**目标**: 将筛选状态管理从 main.js 迁移到 `browseController.js` + `state-service.js`

**涉及函数**（~15个）:
- `setBrowseFilterState(category, type)`
- `getCurrentCategory()`
- `getCurrentExamType()`
- `updateBrowseTitle()`
- `clearPendingBrowseAutoScroll()`
- `applyBrowseFilter(category, type)`
- `resetBrowseFilter()`
- ... 等

**迁移步骤**:
1. 在 `browseController.js` 中创建筛选状态管理方法
2. 连接到 `AppStateService.setBrowseFilter()`
3. 在 main.js 中创建 shim 转发
4. 更新 HTML onclick 调用（如有）

**验收标准**:
- ✅ 筛选按钮点击正常工作
- ✅ 筛选状态正确保存到 AppStateService
- ✅ 题库列表根据筛选条件正确渲染
- ✅ 基线测试通过

---

### 任务2: 列表渲染与交互迁移 ⏱️ 1天

**目标**: 将列表渲染逻辑从 main.js 迁移到 `examActions.js`

**涉及函数**（~20个）:
- `loadExamList()` - 已在 main-entry.js 代理
- `renderExamList(exams)`
- `createExamCard(exam)`
- `handleExamClick(examId)`
- `updateExamListUI()`
- `sortExamList(criteria)`
- `filterExamList(filter)`
- ... 等

**迁移步骤**:
1. 在 `examActions.js` 中实现列表渲染逻辑
2. 连接到 `AppStateService.getFilteredExams()`
3. 更新 `examListViewInstance` 归属到 `browseController.js`
4. 在 main.js 中创建 shim 转发

**验收标准**:
- ✅ 题库列表正常渲染
- ✅ 题库卡片点击正常工作
- ✅ 排序和筛选功能正常
- ✅ 基线测试通过（题库列表渲染 40+ 个题目）

---

### 任务3: 题库配置与切换迁移 ⏱️ 0.5天

**目标**: 将题库配置逻辑从 main.js 迁移到 `libraryManager.js`

**涉及函数**（~10个）:
- `switchLibraryConfig(configId)`
- `loadLibrary(libraryId)`
- `getLibraryManager()` - 已在 Phase 1 处理
- `ensureLibraryManagerReady()` - 已在 Phase 1 处理
- `updateLibraryUI()`
- ... 等

**迁移步骤**:
1. 确认 `libraryManager.js` 已有完整实现
2. 在 main.js 中创建 shim 转发
3. 更新 HTML onclick 调用（如有）

**验收标准**:
- ✅ 题库切换功能正常工作
- ✅ 题库配置正确保存
- ✅ 基线测试通过

---

### 任务4: 校正 lazyLoader 顺序 ⏱️ 0.5天

**目标**: 确保 browse-view 组的加载顺序正确

**当前顺序** (`js/runtime/lazyLoader.js`):
```javascript
manifest['browse-view'] = [
    'js/app/examActions.js',
    'js/app/state-service.js',
    'js/app/browseController.js',
    'js/services/libraryManager.js',
    'js/presentation/message-center.js',
    'js/runtime/legacy-state-adapter.js',
    'js/components/PDFHandler.js',
    'js/components/SystemDiagnostics.js',
    'js/components/PerformanceOptimizer.js',
    'js/components/DataIntegrityManager.js',
    'js/components/BrowseStateManager.js',
    'js/utils/dataConsistencyManager.js',
    'js/utils/answerComparisonUtils.js',
    'js/utils/BrowsePreferencesUtils.js',
    'js/main.js'  // ← 最后加载
];
```

**验证重点**:
- ✅ `state-service.js` 在 `browseController.js` 之前
- ✅ `BrowseStateManager.js` 在 `main.js` 之前
- ✅ `main.js` 最后加载（提供 shim）

**行动**: 如果顺序正确，无需修改；如果不正确，调整顺序

---

### 任务5: 全局实例迁移（Phase 2 部分）⏱️ 0.5天

**目标**: 迁移 `browseStateManager` 和 `examListViewInstance`

**步骤**:

#### 5.1 迁移 `browseStateManager`
```javascript
// 在 main.js 中替换为：
Object.defineProperty(window, 'browseStateManager', {
    get: function() {
        if (window.BrowseStateManager && typeof window.BrowseStateManager.getInstance === 'function') {
            return window.BrowseStateManager.getInstance();
        }
        console.warn('[main.js] BrowseStateManager 未加载');
        return null;
    },
    configurable: true
});
```

#### 5.2 迁移 `examListViewInstance`
```javascript
// 在 browseController.js 中添加：
let examListViewInstance = null;

export function getExamListView() {
    return examListViewInstance;
}

export function setExamListView(instance) {
    examListViewInstance = instance;
    return instance;
}

// 在 main.js 中创建兼容层：
Object.defineProperty(window, 'examListViewInstance', {
    get: function() {
        if (window.BrowseController && typeof window.BrowseController.getExamListView === 'function') {
            return window.BrowseController.getExamListView();
        }
        return null;
    },
    set: function(value) {
        if (window.BrowseController && typeof window.BrowseController.setExamListView === 'function') {
            window.BrowseController.setExamListView(value);
        }
    },
    configurable: true
});
```

---

## 📊 Phase 2 验收标准

### 功能验收
- [ ] 题库筛选功能正常（分类/类型切换）
- [ ] 题库列表正常渲染（40+ 个题目）
- [ ] 题库卡片点击正常工作
- [ ] 题库配置切换正常
- [ ] 浏览状态正确保存到 AppStateService
- [ ] `browseStateManager` 通过单例访问
- [ ] `examListViewInstance` 通过 controller 访问

### 测试验收
- [ ] 基线测试通过（26/28 或更好）
- [ ] CI 测试通过
- [ ] file:// 手测无回归
- [ ] 无新增控制台错误

### 代码质量验收
- [ ] main.js 中浏览相关函数减少 45+ 个
- [ ] 所有迁移函数有 shim 转发
- [ ] 懒加载顺序正确
- [ ] 代码注释清晰标注 Phase 2

---

## ⚠️ 风险点与缓解措施

### 风险1: 筛选逻辑复杂，易出错
**缓解**: 
- 先迁移简单的筛选函数
- 每迁移一个函数立即测试
- 保留详细的 shim 日志

### 风险2: examListViewInstance 被多处引用
**缓解**:
- 使用 `Object.defineProperty` 确保向后兼容
- 在 browseController 中集中管理
- 添加 getter/setter 日志追踪访问

### 风险3: 懒加载顺序错误导致 undefined
**缓解**:
- 在 Phase 2 开始前验证当前顺序
- 使用 `typeof` 检查避免 ReferenceError
- 添加降级处理

---

## 📅 Phase 2 时间规划

| 任务 | 预计时间 | 优先级 |
|------|---------|--------|
| 任务1: 筛选状态迁移 | 0.5天 | 高 |
| 任务2: 列表渲染迁移 | 1天 | 高 |
| 任务3: 题库配置迁移 | 0.5天 | 中 |
| 任务4: lazyLoader 顺序 | 0.5天 | 高 |
| 任务5: 全局实例迁移 | 0.5天 | 高 |
| **总计** | **3天** | - |

---

## 🚀 Phase 2 启动检查清单

开始 Phase 2 前必须确认：

- [x] Phase 0 基线测试失败原因已明确（预期行为）
- [x] Phase 1 全局实例归属已规划
- [x] Phase 2 迁移方案已制定
- [ ] 创建 Phase 2 开发分支
- [ ] 备份当前 main.js
- [ ] 运行基线测试确认起点

**启动命令**:
```bash
# 创建开发分支
git checkout -b refactor/main-js-phase2

# 备份 main.js
cp js/main.js js/main.js.phase1-backup

# 运行基线测试
python3 developer/tests/run_all_tests.py --skip-e2e
```

---

**文档版本**: v1.0  
**创建时间**: 2025-11-28 15:02  
**维护者**: Antigravity AI  
**状态**: ✅ 方案已锁定，等待用户确认启动
