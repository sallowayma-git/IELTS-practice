# Data Integrity & Quality Management

> **Relevant source files**
> * [assets/developer wiki/hp-overview-usage-todo.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/developer wiki/hp-overview-usage-todo.md)
> * [js/components/DataIntegrityManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js)
> * [js/components/dataManagementPanel.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/dataManagementPanel.js)
> * [js/data/index.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/data/index.js)
> * [js/script.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/script.js)
> * [js/utils/dataBackupManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataBackupManager.js)
> * [js/utils/helpers.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/helpers.js)
> * [js/utils/simpleStorageWrapper.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/simpleStorageWrapper.js)
> * [js/views/legacyViewBundle.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/views/legacyViewBundle.js)

This document covers the comprehensive data integrity and quality management system that ensures the reliability, consistency, and recoverability of practice session data in the IELTS system. The system provides automated validation, backup creation, data repair mechanisms, and quality assurance reporting.

For information about the underlying storage persistence mechanisms, see [Storage Manager & Persistence](/sallowayma-git/IELTS-practice/4.1-repository-architecture-and-data-layer). For details about data import/export operations, see [Data Backup & Import/Export](/sallowayma-git/IELTS-practice/4.2-data-backup-and-importexport).

## System Overview

The data integrity system operates through three primary components that work together to maintain data quality and system reliability:

```mermaid
flowchart TD

DIM["DataIntegrityManager<br>Primary Controller"]
DCM["DataConsistencyManager<br>Record Validation"]
ME["MarkdownExporter<br>Export Validation"]
VAL["Data Validation<br>validateData()"]
REP["Data Repair<br>repairData()"]
BCK["Backup Management<br>createBackup()"]
EXP["Export Operations<br>exportData()"]
SM["StorageManager<br>Data Access"]
LS["localStorage<br>Primary Storage"]
IDX["IndexedDB<br>Backup Storage"]
CHK["Integrity Checks<br>calculateChecksum()"]
RPT["Quality Reports<br>getDataQualityReport()"]
MIG["Data Migration<br>performDataMigration()"]

DIM --> VAL
DIM --> REP
DIM --> BCK
DIM --> EXP
DCM --> VAL
DCM --> REP
VAL --> SM
REP --> SM
BCK --> LS
BCK --> IDX
EXP --> SM
CHK --> BCK
RPT --> DCM
MIG --> DIM

subgraph subGraph3 ["Quality Assurance"]
    CHK
    RPT
    MIG
end

subgraph subGraph2 ["Storage Integration"]
    SM
    LS
    IDX
    SM --> LS
end

subgraph subGraph1 ["Core Operations"]
    VAL
    REP
    BCK
    EXP
end

subgraph subGraph0 ["Data Integrity Layer"]
    DIM
    DCM
    ME
    ME --> DCM
end
```

**Sources:** [js/components/DataIntegrityManager.js L1-L918](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L1-L918)

 [js/utils/dataConsistencyManager.js L1-L417](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataConsistencyManager.js#L1-L417)

 [js/utils/markdownExporter.js L1-L834](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/markdownExporter.js#L1-L834)

## Data Validation System

The validation system implements a comprehensive rule-based approach to ensure data integrity across different record types:

### Validation Rules Architecture

```mermaid
flowchart TD

PR["practice_records<br>Required: id, startTime<br>Types: string, number"]
SS["system_settings<br>Types: theme, language<br>Booleans: autoSave"]
CUST["Custom Validators<br>startTime, endTime<br>duration, id"]
REQ["Required Fields<br>Check Presence"]
TYP["Type Validation<br>Check Data Types"]
VAL["Custom Validators<br>Business Logic"]
RPT["Validation Report<br>errors[], warnings[]"]

PR --> REQ
SS --> TYP
CUST --> VAL

subgraph subGraph1 ["Validation Process"]
    REQ
    TYP
    VAL
    RPT
    REQ --> RPT
    TYP --> RPT
    VAL --> RPT
end

subgraph subGraph0 ["Validation Rules Registry"]
    PR
    SS
    CUST
end
```

The `DataIntegrityManager` registers default validation rules during initialization through `registerDefaultValidationRules()`:

* **Practice Records**: Require `id` and `startTime`, validate date formats and numeric constraints
* **System Settings**: Enforce proper theme strings and boolean flags
* **Custom Validators**: Implement business logic for timestamps and durations

**Sources:** [js/components/DataIntegrityManager.js L28-L60](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L28-L60)

 [js/components/DataIntegrityManager.js L411-L465](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L411-L465)

### Record Consistency Validation

The `DataConsistencyManager` provides specialized validation for practice records:

```mermaid
flowchart TD

IN["Practice Record<br>Input Data"]
RF["Required Fields<br>validateRecordData()"]
ANS["Answer Validation<br>validateAnswers()"]
QUA["Quality Assessment<br>dataQuality: good/fair/poor"]
STD["Standardize Format<br>standardizeAnswerFormat()"]
GEN["Generate Missing<br>generateAnswerComparison()"]
CAL["Calculate Scores<br>calculateScoreFromComparison()"]

QUA --> STD

subgraph subGraph1 ["Data Enrichment"]
    STD
    GEN
    CAL
    STD --> GEN
    GEN --> CAL
end

subgraph subGraph0 ["Record Validation Flow"]
    IN
    RF
    ANS
    QUA
    IN --> RF
    RF --> ANS
    ANS --> QUA
end
```

The validation process checks for required fields (`id`, `startTime`, `answers`), validates answer key formats, and assesses overall data quality based on completeness and consistency.

**Sources:** [js/utils/dataConsistencyManager.js L17-L71](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataConsistencyManager.js#L17-L71)

 [js/utils/dataConsistencyManager.js L221-L261](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataConsistencyManager.js#L221-L261)

## Backup and Recovery System

The backup system provides automated data protection with configurable intervals and quota management:

### Backup Lifecycle Management

```mermaid
sequenceDiagram
  participant Auto Backup Timer
  participant DataIntegrityManager
  participant localStorage
  participant File Download

  Auto Backup Timer->>DataIntegrityManager: "performAutoBackup() (10min interval)"
  DataIntegrityManager->>localStorage: "getCriticalData()"
  localStorage-->>DataIntegrityManager: "practice_records, settings, etc"
  DataIntegrityManager->>DataIntegrityManager: "calculateChecksum()"
  loop [Still Failed]
    DataIntegrityManager->>File Download: "downloadBackupFile()"
    DataIntegrityManager->>localStorage: "safeUpdateBackupIndex() (external)"
    DataIntegrityManager->>localStorage: "tryStoreBackupWithEviction()"
    DataIntegrityManager->>localStorage: "safeUpdateBackupIndex() (local)"
    DataIntegrityManager->>DataIntegrityManager: "cleanupOldBackups()"
    DataIntegrityManager->>localStorage: "retry storage"
    DataIntegrityManager->>File Download: "downloadBackupFile()"
  end
```

The system maintains up to 5 backups by default (`maxBackups`) and automatically handles storage quota exceeded errors through progressive cleanup and fallback to file downloads.

**Sources:** [js/components/DataIntegrityManager.js L91-L215](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L91-L215)

 [js/components/DataIntegrityManager.js L263-L294](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L263-L294)

### Backup Index Management

The backup index tracks both local storage and external file backups:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique backup identifier |
| `timestamp` | string | ISO datetime of creation |
| `type` | string | `auto`, `manual`, `pre_restore`, `pre_migration` |
| `location` | string | `localStorage` or `download` |
| `size` | number | Backup data size in bytes |
| `checksum` | string | Data integrity hash |

**Sources:** [js/components/DataIntegrityManager.js L237-L261](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L237-L261)

 [js/components/DataIntegrityManager.js L353-L360](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L353-L360)

## Data Repair Mechanisms

The system implements automatic data repair for common consistency issues:

### Repair Process Flow

```mermaid
flowchart TD

IN["Input Record<br>Potentially Inconsistent"]
VAL["validateRecordData()<br>Identify Issues"]
ENR["enrichRecordData()<br>Fill Missing Data"]
STD["standardizeAnswerFormat()<br>Normalize Keys"]
GEN["generateAnswerComparison()<br>Create Missing Comparisons"]
FIX["fixDataInconsistencies()<br>Batch Processing"]
KEY["Key Normalization<br>q1, q2, question1 → q1"]
ANS["Answer Standardization<br>true → TRUE, not given → NOT GIVEN"]
SCR["Score Calculation<br>From Answer Comparison"]
TIM["Time Field Repair<br>duration, startTime, endTime"]

STD --> KEY
STD --> ANS
ENR --> SCR
ENR --> TIM

subgraph subGraph1 ["Repair Operations"]
    KEY
    ANS
    SCR
    TIM
end

subgraph subGraph0 ["Data Repair Pipeline"]
    IN
    VAL
    ENR
    STD
    GEN
    FIX
    IN --> VAL
    VAL --> ENR
    ENR --> STD
    STD --> GEN
    GEN --> FIX
end
```

The repair system handles several common data inconsistencies:

* **Key Format Standardization**: Converts `question1` to `q1`, numeric keys to `q{number}`
* **Answer Value Normalization**: Standardizes boolean and common IELTS answer formats
* **Missing Field Population**: Generates `answerComparison` from user and correct answers
* **Score Reconciliation**: Ensures consistency between different score representations

**Sources:** [js/utils/dataConsistencyManager.js L76-L183](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataConsistencyManager.js#L76-L183)

 [js/utils/dataConsistencyManager.js L188-L216](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataConsistencyManager.js#L188-L216)

 [js/utils/dataConsistencyManager.js L331-L348](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataConsistencyManager.js#L331-L348)

## Quality Management and Reporting

The system provides comprehensive quality assessment and reporting capabilities:

### Quality Assessment Metrics

```mermaid
flowchart TD

COM["Completeness<br>Required Fields Present"]
CON["Consistency<br>Data Format Adherence"]
VAL["Validity<br>Business Rule Compliance"]
INT["Integrity<br>Checksum Verification"]
GOOD["good<br>All checks pass"]
FAIR["fair<br>Minor issues, warnings"]
POOR["poor<br>Missing critical data"]
INV["invalid<br>Validation errors"]

COM --> GOOD
CON --> FAIR
VAL --> POOR
INT --> INV

subgraph subGraph1 ["Quality Levels"]
    GOOD
    FAIR
    POOR
    INV
end

subgraph subGraph0 ["Quality Dimensions"]
    COM
    CON
    VAL
    INT
end
```

The `getDataQualityReport()` function provides detailed metrics:

| Metric | Description |
| --- | --- |
| `totalRecords` | Total number of practice records |
| `validRecords` | Records passing validation |
| `recordsWithCorrectAnswers` | Records with answer keys |
| `recordsWithComparison` | Records with comparison data |
| `averageAnswerCount` | Mean answers per record |
| `qualityDistribution` | Count by quality level |

**Sources:** [js/utils/dataConsistencyManager.js L368-L413](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataConsistencyManager.js#L368-L413)

 [js/components/DataIntegrityManager.js L893-L908](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L893-L908)

## Export Data Integrity

The export system ensures data consistency during markdown and JSON export operations:

### Export Validation Pipeline

```mermaid
sequenceDiagram
  participant MarkdownExporter
  participant DataConsistencyManager
  participant DataIntegrityManager

  MarkdownExporter->>DataConsistencyManager: "getDataQualityReport()"
  DataConsistencyManager-->>MarkdownExporter: "Quality Assessment"
  MarkdownExporter->>MarkdownExporter: "processRecordsInBatches()"
  loop [For Each Batch]
    MarkdownExporter->>DataConsistencyManager: "ensureConsistency(record)"
    DataConsistencyManager->>DataConsistencyManager: "validateRecordData()"
    DataConsistencyManager->>DataConsistencyManager: "enrichRecordData()"
    DataConsistencyManager-->>MarkdownExporter: "Consistent Record"
  end
  MarkdownExporter->>MarkdownExporter: "generateMarkdownContent()"
  MarkdownExporter->>DataIntegrityManager: "exportData() (JSON)"
  DataIntegrityManager->>DataIntegrityManager: "calculateChecksum()"
  DataIntegrityManager-->>MarkdownExporter: "Verified Export"
```

The export process includes:

* **Pre-export Validation**: Quality assessment and batch repair
* **Data Consistency Enforcement**: Answer comparison generation and score reconciliation
* **Progress Tracking**: Non-blocking batch processing with UI updates
* **Integrity Verification**: Checksum calculation for exported data

**Sources:** [js/utils/markdownExporter.js L126-L215](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/markdownExporter.js#L126-L215)

 [js/utils/markdownExporter.js L220-L246](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/markdownExporter.js#L220-L246)

 [js/components/DataIntegrityManager.js L533-L622](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L533-L622)

## Integration with Storage System

The data integrity components integrate closely with the storage layer:

### Storage Integration Points

```mermaid
flowchart TD

DIM["DataIntegrityManager"]
DCM["DataConsistencyManager"]
GET["storage.get()<br>Data Retrieval"]
SET["storage.set()<br>Data Persistence"]
EXP["storage.exportData()<br>Full Export"]
VAL["Data Validation<br>Before Storage"]
QUO["Quota Exceeded<br>Cleanup & Retry"]
COR["Corruption Detection<br>Checksum Verification"]
REC["Recovery Operations<br>Backup Restoration"]

DIM --> GET
DIM --> SET
DIM --> EXP
DCM --> VAL
SET --> QUO
GET --> COR

subgraph subGraph2 ["Error Handling"]
    QUO
    COR
    REC
    COR --> REC
end

subgraph subGraph1 ["Storage Operations"]
    GET
    SET
    EXP
    VAL
end

subgraph subGraph0 ["Integrity Layer"]
    DIM
    DCM
end
```

The integration ensures that all storage operations are validated and that data corruption is detected early through checksum verification and structural validation.

**Sources:** [js/components/DataIntegrityManager.js L106-L127](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L106-L127)

 [js/components/DataIntegrityManager.js L950-L1039](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L950-L1039)

 [js/utils/dataConsistencyManager.js L353-L363](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/dataConsistencyManager.js#L353-L363)