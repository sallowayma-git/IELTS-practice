# Listening Record Persistence Findings

## Initial State
- Dirty files already present from previous thread:
  - `js/app/examSessionMixin.js`
  - `js/listeningRecordBridge.js`
  - `developer/tests/js/suiteModeRegression.test.js`
- Existing partial fix:
  - Parent now tolerates some `listening_record_bridge` session/exam mismatches and rewrites payload IDs.
  - Child bridge now uses delegated capture-phase click detection for finish-like controls.
  - Spelling error detection no longer depends only on P1/P4 directory naming.

## Open Questions To Resolve
- Whether the parent sends an initialization message to child pages after load and whether the child acknowledges it.
- Whether the child bridge retries readiness/completion messages when parent listener setup races page scripts.
- Whether finish controls in actual listening HTML use non-button nodes, nested spans, form submit, keyboard submit, or custom handlers that current click-only detection misses.
- Whether generated completion payloads are complete enough for `PracticeRecorder`.

## Protocol Trace
- Parent already had `startExamHandshake()`, but it stopped on any `SESSION_READY`.
- Child bridge sent `SESSION_READY` during bootstrap before receiving `INIT_SESSION`.
- That made “script loaded” indistinguishable from “session initialized”. This is the core bug: one event represented two states.
- Parent also rewrote listening bridge `examId/sessionId` before `handleSessionReady()`, so a pre-init `listening-unknown` ready could look valid and stop retries.

## Fix Direction
- Child ready payload must carry `initialized: false/true`.
- Child should actively send `REQUEST_INIT` until initialized.
- Parent should not mark collector ready or stop handshake on listening `SESSION_READY` with `initialized: false`; it should reply with `INIT_SESSION`.
- Finish detection must cover delegated click plus pointer/touch, submit, keyboard, and non-button nodes with finish-like handlers/attributes.

## Continued Handoff Findings
- The previous dirty fix still left a real production hole: `PRACTICE_COMPLETE` can arrive before initialized `SESSION_READY`.
- In that order, `handleSessionReady()` never calls `PracticeRecorder.handleSessionStarted()`, and real `PracticeRecorder.handleSessionCompleted()` can reject the completion as `missing_active_session`.
- The right fix is not to weaken `PracticeRecorder` synthetic guards. The parent owns the opened window and expected session id, so it must make the recorder session real before handing off completion data.
- `main.js` fallback had the same protocol smell: any `SESSION_READY` stopped INIT retries, and `PRACTICE_COMPLETE` only matched by `sessionId`, so a temporary listening bridge id could miss the fallback record.
- The added regression now explicitly sends listening `PRACTICE_COMPLETE` before initialized ready and asserts the parent starts/syncs recorder session before completion.
- Real listening HTML mostly uses `#finish-btn`, `#finishBtn`, or `#submitBtn` with click handlers; no sampled page used real form submit.
- The bridge delegated click path covers the dominant user action, but `startHookSync()` previously stopped too early when finish functions appeared after bridge bootstrap. It now keeps polling until a hook target appears or the retry budget expires.

## Final Fallback / E2E Findings
- Subagent Hegel confirmed `js/main.js` legacy fallback did not save `spellingErrors` and did not recognize completion envelopes shaped as `{ type, realData: {...} }`.
- Subagent Raman confirmed optional E2E had a test-side hole: 3-column and `data-q` bridge fixtures asserted `spellingErrors` without consistently injecting `spellingErrorCollector.js`.
- The same E2E real parent probe only proved words existed; it did not prove the word entries had the parent `examId`, the captured `userInput`, or `source: p1`.
- The real listening library also contains `#btnFinish` pages, so the real parent probe selector needed to cover that button id.
- The final repair saves normalized fallback errors after practice record persistence and tests the exact regression: `listening-unknown/other` must become the parent listening exam id and `p1`.

## Real file:// Static Bridge Findings
- The user-reported console proved the practical root cause: under normal Chrome `file://`, parent and child files are treated as unique origins, so parent-side bridge injection can fail even when `window.open()` succeeds.
- The previous optional browser coverage used `--allow-file-access-from-files`, which masked this class of failure. That flag makes parent document access easier than real user conditions.
- P1-P4 formal listening HTML count is 225. Before this repair, static `listening-record-bridge.bundle.js` coverage was 0/225.
- 55 formal listening pages still had old `practice-page-enhancer.js` tags. Keeping both enhancer and bridge would create two independent `PRACTICE_COMPLETE` producers, which is bad design even if storage sometimes dedupes.
- The safe data model is one producer per listening child page: the static `listening-record-bridge.bundle.js` bundle. It already contains `answerMatchCore` and `spellingErrorCollector`, so one script tag is sufficient.
- After repair, all 225 P1-P4 formal listening HTML files contain exactly one bridge tag with `data-listening-record-bridge="true"` before `</body>`, and old `practice-page-enhancer.js` coverage is 0.
- The target user page `P2/次高频/8. P2 Plan of Community Center (VIP)` now self-loads `../../../../js/bundles/listening-record-bridge.bundle.js`.
- Optional E2E now includes a no-flag Chromium run that opens `index.html` over `file://`, starts the Community Center P2 page through `window.app.openExam`, verifies static bridge self-load, waits for initialized handshake, clicks Finish, and asserts `practice_records` persistence.

## Spelling Error Vocabulary Findings
- The bad data structure was two writers sharing one storage key with different shapes. `SpellingErrorCollector` wrote object lists of raw spelling errors; `VocabStore` could later persist arrays of normalized study words.
- The old raw spelling-error entries did not include `meaning`, `example`, or scheduler fields, so the back-word module could only rely on runtime conversion.
- `VocabStore.convertSpellingErrorToWord()` had a semantic bug: if the core lexicon missed a word, it wrote `你曾拼写为: ...` into `meaning`. That made the spelling note appear as the Chinese definition.
- Repeated misspelling merges only updated a small field subset and could leave `acceptedAnswers`, `canonicalAnswer`, `reasonCode`, `confidence`, `tokenIndex`, and `metadata` stale.
- The repair makes collector persistence the canonical boundary: spelling errors are stored as full study words plus preserved error metadata, and `VocabStore` remains a compatibility reader for old raw/list-array shapes.

## Optional Built-in Listening Gate Findings
- The current bundle setup is the root bad smell: `scripts/build-bundles.mjs` embeds both `assets/generated/listening-exams/manifest.js` and `listening-index.compat.js` into `core-foundation.bundle.js`, so deleting `manifest.js` cannot actually hide built-in listening at runtime.
- `js/runtime/lazyLoader.js` also treats `listening-index.compat.js` as part of the hard `exam-data` group. If that file is absent, the group can reject and poison default reading library load.
- The correct data model is: built-in listening is available only if the manifest script loads and registers `window.__LISTENING_EXAM_MANIFEST__`; UI visibility is based on the active exam index containing `type: "listening"`, so user-imported listening restores the entrance without extra special cases.
- Subagent McClintock found one remaining UI race: `index.html` statically rendered the listening filter button, so manifest-missing users could briefly see a listening entrance before `BrowseController` re-rendered it away.
- The fix is to make the static DOM default hidden and let `BrowseController` render/show the button only after the active index proves that listening exists.
- Subagent Nash found a release guard gap: the default release script excluded listening assets, but the ZIP verification did not explicitly fail if `assets/generated/listening-exams/` leaked into a default archive.
- The release invariant is now: default distribution contains no `ListeningPractice/` and no `assets/generated/listening-exams/`; opt-in local listening distribution requires `manifest.js` and `listening-index.compat.js` together.
- `developer/release.sh` had CRLF line endings under the Windows checkout, which breaks bash parsing. It now has LF line endings, with `.gitattributes` pinning that file to `eol=lf`.
