# Diagnostic persistence and lifecycle (A3 / #198)

`AppDiagnosticStore` is the asynchronous sink attached to the main-page reporter
by the foundation bundle. It has no dependency on `AppData.ready`, application
transactions, migrations, backup services, themes or UI startup. Practice entry
points consume these APIs when C1-C3 install their reporters and validated channel.

## Retention and reads

The separate `IELTSAtlasDiagnosticsV1` database contains an `events` object store,
keyed by the originating `eventId`. Every input and every read is revalidated with
the shared allowlist. Diagnostic confirmation never changes business save state.

- Keep at most **7 days**, **2,000 events**, and **2 MiB of serialized UTF-8 event
  payload**, whichever applies first. Database/index overhead is excluded.
- Upsert and trim in the same read/write transaction. Failures with persistent,
  dialog or startup notifications have first priority, followed by classified
  failures and then generic noise. Within a priority, retain the newest events.
  Semantic breadcrumbs stay attached to the retained failure.
- Reporter batches contain at most **20 events**. The store bounds outstanding
  append input to **200 events / 256 KiB**, revalidates before queueing, and returns
  `persistedEventIds` only for records retained by the committed transaction.
- A startup sweep (`ready`) removes expired/over-limit history without waiting for
  another incident. It never creates an absent database. No unload-time writes
  are required. All connections close after their transaction and on versionchange.
- `snapshot({ eventId?, limit? })` and `getIncident(id)` are passive durable reads.
  They do not flush the reporter, run active diagnostics or recreate an absent
  database. Operations are ordered by the lifecycle lock; a snapshot observes the
  committed database at its position in that order. Results are immutable,
  revalidated, oldest-to-newest, and limited to the newest 200 by default, with an
  explicit `truncated` flag. An explicit limit is clamped to 0-2,000. Expired
  records are hidden even between startup/write-time sweeps.

The factory `AppDiagnosticStorage.create(...)` supports isolated database, control
key and lock names, a controlled clock, timeouts and lower retention ceilings for
tests. Production uses the fixed defaults. Factory instances sharing a database
must share the control key and lock name as well.

## Failure and status contract

`status()` exposes `persistence`, `enabled`, `generation`, `cutoff`, `phase`,
`suspended`, `failure`, `coverage`, pending event/byte counts and dropped count.
The reporter includes this under `storage` in its status, snapshots and early
text export. Store `coverage` describes durable access only; it does not upgrade
the event collector's partial application coverage.

IndexedDB unavailability, blocked/timed-out opens, quota exhaustion and failed or
aborted transactions latch a fixed failure code and return `memory-only`. Capture
and bounded current-page export continue. Further reports do not retry database
operations or recursively log storage failures. Late completion of a blocked or
timed-out open closes its handle; its upgrade transaction is aborted so it cannot
recreate a database after a clear/reset.

`await AppDiagnosticStore.retry()` (also available through
`await AppDiagnostics.retrySink()`) first verifies a control-record write/readback
under the lifecycle lock, then tests an IndexedDB read/write transaction with
a temporary put/delete probe. It returns `{ success, status }`. A failed retry
remains latched. A successful retry requeues retained current-generation memory
evidence; it never replays evidence invalidated by clear, opt-out or reset.
`await AppDiagnostics.flush()` then waits for those bounded reporter batches.
The next startup also gets a fresh failure latch. No timers automatically retry.

Web Locks and readable/writable localStorage provide the cross-window lifecycle
barrier. If either capability is unavailable, persistence fails closed to memory
with `COORDINATION_UNAVAILABLE`, including readable storage whose writes throw or
are silently discarded. Startup remains memory-only with partial durable coverage
until the control record is written and read back under the lock, before any
IndexedDB access. This check preserves the lifecycle generation and preference;
a fresh write token detects discarded writes. Fixed-size serialization reserves
room for longer cutoff/phase values so subsequent lifecycle barriers still fit
if other storage fills the origin. Explicit retry repeats this check and cannot
report recovery based on IndexedDB alone. BroadcastChannel and storage events accelerate
status propagation, but correctness does not depend on notification delivery:
every queued operation re-reads the durable control record under the lock.
This is a stated coverage limit for browsers/run modes lacking coordination.

## Clear, preference and relay semantics

```js
await AppDiagnosticStore.setEnabled(false); // opt out and remove retained history
await AppDiagnosticStore.clear();           // remove diagnostics only
await AppDiagnosticStore.setEnabled(true);  // start fresh; do not restore old history
const status = AppDiagnosticStore.status();
const durable = await AppDiagnosticStore.snapshot({ limit: 2000 });
const currentPage = AppDiagnostics.snapshot();
```

These actions acquire the same exclusive lock as writes/reads, publish a fresh
random generation and timestamp cutoff, then delete only the diagnostic database.
The preference and generation survive database deletion. A result reports success
only after deletion succeeds. A blocked deletion stays pending and exposes
`DELETE_BLOCKED`; closing the other handle allows it to finish. Learning data,
application settings, recovery and external backup files are untouched.

Current-page context remains available for immediate feedback/export. Existing
records become `disabled` or `memory-only`; their queued or in-flight
acknowledgements cannot mark them persisted again. Re-enabling also advances the
generation and never backfills that old memory. An event at or before the cutoff,
including an event in the same millisecond as clear, is intentionally excluded.

The additive `persistence.generation` field is either `dg-` plus 32 lowercase hex
digits or `unknown`. A local reporter stamps it at capture. Only its own pre-sink
bootstrap records newer than the cutoff may adopt the initial generation.
**C1 must preserve the originating generation, timestamp, event ID and window ID
after validating the channel.** Unknown/stale-generation relay records are not
persisted; do not restamp them on receipt. This field is a lifecycle fence, not
authentication. Old schema-v1 records without the field normalize to `unknown`
and remain readable as memory/export inputs, but are not eligible for persistence.

## Full reset and backup boundary

`SiteDataReset` retains the existing external-backup lock and prepare/commit/
rollback ordering. After backup preparation, `withFullReset(callback)` acquires
the diagnostic lifecycle lock and publishes a new reset generation before any
database deletion. Previous writes have finished and closed their handles; all
later operations recheck the barrier. The lock remains held through database
deletion, Web Storage cleanup and the external-backup commit.

The reset includes `IELTSAtlasDiagnosticsV1`. Blocked database deletion retains
the existing warning-and-wait behavior; partial failures remain failures and keep
the reset barrier active. Missing diagnostic coordination prevents destructive
cleanup and rolls back backup preparation. No external JSON files are deleted.

Web Storage cleanup preserves only the diagnostic lifecycle tombstone at
`ielts-atlas-diagnostics-control-v1` (the backup service separately preserves its
existing reset epoch). This small record contains no event or learning data.
Removing it would let a surviving/disconnected window mistake the cleared origin
for a fresh one. Surviving windows, and windows opened during reset, stay
memory-only for their remaining lifetime, even after explicit retry. A **new
startup after successful completion** can persist new-generation incidents;
partial reset requires completing/retrying the full reset first.

Ordinary `AppData.backups` and `ExternalBackupService` use the existing learning
catalog and database. Neither the separate diagnostic database nor its control
key belongs to that catalog. Backup/restore cannot include or restore diagnostic
history or diagnostic preference. No diagnostic events are added to AppData.

## Focused validation

`developer/tests/js/diagnosticStore.test.js` uses real Chromium IndexedDB, isolated
browser contexts and a controlled clock for retention, UTF-8 accounting, identity
upsert, concurrent windows, native Web Storage quota exhaustion, denied/discarded
control writes, bounded failures/retry, opt-out/clear races, blocked
deletion, missing notifications, reset generations, late-open cancellation and
learning backup isolation. `siteDataReset.test.js` preserves the existing external
backup failure/rollback assertions and adds diagnostic coordination failures.

`developer/tests/e2e/full_reset_flow.py` exercises the shipped settings reset and a
surviving diagnostic writer. The startup fault suite now observes the installed
real sink instead of attaching a replacement. C4 (#206) continues to own complete
integrated release qualification across all three hosting modes.
