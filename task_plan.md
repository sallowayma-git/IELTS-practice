# AppData v2 Audit Gate Implementation

## Goal

Implement the approved data integrity, file:// protocol, import/projection, idempotency/concurrency, cross-realm notification, and regression-test gates on `codex/audit-tmp-migration` while preserving the user's existing accuracy UI changes.

## Constraints

- Preserve existing worktree changes in:
  - `js/components/practiceRecordModal.js`
  - `js/views/legacyViewBundle.js`
  - generated `js/bundles/browse.bundle.js`
  - generated `js/bundles/practice.bundle.js`
- Keep AppData IDB-only; do not add a long-lived legacy backend.
- Subagents are read-only scouts; main agent owns edits and final verification.
- Generated bundles must be rebuilt from source after source changes.

## Phases

1. **Baseline and contracts** — complete
   - Capture current branch/diff/worktree state.
   - Locate exact protocol/data/test surfaces and delegate independent read-only checks.
2. **Data kernel and AppData** — complete
   - Full mirror restore, entity-layer invariants, journal reset.
   - Legacy projection normalization, suite light summaries, operation IDs.
   - Vocab CAS retry/serialization and corruption isolation.
   - Cross-realm commit broadcast.
3. **Messaging protocols** — complete
   - file:// fallback origin.
   - Canonical fallback recorder.
   - Listening submission correlation/ACK retry.
   - Vocab save ACK.
4. **Tests and bundles** — complete
   - Update/add focused unit and Playwright coverage.
   - Rebuild bundles without losing existing UI source edits.
5. **Integration verification** — complete
   - Run focused and full available suites.
   - Fetch latest `origin/opensource`; integrate only if safe with the dirty worktree.
   - Review final diff and report residual risks.

## Current Hotfix: Manifest Loading And Practice Submission

### Goal

Restore reliable `file://` operation by making the generated reading manifest the only built-in exam-index source and by preventing valid practice completions from producing an invalid negative/non-finite `correctAnswers` value.

### Phases

1. **Trace exact failure paths** — complete
   - Locate every reading exam-index source and the zero-index fallback path.
   - Trace completion payload normalization into `AppData.practice.completeAttempt`.
   - Separate optional missing Listening assets from Reading startup and submission.
2. **Regression coverage** — complete
   - Pin manifest-only built-in loading under `file://`.
   - Pin score normalization for the reported completion payload shape.
3. **Source fixes and bundle rebuild** — complete
   - Apply narrowly scoped source changes.
   - Rebuild all generated bundles once from the final source tree.
   - Source changes and generated bundles are synchronized.
4. **Verification** — complete
   - Run focused and full relevant JS suites.
   - Run bundle drift/syntax checks and the available `file://` submission flow.

## Current Hotfix: Backup Trust And Import Safety

### Goal

Prevent semantically poisoned or sparse v2 backups from clearing practice records or hiding the built-in Reading manifest, while preserving recoverable user settings and maintaining explicit destructive restore semantics.

### Phases

1. **Real-backup reproduction and opensource comparison** — complete
   - Inspect the supplied backup byte-for-byte and verify its checksum.
   - Compare old export/import paths and identify v2-only regressions.
2. **Semantic snapshot validation and salvage** — complete
   - Repair known legacy row wrappers only when aliases match.
   - Validate the library configuration/index/active-ID bundle as one unit.
   - Classify declared/effective scope and surface repaired/missing keys.
3. **Destructive import guard** — complete
   - Compute existing/incoming/final/removed practice counts.
   - Require explicit `confirmDestructive:true` after the UI confirmation before destructive commit.
   - Update both ordinary import and external restore confirmations.
4. **Dense export and round-trip coverage** — complete
   - Materialize every exportable catalog key as present or explicitly cleared.
   - Add the supplied poisoned snapshot as a regression fixture.
5. **Bundle rebuild and end-to-end verification** — complete
   - Fix existing test expectation drift, run focused/full suites, rebuild bundles once, and verify `file://` import/browse behavior.

## Current Review: Raw-Data Migration Chain

### Goal

Re-audit the complete v1-to-v2 path from original persisted bytes, distinguish root-cause corrections from defensive recovery code, and simplify any fallback that is not justified by a demonstrated historical data shape.

### Phases

1. **Historical source-of-truth inventory** — complete
   - Enumerate every v1 writer and the exact physical IndexedDB/localStorage shapes.
   - Separate authoritative user records from generated/default manifest caches.
2. **Byte-to-domain migration trace** — complete
   - Replay representative raw rows through read, parse, normalize, mutate, export, and import.
   - Record every lossy or shape-changing boundary.
3. **Current patch minimality review** — complete
   - Classify each new recovery/import safeguard as root fix, required compatibility, or removable overengineering.
   - Prefer preventing the first bad write over repairing arbitrary poisoned states.
4. **Evidence and decision** — complete
   - Add only narrowly justified tests or corrections.
   - Report the canonical migration contract and remaining unrecoverable cases.

## Current Change: Persistent v1 Reconciliation

### Goal

Treat surviving v1 user data as the authoritative recovery source on every startup: merge all valid v1 records and user-library data into v2, and overwrite only v2 values carrying the known bad-migration fingerprints.

### Phases

1. **Reconciliation contract** — complete
   - Define document, practice, library, and repeated-startup precedence.
   - Preserve valid v2-only additions while ensuring all v1 records are present.
2. **Implementation and regressions** — complete
   - Remove the marker/healthy-v2 early exits that suppress legacy reconciliation.
   - Add repeated-startup, damaged-v2 overwrite, and mixed v1/v2 merge coverage.
3. **Bundles and verification** — complete
   - Rebuild generated bundles.
   - Run focused migration/import/library suites, file:// E2E, bundle drift, and diff checks.

## Current Change: Review Fixes, v2 Insights, And Endless Mode

### Goal

Fix the six confirmed automated-review regressions, reconnect practice-record error classification to a lightweight v2 projection, and restore the complete endless-reading lifecycle without regressing the existing persistent v1 reconciliation work.

### Phases

1. **Evidence and contracts** — complete
   - Confirm every review finding against the current source and tests.
   - Trace the light-summary/detail split used by practice insights.
   - Trace endless startup, navigation, completion, next-exam, and cleanup.
2. **Review fixes** — complete
   - Stop recurring reconciliation of transient recovery documents.
   - Await Browse preference hydration before first UI/scroll restoration.
   - Repair the method-contract scanner, achievement durability, async E2E assertion, and pre-import backup timing.
3. **Lightweight practice insights** — complete
   - Project compact question-type error counts into v2 summaries and suite-entry summaries.
   - Teach the practice priority/radar consumer to use the compact projection.
   - Use existing suite-entry summaries for exam-type filtering.
4. **Endless mode lifecycle** — complete
   - Fix first-start state construction.
   - Carry an explicit endless marker through the unified exam-open path.
   - Reuse the normal session lifecycle for subsequent exams and make startup failures visible/clean.
5. **Regression coverage, bundles, and verification** — complete
   - Add focused unit/contract/E2E coverage for every changed behavior.
   - Rebuild generated bundles once from final source.
   - Run focused suites, static suite, relevant E2E, bundle drift, and diff checks.

## Current Audit: Residual Gate Triage

### Goal

Determine whether each residual unified-static/E2E failure represents a product defect that should be fixed, a test-runner defect worth repairing, or an optional resource-dependent audit that should be isolated from the default gate.

### Phases

1. **Independent evidence collection** — complete
   - Audit the v2 legacy-key guard and suite JSON parser.
   - Reproduce and classify the four NB replay failures.
   - Trace the Reading quick timeout and suite first-passage readiness failure.
2. **Main-agent verification** — complete
   - Check agent-provided file/line evidence and rerun the smallest decisive probes.
   - Estimate blast radius and implementation cost.
3. **Recommendation** — complete
   - Rank required, recommended, and optional fixes.
   - Do not modify production or test code in this diagnostic turn.

## Current Implementation: Residual Gate Repair

### Goal

Repair the stale static/test gates, restore deterministic Reading quick coverage, propagate suite test mode into the placeholder path, rebuild affected bundles, and verify the complete chains without weakening runtime safety.

### Phases

1. **Fresh source/test reconnaissance** — complete
   - Locate exact minimal edits for the static allowlist, suite JSON parsing, NB trusted-message fixture, Reading ready/result contract, batch dataset loading, and suite placeholder URL.
   - Preserve the existing dirty worktree and prior implementation.
2. **Infrastructure and fixture repair** — complete
   - Repair semantic allowlists and last-line JSON parsing.
   - Update NB replay setup and clone-group selection.
   - Remove the date-sensitive legacy migration fixture.
3. **Reading and suite chain repair** — complete
   - Establish a deterministic Reading ready/result assertion and eliminate per-dataset Node cold starts.
   - Propagate the narrow suite test flag and add immediate E2E diagnostics.
4. **Bundles and focused verification** — complete
   - Rebuild only from final source using the repository build path.
   - Run focused JS/Python/E2E tests and bundle drift checks.
5. **Full gate verification** — complete
   - Run the unified static suite with a realistic outer bound.
   - Record any remaining unrelated failures without masking them.

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Subagent tools returned `unsupported call` during the prior audit turn, Default mode, and the resumed implementation turn | 4 | Stop retrying the unavailable interface; use parallel read-only shell probes and record the limitation |
| Parallel gate probe assumed a root `package.json`; PowerShell redirection also made `rg.exe` fail | 1 | Locate manifests with `rg --files` first; run probes with per-call error capture and no stderr redirection |
| Bundled `rg.exe` subsequently failed to launch with Windows `Access denied` | 1 | Treat `rg` as unavailable for this session; use `git ls-files`, `git grep`, and `Select-String` |
| Combined AppData/DataKernel patch missed the exact `createRestoreSnapshot` context and was rejected atomically | 1 | Split into smaller exact hunks after rereading the current function; no source changes were applied |
| New corruption test asserted `summary.id`, but the seeded legacy test summary only contains `title/score` | 1 | Assert the surviving row by `title`; implementation behavior was correct |
| Submission contract hunk missed an intervening `observedOrigin` assignment | 1 | Reread the 12-line target and inserted the guard immediately before message metadata is committed |
| Fallback ACK regression kept Node alive on the 120-second receipt replay timer | 1 | Preserve the browser timer and call `unref()` only when the runtime timer supports it |
| PowerShell regex quoting failed while locating suite completion fixtures | 1 | Switched to `Select-String -SimpleMatch`; no source action was repeated |
| Resumed subagent dispatch still returned `unsupported call` | 5 | Honor the existing stop condition; continue with bounded read-only source probes |
| `suiteModeRegression` counted the completion-time recorder rebind as a reset-time rebind | 1 | Clear the fixture's `recorderStarts` probe immediately before sending the reset request |
| Multi-file PowerShell range printer hit an array type mismatch after printing the first targets | 1 | Retain the useful output and switch to exact `Select-String`/single-file reads for remaining senders |
| PowerShell parsed unquoted `^{tree}` revisions incorrectly during squash replacement preflight | 1 | Safety check aborted before mutation; reran with quoted revisions, verified identical tree hashes, then force-pushed with an explicit lease |
| All PowerShell/Node child processes fail before startup with `CreateProcessAsUserW failed: 5` | 3 execution paths + 4 agents | Switched to remote exact-tree reads and static review; source/tests are patched, but tests and bundle rebuild must wait for the desktop sandbox/process launcher to recover |
| Full JS sweep exposed `unifiedReadingCoreRegression.test.js` notification-order failure | 2 | Reproduced alone; unrelated to the data/import files changed here and recorded as a pre-existing residual failure |
| Existing file:// E2E called destructive `commitImport` without the new preview token | 1 | Updated the test to model the same explicit confirmation-token handoff as production UI; rerun passed |
| Combined plan/findings status patch targeted a findings heading in `task_plan.md` | 1 | Atomic patch made no changes; split the update across the correct files |
| Legacy migration regression still expected the retired `poison-repair` marker mode | 1 | Source syntax passed; update the test contract to persistent reconciliation before rerunning |
| PowerShell range probe accidentally assigned inside the loop condition | 1 | Parser rejected before execution; reran with a fixed numeric upper bound |
| Reboot harness treated delete entity operations as upserts and checksummed `undefined` | 1 | Added the harness delete branch so the persistent-restoration test exercises the real three-layer delete contract |
| Planning skill completion helper reported `0/4` because this long-lived plan uses prose phase markers rather than its checkbox template | 1 | Manually verified and marked the current and overall verification phases complete; did not rewrite the established planning format |
| Bundled `rg.exe` still fails to launch with Windows `Access denied` during the current change | 2 | Reuse the established fallback: `git grep`, `git ls-files`, and PowerShell `Select-String`; do not retry `rg` |
| Unified static suite exceeded the initial 120-second command timeout without producing a failure report | 1 | Build final bundles first, then rerun the suite with its realistic longer timeout instead of repeating the same bound |
| Unified static suite also exceeded a 300-second outer shell timeout | 2 | Inspection shows the runner legitimately contains 240s/360s/480s child-test bounds and emits only at completion; rerun once with an outer bound covering those declared gates |
| `suite_practice_flow.py` retained a locator across an overview re-render and failed while scrolling a detached button | 1 | Replace the redundant explicit scroll with Playwright's visible wait and click auto-retry on the locator |
| Suite E2E used the pre-keyword-only Playwright `wait_for_function` argument form in preference setup | 1 | Pass the payload through the current `arg=` keyword, matching every other parameterized wait in the file |
| Cleanup of the newly generated `developer/tests/ci/__pycache__` was blocked by the desktop command policy | 1 | Leave the untracked cache untouched and report it; no retry or broader deletion |
| Suite E2E passed placeholder launch and P1→P2, then timed out waiting for P2→P3 | 1 | Treat as newly exposed chain defect; inspect the exact transition/report rather than raising the 20-second wait |
| Suite E2E later failed before suite launch because the asynchronously shown GPL modal intercepted browse navigation | 1 | Make overlay dismissal wait for visible state instead of a one-shot `.show` count check |
