# Theme System & Visual Design

> **Relevant source files**
> * [.superdesign/design_iterations/HarryPoter.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/HarryPoter.html)
> * [.superdesign/design_iterations/ielts_academic_functional_2.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/ielts_academic_functional_2.html)
> * [.superdesign/design_iterations/my_melody_ielts_1.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/my_melody_ielts_1.html)
> * [developer/docs/2025-10-12-hp-view-capture.md](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/docs/2025-10-12-hp-view-capture.md)
> * [js/components/practiceHistory.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js)
> * [js/components/practiceRecordModal.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceRecordModal.js)
> * [js/components/settingsPanel.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/settingsPanel.js)
> * [js/plugins/hp/hp-path.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/plugins/hp/hp-path.js)
> * [js/theme-switcher.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/theme-switcher.js)
> * [js/utils/themeManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/utils/themeManager.js)

This document covers the theming architecture, design tokens, and multiple theme variations of the IELTS practice system. The theme system provides a flexible foundation for different visual experiences through CSS custom properties, theme switching logic, and specialized theme implementations including My Melody, Academic, and Harry Potter variations.

For information about the core application architecture, see page 3. For details about the Harry Potter theme's plugin system, see page 8.

## Design Token System Architecture

The theme system is built around a comprehensive design token system using CSS custom properties. The main framework in [css/main.css L1-L1300](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/css/main.css#L1-L1300)

 establishes the foundational design tokens, while specialized themes extend and override these tokens for specific visual experiences.

**Theme System Architecture**

```mermaid
flowchart TD

ThemeSwitcher["js/theme-switcher.js"]
ThemeApplication["applyTheme() function"]
ThemeStorage["localStorage theme storage"]
ThemeModal["Theme selection modal"]
MainCSS["css/main.css"]
ColorSystem["Color System<br>--color-brand-primary<br>--color-success<br>--color-error"]
SpacingSystem["Spacing System<br>--space-xs to --space-2xl<br>4px base grid"]
TypographySystem["Typography System<br>--font-size-xs to --font-size-5xl<br>--font-weight-*"]
LayoutSystem["Layout System<br>--border-radius---shadow-<br>--transition-*"]
MyMelodyTheme["My Melody Theme<br>my_melody_ielts_1.html"]
AcademicTheme["Academic Theme<br>ielts_academic_functional_2.html"]
HPTheme["Harry Potter Theme<br>HP/ directory themes"]

ColorSystem --> MyMelodyTheme
SpacingSystem --> AcademicTheme
TypographySystem --> HPTheme

subgraph subGraph1 ["Theme Variations"]
    MyMelodyTheme
    AcademicTheme
    HPTheme
end

subgraph subGraph0 ["Core Design Tokens"]
    MainCSS
    ColorSystem
    SpacingSystem
    TypographySystem
    LayoutSystem
    MainCSS --> ColorSystem
    MainCSS --> SpacingSystem
    MainCSS --> TypographySystem
    MainCSS --> LayoutSystem
end

subgraph subGraph2 ["Theme Switching"]
    ThemeSwitcher
    ThemeApplication
    ThemeStorage
    ThemeModal
    ThemeSwitcher --> ThemeApplication
    ThemeStorage --> ThemeApplication
    ThemeModal --> ThemeSwitcher
end
```

Sources: [css/main.css L8-L90](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/css/main.css#L8-L90)

 [.superdesign/design_iterations/my_melody_ielts_1.html L22-L93](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/my_melody_ielts_1.html#L22-L93)

 [.superdesign/design_iterations/ielts_academic_functional_2.html L15-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/ielts_academic_functional_2.html#L15-L100)

## CSS Custom Properties and Design Tokens

The system uses a layered approach to design tokens, with a core set defined in `css/main.css` and theme-specific overrides in specialized theme files.

### Core Design Token Categories

| Category | Variables | Purpose | Example Values |
| --- | --- | --- | --- |
| Color System | `--color-brand-primary`, `--color-brand-secondary` | Brand identity and interactive elements | `#667eea`, `#764ba2` |
| Semantic Colors | `--color-success`, `--color-warning`, `--color-error` | Status indication and feedback | `#10b981`, `#f59e0b`, `#ef4444` |
| Spacing System | `--space-xs` through `--space-2xl` | 4px-based consistent spacing | `0.25rem` to `3rem` |
| Typography Scale | `--font-size-xs` through `--font-size-5xl` | Modular text sizing | `0.75rem` to `3rem` |
| Border System | `--border-radius-sm` through `--border-radius-2xl` | Consistent corner rounding | `0.25rem` to `1rem` |
| Shadow System | `--shadow-sm` through `--shadow-xl` | Depth and elevation | Multiple box-shadow values |

### Theme Variable Override System

**Design Token Override Flow**

```mermaid
flowchart TD

CoreTokens["Core Design Tokens<br>css/main.css :root"]
ColorBase["--color-brand-primary: #667eea"]
SpacingBase["--space-md: 1rem"]
FontBase["--font-size-base: 1rem"]
ThemeOverride["Theme-specific :root overrides"]
MyMelodyOverride["My Melody:<br>--my-melody-pink: #FFB6E1<br>--my-melody-blue: #87CEEB"]
AcademicOverride["Academic:<br>--color-primary: #1e3a8a<br>--color-parchment: #f8f6f0"]
ComponentStyles["Component CSS classes"]
CardStyle[".category-card background:<br>var(--color-brand-primary)"]
HeaderStyle[".header background:<br>var(--my-melody-pink)"]

ColorBase --> CardStyle
MyMelodyOverride --> HeaderStyle
AcademicOverride --> CardStyle

subgraph subGraph2 ["Component Application"]
    ComponentStyles
    CardStyle
    HeaderStyle
end

subgraph subGraph1 ["Theme Layer"]
    ThemeOverride
    MyMelodyOverride
    AcademicOverride
    ThemeOverride --> MyMelodyOverride
    ThemeOverride --> AcademicOverride
end

subgraph subGraph0 ["Base Layer"]
    CoreTokens
    ColorBase
    SpacingBase
    FontBase
    CoreTokens --> ColorBase
    CoreTokens --> SpacingBase
    CoreTokens --> FontBase
end
```

Sources: [css/main.css L9-L90](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/css/main.css#L9-L90)

 [.superdesign/design_iterations/my_melody_ielts_1.html L24-L93](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/my_melody_ielts_1.html#L24-L93)

 [.superdesign/design_iterations/ielts_academic_functional_2.html L16-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/ielts_academic_functional_2.html#L16-L100)

## Theme Variations and Implementation

The system includes three distinct theme implementations, each with unique design approaches and specialized features.

### My Melody Theme

The My Melody theme in [.superdesign/design_iterations/my_melody_ielts_1.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/my_melody_ielts_1.html)

 features a kawaii-inspired design with animated elements and extensive use of pink/blue/purple color palettes.

**My Melody Theme Characteristics**

```mermaid
flowchart TD

PinkColors["--my-melody-pink: #FFB6E1<br>--my-melody-blue: #87CEEB<br>--my-melody-purple: #DDA0DD"]
SupportColors["--my-melody-mint: #98FB98<br>--my-melody-lavender: #E6E6FA<br>--my-melody-yellow: #FFF8DC"]
GradientBG["--gradient-bg: 5-color gradient<br>Animated rainbowFlow"]
ParticleSystem[".particles system<br>Floating emoji animations"]
GlassEffects["backdrop-filter: blur(15px)<br>Glass morphism cards"]
HoverEffects["Transform animations<br>translateY(-5px) scale(1.05)"]
BowtieCheckbox[".bowtie-checkbox system<br>Custom checkbox styling"]
MelodyButtons[".melody-btn variants<br>Primary/Success/Danger"]
DarkModeVars["body.dark-mode overrides<br>Adjusted color saturation"]
DarkGradient["Dark gradient backgrounds<br>Muted color schemes"]

PinkColors --> GlassEffects
SupportColors --> ParticleSystem
GradientBG --> HoverEffects
GlassEffects --> BowtieCheckbox
ParticleSystem --> MelodyButtons
HoverEffects --> DarkModeVars

subgraph subGraph3 ["Dark Mode Support"]
    DarkModeVars
    DarkGradient
    DarkModeVars --> DarkGradient
end

subgraph subGraph2 ["Interactive Elements"]
    HoverEffects
    BowtieCheckbox
    MelodyButtons
end

subgraph subGraph1 ["Visual Effects"]
    GradientBG
    ParticleSystem
    GlassEffects
end

subgraph subGraph0 ["Color Palette"]
    PinkColors
    SupportColors
end
```

### Academic Theme

The Academic theme in [.superdesign/design_iterations/ielts_academic_functional_2.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/ielts_academic_functional_2.html)

 provides a professional, scholarly appearance with serif typography and neutral color schemes.

**Academic Theme Design System**

```mermaid
flowchart TD

PrimaryBlue["--color-primary: #1e3a8a<br>--color-primary-light: #2563eb<br>--color-secondary: #3b82f6"]
NeutralColors["--color-gray-50 to --color-gray-900<br>Comprehensive neutral scale"]
SemanticColors["--color-parchment: #f8f6f0<br>--color-ink: #2d3748"]
SerifFont["font-family: 'Georgia', serif<br>Primary headings"]
SansSerifFont["font-family: 'Source Sans Pro'<br>UI elements and body text"]
TypeScale["--font-size-xs: 0.75rem to<br>--font-size-5xl: 3rem"]
SidebarNav[".sidebar navigation<br>280px fixed width"]
MainContent[".main-content flex layout<br>Professional grid systems"]
FourPointGrid["4px base grid system<br>--space-1 to --space-10"]
AcademicCards[".category-card professional style<br>Subtle shadows and borders"]
StatCards[".stat-card academic appearance<br>Clean typography hierarchy"]
ButtonSystem[".btn academic styling<br>Professional color scheme"]

PrimaryBlue --> AcademicCards
NeutralColors --> StatCards
SerifFont --> SidebarNav
SansSerifFont --> MainContent
TypeScale --> ButtonSystem
FourPointGrid --> AcademicCards

subgraph subGraph3 ["Component Styling"]
    AcademicCards
    StatCards
    ButtonSystem
end

subgraph subGraph2 ["Layout Structure"]
    SidebarNav
    MainContent
    FourPointGrid
end

subgraph subGraph1 ["Typography System"]
    SerifFont
    SansSerifFont
    TypeScale
end

subgraph subGraph0 ["Academic Color Palette"]
    PrimaryBlue
    NeutralColors
    SemanticColors
end
```

Sources: [.superdesign/design_iterations/my_melody_ielts_1.html L24-L57](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/my_melody_ielts_1.html#L24-L57)

 [.superdesign/design_iterations/my_melody_ielts_1.html L594-L932](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/my_melody_ielts_1.html#L594-L932)

 [.superdesign/design_iterations/ielts_academic_functional_2.html L16-L100](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/ielts_academic_functional_2.html#L16-L100)

 [.superdesign/design_iterations/ielts_academic_functional_2.html L108-L204](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.superdesign/design_iterations/ielts_academic_functional_2.html#L108-L204)

## Theme Switching System

The theme switching functionality is implemented in [js/theme-switcher.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/theme-switcher.js)

 and provides dynamic theme changes with persistent storage.

### Theme Switching Architecture

**Theme Switching Flow**

```mermaid
flowchart TD

LocalStorage["localStorage 'theme' key"]
BloomMode["localStorage 'bloom-theme-mode'"]
BlueMode["localStorage 'blue-theme-mode'"]
ApplyTheme["applyTheme(theme)<br>Sets data-theme attribute"]
ApplyDefault["applyDefaultTheme()<br>Removes theme overrides"]
ToggleBloom["toggleBloomDarkMode()<br>Bloom theme dark/light"]
ToggleBlue["toggleBlueDarkMode()<br>Blue theme dark/light"]
ThemeModal["Theme selection modal<br>#theme-switcher-modal"]
BloomButton["#bloom-theme-btn<br>Dynamic text and onclick"]
BlueButton["#blue-theme-btn<br>Theme-aware behavior"]
DataThemeAttr["document.documentElement<br>data-theme attribute"]
BodyClasses["document.body classList<br>theme-specific classes"]
ButtonUpdates["updateBloomThemeButton()<br>updateBlueThemeButton()"]

LocalStorage --> ApplyTheme
BloomMode --> ToggleBloom
BlueMode --> ToggleBlue
ApplyTheme --> DataThemeAttr
ApplyDefault --> BodyClasses
ToggleBloom --> ButtonUpdates
ThemeModal --> ApplyTheme
BloomButton --> ToggleBloom
BlueButton --> ToggleBlue

subgraph subGraph3 ["DOM Updates"]
    DataThemeAttr
    BodyClasses
    ButtonUpdates
    DataThemeAttr --> BodyClasses
    BodyClasses --> ButtonUpdates
end

subgraph subGraph2 ["UI Components"]
    ThemeModal
    BloomButton
    BlueButton
end

subgraph subGraph1 ["Theme Application Functions"]
    ApplyTheme
    ApplyDefault
    ToggleBloom
    ToggleBlue
end

subgraph subGraph0 ["Theme Storage"]
    LocalStorage
    BloomMode
    BlueMode
end
```

### Theme Modal Implementation

The theme switching modal provides a centralized interface for theme selection with the following key functions:

| Function | Purpose | Implementation |
| --- | --- | --- |
| `showThemeSwitcherModal()` | Display theme selection interface | Adds `.show` class to modal |
| `hideThemeSwitcherModal()` | Close theme selection interface | Removes `.show` class |
| `applyTheme(theme)` | Apply specific theme | Sets `data-theme` attribute and updates storage |
| `applyDefaultTheme()` | Reset to default theme | Removes theme attributes and restores Bloom settings |

### Dark Mode Support

Each theme variation supports its own dark mode implementation:

* **Bloom Theme**: Uses `bloom-dark-mode` class with independent light/dark toggle
* **Blue Theme**: Uses `blue-dark-mode` class with theme-specific dark variations
* **Theme Storage**: Separate localStorage keys maintain dark mode preferences per theme

Sources: [js/theme-switcher.js L2-L37](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/theme-switcher.js#L2-L37)

 [js/theme-switcher.js L54-L135](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/theme-switcher.js#L54-L135)

 [js/theme-switcher.js L137-L182](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/theme-switcher.js#L137-L182)

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

Sources: [js/components/practiceHistory.js L5-L33](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L5-L33)

 [js/components/practiceHistory.js L99-L241](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L99-L241)

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

Sources: [js/components/practiceHistory.js L244-L302](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L244-L302)

 [js/components/practiceHistory.js L355-L411](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L355-L411)

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

Sources: [js/components/practiceHistory.js L717-L832](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L717-L832)

 [js/components/practiceHistory.js L836-L931](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L836-L931)

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

Sources: [js/components/practiceHistory.js L1218-L1280](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L1218-L1280)

 [js/components/practiceHistory.js L1285-L1314](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L1285-L1314)

 [js/components/practiceHistory.js L1319-L1355](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/js/components/practiceHistory.js#L1319-L1355)