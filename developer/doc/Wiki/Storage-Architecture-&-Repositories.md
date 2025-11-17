# Repository Architecture & Data Layer

> **Relevant source files**
> * [js/core/practiceRecorder.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/practiceRecorder.js)
> * [js/core/scoreStorage.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/scoreStorage.js)
> * [js/utils/logger.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/logger.js)

This document covers the repository pattern implementation that abstracts data persistence operations. The repository layer sits between application components and the storage backend, providing a unified API for practice records, settings, backups, and metadata management with transaction support and consistency validation.

For information about data backup and import/export operations, see [Data Backup & Import/Export](/sallowayma-git/IELTS-practice/4.2-data-backup-and-importexport). For details about data validation and integrity checking, see [Data Integrity & Quality Management](/sallowayma-git/IELTS-practice/4.3-data-normalization-and-quality). For information about the underlying storage backend, see the StorageManager implementation in `js/utils/storage.js`.

## Repository Pattern Architecture

The repository pattern provides a clean abstraction layer that separates data access logic from business logic. Application components interact with repositories instead of directly accessing storage APIs.

**Title:** Repository Layer Architecture

```mermaid
flowchart TD

App["ExamSystemApp"]
PR["PracticeRecorder"]
DIM["DataIntegrityManager"]
DBM["DataBackupManager"]
SSW["SimpleStorageWrapper"]
REG["DataRepositoryRegistry"]
PracRepo["PracticeRepository"]
SetRepo["SettingsRepository"]
BackRepo["BackupRepository"]
MetaRepo["MetaRepository"]
DS["StorageDataSource"]
SM["StorageManager"]
LS["localStorage"]
IDB["IndexedDB"]

App --> REG
PR --> PracRepo
DIM --> REG
DBM --> REG
SSW --> REG
REG --> PracRepo
REG --> SetRepo
REG --> BackRepo
REG --> MetaRepo
PracRepo --> DS
SetRepo --> DS
BackRepo --> DS
MetaRepo --> DS
DS --> SM

subgraph subGraph5 ["Storage Backend"]
    SM
    LS
    IDB
    SM --> LS
    SM --> IDB
end

subgraph subGraph4 ["Data Source Layer"]
    DS
end

subgraph subGraph3 ["Repository Layer"]
    PracRepo
    SetRepo
    BackRepo
    MetaRepo
end

subgraph subGraph2 ["Repository Registry"]
    REG
end

subgraph subGraph1 ["Legacy Adapter"]
    SSW
end

subgraph subGraph0 ["Application Components"]
    App
    PR
    DIM
    DBM
end
```

Sources: [js/data/index.js L1-L119](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/index.js#L1-L119)

 [js/data/repositories/dataRepositoryRegistry.js L1-L150](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/dataRepositoryRegistry.js#L1-L150)

 [js/data/dataSources/storageDataSource.js L1-L80](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/dataSources/storageDataSource.js#L1-L80)

 [js/utils/simpleStorageWrapper.js L1-L65](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/simpleStorageWrapper.js#L1-L65)

## DataRepositoryRegistry

The `DataRepositoryRegistry` class serves as the central coordinator for all repositories, providing dependency injection, transaction management, and consistency checking.

**Title:** Repository Registration and Initialization

```mermaid
flowchart TD

Boot["data/index.js bootstrap()"]
CheckStorage["Wait for StorageManager"]
CreateDS["new StorageDataSource"]
CreateReg["new DataRepositoryRegistry"]
PracRepo["new PracticeRepository<br>maxRecords: 1000"]
SetRepo["new SettingsRepository"]
BackRepo["new BackupRepository<br>maxBackups: 20"]
MetaRepo["new MetaRepository<br>schema-driven"]
RegPrac["registry.register('practice')"]
RegSet["registry.register('settings')"]
RegBack["registry.register('backups')"]
RegMeta["registry.register('meta')"]
SPR["StorageProviderRegistry"]
Notify["registerStorageProviders()"]

CreateReg --> PracRepo
CreateReg --> SetRepo
CreateReg --> BackRepo
CreateReg --> MetaRepo
PracRepo --> RegPrac
SetRepo --> RegSet
BackRepo --> RegBack
MetaRepo --> RegMeta
RegMeta --> SPR

subgraph subGraph3 ["Provider Injection"]
    SPR
    Notify
    SPR --> Notify
end

subgraph Registration ["Registration"]
    RegPrac
    RegSet
    RegBack
    RegMeta
end

subgraph subGraph1 ["Repository Creation"]
    PracRepo
    SetRepo
    BackRepo
    MetaRepo
end

subgraph subGraph0 ["Bootstrap Process"]
    Boot
    CheckStorage
    CreateDS
    CreateReg
    Boot --> CheckStorage
    CheckStorage --> CreateDS
    CreateDS --> CreateReg
end
```

Sources: [js/data/index.js L20-L118](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/index.js#L20-L118)

 [js/data/repositories/dataRepositoryRegistry.js L1-L150](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/dataRepositoryRegistry.js#L1-L150)

 [js/core/storageProviderRegistry.js L1-L71](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/core/storageProviderRegistry.js#L1-L71)

### Registry API

| Method | Purpose | Return Type |
| --- | --- | --- |
| `register(name, repository)` | Register a repository instance | void |
| `get(name)` | Retrieve a registered repository | Repository instance |
| `transaction(names, handler)` | Execute operations atomically | Promise<any> |
| `runConsistencyChecks(names)` | Validate data integrity across repositories | Promise<Report> |

Sources: [js/data/repositories/dataRepositoryRegistry.js L15-L80](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/dataRepositoryRegistry.js#L15-L80)

## StorageDataSource

The `StorageDataSource` class provides the abstraction layer connecting repositories to the underlying `StorageManager`. It wraps all storage operations in async interfaces and handles namespacing.

**Title:** StorageDataSource Operations

```mermaid
flowchart TD

Repo["Repository.list()"]
Get["get(key, defaultValue)"]
Set["set(key, value)"]
Remove["remove(key)"]
GetAll["getAll()"]
SM["window.storage"]
Namespace["exam_system_"]
LS["localStorage"]
IDB["IndexedDB"]

Repo --> Get
Get --> SM
Namespace --> LS
Namespace --> IDB

subgraph subGraph3 ["Storage Backend"]
    LS
    IDB
end

subgraph StorageManager ["StorageManager"]
    SM
    Namespace
    SM --> Namespace
end

subgraph StorageDataSource ["StorageDataSource"]
    Get
    Set
    Remove
    GetAll
end

subgraph subGraph0 ["Repository Layer"]
    Repo
end
```

Sources: [js/data/dataSources/storageDataSource.js L1-L80](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/dataSources/storageDataSource.js#L1-L80)

### Storage Operations

| Method | Parameters | Description |
| --- | --- | --- |
| `get(key, defaultValue)` | key: string, defaultValue: any | Retrieves value with fallback |
| `set(key, value)` | key: string, value: any | Stores value asynchronously |
| `remove(key)` | key: string | Removes key from storage |
| `getAll()` | none | Returns all keys in namespace |

All operations return Promises and handle storage errors gracefully by falling back to in-memory storage when necessary.

Sources: [js/data/dataSources/storageDataSource.js L15-L75](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/dataSources/storageDataSource.js#L15-L75)

## Individual Repositories

### BaseRepository

The `BaseRepository` class provides common functionality inherited by all specialized repositories.

**Title:** BaseRepository Common Operations

```mermaid
flowchart TD

List["list()<br>Get all records"]
GetById["getById(id)<br>Single record"]
Upsert["upsert(record)<br>Add or update"]
Remove["removeById(id)<br>Delete single"]
RemoveMany["removeByIds(ids)<br>Bulk delete"]
Count["count()<br>Total records"]
Validate["validate(record)"]
Transform["transform(record)"]
Index["buildIndex()"]
DS["dataSource.get()"]
Save["dataSource.set()"]

List --> DS
GetById --> DS
Upsert --> Validate
Transform --> Save
Remove --> Save
RemoveMany --> Save

subgraph subGraph2 ["Storage Operations"]
    DS
    Save
end

subgraph subGraph1 ["Data Processing"]
    Validate
    Transform
    Index
    Validate --> Transform
end

subgraph subGraph0 ["Core Operations"]
    List
    GetById
    Upsert
    Remove
    RemoveMany
    Count
end
```

Sources: [js/data/repositories/baseRepository.js L1-L200](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/baseRepository.js#L1-L200)

### PracticeRepository

The `PracticeRepository` manages practice records with a maximum limit of 1000 records. When the limit is exceeded, the oldest records are automatically pruned.

**Title:** PracticeRepository Record Management

```mermaid
flowchart TD

Add["upsert(record)"]
Check["count() >= maxRecords"]
Prune["Remove oldest records"]
Save["Save to storage"]
ValidateId["Check id exists"]
ValidateTime["Validate timestamps"]
ValidateScore["Validate score fields"]
ByDate["dateIndex<br>Sort by date"]
ById["idIndex<br>Lookup by id"]
ByExam["examIndex<br>Group by exam"]

Add --> ValidateId
ValidateScore --> Check
Save --> ByDate
Save --> ById
Save --> ByExam

subgraph subGraph2 ["Index Management"]
    ByDate
    ById
    ByExam
end

subgraph Validation ["Validation"]
    ValidateId
    ValidateTime
    ValidateScore
    ValidateId --> ValidateTime
    ValidateTime --> ValidateScore
end

subgraph subGraph0 ["Record Operations"]
    Add
    Check
    Prune
    Save
    Check --> Prune
    Prune --> Save
    Check --> Save
end
```

Key configuration:

* `maxRecords`: 1000 (enforced at write time)
* `storageKey`: 'practice_records'
* Automatic pruning of oldest records
* Maintains sorted date index for efficient queries

Sources: [js/data/repositories/practiceRepository.js L1-L250](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/practiceRepository.js#L1-L250)

### SettingsRepository

The `SettingsRepository` manages user settings with key-value storage and default value support.

**Title:** SettingsRepository Key-Value Operations

```mermaid
flowchart TD

Get["get(key, defaultValue)"]
Set["set(key, value)"]
GetAll["getAll()"]
SaveAll["saveAll(settings)"]
Theme["theme: 'default'"]
Lang["language: 'zh-CN'"]
AutoSave["autoSave: true"]
Notif["notifications: true"]
Settings["settings object"]
Persist["dataSource.set()"]

Get --> Settings
Set --> Settings
GetAll --> Settings
SaveAll --> Persist
Get --> Theme
Get --> Lang

subgraph Storage ["Storage"]
    Settings
    Persist
    Settings --> Persist
end

subgraph subGraph1 ["Default Values"]
    Theme
    Lang
    AutoSave
    Notif
end

subgraph subGraph0 ["Setting Operations"]
    Get
    Set
    GetAll
    SaveAll
end
```

Sources: [js/data/repositories/settingsRepository.js L1-L150](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/settingsRepository.js#L1-L150)

### BackupRepository

The `BackupRepository` manages backup snapshots with automatic pruning when the maximum of 20 backups is exceeded.

**Title:** BackupRepository Lifecycle

```mermaid
flowchart TD

Add["add(backup)"]
List["list()"]
GetById["getById(id)"]
Delete["delete(id)"]
Prune["prune(maxCount)"]
ID["id: 'backup_timestamp_hash'"]
TS["timestamp: ISO string"]
Data["data: {practice, settings}"]
Ver["version: '1.0.0'"]
Type["type: 'manual' | 'auto'"]
Sort["Sort by timestamp desc"]
Keep["Keep maxBackups newest"]
RemoveOld["Remove excess backups"]

Add --> ID
List --> Sort

subgraph subGraph2 ["Pruning Logic"]
    Sort
    Keep
    RemoveOld
    Sort --> Keep
    Keep --> RemoveOld
end

subgraph subGraph1 ["Backup Structure"]
    ID
    TS
    Data
    Ver
    Type
end

subgraph subGraph0 ["Backup Operations"]
    Add
    List
    GetById
    Delete
    Prune
    Add --> List
end
```

Key features:

* `maxBackups`: 20 (configured at construction)
* `storageKey`: 'data_backups'
* Automatic pruning of oldest backups
* Supports manual and automatic backup types

Sources: [js/data/repositories/backupRepository.js L1-L180](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/backupRepository.js#L1-L180)

### MetaRepository

The `MetaRepository` provides schema-driven storage with per-key validation and default value generation.

**Title:** MetaRepository Schema System

```mermaid
flowchart TD

Set["set(key, value)"]
Validate["Run validators"]
UpdateCache["Update cache"]
Persist["Persist to storage"]
Get["get(key, defaultValue)"]
CheckCache["Check in-memory cache"]
FetchStorage["Fetch from storage"]
ApplyDefault["Apply defaultValue()"]
RunValidators["Run validators"]
CloneValue["Clone if configured"]
Return["Return value"]
Key["Key: 'user_stats'"]
Default["defaultValue: function"]
Validators["validators: array"]
Clone["cloneOnRead: boolean"]

subgraph subGraph2 ["Write Operation"]
    Set
    Validate
    UpdateCache
    Persist
    Set --> Validate
    Validate --> UpdateCache
    UpdateCache --> Persist
end

subgraph subGraph1 ["Read Operation"]
    Get
    CheckCache
    FetchStorage
    ApplyDefault
    RunValidators
    CloneValue
    Return
    Get --> CheckCache
    CheckCache --> FetchStorage
    FetchStorage --> ApplyDefault
    ApplyDefault --> RunValidators
    RunValidators --> CloneValue
    CloneValue --> Return
end

subgraph subGraph0 ["Schema Definition"]
    Key
    Default
    Validators
    Clone
    Key --> Default
    Key --> Validators
    Key --> Clone
end
```

Predefined schemas (from [js/data/index.js L36-L82](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/index.js#L36-L82)

):

| Key | Default Value | Validators | Clone on Read |
| --- | --- | --- | --- |
| `user_stats` | `createDefaultUserStats()` | Must be object | Yes |
| `storage_version` | `null` | String or null | No |
| `data_restored` | `false` | Must be boolean | No |
| `active_sessions` | `[]` | Must be array | Yes |
| `temp_practice_records` | `[]` | Must be array | Yes |
| `interrupted_records` | `[]` | Must be array | Yes |
| `exam_index` | `[]` | Must be array | Yes |

Sources: [js/data/repositories/metaRepository.js L1-L200](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/metaRepository.js#L1-L200)

 [js/data/index.js L3-L82](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/index.js#L3-L82)

## Transaction Support

The `DataRepositoryRegistry` provides transaction support for atomic operations across multiple repositories.

**Title:** Repository Transaction Flow

```mermaid
flowchart TD

Start["transaction(['practice', 'settings'], handler)"]
GetRepos["Retrieve repository instances"]
CreateTx["Create transaction context"]
Handler["async (repos, tx) => {...}"]
OpPractice["repos.practice.upsert(record, {transaction: tx})"]
OpSettings["repos.settings.set('key', value, {transaction: tx})"]
Collect["Collect all writes"]
Validate["Validate consistency"]
Commit["Atomic commit"]
Rollback["Rollback on error"]

CreateTx --> Handler
OpPractice --> Collect
OpSettings --> Collect

subgraph subGraph2 ["Commit Process"]
    Collect
    Validate
    Commit
    Rollback
    Collect --> Validate
    Validate --> Commit
    Validate --> Rollback
end

subgraph subGraph1 ["Transaction Handler"]
    Handler
    OpPractice
    OpSettings
    Handler --> OpPractice
    Handler --> OpSettings
end

subgraph subGraph0 ["Transaction Setup"]
    Start
    GetRepos
    CreateTx
    Start --> GetRepos
    GetRepos --> CreateTx
end
```

Example transaction usage:

```javascript
await registry.transaction(['practice', 'settings'], async (repos, tx) => {
    // All operations use the same transaction context
    await repos.practice.upsert(record, { transaction: tx });
    await repos.settings.set('last_practice_date', new Date().toISOString(), { transaction: tx });
    // If any operation fails, entire transaction rolls back
});
```

Sources: [js/data/repositories/dataRepositoryRegistry.js L85-L130](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/dataRepositoryRegistry.js#L85-L130)

## Consistency Checking

The `DataRepositoryRegistry` provides automated consistency checking across all registered repositories.

**Title:** Consistency Check Process

```mermaid
flowchart TD

Trigger["runConsistencyChecks(['practice', 'settings'])"]
SelectRepos["Select specified repositories"]
RunChecks["Execute repository-specific checks"]
PracticeCheck["Practice: Validate IDs, timestamps, scores"]
SettingsCheck["Settings: Validate key types"]
BackupCheck["Backup: Validate structure, prune excess"]
MetaCheck["Meta: Run schema validators"]
Aggregate["Aggregate all check results"]
CountErrors["Count total errors"]
CountWarnings["Count warnings"]
Report["Return consistency report"]

RunChecks --> PracticeCheck
RunChecks --> SettingsCheck
RunChecks --> BackupCheck
RunChecks --> MetaCheck
PracticeCheck --> Aggregate
SettingsCheck --> Aggregate
BackupCheck --> Aggregate
MetaCheck --> Aggregate

subgraph subGraph2 ["Report Generation"]
    Aggregate
    CountErrors
    CountWarnings
    Report
    Aggregate --> CountErrors
    CountErrors --> CountWarnings
    CountWarnings --> Report
end

subgraph subGraph1 ["Repository Checks"]
    PracticeCheck
    SettingsCheck
    BackupCheck
    MetaCheck
end

subgraph subGraph0 ["Check Invocation"]
    Trigger
    SelectRepos
    RunChecks
    Trigger --> SelectRepos
    SelectRepos --> RunChecks
end
```

Consistency report structure:

```yaml
{
    timestamp: "2025-01-15T10:30:00.000Z",
    repositories: {
        practice: {
            totalRecords: 450,
            errors: [],
            warnings: ["Record 123 missing duration field"]
        },
        settings: {
            errors: [],
            warnings: []
        }
    },
    summary: {
        totalErrors: 0,
        totalWarnings: 1
    }
}
```

Sources: [js/data/repositories/dataRepositoryRegistry.js L135-L150](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/data/repositories/dataRepositoryRegistry.js#L135-L150)

 [js/components/DataIntegrityManager.js L66-L87](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/components/DataIntegrityManager.js#L66-L87)

## SimpleStorageWrapper: Legacy Adapter

The `SimpleStorageWrapper` class provides a legacy-compatible API that wraps repository operations, allowing older code to use the repository pattern without modification.

**Title:** SimpleStorageWrapper Adapter Pattern

```mermaid
flowchart TD

Old["Legacy Component"]
Call["getPracticeRecords()"]
Wrapper["simpleStorageWrapper"]
Delegate["practiceRepo.list()"]
PracRepo["PracticeRepository"]
Storage["StorageDataSource"]

Call --> Wrapper
Delegate --> PracRepo

subgraph subGraph2 ["Repository Layer"]
    PracRepo
    Storage
    PracRepo --> Storage
end

subgraph SimpleStorageWrapper ["SimpleStorageWrapper"]
    Wrapper
    Delegate
    Wrapper --> Delegate
end

subgraph subGraph0 ["Legacy Code"]
    Old
    Call
    Old --> Call
end
```

Key method mappings:

| Legacy Method | Repository Operation | Target Repository |
| --- | --- | --- |
| `getPracticeRecords()` | `practiceRepo.list()` | PracticeRepository |
| `savePracticeRecords(records)` | `practiceRepo.overwrite(records)` | PracticeRepository |
| `addPracticeRecord(record)` | `practiceRepo.upsert(record)` | PracticeRepository |
| `getById(id)` | `practiceRepo.getById(id)` | PracticeRepository |
| `update(id, updates)` | `practiceRepo.update(id, updates)` | PracticeRepository |
| `delete(id)` | `practiceRepo.removeById(id)` | PracticeRepository |
| `deletePracticeRecords(ids)` | `practiceRepo.removeByIds(ids)` | PracticeRepository |
| `getUserSettings()` | `settingsRepo.getAll()` | SettingsRepository |
| `saveUserSettings(settings)` | `settingsRepo.saveAll(settings)` | SettingsRepository |
| `getUserSetting(key, default)` | `settingsRepo.get(key, default)` | SettingsRepository |
| `setUserSetting(key, value)` | `settingsRepo.set(key, value)` | SettingsRepository |
| `get(key, default)` | `metaRepo.get(key, default)` | MetaRepository |
| `set(key, value)` | `metaRepo.set(key, value)` | MetaRepository |

Sources: [js/utils/simpleStorageWrapper.js L1-L65](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/simpleStorageWrapper.js#L1-L65)

## Error Handling and Recovery

The storage system implements comprehensive error handling with automatic recovery mechanisms.

### Error Recovery Flow

```mermaid
flowchart TD

QUOTA["QuotaExceededError"]
ACCESS["Access Denied"]
CORRUPT["Corrupted Data"]
UNAVAIL["Storage Unavailable"]
TIER_SWITCH["Switch Storage Tier"]
CLEANUP_AUTO["Automatic Cleanup"]
BACKUP_RESTORE["Restore from Backup"]
MEMORY_FALLBACK["Memory Fallback"]

QUOTA --> CLEANUP_AUTO
QUOTA --> TIER_SWITCH
ACCESS --> MEMORY_FALLBACK
CORRUPT --> BACKUP_RESTORE
UNAVAIL --> MEMORY_FALLBACK

subgraph subGraph1 ["Recovery Actions"]
    TIER_SWITCH
    CLEANUP_AUTO
    BACKUP_RESTORE
    MEMORY_FALLBACK
end

subgraph subGraph0 ["Error Types"]
    QUOTA
    ACCESS
    CORRUPT
    UNAVAIL
end
```

Sources: [js/utils/storage.js L1036-L1070](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/storage.js#L1036-L1070)

 [js/utils/storage.js L1053-L1070](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/storage.js#L1053-L1070)