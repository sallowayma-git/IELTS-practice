# M10 Teaching Strategy Evolution Plan

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M10 章（行 8845-9038）完成 Teaching Strategy Evolution / Procedural Memory（Python-first evaluation）。把「用户喜欢什么回答」与「什么讲解方式真的提升后续学习表现」分开。不扩展到 M11。

## Baseline (M0-M9 已完成且门禁 27/27)

- M6 已有 `coach_strategy_assignments_v0`（strategy_id 6 enum：evidence_first_v1/example_first_v1/step_by_step_v1/contrastive_v1/socratic_prompt_v1/concise_direct_v1）+ `coach_outcome_links_v0`（satisfaction|learning 分行）。M10 扩展为正式 teaching strategy evolution。
- M6 Python `coach/strategies.py` 已有 6 策略目录 + 确定性选择器（无权重，M6 只选择记录）。
- M3 memory candidate 提交路径；M7 dream_runs/dream_candidates；M8 consolidation validator 模式（§23.16 四 gate + stable ID 重验）—— M10 strategy candidate 可复用类似 eval-gated promotion 模式。
- migration 当前到 0019；M10 用 `0020_teaching_strategy_evolution.sql`。

## Slices

- [x] **Slice 1 (Rust, Agent A)** — migration 0020 + strategy catalog + assignment + 2 reward channels + delayed outcome window + user_strategy_state + selection
  - `0020_teaching_strategy_evolution.sql`：teaching_strategy_catalog（8 策略：M6 的 6 + error_then_rule_v1/rule_then_example_v1；每条 applicable activity/skill kind/prompt module/contraindications/max verbosity/version）、teaching_strategy_assignments（strategy_id/why_selected/memory_ids/skill_keys/context_snapshot/response_message_id）、teaching_strategy_feedback（satisfaction channel：thumbs/reask/explicit correction/abandon）、teaching_strategy_outcomes（learning channel：next novel skill attempt/next writing revision/corrected repeated behavior/transfer to another asset）、user_strategy_state（strategy×scope success_count/failure_count/satisfaction_count/reask_count/novel_transfer_success/last_used/confidence）、strategy_candidate_batches（LLM candidate，离线 eval-gated，不直接 executable）
  - M10-03：两 reward channel 分开（satisfaction ≠ learning）；不能用 thumbs-up 证明教学策略有效。
  - M10-04 delayed outcome window：assignment at T0 → within next N relevant skill observations → prefer novel asset → compute outcome；超 window 不强行归因。
  - M10-05 user_strategy_state：strategy×scope 统计；不做全局 RL。
  - M10-06 selection 规则优先：explicit preference > contraindication > proven personal strategy > default > exploration slot（仅证据足够时小比例 exploration）。
  - M10-08 candidate strategy：LLM 可 propose 新 strategy，但需开发者定义 prompt module + 离线 eval，不直接 executable。
  - 暴露 reverse-RPC `strategy.select`/`strategy.record_assignment`/`strategy.record_outcome`（v1）+ Tauri commands。
- [x] **Slice 2 (Python, Agent B)** — Strategy evaluation orchestration (干净室，不碰 Rust)
  - `agent-runtime-python/src/ielts_agent/coach/strategy_eval.py`：delayed outcome attribution；2 reward channel 聚合；user_strategy_state confidence 计算（基于 success/failure/novel_transfer）；selection 候选打分（M10-06 规则）。no-LLM path + fail-closed。
  - preference vs effectiveness 冲突（M10-07）：尊重显式偏好，不暗中切换；候选 candidate 只产不晋升。
- [x] **Slice 3 (Wave 2)** — Tauri commands + 确定性测试 + ADR-M10 + stage gate report

## File ownership

- Agent A 独占：`crates/ielts-db/migrations/0020_*.sql`(NEW)、`crates/ielts-{domain,db,application}/src/teaching_strategy.rs`(NEW)、相关 lib.rs pub-mod 追加、`src-tauri/src/cognitive_runtime.rs`(EDIT reverse-RPC)、`src-tauri/src/app/application_store.rs`(最小追加 impl)、tests。
- Agent B 独占：`agent-runtime-python/src/ielts_agent/coach/strategy_eval.py`(NEW)、`agent-runtime-python/tests/test_strategy_eval*.py`(NEW)。**不编辑** host_bridge/protocol/runtime/memory_*/retrieval/dream/已有 coach strategies。
- Slice 3 独占：Tauri commands + 确定性测试 + ADR-M10 + stage gate。

## Guardrails

- satisfaction ≠ learning（M10-03）；thumbs-up 不能证明教学策略有效。
- M10-04 delayed outcome window；超 window 不强行归因。
- M10-06 exploration 仅证据足够时小比例。
- M10-07 preference vs effectiveness 冲突时尊重显式偏好，不暗中切换。
- M10-08 candidate strategy 需开发者定义 prompt module + 离线 eval，不直接 executable。
- Rust 拥有 promotion gate；Python 拥有 evaluation orchestration。
- 每个 slice 完成后 `run_static_suite.py` 27/27 + `suite_practice_flow.py` 16/16。
- Linus 风格：数据结构优先、无特殊 case、≤3 层缩进、不破坏 userspace。
