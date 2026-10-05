# M12–M7 阶段审计回执（2026-10-02）

当前工作树核验，六阶段均为部分完成；专项合同不等于产品 DoD。

## 01a0fc30-d947-7d41-b9f9-32f81e353b64

【核心判断】

基于当前信息，我的理解是：只审计 M10，交付下一轮修复依据。本轮已完成只读核查，未编辑、派代理或调用真实 provider。

M10 **部分完成，生产闭环未完成**。品味评分：🔴。致命问题是“满意度≠学习效果”仅在分表层面成立，Rust 聚合又将两者混合。当前 canonical Coach 未提交改动已纳入核查；下述缺口仍存在。未发现应定为 P0 的证据。

【关键洞察】

| 关键 DoD | 判定 | 实际证据 |
|---|---|---|
| M10-01 固定八策略及定义 | 完成（合同层） | migration/catalog 包含八项及要求字段；不代表八种 prompt 已在线消费 |
| M10-02 每次回答记录完整 assignment | 部分 | 独立持久化接口存在；生产 Coach 完成回答未写 M10 assignment |
| M10-03 双 reward channel | 部分 | 分表成立，聚合污染 effectiveness |
| M10-04 relevant window、novel、无未来不归因 | 部分 | Python 纯算法覆盖；Rust authority 未守住边界 |
| M10-05 用户×scope 状态 | 部分 | 可持久化；confidence 被点赞污染，scope 被压成 activity |
| M10-06 规则选择、exploration cap | 部分 | Rust 选择器存在；缺少 confidence>0.5 条件，hash 概率不是累计硬上限 |
| M10-07 尊重偏好、解释冲突、给选择 | 部分 | Python 有建议逻辑；生产消费者未接入 |
| M10-08 开发者模块＋离线 eval | 部分 | Rust 结构安全门成立；不能证明效果 eval 或上线 |
| 三个解释性 DoD／关闭个性化 | 未完成（产品层） | 当前生产调用链不能完成策略依据与历史效果解释；关闭控制未贯通 M10 |

最多三个优先断点，均为 P1：

1. **满意度伪造学习有效性。**  
   [teaching_strategy.rs:309](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/teaching_strategy.rs:309) `record_strategy_feedback`：点赞在337行增加 `success_count`，追问/差评增加 `failure_count`；549行据此重算 confidence。现有 `user_strategy_state_aggregates_confidence_bounded` 测试甚至用“两点赞、一差评”断言 confidence=2/3。这是测试固化错误语义。  
   **write set：** `crates/ielts-db/src/teaching_strategy.rs`、`crates/ielts-db/tests/teaching_strategy.rs`；若修复零证据先验，再加 `crates/ielts-domain/src/teaching_strategy.rs`。存量污染数据需设计重建迁移。

2. **Rust 归因可在无真实未来证据时记成功。**  
   [teaching_strategy.rs:364](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/teaching_strategy.rs:364) `record_strategy_outcome`：`observation_id` 可省略；395行仅凭 `novel_asset_id.is_some()` 判断新资产，成功判定不消费 `score_delta`。  
   [同文件:448](F:/workspace/IELTS%20Atlas%20APP/crates/ielts-db/src/teaching_strategy.rs:448) `count_subsequent_observations` 忽略 `_skill_keys`，计入全部后续观察；没有围绕目标 observation 核验用户、技能、时序及资产。重复资产还增加失败数。  
   **write set：** 同上两个 DB 文件＋`crates/ielts-domain/src/teaching_strategy.rs`。只读依赖 learner observation、context 数据合同；无需修改当前 learner/context/corpus 区。

3. **生产接入缺失，Python↔Rust wire 也不兼容。**  
   [enrichment.rs:179](F:/workspace/IELTS%20Atlas%20APP/src-tauri/src/commands/enrichment.rs:179) `coach_run` 调用当前 `CoachService::run`；其回答链无 M10 select/assignment，DB `complete_coach_run` 只写消息及线程状态。全源检索未发现生产实例化 `StrategyEvaluationOrchestrator`。  
   [strategy_eval.py:658](F:/workspace/IELTS%20Atlas%20APP/agent-runtime-python/src/ielts_agent/coach/strategy_eval.py:658) 发 `{attribution}`，select 发 `{selection}`、assignment 发 `{assignment}`；[cognitive_runtime.rs:1614](F:/workspace/IELTS%20Atlas%20APP/src-tauri/src/cognitive_runtime.rs:1614) 分别要求 `{command}`／`{query}`。`user_state` 请求/响应形状也不一致。  
   **write set／跨域依赖：** 无完全避开 Coach 的独立闭环修复。需主线程整合 `crates/ielts-application/src/coach.rs`、`ports.rs`、`src-tauri/src/commands/enrichment.rs`、`cognitive_runtime.rs`，以及 Python `coach/strategy_eval.py` 和对应测试；不建议探子并行写这些当前修改区。

【Linus式方案】

先修两个 DB authority 断点，再由主线程接入生产消费者。最小 fixture：点赞不改变学习计数；无 observation 不归因；无关技能不占窗口；旧/他人 observation 拒绝；重复资产不惩罚；真实序列贯通 wire→DB→再次选择。

本轮实测 Python M10 测试 **65/65通过**，仅证明现有测试，不能证明 wire 或生产闭环。修复后最小回归：

```text
cargo test -p ielts-db --test teaching_strategy --locked --offline
cargo test -p ielts-application --test teaching_strategy --locked --offline
python -B -m unittest discover -s agent-runtime-python/tests -p test_strategy_eval.py
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

本轮未运行会写报告/截图的全库门禁。代码修复、存量数据库重建、真实 provider／用户 longitudinal canary、提交推送均超出本轮只读授权。

## 01a0fc30-d82c-7f02-b21a-3ef089e12dc7

【核心判断】

M11 **部分完成，不能通过产品完成度 gate**。已完成 registry 持久化与生产权限封堵；可信评估、完整发布链和生产消费尚未闭环。最新 ADR/gate 附录也承认这些缺口。

本轮仅只读核验，未编辑、派代理、调用 provider 或运行会生成文件的测试；未将其他阶段及 canonical Coach 的未提交改动判为缺失。

【关键洞察】

| 关键要求 / DoD | 状态 | 实际证据 |
|---|---|---|
| M11-01/06：Soul 稳定、禁止在线自改 | 完成（权限边界） | Webview 无评估/批准/发布/回滚命令；Sidecar 发布及评估记账被拒 |
| M11-02：10 类 Prompt registry | 部分 | schema/service/read IPC 存在；生产 Agent 仍消费常量 |
| M11-03：Skill 独立版本化 | 部分 | 与用户 memory 分表；未形成生产执行及版本 trace 闭环 |
| M11-04：8 类 eval、holdout 隔离 | 部分 | 合成 fixtures 与过滤接口存在；缺可信候选执行、基线对照及隔离证据 |
| M11-05：完整 candidate lifecycle | 部分 | 提议、评估记账、批准、晋升存在；holdout/shadow/canary 可跳过 |
| M11-05：exact rollback | 部分 | 两版本场景覆盖；按版本号选历史版本，不保存发布前驱 |
| M11-07：问题→候选→评测→受控发布 | 未完成 | Python 本地 grading 不成为权威收据；生产发布入口已关闭 |
| M11-08：graders、每次 invocation 固定版本 | 部分 | graders 存在；生产 trace 只有 prompt hash，缺 Prompt/Skill version |
| DoD：提出者、问题、评测、改善、退化、回滚 | 部分 | 有字段与合同测试；没有贯穿生产变更的可信证据链 |

**【品味评分】🟡**：收回生产发布权是正确修复；枚举和表不能替代状态迁移与消费者。

三个优先 **P1**，未发现仍暴露的 M11 P0：

1. **评估收据自报，完整生命周期仍可绕过。**  
   [prompt_skill.rs:682](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/prompt_skill.rs:682>)，`record_eval_in_transaction`：`all(|g| g.passed)` 直接信任调用方；仅要求结果非空和 case 存在。`approve_candidate:754` 只查 `EvalPassed`，`promote_candidate:786` 只查 `Approved`，不要求 holdout/shadow/canary。Python `EvalOrchestrator._run_eval:288` 固定 `recorded=False`。  
   **write set**：`crates/ielts-{domain,application,db}/src/prompt_skill.rs`；`agent-runtime-python/src/ielts_agent/eval/{runner,cases,graders}.py`；两 crate 的 `tests/prompt_skill.rs`；Python `tests/{test_runner,test_graders}.py`；新增 `developer/tests/ci/m11_release_gate_probe.py`。持久化实验身份/阶段收据需新增迁移，不改冻结任务书或已发布迁移。

2. **registry 未进入生产消费，版本固定未兑现。**  
   [agent.rs:171](<F:/workspace/IELTS Atlas APP/src-tauri/src/commands/agent.rs:171>)，`agent_run` 直接使用 `AGENT_SYSTEM_PROMPT`；`agent_run_attempt_review:244` 同样使用常量。[agent.rs:318](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/agent.rs:318>)，`AgentRunTrace::result_json` 只有 `promptHash`，无 registry Prompt/Skill ID。  
   **write set**：`src-tauri/src/commands/agent.rs`、`crates/ielts-application/src/{agent,prompt_skill}.rs`及对应测试。先完成断点 1，再接 active bundle。全模块接入依赖 Coach/Dream/Planner 消费者；Coach/context 当前修改区交主线程协调，禁止探子直接扩域。无需先修改 `application_store.rs`。

3. **“exact rollback”缺真实发布前驱。**  
   [prompt_skill.rs:906](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/prompt_skill.rs:906>)，`rollback_version` 使用 `status='rollback' ORDER BY version DESC LIMIT 1`。最小反例：创建 v1/v2/v3，按 v1→v3→v2 发布；回滚 v2 应恢复 v3；再回滚 v3 应恢复 v1，当前查询会重新激活 v2。  
   **write set**：DB `src/prompt_skill.rs`、`tests/prompt_skill.rs`，新增发布前驱迁移；若扩展 DTO，再含 domain `src/prompt_skill.rs`。与断点 1 同文件，宜合并一项修复任务。

【Linus式方案】

先建立不可伪造的实验收据及发布前驱，再强制阶段迁移，最后接生产 bundle 和 invocation 版本固定。

最小回归：DB/application 各执行 `cargo test -p ielts-db --test prompt_skill --locked --offline`（application 替换包名）；Python 定向跑 `test_runner.py`、`test_graders.py`。新增 fixtures：漏 holdout/重复 case、伪造通过、缺 shadow/canary拒发布、乱序发布连续回滚、运行中版本不变。

修复后按仓库要求依次运行 `python developer/tests/ci/run_static_suite.py`、`python developer/tests/e2e/suite_practice_flow.py`。

本轮授权仅审计；实际编辑需进入修复 loop。真实 provider、付费评估、真实用户数据 shadow/canary、生产发布及提交推送需另获授权。

## 01a0fc30-db7d-7190-9039-3bea983edda6

【核心判断】

M8 **部分完成，生产闭环未完成**。品味评分 🟡：持久化与失效传播已有实质实现，但周度入口、候选池和独立证据验证仍断链。无 P0；以下 3 个 P1 优先修复。

按当前工作树审计，未把其他阶段及 canonical Coach 未提交改动判成缺失。未编辑、派代理、调用真实 provider 或提交推送。

【关键洞察】

| 关键要求／DoD | 状态 | 核验结果 |
|---|---|---|
| 周度生产触发、durable job、冷却与新增证据门槛 | 未完成 | sidecar 无周度 dispatch；队列拒绝 weekly；两个配置字段无执行消费者 |
| M8-01 四条 pattern gate | 部分 | prompt 有约束；Rust 核对标签多样性，未证明抽象性、新价值、可证伪性 |
| M8-02 stable ID、并发重验 | 部分 | owner 与状态校验已接入；apply 未核对证据／内容版本变化 |
| M8-03/04 独立练习证据 | 部分 | 数 memory 行、subject_key／scope；未加载 observation/event 证明独立 |
| M8-05 类型及禁诊断 | 完成 | 类型枚举与 statement guard 已落地 |
| M8-06 lineage、不删除、审计、撤销 | 部分 | relation 与 superseded 已落地；整合 mutation audit、恢复 supports 的撤销路径未找到 |
| M8-07 improvement/regression | 部分 | 失效递归归档已实现；Improve/Regress 写路径未接传播，全 supports 改善只衰减 |
| M8-08 分类型过期 | 部分 | stale sweep 已实现；goal validity-driven 无实际到期处理 |
| M8-09 用户纠正 | 完成 | UI→command→事务反馈／递归归档，保留事实与 lineage |
| M8-10 predicted 不自动晋升 | 完成 | Rust 拒绝 predicted support；候选池过滤仍有问题 |
| 合法空输出成功、解析失败不更新冷却、冻结集全回放 | 部分 | 空输出成功；解析失败被混作成功；未找到完整冻结集生产链回放 |

实测：`test_weekly_dream.py` **38/38 通过**。本轮未运行 Rust 或全库门禁；既有测试通过不能证明上述闭环。

【Linus式方案】

1. **P1：周度 orchestration 没有生产入口，运行门槛也未执行。**  
   [runtime.py:73](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/runtime.py:73>) `RuntimeServer._dispatch` 只处理 `dream.daily`；`protocol.py:11` 未公布周度 capability。`background_jobs.rs:85` 的 `enqueue_job` 只接受 daily 两类。`ConsolidationConfig.min_new_evidence/cooldown_days` 只有定义和 fixture 赋值。另 `weekly.py:492` `_parse_pattern_output` 把解析失败变成 `[]`，最终提交成功；`test_weekly_dream.py:522` 明确固化这一错误行为。  
   **write set**：Python `runtime.py`、`protocol.py`、`dream/weekly.py`、`tests/test_protocol.py`、`tests/test_weekly_dream.py`；Rust `src-tauri/src/commands/journal.rs`、`crates/ielts-db/src/background_jobs.rs`、新增前向 migration 与专用 gate 测试。  
   **依赖**：须协调当前已修改的 `src-tauri/src/cognitive_runtime.rs`，接 host 周度请求；涉及启动补跑时还需 `src-tauri/src/lib.rs`。不必修改 application_store。

2. **P1：候选池给模型空摘要，pending 候选还能使整个池失败。**  
   [cognitive_runtime.rs:1937](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs:1937>) `load_candidate_pool` 忽略 `_window`，固定 Reading；返回只有 `memoryId/key/pendingVerification`，没有 `summary/scope`。Python `_fetch_candidate_pool` 于是归一化为 `summary=""`。preview 还包含候选 ID，而 Python 要求 `mem-*`，遇到 candidate ID 即 fallback。  
   **write set**：`src-tauri/src/cognitive_runtime.rs` 的该函数及合同测试；`agent-runtime-python/tests/test_weekly_dream.py`。如需专用有界查询，再加 `crates/ielts-db/src/consolidation.rs`、`tests/consolidation.rs`。  
   **依赖**：与断点 1 共用 runtime 文件，应由同一修复任务处理；读取当前 evidence 数据即可，避免修改 learner/context/corpus。

3. **P1：memory 多样性被冒充为练习证据独立性。**  
   [consolidation.rs:394](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/consolidation.rs:394>) `validate_one` 用 `verified.len()` 判断 ≥3 supports；缺 subject_key 时回退 canonical_key 判 asset。生产 `insert_active_memory` 未写 subject_key，因此不同标签可能冒充不同资产。validator 不查询 `memory_evidence`，三个无练习证据的行也能通过现有 fixture。  
   **write set**：`crates/ielts-db/src/consolidation.rs`、`crates/ielts-domain/src/consolidation.rs`、`crates/ielts-db/tests/consolidation.rs`。  
   **修复**：从稳定 observation/event ID 推导真实资产、题目、session 与技能多样性；证据缺失即拒绝，并在 apply 事务内重验。只读依赖 evidence/observation/event 表，无需改其所属模块。

最小回归：周度 Python 测试、`cargo test -p ielts-db --test consolidation --locked --offline`、Tauri journal/runtime 专项。补 fixture：冷却内／新增证据不足、畸形 JSON 不完成运行、真实 host 池字段、pending/predicted 混池、三标签同题同 session、无 evidence、验证后证据变化。

修复后按顺序跑 `run_static_suite.py`、`suite_practice_flow.py`。本轮只读授权；实际编辑、真实 provider／付费评测、提交推送均需新增授权。

## 01a0fc30-da65-7d42-aa80-908226a4eff1

【核心判断】

M9 **部分完成，不能通过完整 DoD**。真实目录、反馈、归档／遗忘链已存在；“验证证据”和“治理显式偏好”未闭环。未发现有充分证据的 P0。

按当前工作树审计，已计入未提交改动；未编辑、派代理、调用 provider 或提交推送。历史要求仅取冻结任务书 M9 章及对应 ADR、stage gate。

【关键洞察】

| 关键 DoD | 状态 | 实际证据／缺口 |
|---|---|---|
| M9-02 六分区、看见记忆 | 部分 | AgentConsole 读取真实 catalog；显式偏好、pending candidate 不在目录中 |
| M9-03 卡片与纠正 | 部分 | statement、状态、置信档、证据计数存在；namespace/scope/首次末次时间未展示；只有准确／不准确，缺部分准确、过时、编辑、暂停入口 |
| M9-04 验证证据 | 未完成 | 抽屉只有数量文案，无原文、事件读取或练习跳转 |
| M9-05 来源区分 | 部分 | 标签、颜色存在；真实 predicted candidate 未进入目录，不能算完整覆盖 |
| M9-06 自上次访问变化 | 部分 | localStorage marker 存在；用 support/contradiction 数量猜改善、复发，缺真实状态变化及 mastery delta；读取失败也更新 marker |
| M9-07 Dream Report | 未完成 | 今日 journal 摘要及后台任务数量不能替代逐次 Daily／Weekly 报告 |
| M9-08 禁止伪精确评分 | 完成 | 展示 low/medium/high，无人格百分比；零证据不得显示高置信的保护未落实 |
| 禁用、删除／归档 | 部分 | memory_items 的 CAS 归档、脱敏遗忘、依赖失效和 Context 排除有实现及测试；显式偏好不能撤回 |
| 测试 DoD | 部分 | 契约、归档/遗忘数据库测试、mock 移动布局存在；未证明真实证据导航、完整键盘/读屏及变化语义 |

旧 stage gate 的“默认 flag off”已过时：`main.js:37` 由默认开启的 `agentWorkspaceV1` 注册入口，`memoryCenterV1` 不控制该路径；旧报告不能证明当前默认入口的回归情况。

以下路径均相对仓库根。为压缩 write set：`V=apps/writing-vue/src`，`D=crates/ielts-db`，`H=src-tauri/src`，`T=developer/tests`。

1. **P1：证据抽屉无法验证结论。**  
   `V/views/AgentConsolePage.vue:573`，`toggleEvidence` 只切换 ID；`:591`，`evidenceCopy` 只调用数量摘要；`:1011` 抽屉渲染纯文本。已有 `H/commands/learning.rs:60,70` 两个只读命令及事件的 attempt/question 字段，因此不是“后端完全缺失”。  
   **write set：** `V/views/AgentConsolePage.vue`、`V/api/learning-repository.{js,d.ts}`、`V/modules/agent-console/format.js`、`T/e2e/agent_workspace_visual_check.py`。复用现有只读命令；无需碰当前主线程修改区。

2. **P1：生效显式偏好对用户不可见、不可撤回。**  
   `D/src/memory.rs:501`，`load_memory_catalog` 只查 `memory_items`；`:1308`，`load_explicit_context` 仍消费 `explicit_user_preferences.status='active'`。`V/views/AgentConsolePage.vue:555` 的 `pinExplicitPreference` 没有模板调用；用户设定还被排除归档／遗忘按钮。  
   **write set：** `D/src/memory.rs`、`D/tests/memory_profile_core.rs`、`H/commands/memory.rs`、`H/lib.rs`、`V/api/memory-repository.{js,d.ts}`、`V/views/AgentConsolePage.vue`、`T/js/practiceVueShell.test.js`。新增按 local 用户、key、scope 查询和撤回命令，可在现有命令文件用 `db.with_conn` 接入，避免改 `application_store.rs`。

3. **P1：Dream Report 没有生产消费者。**  
   `V/views/AgentConsolePage.vue:260`，`dreamJobs` 只筛后台任务；`:269` 只汇总首条 journal；`:841` 显示数量。`H/commands/journal.rs:395`，`background_job_status` 返回任务状态，不包含 proposal、accepted/rejected、窗口和逐次 memory changes。  
   **write set：** `D/src/dream.rs`、`D/tests/m9_dream_report.rs`（新增）、`H/commands/journal.rs`、`H/lib.rs`、`V/api/memory-repository.{js,d.ts}`、`V/views/AgentConsolePage.vue`、`V/modules/agent-console/format.js`、`T/e2e/agent_workspace_visual_check.py`。只读投影优先；若 Weekly 缺结构化拒绝／跳过原因，需明确依赖 M8 补持久化，不能从任务状态猜。

【Linus式方案】

先修真实治理与证据链，再补报告；三个修复共享 Vue 页面，需串行合并。所有 QA 留在 `developer/tests/`，不触碰 Coach、learner/context/corpus 修改区。

本轮实测 `node developer/tests/js/practiceVueShell.test.js` **通过**，仅证明契约。

最小新增 fixture：真实 SQLite 的 memory→observation→event→attempt；active preference 撤回后 Context 立即排除；Daily/Weekly 成功、拒绝、跳过、失败重试报告。mock 仅验展示。

修复后定向跑 `cargo test -p ielts-db --test memory_profile_core --test cognitive_read`，随后按仓库要求依次运行：

```text
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

本轮只读未运行会写报告／截图的门禁。实施修复、真实 provider、真实用户 canary、提交推送均需新增授权。

## 01a0fc30-d717-7cb3-897f-6a97da2f3cc4

【核心判断】

M12 **部分完成，产品闭环未通过**。已有真实持久化、planner 入口、计划面板、审批卡和协作取消；旧报告“UI 未升级”已过时，但契约测试通过仍不能证明线程恢复和动作执行闭环。未发现可确认的 P0，以下三个 P1 应进入本阶段修复 loop。

本轮仅只读检查，未运行生成报告或构建产物的测试；已按当前脏工作树核验，没有把其他阶段及 canonical Coach 改动判为缺失。

【关键洞察】

| 关键 DoD | 状态 | 核实结果 |
|---|---|---|
| 六表 migration、持久化 | 完成 | 0022、DB/application 实现及数据库测试存在 |
| M12-01 多轮线程 | 部分 | CRUD、序列、summary 槽存在；生产运行未关联线程，context scope 未闭环 |
| M12-02 checkpoint/cancel/retry | 部分 | token、启动 interrupted 标记存在；运行 loop 未写线程 checkpoint，child retry/replay 未接线 |
| M12-03 学习工作台 | 部分 | 学习读取、计划、文件 trace 可用；持久对话与受控动作仍断开 |
| M12-04 planner | 部分 | Python→reverse-RPC→Rust→SQLite→面板已接通；负荷、偏好及用户目标输入不足 |
| M12-05 skill probe | 部分 | Python 使用结构化 probe；持久化丢失 probe 类型和避题信息 |
| M12-06 controlled actions | 部分 | 禁止能力边界、审批记录有效；批准后没有动作执行 |
| M12-07 不强加 embedding | 完成 | 符合 Accepted ADR；无需以 live model 验证确定性 planner |
| M12-08 UI | 部分 | 计划、审批、取消、trace 已有；线程选择/历史恢复/child retry 未完成 |
| restart、重试、副作用回归 | 部分 | 当前测试主要手工创建 checkpoint/approval，未覆盖生产闭环 |

**1．P1：生产运行绕过线程与恢复状态机。**

证据：[agent.rs:359](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/agent.rs:359>) `AgentService::run` 每次从 system/user 两条消息开始；`RunAgentCommand` 没有 thread/context/parent 字段。前端 [AgentConsolePage.vue:720](<F:/workspace/IELTS Atlas APP/apps/writing-vue/src/views/AgentConsolePage.vue:720>) `runAgent` 只传 grant、prompt、runId；`threads` 仅加载赋值，没有对话消费者。因此生产运行不会产生供 `restart_recovery` 恢复的线程 checkpoint。现有取消有效，但仅在模型/工具调用之间检查。

建议 write set：`crates/ielts-application/src/agent.rs`、`src-tauri/src/commands/agent.rs`、`apps/writing-vue/src/api/{agent-repository,agent-thread-repository}.js`、`apps/writing-vue/src/views/AgentConsolePage.vue`；新增 `src-tauri/src/agent/thread_store.rs` 接现有 DB API，避免修改 `application_store.rs`。

**2．P1：审批只改状态，批准不会执行动作。**

证据：[agent_thread.rs:510](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/agent_thread.rs:510>) `decide_approval` 只更新 `status/approved_by/decided_at` 后返回；host command 直接委托它。前端 `decidePendingApproval` 随即移除审批卡。未找到四种 approval-gated 动作的生产执行消费者。批准卡消失不等于行动完成。

建议 write set：`crates/ielts-application/src/agent_thread.rs`、`crates/ielts-db/src/agent_thread.rs`、`src-tauri/src/commands/agent_thread.rs`、`apps/writing-vue/src/views/AgentConsolePage.vue`；新增 `src-tauri/src/agent/controlled_actions.rs`。必须记录执行结果并按 approval ID 幂等。跨域依赖：Memory/设置/长期计划的既有 authority API；缺少 API 时另列依赖，不能直接侵入当前 learner/Coach 修改区。

**3．P1：planner 约束输入与持久化信息不完整。**

证据：[agent.rs:366](<F:/workspace/IELTS Atlas APP/src-tauri/src/commands/agent.rs:366>) `study_plan_run` 未传近期负荷和偏好，Python 默认 `0/{}`；UI 固定目标和 60 分钟。技能/不确定性已有 host enrichment，不应判为缺失。另 [cognitive_runtime.rs:1873](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs:1873>) `study_plan.create` 仅保存 `skill_key`，丢弃 `probeKind/avoidAssetIds`，并写 `target_date=None`。重载后无法保留原 proposal 的避题约束。

建议 write set：`src-tauri/src/commands/agent.rs`、`src-tauri/src/cognitive_runtime.rs`、`agent-runtime-python/src/ielts_agent/planner/{types,study_plan}.py`、`crates/ielts-domain/src/agent_thread.rs`、`crates/ielts-db/src/agent_thread.rs`、`apps/writing-vue/src/views/AgentConsolePage.vue`。`cognitive_runtime.rs` 已有主线程改动，须协调具体修改段；负荷/偏好只消费现有读接口，不改 learner/context/corpus。

【Linus式方案】

【品味评分】🟡；【致命问题】生产运行与 durable thread 是两套分离状态；【改进方向】统一 run/thread 关联，再接 checkpoint 和 approval 执行，保留结构化 probe。

最小 fixture：临时 SQLite＋假模型/工具，覆盖“两轮→重启→历史恢复”、取消与 child retry、写工具不自动重放、同一审批重复点击只执行一次、重载 probe 保留避题信息及 heavy workload/偏好约束。

定向回归：

```text
cargo test -p ielts-db -p ielts-application --test agent_thread --locked --offline
cargo test -p ielts-practice-tauri --lib --locked --offline
```

Python 环境中运行 `test_study_plan.py`、`test_planner_types.py`。修复后依次执行仓库规定的静态套件和 packaged practice flow，并新增上述生产链 fixture；现有 mock/手工种表测试不足。

编辑修复、真实 provider 验证、提交及推送均超出本轮只读授权；确定性闭环修复不需要真实 provider。

## 01a0fc30-dc9b-7373-a1cc-1ed641b186b8

【核心判断】

M7 **部分完成，不能判定生产 DoD 通过**。SQLite 持久化、手动 sidecar 路径成立；自动执行、事实语义和证据关联存在 P1 断点。无已证实 P0。

仅提取冻结任务书 M7 章节，完整核对对应 ADR/gate；按当前工作树审计，未将其他阶段及 canonical Coach 未提交改动误判为缺失。

【关键洞察】

| 关键要求 | 完成度 | 实际证据与缺口 |
|---|---|---|
| M7-01 durable worker | 部分 | 原子 claim、lease、retry 已实现；无自动消费者，生产 heartbeat/checkpoint 未闭环 |
| M7-02 触发 | 部分 | 启动补入队、手动运行成立；启动自动执行、idle/日界线执行未成立 |
| M7-03 精确 facts | 部分 | 有真实表聚合，但平均 outcome 冒充 learner delta，attempt 数包含未提交记录 |
| M7-04 enrichment | 未完成生产接入 | `JournalEnricher` 有测试；生产 orchestrator 未调用、未持久化其输出 |
| M7-05 versioned journal | 部分 | SQLite 版本/supersede 成立；source 表未接写入；已有日记直接返回旧版本 |
| M7-06 bounded scope | 部分 | 今日 observation/mutation 有上限；相关 active 子集、corrections 未完整接入 |
| M7-07 六类 proposal | 部分 | 手动 Python→Rust→pending 成立，无 active 写旁路；证据关联不可信 |
| M7-08 capacity/失败隔离 | 部分 | 输入输出数量受限；失败保留已有 journal；自动 retry 无消费者 |
| 产品三项 DoD | 部分 | 能显示活动与变更，但变化量错误；待验证观察未接入展示 |

品味评分：🟡。致命问题是把“入队”当执行，把“同一天”当证据关联。

三个优先断点：

1. **P1：catch-up 永久停在 queued。**  
   [lib.rs:36](</F:/workspace/IELTS Atlas APP/src-tauri/src/lib.rs:36>) `run` 明确仅入队、不执行；生产仅手动命令调用 `claim_job_by_id`，没有 `claim_job` 消费循环。现有重启测试验证的是重新入队。  
   **write set：** `src-tauri/src/{lib.rs,app/mod.rs,app/daily_worker.rs（新增）,commands/journal.rs}`、`crates/ielts-db/src/background_jobs.rs`、`developer/tests/ci/m7_worker_probe.rs（新增）`。复用现有 RuntimeManager，补单 worker、heartbeat、明确 day payload、有限重试；不需改 `application_store.rs`。

2. **P1：无关 observation 被当作 memory 证据接受。**  
   [daily_dream.py:308](</F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/dream/daily_dream.py:308>) `_first_evidence_for_memory` 忽略 memory ID，返回 `observation_ids[0]`。[dream.rs:348](</F:/workspace/IELTS Atlas APP/crates/ielts-db/src/dream.rs:348>) `validate_proposal` 只限制数量；没有目标关联、日期或用户校验。只读 fixture 已复现 `mem-reading ← obs-unrelated-writing`。目前落 pending，不应夸大为已污染 active memory。  
   **write set：** `crates/ielts-domain/src/journal.rs`、`crates/ielts-db/src/{journal.rs,dream.rs}`、`agent-runtime-python/src/ielts_agent/dream/{types.py,daily_dream.py}`、对应 `journal.rs/test_daily_dream.py` 测试及新增 DB 验证测试。读取现有 `memory_evidence`，无关联则 NOOP；Rust 落库前复核。无需触碰 Coach/learner/context/corpus。

3. **P1：技能“变化”其实是当天正确率。**  
   [journal.rs:338](</F:/workspace/IELTS Atlas APP/crates/ielts-db/src/journal.rs:338>) `skill_deltas` 使用 `AVG(outcome)` 直接填 `delta`；[format.js:144](</F:/workspace/IELTS Atlas APP/apps/writing-vue/src/modules/agent-console/format.js:144>) `formatSkillDeltas` 将其显示为带符号变化。即使能力下降，当天平均值仍可能显示正增长。  
   **write set：** `crates/ielts-db/src/journal.rs`、`crates/ielts-db/tests/journal.rs`；若需澄清显示语义，再改 `apps/writing-vue/src/modules/agent-console/format.js`。依赖 M4 提供可重放的日初/日末 mastery；若当前无历史基线，需主线程协调该只读契约，不能拿当前值伪造历史。

【Linus式方案】

先消费真实 job，再修证据映射，最后恢复 delta 的数学定义；每个断点单独修复、回归后再审计。

本轮实测：`python -B -m unittest discover -s agent-runtime-python/tests -p test_daily_dream.py` **13/13**；同命令换 `test_journal_enrichment.py` **11/11**。均为 fake host，未调用 provider。Rust/全库 gate 未重跑。

修复最小回归：

- DB：`cargo test -p ielts-db --locked --offline --test background_jobs --test journal_lifecycle --test journal`
- Python：上述两组测试。
- fixtures：漏两天后启动自动完成；跨技能无关证据拒绝；mastery 下降却当天 outcome 为正；读取空日记后新增练习并刷新。
- 最后按序运行 `python developer/tests/ci/run_static_suite.py` → `python developer/tests/e2e/suite_practice_flow.py`。

本轮授权仅审计；编辑修复、运行会生成报告/截图的 gate、真实 provider 验证及提交推送均需另行授权。未修改文件。


