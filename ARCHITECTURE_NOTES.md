# Architecture Notes - Dependency Layering

This document defines the layered dependency architecture and documents known violations with fix plans.

## Layer Definition

The IELTS Reading Practice System follows a strict layered architecture to ensure maintainability and clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                   Layer 4: Application                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│  │   Theme     │ │   Plugins   │ │      Practice Pages     │ │
│  │   Scripts   │ │   (HP)      │ │                         │ │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                               ↓ depends on
┌─────────────────────────────────────────────────────────────┐
│                   Layer 3: UI Layer                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│  │ UI Components│ │   UI Logic  │ │    Event Handlers       │ │
│  │ (ExamList)  │ │ (BaseComp)  │ │                         │ │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                               ↓ depends on
┌─────────────────────────────────────────────────────────────┐
│                   Layer 2: Store Layer                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│  │   AppStore  │ │  ExamStore  │ │     RecordStore         │ │
│  │             │ │             │ │                         │ │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                               ↓ depends on
┌─────────────────────────────────────────────────────────────┐
│                   Layer 1: Utils Layer                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │
│  │  EventEmitter│ │   Storage   │ │     ErrorService        │ │
│  │             │ │             │ │                         │ │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                               ↓ depends on
┌─────────────────────────────────────────────────────────────┐
│                 Layer 0: Browser APIs                       │
│              (localStorage, DOM, postMessage)              │
└─────────────────────────────────────────────────────────────┘
```

## Dependency Rules

### Allowed Dependencies ✅

| From Layer | To Layer | Direction | Examples |
|------------|----------|-----------|----------|
| 4 (App)    | 3 (UI)   | Downward  | Theme scripts → UI components |
| 4 (App)    | 2 (Store)| Downward  | Practice pages → Stores |
| 4 (App)    | 1 (Utils)| Downward  | Any layer → Utils |
| 3 (UI)     | 2 (Store)| Downward  | UI components → Store data |
| 3 (UI)     | 1 (Utils)| Downward  | UI components → Helpers |
| 2 (Store)  | 1 (Utils)| Downward  | Stores → Storage/Events |
| 2 (Store)  | 0 (Browser)| Downward | Stores → localStorage |
| 1 (Utils)  | 0 (Browser)| Downward | Utils → DOM APIs |

### Forbidden Dependencies ❌

| From Layer | To Layer | Direction | Reason |
|------------|----------|-----------|---------|
| 1 (Utils)  | 2 (Store)| Upward    | Utils should be store-agnostic |
| 1 (Utils)  | 3 (UI)   | Upward    | Utils should be UI-agnostic |
| 1 (Utils)  | 4 (App)  | Upward    | Utils should be app-agnostic |
| 2 (Store)  | 3 (UI)   | Upward    | Stores shouldn't touch DOM |
| 2 (Store)  | 4 (App)  | Upward    | Stores should be UI-agnostic |
| 3 (UI)     | 4 (App)  | Upward    | UI should be app-agnostic |

## Current Architecture Status

### Compliant Layers ✅

**Layer 1 (Utils)** - Well abstracted:
- `js/utils/events.js` - Pure EventEmitter, no dependencies
- `js/utils/helpers.js` - Pure helper functions
- `js/utils/storage.js` - localStorage abstraction
- `js/utils/errorDisplay.js` - Error handling facade

**Layer 2 (Stores)** - Proper data layer:
- `js/stores/AppStore.js` - App state, no DOM manipulation
- `js/stores/ExamStore.js` - Exam data management
- `js/stores/RecordStore.js` - Record data management

**Layer 3 (UI)** - Clean UI components:
- `js/ui/BaseComponent.js` - Base UI class
- `js/ui/ExamBrowser.js` - UI only, uses stores
- `js/ui/RecordViewer.js` - UI only, uses stores

## Known Violations and Fix Plans

### Violation 1: Utils Touching Storage Directly
**File**: `js/utils/helpers.js`
**Issue**: Contains some storage-related functions
**Current**: Mixed responsibilities
**Fix Plan**: Extract storage utilities to `js/utils/storage.js`
**Priority**: Medium
**Owner**: Utils layer refactoring

```javascript
// TODO: Move these functions to storage.js
function getFromStorage(key, defaultValue) { /* ... */ }
function setToStorage(key, value) { /* ... */ }
```

### Violation 2: Stores with DOM References
**File**: `js/stores/AppStore.js`
**Issue**: Contains some DOM element references
**Current**: Limited DOM access for error display
**Fix Plan**: Move DOM operations to UI layer via events
**Priority**: Low
**Owner**: AppStore refactoring

```javascript
// TODO: Replace with event emission
// Current: document.getElementById('error-container')
// Fix: this.emit('showError', errorData)
```

### Violation 3: UI Components with Business Logic
**File**: `js/ui/SettingsPanel.js`
**Issue**: Contains data processing logic
**Current**: Mixed UI and business logic
**Fix Plan**: Move business logic to stores
**Priority**: Medium
**Owner**: SettingsPanel refactoring

```javascript
// TODO: Move to stores
// Current: Data processing in UI component
// Fix: Store methods for data processing
```

### Violation 4: Cross-Layer Event Dependencies
**File**: `js/practice-page-enhancer.js`
**Issue**: Practice page touches multiple layers
**Current**: Direct store and DOM manipulation
**Fix Plan**: Create practice-specific service layer
**Priority**: High
**Owner**: Practice architecture refactoring

```javascript
// TODO: Create PracticeService layer
// Current: Direct store access + DOM manipulation
// Fix: PracticeService coordinates between layers
```

### Violation 5: ErrorDisplay Upward Dependency
**File**: `js/utils/errorDisplay.js`
**Issue**: Utils layer accessing AppStore (stores layer)
**Current**: `window.app.stores.app.subscribe(...)`
**Fix Plan**: Use event delegation or dependency injection
**Priority**: High
**Owner**: ErrorService refactoring

```javascript
// TODO: Remove upward dependency
// Current: window.app.stores.app.subscribe(this.handleAppStoreEvent.bind(this));
// Fix: AppStore should emit events that ErrorDisplay listens to via global bus
```

### Violation 6: Performance Optimizer Store Access
**File**: `js/utils/performanceOptimizer.js`
**Issue**: Utils accessing App and stores
**Current**: Direct store references for optimization
**Fix Plan**: Move to separate monitoring layer
**Priority**: Medium
**Owner**: Performance monitoring refactoring

### Violation 7: Global Variable Dependencies
**File**: Multiple files
**Issue**: Direct access to global variables
**Current**: Direct `window.App` access
**Fix Plan**: Use dependency injection where appropriate
**Priority**: Low
**Owner**: Global state management

## Migration Strategy

### Phase 1: Utils Layer Cleanup
1. Move storage functions from `helpers.js` to `storage.js`
2. Remove DOM references from utils
3. Ensure all utils are pure functions

### Phase 2: Store Layer Isolation
1. Remove DOM references from stores
2. Move business logic from UI to stores
3. Implement proper event emission

### Phase 3: UI Layer Simplification
1. Remove business logic from UI components
2. Ensure UI only handles presentation
3. Use stores for all data operations

### Phase 4: Practice Layer Refactoring
1. Create dedicated practice service layer
2. Isolate practice-specific logic
3. Clean up cross-layer dependencies

## Testing Strategy

### Layer Compliance Tests
1. **Dependency Graph Analysis**: Automated check for forbidden dependencies
2. **Import Analysis**: Verify no upward imports
3. **Runtime Analysis**: Monitor actual dependency usage

### Architecture Validation
1. **Static Analysis**: Check file structure compliance
2. **Dynamic Analysis**: Monitor runtime dependencies
3. **Integration Tests**: Verify layer boundaries

## Benefits of Layered Architecture

1. **Maintainability**: Clear separation of concerns
2. **Testability**: Each layer can be tested independently
3. **Reusability**: Utils can be reused across projects
4. **Scalability**: New features can be added without breaking existing code
5. **Debugging**: Easier to trace issues through layers

## Implementation Notes

- **File Loading Order**: Maintain utils → stores → ui → app loading sequence
- **Event Flow**: Events should flow downward (app → ui → stores)
- **Data Flow**: Data should flow upward (stores → ui → app)
- **Error Handling**: Each layer should handle errors appropriately
- **Logging**: Use debugLog for verbose logging in development

---

**Document created**: Task 42 implementation
**Status**: ✅ Architecture defined, violations documented
**Next**: Address violations in order of priority