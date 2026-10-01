# Diagnostics acceptance and release evidence (C4 / #206)

The acceptance gate integrates the B3 settings branch with the C3 practice
branch. Run `python developer/tests/e2e/diagnostic_qualification.py` for the
complete source matrix, or `python developer/tests/e2e/e2e_runner.py` for that
matrix plus the existing practice, recovery, navigation, backup/import and full
reset regressions. `npm test --prefix developer` retains the feature-owned Node
normalization, redaction, identity, failure-isolation and real IndexedDB tests.

Each browser case uses disposable storage. Startup and practice faults modify
temporary runtime copies. Listening and legacy content and submitted learning
data are synthetic; reading regression cases use shipped exam definitions.
No private listening library or remote telemetry is needed. The additional
integrated suite blocks non-local HTTP requests and exercises emitted bundles.

## Evidence matrix

Every listed browser suite covers `file`, `http` (root) and `subpath`. The gate
requires matching scenario sets across all three modes and rejects missing,
failed, duplicate, partial or stale reports. Its `acceptance.json` records the
tested Git commit, content-derived build ID, runtime source, case names, results,
durations and links to the per-suite JSON artifacts. Arbitrary errors, business
payloads and console arguments are excluded from these published JSON files.
Failed checkpoints retain only their numeric test source line when available,
so a failure can be located without exposing its exception text or local path.

| #194 | Acceptance evidence | Suite / representative scenarios |
| --- | --- | --- |
| 1 | Early actionable failure and export | `diagnostic_startup`: missing, parse, rejected and caught initialization; reading/listening startup faults |
| 2 | Required resource/action versus expected optional failure | `diagnostic_acceptance`: required-lazy-load for diagnostics, reading tools, reading library and vocabulary; `listening_diagnostics`: optional-media; startup healthy/abort and required reading dataset |
| 3 | Accurate save outcomes and isolated memory fallback | `operation_diagnostics`: quota, aborted-transaction, backend-unavailable, recovery-failure; acceptance storage faults stop repeated failed writes |
| 4 | Committed result, lost ACK, idempotent reconciliation | `reading_diagnostics`: committed-lost-ack-single/suite and delayed-suite-ack; listening/legacy lost-ack; operation receipt reconciliation |
| 5 | Same-event propagation, distinct incidents and bounded UI | `incident_notifications`: aggregation, queues, keyboard focus and failure storms; acceptance hostile-propagation-and-storm |
| 6 | Practice correlations, disconnected export, truthful limits | Reading, suite, listening, wrapper/iframe and legacy parent-closed/reloaded cases; channel relay-and-shared-store |
| 7 | Source/origin/session/token validation without business effects | `diagnostic_channel`: untrusted-input, replacement and one-hop/payload bounds |
| 8 | Hostile serialization and export redaction | Node contracts; export legacy redaction; acceptance cyclic/BigInt/DOM/throwing-getter/private path and query fixtures |
| 9 | Retention, all ceilings, concurrent writers and lifecycle | Node real-store retention; acceptance count-byte-age-limits and reload-concurrent-clear-opt-out-reset; settings controls; channel clear/opt-out/reset with pending relay |
| 10 | Passive JSON/text export, bounded fallbacks | `diagnostic_export`, `diagnostic_settings`, notification render failure and acceptance passive-fallback with storage/UI/clipboard/file failures and side-effect traps |
| 11 | Reproducible isolated Node/browser tests in all modes | Full Node tests and the nine-suite source evidence gate in the unified runner |
| 12 | Existing correctness and actual release contents | Unified submission/recovery/navigation/backup/reset regressions; extracted release qualification and build/HTML/wiring checks |

The memory ceiling remains 200 events or 256 KiB. Persistence retains up to
seven days, 2,000 events or 2 MiB of serialized payload. The byte ceiling can be
reached before the event ceiling even for small schema-complete events. The
browser test uses production byte/age ceilings and a reduced count limit to
exercise transactional count trimming independently. It asserts the production
2,000-event default. Node tests cover 20 frames, three cause levels, 50 semantic
breadcrumbs, 8 KiB per event and 60-second notification aggregation. Detailed
mode expires after 15 minutes and does not relax privacy or capacity limits.

## Release gate

Commit changes first, then run:

```sh
node scripts/build-bundles.mjs --check
npm test --prefix developer
python -m unittest discover -s developer/tests/py -p 'test_*.py'
python developer/tests/ci/check_reading_data_integrity.py
python developer/tests/ci/qualify_reading_release.py
```

The qualifier invokes `release.ps1` on Windows or `release.sh` on Linux. CI runs
both platforms independently. It checks a clean source revision, archives the
runtime, extracts into a new directory, rejects traversal/untracked assets,
compares every file byte-for-byte to tracked source and records archive/file
SHA-256 values. No source-JS fallback is available inside the extraction.

`verify-diagnostic-release.mjs` verifies required runtime assets, resident
settings, diagnostic modules in all practice bundles, identical inline capture,
stable build stamps and section line mappings. The deterministic Node build test
also compares original source lines and proves identical inputs reproduce the
build. Every emitted bundle, including separately loaded reading, vocabulary
and dictionary bundles, must retain its resource path and stack coordinates
after diagnostic redaction. Missing lazy bundles fail release verification.
Python generation tests verify preserved reading HTML and maintained
listening/template wiring. Development templates are not runtime dependencies.
The listening wrapper is application code and ships in the default package;
optional listening indexes and content remain excluded.

The extracted package runs the existing TXT/migration/backup qualification and
five diagnostic suites: startup, settings, reading/suite, listening/legacy and
the new integrated acceptance suite. Missing files fail immediately; an absent
`DIAGNOSTIC_RUNTIME_ROOT` is an error for `--release`. Source-only protocol and
notification fixtures are explicitly qualified in the full source matrix, not
represented as reruns from the release archive.

The TXT qualification runs its HTTP, HTTPS and file protocols sequentially on
Windows to bound the hosted runner's browser workload. Every protocol retains
its simultaneous-window and concurrent IndexedDB mutation assertions; the report
records the protocol concurrency. Linux runs the three protocols concurrently.

CI artifacts `e2e-diagnostics-*` and `diagnostic-release-{os}-*` include the
sanitized matrix and release provenance. Download artifacts from the relevant
PR's CI run; the issue/tracker handoff links that run and records the tested SHA.
Artifact retention is 14 days, so preserve a copy for longer investigations.
Opening a PR or passing tests does not mark #206/#195 complete: review and
integration remain separate requirements.

## Controls and coverage limits

Use Settings → Errors and diagnostics to find an incident reference, refresh
history, export JSON, copy a summary, retry diagnostic storage, clear only
diagnostics, disable persistence, or enable detailed mode for 15 minutes.
Turning off persistence removes retained history while short-lived page context
can remain for immediate feedback/export. A full site reset also clears learning
data and suspends surviving diagnostic writers. Diagnostics are not an answer
backup; export never retries submissions or launches active diagnostics.

The in-page collector cannot guarantee capture with JavaScript disabled, a page
that never opens, process crashes, a blocked main thread or inaccessible
cross-origin details. Late injection cannot recover earlier errors; legacy child
draft/recovery capture is unsupported. Disconnected and iframe-local histories
remain available with incomplete aggregation. Coordination requires shared
storage and browser capabilities; different origins and some file environments
cannot coordinate. Automated browser evidence here is Chromium only, and does
not claim Firefox, Safari, mobile, private listening libraries or every external
page was tested. See the feature documents for context-specific limitations.
