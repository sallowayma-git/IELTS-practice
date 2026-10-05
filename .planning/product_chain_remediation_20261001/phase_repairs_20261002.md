# 六阶段修复回执（未代替集成验收）

## 01a0fc37-896b-7e62-ae07-74762eb3c0b2
【核心判断】已修复 exact rollback，定向测试 **21 passed，0 failed**。

【关键洞察】

修改仅涉及：

- [DB 实现](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/prompt_skill.rs>)
- [定向测试](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/prompt_skill.rs>)
- [0025 迁移](<F:/workspace/IELTS Atlas APP/crates/ielts-db/migrations/0025_prompt_release_predecessor.sql>)
- [迁移注册](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/migrate/mod.rs>)

保存真实发布前驱与当前链头；Prompt/Skill 均覆盖 v1→v3→v2 回滚两次，准确恢复 v3→v1。历史缺记录明确拒绝，迁移不猜前驱。发布、回滚写失败均验证事务原子性。

验证：`cargo test -p ielts-db --test prompt_skill --locked --offline` 通过；限定文件 `git diff --check` 通过。首次测试遇到范围外编译错误，重试已通过。

【Linus式方案】

剩余缺口交主线程：可信 eval 收据、完整阶段门禁、生产 registry 消费及 invocation 版本固定。本次未改这些入口，未跑完整 static/E2E，未提交推送。

## 01a0fc37-8896-77a3-9685-6735bad52db9
【核心判断】✅ 已闭合结构化 probe 的 proposal→DB→重开加载链路，无数据库迁移。

【关键洞察】

修改文件：

- [domain/agent_thread.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-domain/src/agent_thread.rs>)：统一 proposal 适配及 JSON 编解码。
- [db/agent_thread.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/agent_thread.rs>)：写入时验证，非法 probe 整体事务回滚。
- [db/tests/agent_thread.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/agent_thread.rs>)：数据库重开、旧记录兼容及非法输入测试。
- [cognitive_runtime.rs](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs>)：仅修改 `study_plan.create` 和对应测试。

现有 TEXT 列保存完整 probe JSON，保留 `probeKind/avoidAssetIds/reasonCodes`；收到的 `targetDate` 正常持久化。旧技能字符串保持原格式。类型复用五种 canonical enum；避题最多 32 个，每项非空、唯一、无控制字符、最多 128 字符。

定向测试全部通过：

- Domain `agent_thread`：6/6。
- DB `--test agent_thread`：23/23。
- Tauri `study_plan_create_uses_lossless_proposal_adapter`：1/1。
- 指定文件 `git diff --check`：通过。

【Linus式方案】剩余交主线程接线：Python proposal 当前不发送 `targetDate`；UI 直接展示 `item.skillProbe`，需适配新对象。旧 wire DTO 和 import 因位于禁止修改段而保留，产生 unused 警告。线程执行、负荷与偏好输入仍未补齐。未运行完整 static/E2E，未提交推送。

## 01a0fc37-8b4e-7900-b304-00f3d2f9fc25
【核心判断】

已修复 Memory 证据抽屉：展示关联观察原文、事件原始记录、来源及练习导航。

【关键洞察】

修改文件：

- [AgentConsolePage.vue](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/views/AgentConsolePage.vue>)
- [learning-repository.js](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/api/learning-repository.js>)、[对应声明](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/api/learning-repository.d.ts>)
- [format.js](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/modules/agent-console/format.js>)
- [memoryEvidence.test.mjs](<F:/workspace/IELTS Atlas APP/developer/tests/js/memoryEvidence.test.mjs>)

只沿 memory→observation→event 引用读取，过滤无关及跨用户记录；上限为 20 条观察、50 条事件。加载、失败重试、空结果、缺失和截断分别提示；支持键盘操作、Escape 收起及焦点恢复。

【Linus式方案】

验证结果：

- 独立 JS 测试：13/13 通过，退出码 0。
- Vue typecheck：通过，退出码 0。

剩余缺口：现有 learning DTO 不含答案正文，需通过练习导航核验；打包端导航及读屏实测留给主线程。未运行 visual 或共享报告测试，未修改范围外功能。

## 01a0fc37-8d40-7091-ae9b-f48f135fef20
【核心判断】✅ 已修复 daily dream 证据关联断点。

【关键洞察】

- 每个 `memoryEvent` 从 `memory_evidence` 提供当天、同用户的真实关联证据。
- Python 按 memory ID 选择证据，并遵守输入上限；缺关联生成 NOOP。
- Rust 在同一事务内复核目标、用户、日期及投影身份，再写入 pending。合法五类提案和 NOOP 保持可用。

修改路径：

- [domain journal.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-domain/src/journal.rs>)
- [DB journal.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/journal.rs>)
- [DB dream.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/dream.rs>)
- [Rust journal 测试](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/journal.rs>)
- [Python types.py](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/dream/types.py>)
- [daily_dream.py](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/dream/daily_dream.py>)
- [Python daily dream 测试](<F:/workspace/IELTS Atlas APP/agent-runtime-python/tests/test_daily_dream.py>)

【Linus式方案】定向验证完成：

- Rust `journal`：17/17；`journal_lifecycle`：6/6。
- Python `test_daily_dream.py`：15/15；`test_journal_enrichment.py`：11/11。
- 指定文件 `git diff --check` 通过。

仍未解决：worker 自动执行、真实 mastery delta、生产 enrichment 接线。未修改 Vue，未运行共享报告的完整 static/E2E，未调用真实 provider、提交或推送。

## 01a0fc37-8c46-70d1-a759-3e0a8186c5de
【核心判断】✅ 已修复，既有生命周期传播改动已保留。

【关键洞察】

修改文件：

- [DB consolidation](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/consolidation.rs>)
- [定向测试](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/consolidation.rs>)
- [domain 合同](<F:/workspace/IELTS Atlas APP/crates/ielts-domain/src/consolidation.rs>)

独立证据从真实 observation→event→attempt 推导资产、题目、session、技能；不再猜标签键。缺失、跨用户、predicted 证据拒绝。apply 事务内重验并比较证据及内容快照；变化即拒绝。新 consolidated memory 保留已验证 lineage。

【Linus式方案】已落实并验证：

`cargo test -p ielts-db --test consolidation --locked --offline`

**39 passed；0 failed；0 ignored。** 覆盖同题同 session、缺证据、跨用户、独立证据通过、validate/apply 间变化拒绝及生命周期回归。限定文件 `git diff --check` 通过。

剩余接线：runtime/weekly 由主线程处理，需完整保留新增 `evidenceSnapshot`；旧无快照 DTO 会拒绝 apply。完整 static/E2E 未运行，交主线程统一执行。

## 01a0fc37-8a54-7fb0-8d28-e15bed0df5b9
【核心判断】✅ 已修复 DB 统计与归因边界，无需新增迁移。

【关键洞察】

修改路径：

- [DB 实现](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/teaching_strategy.rs>)
- [定向测试](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/teaching_strategy.rs>)
- [Domain 合同说明](<F:/workspace/IELTS Atlas APP/crates/ielts-domain/src/teaching_strategy.rs>)

满意度不再增加学习成功／失败计数；归因核验持久化 observation 和支持事件的用户、时序、技能、资产。窗口截止目标观察；重复题不奖惩，重试不重复计数。分差从可比的既有得分推导，无基线保持未知。历史缓存与旧 outcome 在读取、选择时重验重算，不继续消费点赞污染。

【Linus式方案】

验证：`cargo test -p ielts-db --test teaching_strategy --locked --offline`：**21 passed，0 failed**；限定文件 `git diff --check` 通过。

交主线程缺口：当前生产写作事件的 `asset_id`、`skill_key` 均为空，需补真实资产与技能来源；本实现缺证据即拒绝归因。生产 Coach／wire 接入、探索累计硬上限及完整 static/E2E 未在本轮处理。


