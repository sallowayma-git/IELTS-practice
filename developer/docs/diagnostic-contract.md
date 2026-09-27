# Diagnostic event contract (A1 / #196)

A2 runtime installation, resource declarations, asynchronous sink behavior and
generated build hooks are documented in [diagnostic-runtime.md](diagnostic-runtime.md).
The additive A2 fields are explicit resource `line`/`column`, the `cancelled`
breadcrumb outcome, and reporter-only `cancelled: true` notification suppression.

This is schema version **1**, implementing the shared contract from #194 and #195.
`js/diagnostics/diagnosticContract.js` installs `globalThis.AppDiagnosticContract`
and exports the same API in CommonJS. It has no DOM, AppData, storage, timer,
logger, or UI dependency. Loading it does not collect anything. The main,
reading, legacy enhancer, listening bridge, and listening wrapper bundles carry
the same source; the A2 bootstrap generator can embed it before dependencies.

The authoritative field/API declarations are
[`diagnosticContract.d.ts`](../../js/diagnostics/diagnosticContract.d.ts).
The executable privacy contract and adversarial cases are in
[`diagnosticContract.test.js`](../tests/js/diagnosticContract.test.js).
[`diagnostic-events.json`](../tests/js/fixtures/diagnostic-events.json) contains
sanitized, deterministic save/quota and unknown-resource examples. These fixtures
are shared inputs for A2 runtime, A3 store, B1 export, B2 UI, and C1 channel tests.

## Producer and boundary APIs

```js
const contract = globalThis.AppDiagnosticContract;
const windowIdentity = contract.createWindowIdentity(); // Retain for this page's lifetime.
const scope = contract.createCorrelationScope();
const normalizer = contract.createNormalizer({
    windowIdentity,
    appVersion: '0.6.3',
    // A2 supplies a content-derived sha256:<64 hex> or git:<40 hex> identifier.
    // Omit it until that build information is available; it becomes "unknown".
    correlationScope: scope,
    environment: { runMode: 'file', context: 'main' }
});
const event = normalizer.normalize({
    code: 'PRACTICE_SAVE_FAILED',
    module: 'practice',
    action: 'submit',
    error: caughtError,
    correlation: { session: sessionId, submission: submissionId, operation: operationId },
    persistence: { operation: 'unconfirmed', diagnostics: 'memory-only' },
    notification: { kind: 'dialog', requiresDismissal: true },
    retry: { available: true, action: 'submit' },
    collection: { source: 'business', coverage: 'partial', aggregation: 'local' }
});
// Only event, never the raw input/caughtError, may enter a queue or buffer.
// Revalidate every durable/relay/export input (including old "normalized" JSON):
const checked = normalizer.sanitizeEvent(untrustedStoredOrRelayedEvent);
// checked is a fresh immutable event, or null for an invalid schema/identity.
```

`normalize(unknown)` is synchronous and returns a deeply frozen, JSON-compatible
event with an event ID even for hostile input. `sanitizeEvent(unknown)` accepts
only version 1 records with consistent event/window/sequence identity; it
reconstructs the complete allowlist, recomputes the fingerprint, and returns null
for invalid records. It does **not** authenticate a source window. C1 must first
validate the registered window, origin, session association and channel token;
opaque `file://` origins alone are insufficient. Tokens never enter this API.
Receiver-local status belongs in the receiver's store/report metadata; forwarding
must retain the originating window, sequence, timestamp and event ID.

## Fields and defaults

| Field | Contract |
| --- | --- |
| `schemaVersion`, `appVersion`, `buildId` | Version 1; bounded release version and content/commit identity, otherwise `unknown`. No timestamp or query-derived build identity. |
| `eventId`, `windowId`, `sequence`, `timestamp` | Generated window nonce plus monotonically increasing sequence; timestamp is milliseconds since the epoch. Identity and timestamp survive observations and relay. |
| `fingerprint` | Non-cryptographic grouping hash of sanitized operation/cause, module/action, error type, first frame and resource. Never an identity or authorization credential. |
| `code` | One of the eight operation codes in #194; invalid/missing codes become `UNEXPECTED_RUNTIME_ERROR`. |
| `causeCode` | Nearest recognized AppDataError code in the root/cause chain: `BACKEND_UNAVAILABLE`, `QUOTA_EXCEEDED`, `CONFLICT`, `CORRUPT_RECORD`, `VALIDATION`, `INITIALIZATION_BLOCKED`, `TIMING_FINALIZED`, `TIMING_STALE_WRITER`, `TIMING_STALE_REVISION`, or `unknown`. Codes on other error names are ignored, including during stored/relayed record revalidation. |
| `error` | Allowlisted type/code, fixed catalog message or `[redacted]`, safe source locations and bounded causes. No `details` payload. `details.cause` alone is inspected for existing AppDataError compatibility. |
| `module`, `action` | Code-owned enums in the declarations. Extend them centrally for a new semantic boundary; never use learner text as a label. |
| `resource` | Exact known project path or `unknown`; safe positive line/column; explicitly supplied HTTP status or `unknown`; declared optionality or `unknown`. Opaque errors never imply 404. |
| `environment` | Coarse allowlisted browser/platform/context/run-mode/online values and a numeric browser version. No raw user agent, location, hostname or referrer. |
| `correlation` | A scope reference and kind-specific opaque aliases, never original business identifiers. |
| `persistence.operation` | Explicit `committed`, `not-committed` or default `unconfirmed`. An Error's `committed` field is not treated as proof. |
| `persistence.diagnostics` | `memory-only` by default; `pending`, `persisted`, `disabled` or `failed` as confirmed by the diagnostics runtime/store. Independent of business save state. |
| `persistence.generation` | Additive A3 lifecycle fence: `dg-` plus 32 lowercase hex digits, or `unknown`. The reporter stamps local events; validated relays retain the originating value. Only the current generation can enter persistent storage. See [storage semantics](diagnostic-storage.md). |
| `notification` | Presentation kind and explicit-dismissal flag; no free-form UI content or callback. Default is `none`. B2 owns prioritization/queueing. |
| `retry` | Availability, semantic action and original operation/submission aliases. Availability requires an operation alias and a known retryable action; executable retry/idempotency logic stays in a separate live runtime registry. |
| `breadcrumbs` | Only known semantic actions such as submit/handshake/storage confirmation, with timestamp, outcome and aliases. No keystrokes or arbitrary DOM interactions. |
| `collection` | Source, coverage, aggregation, redaction version, fixed coverage limitations and bounded issue markers. Unknown coverage is never silently upgraded to complete. |

## Privacy and work limits

This contract intentionally uses **default-deny free text**. Removing URL queries
with a regex cannot distinguish an unlabeled answer, note, imported document or
token from an ordinary exception message. Therefore arbitrary messages, error
names, function names, console arguments, DOM text, payloads, answers, passages,
notes, clipboard/import contents and validation tokens are never copied.
Only an exact catalog message survives. UI copy can use `MESSAGES[event.code]`;
diagnostic evidence comes from stable codes, safe locations, and semantic context.
Add reviewed fixed message templates centrally if needed; do not add a raw-text
escape hatch, including in detailed mode.

Locations retain only exact paths listed in `PROJECT_PATHS`. Hosts, usernames,
absolute filesystem prefixes, unknown filenames, query strings and fragments
cannot survive. Both main and nested cause stacks receive the same treatment.
All hosts are omitted, including public hosts. Extend the code-owned path list
when needed; do not populate it from a URL, import, console argument or payload.
Browser stacks retain terminal line/column positions appended after the complete
script URL, including version queries and fragments. The URL is then stripped of
its query/fragment before path validation. Plain resource URLs never derive a
position from query/fragment text, and neither input can derive a project path
from that text.

Limits apply before buffering:

| Limit | Behavior at the limit |
| --- | --- |
| 8,192 UTF-8 bytes of `JSON.stringify(event)` | Drop oldest breadcrumbs first, then excess stack detail if necessary. Preserve identity, first-frame fingerprint inputs, codes and status. Includes JSON keys/escapes; no character-count approximation. |
| 20 stack frames **across the event** | Root frames take priority over cause frames; mark `stack-truncated`. |
| 3 cause links beyond the root | Mark `causes-truncated`; cycles become `kind: "cycle"` and `cause-cycle`. |
| 50 semantic breadcrumbs | Inspect only the last 50 input slots and keep recognized semantic actions. Mark `breadcrumbs-truncated` for larger inputs. |
| 8,192 UTF-16 units per scanned input string | Drop the whole oversized string and mark `input-truncated`; never scan a cut URL suffix. |
| 1,024 identifier associations per correlation scope; 512 units per identifier | Retain existing associations; new/oversized identifiers become `unknown`. No silent eviction or change of an existing alias. |

Objects are read by a fixed set of own-property descriptors; error names may
additionally inspect up to four prototypes. Accessors, `toJSON`, coercion hooks
and arbitrary object enumeration are not used. Proxy descriptor/prototype traps
can run as a consequence of JavaScript reflection, but exceptions are caught and
the number of reflection operations is bounded. As with any synchronous in-page
code, a non-returning proxy trap/blocked thread cannot be recovered by this module.
Accessor-backed stacks are skipped rather than invoked. Such missing evidence is
marked `accessor-skipped` or `unreadable`. BigInt and non-JSON primitives become
explicit `kind` markers without coercing their contents. DOM references are never
traversed; detectable own `nodeType` values produce `kind: "dom"`, others retain
an opaque `object`/`unknown` marker. A defensive failure yields a minimal event
with `normalization-failed`, without logging or recursively reporting the failure.

## Identity, repetition and correlation lifetime

The normalizer associates Error-like object references with event identities in a
WeakMap. The same exception observed at business, console, global and storage
boundaries retains its event ID. A wrapper linked through an already observed
`cause` or `details.cause` can reuse that ID. Both identity and error normalization
prefer a non-null `cause`, otherwise inspect `details.cause`, with the same depth
and cycle bounds and without invoking accessors. Independent Error objects get
independent IDs even when their fingerprints match. Primitive rejection values have no object
identity; capture once and pass the normalized event through other boundaries.

Create one `windowIdentity` handle per page lifetime and share it between bootstrap
and runtime normalizers, including normalizers created for later practice sessions.
This retains the window nonce, sequence and Error associations across the A2
handoff. Omitting it creates a new origin context. A serialized lookalike handle
cannot share live identity state; remote observations use `sanitizeEvent` instead.

Call `normalize({ ..., newOccurrence: true })` when reusing an Error object or a
shared cause for a **new operation attempt**. This makes a new identity for the
outer error without rebinding a shared underlying cause. Do not set this flag for
an ordinary propagation observation. Across serialization boundaries, use
`sanitizeEvent`, not `normalize`, to preserve origin identity. A2 owns the
identity-keyed canonical record and must avoid replacing a known business
operation with a later generic console/global observation.

Every canonical event represents one occurrence (`repetitionCount: 1`). A2/A3
upsert by `eventId`; they must not drop distinct events by fingerprint. B2 can
aggregate notifications for the same fingerprint within **60 seconds**, counting
unique event IDs, not observations. The `RepetitionGroup` interface carries these
IDs and a separate count; aggregation never merges or rewrites retained events.
Fingerprints can collide; they are only a UI grouping hint.

Create a correlation scope for a practice/suite session and share it among
bootstrap/runtime normalizers in that realm. The registry retains bounded raw
identifier-to-random-alias associations **only in private, short-lived memory**;
original text never enters an event, sink, transport payload or export. It uses
random aliases rather than guessable unkeyed hashes of identifiers. Call
`scope.dispose()` when the session ends or diagnostics context is reset. For a
long-lived page, start a new scope/normalizer at the next session; do not exhaust
one scope across unrelated practice sessions.

The validated host handshake supplies `event.correlation` (only aliases) to a
practice window. The child supplies that object as `correlationAliases` on new
events/breadcrumbs, retaining the host's scope and kind-specific aliases while
generating its own window/event identity. Future new operation IDs need aliases
from the same scope authority before a correlated diagnostic is produced. Do not
re-alias the alias text independently in another page. Durable or relayed events
already contain aliases and preserve them when revalidated. A full page/session
restart starts a fresh scope unless the host deliberately restores the original
alias association through its validated session lifecycle.

## Downstream interfaces and failure isolation

The declarations publish `DiagnosticReporter`, `DiagnosticSink`, `IncidentReader`,
`Snapshot`, `SnapshotQuery` and `RepetitionGroup`; A1 supplies the normalizer, not
the A2/A3 collector/store implementations.

- `report(input): string` normalizes **synchronously**, inserts only the immutable
  result into the bounded memory buffer, schedules asynchronous work and returns
  `eventId` immediately. Do not close over raw input in queued promises/tasks.
- `DiagnosticSink.append(events): Promise<{ persistence }>` performs
  identity-keyed asynchronous upserts. A2 catches throws/rejections, retains safe
  memory evidence and updates diagnostic persistence status; it never calls
  `report` recursively for a sink failure. `flush()` exposes the resulting status.
- `getIncident(eventId)` is passive: synchronous in the memory reporter,
  asynchronous in the durable sink. Missing/expired IDs return null.
- `snapshot({ eventId?, limit? })` is a passive immutable copy. Default/max memory
  page size is 200 events; its `truncated`, `coverage`, and `persistence` fields
  state limitations. Durable history pagination/retention is A3/B1 work. Snapshot
  construction cannot run `SystemDiagnostics`, probes, repairs or business writes.
- Revalidate records before transport/export and on store reads. Every event
  remains bounded; enclosing batches/snapshots also need A2/A3/B1/C1 total limits.
- Store only retry metadata. The live registry holds the original operation IDs
  and safe action closure; B4 performs commit-state reconciliation/idempotency
  checks. Diagnostics never invokes a retry, reload, reset, close or write replay.

The fixed coverage limitations are JavaScript disabled, a page never opened,
process crashes, a blocked main thread and inaccessible cross-origin details.
Partial child aggregation is explicit. Build provenance, listeners, AppLogger
interception, storage, UI, export, channel validation and integrated three-mode
fault injection remain with A2 through C4.

## Focused validation

```sh
node --test developer/tests/js/diagnosticContract.test.js
node scripts/build-bundles.mjs --check
```

The tests exercise actual AppDataError objects with independently enumerated
producer codes, exclusion of codes on unrelated errors, Chromium/Firefox stack
positions with versioned URLs, hostile/cyclic/oversized fixtures, all exclusion
categories, resource uncertainty, UTF-8 accounting, 20-frame and 3-cause budgets,
identity through native and AppDataError cause links versus repetition, alias
scope/capacity/disposal, frozen memory values, persistence/relay/export
revalidation, and shipped bundles.

Validation on 2026-09-27: 22 focused diagnostic tests passed; the complete
JavaScript unit/regression command passed 408 tests; Python unit discovery passed
32 tests; `build-bundles.mjs --check` confirmed all 14 shipped outputs are current.
Integrated collector/store/UI/channel release qualification remains assigned to C4.
