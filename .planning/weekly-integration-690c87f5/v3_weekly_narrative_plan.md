# Weekly v3: remote data layer + local narrative layer

Approved 2026-10-20. Continues on `codex/weekly-v2-integrate-690c87f5` in the
integration worktree. No commit, no push. Frozen `.atlas-exam` theme untouched.

## Verdict

Additive, not alternative: remote weekly data layer (window/state machine, eight
skill analyzers, 77a3a708 statistics, failure budget, dedupe, IPC allow-list)
stays the only data authority; the snapshot 01157c95 narrative design becomes the
only prose writer. One write path, one schema: `schemaVersion: 3`.

## v3 contract

```jsonc
{
  "schemaVersion": 3,
  "window": "...",
  "windowStart": "...", "windowEnd": "...",
  "state": "live|final|final_no_ai|narrative_failed",
  "generatedAt": "...",
  "displayTitle": "...",            // Rust only: narrative.title ?? derive_title(blocks)
  "blocks": [ /* remote eight-block structure, no per-block narrative */ ],
  "facts": { /* top-level map: id -> {value,label,format,source,provenance} */ },
  "narrative": {
    "title": "...",
    "body": ["..."], "changes": [...], "nextSteps": [...],
    "strengths": [...], "weaknesses": [...],
    "askUser": null,
    "validation": { "final": { "removed": 0, "violations": [] } }
  } | null,
  "profileEdits": [ { "key": "soul.toneSuggestion", "value": "...",
                      "evidenceIds": ["qtype.tfng.wrong"],
                      "reason": "...",
                      "revisionId": "soulrev-..." } ],
  "memoryChanges": []
}
```

Legacy formats are read-only display: remote v2 blocks-only rows and local v2
body/facts rows. Never written.

`profileEdits.evidenceIds` cite **fact ids**, not `obs-*`: the write path
resolves each id in the report's top-level facts map and reads its
`provenance.assetId/assetIds` to enforce the two-asset rule. Observation ids do
not exist in that map. (Revised 2026-10-20; the earlier `obs-...` example was
not implementable.)

## User corrections (override earlier draft)

1. nextSteps Chinese-count exception restored: `counts_allowed = key == "nextSteps"`.
   Body/changes/strengths/weaknesses still require a fact for every Chinese count.
   Tests must cover the exception.
2. `FinalNoAi` writes `narrative: null`; no host fallback body. Delete
   `generatedBy` and `fallbackReason`. UI shows only data blocks for `live`,
   `final_no_ai`, `narrative_failed`.
3. One Rust title derivation: `display_title = narrative.title ?? derive_title(blocks)`,
   returned in the report. UI never derives.
4. `narrative.validation` keeps only `final`; preflight/debug data goes to run
   record/logs, never report JSON.
5. On v3 write assert `facts == project(blocks, soul)` exactly, with a test; Soul
   edits and report write in one transaction.
6. Facts top-level.
7. No `q:` facts initially (remote blocks carry no original quote text). The rule
   "never quote without a q fact" stays.
8. `assetIds` provenance added to question-types and repeated-misses block data;
   examples never independently generate facts.
9. Model calls per weekly attempt <= 3 (first + one repair + one retry).
10. Soul migration is `0035_soul.sql` after v34; backup format 22; round trips
    cover 19-local, 19-remote, 20, 21, 22.

## Fact projection (48)

- Volume 7: reading, writing, days, minutes, total, previous.reading, previous.writing
- Accuracy 7: correct, answered, blank, total, rate, previous.correct, previous.answered
- Question types 2 x 4: wrong, answered, rate, passages
- Repeated misses 3: across.passages, across.wrong, same.1.attempts
- Redo 4: redos, fixed, stillWrong, newlyWrong
- Writing 11: count, average, weakest.times, previous.count, previous.average,
  latest 2 essays x (band + 2 lowest criteria)
- Coach 4: top 2 feedback counts, reasks, attempts
- Plan 3: totalMinutes, top 2 item minutes
- Exam 1: `exam.days`

Formats: `number|percent|minutes|band`. IDs are stable and semantic, labels in
Chinese. `source` names the block. `provenance` carries `assetIds`/`assetId`.

## Order

1. Data layer: v3 domain/store/projector, block asset provenance, pack schema 3,
   migration 0035, backup 22, IPC for Soul, legacy read-only.
2. Narrative + prompt: snapshot validator with nextSteps exception, one repair via
   `dream.run_weekly validateOnly`, v3 digest, delete per-block sentence path,
   0.6 / 2500 tokens, final-only validation.
3. Soul incl. SoulSettings: port soul.rs, soul_get/update/undo, revision IDs in
   profileEdits, single transaction.
4. Daily journal A: phrasing.js, compose.js, insight.js + backend daily facts per
   77a3a708.
5. Notebook page B: MascotState, MoodMascot, fan dashed slots, monthly placeholder,
   global numbering, WeeklyDetail/WeeklyText typography, charts as appendix.
6. Tests: new weekly_soul_v3.rs + weeklyV3.test.mjs, rewrite all affected suites,
   mocks, preview, packaged flow.

Record one entry in `.planning` after each layer.

## Acceptance (unchanged, no relaxed assertions)

1. `python developer/tests/e2e/notebook_preview.py`
2. `python developer/tests/e2e/notebook_visual_check.py`
3. `python developer/tests/e2e/integration_exam_compare.py`
4. `python developer/tests/ci/run_static_suite.py`
5. `python developer/tests/e2e/suite_practice_flow.py`
