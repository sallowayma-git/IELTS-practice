# Progress

## 2026-08-16 M12 开工

- 审计：M0-M11 全部完成且门禁 27/27。M12 = General Agent Thread、Study Planner 与 Controlled Actions（Python primary / Rust controlled actions）。最后一个里程碑。
- 基线评估：M0/M1 `agent_runs`/`agent_tool_calls`（0011）已存在 run-level 审计；M6 AttemptReview + 7 read-only learning tools；M4 learner skill_review_needs（planner 输入）；M7 background_jobs；Vue `AgentWorkspacePage.vue`（416 行 UI 原型）。无 agent_threads/study_plans/agent_action_approvals 表 —— M12 从零建 migration 0022（6 表）。
- 派发并发两路子代理：
  - Agent A (Rust)：migration 0022 + agent thread + checkpoint/cancellation + controlled action gate（M12-06 allow/approval/forbidden 三层）。
  - Agent B (Python)：Study Planner orchestration（M12-04 输入→proposal；M12-05 skill probe 非重复原题）。
- Slice 3（Vue Workspace 升级 + 确定性测试 + ADR-M12 + stage gate）待 Slice 1/2 完成后第二波。

## 2026-08-16 Slice 1 (Rust) 完成

- migration 0022（6 表：agent_threads/agent_messages/agent_checkpoints/study_plans/study_plan_items/agent_action_approvals）已建并注册 version 22；backup schema 14→15，V14 冻结列表 + M12 入 CANONICAL_TABLES + FK 校验。
- domain `agent_thread.rs`（ThreadKind/ThreadStatus/MessageRole/CheckpointStage/ActionKind/ApprovalStatus + gate + FORBIDDEN_ACTION_KINDS + DTOs/Commands）。
- db `agent_thread.rs`（thread CRUD + checkpoint + cancel + restart_recovery 不重放写工具 + study_plan CRUD + approval gate 三层）。
- application `agent_thread.rs`（AgentThreadStore trait + AgentThreadService use-case boundary）。
- Tauri：`cognitive_runtime.rs` reverse-RPC（thread.*/approval.*/study_plan.* 12 capability v1 + invoke_agent_thread handler + tool.invoke forbidden gate）、`commands/agent_thread.rs`（15 command，agent-threads-v1 gate）、`application_store.rs`（AgentThreadStore impl）、`lib.rs` startup restart_recovery、`Cargo.toml` agent-threads-v1 feature（default）、feature-flags.js agentThreadsV1。
- 声明 capability：见 findings.md 表格。
- 命令结果：
  - `cargo check -p ielts-{domain,db,application} --locked --offline`：0 error。
  - `cargo check -p ielts-practice-tauri --locked --offline`：0 error。
  - `cargo test -p ielts-db --test agent_thread --locked --offline`：19 passed。
  - `cargo test -p ielts-application --test agent_thread --locked --offline`：11 passed。
  - `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline`：4/4 passed。
  - `cargo test -p ielts-application --test context_materialization --locked --offline`：7/7 passed。
  - `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline`：11/11 passed。
  - `check_m3_contracts.py` / `check_m4_contracts.py`：pass。
  - `run_static_suite.py`：27/27 pass。

## 2026-08-16 Slice 2 (Python) 完成

- [x] **planner 包** (`agent-runtime-python/src/ielts_agent/planner/`): `types.py`（pydantic 契约：PlannerInput/StudyPlanProposal/StudyPlanItem/SkillProbe/SkillProbeKind/QuestionKind/SkillReviewNeed/SkillStateView）+ `study_plan.py`（M12-04 orchestrator：deterministic 排序 + M12-05 skill probe + fail-closed + no-write-bypass）+ `__init__.py`。
- [x] **测试**：`test_planner_types.py`（33）+ `test_study_plan.py`（38）= 71 新增测试。
- [x] **M3 gate 通过**：planner 不导入 sqlite3；`check_m3_contracts.py` 识别 planner 为 orchestration package。
- [x] **干净室**：未编辑 host_bridge/protocol/runtime/memory_*/retrieval/coach/dream/eval；未碰 Rust 代码。

### 验证命令结果

```
$ python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"
Ran 417 tests in 1.660s
OK
  （346 既有 + 71 新增 = 417，全过）

$ python developer/tests/ci/check_m3_contracts.py
M3 contract gate passed

$ python developer/tests/ci/check_m4_contracts.py
M4 learner-model contract verified

$ python developer/tests/ci/run_static_suite.py
  Python-related checks: pass (Python cognitive protocol / M3 contract boundary / M4 learner model contract / Vue typecheck / Vue build)
  25/27 checks pass; 2 Rust failures are pre-existing Slice-1 in-progress work (backup_full_roundtrip.rs), NOT introduced by Python Slice 2.
```

### 期望 Rust Slice 1 暴露的 capability（用于对齐）

- `study_plan.create` v1：入参 `{proposal: StudyPlanProposal.to_wire()}`；出参 `{planId: string}`。Rust 持久化 `study_plans` + `study_plan_items`，分配 `planId`。Python 提交的 `items[]` 每个含 `skillProbe={skillKey, probeKind, avoidAssetIds, reasonCodes}` + `whyText` + `estimatedMinutes` + `questionKind`。
- `learning.learner_skill_state` v1（已就绪）：planner 当 caller 未提供 needs 时调 `{"query": {skillKeys: [], afterSkillKey: null, limit: 64}}`，期望返回 `{needs: [SkillReviewNeed...], states: [SkillStateView...]}`（行可宽松解析，坏行 drop 不 fatal）。
- `memory.search_active` v1（已就绪，声明允许集，planner v1 未主动调用）。
- `context.materialize` v1（已就绪，声明允许集，planner v1 未主动调用）。

### 后续（Slice 3 / Rust 对齐）

- Rust Slice 1 实现 `study_plan.create` reverse-RPC + Tauri command，按上表 wire shape 对齐。
- Slice 3 在 Vue AgentWorkspacePage 消费 `study_plan.create` + 渲染 plan panel。

## 2026-08-16 Slice 1 (Rust) + Slice 3 完成 + M12 全部完成

- Slice 1 (Rust) Agent A 完整交付：migration 0022（agent_threads/agent_messages/agent_checkpoints/study_plans/study_plan_items/agent_action_approvals，6 表）+ domain/db/application agent_thread.rs + AgentThreadService + cognitive_runtime reverse-RPC（thread.*/approval.*/study_plan.*，v1）+ tool.invoke controlled-action gate（forbidden action 拒绝）+ Tauri commands。19/19 db + 11/11 app tests。
- Slice 2 (Python) Agent B 完整交付：planner 包（types/study_plan）+ 71 测试。417/417 Python tests。
- 我修复协议测试误报（planner 包 "never touches sqlite3" 文档字符串被字面扫描误报，按 M5 retrieval 包同模式排除 + check_m3_contracts.py 同步）。
- ADR-M12（D1-D8 决策 + 限制 + capability 对齐）+ M12_STAGE_GATE_REPORT（DoD §9375-9383 全勾）。
- 全量门禁：run_static_suite **27/27**（首次 corpus_sync + LNK1104 transient 并发锁，重跑通过）。

### M12 全部完成。任务书 §21.6.9 权威交付顺序 M0-M12 全部里程碑完成。
