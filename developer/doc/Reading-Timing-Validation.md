# Reading Timing v1 validation

This report covers the implementation of the approved
[measurement contract](Reading-Timing-Contract.md) for
[#153](https://github.com/sallowayma-git/IELTS-practice/issues/153).
The contribution targets `opensource`, based on commit
`ae87998c2cca58cc07b97ca0d66da114c1f6c481`.

Validation date: 2026-09-19. Runtime environment: Windows, Node.js 24.19.0,
Python 3.12, Node Playwright 1.62.1 and Chromium 151.0.7922.34.
The repository's Python browser checks used Playwright 1.62.0.

## Measurement and storage checks

The deterministic engine tests exercise unallocated time, revisits and edits,
shared/overlapping authored groups, pause and background gates, frozen review
state, subsecond precision, long unobserved gaps, restoration without replaying
closed-page time, malformed snapshots, unavailable historical records and suite
deduplication. Equal-revision conflicting child snapshots are unavailable.
Different attempts and different saved library sources remain distinct.

The persistence test uses real browser IndexedDB. It checks:

- Recovery from a committed host draft newer than the periodic checkpoint.
- Rejection of stale writers, conflicting revisions, regressing totals and
  different source identities.
- Atomic rollback of a queued timing-document write when a record revision
  fence rejects the same transaction.
- A simulated quota failure leaving the acknowledged snapshot intact, followed
  by a successful retry.
- Idempotent finalization, immutable submitted timing even after recovery
  cleanup, and atomic folding of an already submitted child into a suite.
- Two occurrences of the same exam contributing their own child totals once.
- Full/detail and light-summary projections, independent existing duration,
  export/import, backup/restore and post-submission annotation updates.

The host protocol regression additionally checks that an inline suite refreshed
on a later passage keeps the existing window registration and restores all
child drafts. Requests from another window/origin, another suite or an exam
outside the sequence cannot use this route.

## Browser acceptance

`developer/tests/e2e/reading_timing.py` runs the Node Playwright acceptance script.
It is also registered with the existing E2E runner.

| Loading mode | Single passage | Inline suite |
| --- | --- | --- |
| Direct `file://` | Pass | Pass |
| Local HTTP static server | Pass | Pass |
| Local HTTPS static server under `/IELTS-practice/` | Pass | Pass |

Each mode exercises the real reading page, pointer and keyboard question
navigation, heading drag/drop, explicit passage clearing, ignored programmatic
focus, controlled focus/visibility exclusions, pause, refresh with the same
timing attempt, save-failure UI and retry, final record persistence and frozen
post-submit totals. The suite visits all three passages, revisits the first,
refreshes on the third while paused, then submits without revisiting its other
children. Every child keeps its attempt identity and measured totals; the parent
is derived from those children. Record details show grouped, unallocated,
partial and historical unavailable states.

Screenshots and machine-readable output are generated in the ignored
`developer/tests/e2e/reports/` directory:

- `reading-timing-report.json`
- `issue153-{file,http,https-subpath}-live.png`
- `issue153-{file,http,https-subpath}-save-failure.png`
- `issue153-{file,http,https-subpath}-records.png`

The HTTPS run is a **local static-hosting simulation**, not a deployment to a
public hosting service. Headless Chromium keeps its pages focused/visible when
switching tabs, so the test explicitly controls document focus/visibility and
dispatches lifecycle events. This validates the runtime's exclusion boundaries;
it is not a native OS backgrounding, browser-crash or sleep/wake test. Crash-tail
and clock-gap semantics are checked deterministically, without promising a
maximum recovery loss under failed or delayed writes.

## Repository regressions

| Command | Result |
| --- | --- |
| `node scripts/build-bundles.mjs` | Pass; existing eight duplicate-symbol warnings remain |
| `node scripts/build-bundles.mjs --check` | Pass; all 14 generated outputs current |
| `node --test --test-concurrency=1 'developer/tests/js/**/*.test.js'` | 363 passed, zero failed |
| Focused timing, persistence, host protocol, AppData and DataKernel tests | Pass |
| `python developer/tests/e2e/full_reset_flow.py` | Pass |
| `python developer/tests/e2e/suite_practice_flow.py` | Pass |
| `python developer/tests/e2e/reading_timing.py` | Pass in all three modes |
| `python developer/tests/ci/run_static_suite.py` | 136 passed; two pre-existing guard failures |
| `git diff --check` | Pass |

The two static guard failures were reproduced against an isolated archive of
the unchanged base commit. Their findings match the implementation branch after
normalizing line numbers:

1. The CSS convergence guard rejects the existing `css/vocab-reader.css` link.
2. The v2 architecture guard reports existing bookshelf state access, Reading
   legacy recovery storage access and test fixtures. There are seven source
   findings and 23 test findings; no bundle or HTML findings.

The implementation introduces no additional static guard findings. The report
does not claim the entire static suite is green. Existing placeholder-suite
warnings are separate from the new real-page acceptance test.

The completed slice may use `Fixes #153` and `Refs #142`. It does not complete
the umbrella issue, add historical time estimates or change SM2 scheduling.
