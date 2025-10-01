# Data Storage & Integrity

> **Relevant source files**
> * [improved-working-system.html](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html)

This document covers the data persistence, backup, validation, and integrity management systems within the core IELTS practice application. It details how user practice data, exam indices, and system state are stored, protected, and maintained across browser sessions.

For information about the broader system architecture, see [System Architecture](/sallowayma-git/IELTS-practice/2.1-system-architecture). For details about the practice session data flow, see [Session Communication Protocol](/sallowayma-git/IELTS-practice/6.2-session-communication-protocol).

## Storage Architecture

The application implements a layered storage architecture built on top of browser `localStorage` with comprehensive error handling, quota management, and data integrity features.

### Core Storage Components

```mermaid
flowchart TD

App["ExamSystemApp"]
Components["System Components"]
StorageWrapper["window.storage"]
ErrorHandler["window.handleError"]
QuotaManager["Quota Management"]
DataIntegrityMgr["DataIntegrityManager"]
BackupSystem["Backup System"]
ValidationSystem["Data Validation"]
LocalStorage["localStorage"]
SessionStorage["sessionStorage"]
ExamIndex["exam_index"]
PracticeRecords["practice_records"]
BackupKeys["backup_*"]
ErrorLogs["system_error_log"]

App --> StorageWrapper
Components --> StorageWrapper
StorageWrapper --> DataIntegrityMgr
StorageWrapper --> LocalStorage
StorageWrapper --> SessionStorage
LocalStorage --> ExamIndex
LocalStorage --> PracticeRecords
LocalStorage --> BackupKeys
LocalStorage --> ErrorLogs

subgraph subGraph4 ["Storage Keys"]
    ExamIndex
    PracticeRecords
    BackupKeys
    ErrorLogs
end

subgraph subGraph3 ["Browser Storage"]
    LocalStorage
    SessionStorage
end

subgraph subGraph2 ["Data Management Layer"]
    DataIntegrityMgr
    BackupSystem
    ValidationSystem
    DataIntegrityMgr --> BackupSystem
    DataIntegrityMgr --> ValidationSystem
end

subgraph subGraph1 ["Storage Abstraction Layer"]
    StorageWrapper
    ErrorHandler
    QuotaManager
    StorageWrapper --> QuotaManager
    StorageWrapper --> ErrorHandler
end

subgraph subGraph0 ["Application Layer"]
    App
    Components
end
```

**Sources:** [improved-working-system.html L961-L1017](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L961-L1017)

 [improved-working-system.html L2897-L2912](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2897-L2912)

### Storage Wrapper Implementation

The `window.storage` object provides a safe abstraction over `localStorage` with comprehensive error handling:

```mermaid
flowchart TD

GetOp["storage.get(key, defaultValue)"]
SetOp["storage.set(key, value)"]
CleanupOp["storage.cleanup()"]
QuotaCheck["Quota Exceeded Detection"]
RetryLogic["Automatic Retry"]
OldDataCleanup["Old Data Cleanup"]
TestWrite["Test Write Operation"]
DataParsing["JSON Parse/Stringify"]
ErrorLogging["Error Logging"]

GetOp --> DataParsing
SetOp --> TestWrite
SetOp --> QuotaCheck
CleanupOp --> OldDataCleanup

subgraph subGraph2 ["Storage Validation"]
    TestWrite
    DataParsing
    ErrorLogging
    DataParsing --> ErrorLogging
    TestWrite --> ErrorLogging
end

subgraph subGraph1 ["Error Handling"]
    QuotaCheck
    RetryLogic
    OldDataCleanup
    QuotaCheck --> OldDataCleanup
    OldDataCleanup --> RetryLogic
end

subgraph subGraph0 ["Storage Operations"]
    GetOp
    SetOp
    CleanupOp
end
```

**Sources:** [improved-working-system.html L961-L1017](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L961-L1017)

## Data Types and Schema

### Primary Data Entities

| Storage Key | Data Type | Purpose | Retention |
| --- | --- | --- | --- |
| `exam_index` | Array | Complete exam database cache | Indefinite |
| `practice_records` | Array | User practice session history | 30 days default |
| `backup_*` | BackupEntry | System state snapshots | Varies by type |
| `system_error_log` | Array | System error tracking | 50 entries max |
| `exam_browser_error_log` | Array | Browser-specific errors | Varies |

### Practice Record Schema

```css
#mermaid-ppbeodqdtb{font-family:ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica;font-size:16px;fill:#333;}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#mermaid-ppbeodqdtb .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#mermaid-ppbeodqdtb .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#mermaid-ppbeodqdtb .error-icon{fill:#dddddd;}#mermaid-ppbeodqdtb .error-text{fill:#222222;stroke:#222222;}#mermaid-ppbeodqdtb .edge-thickness-normal{stroke-width:1px;}#mermaid-ppbeodqdtb .edge-thickness-thick{stroke-width:3.5px;}#mermaid-ppbeodqdtb .edge-pattern-solid{stroke-dasharray:0;}#mermaid-ppbeodqdtb .edge-thickness-invisible{stroke-width:0;fill:none;}#mermaid-ppbeodqdtb .edge-pattern-dashed{stroke-dasharray:3;}#mermaid-ppbeodqdtb .edge-pattern-dotted{stroke-dasharray:2;}#mermaid-ppbeodqdtb .marker{fill:#999;stroke:#999;}#mermaid-ppbeodqdtb .marker.cross{stroke:#999;}#mermaid-ppbeodqdtb svg{font-family:ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica;font-size:16px;}#mermaid-ppbeodqdtb p{margin:0;}#mermaid-ppbeodqdtb .entityBox{fill:#ffffff;stroke:#dddddd;}#mermaid-ppbeodqdtb .relationshipLabelBox{fill:#dddddd;opacity:0.7;background-color:#dddddd;}#mermaid-ppbeodqdtb .relationshipLabelBox rect{opacity:0.5;}#mermaid-ppbeodqdtb .labelBkg{background-color:rgba(221, 221, 221, 0.5);}#mermaid-ppbeodqdtb .edgeLabel .label{fill:#dddddd;font-size:14px;}#mermaid-ppbeodqdtb .label{font-family:ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica;color:#333;}#mermaid-ppbeodqdtb .edge-pattern-dashed{stroke-dasharray:8,8;}#mermaid-ppbeodqdtb .node rect,#mermaid-ppbeodqdtb .node circle,#mermaid-ppbeodqdtb .node ellipse,#mermaid-ppbeodqdtb .node polygon{fill:#ffffff;stroke:#dddddd;stroke-width:1px;}#mermaid-ppbeodqdtb .relationshipLine{stroke:#999;stroke-width:1;fill:none;}#mermaid-ppbeodqdtb .marker{fill:none!important;stroke:#999!important;stroke-width:1;}#mermaid-ppbeodqdtb :root{--mermaid-font-family:"trebuchet ms",verdana,arial,sans-serif;}containsPracticeRecordstringidUnique identifierstringexamIdReference to examstringtitleExam titlestringcategoryP1, P2, or P3stringfrequencyhigh or lowstringdataSourcereal or simulatedbooleanisRealDataData authenticity flagdatetimestartTimeSession startdatetimeendTimeSession enddatetimedateRecord creationnumberscoreQuestions correctnumbertotalQuestionsTotal questionsnumberaccuracyAccuracy percentagenumberpercentageScore percentagenumberdurationDuration in secondsobjectrealDataDetailed session dataRealDatastringsessionIdSession identifierobjectanswersUser answersarrayinteractionsUser interactionsobjectscoreInfoScore calculation detailsstringpageTypePage type identifierstringurlPractice page URLstringsourceData extraction source
```

**Sources:** [improved-working-system.html L3107-L3140](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L3107-L3140)

 [improved-working-system.html L2928-L2953](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2928-L2953)

## Data Integrity Management

### DataIntegrityManager Integration

The application integrates with a `DataIntegrityManager` class that provides comprehensive data protection:

```mermaid
flowchart TD

CreateBackup["createManualBackup()"]
ShowBackupList["showBackupList()"]
RestoreBackup["restoreBackup(backupId)"]
ValidateData["validateAllData()"]
ExportData["exportAllData()"]
ImportData["importData()"]
CompatCheck["checkDataCompatibility()"]
IntegrityReport["getIntegrityReport()"]
BackupValidation["Backup Validation"]
BackupStorage["Backup Storage"]
VersionControl["Version Control"]
MigrationLogic["Data Migration"]

CreateBackup --> BackupStorage
ShowBackupList --> BackupStorage
RestoreBackup --> BackupStorage
ValidateData --> IntegrityReport
ExportData --> BackupStorage
ImportData --> MigrationLogic
CompatCheck --> MigrationLogic
BackupValidation --> VersionControl

subgraph subGraph2 ["Storage Management"]
    BackupStorage
    VersionControl
    MigrationLogic
end

subgraph subGraph1 ["Data Validation"]
    CompatCheck
    IntegrityReport
    BackupValidation
    IntegrityReport --> BackupValidation
end

subgraph subGraph0 ["Integrity Operations"]
    CreateBackup
    ShowBackupList
    RestoreBackup
    ValidateData
    ExportData
    ImportData
end
```

**Sources:** [improved-working-system.html L2929-L2077](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2929-L2077)

 [improved-working-system.html L2080-L2148](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2080-L2148)

### Backup System Architecture

```mermaid
sequenceDiagram
  participant User
  participant UI["Settings UI"]
  participant DIM["DataIntegrityManager"]
  participant Storage["localStorage"]
  participant UI
  participant DIM
  participant Storage

  User->>UI: Click "创建备份"
  UI->>DIM: createManualBackup()
  DIM->>Storage: Read current data
  Storage-->>DIM: Return data
  DIM->>DIM: Create backup object
  DIM->>Storage: Store backup with timestamp
  Storage-->>DIM: Confirm storage
  DIM-->>UI: Return backup ID
  UI-->>User: Show success message
  User->>UI: Click "备份列表"
  UI->>DIM: getBackupList()
  DIM->>Storage: Read backup entries
  Storage-->>DIM: Return backup list
  DIM-->>UI: Format backup display
  UI-->>User: Show backup list with restore options
```

**Sources:** [improved-working-system.html L1929-L1944](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1929-L1944)

 [improved-working-system.html L1947-L1999](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1947-L1999)

## Error Handling and Recovery

### Storage Error Management

The system implements multi-tier error handling for storage operations:

```mermaid
flowchart TD

QuotaError["QuotaExceededError"]
NetworkError["NetworkError"]
ParseError["JSON Parse Error"]
SecurityError["SecurityError"]
Detection["Error Detection"]
Classification["Error Classification"]
Recovery["Recovery Strategy"]
UserNotification["User Notification"]
CleanupOld["Cleanup Old Data"]
RetryOperation["Retry Operation"]
FallbackMode["Fallback Mode"]
CriticalAlert["Critical Alert"]

QuotaError --> Detection
NetworkError --> Detection
ParseError --> Detection
SecurityError --> Detection
Recovery --> CleanupOld
Recovery --> RetryOperation
Recovery --> FallbackMode
Recovery --> CriticalAlert

subgraph subGraph2 ["Recovery Actions"]
    CleanupOld
    RetryOperation
    FallbackMode
    CriticalAlert
end

subgraph subGraph1 ["Error Handling Strategy"]
    Detection
    Classification
    Recovery
    UserNotification
    Detection --> Classification
    Classification --> Recovery
    Recovery --> UserNotification
end

subgraph subGraph0 ["Error Types"]
    QuotaError
    NetworkError
    ParseError
    SecurityError
end
```

**Sources:** [improved-working-system.html L982-L998](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L982-L998)

 [improved-working-system.html L1000-L1016](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1000-L1016)

### Quota Management

The storage system implements intelligent quota management:

```mermaid
flowchart TD

TestWrite["Test Write Operation"]
QuotaCheck["Detect QuotaExceededError"]
SpaceAnalysis["Analyze Storage Usage"]
OldRecords["Remove 30+ day old records"]
TempData["Clear temporary data"]
CacheCleanup["Clear cache data"]
RetryWrite["Retry Original Operation"]
SuccessCheck["Verify Success"]
UserAlert["Alert User if Failed"]

SpaceAnalysis --> OldRecords
CacheCleanup --> RetryWrite

subgraph subGraph2 ["Recovery Process"]
    RetryWrite
    SuccessCheck
    UserAlert
    RetryWrite --> SuccessCheck
    SuccessCheck --> UserAlert
end

subgraph subGraph1 ["Cleanup Strategy"]
    OldRecords
    TempData
    CacheCleanup
    OldRecords --> TempData
    TempData --> CacheCleanup
end

subgraph subGraph0 ["Quota Detection"]
    TestWrite
    QuotaCheck
    SpaceAnalysis
    TestWrite --> QuotaCheck
    QuotaCheck --> SpaceAnalysis
end
```

**Sources:** [improved-working-system.html L1002-L1012](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1002-L1012)

## Performance Optimization

### Caching Strategy

The application implements sophisticated caching through the `PerformanceOptimizer` class:

```mermaid
flowchart TD

ExamCache["Exam Index Cache"]
SearchCache["Search Results Cache"]
RenderCache["Render Cache"]
CacheKey["Cache Key Generation"]
TTLManager["TTL Management"]
HitRateTracking["Hit Rate Tracking"]
LoadTime["Load Time Tracking"]
RenderTime["Render Time Tracking"]
CacheStats["Cache Statistics"]

ExamCache --> CacheKey
SearchCache --> CacheKey
RenderCache --> CacheKey
HitRateTracking --> LoadTime

subgraph subGraph2 ["Performance Metrics"]
    LoadTime
    RenderTime
    CacheStats
    LoadTime --> RenderTime
    RenderTime --> CacheStats
end

subgraph subGraph1 ["Cache Management"]
    CacheKey
    TTLManager
    HitRateTracking
    CacheKey --> TTLManager
    TTLManager --> HitRateTracking
end

subgraph subGraph0 ["Cache Types"]
    ExamCache
    SearchCache
    RenderCache
end
```

**Sources:** [improved-working-system.html L1162-L1172](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1162-L1172)

 [improved-working-system.html L1432-L1441](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1432-L1441)

### Data Loading Optimization

```mermaid
sequenceDiagram
  participant App["Application"]
  participant Cache["Performance Cache"]
  participant Storage["localStorage"]
  participant Index["Exam Index"]
  participant App
  participant Cache
  participant Storage
  participant Index

  App->>Cache: Check cached exam data
  loop [Cache Hit]
    Cache-->>App: Return cached data
    App->>App: finishLibraryLoading()
    App->>Storage: Load from localStorage
    Storage-->>App: Return stored data
    App->>Index: Process exam data
    Index-->>App: Return processed data
    App->>Cache: Store in cache with TTL
    App->>App: finishLibraryLoading()
  end
  App->>Storage: Save processed data
  App->>App: updateSystemInfo()
```

**Sources:** [improved-working-system.html L1159-L1232](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1159-L1232)

 [improved-working-system.html L1236-L1276](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L1236-L1276)

## Data Import and Export

### Export Functionality

The system provides comprehensive data export capabilities:

```mermaid
flowchart TD

PracticeExport["Practice Data Export"]
SystemExport["Complete System Export"]
BackupExport["Backup Export"]
DataCollection["Collect Data"]
Serialization["JSON Serialization"]
FileGeneration["Generate Download"]
Metadata["Export Metadata"]
Statistics["Practice Statistics"]
Records["Practice Records"]
SystemState["System State"]

PracticeExport --> DataCollection
SystemExport --> DataCollection
BackupExport --> DataCollection
FileGeneration --> Metadata
FileGeneration --> Statistics
FileGeneration --> Records
FileGeneration --> SystemState

subgraph subGraph2 ["Export Format"]
    Metadata
    Statistics
    Records
    SystemState
end

subgraph subGraph1 ["Export Process"]
    DataCollection
    Serialization
    FileGeneration
    DataCollection --> Serialization
    Serialization --> FileGeneration
end

subgraph subGraph0 ["Export Types"]
    PracticeExport
    SystemExport
    BackupExport
end
```

**Sources:** [improved-working-system.html L2489-L2513](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2489-L2513)

 [improved-working-system.html L2027-L2041](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2027-L2041)

### Import and Validation

```mermaid
sequenceDiagram
  participant User
  participant FileInput["File Input"]
  participant Validator["Data Validator"]
  participant Storage["Storage System"]
  participant UI["User Interface"]
  participant FileInput
  participant Validator
  participant Storage
  participant UI

  User->>FileInput: Select import file
  FileInput->>Validator: Validate file format
  Validator->>Validator: Check data structure
  Validator->>Validator: Verify compatibility
  loop [Valid Data]
    Validator->>Storage: Import data
    Storage->>Storage: Backup existing data
    Storage->>Storage: Apply new data
    Storage-->>UI: Success response
    UI-->>User: Show success message
    UI->>UI: location.reload()
    Validator-->>UI: Error response
    UI-->>User: Show error message
  end
```

**Sources:** [improved-working-system.html L2044-L2077](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/improved-working-system.html#L2044-L2077)