# User Interface & Styling

> **Relevant source files**
> * [css/styles.css](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css)
> * [js/components/practiceHistory.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js)

This document covers the presentation layer of the IELTS Reading Practice System, including the comprehensive CSS framework with theme support, responsive design, accessibility features, and the practice history analytics component. The styling system provides a cohesive visual experience across all views while maintaining accessibility and responsive design principles.

For information about the core application architecture and view management, see [Core Application](/sallowayma-git/IELTS-practice/2-core-application). For details about data persistence and storage mechanisms, see [Data Storage & Integrity](/sallowayma-git/IELTS-practice/2.3-data-storage-and-integrity).

## CSS Architecture Overview

The styling system is built around a comprehensive CSS framework located in [css/styles.css L1-L3136](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L1-L3136)

 that provides consistent theming, responsive design, and accessibility features throughout the application.

```mermaid
flowchart TD

CSSVars["CSS Variables (:root)"]
PrimaryColors["Primary Colors<br>--primary-color<br>--success-color<br>--error-color"]
LayoutVars["Layout Variables<br>--spacing---font-size-<br>--border-radius"]
ThemeVars["Theme Variables<br>--bg-primary<br>--text-primary<br>--border-color"]
HeaderStyles[".main-header<br>.logo<br>.main-nav"]
CardStyles[".category-card<br>.stat-card<br>.exam-card"]
FormStyles[".btn<br>.nav-btn<br>.filter-select"]
ModalStyles[".modal-overlay<br>.modal<br>.modal-header"]
Breakpoints["Media Queries<br>768px, 1024px<br>480px, 320px"]
TouchOptim["Touch Optimization<br>@media (hover: none)"]
LandscapeOptim["Landscape Mode<br>@media (orientation)"]
HighContrast[".high-contrast<br>Enhanced borders<br>Bold fonts"]
ReducedMotion[".reduce-motion<br>Disabled animations<br>prefers-reduced-motion"]
FontScaling[".font-large<br>.font-extra-large<br>Dynamic sizing"]

ThemeVars --> HeaderStyles
ThemeVars --> CardStyles
ThemeVars --> FormStyles
ThemeVars --> ModalStyles
Breakpoints --> HeaderStyles
Breakpoints --> CardStyles
TouchOptim --> FormStyles
LandscapeOptim --> HeaderStyles
HighContrast --> CardStyles
ReducedMotion --> ModalStyles
FontScaling --> HeaderStyles

subgraph subGraph3 ["Accessibility Features"]
    HighContrast
    ReducedMotion
    FontScaling
end

subgraph subGraph2 ["Responsive System"]
    Breakpoints
    TouchOptim
    LandscapeOptim
end

subgraph subGraph1 ["Component Styles"]
    HeaderStyles
    CardStyles
    FormStyles
    ModalStyles
end

subgraph subGraph0 ["CSS Variable System"]
    CSSVars
    PrimaryColors
    LayoutVars
    ThemeVars
    CSSVars --> PrimaryColors
    CSSVars --> LayoutVars
    CSSVars --> ThemeVars
end
```

Sources: [css/styles.css L1-L49](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L1-L49)

 [css/styles.css L374-L637](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L374-L637)

 [css/styles.css L647-L681](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L647-L681)

## Theme System and Color Management

The application uses a sophisticated CSS custom properties system for consistent theming and easy customization.

| Category | Variables | Purpose |
| --- | --- | --- |
| Primary Colors | `--primary-color`, `--primary-hover`, `--primary-color-light` | Brand colors and interactive elements |
| Status Colors | `--success-color`, `--warning-color`, `--error-color` | Feedback and state indication |
| Background | `--bg-primary`, `--bg-secondary`, `--bg-tertiary` | Layer hierarchy and depth |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary` | Content hierarchy |
| Layout | `--spacing-xs` through `--spacing-2xl` | Consistent spacing system |
| Typography | `--font-size-xs` through `--font-size-3xl` | Text size scale |

The system supports automatic dark mode detection and manual theme switching:

```mermaid
flowchart TD

PrefersScheme["@media (prefers-color-scheme: dark)"]
ThemeClass[".theme-dark class"]
SystemPref["System Preference"]
DarkBG["--bg-primary: #1f2937<br>--bg-secondary: #111827"]
DarkText["--text-primary: #f9fafb<br>--text-secondary: #d1d5db"]
DarkBorder["--border-color: #374151"]
HeaderAdapt[".main-header adapts"]
CardAdapt[".category-card adapts"]
ModalAdapt[".modal adapts"]

PrefersScheme --> DarkBG
ThemeClass --> DarkBG
DarkBG --> HeaderAdapt
DarkText --> CardAdapt
DarkBorder --> ModalAdapt

subgraph subGraph2 ["Component Adaptation"]
    HeaderAdapt
    CardAdapt
    ModalAdapt
end

subgraph subGraph1 ["Theme Variables Override"]
    DarkBG
    DarkText
    DarkBorder
end

subgraph subGraph0 ["Theme Detection"]
    PrefersScheme
    ThemeClass
    SystemPref
    SystemPref --> ThemeClass
end
```

Sources: [css/styles.css L2-L49](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L2-L49)

 [css/styles.css L672-L681](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L672-L681)

 [css/styles.css L765-L778](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L765-L778)

## Responsive Design System

The application implements a mobile-first responsive design with multiple breakpoints and adaptive layouts.

### Breakpoint Strategy

| Breakpoint | Range | Target Devices | Key Adaptations |
| --- | --- | --- | --- |
| Desktop | > 1024px | Desktop screens | Full grid layouts, hover states |
| Tablet | 769px - 1024px | Tablets | 2-column grids, touch optimization |
| Mobile | 481px - 768px | Mobile landscape | Single column, larger touch targets |
| Small Mobile | 320px - 480px | Mobile portrait | Compressed spacing, stacked layouts |
| Ultra Small | < 320px | Very small screens | Minimal content, essential features only |

### Responsive Components

```

```

Sources: [css/styles.css L392-L636](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L392-L636)

 [css/styles.css L376-L391](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L376-L391)

 [css/styles.css L494-L596](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L494-L596)

## Accessibility Features

The styling system includes comprehensive accessibility support through multiple mechanisms.

### High Contrast Mode

The `.high-contrast` class provides enhanced visual accessibility:

```mermaid
flowchart TD

BorderEnhance["Enhanced Borders<br>2px → 3px solid<br>border-color: #000000"]
FontWeight["Font Weight<br>normal → 600<br>Bold text emphasis"]
FocusRing["Focus Indicators<br>3px solid outline<br>2px offset"]
ButtonHC[".high-contrast .btn<br>2px borders<br>600 font-weight"]
CardHC[".high-contrast .card<br>2px solid borders<br>Enhanced contrast"]
LinkHC[".high-contrast a<br>underline forced<br>600 font-weight"]

BorderEnhance --> ButtonHC
FontWeight --> ButtonHC
FocusRing --> CardHC
BorderEnhance --> LinkHC

subgraph subGraph1 ["Component Overrides"]
    ButtonHC
    CardHC
    LinkHC
end

subgraph subGraph0 ["High Contrast Enhancements"]
    BorderEnhance
    FontWeight
    FocusRing
end
```

Sources: [css/styles.css L730-L763](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L730-L763)

 [css/styles.css L660-L669](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L660-L669)

### Motion and Animation Control

The system respects user preferences for reduced motion:

* `@media (prefers-reduced-motion: reduce)` automatically disables animations [css/styles.css L647-L658](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L647-L658)
* `.reduce-motion` class provides manual override [css/styles.css L719-L728](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L719-L728)
* All transitions and animations can be disabled [css/styles.css L1157-L1166](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L1157-L1166)

### Font Scaling Support

Multiple font scaling options accommodate different vision needs:

| Class | Base Font Size | Scale Factor | Use Case |
| --- | --- | --- | --- |
| Default | 1rem | 1.0x | Standard viewing |
| `.font-large` | 1.125rem | 1.125x | Improved readability |
| `.font-extra-large` | 1.25rem | 1.25x | Accessibility compliance |

Sources: [css/styles.css L686-L717](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L686-L717)

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

PHInit --> CreateInterface
PHClass --> ShowDetails
PHClass --> ShowImport
PHClass --> ExportHistory

subgraph subGraph3 ["Data Export"]
    ExportHistory
    ExportMarkdown
    GenerateMarkdown
    ExportHistory --> ExportMarkdown
    ExportMarkdown --> GenerateMarkdown
end

subgraph subGraph2 ["Modal Dialogs"]
    ShowDetails
    ShowImport
    AnswersTable
    ShowDetails --> AnswersTable
end

subgraph subGraph1 ["UI Generation Methods"]
    CreateInterface
    CreateRecordItem
    RenderList
    RenderPagination
    CreateInterface --> CreateRecordItem
    CreateRecordItem --> RenderList
    RenderList --> RenderPagination
end

subgraph subGraph0 ["PracticeHistory Component Structure"]
    PHClass
    PHInit
    PHFilters
    PHPagination
    PHClass --> PHInit
end
```

Sources: [js/components/practiceHistory.js L5-L33](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L5-L33)

 [js/components/practiceHistory.js L99-L241](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L99-L241)

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

FilterRecords --> CategoryFilter
FilterRecords --> DateFilter
FilterRecords --> AccuracyFilter
FilterRecords --> SearchFilter
CategoryFilter --> SortRecords
DateFilter --> SortRecords

subgraph subGraph2 ["Result Processing"]
    SortRecords
    UpdateStats
    RenderResults
    SortRecords --> UpdateStats
    UpdateStats --> RenderResults
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
    FilterChange --> UpdateFilters
    UpdateFilters --> ApplyFilters
    ApplyFilters --> FilterRecords
end
```

Sources: [js/components/practiceHistory.js L244-L302](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L244-L302)

 [js/components/practiceHistory.js L355-L411](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L355-L411)

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

GenerateHTML --> BasicInfo
GenerateHTML --> TimeInfo
GenerateHTML --> ScoreInfo
GenerateHTML --> AnswersSection
GenerateHTML --> TypePerformance
AnswersSection --> CheckAnswers

subgraph subGraph2 ["Answer Table Generation"]
    CheckAnswers
    ProcessData
    CreateTable
    FormatAnswers
    CheckAnswers --> ProcessData
    ProcessData --> CreateTable
    CreateTable --> FormatAnswers
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
    ShowDetails --> FindRecord
    FindRecord --> GenerateHTML
    GenerateHTML --> ShowModal
end
```

Sources: [js/components/practiceHistory.js L717-L832](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L717-L832)

 [js/components/practiceHistory.js L836-L931](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L836-L931)

### Library Loader Modal Refresh (2025-10-12)

- `showLibraryLoaderModal` has been rebuilt on top of the shared DOM builder and event delegation utilities. Buttons, file inputs, and teardown logic are now data-attribute driven, removing the legacy `innerHTML` template and eight direct `addEventListener` bindings while keeping legacy fallbacks for environments without the helper library.【F:js/main.js†L1369-L1569】
- Dedicated styling rules in `css/main.css` provide the gradient header, two-column card layout, and responsive behavior for the loader modal, replacing 40+ inline declarations and aligning the component with the global theming system.【F:css/main.css†L1559-L1772】

### Overview, Browse & Backup UI Modernization (2025-10-13)

- The dashboard fallback renderer now uses `window.DOM.create` to build category cards, exposing `data-overview-action` hooks that reuse the central delegation pipeline and eliminate inline `onclick` strings.【F:js/main.js†L493-L688】
- Browse list empty states are standardized with semantic markup and shared helpers so the experience matches design tokens even when filters yield zero results.【F:js/main.js†L1002-L1095】【F:css/main.css†L480-L548】
- Settings backups render through DOM Builder with delegated restore/close actions, avoiding global callbacks and providing a consistent modal fallback for environments without the settings view container.【F:js/main.js†L2488-L2626】【F:css/main.css†L1099-L1174】

### Markdown Export System

The component supports exporting practice records in Markdown format for external analysis:

```mermaid
flowchart TD

SingleExport["exportRecordAsMarkdown(recordId)"]
BatchExport["exportMultipleRecords(recordIds)"]
DetailModal["Export button in modal"]
GenerateMarkdown["generateMarkdownExport(record)"]
CreateHeader["Unsupported markdown: heading"]
CreateTable["| 序号 | 正确答案 | 我的答案 | 对错 | 错误分析 |"]
ProcessAnswers["Sort and format answer data"]
FormatRows["Format table rows with alignment"]
CreateBlob["new Blob(markdown, text/markdown)"]
CreateURL["URL.createObjectURL(blob)"]
TriggerDownload["element click download"]
CleanupURL["URL.revokeObjectURL()"]

SingleExport --> GenerateMarkdown
BatchExport --> GenerateMarkdown
FormatRows --> CreateBlob

subgraph subGraph2 ["File Download"]
    CreateBlob
    CreateURL
    TriggerDownload
    CleanupURL
    CreateBlob --> CreateURL
    CreateURL --> TriggerDownload
    TriggerDownload --> CleanupURL
end

subgraph subGraph1 ["Markdown Generation"]
    GenerateMarkdown
    CreateHeader
    CreateTable
    ProcessAnswers
    FormatRows
    GenerateMarkdown --> CreateHeader
    CreateHeader --> CreateTable
    CreateTable --> ProcessAnswers
    ProcessAnswers --> FormatRows
end

subgraph subGraph0 ["Export Triggers"]
    SingleExport
    BatchExport
    DetailModal
    DetailModal --> SingleExport
end
```

Sources: [js/components/practiceHistory.js L1218-L1280](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L1218-L1280)

 [js/components/practiceHistory.js L1285-L1314](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L1285-L1314)

 [js/components/practiceHistory.js L1319-L1355](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js#L1319-L1355)