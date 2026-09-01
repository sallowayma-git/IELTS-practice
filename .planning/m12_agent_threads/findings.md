# Findings

## 2026-08-16 M12 基线评估

- M0/M1 `agent_runs`/`agent_tool_calls`（migration 0011）：run-level 审计（provider/model/status/rounds/result/error/tool call begin/finish）。M12 在此之上加 thread-level（agent_threads/agent_messages/agent_checkpoints）—— thread 是多轮对话/多 run 的逻辑容器。
- M6 AttemptReview run（`AgentRunKind::AttemptReview`）+ LearningReadTools（7 read-only tools：get_attempt_detail/compare_attempts_for_asset/get_question_history/search_learning_events/get_learner_skill_state/search_active_memories/get_memory_evidence）。M12 controlled action tools 是 read-only 之外的写工具，需 approval gate。
- M4 `LearnerModelStore::skill_review_needs_snapshot` 是 Study Planner 的关键输入（skill review needs）。
- M7 `background_jobs`（durable job authority + claim/lease/recovery）可借鉴用于 checkpoint/cancellation 的 durable 状态。
- M5 `llm_invocations` 表（0016）已存在，trace 不重复建。
- Vue `AgentWorkspacePage.vue`（416 行）是现有 UI 原型；M12 升级为完整工作台（thread list/message flow/tool trace/context trace/memory refs/cancel-retry/approval card/study plan panel）。
- migration 当前到 0021；M12 用 0022（6 表）。
- TechSpar 参考（M12-05）：`F:\workspace\TechSpa\backend\spaced_repetition.py:61 get_due_reviews()` 是最小参考，但 IELTS planner 必须选 skill probe 而非自动重复原题。
- M12-07：embeddings 不为架构完整强上（M5 lexical+FTS 已满足 retrieval goldens 则不强上）—— 当前 M5-11 eval 已证明 lexical+RRF soundness，不接 embedding。

## 2026-08-16 Slice 1 (Rust) Findings

### Migration 0022（6 表）
- `crates/ielts-db/migrations/0022_agent_threads_planner.sql`：`agent_threads`（user_id/thread_kind CHECK/sequence/status active-archived/last_message_at）、`agent_messages`（role CHECK/UNIQUE(thread_id,sequence)/FK CASCADE）、`agent_checkpoints`（stage CHECK 6-stage/run_id 无 FK 因可能先于 run 行写入/FK CASCADE）、`study_plans`、`study_plan_items`（FK CASCADE）、`agent_action_approvals`（action_kind CHECK 只含 allow+approval-gate 8 种；forbidden 6 种不入 CHECK，由 Rust authority 在 tool.invoke 拒绝）。
- 注册 `migrate::mod.rs` version 22；`BACKUP_SCHEMA_VERSION` 14→15；新增 `V14_CANONICAL_TABLES` 冻结 v14 包形状；6 张 M12 表加入 `CANONICAL_TABLES`（agent_threads 在 messages/checkpoints/approvals 前；study_plans 在 items 前）；`validate_logical_references` 加 M12 FK 校验（thread_id/plan_id）。

### Domain（agent_thread.rs）
- `ThreadKind`/`ThreadStatus`/`MessageRole`/`CheckpointStage`/`ActionKind`/`ApprovalStatus` 枚举 + `as_str`/`parse`。
- `ActionKind::gate()` 返回 `ActionGate::{Allow,ApprovalGate,Forbidden}`；`FORBIDDEN_ACTION_KINDS` 常量 + `is_forbidden_action_kind()`。
- DTOs：`AgentThread`/`AgentMessageRecord`/`AgentCheckpointRecord`/`StudyPlan`/`StudyPlanItem`/`ActionApproval` + Commands。
- `CheckpointStage::is_terminal()`（仅 Final 终态）。

### DB（agent_thread.rs）
- `create_thread`/`append_message`（事务内 sequence+1，原子推进 thread.sequence/last_message_at）/`list_threads`（user_id 隔离，excludes archived）/`archive_thread`（soft delete status flip）/`list_messages`。
- `save_checkpoint`（append-only）/`load_latest_checkpoint`（ORDER BY created_at DESC LIMIT 1）/`request_thread_cancel`（非终态 → 写 Final+interrupted payload；终态 noop）/`restart_recovery`（找 latest 非 Final checkpoint per thread，写 Final+process_restart；**不重放任何写工具**）。
- `create_study_plan`（事务含 items）/`list_study_plan_items`/`mark_plan_item_done`。
- `record_action_approval`（拒绝 allow-listed kind，只持久化 approval-gated）/`list_pending_approvals`/`decide_approval`（pending→approved/rejected，已 decided 拒绝）/`is_forbidden_action_kind`。
- `parse_enum` trait 解析持久化枚举（unknown 值 = data integrity error，非静默默认）。
- `request_thread_cancel`（非 `request_cancel`，避免与 writing::evaluation 的 `request_cancel` glob 冲突）。

### Application（agent_thread.rs）
- `AgentThreadStore` trait（15 方法）+ `AgentThreadService`（use-case boundary，校验 user_id/thread_id/title/content/goal/items required；`record_action_approval` 拒绝 allow-listed kind）。

### Tauri reverse-RPC + commands
- `cognitive_runtime.rs`：`PROVIDED_HOST_CAPABILITIES` 追加 12 个 capability（thread.*/approval.*/study_plan.*，全部 version "1"，`agent-threads-v1` feature-gated）。`serialize_result` 从 `context-compiler-v1` 放宽到 `any(context-compiler-v1, agent-threads-v1)`。新增 `invoke_agent_thread` handler（512 KiB 响应上限）。`tool.invoke` 在 `invoke_candidate_input_tool` 加 M12-06 forbidden action_kind 拒绝（`is_forbidden_action_kind`，在现有 M11-06 self-modifying 拒绝之后、allow-list 之前）。
- `src-tauri/src/commands/agent_thread.rs`（NEW）：15 个 Tauri command，`agent-threads-v1` feature-gated。`commands/mod.rs` + `lib.rs`（generate_handler）注册。
- `app/application_store.rs`：`AgentThreadStore for ApplicationStore`（15 方法委托 db）+ `agent_thread_error` helper。
- `src-tauri/Cargo.toml`：新增 `agent-threads-v1` feature（default 启用，与现有 M-feature 一致）。`lib.rs` startup 加 `restart_recovery`（`agent-threads-v1` gate，与 background_jobs startup_recovery 并列）。
- `apps/writing-vue/src/config/feature-flags.js`：新增 `agentThreadsV1` flag（default true，与 `agentWorkspaceV1` 一致）。

### 声明的 capability 方法名/版本（供 Python 对齐）
| 方法 | 版本 | feature gate |
|---|---|---|
| `thread.create` | 1 | agent-threads-v1 |
| `thread.append_message` | 1 | agent-threads-v1 |
| `thread.list` | 1 | agent-threads-v1 |
| `thread.save_checkpoint` | 1 | agent-threads-v1 |
| `thread.request_cancel` | 1 | agent-threads-v1 |
| `approval.list` | 1 | agent-threads-v1 |
| `approval.decide` | 1 | agent-threads-v1 |
| `approval.record` | 1 | agent-threads-v1 |
| `study_plan.create` | 1 | agent-threads-v1 |
| `study_plan.list_items` | 1 | agent-threads-v1 |
| `study_plan.mark_done` | 1 | agent-threads-v1 |

`tool.invoke` controlled-action gate：forbidden action_kind（`direct_sql`/`arbitrary_filesystem`/`api_key_read`/`production_prompt_mutation`/`schema_migration`/`silent_delete_history`）在 reverse-RPC 边界显式拒绝（`is_forbidden_action_kind`），error message 含 `(M12-06)`。allow-list 4 种 + approval-gate 4 种可被 `approval.record` 持久化（allow-listed kind 被 service 拒绝）。

### 测试覆盖（§9363-9373）
- `crates/ielts-db/tests/agent_thread.rs`（19 测试）：migration 6 表 + create/list/archive + append sequence 原子 + checkpoint save/load + cancel 写 Final + restart recovery 标 interrupted（不重放写工具，study_plan item 不重复）+ retry lineage（child run_id）+ approval pending→approved/rejected + forbidden CHECK 约束 + user 隔离 + study_plan CRUD + cascade delete。
- `crates/ielts-application/tests/agent_thread.rs`（11 测试）：service 校验 + allow-listed 拒绝 + approval 流程 + forbidden guard + cancel/restart via service + privacy + study_plan CRUD + retry lineage。
- 修复 `learner_model.rs`/`learning_events.rs`/`phase3_migration.rs` 硬编码版本断言（21→22，含 applied vec）。

### 验证结果
- `cargo check -p ielts-{domain,db,application} --locked --offline`：0 error。
- `cargo check -p ielts-practice-tauri --locked --offline`：0 error（仅 pre-existing `consolidation.rs` chrono::Utc unused import warning）。
- `cargo test -p ielts-db --test agent_thread`：19 passed。
- `cargo test -p ielts-application --test agent_thread`：11 passed。
- `cargo test -p ielts-practice-tauri --lib cognitive_runtime`：4/4 passed（不回归）。
- `cargo test -p ielts-application --test context_materialization`：7/7 passed（不回归）。
- `cargo test -p ielts-db --test backup_full_roundtrip`：11/11 passed（M12 fixture row + schema v15 + V14 冻结列表）。
- `check_m3_contracts.py`/`check_m4_contracts.py`：pass（不回归）。
- `run_static_suite.py`：27/27 pass（不回归）。

## 2026-08-16 Slice 2 (Python) Findings

**Owner**: Agent B (Python). 干净室，不碰 Rust / host_bridge / coach / dream / eval / memory_* / retrieval。

### 交付文件（全部 NEW）

- `agent-runtime-python/src/ielts_agent/planner/__init__.py` — 包导出。
- `agent-runtime-python/src/ielts_agent/planner/types.py` — pydantic 数据契约（closed/frozen/strict/camelCase/deny_unknown_fields）。
- `agent-runtime-python/src/ielts_agent/planner/study_plan.py` — M12-04 planner orchestration（deterministic + fail-closed）。
- `agent-runtime-python/tests/test_planner_types.py` — 33 个类型契约测试。
- `agent-runtime-python/tests/test_study_plan.py` — 38 个 orchestrator 行为测试。

### Capability 方法名 / 版本（期望 Rust Slice 1 暴露）

| capability | 版本 | 用途 | 已就绪 |
| --- | --- | --- | --- |
| `study_plan.create` | `1` | **NEW** — 提交 planner proposal，Rust 分配 `planId` 并持久化 study_plans/study_plan_items | 否（Slice 1 待暴露） |
| `learning.learner_skill_state` | `1` | 读取 M4 skill review needs + skill state（best-effort enrichment） | 是（M4 reverse-RPC 已就绪） |
| `memory.search_active` | `1` | 读取 M3 active memory（best-effort enrichment；当前 orchestrator v1 未主动调用，仅声明允许集） | 是（M3 reverse-RPC 已就绪） |
| `context.materialize` | `1` | M5 retrieval context（声明允许集；planner v1 未主动调用） | 是（M5 reverse-RPC 已就绪） |

`REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES = {"study_plan.create": "1"}` —— planner 只 **必需** `study_plan.create`（持久化 gate）；learner/memory 读是 best-effort，host 缺失 → 0-item fallback，不 fatal。

### Deterministic constraints（M12-04）

planner 是纯函数：相同输入 ⇒ 相同 item 顺序（modulo host 分配的 `planId`）。排序键（首匹配优先）：

1. `priority` desc —— M4 调度器 due/overdue 排名（参考 TechSpar `get_due_reviews()` 思想）；
2. learner `uncertainty` desc —— 平局打破（更不确定优先）；
3. `target_date` 距离 asc —— 近 target 优先（lexical ISO date 差，calendar 算术在 Rust host 侧）；
4. `skill_key` asc —— 最终稳定打破（无随机性）。

时间约束：`total_estimated_minutes ≤ effective_available_minutes`；heavy week（≥5h）按 `RECENT_WORKLOAD_CAP_RATIO=0.5` 折减；每 item ≥ `MIN_PROBE_MINUTES=5`；`MAX_PROPOSAL_ITEMS=8`。

### 关键决策

- **M12-05 skill probe 非重复原题**：`SkillProbe` 只携带 `skill_key` + `probe_kind` + `avoid_asset_ids`（引导 host 选 novel 探针面），**绝不**携带原题 asset/question id。`SkillProbeKind` 镜像 Rust `SkillReviewProbe`（5 值）。planner 不复制 TechSpar process-local `task_status`。
- **M12-04 第一版只做 proposal**：`StudyPlanProposal` 提交后 Rust 分配 `planId`；Python 不写 canonical study-plan state。0-item proposal 是合法的「今天不练」，**非** fallback。
- **no-write-bypass**：orchestrator 唯一写路径是 `study_plan.create`；从不调用 `memory.promote`/`memory.write`/`tool.invoke`/direct SQL。
- **fail-closed**：host 失败 → `_fallback_proposal`（0 item + `fallback_reason`），从不抛 fatal；Rust journal baseline 不受影响。
- **M3 gate**：planner 包不导入 `sqlite3`（M3 contract gate 已验证通过；planner 被识别为 orchestration package）。
- **M12-06 forbidden tools**：planner 包不导入 os/subprocess/keyring/pathlib；不访问 filesystem/secrets/prompt mutation/schema migration。

### 边界遵循

- 不编辑 host_bridge.py / protocol.py / runtime.py / memory_*.py / retrieval/ / coach/ / dream/ / eval/。
- 不碰 Rust 代码（migration 0022 / agent_thread.rs / cognitive_runtime.rs）。
- planner 包独占：types.py + study_plan.py + __init__.py。
