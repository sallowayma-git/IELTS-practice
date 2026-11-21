# History scored-answer count contract

Implementation: #312. Parent: #311. Exported row outcomes: #313. Integrated
static-artifact qualification and the original report: #314.

`AnswerComparisonUtils.resolveRecordCounts(record)` is the shared, read-only
count resolver. `getRecordEntries(record)` selects and deduplicates the answer
rows; `getNormalizedEntries(record)` retains the existing snapshot and grading
provenance checks and exposes weighted `scoredCounts` for each row. Consumers
must use these functions rather than treating one display row as one point or
re-grading formatted answer strings. The modal passes its cached normalized rows
to the same resolver, then releases the cache after each render.

## Meaning of the counts

All additive counts measure scored answer slots, not display rows. A grouped
question can occupy several slots. `correct` is earned credit, `total` is the
denominator, and `missed` is credit not earned. The UI calls `missed` **未得分**;
it is not an answered-wrong count.

- `minimumTotal`: the known lower bound on the denominator. It equals `total`
  when that denominator is known; otherwise it retains all established descendant
  slots. This is computed evidence, not a stored grade or a detail-outcome count.
- `incorrect`: slots known to contain a wrong response.
- `unanswered`: slots known to be unfilled, including missing selections in a
  weighted group. A group with one correct selection out of four has one earned
  slot and three unanswered slots.
- `unknown`: slots whose individual outcomes cannot be established from the
  available detail, including missing rows. Aggregate credit does not assign a
  verdict to any particular unknown slot.
- `unclassifiedMissed`: saved missed credit that cannot be attributed to known
  wrong or blank responses. It is a subset of missed credit, not an additional
  category to add to the total.

For complete, compatible detail, `total = correct + incorrect + unanswered`.
When saved grades are available but detail is incomplete, `unknown` can overlap
aggregate earned and missed credit; it must not be added to those aggregates.
For a summary-only 7/10 record, correct = 7, missed = 3, unknown = 10, and
unclassifiedMissed = 3. No ten per-question verdicts are invented. The UI labels
the detail counts **已知答错**, **已知未答**, and **明细未知** to make this distinction
visible. A partial-credit row displays its earned/possible fraction.

| Synthetic reproduction | Before: modal error count | After: missed | Known wrong | Known blank | Detail unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Three wrong selections, weight 3, saved 0/3 | 1 | 3 | 3 | 0 | 0 |
| One correct selection, weight 4, saved 1/4 | 1 | 3 | 0 | 3 | 0 |
| Split-group 4/7 passage plus the 1/4 passage | 4 | 6 | 3 | 3 | 0 |
| Summary-only 7/10 | 0 | 3 | 0 | 0 | 10 |
| One correct, one wrong, one blank, saved 1/3 | 1 | 2 | 1 | 1 | 0 |

## Authority and incomplete evidence

A saved pair must contain non-negative safe integers with correct <= total.
Nonempty numeric strings are accepted for legacy compatibility. Null, missing,
blank strings, booleans, objects, fractions, negative or nonfinite numbers and
out-of-range pairs are rejected. Explicit zero credit is valid. A 0/0 pair is
usable only when no answer slots exist; it cannot hide nonempty detail.

Precedence is the existing AppData `browseScore` evidence when present,
otherwise root `correctAnswers`/`totalQuestions`, then root and nested
`scoreInfo.correct` with `total` or `totalQuestions`, then legacy `score`/`total`.
Pairs are validated together; fields from unrelated candidates are not mixed.
Display-generated scoreInfo (`comparison_calculation` or `display`) is never a
saved grade. DataConsistencyManager captures original aggregate evidence in the
existing browseScore field on its display clone before synthesizing any legacy
display fields. AppData already preserves this evidence through projections.
The denominator fallback uses the same saved candidates: an explicit null in
`browseScore.possible` cannot fall through to a synthesized `totalQuestions: 0`,
and display-generated scoreInfo cannot supply a denominator. Empty answers with
no saved denominator remain unknown. An explicitly saved zero denominator remains
valid for an empty record, including when earned credit was not saved separately.
Display preparation retains an explicit denominator before filling display fields.

If a suite lacks a valid parent pair, resolve each distinct passage recursively
and retain its denominator and incomplete/conflicting detail status. A complete
subset of leaf rows cannot stand in for the whole suite. For example, a 1/1
passage plus a passage with a known denominator of 10 and unknown earned credit
produces unknown/11, ten unknown slots, and unknown missed credit. If a passage's
denominator is unknown, the suite denominator stays unknown unless a valid parent
denominator covers the gap. Each child carries `minimumTotal` even when its final
`total` is null. Only the parent denominator beyond the sum of these bounds adds
unknown slots; known descendants must not be counted again. For example, a
three-question parent containing a nested suite with one known wrong slot, one
ungraded slot, and an unknown-size passage has one incorrect and two unknown
slots, not four unknown slots. Denominators below the child bounds cannot fill
the gap. A valid saved parent grade remains authoritative.
For a leaf record, weighted detail is the fallback. Missing or unknown detail
leaves `correct` and `missed` null when no complete aggregate can be established;
the UI renders **未知**. A known denominator is retained. `summariseEntries`
still exposes the known detail credit separately even for incomplete detail.

Saved totals win over conflicting detail. A detail breakdown is compatible only
when it fits the saved denominator, known credit does not exceed saved credit,
and known wrong plus blank slots do not exceed saved missed credit. Conflicts
produce `detailStatus: 'conflict'`, an unknown breakdown, and a visible message;
they never rewrite grades or manufacture answer-row outcomes.

## Grading metadata, identity and persistence

Weighted detail requires matching complete user/correct-answer snapshots plus
grading evidence: a positive integer weight or recognized submission producer.
Display-generated verdicts remain excluded. Null or stale candidates cannot
mask a later matching boolean. Valid integer partial credit is retained; an
answered weighted failure without partial-credit evidence remains unknown
rather than being assigned zero credit. Missing answer keys never authorize a
boolean verdict, even when a valid weight supplies the denominator.

The grading runtime records `answeredCount`, the number of occupied scored slots
for that row. Split-key checkbox rows use their actual token assignment, while
`userAnswer` still displays the entire selected set. In `p2-medium-245`, selecting
only C assigns one occupied slot to q9 and zero to q10: the group has one earned
slot, zero known wrong responses, and one unanswered slot. Full, wrong, empty,
and over-selected groups retain the submission grading policy.

Display tokens alone cannot establish occupancy for a split row. Matching saved
`answeredCount` is validated against the weight and displayed selection count.
Legacy weight-one selection arrays without this evidence keep occupancy unknown;
normalization preserves that absence as `answeredCount: null` before converting
the array to a display string. Earned credit remains available, but unproven
missed slots are not labeled answered-wrong or unanswered. Empty selections still
establish blank slots. Scalar legacy answers keep their existing classification.

PracticeCore and AnswerSanitizer preserve `weight`, `partialCorrectCount`,
`answeredCount`, and `isCorrectSource` during normalization. The existing AppData detail and full
projections preserve these fields without a storage schema migration. Tests
exercise the normalization path both with and without AnswerSanitizer and
persist a normalized record without a redundant scoreInfo.details copy.

Suite traversal prefers passage records over root aggregate copies. Passage
identity uses sessionId, then id, examId, metadata.examId, or a positional fallback.
Question identity is its canonical question key within that passage. Duplicate
copies of one passage/question count once; distinct sessions and repeated
question numbers across passages remain distinct. Root-only `passage::question`
keys retain their scope, including numeric passage IDs and range questions.

## Reproducible validation and limits

```sh
node --test developer/tests/js/historyScoredCounts.test.js
node --test developer/tests/js/historyScoredCountsPersistence.test.js
node scripts/build-bundles.mjs --check
node scripts/verify-diagnostic-release.mjs
```

The persistence regression opens the actual static index and shipped bundles,
saves seventeen controlled records through AppData into real IndexedDB, including
split selections from the production grading runtime. It opens both detail/full
projections, downloads Markdown through the modal export entrypoint,
reopens and reloads, and compares all saved records including annotations and
the canonical replay snapshot. It uses isolated browser storage and does not
enable sync. Optional `HISTORY_BROWSER_CHANNEL=chrome` or `msedge` and
`HISTORY_ACCESS_MODE=file` select additional browser/access-mode coverage.
The empty-record cases distinguish missing grading evidence, saved 0/0, and a
saved zero denominator without earned credit through each projection and reopen.
The suite and split-selection cases retain incomplete child totals, nested slot
bounds, and both new and legacy occupancy evidence through the same persistence
and display paths. The nested-suite regression also checks the modal's visible
unknown count after both projections, reopen, and reload.

The first four modal assertions fail on opensource baseline
`5cee8fa324227f4ba15f6df65453db9023e08249` with 1/1/4/0 instead of 3/3/6/3.
`HISTORY_SOURCE_ROOT` can point the source regression at another checkout for
reproduction. These are synthetic fixtures, not the reporter's missing original
record. Export is checked for read-only behavior here; exported row-verdict
repair remains #313. Final integrated qualification, the exact reported 3-to-10
observation, and maintainer-controlled main promotion remain tracked in #314.
