# Findings

## 2026-08-16 M7 基线评估

- 无现有 `background_jobs`/`daily_journals`/`dream_runs`/`dream_candidates` 表 —— M7 从零建 migration 0018。
- M3 `crates/ielts-db/src/memory.rs`：`persist_memory_candidate_batch`/`promote_memory_candidate`/`upsert_explicit_preference`/`memory_context_preview`/`forget_memory` 已落地 —— Daily Dream proposal 可复用 memory candidate 提交路径（dream 只产 candidate，不直接写 active memory，符合 M7 no-write-bypass）。
- M4 `learner.rs`：`learner_state_snapshot`/`skill_review_needs_snapshot` —— JournalFacts 的 skill_deltas 可从 learner state delta 派生。
- M2.1 `cognitive_read.rs`：`observation_snapshot`/`learning_events_by_ids` —— JournalFacts 的 observations 来源。
- M6 `0017_coach_learning_feedback.sql`：`coach_feedback`/`coach_reask_links` —— JournalFacts 的 coach feedback/re-ask count 来源。
- `crates/ielts-db/src/learning_tools.rs`：`compare_attempts_for_asset`/`get_question_history` 已有 attempt 聚合 —— JournalFacts 的 attempts count 可复用。
- `src-tauri/src/cognitive_runtime.rs` reverse-RPC 当前 match：tool.invoke/model.invoke/retrieval.*/context.materialize/model.embed.batch/learning.*/memory.search_active。M7 新增 `journal.build_daily`/`dream.run_daily` 分支。
- `crates/ielts-db/migrations/` 当前到 0017；M7 用 0018。
- TechSpar 参考（M7-01/05）：`F:\workspace\TechSpa\backend\runtime.py`（N：不复制 process-local `_task_status` + FastAPI BackgroundTasks）、`storage/sessions.py:122-160`（R1：stale recovery 思想）、`memory.py:288 _save_insight`（R3：Markdown append 只作 export view，canonical 放 SQLite）。

## 2026-08-16 Slice 2 (Python) Findings

### 文件路径（全部 NEW，干净室）
- `agent-runtime-python/src/ielts_agent/dream/types.py` — pydantic 严格契约（`_StrictModel` closed/frozen/strict，camelCase alias，`extra="forbid"`）。
- `agent-runtime-python/src/ielts_agent/dream/capacity.py` — M7-08 capacity 常量 + bounded 截断。
- `agent-runtime-python/src/ielts_agent/dream/daily_dream.py` — M7-06 orchestrator（fail-closed，today-only scope）。
- `agent-runtime-python/src/ielts_agent/dream/journal_enrichment.py` — M7-04 LLM enrichment（facts immutable，private redaction，no-LLM path）。
- `agent-runtime-python/src/ielts_agent/dream/__init__.py` — 包导出。
- `agent-runtime-python/src/ielts_agent/__init__.py` — 最小追加导出 `DailyDreamOrchestrator`/`DreamRunInput`/`JournalEnricher`。
- 测试：`agent-runtime-python/tests/test_dream_types.py`、`test_daily_dream.py`、`test_journal_enrichment.py`（共 59 个新测试）。

未编辑：`host_bridge.py`/`protocol.py`/`runtime.py`/`memory_*`/`retrieval/`/`coach/`。未碰任何 Rust 文件。

### Capability 方法名 / 版本（期望 Rust 侧暴露）
- `journal.build_daily` v1 — 入参 `{day}`，出参 `JournalFacts`（today-scoped：今日 observations + 今日 candidates + active memory relevant subset + explicit corrections + learner delta；不扫全部历史）。Python 通过 `host_bridge.invoke("journal.build_daily", {"day": day})` 取 bounded facts。
- `dream.run_daily` v1 — 入参 `{day, proposals[]}`，出参 `{runId, accepted, rejected, failed}`。Python 只产 candidate proposals 提交，Rust 是 job authority + 唯一 active-memory writer。
- 复用既有 v1：`model.invoke`（enrichment LLM）。`memory.search_active`/`learning.evidence_by_ids`/`learning.learner_skill_state` 保留为 v1 常量备用（v1 orchestrator 当前不直接调，留作 M8 扩展点）。

### Capacity 常量（M7-08）
- `MAX_INPUT_OBSERVATIONS = 200`
- `MAX_ACTIVE_CANDIDATES = 50`
- `MAX_OUTPUT_CANDIDATES = 10`
- `MAX_TOKEN_BUDGET = 4000`
- `MAX_LLM_RETRIES = 1`
- `MIN_TOKEN_BUDGET = 256`（enrichment prompt 头空间下限）
- `DreamCapacity` pydantic 重校验范围（ge/le），并校验 `max_output_candidates ≤ max_active_candidates`。

### 关键决策
1. **fail-closed 不抛 fatal**：`DailyDreamOrchestrator.run_daily` / `JournalEnricher.enrich` 全程 try/except，host 失败 → 返回 `fallback_result`（`run_id=""` + `fallback_reason`），journal deterministic 版本仍由 Rust 完成（M7-08）。
2. **today-only scope（M7-06）**：`journal.build_daily` 入参仅 `{day}`，无 cursor/since/limit/allHistory。Python 不扫全部历史，不直连 canonical SQLite。
3. **no active-memory write bypass**：Python 只产 `DreamProposal`（candidate）提交给 `dream.run_daily`；从未调用 `memory.promote`/`memory.write`/`memory.upsert`。测试 `test_no_active_memory_write_bypass` 断言调用方法集合。
4. **M7-04 facts immutable**：`JournalFacts.facts_json()` 返回 canonical sorted JSON；`JournalEnricher` 在 enrichment 前后断言 `facts_json` 逐字节不变（`assert` + 测试 `test_facts_json_unchanged_after_enrichment`）。LLM 只产 `title`/`summary`/`openHypotheses`，不改数字事实。
5. **private memory redaction**：`_redact_private` 对 `sensitivity="private"` 的 candidate 把 `statement`/`proposedStatement` 替换为 `[redacted-private]`，只保留稳定 ID + 非敏感 metadata；LLM prompt 不含私有正文（测试 `test_private_memory_redaction` 断言 `"secret learner detail" not in candidates`）。
6. **no-LLM path（M7-03/08）**：host `model.invoke` unavailable / empty content → deterministic enrichment（`title = "Daily journal — {journal_date}"`，空 summary，无 hypotheses），不抛 fatal。
7. **proposal 6 种 kind（M7-07）**：`DreamProposalKind` StrEnum 固定 `REINFORCE`/`REFINE`/`IMPROVE`/`REGRESS`/`CONTRADICT`/`NOOP`；`DREAM_PROPOSAL_KINDS` frozenset 断言正好 6 值。跨领域高阶 pattern 留给 M8。
8. **deterministic REFINE statement**：no-LLM 路径下 REFINE 需要非空 `proposedStatement`，Python 用 bounded 结构化语句（仅引用 `target_id` + `change_kind` + `evidence obs-id`，不发明数字事实/profile）。
9. **sqlite3 gate**：dream 包不 import sqlite3，M3 gate 通过（`check_m3_contracts.py` pass）。
10. **JournalFacts 不放 LLM 字段**：enrichment 是独立 overlay（`JournalEnrichment` model），通过 `facts_ref`（source_hash）链接 facts，不在 facts 对象内嵌可变 LLM 文本。

### 验证结果
- `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → 154 tests OK（95 既有 + 59 新增，无回归）。
- `python developer/tests/ci/check_m3_contracts.py` → pass（dream 包不触发 sqlite3 gate）。
- `python developer/tests/ci/run_static_suite.py` → 26/27 pass。唯一 fail = `Rust data-truth regressions`（`backup_full_roundtrip.rs` legacy v2/v4/v5/v6/v8 snapshot 测试因 Slice 1 migration 0018 新增 `daily_journals` 表而报 "backup contains unsupported table: daily_journals"）—— 属 Rust Slice 1 WIP 集成问题，与本 Slice 2 Python 交付无关（未编辑任何 Rust 文件）。

## 2026-08-16 Slice 1 (Rust) Findings

### 文件路径（全部 NEW 或 EDIT 最小追加）
- `crates/ielts-db/migrations/0018_daily_journal_jobs.sql` (NEW) — background_jobs / daily_journals / daily_journal_sources / dream_runs / dream_candidates 五表。
- `crates/ielts-db/src/background_jobs.rs` (NEW) — M7-01 SQLite Job Worker（claim/heartbeat/lease_recover/startup_recovery/finish_job/fail_job/enqueue_job dedupe）。
- `crates/ielts-db/src/journal.rs` (NEW) — M7-03 deterministic build_daily_facts（§23.14）+ insert_journal versioning/supersede + load_latest_journal + insert_journal_source。
- `crates/ielts-db/src/dream.rs` (NEW) — M7-07 dream run/candidate persistence（insert_dream_run/insert_dream_candidate/finish_dream_run/fail_dream_run/load_*）。
- `crates/ielts-domain/src/journal.rs` (NEW) — JournalFacts / DailyJournal / DailyJournalStatus / WritingEvalSummary / SkillDelta / MemoryChangeSummary / DailyJournalQuery。
- `crates/ielts-domain/src/dream.rs` (NEW) — DreamProposalKind (6 enum) / DreamCandidateDisposition / DreamRunStatus / DreamProposal / DreamCandidate / DreamRun / DailyDreamResult / DailyDreamQuery + capacity 常量。
- `crates/ielts-application/src/journal.rs` (NEW) — JournalService + JournalStore trait。
- `crates/ielts-application/src/dream.rs` (NEW) — DreamService + DreamStore trait（record_proposals bounded / insert_dream_run / finish_dream_run / fail_run / load_result）。
- `crates/ielts-db/tests/background_jobs.rs` (NEW) — 10 tests。
- `crates/ielts-db/tests/journal.rs` (NEW) — 10 tests。
- `crates/ielts-application/tests/journal_dream.rs` (NEW) — 6 tests。
- `crates/ielts-db/src/lib.rs` (EDIT) — pub mod background_jobs / dream / journal + pub use（只追加，不重排）。
- `crates/ielts-domain/src/lib.rs` (EDIT) — pub mod dream / journal + pub use（只追加，不重排）。
- `crates/ielts-application/src/lib.rs` (EDIT) — pub mod dream / journal + pub use（只追加，不重排）。
- `crates/ielts-db/src/migrate/mod.rs` (EDIT) — 注册 version 18。
- `crates/ielts-db/src/backup/mod.rs` (EDIT) — BACKUP_SCHEMA_VERSION 10→11，CANONICAL_TABLES 追加 5 表，新增 V10_CANONICAL_TABLES（v9/v10 frozen），snapshot_tables_for_schema `>=11→CANONICAL`/`==10|9→V10`，validate_logical_references 追加 daily_journals/dream_runs/dream_candidates FK 校验。
- `crates/ielts-db/tests/{phase3_migration,learning_events,learner_model,backup_full_roundtrip}.rs` (EDIT) — version 17→18 / schema_version 10→11 / M7 表 seed + 断言。
- `src-tauri/Cargo.toml` (EDIT) — feature `daily-dream-v1 = ["context-compiler-v1"]` 加入 default。
- `src-tauri/src/cognitive_runtime.rs` (EDIT) — PROVIDED_HOST_CAPABILITIES 追加 `journal.build_daily` v1 / `dream.run_daily` v1；match 新增 daily-dream-v1 分支；invoke_journal_dream handler（256 KiB 响应上限）。
- `src-tauri/src/app/application_store.rs` (EDIT) — JournalStore + DreamStore impl + journal_error/dream_error 映射。

### Capability 方法名/版本（供 Python 对齐）
- `journal.build_daily` v1 — 入参 `{query: DailyJournalQuery{userId, journalDate}}`，出参 `JournalFacts`（attemptsCount / writingEvalSummary / skillDeltas / memoryChanges / coachFeedbackCount / coachReaskCount / timeSpentMs / sourceHash / journalDate）。deterministic，不调 LLM。
- `dream.run_daily` v1 — 入参 `{query: DailyDreamQuery{userId, journalId}, proposals: DreamProposal[], inputHash?}`，出参 `DailyDreamResult{run: DreamRun, candidates: DreamCandidate[]}`。Rust 权威持久化 + capacity bounded；dream 只产 pending candidate，不写 active memory（promotion 仍走 M3 `promote_memory_candidate`）。

### Capacity 常量值（M7-08，crates/ielts-domain/src/dream.rs）
- `MAX_INPUT_OBSERVATIONS = 64`
- `MAX_ACTIVE_CANDIDATES = 16`
- `MAX_OUTPUT_CANDIDATES = 6`（DreamService.record_proposals 截断到此值）
- `MAX_TOKEN_BUDGET = 4000`
- `MAX_LLM_RETRIES = 2`

### 关键决策
1. **Job worker 不复制 TechSpar process-local `_task_status`**：单机单 worker，原子 claim 用 `BEGIN IMMEDIATE` + `UPDATE ... WHERE id=(SELECT ... LIMIT 1) RETURNING`（§23.15）。lease_recover 把 heartbeat 过期的 running 回 interrupted；startup_recovery 把 interrupted 且 attempts<max_attempts 回 queued，耗尽则留 interrupted（terminal）。fail_job 在 attempts<max_attempts 时 reschedule（scheduled_at = now + delay），否则标 failed。
2. **JournalFacts 是 deterministic derived projection（§23.14）**：从 attempts/writing_evaluations/learner_skill_observations/memory_mutations/coach_feedback/coach_reask 聚合，不复制正文。source_hash 是 SHA256 of canonical sorted-key stream，同输入稳定，输入变则变。private memory content 永不进 facts（只 count）。
3. **daily_journals row = canonical derived projection；rendered_markdown = export view（M7-05）**：同一天重算 → 新 version + 旧 status='superseded'/superseded_by 指向新行。不 append Markdown。
4. **Dream fail-closed**：dream 标 failed 不阻塞 journal（journal 先 deterministic 完成）。dream 只产 pending candidate（dream_candidates.disposition='pending'），promotion 仍走 M3 promote_memory_candidate —— no active-memory write bypass。
5. **Backup**：BACKUP_SCHEMA_VERSION 10→11；v9/v10 包用 V10_CANONICAL_TABLES（无 M7 表，frozen），v11+ 用 CANONICAL_TABLES（含 M7 表）。restore_snapshot 已支持 skip 缺失表（旧包不带 M7 表时跳过）。
6. **Feature gate**：`daily-dream-v1 = ["context-compiler-v1"]`（M7 依赖 M3 memory + M4 learner + M5 context），加入 src-tauri default。
7. **proposal_kind 6 种 enum**（M7-07）：REINFORCE/REFINE/IMPROVE/REGRESS/CONTRADICT/NOOP，DB CHECK 约束 + Rust enum 双重校验。新跨领域高阶 pattern 留 M8 Weekly Dream。
8. **dedupe_key 幂等**：enqueue_job 同 (job_kind, user_id, dedupe_key) queued 不重复入队；claim 后同 key 可再入队。
