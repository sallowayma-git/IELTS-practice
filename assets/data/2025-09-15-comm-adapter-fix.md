# 2025-09-15 通信与记录适配修复日志

目标
- 修复“单独练习页面与总览系统通信不生效，记录未入库”的问题。
- 保证本地直接双击 index.html（file://）场景下也能接收练习完成消息并落库。
- 保持改动最小，不修改任何单独练习网页。

变更概览
- js/app.js：放宽消息来源过滤（移除强制要求 `event.data.source==='practice_page'` 的早退）。
- js/main.js：新增桥接监听 `setupCompletionMessageBridge()`，当收到 `PRACTICE_COMPLETE` 且未被 app 捕获时，直接调用 `app.saveRealPracticeData(examId, payload)` 落库；同时在初始化中调用该桥接。

2025-09-15 追加变更
- 修复语法错误：`showActiveSessionsIndicator` 内重复声明 `indicator` 导致 `Identifier 'indicator' has already been declared`，影响 app 初始化。已完全禁用该浮标功能并移除重复声明。
- 本地 file:// 握手增强：
  - `setupExamWindowManagement` 中启动 `startExamHandshake`，每 300ms 重发一次 `INIT_SESSION` 与 `init_exam_session`，直至收到 `SESSION_READY` 自动停止。
  - 发送首次 INIT_SESSION 时打印日志，便于核对握手是否触发。
- 调试辅助：
  - `window.getHandshakeState()` 返回当前握手与练习窗口状态。
  - `window.exportDebugInfo()` 导出握手、存储与计数信息（Settings 内提供按钮）。
- 记录导入（解决 file 与 live server 本地存储隔离问题）：
  - Settings 新增“📥 导入本地JSON记录”按钮，选择一个或多个 JSON（单条记录或批量导出）合并入库。
  - 支持多种历史结构，按 `id` 去重，立即刷新“练习记录”。

细节
- 放宽过滤（js/app.js）：
  - 移除早期的严格来源判断，保留后续的兼容过滤（允许 `practice_page` 与 `inline_collector`，且对缺失 source 的消息不拦截）。
- 记录桥接（js/main.js）：
  - 对 `PRACTICE_COMPLETE` 消息解析 `msg.data.examId || msg.data.originalExamId`，调用 `window.app.saveRealPracticeData` 持久化，然后 `syncPracticeRecords()` 刷新 UI。
  - 在 `initializeApplication()` 中调用 `setupCompletionMessageBridge()`，与现有 `setupMessageListener()` 并行，最小侵入。

验证建议
- 从总览中打开题目：完成练习后记录应立即显示在“练习记录”页，无需刷新。
- 直接双击 index.html 打开：在 file:// 环境下也能接收并入库来自子窗口/练习页的 PRACTICE_COMPLETE 消息。
- 旧页面（仅发送 `session_completed`）路径：依旧由 PracticeRecorder 全局监听处理，记录可入库。

已知限制与说明
- file:// 与 http(s):// 环境的 localStorage 隔离属浏览器安全策略，无法自动跨源迁移；本次通过“导入本地JSON记录”提供手动合并路径。

2025-09-15 二次追加（应产品要求）
- 移除设置页中的“🐞 导出调试信息”和“📥 导入本地JSON记录”两个按钮（原有“导出数据/导入数据”已覆盖需求）。
- 题库配置切换：新增改进版列表（showLibraryConfigListV2），默认题库（exam_index）不可删除，仅可切换；列表样式更清晰。
- 加载题库弹窗视觉：
  - 使用深色不透明遮罩（rgba(0,0,0,0.65)+blur），增强可读性；
  - 弹窗内容为深色卡片背景+细边框+阴影；分栏卡片使用半透明面板提高对比度；
  - 文字对比度与间距优化，操作按钮布局不变。

2025-09-15 三次追加（紧急修复）
- 修复一次改动导致的“showView 未定义”问题：
  - 新增 `js/boot-fallbacks.js` 作为安全兜底，在 `main.js` 解析失败时，提供 `showView`、`showLibraryConfigListV2`、`showLibraryLoaderModal` 的安全实现，保证页面不崩溃、按钮可用。
  - 导航按钮的 `onclick` 改为 `window.showView && window.showView(...)`，避免解析阶段报错。
- 题库配置列表保障：当首次使用仅存在默认索引但未生成配置条目时，列表自动补建“默认题库（exam_index）”，避免空列表。

未修改/未影响
- 未改动任何“单独练习网页”。
- 未改动数据结构与已有导出/导入逻辑。

后续可选
- 若需自动导入散落的 `practice-record-*.json`，可在设置页提供“选择文件夹并导入”的辅助工具（保持手动授权的本地文件读取）。
