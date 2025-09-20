# HP 主题四页：总览 + 使用说明 + 交互逻辑 + 未完成清单（综合文档）

本文用于审查与实施：系统总览、文件结构、脚本依赖、交互逻辑、已实现功能、尚未完成事项、排障与测试计划。

---

## 1. 页面目标与现状

- Welcome（总览）
  - 目标：提供“分类选择 → 浏览/随机练习”入口；展示学习统计（次数/平均/时间）。
  - 现状：弹窗基于插件实现（hp-welcome-ui）。统计从真实记录计算。

- Practice（题库浏览）
  - 目标：以卡片展示真实题库；支持搜索和分类；按钮“开始练习/查看PDF”。
  - 现状：卡片由插件渲染（hp-practice-render）；最小桥接保留搜索（hp-practice-bridge）。

- Practice History（练习记录）
  - 目标：表格（虚拟滚动）展示真实练习记录；趋势实时展示。
  - 现状：表格与趋势已接入真实数据；第 1 列改为“标题 + 题目名称”。

- Setting（设置）
  - 目标：清缓存/加载题库/切换配置/强制刷新/备份/导入/导出/主题。
  - 现状：按钮通过桥接（hp-settings-bridge）连接到系统函数；主题弹窗由 hp-settings-theme-modal 提供。

---

## 2. 目录与路径策略

- 页面目录：`.superdesign/design_iterations/HP/`
- 推荐 base：`<base href="./">`（以 HP 目录为基准）
- 脚本路径（从 HP 目录到仓库根）：
  - 系统脚本：`../../../assets/...` 与 `../../../js/...`
  - 插件脚本：`../../../js/plugins/...`
- 顶部导航 `<a>`：相对 HP 目录（`Welcome.html`、`Practice History.html`、`practice.html`、`setting.html`）。

> 注：此前混用 `<base href="../../">` 与 `../../` 脚本前缀会导致 404，引发“无法找到文件/弹窗不出现/列表空”等连锁问题。建议逐页统一为上述策略。

---

## 3. 插件清单与职责

- 公共桥接
  - `js/plugins/hp/hp-core-bridge.js`
  - 作用：等待系统就绪、监听消息（PRACTICE_COMPLETE）、监听 `examIndexLoaded`、提供 `hpCore.getExamIndex()`/`getRecords()`。

- Welcome（分类选择 + 统计）
  - `js/plugins/hp/hp-welcome-ui.js`
  - 作用：
    - 弹窗：点击 “Start Reading Practice/Start Listening Practice” 或卡片标题“Reading/Listening”时弹出分类选择（阅读 P1/P2/P3；听力 P3/P4），选择后执行“浏览题目/随机练习”。
    - 统计：更新 Tests Taken / Average Score（1 位小数）/ Time Studied（小时）。

- Practice（题库渲染 + 最小桥接）
  - `js/plugins/hp/hp-practice-render.js`：用真实题库重绘卡片列表（标题/分类/开始练习/查看PDF）。
  - `js/plugins/hp/hp-practice-bridge.js`：最小接入，仅绑定搜索输入（不注入内部“全部/阅读/听力”按钮、不触发系统 `loadExamList()`），避免 UI 冲突。

- Practice History（记录表 + 趋势）
  - `js/plugins/hp/hp-history-table.js`
  - 作用：表格虚拟滚动；第 1 列显示“标题 + 下方题目名称”；趋势区“Average Score Over Time”实时更新。

- Setting（主题 + 按钮桥接）
  - `js/plugins/hp/hp-settings-theme-modal.js`：主题弹窗（浅色/深色/系统）。
  - `js/plugins/hp/hp-settings-bridge.js`：桥接“清缓存/加载题库/切换配置/强制刷新/创建备份/备份列表/导出/导入”到系统函数。

---

## 4. 脚本加载顺序（每页置于 `</body>` 前）

通用系统脚本（四页共用，顺序固定）：
```
<script src="../../../assets/scripts/complete-exam-data.js"></script>
<script src="../../../assets/scripts/listening-exam-data.js"></script>
<script src="../../../js/utils/helpers.js"></script>
<script src="../../../js/utils/storage.js"></script>
<script src="../../../js/utils/asyncExportHandler.js"></script>
<script src="../../../js/core/scoreStorage.js"></script>
<script src="../../../js/core/practiceRecorder.js"></script>
<script src="../../../js/components/PDFHandler.js"></script>
<script src="../../../js/components/IndexValidator.js"></script>
<script src="../../../js/components/CommunicationTester.js"></script>
<script src="../../../js/components/ErrorFixer.js"></script>
<script src="../../../js/components/CommunicationRecovery.js"></script>
<script src="../../../js/components/PerformanceOptimizer.js"></script>
<script src="../../../js/components/DataIntegrityManager.js"></script>
<script src="../../../js/components/BrowseStateManager.js"></script>
<script src="../../../js/utils/dataConsistencyManager.js"></script>
<script src="../../../js/utils/markdownExporter.js"></script>
<script src="../../../js/components/practiceRecordModal.js"></script>
<script src="../../../js/components/practiceHistoryEnhancer.js"></script>
<script src="../../../js/utils/componentChecker.js"></script>
<script src="../../../js/theme-switcher.js"></script>
<script src="../../../js/main.js"></script>
<script src="../../../js/boot-fallbacks.js"></script>
<script src="../../../js/app.js"></script>
```

各页插件脚本（按页追加）：
- Welcome：
```
<script src="../../../js/plugins/hp/hp-core-bridge.js"></script>
<script src="../../../js/plugins/hp/hp-welcome-ui.js"></script>
```
- Practice：
```
<script src="../../../js/plugins/hp/hp-core-bridge.js"></script>
<script src="../../../js/plugins/hp/hp-practice-bridge.js"></script>
<script src="../../../js/plugins/hp/hp-practice-render.js"></script>
```
- Practice History：
```
<script src="../../../js/plugins/hp/hp-core-bridge.js"></script>
<script src="../../../js/plugins/hp/hp-history-table.js"></script>
```
- Setting：
```
<script src="../../../js/plugins/hp/hp-core-bridge.js"></script>
<script src="../../../js/plugins/hp/hp-settings-theme-modal.js"></script>
<script src="../../../js/plugins/hp/hp-settings-bridge.js"></script>
```

---

## 5. 交互逻辑（端到端）

- Welcome
  - 点击“入口按钮/卡片标题” → 弹窗（类型 + 分类 + 行为） → 浏览题目（切换到 Practice）或随机练习（新窗口，完成后 PRACTICE_COMPLETE） → 统计卡片自动刷新。

- Practice
  - 卡片：
    - 标题：`exam.title`
    - 分类：`P1/P2/P3/P4`
    - 按钮：“开始练习”（`openExam`）/“查看PDF”（`viewPDF`，无 PDF 时禁用）
  - 搜索：placeholder = “搜索题库...”，实时过滤当前列表。

- Practice History
  - 表格：虚拟滚动；首列“标题 + 题目名称”（题目名称取自题库映射）；
  - Trend：完成练习后“Average Score Over Time”更新为最新。

- Setting
  - 系统管理：清缓存/加载题库/切换配置/强制刷新；
  - 数据管理：创建备份/备份列表/导出/导入；
  - 主题：浅色/深色/系统（持久化至 storage.settings.theme）。

---

## 6. 数据与事件

- 存储：`localStorage`，前缀 `exam_system_`
  - 关键键：`practice_records`、`exam_index`、`active_exam_index_key`、`user_stats` 等
- 事件：
  - 父 → 子：`INIT_SESSION` / `init_exam_session`
  - 子 → 父：`SESSION_READY`、`PROGRESS_UPDATE`、`PRACTICE_COMPLETE`
- 题库就绪：`examIndexLoaded`（由 js/main.js 派发）
- hpCore：`ready(cb)`、`getExamIndex()`、`getRecords()`；监听上面事件刷新界面。

---

## 7. 命名与 UI 统一

- 顶部标题统一为：`Wizarding World IELTS Prep`
- 不再注入页面内“全部/阅读/听力”蓝色按钮（避免与导航冲突）。

---

## 8. 未完成/待确认清单（TODO）

1) 路径与 base 全面统一（高优先级）
   - 将 4 个 HP 页面全部改为 `base="./"`；
   - 将所有脚本改为 `../../../` 前缀；
   - 导航 `<a>` 全部使用本目录相对路径（Welcome.html 等）。

2) Practice 页面上半部分静态示例内容（黑色文本列表）
   - 若仍显示静态示例，请移除页面中旧的静态卡片/示例列表，仅保留插件渲染的网格容器；
   - 或在样式上隐藏该段落（建议删除以减少误导）。

3) Welcome 弹窗触发的回退选择器
   - 若“Start Reading Practice/Start Listening Practice”文案发生变化，请在按钮上增加 data- 属性以便插件绑定：
     - 例如：`data-hp-action="start-reading"`、`data-hp-action="start-listening"`；
   - 后续可在插件中优先使用 data- 属性选择器，增强稳健性（TODO）。

4) Settings 按钮文案匹配
   - 桥接采用“按钮文案包含关键字”的方式；如更改文案，需同步桥接逻辑或为按钮补充 data-action 标记（TODO）。

5) i18n/多语言
   - 当前文案以中英混排；如需完整多语言支持，建议在插件中抽取文案常量并引入字典（TODO）。

6) 更稳健的数据映射
   - Practice History 首列“标题/题目名称”的来源优先级可配置（记录标题 → 题库标题 → 记录 examTitle）；
   - 如需要显示更多字段（类别、题型等），可在 hp-history-table 增加可配置列（TODO）。

---

## 9. 测试计划（建议）

- 场景 A：路径验证
  - 统一 base 与脚本前缀，确保 DevTools Network 无 404；导航不再“找不到文件”。

- 场景 B：Welcome
  - 触发弹窗（按钮/标题），选择 P1/P2/P3 或 P3/P4；
  - 浏览：切换到 Practice 并显示对应列表；随机：打开新窗口并注入增强器；
  - 完成一套练习后，统计在 1 秒内更新。

- 场景 C：Practice
  - 搜索关键字匹配；卡片“开始练习/查看PDF”可用，分类正确显示。

- 场景 D：Practice History
  - 表格渲染真实记录；首列显示标题与题目名称；趋势大号数字随最新记录更新。

- 场景 E：Setting
  - 清缓存/加载题库/配置切换/强制刷新/备份/列表/导出/导入/主题均可用。

---

## 10. 维护建议

- 变更前先统一路径策略，避免调试困难；
- 插件变更保持“最小接入、不覆写、不注入多余 UI”的原则；
- 充分利用 `hpCore.getExamIndex()/getRecords()` 与 `examIndexLoaded`/PRACTICE_COMPLETE 事件刷新界面；
- 遇到弹窗不出现/列表不更新优先检查控制台 404 与脚本顺序。

---

如需我将四页页面直接替换为本文件中“脚本清单 + base 策略”，请确认，我会在下一轮提交自动化修订补丁。
