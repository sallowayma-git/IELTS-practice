# Refactoring Roadmap & Task Tracker

> **Relevant source files**
> * [developer/docs/10-06 log.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/10-06 log.md)
> * [developer/docs/optimization-task-tracker.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md)
> * [developer/tests/js/e2e/appE2ETest.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js)
> * [js/components/practiceHistoryEnhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistoryEnhancer.js)
> * [js/core/goalManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/goalManager.js)
> * [js/utils/dom.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dom.js)

This document provides a comprehensive overview of the ongoing and completed refactoring, optimization, and code quality improvement efforts in the IELTS Practice System codebase. It serves as the canonical reference for the project's technical debt reduction, architectural modernization, and codebase hygiene initiatives.

**Scope:**

* Tracks all major refactoring phases, their goals, progress, and outcomes.
* Documents the mapping between high-level refactoring objectives and concrete code changes.
* Details the technical rationale, acceptance criteria, and verification methods for each task.
* Provides a bridge between system-level goals and specific code entities (files, classes, functions).

**Not in scope:**

* For details on the overall application architecture, see [Core Application Architecture](/sallowayma-git/IELTS-practice/3-core-application-architecture).
* For data management and repository design, see [Data Management System](/sallowayma-git/IELTS-practice/4-data-management-system).
* For performance and code quality best practices, see [Performance & Code Quality](/sallowayma-git/IELTS-practice/11.2-performance-and-code-quality).

---

## Purpose and Structure

The refactoring roadmap is designed to:

* Reduce complexity and improve maintainability.
* Eliminate legacy anti-patterns (e.g., direct `innerHTML`, global state, synchronous storage).
* Unify state management and data access.
* Establish and enforce code standards and type safety.
* Provide a clear, testable migration path for all major subsystems.

The roadmap is organized into **phases** (urgent fixes, architecture, data, performance, code quality), each with granular tasks, status, and acceptance criteria.

**Sources:**
[developer/docs/optimization-task-tracker.md L1-L74](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L1-L74)

---

## Refactoring Phases Overview

The refactoring effort is structured into six main phases, each targeting a specific set of technical issues:

| Phase | Focus Area | Status | Key Outcomes |
| --- | --- | --- | --- |
| 1 | Emergency Fixes | Complete | Debug code removal, memory leak fixes, error handling, critical bug fixes |
| 2 | Architecture Refactoring | Complete | Monolith split, state unification, legacy bridge, modularization |
| 3 | Data Layer Optimization | Complete | Repository pattern, transaction support, data integrity |
| 4 | Performance Remediation | Complete | Elimination of `innerHTML`, event delegation, batch DOM ops |
| 5 | Code Quality Improvements | Complete | Code deduplication, naming/type standards, static analysis |
| 6 | Test Coverage & CI | Ongoing | E2E, static, and regression test coverage |

**Sources:**
[developer/docs/optimization-task-tracker.md L5-L74](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L5-L74)

---

## Diagram: Refactoring Phases to Code Entities

**Title:** "Refactoring Phases and Key Code Entities"

```

```

**Sources:**
[developer/docs/optimization-task-tracker.md L75-L74](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L75-L74)

---

## Phase and Task Breakdown

### Phase 1: Emergency Fixes

* **Debug Code Removal:** All `console.log` statements removed except for error logging.
* **Memory Leak Fixes:** All `addEventListener` calls paired with `removeEventListener`.
* **Error Handling:** All empty `catch` blocks annotated or removed.
* **Critical Bug Fixes:** Practice record rendering and async storage compatibility.

| Task | Status | Key Files |
| --- | --- | --- |
| Clean debug code | ✅ | js/app.js, js/main.js |
| Fix memory leaks | ✅ | js/utils/dom.js |
| Simplify error handling | ✅ | js/app.js, js/main.js |
| Practice record rendering bug | ✅ | js/components/practiceHistoryEnhancer.js |

**Sources:**
[developer/docs/optimization-task-tracker.md L75-L152](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L75-L152)

---

### Phase 2: Architecture Refactoring

* **Monolith Split:** `js/app.js` split into mixins (state, navigation, session, etc.).
* **State Unification:** All state access via `AppStateService` and `LegacyStateAdapter`.
* **Legacy Bridge:** `LegacyStateBridge` ensures legacy code and new app state remain in sync.
* **Component Modularization:** All major UI and logic modules refactored for testability.

| Task | Status | Key Files |
| --- | --- | --- |
| Split monolith | ✅ | js/app.js, js/app/stateMixin.js, js/app/examSessionMixin.js |
| Unify state | ✅ | js/utils/legacyStateAdapter.js, js/core/legacyStateBridge.js |
| Modularize components | ✅ | js/components/settingsPanel.js, js/components/systemMaintenancePanel.js |

**Sources:**
[developer/docs/optimization-task-tracker.md L196-L311](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L196-L311)

---

### Phase 3: Data Layer Optimization

* **Repository Pattern:** All data access via repositories (Practice, Settings, Backup, Meta).
* **Transaction Support:** Atomic operations and batch updates.
* **Data Integrity:** `DataIntegrityManager` runs consistency checks and auto-backup.

| Task | Status | Key Files |
| --- | --- | --- |
| Implement repositories | ✅ | js/data/repositories/practiceRepository.js, js/data/index.js |
| Transactional storage | ✅ | js/data/dataSources/storageDataSource.js |
| Data integrity | ✅ | js/components/DataIntegrityManager.js |

**Sources:**
[developer/docs/optimization-task-tracker.md L413-L446](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L413-L446)

---

### Phase 4: Performance Remediation

* **Eliminate `innerHTML`:** All major views and components now use `DOMBuilder` and `replaceContent`.
* **Event Delegation:** All UI events handled via `DOMEvents` delegation.
* **Batch DOM Operations:** Large lists and updates use `DocumentFragment` and batch rendering.

| Task | Status | Key Files |
| --- | --- | --- |
| Remove `innerHTML` | ✅ | js/utils/dom.js, js/components/settingsPanel.js, js/plugins/hp/hp-portal.js |
| Event delegation | ✅ | js/utils/dom.js |
| Batch DOM ops | ✅ | js/utils/dom.js |

**Sources:**
[developer/docs/optimization-task-tracker.md L447-L476](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L447-L476)

---

### Phase 5: Code Quality Improvements

* **Deduplication:** All repeated code patterns replaced with utility classes (DOM, performance, type checking).
* **Naming and Type Standards:** Linus-style naming, JSDoc type annotations, and runtime type checks.
* **Static Analysis:** Code standards and complexity checks enforced.

| Task | Status | Key Files |
| --- | --- | --- |
| Remove duplicate code | ✅ | js/utils/dom.js, js/utils/performance.js |
| Enforce naming/type standards | ✅ | js/utils/codeStandards.js, js/utils/typeChecker.js |
| Static analysis | ✅ | developer/tests/ci/run_static_suite.py |

**Sources:**
[developer/docs/optimization-task-tracker.md L505-L683](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L505-L683)

 [developer/docs/10-06 L43-L150](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/10-06 log.md#L43-L150)

---

## Diagram: Task Tracker to Code Entities

**Title:** "Task Tracker: Mapping Tasks to Code Entities"

```

```

**Sources:**
[developer/docs/optimization-task-tracker.md L75-L683](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L75-L683)

---

## Task Status Table

Below is a summary of all tracked tasks, their status, and verification method:

| Task ID | Description | Status | Verification |
| --- | --- | --- | --- |
| 1.1 | Clean debug code | ✅ | Static analysis, CI |
| 1.2 | Fix memory leaks | ✅ | Manual audit, E2E |
| 1.3 | Simplify error handling | ✅ | Code review |
| 1.4 | Practice record rendering bug | ✅ | E2E, CI |
| 1.5 | PracticeRecorder async storage | ✅ | E2E, CI |
| 2.1 | Split monolith | ✅ | File size, modularity, E2E |
| 2.2 | Unify state management | ✅ | Static analysis, E2E |
| 2.3 | Merge redundant components | ✅ | File count, code review |
| 2.4 | Overview view refactor | ✅ | E2E, code review |
| 2.5 | Legacy state bridge | ✅ | E2E, static analysis |
| 2.6 | Clean UI sync storage | ✅ | E2E, code review |
| 2.7 | Legacy plugin storage handshake | ✅ | E2E, code review |
| 2.8 | Async storage in core modules | ✅ | E2E, code review |
| 3.1 | Implement repositories | ✅ | Static analysis, E2E |
| 3.2 | Data integrity management | ✅ | E2E, CI |
| 4.1 | Remove innerHTML | ✅ | Static analysis, E2E |
| 4.2 | Performance optimization | ✅ | E2E, code review |
| 5.1 | Remove duplicate code | ✅ | Static analysis |
| 5.2 | Naming standards | ✅ | Static analysis |
| 5.3 | Add type checking | ✅ | Static analysis, IDE |
| 6.x | Test coverage | Ongoing | E2E, CI |

**Sources:**
[developer/docs/optimization-task-tracker.md L75-L683](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L75-L683)

---

## Verification and Regression Safety

All major refactoring tasks are protected by:

* **End-to-End (E2E) Tests:** Automated flows for navigation, practice, settings, and data export/import ([developer/tests/js/e2e/appE2ETest.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js) ).
* **Static Analysis:** CI scripts check for forbidden patterns (e.g., `innerHTML`, direct `addEventListener`), code standards, and type annotations ([developer/tests/ci/run_static_suite.py](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py) ).
* **Regression Fixtures:** Practice templates and test data ensure that refactored flows remain functional.

**Sources:**
[developer/docs/optimization-task-tracker.md L214-L590](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L214-L590)

 [developer/tests/js/e2e/appE2ETest.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js)

 [developer/tests/ci/run_static_suite.py](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py)

---

## Key Technical Patterns and Tools

* **Event Delegation:** All UI events are handled via `DOMEvents` ([js/utils/dom.js L10-L82](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dom.js#L10-L82) ).
* **DOM Construction:** All DOM updates use `DOMBuilder` and `replaceContent` ([js/utils/dom.js L87-L242](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dom.js#L87-L242) ).
* **Repository Pattern:** All persistent data access is routed through repositories ([js/data/repositories/practiceRepository.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/data/repositories/practiceRepository.js) ).
* **State Bridge:** `LegacyStateAdapter` and `LegacyStateBridge` synchronize legacy and modern state ([js/utils/legacyStateAdapter.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/legacyStateAdapter.js)  [js/core/legacyStateBridge.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/legacyStateBridge.js) ).
* **Type Checking:** JSDoc and runtime type checks via `typeChecker.js` ([js/utils/typeChecker.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/typeChecker.js) ).
* **Code Standards:** Linus-style code standards enforced via `codeStandards.js` ([js/utils/codeStandards.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/codeStandards.js) ).

**Sources:**
[developer/docs/optimization-task-tracker.md L75-L683](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L75-L683)

 [js/utils/dom.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dom.js)

 [js/utils/legacyStateAdapter.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/legacyStateAdapter.js)

 [js/core/legacyStateBridge.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/legacyStateBridge.js)

 [js/utils/typeChecker.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/typeChecker.js)

 [js/utils/codeStandards.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/codeStandards.js)

---

## Ongoing and Future Work

* **Long-tail Legacy Cleanup:** Remaining `innerHTML`, `.style`, and direct event bindings in legacy modules are tracked for future removal.
* **Test Coverage Expansion:** Additional E2E and static tests are planned for new features and edge cases.
* **Performance Monitoring:** Continued use of `PerformanceOptimizer` and batch DOM operations for large data sets.

**Sources:**
[developer/docs/optimization-task-tracker.md L469-L605](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L469-L605)

---

## References

* [Optimization Task Tracker (Full Audit Log)](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/Optimization Task Tracker (Full Audit Log))
* [Linus Philosophy and Code Quality Log](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/Linus Philosophy and Code Quality Log)
* [E2E Test Suite](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/E2E Test Suite)
* [Static Analysis Suite](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/Static Analysis Suite)
* [DOM Utilities](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/DOM Utilities)
* [Type Checking Utilities](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/Type Checking Utilities)
* [Code Standards](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/Code Standards)

---

**This document is updated as new refactoring tasks are completed and as the codebase evolves. For the latest status, always refer to the most recent entries in the optimization task tracker.**

**Sources:**
[developer/docs/optimization-task-tracker.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md)

 [developer/docs/10-06 log.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/10-06 log.md)

 [js/utils/dom.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dom.js)

 [js/utils/typeChecker.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/typeChecker.js)

 [js/utils/codeStandards.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/codeStandards.js)

 [developer/tests/js/e2e/appE2ETest.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js)

 [developer/tests/ci/run_static_suite.py](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py)