# Issue #296 final validation report

**Result: the required integrated qualification passed on 15 November 2026.**
The four Windows Chrome/Edge file/HTTP combinations passed, including three
fresh-context repetitions of both the deterministic race and persisted failed
session recovery in each combination. The pinned #284 evaluation passed with
sync disabled and enabled. This report is the N4 evidence for
[#296](https://github.com/sallowayma-git/IELTS-practice/issues/296) and
[#292](https://github.com/sallowayma-git/IELTS-practice/issues/292); PR review and
integration remain separate from release publication or deployment.

The [sanitized machine-readable evidence](evidence/reading-qualification-296.json)
contains every matrix case, browser/build identity, repetition, record count and
data-preservation assertion, plus the supplemental checks and package identity.
The [qualification guide](reading-submission-qualification.md) documents commands,
fixtures, instrumentation, expected failures and transport limitations.

## Source and artifact provenance

- Integrated runtime: `cc34203081b771a8c4352def88b82c452cd7c5fe` on `opensource`,
  integrating [#297](https://github.com/sallowayma-git/IELTS-practice/pull/297)
  ([#293](https://github.com/sallowayma-git/IELTS-practice/issues/293)),
  [#298](https://github.com/sallowayma-git/IELTS-practice/pull/298)
  ([#294](https://github.com/sallowayma-git/IELTS-practice/issues/294)), and
  [#300](https://github.com/sallowayma-git/IELTS-practice/pull/300)
  ([#295](https://github.com/sallowayma-git/IELTS-practice/issues/295)).
- Signed qualification implementation: `955580ca55644c80ddf13a343dddb6902017643d`;
  signed queued-drop regression: `4b5286170484c9739266d597259758992e52b3ab`.
  The runtime directories, entrypoints and build scripts are identical to the
  integrated runtime. Qualification changes add tests and evidence only.
- Exact pre-fix baseline: `b5ffd429f9225b047be98c4c855340a67c737983`.
  #291's `e94dfa820e3203adbf8519bbb804cbbf043c84bf` was runtime-equivalent;
  this qualification executes the original baseline directly.
- Pinned #284 revision: `c23a113da27fd961effa1811950a8d56f5a4b088`.
  Both that original artifact and a separate evaluation build with the integrated
  repair were executed. The evaluation starts with the integrated source and
  applies #284's source delta from the pre-fix baseline, then regenerates bundles
  and diagnostic stamps. It does not merge #284 into the delivery branch.
  The applied patch SHA-256 is
  `5ba876959b7a1a028b3feb197f3f9261a537e18f310a1d7bf19c5b17ea89ed22`.

| Artifact | Verified generated build ID |
| --- | --- |
| Original baseline | `sha256:444e44a26c1b472f6ec7c9a864695890584d2492f78d298f314867dd8a8a5601` |
| Original pinned #284 | `sha256:b52210b8ec185c23ca130a73968074761e11d6ce738b1f93fd6298190521b06a` |
| Integrated repaired candidate | `sha256:38e3da80bafddfb88bdf15818b8e40d886dd8e5bc744d7241b3b695a904ea56c` |
| Pinned #284 plus repair | `sha256:8c78ad0018a9570317a9b28e806a6962a6a26eb501c022b9a4392249a9452651` |

All extracted source artifacts passed bundle and diagnostic manifest verification.
The evidence records input Git archive hashes; the compatibility input archive
hash identifies its integrated source before applying the separately hashed
patch. Its generated build ID identifies the rebuilt combined artifact.

## Browser and storage matrix

All runs used Windows, headless automation, isolated browser contexts and real
IndexedDB. Installed Chrome was **157.0.8103.52**; installed Edge was
**157.0.4341.46**. Node.js was 24.22.1 with Playwright 1.62.1. Repository Python
checks used Python 3.12.14 and Playwright 1.56.0.

| Configuration | Case executions | Race / persisted-fixture repetitions | Result |
| --- | ---: | --- | --- |
| Chrome, `file://`, baseline IndexedDB | 27 | 3 / 3 fresh contexts | Passed |
| Chrome, localhost HTTP, baseline IndexedDB | 27 | 3 / 3 fresh contexts | Passed |
| Edge, `file://`, baseline IndexedDB | 27 | 3 / 3 fresh contexts | Passed |
| Edge, localhost HTTP, baseline IndexedDB | 27 | 3 / 3 fresh contexts | Passed |
| Chrome, pinned #284 + repair, sync disabled, `file://` | 14 | Normal, controlled race, recovery, retry and conflicts | Passed |
| Edge, pinned #284 + repair, sync disabled, `file://` | 14 | Same compatibility cases | Passed |
| Chrome, pinned #284 + repair, sync enabled, HTTP | 14 | Incoming operations, completion/recovery, duplicate prevention | Passed |
| Edge, pinned #284 + repair, sync enabled, HTTP | 14 | Same compatibility cases | Passed |
| Original baseline, Chrome `file://` | 3 | Ordinary, held-save control, controlled race | Expected outcomes |
| Original pinned #284, Chrome `file://` | 3 | Ordinary, held-save control, controlled race | Expected outcomes |
| #286 file-journal authority | Not applicable | Absent from both candidate source/build artifacts | Exclusion verified |

The matrix contains **170 executions**: 168 successful cases and two deliberately
reproduced pre-fix race failures whose rejection assertions passed. The stronger
queued-drop test additionally passed in two Chrome contexts, file and HTTP, on
`4b528617`; the final Edge file/HTTP matrix runs also include this assertion.
There are **172 accepted scenario executions** in the published evidence.

Each core combination's 27 executions comprise 15 submission/registration cases,
eight persisted recovery/failure/conflict cases, and two extra repetitions each
of the race and existing-fixture recovery. Ordinary and held-save controls commit
one suite record. Successful fixture recovery retains the unrelated record and
produces one suite result, for two total records. Unknown outcomes retain zero
suite results and readable recovery. Stale writers retain zero suite results
while preserving the valid writer's completed record and unrelated data.

The controlled pre-fix race rejected an unfrozen snapshot despite matching
submitted/persisted writer identities, reported `TIMING_STALE_WRITER` and
`not-committed`, and left zero completed records. Neither ordinary submission nor
holding the save return without interaction failed. The repaired runs preserve
the accepted answer snapshot and all three frozen timing snapshots through the
same real save boundary, including question selection, text/radio/checkbox input,
drag/drop, navigation, timer changes, repeated Submit, delayed activation,
delayed checkpoint completion and inactive/restored passages.

Existing-fixture recovery uses the visible supported action. Assertions compare
answers, answer comparisons, score, duration, highlights, notes, outlines, marked
questions, timing totals/units and source identities with the retained fixture.
The original operation/attempt identities remain unchanged; the absent pre-fix
receipt ID remains absent. Concurrent confirmation, host/practice reloads, lost
transaction returns, missing/delayed ACKs and repeated confirmation do not rewrite
the completed result or review plans. Real write failures preserve either the
original recovery transaction or its fully prepared replacement and leave
unrelated records/drafts unchanged.

Enabled compatibility runs use real OPFS directories and operation files with
simulated file copying between isolated contexts. Chooser/permission responses
are substituted. Incoming files are withheld until the controlled submission
boundary, then consumed by the production service. Completion and recovery reach
the peer once; duplicate file replay preserves both the peer and local result.
IndexedDB remains authoritative. These runs do **not** establish native directory
grants, live OneDrive transfer or acceptance across two physical devices.

## Regression and package gates

| Gate | Result |
| --- | --- |
| Complete JavaScript suite, including controller/persistence, recovery, submission/ACK and diagnostic regressions | 904/904 passed; zero skips |
| Python regression suite | 52/52 passed |
| Unified integration runner | 22/22 groups passed, including both production submission and the new persisted recovery runner |
| Full diagnostic integration qualification | 423 cases passed |
| Installed Chrome diagnostic child/host channel | 33/33 passed across file, HTTP and subpath |
| Installed Edge diagnostic child/host channel | 33/33 passed across file, HTTP and subpath |
| Pinned #284 model, persistence and release regressions on the repaired evaluation artifact | 31/31 passed |
| Reading source integrity | 239 files passed |
| `node scripts/build-bundles.mjs --check` | 18 outputs current |
| `node scripts/verify-diagnostic-release.mjs` | Candidate build ID verified; 25 required assets, 208 source mapped sections |
| `git diff --check` | Passed |
| Windows clean-checkout package qualification | Passed on signed `955580ca` |

Diagnostic cases verify the allowlisted reason, shared child/host correlation,
accurate commit state and gated retry through persisted reads and passive export.
Successful recovery breadcrumbs do not imply a completed-record commit. The
existing privacy, old-event compatibility and export-bound tests passed as part
of the complete regression suite.

The Windows qualification built a fresh runtime ZIP from clean signed source,
matched **527 files** to that source, verified its extracted generated assets and
executed nine packaged browser case groups plus **222 packaged diagnostic
acceptance cases**. The packaged browser was headless Chromium 151.0.7922.34;
the installed Chrome/Edge matrix above is separate evidence. The package contains
25 required diagnostic assets and 206 mapped sections, reflecting the packaged
source subset, while retaining the same candidate build ID.

- Archive size: `8,207,008` bytes.
- Archive SHA-256: `45b8da7716b378394b71fee9a2a3b1cce2c7d9cebebe451c8c9945c4a85393e1`.
- Source-matched asset manifest SHA-256:
  `b94b9b57f8ddde9eb9fbfcef040d1eb20dc61fb158e65190f3605ea5654654a3`.

No release was published. The later queued-drop change affects only the test
harness; its runtime is byte-identical to the packaged signed revision.

## Evidence boundaries and incident reconciliation

The required Windows browser/access-mode matrix and applicable optional-sync
evaluation are complete. Headless automation and controlled DOM events do not
establish native OS backgrounding or native OS drag-and-drop acceptance. The
sync folder transport is explicitly simulated. #286 is not included, so no
claim is made about its real-file authority or recovery behavior.

The repeated #291 failure confirms that the identified submission interaction
race existed both before #284 and in its pinned original artifact. Its build ID
matches the one reported in #289, but this does not independently establish the
original user's complete deployed file set or the incident's unique cause.
Persisted answers remain recoverable in the qualified fixture. The evidence
establishes failed completion persistence and successful safe recovery; it does
not establish permanent answer loss or a OneDrive-specific cause.
