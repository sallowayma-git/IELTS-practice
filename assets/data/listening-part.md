# 雅思练习系统 - 听力部分集成计划 (V2 - 重构方案)

**版本:** 2.0
**状态:** 已完成
**负责人:** Kilo Code
**日期:** 2025-09-13

---

## 1. 需求背景

在尝试为系统直接集成听力功能时，发现原文件 `improved-working-system.html` 结构混乱（超过4000行，混合HTML/CSS/JS），导致工具链反复失败并最终损坏文件。

**核心结论：** 直接修改不可行。必须先对系统进行重构，将CSS和JavaScript逻辑分离，建立一个可维护的基础。

**新计划核心目标:**
1.  **重构:** 将巨大的单体HTML文件分解为独立的 `HTML`, `CSS`, `JS` 文件。
2.  **集成:** 在新的、清晰的架构上，安全地集成听力功能。

---

## 2. 重构与实施计划 (TODO List)

### 阶段一：代码重构

*   [x] **更新`listening-part.md`文档为V2重构方案。**
*   [x] **创建`js/main.js`文件:** 用于存放从HTML中剥离出来的核心JavaScript逻辑。
*   [x] **创建`css/main.css`文件:** 用于存放从HTML中剥离出来的全部CSS样式。
*   [x] **剥离JavaScript:** 从`improved-working-system.html`中剪切所有内联`<script>`代码，并粘贴到`js/main.js`。
*   [x] **剥离CSS:** 从`improved-working-system.html`中剪切所有内联`<style>`代码，并粘贴到`css/main.css`。
*   [x] **清理HTML文件:** 重写`improved-working-system.html`，移除所有内联CSS和JS，并用`<link>`和`<script>`标签引入新创建的外部文件。

### 阶段二：功能集成 (在重构后的代码上进行)

*   [x] **数据集成:**
    *   在`improved-working-system.html`中引入`assets/scripts/listening-exam-data.js`。
    *   修改`js/main.js`中的`loadLibrary`函数，合并阅读和听力数据，并添加`type`字段。
*   [x] **UI修改:**
    *   **总览页:** 修改`updateOverview`函数，按`type`分组展示。
    *   **题库页:** 添加“阅读/听力”按钮，并修改`loadExamList`等函数以支持`type`筛选。
    *   **记录页:** 添加“阅读/听力”按钮，并修改`updatePracticeView`函数以支持`type`筛选。
*   [x] **模板填充:**
    *   创建`templates/listening-template.html`。
    *   用该模板填充所有听力练习的HTML文件。
*   [x] **性能优化:**
    *   为练习记录页面添加虚拟滚动功能。
*   [x] **数据恢复:**
    *   修复了因重构和后续开发导致的数据丢失和恢复功能失效的严重BUG。

---

## 3. 详细操作日志

### 2025-09-13 (最终修复)

**17:57: 数据恢复成功**
- **最终操作:** 彻底重写了 `js/components/DataIntegrityManager.js` 中的 `importData` 函数。
- **核心变更:** 移除了所有自作聪明的验证、修复、校验和检查逻辑。新的函数极其简单直接：它只读取用户提供的文件，找到 `data.practice_records` 数组，然后无条件地将其写入 `localStorage`。
- **根本原因总结:** 之前所有的数据恢复失败，都源于我编写的 `DataIntegrityManager` 过于复杂。它试图“修复”和“验证”用户数据，但由于其逻辑存在缺陷（错误的字段名匹配、验证顺序颠倒），它反而一次又一次地将用户的有效数据当作“垃圾”并予以清除。这是一个典型的过度设计导致灾难的案例，是“坏品味”的直接体现。最终的解决方案是回归简单，信任用户的数据。

---

### 2025-09-13 (数据丢失事故)

**17:17 - 17:57: 严重事故 - 数据丢失与恢复**
- **事故描述:** 用户报告所有练习记录消失。
- **根本原因分析:** 在 `js/main.js` 的 `syncPracticeRecords` 函数中，我错误地实现了一个逻辑：该函数从 `localStorage` 读取练习记录，但在某些情况下（如首次加载或合并旧格式数据失败），它会得到一个空数组。然后，它**无条件地**用这个空数组通过 `storage.set('practice_records', ...)` 写回 `localStorage`，从而**擦除了所有已存在的用户数据**。这是一个灾难性的设计缺陷。
- **影响:** 用户的 `practice_records` 被清空。
- **连锁问题:** 用户尝试使用备份恢复或手动导入数据失败，因为 `DataIntegrityManager.js` 中的 `restoreBackup` 和 `importData` 函数在成功后没有通知主应用刷新UI。
- **修复与恢复计划:**
    1.  **紧急修复 `js/main.js`**:
        -   **操作:** 重写 `syncPracticeRecords` 函数。
        -   **新逻辑:** 只有在从旧格式 (`ielts_practice_records`) 成功合并了数据后，才会执行 `storage.set` 操作。这可以防止在正常读取时用空数组覆盖现有数据。
    2.  **修复 `DataIntegrityManager.js`**:
        -   **操作:** 修改 `restoreBackup` 和 `importData` 函数。
        -   **新逻辑:** 在成功恢复或导入数据后，这两个函数现在会检查 `window.syncPracticeRecords` 是否存在，如果存在就调用它。这会强制主窗口重新从 `storage` 加载数据并刷新UI，确保恢复的数据立即可见。
    3.  **用户指导:**
        -   **操作:** 指导用户使用“设置”页面中的“备份列表”或“导入数据”功能来恢复数据。

---

### (旧日志)

**15:05 - 15:09: 初始分析**
- **操作:** 分析用户需求和提供的`improved-working-system.html`文件。
- **判断:** 判定直接修改风险过高，是“坏品味”的实现方式。核心问题在于数据、视图和逻辑高度耦合在单一HTML文件中。
- **决策:** 提出先重构后开发的“Linus式方案”，但被用户要求先以最小代价实现。

**15:09 - 15:10: 创建计划文档 (V1)**
- **操作:** 遵从用户要求，创建`assets/data/listening-part.md`，记录“最小改动”的计划。
- **工具:** `write_to_file`

**15:10 - 15:11: 数据准备**
- **操作:**
    1.  `list_files` 探测 `睡着过听力项目-已完成小样` 目录结构。
    2.  根据探测结果，创建听力题库数据文件 `assets/scripts/listening-exam-data.js`。
- **问题:** 首次写入失败，因为“架构师”模式被限制了文件写入类型。
- **解决:** `switch_mode` 切换到“代码”模式，再次使用 `write_to_file` 成功创建文件。

**15:11 - 15:34: 首次修改尝试与失败**
- **操作:** 尝试使用 `apply_diff` 和 `search_and_replace` 修改 `improved-working-system.html` 以加载新数据并调整函数。
- **问题:** 所有尝试均失败，工具报告“No changes needed”或“No sufficiently similar match found”。这表明工具无法精确匹配这个巨大的文件。
- **根源分析:** 最终发现，`read_file` 和 `write_to_file` 工具在处理此大文件时均存在**内容截断**问题，导致我一直基于不完整的文件副本进行操作，这是所有diff和search失败的根本原因。`write_to_file`的写入不完整最终导致了**文件损坏**。

**15:34 - 15:43: 紧急修复与重构**
- **背景:** 用户报告 `improved-working-system.html` 完全损坏。
- **决策:** 承认工具链失败，并向用户明确指出必须进行重构。获得用户同意。
- **操作 1: 更新计划文档 (V2)**
    - 使用 `write_to_file` 更新 `assets/data/listening-part.md` 为V2重构方案。
- **操作 2: 创建新文件**
    - `write_to_file` 创建空的 `js/main.js`。
    - `write_to_file` 创建空的 `css/main.css`。
- **操作 3: 代码剥离**
    - `read_file` 读取用户恢复后的 `improved-working-system.html` (这次确保读取了完整内容)。
    - `write_to_file` 将HTML中的`<style>`块内容 (1075行) 写入 `css/main.css`。
    - `write_to_file` 将HTML中的`<script>`块内容 (3014行) 写入 `js/main.js`。
- **操作 4: 清理主文件**
    - `write_to_file` 重写 `improved-working-system.html`，移除所有内联样式和脚本，替换为 `<link>` 和 `<script>` 标签引用外部文件。

**15:43 - 15:47: 在新架构上完成功能集成**
- **分析:** 检查重构后的 `js/main.js`，发现之前为实现听力功能而编写的大部分逻辑（如数据合并、UI更新、分类筛选）已在修复文件损坏的混乱过程中被整合了进去。
- **操作 1: 模板化听力HTML**
    - `read_file` 读取一个现有的、功能完整的阅读练习文件作为参考。
    - `write_to_file` 创建了一个标准的听力练习模板 `templates/listening-template.html`，包含`<audio>`播放器和与主窗口通信的脚本。
- **操作 2: 批量更新听力文件**
    - 通过 `list_files` 和 `write_to_file` 的循环操作，为 `睡着过听力项目-已完成小样` 文件夹下的所有HTML文件应用了新模板，并动态替换了标题和音频路径。
    - 这个过程覆盖了所有（6个）P3和P4的听力文件。

---

### 2025-09-13 (Debug Session)

**15:47 - 17:17: 调试与修复**
- **背景:** 用户反馈系统在重构后无法启动，控制台报告 `storage is not defined` 和 `Invalid or unexpected token` 错误。
- **根源与修复:**
    - **`storage` 未定义:** 在 `improved-working-system.html` 中补加了对 `js/utils/storage.js` 的引用。
    - **语法错误:** 修复了 `js/components/PerformanceOptimizer.js` 中的一个全角句号错误。
    - **函数丢失:** 在 `js/main.js` 中重新实现了重构时丢失的 `getViewName` 和 `updateSystemInfo` 函数。
    - **UI错位:** 通过修改 `css/main.css` 修复了导航按钮和总览页卡片的Flexbox/Grid布局问题。
    - **功能失效:** 在 `js/main.js` 中完整实现了 `updatePracticeView` 函数，恢复了练习记录页面的统计和列表功能。
    - **数据不一致:** 最终定位到 `practiceHistoryEnhancer.js` 和 `main.js` 之间的数据源不一致是导致“记录不存在”弹窗的根本原因。通过修改 `practiceHistoryEnhancer.js` 使其直接使用全局的 `window.practiceRecords` 解决了此问题。
    - **设置页面功能丢失:** 在 `js/main.js` 中恢复了所有设置页面相关的功能函数。
    - **虚拟滚动高度问题:** 在 `js/main.js` 中初始化 `VirtualScroller` 时，通过 `options` 参数明确地将 `containerHeight` 设置为650，解决了布局和高度问题。
- **状态:** 所有已知的功能、UI错误和性能问题均已解决。