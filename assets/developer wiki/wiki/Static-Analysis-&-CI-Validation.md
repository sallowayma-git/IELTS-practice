# Static Analysis & CI Validation

> **Relevant source files**
> * [.superdesign/design_iterations/xiaodaidai_dashboard_1.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/xiaodaidai_dashboard_1.html)
> * [assets/data/vocabulary.json](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/data/vocabulary.json)
> * [developer/docs/10-06 log.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/10-06 log.md)
> * [developer/docs/optimization-task-tracker.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md)
> * [developer/tests/ci/run_static_suite.py](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py)
> * [developer/tests/js/e2e/appE2ETest.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js)
> * [developer/tests/js/suiteInlineFallback.test.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/suiteInlineFallback.test.js)
> * [developer/tests/js/suiteModeFlow.test.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/suiteModeFlow.test.js)
> * [js/app/suitePracticeMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/suitePracticeMixin.js)
> * [js/components/practiceHistoryEnhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistoryEnhancer.js)
> * [js/core/goalManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/goalManager.js)
> * [js/practice-page-enhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/practice-page-enhancer.js)
> * [js/utils/dom.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dom.js)

This document describes the static analysis and continuous integration (CI) validation system for the IELTS Practice codebase. It covers the design, implementation, and coverage of the static analysis suite, its integration with CI pipelines, and the specific checks performed on both code and configuration assets.

**Scope:**

* How static analysis is performed (tools, scripts, and coverage)
* What is checked: HTML structure, JavaScript contracts, metadata, and configuration
* How results are reported and used in CI
* How the static suite relates to E2E and path compatibility tests

For information about end-to-end (E2E) browser testing, see [E2E Testing Infrastructure](/sallowayma-git/IELTS-practice/10.1-e2e-testing-infrastructure).  

For path compatibility and non-ASCII path testing, see [Path Compatibility Testing](/sallowayma-git/IELTS-practice/10.3-path-compatibility-testing).

---

## Purpose and Role in the System

Static analysis and CI validation ensure that the codebase maintains structural integrity, contract compliance, and configuration correctness before changes are merged or deployed. The static suite is designed to catch regressions, missing assets, and contract violations early, providing a safety net for ongoing refactoring and feature development.

**Key goals:**

* Prevent accidental removal or breakage of critical files and configuration
* Enforce UI and API contract consistency between code and test suites
* Validate that all required assets and metadata are present and well-formed
* Provide fast, deterministic feedback in CI pipelines

**Integration:**  

The static suite is run automatically in CI and can also be invoked locally by developers. It complements, but does not replace, runtime and E2E tests.

**Sources:**

* [developer/tests/ci/run_static_suite.py L1-L600](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L1-L600)
* [developer/docs/optimization-task-tracker.md L505-L683](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L505-L683)

---

## Overview of the Static Analysis Suite

The static analysis suite is implemented as a Python script (`run_static_suite.py`) that aggregates a series of checks over the codebase. It is designed to be fast, deterministic, and independent of browser or runtime state.

### Main Responsibilities

* **HTML Structure Validation:** Ensures that key HTML files (e.g., `index.html`, E2E runners, practice fixtures) are present and start with a valid doctype.
* **UI Contract Coverage:** Parses navigation and settings button structure from HTML and cross-validates with test configuration.
* **JavaScript Contract Checks:** Verifies the presence and body of critical functions, and checks for forbidden patterns (e.g., use of `confirm()` in certain flows).
* **Metadata and Asset Validation:** Ensures that exam data files contain required metadata fields (e.g., `pathRoot`).
* **Repository and Data Layer Checks:** Confirms the presence of all required repository and data source files.
* **Mixin Method Contract Validation:** Ensures that all required mixin methods are implemented and match the contract file.
* **Test Fixture Coverage:** Checks that required test fixtures and templates exist and are well-formed.

### Diagram: Static Analysis Suite Coverage

```mermaid
flowchart TD

HTMLCheck["index.html Doctype"]
E2ERunnerCheck["app-e2e-runner.html Structure"]
NavConfigCheck["Navigation/Settings Button Coverage"]
JSContractCheck["JS Function Contract"]
ForbiddenPatternCheck["Forbidden Pattern Check"]
MetadataCheck["Exam Data Metadata"]
RepoAssetCheck["Repository Asset Presence"]
MixinContractCheck["Mixin Method Contract"]
FixtureCheck["Practice Fixture Presence"]
StaticAnalysisSuite["StaticAnalysisSuite"]

HTMLCheck --> StaticAnalysisSuite
E2ERunnerCheck --> StaticAnalysisSuite
NavConfigCheck --> StaticAnalysisSuite
JSContractCheck --> StaticAnalysisSuite
ForbiddenPatternCheck --> StaticAnalysisSuite
MetadataCheck --> StaticAnalysisSuite
RepoAssetCheck --> StaticAnalysisSuite
MixinContractCheck --> StaticAnalysisSuite
FixtureCheck --> StaticAnalysisSuite

subgraph StaticAnalysisSuite[run_static_suite.py] ["StaticAnalysisSuite[run_static_suite.py]"]
    HTMLCheck
    E2ERunnerCheck
    NavConfigCheck
    JSContractCheck
    ForbiddenPatternCheck
    MetadataCheck
    RepoAssetCheck
    MixinContractCheck
    FixtureCheck
end
```

**Sources:**

* [developer/tests/ci/run_static_suite.py L1-L600](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L1-L600)

---

## Key Checks and Their Implementation

### 1. HTML Structure and Asset Presence

* **Doctype Validation:**   All key HTML files (main app, E2E runners, practice fixtures) must start with `<!DOCTYPE html>`. This is checked using a custom HTML parser.
* **File Existence:**   The suite checks for the presence of all required files, including: * `index.html` * E2E runner: `developer/tests/e2e/app-e2e-runner.html` * Data layer files: repositories, data sources, registry * Practice fixture templates

**Sources:**

* [developer/tests/ci/run_static_suite.py L34-L428](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L34-L428)

---

### 2. UI Contract Coverage

* **Navigation and Settings Buttons:**   The suite parses the navigation bar and settings panel from `index.html` to extract all `data-view` and button IDs. It then loads the test configuration from `interactionTargets.js` and checks for: * Buttons/views present in HTML but missing in test config * Buttons/views present in test config but missing in HTML
* **Purpose:**   This ensures that all UI elements are covered by E2E tests and that the test configuration is up to date with the actual UI.

**Table: Example of Navigation Coverage Check**

| Source | Navigation Views (HTML) | Navigation Views (Config) | Missing in Config | Missing in HTML |
| --- | --- | --- | --- | --- |
| index.html | overview, browse, ... | overview, browse, ... | [] | [] |

**Sources:**

* [developer/tests/ci/run_static_suite.py L81-L350](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L81-L350)
* [developer/tests/js/e2e/interactionTargets.js L1-L30](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/interactionTargets.js#L1-L30)

---

### 3. JavaScript Contract and Forbidden Pattern Checks

* **Function Presence:**   The suite checks that critical helper functions (e.g., `buildOverridePathMap`, `mergeRootWithFallback`, `resolveExamBasePath`) are defined in `main.js`.
* **Forbidden Patterns:**   For certain flows (e.g., `switchLibraryConfig`), the suite checks that forbidden patterns (such as `confirm(`) are not present in the function body.
* **Implementation:**   This is done by parsing the JavaScript source, extracting function bodies, and searching for required or forbidden code snippets.

**Sources:**

* [developer/tests/ci/run_static_suite.py L143-L409](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L143-L409)

---

### 4. Metadata and Data Layer Validation

* **Exam Data Metadata:**   The suite checks that all exam data files (e.g., `complete-exam-data.js`, `listening-exam-data.js`) contain the `pathRoot` metadata field.
* **Repository Asset Presence:**   All repository and data source files must exist and be accessible.

**Sources:**

* [developer/tests/ci/run_static_suite.py L250-L418](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L250-L418)

---

### 5. Mixin Method Contract Validation

* **Contract File:**   The expected set of mixin methods is defined in `exam_app_method_contract.json`.
* **Implementation Check:**   The suite parses all mixin files in `js/app/`, extracts method names, and compares them to the contract. It reports missing or extra methods.

**Table: Example of Mixin Contract Coverage**

| Method Name | In Contract | In Code | Status |
| --- | --- | --- | --- |
| initializeState | Yes | Yes | Pass |
| handleSessionReady | Yes | Yes | Pass |
| missingMethod | Yes | No | **Fail** |

**Sources:**

* [developer/tests/ci/run_static_suite.py L443-L471](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L443-L471)
* [developer/tests/fixtures/exam_app_method_contract.json](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/fixtures/exam_app_method_contract.json)

---

### 6. Practice Fixture and E2E Asset Checks

* **Practice Fixture:**   The suite checks that the CI practice fixture (e.g., `analysis-of-fear.html`) exists, starts with a doctype, and contains required hooks (e.g., `PRACTICE_COMPLETE`, `practicePageEnhancer`).
* **E2E Suite Coverage:**   The suite checks that the E2E test suite covers critical flows, such as bulk delete in practice history.

**Sources:**

* [developer/tests/ci/run_static_suite.py L419-L441](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L419-L441)
* [templates/ci-practice-fixtures/analysis-of-fear.html L1-L1580](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/templates/ci-practice-fixtures/analysis-of-fear.html#L1-L1580)
* [developer/tests/js/e2e/appE2ETest.js L1009-L1116](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L1009-L1116)

---

## Static Analysis in the CI Pipeline

The static suite is integrated into the CI pipeline and is run on every pull request and before deployment. It produces a JSON report (`static-ci-report.json`) summarizing all checks and their results.

* **Fail-fast:**   If any check fails, the CI job fails, preventing merge or deployment.
* **Deterministic:**   The suite does not depend on browser state or network, ensuring consistent results.
* **Extensible:**   New checks can be added as the codebase evolves.

**Sources:**

* [developer/tests/ci/run_static_suite.py L1-L600](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L1-L600)

---

## Relationship to Other Quality Systems

The static analysis suite is part of a broader quality assurance strategy:

* **E2E Testing:**   Complements static checks by exercising the application in a real browser ([see 10.1](/sallowayma-git/IELTS-practice/10.1-e2e-testing-infrastructure)).
* **Path Compatibility:**   Specialized tests for non-ASCII and edge-case paths ([see 10.3](/sallowayma-git/IELTS-practice/10.3-path-compatibility-testing)).
* **Code Quality and Refactoring:**   Static checks enforce contracts and structure, supporting ongoing refactoring ([see 11.1](/sallowayma-git/IELTS-practice/11.1-refactoring-roadmap-and-task-tracker)).

---

## Diagram: Static Analysis and CI Validation in System Context

```

```

**Sources:**

* [developer/tests/ci/run_static_suite.py L1-L600](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L1-L600)
* [developer/tests/js/e2e/appE2ETest.js L1-L2000](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L1-L2000)
* [developer/tests/js/e2e/interactionTargets.js L1-L30](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/interactionTargets.js#L1-L30)
* [developer/tests/fixtures/exam_app_method_contract.json](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/fixtures/exam_app_method_contract.json)
* [templates/ci-practice-fixtures/analysis-of-fear.html L1-L1580](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/templates/ci-practice-fixtures/analysis-of-fear.html#L1-L1580)

---

## Example: Static Suite Result Table

| Check Name | Status | Detail |
| --- | --- | --- |
| index.html 存在性 | pass | 已找到 |
| app-e2e-runner.html Doctype | pass | 检测到 |
| 导航视图覆盖 | pass | {dom: [...], config: [...], ...} |
| switchLibraryConfig 禁止 confirm | pass | 未发现禁止片段 |
| resolveExamBasePath 路径组合逻辑 | pass | {checked: [...], missing: []} |
| complete-exam-data.js 根目录元数据 | pass | 检测到 pathRoot 元数据 |
| 练习页面测试模板存在性 | pass | 已找到 |
| Mixin 方法契约覆盖 | pass | {expectedCount: 12, actualCount: 12, ...} |

**Sources:**

* [developer/tests/ci/run_static_suite.py L261-L471](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L261-L471)

---

## Summary

The static analysis and CI validation system is a critical part of the IELTS Practice codebase's quality assurance process. It provides comprehensive, automated checks for structural, contract, and configuration integrity, and is tightly integrated with the CI pipeline to prevent regressions and ensure code quality during ongoing development and refactoring.

**For further reading:**

* [E2E Testing Infrastructure](/sallowayma-git/IELTS-practice/10.1-e2e-testing-infrastructure)
* [Path Compatibility Testing](/sallowayma-git/IELTS-practice/10.3-path-compatibility-testing)
* [Refactoring Roadmap & Task Tracker](/sallowayma-git/IELTS-practice/11.1-refactoring-roadmap-and-task-tracker)

---

**Sources:**

* [developer/tests/ci/run_static_suite.py L1-L600](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py#L1-L600)
* [developer/docs/optimization-task-tracker.md L505-L683](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L505-L683)
* [developer/tests/js/e2e/interactionTargets.js L1-L30](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/interactionTargets.js#L1-L30)
* [developer/tests/js/e2e/appE2ETest.js L1-L2000](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L1-L2000)
* [templates/ci-practice-fixtures/analysis-of-fear.html L1-L1580](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/templates/ci-practice-fixtures/analysis-of-fear.html#L1-L1580)
* [developer/tests/fixtures/exam_app_method_contract.json](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/fixtures/exam_app_method_contract.json)