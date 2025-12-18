# Data Normalization & Quality

> **Relevant source files**
> * [js/components/practiceHistory.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/components/practiceHistory.js)
> * [js/components/practiceHistoryEnhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/components/practiceHistoryEnhancer.js)
> * [js/components/practiceRecordModal.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/components/practiceRecordModal.js)
> * [js/core/practiceRecorder.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js)
> * [js/core/scoreStorage.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js)
> * [js/utils/answerComparisonUtils.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js)
> * [js/utils/logger.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/logger.js)

## Purpose and Scope

This document describes the data normalization and quality assurance systems that ensure practice session data is consistent, accurate, and usable throughout the IELTS practice application. The normalization pipeline processes incoming data from various sources (practice pages, legacy systems, imports) and transforms it into a standardized format.

For information about how normalized data is persisted, see [Storage Architecture & Repositories](/sallowayma-git/IELTS-practice/4.1-storage-architecture-and-repositories). For details on the practice recording workflow that generates this data, see [PracticeRecorder & ScoreStorage](/sallowayma-git/IELTS-practice/5.1-practicerecorder-and-scorestorage).

The normalization system addresses several challenges:

* **Multiple data sources**: Practice pages, suite modes, legacy systems, and imports all produce different data formats
* **Schema evolution**: Older records lack fields present in newer ones
* **User input variations**: Answers may be strings, arrays, objects, or null values
* **Metadata gaps**: Exam titles, categories, and frequencies may be missing or incorrect
* **Noise and artifacts**: Data contains UI state keys (playback speed, volume settings) that must be filtered

---

## The Normalization Pipeline

The normalization process consists of multiple stages that progressively clean, validate, and enrich incoming data.

```mermaid
flowchart TD

RAW["Raw Session Data<br>from Practice Window"]
MSG_NORM["normalizeIncomingMessage"]
PAYLOAD_SHAPE["ensureCompletionPayloadShape"]
ANS_MAP["normalizeAnswerMap"]
ANS_VAL["normalizeAnswerValue"]
ANS_COMP["normalizeAnswerComparison"]
NOISE_FILTER["isNoiseKey filtering"]
MERGE["mergeAnswerSources"]
BUILD_DETAILS["buildAnswerDetails"]
CONV_ARRAY["convertAnswerMapToArray"]
LOOKUP["lookupExamIndexEntry"]
RESOLVE_TYPE["resolvePracticeType"]
BUILD_META["buildRecordMetadata"]
ENRICH["enrichRecordMetadata"]
STD_RECORD["standardizeRecord"]
VALIDATE["validateRecord"]
SANITIZE["normalizeLegacyRecord"]
SAVE["savePracticeRecord"]
STATS["updateUserStats"]

PAYLOAD_SHAPE --> ANS_MAP
PAYLOAD_SHAPE --> ANS_COMP
ANS_VAL --> MERGE
ANS_COMP --> MERGE
BUILD_DETAILS --> LOOKUP
CONV_ARRAY --> RESOLVE_TYPE
ENRICH --> STD_RECORD
SANITIZE --> SAVE

subgraph subGraph5 ["Stage 6: Persistence"]
    SAVE
    STATS
    SAVE --> STATS
end

subgraph subGraph4 ["Stage 5: Record Standardization"]
    STD_RECORD
    VALIDATE
    SANITIZE
    STD_RECORD --> VALIDATE
    VALIDATE --> SANITIZE
end

subgraph subGraph3 ["Stage 4: Metadata Enrichment"]
    LOOKUP
    RESOLVE_TYPE
    BUILD_META
    ENRICH
    LOOKUP --> BUILD_META
    RESOLVE_TYPE --> BUILD_META
    BUILD_META --> ENRICH
end

subgraph subGraph2 ["Stage 3: Data Merging"]
    MERGE
    BUILD_DETAILS
    CONV_ARRAY
    MERGE --> BUILD_DETAILS
    MERGE --> CONV_ARRAY
end

subgraph subGraph1 ["Stage 2: Answer Normalization"]
    ANS_MAP
    ANS_VAL
    ANS_COMP
    NOISE_FILTER
    ANS_MAP --> ANS_VAL
    ANS_MAP --> NOISE_FILTER
end

subgraph subGraph0 ["Stage 1: Initial Reception"]
    RAW
    MSG_NORM
    PAYLOAD_SHAPE
    RAW --> MSG_NORM
    MSG_NORM --> PAYLOAD_SHAPE
end
```

**Sources**: [js/core/practiceRecorder.js L265-L1060](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L265-L1060)

 [js/core/scoreStorage.js L424-L487](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L424-L487)

 [js/utils/answerComparisonUtils.js L346-L490](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L346-L490)

---

## Answer Data Normalization

Answer data arrives in highly inconsistent formats and must be normalized before storage and display.

### Answer Key Normalization

Question identifiers (keys) arrive in various formats that must be canonicalized:

```mermaid
flowchart TD

K1["'1'"]
K2["'q1'"]
K3["'Q1'"]
K4["'question1'"]
K5["'qa'"]
K6["'playback-speed'<br>(noise)"]
PARSE["Extract Number<br>or Letter"]
CHECK["isNoiseKey Check"]
CANON["Canonical Form"]
OUT_NUM["'q1'<br>(numeric)"]
OUT_LETTER["'qa'<br>(letter)"]
OUT_NULL["null<br>(filtered)"]

K1 --> PARSE
K2 --> PARSE
K3 --> PARSE
K4 --> PARSE
K5 --> PARSE
K6 --> CHECK
CHECK --> OUT_NULL
CANON --> OUT_NUM
CANON --> OUT_LETTER

subgraph Output ["Output"]
    OUT_NUM
    OUT_LETTER
    OUT_NULL
end

subgraph subGraph1 ["normalizeKey Process"]
    PARSE
    CHECK
    CANON
    PARSE --> CANON
end

subgraph subGraph0 ["Input Key Formats"]
    K1
    K2
    K3
    K4
    K5
    K6
end
```

The `normalizeKey` function extracts question numbers and produces canonical keys:

| Input | Canonical Key | Question Number | Notes |
| --- | --- | --- | --- |
| `"1"` | `"q1"` | `1` | Simple number |
| `"q1"` | `"q1"` | `1` | Already canonical |
| `"question1"` | `"q1"` | `1` | Verbose format |
| `"qa"` | `"qa"` | `null` | Letter-based question |
| `"q201"` | `null` | `null` | Out of range (max 200) |
| `"playback-speed"` | `null` | `null` | Noise key |

**Sources**: [js/utils/answerComparisonUtils.js L62-L123](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L62-L123)

 [js/core/practiceRecorder.js L556-L598](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L556-L598)

### Answer Value Normalization

Answer values must be extracted from various container types and sanitized:

```mermaid
flowchart TD

INPUT["Input Value<br>(any type)"]
CHECK_NULL["null or<br>undefined?"]
CHECK_ARRAY["Array?"]
CHECK_OBJ["Object?"]
CHECK_STR["String?"]
CHECK_PRIM["Number or<br>Boolean?"]
RET_EMPTY["Return ''"]
JOIN_ARRAY["Join items<br>with ','"]
EXTRACT_OBJ["Extract from<br>value/answer/text"]
FILTER_OBJECT["Filter [object Object]<br>patterns"]
TRIM_STR["Trim whitespace"]
TO_STR["Convert to string"]
FINAL["Normalized<br>String Value"]

INPUT --> CHECK_NULL
CHECK_NULL --> RET_EMPTY
CHECK_NULL --> CHECK_ARRAY
CHECK_ARRAY --> JOIN_ARRAY
CHECK_ARRAY --> CHECK_OBJ
CHECK_OBJ --> EXTRACT_OBJ
CHECK_OBJ --> CHECK_STR
EXTRACT_OBJ --> FILTER_OBJECT
FILTER_OBJECT --> TRIM_STR
CHECK_STR --> TRIM_STR
CHECK_STR --> CHECK_PRIM
CHECK_PRIM --> TO_STR
TO_STR --> TRIM_STR
JOIN_ARRAY --> TRIM_STR
TRIM_STR --> FINAL
RET_EMPTY --> FINAL
```

Key normalization rules:

* **Null/undefined** → empty string
* **Arrays** → comma-separated values
* **Objects** → extract from `value`, `answer`, `text`, or `content` fields
* **Invalid object strings** → filtered (e.g., `"[object Object]"`)
* **Primitives** → converted to trimmed strings

**Sources**: [js/core/practiceRecorder.js L478-L527](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L478-L527)

 [js/utils/answerComparisonUtils.js L125-L198](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L125-L198)

### Noise Key Filtering

Noise keys (UI state, configuration) are systematically removed:

```

```

**Sources**: [js/core/practiceRecorder.js L556-L598](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L556-L598)

 [js/utils/answerComparisonUtils.js L101-L123](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L101-L123)

---

## Answer Comparison Normalization

The `answerComparison` structure merges user answers and correct answers with correctness flags.

### Comparison Data Flow

```mermaid
flowchart TD

SRC1["payload.answerComparison"]
SRC2["realData.answerComparison"]
SRC3["scoreInfo.details"]
SRC4["answers map"]
SRC5["correctAnswers map"]
EXT_USER["Extract User Answers<br>userAnswer / user / answer"]
EXT_CORRECT["Extract Correct Answers<br>correctAnswer / correct"]
NORM_COMP["normalizeAnswerComparison"]
NORM_VAL["normalizeForComparison"]
MATCH["answersMatch"]
BUILD["Build Entry<br>with isCorrect flag"]
ENTRIES["Normalized Entries Array<br>[{canonicalKey, userAnswer,<br>correctAnswer, isCorrect}]"]

SRC1 --> EXT_USER
SRC2 --> EXT_USER
SRC3 --> EXT_USER
SRC4 --> EXT_USER
SRC1 --> EXT_CORRECT
SRC2 --> EXT_CORRECT
SRC3 --> EXT_CORRECT
SRC5 --> EXT_CORRECT
EXT_USER --> NORM_COMP
EXT_CORRECT --> NORM_COMP
NORM_VAL --> MATCH
BUILD --> ENTRIES

subgraph Output ["Output"]
    ENTRIES
end

subgraph subGraph3 ["Comparison Phase"]
    MATCH
    BUILD
    MATCH --> BUILD
end

subgraph subGraph2 ["Normalization Phase"]
    NORM_COMP
    NORM_VAL
    NORM_COMP --> NORM_VAL
end

subgraph subGraph1 ["Extraction Phase"]
    EXT_USER
    EXT_CORRECT
end

subgraph subGraph0 ["Input Sources"]
    SRC1
    SRC2
    SRC3
    SRC4
    SRC5
end
```

### Answer Matching Logic

The `answersMatch` function performs case-insensitive comparison with special handling:

```

```

**Sources**: [js/utils/answerComparisonUtils.js L180-L198](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L180-L198)

 [js/utils/answerComparisonUtils.js L44-L60](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L44-L60)

 [js/core/practiceRecorder.js L651-L682](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L651-L682)

---

## Practice Record Standardization

Practice records undergo multi-stage standardization to ensure consistent structure.

### Record Structure

The standardized record schema:

```mermaid
flowchart TD

META["metadata: object"]
FREQ["frequency: string"]
SUITE["suiteMode: boolean"]
SUITE_ID["suiteSessionId: string"]
SUITE_ENT["suiteEntries: array"]
ANSWERS["answers: array"]
DETAILS["answerDetails: object"]
CORRECT_MAP["correctAnswerMap: object"]
COMPARISON["answerComparison: object"]
STATUS["status: 'completed'"]
SCORE["score: number"]
TOTAL["totalQuestions: number"]
CORRECT["correctAnswers: number"]
ACCURACY["accuracy: number (0-1)"]
START["startTime: ISO string"]
END["endTime: ISO string"]
DURATION["duration: number (seconds)"]
DATE["date: ISO string"]
ID["id: string"]
EXAM_ID["examId: string"]
SESSION["sessionId: string"]
TITLE["title: string"]
TYPE["type: 'reading'|'listening'"]

subgraph Metadata ["Metadata"]
    META
    FREQ
    SUITE
    SUITE_ID
    SUITE_ENT
end

subgraph subGraph3 ["Answer Data"]
    ANSWERS
    DETAILS
    CORRECT_MAP
    COMPARISON
end

subgraph subGraph2 ["Score Fields"]
    STATUS
    SCORE
    TOTAL
    CORRECT
    ACCURACY
end

subgraph subGraph1 ["Time Fields"]
    START
    END
    DURATION
    DATE
end

subgraph subGraph0 ["Base Fields"]
    ID
    EXAM_ID
    SESSION
    TITLE
    TYPE
end
```

**Sources**: [js/core/scoreStorage.js L591-L707](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L591-L707)

 [js/core/practiceRecorder.js L990-L1026](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L990-L1026)

### Field Resolution Strategy

The system uses fallback chains to resolve missing fields:

| Field | Resolution Order | Fallback |
| --- | --- | --- |
| `totalQuestions` | `recordData.totalQuestions` → `scoreInfo.total` → `answers.length` → `0` |  |
| `correctAnswers` | `recordData.correctAnswers` → `scoreInfo.correct` → count from `answerDetails` → `0` |  |
| `date` | `metadata.date` → `date` → `endTime` → `startTime` → `now` |  |
| `type` | `metadata.type` → `examType` → infer from `examId` → `'reading'` |  |
| `examTitle` | `metadata.examTitle` → `title` → exam index lookup → `examId` |  |

**Sources**: [js/core/scoreStorage.js L86-L187](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L86-L187)

 [js/core/practiceRecorder.js L96-L105](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L96-L105)

### Type Inference

Practice type is resolved through multiple strategies:

```mermaid
flowchart TD

START["resolvePracticeType()"]
CHECK_META["metadata.type<br>exists?"]
CHECK_ENTRY["examEntry.type<br>exists?"]
CHECK_ID["examId contains<br>'listening'?"]
NORMALIZE["normalizePracticeType<br>listening/reading"]
RET_LISTEN["Return 'listening'"]
RET_READ["Return 'reading'"]

START --> CHECK_META
CHECK_META --> NORMALIZE
CHECK_META --> CHECK_ENTRY
CHECK_ENTRY --> NORMALIZE
CHECK_ENTRY --> CHECK_ID
CHECK_ID --> RET_LISTEN
CHECK_ID --> RET_READ
NORMALIZE --> RET_LISTEN
NORMALIZE --> RET_READ
```

**Sources**: [js/core/practiceRecorder.js L71-L94](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L71-L94)

 [js/core/scoreStorage.js L26-L43](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L26-L43)

---

## Metadata Enrichment

Metadata enrichment resolves missing information by looking up exam entries in global indexes.

### Exam Index Lookup

```mermaid
flowchart TD

START["lookupExamIndexEntry(examId)"]
CHECK_CACHE["practiceTypeCache<br>has entry?"]
RET_CACHE["Return cached entry"]
TRY_EXAM["Try window.examIndex"]
TRY_COMPLETE["Try window.completeExamIndex"]
TRY_LISTEN["Try window.listeningExamIndex"]
FIND["Found match<br>by examId?"]
CACHE_ENTRY["Cache entry"]
CACHE_NULL["Cache null"]
RET_ENTRY["Return entry"]
RET_NULL["Return null"]

START --> CHECK_CACHE
CHECK_CACHE --> RET_CACHE
CHECK_CACHE --> TRY_EXAM
TRY_EXAM --> FIND
FIND --> TRY_COMPLETE
TRY_COMPLETE --> FIND
FIND --> TRY_LISTEN
TRY_LISTEN --> FIND
FIND --> CACHE_ENTRY
CACHE_ENTRY --> RET_ENTRY
FIND --> CACHE_NULL
CACHE_NULL --> RET_NULL
```

The system searches multiple exam index arrays in sequence:

1. `window.examIndex` - primary reading exams
2. `window.completeExamIndex` - full exam collection
3. `window.listeningExamIndex` - listening exams

Each entry contains `id`, `title`, `category`, `frequency`, and `type` fields used for enrichment.

**Sources**: [js/core/practiceRecorder.js L41-L69](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L41-L69)

 [js/utils/answerComparisonUtils.js L529-L661](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L529-L661)

### Metadata Building

The `buildRecordMetadata` function constructs complete metadata:

```

```

**Sources**: [js/core/practiceRecorder.js L184-L199](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L184-L199)

 [js/core/scoreStorage.js L65-L79](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L65-L79)

### Enhanced Metadata from AnswerComparisonUtils

The `enrichRecordMetadata` function in `answerComparisonUtils.js` provides additional enrichment:

* **ID matching**: Exact and fuzzy matching against exam indexes
* **URL path matching**: Matches exam paths from full database URLs
* **Title matching**: Exact and fuzzy title comparison with tag removal
* **Category inference**: Extracts P1/P2/P3 from IDs and titles

**Sources**: [js/utils/answerComparisonUtils.js L550-L757](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L550-L757)

---

## Data Quality Assurance

### Legacy Record Repair

The `normalizeLegacyRecord` function repairs older records with missing or malformed data:

```mermaid
flowchart TD

INPUT["Legacy Record"]
CHECK["needsRecordSanitization?"]
PATCH_TYPE["Infer missing type field"]
PATCH_META["Build missing metadata"]
PATCH_ANS["Standardize answers array"]
PATCH_CORRECT["Derive correctAnswerMap"]
PATCH_DETAILS["Build answerDetails"]
PATCH_NUMS["Derive total/correct counts"]
PATCH_TIME["Fill missing timestamps"]
PATCH_SCORE["Build missing scoreInfo"]
OUTPUT["Normalized Record"]

INPUT --> CHECK
CHECK --> PATCH_TYPE
CHECK --> OUTPUT
PATCH_TYPE --> PATCH_META
PATCH_META --> PATCH_ANS
PATCH_ANS --> PATCH_CORRECT
PATCH_CORRECT --> PATCH_DETAILS
PATCH_DETAILS --> PATCH_NUMS
PATCH_NUMS --> PATCH_TIME
PATCH_TIME --> PATCH_SCORE
PATCH_SCORE --> OUTPUT
```

The repair process:

1. **Type inference**: Uses `inferPracticeType` to determine reading vs listening
2. **Metadata construction**: Calls `buildMetadata` to create complete metadata
3. **Answer standardization**: Converts various answer formats to standard array
4. **Correct answer derivation**: Extracts from `scoreInfo.details` or `answerDetails`
5. **Count derivation**: Uses `deriveTotalQuestionCount` and `deriveCorrectAnswerCount`
6. **Timestamp filling**: Ensures `startTime` and `endTime` are present
7. **ScoreInfo reconstruction**: Rebuilds missing `scoreInfo` structure

**Sources**: [js/core/scoreStorage.js L489-L570](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L489-L570)

 [js/core/scoreStorage.js L572-L586](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L572-L586)

### Validation Rules

The `validateRecord` function enforces data integrity constraints:

```

```

**Sources**: [js/core/scoreStorage.js L847-L893](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L847-L893)

### Deduplication Strategy

The system prevents duplicate records using multiple ID checks:

```

```

**Sources**: [js/core/scoreStorage.js L434-L458](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L434-L458)

---

## Implementation Reference

### Core Classes and Methods

| Class | Key Methods | Purpose |
| --- | --- | --- |
| `PracticeRecorder` | `normalizeAnswerMap``normalizeAnswerValue``normalizeAnswerComparison``buildAnswerDetails``resolvePracticeType``buildRecordMetadata` | Primary normalization engine for incoming session data |
| `ScoreStorage` | `standardizeRecord``normalizeLegacyRecord``validateRecord``inferPracticeType``deriveTotalQuestionCount``deriveCorrectAnswerCount` | Storage-layer standardization and validation |
| `AnswerComparisonUtils` | `getNormalizedEntries``normalizeKey``normalizeForComparison``enrichRecordMetadata``answersMatch` | Cross-source answer comparison normalization |
| `DataConsistencyManager` | `ensureConsistency` | High-level consistency enforcement wrapper |

**Sources**: [js/core/practiceRecorder.js L1-L1060](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1-L1060)

 [js/core/scoreStorage.js L1-L1000](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L1-L1000)

 [js/utils/answerComparisonUtils.js L1-L783](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/answerComparisonUtils.js#L1-L783)

### Normalization Entry Points

```mermaid
flowchart TD

MSG["postMessage handler"]
IMPORT["Data import"]
LEGACY["Legacy migration"]
PR["PracticeRecorder<br>handleSessionCompleted"]
SS["ScoreStorage<br>savePracticeRecord"]
REPO["PracticeRepository<br>save"]

MSG --> PR
IMPORT --> SS
LEGACY --> SS
SS --> REPO

subgraph Persistence ["Persistence"]
    REPO
end

subgraph subGraph1 ["Normalization Layer"]
    PR
    SS
    PR --> SS
end

subgraph subGraph0 ["External Entry Points"]
    MSG
    IMPORT
    LEGACY
end
```

**Sources**: [js/core/practiceRecorder.js L866-L1060](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L866-L1060)

 [js/core/scoreStorage.js L424-L487](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L424-L487)

### Fallback Mechanisms

The system implements defensive programming with fallback chains:

```

```

**Sources**: [js/core/practiceRecorder.js L959-L975](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L959-L975)

 [js/core/scoreStorage.js L65-L79](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L65-L79)

---

## Quality Metrics

The normalization system provides several quality indicators:

### Completeness Metrics

```

```

### Data Source Tracking

Records track their data sources for debugging:

```

```

**Sources**: [js/core/practiceRecorder.js L1013-L1021](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js#L1013-L1021)

 [js/core/scoreStorage.js L688-L699](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js#L688-L699)