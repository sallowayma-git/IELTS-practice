# Suite Practice Mode

> **Relevant source files**
> * [js/app/examSessionMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/examSessionMixin.js)
> * [js/app/suitePracticeMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js)
> * [js/practice-page-enhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/practice-page-enhancer.js)
> * [js/services/GlobalStateService.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/services/GlobalStateService.js)
> * [js/utils/answerComparisonUtils.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/answerComparisonUtils.js)

## Purpose and Scope

This document describes the suite practice mode system, which enables users to practice multiple IELTS exams in sequence or as a batch. The system supports two distinct modes:

1. **Sequential Suite Mode**: Automatically opens P1, P2, P3 reading exams one after another in the same window/tab
2. **Multi-Suite Mode**: Handles HTML pages containing multiple test sets on a single page (e.g., "100 Listening P1" pages with 10 practice tests)

For information about single exam practice sessions, see [Practice Session Lifecycle & Management](/sallowayma-git/IELTS-practice/5.1-practice-session-lifecycle-and-management). For cross-window communication protocols, see [Cross-Window Communication Protocol](/sallowayma-git/IELTS-practice/5.3-cross-window-communication-protocol).

---

## Suite Practice Concepts

### Sequential Suite Mode

Sequential suite mode randomly selects one exam from each category (P1, P2, P3) and presents them in sequence within a single browser tab. After completing each exam, the window navigates to the next exam automatically.

**Key characteristics:**

* One window reused across all three exams
* Sequential progression: P1 → P2 → P3
* Automatic navigation between exams
* Single aggregated record saved at completion
* Window close guards prevent accidental exit

### Multi-Suite Mode

Multi-suite mode handles HTML pages that contain multiple complete practice tests on a single page. Each test is called a "suite" and has its own set of questions with a dedicated submit button.

**Key characteristics:**

* Multiple independent test sets on one HTML page
* Each suite submits separately via `PRACTICE_COMPLETE` message
* Results aggregated when all suites complete
* Suite ID used to distinguish and track each test
* Common in "100 Listening" practice pages

**Sources:** [js/app/suitePracticeMixin.js L1-L1344](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L1-L1344)

---

## Suite Practice Data Structures

### Sequential Suite Session

```mermaid
flowchart TD

SessionID["id: suite_timestamp_random"]
Status["status: 'initializing' | 'active' | 'finalizing' | 'completed'"]
StartTime["startTime: timestamp"]
Sequence["sequence: [{examId, exam}, ...]"]
CurrentIndex["currentIndex: number"]
Results["results: [normalizedResult, ...]"]
WindowRef["windowRef: Window"]
WindowName["windowName: 'ielts-suite-mode-tab'"]
ActiveExamId["activeExamId: string"]
MapEntries["examId → suiteSessionId"]

Sequence -.-> MapEntries

subgraph subGraph1 ["suiteExamMap (Map)"]
    MapEntries
end

subgraph subGraph0 ["currentSuiteSession Object"]
    SessionID
    Status
    StartTime
    Sequence
    CurrentIndex
    Results
    WindowRef
    WindowName
    ActiveExamId
    SessionID -.-> Status
    Status -.->|"registers"| StartTime
    StartTime -.-> Sequence
    Sequence -.-> CurrentIndex
    CurrentIndex -.-> Results
    Results -.-> WindowRef
    WindowRef -.-> WindowName
    WindowName -.-> ActiveExamId
end
```

**Sources:** [js/app/suitePracticeMixin.js L78-L89](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L78-L89)

 [js/app/suitePracticeMixin.js L789-L796](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L789-L796)

### Multi-Suite Session

```mermaid
flowchart TD

BaseExamId["baseExamId: string (key)"]
SessionObj["session object"]
ID["id: generated session ID"]
BaseExam["baseExamId: string"]
Status2["status: 'active' | 'finalizing' | 'completed'"]
StartTime2["startTime: timestamp"]
SuiteResults["suiteResults: [suiteResult, ...]"]
ExpectedCount["expectedSuiteCount: number"]
LastUpdate["lastUpdate: timestamp"]
Metadata["metadata: {source, ...}"]
SuiteId["suiteId: string"]
ExamId2["examId: string"]
Answers["answers: {}"]
CorrectAnswers["correctAnswers: {}"]
AnswerComparison["answerComparison: {}"]
ScoreInfo["scoreInfo: {correct, total, accuracy, percentage}"]
SpellingErrors["spellingErrors: []"]
Duration["duration: number"]
Timestamp["timestamp: number"]
RawData["rawData: original payload"]

SessionObj -.-> ID
SuiteResults -.-> SuiteId

subgraph subGraph2 ["Each suiteResult"]
    SuiteId
    ExamId2
    Answers
    CorrectAnswers
    AnswerComparison
    ScoreInfo
    SpellingErrors
    Duration
    Timestamp
    RawData
    SuiteId -.-> ExamId2
    ExamId2 -.-> Answers
    Answers -.-> CorrectAnswers
    CorrectAnswers -.-> AnswerComparison
    AnswerComparison -.-> ScoreInfo
    ScoreInfo -.-> SpellingErrors
    SpellingErrors -.-> Duration
    Duration -.-> Timestamp
    Timestamp -.-> RawData
end

subgraph subGraph1 ["Multi-Suite Session Object"]
    ID
    BaseExam
    Status2
    StartTime2
    SuiteResults
    ExpectedCount
    LastUpdate
    Metadata
    ID -.->|"contains"| BaseExam
    BaseExam -.-> Status2
    Status2 -.-> StartTime2
    StartTime2 -.-> SuiteResults
    SuiteResults -.-> ExpectedCount
    ExpectedCount -.-> LastUpdate
    LastUpdate -.-> Metadata
end

subgraph subGraph0 ["multiSuiteSessionsMap Entry"]
    BaseExamId
    SessionObj
    BaseExamId -.-> SessionObj
end
```

**Sources:** [js/app/suitePracticeMixin.js L14](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L14-L14)

 [js/app/suitePracticeMixin.js L1114-L1136](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L1114-L1136)

---

## Sequential Suite Practice Lifecycle

### Initialization and Startup

The sequential suite practice begins when `startSuitePractice()` is invoked, typically by the user clicking a "开始套题练习" button.

```mermaid
sequenceDiagram
  participant p1 as User
  participant p2 as ExamSystemApp<br/>(suitePracticeMixin)
  participant p3 as Suite Session State
  participant p4 as examSessionMixin
  participant p5 as Suite Window

  p1->>p2: Click "开始套题练习"
  p2->>p2: startSuitePractice()
  p2->>p2: _fetchSuiteExamIndex()
  p2->>p2: Filter reading exams by category
  p2->>p2: Random select P1, P2, P3
  p2->>p2: _generateSuiteSessionId()
  p2->>p3: Create currentSuiteSession
  note over p3: status='initializing'<br/>sequence=[P1, P2, P3]<br/>currentIndex=0
  p2->>p2: _registerSuiteSequence(session)<br/>openExam(firstExamId, {<br/>target: 'tab',<br/>windowName: 'ielts-suite-mode-tab',<br/>suiteSessionId: sessionId,<br/>sequenceIndex: 0
  note over p2: suiteExamMap.set(examId, sessionId)
  p2->>p4: })
  p4->>p5: Open exam window
  p4->>p5: Inject practice-page-enhancer.js
  p4->>p5: postMessage('INIT_SESSION')
  p5->>p4: postMessage('SESSION_READY')
  p2->>p3: session.status = 'active'
  p2->>p3: session.activeExamId = firstExamId
  p2->>p2: _ensureSuiteWindowGuard(session, window)
```

**Sources:** [js/app/suitePracticeMixin.js L20-L125](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L20-L125)

 [js/app/suitePracticeMixin.js L766-L782](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L766-L782)

 [js/app/suitePracticeMixin.js L788-L796](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L788-L796)

### Suite Practice Completion and Navigation

When a user completes an exam in the suite, the system receives a `PRACTICE_COMPLETE` message. The `handleSuitePracticeComplete()` function processes this and either navigates to the next exam or finalizes the suite record.

```mermaid
flowchart TD

Start["PRACTICE_COMPLETE message received"]
CheckSuite["handleSuitePracticeComplete(examId, data)"]
HasSuiteId["data.suiteId exists?"]
MultiSuite["handleMultiSuitePracticeComplete()"]
ValidateSession["Session valid?"]
ReturnFalse["return false"]
CheckDuplicate["Already recorded?"]
ReturnTrue["return true"]
NormalizeResult["_normalizeSuiteResult(exam, data)"]
AddResult["session.results.push(normalized)"]
UpdateIndex["session.currentIndex++"]
CleanupSession["cleanupExamSession(examId)"]
HasNext["currentIndex < sequence.length?"]
Finalize["finalizeSuiteRecord(session)"]
GetNext["nextEntry = sequence[currentIndex]"]
UpdateActive["session.activeExamId = nextEntry.examId"]
AttemptOpen["openExam(nextEntry.examId, {<br>target: 'tab',<br>windowName: windowName,<br>reuseWindow: session.windowRef,<br>suiteSessionId: session.id,<br>sequenceIndex: currentIndex<br>})"]
OpenSuccess["Window opened?"]
AbortSuite["_abortSuiteSession(session)"]
UpdateWindowRef["session.windowRef = nextWindow"]
InstallGuards["_ensureSuiteWindowGuard(session, window)"]
FocusWindow["_focusSuiteWindow(window)"]
ShowMessage["showMessage('已完成 X，继续下一篇')"]
ReturnTrue2["return true"]
End["End"]

Start -.->|"No"| CheckSuite
CheckSuite -.->|"Valid"| HasSuiteId
HasSuiteId -.->|"Invalid"| MultiSuite
HasSuiteId -.->|"No"| ValidateSession
ValidateSession -.->|"Yes"| ReturnFalse
ValidateSession -.-> CheckDuplicate
CheckDuplicate -.->|"Yes"| ReturnTrue
CheckDuplicate -.-> NormalizeResult
NormalizeResult -.-> AddResult
AddResult -.-> UpdateIndex
UpdateIndex -.-> CleanupSession
CleanupSession -.-> HasNext
HasNext -.->|"No"| Finalize
HasNext -.->|"Yes"| GetNext
GetNext -.-> UpdateActive
UpdateActive -.->|"No"| AttemptOpen
AttemptOpen -.-> OpenSuccess
OpenSuccess -.-> AbortSuite
OpenSuccess -.-> UpdateWindowRef
UpdateWindowRef -.-> InstallGuards
InstallGuards -.-> FocusWindow
FocusWindow -.-> ShowMessage
ShowMessage -.-> ReturnTrue2
Finalize -.-> End
ReturnFalse -.-> End
ReturnTrue -.-> End
ReturnTrue2 -.-> End
AbortSuite -.-> End
MultiSuite -.-> End
```

**Sources:** [js/app/suitePracticeMixin.js L127-L242](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L127-L242)

### Result Normalization

The `_normalizeSuiteResult()` function standardizes result data from each exam before adding it to the suite session.

| Field | Source | Fallback |
| --- | --- | --- |
| `correct` | `rawData.scoreInfo.correct` | 0 |
| `total` | `rawData.scoreInfo.total` | `Object.keys(answers).length` |
| `accuracy` | `rawData.scoreInfo.accuracy` | `correct / total` |
| `percentage` | `rawData.scoreInfo.percentage` | `accuracy * 100` |
| `duration` | `rawData.duration` | 0 |
| `answers` | `rawData.answers` | `{}` |
| `answerComparison` | `rawData.answerComparison` | `scoreInfo.details` or `{}` |

**Sources:** [js/app/suitePracticeMixin.js L814-L866](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L814-L866)

---

## Multi-Suite Practice Flow

### Detection and Session Creation

Multi-suite mode is detected when `practicePageEnhancer` finds a page structure indicating multiple test sets, or when the `PRACTICE_COMPLETE` payload includes a `suiteId` field.

```

```

**Sources:** [js/app/suitePracticeMixin.js L244-L319](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L244-L319)

 [js/app/suitePracticeMixin.js L1110-L1160](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L1110-L1160)

### Suite Count Detection

The system attempts to determine how many suites are expected on a page using multiple strategies:

```mermaid
flowchart TD

Start["_detectExpectedSuiteCount(examId, suiteData)"]
CheckPayload["suiteData.totalSuites<br>is finite?"]
UsePayload["return suiteData.totalSuites"]
CheckMetadata["suiteData.metadata.totalSuites<br>exists?"]
UseMetadata["return Number(metadata.totalSuites)"]
InferFromExamId["examId contains '100'<br>and ('p1' or 'p4')?"]
Default10["return 10"]
Default1["return 1"]
End["End"]

Start -.->|"No"| CheckPayload
CheckPayload -.->|"Yes"| UsePayload
CheckPayload -.->|"No"| CheckMetadata
CheckMetadata -.->|"Yes"| UseMetadata
CheckMetadata -.->|"Yes"| InferFromExamId
InferFromExamId -.->|"No"| Default10
InferFromExamId -.-> Default1
UsePayload -.-> End
UseMetadata -.-> End
Default10 -.-> End
Default1 -.-> End
```

**Sources:** [js/app/suitePracticeMixin.js L321-L349](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L321-L349)

### Completion Detection

Multi-suite completion is determined by comparing the number of submitted suites against the expected count:

```mermaid
flowchart TD

Start["isMultiSuiteComplete(session)"]
HasExpected["expectedSuiteCount exists?"]
Compare["suiteResults.length >= expectedSuiteCount"]
DefaultComplete["suiteResults.length >= 1"]
Result["return boolean"]

Start -.-> HasExpected
HasExpected -.->|"Yes"| Compare
HasExpected -.->|"No"| DefaultComplete
Compare -.-> Result
DefaultComplete -.-> Result
```

**Sources:** [js/app/suitePracticeMixin.js L1162-L1180](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L1162-L1180)

---

## Suite Guards and Window Management

Suite guards prevent users from accidentally closing the exam window during suite practice, which would interrupt the flow and lose progress.

### Guard Installation

Guards are installed when a suite session becomes active:

```mermaid
flowchart TD

GuardCheck["installSuiteGuards() called"]
SaveNative["Save native window.close()"]
OverrideClose["window.close = guardedClose"]
GuardedFn["guardedClose() sends<br>SUITE_CLOSE_ATTEMPT<br>message instead"]
OverrideOpen["window.open() checks target"]
BlockSelf["Block _self, _parent, _top targets"]

subgraph subGraph0 ["Inline Script Suite Guards"]
    GuardCheck
    SaveNative
    OverrideClose
    GuardedFn
    OverrideOpen
    BlockSelf
    GuardCheck -.-> SaveNative
    SaveNative -.-> OverrideClose
    OverrideClose -.-> GuardedFn
    OverrideClose -.-> OverrideOpen
    OverrideOpen -.-> BlockSelf
end
```

The inline script in `injectInlineScript()` implements suite guards for fallback scenarios:

**Key functions:**

* `installSuiteGuards()`: Replaces `window.close()` and intercepts `window.open()` [js/app/examSessionMixin.js L638-L701](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/examSessionMixin.js#L638-L701)
* `teardownSuiteGuards()`: Restores native functions when suite completes [js/app/examSessionMixin.js L703-L721](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/examSessionMixin.js#L703-L721)
* `notifySuiteCloseAttempt(reason)`: Sends `SUITE_CLOSE_ATTEMPT` message to main window [js/app/examSessionMixin.js L626-L636](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/examSessionMixin.js#L626-L636)

**Guard behavior:**

1. `window.close()` calls send `SUITE_CLOSE_ATTEMPT` message instead of closing
2. `window.open()` with self-targeting (`_self`, `_parent`, `_top`) is blocked
3. Main window can force close via `SUITE_FORCE_CLOSE` message
4. Guards are removed after suite completes or is aborted

**Sources:** [js/app/examSessionMixin.js L638-L721](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/examSessionMixin.js#L638-L721)

 [js/app/suitePracticeMixin.js L1234-L1280](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L1234-L1280)

### Window Reacquisition

If the suite window reference is lost (e.g., user manually navigates), the system attempts to reacquire it:

```mermaid
flowchart TD

Start["Need to open next exam"]
HasRef["session.windowRef<br>exists and not closed?"]
ReuseWindow["attemptOpen(reuseWindow)"]
CheckName["windowName exists?"]
Success1["Opened successfully?"]
Done["Use returned window"]
Reacquire["_reacquireSuiteWindow(windowName) or<br>_openNamedSuiteWindow(windowName)"]
Abort["_abortSuiteSession(session)"]
AttemptFallback["attemptOpen(fallbackWindow)"]
Success2["Opened successfully?"]
End["End"]

Start -.-> HasRef
HasRef -.->|"Yes"| ReuseWindow
HasRef -.->|"No"| CheckName
ReuseWindow -.->|"No"| Success1
Success1 -.->|"Yes"| Done
Success1 -.->|"Yes"| CheckName
CheckName -.->|"No"| Reacquire
CheckName -.->|"No"| Abort
Reacquire -.->|"Yes"| AttemptFallback
AttemptFallback -.-> Success2
Success2 -.-> Done
Success2 -.-> Abort
Done -.-> End
Abort -.-> End
```

**Sources:** [js/app/suitePracticeMixin.js L186-L238](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L186-L238)

---

## Result Aggregation

### Sequential Suite Aggregation

When all exams in a sequential suite are completed, `finalizeSuiteRecord()` aggregates the results:

```mermaid
flowchart TD

Start["finalizeSuiteRecord(session)"]
SetStatus["session.status = 'finalizing'"]
BuildEntries["Map session.results to suiteEntries[]"]
CalcDuration["Calculate total duration<br>(summed or elapsed time)"]
CalcScores["Aggregate scores:<br>totalCorrect = sum(correct)<br>totalQuestions = sum(total)"]
CalcAccuracy["accuracy = totalCorrect / totalQuestions<br>percentage = round(accuracy * 100)"]
AggregateAnswers["aggregatedAnswers = {}<br>Prefix each answer with examId"]
AggregateComparison["aggregatedComparison = {}<br>Prefix each comparison with examId"]
ResolveSequence["_resolveSuiteSequenceNumber(startTime)"]
FormatDate["_formatSuiteDateLabel(startTime)"]
BuildRecord["Build complete record object"]
SaveRecord["_saveSuitePracticeRecord(record)"]
CleanupSubRecords["_cleanupSuiteEntryRecords(record)"]
UpdateState["_updatePracticeRecordsState()"]
RefreshUI["refreshOverviewData()"]
TeardownSession["_teardownSuiteSession(session)"]
SetComplete["session.status = 'completed'"]
End["End"]

Start -.-> SetStatus
SetStatus -.-> BuildEntries
BuildEntries -.-> CalcDuration
CalcDuration -.-> CalcScores
CalcScores -.-> CalcAccuracy
CalcAccuracy -.-> AggregateAnswers
AggregateAnswers -.-> AggregateComparison
AggregateComparison -.-> ResolveSequence
ResolveSequence -.-> FormatDate
FormatDate -.-> BuildRecord
BuildRecord -.-> SaveRecord
SaveRecord -.-> CleanupSubRecords
CleanupSubRecords -.-> UpdateState
UpdateState -.-> RefreshUI
RefreshUI -.-> TeardownSession
TeardownSession -.-> SetComplete
SetComplete -.-> End
```

**Aggregated record structure:**

| Field | Content |
| --- | --- |
| `id` | `session.id` |
| `examId` | `"suite-{session.id}"` |
| `title` | `"{date}套题练习{sequence}"` (e.g., "12月25日套题练习1") |
| `type` | `"reading"` |
| `suiteMode` | `true` |
| `duration` | Sum of all exam durations or elapsed time |
| `totalQuestions` | Sum of all questions |
| `correctAnswers` | Sum of correct answers |
| `accuracy` | Overall accuracy (0-1) |
| `percentage` | Overall percentage (0-100) |
| `answers` | `{examId::questionId: answer}` format |
| `answerComparison` | `{examId::questionId: comparison}` format |
| `suiteEntries` | Array of individual exam results |

**Sources:** [js/app/suitePracticeMixin.js L643-L764](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L643-L764)

### Multi-Suite Aggregation

Multi-suite aggregation combines results from multiple test sets on a single page:

```mermaid
flowchart TD

Start["finalizeMultiSuiteRecord(session)"]
SetFinalizing["session.status = 'finalizing'"]
AggregateScores["aggregateScores(session.suiteResults)"]
AggregateAnswers["aggregateAnswers(session.suiteResults)"]
AggregateComparison["aggregateAnswerComparisons(session.suiteResults)"]
AggregateSpelling["aggregateSpellingErrors(session.suiteResults)"]
CalcDuration["totalDuration = sum(suite.duration)"]
FormatDate["dateLabel = _formatSuiteDateLabel(startTime)"]
BuildTitle["title = '{date} {source} 多套题练习'"]
BuildRecord["Build aggregated record:<br>- suiteEntries: individual suites<br>- metadata.suiteCount<br>- realData with aggregated scores"]
SaveRecord["_saveSuitePracticeRecord(record)"]
SaveSpelling["Save spelling errors to vocabulary"]
UpdateState["_updatePracticeRecordsState()"]
RefreshUI["refreshOverviewData()"]
CleanupSession["multiSuiteSessionsMap.delete(baseExamId)"]
SetComplete["session.status = 'completed'"]
ShowMessage["showMessage('多套题练习已完成！')"]
End["End"]

Start -.-> SetFinalizing
SetFinalizing -.-> AggregateScores
AggregateScores -.-> AggregateAnswers
AggregateAnswers -.-> AggregateComparison
AggregateComparison -.-> AggregateSpelling
AggregateSpelling -.-> CalcDuration
CalcDuration -.-> FormatDate
FormatDate -.-> BuildTitle
BuildTitle -.-> BuildRecord
BuildRecord -.-> SaveRecord
SaveRecord -.-> SaveSpelling
SaveSpelling -.-> UpdateState
UpdateState -.-> RefreshUI
RefreshUI -.-> CleanupSession
CleanupSession -.-> SetComplete
SetComplete -.-> ShowMessage
ShowMessage -.-> End
```

**Score aggregation:**

* `correct`: Sum of all suite correct counts
* `total`: Sum of all suite question counts
* `accuracy`: `correct / total`
* `percentage`: `round(accuracy * 100)`

**Answer aggregation:**

* Keys use format: `{suiteId}::{questionId}`
* Handles pre-prefixed keys from child pages
* Preserves all question-answer mappings

**Spelling error aggregation:**

* Deduplicates by word (case-insensitive)
* Increments `errorCount` for repeated errors
* Preserves most recent `userInput` and `timestamp`

**Sources:** [js/app/suitePracticeMixin.js L351-L489](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L351-L489)

 [js/app/suitePracticeMixin.js L491-L641](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L491-L641)

---

## Practice Page Enhancer Support

The `practicePageEnhancer` detects and supports suite modes through mixins:

### Listening Suite Mixin

```

```

**Mixin priorities:**

* `listening-suite-practice`: Priority 30
* `standard-inline-practice`: Priority 5

Higher priority mixins are applied first.

**Sources:** [js/practice-page-enhancer.js L222-L272](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/practice-page-enhancer.js#L222-L272)

 [js/practice-page-enhancer.js L154-L192](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/practice-page-enhancer.js#L154-L192)

### Multi-Suite Detection

The enhancer detects multi-suite pages during initialization:

```

```

**Sources:** [js/practice-page-enhancer.js L1007-L1108](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/practice-page-enhancer.js#L1007-L1108)

---

## Suite Record Cleanup

After saving a suite record, the system removes individual exam records to avoid duplication:

```mermaid
flowchart TD

Start["_cleanupSuiteEntryRecords(record)"]
ExtractIds["Extract from suiteEntries:<br>- examIds<br>- sessionIds<br>- timestamps"]
CalcReference["Calculate reference time<br>(average of entry timestamps)"]
DefineWindow["Define time window:<br>±10 minutes from reference"]
FilterRecords["Filter practice_records:<br>Keep if NOT matching entry"]
Criteria["Match criteria:<br>1. sessionId matches entry<br>2. examId + time within window"]
KeepSuite["Always keep suite record itself<br>(by sessionId)"]
RemoveMatches["Remove matched entry records"]
SaveFiltered["Save filtered practice_records"]
LogCount["Log cleanup count"]
End["End"]

Start -.-> ExtractIds
ExtractIds -.-> CalcReference
CalcReference -.-> DefineWindow
DefineWindow -.-> FilterRecords
FilterRecords -.-> Criteria
Criteria -.-> KeepSuite
KeepSuite -.-> RemoveMatches
RemoveMatches -.-> SaveFiltered
SaveFiltered -.-> LogCount
LogCount -.-> End
```

This prevents the UI from showing both the aggregated suite record and the individual exam records.

**Sources:** [js/app/suitePracticeMixin.js L905-L996](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L905-L996)

---

## Error Handling and Abort

### Abort Scenarios

Suite sessions can be aborted in several scenarios:

| Scenario | Trigger | Action |
| --- | --- | --- |
| Startup failure | `startSuitePractice()` throws | Abort via `_abortSuiteSession()` |
| Window unavailable | Cannot open next exam window | Abort with reason `'open_next_failed'` |
| Missing sequence | Exam not found in sequence | Abort with reason `'missing_sequence'` |
| System error | `openExam` function missing | Abort with reason `'missing_open_exam'` |

### Abort Flow

```mermaid
sequenceDiagram
  participant p1 as Trigger
  participant p2 as ExamSystemApp
  participant p3 as Suite Session
  participant p4 as Suite Window
  participant p5 as Storage

  p1->>p2: Error detected
  p2->>p2: _abortSuiteSession(session, {reason})
  p2->>p3: Set status = 'aborted'
  p2->>p3: Clear suiteExamMap entries
  opt skipExamId not provided
    p2->>p5: Load practice_records
    p2->>p5: Remove incomplete entry records
    p2->>p5: Save cleaned records
  end
  p2->>p4: Check if window still open
  alt Window is open
    p2->>p4: postMessage('SUITE_FORCE_CLOSE')
  end
  p2->>p2: _teardownSuiteSession(session)
  p2->>p3: currentSuiteSession = null
  p2->>p2: showMessage('套题已中止')
```

**Sources:** [js/app/suitePracticeMixin.js L1282-L1344](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L1282-L1344)

---

## Integration with PracticeRecorder

Suite records are saved through the `PracticeRecorder` service when available:

```mermaid
flowchart TD

Start["_saveSuitePracticeRecord(record)"]
CheckRecorder["PracticeRecorder<br>available?"]
UsePR["practiceRecorder.savePracticeRecord(record)"]
UseFallback["_saveSuitePracticeRecordFallback(record)"]
SaveSuccess["Success?"]
Cleanup["_cleanupSuiteEntryRecords(record)"]
Fallback["Try fallback storage"]
DirectStorage["Load practice_records from storage"]
Prepend["Prepend new record"]
TrimList["Trim to MAX_LEGACY_PRACTICE_RECORDS<br>(1000 records)"]
SaveStorage["Save to storage"]
End["End"]

Start -.->|"Yes"| CheckRecorder
CheckRecorder -.->|"No"| UsePR
CheckRecorder -.->|"No"| UseFallback
UsePR -.-> SaveSuccess
SaveSuccess -.->|"Yes"| Cleanup
SaveSuccess -.-> Fallback
Fallback -.-> UseFallback
UseFallback -.-> DirectStorage
DirectStorage -.-> Prepend
DirectStorage -.-> TrimList
TrimList -.-> SaveStorage
SaveStorage -.-> Cleanup
Cleanup -.-> End
```

**Sources:** [js/app/suitePracticeMixin.js L868-L903](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/suitePracticeMixin.js#L868-L903)