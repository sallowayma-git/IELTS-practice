# View Management & Navigation

> **Relevant source files**
> * [assets/developer wiki/hp-overview-usage-todo.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/developer wiki/hp-overview-usage-todo.md)
> * [css/main.css](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/css/main.css)
> * [index.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html)
> * [js/app.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app.js)
> * [js/components/DataIntegrityManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js)
> * [js/data/index.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/data/index.js)
> * [js/main.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js)
> * [js/script.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/script.js)
> * [js/utils/simpleStorageWrapper.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/simpleStorageWrapper.js)
> * [js/views/legacyViewBundle.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js)

## Purpose and Scope

This document describes the view management and client-side navigation system used in the IELTS Practice application. It covers the mechanisms for switching between different views (Overview, Browse, Practice, Settings), the navigation controller architecture, view rendering patterns, and integration with the application state system.

For information about application initialization and bootstrapping, see [Application Initialization & Bootstrap](/sallowayma-git/IELTS-practice/3.2-application-initialization-and-bootstrap). For details on state management, see [ExamSystemApp & State Management](/sallowayma-git/IELTS-practice/3.1-examsystemapp-and-state-management). For theme-specific view systems like the Harry Potter portal, see [HP Core Bridge & Plugin Architecture](/sallowayma-git/IELTS-practice/8.2-hp-core-bridge-and-plugin-architecture).

---

## View System Architecture

The application uses a single-page application (SPA) pattern with multiple views that are shown/hidden based on user navigation. Views are represented as DOM containers with CSS class toggles rather than full page reloads.

### Core View Structure

```

```

**View Container Pattern**

Each view is a `<div>` element with:

* Class: `.view`
* ID: `{viewName}-view` (e.g., `overview-view`, `browse-view`)
* Active state: `.view.active` class for the currently displayed view

[index.html L29-L163](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L29-L163)

 defines the view containers:

* `#overview-view` - Learning overview with category statistics
* `#browse-view` - Exam library browsing interface
* `#practice-view` - Practice history and statistics
* `#settings-view` - System settings and configuration

**Navigation Buttons**

Navigation buttons use a data-attribute pattern:

* Class: `.nav-btn`
* Attribute: `data-view="{viewName}"`
* Active state: `.nav-btn.active` for the current view's button

**Sources:** [index.html L22-L27](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L22-L27)

 [index.html L29-L163](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L29-L163)

 [css/main.css L398-L457](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/css/main.css#L398-L457)

 [css/main.css L459-L471](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/css/main.css#L459-L471)

---

## Navigation Controller

The `NavigationController` manages view switching, button state synchronization, and optional callback execution when navigation occurs.

### NavigationController API

```

```

**Initialization Pattern**

The controller uses a singleton-like pattern with an `ensure()` method:

```

```

**Key Methods**

| Method | Purpose | Parameters |
| --- | --- | --- |
| `ensure(options)` | Get or create NavigationController instance | `options`: configuration object |
| `navigateTo(viewName)` | Switch to specified view | `viewName`: 'overview', 'browse', 'practice', or 'settings' |
| `syncActiveButton()` | Update button active states | None |
| `getCurrentView()` | Get current view name | None |

**Legacy Fallback Integration**

[js/main.js L225-L252](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L225-L252)

 provides a `ensureLegacyNavigation()` function that bridges modern and legacy navigation systems:

* Attempts to use `NavigationController.ensure()` first
* Falls back to `window.ensureLegacyNavigationController()` if needed
* Connects to `window.showView()` for compatibility

**Sources:** [js/main.js L225-L252](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L225-L252)

 [js/presentation/navigation-controller.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/presentation/navigation-controller.js)

---

## View Rendering System

Each view has a dedicated rendering strategy and component architecture.

### Overview View Rendering

The Overview view displays category statistics and entry points for practice.

```

```

**Rendering Flow**

1. `updateOverview()` is called [js/main.js L632-L687](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L632-L687)
2. Statistics are calculated via `AppServices.overviewStats.calculate()`
3. Modern rendering uses `OverviewView.render()` with `DOM.builder`
4. Legacy fallback uses `renderOverviewLegacy()` with `DOMAdapter`
5. Interactive delegates are attached via `setupOverviewInteractions()`

**Key Statistics Display**

| Category | Display Format |
| --- | --- |
| Reading (P1/P2/P3) | Category name + exam count + action buttons |
| Listening (P3/P4) | Category name + exam count + action buttons |
| Suite Practice | Special card with multi-exam session launcher |

**Event Delegation**

[js/main.js L814-L877](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L814-L877)

 implements event delegation for overview actions:

* Uses `data-overview-action` attributes for action identification
* Supported actions: `suite`, `browse`, `random`
* Delegates to `browseCategory()` or `startRandomPractice()`

**Sources:** [js/main.js L632-L687](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L632-L687)

 [js/main.js L689-L810](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L689-L810)

 [js/main.js L814-L877](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L814-L877)

 [js/services/overviewStats.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/services/overviewStats.js)

 [js/views/overviewView.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/overviewView.js)

---

### Browse View Rendering

The Browse view displays filterable exam lists using the `LegacyExamListView` component.

```

```

**LegacyExamListView Architecture**

The view renderer supports:

* **Batch Rendering**: Large lists rendered in chunks via `requestAnimationFrame`
* **Completion Indicators**: Colored dots show recent practice performance
* **Action Buttons**: Dynamic button configuration based on exam availability
* **Empty States**: Configurable empty state messages with actions

**Exam Item Structure**

Each exam item displays:

* **Completion Dot**: Color-coded performance indicator (green/orange/red)
* **Title and Metadata**: Category and type information
* **Action Buttons**: "开始练习" (Start Practice) or "查看PDF" (View PDF)
* **Optional Generate Button**: For PDF-only exams

[js/views/legacyViewBundle.js L469-L532](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js#L469-L532)

 creates exam elements with:

1. Completion status lookup from practice records
2. Dynamic button configuration based on `hasHtml` property
3. Optional PDF and HTML generation buttons

**Batch Rendering Strategy**

For lists exceeding `batchSize` (default: 20), [js/views/legacyViewBundle.js L443-L467](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js#L443-L467)

 uses progressive rendering:

```

```

**Sources:** [js/views/legacyViewBundle.js L389-L638](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js#L389-L638)

 [js/main.js L206-L223](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L206-L223)

---

### Practice View Rendering

The Practice view displays practice statistics and history records using multiple components.

```

```

**PracticeDashboardView**

[js/views/legacyViewBundle.js L116-L163](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js#L116-L163)

 renders four stat cards:

* **Total Practiced**: Count of completed exams
* **Average Score**: Percentage with 1 decimal place
* **Study Time**: Total minutes converted from seconds
* **Streak Days**: Consecutive practice days calculated from date keys

**PracticeHistoryRenderer**

[js/views/legacyViewBundle.js L255-L386](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js#L255-L386)

 creates individual record nodes with:

* **Selection Checkbox**: Displayed in bulk delete mode
* **Record Info**: Title, date, duration with color-coded indicators
* **Percentage Display**: Color-coded score (green > 90%, orange > 75%, red < 60%)
* **Delete Button**: Hidden in bulk delete mode

**Virtual Scrolling Integration**

When available, `VirtualScroller` is used for large record lists:

```

```

**Event Delegation**

[js/main.js L954-L1010](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L954-L1010)

 sets up delegated event handlers for:

* `data-record-action="details"` - Show record modal
* `data-record-action="delete"` - Delete individual record
* Checkbox click - Toggle record selection in bulk mode

**Sources:** [js/views/legacyViewBundle.js L6-L163](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js#L6-L163)

 [js/views/legacyViewBundle.js L255-L386](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js#L255-L386)

 [js/main.js L954-L1010](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L954-L1010)

---

### Settings View Rendering

The Settings view provides system management controls without dynamic rendering. Buttons are statically defined in HTML and connected to handler functions via event listeners.

**Button Categories**

| Category | Buttons | Handler Pattern |
| --- | --- | --- |
| System Management | Clear Cache, Load Library, Library Config, Force Refresh | Direct function calls in `main.js` |
| Data Management | Create Backup, Backup List, Export Data, Import Data | `DataIntegrityManager` methods |
| Theme Switching | Theme Switcher Modal | `theme-switcher.js` modal system |

**Sources:** [index.html L111-L163](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L111-L163)

---

## State Management Integration

View navigation integrates with the centralized state management system.

### State Service Bridge

```

```

**View-Specific State**

The state service maintains UI state relevant to views:

```

```

**State Accessor Functions**

[js/main.js L65-L193](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L65-L193)

 provides state accessor functions that bridge the modern state service and legacy global variables:

| Function | Purpose | Fallback |
| --- | --- | --- |
| `getExamIndexState()` | Get exam list | `window.examIndex` |
| `getBrowseFilterState()` | Get filter settings | `window.__browseFilter` |
| `getFilteredExamsState()` | Get filtered exams | `localFallbackState.filteredExams` |
| `getPracticeRecordsState()` | Get practice records | `window.practiceRecords` |
| `getBulkDeleteModeState()` | Get bulk delete mode | `localFallbackState.bulkDeleteMode` |

**Sources:** [js/main.js L48-L193](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L48-L193)

 [js/app/state-service.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/state-service.js)

---

## Navigation Mixin Pattern

The `navigationMixin` extends `ExamSystemApp` with navigation-related methods.

### Mixin Architecture

```

```

The mixin pattern is applied during initialization [js/app.js L64-L81](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app.js#L64-L81)

:

```

```

**Navigation Mixin Methods**

Key methods provided by the navigation mixin include:

* `navigateToView(viewName)` - Switch views and update state
* `getCurrentView()` - Get active view name
* `showView(viewName)` - Display specific view
* `updateBrowseView()` - Refresh browse view content
* `updatePracticeView()` - Refresh practice view content

**Sources:** [js/app.js L64-L81](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app.js#L64-L81)

 [js/app/navigationMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/navigationMixin.js)

---

## View Lifecycle and Data Flow

Views follow a consistent lifecycle pattern when activated.

### View Activation Flow

```

```

**View Update Triggers**

Different events trigger view updates:

| Event | Affected Views | Update Function |
| --- | --- | --- |
| `examIndexLoaded` | Overview, Browse | `updateOverview()`, `loadExamList()` |
| `storage-sync` | Practice | `syncPracticeRecords()` |
| `PRACTICE_COMPLETE` | Practice, Overview | `syncPracticeRecords()`, `updateOverview()` |
| Navigation | All | View-specific update functions |

**Data Loading Pattern**

[js/main.js L552-L608](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L552-L608)

 implements the library loading pattern:

1. Check for cached data in storage
2. If cache exists and valid, use it
3. Otherwise, rebuild from `window.completeExamIndex` and `window.listeningExamIndex`
4. Save to storage for future use
5. Dispatch `examIndexLoaded` event

**Sources:** [js/main.js L552-L614](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L552-L614)

 [js/main.js L341-L443](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L341-L443)

 [js/main.js L445-L495](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L445-L495)

---

## Theme Portal View Systems

Theme portals like the Harry Potter theme implement alternative view systems that coexist with the main application.

### HP Portal View Architecture

```

```

**HP View Plugins**

Each HP view has dedicated plugin files:

* `hp-welcome-ui.js` - Category selection modal and statistics
* `hp-practice-render.js` - Exam card grid rendering
* `hp-history-table.js` - Virtual scrolling table and trend visualization
* `hp-settings-bridge.js` - System function connections

**HP Navigation Pattern**

Unlike the main app's class-toggle pattern, HP portal uses separate HTML files with `<a>` tag navigation:

```

```

**Core Bridge Integration**

`hp-core-bridge.js` provides:

* `hpCore.ready(callback)` - Wait for system initialization
* `hpCore.getExamIndex()` - Access exam data
* `hpCore.getRecords()` - Access practice records
* Event listeners for `examIndexLoaded` and `PRACTICE_COMPLETE`

**Sources:** [assets/developer L1-L222](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/developer wiki/hp-overview-usage-todo.md#L1-L222)

 [js/plugins/hp/hp-portal.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-portal.js)

 [js/plugins/hp/hp-core-bridge.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-core-bridge.js)

---

## Legacy Fallback System

The application includes a comprehensive fallback system for degraded environments.

### Fallback Architecture

```

```

**Fallback Activation**

[js/script.js L107-L136](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/script.js#L107-L136)

 implements the bootstrap logic:

1. Check if primary runtime functions exist (`loadExamList`, `updatePracticeView`)
2. If available, run smoke test and exit
3. If unavailable, activate fallback renderers
4. Show warning message about degraded mode

**Fallback Renderers**

| Function | Purpose | Implementation |
| --- | --- | --- |
| `showViewFallback()` | Toggle view visibility | Direct class manipulation |
| `renderExamListFallback()` | Display exam list | Simple button list |
| `renderPracticeOverviewFallback()` | Show statistics | Basic stat calculation |

**Smoke Check System**

[js/script.js L91-L105](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/script.js#L91-L105)

 runs diagnostic checks:

* Detects which mode is active (primary/fallback/no-service)
* Records timestamp and component availability
* Stores report in `window.__legacySmokeReport`
* Logs exam count and record count

**Sources:** [js/script.js L1-L148](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/script.js#L1-L148)

 [js/boot-fallbacks.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/boot-fallbacks.js)

---

## Summary

The view management system uses a layered architecture:

1. **Navigation Controller**: Manages view switching and button synchronization
2. **View Renderers**: Specialized components for each view type
3. **State Integration**: Bridges modern state service with legacy globals
4. **Mixin Pattern**: Extends core app with navigation capabilities
5. **Event System**: Coordinates updates across views
6. **Fallback System**: Ensures basic functionality in degraded environments
7. **Theme Portals**: Alternative view systems for themed experiences

This architecture supports progressive refactoring by maintaining compatibility between modern component-based design and legacy global state patterns.

**Sources:** [js/main.js L1-L2151](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L1-L2151)

 [js/app.js L1-L121](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app.js#L1-L121)

 [js/views/legacyViewBundle.js L1-L1043](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js#L1-L1043)

 [js/presentation/navigation-controller.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/presentation/navigation-controller.js)

 [js/app/navigationMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/navigationMixin.js)

 [index.html L1-L408](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L1-L408)