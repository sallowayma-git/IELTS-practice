# UPGRADE v1.1.5 修复指南（基于现有代码）

适用问题（v1.1.0 升级后）：
- 总览界面未显示“阅读/听力”卡片
- 题库浏览界面显示“未找到匹配的题目”或一直显示加载中
- 练习记录页面显示“暂无任何练习记录”

约束与原则
- 不新增脚本文件、不更改数据格式或字段名
- 仅做必要的最小改动；所有步骤均以当前仓库代码为依据
- 核验点均可通过控制台或现有函数验证

参考文档
- assets/developer wiki/CHANGELOG.md（异步存储升级说明）
- assets/developer wiki/HANDOFF_v1.1.5.md（交接要点）
- assets/developer wiki/wiki.md（系统与数据流概览）

一、数据脚本与加载顺序核验（必须先通过）
- 脚本顺序（index.html）
  - 数据：index.html:291, index.html:292
    - `assets/scripts/complete-exam-data.js`
    - `assets/scripts/listening-exam-data.js`
  - 工具与核心：index.html:296（`js/utils/storage.js`）等
  - 业务入口：index.html:323（`js/main.js`），index.html:327（`js/app.js`，最后加载）
- 控制台验证（任一页面执行）
  - `Array.isArray(window.completeExamIndex)` 应为 true
  - `Array.isArray(window.listeningExamIndex)` 应为 true
  - 两者 `length` 应大于 0
- 如数据脚本未生效，请检查以下事实：
  - 顶层必须是有效赋值：`window.completeExamIndex = [ {...}, ... ];` 与 `window.listeningExamIndex = [ {...}, ... ];`
  - 不为阅读项添加 `type`（由构建索引时注入）

二、题库索引构建（js/main.js）
- 函数：`async function loadLibrary(forceReload = false)`（js/main.js:125）
  - 读取当前活动配置键并获取缓存：js/main.js:127-131
    - `const activeConfigKey = await getActiveLibraryConfigurationKey();`（js/main.js:127, js/main.js:668-670）
    - `let cachedData = await storage.get(activeConfigKey);`（js/main.js:128）
  - 仅在缓存为“非空数组”时直接使用：js/main.js:131-143
    - 命中后调用 `finishLibraryLoading(startTime)` 并返回（js/main.js:142-143）
  - 未命中缓存时，从脚本重建索引：js/main.js:146-170
    - 阅读：将 `window.completeExamIndex` 映射为 `type: 'reading'`（js/main.js:148-151）
    - 听力：直接使用 `window.listeningExamIndex`（已含 `type: 'listening'`，js/main.js:153-156）
    - 两者皆空时不写入空索引，直接完成加载：js/main.js:158-162
    - 合并并缓存：`examIndex = [...readingExams, ...listeningExams];`（js/main.js:164-169）
- 加载完成钩子：`finishLibraryLoading(startTime)`（js/main.js:176-181）
  - `window.examIndex = examIndex;`（js/main.js:178）
  - `window.dispatchEvent(new CustomEvent('examIndexLoaded'));`（js/main.js:181）

三、总览卡片渲染（阅读/听力）
- 逻辑：`updateOverview()`（js/main.js:186-226）
  - 基于 `examIndex.filter(e => e.type === 'reading' | 'listening')` 计算阅读/听力与 P 级别计数
  - 容器：`#category-overview`（index.html:206）
- 若卡片未显示，请逐项核验：
  - `examIndex` 是否为非空数组：`Array.isArray(window.examIndex)` && `window.examIndex.length > 0`
  - 阅读数据是否有 `type: 'reading'`：由 js/main.js:150 注入
  - 听力数据是否存在：由 `assets/scripts/listening-exam-data.js` 提供（含 `type: 'listening'`）

四、题库浏览页面（未找到匹配的题目/一直加载）
- 列表刷新：`loadExamList()`（js/main.js:411-424）
  - 默认使用 `examIndex`，并按 `currentExamType/currentCategory` 过滤
- 渲染与 Loading：`displayExams(exams)`（js/main.js:426-439）
  - 当 `exams.length === 0` 显示“未找到匹配的题目”（js/main.js:430-432）
  - 渲染后隐藏加载指示（js/main.js:436-438）
- 数据就绪事件绑定：`examIndexLoaded`（js/main.js:1495）
  - 触发后调用 `loadExamList()` 并隐藏 spinner（参见文件末尾事件监听）
- 排查顺序：
  - `Array.isArray(window.examIndex)` 与 `window.examIndex.length` 是否大于 0
  - `currentExamType/currentCategory` 是否为 `'all'`（默认值：js/main.js:11-13）
  - 手动切换过滤按钮后是否出现数据（index.html:218-222 绑定 `filterByType(...)`）

五、练习记录页面（暂无任何练习记录）
- 记录同步：`syncPracticeRecords()`（js/main.js:70-124）
  - 优先从 `PracticeRecorder.getPracticeRecords()` 获取（若可用），否则回退 `await storage.get('practice_records', [])`
  - 设置 `window.practiceRecords = records;` 并调用 `updatePracticeView()`（js/main.js:116-123）
- 视图渲染：`updatePracticeView()`（js/main.js:308-375）
  - 首行已将记录源限定为真实数据或未标注：`(r.dataSource === 'real' || r.dataSource === undefined)`（js/main.js:309）
  - 当无记录时会显示“暂无任何练习记录”（js/main.js:364-367）
- 已知代码缺陷（需修复后再测）：
  - `js/core/practiceRecorder.js:46` 处将 `const storedSessions` 重新赋值，导致 “Assignment to constant variable”
    - 现状代码：
      - `const storedSessions = storage.get('active_sessions', []);`
      - 非数组时：`storedSessions = [];`（会抛错）
    - 修复方案（二选一，保持最小改动）：
      - 方案 A：改为 `let storedSessions = await storage.get('active_sessions', []);`，并保留后续归一化
      - 方案 B：`const raw = await storage.get('active_sessions', []); const storedSessions = Array.isArray(raw) ? raw : [];`
- 验证步骤：
  - 控制台执行：`await storage.get('practice_records', [])` 应返回数组；完成一次练习后长度递增
  - 页面统计卡片（js/main.js:342-345）应显示非 0 的“已练习题数/平均正确率/学习时长/连续天数”

六、缓存清理与重建（必要时）
- 清理索引相关键后强制重建（控制台执行）：
  - `await storage.remove('exam_index');`
  - `await storage.remove('active_exam_index_key');`
  - `await storage.set('exam_index_configurations', []);`
- 刷新页面；观察 `examIndexLoaded` 是否触发、浏览页列表是否渲染

七、验收清单（全部必过）
- 总览卡片
  - 阅读区：P1/P2/P3 计数展示；听力区：P3/P4 计数展示（js/main.js:186-226）
- 题库浏览
  - 默认“全部”过滤下列表非空（js/main.js:411-439）
  - 切换“阅读/听力”与 P 类别后仍有结果
  - 搜索关键字可匹配到标题（js/main.js:969-1001）
- 练习记录
  - 完成一次练习后，记录计数 +1 且列表出现（js/main.js:364-375）
  - 不出现 “filter is not a function” 或 “Assignment to constant variable” 错误

附：相关文件与定位
- 数据脚本：
  - `assets/scripts/complete-exam-data.js`（阅读数据，顶层 `window.completeExamIndex`）
  - `assets/scripts/listening-exam-data.js`（听力数据，顶层 `window.listeningExamIndex`）
- 页面结构：
  - `index.html:291-292` 数据脚本；`index.html:323` 加载 `js/main.js`；`index.html:327` 加载 `js/app.js`
- 核心逻辑：
  - `js/main.js:125-170` 题库索引构建；`js/main.js:176-181` 完成事件；`js/main.js:186-226` 总览渲染；`js/main.js:411-439` 列表渲染；`js/main.js:969-1001` 搜索
- 练习记录：
  - `js/main.js:70-124` 记录同步；`js/main.js:308-375` 记录渲染
  - `js/core/practiceRecorder.js:46` const 重赋值缺陷（需按“五、已知代码缺陷”修复）

说明
- 本文档仅依据当前仓库代码与路径撰写；未做任何推测或虚构改动
- 若某一步与本地表现不符，请提供具体控制台报错与相关函数代码片段，以便补充最小化修复指引

