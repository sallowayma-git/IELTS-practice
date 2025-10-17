# Practice Enhancement System

> **Relevant source files**
> * [js/app.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js)
> * [js/practice-page-enhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js)

This document covers the Practice Enhancement System, which is responsible for enhancing individual practice pages with additional functionality including answer capture, progress tracking, and integration with the main application. This system bridges the gap between standalone practice pages and the centralized IELTS practice management system.

For information about the communication protocol between practice pages and the main application, see [Session Communication Protocol](/sallowayma-git/IELTS-practice/6.2-session-communication-protocol). For details about the practice page template structure, see [Practice Page Template](/sallowayma-git/IELTS-practice/6.1-practice-page-template).

## Architecture Overview

The Practice Enhancement System operates through a sophisticated script injection and enhancement mechanism that augments practice pages with data collection and communication capabilities.

### Core System Components

```mermaid
flowchart TD

AnswerData["answers: {}"]
InteractionData["interactions: []"]
ScoreData["scoreInfo: {}"]
SessionData["sessionId, duration"]
ScriptInjector["injectDataCollectionScript()"]
SessionManager["initializePracticeSession()"]
MessageHandler["setupExamWindowCommunication()"]
FallbackHandler["injectInlineScript()"]
PracticeEnhancer["PracticePageEnhancer"]
AnswerCapture["handleAnswerChange()"]
SubmitInterceptor["interceptSubmitFunction()"]
ScoreExtractor["extractFinalResults()"]
PostMessage["window.postMessage"]
StorageFallback["localStorage fallback"]
MessageQueue["retry queue"]

ScriptInjector --> PracticeEnhancer
SessionManager --> PracticeEnhancer
PracticeEnhancer --> PostMessage
PostMessage --> MessageHandler

subgraph Communication ["Communication Layer"]
    PostMessage
    StorageFallback
    MessageQueue
    PostMessage --> StorageFallback
    StorageFallback --> MessageQueue
end

subgraph PracticeWindow ["Practice Page Window"]
    PracticeEnhancer
    AnswerCapture
    SubmitInterceptor
    ScoreExtractor
    PracticeEnhancer --> AnswerCapture
    PracticeEnhancer --> SubmitInterceptor
    PracticeEnhancer --> ScoreExtractor
end

subgraph MainApp ["ExamSystemApp (app.js)"]
    ScriptInjector
    SessionManager
    MessageHandler
    FallbackHandler
end

subgraph DataFlow ["Data Collection"]
    AnswerData
    InteractionData
    ScoreData
    SessionData
end
```

Sources: [js/app.js L950-L1038](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L950-L1038)

 [js/practice-page-enhancer.js L17-L34](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L17-L34)

 [js/practice-page-enhancer.js L724-L761](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L724-L761)

### Enhancement Lifecycle

```mermaid
sequenceDiagram
  participant ExamSystemApp
  participant Practice Window
  participant PracticePageEnhancer
  participant Practice Page DOM

  ExamSystemApp->>Practice Window: openExamWindow()
  ExamSystemApp->>ExamSystemApp: injectDataCollectionScript()
  ExamSystemApp-->>Practice Window: Load enhancer script
  Practice Window->>PracticePageEnhancer: new PracticePageEnhancer()
  PracticePageEnhancer->>PracticePageEnhancer: initialize()
  PracticePageEnhancer->>Practice Page DOM: setupAnswerListeners()
  PracticePageEnhancer->>Practice Page DOM: interceptSubmitFunction()
  PracticePageEnhancer->>ExamSystemApp: sendMessage('SESSION_READY')
  ExamSystemApp->>PracticePageEnhancer: postMessage('INIT_SESSION')
  loop [Practice Session]
    Practice Page DOM->>PracticePageEnhancer: handleAnswerChange()
    PracticePageEnhancer->>ExamSystemApp: sendMessage('PROGRESS_UPDATE')
  end
  Practice Page DOM->>PracticePageEnhancer: handleSubmit()
  PracticePageEnhancer->>PracticePageEnhancer: extractFinalResults()
  PracticePageEnhancer->>ExamSystemApp: sendMessage('PRACTICE_COMPLETE')
```

Sources: [js/app.js L951-L1038](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L951-L1038)

 [js/practice-page-enhancer.js L39-L64](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L39-L64)

 [js/practice-page-enhancer.js L902-L918](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L902-L918)

## Script Injection Process

The practice enhancement system begins with the injection of the enhancement script into practice page windows. This process handles various scenarios including cross-origin restrictions and script loading failures.

### Injection Strategy

The system employs a multi-tiered injection approach:

| Method | Priority | Use Case | Implementation |
| --- | --- | --- | --- |
| File Injection | Primary | Same-origin pages | `fetch('./js/practice-page-enhancer.js')` |
| Inline Script | Fallback | Script loading failure | Embedded data collector |
| Communication Fallback | Last Resort | Cross-origin restrictions | localStorage events |

```mermaid
flowchart TD

StartInjection["injectDataCollectionScript()"]
CheckWindow["examWindow.closed?"]
AccessDoc["Access document?"]
ScriptExists["practiceDataCollector exists?"]
LoadScript["fetch('practice-page-enhancer.js')"]
InjectScript["Inject full enhancer script"]
InlineScript["injectInlineScript()"]
InitSession["initializePracticeSession()"]
HandleError["handleInjectionError()"]

StartInjection --> CheckWindow
CheckWindow --> HandleError
CheckWindow --> AccessDoc
AccessDoc --> ScriptExists
AccessDoc --> HandleError
ScriptExists --> InitSession
ScriptExists --> LoadScript
LoadScript --> InjectScript
LoadScript --> InlineScript
InjectScript --> InitSession
InlineScript --> InitSession
```

Sources: [js/app.js L951-L1038](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L951-L1038)

 [js/app.js L1043-L1113](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L1043-L1113)

 [js/app.js L1164-L1186](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L1164-L1186)

### Cross-Origin Handling

The system gracefully handles cross-origin restrictions that prevent script injection:

```mermaid
flowchart TD

FullInjection["Full Script Injection"]
DirectCommunication["Direct postMessage"]
NoInjection["No Script Access"]
StorageFallback["localStorage Fallback"]
EventTrigger["StorageEvent Trigger"]
SimulatedData["Simulated Data Collection"]
BasicRecording["Basic Session Recording"]

subgraph FallbackMode ["Degraded Mode"]
    SimulatedData
    BasicRecording
end

subgraph CrossOrigin ["Cross Origin"]
    NoInjection
    StorageFallback
    EventTrigger
    NoInjection --> StorageFallback
    StorageFallback --> EventTrigger
end

subgraph SameOrigin ["Same Origin"]
    FullInjection
    DirectCommunication
    FullInjection --> DirectCommunication
end
```

Sources: [js/practice-page-enhancer.js L264-L308](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L264-L308)

 [js/practice-page-enhancer.js L206-L216](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L206-L216)

 [js/app.js L1164-L1186](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L1164-L1186)

## Practice Page Enhancement Functionality

The `PracticePageEnhancer` class provides comprehensive enhancement capabilities for practice pages, transforming them from standalone pages into integrated components of the larger system.

### Core Enhancement Features

```mermaid
flowchart TD

Constructor["PracticePageEnhancer()"]
Initialize["initialize()"]
SetupComm["setupCommunication()"]
AnswerListeners["setupAnswerListeners()"]
ChangeHandler["handleAnswerChange()"]
InteractionLog["interactions: []"]
FunctionIntercept["interceptSubmitFunction()"]
GradeWrapper["window.grade wrapper"]
SubmitHandler["handleSubmit()"]
PageExtract["extractScoreFromPage()"]
ScoreCalc["calculateScore()"]
FinalResults["extractFinalResults()"]

Initialize --> AnswerListeners
Initialize --> FunctionIntercept
SubmitHandler --> PageExtract

subgraph DataExtraction ["Result Extraction"]
    PageExtract
    ScoreCalc
    FinalResults
    PageExtract --> ScoreCalc
    ScoreCalc --> FinalResults
end

subgraph SubmitCapture ["Submit Interception"]
    FunctionIntercept
    GradeWrapper
    SubmitHandler
    FunctionIntercept --> GradeWrapper
    GradeWrapper --> SubmitHandler
end

subgraph Monitoring ["User Interaction Monitoring"]
    AnswerListeners
    ChangeHandler
    InteractionLog
    AnswerListeners --> ChangeHandler
    ChangeHandler --> InteractionLog
end

subgraph Initialization ["Enhancement Initialization"]
    Constructor
    Initialize
    SetupComm
    Constructor --> Initialize
    Initialize --> SetupComm
end
```

Sources: [js/practice-page-enhancer.js L17-L34](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L17-L34)

 [js/practice-page-enhancer.js L39-L64](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L39-L64)

 [js/practice-page-enhancer.js L354-L370](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L354-L370)

### Answer Collection Mechanism

The system monitors all form interactions to capture user responses:

| Input Type | Detection Method | Value Extraction | Storage Format |
| --- | --- | --- | --- |
| Text Input | `input[name^="q"]` | `element.value` | `{questionId: value}` |
| Radio Button | `input[type="radio"]` | `element.checked ? element.value : null` | `{questionId: selectedValue}` |
| Checkbox | `input[type="checkbox"]` | `element.checked ? element.value : null` | `{questionId: checkedValue}` |

```mermaid
flowchart TD

UserInput["User Input Event"]
EventCheck["Event from question element?"]
QuestionId["Extract questionId (element.name)"]
ValueExtract["Extract value by input type"]
AnswerUpdate["Update answers[questionId]"]
InteractionLog["Log interaction with timestamp"]
ProgressSend["sendProgressUpdate()"]
End["Ignore Event"]

UserInput --> EventCheck
EventCheck --> QuestionId
EventCheck --> End
QuestionId --> ValueExtract
ValueExtract --> AnswerUpdate
AnswerUpdate --> InteractionLog
InteractionLog --> ProgressSend
```

Sources: [js/practice-page-enhancer.js L354-L414](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L354-L414)

 [js/practice-page-enhancer.js L374-L414](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L374-L414)

### Submit Function Interception

The system intercepts the practice page's grading function to capture completion data:

```mermaid
sequenceDiagram
  participant User
  participant Page DOM
  participant Original grade()
  participant PracticePageEnhancer
  participant Main App

  User->>Page DOM: Click Submit Button
  Page DOM->>PracticePageEnhancer: Intercepted grade() call
  PracticePageEnhancer->>Original grade(): Execute original grading
  Original grade()->>Page DOM: Display results
  note over PracticePageEnhancer: Wait 800ms for results to display
  PracticePageEnhancer->>PracticePageEnhancer: extractFinalResults()
  PracticePageEnhancer->>Main App: sendMessage('PRACTICE_COMPLETE')
```

Sources: [js/practice-page-enhancer.js L418-L458](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L418-L458)

 [js/practice-page-enhancer.js L462-L488](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L462-L488)

## Communication Protocol

The enhanced practice pages communicate with the main application through a robust messaging system that includes retry mechanisms and fallback options.

### Message Types and Data Flow

```mermaid
flowchart TD

HandleMessage["handleMessage()"]
MessageValidation["Validate message format"]
TypeDispatch["Switch by message type"]
ResponseGeneration["Generate appropriate response"]
InitSession["INIT_SESSION<br>{sessionId, examId, parentOrigin}"]
RequestStatus["REQUEST_STATUS<br>{}"]
Heartbeat["HEARTBEAT<br>{timestamp}"]
ReconnectReq["RECONNECT_REQUEST<br>{windowId}"]
SessionReady["SESSION_READY<br>{pageType, url, timestamp}"]
ProgressUpdate["PROGRESS_UPDATE<br>{answeredQuestions, totalQuestions, elapsedTime}"]
PracticeComplete["PRACTICE_COMPLETE<br>{answers, scoreInfo, duration, interactions}"]
ErrorOccurred["ERROR_OCCURRED<br>{type, message, timestamp}"]

subgraph PracticeToMain ["Practice Page → Main App"]
    SessionReady
    ProgressUpdate
    PracticeComplete
    ErrorOccurred
end

subgraph MessageHandling ["Message Processing"]
    HandleMessage
    MessageValidation
    TypeDispatch
    ResponseGeneration
    HandleMessage --> MessageValidation
    MessageValidation --> TypeDispatch
    TypeDispatch --> ResponseGeneration
end

subgraph MainToPractice ["Main App → Practice Page"]
    InitSession
    RequestStatus
    Heartbeat
    ReconnectReq
end
```

Sources: [js/practice-page-enhancer.js L88-L128](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L88-L128)

 [js/practice-page-enhancer.js L721-L761](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L721-L761)

 [js/app.js L1221-L1285](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L1221-L1285)

### Resilient Communication System

The system implements multiple layers of communication reliability:

```mermaid
flowchart TD

SendMessage["sendMessage(type, data)"]
ParentCheck["Parent window available?"]
PostMessage["window.postMessage()"]
Success["Message sent successfully?"]
Fallback["handleCommunicationFallback()"]
LocalStorage["Write to localStorage"]
StorageEvent["Dispatch StorageEvent"]
RetryQueue["Add to retry queue"]
RetryProcessor["Process retry queue"]
MaxRetries["Attempts < max retries?"]
DegradedMode["enterDegradedMode()"]
End["Complete"]

SendMessage --> ParentCheck
ParentCheck --> PostMessage
ParentCheck --> Fallback
PostMessage --> Success
Success --> End
Success --> RetryQueue
Fallback --> LocalStorage
LocalStorage --> StorageEvent
RetryQueue --> RetryProcessor
RetryProcessor --> MaxRetries
MaxRetries --> PostMessage
MaxRetries --> DegradedMode
```

Sources: [js/practice-page-enhancer.js L724-L761](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L724-L761)

 [js/practice-page-enhancer.js L264-L308](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L264-L308)

 [js/practice-page-enhancer.js L842-L898](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L842-L898)

## Data Collection and Extraction

The system collects comprehensive data about practice sessions, including user interactions, performance metrics, and completion results.

### Score Extraction Strategy

The system employs multiple strategies to extract scoring information from completed practices:

```mermaid
flowchart TD

ExtractResults["extractFinalResults()"]
PageExtraction["extractScoreFromPage()"]
ResultsElement["Find #results element"]
ScoreMatch["Match 'Score: X/Y' pattern?"]
AccuracyMatch["Match 'X%' pattern?"]
CalculateScore["calculateScore() using answerKey"]
FinalScore["Build scoreInfo object"]
CompleteData["Package complete results"]

ExtractResults --> PageExtraction
PageExtraction --> ResultsElement
ResultsElement --> ScoreMatch
ScoreMatch --> FinalScore
ScoreMatch --> AccuracyMatch
AccuracyMatch --> FinalScore
AccuracyMatch --> CalculateScore
CalculateScore --> FinalScore
FinalScore --> CompleteData
```

Sources: [js/practice-page-enhancer.js L490-L522](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L490-L522)

 [js/practice-page-enhancer.js L525-L576](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L525-L576)

 [js/practice-page-enhancer.js L580-L626](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L580-L626)

### Data Structure Schema

The system collects data in a comprehensive structured format:

| Data Category | Fields | Source | Purpose |
| --- | --- | --- | --- |
| Session Info | `sessionId`, `startTime`, `endTime`, `duration` | Enhancer timing | Session tracking |
| Answers | `questionId: value` mappings | DOM monitoring | Response capture |
| Interactions | Timestamped user actions | Event logging | Behavioral analysis |
| Score Info | `correct`, `total`, `accuracy`, `percentage` | Page extraction/calculation | Performance metrics |
| Metadata | `pageType`, `url`, `source` | Environment detection | Context information |

```mermaid
flowchart TD

SessionData["sessionId: string<br>startTime: number<br>endTime: number<br>duration: number"]
AnswerData["answers: {<br>  q1: 'value',<br>  q2: 'value'<br>}"]
InteractionData["interactions: [{<br>  type: 'answer_change',<br>  timestamp: number,<br>  questionId: string<br>}]"]
ScoreData["scoreInfo: {<br>  correct: number,<br>  total: number,<br>  accuracy: number,<br>  source: string<br>}"]
DOMEvents["DOM Event Monitoring"]
PageResults["Results Page Parsing"]
SystemTiming["System Timing"]
AnswerKey["Built-in Answer Key"]

DOMEvents --> AnswerData
DOMEvents --> InteractionData
PageResults --> ScoreData
SystemTiming --> SessionData
AnswerKey --> ScoreData

subgraph DataSources ["Data Sources"]
    DOMEvents
    PageResults
    SystemTiming
    AnswerKey
end

subgraph CollectedData ["Collected Data Structure"]
    SessionData
    AnswerData
    InteractionData
    ScoreData
end
```

Sources: [js/practice-page-enhancer.js L490-L522](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L490-L522)

 [js/practice-page-enhancer.js L644-L687](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L644-L687)

 [js/app.js L1419-L1465](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L1419-L1465)

## Error Handling and Resilience

The Practice Enhancement System implements comprehensive error handling and recovery mechanisms to ensure reliable operation across various scenarios.

### Multi-Tier Error Recovery

```mermaid
flowchart TD

ErrorDetected["Error Detected"]
ErrorType["Error Type"]
CommError["Communication Error"]
InjectionError["Script Injection Error"]
ExtractionError["Data Extraction Error"]
RetryMechanism["Automatic Retry<br>(up to 3 attempts)"]
FallbackComm["Fallback Communication<br>(localStorage)"]
DegradedMode["Enter Degraded Mode"]
UserNotification["Show User-Friendly Message"]
ErrorLogging["Log to localStorage"]
ContinueOperation["Continue with Limited Functionality"]

ErrorDetected --> ErrorType
ErrorType --> CommError
ErrorType --> InjectionError
ErrorType --> ExtractionError
CommError --> RetryMechanism
RetryMechanism --> FallbackComm
FallbackComm --> DegradedMode
InjectionError --> ErrorLogging
ExtractionError --> ErrorLogging
DegradedMode --> UserNotification
ErrorLogging --> UserNotification
UserNotification --> ContinueOperation
```

Sources: [js/practice-page-enhancer.js L157-L202](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L157-L202)

 [js/practice-page-enhancer.js L206-L261](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L206-L261)

 [js/app.js L1164-L1186](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L1164-L1186)

### Degraded Mode Operations

When the full enhancement system fails, the system gracefully degrades while maintaining core functionality:

| Full Mode Feature | Degraded Mode Equivalent | Implementation |
| --- | --- | --- |
| Real-time progress tracking | Basic session timing | `startTime` recording only |
| Detailed answer capture | Simplified change detection | Limited to `change` events |
| Advanced score extraction | Basic result parsing | Pattern matching only |
| Retry-based communication | One-shot localStorage fallback | Single attempt communication |

```mermaid
flowchart TD

FullScript["Complete PracticePageEnhancer"]
RealTime["Real-time Progress"]
DetailedData["Comprehensive Data"]
ReliableComm["Reliable Communication"]
InlineScript["Simplified Inline Collector"]
BasicTiming["Basic Timing Only"]
LimitedData["Essential Data Only"]
FallbackComm["Fallback Communication"]
ScriptFail["Script Loading Failure"]
CrossOrigin["Cross-Origin Restrictions"]
CommFailure["Communication Failure"]

ScriptFail --> InlineScript
CrossOrigin --> FallbackComm
CommFailure --> BasicTiming
FullScript --> InlineScript
RealTime --> BasicTiming
DetailedData --> LimitedData
ReliableComm --> FallbackComm

subgraph ErrorScenarios ["Error Triggers"]
    ScriptFail
    CrossOrigin
    CommFailure
end

subgraph DegradedMode ["Degraded Mode"]
    InlineScript
    BasicTiming
    LimitedData
    FallbackComm
end

subgraph FullMode ["Full Enhancement Mode"]
    FullScript
    RealTime
    DetailedData
    ReliableComm
end
```

Sources: [js/practice-page-enhancer.js L206-L261](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/practice-page-enhancer.js#L206-L261)

 [js/app.js L1043-L1113](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L1043-L1113)

 [js/app.js L1290-L1336](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/app.js#L1290-L1336)