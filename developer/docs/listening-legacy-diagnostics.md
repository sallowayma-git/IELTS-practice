# Listening and legacy diagnostics (C3 / #205)

The listening wrapper, record bridge and supported practice enhancer now ship
the shared collector, bounded store, reporter, passive exporter, operation
adapter, incident UI and validated channel. No optional listening index, audio,
answers, transcripts or imported practice content is bundled by this change.

## Entry ownership and coverage

| Entry | Capture starts | Ownership and limitations |
| --- | --- | --- |
| Maintained listening wrapper | Before external dependencies | `scripts/build-bundles.mjs` generates its inline bootstrap and build/source mappings. The wrapper is used for same-origin HTTP and subpath listening launches. Its iframe is a separate capture context. |
| Controlled legacy template | Before external dependencies | The same builder embeds the bootstrap into `templates/template_base.html`, before the template's scripts and enhancer loader. |
| Statically instrumented local listening imports | Before dependencies on the next load | `listening_bridge_contract.py` inserts the generated bootstrap into the head and keeps one canonical bridge bundle at the end of the body. Repeated normalization is idempotent. It modifies local imports only; those pages are excluded from release. |
| Runtime-injected listening bridge or enhancer | When the diagnostic part of the bundle executes | The bundle installs its own collector once. Earlier resource/runtime failures, blocked bundle parsing and inaccessible content cannot be reconstructed. The wrapper can still report a failed required bridge injection. |
| Direct `file://` listening launch | Static early capture or late injection as above | The host uses the source page directly. The HTTP wrapper does not claim to embed local file content. Opaque origin alone never authorizes a diagnostic peer. |

Schema version 1 gains optional `collection.entryCoverage` on events and an
`entryCoverage` field in memory and early exports. Rich export includes it under
`collection`. `sanitizeEntryCoverage` accepts only code-owned entry and capture
enums and derives limitation strings. Older events remain valid unchanged.
`earlier-failures-unavailable`, `embedded-content-separate-context` and
`legacy-draft-recovery-unavailable` make the relevant limits explicit. These
legacy runtimes have no durable child draft/recovery API; this slice does not
invent a draft receipt. Host recovery continues using the existing B4 reporting.

`generate_listening_assets.py` owns indexes and manifests only. A fixture test
runs it against synthetic imports and verifies the maintained wrapper is
preserved byte for byte. The bundle builder owns the wrapper and template
bootstrap, runtime bundles, stable build ID and source mappings. After changing
sources run `node scripts/build-bundles.mjs` and its `--check` mode.
Import normalization keeps the encoding declaration ahead of the large inline
bootstrap, preserving UTF-8 discovery and repeated-run idempotency.

## Resource and operation evidence

Entry options declare required bundles/styles and optional media before loading.
Missing audio and cancelled/no-result completion attempts cannot open critical
dialogs. Required dependencies retain an allowlisted project reference and
operation; opaque failures keep HTTP status `unknown`. Private source paths,
query strings and filenames stay redacted. The enhancer's required dependency
loader and wrapper content loader have 15-second deadlines; bridge readiness,
handshake and submission observation have 10-second deadlines.

`AppPracticeDiagnostics.create(module)` supplies failure-isolated semantic
observers for readiness, validated INIT, submissions, acknowledgements, retries
and suite/review navigation. Host session/suite aliases are accepted only after
business INIT validation. Submission/operation aliases stay local and are sent
alongside the existing business message for host correlation. An allowlisted
host storage cause can be retained without copying its payload or error text.

Bridge business retry timers, original submission IDs, pending snapshots,
multi-suite completion and idempotency remain owned by the bridge. The enhancer
retains a business-only snapshot for explicit reconciliation. A diagnostic retry
reuses that snapshot and ID; it cannot collect edited answers, create another
record identity or target a replaced session/token binding. Its promise reports
`committed` only after the matching trusted business ACK. A dispatch result,
diagnostic ACK, receipt timeout or dialog dismissal cannot certify a save. A
negative reply after replay remains unconfirmed because an earlier attempt may
already have committed. Observation is bounded to 200 pending diagnostic waits.
After a confirmed listening/legacy commit, the host retains the authenticated
receipt route until its registered window closes or is replaced. A lost-ACK
retry can then replay that receipt without another business write. Ordinary
reading completion keeps its existing cleanup and reset rules.

## Iframe transport and disconnected export

The wrapper connects upstream only after its host INIT is validated. Its iframe
has a separate receiver bound to the exact frame WindowProxy, session, token and
origin. The reserved diagnostic envelope never enters business forwarding. The
shared channel permits one hop: iframe evidence may reach the wrapper and shared
diagnostic storage, but the wrapper does not relay it again to the app host.
When shared storage is unavailable, iframe and wrapper local exports remain the
available evidence. Aggregation is always explicitly incomplete. A connected
iframe-to-wrapper channel does not imply that the wrapper-to-host channel is
still connected.

Host departure preserves registered practice windows and their interrupted
session data while disposing host listeners. Explicit closure and ordinary
`destroy()` retain normal cleanup. Each runtime provides an **Errors and
diagnostics** button with shared history, JSON export and selectable text
fallback. Export performs no probes, reconnects or business writes and remains
available after host closure or reload. The embedded listening page keeps its
own **Errors and diagnostics (this frame)** entry below the wrapper control.
It reads the frame's local evidence even when persistence is disabled or
coordination is unavailable, so errors with no active notification remain
reachable without relying on the wrapper's exporter or the relay.

## Focused validation

- `listeningDiagnostics.test.js`: trusted INIT, original snapshot/ID retry,
  matching ACK, storage causes, stale session callbacks, handshake loss,
  optional media, cancellation, coverage sanitization and reporter isolation.
- Existing `listeningRecordBridgeProtocol.test.js`, parser tests and
  `practicePageEnhancerReplay.test.js`: pre-INIT, automatic retries, multi-suite
  completion, answer extraction and read-only replay.
- Python generation/migration/static-guard tests: canonical injection, verified
  early coverage and wrapper preservation with synthetic content.
- `listening_diagnostics.node.js`: shipped bundles and native Chromium popups
  under file, root HTTP and subpath hosting; missing/invalid required bundles,
  optional audio, lost ACK after an actual host commit, explicit idempotent
  reconciliation, late injection and disconnected export. Disabled persistence
  and unavailable coordination cases exercise local history, downloaded JSON
  and selectable-text fallback for post-readiness errors that do not reach the
  wrapper, while preserving business data and storage preferences. It uses
  synthetic input only and is included in CI.

This slice consumes the current B4/C1 diagnostic interfaces and C2 review fixes.
Review and integration are completion gates. C4 (#206) retains the final
integrated release qualification.
