# Passive diagnostic exports (B1 / #199)

`AppDiagnosticExport` provides read-only incident lookup, snapshots, JSON downloads
and compact text summaries. It is shipped in the foundation, reading, practice
enhancer, listening bridge and listening wrapper bundles. It does not load or
instantiate `SystemDiagnostics`, whose constructor starts active checks. It has
no dependency on AppData, themes, settings UI, or a connected main window.

**Diagnostic reports help investigation and are not answer backups.** They exclude
answers, passages, notes, clipboard contents, imported contents and business
payloads. Reports remain local until a user chooses to share them.

## API for notifications, settings and practice integrations

```js
const report = await AppDiagnosticExport.snapshot(); // retained history + page memory
const incident = await AppDiagnosticExport.getIncident(eventId); // event or null
const contextual = await AppDiagnosticExport.snapshot({ eventId });
const { json, text } = await AppDiagnosticExport.exportJSON({ eventId });
await AppDiagnosticExport.download({ eventId });
await AppDiagnosticExport.copySummary({ eventId });

// Optional existing textarea for a notification or settings detail panel:
await AppDiagnosticExport.copySummary({ eventId }, { textTarget: textarea });
```

The authoritative declarations are
[`diagnosticExport.d.ts`](../../js/diagnostics/diagnosticExport.d.ts).
`create({ reporter, bootstrap, store, context })` supports an explicitly supplied
passive reader and practice context. Readers need only implement `snapshot`;
sync and async readers are supported. The default API observes `AppDiagnostics`,
`AppDiagnosticBootstrap.current()` and `AppDiagnosticStore` when called, so it
also works before or after reporter handoff. A shared bootstrap/reporter is read
once. The new bootstrap `current()` API never installs a collector or listeners.
Exporter loading itself does not start collection, persistence, or transport.

C1-C3 own practice collector installation and validated cross-window transport.
Until then, a practice bundle can export available local readers and explicitly
reports missing sources; having the API is not proof that the page was instrumented.
An integration may supply `context: 'reading'`, `'listening'`, or `'legacy'` even
when no incident has yet been captured. B2/B3 own the general details/settings UI;
the existing startup panel already uses richer JSON export when it is available.

## Snapshot selection, identity and limits

Each export reads page memory/bootstrap and the durable store independently. It
does not flush pending writes, retry persistence, change preferences, clear logs,
run repairs, probe resources, open/close practice windows, reload, tear down
sessions, or send telemetry. Source snapshots are not one atomic cross-window
transaction. Re-export does not rewrite incident or business history.

Records are merged by originating `eventId`, with the collector's classification
priority. A more specific business observation wins over a generic console/global
observation; current memory wins equal-priority ties. An older durable revision
cannot acknowledge a pending memory enrichment. Window IDs, sequences, original
timestamps and safe correlation aliases survive. Conflicting timestamps for the
same identity are flagged. There is no fingerprint-based incident deduplication.

History selection prefers recent retained timestamps, up to 2,000 records.
Incident selection pins the selected event and includes up to 50 other events:
matching session/suite/submission/operation aliases within the same correlation
scope (including semantic breadcrumbs), then at most ten preceding/following
sequence positions in its own window.
An absent/expired or invalid incident reference returns no unrelated history.
`limit` can lower these bounds (an incident always reserves its own slot).
Every event retains its bounded semantic breadcrumbs and safe cause/stack detail.

The displayed timeline groups by originating window and sorts by per-window
sequence. Cross-window clocks are not synchronized, and the report explicitly
does not claim exact global or causal order. Correlation aliases link windows
without exposing business identifiers or validation tokens.

The enclosing compact JSON, including metadata and timeline, is capped at **2 MiB**;
individual events retain the contract's **8 KiB** cap. Input reads are capped at
200 events / 256 KiB for each page reader and 2,000 / 2 MiB for durable storage.
An 8 KiB summary includes the selected incident first and at most twelve event
lines. Truncation, rejected records, missing/failed/timed-out sources and storage
drops are explicit. Invalid older schema versions are rejected, not guessed.

## Privacy, provenance and status

Every event, including older retained schema-v1 records, passes through
`sanitizeEvent` again at export time. Snapshot metadata, storage status, queries
and source status also use explicit allowlists. Caller getters, arbitrary fields,
free-form error text and failure exception messages never enter JSON or text.
Build metadata is revalidated from the generated content-derived build identity.
Environment includes only coarse context/run mode, browser/version, platform and
online state; raw user agents, URLs, hostnames and local paths are excluded.

Reports distinguish source availability, memory evidence, pending persistence,
disabled storage, storage failures and operation save state. Diagnostic persistence
never proves that answers were saved. The report's storage state is the durable
snapshot's state when available; memory status is the fallback. An unavailable
durable read is reported as memory-only even if a record had previously been
confirmed persisted. Per-event states preserve their sampled source confirmation.

Collection coverage is partial and aggregation is incomplete. Disconnected
practice windows explicitly report `connection: 'disconnected'`; an open opener
is merely `unverified`, not proof of complete aggregation. The fixed browser
coverage limits, retained-context limitation and independent source snapshots are
included. No handshake or network/window probe is issued by export.

## Delivery failures

Each source read and clipboard operation has a 3-second deadline. Failed reads
leave available page context exportable. Late reads cannot mutate a returned report.
JSON generation failure returns bounded fixed text without logging/reporting itself.
`exportJSON` returns `ready` or `fallback`, with `{ report, json, text }`.

`download` returns `download-started` only after the local anchor click; browsers
do not provide proof that the user saved a file. Blob/object-URL/click failures
return `text-fallback` and focus/select a read-only textarea. Temporary links and
object URLs are released. `copySummary` similarly returns `copied` or
`text-fallback`; it never reads clipboard contents. DOM failure still returns the
bounded `text` to the caller, with `selectable: false`.

The startup panel's export button uses this richer incident export when loaded.
Its original independent minimal `exportText`/text download remains available
when the exporter bundle is absent or the richer action throws. Startup details
remain available before storage, complete UI, or application initialization.

## Focused validation

```sh
node --test developer/tests/js/diagnosticExport.test.js
node developer/tests/e2e/diagnostic_export.node.js
node developer/tests/e2e/diagnostic_startup.node.js
node scripts/build-bundles.mjs --check
```

Unit tests cover hostile retained data and metadata, identity merging, correlated
context, limits, deadlines, source/status failures, clipboard/download/DOM/export
fallbacks, passive side-effect spies and startup handoff. The Chromium export
matrix uses real IndexedDB and downloaded files in file, root HTTP and subpath
HTTP modes. Final integrated release qualification remains with C4 (#206).
