# Project Handoff Document (v1.1.5)

This handoff summarizes the current status, required changes, constraints, verification steps, and risks for restoring the IELTS practice system after the v1.1.0 async storage upgrade.

## Summary
- Goal: Restore normal app operation without adding new scripts or changing data formats.
- Current pain points observed in Console logs:
  - Overview renders, Browse view stuck on “Loading…”.
  - Exams list requires “Force refresh” to appear.
  - No handshake (SESSION_READY), no PRACTICE_COMPLETE write‑back.
  - Errors: “filter is not a function” (records not array), “Assignment to const variable” (PracticeRecorder), potential header garbage (e.g., `xu is not defined`).
  - New reports: “await is only valid…” when opening exams; Browse buttons (Open/PDF) ineffective; Practice details error “practiceRecords.find is not a function”.
- Strategy: Fix data scripts, async usage, load order, array coercion, and one const reassignment.

## Constraints
- Do not add new scripts.
- Do not change data formats or field names.
- Keep minimal, targeted changes only.
- Keep `js/app.js` loaded last in `index.html` so all dependencies are ready.
- All storage interactions must use async/await (per v1.1.0 upgrade).

## Requirements (Acceptance Criteria)
- Overview shows reading/listening cards on first load (no “Force refresh”).
- Browse view lists exams and hides the spinner.
- Opening an exam logs handshake in parent Console: INIT messages sent, SESSION_READY received.
- Completing an exam logs PRACTICE_COMPLETE and adds a record to storage; Practice tab shows the record.
- No Uncaught SyntaxError/ReferenceError or header garbage errors.

## Change Log (Documentation updates only)
- Added recovery playbook: `assets/developer wiki/UPGRADE_v1.1.0_FIX_GUIDE.md` (v1.1.5) with 12 sequential tasks:
  1) Disable cache + hard reload
  2) Fix header garbage (`xu is not defined`)
  3) Validate data script arrays
  4) `main.js` loadLibrary: await cache, rebuild from scripts, do not write empty, split two awaits, fix corrupted strings
  5) `main.js` finishLibraryLoading exposes `window.examIndex` and emits `examIndexLoaded`
  6) `index.html` script order (data → utils/storage → core/components → business entry; `js/app.js` last)
  7) Browse view unstick: bind `examIndexLoaded`, hide spinner, delayed fallback
  8) Practice records array coercion to avoid `filter is not a function`
  9) `app.js` awaits everywhere; `openExam` async with awaits
  10) PracticeRecorder: fix “Assignment to const variable” (use `let` or new variable)
  11) Clear index cache and retest
  12) Handshake and write‑back verification

## Required Code Changes (to be applied by maintainer)
- Data scripts syntax
  - Ensure both `window.completeExamIndex` and `window.listeningExamIndex` are valid non‑empty arrays.
  - Top‑level assignment form: `window.<name> = [ { … }, … ];` with properly closed strings and commas.
  - Do not add `type` to reading items.
- `js/main.js`
  - `loadLibrary`: use `await` for `getActiveLibraryConfigurationKey()` and `storage.get(activeKey)`.
  - Use cache only when it is a non‑empty array; otherwise rebuild from scripts.
  - When both reading/listening are empty, do NOT write an empty index; call `finishLibraryLoading` and return.
  - Split any two `await` on a single commented line into two lines.
  - Fix corrupted strings (e.g., “将使用空索引继…” → “将使用空索引继续”).
  - `finishLibraryLoading`: `try { window.examIndex = examIndex; } catch(_) {}` before UI updates; emit `examIndexLoaded`.
  - Bind `examIndexLoaded` to call `loadExamList()` and hide spinner; add delayed fallback.
  - In `syncPracticeRecords` and `updatePracticeView`, always coerce practiceRecords into an array before `filter`.
  - Path map: In `getPathMap()` set `reading.root` to empty string ('') to avoid wrong prefix under file://; keep `listening.root: 'ListeningPractice/'`.
  - Resource path validation: Use `buildResourcePath(exam,'html'|'pdf')` in Console to verify path resolves.
- `index.html`
  - Ensure script order: data scripts first → utils/storage → core/components → business entry; `js/app.js` last.
- `js/app.js`
  - Mark `openExam` as `async` and await: active key read, index read, and `startPracticeSession`.
  - Use `await storage.get/set` in: `loadUserStats`, `updateOverviewStats`, `saveRealPracticeData`, notifications that read `exam_index`, session cleanup (`active_sessions`), and error loggers (`injection_errors`, `collection_errors`).
  - Fix await syntax error: inside `injectDataCollectionScript`, change inner `injectScript` to `async` (or mark the method itself async) so that the line `const enhancerScript = await fetch(...).then(...)` is valid under file://.
- `js/core/practiceRecorder.js`
  - In `restoreActiveSessions`, do not reassign a `const`. Use `let` or a new variable to hold the normalized sessions array.
- Header garbage removal
  - If `Uncaught ReferenceError: <token> is not defined` at line 1, remove the stray token at file top and save as UTF‑8 (no BOM).

## Task Status
- Documentation: Completed (v1.1.5 guide with step‑by‑step tasks).
- Code changes: Pending — to be implemented by maintainer strictly per guide tasks 2–10.
- Verification: Pending — perform tasks 11–12 and checks below.

## Verification Checklist
- Data scripts
  - `Array.isArray(window.completeExamIndex) === true`, length > 0
  - `Array.isArray(window.listeningExamIndex) === true`, length > 0
- Storage and index
  - `await storage.get('active_exam_index_key','exam_index')` returns a key
  - `await storage.get(key, [])` returns a non‑empty array
  - `Array.isArray(window.examIndex) === true`
- Browse view
  - `loadExamList()` callable; spinner hidden after rendering
- Handshake
  - Parent Console shows INIT messages and `SESSION_READY`
- Write-back
  - After completion: `await storage.get('practice_records', [])` shows incremented count
- Errors
  - No Uncaught SyntaxError/ReferenceError; no “Assignment to const variable”
  - Opening exam does not throw “await is only valid…”; Browse “打开/PDF” buttons open HTML/PDF successfully
  - Practice details open without “practiceRecords.find is not a function”

## Known Issues & Mitigations
- Stuck spinner despite index loaded
  - Ensure `examIndexLoaded` binding exists; add 600ms delayed fallback; ensure `displayExams` hides spinner.
- “filter is not a function” on practice records
  - Coerce to arrays before filtering; avoid passing Promises or non‑arrays to UI code.
- PracticeRecorder const assignment error
  - Replace `const` with `let` or new variable for normalized sessions.
- Header garbage (`xu is not defined`)
  - Remove stray characters at the top of the file; save as UTF‑8 (no BOM).

## Manual Test Plan
- Preload
  - Disable cache → Hard reload → Check `typeof storage` and data arrays.
- Overview → Browse
  - See cards in Overview; switch to Browse; exams list renders; spinner hidden.
- Open exam and handshake
  - In parent Console: see INIT + `SESSION_READY`.
- Complete exam
  - See PRACTICE_COMPLETE; records list updates; storage count increments.

## Risks & Rollback
- Writing empty index to cache can lock the app in a “no data” loop — do not write empty indices.
- Splitting two awaits on one line is critical — if the second await is swallowed by comment, key steps won’t run.
- Keep `js/app.js` last in index.html to prevent race conditions.
- Rollback: clear `exam_index`, `active_exam_index_key`, and `exam_index_configurations`, then reload with data scripts fixed.

## Handoff Notes
- No new files were added for runtime except this documentation. All code changes are to be applied within existing files as per this guide.
- If any step fails, capture the exact Console output and the affected function’s current code; apply the smallest change indicated in the guide.


---

Update (Current Task Report): Browse Open/PDF + Practice Details

- What changed
  - Added a focused fix guide for the two active issues. See: `assets/developer wiki/UPGRADE_v1.1.5_FIX_GUIDE.md` (overwritten; only current fixes retained).

- What to do (in order)
  1) Practice details error `practiceRecords.find is not a function`:
     - Make `exportSingle(recordId)` in `js/components/practiceRecordModal.js` async and await both `storage.get` calls.
     - Make compatibility method `practiceRecordModal.showById` async and await `storage.get('practice_records', [])`.
     - Make `showRecordDetails(recordId)` in `js/components/practiceHistoryEnhancer.js` async and await both `storage.get('practice_records', [])` reads.
  2) Browse Open/PDF and `examIndex.find is not a function`:
     - In `js/app.js` `openExam`: coerce the loaded value to array before `.find(...)` and fall back to `window.examIndex` when needed.
     - In `js/main.js` `openExam`: same array coercion before `.find(...)`.
     - If `await is only valid...` appears when opening: mark `injectScript` as async in `injectDataCollectionScript`.
     - In `js/main.js` `getPathMap()`: set `reading.root` to empty string; keep `listening.root: 'ListeningPractice/'`.

- Verification
  - Buttons “打开/PDF” in Browse open HTML/PDF in a new window.
  - Practice details open without errors.
  - No `await is only valid...` nor `.find is not a function` errors.
- `js/components/practiceRecordModal.js`
  - Make `exportSingle(recordId)` async and change synchronous `window.storage.get(...)` calls to `await window.storage.get(...)` for both practice records and exam index.
  - Change compatibility wrapper `window.practiceRecordModal.showById = function(recordId)` to `async function(recordId)` and use `await window.storage.get('practice_records', [])` before `.find(...)`.

- `js/components/practiceHistoryEnhancer.js`
  - Make `showRecordDetails(recordId)` async; change both `window.storage.get('practice_records', [])` reads to `await window.storage.get('practice_records', [])` before calling `.find(...)`.
