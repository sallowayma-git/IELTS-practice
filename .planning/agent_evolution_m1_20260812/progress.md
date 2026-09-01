# Progress: Agent Evolution M1

## 2026-08-12

- User explicitly confirmed continuation after M0 and requested ongoing execution.
- Recovered the prior session with `planning-with-files` and read the completed M0 plan/findings/progress.
- Verified M0 commit/tag handoff and preserved the unrelated user-owned deletions.
- Corrected the stale M0 goal state to complete and created an independent active M1 goal.
- Created this scoped M1 execution record before reading or changing product code.
- Used three independent read-only scouts to locate the exact M1 specification, database transaction/backup boundaries, and business producer/test surfaces; no scout modified files.
- Personally read the authoritative DDL, event taxonomy/payload rules, transaction rules, full M1 stage, backfill guidance, and idempotency pseudocode.
- Confirmed the main implementation hazards: M1/long-term taxonomy naming mismatch, non-atomic Coach writes, non-rebuildable aggregate-only Vocab reviews, missing Coach feedback/re-ask truth, and versioned backup allowlist compatibility.
- Completed P0/P1 and froze the M1 stage registry, payload minimization, deterministic key, transaction ownership, rebuild, and rollback boundaries.
- Added migration `0012_learning_event_ledger.sql`, the 11-type domain registry/envelope, DB append/query/rebuild/verify primitives, and atomic Reading completion/question projections in the shared single/suite/endless submit core.
- Added compact read-tool DTOs and DB queries for attempt detail, repeated-attempt comparison, question history, and filtered event search. These intentionally omit raw answers, essays, prompts, question text, and annotation notes.
- Raised the lossless backup format from v7 to v8, added `learning_events` to the current canonical snapshot, and froze the exact v7 table list.
- Verification so far: workspace `cargo check --locked` passed twice; focused ledger/migration tests passed; all 10 full backup roundtrip/legacy/security tests passed after versioned fixture reconciliation.
- Remaining before P2/P3 can close: improve rebuild/verify difference semantics, add generation rollback flag, add real Reading atomic/idempotent/cascade tests, implement the read-only AttemptReview executor/run kind and Tauri commands, then wire and verify the minimum Reading result UI.
- Resumed from the code checkpoint and verified that the backend had already advanced beyond the stale plan state.
- Added the feature-flagged Reading Attempt Review repository and UI: deterministic comparison, explicit Agent explanation, persisted tool trace, and bounded incremental styling. Vue typecheck and production build pass.
- Fixed the existing Reading review `scoreInfo` normalization gap across single, suite/endless, and history replay adapters.
- Added structured Writing terminal event generation inside the existing completion/failure transaction and Coach question/response events inside each message transaction; no raw essay, prompt, answer, or Coach message content is copied into payloads.
- Focused regressions passed: 19 Writing DB tests, 4 Coach/annotation/vocab DB tests, and 29 Application unit tests.
- Next proof work: sensitivity authorization, genuine v11 upgrade, explicit event/rollback assertions, developer-command gating, then unresolved canonical truth for Coach feedback/re-ask, Vocab review history, and Annotation create-vs-update.
- Final verification: `cargo fmt --all -- --check`, workspace/Tauri checks (default, no-default-features, developer-tools), and isolated-target `cargo test --workspace --locked --no-fail-fast` all passed. The full suite covered 29 Application, 20 DB unit, 5 Agent-run, 6 AI-security, 10 backup, 6 retention, 5 import, 2 score, 6 ledger, 5 migration, 5 history/settings, 19 writing, 8 reading, 13 modes, 4 Coach/annotation/vocab, 8 archive, 1 statistics, 2 task-type, 3 prompts, 6 topics, 28 Tauri tests, plus doc tests.
- Final Vue/repository verification: `npm run typecheck`, `npm run build`, `python developer/tests/ci/run_static_suite.py` (18/18), and `python developer/tests/e2e/suite_practice_flow.py` (all packaged checks passed) completed successfully. E2E also passed Reading IPC/submit, AttemptReview/Agent boundaries, SQLite restart, backup/updater boundaries, screenshots, and performance budget.
- Final API privacy search found no stale public `coach_append_message` / `coach_record_failure` handlers or frontend repository exports. User-owned deletions under `.Jules/palette.md` and `ListeningPractice/**` remain untouched and unstaged.
- M1 scope was deliberately kept minimal: the fixed registry includes future event variants, but no event is fabricated where the current canonical schema has no explicit feedback/re-ask, per-review vocabulary, or create-vs-update annotation fact. Those remain later-stage work rather than new migrations or speculative records.
- Rollback verification completed: `cargo test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --lib --target-dir target\\m1-verify` passed all 28 Tauri library tests, confirming event generation can be disabled without breaking the host test surface.
