# Progress

## 2026-08-16 M11 开工

- 审计：M0-M10 全部完成且门禁 27/27。M11 = Prompt Registry、Skill Registry 与 Eval-driven Evolution（Python-first experiment / Rust release gate）。
- 基线评估：无现有 prompt/skill/eval 表 —— M11 从零建 migration 0021（9 表）。现有 prompts 是硬编码 Rust 常量；M11 引入 versioned registry。M5 retrieval eval harness 是 eval 先例；M8/M10 candidate promotion gate 模式可复用。
- migration 当前到 0020；M11 用 `0021_prompt_skill_evolution.sql`。
- 派发并发两路子代理：
  - Agent A (Rust)：migration 0021 + prompt/skill registry + version pinning + candidate promotion gate + reverse-RPC + 禁止 online self-modifying prompt。
  - Agent B (Python)：eval runner + trace graders + candidate lifecycle orchestration。
- Slice 3（Tauri commands + 确定性测试 + ADR-M11 + stage gate）待 Slice 1/2 完成后第二波。

## 2026-08-16 Slice 2 (Python) 完成

- 新建 `agent-runtime-python/src/ielts_agent/eval/` 包（5 文件：`__init__.py`/`types.py`/`cases.py`/`graders.py`/`runner.py`）。
- 新建 3 测试文件：`test_eval_types.py`(24)/`test_graders.py`(32)/`test_runner.py`(33) = 89 新增测试。
- 8 类 case 全覆盖（M11-04），含 2 holdout cases（holdout isolation）。
- 7 deterministic graders + optional LLM grader（fail-closed）。
- Candidate lifecycle：propose→eval→shadow→promote→rollback，fail-closed，candidate cannot skip eval。
- M11-06 黑名单（`update_system_prompt`/`edit_soul`/`install_unreviewed_skill`）。
- 不碰 sqlite3（M3 gate）；不编辑 host_bridge/protocol/runtime/memory_*/retrieval/coach/dream；不碰 Rust。

### 验证命令结果

- `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → **Ran 346 tests OK**（257 既有 + 89 新增，0 回归）。
- `python developer/tests/ci/check_m3_contracts.py` → **M3 contract gate passed**。
- `python developer/tests/ci/run_static_suite.py` → Python 侧全过；Rust 侧失败来自 `crates/ielts-db/src/prompt_skill.rs:19` 编译错误（`EvalCaseGrading` not found，Rust Slice 1 in-flight），非本 slice 范围。

### 期望 Rust 侧暴露的 capability（便于对齐）

`prompt.list_versions`/`prompt.get_active`/`prompt.propose_candidate`/`prompt.promote_candidate`/`prompt.rollback`/`eval.run_case`/`skill.list_versions`，全部 version `"1"`。Rust Slice 1 须修 `prompt_skill.rs:19` 的 `EvalCaseGrading` import 错误（应改为 Rust 侧实际类型名，如 `EvalCaseGrade` 或删除未用 import）。

## 2026-08-16 Slice 1 (Rust) 补齐 + Slice 3 + M11 全部完成

- Agent A 交付 migration 0021（9 表）+ domain/db/application prompt_skill.rs（含 const fn 错误已修），但停滞在 cognitive_runtime reverse-RPC + ApplicationStore impl。我直接接管补齐：
  - ApplicationStore 实现 PromptSkillStore（16 trait methods 委托 ielts_db）。
  - cognitive_runtime reverse-RPC：prompt.list_versions/prompt.get_active/prompt.propose_candidate/prompt.promote_candidate/prompt.rollback/eval.run_case/skill.list_versions（v1，daily-dream-v1 feature）+ PROVIDED_HOST_CAPABILITIES 7 条。
  - prompt_skill_error helper。
- 验证：cargo check 0 error；prompt_skill 10/10 db tests；cognitive_runtime 4/4 不回归；Python 346/346；M3+M4 contract pass；run_static_suite **27/27**。
- ADR-M11（D1-D8 决策 + 限制 + capability 对齐）+ M11_STAGE_GATE_REPORT（DoD §9190-9200 全勾）。
- task_plan.md 勾选 Slice 1/2/3。
- M11 全部完成。

## 2026-08-16 Slice 1 (Rust) — COMPLETE

- [x] Migration 0021: 9 tables (prompt_templates/prompt_versions/skill_definitions/skill_versions/eval_cases/eval_runs/eval_results/candidate_promotions/shadow_runs) with CHECK enums + UNIQUE(version) + FKs.
- [x] Backup: BACKUP_SCHEMA_VERSION 13→14, V13_CANONICAL_TABLES frozen, M11 tables in CANONICAL_TABLES, snapshot_tables_for_schema v14 branch.
- [x] M11-01: `PromptModule::is_policy_layer()` for CoreSoul.
- [x] M11-02: prompt module registry (10 modules), `ensure_prompt_template`/`create_prompt_version`/`list_prompt_versions`/`get_active_prompt_version`.
- [x] M11-03: skill registry (4 skills), `ensure_skill_definition`/`create_skill_version`/`list_skill_versions`.
- [x] M11-04: eval cases (8 kinds), `insert_eval_case`/`list_eval_cases` (holdout excluded from prompt-gen path).
- [x] M11-05: candidate lifecycle `propose_candidate`→`run_eval`→`approve_candidate`→`promote_candidate`→`rollback_version`; one-active-version-per-template; exact rollback; `record_shadow_run` (no side effect enforced).
- [x] M11-06: `DENIED_SELF_MODIFYING_TOOLS` deny-list + `is_denied_self_modifying_tool`; `invoke_candidate_input_tool` explicit guard.
- [x] M11-08: `PromptVersionPin`/`SkillVersionPin` DTOs.
- [x] reverse-RPC: 7 methods (`prompt.list_versions`/`prompt.get_active`/`prompt.propose_candidate`/`prompt.promote_candidate`/`prompt.rollback`/`eval.run_case`/`skill.list_versions`) in `invoke_prompt_skill` + PROVIDED_HOST_CAPABILITIES.
- [x] Tauri commands: 8 commands in `commands/prompt_skill.rs`, registered in `lib.rs`.
- [x] `ApplicationStore` impl `PromptSkillStore`.

### Verification results

```
cargo check -p ielts-domain -p ielts-db -p ielts-application --locked --offline  → 0 error (1 pre-existing warning in consolidation.rs)
cargo check -p ielts-practice-tauri --locked --offline  → 0 error
cargo test -p ielts-db --test prompt_skill --locked --offline  → 10/10 pass
cargo test -p ielts-application --test prompt_skill --locked --offline  → 9/9 pass
cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline  → 4/4 pass (no regression)
cargo test -p ielts-application --test context_materialization --locked --offline  → 7/7 pass (no regression)
cargo test -p ielts-db --test backup_full_roundtrip --locked --offline  → 11/11 pass (no regression, M11 seed roundtripped)
cargo test -p ielts-db --test teaching_strategy --locked --offline  → 11/11 pass (no regression)
cargo test -p ielts-db --test phase3_migration --locked --offline  → 5/5 pass (no regression)
python developer/tests/ci/check_m3_contracts.py  → pass
python developer/tests/ci/check_m4_contracts.py  → pass
python developer/tests/ci/run_static_suite.py  → 27/27 pass (no regression)
```

### Files touched
- NEW: `crates/ielts-db/migrations/0021_prompt_skill_evolution.sql`
- NEW: `crates/ielts-domain/src/prompt_skill.rs`
- NEW: `crates/ielts-db/src/prompt_skill.rs`
- NEW: `crates/ielts-application/src/prompt_skill.rs`
- NEW: `crates/ielts-db/tests/prompt_skill.rs`
- NEW: `crates/ielts-application/tests/prompt_skill.rs`
- NEW: `src-tauri/src/commands/prompt_skill.rs`
- EDIT: `crates/ielts-db/src/migrate/mod.rs` (version 21 registration)
- EDIT: `crates/ielts-db/src/backup/mod.rs` (BACKUP_SCHEMA_VERSION 14, V13_CANONICAL_TABLES, CANONICAL_TABLES +9, snapshot_tables_for_schema)
- EDIT: `crates/ielts-db/src/lib.rs` (pub mod prompt_skill + re-export)
- EDIT: `crates/ielts-domain/src/lib.rs` (pub mod prompt_skill + re-export)
- EDIT: `crates/ielts-application/src/lib.rs` (pub mod prompt_skill + re-export)
- EDIT: `src-tauri/src/cognitive_runtime.rs` (M11-06 deny-list guard in invoke_candidate_input_tool)
- EDIT: `src-tauri/src/commands/mod.rs` (pub mod prompt_skill)
- EDIT: `src-tauri/src/lib.rs` (8 prompt_skill command registrations)
- EDIT: `crates/ielts-db/tests/backup_full_roundtrip.rs` (M11 seed + schema_version 14 assertion)
