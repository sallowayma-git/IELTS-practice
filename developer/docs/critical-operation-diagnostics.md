# Critical operation boundaries (B4 / #202)

The main page uses `AppOperationDiagnostics` from `runtime-entry.bundle.js` to
connect business outcomes to the existing reporter and persistent incident UI.
It captures before presentation, returns the originating event ID synchronously,
and isolates reporter, breadcrumb, lookup and presentation failures. It does not
await `AppData.ready`. The adapter never invokes a business action automatically.

| Boundary | Evidence and presentation |
| --- | --- |
| Startup | Existing bootstrap failure panel and export remain authoritative; initialization adds semantic start/success context. |
| Required lazy loads | Reuse the early resource Error identity, retain the known resource path and unknown HTTP status, and report a persistent failure. A 15-second deadline also catches scripts that never settle. Optional listening assets are declared before insertion and stay non-critical. |
| Single practice | Recorder and host check explicit commit receipts; the host reports only after its existing fallback. Storage confirmation, host receipt and acknowledgement dispatch are distinct breadcrumbs. |
| Suite persistence | Aggregate and recovery failures retain their Error identity through result objects. Durable recovery receipts are required before claiming a snapshot was saved; window-mirror failures distinguish an already confirmed durable copy. |
| Draft/recovery writes | Reject unsuccessful receipts, preserve the underlying AppDataError cause, and retain the existing write/cleanup ordering. No success message is emitted for an unconfirmed snapshot. |
| Import/export | Capture file read/parse failures, storage exceptions, unsuccessful interactive disk results, and download/Markdown failures. Explicit selection/restore cancellation is non-critical. Background disk flush policy is unchanged. |

The existing `AppDiagnostics` normalizer owns all redaction, aliasing and bounds.
Only module/action enums and session, suite, submission and operation identifiers
are supplied as context. Answers, notes, file contents, filenames, validation
tokens and complete records are never diagnostic arguments. Error objects pass
through the existing allowlist; their messages and details are not copied as raw
text. `acknowledgement` is an additive semantic action in schema version 1.

## Business evidence and uncertainty

`AppData.getOperationFailureState(error)` exposes page-local evidence associated
with exceptions from `practice.completeAttempt`, `practice.finalizeSuite`,
recovery saves and `backups.commitImport`. A WeakMap retains no strong Error
references. A receipt with `committed: true` remains authoritative if a later
read or mirror fails. A pre-write failure or a definite rejected transaction is
`not-committed`; a deadline expiry or an unknown outcome is `unconfirmed`.
Arbitrary `Error.committed` fields are not evidence. Business results and thrown
exception identities are unchanged by this bookkeeping.

The recorder retains committed or unconfirmed evidence across its existing
attempts, including when the host defers reporting. Weak Error associations carry
that evidence into the host fallback without changing the thrown Error. The host
combines it with the fallback's facade outcome: a confirmed commit wins, an
uncertain attempt remains uncertain, and only definite failures throughout the
chain are not-committed. A later failed attempt cannot disprove an earlier commit.
Known committed failures cannot offer reconciliation or send a negative submission
acknowledgement. Existing completion gates and session cleanup remain unchanged.

Successful receipts also reach the host through the optional `onCommitReceipt`
observer in the recorder, its standardized retry and the host fallback. Only a
validated `committed: true` receipt supplies this evidence; a returned record by
itself does not. The observer is failure-isolated and does not change record
return values. Final host readback errors retain their original Error identity
and cause. If readback throws or cannot verify the record after a known commit,
the incident remains committed without reconciliation or a negative ACK, while
completion still returns false and retains the host session and reading draft.

Multi-suite failures are retrieved and cleared using the base exam ID, matching
the session map. The suite and host report the same original Error and event.
Import wrappers defer to facade evidence until they obtain a commit receipt;
post-commit failures retain the explicit committed state. File read and JSON
parse failures remain explicitly not-committed.

An ACK dispatched by `postMessage` does not prove that the child received it.
Failed dispatch, a closed target and dispatch exceptions all use the
`acknowledgement` action and produce a persistent channel incident, without a
blocking save dialog. The channel outcome remains unconfirmed; the existing receipt
cache and replay retain the original session/submission IDs. B4 does not change
child acknowledgement logic, receipt expiry, window closure, navigation or
session cleanup. Child-local reporting and the validated diagnostic channel
remain C1–C3 work.

## Safe confirmation retry

`AppData.practice.getCommitState(operationId)` is a read-only query of the existing
operation journal. It returns:

```js
{ verified: true, operation: 'committed' | 'unconfirmed', operationId }
```

Only a retained, matching committed receipt confirms the operation. An absent
receipt stays unconfirmed because journal retention can remove it. The query
does not recreate a record, write the journal, send an ACK, clear a draft, or run
session cleanup. Storage read failures reject and remain unconfirmed in the UI.

Unconfirmed single/suite saves can supply this query as the notification's retry
callback. The existing IncidentCenter binds it to the captured operation and
submission aliases and permits one live attempt at a time. Historical evidence
is immutable; a verified retry result updates only the live presentation.
Unsupported recovery/import retries are absent. No diagnostic action replays a
write. Existing business retries continue to use the original operation ID, and
single-practice normalization now preserves submission/operation IDs for that
purpose.

Diagnostic export is deliberately excluded from this adapter. It continues to
use the exporter's own bounded text fallback, preventing recursive incidents.

## Validation

```sh
node --test developer/tests/js/operationDiagnostics.test.js
node developer/tests/e2e/operation_diagnostics.node.js
node --test --test-concurrency=1 "developer/tests/js/**/*.test.js"
node scripts/build-bundles.mjs --check
```

The focused browser fixture uses real IndexedDB in file, root HTTP and subpath
HTTP modes. It injects quota errors, transaction aborts, backend failures and
timeouts; exercises recovery/import/export failures, post-commit read failures,
lost receipts, read-only reconciliation and a broken reporter; and verifies
incident references and privacy. Full release qualification remains #206.

The review regressions additionally exercise the real host-to-recorder fallback,
host-to-multi-suite completion, all ACK failure branches, and the public
`restorePayload`, `restoreFromLatest` and file-picker import boundaries. Quota
rejections, uncertain timeouts and post-commit failures are separate cases. HTTP
fixtures use an isolated OPFS directory; file-mode fixtures stand in for the
directory handle because file URLs cannot access OPFS. Business and binding
metadata transactions still use real IndexedDB in all three modes.

Final-readback regressions let the real recorder or recorder-absent fallback
return normally before injecting a backend read failure. They assert the original
Error and cause, committed receipt and journal, persistent non-blocking incident,
no reconciliation or negative ACK, one write, and unchanged completion/cleanup
gates. Unit cases also cover successful standardized retries and host fallbacks
after recorder rejection, missing readback records, and records with no receipt.

Original B4 validation on 2026-09-28 against prerequisite B2 `f7a3421d`:

- 539/539 JavaScript tests, including 17 focused operation-boundary tests.
- 35/35 Python unit tests.
- 27/27 operation, 48/48 startup, 63/63 notification and 27/27 export browser
  scenarios across the three hosting modes.
- Suite-practice and full site-data reset browser flows passed.
- All 14 shipped bundle outputs and generated diagnostic artifacts are current.
- The static runner passed 136 checks. Its two remaining failures (the existing
  `css/vocab-reader.css` allowlist mismatch and existing v2 storage-boundary
  allowlist violations) match B2 `f7a3421d`, ignoring shifted source line numbers.
  No new guard violations were introduced.

The initial PR #215 review corrections additionally passed 545 JavaScript tests (23 focused
operation tests), 35 Python unit tests, 69 operation browser scenarios and 63
notification scenarios. All 14 bundle outputs and generated diagnostic artifacts
match the corrected sources; whitespace checks and the suite-practice browser
flow pass.

The final host-readback correction passed 551/551 JavaScript tests (29 focused
operation tests), 75/75 operation browser scenarios, the suite-practice browser
flow, all 14 bundle drift checks and whitespace validation. Its six new unit
regressions and real-AppData final-readback reproduction failed before the fix.
