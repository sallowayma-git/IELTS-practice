# IELTS Reading Practice System Overview

> **Relevant source files**
> * [improved-working-system.html](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html)
> * [index.html](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/index.html)
> * [js/components/BrowseStateManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/BrowseStateManager.js)
> * [js/components/EventManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js)
> * [js/components/ExamBrowserRecovery.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/ExamBrowserRecovery.js)

## Purpose and Scope

This document provides a comprehensive overview of the IELTS Reading Practice System, a web-based application designed for managing and delivering IELTS reading practice exercises. The system encompasses exam browsing, session management, progress tracking, and comprehensive error recovery mechanisms.

The system consists of 84 exam questions categorized by difficulty (P1, P2, P3) and frequency (high, low), delivered through both HTML and PDF formats. This document covers the overall architecture, component relationships, and core patterns used throughout the system.

For detailed information about specific subsystems, see: Core Application [2](/sallowayma-git/IELTS-practice/2-core-application), Exam Data System [3](/sallowayma-git/IELTS-practice/3-exam-data-system), User Interface & Styling [4](/sallowayma-git/IELTS-practice/4-user-interface-and-styling), Infrastructure Components [5](/sallowayma-git/IELTS-practice/5-infrastructure-components), Practice Session System [6](/sallowayma-git/IELTS-practice/6-practice-session-system), and Development Configuration [7](/sallowayma-git/IELTS-practice/7-development-configuration).

## System Architecture Overview

The IELTS Reading Practice System follows a hub-and-spoke architecture with `improved-working-system.html` serving as the central coordinator. The system emphasizes resilience through comprehensive error handling, state persistence, and graceful degradation.

### High-Level System Architecture

```

```

**Sources:** [improved-working-system.html L1-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1-L1200)

 [index.html L1-L415](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/index.html#L1-L415)

 [js/components/EventManager.js L1-L540](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L1-L540)

 [js/components/ExamBrowserRecovery.js L1-L532](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/ExamBrowserRecovery.js#L1-L532)

 [js/components/BrowseStateManager.js L1-L535](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/BrowseStateManager.js#L1-L535)

## Core Application Structure

The main application `improved-working-system.html` serves as a single-file application containing embedded JavaScript that orchestrates all system components. It implements a view-based architecture with four primary views: overview, browse, practice, and settings.

### Core Application Component Map

```

```

**Sources:** [improved-working-system.html L711-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L711-L1200)

 [improved-working-system.html L566-L684](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L566-L684)

 [improved-working-system.html L687-L710](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L687-L710)

## Data Flow and Communication Patterns

The system implements multiple communication channels to ensure reliable data flow between components, with fallback mechanisms for error resilience.

### Data Flow Architecture

```

```

**Sources:** [js/components/BrowseStateManager.js L137-L158](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/BrowseStateManager.js#L137-L158)

 [js/components/EventManager.js L479-L490](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L479-L490)

 [js/components/ExamBrowserRecovery.js L42-L57](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/ExamBrowserRecovery.js#L42-L57)

## Component Interaction and Event System

The system uses the `EventManager` class to coordinate interactions between components, preventing memory leaks and ensuring consistent event handling across the application.

### Event Management System

| Event Type | Handler | Purpose | Source Component |
| --- | --- | --- | --- |
| `windowResized` | `handleWindowResize()` | Responsive layout updates | `EventManager` |
| `browseFilterChanged` | `dispatchFilterChangeEvent()` | Filter synchronization | `BrowseStateManager` |
| `examBrowserError` | `handleError()` | Error recovery initiation | `ExamBrowserRecovery` |
| `categoryBrowse` | `setBrowseFilter()` | Category navigation | `BrowseStateManager` |
| `practiceSession` | `recordPracticeSession()` | Session data capture | `PracticeRecorder` |

The `EventManager` class implements debouncing and throttling for performance optimization:

* Search events: 300ms debounce via `debounce()` method
* Window resize events: 250ms throttle via `throttle()` method
* Filter changes: Immediate processing with state persistence

**Sources:** [js/components/EventManager.js L495-L510](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L495-L510)

 [js/components/EventManager.js L515-L526](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/EventManager.js#L515-L526)

 [js/components/BrowseStateManager.js L425-L434](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/BrowseStateManager.js#L425-L434)

## Error Handling and Resilience Architecture

The system implements a multi-tier error recovery system through the `ExamBrowserRecovery` class, which provides escalating recovery strategies for different failure scenarios.

### Error Recovery Strategy Flow

```

```

The recovery system maintains error statistics and implements exponential backoff:

* Maximum errors before critical failure: 5
* Health check interval: 30 seconds
* Error log retention: 50 most recent errors
* Recovery strategies execute in sequence until success

**Sources:** [js/components/ExamBrowserRecovery.js L6-L21](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/ExamBrowserRecovery.js#L6-L21)

 [js/components/ExamBrowserRecovery.js L95-L147](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/ExamBrowserRecovery.js#L95-L147)

 [js/components/ExamBrowserRecovery.js L328-L350](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/ExamBrowserRecovery.js#L328-L350)

## State Management and Persistence

The `BrowseStateManager` class provides comprehensive state management with persistence, supporting undo/redo functionality and navigation history.

### State Management Architecture

```

```

The state manager implements the following persistence patterns:

1. **Automatic Persistence**: State changes trigger immediate `localStorage` saves
2. **History Tracking**: All state changes are logged with timestamps
3. **Graceful Recovery**: Invalid state data falls back to defaults
4. **Subscriber Pattern**: Components can subscribe to state changes via callbacks

**Sources:** [js/components/BrowseStateManager.js L137-L158](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/BrowseStateManager.js#L137-L158)

 [js/components/BrowseStateManager.js L191-L206](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/BrowseStateManager.js#L191-L206)

 [js/components/BrowseStateManager.js L162-L186](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/BrowseStateManager.js#L162-L186)

## System Integration Points

The system integrates multiple formats and communication protocols:

### Integration Architecture

| Component | Input Format | Output Format | Communication Method |
| --- | --- | --- | --- |
| `completeExamData` | JavaScript Object | JSON | Direct property access |
| `PracticePageEnhancer` | HTML Template | Enhanced DOM | `window.postMessage` |
| `localStorage` | JSON String | JavaScript Object | Synchronous API |
| PDF Handler | File Path | Window Reference | `window.open` |
| Error Recovery | Error Object | Recovery Action | Custom Events |

The system supports both HTML-based practice pages and PDF documents, with automatic fallback mechanisms when components fail to load or initialize properly.

**Sources:** [improved-working-system.html L1070-L1085](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1070-L1085)

 [improved-working-system.html L687-L710](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L687-L710)

 [js/components/ExamBrowserRecovery.js L162-L194](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/ExamBrowserRecovery.js#L162-L194)