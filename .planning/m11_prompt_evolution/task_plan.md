# M11 Prompt/Skill Eval-driven Evolution Plan

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M11 章（行 9040-9200）完成 Prompt Registry、Skill Registry 与 Eval-driven Evolution（Python-first experiment / Rust release gate）。把用户级 Memory 演化与产品级 Prompt/Skill 演化彻底分开。线上 Agent 不修改自己的 Soul；产品 Prompt 通过受控工程流程演化。不扩展到 M12。

## Baseline (M0-M10 已完成且门禁 27/27)

- 现有 prompts 是硬编码 Rust 常量（`AGENT_SYSTEM_PROMPT`/`ATTEMPT_REVIEW_SYSTEM_PROMPT` in `src-tauri/src/commands/agent.rs`）；M11 引入 versioned prompt registry。
- M5 retrieval eval harness（`developer/tests/retrieval_eval/run_retrieval_eval.py`）是 eval 基础设施先例。
- M8 consolidation validator + M10 candidate strategy gate 是 candidate promotion 模式（M11-05 lifecycle 复用）。
- migration 当前到 0020；M11 用 `0021_prompt_skill_evolution.sql`（9 表）。

## Slices

- [x] **Slice 1 (Rust, Agent A)** — migration 0021 + prompt/skill registry + version pinning + candidate promotion gate
  - `0021_prompt_skill_evolution.sql`：prompt_templates/prompt_versions/skill_definitions/skill_versions/eval_cases/eval_runs/eval_results/candidate_promotions/shadow_runs。
  - M11-02 prompt module registry：core_soul/attempt_review/coach_reading/coach_writing/memory_extract/memory_resolve/daily_dream/weekly_dream/strategy_selector/study_planner。
  - M11-03 skill registry：read_attempt_evidence/compare_repeated_attempts/explain_tfng_error/build_weekly_reflection（可复用流程，不是 memory 文件，versioning 与 user memory 分离）。
  - M11-05 candidate lifecycle：propose → offline eval → holdout → shadow → manual approval → canary → promote → rollback。Rust 是 release gate；holdout never enters prompt generation context。
  - M11-06 禁止 online self-modifying prompt：拒绝 `update_system_prompt`/`edit_soul`/`install_unreviewed_skill` agent tool。
  - M11-08 trace graders metadata：prompt_version/skill_version pinned in invocation trace。
  - 反向-RPC `prompt.list_versions`/`prompt.promote_candidate`/`eval.run_case`（v1）+ Tauri commands。
- [x] **Slice 2 (Python, Agent B)** — eval runner + trace graders (干净室，不碰 Rust)
  - `agent-runtime-python/src/ielts_agent/eval/`：`cases.py`（M11-04 eval dataset：memory extraction goldens/false merge-split/consolidation zero/context selection/coach personalization/prompt injection/repeated familiarity/strategy outcome）、`graders.py`（M11-08：final answer/context used/irrelevant tool/memory citation/counter-evidence/oversized output/cost-latency）、`runner.py`（跑 eval_cases，记录 eval_runs/eval_results，no user-visible side effect）。
  - M11-05 candidate lifecycle orchestration（propose→eval→shadow→promote via host gateway）；shadow 无 user-visible side effect。
  - no-LLM path（deterministic graders）+ fail-closed。
- [x] **Slice 3 (Wave 2)** — Tauri commands + 确定性测试 + ADR-M11 + stage gate report

## File ownership

- Agent A 独占：`crates/ielts-db/migrations/0021_*.sql`(NEW)、`crates/ielts-{domain,db,application}/src/prompt_skill.rs`(NEW)、相关 lib.rs pub-mod 追加、`src-tauri/src/cognitive_runtime.rs`(EDIT reverse-RPC)、`src-tauri/src/app/application_store.rs`(最小追加 impl)、tests。
- Agent B 独占：`agent-runtime-python/src/ielts_agent/eval/`(NEW dir)、`agent-runtime-python/tests/test_eval_*.py`(NEW)。**不编辑** host_bridge/protocol/runtime/memory_*/retrieval/coach/dream。
- Slice 3 独占：Tauri commands + 确定性测试 + ADR-M11 + stage gate。

## Guardrails

- M11-01 Soul 不由 Daily/Weekly Dream 改写（稳定 Policy Layer）。
- M11-06 禁止 online self-modifying prompt（agent tool 黑名单）。
- M11-05 holdout never enters prompt generation context；shadow 无 user-visible side effect；rollback exact。
- prompt_version + skill_version pinned in every invocation trace。
- Rust 拥有 release gate；Python 拥有 experiment/eval orchestration。
- 每个 slice 完成后 `run_static_suite.py` 27/27。
- Linus 风格：数据结构优先、无特殊 case、≤3 层缩进、不破坏 userspace。
