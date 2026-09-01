# Progress

## 2026-08-16 M6 开工

- 审计：M0-M5 全部完成且门禁 27/27。M6 是任务书第一个产品级 P0 gate（Reading + Coach 闭环）。
- 基线评估：`LearnerModelStore`/`CognitiveReadStore`/`MemoryStore` 已有 bounded read 方法 → M6-02 工具直接复用；`CoachFeedbackProvided` event + `AgentRunKind::AttemptReview` 已存在；Rust `coach.rs` 为 fallback baseline。
- 派发并发两路子代理：
  - Agent A (Rust)：migration 0017 + canonical coach feedback/re-ask/strategy/outcome + 3 bounded read tools + structured metadata persistence。
  - Agent B (Python)：PythonPersonalizedCoach shadow + preference candidate extractor + strategy catalog。
- Slice 3（AttemptReview 接 ContextPack + Product Gate E2E + ADR-M6 + stage gate）待 Slice 1/2 完成后第二波。

## 2026-08-16 Slice 1 (Rust) 完成

### 交付
- Migration `0017_coach_learning_feedback.sql`（4 表：coach_feedback / coach_reask_links / coach_strategy_assignments_v0 / coach_outcome_links_v0）注册 version 17。
- Domain `coach_feedback.rs`：`CoachFeedbackKind`(11 enum) / `CoachStrategyId`(6 enum) / `CoachFollowupType` / `CoachOutcomeKind` + command/record DTO。
- DB `coach_feedback.rs`：`record_coach_feedback`(幂等 ON CONFLICT DO NOTHING + 追加 CoachFeedbackProvided event，source_id=`{msg}:{kind}`) / `record_reask_link` / `record_coach_strategy_assignment`(upsert on coach_message_id) / `link_coach_outcome`(satisfaction|learning 分行)。
- Application `coach_feedback.rs`：`CoachFeedbackStore` trait + `CoachFeedbackService`。
- Tauri commands（feature-gate `learning-observation-v1`）：`coach_record_feedback` / `coach_record_reask_link` / `coach_record_strategy_assignment` / `coach_link_outcome`。
- M6-02 三个 bounded read tools（reverse-RPC，feature-gate `context-compiler-v1`）：`learning.learner_skill_state` / `memory.search_active` / `learning.evidence_by_ids`，64KiB ceiling。
- Backup：schema 9→10，4 表入 `CANONICAL_TABLES`，`restore_snapshot` 改 `.get()` skip None 兼容旧包，`validate_logical_references` 追加 M6 FK 校验。
- 硬编码版本 fixture 16→17 全部升级。

### 声明的 capability 方法名/版本（供 Python 对齐）
- `learning.learner_skill_state` v1（context-compiler-v1）
- `memory.search_active` v1（context-compiler-v1）
- `learning.evidence_by_ids` v1（context-compiler-v1）
- Tauri command（非 reverse-RPC）：`coach_record_feedback` / `coach_record_reask_link` / `coach_record_strategy_assignment` / `coach_link_outcome`（均 learning-observation-v1）

### 验证结果
- `cargo check -p ielts-domain --locked --offline`：0 error，0 warning。
- `cargo check -p ielts-db --locked --offline`：0 error，0 warning。
- `cargo check -p ielts-application --locked --offline`：0 error，0 warning。
- `cargo check -p ielts-practice-tauri --locked --offline`：0 error，0 warning。
- `cargo test -p ielts-db --test coach_feedback --locked --offline`：6/6 pass（幂等/enum/re-ask linkage/outcome 分行）。
- `cargo test -p ielts-db --lib coach_feedback --locked --offline`：11/11 pass（含 strategy upsert / self-ref reject / unknown assignment reject）。
- `cargo test -p ielts-application --test coach_feedback_contract --locked --offline`：4/4 pass。
- `cargo test -p ielts-application --test context_materialization --locked --offline`：7/7 pass（不回归）。
- `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline`：4/4 pass（不回归）。
- `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline`：11/11 pass（含 5 个 legacy 包兼容）。
- `cargo test -p ielts-db --test learning_events --locked --offline`：6/6 pass（不回归）。
- `cargo test -p ielts-db --test learner_model --locked --offline`：5/5 pass（不回归）。
- `cargo test -p ielts-db --test phase3_migration --locked --offline`：5/5 pass（不回归）。
- `python developer/tests/ci/check_m3_contracts.py`：pass。
- `python developer/tests/ci/check_m4_contracts.py`：pass。
- `python developer/tests/ci/run_static_suite.py`：27/27 pass。

## 2026-08-16 Slice 2 (Python) 完成

- 新建 `agent-runtime-python/src/ielts_agent/coach/` 包（types/strategies/preference_extractor/personalized_coach + __init__），干净室未碰 host_bridge/protocol/runtime/memory_*/retrieval，未碰 Rust。
- M6-09 固定策略目录（6 策略）+ 确定性选择器（无权重，M6 只选择记录）。
- M6-07 preference candidate 提取器：feedback/re-ask/strategy metadata/explicit correction/selected memory → `preference.coach.*` candidate；只 candidate 不晋升 Soul；复用既有 memory candidate 提交路径。
- M6 Runtime Rule：`PythonPersonalizedCoach.evaluate_shadow` 走 shadow（frozen input 并行评估，不展示用户，回质量/延迟信号）；sidecar unavailable/protocol mismatch/cognitive timeout/空 model 输出 → 非致命 fallback（`fell_back=True` + `fallback_reason`），Rust baseline 接管；永不抛 fatal。
- M6-04 `CoachStrategyAssignment` metadata 记录（strategyId/skillsAddressed/memoryIdsUsed/contextSnapshotId/followupType），交 Rust 持久化。
- M6-10 `CoachOutcome` satisfaction|learning 分轴。

### 命令结果
- `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → Ran 95 tests in 0.429s — OK（52 既有 + 43 新增，无回归）。
- `python developer/tests/ci/check_m3_contracts.py` → "M3 contract gate passed"。
- `python developer/tests/ci/run_static_suite.py` → summary: passed 27, failed 0（无回归）。

### 待 Rust 侧对齐（capability 方法名/版本）
- `learning.learner_skill_state` v1、`memory.search_active` v1、`learning.evidence_by_ids` v1（M6-02 三工具，read-only/bounded/schema-strict/64KiB/sensitivity filter）。
- `coach_strategy_assignments_v0` / `coach_outcome_links_v0` 接收 `CoachStrategyAssignment.to_wire()`。

## 2026-08-16 Slice 3 完成

- **AttemptReview 接入 M6-02 三工具**（M6-01：复用现有 run，不新建 Agent）：
  - `src-tauri/src/agent/learning_tools.rs`：`LearningReadTools` 增加 3 个 read-only tool definition + execute 分支（get_learner_skill_state / search_active_memories / get_memory_evidence），execute 内构造 `ApplicationStore::new(self.db)` 委托对应 service。新增 `encode_application_result` helper（与 `encode_result` 同构，64KiB ceiling + audit summary 不复制正文）。
  - `src-tauri/src/commands/agent.rs`：`ATTEMPT_REVIEW_SYSTEM_PROMPT` 更新为描述 M6-03 Reading Review Context 优先级 + 7 工具；user_prompt 追加 optional 调用提示。
  - registry 测试从 4 更新为 7（`registry_contains_seven_learning_reads`），新增 2 个 M6-02 工具测试。
- **M6 Product Gate**（确定性测试）：`crates/ielts-application/tests/m6_product_gate.rs` 7 tests，用 FakeStore（CoachFeedbackStore + LearnerModelStore + CognitiveReadStore + MemoryStore）演示完整闭环（Attempt A → B → C），断言 feedback≠preference / satisfaction≠learning / re-ask exact / idempotent / contextSnapshotId provenance / outcome link 连 future observation / no-feedback path。
- **ADR-M6**：`developer/docs/ADR-M6-Reading-Coach-Closed-Loop.md` 记录 M6 决策（Rust baseline fallback + Python shadow→canary→default、复用 AttemptReview 不新建 Agent、feedback≠preference、satisfaction≠learning、TechSpa drill 闭环参考拆成 observation/memory/learner 三条 projection、当前限制）。
- **M6 Stage Gate Report**：`developer/docs/M6_STAGE_GATE_REPORT.md` 仿 M5 格式，记录交付结论、直接验证命令+结果、仓库级门禁、诚实限制、遗留项、DoD 核对（11/11）。

### 命令结果

- `cargo check -p ielts-application --locked --offline`：0 error，0 warning。
- `cargo check -p ielts-practice-tauri --locked --offline`：0 error，0 warning。
- `cargo test -p ielts-practice-tauri --lib learning_tools --locked --offline`：6/6 passed（registry 断言 7 tools + 2 新 M6-02 测试）。
- `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline`：4/4 passed（不回归）。
- `cargo test -p ielts-application --test m6_product_gate --locked --offline`：7/7 passed（product gate 通过）。
- `cargo test -p ielts-application --test context_materialization --locked --offline`：7/7 passed（不回归）。
- `cargo test -p ielts-application --test coach_feedback_contract --locked --offline`：4/4 passed（不回归）。
- `python developer/tests/ci/check_m3_contracts.py`：pass（不回归）。
- `python developer/tests/ci/check_m4_contracts.py`：pass（不回归）。
- `python developer/tests/ci/run_static_suite.py`：27/27 pass（不回归）。

### M6 全部完成

Slice 1 (Rust) + Slice 2 (Python) + Slice 3 (集成 + Product Gate + 文档) 全部完成。M6 产品级 P0 闭环（Reading attempt → M1 event → M2 observation → M3 memory candidate → M4 learner skill state → M5 context compiler → AttemptReview/Coach explanation → user feedback → new canonical evidence）已通过确定性 product gate 证明。诚实限制：shadow 未 canary、未 live model E2E、preference promotion 自动化未实现、outcome link 时间窗未约束。
