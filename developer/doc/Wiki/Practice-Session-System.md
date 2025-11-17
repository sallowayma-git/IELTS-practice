# Practice Session System

> **Relevant source files**
> * [AGENTS.md](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/AGENTS.md)
> * [js/app/examSessionMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js)
> * [js/app/suitePracticeMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js)
> * [js/core/practiceRecorder.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js)
> * [js/core/scoreStorage.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js)
> * [js/practice-page-enhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js)
> * [js/utils/environmentDetector.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/environmentDetector.js)
> * [js/utils/logger.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/logger.js)

## Purpose and Scope

This document describes the complete practice session lifecycle in the IELTS Practice System, covering how user practice attempts are tracked, recorded, and persisted. The system handles both single-exam practice sessions and multi-exam suite practice modes.

**Scope covered by this page:**

* Session initialization and tracking
* Cross-window communication between parent app and exam windows
* Answer collection and correct answer extraction
* Result normalization and validation
* Data persistence to storage

**Related pages:**

* For detailed information about `PracticeRecorder` and `ScoreStorage` classes, see [PracticeRecorder & ScoreStorage](/sallowayma-git/IELTS-practice/5.1-practicerecorder-and-scorestorage)
* For data collection mechanisms in exam pages, see [Practice Page Enhancement & Data Collection](/sallowayma-git/IELTS-practice/5.2-practice-page-enhancement-and-data-collection)
* For the postMessage protocol specification, see [Cross-Window Communication Protocol](/sallowayma-git/IELTS-practice/5.3-cross-window-communication-protocol)
* For suite practice orchestration, see [Suite Practice Mode](/sallowayma-git/IELTS-practice/5.4-suite-practice-mode)
* For exam window lifecycle management, see [Exam Window Management & Resource Resolution](/sallowayma-git/IELTS-practice/5.5-exam-window-management-and-resource-resolution)
* For state management architecture, see [ExamSystemApp & State Management](/sallowayma-git/IELTS-practice/3.1-examsystemapp-and-state-management)
* For data storage and repositories, see [Storage Architecture & Repositories](/sallowayma-git/IELTS-practice/4.1-storage-architecture-and-repositories)

---

## System Architecture Overview

The Practice Session System consists of three primary subsystems that work together to track and persist user practice attempts:

```mermaid
flowchart TD

APP["ExamSystemApp<br>(main.js, app.js)"]
ESM["examSessionMixin<br>(examSessionMixin.js)"]
SPM["suitePracticeMixin<br>(suitePracticeMixin.js)"]
PR["PracticeRecorder<br>(practiceRecorder.js)"]
SS["ScoreStorage<br>(scoreStorage.js)"]
EXAM_PAGE["Exam HTML Page"]
PPE["practicePageEnhancer<br>(practice-page-enhancer.js)"]
CAE["CorrectAnswerExtractor<br>(embedded in enhancer)"]
REPOS["dataRepositories<br>(practice, meta, backups)"]
IDB["IndexedDB"]
LS["localStorage"]

ESM --> EXAM_PAGE
ESM --> PPE
PPE --> APP
SS --> REPOS

subgraph subGraph2 ["Storage Layer"]
    REPOS
    IDB
    LS
    REPOS --> IDB
    REPOS --> LS
end

subgraph subGraph1 ["Exam Window (Popup/Tab)"]
    EXAM_PAGE
    PPE
    CAE
    PPE --> CAE
end

subgraph subGraph0 ["Parent Window (Main Application)"]
    APP
    ESM
    SPM
    PR
    SS
    APP --> ESM
    APP --> SPM
    APP --> PR
    PR --> SS
    SPM --> ESM
end
```

**Sources:** [js/core/practiceRecorder.js L1-L1050](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1-L1050)

 [js/core/scoreStorage.js L1-L850](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L1-L850)

 [js/app/examSessionMixin.js L1-L900](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L1-L900)

 [js/app/suitePracticeMixin.js L1-L650](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L1-L650)

 [js/practice-page-enhancer.js L1-L1000](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1-L1000)

---

## Practice Session Lifecycle (Single Exam)

### Phase 1: Session Initialization

The session lifecycle begins when a user clicks "Start Exam" in the browse view. The flow proceeds through these stages:

```mermaid
sequenceDiagram
  participant User
  participant examSessionMixin
  participant PracticeRecorder
  participant Exam Window
  participant practicePageEnhancer

  User->>examSessionMixin: Click "Start Exam"
  examSessionMixin->>examSessionMixin: openExam(examId, options)
  examSessionMixin->>examSessionMixin: buildExamUrl(exam)
  examSessionMixin->>Exam Window: window.open(examUrl)
  note over Exam Window: Window opens, page loads
  examSessionMixin->>PracticeRecorder: startPracticeSession(examId)
  PracticeRecorder->>PracticeRecorder: generateSessionId()
  PracticeRecorder->>PracticeRecorder: Create sessionData object
  PracticeRecorder->>PracticeRecorder: Store in activeSessions Map
  note over PracticeRecorder: sessionData includes:
  examSessionMixin->>Exam Window: Inject enhancer script
  Exam Window-->>examSessionMixin: Document ready
  examSessionMixin->>practicePageEnhancer: postMessage(INIT_SESSION)
  practicePageEnhancer->>practicePageEnhancer: Store sessionId, examId
  practicePageEnhancer->>practicePageEnhancer: Setup answer listeners
  practicePageEnhancer->>practicePageEnhancer: Extract correct answers
  practicePageEnhancer-->>examSessionMixin: postMessage(SESSION_READY)
```

**Key Methods:**

* `examSessionMixin.openExam()` [js/app/examSessionMixin.js L89-L176](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L89-L176)  - Entry point for opening an exam
* `examSessionMixin.buildExamUrl()` [js/app/examSessionMixin.js L181-L193](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L181-L193)  - Constructs the exam URL
* `examSessionMixin.openExamWindow()` [js/app/examSessionMixin.js L198-L252](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L198-L252)  - Opens popup/tab window
* `PracticeRecorder.startPracticeSession()` [js/core/practiceRecorder.js L770-L812](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L770-L812)  - Creates session tracking object
* `examSessionMixin.injectDataCollectionScript()` [js/app/examSessionMixin.js L460-L533](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L460-L533)  - Injects enhancer script
* `practicePageEnhancer.initialize()` [js/practice-page-enhancer.js L309-L361](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L309-L361)  - Sets up data collection

**Sources:** [js/app/examSessionMixin.js L89-L252](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L89-L252)

 [js/core/practiceRecorder.js L770-L812](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L770-L812)

 [js/practice-page-enhancer.js L309-L418](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L309-L418)

### Phase 2: Active Practice

During the practice session, the enhancer continuously collects user answers and tracks interactions:

| Activity | Component | Method/Logic |
| --- | --- | --- |
| User enters answer | `practicePageEnhancer` | `setupAnswerListeners()` [js/practice-page-enhancer.js L677-L787](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L677-L787) |
| Answer captured | `practicePageEnhancer` | `collectAnswer()` [js/practice-page-enhancer.js L789-L826](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L789-L826) |
| Periodic collection | `practicePageEnhancer` | `collectAllAnswers()` [js/practice-page-enhancer.js L828-L912](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L828-L912) |
| Progress update | `practicePageEnhancer` | `sendMessage('SESSION_PROGRESS')` |
| Progress received | `PracticeRecorder` | `handleSessionProgress()` [js/core/practiceRecorder.js L842-L861](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L842-L861) |

**Sources:** [js/practice-page-enhancer.js L677-L912](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L677-L912)

 [js/core/practiceRecorder.js L842-L861](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L842-L861)

### Phase 3: Session Completion

When the user submits their answers, the completion flow is triggered:

```mermaid
sequenceDiagram
  participant User
  participant practicePageEnhancer
  participant PracticeRecorder
  participant ScoreStorage
  participant dataRepositories

  User->>practicePageEnhancer: Submit answers
  practicePageEnhancer->>practicePageEnhancer: collectAllAnswers()
  practicePageEnhancer->>practicePageEnhancer: extractCorrectAnswers()
  practicePageEnhancer->>practicePageEnhancer: buildAnswerComparison()
  note over practicePageEnhancer: Creates comparison object:
  practicePageEnhancer->>practicePageEnhancer: Package completion data
  practicePageEnhancer-->>PracticeRecorder: postMessage(PRACTICE_COMPLETE)
  note over PracticeRecorder: Message includes:
  PracticeRecorder->>PracticeRecorder: handleSessionCompleted(data)
  PracticeRecorder->>PracticeRecorder: normalizePracticeCompletePayload()
  PracticeRecorder->>PracticeRecorder: Resolve examId & session
  PracticeRecorder->>PracticeRecorder: resolvePracticeType()
  PracticeRecorder->>PracticeRecorder: buildRecordMetadata()
  PracticeRecorder->>PracticeRecorder: Merge answer sources
  PracticeRecorder->>PracticeRecorder: Build final record object
  PracticeRecorder->>ScoreStorage: savePracticeRecord(record)
  ScoreStorage->>ScoreStorage: standardizeRecord(recordData)
  ScoreStorage->>ScoreStorage: validateRecord(record)
  ScoreStorage->>dataRepositories: practiceRepo.add(record)
  ScoreStorage->>ScoreStorage: updateUserStats(record)
  ScoreStorage->>dataRepositories: metaRepo.set('user_stats', stats)
  ScoreStorage-->>PracticeRecorder: Success
  PracticeRecorder->>PracticeRecorder: Clean up active session
```

**Key Data Transformations:**

1. **Raw completion data** → `normalizePracticeCompletePayload()` [js/core/practiceRecorder.js L352-L431](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L352-L431)
2. **Normalized payload** → `buildRecordMetadata()` [js/core/practiceRecorder.js L184-L199](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L184-L199)
3. **Complete record** → `standardizeRecord()` [js/core/scoreStorage.js L591-L707](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L591-L707)
4. **Validated record** → Persisted to repositories

**Sources:** [js/practice-page-enhancer.js L914-L1110](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L914-L1110)

 [js/core/practiceRecorder.js L866-L1050](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L866-L1050)

 [js/core/scoreStorage.js L424-L487](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L424-L487)

---

## Data Flow Architecture

### Answer Collection Pipeline

The system employs a multi-stage pipeline to ensure data quality and completeness:

```mermaid
flowchart TD

INPUT["User Input Events"]
LISTENERS["Answer Listeners<br>(setupAnswerListeners)"]
COLLECT["Answer Collectors<br>(collectAnswer,<br>collectAllAnswers)"]
EXTRACT["CorrectAnswerExtractor<br>(extractFromPage)"]
MERGE["mergeAnswerSources()"]
NORMALIZE["normalizeAnswerValue()"]
BUILD["buildAnswerDetails()"]
COMPARISON["normalizeAnswerComparison()"]
VALIDATE["validateRecord()"]
STANDARD["standardizeRecord()"]
PERSIST["Repository.add()"]

COLLECT --> MERGE
BUILD --> VALIDATE
COMPARISON --> VALIDATE

subgraph subGraph2 ["Validation & Persistence"]
    VALIDATE
    STANDARD
    PERSIST
    VALIDATE --> STANDARD
    STANDARD --> PERSIST
end

subgraph subGraph1 ["Normalization Layer"]
    MERGE
    NORMALIZE
    BUILD
    COMPARISON
    MERGE --> NORMALIZE
    NORMALIZE --> BUILD
    NORMALIZE --> COMPARISON
end

subgraph subGraph0 ["Exam Window"]
    INPUT
    LISTENERS
    COLLECT
    EXTRACT
    INPUT --> LISTENERS
    LISTENERS --> COLLECT
    EXTRACT --> COLLECT
end
```

**Answer Source Priority:**
The system merges answers from multiple sources in priority order [js/core/practiceRecorder.js L959-L975](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L959-L975)

:

1. `results.answerMap` (explicit answer map from enhancer)
2. `results.answers` (answer array converted to map)
3. `results.realData.answers` (backup source)
4. `session.answers` (accumulated during session)
5. `results.answerComparison` (extracted from comparison object)

**Correct Answer Source Priority:**
The system merges correct answers from [js/core/practiceRecorder.js L967-L975](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L967-L975)

:

1. `results.correctAnswerMap`
2. `results.correctAnswers`
3. `results.realData.correctAnswers`
4. `results.scoreInfo.details` (extracted)
5. `results.answerComparison` (extracted)
6. `session.correctAnswerMap`

**Sources:** [js/core/practiceRecorder.js L600-L749](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L600-L749)

 [js/core/practiceRecorder.js L959-L1026](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L959-L1026)

 [js/practice-page-enhancer.js L677-L912](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L677-L912)

### Answer Normalization Process

The normalization process handles various input formats and edge cases:

**Normalization Steps:**

| Step | Method | Purpose |
| --- | --- | --- |
| 1. Value normalization | `normalizeAnswerValue()` [js/core/practiceRecorder.js L478-L527](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L478-L527) | Converts any input type to clean string |
| 2. Key standardization | `normalizeAnswerMap()` [js/core/practiceRecorder.js L529-L554](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L529-L554) | Ensures keys follow `q1`, `q2` format |
| 3. Noise filtering | `isNoiseKey()` [js/core/practiceRecorder.js L556-L598](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L556-L598) | Removes non-answer keys (audio controls, etc.) |
| 4. Answer map creation | `convertAnswerMapToArray()` [js/core/practiceRecorder.js L684-L713](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L684-L713) | Converts map to standardized array format |
| 5. Details building | `buildAnswerDetails()` [js/core/practiceRecorder.js L728-L748](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L728-L748) | Creates detailed comparison object |

**Value Normalization Logic:**
The `normalizeAnswerValue()` method handles [js/core/practiceRecorder.js L478-L527](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L478-L527)

:

* `null`/`undefined` → empty string
* Strings → trimmed, filtered for `[object Object]` patterns
* Numbers/booleans → string conversion
* Arrays → comma-joined string
* Objects → extracts from common properties (`value`, `label`, `text`, `answer`, `content`)

**Sources:** [js/core/practiceRecorder.js L478-L765](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L478-L765)

 [js/core/scoreStorage.js L712-L732](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L712-L732)

---

## Key Components and Responsibilities

### Component Interaction Map

```mermaid
flowchart TD

ESM["examSessionMixin"]
SPM["suitePracticeMixin"]
PR["PracticeRecorder"]
PPE["practicePageEnhancer"]
CAE["CorrectAnswerExtractor"]
AS["AnswerSanitizer"]
SS["ScoreStorage"]
REPOS["dataRepositories"]
MSG["postMessage Protocol"]
HANDLERS["Message Handlers"]

ESM --> PPE
PPE --> MSG
HANDLERS --> PR
PR --> AS
PR --> SS

subgraph subGraph3 ["Communication Layer"]
    MSG
    HANDLERS
    MSG --> HANDLERS
end

subgraph subGraph2 ["Persistence Layer"]
    SS
    REPOS
    SS --> REPOS
end

subgraph subGraph1 ["Data Collection Layer"]
    PPE
    CAE
    AS
    PPE --> CAE
    PPE --> AS
end

subgraph subGraph0 ["Session Management Layer"]
    ESM
    SPM
    PR
    ESM --> PR
    SPM --> ESM
end
```

**Sources:** [js/core/practiceRecorder.js L1-L31](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1-L31)

 [js/app/examSessionMixin.js L1-L900](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L1-L900)

 [js/practice-page-enhancer.js L1-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1-L1200)

### PracticeRecorder Responsibilities

`PracticeRecorder` [js/core/practiceRecorder.js L9-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L9-L1200)

 serves as the central session manager:

**Core Responsibilities:**

| Responsibility | Key Methods | File Location |
| --- | --- | --- |
| Session lifecycle | `startPracticeSession()`, `handleSessionCompleted()` | [js/core/practiceRecorder.js L770-L1050](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L770-L1050) |
| Active session tracking | `activeSessions Map`, `restoreActiveSessions()` | [js/core/practiceRecorder.js L11-L243](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L11-L243) |
| Message routing | `handleExamMessage()`, `normalizeIncomingMessage()` | [js/core/practiceRecorder.js L265-L338](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L265-L338) |
| Data normalization | `normalizePracticeCompletePayload()`, `normalizeAnswerMap()` | [js/core/practiceRecorder.js L352-L554](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L352-L554) |
| Type resolution | `resolvePracticeType()`, `lookupExamIndexEntry()` | [js/core/practiceRecorder.js L41-L94](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L41-L94) |
| Metadata building | `buildRecordMetadata()`, `resolveRecordDate()` | [js/core/practiceRecorder.js L96-L199](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L96-L199) |
| Auto-save | `startAutoSave()`, `saveAllSessions()` | [js/core/practiceRecorder.js L1086-L1120](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1086-L1120) |

**State Management:**

* `activeSessions`: `Map<examId, sessionData>` - tracks ongoing sessions
* `sessionListeners`: `Map` - stores event listeners per session
* `practiceTypeCache`: `Map<examId, examEntry>` - caches exam metadata lookups

**Sources:** [js/core/practiceRecorder.js L9-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L9-L1200)

### ScoreStorage Responsibilities

`ScoreStorage` [js/core/scoreStorage.js L5-L850](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L5-L850)

 handles data persistence and validation:

**Core Responsibilities:**

| Responsibility | Key Methods | File Location |
| --- | --- | --- |
| Record standardization | `standardizeRecord()`, `standardizeAnswers()` | [js/core/scoreStorage.js L591-L732](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L591-L732) |
| Record validation | `validateRecord()`, `needsRecordSanitization()` | [js/core/scoreStorage.js L824-L915](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L824-L915) |
| Legacy record repair | `normalizeLegacyRecord()` | [js/core/scoreStorage.js L489-L570](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L489-L570) |
| Statistics calculation | `updateUserStats()`, `updateStreakDays()` | [js/core/scoreStorage.js L917-L1072](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L917-L1072) |
| Storage abstraction | `createStorageAdapter()` | [js/core/scoreStorage.js L220-L287](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L220-L287) |
| Data migration | `migrateData()`, `migrateToV1()` | [js/core/scoreStorage.js L332-L374](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L332-L374) |

**Storage Key Mapping:**

```yaml
storageKeys = {
    practiceRecords: 'practice_records',    // → practiceRepo.list()
    userStats: 'user_stats',                 // → metaRepo.get('user_stats')
    storageVersion: 'storage_version',       // → metaRepo.get('storage_version')
    backupData: 'manual_backups'             // → backupRepo.list()
}
```

**Sources:** [js/core/scoreStorage.js L5-L1070](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L5-L1070)

### practicePageEnhancer Responsibilities

`practicePageEnhancer` [js/practice-page-enhancer.js L298-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L298-L1200)

 operates inside exam windows:

**Core Responsibilities:**

| Responsibility | Key Methods | File Location |
| --- | --- | --- |
| Communication setup | `setupCommunication()`, `startInitRequestLoop()` | [js/practice-page-enhancer.js L372-L450](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L372-L450) |
| Answer collection | `setupAnswerListeners()`, `collectAllAnswers()` | [js/practice-page-enhancer.js L677-L912](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L677-L912) |
| Correct answer extraction | `extractCorrectAnswers()`, `CorrectAnswerExtractor` | [js/practice-page-enhancer.js L19-L675](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L19-L675) |
| Submit interception | `interceptSubmit()` | [js/practice-page-enhancer.js L914-L1050](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L914-L1050) |
| Suite mode guards | `installSuiteGuards()`, `notifySuiteCloseAttempt()` | [js/practice-page-enhancer.js L462-L551](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L462-L551) |
| Result packaging | `buildAnswerComparison()`, `buildScoreInfo()` | [js/practice-page-enhancer.js L1052-L1170](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1052-L1170) |

**State Tracking:**

```yaml
state = {
    sessionId: null,
    examId: null,
    answers: {},                  // User's answers
    correctAnswers: {},           // Extracted correct answers
    interactions: [],             // User interaction events
    startTime: Date.now(),
    suiteModeActive: false,
    suiteSessionId: null
}
```

**Sources:** [js/practice-page-enhancer.js L298-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L298-L1200)

---

## Communication Protocol Overview

### Message Types and Flow

The parent window and exam window communicate via `postMessage` using a structured protocol:

```

```

**Message Type Reference:**

| Message Type | Direction | Payload | Handler |
| --- | --- | --- | --- |
| `REQUEST_INIT` | Exam → Parent | `{examId, url, title}` | Triggers `INIT_SESSION` response |
| `INIT_SESSION` | Parent → Exam | `{sessionId, examId, suiteSessionId?}` | `practicePageEnhancer.setupCommunication()` |
| `SESSION_READY` | Exam → Parent | `{sessionId, pageType, url}` | Confirms enhancer loaded |
| `SESSION_PROGRESS` | Exam → Parent | `{examId, progress, answers}` | `PracticeRecorder.handleSessionProgress()` |
| `PRACTICE_COMPLETE` | Exam → Parent | `{examId, results, answerComparison}` | `PracticeRecorder.handleSessionCompleted()` |
| `SUITE_NAVIGATE` | Parent → Exam | `{url, examId}` | Suite mode navigation |
| `SUITE_CLOSE_ATTEMPT` | Exam → Parent | `{examId, reason}` | User tried to close during suite |
| `SUITE_FORCE_CLOSE` | Parent → Exam | `{}` | Allow window to close |

**Sources:** [js/practice-page-enhancer.js L372-L450](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L372-L450)

 [js/core/practiceRecorder.js L265-L296](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L265-L296)

 [js/app/examSessionMixin.js L683-L828](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L683-L828)

### Handshake Mechanism

The handshake ensures proper session initialization:

```

```

**Handshake Timeout Handling:**

* Enhancer sends `REQUEST_INIT` every 2 seconds [js/practice-page-enhancer.js L442](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L442-L442)
* Timer stops when `INIT_SESSION` received [js/practice-page-enhancer.js L392](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L392-L392)
* Parent waits up to 1500ms before sending init [js/app/examSessionMixin.js L505](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L505-L505)

**Sources:** [js/practice-page-enhancer.js L420-L450](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L420-L450)

 [js/app/examSessionMixin.js L460-L533](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L460-L533)

---

## Single vs Suite Practice Mode

### Mode Comparison Table

| Aspect | Single Practice | Suite Practice |
| --- | --- | --- |
| **Initiator** | `examSessionMixin.openExam()` | `suitePracticeMixin.startSuitePractice()` |
| **Window Strategy** | New window per exam | Reuse same window |
| **Session Tracking** | One `sessionId` | One `suiteSessionId` + multiple sessions |
| **Window Guards** | None | Intercepts `window.close()` and `window.open()` |
| **Navigation** | N/A | Parent sends `SUITE_NAVIGATE` messages |
| **Result Storage** | Single record | Aggregated record + individual entries |
| **Cleanup** | Close window immediately | Cleanup after all exams complete |

**Sources:** [js/app/examSessionMixin.js L89-L176](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L89-L176)

 [js/app/suitePracticeMixin.js L19-L124](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L19-L124)

### Suite Practice Sequence Selection

Suite practice selects three reading passages (P1, P2, P3):

```

```

**Selection Logic:** [js/app/suitePracticeMixin.js L43-L73](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L43-L73)

```javascript
const categories = ['P1', 'P2', 'P3'];
for (const category of categories) {
    const pool = normalizedIndex.filter(item => item.category === category);
    const picked = pool[Math.floor(Math.random() * pool.length)];
    sequence.push({ examId: picked.id, exam: picked });
}
```

**Sources:** [js/app/suitePracticeMixin.js L19-L124](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L19-L124)

### Suite Window Guard System

Suite practice prevents accidental window closure:

**Guard Implementation:**

1. **Close interception** [js/practice-page-enhancer.js L499-L507](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L499-L507) : ```javascript window.close = () => {     notifySuiteCloseAttempt('script_request');     return undefined;  // Prevent actual close }; ```
2. **Navigation interception** [js/practice-page-enhancer.js L508-L517](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L508-L517) : ```javascript window.open = (url, target, features) => {     if (isSelfTarget(target)) {         notifySuiteCloseAttempt('self_target_open');         return window;  // Block navigation     }     return originalOpen(url, target, features); }; ```
3. **Parent notification** [js/practice-page-enhancer.js L545-L552](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L545-L552) : * Sends `SUITE_CLOSE_ATTEMPT` message * Parent handles decision to allow/deny

**Teardown:** [js/practice-page-enhancer.js L520-L543](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L520-L543)

* Restores native `window.close` and `window.open`
* Called when suite completes or aborts

**Sources:** [js/practice-page-enhancer.js L462-L568](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L462-L568)

 [js/app/suitePracticeMixin.js L238-L359](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L238-L359)

---

## Error Handling and Recovery

### Session Recovery Mechanisms

The system includes multiple fallback paths for robustness:

**Recovery Strategies:**

| Failure Scenario | Detection | Recovery Method | Code Location |
| --- | --- | --- | --- |
| Missing session | No matching `activeSessions` entry | Create synthetic session | [js/core/practiceRecorder.js L910-L915](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L910-L915) |
| Missing examId | `examId` null/undefined | Generate fallback ID | [js/core/practiceRecorder.js L902-L903](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L902-L903) |
| Window closed prematurely | `examWindow.closed` check | Temporary record storage | [js/core/practiceRecorder.js L1122-L1177](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1122-L1177) |
| Script injection failure | Timeout on `SESSION_READY` | Inline script fallback | [js/app/examSessionMixin.js L538-L671](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L538-L671) |
| Corrupted record data | Validation failure | Skip save, log error | [js/core/scoreStorage.js L478-L486](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L478-L486) |
| Suite mode abort | Navigation/close errors | Save partial results | [js/app/suitePracticeMixin.js L550-L623](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L550-L623) |

**Temporary Record Recovery:**
When window closes unexpectedly, records are temporarily stored [js/core/practiceRecorder.js L1122-L1177](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1122-L1177)

:

1. Store in `temporary_practice_records` key
2. Attempt recovery on next initialization
3. Clean up temporary storage after successful save

**Sources:** [js/core/practiceRecorder.js L210-L1177](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L210-L1177)

 [js/app/examSessionMixin.js L538-L671](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L538-L671)

### Validation and Sanitization

Records undergo multiple validation stages:

**Validation Pipeline:**

```

```

**Required Fields Check:** [js/core/practiceRecorder.js L394-L398](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L394-L398)

```
if (!examId) {
    return null;  // Cannot proceed without examId
}
```

**Field Type Validation:** [js/core/scoreStorage.js L824-L915](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L824-L915)

* Numeric fields must be `number` type
* String fields must not be empty
* Date fields must parse to valid timestamps
* Arrays must not be null

**Legacy Record Sanitization:**
When loading existing records, sanitization repairs common issues [js/core/scoreStorage.js L439-L448](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L439-L448)

:

* Missing `type` field → inferred from metadata
* Missing numeric fields → derived from answer data
* Corrupted answer maps → rebuilt from details
* Missing metadata → populated with defaults

**Sources:** [js/core/practiceRecorder.js L340-L431](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L340-L431)

 [js/core/scoreStorage.js L424-L915](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L424-L915)

---

## Performance and Optimization

### Caching Strategies

The system uses targeted caching to reduce redundant operations:

**Cache Types:**

| Cache | Data Stored | Invalidation | Purpose |
| --- | --- | --- | --- |
| `practiceTypeCache` | `Map<examId, examEntry>` | Never (session lifetime) | Avoid repeated exam index lookups |
| `activeSessions` | `Map<examId, sessionData>` | On completion/abort | Track in-progress sessions |
| `suiteExamMap` | `Map<examId, suiteSessionId>` | On suite end | Map exams to suite sessions |

**Exam Index Lookup:** [js/core/practiceRecorder.js L41-L69](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L41-L69)

```
if (this.practiceTypeCache.has(examId)) {
    return this.practiceTypeCache.get(examId);  // Cached
}
// Search through multiple sources, then cache result
this.practiceTypeCache.set(examId, entry);
```

**Sources:** [js/core/practiceRecorder.js L25-L69](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L25-L69)

 [js/app/suitePracticeMixin.js L13-L391](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L13-L391)

### Auto-Save and Background Persistence

Sessions are periodically saved to prevent data loss:

**Auto-Save Configuration:**

* Interval: 30 seconds [js/core/practiceRecorder.js L13](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L13-L13)
* Triggers: Timer + `beforeunload` event [js/core/practiceRecorder.js L220-L224](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L220-L224)
* Method: `saveAllSessions()` [js/core/practiceRecorder.js L1086-L1120](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1086-L1120)

**Background Persistence Flow:**

```javascript
// Periodic save
this.autoSaveTimer = setInterval(() => {
    this.saveAllSessions();
}, this.autoSaveInterval);

// Page unload save
window.addEventListener('beforeunload', () => {
    this.saveAllSessions();
});
```

**Active Session Persistence:**
Sessions are stored in `metaRepo` under `active_sessions` key [js/core/practiceRecorder.js L1099-L1120](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1099-L1120)

 enabling recovery after page refresh.

**Sources:** [js/core/practiceRecorder.js L13-L1120](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L13-L1120)