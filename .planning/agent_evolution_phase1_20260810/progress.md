# Progress: Agent Evolution Phase 1

## 2026-08-10

- User explicitly confirmed the requirement and authorized continuous execution.
- Read the complete `planning-with-files` skill instructions.
- Ran session catch-up; no unsynced prior session was reported.
- Created the active Codex goal for Evolution Plan Phase 1 delivery.
- Confirmed the current branch and clean worktree.
- Located the authoritative 224 KB Evolution Plan and existing planning history.
- Created a dedicated scoped execution record for this task.
- Logged the unavailable bundled `rg.exe` and switched discovery to native PowerShell.
- Indexed all 8,817 lines and roadmap headings in the authoritative plan.
- Read the opening architecture/product baseline and confirmed that the requested first stage is `M0`, not `M1`.
- Completed source reading through line 1,100, including scope, current architecture audit, research convergence, target boundaries, and core service responsibilities.
- Completed source reading through line 2,000, covering data authority levels, proposed phased schema, migration invariants, and event-ledger ownership.
- Completed source reading through line 2,900, covering memory lifecycle, Dream consolidation, learner evidence weighting, repeated-attempt analysis, and Context Compiler motivation.
- Completed source reading through line 3,800, covering context query/budget/snapshot contracts, Agent runtime extensions, tool permissions/guardrails, and Coach feedback signal hierarchy.
- Completed source reading through line 4,700, covering Coach strategy/outcome contracts, offline Prompt evolution governance, application/store boundaries, invocation trace fields, Tauri commands/events, and TS type ownership.
- Completed source reading through line 5,600, covering first-version Workspace UI, trust/security/privacy policy, evaluation layers, CI expectations, and roadmap vertical-slice rules.
- Extracted the full M0 source contract and converted every work item, test, DoD, and rollback requirement into the execution checklist.
- Continued full source reading through line 6,500 and confirmed M1-M3 boundaries that M0 must not cross.
- Completed source reading through line 7,400, covering the remaining roadmap, stage dependency graph, release milestones, mandatory deliverables, and target directory convergence.
- Completed source reading through line 8,300, covering target Vue/developer assets, implementation pseudocode, frozen replay concepts, and primary architectural anti-patterns.
- Completed the authoritative Evolution Plan through line 8,817, including final acceptance and evidence hierarchy.
- Marked plan extraction complete and started the current-code M0 delta audit.
- Broad parallel audit exceeded the repository's 10-minute agent threshold. Interrupted the two running agents; the third failed with a 429. No files were modified by those agents.
- A reduced frontend probe completed and proved M0-02 is wholly missing: static files, fake workspace toggle, and timer-completed output remain; no Agent command repository exists.
- A reduced backend probe completed. It confirmed SQLite run/tool hydration already works, M0 trace is only partial, and the replay matrix has explicit gaps/coverage that needs exact file-tool reconciliation.
- Main agent fully read the exact Workspace Vue page and generic Tauri bridge that will be modified.
- Main agent fully read the Agent application loop, DB audit repository, Tauri command/store adapter, and AI retry/runtime code that will be modified.
- Reconciled the file-tool and workspace-grant tests against every M0-05 requirement; almost all security behavior already has direct coverage.
- Confirmed workspace Rust tests are already part of both normal and release CI. Began exact packaged/visual smoke coverage review after narrowing an over-broad timed-out search.
- Fully read the existing Agent visual check, relevant packaged Tauri smoke, and Vue repository/typecheck conventions.
- Captured the exact current branch tip, parent, recent history, and initial Cargo.lock hash for M0-01.

## 2026-08-11

- Implemented M0-01 through M0-06 without adding a migration or pulling M1+ scope forward.
- Added a real Vue Agent repository and replaced the workspace timer/demo data with packaged Tauri command execution and SQLite hydration.
- Added the six-field minimized trace to successful and failed Agent runs; response content, user Prompt, and file bodies remain outside run audit JSON.
- Added the single `VITE_FEATURE_AGENT_WORKSPACE_V1` route/navigation rollback flag and verified the disabled production build in Chromium.
- Removed the Windows symlink-test silent skip by falling back to a directory junction; added exact sensitive-path and all-file-tool audit minimization tests.
- Added the architecture baseline, five ADRs, and baseline eval report.
- Preserved user-owned `.Jules/palette.md` and `ListeningPractice/**` deletions without staging or reverting them.

## Test Evidence

- `cargo fmt --all -- --check`: pass.
- `cargo test --workspace --locked --no-fail-fast`: pass, including 29 application tests, 5 Agent DB tests, and 23 Tauri unit tests.
- `npm.cmd --prefix apps/writing-vue run typecheck`: pass.
- `npm.cmd --prefix apps/writing-vue run build`: pass.
- Disabled flag production build + Chromium rollback check: pass; Agent hidden/redirected, Reading/Writing/History reachable.
- `python developer/tests/e2e/run_visual_regressions.py`: 17/17 pass.
- `python developer/tests/ci/run_static_suite.py`: 18/18 pass at `2026-08-11T14:03:26Z`.
- `python developer/tests/e2e/suite_practice_flow.py`: 16/16 pass at `2026-08-11T14:04:59Z`.
- Superseded packaged evidence before the final audit fixes: binary SHA-256 `498d0b8d9fa240c7b940e16a4eef22178e412728474b2160c201b7f70c6cde66`; run `d7be44ce-8656-469f-96eb-5c5e6acc90d6`. The authoritative post-fix evidence is recorded below.

## Final Review Reopen

- Reopened P6 after three independent read-only audits.
- Confirmed five real closure defects: reset/run concurrency, provider request-ID precedence, false actual-model attribution before a valid envelope, missing failed-run ID propagation/hydration, and a packaged read-tool assertion that could pass on tool failure.
- Downgraded M0-02, M0-03, tests, and DoD to in-progress until targeted fixes and all gates pass again.
- User-owned `.Jules/palette.md` and `ListeningPractice/**` deletions remain explicitly out of scope and unstaged.
- Implemented a shared UI run mutex for workspace select/reset/run and corrected the reset label so it no longer claims to revoke the process-local backend grant.
- Added failed-run ID context at the Tauri boundary, preserved envelope context/cause ID in the JS bridge, and hydrated failed run/tool/trace state from SQLite without masking the original error.
- Made failed trace `actualModel` nullable until a valid provider envelope identifies a model; successful outcomes retain their existing string contract.
- Centralized provider request-ID selection as header-first with body completion ID fallback.
- Strengthened visual and packaged tests to prove run-time control locking, failed-run hydration, successful `read_file` path/hash, provider observation of the tool result, and header request-ID precedence.
- Final focused verification passed: 29 application tests, 24 Tauri tests, Vue typecheck/build, Python syntax, and the direct Tauri shell contract.
- Final full verification passed: `cargo fmt --check`, all workspace tests, 17/17 visual scripts, 18/18 static checks, and 16/16 packaged Tauri checks in the required order.
- Packaged release evidence: binary SHA-256 `e3fb4722b6640e183a9156452f9329c288f0f7d0c3891a2d68539fa921ad9d95`; run `9eb1c4da-a59b-4391-820b-74bc742ae99a`; `read_file` succeeded for `note.txt` with SHA-256 `3a96791a505e07c9516ea17a72b2da23ef1e50311bd4632018554bdca7f8c315`; trace request ID is header value `packaged-request-final`.
- Remaining P6 work is limited to final scoped diff/staging review, checkpoint commit/tag, and completion attestation.

## 2026-08-12 Closeout

- Recovered the persisted plan and rechecked the current index/worktree before acting.
- Removed only Markdown trailing whitespace found by `git diff --cached --check`; no document semantics changed.
- Staged 31 explicit M0 paths through a whitelist. Confirmed zero staged paths under `.Jules/palette.md`, `ListeningPractice/**`, `crates/ielts-db/migrations/**`, generated reports, `dist/**`, or `target/**`.
- Read the authoritative generated reports directly: visual `17/17`, static `18/18`, packaged Tauri `16/16`; packaged run/tool/hash/request-ID evidence matches the baseline eval report.
- Reviewed the staged frontend, Rust, security, replay, packaged E2E, ADR, baseline, and evaluation diffs. No unresolved M0 acceptance issue remains; no M1+ behavior or migration was introduced.
- Marked P6 complete. The following scoped checkpoint commit and local tag freeze exactly this verified index.
