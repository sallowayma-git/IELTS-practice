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

## PR #189 review regressions

The controller regression suite now covers the review findings and their
recovery boundaries:

- Trusted pointer presses on `.drag-item`, `.draggable-word` and `.card` select
  the enclosing authored group before any drop, including presses on nested
  text. An assigned draggable inside a passage drop zone retains that zone's
  question mapping. Synthetic pointer events do not select a unit.
- Pausing on P1, navigating to P2, resuming there and revisiting P1 leaves the
  suite running and accumulating time. Saved pause state applies once per
  restored attempt; both cached and newly loaded inactive children respect the
  current suite state. A different restored attempt can still restore its pause.
- Retrying an initial acquisition failure preserves the saved draft's attempt
  identity, grouping and cumulative totals. Repeated failures remain retryable;
  successful acquisition starts partial measurement without filling the failed
  interval. Retry after a later checkpoint failure still saves the existing
  entry. A retry cannot activate a different passage or a non-editable attempt.
- A learner's explicit resume during failed or pending acquisition supersedes
  the saved pause. The controller retains the timer interaction revision from
  the attempt's first activation across retries and repeated activation calls.
  Deferred-acquisition tests cover resume, resume followed by pause, and no new
  timer action; the last case still restores the saved pause. A timer action in
  one attempt does not prevent another attempt from restoring its own pause.

The real-page acceptance script also exercises pool pointerdown from both
unallocated time and another selected group, and uses timer/navigation clicks
for the cross-passage pause/resume/revisit sequence. In single and inline-suite
practice, a temporary IndexedDB quota failure blocks initial acquisition on each
document load, including refresh with a saved draft. The fault remains active
until the test makes storage writable and clicks the visible retry button, so
duplicate initialization messages cannot mask the failure. Retry must acquire
ownership, restore saved totals and pause state, and show a durable-save
acknowledgement. These checks run in all three loading modes below, alongside
the existing post-acquisition save-failure test.

The follow-up browser case restores a paused inline suite with acquisition
blocked, resumes through the timer, makes storage writable and clicks retry.
Both the existing suite/passage timers and foreground timing must continue over
the following two seconds. Single-passage practice also exercises an explicit
resume before retry. The adjacent refresh case makes no new timer action and
must remain paused, preserving the normal restoration behavior.

The subsequent CI failure at `e8247b13d38a0e13d5e2c24e670c634fa07e32ab`
exposed a missing synchronization boundary before the second suite reload.
An added pre-reload check also reproduces the underlying stale host state:
the child timer is stopped and its timing draft is paused, while the host and
its recovery mirror still report a running timer after ten seconds. The old
setup relied on an unload message to propagate that state.

Suite timer changes now immediately publish the current timer and draft through
the existing host protocol, including pause restoration and a resume made while
timing acquisition is unavailable. The browser test waits for initialization
to finish and verifies matching child, host and recovery-mirror state before
each reload. These checks compare the suite/exam identity, running state, pause
timestamp and offset, and available timing identity, pause state and totals.
They replace the fixed pre-reload delay. The restored-paused assertion and the
explicit-resume/time-advancement assertions remain strict. A failed convergence
check retains all three observed states in `reading-timing-report.json`.

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
| `node --test --test-concurrency=1 'developer/tests/js/**/*.test.js'` | 375 passed, zero failed |
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
