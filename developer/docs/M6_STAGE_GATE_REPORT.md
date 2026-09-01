# M6 Stage Gate Report

日期：2026-08-16
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M6 章（行 7875-8186）

## M6 交付结论

M6 Reading + Coach First Closed Loop 阶段契约验证完成（产品级 Go/No-Go：No-Go）：

- **M6-01 复用 AttemptReview**（不新建 Agent）：`AgentRunKind::AttemptReview` 现有 run 接入三个新 bounded read-only tool。`LearningReadTools` 持 `&AppDb`，execute 内构造 `ApplicationStore::new(self.db)` 委托对应 service，保持 `new(db)` 签名不变。
- **M6-02 三个 bounded learning-state tools**：
  - `get_learner_skill_state`（入参 skillKeys/afterSkillKey/limit）→ 委托 `LearnerModelService::state_snapshot`（经 ApplicationStore）。
  - `search_active_memories`（入参 activity/currentInstruction/limit）→ 委托 `MemoryService::context_preview`。
  - `get_memory_evidence`（入参 observationIds[]）→ 委托 `CognitiveReadService::learning_events_by_ids`（evidence 是 observation 上游 event）。
  - 每个工具 read-only / deny_unknown_fields schema / audit summary 不复制正文 / 64KiB ceiling（复用 `encode_application_result` + `MAX_MODEL_RESULT_BYTES`）。
- **M6-03 Reading Review Context 优先级**：`ATTEMPT_REVIEW_SYSTEM_PROMPT` 更新为 CURRENT ATTEMPT → RELEVANT HISTORY → PERSONAL MEMORY → TEACHING PREFERENCE，告知 agent 可用 7 个工具（原 4 + M6-02 三工具）。
- **M6-04 Coach Response Structured Metadata**：`CoachStrategyAssignmentRecord` 持久化 strategyId / skillsAddressed / memoryIdsUsed / contextSnapshotId / followupType（M6 Slice 1 落地，M6 product gate 测试断言 contextSnapshotId provenance）。
- **M6-05 Canonical Coach Feedback**：11 种 feedback_kind（thumbs_up / ... / style_correction），interaction fact ≠ preference。
- **M6-06 Re-ask Linkage**：UI/service 明确记录 parent_assistant_message_id / new_user_message_id，不靠 transcript 猜。
- **M6-07 Coach Preference Candidate Extractor**：feedback / re-ask / strategy metadata / explicit correction / selected memory → `preference.coach.*` candidate；只 candidate 不晋升 Soul；复用既有 memory candidate 提交路径。
- **M6-09 固定策略目录**：6 策略（evidence_first_v1 / example_first_v1 / step_by_step_v1 / contrastive_v1 / socratic_prompt_v1 / concise_direct_v1），LLM 只选择不发明。
- **M6-10 Outcome Link**：satisfaction（thumbs_up）与 learning（later skill observation）分轴，分行记录。
- **M6 Runtime Rule**：Rust baseline CoachService 保留 fallback；PythonPersonalizedCoach shadow → canary → default；sidecar unavailable → 非致命 fallback。
- **M6 Product Gate**（确定性测试）：`crates/ielts-application/tests/m6_product_gate.rs` 7 tests 证明闭环数据流。

## M6 直接验证

| 命令 | 结果 |
|---|---|
| `cargo check -p ielts-application --locked --offline` | pass（0 error，0 warning） |
| `cargo check -p ielts-practice-tauri --locked --offline` | pass（0 error，0 warning） |
| `cargo test -p ielts-practice-tauri --lib learning_tools --locked --offline` | 6/6 passed（含 registry 断言 7 tools + 2 新 M6-02 测试） |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` | 4/4 passed（不回归） |
| `cargo test -p ielts-application --test m6_product_gate --locked --offline` | 7/7 passed（product gate 通过） |
| `cargo test -p ielts-application --test context_materialization --locked --offline` | 7/7 passed（不回归） |
| `cargo test -p ielts-application --test coach_feedback_contract --locked --offline` | 4/4 passed（不回归） |
| `python developer/tests/ci/check_m3_contracts.py` | pass（不回归） |
| `python developer/tests/ci/check_m4_contracts.py` | pass（不回归） |
| `python developer/tests/ci/run_static_suite.py` | 27/27 pass（不回归） |

### learning_tools 测试明细（6 tests）

| 测试 | 断言 |
|---|---|
| `registry_contains_seven_learning_reads` | registry 正好 7 个 tool（原 4 + M6-02 三工具），不含 write_file/replace_in_file |
| `rejects_mutation_tools_and_unknown_arguments` | write_file rejected（unknown_tool），get_attempt_detail 拒绝 unknown field |
| `attempt_detail_excludes_raw_answers_and_audit_payloads_exclude_event_content` | raw answer 不进 model_content / audit，private event 被 sensitivity filter |
| `rejects_oversized_model_output_without_copying_it_to_audit` | 64KiB ceiling，oversized rejected，marker 不进 audit |
| `m6_tools_reject_unknown_arguments_and_missing_required_fields` | M6-02 三工具 deny_unknown_fields + required field 校验 |
| `m6_tools_execute_against_empty_store_and_stay_bounded` | M6-02 三工具对空 store 返回空 snapshot，audit summary 含 count + bytes ≤ 64KiB |

### M6 Product Gate 测试明细（7 tests）

| 测试 | 闭环断言 |
|---|---|
| `attempt_a_records_feedback_and_strategy_assignment_with_provenance` | feedback(incorrect) + strategy_assignment(evidence_first_v1) 含 contextSnapshotId |
| `feedback_is_fact_not_preference_and_candidate_stays_pending` | need_example feedback → candidate pending，context_preview 不返回 pending candidate |
| `satisfaction_and_learning_outcomes_are_on_separate_rows` | thumbs_up(satisfaction) 与 learning outcome 分行、不同 evidence、同 strategy assignment |
| `reask_linkage_is_exact_and_not_inferred_from_transcript` | parent → new user message 精确 linkage |
| `feedback_retry_is_idempotent_on_message_and_kind` | (coach_message_id, feedback_kind) 幂等 |
| `closed_loop_attempt_a_to_c_links_outcome_to_future_observation` | 完整闭环：A error → B candidate pending → C outcome link(learning) 连 future observation |
| `no_feedback_path_still_works` | 无 feedback 时 strategy + outcome provenance 仍可记录 |

## 仓库级门禁状态

`run_static_suite.py` 27/27 pass。Tauri shipping contract、Rust workspace check、cognitive runtime contract、memory proposal contract、data-truth regressions、M4 learner model、AI config security、reading data integrity、Python cognitive protocol、M3/M4 contract boundary 全部通过。

## 诚实限制

1. **shadow 未 canary**：`PythonPersonalizedCoach.evaluate_shadow` 走 shadow 路径，但尚未进入 canary / default。Rust baseline 仍是唯一用户可见 Coach。
2. **未 live model E2E**：与 M3/M5 stage gate 一致，M6 product gate 用 FakeStore 验证闭环数据流（contract / protocol / persistence 边界），不验 live model 质量。真实 provider E2E 不在本会话范围。
3. **preference candidate promotion 自动化未实现**：candidate 持久化为 pending 后，promotion 仍需 Rust-owned gate 手动触发。M6-07 只产 candidate，不自动晋升。
4. **outcome link 时间窗未约束**：M6-10 只记录 linkage，不校验 future_observation_id 的时间先后（它是 derived projection，在 rebuild 后才存在）。

## 遗留项

- 接入真实 provider 后跑 AttemptReview live E2E，验证 7 个 tool 在真实 model 调用链中的行为。
- `PythonPersonalizedCoach` 从 shadow 进入 canary，需要质量/安全/延迟/失败恢复 gate 指标。
- preference candidate promotion 自动化：repeated signal + later better outcomes 的自动检测 + promotion gate。
- outcome link 时间窗校验：future_observation_id 的 occurred_at 应晚于 strategy_assignment 的 created_at。

## DoD 核对（任务书行 8159-8171）

- [x] AttemptReview context 只含 relevant memory（search_active_memories bounded + context_preview 只返回 active/explicit）
- [x] read tools remain read-only（7 tools 全部 read-only，deny_unknown_fields，无 mutation tool）
- [x] thumbs-down creates fact, not immediate memory（feedback_is_fact_not_preference_and_candidate_stays_pending）
- [x] re-ask linkage exact（reask_linkage_is_exact_and_not_inferred_from_transcript）
- [x] feedback retry idempotent（feedback_retry_is_idempotent_on_message_and_kind）
- [x] response metadata persisted（attempt_a_records_feedback_and_strategy_assignment_with_provenance 断言 contextSnapshotId）
- [x] context snapshot lineage（strategy_assignment.context_snapshot_id 引用 agent_context_snapshots）
- [x] strategy assignment links later observation（closed_loop_attempt_a_to_c_links_outcome_to_future_observation）
- [x] same question repeat familiarity correctly labeled（reask linkage 精确记录，不靠 transcript）
- [x] no feedback path still works（no_feedback_path_still_works）
- [x] LLM unavailable → deterministic review panel remains available（M6 Runtime Rule：Rust baseline fallback）

## Round 3 Post-Audit Addendum（2026-08-31）

本报告的“阶段契约验证完成”只表示列出的确定性测试、持久化和边界合同通过，不表示生产级 PersonalizedCoach 已接通，也不替代产品 Go/No-Go。Round 3 审计确认：当前 Rust baseline 仍是唯一用户可见 Coach，Python PersonalizedCoach 尚未进入 shadow→canary→default 的生产调用链；因此 M6 产品级 Go/No-Go 保持 **No-Go**。下游阶段不能把本报告原来的“全部完成”解读为 Coach 闭环已验收。详见 [Round 3 审计报告](PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md) 与 [后端审计发现](../../.planning/agent_backend_audit_20260824/findings.md)。
