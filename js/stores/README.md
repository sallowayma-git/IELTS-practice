# Stores Directory Documentation

This directory contains data management classes that serve as the single source of truth for the IELTS Reading Practice System.

## Files Overview

### AppStore.js
**Application state management**

- **Purpose**: Manages application-wide state, navigation, and error handling
- **Key Features**:
  - Current view tracking
  - Error collection and display
  - Loading state management
  - Event emission for state changes
- **Usage**: `App.stores.app` (canonical name)

### ExamStore.js
**Exam data management**

- **Purpose**: Handles exam data loading, filtering, and searching
- **Key Features**:
  - Exam index management
  - Category-based filtering
  - Search functionality
  - Exam metadata access
- **Usage**: `App.stores.exams` (canonical) and `App.stores.examStore` (backward compatible)

### RecordStore.js
**Practice record management**

- **Purpose**: Manages practice history, statistics, and progress tracking
- **Key Features**:
  - Practice record storage and retrieval
  - Statistics calculation
  - Progress tracking
  - Record validation
- **Usage**: `App.stores.records` (canonical) and `App.stores.recordStore` (backward compatible)

## Store Naming Convention (Task 34)

### Canonical Names (recommended)
- `App.stores.app` - Application state
- `App.stores.exams` - Exam data
- `App.stores.records` - Practice records

### Legacy Names (supported)
- `App.stores.appStore` - Application state (deprecated)
- `App.stores.examStore` - Exam data (deprecated)
- `App.stores.recordStore` - Practice records (deprecated)

### Migration Plan
1. New code should use canonical names (`exams`, `records`, `app`)
2. Existing code continues to work through adapters
3. Development mode shows deprecation warnings for legacy names
4. Both naming conventions point to the same underlying instances

## Usage Examples

```javascript
// Canonical usage (recommended)
const exams = App.stores.exams;
const records = App.stores.records;
const app = App.stores.app;

// Legacy usage (still supported)
const examStore = App.stores.examStore;
const recordStore = App.stores.recordStore;
const appStore = App.stores.appStore;

// Both access the same instance
console.log(exams === examStore); // true
```

## Architecture Notes

- **Single Source of Truth**: Each store type has only one instance
- **Event-Driven**: Stores emit events when data changes
- **File:// Compatible**: Uses localStorage for persistence
- **Adapter Pattern**: Provides naming compatibility during transition
- **Type Safety**: Includes validation for data structures

## Task References

- Task 34: Store naming adapters and normalization
- Task 27: Baseline scripts and injector integration
- Task 37: Store adapter testing

Key principles:
- **Unidirectional Flow**: Data flows from stores to consumers (e.g., UI components) via events; no direct mutations from outside.
- **Persistence**: Integration with localStorage for durable state, with error handling for quota issues.
- **Reactivity**: Subscription-based updates for real-time synchronization.
- **file:// Compatibility**: Uses global scope and static loading; no dynamic imports.

The directory includes:
- `AppStore.js`: Global application state.
- `ExamStore.js`: Exam data management.
- `RecordStore.js`: Practice history and statistics.

## Public API

### AppStore
Manages overarching app state, including settings, current view, and store coordination.

- `AppStore.init()`: Initializes all stores, sets up event subscriptions, and loads initial state from localStorage. Returns a Promise resolving on completion.
- `AppStore.getState(key)`: Retrieves a specific state value (e.g., `AppStore.getState('currentView')`). Defaults to null if unset.
- `AppStore.updateState(key, value)`: Updates state and persists to localStorage. Emits `appStateChanged` event with the new state.
- `AppStore.subscribe(callback)`: Registers a callback for any state changes. Returns an unsubscribe function.
- `AppStore.unsubscribe(callback)`: Removes a specific subscription.

Example:
```javascript
AppStore.init().then(() => {
  AppStore.subscribe((state) => console.log('State updated:', state));
  AppStore.updateState('theme', 'dark');
});
```

### ExamStore
Handles exam data: loading from `complete-exam-data.js`, filtering, and caching.

- `ExamStore.loadExams()`: Loads and parses exam index data. Returns a Promise with an array of exam objects. Emits `examsLoaded` event.
- `ExamStore.filterExams(category, difficulty)`: Filters exams by criteria. Returns filtered array and emits `examsFiltered` event.
- `ExamStore.getExam(examId)`: Retrieves a single exam by ID. Returns exam object or null.
- `ExamStore.subscribe(callback)`: Subscribes to exam data changes (load/filter). Callback receives the current exams array.
- `ExamStore.clearCache()`: Clears in-memory cache and reloads from source.

Example:
```javascript
ExamStore.loadExams().then(exams => {
  const filtered = ExamStore.filterExams('reading', 'easy');
  ExamStore.subscribe(exams => renderExamList(exams));
});
```

### RecordStore
Manages user practice records: saving sessions, computing stats, and querying history.

- `RecordStore.saveRecord(record)`: Saves a practice record to localStorage. Validates data and emits `recordSaved` event with the record.
- `RecordStore.getStats()`: Computes aggregate statistics (e.g., average score, completion rate). Returns an object with stats.
- `RecordStore.getRecords(filter)`: Retrieves records matching filter (e.g., date range, exam type). Returns array; emits `recordsQueried`.
- `RecordStore.subscribe(callback)`: Listens for record changes (save/query). Callback receives affected records.
- `RecordStore.cleanupOldRecords(days = 30)`: Removes records older than specified days to manage storage.

Example:
```javascript
RecordStore.saveRecord({ examId: '123', score: 7.5 });
const stats = RecordStore.getStats();
RecordStore.subscribe(records => updateHistoryView(records));
```

## Integration Notes
- All stores are instantiated globally via `window.stores` after `AppStore.init()`.
- Use `App.events` for cross-store communication (e.g., `App.events.on('recordSaved', () => ExamStore.updateProgress(examId))`).
- Error handling: Methods throw descriptive errors; wrap in try-catch or use .catch() on Promises.
- Testing: Stores can be mocked by overriding their methods before init.

For UI integration, see [js/ui/README.md](README.md). For utilities, see [js/utils/README.md](README.md).

**Sources:** js/stores/AppStore.js, js/stores/ExamStore.js, js/stores/RecordStore.js