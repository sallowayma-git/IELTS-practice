# Global Field Inventory

> **Purpose:** Single source of truth for global fields after the Phase 3 data-layer refactor (`0.6.2-fix`).  
> Use this document when doing **subtractive optimization**: delete aliases and dead fields only after confirming they are not on a write gate or summary consumer.  
> **Last updated:** 2026-07-11 (onboarding tour alignment pass)

---

## 1. Architecture layers (read top → write bottom)

```
UI / Onboarding / Views
        │
AppStateService / ExamSystemApp.state     ← in-memory UI mirrors
        │
PracticeRecordAPI / PracticeStore         ← public write gate for practice + user_stats
        │
PracticeCore (contracts + internalStore)
        │
Repositories: practice | meta | settings | backups
        │
StorageDataSource (queued writes / transactions)
        │
StorageManager (prefix exam_system_)      IndexedDB → localStorage → sessionStorage → memory
```

**Hard rules**

| Rule | Location |
| --- | --- |
| Practice records must be written via `PracticeRecordAPI` | `js/core/practiceRecordAPI.js`, `js/utils/storage.js` redirects |
| `user_stats` must go through `PracticeRecordAPI` | `js/data/index.js` meta facade throws on direct access |
| `saveRecord` requires canonical `examId` after normalize | `PracticeRecordAPI.saveRecord` |
| Public `dataRepositories.transaction` cannot include `practice` | `js/data/index.js` |

Authoritative shapes live in:

- `PracticeCore.contracts.standardizeRecord` → `js/core/practiceCore.js`
- Meta defaults/validators → `js/data/index.js`
- Summary projection → `PracticeCore.projectRecordSummary` / `PracticeRecordAPI.listSummary`

---

## 2. Physical / protected storage keys

Prefix: `exam_system_` (see `StorageManager` in `js/utils/storage.js`).

| Logical key | Kind | Public access | Notes |
| --- | --- | --- | --- |
| `practice_records` | array (max 1000) | **PracticeRecordAPI only** | Direct `Storage.get/set` redirects or throws |
| `user_stats` | object | **PracticeRecordAPI only** | Meta repo holds data; public meta facade blocks key |
| `storage_version` | string \| null | meta (internal / guarded) | Migration stamp |
| `data_restored` | boolean | meta | Restore flag |
| `active_sessions` | array | meta / session recovery | |
| `temp_practice_records` | array | meta / recovery | |
| `interrupted_records` | array | meta / recovery | |
| `exam_index` | array | app loaders / browse | Active library snapshot also uses `active_exam_index_key` |
| `vocab_words` | array | vocab store | |
| `vocab_user_config` | object | vocab store | |
| `vocab_review_queue` | array | vocab store | |
| `vocab_list_reading_highlights` | array \| `{ words: [] }` | vocab / reading | |
| `legacy_practice_records_migrated` | boolean | migration | |
| settings keys | object(s) | `settings` repository | Theme, practice prefs, etc. |
| backup slots | array (max 20) | `backups` repository | Manual backups |

Related non-meta keys used by app (still via StorageManager / preferences):

- `active_exam_index_key` — which exam index dataset is active
- Backend preference keys for StorageManager

---

## 3. `user_stats` shape

Default factory: `ExamData.createDefaultUserStats` / `PracticeRecordAPI.getDefaultStats`.

| Field | Type | Role |
| --- | --- | --- |
| `totalPractices` | number | Count of practices |
| `totalTimeSpent` | number | Seconds |
| `averageScore` | number | Mean **accuracy 0–1** |
| `categoryStats` | object map | Per category aggregates |
| `questionTypeStats` | object map | Per question-type aggregates |
| `streakDays` | number | Consecutive practice days |
| `lastPracticeDate` | string \| null | ISO day / date |
| `practiceDays` | string[] | ISO `YYYY-MM-DD` (ensured by API) |
| `achievements` | array | Achievement ids / payloads |
| `createdAt` / `updatedAt` | ISO string | Timestamps |

**Do not** inject temporary demo records with `updateStats: true` (pollutes aggregates).

---

## 4. Canonical practice record (`0.6.2-fix`)

Produced by `PracticeCore.contracts.standardizeRecord`.

### 4.1 Required / identity

| Field | Required for save | Notes |
| --- | --- | --- |
| `id` | yes (generated if missing) | Stable attempt id |
| `examId` | **yes** | Inferred via `inferExamId`; without it `normalizeRecord` returns null / save throws |
| `sessionId` | optional | Shared across suite passages; **not** global unique key |
| `type` | inferred | `reading` / `listening` / … |
| `title` | preferred | Falls back to metadata / examId |
| `version` | stamped | Default `0.6.2-fix` |

### 4.2 Timing & score

| Field | Notes |
| --- | --- |
| `startTime`, `endTime`, `date` | ISO strings preferred |
| `duration` | seconds |
| `status` | default `completed` |
| `score` | often equals correct count |
| `totalQuestions`, `correctAnswers` | counts |
| `accuracy` | **0–1** (values 1–100 normalized down) |

### 4.3 Answers & replay

| Field | Shape after standardize | Replay role |
| --- | --- | --- |
| `answers` | **array** of `{ questionId, answer, … }` | List/history; **not** sufficient alone for DOM replay |
| `correctAnswerMap` | object map `{ q1: '…' }` | Canonical correct answers |
| `answerDetails` | details object / array | Scoring UI |
| `answerComparison` | object map | Optional; rebuilt when map present |
| `questionTypePerformance` | object | Stats |
| `scoreInfo` | object | `correct/total/accuracy/percentage/details` |
| `realData.answers` | **object map** | **Preferred user-answer source for replay** after save |
| `realData.correctAnswerMap` | object map | Replay / dual path |
| `realData.highlights` | array | Passage highlights |
| `realData.markedQuestions` | array | Optional |
| `realData.scrollY` | number | Optional |
| `highlights` / `markedQuestions` | top-level optional | Also read from metadata |

### 4.4 Metadata & suite

| Field | Notes |
| --- | --- |
| `metadata.examId` | Mirror of examId |
| `metadata.examTitle` | Display title |
| `metadata.category` | Prefer `P1` / `P2` / `P3` (not marketing labels) |
| `metadata.frequency` | e.g. 高频 / suite / unknown |
| `metadata.type` / `examType` / `practiceType` | Type hints |
| `frequency` | Top-level mirror |
| `suiteMode`, `suiteSessionId`, `suiteEntries` | Suite practice |

### 4.5 Summary projection (listSummary)

**Kept:** id, sessionId, examId, title, type, times, duration, percentage/accuracy/score counts, suite light fields, questionTypePerformance, light scoreInfo, light metadata, createdAt/updatedAt  

**Stripped:** full `answers` arrays, full `realData`, full `answerComparison`, heavy suite entry answers  

Consumers: history list, heatmap, trends, `recalculateStats`.

---

## 5. Legacy aliases (accepted on read, do not write as primary)

`standardizeRecord` / `normalizeRecord` still accept these **inbound** aliases. New code should not emit them as the only payload.

| Alias / obsolete | Canonical |
| --- | --- |
| `recordId`, `record_id`, `practiceId`, `practice_id`, `uuid` | `id` |
| `sessionID` | `sessionId` |
| `start_time`, `startedAt` | `startTime` |
| `end_time`, `completedAt`, `finishedAt`, `finishTime` | `endTime` |
| `percentage` (top-level only) | `accuracy` (0–1) + `scoreInfo.percentage` |
| `answerList` | `answers` |
| `finalScore` | `score` |
| `userAnswer` / single-question schema (`typeChecker`) | `answers` map / array + maps |
| `questions: []` (old onboarding) | remove; use answers maps |
| `category: '官方真题'` | `metadata.category: 'P1'\|'P2'\|'P3'` |
| Snake_case date fields | ISO camelCase |

---

## 6. In-memory app state

### `AppStateService.state` (`js/app/state-service.js`)

| Field | Role |
| --- | --- |
| `examIndex` | Loaded exam library snapshot |
| `practiceRecords` | In-memory records mirror |
| `filteredExams` | Browse results |
| `browseFilter` / `__browseFilter` | `{ category, type }` |
| `bulkDeleteMode`, `selectedRecords` | History bulk ops |
| `customSuiteDraft` | Suite builder draft |
| `processedSessions`, `fallbackExamSessions` | Session de-dupe / fallback |

### `ExamSystemApp.state` (`js/app.js`)

Nested mirrors under `exam`, `practice`, `ui`, `components`, `system` — keep in sync via `setPracticeRecordsState` / AppStateService, not by writing storage directly.

---

## 7. UI-only / tour-only keys (outside meta repo)

| Key | Location | Notes |
| --- | --- | --- |
| `exam_system_onboarding_completed` | localStorage (tour) | Prefixed; migrates from `onboardingCompleted` |
| `exam_system_onboarding_step` | localStorage | Migrates from `onboardingStep` |
| `exam_system_onboarding_last_shown` | localStorage | Migrates from `onboardingLastShown` |
| GPL accept flag | localStorage via index interactions | Blocks core until accepted |
| Theme preference | settings / preference store | Preference store (not a dead typeChecker schema) |

**Next-round candidate:** move onboarding completion into settings/meta repository so backup/export can include tour state.

---

## 8. Onboarding demo contract (post-refactor)

| Item | Value |
| --- | --- |
| Record id | `demo-onboarding-record` (fixed; cleaned on skip/complete) |
| Preferred examId | `p1-high-01` (must exist in active exam index for full replay) |
| Save options | `{ updateStats: false }` |
| Replay-critical payload | `examId` + `correctAnswerMap` + `realData.answers` (object map) |
| Fallback | If no exam in index → skip interactive replay, keep tour unblocked |

History / modal selectors:

- `#history-list .history-item.history-record-item[data-record-id="demo-onboarding-record"]`
- `… .practice-record-title`
- `#practice-record-modal .record-summary-replay-trigger`

---

## 9. Subtractive optimization backlog

Priority order (see also [cleanup-tracker](../../docs/cleanup-tracker.md)):

1. **Onboarding** — done (demo + copy + storage key prefix + scroll lock)
2. **`typeChecker` / `codeStandards`** — **done Sprint A** (removed from diagnostics + deleted)
3. **Writing scorer residual** — **done Sprint A** (commented tool card removed)
4. **ScoreStorage façade / listSummary paths** — Sprint B
5. **Meta key audit** — `temp_practice_records` / `interrupted_records` (Sprint B)
6. **Normalize only in PracticeCore** — Sprint C
7. **AppState dual mirrors** — Sprint C
8. **Onboarding → meta repo** — optional later

---

## 10. Verification checklist for field deletion

Before removing a field or alias:

1. Search write sites: `PracticeRecordAPI`, `standardizeRecord`, `fromCompletion`, import/backup
2. Search read sites: summary projection, overview stats, replay (`examSessionMixin`, unified reading page)
3. Confirm no migration path still emits it without a fallback
4. Prefer deprecating documentation first; remove runtime aliases only when ingress is gone

---

## Related docs

- [Data Repositories & Transactions](./Data-Repositories-&-Transactions.md)
- [Storage Architecture & Multi-Backend System](./Storage-Architecture-&-Multi-Backend-System.md)
- [PracticeRecorder & ScoreStorage](./PracticeRecorder-&-ScoreStorage.md)
- [Development Roadmap & Refactoring Tasks](./Development-Roadmap-&-Refactoring-Tasks.md)
- [Exam Index & Metadata Structure](./Exam-Index-&-Metadata-Structure.md)
