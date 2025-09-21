# UPGRADE v1.1.5 修复指南（覆盖版｜仅含当前两项问题）

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

说明
- 本指南为覆盖版，仅保留当前两项问题的最新修复步骤；其他通用修复请参考交接文档中历史条目。

