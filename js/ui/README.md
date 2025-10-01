# UI Directory

## Responsibilities

The `js/ui/` directory houses reusable UI components for the IELTS Reading Practice System. These components focus on rendering, user interaction, and DOM manipulation, adhering to the BaseComponent pattern for modularity and lifecycle management. UI components are stateless, receiving data from stores via subscriptions to `App.events` and rendering accordingly.

Key principles:
- **Separation of Concerns**: UI handles presentation only; data logic is in stores.
- **Reusability**: Components extend `BaseComponent` for consistent attach/detach/render cycles.
- **Reactivity**: Subscribe to store events for automatic updates (e.g., re-render on `examsLoaded`).
- **file:// Compatibility**: Uses vanilla DOM APIs, no external frameworks; supports touch/keyboard events.

The directory includes:
- `BaseComponent.js`: Abstract base class for all UI components.
- `ExamBrowser.js`: Main exam listing and browsing interface.
- `ExamFilterBar.js`: Filtering controls for exams.
- `ExamList.js`: Paginated exam display.
- `Pagination.js`: Navigation for lists.
- `RecordStats.js`: Practice statistics visualization.
- `RecordViewer.js`: History record details.
- `SettingsPanel.js`: App configuration UI.

## Public API

### BaseComponent (Abstract)
Foundation for all UI components; extend this class.

- `BaseComponent.attach(container)`: Mounts the component to a DOM element (e.g., `document.getElementById('container')`). Binds events and initializes.
- `BaseComponent.detach()`: Removes from DOM, unbinds events, and cleans up to prevent memory leaks. Returns the component instance.
- `BaseComponent.render(data)`: Updates the component's HTML/content based on provided data. Triggers re-render if subscribed to events.
- `BaseComponent.subscribe(event, callback)`: Internal helper to subscribe to `App.events` for reactive updates.

Example:
```javascript
class MyComponent extends BaseComponent {
  render(data) {
    this.element.innerHTML = `<div>${data.title}</div>`;
  }
}
const comp = new MyComponent();
comp.attach(document.querySelector('#app'));
App.events.on('dataUpdated', (data) => comp.render(data));
```

### ExamBrowser
Orchestrates the exam browsing view, integrating filters, list, and pagination.

- `ExamBrowser.loadExams(exams)`: Populates the browser with exam data from ExamStore. Renders list and applies filters.
- `ExamBrowser.refresh()`: Re-renders based on current store state; useful after filtering.
- `ExamBrowser.openExam(examId)`: Handles exam selection, opens practice window via postMessage.
- `ExamBrowser.attach(container)` / `ExamBrowser.detach()`: Lifecycle methods from BaseComponent.

Example:
```javascript
const browser = new ExamBrowser();
browser.attach(document.getElementById('browse-view'));
ExamStore.subscribe((exams) => browser.loadExams(exams));
```

### ExamFilterBar
Provides controls for filtering exams by category, difficulty, etc.

- `ExamFilterBar.filter(category, difficulty)`: Applies filters and emits `filterApplied` event to update ExamStore.
- `ExamFilterBar.clearFilters()`: Resets to all exams.
- `ExamFilterBar.render(filters)`: Updates UI with current filter state.
- `ExamFilterBar.attach(container)` / `ExamFilterBar.detach()`: Mount/unmount.

Example:
```javascript
const filterBar = new ExamFilterBar();
filterBar.attach(document.getElementById('filter-bar'));
filterBar.onFilterChange = (filters) => ExamStore.filterExams(filters.category, filters.difficulty);
```

### Other Components
- **ExamList**: `ExamList.render(exams, page)` - Displays paginated list; `ExamList.selectItem(id)` - Handles selection.
- **Pagination**: `Pagination.setTotal(total, pageSize)` - Updates pagination controls; `Pagination.goTo(page)` - Navigates.
- **RecordStats**: `RecordStats.render(stats)` - Visualizes scores/charts from RecordStore.getStats().
- **RecordViewer**: `RecordViewer.loadRecord(recordId)` - Displays detailed record; `RecordViewer.edit()` - Inline editing.
- **SettingsPanel**: `SettingsPanel.loadSettings()` - Populates from AppStore; `SettingsPanel.save(key, value)` - Updates AppStore.

## Integration Notes
- Instantiate after `AppStore.init()` and attach to DOM elements in views (e.g., `showView('browse')`).
- Use `App.events` for communication: e.g., `App.events.on('examsFiltered', (exams) => examList.render(exams))`.
- Styling: Components use classes from `css/components.css`; ensure responsive via `js/utils/responsiveManager.js`.
- Testing: Mock DOM and events; test render with sample data.

For data management, see [js/stores/README.md](../stores/README.md). For utilities, see [js/utils/README.md](../utils/README.md).

**Sources:** js/ui/BaseComponent.js, js/ui/ExamBrowser.js, etc.