# Integration progress

2026-10-20: User authorized implementation of six-phase plan.
- Read root AGENTS.md and planning-with-files skill.
- Verified source clean, HEAD 01157c95, target tracking ref 690c87f5.
- Created branch codex/weekly-v2-integrate-690c87f5 in F:/workspace/IELTS Atlas integration.
- Original F:/workspace/IELTS Atlas APP remains on source snapshot, unchanged.
- Created planning records; next inspect exact migration/backup and UI code before modifications.

Data work: added recognized snapshot migration bridge and format 21 backup compatibility. Reading tags derive from remote scoring classifier. Added read-only historical digest command; no old writer.
Errors: initial compile exposed missing AssetIndexEntry fixture field; corrected. Two exploratory reads used non-existent paths; located correct modules.

155 targeted Rust tests passed. Independent audit found restore-time reading-index backfill missing; fixed inside restore transaction. Ported independent UI; retained remote draft safety, font alias, typed writer and ACL. Vue typecheck/build and integration/mock JS checks pass. Frozen sidecar rebuilt in isolated Python environment and smoke passed (cold start 416ms). Remaining: broader checks, additional data edge cases, visual verification and native flow.
Errors: original Compose patch context no longer matched new template; restored two remote safety blocks manually. A synthetic old-backup test retained new Soul table incorrectly; corrected fixture boundaries.

Adversarial data checks passed: bridge rollback, original pre-migration snapshot content, Soul run FK/undo self-reference and restore-time question tags. 18 exam scenes match independently built remote 690c87f5 on this host; tracked CI baseline remains unchanged (its cross-host run reports drift). Actual dev mock exercised 6 routes, weekly modal and old history at 1440/1024/390 without page/console errors. Fixed preview selector to current history data hook after initial timeout. Static suite is running.

Planning records moved to scoped .planning folder; pre-existing root M3/M5 historical planning files restored exactly to target bytes. No historical planning content is replaced by integration notes.

Full static run 1: 52/56; corrected lossless backup issue, old-format fixture and a timezone-dependent pre-existing test, plus false positive on a deliberate unknown-command test. Full run 2: 55/56; only reading_asset_revision old migration list expected 33. Updated to include 34 without relaxing assertions. Final full static run in progress. Mobile weekly modal visual QA exposed narrow heading and missing teleported theme inheritance; fixed responsive header, themed backdrop and focus containment; preview re-passed. Added durable coach feedback mock after independent frontend audit.

Final static suite: 56/56 passed (2026-10-20 14:35 UTC). Fresh strict sidecar release build passed in 3m17s; binary is target/release/ielts-practice-tauri.exe in integration worktree. Required native suite invoked after the passing static suite. Original snapshot workspace verified clean; remote core files remain unchanged.

Native run 1: 22/23 passed; weekly timed out without a run. Independent source audit identified stale E2E seeding: blank answers satisfy raw attempt scoring but remote P1 correctly excludes them from learning evidence. Fixed only harness: submits canonical nonempty answers, refreshes projection, asserts current-projector scored observations in (Sunday-28days, Sunday]. Added SQL boundary/unanswered/projector regression (8 weekly helper tests pass). Re-running required static then native sequence.

Final sequence completed 2026-10-20 14:54 UTC: static 56/56, packaged native 23/23. Weekly receipt drmrun-beb8df81-9fa9-4980-980b-4deb8908233f used 13 scored reading observations, exactly one weekly provider request, displayed final week 2026-W43. The mock scanner initially misclassified observation-type SQL literals as skill keys; added narrowly documented file/name exceptions and reran the full sequence successfully. No production code changed for this harness correction. All six phases complete; changes remain uncommitted, no push.

## v3 narrative integration (continues on the same branch, no commit)

Layer 1 (data layer) complete and verified:
- Domain v3: one `display_title` (`narrative.title ?? derive_title(blocks)`), top-level `facts`, `profileEdits`, final-only `validation.final`; v2 read-only (`title` alias, block `narrative` alias).
- Facts projector: semantic IDs/labels/formats/provenance from the eight blocks; `assetIds` added to question-types and repeated-misses; examples never produce facts; Soul exam countdown.
- Store: one v3 writer rejects any schema but 3, refuses non-`Final` narratives, re-projects `facts == project(blocks, soul)` and the single title, and stores Soul edits + report + run completion in one transaction.
- Soul module: profile/validation, append-only revisions, model edits gated on evidence from >=2 distinct assets, undo refuses after a later user edit; migration `0035_soul.sql`; backup format 22 with 19-local/19-remote/20/21/22 round trips.
- Pack schema 3 carries blocks/facts/soul/persona/previousDigest; weekly history keeps old rows read-only.
- Host paths: `FinalNoAi`/`NarrativeFailed` carry `narrative: null`; `fallbackReason` removed; an unusable model narrative fails the run (`weekly.narrative_empty`) instead of host prose.
- Verified: `ielts-db` lib 145/145; store/backup/data-safety integration 45/45; Tauri journal + daily-worker 11/11. Compile clean (three pre-existing `AgentCancelRegistry` visibility warnings only).

Layer 2 (narrative + prompt) complete and verified:
- Python now has one v3 path: prompt rules ported from snapshot `_build_system_prompt_v2` (facts only for numbers, no q facts so no verbatim quotes, identifiers, band/fact pairing, nextSteps-only Chinese-count exception, two-asset repetition, Soul/tone/previousDigest rules), temperature 0.6, 2500 tokens, at most three model calls (first + one validateOnly-driven repair + one retry).
- `dream.run_weekly` handles `validateOnly: true` before `ensure_journal`: same facts/soul as the write path, returns `{usable, needsRepair, droppedSentences, violations}` and creates no journal/run/report.
- Per-block sentence writer (`_build_narrative`, `sentences`) deleted. Model-unavailable or fewer than 8 observations submits `modelAvailable: false` with no prose.
- `test_protocol.py` updated from v2 (`sentences`, 4000 tokens) to v3 (`digest`, 2500, preflight then submit).
- Verified: Python 158/158; Tauri lib 121/121 (including new validateOnly write-free test); `cargo check` clean.
- Contract note: `profileEdits.evidenceIds` name fact ids, not `obs-*`. This is forced by `soul_apply_edits_in_transaction`, which resolves each id in the report's top-level facts map and reads its `provenance.assetId/assetIds`; observation ids are not present there. The approved v3 schema example showing `obs-...` is superseded by this rule.

Layer 3 (Soul) complete and verified:
- New `commands/soul.rs` exposes `soul_get/soul_update/soul_undo` on the existing DB module; registered unconditionally in `commands/mod.rs` and `lib.rs`.
- `allow-soul-get/update/undo` added to `capabilities/main.json`; ACL tests prove the three commands pass the real capability file and still reject bad arguments, while host-only `delete_secret` remains denied.
- Ported `soul-repository.js` and `SoulSettings.vue` adapted to the integration shape (bare profile values, backend error passthrough), mounted at the snapshot position in `SettingsPage.vue`.
- Verified: Tauri lib 121/121; ACL checker 127 reachable commands; Vue build and typecheck pass.

Layer 4 (daily journal prose A) complete and verified:
- Ported snapshot `insight.js` (headline/reading/writing/model/tomorrow/changes/mood) onto the 77a3a708 fact shape (camelCase and snake_case), expanded `phrasing.js` to the snapshot BANK/RULES, and rebuilt the daily `buildNotebookEntry` to the snapshot design while keeping the page-safe fields (`observations`, `notes`, `changes`, `changeLead`).
- No Rust facts changed; no new fields invented. Missing v2-only inputs degrade to empty sections.
- Weekly/legacy/preferences functions untouched.
- Verified: notebook JS 52/52; Vue build passes.

Layer 5 (notebook page B) complete and verified:
- `NotebookPage.vue` restored to the snapshot shelf: MascotState empty state, month navigation, fan-rotated week cards on Thursday slots with dashed empty weeks and a monthly placeholder, global numbering, daily cards with summary lines, change pills and MoodMascot. Both `data-notebook-entry` and `data-notebook-day` remain on day cards; week cards carry `data-notebook-week` + `data-week-state`; `WeeklyShelf.vue` deleted.
- `weekly.js` reads v3: `displayTitle` verbatim (no JS derivation), narrative paragraphs/groups/askUser, facts formatted by host `format`, cards from cited narrative points and `facts['volume.total']`; v2 remote/local shapes remain read-only. New `WeeklyDetail.vue`/`WeeklyText.vue` render narrative first, `{{f:ID}}` as citation buttons with a fact-label source note, charts after as `data-weekly-data`; `live`/`final_no_ai`/`narrative_failed` are data-only and ignore any stored narrative.
- `WeeklyReportBody.vue` reduced to the typed-block appendix; no state line/memory duplication.
- Verified: notebook JS 66/66 (weekly 14), Vue build/typecheck pass, Tauri lib 121/121, ielts-db lib 145/145, Python 158/158, ACL 127 reachable commands.
- Left for Layer 6: dev mock and preview/E2E still speak v2; v3 `FactProvenance` has only `assetId/assetIds/memoryIds`, so citation source text uses the fact label rather than a date/title/task description.

Layer 6 (tests, mocks, preview, packaged flow) complete and verified:
- v3 Rust integration: weekly_soul_v3 6/6; dev mock rewritten to v3 and accepted by `check_mock_contracts.py` (66 files, 156 commands, 27 catalog skills); Tauri lib and ielts-db suites green after the migration-list fixes (35 included; assertions unchanged).
- Preview/visual: `notebook_preview.py` and `notebook_visual_check.py` pass against the v3 sheet (final = narrative + citations + charts appendix; live/final_no_ai/narrative_failed = data-only). Shelf order is asserted physically by calendar and logically newest-first; `§本周数据` is required only in the final narrative branch. Exam freeze comparison remains 18/18 with the tracked baseline untouched.
- Static gate: 56/56 (2026-10-20 17:20 UTC), run after the Rust fixes below.
- Packaged flow root cause (product bug, not harness): the host's `model.invoke` gateway required `temperature == 0.0` for every sidecar call ("memory model temperature must be zero"), while the v3 weekly narrative sends the snapshot's 0.6. Every weekly call failed instantly as `ProtocolError`; the sidecar returned `fallbackReason: model_invoke_failed:ProtocolError`, and the host treated that fallback as a successful audit — no dream run, no report, so the flow waited 180s on an empty `dream_runs`.
- Fix: per-run temperature policy in `cognitive_runtime.rs` (WeeklyDream allows 0.0..=1.0; memory candidates stay exactly 0.0), and `daily_worker::weekly_run_result` now classifies a non-empty `fallbackReason` as a failed attempt so it is recorded and retried under the existing caps (a model-free submission still succeeds through `dream.run_weekly`).
- Tests added: weekly 0.6 accepted / memory 0.6 rejected / weekly 1.5 rejected; fallback result rejected as an attempt, success result accepted. Targeted tests pass.
- Packaged result: 23/23 passed, exit 0. Weekly run `drmrun-fe767fea-07c1-4246-9263-5c5058aeb70a` (`weekly:2026-W43:2026-09-27T09:00:00Z..2026-10-25T09:00:00Z`), 26 scored outcomes, exactly one weekly provider request, final v3 narrative: 2 paragraphs, 5 blocks, 3 chart series; citation rendered `依据：本周阅读篇数` with value 3; Soul companion note applied and undone through `SoulSettings`.
- All layers complete in the working tree. Changes remain uncommitted; nothing pushed.
