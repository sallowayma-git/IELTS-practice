# Storage Architecture & Multi-Backend System

> **Relevant source files**
> * [js/core/practiceRecorder.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/practiceRecorder.js)
> * [js/core/scoreStorage.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js)
> * [js/utils/dataBackupManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/dataBackupManager.js)
> * [js/utils/storage.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js)

## Purpose and Scope

This document details the multi-tier storage architecture that provides reliable, performant data persistence for the IELTS practice system. It covers the `StorageManager` backend hierarchy (IndexedDB → localStorage → sessionStorage → in-memory), the repository abstraction layer, and integration with higher-level components like `ScoreStorage`. For information about how practice records flow through the system and are processed before storage, see [PracticeRecorder & ScoreStorage](/sallowayma-git/IELTS-practice/4.2-practicerecorder-and-scorestorage). For backup and import/export operations, see [Data Backup, Import & Export](/sallowayma-git/IELTS-practice/4.4-data-backup-import-and-export).

---

## System Overview

The storage system implements a resilient, multi-backend architecture with automatic fallback capabilities. Data flows through three distinct layers:

1. **Repository Layer**: High-level abstractions (`PracticeRepository`, `MetaRepository`, `BackupRepository`) that provide structured access patterns
2. **Storage Adapter Layer**: `StorageDataSource` queues operations and delegates to the backend
3. **Backend Layer**: `StorageManager` manages the physical storage backends with automatic fallback

```mermaid
flowchart TD

ScoreStorage["ScoreStorage<br>(Record Validation)"]
PracticeRecorder["PracticeRecorder<br>(Session Management)"]
DataBackup["DataBackupManager<br>(Import/Export)"]
Registry["DataRepositoryRegistry<br>(window.dataRepositories)"]
PracticeRepo["PracticeRepository<br>(practice_records)"]
MetaRepo["MetaRepository<br>(user_stats, settings)"]
BackupRepo["BackupRepository<br>(manual_backups)"]
StorageDS["StorageDataSource<br>(Queue & Cache)"]
StorageManager["StorageManager<br>(window.storage)"]
IDB["IndexedDB<br>ExamSystemDB<br>(Primary, 100MB+)"]
LS["localStorage<br>(Mirror/Fallback, 5MB)"]
SS["sessionStorage<br>(Volatile)"]
Mem["In-Memory Map<br>(Last Resort)"]

ScoreStorage -.-> PracticeRepo
ScoreStorage -.-> MetaRepo
ScoreStorage -.-> BackupRepo
PracticeRecorder -.-> PracticeRepo
PracticeRecorder -.-> MetaRepo
DataBackup -.-> StorageManager
PracticeRepo -.-> StorageDS
MetaRepo -.-> StorageDS
BackupRepo -.-> StorageDS
StorageDS -.-> StorageManager
StorageManager -.-> IDB
StorageManager -.-> LS
StorageManager -.-> SS
StorageManager -.-> Mem

subgraph subGraph4 ["Physical Backends"]
    IDB
    LS
    SS
    Mem
end

subgraph subGraph3 ["Backend Manager"]
    StorageManager
end

subgraph subGraph2 ["Adapter Layer"]
    StorageDS
end

subgraph subGraph1 ["Repository Layer"]
    Registry
    PracticeRepo
    MetaRepo
    BackupRepo
    Registry -.-> PracticeRepo
    Registry -.-> MetaRepo
    Registry -.-> BackupRepo
end

subgraph subGraph0 ["Application Layer"]
    ScoreStorage
    PracticeRecorder
    DataBackup
end
```

**Sources:** [js/utils/storage.js L1-L234](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1-L234)

 [js/core/scoreStorage.js L1-L34](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L1-L34)

 [js/core/practiceRecorder.js L1-L36](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/practiceRecorder.js#L1-L36)

---

## StorageManager: Multi-Backend Core

The `StorageManager` class [js/utils/storage.js L5-L2089](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L5-L2089)

 implements the foundational storage layer with multi-tier backend support, automatic fallback, and namespace isolation.

### Backend Hierarchy

```mermaid
flowchart TD

WriteStart["set(key, value)"]
CheckFallback["fallbackStorage<br>active?"]
FallbackWrite["fallbackStorage.set()"]
TryIDB["setToIndexedDB()"]
TryLocal["localStorage.setItem()"]
TrySession["sessionStorage.setItem()"]
Fallback["In-Memory Map<br>(this.fallbackStorage)"]
IDB["IndexedDB<br>(this.indexedDB)"]
Local["localStorage<br>(5MB quota)"]
Session["sessionStorage<br>(volatile)"]
ReadStart["get(key, default)"]
CheckMem["fallbackStorage<br>has key?"]
ReadIDB["getFromIndexedDB()"]
ReadLocal["localStorage.getItem()"]
ReadSession["sessionStorage.getItem()"]
ReturnDefault["return default"]

CheckMem -.->|"Yes"| Fallback
ReadIDB -.->|"Found"| Local
ReadLocal -.->|"Not Found"| Session

subgraph subGraph2 ["Read Flow"]
    ReadStart
    CheckMem
    ReadIDB
    ReadLocal
    ReadSession
    ReturnDefault
    ReadStart -.->|"No"| CheckMem
    CheckMem -.->|"Not Found"| ReadIDB
    ReadIDB -.->|"Found"| ReadLocal
    ReadLocal -.->|"Not Found"| ReadSession
    ReadSession -.-> ReturnDefault
end

subgraph subGraph0 ["Backend Priority"]
    Fallback
    IDB
    Local
    Session
end

subgraph subGraph1 ["Write Flow"]
    WriteStart
    CheckFallback
    FallbackWrite
    TryIDB
    TryLocal
    TrySession
    WriteStart -.-> CheckFallback
    CheckFallback -.->|"Yes"| FallbackWrite
    CheckFallback -.->|"No"| TryIDB
    TryIDB -.->|"Success"| TryLocal
    TryIDB -.->|"Fail"| TryLocal
    TryLocal -.->|"Success"| TrySession
    TryLocal -.->|"Fail"| TrySession
    TrySession -.->|"Fail"| FallbackWrite
end
```

**Sources:** [js/utils/storage.js L594-L721](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L594-L721)

 [js/utils/storage.js L796-L853](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L796-L853)

### Key Storage Features

| Feature | Implementation | Purpose |
| --- | --- | --- |
| **Namespace Isolation** | `this.prefix = 'exam_system_'` | Prevents key collisions with other apps |
| **Persistent Key Set** | `this.persistentKeys` Set | Marks keys requiring durable storage |
| **Backend Preference** | `exam_system_storage_backend` | Remembers user's preferred backend |
| **IndexedDB Schema** | `ExamSystemDB` v1, `keyValueStore` objectStore | Structured storage for key-value pairs |
| **Quota Monitoring** | `checkStorageQuota()`, periodic cleanup | Prevents quota exceeded errors |
| **Hybrid Mode** | IndexedDB + localStorage dual-write | Ensures data availability across backends |

**Sources:** [js/utils/storage.js L6-L31](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L6-L31)

 [js/utils/storage.js L149-L234](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L149-L234)

### Initialization Sequence

```mermaid
sequenceDiagram
  participant p1 as Application
  participant p2 as StorageManager
  participant p3 as IndexedDB
  participant p4 as localStorage
  participant p5 as Migration Logic

  p1->>p2: new StorageManager()
  p2->>p2: checkStorageAvailability(localStorage)
  p2->>p2: checkStorageAvailability(sessionStorage)
  p2->>p3: indexedDB.open('ExamSystemDB', 1)
  p3-->>p2: onupgradeneeded (if new)
  p2->>p3: createObjectStore('keyValueStore')
  p3-->>p2: onsuccess
  p2->>p4: Scan localStorage keys
  p2->>p5: migrateFromLocalStorage()
  loop For each legacy key
    p5->>p4: localStorage.getItem(key)
    p5->>p3: setToIndexedDB(key, value)
    p5->>p4: localStorage.removeItem(key)
  end
  p2->>p2: get('system_version')
  alt No version found
    p2->>p2: initializeDefaultData()
    p2->>p2: set('system_version', '1.0.0')
  else Version mismatch
    p2->>p2: handleVersionUpgrade(oldVersion)
  end
  p2->>p2: restoreFromBackup() (if needed)
  p2-->>p1: ready Promise resolves
```

**Sources:** [js/utils/storage.js L89-L144](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L89-L144)

 [js/utils/storage.js L149-L234](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L149-L234)

 [js/utils/storage.js L273-L312](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L273-L312)

---

## Write Path: Persistent vs Volatile Keys

The storage system distinguishes between **persistent keys** (must survive browser restarts) and **volatile keys** (can use session storage). This distinction drives the fallback logic.

### Persistent Key Write Path

```mermaid
flowchart TD

Start["set('practice_records', data)"]
CheckPersistent["key in<br>persistentKeys?"]
TryIDB["Try IndexedDB<br>setToIndexedDB()"]
IDBSuccess["Success?"]
TryLS["Try localStorage<br>localStorage.setItem()"]
LSSuccess["Success?"]
BothCheck["IDB OR LS<br>succeeded?"]
DualWrite["Attempt dual-write<br>to both backends"]
SuccessReturn["return true<br>dispatchStorageSync()"]
FailThrow["throw Error<br>'No persistent storage'"]

Start -.->|"Yes"| CheckPersistent
CheckPersistent -.->|"Yes"| TryIDB

subgraph subGraph0 ["Persistent Path (Required Durability)"]
    TryIDB
    IDBSuccess
    TryLS
    LSSuccess
    BothCheck
    DualWrite
    SuccessReturn
    FailThrow
    TryIDB -.->|"No"| IDBSuccess
    IDBSuccess -.-> TryLS
    IDBSuccess -.-> TryLS
    TryLS -.-> LSSuccess
    LSSuccess -.->|"At least one"| BothCheck
    BothCheck -.->|"Both failed"| DualWrite
    BothCheck -.-> FailThrow
    DualWrite -.-> SuccessReturn
end
```

**Persistent Keys:** [js/utils/storage.js L14-L26](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L14-L26)

```
this.persistentKeys = new Set([
    'practice_records',
    'user_stats',
    'manual_backups',
    'backup_settings',
    'export_history',
    'import_history',
    'exam_index',
    'exam_index_configurations',
    'active_exam_index_key',
    'settings',
    'learning_goals'
]);
```

**Write Logic:** [js/utils/storage.js L594-L721](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L594-L721)

### Volatile Key Write Path

For non-persistent keys, the system can fall back to sessionStorage:

```mermaid
flowchart TD

Start["set('temp_data', value)"]
CheckPersistent["key in<br>persistentKeys?"]
TryIDB["Try IndexedDB"]
IDBFail["Failed?"]
TryLS["Try localStorage"]
LSFail["Failed?"]
TrySS["Try sessionStorage<br>sessionStorage.setItem()"]
SSSuccess["Success?"]
FallbackMem["Use in-memory Map<br>fallbackStorage.set()"]
Return["return true"]

Start -.-> CheckPersistent
CheckPersistent -.->|"No"| TryIDB

subgraph subGraph0 ["Volatile Path (Session OK)"]
    TryIDB
    IDBFail
    TryLS
    LSFail
    TrySS
    SSSuccess
    FallbackMem
    Return
    TryIDB -.->|"Yes"| IDBFail
    IDBFail -.->|"Yes"| TryLS
    TryLS -.-> LSFail
    LSFail -.->|"No"| TrySS
    TrySS -.->|"Yes"| SSSuccess
    SSSuccess -.-> Return
    SSSuccess -.-> FallbackMem
    FallbackMem -.-> Return
end
```

**Sources:** [js/utils/storage.js L676-L721](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L676-L721)

---

## Read Path & Backend Selection

Reads follow a priority order optimized for speed: in-memory → IndexedDB → localStorage → sessionStorage.

```mermaid
flowchart TD

Start["get(key, defaultValue)"]
CheckMem["fallbackStorage<br>exists?"]
ReadMem["Get from memory<br>fallbackStorage.get()"]
MemFound["Found?"]
TryIDB["Try IndexedDB<br>getFromIndexedDB()"]
IDBFound["Found?"]
TryLS["Try localStorage<br>localStorage.getItem()"]
LSFound["Found?"]
TrySS["Try sessionStorage<br>sessionStorage.getItem()"]
SSFound["Found?"]
ParseData["Parse JSON<br>extract data field"]
ReturnDefault["return defaultValue"]
ReturnData["return parsed.data"]

Start -.-> CheckMem
CheckMem -.->|"Yes"| ReadMem
CheckMem -.->|"No"| TryIDB
ReadMem -.->|"No"| MemFound
MemFound -.->|"Yes"| ParseData
MemFound -.->|"No"| TryIDB
TryIDB -.-> IDBFound
IDBFound -.->|"Yes"| ParseData
IDBFound -.->|"No"| TryLS
TryLS -.->|"Yes"| LSFound
LSFound -.->|"Yes"| ParseData
LSFound -.->|"No"| TrySS
TrySS -.-> SSFound
SSFound -.-> ParseData
SSFound -.-> ReturnDefault
ParseData -.-> ReturnData
```

**Data Envelope Format:** All stored values are wrapped in a metadata envelope [js/utils/storage.js L625-L630](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L625-L630)

:

```yaml
{
    data: compressedValue,
    timestamp: Date.now(),
    version: this.version,
    compressed: compressedValue !== value
}
```

**Sources:** [js/utils/storage.js L796-L853](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L796-L853)

---

## Repository Abstraction Layer

The repository layer provides structured access patterns and transaction support. `ScoreStorage` uses repositories instead of accessing `StorageManager` directly.

### Repository Structure

```mermaid
flowchart TD

Adapter["createStorageAdapter()"]
Get["get(key, default)"]
Set["set(key, value)"]
Remove["remove(key)"]
Route["Switch on key"]
PracticeKey["practiceRecords"]
StatsKey["userStats"]
VersionKey["storageVersion"]
BackupKey["backupData"]
DefaultKey["other keys"]
PracticeRepo["practiceRepo.list()<br>practiceRepo.overwrite()"]
MetaRepo["metaRepo.get()<br>metaRepo.set()"]
BackupRepo["backupRepo.list()<br>backupRepo.saveAll()"]

Get -.-> Route
Set -.-> Route
Remove -.-> Route
PracticeKey -.-> PracticeRepo
StatsKey -.-> MetaRepo
VersionKey -.-> MetaRepo
BackupKey -.-> BackupRepo
DefaultKey -.-> MetaRepo

subgraph subGraph2 ["Repository Instances"]
    PracticeRepo
    MetaRepo
    BackupRepo
end

subgraph subGraph1 ["Repository Routing"]
    Route
    PracticeKey
    StatsKey
    VersionKey
    BackupKey
    DefaultKey
    Route -.-> PracticeKey
    Route -.-> StatsKey
    Route -.-> VersionKey
    Route -.-> BackupKey
    Route -.-> DefaultKey
end

subgraph subGraph0 ["ScoreStorage Adapter"]
    Adapter
    Get
    Set
    Remove
    Adapter -.-> Get
    Adapter -.-> Set
    Adapter -.-> Remove
end
```

**ScoreStorage Adapter Implementation:** [js/core/scoreStorage.js L286-L353](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L286-L353)

The adapter translates between `ScoreStorage`'s key-based API and the repository pattern:

| Key | Repository | Operation Mapping |
| --- | --- | --- |
| `practiceRecords` | `PracticeRepository` | `get` → `list()`, `set` → `overwrite()` |
| `userStats` | `MetaRepository` | `get` → `get('user_stats')`, `set` → `set('user_stats')` |
| `storageVersion` | `MetaRepository` | Direct pass-through |
| `backupData` / `manual_backups` | `BackupRepository` | `get` → `list()`, `set` → `saveAll()` |
| Other keys | `MetaRepository` | Direct pass-through |

**Sources:** [js/core/scoreStorage.js L286-L353](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L286-L353)

### Repository Initialization

Repositories are initialized separately from `StorageManager` and must be available before `ScoreStorage` construction:

```mermaid
sequenceDiagram
  participant p1 as Application
  participant p2 as StorageManager
  participant p3 as DataRepositoryRegistry
  participant p4 as ScoreStorage

  p1->>p2: new StorageManager()
  p2->>p2: initializeStorage()
  p2-->>p1: ready Promise
  p1->>p3: Initialize repositories
  p3->>p3: Create PracticeRepository
  p3->>p3: Create MetaRepository
  p3->>p3: Create BackupRepository
  p3->>p3: Expose as window.dataRepositories
  p1->>p4: new ScoreStorage()
  p4->>p3: Check window.dataRepositories
  alt Repositories not found
    p4->>p4: throw Error('数据仓库未初始化')
  end
  p4->>p4: this.repositories = window.dataRepositories
  p4->>p4: createStorageAdapter()
  p4-->>p1: Instance created
```

**Sources:** [js/core/scoreStorage.js L6-L34](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L6-L34)

 [js/core/practiceRecorder.js L16-L23](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/practiceRecorder.js#L16-L23)

---

## Quota Management & Data Compression

The storage system actively manages quota to prevent `QuotaExceededError` and ensure writes succeed.

### Quota Checking Flow

```mermaid
flowchart TD

Start["Incoming write<br>size: N bytes"]
CheckQuota["checkStorageQuota(N)"]
GetInfo["getStorageInfo()"]
CalcType["Storage type?"]
HybridCalc["Max: 105MB<br>(5MB LS + 100MB IDB)"]
HybridCheck["used + N<br><= 105MB?"]
LSCalc["Quota: 5MB<br>Buffer: 20%"]
LSCheck["used + N + buffer<br><= 5MB?"]
QuotaOK["Quota OK<br>proceed with write"]
QuotaFail["Quota exceeded"]
Cleanup["cleanupOldData()"]
Recheck["Check quota again"]
StillFail["Still no space?"]
Compress["Compress records<br>Remove old logs"]
ThrowError["handleStorageQuotaExceeded()"]

Start -.-> CheckQuota
CheckQuota -.->|"localStorage"| GetInfo
GetInfo -.->|"Hybrid"| CalcType
CalcType -.->|"No"| HybridCalc
CalcType -.->|"No"| LSCalc
HybridCheck -.->|"Yes"| QuotaOK
HybridCheck -.->|"Yes"| QuotaFail
LSCheck -.->|"No"| QuotaOK
LSCheck -.-> QuotaFail
QuotaFail -.-> Cleanup
Cleanup -.->|"Yes"| Compress
Compress -.-> Recheck
Recheck -.-> StillFail
StillFail -.-> ThrowError
StillFail -.-> QuotaOK

subgraph subGraph1 ["localStorage Only"]
    LSCalc
    LSCheck
    LSCalc -.-> LSCheck
end

subgraph Hybrid/IndexedDB ["Hybrid/IndexedDB"]
    HybridCalc
    HybridCheck
    HybridCalc -.-> HybridCheck
end
```

**Sources:** [js/utils/storage.js L955-L1000](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L955-L1000)

 [js/utils/storage.js L1111-L1157](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1111-L1157)

### Data Compression Strategy

Large objects (>1000 bytes) are compressed by removing non-essential fields [js/utils/storage.js L470-L589](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L470-L589)

:

**Compression Rules:**

* **Arrays**: Never compressed (preserves list integrity)
* **Objects >1000 bytes**: Core fields only, compress `realData`
* **Core Fields Retained**: `id`, `examId`, `title`, `score`, `accuracy`, `duration`, timestamps
* **realData Compression**: Keep latest answers, trim interactions to last 50

**Sources:** [js/utils/storage.js L470-L589](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L470-L589)

---

## Backend Preference System

The system remembers which backend is working and prioritizes it on subsequent operations.

```css
#mermaid-r8kcl8tfz1{font-family:ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica;font-size:16px;fill:#333;}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#mermaid-r8kcl8tfz1 .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#mermaid-r8kcl8tfz1 .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#mermaid-r8kcl8tfz1 .error-icon{fill:#dddddd;}#mermaid-r8kcl8tfz1 .error-text{fill:#222222;stroke:#222222;}#mermaid-r8kcl8tfz1 .edge-thickness-normal{stroke-width:1px;}#mermaid-r8kcl8tfz1 .edge-thickness-thick{stroke-width:3.5px;}#mermaid-r8kcl8tfz1 .edge-pattern-solid{stroke-dasharray:0;}#mermaid-r8kcl8tfz1 .edge-thickness-invisible{stroke-width:0;fill:none;}#mermaid-r8kcl8tfz1 .edge-pattern-dashed{stroke-dasharray:3;}#mermaid-r8kcl8tfz1 .edge-pattern-dotted{stroke-dasharray:2;}#mermaid-r8kcl8tfz1 .marker{fill:#999;stroke:#999;}#mermaid-r8kcl8tfz1 .marker.cross{stroke:#999;}#mermaid-r8kcl8tfz1 svg{font-family:ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica;font-size:16px;}#mermaid-r8kcl8tfz1 p{margin:0;}#mermaid-r8kcl8tfz1 defs #statediagram-barbEnd{fill:#999;stroke:#999;}#mermaid-r8kcl8tfz1 g.stateGroup text{fill:#dddddd;stroke:none;font-size:10px;}#mermaid-r8kcl8tfz1 g.stateGroup text{fill:#333;stroke:none;font-size:10px;}#mermaid-r8kcl8tfz1 g.stateGroup .state-title{font-weight:bolder;fill:#333;}#mermaid-r8kcl8tfz1 g.stateGroup rect{fill:#ffffff;stroke:#dddddd;}#mermaid-r8kcl8tfz1 g.stateGroup line{stroke:#999;stroke-width:1;}#mermaid-r8kcl8tfz1 .transition{stroke:#999;stroke-width:1;fill:none;}#mermaid-r8kcl8tfz1 .stateGroup .composit{fill:#f4f4f4;border-bottom:1px;}#mermaid-r8kcl8tfz1 .stateGroup .alt-composit{fill:#e0e0e0;border-bottom:1px;}#mermaid-r8kcl8tfz1 .state-note{stroke:#e6d280;fill:#fff5ad;}#mermaid-r8kcl8tfz1 .state-note text{fill:#333;stroke:none;font-size:10px;}#mermaid-r8kcl8tfz1 .stateLabel .box{stroke:none;stroke-width:0;fill:#ffffff;opacity:0.5;}#mermaid-r8kcl8tfz1 .edgeLabel .label rect{fill:#ffffff;opacity:0.5;}#mermaid-r8kcl8tfz1 .edgeLabel{background-color:#ffffff;text-align:center;}#mermaid-r8kcl8tfz1 .edgeLabel p{background-color:#ffffff;}#mermaid-r8kcl8tfz1 .edgeLabel rect{opacity:0.5;background-color:#ffffff;fill:#ffffff;}#mermaid-r8kcl8tfz1 .edgeLabel .label text{fill:#333;}#mermaid-r8kcl8tfz1 .label div .edgeLabel{color:#333;}#mermaid-r8kcl8tfz1 .stateLabel text{fill:#333;font-size:10px;font-weight:bold;}#mermaid-r8kcl8tfz1 .node circle.state-start{fill:#999;stroke:#999;}#mermaid-r8kcl8tfz1 .node .fork-join{fill:#999;stroke:#999;}#mermaid-r8kcl8tfz1 .node circle.state-end{fill:#dddddd;stroke:#f4f4f4;stroke-width:1.5;}#mermaid-r8kcl8tfz1 .end-state-inner{fill:#f4f4f4;stroke-width:1.5;}#mermaid-r8kcl8tfz1 .node rect{fill:#ffffff;stroke:#dddddd;stroke-width:1px;}#mermaid-r8kcl8tfz1 .node polygon{fill:#ffffff;stroke:#dddddd;stroke-width:1px;}#mermaid-r8kcl8tfz1 #statediagram-barbEnd{fill:#999;}#mermaid-r8kcl8tfz1 .statediagram-cluster rect{fill:#ffffff;stroke:#dddddd;stroke-width:1px;}#mermaid-r8kcl8tfz1 .cluster-label,#mermaid-r8kcl8tfz1 .nodeLabel{color:#333;}#mermaid-r8kcl8tfz1 .statediagram-cluster rect.outer{rx:5px;ry:5px;}#mermaid-r8kcl8tfz1 .statediagram-state .divider{stroke:#dddddd;}#mermaid-r8kcl8tfz1 .statediagram-state .title-state{rx:5px;ry:5px;}#mermaid-r8kcl8tfz1 .statediagram-cluster.statediagram-cluster .inner{fill:#f4f4f4;}#mermaid-r8kcl8tfz1 .statediagram-cluster.statediagram-cluster-alt .inner{fill:#f8f8f8;}#mermaid-r8kcl8tfz1 .statediagram-cluster .inner{rx:0;ry:0;}#mermaid-r8kcl8tfz1 .statediagram-state rect.basic{rx:5px;ry:5px;}#mermaid-r8kcl8tfz1 .statediagram-state rect.divider{stroke-dasharray:10,10;fill:#f8f8f8;}#mermaid-r8kcl8tfz1 .note-edge{stroke-dasharray:5;}#mermaid-r8kcl8tfz1 .statediagram-note rect{fill:#fff5ad;stroke:#e6d280;stroke-width:1px;rx:0;ry:0;}#mermaid-r8kcl8tfz1 .statediagram-note rect{fill:#fff5ad;stroke:#e6d280;stroke-width:1px;rx:0;ry:0;}#mermaid-r8kcl8tfz1 .statediagram-note text{fill:#333;}#mermaid-r8kcl8tfz1 .statediagram-note .nodeLabel{color:#333;}#mermaid-r8kcl8tfz1 .statediagram .edgeLabel{color:red;}#mermaid-r8kcl8tfz1 #dependencyStart,#mermaid-r8kcl8tfz1 #dependencyEnd{fill:#999;stroke:#999;stroke-width:1;}#mermaid-r8kcl8tfz1 .statediagramTitleText{text-anchor:middle;font-size:18px;fill:#333;}#mermaid-r8kcl8tfz1 :root{--mermaid-font-family:"trebuchet ms",verdana,arial,sans-serif;}StorageManager initStored preference = 'local'Stored preference = 'session'No preference storedlocalStorage availableOnly sessionStorage availableIndexedDB + localStoragesessionStorage onlyWrite succeedsWrite failssetBackendPreference('local')Fallback to sessionStoragesetBackendPreference('session')CheckPreferenceLocalPreferredSessionPreferredAutoDetectUseHybridUseSessionWriteSuccessWriteFailSetLocalPrefTrySessionSetSessionPref
```

**Backend Preference Keys:** [js/utils/storage.js L12](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L12-L12)

 [js/utils/storage.js L57-L87](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L57-L87)

* Stored as: `exam_system_storage_backend`
* Values: `'local'` (IndexedDB+localStorage) or `'session'` (sessionStorage only)
* Checked on initialization and after each successful write

**Sources:** [js/utils/storage.js L12](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L12-L12)

 [js/utils/storage.js L57-L87](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L57-L87)

 [js/utils/storage.js L106-L113](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L106-L113)

---

## Legacy Data Migration

The system performs one-time migrations to consolidate data from previous storage schemes.

### Migration Phases

```mermaid
flowchart TD

ScanLS["Scan localStorage keys"]
FilterPrefix["Filter by prefix<br>'exam_system_'"]
MigrateLoop["For each key"]
CopyIDB["Copy to IndexedDB<br>setToIndexedDB()"]
RemoveLS["Remove from localStorage"]
ScanLegacy["Scan for legacy keys:<br>'practice_records'<br>'user_progress'<br>'scores'"]
ParseLegacy["Parse legacy data<br>(must be array)"]
MergeRecords["mergeRecords()<br>(dedup by id + timestamp)"]
SaveNew["Save to new namespace"]
CleanLegacy["Remove legacy key"]
CheckFlag["Check 'my_melody_migration_completed'"]
GetOldKey["Read from IDB:<br>'exam_system_practice_records'"]
ParseOld["Parse old data structure"]
MergeMM["Merge with current records"]
DeleteOld["Delete old IDB key"]
SetFlag["Set migration flag"]
InitMigration["migrateLegacyData()"]

InitMigration -.-> ScanLS
RemoveLS -.-> ScanLegacy
CleanLegacy -.-> CheckFlag

subgraph subGraph2 ["Phase 3: MyMelody Migration"]
    CheckFlag
    GetOldKey
    ParseOld
    MergeMM
    DeleteOld
    SetFlag
    CheckFlag -.-> GetOldKey
    GetOldKey -.-> ParseOld
    ParseOld -.-> MergeMM
    MergeMM -.-> DeleteOld
    DeleteOld -.-> SetFlag
end

subgraph subGraph1 ["Phase 2: Legacy Namespace"]
    ScanLegacy
    ParseLegacy
    MergeRecords
    SaveNew
    CleanLegacy
    ScanLegacy -.-> ParseLegacy
    ParseLegacy -.-> MergeRecords
    MergeRecords -.-> SaveNew
    SaveNew -.-> CleanLegacy
end

subgraph subGraph0 ["Phase 1: localStorage → IndexedDB"]
    ScanLS
    FilterPrefix
    MigrateLoop
    CopyIDB
    RemoveLS
    ScanLS -.-> FilterPrefix
    FilterPrefix -.-> MigrateLoop
    MigrateLoop -.-> CopyIDB
    CopyIDB -.-> RemoveLS
end
```

**Migration Flags:**

* `migration_completed`: Tracks localStorage → new namespace migration
* `my_melody_migration_completed`: Tracks old IndexedDB key migration

**Record Merging Logic:** [js/utils/storage.js L523-L541](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L523-L541)

```javascript
mergeRecords(current, legacy) {
    const mergedMap = new Map();
    [...current, ...legacy].forEach(record => {
        if (record && record.id) {
            const existing = mergedMap.get(record.id);
            // Keep the record with newer timestamp
            if (!existing || (record.timestamp > existing.timestamp)) {
                mergedMap.set(record.id, record);
            }
        }
    });
    return Array.from(mergedMap.values())
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}
```

**Sources:** [js/utils/storage.js L1163-L1283](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1163-L1283)

 [js/utils/storage.js L523-L541](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L523-L541)

---

## Import/Export & Backup System

`DataBackupManager` handles data portability and backup restoration independently of the core storage layer.

### Export Architecture

```mermaid
flowchart TD

Start["exportPracticeRecords(options)"]
GetRecords["Get practice_records<br>(via practiceRecorder or storage)"]
FilterDate["Apply dateRange filter"]
FilterCats["Apply categories filter"]
BuildInfo["exportInfo:<br>timestamp, version,<br>recordCount, format"]
AddRecords["practiceRecords: filtered"]
AddStats["userStats (optional)"]
AddBackups["backups (optional)"]
CheckFormat["Format?"]
Stringify["JSON.stringify(payload, null, 2)"]
OptCompress["Compress if enabled<br>(pako.gzip)"]
JSONResult["Return:<br>data, filename, mimeType"]
BuildHeaders["Headers:<br>id, examId, title, score,<br>accuracy, duration, etc."]
MapRows["Map records to CSV rows"]
EscapeCells["Escape quotes in cells"]
JoinCSV["Join with newlines"]
CSVResult["Return:<br>data, filename, mimeType"]
RecordHistory["recordExportHistory()"]

Start -.-> GetRecords
GetRecords -.-> FilterDate
FilterDate -.-> FilterCats
FilterCats -.-> BuildInfo
AddBackups -.-> CheckFormat
CheckFormat -.-> Stringify
CheckFormat -.-> BuildHeaders
JSONResult -.-> RecordHistory
CSVResult -.-> RecordHistory

subgraph subGraph2 ["CSV Export"]
    BuildHeaders
    MapRows
    EscapeCells
    JoinCSV
    CSVResult
    BuildHeaders -.-> MapRows
    MapRows -.-> EscapeCells
    EscapeCells -.-> JoinCSV
    JoinCSV -.-> CSVResult
end

subgraph subGraph1 ["JSON Export"]
    Stringify
    OptCompress
    JSONResult
    Stringify -.-> OptCompress
    OptCompress -.-> JSONResult
end

subgraph subGraph0 ["Export Payload"]
    BuildInfo
    AddRecords
    AddStats
    AddBackups
    BuildInfo -.->|"csv"| AddRecords
    AddRecords -.-> AddStats
    AddStats -.->|"json"| AddBackups
end
```

**Sources:** [js/utils/dataBackupManager.js L87-L213](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/dataBackupManager.js#L87-L213)

### Import Architecture with Backup

```mermaid
flowchart TD

Start["importPracticeData(source, options)"]
ParseSource["parseImportSource()<br>(File/Blob/JSON/URL)"]
Normalize["normalizeImportPayload()<br>Extract records from nested structures"]
Validate["validateNormalizedRecords()<br>Fix missing fields"]
CreateBackup["createPreImportBackup()<br>Snapshot current state"]
CheckScoreStorage["ScoreStorage<br>available?"]
SSImport["scoreStorage.importData()"]
SSMerge["Repository-level merge"]
LegacyMerge["mergePracticeRecords()"]
MergeLogic["Merge by ID, keep newer timestamp"]
SaveStorage["storage.set('practice_records')"]
RecordHistory["recordImportHistory()"]
Success["Return:<br>importedCount, updatedCount,<br>skippedCount, backupId"]
ErrorRestore["Error: restoreBackup(backupId)"]

Start -.-> ParseSource
ParseSource -.-> Normalize
Normalize -.-> Validate
Validate -.->|"No"| CreateBackup
CreateBackup -.->|"Yes"| CheckScoreStorage
CheckScoreStorage -.->|"Error"| SSImport
CheckScoreStorage -.-> LegacyMerge
SSMerge -.-> RecordHistory
SaveStorage -.-> RecordHistory
RecordHistory -.-> Success
SSMerge -.-> ErrorRestore
SaveStorage -.-> ErrorRestore

subgraph subGraph1 ["Legacy Path"]
    LegacyMerge
    MergeLogic
    SaveStorage
    LegacyMerge -.->|"Error"| MergeLogic
    MergeLogic -.-> SaveStorage
end

subgraph subGraph0 ["ScoreStorage Path"]
    SSImport
    SSMerge
    SSImport -.-> SSMerge
end
```

**Import Payload Normalization:** [js/utils/dataBackupManager.js L374-L491](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/dataBackupManager.js#L374-L491)

The normalizer traverses arbitrary JSON structures to find arrays that look like practice records:

**Heuristics:**

1. Check common paths: `practiceRecords`, `data.practice_records`, `data.exam_system_practice_records.data`
2. Traverse all object properties recursively
3. Detect record arrays using `looksLikePracticeRecord()` on sample items
4. Extract and deduplicate by ID
5. Also extract `userStats` if found

**Sources:** [js/utils/dataBackupManager.js L217-L327](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/dataBackupManager.js#L217-L327)

 [js/utils/dataBackupManager.js L374-L491](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/dataBackupManager.js#L374-L491)

 [js/utils/dataBackupManager.js L642-L712](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/dataBackupManager.js#L642-L712)

---

## Storage Monitoring & Maintenance

The storage system includes automatic monitoring and cleanup to maintain health.

### Periodic Monitoring

```mermaid
sequenceDiagram
  participant p1 as setInterval (5 min)
  participant p2 as Storage Monitor
  participant p3 as getStorageInfo()
  participant p4 as cleanupOldData()

  p1->>p2: Check storage health
  p2->>p3: Get current usage
  p3-->>p2: { used: X, available: Y, type: 'Hybrid' }
  p2->>p2: Calculate usage %
  alt Usage > 80%
    p2->>p4: Auto-cleanup triggered
    p4->>p4: Compress practice_records
    p4->>p4: Trim error logs to 20 entries
    p4->>p4: Remove sessions >1 hour old
    p4-->>p2: Cleanup complete
    p2->>p3: Recheck usage
    p3-->>p2: { used: X', ... }
  alt Still > 90%
    p2->>p2: showMessage('Space warning')
  end
  end
```

**Monitoring Setup:** [js/utils/storage.js L1532-L1588](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1532-L1588)

**Cleanup Operations:** [js/utils/storage.js L1111-L1157](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1111-L1157)

1. Compress all `practice_records` using `compressObject()`
2. Trim `injection_errors` to last 20 entries
3. Trim `collection_errors` to last 20 entries
4. Remove `active_sessions` older than 1 hour

**Sources:** [js/utils/storage.js L1111-L1157](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1111-L1157)

 [js/utils/storage.js L1532-L1588](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1532-L1588)

---

## Error Handling & Resilience

The storage system implements multiple layers of resilience to ensure data is never lost.

### Error Recovery Strategy

```mermaid
flowchart TD

WriteAttempt["Attempt write"]
IDBFail["IndexedDB write fails"]
TryLS["Try localStorage"]
LSFail["localStorage write fails"]
QuotaError["QuotaExceededError"]
AutoCleanup["Automatic cleanup"]
RetryWrite["Retry write"]
CheckPersistent["Is persistent key?"]
ThrowError["Throw explicit error<br>'No persistent storage'"]
UseSS["Try sessionStorage"]
UseMem["Write to in-memory Map<br>fallbackStorage"]
WarnUser["Warn: Data not persisted"]
Success["Write successful"]

WriteAttempt -.-> IDBFail
LSFail -.->|"Still fails"| QuotaError
RetryWrite -.-> Success
RetryWrite -.->|"Yes"| CheckPersistent
UseSS -.-> UseMem

subgraph subGraph3 ["Layer 4: Fallback Storage"]
    UseMem
    WarnUser
    UseMem -.-> WarnUser
end

subgraph subGraph2 ["Layer 3: Persistent Key Protection"]
    CheckPersistent
    ThrowError
    UseSS
    CheckPersistent -.->|"Fails"| ThrowError
    CheckPersistent -.-> UseSS
end

subgraph subGraph1 ["Layer 2: Quota Errors"]
    QuotaError
    AutoCleanup
    RetryWrite
    QuotaError -.-> AutoCleanup
    AutoCleanup -.->|"No"| RetryWrite
end

subgraph subGraph0 ["Layer 1: Primary Failure"]
    IDBFail
    TryLS
    LSFail
    IDBFail -.-> TryLS
    TryLS -.-> LSFail
end
```

**Error Handlers:** [js/utils/storage.js L1329-L1362](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1329-L1362)

**Resilience Features:**

* **Multi-backend fallback**: Automatic cascade through all available backends
* **Quota-aware**: Auto-cleanup before reporting quota errors
* **Persistent key protection**: Refuse to use volatile storage for critical keys
* **In-memory safety net**: Always accepts writes even if all backends fail
* **Event dispatching**: Fires `storageQuotaExceeded` and `storageError` events for UI handling

**Sources:** [js/utils/storage.js L716-L721](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L716-L721)

 [js/utils/storage.js L1329-L1362](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1329-L1362)

---

## Integration with ScoreStorage

`ScoreStorage` sits atop the repository layer and adds domain-specific logic for practice records.

### ScoreStorage Responsibilities

```mermaid
flowchart TD

Standardize["standardizeRecord()<br>Normalize formats"]
Validate["validateRecord()<br>Check required fields"]
Dedupe["Dedupe by sessionId"]
UpdateStats["updateUserStats()"]
Migrate["migrateLegacyPracticeRecords()"]
PracticeRepo["PracticeRepository"]
MetaRepo["MetaRepository"]
StorageManager["StorageManager"]

Dedupe -.-> PracticeRepo
UpdateStats -.-> MetaRepo
Migrate -.-> PracticeRepo
PracticeRepo -.-> StorageManager
MetaRepo -.-> StorageManager

subgraph subGraph2 ["Storage Backend"]
    StorageManager
end

subgraph subGraph1 ["Repository Layer"]
    PracticeRepo
    MetaRepo
end

subgraph subGraph0 ["ScoreStorage Domain"]
    Standardize
    Validate
    Dedupe
    UpdateStats
    Migrate
    Standardize -.-> Validate
    Validate -.-> Dedupe
end
```

**Key Operations:**

| Operation | ScoreStorage Method | Backend Flow |
| --- | --- | --- |
| **Save Record** | `savePracticeRecord()` | Standardize → Validate → Dedupe → `practiceRepo.overwrite()` |
| **Load Records** | `storage.get('practiceRecords')` | `practiceRepo.list()` → StorageManager |
| **Update Stats** | `updateUserStats()` | Calculate → `metaRepo.set('user_stats')` |
| **Backup** | `createBackup()` | Export → `backupRepo.saveAll()` |
| **Version Check** | `checkStorageVersion()` | `metaRepo.get('storage_version')` → Compare → Migrate |

**Sources:** [js/core/scoreStorage.js L571-L685](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L571-L685)

 [js/core/scoreStorage.js L788-L933](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L788-L933)

 [js/core/scoreStorage.js L1121-L1154](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L1121-L1154)

### Record Standardization Pipeline

```mermaid
flowchart TD

RawRecord["Raw practice record<br>(from examSessionMixin)"]
InferType["inferPracticeType()<br>listening vs reading"]
ResolveDates["resolveRecordDate()<br>Prioritize metadata.date"]
BuildMeta["buildMetadata()<br>examTitle, category, frequency"]
NormAnswers["standardizeAnswers()<br>Array format with timestamps"]
NormCorrect["Normalize correctAnswerMap<br>From comparison or details"]
BuildDetails["buildAnswerDetailsFromMaps()<br>Merge user + correct answers"]
CalcCounts["deriveTotalQuestionCount()<br>deriveCorrectAnswerCount()"]
CalcAccuracy["accuracy = correct / total<br>Clamp to [0, 1]"]
FinalRecord["Standardized Record:<br>id, examId, type, date,<br>answers, correctAnswerMap,<br>answerDetails, score, accuracy"]

RawRecord -.-> InferType
InferType -.-> ResolveDates
ResolveDates -.-> BuildMeta
BuildMeta -.-> NormAnswers
NormAnswers -.-> NormCorrect
NormCorrect -.-> BuildDetails
BuildDetails -.-> CalcCounts
CalcCounts -.-> CalcAccuracy
CalcAccuracy -.-> FinalRecord
```

**Sources:** [js/core/scoreStorage.js L49-L128](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L49-L128)

 [js/core/scoreStorage.js L788-L933](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L788-L933)

 [js/core/scoreStorage.js L938-L958](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L938-L958)

---

## Summary: Key Takeaways

1. **Multi-Tier Backend**: IndexedDB (primary, 100MB+) → localStorage (mirror/fallback, 5MB) → sessionStorage (volatile) → in-memory Map (last resort)
2. **Repository Abstraction**: `ScoreStorage` uses repositories (`PracticeRepository`, `MetaRepository`, `BackupRepository`) instead of direct `StorageManager` access, enabling transactional operations and structured access patterns.
3. **Persistent Key Protection**: Critical keys like `practice_records` will **never** use volatile storage. Writes fail explicitly if no persistent backend is available.
4. **Automatic Fallback**: Reads cascade through all backends until data is found. Writes attempt all backends and succeed if at least one works (for persistent keys, at least one durable backend required).
5. **Quota Management**: Automatic monitoring every 5 minutes, auto-cleanup at 80% usage, compression for large objects, explicit errors at 90%+ usage.
6. **Legacy Migration**: One-time migrations consolidate data from old namespaces, deduplicate by ID + timestamp, preserve all data.
7. **Import/Export**: `DataBackupManager` operates independently, supports JSON/CSV formats, creates pre-import backups automatically, restores on import failure.
8. **Resilience**: In-memory fallback ensures writes always succeed, though data may not persist. UI events (`storageQuotaExceeded`, `storageError`) enable graceful degradation.

**Sources:** [js/utils/storage.js L1-L2089](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/storage.js#L1-L2089)

 [js/core/scoreStorage.js L1-L1590](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/scoreStorage.js#L1-L1590)

 [js/utils/dataBackupManager.js L1-L1347](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/dataBackupManager.js#L1-L1347)

 [js/core/practiceRecorder.js L1-L1500](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/core/practiceRecorder.js#L1-L1500)