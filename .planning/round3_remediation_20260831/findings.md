# Round 3 整改发现

## 2026-10-01 继续按任务书核验

- 主代理读取 §16 全章、§17.7/17.8 开发者命令边界、M11 全段及 §25.8：产品 prompt 生命周期必须 offline eval→holdout→shadow→manual approval→canary→promote，release gate 由 Rust 控制；Webview 自带评分不是受控 offline experiment。
- 不能靠接线补齐假的门禁，也不能把关键词/结构检查伪称为真实模型效果评估。优先封闭 eval authority 漏洞，然后处理与生产路径无关的确定性状态机缺陷。
- 上轮工作树改动全部保留；planning-with-files 继续记录条款、实现证据、改动和门禁，冻结任务书不写回状态。
- 两名本轮探子已返回并关闭。四个 M11 authority 命令在 Vue 中无调用方，daily-dream-v1 默认开启因此此前真实暴露；主代理复核 lib.rs 注册、commands/prompt_skill.rs 全文和 runtime 门禁/测试段后移除四个生产写入口，修正过时的 UI-only 注释。
- 保留显式用户 writing prompt bank（SettingsPage 的另一合同），不能借 M11 收口删除用户已有配置能力；保留候选提议与 registry 读取，不扩展到所有 prompt 功能。
- 新防回归：cognitive_runtime source-registration 负向/正向合同；packaged E2E 真实 IPC 提交 forged passed=true，必须精确 command-not-found，不能把参数缺失/业务拒绝当权限收口，同时正向检查 registry 读取。
- catch-up 消费者尚不能直接接 journal_rerun/dream_run_daily_inner：它们会再次 enqueue/claim；JournalStore 默认 local，非 local 窗口存在串用户风险；Dream 反向 submit 每次新 UUID，无 job→业务幂等回执。需要 day checkpoint、claim token + commit fence、stable dream run/journal identity，再接后台消费者，不能只起一个循环造成重复候选。
- 主代理新实弹回归：已 passed 的 M11 候选重评 critical safety case 为 false 后，approve_candidate 仍成功；第二条 eval_results 触发器拒写时，eval_runs 留 completed 1 条。已补两条修复前失败测试；run_eval 改为单事务记账并由最新完成 verdict 唯一决定 Proposed/EvalPassed。此改动不是新 evaluator。

## 2026-10-01 当前 HEAD 复核

- 当前 HEAD `2acf8cac`，之前修复已进入基线；工作树只有用户的未跟踪 `.zcode/`。6 名只读探子已全部关闭。
- 路线 10：真实 `prompt.get_active` 返回 `PromptVersion {id, contentText, ...}` 或 null，Python eval reader 却读取 `promptVersionId/skillVersionId`，假 fixture 掩盖合同错位。先修读取和真实形状回归。
- 不直接启用生产 prompt overlay：Webview `eval_run_case` 仍接收调用方 `passed/score/grading`，这是未收口的晋升证据权限。生产 overlay、真实 effect evaluator 继续未完成，不把结构校验当效果验证。
- 路线 9：同窗口 running + queued 是现有 enqueue 合同允许的状态，恢复批量 requeue 会撞 queued 唯一索引。失败耗尽后 catch-up 又会新建任务重置预算。需事务恢复、保留重复/耗尽任务终止收据，并阻止自动重建失败窗口。
- 其他待修：历史 catch-up 无生产消费者；coach/weekly dispatch；retrieval/LLM trace 无写入和 eval 无燃料；归档按钮误接永久遗忘、历史删除下游失效和 dream 审批桥接；Coach 必保留输入超限；weekly sensitivity 降级与支持版本 TOCTOU。探子证据为线索，修改时仍由主代理直接读取确切代码。

### 探子压缩证据（坐标为修改前 HEAD，仅定位线索）

| 路线 | 未修问题 | 点验入口 |
|---|---|---|
| 10 | strategy verdict 仅结构安全，不证明效果 | `crates/ielts-db/src/teaching_strategy.rs:814` evaluate_strategy_candidate_batch，917 errors.is_empty，1033 promote |
| 10 | 生产 prompt const 未消费 registry；Webview 仍可自报 eval 通过 | `crates/ielts-application/src/coach.rs:92` build_request；`src-tauri/src/commands/prompt_skill.rs:61` eval_run_case；`crates/ielts-db/src/prompt_skill.rs:671` all(g.passed) |
| 9 | 历史队列无生产调度消费者，日期只在 dedupe | `src-tauri/src/lib.rs:32`；`crates/ielts-db/src/background_jobs.rs:327`；`apps/writing-vue/src/views/AgentConsolePage.vue:355,368` 仅 today |
| 8 | coach.reply / dream.weekly 无 dispatch 及 host outbound caller | `agent-runtime-python/src/ielts_agent/runtime.py:75-93`；`src-tauri/src/cognitive_runtime.rs:53` REQUIRED_RUNTIME_CAPABILITIES；`commands/enrichment.rs:179` 直走 Rust |
| 6 | retrieval_runs / llm_invocations 无生产 INSERT，eval_cases 无生产 seed/import | `src-tauri/src/cognitive_runtime.rs:2124` invoke_model；`agent-runtime-python/src/ielts_agent/retrieval/planner.py:149`；`crates/ielts-application/src/prompt_skill.rs:167` insert_eval_case 无 production caller |
| 5 | 归档按钮调用 forget 永久擦除 | `apps/writing-vue/src/views/AgentConsolePage.vue:485` forgetEntry → forgetMemory；`crates/ielts-db/src/memory.rs:581` forget_memory |
| 5 | 历史删除只重建 M2，M4 / journal / memory 残留 | `crates/ielts-db/src/history/mod.rs:467,743`；`crates/ielts-db/src/learner.rs:773`；`src-tauri/src/commands/journal.rs:40` 返回现存 snapshot |
| 5 | dream_candidates pending 无审批桥 | `crates/ielts-db/src/dream.rs:100` insert_dream_candidate；`src-tauri/src/commands/memory.rs:430` require_local_candidate 仅查 memory_candidates |
| 4 | 不可丢 context 超限；最新大问题被静默省略 | `crates/ielts-application/src/coach.rs:112,127` saturating_sub 后 break；需拒绝必保留输入超限，禁止空问题调用 provider |
| 2 | rollback 按最大版本而非实际前驱；actor 未持久化 | `crates/ielts-db/src/prompt_skill.rs:862,902` ORDER BY version DESC；v2→v1→v3 应恢复 v1 不是 v2 |
| 1 | marker blacklist 可被中文指令绕过（未声称实测泄露） | `crates/ielts-domain/src/text_guard.rs:19` ASCII marker；weekly 直接写 active，无语义隔离/人工审批 |
| 1 | private/restricted 支持导出 normal consolidated | `crates/ielts-db/src/consolidation.rs:60` 不读 sensitivity，124 固定 normal；需 fail-closed 继承边界 |
| 1 | 支持仍 active 但正文/version 变更可穿越校验 | `crates/ielts-db/src/consolidation.rs:161` UPDATE 只查 active；domain ValidatedPattern 不含版本/hash；memory refine:1123 |

已核实不应重复修复：Context run FK/随机 snapshot ID；sidecar promote/rollback/approval/eval 禁止名单；weekly Webview 入口移除；归档 sweep 列语义；ledger 删除语义；consolidation UPDATE 行数与事务检查。

## Source

- 审计报告：`developer/docs/PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md`
- 当前审计基准：报告记录的 tip `7928d75c`；实际工作树需再次核对。

## Initial findings

- 2026-10-01 用户确认固定默认工作区及自动 app_data 回退；agent_get_workspace 替代 agent_pick_workspace，调用方不能选择路径。测试安装可临时隔离，但默认目录仍安装相对、内容不清空；续期维持短期权限边界。

- 报告统计 P0 28、P1 55+；路线图按安全、数据结构、接线、文档换血排序，但本任务要求从末项倒序。
- v1.3 文档是 11248 行 Post-M2 快照；现有 ADR、M3-M12 gate report 和 `.planning/` 才可能包含较新的实现证据。
- 当前工作树存在未跟踪 `.zcode/` 与审计报告，必须保留。

## Verified coordinates

- v1.3 文档头部 currently claims `Post-M2` and lists baseline `7a99ea4`; tail still labels M2.1 as `[NEXT HARDENING GATE]` and ends with the M2→M12 planned sequence.
- Current HEAD is `7928d75c`; migrations `0012` through `0022` exist; `developer/docs/INDEX.md` is missing.
- `developer/tests/ci/run_static_suite.py` has no document drift check; its `checks` list is the insertion point for a new `check_doc_drift.py` command.
- `src-tauri/src/lib.rs` is the concrete Tauri command registry (`generate_handler!` around lines 79-318); docs should validate only command names that are explicitly backticked in current ADR/gate surfaces.
- M6 gate report still says “全部完成” while its limitations state Rust baseline remains the only user-visible Coach; M10 says candidate eval is a stub; M11 says prompt overlay is future; M12 says M6 Go/No-Go passed. These require post-audit addenda before the documents can be used as status evidence.

## Documentation governance completed

- v1.3 now carries a 2026-08-31 frozen-history banner; `developer/docs/INDEX.md` defines current entry points and the precedence `post-audit addendum > Accepted ADR > Stage Gate > frozen plan` while code/tests remain the implementation fact source.
- `developer/tests/ci/check_doc_drift.py` checks local links, migration filenames and context-qualified backticked Tauri command names in current ADR/Stage Gate/INDEX documents. The frozen task book is intentionally excluded.
- M3-M12 reports now use “阶段契约验证完成”; M6 is explicitly product No-Go; M12 no longer claims the historical stage table is an overall product Go.
- Verification: `check_doc_drift.py` passed for 23 current documents; static suite passed 28/28; packaged practice flow passed 16/16.

## Code remediation queue

- Route 10: `promote_strategy_candidate` currently flips `strategy_candidate_batches.disposition` on a caller boolean and has no Rust-owned eval evidence relation. A fix needs a durable batch-scoped eval verdict rather than trusting a new client boolean.
- Route 9: `background_jobs.startup_recovery` only requeues existing interrupted jobs; it does not discover missing journal/dream windows. Existing enqueue dedupe keys and `daily_journal`/`daily_dream` CHECK constraints must be preserved.

## Route 10 verification (2026-08-31)

- `crates/ielts-db/src/teaching_strategy.rs:781-800` only checks that a batch exists and maps `promote: bool` directly to `promoted`/`rejected`; it never reads an eval verdict. A rejected batch can also be promoted again.
- `crates/ielts-db/migrations/0020_teaching_strategy_evolution.sql:177-187` has no eval relation for `strategy_candidate_batches`; `crates/ielts-domain/src/teaching_strategy.rs:414-418` exposes only `batch_id` and the caller boolean.
- M11's persisted eval rows are keyed to `candidate_promotions` (`cp-*`), while M10 batches are `tscb-*`; they are separate contracts and must not be joined by ID or by stuffing a foreign key into `batch_json`.
- Remediation decision: add an M10-owned `strategy_candidate_evaluations` table with a restrictive `batch_id` FK. The offline evaluator records a verdict and moves the batch to `eval`; promotion reads the latest persisted verdict inside one Rust transaction and accepts only `passed = 1`. Rejecting remains available from `pending`/`eval`; terminal states cannot reverse.
- Existing test `crates/ielts-db/tests/teaching_strategy.rs:405-427` intentionally promoted a no-eval batch, so it must be changed into a gate regression test.

## Route 9 verification (2026-08-31)

- `crates/ielts-db/src/background_jobs.rs:217-231` only calls `lease_recover` and updates rows already marked `interrupted`; no code enumerates missing dates or enqueues a job for an absent daily window.
- The recovery implementation must preserve the existing `enqueue_job` dedupe contract and the `daily_journal`/`daily_dream` job-kind CHECK constraint. The route-9 patch is queued after the M10 gate patch.

## Route 9 remediation (2026-08-31)

- `background_jobs::startup_recovery_with_catch_up` now derives `(user_id, day)` windows from the canonical fact sources: attempts, writing evaluations, learning events, learner observations/skill observations, memory mutations, coach feedback, and coach re-ask links.
- Missing journal/dream windows are inserted through the existing `enqueue_job` path with the established dedupe keys and priorities. Existing journal rows, latest-journal dream runs, and active queued/running/interrupted jobs are skipped; future activity dates are excluded.
- The legacy `startup_recovery` return value remains the interrupted-job requeue count; Tauri startup uses the report-shaped API for catch-up telemetry. No business logic or OS scheduler was added.

## Route 8 recheck (2026-08-31)

- `agent-runtime-python/src/ielts_agent/runtime.py:75-93` still dispatches only `runtime.*`, `memory.*`, `dream.daily`, and `planner.study_plan`; Rust advertises retrieval/context/eval/coach/weekly capabilities that have no Python production dispatch branch.
- `agent-runtime-python/src/ielts_agent/retrieval/planner.py:77` creates `rr-*` retrieval IDs, while `0016_context_retrieval_trace.sql` uses `agent_context_snapshots.run_id` as an `agent_runs(id)` foreign key; `ContextMaterializerService` passes the retrieval ID into that field.
- `crates/ielts-db/src/consolidation.rs:224-228` still binds `memory_capacity_state.memory_kind` values to `memory_items.memory_type`, so archive remains a zero-row operation.
- `migrations/0012_learning_event_ledger.sql:10-23` still cascades deletion from attempts into the learning ledger, contrary to the immutable-fact contract.
- `crates/ielts-db/src/dream.rs:81-115` inserts `dream_candidates` as pending, but the repository has no update/promotion path for that table; the existing memory promotion path updates only `memory_candidates`.
- `crates/ielts-application/src/ports.rs:29-34` and `crates/ielts-application/src/coach.rs:37,84-95` still have no model output/input ceiling and send all 100 loaded history messages.
- `src-tauri/src/cognitive_runtime.rs:77-87,1098-1105,1681-1692` still advertises and dispatches prompt promote/rollback and approval mutation from the sidecar path without the documented equivalent approval gate.
- `apps/writing-vue/src/api/memory-repository.js:76-79` and `src-tauri/src/commands/journal.rs:454-466` still allow webview-supplied weekly patterns and do not create a corresponding persisted dream run.

## M10 authority recheck (2026-08-31)

- `RecordStrategyCandidateEvaluationCommand` currently exposes `passed` and caller-provided `metrics` at `crates/ielts-domain/src/teaching_strategy.rs:424-429`.
- `crates/ielts-db/src/teaching_strategy.rs:808-818` persists those values unchanged. The promotion transaction reads the stored result, but the evaluation result itself is not Rust-produced evidence. The next M10 patch must make evaluation input batch-only and compute the verdict/metrics inside the Rust DB authority.
