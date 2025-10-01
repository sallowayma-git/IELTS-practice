# Implementation Plan

- [x] 1. Create foundational data stores with file protocol compatibility

  - Create ExamStore.js as global class that uses existing storage keys
  - Create RecordStore.js as global class that manages practice_records
  - Create AppStore.js for application state coordination
  - Ensure all stores work with existing localStorage data format
  - _Requirements: 1.1, 5.1, 6.1_

- [x] 1.1 Implement ExamStore.js with existing data compatibility


  - Write ExamStore class as window.ExamStore global
  - Use existing exam_index and active_exam_index_key storage keys
  - Implement loadExams(), getExamsByCategory(), searchExams() methods
  - Add simple observer pattern for UI updates
  - Test with existing exam data in localStorage
  - _Requirements: 1.1, 5.1_

- [x] 1.2 Implement RecordStore.js with practice records management


  - Write RecordStore class as window.RecordStore global
  - Use existing practice_records storage key
  - Implement saveRecord(), getRecords(), calculateStats() methods
  - Add observer pattern for statistics updates
  - Maintain compatibility with existing record format
  - _Requirements: 1.1, 5.2_

- [x] 1.3 Implement AppStore.js for application coordination


  - Write AppStore class as window.AppStore global
  - Manage current view state and loading indicators
  - Implement honest error handling without try/catch(_){}
  - Add navigation state management
  - Coordinate between ExamStore and RecordStore
  - _Requirements: 1.1, 7.1, 7.2_

- [x] 2. Create utility functions for validation and events

  - Create validation.js with data validation functions
  - Create events.js with simple event system for store notifications
  - Ensure all utilities work as global functions in file:// mode
  - Remove dependency on complex error handling systems
  - _Requirements: 4.1, 7.3_

- [x] 2.1 Implement validation.js with data integrity checks


  - Write validateExam(), validateRecord(), validateStats() functions
  - Add schema validation for exam and record objects
  - Implement data sanitization functions
  - Create migration helpers for old data formats
  - Test validation with existing localStorage data
  - _Requirements: 4.1, 7.3_

- [x] 2.2 Implement events.js with simple observer system


  - Write EventEmitter class as window.EventEmitter global
  - Implement subscribe(), unsubscribe(), emit() methods
  - Add error handling for observer callbacks
  - Keep system simple without complex event routing
  - Test event flow between stores and UI
  - _Requirements: 5.3, 5.4_

- [x] 3. Implement main application coordinator

  - Create main.js with App class as single global entry point
  - Initialize stores in correct dependency order
  - Setup UI components with store references
  - Implement proper error handling with user feedback
  - Test complete initialization in file:// mode
  - _Requirements: 2.1, 2.2, 6.1_

- [x] 3.1 Create App class with dependency management


  - Write App class as window.App global variable
  - Check for required dependencies before initialization
  - Initialize stores with proper error handling
  - Setup cross-store communication through events
  - Add initialization logging for debugging
  - _Requirements: 2.1, 2.2, 6.1_

- [x] 3.2 Implement application startup sequence

  - Add DOMContentLoaded event listener for auto-initialization
  - Create three-step initialization: Data → UI → Events
  - Add fallback error handling for missing dependencies
  - Implement graceful degradation for failed components
  - Test startup with various error conditions
  - _Requirements: 2.1, 2.3, 7.1_

- [x] 4. Create UI components that work with existing DOM

  - Create ExamBrowser.js that replaces existing exam browsing logic
  - Create RecordViewer.js that replaces existing practice record display
  - Create SettingsPanel.js that replaces existing settings functionality
  - Maintain existing CSS classes and DOM structure
  - _Requirements: 4.2, 4.3, 8.2, 8.3_

- [x] 4.1 Implement ExamBrowser.js with existing UI integration


  - Write ExamBrowser class as window.ExamBrowser global
  - Connect to existing exam list DOM elements
  - Implement search and filtering using store methods
  - Maintain existing "Start Practice" and "View PDF" functionality
  - Subscribe to ExamStore changes for automatic updates
  - _Requirements: 4.2, 8.2_



- [x] 4.2 Implement RecordViewer.js with statistics display

  - Write RecordViewer class as window.RecordViewer global
  - Connect to existing practice records DOM elements
  - Display statistics cards using RecordStore data
  - Implement record list with existing styling
  - Subscribe to RecordStore changes for real-time updates


  - _Requirements: 4.3, 8.3_

- [x] 4.3 Implement SettingsPanel.js with system management

  - Write SettingsPanel class as window.SettingsPanel global
  - Connect to existing settings buttons and modals
  - Implement data export/import using store methods
  - Maintain existing backup and configuration functionality
  - Add proper error messages for failed operations
  - _Requirements: 4.3, 7.1, 8.3_

- [x] 5. Replace existing initialization with new system

  - Remove complex initialization chains from main.js and app.js


  - Replace global variable pollution with single App instance
  - Update index.html script loading order for new architecture
  - Test that all existing features work with new system
  - _Requirements: 2.1, 6.1, 6.2_

- [x] 5.1 Update index.html with new script loading order


  - Add script tags for new store and UI components
  - Ensure proper dependency order: utils → stores → ui → main
  - Remove old script tags for replaced components
  - Test that all scripts load correctly in file:// mode
  - Verify no 404 errors in browser console
  - _Requirements: 6.1, 8.5_

- [x] 5.2 Remove old initialization code from existing files

  - Remove complex component loading from app.js
  - Remove global variable assignments from main.js
  - Clean up try/catch(_){} blocks that hide errors
  - Replace with proper error handling in new system
  - Test that removal doesn't break existing functionality
  - _Requirements: 3.1, 3.5, 6.2_

- [x] 6. Implement honest error handling throughout system

  - Replace all try/catch(_){} blocks with explicit error handling
  - Add user-friendly error messages with recovery instructions
  - Implement error logging for debugging
  - Test error scenarios and recovery paths
  - _Requirements: 3.1, 3.2, 7.1, 7.4_

- [x] 6.1 Replace silent error handling with explicit error management


  - Find and replace all try/catch(_){} blocks in existing code
  - Add proper error messages and logging
  - Implement ErrorHandler utility for consistent error processing
  - Add user recovery instructions for common errors
  - Test error handling with storage failures and network issues
  - _Requirements: 3.1, 3.2, 7.1_

- [x] 6.2 Implement user-friendly error display system


  - Create error display UI that shows actionable error messages
  - Add error recovery buttons for common issues
  - Implement error logging for developer debugging
  - Test error display with various error types
  - Ensure errors don't crash the application
  - _Requirements: 7.1, 7.4, 7.5_

- [x] 7. Test complete system in file:// protocol mode

  - Test all functionality by double-clicking index.html
  - Verify exam browsing, practice recording, and settings work
  - Test postMessage communication with exam windows
  - Validate localStorage persistence across sessions
  - _Requirements: All requirements_

- [x] 7.1 Perform comprehensive file protocol testing


  - Test system startup by double-clicking index.html
  - Verify all stores initialize correctly with existing data
  - Test exam browsing and search functionality
  - Validate practice record saving and statistics calculation
  - Test settings panel and data management features
  - _Requirements: All requirements_

- [x] 7.2 Test cross-window communication and data persistence


  - Test opening exam windows and postMessage communication
  - Verify practice completion data flows back to main window
  - Test localStorage persistence across browser sessions
  - Validate data integrity after system restart
  - Test backup and restore functionality
  - _Requirements: 5.1, 5.2, 7.5_

- [x] 8. Clean up old code and optimize file structure


  - Remove unused JavaScript files and components
  - Consolidate remaining functionality into new architecture
  - Update documentation to reflect new system
  - Perform final testing and optimization
  - _Requirements: 4.1, 8.1, 8.4_



- [x] 8.1 Remove obsolete code files and clean up directory structure

  - Remove old component files that have been replaced
  - Clean up unused utility functions and global variables
  - Remove complex initialization and fallback systems
  - Update file organization to match new architecture

  - Test that removal doesn't break any functionality
  - _Requirements: 4.1, 8.1, 8.4_

- [x] 8.2 Optimize script loading and performance

  - Minimize number of script tags in index.html
  - Optimize store initialization for faster startup
  - Remove unnecessary DOM queries and event listeners
  - Test performance improvements in file:// mode
  - Validate memory usage and cleanup
  - _Requirements: 8.4, 8.5_

- [x] 9. Clean up obsolete JavaScript files and reduce system complexity


  - Remove redundant and unused JavaScript files
  - Consolidate functionality into new architecture
  - Fix remaining compatibility issues
  - Ensure all core features work properly
  - _Requirements: All requirements_

- [x] 9.1 Remove obsolete JavaScript files

  - Remove js/boot-fallbacks.js (replaced by new error handling)
  - Remove js/utils/componentChecker.js (functionality moved to new architecture)
  - Remove js/components/BrowseStateManager.js (replaced by ExamBrowser)
  - Remove js/components/ErrorFixer.js (replaced by honest error handling)
  - Remove js/components/CommunicationRecovery.js (replaced by new communication system)
  - Remove js/patches/runtime-fixes.js (check if still needed)
  - Test system after each removal
  - _Requirements: 8.1, 8.4_


- [x] 9.2 Consolidate remaining functionality
  - Move essential functions from legacy files to the new architecture with clear owners
  - Update all references and remove dead code after each move
  - Ensure backward compatibility for critical features (file:// only)
  - Test all user workflows after each consolidation step (not at the end)
  - _Requirements: 1.1, 4.1, 5.1, 8.1_

  Acceptance criteria:
  - No references remain to legacy compatibility layers for the migrated scope
  - `window.App` is the only intentional global entry (utilities attach to `window.*` but are referenced via `App`)
  - New owners per responsibility are documented in code headers
  - Manual smoke test passes for: exam browsing, search, start practice, PRACTICE_COMPLETE ingest, settings actions

  Migration map (first tranche):
  - From `js/main.js` → `js/ui/ExamBrowser.js` and `js/ui/RecordViewer.js`: browsing list rendering, search handler, practice view refresh
  - From `js/app.js` → `js/main.js` (bootstrap only) and stores/ui: init chain, cross-window message routing, PRACTICE_COMPLETE handling
  - From `js/components/practiceHistory.js` → `js/ui/RecordViewer.js`: record table and stats wiring
  - From `js/components/systemMaintenancePanel.js` → `js/ui/SettingsPanel.js`: backup/import/export, config switching
  - From `js/components/mainNavigation.js` → split across `AppStore` (view state) + lightweight DOM binder in `js/main.js`

  Follow-up (second tranche):
  - `js/components/practiceRecordModal.js` → keep UI-only modal; data flows via `RecordStore`
  - `js/components/recommendationDisplay.js`, `questionTypePractice.js`, `specializedPractice.js` → fold into smaller UI modules or drop if superseded
  - `js/compatibility/legacy-bridge.js`, `js/patches/runtime-fixes.js` → retire once parity verified


- [x] 9.3 Fix compatibility and missing functions
  - Fix loadLibrary function availability
  - Fix showLibraryConfigListV2 function
  - Ensure all settings panel functions work
  - Fix exam loading and browsing functionality
  - Test all features in file:// protocol mode

  - _Requirements: All requirements_

  Gap analysis and concrete fixes:
  - `loadLibrary` owner → `ExamStore.initialize()/refreshExams()`; expose `window.App.stores.exams.refreshExams` for UI; remove duplicate global `loadLibrary`
  - `showLibraryConfigListV2` owner → `SettingsPanel` with explicit DOM IDs; ensure it reads from storage key `exam_index_configurations`
  - Cross-window handshake → define a single router: `App.messageRouter` handling `SESSION_READY`, `PROGRESS_UPDATE`, `PRACTICE_COMPLETE`
  - PRACTICE_COMPLETE ingestion → route to `RecordStore.saveRecord` with schema validation; UI refresh via store subscription, not ad-hoc DOM writes
  - Settings actions (export/import/backup/restore) → implemented in `SettingsPanel` calling `storage` + stores; remove duplicate utils once parity confirmed

  Acceptance criteria:
  - Searching “loadLibrary(” in repo shows only store usage sites
  - PRACTICE_COMPLETE always results in a saved record and refreshed stats without direct DOM calls
  - Settings page buttons operate via `SettingsPanel` only and succeed in file:// mode

- [x] 9.4 Optimize script loading order and reduce file count
  - Remove duplicate script includes
  - Optimize script loading order for better performance
  - Combine small utility files where appropriate
  - Minimize total number of HTTP requests
  - Test performance improvements
  - _Requirements: 8.4, 8.5_

  Actions:
  - Ensure index/HP pages load scripts in this order: utils → stores → ui → main (no “boot-fallbacks” layer)
  - De-duplicate legacy includes on HP pages (see assets/developer wiki/hp-overview-usage-todo.md §4)
  - Collapse tiny one-off utils into `js/utils/helpers.js` where sensible; keep pure and side‑effect free
  - Verify no “try/catch swallowing” blocks remain in bootstrap; honest error surfacing via `AppStore.addError`

  Acceptance criteria:
  - DevTools Network shows zero 404s and no duplicated script loads
  - Time to first interactive list render <= 800ms on mid-tier laptop (manual measure)
  - `js/main.js` <= 120 lines, only bootstraps `window.App`

---

- [x] 10. Decompose large UI files and enforce file size budgets

  - Split `js/ui/ExamBrowser.js` into: `ExamBrowser.js` (controller), `ExamFilterBar.js`, `ExamList.js`, `Pagination.js`
  - Split `js/ui/RecordViewer.js` into: `RecordStats.js`, `RecordList.js`, `RecordViewer.js` (glue)
  - Split `js/ui/SettingsPanel.js` into: `SettingsActions.js`, `SettingsPanel.js`
  - Introduce a tiny `BaseComponent` pattern (attach, detach, render), no framework
  - Enforce: each UI file < 250 lines; single responsibility; no business logic
  - _Requirements: 4.1, 4.3, 8.2, 8.3_

  Acceptance criteria:
  - Each new UI module < 250 lines; names reflect purpose
  - UI modules never touch storage directly; only call stores
  - Rendering is idempotent; event handlers registered/disposed predictably

- [x] 11. Minimize global scope and centralize events

  - Make `window.App` the only global entry; route all internal comms via `App.events` (wrap existing `globalEventBus`)
  - Demote ad-hoc `window.*` helpers to be referenced through `App` (kept global for file:// but not used that way)
  - Document the public surface: `App.stores`, `App.ui`, `App.events`, `App.initialize()`
  - _Requirements: 6.1, 6.2, 5.3_

  Acceptance criteria:
  - Grep finds no new non-whitelisted globals besides `App`, `storage`, `EventEmitter` (utils)
  - Events are emitted/subscribed via a single event hub

- [x] 12. Harden cross‑window communication

  - Define strict message schema with type guards for `SESSION_READY`, `PROGRESS_UPDATE`, `PRACTICE_COMPLETE`
  - Add retry/backoff with max attempts; surface failure via `AppStore.addError`
  - Deduplicate PRACTICE_COMPLETE by `sessionId` using a Set within `RecordStore`
  - _Requirements: 5.1, 7.1, 7.3_

  Acceptance criteria:
  - Double “complete” messages store only one record
  - Lost `SESSION_READY` transitions recover via retry without user action

- [x] 13. Data model and migration consistency

  - Normalize record schema on write: id, examId, date, duration, score.percentage, dataSource, answers, metadata
  - Keep storage keys aligned to `storage.js` defaults: `exam_index`, `practice_records`, `active_exam_index_key`
  - Add light migration at store boundaries for older shapes (`realData`, `scoreInfo`)
  - _Requirements: 1.1, 5.4, 7.2_

  Acceptance criteria:
  - `RecordStore.getRecords()` returns normalized objects regardless of legacy shapes
  - Export/import produces/accepts the normalized schema

- [x] 14. Regression test matrix (manual, file://)

  - Browsers: Chrome (primary), Edge/Safari (sanity)
  - Scenarios: startup with empty storage; with existing data; open/complete practice; import/export; switch library config; PDF open
  - Data integrity: restart browser → verify records/stats persisted
  - Cross‑window: handshake reliability, duplicate suppression
  - Performance: exam list with >500 items; virtual scrolling responsive
  - _Requirements: All_

- [x] 15. Documentation updates (English)

  - Update `assets/developer wiki/English wiki/*` for the new architecture: Core, System Architecture, Infrastructure Components
  - Add READMEs to `js/stores/`, `js/ui/`, `js/utils/` explaining responsibilities and public APIs
  - Include a “file:// constraints” section in Core docs (script order, globals, no dynamic imports)
  - _Requirements: 8.1, 8.5_

- [x] 16. Risk and rollback plan

  - Keep a feature parity checklist; remove legacy only after parity is signed off
  - Provide a one‑click “Rebuild indexes” and “Restore backup” path in Settings
  - Document rollback steps: restore archived legacy files and script tags

- [x] 17. Performance budgets and instrumentation

  - Define budgets: TTI < 800ms (baseline), search debounce 300ms, render batch size 50
  - Add light timers/marks around store init and first render (console only)
  - Validate on a mid‑tier machine in file:// mode

- [x] 18. Code quality gates (enforced by review)

  - No silent `catch` blocks; always surface via `AppStore.addError`
  - Functions with >2 nesting levels must be split
  - No direct DOM mutation from stores; UI only
  - Each file has a short header stating its single responsibility

 [x] 19. Hotfix: eliminate recursive user-message bug (freeze)

  - Fix `App.showUserMessage()` recursion
  - File: `js/app.js:191`
  - Replace internal call with safe global fallback: use `window.showMessage?.(message, type)`; else `alert` (development) or `console.log`
  - Acceptance:
    - No call stack overflow when initialization shows messages
    - App no longer freezes at startup

- [x] 20. Ensure `events.js` is loaded before App

  - Update `index.html` utilities block to include `js/utils/events.js` before stores
  - Verify `window.EventEmitter` exists before `new App()`
  - Acceptance:
    - No `ReferenceError: EventEmitter is not defined`
    - `App.events` initializes successfully

- [x] 21. Single message router and listener de-duplication

  - Consolidate cross-window message handling into one listener in `js/app.js`
  - Add guard `this._messageListenerAttached` to prevent duplicate `window.addEventListener('message', ...)`
  - Acceptance:
    - Only one `message` listener attached (verify via console/DevTools)
    - Handshake intervals are cleared after `SESSION_READY`

- [x] 22. Handshake retry/backoff and PRACTICE_COMPLETE de‑duplication

  - Add capped retry with exponential backoff for session handshake; surface failure via `AppStore.addError`
  - Maintain a `processedSessionIds` Set in `App` or `RecordStore`; ignore duplicate `PRACTICE_COMPLETE`
  - Acceptance:
    - Duplicate completion messages do not create multiple records
    - Lost `SESSION_READY` recovers without manual refresh

- [x] 23. Reduce background intervals; keep features intact

  - If `DataIntegrityManager` exists, disable auto-backup by default at startup; expose a Settings toggle to enable
  - Defer heavy diagnostics (system tests, optimization hints) to Settings page only
  - Acceptance:
    - CPU usage stable at idle; no periodic heavy tasks on first load
    - All features accessible via Settings when needed

- [x] 24. Prevent double rendering from App and UI modules

  - Ensure view rendering happens in `js/ui/*` components only
  - In `js/app.js`, wrap legacy render/update calls with guards (no-op when corresponding UI components are active)
  - Acceptance:
    - No duplicate DOM updates for browse/records views
    - UI updates triggered via store subscriptions

- [x] 25. Lightweight performance instrumentation (no feature removal)

  - Add `console.time/timeEnd` around: App initialize (Data/UI/Events), first list render, stats render
  - Log counts of attached listeners and active intervals after init
  - Acceptance:
    - Console shows timing marks; TTI baseline ≤ 800ms
    - Listener/interval counts remain stable across view switches

- [x] 26. Script audit and consolidation without feature loss

  - Primary entry (`index.html`): keep minimal baseline (utils → stores → ui → app). Defer PDF/Recorder/Listening scripts until actually used
  - Theme/HP pages: remove duplicate system scripts per `assets/developer wiki/hp-overview-usage-todo.md §4`; retain functionality by ordering and on-demand loads
  - Acceptance:
    - No duplicate script loads in DevTools Network
    - Same functionality verified by manual regression in file:// mode

---

- [x] 27. Index baseline scripts and on-demand injectors (no feature removal)

  - Ensure `index.html` utilities include `js/utils/events.js` before stores
  - Keep heavy/optional components (PDFHandler, PracticeRecorder, listening data) out of initial load; add a small injector util to load them when needed
  - Provide `App.injectScript(src, callback)` helper for file:// safe dynamic loading
  - Acceptance:
    - No ReferenceError for EventEmitter during App startup
    - First interactive render unchanged; PDF/Practice features still work when triggered

  Implementation steps:
  1) Update `index.html` script order
     - Place `js/utils/events.js` after `helpers.js` and before any stores.
     - Keep `assets/scripts/complete-exam-data.js` but move `listening-exam-data.js` to lazy load via injector.
  2) Add an injector helper (no new file required)
     - Location: `js/app.js` under the `App` class or `js/utils/helpers.js` as `window.injectScript`.
     - Contract:
       - `App.injectScript(src, onload?)` returns a Promise and resolves once the script loads; ignores if the same `src` already loaded.
       - Works in file:// (plain `<script>` tag injection, no fetch).
  3) Switch heavy dependencies to on‑demand
     - PDF: Only load `js/components/PDFHandler.js` when user clicks View PDF.
     - Practice: Only load `js/core/practiceRecorder.js` (and `scoreStorage.js` if needed) when starting practice.
     - Listening data: Inject when browsing/starting listening category.
  4) Add minimal logging
     - `console.debug('[Injector] loaded:', src)` once per script for troubleshooting.

  Example (injector skeleton):
  ```javascript
  // In js/app.js (inside class App):
  injectScript(src) {
    if (!this._loadedScripts) this._loadedScripts = new Set();
    return new Promise((resolve, reject) => {
      if (this._loadedScripts.has(src)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => { this._loadedScripts.add(src); console.debug('[Injector] loaded:', src); resolve(); };
      s.onerror = (e) => { console.error('[Injector] failed:', src, e); reject(e); };
      document.head.appendChild(s);
    });
  }
  ```

- [x] 28. Single bridge for openExam/viewPDF

  - Expose `App.openExam(examId)` and `App.viewPDF(examId)` as the only public bridge; UI calls these only
  - Internally, these functions coordinate Stores and (on-demand) PDFHandler/PracticeRecorder injection
  - Acceptance:
    - Grep shows UI does not directly reference global helpers for exam/PDF actions
    - Cross-window message still flows to RecordStore, UI updates via subscriptions

  Implementation steps:
  1) Define public bridges on `App`
     - `App.openExam(examId)` and `App.viewPDF(examId)` are the sole public entry points.
  2) Internals for `viewPDF`
     - If `window.PDFHandler` is absent, call `await App.injectScript('js/components/PDFHandler.js')`.
     - Resolve exam path via `ExamStore.getExamById(examId)` and hand over to `PDFHandler.openPDF(...)`.
  3) Internals for `openExam`
     - Ensure recorder is present: `await App.injectScript('js/core/scoreStorage.js')` then `await App.injectScript('js/core/practiceRecorder.js')` if missing.
     - Start session via PracticeRecorder/legacy path (keep both for compatibility).
  4) UI changes (no feature removal)
     - Replace direct calls with `window.App.openExam(id)` / `window.App.viewPDF(id)`.

  Example (bridge outline):
  ```javascript
  async viewPDF(examId) {
    if (!window.PDFHandler) await this.injectScript('js/components/PDFHandler.js');
    const exam = this.stores.exams.getExamById(examId);
    if (exam?.hasPdf) new window.PDFHandler().openPDF(exam.pdfPath || exam.path + '/exam.pdf', exam.title);
  }
  ```

- [x] 29. Listener registry and diagnostics (development only)

  - Implement a lightweight registry in `App` to track added global listeners/timers; expose `App.debugReport()` to log counts
  - Use in manual QA to ensure no listener duplication after navigation
  - Acceptance:
    - `App.debugReport()` prints stable counts across multiple view switches

  Implementation steps:
  1) Add wrappers on `App`:
     - `addWindowListener(type, handler, options)` and `removeWindowListener(type, handler)` that forward to `window.addEventListener` and track entries in `this._listeners`.
     - `addInterval(fn, ms)` that tracks ids in `this._intervals` and returns a disposer.
  2) Implement `debugReport()`
     - Print listener counts by type and number of intervals/timeouts.
  3) Refactor hot paths
     - Replace raw `window.addEventListener` and `setInterval` in `js/app.js` with the wrappers (only where safe; no behavior change).

  Example (skeleton):
  ```javascript
  addWindowListener(type, handler, options) {
    this._listeners = this._listeners || new Map();
    window.addEventListener(type, handler, options);
    const arr = this._listeners.get(type) || []; arr.push(handler); this._listeners.set(type, arr);
  }
  debugReport() { console.table({listeners: [...(this._listeners||new Map()).entries()].map(([t,a])=>({type:t,count:a.length}))}); }
  ```

- [x] 30. HP theme pages: script dedup and base href normalization

  - Normalize `<base href="./">` and ensure scripts use `../../../` prefix consistently (per hp-overview-usage-todo.md §2/§4)
  - Remove duplicated system scripts from HP pages and rely on core injector when needed
  - Acceptance:
    - Network panel shows no 404 and no duplicates when opening HP pages directly

  Implementation steps:
  1) Base href normalization
     - Ensure each HP page uses `<base href="./">`.
  2) Script prefix consistency
     - Migrate all system script paths to `../../../` prefix (relative to HP dir) per the wiki guidance.
  3) Remove duplicated system scripts
     - Keep a single baseline load per page; defer optional scripts using the injector from Task 27.
  4) Verify
     - DevTools Network: zero duplicates, zero 404; console: no missing global references.

- [x] 31. Unified error module surface (no behavior loss)

  - Create a single `ErrorService` facade that wraps current `errorHandler` + `errorDisplay`; route `AppStore.addError` through it
  - Keep both files physically but export via one global; UI code references the facade only
  - Acceptance:
    - One code path for user-visible errors; messages remain actionable

  Implementation steps:
  1) Create a small facade without adding new dependencies
     - Option A: Add `window.ErrorService = { showUser(message,type), log(error,ctx) }` in `js/utils/errorHandler.js` bottom.
     - Option B: If preferred, create `js/utils/errorService.js` and include it with other utils (still file:// safe).
  2) Route AppStore.addError through the facade
     - When adding an error, call `ErrorService.showUser(error.userMessage, 'error')`.
  3) Keep errorDisplay for UI rendering
     - The facade delegates to existing UI when present; falls back to `alert/console` in development.

- [x] 32. Create `test_regression.html` for file:// smoke tests

  - Minimal page that loads baseline scripts and runs scripted flows (load exams → start practice → simulate PRACTICE_COMPLETE → verify record/stats)
  - Include console assertions and timing marks; no external deps
  - Acceptance:
    - Manual double-click runs without errors; logs PASS for core flows

  Implementation steps:
  1) Create `test_regression.html` at repo root (or under `tests/`)
     - Load minimal baseline scripts (utils → stores → ui → app) and a tiny runner script.
  2) Script the flows
     - Seed a small `exam_index` if empty.
     - Call `App.openExam(examId)`; simulate child window by posting a synthetic `PRACTICE_COMPLETE` message with a unique `sessionId`.
     - Wait for `RecordStore` to emit `record_saved`; assert counts via `console.assert`.
  3) Timing marks
     - Use `console.time('startup')`/`console.timeEnd('startup')` and log PASS/FAIL banners for quick manual verification.

---

- [x] 33. Canonicalize EventEmitter and global event bus

  - Remove duplicate EventEmitter definitions; keep one canonical source in `js/utils/events.js`
  - Add guards in `js/utils/helpers.js` to avoid redefining `window.EventEmitter` and `window.globalEventBus` if they already exist
  - Ensure only one initialization log appears: `[Events] EventEmitter initialized`

  Implementation steps:
  1) In `js/utils/helpers.js`, wrap the EventEmitter block with:
     - `if (!window.EventEmitter) { /* define EventEmitter */ }`
     - `if (!window.globalEventBus) { window.globalEventBus = new window.EventEmitter(); }`
  2) Verify index.html loads `events.js` before helpers.js
  3) Grep for other EventEmitter definitions and add the same guard (if any)

  Acceptance:
  - DevTools console shows a single initialization message for events
  - No functional change in event routing; all code paths use the same EventEmitter

- [x] 34. Normalize store naming via adapters (no behavior change)

  - Provide consistent accessors on `App.stores`: `exams` → `ExamStore`, `records` → `RecordStore`, `app` → `AppStore`
  - Maintain backward compatibility by keeping existing keys (`examStore`, `recordStore`) but route through the same instances
  - Add optional deprecation logs in development mode when old names are accessed

  Implementation steps:
  1) During `App.initialize()`, assign both aliases:
     - `this.stores.exams = this.stores.examStore`
     - `this.stores.records = this.stores.recordStore`
  2) Add small getters/setters or a proxy to keep them in sync if needed
  3) Incrementally update internal references to use `exams`/`records`

  Acceptance:
  - Grep shows decreasing use of `examStore`/`recordStore` in favor of `exams`/`records`
  - No runtime errors; both old/new names work

- [x] 35. Parent/child message role separation (listener guards)

  - Ensure parent window uses only `App.setupMessageRouter()` for `message` events
  - In auxiliary modules (e.g., `js/core/practiceRecorder.js`, `js/utils/examCommunication.js`), guard `addEventListener('message', ...)` so they attach only in child/practice pages
  - Detect child context via a stable heuristic (e.g., `window.name.startsWith('exam_')` or presence of a practice page marker)

  Implementation steps:
  1) Add a small utility `isPracticeWindow()` in helpers; reuse from multiple files
  2) Wrap existing `window.addEventListener('message', ...)` in these modules with `if (isPracticeWindow())`
  3) Confirm parent page only has a single `message` listener (from App)

  Acceptance:
  - DevTools shows one `message` listener on parent; multiple listeners only on child windows
  - No regression in cross-window communication

- [x] 36. Message validation and origin/source checks (file:// safe)

  - Add strict schema checks to `App.setupMessageRouter()` for `SESSION_READY`/`PROGRESS_UPDATE`/`PRACTICE_COMPLETE`
  - Validate `event.source` against tracked `examWindows` when available; ignore messages from unknown sources
  - Ensure handshake timers are cleared on unload; reattach safely after navigation

  Implementation steps:
  1) Extract a `validatePracticeMessage(data, type)` helper to centralize checks
  2) When `examWindows` map exists, ensure `event.source === examWindows.get(examId).windowRef`
  3) On `beforeunload`, clear handshake timers and detach the router if reinitializing

  Acceptance:
  - Invalid messages are ignored with a single warning; no crashes
  - PRACTICE_COMPLETE only accepted from known practice windows

- [x] 37. Expand regression coverage in `test_regression.html`

  - Add tests for duplicate message suppression, injector idempotency, and ErrorService fallbacks
  - Add probes for EventEmitter single-init and message-router single-listener assertions

  Implementation steps:
  1) Simulate double PRACTICE_COMPLETE and assert only one record saved
  2) Call `App.injectScript(src)` twice and assert no re-loading occurs
  3) Temporarily delete `window.errorDisplay` and assert ErrorService falls back to alert/console

  Acceptance:
  - Console shows PASS for the above scenarios without manual intervention

- [x] 38. Documentation refresh for adapters and router

  - Update English wiki to document:
    - Single EventEmitter source (events.js)
    - Store naming adapters (`exams`/`records`) and migration plan
    - Single message router responsibilities and child/parent listener separation
  - Add short READMEs to `js/utils/` describing ErrorService and Injector responsibilities

  Acceptance:
  - Core/System/Infrastructure docs reflect current architecture and APIs
  - New contributors can find the canonical event and message flow quickly

---

- [x] 39. Isolate test scripts and remove production references

  - Goal: Keep `js/tests/` and `js/testing/` completely out of production pages; load them only in `test_regression.html`.

  Implementation steps:
  1) Grep production HTML for accidental test includes (`index.html`, theme pages): ensure none reference `js/tests/` or `js/testing/`.
  2) Wire tests exclusively in `test_regression.html` via explicit `<script>` tags; do not rely on wildcard loaders.
  3) Add a small banner in `test_regression.html` to make it obvious when tests are loaded (prevents accidental prod use).
  4) Optionally move test-only helpers to `tests/helpers/` and keep a clear "non-prod" prefix in filenames.

  Acceptance:
  - Opening `index.html` never loads code from `js/tests/` or `js/testing/`.
  - Opening `test_regression.html` loads tests without console errors.

- [x] 40. Gate verbose console logs behind a debug flag (no behavior change)

  - Goal: Reduce console noise in production while preserving troubleshooting signals in tests.

  Implementation steps:
  1) Add a global `window.__DEBUG__` flag defaulting to `false` (set `true` in `test_regression.html`).
  2) In high-chattiness modules (e.g., `js/practice-page-enhancer.js`, `js/practice-page-common.js`, UI components), wrap non-essential `console.log` with a `debugLog(...)` helper that checks `__DEBUG__`.
  3) Keep `console.error` and critical warnings untouched.

  Acceptance:
  - Baseline (index.html) has minimal console output (no chatty logs).
  - Test page shows detailed logs when `__DEBUG__ = true`.

- [x] 41. Script ownership map and dead-code quarantine plan

  - Goal: Produce a clear map of scripts → owners → entry points; quarantine unreferenced scripts under `legacy/` (no deletion yet).

  Implementation steps:
  1) Inventory all JS files and classify: core baseline, optional on-demand, theme-only, tests, legacy.
  2) For each script, list its entry points (HTML includes or dynamic injection sites) and owning module.
  3) Move scripts with no entry points to `legacy/` and document rationale in `CLEANUP_REPORT.md`.
  4) Ensure no code path references files in `legacy/`.

  Acceptance:
  - A `SCRIPT_OWNERSHIP.md` exists with current mapping and decisions.
  - No production page references any file under `legacy/`.

- [x] 42. Dependency layering rules and sanity checks

  - Goal: Enforce the layered dependencies: `utils → stores → ui → app`, with plugins/theme pages on top.

  Implementation steps:
  1) Document layering in `ARCHITECTURE_NOTES.md` (English): allowed/forbidden directions with examples.
  2) Grep for upward references (e.g., stores touching DOM, ui reaching into storage directly) and note findings.
  3) For each violation, add a 1-line TODO with a proposed refactor-in-place (no feature removal).

  Acceptance:
  - Documented rules exist; known violations are listed with owners and fix plans.

- [x] 43. Consolidate practice communication paths (no loss of functionality)

  - Goal: Ensure exactly one parent-side router (App) and child-side listeners only on practice pages.

  Implementation steps:
  1) Audit `window.addEventListener('message', ...)` across repo; mark each as parent-side or child-side.
  2) Parent side: keep only `App.setupMessageRouter()`; add guards where other modules attach in parent context.
  3) Child side: keep listeners in `practice-page-enhancer.js` and related child-only modules; guard with `isPracticeWindow()`.

  Acceptance:
  - Parent page shows exactly one `message` listener in DevTools.
  - Child windows continue to work; tests for duplicate suppression remain green.

- [x] 44. Storage keys and migration consistency (final pass)

  - Goal: Ensure all code paths use the same keys as `js/utils/storage.js` and normalize old shapes at store boundaries.

  Implementation steps:
  1) List all storage keys used in code; compare against `StorageManager.prefix` and documented keys.
  2) Add lightweight migration in `RecordStore`/`ExamStore` for any remaining legacy record shapes.
  3) Update docs with the final set of keys, noting deprecated ones.

  Acceptance:
  - No mixed-prefix or duplicate keys; legacy shapes normalized on read.

- [x] 45. PDF path normalization centralization

  - Goal: Keep path normalization in one place when opening PDFs; remove scattered adaptations.

  Implementation steps:
  1) Ensure `App.viewPDF()` computes/normalizes the PDF path; call PDFHandler with the final path.
  2) Remove/disable ad-hoc PDF path overrides (e.g., in `js/academic-init.js`) for base pages; keep theme-specific fallbacks only on theme pages.
  3) Document the normalization rules and examples.

  Acceptance:
  - One code path computes the PDF path; no duplicate normalization logic.

- [x] 46. Theme/academic compatibility scripts hardening

  - Goal: Ensure `js/academic-*.js`, `js/script.js`, `js/design-adaptations.js` are not loaded by base pages unless explicitly required.

  Implementation steps:
  1) Confirm none of the base pages include these scripts.
  2) If needed by specific themes, load them from the theme pages only; remove any global side effects.
  3) Add a short README under `js/plugins/` explaining the scope of theme scripts.

  Acceptance:
  - Base pages function without these compatibility scripts; theme pages remain functional.

- [x] 47. ErrorService adoption sweep (no behavior change)

  - Goal: Replace direct `showMessage*` usages with the ErrorService facade across UI.

  Implementation steps:
  1) Grep for `showMessage`/`showErrorMessage` in UI; replace with `ErrorService.showUser/showWarning/showInfo`.
  2) Keep backward-compat globals for third-party scripts but stop using them internally.

  Acceptance:
  - Internal codebases reference only ErrorService for user-facing messages.

- [x] 48. Performance budgets and console timing baselines

  - Goal: Maintain TTI ≤ 800ms and responsive lists with batch size 50/debounce 300ms.

  Implementation steps:
  1) Keep `console.time` markers around App init and first render; record results in a short `PERF_NOTES.md` snapshot.
  2) Verify list rendering uses batching/virtualization thresholds consistently across views.

  Acceptance:
  - Perf logs present and stable across runs; lists remain responsive beyond 500 items.

- [x] 49. Code style and naming consistency (no toolchain changes)

  - Goal: Improve readability without introducing new linters.

  Implementation steps:
  1) Adopt consistent naming for stores (`Exams`, `Records`, `App`) and UI components; avoid ambiguous names.
  2) Add short file headers stating single responsibility and owner module.
  3) Split overly nested functions where necessary (≤ 2 levels rule), without behavior change.

  Acceptance:
  - New/edited files adhere to the style; reviewers can quickly identify ownership and purpose.

- [x] 50. Final script de-dup pass and commit plan

  - Goal: Remove or quarantine non-referenced/duplicate scripts after all previous tasks are green.

  Implementation steps:
  1) Re-run the ownership map; produce a deletion/quarantine candidate list with justification.
  2) For each candidate, ensure no dynamic injection references; move to `legacy/` or delete if trivial.
  3) Update `CLEANUP_REPORT.md` with before/after counts and a rollback note.

  Acceptance:
  - Repo no longer contains unused production-facing scripts; tests and baseline pages unaffected.

---

- [x] 51. Theme pages path remap after legacy move (no functional change)

  - Goal: Update theme/HP pages to reference `legacy/` paths for moved components to prevent 404s.

  Scopes and replacements:
  - In `.superdesign/design_iterations/HP/*.html` (prefix `../../../`):
    - `../../../js/components/IndexValidator.js` → `../../../legacy/IndexValidator.js`
    - `../../../js/components/practiceRecordModal.js` → `../../../legacy/practiceRecordModal.js`
    - `../../../js/components/practiceHistoryEnhancer.js` → `../../../legacy/practiceHistoryEnhancer.js`
    - `../../../js/components/CommunicationTester.js` → `../../../legacy/CommunicationTester.js`
  - In `.superdesign/design_iterations/ielts_academic_functional_2.html` (prefix `../../`):
    - `../../js/components/IndexValidator.js` → `../../legacy/IndexValidator.js`
    - `../../js/components/practiceRecordModal.js` → `../../legacy/practiceRecordModal.js`
    - `../../js/components/practiceHistoryEnhancer.js` → `../../legacy/practiceHistoryEnhancer.js`
    - `../../js/components/CommunicationTester.js` → `../../legacy/CommunicationTester.js`

  Implementation steps:
  1) Apply the above path substitutions; avoid touching PDFHandler (still under `js/components/`).
  2) Open each theme page directly via file:// and verify DevTools Network shows zero 404.
  3) Quick click-through for practice/history/settings views to ensure no runtime errors.

  Acceptance:
  - All theme pages load without 404s.
  - No console errors caused by missing moved files.

- [x] 52. Optional: Legacy alias stubs for backward compatibility (fallback only)

  - Goal: For teams that cannot edit theme HTML soon, provide optional stub files under `js/components/` that synchronously load from `legacy/`.

  Implementation steps:
  1) For each moved file that is still referenced by some pages, create a tiny stub at `js/components/<Name>.js`:
     - Use `document.write('<script src="../../legacy/<Name>.js"></' + 'script>')` to synchronously include the legacy file (keeps execution order in file://).
  2) Scope strictly to the needed set (IndexValidator, practiceRecordModal, practiceHistoryEnhancer, CommunicationTester).
  3) Remove the stubs once HTML references are updated (task 51 complete).

  Acceptance:
  - Pages referencing old paths work immediately; no order-related regressions.
  - Stubs are temporary and documented in CLEANUP_REPORT.md.

- [x] 53. Update docs and checklists after path changes

  - Goal: Ensure internal guides point to the correct script locations.

  Implementation steps:
  1) Update `assets/developer wiki/hp-overview-usage-todo.md` script lists to use `legacy/` for moved items.
  2) In English wiki pages that reference moved component paths, add a note that these are legacy components and now live under `legacy/`.
  3) Add a short “Path Migration Notes” section to `SCRIPT_OWNERSHIP.md`.

  Acceptance:
  - No doc still instructs using `js/components/<moved>.js`.

- [x] 54. Path integrity checker (manual run on test page)

  - Goal: Provide a small script to verify that all `<script src>` paths are reachable and modules are defined.

  Implementation steps:
  1) Add `tests/path-checker.js` that:
     - Iterates over `document.scripts`, checks `src`, and attempts to detect presence of expected globals (when known).
     - Logs a PASS/FAIL table to console.
  2) Include it only in `test_regression.html` and run manually after path updates.

  Acceptance:
  - Console table shows all paths PASS on both base and theme pages (when loaded via test harness).

- [x] 55. Injector alias map for dynamic loads (defensive)

  - Goal: Add a minimal alias map for `App.injectScript` so that requests for moved components can fall back to `legacy/` automatically.

  Implementation steps:
  1) In `App.injectScript`, before creating the tag, check if `src` matches `js/components/(IndexValidator|practiceRecordModal|practiceHistoryEnhancer|CommunicationTester).js`.
  2) If so, rewrite to `legacy/<Name>.js` and log the aliasing.
  3) Keep PDFHandler untouched (active component).

  Acceptance:
  - Dynamic loads work regardless of old/new path; single log indicates aliasing.

- [x] 56. Verify index/test pages for residual legacy path references

  - Goal: Ensure only theme pages reference `legacy/` directly; base pages should not.

  Implementation steps:
  1) Grep `index.html` and other base pages for `legacy/` to confirm none present.
  2) Keep `legacy/` references scoped to theme/test contexts only.

  Acceptance:
  - Base pages tidy; theme/test pages explicitly reference `legacy/` where needed.

---

- [x] 63. Emergency "Safe Mode" for index.html (minimal viable system)

  - Goal: Make `index.html` usable immediately with minimal scripts and features while preserving the ability to re-enable advanced components later.

  Implementation steps:
  1) Add a global flag `window.__SAFE_MODE__ = true` in `index.html` before any script tags.
  2) Limit initial scripts to: `js/utils/{events.js,helpers.js,storage.js,errorDisplay.js}`, `js/stores/{AppStore.js,ExamStore.js,RecordStore.js}`, `js/ui/{ExamBrowser.js,RecordViewer.js,SettingsPanel.js}`, `js/app.js`.
  3) Temporarily exclude heavy/optional scripts from index.html (keep via injector): `js/core/scoreStorage.js`, `assets/scripts/listening-exam-data.js`, DataIntegrityManager, performanceOptimizer, academic/compat scripts.
  4) In `app.js`, gate heavy features under `if (!window.__SAFE_MODE__)` (e.g., tutorials, keyboard shortcuts, periodic diagnostics, auto-backup).
  5) Add visible notice in console: `[SAFE_MODE] Enabled - advanced features are disabled at startup`.

  Acceptance:
  - Page loads without freezing; navigation buttons work; browse/records/settings可用。
  - TTI ≤ 1000ms on mid-tier laptop。

- [x] 64. MVP render cap and pagination (avoid long list freeze)

  - Goal: Prevent UI freeze when rendering large exam lists by capping initial render and enabling "Load more".

  Implementation steps:
  1) In `ExamBrowser` list rendering, cap initial render to 50 items when `__SAFE_MODE__` is true.
  2) Append a "Load more" button that renders next 50 items per click; maintain current filters/search.
  3) Keep existing virtual scrolling code disabled in safe mode to avoid complexity; re-enable later with performance tests.

  Acceptance:
  - Long exam libraries do not freeze on initial load; user can incrementally load more。

- [x] 65. Canonical EventEmitter guard (definitive fix)

  - Goal: Eliminate duplicate EventEmitter/globalEventBus definitions that can cause event duplication and unpredictable behavior.

  Implementation steps:
  1) In `js/utils/helpers.js`, wrap EventEmitter definitions with `if (!window.EventEmitter) { ... }` and `if (!window.globalEventBus) { ... }`.
  2) Ensure `index.html` loads `js/utils/events.js` before `helpers.js`.
  3) Add a single console log `[Events] EventEmitter initialized` from the canonical source only (events.js)。

  Acceptance:
  - DevTools console shows a single EventEmitter init log; no double subscription symptoms。

- [x] 66. StorageManager "local-only" mode in safe mode

  - Goal: Reduce storage initialization overhead and avoid potential IndexedDB stalls in file://.

  Implementation steps:
  1) If `__SAFE_MODE__`, set `window.storage.useIndexedDB = false` (if supported) or short-circuit to localStorage-only path.
  2) Skip backup/restore scans on startup; expose them via Settings on-demand。

  Acceptance:
  - Storage initializes quickly; no "存储系统不可用"日志；数据读写正常。

- [x] 67. Back-compat global API bridges (MVP only)

  - Goal: Temporarily expose minimal global APIs needed by index.html/旧UI（不改变内部结构）。

  Implementation steps:
  1) 在 `app.js` 安全暴露只读桥接：`window.searchExams = (q) => App.ui?.browser?.handleSearch?.(q)`，`window.filterByType/filterByCategory` 类似模式。
  2) 在 `ExamStore` 暴露 `window.loadLibrary = () => App.stores?.exams?.refreshExams?.()`；标注弃用提示。

  Acceptance:
  - index.html 中遗留的 inline 处理器能工作，且不引入新全局污染（仅桥接必要项）。

- [x] 68. Message router lean mode

  - Goal: Simplify cross-window communication in safe mode to avoid timer storms and duplicate handling。

  Implementation steps:
  1) 在 `setupMessageRouter()` 中，当 `__SAFE_MODE__` 时禁用非关键消息类型处理（仅处理 SESSION_READY / PRACTICE_COMPLETE）。
  2) 将握手重试上限设为较小（例如 5 次），失败通过 ErrorService 提示重试。

  Acceptance:
  - 不再出现大量消息日志或定时器；完成数据能稳定回传。

- [x] 69. Critical path profiling and caps

  - Goal: 快速识别并抑制引发卡顿的关键路径（渲染/监听/轮询）。

  Implementation steps:
  1) 在 App 初始化（Data/UI/Events）与首次列表/统计渲染周围添加 `console.time` 标记；打印总耗时。
  2) 统计并打印监听器/定时器数量（使用 `debugReport()`）。
  3) 当监听器/定时器超过阈值（例如>20）时，发出警告并提示开启详细诊断。

  Acceptance:
  - 控制台有清晰的时序与数量基线；重复切换视图后数量不增长。

- [x] 70. Index.html minimal DOM contract

  - Goal: 确保 index.html DOM 结构满足 UI 组件最小依赖，避免空容器或缺失导致 JS 报错。

  Implementation steps:
  1) 校对 `#exam-list-container`、统计卡片容器、设置面板必需元素是否存在；若缺失，UI 组件在初始化时自行创建最小容器。
  2) 为导航按钮统一绑定 `data-view` 与 `showView` 桥接，确保切换稳定。

  Acceptance:
  - 页面加载后无 `querySelector` 空对象报错；视图切换稳定。

- [x] 71. Feature gates and rollback toggle

  - Goal: 为后续逐步恢复高级功能提供开关，便于定位回归问题。

  Implementation steps:
  1) 在 `SettingsPanel` 添加"高级功能开关"区域：IndexedDB/自动备份/虚拟滚动/性能诊断等，默认关闭（SAFE_MODE）。
  2) 切换时记录到 `storage.settings` 并提示刷新应用以生效。

  Acceptance:
  - 用户可在设置中逐项启用高级功能；崩溃时可通过关闭开关回退。

- [x] 72. Remove heavy scripts from base pages (deferred-only)

  - Goal: 从 `index.html` 移除重型脚本的初始加载（不删文件），统一改为按需注入。

  Implementation steps:
  1) 注释或移除 `js/core/scoreStorage.js`、`assets/scripts/listening-exam-data.js`、`js/utils/performanceOptimizer.js` 等在 index.html 的 script 标签。
  2) 保留在 `App.injectScript` 的白名单中以便后续按需加载。

  Acceptance:
  - DevTools Network 精简；首页稳定无卡顿；相关功能点（PDF/Practice/Listening）触发时仍能工作（注入后）。

- [x] 73. One-pager sanity test for index.html

  - Goal: 手工自测脚本，仅验证 index.html 的核心路径（非测试框架）。

  Implementation steps:
  1) 在控制台执行：加载题库→显示前 50 列表→搜索/筛选→切换到记录→切回浏览；观察无异常。
  2) 记录 TTI 与首次渲染耗时，确保在预算内；如超出，禁用更多可选功能再测。
  3) 创建 `test_safe_mode.html` 自检页面进行自动化测试。

  Acceptance:
  - index.html 独立可用；无滚动卡死；核心操作顺畅。
- [x] 57. Back-compat API shims for test harness (no feature removal)

  - Goal: Provide global functions expected by older tests (e.g., test_file_protocol.html) by mapping to the new architecture.

  Implementation steps:
  1) Create `js/compat/compat-shims.js` and load it only on test pages (not on index.html).
  2) Define the following globals as thin proxies (guard existence and log deprecation in debug):
     - `window.loadLibrary = () => window.App?.stores?.exams?.refreshExams?.()`
     - `window.refreshExamLibrary = window.loadLibrary`
     - `window.loadExamLibrary = window.loadLibrary`
     - `window.showLibraryConfigListV2 = (...args) => window.App?.ui?.settings?.showLibraryConfigListV2?.(...args)`
     - `window.createManualBackup = (...args) => window.App?.ui?.settings?.createManualBackup?.(...args)`
     - `window.exportAllData = (...args) => window.App?.ui?.settings?.exportData?.(...args)`
     - `window.importData = (...args) => window.App?.ui?.settings?.importData?.(...args)`
     - `window.searchExams = (q) => window.App?.ui?.browser?.handleSearch?.(q)`
     - `window.filterByType = (t) => window.App?.ui?.browser?.setType?.(t)`
     - `window.filterByCategory = (c) => window.App?.ui?.browser?.setCategory?.(c)`
  3) Add no-throw fallbacks: if target is missing, log a warning via `ErrorService.showWarning` in debug mode.

  Acceptance:
  - The test page detects all of the above globals as defined.
  - Calling them does not throw and routes to the new system when available.

- [x] 58. Test page baseline loader snippet (file:// compatible)

  - Goal: Ensure test pages load the same minimal baseline as index.html, in correct order, without duplicating code.

  Implementation steps:
  1) Create `tests/include-baseline.js` that dynamically injects, in order:
     - `assets/scripts/complete-exam-data.js`
     - `js/utils/events.js`, `js/utils/helpers.js`, `js/utils/storage.js`, `js/utils/errorDisplay.js`
     - `js/stores/AppStore.js`, `js/stores/ExamStore.js`, `js/stores/RecordStore.js`
     - `js/ui/ExamBrowser.js`, `js/ui/RecordViewer.js`, `js/ui/SettingsPanel.js`
     - `js/app.js`
     - `js/compat/compat-shims.js` (last)
  2) Have `test_regression.html` and `test_file_protocol.html` include only this single script.
  3) Provide a `window.onBaselineReady` callback that fires after all scripts load.

  Acceptance:
  - `window.storage`, `window.ExamStore`, `window.RecordStore`, `window.SettingsPanel` are present on test pages.
  - No duplicate loads; DevTools shows clean order.

- [x] 59. Storage readiness gating for tests

  - Goal: Avoid "存储系统不可用" on test pages by waiting for `window.storage` to be initialized.

  Implementation steps:
  1) Add `window.waitForStorageReady()` helper in `tests/include-baseline.js` that resolves when `window.storage` exists (poll every 50ms up to 3s).
  2) In test scripts, call `await waitForStorageReady()` before touching storage-dependent APIs.

  Acceptance:
  - Test pages no longer report missing storage.

- [x] 60. Expose SettingsPanel API to tests (read-only surface)

  - Goal: Provide a stable, test-friendly facade for settings actions without exposing internal details.

  Implementation steps:
  1) In `compat-shims.js`, add `window.SettingsPanelAPI = { exportData, importData, createManualBackup, showLibraryConfigListV2 }` that delegates to `App.ui.settings`.
  2) Document expected parameters and add warnings if not provided.

  Acceptance:
  - Test pages can call SettingsPanel features via `SettingsPanelAPI` successfully.

- [x] 61. Test harness guidance and migration notes

  - Goal: Document how tests should reference the new architecture while keeping legacy globals available on test pages only.

  Implementation steps:
  1) Add `tests/README.md` with: baseline loader usage, available shims, and migration examples (old → new API).
  2) Add a deprecation table for legacy globals and their new counterparts.

  Acceptance:
  - Contributors can run tests locally via double-click and understand available APIs.

- [x] 62. Phase-out plan for legacy globals in tests

  - Goal: After tests adopt new APIs, reduce reliance on global shims gradually.

  Implementation steps:
  1) Mark shims with `console.warn('[CompatShim] ... is deprecated')` when `__DEBUG__` is true.
  2) Update tests to directly call `App.stores` / `App.ui` methods.
  3) Track remaining uses and set a removal target date in `CLEANUP_REPORT.md`.

  Acceptance:
  - New tests use the canonical APIs; shims remain for older pages only.

---

- [ ] 91. UI constructors: call super() first (hard fix)

  - Goal: Eliminate `Must call super constructor before accessing 'this'` class errors that can cascade into render storms.

  Implementation steps:
  1) In `js/ui/ExamBrowser.js`, `js/ui/RecordViewer.js`, `js/ui/SettingsPanel.js`, move `super(stores, elements)` to be the first statement inside `constructor`.
  2) Only after `super(...)` should `this._failed`, `this._subscriptions`, and other fields be set.
  3) Wrap the entire initialization (including `super`) in a try/catch if needed; but never access `this` before `super`.

  Acceptance:
  - No class-constructor order errors in console; UI constructors complete or fail-soft gracefully.

- [ ] 92. Safe Mode: stub signature alignment and coverage

  - Goal: Ensure stubs match the method names used by UI; add missing stubs.

  Implementation steps:
  1) In `js/ui/safe-mode-stubs.js`, ensure:
     - `Pagination` exposes `pageSize`, `setTotal(total)`, `setPage(page)` used by `ExamBrowser`.
     - Add `window.RecordList` stub with `attach()`, `setRecords()`, `setBulkMode()`, `destroy()` methods.
  2) Keep constructor signatures flexible (accept unused args), e.g., `constructor(...args){}` to tolerate different call sites.
  3) Retain no-op behavior under Safe Mode.

  Acceptance:
  - No `is not a function` errors for `pagination.setTotal/setPage` or `recordList.setRecords/setBulkMode`.

- [ ] 93. UI fallback globals completeness

  - Goal: Provide defensive fallbacks in UI files to avoid missing-class crashes.

  Implementation steps:
  1) At the top of `RecordViewer.js`, add fallback for `window.RecordList` (similar to `RecordStats`).
  2) At the top of `SettingsPanel.js`, ensure fallback for `SettingsActions` exists (if not already).

  Acceptance:
  - No `ReferenceError` in UI files even if stubs failed to load.

- [ ] 94. Attach-once guards for UI components

  - Goal: Prevent multiple `attach()` calls from re-binding listeners leading to multiple renders per click.

  Implementation steps:
  1) In `BaseComponent`, track `_attached` boolean; in `attach()`, if already attached, return early.
  2) In `detach()`, reset `_attached = false`.

  Acceptance:
  - Clicking nav repeatedly does not produce multiple identical listeners; render frequency remains stable.

- [ ] 95. Minimal null-safe pagination in Safe Mode

  - Goal: Prevent NaN slicing when `pageSize` is undefined.

  Implementation steps:
  1) In `ExamBrowser._doRender()`, compute `const pageSize = this.pagination?.pageSize || 20`.
  2) Use `pageSize` for slicing and for `Pagination` updates.

  Acceptance:
  - No NaN or undefined slicing errors; list renders deterministically.

- [ ] 96. ErrorService: duplicate error suppression (tuning)

  - Goal: Further suppress repeated identical errors to keep console usable during unresolved failures.

  Implementation steps:
  1) Implement a `suppressDuplicates(signature, windowMs=1000, maxRepeats=3)` utility inside `ErrorService`.
  2) Use it in `showUser()` and `.log()` before printing to console/UI.

  Acceptance:
  - Repeated identical errors in a second are capped; a single summary appears instead.

- [ ] 97. View-activation render gating

  - Goal: Avoid `render()` triggers before the view DOM has its containers, especially under Safe Mode.

  Implementation steps:
  1) Emit a `viewActivated` event only after the view container is present in DOM.
  2) In `ExamBrowser.attach()` and `RecordViewer.attach()`, check for required containers; if missing, create via `ensureContainer()` or short-circuit with empty-state.

  Acceptance:
  - No init-time render errors due to missing containers.

- [ ] 98. Fallback to empty-state on unknown failure (user-friendly)

  - Goal: When rendering fails unexpectedly, show a friendly empty-state instead of crashing.

  Implementation steps:
  1) Wrap main `render()` bodies in try/catch; on catch, call `renderEmptyState()` and set `_failed`.
  2) Clear or detach store subscriptions to avoid repeated failing callbacks.

  Acceptance:
  - A friendly state appears instead of crash or infinite error logs; other views remain usable.

---

- [ ] 99. Remove UI auto‑instantiation; App owns lifecycle

  - Goal: Eliminate duplicate UI instances and bad stores passed by global self‑init code in UI files.

  Implementation steps:
  1) In `js/ui/ExamBrowser.js`, `js/ui/RecordViewer.js`, `js/ui/SettingsPanel.js`, comment/remove bottom blocks that:
     - create global instances with `new ... (window.stores || { ... })`
     - assign `window.*Instance = ...`
     - call `.attach(...)` immediately
  2) Keep only the class exports: `window.ExamBrowser = ExamBrowser;` etc.
  3) App is the single owner: it constructs with real stores and calls `attach()` explicitly.

  Acceptance:
  - No UI code runs before App creates proper stores; no duplicate instances; no early `.subscribe` errors.

- [ ] 100. Pass real stores to UI and attach explicitly

  - Goal: Ensure UI receives valid store instances and attaches after DOM is ready.

  Implementation steps:
  1) In `App.initializeMinimalUI()`, construct UI with stores: `new window.ExamBrowser(this.stores)` etc.
  2) Call `attach()` with the correct containers:
     - `browser.attach(document.getElementById('browse-view'))`
     - `recordViewer.attach(document.getElementById('practice-view'))`
     - `settings.attach(document.getElementById('settings-view'))`
  3) Only after `attach()` subscribe to events or expose bridges.

  Acceptance:
  - No `subscribe is not a function` for `this.stores.exams/records`; UI renders successfully in Safe Mode.

- [ ] 101. UI stores fallback (defensive only)

  - Goal: Provide a safe fallback inside UI constructors when stores are omitted.

  Implementation steps:
  1) At top of each UI constructor: `this.stores = stores || window.App?.stores || { exams: null, records: null, app: null };`
  2) All store usages must be guarded: check method existence before calling; otherwise short‑circuit to empty‑state.

  Acceptance:
  - UI does not crash if constructed without stores (Safe Mode still OK), but App passes stores in normal flow.

- [ ] 102. Error normalization for object errors

  - Goal: Fix repeated "Unknown error type: object" by normalizing non‑Error payloads.

  Implementation steps:
  1) In `ErrorService`/error handler, add a `normalizeError(e)` that returns `{ message, stack }` for plain objects and strings.
  2) Use `JSON.stringify(e)` fallback for objects without `message`, cap size to 512 chars.
  3) Replace raw `console.error(e)` with normalized output and apply duplicate suppression (Task 96).

  Acceptance:
  - No more "Unknown error type: object" spam; errors show actionable messages.

- [ ] 103. Safe Mode: prevent mixed storage modes during init

  - Goal: Avoid switching to IndexedDB mid‑session under Safe Mode causing side effects.

  Implementation steps:
  1) If `__SAFE_MODE__`, ensure storage stays local‑only; skip post‑init IndexedDB enablement.
  2) Hide/disable storage migration logs in Safe Mode; expose via Settings toggle only.

  Acceptance:
  - Safe Mode session does not re‑enter IndexedDB; logs remain consistent with local‑only path.

- [ ] 104. One UI instance policy validation

  - Goal: Verify at runtime that only one instance per UI component exists to prevent double renders.

  Implementation steps:
  1) Add `window.__uiInstances = {}`; upon UI constructor, increment counters; on `detach()`, decrement.
  2) In Safe Mode, if count > 1, log a warning and skip further instantiation.

  Acceptance:
  - Runtime shows at most one `ExamBrowser/RecordViewer/SettingsPanel` instance.

- [ ] 105. Minimal browse/practice render via App until UI stabilized

  - Goal: As a fallback, use App’s Safe Mode renderers while UI components stabilize.

  Implementation steps:
  1) Gate UI component .render() calls behind a flag `window.__USE_UI_COMPONENTS__` (default true).
  2) If false, skip UI attach/render and rely on `renderBrowseViewSafeMode()` / `renderPracticeViewSafeMode()`.
  3) Provide a Settings toggle to switch back to component rendering after fixes.

  Acceptance:
  - Even if UI component attach fails, App’s fallback keeps the page usable.

- [ ] 106. Final Safe Mode smoke (after 99–105)

  - Goal: Confirm the elimination of crashes and error floods when clicking Browse/Practice/Settings.

  Implementation steps:
  1) Reload index.html; verify logs show no early UI instantiation and no subscribe errors.
  2) Click Browse/Practice/Settings sequentially; observe no freezes; record metrics to `PERF_NOTES.md`.

  Acceptance:
  - No `subscribe is not a function`; no error floods; navigation remains responsive.

---

- [x] 74. Provide BaseComponent and include order fix

  - Goal: Resolve `BaseComponent is not defined` by adding a minimal base class and ensuring it loads before UI components.

  Implementation steps:
  1) Create `js/ui/BaseComponent.js` with a minimal class exposing `attach(root)`, `detach()`, `render()` no-ops and an `ensureContainer(selector)` helper.
  2) Update `index.html` to include `<script src="js/ui/BaseComponent.js"></script>` before `ExamBrowser.js`/`RecordViewer.js`/`SettingsPanel.js`.
  3) In each UI component file, guard against missing BaseComponent by falling back to a no-op base: `window.BaseComponent = window.BaseComponent || class { attach(){} detach(){} render(){} }` (top of file) if direct import is hard.

  Acceptance:
  - Console no longer reports `BaseComponent is not defined`.
  - UI components initialize without throwing when containers are missing (use ensureContainer).

- [x] 75. Fix Safe Mode storage init call mismatch

  - Goal: Remove `this.initializeStorageSafeMode is not a function` by aligning App with Storage API.

  Implementation steps:
  1) In `js/app.js`, replace calls to `this.initializeStorageSafeMode()` with `await window.storage?.initializeLocalStorageOnly?.()` or a guarded path: `if (window.__SAFE_MODE__ && window.storage?.initializeLocalStorageOnly) await window.storage.initializeLocalStorageOnly();`.
  2) Ensure this call happens before stores initialization; if stores lazily call storage, keep idempotent.
  3) Add try/catch with `ErrorService.showWarning` on failure, but continue boot with localStorage default.

  Acceptance:
  - No `initializeStorageSafeMode` error; Safe Mode storage path confirmed by logs。

- [x] 76. Single success/failure path for App.initialize (no double logs)

  - Goal: Avoid mixed state where initialization logs success after a thrown error.

  Implementation steps:
  1) Ensure `App.initialize()` returns early upon Safe Mode error; move `初始化成功` log only after all awaited steps.
  2) If a non-fatal Safe Mode step fails, log via `ErrorService.showWarning` and continue, but do not throw unhandled promise rejections.
  3) Add a top-level `.catch()` at the bootstrap site that logs a single failure banner and prevents duplicate success logs.

  Acceptance:
  - Console shows either a clean success banner or a single failure banner, never both.

- [x] 77. Harden UI component bootstrap under Safe Mode

  - Goal: Ensure UI components do not assume advanced features and do not break when optional containers are missing.

  Implementation steps:
  1) In UI constructors, when `__SAFE_MODE__` is true, skip expensive setup (virtual scroll, observers) and rely on MVP render.
  2) Use `BaseComponent.ensureContainer()` to create required containers if selectors return null.
  3) Wrap event bindings with guards and log debug-only warnings.

  Acceptance:
  - No runtime errors from UI constructors; navigation & minimal interactions work.

- [ ] 78. Safe Mode re-enable path (feature toggles)

  - Goal: Verify Settings toggles correctly re-enable optional features and re-bootstrap needed scripts.

  Implementation steps:
  1) For each toggle (IndexedDB, auto-backup, performance diagnostics, virtual scroll), define a handler that persists the flag and prompts for reload.
  2) On reload, App reads the flags and disables `__SAFE_MODE__` branches stepwise: a) storage, b) diagnostics, c) list rendering strategy.
  3) Confirm PDF/Practice/Listening features still inject needed scripts on demand.

  Acceptance:
  - Enabling toggles survives reload and does not reintroduce freezes; can be turned off to roll back.

- [x] 79. Index.html script block audit (final Safe Mode pass)

  - Goal: Verify script order and ensure only minimal baseline is present on index.html.

  Implementation steps:
  1) Confirm order: events.js → helpers.js → storage.js → errorDisplay.js → BaseComponent.js → stores → ui → app.
  2) Confirm heavy scripts are not present initially; verify `App.injectScript` covers PDF/Practice/Listening.
  3) Grep for residual references to removed scripts in `index.html` and fix.

  Acceptance:
  - No 404; no ReferenceError; TTI ≤ 1000ms measured via console timing.

- [x] 80. Console hygiene and debug gates (Safe Mode)

  - Goal: Ensure production (index.html) console is concise; detailed logs only with `__DEBUG__`.

  Implementation steps:
  1) Gate non-essential `console.log` behind `if (window.__DEBUG__)` in hot paths added for Safe Mode.
  2) Keep `[SAFE_MODE]` prefix for high-level notices; limit frequency.
  3) Add a one-liner to toggle `__DEBUG__` in Settings for troubleshooting.

  Acceptance:
  - Production console retains only key notices; debug details appear only when enabled.

---

- [x] 81. Safe Mode UI stub components (prevent ReferenceError)

  - Goal: Provide minimal no-op stubs for subcomponents referenced by UI, to avoid crashes in Safe Mode.

  Implementation steps:
  1) Create `js/ui/safe-mode-stubs.js` that defines no-op globals:
     - `window.ExamFilterBar`, `window.ExamList`, `window.Pagination`
     - `window.RecordStats`
     - `window.SettingsActions`
     Each exposes constructors and the minimal methods used by current UI (e.g., `render`, `update`, `destroy`) as no-ops.
  2) Include `safe-mode-stubs.js` in `index.html` before `ExamBrowser.js`, `RecordViewer.js`, `SettingsPanel.js`.
  3) At the top of each UI file, keep a defensive fallback:
     - `window.ExamFilterBar = window.ExamFilterBar || class { render(){} update(){} destroy(){} }` (similar for others).

  Acceptance:
  - No `ReferenceError` for `ExamFilterBar`, `RecordStats`, or `SettingsActions` when opening Browse/Practice/Settings views.
  - UI loads and remains interactive under Safe Mode.

- [x] 82. UI bootstrap error guards and fail-soft rendering

  - Goal: Prevent error storms by isolating UI init errors and avoiding re-render loops.

  Implementation steps:
  1) Wrap UI constructor logic in try/catch; on error, call `ErrorService.showWarning('UI init failed: ...')` and set an internal `_failed = true` flag.
  2) In `render()`/`update()` paths, if `_failed` is true, short-circuit and avoid scheduling further renders.
  3) Ensure store subscriptions are removed/unset when init fails to avoid repeated callbacks.

  Acceptance:
  - Clicking Browse/Practice no longer floods console; at most one warning toast appears.
  - Other views remain usable after a single view init failure.

- [x] 83. Single-time nav listener binding

  - Goal: Avoid duplicate event listeners on navigation buttons causing multiple renders per click.

  Implementation steps:
  1) In Safe Mode init, add a guard `if (this._navBound) return; this._navBound = true;` before binding nav button listeners.
  2) When re-initializing (if any), do not rebind; provide a `teardownNav()` only for full reset paths.

  Acceptance:
  - Log like "已设置 4 个导航按钮监听器" appears only once across the session.
  - Each click leads to a single render call (verify via console counts).

- [x] 84. Render re-entrancy guard and microtask debounce

  - Goal: Ensure at most one render cycle per tick to prevent render storms.

  Implementation steps:
  1) In each UI component, add `this._renderPending` flag; if set, skip scheduling.
  2) Use `queueMicrotask(() => { this._renderPending = false; this._doRender(); })` to coalesce multiple updates.
  3) Cancel pending work on `detach()`.

  Acceptance:
  - Rapid clicks/search only trigger one render per tick; no call stack growth observed.

- [x] 85. Browse view minimal data path (empty-safe)

  - Goal: Avoid freezes when data stores are not ready or empty under Safe Mode.

  Implementation steps:
  1) Before list render, if `App.stores?.exams?.exams` is not an array, attempt `await storage.get('exam_index', [])` as fallback.
  2) If still empty, show a friendly empty-state card and return without list processing.
  3) Cap initial items at 50 (already in Task 64) and ensure filters/search operate on the subset without exceptions.

  Acceptance:
  - Clicking Browse never freezes even with empty storage; empty-state renders instantly.

- [x] 86. Practice view minimal stats path (empty-safe)

  - Goal: Avoid freezes in Practice view when no records are present or RecordStore isn’t initialized.

  Implementation steps:
  1) If `App.stores?.records?.records` is not an array, fallback to `await storage.get('practice_records', [])`.
  2) Compute minimal stats (count/avg/time) defensively; guard NaNs.
  3) Render a light record list with cap=50; no virtual scroll in Safe Mode.

  Acceptance:
  - Clicking Practice never freezes; stats show 0s gracefully when empty.

- [ ] 87. Global error flood throttling

  - Goal: Prevent repeated identical exceptions from flooding console/UI.

  Implementation steps:
  1) In `ErrorService`, maintain a `Map<signature, {count, lastTs}>`; for duplicate messages within 1s, drop after 3 occurrences and log once: "muted X repeats".
  2) Resets counters after a cool-down (e.g., 10s).

  Acceptance:
  - Under failure, each unique error appears few times, then gets muted; console remains readable.

- [ ] 88. Disable advanced observers/RAF in Safe Mode

  - Goal: Eliminate background animation/observers that can exacerbate freezes.

  Implementation steps:
  1) Guard any `requestAnimationFrame` loops, `IntersectionObserver`, `ResizeObserver` behind `if (!__SAFE_MODE__)`.
  2) For remnants, add runtime checks to skip scheduling when in Safe Mode.

  Acceptance:
  - No RAF/observer-related resource usage in performance panel under Safe Mode.

- [ ] 89. Script order enforcement check (runtime)

  - Goal: Detect misordered scripts at runtime to prevent ReferenceError.

  Implementation steps:
  1) In `BaseComponent.js`, on load check `if (!window.ExamFilterBar && window.__SAFE_MODE__) console.warn('[SafeMode] UI stubs missing before UI components')`.
  2) Add a small `verifyOrder()` in `App.initialize()` that asserts required globals before proceeding in Safe Mode and shows a single actionable toast on mismatch.

  Acceptance:
  - No warnings in correct order; clear guidance if order is broken.

- [ ] 90. Post-fix Safe Mode smoke and metrics

  - Goal: Validate that freezes are eliminated and performance budgets are met.

  Implementation steps:
  1) After fixes, run a manual smoke: Browse (50 items) → Practice (stats) → Settings toggle check.
  2) Capture metrics: TTI ≤ 1000ms, first render ≤ 300ms, listener count stable; record into `PERF_NOTES.md`.

  Acceptance:
  - No freezes when opening Browse/Practice; metrics recorded and within budgets.
