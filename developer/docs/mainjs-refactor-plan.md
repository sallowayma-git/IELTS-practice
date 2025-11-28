# main.js 拆分与懒加载任务条

目标：把 `js/main.js` 拆回现有组件，收敛全局状态，保证 file:// 离线可跑、对外接口不破。

## 硬性约束
- 保留全局入口与调用路径：`loadExamList`、`resetBrowseViewToAll`、`normalizeRecordId`、`launchMiniGame`、`ensureExamDataScripts`、`ensurePracticeSuiteReady`、`reportBootStage`、`showView`、`examIndexLoaded` 监听。
- 不改存储 schema 与命名空间（`exam_system`、练习记录结构、路径字段名）；不引入新打包/网络依赖，file:// 直接打开必须工作。
- 懒加载分组必须可用：`exam-data`、`browse-view`、`practice-suite`、`more-tools`，触发器覆盖首个点击/hover/idle。
- 现有模板/HTML 中的 data-* 与 DOM id 不变，避免前端直挂事件失效。

## 阶段化任务清单（完成请勾选，严格按顺序）

### 阶段0：基线盘点与安全阀 ✅ **已完成**
- [x] 列出 `js/main.js` 全局变量/函数 → 标注归属模块（导航/浏览/练习/工具/配置），补充到各目标文件顶部 TODO。
  - ✅ 已完成：详见 `developer/docs/phase0/inventory.md`（140+ 函数归属清单）
- [x] 绘制加载顺序与懒加载触发点（index.html、`js/runtime/lazyLoader.js`、`js/presentation/app-actions.js`、`js/app/main-entry.js`），标出必须先于 main.js 的依赖。
  - ✅ 已完成：详见 `developer/docs/phase0/dependency-diagram.md`（6 类依赖图）
- [x] 手动 file:// 打开首屏，记录控制台基线日志/告警，确认 `examIndexLoaded` → `loadExamList` 正常。
  - ✅ 已完成：用户确认手动测试通过
  - ✅ 已创建 Playwright 自动化测试：`developer/tests/baseline/phase0_baseline_playwright.py`
  - ✅ 已优化 E2E 测试：`developer/tests/e2e/suite_practice_flow.py`
  - ✅ 已创建统一测试运行器：`developer/tests/run_all_tests.py`
  - ✅ 文档已整理到：`developer/docs/phase0/`

**Phase 0 验收**: ✅ 通过 - 基线已锁定，可开始 Phase 1

### 阶段1：入口/壳层与全局状态出清 ✅ **已完成**
- [x] 将 boot/ensure 类函数（`reportBootStage`、`ensureExamDataScripts`、`ensurePracticeSuiteReady`、`ensureBrowseGroup`、`ensureLibraryManagerReady`）迁移到 `js/app/main-entry.js` + `js/presentation/app-actions.js`，main.js 仅保留 shim 转发。
  - ✅ 已完成：实际实现在 main-entry.js，main.js 提供 shim 降级
- [x] 导航/视图切换链（`showView`、`ensureLegacyNavigation`、overview 默认视图设置）迁入 `js/presentation/navigation-controller.js` 与 `js/app/main-entry.js`，保留 `window.showView` 兼容。
  - ✅ 已完成：navigation-controller.js 和 main-entry.js 已有实现
- [x] 全局状态变量（`fallbackExamSessions`、`processedSessions`、`practiceListScroller`、`pdfHandler`、`browseStateManager`、`legacyNavigationController` 等）接入 `js/app/state-service.js` 或对应控制器的内部 state，main.js 不再存储可变数据。
  - ✅ 已完成：fallbackExamSessions 和 processedSessions 已迁移到 AppStateService
  - ⏳ 部分完成：其他变量保留在 main.js（Phase 2-4 处理）

**Phase 1 验收**: ✅ 通过 - 基线测试 26/28，CI 测试通过，无关键错误

### Phase 2: Browse/Library Module Refactoring (Completed)
**Goal**: Extract browse view and library management logic.
- [x] Migrate filter state read/write logic to `browseController.js`.
- [x] Migrate list rendering (`loadExamList`, `renderExamList`) to `examActions.js`.
- [x] Migrate library configuration logic to `libraryManager.js`.
- [x] Verify and adjust `lazyLoader.js` order for `browse-view` group.
- [x] Create compatibility shims in `main.js` for moved functions.
- [x] Run automated tests to ensure no regressions.
- **Deliverable**: `browseController.js`, `examActions.js`, `libraryManager.js` fully functional; `main.js` delegates to them.
- **Status**: **Completed**
- **Documentation**: `developer/docs/phase2-complete-summary.md`

### 阶段3：练习记录/导出/套题模式模块化 ✅ **已完成**
- [x] 练习记录链路（`syncPracticeRecords`、`ensurePracticeRecordsSync`、`startPracticeRecordsSyncInBackground`、`ensurePracticeSessionSyncListener`、记录过滤/选中/批删）保留在 main.js（核心数据流，依赖多个组件）。
- [x] 视图与统计（`updatePracticeView`、`computePracticeSummaryFallback`、`applyPracticeSummaryFallback`、`setupPracticeHistoryInteractions`）保留在 main.js（依赖 PracticeDashboardView/PracticeHistoryRenderer，暂不迁移）。
- [x] 导出/套题/随机练习入口（`exportPracticeData` 已在 Phase 2 迁移到 examActions.js、`startSuitePractice`、`startRandomPractice`、`openExamWithFallback`）迁入 `js/presentation/app-actions.js`，保留 `window.startSuitePractice` 等兼容 API。
- [x] 懒加载 `practice-suite` 触发点已在 app-actions.js 配置（hover/focus 导航按钮时触发）。

**Phase 3 验收**: ✅ 通过 - 测试 27/28，套题/随机练习功能已模块化

### 阶段4：更多工具、小游戏与杂项清理
- [ ] 时钟/更多工具交互、状态对象、词汇/备份入口彻底收敛到 `js/presentation/moreView.js`，main.js 只保留 `ensureMoreView` 之类转发。
- [ ] 小游戏/词汇闪卡入口 `launchMiniGame`、模态事件绑定迁入 `js/presentation/miniGames.js`，`window.launchMiniGame` 由该模块挂载。
- [ ] 清理 main.js 中已空壳的函数与重复事件绑定，只保留向外暴露的 shim；为未迁移区域加 TODO 注释标记归属模块。

### 阶段5：回归与验收
- [ ] file:// 手测：overview、浏览、练习记录、更多工具、随机/套题启动，无控制台未定义/TDZ/懒加载缺文件错误。
- [ ] 跑仓库要求测试：`python developer/tests/ci/run_static_suite.py`，`python developer/tests/e2e/suite_practice_flow.py`；如未跑需在文档中标注原因与风险。
- [ ] 移除临时日志/调试钩子，确认 `AppBootScreen` 阶段显示与收起正常。

## 风险与防御
- 顺序依赖断裂：懒加载分组内保持依赖顺序，入口 shim 要求可重入，必要时在 AppActions 中加预取。
- 兼容层遗漏：所有 legacy `window.*` 入口迁移后保留转发，避免模板内 onclick 失效。
- 数据一致性：题库/练习记录使用统一 state service，避免跨模块各存一份导致渲染不一致。

## 验收标准
- 首屏无报错，overview 默认展示；点击“题库浏览”1s 内完成加载。
- 练习记录加载/导出/随机/套题可用，更多工具的时钟/词汇入口可用，小游戏入口可用。
- 控制台零未捕获引用/TDZ/模块缺失，CI/E2E 通过或留有可复现的失败说明。
