# Requirements Document

## Introduction

This feature addresses the fundamental architectural problems in the IELTS exam system. The current codebase is a classic example of "big ball of mud" architecture - 50+ JavaScript modules with no clear boundaries, 2000+ line files, global state pollution, and error handling that hides problems instead of solving them. We need to rebuild this system with proper data structures and clear responsibilities.

The core principle: **Good programmers worry about data structures and their relationships. Bad programmers worry about code.**

## Requirements

### Requirement 1: Establish Proper Data Architecture

**User Story:** As a developer, I want a clean data model that eliminates synchronization bugs, so that I can reason about the system's behavior.

#### Acceptance Criteria

1. WHEN the system starts THEN there SHALL be exactly one ExamStore managing all exam data
2. WHEN the system starts THEN there SHALL be exactly one RecordStore managing all practice records
3. WHEN data changes THEN observers SHALL be notified through a simple event system
4. IF multiple components need data THEN they SHALL subscribe to store changes
5. WHEN debugging data issues THEN there SHALL be a single place to look for each data type

### Requirement 2: Eliminate the Initialization Mess

**User Story:** As a developer, I want predictable system startup, so that I can debug problems without tracing through 5 layers of dependencies.

#### Acceptance Criteria

1. WHEN the application starts THEN initialization SHALL have exactly 3 steps: Data → UI → Events
2. WHEN a step fails THEN the system SHALL log the failure and continue with reduced functionality
3. WHEN initialization completes THEN all core features SHALL work without "waiting for components"
4. IF optional features fail THEN core functionality SHALL be unaffected
5. WHEN debugging startup THEN each step SHALL have clear success/failure logging

### Requirement 3: Remove All Compatibility Cruft

**User Story:** As a developer, I want clean code without legacy workarounds, so that I can maintain the system without fear of breaking hidden dependencies.

#### Acceptance Criteria

1. WHEN implementing features THEN there SHALL be no "fallback", "legacy", or "compatibility" code paths
2. WHEN handling errors THEN there SHALL be explicit error handling with meaningful messages
3. WHEN data formats change THEN there SHALL be explicit migration, not silent conversion
4. IF old behavior is needed THEN it SHALL be reimplemented cleanly, not patched
5. WHEN reviewing code THEN there SHALL be no `try/catch(_){}` blocks that hide errors

### Requirement 4: Enforce Single Responsibility

**User Story:** As a developer, I want each file to do one thing well, so that I can quickly understand and modify functionality.

#### Acceptance Criteria

1. WHEN examining any source file THEN it SHALL be under 300 lines
2. WHEN a file manages data THEN it SHALL only manage data, not UI
3. WHEN a file handles UI THEN it SHALL only handle UI, not business logic
4. IF a function has more than 2 levels of nesting THEN it SHALL be refactored
5. WHEN naming functions THEN names SHALL clearly indicate their single purpose

### Requirement 5: Create Predictable Data Flow

**User Story:** As a developer, I want to trace data flow easily, so that I can predict the effects of changes.

#### Acceptance Criteria

1. WHEN data enters the system THEN it SHALL go: Input → Validation → Store → Notification
2. WHEN UI needs data THEN it SHALL request it from stores, not global variables
3. WHEN data changes THEN affected UI SHALL update through store notifications
4. IF data transformation is needed THEN it SHALL happen at store boundaries only
5. WHEN tracing bugs THEN data flow SHALL be linear, not circular

### Requirement 6: Eliminate Global State Pollution

**User Story:** As a developer, I want minimal global scope pollution, so that I can avoid naming conflicts and unexpected side effects.

#### Acceptance Criteria

1. WHEN the application runs THEN there SHALL be exactly 1 global variable: `App`
2. WHEN components communicate THEN they SHALL use the App instance, not global state
3. WHEN storing application state THEN it SHALL be in App.stores, not scattered globals
4. IF external libraries need globals THEN they SHALL be explicitly documented
5. WHEN testing components THEN they SHALL be testable without global dependencies

### Requirement 7: Implement Honest Error Handling

**User Story:** As a user, I want to know when something goes wrong and what I can do about it, so that I can take appropriate action.

#### Acceptance Criteria

1. WHEN an error occurs THEN the user SHALL see a clear, actionable error message
2. WHEN a component fails THEN the system SHALL continue with explicit degraded functionality
3. WHEN debugging errors THEN developers SHALL have complete error context and stack traces
4. IF an error is recoverable THEN the system SHALL provide specific recovery instructions
5. WHEN errors are logged THEN they SHALL include enough context to reproduce the issue

### Requirement 8: Simplify the Module Structure

**User Story:** As a developer, I want a simple module structure that matches the problem domain, so that I can find code quickly.

#### Acceptance Criteria

1. WHEN organizing code THEN there SHALL be exactly 4 directories: stores/, ui/, utils/, main.js
2. WHEN looking for data logic THEN it SHALL be in stores/ only
3. WHEN looking for UI logic THEN it SHALL be in ui/ only  
4. WHEN looking for utilities THEN they SHALL be pure functions in utils/
5. WHEN the system starts THEN main.js SHALL coordinate everything with minimal logic