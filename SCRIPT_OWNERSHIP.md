# Script Ownership Map

This document maps all JavaScript files to their entry points, owners, and current status as part of the code quality refactoring project.

## Core Baseline Scripts

| File | Entry Points | Owner | Layer | Status | Notes |
|------|--------------|-------|-------|--------|-------|
| `js/utils/events.js` | `index.html` (line 140) | Utils | Utils | ✅ Active | Canonical EventEmitter source |
| `js/utils/helpers.js` | `index.html` (line 141) | Utils | Utils | ✅ Active | Debug flag & debugLog helper |
| `js/utils/storage.js` | `index.html` (line 142) | Utils | Utils | ✅ Active | localStorage abstraction |
| `js/utils/errorDisplay.js` | `index.html` (line 143) | Utils | Utils | ✅ Active | ErrorService facade |
| `js/stores/AppStore.js` | `index.html` (line 146) | Stores | Stores | ✅ Active | Application state management |
| `js/stores/ExamStore.js` | `index.html` (line 147) | Stores | Stores | ✅ Active | Exam data management |
| `js/stores/RecordStore.js` | `index.html` (line 148) | Stores | Stores | ✅ Active | Practice records management |
| `js/ui/BaseComponent.js` | Dynamically loaded | UI | UI | ✅ Active | Base component pattern |
| `js/ui/ExamBrowser.js` | Dynamically loaded | UI | UI | ✅ Active | Exam browsing interface |
| `js/ui/ExamList.js` | Dynamically loaded | UI | UI | ✅ Active | Exam list rendering |
| `js/ui/ExamFilterBar.js` | Dynamically loaded | UI | UI | ✅ Active | Exam filtering |
| `js/ui/Pagination.js` | Dynamically loaded | UI | UI | ✅ Active | List pagination |
| `js/ui/RecordViewer.js` | Dynamically loaded | UI | UI | ✅ Active | Practice records interface |
| `js/ui/RecordStats.js` | Dynamically loaded | UI | UI | ✅ Active | Statistics display |
| `js/ui/SettingsPanel.js` | Dynamically loaded | UI | UI | ✅ Active | Settings management |
| `js/main.js` | `index.html` (line 149) | Main | App | ✅ Active | Application bootstrap |
| `js/app.js` | `index.html` (line 150) | App | App | ✅ Active | Core application logic |

## On-Demand Scripts

| File | Entry Points | Owner | Layer | Status | Injection Trigger |
|------|--------------|-------|-------|--------|-------------------|
| `js/components/PDFHandler.js` | `App.viewPDF()` | Components | App | ✅ Active | PDF view action |
| `js/core/practiceRecorder.js` | `App.openExam()` | Core | App | ✅ Active | Practice session start |
| `js/core/scoreStorage.js` | `App.openExam()` | Core | App | ✅ Active | Practice session start |

## Theme & HP Page Scripts

| File | Entry Points | Owner | Layer | Status | Scope |
|------|--------------|-------|-------|--------|-------|
| `js/academic-init.js` | Academic pages | Academic | Theme | ✅ Active | Academic theme only |
| `js/academic-fixes.js` | Academic pages | Academic | Theme | ✅ Active | Academic theme only |
| `js/academic-enhancements.js` | Academic pages | Academic | Theme | ✅ Active | Academic theme only |
| `js/plugins/hp/*.js` | HP theme pages | HP | Theme | ✅ Active | HP theme only |
| `js/design-adaptations.js` | Theme pages | Design | Theme | ✅ Active | Theme adaptations |
| `js/script.js` | Theme pages | Theme | Theme | ✅ Active | Theme-specific logic |
| `js/theme-switcher.js` | Theme pages | Theme | Theme | ✅ Active | Theme switching |

## Test Scripts (Test-Only)

| File | Entry Points | Owner | Layer | Status | Notes |
|------|--------------|-------|-------|--------|-------|
| `js/tests/integration-test.js` | `test_regression.html` (line 154) | Tests | Test | ✅ Isolated | Production-safe |
| `js/testing/end-to-end-test.js` | `test_regression.html` (line 155) | Tests | Test | ✅ Isolated | Production-safe |

## Legacy Components (Candidate for Quarantine)

| File | Entry Points | Owner | Layer | Status | Quarantine Reason |
|------|--------------|-------|-------|--------|-------------------|
| `js/components/CommunicationTester.js` | None found | Components | Legacy | ⚠️ Unused | Development/testing tool |
| `js/components/EventManager.js` | None found | Components | Legacy | ⚠️ Unused | Replaced by EventEmitter |
| `js/components/IndexValidator.js` | None found | Components | Legacy | ⚠️ Unused | Development validation |
| `js/components/dataManagementPanel.js` | None found | Components | Legacy | ⚠️ Unused | Replaced by SettingsPanel |
| `js/components/goalSettings.js` | None found | Components | Legacy | ⚠️ Unused | Legacy goal management |
| `js/components/practiceRecordModal.js` | None found | Components | Legacy | ⚠️ Unused | Legacy modal UI |
| `js/components/practiceHistoryEnhancer.js` | None found | Components | Legacy | ⚠️ Unused | Legacy history enhancement |
| `js/components/progressTracker.js` | None found | Components | Legacy | ⚠️ Unused | Legacy progress tracking |
| `js/components/questionTypePractice.js` | None found | Components | Legacy | ⚠️ Unused | Legacy practice type |
| `js/components/recommendationDisplay.js` | None found | Components | Legacy | ⚠️ Unused | Legacy recommendations |
| `js/components/specializedPractice.js` | None found | Components | Legacy | ⚠️ Unused | Legacy specialized practice |
| `js/components/mainNavigation.js` | None found | Components | Legacy | ⚠️ Unused | Replaced by AppStore |
| `js/components/practiceHistory.js` | None found | Components | Legacy | ⚠️ Unused | Replaced by RecordViewer |

## Core Modules (Keep - Functional)

| File | Entry Points | Owner | Layer | Status | Notes |
|------|--------------|-------|-------|--------|-------|
| `js/core/goalManager.js` | None found | Core | Core | ⚠️ Orphan | Functionality preserved |
| `js/core/recommendationEngine.js` | None found | Core | Core | ⚠️ Orphan | Functionality preserved |
| `js/core/scoreAnalyzer.js` | None found | Core | Core | ⚠️ Orphan | Functionality preserved |
| `js/core/weaknessAnalyzer.js` | None found | Core | Core | ⚠️ Orphan | Functionality preserved |

## Utility Modules (Keep - Functional)

| File | Entry Points | Owner | Layer | Status | Notes |
|------|--------------|-------|-------|--------|-------|
| `js/utils/asyncExportHandler.js` | None found | Utils | Utils | ⚠️ Orphan | Export functionality |
| `js/utils/dataBackupManager.js` | None found | Utils | Utils | ⚠️ Orphan | Backup functionality |
| `js/utils/dataConsistencyManager.js` | None found | Utils | Utils | ⚠️ Orphan | Data consistency |
| `js/utils/helpSystem.js` | None found | Utils | Utils | ⚠️ Orphan | Help system |
| `js/utils/keyboardShortcuts.js` | None found | Utils | Utils | ⚠️ Orphan | Keyboard shortcuts |
| `js/utils/responsiveManager.js` | None found | Utils | Utils | ⚠️ Orphan | Responsive design |
| `js/utils/themeManager.js` | None found | Utils | Utils | ⚠️ Orphan | Theme management |
| `js/utils/touchHandler.js` | None found | Utils | Utils | ⚠️ Orphan | Touch interactions |
| `js/utils/tutorialSystem.js` | None found | Utils | Utils | ⚠️ Orphan | Tutorial system |
| `js/utils/systemDiagnostics.js` | None found | Utils | Utils | ⚠️ Orphan | System diagnostics |
| `js/utils/communicationTest.js` | None found | Utils | Utils | ⚠️ Orphan | Communication testing |
| `js/utils/systemTest.js` | None found | Utils | Utils | ⚠️ Orphan | System testing |
| `js/utils/cleanupGuide.js` | None found | Utils | Utils | ⚠️ Orphan | Cleanup guidance |
| `js/utils/performanceOptimizer.js` | None found | Utils | Utils | ⚠️ Orphan | Performance optimization |

## Compatibility & Patches

| File | Entry Points | Owner | Layer | Status | Notes |
|------|--------------|-------|-------|--------|-------|
| `js/compatibility/legacy-bridge.js` | None found | Compatibility | Legacy | ⚠️ Unused | Legacy compatibility |
| `js/patches/runtime-fixes.js` | None found | Patches | Legacy | ⚠️ Unused | Runtime fixes |
| `js/adapters/practice-page-adapters.js` | None found | Adapters | Legacy | ⚠️ Unused | Legacy adapters |

## Special Pages & Enhancers

| File | Entry Points | Owner | Layer | Status | Notes |
|------|--------------|-------|-------|--------|-------|
| `js/practice-page-enhancer.js` | Practice pages | Practice | App | ✅ Active | Practice enhancement |
| `js/practice-page-common.js` | Practice pages | Practice | App | ✅ Active | Practice common logic |
| `js/utils/examCommunication.js` | Practice pages | Communication | App | ✅ Active | Cross-window communication |

## Summary

- **Total JS files**: 84
- **Active core baseline**: 16 files
- **Active on-demand**: 3 files
- **Active theme/HP**: ~8 files
- **Active test-only**: 2 files
- **Active practice pages**: 3 files
- **Legacy components (quarantine candidates)**: 14 files
- **Orphaned but functional**: 17 files
- **Compatibility/patches**: 3 files

## Cleanup Plan

1. **Phase 1**: Move unused legacy components to `legacy/` directory
2. **Phase 2**: Evaluate orphaned functional modules for integration or quarantine
3. **Phase 3**: Consolidate compatibility and patch files
4. **Phase 4**: Update documentation and remove dead code references

## Entry Point Verification Method

- HTML files: `grep -r "src=" *.html` for script includes
- Dynamic loading: `grep -r "injectScript\|loadScript" js/` for programmatic loading
- Theme pages: Manual verification of theme-specific HTML files
- Test files: Verified in `test_regression.html` only

*Last updated: Task 41 implementation*