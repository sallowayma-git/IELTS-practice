# Reading submission state and snapshot contract

Implementation: #293. Recovery consumer: #294. Diagnostics alignment: #295.
Integrated qualification: #296. Parent tracker: #292.

## Acceptance boundary

`handleSubmit()` accepts answers, scoring inputs/results, annotations, marked
questions, passage durations and the overall timer snapshot synchronously, before
the first await. It flushes the note editor, captures a detached immutable draft,
and publishes the last editable draft through the existing recovery channel.
Recovery checkpoint delivery is not evidence of a completed-record commit.

The page then owns the submission preparation. Answer controls become disabled
and the answer root becomes inert. Question selection, keyboard navigation,
passage navigation, drag/drop, notes, reset, timer actions and repeated submission
cannot change that accepted draft. Draft/context updates and delayed activation
continuations cannot replace it. The controller also owns timing independently
of button state or the caller's `editable` flag.

Passage navigation is blocked while preparation awaits saves. Once the immutable
payload has been handed off, existing inline-suite navigation remains available
for viewing the captured passage drafts. It cannot capture edits, activate timing,
publish a new active passage/checkpoint, or change the submitted exam/final flag.

## States and transitions

`submissionPhase` is the page's lifecycle state. `submissionStatus` remains the
existing receipt/UI compatibility field; `draft` in that field alone never proves
that editing is permitted. `isSubmissionEditingLocked()` is authoritative.

| Phase | Meaning | Permitted transition |
| --- | --- | --- |
| `draft` | Editable attempt; checkpoints may advance timing. | Submit accepts the draft and enters `freezing`. |
| `freezing` | Required timing acquisitions and saves are pending; editing and navigation are locked. | All acknowledged snapshots enter `persisted`; a definite pre-handoff failure enters `failed` after all started saves settle. |
| `persisted` | Every required timing snapshot is frozen, owned and acknowledged. The detached accepted draft receives those exact snapshots. | Handoff of this payload under one submission identity. This is not a completed-record commit. |
| `handoff` | A host message was attempted; the original payload and receipt identity are retained. | A matching durable ACK enters `committed`; timeout, delivery uncertainty or an ambiguous NACK enters `unconfirmed`. |
| `committed` | A matching host ACK confirms durable completion. | Results/review; no timing edits or second completion for this attempt. A supported retake creates a new attempt. |
| `failed` | Definite pre-handoff failure, or the existing protocol's explicit first-attempt `not-committed` response without any earlier uncertainty. Answers remain available. | Retry freezes the retained draft again; a fresh eligible answer/question interaction may thaw timing and resume editing. |
| `unconfirmed` | The original operation may have committed. Editing stays locked. | Explicit confirmation resends the same payload and submission ID through host reconciliation. Never thaw or invent a replacement completion. |

A rejected retry cannot disprove an earlier lost ACK. Once a submission has an
unconfirmed outcome, a later `not-committed` response does not unlock it. The host
must establish the original operation's outcome. `PRACTICE_RECORD_SAVED`, a draft
checkpoint, and a diagnostic success notification are not substitutes for the
matching completion ACK.

## Controller interface and fences

`ReadingTimingController.freezeAll(passages, owner)` returns a deeply frozen array
of `{ key, snapshot }` values in the requested passage order. Each passage supplies
its explicit context and optional restored draft. A single Reading attempt also
supplies its required passage, even if initial acquisition is still pending.

- The key includes parent attempt (or single session), library configuration,
  exam and sequence index. Cached snapshots from another attempt cannot be used
  by an exam-only lookup. Required passages must have a dataset and explicit
  library provenance; duplicate/missing identities fail before handoff.
- The owner is unique to this preparation. Its `isCurrent()` callback checks the
  page's session, suite, exam, library, parent window, window token and window
  generation after awaits. Controller activation generations also invalidate
  earlier activation and page-restoration callbacks.
- Already acquired required meters freeze before any await. Inactive/restored
  passages and pending acquisitions are then acquired and frozen individually.
  Only this attempt's required entries are saved; historical cached entries are
  excluded.
- Checkpoint saves serialize per entry. The barrier drains earlier writes and
  all final saves, then compares each frozen owned meter with its acknowledged
  persisted snapshot. It returns detached copies of the acknowledgements.
  Payload construction does not reread live meters after the barrier.
- A successful barrier retains timing ownership through handoff and uncertainty.
  `releaseSubmission(owner)` only releases that exact owner. It is used after a
  definite failure or when leaving a confirmed attempt; it does not thaw meters.
  On failure the barrier waits for started sibling saves before releasing.
- Old callbacks can update only their original entry, cannot activate a different
  attempt, cannot clear a newer submission's lock, and cannot publish a stale
  page submission. A stale `pageshow` ownership lookup cannot revoke a newer
  active passage's ownership.

The `ReadingTiming` v1 snapshot schema, writer checks, revision checks and
`sealReadingTiming()` validation remain unchanged. Completion still relies on
the existing atomic practice transaction and immutable completed records.

## Recovery handoff to #294

The implemented recovery transitions, atomic fences and legacy receipt handling
are documented in [Reading suite finalization recovery](reading-suite-finalization-recovery.md).

The phase field is local lifecycle information, not a new durable commit oracle.
The durable sources remain the host's attempt/session and finalization state,
original submission/operation identity, retained drafts, timing journal, and
completed-record transaction/receipt. Existing `finalizing` sessions are not
migrated by #293.

#294 must reconcile those authoritative sources before modifying an already
persisted finalization snapshot. A confirmed commit reuses its existing result;
unknown outcomes retain the original identity and payload. Repair of a confirmed
non-commit must validate complete passage coverage, source, writer and revision
ownership, persist a replacement recovery snapshot safely, and preserve the
original retry identities. This contract does not authorize replaying an invalid
legacy `finalizeRecord`, forcing ownership, or overwriting completed records.

## Focused verification

- `developer/tests/js/readingTimingController.test.js`: held-save interaction,
  frozen acknowledgement equality, initial acquisition, restored inactive
  passages, sibling-write drain, stale attempt callbacks, delayed `pageshow`,
  ownership rejection, pause/resume and acquisition retries.
- `developer/tests/js/readingTimingPersistence.test.js`: real IndexedDB ownership,
  revisions, atomic failures, immutable finalized records and backup restoration.
- `developer/tests/e2e/reading_submission_freeze.node.js`: real production page
  and host, generated bundles, isolated Chromium contexts and real IndexedDB.
  Covers the no-interaction control, #291 question-click race, input/change/drop,
  keyboard/pointer navigation, timer actions, late checkpoints, repeated submit,
  inactive restored passages, a simulated definite controller-save failure with
  editing/retry, and a committed operation whose first ACK is withheld.
- Run the focused script with `READING_FREEZE_EXPECT_BASELINE=1` against the
  unmodified baseline bundles to require successful control and failed race.
  The gate only holds the return of one actual save. It does not change timing
  rows or validation results in either race/control case.
- The unified E2E runner includes this focused regression. Use the normal bundle
  build and `--check`, plus `scripts/verify-diagnostic-release.mjs`, before testing
  the final revision. Reports record the source revision, generated build ID,
  browser version and per-case completed-record/snapshot counts without answers.

The multi-browser/access-mode repeated matrix, #284 optional-sync evaluation,
legacy finalization repair and combined N1/N2/N3 qualification remain #296/#294
work. This static candidate does not include #286's file-journal backend.
