# Findings

## 2026-08-16 M11 基线评估

- 无现有 `prompt_templates`/`prompt_versions`/`skill_definitions`/`skill_versions`/`eval_cases`/`eval_runs`/`eval_results`/`candidate_promotions`/`shadow_runs` 表 —— M11 从零建 migration 0021。
- 现有 prompts 是硬编码 Rust 常量：`AGENT_SYSTEM_PROMPT`/`ATTEMPT_REVIEW_SYSTEM_PROMPT`（`src-tauri/src/commands/agent.rs`）+ `SOUL_POLICY`（`crates/ielts-application/src/context_soul_policy.txt` include_str!）。M11 引入 versioned prompt registry 但不破坏现有硬编码路径（registry 是 overlay；现有 const 保持 fallback）。
- M5 retrieval eval harness（`developer/tests/retrieval_eval/run_retrieval_eval.py`）是 eval 基础设施先例：frozen query set + golden corpus + metrics + report。M11-04 eval dataset 复用此模式（8 类 case）。
- M8 consolidation validator + M10 candidate strategy gate 是 candidate promotion 模式先例（propose→eval→promote + rollback）。M11-05 lifecycle（propose→offline eval→holdout→shadow→approval→canary→promote→rollback）复用。
- M5 `llm_invocations` 表（0016）+ M7 `background_jobs` 可复用于 eval_runs/shadow_runs。
- migration 当前到 0020；M11 用 0021。
- TechSpar 参考：M11 是「安全落地 Hermes/自进化思想」（§9154-9165），无直接 TechSpar 代码参考，clean-room。核心：系统从 traces/failures/feedback 发现改进候选 → 生成 candidate → 评测 → 人工门禁批准 → 发布 → 可回滚；**不是生产 Agent 自己修改生产代码**。

## 2026-08-16 Slice 2 (Python) Findings

### 交付文件（全部 NEW，独占）

- `agent-runtime-python/src/ielts_agent/eval/__init__.py` — 包导出（types/cases/graders/runner 全量 re-export）。
- `agent-runtime-python/src/ielts_agent/eval/types.py` — pydantic contracts：`EvalCase`/`EvalRunResult`/`CandidateProposal`/`TraceGrade` + `EvalCaseKind`(8 enum) + `CandidateTargetKind`(prompt|skill) + `EVAL_CASE_KINDS` frozenset + 7 host capability pins。
- `agent-runtime-python/src/ielts_agent/eval/cases.py` — M11-04 frozen dataset：10 cases（8 类全覆盖，每类 ≥1），含 2 holdout cases。`frozen_eval_cases()`/`non_holdout_cases()`/`holdout_cases()`/`case_kinds_present()`。
- `agent-runtime-python/src/ielts_agent/eval/graders.py` — M11-08 trace graders：7 deterministic graders（`grade_final_answer`/`grade_context_used`/`grade_irrelevant_tool`/`grade_memory_citation`/`grade_counter_evidence`/`grade_oversized_output`/`grade_cost_latency`）+ 复合 `grade_trace()` + optional LLM grader（`model.invoke`，fail-closed→`llm_fallback`）。
- `agent-runtime-python/src/ielts_agent/eval/runner.py` — M11-05 candidate lifecycle orchestrator：`EvalOrchestrator`（propose→eval→shadow→promote→rollback）+ `EvalRunInput`(frozen) + `fallback_result()` + `FORBIDDEN_AGENT_TOOLS` 黑名单。
- `agent-runtime-python/tests/test_eval_types.py` — 24 tests（pydantic 校验/case_kind 8 enum/holdout 标记/camelCase/deny_unknown_fields/capability pins）。
- `agent-runtime-python/tests/test_graders.py` — 32 tests（deterministic graders 全维度断言，no-LLM path；LLM path fail-closed + host score）。
- `agent-runtime-python/tests/test_runner.py` — 33 tests（candidate cannot skip eval / holdout isolation / shadow no side effect / rollback exact / version pinned / data isolation / fail-closed / forbidden tools / full lifecycle / exploding bridge never raises）。

### Capability 方法名/版本（期望 Rust 侧暴露）

| Capability method | Version | Python 调用点 |
|---|---|---|
| `prompt.list_versions` | `1` | 列出 prompt module 版本 |
| `prompt.get_active` | `1` | `EvalOrchestrator.get_active_versions()` |
| `prompt.propose_candidate` | `1` | `EvalOrchestrator.propose_candidate()` |
| `prompt.promote_candidate` | `1` | `EvalOrchestrator.promote_candidate()` |
| `prompt.rollback` | `1` | `EvalOrchestrator.rollback_candidate()` |
| `eval.run_case` | `1` | `EvalOrchestrator.run_eval()` / `run_shadow()` |
| `skill.list_versions` | `1` | 列出 skill 版本 |

全部 pinned `"1"`（`REQUIRED_EVAL_HOST_CAPABILITIES`）。capability mismatch → `_Fallback`（non-fatal）。

### 8 类 case（M11-04）

1. `memory_extraction_goldens` — 提取器须命中 golden，不捏造（m11-mex-golden-01 + holdout m11-mex-holdout-01）
2. `false_merge_split` — resolver 须拒绝错误合并/拆分（m11-fms-01）
3. `consolidation_zero` — 无可合并时输出 0 candidate，不捏造（m11-cz-01）
4. `context_selection` — context selector 命中 golden chunk，排除 stale（m11-cs-01）
5. `coach_personalization` — 尊重 explicit preference，不静默切换（m11-cp-01 + holdout m11-cp-holdout-01）
6. `prompt_injection` — 拒绝注入，不覆盖 Soul（m11-pi-01）
7. `repeated_familiarity` — 重复曝光不膨胀为 mastery（m11-rf-01）
8. `strategy_outcome` — delayed outcome 正确归因（novel asset），不惩罚 out-of-window（m11-so-01）

### Graders（M11-08，deterministic no-LLM path）

- `grade_final_answer` — exact match（bool/int 不可混同，`_deep_equal` 防止 `True==1` 陷阱）；invariant-keyed cases 返回 1.0（defer to dedicated graders）。
- `grade_context_used` — golden context ids 命中率（proportional）。
- `grade_irrelevant_tool` — 非 allow-list 工具调用 → 0.0。
- `grade_memory_citation` — forbidden citation → 0.0；unsupported citation → 0.0；`mustNotFabricate` 接受 list 或 bool invariant。
- `grade_counter_evidence` — required 但遗漏 → 0.0。
- `grade_oversized_output` — `outputTokens > budget` → 0.0；missing token count 不 fail。
- `grade_cost_latency` — `latencyMs > budget` → 0.0；missing latency 不 fail。
- `grade_trace` — 复合，`passed` 要求所有 7 维 ≥ 0.5（PASS_BAR）。

### 关键决策

1. **Fail-closed 铁律**：host 失败（`eval.run_case`）→ `_fallback_run_result()`（`failed_count ≥ 1`，`fallback=True`），**永不记录 eval evidence** → `promote_candidate` 拒绝。host 失败绝不能意外 promote candidate。
2. **Candidate cannot skip eval**：`promote_candidate` 在调用 `prompt.promote_candidate` 之前检查 `_eval_evidence[target_version_id] == eval_run_id`；mismatch → 拒绝（不调用 host）。Rust 是最终 release gate，但 Python 拒绝在无 evidence 时发出调用。
3. **Holdout isolation**：`prompt_generation_cases()` 只返回 non-holdout；`gated_eval_cases()` 含 holdout。holdout case 永不进入 prompt generation context（partition on `holdout` flag）。
4. **Shadow no side effect**：`run_shadow()` 设 `shadow=True` → `noUserVisibleSideEffect=True` 传给 host；shadow run 永不 reach user。
5. **Rollback exact**：`rollback_candidate()` 传 `baseVersionId`；host 须返回 `restoredVersionId == baseVersionId`，否则 Python 视为 rollback 失败。
6. **Version pinned in trace**：`EvalRunResult.prompt_version_id`/`skill_version_id` + host `eval.run_case` params 携带 `promptVersionId`/`skillVersionId`。
7. **M11-06 黑名单**：`FORBIDDEN_AGENT_TOOLS = {update_system_prompt, edit_soul, install_unreviewed_skill}`；Python 永不调用，`is_forbidden_agent_tool()` 审计 hook。
8. **不碰 sqlite3**（M3 gate）：eval 包无 `import sqlite3`；全部访问经 host gateway。
9. **干净室**：未编辑 host_bridge/protocol/runtime/memory_*/retrieval/coach/dream；未碰 Rust。

### 验证结果

- `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → **346 tests OK**（257 既有 + 89 新增，0 回归）。
- `python developer/tests/ci/check_m3_contracts.py` → **M3 contract gate passed**。
- `python developer/tests/ci/run_static_suite.py` → Python 侧全过；Rust 侧失败均来自 `crates/ielts-db/src/prompt_skill.rs:19` 编译错误（`EvalCaseGrading` not found，Rust Slice 1 in-flight），**非本 slice 范围**。该 Rust 编译错误导致依赖 `ielts-db` 的 4 个 Rust 测试二进制无法链接，属 Rust Slice 1 待修。

## 2026-08-16 Slice 1 (Rust) Findings

### Migration 0021 (M11-02/03/04/05/08)
- Created `crates/ielts-db/migrations/0021_prompt_skill_evolution.sql` with 9 tables: `prompt_templates`, `prompt_versions`, `skill_definitions`, `skill_versions`, `eval_cases`, `eval_runs`, `eval_results`, `candidate_promotions`, `shadow_runs`.
- CHECK constraints enforce the 10 prompt-module enum (M11-02), 4 skill-name enum (M11-03), 8 eval-case-kind enum (M11-04), 7 version-status lifecycle (M11-05), 4 eval-run-status, 8 candidate-status lifecycle (M11-05), and 2 candidate-target-kind.
- `UNIQUE(template_id, version)` / `UNIQUE(skill_definition_id, version)` enforce per-parent version monotonicity.
- `shadow_runs.no_user_visible_side_effect` has `CHECK = 1` at the storage layer; Rust additionally fails closed.
- Registered version 21 in `migrate/mod.rs`.
- Backup: bumped `BACKUP_SCHEMA_VERSION` 13→14, added 9 M11 tables to `CANONICAL_TABLES` (parent-before-child order), froze `V13_CANONICAL_TABLES` (without M11) for legacy v13 package compatibility, added `>= 14` / `== 13` branches in `snapshot_tables_for_schema`.

### M11-01 Soul is stable Policy Layer
- `PromptModule::is_policy_layer()` returns true only for `CoreSoul`. The domain doc-comment states Soul is never rewritten by Dream.

### M11-05 candidate lifecycle + release gate
- `crates/ielts-db/src/prompt_skill.rs`: full persistence layer. `propose_candidate` (status=proposed) → `run_eval` (advances to eval_passed only when all cases pass) → `approve_candidate` (requires eval_passed) → `promote_candidate` (requires approved; sets version active, prior active→rollback) → `rollback_version` (exact: prior version reinstated as active).
- `only_one_active_version_per_template`: promote marks the previously active version rollback before activating the target.
- `run_eval` records `eval_runs` + `eval_results`; `candidate_advanced` is true only when all gradings pass.
- `crates/ielts-application/src/prompt_skill.rs`: `PromptSkillService` + `PromptSkillStore` trait (thin delegation to the db authority).
- `src-tauri/src/app/application_store.rs`: `PromptSkillStore for ApplicationStore` impl (feature-gated `daily-dream-v1`).

### M11-06 deny-list
- `ielts_domain::DENIED_SELF_MODIFYING_TOOLS = ["update_system_prompt", "edit_soul", "install_unreviewed_skill"]` + `is_denied_self_modifying_tool(name)`.
- `cognitive_runtime.rs invoke_candidate_input_tool`: explicit deny-list guard before the allow-list check. Returns `RuntimeHostError::InvalidResponse("online self-modifying tool is denied by Rust policy (M11-06): {name}")`.

### M11-08 version pinning
- `PromptVersionPin` (module_name, version_id, version, content_hash) and `SkillVersionPin` (skill_name, version_id, version) domain DTOs. These are the trace audit links.

### reverse-RPC + Tauri
- `cognitive_runtime.rs`: reverse-RPC methods `prompt.list_versions`/`prompt.get_active`/`prompt.propose_candidate`/`prompt.promote_candidate`/`prompt.rollback`/`eval.run_case`/`skill.list_versions` dispatched via `invoke_prompt_skill` (feature-gated `daily-dream-v1`).
- `PROVIDED_HOST_CAPABILITIES` includes all 7 M11 methods (version "1").
- `src-tauri/src/commands/prompt_skill.rs`: 8 Tauri commands (`prompt_list_versions`, `prompt_get_active`, `prompt_propose_candidate`, `eval_run_case`, `prompt_approve_candidate`, `prompt_promote_candidate`, `prompt_rollback`, `skill_list_versions`), registered in `lib.rs` invoke_handler.

### Capability method names + versions (for Python alignment)
| Method | Version | Feature gate |
|---|---|---|
| `prompt.list_versions` | 1 | `daily-dream-v1` |
| `prompt.get_active` | 1 | `daily-dream-v1` |
| `prompt.propose_candidate` | 1 | `daily-dream-v1` |
| `prompt.promote_candidate` | 1 | `daily-dream-v1` |
| `prompt.rollback` | 1 | `daily-dream-v1` |
| `eval.run_case` | 1 | `daily-dream-v1` |
| `skill.list_versions` | 1 | `daily-dream-v1` |

### Tests
- `crates/ielts-db/tests/prompt_skill.rs`: 10 tests (candidate_cannot_skip_eval, candidate_cannot_skip_approval, promote_advances_version_to_active, only_one_active_version_per_template, rollback_is_exact, holdout_never_enters_prompt_generation_context, shadow_run_rejects_user_visible_side_effect, eval_failure_leaves_candidate_at_proposed, list_prompt_versions_orders_by_version_desc, denied_self_modifying_tools_are_listed).
- `crates/ielts-application/tests/prompt_skill.rs`: 9 tests (service delegation + version pin DTOs + deny-list + holdout isolation).
- Backup `seed_complete_user_state` extended with M11 fixture rows (9 tables).
