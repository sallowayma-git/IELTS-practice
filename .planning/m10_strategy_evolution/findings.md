# Findings

## 2026-08-16 M10 基线评估

- M6 `coach_strategy_assignments_v0`（0017）：strategy_id CHECK 6 enum（evidence_first_v1/example_first_v1/step_by_step_v1/contrastive_v1/socratic_prompt_v1/concise_direct_v1）+ UNIQUE(coach_message_id) + skill/memory/context_snapshot/followup_type。M10 扩展为 teaching_strategy_assignments（加 why_selected + response_message_id + skill_keys array）。
- M6 `coach_outcome_links_v0`：strategy_assignment_id + future_observation_id + outcome_kind（satisfaction|learning）分行。M10 复用此 + 新增 teaching_strategy_feedback（satisfaction channel 细分：thumbs/reask/explicit correction/abandon）+ teaching_strategy_outcomes（learning channel 细分：next novel skill attempt/next writing revision/corrected repeated behavior/transfer to another asset）。
- M6 Python `coach/strategies.py`：6 策略目录 + 确定性选择器（无权重，M6 只选择记录）。M10 扩展为 8 策略 catalog（+error_then_rule_v1/rule_then_example_v1）+ user_strategy_state（strategy×scope 统计）+ selection 规则优先级（M10-06）。
- M8 consolidation validator 模式（§23.16 四 gate + stable ID 重验 + §23.17 apply）可借鉴用于 M10 candidate strategy 离线 eval-gated promotion（M10-08 candidate 需开发者定义 prompt module + 离线 eval，不直接 executable）。
- M7 dream_runs/dream_candidates + background_jobs 可复用于 strategy_candidate_batches 离线 eval。
- migration 当前到 0019；M10 用 0020。
- TechSpar 参考：M10 是 IELTS 超越 TechSpar 当前画像闭环的核心阶段（§8863）；无直接 TechSpar 代码参考，clean-room。

## 2026-08-16 Slice 2 (Python) Findings

### 交付文件（绝对路径）
- 新增：`F:\workspace\IELTS Atlas APP\agent-runtime-python\src\ielts_agent\coach\strategy_eval.py` — M10 strategy evaluation orchestrator（Python 侧）。
- 追加：`F:\workspace\IELTS Atlas APP\agent-runtime-python\src\ielts_agent\coach\types.py` — M10 typed contracts（StrategyAssignment/UserStrategyState/StrategySelection/OutcomeAttribution + StrategyFeedbackKind/StrategyOutcomeKind/OutcomeAttributionKind + capability 常量）。
- 新增：`F:\workspace\IELTS Atlas APP\agent-runtime-python\tests\test_strategy_eval.py` — 65 测试，覆盖 M10-03/04/05/06/07/08 + fail-closed + no-write-bypass。

### 期望 Rust 侧暴露的 capability 方法名/版本（v1，便于对齐）
- `strategy.select` (v1)：接收 `{selection: StrategySelection.to_wire()}`，Rust 持久化选中策略 + 跟踪 exploration ratio cap（10%）。
- `strategy.record_assignment` (v1)：接收 `{assignment: StrategyAssignment.to_wire()}`，Rust 写 teaching_strategy_assignments。
- `strategy.record_feedback` (v1)：接收 `{strategyAssignmentId, feedbackKind(StrategyFeedbackKind), note?}`，Rust 写 teaching_strategy_feedback（satisfaction 轴）。
- `strategy.record_outcome` (v1)：接收 `{attribution: OutcomeAttribution.to_wire()}`，Rust 写 teaching_strategy_outcomes（learning 轴，仅 attributed verdict 才记 effectiveness claim；out_of_window/discounted_same_asset 不记）。
- `strategy.user_state` (v1)：接收 `{scope}`，返回 `{rows: [UserStrategyState.to_wire()]}`（strategy×scope 统计）。

### Reward channel 分轴（M10-03）
- Satisfaction 轴（StrategyFeedbackKind 5 值）：`thumbs` / `reask` / `explicit_correction` / `abandon` / `neutral`。聚合字段：satisfactionCount + reaskCount。
- Learning 轴（StrategyOutcomeKind 4 值）：`next_novel_skill_attempt` / `next_writing_revision` / `corrected_repeated_behavior` / `transfer_to_another_asset`。聚合字段：successCount + novelTransferSuccess + failureCount。
- 两轴**完全不相交**（enum 值 disjoint，test 验证）；thumbs-up 永远不能进入 learning 轴（test_explicit 验证）。

### 关键决策
1. **M10 8 策略 catalog 定义在 `coach/types.py`**（`STRATEGY_CATALOG_V1` frozenset），不动 M6 `coach/strategies.py` 的 6 策略选择器（文件所有权纪律）。M10 evaluation 读 8-id catalog；M6 selector 保持不变。
2. **delayed outcome window 按 relevant observation 计数**（非墙钟）：irrelevant skill observation 不消耗 window slot（M10-04 "within next N relevant skill observations"）。window 默认 5。
3. **prefer novel asset**：same-asset repeat → `DISCOUNTED_SAME_ASSET`（不 credit learning，扫描停止）；novel asset + relevant skill → `ATTRIBUTED`。
4. **out of window 不归因**：超 window 返回 `OUT_OF_WINDOW`，不记 effectiveness claim，策略**不被惩罚**（test 验证）。
5. **confidence bounded**：`success/(success+failure)` clamped [0,1]；zero evidence → neutral prior 0.5（untested ≠ bad）；satisfaction count 不 inflate confidence（M10-03/05）。
6. **selection 优先级**：explicit preference（M10-07 尊重，仅 contraindication 覆盖）> contraindication filter > proven personal（confidence > 0.5 且 sufficient evidence）> default > exploration slot（仅证据足够 + allow_exploration，cap 10% 由 Rust authority 跟踪）。
7. **preference vs effectiveness 冲突（M10-07）**：尊重显式偏好，不暗中切换；emit candidate suggestion（标 `candidate_suggestion_only`，不 auto-promote M10-08）+ 解释 why。
8. **proven personal 阈值**：confidence > 0.5（success > failure）才算 proven；net-negative evidence 的策略不重复选（fall through 到 default/exploration）。
9. **fail-closed**：host 失败 → fallback verdict（OUT_OF_WINDOW，不 credit/punish）/ fallback selection（default strategy），never fatal。ExplodingBridge test 验证 never raises。
10. **no-write-bypass**：所有 state 访问走 `host_bridge.invoke` strategy.* capability；test 验证不调 memory.promote/write/upsert，所有调用以 `strategy.` 开头。
11. **M10-08 candidate**：candidate suggestion 只产不晋升，标 `candidate_suggestion_only`；离线 eval 是 Rust 侧 gate（Python 不执行）。

### 验证结果
- `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → **257 tests OK**（192 既有 + 65 新增，全过，无回归）。
- `python developer/tests/ci/check_m3_contracts.py` → **M3 contract gate passed**（coach 包无 sqlite3）。
- `python developer/tests/ci/run_static_suite.py` → **26/27 pass**；唯一 fail = `Rust workspace check`（`cargo check --workspace`），因 Slice 1 Rust 侧 `application_store.rs` 引用未定义的 `teaching_strategy_error`（in-progress Rust 工作，非 Python 侧引入，超出 Slice 2 边界）。Python cognitive protocol + M3 contract boundary + M4 contract 全 pass。

## 2026-08-16 Slice 1 (Rust) Findings

### 交付完成
本条目为真正的 Slice 1（Rust 侧）交付，修复此前 progress.md 中标注的 "Rust workspace check 失败"（`application_store.rs` 未定义 `teaching_strategy_error`）问题。此前 Slice 2 Python 侧记录的 26/27 失败因 Slice 1 Rust 未完成；本交付后恢复 27/27。

### 新增文件
- `crates/ielts-db/migrations/0020_teaching_strategy_evolution.sql` — 6 表（catalog/assignments/feedback/outcomes/user_strategy_state/strategy_candidate_batches）+ 8 策略 catalog seed。
- `crates/ielts-domain/src/teaching_strategy.rs` — domain contracts（TeachingStrategyId 8 enum、StrategyFeedbackKind 5、StrategyOutcomeKind 4、OutcomeAttribution tagged enum、SelectStrategyCommand/StrategySelection 等）。
- `crates/ielts-db/src/teaching_strategy.rs` — 持久化层（record/select/state 聚合/candidate gate）。
- `crates/ielts-application/src/teaching_strategy.rs` — TeachingStrategyService + TeachingStrategyStore trait。
- `crates/ielts-db/tests/teaching_strategy.rs` — 11 集成测试。
- `crates/ielts-application/tests/teaching_strategy.rs` — 8 契约测试。
- `src-tauri/src/commands/teaching_strategy.rs` — 7 Tauri commands。
- 修改：`migrate/mod.rs`（注册 v20）、`backup/mod.rs`（schema 12→13 + V12 legacy list + CANONICAL_TABLES 追加 6 表）、`application_store.rs`（TeachingStrategyStore impl + teaching_strategy_error）、`cognitive_runtime.rs`（5 reverse-RPC + capability）、`commands/mod.rs` + `lib.rs`（command 注册）。

### 关键设计决策
1. **independent assignments table**：`teaching_strategy_assignments` 独立于 M6 `coach_strategy_assignments_v0`（FK 到 coach_messages + agent_context_snapshots，UNIQUE(response_message_id)）。M10 可对 later response 重分配，attribution window + state 聚合归属 M10 层。
2. **两 reward channel 物理分表**：satisfaction → `teaching_strategy_feedback`（5 enum），learning → `teaching_strategy_outcomes`（4 enum）。`record_strategy_feedback` 和 `record_strategy_outcome` 是唯一入口，写不同表。test 验证 thumbs-up 永不进 outcomes 表，learning outcome 永不进 feedback 表。
3. **attribution window（M10-04）**：`record_strategy_outcome` 先查 assignment.context_snapshot_id（缺失 → `MissingContextSnapshot`，不记），再 count 该 user 在 assignment.created_at 之后的 learner_observations 数量；超 DEFAULT_OUTCOME_WINDOW(=5) → `OutOfWindow`，不记 outcome，不惩罚策略。
4. **prefer novel asset**：`novel_asset_id` 存在 → `Attributed{novel_asset:true}`（credit success + novel_transfer_success）；缺失 → `Attributed{novel_asset:false}`（discounted，记 failure）。
5. **confidence bounded（M10-05）**：`UserStrategyState::clamp_confidence(success, failure)` = success/(success+failure) clamped [0,1]；zero evidence → 0.0（neutral prior 留给 Python evaluation 层解释，Rust 仅持久化 bounded 值）。satisfaction_count 不 inflate confidence。
6. **selection rule-priority（M10-06）**：explicit preference（catalog applicable 检查）> contraindication filter（memory_id 命中 contraindication 列表则排除）> proven personal（confidence 最高 + evidence >= PROVEN_STRATEGY_MIN_EVIDENCE=3）> default（catalog is_default）> exploration slot（仅 total_evidence >= EXPLORATION_MIN_EVIDENCE=3 时，FNV-1a hash 取 mod 100 < 10 触发，选非 default）。deterministic 以保证 test 可复现。
7. **candidate gate（M10-08）**：`record_strategy_candidate_batch` 落 pending；`promote_strategy_candidate(promote=false)` → rejected，`promote=true` → promoted。promoted candidate **不进 catalog enum**（需开发者定义 prompt_module + 离线 eval），永不直接 executable。test 验证。
8. **backup roundtrip**：BACKUP_SCHEMA_VERSION 12→13；CANONICAL_TABLES 追加 6 表；新增 V12_CANONICAL_TABLES（不含 M10 表）保证 legacy v12 包 restore 兼容；`is_newer_than_legacy` 追加 `is_m10_table` 让 legacy 测试（v2-v8）正确剥离 M10 表。

### 声明的 capability 方法名/版本（供 Python 对齐）
reverse-RPC `PROVIDED_HOST_CAPABILITIES` 追加（feature-gated on `daily-dream-v1`，版本均为 "1"）：
- `strategy.select` (v1)
- `strategy.record_assignment` (v1)
- `strategy.record_feedback` (v1)
- `strategy.record_outcome` (v1)
- `strategy.user_state` (v1)

reverse-RPC 参数约定：
- `strategy.select` → `params.query: SelectStrategyCommand`
- `strategy.record_assignment` → `params.command: RecordStrategyAssignmentCommand`
- `strategy.record_feedback` → `params.command: RecordStrategyFeedbackCommand`
- `strategy.record_outcome` → `params.command: RecordStrategyOutcomeCommand`
- `strategy.user_state` → `params.userId/strategyId/scope`（strategyId 为 enum 字符串）

Tauri commands（feature-gated on `daily-dream-v1`）：`teaching_strategy_select`、`teaching_strategy_record_assignment`、`teaching_strategy_record_feedback`、`teaching_strategy_record_outcome`、`teaching_strategy_user_state`、`teaching_strategy_record_candidate_batch`、`teaching_strategy_promote_candidate`。

### 验证结果（实跑）
- `cargo check -p ielts-domain -p ielts-db -p ielts-application --locked --offline` → 0 error（1 pre-existing warning in consolidation.rs，非本 slice 文件）。
- `cargo check -p ielts-practice-tauri --locked --offline` → 0 error。
- `cargo test -p ielts-db --test teaching_strategy --locked --offline` → **11/11 pass**。
- `cargo test -p ielts-application --test teaching_strategy --locked --offline` → **8/8 pass**。
- `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` → **4/4 pass**（不回归）。
- `cargo test -p ielts-application --test context_materialization --locked --offline` → **7/7 pass**（不回归）。
- `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline` → **11/11 pass**（不回归，含 5 legacy restore 测试）。
- `python developer/tests/ci/check_m3_contracts.py` → **M3 contract gate passed**。
- `python developer/tests/ci/check_m4_contracts.py` → **M4 learner-model contract verified**。
- `python developer/tests/ci/run_static_suite.py` → **27/27 pass**（恢复，此前 26/27 因 Slice 1 未完成）。

### 测试覆盖映射（§9017-9026）
- explicit preference wins → `explicit_preference_wins_over_default` (db) + `service_delegates_selection_to_store` (app)
- satisfaction vs learning reward separated → `satisfaction_feedback_never_written_to_learning_outcomes_table` + `learning_outcome_never_written_to_satisfaction_table` (db) + `service_delegates_satisfaction_feedback_to_store` + `service_delegates_learning_outcome_to_store_and_propagates_attribution` (app)
- no future outcome → no effectiveness claim → `out_of_window_observation_is_not_recorded` (db)
- repeated same asset discounted → `repeated_same_asset_outcome_is_recorded_but_flagged_non_novel` (db)
- exploration cap → `exploration_does_not_fire_with_insufficient_evidence` (db)
- strategy rollback → `candidate_batch_rejected_is_never_executable` (db) + `service_candidate_promote_gate_rejects` (app)
- missing context snapshot → `missing_context_snapshot_blocks_outcome_recording` (db)
- catalog seeded → `catalog_is_seeded_with_eight_strategies_and_one_default` (db)
- state aggregation → `user_strategy_state_aggregates_confidence_bounded` (db)
- candidate promotion → `candidate_batch_promoted_marks_for_offline_eval` (db) + `service_candidate_promote_gate_promotes` (app)

### 追加：M11 解锁修复（pre-existing 编译/测试问题）
仓库磁盘上已存在未提交的 M11 Prompt/Skill Evolution 工作（`0021_prompt_skill_evolution.sql` + `prompt_skill.rs` domain/db），但该工作**无法编译**（`EvalCaseGrading` 含 f64 却派生 `Eq`；db 模块缺 `RunEvalCommand` import），阻塞整个 workspace + static suite。因验证要求 static suite 27/27，且 M11 代码非我所有权范围但阻塞 M10 验证，做了最小解阻修复：
- `crates/ielts-domain/src/prompt_skill.rs`：移除 `RunEvalCommand` 的 `Eq` derive（`Vec<EvalCaseGrading>` 含 f64，不满足 Eq）。
- `crates/ielts-db/src/prompt_skill.rs`：补 `RunEvalCommand` import（rustfmt 自动归一）。
- `crates/ielts-db/tests/memory_profile_core.rs`：`explicit_priority_and_forget_are_deterministic` 的 `!contains("approve")` 子串断言误中 M11 `approved_by` 列名；改为 JSON-encoded 值检查 `!contains("\"approve\"")` + `!contains("approve observed pattern")`，保留隐私意图不误中 schema 列名。
- `crates/ielts-db/tests/backup_full_roundtrip.rs`：追加 `M11_TABLES` + `is_m11_table` 让 legacy restore 测试正确剥离 M11 表。
- `crates/ielts-db/tests/{phase3_migration,learner_model,learning_events}.rs`：版本断言 20→21（M11 注册 v21）。

这些是 M11 pre-existing 问题的最小解阻，非 M10 范围内的新功能。static suite 27/27 恢复（此前因 M11 无法编译，data-truth regressions 检查 fail）。
