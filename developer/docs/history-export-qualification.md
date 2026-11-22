# History and export qualification for #314

Qualification date: 2026-11-22. Parent: [#311](https://github.com/sallowayma-git/IELTS-practice/issues/311).
Source report: [#310](https://github.com/sallowayma-git/IELTS-practice/issues/310).

The integrated `opensource` artifact passes the controlled history/export
qualification. The current `main` artifact still reproduces the confirmed
counter and export defects. The reporter's exact 3-to-10 observation remains
unresolved. **This evidence does not establish that #314, #311, or #310 is ready
to close.** Main promotion and an evidence-supported disposition of the original
report remain outstanding.

The [machine-readable evidence](evidence/history-export-qualification-314.json)
records the commits, builds, browser matrix, observed rows, source regression
results, preservation checks, and release qualification. Fixture provenance is
explicitly synthetic throughout.

## Artifact identity and implementation links

| Artifact | Immutable commit | Qualification result |
| --- | --- | --- |
| Original `opensource` baseline | `5cee8fa324227f4ba15f6df65453db9023e08249` | Four count regressions and 18 of 20 export regressions fail for the intended assertions |
| Integrated `opensource` | `4c8308ce5cf9938a9f891d20790cf35bbe1229c3` | Controlled history/export contract passes |
| Current `main` | `3510cc61e2a55017bcdab2b42f11bdd6ba1108d4` | Confirmed defects remain in source and shipped browser artifacts |

The integrated build is
`sha256:b3389028f2c577ad3d7d66f8f1c8bce63f5e502f54ba3245c6ace6ab5a53f766`.
The main build is
`sha256:444e44a26c1b472f6ec7c9a864695890584d2492f78d298f314867dd8a8a5601`.
The browser checks assert that the loaded page's `AppDiagnosticBuild.buildId`
matches the manifest from the tested checkout. No runtime files were changed
for these tests.

The count repair is [PR #315](https://github.com/sallowayma-git/IELTS-practice/pull/315),
merged as `293aebf3f4f5a08527071c700889420b95ed472e`; its
[final review](https://github.com/sallowayma-git/IELTS-practice/pull/315#pullrequestreview-6007156373)
found no remaining actionable finding. The export repair is
[PR #317](https://github.com/sallowayma-git/IELTS-practice/pull/317), merged as
`4c8308ce5cf9938a9f891d20790cf35bbe1229c3`; its
[final review](https://github.com/sallowayma-git/IELTS-practice/pull/317#pullrequestreview-6010707232)
covers the corrected cold-export dependency. The integrated tree is identical
to reviewed export head `ada54502890f2f3d6c9ea0695d218aa3be83c7b8`.

## Original-report investigation

The [original comment](https://github.com/sallowayma-git/IELTS-practice/issues/309#issuecomment-7059764779),
issues #310-#314, both implementation PRs and review discussions, the associated
local implementation/review evidence directories, and
`historyCountFixtures.mjs` were examined. They contain narrative observations
and controlled reproductions, but no reporter-supplied saved record, original
Markdown file, browser version, access mode, or affected artifact identity.
The fixture module explicitly identifies its records as synthetic.

The representative saved 4/7 record contains three ordinary wrong answers and
the correct Q7/Q8 = C/E and Q9/Q10 = B/D groups. On both pinned affected source
baselines and the actual main browser build, history shows three errors and
preserves all four grouped outcomes. Main's actual Markdown download marks
those four answers wrong. The integrated artifact preserves the grouped
outcomes in both places.

This establishes a separate reproducible export inconsistency and rejects the
representative fixture as a reproduction of the original 3-to-10 observation.
It does not establish why the reporter saw ten, nor does it identify a version
or data difference for that unavailable record. The original-report acceptance
item must remain unchecked.

## Integrated observations

Counts measure scored slots. The repaired **unearned** count includes missed
credit; it is distinct from known wrong responses and known blank slots. See
the [shared contract](history-scored-counts.md).

| Controlled input | Affected modal count | Integrated result | Actual exported outcome after repair |
| --- | ---: | --- | --- |
| Weighted 0/3, three wrong selections | 1 | 3 unearned, 3 known wrong | Incorrect |
| Partial 1/4, one correct selection | 1 | 3 unearned, 3 known blank | `Partial 1/4` |
| Suite 5/11 | 4 | 6 unearned, 3 known wrong and 3 known blank | Saved 5/11 aggregate retained; nested passage rows remain export-completeness scope in #309 |
| Summary-only 7/10 | 0 | 3 unearned, 10 unknown detail slots | No invented per-question verdicts |
| Split C/E and B/D groups, saved 4/7 | 3 | 3 unearned, all four group members correct | Four check marks; main exports four crosses |
| Missing answer key and unknown verdict | 0 | Unearned unknown, one unknown detail slot | `Unknown`; main exports a cross |
| One correct, one wrong, one blank | 1 | 2 unearned, one known wrong and one known blank | Correct, incorrect, `No Answer` |
| Duplicate selection in a split group | 1 | One earned and one missed slot | One correct and one incorrect outcome |

The source regressions also cover canonical-key conflicts, stale/missing
snapshots, display-generated verdicts, legacy details and aliases, zero and
missing grades, repeated question numbers across distinct passages, duplicate
passage copies, nested suites, and occupancy from production submission data.

## Browser and persistence matrix

| Browser | Access | Integrated `opensource` | Current `main` |
| --- | --- | --- | --- |
| Chrome 157.0.8103.79 | Static localhost HTTP | Pass | Known defects reproduced; contract fails |
| Chrome 157.0.8103.79 | `file://` | Pass | Known defects reproduced; contract fails |
| Edge 158.0.4370.33 | Static localhost HTTP | Pass | Known defects reproduced; contract fails |
| Edge 158.0.4370.33 | `file://` | Pass | Known defects reproduced; contract fails |

The existing shipped-bundle regression passed **21 controlled records in each
of the four integrated combinations**, including fallback exports, normalized
records, missing/zero denominators, nested incomplete suites, and production
split selections with and without occupancy evidence.

The new artifact comparison additionally persisted eight controlled records
and one unrelated sentinel per combination on both branches. It uses
`AppData.practice.completeAttempt`, real IndexedDB, the cold overview
`AppActions.exportPracticeMarkdown` entrypoint, actual single-record Markdown
downloads, and both `detail` and `full` projections. It waits until the real
modal is visible, checks row semantics, clicks the close button, reopens the
record, reloads the page, and compares every full saved record with its initial
persisted value. Scores, answer maps, grading snapshots, annotations, replay
inputs, and the unrelated record remain unchanged. Cold export is tested while
Browse is still unloaded. Both comparison and fallback exporter paths are also
covered by the 21-record suite and source regressions.

Storage is isolated per run. Folder sync remains disabled/unbound, with zero
completed synchronizations; main does not include that service. The comparison
asserts zero external HTTP/HTTPS requests. A successful **affected-mode** test
means the specified defects were reproduced; it is not a product acceptance
pass.

## Repository and release checks

Local validation used Node.js v24.22.3 and Python 3.14.3:

- Complete JavaScript suite: **980 passed, 0 failed**.
- Python unit suite: **52 passed**; reading-data integrity: **239 files passed**.
- The four focused modal assertions fail on each affected baseline with
  `1/1/4/0` instead of `3/3/6/3`. The 20 export assertions give **18 failures,
  two passes** on each affected baseline. All focused regressions pass in the
  integrated suite. Failures were checked to be assertion failures rather than
  missing-source or dependency errors.
- Bundle drift checks: **18 outputs current** on both artifacts. Local diagnostic
  verification: **25 required assets**, 227 mapped sections for integrated
  opensource and 208 for main.
- [CI on the exact merged commit](https://github.com/sallowayma-git/IELTS-practice/actions/runs/44994174847)
  passed verify, Ubuntu release qualification, and Windows release qualification.
  All **22 unified E2E flows** passed in that verify job.
- Downloaded release evidence confirms **528 extracted runtime files** match
  source on each platform, all **nine HTTP/HTTPS/file package flows** pass, and
  all **222 diagnostic scenarios** pass per platform. Release manifests identify
  the same integrated build. The packaged diagnostic mapping has 225 sections
  after release pruning; the source verifier has 227.

## Reproduction commands

Run the existing focused suite and bundle checks from the integrated checkout:

```sh
node --test developer/tests/js/historyScoredCounts.test.js developer/tests/js/markdownOutcomes.test.js
node --test developer/tests/js/historyScoredCountsPersistence.test.js
node scripts/build-bundles.mjs --check
node scripts/verify-diagnostic-release.mjs
```

Run the new collector from a checkout containing this test, selecting a clean
runtime checkout with `HISTORY_RUNTIME_ROOT`:

```sh
HISTORY_RUNTIME_ROOT=/absolute/path/to/pinned-opensource HISTORY_EXPECTATION=repaired HISTORY_BROWSER_CHANNEL=chrome HISTORY_ACCESS_MODE=http node developer/tests/e2e/history_export_qualification.mjs
HISTORY_RUNTIME_ROOT=/absolute/path/to/pinned-main HISTORY_EXPECTATION=affected HISTORY_BROWSER_CHANNEL=msedge HISTORY_ACCESS_MODE=file node developer/tests/e2e/history_export_qualification.mjs
```

Use both `chrome` and `msedge`, and both `http` and `file`. On PowerShell, set
these through `$env:NAME = 'value'` before invoking Node. The collector writes
`evidence.json`, the synthetic input, actual Markdown downloads and visible-modal
screenshots beneath `developer/tests/e2e/reports/history-export-qualification/`;
`HISTORY_EVIDENCE_DIR` overrides that destination. Failures exit nonzero and
record their phase. `HISTORY_SOURCE_ROOT` and `MARKDOWN_SOURCE_ROOT` select the
pinned sources for failing-before unit assertions.

## Remaining acceptance work

1. Obtain the original affected record/export and artifact identity, or evidence
   that explains the reported version/data difference. The current representative
   fixture cannot discharge this criterion.
2. Obtain maintainer-approved promotion of the reviewed repairs to main and
   rerun qualification on the actual promoted commit/build. This test work does
   not authorize or perform that promotion.

The current results qualify the integrated opensource implementation and
document main's failures. They do not waive either remaining requirement.
