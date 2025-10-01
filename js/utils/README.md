# Utils Directory Documentation

This directory contains utility functions and classes that support the IELTS Reading Practice System.

## Files Overview

### events.js
**Single source of truth for event system** (Task 33)

- **Purpose**: Provides `EventEmitter` class for reactive communication between stores and UI components
- **Key Features**:
  - Event subscription (`on`, `off`, `emit`)
  - Global event bus (`window.globalEventBus`)
  - File:// protocol compatible
  - Guard against redefinition
- **Usage**: Load before other utilities to ensure single initialization

### helpers.js
**General purpose utility functions**

- **Purpose**: Common helper functions and event patterns
- **Key Features**:
  - Debounce functions
  - Event handler creators
  - Window context detection (`isPracticeWindow()`)
  - EventEmitter guards (redefinition protection)
  - Global event bus initialization (backup)
- **Note**: Contains fallback EventEmitter definition with guards

### storage.js
**Data persistence layer**

- **Purpose**: Provides localStorage abstraction for exam and practice data
- **Key Features**:
  - Async get/set/remove operations
  - JSON serialization/deserialization
  - Error handling and validation
  - File:// protocol safe

### errorDisplay.js
**Error display and ErrorService facade** (Task 31)

- **Purpose**: User-friendly error display with unified service facade
- **Key Features**:
  - `ErrorDisplay` class for visual error rendering
  - `ErrorService` facade for unified error handling
  - Fallback mechanisms (alert/console)
  - Multiple error types (error, warning, info)
  - Backward compatibility

### performanceOptimizer.js
**Performance monitoring and optimization**

- **Purpose**: Performance monitoring and optimization suggestions
- **Key Features**:
  - Script loading order analysis
  - Performance timing marks
  - Optimization recommendations
  - Legacy component detection

## Usage Guidelines

1. **Loading Order** (critical for file:// compatibility):
   ```
   events.js → helpers.js → storage.js → other utilities
   ```

2. **Event System**:
   ```javascript
   // Use global event bus for cross-component communication
   window.globalEventBus.emit('event_name', data);
   window.globalEventBus.on('event_name', handler);
   ```

3. **Error Handling**:
   ```javascript
   // Use unified ErrorService
   ErrorService.showUser('Error message', 'error');
   ErrorService.log(error, 'context');
   ```

4. **Window Detection**:
   ```javascript
   // Check if running in practice window
   if (isPracticeWindow()) {
       // Practice window specific logic
   }
   ```

## Architecture Notes

- **Single Source**: EventEmitter is canonical in `events.js`, with guards in `helpers.js`
- **File:// Compatibility**: All utilities designed to work without external dependencies
- **Error Resilience**: Robust error handling with fallback mechanisms
- **Performance Monitoring**: Built-in performance tracking and optimization suggestions

## Task References

- Task 33: EventEmitter canonicalization
- Task 31: ErrorService facade
- Task 35: Window context detection
- Task 37: Regression testing utilities

Key principles:
- **Modularity**: Small, focused functions/classes; no side effects unless specified.
- **Compatibility**: Works in file:// environments; uses native browser APIs (no external libs).
- **Performance**: Includes debouncing, throttling, and caching where relevant.
- **Error Resilience**: Functions include validation and fallbacks.

The directory includes files like:
- `helpers.js`: General-purpose helpers (DOM, data, events).
- `storage.js`: localStorage abstraction with quota management.
- `responsiveManager.js`: Handles viewport changes and touch support.
- `debounce.js`, `errorDisplay.js`, etc.: Specialized utilities.

## Public API

### helpers.js
Core utility functions for everyday operations.

- `helpers.validateExam(data)`: Validates exam object structure (e.g., checks required fields like id, title, category). Returns boolean or throws Error.
- `helpers.createElement(tag, attrs, children)`: Creates DOM element with attributes and children. E.g., `createElement('div', {class: 'exam'}, 'Title')`.
- `helpers.debounce(fn, delay)`: Returns debounced version of function (e.g., for search input). Delay in ms, default 300.
- `helpers.formatScore(score)`: Formats IELTS score (e.g., 7.5 → "7.5 Band"). Handles rounding and localization.
- `helpers.deepCopy(obj)`: Creates deep clone of object/array for immutability.
- `helpers.addEventListenerSafe(element, event, handler)`: Adds listener with error wrapping and cleanup.

Example:
```javascript
import { validateExam, createElement, debounce } from './helpers.js';
const exam = { id: '123', title: 'Test' };
if (validateExam(exam)) {
  const el = createElement('div', { class: 'exam-item' }, exam.title);
  document.body.appendChild(el);
}
const debouncedSearch = debounce(searchExams, 300);
input.addEventListener('input', debouncedSearch);
```

### storage.js
Abstraction over localStorage with error handling.

- `storage.get(key, defaultValue)`: Retrieves parsed JSON from localStorage. Returns defaultValue on error (e.g., quota exceeded).
- `storage.set(key, value)`: Stringifies and saves value. Handles quota cleanup if needed; returns boolean success.
- `storage.remove(key)`: Deletes key from localStorage.
- `storage.cleanup()`: Removes expired/old entries (e.g., records >30 days).

Example:
```javascript
storage.set('exam_index', examData);
const exams = storage.get('exam_index', []);
storage.cleanup();
```

### Other Utilities
- **responsiveManager.js**: `responsiveManager.init()` - Sets up resize listener; `responsiveManager.isMobile()` - Checks viewport width (<768px); `responsiveManager.addBreakpointHandler(width, callback)`.
- **errorDisplay.js**: `errorDisplay.show(message, type='error')` - Displays toast/notification; `errorDisplay.hide(id)`.
- **examCommunication.js**: `examCommunication.sendMessage(targetWindow, type, data)` - postMessage wrapper; `examCommunication.listen(callback)`.
- **performanceOptimizer.js**: `performanceOptimizer.cache(key, value)` / `performanceOptimizer.get(key)` - Simple in-memory cache with TTL.
- **themeManager.js**: `themeManager.applyTheme(theme)` - Toggles CSS classes; `themeManager.getCurrentTheme()`.
- **keyboardShortcuts.js**: `keyboardShortcuts.register(key, handler)` - Global shortcut handling (e.g., Ctrl+S for save).

## Integration Notes
- Import as needed: Most are plain functions; classes like responsiveManager are instantiated once.
- Global Access: Some (e.g., storage) exposed on `window` for legacy compatibility.
- Dependencies: Minimal; helpers.js is self-contained.
- Testing: Pure functions easy to unit test; DOM utils require mock environment.

For UI components, see [js/ui/README.md](../ui/README.md). For data stores, see [js/stores/README.md](../stores/README.md).

**Sources:** js/utils/helpers.js, js/utils/storage.js, etc.