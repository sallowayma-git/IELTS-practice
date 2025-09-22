# Handoff: PracticeRecorder 与数据通路修复（v1.1.6 过渡）

## 背景与动机（为什么要这么做）

- 运行模式为本地 file://。此前多个关键路径把 Promise 当数组使用（未 `await` 即 `.find/.filter`），导致初始化中断；PracticeRecorder 源文件还出现中文字符串破损造成语法错误，组件加载失败。结果：无握手、无会话ID、无记录写回、三大视图空白。
- 目标是用最小变更恢复可靠链路：组件加载 → 注入增强器 → 握手 → 上报 PRACTICE_COMPLETE → 写回存储 → UI 展示详情。遵守 Never break userspace（不改协议/格式/键名，file:// 优先）。

## 目标与范围

- 目标：
  - 本地 file:// 下可靠加载 PracticeRecorder；总览/题库浏览/练习记录三视图有数据；握手/写回闭环；控制台无致命报错。
- 非目标：
  - 不改变事件名与数据格式；不增加服务端；不改变本地运行模式。

## 本地运行约束（必须牢记）

- file:// 下 `event.origin` 可能为 `'null'`；消息过滤以 `event.source` + `data.source` 为准。
- 所有 `storage.get/set/remove` 必须 async/await；任何数组类数据取回后先数组化：`const list = Array.isArray(x) ? x : []`。
- 严禁把空数组写入 `exam_index` 缓存，避免“永久无数据”。
- 弹窗策略可能阻拦 `window.open`，将导致握手失败；需允许本地弹窗。

## 端到端流程（完整做题链路）

1) 打开系统（file://）
- 入口：`index.html` 加载 `js/main.js`、`js/app.js`，`ExamSystemApp.initialize()` 启动（js/app.js:18）。
- 统计：`updateOverviewStats()` 通过 `await storage.get('exam_index')`、`await storage.get('practice_records')` 并数组化（js/app.js:633）。

2) 打开练习页面
- 触发：用户点击“开始”，`window.app.openExam(examId)`（js/app.js:861）。
- 打窗：`openExamWindow()` 用 `window.open(examUrl, name, features)` 打开题目（js/app.js:934）。
- 注入增强器：`injectDataCollectionScript(examWindow, examId)` 注入 `js/practice-page-enhancer.js`（js/app.js:1019–1027）。
- 初始化会话：`initializePracticeSession(examWindow, examId)` 发送 `postMessage({type:'INIT_SESSION', data:{sessionId, examId}})`（js/app.js:1143–1157）。
- 握手重试：`startExamHandshake(examWindow, examId)` 每 300ms 重发 `INIT_SESSION`（兼容 `init_exam_session`）直到 `SESSION_READY`（js/app.js:1333）。
- 降级兜底：若主路径异常，`js/main.js:566` 的 openExam 也会周期性发送 `INIT_SESSION`，确保子页能拿到 `sessionId`；`js/main.js:129` 收到 `SESSION_READY` 基于 `event.source` 停止重试。

3) 子页增强器与握手
- 子页监听 `INIT_SESSION`，设置 `sessionId/examId` 并回发 `SESSION_READY`（js/practice-page-enhancer.js:337）。
- 期间采集答案/交互，拦截提交，提取 `scoreInfo`，准备完成数据（js/practice-page-enhancer.js:1000+）。

4) 完成上报与写回
- 子页提交后：`postMessage({ type:'PRACTICE_COMPLETE', data:{ sessionId, examId, startTime, endTime, duration, answers, correctAnswers, answerComparison, interactions, scoreInfo, url, title }})`。
- 父页统一消息处理：`window.onmessage` → `handlePracticeComplete(examId, data)`（js/app.js:1714）。
- 写回存储：`saveRealPracticeData(examId, data)` 构造统一 `practiceRecord`，写入 `practice_records`（js/app.js:1818）。
- UI 刷新：`syncPracticeRecords()` 或直接刷新内存记录，练习记录视图即时可见（js/app.js:1724–1744；js/main.js:97–124）。

5) 展示详细做题记录
- 列表数据源：`window.practiceRecords`（js/main.js:97–123）。
- 详情展示：`practiceHistoryEnhancer` 与 `practiceRecordModal` 读取 `realData`（answers/correctAnswers/answerComparison/scoreInfo）渲染详情表格/对比（js/components/practiceHistoryEnhancer.js, js/components/practiceRecordModal.js）。

## 事件与数据契约（消息格式）

- INIT_SESSION（父→子）
  - 载荷：`{ sessionId, examId, parentOrigin, timestamp }`（js/app.js:1149）。
- SESSION_READY（子→父）
  - 载荷：`{ pageType, url, title }`（js/practice-page-enhancer.js:342）。
- PRACTICE_COMPLETE（子→父）
  - 载荷：`{ sessionId, examId, startTime, endTime, duration, answers, correctAnswers, answerComparison, interactions, scoreInfo }`（js/practice-page-enhancer.js:1040 附近生成）。

## 存储与展示映射（从消息到 UI）

- 存储键（StorageManager 自动加前缀 `exam_system_`）：
  - `practice_records`：练习记录数组。
  - `exam_index`：题库索引数组。
  - `active_sessions`：活动会话列表。
- 练习记录结构（见 js/app.js:1830 起）：
  - 顶层：`{ id, examId, title, category, frequency, date, sessionId, timestamp, score, totalQuestions, accuracy, percentage, answers }`
  - 详情：`realData: { score, totalQuestions, accuracy, percentage, duration, answers, correctAnswers, answerHistory, interactions, isRealData, source }`
- 列表与详情：
  - 列表从 `window.practiceRecords` 渲染（js/main.js:97–124）。
  - 详情组件按 `realData` 渲染逐题对比表格与得分（practiceHistoryEnhancer/practiceRecordModal）。

## 关键文件与入口（便于溯源）

- `js/app.js:861` 打开题目入口；`js/app.js:934` 打窗；`js/app.js:1019` 注入增强器；`js/app.js:1143` 发送 INIT_SESSION；`js/app.js:1333` 握手重试；`js/app.js:1714` 完成处理；`js/app.js:1818` 写回存储。
- `js/main.js:566` 降级握手；`js/main.js:129` 统一消息监听与同步记录。
- `js/practice-page-enhancer.js:337` 子页接收 INIT/回发 READY；`~1000+` 上报完成。
- `js/utils/storage.js:1` StorageManager 异步 API 实现与回退。
- `js/core/practiceRecorder.js:1279` 临时记录异步恢复（源文件已重写）。

## 已完成（v1.1.6 过渡）

- 修复 PracticeRecorder 源语法错误；`recoverTemporaryRecords()` 改为异步实现（await storage.get/remove/set + for-of）。
- app 层所有 `.find/.filter` 前加入数组化防御，恢复统计/注入/握手链路。
- main.js 增加降级握手与最小化写回兜底，杜绝“无会话ID”。
- componentChecker 使用 async/await 正确显示 `practice_records` 条数。

## 决策与理由（设计取舍）

- 统一“数组化防御”，消灭 Promise 当数组的低级错误，比在各处加 if/try 更简洁（好品味）。
- 握手放在父源（含降级）而不是让子页自找：父源更可靠地产生 sessionId 并维护会话映射（Never break userspace）。
- 暂存运行时补丁：面对历史编码/超长源文件带来的修订风险，先保证 file:// 稳定；回归通过后移除。

## 风险与应对

- 弹窗被拦截 → 无法握手：提示用户允许弹窗；降级握手也无法跨越浏览器策略限制。
- 写入空索引 → 永久无数据：禁止将空数组写入 `exam_index`；读取侧已数组化防御，但写侧也需遵守。
- 历史编码/乱码日志：不影响功能；建议统一 UTF‑8（无 BOM）后移除运行时补丁。

## 验收与测试清单（逐条）

- 启动：本地打开 `index.html`，Console 无 SyntaxError/ReferenceError；PracticeRecorder 初始化完成。
- 三视图：
  - 总览：总数、平均、进度条正常（依赖 `exam_index` 与 `practice_records`）。
  - 浏览：题目卡片列表显示。
  - 记录：显示历史记录；可打开详情，见到逐题对比表格与分数。
- 做题：
  - 父页日志出现 INIT_SESSION 与 SESSION_READY（或 [Fallback] INIT_SESSION）。
  - 提交后父页出现 PRACTICE_COMPLETE；`practice_records` 数量 +1；记录详情可见 `answers/correctAnswers/answerComparison/scoreInfo`。

## 回滚与后续计划

- 回滚：保留 `js/patches/runtime-fixes.js`，恢复 `practiceRecorder.js` 到修复前版本；清理 `exam_index` 缓存后重试。
- 后续：删除运行时补丁；统一编码；在组件层增加轻量类型守卫与针对 file:// 的小型回归测试用例。

