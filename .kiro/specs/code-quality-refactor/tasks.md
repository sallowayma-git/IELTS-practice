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

- [ ] 39. Isolate test scripts and remove production references

  - Goal: Keep `js/tests/` and `js/testing/` completely out of production pages; load them only in `test_regression.html`.

  Implementation steps:
  1) Grep production HTML for accidental test includes (`index.html`, theme pages): ensure none reference `js/tests/` or `js/testing/`.
  2) Wire tests exclusively in `test_regression.html` via explicit `<script>` tags; do not rely on wildcard loaders.
  3) Add a small banner in `test_regression.html` to make it obvious when tests are loaded (prevents accidental prod use).
  4) Optionally move test-only helpers to `tests/helpers/` and keep a clear "non-prod" prefix in filenames.

  Acceptance:
  - Opening `index.html` never loads code from `js/tests/` or `js/testing/`.
  - Opening `test_regression.html` loads tests without console errors.

- [ ] 40. Gate verbose console logs behind a debug flag (no behavior change)

  - Goal: Reduce console noise in production while preserving troubleshooting signals in tests.

  Implementation steps:
  1) Add a global `window.__DEBUG__` flag defaulting to `false` (set `true` in `test_regression.html`).
  2) In high-chattiness modules (e.g., `js/practice-page-enhancer.js`, `js/practice-page-common.js`, UI components), wrap non-essential `console.log` with a `debugLog(...)` helper that checks `__DEBUG__`.
  3) Keep `console.error` and critical warnings untouched.

  Acceptance:
  - Baseline (index.html) has minimal console output (no chatty logs).
  - Test page shows detailed logs when `__DEBUG__ = true`.

- [ ] 41. Script ownership map and dead-code quarantine plan

  - Goal: Produce a clear map of scripts → owners → entry points; quarantine unreferenced scripts under `legacy/` (no deletion yet).

  Implementation steps:
  1) Inventory all JS files and classify: core baseline, optional on-demand, theme-only, tests, legacy.
  2) For each script, list its entry points (HTML includes or dynamic injection sites) and owning module.
  3) Move scripts with no entry points to `legacy/` and document rationale in `CLEANUP_REPORT.md`.
  4) Ensure no code path references files in `legacy/`.

  Acceptance:
  - A `SCRIPT_OWNERSHIP.md` exists with current mapping and decisions.
  - No production page references any file under `legacy/`.

- [ ] 42. Dependency layering rules and sanity checks

  - Goal: Enforce the layered dependencies: `utils → stores → ui → app`, with plugins/theme pages on top.

  Implementation steps:
  1) Document layering in `ARCHITECTURE_NOTES.md` (English): allowed/forbidden directions with examples.
  2) Grep for upward references (e.g., stores touching DOM, ui reaching into storage directly) and note findings.
  3) For each violation, add a 1-line TODO with a proposed refactor-in-place (no feature removal).

  Acceptance:
  - Documented rules exist; known violations are listed with owners and fix plans.

- [ ] 43. Consolidate practice communication paths (no loss of functionality)

  - Goal: Ensure exactly one parent-side router (App) and child-side listeners only on practice pages.

  Implementation steps:
  1) Audit `window.addEventListener('message', ...)` across repo; mark each as parent-side or child-side.
  2) Parent side: keep only `App.setupMessageRouter()`; add guards where other modules attach in parent context.
  3) Child side: keep listeners in `practice-page-enhancer.js` and related child-only modules; guard with `isPracticeWindow()`.

  Acceptance:
  - Parent page shows exactly one `message` listener in DevTools.
  - Child windows continue to work; tests for duplicate suppression remain green.

- [ ] 44. Storage keys and migration consistency (final pass)

  - Goal: Ensure all code paths use the same keys as `js/utils/storage.js` and normalize old shapes at store boundaries.

  Implementation steps:
  1) List all storage keys used in code; compare against `StorageManager.prefix` and documented keys.
  2) Add lightweight migration in `RecordStore`/`ExamStore` for any remaining legacy record shapes.
  3) Update docs with the final set of keys, noting deprecated ones.

  Acceptance:
  - No mixed-prefix or duplicate keys; legacy shapes normalized on read.

- [ ] 45. PDF path normalization centralization

  - Goal: Keep path normalization in one place when opening PDFs; remove scattered adaptations.

  Implementation steps:
  1) Ensure `App.viewPDF()` computes/normalizes the PDF path; call PDFHandler with the final path.
  2) Remove/disable ad-hoc PDF path overrides (e.g., in `js/academic-init.js`) for base pages; keep theme-specific fallbacks only on theme pages.
  3) Document the normalization rules and examples.

  Acceptance:
  - One code path computes the PDF path; no duplicate normalization logic.

- [ ] 46. Theme/academic compatibility scripts hardening

  - Goal: Ensure `js/academic-*.js`, `js/script.js`, `js/design-adaptations.js` are not loaded by base pages unless explicitly required.

  Implementation steps:
  1) Confirm none of the base pages include these scripts.
  2) If needed by specific themes, load them from the theme pages only; remove any global side effects.
  3) Add a short README under `js/plugins/` explaining the scope of theme scripts.

  Acceptance:
  - Base pages function without these compatibility scripts; theme pages remain functional.

- [ ] 47. ErrorService adoption sweep (no behavior change)

  - Goal: Replace direct `showMessage*` usages with the ErrorService facade across UI.

  Implementation steps:
  1) Grep for `showMessage`/`showErrorMessage` in UI; replace with `ErrorService.showUser/showWarning/showInfo`.
  2) Keep backward-compat globals for third-party scripts but stop using them internally.

  Acceptance:
  - Internal codebases reference only ErrorService for user-facing messages.

- [ ] 48. Performance budgets and console timing baselines

  - Goal: Maintain TTI ≤ 800ms and responsive lists with batch size 50/debounce 300ms.

  Implementation steps:
  1) Keep `console.time` markers around App init and first render; record results in a short `PERF_NOTES.md` snapshot.
  2) Verify list rendering uses batching/virtualization thresholds consistently across views.

  Acceptance:
  - Perf logs present and stable across runs; lists remain responsive beyond 500 items.

- [ ] 49. Code style and naming consistency (no toolchain changes)

  - Goal: Improve readability without introducing new linters.

  Implementation steps:
  1) Adopt consistent naming for stores (`Exams`, `Records`, `App`) and UI components; avoid ambiguous names.
  2) Add short file headers stating single responsibility and owner module.
  3) Split overly nested functions where necessary (≤ 2 levels rule), without behavior change.

  Acceptance:
  - New/edited files adhere to the style; reviewers can quickly identify ownership and purpose.

- [ ] 50. Final script de-dup pass and commit plan

  - Goal: Remove or quarantine non-referenced/duplicate scripts after all previous tasks are green.

  Implementation steps:
  1) Re-run the ownership map; produce a deletion/quarantine candidate list with justification.
  2) For each candidate, ensure no dynamic injection references; move to `legacy/` or delete if trivial.
  3) Update `CLEANUP_REPORT.md` with before/after counts and a rollback note.

  Acceptance:
  - Repo no longer contains unused production-facing scripts; tests and baseline pages unaffected.
