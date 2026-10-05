# 独立复审与补修回执

## 01a0fc46-4c40-7011-904b-b19447807ab8
【核心判断】🟡 确认 2 个 P1，无 P0。定向测试 `cargo test -p ielts-db --test teaching_strategy -- --nocapture`：21/21 通过，但 fixture 未覆盖真实生产事件形态。以下为代码链确认，未新增复现测试或修改文件。

【关键洞察 / 致命问题】

1. **P1：真实写作评分全部被丢弃。**  
   [teaching_strategy.rs:482](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/teaching_strategy.rs:482) 要求事件具有非空 `asset_id`；实际 [learning_events.rs:98](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/learning_events.rs:98) 的写作事件固定为 `asset_id: None`。  
   **反例：**同用户、有支持事件的未来 grammar 评分从 6.5 提升到 7.0，仍被过滤；outcome 写入报“缺少 owned, scored event evidence”，历史重建也不计证据。  
   **缺 fixture：**[teaching_strategy.rs:540](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/tests/teaching_strategy.rs:540) 将阅读 fixture 改成写作，保留了生产写作事件不存在的 asset 和直接 skill 字段，掩盖此问题。

2. **P1：阅读首次练习被兄弟事件误判为重复题集。**  
   [teaching_strategy.rs:517](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/teaching_strategy.rs:517) 将同 asset、时间 `<= target`、不同 event ID 的任何事件视为历史接触。实际 [learning_events.rs:447](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/learning_events.rs:447) 和 [learning_events.rs:465](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/learning_events.rs:465) 为一次提交生成完成事件及逐题事件，共享 asset、attempt 和时间。  
   **反例：**首次做新题集 B，即使目标题由错变对、窗口有效，B 的完成事件也使 `novel=false`；重建在 [teaching_strategy.rs:594](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/teaching_strategy.rs:594) 丢弃该证据，成功和失败均无法累计。  
   **缺 fixture：**一次真实提交产生多个同时间事件，再对照第二次做同题集；现有 fixture 每个 observation 单独造事件，没有完成事件。

【Linus式方案 / 改进方向】

先明确事件、attempt、asset 的关系：从写作 attempt 解析真实题目身份；novelty 按先前独立练习判断，排除同一次提交的兄弟事件。补上上述生产路径 fixture 后再验证。

其他缺 fixture：窗口恰好第 5/6 条及同时间边界、跨 assignment/strategy 重复归因、事实写入后聚合失败的事务回滚。它们目前属于未充分核验项，不列为确认缺陷。点赞不改变学习计数、旧缓存不直接参与 selection，现有定向测试已覆盖。

## 01a0fc46-4d38-7e81-a474-21aac683fd32
【核心判断】🟢 本轮未确认 P0/P1；无可提交的缺陷反例。

【关键洞察】

- 乱序发布、prompt/skill 连续回滚、legacy fail-closed、发布与回滚原子性：定向测试全部通过，21/21。
- 同一 active version 重复发布，被 [0025:12](<F:/workspace/IELTS Atlas APP/crates/ielts-db/migrations/0025_prompt_release_predecessor.sql:12>) 的 CHECK 拒绝；内存 SQLite 探针确认。
- 跨 kind/parent 的 head 被 [0025:22](<F:/workspace/IELTS Atlas APP/crates/ielts-db/migrations/0025_prompt_release_predecessor.sql:22>) 复合 FK 拒绝；回滚另在 [prompt_skill.rs:941](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/prompt_skill.rs:941>) 校验前驱 release 的 kind、parent、version。
- migration 25 已在 [migrate/mod.rs:139](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/migrate/mod.rs:139>) 注册。

【Linus式方案】本轮无需修复。未修改源文件、未派后代、未运行完整 static/E2E 或共享报告；backup 遗漏未重复报告。

## 01a0fc46-4f0b-7442-bf9b-c7a7bfbd08cd
【核心判断】🟡 确认 1 个 P1：题目 fingerprint 没有绑定提交时版本，历史复盘可能混用旧答案与新原文。未发现可证 P0。

【关键洞察／致命问题】

**[P1] canonical source 取的是当前资源，不是该 attempt 提交时的资源。**

- [context.rs:81](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/coach/context.rs:81) 仅按 `asset_id` 加载当前 payload；[context.rs:102](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/coach/context.rs:102) 将当前 fingerprint 写入身份。
- [assets.rs:172](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/reading/assets.rs:172) 允许同 ID 重新导入并更新 fingerprint。加载时只核对文件与当前索引，未核对提交时版本。

**反例：**提交 A/q1，原文支持 TRUE，用户答 FALSE，持久化为错误；随后同 ID 重新导入，修改原文使答案成为 FALSE。真实 UI 从历史打开原 attempt，请求身份完全合法，resolver 会接受新原文与旧 `isCorrect=false`，作为同一次练习的证据交给 Coach。single／suite／endless 均受影响。

现有 [coach_canonical.rs:195](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-application/tests/coach_canonical.rs:195) 只覆盖文件变更、索引未更新；没有覆盖合法重新导入。

【Linus式方案／改进方向】

在提交时持久化资源 fingerprint／版本，复盘匹配该版本或拒绝漂移；旧记录无版本时明确证据限制。

专项 `coach_canonical`：8/8 通过。请求形状、显示题号映射、选区标记、当前问题预算和 provider 调用期间释放 DB 锁未见可证 P1；套题／endless 测试仍只是修改 mode，并非真实端到端验证。全程未修改源码，未运行共享 static／E2E 报告。

## 01a0fc46-4b45-7b91-8c5a-e8dac89ab0c0
确认 3 个 P1；未发现 P0。以下区分实际复现与源码确认。

1. **P1：Weekly 生产候选池丢失全部证据摘要。**  
   [cognitive_runtime.rs:1946](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs:1946>) 返回 `memoryId/key/pendingVerification`，而 [weekly.py:220](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/dream/weekly.py:220>) 只读取 `summary`，并丢弃 `key`。  
   **已复现反例：** 输入六条真实 host 格式候选，归一化结果全部为 `summary: ""`，也没有 scope。模型只能看到 ID，无法依据记忆内容发现模式。专项 fixture 手工提供 `summary`，掩盖了生产断链。应对齐 host 与 Python 的证据字段。

2. **P1：Python 仍按 memory 数量拦截，拒绝新合同允许的独立练习证据。**  
   [weekly.py:319](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/dream/weekly.py:319>) 强制至少三个支持 memory；Rust 的 [consolidation.rs:418 专项 fixture](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/consolidation.rs:418>) 明确允许一个 memory 携带三个真实 session，且可以 apply。  
   **已复现反例：** 候选池已有六条 memory，提交 `supportingMemoryIds: ["mem-0"]`，Python 返回 `None`，合法方案永远到不了 Rust。应移除 Python 的三 memory 门槛，让 Rust 判断证据独立性。

3. **P1：apply 的校验配置来自可修改的 receipt，未绑定可信策略。**  
   [consolidation.rs:123](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/consolidation.rs:123>) 使用 `snapshot.config` 重验；[consolidation.rs:668](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/consolidation.rs:668>) 的 fingerprint 仅哈希来源快照及 proposal，未包含配置；[application/consolidation.rs:103](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/consolidation.rs:103>) apply 时也未传入服务自身配置。  
   **源码确认反例：** 用宽松配置验证一条仅有一个 session 的 pattern，再交给默认配置服务 apply，仍按 receipt 的宽松配置执行；修改一张有效 receipt 的阈值，只要现有证据满足修改后的阈值，比较也会通过。应让 apply 使用可信配置并绑定 receipt。**尚未证明当前生产 reverse-RPC 暴露了该配置篡改入口。**

Python 反例使用假桥接执行；未修改文件、调用 provider 或运行完整 static/E2E。

## 01a0fc46-4e2b-7b33-8ffb-6b1a5e1c25ad
【核心判断】🟡 确认 1 个 P1；另有 1 个条件性 P1。未发现 P0。只读复审，无文件修改。

【关键洞察】

1. **P1／确认：计划读取失败后，显示不可操作的提案条目。**  
   [AgentConsolePage.vue:420](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/views/AgentConsolePage.vue:420>) 将失败吞成 `null`，422 行使用 `snapshot?.items || items`，424 行仍显示生成成功。Python 条目只有 [types.py:221](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/planner/types.py:221>) 的 `itemId`；数据库另生成 [agent_thread.rs:360](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/agent_thread.rs:360>) 的 `spi-*` ID。  
   **反例：**创建成功→快照读取拒绝→页面显示成功→勾选条目，[AgentConsolePage.vue:438](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/views/AgentConsolePage.vue:438>) 提交 `undefined`。已用页面原函数复现。

2. **条件性 P1：目录响应乱序会重新显示已遗忘正文。**  
   [AgentConsolePage.vue:487](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/views/AgentConsolePage.vue:487>) 的 `refreshMemoryCatalog` 没有请求序号，489 行无条件覆盖 `entries`；遗忘后也使用此刷新链路（[548 行](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/views/AgentConsolePage.vue:548>)）。  
   **反例：**旧目录请求 A→遗忘后请求 B→B 返回空目录→A 后返回旧正文→已遗忘条目重新出现。该 Vue 交错已复现；**原生 IPC 是否产生此响应顺序尚未验证，不能宣称生产必现。**

DTO 的 camelCase 引用、前端 owner 过滤、证据读取错误传播和抽屉旧响应保护均未发现新的 P0/P1。probe 五种 enum、结构持久化及旧字符串兼容匹配。single 写作结果路由匹配；当前 suite/endless 提交链路是阅读，未据此推断写作兼容缺陷。

【Linus式方案】

计划必须读取持久化条目后才开放完成操作；读取失败明确报错。目录刷新增加响应版本保护。

验证：局部证据测试 **13/13 通过**，另执行两项内存反例；未运行完整 static/E2E 或共享报告。

## 01a0fc46-4a5c-72b0-aaf2-c58736008264
【核心判断】✅ 已完成 0025 备份兼容补修，仅修改授权的三个文件。

【关键洞察】

- **确认问题**：发布链未进入备份，`v1→v3→v2` 发布后恢复会丢失回滚依据。现已纳入 v17：[mod.rs:83](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/backup/mod.rs:83>)。
- 恢复按前驱拓扑插入，清空按逆序删除，外键保持开启：[mod.rs:1206](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/backup/mod.rs:1206>)。
- 冻结 v16 格式，旧备份不猜测前驱：[mod.rs:103](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/backup/mod.rs:103>)。
- 无未验证猜测作为结论提交。

【Linus式方案】已实现并验证：

- [backup_release_history.rs:175](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/backup_release_history.rs:175>)：Prompt/Skill 真实乱序发布、无损恢复、连续回滚、外键及拓扑顺序。
- [backup_release_history.rs:297](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/backup_release_history.rs:297>)：v16 恢复不伪造历史；另覆盖旧格式和坏包约束。
- [backup_full_roundtrip.rs:534](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/backup_full_roundtrip.rs:534>)：更新现有备份回归。

仅运行 `cargo test -p ielts-db --test backup_full_roundtrip --test backup_release_history`：**15 项通过，0 失败**。未运行完整 static/E2E，未提交或推送。


