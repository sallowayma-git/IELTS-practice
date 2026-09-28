# Early diagnostic runtime (A2 / #197)

The main page installs the generated collector before its first external resource.
It can capture required resource failures, script syntax/runtime errors and
unhandled rejections without AppData, a theme, MessageCenter, or a diagnostic
database. The regular application reports caught initialization failures before
logging them or invoking optional UI. Native browser exception output is preserved.

## Ownership and downstream APIs

`AppDiagnosticBootstrap.install(options)` is idempotent for a page. The generated
inline payload supplies `AppDiagnosticBuild` and the A1 contract. The foundation
bundle exposes **the same object** as `AppDiagnostics` through `handoff()`; it does
not create another normalizer, move records, or install listeners again.

See [`bootstrapCollector.d.ts`](../../js/diagnostics/bootstrapCollector.d.ts) and
the [A1 contract](diagnostic-contract.md) for the typed interfaces.

```js
const diagnostics = globalThis.AppDiagnostics;
diagnostics.breadcrumb({ action: 'submit', module: 'practice', outcome: 'started' });
const eventId = diagnostics.report({
    code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'submit', error,
    persistence: { operation: 'unconfirmed' }
}); // synchronous ID; no storage or UI promise enters the business operation

// The foundation bundle attaches AppDiagnosticStore without AppData.ready.
await diagnostics.flush();
await AppDiagnosticStore.getIncident(eventId); // passive durable lookup
diagnostics.getIncident(eventId); // passive, retained memory only
diagnostics.snapshot({ eventId });
diagnostics.exportText(eventId); // passive, <= 32 KiB including JSON overhead
```

The canonical record retains the first identity, sequence and timestamp, while a
more specific observation can enrich its classification. Console observations have
the lowest priority, followed by generic runtime observations, classified automatic
failures, and explicitly classified business failures. Equal-priority observations
keep the first record. A later startup/business boundary can therefore correct an
earlier console observation; later generic propagation cannot overwrite its
operation code, resource, cause or notification metadata. Enrichment retains a known
resource location when the later boundary has none. Reporting a caught business
failure before console/global propagation still avoids an intermediate generic record.
Different Error objects remain distinct incidents. Reused Error objects for a new
attempt require A1's explicit `newOccurrence: true`. Object-linked resource errors
share identity between the capture-phase listener and the rejected lazy loader.
Primitive rejections cannot be correlated by object identity.

There is one sink per page. `append` runs asynchronously in batches of at most 20.
The memory map is also the delivery queue; pending batches reference its entries.
At most one batch is in flight, and those entries cannot be evicted until it settles.
Enriched records are queued again under the same event ID, including previously
delivered records. A sink must upsert by identity. An in-flight append confirms only
the revision it received; a newer classification requires its own confirmation.
Both **200 events** and **256 KiB of serialized event payload** are enforced. Old
noncritical entries are evicted before critical entries. A startup incident is pinned
before capacity trimming, including when enrichment grows an earlier console record
or panel rendering must wait for the document body. The displayed incident remains
pinned inside the same limits so its reference can still be exported after a storm.
Each event has A1's 8 KiB cap; separate semantic context
has at most 50 sanitized breadcrumbs. Byte
accounting excludes JavaScript object/database overhead, as in #194.

Throws, rejected or invalid append results stop delivery, retain memory evidence,
and set persistence to `failed`. No automatic retry or recursive incident is
generated. `retrySink()` is explicit; reattaching the same sink does not replay
records or retry failures. `flush()` settles with status, including failure, rather
than rejecting a business operation. A hung sink retains only its bounded batch.
Per-event diagnostic persistence is updated when delivery starts or is confirmed;
business persistence is never inferred from diagnostic writes. Snapshot status
does not claim all evidence is persisted when console evidence remains memory-only.

The [A3 sink/store](diagnostic-storage.md) owns durable retention, reads, opt-out,
clearing, reset and cross-window lifecycle (#198), and is attached automatically
by the foundation bundle. It avoids logging private values or feeding
reporter calls back into itself. Synchronous internal logging is excluded from
capture. Console errors during asynchronous sink delivery remain sanitized in
memory and are not sent back to that sink, preventing asynchronous logging loops.
Explicit business reports during delivery remain queued normally.

A3 supplies per-event persistence receipts and lifecycle notifications. Clear and
opt-out invalidate old queued records and in-flight acknowledgements while keeping
the current-page memory available. `persistence.generation` travels with origin
identity. `storage` in status/snapshots/early export exposes disabled, pending,
memory-only and fixed failure/coverage information; explicit `retrySink()` can
return an asynchronous storage retry result. The standalone A2 sink behavior
above remains compatible when optional lifecycle methods are absent.

## Resources, cancellation and logger compatibility

The generated main-page installation declares required bundles and the main
stylesheet before loading. Decorative resources and optional listening data are
declared optional. The lazy loader declares each element before assigning `src`
or appending it. Declare other controlled resource loads the same way:

```js
diagnostics.declareResource(script, { url: projectRelativePath, optional: true });
script.src = projectRelativePath;
document.head.appendChild(script);
```

Only A1's reviewed project paths enter the registry or events. Opaque resource
events always carry `status: "unknown"`; no HTTP request/probe is made to guess a
status. Required failures during startup use the fallback panel; required failures
after `markReady()` carry persistent-notification metadata for B2. Undeclared
resources retain unknown optionality without an automatic critical panel. Syntax
errors use filename/line/column evidence, including for optional script declarations.

Expected cancellation can be a breadcrumb with `outcome: "cancelled"`, or a report
with `cancelled: true` to override critical notification. Recognized AbortError
rejections, including native DOMExceptions from aborted fetches, are noncritical.
The collector captures the platform's name getter and uses its receiver brand check;
it never invokes a caller-owned name getter to identify native cancellation.
Producers should mark known user cancellation explicitly
instead of relying on browser error text or opaque exception details.

AppLogger's existing methods, scopes, configuration and console display behavior
are retained. Its error capture runs before display filtering. Uncategorised
console calls still reach their native methods, with their original arguments for
local inspection. Diagnostic records contain only normalized Error metadata or a
generic console-error observation, never arbitrary console text/argument payloads.
Logger hydration and native-console failures cannot reject reporting operations.

## Startup fallback and generated integration hook

The startup panel uses plain DOM, inline styles and textContent. It displays an
incident reference, a download action and selectable text. Download failures open
the text fallback. Early head failures wait for DOMContentLoaded once. Rendering
failures get one plain-text attempt, then stop; `exportText()` remains available
without a DOM. The panel never reloads, repairs, clears storage or replays a write.
Large exports keep the selected incident first and set `truncated` when bounded.
This remains the independent minimal early-evidence export. When the
[B1 exporter](diagnostic-export.md) is loaded, the button requests a richer JSON
snapshot for the selected incident, including retained history and status. An
absent/broken exporter leaves this minimal path intact. General settings UI is B3.

Application recovery controls render beside the original page shell, temporarily
hiding it without replacing its views or listeners. Both retry and Safe Mode's
Full Startup restore that shell before running the real initializer. When startup
succeeds, `markReady()` moves the diagnostic panel into normal document flow and
labels it as a retained startup record, preserving exports without covering the
application. A later startup failure reuses the panel as a fixed alert.

The reusable generated payload is
`assets/generated/diagnostics/bootstrap-inline.js`. C2/C3 entry generators should
embed its text in an inline script before external dependencies, followed by:

```js
globalThis.AppDiagnosticBootstrap.install({
    context: 'reading', // or 'listening' / 'legacy'
    requiredResources: ['js/bundles/reading-page.bundle.js'],
    optionalResources: []
});
```

Embed the payload itself: fetching it as an external script loses protection when
that fetch fails. It intentionally does not install until the entry chooses its
context/resource declarations. The practice integration issues own wiring and
coverage. Re-running the payload or installation in the same realm is harmless.

## Reproducible build identity and source locations

`node scripts/build-bundles.mjs` produces the inline payload, homepage block,
bundle metadata and `assets/generated/diagnostics/build-manifest.json` together.
Every bundle containing the diagnostic contract receives the same build stamp
before its sources, including the standalone reading, practice enhancer and
listening entry points. Their exports therefore retain build provenance even
without loading the homepage bootstrap or foundation bundle.
`--check` checks all of them without writing. Application version comes from
`developer/package.json`; build identity is content-derived, independent of runtime
URL cache values, wall clock, Git checkout location and developer machine paths.

Inputs are the normalized **unstamped rendered bundles**, bootstrap contract and
collector, homepage with the generated block replaced by fixed markers, build
recipes, package metadata, main-page styles, vendor script, icon and logo. Text
normalization is the existing builder's LF/trailing-whitespace normalization.
Sorted project-relative path/SHA-256 pairs are hashed again to produce
`sha256:<64 hex>`. Generated stamps and mappings are excluded to break identity
cycles. A relevant artifact change changes identity; running the same build again
produces identical outputs. All events carry the same safe appVersion/buildId.

The manifest contains input hashes and unminified bundle/inline source ranges.
For a location inside a range:
`sourceLine = bundleLine - startLine + sourceStartLine`; columns are unchanged.
Ranges are one-based and include the actual build-stamp offset. Generated footer
and installation lines outside a range remain generated locations. All paths are
project-relative. No private absolute source paths or original browser hosts are
published. No source map is fetched during capture or export.

## Focused verification and remaining scope

```sh
node --test developer/tests/js/diagnosticBootstrap.test.js developer/tests/js/diagnosticBuild.test.js developer/tests/js/diagnosticContract.test.js developer/tests/js/lazyLoaderOptionalListening.test.js
node developer/tests/e2e/diagnostic_startup.node.js
node scripts/build-bundles.mjs --check
```

The browser harness uses shipped bundles in a temporary public-assets fixture and
fresh browser contexts. It exercises missing/invalid bundles, unhandled and caught
initialization rejection, AppData's console-first IndexedDB failure, startup enrichment
near the buffer byte limit with retained lookup/export/sink evidence, native fetch
cancellation, download, native error visibility and healthy startup
under file, HTTP root and HTTP subpath modes. Transient component/network failures
exercise both recovery routes with the real initializer, original DOM identity,
working navigation and retained diagnostics; another case fails a retry before
recovering on the next attempt. CI runs it and retains the JSON report
and panel screenshot. It does not modify a user's learning data.

Full persistence, export/settings, critical business UI, practice-window channel
and entry wiring remain #198–#205. Whole-package diagnostic qualification remains
C4 (#206). JavaScript disabled, process crashes, blocked threads, unopened pages
and unavailable cross-origin exception details retain A1's explicit limitations.
