# Reading Timing v1 — measurement contract

Issue: [#153](https://github.com/sallowayma-git/IELTS-practice/issues/153).
Parent: [#142](https://github.com/sallowayma-git/IELTS-practice/issues/142).

**Status: approved for implementation.** This document defines the agreed v1
measurement. Changes to allocation, grouping, exclusions, or recovery limits
need an updated agreement. A contract-only PR uses `Refs #153` and `Refs #142`;
only an approved, implemented, validated delivery may use `Fixes #153`.

## 1. Measured quantity and boundaries

Measure **foreground time associated with an explicitly selected question or
question group**, plus foreground time with no selection. This is an interaction
proxy, not a measurement of thinking, attention, reading speed, or time needed to
answer correctly. A learner can think without interacting or leave a focused
window unattended. There is no inactivity timeout in v1.

Only an initialized, editable Reading attempt can accrue time. The document must
be visible, its window focused, its practice timer running, and its timing writer
current. Exclude loading, passage-transition gaps, hidden/unfocused windows,
pause, timer-locked state, submission, review, and memorize mode. A visible window
behind another application is excluded on blur. Do not change the existing
session/passage timers or derive this measurement from their totals.

Each eligible interval belongs to exactly one bucket in one passage attempt:

- A question unit, if its independently addressable question is selected.
- A group unit, if a member of a shared question group is selected.
- `unallocated`, if no supported unit is selected. This includes reading before
  the first selection and general passage, notes, and navigation activity.

Unallocated time is not necessarily reading time and must not be labelled as
such. Excluded time has no answering bucket. Do not calculate it by subtracting
this measurement from the existing session/passage duration.

## 2. Selection, revisits, and grouping

A user-initiated question-navigation action, pointer interaction with an answer
control, keyboard focus entering that control, input/change, or answer drop
selects the uniquely mapped timing unit. Changes made while applying a draft,
rendering, auto-focusing, scrolling, or displaying results do not select a unit.
Existing visual question highlighting alone is not evidence of user selection.

Selection remains associated with that unit until another selection or a boundary
below. Looking back at the article without interacting may therefore remain
associated with the selected unit. Explicit pointer/keyboard interaction with
the passage or general notes clears selection to `unallocated`; merely scrolling
does not. The UI must show the current association and offer a keyboard-accessible
way to select `unallocated` without modifying answers. Input focus moving to
toolbar/navigation controls alone does not imply a new question selection.

Returning to a unit adds another interval to its accumulated duration. Answer
edits, clearing an answer, marking a question, and revisiting an unanswered unit
never reset its measured duration. A deliberate new attempt receives a new
identity and starts from zero; submitted measurements remain immutable.

Use a conservative, deterministic grouping rule for v1:

1. Snapshot the launched dataset's `questionOrder` and `questionGroups`.
   An authored group containing more than one question ID is one timing unit,
   including shared prompts, common answer pools, and multi-answer checkboxes.
   This deliberately also keeps multi-question groups with separate controls at
   group granularity; finer attribution needs a later agreed mapping.
2. A singleton group, or an independently mapped question outside any group,
   may be a question unit. Several controls for that same question share it.
3. Merge overlapping authored groups into a single unit covering their union.
   Keep an explicit ordered list of member question IDs. Stable unit IDs are
   local to the saved passage attempt and its saved mapping, not global IDs.
4. Missing, inconsistent, or ambiguous question/control mappings remain
   unavailable at question level; their foreground activity is unallocated.
   Never guess membership from a displayed number range or the active library.

Selecting Q7 or Q8 in a Q7–Q8 unit updates the same group duration. Display that
duration once, and show each member as “Included in group Q7–Q8”. Never duplicate,
divide equally, weight by score, or infer individual durations from group time.

## 3. Navigation and lifecycle transitions

At each event, checkpoint the preceding eligible interval before changing state.
Duplicate events at the same clock position contribute zero additional time.

| Event | Next timing state |
| --- | --- |
| First editable passage ready | Unallocated, if visible/focused/running and ownership is acquired |
| Select a different question or group | Close the previous bucket; start the selected unit |
| Select the same unit, revisit, or edit its answer | Continue accumulation without resetting or duplicating |
| Interact with the passage/general notes, or choose unallocated | Close the unit; start unallocated |
| Begin passage/window navigation | Close the outgoing bucket; exclude loading/transition time |
| Destination passage becomes editable | Restore its saved totals; start unallocated, unless this navigation explicitly selected a destination question |
| Blur, hidden visibility, pagehide, freeze, pause, or timer expiry/lock | Close the interval; clear timing selection; stop accruing |
| Focus/visible, pageshow, or resume | Recheck every eligibility condition; start unallocated, never backfill the excluded gap |
| Enter review/memorize, leave the attempt, or submit | Close and freeze the answering measurement |

Question selection while paused, unfocused, or otherwise ineligible does not arm
a future interval. A stale DOM focus/highlight after resume or navigation is not
a fresh selection. Returning from the back/forward cache starts a new live clock
anchor only after checking current ownership and finalized state.

Review, corrections to a submitted record, answer/explanation display, and SM2
feedback cannot alter submitted answering time. Review time is not collected by
v1. Submission freezes the snapshot before grading/persistence work; retrying the
same submission reuses that frozen snapshot. If saving fails, keep it recoverable
and show the existing submission failure. If the learner explicitly returns to
answering before successful submission, start a new eligible interval without
erasing the frozen accumulated totals.

## 4. Clock, persistence, and recovery limits

Use a monotonic clock for live deltas; wall-clock timestamps describe saves and
provenance only. Persist integer milliseconds, carrying fractional remainders in
memory rather than rounding every interval. Round for display only. Reject
negative, non-finite, and inconsistent values instead of coercing them to zero.

Use a nominal one-second heartbeat and checkpoint at every selection/lifecycle
boundary. A gap greater than five seconds between clock observations is
unobserved: discard the entire gap, mark the measurement partial, and restart
unallocated if eligible. This conservatively excludes suspension/event-loop gaps;
it can also omit real foreground work during a long stall. Do not invent a
duration for sleep or infer active time from wall-clock differences.

Request durable cumulative snapshots at least every five seconds while eligible
and immediately at selection changes, pause, blur/hidden, navigation, and submit.
Coalesce pending writes to the newest cumulative snapshot; serialize writes so
an older completion cannot replace newer data. Timing-only changes must bypass
answer-only draft fingerprint/debounce suppression.

Use the existing AppData/IndexedDB recovery path as durable authority. A successful
postMessage or sessionStorage mirror alone is not a durable-save acknowledgement.
Pagehide/beforeunload saves are best effort. In healthy operation the target
unsaved tail is at most five seconds; a delayed/failed write or abrupt process
exit can lose more. This is a cadence target, not a guaranteed recovery bound.
Expose save failures and the latest acknowledged save; never claim zero loss.

On refresh, interruption, or draft restoration:

1. Recover the latest valid committed cumulative snapshot for the exact attempt
   and source. A newer recoverable mirror may be offered only after ownership,
   revision, and identity checks and a successful durable commit.
2. Restore closed totals only. Discard any persisted live anchor/open interval;
   never calculate `now - savedStart` or replay previously included intervals.
3. Keep the attempt identity and saved grouping, acquire a new writer generation,
   and begin unallocated at the current live clock. A saved pause remains paused
   until explicitly resumed. Repeated INIT/restore messages are idempotent.
4. Mark resumed measurements as partial when an uncommitted tail cannot be ruled
   out. A legacy draft without timing starts partial measurement from restoration
   onward; earlier time remains unavailable. Discarding a draft and starting over
   creates a new attempt rather than resurrecting old timing.

Missing timing on an old submitted record stays unavailable. Missing units in a
partial saved snapshot are unknown, not zero. A valid, fully initialized unit
with no attributed interval has a measured zero. Unsupported imported pages or
browsers without the required identity/clock/storage capabilities show unavailable
timing while retaining the existing practice behavior.

## 5. Ownership, additive records, and suite totals

Only the active practice page measures live intervals and checkpoints through
the shared AppData authority; the host commits and projects the submitted
snapshots. Each passage measurement is scoped by saved library
provenance, exam ID, and passage-attempt ID. A built-in-library `null` is distinct
from missing/unknown provenance. Same-ID exams from different libraries never
share measurements. Preserve the launch provenance through recovery; do not
enrich historical timing from today's selected library.

A suite owns distinct child passage-attempt IDs and their sequence positions,
including repeated occurrences of the same exam. Its parent has no independent
question stopwatch. At a passage boundary, preserve the outgoing child's totals
before activating the destination; re-entry resumes those cumulative totals.
Navigation races must not apply an old passage's selection or snapshot to a new
passage. Parent recovery must retain every measured child, not just the active
child or the final child result.

Acquire/check a single writer generation through the existing revision-checked
durable recovery mechanism before accrual. All messages and saves carry that
generation and a monotonically increasing revision. An explicit restore/takeover
invalidates the earlier writer; reject its later messages. Never merge concurrent
windows' live measurements. If ownership cannot be established, timing is
unavailable until recovery succeeds; existing answer-saving behavior still applies.

The proposed additive `readingTiming` version 1 metadata contains:

| Field family | Required meaning |
| --- | --- |
| Contract and identity | Version, measurement kind `foreground-selection`, passage-attempt ID, saved source/exam identity, and optional parent/child/sequence linkage |
| Saved unit mapping | Unit ID, `question`/`group`, explicit member IDs, and whether its attribution is supported |
| Accumulation | Nonnegative integer `durationMs` per supported unit and `unallocatedMs`; optional total must equal their sum |
| Recovery envelope | Writer generation, cumulative snapshot revision, acknowledgement/save timestamp, and frozen/finalized state; no resumable live clock anchor |
| Coverage | `complete`/`partial` relative to the observed eligible attempt, plus reasons such as legacy start, unobserved gap, recovery tail, unsupported mapping, or conflicting snapshots |

These names describe the required semantics; concrete serialization can follow
existing AppData conventions without changing the agreed measurement. Timing
metadata must survive draft cloning/merging, single and suite submission, light
summary/detail projection, export/import, backup/restore, and interrupted recovery.
Keep per-unit data in details; lightweight summaries retain identity, measured
totals and coverage sufficient to display missing/partial data truthfully.

Treat snapshots as cumulative replacements, never additive deltas. Within a
writer generation accept only increasing revisions; an identical revision is a
no-op, and conflicting payloads for the same revision are rejected. A newly
acquired generation starts from the previous committed totals. Do not take
per-field maxima or sum alternate snapshot representations. Finalization is an
idempotent commit for the same attempt and frozen revision, rejects stale draft
writes, and clears recovery only after its record commit is acknowledged.

For each passage, `measuredForegroundMs = unallocatedMs + sum(unit.durationMs)`.
Suite timing is the sum of available unique child passage attempts. Do not add
the parent again or also count a standalone representation of the same child.
Use exact saved linkage for deduplication; matching exam IDs/timestamps alone
are insufficient. Incomplete suites disclose measured-child coverage. A suite
parent total without child measurements cannot supply question/passage timing.
Interrupted attempts remain outside completed-practice analytics.

## 6. UI text and unavailable states

Show the live association near question navigation and measurements in record
details. Group rows appear once with links/labels from their members. Passage and
suite summaries separate attributed and unallocated totals and show coverage.

| State | English label | Chinese label |
| --- | --- | --- |
| Question measurement | Question-associated foreground time | 题目关联前台时长 |
| Group measurement | Group-associated foreground time (Q7–Q8) | 题组关联前台时长（Q7–Q8） |
| No selection | Unallocated foreground time | 未分配前台时长 |
| Group member | Included in group Q7–Q8 | 计入题组 Q7–Q8 |
| Missing/unsupported historical measurement | Unavailable — no reliable measurement | 不可用：无可靠计时数据 |
| Incomplete coverage | Partial measurement | 部分计时 |

Display durations as labelled minutes/seconds, without decimal precision; a
positive duration below one second is `<1 s` / `不足 1 秒`. A valid zero is `0 s`,
distinct from unavailable. Explain that displayed rows are rounded and sums use
the unrounded saved milliseconds. Do not call these values “thinking time”,
“time per correct answer”, or a precise split of group time.

Provide this explanation beside the measurements or through accessible help:

> Counts time while this Reading page is visible, its window is focused, and
> practice is running. Selection associates time with a question or shared group;
> it does not measure attention or thinking. Interacting with the passage or
> general notes clears that association. Paused, background, review, and
> closed-page time are excluded. Shared groups are not split into individual
> question times. Saves are requested every five seconds and at transitions;
> recovery can lose an unsaved tail, and long unobserved gaps are omitted.

The corresponding Chinese UI must convey the same exclusions, grouping rule,
and recovery limit. The existing session/passage duration remains separately
labelled. No historical estimation, new recommendation sorting, Browse category
switcher, or changes to Reading review / SM2 scheduling belong in this slice.

## 7. Acceptance examples and implementation validation

The values below use a controllable clock with no unobserved heartbeat gaps.
They define acceptance semantics. Executed checks and environment limits are
recorded separately in [Reading-Timing-Validation.md](Reading-Timing-Validation.md).

| Scenario | Required outcome |
| --- | --- |
| Read without selection for 12 s; select standalone Q1 for 8 s | Unallocated 12 s, Q1 8 s; measured foreground total 20 s |
| Q1 for 4 s; Q2 for 3 s; return to/edit Q1 for 6 s | Q1 10 s, Q2 3 s; earlier intervals preserved |
| Select Q7 then Q8 in a shared Q7–Q8 group for 4 s and 6 s | One group row of 10 s; individual members have no invented durations |
| Read while Q1 remains selected; then interact with passage for 5 s | Before the interaction remains associated with Q1; the following 5 s are unallocated |
| Q1 5 s; hidden 30 s; visible but unfocused 10 s; focus 2 s; select Q1 3 s | Q1 8 s, unallocated 2 s; excluded 40 s never enters either bucket |
| Q1 5 s; pause 20 s; resume 2 s; select Q1 3 s | Q1 8 s, unallocated 2 s; existing timer behavior preserved |
| Commit Q1 7 s; accrue 2 s; kill page before next durable save; restore after 60 s | Recover Q1 7 s with a partial/recovery notice; neither 2 s nor closed-page 60 s is fabricated |
| Restore the same saved revision twice; repeat heartbeat/save at the same instant | Saved totals included once; no additional interval |
| A delayed 8 s heartbeat gap or a changed wall clock | Gap omitted/marked partial; wall-clock change cannot inflate monotonic elapsed time |
| P1 unit 4 s; P2 unit 6 s; return to P1 unit 3 s | P1 7 s, P2 6 s; parent 13 s exactly once, plus any explicitly measured unallocated time |
| Same exam appears twice in a suite or two libraries | Separate passage-attempt/source identities; no collapsed or shared totals |
| Newer snapshot then stale draft; duplicate final-submit; old writer after takeover | Newer/finalized state retained; no rollback, resurrection, or doubled interval |
| Storage failure during transition/submission | Failed acknowledgement is visible; retain recoverable data and do not claim durable completion |
| Old record, old draft, partial child set, malformed/unknown timing version | Unavailable or partial with coverage; never estimated from session duration |
| Review, annotation edit, SM2 feedback, export/import, backup/restore | Answering measurements unchanged and retained through valid round trips |

The implementation uses a separately tested measurement engine and propagates
its metadata through the existing paths. Relevant integration points are
[unifiedReadingPage.js](../../js/runtime/unifiedReadingPage.js) (selection,
pause, draft cloning, lifecycle, inline slots and submission),
[examSessionMixin.js](../../js/app/examSessionMixin.js) and
[suitePracticeMixin.js](../../js/app/suitePracticeMixin.js) (host ownership,
recovery, transitions and finalization),
[practiceRecorder.js](../../js/core/practiceRecorder.js),
[practiceCore.js](../../js/core/practiceCore.js), and
[appData.js](../../js/data/v2/appData.js) (record/recovery projections), and
[practiceRecordModal.js](../../js/components/practiceRecordModal.js) (record UI).
The validation report maps the implemented behavior to executed checks.

Follow the [repository test requirements](../../README.md#测试要求), including
bundle regeneration/checks and focused deterministic timing/recovery tests.
Exercise both single-passage and suite workflows, with keyboard and pointer
selection, under `file://`, a local static HTTP server, and static hosting at a
subdirectory. Record protocol, browser, build revision, and whether hosting was
a local HTTPS static-hosting simulation or a deployed static host; do not present
a simulation as deployment evidence. Test rendering of group/unallocated,
partial, save-failure, and unavailable states in each mode. Validate old records,
draft restoration, repeated restores, provenance isolation, duplicate messages,
competing writers, and existing session/passage timers alongside the new feature.
The approved measurement, implementation, and this validation are all required
before a PR may close #153; #142 remains open.
