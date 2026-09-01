# Findings: Backend Agent Architecture Audit

## Requirements

- Concurrent subagent audit against the v1.3 self-evolution engineering plan.
- Then fix and optimize backend agent architecture, design, and invocation.
- Frontend black-box diagnosis from prior session is context: UI consumed the wrong API (`memory_context_preview` as Memory Center). Backend must expose the right product-host surfaces.

## Prior session (frontend, 2026-08-24)

- `/agent` is a mashup of Context Pack preview + Memory governance + M0 file-agent prototype.
- `MemoryCenterPage.vue` gone; `/memory-center` redirects to console.
- `memory_context_preview` returns `{source,key,value}` for the compiler; UI treats it as memory items.
- Journal `facts` is a struct dumped as `[object Object]` (UI-side now fixed via `modules/agent-console/format.js`, batch 5).
- M12 Stage Gate admitted Vue thread UI and AgentService checkpoint wire-up were not done.
- Feature flags: workspace ON; learner/memory/attempt-review OFF by default.

## Carried findings (2026-08-28 session, unverified severity)

- Rust↔Python JournalFacts 契约分叉：`journal.build_daily` 把 Rust `JournalFacts` 原样序列化给 Python strict 模型，但字段形状不一致（Python 期望 `writingEvalSummary.attempts`/`skillDeltas[].skill`/`todayCandidateIds`，Rust 发 `completed`/`skillKey`/`todayObservationIds`）。Python 模型是 `extra="forbid"`。
- `ielts-domain` 新增 `JournalMemoryEvent`；`agent/mod.rs` 新增 `dream`/`study_plan` run kinds（run_kind 存 result_json，无 CHECK 约束问题）。

## Research Findings

### Audit A: Rust Agent 运行时（完成 2026-08-29）

**P0**
- `crates/ielts-application/src/agent.rs:335-524` AgentService 循环不写任何 checkpoint。`CheckpointStage` 六阶段只有 `request_thread_cancel`/`restart_recovery`（ielts-db/src/agent_thread.rs:234,269）合成 final 行，无真实生产者。M12 Stage Gate 承认的 wire-up 缺口仍未闭合。
- `ielts-db/src/agent_thread.rs:234-262` cancellation 只改 DB（插 `{"interrupted":true}` checkpoint），不终止任何执行。Rust loop 无 CancellationToken（仅 cognitive_runtime.rs 有 Notify，用于 sidecar run）；`agent_run`/`agent_run_attempt_review` 期间无任何命令能中断模型调用或工具执行；17.8 的 `agent_cancel_run` 不存在。取消链路 UI→command→loop→模型整体断裂。
- `agent-runtime-python/src/ielts_agent/runtime.py:69-83` + `src-tauri/cognitive_runtime.rs:494-568`：M12-04 Study Planner 完全不可达。Python `_dispatch` 只注册 `runtime.*` 与 `memory.candidates.*`；Rust `request()` 只调 `memory.candidates.generate`。`planner/study_plan.py` 与 `study_plan.create` 反向 RPC 无宿主入口；UI 也无创建计划入口。

**P1**
- `crates/ielts-domain/src/agent_thread.rs:370-397` 工作树新增类型死代码：`StudyPlanSnapshot`、`GenerateStudyPlanCommand` 全仓零引用；`AgentRunKind::Dream/StudyPlan`（learning_tools.rs:42-43 + db/agent/mod.rs:464-465）无创建方——dream/journal 流程不落 agent_runs。
- `apps/writing-vue/src/views/AgentConsolePage.vue:292-295` UI 把 thread id 当 plan id 传（`listStudyPlanItems(planThread.id)`），而 domain 注释明确 "Plan IDs are not thread IDs"；计划面板永远空（`.catch(()=>[])` 掩盖）。
- `src-tauri/src/agent/learning_tools.rs:29-96` 14.7 八工具：6 实 2 缺 1 改名 1 计划外。缺 `search_coach_history`、`get_daily_journal`；`get_skill_state`→`get_learner_skill_state`、`search_memory`→`search_active_memories`（activity 作用域，无自由查询）；`get_memory_evidence` 计划外新增（合理）。
- `src-tauri/src/lib.rs:78-308` 17.8 命令清单大幅缩水：缺 agent_thread_get、agent_send_message、agent_cancel_run、agent_retry_run、agent_get_run_trace、agent_get_context_snapshot、memory_list/get/search/archive/pin/review_mutation_run、dream_get_latest/list/review/apply/reject、learner_profile_get/skill_timeline/compare_attempts/intervention_outcomes、eval_suite_list/run_start/run_get。存在的是一批改名/替代命令。
- `src-tauri/src/lib.rs:293-308` Prompt/Eval 命令挂在默认开启的 daily-dream-v1 下（Cargo.toml:48），计划 17.8 要求开发者模式；生产 UI 可触发全局 Prompt 修改。
- `crates/ielts-application/src/agent.rs:240-250` run_kind 只是审计标签：5 个 kind 无 per-kind 工具 allowlist/context budget/model policy/max rounds（14.12 要求）；工具集硬编码在 Tauri command。
- `src-tauri/src/commands/enrichment.rs:146-188` vs agent_thread：两套并行 thread 真相（coach_threads vs agent_threads）；`agent_send_message`（在 thread 上跑 loop）缺失，thread 是纯数据记录无消费者。
- `src-tauri/src/agent/file_tools.rs:40-67` 14.5/14.6 未落地：无 AgentToolRegistry/ToolEffect/ApprovalRule；write_file/replace_in_file 直接写用户目录无审批矩阵；审批只覆盖 Python 反向 RPC 的 memory.candidate_input 白名单（cognitive_runtime.rs:1619-1650）。

**P2**
- 17.9 Event Channels 全缺：无 RunStatusChanged/ModelDelta/ToolRequested；唯一 emit 在 application_store.rs:779（writing evaluation）。agent run 无流式推送，页面只能轮询 DB。
- `src-tauri/src/commands/agent_thread.rs:84-112` + `api/agent-thread-repository.js`：checkpoint/cancel 命令注册但 UI 不调用；repository 未导出 requestCancel/saveCheckpoint；`thread.save_checkpoint` 反向 RPC 无 Python 调用方——checkpoint 通道两端皆空。
- modes.rs 无 feature flag（全部命令无条件注册）；实际开关集中在 Cargo.toml:47-72（默认开 7 个 v1，仅 developer-tools 默认关）+ DB setting `features.memory_auto_candidates_v1`（默认 proposal_only，无专门 set 命令）。

**总体判断**：M12 交付的是「数据层+命令面」——表、service、Tauri/reverse-RPC 双通道都在，但执行层未接线：AgentService 不写 checkpoint、取消无法传播、planner 无入口，典型的外圈完整内圈断路。单一 Model Gateway 方向正确，但 Tool Gateway、run-kind 策略与事件通道缺位。

### Audit B: 数据层与任务队列（完成 2026-08-29）

**P0**
- `agent-runtime-python/src/ielts_agent/dream/types.py:107-181` ↔ `crates/ielts-domain/src/journal.rs:21-49` 契约分叉**证实为生产断链**：Python `_StrictModel extra="forbid"` 期望 `memoryChanges` 为 list（Rust 发单个 counts 对象）、`writingEvalSummary.attempts/taskTypes`（Rust 发 `completed/degraded`）、`skillDeltas[].skill/activity`（Rust 发 `skillKey/evidenceCount`）、不认识 `memoryEvents`。上会话只改了 Rust 侧，Python 模型零改动——`journal.build_daily`（cognitive_runtime.rs:1123）原样序列化后 `model_validate` 必抛 `journal_facts_invalid` → `fallback_result`。**daily dream 在生产必然 fallback 零提案。**
- `crates/ielts-db/src/dream.rs:61-83` dream_runs 生命周期断链：`start_dream_run` 全仓零调用方；`dream.run_daily`（cognitive_runtime.rs:1131-1163）只调 `insert_dream_run`+`record_proposals`，从不 start/finish；run 永远停在 `queued`，completed/failed 不可达。

**P1**
- `migrations/0018_daily_journal_jobs.sql:12-15` DB CHECK 只允许 `daily_journal/daily_dream`，但 `enqueue_job`（background_jobs.rs:57）Rust match 接受 `weekly_dream`——真的 enqueue 会撞 CHECK；`dream_run_weekly`（commands/journal.rs:219）绕开 job 队列直接 validate，weekly 全程不留审计行。
- `src-tauri/src/lib.rs:34-45` + `commands/journal.rs:57-70,117-127` M7-02 触发语义只做了 lease 恢复：无 `should_schedule_daily_dream`、无启动补跑、无 idle 触发；且 journal_rerun/dream_run_daily 在真实构建**之前**就把 job 标 completed（claim 的是全局下一条而非刚入队那条）——job 台账对执行结果说谎。
- `crates/ielts-db/src/journal.rs:199-230` `daily_journal_sources` 表有 DAO 但生产零调用方；`insert_journal` 不写 source 行，M7-05 range_hash 防重放依赖不存在。
- M12 checkpoint 通道两端皆空（印证 Audit A）。
- `crates/ielts-db/src/learning_events.rs` `consolidation_state` 永不迁移：无任何代码把事件标 `processed`，计划 11.3 Deep 阶段未落地。
- `src-tauri/src/commands/journal.rs:88-96` `journal_list_versions` 是硬编码空 Vec stub。

**P2**
- schema 对计划 8.x 的列级偏离（有意为之但未回写计划）：daily_journals 用 facts_json 替代 summary_markdown+structured_json、缺 scope/coverage/dream_run_id；dream_runs 缺 dream_kind/coverage/provider/counts；dream_candidates 用 6 值 proposal_kind；agent_checkpoints 键 thread+stage 而非 run+step_index；agent_runs 缺 8.4 列；memory_evidence 键 observation_id 而非 event_id。
- `ielts-domain/src/consolidation.rs:24-31` M8-03 阈值部分落地：min_supports/new_evidence/distinct_assets/scopes 已 config 化有测试，但 `DEFAULT_COOLDOWN_DAYS=6` 与 min active candidate pool 无执行点。
- `ielts-db/src/journal.rs:546-604` daily_source_hash 覆盖已补全（上会话修复验证）；残留：skill_deltas 按 skill_key BTreeMap 去重丢多条、private memory 变更不入哈希（有意脱敏）。
- `ielts-db/src/dream.rs:83-130` dream 候选逐条 INSERT 无事务（17.12 要求单事务）；journal_rerun 的 enqueue/claim/finish 亦非单事务。

**工作树未提交改动定性**
- 完成品（上会话修复，有测试覆盖）：ielts-db/src/journal.rs、ielts-domain/src/journal.rs、ielts-domain/src/dream.rs、ielts-application/src/journal.rs+tests、ielts-db/src/consolidation.rs。
- 半成品（zcode，缺落地）：ielts-domain/src/agent_thread.rs（StudyPlanSnapshot/GenerateStudyPlanCommand 零引用）、ielts-domain/src/memory.rs（MemoryCatalog 三类型零引用）、ielts-db/src/agent/mod.rs + ielts-domain/src/learning_tools.rs（Dream/StudyPlan run kind 无创建方）。Vue 大改属 UI 线。

**总体判断**：数据层骨架（22 个 migration、journal 版本化、consolidation 事务、M8 证据门）质量高且贴合计划精神；但闭环在外圈断路——Python 契约分叉使 daily dream 实际永远 fallback（P0），dream run 状态机与 job 触发语义是「手动命令 + 审计表演」而非计划的后台 worker。当前最优先是修 Python JournalFacts 模型与 dream_runs 生命周期。

### Audit D: 记忆链 + 上下文链 + 产品读 API（完成 2026-08-29）

**P0**
- `crates/ielts-domain/src/memory.rs:563-635` Memory Center 目录读 API 完全缺失：`MemoryCatalog(Query/Entry)` 三类型全仓零引用。注释明写 "Product-host catalog query...NOT a Context Pack"，字段正好覆盖 18.3/18.4（namespace/status/source_class/confidence_band/support_count/evidence_observation_ids），但无 db 函数、无 service 方法、无 Tauri 命令；UI 只能继续吃编译器 preview（`{source,key,value,pendingVerification}`）。
- Rust↔Python JournalFacts 契约分叉未修（独立证实 Audit B 结论）：daily dream 回环在生产必然 fallback 零提案。
- `crates/ielts-db/src/memory.rs:1214-1240` + `ielts-domain/src/memory.rs:543-552` 18.4「查看证据」断链：`memory_evidence` 表有数据但读 API 不带。`MemoryContextEntry` 无 evidence 字段；UI `evidenceFor()`（AgentConsolePage.vue:439-450）读 entry 的 evidenceObservationIds 永远是空 → 抽屉恒显「还没有挂上练习证据」。
- `src-tauri/src/commands/journal.rs:90-101` 18.5「查看来源」是硬编码空 Vec stub；`rendered_markdown` 永远传 None（journal.rs:38/87），18.5 可读首页卡片从未生成，投影全靠前端 format.js。

**P1**
- `crates/ielts-application/src/context.rs:41-49,156-167` 13.4/13.7 未实现：无 ContextBudget 分区块结构，ranking score 恒为 1.0（快照 audit 每项 score 是常数，违背 13.10）；Python 侧用 RRF fusion 替代（context_planner.py 有 DEFAULT_BUDGET_RATIOS）。
- `context.rs:74-93` + `ielts-db/src/corpus.rs:295` materializer 只认 corpus chunk ID，ActiveMemory/LearnerState/ExplicitUser/Journal section 无法物化（非 corpus ID 整批落 unknown_stable_ids fail-closed）；13.9 完整 ContextPack 结构未实现；13.8 preference_conflict/ContextWarning 零实现。
- `crates/ielts-application/src/memory/validator.rs:133-265` Promotion Gate 缺 10.3 三类门：confidence、procedural 证据门槛、PendingReview 用户审批流。proposal schema 无 confidence/importance（10.2 要求）；confidence 是 source_weights 按 source_class 硬编码（memory.rs:1328）；无 reject 命令——`memory_promote_candidate` 是唯一用户出口，10.1 的 Rejected/Archived 分支无入口。Python→Rust 提案/审批回环本身完整（generate→validate→persist pending→CAS promote+audit），质量高。
- `memory/service.rs:23-59` 17.3 MemoryStore 缺 search/get_active_profile/propose_mutations/apply_mutation_batch/list_user_visible；`ContextMaterializerService` 只接 corpus+snapshots 2/6 port；LearningEvidenceStore/BackgroundJobStore 无 trait（db 直连）。
- `ielts-db/src/memory.rs:463-497,1182-1281` **`memory_context_preview` 读路径无 sensitivity 过滤**（唯一漏网点）：`load_active_context` 只查 status='active' 即回全文；当前安全纯因写入侧硬编码 'normal'（memory.rs:999/consolidation.rs:108）。对照 journal(journal.rs:412)、cognitive_read(395)、learning_events(292)、learner 源(380) 均已过滤。
- 10.6 Memory Utility 与 10.7 Recall Feedback 未落：无 retrieved_count/successful_use_count 等字段；`memory_record_feedback`（M8-09）仅部分覆盖。
- `src-tauri/src/commands/memory.rs` 18.4「更正/固定/暂时禁用」无任何命令；7.7 Procedural 查看/关闭、Inferred Profile 纠正缺用户控制面。

**P2**
- 10.5 容量是 per-scope 128 条硬上限，非 per-namespace/type 预算，无 archive→restore。
- `context.rs:321-327` `now_iso()` 生成 `"1970-01-01T00:00:{secs}Z"` 假时间戳，快照 rendered_at 失真。
- dream run 永远停在 queued（印证 Audit B）。
- AgentConsolePage.vue:131,287-289 "Since Last Visit" 是 localStorage 前端模拟，后端无 since 参数。
- `DEFAULT_COOLDOWN_DAYS` 无执行点；`journal_list_dates` 不存在。
- Learner 读 API 基本成形（版本+state_hash+分页+truncated，sensitivity 在源层过滤），是本区间质量最好的读面。

**总体判断**：写链（候选提取→验证→审批→审计）与快照持久化真实且有测试，方向贴合计划；但产品宿主读 API 几乎整体缺位——Memory Center 目录（MemoryCatalog 死代码）、证据查看、journal 版本/可读摘要全没有，UI 被迫用编译器 preview + localStorage 自造语义。两条 P0（Python 契约分叉、证据不可读）直接决定 daily dream 与 Memory Center 在生产不可用，应先于任何新功能修复。

### Audit C: Python sidecar（子代理三次因网关 503/504 失败 → 主线直接核验）

<!-- 见下节，由主线补齐：capability 注册、sidecar 生命周期、dream 编排、M5 进度、测试覆盖 -->

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Audit first via 4 parallel read-only subagents | User requested concurrent audit; avoid fixing from frontend-only evidence |
| Scope = backend host + sidecar + invocation, not Vue restyle | User explicitly asked for backend architecture/design/calls |

## Issues Encountered

| Issue | Resolution |
|------------|------------|
|            |            |

### 对抗审计 Round 1(2026-08-30,commit cd932af2 推送后)

4 路并发子代理(契约/生命周期/安全/userspace),2 路因网关并发限额失败待补跑。

#### 契约审计(完成)——4 P0,1 误报,3 实锤已修
- **P0-1 实锤已修**:`journal.build_daily` 仍解析 `params["query"]`,Python 发 `{day}` → daily dream 必 fallback。改按 {day,userId?} 解析(与 dream.run_daily 同包络)+ is_iso_day 校验。
- **P0-2 误报**:审计代理称 DreamProposalKind 大小写分叉;实际 Rust serde 是 `SCREAMING_SNAKE_CASE`(与 Python "REINFORCE" 一致)。已加跨语言 casing 金测试防回归(ielts-domain/src/dream.rs wire_casing_tests)。
- **P0-3 实锤已修**:Python `StudyPlanItem.to_wire()` 发嵌套 `skillProbe{skillKey,...}`,PlannerItemWire 读扁平 skillKey → require_text 失败 → 生成计划必 fallback。改读嵌套。
- **P0-4 实锤已修**:planner 需要 `needs`,learner_skill_state 只回 `states`(db 现成 `skill_review_needs_snapshot` 没接)→ 永远 0 项计划且成功入库。改合并包络 states+needs(needs best-effort 空降级)。
- **教训**:三个 P0 都在「我没有跨语言端到端测试的真实 wire 上」。Python fake bridge / Rust 无 handler 测试 → 形状错了测试照样绿。金测试 + handler 级测试是下一会话的债。

#### 契约审计——休眠 P1(未修,记录在案)
全仓无正向调用方的 Python orchestrator,信封全错,一接线就炸:
- dream.run_weekly({window} vs params["query"];回复 {runId,validated,...} vs WeeklyDreamResult 嵌套)
- memory.candidate_pool(回 {memoryId,key},Python 读 summary/scope;window 参数被忽略)
- strategy.* 五方法(attribution/selection/assignment/feedback/user_state 包络与回复全错)
- prompt.*/eval.*/LLM grader(proposal/promote/rollback/run_case/get_active 全错;grader 的 model.invoke 缺 request 包络)
- coach personalized 的 learner_skill_state 发 {activity,skills} 无 query 键
- 处置建议:接线前先单侧定包络 + 加金测试;或删除死 orchestrator。

#### 安全审计(完成)——无 P0;P2 快修已做
- runId 客户端可控 → 限 [A-Za-z0-9-]{1,64} 否则重新生成(成为 agent_runs PK)
- 取消注册表同 id 覆盖 → register 返回 Option,重复 run id 拒绝
- RunStudyPlannerRequest 加 deny_unknown_fields + Python 侧边界镜像(goal≤2048 字符,minutes≤720,date≤40)
- day 无格式校验 → is_iso_day(dream_run_daily + journal.build_daily + dream.run_daily)
- feature gate 漂移:study_plan_get_latest/memory_catalog_list/study_plan_run 注册补 #[cfg]
- **load_active_context/load_candidate_context 补 sensitivity='normal' 过滤**(审计确认的写入侧-only 潜在漏网;candidate 经 NOT EXISTS 过滤 target/resolved memory 的非 normal)
- catalog limit clamp 对齐 MAX_MEMORY_CATALOG_ITEMS=200
- 干净面:catalog 证据子查询继承 sensitivity 过滤;SQL format! 仅布尔字面量;新读 API 用户隔离有测试;cancel 落 Interrupted 语义正确。

#### userspace 回归 + 生命周期审计
待补跑(并发限额失败),在审计修复 commit 之后串行执行。

### 对抗审计 Round 2(2026-08-30,串行补跑;commit 4ab2d371)

#### 生命周期审计——无 P0;2 P1 已修
- **P1 已修**:dream_runs 无启动恢复,进程 kill 在 start/finish 之间 → 永远 'running'(start 不能重claim)。新增 `recover_interrupted_dream_runs`(running→failed, interrupted-by-restart),挂进 lib.rs 启动扫描。
- **P1 已修**:job 在 claim 后 panic/future drop → 'running' 搁浅到重启。两个命令入口跑 `lease_recover(300s)`;fail/finish 的所有权失配从静默丢弃改为 tracing::warn;worker_id 传参消除三处字面量重复。
- P2 记录未修:record_proposals 无事务(部分候选挂在 failed run 上——当前惰性:dream_candidates 无 promotion 消费者);agent_run/agent_run_attempt_review 无 audit guard(启动恢复兜底);并发同日 dream 可产生两条 run(job dedupe 只护 enqueue→claim 窗口);cancel 与 validate_tool_batch 的状态排序竞态(影响仅 Failed vs Interrupted 标签)。
- 干净面:RunAuditGuard 终态语义(armed 重试 + WHERE status='running' 幂等);非 Send 借用不跨 await;ActiveRun 各错误路径清理;claim_job_by_id 原子;合并 learner_state 包络无锁嵌套。

#### userspace 回归审计——1 P1 已修;冻结面全部干净
- **P1 已修**:catalog 读失败被 `.catch(()=>null)` 吞掉 → 健康的空控制台(基线代码会拒绝 Promise.all 设 errorMessage)。现在 catalog 失败设 errorMessage,其余分区照常渲染。
- P2 已修:未用 listStudyPlanItems 导入删除;stale d.ts DailyDreamQuery 改 {userId?, day};cancelAgentRun 对已结束运行如实提示;重复 runId 改走 CommandResponse 包络;visual harness 补 memory_catalog_list/study_plan_get_latest mock;__pycache__ 出库 + gitignore。
- 干净面(逐条验证):EvaluatingPage.vue 零 diff;E2E 钉死选择器/流程全部完好(含 is-complete/is-error、run-steps、metadata Run ID);shell 契约测试全部断言通过;M1/M2 migrations 零 diff;dream_run_daily 无残留旧调用方;设计系统无新增 --lg-*/z-index/裸选择器(.agent-text-button 在 console.css:545)。
- 未修记录:visual harness 的 expected_commands 精确序列断言自 dff588e8 起即已无法匹配(前在 rot);catalog limit=100 且 UI 忽略 truncated(重度用户截断,待分页设计)。

#### 提交记录
- cd932af2: P0 契约 + 接线主体
- 4ab2d371: round-1 审计修复(3 P0 + 安全 P2)
- 15b74ad9: round-2 审计修复(2 P1 + P2 清理)
- 全部门禁在 15b74ad9 重跑通过:static 27/27、E2E 16/16、Python 425、release 重编。
