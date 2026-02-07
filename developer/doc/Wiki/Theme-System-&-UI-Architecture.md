# Theme System & UI Architecture

> **Relevant source files**
> * [.gitignore](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.gitignore)
> * [.superdesign/design_iterations/ielts_academic_functional_2.html](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html)
> * [.superdesign/design_iterations/my_melody_ielts_1.html](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html)
> * [js/plugins/themes/theme-adapter-base.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js)

This document describes the theme system architecture that enables multiple visual variants of the IELTS practice application. The system uses a theme adapter pattern to provide a unified interface between theme HTML files and the core application, allowing themes to access exam data, practice records, and system functionality through a consistent API.

The theme system consists of three layers: (1) `ThemeAdapterBase` providing unified data access and event handling, (2) theme-specific HTML entry points with custom CSS, and (3) runtime theme management for switching and persistence. For the Harry Potter theme's specialized bridge architecture, see page 8.

## Theme Architecture Overview

The theme system architecture separates presentation from functionality through the `ThemeAdapterBase` abstraction. Each theme HTML file initializes its own adapter instance, which provides access to exam data and practice records while maintaining isolation from core application internals.

**Theme System Architecture**

```mermaid
flowchart TD

MelodyHTML[".superdesign/design_iterations/<br>my_melody_ielts_1.html"]
AcademicHTML[".superdesign/design_iterations/<br>ielts_academic_functional_2.html"]
XiaoDaiHTML[".superdesign/design_iterations/<br>xiaodaidai_dashboard_1.html"]
ThemeAdapterBase["js/plugins/themes/<br>theme-adapter-base.js"]
MelodyAdapter["js/plugins/themes/melody/<br>melody-adapter.js"]
AcademicAdapter["js/plugins/themes/academic/<br>academic-adapter.js"]
StorageAccess["Storage Access<br>getExamIndex()<br>getPracticeRecords()"]
DataWrite["Data Persistence<br>savePracticeRecord()"]
PathResolution["Path Resolution<br>buildResourcePath()<br>getResourceAttempts()"]
MessageBus["Event Bus<br>onDataUpdated()<br>onMessage()"]
WindowStorage["window.storage API"]
LocalStorage["localStorage fallback"]
GlobalVars["Global variables fallback<br>completeExamIndex<br>listeningExamIndex"]

MelodyHTML -.-> MelodyAdapter
AcademicHTML -.-> AcademicAdapter
XiaoDaiHTML -.-> ThemeAdapterBase
ThemeAdapterBase -.-> StorageAccess
ThemeAdapterBase -.-> DataWrite
ThemeAdapterBase -.-> PathResolution
ThemeAdapterBase -.-> MessageBus
StorageAccess -.-> WindowStorage

subgraph subGraph3 ["Storage Backend"]
    WindowStorage
    LocalStorage
    GlobalVars
    WindowStorage -.-> LocalStorage
    LocalStorage -.-> GlobalVars
end

subgraph subGraph2 ["Core Application Access"]
    StorageAccess
    DataWrite
    PathResolution
    MessageBus
end

subgraph subGraph1 ["Theme Adapter Layer"]
    ThemeAdapterBase
    MelodyAdapter
    AcademicAdapter
    MelodyAdapter -.-> ThemeAdapterBase
    AcademicAdapter -.-> ThemeAdapterBase
end

subgraph subGraph0 ["Theme Entry Points"]
    MelodyHTML
    AcademicHTML
    XiaoDaiHTML
end
```

Sources: [js/plugins/themes/theme-adapter-base.js L1-L45](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L1-L45)

 [.superdesign/design_iterations/my_melody_ielts_1.html L17-L29](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html#L17-L29)

 [.superdesign/design_iterations/ielts_academic_functional_2.html L1-L10](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L1-L10)

## ThemeAdapterBase Data Access

`ThemeAdapterBase` provides a unified interface for themes to access application data without directly coupling to storage internals. The adapter implements storage event listeners, postMessage protocol handling, and multi-backend data access with automatic fallbacks.

**ThemeAdapterBase API Surface**

```mermaid
flowchart TD

BuildResourcePath["buildResourcePath(exam, kind)<br>kind: 'html' | 'pdf'"]
GetResourceAttempts["getResourceAttempts(exam, kind)<br>Returns: [{label, path}]"]
GetFallbackOrder["getFallbackOrder()<br>Returns: ['map', 'fallback', 'raw'...]"]
GetExamIndex["getExamIndex()<br>Returns: Array of exam objects"]
GetPracticeRecords["getPracticeRecords()<br>Returns: Array of practice records"]
GetExamById["getExamById(id)<br>Returns: Single exam object"]
SavePracticeRecord["savePracticeRecord(record)<br>Async write to storage"]
OnDataUpdated["onDataUpdated(callback)<br>Register data change listener"]
OnMessage["onMessage(type, callback)<br>Register postMessage handler"]
ShowMessage["showMessage(msg, type, duration)<br>Display UI feedback"]
OpenExam["openExam(examOrId, options)<br>Open practice window"]
StartHandshake["_startHandshake(window, exam)<br>INIT_SESSION protocol"]
HandlePracticeComplete["_handlePracticeComplete(payload)<br>Process results"]
ExamIndexCache["_examIndex: Array<br>Cached exam data"]
PracticeRecordsCache["_practiceRecords: Array<br>Cached practice records"]
ActiveSessions["_activeSessions: Map<br>Session tracking"]

GetExamIndex -.-> ExamIndexCache
GetPracticeRecords -.-> PracticeRecordsCache
SavePracticeRecord -.-> PracticeRecordsCache
OnDataUpdated -.-> ExamIndexCache
OnMessage -.-> HandlePracticeComplete
StartHandshake -.-> ActiveSessions
HandlePracticeComplete -.-> SavePracticeRecord

subgraph subGraph4 ["Internal State"]
    ExamIndexCache
    PracticeRecordsCache
    ActiveSessions
end

subgraph subGraph3 ["Exam Window Management"]
    OpenExam
    StartHandshake
    HandlePracticeComplete
    OpenExam -.-> StartHandshake
end

subgraph subGraph2 ["Event System"]
    OnDataUpdated
    OnMessage
    ShowMessage
end

subgraph subGraph0 ["Data Access Methods"]
    GetExamIndex
    GetPracticeRecords
    GetExamById
    SavePracticeRecord
end

subgraph subGraph1 ["Resource Path Resolution"]
    BuildResourcePath
    GetResourceAttempts
    GetFallbackOrder
    BuildResourcePath -.-> GetResourceAttempts
    GetFallbackOrder -.-> GetResourceAttempts
end
```

### Storage Keys and Constants

The adapter uses consistent storage keys defined in [js/plugins/themes/theme-adapter-base.js L16-L22](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L16-L22)

:

| Constant | Value | Purpose |
| --- | --- | --- |
| `STORAGE_KEYS.EXAM_INDEX` | `'exam_index'` | Primary exam index storage key |
| `STORAGE_KEYS.ACTIVE_EXAM_INDEX_KEY` | `'active_exam_index_key'` | Currently active exam index identifier |
| `STORAGE_KEYS.PRACTICE_RECORDS` | `'practice_records'` | Practice session records storage key |
| `EXAM_INDEX_KEY_RE` | `/^exam_index(_\d+)?$/` | Pattern for exam index key variants |
| `PATH_FALLBACK_ORDER` | `['map', 'fallback', 'raw', 'relative-up', 'relative-design']` | Resource path resolution strategy order |

### Data Normalization

The adapter performs automatic normalization of data from various sources:

**Type Normalization**: The `normalizeType()` function [js/plugins/themes/theme-adapter-base.js L149-L169](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L149-L169)

 standardizes exam types to `'reading'` or `'listening'`, handling aliases like `'read'`, `'r'`, `'listen'`, `'l'`, `'audio'`.

**Record Deduplication**: The `deduplicateRecords()` function [js/plugins/themes/theme-adapter-base.js L200-L232](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L200-L232)

 removes duplicate practice records based on `sessionId`, keeping the record with the latest timestamp.

**Practice Payload Normalization**: The `normalizePracticePayload()` function [js/plugins/themes/theme-adapter-base.js L373-L493](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L373-L493)

 extracts score, duration, and metadata from various message format variations, supporting multiple naming conventions for the same data.

Sources: [js/plugins/themes/theme-adapter-base.js L499-L547](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L499-L547)

 [js/plugins/themes/theme-adapter-base.js L549-L643](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L549-L643)

 [js/plugins/themes/theme-adapter-base.js L996-L1089](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L996-L1089)

## Theme Variants

The system provides three main theme variants, each implemented as standalone HTML files with embedded CSS and theme-specific initialization code.

### My Melody Theme

The My Melody theme in [.superdesign/design_iterations/my_melody_ielts_1.html](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html)

 implements a kawaii-inspired design with pastel colors, glass morphism effects, and animated gradients.

**My Melody Theme Implementation**

```mermaid
flowchart TD

ThemeHTML["my_melody_ielts_1.html"]
ScriptsLoaded["Loads: complete-exam-data.js<br>listening-exam-data.js<br>boot-fallbacks.js<br>storage.js<br>theme-adapter-base.js<br>melody-adapter.js"]
InitAdapter["MelodyAdapter.init()<br>Line 24-28"]
ColorPalette["Light Mode Variables<br>--my-melody-pink: #FFB6E1<br>--my-melody-blue: #87CEEB<br>--my-melody-purple: #DDA0DD<br>--my-melody-mint: #98FB98"]
DarkMode["body.dark-mode overrides<br>Adjusted saturation<br>Lines 69-102"]
GradientBG["--gradient-bg<br>5-color animated gradient<br>rainbowFlow animation"]
HeaderSection[".header glass morphism<br>backdrop-filter: blur(15px)<br>Emoji particles system"]
IslandNav[".island navigation<br>Floating island buttons<br>Transform hover effects"]
StatCards[".stat-card<br>Radial gradient blur effects<br>Center glow animations"]
BowtieCheckbox[".bowtie-checkbox-wrapper<br>Custom checkbox styling<br>Lines 918-1027"]
RecordModal[".modal practice record details<br>Gradient backgrounds<br>Pink color scheme"]
AnswersTable[".questions-table<br>Pastel row colors<br>Status badges"]

ThemeHTML -.-> ColorPalette
ColorPalette -.-> HeaderSection
GradientBG -.-> IslandNav
BowtieCheckbox -.-> RecordModal

subgraph subGraph3 ["Modal System"]
    RecordModal
    AnswersTable
    RecordModal -.-> AnswersTable
end

subgraph subGraph2 ["Visual Components"]
    HeaderSection
    IslandNav
    StatCards
    BowtieCheckbox
    IslandNav -.-> StatCards
    StatCards -.-> BowtieCheckbox
end

subgraph subGraph1 ["CSS Variable System"]
    ColorPalette
    DarkMode
    GradientBG
    ColorPalette -.-> DarkMode
    ColorPalette -.-> GradientBG
end

subgraph subGraph0 ["HTML Structure"]
    ThemeHTML
    ScriptsLoaded
    InitAdapter
    ThemeHTML -.-> ScriptsLoaded
    ScriptsLoaded -.-> InitAdapter
end
```

The My Melody theme uses CSS custom properties for theming [.superdesign/design_iterations/my_melody_ielts_1.html L33-L66](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html#L33-L66)

:

| Light Mode Variable | Value | Usage |
| --- | --- | --- |
| `--my-melody-pink` | `#FFB6E1` | Primary accent, borders, buttons |
| `--my-melody-blue` | `#87CEEB` | Secondary accent, backgrounds |
| `--my-melody-purple` | `#DDA0DD` | Tertiary accent, gradients |
| `--my-melody-mint` | `#98FB98` | Success indicators |
| `--my-melody-lavender` | `#E6E6FA` | Card borders, backgrounds |
| `--gradient-bg` | 5-color linear gradient | Animated background with `rainbowFlow` |

**Dark Mode Support**: The theme includes dark mode overrides in [.superdesign/design_iterations/my_melody_ielts_1.html L69-L102](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html#L69-L102)

 with adjusted color saturation and muted gradients applied via `body.dark-mode` class.

**Glass Morphism Effects**: Cards and headers use `backdrop-filter: blur(15px)` combined with radial gradients for depth [.superdesign/design_iterations/my_melody_ielts_1.html L541-L580](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html#L541-L580)

### Academic Theme

The Academic theme in [.superdesign/design_iterations/ielts_academic_functional_2.html](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html)

 provides a professional, scholarly interface with serif typography and a structured sidebar navigation.

**Academic Theme Design System**

```mermaid
flowchart TD

AcademicHTML["ielts_academic_functional_2.html"]
AppContainer[".app-container<br>Flex layout: sidebar + main"]
Sidebar[".sidebar 280px fixed width"]
MainContent[".main-content flex: 1"]
ColorSystem["Academic Blue Palette<br>--color-primary: #1e3a8a<br>--color-primary-light: #2563eb<br>--color-secondary: #3b82f6"]
NeutralScale["Neutral Scale<br>--color-gray-50 to --color-gray-900<br>Comprehensive neutral colors"]
SemanticColors["Semantic Colors<br>--color-parchment: #f8f6f0<br>--color-ink: #2d3748"]
SpacingGrid["4px Grid System<br>--space-1: 0.25rem to<br>--space-10: 4rem"]
SerifFonts["Georgia serif<br>Primary headings and titles"]
SansSerifFonts["Source Sans Pro<br>UI elements and body text"]
TypeScale["Font Size Scale<br>--font-size-xs: 0.75rem to<br>--font-size-5xl: 3rem"]
NavItems[".nav-item sidebar buttons<br>Professional styling<br>Active state indicators"]
StatCards[".stat-card academic cards<br>Clean shadows and borders<br>Hover elevation"]
TableStyles[".table records table<br>Alternating row colors<br>Professional typography"]

AcademicHTML -.-> ColorSystem
AcademicHTML -.-> SerifFonts
Sidebar -.-> NavItems
MainContent -.-> StatCards

subgraph subGraph3 ["Component Styles"]
    NavItems
    StatCards
    TableStyles
    StatCards -.-> TableStyles
end

subgraph Typography ["Typography"]
    SerifFonts
    SansSerifFonts
    TypeScale
    SerifFonts -.-> SansSerifFonts
    SansSerifFonts -.-> TypeScale
end

subgraph subGraph1 ["CSS Design Tokens"]
    ColorSystem
    NeutralScale
    SemanticColors
    SpacingGrid
    ColorSystem -.-> NeutralScale
    NeutralScale -.-> SemanticColors
    SemanticColors -.-> SpacingGrid
end

subgraph subGraph0 ["HTML Structure"]
    AcademicHTML
    AppContainer
    Sidebar
    MainContent
    AcademicHTML -.-> AppContainer
    AppContainer -.-> Sidebar
    AppContainer -.-> MainContent
end
```

The Academic theme uses a comprehensive design token system [.superdesign/design_iterations/ielts_academic_functional_2.html L16-L100](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L16-L100)

:

| Token Category | Examples | Purpose |
| --- | --- | --- |
| Color Palette | `--color-primary: #1e3a8a`, `--color-parchment: #f8f6f0` | Academic blue theme with parchment background |
| Spacing Grid | `--space-1` through `--space-10` | 4px-based consistent spacing system |
| Typography | `--font-size-xs` through `--font-size-5xl` | Modular type scale |
| Font Weights | `--font-weight-normal` through `--font-weight-bold` | Typography hierarchy |
| Shadows | `--shadow-sm` through `--shadow-xl` | Elevation system |
| Border Radius | `--radius-sm` through `--radius-2xl` | Corner rounding system |

**Sidebar Navigation**: The theme uses a fixed 280px sidebar [.superdesign/design_iterations/ielts_academic_functional_2.html L123-L203](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L123-L203)

 with professional button styling and active state indicators.

**Responsive Design**: Media queries at 1024px and 768px breakpoints [.superdesign/design_iterations/ielts_academic_functional_2.html L780-L850](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L780-L850)

 adapt the layout for tablets and mobile devices.

### XiaoDai Theme

The XiaoDai theme (`xiaodaidai_dashboard_1.html`) provides an alternative visual style. Specific implementation details would be found in that HTML file.

Sources: [.superdesign/design_iterations/my_melody_ielts_1.html L1-L30](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html#L1-L30)

 [.superdesign/design_iterations/my_melody_ielts_1.html L31-L102](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html#L31-L102)

 [.superdesign/design_iterations/ielts_academic_functional_2.html L1-L14](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L1-L14)

 [.superdesign/design_iterations/ielts_academic_functional_2.html L15-L100](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L15-L100)

## Runtime Theme Management

While each theme variant is implemented as a separate HTML entry point, the system provides runtime theme management capabilities through ThemeManager utilities and theme-specific dark mode toggles.

### Theme Persistence and Loading

Theme selection is persisted across sessions through localStorage. Each theme HTML file can implement its own theme switching mechanism, or delegate to a centralized ThemeManager if available.

**Theme Loading Sequence**

```mermaid
flowchart TD

HTMLLoad["Theme HTML file loads"]
CheckStorage["Check localStorage<br>for theme preferences"]
LoadScripts["Load core scripts:<br>storage.js<br>theme-adapter-base.js<br>theme-specific adapter"]
InitAdapter["ThemeAdapter.init()<br>or MelodyAdapter.init()"]
LoadExamIndex["_loadExamIndex()<br>From storage or global vars"]
LoadRecords["_loadPracticeRecords()<br>From storage"]
InstallListeners["Install storage listener<br>Install message listener"]
ApplyTheme["Apply CSS variables"]
ApplyDarkMode["Apply dark mode if stored"]
RenderUI["Render UI components"]
Ready["Theme ready<br>isReady = true"]

LoadScripts -.-> InitAdapter
InstallListeners -.-> ApplyTheme

subgraph subGraph2 ["Theme Application"]
    ApplyTheme
    ApplyDarkMode
    RenderUI
    Ready
    ApplyTheme -.-> ApplyDarkMode
    ApplyDarkMode -.-> RenderUI
    RenderUI -.-> Ready
end

subgraph subGraph1 ["Adapter Initialization"]
    InitAdapter
    LoadExamIndex
    LoadRecords
    InstallListeners
    InitAdapter -.-> LoadExamIndex
    LoadExamIndex -.-> LoadRecords
    LoadRecords -.-> InstallListeners
end

subgraph subGraph0 ["Page Load"]
    HTMLLoad
    CheckStorage
    LoadScripts
    HTMLLoad -.-> CheckStorage
    CheckStorage -.-> LoadScripts
end
```

### Dark Mode Implementation

Each theme implements dark mode through CSS class toggles on the `body` element:

**My Melody Dark Mode**: Activated via `body.dark-mode` class [.superdesign/design_iterations/my_melody_ielts_1.html L69-L102](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html#L69-L102)

 which overrides CSS variables with darker color values and adjusted saturation.

**Academic Theme**: Uses media query support for high contrast and reduced motion preferences [.superdesign/design_iterations/ielts_academic_functional_2.html L896-L912](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L896-L912)

### Theme Switching Modal

Themes that support runtime switching (like the Academic theme) implement a theme switcher modal [.superdesign/design_iterations/ielts_academic_functional_2.html L936-L1095](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L936-L1095)

:

| Function | Implementation | Purpose |
| --- | --- | --- |
| `showThemeSwitcher()` | Display modal with theme options | Allow user to select between theme variants |
| Theme card click | Navigate to different theme HTML file | Load selected theme |
| Current theme badge | Visual indicator of active theme | User feedback |

### Font Size Management

Some themes provide accessibility features for font size adjustment, persisted in localStorage:

```
// Example font size management pattern
localStorage.setItem('fontSize', selectedSize);
document.documentElement.style.fontSize = selectedSize + 'px';
```

### Auto-Theme Based on System Preferences

Themes can optionally detect system color scheme preferences:

```javascript
// Example system preference detection
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
if (prefersDark) {
  document.body.classList.add('dark-mode');
}
```

Sources: [js/plugins/themes/theme-adapter-base.js L524-L547](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/plugins/themes/theme-adapter-base.js#L524-L547)

 [.superdesign/design_iterations/my_melody_ielts_1.html L20-L29](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/my_melody_ielts_1.html#L20-L29)

 [.superdesign/design_iterations/ielts_academic_functional_2.html L936-L1095](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/ielts_academic_functional_2.html#L936-L1095)

## Practice History Component UI

The `PracticeHistory` class provides a comprehensive interface for viewing and managing practice session records.

```mermaid
flowchart TD

PHClass["PracticeHistory class<br>practiceHistory.js"]
PHInit["initialize()<br>setupEventListeners()<br>createHistoryInterface()"]
PHFilters["Filter System<br>category, frequency<br>date range, accuracy"]
PHPagination["Pagination<br>recordsPerPage<br>currentPage"]
CreateInterface["createHistoryInterface()<br>Generate HTML structure"]
CreateRecordItem["createRecordItem(record)<br>Individual record HTML"]
RenderList["renderHistoryList()<br>Paginated record display"]
RenderPagination["renderPagination()<br>Page navigation"]
ShowDetails["showRecordDetails(recordId)<br>Detailed view modal"]
ShowImport["showImportDialog()<br>Import functionality"]
AnswersTable["generateAnswersTable()<br>Answer comparison"]
ExportHistory["exportHistory()<br>JSON export"]
ExportMarkdown["exportRecordAsMarkdown()<br>Markdown format"]
GenerateMarkdown["generateMarkdownExport()<br>Format conversion"]

PHInit -.-> CreateInterface
PHClass -.-> ShowDetails
PHClass -.-> ShowImport
PHClass -.-> ExportHistory

subgraph subGraph3 ["Data Export"]
    ExportHistory
    ExportMarkdown
    GenerateMarkdown
    ExportHistory -.-> ExportMarkdown
    ExportMarkdown -.-> GenerateMarkdown
end

subgraph subGraph2 ["Modal Dialogs"]
    ShowDetails
    ShowImport
    AnswersTable
    ShowDetails -.-> AnswersTable
end

subgraph subGraph1 ["UI Generation Methods"]
    CreateInterface
    CreateRecordItem
    RenderList
    RenderPagination
    CreateInterface -.-> CreateRecordItem
    CreateRecordItem -.-> RenderList
    RenderList -.-> RenderPagination
end

subgraph subGraph0 ["PracticeHistory Component Structure"]
    PHClass
    PHInit
    PHFilters
    PHPagination
    PHClass -.-> PHInit
end
```

Sources: [js/components/practiceHistory.js L5-L33](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L5-L33)

 [js/components/practiceHistory.js L99-L241](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L99-L241)

### Filter and Search System

The component provides comprehensive filtering capabilities:

| Filter Type | Element ID | Options | Functionality |
| --- | --- | --- | --- |
| Category | `#category-filter` | all, P1, P2, P3 | Filter by exam category |
| Frequency | `#frequency-filter` | all, high, low | Filter by question frequency |
| Status | `#status-filter` | all, completed, interrupted | Filter by completion status |
| Date Range | `#date-range-filter` | all, today, week, month, custom | Time-based filtering |
| Accuracy | `#min-accuracy`, `#max-accuracy` | 0-100% sliders | Accuracy range filtering |
| Search | `#history-search` | Text input | Title/ID search with debounce |

The filter system uses event delegation and debounced input handling:

```mermaid
flowchart TD

FilterChange["Filter Change Event"]
UpdateFilters["updateFiltersFromUI()"]
ApplyFilters["applyFilters()"]
FilterRecords["Filter currentRecords"]
CategoryFilter["Category filtering<br>record.metadata.category"]
DateFilter["Date range filtering<br>applyDateRangeFilter()"]
AccuracyFilter["Accuracy filtering<br>minAccuracy/maxAccuracy"]
SearchFilter["Text search<br>title/examId matching"]
SortRecords["applySorting()<br>sortBy, sortOrder"]
UpdateStats["updateHistoryStats()"]
RenderResults["renderHistoryList()<br>renderPagination()"]

FilterRecords -.-> CategoryFilter
FilterRecords -.-> DateFilter
FilterRecords -.-> AccuracyFilter
FilterRecords -.-> SearchFilter
CategoryFilter -.-> SortRecords
DateFilter -.-> SortRecords

subgraph subGraph2 ["Result Processing"]
    SortRecords
    UpdateStats
    RenderResults
    SortRecords -.-> UpdateStats
    UpdateStats -.-> RenderResults
end

subgraph subGraph1 ["Filter Operations"]
    CategoryFilter
    DateFilter
    AccuracyFilter
    SearchFilter
end

subgraph subGraph0 ["Filter Event Flow"]
    FilterChange
    UpdateFilters
    ApplyFilters
    FilterRecords
    FilterChange -.-> UpdateFilters
    UpdateFilters -.-> ApplyFilters
    ApplyFilters -.-> FilterRecords
end
```

Sources: [js/components/practiceHistory.js L244-L302](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L244-L302)

 [js/components/practiceHistory.js L355-L411](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L355-L411)

### Record Details Modal System

The component creates detailed modal dialogs for individual practice records:

```mermaid
flowchart TD

ShowDetails["showRecordDetails(recordId)"]
FindRecord["Find record in filteredRecords"]
GenerateHTML["Generate modal HTML structure"]
ShowModal["showModal(detailsContent)"]
BasicInfo["Basic Information<br>Title, Category, Frequency"]
TimeInfo["Time Information<br>Start, End, Duration"]
ScoreInfo["Score Information<br>Accuracy, Correct/Total"]
AnswersSection["Answers Section<br>generateAnswersTable()"]
TypePerformance["Question Type Performance<br>Optional breakdown"]
CheckAnswers["Check record.answers<br>record.scoreInfo.details"]
ProcessData["Process answer data<br>Sort by question number"]
CreateTable["Create HTML table<br>Correct vs User answers"]
FormatAnswers["formatAnswer()<br>Handle display formatting"]

GenerateHTML -.-> BasicInfo
GenerateHTML -.-> TimeInfo
GenerateHTML -.-> ScoreInfo
GenerateHTML -.-> AnswersSection
GenerateHTML -.-> TypePerformance
AnswersSection -.-> CheckAnswers

subgraph subGraph2 ["Answer Table Generation"]
    CheckAnswers
    ProcessData
    CreateTable
    FormatAnswers
    CheckAnswers -.-> ProcessData
    ProcessData -.-> CreateTable
    CreateTable -.-> FormatAnswers
end

subgraph subGraph1 ["Detail Sections"]
    BasicInfo
    TimeInfo
    ScoreInfo
    AnswersSection
    TypePerformance
end

subgraph subGraph0 ["Modal Creation Flow"]
    ShowDetails
    FindRecord
    GenerateHTML
    ShowModal
    ShowDetails -.-> FindRecord
    FindRecord -.-> GenerateHTML
    GenerateHTML -.-> ShowModal
end
```

Sources: [js/components/practiceHistory.js L717-L832](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L717-L832)

 [js/components/practiceHistory.js L836-L931](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L836-L931)

### Markdown Export System

The component supports exporting practice records in Markdown format for external analysis:

```mermaid
flowchart TD

SingleExport["exportRecordAsMarkdown(recordId)"]
BatchExport["exportMultipleRecords(recordIds)"]
DetailModal["Export button in modal"]
GenerateMarkdown["generateMarkdownExport(record)"]
CreateHeader["## Category Frequency Title Score"]
CreateTable["| 序号 | 正确答案 | 我的答案 | 对错 | 错误分析 |"]
ProcessAnswers["Sort and format answer data"]
FormatRows["Format table rows with alignment"]
CreateBlob["new Blob(markdown, text/markdown)"]
CreateURL["URL.createObjectURL(blob)"]
TriggerDownload["element click download"]
CleanupURL["URL.revokeObjectURL()"]

SingleExport -.-> GenerateMarkdown
BatchExport -.-> GenerateMarkdown
FormatRows -.-> CreateBlob

subgraph subGraph2 ["File Download"]
    CreateBlob
    CreateURL
    TriggerDownload
    CleanupURL
    CreateBlob -.-> CreateURL
    CreateURL -.-> TriggerDownload
    TriggerDownload -.-> CleanupURL
end

subgraph subGraph1 ["Markdown Generation"]
    GenerateMarkdown
    CreateHeader
    CreateTable
    ProcessAnswers
    FormatRows
    GenerateMarkdown -.-> CreateHeader
    CreateHeader -.-> CreateTable
    CreateTable -.-> ProcessAnswers
    ProcessAnswers -.-> FormatRows
end

subgraph subGraph0 ["Export Triggers"]
    SingleExport
    BatchExport
    DetailModal
    DetailModal -.-> SingleExport
end
```

Sources: [js/components/practiceHistory.js L1218-L1280](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L1218-L1280)

 [js/components/practiceHistory.js L1285-L1314](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L1285-L1314)

 [js/components/practiceHistory.js L1319-L1355](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/practiceHistory.js#L1319-L1355)