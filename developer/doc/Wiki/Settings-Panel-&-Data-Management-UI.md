---

## Settings Persistence

Both panels persist their state to storage for cross-session consistency.

### Storage Keys for Settings

**Settings Storage Schema**

```mermaid
flowchart TD

SettingsPanel["SettingsPanel<br>Settings persistence"]
ThemeManager["ThemeManager<br>Theme persistence"]
ThemeSettings["theme_settings<br>localStorage"]
CurrentTheme["current_theme<br>localStorage"]
KeyboardShortcuts["keyboard_shortcuts_enabled<br>localStorage"]
SoundEffects["sound_effects_enabled<br>localStorage"]
AutoSave["auto_save_enabled<br>localStorage"]
Notifications["notifications_enabled<br>localStorage"]

SettingsPanel -.-> ThemeSettings
SettingsPanel -.-> KeyboardShortcuts
SettingsPanel -.-> SoundEffects
SettingsPanel -.-> AutoSave
SettingsPanel -.-> Notifications
ThemeManager -.-> CurrentTheme
ThemeManager -.-> ThemeSettings
```

**Sources:**

* [js/components/settingsPanel.js L24-L38](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L24-L38)
* [js/components/settingsPanel.js L42-L50](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L42-L50)
* [js/utils/themeManager.js L141-L159](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L141-L159)

### Theme Settings Object Structure

The `theme_settings` key stores:

```yaml
{
  fontSize: 'small' | 'normal' | 'large' | 'extra-large',
  reduceMotion: boolean,
  highContrast: boolean,
  autoTheme: boolean
}
```

**Sources:**

* [js/utils/themeManager.js L123-L128](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L123-L128)

---

## Progress Indication

The `DataManagementPanel` provides visual feedback during long-running operations using a progress overlay.

### Progress Overlay System

**Progress Overlay Architecture**

```mermaid
flowchart TD

ProgressOverlay["#progressOverlay<br>.progress-overlay"]
ProgressContent[".progress-content<br>Centered container"]
Spinner[".spinner<br>Loading animation"]
ProgressText["#progressText<br>Status message"]
ShowProgress["showProgress(text)<br>Display overlay + text"]
UpdateProgress["updateProgress(text)<br>Update text only"]
HideProgress["hideProgress()<br>Hide overlay"]
Operations["Export/Import/Cleanup<br>Operations"]

ProgressOverlay -.-> ProgressContent
ProgressContent -.-> Spinner
ProgressContent -.-> ProgressText
Operations -.-> ShowProgress
Operations -.-> UpdateProgress
Operations -.-> HideProgress
ShowProgress -.-> ProgressOverlay
UpdateProgress -.-> ProgressText
HideProgress -.-> ProgressOverlay
```

**Sources:**

* [js/components/dataManagementPanel.js L294-L311](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L294-L311)
* [js/components/dataManagementPanel.js L906-L929](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L906-L929)

### Progress States

Operations update the progress text to indicate current status:

| Operation | Progress States |
| --- | --- |
| Export | `'准备导出数据...'` |
| Import | `'读取文件...'` → `'验证数据格式...'` → `'导入数据...'` |
| Cleanup | `'清理数据...'` |

**Sources:**

* [js/components/dataManagementPanel.js L545](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L545-L545)
* [js/components/dataManagementPanel.js L626-L670](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L626-L670)
* [js/components/dataManagementPanel.js L737](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L737-L737)

---

## Message Notifications

Both panels use a toast notification system for user feedback about operation results.

### Toast Notification System

**Message Toast Architecture**

```mermaid
flowchart TD

ShowMessage["showMessage(message, type)<br>Display toast notification"]
CreateToast["createElement('div')<br>.message-toast.{type}"]
Icon["Icon element<br>fa-{icon}"]
Text["Text span<br>Message content"]
TypesMap["Message Types:<br>success → fa-check-circle<br>error → fa-exclamation-circle<br>warning → fa-exclamation-triangle<br>info → fa-info-circle"]
AutoRemove["setTimeout(5000)<br>Auto-remove toast"]

ShowMessage -.-> CreateToast
CreateToast -.-> Icon
CreateToast -.-> Text
ShowMessage -.-> TypesMap
TypesMap -.-> Icon
ShowMessage -.-> AutoRemove
AutoRemove -.-> CreateToast
```

**Sources:**

* [js/components/dataManagementPanel.js L934-L961](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L934-L961)

### Message Usage Examples

| Operation | Type | Message |
| --- | --- | --- |
| Export Success | `success` | `'数据导出成功！'` |
| Import Success | `success` | `'导入成功！导入 X 条记录'` |
| Cleanup Success | `success` | `'数据清理完成！'` |
| Export Error | `error` | `'导出失败: {error.message}'` |
| Import Error | `error` | `'导入失败: {error.message}'` |
| No Selection | `warning` | `'请选择要清理的数据类型'` |

**Sources:**

* [js/components/dataManagementPanel.js L570](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L570-L570)
* [js/components/dataManagementPanel.js L687](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L687-L687)
* [js/components/dataManagementPanel.js L752-L755](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L752-L755)

# Settings Panel & Data Management UI

> **Relevant source files**
> * [.superdesign/design_iterations/xiaodaidai_dashboard_1.html](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/.superdesign/design_iterations/xiaodaidai_dashboard_1.html)
> * [assets/data/vocabulary.json](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/assets/data/vocabulary.json)
> * [js/components/dataManagementPanel.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js)
> * [js/components/settingsPanel.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js)
> * [js/utils/helpers.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/helpers.js)
> * [js/utils/themeManager.js](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js)

## Purpose and Scope

This document covers the `SettingsPanel` and `DataManagementPanel` components that provide user interfaces for system configuration and data operations. The `SettingsPanel` offers a tabbed interface for appearance, accessibility, interaction, and advanced settings. The `DataManagementPanel` handles import, export, backup, and data cleanup operations.

For the underlying theme management system, see page [7.4](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/7.4)

 For data persistence and storage architecture, see page [4.1](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/4.1)

 For data backup implementation details, see page [4.4](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/4.4)

---

## SettingsPanel Architecture

The `SettingsPanel` class provides a modal-based interface for system configuration with a tabbed layout. It is instantiated on application initialization and registers global event handlers using event delegation.

### SettingsPanel Class Structure

**SettingsPanel Initialization and Components**

```mermaid
flowchart TD

Constructor["SettingsPanel()<br>constructor"]
GlobalRef["window.settingsPanel<br>Global reference"]
Init["init()<br>async initialization"]
LoadSettings["loadSettings()<br>Load from storage"]
CreateButton["createSettingsButton()<br>Floating FAB"]
SetupEvents["setupEventListeners()<br>Event delegation"]
Modal["Settings Modal<br>.settings-modal"]
Tabs["Tab Navigation<br>.settings-tabs"]
Content["Tab Content Areas<br>.settings-tab-content"]
Footer["Action Footer<br>.modal-footer"]

Constructor -.-> GlobalRef
Constructor -.-> Init
Init -.-> LoadSettings
Init -.-> CreateButton
Init -.-> SetupEvents
CreateButton -.-> Modal
Modal -.-> Tabs
Modal -.-> Content
Modal -.-> Footer
```

**Sources:**

* [js/components/settingsPanel.js L5-L20](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L5-L20)
* [js/components/settingsPanel.js L54-L108](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L54-L108)

### Settings Data Structure

The `settings` object persisted to storage contains:

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `theme` | string | `'light'` | Current theme identifier |
| `fontSize` | string | `'normal'` | Font size: small/normal/large/extra-large |
| `reduceMotion` | boolean | `false` | Reduce animations |
| `highContrast` | boolean | `false` | High contrast mode |
| `autoTheme` | boolean | `true` | Follow system theme |
| `keyboardShortcuts` | boolean | `true` | Enable keyboard shortcuts |
| `soundEffects` | boolean | `false` | Enable sound effects |
| `autoSave` | boolean | `true` | Auto-save practice progress |
| `notifications` | boolean | `true` | Enable notifications |

**Sources:**

* [js/components/settingsPanel.js L24-L38](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L24-L38)

---

## Tabbed Interface Structure

The `SettingsPanel` uses a four-tab layout for organizing settings by category. Tab switching is handled through event delegation on `.settings-tab` elements.

### Tab Navigation Architecture

**Settings Tabs and Content Areas**

```mermaid
flowchart TD

TabsContainer[".settings-tabs<br>Tab navigation bar"]
Tab1["Appearance Tab<br>data-tab='appearance'"]
Tab2["Accessibility Tab<br>data-tab='accessibility'"]
Tab3["Interaction Tab<br>data-tab='interaction'"]
Tab4["Advanced Tab<br>data-tab='advanced'"]
ContentContainer[".settings-content<br>Content container"]
Content1["#appearance-settings<br>.settings-tab-content.active"]
Content2["#accessibility-settings<br>.settings-tab-content"]
Content3["#interaction-settings<br>.settings-tab-content"]
Content4["#advanced-settings<br>.settings-tab-content"]
SwitchTab["switchTab(tabName)<br>Toggle active states"]

TabsContainer -.-> Tab1
TabsContainer -.-> Tab2
TabsContainer -.-> Tab3
TabsContainer -.-> Tab4
Tab1 -.-> SwitchTab
Tab2 -.-> SwitchTab
Tab3 -.-> SwitchTab
Tab4 -.-> SwitchTab
ContentContainer -.-> Content1
ContentContainer -.-> Content2
ContentContainer -.-> Content3
ContentContainer -.-> Content4
SwitchTab -.-> Content1
SwitchTab -.-> Content2
SwitchTab -.-> Content3
SwitchTab -.-> Content4
```

**Sources:**

* [js/components/settingsPanel.js L371-L383](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L371-L383)
* [js/components/settingsPanel.js L613-L625](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L613-L625)

### Tab Content Generation

Each tab is built using helper methods that create settings sections:

| Helper Method | Purpose | Output |
| --- | --- | --- |
| `createSection(builder, title, items)` | Create settings section | Section with heading and items |
| `createCheckboxItem(builder, opts)` | Create checkbox control | Checkbox with label and description |
| `createSelectItem(builder, opts)` | Create dropdown control | Select element with options |
| `createButtonItem(builder, opts)` | Create action button | Button with description |

**Sources:**

* [js/components/settingsPanel.js L324-L369](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L324-L369)

---

## Appearance Tab

The Appearance tab provides theme selection and font size controls, integrating with the `ThemeManager` for applying changes.

### Appearance Settings Components

**Appearance Tab Structure**

```mermaid
flowchart TD

AppearanceTab["#appearance-settings<br>.settings-tab-content"]
ThemeSection["Theme Settings Section<br>createSection()"]
ThemeSelect["#theme-select<br>Theme dropdown"]
AutoTheme["#auto-theme-toggle<br>Auto-follow system"]
FontSection["Font Settings Section<br>createSection()"]
FontSelect["#font-size-select<br>Font size dropdown"]
ThemeManager["window.app.themeManager<br>ThemeManager instance"]
SetTheme["setTheme(theme)"]
ToggleAuto["toggleAutoTheme()"]
SetFontSize["setFontSize(size)"]

AppearanceTab -.-> ThemeSection
AppearanceTab -.-> FontSection
ThemeSection -.-> ThemeSelect
ThemeSection -.-> AutoTheme
FontSection -.-> FontSelect
ThemeSelect -.-> ThemeManager
AutoTheme -.-> ThemeManager
FontSelect -.-> ThemeManager
ThemeManager -.-> SetTheme
ThemeManager -.-> ToggleAuto
ThemeManager -.-> SetFontSize
```

**Sources:**

* [js/components/settingsPanel.js L385-L422](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L385-L422)
* [js/utils/themeManager.js L5-L131](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L5-L131)

### Theme Options

Available themes from `ThemeManager`:

| Theme Key | Display Name | Variables |
| --- | --- | --- |
| `xiaodaidai` | 小呆呆控制台 | Warm yellow/blue gradient palette |
| `light` | 浅色主题 | Standard light mode colors |
| `dark` | 深色主题 | Dark background with lighter text |
| `highContrast` | 高对比度主题 | High contrast for accessibility |

**Sources:**

* [js/utils/themeManager.js L7-L120](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L7-L120)

---

## Accessibility Tab

The Accessibility tab provides visual and motion settings for users with specific needs, including high contrast mode and reduced motion.

### Accessibility Settings Components

**Accessibility Tab Structure**

```mermaid
flowchart TD

AccessibilityTab["#accessibility-settings<br>.settings-tab-content"]
VisualSection["Visual Assistance Section<br>createSection()"]
HighContrast["#high-contrast-toggle<br>High contrast checkbox"]
ReduceMotion["#reduce-motion-toggle<br>Reduce animations checkbox"]
KeyboardSection["Keyboard Navigation Section<br>createSection()"]
KeyboardNav["#keyboard-navigation-toggle<br>Enhanced navigation"]
ThemeManager["window.app.themeManager"]
ToggleContrast["toggleHighContrast()"]
ToggleMotion["toggleReduceMotion()"]
ApplySettings["applyContrastSettings()<br>applyMotionSettings()"]

AccessibilityTab -.-> VisualSection
AccessibilityTab -.-> KeyboardSection
VisualSection -.-> HighContrast
VisualSection -.-> ReduceMotion
KeyboardSection -.-> KeyboardNav
HighContrast -.-> ThemeManager
ReduceMotion -.-> ThemeManager
ThemeManager -.-> ToggleContrast
ThemeManager -.-> ToggleMotion
ThemeManager -.-> ApplySettings
```

**Sources:**

* [js/components/settingsPanel.js L424-L449](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L424-L449)
* [js/utils/themeManager.js L251-L262](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L251-L262)

### Accessibility Features

| Setting | Effect | Implementation |
| --- | --- | --- |
| High Contrast | Switches to `highContrast` theme | Applies high-contrast color palette |
| Reduce Motion | Adds `.reduce-motion` class | Disables CSS animations |
| Keyboard Navigation | Enhanced focus indicators | Enabled by default |

**Sources:**

* [js/utils/themeManager.js L253-L262](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L253-L262)
* [js/utils/themeManager.js L335-L347](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/utils/themeManager.js#L335-L347)

---

## Interaction Tab

The Interaction tab manages keyboard shortcuts and user feedback settings like sound effects and notifications.

### Interaction Settings Components

**Interaction Tab Structure**

```mermaid
flowchart TD

InteractionTab["#interaction-settings<br>.settings-tab-content"]
ShortcutsSection["Keyboard Shortcuts Section<br>createSection()"]
EnableShortcuts["#keyboard-shortcuts-toggle<br>Enable shortcuts checkbox"]
ViewShortcuts["#view-shortcuts-btn<br>View list button"]
FeedbackSection["Feedback Settings Section<br>createSection()"]
SoundEffects["#sound-effects-toggle<br>Sound effects checkbox"]
Notifications["#notifications-toggle<br>Notifications checkbox"]
KeyboardShortcuts["window.app.keyboardShortcuts"]
ShowModal["showShortcutsModal()"]

InteractionTab -.-> ShortcutsSection
InteractionTab -.-> FeedbackSection
ShortcutsSection -.-> EnableShortcuts
ShortcutsSection -.-> ViewShortcuts
FeedbackSection -.-> SoundEffects
FeedbackSection -.-> Notifications
EnableShortcuts -.-> KeyboardShortcuts
ViewShortcuts -.-> ShowModal
```

**Sources:**

* [js/components/settingsPanel.js L451-L479](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L451-L479)

### Keyboard Shortcuts Integration

The settings panel integrates with the application's keyboard shortcuts system:

| Setting | Storage Key | Effect |
| --- | --- | --- |
| Enable Shortcuts | `keyboard_shortcuts_enabled` | Enables/disables global shortcuts |
| Sound Effects | `sound_effects_enabled` | Enables audio feedback |
| Notifications | `notifications_enabled` | Enables browser notifications |

**Sources:**

* [js/components/settingsPanel.js L170-L189](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L170-L189)
* [js/components/settingsPanel.js L43-L49](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L43-L49)

---

## Advanced Tab

The Advanced tab provides access to data management, system maintenance, and system information functions.

### Advanced Settings Components

**Advanced Tab Structure**

```mermaid
flowchart TD

AdvancedTab["#advanced-settings<br>.settings-tab-content"]
DataSection["Data Settings Section<br>createSection()"]
AutoSave["#auto-save-toggle<br>Auto-save checkbox"]
DataMgmtBtn["#data-management-btn<br>Open DataManagementPanel"]
LibraryBtn["#library-loader-btn<br>Library loader"]
MaintenanceBtn["#system-maintenance-btn<br>System maintenance"]
ClearBtn["#clear-data-btn<br>Clear all data"]
TutorialSection["Tutorial Settings Section<br>createSection()"]
ResetTutorials["#reset-tutorials-btn<br>Reset progress"]
ShowTutorials["#show-tutorials-btn<br>Tutorial selector"]
SystemSection["System Information Section<br>createSection()"]
SystemInfo[".system-info<br>Version, storage usage"]

AdvancedTab -.-> DataSection
AdvancedTab -.-> TutorialSection
AdvancedTab -.-> SystemSection
DataSection -.-> AutoSave
DataSection -.-> DataMgmtBtn
DataSection -.-> LibraryBtn
DataSection -.-> MaintenanceBtn
DataSection -.-> ClearBtn
TutorialSection -.-> ResetTutorials
TutorialSection -.-> ShowTutorials
SystemSection -.-> SystemInfo
```

**Sources:**

* [js/components/settingsPanel.js L481-L546](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L481-L546)

### Advanced Settings Actions

| Button | Handler | Purpose |
| --- | --- | --- |
| Data Management | `openDataManagement()` | Opens `DataManagementPanel` |
| Library Loader | `openLibraryLoader()` | Opens library configuration |
| System Maintenance | `openSystemMaintenance()` | Opens maintenance panel |
| Clear Data | `confirmClearData()` | Clears all stored data |
| Reset Tutorials | Calls `tutorialSystem.resetTutorialProgress()` | Resets tutorial state |

**Sources:**

* [js/components/settingsPanel.js L191-L215](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L191-L215)
* [js/components/settingsPanel.js L777-L800](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/settingsPanel.js#L777-L800)

---

## DataManagementPanel Architecture

The `DataManagementPanel` class provides a comprehensive interface for data operations including export, import, backup, and cleanup. It is opened from the Advanced tab of `SettingsPanel`.

### DataManagementPanel Class Structure

**DataManagementPanel Components**

```mermaid
flowchart TD

Constructor["DataManagementPanel(container)<br>constructor"]
Container["Panel container element"]
BackupManager["this.backupManager<br>new DataBackupManager()"]
Initialize["initialize()<br>Setup panel"]
CreateStructure["createPanelStructure()<br>Build DOM"]
BindEvents["bindEvents()<br>Event delegation"]
LoadStats["loadDataStats()<br>Display statistics"]
LoadHistory["loadHistory()<br>Load operation history"]
Header["Panel Header<br>.panel-header"]
Content["Panel Content<br>.panel-content"]
ProgressOverlay["Progress Overlay<br>#progressOverlay"]

Constructor -.-> Container
Constructor -.-> BackupManager
Constructor -.-> Initialize
Initialize -.-> CreateStructure
Initialize -.-> BindEvents
Initialize -.-> LoadStats
Initialize -.-> LoadHistory
CreateStructure -.-> Header
CreateStructure -.-> Content
CreateStructure -.-> ProgressOverlay
```

**Sources:**

* [js/components/dataManagementPanel.js L26-L47](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L26-L47)
* [js/components/dataManagementPanel.js L49-L88](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L49-L88)

### Panel Sections

The panel is divided into five functional sections:

| Section | Class | Purpose |
| --- | --- | --- |
| Statistics | `.stats-section` | Display record count, time, score, storage |
| Export | `.export-section` | Configure and execute exports |
| Import | `.import-section` | Select files and import data |
| Cleanup | `.cleanup-section` | Clear specific data types |
| History | `.history-section` | View export/import history |

**Sources:**

* [js/components/dataManagementPanel.js L78-L88](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L78-L88)

---

## Export Operations

The export section allows users to export practice records in JSON or CSV format with optional filtering and additional data.

### Export Configuration and Flow

**Export Process Flow**

```mermaid
sequenceDiagram
  participant p1 as User
  participant p2 as DataManagementPanel
  participant p3 as Export Section
  participant p4 as DataBackupManager
  participant p5 as StorageManager
  participant p6 as Browser

  p1->>p3: Configure export options
  note over p3: Format (JSON/CSV)<br/>Include stats/backups<br/>Date range
  p1->>p2: Click export button
  p2->>p2: handleExport()
  p2->>p3: showProgress('准备导出数据...')
  p2->>p2: Collect options object
  note over p2: format, includeStats,<br/>includeBackups, dateRange
  p2->>p4: exportPracticeRecords(options)
  p4->>p5: Get practice records
  p5-->>p4: Records data
  p4->>p4: Filter by date range
  p4->>p4: Format as JSON/CSV
  p4-->>p2: {data, filename, mimeType}
  p2->>p2: downloadFile(data, filename)
  p2->>p6: Create blob and download
  p2->>p2: hideProgress()
  p2->>p1: showMessage('数据导出成功！')
  p2->>p2: loadHistory()
```

**Sources:**

* [js/components/dataManagementPanel.js L542-L577](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L542-L577)
* [js/components/dataManagementPanel.js L115-L159](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L115-L159)

### Export Options

| Option | Element ID | Type | Default | Purpose |
| --- | --- | --- | --- | --- |
| Format | `#exportFormat` | Select | `'json'` | JSON or CSV output |
| Include Stats | `#includeStats` | Checkbox | `true` | Include user statistics |
| Include Backups | `#includeBackups` | Checkbox | `false` | Include backup data |
| Start Date | `#exportStartDate` | Date input | - | Filter start date |
| End Date | `#exportEndDate` | Date input | - | Filter end date |

**Sources:**

* [js/components/dataManagementPanel.js L121-L147](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L121-L147)
* [js/components/dataManagementPanel.js L543-L563](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L543-L563)

---

## Import Operations

The import section supports importing data from JSON or CSV files with merge strategies to handle existing records.

### Import Configuration and Flow

**Import Process Flow**

```mermaid
sequenceDiagram
  participant p1 as User
  participant p2 as DataManagementPanel
  participant p3 as Import Section
  participant p4 as Import Mode Modal
  participant p5 as DataBackupManager
  participant p6 as StorageManager

  p1->>p3: Click import button
  p3->>p2: showImportModeModal()
  p2->>p4: Display mode selection
  p1->>p4: Select merge mode
  note over p4: merge (增量导入)<br/>or replace (覆盖导入)
  p4->>p2: pendingImportMode = mode
  p4->>p3: Update
  p2->>p4: hideImportModeModal()
  p1->>p3: Select file
  p3->>p2: handleFileSelect(event)
  p2->>p2: readFile(file)
  p2->>p2: Store in selectedFileContent
  p3->>p3: Enable import button
  p1->>p3: Click import data button
  p3->>p2: handleImport()
  p2->>p3: showProgress('读取文件...')
  p2->>p2: Parse JSON from file
  p2->>p3: updateProgress('验证数据格式...')
  p2->>p5: importPracticeData(data, options)
  note over p5: options: {mergeMode, createBackup, validateData}
  opt If createBackup
    p5->>p6: Create backup before import
  end
  p5->>p5: Validate data structure
  p5->>p5: Process records by merge mode
  p5->>p6: Save imported records
  p6-->>p5: Import complete
  p5-->>p2: {success, importedCount, skippedCount}
  p2->>p2: hideProgress()
  p2->>p1: showMessage('导入成功！')
  p2->>p2: loadDataStats()
  p2->>p2: loadHistory()
```

**Sources:**

* [js/components/dataManagementPanel.js L610-L705](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L610-L705)
* [js/components/dataManagementPanel.js L407-L498](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L407-L498)

### Import Options

| Option | Element ID | Type | Purpose |
| --- | --- | --- | --- |
| File Selection | `#importFile` | File input | Select JSON/CSV file |
| Import Mode | `#importMode` | Select | merge/replace/skip strategy |
| Create Backup | `#createBackupBeforeImport` | Checkbox | Backup before import |

**Sources:**

* [js/components/dataManagementPanel.js L161-L215](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L161-L215)

---

## Data Cleanup Operations

The cleanup section allows selective deletion of data types with optional pre-cleanup backup creation.

### Cleanup Configuration and Flow

**Cleanup Process Flow**

```mermaid
sequenceDiagram
  participant p1 as User
  participant p2 as DataManagementPanel
  participant p3 as Cleanup Section
  participant p4 as Confirmation Dialog
  participant p5 as DataBackupManager
  participant p6 as StorageManager

  p1->>p3: Select data types to clear
  note over p3: Practice records<br/>User stats<br/>Backups<br/>Settings
  p1->>p3: Click cleanup button
  p3->>p2: handleCleanup()
  p2->>p2: Check selections
  alt No selections
    p2->>p1: showMessage('请选择要清理的数据类型')
  else Has selections
    p2->>p4: Show confirmation dialog
    note over p4: List selected types<br/>Warning message
    p1->>p4: Confirm cleanup
    p2->>p3: showProgress('清理数据...')
    p2->>p5: clearData(options)
    note over p5: options: {clearPracticeRecords,<br/>clearUserStats, clearBackups,<br/>clearSettings, createBackup}
  opt If createBackup
    p5->>p6: Create backup
  end
    p5->>p6: Clear selected data types
    p6-->>p5: Cleanup complete
    p5-->>p2: {success, clearedItems[]}
    p2->>p3: hideProgress()
    p2->>p1: showMessage('数据清理完成！')
    p2->>p2: loadDataStats()
    p2->>p3: Reset checkboxes
  end
```

**Sources:**

* [js/components/dataManagementPanel.js L709-L770](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L709-L770)
* [js/components/dataManagementPanel.js L217-L261](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L217-L261)

### Cleanup Options

| Checkbox ID | Purpose | Storage Keys Affected |
| --- | --- | --- |
| `#clearRecords` | Clear practice records | `practice_records` |
| `#clearStats` | Clear user statistics | `user_stats` |
| `#clearBackups` | Clear backup data | Backup-related keys |
| `#clearSettings` | Clear system settings | Settings keys |
| `#createBackupBeforeClean` | Backup before cleanup | N/A (creates backup) |

**Sources:**

* [js/components/dataManagementPanel.js L228-L243](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L228-L243)

---

## Operation History Display

The history section displays logs of past export and import operations, allowing users to track data management activities.

### History Tab Architecture

**History Section Structure**

```mermaid
flowchart TD

HistorySection[".history-section<br>Operation history container"]
TabsContainer[".history-tabs<br>Tab navigation"]
ExportTab["Export History Tab<br>data-tab='export'"]
ImportTab["Import History Tab<br>data-tab='import'"]
ContentContainer[".history-content"]
ExportList["#exportHistory<br>.history-list"]
ImportList["#importHistory<br>.history-list"]
LoadHistory["loadHistory()<br>Load both histories"]
LoadExport["loadExportHistory()<br>From DataBackupManager"]
LoadImport["loadImportHistory()<br>From DataBackupManager"]
RenderItem["createHistoryItem({icon, title, details})<br>Create DOM elements"]

HistorySection -.-> TabsContainer
HistorySection -.-> ContentContainer
TabsContainer -.-> ExportTab
TabsContainer -.-> ImportTab
ContentContainer -.-> ExportList
ContentContainer -.-> ImportList
LoadHistory -.-> LoadExport
LoadHistory -.-> LoadImport
LoadExport -.-> ExportList
LoadImport -.-> ImportList
ExportList -.-> RenderItem
ImportList -.-> RenderItem
```

**Sources:**

* [js/components/dataManagementPanel.js L263-L292](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L263-L292)
* [js/components/dataManagementPanel.js L789-L869](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L789-L869)

### History Record Structure

Each history item displays:

| Field | Export Display | Import Display |
| --- | --- | --- |
| Icon | `fa-download` | `fa-upload` |
| Title | `{FORMAT} 导出` | `导入操作` |
| Record Count | `记录数: {count}` | `新增记录: {count}` |
| Additional Info | `时间: {timestamp}` | `合并模式: {mode}` |

**Sources:**

* [js/components/dataManagementPanel.js L799-L831](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L799-L831)
* [js/components/dataManagementPanel.js L836-L869](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/components/dataManagementPanel.js#L836-L869)

---

## Query Parameter Handling

The system processes URL query parameters to control theme behavior on page load.

### Theme Query Parameters

```mermaid
flowchart TD

PageLoad["Page Load"]
ParseParams["Parse URL query params"]
GetDirective["Get 'theme' parameter"]
CheckValue["Check parameter value"]
ResetTheme["reset/main/default"]
PortalTheme["portal"]
ClearPref["themePreferenceController.clear()"]
ClearSession["clearSessionSkip()"]
RemoveParam["Remove param from URL"]
ReplaceState["history.replaceState()"]

PageLoad -.-> ParseParams
ParseParams -.-> GetDirective
GetDirective -.-> CheckValue
CheckValue -.-> ResetTheme
CheckValue -.-> PortalTheme
ResetTheme -.-> ClearPref
ResetTheme -.-> ClearSession
PortalTheme -.-> ClearSession
ClearPref -.-> RemoveParam
ClearSession -.-> RemoveParam
RemoveParam -.-> ReplaceState
```

**Sources:**

* [js/theme-switcher.js L175-L204](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/theme-switcher.js#L175-L204)

### Supported Query Parameters

| Parameter | Value | Action |
| --- | --- | --- |
| `?theme=reset` | Reset theme preference | Clears stored preference |
| `?theme=main` | Reset to main portal | Clears stored preference |
| `?theme=default` | Reset to default | Clears stored preference |
| `?theme=portal` | Clear skip flag | Allows auto-redirect |

**Sources:**

* [js/theme-switcher.js L186-L193](https://github.com/sallowayma-git/IELTS-practice/blob/92f64eb8/js/theme-switcher.js#L186-L193)