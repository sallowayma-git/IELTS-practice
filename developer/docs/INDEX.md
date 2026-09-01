# IELTS Atlas 工程文档入口

更新时间：2026-08-31

这是当前工程文档的入口。`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 已冻结为历史合同，不再承担状态板职责。

## 权威顺序

实现是否存在，以当前代码、测试和静态门禁为事实源。文档发生冲突时按以下顺序处理：

1. Round 3 审计附录与后续明确的修复记录
2. Accepted ADR
3. 对应 Stage Gate Report
4. 冻结的 v1.3 任务书

原始 gate report 的“契约验证完成”不等于真实模型质量、生产调用链或产品级 Go/No-Go 已通过；先看每份报告的 Round 3 附录和“诚实限制”。

## 当前状态入口

| 范围 | 决策/实现合同 | 阶段证据 | 主要迁移 | 代码入口 |
|---|---|---|---|---|
| M2.1 Cognitive Read | [ADR-M2.1](ADR-M2.1-Cognitive-Read-Gateway.md) | [M3 gate](M3_STAGE_GATE_REPORT.md) | `0013_learning_observation_projection.sql` | `crates/ielts-domain/src/cognitive_read.rs`, `crates/ielts-db/src/cognitive_read.rs` |
| M3 Runtime + Memory | [ADR-M3-00A](ADR-M3-00A-Python-Cognitive-Runtime-Bootstrap.md), [ADR-M3-01](ADR-M3-01-Memory-Proposal-Validator.md) | [M3 gate](M3_STAGE_GATE_REPORT.md) | `0014_memory_profile_core.sql` | `agent-runtime-python/src/ielts_agent/`, `src-tauri/src/cognitive_runtime.rs`, `crates/ielts-application/src/memory/` |
| M4 Learner Model | [ADR-M4](ADR-M4-01-Learner-Model-v1.md) | [M4 gate](M4_STAGE_GATE_REPORT.md) | `0015_learner_model_v1.sql` | `crates/ielts-domain/src/learner.rs`, `crates/ielts-db/src/learner.rs` |
| M5 Retrieval + Context | [ADR-M5](ADR-M5-Retrieval-Context-Materialization.md) | [M5 gate](M5_STAGE_GATE_REPORT.md) | `0016_context_retrieval_trace.sql` | `agent-runtime-python/src/ielts_agent/retrieval/`, `crates/ielts-application/src/context.rs`, `src-tauri/src/commands/context.rs` |
| M6 Coach | [ADR-M6](ADR-M6-Reading-Coach-Closed-Loop.md) | [M6 gate](M6_STAGE_GATE_REPORT.md) | `0017_coach_learning_feedback.sql` | `crates/ielts-application/src/coach.rs`, `crates/ielts-application/src/learning_tools.rs` |
| M7 Journal + Daily Dream | [ADR-M7](ADR-M7-Daily-Journal-Daily-Dream.md) | [M7 gate](M7_STAGE_GATE_REPORT.md) | `0018_daily_journal_jobs.sql` | `crates/ielts-db/src/journal.rs`, `crates/ielts-db/src/background_jobs.rs` |
| M8 Weekly Dream + Consolidation | [ADR-M8](ADR-M8-Weekly-Dream-Consolidation.md) | [M8 gate](M8_STAGE_GATE_REPORT.md) | `0019_memory_consolidation_v1.sql` | `crates/ielts-db/src/consolidation.rs`, `src-tauri/src/commands/journal.rs` |
| M9 Memory Center | [ADR-M9](ADR-M9-Memory-Center-Evidence-UX.md) | [M9 gate](M9_STAGE_GATE_REPORT.md) | uses M14/M19 data | `apps/writing-vue/src/views/MemoryCenterPage.vue`, `apps/writing-vue/src/api/memory-repository.js` |
| M10 Teaching Strategy | [ADR-M10](ADR-M10-Teaching-Strategy-Evolution.md) | [M10 gate](M10_STAGE_GATE_REPORT.md) | `0020_teaching_strategy_evolution.sql` | `crates/ielts-db/src/teaching_strategy.rs`, `src-tauri/src/commands/teaching_strategy.rs` |
| M11 Prompt + Skill Eval | [ADR-M11](ADR-M11-Prompt-Skill-Eval-Evolution.md) | [M11 gate](M11_STAGE_GATE_REPORT.md) | `0021_prompt_skill_evolution.sql` | `crates/ielts-db/src/prompt_skill.rs`, `agent-runtime-python/src/ielts_agent/eval/` |
| M12 Threads + Planner | [ADR-M12](ADR-M12-Agent-Threads-Planner-Controlled-Actions.md) | [M12 gate](M12_STAGE_GATE_REPORT.md) | `0022_agent_threads_planner.sql` | `crates/ielts-db/src/agent_threads.rs`, `src-tauri/src/commands/agent_thread.rs` |

## Gate and audit evidence

- [Round 3 adversarial audit](PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md)
- [Phase 10 release runbook](phase10-release-runbook.md)
- [M3-M12 planning findings](../../.planning/agent_backend_audit_20260824/findings.md)
- Static verification: `python developer/tests/ci/run_static_suite.py`
- Packaged regression: `python developer/tests/e2e/suite_practice_flow.py`

## Contract rules

- Canonical learning truth remains Rust-owned; Python sidecar state is derived and rebuildable.
- A stage gate records tested contracts and known limits; it does not grant a product Go/No-Go by assertion.
- New post-M12 design belongs in a new versioned document. Do not append status updates to the frozen v1.3 file.
