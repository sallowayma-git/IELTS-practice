# Round 3 整改发现

## Source

- 审计报告：`developer/docs/PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md`
- 当前审计基准：报告记录的 tip `7928d75c`；实际工作树需再次核对。

## Initial findings

- 报告统计 P0 28、P1 55+；路线图按安全、数据结构、接线、文档换血排序，但本任务要求从末项倒序。
- v1.3 文档是 11248 行 Post-M2 快照；现有 ADR、M3-M12 gate report 和 `.planning/` 才可能包含较新的实现证据。
- 当前工作树存在未跟踪 `.zcode/` 与审计报告，必须保留。

## Verified coordinates

- v1.3 文档头部 currently claims `Post-M2` and lists baseline `7a99ea4`; tail still labels M2.1 as `[NEXT HARDENING GATE]` and ends with the M2→M12 planned sequence.
- Current HEAD is `7928d75c`; migrations `0012` through `0022` exist; `developer/docs/INDEX.md` is missing.
- `developer/tests/ci/run_static_suite.py` has no document drift check; its `checks` list is the insertion point for a new `check_doc_drift.py` command.
- `src-tauri/src/lib.rs` is the concrete Tauri command registry (`generate_handler!` around lines 79-318); docs should validate only command names that are explicitly backticked in current ADR/gate surfaces.
- M6 gate report still says “全部完成” while its limitations state Rust baseline remains the only user-visible Coach; M10 says candidate eval is a stub; M11 says prompt overlay is future; M12 says M6 Go/No-Go passed. These require post-audit addenda before the documents can be used as status evidence.

## Documentation governance completed

- v1.3 now carries a 2026-08-31 frozen-history banner; `developer/docs/INDEX.md` defines current entry points and the precedence `post-audit addendum > Accepted ADR > Stage Gate > frozen plan` while code/tests remain the implementation fact source.
- `developer/tests/ci/check_doc_drift.py` checks local links, migration filenames and context-qualified backticked Tauri command names in current ADR/Stage Gate/INDEX documents. The frozen task book is intentionally excluded.
- M3-M12 reports now use “阶段契约验证完成”; M6 is explicitly product No-Go; M12 no longer claims the historical stage table is an overall product Go.
- Verification: `check_doc_drift.py` passed for 23 current documents; static suite passed 28/28; packaged practice flow passed 16/16.

## Code remediation queue

- Route 10: `promote_strategy_candidate` currently flips `strategy_candidate_batches.disposition` on a caller boolean and has no Rust-owned eval evidence relation. A fix needs a durable batch-scoped eval verdict rather than trusting a new client boolean.
- Route 9: `background_jobs.startup_recovery` only requeues existing interrupted jobs; it does not discover missing journal/dream windows. Existing enqueue dedupe keys and `daily_journal`/`daily_dream` CHECK constraints must be preserved.

## Route 10 verification (2026-08-31)

- `crates/ielts-db/src/teaching_strategy.rs:781-800` only checks that a batch exists and maps `promote: bool` directly to `promoted`/`rejected`; it never reads an eval verdict. A rejected batch can also be promoted again.
- `crates/ielts-db/migrations/0020_teaching_strategy_evolution.sql:177-187` has no eval relation for `strategy_candidate_batches`; `crates/ielts-domain/src/teaching_strategy.rs:414-418` exposes only `batch_id` and the caller boolean.
- M11's persisted eval rows are keyed to `candidate_promotions` (`cp-*`), while M10 batches are `tscb-*`; they are separate contracts and must not be joined by ID or by stuffing a foreign key into `batch_json`.
- Remediation decision: add an M10-owned `strategy_candidate_evaluations` table with a restrictive `batch_id` FK. The offline evaluator records a verdict and moves the batch to `eval`; promotion reads the latest persisted verdict inside one Rust transaction and accepts only `passed = 1`. Rejecting remains available from `pending`/`eval`; terminal states cannot reverse.
- Existing test `crates/ielts-db/tests/teaching_strategy.rs:405-427` intentionally promoted a no-eval batch, so it must be changed into a gate regression test.

## Route 9 verification (2026-08-31)

- `crates/ielts-db/src/background_jobs.rs:217-231` only calls `lease_recover` and updates rows already marked `interrupted`; no code enumerates missing dates or enqueues a job for an absent daily window.
- The recovery implementation must preserve the existing `enqueue_job` dedupe contract and the `daily_journal`/`daily_dream` job-kind CHECK constraint. The route-9 patch is queued after the M10 gate patch.

## Route 9 remediation (2026-08-31)

- `background_jobs::startup_recovery_with_catch_up` now derives `(user_id, day)` windows from the canonical fact sources: attempts, writing evaluations, learning events, learner observations/skill observations, memory mutations, coach feedback, and coach re-ask links.
- Missing journal/dream windows are inserted through the existing `enqueue_job` path with the established dedupe keys and priorities. Existing journal rows, latest-journal dream runs, and active queued/running/interrupted jobs are skipped; future activity dates are excluded.
- The legacy `startup_recovery` return value remains the interrupted-job requeue count; Tauri startup uses the report-shaped API for catch-up telemetry. No business logic or OS scheduler was added.

## Route 8 recheck (2026-08-31)

- `agent-runtime-python/src/ielts_agent/runtime.py:75-93` still dispatches only `runtime.*`, `memory.*`, `dream.daily`, and `planner.study_plan`; Rust advertises retrieval/context/eval/coach/weekly capabilities that have no Python production dispatch branch.
- `agent-runtime-python/src/ielts_agent/retrieval/planner.py:77` creates `rr-*` retrieval IDs, while `0016_context_retrieval_trace.sql` uses `agent_context_snapshots.run_id` as an `agent_runs(id)` foreign key; `ContextMaterializerService` passes the retrieval ID into that field.
- `crates/ielts-db/src/consolidation.rs:224-228` still binds `memory_capacity_state.memory_kind` values to `memory_items.memory_type`, so archive remains a zero-row operation.
- `migrations/0012_learning_event_ledger.sql:10-23` still cascades deletion from attempts into the learning ledger, contrary to the immutable-fact contract.
- `crates/ielts-db/src/dream.rs:81-115` inserts `dream_candidates` as pending, but the repository has no update/promotion path for that table; the existing memory promotion path updates only `memory_candidates`.
- `crates/ielts-application/src/ports.rs:29-34` and `crates/ielts-application/src/coach.rs:37,84-95` still have no model output/input ceiling and send all 100 loaded history messages.
- `src-tauri/src/cognitive_runtime.rs:77-87,1098-1105,1681-1692` still advertises and dispatches prompt promote/rollback and approval mutation from the sidecar path without the documented equivalent approval gate.
- `apps/writing-vue/src/api/memory-repository.js:76-79` and `src-tauri/src/commands/journal.rs:454-466` still allow webview-supplied weekly patterns and do not create a corresponding persisted dream run.

## M10 authority recheck (2026-08-31)

- `RecordStrategyCandidateEvaluationCommand` currently exposes `passed` and caller-provided `metrics` at `crates/ielts-domain/src/teaching_strategy.rs:424-429`.
- `crates/ielts-db/src/teaching_strategy.rs:808-818` persists those values unchanged. The promotion transaction reads the stored result, but the evaluation result itself is not Rust-produced evidence. The next M10 patch must make evaluation input batch-only and compute the verdict/metrics inside the Rust DB authority.
