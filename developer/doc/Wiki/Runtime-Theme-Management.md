# Runtime Theme Management

> **Relevant source files**
> * [.superdesign/design_iterations/xiaodaidai_dashboard_1.html](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/xiaodaidai_dashboard_1.html)
> * [assets/data/vocabulary.json](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/assets/data/vocabulary.json)
> * [js/components/dataManagementPanel.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js)
> * [js/components/settingsPanel.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js)
> * [js/utils/helpers.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/helpers.js)
> * [js/utils/themeManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js)

This document describes the runtime theme management system, which enables dynamic theme switching, automatic theme detection based on system preferences, and accessibility customization. The `ThemeManager` class provides centralized control over visual themes, font sizing, motion preferences, and high contrast modes.

For information about the overall theme architecture and adapter pattern, see [Theme Architecture Overview](/sallowayma-git/IELTS-practice/7.1-theme-architecture-overview). For details on specific theme implementations (Melody, Academic, XiaoDai), see [Theme Variants](/sallowayma-git/IELTS-practice/7.3-theme-variants-(melody-academic-xiaodai)). For theme data access and synchronization, see [ThemeAdapterBase & Data Access](/sallowayma-git/IELTS-practice/7.2-themeadapterbase-and-data-access).

---

## ThemeManager Architecture

The `ThemeManager` class serves as the central controller for runtime theme operations. It manages theme definitions, applies CSS variable changes, detects system preferences, persists user choices, and coordinates with the settings UI.

```mermaid
flowchart TD

TM["ThemeManager"]
ThemeDefs["themes Object<br>{xiaodaidai, light, dark, highContrast}"]
Settings["settings Object<br>{fontSize, reduceMotion, highContrast, autoTheme}"]
Init["init()"]
LoadSettings["loadSettings()"]
SystemDetect["setupSystemThemeDetection()"]
ApplyTheme["applyCurrentTheme()"]
SetTheme["setTheme(themeName)"]
ToggleTheme["toggleTheme()"]
ApplyVars["Apply CSS Variables"]
ApplyClasses["Apply Theme Classes"]
SetFontSize["setFontSize(size)"]
ToggleMotion["toggleReduceMotion()"]
ToggleContrast["toggleHighContrast()"]
ApplyFont["applyFontSize()"]
ApplyMotionSettings["applyMotionSettings()"]
ApplyContrastSettings["applyContrastSettings()"]
SaveSettings["saveSettings()"]
Storage["window.storage"]
ThemeEvent["CustomEvent: themeChanged"]

TM -.-> Init
SetTheme -.-> ApplyTheme
ApplyTheme -.-> ApplyVars
ApplyTheme -.-> ApplyClasses
ApplyTheme -.-> ApplyFont
ApplyTheme -.-> ApplyMotionSettings
ApplyTheme -.-> ApplyContrastSettings
ApplyTheme -.-> ThemeEvent
ToggleContrast -.-> SetTheme
LoadSettings -.-> Storage
SetTheme -.-> SaveSettings

subgraph subGraph4 ["Persistence & Events"]
    SaveSettings
    Storage
    ThemeEvent
    SaveSettings -.-> Storage
end

subgraph Accessibility ["Accessibility"]
    SetFontSize
    ToggleMotion
    ToggleContrast
    ApplyFont
    ApplyMotionSettings
    ApplyContrastSettings
    SetFontSize -.-> ApplyFont
    ToggleMotion -.-> ApplyMotionSettings
end

subgraph subGraph2 ["Theme Operations"]
    SetTheme
    ToggleTheme
    ApplyVars
    ApplyClasses
    ToggleTheme -.-> SetTheme
end

subgraph Initialization ["Initialization"]
    Init
    LoadSettings
    SystemDetect
    ApplyTheme
    Init -.-> LoadSettings
    Init -.-> SystemDetect
    Init -.-> ApplyTheme
end

subgraph subGraph0 ["ThemeManager Core"]
    TM
    ThemeDefs
    Settings
    TM -.-> ThemeDefs
    TM -.-> Settings
end
```

**Sources:** [js/utils/themeManager.js L1-L409](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L1-L409)

---

## Theme Definitions and CSS Variables

Each theme is defined as an object containing a display name and a map of CSS custom properties (variables). The `ThemeManager` maintains four built-in themes with comprehensive variable sets for colors, shadows, backgrounds, and text.

### Theme Registry Structure

| Theme Key | Display Name | Primary Use Case |
| --- | --- | --- |
| `xiaodaidai` | 小呆呆控制台 | Sun Jelly themed interface with warm gradients |
| `light` | 浅色主题 | Standard light mode with blue accents |
| `dark` | 深色主题 | Dark mode with reduced eye strain |
| `highContrast` | 高对比度主题 | Enhanced readability for visual accessibility |

### CSS Variable Categories

Each theme defines variables across these categories:

* **Primary Colors**: `--primary-color`, `--primary-color-light`, `--primary-hover`
* **Semantic Colors**: `--success-color`, `--warning-color`, `--error-color`, `--accent-color`
* **Backgrounds**: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`
* **Text**: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-muted`
* **Effects**: `--border-color`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`

```mermaid
flowchart TD

ThemeObj["themes[themeName]"]
NameProp["name: String"]
VarsProp["variables: Object"]
PrimaryVars["Primary Colors<br>--primary-color<br>--primary-hover"]
SemanticVars["Semantic Colors<br>--success-color<br>--warning-color<br>--error-color"]
BgVars["Backgrounds<br>--bg-primary<br>--bg-secondary<br>--bg-tertiary"]
TextVars["Text Colors<br>--text-primary<br>--text-secondary<br>--text-muted"]
EffectVars["Visual Effects<br>--shadow-sm/md/lg<br>--border-color"]
RootStyle["document.documentElement.style"]

VarsProp -.-> PrimaryVars
VarsProp -.-> SemanticVars
VarsProp -.-> BgVars
VarsProp -.-> TextVars
VarsProp -.-> EffectVars
PrimaryVars -.-> RootStyle
SemanticVars -.-> RootStyle
BgVars -.-> RootStyle
TextVars -.-> RootStyle
EffectVars -.-> RootStyle

subgraph subGraph2 ["Runtime Application"]
    RootStyle
end

subgraph subGraph1 ["CSS Variable Application"]
    PrimaryVars
    SemanticVars
    BgVars
    TextVars
    EffectVars
end

subgraph subGraph0 ["Theme Definition Structure"]
    ThemeObj
    NameProp
    VarsProp
    ThemeObj -.-> NameProp
    ThemeObj -.-> VarsProp
end
```

**Example: XiaoDaiDai Theme Definition**

```css
xiaodaidai: {
    name: '小呆呆控制台',
    variables: {
        '--primary-color': '#ffc83d',
        '--primary-color-light': 'rgba(255, 200, 61, 0.18)',
        '--accent-color': '#a1bfff',
        '--bg-primary': '#f7f9fb',
        '--text-primary': '#1f2937',
        // ... additional variables
    }
}
```

**Sources:** [js/utils/themeManager.js L7-L120](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L7-L120)

---

## Runtime Theme Switching

Theme switching occurs through `setTheme()`, which updates the current theme, applies all CSS variables to the document root, updates body classes, and triggers dependent settings.

### Theme Application Sequence

```mermaid
sequenceDiagram
  participant p1 as User
  participant p2 as SettingsPanel
  participant p3 as ThemeManager
  participant p4 as document.documentElement
  participant p5 as window.storage
  participant p6 as Event System

  p1->>p2: Select theme
  p2->>p3: setTheme(themeName)
  p3->>p3: Validate theme exists
  p3->>p3: Update currentTheme
  p3->>p3: applyCurrentTheme()
  p3->>p4: Get theme.variables
  loop For each CSS variable
    p3->>p4: style.setProperty(property, value)
  end
  p3->>p4: Remove old theme class
  p3->>p4: Add new theme class
  p3->>p3: applyFontSize()
  p3->>p3: applyMotionSettings()
  p3->>p3: applyContrastSettings()
  p3->>p5: saveSettings()
  p5-->>p3: Settings saved
  p3->>p6: Dispatch 'themeChanged' event
  p6-->>p2: Event received
  p3->>p2: showMessage(confirmation)
  p2-->>p1: "已切换到{themeName}"
```

**Sources:** [js/utils/themeManager.js L265-L280](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L265-L280)

 [js/utils/themeManager.js L209-L236](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L209-L236)

### Toggle Mechanism

The `toggleTheme()` method cycles through themes in a predefined order:

```
light → xiaodaidai → dark → highContrast → light
```

This allows keyboard shortcut access (Ctrl+Shift+T) for rapid theme switching during development or user preference exploration.

**Sources:** [js/utils/themeManager.js L282-L291](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L282-L291)

---

## System Theme Detection and Auto-Theme

The `ThemeManager` integrates with browser media queries to detect system-level dark mode preferences and optionally synchronize the application theme automatically.

### Media Query Listeners

```mermaid
flowchart TD

DarkQuery["matchMedia<br>'prefers-color-scheme: dark'"]
MotionQuery["matchMedia<br>'prefers-reduced-motion: reduce'"]
SetupDetection["setupSystemThemeDetection()"]
AutoThemeSetting["settings.autoTheme"]
DarkChangeHandler["darkModeQuery.addEventListener('change')"]
MotionChangeHandler["reduceMotionQuery.addEventListener('change')"]
SetDarkTheme["setTheme('dark')"]
SetLightTheme["setTheme('light')"]
UpdateMotionSetting["settings.reduceMotion = true/false"]
ApplyMotion["applyMotionSettings()"]

DarkQuery -.-> SetupDetection
MotionQuery -.-> SetupDetection
SetupDetection -.-> DarkChangeHandler
SetupDetection -.->|"enabled"| MotionChangeHandler
DarkChangeHandler -.-> AutoThemeSetting
AutoThemeSetting -.-> SetDarkTheme
AutoThemeSetting -.->|"enabled"| SetLightTheme
MotionChangeHandler -.-> UpdateMotionSetting

subgraph Actions ["Actions"]
    SetDarkTheme
    SetLightTheme
    UpdateMotionSetting
    ApplyMotion
    UpdateMotionSetting -.-> ApplyMotion
end

subgraph subGraph2 ["Event Handlers"]
    DarkChangeHandler
    MotionChangeHandler
end

subgraph subGraph1 ["ThemeManager Detection"]
    SetupDetection
    AutoThemeSetting
end

subgraph subGraph0 ["System Preferences"]
    DarkQuery
    MotionQuery
end
```

**Implementation Details:**

1. **Initial Detection**: On initialization, if `settings.autoTheme` is true, the manager checks `prefers-color-scheme` and sets the initial theme accordingly.
2. **Dynamic Updates**: Event listeners respond to system preference changes in real-time, automatically switching themes when the user changes their OS-level settings.
3. **Motion Preference**: The `prefers-reduced-motion` query is always monitored, regardless of `autoTheme`, to ensure accessibility compliance.

**Sources:** [js/utils/themeManager.js L163-L192](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L163-L192)

### Auto-Theme Toggle

Users can enable or disable automatic theme synchronization:

```javascript
toggleAutoTheme() {
    this.settings.autoTheme = !this.settings.autoTheme;
    if (this.settings.autoTheme) {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.setTheme(darkModeQuery.matches ? 'dark' : 'light');
    }
}
```

**Sources:** [js/utils/themeManager.js L349-L365](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L349-L365)

---

## Accessibility Settings

The `ThemeManager` provides three primary accessibility customizations: font sizing, motion reduction, and high contrast mode. Each setting is independently configurable and persisted.

### Font Size Management

| Size Value | CSS Class | Scale Factor | Use Case |
| --- | --- | --- | --- |
| `small` | `font-small` | 0.875rem | Compact displays, high information density |
| `normal` | *(no class)* | 1rem | Default comfortable reading |
| `large` | `font-large` | 1.125rem | Improved readability |
| `extra-large` | `font-extra-large` | 1.25rem | Maximum accessibility |

```python
#mermaid-axw6jrrk6am{font-family:ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica;font-size:16px;fill:#333;}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#mermaid-axw6jrrk6am .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#mermaid-axw6jrrk6am .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#mermaid-axw6jrrk6am .error-icon{fill:#dddddd;}#mermaid-axw6jrrk6am .error-text{fill:#222222;stroke:#222222;}#mermaid-axw6jrrk6am .edge-thickness-normal{stroke-width:1px;}#mermaid-axw6jrrk6am .edge-thickness-thick{stroke-width:3.5px;}#mermaid-axw6jrrk6am .edge-pattern-solid{stroke-dasharray:0;}#mermaid-axw6jrrk6am .edge-thickness-invisible{stroke-width:0;fill:none;}#mermaid-axw6jrrk6am .edge-pattern-dashed{stroke-dasharray:3;}#mermaid-axw6jrrk6am .edge-pattern-dotted{stroke-dasharray:2;}#mermaid-axw6jrrk6am .marker{fill:#999;stroke:#999;}#mermaid-axw6jrrk6am .marker.cross{stroke:#999;}#mermaid-axw6jrrk6am svg{font-family:ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica;font-size:16px;}#mermaid-axw6jrrk6am p{margin:0;}#mermaid-axw6jrrk6am defs #statediagram-barbEnd{fill:#999;stroke:#999;}#mermaid-axw6jrrk6am g.stateGroup text{fill:#dddddd;stroke:none;font-size:10px;}#mermaid-axw6jrrk6am g.stateGroup text{fill:#333;stroke:none;font-size:10px;}#mermaid-axw6jrrk6am g.stateGroup .state-title{font-weight:bolder;fill:#333;}#mermaid-axw6jrrk6am g.stateGroup rect{fill:#ffffff;stroke:#dddddd;}#mermaid-axw6jrrk6am g.stateGroup line{stroke:#999;stroke-width:1;}#mermaid-axw6jrrk6am .transition{stroke:#999;stroke-width:1;fill:none;}#mermaid-axw6jrrk6am .stateGroup .composit{fill:#f4f4f4;border-bottom:1px;}#mermaid-axw6jrrk6am .stateGroup .alt-composit{fill:#e0e0e0;border-bottom:1px;}#mermaid-axw6jrrk6am .state-note{stroke:#e6d280;fill:#fff5ad;}#mermaid-axw6jrrk6am .state-note text{fill:#333;stroke:none;font-size:10px;}#mermaid-axw6jrrk6am .stateLabel .box{stroke:none;stroke-width:0;fill:#ffffff;opacity:0.5;}#mermaid-axw6jrrk6am .edgeLabel .label rect{fill:#ffffff;opacity:0.5;}#mermaid-axw6jrrk6am .edgeLabel{background-color:#ffffff;text-align:center;}#mermaid-axw6jrrk6am .edgeLabel p{background-color:#ffffff;}#mermaid-axw6jrrk6am .edgeLabel rect{opacity:0.5;background-color:#ffffff;fill:#ffffff;}#mermaid-axw6jrrk6am .edgeLabel .label text{fill:#333;}#mermaid-axw6jrrk6am .label div .edgeLabel{color:#333;}#mermaid-axw6jrrk6am .stateLabel text{fill:#333;font-size:10px;font-weight:bold;}#mermaid-axw6jrrk6am .node circle.state-start{fill:#999;stroke:#999;}#mermaid-axw6jrrk6am .node .fork-join{fill:#999;stroke:#999;}#mermaid-axw6jrrk6am .node circle.state-end{fill:#dddddd;stroke:#f4f4f4;stroke-width:1.5;}#mermaid-axw6jrrk6am .end-state-inner{fill:#f4f4f4;stroke-width:1.5;}#mermaid-axw6jrrk6am .node rect{fill:#ffffff;stroke:#dddddd;stroke-width:1px;}#mermaid-axw6jrrk6am .node polygon{fill:#ffffff;stroke:#dddddd;stroke-width:1px;}#mermaid-axw6jrrk6am #statediagram-barbEnd{fill:#999;}#mermaid-axw6jrrk6am .statediagram-cluster rect{fill:#ffffff;stroke:#dddddd;stroke-width:1px;}#mermaid-axw6jrrk6am .cluster-label,#mermaid-axw6jrrk6am .nodeLabel{color:#333;}#mermaid-axw6jrrk6am .statediagram-cluster rect.outer{rx:5px;ry:5px;}#mermaid-axw6jrrk6am .statediagram-state .divider{stroke:#dddddd;}#mermaid-axw6jrrk6am .statediagram-state .title-state{rx:5px;ry:5px;}#mermaid-axw6jrrk6am .statediagram-cluster.statediagram-cluster .inner{fill:#f4f4f4;}#mermaid-axw6jrrk6am .statediagram-cluster.statediagram-cluster-alt .inner{fill:#f8f8f8;}#mermaid-axw6jrrk6am .statediagram-cluster .inner{rx:0;ry:0;}#mermaid-axw6jrrk6am .statediagram-state rect.basic{rx:5px;ry:5px;}#mermaid-axw6jrrk6am .statediagram-state rect.divider{stroke-dasharray:10,10;fill:#f8f8f8;}#mermaid-axw6jrrk6am .note-edge{stroke-dasharray:5;}#mermaid-axw6jrrk6am .statediagram-note rect{fill:#fff5ad;stroke:#e6d280;stroke-width:1px;rx:0;ry:0;}#mermaid-axw6jrrk6am .statediagram-note rect{fill:#fff5ad;stroke:#e6d280;stroke-width:1px;rx:0;ry:0;}#mermaid-axw6jrrk6am .statediagram-note text{fill:#333;}#mermaid-axw6jrrk6am .statediagram-note .nodeLabel{color:#333;}#mermaid-axw6jrrk6am .statediagram .edgeLabel{color:red;}#mermaid-axw6jrrk6am #dependencyStart,#mermaid-axw6jrrk6am #dependencyEnd{fill:#999;stroke:#999;stroke-width:1;}#mermaid-axw6jrrk6am .statediagramTitleText{text-anchor:middle;font-size:18px;fill:#333;}#mermaid-axw6jrrk6am :root{--mermaid-font-family:"trebuchet ms",verdana,arial,sans-serif;}setFontSize('small')setFontSize('large')setFontSize('extra-large')setFontSize('normal')setFontSize('normal')setFontSize('normal')setFontSize('large')setFontSize('extra-large')setFontSize('small')setFontSize('extra-large')setFontSize('small')setFontSize('large')NormalNo CSS class appliedSmallbody.font-smallLargebody.font-largeExtraLargebody.font-extra-large
```

**Implementation:**

The `applyFontSize()` method removes all font size classes and conditionally adds the appropriate class based on `settings.fontSize`.

**Sources:** [js/utils/themeManager.js L240-L248](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L240-L248)

 [js/utils/themeManager.js L294-L316](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L294-L316)

### Motion Reduction

When enabled, the `reduce-motion` class is applied to the body element, which CSS can use to disable or simplify animations:

```
applyMotionSettings() {
    document.body.classList.toggle('reduce-motion', this.settings.reduceMotion);
}
```

This respects both manual user preference and system-level `prefers-reduced-motion` settings. The system preference automatically updates `settings.reduceMotion` when detected.

**Sources:** [js/utils/themeManager.js L250-L254](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L250-L254)

 [js/utils/themeManager.js L318-L330](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L318-L330)

### High Contrast Mode

High contrast mode is implemented as a specialized theme switch. When toggled on:

1. The current theme is saved to `previous_theme` storage key
2. Theme switches to `highContrast`
3. The `high-contrast` CSS class is applied

When toggled off, the system restores the previous theme.

```mermaid
flowchart TD

LoadPrevious["storage.get('previous_theme')"]
RestoreTheme["setTheme(previousTheme)"]
CurrentTheme["Current Theme<br>(e.g., 'xiaodaidai')"]
SavePrevious["storage.set('previous_theme')"]
SwitchToHC["setTheme('highContrast')"]
HCClass["body.high-contrast"]
HCThemeVars["High Contrast CSS Variables<br>--primary-color: #0066cc<br>--border-color: #000000<br>--text-primary: #000000"]

SwitchToHC -.-> HCClass
SwitchToHC -.-> HCThemeVars

subgraph subGraph2 ["CSS Effects"]
    HCClass
    HCThemeVars
end

subgraph subGraph0 ["Enable High Contrast"]
    CurrentTheme
    SavePrevious
    SwitchToHC
    CurrentTheme -.-> SavePrevious
    SavePrevious -.-> SwitchToHC
end

subgraph subGraph1 ["Disable High Contrast"]
    LoadPrevious
    RestoreTheme
    LoadPrevious -.-> RestoreTheme
end
```

**Sources:** [js/utils/themeManager.js L332-L347](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L332-L347)

 [js/utils/themeManager.js L256-L262](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L256-L262)

---

## Settings Persistence

All theme and accessibility settings are persisted to storage using the `window.storage` API. This ensures user preferences survive page reloads and browser sessions.

### Storage Keys

| Key | Value Type | Contents |
| --- | --- | --- |
| `theme_settings` | Object | `{fontSize, reduceMotion, highContrast, autoTheme}` |
| `current_theme` | String | Active theme key (e.g., 'xiaodaidai') |
| `previous_theme` | String | Theme before high contrast activation |

### Load and Save Flow

```mermaid
sequenceDiagram
  participant p1 as init()
  participant p2 as loadSettings()
  participant p3 as window.storage
  participant p4 as ThemeManager State
  participant p5 as saveSettings()

  note over p1,p3: Initialization
  p1->>p2: Load persisted settings
  p2->>p3: get('theme_settings')
  p3-->>p2: {fontSize, reduceMotion, ...}
  p2->>p3: get('current_theme')
  p3-->>p2: 'xiaodaidai'
  p2->>p4: Merge into this.settings
  p2->>p4: Set this.currentTheme
  note over p4,p5: User Makes Change
  p4->>p4: User calls setTheme()
  p4->>p5: saveSettings()
  p5->>p3: set('theme_settings', settings)
  p5->>p3: set('current_theme', currentTheme)
  p3-->>p5: Persisted
```

**Sources:** [js/utils/themeManager.js L142-L149](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L142-L149)

 [js/utils/themeManager.js L151-L159](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L151-L159)

 [js/utils/themeManager.js L133-L138](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L133-L138)

---

## Integration with Settings UI

The `SettingsPanel` component provides the user interface for theme management. It uses event delegation to handle theme-related controls and communicates with the `ThemeManager` instance.

### Settings Panel Controls

```mermaid
flowchart TD

ThemeSelect["#theme-select<br>dropdown"]
AutoThemeToggle["#auto-theme-toggle<br>checkbox"]
FontSizeSelect["#font-size-select<br>dropdown"]
HighContrastToggle["#high-contrast-toggle<br>checkbox"]
ReduceMotionToggle["#reduce-motion-toggle<br>checkbox"]
ChangeHandler["DOM.delegate('change', ...)"]
SetThemeMethod["themeManager.setTheme()"]
ToggleAutoMethod["themeManager.toggleAutoTheme()"]
SetFontMethod["themeManager.setFontSize()"]
ToggleContrastMethod["themeManager.toggleHighContrast()"]
ToggleMotionMethod["themeManager.toggleReduceMotion()"]

ThemeSelect -.->|"auto-theme-toggle"| ChangeHandler
AutoThemeToggle -.->|"font-size-select"| ChangeHandler
FontSizeSelect -.->|"high-contrast-toggle"| ChangeHandler
HighContrastToggle -.-> ChangeHandler
ReduceMotionToggle -.->|"reduce-motion-toggle"| ChangeHandler
ChangeHandler -.->|"theme-select"| SetThemeMethod
ChangeHandler -.-> ToggleAutoMethod
ChangeHandler -.-> SetFontMethod
ChangeHandler -.-> ToggleContrastMethod
ChangeHandler -.-> ToggleMotionMethod

subgraph subGraph2 ["ThemeManager API"]
    SetThemeMethod
    ToggleAutoMethod
    SetFontMethod
    ToggleContrastMethod
    ToggleMotionMethod
end

subgraph subGraph1 ["Event Delegation"]
    ChangeHandler
end

subgraph subGraph0 ["SettingsPanel UI"]
    ThemeSelect
    AutoThemeToggle
    FontSizeSelect
    HighContrastToggle
    ReduceMotionToggle
end
```

**UI Construction:**

The settings panel builds theme controls using the `DOMBuilder` utility or fallback methods:

* **Appearance Tab**: Theme selector, auto-theme checkbox, font size selector
* **Accessibility Tab**: High contrast toggle, reduce motion toggle, keyboard navigation options

The panel reads initial values from `ThemeManager.getCurrentTheme()` and `ThemeManager.settings` to populate control states.

**Sources:** [js/components/settingsPanel.js L148-L169](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L148-L169)

 [js/components/settingsPanel.js L385-L422](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L385-L422)

 [js/components/settingsPanel.js L424-L448](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L424-L448)

---

## Theme Lifecycle and Events

The theme system follows a well-defined lifecycle from initialization through user interaction to persistence.

### Initialization Lifecycle

```mermaid
sequenceDiagram
  participant p1 as new ThemeManager()
  participant p2 as init()
  participant p3 as loadSettings()
  participant p4 as setupSystemThemeDetection()
  participant p5 as applyCurrentTheme()
  participant p6 as setupEventListeners()

  p1->>p2: Async initialize
  p2->>p3: Load persisted settings
  p3->>p3: Merge with defaults
  p2->>p4: Setup media queries
  p4->>p4: Create dark mode listener
  p4->>p4: Create reduced motion listener
  p4->>p4: Set initial autoTheme state
  p2->>p5: Apply loaded theme
  p5->>p5: Set CSS variables
  p5->>p5: Apply body classes
  p5->>p5: Apply font size
  p5->>p5: Apply motion settings
  p5->>p5: Apply contrast settings
  p2->>p6: Setup keyboard shortcuts
  p6->>p6: Ctrl+Shift+T for toggle
```

**Sources:** [js/utils/themeManager.js L130-L138](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L130-L138)

### Theme Change Event

When a theme changes, the `ThemeManager` dispatches a `themeChanged` custom event that other components can observe:

```
document.dispatchEvent(new CustomEvent('themeChanged', {
    detail: { theme: this.currentTheme, settings: this.settings }
}));
```

This enables reactive updates across the application, such as:

* Chart color scheme updates
* Syntax highlighting theme changes
* Third-party component restyling

**Sources:** [js/utils/themeManager.js L232-L235](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L232-L235)

### Reset to Defaults

The `resetToDefaults()` method restores all settings to initial values:

```yaml
this.currentTheme = 'light';
this.settings = {
    fontSize: 'normal',
    reduceMotion: false,
    highContrast: false,
    autoTheme: true
};
```

**Sources:** [js/utils/themeManager.js L391-L407](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L391-L407)

---

## Keyboard Shortcuts

The `ThemeManager` registers global keyboard shortcuts for quick access:

| Shortcut | Action | Method |
| --- | --- | --- |
| Ctrl+Shift+T | Cycle through themes | `toggleTheme()` |

Additional shortcuts may be handled by the `SettingsPanel` or other UI components:

| Shortcut | Action | Component |
| --- | --- | --- |
| Ctrl+Shift+S | Open settings panel | `SettingsPanel` |

**Sources:** [js/utils/themeManager.js L197-L205](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L197-L205)

 [js/components/settingsPanel.js L138-L147](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L138-L147)

---

## Theme-Specific Styling (HTML Integration)

Theme variants can define additional styling through HTML files. For example, `xiaodaidai_dashboard_1.html` includes extensive theme-specific CSS for the XiaoDaiDai theme, including high contrast overrides.

### High Contrast Theme CSS Variables

The high contrast theme uses strongly differentiated colors:

```css
:root[data-theme="highContrast"] {
    --bg-base: #1d0001;
    --surface-1: rgba(255, 236, 213, 0.95);
    --accent: #b00105;
    --accent-secondary: #f3f918;
    --text-strong: #2c0204;
}
```

The HTML file also includes specialized gradients, shadows, and component styling that activate when `data-theme="highContrast"` is set on the root element.

**Sources:** [.superdesign/design_iterations/xiaodaidai_dashboard_1.html L1059-L1074](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/xiaodaidai_dashboard_1.html#L1059-L1074)

 [.superdesign/design_iterations/xiaodaidai_dashboard_1.html L1076-L1087](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/xiaodaidai_dashboard_1.html#L1076-L1087)

---

## Message Feedback System

Theme operations provide user feedback through the `window.showMessage()` utility, which displays temporary notifications:

* Theme switch: "已切换到{themeName}"
* Font size change: "字体大小已设置为{size}"
* Motion setting: "已启用/禁用减少动画"
* Auto-theme: "已启用/禁用自动主题"

These messages appear briefly and auto-dismiss, providing non-intrusive confirmation of user actions.

**Sources:** [js/utils/themeManager.js L277-L279](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L277-L279)

 [js/utils/themeManager.js L308-L315](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L308-L315)

 [js/utils/themeManager.js L324-L329](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L324-L329)

 [js/utils/themeManager.js L361-L364](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L361-L364)