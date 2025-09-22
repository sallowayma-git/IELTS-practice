# UPGRADE v1.1.5 修复指南（覆盖版｜当前三类症状：总览无卡片 / 浏览无匹配 / 练习记录为空 + 既有两项修复）

运行环境
- 本地 file:// 打开 `index.html`（无服务端）
- 不新增脚本、不改数据结构；在现有文件内做最小修改

目标
- 修复 1：练习记录详情点击报错 “practiceRecords.find is not a function”
- 修复 2：题库浏览界面点击“打开/PDF”无法打开，或报 “examIndex.find is not a function”

—— 分割线 ——

修复 1：练习记录详情 “practiceRecords.find is not a function”

原因
- 升级为异步存储后，部分组件仍以同步方式调用 `storage.get(...)`，拿到的是 Promise 而非数组，然后直接 `.find(...)` 触发报错。

改动（按文件定位精确修改）
- 文件：`js/components/practiceRecordModal.js`
  - 将方法 `exportSingle(recordId)` 改为 `async exportSingle(recordId)`。
  - 将内部两处同步 `get` 改为 `await`：
    - `const practiceRecords = await window.storage.get('practice_records', []);`
    - `const examIndex = await window.storage.get('exam_index', []);`
  - 兼容方法 `showById` 改为异步并使用 `await`：
    - `window.practiceRecordModal.showById = async function(recordId) { ... }`
    - 内部读取：`const records = (window.storage ? (await window.storage.get('practice_records', [])) : []) || [];`

- 文件：`js/components/practiceHistoryEnhancer.js`
  - 将 `showRecordDetails(recordId)` 改为 `async showRecordDetails(recordId)`。
  - 将两处 `window.storage.get('practice_records', [])` 改为 `await window.storage.get('practice_records', [])` 后再 `.find(...)`。

验证
- 打开“练习记录”页面，点击任意记录“标题/详情”，应弹出记录详情，不再出现 `find is not a function`。

—— 分割线 ——

修复 2：题库浏览“打开/PDF”无效 或 “examIndex.find is not a function”

可能原因与改动
1) app 内部打开流程中对索引的类型未做防御（存量数据可能不是数组）
- 文件：`js/app.js` 方法 `async openExam(examId)`（约 859 行）
  - 在读取完成后，增加数组化防御：
    - 读取后加入：
      - `let list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);`
      - `const exam = list.find(e => e.id === examId);`
  - 若未找到，提示并返回。

2) 主流程兜底打开逻辑同样需要防御
- 文件：`js/main.js` 方法 `function openExam(examId)`（约 533 行）
  - 在 `const exam = examIndex.find(...)` 前，加入：
    - `const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);`
    - `const exam = list.find(e => e.id === examId);`

3) await 语法错误会中断“打开”流程（如仍出现）
- 文件：`js/app.js` 方法 `injectDataCollectionScript(examWindow, examId)`（约 974 行）
  - 将内部 `const injectScript = () => { ... await fetch(...) ... }` 改为 `const injectScript = async () => { ... }`（或将该方法本身与内部函数都标记为 `async`）。

4) 路径前缀导致 file:// 下资源定位失败
- 文件：`js/main.js` 方法 `getPathMap()`（约 505-514 行）
  - 将 `reading.root` 置为 `''`（空串），保持 `listening.root: 'ListeningPractice/'`。
  - 保留 `resolveExamBasePath()` 既有规范化逻辑，不再强加错误目录前缀。

验证（控制台）
- 阅读：`var e=(window.examIndex||[]).find(x=>x.type==='reading'&&x.hasHtml); window.buildResourcePath(e,'html')`
- 听力：`var l=(window.examIndex||[]).find(x=>x.type==='listening'); window.buildResourcePath(l,'html')`
- 使用 `window.open('<上述输出>','_blank')` 能打开 HTML；PDF 按钮调用 `buildResourcePath(e,'pdf')` 验证能打开 PDF。

—— 分割线 ——

验收清单
- 无 `await is only valid...` / `examIndex.find is not a function` / `practiceRecords.find is not a function` 报错。
- 题库浏览“打开/PDF”均可在新窗口加载。
- 记录详情弹窗可正常展示。

新增修复 3：总览无卡片 / 浏览“未找到匹配的题目” / 练习“暂无任何练习记录”

原因与改动（最小变更，已按文件实现）
A) 防止索引在每次加载时被清空
- 文件：js/main.js → initializeLegacyComponents()
  - 将“升级清理”改为仅首次执行（使用 localStorage 标记 upgrade_v1_1_0_cleanup_done）。避免每次刷新都清空 exam_index 与配置，导致总览/浏览为空。

B) 题库索引加载稳定化
- 文件：js/main.js → async loadLibrary()
  - 非空数组缓存才使用；否则从 window.completeExamIndex（阅读）与 window.listeningExamIndex（听力）重建。
  - 若两者皆空，不写入空索引，直接 finishLibraryLoading（避免污染缓存）。
- 文件：index.html（已校验）
  - 脚本顺序：数据脚本 → utils/storage → core/components → main.js → app.js（最后）。

C) 触发 UI 渲染链路
- 文件：js/main.js → finishLibraryLoading(startTime)
  - 先 try { window.examIndex = examIndex }，再 updateOverview()，最后派发 examIndexLoaded。
- 文件：js/main.js 末尾
  - 监听 examIndexLoaded 事件 → 调用 loadExamList() 并隐藏浏览页 spinner。

D) 练习记录显示与详情
- 文件：js/main.js → async syncPracticeRecords()
  - await storage.get('practice_records', [])，必要时做最小字段补全，统一写入 window.practiceRecords，然后 updatePracticeView()。
- 文件：js/components/practiceRecordModal.js
  - exportSingle(recordId) 使用 await 读取 practice_records 与 exam_index；
  - 兼容方法 showById(recordId) 改为 async + await storage.get 后再 .find。
- 文件：js/components/practiceHistoryEnhancer.js
  - async showRecordDetails(recordId)：storage 与全局数组双通道查找（均已 await/防御）。

E) “await is only valid…” 语法错误导致打开流程中断
- 文件：js/app.js → injectDataCollectionScript()
  - 将内部 injectScript 改为 async，内部 fetch/await 合法执行（file:// 下不再报错）。
- 文件：js/app.js → DOMContentLoaded 初始化
  - 去除事件处理器中的顶层 await，使用 IIFE 包裹同步触发 initialize()（兼容旧浏览器）。

F) 路径映射（file:// 下 HTML/PDF 正确定位）
- 文件：js/main.js → getPathMap()
  - reading.root 置为 ''；listening.root 保持 'ListeningPractice/'。

验证步骤（手工）
1) 刷新页面（建议关闭缓存）
   - 总览页出现“阅读 P1/P2/P3”卡片；如有听力数据，出现“P3/P4”卡片。
2) 切换到“题库浏览”
   - 列表渲染并隐藏“正在加载…”；筛选“阅读/听力”均有条目；搜索能返回结果。
3) 打开题目
   - 点击“开始”弹新窗加载 HTML，无 SyntaxError/await 报错；若题目无 HTML，点击 PDF 可正常打开。
4) 练习记录
   - 若已有 practice_records，练习页不再显示“暂无任何练习记录”；点击记录标题可弹出详情。

故障排查（Console 快速检查）
- 索引为空：
  - Array.isArray(window.completeExamIndex) && window.completeExamIndex.length > 0
  - Array.isArray(window.listeningExamIndex) && window.listeningExamIndex.length > 0
  - Array.isArray(window.examIndex) && window.examIndex.length > 0
  - localStorage.getItem('upgrade_v1_1_0_cleanup_done') === '1'
- 浏览仍“未找到匹配”：
  - console.log('len=', (window.examIndex||[]).length, 'type=', window.currentExamType, 'cat=', window.currentCategory)
  - 调用 window.loadExamList() 是否报错；#browse-view .loading 是否被隐藏。
- 记录仍为空：
  - await storage.get('practice_records', []).then(r=>console.log(r.length))
  - window.practiceRecords?.length

说明
- 本指南为覆盖版，仅保留当前两项问题的最新修复步骤；其他通用修复请参考交接文档中历史条目。

