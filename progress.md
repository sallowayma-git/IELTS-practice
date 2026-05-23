# Listening Record Persistence Progress

## Session Log
- Restated task: repair listening record persistence where child finish action may not post completion to parent, and parent-child handshake is missing.
- Used `planning-with-files` because the task crosses protocol, UI event capture, storage, and tests.
- Attempted previous session catchup; script exited 1 with no output.
- Inspected dirty worktree and found prior partial changes in listening bridge, parent session mixin, and regression tests.
- Implemented child bridge protocol split: bootstrap ready is now `initialized: false`, INIT ack ready is `initialized: true`, and child sends `REQUEST_INIT` retries.
- Expanded child finish capture beyond direct button clicks: delegated click, pointer/touch, form submit, keyboard activation, and non-button onclick/data-action DOM.
- Updated parent `handleSessionReady()` so pre-init listening ready does not stop handshake and instead triggers an immediate INIT resend.
- Updated parent handshake tick to rebuild payload each retry and store attempt metadata.

## Verification Log
- `node developer/tests/js/suiteModeRegression.test.js` passed.
- `node --check js/listeningRecordBridge.js` passed.
- `node --check js/app/examSessionMixin.js` passed.
- `node scripts/build-bundles.mjs` passed twice after final bridge edits.
- `py developer/tests/e2e/listening_bridge_optional.py` passed twice; report confirms pre-init ready, REQUEST_INIT, initialized ready, and non-button finish DOM completion.
- `py developer/tests/ci/run_static_suite.py` passed after final edits.
- `py developer/tests/e2e/suite_practice_flow.py` passed after final edits.

## Continuation Log
- Spawned three subagents for parent protocol/recorder chain, real listening DOM patterns, and test coverage review.
- Confirmed the remaining bug was completion-before-ready: parent could call real recorder completion before the recorder had an active session.
- Patched `js/app/examSessionMixin.js` to ensure listening bridge completions create/sync recorder session before `handleSessionCompleted`.
- Patched `js/main.js` fallback listener to keep INIT alive for pre-init ready, respond to `REQUEST_INIT`, and match completion by child window if the child has a temporary session id.
- Added `developer/tests/js/suiteModeRegression.test.js` Case 12 for complete-before-ready session repair.
- Rebuilt bundles with `node scripts/build-bundles.mjs`; bundle files are ignored but local file:// runtime now contains the fix.

## Continuation Verification
- `node --check js/main.js` passed.
- `node --check js/app/examSessionMixin.js` passed.
- `node --check js/listeningRecordBridge.js` passed.
- `node developer/tests/js/suiteModeRegression.test.js` passed.
- `py developer/tests/e2e/listening_bridge_optional.py` passed.
- `py developer/tests/ci/run_static_suite.py` passed.
- `py developer/tests/e2e/suite_practice_flow.py` passed.
- Added delayed finish-hook coverage after real DOM review found `startHookSync()` could stop before late `finishTest`/`gradeAnswers` functions appeared.
- `node --check developer/tests/e2e/listening_bridge_optional.py` was a tool mistake and failed because Node cannot syntax-check `.py`; replaced with `py -m py_compile developer/tests/e2e/listening_bridge_optional.py`, which passed.
- Re-ran final checks after the delayed-hook patch: `py developer/tests/e2e/listening_bridge_optional.py`, `py developer/tests/ci/run_static_suite.py`, and `py developer/tests/e2e/suite_practice_flow.py` passed.
- One `suite_practice_flow.py` run failed before the final pass because random selection hit `p1-low-223`, whose explanation manifest entry points at a missing `assets/generated/reading-explanations/p1-low-223.js`. This is an existing reading asset inconsistency, not caused by the listening repair.

## Environment Notes
- `python` resolves to a Microsoft Store alias and exits 1 with no output.
- Used `py` (Python 3.10.11) for Python scripts.

## Final Handoff Completion
- Spawned two read-only subagents:
  - Hegel reviewed `js/main.js` legacy fallback and found missing `{ realData }` payload extraction plus missing `spellingErrors` vocabulary persistence/normalization.
  - Raman reviewed `developer/tests/e2e/listening_bridge_optional.py` and found inconsistent collector injection, weak real parent vocab assertions, and missing `#btnFinish` coverage.
- Patched `js/main.js` fallback completion path:
  - `extractCompletionPayload()` now recognizes `realData` wrappers and spelling-error-only completion payloads.
  - Added fallback spelling-error normalization so `examId/source/sessionId` come from the parent matched session and current listening exam.
  - Saves normalized errors through `window.spellingErrorCollector.saveErrors()` after practice record persistence.
- Patched optional listening E2E:
  - Centralized fixture script injection for `spellingErrorCollector.js` + `listeningRecordBridge.js`.
  - Added/kept coverage for 3-column results tables and `data-q` inputs.
  - Expanded real finish selector to include `#btnFinish`, `data-action`, and text selectors.
  - Strengthened real `file://` parent probe to assert practice record plus P1/master vocab word `examId`, `source`, and `userInput`.
- Added `developer/tests/js/practiceRecordPersistence.test.js` regression for legacy fallback `realData.spellingErrors`, covering normalization away from `listening-unknown/other`.

## Final Verification
- `node --check js/main.js` passed.
- `node --check js/listeningRecordBridge.js` passed.
- `node --check js/app/examSessionMixin.js` passed.
- `py -m py_compile developer/tests/e2e/listening_bridge_optional.py` passed.
- `node developer/tests/js/suiteModeRegression.test.js` passed.
- `node developer/tests/js/practiceRecordPersistence.test.js` passed.
- `node scripts/build-bundles.mjs` passed.
- `py developer/tests/e2e/listening_bridge_optional.py` passed; report includes real parent persistence with `practice_records`, `vocab_list_p1_errors`, and `vocab_list_master_errors`.
- `py developer/tests/ci/run_static_suite.py` passed.
- `py developer/tests/e2e/suite_practice_flow.py` passed.

## Real file:// Static Bridge Repair
- Reproduced the remaining architectural gap from user logs: parent-side injection cannot be trusted under real Chrome `file://` unique origins.
- Added `js/bundles/listening-record-bridge.bundle.js` as a static child-page dependency to all 225 formal listening HTML files under `ListeningPractice/P1` through `ListeningPractice/P4`.
- Removed old static `js/practice-page-enhancer.js` tags from 55 listening HTML files to avoid two independent completion producers on the same child page.
- Updated `js/app/examActions.js` and `js/presentation/app-actions.js` so browse/random start paths prefer `window.app.openExam()` before the legacy global fallback.
- Updated `js/app/examSessionMixin.js` dynamic injection guard to detect existing bridge scripts anywhere in the child document, not only in the chosen host node.
- Added `developer/tests/ci/run_static_suite.py` static guard: all 225 P1-P4 listening pages must have exactly one valid bridge script, the data marker, a correct relative path, no post-`</body>` placement, and no old enhancer.
- Extended `developer/tests/e2e/listening_bridge_optional.py` with a no-flag Chromium pass for `P2/次高频/8. P2 Plan of Community Center (VIP)`, proving real `file://` static self-load, initialized handshake, Finish capture, and `practice_records` persistence.

## Real file:// Verification
- `node --check js/main.js` passed.
- `node --check js/listeningRecordBridge.js` passed.
- `node --check js/app/examActions.js` passed.
- `node --check js/presentation/app-actions.js` passed.
- `node --check js/app/examSessionMixin.js` passed.
- `py -m py_compile developer/tests/ci/run_static_suite.py developer/tests/e2e/listening_bridge_optional.py` passed.
- `node scripts/build-bundles.mjs` passed.
- `node developer/tests/js/suiteModeRegression.test.js` passed.
- `node developer/tests/js/practiceRecordPersistence.test.js` passed.
- `py developer/tests/e2e/listening_bridge_optional.py` passed; report includes `fileOriginStaticBridge` for Community Center P2 with `initialized: true`, `completed: true`, and persisted listening record.
- `py developer/tests/ci/run_static_suite.py` passed; `Listening 静态 bridge 覆盖守卫` reports 225 HTML covered and 0 legacy enhancer hits.
- `py developer/tests/e2e/suite_practice_flow.py` passed.
- Removed Python `__pycache__` directories generated by local compile/test runs.

## Spelling Error Vocabulary Repair
- Audited the spelling-error write path and vocab study consumption path with two read-only subagents plus local inspection.
- Patched `js/app/spellingErrorCollector.js` so saved spelling errors are enriched at persistence time with core lexicon Chinese meanings, examples, notes, SM-2 defaults, and preserved spelling metadata.
- Added `file://` compatible lexicon loading to the collector: embedded `ielts_core` first, then `assets/wordlists/ielts_core.json` via fetch/XHR fallback.
- Made collector list loading tolerant of both legacy object lists and arrays written back by `VocabStore`.
- Patched `js/core/vocabStore.js` so old raw spelling-error lists are still normalized, but `meaning` no longer falls back to `你曾拼写为: ...`; missing lexicon entries use `暂无中文释义` and keep misspelling context in `note`.
- Preserved spelling metadata through vocab study updates: `userInput`, `questionId`, `suiteId`, `examId`, `errorCount`, accepted/canonical answers, reason code, confidence, token index, and metadata.
- Extended `developer/tests/js/vocabStore.test.js` to cover lexicon meaning, missing-lexicon placeholder, array-shaped stored lists, and metadata retention after study updates.
- Extended `developer/tests/js/integration/spellingErrorCollection.test.js` to assert saved collector entries already contain Chinese meanings, examples, notes, scheduler defaults, and new-word review state.
- Rebuilt runtime bundles with `node scripts/build-bundles.mjs`.

## Spelling Error Verification
- `node --check js/app/spellingErrorCollector.js` passed.
- `node --check js/core/vocabStore.js` passed.
- `node developer/tests/js/vocabStore.test.js` passed: 4/4.
- `node developer/tests/js/integration/spellingErrorCollection.test.js` passed: 14/14.
- `py developer/tests/ci/run_static_suite.py` passed; includes `VocabStore 错词释义补全测试` 4/4 and `拼写错误收集流程集成测试` 14/14.
- `py developer/tests/e2e/suite_practice_flow.py` passed with console error count 0.

## Optional Built-in Listening Gate
- Started new repair after Git cleanup: built-in listening must disappear when `assets/generated/listening-exams/manifest.js` is absent, but imported listening must still show through the normal library loader.
- Subagent Popper confirmed the hard dependency problem in `lazyLoader`, `libraryManager`, and `scripts/build-bundles.mjs`.
- Implemented optional manifest loading in `js/runtime/lazyLoader.js`: `exam-data` hard-loads reading data, then optionally loads `assets/generated/listening-exams/manifest.js`; only a registered manifest triggers `listening-index.compat.js`.
- Patched `js/services/libraryManager.js` so built-in listening is included only when the optional manifest/index path is available, while user-imported listening libraries still drive availability through the active index.
- Patched `js/app/browseController.js`, `js/app/examActions.js`, and `js/main.js` so stale listening filters/frequency modes reset when no active listening library exists.
- Removed generated listening assets from hard bundle inputs and staged `assets/generated/listening-exams/manifest.js` plus `listening-index.compat.js` for removal from Git tracking while leaving local ignored copies available.
- Added tests for manifest-missing/default-reading behavior, manifest-present listening behavior, and imported listening restoring the browse entrance.
- Subagents McClintock and Nash performed read-only follow-up audits. McClintock found the initial static listening button visibility race; Nash found missing release ZIP guard coverage for generated listening assets.
- Patched `index.html` so the static listening filter button starts `hidden`; `BrowseController` remains the sole source that renders/shows it when active listening exists.
- Patched `developer/release.sh` so default packages exclude `ListeningPractice/` and `assets/generated/listening-exams/`, while `INCLUDE_LOCAL_LISTENING=1` requires manifest/index to be present together.
- Added `.gitattributes` to keep `developer/release.sh` LF-only after CRLF broke `bash -n`.
- Extended `developer/tests/ci/run_static_suite.py` with:
  - `index.html 听力入口初始隐藏守卫`
  - generated listening hard-bundle guard
  - release script guard for default exclusion and opt-in paired assets
  - ZIP payload guard for no default generated listening leakage.

## Optional Built-in Listening Gate Verification
- `node --check js/runtime/lazyLoader.js js/services/libraryManager.js js/app/browseController.js js/app/examActions.js js/main.js` passed in the prior handoff.
- `node scripts/build-bundles.mjs` passed in the prior handoff; rebuilt bundle no longer embeds generated listening manifest/index.
- `node developer/tests/js/browseController.test.js` passed in the prior handoff.
- `node developer/tests/js/libraryManagerImportConfig.test.js` passed 9/9 in the prior handoff.
- `py -m py_compile developer/tests/ci/run_static_suite.py` passed.
- `bash -n developer/release.sh` passed after LF normalization.
- `git diff --check -- index.html developer/release.sh developer/tests/ci/run_static_suite.py` passed.
- `bash developer/release.sh manifest-gate-check` could not complete because the current bash environment lacks `zip`; no `dist/` archive was generated.
- `py developer/tests/ci/run_static_suite.py` passed; report includes the new initial hidden guard and release/listening hard-bundle guards.
- `py developer/tests/e2e/suite_practice_flow.py` passed with 0 console errors.
