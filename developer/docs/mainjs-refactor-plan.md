# main.js 拆分与懒加载开发任务书

## 背景与现状
- `js/main.js` 职责过载：导航、题库加载、练习同步、界面交互、时钟/小游戏均集中，导致全局变量泛滥、初始化链过长。
- 目前首屏仍需一次性加载/执行大包，懒加载失效；TDZ/顺序依赖引发运行时错误（近期修复了 `analogClockState` 等）。
- 目标：在不破坏现有对外接口的前提下，按职责拆分 main.js，接入 lazyLoader 分组，让首屏只加载必要模块，其余按需/空闲加载，降低复杂度。

## 拆分目标
1) 明确模块边界，减少全局状态：导航/壳层、题库浏览、练习/导出、更多工具、小游戏入口分离。
2) 保持现有对外 API/事件兼容（`loadExamList`、`showView`、`launchMiniGame`、`examIndexLoaded` 监听等）。
3) 将非首屏模块接入 `AppLazyLoader` 分组触发，避免一次性加载 50+ 脚本。
4) 清理冗余兜底逻辑与重复事件绑定，降低维护成本。

## 必须保留的行为与接口约束
- 全局函数/入口：`loadExamList`、`resetBrowseViewToAll`、`normalizeRecordId`、`launchMiniGame`、`ensureExamDataScripts`、`ensurePracticeSuiteReady`、`reportBootStage`、`showView` 调用路径不变。
- 事件/流：`examIndexLoaded` → `loadExamList` & 隐藏浏览页 spinner；存储同步监听仍触发练习记录刷新；导航默认视图 = overview。
- Boot 层：`AppBootScreen.setStage/complete` 调用点保留，避免阻塞或重复。
- 数据结构：题库索引、练习记录、命名空间 `exam_system` 不变；不修改存储 schema。

## 拆分方案（建议文件与分组）
1) **入口/壳层** `js/app/main-entry.js`（新建）
   - 职责：等待 `storage` ready 设置 namespace、初始化导航、触发 overview 渲染、绑定 `examIndexLoaded` 监听。
   - 仅依赖：logger、storage、navigation-controller、overviewView、AppBootScreen。

2) **导航与首页交互** `js/presentation/indexInteractions.js`（新建或扩展导航控制器）
   - 包含：`initializeIndexInteractions`、`setupIndexSettingsButtons`、`setupQuickLaneInteractions`，去除多余全局依赖，提供 `ensureIndexInteractions()`。
   - 依赖：DOMAdapter、NavigationController、message-center。

3) **题库浏览模块**（整合到已有 `js/app/browseController.js` + 新文件 `js/app/examActions.js`）
   - 迁移：`loadExamList`、`displayExams`、`setupExamActionHandlers`、过滤/置顶逻辑、频率模式状态。
   - 导出：`loadExamList`、`resetBrowseViewToAll`，供全局/事件使用。
   - 依赖：storage/exam index、DOMAdapter、LegacyExamListView。

4) **练习/导出集**（利用现有 `practiceHistoryEnhancer.js`、`AppActions`）
   - 将 main.js 中与练习记录同步/导出/虚拟滚动的辅助函数移入对应组件，main.js 仅保留调度入口。
   - 依赖：PracticeDashboardView、markdownExporter、storage。

5) **更多工具 & 时钟** `js/presentation/moreView.js`（新建）
   - 迁移：`setupMoreViewInteractions`、时钟状态对象、flip/digital/ambient 初始化与事件绑定、vocab 入口。
   - 导出：`ensureMoreView()`；全局暴露必要的 overlay 控制函数。

6) **小游戏入口** `js/presentation/miniGames.js`（新建）
   - 包含：`launchMiniGame`（转发到具体游戏/提示），挂载到 `window.launchMiniGame`。

7) **LazyLoader 分组调整** `js/runtime/lazyLoader.js`
   - 新增分组：`browse-view`（browseController + examActions + 相关 utils）、`more-tools`（moreView + clock/vocab 依赖），`practice-suite` 保留。
   - 在入口/导航 hover/视图切换时 `ensureGroup`：nav hover/点击 browse → `browse-view`，点击 more → `more-tools`，idle/hover practice → `practice-suite`。

8) **index.html 引用简化**
   - 改为加载：bootScreen、lazyLoader、logger、storage 基础、navigation-controller、overview 视图、main-entry。
   - 其他模块依赖 lazyLoader 组（不再直接列出大段脚本）。

## 开发步骤（顺序执行）
1) 梳理 main.js 依赖：列出全局变量/函数与所需外部模块，写入各子模块顶部 TODO。
2) 按上述分组创建新文件并迁移对应函数；在旧位置留下 shim/转发，保持全局 API 不变。
3) 更新 lazyLoader manifest 分组与 app-actions 预取触发。
4) 更新 index.html 脚本引用为新入口与核心依赖（保持 defer），移除一次性大包。
5) 清理冗余兜底/重复日志，确保 TDZ/顺序问题不存在。
6) 自测：浏览器打开首屏、切换 browse/practice/more，控制台无未定义错误；验证导出/题库加载正常。
7) 按仓库要求运行：`python developer/tests/ci/run_static_suite.py`，`python developer/tests/e2e/suite_practice_flow.py`。

## 风险与防御
- **顺序依赖破裂**：拆分后若忘记在分组内保持执行顺序，会导致全局变量未定义；分组加载顺序需严格按依赖排列。
- **接口遗漏**：遗漏全局函数挂载会破坏 legacy 入口；需在迁移后保留兼容层。
- **懒加载时机**：导航/hover/idle 触发要覆盖首个进入路径，否则用户点击时缺脚本；建议在 `AppActions` 扩展预取。
- **命名空间/存储**：不要修改存储键与命名空间，避免数据丢失。

## 验收标准
- 首屏解析无报错，Boot 层自动收起；overview 正常显示。
- 点击 “题库浏览” 1s 内加载完成，exam 行为按钮可用。
- 点击 “练习记录”/导出正常；更多工具的时钟/词汇入口正常。
- 控制台无未捕获引用/TDZ/模块缺失错误。
- CI/E2E 用例通过或问题可复现说明。
