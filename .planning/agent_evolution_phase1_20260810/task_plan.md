# Agent Evolution Phase 1 Execution Plan

## Goal

Use `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan.md` as the authoritative specification and complete its first implementation phase without pulling later-phase scope forward or regressing existing Tauri/Vue/Rust behavior.

## Status

- [completed] P0. Read the complete Evolution Plan and extract the exact Phase 1 scope, contracts, dependencies, and acceptance criteria.
- [completed] P1. Audit the current branch against every Phase 1 deliverable and map existing/reusable/missing work with `file:line` evidence.
- [completed] P2. Freeze the minimum data structures and compatibility boundaries; write focused characterization or migration tests first where risk requires them.
- [completed] P3. Implement the missing Phase 1 backend, database, command/API, and UI surfaces strictly required by the plan.
- [completed] P4. Run focused Rust/Vue/database tests and fix failures without broadening scope.
- [completed] P5. Run required repository gates in order:
  - `python developer/tests/ci/run_static_suite.py`
  - `python developer/tests/e2e/suite_practice_flow.py`
- [completed] P6. Reconcile documentation and evidence, independently review the delivered diff, and close Phase 1 only when every acceptance criterion is proven.

## Fixed Decisions

- The Evolution Plan is the product and architecture baseline; this execution plan does not redefine it.
- Existing canonical learning data remains authoritative. Agent-derived state must not silently overwrite it.
- Prefer the current `ielts-domain` / `ielts-db` / `ielts-application` / Tauri adapter boundaries and existing patterns.
- Preserve existing command contracts and user flows unless Phase 1 explicitly requires a change.
- Do not implement later phases merely because their schema or interface is nearby.
- Database migrations must be forward-only, transactional where applicable, backup-aware, and covered by migration tests.
- No completion claim without focused tests plus both repository-mandated regression suites.

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Bundled `rg.exe` could not start from the WindowsApps path (`Access denied`). | 1 | Switched read-only discovery to PowerShell `Get-ChildItem` / `Select-String`; do not repeat the failing command. |
| Three broad M0 audit agents did not return within 10 minutes; two were interrupted and one ended with service `429 Too Many Requests`. | 1 | Stopped blind waiting and split the audit into smaller exact-file probes; main agent retains code-reading and all edit decisions. |
| Broad PowerShell search across all `developer/tests` reports and bytecode timed out after 20 seconds. | 1 | Replaced with exact source-file reads and searches that exclude generated reports/`__pycache__`; do not repeat broad scan. |
| Exact packaged smoke read used a guessed filename `packaged_tauri_suite.py`, which does not exist. | 1 | Enumerated `developer/tests/e2e`; authoritative file is `packaged_tauri_flow.py`. |
| Two post-fix read-only audit agents both failed immediately with service `429 Too Many Requests`. | 1 | Did not retry blindly. Retained the earlier three independent audits as discovery evidence and completed final requirement/diff/staging verification in the main thread against current source and fresh gates. |

## Scope Reconciliation

- Exact Phase 1 is M0; M1+ schema and behavior remain out of scope.
- The five defects found by final independent review are closed: workspace reset concurrency, provider request-ID precedence, unknown actual-model semantics on pre-envelope failures, failed-run hydration by run ID, and packaged read-tool result assertions.
- Focused and full gates passed again after those fixes. The path-scoped staging audit contains 31 allowlisted M0 files, no migration or generated report, and no user-owned `ListeningPractice/**` or `.Jules/palette.md` deletion. The stable M0 checkpoint commit/tag freezes this verified state.

## M0 Delivery Checklist

- [completed] M0-01 baseline record: current branch tip/backend ancestry, `Cargo.lock`, schema version, architecture map for domain/db/application/Tauri AI/Tauri Agent/Vue API, and current `AgentService` sequence diagram.
- [completed] M0-02 real workspace: remove static files and timer preview; add an Agent repository; call `agent_pick_workspace`, `agent_run`, and `agent_get_run`; render real run ID, rounds, tool calls, and final result without redesigning the page. Workspace selection/reset/run share one mutex, and persisted failed runs hydrate by backend-provided run ID.
- [completed] M0-03 trace metadata: expose provider request ID, actual model, latency, usage, retry count, and Prompt hash through current run results, including terminal failure paths. Provider request headers take precedence and `actualModel = null` until a provider envelope identifies a model. No `llm_invocations` table or migration was added.
- [completed] M0-04 fake-model replay fixtures: content; read then content; multiple tools; unknown tool; invalid arguments; duplicate call ID; max rounds; max tools; provider failure; store failure; interrupted run; hash conflict; path escape.
- [completed] M0-05 security proof: expired grant; symlink/junction containment without silent skip; all sensitive paths; read-hash requirement; atomic write; maximum size; UTF-8; audit excludes file body.
- [completed] M0-06 ADRs `0001` through `0005` exactly as named in the Evolution Plan.
- [completed] M0 tests: `cargo test --workspace`; Agent unit/fake replay; packaged Tauri workspace smoke; file-tool security; Vue typecheck; screenshots; 17/17 visual matrix; 18/18 static gate; 16/16 packaged E2E. Packaged smoke proves `read_file` succeeded with the expected path/hash and that the provider request header wins over body completion ID.
- [completed] M0 DoD: real workspace run; SQLite rehydration of successful and failed run/tool-call state; zero current-flow regression; baseline tests represented in CI; baseline eval report.
- [completed] M0 rollback proof: the shared build flag disables both Agent route and navigation while Reading/Writing/History remain reachable; no migration is added.
