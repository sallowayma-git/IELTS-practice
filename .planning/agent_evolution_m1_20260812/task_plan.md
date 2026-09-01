# Agent Evolution M1 Execution Plan

## Goal

Use `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan.md` as the authoritative specification and completely deliver M1 Learning Event Ledger without importing M2+ Memory, Dream, Learner Model, or Context Compiler behavior.

## Status

- [completed] P0. Re-read the authoritative M1 contract and extract exact scope, event taxonomy, ownership, migration, backfill, tests, DoD, and rollback requirements.
- [completed] P1. Audit current domain/database/application/Tauri flows against every M1 requirement with exact symbol and file evidence.
- [completed] P2. Freeze the minimum ledger data structures, transaction boundary, idempotency contract, compatibility surface, and focused characterization tests.
- [completed] P3. Implement the M1 schema, domain/store/application services, same-transaction event append paths, and required backfill/repair behavior.
- [completed] P4. Complete focused migration, transaction, idempotency, privacy, backup, and business-flow tests; fix failures without broadening scope.
- [completed] P5. Run Rust/Vue verification and the required repository gates in order:
  - `python developer/tests/ci/run_static_suite.py`
  - `python developer/tests/e2e/suite_practice_flow.py`
- [completed] P6. Reconcile documentation and evidence, independently review the scoped diff, and close M1 only when every acceptance criterion is proven.

## Fixed Decisions

- Existing practice records remain canonical truth; the ledger is an immutable analysis and incremental-processing feed, not a replacement event-sourced model.
- Authoritative events are built in Rust from committed business data. Vue and model output cannot author canonical learning events.
- Business mutation and event append must share one SQLite transaction whenever the plan designates the event as part of successful completion.
- Idempotency is a schema and ownership property, not a best-effort application check.
- Schema migrations are forward-only and require fresh-database plus v11-upgrade coverage, backup coverage, and recovery documentation.
- No M2+ memory candidate extraction, learner inference, Dream scheduling, retrieval, embeddings, or Prompt evolution.
- Existing Tauri commands and user-visible flows remain compatible unless M1 explicitly requires additive data.
- User-owned deletions under `.Jules/palette.md` and `ListeningPractice/**` remain out of scope and must not be staged, restored, or modified.

## Five-Question Gate

1. Real problem: yes; non-atomic evidence capture would lose or duplicate the facts future personalization depends on.
2. Simpler method: yes; one append-only SQLite ledger and deterministic producers, without event-sourcing the product.
3. Breakage risk: existing Reading, Writing, Coach, Vocab, History, Backup, migrations, and packaged flows.
4. Complexity reduction: keep one event envelope, one ownership rule, one idempotency rule, and no later-stage consumers.
5. Fit to pain: M1 creates trustworthy evidence only; it does not pretend personalization exists before downstream stages.

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Prior M0 code/commit/tag were complete but the Codex goal remained active after context handoff. | 1 | Verified disk/git evidence, marked M0 goal complete, and created an independent M1 goal. |
| Bundled `rg.exe` remained unavailable with WindowsApps access denied during M1 source search. | 1 | Reused the previously documented PowerShell `Get-ChildItem` / `Select-String` fallback; do not retry the blocked binary. |
| First ledger compile found one JSON error-conversion mismatch and two moved values. | 1 | Corrected the exact conversions/ownership sites; the next workspace check passed. |
| Initial ledger unit fixtures referenced nonexistent attempts and correctly hit the foreign-key constraint. | 1 | Kept foreign keys enabled and changed generic append tests to events without attempt references; Reading FK behavior belongs in real submit tests. |
| Backup v8 caused five expected compatibility-test failures because current fixtures still asserted v7 or retained the new table in legacy package shapes. | 1 | Froze the v7 table list, updated current schema assertions to v8, and removed `learning_events` only when constructing old v2/v4/v5/v6 fixtures. All backup tests then passed. |
| Full workspace test rerun hit Windows `LNK1104` while linking a Tauri test executable in the default target directory. | 1 | Verified no cargo/rust/link process remained, the output was absent, disk/ACL were healthy, then reran with isolated `target\\m1-verify`; all workspace tests passed. |
| Oversized learning-tool test unexpectedly returned success because its fixtures were `private` and correctly filtered from Agent search. | 1 | Changed only that fixture to `normal`; privacy filtering remains unchanged and the 64 KiB rejection test now passes. |
