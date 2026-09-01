# M6 Reading + Coach First Closed Loop Plan

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M6 章（行 7875-8186）完成第一个产品级 P0 闭环：Reading attempt → M1 event → M2 observation → M3 memory candidate → M4 learner skill state → M5 context compiler → AttemptReview/Coach explanation → user feedback → new canonical evidence。不扩展到 M7+。

## Baseline (working tree, M0-M5 已完成且门禁 27/27)

- M2.1 Cognitive Read Gateway、M3 Memory Core + Python sidecar、M4 Learner Model、M5 Retrieval + Context Materializer 全部完成。
- `crates/ielts-application/src/learner.rs`（`LearnerModelStore::learner_state_snapshot`/`skill_review_needs_snapshot`）、`cognitive_read.rs`（`observation_snapshot`/`observations_by_ids`）、`memory/service.rs`（`MemoryStore::context_preview`）已有 bounded read 方法 —— M6-02 工具直接复用。
- `LearningEventType::CoachFeedbackProvided` 已存在（M1）；`AgentRunKind::AttemptReview` 已存在。
- `src-tauri/src/commands/context.rs` 的 `context_materialize` + `ContextMaterializerService` 已可产出 ContextPack。
- `crates/ielts-application/src/coach.rs` 是现有 Rust baseline CoachService（M6 保留为 fallback）。

## Slices

- [x] **Slice 1 (Rust, Agent A)** — migration 0017 + canonical coach feedback/re-ask/strategy/outcome + 3 bounded read tools + coach response structured metadata persistence
  - `0017_coach_learning_feedback.sql`：`coach_feedback`/`coach_reask_links`/`coach_strategy_assignments_v0`/`coach_outcome_links_v0`
  - M6-02 三工具：`get_learner_skill_state`/`search_active_memories`/`get_memory_evidence`（read-only/bounded/schema-strict/audit-summary/64KiB/sensitivity filter）—— 暴露为 host capabilities（reverse-RPC）或 Tauri commands
  - M6-04 coach response metadata：`strategyId`/`skillsAddressed`/`memoryIdsUsed`/`contextSnapshotId`/`followupType` 落 `coach_strategy_assignments_v0`
  - M6-05 canonical coach feedback enum（thumbs_up/.../style_correction）
  - M6-06 re-ask linkage（parent_assistant_message_id/new_user_message_id/feedback_kind=reask_same_question）
  - M6-10 outcome link：`coach_outcome_links_v0` 连接 strategy_assignment 与 future skill observation
- [x] **Slice 2 (Python, Agent B)** — `PythonPersonalizedCoach` shadow path + preference candidate extractor + strategy catalog
  - M6-09 固定策略目录（evidence_first_v1/example_first_v1/step_by_step_v1/contrastive_v1/socratic_prompt_v1/concise_direct_v1）
  - M6-07 Coach Preference Candidate Extractor：从 feedback/re-ask/strategy metadata/explicit correction/memory context 产 candidate（preference.coach.*），只 candidate 不晋升为 Soul
  - M6 Runtime Rule：PythonPersonalizedCoach shadow（frozen input 并行评估，不展示用户）；sidecar unavailable → 退回 Rust baseline
- [x] **Slice 3 (Wave 2)** — AttemptReview 接入 ContextPack/Memory/Learner + M6 Product Gate E2E + ADR-M6 + stage gate report
  - M6-01 把 ContextCompiler/Learner/Memory reads 接进 AttemptReview run（不另建 Agent）
  - M6-03 Reading Review Context（CURRENT ATTEMPT/RELEVANT HISTORY/PERSONAL MEMORY/TEACHING PREFERENCE）
  - M6 Product Gate：Attempt A Matching Headings error → Attempt B same skill error → memory candidate → coach explanation → Attempt C improves → outcome evidence
  - ADR-M6 + M6 stage gate report

## File ownership (avoid concurrent-edit conflicts)

- Agent A 独占：`crates/ielts-db/migrations/0017_*.sql`(NEW)、`crates/ielts-{domain,db,application}/src/coach_feedback.rs`(NEW)、`src-tauri/src/commands/learning.rs`(EDIT 追加工具命令)、`src-tauri/src/cognitive_runtime.rs`(EDIT reverse-RPC 新 method 分支)、相关 lib.rs pub-mod 追加、tests。
- Agent B 独占：`agent-runtime-python/src/ielts_agent/coach/`(NEW dir)、`agent-runtime-python/tests/test_coach_*.py`(NEW)、strategy catalog 数据文件。**不编辑** host_bridge.py/protocol.py/runtime.py/memory_*.py/retrieval/（用现有 generic invoke + memory_context_preview）。
- Slice 3 独占：`crates/ielts-application/src/agent.rs`(EDIT AttemptReview 接 ContextPack)、`apps/writing-vue/`(M6 UI 最小追加)、ADR-M6、stage gate report、product gate fixture。

## Guardrails

- Rust baseline CoachService 保留为 fallback，不重写、不删除（M6 Runtime Rule）。
- M6 不创建 ReadingAgentV2/MemoryAgent/ReviewAgent2（M6-01）。
- 三工具 read-only/bounded/schema-strict/64KiB/sensitivity filter（M6-02）。
- feedback 是交互事实，不等于长期 preference（M6-05）；candidate 不自动变 Soul（M6-07）。
- satisfaction outcome（点赞）≠ learning outcome（M6-10）—— 分开表。
- 每个 slice 完成后 `run_static_suite.py` + `suite_practice_flow.py` 必须保持 27/27 + 16/16。
- Linus 风格：数据结构优先、无特殊 case、≤3 层缩进、不破坏 userspace。
