# Reading Analytics v1

Issue: #152. The selected repeat-attempt policy is **every eligible submission**.
This contract applies to the Reading analytics panel on the practice-record page.

## Population and units

- Use the selected record type and history search. Search matches the same
  visible record fields as the history list; a matching suite row includes all
  its children, and child titles do not broaden the selected scope. Listening-only selection has
  no Reading population. Never resolve a historical record against the active
  Browse library. Demo records, drafts, interrupted/cancelled attempts, and
  explicitly ungraded/ungradable records are excluded.
- Default to all saved history. The optional last 7/30/90 days include today
  and the preceding 6/29/89 local calendar days, through the current instant.
  Use the saved submission time, then the containing suite's submission time
  for an undated child. Undated historical records remain in all-history results
  but are excluded, with a count, from dated windows. Do not invent dates.
- A passage submission is one single-passage record or one suite child. Retakes
  count separately. Missing scores do not erase a saved submission: show both
  submission count and the subset with usable scores.
- Distinct passages use `[libraryConfigurationId, "reading", examId]`.
  An explicit `null` library ID means the built-in library; an absent or invalid
  ID is unknown. Unknown identities contribute to submission counts, never a
  guessed distinct-passage count. Report identity coverage.
- Accuracy is `sum(earned) / sum(possible)`, displayed as a percentage. Earned
  and possible scores are points, including fractional/partial credit. For
  example, 1/2 + 9/10 = 10/12 = 83.3%, not 70%. No arithmetic mean of attempt
  percentages is shown. A usable score requires finite numbers,
  `0 <= earned <= possible`, and `possible > 0`.
- Use explicit saved score counts; never reconstruct earned/possible scores
  from percentages, error counts, answered fields, or boolean correctness.
  Unknown/invalid/zero denominators produce unavailable accuracy, not 0%.

## Suites and duplicate representations

- Expand suite parents into children and exclude their totals from passage
  metrics. Preserve exact child record/session IDs and parent session linkage.
  Deduplicate exact record/session representations within a source and passage;
  also deduplicate an explicitly linked standalone child against that parent's
  child. Exact parent linkage can deduplicate a legacy child's representations
  with unknown provenance without supplying a distinct-passage identity. Known
  conflicting library sources remain separate. Do not deduplicate by exam ID
  or a nearby timestamp alone.
- Resolve duplicates before applying the history search or date window. Saved
  suite children take precedence over their standalone representations.
- If some children or scores are missing, aggregate only available eligible
  children, disclose scored coverage and the known missing-child count, and
  never subtract children from a parent total to manufacture missing scores.
- If no child observations are available, retain a valid Reading suite total
  **separately**, labelled as suite-only totals. It is not a passage attempt,
  distinct passage, P1/P2/P3 observation, or question-type observation. Explicitly
  linked standalone children can supply the parent's passage observations.

## Categories, question types, and historical records

- Category is a saved P1/P2/P3 snapshot from that passage's source. Never infer
  it from the exam ID, suite position, or the currently selected library. A
  missing category remains unknown even when the total score is usable.
- Question-type statistics use explicit per-type earned and possible points
  from the scoring result (`correct`/`total` or the corresponding count aliases).
  Known spelling aliases may be normalized; `other`, unknown, missing, and
  unrecognized types remain unclassified. Error counts do not supply scores.
- Only usable graded passage observations contribute to the type breakdown.
  Invalid type pairs are omitted. A breakdown whose known points exceed the
  passage's earned or possible total, or whose remaining earned credit exceeds
  the remaining possible credit, is inconsistent and is excluded. Partial
  valid breakdowns remain usable and are labelled by coverage: fully classified
  scored submissions and classified possible points / all scored possible points.
- Each category row shows weighted accuracy, earned/possible points, scored /
  submitted observations, and known distinct passages. Type rows show weighted
  accuracy, earned/possible points, and contributing submissions.
- The additive `readingAnalytics` summary (version 1) preserves category,
  per-type scores, suite markers and linkage. Existing `browseScore` preserves
  original score/date evidence before legacy display normalization. Legacy
  summaries are resolved with matching detail snapshots when needed; annotations
  and the active catalog are not read. No destructive migration is required.
- New suite metadata is captured from the launched sequence and carried through
  recovery/finalization. When a saved suite identifies its source, resuming
  requires that library; a source mismatch retains the recovery snapshot until
  the original library is selected.
  Flat completion payloads retain raw scores and eligibility flags before
  compatibility display defaults, including genuine graded zeros.
  Historical fields unavailable in either summary or detail stay unknown;
  no guessed enrichment from today's catalog is allowed.

## Delivery checks

Exercise weighted and fractional scores, repeated passages, exact suite-child
deduplication, parent-only and incomplete-suite fallbacks, unknown provenance,
category/type/denominator/date gaps, record/search/window filters, and empty
states. Verify metadata round trips and existing draft/suite recovery. Run the
browser acceptance flow under `file://`, HTTP at the origin root, and HTTP under
a static-hosting subdirectory. The feature needs no API, fetch, or server state.

Per-question timing, recommendations, and SM2 scheduling are outside this slice.
