# 全局实例迁移总览

## 📊 7个全局实例的完整归属规划

| # | 实例名 | 当前位置 | 目标归属 | 迁移阶段 | 迁移方式 | 风险 | 状态 |
|---|--------|---------|---------|---------|---------|------|------|
| 1 | `fallbackExamSessions` | main.js | `AppStateService` | Phase 1 | Object.defineProperty getter/setter | 低 | ✅ 已完成 |
| 2 | `processedSessions` | main.js | `AppStateService` | Phase 1 | Object.defineProperty getter | 低 | ✅ 已完成 |
| 3 | `browseStateManager` | main.js | `BrowseStateManager.getInstance()` | Phase 2 | Object.defineProperty getter | 低 | ⏳ 待迁移 |
| 4 | `examListViewInstance` | main.js | `browseController.js` 内部变量 | Phase 2 | Object.defineProperty getter/setter | 中 | ⏳ 待迁移 |
| 5 | `practiceDashboardViewInstance` | main.js | `PracticeDashboardView.getInstance()` | Phase 3 | Object.defineProperty getter | 低 | ⏳ 待迁移 |
| 6 | `practiceListScroller` | main.js | `PracticeHistoryEnhancer` 内部变量 | Phase 3 | 内部私有，移除全局访问 | 低 | ⏳ 待迁移 |
| 7 | `pdfHandler` | main.js | `PDFHandler.getInstance()` | Phase 4 | Object.defineProperty getter | 低 | ⏳ 待迁移 |
| 8 | `legacyNavigationController` | main.js | `NavigationController.getInstance()` | Phase 4 | Object.defineProperty getter | 中 | ⏳ 待迁移 |
| 9 | `app` | main.js | `app.js` + `main-entry.js` | Phase 1 | 保持现状，main.js 仅 shim | 低 | ✅ 已处理 |

---

## 🎯 迁移策略分类

### 策略A: 单例模式迁移（5个实例）
适用于: `browseStateManager`, `practiceDashboardViewInstance`, `pdfHandler`, `legacyNavigationController`

**模式**:
```javascript
// 在 main.js 中
Object.defineProperty(window, 'instanceName', {
    get: function() {
        if (window.ClassName && typeof window.ClassName.getInstance === 'function') {
            return window.ClassName.getInstance();
        }
        console.warn('[main.js] ClassName 未加载');
        return null;
    },
    configurable: true
});
```

**优势**:
- ✅ 完全向后兼容
- ✅ 自动降级支持
- ✅ 单一实例保证

---

### 策略B: AppStateService 迁移（2个实例）
适用于: `fallbackExamSessions`, `processedSessions`

**模式**:
```javascript
// 在 main.js 中
Object.defineProperty(window, 'stateName', {
    get: function() {
        if (window.appStateService) {
            return window.appStateService.getStateName();
        }
        // 降级
        if (!window.__legacyStateName) {
            window.__legacyStateName = new Map(); // 或 new Set()
        }
        return window.__legacyStateName;
    },
    set: function(value) {
        if (window.appStateService) {
            window.appStateService.setStateName(value);
        } else {
            window.__legacyStateName = value;
        }
    },
    configurable: true
});
```

**优势**:
- ✅ 集中状态管理
- ✅ 支持订阅/通知
- ✅ 持久化支持

---

### 策略C: 控制器内部变量（2个实例）
适用于: `examListViewInstance`, `practiceListScroller`

**模式**:
```javascript
// 在目标控制器中
let internalInstance = null;

export function getInstance() {
    return internalInstance;
}

export function setInstance(instance) {
    internalInstance = instance;
    return instance;
}

// 在 main.js 中（可选兼容层）
Object.defineProperty(window, 'instanceName', {
    get: function() {
        if (window.ControllerName && typeof window.ControllerName.getInstance === 'function') {
            return window.ControllerName.getInstance();
        }
        return null;
    },
    set: function(value) {
        if (window.ControllerName && typeof window.ControllerName.setInstance === 'function') {
            window.ControllerName.setInstance(value);
        }
    },
    configurable: true
});
```

**优势**:
- ✅ 封装性好
- ✅ 减少全局污染
- ✅ 便于单元测试

---

## 📅 迁移时间线

```
Phase 1 (已完成) ✅
├─ fallbackExamSessions → AppStateService
├─ processedSessions → AppStateService
└─ app → 保持现状

Phase 2 (3天) ⏳
├─ browseStateManager → BrowseStateManager.getInstance()
└─ examListViewInstance → browseController 内部变量

Phase 3 (4-5天) 📅
├─ practiceDashboardViewInstance → PracticeDashboardView.getInstance()
└─ practiceListScroller → PracticeHistoryEnhancer 内部变量

Phase 4 (2-3天) 📅
├─ pdfHandler → PDFHandler.getInstance()
└─ legacyNavigationController → NavigationController.getInstance()
```

---

## ⚠️ 关键风险与缓解

### 风险矩阵

| 实例 | 引用频率 | 依赖复杂度 | 测试覆盖 | 综合风险 | 缓解措施 |
|------|---------|-----------|---------|---------|---------|
| `fallbackExamSessions` | 低 | 低 | 高 | 低 ✅ | 已完成，AppStateService 管理 |
| `processedSessions` | 低 | 低 | 高 | 低 ✅ | 已完成，AppStateService 管理 |
| `browseStateManager` | 中 | 中 | 中 | 中 ⚠️ | 单例模式 + 详细日志 |
| `examListViewInstance` | 高 | 高 | 中 | 高 🔴 | 分步迁移 + 充分测试 |
| `practiceDashboardViewInstance` | 中 | 中 | 中 | 中 ⚠️ | 单例模式 + 详细日志 |
| `practiceListScroller` | 低 | 低 | 低 | 低 ✅ | 内部私有化 |
| `pdfHandler` | 低 | 低 | 中 | 低 ✅ | 单例模式 |
| `legacyNavigationController` | 中 | 高 | 中 | 中 ⚠️ | 单例模式 + 充分测试 |
| `app` | 高 | 高 | 高 | 中 ⚠️ | 保持现状，已有完善实现 |

### 高风险实例处理

#### `examListViewInstance` (风险: 高 🔴)

**风险原因**:
- 被多处代码引用
- 涉及复杂的列表渲染逻辑
- 与筛选、排序、懒加载紧密耦合

**缓解措施**:
1. **分步迁移**: 先迁移 getter，再迁移 setter
2. **详细日志**: 记录每次访问和修改
3. **充分测试**: 每步迁移后运行完整测试
4. **降级支持**: 保留临时兼容层直到 Phase 2 完成

**迁移步骤**:
```javascript
// Step 1: 在 browseController.js 中创建管理方法
let examListViewInstance = null;
export function getExamListView() {
    console.log('[browseController] getExamListView called');
    return examListViewInstance;
}
export function setExamListView(instance) {
    console.log('[browseController] setExamListView called', instance);
    examListViewInstance = instance;
    return instance;
}

// Step 2: 在 main.js 中创建兼容层
Object.defineProperty(window, 'examListViewInstance', {
    get: function() {
        if (window.BrowseController && typeof window.BrowseController.getExamListView === 'function') {
            return window.BrowseController.getExamListView();
        }
        console.warn('[main.js] BrowseController 未加载，返回 null');
        return null;
    },
    set: function(value) {
        if (window.BrowseController && typeof window.BrowseController.setExamListView === 'function') {
            window.BrowseController.setExamListView(value);
        } else {
            console.warn('[main.js] BrowseController 未加载，无法设置 examListViewInstance');
        }
    },
    configurable: true
});

// Step 3: 测试验证
// - 运行基线测试
// - 手动测试题库列表渲染
// - 检查控制台日志

// Step 4: 移除临时日志（Phase 2 完成后）
```

---

## 📊 进度追踪

### Phase 1 (已完成) ✅
- [x] `fallbackExamSessions` 迁移到 AppStateService
- [x] `processedSessions` 迁移到 AppStateService
- [x] `app` 实例保持现状
- [x] 基线测试通过 (26/28)
- [x] CI 测试通过

### Phase 2 (进行中) ⏳
- [ ] `browseStateManager` 迁移到单例
- [ ] `examListViewInstance` 迁移到 browseController
- [ ] 筛选状态迁移
- [ ] 列表渲染迁移
- [ ] 题库配置迁移
- [ ] lazyLoader 顺序验证
- [ ] 基线测试通过
- [ ] CI 测试通过

### Phase 3 (计划中) 📅
- [ ] `practiceDashboardViewInstance` 迁移到单例
- [ ] `practiceListScroller` 迁移到 PracticeHistoryEnhancer
- [ ] 练习记录相关函数迁移
- [ ] 基线测试通过
- [ ] CI 测试通过

### Phase 4 (计划中) 📅
- [ ] `pdfHandler` 迁移到单例
- [ ] `legacyNavigationController` 迁移到单例
- [ ] PDF/导航相关函数迁移
- [ ] 基线测试通过
- [ ] CI 测试通过

---

## 🎯 最终目标

### main.js 最终状态（Phase 5 完成后）

```javascript
// main.js - 仅保留兼容层和 shim

// ============================================================================
// 全局实例兼容层（所有实例通过 Object.defineProperty 代理）
// ============================================================================

// browseStateManager → BrowseStateManager.getInstance()
// examListViewInstance → BrowseController.getExamListView()
// practiceDashboardViewInstance → PracticeDashboardView.getInstance()
// pdfHandler → PDFHandler.getInstance()
// legacyNavigationController → NavigationController.getInstance()
// fallbackExamSessions → appStateService.getFallbackExamSessions()
// processedSessions → appStateService.getProcessedSessions()

// ============================================================================
// 函数 Shim 层（所有函数转发到目标模块）
// ============================================================================

// Boot/Ensure 函数 → main-entry.js
// 浏览/筛选函数 → browseController.js / examActions.js
// 练习记录函数 → practiceHistoryEnhancer.js
// 题库配置函数 → libraryManager.js
// PDF 处理函数 → PDFHandler.js
// 导航函数 → navigation-controller.js

// ============================================================================
// 预计 main.js 最终大小: ~500 行（从 3370 行减少 85%）
// ============================================================================
```

---

**文档版本**: v1.0  
**创建时间**: 2025-11-28 15:02  
**维护者**: Antigravity AI  
**状态**: ✅ 迁移规划已锁定
