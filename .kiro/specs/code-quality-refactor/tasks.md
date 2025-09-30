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


- [ ] 9.2 Consolidate remaining functionality
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


- [ ] 9.3 Fix compatibility and missing functions
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

- [ ] 9.4 Optimize script loading order and reduce file count
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

- [ ] 10. Decompose large UI files and enforce file size budgets

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

- [ ] 11. Minimize global scope and centralize events

  - Make `window.App` the only global entry; route all internal comms via `App.events` (wrap existing `globalEventBus`)
  - Demote ad-hoc `window.*` helpers to be referenced through `App` (kept global for file:// but not used that way)
  - Document the public surface: `App.stores`, `App.ui`, `App.events`, `App.initialize()`
  - _Requirements: 6.1, 6.2, 5.3_

  Acceptance criteria:
  - Grep finds no new non-whitelisted globals besides `App`, `storage`, `EventEmitter` (utils)
  - Events are emitted/subscribed via a single event hub

- [ ] 12. Harden cross‑window communication

  - Define strict message schema with type guards for `SESSION_READY`, `PROGRESS_UPDATE`, `PRACTICE_COMPLETE`
  - Add retry/backoff with max attempts; surface failure via `AppStore.addError`
  - Deduplicate PRACTICE_COMPLETE by `sessionId` using a Set within `RecordStore`
  - _Requirements: 5.1, 7.1, 7.3_

  Acceptance criteria:
  - Double “complete” messages store only one record
  - Lost `SESSION_READY` transitions recover via retry without user action

- [ ] 13. Data model and migration consistency

  - Normalize record schema on write: id, examId, date, duration, score.percentage, dataSource, answers, metadata
  - Keep storage keys aligned to `storage.js` defaults: `exam_index`, `practice_records`, `active_exam_index_key`
  - Add light migration at store boundaries for older shapes (`realData`, `scoreInfo`)
  - _Requirements: 1.1, 5.4, 7.2_

  Acceptance criteria:
  - `RecordStore.getRecords()` returns normalized objects regardless of legacy shapes
  - Export/import produces/accepts the normalized schema

- [ ] 14. Regression test matrix (manual, file://)

  - Browsers: Chrome (primary), Edge/Safari (sanity)
  - Scenarios: startup with empty storage; with existing data; open/complete practice; import/export; switch library config; PDF open
  - Data integrity: restart browser → verify records/stats persisted
  - Cross‑window: handshake reliability, duplicate suppression
  - Performance: exam list with >500 items; virtual scrolling responsive
  - _Requirements: All_

- [ ] 15. Documentation updates (English)

  - Update `assets/developer wiki/English wiki/*` for the new architecture: Core, System Architecture, Infrastructure Components
  - Add READMEs to `js/stores/`, `js/ui/`, `js/utils/` explaining responsibilities and public APIs
  - Include a “file:// constraints” section in Core docs (script order, globals, no dynamic imports)
  - _Requirements: 8.1, 8.5_

- [ ] 16. Risk and rollback plan

  - Keep a feature parity checklist; remove legacy only after parity is signed off
  - Provide a one‑click “Rebuild indexes” and “Restore backup” path in Settings
  - Document rollback steps: restore archived legacy files and script tags

- [ ] 17. Performance budgets and instrumentation

  - Define budgets: TTI < 800ms (baseline), search debounce 300ms, render batch size 50
  - Add light timers/marks around store init and first render (console only)
  - Validate on a mid‑tier machine in file:// mode

- [ ] 18. Code quality gates (enforced by review)

  - No silent `catch` blocks; always surface via `AppStore.addError`
  - Functions with >2 nesting levels must be split
  - No direct DOM mutation from stores; UI only
  - Each file has a short header stating its single responsibility
