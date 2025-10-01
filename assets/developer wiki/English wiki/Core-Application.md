# Core Application

> **Relevant source files**
> * [improved-working-system.html](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html)

The Core Application (`improved-working-system.html`) serves as the central coordinator and entry point for the entire IELTS Reading Practice System. This single-file web application orchestrates exam browsing, practice session management, data persistence, and system integration. It acts as the primary interface users interact with and coordinates communication between all system components.

For information about the individual system components that the Core Application coordinates, see [Infrastructure Components](/sallowayma-git/IELTS-practice/5-infrastructure-components). For details about the practice session system it manages, see [Practice Session System](/sallowayma-git/IELTS-practice/6-practice-session-system). For the exam data it loads and displays, see [Exam Data System](/sallowayma-git/IELTS-practice/3-exam-data-system).

## Application Architecture Overview

The Core Application follows a single-file architecture pattern, embedding all presentation, business logic, and coordination functionality within a single HTML document. This design provides simplified deployment while maintaining clear separation of concerns through modular JavaScript organization.

```mermaid
flowchart TD

HTML["improved-working-system.html<br>Main Application File"]
CSS["Embedded CSS<br>UI Framework"]
JS["Embedded JavaScript<br>Application Logic"]
OverviewView["overview-view<br>Category Overview"]
BrowseView["browse-view<br>Exam Browser"]
PracticeView["practice-view<br>History Display"]
SettingsView["settings-view<br>System Settings"]
showView["showView()<br>Navigation Controller"]
loadLibrary["loadLibrary()<br>Data Loader"]
updatePracticeView["updatePracticeView()<br>Statistics Calculator"]
handlePracticeDataReceived["handlePracticeDataReceived()<br>Data Processor"]
examIndex["examIndex[]<br>Exam Database"]
practiceRecords["practiceRecords[]<br>User History"]
currentCategory["currentCategory<br>Filter State"]

JS --> showView
JS --> loadLibrary
JS --> updatePracticeView
JS --> handlePracticeDataReceived
showView --> OverviewView
showView --> BrowseView
showView --> PracticeView
showView --> SettingsView
loadLibrary --> examIndex
handlePracticeDataReceived --> practiceRecords
updatePracticeView --> currentCategory

subgraph subGraph3 ["Global State"]
    examIndex
    practiceRecords
    currentCategory
end

subgraph subGraph2 ["Core Functions"]
    showView
    loadLibrary
    updatePracticeView
    handlePracticeDataReceived
end

subgraph subGraph1 ["View Management"]
    OverviewView
    BrowseView
    PracticeView
    SettingsView
end

subgraph subGraph0 ["Core Application Structure"]
    HTML
    CSS
    JS
    HTML --> CSS
    HTML --> JS
end
```

**Sources:** [improved-working-system.html L1-L3244](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1-L3244)

## Global App Entry and Modular Structure

The core application has been refactored to use a global App entry point defined in `js/app.js`. This centralizes initialization and provides a unified interface for the entire system.

### App Global Entry
- **Entry Point**: `window.App` (from `js/app.js`) serves as the singleton instance coordinating all subsystems.
- **Initialization**: Called via `App.init()` during application startup, which loads stores, UI components, and sets up event routing.
- **Key Responsibilities**:
  - Orchestrates data loading from `ExamStore` and `RecordStore`.
  - Manages UI rendering through `BaseComponent` hierarchy in `js/ui/`.
  - Routes events via `App.events` using an EventEmitter pattern for decoupled communication.

### Stores/UI Separation
The architecture now enforces clear separation of concerns:
- **Stores (js/stores/)**: Handle data management and state (e.g., `ExamStore` for exam data, `RecordStore` for practice history, `AppStore` for application-wide state). Stores provide reactive updates via subscriptions.
- **UI (js/ui/)**: Focuses on rendering and user interaction (e.g., `ExamBrowser`, `RecordViewer`). UI components are stateless and receive data from stores.
- **Utils (js/utils/)**: Shared helper functions (e.g., `helpers.js` for utilities like data validation and DOM manipulation).

This separation ensures data flows unidirectionally: Stores → UI, with events triggering updates via `App.events`.

### Event Routing
- **Event System**: `App.events` is an instance of EventEmitter, allowing components to emit and subscribe to events without direct coupling.
- **Routing Mechanism**: Events like `examLoaded`, `recordUpdated`, or `uiStateChanged` are emitted from stores/UI and routed globally.
- **Example Usage**:
  ```javascript
  // Emitting an event
  App.events.emit('examLoaded', { examId: '123' });

  // Subscribing to an event
  App.events.on('examLoaded', (data) => {
    // Update UI accordingly
  });
  ```
- **Benefits**: Decouples stores from UI, enables linear event flows, and supports file:// compatibility by avoiding dynamic dependencies.

**Sources:** [js/app.js](https://github.com/sallowayma-git/IELTS-practice/blob/main/js/app.js), [js/stores/AppStore.js](https://github.com/sallowayma-git/IELTS-practice/blob/main/js/stores/AppStore.js)

## Component Integration System

The Core Application dynamically loads and initializes multiple specialized components through a layered initialization process. Component availability is detected at runtime, with graceful degradation when components are unavailable.

```mermaid
flowchart TD

ExamData["complete-exam-data.js<br>window.completeExamIndex"]
Helpers["helpers.js<br>Utility Functions"]
PracticeRec["practiceRecorder.js<br>PracticeRecorder"]
PDFHandler["PDFHandler.js<br>window.PDFHandler"]
ExamBrowser["examBrowser.js<br>ExamBrowser"]
DataIntegrity["DataIntegrityManager<br>window.dataIntegrityManager"]
BrowseState["BrowseStateManager<br>window.browseStateManager"]
PerfOptimizer["PerformanceOptimizer<br>window.performanceOptimizer"]
CommRecovery["CommunicationRecovery<br>window.communicationManager"]
AppInstance["window.app<br>ExamSystemApp instance"]
MainInit["initializeApp()<br>Initialization Controller"]

ExamData --> MainInit
Helpers --> MainInit
PracticeRec --> MainInit
PDFHandler --> MainInit
ExamBrowser --> MainInit
MainInit --> DataIntegrity
MainInit --> BrowseState
MainInit --> PerfOptimizer
MainInit --> CommRecovery
DataIntegrity --> AppInstance
BrowseState --> AppInstance
PerfOptimizer --> AppInstance
CommRecovery --> AppInstance

subgraph subGraph2 ["Application Instance"]
    AppInstance
    MainInit
    MainInit --> AppInstance
end

subgraph subGraph1 ["Infrastructure Components"]
    DataIntegrity
    BrowseState
    PerfOptimizer
    CommRecovery
end

subgraph subGraph0 ["Component Loading Sequence"]
    ExamData
    Helpers
    PracticeRec
    PDFHandler
    ExamBrowser
end
```

The initialization process in `initializeApp()` attempts to create instances of each component class, with error handling for missing components:

| Component | Global Variable | Fallback Behavior |
| --- | --- | --- |
| `ExamSystemApp` | `window.app` | Simple mode with basic functionality |
| `DataIntegrityManager` | `window.dataIntegrityManager` | Manual data operations only |
| `PerformanceOptimizer` | `window.performanceOptimizer` | No caching or optimization |
| `CommunicationRecovery` | `window.communicationManager` | Basic message handling |
| `BrowseStateManager` | `window.browseStateManager` | No state persistence |

**Sources:** [improved-working-system.html L686-L709](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L686-L709)
 [improved-working-system.html L870-L923](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L870-L923)

## View Management System

The application implements a single-page application (SPA) pattern with four main views controlled by the `showView()` function. View state is managed through CSS class toggling and coordinated data updates.

```mermaid
flowchart TD

NavButtons["nav-btn elements<br>Main Navigation"]
showView["showView(viewName)<br>View Controller"]
OverviewActive["overview-view.active<br>Category Cards"]
BrowseActive["browse-view.active<br>Exam List"]
PracticeActive["practice-view.active<br>Statistics & History"]
SettingsActive["settings-view.active<br>System Controls"]
updateOverview["updateOverview()<br>Category Statistics"]
loadExamList["loadExamList()<br>Exam Display"]
updatePracticeView["updatePracticeView()<br>History & Stats"]

showView --> OverviewActive
showView --> BrowseActive
showView --> PracticeActive
showView --> SettingsActive
OverviewActive --> updateOverview
BrowseActive --> loadExamList
PracticeActive --> updatePracticeView

subgraph subGraph2 ["Data Updates"]
    updateOverview
    loadExamList
    updatePracticeView
end

subgraph Views ["Views"]
    OverviewActive
    BrowseActive
    PracticeActive
    SettingsActive
end

subgraph subGraph0 ["Navigation Control"]
    NavButtons
    showView
    NavButtons --> showView
end
```

Each view has specific initialization requirements:

* **Overview View**: Calculates category statistics from `examIndex` and displays practice recommendations
* **Browse View**: Loads filtered exam lists with search capability and pagination
* **Practice View**: Computes statistics from `practiceRecords` and displays history
* **Settings View**: Provides system management controls and diagnostic information

**Sources:** [improved-working-system.html L1117-L1156](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1117-L1156)
 [improved-working-system.html L2756-L2819](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2756-L2819)

## Data Coordination Layer

The Core Application manages three primary data stores and coordinates synchronization between localStorage and in-memory representations. All data operations include error handling and fallback mechanisms.

```mermaid
flowchart TD

completeExamIndex["window.completeExamIndex<br>Static Exam Data"]
localStorage_exam["localStorage.exam_index<br>Cached Exam Data"]
localStorage_practice["localStorage.practice_records<br>User Progress"]
examIndex["examIndex[]<br>Active Exam Database"]
practiceRecords["practiceRecords[]<br>Session History"]
practiceStats["practiceStats{}<br>Computed Statistics"]
loadLibrary["loadLibrary()<br>Data Loader"]
calculatePracticeStats["calculatePracticeStats()<br>Stats Computer"]
cleanupPracticeData["cleanupPracticeData()<br>Data Maintenance"]
window_storage["window.storage<br>Storage Abstraction"]

completeExamIndex --> loadLibrary
loadLibrary --> examIndex
loadLibrary --> localStorage_exam
localStorage_practice --> practiceRecords
practiceRecords --> calculatePracticeStats
calculatePracticeStats --> practiceStats
cleanupPracticeData --> localStorage_practice
window_storage --> localStorage_exam
window_storage --> localStorage_practice

subgraph subGraph2 ["Data Operations"]
    loadLibrary
    calculatePracticeStats
    cleanupPracticeData
    window_storage
end

subgraph subGraph1 ["In-Memory State"]
    examIndex
    practiceRecords
    practiceStats
end

subgraph subGraph0 ["Data Sources"]
    completeExamIndex
    localStorage_exam
    localStorage_practice
end
```

The `window.storage` object provides error-resilient localStorage operations with automatic cleanup:

| Operation | Function | Error Handling |
| --- | --- | --- |
| Data Read | `storage.get(key, defaultValue)` | Returns default on parse errors |
| Data Write | `storage.set(key, value)` | Quota cleanup and retry |
| Data Cleanup | `storage.cleanup()` | Removes records older than 30 days |

**Sources:** [improved-working-system.html L961-L1017](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L961-L1017)
 [improved-working-system.html L1158-L1316](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1158-L1316)
 [improved-working-system.html L2306-L2389](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2306-L2389)

## Cross-Window Communication Protocol

The Core Application implements a sophisticated message-passing system for communicating with practice session windows. This system handles practice data collection, session monitoring, and error recovery.

```mermaid
flowchart TD

MessageListener["window.addEventListener('message')<br>Message Handler"]
openExam["openExam(examId)<br>Session Launcher"]
handlePracticeDataReceived["handlePracticeDataReceived()<br>Data Processor"]
PracticeSession["Practice Session<br>Individual Window"]
PostMessage["window.postMessage<br>Data Sender"]
SessionReady["SESSION_READY<br>Connection Established"]
ProgressUpdate["PROGRESS_UPDATE<br>Real-time Progress"]
PracticeComplete["PRACTICE_COMPLETE<br>Final Results"]
ErrorOccurred["ERROR_OCCURRED<br>Error Reports"]

openExam --> PracticeSession
PostMessage --> MessageListener
MessageListener --> SessionReady
MessageListener --> ProgressUpdate
MessageListener --> PracticeComplete
MessageListener --> ErrorOccurred
PracticeComplete --> handlePracticeDataReceived

subgraph subGraph2 ["Message Types"]
    SessionReady
    ProgressUpdate
    PracticeComplete
    ErrorOccurred
end

subgraph subGraph1 ["Practice Window"]
    PracticeSession
    PostMessage
    PracticeSession --> PostMessage
end

subgraph subGraph0 ["Main Application"]
    MessageListener
    openExam
    handlePracticeDataReceived
end
```

The message handling system processes different event types and updates application state accordingly:

```python
// Message structure from practice pages
{
    source: 'practice_page',
    type: 'PRACTICE_COMPLETE',
    data: {
        sessionId: 'unique_session_id',
        examId: 'exam_identifier',
        answers: {},
        scoreInfo: {},
        duration: 1234567,
        // ... additional data
    }
}
```

**Sources:** [improved-working-system.html L2837-L2868](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2837-L2868)
 [improved-working-system.html L2928-L3169](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2928-L3169)

## Error Handling and Recovery Framework

The Core Application implements a comprehensive error handling system with automatic recovery strategies, user-friendly messaging, and detailed logging for debugging purposes.

```mermaid
flowchart TD

GlobalErrors["window.addEventListener('error')<br>JavaScript Errors"]
PromiseErrors["window.addEventListener('unhandledrejection')<br>Promise Rejections"]
ResourceErrors["Resource Load Failures<br>Scripts, Styles, Images"]
handleError["window.handleError()<br>Central Error Handler"]
getErrorUserMessage["getErrorUserMessage()<br>Message Generator"]
attemptErrorRecovery["attemptErrorRecovery()<br>Recovery Controller"]
DataReload["Data Reload<br>loadLibrary() retry"]
StorageCleanup["Storage Cleanup<br>localStorage maintenance"]
CommunicationReinit["Communication Reset<br>Message handler restart"]
ComponentFallback["Component Fallback<br>Simplified functionality"]
showMessage["showMessage()<br>Notification System"]
ErrorLogging["localStorage.system_error_log<br>Error Persistence"]

GlobalErrors --> handleError
PromiseErrors --> handleError
ResourceErrors --> handleError
handleError --> showMessage
handleError --> ErrorLogging
attemptErrorRecovery --> DataReload
attemptErrorRecovery --> StorageCleanup
attemptErrorRecovery --> CommunicationReinit
attemptErrorRecovery --> ComponentFallback

subgraph subGraph3 ["User Experience"]
    showMessage
    ErrorLogging
end

subgraph subGraph2 ["Recovery Strategies"]
    DataReload
    StorageCleanup
    CommunicationReinit
    ComponentFallback
end

subgraph subGraph1 ["Error Processing"]
    handleError
    getErrorUserMessage
    attemptErrorRecovery
    handleError --> getErrorUserMessage
    handleError --> attemptErrorRecovery
end

subgraph subGraph0 ["Error Detection"]
    GlobalErrors
    PromiseErrors
    ResourceErrors
end
```

The error handling system categorizes errors and provides context-specific recovery strategies:

| Error Context | Recovery Strategy | User Message |
| --- | --- | --- |
| 题库加载 (Library Load) | `loadLibrary()` retry | "题库数据加载失败，正在尝试重新加载" |
| 数据存储 (Data Storage) | Storage cleanup + retry | "存储空间不足，请清理浏览器数据" |
| 跨窗口通信 (Cross-window) | Communication reinit | "页面通信失败，正在重新建立连接" |
| 文件加载 (File Load) | Backup path attempts | "文件加载失败，正在尝试备用方案" |

**Sources:** [improved-working-system.html L712-L846](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L712-L846)
 [improved-working-system.html L848-L958](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L848-L958)

## file:// Constraints

Due to the limitations of the file:// protocol in web browsers, the application must adhere to specific constraints to ensure compatibility when running locally without a server.

### Script Loading Order
- Scripts must be loaded synchronously using `<script>` tags in a strict sequence to resolve dependencies.
- Order: utils/ → stores/ → ui/ → app.js → main initialization.
- Dynamic script loading (e.g., via `document.createElement('script')`) is avoided to prevent timing issues under file://.

### Global Variables
- All shared state and APIs are exposed via `window` globals (e.g., `window.App`, `window.stores`, `window.events`).
- No ES6 modules or import/export; everything is in the global scope to avoid module loader restrictions.

### No Dynamic Imports
- Static script inclusion only; dynamic imports like `import()` are not used as they may fail under file:// due to CORS-like restrictions.
- Fallback to conditional loading via error handlers if a script is missing.

### Storage and Communication Compatibility
- **localStorage**: Fully compatible; used for persistent data like exam indices and practice records. Includes quota management and error recovery.
- **postMessage**: Supported for cross-window communication between practice sessions and the main app. Messages are structured with `source`, `type`, and `data` fields.
- **Limitations**: No access to server-side APIs; all operations are client-side. File I/O is restricted, so exports use download blobs.

These constraints ensure the application runs seamlessly in local environments while maintaining full functionality.

**Sources:** [js/app.js](https://github.com/sallowayma-git/IELTS-practice/blob/main/js/app.js), Browser file:// protocol documentation