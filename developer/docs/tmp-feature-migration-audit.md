# `tmp` 功能迁移审计

> 审计分支：`codex/audit-tmp-migration`
> 当前主线基准：`b39cec8`
> `tmp` 历史基线：`eb4af2f`（2026-06-19，数据层重构前）
> 审计日期：2026-07-16

## 结论

`tmp` 是旧发布目录，不是可直接合并的源码分支。它包含 502 个文件，其中 471 个与 `eb4af2f` 完全一致；`index.html`、`heroui-bridge.css`、`onboarding.css` 和大多数 bundle 都只是旧基线，`css/main.css` 只有换行差异。

禁止把 `tmp` 整体覆盖到当前工作树，也禁止直接编辑或复制其中的 generated bundles。真正需要迁移的功能应还原到当前 `js/...` 源文件，并重新运行 `scripts/build-bundles.mjs`。

## 真正的功能增量

### 1. 结构化阅读笔记

旧分支在 `tmp/js/bundles/reading-page.bundle.js` 中实现了：

- 从原文高亮创建结构化笔记；
- `note = { id, title, body, quote, outlineId, order, createdAt, updatedAt }`；
- Notes drawer、outline 新建/改名/折叠/删除；
- 笔记拖拽归组与排序；
- 可拖动的笔记编辑器；
- 点击笔记回跳原文锚点；
- highlight 快照携带 `noteId`。

目标源码：

- `js/runtime/unifiedReadingPage.js`
- `js/runtime/readingHighlightShared.js`

### 2. 草稿与提交后注释持久化

旧分支保存以下阅读上下文：

- `answers`
- `highlights`
- `noteText`
- `notes`
- `noteOutlines`
- `markedQuestions`
- `scrollY`

并在 `pagehide` / `visibilitychange` 时强制 flush。Review 模式会尝试按原记录 id 更新笔记和标注。

该行为值得迁移，但旧实现把草稿和 autosaved record 直接写入 `practice_records`，不符合当前架构。阅读练习运行在 iframe 内，不能假设其中存在主窗口的 `PracticeRecordAPI`；迁移后应通过带 window/session token 校验的父子窗口消息分流：

- 未完成草稿：发送 draft/annotation sync 消息，由父窗口写入独立 draft/meta 存储；
- 已完成记录：沿用 `PRACTICE_COMPLETE`，由父窗口调用 `PracticeRecordAPI.saveCompletion`；
- Review 纯注释更新：新增受校验的 annotation sync 消息，由父窗口 `getById` 后合并，并以原 id 调用 `saveRecord({ updateStats: false })`。

### 3. 结果题号回跳原文证据

旧分支把结果表题号变为跳转按钮，并根据 explanation locator snippet 或段落标签建立原文定位；无法精确匹配时使用 overlap fallback。

该功能可独立于数据层迁移，但锚点必须在文本或 DOM 改动时无损降级，不能错误绑定到其他段落。

### 4. 阅读显示控制

旧分支在 header 中动态加入：

- 定位、笔记、高亮显隐；
- 题号导航折叠/展开；
- UI 偏好持久化。

这些属于 settings/UI preference，不应写入练习记录。可继续走当前设置仓库或明确的 UI preference key。

### 5. 旧分支的补偿逻辑

旧分支还实现了：

- 隐藏 autosaved practice record；
- 按标题、秒级时间、分数等字段对历史记录去重；
- localStorage 与 IndexedDB 的 `practice_records` 合并迁移。

这些是旧写入模型造成的补偿，不应原样迁移。当前数据层已经集中处理 canonical record 和 id 去重；应修复生产端，不应依赖展示层掩盖重复记录。

## 数据接口重定向

当前硬规则：`practice_records` 和 `user_stats` 只能通过 `PracticeRecordAPI` 写入。`dataRepositories.practice` 已不再公开，`PracticeCore.store` 也是只读 public store，raw storage 与 `simpleStorageWrapper` 对受保护 key 的写入会抛错。

| 旧接口或行为 | 当前目标接口 | 迁移要求 |
| --- | --- | --- |
| `dataRepositories.practice.list()` | `PracticeRecordAPI.list()` / `listSummary()` | UI 列表优先 summary |
| `practice.getById(id)` | `PracticeRecordAPI.getById(id)` | 直接替换 |
| `practice.upsert(record)` / `PracticeCore.store.savePracticeRecord` | `PracticeRecordAPI.saveRecord(record, options)` | 必须含 canonical `examId` |
| completion payload 自拼记录再保存 | `PracticeRecordAPI.saveCompletion(...)` | 优先让当前 ingestor 建 canonical record |
| overwrite / raw `storage.set('practice_records')` | `PracticeRecordAPI.replace(...)` | 导入时控制 `updateStats` |
| remove / clear | `deleteById`、`deleteMany`、`clear` | suite 仅在明确场景按 sessionId 删除 |
| raw `user_stats` 读写 | `readStats`、`writeStats`、`mergeStats`、`resetStats` | 不迁旧浅合并算法 |
| 旧手写备份接口 | `BackupAPI` | 使用当前 normalize/restore 语义 |
| raw 题库配置和 path map 写入 | `LibraryManager` + `ResourceCore` | 保证配置、内存索引、事件和路径同步 |
| raw 词表写入 | `VocabStore` / `VocabDataIO` | 不绕过 active list 与缓存 |

### `tmp` 中必须删除的写入路径

`tmp/js/bundles/reading-page.bundle.js` 的 `saveLocalReadingRecord` 会先执行 fallback，同时写：

- `exam_system_practice_records` localStorage；
- `ExamSystemDB` IndexedDB；
- 随后再尝试旧 `PracticeStore` / `PracticeCore`。

这会绕过当前单写入口并造成 split-brain、重复记录或覆盖。迁移时必须删除整个 raw IndexedDB/localStorage fallback，不得包装成兼容层。

旧页面提交时还会向父窗口发送 `PRACTICE_COMPLETE`，父窗口再执行一次 canonical save，因此原实现存在双写路径。完成记录必须只保留父窗口这一条写入链路。

## Canonical schema 需要先扩展

当前 `PracticeCore.contracts.standardizeRecord` 尚未完整声明结构化 `notes` / `noteOutlines`。UI 迁移前，应在 canonical contract 中明确以下字段，并同步 completion、suite entry、replay 和 recorder 路径：

- `highlights: array`
- `markedQuestions: array`
- `noteText: string`
- `notes: array`
- `noteOutlines: array`
- `scrollY: number`

建议把完整 replay 数据保存在 `realData`，顶层只保留当前消费者确实需要的轻量镜像。`listSummary()` 必须继续剔除完整笔记正文、原文 quote 和重型 replay 数据。

Review 更新必须保留原 `id`、`examId`、score、timing 和 completion 状态，并使用 `updateStats: false`，避免编辑笔记时重复累计统计。

## 题库内容审计

旧分支 manifest 新增 5 篇题目，其中 4 篇当前已经以更新后的 ID/频率存在：

| `tmp` ID | 当前 ID | 结论 |
| --- | --- | --- |
| `p1-high-242` | `p1-high-240` | 已存在，不重复迁移 |
| `p2-high-243` | `p2-low-240` | 已存在，不重复迁移 |
| `p2-high-244` | `p2-low-242` | 已存在，不重复迁移 |
| `p3-high-241` | `p3-medium-241` | 已存在，不重复迁移 |
| `p3-high-240` Songs of Ourselves | 无 | 旧分支独有内容，不属于功能迁移范围 |

题库以当前远端主线为唯一权威来源。`Songs of Ourselves` 及其他旧分支独有内容不迁移；也不能批量覆盖 `tmp` explanations，因为审计发现旧解释中存在答案字段与解析结论冲突的样本。

以下内容明确拒绝迁移：

- `tmp` 中未进入 manifest 的孤儿副本；
- 旧分支把本地图改为 postimg CDN 的变更；
- 已在当前主线存在但 ID/难度已修正的 4 篇重复题；
- 缺少对应文件的旧 manifest 项 `p2-high-26`。

## 不应迁移的旧版本回退

- 不迁 `session.bundle` 中删除 `suiteTimerMode` / `suiteTimerLimitSeconds` 的改动；
- 不迁阅读页删除倒计时警告、自动交卷和当前 timer preference contract 的改动；
- 不整体替换 reading template、`index.html` 或 CSS；
- 不恢复 `dataRepositories.practice`、`PracticeCore` public write methods 或 raw protected-key adapter；
- 不把 generated bundle 当 source of truth。

## 推荐实施顺序

1. 扩充 canonical annotation/draft schema，并给 `PracticeRecordAPI` 增加对应契约测试。
2. 在父窗口建立局部 `readingDraftGateway`：草稿走独立受控 draft key，completed/review 走 `PracticeRecordAPI`；iframe 只发送受 token 校验的消息。
3. 迁移结构化 notes 与 `noteId` highlight snapshot/restore。
4. 迁移结果定位与显示控制，保持它们与记录存储解耦。
5. 重建 bundles，执行单元、静态和浏览器回归测试。

## 测试门禁

至少覆盖以下场景：

- canonical normalize/save/reload 后 `notes`、`noteOutlines`、`noteId` 不丢失；
- in-progress draft 不出现在 practice history，也不更新统计；
- completed record 只保存一次，reload 后可 replay；
- Review 编辑笔记更新同一 id，score、duration、date 和 stats 不变；
- suite 三段草稿隔离且 timer contract 不回退；
- note quote 找不到或 DOM 变化时不误绑、不丢正文；
- Notes drawer outline 增删改、拖拽排序和键盘操作；
- locator 精确匹配、fallback、无匹配三种路径；
- 伪造或过期 window/session token 的 annotation sync 被拒绝；
- 窄屏 Notes drawer/editor 不被 `z-index: 2000` 的底部 practice nav 遮挡；
- 旧 `#notes-panel` / `#note-btn` 与新 Notes drawer 只有一个权威状态和入口；
- bundle 重建后与源码一致；
- 当前远端题库的 exam/explanation/manifest 内容保持不变。

建议复用并扩展：

- `developer/tests/js/practiceCore.test.js`
- `developer/tests/js/practiceRecorder.test.js`
- `developer/tests/js/practiceRecordPersistence.test.js`
- `developer/tests/js/storageManagerRecords.test.js`
- `developer/tests/js/unifiedReadingCoreRegression.test.js`
- `developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js`
- `developer/tests/e2e/reading_single_flow.node.js`
- `developer/tests/e2e/simulation_roundtrip_restore_regression.py`
- `developer/tests/ci/check_reading_data_integrity.py`

建议验证命令：

```powershell
node scripts/build-bundles.mjs
node developer/tests/js/practiceCore.test.js
node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js
node developer/tests/js/suiteModeRegression.test.js
node developer/tests/js/practiceCompletionFlow.test.js
node developer/tests/js/unifiedReadingCoreRegression.test.js
py developer/tests/ci/run_static_suite.py
node developer/tests/e2e/reading_single_flow.node.js
```

审计时的只读基线：`practiceCore.test.js` 13/13、inline suite、suite mode 和 completion flow 均通过；`unifiedReadingCoreRegression.test.js` 在当前主线已有一项失败（`submit should notify host before explanation rendering completes`，实际通知数 `0`、预期 `1`）。迁移前需先把该既有红灯登记或修复，否则无法用它判断迁移回归。

本审计所列的结构化笔记、受控草稿、回顾注释同步与数据契约迁移已在本分支实现；旧分支题库内容未迁移。
