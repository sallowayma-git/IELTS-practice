# HP Core Bridge & Plugin Architecture

> **Relevant source files**
> * [.superdesign/design_iterations/HP/Welcome.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html)

This document covers the HP plugin architecture, focusing on two primary components:

* **hp-core-bridge.js**: Integration layer providing data access and action APIs
* **hp-portal.js**: View router managing navigation and section rendering

These modules enable the Harry Potter theme to function as a standalone portal while integrating with the core IELTS practice system through well-defined interfaces.

**Related Pages:**

* [HP Welcome Interface & Views (8.1)](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/HP Welcome Interface & Views (8.1))  - UI components and Marauder's Map
* [HP Path System & Extensions (8.3)](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/HP Path System & Extensions (8.3))  - Path resolution and additional HP plugins
* [Theme Management & Controller (7.1)](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/Theme Management & Controller (7.1))  - Theme switching and portal navigation

## Purpose and Architecture Overview

The HP plugin system implements a modular architecture where the Harry Potter theme operates as a semi-independent portal with its own view management, while leveraging core application functionality through the `hpCore` bridge.

### Three-Layer Architecture

```mermaid
flowchart TD

WELCOME["HP/Welcome.html<br>Entry Point"]
PORTAL["hp-portal.js<br>View Router"]
VIEWS["View Sections<br>overview, practice,<br>history, settings"]
BRIDGE["hp-core-bridge.js<br>hpCore Object"]
PATH["hp-path.js<br>Resource Resolution"]
SETTINGS["hp-settings-bridge.js<br>Settings Integration"]
APP["ExamSystemApp"]
STORAGE["window.storage<br>StorageManager"]
GLOBALS["Global Functions<br>openExam, showView"]
DATA["Data Sources<br>examIndex, practiceRecords"]

WELCOME --> BRIDGE
WELCOME --> PATH
BRIDGE --> STORAGE
BRIDGE --> GLOBALS
BRIDGE --> DATA
BRIDGE --> APP
PORTAL --> BRIDGE
VIEWS --> BRIDGE

subgraph subGraph2 ["Core Application"]
    APP
    STORAGE
    GLOBALS
    DATA
end

subgraph subGraph1 ["Integration Layer"]
    BRIDGE
    PATH
    SETTINGS
    PATH --> BRIDGE
    SETTINGS --> BRIDGE
end

subgraph subGraph0 ["HP Portal Layer"]
    WELCOME
    PORTAL
    VIEWS
    WELCOME --> PORTAL
    PORTAL --> VIEWS
end
```

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L617-L649](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L617-L649)

The architecture provides:

* **Portal Independence**: HP theme can operate with its own navigation and view management
* **Core Integration**: Access to exam data, practice records, and system actions via `hpCore`
* **Graceful Degradation**: Fallback mechanisms when core app functions are unavailable

### Core Bridge Components

The `hpCore` object exposed by `hp-core-bridge.js` provides a stable API surface:

| Component | Purpose | Key Methods |
| --- | --- | --- |
| Event Bus | Inter-plugin communication | `on(event, fn)`, `off(event, fn)`, `emit(event, payload)` |
| Lifecycle | Ready state management | `ready(callback)`, `isReady`, `_markReady()` |
| Data Access | Cached exam and record data | `getExamIndex()`, `getRecords()`, `getExamById(id)` |
| Actions | System operations | `startExam(examId)`, `viewExamPDF(examId)` |
| UI Helpers | User feedback | `showMessage(msg, type, duration)` |

**Sources:** [js/plugins/hp/hp-core-bridge.js L1-L243](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L1-L243)

## HP Portal View Router

The `hp-portal.js` module manages view navigation within the HP theme, handling section visibility, navigation state, and URL hash synchronization.

### View Management Architecture

```mermaid
flowchart TD

NAV_CLICK["Navigation Link Click<br>data-hp-view attribute"]
HASH_CHANGE["Hash Change Event<br>#overview, #practice, etc"]
DIRECT_CALL["Direct showView Call"]
ROUTER["hpPortal.showView(viewName)"]
HIDE_ALL["Hide All Sections<br>data-view-section"]
SHOW_TARGET["Show Target Section<br>getElementById"]
UPDATE_NAV["Update Navigation State<br>.hp-nav-active class"]
UPDATE_HASH["Update URL Hash"]
EMIT_EVENT["Emit view:changed Event"]

NAV_CLICK --> ROUTER
HASH_CHANGE --> ROUTER
DIRECT_CALL --> ROUTER
ROUTER --> HIDE_ALL
HIDE_ALL --> SHOW_TARGET
SHOW_TARGET --> UPDATE_NAV
UPDATE_NAV --> UPDATE_HASH
UPDATE_HASH --> EMIT_EVENT
```

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L398-L401](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L398-L401)

 [.superdesign/design_iterations/HP/Welcome.html L415-L548](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L415-L548)

### View Section Structure

The HP theme defines four primary views, each corresponding to a section in the DOM:

| View Name | Section ID | DOM Selector | Purpose |
| --- | --- | --- | --- |
| `overview` | `#overview` | `[data-view-section="overview"]` | Dashboard with stats and quick actions |
| `practice` | `#practice` | `[data-view-section="practice"]` | Exam browsing and filtering |
| `history` | `#history` | `[data-view-section="history"]` | Practice records and trend charts |
| `settings` | `#settings` | `[data-view-section="settings"]` | System configuration and backups |

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L415-L548](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L415-L548)

### Navigation Link Binding

Navigation links use the `data-hp-view` attribute for declarative view routing:

```

```

The portal script attaches click handlers to all elements with `data-hp-view` and automatically manages the `.hp-nav-active` class for visual feedback.

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L398-L401](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L398-L401)

## HP Core Bridge Event System

The core bridge implements a publish-subscribe event system that enables decoupled communication between plugins and data sources.

### Event Flow

```mermaid
sequenceDiagram
  participant window.storage
  participant hpCore
  participant hpPortal
  participant hp-history-trend.js

  window.storage->>hpCore: storage event fired
  hpCore->>hpCore: _broadcastDataUpdated()
  hpCore->>hpPortal: emit('dataUpdated')
  hpCore->>hp-history-trend.js: emit('dataUpdated')
  hpPortal->>hpCore: on('view:changed', callback)
  hp-history-trend.js->>hpCore: emit('customEvent', data)
  hpCore->>hpPortal: dispatch custom event
```

**Sources:** [js/plugins/hp/hp-core-bridge.js L40-L58](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L40-L58)

 [js/plugins/hp/hp-history-trend.js L162-L171](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-history-trend.js#L162-L171)

### Core Event Types

The bridge system defines several standard event types:

* **`dataUpdated`** - Fired when exam index or practice records change
* **`ready`** - Internal lifecycle event when bridge is initialized
* Custom events can be registered by plugins for inter-plugin communication

The event bus implementation uses error isolation to prevent one plugin from breaking others:

```

```

Sources: [js/plugins/hp/hp-core-bridge.js L53](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L53-L53)

## Data Access Layer

The `hpCore` bridge maintains cached copies of exam index and practice records, providing a unified interface that shields plugins from storage implementation details.

### Multi-Source Data Loading

```mermaid
flowchart TD

LOAD["hpCore._loadExamIndex()"]
CHECK_STORAGE["Check window.storage.get()"]
STORAGE_DATA["Get 'exam_index' from storage"]
FALLBACK["Use Global Variables"]
READING["window.completeExamIndex"]
LISTENING["window.listeningExamIndex"]
MARK_TYPES["Mark exam types<br>reading/listening"]
MERGE["Merge Arrays"]
CACHE["Set this._examIndex"]
BROADCAST["Emit dataUpdated Event"]

LOAD --> CHECK_STORAGE
CHECK_STORAGE --> STORAGE_DATA
CHECK_STORAGE --> FALLBACK
STORAGE_DATA --> CACHE
FALLBACK --> READING
FALLBACK --> LISTENING
READING --> MARK_TYPES
LISTENING --> MARK_TYPES
MARK_TYPES --> MERGE
MERGE --> CACHE
CACHE --> BROADCAST
```

**Sources:** [js/plugins/hp/hp-core-bridge.js L129-L158](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L129-L158)

### Type Marking System

The bridge automatically assigns a `type` field to exams during loading to distinguish between reading and listening:

```

```

This enables plugins to filter exams by type without knowing the source array structure.

**Sources:** [js/plugins/hp/hp-core-bridge.js L131-L136](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L131-L136)

### Data Loading Strategy

The bridge implements a multi-source data loading strategy with fallbacks:

1. **Primary**: Load from `window.storage.get()` if available
2. **Fallback**: Use global variables `window.completeExamIndex`, `window.listeningExamIndex`
3. **Type Marking**: Automatically assigns `type` field to categorize reading/listening exams

The `_loadExamIndex()` method demonstrates this pattern:

```

```

Sources: [js/plugins/hp/hp-core-bridge.js L131-L136](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L131-L136)

## Script Loading Sequence

The HP theme follows a specific script loading order to ensure proper initialization:

```

```

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L617-L655](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L617-L655)

### Initialization Sequence

```mermaid
sequenceDiagram
  participant HP/Welcome.html
  participant Exam Data Scripts
  participant hp-path.js
  participant hp-core-bridge.js
  participant hp-portal.js
  participant ExamSystemApp

  HP/Welcome.html->>Exam Data Scripts: Load exam index data
  Exam Data Scripts->>HP/Welcome.html: window.completeExamIndex
  HP/Welcome.html->>hp-path.js: window.listeningExamIndex
  hp-path.js->>HP/Welcome.html: Load path resolver
  HP/Welcome.html->>hp-core-bridge.js: window.hpPath initialized
  hp-core-bridge.js->>hp-core-bridge.js: Load core bridge
  hp-core-bridge.js->>hp-core-bridge.js: Create hpCore object
  hp-core-bridge.js->>hp-core-bridge.js: Install event listeners
  hp-core-bridge.js->>HP/Welcome.html: Load initial data
  HP/Welcome.html->>hp-portal.js: window.hpCore ready
  hp-portal.js->>hp-core-bridge.js: Load portal router
  hp-core-bridge.js->>hp-portal.js: hpCore.ready(callback)
  hp-portal.js->>hp-portal.js: Execute callback
  hp-portal.js->>hp-portal.js: Bind navigation events
  HP/Welcome.html->>ExamSystemApp: Show initial view
  ExamSystemApp->>ExamSystemApp: Load main app
  ExamSystemApp->>hp-core-bridge.js: Initialize ExamSystemApp
```

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L617-L655](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L617-L655)

## Plugin Integration Patterns

HP-specific plugins follow standard patterns for integrating with the bridge and portal systems.

### Plugin Lifecycle

```mermaid
flowchart TD

LOAD["Plugin Script Loads"]
CHECK["Check hpCore !== undefined"]
READY_CHECK["Check hpCore.ready available"]
REGISTER["hpCore.ready(init)"]
DOM_FALLBACK["DOMContentLoaded fallback"]
INIT["Initialize Plugin"]
DATA_LISTEN["hpCore.onDataUpdated(render)"]
VIEW_LISTEN["hpCore.on('view:changed', handler)"]
RENDER["Render Plugin UI"]

LOAD --> CHECK
CHECK --> READY_CHECK
CHECK --> DOM_FALLBACK
READY_CHECK --> REGISTER
DOM_FALLBACK --> INIT
REGISTER --> INIT
INIT --> DATA_LISTEN
INIT --> VIEW_LISTEN
DATA_LISTEN --> RENDER
VIEW_LISTEN --> RENDER
```

**Sources:** [js/plugins/hp/hp-history-trend.js L174-L180](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-history-trend.js#L174-L180)

### Standard Plugin Pattern

Plugins follow this implementation pattern:

```

```

This pattern ensures:

* Safe access to `hpCore` with fallback to globals
* Automatic re-rendering when data changes
* Proper initialization timing regardless of load order

**Sources:** [js/plugins/hp/hp-history-trend.js L18](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-history-trend.js#L18-L18)

 [js/plugins/hp/hp-history-trend.js L162-L180](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-history-trend.js#L162-L180)

## Action System and Fallbacks

The bridge provides high-level action methods that abstract implementation details and gracefully degrade when core app functions are unavailable.

### Exam Opening Strategy

The `hpCore.startExam(examId)` method implements a three-tier fallback:

```mermaid
flowchart TD

CALL["hpCore.startExam(examId)"]
TRY_GLOBAL["Try window.openExam(examId)"]
TRY_APP["Try window.app.openExam(examId)"]
FALLBACK["Manual Fallback"]
FIND_EXAM["hpCore.getExamById(examId)"]
BUILD_PATH["Build HTML path via hpPath"]
OPEN_WINDOW["window.open(path, name, features)"]
CHECK_BLOCKED["Check if popup blocked"]
SHOW_ERROR["hpCore.showMessage error"]
SUCCESS["Return window reference"]

CALL --> TRY_GLOBAL
TRY_GLOBAL --> SUCCESS
TRY_GLOBAL --> TRY_APP
TRY_APP --> SUCCESS
TRY_APP --> FALLBACK
FALLBACK --> FIND_EXAM
FIND_EXAM --> BUILD_PATH
BUILD_PATH --> OPEN_WINDOW
OPEN_WINDOW --> CHECK_BLOCKED
CHECK_BLOCKED --> SHOW_ERROR
CHECK_BLOCKED --> SUCCESS
```

**Sources:** [js/plugins/hp/hp-core-bridge.js L184-L214](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L184-L214)

### Integration with hp-path.js

The fallback path construction relies on `window.hpPath` for resource resolution:

```

```

This demonstrates the layered plugin architecture where `hp-core-bridge.js` depends on `hp-path.js` for path resolution.

**Sources:** [js/plugins/hp/hp-core-bridge.js L186-L212](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L186-L212)

 [.superdesign/design_iterations/HP/Welcome.html L626](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L626-L626)

## View Rendering and Data Population

The HP portal coordinates view-specific rendering logic that populates sections with live data.

### Overview Section Data Binding

```mermaid
flowchart TD

PORTAL["hpPortal.showView('overview')"]
STATS["Update Statistics"]
CARDS["Render Quick Action Cards"]
GET_INDEX["hpCore.getExamIndex()"]
GET_RECORDS["hpCore.getRecords()"]
CALC_TOTAL["Calculate total exams"]
CALC_COMPLETED["Count completed"]
CALC_AVERAGE["Calculate avg accuracy"]
CALC_DAYS["Calculate practice days"]
UPDATE_DOM["Update DOM Elements<br>#hp-stat-total-exams<br>#hp-stat-completed<br>#hp-stat-average<br>#hp-stat-days"]
RENDER_CARDS["Render #hp-quick-cards<br>Random exams by type"]

PORTAL --> STATS
PORTAL --> CARDS
STATS --> GET_INDEX
STATS --> GET_RECORDS
GET_INDEX --> CALC_TOTAL
GET_RECORDS --> CALC_COMPLETED
GET_RECORDS --> CALC_AVERAGE
GET_RECORDS --> CALC_DAYS
CALC_TOTAL --> UPDATE_DOM
CALC_COMPLETED --> UPDATE_DOM
CALC_AVERAGE --> UPDATE_DOM
CALC_DAYS --> UPDATE_DOM
CARDS --> GET_INDEX
GET_INDEX --> RENDER_CARDS
```

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L422-L447](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L422-L447)

### Practice Section Filtering

The practice view implements client-side filtering:

```mermaid
flowchart TD

USER_INPUT["User Input<br>Type filter or search"]
GET_EXAMS["hpCore.getExamIndex()"]
FILTER_TYPE["Filter by type<br>all/reading/listening"]
FILTER_SEARCH["Filter by search term"]
RENDER_LIST["Render filtered exams<br>#hp-practice-list"]
EMPTY_STATE["Show empty state<br>#hp-practice-empty"]
ATTACH_ACTIONS["Attach button handlers<br>data-action='practice'<br>data-action='pdf'"]

USER_INPUT --> GET_EXAMS
GET_EXAMS --> FILTER_TYPE
FILTER_TYPE --> FILTER_SEARCH
FILTER_SEARCH --> RENDER_LIST
FILTER_SEARCH --> EMPTY_STATE
RENDER_LIST --> ATTACH_ACTIONS
```

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L450-L472](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L450-L472)

### History Section Integration

The history view delegates to specialized plugins:

* **hp-history-table.js**: Renders practice record table with sortable columns
* **hp-history-trend.js**: Renders SVG chart showing 10-day accuracy trends
* Both plugins listen for `dataUpdated` events and re-render automatically

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L474-L516](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L474-L516)

## Settings Integration

The HP settings view integrates with core app functionality through the bridge:

### Settings Actions

```mermaid
flowchart TD

BUTTON["Settings Button Click<br>data-settings-action attribute"]
LOAD_LIB["load-library"]
CLEAR_CACHE["clear-cache"]
CONFIG_LIST["config-list"]
FORCE_REFRESH["force-refresh"]
BACKUP_CREATE["backup-create"]
BACKUP_LIST["backup-list"]
EXPORT["export"]
IMPORT["import"]
THEME_MODAL["theme-modal"]
BRIDGE_API["hpCore action methods"]
APP_METHODS["window.app methods"]
MODAL_RENDER["Show settings modal<br>#hp-settings-modal"]

BUTTON --> LOAD_LIB
BUTTON --> CLEAR_CACHE
BUTTON --> CONFIG_LIST
BUTTON --> FORCE_REFRESH
BUTTON --> BACKUP_CREATE
BUTTON --> BACKUP_LIST
BUTTON --> EXPORT
BUTTON --> IMPORT
BUTTON --> THEME_MODAL
LOAD_LIB --> APP_METHODS
CLEAR_CACHE --> APP_METHODS
BACKUP_CREATE --> BRIDGE_API
EXPORT --> BRIDGE_API
THEME_MODAL --> MODAL_RENDER
```

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L518-L601](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L518-L601)

### Modal System

The HP theme includes a reusable modal component for settings operations:

```

```

The portal script manages modal lifecycle:

* Shows modal with `classList.remove('hidden')`
* Populates body via `innerHTML` or template cloning
* Attaches action handlers to modal buttons
* Closes modal on backdrop click or dismiss button

**Sources:** [.superdesign/design_iterations/HP/Welcome.html L591-L601](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L591-L601)

## API Reference

### hpCore Bridge API

**Lifecycle Methods:**

| Method | Parameters | Return | Description |
| --- | --- | --- | --- |
| `ready(callback)` | `function` | `void` | Execute callback when bridge ready |
| `isReady` | - | `boolean` | Current ready state |

**Event Methods:**

| Method | Parameters | Return | Description |
| --- | --- | --- | --- |
| `on(event, callback)` | `string, function` | `void` | Register event listener |
| `off(event, callback)` | `string, function?` | `void` | Remove event listener(s) |
| `emit(event, payload)` | `string, any` | `void` | Emit event to all listeners |
| `onDataUpdated(callback)` | `function` | `void` | Shorthand for on('dataUpdated') |

**Data Access Methods:**

| Method | Parameters | Return | Description |
| --- | --- | --- | --- |
| `getExamIndex()` | none | `Array<Object>` | Get cached exam index with type field |
| `getRecords()` | none | `Array<Object>` | Get cached practice records |
| `getExamById(id)` | `string` | `Object \| null` | Find exam by ID |

**Action Methods:**

| Method | Parameters | Return | Description |
| --- | --- | --- | --- |
| `startExam(examId)` | `string` | `Window \| null` | Open exam in new window with fallbacks |
| `viewExamPDF(examId)` | `string` | `Window \| null` | Open PDF in new window with fallbacks |
| `showMessage(msg, type, duration)` | `string, string?, number?` | `void` | Display user feedback message |

**Sources:** [js/plugins/hp/hp-core-bridge.js L27-L113](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js#L27-L113)

### hpPortal Router API

| Method | Parameters | Return | Description |
| --- | --- | --- | --- |
| `showView(viewName)` | `string` | `void` | Switch to specified view section |
| `getCurrentView()` | none | `string` | Get current active view name |
| `on(event, callback)` | `string, function` | `void` | Listen for portal events |

**Portal Events:**

* `view:changed` - Fired after view transition completes, payload: `{from: string, to: string}`
* `view:beforeChange` - Fired before view transition, payload: `{from: string, to: string}`

**Sources:** Based on portal architecture from [.superdesign/design_iterations/HP/Welcome.html L398-L401](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HP/Welcome.html#L398-L401)

## Plugin Examples

### History Trend Plugin

The `hp-history-trend.js` demonstrates data visualization using the bridge:

```

```

This plugin renders SVG charts showing 10-day practice accuracy trends, automatically updating when data changes through the `dataUpdated` event.

Sources: [js/plugins/hp/hp-history-trend.js L18](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-history-trend.js#L18-L18)

### Welcome CTA Plugin

The `hp-welcome-cta.js` shows action integration:

```

```

This plugin handles call-to-action buttons by selecting random exams and delegating to the appropriate system functions.

Sources: [js/plugins/hp/hp-welcome-cta.js L23-L31](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-welcome-cta.js#L23-L31)

The HP Core Bridge architecture enables the Harry Potter theme to extend system functionality through a clean, event-driven plugin system while maintaining compatibility with the main application architecture.