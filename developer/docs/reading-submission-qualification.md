# Reading submission and recovery qualification

Issue [#296](https://github.com/sallowayma-git/IELTS-practice/issues/296), delivery
node N4 of [#292](https://github.com/sallowayma-git/IELTS-practice/issues/292).
The production repair integrates #297 / #293, #298 / #294 and #300 / #295 on
`opensource`. Qualification does not merge the optional synchronization or file
journal features, publish a release, or deploy an application.

## Reproduce the qualification

Use Node.js, Python, the dependencies in `developer/package.json`, and installed
Windows Chrome and Edge. The standard integration runner also needs the pinned
Python Playwright version from `.github/workflows/ci.yml`. Browser contexts and
all storage are disposable; no existing browser profile or learner data is used.

```powershell
# PYTHON can identify a Python executable when it is not named python on PATH.
node developer/tests/e2e/prepare_reading_qualification.mjs <integrated-revision>
# Use the provenance.json path printed by the preceding command.
node developer/tests/e2e/reading_qualification_matrix.mjs <provenance.json>
```

The preparation command creates a new ignored artifact directory. It extracts
the exact pre-fix baseline `b5ffd429f9225b047be98c4c855340a67c737983`, the original
#284 build at `c23a113da27fd961effa1811950a8d56f5a4b088`, and the supplied integrated
revision. It applies the pinned #284 source delta to the integrated tree in an
isolated evaluation directory, excluding generated bundles and inline diagnostic
stamps, then rebuilds and verifies the combined artifact. One-line patch context
allows the adjacent recovery reconciliation method to remain intact; no recovery
or transaction fence is removed. An unexpected source conflict stops preparation.
The resulting source revision, input archive hashes, applied patch hash, build IDs
and absence/presence of `fileJournal.js` are recorded in `provenance.json`.

The matrix fails if either installed browser is missing. `CHROME_PATH` and
`EDGE_PATH` can select their executable paths. `READING_MATRIX_SECTION=baseline`
or `compatibility` runs just that section. The baseline section includes both
pre-fix controls and all four installed-browser/access-mode combinations.
Each run writes a separate JSON report and log; `matrix.json` records exit status,
browser version, build ID, script hash, repetition and individual outcomes.
A failed run is never converted into a passed or skipped matrix cell.

The ordinary CI regression entrypoints remain usable without the Windows matrix:

```powershell
node developer/tests/e2e/reading_submission_freeze.node.js
node developer/tests/e2e/reading_recovery_qualification.node.js
python developer/tests/e2e/e2e_runner.py
```

The production suites support `PLAYWRIGHT_EXECUTABLE_PATH`,
`READING_QUALIFICATION_MODE=file|http`, and a separate
`READING_QUALIFICATION_REPORT` output path. `READING_FREEZE_SCENARIOS` and
`READING_RECOVERY_SCENARIOS` select comma-separated cases for investigation.
`READING_QUALIFICATION_ROOT` selects an extracted runtime while retaining the
current test harness; `READING_QUALIFICATION_REVISION` identifies that runtime.
The unchanged runtime's generated manifest is read directly from that directory.

To qualify the existing diagnostic channel suite in either installed browser:

```powershell
$env:PLAYWRIGHT_EXECUTABLE_PATH = '<installed-browser-executable>'
$env:DIAGNOSTIC_CHANNEL_REPORT = '<separate-report.json>'
node developer/tests/e2e/diagnostic_channel.node.js
```

## Assertions and fault boundaries

| Coverage | Production regression and durable assertions |
| --- | --- |
| Original race | `question-click` holds the return of a real frozen timing save, clicks a question number with Playwright, and releases the original result. The pre-fix run must retain a finalizing session, an unfrozen snapshot, matching writer identities, `TIMING_STALE_WRITER`, a definite non-commit and zero completed records. |
| Controls | `ordinary` has no held save; `control` holds and releases without interaction. Both must commit exactly once. |
| Input barrier | `interactions` and `selection-drop` cover text, radio and checkbox input, question numbers, navigation, timer actions, repeated Submit and production drag/drop handlers. Assertions compare accepted answers and frozen snapshots to the completed record and real timing rows. |
| Pending work | `delayed-activation` submits while a real timing acquisition return is held and verifies completion after release. `delayed-checkpoint` releases a real host checkpoint during the submit barrier. `restored-inactive` reloads with only the active passage acquired and verifies all three finalized timing rows. |
| Recovery and ACKs | Live legacy failures use visible host/practice recovery actions, practice and host reloads, missing ACKs, repeat confirmation and stale delayed responses. The original IDs, receipt replay window and immutable committed record are checked. |
| Existing persisted failure | `persisted-fixture` seeds `suite-finalizing-pre-fix.json` through the real data kernel, invokes the visible recovery dialog, then repeats confirmation in a second host and reloads. Answers, comparisons, annotations, score, duration, timing, source identity, original operation and absent legacy receipt identity are all checked. |
| Storage failures | `replacement-write-failure` and `completion-write-failure` inject faults at real IndexedDB writes. They check rollback or retained prepared recovery, readable answers, unchanged unrelated records/drafts, then successful UI recovery. `unknown-outcome` retains a journal-only ambiguous state without speculative completion. `commit-return-lost` throws only after the real transaction completes and verifies reconciliation without rewriting records or review plans. |
| Multiple windows | `writer-takeover` acquires the same timing attempt in a second real host; `revision-drift` advances its real checkpoint. Stale recovery must fail with the allowlisted reason and preserve the valid writer. After that writer commits, stale UI recovery must preserve its completed record. `concurrent-confirmation` invokes recovery from two real hosts and verifies one suite result. |
| Diagnostics | The legacy cases assert `not-frozen`, correlation aliases, definite non-commit, supported retry and successful recovery breadcrumbs without a completed-record claim. The separate diagnostic channel suite covers six rejection producers, real child/host transport, persistence after reload, retry suppression in the receiver and passive export in file, HTTP and subpath modes. |

Every matrix case starts in a fresh browser context. The deterministic race and
persisted fixture recovery each run in three fresh contexts for Chrome/file,
Chrome/HTTP, Edge/file and Edge/HTTP. Gates delegate to real production methods;
they never manufacture the race's final rejection or replace storage. Cleanup
releases gates and restores wrappers in pages and frames before closing contexts.
Persistence checks read completed records, timing rows and operation state;
elapsed time alone is not accepted as proof of a save.

The production recovery suite retains the kernel constructor during bootstrap
only to seed/read synthetic durable fixtures and instrument transaction returns.
It still lets bootstrap remove its internal channel and uses the shipped bundles
for the application, recovery UI and persistence operations. The supported drag
handlers receive browser `DataTransfer` events; this is DOM input coverage, not
native OS drag-and-drop acceptance. Focus/visibility events, where controlled by
existing tests, likewise do not establish native OS backgrounding behavior.

## Optional synchronization scope

The compatibility build runs ordinary completion, controlled race, delayed
checkpoint, missing ACK, legacy recovery, durable fixture, failure and writer
conflict cases with sync disabled and enabled in both installed browsers.
Disabled runs use `file://`; enabled runs use a secure localhost origin for OPFS.

Enabled runs retain real directory handles, operation files, checksums, outbox
transactions, scanning and IndexedDB. Only folder selection and permission
responses are substituted. Two isolated contexts have separate OPFS directories;
copying their files simulates folder transport. An incoming vocabulary operation
is copied into the receiver only at the controlled submission boundary, then
applied through the real sync service while the timing-save return is held.
Completion/recovery is subsequently transmitted and files are replayed twice;
the peer must contain one matching record and the local committed result must
remain unchanged. No OneDrive account, native directory-picker grant, physical
second device or cloud transfer is part of this acceptance evidence.

The integrated and #284 evaluation artifacts exclude #286's file journal.
The matrix records artifact-level absence of `js/data/v2/fileJournal.js`; the
additional real-file-authority row is therefore not applicable. OPFS exchange
files in the #284 tests are transport, while IndexedDB remains authoritative.

## Evidence interpretation

The final validation report and sanitized per-case evidence accompany this
document. The #291 reproduction establishes a real failure path on the original
baseline and the pinned #284 artifact. Matching #289's reported build ID does not
verify every file deployed on the reporting machine or establish the unique
cause of that incident. Retained recovery answers demonstrate failed completion
persistence, not permanent answer loss. Neither reproduction nor successful
recovery establishes a OneDrive-specific cause.
