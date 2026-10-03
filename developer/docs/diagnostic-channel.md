# Validated diagnostic channel (C1 / #203)

`AppDiagnosticChannel` is a local, one-hop `postMessage` protocol. It does not use
practice completion, error, submission or persistence acknowledgement handlers.
There is no remote telemetry. Diagnostics remain separate from learning data.

## Host integration

`examSessionMixin.setupExamWindowCommunication` creates one diagnostic receiver
per current registration. It reserves `IELTS_DIAGNOSTIC_V1` before business
normalization, rejection logging, origin compatibility fallbacks or session
mutation. Single practice, suite windows and reused windows use this same entry.
`PracticeCore` and `PracticeRecorder` also exclude the reserved envelope from
business normalization. A diagnostic receipt never updates save confirmation,
submission identifiers, suite navigation, ready state or cleanup state.

Each receive rechecks the registered **WindowProxy by exact identity**, expected
origin, session ID and window token. File origins require both the explicit opaque
origin policy and the registered source/token/session; `null` by itself confers
no trust. HTTP and subpath hosting use the exact origin with no wildcard. The
existing business same-window-name/URL compatibility exceptions do not apply.
Replacement registration, window, token or session revokes the previous channel.
Cleanup disposes its receiver; repeated setup disposes the old receiver first.

The host factory accepts `getBinding()` so it checks current ownership for every
message. It does not install a second message listener or create registrations.
All invalid/reserved input is silently consumed without retaining or logging the
untrusted payload. Construction, parsing, capability and reporter failures are
isolated from practice operations.

## Child installation contract for C2/C3

The factory is shipped in the reading, listening wrapper, listening bridge and
legacy enhancer bundles. C2 (#204) installs the early collector, shared reporter,
store, exporter and transport in the maintained unified reading entry; see
[reading and suite diagnostics](reading-suite-diagnostics.md). Listening runtime
installation remains with C3 (#205). Controlled pages use this hook:

```js
const reporter = AppDiagnosticBootstrap.install({ context: 'reading' }).handoff();
reporter.attachSink(AppDiagnosticStore);
const transport = AppDiagnosticChannel.createChild({ reporter, store: AppDiagnosticStore });

// Call only after the runtime's source/origin/session/INIT validation succeeds.
transport.connect({
    window: trustedParentWindow,
    origin: validatedParentOrigin, // exact HTTP(S) origin or 'null'
    allowOpaqueOrigin: location.protocol === 'file:' && validatedParentOrigin === 'null',
    sessionId: validatedSessionId,
    windowSessionToken: validatedWindowToken
});
```

These binding values belong exclusively to the transport's private control state.
Never pass the token or complete INIT/business payload to `report`, breadcrumbs,
errors or exports. Use the A1 correlation aliases for business context. C1
preserves existing correlation aliases; it does not derive correlation from raw
tokens or change the runtime's session handshake.

`createChild` is idempotent per reporter until disposed. It subscribes **after local
capture**, includes bounded pre-connect memory, and observes local originating
events only. A changed binding drops its old relay queue and starts a new channel;
it never relabels old-session evidence. The originating memory remains available.
Repeated identical INIT does not restart exhausted attempts. `pagehide` disposes
listeners, timers and references; `dispose()` is also available to runtime owners.

## Envelope and bounds

The envelope has exactly these own primitive fields: `type`, `version`, `kind`,
`sessionId`, `windowSessionToken`, `connectionId`, `channelId`, `windowId`, `batch`,
`hop`, and `payload`. `version` and `hop` are both 1. The token is a control
credential outside the sanitized event JSON in `payload`. The protocol accepts
structured objects only, without arbitrary field coercion or accessors.

A child-generated random connection ID and host-generated random channel ID form
a hello/ready challenge. Event batches must match both IDs and the window identity
announced during that handshake. A host reload has no old challenge state. A new
child hello issues a fresh challenge, rejecting batches from the previous page.
Neither endpoint can use stale ready/ACK responses for another binding or batch.
This is a best-effort protocol: until a replacement page announces itself, already
queued messages from the same WindowProxy cannot be distinguished from its old
page. Session/token replacement and store lifecycle fences still apply on every
receive. No cross-origin document inspection is required.

| Resource | Limit |
| --- | --- |
| Complete UTF-8 serialized envelope | 72 KiB, including outer JSON escaping |
| Event | A1 limit of 8 KiB; revalidated at both ends |
| Batch | At most 8 events, reduced further to fit the envelope |
| Child forwarding queue | 200 events / 256 KiB, plus one immutable in-flight batch |
| Concurrent batches | One |
| Hello attempts / event-batch attempts | Three each, 500 ms apart |
| Ready responses / duplicate-batch ACKs | Three each |
| Host input/response work | At most 64 authenticated-source messages per 10 seconds per registration |
| Replay bookkeeping | One current challenge, last batch payload and counters |

Timeout, closed-parent, denied `postMessage`, missing secure randomness and timer
failures terminate that connection's attempts. They do not discard reporter
memory, invoke a business error handler, reload a page, replay a save or close a
window. Queues retain sanitized events only. All status output consists of fixed
enums and bounded counts, never raw origins, sessions, credentials or exceptions.
Capacity eviction leaves the immutable in-flight batch eligible for bounded
retries and its ACK; remaining queued events continue on the same connection.

## Identity, lifecycle, and receipts

`Collector.windowId` exposes its existing diagnostic identity.
`Collector.acceptRelayed(event)` is the validated receiver's ingress; it does not
allocate an event ID or restamp time/generation. It rejects local-window identity,
unknown/stale generation, disabled persistence, cutoff violations, reset/suspended
stores and unavailable lifecycle coordination. The store's synchronous status
read rechecks its durable barrier even when broadcast/storage notifications were
missed. Store append independently rechecks the generation under the lifecycle
lock, fencing clears between receipt and asynchronous persistence.
After a successful full reset, fresh unsuspended stores can relay evidence in the
current generation while retaining the `reset-complete` tombstone. Pre-reset
instances and instances opened during reset remain suspended; old generations
and events at or before the cutoff remain ineligible.

Accepted events use `collection.source = 'relay'`, with notifications and retry
actions disabled. They do not notify reporter subscribers, so another child hook
cannot relay them again. Duplicate IDs share one memory record and one store key;
classification enrichment retains original ID/window/sequence/time/generation.
The passive exporter already merges shared-store and relay copies by event ID.
The host ACK confirms bounded **memory receipt**, not diagnostic persistence or
practice save success. The A3 sink receipt alone confirms diagnostic persistence.

Clear/opt-out/reset invalidates queued old events and pending acknowledgements;
unknown generations are never adopted at the receiver. Missing lifecycle
coordination retains origin evidence locally instead of risking resurrection of
cleared history. The store's current-page-memory semantics remain unchanged.
If a barrier invalidates an in-flight batch, forwarding stops with `incomplete`
status for that binding. New runtime bindings can establish a new channel; no
automatic reconnect or old-history backfill is attempted.

## Passive status and export

`transport.status()` returns connection state, `aggregation: 'incomplete'`, pending
event/byte counts and a dropped count. `Collector.attachTransport` exposes only
revalidated status in collector snapshots, early text export and the rich passive
exporter. Status checks `parent.closed` without sending probes or reading parent
business state. A connected receipt does not prove all practice contexts were
instrumented or all historical evidence was delivered, so aggregation stays
explicitly incomplete. Parent reload is detected when bounded delivery times out;
without another event, no active probe is made and the last connection state can
remain connected. The aggregation limitation always remains visible.

Declarations: `diagnosticChannel.d.ts`, `bootstrapCollector.d.ts`,
`diagnosticContract.d.ts` and `diagnosticExport.d.ts`.

## Validation and downstream scope

`developer/tests/js/diagnosticChannel.test.js` covers trust checks, hostile input,
privacy, identity/enrichment, byte/count/work bounds, one-hop delivery, ACK/retry
exhaustion, registration ownership, business-state isolation, parent replacement,
missing capabilities and lifecycle races. Existing store tests exercise the real
transactional barrier and reset behavior.

`developer/tests/e2e/diagnostic_channel.node.js` uses real Chromium popup windows,
native postMessage and IndexedDB in isolated contexts under file, HTTP root and
HTTP subpath hosting. It exercises trusted delivery/shared-store deduplication,
wrong windows/tokens/sessions/origins, parent closure/reload, replacement and
delayed-message rejection after clear/opt-out/full reset. CI runs this harness.
It also covers fresh connections after a full reset and host reload, and queue
overflow while an immutable batch awaits its ACK.
All affected shipped bundles and diagnostic bootstrap/build mappings are rebuilt.
The reading runtime installation is covered by C2's additional browser harness.
Listening runtime installation remains with C3; integrated release qualification
remains with C4 (#206).
