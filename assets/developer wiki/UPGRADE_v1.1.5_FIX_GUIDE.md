# UPGRADE v1.1.5 修复指南（基于现有代码 | file:// 本地运行）

适用问题（你的当前症状）：
- Console 报错：Uncaught SyntaxError: await is only valid in async functions and the top level bodies of modules
- 总览页面无“阅读/听力”卡片
- 题库浏览显示“未找到匹配的题目”
- 练习记录页面显示“暂无任何练习记录”

执行约束
- 所有改动均基于当前仓库文件，保持最小改动、不新增脚本、不改变数据结构
- 运行方式为本地 file:// 直接打开 index.html

一、修复 await 语法错误（js/app.js）
- 触发原因（已在代码中定位）：在非 async 函数体内使用了 await
- 文件定位：`js/app.js:974` 方法 `injectDataCollectionScript(examWindow, examId)` 内部定义的 `injectScript` 箭头函数
- 当前实现片段（含问题）：
  - `const injectScript = () => { ... const enhancerScript = await fetch('./js/practice-page-enhancer.js').then(r => r.text()); ... }`
- 修复方式（任选其一；推荐 A，改动更小）：
  - A) 将内部箭头函数改为 async（仅一处修改）
    - 修改：`const injectScript = async () => { ... }`
  - B) 或将方法签名与内部函数都标记为 async
    - 修改：`async injectDataCollectionScript(...) { const injectScript = async () => { ... } }`
- 预期效果：消除 await 语法错误；脚本可继续执行到注入与握手流程

二、重建题库索引并验证数据加载
- 清缓存（控制台执行）：
  - `await storage.remove('exam_index')`
  - `await storage.remove('active_exam_index_key')`
  - `await storage.set('exam_index_configurations', [])`
- 验证数据脚本是否就绪（控制台执行）：
  - `Array.isArray(window.completeExamIndex) && window.completeExamIndex.length > 0`
  - `Array.isArray(window.listeningExamIndex) && window.listeningExamIndex.length > 0`
  - 预期输出示例：
    - `true`（completeExamIndex 验证）
    - `true`（listeningExamIndex 验证）
    - 若为 `false`，检查数据脚本是否正确加载
- 触发重建：刷新页面（或点击"强制刷新题库"按钮，若有）。
- 构建逻辑位置：`js/main.js:125-170`（`loadLibrary`）
  - 命中缓存时直接使用
  - 否则从 `window.completeExamIndex`（映射为 `type:'reading'`）和 `window.listeningExamIndex`（已含 `type:'listening'`）合并
  - 完成后派发 `examIndexLoaded`（`js/main.js:176-181`）

三、总览与题库浏览页面恢复显示
- 总览卡片渲染：`js/main.js:186-226`（`updateOverview`）
  - 基于 `examIndex.filter(e => e.type === 'reading'|'listening')` 统计 P 级别
  - 容器：`index.html:206`（`#category-overview`）
- 题库浏览列表：`js/main.js:411-439`（`loadExamList`/`displayExams`）
  - 事件绑定：`window.addEventListener('examIndexLoaded', ...)`（`js/main.js:1495`），触发后刷新列表并隐藏 loading
- 若仍显示“未找到匹配的题目”，请核验：
  - `Array.isArray(window.examIndex)` 为 true 且 `window.examIndex.length > 0`
  - `currentExamType/currentCategory` 均为 `'all'`（默认：`js/main.js:11-13`）

四、练习记录页面恢复
- 记录同步：`js/main.js:70-124`（`syncPracticeRecords`）
  - 优先从 `PracticeRecorder.getPracticeRecords()` 获取，否则回退 `await storage.get('practice_records', [])`
  - 设置 `window.practiceRecords` 并调用 `updatePracticeView()`（`js/main.js:116-123`）
- 记录渲染：`js/main.js:308-375`（`updatePracticeView`）
  - 无记录时显示“暂无任何练习记录”（`js/main.js:364-367`）
- 如出现 "Assignment to constant variable" 错误（已在仓库发现潜在点）：
  - 文件：`js/core/practiceRecorder.js:46`，`restoreActiveSessions()` 中 `const storedSessions = ...` 后续被重新赋值
  - 最小修复：将 `const` 改为 `let`，并保留后续归一化
    - 完整修复代码片段：
      ```javascript
      // 修改前（第46行附近）：
      const storedSessions = storage.get('active_sessions', []);
      if (!Array.isArray(storedSessions)) {
        storedSessions = [];
      }

      // 修改后：
      let storedSessions = storage.get('active_sessions', []);
      if (!Array.isArray(storedSessions)) {
        storedSessions = [];
      }
      ```
  - 注意：不在此处引入 `await`，避免再次触发 await 语法错误（函数体未标记 async）

五、file:// 本地运行注意（仅核验，不改结构）
- 本仓库的脚本已在跨窗口通信中放宽 file 场景（`js/main.js:82-106` 的消息监听允许 `origin === 'null'` 或同源）
- 若浏览器限制 `fetch` 读取本地文件导致增强脚本注入失败，`injectDataCollectionScript` 已在 catch 中回退为内联注入（`js/app.js:1026-1030`），可在 Console 关注相关日志

六、验收检查（逐条过）
- 无 Console 语法错误（尤其是 await 相关）
- `Array.isArray(window.examIndex) === true` 且 `window.examIndex.length > 0`
- 总览卡片显示阅读/听力与各 P 级别计数
- 题库浏览默认“全部”过滤下有列表，切换类型/类别后仍有结果
- 打开题目可见握手与回写日志（SESSION_READY / PRACTICE_COMPLETE），练习记录计数递增

附：关键文件与行号导航
- `index.html:291-292` 数据脚本；`index.html:323` main.js；`index.html:327` app.js（请保持 app.js 最后加载）
- `js/app.js:974-1052` 数据采集注入流程（本次 await 修复点）
- `js/main.js:125-181` 题库构建与完成事件；`js/main.js:186-226` 总览渲染；`js/main.js:411-439` 列表渲染；`js/main.js:1495` examIndexLoaded 绑定
- `js/core/practiceRecorder.js:46` 活动会话恢复（const 重赋值修复点）

补充修复（按钮打开与记录详情问题）

A. 题库浏览中的“打开/ PDF”按钮无效
- 先确认已完成“一、await 语法错误修复”，否则点击打开时会在 `injectDataCollectionScript` 内部触发语法错误并中断。
- 校验资源路径构建：
  - 控制台执行：
    - `var e = (window.examIndex||[]).find(x=>x.type==='reading' && x.hasHtml); buildResourcePath(e,'html')`
    - `var l = (window.examIndex||[]).find(x=>x.type==='listening'); buildResourcePath(l,'html')`
    - 将输出的路径直接粘贴到地址栏或 `window.open('<输出>','_blank')` 验证能否打开。
- 路径前缀映射修正（基于现有代码）：
  - 文件：`js/main.js:505-514`（`getPathMap()` 的返回值）
  - 将 `reading.root` 设置为空字符串（或改为你本机实际顶层目录的相对路径，但建议留空以避免重复前缀），`listening.root` 保持 `ListeningPractice/`：
    - 修改前：`reading.root: '睡着过项目组(9.4)[134篇]/3. 所有文�?9.4)[134篇]/'`
    - 修改后：`reading.root: ''`
  - 说明：`resolveExamBasePath()` 已保证不重复添加前缀；留空可直接使用数据脚本内的 `exam.path` 作为相对路径，减少编码/目录名差异带来的失败。
- 再次用上面的控制台方法验证 `buildResourcePath` 输出路径即可打开 HTML/PDF 文件。

B. 练习记录“点击详情”报错：practiceRecords.find is not a function
- 原因：升级至异步存储后，多个组件仍以同步方式调用 `storage.get(...)`，拿到的是 Promise 而非数组。
- 修复点 1（practiceRecordModal）
  - 文件：`js/components/practiceRecordModal.js`
  - 导出单条记录：将 `exportSingle(recordId)` 改为 `async exportSingle(recordId)`，并将内部 `window.storage.get(...)` 两处改为 `await window.storage.get('practice_records', [])` 与 `await window.storage.get('exam_index', [])`。
  - 兼容方法 showById：将 `window.practiceRecordModal.showById = function(recordId) { ... }` 改为 `async function(recordId) { ... }`，并改为 `const records = (window.storage ? (await window.storage.get('practice_records', [])) : []) || [];`。
- 修复点 2（practiceHistoryEnhancer）
  - 文件：`js/components/practiceHistoryEnhancer.js`
  - 将 `showRecordDetails(recordId)` 改为 `async showRecordDetails(recordId)`，并把两处 `window.storage.get('practice_records', [])` 改为 `await window.storage.get('practice_records', [])`。
- 验证：
  - 刷新后进入"练习记录"页，点击任意记录标题或"详情"应可正常弹出详情，不再出现 `find is not a function`。

七、浏览器兼容性检查
- 推荐浏览器版本：
  - Chrome 90+（最佳兼容性，支持 ES6+ 模块和 async/await）
  - Firefox 88+（支持现代 JavaScript 特性）
  - Edge 90+（基于 Chromium，支持本地 file:// 协议）
- 禁用安全策略命令（仅用于本地开发测试）：
  - Chrome：`chrome.exe --disable-web-security --user-data-dir="C:\temp\chrome_dev" --allow-file-access-from-files`
  - Firefox：`firefox.exe -profile "C:\temp\firefox_dev" -no-remote`
  - Edge：`msedge.exe --disable-web-security --user-data-dir="C:\temp\edge_dev"`
- 注意：生产环境请勿使用禁用安全策略的浏览器，file:// 协议在现代浏览器中受限，建议使用本地服务器（如 http-server）运行。

八、数据脚本加载失败处理
- 诊断步骤：
  - 打开开发者工具（F12）→ Console 标签页
  - 刷新页面，检查是否有 "Failed to load resource" 或 "Script error" 相关错误
  - 验证数据脚本路径：`index.html:291-292` 中的 `<script src="assets/scripts/complete-exam-data.js"></script>` 和 `<script src="assets/scripts/listening-exam-data.js"></script>`
- 手动加载指导：
  - 确认文件存在：`assets/scripts/complete-exam-data.js` 和 `assets/scripts/listening-exam-data.js`
  - 检查文件内容：确保 `window.completeExamIndex` 和 `window.listeningExamIndex` 被正确定义
  - 临时验证：在 Console 执行 `console.log(window.completeExamIndex); console.log(window.listeningExamIndex);`
  - 若加载失败，尝试绝对路径：修改 index.html 中的 script src 为绝对路径（如 `file:///C:/path/to/project/assets/scripts/...`）
- 常见原因：浏览器安全策略阻止本地文件加载，或文件路径错误。

九、回滚指南
- 恢复原始代码：
  - 如果使用 Git：`git checkout HEAD~1 -- js/app.js js/main.js js/core/practiceRecorder.js js/components/practiceRecordModal.js js/components/practiceHistoryEnhancer.js`
  - 手动恢复：从备份文件或版本控制系统恢复上述文件的原始版本
- 清空缓存步骤：
  - 浏览器缓存：开发者工具 → Application → Storage → Local Storage → 清除所有
  - 控制台执行：`localStorage.clear(); sessionStorage.clear();`
  - 强制刷新：Ctrl+F5 或 Cmd+Shift+R
- 验证回滚：确认所有修改点已恢复，页面功能回到修复前状态。

十、更新日志
- 2025-09-21：修复 await 语法错误（js/app.js:974）
- 2025-09-21：修复练习记录异步存储兼容性（js/components/practiceRecordModal.js, js/components/practiceHistoryEnhancer.js）
- 2025-09-21：修正题库路径映射（js/main.js:505-514）
- 2025-09-21：修复活动会话常量重赋值错误（js/core/practiceRecorder.js:46）
- 2025-09-21：添加浏览器兼容性检查章节
- 2025-09-21：添加数据脚本加载失败处理章节
- 2025-09-21：扩展控制台输出示例和代码片段
- 2025-09-21：添加回滚指南和更新日志

十一、常见错误排查
- 调试步骤：
  1. 打开开发者工具（F12）
  2. 切换到 Console 标签页，清除现有日志
  3. 刷新页面，观察错误信息
  4. 检查 Network 标签页，确认所有资源加载成功（状态 200）
  5. 在 Console 执行关键验证命令：
     - `Array.isArray(window.examIndex) && window.examIndex.length > 0`
     - `Array.isArray(window.practiceRecords) && window.practiceRecords.length >= 0`
     - `typeof window.storage !== 'undefined'`
  6. 若有错误，复制完整错误信息到搜索引擎或技术论坛寻求帮助
- 常见问题：
  - "Uncaught ReferenceError: window is not defined"：确保脚本在 DOM 加载后执行
  - "CORS error"：本地 file:// 协议限制，使用本地服务器运行
  - "Module not found"：检查文件路径和大小写
  - "Promise rejected"：检查异步操作的错误处理

