# 阅读/写作 Vue 一体化重构规划

Based on current information, my understanding is: 阅读链路要从 legacy 页面、随机 DOM 状态机、父子窗口桥和散落 API 里拔出来，作为 Vue 主应用的一等业务能力，和写作评测、AI 教练、历史记录、设置管理合成一个 AI native 练习工作台。

## 【核心判断】

✅ 值得做，而且应该按重构处理，不应该继续局部修。

当前坏味道不是某个页面丑，也不是某个 API 命名差，而是数据结构错了：写作有服务端 session、SSE、SQLite；阅读有静态题库脚本、页面内作答状态、localStorage 记录、父窗口 postMessage、另一个 AI coach 请求链。两个世界各自保存状态，UI 被迫到处拼上下文，这就是兼容逻辑乱飞的根因。

## 【五步拷问】

1. 这是个真问题吗？
   是。历史实现里 `electron/main.js` 同时维护 `loadLegacyPage()` 和 `loadWritingPage()`，`NavBar.vue` 还有 `openLegacy()`，产品和代码都是两个 renderer。当前 Slice 10 已删除这些产品级入口，剩余 `index.html` 只作为启动恢复、听力迁移和显式 legacy 回归表面存在。

2. 有更简单的方法吗？
   有。先统一 `PracticeSession` 数据模型，再让阅读和写作只是同一 session 下的不同 activity，不要继续加 `readingMode`、`writingMode` 这种补丁字段。

3. 会破坏什么吗？
   会碰到旧阅读、听力套题、练习历史、localStorage 记录、写作 SQLite、AI provider 设置和 E2E。必须分阶段适配，不能一刀砍 legacy。

4. 复杂度还能减半吗？
   能。把 DOM 采集、结果计算、AI coach payload、历史保存拆成纯数据服务后，`unifiedReadingPage.js` 和 `practice-page-enhancer.js` 这类大状态机可以逐步退场。

5. 方案是否匹配真实痛点？
   匹配。用户明确指出阅读链路过重、设置/API 乱飞、两个界面切换是痛点。重构范围必须覆盖入口、数据、API、UI、测试，不是只做 Vue 页面。

## 【关键洞察】

### 数据结构

现状有三套核心数据：

- 写作：`task_type/topic/content/sessionId/evaluation/essay`，服务端拥有生命周期，SQLite 持久化。
- 阅读：`examId/dataset/answers/answerComparison/scoreInfo/coachTranscript`，页面拥有生命周期，localStorage 持久化。
- AI：写作评测用 `/api/writing/evaluations`，阅读教练用 `/api/reading/assistant/query`，设置共用部分 provider config，但 payload 由不同 UI 拼出来。

目标只保留一套业务模型：

```ts
type PracticeActivity = 'reading' | 'writing'

interface PracticeAsset {
  id: string
  activity: PracticeActivity
  title: string
  source: 'reading_exam' | 'writing_topic' | 'freeform'
  category?: string
  difficulty?: string | number
  payloadRef?: string
}

interface PracticeSession {
  id: string
  activity: PracticeActivity
  assetId: string | null
  status: 'draft' | 'active' | 'submitted' | 'reviewing' | 'completed' | 'cancelled' | 'failed'
  createdAt: string
  updatedAt: string
  attempt: PracticeAttempt
  result: PracticeResult | null
  coach: PracticeCoachState
  settings: PracticeSessionSettings
}
```

阅读和写作的差异只能落在 `PracticeAttempt` 的 typed payload 里：

```ts
type PracticeAttempt =
  | {
      activity: 'reading'
      answers: Record<string, string | string[]>
      highlights: HighlightRecord[]
      markedQuestions: string[]
      questionTimeline: QuestionTimelineEntry[]
    }
  | {
      activity: 'writing'
      taskType: 'task1' | 'task2'
      topicText: string
      content: string
      wordCount: number
    }
```

这比现在的 `state.submitted`、`lastResults`、`readingCoachSnapshot`、`simulationCtx`、`reviewMode` 混在一个对象里干净得多。

### 复杂度

最糟糕的复杂度不是行数，而是生命周期分裂：

- `apps/writing-vue/src/main.js` 只认识写作评测 session。
- `server/src/routes/reading.ts` 只认识阅读 AI query，不认识阅读练习 session。
- `js/runtime/unifiedReadingPage.js` 自己生成结果、请求 coach、记录 transcript、处理 review/suite/simulation。
- `js/core/practiceRecorder.js` 再把结果二次 normalize 后写入旧存储。

这是四个中心，不是一个系统。

### 风险点

- 旧套题 E2E 从 `index.html?test_env=1` 起跑，不能立刻删 legacy。
- 阅读记录存在 localStorage/repository 体系，写作记录存在 SQLite，历史页统一前必须有迁移策略。
- 阅读 AI coach 当前强制提交后可用，统一 AI native 后要改成策略控制：做题阶段只给 hint/evidence direction，提交后才给答案和错因。
- 听力仍依赖 legacy 练习系统。阅读重构不能误杀听力。

## 【Linus式方案】

严格按这个顺序做：

1. 简化数据结构：先落 `PracticeSession` / `PracticeAsset` / `PracticeResult`。
2. 消除特殊情况：产品入口已删除 `openLegacy/openWriting`；下一步继续把父窗口 coach bridge、阅读提交后硬锁、写作专用 draft key 逐步替换为 session 状态。
3. 保证零破坏：legacy 不先删，先适配、双写、验证，再切默认入口。

## 当前链路审计

### Electron 入口

- `electron/main.js`
  - `loadPracticeShellPage(route)` 加载 `dist/writing/index.html#<route>`，这是统一 Practice Shell 的唯一产品入口。
  - `loadBootRecoveryPage()` 在 Vue 构建缺失时加载 `index.html`，仅用于启动恢复，不是产品 fallback。
  - IPC 只保留 `navigate-to-practice-route`，通过 allowlist 限定内部 Vue route。
- `electron/preload.js`
  - 暴露 `openPracticeRoute()` / `openPracticeReading()` / `getLocalApiInfo()`。
  - 不再暴露 `openWriting()` 或 `openLegacy()`。

结论：两顶层页面切换已经退场。剩余工作不是再兼容入口，而是把听力、诊断、forced legacy、旧回放工具从 `index.html` 和 `reading-practice-unified.html` 中继续拆出。

### Vue 写作岛

- `apps/writing-vue/src/main.js`
  - 只有 Compose、Evaluating、Result、Topics、History、Settings。
  - 路由守卫围绕写作 evaluation session。
- `apps/writing-vue/src/api/client.js`
  - 只封装 writing/configs/prompts/topics/essays/settings/upload。
  - SSE 只连 `/api/writing/evaluations/:sessionId/stream`。
- `apps/writing-vue/src/composables/useDraft.js`
  - 草稿 key 和字段都是写作专用。
- `apps/writing-vue/src/components/NavBar.vue`
  - 已切为 Practice Studio 产品导航，不再提供 legacy standby 入口。

结论：这个应用已经成为 Practice Vue App 的产品入口。短期保留 `dist/writing` 目录名只是构建兼容，不代表产品边界仍是 writing island。

### 阅读 legacy 链路

- `assets/generated/reading-exams/*.js`
  - 注册式 JS 数据，包含 passage HTML、questionGroups、answerKey、questionOrder、questionDisplayMap。
- `js/runtime/unifiedReadingPage.js`
  - 页面内状态机，负责加载题、答题、计时、结果、AI coach、review、suite、simulation。
- `server/src/routes/reading.ts`
  - 只有 assistant query/stream，不是阅读练习 API。
- `server/src/lib/reading/coach-service.ts`
  - 有价值：route/intent/retrieval/prompt/provider/cache。
  - 坏点：强依赖 `examId + attemptContext`，且硬锁提交后才能用 coach。
- `js/core/practiceRecorder.js`
  - 旧练习记录生命周期和 localStorage 持久化。

结论：阅读 AI 内核可以保留，阅读 UI/状态/结果/记录链必须重做。

## 目标架构

### Renderer

Vue 主应用变成一个练习工作台：

```txt
PracticeApp
├─ AppShell
│  ├─ NavBar
│  ├─ LibraryPanel
│  ├─ SessionWorkspace
│  └─ GlobalCoachDock
├─ routes
│  ├─ /                         -> Dashboard / Continue
│  ├─ /library                  -> Reading exams + Writing topics
│  ├─ /practice/new             -> Activity picker
│  ├─ /practice/:sessionId      -> Unified session shell
│  ├─ /practice/:sessionId/result
│  ├─ /history
│  └─ /settings
└─ composables
   ├─ usePracticeSession
   ├─ usePracticeDraft
   ├─ usePracticeCoach
   ├─ usePracticeAssets
   └─ usePracticeStream
```

阅读和写作共用：

- session header
- draft/recovery
- submit/cancel/retry
- coach panel
- result/review
- history entry
- provider/settings access

阅读独有组件：

- `ReadingPassagePane`
- `ReadingQuestionGroup`
- `ReadingAnswerControls`
- `ReadingQuestionNavigator`
- `ReadingEvidenceHighlighter`
- `ReadingReviewPanel`

写作独有组件：

- `WritingPromptPanel`
- `WritingEditor`
- `WritingScorePanel`
- `WritingSentenceReview`

不要把 reading 分支塞进现有 `ComposePage.vue`。正确做法是先抽 `SessionWorkspace`，再让 writing 成为其中一种 activity。

### API

新增统一 practice API，旧 writing/reading API 先保留：

```txt
GET    /api/practice/assets?activity=reading|writing
GET    /api/practice/assets/:assetId
POST   /api/practice/sessions
GET    /api/practice/sessions/:sessionId
PATCH  /api/practice/sessions/:sessionId/attempt
POST   /api/practice/sessions/:sessionId/submit
DELETE /api/practice/sessions/:sessionId
GET    /api/practice/sessions/:sessionId/stream
POST   /api/practice/sessions/:sessionId/coach
GET    /api/practice/history
POST   /api/practice/history/import-legacy
```

服务层结构：

```txt
server/src/lib/practice/
├─ contracts.ts
├─ service.ts
├─ assets.ts
├─ sessions.ts
├─ scoring/
│  ├─ reading-score.ts
│  └─ writing-evaluation-adapter.ts
├─ coach/
│  ├─ practice-coach.ts
│  └─ reading-coach-adapter.ts
└─ legacy/
   └─ practice-record-importer.ts
```

写作 adapter 复用现有 `EvaluateService`，不要重写评分。阅读 adapter 复用现有 generated exam loader 和 reading coach 内核，但提交、结果和 coach payload 都走 `PracticeSession`。

### 数据持久化

SQLite 增加统一表，不把静态题库全文塞进数据库：

```sql
practice_sessions(
  id TEXT PRIMARY KEY,
  activity TEXT NOT NULL,
  asset_id TEXT,
  status TEXT NOT NULL,
  attempt_json TEXT NOT NULL,
  result_json TEXT,
  settings_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
)

practice_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)

practice_reading_suite_sessions(
  session_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  flow_mode TEXT NOT NULL,
  frequency_scope TEXT NOT NULL,
  current_index INTEGER NOT NULL,
  total_passages INTEGER NOT NULL,
  session_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
)

legacy_practice_record_migrations(
  legacy_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  migrated_at TEXT NOT NULL
)
```

阅读题库仍来自 `assets/generated/reading-exams/manifest.js` 和对应 data 文件，阅读解析来自 `assets/generated/reading-explanations/*.js`。运行时现在只把这些文件当受限 JSON 数据容器：读取 `__READING_EXAM_MANIFEST__ = {...}`、`__READING_EXAM_DATA__.register("key", {...})`、`__READING_EXPLANATION_DATA__.register("key", {...})` 的对象字面量，再用 shared parser + `JSON.parse` 解析。Practice asset loading 和 ReadingCoach retrieval 都复用 `server/src/lib/shared/reading-generated-data.ts`；后续可以把生成器直接改成 JSON 输出。

### AI Coach 策略

废掉 `coach_locked_until_submit` 这种硬特殊情况，改成策略：

```ts
interface CoachPolicy {
  phase: 'practice' | 'review'
  allowAnswerKey: boolean
  allowOfficialExplanation: boolean
  allowedActions: string[]
}
```

做题阶段：

- 可以问定位、同义替换、句子理解、提示。
- retrieval 禁止 answer_key / official explanation。
- prompt 禁止直接泄露答案。

提交后：

- 允许错因复盘、答案解释、同类题推荐。
- retrieval 可以使用 answer_key / explanation / selectedAnswers。

这样不是靠 UI `if submitted` 到处拦，而是让数据访问策略决定上下文。

## 迁移切片

### Slice 0: 合同冻结

目标：先定义合同，不动行为。

- [x] 新增 `server/src/lib/practice/contracts.ts`。
- [x] 新增 `server/src/lib/practice/service.ts` 和 `server/src/routes/practice.ts`。
- [x] 新增 `apps/writing-vue/src/api/practice-client.js`，暂时复用现有本地 API request helper。
- [x] 写 contract tests，验证 assets/session/coach facade shape。

验收：

- [x] 旧写作流程不变。
- [x] 旧阅读套题流程不变。
- [x] `node developer/tests/js/practiceApiFacade.test.js`
- [x] `npm run build:writing`
- [x] `python3 developer/tests/ci/run_static_suite.py`
- [x] `python3 developer/tests/e2e/suite_practice_flow.py`

备注：本机没有 `python` 命令，原始 `python developer/tests/ci/run_static_suite.py` 失败于 shell 层；同一脚本用 `python3` 通过。

### Slice 1: Vue 主壳升级

目标：把写作岛改成 practice shell，但仍只承载写作。

- `NavBar` 改品牌和导航：写作不再是应用名。
- 新增 `/practice/:sessionId` shell。
- `ComposePage` 拆成 `WritingPromptPanel` + `WritingEditor` + `SessionActions`。
- `useDraft` 改成 `usePracticeDraft(sessionDraftKey, snapshot)`，旧 key 保留迁移读取。

验收：

- 写作提交、评测、结果、历史、设置全通。
- 不再在 Vue 导航上展示 `openLegacy()` 作为主动作。

### Slice 2: Practice API facade

目标：统一 API 入口，行为仍由旧服务执行。

- 新增 `/api/practice/sessions`。
- writing session submit 内部调用现有 `WritingEvaluationService`。
- practice stream 复用 writing SSE event，统一事件名。
- settings/configs/prompts 暂时继续走 `/api/configs` 等，但 Vue 只从一个 client facade 导出。

验收：

- Vue 代码不直接调用 `/api/writing`，而是调用 practice client。
- 旧 `/api/writing` 仍保留。

### Slice 3: 阅读资产进入 Vue

目标：Vue 能浏览并打开阅读题，不提交。

- 新增 reading asset repository，读取 manifest 和 exam data。
- Vue `/library` 列出 reading exams 和 writing topics。
- Vue session shell 渲染 passage/questionGroups。
- Answer controls 只修改 `PracticeSession.attempt.answers`。

验收：

- 打开 p1/p2/p3 阅读题，题干、文章、题型控件可渲染。
- 不依赖 `reading-practice-unified.html`。
- 不保存正式历史。

### Slice 4: 阅读提交和结果

目标：阅读结果计算从 DOM 状态机移到纯数据服务。

- 抽出 answer matching，避免 Vue 组件自己算分。
- `POST /api/practice/sessions/:id/submit` 对 reading 返回 `PracticeResult`。
- 保存到 SQLite `practice_sessions`。
- Vue result 页面展示 score、answerComparison、questionTypePerformance。

验收：

- 同一套题用旧页面和新 Vue 得分一致。
- 新增 deterministic tests 覆盖 single choice、multi choice、TFNG、completion、matching。

### Slice 5: 阅读 AI Coach 融合

目标：coach 成为 session 能力，不再是 floating widget + bridge。

- `POST /api/practice/sessions/:id/coach` 使用 session 生成上下文。
- 改造 ReadingCoachService 支持 `CoachPolicy`。
- Vue `CoachPanel` 用统一 transcript 和 event model。
- 删除父窗口 coach bridge 在新路径中的使用。

验收：

- 做题阶段可请求 hint，不泄露答案。
- 提交后可复盘错题，能带 wrongQuestions 和 selectedAnswers。
- coach transcript 写入 session/result。

### Slice 6: 历史记录统一和迁移

目标：写作 essay history 与旧 reading practice records 合为一个 history。

- Vue 启动时读取同源 localStorage 旧 `practice_records`。
- 调 `/api/practice/history/import-legacy` 导入 SQLite。
- `HistoryPage` 改用 practice history endpoint。
- 写作 `essays` 作为 practice history 的一种投影，短期保留 essays 表。

验收：

- 旧阅读记录可见。
- 新阅读记录可见。
- 写作记录可见。
- 不重复导入同一 legacy record。

### Slice 7: 切默认入口

目标：Vue 成为 Electron 默认入口。

- `electron/main.js` 默认加载 Vue dist。已完成：`createMainWindow()` 现在调用 `loadPracticeShellPage()`；缺 Vue 构建时才调用 `loadBootRecoveryPage()` 打开 `index.html`。
- legacy 首页改为 boot recovery / listening migration / explicit regression surface，不再是主产品。
- `openWriting/openLegacy` 已从 preload 移除；`navigate-to-writing` / `navigate-to-legacy` 已从 main 移除；旧 More 工具写作入口改为 `electronAPI.openPracticeRoute('/writing')`。
- legacy 备用入口中的普通单篇阅读不再打开 `reading-practice-unified.html`，而是通过 `navigate-to-practice-route` 回到 Vue `/reading/:assetId`；套题 session 已迁到 Vue Practice API，听力和部分旧诊断/回看路径仍保留 legacy fallback。
- E2E 新增 Vue 阅读主流程，再切默认。已完成：Vue 阅读 E2E、静态套件和 legacy suite E2E 均通过。
- 新增 `/api/practice/migration-status`，把 Vue-primary 与 legacy-fallback 能力矩阵变成可测试契约。
- Vue Practice Library 读取同一迁移矩阵并展示默认入口、legacy 删除状态与 capability 边界。
- Vue `main.js` 派发 `app-runtime-ready`，保证 Electron updater boot-health 不因默认入口切换而误判。

验收：

- 应用启动即进入统一 Practice Vue App。已由 `developer/tests/js/practiceVueShell.test.js` 锁定。
- 旧 `suite_practice_flow.py` 仍能跑 legacy fallback，作为删除前回归护栏。已通过 `python3 developer/tests/e2e/suite_practice_flow.py`。
- 新 Vue reading E2E 跑通。已通过 `python3 developer/tests/e2e/practice_reading_vue_flow.py`。
- 新 Vue reading suite E2E 跑通。已通过 `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py`。
- 迁移矩阵 API 锁定：`single-reading-practice` / `suite-reading-practice` / `writing-practice` 是 Vue primary；`listening-practice` 是 legacy fallback。
- 默认入口切换后仍通过 `python3 developer/tests/ci/run_static_suite.py`。

### Slice 8: Vue 阅读套题 Session

目标：把旧套题窗口编排里的真实业务状态移入 Practice API，并由 Vue 承载套题进度与逐篇提交。

- 新增 `ReadingSuiteSession`：`sessionId`、`flowMode`、`frequencyScope`、`sequence`、`currentIndex`、`aggregate`、`status`。
- 新增 `/api/practice/reading-suite`、`/api/practice/reading-suite/:sessionId`、`/api/practice/reading-suite/:sessionId/passages/:assetId`。
- `server/src/lib/practice/reading-suite-sessions.ts` 负责 P1/P2/P3 抽题、顺序提交、乱序拒绝、每篇结果挂接和整套聚合。
- `PracticeReadingSuitePage.vue` 展示套题进度；`PracticeReadingPage.vue` 复用单篇阅读渲染与评分，通过 `suiteSessionId` 提交当前篇。
- Electron route allowlist 支持 `/reading-suite/:sessionId`。
- 迁移矩阵把 `suite-reading-practice` 标为 Vue primary；legacy suite window flow 仍作为回归护栏保留到最终删除。

验收：

- API lifecycle 覆盖创建、状态读取、乱序拒绝、P1/P2/P3 顺序提交和 aggregate completion。
- Vue static contract 覆盖 suite route、client、page、library entry、reading submit branch 和 Electron route guard。
- `practice_reading_suite_vue_flow.py` 覆盖创建套题、逐篇提交、返回进度和 3/3 聚合。
- 旧 `suite_practice_flow.py` 仍通过，证明 fallback 未被破坏。

### Slice 9: 残留旧阅读入口清理

目标：把已经有 Vue 等价物的旧入口改成 Vue 优先，而不是继续让 fallback 首页把用户带回旧 runtime。

- 旧首页 `js/presentation/app-actions.js` 的套题按钮现在先 POST `/api/practice/reading-suite` 创建 Vue suite，再通过 `electronAPI.openPracticeRoute('/reading-suite/:sessionId')` 进入 Vue Practice Shell。
- 明确迁移边界：`test_env=1`、`suite_test=1`、`ci=1` 是 legacy suite 回归入口；产品路径通过 Vue Practice API 和 Electron route IPC 进入 `/reading-suite/:sessionId`。
- 修正 Practice API envelope：旧首页 adapter 读取 `{ success, data }`，不再假设顶层 `sessionId`。
- 迁移矩阵新增 `legacyFallbackSurface`，把 Vue 主链路 `apiSurface` 和 legacy 回归护栏拆开。
- `suite-reading-practice` 的 Vue surface 包括 Practice API、Electron route IPC、旧首页 suite redirect、`PracticeReadingSuitePage.vue` 和 `PracticeReadingPage.vue`。
- `suitePracticeMixin.js` 与 `unifiedReadingPage.js` 只作为 legacy fallback surface 保留。
- 新增 `developer/tests/js/legacySuiteVueRoute.test.js` 并接入静态总套件，覆盖 Vue 优先、真实 API envelope 和显式 regression fallback。

验收：

- `node developer/tests/js/legacySuiteVueRoute.test.js` 通过。
- `node developer/tests/js/practiceApiFacade.test.js` 锁定迁移矩阵的 `legacyFallbackSurface`。
- `node developer/tests/js/practiceVueShell.test.js` 锁定旧首页 suite Vue route surface。
- `python3 developer/tests/ci/run_static_suite.py` 通过并包含 `Legacy 套题入口 Vue 路由契约测试`。
- `python3 developer/tests/e2e/suite_practice_flow.py` 仍通过，证明显式 legacy fallback 没被破坏。

### Slice 10: 删除旧阅读链路 readiness

目标：真正减重。删除只在 Vue replacement、入口迁移和回归门禁都稳定后执行。

当前已完成的清理：

- 删除产品级 `openWriting()`、`openLegacy()`、`navigate-to-writing`、`navigate-to-legacy`、`loadWritingPage()`、`loadLegacyPage()`。
- 删除死占位页 `electron/pages/writing.html`。
- 将 `index.html` 命名为 `loadBootRecoveryPage()` 的启动恢复目标，而不是 legacy 产品入口。
- 旧首页 More 写作入口改成 `electronAPI.openPracticeRoute('/writing')`。
- 迁移矩阵和静态测试禁止 standalone writing/legacy navigation IPC 回流。
- 修复 `simulation_roundtrip_restore_regression.py`：显式 legacy suite 回归现在预设 simulation mode 并等待 `SIMULATION_CONTEXT`。
- 清理 runtime asset 边界：`assets/scripts` 只保留运行时考试索引 JS 数据，阅读解析生成器迁到 `developer/tests/tools/reading-explanations/`，无人引用的批处理/监督脚本删除。
- 清理 E2E 死脚本：删除未被当前静态/E2E 调度的 `mock_eval_flow.py`、`mock_upload_flow.py`、`path_compatibility_playwright.py`，以及只服务该路径兼容脚本的私有 fixture HTML；保留仍被 E2E 使用的 `data-integrity-import-sample.json`。

删除前必须重新分桶：

- `listening migration`：听力仍是 legacy fallback，不能混进阅读删除判断。
- `reading diagnostic fallback`：诊断、PDF/manual、forced legacy、旧回放工具是否仍依赖 `reading-practice-unified.html`。
- `deletable reading compatibility`：已经被 Vue single-reading 和 Vue suite 覆盖的旧阅读入口与分支。
- `developer-only generation tooling`：生成解析数据的 Python 工具只能留在 `developer/tests/tools`，不能继续挂在 runtime `assets/scripts` 下。
- `test-only dead scripts`：不在 `run_static_suite.py`、`e2e_runner.py` 或 required E2E 调度图里的 mock/path 脚本应删除，不作为“覆盖率”陈列。

可删除/退场候选：

- `reading-practice-unified.html` 作为主入口。
- `js/runtime/unifiedReadingPage.js` 中已被 Vue single/suite 覆盖的阅读主链路。
- `js/practice-page-enhancer.js` 中已被 Practice API/History/Coach 覆盖的阅读结果与 coach 分支。
- 已删除的入口继续禁止回流：Vue 导航 `openLegacy`、Electron preload `openWriting/openLegacy`、main `navigate-to-writing/navigate-to-legacy`、旧 `electron/pages/writing.html`。
- 已删除的死脚本继续禁止回流：`generate_reading_explanations.py`、`run_reading_explanation_opencode_batch.py`、`run_reading_explanation_supervisor_pool.py`、`monitor_reading_supervisor.py`。
- 已删除的 E2E 死脚本继续禁止回流：`path_compatibility_playwright.py`、`mock_eval_flow.py`、`mock_upload_flow.py` 和它们的专用 path fixture HTML。
- 已删除的 Electron 调试脚本继续禁止回流：`electron/test_main.js`、`electron/test-electron-module.js`、`electron/test_api_runner.js`；`package.json` 不再保留对应 `electron/test_*` 打包排除规则。

### Slice 11: Practice Shared/Data 层压实

目标：把已经 Vue 化的阅读/写作主链路继续减重。不是再加兼容层，而是把重复的基础业务规则收进 Shared/Data 层，避免新的 Practice API 变成第二套散乱实现。

当前已完成：

- 新增 `server/src/lib/shared/http.ts`，统一 `createHttpError()`、`normalizePagination()`、`paginate()`。
- 新增 `server/src/lib/shared/json.ts`，统一 SQLite JSON 安全 parse/stringify。
- 新增 `server/src/lib/shared/response.ts`，统一 Practice route 的成功/错误 envelope。
- `PracticeService`、`reading-assets.ts`、`reading-suite-sessions.ts` 不再各自定义 `makeHttpError()`。
- `PracticeService` 和 `PracticeHistoryStore` 不再各自维护分页归一逻辑。
- `server/src/routes/practice.ts` 不再每个 route 手写 `{ success: true, data }` 和错误响应。
- `listAssets` / `listHistory` 的 over-limit 请求交给 Shared pagination clamp 到 200，不再由 route schema 提前硬拒绝。
- Slice 17 删除了 `PracticeHistoryStore` 的 legacy snapshot recovery。阅读 replay 只从 canonical `submission_json` 读取；初代 Electron 客户端没有旧数据兼容要求，坏 JSON 不再靠 shadow payload 抢救。
- Vue `practice-client.js` 用 `practicePath()` 统一 API path segment encoding，避免每个方法手写 `encodeURIComponent()`。
- 迁移矩阵新增 Shared/Data 层删除准则，静态测试锁住这条边界。

下一步真实风险：

- 已完成：`readingSuiteSessions` 内存 Map 已从 `PracticeService` 移除，suite active progress 由 `ReadingSuiteSessionStore` 写入 `practice_reading_suite_sessions`。产品路径不再把套题状态长期驻留在 server 进程内存。
- `createSession(reading)` 和 `submitReadingSuitePassage()` 仍有相似的 `loadPayload -> createSubmission -> saveHistory -> return` 骨架。下一步可抽 `persistReadingSubmission()`，但必须和 suite persistence 一起做，避免只移动代码、不改变数据边界。

验收：

- `node developer/tests/js/practiceApiFacade.test.js` 覆盖 pagination clamp、canonical `submission_json` history replay、迁移矩阵 Shared/Data 准则。
- `node developer/tests/js/practiceVueShell.test.js` 覆盖 shared route/http/json helper、history single-source guard、Vue `practicePath()`。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过，证明显式 legacy suite fallback 未被 Shared 层改动破坏。

### Slice 12: Product suite fallback 压实

目标：删除产品套题路径上的“Vue 失败就回 legacy”心理模型。重构不是兜底套兜底，产品路径坏了就暴露错误并修 Vue/API/route，不再把用户送回 `suitePracticeMixin`。

当前已完成：

- `js/presentation/app-actions.js` 的套题启动分成两条明确路径：
  - 产品路径：`startVueReadingSuite()` 创建 `/api/practice/reading-suite`，再调用 `electronAPI.openPracticeRoute('/reading-suite/:sessionId')`。
  - 回归路径：`startExplicitLegacySuiteRegression()` 只在 `test_env=1`、`suite_test=1`、`ci=1` 下调用 `suitePracticeMixin`。
- 删除 `tryStartVueReadingSuite() -> false -> startLegacySuite()` 这种隐式 fallback 控制流。
- 删除 `AppActions.continueSuitePractice` 和 `window.continueSuitePractice` 公开导出；当前产品 shell 没有引用这个旧桥，继续暴露只会扩大 legacy 表面。
- 迁移矩阵将 suite deletion gate 改为：产品 suite reading 是 Vue-only，Vue/API/route 失败只报错，不启动 legacy。
- `legacySuiteVueRoute.test.js` 覆盖 `test_env=1`、`suite_test=1`、`ci=1` 三个显式回归 flag，并覆盖 Practice API 失败和 Electron route 失败都不 fallback。
- `practiceVueShell.test.js` 增加源码边界：禁止 `tryStartVueReadingSuite`、`startedInVue`、`return startLegacySuite(selection)` 和公开 `continueSuitePractice` 回流。

验收：

- `node --check js/presentation/app-actions.js` 必须通过。
- `node developer/tests/js/legacySuiteVueRoute.test.js` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过并锁住 regression-only migration matrix。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过并锁住 product suite Vue-only 控制流。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过，证明显式 legacy suite regression 没被误删。

### Slice 13: Reading suite session 数据持久化

目标：把阅读套题会话从进程内临时 Map 压进 Practice 数据层。Electron 打包后的本地 server 可以重启，renderer 可以恢复，CPU/内存优化不能建立在“进程不死”的假设上。

当前已完成：

- 新增 `server/src/lib/practice/reading-suite-store.ts`，统一通过 shared SQLite/JSON helper 管理 suite session。
- `PracticeService` 删除 `readingSuiteSessions = new Map`，`createReadingSuite()` / `getReadingSuite()` / `submitReadingSuitePassage()` 全部通过 `ReadingSuiteSessionStore` 读写。
- `ReadingSuiteSessionStore` 有 SQLite 时只写 `practice_reading_suite_sessions`；内存 Map 只用于没有 SQLite 的测试/开发实例，不再污染 packaged Electron 产品路径。
- `electron/db/schema.sql` 与 `electron/db/migrations/20260209_phase06_schema.sql` 新增 `practice_reading_suite_sessions` 表和 `idx_practice_suite_status_updated_at` 索引。
- 迁移矩阵把 suite session 数据所有权写成删除准则：`PracticeService` 不允许再拥有 suite-session Map。
- `practiceApiFacade.test.js` 增加跨服务实例恢复测试：提交 P1 后重启服务可恢复 P2 active，提交 P2 后再次重启可恢复 P3 active。
- `practiceVueShell.test.js` 增加源码边界：store/schema/migration 必须存在，service 不能回到 suite Map。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过并覆盖 suite progress 跨实例恢复。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过并禁止 `readingSuiteSessions = new Map` 回流。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过，证明显式 legacy suite regression 没被数据层改动破坏。

### Slice 14: Practice reading asset 去 VM

目标：删除 Practice 阅读资产 hot path 的脚本执行。题库文件是数据，不是运行时代码入口；Electron 本地 server 不应该为了加载 passage/question/answer 去跑 `vm.runInNewContext`。

当前已完成：

- `server/src/lib/practice/reading-assets.ts` 删除 `node:vm` 依赖。
- `PracticeService` 不再自行执行 `manifest.js`，改为调用 `loadReadingManifest()`。
- `reading-assets.ts` 统一解析 manifest assignment 和 generated exam register payload。
- 解析器只接受可被 `JSON.parse` 消化的对象字面量；注释、尾逗号、函数、模板字符串都应该失败，而不是被 VM 兼容。
- 保留 manifest/register key mismatch guard，避免错题库脚本被静默当成另一个 asset。
- `practiceApiFacade.test.js` 用 `p2-low-051` 覆盖 minified wrapper，验证题号映射、答案键、正文和 radio/text interaction contract。
- `practiceVueShell.test.js` 和迁移矩阵锁定删除准则：Practice reading asset runtime 不得出现 `node:vm` 或 `runInNewContext`。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过并覆盖 minified generated wrapper。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过并禁止 VM 回流。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 15: Single reading session 数据所有权

目标：删除单篇阅读提交态的进程内真相源。阅读提交是同步完成并写入历史的业务事实，不是需要常驻 `PracticeService` 的 active job。

当前已完成：

- `PracticeService` 删除 `readingSessions = new Map`。
- `createSession(reading)` 和 `submitReadingSuitePassage()` 只写 `PracticeHistoryStore.saveReadingSubmission()`。
- `getSessionState(reading)` 与 reading coach session context 只从 `PracticeHistoryStore.getReadingSubmission()` 恢复提交态。
- `DELETE /api/practice/sessions/reading/:sessionId` 对已提交 reading 返回 `practice_session_not_cancellable`，不再删除进程缓存。
- `PracticeHistoryStore.upsert()` 在有 SQLite DB 时只写 `practice_history_records`；`memoryRecords` 只服务无 DB 测试/开发 fallback。
- 迁移矩阵记录 `practice_history_records submission_json-only session replay`，并把 `PracticeService does not own a reading-session Map` 写入删除准则。
- `practiceApiFacade.test.js` 覆盖已提交 reading session 删除返回 409 且 replay 不受影响。
- `practiceVueShell.test.js` 禁止 `readingSessions` / `this.readingSessions` 回流。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过并覆盖 submitted reading replay/cancel contract。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过并禁止 reading session Map 回流。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 16: ReadingCoach generated data 去 VM

目标：删除 AI 教练检索链路里的第二条 generated JS 执行路径。Coach 需要原始 exam/explanation payload 来构建 chunks，但不需要运行 IIFE wrapper。

当前已完成：

- 新增 `server/src/lib/shared/generated-json.ts`，统一 generated assignment/register JSON 容器解析。
- 新增 `server/src/lib/shared/reading-generated-data.ts`，集中定义 reading manifest、exam、explanation register payload parser。
- `server/src/lib/practice/reading-assets.ts` 改为复用 shared reading parser，不再自己维护第二套 balanced scanner。
- `server/src/lib/reading/coach-service.ts` 删除 `require('vm')` 和 `runInNewContext`，改用 `parseReadingExamDataSource()` / `parseReadingExplanationDataSource()` 读取原始 payload。
- Coach 保留 raw dataset 进入 `buildReadingChunks()`，没有错误地使用 UI 归一化后的 `loadReadingPracticePayload()`。
- 解析文件缺失 explanation 仍允许；存在但格式损坏或 key 不匹配会明确失败，避免坏数据被静默降级。
- `readingAnalysisService.test.js` 覆盖真实 `p1-high-01` exam/explanation parser，并锁定 Coach runtime 不得重新引入 VM。
- `practiceVueShell.test.js` 和迁移矩阵把 VM-free 删除准则扩展到 Practice + ReadingCoach runtime paths。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/js/readingAnalysisService.test.js` 必须通过并保持全量 question chunk 可解析。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过并禁止 Coach VM 回流。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过并保持 `/api/practice/coach` session context contract。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 17: Practice history payload 单源化

目标：把阅读历史记录压成一份 canonical submission。旧 `legacy_record_json`、`legacyRecord`、`realData`、`resultSnapshot` 影子结构不再作为兼容层存在，避免 Electron 本地 SQLite 体积、JSON parse/stringify 和数据所有权继续膨胀。

当前已完成：

- `ReadingPracticeSubmission` 新增 `readingCoachSnapshot` 与 `readingCoachTranscript`，AI coach 历史上下文直接写入 canonical submission。
- `PracticeHistoryRecord` 删除 `legacyRecord`，`PracticeHistoryStore` 删除 legacy record builder、answer list/correct map shadow builder 和 corrupt-submission legacy recovery。
- `PracticeHistoryStore.upsert()` 只写 `metadata_json` 与 `submission_json`；`rowToRecord()` 只解析 canonical submission。
- `PracticeHistoryStore.ensureSchema()` 若发现旧 shadow column，会重建 `practice_history_records`，不迁移旧数据。这里符合初代客户端无旧数据保留要求。
- `electron/db/schema.sql` 与 `electron/db/migrations/20260209_phase06_schema.sql` 删除 `legacy_record_json`。
- `PracticeService.getSessionState(reading)` 只返回 `submission.legacy` 小元数据，不返回大 legacy history record。
- `practiceApiFacade.test.js` 改为断言 replay、history detail、analysis artifacts 和 coach transcript 都来自 `submission`。
- `practiceVueShell.test.js` 加入静态边界：Practice history/schema/migration 新链路不得出现 legacy shadow 字段。
- `practice_reading_vue_flow.py` mock history/session response 去掉 `legacyRecord`，E2E 仍覆盖 submit、coach、history list/detail 与 replay。
- 迁移矩阵新增 canonical `submission_json` only deletion criterion。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过并覆盖 canonical history replay 与 coach transcript persistence。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过并禁止 legacy history shadow 回流。
- `npm run build:writing` 必须通过。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 18: Practice history list 摘要热路径压实

目标：把历史列表从 replay/detail 数据结构里切出来。列表页只需要摘要；如果列表接口还读取并解析完整 `submission_json`，那就是把答案、analysis artifacts、coach transcript 全部塞进 Electron 首页热路径，属于垃圾数据流。

当前已完成：

- 新增 `PracticeHistorySummary`，并让 `PracticeHistoryRecord` 只作为 detail/replay 合同扩展 summary。
- `PracticeHistoryStore.saveReadingSubmission()` 返回 summary；reading create/suite submit response 不再把完整 `submission` 复制进 `historyRecord`，顶层 `submission` 才是本次提交事实。
- `PracticeHistoryStore.list()` 的 memory fallback 通过 `summarizeHistoryRecord()` 投影 summary。
- SQLite history list SQL 从 `SELECT *` 改成显式 summary columns，排除 `submission_json`，避免列表页解析完整 reading submission。
- `getById()`、`getBySession()`、`getReadingSubmission()` 和 coach transcript persistence 继续读取 canonical `submission_json`，所以 replay/detail 不降级。
- Vue E2E mock 拆成 `readingHistoryRecords` summary list 和 `readingHistoryDetails` detail map，防止测试把大 payload 继续藏进 list。
- 迁移矩阵新增 `PracticeHistorySummary list without submission_json parsing`，静态/API 测试锁住该边界。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过，并断言 create response/history list row 没有 `submission`，detail/replay 仍有完整 canonical submission。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过，并锁住 summary contract、summary projection 和 SQLite list 不读 `submission_json`。
- `npm run build:writing` 必须通过。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 19: Practice reading asset payload cache 热路径压实

目标：把 generated reading exam 的读盘、解析、归一化从每次详情/提交调用中拿掉。题库是静态 asset，不是用户数据；同一 Electron 进程里反复读同一 JS wrapper 再 `JSON.parse`，这是热路径垃圾。

当前已完成：

- `reading-assets.ts` 成为 manifest 与 normalized payload 的单一 loader/cache owner。
- manifest cache 从 `PracticeService` 实例状态提升到模块级 loader cache，避免服务实例重建后重复读 manifest。
- generated exam payload 新增 32 条有界 LRU cache，cache key 绑定 `assetId`、`dataKey` 和 resolved script path。
- `PracticeService` 删除本地 `readingManifestCache`，只委托 `loadReadingManifest()`；数据缓存不再散在业务服务实例里。
- `practiceApiFacade.test.js` 新增缓存热路径测试：list 只加载 manifest；重复 detail 和 submit 同一 asset 不增加 payload cache；扫过上限资产后 cache 仍不超过 32。
- `practiceVueShell.test.js` 锁定 loader-level cache ownership、cache bound 和 `PracticeService` 不再拥有 manifest cache。
- 迁移矩阵新增 `server/src/lib/practice/reading-assets.ts bounded payload cache` 与 bounded loader cache 删除标准。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过，并覆盖 repeated detail/submit cache reuse 与 cache bound。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过，并禁止 `PracticeService` 本地 manifest cache 回流。
- `npm run build:writing` 必须通过。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 20: ReadingCoach cache bound / Shared cache 原语

目标：把 AI coach 热路径里的无界进程缓存压实。`ReadingCoachService` 的 generated exam bundle 和 query response 都会在 Electron 本地 server 生命周期里增长，继续用裸 `Map` 是垃圾数据结构。

当前已完成：

- 新增 `server/src/lib/shared/cache.ts`，提供 `touchCacheEntry()` 和 `setBoundedCacheEntry()` 两个 LRU/有界写入原语。
- `server/src/lib/practice/reading-assets.ts` 改为复用 shared cache helper，删除第二套本地 LRU 逻辑。
- `server/src/lib/reading/coach-service.ts` 的 `examBundleCache` 固定为 12 条 LRU，query cache 固定为 64 条 LRU。
- query cache 保留 5 分钟 TTL，但写入前清理过期项，并在超限时淘汰最老 entry。
- exam bundle cache 命中会刷新 LRU；超限后重新加载被淘汰题库仍能保留完整 retrieval chunks。
- 迁移矩阵新增 `server/src/lib/reading/coach-service.ts bounded coach caches`，并把 bounded coach cache 写入 legacy deletion criteria。
- `readingAnalysisService.test.js` 增加 query cache 命中/淘汰、exam bundle cache 复用/淘汰测试。
- `practiceVueShell.test.js` 锁定 shared cache 原语、Practice asset loader 复用 shared helper、ReadingCoach 使用 bounded cache。
- `practiceApiFacade.test.js` 锁定 `/api/practice/migration-status` 的 bounded coach cache surface。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/js/readingAnalysisService.test.js` 必须通过，并覆盖 query/exam bundle cache 上限。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过，并锁住 migration status。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过，并锁住 shared cache 数据层边界。
- `npm run build:writing` 必须通过。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 21: Writing evaluation SSE replay cache bound

目标：把写作评测的 SSE hydration 状态从无界进程缓存压成明确的数据结构。`EvaluateService.sessionEventCache` 原先每个 session 只保留 80 条 event，但 session 数量没有上限；在 packaged Electron 的长跑 local server 里，连续评测会让 transient replay state 在 15 分钟 TTL 内持续增长，这是垃圾数据所有权。

当前已完成：

- `server/src/lib/shared/cache.ts` 的 `setBoundedCacheEntry()` 现在返回被淘汰的 key，允许调用方清理关联状态；现有 Practice asset loader 和 ReadingCoach 调用可以忽略返回值。
- `server/src/lib/writing/evaluate-service.ts` 引入 shared cache helper，并把 `sessionEventCache` 固定为 24 个 recent replay sessions。
- 保留原有每 session 80 条 event tail；Vue/HTTP SSE 断线重连仍能恢复最近事件，但不会无限保留每个历史 session。
- `getSessionState()` 命中 replay cache 时刷新 LRU；新 event 写入也刷新 LRU。
- 过期或 LRU 淘汰 inactive replay session 时同步删除 `sessionProgress`，避免另一个 Map 留下无意义状态。
- 新增 `getRuntimeCacheStats()` 作为运行时契约探针，不暴露给产品 UI。
- 迁移矩阵新增 `server/src/lib/writing/evaluate-service.ts bounded SSE replay cache`，并把 writing SSE replay bound 写入 legacy deletion criteria。
- `writing_contract_probe.cjs` 覆盖单 session event tail 80 条和 replay session cache 24 条上限。
- `writing_backend_contract.py`、`practiceVueShell.test.js`、`practiceApiFacade.test.js` 锁定 bounded SSE replay cache 的源码/API 契约。

验收：

- `npm run build:server` 必须通过。
- `node developer/tests/ci/writing_contract_probe.cjs` 必须通过，并输出 `session_event_cache_entries=24`、`session_event_tail_length=80`。
- `python3 developer/tests/ci/writing_backend_contract.py` 必须通过。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过。
- `node developer/tests/js/readingAnalysisService.test.js` 必须通过，证明 shared cache helper 签名调整不破坏 ReadingCoach。
- `npm run build:writing` 必须通过。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 22: Writing essay history summary hot path

目标：把写作历史列表从完整 essay/evaluation 详情载荷里切出来。历史页列表只需要题目、分数、字数、模型、提交时间；如果还读取 `content` 和解析 `evaluation_json`，就是把详情页成本塞进 Electron 首页热路径。

当前已完成：

- `electron/db/schema.sql` 和 `electron/db/migrations/20260209_phase06_schema.sql` 新增 `essays.topic_text`，作为 essay 行级题目快照。
- `electron/db/migrator.js` 新增 `_ensureCurrentSchema()` / `_ensureColumn()`，用于给已有 SQLite 库补 `topic_text`；不依赖当前 SQLite 不支持的 `ALTER TABLE ADD COLUMN IF NOT EXISTS`。
- `electron/db/dao/essays.dao.js` 的 list SQL 改为显式 summary columns，排除 `content` 和 `evaluation_json`。
- 写作历史搜索改为 `t.title_json LIKE ? OR e.topic_text LIKE ? OR e.content LIKE ?`，不再扫描 `e.evaluation_json LIKE ?`。
- `electron/services/essay.service.js` 新增 `_decorateEssaySummary()`；`list()` 和 `exportCSV()` 走摘要装饰器，不解析 evaluation JSON。
- `getById()` 继续走 `_decorateEssayRecord()`，详情路径仍读取正文并解析完整 evaluation JSON。
- `server/src/lib/writing/evaluate-service.ts` 持久化评测时写入 `topic_text: session?.topic_text || null`，使自由题/题库题的显示和搜索元数据不再依赖评测 payload。
- 迁移矩阵新增 `Essay history summary list without content/evaluation_json parsing`，删除准则也记录写作历史列表必须是 `topic_text`-backed summary rows。
- 新增 `developer/tests/ci/writing_essay_history_contract.cjs`，用 poisoned getters 锁住 list 不读取 `content/evaluation_json`，同时证明 detail 仍解析 full evaluation JSON。
- `writing_backend_contract.py`、`practiceVueShell.test.js`、`practiceApiFacade.test.js` 和 `run_static_suite.py` 都已覆盖该契约。

验收：

- `node developer/tests/ci/writing_essay_history_contract.cjs` 必须通过。
- `npm run build:server` 必须通过。
- `python3 developer/tests/ci/writing_backend_contract.py` 必须通过。
- `node developer/tests/js/practiceVueShell.test.js` 必须通过。
- `node developer/tests/js/practiceApiFacade.test.js` 必须通过。
- `node developer/tests/js/readingAnalysisService.test.js` 必须通过，证明共享构建产物串行验证后仍稳定。
- `node developer/tests/ci/writing_contract_probe.cjs` 必须通过，证明写作评测缓存契约未回退。
- `npm run build:writing` 必须通过。
- `python3 developer/tests/ci/run_static_suite.py` 必须继续通过。
- `python3 developer/tests/e2e/suite_practice_flow.py` 必须继续通过。

### Slice 23: Legacy reading UX parity rebaseline

目标：纠正 Vue 重构方向。阅读重构不是把 legacy 总览改成新的资源库，也不是把迁移矩阵摆给用户看；目标是把原来的 `考试总览系统`、总览卡片、题库浏览、阅读练习、复盘记录用 Vue 重写，点击路径和上手心智保持原样。

当前审计结论：

- legacy `index.html` 的主信息架构是 `总览`、`题库浏览`、`练习记录`、`更多`、`设置`。这是产品壳，不是应该删除的兼容层。
- `js/views/overviewView.js` 和 `js/services/overviewStats.js` 定义了用户熟悉的总览合同：P1/P2/P3 阅读分类、每类篇数、`浏览题库`、`随机练习`、`套题模式`、`无尽模式`。
- `js/app/examActions.js` 定义了题库浏览合同：搜索、筛选、排序、题目卡片、`开始练习`、`PDF`。
- 当前 `PracticeLibraryPage.vue` 暴露 `Practice Library`、`统一练习库`、`Migration State`、`Entrypoint Matrix`，这是工程迁移视角，已经背离原用户体验。
- 当前 `PracticeReadingPage.vue` 把 Answer Sheet、AI Coach、复盘分析面板作为主界面结构提前铺开，容易抢走 legacy 阅读页的原始阅读/答题节奏。AI 能力应该作为提交后的延展能力，不应该先改变基础作答心智。

新的实施顺序：

1. Vue 顶层壳恢复 legacy 信息架构：默认 `/overview`，导航中文标签与旧入口一致；`/library` 不再作为用户主入口。
2. 新建或重写 `PracticeOverviewPage.vue`：复刻 legacy 总览卡片和动作；卡片数据来自 Practice API/overview summary，不从 DOM 全局状态读。
3. 新建或重写 `PracticeBrowsePage.vue`：复刻题库浏览筛选、搜索、排序、位置记忆、列表卡片、`开始练习`、`PDF`；内部启动阅读仍走 Vue route/API。
4. 迁移矩阵从用户页面移除，保留在 `/api/practice/migration-status`、测试和开发文档中。
5. `PracticeReadingPage.vue` 改成 legacy reading workspace parity：原文/题目布局、原生题型 HTML、拖拽/输入、提交/复盘按钮语义优先；Answer Sheet/AI Coach 收到次级区域或提交后折叠区。
6. 练习记录页面按 legacy 记录页迁移阅读历史入口：统计卡、筛选、搜索、批量删除、导出 Markdown、复盘点击路径保持。
7. 删除旧 runtime 前必须用 E2E 证明同一套用户点击路径都在 Vue 中通过。

验收：

- Vue 默认入口第一屏必须能被用户识别为原 `考试总览系统`，而不是新产品 `Practice Library`。
- E2E 必须覆盖：`总览 -> P1 浏览题库`、`总览 -> P1 随机练习`、`总览 -> 套题模式`、`题库浏览 -> 搜索 -> 开始练习`、`题库浏览 -> PDF`、`练习记录 -> 阅读复盘`。
- 静态契约必须禁止正常用户页面出现 `Migration State` / `Entrypoint Matrix` 文案。
- Vue 代码可以保留 Practice API 和数据层压实成果，但不得用工程迁移状态替代用户可理解的考试总览界面。

## 设置收口

设置必须分三层，不要再把所有东西塞一个“设置页”：

- Global provider settings：API configs、provider health、默认模型。
- Practice defaults：语言、temperature、history limit、auto save。
- Session overrides：本次练习使用的 config/model/prompt，保存在 `PracticeSession.settings`。

Vue 设置页只管理全局默认值。Session 里的模型选择是 session toolbar 的轻量控件，不要跳设置页。

## 测试闸门

每个实现 slice 至少跑：

```bash
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

新增测试建议：

- `developer/tests/js/practiceContracts.test.js`
- `developer/tests/js/readingScoring.test.js`
- `developer/tests/js/practiceCoachPolicy.test.js`
- `developer/tests/e2e/vue_reading_flow.py`
- `developer/tests/e2e/vue_practice_history_migration.py`

默认入口切换前，必须同时通过旧 E2E 和新 Vue E2E。

## 不做什么

- 不在 `ComposePage.vue` 里加阅读分支。这会复制现在的垃圾结构。
- 不让 Vue 组件直接拼 `/api/reading/assistant/query` payload。
- 不继续以 `file://` 兼容作为路由设计中心。
- 不立刻删除 legacy。先双路径验证，再切主入口，再删。
- 不把静态 reading exam 全量导入 SQLite。题库是 asset，session/result 才是用户数据。

## 第一批实施文件

优先动这些文件：

- `server/src/lib/practice/contracts.ts`
- `server/src/lib/practice/service.ts`
- `server/src/routes/practice.ts`
- `server/src/app.ts`
- `apps/writing-vue/src/api/practice-client.js`
- `apps/writing-vue/src/composables/usePracticeSession.js`
- `apps/writing-vue/src/views/PracticeSessionPage.vue`
- `apps/writing-vue/src/components/practice/`

暂时只读/适配，不直接删：

- `server/src/lib/reading/coach-service.ts`
- `js/runtime/unifiedReadingPage.js`
- `js/core/practiceRecorder.js`
- `electron/main.js`
- `electron/preload.js`

## 【品味评分】

🔴 当前阅读链路品味差。

致命问题不是功能多，而是没有单一数据主人。页面、父窗口、localStorage、Fastify、SQLite、Electron IPC 全都在“拥有”一部分状态。这样的系统只会越修越脏。

## 【改进方向】

1. 先定义 `PracticeSession`，所有页面、API、AI、历史都围绕它。
2. 把阅读评分和结果生成从 DOM 页面移到纯数据服务。
3. 把 AI coach 从 widget/bridge 改成 session capability。
4. Vue 变主入口，legacy 变 fallback。
5. 通过双写和 E2E 闸门逐步删除旧阅读链路。
