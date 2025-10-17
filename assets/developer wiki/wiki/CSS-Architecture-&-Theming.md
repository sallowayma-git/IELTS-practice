# CSS Architecture & Theming

> **Relevant source files**
> * [css/styles.css](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css)
> * [js/components/practiceHistory.js](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/js/components/practiceHistory.js)

This document covers the comprehensive CSS architecture and theming system used throughout the IELTS Reading Practice System. The CSS framework provides consistent styling, responsive design, theme switching, and accessibility features across all components.

For information about the practice history component's specific styling implementation, see [Practice History Component](/sallowayma-git/IELTS-practice/4.2-practice-history-component). For details about the overall UI structure and presentation layer, see [User Interface & Styling](/sallowayma-git/IELTS-practice/4-user-interface-and-styling).

## CSS Variable System

The foundation of the theming system is built on CSS custom properties (CSS variables) that provide consistent colors, spacing, typography, and other design tokens across the entire application.

### Design Token Architecture

```mermaid
flowchart TD

Colors["--primary-color<br>--secondary-color<br>--success-color<br>--warning-color<br>--error-color"]
Backgrounds["--bg-primary<br>--bg-secondary<br>--bg-tertiary"]
Text["--text-primary<br>--text-secondary<br>--text-tertiary<br>--text-muted"]
Spacing["--spacing-xs<br>--spacing-sm<br>--spacing-md<br>--spacing-lg<br>--spacing-xl"]
Typography["--font-size-xs<br>--font-size-sm<br>--font-size-base<br>--font-size-lg<br>--font-size-xl"]
Effects["--shadow-sm<br>--shadow-md<br>--shadow-lg<br>--border-radius<br>--border-color"]
ComponentStyles[".btn<br>.card<br>.modal<br>.nav-btn"]
ResponsiveOverrides["@media queries<br>Variable redefinition"]
ThemeOverrides[".theme-dark<br>.high-contrast<br>Accessibility modes"]

Colors --> ComponentStyles
Backgrounds --> ComponentStyles
Text --> ComponentStyles
Spacing --> ComponentStyles
Typography --> ComponentStyles
Effects --> ComponentStyles

subgraph subGraph1 ["Component Usage"]
    ComponentStyles
    ResponsiveOverrides
    ThemeOverrides
    ComponentStyles --> ResponsiveOverrides
    ComponentStyles --> ThemeOverrides
end

subgraph subGraph0 ["CSS Variables Root"]
    Colors
    Backgrounds
    Text
    Spacing
    Typography
    Effects
end
```

Sources: [css/styles.css L2-L49](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L2-L49)

The CSS variable system is defined in the `:root` selector and provides semantic color meanings, consistent spacing scales, and typography hierarchies. Variables use descriptive names that indicate their semantic purpose rather than their visual appearance.

### Color System

The color palette follows semantic naming conventions:

| Variable | Purpose | Light Theme | Dark Theme Override |
| --- | --- | --- | --- |
| `--primary-color` | Primary actions, links | #3b82f6 | Unchanged |
| `--bg-primary` | Main background | #ffffff | #1f2937 |
| `--text-primary` | Main text | #1f2937 | #f9fafb |
| `--success-color` | Success states | #10b981 | Unchanged |
| `--error-color` | Error states | #ef4444 | Unchanged |

Sources: [css/styles.css L3-L24](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L3-L24)

 [css/styles.css L672-L682](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L672-L682)

## Component Architecture

The CSS architecture follows a component-based approach where each UI element has dedicated styles that leverage the CSS variable system.

### Component Hierarchy

```mermaid
flowchart TD

BtnPrimary[".btn.btn-primary<br>Primary actions"]
BtnSecondary[".btn.btn-secondary<br>Secondary actions"]
Modal[".modal<br>Dialog overlays"]
Notification[".notification<br>Toast messages"]
MainHeader[".main-header<br>Sticky navigation bar"]
Container[".container<br>Content wrapper"]
MainContent[".main-content<br>View container"]
MainNav[".main-nav<br>Navigation container"]
NavBtn[".nav-btn<br>Navigation buttons"]
Logo[".logo<br>Application branding"]
StatsOverview[".stats-overview<br>Statistics grid"]
CategoryGrid[".category-grid<br>Category layout"]
CategoryCard[".category-card<br>Individual category"]
HistoryList[".history-list<br>Practice records"]

MainHeader --> MainNav
MainContent --> StatsOverview
MainContent --> CategoryGrid
MainContent --> HistoryList

subgraph subGraph2 ["Content Components"]
    StatsOverview
    CategoryGrid
    CategoryCard
    HistoryList
    CategoryGrid --> CategoryCard
end

subgraph subGraph1 ["Navigation Components"]
    MainNav
    NavBtn
    Logo
    MainNav --> NavBtn
    MainNav --> Logo
end

subgraph subGraph0 ["Layout Components"]
    MainHeader
    Container
    MainContent
    Container --> MainContent
end

subgraph subGraph3 ["Interactive Components"]
    BtnPrimary
    BtnSecondary
    Modal
    Notification
end
```

Sources: [css/styles.css L71-L140](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L71-L140)

 [css/styles.css L241-L287](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L241-L287)

### Button System

The button system provides consistent styling across different button types:

```mermaid
flowchart TD

BaseBtn[".btn<br>Base button styles<br>padding, border, transition"]
BtnPrimary[".btn-primary<br>Primary actions<br>--primary-color background"]
BtnSecondary[".btn-secondary<br>Secondary actions<br>--bg-primary background"]
BtnOutline[".btn-outline<br>Outlined buttons<br>Border with no fill"]
BtnBack[".btn-back<br>Navigation buttons<br>Secondary styling"]
PrimaryHover[":hover state<br>--primary-hover"]
SecondaryHover[":hover state<br>--bg-tertiary"]

BaseBtn --> BtnPrimary
BaseBtn --> BtnSecondary
BaseBtn --> BtnOutline
BaseBtn --> BtnBack
BtnPrimary --> PrimaryHover
BtnSecondary --> SecondaryHover
```

Sources: [css/styles.css L241-L287](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L241-L287)

## Responsive Design System

The responsive design system uses a mobile-first approach with progressive enhancement through media queries targeting specific device categories and capabilities.

### Breakpoint Strategy

```mermaid
flowchart TD

Mobile["Mobile First<br>Default styles<br>≥ 320px"]
Tablet["@media (max-width: 768px)<br>Mobile adjustments<br>Layout simplification"]
LargeTablet["@media (max-width: 1024px)<br>Tablet optimizations<br>Grid adjustments"]
Desktop["@media (min-width: 1025px)<br>Desktop enhancements<br>Full grid layouts"]
Touch["@media (hover: none)<br>Touch device optimization<br>Larger tap targets"]
Landscape["@media (orientation: landscape)<br>Landscape mode<br>Layout adjustments"]
SmallScreen["@media (max-width: 480px)<br>Small screens<br>Single column layouts"]

Mobile --> Tablet
Mobile --> LargeTablet
Mobile --> Desktop
Mobile --> Touch
Mobile --> Landscape
Mobile --> SmallScreen

subgraph subGraph2 ["Special Conditions"]
    Touch
    Landscape
    SmallScreen
end

subgraph subGraph1 ["Progressive Enhancement"]
    Tablet
    LargeTablet
    Desktop
end

subgraph subGraph0 ["Base Styles"]
    Mobile
end
```

Sources: [css/styles.css L374-L638](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L374-L638)

### Grid System Responsive Behavior

The grid layouts adapt based on screen size:

| Screen Size | Category Grid | Stats Overview | Navigation |
| --- | --- | --- | --- |
| Desktop (>1024px) | `repeat(auto-fit, minmax(320px, 1fr))` | 4 columns | Horizontal |
| Tablet (768-1024px) | `repeat(2, 1fr)` | 4 columns | Horizontal |
| Mobile (≤768px) | `1fr` | 2 columns | Vertical stack |
| Small Mobile (≤480px) | `1fr` | 1 column | Vertical stack |

Sources: [css/styles.css L392-L596](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L392-L596)

## Theming and Accessibility

The theming system supports multiple accessibility modes and user preferences through CSS media queries and class-based overrides.

### Theme System Architecture

```mermaid
flowchart TD

SrOnly[".sr-only<br>Screen reader only content"]
SkipLink[".skip-link<br>Keyboard navigation aid"]
KeyboardNav[".keyboard-navigation<br>Enhanced focus indicators"]
FontSmall[".font-small<br>Reduced font sizes"]
FontLarge[".font-large<br>Increased font sizes"]
FontExtraLarge[".font-extra-large<br>Maximum font sizes"]
PrefersColorScheme["@media (prefers-color-scheme: dark)<br>System dark mode detection"]
PrefersContrast["@media (prefers-contrast: high)<br>High contrast mode"]
PrefersMotion["@media (prefers-reduced-motion)<br>Reduced animation preference"]
ThemeDark[".theme-dark<br>Manual dark theme activation"]
HighContrast[".high-contrast<br>High contrast mode override"]
ReduceMotion[".reduce-motion<br>Animation reduction"]

PrefersColorScheme --> ThemeDark
PrefersContrast --> HighContrast
PrefersMotion --> ReduceMotion

subgraph subGraph1 ["Manual Theme Classes"]
    ThemeDark
    HighContrast
    ReduceMotion
end

subgraph subGraph0 ["User Preferences"]
    PrefersColorScheme
    PrefersContrast
    PrefersMotion
end

subgraph subGraph3 ["Accessibility Utilities"]
    SrOnly
    SkipLink
    KeyboardNav
end

subgraph subGraph2 ["Font Size Classes"]
    FontSmall
    FontLarge
    FontExtraLarge
end
```

Sources: [css/styles.css L647-L826](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L647-L826)

### Dark Theme Implementation

The dark theme overrides specific CSS variables while maintaining the same component structure:

```css
@media (prefers-color-scheme: dark) {
    :root {
        --bg-primary: #1f2937;
        --bg-secondary: #111827;
        --bg-tertiary: #374151;
        --text-primary: #f9fafb;
        --text-secondary: #d1d5db;
        --border-color: #374151;
    }
}
```

Sources: [css/styles.css L672-L682](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L672-L682)

### Accessibility Features

The system includes comprehensive accessibility support:

| Feature | Implementation | Purpose |
| --- | --- | --- |
| Screen Reader Support | `.sr-only` class | Content for screen readers only |
| Skip Links | `.skip-link` class | Keyboard navigation shortcuts |
| Focus Indicators | Enhanced `:focus` styles | Visible keyboard navigation |
| High Contrast | `.high-contrast` overrides | Improved visibility |
| Reduced Motion | `.reduce-motion` overrides | Animation sensitivity |

Sources: [css/styles.css L780-L826](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L780-L826)

## Theme Switching Infrastructure

The application includes a theme switcher component that allows users to manually control theming options.

### Theme Switcher Component

```mermaid
flowchart TD

ThemeSwitcher[".theme-switcher<br>Fixed position control<br>Top-right corner"]
ThemeButtons["button elements<br>Theme option controls<br>.active state management"]
SettingsModal[".settings-modal<br>Comprehensive preferences"]
SettingsTabs[".settings-tabs<br>Tabbed interface"]
SettingsContent[".settings-content<br>Option controls"]
LocalStorage["localStorage<br>Theme persistence<br>User preference memory"]

ThemeButtons --> LocalStorage
SettingsContent --> LocalStorage

subgraph subGraph2 ["User Preferences Storage"]
    LocalStorage
end

subgraph subGraph1 ["Settings Panel"]
    SettingsModal
    SettingsTabs
    SettingsContent
    SettingsModal --> SettingsTabs
    SettingsTabs --> SettingsContent
end

subgraph subGraph0 ["Theme Switcher UI"]
    ThemeSwitcher
    ThemeButtons
    ThemeSwitcher --> ThemeButtons
end
```

Sources: [css/styles.css L827-L861](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L827-L861)

 [css/styles.css L863-L900](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L863-L900)

### Settings Panel Layout

The settings panel provides comprehensive control over appearance and accessibility options:

* **Appearance Tab**: Theme selection, color preferences
* **Accessibility Tab**: Font size, motion reduction, high contrast
* **System Tab**: System information and diagnostics

Sources: [css/styles.css L1505-L1695](https://github.com/sallowayma-git/IELTS-practice/blob/db0f538c/css/styles.css#L1505-L1695)

The CSS architecture provides a robust foundation for the entire application's visual presentation, with careful attention to maintainability, accessibility, and user experience across all devices and user preferences.