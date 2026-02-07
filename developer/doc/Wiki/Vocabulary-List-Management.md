# Vocabulary List Management

> **Relevant source files**
> * [js/app/browseController.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/browseController.js)
> * [js/app/examActions.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/examActions.js)
> * [js/app/main-entry.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/main-entry.js)
> * [js/app/navigationMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/navigationMixin.js)
> * [js/app/spellingErrorCollector.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js)
> * [js/components/practiceHistory.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js)
> * [js/components/practiceHistoryEnhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistoryEnhancer.js)
> * [js/components/practiceRecordModal.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceRecordModal.js)
> * [js/data/dataSources/storageDataSource.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/data/dataSources/storageDataSource.js)
> * [js/data/index.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/data/index.js)
> * [js/runtime/lazyLoader.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/runtime/lazyLoader.js)
> * [js/utils/markdownExporter.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/markdownExporter.js)

## Purpose and Scope

This document describes the vocabulary list management system, which stores and organizes spelling errors collected from practice sessions. It covers the data structures, storage architecture, deduplication logic, error count tracking, and synchronization to a master list.

For information about how spelling errors are detected during practice sessions, see [Spelling Error Detection System](/sallowayma-git/IELTS-practice/11.1-spelling-error-detection-system). For vocabulary practice features and scheduling, see the more-tools lazy load group documentation.

---

## Vocabulary List Data Structure

### VocabularyList Schema

The system defines a `VocabularyList` type that represents a collection of spelling errors organized by source:

```mermaid
classDiagram
    class VocabularyList {
        +string id
        +string name
        +string source
        +SpellingError[] words
        +number createdAt
        +number updatedAt
        +VocabStats stats
    }
    class SpellingError {
        +string word
        +string userInput
        +string questionId
        +string suiteId
        +string examId
        +number timestamp
        +number errorCount
        +string source
        +Object metadata
    }
    class VocabStats {
        +number totalWords
        +number masteredWords
        +number reviewingWords
    }
    VocabularyList --> SpellingError
    VocabularyList --> VocabStats
```

**Sources:** [js/app/spellingErrorCollector.js L20-L47](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L20-L47)

### SpellingError Properties

| Property | Type | Description |
| --- | --- | --- |
| `word` | string | The correct spelling of the word |
| `userInput` | string | The user's incorrect spelling |
| `questionId` | string | Question identifier where error occurred |
| `suiteId` | string | Optional suite identifier for multi-exam sessions |
| `examId` | string | Exam identifier |
| `timestamp` | number | Unix timestamp when error was recorded |
| `errorCount` | number | Number of times user made this error |
| `source` | string | Source identifier: 'p1', 'p4', or 'other' |
| `metadata` | Object | Optional additional context (difficulty, context, etc.) |

**Sources:** [js/app/spellingErrorCollector.js L20-L32](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L20-L32)

### VocabularyList Properties

| Property | Type | Description |
| --- | --- | --- |
| `id` | string | Unique list identifier (e.g., 'p1', 'p4', 'master') |
| `name` | string | Human-readable list name |
| `source` | string | Source category: 'p1', 'p4', 'all', or 'user' |
| `words` | Array | Array of `SpellingError` objects |
| `createdAt` | number | Unix timestamp of list creation |
| `updatedAt` | number | Unix timestamp of last modification |
| `stats` | Object | Statistics object with `totalWords`, `masteredWords`, `reviewingWords` |

**Sources:** [js/app/spellingErrorCollector.js L34-L47](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L34-L47)

---

## Storage Architecture

### Multiple List Strategy

The system maintains separate vocabulary lists organized by practice source, plus a comprehensive master list:

```mermaid
flowchart TD

IDB["IndexedDB<br>StorageManager"]
P1List["vocab_list_p1_errors<br>(P1 拼写错误词表)"]
P4List["vocab_list_p4_errors<br>(P4 拼写错误词表)"]
MasterList["vocab_list_master_errors<br>(综合拼写错误词表)"]
CustomList["vocab_list_custom<br>(自定义词表)"]
Collector["SpellingErrorCollector"]
StorageKeys["storageKeys<br>{p1, p4, master, custom}"]

StorageKeys -.-> P1List
StorageKeys -.-> P4List
StorageKeys -.-> MasterList
StorageKeys -.-> CustomList
P1List -.-> IDB
P4List -.-> IDB
MasterList -.-> IDB
CustomList -.-> IDB

subgraph SpellingErrorCollector ["SpellingErrorCollector"]
    Collector
    StorageKeys
    Collector -.-> StorageKeys
end

subgraph subGraph1 ["Vocabulary Lists"]
    P1List
    P4List
    MasterList
    CustomList
end

subgraph subGraph0 ["Storage Layer"]
    IDB
end
```

**Sources:** [js/app/spellingErrorCollector.js L52-L71](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L52-L71)

 [js/app/spellingErrorCollector.js L159-L180](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L159-L180)

### Storage Key Configuration

The `SpellingErrorCollector` class defines storage keys for each list type:

| List ID | Storage Key | Purpose |
| --- | --- | --- |
| `p1` | `vocab_list_p1_errors` | Errors from P1 listening practice |
| `p4` | `vocab_list_p4_errors` | Errors from P4 listening practice |
| `master` | `vocab_list_master_errors` | Comprehensive list combining all sources |
| `custom` | `vocab_list_custom` | User-defined custom vocabulary list |

The storage keys are configured in the constructor at [js/app/spellingErrorCollector.js L60-L65](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L60-L65)

### Source Detection Logic

The system automatically categorizes errors by detecting the source from the `examId`:

```mermaid
flowchart TD

Start["detectSource(examId)"]
CheckP1["Contains 'p1',<br>'part1', '100 p1'?"]
CheckP4["Contains 'p4',<br>'part4', '100 p4'?"]
ReturnP1["return 'p1'"]
ReturnP4["return 'p4'"]
ReturnOther["return 'other'"]

Start -.-> CheckP1
CheckP1 -.->|"Yes"| ReturnP1
CheckP1 -.->|"No"| CheckP4
CheckP4 -.->|"Yes"| ReturnP4
CheckP4 -.->|"No"| ReturnOther
```

**Sources:** [js/app/spellingErrorCollector.js L119-L151](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L119-L151)

The detection logic checks for patterns like:

* `p1`, `part1`, `part-1`, `100 p1`, `100p1` → source = 'p1'
* `p4`, `part4`, `part-4`, `100 p4`, `100p4` → source = 'p4'
* Otherwise → source = 'other'

---

## List Management Operations

### Initialization Flow

```mermaid
sequenceDiagram
  participant p1 as SpellingErrorCollector<br/>constructor()
  participant p2 as init()
  participant p3 as window.storage
  participant p4 as storage.ready

  p1->>p2: Async initialization
  p2->>p3: Check if available
  p3-->>p2: Ready promise
  p2->>p4: await storage.ready
  p4-->>p2: Resolved
  p2->>p3: setNamespace('exam_system')
  p3-->>p2: Namespace set
  p2->>p1: initialized = true
  note over p1,p3: Initialization waits for storage<br/>system to be ready before operations
```

**Sources:** [js/app/spellingErrorCollector.js L52-L96](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L52-L96)

### Loading a Vocabulary List

The `loadVocabList(listId)` method retrieves a list from storage:

```mermaid
flowchart TD

Start["loadVocabList(listId)"]
EnsureInit["ensureInitialized()"]
ResolveKey["Resolve storage key<br>from storageKeys map"]
CheckStorage["window.storage<br>available?"]
GetFromStorage["await storage.get(storageKey)"]
CheckExists["List exists?"]
ReturnList["return VocabularyList"]
ReturnNull["return null"]

Start -.-> EnsureInit
EnsureInit -.-> ResolveKey
ResolveKey -.->|"Yes"| CheckStorage
CheckStorage -.->|"No"| ReturnNull
CheckStorage -.-> GetFromStorage
GetFromStorage -.->|"Yes"| CheckExists
CheckExists -.->|"No"| ReturnList
CheckExists -.-> ReturnNull
```

**Sources:** [js/app/spellingErrorCollector.js L182-L211](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L182-L211)

### Creating Empty Lists

When a list doesn't exist, `createEmptyList(listId, source)` generates a new list structure:

| List ID | Default Name |
| --- | --- |
| `p1` | "P1 拼写错误词表" |
| `p4` | "P4 拼写错误词表" |
| `master` | "综合拼写错误词表" |
| `custom` | "自定义词表" |

The method initializes the list with empty `words` array, current timestamps, and zero statistics.

**Sources:** [js/app/spellingErrorCollector.js L159-L180](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L159-L180)

### Saving Vocabulary Lists

The `saveVocabList(vocabList)` method persists changes:

1. **Update Statistics:** Recalculates `stats.totalWords` from `words.length`
2. **Update Timestamp:** Sets `updatedAt` to current timestamp
3. **Resolve Storage Key:** Maps list ID to storage key
4. **Persist to Storage:** Calls `storage.set(storageKey, vocabList)`

**Sources:** [js/app/spellingErrorCollector.js L213-L247](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L213-L247)

---

## Deduplication and Error Count Tracking

### Word Merging Logic

When saving errors to a list, `mergeErrorsToList(vocabList, errors)` implements deduplication:

```mermaid
flowchart TD

Start["mergeErrorsToList(vocabList, errors)"]
ForEach["For each error in errors"]
Normalize["Normalize word<br>(lowercase, trim)"]
Search["Search for existing word<br>in vocabList.words"]
Exists["Word exists?"]
UpdateExisting["Update existing entry:<br>- errorCount++<br>- timestamp = latest<br>- userInput = latest<br>- questionId, examId = latest"]
AddNew["Add new word:<br>- Set errorCount = 1<br>- Keep all properties"]
Continue["Continue to next error"]
End["Return"]

Start -.-> ForEach
ForEach -.-> Normalize
Normalize -.-> Search
Search -.->|"No"| Exists
Exists -.->|"Yes"| UpdateExisting
Exists -.-> AddNew
UpdateExisting -.-> Continue
AddNew -.-> Continue
Continue -.-> ForEach
ForEach -.-> End
```

**Sources:** [js/app/spellingErrorCollector.js L613-L654](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L613-L654)

### Normalization Rules

Words are normalized for comparison using case-insensitive matching:

```javascript
// Normalization at line 622
const normalizedWord = error.word.toLowerCase().trim();

// Finding existing entries at lines 625-627
const existingIndex = vocabList.words.findIndex(w => 
    w.word.toLowerCase().trim() === normalizedWord
);
```

This ensures that "receive", "Receive", and "RECEIVE" are treated as the same word.

**Sources:** [js/app/spellingErrorCollector.js L619-L654](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L619-L654)

### Error Count Tracking

The `errorCount` field tracks how many times a user has misspelled a word:

| Operation | Error Count Behavior |
| --- | --- |
| First error | `errorCount = 1` (new word added) |
| Subsequent error | `errorCount++` (existing word updated) |
| Latest metadata | `userInput`, `questionId`, `examId`, `timestamp` updated to most recent |

This allows vocabulary practice systems to prioritize frequently misspelled words.

**Sources:** [js/app/spellingErrorCollector.js L629-L644](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L629-L644)

---

## Master List Synchronization

### Synchronization Strategy

The system maintains a master list (`vocab_list_master_errors`) that aggregates errors from all sources:

```mermaid
flowchart TD

P1["P1 Errors<br>(p1 source)"]
P4["P4 Errors<br>(p4 source)"]
Other["Other Errors<br>(other source)"]
Group["groupErrorsBySource()"]
SaveP1["saveErrorsToList('p1', ...)"]
SaveP4["saveErrorsToList('p4', ...)"]
Sync["syncToMasterList(all errors)"]
MasterList["Master List<br>(all sources combined)"]

P1 -.-> Group
P4 -.-> Group
Other -.-> Group
SaveP1 -.-> P1
SaveP4 -.-> P4
Sync -.-> MasterList

subgraph Storage ["Storage"]
    MasterList
end

subgraph subGraph1 ["Save Process"]
    Group
    SaveP1
    SaveP4
    Sync
    Group -.-> SaveP1
    Group -.-> SaveP4
    Group -.-> Sync
end

subgraph subGraph0 ["Source Lists"]
    P1
    P4
    Other
end
```

**Sources:** [js/app/spellingErrorCollector.js L535-L685](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L535-L685)

### Save Operation Flow

When `saveErrors(errors)` is called, the following steps occur:

1. **Group by Source:** `groupErrorsBySource(errors)` separates errors into P1, P4, and other categories
2. **Save to Source Lists:** Each group is saved to its respective list via `saveErrorsToList(source, sourceErrors)`
3. **Sync to Master:** All errors are synchronized to the master list via `syncToMasterList(errors)`

```mermaid
sequenceDiagram
  participant p1 as Practice Session
  participant p2 as saveErrors()
  participant p3 as groupErrorsBySource()
  participant p4 as saveErrorsToList()
  participant p5 as syncToMasterList()
  participant p6 as StorageManager

  p1->>p2: errors[]
  p2->>p3: Group by source
  p3-->>p2: {p1: [...], p4: [...]}
  loop For each source
    p2->>p4: saveErrorsToList(source, errors)
    p4->>p6: Load existing list
    p6-->>p4: VocabularyList
    p4->>p4: mergeErrorsToList()
    p4->>p6: Save updated list
  end
  p2->>p5: syncToMasterList(all errors)
  p5->>p6: Load master list
  p6-->>p5: Master VocabularyList
  p5->>p5: mergeErrorsToList()
  p5->>p6: Save master list
  p2-->>p1: Success
```

**Sources:** [js/app/spellingErrorCollector.js L530-L685](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L530-L685)

### Master List Properties

The master list differs from source-specific lists:

* **ID:** `'master'`
* **Source:** `'all'` (indicates aggregation of all sources)
* **Contents:** Contains deduplicated words from P1, P4, and other sources
* **Error Counts:** Reflects cumulative errors across all sources for each word

**Sources:** [js/app/spellingErrorCollector.js L656-L685](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L656-L685)

---

## List Manipulation Operations

### Removing Words

The `removeWord(listId, word)` method deletes a word from a list:

```mermaid
flowchart TD

Start["removeWord(listId, word)"]
Load["loadVocabList(listId)"]
CheckExists["List exists?"]
Normalize["Normalize word<br>(lowercase, trim)"]
Filter["Filter out matching word"]
CheckRemoved["Length changed?"]
Save["saveVocabList(updated)"]
ReturnTrue["return true"]
ReturnFalse["return false"]

Start -.-> Load
Load -.->|"Yes"| CheckExists
CheckExists -.->|"No"| ReturnFalse
CheckExists -.-> Normalize
Normalize -.-> Filter
Filter -.->|"Yes"| CheckRemoved
CheckRemoved -.->|"No"| Save
CheckRemoved -.-> ReturnFalse
Save -.-> ReturnTrue
```

**Sources:** [js/app/spellingErrorCollector.js L687-L722](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L687-L722)

### Clearing Lists

The `clearList(listId)` method removes all words while preserving list metadata:

1. Load the vocabulary list
2. Set `words = []` (empty array)
3. Update `updatedAt` timestamp
4. Save the modified list

This operation retains the list structure (id, name, source) but clears all vocabulary entries.

**Sources:** [js/app/spellingErrorCollector.js L724-L749](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L724-L749)

### Word Count Query

The `getWordCount(listId)` method provides a quick way to check list size without loading full data:

```javascript
// Implementation at lines 250-262
async getWordCount(listId) {
    const list = await this.loadVocabList(listId);
    return list ? list.words.length : 0;
}
```

**Sources:** [js/app/spellingErrorCollector.js L249-L262](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L249-L262)

---

## Integration with Practice Sessions

### Lazy Loading Integration

The `SpellingErrorCollector` is part of the `practice-suite` lazy load group, ensuring it's available when practice sessions complete:

```mermaid
flowchart TD

PracticeSuite["practice-suite group"]
Collector["spellingErrorCollector.js"]
Recorder["practiceRecorder.js"]
ScoreStorage["scoreStorage.js"]
Modal["practiceRecordModal.js"]
Global["window.spellingErrorCollector"]

PracticeSuite -.-> Collector
PracticeSuite -.-> Recorder
PracticeSuite -.-> ScoreStorage
PracticeSuite -.-> Modal
Collector -.-> Global

subgraph subGraph2 ["Global Instance"]
    Global
end

subgraph subGraph1 ["Practice Suite Scripts"]
    Collector
    Recorder
    ScoreStorage
    Modal
end

subgraph subGraph0 ["Lazy Load Groups"]
    PracticeSuite
end
```

**Sources:** [js/runtime/lazyLoader.js L14-L26](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/runtime/lazyLoader.js#L14-L26)

 [js/app/spellingErrorCollector.js L752-L760](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L752-L760)

### Global Instance

A singleton instance is created and exposed globally:

```javascript
// Global instance creation at lines 752-760
window.SpellingErrorCollector = SpellingErrorCollector;

if (!window.spellingErrorCollector) {
    window.spellingErrorCollector = new SpellingErrorCollector();
    console.log('[SpellingErrorCollector] 全局实例已创建');
}
```

This allows other components to access the collector via `window.spellingErrorCollector`.

**Sources:** [js/app/spellingErrorCollector.js L752-L760](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L752-L760)

### Integration Points

The vocabulary list management system integrates with other components:

| Component | Integration Point | Purpose |
| --- | --- | --- |
| Spelling Error Detection | Provides detected errors to save | Errors detected in [11.1](/sallowayma-git/IELTS-practice/11.1-spelling-error-detection-system) are passed to `saveErrors()` |
| Practice Recorder | Session completion triggers save | Practice completion calls collector to store errors |
| Vocabulary Practice | Reads lists for review sessions | Retrieval of words for spaced repetition practice |
| Data Export | Exports vocabulary lists | Lists can be exported via markdown/JSON exporters |

**Sources:** [js/app/spellingErrorCollector.js L270-L310](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L270-L310)

 [js/app/spellingErrorCollector.js L530-L563](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L530-L563)

---

## Data Consistency and Storage

### Storage Manager Integration

The collector relies on `StorageManager` for persistence:

```mermaid
flowchart TD

Init["init()<br>Wait for storage.ready"]
SetNS["setNamespace('exam_system')"]
Ops["Load/Save Operations"]
Ready["storage.ready Promise"]
Namespace["exam_system namespace"]
IDB["IndexedDB Backend"]

Init -.-> Ready
Ready -.-> SetNS
SetNS -.-> Namespace
Ops -.-> Namespace

subgraph StorageManager ["StorageManager"]
    Ready
    Namespace
    IDB
    Namespace -.-> IDB
end

subgraph SpellingErrorCollector ["SpellingErrorCollector"]
    Init
    SetNS
    Ops
end
```

**Sources:** [js/app/spellingErrorCollector.js L73-L96](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L73-L96)

### Initialization Guarantee

The `ensureInitialized()` method ensures storage is ready before operations:

```javascript
// Implementation at lines 99-117
async ensureInitialized() {
    if (this.initialized) {
        return;
    }
    
    // Wait for initialization with timeout (5 seconds)
    let attempts = 0;
    while (!this.initialized && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    if (!this.initialized) {
        throw new Error('SpellingErrorCollector 初始化超时');
    }
}
```

All public methods call `ensureInitialized()` before accessing storage, preventing race conditions.

**Sources:** [js/app/spellingErrorCollector.js L98-L117](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L98-L117)

 [js/app/spellingErrorCollector.js L189](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L189-L189)

 [js/app/spellingErrorCollector.js L220](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L220-L220)

 [js/app/spellingErrorCollector.js L544](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/app/spellingErrorCollector.js#L544-L544)