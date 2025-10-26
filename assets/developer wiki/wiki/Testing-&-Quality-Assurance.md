# Testing & Quality Assurance

> **Relevant source files**
> * [developer/docs/10-06 log.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/10-06 log.md)
> * [developer/docs/optimization-task-tracker.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md)
> * [developer/tests/e2e/playwright_index_clickthrough.py](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/playwright_index_clickthrough.py)
> * [developer/tests/js/e2e/appE2ETest.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js)
> * [developer/tests/js/e2e/indexSnapshot.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/indexSnapshot.js)
> * [js/app/examSessionMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/examSessionMixin.js)
> * [js/app/lifecycleMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/lifecycleMixin.js)
> * [js/components/practiceHistoryEnhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistoryEnhancer.js)
> * [js/core/goalManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/goalManager.js)
> * [js/utils/dom.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dom.js)
> * [js/views/overviewView.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/overviewView.js)

## Purpose and Scope

This document covers the comprehensive testing infrastructure for the IELTS Practice System. The testing strategy employs multiple layers: Playwright-based browser automation, in-browser Node.js E2E tests, static analysis for structural validation, and specialized path compatibility tests. This multi-faceted approach ensures functional correctness, structural integrity, and edge case coverage while providing automated regression detection during refactoring.

For information about the components being tested, see [Core Application Architecture](/sallowayma-git/IELTS-practice/3-core-application-architecture). For details about the practice session flows validated by tests, see [Practice Session System](/sallowayma-git/IELTS-practice/5-practice-session-system).

## Testing Architecture Overview

The testing infrastructure implements a comprehensive three-tier validation strategy that combines automated browser testing, static analysis, and specialized edge case validation:

**Testing Infrastructure Architecture**

```mermaid
flowchart TD

PlaywrightRunner["playwright_index_clickthrough.py<br>Browser Automation"]
E2ERunner["app-e2e-runner.html<br>Test Harness"]
E2ESuite["AppE2ETestSuite<br>In-Browser Tests"]
InteractionTargets["interactionTargets.js<br>Test Configuration"]
StaticSuite["run_static_suite.py<br>CI Validation"]
StructureChecks["HTML Structure Parsing"]
JSChecks["JavaScript Analysis"]
MetadataChecks["Metadata Validation"]
ContractChecks["Mixin Contract Validation"]
PathCompat["path_compatibility_playwright.py<br>Non-ASCII Path Tests"]
SuiteTests["Suite Mode Tests<br>suiteModeFlow.test.js"]
FallbackTests["suiteInlineFallback.test.js"]
PracticeFixtures["ci-practice-fixtures/<br>Practice Templates"]
PathFixtures["Path Compatibility Fixtures"]
IndexSnapshot["indexSnapshot.js<br>Offline Test Data"]
ExamSystemApp["ExamSystemApp"]
PracticeRecorder["PracticeRecorder"]
PathSystem["Path Resolution System"]

PlaywrightRunner --> ExamSystemApp
E2ESuite --> PracticeFixtures
StructureChecks --> ExamSystemApp
ContractChecks --> ExamSystemApp
PathCompat --> PathFixtures
PathCompat --> PathSystem
SuiteTests --> PracticeRecorder
FallbackTests --> PracticeRecorder
E2ESuite --> IndexSnapshot

subgraph subGraph4 ["Application Under Test"]
    ExamSystemApp
    PracticeRecorder
    PathSystem
end

subgraph subGraph3 ["Test Data & Fixtures"]
    PracticeFixtures
    PathFixtures
    IndexSnapshot
end

subgraph subGraph2 ["Specialized Testing"]
    PathCompat
    SuiteTests
    FallbackTests
end

subgraph subGraph1 ["Static Analysis Layer"]
    StaticSuite
    StructureChecks
    JSChecks
    MetadataChecks
    ContractChecks
    StaticSuite --> StructureChecks
    StaticSuite --> JSChecks
    StaticSuite --> MetadataChecks
    StaticSuite --> ContractChecks
end

subgraph subGraph0 ["E2E Testing Layer"]
    PlaywrightRunner
    E2ERunner
    E2ESuite
    InteractionTargets
    PlaywrightRunner --> E2ERunner
    E2ERunner --> E2ESuite
    InteractionTargets --> E2ESuite
end
```

**Three-Tier Testing Strategy**

| Testing Layer | Primary Tool | Coverage Focus | Execution Environment |
| --- | --- | --- | --- |
| Browser E2E | Playwright Python | Full user flows, visual validation | Real browser (Chromium) |
| In-Browser E2E | Node.js + iframe | Component integration, message flows | Browser context with DOM access |
| Static Analysis | Python + AST parsing | Structural integrity, contracts | CI pipeline (no browser) |
| Path Compatibility | Playwright + HTTP server | Non-ASCII paths, special characters | Local server with test fixtures |

Sources: [developer/docs/optimization-task-tracker.md L13-L14](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L13-L14)

 [developer/tests/e2e/playwright_index_clickthrough.py L1-L289](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/playwright_index_clickthrough.py#L1-L289)

 [developer/tests/js/e2e/appE2ETest.js L1-L80](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L1-L80)

 [developer/tests/ci/run_static_suite.py](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py)

## E2E Testing Infrastructure

The E2E testing system consists of two complementary approaches: Python-based Playwright automation for full user flow testing, and Node.js in-browser tests for component-level integration validation.

### Playwright Browser Automation

**Playwright Test Runner Architecture**

```mermaid
flowchart TD

MainFunc["main()<br>async entry point"]
PlaywrightContext["async_playwright()<br>context manager"]
BrowserInstance["browser = chromium.launch()"]
IndexTests["exercise_index_interactions()<br>Main UI flow"]
E2EHarness["run_e2e_suite()<br>Node.js test runner"]
EnsureReady["_ensure_app_ready()<br>Wait for app.isInitialized"]
AcceptDialogs["_accept_dialog()<br>Dialog handler"]
ClickNav["_click_navigation()<br>View switching"]
ExerciseOverview["_exercise_overview()"]
ExerciseBrowse["_exercise_browse()"]
ExercisePractice["_exercise_practice()"]
ExerciseSettings["_exercise_settings()"]
ExerciseDev["_exercise_developer_links()"]
SettingsButtons["Click each settings button<br>load-library-btn, create-backup-btn, etc."]
CloseModals["_close_library_loader()<br>_handle_library_panel()"]
ThemeNav["Navigate theme portals<br>Academic, Melody, HP"]
ClearCache["Clear cache triggers reload"]
LoadRunner["Load app-e2e-runner.html"]
WaitResults["wait_for_function()<br>window.E2E_TEST_RESULTS"]
CheckFailures["Parse results.failed"]
AssertSuccess["Raise if failures > 0"]

BrowserInstance --> IndexTests
IndexTests --> EnsureReady
ExerciseSettings --> SettingsButtons
IndexTests --> ExerciseDev
BrowserInstance --> E2EHarness
E2EHarness --> LoadRunner

subgraph subGraph4 ["E2E Harness Validation"]
    LoadRunner
    WaitResults
    CheckFailures
    AssertSuccess
    LoadRunner --> WaitResults
    WaitResults --> CheckFailures
    CheckFailures --> AssertSuccess
end

subgraph subGraph3 ["Settings Test Details"]
    SettingsButtons
    CloseModals
    ThemeNav
    ClearCache
    SettingsButtons --> CloseModals
    CloseModals --> ThemeNav
    ThemeNav --> ClearCache
end

subgraph subGraph2 ["Index Interaction Tests"]
    EnsureReady
    AcceptDialogs
    ClickNav
    ExerciseOverview
    ExerciseBrowse
    ExercisePractice
    ExerciseSettings
    ExerciseDev
    EnsureReady --> ExerciseOverview
    ExerciseOverview --> ExerciseBrowse
    ExerciseBrowse --> ExercisePractice
    ExercisePractice --> ExerciseSettings
end

subgraph subGraph1 ["Test Execution Flow"]
    IndexTests
    E2EHarness
end

subgraph subGraph0 ["Test Entry Point"]
    MainFunc
    PlaywrightContext
    BrowserInstance
    MainFunc --> PlaywrightContext
    PlaywrightContext --> BrowserInstance
end
```

**Playwright Test Coverage**

The `playwright_index_clickthrough.py` script exercises complete user journeys through the application:

| Test Function | Coverage | Key Validations |
| --- | --- | --- |
| `_exercise_overview()` | Overview view interaction | Category browse buttons, random practice buttons, popup handling |
| `_exercise_browse()` | Browse view filtering | Type filter buttons, exam action buttons (start/pdf/generate) |
| `_exercise_practice()` | Practice history operations | Record type filters, bulk delete toggle, export/clear operations |
| `_exercise_settings()` | Settings panel controls | All settings buttons, theme switcher modal, library loader |
| `_exercise_developer_links()` | Developer modal | Developer team modal open/close |

The script handles dynamic UI elements like dialogs and popups through event handlers:

* `page.on("dialog", lambda dialog: asyncio.ensure_future(_accept_dialog(dialog)))` - Auto-accepts browser dialogs
* `page.on("popup", lambda popup: asyncio.ensure_future(popup.close()))` - Auto-closes popups during test execution

**Test Setup and Cleanup**

```javascript
# Clear theme preferences before tests
await context.add_init_script(
    "(() => { try { localStorage.removeItem('preferred_theme_portal'); sessionStorage.removeItem('preferred_theme_skip_session'); } catch (_) {} })();"
)
```

This ensures consistent test environment by removing cached theme selections.

Sources: [developer/tests/e2e/playwright_index_clickthrough.py L1-L289](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/playwright_index_clickthrough.py#L1-L289)

 [developer/tests/e2e/playwright_index_clickthrough.py L18-L24](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/playwright_index_clickthrough.py#L18-L24)

 [developer/tests/e2e/playwright_index_clickthrough.py L213-L242](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/playwright_index_clickthrough.py#L213-L242)

 [developer/tests/e2e/playwright_index_clickthrough.py L269-L285](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/playwright_index_clickthrough.py#L269-L285)

### Node.js In-Browser Testing

**AppE2ETestSuite Architecture**

```mermaid
flowchart TD

InteractionTargets["interactionTargets.js<br>DEFAULT_INTERACTION_TARGETS"]
NavViews["mainNavigationViews:<br>overview, browse, practice, settings"]
SettingsButtons["settingsButtonIds:<br>clear-cache-btn, load-library-btn, etc."]
ButtonTests["SETTINGS_BUTTON_TESTS<br>stubbed/waitForSelector configs"]
RunnerHTML["app-e2e-runner.html<br>Test harness page"]
IframeApp["iframe containing index.html"]
TestSuite["AppE2ETestSuite instance"]
Setup["setup()<br>Wait for app.isInitialized"]
Teardown["teardown()<br>Restore original data"]
WaitFor["waitFor(condition)<br>Poll with timeout"]
RecordResult["recordResult(name, passed, details)<br>Store and display"]
TestInit["testInitialization()"]
TestOverview["testOverviewRendering()"]
TestNav["testMainNavigationButtons()"]
TestBrowse["testBrowseNavigation()"]
TestFilter["testExamFiltering()"]
TestSearch["testSearchFunction()"]
TestActions["testExamActionButtons()"]
TestEmpty["testExamEmptyStateAction()"]
TestBridge["testLegacyBridgeSynchronization()"]
TestRecords["testPracticeRecordsFlow()"]
TestBulkDelete["testPracticeHistoryBulkDelete()"]
TestSubmission["testPracticeSubmissionMessageFlow()"]
TestSettings["testSettingsControlButtons()"]
TestThemes["testThemePortals()"]
FixtureSetup["Load ci-practice-fixtures/analysis-of-fear.html"]
IframeProxy["Create proxy iframe with srcdoc"]
InitSession["Send INIT_SESSION message"]
WaitReady["Wait for SESSION_READY"]
TriggerSubmit["Trigger practice completion"]
WaitComplete["Wait for PRACTICE_COMPLETE"]
VerifyStorage["Verify practice.records updated"]

TestSuite --> Setup
TestSuite --> TestInit
TestThemes --> Teardown
TestSubmission --> FixtureSetup

subgraph subGraph4 ["Practice Submission Test"]
    FixtureSetup
    IframeProxy
    InitSession
    WaitReady
    TriggerSubmit
    WaitComplete
    VerifyStorage
    FixtureSetup --> IframeProxy
    IframeProxy --> InitSession
    InitSession --> WaitReady
    WaitReady --> TriggerSubmit
    TriggerSubmit --> WaitComplete
    WaitComplete --> VerifyStorage
end

subgraph subGraph3 ["Test Execution Flow"]
    TestInit
    TestOverview
    TestNav
    TestBrowse
    TestFilter
    TestSearch
    TestActions
    TestEmpty
    TestBridge
    TestRecords
    TestBulkDelete
    TestSubmission
    TestSettings
    TestThemes
    TestInit --> TestOverview
    TestOverview --> TestNav
    TestNav --> TestBrowse
    TestBrowse --> TestFilter
    TestFilter --> TestSearch
    TestSearch --> TestActions
    TestActions --> TestEmpty
    TestEmpty --> TestBridge
    TestBridge --> TestRecords
    TestRecords --> TestBulkDelete
    TestBulkDelete --> TestSubmission
    TestSubmission --> TestSettings
    TestSettings --> TestThemes
end

subgraph subGraph2 ["Core Test Methods"]
    Setup
    Teardown
    WaitFor
    RecordResult
end

subgraph subGraph0 ["Test Harness Entry"]
    RunnerHTML
    IframeApp
    TestSuite
    RunnerHTML --> IframeApp
    RunnerHTML --> TestSuite
end

subgraph subGraph1 ["Test Configuration"]
    InteractionTargets
    NavViews
    SettingsButtons
    ButtonTests
    InteractionTargets --> NavViews
    InteractionTargets --> SettingsButtons
    SettingsButtons --> ButtonTests
end
```

**Test Suite Structure**

The `AppE2ETestSuite` class provides comprehensive in-browser testing with direct DOM and JavaScript access:

```python
class AppE2ETestSuite {
    constructor(frame, { statusEl, statusTextEl, resultsTable }) {
        this.frame = frame;                    // iframe containing app
        this.win = null;                       // iframe.contentWindow
        this.doc = null;                       // iframe.contentWindow.document
        this.results = [];                     // test results array
        this.originalPracticeRecords = null;   // backup for teardown
    }
}
```

**Test Configuration Pattern**

The `SETTINGS_BUTTON_TESTS` object defines test behavior for each settings button:

```javascript
const SETTINGS_BUTTON_TESTS = {
    'load-library-btn': {
        name: '设置 - 加载题库按钮',
        stubbed: ['showLibraryLoaderModal', 'loadLibrary'],
        stubImplementation: () => Promise.resolve('loaded')
    },
    'backup-list-btn': {
        name: '设置 - 查看备份列表按钮',
        expectInvocation: false,
        waitForSelector: '.backup-list-container',
        waitDescription: '备份列表渲染',
        cleanupSelector: '.backup-list-container'
    }
}
```

This configuration-driven approach allows declarative test definitions with either stub expectations or DOM selector waits.

**Practice Submission Message Flow Test**

The `testPracticeSubmissionMessageFlow()` method validates the complete practice recording pipeline:

1. **Fixture Loading**: Loads `templates/ci-practice-fixtures/analysis-of-fear.html` which contains a complete practice exam
2. **Iframe Setup**: Creates an iframe with the fixture content using `srcdoc`
3. **Session Handshake**: Sends `INIT_SESSION` message, waits for `SESSION_READY` confirmation
4. **Submission Trigger**: Simulates exam completion and sends `PRACTICE_COMPLETE` message
5. **Storage Verification**: Validates that practice record appears in `storage.get('practice_records')`
6. **UI Validation**: Checks that history list and statistics update correctly

This test ensures the cross-window communication protocol works correctly and that practice data flows through all layers (message → recorder → storage → UI).

Sources: [developer/tests/js/e2e/appE2ETest.js L1-L80](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L1-L80)

 [developer/tests/js/e2e/appE2ETest.js L81-L200](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L81-L200)

 [developer/tests/js/e2e/appE2ETest.js L202-L231](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L202-L231)

 [developer/tests/js/e2e/appE2ETest.js L1120-L1245](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L1120-L1245)

 [developer/docs/optimization-task-tracker.md L145-L152](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L145-L152)

### Test Execution and Result Aggregation

**Test Result Flow**

```mermaid
flowchart TD

RunMethod["suite.run()"]
TestMethods["Individual test methods"]
RecordResult["recordResult(name, passed, details)"]
ResultsArray["this.results = []"]
ResultsTable["Render to resultsTable DOM"]
RenderSummary["renderSummary()"]
GlobalResults["window.E2E_TEST_RESULTS"]
CustomEvent["app-e2e-suite:complete event"]
PlaywrightWait["await page.wait_for_function()<br>Wait for E2E_TEST_RESULTS"]
ParseResults["results = await page.evaluate()"]
CheckFailures["if results.failed > 0: raise AssertionError"]

RecordResult --> ResultsArray
RecordResult --> ResultsTable
TestMethods --> RenderSummary
GlobalResults --> PlaywrightWait

subgraph subGraph3 ["Playwright Integration"]
    PlaywrightWait
    ParseResults
    CheckFailures
    PlaywrightWait --> ParseResults
    ParseResults --> CheckFailures
end

subgraph subGraph2 ["Summary Generation"]
    RenderSummary
    GlobalResults
    CustomEvent
    RenderSummary --> GlobalResults
    RenderSummary --> CustomEvent
end

subgraph subGraph1 ["Result Storage"]
    ResultsArray
    ResultsTable
end

subgraph subGraph0 ["Test Execution"]
    RunMethod
    TestMethods
    RecordResult
    RunMethod --> TestMethods
    TestMethods --> RecordResult
end
```

**Test Result Object Structure**

Each test result is stored with detailed information:

```yaml
{
    name: "应用初始化状态",           // Test name
    passed: true,                    // Pass/fail status
    details: {                       // Additional details
        activeView: "overview-view",
        activeNav: "overview",
        appInitialized: true
    }
}
```

The final summary object exposed to Playwright:

```yaml
window.__E2E_TEST_RESULTS__ = {
    total: 15,                       // Total test count
    passed: 14,                      // Passed count
    failed: 1,                       // Failed count
    proxyConfig: {...},              // Test configuration
    results: [...]                   // Full results array
}
```

This structure allows Playwright to programmatically validate test outcomes and fail the CI pipeline if any E2E tests fail.

Sources: [developer/tests/js/e2e/appE2ETest.js L122-L162](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L122-L162)

 [developer/tests/js/e2e/appE2ETest.js L233-L258](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/appE2ETest.js#L233-L258)

 [developer/tests/e2e/playwright_index_clickthrough.py L245-L267](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/playwright_index_clickthrough.py#L245-L267)

## Static Analysis & CI Validation

The static analysis suite provides structural validation without requiring a browser, making it ideal for CI pipelines and pre-commit hooks.

**Static Analysis Suite Architecture**

```mermaid
flowchart TD

RunStatic["run_static_suite.py<br>Main entry point"]
ConfigLoad["Load test configuration"]
ParseIndex["Parse index.html"]
ExtractNavButtons["Extract nav buttons<br>data-view attributes"]
ExtractSettingsButtons["Extract settings buttons<br>by ID"]
CompareConfig["Compare with interactionTargets.js"]
DetectMissing["Report missing/extra buttons"]
ParseJS["Parse JS files with AST"]
ExtractFunctions["Extract function bodies"]
CheckPatterns["Check for forbidden patterns"]
ValidateDialogs["Validate confirm() usage"]
CheckPathLogic["Validate path resolution logic"]
ParseExamData["Parse complete-exam-data.js<br>listening-exam-data.js"]
CheckPathRoot["Verify pathRoot presence"]
ValidateStructure["Validate exam structure"]
LoadContract["Load exam_app_method_contract.json"]
CheckMixins["Check mixin method existence"]
ValidateSignatures["Validate method signatures"]
ReportViolations["Report contract violations"]
AggregateResults["Aggregate all validation results"]
GenerateJSON["Generate static-ci-report.json"]
ExitCode["Return exit code (0=pass, 1=fail)"]

ConfigLoad --> ParseIndex
ConfigLoad --> ParseJS
ConfigLoad --> ParseExamData
ConfigLoad --> LoadContract
DetectMissing --> AggregateResults
CheckPathLogic --> AggregateResults
ValidateStructure --> AggregateResults
ReportViolations --> AggregateResults

subgraph subGraph5 ["Report Generation"]
    AggregateResults
    GenerateJSON
    ExitCode
    AggregateResults --> GenerateJSON
    GenerateJSON --> ExitCode
end

subgraph subGraph4 ["Contract Validation"]
    LoadContract
    CheckMixins
    ValidateSignatures
    ReportViolations
    LoadContract --> CheckMixins
    CheckMixins --> ValidateSignatures
    ValidateSignatures --> ReportViolations
end

subgraph subGraph3 ["Metadata Validation"]
    ParseExamData
    CheckPathRoot
    ValidateStructure
    ParseExamData --> CheckPathRoot
    CheckPathRoot --> ValidateStructure
end

subgraph subGraph2 ["JavaScript Analysis"]
    ParseJS
    ExtractFunctions
    CheckPatterns
    ValidateDialogs
    CheckPathLogic
    ParseJS --> ExtractFunctions
    ExtractFunctions --> CheckPatterns
    CheckPatterns --> ValidateDialogs
    ValidateDialogs --> CheckPathLogic
end

subgraph subGraph1 ["HTML Structure Validation"]
    ParseIndex
    ExtractNavButtons
    ExtractSettingsButtons
    CompareConfig
    DetectMissing
    ParseIndex --> ExtractNavButtons
    ExtractNavButtons --> ExtractSettingsButtons
    ExtractSettingsButtons --> CompareConfig
    CompareConfig --> DetectMissing
end

subgraph subGraph0 ["Static Suite Entry"]
    RunStatic
    ConfigLoad
    RunStatic --> ConfigLoad
end
```

**Static Analysis Checks**

| Check Category | Validation Focus | Example Failures |
| --- | --- | --- |
| **Structure Checks** | HTML element presence and consistency | Missing navigation buttons, incorrect data attributes |
| **JavaScript Checks** | Code pattern validation | Forbidden `confirm()` dialogs, incorrect path construction |
| **Metadata Checks** | Exam data completeness | Missing `pathRoot`, malformed exam objects |
| **Contract Checks** | Mixin method existence | Missing required methods like `openExam()`, `navigateToView()` |

**HTML Structure Parsing Example**

The static suite parses `index.html` to extract button definitions:

```sql
# Extract navigation buttons
nav_buttons = soup.select('nav.main-nav button[data-view]')
found_views = {btn['data-view'] for btn in nav_buttons}

# Extract settings buttons
settings_buttons = soup.select('#settings-view button[id]')
found_button_ids = {btn['id'] for btn in settings_buttons}

# Compare with test configuration
expected_views = set(interaction_targets['mainNavigationViews'])
expected_buttons = set(interaction_targets['settingsButtonIds'])

missing_views = expected_views - found_views
extra_views = found_views - expected_views
```

This ensures that test configuration stays synchronized with actual HTML structure, preventing test coverage gaps.

**JavaScript Pattern Detection**

The suite uses AST parsing to detect anti-patterns:

```css
# Check for forbidden confirm() dialogs
if re.search(r'\bconfirm\s*\(', function_body):
    violations.append({
        'file': file_path,
        'function': function_name,
        'pattern': 'confirm() dialog',
        'recommendation': 'Use modal component instead'
    })
```

This catches usability issues (browser-native dialogs) that should use custom UI components.

**Contract Validation**

The `exam_app_method_contract.json` file defines required methods for each mixin:

```json
{
    "stateMixin": ["getState", "setState", "loadPersistedState"],
    "navigationMixin": ["navigateToView", "showView"],
    "examSessionMixin": ["openExam", "startPracticeSession"]
}
```

The static suite validates that these methods exist in the corresponding mixin files, ensuring architectural contracts are maintained during refactoring.

Sources: [developer/docs/optimization-task-tracker.md L17](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L17-L17)

 [developer/tests/ci/run_static_suite.py](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/ci/run_static_suite.py)

 [developer/docs/optimization-task-tracker.md L224-L244](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L224-L244)

 [developer/docs/optimization-task-tracker.md L572-L573](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L572-L573)

## Test Fixtures and Data

Test fixtures provide deterministic, reproducible test data and content for both E2E and static tests.

**Test Fixture Architecture**

```mermaid
flowchart TD

FixtureDir["templates/ci-practice-fixtures/"]
AnalysisFear["analysis-of-fear.html<br>Complete practice template"]
Enhancer["Contains practicePageEnhancer<br>Data collection script"]
SubmitFlow["PRACTICE_COMPLETE message flow"]
PathDir["fixtures/<br>Non-ASCII test files"]
ChineseFiles["Chinese character paths"]
SpecialChars["Special symbol directories"]
PathIndex["fixtures/index.html<br>Test entry point"]
SnapshotJS["indexSnapshot.js<br>Offline test data"]
SnapshotHTML["window.APP_INDEX_HTML_SNAPSHOT<br>Complete index.html content"]
SnapshotPurpose["Enables offline E2E testing<br>Deterministic structure"]
E2ETests["AppE2ETestSuite"]
PathTests["path_compatibility_playwright.py"]
StaticTests["run_static_suite.py"]

SubmitFlow --> E2ETests
PathIndex --> PathTests
SnapshotPurpose --> E2ETests
SnapshotHTML --> StaticTests

subgraph subGraph3 ["Test Usage"]
    E2ETests
    PathTests
    StaticTests
end

subgraph subGraph2 ["Index Snapshot"]
    SnapshotJS
    SnapshotHTML
    SnapshotPurpose
    SnapshotJS --> SnapshotHTML
    SnapshotHTML --> SnapshotPurpose
end

subgraph subGraph1 ["Path Compatibility Fixtures"]
    PathDir
    ChineseFiles
    SpecialChars
    PathIndex
    PathDir --> ChineseFiles
    PathDir --> SpecialChars
    PathDir --> PathIndex
end

subgraph subGraph0 ["Practice Fixtures"]
    FixtureDir
    AnalysisFear
    Enhancer
    SubmitFlow
    FixtureDir --> AnalysisFear
    AnalysisFear --> Enhancer
    Enhancer --> SubmitFlow
end
```

**Practice Template Structure**

The `analysis-of-fear.html` fixture provides a complete practice exam template:

```typescript
<!-- Practice page with data collection -->
<script src="../../js/practice-page-enhancer.js"></script>

<!-- Exam content -->
<form id="exam-form">
    <!-- Questions and answers -->
</form>

<!-- Data collection integration -->
<script>
    // Listen for INIT_SESSION from parent window
    window.addEventListener('message', function(event) {
        if (event.data.type === 'INIT_SESSION') {
            // Initialize session
            window.postMessage({ type: 'SESSION_READY', data: {...} }, '*');
        }
    });
    
    // On submission, send PRACTICE_COMPLETE
    function submitExam() {
        window.postMessage({ 
            type: 'PRACTICE_COMPLETE', 
            data: { answers: {...}, duration: 300 } 
        }, '*');
    }
</script>
```

This template enables testing the complete practice submission pipeline including cross-window messaging and data collection.

**Index Snapshot for Offline Testing**

The `indexSnapshot.js` file contains a complete copy of `index.html` as a JavaScript string:

```html
window.__APP_INDEX_HTML_SNAPSHOT__ = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <base href="../../">
    <!-- Complete index.html content -->
</head>
<body>
    <!-- Full application structure -->
</body>
</html>`;
```

This allows E2E tests to load a known-good version of the application structure without external dependencies, ensuring test stability even as `index.html` evolves.

**Path Compatibility Fixture Structure**

The path compatibility fixtures mirror production directory structures but use challenging file names:

```markdown
fixtures/
├── index.html                          # Test entry point
├── Reading/
│   ├── 剑桥雅思8-Test1/                # Chinese characters
│   │   ├── 阅读P1.html
│   │   └── 阅读P2.html
│   └── Special!@#Characters/           # Special symbols
│       └── test.html
└── Listening/
    └── 剑15-Test3/
        └── 听力.html
```

These fixtures ensure the path resolution system handles non-ASCII characters correctly across different operating systems and browsers.

Sources: [developer/docs/optimization-task-tracker.md L145-L152](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L145-L152)

 [developer/tests/js/e2e/indexSnapshot.js L1-L409](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/js/e2e/indexSnapshot.js#L1-L409)

 [developer/docs/optimization-task-tracker.md L216-L217](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/optimization-task-tracker.md#L216-L217)

## Development Setup Recommendations

Based on the configuration analysis, the development environment should include:

| Component | Configuration | Purpose |
| --- | --- | --- |
| IDE Support | VS Code + Custom tools | Multi-editor development workflow |
| Documentation | Auto-generation to `/docs/` | Automated documentation pipeline |
| Build Tools | Local `/tools/` directory | Development automation and build scripts |
| Cross-Platform | File exclusion patterns | Support for macOS and Windows development |

This configuration supports a flexible development environment with multiple toolchains while maintaining a clean version control history by excluding generated content and personal configuration files.

Sources: [.gitignore L1-L11](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.gitignore#L1-L11)