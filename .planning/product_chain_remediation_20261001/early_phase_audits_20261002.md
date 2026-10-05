# M6→M1 阶段审计（2026-10-02）

六个主代理直属审计会话并发完成。部分审计代理试图创建后代，被会话上限拒绝；不将这些未创建后代算作复审证据。

## 01a0fd4d-542d-73f1-9f01-c38135052d74
【核心判断】

确认 **1 个新 P1，无已证实 P0**。M2 quarantine 与 Read Gateway 的信任边界不一致。新的 read repair 已纳入，未重复报告。

多代理派发均因 `agent thread limit reached` 被拒绝，本轮是主线程只读核查，不能算独立并发复审。未修改文件、调用 provider 或运行共享报告门禁。

【关键洞察】

**[P1] 被 projector 隔离的损坏事件，仍可从证据出口返回为 canonical truth。**

- [learning_observations.rs:434](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/learning_observations.rs:434>)，`load_ledger_events` 检查 payload hash；`build_projection` 将损坏事件纳入 quarantine，排除其 observations。
- [cognitive_read.rs:406](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/cognitive_read.rs:406>)，`load_learning_events_by_ids` 仅用 `sensitivity='normal'` 过滤；没有复核 hash 或 projector quarantine。
- [cognitive_read.rs:467](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/cognitive_read.rs:467>)，返回时直接设置 `trust: "canonical_learning_truth"`。生产 reverse-RPC `learning.evidence_by_ids` 调用该出口。

**最小反例：**合法事件 E 的 `isCorrect=false` 被改为 `true`，保留旧 hash。projector 隔离 E，重建后 verify 可以一致；随后按 E 的 ID 读取证据，仍返回修改后的 JSON，并标为 canonical truth。

内存 SQLite 探针已确认实际查询条件返回该事件：`eventReturned=true、hashValid=false、returnedIsCorrect=true`。这是 SQL 层实测＋Rust 调用链确认，**尚未执行完整 Rust gateway fixture，也未证明生产中已有损坏数据**。

【Linus式方案】

【品味评分】🔴。致命问题是隔离决策只约束 observation，证据出口却重新提升信任。

建议隔离 write set：

- `crates/ielts-db/src/learning_observations.rs`：复用事件有效性判定。
- `crates/ielts-db/src/cognitive_read.rs`：返回可信证据前执行同一判定。
- `crates/ielts-db/tests/cognitive_read.rs`：补真实 SQLite fixture。

最小 fixture：真实提交→取得 event ID→修改 payload 保留 hash→确认 rebuild quarantine→调用 `learning_events_by_ids`→断言不得返回可信事件；另覆盖 hash 正确但 band 越界、正常事件、restricted 事件及修复后的确定性重放。

source mutation、跨连接快照一致性尚未形成新的完整复现，不追加为确认 P1。当前授权仅只读审计，修复未执行。

## 01a0fd4d-5091-70c1-9616-b869b93d1d4f
【核心判断】

M5 仍为 Partial：检索与 materialization 合同存在，生产 dispatch、归属和调用审计没有闭环。确认 3 个 P1，无充分证据的 P0。品味评分：🟡；致命问题是把“可以生成 ContextPack”当成“实际调用使用并审计了它”。

已纳入当前 dirty/untracked 实现，未重报 corpus camelwire、正文 render、rank、budget 等已修问题。并发派发全部被系统拒绝：`agent thread limit reached`；以下为主线程只读核验结果，不能称为独立多代理复审。

【关键洞察】

1. **P1：Python 检索和 Context 规划没有生产 dispatch 消费者。**

   [runtime.py:75](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/runtime.py:75>)，`RuntimeServer._dispatch` 只路由 health/shutdown、memory、daily dream、study planner，最后返回 `method_not_found`。[protocol.py:11](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/protocol.py:11>) 的能力表同样没有检索/Context 规划入口。`sync_corpus/run_retrieval/build_context_plan` 在运行时源码中只有定义与导出，没有生产调用者。

   实际 Coach 入口 [enrichment.rs:173](<F:/workspace/IELTS Atlas APP/src-tauri/src/commands/enrichment.rs:173>) → `CoachService::run` → [coach.rs:72](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/coach.rs:72>) `.complete(request)`，没有经过 M5 检索链。canonical Coach 已修，不应据此声称它没有可信题目证据。

   **最小反例：已实测。** 实际 `RuntimeServer` 完成合法握手后，对探测方法 `retrieval.search/context.plan/coach.personalized` 均返回 `method_not_found`。这些名称是探测用例；完整 dispatch 和消费者检索才是缺失结论的依据。

   **建议 write set：** Python `runtime.py`、`protocol.py`、新增 retrieval orchestrator；host runtime 入口及 Coach adapter。  
   **最小真实 fixture：** 临时 canonical SQLite＋真实 Rust corpus DTO＋Python derived SQLite＋假模型，从生产入口贯通 sync→search→plan→materialize→调用，断言模型确实收到选中的 canonical 正文。

2. **P1：snapshot 没有 host run 归属，model gate 不强制消费已 materialize 的 Context。**

   [context.rs:283](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/context.rs:283>)，`ContextMaterializerService::materialize` 固定写 `run_id: None`。反向 RPC [cognitive_runtime.rs:1182](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs:1182>) 只传 plan/scope，没有把可信 active run 传入。

   [cognitive_runtime.rs:1986](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs:1986>)，`invoke_model` 解码 caller 提交的 `CompletionRequest`、校验后直接 `runtime.complete(request)`。[CompletionRequest:31](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/ports.rs:31>) 只有 messages、temperature、maxTokens，没有 snapshot 绑定；validator 也不查询 materialization 状态。

   **最小反例：源码确认，未运行真实 host/provider。** 合法 active trace 内直接请求两条 system/user 消息、temperature=0，即使从未 materialize，也会进入 provider 调用路径；先 materialize 再换成另一份 messages，同样没有正文/hash 一致性检查。

   active trace 和 generation **已有校验**，因此没有证据报告“任意跨 run 冒用”。真实断点是 snapshot 无归属、模型请求不受它约束。

   **建议 write set：** application `context.rs`、新增受控 invocation DTO/service；host `cognitive_runtime.rs`；DB context ownership 校验及专项测试。  
   **最小真实 fixture：** 两个持久化 host run A/B；A 生成 snapshot；假模型调用计数验证缺 snapshot、B 引用 A、正文漂移均零调用，合法 A 恰好调用一次。保留现有 baseline 调用的兼容入口。

3. **P1：M5 调用和检索审计表只有 schema，没有生产写入消费者。**

   [0016 migration:51](<F:/workspace/IELTS Atlas APP/crates/ielts-db/migrations/0016_context_retrieval_trace.sql:51>) 定义 `retrieval_runs`，[同文件:69](<F:/workspace/IELTS Atlas APP/crates/ielts-db/migrations/0016_context_retrieval_trace.sql:69>) 定义 `llm_invocations`；当前 Rust/Python 生产源码检索未找到三张表（含 registry）的写入实现。

   `invoke_model` 和 `invoke_embed` 直接返回结果或错误；[AiRuntime::complete:75](<F:/workspace/IELTS Atlas APP/src-tauri/src/ai/runtime.rs:75>) 也没有 DB 审计依赖。`llm_invocations` 当前还没有 snapshot 关联列。

   **最小反例：源码确认。** 一次成功 completion 返回 model/usage/request ID，但该路径没有插入 invocation；timeout/error 同样没有持久化。snapshot 存在不能解释实际调用使用了什么，也无法关联 Python `rr-*` 检索结果。

   **建议 write set：** 新增前向 migration、DB audit repository、application audit port、host model/retrieval 消费者；不改已发布 migration。  
   **最小真实 fixture：** 临时 SQLite＋假模型成功/失败/超时，检查真实 invocation、host run、snapshot/hash、模型与 prompt 版本关联；检索 receipt 保存 index version、候选数、选中 IDs 和 reasons，避免重复存敏感全文。

【Linus式方案】

先统一可信 host run→snapshot→invocation 数据关系，再接 Python 生产 dispatch，最后由实际执行路径写审计。三个修复都会涉及 `cognitive_runtime.rs`，不能按文件并发修改；DB audit 和 Python orchestration 可隔离准备，host 接线由主线程串行整合。

本轮只执行了无落盘的握手/dispatch fixture；其余为源码核验。未修改文件、调用真实 provider、执行完整 static/E2E 或写共享报告。合同通过不构成 M5 产品 DoD 通过。

## 01a0fd4d-51cb-7641-91d2-35c1def06305
【核心判断】

M4 仍为 Partial。确认 3 个新 P1，未发现有证据的 P0。品味评分：🟡。

已纳入当前 dirty 改动；不重复报告已修的 freshness、用户隔离、wire 和 priority 游标问题。并发派发因会话上限全部失败，本轮由主线程只读核查；以下是源码确认，尚未执行新增真实 fixture。

【关键洞察】

1. **P1：首次提交的后续题目被误判为重复练习。**

   [learner.rs:354](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/learner.rs:354>)，`build_skill_observations` 按 `(user, asset)` 读取上一条时间，并在每道题后更新缓存（418 行）。它没有区分题目和独立 attempt。

   生产 [learning_events.rs:465](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/learning_events.rs:465>) 为同一次提交逐题生成相同时间的事件。因此首次做新材料 A 的 q1、q2，只有排序第一题获得完整 novelty；第二题被按 `<12h` 重复材料处理，novelty×familiarity 从 `1` 降到 `0.025`。mastery、uncertainty 及 novel/repeated 解释随题目顺序失真。

   **隔离 write set：** `crates/ielts-db/src/learner.rs`、`crates/ielts-db/tests/learner_model.rs`。  
   **最小真实 fixture：**真实导入两道不同技能题→首次 `submit_reading_attempt`→读取 snapshot；两题均应是首次证据。再提交同材料，才应用重复折扣；交换题目 ID 不应改变技能权重。

2. **P1：复习 priority 的时间停在最后一次证据，空闲不会增加逾期。**

   [learner.rs:843](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/learner.rs:843>)，`build_states_and_schedules` 将每用户最新 observation 时间作为 `referenceAt`；918、931 行据此计算 overdue 和 recency。读取时返回该派生 schedule，没有当前时间投影。

   **最小反例：**8 月 12 日练习，8 月 14 日到期；10 月 2 日重新读取且没有新练习，逾期项仍为零，`review_due` 不出现。这会影响真实产品：[study_plan.py:302](<F:/workspace/IELTS Atlas APP/agent-runtime-python/src/ielts_agent/planner/study_plan.py:302>) 的 `_order_needs` 直接以 `-need.priority` 排序。

   **隔离 write set：**DB `learner.rs`及其测试；需要显式查询时钟时，再扩展 domain `learner.rs`。  
   **最小真实 fixture：**真实提交后，在固定 `asOf` 下分别读取到期前、到期后；ledger 不变，逾期 priority 和原因应变化，同一 `asOf` 重读应一致。

   这是时间语义缺陷，区别于已修的 ledger→projection freshness。

3. **P1：同 ID 重导入改变题型后，新证据仍消费旧 builtin mapping。**

   [learner.rs:521](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/learner.rs:521>)，`mappings_for_source` 发现已有 active mapping 就直接返回，跳过当前事件的 `questionKind`。`active_mappings` 只按 asset/question 查询，没有资源版本约束。

   [assets.rs:157](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/reading/assets.rs:157>)，`upsert_practice_asset` 允许更新同 ID 的内容和 fingerprint，但没有同步失效旧映射。

   **最小反例：**A/q1 原为 TFNG，读取后生成 builtin map；同 ID 合法重导入为 MCQ，再完成新 attempt。新 MCQ outcome 仍进入 `reading.tfng`，相关技能请求得到错误画像。已修的 Coach fingerprint 绑定不能修复这条 M4 映射链。

   **隔离 write set：**DB `learner.rs`及其测试；若持久化映射的资源版本，再新增前向迁移并注册。  
   **最小真实 fixture：**真实导入 TFNG→提交→读取→同 ID 重导入 MCQ→提交→读取；新旧事件应分别归属正确技能，rebuild/verify 结果一致。

【Linus式方案】

先按独立练习确定 familiarity，再区分可重放的证据时间与调度 `asOf`，最后让映射绑定证据版本。三个修复共用 `learner.rs`，应由主线程串行整合。

相关技能过滤已有真实读入口；priority 也确实进入 UI／planner，不能再笼统报告“无消费者”。但合同通过仍不能证明上述语义正确。

本轮未修改文件、调用 provider、执行 git 写入或运行完整 static/E2E。上述 fixture 是修复验收要求，尚未实测。

## 01a0fd4d-555a-79c0-811c-9c8adaa142bf
【核心判断】

本轮确认 **1 个新 P1，无已证实 P0**。Soul／Profile／ExplicitPrefs 仍为部分完成，不能据合同通过宣布生产闭环。

已纳入当前 dirty 实现，并排除回执中的已修问题。三路子代理均因会话额度已满被拒绝，本轮实际为主线程只读审计，未完成并发独立核验。

【关键洞察】

**P1：调用方可把普通题库正文标成“用户显式偏好”，Rust 未验证分区的来源归属。**

- [context.rs:337](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/context.rs:337>) `validate_plan_ids` 只验证 ID 集合、重复和禁止调用方填写 Soul，没有验证 section 与 canonical source 的对应关系。
- [context.rs:187](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/context.rs:187>) `materialize` 直接采用 `section_plan.section`。
- [context.rs:421](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/context.rs:421>) `render_context` 将这个分类写成 `[EXPLICIT_USER]`。

**最小反例：**引用一个合法 `reading_asset` chunk，把它放进 `EXPLICIT_USER`，保持 ranked／section ID 一致，使用 `internal` scope。当前检查会接受，并将题库正文渲染、持久化到显式用户分区，无需任何 `explicit_user_preferences` 记录。

这是来源归属校验缺失；JSON 引用只能阻止正文伪造分隔符，不能阻止调用方伪造分区。**源码确认，未运行新增 fixture；未证明模型因此覆盖真实偏好。**

其他范围：

- Soul 已由 Rust 编译内置并强制注入；未发现本范围的新 P0/P1。
- ExplicitPrefs 的生产写入固定 `local/user`；未发现实际初始化覆盖用户值的证据。
- 复盘 Agent 确有个人记忆消费者，但关闭个性化尚无贯通控制；与既有回执缺口重合，不计新问题。
- M0 默认 workspace 有 host-owned 路径、重定向拒绝及写权限回退；本轮未确认新缺陷。

【Linus式方案】

【品味评分】🟡。致命问题是**验证了正文身份，却把正文的信任分类交给调用方**。

先由 Rust canonical source 决定允许的 section；当前仅支持题库来源时，拒绝将其放入 `EXPLICIT_USER`。以后接入真实偏好，再使用带用户、scope、来源归属的类型化引用。

**隔离 write set：**`crates/ielts-application/src/context.rs`、对应 `tests/context_materialization.rs`；该实现已有 dirty 改动，后续须串行整合。

**最小真实 fixture：**临时 SQLite 导入真实阅读资产→生成合法 chunk→分别请求 `RETRIEVED_CORPUS` 和 `EXPLICIT_USER`；前者成功，后者拒绝且不新增 snapshot。随后再覆盖真实用户偏好引用。

本轮未修改文件、调用真实 provider、执行完整 static/E2E 或写共享报告。

## 01a0fd4d-4f83-7f02-835c-e7fe93ce35f6
【核心判断】

基于当前信息，我的理解是：本轮仅审计 M6，覆盖当前 dirty 改动，提供下一轮修复依据。

M6 仍为 **Partial／产品 No-Go**。确认三个尚存 P1，无已证实 P0。版本绑定、提问预算已修，不重复报告。

三路子代理均因系统会话上限被拒绝；本轮由主线程完成，没有独立并发复审。未修改文件、调用真实 provider 或运行共享 static/E2E。

【关键洞察】

| M6 DoD | 当前判定 |
|---|---|
| 可信 completed attempt、提交版本与预算 | 补修已纳入基线 |
| relevant memory／learner state 进入生产 Coach | 未闭合 |
| response strategy／snapshot provenance | 生产链未闭合 |
| canonical feedback／明确重问 | 接口存在，Reading UI 未接通 |
| future same-skill learning outcome | v0 authority 校验不足 |
| A→B→Coach→novel C 产品 fixture | 尚无真实生产闭环证据 |

1. **P1：生产 Coach 没有消费个性化上下文，也没有绑定策略来源。**

   证据：[enrichment.rs:173](<F:/workspace/IELTS Atlas APP/src-tauri/src/commands/enrichment.rs:173>) `coach_run` 直接进入 [coach.rs:35](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/coach.rs:35>) `CoachService::run`。该链仅调用 `resolve_context`、`load_history`、模型和 `complete_run`；[coach/mod.rs:402](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/coach/mod.rs:402>) `complete_coach_run` 仅追加回答、更新线程。Python `evaluate_shadow` 未找到生产调用者。

   **最小反例：**用户已有相关 active memory 和显式教学偏好，发起 Reading Coach；请求仍只包含当前练习证据、历史对话和问题，完成后没有服务生成的 strategy assignment／context snapshot 关联。源码确认，未验证真实模型质量。

   **write set：** application `coach.rs`／`ports.rs`、host `enrichment.rs`，新增专用 Coach adapter；生产 shadow 接线另隔离到 Python dispatcher。
   
   **最小真实 fixture：**真实提交＋SQLite active memory／偏好＋捕获请求的假模型；断言相关上下文被消费，回答关联可信 snapshot、策略，sidecar 失败保留 baseline。

2. **P1：M6 v0 可把过去、他人、无关技能观察记为 learning outcome。**

   [coach_feedback.rs:309](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/coach_feedback.rs:309>) `link_coach_outcome` 只调用 `require_strategy_assignment_exists` 和 `require_observation_exists`，随后写入调用方提供的 `outcome_kind`。没有校验用户、时间、技能或真实练习来源。M10 `teaching_strategy` 的补修没有覆盖此路径。

   **已复现：**执行当前全部 26 个 migration，在内存 SQLite 中使用源码提取的 INSERT，将 `local` 阅读策略关联到更早的 `other-user` 写作观察，`learning` 写入成功，外键检查通过。此探针验证 SQL/schema；未执行完整 Rust command。

   **write set：** DB `coach_feedback.rs::link_coach_outcome`、对应 DB 测试；必要时扩展 domain outcome DTO。
   
   **最小真实 fixture：**通过真实提交／投影生成过去、跨用户、无关技能、重复资产及未来新题观察；仅合法未来同技能证据允许学习归因。

3. **P1：精确重问接口接受角色颠倒、跨线程的消息关联。**

   [coach_feedback.rs:140](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/coach_feedback.rs:140>) `record_reask_link` 仅检查两个 ID 非空、不相等且存在；没有要求 parent 为 assistant、new 为 user、同线程或序列递增。

   **已复现：**同一内存探针将线程 T2 的 user 当 parent、线程 T1 的 assistant 当 new，成功写成 `reask_same_question`，外键检查通过。记录名义上的“精确 linkage”不等于真实重问事实。

   **write set：** DB `coach_feedback.rs::record_reask_link`、对应测试；UI 接线限定 `useReadingCoach.ts`、`ReadingCoachPanel.vue` 和 repository。
   
   **最小真实 fixture：**两条真实 Coach 线程；反角色、跨线程、逆序均拒绝，同线程明确重问成功且重试幂等。普通 follow-up 不自动标记重问。

【Linus式方案】

【品味评分】🟡。致命问题是生产消费者与合同表分离，而 v0 authority 又把“ID 存在”当作语义可信。

先修 v0 outcome／reask 的权威校验，再接生产 context、策略 provenance 和明确反馈 UI。第 2、3 项修改同一 DB 文件，必须串行整合。最终用真实 SQLite＋实际 service＋假模型贯通 A→B→Coach→novel C；真实 provider、打包 UI 和学习质量仍属未验证，不能以合同通过宣告产品闭环。

## 01a0fd4d-5301-7153-a0e1-4f0c3e5212ad
【核心判断】

M3 仍为 **Partial，生产 DoD 未通过**。确认 2 个新 P1，无充分证据定为 P0。品味评分：🟡。

按当前 dirty 工作树核验；未修改文件、调用 provider、执行 Git 写操作或完整 static/E2E。三个探子均因 `agent thread limit reached` 创建失败，本轮由主线程完成只读审计。

【关键洞察】

1. **P1：MemoryManager 没有运行级权限隔离，可调用 Weekly 的 active mutation 路径。**

   [cognitive_runtime.rs:384](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs:384>) `ActiveRun` 只有 trace、generation、deadline 和输入，没有 run kind／权限集合。[dispatch_host_request:1079](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs:1079>) 对所有有效 active run 开放 `dream.run_weekly`；最终 [run_weekly_consolidation:499](<F:/workspace/IELTS Atlas APP/src-tauri/src/commands/journal.rs:499>) 调用 `apply_consolidations` 写 active memory。

   **最小反例：**在 `memory.candidates.generate` 运行中，sidecar 使用当前合法 trace 发送 `dream.run_weekly`，附满足现有独立证据规则的 pattern，即可进入直接采纳路径，无需 M3 candidate 或用户 promotion。现有 consolidation 校验仍执行；缺的是“此运行是否有权调用”。

   **证据：**源码链确认，未执行真实 framed RPC；不能宣称当前正常 extractor 已主动利用此路径。

   **隔离 write set：**`src-tauri/src/cognitive_runtime.rs`、`developer/tests/rust/runtime_capability_contract.rs`。  
   **最小真实 fixture：**假 sidecar＋真实临时 SQLite，以 MemoryManager 身份发送 Weekly 请求，断言拒绝且 active memory、support 状态均不变；合法能力仍可用。

2. **P1：旧证据可反复制造改善／复发，生命周期不要求新证据。**

   [memory.rs:1187](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/memory.rs:1187>) `update_target_memory` 直接更新 improved／regressed。[attach_evidence:1300](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/memory.rs:1300>) 仅对 `REINFORCE` 检查 `inserted == 0`，IMPROVE／REGRESS 可在没有新增证据时成功。

   **最小反例：**同一 observation 先支持 memory，再用于 IMPROVE、REGRESS；读取最新版本后重复提交，状态继续翻转。现有 [生命周期 fixture:300](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/memory_profile_core.rs:300>) 已用同一个 observation 完成改善与复发。

   **证据：**使用真实 0014 schema、外键开启及源码提取的生产 SQL，在内存 SQLite 复现四次翻转；后三次新增 evidence 行均为 **0**，version 从 **1→5**。这是 SQL 层复现，未重跑完整 Rust API。

   **隔离 write set：**`crates/ielts-db/src/memory.rs`、`crates/ielts-db/tests/memory_profile_core.rs`。  
   **最小真实 fixture：**真实提交→投影→服务校验→promotion；旧 observation 复用应拒绝且事务不变，改善之后的独立新练习证据才允许 REGRESS。

`created_run_id` 未写入、`agent_messages` 未进入 memory 输入属于 Round 3 已知断点，未重复列为新发现。历史 gate 证明的是合同边界，不能据此认定真实采纳和消费者闭环完成。

【Linus式方案】

先把 run kind 与允许能力绑定，再统一生命周期的新证据检查，消除“只有 REINFORCE 检查”的特例。补上述真实 fixture 后，由主线程进入修复与顺序回归；本轮仅交付审计依据。


