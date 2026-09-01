# Phase 12.3 truth and release closeout

## Goal

Move the packaged Tauri 2 product closer to a publishable Rust/SQLite-owned state by closing the remaining Phase 12.3 data-truth defects, proving archive/retention safety, removing fake UI success paths, and preserving the single Liquid Glass visual source.

## Scope guard

- Rust/SQLite owns durable state and policy; Vue only adapts commands and renders them.
- Do not restore Electron, Fastify, `file://`, frontend random selection, or browser-storage backups.
- Keep visual changes in `apps/writing-vue/src/styles/opensource-skin.css`; no competing override sheet.
- Planning and generated test artifacts remain uncommitted.

## Phases

- [completed] Audit the dirty worktree and isolate remaining P0 regressions.
- [completed] Enforce writing attempt state monotonicity and fix history score-scale semantics.
- [completed] Review and verify retention and Reading archive transaction behavior.
- [completed] Replace or remove Settings/Library fake-success controls; complete the first visual-source consolidation pass.
- [completed] Run focused checks, then mandatory static -> packaged Tauri E2E gates.
- [completed] Remove generated artifacts, inspect the final diff, and create a precise local checkpoint commit.
- [pending] Audit remaining high-traffic Vue surfaces and Rust command coverage for rough/incomplete product behavior.
- [in_progress] Re-validate the latest screenshot-driven polish, then repair the highest-value confirmed defects without introducing a second visual system.
- [completed] Repair confirmed post-checkpoint P1 workflow defects: promote writing prompts to a Rust-owned aggregate, restore cancelled-writing continuation by cloning immutable attempts, and replace the dead writing-history statistics contract.
- [in_progress] Move the remaining confirmed aggregate rules into Rust: one active prompt per task, writing-history analytics, atomic history deletion, and timer-safe Reading draft recovery. Prompt/history ownership is complete; Reading timer-safe recovery remains.
- [pending] Decide and document Listening as either a supported migration scope or a formally retired legacy feature.
- [completed] Visual-source P0: replace the fake Reading trend interaction and make semantic light/dark surface tokens the only card/toolbar/dialog color source.
- [in_progress] Visual-source P1: remove nested glass elevations and duplicate Reading/History CSS owners before adding any further page styling. First screenshot-backed hierarchy pass is complete; structural CSS ownership remains.
- [in_progress] Re-run mandatory gates, create the next local checkpoint, and record the actual remaining Rust-native release gaps. The preference/timer-corruption/UI batch passed static 18/18 and packaged 14/14; checkpoint is next.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Session catchup crashed under GBK while printing emoji | 1 | Re-ran once with `PYTHONIOENCODING=utf-8`; do not repeat the GBK invocation. |
| `git diff --cached --check` reported a new blank line at EOF in `mode-idempotency.js` | 1 | Removed the trailing blank line with a one-line patch before restaging; do not retry the unchanged staged file. |
| PowerShell parsed a quoted `rg` import pattern as source text | 1 | Use simple literal token scans in separate commands rather than embedding shell-style quote escapes. |
| `writingMode.test.mjs` expected Evaluating retry to pass the old `mode` payload into the initial save/submit facade | 1 | Update the focused contract to assert the new start-only `evaluate.retry` boundary instead of restoring the broken mutable retry behavior. |
| Prompt deletion, active-prompt selection, and writing analytics still used broken legacy adapters after checkpoint `f2410c0` | 1 | Replace the frontend KV loop and client-side history scan with narrow Rust/SQLite aggregates; never reopen submitted writing attempts. |
| Focused `git diff --check` found one trailing whitespace character in the updated test | 1 | Removed the exact character before rerunning the whitespace gate. |
| Rust formatter rejected the first server-owned picker patch | 1 | Apply `cargo fmt` once; no logic change is required. |
| Guessed `crates/ielts-db/src/migrations/mod.rs` does not exist | 1 | Use `rg --files` to locate the migration registry; do not repeat the guessed path. |
| Guessed `crates/ielts-db/src/migrate.rs` does not exist | 2 | Stop path guessing entirely; enumerate exact files before the next migration read. |
| Broad Evaluating clone-integration patch did not match current shared source | 1 | No hunk applied; inspect the concurrent version and patch only missing exact lines. |
| `rg` parsed a pattern beginning with `--` as a flag | 1 | Use `rg ... -- "pattern"` for CSS-variable scans; do not repeat the malformed invocation. |
| Static suite failed 2 v8 migration fixtures: missing `history_retention_policy` table | 1 | Repair the v8 fixture/schema upgrade path before accepting the new migration batch. |
| Reading source contract did not include the repository adapter that owns the new invoke call | 1 | Add that adapter to the checked source set rather than moving the command call into a page. |
| Static AI security gate still required provider preflight in durable submit | 1 | Reverse the stale assertion: require preflight only in `writing_start_evaluation` and reject it in `writing_submit_attempt`. |
| First `cargo check -p ielts-db` after prompt aggregate | 1 | Reused the existing optional prompt activation DTO incorrectly and removed a needed `serde_json::Value` import; patched both before the next compile. |
| Three read-only audit agents were rejected by the external model router with HTTP 403 before reading files | 1 | Do not re-dispatch the same tasks; mainline performs the audits with local tools and records direct evidence. |
| PowerShell rejected a `foreach (...) { ... } | Format-Table` audit expression | 1 | Collect the loop output in a variable before piping; the failed read-only batch made no changes. |
| Bundled `rg.exe` failed to start with Windows access denied during a read-only migration scan | 1 | Use PowerShell `Select-String` for this scan and preserve independent command results with `Promise.allSettled`. |
| Policy blocked scoped recursive `Remove-Item` after `cargo clean` | 1 | Do not use a generic recursive remover; use Git ignored-only cleanup on the already verified exact paths. |
| Cold static suite exceeded the 120-second outer command timeout after `cargo clean` | 1 | Inspect report/process state, then rerun via a long-lived execution cell with periodic waits; do not count the timeout as a test result. |
| New malformed-suite-timer regression used the wrong `CreateSuiteCommand` field type and omitted `seed` | 1 | Copy the established Phase 7 fixture shape (`Some("simulation")`, explicit `seed`) and rerun focused checks separately. |
| Broad timer DTO constructor patch missed Phase 6 fixture text and applied nothing | 1 | Read each exact constructor and patch only the missing field; do not retry the broad anchor. |
| Broad backup-v6 regression patch missed the actual restore assertion block and applied nothing | 1 | Patch seed/version, restore verification, and legacy table filtering as separate exact hunks. |
