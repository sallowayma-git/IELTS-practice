# Mixins & Component Architecture

> **Relevant source files**
> * [AGENTS.md](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/AGENTS.md)
> * [css/main.css](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/css/main.css)
> * [index.html](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/index.html)
> * [js/app.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js)
> * [js/app/examSessionMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js)
> * [js/app/suitePracticeMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js)
> * [js/main.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js)
> * [js/utils/environmentDetector.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/environmentDetector.js)

## Purpose and Scope

This document describes the mixin-based composition pattern used to structure `ExamSystemApp` and the component lifecycle management system. The mixin architecture provides modular functionality by composing behavior from multiple sources rather than using classical inheritance.

For application initialization flow, see [Application Initialization & Bootstrap](/sallowayma-git/IELTS-practice/3.2-application-initialization-and-lifecycle). For state management details, see [ExamSystemApp & State Management](/sallowayma-git/IELTS-practice/3.1-examsystemapp-and-state-management). For view rendering, see [View Management & Navigation](/sallowayma-git/IELTS-practice/3.3-view-management-and-navigation).

---

## Overview of the Mixin Pattern

The application uses a **mixin composition pattern** where the base `ExamSystemApp` class is extended with multiple mixins that provide specific capabilities. Each mixin is a plain object containing methods that are copied onto `ExamSystemApp.prototype`, allowing the class to inherit behavior from multiple sources.

This design enables:

* **Separation of concerns**: Each mixin handles a specific domain (state, navigation, lifecycle, etc.)
* **Code organization**: Related functionality is grouped into cohesive modules
* **Testability**: Individual mixins can be tested independently
* **Progressive enhancement**: Mixins can be loaded conditionally

**Sources:** [js/app.js L1-L121](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L1-L121)

---

## Base ExamSystemApp Class

The `ExamSystemApp` class serves as the foundation that mixins extend. The base class defines:

### Core Properties

| Property | Type | Purpose |
| --- | --- | --- |
| `currentView` | `string` | Currently active view name (default: `'overview'`) |
| `components` | `Object` | Registry of component instances |
| `isInitialized` | `boolean` | Initialization status flag |
| `state` | `Object` | Centralized application state |

### State Structure

The `state` object is organized into five top-level namespaces:

```

```

**Sources:** [js/app.js L6-L62](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L6-L62)

---

## Mixin Application Mechanism

### Registration and Application

Mixins are applied through a two-phase process:

1. **Registration**: Each mixin file creates an object and registers it under `window.ExamSystemAppMixins`
2. **Application**: The `applyMixins()` function in [js/app.js L64-L81](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L64-L81)  copies mixin methods onto `ExamSystemApp.prototype` using `Object.assign`

**Mixin Application Sequence:**

```

```

The `applyMixins()` implementation uses a single `Object.assign` call with all mixin objects as arguments. Each mixin provides an empty object `{}` as fallback if not loaded, ensuring the application doesn't crash from missing dependencies.

```

```

The `__applyToApp` reference allows re-triggering mixin application after dynamic loading:

```

```

### Load Order

Mixins are loaded in `index.html` in this sequence:

1. `js/app/stateMixin.js`
2. `js/app/bootstrapMixin.js`
3. `js/app/lifecycleMixin.js`
4. `js/app/navigationMixin.js`
5. `js/app/examSessionMixin.js`
6. `js/app/suitePracticeMixin.js`
7. `js/app/fallbackMixin.js`
8. `js/app.js` (applies all mixins)

**Sources:** [js/app.js L64-L81](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L64-L81)

 [index.html L397-L404](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/index.html#L397-L404)

---

## Individual Mixins

### State Mixin (stateMixin)

**Purpose**: Provides methods for reading and writing application state.

**Key Methods**:

* `getState(path)`: Retrieves value from state using dot notation (e.g., `'exam.index'`)
* `setState(path, value)`: Updates state value and triggers subscribers
* `subscribeToState(path, callback)`: Registers state change listeners
* `persistState(key, storageKey)`: Saves state to localStorage
* `loadPersistedState()`: Restores state from storage

**State Access Pattern**:

```

```

**Sources:** [js/app.js L67](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L67-L67)

---

### Bootstrap Mixin (bootstrapMixin)

**Purpose**: Handles dependency checking, component initialization, and system bootstrap.

**Key Methods**:

* `checkDependencies()`: Verifies required global objects and libraries
* `initializeComponents()`: Creates and configures component instances
* `initializeGlobalCompatibility()`: Sets up legacy global variable synchronization
* `showFallbackUI(canRecover)`: Displays degraded mode UI when initialization fails

**Component Initialization Example**:

```

```

**Sources:** [js/app.js L68](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L68-L68)

 [js/main.js L255-L323](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L255-L323)

---

### Lifecycle Mixin (lifecycleMixin)

**Purpose**: Manages application lifecycle from initialization to destruction.

**Key Methods**:

| Method | Purpose |
| --- | --- |
| `initialize()` | Main initialization sequence |
| `loadInitialData()` | Loads exam index and practice records |
| `setupEventListeners()` | Binds global event handlers |
| `initializeResponsiveFeatures()` | Sets up responsive managers |
| `handleResize()` | Adjusts layout for screen size changes |
| `destroy()` | Cleanup and state persistence |

**Initialization Sequence**:

```

```

The `initialize()` method coordinates all bootstrap steps with progress messages:

```

```

**Error Handling**: The mixin provides `setupGlobalErrorHandling()` which captures unhandled promise rejections and JavaScript errors, maintaining an error log limited to 100 entries.

**Sources:** [js/app/lifecycleMixin.js L1-L607](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/lifecycleMixin.js#L1-L607)

---

### Navigation Mixin (navigationMixin)

**Purpose**: Manages view transitions and navigation state.

**Key Methods**:

* `navigateToView(viewName)`: Switches active view
* `showView(viewName)`: Updates DOM to show target view
* `hideAllViews()`: Hides all view containers
* `updateNavigationState(viewName)`: Updates nav button active states
* `onViewActivated(viewName)`: Hook for view-specific initialization

**View Lifecycle**:

```

```

**Sources:** [js/app.js L70](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L70-L70)

 [js/main.js L1149-L1211](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L1149-L1211)

---

### Exam Session Mixin (examSessionMixin)

**Purpose**: Handles opening practice windows, script injection, cross-window communication, and exam placeholder pages for test environments.

**Key Methods**:

| Method | Purpose |
| --- | --- |
| `openExam(examId, options)` | Opens exam in new window/tab, handles PDF-only exams |
| `buildExamUrl(exam)` | Constructs exam file path using `buildResourcePath` |
| `openExamWindow(examUrl, exam, options)` | Creates window with calculated features |
| `calculateWindowFeatures()` | Determines window size (80% screen) and position (centered) |
| `_ensureAbsoluteUrl(rawUrl)` | Converts relative paths to absolute URLs |
| `_guardExamWindowContent(examWindow, exam, options)` | Detects errors/blank pages and redirects to placeholder |
| `_buildExamPlaceholderUrl(exam, options)` | Constructs URL for `templates/exam-placeholder.html` |
| `_shouldUsePlaceholderPage()` | Checks `EnvironmentDetector.isInTestEnvironment()` |
| `injectDataCollectionScript(examWindow, examId)` | Injects `practice-page-enhancer.js` via fetch + createElement |
| `injectInlineScript(examWindow, examId)` | Fallback inline injection with suite guards |
| `initializePracticeSession(examWindow, examId)` | Sends INIT_SESSION message via postMessage |
| `setupExamWindowManagement(examWindow, examId)` | Registers window in `examWindows` Map |

**Exam Opening Flow with Placeholder Guard**:

```

```

**Window Guard System**: The `_guardExamWindowContent()` method [js/app/examSessionMixin.js L275-L383](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L275-L383)

 monitors the exam window's `location.href` and detects failure conditions:

* `about:blank` (with retry mechanism up to 4 times)
* Browser error pages: `chrome-error://`, `edge-error://`, `opera-error://`, `res://ieframe.dll`

When an error is detected **and** `EnvironmentDetector.isInTestEnvironment()` returns `true`, the window is redirected to `templates/exam-placeholder.html` with query parameters:

```

```

**Environment Detection Integration**: The placeholder system uses `EnvironmentDetector` [js/utils/environmentDetector.js L1-L82](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/environmentDetector.js#L1-L82)

 to determine test mode:

```

```

`EnvironmentDetector` activates test mode when:

* `window.__IELTS_FORCE_TEST_ENV__` is `true`
* URL contains `test_env=1`, `suite_test=1`, or `ci=1`
* `localStorage` contains test flag
* User agent matches `playwright`, `puppeteer`, or `headlesschrome`

**Script Injection Strategy**: The `injectDataCollectionScript()` method [js/app/examSessionMixin.js L460-L533](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L460-L533)

 uses a two-phase approach:

1. **Primary path**: Fetch `practice-page-enhancer.js` and inject as external script
2. **Fallback path**: Call `injectInlineScript()` [js/app/examSessionMixin.js L538-L752](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L538-L752)  which embeds a complete inline data collector with: * Answer tracking via `state.answers` object * Suite mode guards for `window.close()` and `window.open()` * postMessage communication with parent window * Session handshake protocol

The inline fallback creates a minimal `window.__IELTS_INLINE_ENHANCER__` flag to prevent duplicate injection.

**Window Features Calculation**: The `calculateWindowFeatures()` method [js/app/examSessionMixin.js L431-L455](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L431-L455)

 computes window dimensions as 80% of available screen space and centers the window:

```

```

**Sources:** [js/app/examSessionMixin.js L1-L868](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L1-L868)

 [js/utils/environmentDetector.js L1-L82](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/environmentDetector.js#L1-L82)

---

### Suite Practice Mixin (suitePracticeMixin)

**Purpose**: Orchestrates multi-exam practice sessions where P1, P2, P3 exams open sequentially in a single reused tab. Handles result aggregation, sub-record cleanup, and window guard installation.

**Key Methods**:

| Method | Purpose |
| --- | --- |
| `initializeSuiteMode()` | Initializes `currentSuiteSession`, `suiteExamMap`, clears handshakes |
| `startSuitePractice()` | Selects 3 random exams (P1/P2/P3 reading), opens first in named tab |
| `handleSuitePracticeComplete(examId, data)` | Receives completion data, navigates to next or finalizes |
| `finalizeSuiteRecord(session)` | Aggregates results, calculates totals, saves suite record |
| `_fetchSuiteExamIndex()` | Retrieves exam list from state or storage |
| `_generateSuiteSessionId()` | Creates unique ID: `suite_{timestamp}_{random}` |
| `_registerSuiteSequence(session)` | Maps each examId to suiteSessionId in `suiteExamMap` |
| `_resolveSuiteSessionId(examId, windowInfo)` | Looks up suiteSessionId from map or current session |
| `_normalizeSuiteResult(exam, rawData)` | Extracts score, answers, comparison from raw data |
| `_saveSuitePracticeRecord(record)` | Writes suite record to `practice_records` |
| `_cleanupSuiteEntryRecords(record)` | Removes individual exam records for suite entries |
| `_updatePracticeRecordsState()` | Calls `syncPracticeRecords()`, refreshes views |
| `_formatSuiteDateLabel(timestamp)` | Formats as `MM月DD日` |
| `_resolveSuiteSequenceNumber(timestamp)` | Counts suite sessions on same day |
| `_ensureSuiteWindowGuard(session, window)` | Installs window guards to prevent premature closure |
| `_teardownSuiteSession(session)` | Cleans up suite state, closes window |
| `_abortSuiteSession(session, options)` | Handles errors, saves partial results |
| `_savePartialSuiteAsIndividual(session)` | Falls back to saving completed exams as individual records |

**Suite Session Object Structure**:

```

```

**Suite Practice Flow**:

```

```

**Suite Result Normalization**: The `_normalizeSuiteResult()` method [js/app/suitePracticeMixin.js L409-L461](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L409-L461)

 extracts and standardizes score data:

```

```

**Suite Record Cleanup**: The `_cleanupSuiteEntryRecords()` method [js/app/suitePracticeMixin.js L480-L571](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L480-L571)

 removes duplicate individual records that were created during the suite session. It matches records by:

1. **Session ID**: Direct match on `record.sessionId`
2. **Exam ID + Timestamp**: Matches `examId` within ±10 minutes of suite completion time

The cleanup preserves:

* The aggregated suite record itself
* Other suite records
* Individual records outside the time window

**Aggregated Suite Record Structure**: The `finalizeSuiteRecord()` method [js/app/suitePracticeMixin.js L238-L359](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L238-L359)

 creates a comprehensive suite record:

```

```

**Window Reuse Strategy**: The `handleSuitePracticeComplete()` method [js/app/suitePracticeMixin.js L126-L236](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L126-L236)

 attempts to reuse the same window for all three exams:

1. **Primary**: Pass `options.reuseWindow = session.windowRef` to `openExam()`
2. **Fallback**: If reuse fails, attempt to reacquire by window name via `_reacquireSuiteWindow()`
3. **Abort**: If window unavailable, call `_abortSuiteSession()` with reason `'open_next_failed'`

This avoids popup blocker issues by reusing the user-initiated window.

**Suite Sequence Numbering**: The `_resolveSuiteSequenceNumber()` method [js/app/suitePracticeMixin.js L603-L701](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L603-L701)

 counts suite sessions completed on the same day:

1. Fetch all practice records from `practiceRecorder.getPracticeRecords()` or `storage.get('practice_records')`
2. Filter to suite records (`suiteMode === true` or `frequency === 'suite'`)
3. Count records with matching year/month/date
4. Return count + 1 for current session

This ensures suite records are labeled "12月25日套题练习1", "12月25日套题练习2", etc.

**Sources:** [js/app/suitePracticeMixin.js L1-L806](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L1-L806)

---

### Fallback Mixin (fallbackMixin)

**Purpose**: Provides degraded functionality when primary systems fail.

**Key Methods**:

* `ensureFallbackSession(examId, examWindow)`: Creates session record for tracking
* `savePracticeRecordFallback(examId, realData)`: Saves practice data without PracticeRecorder
* `handleFallbackMessage(event)`: Processes messages from practice windows
* `cleanupFallbackSession(sessionId)`: Removes session from tracking map

**Fallback Session Tracking**: Uses `Map<sessionId, sessionInfo>` stored in `this.state.system.fallbackExamSessions` to track practice sessions when the main recorder is unavailable.

**Sources:** [js/app.js L74](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L74-L74)

 [js/main.js L445-L550](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L445-L550)

---

## Component Management

### Component Registry

The `this.state.components` object (defined in [js/app.js L42-L48](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L42-L48)

) serves as a dependency injection container. Components are stored by name and initialized during bootstrap via `initializeComponents()`.

**Component Registry Structure**:

```

```

Note that `practiceRecorder` and `scoreStorage` are stored directly in `this.components` (not nested under `state.components`):

```

```

**Component Initialization Order**:

The bootstrap sequence in [js/main.js L1084-L1150](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L1084-L1150)

 and [index.html L385-L500](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/index.html#L385-L500)

 follows this dependency order:

```

```

**Component Access Patterns**:

Components are accessed through multiple paths depending on their storage location:

```

```

**Component Lifecycle**:

1. **Pre-initialization**: Storage layer and repositories loaded via `<script>` tags
2. **Synchronous initialization**: UI components (PDFHandler, BrowseStateManager) in [js/main.js L1102-L1123](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L1102-L1123)
3. **Async initialization**: Data-dependent components (PracticeRecorder, DataIntegrityManager) in [js/main.js L1146-L1150](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L1146-L1150)
4. **ExamSystemApp initialization**: Coordinated by `initialize()` in [js/app.js L86-L92](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L86-L92)

**Sources:** [js/app.js L42-L48](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L42-L48)

 [js/main.js L1084-L1150](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L1084-L1150)

 [index.html L385-L500](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/index.html#L385-L500)

---

## Mixin Method Contracts

### State Mixin Contract

All state-related methods must:

* Use dot notation for paths (e.g., `'practice.records'`)
* Return undefined for non-existent paths
* Trigger subscribers on setState calls
* Handle nested objects and primitive values

### Lifecycle Mixin Contract

Lifecycle methods must:

* Show loading indicators during async operations
* Call `showUserMessage()` for user-facing feedback
* Handle errors gracefully without crashing
* Update `isInitialized` flag appropriately

### Session Mixin Contract

Session management methods must:

* Track window references in `examWindows` Map
* Send INIT_SESSION messages via postMessage
* Handle window.closed checks before operations
* Clean up sessions on window close

**Sources:** [js/app/examSessionMixin.js L1-L868](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L1-L868)

 [js/app/lifecycleMixin.js L1-L607](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/lifecycleMixin.js#L1-L607)

---

## Testing and Validation

### E2E Test Coverage

The testing infrastructure validates mixin functionality through two primary test suites defined in [AGENTS.md L17-L24](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/AGENTS.md#L17-L24)

:

1. **Static Test Suite**: `developer/tests/ci/run_static_suite.py`
2. **Suite Practice Flow Test**: `developer/tests/e2e/suite_practice_flow.py`

**Test Execution Flow**:

```

```

**Environment Detection for Testing**: Tests activate the placeholder page system by setting test mode via [js/utils/environmentDetector.js L1-L82](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/environmentDetector.js#L1-L82)

:

```

```

Test mode can also be activated via URL parameters:

* `?test_env=1`
* `?suite_test=1`
* `?ci=1`

**Test Validation Points**:

| Mixin | Test Validation |
| --- | --- |
| **navigationMixin** | Clicks all nav buttons, verifies `view.active` class and `currentView` state |
| **examSessionMixin** | Opens exam windows, verifies `openExamWindow()` returns valid reference |
| **examSessionMixin** | Tests placeholder page redirect when `EnvironmentDetector.isInTestEnvironment()` is true |
| **suitePracticeMixin** | Starts suite practice, verifies window reuse, captures result aggregation |
| **lifecycleMixin** | Verifies `isInitialized` flag after `initialize()` completes |

**CI Integration**: Per [AGENTS.md L17-L24](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/AGENTS.md#L17-L24)

 both test scripts must pass before any optimization or feature change is merged:

```

```

**Sources:** [AGENTS.md L17-L24](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/AGENTS.md#L17-L24)

 [js/utils/environmentDetector.js L1-L82](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/environmentDetector.js#L1-L82)

---

## Mixin Coordination Example

### Complete Exam Opening Flow

This diagram shows how multiple mixins coordinate to open an exam, bridging from user interaction through DOM events to code-level method calls:

```

```

**Mixin Coordination Principles**:

1. **navigationMixin**: Handles view transitions, delegates exam opening to sessionMixin
2. **stateMixin**: Provides read/write access to `exam.index` via `getState()`/`setState()`
3. **examSessionMixin**: Orchestrates window creation, script injection, session handshake
4. **lifecycleMixin**: Provides `showUserMessage()` for user feedback

**Critical Method Call Chain**:

```
openExam(examId, options)
  └─> buildExamUrl(exam)
  └─> openExamWindow(examUrl, exam, options)
      └─> calculateWindowFeatures()
      └─> window.open(url, name, features)
  └─> _guardExamWindowContent(examWindow, exam, options)
      └─> _shouldUsePlaceholderPage()
          └─> EnvironmentDetector.isInTestEnvironment()
      └─> _buildExamPlaceholderUrl(exam, options)
  └─> startPracticeSession(examId)
  └─> injectDataCollectionScript(examWindow, examId)
      └─> fetch('./js/practice-page-enhancer.js')
      └─> initializePracticeSession(examWindow, examId)
          └─> postMessage({type: 'INIT_SESSION', ...})
  └─> setupExamWindowManagement(examWindow, examId)
```

**State Mutations During Flow**:

| Method | State Mutation |
| --- | --- |
| `openExam()` | None (reads state only) |
| `_guardExamWindowContent()` | None (reads window location) |
| `setupExamWindowManagement()` | Writes to `this.examWindows` Map |
| `initializePracticeSession()` | Sends message to child window |

**Sources:** [js/app/examSessionMixin.js L89-L176](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L89-L176)

 [js/app/examSessionMixin.js L275-L426](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L275-L426)

---

## Migration from Inline Code

The mixin architecture replaced monolithic inline code in the original `improved-working-system.html`. Benefits of the migration:

| Aspect | Before (Inline) | After (Mixins) |
| --- | --- | --- |
| **Organization** | 3000+ lines in one file | ~200-400 lines per mixin file |
| **Testability** | Difficult to unit test | Each mixin independently testable |
| **Debugging** | Hard to trace execution | Clear method ownership |
| **Code Reuse** | Copy-paste duplication | Shared mixin methods |
| **Maintenance** | Merge conflicts common | Changes isolated to specific mixins |

The comment in [js/main.js L1-L2](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L1-L2)

 references this history:

```

```

**Sources:** [js/main.js L1-L2](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/main.js#L1-L2)

 [js/app.js L1-L121](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L1-L121)

---

## Summary

The mixin architecture provides:

1. **Modular composition**: Each mixin handles a distinct concern
2. **Flexible extension**: New capabilities added without modifying base class
3. **Progressive enhancement**: Mixins can be loaded conditionally
4. **Clear contracts**: Well-defined interfaces between mixins
5. **Centralized state**: All mixins share unified state object
6. **Component lifecycle**: Coordinated initialization and cleanup

Key mixin files:

* [js/app/stateMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/stateMixin.js) : State management
* [js/app/bootstrapMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/bootstrapMixin.js) : Component initialization
* [js/app/lifecycleMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/lifecycleMixin.js) : Application lifecycle
* [js/app/navigationMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/navigationMixin.js) : View transitions
* [js/app/examSessionMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js) : Practice window management
* [js/app/suitePracticeMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js) : Multi-exam sessions
* [js/app/fallbackMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/fallbackMixin.js) : Degraded mode support

**Sources:** [js/app.js L1-L121](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app.js#L1-L121)

 [js/app/lifecycleMixin.js L1-L607](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/lifecycleMixin.js#L1-L607)

 [js/app/examSessionMixin.js L1-L868](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L1-L868)

 [index.html L397-L404](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/index.html#L397-L404)