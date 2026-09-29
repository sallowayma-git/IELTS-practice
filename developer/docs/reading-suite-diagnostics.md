# Reading and suite diagnostics (C2 / #204)

The maintained `assets/generated/reading-exams/reading-practice-unified.html`
captures failures before its first external dependency. Its generated bootstrap
declares the reading bundle, reading manifest and shared incident stylesheet as
required resources. A missing or invalid bundle leaves a local startup panel with
text and JSON export. The normal reading bundle hands off that same collector to
the shared reporter, bounded store, exporter, operation adapter and incident UI.
No remote telemetry or additional learning-data store is introduced.

## Coverage and correlation

The runtime records bounded breadcrumbs and failures for initialization, required
data-script loading, INIT/readiness, submit and acknowledgement deadlines, draft
delivery, recovery mirrors, host confirmation and suite navigation. A required
data script has a 15-second deadline; INIT readiness and submission use the
existing 10-second acknowledgement interval. Browser resource failures retain
`status: unknown` unless a real status is available. Opaque browser errors never
invent a resource path, stack or cross-origin detail.

The build derives an exact resource-path allowlist from the code-owned numeric
reading and explanation script names in both manifests. It embeds no titles,
source-document names, answers or other manifest metadata. Query strings,
fragments, absolute workspace paths and unlisted script names stay redacted.
Native `QuotaExceededError` and typed AppData errors can provide a safe cause code;
arbitrary exception messages and stacks do not bypass sanitization.

After business INIT validation succeeds, `AppDiagnosticChannel.createChild`
connects to the actual parent WindowProxy, validated origin, session and window
token. The reserved diagnostic envelope is consumed separately from the reading
business handler. Invalid INIT cannot connect or replace this channel.

`Collector.correlate(raw, aliases)` either allocates local aliases or validates
existing aliases without allocating new identity. INIT carries a sanitized
`diagnosticCorrelation` containing the host scope, session and suite aliases.
Reading combines those with its local submission/operation aliases. The host
adopts incoming submission/operation aliases only when the scope, session and
suite match its own validated business context. The shared operation adapter
accepts either raw business IDs or these safe aliases. Transport tokens remain
private control state and never become correlation aliases or diagnostic data.
This extends business envelopes without changing diagnostic schema version 1.

## Submission and recovery outcomes

A submission captures its payload and original submission ID once in runtime
business state. Answer editing is locked while that submission is unresolved,
including after an acknowledgement timeout or an unconfirmed negative reply.
These outcomes do not prove that the host failed to save. Both the incident's
explicit retry and the page's confirmation button resend the original snapshot
and submission ID through the existing host receipt and duplicate-protection
path, without freezing timing again. The original retry callback remains valid.

Only a validated first-attempt negative reply with business evidence of
`not-committed` releases the snapshot and unlocks editing. The next Submit then
captures current answers and freezes timing under a new submission ID. A rejected
retry cannot disprove an earlier unconfirmed write, so it cannot release that
operation's receipt key. Finalizing or completed suites reject a different
submission ID instead of certifying an unwritten snapshot. Diagnostic code never
persists a practice record or reconstructs a payload from an exported event.

Retry ownership includes parent, session, suite, window token and generation.
Session replacement invalidates old callbacks. Token replacement preserves the
business snapshot under a new ownership object and invalidates the old callback.
An exact validated ACK during an active submission is the confirmation of
`committed`. Unsolicited, mismatched or late ACKs after timeout/NACK remain ignored;
a user retry can reconcile the original submission with the host's saved receipt.
UI dismissal, diagnostic relay ACKs and diagnostic-store receipts never confirm
learning-data persistence.

Suite submissions capture final-submission ownership with the business snapshot.
A delayed ACK can confirm that submission after inline navigation; results and
explanations belong to the currently active slot, guarded by its activation and
session ownership. Final draft cleanup and self-close still follow the submitted
snapshot, even when the active passage has changed. If the browser keeps the
window open, read-only navigation continues to show each passage's own results.

Draft `postMessage` delivery is recorded as `unconfirmed`. Host receipt and durable
recovery retain the existing B4 adapters and failure semantics. A child window
recovery mirror reports success only when its existing synchronous `save` returns
`true`; missing storage, a false return or a thrown quota error reports
`not-committed` for that mirror. It does not claim that the separate host draft is
lost. A failed mirror or delivery does not advance the periodic draft fingerprint,
so the existing draft lifecycle can try again. Answers and notes stay exclusively
in business recovery storage.

## Parent departure and local access

The reading header bell opens shared diagnostic history. The options menu exposes
the same action when narrow layouts hide the bell. Shared dialog focus handling
closes the reading options panel before presenting an incident. Reading notices
sit below the header so retained history cannot cover the bottom submission and
passage-navigation controls, including on mobile layouts.

Host `beforeunload` disposes its diagnostic receiver but preserves registered
unified reading windows and interrupted-session data. Explicit session closure
and ordinary `destroy()` still use the normal cleanup behavior. This lets a child
retain its own evidence and export after the host closes or reloads. No parent
document inspection is used. A closed parent is detectable immediately; reload
is observed on the next bounded delivery attempt. Cross-window aggregation is
always labelled incomplete, including while connected; history and export state
that limitation. Parent departure does not automatically reconnect or replay a
business save.

## Generation and packaging

`scripts/build-bundles.mjs` owns both generated inline bootstrap blocks, the
reading diagnostic bundle and build/source mappings. It hashes the reading entry
skeleton, shared stylesheet and resource manifests as identity inputs. The JSON
reading-asset generator preserves the maintained HTML byte for byte and checks
that invariant around its real output-directory reset. A fixture test exercises
that reset without overwriting the repository's data assets. Release packaging
requires `css/incident-center.css`; the main app imports that same stylesheet.

Regenerate and check with:

```sh
node scripts/build-bundles.mjs
node scripts/build-bundles.mjs --check
```

## Validation and handoff

`developer/tests/js/readingDiagnostics.test.js` covers immutable submit retry,
receipt outcomes, stale ownership, quota/false/missing recovery backends, trusted
INIT installation, the full readiness deadline, resource privacy and generator
preservation, submission edit locks, editable resubmission after a proven
rejection and delayed suite ACK ownership. Host regressions distinguish proven
rejection from an unknown outcome and guard final-suite receipt ownership. Existing
reading/suite regressions cover read-only ACK behavior, inline navigation, draft
restoration and idempotent host receipt handling.

`developer/tests/e2e/reading_diagnostics.node.js` uses shipped bundles, actual host
popups, Chromium and native `postMessage` under `file://`, HTTP root and HTTP
subpath hosting. Its 48 scenarios exercise missing/invalid bundles, missing
datasets, rejected initialization, lost ACK with an explicit safe retry and one
saved record, correlated host evidence, parent close/reload with child export,
recovery quota and opaque browser errors. Review regressions verify that a proven
rejection permits edits with fresh timing, while an unconfirmed NACK or timeout
keeps answers locked and replays the original snapshot. Single-passage and suite
cases let the real write commit before suppressing its ACK, attempt a native
answer edit after timeout, and reconcile through the normal confirmation button;
the original record remains unchanged and is never duplicated. Delayed suite
ACK cases verify correct active-passage results and immediate self-close. The
keep-open case holds the actual explanation script until results are visible,
then waits for the captured close callback before testing read-only navigation.
It checks export redaction, incomplete coverage and a real JSON download, and
writes screenshots for the retry UI.
CI runs this harness. Shared channel, notification, startup/export, suite and
reset regressions remain relevant to the final integration.

This slice consumes B4 (#202) and C1 (#203), including their review fixes. C2 is
handed off for review after its signed commit and PR are published; it is not the
cross-runtime release qualification. Listening coverage remains with C3 (#205),
and final integrated file/HTTP/subpath qualification remains with C4 (#206).
