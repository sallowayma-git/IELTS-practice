# Findings

## 2026-08-16 M6 基线评估

- `crates/ielts-application/src/learner.rs`：`LearnerModelStore::learner_state_snapshot`/`skill_review_needs_snapshot` 已存在 → M6-02 `get_learner_skill_state` 工具直接委托。
- `crates/ielts-application/src/cognitive_read.rs`：`CognitiveReadStore::observation_snapshot`/`observations_by_ids`/`learning_events_by_ids` 已存在 → M6-02 `get_memory_evidence` 可复用（evidence 是 observation 的上游 event）。
- `crates/ielts-application/src/memory/service.rs`：`MemoryStore::context_preview` 已存在且 bounded/sensitivity-filtered → M6-02 `search_active_memories` 直接委托。
- `LearningEventType::CoachFeedbackProvided` 已在 M1 落地（domain/learning_events.rs），但 M6-05 需正式 canonical feedback enum + 表。
- `AgentRunKind::AttemptReview` 已存在；M6-01 把 ContextPack/Memory/Learner reads 接进该 run，不新建 Agent。
- `src-tauri/src/cognitive_runtime.rs` reverse-RPC 当前 match：tool.invoke/model.invoke/retrieval.*/context.materialize/model.embed.batch。M6-02 三工具可新增 `learning.learner_skill_state`/`memory.search_active`/`learning.evidence_by_ids` 分支。
- Rust `coach.rs`（CoachService）是现有 baseline，M6 保留为 fallback；PythonPersonalizedCoach 走 shadow。
- `crates/ielts-db/migrations/` 当前到 0016；M6 用 `0017_coach_learning_feedback.sql`。

## 2026-08-16 Slice 1 (Rust) Findings

- Migration `0017_coach_learning_feedback.sql` 落地 4 张表：`coach_feedback` / `coach_reask_links` / `coach_strategy_assignments_v0` / `coach_outcome_links_v0`。全部 `IF NOT EXISTS`、CHECK 枚举、UNIQUE 幂等约束。`coach_outcome_links_v0.future_observation_id` FK 用 `ON DELETE SET NULL`（不是 CASCADE）因为 `learner_observations` 是可重建 derived projection，不在 backup snapshot 里——CASCADE 会在 projection rebuild 时误删 outcome link。
- Backup schema version 从 9 升到 10。4 张新表加入 `CANONICAL_TABLES`（按 FK 依赖顺序：coach_messages → coach_feedback/coach_reask_links/coach_strategy_assignments_v0 → coach_outcome_links_v0）。`restore_snapshot` 改为 `tables.get(table_name)` + skip None，兼容旧 schema 包（v2-v9）不含新表的场景。
- `validate_logical_references` 新增 4 表的 FK 引用校验（coach_feedback.coach_message_id / coach_reask_links.* / coach_strategy_assignments_v0.coach_message_id / coach_outcome_links_v0.strategy_assignment_id）。`context_snapshot_id` 和 `future_observation_id` 引用 derived projection 表（agent_context_snapshots / learner_observations），不纳入 backup 校验——它们在 target rebuild 后才存在。
- 6 个 legacy backup 测试（v2/v4/v5/v6/v8）的 `database.retain` 过滤器追加 `is_coach_feedback_table` helper，避免降级包携带新表被 `table_map` 拒绝。
- M1 `CoachFeedbackProvided` event 的 idempotency key 是 `(event_type, source_id, schema_version)`。同一 coach_message 上不同 feedback_kind 会冲突——`record_coach_feedback` 的 `source_id` 用 `{coach_message_id}:{feedback_kind}` 而非裸 `coach_message_id`，否则不同 kind 的第二次 insert 会触发 `learning event idempotency conflict`。
- M6-02 三个 bounded read tools 走 reverse-RPC 分支（不是新 Tauri command），feature-gate 在 `context-compiler-v1`：`learning.learner_skill_state` → `LearnerModelStore::learner_state_snapshot`；`memory.search_active` → `MemoryStore::context_preview`；`learning.evidence_by_ids` → `CognitiveReadStore::learning_events_by_ids`。每个工具序列化后强制 64KiB ceiling。底层 store 已有 sensitivity filter + bounded + schema-strict。
- `PROVIDED_HOST_CAPABILITIES` 追加 3 个 capability（version "1"，`context-compiler-v1` feature 下）：`learning.learner_skill_state` / `memory.search_active` / `learning.evidence_by_ids`。handshake hostCapabilities 动态注入自动覆盖。
- M6-04/05/06/10 的 Tauri command（`coach_record_feedback` / `coach_record_reask_link` / `coach_record_strategy_assignment` / `coach_link_outcome`）feature-gate 在 `learning-observation-v1`（不是 context-compiler-v1），因为这些是用户交互持久化、不依赖 retrieval/context，但 `record_coach_feedback` 内部 `append_learning_event_if_enabled` 需要 `learning-event-ledger-v1`（由 `learning-observation-v1` 蕴含）。
- 硬编码版本 fixture 升级 16→17：`learning_events.rs`（`applied` vec + 2 处 version assert）、`learner_model.rs`（`applied` vec + current_version assert）、`phase3_migration.rs`（version assert + applied vec）、`backup_full_roundtrip.rs`（schema_version 9→10）。

## 2026-08-16 Slice 2 (Python) Findings

### 交付文件（干净室，独占）
- `agent-runtime-python/src/ielts_agent/coach/__init__.py` — 包导出。
- `agent-runtime-python/src/ielts_agent/coach/types.py` — M6-04/M6-05/M6-06/M6-10 pydantic wire 契约。
- `agent-runtime-python/src/ielts_agent/coach/strategies.py` — M6-09 固定策略目录 + 确定性选择器。
- `agent-runtime-python/src/ielts_agent/coach/preference_extractor.py` — M6-07 preference candidate 提取器。
- `agent-runtime-python/src/ielts_agent/coach/personalized_coach.py` — M6 Runtime Rule shadow/fallback runtime。
- `agent-runtime-python/tests/test_coach_strategies.py` — 19 测试。
- `agent-runtime-python/tests/test_coach_preference_extractor.py` — 12 测试。
- `agent-runtime-python/tests/test_coach_personalized.py` — 12 测试。
- `agent-runtime-python/src/ielts_agent/__init__.py` — 最小追加导出（CoachShadowResult/PythonPersonalizedCoach/select_strategy）。

### 策略目录（M6-09，固定，不让 LLM 自创）
- `evidence_first_v1` — observed evidence 优先；无 skill-family default 时的 grounded fallback。
- `example_first_v1` — worked example 优先；boost=NEED_EXAMPLE/REASK_SAME_QUESTION；default=writing.task1/task2。
- `step_by_step_v1` — 有序分解；boost=NEED_STEP_BY_STEP；default=reading.matching/writing.task1。
- `contrastive_v1` — 近邻错误对比；boost=INCORRECT；default=reading.tfng。
- `socratic_prompt_v1` — 引导提问暴露 misconception；boost=REASK_SAME_QUESTION；default=reading.inference；reask 无其他 feedback 时默认。
- `concise_direct_v1` — 短直纠正；boost=TOO_LONG/NOT_RELEVANT；default=reading.detail。
- 选择优先级：feedback boost > reask(无 boost) > skill-family default > proficiency nudge(≤0.25→step_by_step / ≥0.85→concise_direct) > evidence_first fallback。
- 无权重字段（M6 不学习权重；M10 才在 catalog 上加权重）。

### Python 侧期望 Rust 暴露的 host capability 方法名/版本（对齐用）
- `learning.learner_skill_state` version `"1"` — 入参 `{activity, skills[]}`；出参 `{skills:[{skill, proficiency, ...}]}`。
- `memory.search_active` version `"1"` — bounded/sensitivity-filtered active memory 搜索（复用 MemoryStore::context_preview）。
- `learning.evidence_by_ids` version `"1"` — 按 observation id 批量取 evidence（复用 CognitiveReadStore）。
- 复用既有：`context.materialize` v1（入参 `{plan, scope}`，出参 ContextPack `{manifest:{snapshotId,...}, renderedContext, renderedHash}`）；`model.invoke` v1（入参 `{request:{messages, temperature}}`，出参 `{content}`）。
- 期望 Rust 侧 `coach_strategy_assignments_v0`/`coach_outcome_links_v0` 持久化接收 `CoachStrategyAssignment.to_wire()`（schemaVersion/strategyId/skillsAddressed/memoryIdsUsed/contextSnapshotId/followupType）。

### 关键决策
- **不新建写路径**：preference candidate 通过既有 `memory.candidates.submit` host capability 提交（AddProposal，namespace=preference，canonicalKey=`preference.coach.*`），复用 M3 validator 的 namespace/action 契约；Rust 仍只存 pending candidate，不自动晋升 Soul（M6-07）。
- **fallback 非致命**：`evaluate_shadow` 永不抛 fatal；任何 capability mismatch/host 失败/空 model 输出 → 返回 `CoachShadowResult(fell_back=True, fallback_reason=...)`，调用方（Rust baseline）接管。fallback 原因字符串带步骤前缀（`learner_skill_state_unavailable:*` / `context_materialize_unavailable:*` / `model_invoke_unavailable:*` / `model_invoke_empty_content` / `capability_mismatch:*` / `host_capabilities_unavailable`）。
- **shadow 不展示**：`CoachShadowResult` 只回质量/延迟信号（`quality_signals`：strategyId/contextSnapshotId/renderedContextChars/explanationChars/preferenceCandidateCount/learnerSkillStatePresent + `latencyMs`），是否展示由 Rust gate 决定。
- **predicted ≠ observed**：candidate statement 显式标注 "Candidate preference ... Promotion requires repeated signal plus later better outcomes"；canonical_key 严格 `preference.coach.<family>`；evidence_observation_ids 必须非空才出 candidate（无 evidence → 空批次，no-feedback 路径仍工作）。
- **satisfaction ≠ learning**：`CoachOutcome` 用 `CoachOutcomeKind`（satisfaction|learning）分轴；thumbs_up 只能产 satisfaction 候选，learning outcome 只能由后续 skill observation 触发。
- **干净室**：coach 包零 sqlite3/keyring/v2.db/getpass（m3 gate 验证通过）；所有 memory/learner/model 访问走 host gateway；不直接打开 canonical SQLite。

### 验证结果
- `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → 95 测试全过（52 既有 + 43 新增，无回归）。
- `python developer/tests/ci/check_m3_contracts.py` → "M3 contract gate passed"（coach 包未触发 sqlite3 gate）。
- `python developer/tests/ci/run_static_suite.py` → 27/27 passed, 0 failed（无回归）。

## 2026-08-16 Slice 3 Findings

### AttemptReview 接入 M6-02 三工具（M6-01：复用现有 run，不新建 Agent）

- `LearningReadTools` 现在持 `&AppDb`，execute 内构造 `ApplicationStore::new(self.db)` 委托对应 service。保持 `new(db)` 签名不变，最小化破坏面。不需要在 `LearningReadTools` 上加 `ApplicationStore` 字段 —— 每次 execute 时构造一个 lightweight `ApplicationStore`（它只持 `&AppDb`，零分配）。
- 三个新工具 definition + execute 分支：
  - `get_learner_skill_state`（入参 skillKeys[]/afterSkillKey/limit）→ `LearnerModelService::new(&store).state_snapshot(&query)`。LearnerStateQuery 的 skill_keys/after_skill_key/limit 直接从工具参数映射。
  - `search_active_memories`（入参 activity/currentInstruction/limit）→ `MemoryService::new(&store).context_preview(&query)`。activity 用 `ielts_domain::Activity` serde 反序列化（snake_case enum，deny_unknown_fields 自动拒绝 invalid value）。user_id 硬编码 "local"（与 MemoryContextQuery default 一致）。
  - `get_memory_evidence`（入参 observationIds[]）→ `CognitiveReadService::new(&store).learning_events_by_ids(&ids)`。evidence 是 observation 上游 event，用 learning_events_by_ids（不是 observations_by_ids）。
- `encode_application_result` 新增 helper：与 `encode_result` 同构，只是 error 类型从 `DbResult<T>` 变 `Result<T, ApplicationError>`。同样 enforce 64KiB ceiling + audit summary 不复制正文 + audit payload 含 tool + bytes。
- registry 测试从 `registry_contains_only_four_learning_reads`（4 tools）更新为 `registry_contains_seven_learning_reads`（7 tools）。新增 2 个测试：`m6_tools_reject_unknown_arguments_and_missing_required_fields`（deny_unknown_fields + required field 校验）、`m6_tools_execute_against_empty_store_and_stay_bounded`（空 store 返回空 snapshot，audit summary 含 count + bytes ≤ 64KiB）。
- `ATTEMPT_REVIEW_SYSTEM_PROMPT` 更新：告知 agent 可用 7 个工具（原 4 + M6-02 三工具），要求 M6-03 Reading Review Context 优先级（CURRENT ATTEMPT → RELEVANT HISTORY → PERSONAL MEMORY → TEACHING PREFERENCE）。user_prompt 也追加提示 optional 调用 get_learner_skill_state / search_active_memories。

### M6 Product Gate（确定性测试）

- `crates/ielts-application/tests/m6_product_gate.rs` 用 FakeStore（实现 CoachFeedbackStore + LearnerModelStore + CognitiveReadStore + MemoryStore）演示闭环。FakeStore 用 Mutex<Vec<Command>> 捕获所有写入，context_preview 只返回 explicit preference / active memory（不返回 pending candidate —— 这是 key assertion）。
- 7 tests 覆盖任务书行 8159-8171 全部 11 条 DoD：
  - feedback 是事实不自动变 preference（`feedback_is_fact_not_preference_and_candidate_stays_pending`：candidate pending，context_preview 为空）。
  - satisfaction ≠ learning（`satisfaction_and_learning_outcomes_are_on_separate_rows`：2 行不同 outcome_kind / different evidence / same strategy_assignment）。
  - re-ask linkage exact（`reask_linkage_is_exact_and_not_inferred_from_transcript`）。
  - feedback retry idempotent（`feedback_retry_is_idempotent_on_message_and_kind`：(coach_message_id, feedback_kind) 幂等）。
  - strategy assignment 含 contextSnapshotId（`attempt_a_records_feedback_and_strategy_assignment_with_provenance`）。
  - outcome link 连到 future observation（`closed_loop_attempt_a_to_c_links_outcome_to_future_observation`：完整 A→B→C 闭环）。
  - no feedback path still works（`no_feedback_path_still_works`）。
- preference candidate extractor 逻辑在测试内用 Rust 镜像 Python `extract_preference_candidates`（feedback_to_preference_family / strategy_to_preference_family map），提交走 `MemoryService::submit_cognitive_candidates`（复用既有 M3 candidate 路径，不新建写路径）。

### 关键决策

- **不新建 Agent**（M6-01）：只在现有 AttemptReview run 加工具，不创建 ReadingAgentV2/MemoryAgent/ReviewAgent2。
- **feedback ≠ preference**（M6-05/M6-07）：feedback 是 interaction fact，candidate 通过既有 memory candidate 路径持久化为 pending，promotion 是单独 Rust-owned gate。context_preview 不返回 pending candidate。
- **satisfaction ≠ learning**（M6-10）：outcome_kind 列区分，分行记录，不同 evidence。
- **Rust baseline 保留 fallback**（M6 Runtime Rule）：不重写不删除现有 CoachService；PythonPersonalizedCoach 走 shadow。
