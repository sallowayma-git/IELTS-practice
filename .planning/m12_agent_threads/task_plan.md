# M12 General Agent Thread + Study Planner + Controlled Actions Plan

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M12 章（行 9204-9384）完成 General Agent Thread、Study Planner 与 Controlled Actions（Python primary / Rust controlled actions）。把 Agent Workspace 从「调试/显式对话入口」升级为「可以看、问、计划、解释、受控行动的学习控制台」。这是原 v1.0 M2 能力后移，不是删除。最后一个里程碑。

## Baseline (M0-M11 已完成且门禁 27/27)

- M0/M1 `agent_runs`/`agent_tool_calls` 表（0011）已存在，run-level 审计。
- M6 AttemptReview run + LearningReadTools（7 read-only tools）。
- M4 Learner skill_review_needs（planner 输入）+ M5 retrieval/context + M3 memory + M9 Memory Center。
- M7 background_jobs（durable job authority）+ M8 consolidation + M10 strategy + M11 prompt/skill eval。
- Vue `AgentWorkspacePage.vue`（416 行，现有 UI 原型）。
- migration 当前到 0021；M12 用 `0022_agent_threads_planner.sql`（6 表）。`llm_invocations` 已在 M5 建立。

## Slices

- [x] **Slice 1 (Rust, Agent A)** — migration 0022 + agent thread + checkpoint/cancellation + controlled action gate
  - `0022_agent_threads_planner.sql`：agent_threads（create/list/archive/thread_kind/sequence/summary/thread-level context scope）、agent_messages（thread_id/role/sequence/content/trace）、agent_checkpoints（thread_id/stage：context_built/model_response/tool_before/tool_after/waiting_approval/final/payload_json/created_at）、study_plans（user_id/goal/available_time/target_date/created_at）、study_plan_items（plan_id/skill_probe/why/estimated_minutes/done）、agent_action_approvals（thread_id/action_kind/payload_json/status：pending/approved/rejected/approved_by/created_at）。
  - M12-01 agent thread：create/list/archive；thread kind；sequence；summary；thread-level context scope。
  - M12-02 checkpoint/cancellation：cancellation token；cancel request DB；interrupted after restart；child retry run；read-only tool safe replay；write tool never automatic replay。
  - M12-06 controlled action tools：allow `create_study_plan_draft`/`mark_plan_item_done`/`archive_memory_with_user_confirmation`/`set_explicit_preference`；approval-gate `bulk archive`/`reset derived memory`/`change personalization settings`/`modify long-term plan`；永不提供 `direct SQL`/`arbitrary filesystem`/`API key read`/`production prompt mutation`/`schema migration`/`silent delete history`。
  - 暴露 reverse-RPC + Tauri commands（thread/approval/planner CRUD）。
- [x] **Slice 2 (Python, Agent B)** — Study Planner orchestration (干净室，不碰 Rust)
  - `agent-runtime-python/src/ielts_agent/planner/`：study_plan.py（M12-04 输入：user goal/available time/skill review needs/learner uncertainty/recent workload/user preferences/target date → 输出 proposal：今天练什么/为什么/用什么 skill probe/预计多久）、types.py、__init__.py。
  - M12-05：skill probe（非自动重复原题，参考 TechSpar get_due_reviews() 但选 skill probe）。
  - no-LLM path（deterministic constraints）+ fail-closed。
  - 通过 host_bridge.invoke 调 Rust authority（thread/plan/approval CRUD + learner/memory read）。
- [x] **Slice 3 (Wave 2)** — Vue Agent Workspace 升级 + 确定性测试 + ADR-M12 + stage gate report
  - M12-08 UI：thread list/message flow/tool trace/context trace/memory refs/cancel-retry/approval card/study plan panel。
  - 确定性测试（§9363-9373）：restart thread restore/cancel model-tool/retry lineage/no duplicate side effect/planner deterministic constraints/action approval/forbidden tools absent/context-thread privacy/packaged restart/long thread compaction。
  - ADR-M12 + M12 stage gate report。

## File ownership

- Agent A 独占：`crates/ielts-db/migrations/0022_*.sql`(NEW)、`crates/ielts-{domain,db,application}/src/agent_thread.rs`(NEW)、相关 lib.rs pub-mod 追加、`src-tauri/src/cognitive_runtime.rs`(EDIT reverse-RPC + tool.invoke controlled-action gate)、`src-tauri/src/app/application_store.rs`(最小追加 impl)、tests。
- Agent B 独占：`agent-runtime-python/src/ielts_agent/planner/`(NEW dir)、`agent-runtime-python/tests/test_planner_*.py`(NEW)。**不编辑** host_bridge/protocol/runtime/memory_*/retrieval/coach/dream/eval。
- Slice 3 独占：`apps/writing-vue/src/views/AgentWorkspacePage.vue`(EDIT 升级)、ADR-M12、stage gate。

## Guardrails

- M12-03 Workspace 不是 Memory engine 本身；只查询/计划/受控行动。
- M12-02 write tool never automatic replay（read-only safe replay only）。
- M12-06 forbidden tools 永不提供（direct SQL/filesystem/API key/prompt mutation/schema migration/silent delete）。
- M12-04 planner 第一版只做 proposal。
- M12-07 embeddings 不为架构完整强上（M5 lexical+FTS 已满足则不强上）。
- Rust 拥有 controlled actions authority；Python 拥有 planner orchestration。
- 每个 slice 完成后 `run_static_suite.py` 27/27 + `suite_practice_flow.py` 16/16。
- Linus 风格：数据结构优先、无特殊 case、≤3 层缩进、不破坏 userspace。
