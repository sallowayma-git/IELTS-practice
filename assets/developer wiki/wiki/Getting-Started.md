# Getting Started

> **Relevant source files**
> * [LICENSE](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/LICENSE)
> * [README.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/README.md)
> * [css/main.css](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/css/main.css)
> * [index.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html)
> * [js/app.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app.js)
> * [js/main.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js)

This guide provides step-by-step instructions for setting up and launching the IELTS Practice System. It covers system requirements, initial configuration, choosing an entry point, and completing your first practice session.

For architectural details about the application core, see [Core Application Architecture](/sallowayma-git/IELTS-practice/3-core-application-architecture). For information about data persistence and repositories, see [Data Management System](/sallowayma-git/IELTS-practice/4-data-management-system). For theme-specific customization, see [Theme System & Visual Design](/sallowayma-git/IELTS-practice/7-theme-system-and-visual-design).

## System Requirements

### Browser Requirements

The IELTS Practice System is a client-side web application requiring modern browser support:

| Requirement | Specification | Notes |
| --- | --- | --- |
| **Browser** | Chrome 60+, Firefox 55+, Safari 12+, Edge 79+ | Chrome recommended for optimal performance |
| **JavaScript** | ES6+ support (Classes, Promises, async/await) | Required for core functionality |
| **Storage** | localStorage (5MB minimum) | Used for practice records and settings |
| **Storage (Optional)** | IndexedDB | Automatically used if available for large datasets |
| **Window APIs** | `postMessage`, `window.open` | Required for practice session communication |

**Sources:** [js/utils/storage.js L6-L54](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/storage.js#L6-L54)

 [js/app.js L1-L62](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app.js#L1-L62)

### Screen Resolution

* **Desktop**: 1024x768 minimum (1920x1080 recommended)
* **Mobile**: 768x1024 minimum (responsive design with horizontal orientation priority)

### File System Access

The system operates entirely from local files without requiring a web server. Modern browsers must allow:

* Opening local HTML files via `file://` protocol
* Cross-origin communication between windows from the same origin
* Browser popup windows for practice sessions

**Sources:** [index.html L1-L20](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L1-L20)

## Installation

### Step 1: Download and Extract

1. Download the complete repository from GitHub: `https://github.com/sallowayma-git/IELTS-practice`
2. Extract the archive to a local directory
3. Verify the following directory structure exists:

```
IELTS-practice/
├── index.html
├── js/
│   ├── app.js
│   ├── main.js
│   ├── boot-fallbacks.js
│   ├── core/
│   ├── utils/
│   ├── data/
│   └── components/
├── css/
│   └── main.css
├── assets/
│   ├── scripts/
│   │   ├── complete-exam-data.js
│   │   └── listening-exam-data.js
│   └── images/
└── .superdesign/
    └── design_iterations/
```

**Sources:** [index.html L1-L10](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L1-L10)

 [README.md L17-L24](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/README.md#L17-L24)

### Step 2: Verify File Integrity

Check that critical files are present:

* `index.html` - Main entry point
* `js/app.js` - Application core (ExamSystemApp)
* `js/main.js` - Initialization and utility functions
* `js/utils/storage.js` - StorageManager
* `assets/scripts/complete-exam-data.js` - Reading exam index
* `assets/scripts/listening-exam-data.js` - Listening exam index

**Sources:** [index.html L298-L304](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L298-L304)

## Launching the Application

### Primary Entry Point: index.html

The standard entry point provides access to all features with the default theme:

```mermaid
flowchart TD

USER["User"]
INDEX["index.html"]
BOOT["boot-fallbacks.js"]
DATA_SCRIPTS["Exam Data Scripts"]
STORAGE["js/utils/storage.js"]
GLOBALS["window.storage<br>window.examIndex<br>window.practiceRecords"]
EXAM_INDEX["window.completeExamIndex<br>window.listeningExamIndex"]
STORAGE_MGR["StorageManager Instance"]
NAMESPACE["'exam_system'"]
APP_INIT["ExamSystemApp.initialize()"]
INIT_LEGACY["initializeLegacyComponents()"]
LOAD_LIB["loadLibrary()"]
SYNC_RECORDS["syncPracticeRecords()"]
STATE["window.examIndex"]
RECORDS["window.practiceRecords"]
UI["updateOverview()"]
INTERFACE["User Interface"]

USER --> INDEX
INDEX --> BOOT
INDEX --> DATA_SCRIPTS
INDEX --> STORAGE
BOOT --> GLOBALS
DATA_SCRIPTS --> EXAM_INDEX
STORAGE --> STORAGE_MGR
STORAGE_MGR --> NAMESPACE
INDEX --> APP_INIT
APP_INIT --> INIT_LEGACY
APP_INIT --> LOAD_LIB
APP_INIT --> SYNC_RECORDS
LOAD_LIB --> STATE
SYNC_RECORDS --> RECORDS
STATE --> UI
UI --> INTERFACE
```

**Sources:** [index.html L86-L112](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L86-L112)

 [js/app.js L86-L92](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app.js#L86-L92)

 [js/main.js L255-L323](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L255-L323)

 [js/boot-fallbacks.js L1-L50](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/boot-fallbacks.js#L1-L50)

### Step-by-Step Launch Process

1. **Open the HTML file**: Double-click `index.html` or right-click → "Open with" → select your browser
2. **Allow popups**: Browser may prompt to allow popups for practice sessions - click "Allow"
3. **Wait for initialization**: System displays "系统准备就绪" (System Ready) message
4. **Verify loaded data**: Check the overview page shows exam categories (P1, P2, P3 reading; P1, P3 listening)

**Sources:** [js/main.js L256](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L256-L256)

 [js/main.js L552-L614](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L552-L614)

### Bootstrap Sequence Details

**Bootstrap Script Execution Order**

```mermaid
sequenceDiagram
  participant Browser
  participant index.html
  participant boot-fallbacks.js
  participant js/data/index.js
  participant StorageManager
  participant ExamSystemApp
  participant main.js

  Browser->>index.html: Load page
  index.html->>boot-fallbacks.js: Execute script
  boot-fallbacks.js->>boot-fallbacks.js: ensureGlobalStorage()
  boot-fallbacks.js->>Browser: window.storage ready
  index.html->>js/data/index.js: Execute script
  js/data/index.js->>StorageManager: Check window.storage
  loop [Storage Available]
    js/data/index.js->>js/data/index.js: createRepositories()
    js/data/index.js->>Browser: window.dataRepositories ready
    js/data/index.js->>js/data/index.js: Retry after 100ms
  end
  index.html->>Browser: DOMContentLoaded
  Browser->>ExamSystemApp: new ExamSystemApp()
  ExamSystemApp->>ExamSystemApp: apply mixins
  ExamSystemApp->>ExamSystemApp: initialize()
  ExamSystemApp->>main.js: initializeLegacyComponents()
  main.js->>main.js: loadLibrary()
  main.js->>main.js: syncPracticeRecords()
  main.js->>Browser: Application Ready
```

**Sources:** [js/boot-fallbacks.js L1-L50](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/boot-fallbacks.js#L1-L50)

 [js/data/index.js L15-L89](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/data/index.js#L15-L89)

 [js/app.js L86-L92](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app.js#L86-L92)

 [js/main.js L255-L323](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L255-L323)

### Storage Namespace Configuration

All entry points configure the same storage namespace to ensure data consistency:

```
// Executed during initialization
window.storage.setNamespace('exam_system');
```

This creates prefixed keys in localStorage:

* `exam_system_practice_records`
* `exam_system_user_stats`
* `exam_system_exam_index`
* `exam_system_settings`

**Sources:** [index.html L322-L324](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L322-L324)

 [js/utils/storage.js L302-L310](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/storage.js#L302-L310)

## Alternative Entry Points (Theme Portals)

### Theme Portal Options

The system provides complete UI redesigns through theme portals:

| Portal File | Theme Name | Visual Style | Use Case |
| --- | --- | --- | --- |
| `index.html` | Default | Academic gradient background | Standard usage |
| `.superdesign/design_iterations/ielts_academic_functional_2.html` | Academic | Professional blue | Formal study environment |
| `.superdesign/design_iterations/my_melody_ielts_1.html` | My Melody | Pastel pink | Visual preference |
| `.superdesign/design_iterations/HarryPoter.html` | Harry Potter | Map-based navigation | Gamified experience |

**Theme Portal Architecture**

```mermaid
flowchart TD

USER["User"]
PORTAL["Theme Portal HTML"]
STORAGE["StorageManager"]
REPOS["Data Repositories"]
THEME_CSS["Theme-specific CSS"]
PLUGINS["hp-path.js<br>hp-core-bridge.js"]
DATA["'exam_system'"]
DEFAULTS["Default Styles"]
CORE["Core Functionality"]

USER --> PORTAL
PORTAL --> STORAGE
PORTAL --> REPOS
PORTAL --> THEME_CSS
PORTAL --> PLUGINS
STORAGE --> DATA
THEME_CSS --> DEFAULTS
PLUGINS --> CORE
```

**Sources:** [index.html L240-L296](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L240-L296)

 [js/theme-switcher.js L1-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/theme-switcher.js#L1-L100)

### Switching Themes

After launching with any entry point, users can switch themes:

1. Navigate to **Settings** (⚙️ button in main navigation)
2. Click **🎨 主题切换** (Theme Switcher)
3. Select desired theme from modal
4. System redirects to chosen theme portal

Theme preference is stored in `localStorage` key `theme_preference` and triggers auto-redirect on subsequent visits.

**Sources:** [index.html L148-L150](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L148-L150)

 [index.html L240-L296](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L240-L296)

## Understanding the Interface

### Main Navigation Structure

After successful initialization, the interface presents four main sections:

**Navigation Controller Code Entity Mapping**

```mermaid
flowchart TD

NAV_CONTAINER[".main-nav container"]
BTN_OVERVIEW["📊 总览 button"]
BTN_BROWSE["📚 题库浏览 button"]
BTN_PRACTICE["📝 练习记录 button"]
BTN_SETTINGS["⚙️ 设置 button"]
VIEW_OVERVIEW["#overview-view"]
VIEW_BROWSE["#browse-view"]
VIEW_PRACTICE["#practice-view"]
VIEW_SETTINGS["#settings-view"]
OVERVIEW_CONTENT["updateOverview()<br>OverviewView.render()"]
BROWSE_CONTENT["LegacyExamListView.render()"]
PRACTICE_CONTENT["PracticeHistoryRenderer"]
SETTINGS_CONTENT["SettingsPanel"]

NAV_CONTAINER --> BTN_OVERVIEW
NAV_CONTAINER --> BTN_BROWSE
NAV_CONTAINER --> BTN_PRACTICE
NAV_CONTAINER --> BTN_SETTINGS
BTN_OVERVIEW --> VIEW_OVERVIEW
BTN_BROWSE --> VIEW_BROWSE
BTN_PRACTICE --> VIEW_PRACTICE
BTN_SETTINGS --> VIEW_SETTINGS
VIEW_OVERVIEW --> OVERVIEW_CONTENT
VIEW_BROWSE --> BROWSE_CONTENT
VIEW_PRACTICE --> PRACTICE_CONTENT
VIEW_SETTINGS --> SETTINGS_CONTENT
```

**Sources:** [index.html L22-L27](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L22-L27)

 [js/presentation/navigation-controller.js L1-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/presentation/navigation-controller.js#L1-L100)

 [js/main.js L225-L252](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L225-L252)

### View Functions and State Management

**Core View Management Functions**

| Function | Purpose | Location | Notes |
| --- | --- | --- | --- |
| `showView(viewName)` | Switch between main views | [js/main.js L1148-L1157](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L1148-L1157) | Legacy compatibility function |
| `navigateToView(viewName)` | Modern navigation method | `ExamSystemApp.navigateToView` | Part of navigationMixin |
| `updateOverview()` | Refresh overview statistics | [js/main.js L632-L687](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L632-L687) | Called after data changes |
| `updatePracticeView()` | Refresh practice history | [js/main.js L1063-L1118](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L1063-L1118) | Syncs with practice records |

**State Management Architecture**

```mermaid
flowchart TD

APP_STATE["AppStateService"]
LEGACY_ADAPTER["LegacyStateAdapter"]
GLOBAL_VARS["window.examIndex<br>window.practiceRecords<br>window.__browseFilter"]
GET_STATE["getExamIndex()<br>getPracticeRecords()<br>getBrowseFilter()"]
UI_COMPONENTS["UI Components"]
LEGACY_CODE["Legacy Functions"]
STATE_FUNCTIONS["State Accessor Functions"]

APP_STATE --> GET_STATE
APP_STATE --> LEGACY_ADAPTER
LEGACY_ADAPTER --> GLOBAL_VARS
GET_STATE --> UI_COMPONENTS
GLOBAL_VARS --> LEGACY_CODE
STATE_FUNCTIONS --> APP_STATE
STATE_FUNCTIONS --> APP_STATE
STATE_FUNCTIONS --> APP_STATE
```

**Sources:** [js/app/state-service.js L1-L200](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/state-service.js#L1-L200)

 [js/utils/legacyStateAdapter.js L1-L150](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/legacyStateAdapter.js#L1-L150)

 [js/main.js L48-L193](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L48-L193)

### Data Repositories

The data layer abstracts storage operations through repositories:

**Repository Registry System**

```mermaid
flowchart TD

REGISTRY["DataRepositoryRegistry"]
PRACTICE_REPO["PracticeRepository<br>max 1000 records"]
SETTINGS_REPO["SettingsRepository<br>user preferences"]
BACKUP_REPO["BackupRepository<br>max 20 backups"]
META_REPO["MetaRepository<br>user_stats, active_sessions"]
STORAGE_SOURCE["StorageDataSource"]
STORAGE_MGR["window.storage<br>StorageManager"]
EVENTS["'practice-repository-ready'<br>'settings-repository-ready'"]
APP["ExamSystemApp<br>DataIntegrityManager"]

REGISTRY --> PRACTICE_REPO
REGISTRY --> SETTINGS_REPO
REGISTRY --> BACKUP_REPO
REGISTRY --> META_REPO
PRACTICE_REPO --> STORAGE_SOURCE
SETTINGS_REPO --> STORAGE_SOURCE
BACKUP_REPO --> STORAGE_SOURCE
META_REPO --> STORAGE_SOURCE
STORAGE_SOURCE --> STORAGE_MGR
REGISTRY --> EVENTS
APP --> EVENTS
```

**Sources:** [js/data/repositories/dataRepositoryRegistry.js L1-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/data/repositories/dataRepositoryRegistry.js#L1-L100)

 [js/data/repositories/practiceRepository.js L1-L50](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/data/repositories/practiceRepository.js#L1-L50)

 [js/data/index.js L15-L89](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/data/index.js#L15-L89)

## First Practice Session

### Starting a Practice

**Practice Initiation Flow**

```mermaid
sequenceDiagram
  participant User
  participant Browse View
  participant LegacyExamListView
  participant examSessionMixin
  participant Practice Window
  participant practicePageEnhancer
  participant PracticeRecorder
  participant Storage

  User->>Browse View: Navigate to Browse
  Browse View->>LegacyExamListView: render()
  LegacyExamListView->>User: Display exam list
  User->>LegacyExamListView: Click "开始练习"
  LegacyExamListView->>examSessionMixin: openExam(examId)
  examSessionMixin->>Practice Window: window.open(examUrl)
  Practice Window->>Practice Window: Load HTML page
  examSessionMixin->>Practice Window: postMessage('INIT_SESSION')
  Practice Window->>practicePageEnhancer: Inject script
  practicePageEnhancer->>practicePageEnhancer: collectAnswers()
  practicePageEnhancer->>examSessionMixin: postMessage('SESSION_READY')
  User->>Practice Window: Complete practice
  Practice Window->>practicePageEnhancer: Submit answers
  practicePageEnhancer->>examSessionMixin: postMessage('PRACTICE_COMPLETE')
  examSessionMixin->>PracticeRecorder: savePracticeRecord()
  PracticeRecorder->>PracticeRecorder: enrichRecordData()
  PracticeRecorder->>Storage: save to practice_records
  Storage->>User: Display success message
```

**Sources:** [js/app/examSessionMixin.js L1-L868](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/examSessionMixin.js#L1-L868)

 [js/practice-page-enhancer.js L1-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/practice-page-enhancer.js#L1-L1200)

 [js/core/practiceRecorder.js L1-L320](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/practiceRecorder.js#L1-L320)

### Step-by-Step: Your First Practice

1. **Navigate to Browse View** * Click **📚 题库浏览** in main navigation * System calls `showView('browse')`
2. **Select an Exam** * Use search box to filter exams or browse by category * Example: Search "tea" to find "The History of Tea" * Click exam title to see metadata (category, frequency)
3. **Start Practice Session** * Click **开始练习** button next to exam title * System calls `openExam(examId)` from `examSessionMixin` * New window opens with practice HTML page * Wait for "会话已就绪" (Session Ready) confirmation
4. **Complete the Practice** * Answer questions in practice window * System tracks interactions via `practicePageEnhancer` * Click submit when finished
5. **View Results** * Practice window sends `PRACTICE_COMPLETE` message * Main window saves record via `PracticeRecorder.savePracticeRecord()` * Notification appears: "练习已完成，正在更新记录..." * Navigate to **📝 练习记录** to view statistics

**Sources:** [js/main.js L1148-L1238](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L1148-L1238)

 [js/app/examSessionMixin.js L100-L250](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/examSessionMixin.js#L100-L250)

 [js/core/practiceRecorder.js L254-L320](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/practiceRecorder.js#L254-L320)

### Practice Data Collection

**Data Capture Mechanism**

The `practicePageEnhancer` script collects comprehensive practice data:

```mermaid
flowchart TD

ENHANCER["practicePageEnhancer"]
USER_INPUTS["Input changes<br>Radio selections<br>Checkbox selections"]
INTERACTIONS["Click events<br>Focus events<br>Timestamps"]
DURATION["Start time<br>End time<br>Duration"]
ANSWERS["User answers<br>Correct answers<br>Score info"]
REAL_DATA["realData object"]
PARENT["Parent window"]
RECORDER["PracticeRecorder"]
REPOSITORY["PracticeRepository"]

ENHANCER --> USER_INPUTS
ENHANCER --> INTERACTIONS
ENHANCER --> DURATION
ENHANCER --> ANSWERS
USER_INPUTS --> REAL_DATA
INTERACTIONS --> REAL_DATA
DURATION --> REAL_DATA
ANSWERS --> REAL_DATA
REAL_DATA --> PARENT
PARENT --> RECORDER
RECORDER --> REPOSITORY
```

**Sources:** [js/practice-page-enhancer.js L1-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/practice-page-enhancer.js#L1-L1200)

 [js/core/practiceRecorder.js L1-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/practiceRecorder.js#L1-L100)

### Exam Data Structure

**Exam Index Format**

The exam library is defined in static data files:

```yaml
// window.completeExamIndex (reading exams)
{
  id: "p1-01",
  title: "The History of Tea 茶叶的历史",
  category: "P1",
  frequency: "high",
  path: "睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/P1/",
  filename: "P1 - The History of Tea.html",
  type: "reading"
}

// window.listeningExamIndex (listening exams)
{
  id: "listening-p1-01",
  title: "Campus Conversation",
  category: "P1",
  frequency: "medium",
  path: "ListeningPractice/P1/",
  filename: "L-P1-conversation.html",
  type: "listening"
}
```

**Sources:** [assets/scripts/complete-exam-data.js L1-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L1-L100)

 [assets/scripts/listening-exam-data.js L1-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L1-L100)

## Verifying Successful Setup

### System Health Checks

**Post-Initialization Validation**

```mermaid
flowchart TD

CHECKS["System Health Checks"]
STORAGE_CHECK["window.storage exists<br>storage.get() works"]
DATA_CHECK["window.examIndex loaded<br>Array with length > 0"]
REPO_CHECK["window.dataRepositories exists<br>PracticeRepository ready"]
UI_CHECK["Overview displays categories<br>Navigation responds"]
STORAGE_OK["✓ localStorage accessible"]
STORAGE_FAIL["✗ Check browser settings"]
DATA_OK["✓ Exam library loaded"]
DATA_FAIL["✗ Run loadLibrary()"]
REPO_OK["✓ Data layer ready"]
REPO_FAIL["✗ Check console errors"]
UI_OK["✓ Interface operational"]
UI_FAIL["✗ Refresh page"]

CHECKS --> STORAGE_CHECK
CHECKS --> DATA_CHECK
CHECKS --> REPO_CHECK
CHECKS --> UI_CHECK
STORAGE_CHECK --> STORAGE_OK
STORAGE_CHECK --> STORAGE_FAIL
DATA_CHECK --> DATA_OK
DATA_CHECK --> DATA_FAIL
REPO_CHECK --> REPO_OK
REPO_CHECK --> REPO_FAIL
UI_CHECK --> UI_OK
UI_CHECK --> UI_FAIL
```

**Sources:** [js/main.js L255-L323](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L255-L323)

 [js/main.js L552-L614](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L552-L614)

### Console Verification Commands

Open browser DevTools (F12) and execute in Console:

```javascript
// 1. Check storage availability
console.log('Storage:', window.storage ? '✓' : '✗');
console.log('Namespace:', window.storage?.config?.namespace);

// 2. Check exam index
console.log('Exam Count:', window.examIndex?.length || 0);
console.log('First Exam:', window.examIndex?.[0]);

// 3. Check repositories
console.log('Repositories:', window.dataRepositories ? '✓' : '✗');

// 4. Check practice records
console.log('Practice Records:', window.practiceRecords?.length || 0);

// 5. Check state service
console.log('State Service:', window.appStateService ? '✓' : '✗');
```

**Expected Output:**

```yaml
Storage: ✓
Namespace: exam_system
Exam Count: 147
First Exam: {id: "p1-01", title: "...", category: "P1", ...}
Repositories: ✓
Practice Records: 0
State Service: ✓
```

**Sources:** [js/main.js L48-L59](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L48-L59)

 [js/main.js L65-L95](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L65-L95)

### Visual Confirmation

**Overview Page Indicators:**

* Suite Mode card with "🚀 开启套题模式" button
* Reading section with P1, P2, P3 categories
* Listening section with P1, P3 categories
* Each category shows count (e.g., "42 篇")

**Settings Page Information:**

* "题目总数: 147" (Total exam count)
* "HTML题目: 147"
* "最后更新:" with timestamp

**Sources:** [js/main.js L689-L809](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L689-L809)

 [index.html L138-L144](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L138-L144)

## Common Startup Issues

### Issue: "题库未加载" (Library Not Loaded)

**Symptoms:**

* Overview shows empty categories
* Browse view displays no exams
* Console shows `window.examIndex = []`

**Solutions:**

1. Check exam data scripts loaded: [assets/scripts/complete-exam-data.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js)  [assets/scripts/listening-exam-data.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js)
2. Navigate to Settings → Click "📂 加载题库"
3. Check DevTools Console for script errors
4. Verify `window.completeExamIndex` and `window.listeningExamIndex` exist
5. Call `loadLibrary(true)` in console to force reload

**Sources:** [js/main.js L552-L608](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L552-L608)

### Issue: Practice Window Opens Blank

**Symptoms:**

* Click "开始练习" opens empty window
* Console shows 404 errors or CORS errors

**Solutions:**

1. Verify exam file exists at path specified in `exam.path + exam.filename`
2. Check browser allows `file://` access to local files
3. Verify popup blocker is disabled for the page
4. Check Console for `postMessage` errors
5. Try PDF version if HTML fails

**Sources:** [js/app/examSessionMixin.js L1-L250](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/app/examSessionMixin.js#L1-L250)

### Issue: Practice Data Not Saving

**Symptoms:**

* Complete practice but no record appears
* Statistics remain at zero
* Console shows storage errors

**Solutions:**

1. Check localStorage available: `window.storage.isAvailable()`
2. Verify not in Private/Incognito mode
3. Check storage quota: Settings → Create Backup (tests write access)
4. Check `window.practiceRecords` updates after practice
5. Run `syncPracticeRecords()` in console to force sync

**Sources:** [js/main.js L341-L443](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/main.js#L341-L443)

 [js/core/practiceRecorder.js L254-L320](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/core/practiceRecorder.js#L254-L320)

### Issue: "QuotaExceededError"

**Symptoms:**

* Cannot save new practice records
* Console error: "QuotaExceededError"
* Backup creation fails

**Solutions:**

1. Check localStorage usage: DevTools → Application → Storage
2. Export data: Settings → "📤 导出数据"
3. Clear old records: Settings → "🗑️ 清除记录"
4. System automatically triggers export on quota errors
5. Enable IndexedDB hybrid mode if available

**Sources:** [js/utils/storage.js L1008-L1031](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/storage.js#L1008-L1031)

 [js/components/DataIntegrityManager.js L1-L200](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/DataIntegrityManager.js#L1-L200)

## Next Steps

After successful setup:

1. **Explore the Interface**: Navigate through all four main views (Overview, Browse, Practice, Settings)
2. **Complete a Test Practice**: Try a P1 exam to understand the workflow
3. **Review Practice History**: Check how data is recorded and displayed
4. **Configure Settings**: Explore backup/export options and theme switching
5. **Read Architecture Docs**: See [Core Application Architecture](/sallowayma-git/IELTS-practice/3-core-application-architecture) for deeper understanding

For practice session details, see [Practice Session System](/sallowayma-git/IELTS-practice/5-practice-session-system). For data management, see [Data Management System](/sallowayma-git/IELTS-practice/4-data-management-system).

**Sources:** [index.html L22-L163](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/index.html#L22-L163)

## Troubleshooting Initial Setup

### Common Issues

1. **Storage Initialization Failures**: Check browser storage permissions
2. **Theme Loading Errors**: Verify file paths and network connectivity
3. **Data Loading Problems**: Ensure exam data scripts load successfully

### Diagnostic Tools

The system provides built-in diagnostic capabilities:

* Storage monitoring via `startStorageMonitoring()`
* Error logging through `injection_errors` and `collection_errors` keys
* Data integrity checking via `DataIntegrityManager`

**Sources:** [js/utils/storage.js L1235-L1291](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/storage.js#L1235-L1291)

 [js/utils/storage.js L847-L859](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/storage.js#L847-L859)