# Event Management System

> **Relevant source files**
> * [index.html](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/index.html)
> * [js/components/BrowseStateManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/BrowseStateManager.js)
> * [js/components/EventManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js)
> * [js/components/ExamBrowserRecovery.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/ExamBrowserRecovery.js)

The Event Management System provides centralized event handling for the IELTS practice application, preventing memory leaks and ensuring consistent event coordination across all components. This system manages DOM event listeners, custom event dispatching, and inter-component communication through a unified interface.

For error handling and recovery mechanisms, see [Error Recovery & Resilience](/sallowayma-git/IELTS-practice/5.2-error-recovery-and-resilience). For navigation state persistence, see [Browse State Management](/sallowayma-git/IELTS-practice/5.3-browse-state-management).

## Purpose and Architecture

The `EventManager` class serves as the central coordinator for all event-driven interactions in the application. It maintains a registry of event listeners, prevents duplicate bindings, and provides utility functions for performance optimization.

### Core Event Management Architecture

```mermaid
flowchart TD

EM["EventManager<br>Central Coordinator"]
Registry["listeners: Map<br>Event Registry"]
Timers["debounceTimers: Map<br>Performance Timers"]
Global["Global Events<br>window.resize<br>document.visibilitychange<br>window.error"]
Search["Search Events<br>exam-search-input<br>.search-input"]
Filter["Filter Events<br>frequency-filter<br>status-filter<br>difficulty-filter"]
View["View Events<br>.view-controls<br>.exam-card<br>document.click"]
Nav["Navigation Events<br>.nav-btn<br>.back-btn<br>keydown"]
ExamBrowser["ExamBrowser<br>Search & Filter Handler"]
BrowseState["BrowseStateManager<br>Navigation Handler"]
CustomEvents["CustomEvent Dispatch<br>windowResized<br>filterChanged<br>viewChanged"]

Global --> EM
Search --> EM
Filter --> EM
View --> EM
Nav --> EM
EM --> ExamBrowser
EM --> BrowseState
EM --> CustomEvents

subgraph subGraph2 ["Component Integration"]
    ExamBrowser
    BrowseState
    CustomEvents
end

subgraph subGraph1 ["Event Categories"]
    Global
    Search
    Filter
    View
    Nav
end

subgraph subGraph0 ["EventManager Core"]
    EM
    Registry
    Timers
    EM --> Registry
    EM --> Timers
end
```

Sources: [js/components/EventManager.js L1-L40](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L1-L40)

## Event Registration and Lifecycle Management

The system maintains strict control over event listener registration and cleanup to prevent memory leaks and duplicate handlers.

### Event Registration Process

| Method | Purpose | Parameters |
| --- | --- | --- |
| `addEventListener()` | Register new event listener | `element, event, handler, options` |
| `removeEventListener()` | Remove specific event listener | `element, event` |
| `cleanup()` | Remove all registered listeners | None |
| `generateListenerKey()` | Create unique identifier for listeners | `element, event` |

```mermaid
flowchart TD

Check["Check Existing<br>listeners.has(key)"]
Register["element.addEventListener<br>listeners.set(key, data)"]
Skip["Skip Duplicate<br>console.warn"]
Iterate["listeners.forEach<br>Remove Each Listener"]
Clear["listeners.clear<br>debounceTimers.clear"]

Register --> Iterate

subgraph subGraph1 ["Cleanup Flow"]
    Iterate
    Clear
    Iterate --> Clear
end

subgraph subGraph0 ["Registration Flow"]
    Check
    Register
    Skip
    Check --> Register
    Check --> Skip
end
```

Sources: [js/components/EventManager.js L61-L112](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L61-L112)

## Event Handler Categories

The EventManager organizes event handling into distinct categories, each targeting specific application functionality.

### Global System Events

The system monitors critical browser and application events:

```mermaid
flowchart TD

WindowResize["handleWindowResize()<br>Responsive adjustments<br>mobile class toggle"]
PageVisible["handlePageVisible()<br>Data refresh<br>window.app.refreshData()"]
GlobalError["handleGlobalError()<br>window.handleError()"]
PromiseError["handleUnhandledRejection()<br>Promise error handling"]
Window["window.resize<br>window.error<br>window.unhandledrejection"]
Document["document.visibilitychange"]

Window --> WindowResize
Window --> GlobalError
Window --> PromiseError
Document --> PageVisible

subgraph subGraph1 ["Event Sources"]
    Window
    Document
end

subgraph subGraph0 ["Global Event Handlers"]
    WindowResize
    PageVisible
    GlobalError
    PromiseError
end
```

Sources: [js/components/EventManager.js L117-L139](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L117-L139)

 [js/components/EventManager.js L275-L317](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L275-L317)

### Search and Filter Integration

The EventManager handles all search and filtering interactions with debounced input processing:

```mermaid
flowchart TD

SearchInput["#exam-search-input<br>.search-input<br>debounced 300ms"]
SearchHandler["handleSearch(query)<br>examBrowser.searchQuery<br>examBrowser.refreshExamList()"]
FilterElements["frequency-filter<br>status-filter<br>difficulty-filter<br>sort-filter"]
FilterHandler["handleFilterChange(id, value)<br>examBrowser.filters.*<br>examBrowser.refreshExamList()"]
ExamBrowserUpdate["ExamBrowser State Update"]

SearchHandler --> ExamBrowserUpdate
FilterHandler --> ExamBrowserUpdate

subgraph subGraph1 ["Filter System"]
    FilterElements
    FilterHandler
    FilterElements --> FilterHandler
end

subgraph subGraph0 ["Search System"]
    SearchInput
    SearchHandler
    SearchInput --> SearchHandler
end
```

Sources: [js/components/EventManager.js L144-L186](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L144-L186)

 [js/components/EventManager.js L319-L361](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L319-L361)

## Component Communication Protocol

The EventManager facilitates communication between application components through both direct method calls and custom event dispatching.

### Inter-Component Message Flow

```mermaid
flowchart TD

EM["EventManager<br>Central Dispatcher"]
CustomDispatch["dispatchCustomEvent()<br>CustomEvent creation<br>document.dispatchEvent()"]
ExamBrowserComp["window.app.components.examBrowser<br>searchQuery, filters<br>refreshExamList(), setViewMode()"]
BrowseStateComp["window.app.components.browseStateManager<br>handleBrowseNavigation()"]
GlobalFunctions["window.showView()<br>window.loadLibrary()<br>window.searchExams()"]
EventTypes["windowResized<br>filterChanged<br>viewChanged<br>examCardClicked<br>examAction<br>browseNavigation"]

EM --> ExamBrowserComp
EM --> BrowseStateComp
EM --> GlobalFunctions
CustomDispatch --> EventTypes

subgraph subGraph2 ["Custom Events"]
    EventTypes
end

subgraph subGraph1 ["Target Components"]
    ExamBrowserComp
    BrowseStateComp
    GlobalFunctions
end

subgraph subGraph0 ["EventManager Hub"]
    EM
    CustomDispatch
    EM --> CustomDispatch
end
```

Sources: [js/components/EventManager.js L322-L431](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L322-L431)

 [js/components/EventManager.js L480-L490](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L480-L490)

## Performance Optimization Utilities

The EventManager includes built-in performance optimization through debouncing and throttling mechanisms.

### Debounce and Throttle Implementation

| Function | Use Case | Default Delay | Implementation |
| --- | --- | --- | --- |
| `debounce()` | Search input, filter changes | 300ms | Cancels previous timeout, creates new |
| `throttle()` | Window resize, scroll events | 250ms | Rate limits execution frequency |

```mermaid
flowchart TD

ThrottleInput["Continuous Events<br>window.resize"]
ThrottleLogic["throttle(func, wait)<br>now - lastTime >= wait"]
ThrottleOutput["Rate-limited Execution<br>Maximum frequency"]
DebounceInput["User Input<br>Rapid keystrokes"]
DebounceLogic["debounce(func, wait)<br>clearTimeout(previous)<br>setTimeout(func, wait)"]
DebounceOutput["Single Execution<br>After delay period"]

subgraph subGraph1 ["Throttle System"]
    ThrottleInput
    ThrottleLogic
    ThrottleOutput
    ThrottleInput --> ThrottleLogic
    ThrottleLogic --> ThrottleOutput
end

subgraph subGraph0 ["Debounce System"]
    DebounceInput
    DebounceLogic
    DebounceOutput
    DebounceInput --> DebounceLogic
    DebounceLogic --> DebounceOutput
end
```

Sources: [js/components/EventManager.js L494-L526](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L494-L526)

## Keyboard Shortcuts and Navigation

The system provides comprehensive keyboard shortcut support for efficient navigation and control.

### Keyboard Shortcut Mapping

```mermaid
flowchart TD

CtrlKeys["Ctrl/Cmd + 1-4<br>View navigation<br>window.showView()"]
BrowseKeys["g: Grid view<br>l: List view<br>Escape: Close preview"]
BrowseActions["handleViewChange()<br>examBrowser.closeExamPreview()"]
InputCheck["e.target.matches<br>input, textarea, contenteditable"]
ViewCheck["#browse-view.active<br>Context-sensitive shortcuts"]

CtrlKeys --> InputCheck
BrowseKeys --> ViewCheck
InputCheck --> BrowseActions
ViewCheck --> BrowseActions

subgraph subGraph2 ["Context Detection"]
    InputCheck
    ViewCheck
end

subgraph subGraph1 ["Browse View Shortcuts"]
    BrowseKeys
    BrowseActions
end

subgraph subGraph0 ["Global Shortcuts"]
    CtrlKeys
end
```

Sources: [js/components/EventManager.js L433-L475](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L433-L475)

## System Integration Points

The EventManager integrates deeply with other system components, serving as the primary event coordination layer.

### Integration with Core Systems

```mermaid
flowchart TD

EM["EventManager<br>Event Coordinator"]
MainApp["window.app<br>Main Application Instance"]
ExamBrowser["window.app.components.examBrowser<br>Search, Filter, Browse Logic"]
BrowseState["window.app.components.browseStateManager<br>State Persistence"]
DataIntegrity["DataIntegrityManager<br>Data validation and backup"]
ViewSystem["window.showView()<br>View switching"]
LibrarySystem["window.loadLibrary()<br>Data loading"]
ErrorSystem["window.handleError()<br>Error processing"]
MessageSystem["window.showMessage()<br>User notifications"]

EM --> MainApp
EM --> ExamBrowser
EM --> BrowseState
EM --> ViewSystem
EM --> LibrarySystem
EM --> ErrorSystem
EM --> MessageSystem

subgraph subGraph2 ["Global Functions"]
    ViewSystem
    LibrarySystem
    ErrorSystem
    MessageSystem
end

subgraph subGraph1 ["Core Application Components"]
    MainApp
    ExamBrowser
    BrowseState
    DataIntegrity
end

subgraph subGraph0 ["EventManager Dependencies"]
    EM
end
```

Sources: [js/components/EventManager.js L294-L431](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L294-L431)

The EventManager serves as the central nervous system of the IELTS practice application, coordinating all user interactions and system communications while maintaining performance and preventing memory leaks through careful lifecycle management.

Sources: [js/components/EventManager.js L1-L540](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L1-L540)