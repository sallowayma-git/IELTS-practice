# Reading suite finalization recovery

Implementation scope: #294, based on #293's
[submission state contract](reading-submission-state-contract.md).
The integration baseline is `d368c68bcd8eb75a810e3b5a17fc0d70b7bc388d` on
`opensource`. #295 owns rejection-reason taxonomy; #296 owns the combined
browser/access-mode and optional-sync qualification.

## Reconciliation and transitions

The completion identity remains `practice-suite:<suite id>:finalize`. The suite
ID remains the record/attempt ID. Recovery does not create another attempt to
escape a rejected writer or transaction.

`AppData.practice.getSuiteCommitState(recordId, operationId)` reads all three
practice layers, the operation journal and entity revision/deletion history in
one IndexedDB transaction. Unlike the older positive-only `getCommitState()`,
this read can establish definite non-commit from the complete record history.

| Authoritative state | Required evidence | Supported transition |
| --- | --- | --- |
| `committed` | All record layers exist and retain the original operation identity. Later annotation operations may differ; the detail retains the completion identity. | Reuse the saved result. Do not rewrite facts, annotations, timing or review plans. |
| `not-committed` | All layers are absent, all tracked revisions for this record are zero, and the original operation is absent from the journal. | Validate and atomically prepare the retained finalization, then complete using the original operation. |
| `unconfirmed` | Partial layers, deletion history, journal-only evidence, inconsistent identity, or an unavailable authoritative read. | Preserve recovery and investigate/reconfirm. Do not prepare another completion. |

A missing journal receipt alone remains insufficient evidence. Corrupt records
are not silently filtered into an absence result. A failed repair transaction
performs another authoritative reconciliation: if a competing completion won,
its committed result is returned instead of reporting a stale non-commit.

For the live suite operation, `practice.finalizeSuite()` also reconciles on each
transaction retry. A repeated confirmation cannot rewrite an existing completed
record or repeat review scheduling. Historical/imported suite projection writes
retain their existing interface; the new live-submission behavior is scoped to
the canonical suite finalization operation.

## Replacement snapshot and concurrency

`AppData.practice.recoverSuiteFinalization()` consumes the durable
`suite-session-v2` finalizing session, including pre-fix snapshots. It validates:

- The original suite, record and operation identity, complete ordered passage
  coverage and unique passage timing identities.
- Retained answers, comparisons, scores, annotations and aggregate answers.
  Conflicting retained values are rejected instead of choosing a convenient copy.
- Explicit library provenance, exam, parent attempt and sequence index.
- The original timing writer, revision consistency and monotonic timing coverage
  and totals. A persisted snapshot newer than every retained submission snapshot
  is rejected. Missing or finalized live timing rows are rejected.

The replacement uses the latest compatible retained timing, freezes it without
adding elapsed wall time, and advances its revision. One transaction replaces
the active-session snapshot and its timing rows. The transaction checks both
document revisions and repeats the authoritative non-commit test. Therefore a
concurrent writer, late original completion or another repair either wins before
this transaction or causes it to abort. Partial replacement is impossible.

Prepared timing rows carry `finalizationOperationId`; acquisition and checkpoint
writes cannot reopen them. The session carries `finalizeRecoveryVersion: 1` and
the exact replacement record/results/drafts. Retrying a prepared session checks
that the rows still match. Ordinary suite recovery writes reject older revisions
and changes to an accepted finalization. A late checkpoint cannot resurrect an
attempt that already has a completed record.

The old durable snapshot is retained until the replacement transaction commits.
Failure while saving that replacement rolls back both documents. Failure in the
completion transaction retains the prepared snapshot, frozen timing and all
answers for another supported confirmation. Unrelated sessions, drafts and
practice records are preserved. Finalizing-session abandonment reconciles first
and carries a non-commit fence; unknown outcomes cannot be discarded through
the recovery dialog.

## Host, practice page and diagnostic UI

The existing unfinished-suite dialog labels terminal recovery **恢复并确认提交**.
Host reload restores the durable session and uses this action to reconcile and
repair it. An incident's retry action enters the same gated path. A successful
recovery checkpoint is not reported as completed practice; the completion
notification follows a verified completed-record commit only.

Practice reload receives a finalization descriptor in the authenticated host
initialization envelope before timing activation. It displays retained answers
in a locked view and does not acquire another writer. Its **恢复并确认提交** action
uses the existing `SIMULATION_SUBMIT` channel with `recoverFinalization: true`;
the response is `SUITE_RECOVERY_OUTCOME`, bound to the registered window, suite,
operation and retained submission ID. It reconciles the original operation and
does not submit newly edited answers. Failure and timeout keep the view locked
and the recovery action available. Only a matching committed response enters
the submitted state.

New snapshots persist `finalizeSubmissionId`. Pre-fix snapshots omitted it: a
still-open page may supply its original receipt ID when reconfirming; host-only
or reloaded-page recovery leaves a missing ID absent. It never manufactures a
replacement submission ID. A known original ID cannot be replaced. This legacy
limitation does not alter the durable attempt, record or operation identities.

Outcome values remain `committed`, `not-committed` and `unconfirmed`. They use the
existing operation-diagnostics contract and do not add raw IDs, writer tokens,
answers or annotations to diagnostic events. #295 can extend bounded rejection
reasons without changing the recovery state machine.

## Verification and evidence

- `developer/tests/fixtures/suite-finalizing-pre-fix.json` is a persisted,
  synthetic three-passage fixture with answers, highlights, notes and an unfrozen
  third-passage revision ahead of its durable checkpoint. It intentionally has
  no submission receipt ID, matching the old format.
- `developer/tests/js/suiteFinalizationRecovery.test.js` uses real IndexedDB.
  It covers host reload, duplicate/concurrent confirmation, original identities,
  writer takeover, finalized/source/revision/content conflicts, unknown/deleted
  outcomes, both transaction failures and later retry, interleavings immediately
  before replacement, and a committed transaction whose return was lost.
  Comparisons verify unchanged unrelated data and immutable completed layers,
  annotations and review plans after reconciliation.
- `developer/tests/e2e/reading_submission_freeze.node.js` runs production
  bundles and real file entrypoints. Its recovery scenarios durably seed the
  old unfrozen/advanced snapshot shape before letting the normal seal reject it,
  then use the visible host or practice-page action after reload. They assert
  the original record/operation/submission identities, retained answers and
  exactly one completed record with matching frozen timing rows.

Run the normal JavaScript/Python/integration checks, regenerate bundles, then
run `node scripts/build-bundles.mjs --check` and
`node scripts/verify-diagnostic-release.mjs`. The PR records the exact signed
tested revision and generated build ID. The full repeated Chrome/Edge matrix
and optional #284 transport evaluation remain #296. This baseline does not
include #286's file-journal backend.
