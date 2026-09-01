# Findings

## 2026-08-16 M8 基线评估

- M3 `memory_items`（migration 0014）：已有 `status` CHECK（candidate/pending_review/active/superseded/archived/...）、`source_class`、`canonical_key`、`supersedes_id` FK、`version`。M8 consolidation 不物理删除，复用 status='superseded' + 新增 `memory_relations` 保留 lineage。
- `promote_memory_candidate`（memory.rs:366）已含 supersede 路径（status='superseded'+version+1+supersedes_id）。M8 consolidation apply 复用此 + 新增 relation 行。
- M7 `dream_runs`/`dream_candidates`（migration 0018）：dream_candidates 已有 proposal_kind/disposition。M8 weekly dream 可复用 background_jobs（job_kind 扩展 'weekly_dream'）+ dream_runs（加 weekly 标记或新 run_kind）。
- M7 `background_jobs.enqueue_job` 当前 CHECK job_kind IN ('daily_journal','daily_dream') —— M8 需扩展支持 'weekly_dream'。
- M7 reverse-RPC：`journal.build_daily`/`dream.run_daily`。M8 新增 `dream.run_weekly`。
- 无 `memory_relations`/`memory_feedback`/`memory_capacity_state` 表 —— M8 从零建 migration 0019。
- TechSpar 参考（M8-01）：`F:\workspace\TechSpa\backend\memory.py:1590 _filter_active_observed_wps`/`:1609 _validate_consolidation_pattern`/`:1634 _apply_consolidation_pattern`/`:1674 _should_run_consolidation`/`:1705 consolidate_patterns`。R2 clean-room：保留四条 pattern gate 思想，但不复制 index-based support（M8-02 改用 stable ID）。
- TechSpar `memory.py:965 _decay_consolidated_patterns`（M8-07 improvement/regression propagation，R2，不按文本匹配 supports）、`:1012 _archive_stale_weak_points`（M8-08 stale archive，R2，per-kind policy 而非统一 180 天）、`:1492 apply_pattern_feedback`（M8-09 feedback，R2/R3，用 stable memory_id）。

## 2026-08-16 Slice 2 (Python) Findings

### 文件路径（NEW 或最小追加，干净室）
- `agent-runtime-python/src/ielts_agent/dream/weekly.py` (NEW) — M8-01 WeeklyDreamOrchestrator（cross-scope pattern discovery，stable ID 给 LLM，四 gate，fail-closed，no-LLM path）。
- `agent-runtime-python/src/ielts_agent/dream/types.py` (EDIT) — 追加 `PatternKind` StrEnum（5 值）+ `WeeklyPatternProposal` + `WeeklyDreamResult` + `PATTERN_KINDS`/`FORBIDDEN_PATTERN_KINDS` frozenset + capability 常量（`CAPABILITY_DREAM_RUN_WEEKLY`/`CAPABILITY_MEMORY_CANDIDATE_POOL` + 版本 "1"）+ `REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES` + `WEEKLY_DREAM_SCHEMA_VERSION=1` + `__all__` 导出。
- `agent-runtime-python/src/ielts_agent/dream/__init__.py` (EDIT) — 导出 weekly 模块符号。
- `agent-runtime-python/src/ielts_agent/__init__.py` (EDIT) — 追加导出 `WeeklyDreamInput`/`WeeklyDreamOrchestrator`。
- 测试：`agent-runtime-python/tests/test_weekly_dream.py` (NEW，38 测试)。

未编辑：`host_bridge.py`/`protocol.py`/`runtime.py`/`memory_*`/`retrieval/`/`coach/`/`daily_dream`/`journal_enrichment`/`capacity.py`。未碰任何 Rust 文件。

### Capability 方法名 / 版本（期望 Rust 侧暴露）
- `dream.run_weekly` v1 — 入参 `{window: string, patterns: WeeklyPatternProposal[]}`（每个 pattern: `{statement, supportingMemoryIds[], patternKind, confidenceProposal}`），出参 `{runId, validated, rejected, accepted}`。Rust validator 用 stable memory IDs 重验 supports（不信任 LLM 返回的 index），跑四 gate + M8-03 阈值 + M8-04 独立性 + M8-05 kind + M8-10 predicted-only gate，promotion gate 在 Rust。空 patterns 是 success（runId 仍返回 + cooldown 更新）。
- `memory.candidate_pool` v1 — 入参 `{window: string}`，出参 `{candidates: [{memoryId: mem-*, summary, scope?}][]}`。Rust 返回 bounded active + pending observed candidate memories（**非 predicted-only**，M8-10）。Python 不直接打开 canonical SQLite，只通过此 gateway 取 bounded pool。
- 复用既有 v1：`model.invoke`（weekly pattern discovery LLM）。

### Pattern 类型限制（M8-05）
允许（`PatternKind` StrEnum 5 值，`PATTERN_KINDS` frozenset 断言正好 5）：
- `cross_skill_strategy`
- `metacognitive_pattern`
- `behavior_pattern`
- `stable_learning_preference`
- `recurrent_language_pattern`

禁止（`FORBIDDEN_PATTERN_KINDS` frozenset，orchestrator 在提交前 casefold 校验 + `PatternKind` 构造本身拒绝未知值，Rust 再重验）：
- `medical` / `medical_diagnosis`
- `personality` / `personality_diagnosis`
- `intelligence` / `intelligence_claim`
- `mental_health` / `mental_health_inference`

### 关键决策
1. **M8-01 四 gate clean-room**：系统 prompt 编码四 gate（跨≥2 独立 scope、抽象层次高于原 observation、有新价值、可证伪）+ "prefer zero over wrong"。Python 侧 `_validate_one_pattern` 做 stable ID / min support / kind allow-list 预校验；Rust validator 用 canonical DB 重验（Python 不信任 LLM，Rust 不信任 Python）。
2. **M8-02 stable ID not index**：`_fetch_candidate_pool` 归一化每条 candidate 为 `{memoryId, summary, scope?}`，**不传 index**。`_build_user_payload` 直接把 pool 作为 `evidence` 传给 LLM。`WeeklyPatternProposal.supporting_memory_ids` field_validator 强制 `mem-*` 前缀 + 唯一。`_validate_one_pattern` 额外校验每个 supporting ID 必须存在于 pool（hallucinated ID → 整条 pattern 丢弃，不静默 trim）。测试 `test_llm_receives_stable_memory_ids_not_indexes` 断言 evidence 条目无 index/idx 字段。
3. **M8-03 保守阈值（Python 侧 floor）**：`MIN_CANDIDATE_POOL=6`（pool < 6 不调 LLM，直接提交空 patterns）、`MIN_SUPPORTING_MEMORY_IDS=3`（< 3 supports 丢弃）、`MAX_RAW_PATTERNS=10`（LLM 输出截断）。Rust 持有权威阈值并重验。
4. **M8-05 双层 kind 校验**：`PatternKind` StrEnum 类型层拒绝未知值（medical/personality 等无法构造）+ `FORBIDDEN_PATTERN_KINDS` 显式 deny-list（casefold 匹配）+ orchestrator `raw_kind not in PATTERN_KINDS` allow-list 三重。测试 `test_pattern_kind_medical_rejected` 断言 medical/personality pattern 产 0 patterns。
5. **M8-10 predicted 不晋升**：orchestrator 只 echo LLM 选择的 pool 内 ID，绝不自行添加 predicted memory。candidate pool 由 Rust host 负责排除 predicted-only。测试 `test_predicted_only_not_promoted` 断言提交的 patterns 不含 "predicted" ID。
6. **fail-closed 不抛 fatal**：`WeeklyDreamOrchestrator.run_weekly` 全程 try/except，host 失败 → `fallback_result`（`run_id=""` + `fallback_reason`）。capability 缺失 / candidate_pool 失败 / dream.run_weekly 失败 → fallback；LLM 失败 / 空 LLM 输出 / pool < min → 零 pattern success（仍提交空 batch 给 Rust 记录 run + 更新 cooldown）。
7. **no active-memory write bypass**：orchestrator 只产 `WeeklyPatternProposal` candidate 提交给 `dream.run_weekly`；从未调用 `memory.promote`/`memory.write`/`memory.upsert`。测试 `test_no_active_memory_write_bypass` 断言调用方法集合。
8. **no-LLM path**：`model.invoke` 不在 available capabilities / invoke 失败 / 空 content / JSON parse 失败 → 零 pattern success（提交空 batch），不抛 fatal。
9. **sqlite3 gate**：dream 包（含 weekly.py）不 import sqlite3，M3 gate pass。
10. **`_StrictModel` closed/frozen/camelCase/deny_unknown_fields**：`WeeklyPatternProposal`/`WeeklyDreamResult` 复用 dream/types.py 既有 `_StrictModel` 基类，与 M7 `DreamProposal`/`DailyDreamResult` 风格一致。`WeeklyDreamResult` fallback 互斥校验（fallback 不能带 runId/counts；非 fallback 必须有 runId）。

### 验证结果
- `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → 192 tests OK（154 既有 + 38 新增，无回归）。
- `python developer/tests/ci/check_m3_contracts.py` → pass（dream 包不触发 sqlite3 gate）。
- `python developer/tests/ci/run_static_suite.py` → 19/27 pass。Python 侧全过（Python cognitive protocol 192 OK / M3 contract boundary pass / M4 learner model contract pass）。8 项 Rust 失败均源自 `crates/ielts-domain/src/consolidation.rs:151` 的 `pub const fn code(self)` 编译错误（`destructor of RejectReason cannot be evaluated at compile-time`，因 `RejectReason` enum 含 `{ support_id: String }` 等带 String 字段的 variant 不能在 const fn 中 drop）—— 属 Rust Slice 1 (Agent A) WIP，未编辑任何 Rust 文件（`git status` 确认 `agent-runtime-python/` 全目录 untracked，`crates/ielts-domain/src/consolidation.rs` 属 Agent A 独占）。
