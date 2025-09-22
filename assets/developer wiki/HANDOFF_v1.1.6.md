# Project Handoff (v1.1.6)

本版本聚焦修复“练习页面无法与总览系统通信（无会话ID）”的核心问题，并确保在任何情况下都能完成握手与结果写回，遵守 Never break userspace。

## 核心判断
- 值得做：是。原因：主路径偶发失败时（app.openExam 抛错或未就绪），旧的降级路径只打开子页但不发 INIT_SESSION，导致练习页拿不到 sessionId → 无法发送数据。该问题是真实影响生产使用的故障，且修复可通过极小改动获得确定收益。

## 关键洞察
- 数据结构：
  - 会话锚点是 `sessionId`，由父页面生成并下发给子页，子页据此发送 PRACTICE_COMPLETE。
  - 旧降级路径没有维护任何会话映射（sessionId ↔ examId ↔ window），也没有建立握手重试。
- 复杂度：
  - 可消除的复杂性：将“打开子页但不握手”的特殊情况统一为“始终握手”，即使主 App 路径失败也执行标准握手序列；避免在子页做额外判断。
- 风险点：
  - 并行多个会话时，需要准确停止对应握手重试。通过记录 event.source（子窗口引用）精准匹配。

## 变更摘要（基于事实）

文件：`js/main.js`
- 新增降级握手映射：`fallbackExamSessions: Map<sessionId, { examId, timer, win }>`。
- openExam 降级路径：
  - 保留原“打开窗口”逻辑，但额外调用 `startHandshakeFallback(examWindow, examId)`。
  - 生成 `sessionId`，每 300ms 向子页发送 `INIT_SESSION` 与 `init_exam_session`，最多 30 次；并记录 `{ examId, timer, win }`。
- setupMessageListener：
  - 监听 `SESSION_READY`：基于 `event.source` 匹配对应会话，停止握手定时器（不删除会话映射，保留用于完成写回）。
  - 监听 `PRACTICE_COMPLETE`：若 `sessionId` 命中降级会话映射，则执行最小化持久化 `savePracticeRecordFallback(examId, data)`，保证记录入库；否则沿用既有同步刷新流程。
- 新增 `savePracticeRecordFallback(examId, realData)`：
  - 写入 `practice_records`，字段兼容旧视图（score/totalQuestions/accuracy/percentage/answers/...）。

未改动子页增强器：`js/practice-page-enhancer.js` 保持 `PRACTICE_COMPLETE` 包含 `sessionId`，便于父页映射写回。

## 验收标准（复核点）
- 打开题目（Browse/开始）时：
  - 若主 App 正常：父窗 Console 出现 `[System] 发送初始化消息到练习页面...` 与 `SESSION_READY`，与 v1.1.5 相同。
  - 若主 App 调用失败：父窗 Console 出现 `[Fallback] 发送初始化消息到练习页面...`，随后收到 `SESSION_READY(匹配到窗口)`。
- 完成题目：
  - 子窗发送 `PRACTICE_COMPLETE`，父窗命中降级会话时打印 `[Fallback] 收到练习完成（降级路径），保存真实数据`，`practice_records` 计数增长。
  - 练习记录视图显示新增记录，字段正确。

## 不破坏性
- 未改动现有事件名、数据格式、存储键名；对现有用户数据零破坏。
- 降级路径仅在主路径失败时触发，不影响正常情况。

## 回滚策略
- 变更集中在 `js/main.js`，若需回滚，移除：
  - `fallbackExamSessions` 定义
  - `startHandshakeFallback` 与 `savePracticeRecordFallback`
  - `openExam` 中调用与 `setupMessageListener` 分支

## 后续建议
- 可在子页 `SESSION_READY` payload 中附带 `sessionId`（非必须，本次已通过 event.source 精准匹配）。
- 若需更强一致性，可复用 `js/app.js` 的保存逻辑作为公共模块，避免重复实现最小化写回。

— 完 —

