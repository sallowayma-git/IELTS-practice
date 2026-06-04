# Findings & Decisions

## Requirements
- 重构阅读业务链路，目标不是局部优化，而是重新梳理甚至重写。
- 阅读必须直接融入当前写作模块和 AI native 应用，不再形成两个界面互相切换的过渡态。
- 全部新 renderer 体验使用 Vue 实现。
- 避免设置界面、API、兼容逻辑互相乱飞。
- 降低阅读业务链路重量，优先简化数据结构，再消除特殊情况，再保证零回归。
- 产品目标是 packaged Electron desktop client，优先 Electron renderer/main/server 架构，不保留 legacy `file://` hack 作为设计中心。

## Research Findings
- 当前写作 Vue 应用位于 `apps/writing-vue/`，已有 views、components、composables、api client 和 settings/history/result/compose 页面。
- 阅读相关代码初步分布在 `server/src/routes/reading.ts`、`server/src/lib/reading/`、`server/src/types/reading.ts`、`electron/services/reading-coach.service.js`、`assets/scripts/*reading*` 和 `assets/generated/reading-exams/`。
- 仓库当前已有未提交改动：`apps/writing-vue/src/views/SettingsPage.vue`，以及未跟踪截图 `writing-settings-desktop.png`、`writing-settings-mobile.png`。这些视为用户已有工作，不能回滚。
- `apps/writing-vue/src/main.js` 当前只注册写作路由：Compose、Evaluating、Result、TopicManage、History、Settings。路由守卫围绕 writing evaluation session，尚无通用 practice/session 概念。
- `apps/writing-vue/src/main.js` 注释仍写着 Hash 模式用于 `file://` 兼容，这与“packaged Electron first”的目标冲突，后续应从产品入口层解决，而不是把兼容逻辑扩散到业务路由。
- `apps/writing-vue/src/api/client.js` 是“写作本地 Fastify API 适配层”，封装 configs/prompts/evaluate/topics/essays/settings/upload；SSE 只绑定 `/api/writing/evaluations/:sessionId/stream`，阅读没有纳入同一个事件模型。
- `apps/writing-vue/src/views/ComposePage.vue` 把写作任务类型、题源、题库选择、草稿、提交评测全部写在单页面状态里；它是产品工作台雏形，但还不是可扩展的 practice shell。
- `apps/writing-vue/src/composables/useDraft.js` 的草稿模型硬编码 `task1/task2` 与 `free/bank`，只服务写作。统一后需要变成 session-scoped draft，而不是继续追加 reading 特殊字段。
- `apps/writing-vue/src/components/NavBar.vue` 仍提供 `window.electronAPI.openLegacy()` 的“返回练习主页”，这证明当前 Vue 写作是 legacy 应用旁边的孤岛。这个按钮是过渡态的直接证据。
- `server/src/routes/reading.ts` 只提供 `/api/reading/assistant/query` 和 `/api/reading/assistant/query/stream`，它是 AI 教练查询接口，不是阅读练习生命周期 API。
- `server/src/lib/reading/service.ts` 只是把请求代理给 `services.readingCoachService`。真正实现仍在 coach service，领域边界薄。
- `electron/services/reading-coach.service.js` 只是 require server dist 的桥，实际代码在 `server/src/lib/reading/coach-service.ts`。这是 Electron bundle 兼容层，不应成为新架构主边界。
- `server/src/lib/reading/coach-service.ts` 会加载 `assets/generated/reading-exams/*.js` 和 `assets/generated/reading-explanations/*.js`，通过 `vm.runInNewContext` 执行注册式题库数据。阅读内容数据源不是数据库，也不是 typed JSON API。
- `ReadingCoachService._normalizePayload()` 强制 `attemptContext.submitted === true`，否则抛出 `coach_locked_until_submit`。这把“做题”和“AI 教练”硬切成两个阶段，是当前产品断层的核心特殊情况之一。
- 阅读 AI 服务内部已有可复用价值：route/intent/contextRoute 分类、retrieval chunks、reviewTargets、citations、timings、model_trace、SSE progress 事件。这些应保留为 `PracticeCoach` 能力，而不是删除重写。
- `server/src/lib/reading/router.ts` 的 intent/action/surface 分类依赖 query、selectedText、focusQuestionNumbers、attemptContext。新 Vue UI 必须提供结构化 selection/attempt/session context，不能让组件拼随机 payload。
- `electron/preload.js` 只暴露 `openWriting()`、`openLegacy()`、`getLocalApiInfo()` 等少量桥。新主应用不应继续通过 `openLegacy/openWriting` 做模块切换，而应以一个 Vue 入口承载练习、历史、设置。
- `electron/main.js` 目前有 `loadLegacyPage()` 加载 `index.html`，`loadWritingPage()` 加载 `dist/writing/index.html`，再用 IPC `navigate-to-legacy`/`navigate-to-writing` 切换。这个就是用户说的“两个界面互相切换”的直接技术实现。
- `electron/main.js` 已有 `app://app/` 自定义协议和 packaged asset resolution。新 Vue 主入口可以成为默认加载目标，不需要以 `file://` 兼容作为业务路由设计前提。
- legacy `index.html` 仍包含阅读/听力题库、练习历史、写作入口按钮、阅读生成 manifest 脚本等。当前首页既是资源浏览器又是旧练习宿主，职责过重。
- `js/practice-page-enhancer.js` 超过 5000 行，包含阅读/听力页面增强、答案采集、正确答案提取、review readonly、sessionId/examId 推导、legacy 返回、结果事件等大量职责。把它继续补丁化就是垃圾架构。
- Slice 0 已新增 `server/src/lib/practice/contracts.ts`、`server/src/lib/practice/service.ts`、`server/src/routes/practice.ts`，并在 `server/src/app.ts` 注册。它只建立统一 practice facade，不切换旧行为。
- `/api/practice/assets` 现在能暴露 reading manifest 资产和 writing topics；reading 数据仍是 asset，不导入 SQLite。
- `/api/practice/sessions` 目前只支持 writing，内部复用现有 `WritingEvaluationService`，reading session 明确返回 `practice_session_not_implemented`，避免假完成。
- `/api/practice/coach` 目前只支持 reading，内部复用现有 `ReadingAssistantService`。
- Vue 侧新增 `apps/writing-vue/src/api/practice-client.js`，并把 `apps/writing-vue/src/api/client.js` 的 `request()` 导出供新 facade client 复用，避免复制本地 API baseUrl/cache 逻辑。
- 5.3 Codex 子代理只读审计结论：Vue 阅读重构必须覆盖 manifest/data loading、questionGroups 渲染、答案采集、评分、PRACTICE_COMPLETE payload、review/readOnly、suite/simulation、pending 消息、PracticeRecorder 兼容、highlights 和 readingCoach 透传。Slice 0/1 可暂不动 coach UI 拖拽、explanation 视觉、高级分析展示和 listening UI。
- Slice 1 子代理复审确认：`main.js` 的 Evaluating/Result 守卫、`temp_essay_${sessionId}` 和 `evaluation_${sessionId}` 缓存、Result DB 优先缓存兜底、SSE 事件集合都必须作为零回退红线保留。
- `apps/writing-vue/src/components/NavBar.vue` 已从写作孤岛品牌切到 `IELTS Practice Studio`，常规导航新增 `/library`，`openLegacy()` 只保留为迁移期备用入口，不再作为正常产品路径。
- `apps/writing-vue/src/main.js` 已新增 `/library` Practice Library route 和 `/writing` -> Compose 兼容别名；Hash history 仍由 Electron 打包入口承载，但业务注释不再以 `file://` 兼容作为设计中心。
- `apps/writing-vue/src/views/PracticeLibraryPage.vue` 是第一个 Vue Practice Shell 页面：只消费 `practice-client`，分别拉取 reading/writing assets，避免后端“全部”分页被 reading 资源吞掉导致写作不可见。
- 写作资产从 Practice Library 进入 Compose 时通过 `topicId/taskType` query hydration 进入题库模式；如果本地已有草稿，不会在用户选择恢复/放弃前自动覆盖旧草稿。
- 阅读资产在 Slice 1 只展示真实 asset metadata 和迁移状态，不伪造 Vue reading session。阅读 session 仍保持 facade 的 501 明确未实现，这是防止假完成分支的正确边界。
- 新增 `developer/tests/js/practiceVueShell.test.js`，并接入 `developer/tests/ci/run_static_suite.py`，锁住 Practice route/nav/library/client/Compose hydration 契约。
- Slice 2 新增 `server/src/lib/practice/reading-assets.ts`，最初把 `assets/generated/reading-exams/*.js` 的注册式题库脚本收束到服务端 Practice payload。Slice 14 已进一步删除 Practice runtime 的 `node:vm` 执行，改为把 manifest/exam JS 当受限 JSON 数据容器解析。
- 阅读详情 payload 现在包含 `meta`、`passage.blocks`、`questionGroups`、`answerKey`、`questionOrder`、`questionDisplayMap`、`questionCount` 和 `interactionModel`。
- `interactionModel` 把旧题面输入通道归一到 `radio | checkbox | text | select`。旧拖拽题在 Vue 首版中使用 `select` 作为等价作答 fallback，不把拖拽恢复伪装成已完成。
- `apps/writing-vue/src/views/PracticeReadingPage.vue` 是 Vue 阅读首个真实页面：从 Practice API 加载阅读详情，渲染 passage/questionGroups，维护页面级 `answers` 状态，并让左侧原生 input 与右侧 answer sheet 双向同步。
- `apps/writing-vue/src/views/PracticeLibraryPage.vue` 的阅读入口已从 metadata modal 改为跳转 `/reading/:assetId`，不再停留在“只看资源详情”的过渡态。
- 5.3 子代理 Slice 2 只读审计确认：Vue 首版必须覆盖 radio、text、checkbox、dropzone 四类输入通道；评分容错、拖拽恢复、readOnly review、AI coach submit 后上下文不能在本 slice 假装完成。
- 新增 `developer/tests/e2e/practice_reading_vue_flow.py`，覆盖从练习库进入 Vue 阅读页、正文/题组渲染、radio/text/checkbox/dropzone fallback 作答同步和 sessionStorage 快照。
- `developer/tests/js/practiceApiFacade.test.js` 现在覆盖阅读详情 payload、missing asset 404、`p1-high-01` dropzone fallback、`p2-low-148` radio/text/checkbox，并分页扫全量阅读资产，要求每个 `questionOrder` 条目都有答案键和合法交互模型。
- `developer/tests/ci/run_static_suite.py` 现在聚合 Practice API facade、Vue Practice Shell 静态契约和 Vue 阅读链路 E2E，降低 Slice 2 回退风险。
- Slice 3 子代理只读审计确认：legacy 阅读提交的不可推迟 contract 是 `answers`、`correctAnswers`、`answerComparison`、`scoreInfo` 以及 `readOnly/reviewMode` 联动；`readingCoachSnapshot`、`readingCoachTranscript`、`analysisSignals`、`questionTimelineLite`、`highlights` 可后续增强，不能在本轮伪装完成。
- 旧 `AnswerMatchCore` 的数组答案语义存在脏点：数组既表示“可接受同义答案”，也可能表示“多选集合”。新服务端评分用 `interactionModel.control === 'checkbox'` 区分 checkbox 集合答案和非 checkbox 可接受答案，避免把单题三选只选一项算对。
- Slice 3 新增 `server/src/lib/practice/reading-sessions.ts`，把答案规范化、比较、评分、题型统计和 coach context 统一放在服务端 Practice facade，不让 Vue 变成第二套评分器。
- 阅读答案规范化现在覆盖：引号/连字符/空白归一、首尾标点清理、单字母选项大写、`A. xxx`/`A) xxx` 取选项字母、`yes/no` 与 `true/false` 互通、`NG/notgiven/not-given` 归一为 `not given`、非字母选项文本的 loose compare。
- `/api/practice/sessions` 对 reading 已从 501 升级为同步提交：返回 `sessionId`、`status=submitted`、`submission.readOnly=true`、`answers`、`correctAnswers`、`answerComparison`、`scoreInfo`、`questionTypePerformance`、`coachContext` 和 legacy `PRACTICE_COMPLETE` 兼容元数据。
- `/api/practice/sessions/reading/:sessionId` 现在能从 Practice facade 的内存 session store 返回刚提交的阅读复盘；这是迁移中间层，不是最终历史持久化。
- `/api/practice/coach` 在传入已提交 reading `sessionId` 时，会由服务端注入权威 `attemptContext`，包括 `submitted=true`、score、wrongQuestions 和 selectedAnswers。未知旧 sessionId 会保留原 payload 放行，避免破坏已有 coach 调用。
- `apps/writing-vue/src/views/PracticeReadingPage.vue` 已从本地快照页升级为 `draft -> submit -> readonly review -> AI coach` 状态机；提交后禁用题面原生控件和答案面板，显示服务端复盘表和 score summary。
- Vue 阅读页修复了单题多选退化问题：当 `interactionModel.control === 'checkbox'` 且答案键是数组时，右侧 answer sheet 渲染 checkbox list 并提交数组；普通跨题 checkbox 仍按旧题号序列拆分为单题答案。
- `developer/tests/e2e/practice_reading_vue_flow.py` 现在覆盖练习库进入阅读页、radio/text/checkbox/dropzone fallback 作答同步、sessionStorage 快照、提交生成 Practice session、只读复盘、复盘表、AI coach 使用 submitted sessionId。
- `developer/tests/js/practiceApiFacade.test.js` 现在覆盖 reading submit/score/review、T/F/NG normalization、checkbox array set scoring、submitted session state、coach session context injection，并保留旧 explicit coach payload 兼容。
- Slice 4 legacy history 审计确认：`PracticeRepository` 只是 `practice_records` 数组容器，真正兼容字段来自 `PracticeRecorder`/`ScoreStorage`/`PracticeCore` 标准化 record 输出。最小不可丢字段是 `sessionId`、`examId`、`answers`/`answerList`、`answerComparison`、`scoreInfo.details`、`correctAnswerMap`、`metadata`、`realData.*`、`readingCoachSnapshot` 和 `readingCoachTranscript`。
- Slice 4 新增 `server/src/lib/practice/practice-history.ts`，最初把 Vue reading `ReadingPracticeSubmission` 转成 `PracticeHistoryRecord` 与 legacy-compatible `legacyRecord`。Slice 17 已废弃这条影子存储路径，当前 packaged Electron SQLite history 只保留 canonical `submission_json`。
- Electron 数据库 schema 和迁移 `electron/db/schema.sql`、`electron/db/migrations/20260209_phase06_schema.sql` 已加入 `practice_history_records`，这比把新 Vue 阅读历史写回 legacy localStorage 更符合 packaged Electron 目标。
- `/api/practice/history` 和 `/api/practice/history/:activity/:recordId` 已提供统一历史列表/详情；`/api/practice/sessions/reading/:sessionId` 现在先查内存，再查持久 history submission，应用重启或重新创建 PracticeService 后仍能 replay。
- `/api/practice/coach` 对已提交 reading `sessionId` 仍由服务端注入权威 `attemptContext`；Slice 17 后 coach response 回写到 canonical `ReadingPracticeSubmission.readingCoachSnapshot` / `readingCoachTranscript`，不再写 legacy history shadow。
- Vue Practice Library 新增最近阅读复盘区，只消费 `practiceHistory` facade，并进入 `/reading/:assetId/review/:sessionId`。没有把阅读历史硬塞进写作 `HistoryPage.vue` 的四维写作统计雷达，避免错误模型污染。
- `PracticeReadingPage.vue` 复用同一页面实现 draft 与 review：普通 `/reading/:assetId` 加载题目并允许提交；`/reading/:assetId/review/:sessionId` 加载题目后读取 submitted session，恢复答案、显示 review table，并锁定只读控件，不触发二次提交。
- `developer/tests/js/practiceApiFacade.test.js` 现在覆盖 persistent history/replay：使用 fake SQLite adapter 验证跨 PracticeService 实例读取同一 reading session，并验证 legacy record 字段、history list/detail、coach snapshot/transcript 回写。
- `developer/tests/e2e/practice_reading_vue_flow.py` 现在覆盖完整 Vue 阅读路径：练习库进入、作答同步、提交复盘、AI coach、返回练习库、通过 reading history 进入 replay、只读回放、不重复 POST submit。
- legacy dropzone 审计确认：`unifiedReadingPage.collectAnswers()` 的真实语义是单槽单值，优先读取 `dropzone.dataset.answerValue`，展示 label 只是 UI；`applyDropzoneAnswer()` 也只回放第一个 token。Vue 迁移不应照搬 `practice-page-enhancer` 里按段落字母反推题号、`.drag-item-clone`、`.card` 等垃圾兼容分支。
- `p2-low-148` 的 `audit.notes` 包含 `dragdrop` 只是元数据噪音，实际 HTML 没有 dropzone；不能用 audit signature 驱动交互模型。真正用于 parity 的 fixture 是 `p1-high-01` 一类带 `.paragraph-dropzone` / `.match-dropzone` 和 `.drag-item[data-heading|data-option]` 的题。
- `ReadingQuestionInteraction` 已把旧 `control: select` + `source: dropzone_fallback` 改成 `control: dragdrop` + `source: dropzone`，并透出 `allowOptionReuse`。这消除了“选择题还是拖拽降级”的垃圾特殊情况。
- `PracticeReadingPage.vue` 现在由 Vue 接管原生 dropzone：拖拽源可以来自题面 `.drag-item` 或答案面板 chip，目标可以是题面 `.paragraph-dropzone/.match-dropzone` 或答案面板 slot；同一 `answers[questionId]` 同步 answer sheet、题面 `dataset.answerValue`、提交 payload 和 replay。
- Vue drag/drop parity 保留了真实 userspace 行为：单槽替换、槽间交换、拖回选项池清空、只读复盘禁用、以及 `<select class="dragdrop-select">` 作为键盘/辅助 fallback。评分仍由服务端 PracticeSession 统一负责。
- `practice_reading_vue_flow.py` 现在用真实 drag/drop 路径把 `.options-pool .drag-item[data-option="C"]` 拖到 `.match-dropzone[data-question="q12"]`，并验证答案面板 chip、可访问 select、题面 dropzone dataset、提交复盘和 replay 都恢复 `C`。
- Drag/drop replay 初版暴露了一个生命周期 bug：`loadSubmittedSession()` 在 `loading=true` 时同步 DOM，但模板用 `v-if="!loading"`，题面 dropzone 尚未挂载。修复为加载提交记录后先让 `loading=false`，再 `nextTick()` 同步 DOM 和只读状态。
- Slice 5 legacy analysis artifact 审计确认：`analysisSignals`、`questionTimelineLite`、`highlights`、`markedQuestions`、`singleAttemptAnalysisInput`、`singleAttemptAnalysis` 不是旧 UI 噪音；`PracticeCore` 和 `PracticeRecorder` 都会把它们标准化进 `realData` / `resultSnapshot`。Vue 阅读提交如果只存分数表，就是丢复盘上下文的垃圾实现。
- `ReadingPracticeSubmission` 现在把 `highlights`、`markedQuestions`、`analysisSignals`、`questionTimelineLite`、`singleAttemptAnalysisInput`、`singleAttemptAnalysis` 和 `analysisArtifacts` 作为 typed first-class fields；这些字段由服务端 `reading-sessions.ts` 生成，Vue 只提交可观察的作答元数据，不复制评分/诊断逻辑。
- Slice 17 后 `PracticeHistoryStore` 不再把分析 artifact 同步到 legacy top-level record、`legacyRecord.realData` 或 `legacyRecord.resultSnapshot`。同一套分析 artifact 只存在于 canonical `submission`，重启回放和 history detail 都读这一份事实。
- `PracticeReadingPage.vue` 新增 Vue-native 标记题控件、答题时间线/改答次数追踪、交互密度提交、以及 `data-reading-analysis-panel` 复盘分析面板。提交后和回放模式都会锁定标记控件，避免 readonly userspace 回退。
- `practice_reading_vue_flow.py` 现在真实制造一次改答、标记 q6、提交并验证 payload 中的 `markedQuestions` / `questionTimelineLite` / `interactionCount`，同时验证分析面板、题型表现条、只读回放和标记恢复。
- Slice 6 入口审计确认：Vue 内部正常阅读路径 `/library -> /reading/:assetId` 不调用 `openLegacy()`；`openLegacy()` 只留在 `NavBar.vue` 的迁移期备用按钮和旧 runtime 自身的退出路径里。
- `electron/main.js` 已把默认启动从 `loadLegacyPage()` 改为 `loadPracticeShellPage()`，实际加载 `dist/writing/index.html` 这个现有 Vue 构建产物；缺 Vue 构建时才弹出提示并回退到 `index.html`。
- `loadWritingPage()` 现在只是兼容旧 IPC `navigate-to-writing` 的别名，内部委托 `loadPracticeShellPage()`。这是正确的过渡：IPC 不立刻删，默认产品入口先统一。
- Vue `apps/writing-vue/src/main.js` 现在派发 `app-runtime-ready`。如果默认入口切到 Vue 却不发这个信号，Electron updater boot-health 会把新入口误判成未就绪，这是入口迁移里最容易漏掉的真实风险。
- 新增 `server/src/lib/practice/migration-status.ts`，把迁移状态集中成 typed 数据：`defaultRenderer='vue'`、`normalVueReadingUsesLegacy=false`、`legacyDeletionAllowed=false`。
- `/api/practice/migration-status` 现在是迁移矩阵的唯一服务端出口；Vue `practiceMigration.getStatus()` 读取同一份事实，避免 UI、Electron、测试各写一套删除标准。
- 迁移矩阵已从“套题 legacy fallback”推进到“suite reading Vue primary”：`single-reading-practice`、`suite-reading-practice` 与 `writing-practice` 是 Vue primary；`listening-practice` 仍是 legacy fallback。legacy 现在不能全删，原因是听力和部分旧 fallback/review 表面仍未完全退场。
- `PracticeLibraryPage.vue` 新增 `data-practice-migration-panel` 迁移矩阵面板，展示默认入口、legacy 删除状态和每个 capability 的 renderer/support。它不是设置页，也不是新兼容开关，只是把架构边界可视化。
- `developer/tests/js/practiceVueShell.test.js` 现在锁住 Electron 默认 Vue 入口、Vue `app-runtime-ready`、Practice Library 迁移矩阵、Practice client migration endpoint，以及正常 Vue 阅读页不得依赖 `openLegacy()`。
- `developer/tests/js/practiceApiFacade.test.js` 现在覆盖 `/api/practice/migration-status`，要求单篇阅读与套题阅读为 Vue primary、听力为 legacy fallback，并验证删除门槛包含“正常 Vue 阅读路由不调用 legacy”。
- 本轮后 legacy single-reading runtime 和 suite session orchestration 都有 Vue 主链路；实际 blocker 收缩为 listening fallback、旧 review/diagnostic 表面和删除前的最终一致性验证。下一轮真实缺口：迁移听力，或抽离 writing Compose 为 session-oriented components。
- Slice 7 审计确认：legacy 备用页里的普通单篇阅读入口仍会通过 `js/app/readingLaunchMixin.js` 构造 `assets/generated/reading-exams/reading-practice-unified.html`，这会绕过 Vue-primary 单篇阅读链路；这是一个真实入口债，不是理论重构。
- `electron/main.js` 新增 `navigate-to-practice-route` IPC，并通过 `normalizePracticeShellRoute()` 只允许内部 Practice Shell hash routes。它加载 `dist/writing/index.html#/reading/:assetId`，拒绝外部 URL、双斜杠、反斜杠、未知路径和带 hash 的嵌套路由。
- `electron/preload.js` 新增 `openPracticeRoute()` 和 `openPracticeReading()`；`openPracticeReading()` 只接受 `[A-Za-z0-9._-]` asset id。这把 legacy fallback surface 需要的导航能力收束到 Electron 壳层，而不是让旧页面拼文件路径。
- `js/app/readingLaunchMixin.js` 现在把 generated reading asset 分成两个明确 descriptor：普通单篇在 Electron Practice route API 存在且非 suite/review/forced legacy 时返回 `vue_practice_reading`；suite、simulation、review、forced legacy 仍返回 `unified_html`。
- `js/app/examSessionMixin.js` 对 `vue_practice_reading` 只调用 `_openVuePracticeReading()` 并返回当前窗口，不启动 legacy `startPracticeSession()`、`injectDataCollectionScript()` 或 `setupExamWindowManagement()`。这避免单篇 Vue 和 legacy session 双写。
- `buildExamUrl(exam)` 显式以 `{ forceLegacyReading: true }` 调用 descriptor resolver，保证旧工具或 suite fallback 需要 raw URL 时仍能得到 `reading-practice-unified.html`，不被 Vue descriptor 污染。
- `/api/practice/migration-status` 的 `electronEntrypoints` 现在包含 `practiceRouteIpc: 'navigate-to-practice-route'`，单篇阅读 capability 的 route pattern 也记录 legacy fallback start 会回到 `/reading/:assetId`。
- 新增 `developer/tests/js/readingLaunchVueRoute.test.js`，用 VM 真实加载 mixin，覆盖普通单篇 descriptor -> Vue route、无 Electron route API -> unified HTML、suite/review/forced legacy -> unified HTML、`openExam()` Vue route 不启动 legacy session 注入。
- Slice 8 suite 审计确认：旧 `suitePracticeMixin` 的核心不是窗口，而是 `sequence/currentIndex/results/draftsByExam/elapsedByExam/pendingAdvance`。窗口复用、postMessage 和 storage mirror 是历史实现负担，不能继续作为新 Vue 主链路的数据主人。
- 新增 `ReadingSuiteSession` typed contract，把套题状态收束为 `sessionId`、`flowMode`、`frequencyScope`、`currentIndex`、`sequence`、`aggregate`、`status`。这比让 Vue 或旧 runtime 猜 `suiteSessionId` 字段干净得多。
- 新增 `server/src/lib/practice/reading-suite-sessions.ts`，由服务端 Practice API 负责 P1/P2/P3 抽题、顺序提交、乱序拒绝、每篇结果挂接和整套聚合。单篇评分仍复用 `createReadingPracticeSubmission()`，没有复制第二套评分器。
- 新增 `/api/practice/reading-suite`、`/api/practice/reading-suite/:sessionId`、`/api/practice/reading-suite/:sessionId/passages/:assetId`。这是明确领域资源，不把 suite 偷塞进通用 `/api/practice/sessions` 的隐式 `settings.practiceMode` 分支。
- Vue `PracticeLibraryPage.vue` 新增阅读套题入口，`PracticeReadingSuitePage.vue` 负责套题进度和 P1/P2/P3 状态展示，`PracticeReadingPage.vue` 复用单篇阅读渲染/提交能力，通过 `suiteSessionId` 调用 suite passage submit endpoint。
- `electron/main.js` 的 Practice route allowlist 已加入 `/reading-suite/:sessionId`，仍拒绝外部 URL、反斜杠、嵌套 hash 和未知 path。
- 迁移矩阵已更新：`suite-reading-practice` 现在是 Vue primary，route 为 `/reading-suite/:sessionId -> /reading/:assetId?suiteSessionId=:sessionId`；legacy suite window flow 仍保留在 `apiSurface/verifiedBy`，作为删除前回归护栏。
- 新增 `developer/tests/e2e/practice_reading_suite_vue_flow.py`，覆盖从练习库创建 suite、进入当前篇、P1/P2/P3 逐篇提交、返回套题进度、最终 3/3 聚合，并断言没有 legacy API 调用。
- Slice 9 审计确认：Vue suite 已完成后，旧首页 `js/presentation/app-actions.js` 的套题按钮仍默认调用 `app.startSuitePractice()`，这会把 packaged Electron 用户带回 `suitePracticeMixin` 和 `reading-practice-unified.html`。这是一个真实入口债，不是删除前的理论洁癖。
- `js/presentation/app-actions.js` 现在只有两个套题启动分支：产品模式直接 POST `/api/practice/reading-suite` 并通过 `electronAPI.openPracticeRoute('/reading-suite/:sessionId')` 进入 Vue suite；只有显式 `test_env=1` / `suite_test=1` / `ci=1` 回归模式才调用 `suitePracticeMixin`。无 Electron API、无本地 API、fetch 失败或 route 失败不再静默回 legacy，而是暴露错误。
- Slice 9 暴露并修复了一个 API envelope bug：`/api/practice/reading-suite` 的真实响应是 `{ success: true, data: { sessionId, ... } }`，旧首页适配器不能读取顶层 `payload.sessionId`。`legacySuiteVueRoute.test.js` 已用真实 envelope 锁住这个行为。
- `PracticeMigrationCapability` 新增 `legacyFallbackSurface`，把 Vue 主链路 `apiSurface` 和 legacy 回归护栏拆开。之前把 `js/app/suitePracticeMixin.js`、`js/runtime/unifiedReadingPage.js` 混在 suite Vue capability 的 `apiSurface` 里，属于数据结构垃圾，会误导后续删除判断。
- 迁移矩阵现在表达得更准确：`suite-reading-practice` 的 Vue surfaces 包括 `/api/practice/reading-suite`、Electron `openPracticeRoute()`、旧首页 `app-actions.js -> /reading-suite/:sessionId`、`PracticeReadingSuitePage.vue` 和 `PracticeReadingPage.vue`；legacy fallback surface 单独列出 `suitePracticeMixin.js` 与 `unifiedReadingPage.js`。
- 新增 `developer/tests/js/legacySuiteVueRoute.test.js` 并接入 `developer/tests/ci/run_static_suite.py`，覆盖旧首页套题入口 Vue-first、请求 payload、route IPC、`test_env` fallback 和无 Electron API fallback。
- Slice 12 进一步压实套题产品入口：`tryStartVueReadingSuite() -> false -> startLegacySuite()` 这种控制流已删除，改成 `startVueReadingSuite()` 和 `startExplicitLegacySuiteRegression()` 两条明确路径。`continueSuitePractice` 的公开 `AppActions`/global 导出也已删除，因为当前产品 shell 没有引用这个旧桥。
- `legacySuiteVueRoute.test.js` 现在覆盖 `test_env=1`、`suite_test=1`、`ci=1` 三个显式回归 flag，并新增 route IPC 返回 `{ success:false }` 时不启动 legacy 的断言。
- `practiceVueShell.test.js` 新增源码契约：产品 suite 路径不得重新出现 `tryStartVueReadingSuite`、`startedInVue`、`return startLegacySuite(selection)` 或公开 `continueSuitePractice` 导出。
- 迁移矩阵的 suite deletion gate 已改成“Product suite reading is Vue-only; Vue/API/route failure surfaces an error and never starts legacy”。`legacyFallbackEnabled: true` 只能理解为听力/启动恢复/显式回归表面仍存在，不是阅读产品路径自动兜底。
- Slice 9 后，正常单篇阅读和正常套题阅读都不再需要 legacy reading runtime 作为入口；剩余删除 blocker 收缩为听力、诊断、PDF/manual、forced legacy、无尽/随机等未完全迁移或显式 fallback 表面。
- Slice 10 入口清理确认：`electron/preload.js` 不再暴露 `openWriting()` 或 `openLegacy()`，只保留 `openPracticeRoute()`、`openPracticeReading()` 和 `getLocalApiInfo()` 等壳层能力。
- `electron/main.js` 不再注册 `navigate-to-writing` 或 `navigate-to-legacy`，也不再保留 `loadWritingPage()` / `loadLegacyPage()`。Vue 构建缺失时使用 `loadBootRecoveryPage()` 打开 `index.html`，语义上是启动恢复，不是产品 fallback 入口。
- 旧首页 More 工具里的写作入口已经改为 `electronAPI.openPracticeRoute('/writing')`，失败时给出非阻塞错误反馈；这消除了“写作模块独立顶层页面”的最后公开入口。
- `electron/pages/writing.html` 已删除，且 `electron/pages/` 目录为空。这个占位页调用已删除的 `openLegacy()`，继续保留只会制造死入口。
- `server/src/lib/practice/migration-status.ts` 现在把写作能力也记录为 Vue primary，并把 `electronAPI.openPracticeRoute('/writing')` 写进 writing capability 的 `apiSurface`；删除准则新增“无 standalone writing navigation IPC”。
- `simulation_roundtrip_restore_regression.py` 的稳定失败根因不是按钮消息断裂，而是 `suite_test=1` 直通 legacy fallback 时跳过 modal，导致名为 simulation 的回归实际跑了 classic。测试已显式预设 `suite_flow_mode=simulation` 并等待真实 `SIMULATION_CONTEXT`，避免再用 Reset 按钮伪装“上一题”。
- Slice 10 runtime asset 审计确认：`assets/scripts/complete-exam-data.js` 和 `assets/scripts/listening-exam-data.js` 仍是 `index.html` boot recovery / 听力迁移路径的数据源，不能删；但 Python 阅读解析生成/监督脚本不是运行时资产，继续放在 `assets/scripts` 是边界垃圾。
- `assets/scripts` 现在只保留两个运行时考试索引 JS：`complete-exam-data.js` 与 `listening-exam-data.js`。旧 `generate_reading_explanations.py`、`run_reading_explanation_opencode_batch.py`、`run_reading_explanation_supervisor_pool.py`、`monitor_reading_supervisor.py` 已删除。
- 仍有单元测试价值的 `generate_reading_explanations_with_agent.py` 已迁到 `developer/tests/tools/reading-explanations/generate_reading_explanations_with_agent.py`，并更新 `developer/tests/py/test_reading_explanation_generator.py`。这个工具属于开发/数据生产链，不属于 packaged runtime。
- `developer/tests/ci/run_static_suite.py` 新增 `assets/scripts` 运行时边界门禁，只允许 exam index JS 数据文件存在；`server/src/lib/practice/migration-status.ts` 的删除准则也记录了同一边界，防止 Python/supervisor 工具回流到生产资产目录。
- 只读子代理和本地引用扫描一致确认：`developer/tests/e2e/mock_eval_flow.py`、`mock_upload_flow.py`、`path_compatibility_playwright.py` 不在当前 `run_static_suite.py` / `e2e_runner.py` / required E2E 调度图里。真实写作评测/上传覆盖在 `phase05_eval_flow_e2e.py`、`phase05_upload_flow_e2e.py` 和当前写作草稿 E2E；旧 mock 脚本继续保留只会制造假覆盖。
- `path_compatibility_playwright.py` 的私有 fixture `developer/tests/e2e/fixtures/index.html` 以及两个 `睡着过项目组(9.4)[134篇]` placeholder HTML 只被该死脚本引用，已删除；`data-integrity-import-sample.json` 仍被 `developer/tests/js/e2e/appE2ETest.js` 和静态套件使用，必须保留。
- `developer/tests/ci/run_static_suite.py` 新增 E2E 死脚本边界门禁，禁止 `path_compatibility_playwright.py`、`mock_eval_flow.py`、`mock_upload_flow.py` 和它们的私有 fixture 页面回流。
- Slice 11 Shared/Data 审计确认：Practice 服务、阅读 asset loader、套题 session、历史 store 和路由层都存在重复的 HTTP error / pagination / JSON / response envelope 语义。继续复制这些 helper 会让阅读链路 Vue 化后又长出新的兼容垃圾。
- `server/src/lib/shared/http.ts` 现在统一 `createHttpError()`、`normalizePagination()` 和 `paginate()`；`PracticeService`、`reading-assets.ts`、`reading-suite-sessions.ts`、`PracticeHistoryStore` 已接入共享实现，不再保留本地 `makeHttpError` / `clampPagination` / `normalizeLimit` 分支。
- `server/src/lib/shared/json.ts` 现在统一安全 JSON parse/stringify，`PracticeHistoryStore` 使用同一实现处理 SQLite JSON 列。坏 JSON 不再是不可控异常入口。
- `server/src/lib/shared/response.ts` 现在统一 Practice route 的 `{ success: true, data }` 和 error envelope 发送；`server/src/routes/practice.ts` 不再逐个 route 手写成功/失败响应。
- Practice route schema 不再提前拒绝 `limit > 200`；分页上限由共享 `normalizePagination()` clamp 到 200。之前 Zod `.max(200)` 和服务层 clamp 同时存在，是两个主人管同一规则的垃圾设计。
- `apps/writing-vue/src/api/practice-client.js` 现在用 `practicePath()` 统一 API path segment encoding；各 facade 方法不再重复拼 `encodeURIComponent()` 路径。
- Slice 17 删除 `recoverReadingSubmission()` 和 corrupt `submission_json` legacy recovery。初代 Electron 客户端无旧用户数据需要保留；坏 canonical JSON 应暴露数据损坏，而不是靠旧 shadow 抢救。
- API/static 覆盖已改为锁住 pagination clamp、shared response/http/json helpers、Vue `practicePath()` 边界，以及 Practice history 不得重新出现 `legacy_record_json` / `legacyRecord` / `realData` / `resultSnapshot` shadow。
- 5.3 子代理 Slice 11 只读审计确认：下一真实数据风险是 `readingSuiteSessions` 仍仅保存在内存 Map，进程重启会丢 active suite progress；已提交 passage 有 history，但未完成套题状态尚未持久化。下一小切片应做 suite session persistence 或明确 resume policy。
- Slice 13 已移除 `PracticeService` 对 suite 会话的内存所有权：新增 `ReadingSuiteSessionStore`，通过 `practice_reading_suite_sessions` SQLite 表保存 `session_json`、状态、currentIndex、flow/frequency 和完成时间。没有 SQLite 时才使用内存 Map，避免 packaged Electron 产品路径长期驻留进程状态。
- `PracticeService.createReadingSuite()` / `getReadingSuite()` / `submitReadingSuitePassage()` 现在都通过 `ReadingSuiteSessionStore` 读写套题状态；提交 passage 后保存 history，再保存 suite session，返回持久化后的 session snapshot。
- `electron/db/schema.sql` 和 `electron/db/migrations/20260209_phase06_schema.sql` 已加入 `practice_reading_suite_sessions` 表和 `idx_practice_suite_status_updated_at` 索引。suite active progress 现在是数据层事实，不是 renderer/server 进程临时对象。
- `practiceApiFacade.test.js` 的 fake SQLite adapter 现在覆盖 suite session upsert/select/delete SQL，并新增跨 `createServerApp()` 实例的 suite 进度恢复测试：提交 P1 后重启服务可恢复 `currentIndex=1`，继续提交 P2 后再次重启可恢复 `currentIndex=2`。
- `practiceVueShell.test.js` 新增源码契约：`PracticeService` 必须使用 `ReadingSuiteSessionStore`，不得出现 `readingSuiteSessions = new Map`；schema/migration/store 都必须包含 suite session 表，防止数据层倒退。
- Slice 14 只读审计确认：Practice 阅读资产生产 VM 入口有两个，分别是 `PracticeService` 读取 `manifest.js` 和 `reading-assets.ts` 读取 generated exam data。两者都服务同一个数据事实，不应该分散执行脚本。
- `server/src/lib/shared/generated-json.ts` 现在提供 generated assignment/register JSON 容器解析；`server/src/lib/shared/reading-generated-data.ts` 在其上定义 reading manifest、exam、explanation 三种注册数据合同。
- `server/src/lib/practice/reading-assets.ts` 现在复用 shared reading parser 解析 manifest 与 exam payload：`__READING_EXAM_MANIFEST__ = {...}` 和 `__READING_EXAM_DATA__.register("key", {...})` 被线性扫描提取后用 `JSON.parse` 解析，不再通过 `vm.runInNewContext` 执行。
- 当前 generated reading assets 的实际合同是双引号 JSON object literal。若未来生成器输出注释、尾逗号、模板字符串或函数，Practice runtime 会明确失败；这是正确的硬约束，不应再用 VM 帮垃圾数据“跑起来”。
- `p2-low-051` 覆盖了压缩 wrapper 场景，API 测试验证 payload、题号映射、答案键、正文和 radio/text 交互模型都能在 VM-free parser 下加载。
- `practiceVueShell.test.js` 现在锁定 `server/src/lib/practice/reading-assets.ts VM-free JSON parser`、`server/src/lib/shared/reading-generated-data.ts shared parser`、`server/src/lib/reading/coach-service.ts VM-free generated data loader` 和 `without node:vm or runInNewContext` 删除门槛；Practice 与 ReadingCoach runtime 都不能重新引入 generated JS 执行。
- Slice 16 审计确认：`ReadingCoachService` 原先也用 VM 读取 `assets/generated/reading-exams/*.js` 和 `assets/generated/reading-explanations/*.js`。这不是 AI 逻辑，是第二条 generated-data 执行路径；保留它会让 Coach 检索继续绕过 shared 数据合同。
- `ReadingCoachService` 现在通过 `parseReadingExamDataSource()` / `parseReadingExplanationDataSource()` 读取原始 exam/explanation payload，并保留 `buildReadingChunks()` 需要的原始字段，不使用 UI 归一化后的 `loadReadingPracticePayload()`。
- `readingAnalysisService.test.js` 现在同时做源码契约和真实 fixture 行为契约：Coach 不得包含 `require('vm')` / `runInNewContext`，且 `p1-high-01` exam/explanation 注册 payload 能被 shared parser 直接解析。
- Slice 15 审计确认：`PracticeService.readingSessions = new Map()` 是单篇阅读提交态的重复真相源。阅读提交已经同步写入 `PracticeHistoryStore`，继续保留 Map 只会增加 Electron 长跑内存和重启不一致风险。
- `PracticeService.createSession(reading)` 与 `submitReadingSuitePassage()` 现在只保存 `historyStore.saveReadingSubmission()`；`getSessionState(reading)` 和 coach session context 只通过 `historyStore.getReadingSubmission()` 恢复提交态。
- 已提交 reading session 不再支持 `DELETE /api/practice/sessions/reading/:sessionId` 删除进程缓存；该接口返回 `practice_session_not_cancellable`。这是正确合同：同步提交态是历史记录，不是可取消 active job。
- `PracticeHistoryStore.upsert()` 现在只有在没有 SQLite DB 时才写 `memoryRecords`。有 DB 的 packaged Electron 路径只写 `practice_history_records`，不再把所有历史记录常驻进程内存。
- `practiceApiFacade.test.js` 新增断言：已提交阅读 session 删除返回 409，删除尝试后仍可通过 session replay 读取提交记录。`practiceVueShell.test.js` 新增源码契约：`PracticeService` 不得出现 `readingSessions` / `this.readingSessions`。
- Slice 17 审计确认：`PracticeHistoryStore` 原先同时维护 canonical `submission_json`、`legacy_record_json`、`legacyRecord.realData` 和 `legacyRecord.resultSnapshot`，同一份 reading submission 至少被复制三次。这是 SQLite 体积、JSON parse/stringify 成本和数据所有权分裂的真实 Electron 性能问题。
- `ReadingPracticeSubmission` 现在直接拥有 `readingCoachSnapshot` 和 `readingCoachTranscript`；`attachReadingCoachResult()` 复制并回写 canonical submission，history detail/replay 不再需要 legacy shadow 才能恢复 AI coach 上下文。
- `PracticeHistoryRecord` 合同删除 `legacyRecord`；`PracticeService.getSessionState(reading)` 只返回 `submission.legacy` 这种小的 Vue event metadata，不再返回大 legacy record。
- `electron/db/schema.sql`、`electron/db/migrations/20260209_phase06_schema.sql` 和 `PracticeHistoryStore.ensureSchema()` 都不再创建 `legacy_record_json`。检测到已有 shadow column 的旧开发库会重建 `practice_history_records`，不迁移旧数据。
- Slice 18 审计确认：`/api/practice/history` 列表路径在 Slice 17 后仍通过 `SELECT *` 读取每行 `submission_json` 并调用 `rowToRecord()` 解析完整 `ReadingPracticeSubmission`。Vue `PracticeLibraryPage.vue` 的最近复盘只使用 `id/sessionId/assetId/examId/title/score/totalQuestions/correctAnswers/accuracy/submittedAt`，因此列表解析答案、analysis artifacts、coach transcript 是真实 Electron hot-path 垃圾。
- `PracticeHistorySummary` 现在成为 history list 和 create/submit response 的轻量合同；`PracticeHistoryRecord` 只用于 history detail、session replay、coach transcript persistence。SQLite list SQL 明确选择 summary columns，不读 `submission_json`。
- Slice 19 审计确认：VM-free 后的 Practice reading asset loader 仍在每次详情、单篇提交、套题每篇提交时读盘并解析同一个 generated exam wrapper。manifest 只在 `PracticeService` 实例内缓存，服务实例重建后就丢；payload 完全不缓存。这是 Electron 本地服务 CPU/IO 热路径，不是理论优化。
- `server/src/lib/practice/reading-assets.ts` 现在是 reading manifest 与 normalized payload 的单一 loader/cache owner。manifest 缓存提升到模块级；generated exam payload 通过 32 条有界 LRU cache 复用，detail、single submit、suite submit 共享同一 normalized payload，不再每条业务链路重复读盘解析。
- Vue E2E mock 已拆成 `readingHistoryRecords` summary array 与 `readingHistoryDetails` detail map，防止测试继续把完整 submission 藏进列表响应。回放路径仍通过 `/api/practice/sessions/reading/:sessionId` 读取 full submission。
- Slice 20 审计确认：`ReadingCoachService` 在 VM-free 后仍保留两个进程级裸 `Map`：`examBundleCache` 无容量上限，`queryCache` 只靠 TTL 被动过期。对 packaged Electron 的本地 server 来说，长时间 AI coach 使用会让 generated exam bundle、chunks、query response 常驻增长，这是数据结构问题，不是需要额外清理脚本的问题。
- `server/src/lib/shared/cache.ts` 现在提供共享 LRU touch 和 bounded set 原语；Practice reading asset loader 与 ReadingCoach 都复用它。缓存规则不再散在各自文件的 while/delete 分支里。
- `ReadingCoachService` 现在用 12 条 exam bundle cache 和 64 条 query cache。query cache 仍保留 TTL 语义，但写入前会清理过期项，并在超限时淘汰最老 entry；exam bundle cache 命中会刷新 LRU，超限会淘汰最老 bundle。
- Slice 21 审计确认：`EvaluateService.sessionEventCache` 原本只有单 session 80 条 event 上限，没有 replay session 数量上限；15 分钟 TTL 窗口内连续写作评测会让 SSE hydration event 常驻增长。这是 Electron 本地服务的真实内存风险，不是 UI 问题。
- 写作评测现在把 `sessionEventCache` 明确定义为 transient replay cache，而不是用户数据。持久评测结果仍由 essay/evaluation 存储负责；SSE replay 只保留最近 24 个 session，每个 session 保留 80 条尾部 event。
- `EvaluateService` 现在复用 shared cache helper 做 replay cache LRU touch/write；过期或淘汰 inactive replay session 时同步删除 `sessionProgress`，避免 progress Map 留下另一份无意义状态。
- `writing_contract_probe.cjs` 已覆盖写作 SSE replay cache 的双重边界：单 session 事件尾部保持 80 条，总 replay session cache 保持 24 条，并验证被淘汰 session 不再返回 cached events。
- Slice 22 审计确认：写作历史 `/api/essays` 列表路径仍由 `EssaysDAO.list()` 读取 `e.*`，返回 `content` 和 `evaluation_json`，并由 `EssayService.list()` 解析每行 evaluation JSON 来恢复题目显示。这对 Electron 本地历史页是热路径垃圾：列表页需要的是题目、分数、时间、模型和字数，不需要整篇作文和完整评测树。
- `essays.topic_text` 现在是写作历史行级快照。题库题目仍可通过 `topics.title_json` 展示，自由写作或评测上下文题目通过 `topic_text` 展示/搜索，不再把题目文本埋进 `evaluation_json.input_context` 当列表元数据。
- `electron/db/dao/essays.dao.js` 的历史列表 SQL 现在显式选择 summary columns：`id/topic_id/topic_text/task_type/word_count/provider/model/scores/submitted_at/topic_title`，不选择 `content` 或 `evaluation_json`。详情 `getById()` 仍使用 `e.*`，这是允许读取完整 payload 的路径。
- 写作历史搜索现在扫描 `topics.title_json`、`essays.topic_text` 和 `essays.content`，不再扫描 `e.evaluation_json LIKE ?`。继续搜正文是产品功能；扫描评测 JSON 是数据结构垃圾。
- `EssayService.list()` 使用 `_decorateEssaySummary()`，只解析 `topic_title` 并合成 display fields；`_decorateEssayRecord()` 保留给详情路径，仍解析 evaluation JSON 并兼容 `input_context` 内的详细分析。
- `server/src/lib/writing/evaluate-service.ts` 在持久化评测时写入 `topic_text: session?.topic_text || null`，使历史摘要拥有自己的显示/搜索数据，不再依赖 detail payload。
- `developer/tests/ci/writing_essay_history_contract.cjs` 用 poisoned getters 证明 list summary 不读取 `content` / `evaluation_json`，并证明 detail 仍解析完整 evaluation JSON。`writing_backend_contract.py`、`practiceVueShell.test.js`、`practiceApiFacade.test.js` 和 static suite 都锁住同一边界。
- UX 纠偏审计确认：当前 Vue `PracticeLibraryPage.vue` 把用户入口改成了 `Practice Library / 统一练习库 / Migration State / Reading Reviews`。这不是 legacy Vue 化，而是把工程迁移状态暴露成产品 UI，破坏了原来的“考试总览系统”心智模型。
- legacy 顶层信息架构是产品行为：标题 `考试总览系统`，导航为 `总览`、`题库浏览`、`练习记录`、`更多`、`设置`。这套结构是用户的主路径，不应该被 `/library`、`写作工作台`、`迁移矩阵` 替换。
- legacy 总览的核心动作是 `P1/P2/P3 阅读` 分类卡，每张卡有 `浏览题库` 和 `随机练习`；阅读区右上还有 `套题模式` / `无尽模式`。这些点击路径必须在 Vue 中保留同样的中文标签、位置关系和行为语义。
- legacy 题库浏览的核心动作是顶部类型筛选、搜索、排序、列表位置记录、题目列表卡片、`开始练习` 和 `PDF`。当前 Vue asset row 只有 `查看阅读`，这改变了用户预期，属于体验回退。
- legacy 阅读练习页的左右阅读/答题工作区、原题 HTML、原生输入/拖拽、提交后复盘路径是用户体验合同。Vue 可以替换 DOM 管理和数据层，但不应该先引入额外 Answer Sheet/AI Coach 面板抢占原有阅读节奏。
- 新的重构原则：先做 UI/UX 同构迁移，再做内部数据层压实。视觉上尽量沿用 `hero-body`、`hero-nav`、`hero-panel`、`category-card`、`exam-item` 等旧类名/布局语义；内部实现可以是 Vue components + Practice API。
- Slice 84 settings/more 审计确认：`origin/opensource@44a552f` 的更多页把 `writing-entry-btn` 注释掉，但当前 Vue 默认入口是阅读式 `PracticeLibrary`，且 `App.vue` 对 `PracticeLibrary` 隐藏顶部写作导航。更多页可见写作卡片因此是写作 userspace 入口保护，不是需要删除的 UI 漂移。
- Slice 84 发现真实设置页 bug：Vue `#force-refresh-btn` 与 `#load-library-btn` 都调用普通 `loadReadingData()`，而服务端 `reading-assets.ts` 已有 bounded manifest/payload cache。用户点击“强制刷新题库”不会清 cache，更新 generated reading assets 后仍可能看到旧 manifest/detail payload。
- Slice 84 refinement：`practiceAssets.listAll(..., { refresh: true })` 不能把 `refresh=true` 发送到每个分页请求。强刷的真实语义是“先清一次 cache，再读完整列表”；分页后续页应复用同一次刷新后的 manifest，否则把一个用户动作变成 N 次 cache invalidation，是副作用扩散。
- Strategy pivot after Slice 84：稳定目标已经过了“补齐护栏”的拐点。后续只把会破坏用户流程、数据结构、Coach/history/replay 的问题转成必修；隐藏 marker、精确 class/CSS、截图证据、迁移矩阵是否出现在 UI 这类微观一致性默认降级为可延期。继续给这些差异加静态锁是护栏堆砌，不是产品能力。
- CORE-10 closure exposed three real regressions that flaky E2E symptoms had been hiding:
  1. `App.vue` wrapped frameless practice routes in `transition mode="out-in"`, which could leave `router-view` empty after reading routes returned to `#/`.
  2. `PracticeReadingPage.vue` hydrated replay state too early inside the asset-load callback, before composable asset/payload refs had committed; `assignAnswer()` then saw the wrong `questionOrder`, so replay dragdrop answers like `q12` never entered canonical answer state.
  3. The Vue suite-reading E2E still assumed every suite submit must stop on a review panel. Current product behavior can auto-advance to the next passage or return to suite progress, so the test had become the garbage assumption instead of the product.
- CORE-10 fix decisions:
  - Frameless practice routes now render directly in `App.vue`; only shell pages keep route transition animation.
  - Reading replay hydration now happens after `loadReadingAsset()` commits payload state, then initializes answers/notes/suite state before replay restore. This keeps answer ownership aligned with the composable model.
  - Reading answer/dropzone DOM synchronization stays as a post-render concern because `v-html` question DOM can be re-rendered after review/coach updates; a one-shot sync is not reliable userspace behavior.
  - Dropzone sync now applies to all matched nodes for a question id, not only the first accidental DOM match.
  - Reading E2E archive import now asserts real business completion (`import POST` + history count) instead of an ephemeral toast copy string.
  - Vue suite-reading E2E now accepts both valid post-submit states: review-stop and auto-advance.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Plan around a unified `PracticeSession` domain instead of separate Reading/Writing states | Separate module state is likely the source of duplicated settings, random API calls, and UI switching debt. |
| Keep legacy reading contracts as temporary adapters during migration | Direct deletion risks breaking current Electron users and E2E practice flow. |
| Do not extend `useDraft` with reading-only branches | That would preserve the current bad architecture. The draft boundary should move to a generic session snapshot. |
| Preserve reading coach internals as a service capability, but wrap them behind a unified practice API | The coach has useful retrieval/prompt logic; the garbage is the lifecycle/API boundary, not the AI logic itself. |
| Make the Vue app the future primary renderer, not a secondary writing app | Electron already supports packaged asset loading through `app://app/`; keeping legacy as primary preserves the bad transition state. |
| In Slice 0, make reading sessions explicitly unimplemented instead of silently emulating legacy | A fake session facade would hide missing lifecycle ownership and create another compatibility trap. |
| In Slice 1, expose reading assets but do not start reading sessions from Vue yet | Rendering metadata is safe; pretending session lifecycle exists would create another compatibility trap. |
| Preserve existing writing draft before Practice Library query hydration | Overwriting a user draft just because a new asset link was opened is a user-data regression. |
| Delete product-level `openLegacy()` and `navigate-to-legacy` | The old renderer is no longer a product destination; unresolved surfaces must be boot recovery, listening migration, or explicit regression guards. |
| Use a server-side reading asset loader instead of letting Vue execute generated exam scripts | The generated files are registration scripts, not stable JSON modules. Executing them in Vue would preserve the legacy coupling and scatter compatibility garbage into the renderer. |
| Represent old drag/drop questions as select fallback in Slice 2 | It preserves answerability without pretending the full legacy drag/drop restore/review behavior is already migrated. |
| Keep reading session creation at 501 until submit/scoring/review is implemented | Returning a fake completed reading session would break userspace expectations and hide missing lifecycle ownership. |
| Move reading scoring into server-side Practice sessions instead of Vue | A renderer-side scoring copy would immediately create another API/UI split. The server owns canonical comparison and review payloads. |
| Treat checkbox array answers as sets, but non-checkbox arrays as alternatives | The generated reading data overloads arrays. `interactionModel` gives the missing data structure needed to remove that special-case ambiguity. |
| Keep reading sessions in memory for Slice 3 | It proves the PracticeSession lifecycle without prematurely wiring persistence. Canonical history/replay is the next slice. |
| Let coach session context override Vue-provided attemptContext only for known submitted sessions | New Vue can stay thin, while old explicit coach calls keep working. |
| Store new Vue reading history in packaged Electron SQLite instead of legacy localStorage | The product target is Electron. Extending the old browser storage path would preserve the two-world debt. |
| Keep writing HistoryPage untouched for Slice 4 | That page models IELTS writing scores. Mixing reading accuracy into writing radar stats would be a data-structure lie. |
| Use the same PracticeReadingPage for draft and replay | A second review page would duplicate answer rendering and readonly logic. Route state is enough to select mode. |
| Model dropzone as `dragdrop/dropzone`, not `select/dropzone_fallback` | The product behavior is drag/drop with a fallback control, not a select question. The data model must say that plainly. |
| Generate reading analysis artifacts server-side, not in Vue | Vue can observe attempts, but the server owns canonical score/review/history contracts. Duplicating analysis logic in the renderer would recreate the old split-brain. |
| Persist analysis artifacts in canonical `ReadingPracticeSubmission` only | Old `realData` / `resultSnapshot` shadows were migration baggage. The initial Electron client has no old user data contract, so duplicating the same artifact into legacy fields is wasted storage and a future inconsistency bug. |
| Make `dist/writing/index.html` the Electron default entry for the unified Practice Shell | The directory name is legacy from the writing island, but the renderer now hosts Practice Library, Vue reading, writing, history, settings, and migration status. Renaming the build output is lower priority than eliminating the wrong default entry. |
| Delete `openWriting()` / `navigate-to-writing` after `/writing` became a Practice Shell route | Keeping a standalone writing IPC would preserve the fake two-page architecture after the route already exists inside Vue. |
| Expose migration state as typed API data instead of comments | Deletion criteria and fallback status must be asserted by tests, not remembered by engineers. |
| Do not delete legacy reading runtime in this slice | Suite/simulation and listening are still real product paths and currently only pass through legacy. Deleting now would break userspace. |
| Use Electron route IPC instead of `window.location.href` from legacy single-reading | The product target is packaged Electron. Main process should own app entry navigation and source validation; renderer pages should not mint arbitrary app URLs. |
| Keep suite/review in legacy during Slice 7 even when Practice route IPC exists | At that point their lifecycle still depended on legacy window/session orchestration. Slice 8 replaces suite session orchestration with Vue/Practice API while leaving legacy suite as a regression fallback. |
| Make suite reading Vue-primary through a dedicated `ReadingSuiteSession` API | The suite business object is sequence/progress/aggregate. Copying old window orchestration into Vue would preserve the bad design. |
| Keep legacy suite E2E after Vue suite migration | Userspace still depends on listening and old fallback surfaces. Legacy should be deleted only after Vue replacement and regression gates both pass. |
| Route legacy homepage suite launch to Vue before deleting legacy suite runtime | Old homepage buttons are still reachable fallback UI. Leaving the suite button on `suitePracticeMixin` would keep a real product path on the old runtime. |
| Add `legacyFallbackSurface` to migration capabilities | Vue primary surfaces and deletion fallback surfaces are different data. Mixing them in `apiSurface` makes deletion criteria ambiguous. |
| Keep `test_env` suite path on legacy during Slice 9 | The required `suite_practice_flow.py` is an explicit legacy fallback regression gate; moving it to Vue would remove the guard before listening and diagnostics are handled. |
| Keep `assets/scripts` runtime-only | Production assets should carry exam-index data, not Python generation loops. Developer-only reading explanation tooling belongs under `developer/tests/tools`, and dead supervisor scripts should be deleted instead of hidden behind package excludes. |
| Delete mock/path E2E dead scripts | Mock-only E2E scripts are not valid regression coverage once real HTTP/Vue flows exist; unowned path-compat fixtures should be removed with the script that exclusively used them. |
| Delete orphaned Electron debug runners | `electron/test_main.js`, `electron/test-electron-module.js`, and `electron/test_api_runner.js` were standalone debug scripts outside the current runtime/static/E2E graph. Deleting them and removing package excludes keeps the Electron bundle boundary explicit instead of hiding dead files. |
| Move Practice HTTP/pagination/JSON/response helpers into `server/src/lib/shared/` | These are cross-cutting contracts, not feature-local trivia. Keeping local copies in service/history/routes creates silent divergence and makes data recovery behavior hard to test. |
| Let shared pagination clamp overlarge limits instead of rejecting them at route schema level | The service contract already defines the max. Route-level `.max(200)` created a second rule owner and turned a recoverable pagination request into a hard API error. |
| Delete corrupt `submission_json` recovery from legacy history shadow | The refactor target is an initial Electron client with no old data compatibility requirement. Recovery from shadow payloads keeps the shadow alive; the cleaner contract is canonical `submission_json` only. |
| Centralize Vue Practice path encoding in `practicePath()` | API segment encoding is a shared client concern. Repeating `encodeURIComponent()` in every method makes endpoint changes brittle and easy to miss. |
| Persist suite session progress through `ReadingSuiteSessionStore` | A process-local suite Map is the wrong data owner for an Electron app. Active suite progress must survive local server restarts and must not grow unbounded in product memory. |
| Parse Practice reading assets as JSON data, not executable scripts | The Practice renderer/server hot path only needs manifest and exam payload data. Executing generated wrappers through `node:vm` is heavier, expands the trusted code surface, and hides bad generated data behind script behavior. |
| Restore submitted single-reading sessions from `PracticeHistoryStore` | Submitted reading sessions are history facts, not active jobs. Keeping the same submission in a `PracticeService` Map duplicates state and wastes memory in the packaged Electron server. |
| Parse ReadingCoach generated exam/explanation assets through shared JSON data contracts | Coach retrieval needs raw exam and explanation payloads, not executable wrappers. Sharing the parser removes the second runtime script-execution path while preserving chunk-building inputs. |
| Return `PracticeHistorySummary` from history lists and create responses | List pages need searchable/review-launch metadata, not answers, analysis artifacts, or coach transcripts. Full `submission_json` belongs to detail/replay only; parsing it on every list row is wasted SQLite/JSON work in Electron. |
| Cache normalized reading asset payloads in the loader layer with a fixed bound | Generated reading assets are static data. Re-reading and re-normalizing the same exam for detail, submit, and suite submit is avoidable CPU/IO in Electron; putting the cache in `reading-assets.ts` keeps ownership in the data layer instead of scattering state across `PracticeService` instances. |
| Share bounded LRU cache primitives across Practice assets and ReadingCoach | Both paths cache static/generated reading data. Duplicating local Map-pruning code is a regression trap; a shared cache primitive keeps the data-layer policy small, testable, and consistent. |
| Bound writing SSE replay cache by session count and event count | SSE replay is UI hydration state, not persisted user data. Keeping it unbounded in a long-running Electron local server is garbage data ownership; bounding it keeps resume behavior without growing memory forever. |
| Persist writing `topic_text` as a first-class essay row field | History list/search needs topic text without parsing full evaluation payloads. Row-level summary metadata keeps list, export, and detail paths honest. |
| Split writing essay history summary decoration from full record decoration | `_decorateEssaySummary()` avoids `evaluation_json` parsing on list/export paths, while `_decorateEssayRecord()` preserves full detail behavior. One function doing both was the source of wasted JSON work. |
| Treat legacy reading UX as the migration contract | The old renderer implementation can be deleted, but the overview/browse/records/read-through user journey must be preserved. Vue is the implementation, not permission to redesign the product. |
| Remove migration matrix from normal user surfaces | Migration state is engineering telemetry. Showing it in the main practice library increases cognitive load and violates the original overview workflow. Keep it in tests/dev docs unless explicitly debugging. |
| Keep the More-page writing card in Vue while the reading shell hides top writing nav | OpenSource latest comments out the card, but the current packaged Electron default opens the reading shell without top writing navigation. Removing the card now would make writing harder to discover and break userspace. |
| Make reading asset force refresh an explicit Practice API query | `force-refresh` is a user-facing settings action. It must clear the server-side reading manifest/payload cache, while ordinary `load-library` should keep the bounded cache hot path. |
| Limit full-pagination force refresh to the first asset-list page | Cache invalidation is the side effect. It should happen once per user refresh action, then all pagination pages should read the refreshed manifest instead of repeating invalidation. |
| Stop expanding micro-fidelity static guards | Tests should protect three hard surfaces: user flow, canonical data, and Coach/history/replay. DOM marker, hidden class, screenshot, and copy-level assertions are low signal unless they guard a real click path or persisted contract. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| `python` executable is missing in this environment | Used `python3` for the required scripts and recorded the deviation. |
| Initial `practiceApiFacade.test.js` expected raw facade payload before existing writing service normalization | Adjusted the test to lock the actual existing contract: `api_config_id` is normalized into `config_id` by `WritingEvaluationService`. |
| `practiceVueShell.test.js` initially asserted an old hydration call shape | Updated the assertion to lock draft-preserving hydration instead of a brittle zero-argument call. |
| `practice_reading_vue_flow.py` initially exercised stale `dist/writing` output | Added mtime-based rebuild logic so the E2E rebuilds when Vue source is newer than the bundle. |
| Full interaction coverage test exceeded the API pagination limit with `limit=300` | Switched to paginated scans with `limit=200`, preserving the API guardrail. |
| Required `python` commands still cannot run in this environment | Re-ran the exact required scripts with `python3`; both passed. |
| `suite_practice_flow.py` logs two existing DataCollection save-verification console errors while passing | Recorded as residual legacy-suite noise; the script exits 0 and reports test pass. |
| `better-sqlite3` native binding is unavailable in the current Node test runtime | Avoided a brittle native dependency in the JS contract test by using a focused fake SQLite adapter for the PracticeHistoryStore SQL surface. |
| Vue drag/drop replay initially restored the answer panel but not the native dropzone DOM | Moved DOM sync until after `loading=false` and `nextTick()`, so the `v-if` gated reading workspace exists before syncing dropzone state. |
| TypeScript rejected the initial highlight normalization because `scope` was inferred as plain string and the filter predicate narrowed to an incompatible optional-field interface | Rewrote `normalizeHighlights()` as explicit typed array accumulation, removing brittle inference and restoring `npm run build:server`. |
| TypeScript rejected `PRACTICE_MIGRATION_STATUS` when wrapped in `Object.freeze()` because literal `renderer/support` values widened to `string` | Removed the pointless freeze and used the `PracticeMigrationStatus` annotation as the contract. |
| Required `python` commands still cannot run in this environment | Recorded the failure and reran the exact required suites with `python3`; both passed after Slice 6. |
| `practiceVueShell.test.js` pinned the old `loadPracticeShellPage()` signature | Updated the test to assert route-aware behavior instead of brittle no-argument syntax. |
| `practiceVueShell.test.js` and `practiceApiFacade.test.js` still asserted suite reading was legacy fallback | Updated both tests to lock the new reality: suite reading is Vue-primary through `/api/practice/reading-suite`, while legacy suite remains a verified fallback/deletion guard. |
| Legacy homepage suite adapter initially read `payload.sessionId`, but Practice routes return `{ success, data }` | Changed the adapter to read `payload.data.sessionId`, reject `success:false`, and updated `legacySuiteVueRoute.test.js` to use the real route envelope. |
| `simulation_roundtrip_restore_regression.py` failed with `unexpected_back_to_p1:p2-low-148` | The regression was running classic mode under `suite_test=1`; preset simulation preferences and wait for `SIMULATION_CONTEXT` before using next/prev buttons. |
| Earlier corrupt-history recovery required brittle type guards | Slice 17 deleted the recovery path instead of hardening it further; the underlying problem was the shadow data structure, not a missing guard. |
| `practiceApiFacade.test.js` internally runs `npm run build:server`, causing a possible build-race if started in parallel with a manual server build | The accidental parallel run passed, but subsequent verification is run serially to avoid `server/dist` churn. |
| `practiceApiFacade.test.js` initially failed after Slice 18 because the summary score assertion assumed all 13 questions were correct | Corrected the test to compare `historyRecord.score` and history list `score` with the canonical top-level `submission.scoreInfo.correct`; the actual partial-attempt score is 2. |
| 5.3 Codex subagent spawn failed because the thread limit was reached during the Slice 22 audit | Completed the writing history hot-path audit locally instead of blocking the refactor. |
| `writing_contract_probe.cjs` and `readingAnalysisService.test.js` were accidentally run in parallel while both can rebuild `server/dist` | Reran the affected contracts serially; both passed. Server-build-mutating tests should stay serial. |

## Resources
- `apps/writing-vue/src/`
- `server/src/lib/reading/`
- `server/src/routes/reading.ts`
- `electron/services/reading-coach.service.js`
- `developer/tests/ci/run_static_suite.py`
- `developer/tests/e2e/suite_practice_flow.py`
- `developer/tests/js/practiceApiFacade.test.js`
- `server/src/lib/practice/contracts.ts`
- `server/src/lib/practice/service.ts`
- `server/src/routes/practice.ts`
- `apps/writing-vue/src/api/practice-client.js`
- `apps/writing-vue/src/views/PracticeLibraryPage.vue`
- `apps/writing-vue/src/views/PracticeReadingPage.vue`
- `server/src/lib/practice/reading-assets.ts`
- `server/src/lib/practice/reading-sessions.ts`
- `server/src/lib/practice/migration-status.ts`
- `server/src/lib/practice/reading-suite-sessions.ts`
- `developer/tests/e2e/practice_reading_vue_flow.py`
- `developer/tests/e2e/practice_reading_suite_vue_flow.py`
- `developer/tests/js/practiceVueShell.test.js`
- `developer/tests/js/readingLaunchVueRoute.test.js`
- `developer/tests/js/legacySuiteVueRoute.test.js`
- `electron/main.js`
- `electron/preload.js`
- `js/presentation/moreView.js`
- `js/app/readingLaunchMixin.js`
- `js/app/examSessionMixin.js`
- `js/presentation/app-actions.js`
- `developer/tests/tools/reading-explanations/generate_reading_explanations_with_agent.py`
- `developer/tests/e2e/phase05_eval_flow_e2e.py`
- `developer/tests/e2e/phase05_upload_flow_e2e.py`
- `server/src/lib/shared/http.ts`
- `server/src/lib/shared/json.ts`
- `server/src/lib/shared/response.ts`
- `server/src/lib/shared/sqlite.ts`
- `server/src/lib/practice/reading-suite-store.ts`
- `server/src/lib/shared/cache.ts`
- `server/src/lib/writing/evaluate-service.ts`
- `developer/tests/ci/writing_contract_probe.cjs`
- `developer/tests/ci/writing_backend_contract.py`
- `electron/db/dao/essays.dao.js`
- `electron/services/essay.service.js`
- `electron/db/migrator.js`
- `developer/tests/ci/writing_essay_history_contract.cjs`

## Visual/Browser Findings
- In-app browser opened `http://127.0.0.1:5174/#/library` and confirmed the Vue Practice Shell renders without a blank screen; without Electron local API injection it correctly shows the local API unavailable state.
- Python Playwright smoke check injected a mock `electronAPI.getLocalApiInfo()` and confirmed `/library` renders mocked reading and writing assets, keyword filtering works, and clicking the writing asset navigates to `/#/?topicId=7&taskType=task2`.
- Browser screenshots were saved under ignored report paths:
  - `developer/tests/e2e/reports/practice-library-shell.png`
  - `developer/tests/e2e/reports/practice-library-start-writing.png`

## Slice 23 OpenSource JS Feature Mapping
- `origin/opensource@b225358` cannot be merged directly because it is still the static/legacy runtime; the safe path is feature extraction into the Vue/Electron Practice API boundary.
- Recent OpenSource suite mode changes add a flow selector (`simulation` / `classic` / `stationary`) and frequency scope selector (`high` / `high_medium` / `all` / legacy `custom`). Current Practice API already owns `flowMode` and `frequencyScope`; Vue must use those fields instead of adding new session columns or hardcoding `simulation/all`.
- Legacy `custom` suite selection implies an explicit P1/P2/P3 sequence. The current backend contract has no sequence override and should not receive a hurried new field. For now the Vue selector exposes the supported scopes and keeps manual asset selection in the browse/start path.
- PDF-only reading assets should not be represented as generated HTML payloads. `PracticeAsset.payloadRef` now means “real generated reading payload exists”; PDF fallback uses existing `metadata.script` and PDF metadata instead of a new boolean field.
- The AI/RAG backend chain is present: submit persists canonical `ReadingPracticeSubmission`, `/api/practice/coach/stream` reuses the reading coach service and prompt stack, and RAG retrieval is awaited before generation. The broken edge was frontend lifecycle: suite submit fired automatic review without waiting, so the user could navigate away before the coach patch was persisted.
- Vue suite submit now waits for the automatic review promise like single-reading submit. This preserves the existing prompt/API chain and removes the suite-only race without changing backend prompts.
- UI parity still has open debt: `PracticeReadingPage.vue` bottom answer panel and reading workspace layout are still more redesigned than the legacy unified reading page; subagent audit recommends restoring legacy `.shell`, `#left/#divider/#right`, `#question-nav`, settings/notes/selection toolbar skeletons next.

## Slice 24 Reading Page Legacy Interaction Recovery
- The correct migration boundary is “OpenSource capability into Vue”, not “legacy JS owns the page again”. Copying `unifiedReadingPage.js` wholesale would duplicate state ownership and risk breaking the already-working AI coach, submitted-session replay, and Practice API chain.
- `highlights` is the right canonical field for reading highlight/note state. The previous Vue submit path used `highlights: []`, which silently destroyed user highlighter context and made review replay incomplete.
- Reliable highlighter replay requires optional per-record metadata (`kind`, `before`, `after`, `occurrence`) in addition to `scope/text/startOffset/endOffset`. These are not new business facts; they are replay context for the existing `highlights` field.
- The bottom question nav must not contain answer controls. Answer inputs belong to the rendered question groups; `#question-nav` is navigation/status only. Keeping the hidden/proxy answer-control CSS around was dead code and a future regression trap.
- The legacy reading shell requires stable IDs/classes, not just similar visuals: `#settings-panel`, `#notes-panel`, `.overlay`, `#selbar`, `#divider`, `#question-groups`, `#question-nav`, `#reset-btn`, and `#submit-btn` are now protected by tests.
- The AI prompt chain was intentionally left intact. The automatic review prompt remains `请复盘我本次错题，按优先级给出训练建议`; the work fixed lifecycle/state loss, not prompt semantics.
- The full static suite first failed because it raced with an older Vue suite E2E selector (`提交并复盘`). After updating that test to the legacy `#submit-btn` contract, the full static suite passed.

## Slice 25 Reading Timer Bridge + Metadata Contraction
- The OpenSource `__IELTS_PRACTICE_TIMER__` bridge is not decorative compatibility glue. It is the shared timing contract used by submit payloads, suite/session orchestration, and replay/debug tooling.
- Timer facts should not become new submission top-level fields. The canonical submission already owns `startTime`, `endTime`, and `duration`; auxiliary timing and viewport state belongs in `metadata.timerSnapshot`, `metadata.effectiveEndTime`, `metadata.effectiveEndTimeMs`, and `metadata.scrollY`.
- Vue submit now writes legacy-compatible timer/scroll payload fields only at the attempt boundary, and the backend contracts them into metadata. That preserves old import/export shape without spreading aliases through the history list and replay APIs.
- Legacy record import should read timer/scroll aliases from `record`, `metadata`, `realData`, and `resultSnapshot`, then write one canonical submission shape. This keeps old data recoverable without keeping legacy record schemas alive.
- The next timer debt is suite-global semantics: OpenSource had anchor/mode/limit fields for suite timing. Current Vue bridge exposes local/suite source and elapsed snapshots, but full suite countdown/global anchor behavior still needs a dedicated pass if product mode requires it.

## Slice 26 Reading AI/RAG Timeline Signal Compression
- The backend RAG layer already had the right idea: `buildAttemptSignals()` reads `changeCount`, `visitCount`, and `elapsedMs/durationMs`. The broken part was upstream Vue submission; it only supplied change counts.
- `questionTimelineLite` is the correct home for per-question behavior signals. Creating a new behavior table or `ragSignals` payload would duplicate the same fact and create another garbage schema.
- Vue must flush the active question visit before submit and before building a coach payload. Otherwise the last active question's elapsed time is always undercounted, and AI review loses the most recent user behavior.
- Prompt wording should not be rewritten to fix data quality. The prompt already has attempt context and review targets; the right fix is feeding it better canonical context.
- `durationMs` is kept only as an alias inside the same timeline record because the existing RAG code accepts either `elapsedMs` or `durationMs`. The canonical semantic is still elapsed time spent on the question.

## Slice 27 Reading Suite Timer + AI Context Contract
- OpenSource suite timer behavior has real product value, but its field surface is legacy-heavy. New Vue/Electron code should not persist `globalTimerAnchorMs`, `suiteTimerAnchorMs`, or duplicate timer aliases.
- The correct new data structure is one suite-owned `timer` object inside `ReadingSuiteSession`. It contains anchor, mode, limit, paused offset, paused-at, running, and source. SQLite still stores the whole suite session JSON; no timer columns were added.
- Vue reading pages should derive suite timing from `suiteSession.timer`, then continue using the existing `__IELTS_PRACTICE_TIMER__` bridge and `attempt.timerSnapshot`. Submitted records still contract timer facts into `submission.metadata.timerSnapshot`.
- `null` timer limit is semantically different from `0`. `null` means elapsed mode/no countdown; `0` means an immediate zero-second countdown. Both backend and Vue normalizers must preserve that distinction.
- AI/RAG prompt text remains untouched. The current backend already consumes `attemptContext.analysisSignals`, `questionTimelineLite`, and `questionTypePerformance`; the missing protection was dynamic test coverage proving Vue and Practice API actually send those fields on automatic review and manual coach calls.
- Suite and single-reading E2E now both assert coach payload context. This prevents future simplified rewrites from stripping RAG behavior signals while leaving the UI apparently functional.

## Slice 28 OpenSource Asset + Offline Dictionary Consolidation
- `origin/opensource` added useful reading content/runtime capability, but some generated files are not acceptable as runtime code in the current VM-free Practice loader. The migration rule remains: generated reading assets must be strict data containers, not executable object literals.
- Latest OpenSource reading assets are now exposed through existing `/api/practice/assets/reading/:assetId` endpoints. No new asset API, database column, or history field was added.
- Official explanation payloads for `p2-high-234`, `p2-high-235`, `p2-high-236`, and `p3-high-229` are attached through the existing `reviewExplanations` payload field, not copied into submissions or history rows.
- Vue review highlight lookup now loads the OpenSource IELTS wordlist and `DictionaryService` on demand. This stays a renderer runtime feature and falls back to the existing `exam_system_vocab_list_reading_highlights` localStorage key.
- Dictionary data must not become a backend Practice field. The only persisted review annotation data remains canonical `submission.highlights` / `analysisArtifacts.highlights` plus existing vocab fallback storage.
- Real data defects were found while running the all-asset Practice API scan: `p1-high-194` and `p3-low-151` explanations had invalid unescaped quotes, and `p3-high-192` had been converted into a JS object literal. These caused real 500s in reading detail APIs and were fixed as data defects, not by weakening the parser.
- The current tests now lock this boundary: Vue static contracts assert OpenSource dictionary runtime loading, and Practice API contracts assert latest assets/explanations remain available through the existing facade.

## Slice 29 Reading Entry Parity + Suite Field Contraction
- Existing completed subagent audits identified the same high-priority gap: dynamic tests were strong after entering the reading page, but weak on the OpenSource/legacy click path before entry. `practice_reading_vue_flow.py` now covers overview category browse, PDF, suite selector, random practice, browse start, submit, replay, archive, and AI coach in one user-visible chain.
- The correct suite create contract is `flowMode` + `frequencyScope` plus optional canonical `timer/seed`, not renderer-only `autoAdvanceAfterSubmit`. That local preference can remain in localStorage because it controls Vue navigation behavior, but it should not be sent to `/api/practice/reading-suite` where the backend schema intentionally drops it.
- Static string presence is not enough for user experience parity. The new E2E waits for real route changes and rendered pages so future UI rewrites cannot keep selectors while breaking the click path.
- The AI prompt/RAG chain remains untouched. This slice only protects route/API/payload behavior around already tuned `server/src/lib/reading/prompt.ts` and coach services.
- Remaining observed risks are concrete, not theoretical: PDF-only assets need a no-empty-reading-page guard in random/endless pools; suite passage records opened from the library history should preserve enough suite context to return to suite progress; browse position memory and custom suite selection still need OpenSource parity work.

## Slice 30 PDF-only Random/Endless Guard
- `startReading()` already had the correct behavior for manually opened PDF-only assets: if there is no Practice payload but a PDF exists, open the PDF. The bug was that random and endless selected directly from `readingAssets`, so PDF-only entries could still be routed into `/reading/:assetId`.
- The correct data rule is simple: PDF-only assets remain browseable resources, not practice-session candidates. Random practice and endless mode now filter with the existing `hasReadingPracticePayload(asset)` helper instead of introducing a new `isPdfOnly` field.
- The dynamic E2E now uses a PDF-only asset at index 0 and forces `Math.random() === 0`. This catches the exact regression class: if a future rewrite forgets the payload filter, random/endless will select the PDF-only asset and fail the route/detail-request assertions.
- This change does not touch AI prompt, RAG, history schema, or Practice API contracts. It is a renderer candidate-pool fix that preserves the existing manual PDF user path.

## Slice 31 Suite History Replay Context
- The suite replay context was already present in canonical reading history summaries through `submission.metadata.suiteSessionId`; the broken part was the Vue route handoff from history rows to `PracticeReadingReview`.
- The correct fix is to reuse `metadata.suiteSessionId` / `metadata.suite_session_id` and attach it as the existing review route query. Adding a new history field would duplicate the same fact and create another schema wart.
- Both reading history entry points needed the same treatment: the legacy-style Practice Library history panel and the mixed writing/reading History page. Fixing only one would leave a real userspace regression.
- The Vue reading review page already derives `activeSuiteSessionId` from the route query and changes `returnRoute` / `returnLabel` to `PracticeReadingSuite`. No reading AI prompt, RAG service, Practice API shape, or submission schema change was needed.
- The Vue suite E2E now proves a completed suite passage can be reopened from the Practice Library history list with `?suiteSessionId=...`, and the review page still exposes `返回套题进度`.

## Slice 32 Browse Remember-Position Recovery
- The legacy/OpenSource browse preference was not just a toggle. It promised list-position recovery, but the Vue rewrite only persisted `autoScrollEnabled`, which was a fake feature and a direct userspace regression.
- The right data owner is the existing renderer preference key `browse_view_preferences_v2`. Adding Practice API fields or history metadata for list scroll state would be schema garbage.
- Vue now saves the last started asset plus current category/type/frequency/search/sort state before route navigation, then restores those filters and scrolls the matching `.exam-item[data-reading-asset-id]` back into view when browse data/view state is ready.
- This fix is renderer-only. It does not touch reading AI prompts, RAG payloads, backend submission schema, suite session schema, or coach persistence.

## Slice 33 Custom Suite Selection Recovery
- OpenSource custom suite selection is not a separate persistence model. It builds a P1/P2/P3 ordered sequence from the browse list, then starts a normal suite from that explicit sequence.
- The correct backend home is the existing `/api/practice/reading-suite` create endpoint plus `ReadingSuiteSession.sequence`. Creating a new `customSequence`, `selectedAssets`, or separate custom-suite table would duplicate the same fact and become schema garbage.
- The Practice API now accepts `frequencyScope: 'custom'` and optional `sequence` on suite create. The service validates exactly one practice-ready P1, P2, and P3 in order, then writes the same canonical `ReadingSuiteSession.sequence` rows used by random suite creation.
- Vue now exposes the OpenSource selector option `自选套题（P1/P2/P3）`, enters browse selection mode, captures one asset per category, and confirms by posting `sequence: [p1, p2, p3]` through the same suite API.
- Reading AI prompt, RAG retrieval, coach persistence, suite submit, and history replay remain untouched. This slice only repairs suite entry selection and sequence creation.

## Slice 34 Submitted Single Reset Recovery
- OpenSource's submitted-single Reset behavior is real userspace, not a debug convenience. After a normal single-reading submit, users can reset the same page into a fresh editable attempt without losing the already persisted history record.
- The correct data rule is to recycle renderer state only: `submission`, coach UI state, AI review status, highlights, answer/timeline metadata, DOM readonly flags, and the sessionStorage submission snapshot. Deleting the persisted history row or adding a backend retry field would be wrong.
- This reset must not apply to suite, endless, or explicit history replay routes. Those flows have different ownership: suite progress belongs to `ReadingSuiteSession`, endless schedules the next asset, and replay is immutable history.
- Clearing `practice_reading_submission_${assetId}` is necessary. Otherwise the visible UI can look fresh while the session cache still points at the old submitted review, which is hidden state garbage.
- Reading AI prompt/RAG services remain untouched. The fix preserves the existing Submit -> history save -> automatic `review_set` AI review -> Coach/RAG context chain, then only allows the user to start a second local attempt from the same rendered asset.

## Slice 35 OpenSource Explanation Manifest + RAG Passage Notes
- `origin/opensource` latest moved the reading explanation manifest from partial coverage to full 225/225 exam coverage and added 58 generated explanation files. Syncing only the manifest would have created dead index entries; the correct data sync is manifest plus every referenced explanation file.
- Many of the newly added explanation files are passage-note-only: they contain `passageNotes` but no `questionExplanations`. Treating them as missing or forcing fake question explanations would be data lying. The correct contract is that Practice API exposes `reviewExplanations.passageNotes`, while question explanations remain optional.
- Before this slice, `ReadingCoachService` parsed those explanation files but `buildReadingChunks()` ignored `passageNotes`, so RAG still could not see the new OpenSource official paragraph analysis. That is a real AI review regression even when Vue review UI can display the payload.
- Passage notes now enter the existing `answer_explanation` chunk stream with stable `passage_explanation` ids and empty `questionNumbers`. This reuses the current RAG/prompt contract instead of adding a new chunk type, schema field, or prompt wording.
- Review retrieval now deterministically injects a small number of no-question official explanation chunks. Without that, whole-set review can fill the final context budget with question/answer chunks and drop the only official paragraph analysis for passage-note-only assets.
- `server/src/lib/reading/prompt.ts` remains untouched. The fix improves data fed into the already tuned review prompt instead of rewriting prompt behavior.

## Slice 36 Settings Theme Modal OpenSource Parity
- The Settings theme button had regressed into an index-based direct rotation. That is fake parity: OpenSource presents a modal with three visible theme choices and stable `data-index-action` markers.
- The correct Vue data structure is a small `backgroundThemes` list with the three OpenSource values: `misty-mountain`, `teal-ocean`, and `floral-bloom`. The click handler should open the modal; the card action should apply the chosen theme.
- Applying a theme should reuse the existing runtime contract: call `window.switchBgTheme(nextTheme)` when present, otherwise write `three_bg_theme` and dispatch `shui-bg-theme-change`. Adding a new settings field or API route would be schema garbage.
- Modal close behavior belongs in the renderer only: close button, overlay click, and `Escape`, with the key listener removed on unmount.
- Subagent OpenSource JS audit flagged the next real gaps as separate slices, not part of this small UI fix: `library-config-btn` semantics, reading `memorize` mode semantics, missing ECDICT dictionary bundle parity, and learning-goal design without new field sprawl.

## Slice 37 Reading Memorize Mode Semantics
- OpenSource treats reading memorize as `practiceMode=memorize`; `review` is a separate submitted/replay/AI review concept. Letting Vue use `mode=review` for memorize was semantic garbage and risked contaminating replay and AI review branches.
- The More-page memorize entry should send both `mode=memorize` and `practiceMode=memorize`. This keeps router state explicit and matches the legacy unified reading page query contract.
- Old `mode=review` memorize links should be normalized at the Vue route boundary into `mode=memorize&practiceMode=memorize`, then the page should reload from the normalized query. Otherwise the URL may be fixed while the page stays in the wrong mode.
- Memorize entry candidates must reuse `hasReadingPracticePayload()`. PDF-only reading assets are browseable resources, not valid memorize practice pages.
- No new Practice API field, history field, or prompt change is needed; this is renderer route semantics and candidate-pool cleanup.

## Slice 38 OpenSource ECDICT Dictionary + Bubble UI Parity
- Current Vue already had `DictionaryService` support for `__LOCAL_DICTIONARIES__.ecdict`, but the reading page only loaded `ielts_core.bundle.js`. That made the OpenSource ECDICT feature effectively unreachable from Vue.
- ECDICT is renderer data, not Practice API data. Loading `assets/wordlists/ecdict_reading.bundle.js` alongside the IELTS core bundle preserves the existing local runtime contract and avoids backend/schema drift.
- The dictionary bubble was also too reduced: it collapsed OpenSource metadata into one meaning string. The UI should preserve term metadata, phonetic, part of speech, source/license, examples, and compound lookup parts because these are visible user-facing learning affordances.
- Saving a highlighted word can reuse the existing reading-highlight vocab fallback list. Do not introduce `dictionaryPayload`, `dictionarySnapshot`, or any new history submission fields for dictionary display state.
- User feedback changed the acceptance bar: static selectors alone do not prove UI parity. Future reading/settings/more work should compare OpenSource and Vue screenshots for DOM structure, CSS, panel behavior, and visual hierarchy before declaring parity.

## Slice 39 Settings Three-Panel OpenSource Parity
- The Settings regression was not a missing setting; it was the wrong first-screen data structure. OpenSource Settings is three panels: system management, data management, and system info. A default “写作配置” toggle plus inline detail panel made the Vue page a new UI, not a Vue port.
- Advanced writing configuration can stay in the product, but it must not become a fourth default Settings panel. The cleaner boundary is an overlay opened from existing business actions such as library config and backup actions.
- The OpenSource system-info DOM uses stable classes/ids: `.settings-system-info`, `.settings-system-info__status`, `#total-exams`, `#html-exams`, `#pdf-exams`, and `#last-update`. Vue now maps these to existing `topics.getStatistics()` data instead of adding new fields.
- Theme choices should use the OpenSource `theme-options-glass` container directly. Mixing old `theme-options` with OpenSource glass styles keeps two grid systems alive and creates visual drift.
- This slice did not change backend APIs, history schema, reading AI prompts, RAG retrieval, or coach service behavior. The next high-value target remains the reading page DOM/CSS skeleton against `reading-practice-unified.html` and `unifiedReadingPage.js`.

## Slice 40 Reading Bottom Nav OpenSource Parity
- OpenSource `reading-practice-unified.html` uses a fixed `.practice-nav` with `.title`, `#question-nav`, compact `.q-item` buttons, and `.controls`. The current Vue page had drifted into card-like nav entries with nested label wrappers, visible answered/unanswered text, and an embedded mark button. That is new UI, not a Vue port.
- The product still needs `markedQuestions` because Submit, analysis artifacts, replay, and Coach payloads already use it. The fix should keep the mark affordance as an additive side control while restoring `.q-item` as the primary question navigation button.
- `[data-answer-question-id]` remains a useful business/test anchor for status and replay checks, so the wrapper can carry status classes while the visible OpenSource-style `.q-item` remains the clicked question button.
- This slice changes renderer DOM/CSS/test contracts only. It does not touch Practice API, history schema, submit scoring, AI prompts, RAG retrieval, or coach payload semantics.

## Slice 41 Reading Header Control Parity
- OpenSource reading header controls are intentionally sparse: `#timer`, `#settings-btn`, and `#note-btn`. The Vue header had accumulated return, answer progress, and snapshot actions, which recreated a new toolbar and visually diverged from the source page.
- Return routes and snapshot are real product behavior, so deleting them would break userspace. The correct move is to place return in the OpenSource `#exit-btn` slot and keep snapshot in bottom `.practice-nav .controls`.
- `data-reading-answer-progress` can remain as an internal/status affordance, but it should not sit next to the timer in the OpenSource header control cluster.
- This slice is renderer placement only. It preserves `returnRoute`, `returnLabel`, `snapshotAnswers()`, suite return, single return, Submit, history, archive, AI review, and Coach payload behavior.

## Slice 42 Reading Results Container Parity
- OpenSource submitted review is not a separate card system. It uses `#results` inside `#right`, with `.results-table` plus `.result-correct` / `.result-incorrect` cells.
- Vue had a custom `.review-panel` / `.review-table` surface. That preserved function but weakened DOM/CSS parity and made screenshot comparison drift.
- The correct low-risk fix is to attach the existing submitted review panel to `id="results"` and add legacy result table/classes, while leaving analysis, automatic LLM review, and Coach panels in the same right-pane lifecycle.
- This slice is renderer DOM/CSS only. It does not change scoring, persistence, prompt wording, RAG retrieval, Practice API, or Coach payload construction.

## Slice 43 Writing Top Navigation No-Crossline Guard
- The product code currently has the right data structure: `NavBar.vue` is only shown on writing routes, and its links are `写作` -> `/writing`, `写作题库` -> `/topics`, `写作记录` -> `/history`, and `设置` -> `/settings`. Reading overview owns its own frameless OpenSource nav.
- Static assertions catch label drift, but they do not prove userspace. The real failure mode is a click path accidentally landing on `#/` and rendering `[data-practice-reading-home]`.
- The correct protection is dynamic E2E inside the existing file-runtime writing test, because that exercises the packaged `dist/writing/index.html` route shell without needing another history schema or API surface.
- The E2E must rebuild stale Vue bundles when `apps/writing-vue/src` is newer than `dist/writing/index.html`; otherwise navigation tests can pass against old code and become fake coverage.
- Stubbed API responses are intentionally minimal and writing-scoped: topics, essays, settings, configs, prompts, and empty reading history. No product code, Practice API schema, history persistence, AI prompt, or RAG route changed.

## Slice 44 Migration Matrix Product UI Boundary
- The migration/deletion matrix is useful engineering state, but it is not product UI. Showing `legacyFallbackSurface`, deletion gates, renderer support labels, or fallback rationale to learners would be UX垃圾: it leaks migration internals instead of helping users practice.
- Current Vue product sources already have the right boundary. `PracticeLibraryPage.vue` imports only `practiceAssets`, `practiceHistory`, and `practiceReadingSuite`; reading, history, settings, app shell, and nav sources do not use `practiceMigration` or `/api/practice/migration-status`.
- The API/dev contract should stay alive. `practice-client.js` can still export `practiceMigration.getStatus()`, and `server/src/lib/practice/migration-status.ts` remains the typed source for deletion gates and static tests.
- The missing piece was a regression guard. `practiceVueShell.test.js` now scans user-facing Vue sources and forbids migration/deletion matrix snippets while explicitly allowing the client/server dev contract.
- No product UI, Practice API schema, history persistence, AI prompt, RAG route, or Coach implementation changed in this slice.

## Slice 45 Practice Library Action Marker Parity
- `origin/opensource:index.html` uses `data-index-action` as the stable action marker layer for browse and history controls. Vue had copied the visible controls but left local marker names such as `filter-exam-type`, `search-exams` as `data-input-action`, `clear-exam-search`, and `filter-record-type`.
- This is not a data model problem. Adding API fields or rewriting controllers would be垃圾. The correct fix is DOM contract parity: add the OpenSource `data-index-action` / `data-action-value` markers while preserving Vue `@click` and `v-model` behavior.
- Browse controls now expose `filter-exams`, `search-exams`, and `clear-search`; history controls expose `filter-records`, `export-practice-markdown`, `toggle-bulk-delete`, and `clear-practice-data`.
- Existing Vue-only `data-action` markers are kept as compatibility selectors for current code/tests, but they are no longer the only visible action contract.
- No Practice API, history schema, reading submission payload, AI prompt, RAG route, or Coach behavior changed.

## Slice 46 Reading Results Injection Point Parity
- OpenSource `reading-practice-unified.html` always mounts `<div id="results"></div>` immediately after `#question-groups`; the runtime clears it and hides it while rendering the question dataset, then fills and shows it on submit.
- Vue had a lifecycle mismatch: `#results` did not exist before submission. That is a DOM parity bug even if visible behavior works, because the stable result injection point disappears in the same pre-submit state used for screenshot and static comparison.
- The correct fix is to keep the container mounted and hidden, not to move review/AI content into a second surface. Review content, `data-reading-review-panel`, analysis, LLM review, and result table still only render when `submission` exists.
- This is renderer DOM lifecycle only. Scoring, canonical submission persistence, `readingCoachSnapshot`, `readingCoachTranscript`, automatic review, manual Coach, prompt wording, and RAG route stay unchanged.

## Slice 47 Browse Filter Hidden Listening Marker Parity
- OpenSource browse filters include a hidden `听力` button with `data-filter-type="listening"` and `data-index-action="filter-exams"`. Vue had only `all` and `reading`, so static DOM parity was incomplete even though the user-facing control was intentionally absent.
- This is not permission to implement listening in the Vue reading library. Current Vue history and browse data are reading-owned (`practiceHistory.listAll({ activity: 'reading' })` and reading assets), while listening remains a legacy/fallback capability. A visible listening filter here would be a fake feature and a userspace trap.
- The correct fix is DOM-only: include `{ value: 'listening', label: '听力', hidden: true }` in the browse filter data and bind `hidden` in the rendered button. `filterByType()` still normalizes every non-reading type back to `all`, so no unsupported listening route/data path is enabled.
- OpenSource history has a visible listening record filter, but Vue Practice Library intentionally does not add it yet because there is no canonical listening history source in this view. That missing migration belongs to the listening migration bucket, not to reading UI parity.
- No Practice API, history schema, reading submission payload, AI prompt, RAG route, or Coach behavior changed.

## Slice 48 Floating Reading Coach Host Parity
- The original Reading Coach implementation is not an inline review card. `js/runtime/unifiedReadingPage.js` creates a floating `#reading-coach-fab` and `#reading-coach-panel`, with `reading-coach-panel__*`, `reading-coach-msg`, and `reading-coach-chip` classes. Vue had rebuilt it as an inline `.coach-panel` under `#right`, after `#results`, which changed the host structure and kept a new UI surface alive.
- This is a UI host parity issue, not a prompt/RAG issue. The correct fix is to restore the floating host while leaving `buildCoachPayload()`, `review_set`, `review_workspace`, `chat_widget`, `selection_popover`, `followup`, selected context, stream event handling, and canonical history refresh untouched.
- The Vue panel still uses the existing `practiceCoach.query` lifecycle and `readingCoachSnapshot` / `readingCoachTranscript` persistence. `readingCoachOpen` is UI-only state; it is opened after submit/replay to preserve current E2E/user flow and closed on load/reset so stale panels do not survive a fresh attempt.
- Static tests now lock the legacy FAB/panel ids/classes/title/composer ids and the open/close state contract while continuing to assert the AI action/surface/promptKind mappings.
- No Practice API, history schema, reading submission payload, AI prompt text, RAG routing, or Coach service code changed.

## Slice 49 Reading Notes Modal Parity
- OpenSource reading notes are a centered modal: `#notes-panel` sits at `top: 50%`, `left: 50%`, `transform: translate(-50%, -50%)`, with a 400x300 panel, header, `#close-note`, and textarea. Vue had drifted to a right-top floating panel (`top: 86px; right: 22px`) with resizable textarea. That changes a visible interaction, not just CSS taste.
- The correct fix is CSS/DOM parity only: keep `notesText`, localStorage persistence, `#note-btn`, `#notes-panel`, `#close-note`, and overlay close behavior, but restore the centered modal geometry and add dialog semantics.
- The reading E2E initially clicked `.overlay` at its center. Once the modal was correctly centered, that click hit the textarea instead of the backdrop. The test was assuming the old wrong geometry. The fix is to click an explicit safe backdrop coordinate while still asserting that outside-panel overlay click closes notes.
- No Practice API, history schema, submission payload, reading AI prompt, RAG route, Coach service, or notes persistence field changed.

## Slice 50 Reading Settings Panel Parity
- OpenSource `#settings-panel` is a compact floating panel: `top: 60px`, `right: 20px`, 260px width, 16px padding, section bottom spacing, equal-width `.settings-option` buttons, and active buttons using the accent background with white text.
- Vue had drifted to a 320px grid panel at `top: 78px; right: 22px`, with 8px rounded pale-blue buttons. That is visible UI drift, not a business improvement.
- The correct fix is CSS/test parity only. Keep `readingFontSize`, `readingThemeMode`, suite flow mode, `#settings-btn`, overlay close, and existing persistence/route behavior; only restore the OpenSource panel geometry and button skin.
- No Practice API, history schema, reading submission payload, AI prompt, RAG route, Coach service, or settings schema changed.

## Slice 51 Reading Split Pane Grid Parity
- OpenSource reading shell is a three-column grid driven by `--reading-left-pane-width` and `--reading-divider-width`: left passage, 10px divider, right questions. Vue had a flex shell where `leftPanePercent` updated state and ARIA but the CSS layout ignored `--reading-left-pane-width`; divider keyboard/drag looked live while the panes stayed effectively fixed. That is a real userspace bug, not just visual drift.
- The right data structure already existed: `leftPanePercent` plus `readingWorkspaceStyle`. The fix is to make CSS consume that state through the OpenSource grid, not add another resize path.
- Restoring `#divider::before`, hover/focus/drag skin, `touch-action: none`, and `.is-dragging` keeps the visible OpenSource affordance while preserving existing pointer and keyboard handlers.
- The E2E now proves behavior, not just markup: focusing `#divider`, pressing `End`, and checking `#left.getBoundingClientRect().width` increases catches any future regression where ARIA updates but layout does not.
- No Practice API, history schema, reading submission payload, AI prompt, RAG route, Coach service, or answer/score logic changed.

## Slice 52 Reading Selection Toolbar Parity
- OpenSource `#selbar` is a compact dark floating toolbar: `#1e293b` background, white text, 4px padding/gap, transparent buttons, and `#334155` hover. Vue had drifted to a redesigned dark container with white button pills and black text.
- This is a visible interaction surface, not a data problem. The correct fix is CSS parity only; keep `#selbar`, `#btnHL`, `#btnUH`, `#btnNote`, selection detection, highlight, remove-highlight, note, dictionary bubble, and Coach selected context logic intact.
- Static tests lock the OpenSource CSS tokens, and E2E now checks computed styles while the toolbar is actually visible before applying a highlight. That avoids fake coverage that only sees selectors.
- No Practice API, history schema, reading submission payload, AI prompt, RAG route, Coach service, or highlight persistence field changed.

## Slice 53 Reading Question Nav Item Parity
- OpenSource bottom question nav renders `.q-item` as a compact text button with `padding: 6px 12px`. Vue had kept the correct class and click behavior but forced `min-width: 42px`, `min-height: 34px`, and `padding: 0`, turning question numbers into square tiles. That is visible UI drift.
- Marked questions are real product behavior and stay as the adjacent `.mark-question-button`. The fix only restores the primary `.q-item` skin; it does not remove `markedQuestions`, change submit payloads, or alter replay/analysis behavior.
- Static coverage now forbids the square sizing, and E2E checks computed padding/min-size on a live answered nav item before marking a question.
- No Practice API, history schema, reading submission payload, AI prompt, RAG route, Coach service, or marked-question persistence changed.

## Slice 54 Reading Results/Button Flattening Parity
- OpenSource applies an IELTS aesthetic flattening pass after the base reading shell: `#results`, `#timer`, `.header-btn`, `.q-item`, and `.practice-nav .controls button` end at 4px radius, while `.submit-btn` keeps a forced blue primary background.
- Vue had partially restored the structure but left visible CSS drift: `#results` inherited the redesigned 24px/32px review-panel padding and 12px radius; nav/control buttons still used 8px radius; drag/drop targets and chips were still rounded at 8-10px.
- The first E2E attempt found a real cascade bug: the `#submit-btn` had the correct class but rendered white because `.practice-nav .controls button` had higher specificity. Static class checks alone would have missed this garbage.
- The fix is CSS/test parity only: restore `#results.review-panel` spacing, `.results-table` spacing, 4px flattening, and the OpenSource `!important` primary submit override while leaving Submit, reset/retry, drag/drop answers, review table, automatic AI review, Coach transcript, replay, archive, and canonical submission payloads unchanged.
- No Practice API, history schema, reading submission payload, AI prompt, RAG route, Coach service, or drag/drop scoring logic changed.

## Slice 55 Reading Question Group Panel Parity
- OpenSource question rendering uses `.unified-group` as a lightweight wrapper and `.group` as the compact inner panel. The inner panel is not the same thing as the submitted review surface.
- Vue had one shared CSS rule for `.reading-html :deep(.group), .review-panel`. That is bad data ownership in CSS: changing review presentation also changes question panels, and the OpenSource compact group rhythm was overwritten by a redesigned large review card.
- The correct fix is to split the owners: `.reading-html :deep(.group)` gets OpenSource `18px 22px`, 4px radius, and zero bottom margin; `#results.review-panel` keeps its own result-panel styling.
- E2E now checks actual computed style for `#question-groups .unified-group` and `#question-groups .group`, so future class-only parity claims cannot hide a wrong card geometry.
- No rendered question data, answer state, drag/drop, scoring, canonical submission, history, archive, AI prompt, RAG route, or Coach service changed.

## Slice 56 Reading Dark Mode Parity
- OpenSource dark mode is variable-owned by the reading shell: `--panel: #1e293b`, `--panel-alt: #0f172a`, `--text: #f8fafc`, `--line: #334155`, and page background `#020617`. Vue already toggled `.dark-mode`, but the shell variables and several old v-html controls stayed light. That is a real user-visible settings bug, not cosmetic churn.
- The first broken coverage was class-only: E2E checked `.reading-page.dark-mode` but did not inspect computed colors. A class without token changes is fake dark mode.
- The fix gives `.reading-page.dark-mode` the OpenSource dark variables and covers header, floating panels, panes, divider, question groups, results, nav controls, answered/correct/incorrect nav states, dropzones, drag chips, and basic input/table surfaces.
- Vue scoped CSS plus old v-html question HTML produced a nasty edge case: empty legacy `.match-dropzone` could keep the light `#eff6ff` background even after dark variables were present. The robust ownership boundary is the Vue dropzone lifecycle. `syncDropzoneThemeStyles()` now updates all legacy dropzones on theme change, and `syncDropzoneControl()` applies the same style when Vue writes an answer chip.
- `practice_reading_vue_flow.py` now waits for and asserts real computed dark colors for page, header, group, nav item, dropzone, and drag item. This prevents future regressions where only a class or CSS selector exists.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, or Coach persistence changed.

## Slice 57 Reading Pane Density And Timer Affordance Parity
- OpenSource `#right` uses compact `padding: 12px 14px`; Vue had `16px 20px`. That is a visible density regression in the answer pane, especially after previous work restored compact `.group` spacing.
- OpenSource `#timer` is a clickable pause/resume control with pointer cursor, hover opacity, and paused opacity. Vue kept the click handler but `.reading-stat { cursor: default; }` won the cascade, so the timer looked non-interactive. That is bad UI ownership: state says button, CSS says label.
- The fix is CSS-only: restore `#right` compact padding and give `.reading-timer:not(:disabled)` the OpenSource cursor/transition/hover/paused affordance while leaving the generic `.reading-stat` label behavior for non-clickable progress stats.
- Static coverage locks the exact `#right` padding and timer cursor/hover/paused CSS. E2E now checks computed `#right` padding and `#timer` cursor in the live page before submit, so a future class-only regression is caught.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, Coach persistence, timer snapshot payload, or suite timer state changed.

## Slice 58 Reading Mobile Shell Scroll Parity
- OpenSource mobile reading layout does not keep the desktop fixed-height split shell. At `max-width: 980px`, it lets the page scroll, makes `.shell` `display: block`, sets height to `auto`, and allows overflow to be visible.
- Vue kept desktop ownership on mobile: `.reading-page` stayed `height: 100vh; overflow: hidden`, while `.reading-workspace.shell` was a flex column without resetting the fixed desktop height. On narrow screens this can clip stacked passage/questions and bottom controls. That is a userspace bug.
- The correct fix is to restore the OpenSource mobile scroll model: page `height: auto`, `overflow: auto`, bottom padding equal to the nav height, shell `display: block`, `height: auto`, `overflow: visible`, and controls full-width right aligned.
- Static coverage now locks the mobile media-query contract. E2E switches to an 820px viewport and checks computed page overflow, shell display/overflow, nav padding, and controls alignment, then returns to desktop before continuing the full reading flow.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, Coach persistence, timer snapshot payload, or suite timer state changed.

## Slice 59 Reading Question Nav Active State Parity
- OpenSource reserves a current-question state on `.q-item.active`: accent border, `#eff6ff` background, accent text, and `font-weight: 600`; dark mode uses a stronger blue active fill. Vue had answered/review/marked state but no responsive current-question state in the bottom nav, so users could not visually anchor the active question after jumping.
- The correct data owner is existing visit state, not persistence. `activeQuestionId` is UI-only and is updated by `recordQuestionVisit()`, then reset with attempt metadata. Adding it to canonical submission/history would be schema垃圾.
- The subtle bug was CSS cascade ownership: q6 is answered before the active check, and `.answered` can override `.active` if active is only another class. The fix explicitly styles `.q-item.answered.active` in light and dark mode so current-question state wins.
- E2E had to return from dark mode to light mode before checking the OpenSource light active colors. Otherwise it would test the wrong state and create fake failure noise.
- Static coverage now locks the active state source, class binding, resolver, visit update, and CSS contract. E2E clicks q6 and verifies live computed padding, radius, border, background, text color, and font weight.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, Coach persistence, answer payloads, marked questions, replay persistence, or scoring changed.

## Slice 60 Reading Fixed Bottom Nav Safe Area Parity
- OpenSource `.practice-nav` is a fixed viewport bottom bar: `position: fixed; left: 0; right: 0; bottom: 0`. Vue had drifted to `position: relative`, so the question nav and Submit controls could scroll away with content, especially after the mobile scroll restoration. That is a userspace bug.
- Simply changing `position: fixed` exposed old CSS garbage: the nav still carried the legacy `.answer-panel` class, and `.answer-panel { position: sticky; top: 92px; }` made the fixed nav stretch from 92px to the bottom, intercepting radio inputs in the suite E2E. The right fix is to cancel inherited panel positioning with `.practice-nav { top: auto; }`, not to remove useful test coverage.
- Safe-area ownership belongs to the page shell, not to a hard-coded `calc(100vh - 67px - nav)` value. Header height is not a stable data structure. `.reading-page` now reserves `padding-bottom: var(--reading-nav-height)` with `box-sizing: border-box`, while the shell flexes inside that safe area.
- Static coverage now forbids relative nav docking and hard-coded header-height shell math. E2E checks real computed fixed docking and DOM geometry so the shell cannot extend beneath the fixed nav.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, Coach persistence, answer payloads, scoring, marked-question persistence, replay persistence, or suite state changed.

## Slice 61 Reading Highlight Visual Parity
- OpenSource highlight styling is not a yellow marker. The source page defines normal `.hl` as dark brown `#72361c` with white text, and note highlights as `.hl[data-hl-type="note"]` blue `#0369d9` with white text. Vue had drifted to a yellow marker and pale-blue note skin, which is visible UI drift.
- This is CSS ownership, not data ownership. The existing highlighter lifecycle, `#btnHL`, `#btnUH`, `#btnNote`, selection restoration, dictionary bubble, selected Coach context, canonical `highlights` persistence, replay, and archive roundtrip already use the correct data path.
- The fix only restores the visual tokens. Adding another highlight field, dictionary snapshot, Practice API branch, or history schema value would be schema garbage.
- Static coverage locks both OpenSource tokens and forbids the old yellow/pale-blue colors. E2E now applies a real Highlight action and checks computed background/text colors on `#left .hl`, so class-only parity cannot hide a wrong paint.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, Coach service, Coach persistence, answer payloads, scoring, marked-question persistence, replay persistence, or suite state changed.

## Slice 62 Reading Option Label Layout Parity
- OpenSource has a specific exam-option CSS owner. `.choice-item label`, `.checkbox-options label`, `.options-list label`, `.multiple-choice-options label`, `.matching-options label`, `.mcq-group label`, `.radio-options label`, `.radio-group label`, `.multiple-choice label`, and `.true-false-ng label` all render as flex rows with `align-items:flex-start`, 8px gap, 12px bottom margin, pointer cursor, and 1.5 line-height.
- Vue had only a generic `.reading-html label { display:block; margin:8px 0; }` rule. That makes radio/checkbox controls visually drift from the text, especially for multi-line answer choices. This is a user-visible reading surface bug, not an API problem.
- The right fix is selector parity inside the `v-html` question surface. The existing answer event delegation, native radio/checkbox sync, canonical submit payload, scoring, history replay, and archive import/export already work and should not be touched.
- The E2E fixture now uses real `.radio-options` and `.checkbox-options` wrappers, then asserts computed label display/alignment/gap/margin/cursor plus input margin/flex-shrink/cursor. That catches the actual visual contract instead of only searching for class names.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, Coach service, Coach persistence, answer payloads, scoring, marked-question persistence, replay persistence, or suite state changed.

## Slice 63 Reading Table And Summary Drop Target Parity
- OpenSource treats table-completion and summary-drop blanks as separate UI structures. `.table-section` owns table wrapper overflow, padding, fixed table layout, cell widths, compact `input.blank`; `.drop-target-summary` is an inline underline blank, not a big dashed dropzone.
- Vue had collapsed `.drop-target-summary` into the same selector group as `.paragraph-dropzone` and `.match-dropzone`. That is CSS data-structure garbage: summary completion blanks became blocky dashed boxes and theme sync force-painted them like paragraph dropzones.
- The fix is to split CSS owners. Block dropzones stay as block dropzones; summary blanks get `inline-flex`, 80px minimum width, `border-bottom`, bottom vertical alignment, and OpenSource drag-over/filled states. Table-section gets its OpenSource wrapper/table/input rules.
- `applyDropzoneThemeStyle()` now explicitly skips force painting `.drop-target-summary`; otherwise the dark-mode lifecycle would keep writing inline background/border styles that defeat the restored OpenSource underline contract.
- The E2E fixture includes a real `.table-section input.blank` and a `.drop-target-summary`, then checks computed layout values. This is stronger than source-only coverage and protects rendered summary/table question surfaces.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, Coach service, Coach persistence, answer payloads, scoring, marked-question persistence, replay persistence, or suite state changed.

## Slice 64 Reading Settings Font Button Parity
- OpenSource reading settings uses three font-size buttons that all display `A`; size is communicated by inline font size on the larger buttons (`1.1rem` and `1.25rem`). Vue had drifted to redesigned labels `A+` and `A++`. That is visible settings-panel copy drift, not a better data model.
- The correct data structure already existed: `fontSizeOptions` owns the valid setting values. The fix is to add optional per-option style and keep the label canonical, not add another settings field or branch.
- Static coverage now forbids `A+` / `A++` labels and locks the inline font-size cue. E2E checks the live panel labels and computed font sizes while preserving the existing `font-large` class and dark-mode behavior.
- No Practice API, history schema, canonical submission fields, archive import/export path, AI Coach prompt/action/surface mapping, RAG routing, Coach service, Coach persistence, answer payloads, scoring, marked-question persistence, replay persistence, or suite state changed.

## Slice 65 More Vocab Card Copy Parity
- OpenSource More tools vocab card says `SM-2记忆算法，随时继续你的词汇任务。`. Vue had replaced that with `本地 Leitner 分箱 + 艾宾浩斯复习节奏...`, which exposes implementation details and breaks UI copy parity.
- This is copy drift only. The actual vocabulary scheduler can still keep its internal compatibility logic; the card should not advertise a different product story from OpenSource.
- The fix restores the OpenSource copy and adds a static guard. No route, mount target, vocab state, scheduling algorithm, Practice API, history schema, AI Coach prompt/action/surface mapping, RAG routing, or reading submission behavior changed.

## Slice 66 More Achievements DOM Contract Parity
- OpenSource More achievements entry uses `data-index-action="show-achievements"`, and the modal close button uses `data-index-action="hide-achievements"`. Vue had only local `data-action` markers, so the OpenSource action layer was not present in the same DOM contract.
- Restoring those markers without guarding Vue click handlers would be a double-trigger trap: legacy delegated handlers can also see the click. The right fix is not another state flag; it is the same event boundary used by the other More tools, `preventDefault()` plus `stopImmediatePropagation()`.
- OpenSource latest CSS also moved the achievement modal from inline `max-width: 600px` to `.achievements-modal-content { max-width: 720px; }`, with denser grid cards (`minmax(124px, 1fr)`, 12px gap, 18px padding) and hidden scrollbars. Keeping only the class without the CSS would be fake parity.
- The modal title belongs to the DOM/copy source: `🏆 我的成就`. Rebuilding it with a Vue SVG span is unnecessary UI invention. AchievementManager only depends on `#achievements-modal` and `#achievements-list`, so this structure change does not touch achievement data or behavior.
- No Practice API, history schema, canonical reading submission fields, archive path, AI prompt/action/surface mapping, RAG routing, Coach service, answer payloads, scoring, replay, vocab scheduling, or suite state changed.

## Slice 67 First-Run GPL License Modal Parity
- OpenSource `index.html` includes a first-run GPL/anti-resale notice modal with id `license-modal`, accept marker `data-index-action="accept-license"`, and storage key `hasSeenGplLicense`. Since packaged Electron now loads Vue Practice Shell by default, omitting this modal from Vue removes a real OpenSource first-run UI/compliance surface.
- This is not a data model or API problem. Adding schema fields, Practice records, or a second settings flag would be garbage. The only canonical data is the existing localStorage boolean key.
- Vue should not import or depend on `js/presentation/indexInteractions.js` for this. The legacy delegated action layer owns many index-page behaviors; pulling it into Vue would create duplicate action ownership. The clean migration is local Vue state plus the same key and marker.
- The modal must use the same first-run reveal semantics: hidden by default, show via double `requestAnimationFrame` if `hasSeenGplLicense !== "true"`, and persist `"true"` when the user clicks `我已了解`.
- `practice_reading_vue_flow.py` now accepts the modal through the real `[data-index-action="accept-license"]` button and verifies the localStorage write, so future UI changes cannot bypass the first-run path with a hidden test-only shortcut.
- No Practice API, history schema, canonical reading submission fields, archive path, AI prompt/action/surface mapping, RAG routing, Coach service, answer payloads, scoring, replay, vocab scheduling, suite state, or writing navigation changed.

## Slice 68 Reading Header Title Marker Parity
- After the homepage action/id parity pass, the remaining filtered OpenSource reading-page id drift was `exam-title` and `exam-subtitle`. Vue had the correct header structure and better dynamic title/summary state, but lacked the stable OpenSource ids.
- Replacing Vue dynamic title text with the OpenSource default `IELTS 阅读练习 / 统一阅读页` would break state migration and be bad product behavior. The correct fix is DOM marker parity only: attach the ids to the existing `pageTitle` and `headerSummary` nodes.
- Static coverage now locks the ids to Vue state expressions, not to literal copy, so future code cannot satisfy marker parity by regressing to stale generic title text.
- No Practice API, history schema, canonical reading submission fields, archive path, AI prompt/action/surface mapping, RAG routing, Coach service, answer payloads, scoring, replay, suite state, or writing navigation changed.

## Slice 69 AI Coach Surface Contract Compression
- `js/runtime/unifiedReadingPage.js`, Vue `PracticeReadingPage.vue`, `server/src/routes/reading.ts`, `server/src/types/reading.ts`, and the reading router all agree that the canonical review surface is `review_workspace`; `review_panel` is not part of the current surface enum and should not be preserved as a migration synonym.
- `practiceApiFacade.test.js` still had one `surface: 'review_panel'` in the returned-patch preservation test. That is test garbage: it lets a removed surface name survive inside the strongest AI Coach persistence regression even though production Vue and server schemas use `review_workspace`.
- The fix is contract-only: update the test payload to `review_workspace` and add a static guard preventing `review_panel` from reappearing in the Vue Practice Reading source. No prompt, query text, review_set semantics, RAG route, selectedContext, transcript persistence, or backend coach implementation changed.
- Existing coverage already proves the high-value Phase 4 paths: success writes `singleAttemptAnalysisLlm`, stream and legacy stream write the same canonical patch, failure writes an error snapshot/transcript, followups hydrate history, selectedContext reaches prompt/retrieval, and frontend status maps route/retrieval/generation events.

## Slice 70 Reading History Summary Ownership
- Server history ownership is already correct: `PracticeHistoryStore.listFromSqlite()` selects only summary columns plus `metadata_json`, not `submission_json`; detail/replay/export paths use `rowToRecord()` / `listReadingSubmissions()` when full canonical submissions are actually needed.
- Vue Practice Library had one bad smell in `getReadingHistorySuiteSessionId()`: it read `record?.submission?.metadata` and `record?.raw?.metadata` as fallbacks. That teaches the history list to depend on detail payloads even though `suiteSessionId` belongs in summary `metadata`.
- The fix is to use only `record.metadata` for suite context routing from the list. This keeps replay links working for suite rows because summary metadata already carries `suiteSessionId`, and it preserves the intended hot path: list reads summary, replay/details read canonical submission.
- Static coverage now forbids `record?.submission?.metadata` and `record?.raw?.metadata` in the Practice Library source so the history list cannot drift back into parsing large detail payloads.

## Slice 71 Writing Navigation Audit
- Writing nav is currently correctly scoped: `NavBar.vue` brand routes to `/writing`, top links are `/writing`, `/topics`, `/history`, and `/settings`, with copy `写作`, `写作题库`, `写作记录`, `设置`. It does not expose reading browse/records query links.
- `App.vue` hides the writing nav on Practice Library/Reading/Suite/Review routes, so reading surfaces keep their own OpenSource chrome while writing pages keep the writing module nav.
- Static coverage already locks the positive and negative contracts in `practiceVueShell.test.js`, including no `练习主页`, no reading browse/practice query leakage, no brand route to `/`, and no `openLegacy`.
- E2E coverage in `writing_compose_draft_restore_e2e.py` is real browser coverage, not just source strings: it clicks `写作题库`, `写作记录`, `设置`, `写作`, and `.brand-block`, waits for the expected writing route/component, and fails if `[data-practice-reading-home]` appears. No code fix is justified in this slice.

## Slice 72 AI Coach Failure Transcript E2E Contract
- Service-level coverage was already strong: `PracticeHistoryStore.attachReadingCoachFailure()` writes `readingCoachSnapshot.error`, keeps the `review_set` user turn, appends an error assistant turn, and replay/detail APIs read the same canonical submission.
- The browser E2E had a weaker mock: the first automatic review returned an SSE error but did not mimic the production canonical history write. That meant Vue's `refreshSubmissionFromHistory(..., { preserveCoachResponse: false })` failure path was only statically asserted, not proven in a rendered replay-like flow.
- The fix is test-only. The E2E stub now writes the failed `review_set` user turn, error assistant transcript, and `readingCoachSnapshot` into the same mocked submission before returning the SSE error.
- The E2E now waits for the failed assistant turn in `[data-reading-coach-transcript]` and checks the sessionStorage submission snapshot before retrying. This proves the user-visible Coach panel can surface failed automatic review history and that the error remains on the canonical submission until the retry replaces it with a successful `singleAttemptAnalysisLlm`.
- No AI Coach prompt text, automatic query, `review_set`, `review_workspace`, RAG routing, production Coach service, Practice API, history schema, archive path, scoring, replay persistence, or writing navigation changed.

## Slice 73 AI Coach Stream Progress Visibility
- Static coverage already proved Vue maps SSE events to user-facing status text: `route`, `retrieval`, `generation_start`, `generation_complete`, `complete`, and `error`. That is necessary but not sufficient, because a synchronous E2E stream can skip intermediate visible states too fast for users and tests to observe.
- The browser E2E mock now emits successful Coach stream events through a delayed `ReadableStream` instead of one immediate chunk. This mirrors the production SSE lifecycle without changing any production code.
- The automatic review retry path now waits for visible running states: `正在判断问题意图...`, `RAG 已检索 2 条证据...`, `正在生成错因复盘...`, and `复盘生成完成，正在落库...`, before accepting the final success panel.
- This locks the Phase 4 requirement that RAG route/retrieval/generation progress is visible in frontend state, not just present in source strings.
- No AI Coach prompt text, automatic query, `review_set`, `review_workspace`, `chat_widget`, selectedContext, RAG routing, production Coach service, Practice API, history schema, archive path, scoring, replay persistence, or writing navigation changed.

## Slice 74 Manual Coach Stream Progress Visibility
- After Slice 73, automatic `review_set` had browser-level stream progress coverage, but manual `chat_widget` only had payload and final-answer assertions. Static tests said `sendCoachQuery()` consumed stream events, but the E2E did not prove a user could see those states in the Coach panel.
- The same delayed SSE mock already serves manual Coach requests, so no production change is needed. The missing contract is simply waiting on `[data-reading-coach-stream-status]` while the manual request is running.
- The E2E now asserts the manual Coach panel visibly progresses through `正在判断问题意图...`, `RAG 已检索 2 条证据...`, `正在生成教练回答...`, and `回答生成完成，正在同步记录...` before the final answer appears.
- This completes the Phase 4 visibility check for both automatic review and manual question paths without changing prompt text, selectedContext behavior, RAG routing, or transcript persistence.
- No AI Coach prompt text, automatic query, `review_set`, `review_workspace`, `chat_widget`, `selection_popover`, followup semantics, RAG routing, production Coach service, Practice API, history schema, archive path, scoring, replay persistence, or writing navigation changed.

## Slice 75 Canonical Archive Field Roundtrip
- The server ownership shape is correct: history list reads summary columns only, detail/replay/archive reads `submission_json`, and archive import calls `saveReadingSubmission()` instead of writing a parallel legacy record shape.
- The real gap was test strength. `testReadingHistoryArchiveRoundTrip()` only sampled `answers`, `markedQuestions`, and one analysis signal, so it did not prove Phase 3's canonical fields survive archive export/import/replay.
- The API facade test now creates a reading submission with `answerComparison`, duration, `timerSnapshot`, `markedQuestions`, `highlights`, `questionTimelineLite`, and analysis artifacts, then calls the normal Coach facade with `review_set` so `readingCoachSnapshot`, `readingCoachTranscript`, and `singleAttemptAnalysisLlm` are persisted through the canonical history path.
- The archive export and imported replay both assert those fields. This locks the existing single canonical submission path without adding schema fields, without duplicating `practice_records`, and without touching AI prompt/RAG behavior.
- No production code changed in this slice. The change is a Phase 3 regression contract for canonical archive fidelity.

## Slice 76 Replay No-Resubmit Audit
- Vue reading replay enters through `/reading/:assetId/review/:sessionId` and `loadSubmittedSession()`, which calls `practiceSessions.getState('reading', sessionId)` and assigns the persisted submission. It does not call `practiceSessions.create()`.
- `readOnlyMode` is derived from `reviewMode`, and `canSubmit` requires `!readOnlyMode`. The primary submit path therefore cannot run in replay mode unless that guard is removed.
- Browser coverage is already direct. `practice_reading_vue_flow.py` records all Practice API requests and fails if normal replay increases `POST /api/practice/sessions` beyond the one original submit. The archive-import replay branch also asserts the submit count stays at the pre-import baseline.
- Suite coverage is also direct. `practice_reading_suite_vue_flow.py` records passage submit endpoints, replay session GETs, history GETs, and legacy calls; it fails if replay misses the session/history path or uses legacy.
- No code change is justified. The Phase 3 no-resubmit invariant is already covered by implementation shape plus E2E request counting.

## Slice 77 Practice History Action Button Parity
- OpenSource practice history actions use visible icon+copy affordances: `📄 导出Markdown`, a checkmark SVG before `批量删除`, and `🗑️ 清除记录`.
- Vue had the same actions and data markers, but two buttons had drifted to plain text and the bulk-delete button had lost the OpenSource SVG layer. That is UI parity drift, not a business bug.
- The fix restores the OpenSource button content while keeping the existing Vue handlers, disabled state, and dynamic bulk-delete label.
- Static coverage now locks those action labels and the checkmark SVG so the history toolbar cannot silently regress to a functionally similar but visually different UI.
- No Practice API, history schema, archive path, record deletion logic, replay logic, AI Coach prompt/RAG, suite state, or writing navigation changed.

## Slice 78 Practice History Empty-State Parity
- Latest `origin/opensource:index.html` uses a simple `history-empty-placeholder` block in `#history-list`: `📋`, `暂无练习记录`, and `开始练习后，记录将自动保存在这里`.
- Vue had replaced that with a redesigned `.practice-history-empty` card: dashed background, `📂`, `暂无任何练习记录`, and a `去题库练习` CTA. That is a visible UI redesign, not a missing business capability.
- The correct fix is DOM/CSS parity only: restore the OpenSource placeholder structure and CSS owner, while leaving history loading, search, summary-row reads, replay, delete, archive, and clear actions untouched.
- The visible listening filter from OpenSource history remains intentionally absent in Vue Practice Library because this view still has only canonical reading history data. Adding a visible listening tab without a canonical listening history source would be fake userspace.
- No Practice API, history schema, archive path, replay behavior, AI Coach prompt/RAG, suite state, or writing navigation changed.

## Slice 79 Reading Vue Screenshot Acceptance Evidence
- Phase 5 required screenshots for reading homepage, browse, settings three-panel, answer page, submitted result, and history replay. The single-reading Vue E2E already visited all six states, but only proved behavior; it did not persist stable visual evidence.
- The right data structure is test evidence, not product schema. A single `REPORT_DIR` plus `capture_acceptance_screenshot()` helper now writes all six PNG files under `developer/tests/e2e/reports/`, verifies each file is non-empty, and returns the paths in the JSON result.
- Static coverage now locks the screenshot helper, report directory, all six filenames, and returned screenshot evidence. This prevents a future test edit from silently removing screenshot acceptance while keeping behavior assertions green.
- Running the static/API gates exposed two real canonical persistence regressions already present in the worktree. First, `createReadingPracticeSubmission()` built `analysisArtifacts` but did not return it on the canonical `ReadingPracticeSubmission`. Second, `PracticeHistoryStore.attachReadingCoachResult()` wrote `singleAttemptAnalysisLlm` only at the top level and no longer mirrored it into `analysisArtifacts.singleAttemptAnalysisLlm`. Both break Phase 3 archive/replay guarantees, so both canonical writebacks were restored.
- No AI prompt text, `review_set` query semantics, selectedContext, RAG routing, Practice API shape, history schema, archive import/export format, scoring, or replay submit behavior changed.

## Slice 80 Screenshot Hidden-Layer Sanity
- Non-empty screenshot files are weak evidence. Visual inspection of `practice-reading-vue-home.png` showed hidden OpenSource shells leaking into the homepage: GPL/license modal content, suite/theme modal content, and later the fullscreen-clock overlay controls.
- Root cause was not the screenshot crop. Vue copied OpenSource modal/tool DOM but lacked the matching hidden-state CSS contracts from `css/main.css`: `.theme-modal` default hidden state, `#license-modal` `visibility` transition, `.is-hidden`, and `.clock-overlay.is-hidden`.
- The fix restores those visibility contracts inside `PracticeLibraryPage.vue` and updates `accept_license_modal()` to wait for real computed hidden state (`visibility:hidden`, `opacity:0`, `pointer-events:none`) before capturing the homepage. This fixes userspace rendering instead of hiding the issue in tests.
- Static coverage now locks the modal hidden/visible states, `display: none !important`, clock overlay hidden state, and the screenshot helper evidence. The regenerated homepage screenshot was manually inspected and is clean: no hidden modal text and no clock controls below the main panel.
- The same pass aligned canonical analysis artifact ownership with the stated Phase 3 goal: `analysisArtifacts` remains part of the canonical submission through submit, history detail/replay, archive export/import, legacy import, and Coach success/failure writeback. History lists still read summary columns only; no schema field was added.
- No AI Coach prompt text, `review_set` query, selectedContext semantics, RAG routing, scoring, replay submit guard, writing navigation, or second history/archive path changed.

## Slice 81 Acceptance Screenshot Guard Hardening
- Manual visual inspection of the remaining Vue acceptance screenshots (`browse`, `answer`, `result`, `replay`, and `settings`) found no fresh hidden-layer leakage. The Coach panel visible in result/replay screenshots is intentional Phase 4 evidence: Submit opens Coach, transcripts/snapshot are visible, and manual chat context remains available.
- The answer screenshot's fixed bottom nav was checked against existing browser geometry assertions. The E2E already proves `.practice-nav` is fixed to bottom and the reading workspace bottom does not extend behind it, so the cropped lower question group in a static screenshot is scroll position, not confirmed userspace breakage.
- The weakness was process, not production code: hidden-shell screenshot sanity still depended on one manual inspection. `capture_acceptance_screenshot()` now scans `#license-modal`, `#suite-mode-selector-modal`, `#theme-switcher-modal`, `#achievements-modal`, and `#fullscreen-clock-overlay` before every acceptance screenshot and fails on `acceptance_screenshot_hidden_shell_leak` if a closed shell is still visible/interactable.
- Static coverage now locks that E2E guard and the modal/clock selectors. This makes the Phase 5 screenshot evidence stronger without changing product UI, Practice API, history persistence, AI Coach prompt/RAG behavior, replay semantics, or writing navigation.

## Slice 82 Practice History Filter Semantics
- Network refresh for `origin/opensource` was attempted twice (`git fetch origin opensource`) and failed both times with `Failed to connect to github.com port 443 after 75002 ms`. The slice therefore uses the latest locally available OpenSource reference, `origin/opensource@44a552f`.
- OpenSource `index.html` gives the practice history toolbar real record-filter controls with `id="record-type-filter-buttons"`, `data-index-action="filter-records"`, `data-action-value="all"`, and `data-action-value="reading"`.
- Vue had copied those DOM/action markers, but the buttons were static: `全部` was hard-coded active, `阅读` was never active, and neither button affected `filteredHistory`. That is a userspace regression because a visible OpenSource control became a dead button.
- The fix is deliberately small: add `selectedHistoryType`, bind active/`aria-pressed`, route both buttons through `filterRecords()`, and have `filteredHistory` call `historyRecordMatchesType()`. No schema, API, archive, or history storage changes were needed.
- The reading-history list still reads summary records only. The type match uses summary-level `activity`, `type`, `metadata.activity`, `metadata.type`, and existing reading identifiers (`assetId` / `examId`); it does not parse canonical `submission_json`.
- Browser coverage now clicks `阅读` and `全部` after normal submit and clicks `阅读` again after archive import before opening replay. Static coverage locks the state, handlers, and history projection so this cannot regress into marker-only UI.
- No Practice API shape, history schema, canonical reading submission fields, archive import/export path, AI Coach prompt/query/action/surface mapping, RAG routing, scoring, replay no-resubmit guard, suite state, or writing navigation changed.

## Slice 83 Reading Suite Review Nav Parity
- `git fetch origin opensource` now succeeds; `origin/opensource` and `FETCH_HEAD` both resolve to `44a552f265cfddeb844425200fcacfe665d1b340`, so there is no newer OpenSource UI source than the one already used in recent parity slices.
- OpenSource reading page core controls are not the current problem. Vue already carries the important stable IDs/classes and behavior for `timer`, `settings-btn`, `note-btn`, `settings-panel`, `notes-panel`, `selbar`, `btnHL`, `btnUH`, `btnNote`, `divider`, `question-nav`, `reset-btn`, `submit-btn`, `exit-btn`, `results`, memorize/endless states, and the Coach FAB/panel.
- The real parity gap is suite/review navigation. OpenSource `unifiedReadingPage.js` dynamically creates `#review-nav-bar` with `button[data-review-dir="prev"]` and `button[data-review-dir="next"]`, and uses that bar in review context for `上一题` / `下一题`. Vue suite replay could return to the suite list and reopen another passage, but the reading review page itself lacked the OpenSource same-page review nav layer.
- This is a UI/interaction contract, not a data-schema problem. The canonical suite session already has the data structure needed: `suiteSession.sequence`, each entry's `status`, `assetId`, and `sessionId`. Adding fields or reviving legacy review-window state would be garbage.
- `PracticeReadingPage.vue` now renders `#review-nav-bar` only when `reviewMode`, `activeSuiteSessionId`, and a loaded canonical suite sequence are all present. The previous/next targets are derived from `suiteSession.sequence`: submitted entries route to `PracticeReadingReview`; active entries route to `PracticeReading` so stationary/manual suite users can continue from a review page.
- The Vue implementation intentionally does not send legacy `REVIEW_NAVIGATE` postMessage. Static coverage forbids that string in `PracticeReadingPage.vue`; navigation is Vue router plus Practice API state.
- `practice_reading_suite_vue_flow.py` now asserts `#review-nav-bar[data-review-index="0"][data-review-total="3"]`, disabled/enabled prev/next state, next navigation to P2 replay, and prev navigation back to P1 replay. The existing forced suite-state-failure replay branch remains separate because no suite sequence means no same-page nav; it still proves history-backed replay.
- No Practice API shape, history schema, canonical submission fields, archive path, AI Coach prompt/query/action/surface mapping, RAG routing, scoring, replay no-resubmit guard, writing navigation, or OpenSource prompt semantics changed.

## Taskbook CORE-01/02/03 Practice Core Convergence
- The taskbook's first-stage problem is real: the old `PracticeService` was still the place where reading assets, writing assets, reading sessions, suite sessions, history/archive import, legacy record compatibility, and Coach history writeback met. That shape made the future NAS provider impossible to add cleanly without pouring NAS path logic into the core service.
- `ReadingAssetProvider` is now the only reading asset source boundary. The builtin implementation wraps generated manifest loading, payload parsing, explanation loading, status reporting, and cache refresh. `PracticeService` no longer imports `loadReadingManifest()`, `loadReadingPracticePayload()`, or `clearReadingAssetCaches()`.
- Keeping `server/src/lib/practice/reading-assets.ts` as a compatibility re-export is deliberate. Deleting the file would be churn; leaving it as an implementation owner would be garbage. The actual owner is now `server/src/lib/practice/reading/reading-generated-loader.ts`, called only through `BuiltinReadingAssetProvider`.
- Suite creation now consumes `PracticeAsset[]`, not `ReadingManifest` / `ManifestEntry`. This is the important data-structure fix: future NAS providers can return the same asset contract and suite selection does not care whether the backing source is builtin JS, SQLite, or another provider.
- `PracticeService` is now a compatibility shell. It wires `PracticeAssetFacade`, `PracticeHistoryFacade`, `ReadingSuiteFacade`, and `ReadingCoachFacade`, then keeps the existing method names so `routes/practice.ts` and `routes/reading.ts` do not need a route rewrite. That is the right zero-regression move.
- Legacy reading history import has been isolated into `LegacyReadingHistoryAdapter`. The fallback soup that reads `record.examId`, `metadata.examId`, `realData.examId`, `resultSnapshot.realData.examId`, old coach snapshots, and old transcript shapes is still supported, but it no longer pollutes the core service.
- Coach is separated as `ReadingCoachFacade`. It owns persisted session context injection, `ReadingAssistantService` calls, and canonical history writeback for success/failure. This matches the taskbook direction that AI Coach should be an isolated capability, not a hard dependency of basic reading assets and suite flow.
- No NAS path, authoring flow, settings-path picker, renderer file access, external script execution, API response envelope, route registration, Vue product UI, or writing flow was changed in this checkpoint.

## Taskbook CORE-04 Vue Practice Reading API Layer
- The current Vue app is a pure Vite/Vue project with JavaScript entry files and no frontend `tsconfig`, but Vite can compile imported `.ts` modules. Creating the taskbook's module files as `.ts` keeps the requested boundary names without adding TypeScript configuration churn.
- `PracticeLibraryPage.vue` previously imported `practiceAssets`, `practiceHistory`, and `practiceReadingSuite` directly from `@/api/practice-client.js`. That made the page know raw Practice facade names and endpoint-level concerns. This is exactly the coupling CORE-04 is supposed to remove.
- `apps/writing-vue/src/modules/practice-reading/api.ts` is now the single module-level wrapper around raw Practice client methods for reading library, reading history, and reading suite creation. The raw HTTP facade stays available for lower-level clients, but `PracticeLibraryPage.vue` no longer imports it.
- `useReadingLibrary()`, `useReadingHistory()`, and `useReadingSuite()` intentionally return simple functions, not shared global state. State ownership remains in `PracticeLibraryPage.vue` for this slice so CORE-04 does not accidentally become CORE-05's panel/component rewrite.
- `useReadingAttempt()` currently centralizes review-target normalization. It is small, but it gives CORE-06/CORE-05 a stable place to move reading attempt route helpers later without teaching every page about record id fallbacks.
- UI behavior, active-view routing, legacy DOM ids/data attributes, search/filter logic, backup/archive workflows, suite selector behavior, and API envelopes were not changed. The only behavior-level contract is that all existing calls still reach the same Practice API through the reading module API.

## Taskbook CORE-05 PracticeLibraryPage Panel Split
- The real problem in CORE-05 was template ownership, not business state ownership. Moving all state into child components in the same slice would create a second data owner for reading assets, history, suite selection, archive import/export, backup restore, and legacy runtime loading. That would be worse than the original large file because the same side effects would be split across component boundaries.
- The checkpoint split therefore keeps `PracticeLibraryPage.vue` as the single state/effect coordinator and extracts panel DOM into dumb components with explicit props/emits. This is boring, but it is the correct first cut: no hidden imports, no child-owned API calls, no duplicated filters, and no route side effects inside presentational panels.
- The extracted components preserve the legacy surface: `overview-view`, `browse-view`, `practice-view`, `more-view`, `settings-view`, `suite-mode-selector-modal`, `data-reading-*` markers, settings button ids, browse action markers, history action markers, and the writing entry id remain on the rendered library surface.
- `ReadingSettingsPanel.vue` now owns the hidden archive import file input because the input belongs to the settings DOM. The parent still owns archive parsing/import side effects and reaches the input only through `readingSettingsPanel.value?.click()`. This is a small exposed DOM bridge, not a second import implementation.
- Removing `<style scoped>` from `PracticeLibraryPage.vue` is deliberate. Parent scoped CSS does not match DOM rendered inside child components, so leaving it scoped would silently strip legacy OpenSource styles from every extracted panel. The existing selectors are already bounded by `.practice-library-open-source` / `.practice-library-legacy`, which is the right page-level containment for this migration checkpoint.
- Static coverage now reads the parent and every extracted component source. It locks parent import/render wiring, child emit contracts, legacy ids/data markers, settings archive input exposure, and the global stylesheet decision so future edits do not accidentally regress into marker-only UI or invisible unstyled panels.
- This checkpoint does not start CORE-06. `PracticeReadingPage.vue` still owns reading asset loading, timer, answer model, highlights, Coach, and review behavior. Splitting that page must be done separately and in the order required by the taskbook.

## Taskbook CORE-06 PracticeReadingPage API/loadAsset Split
- CORE-06 must be sliced in the taskbook order. Jumping directly from asset loading to answer model, drag/drop, highlights, and Coach would create a wider regression surface and hide which engine boundary actually broke.
- `useReadingAsset.ts` now owns `asset`, `payload`, `loading`, `error`, detail fetching, and reading asset list loading. `PracticeReadingPage.vue` no longer calls `practiceAssets.get()` or `practiceAssets.listAll()`.
- `PracticeReadingPage.vue.loadAsset()` still owns page-level state reset, answer initialization, notes loading, suite progress loading, replay loading, DOM answer sync, highlight restore, memorize layer, and timer startup. That is intentional for this checkpoint: those are not asset-fetch responsibilities, and moving them all at once would be fake modularity.
- Endless mode pool refresh now calls `loadReadingAssetPool()`, so both reading detail and reading list access go through the same module boundary. Raw `practiceAssets` remains inside the reading module API, not inside the reading page.
- Static coverage now forbids `practiceAssets.` in `PracticeReadingPage.vue` and checks that `useReadingAsset()` owns `readingLibraryApi.getAsset()` / `readingLibraryApi.listAssets()`. This prevents the page from regressing back to endpoint-level coupling.

## Taskbook CORE-06 PracticeReadingPage Timer Split
- `useReadingTimer.ts` is now the only owner of local elapsed timer state, running state, timer start anchor, clock formatting, suite timer normalization, suite anchor application, `getPracticeTimerSnapshot()`, `resolvePracticeTiming()`, and the legacy `window.__IELTS_PRACTICE_TIMER__` bridge.
- `PracticeReadingPage.vue` still decides lifecycle moments: load/reset/recycle/start/stop/submit/replay. That is the right split. Moving lifecycle into the timer composable would make the composable depend on reading submission, suite, and replay state, which is just the old page tangle under a new filename.
- The page no longer defines `formatClock()`, `normalizeSuiteTimerState()`, `window[PRACTICE_TIMER_BRIDGE_KEY]`, or direct `PRACTICE_TIMER_EVENT` dispatch. Static coverage now makes that boundary explicit.
- Direct page writes to `elapsedSeconds.value` / `startedAt.value` were the important residue. They are now replaced by `resetPracticeTimerClock()` and `setPracticeTimerElapsedSeconds()`, so the timer composable owns mutations as well as formatting/bridge behavior.

## Taskbook CORE-06 PracticeReadingPage Answer Model Split
- `useReadingAnswers.ts` is now the only owner of the local answer container, answer initialization, memorize answer-key prefill, answer clone/normalization, answer fingerprinting, answered-count projection, option-selected checks, set/toggle mutations, and answer-map snapshots.
- `PracticeReadingPage.vue` no longer creates `answers = reactive({})` and no longer implements `initializeAnswers()`, `assignAnswer()`, `setAnswer()`, `toggleAnswerOption()`, `getAnswerFingerprint()`, or direct `answers[...]` reads. Page code receives answer values through `getRawAnswer()`, `getAnswerValue()`, `getAnswerEntries()`, and `snapshotAnswerMap()`.
- Timeline tracking and native DOM synchronization remain page-owned callbacks (`onTrack`, `onSyncNative`) because they depend on active question visits, drag/drop DOM, review mode controls, and rendered `v-html` nodes. Putting those side effects inside `useReadingAnswers()` would pollute the answer model with DOM behavior.
- Drag/drop behavior still calls answer API functions, but the drag/drop group ownership, source-slot swap, dropzone rendering, and fallback select synchronization remain in the page. That is deliberate: drag/drop is UI/DOM behavior, not the pure answer store.

## Taskbook CORE-06 PracticeReadingPage Coach Split
- `useReadingCoach.ts` is now the only owner of Coach query state, loading/error/response state, selected-context state, stream status, floating panel open state, LLM review status, transcript/follow-up projections, request sequencing, Coach payload construction, SSE progress mapping, automatic review, missing-review refresh, canonical submitted-session hydration, and local transcript fallback merge.
- `PracticeReadingPage.vue` no longer imports `practiceCoach` and no longer defines `buildCoachPayload()`, `sendCoachQuery()`, `runAutomaticReviewCoach()`, `queueAutomaticReviewRefresh()`, `refreshSubmissionFromHistory()`, `mergeCoachResultIntoSubmission()`, `formatCoachStreamMessage()`, or a local `coachRequestSequence`. Raw Coach calls live behind `apps/writing-vue/src/modules/practice-reading/api.ts` and `useReadingCoach()`.
- The page still owns DOM selection extraction through `readSelectedContext()`, `resolveSelectionElement()`, `collectSelectedQuestionNumbers()`, and `collectSelectedParagraphLabels()` because those functions depend on rendered passage/question DOM. This is not Coach orchestration; it is a DOM adapter passed into the composable.
- Replay and submit lifecycle now call `hydrateReadingCoachFromSubmission()`, `setReadingCoachOpen()`, and `resetReadingCoachState()` instead of writing individual Coach refs. That removes a bad half-state where page reset could clear visible state but leave stale selected context or request sequencing in another owner.
- `readingCoachApi` and `readingSessionApi` extend the existing reading module API boundary. That keeps raw Practice client imports centralized and prevents `PracticeReadingPage.vue` from knowing endpoint-level Coach/session calls.
- Static coverage now locks both sides: the page must use `useReadingCoach()` and must not own raw Coach lifecycle logic; `useReadingCoach.ts` must own payload fields, stream progress, canonical history refresh, fallback merge, and session guards.

## Taskbook CORE-06 PracticeReadingPage Display Component Split
- The display split is now complete, but the data ownership did not move into components. `PracticeReadingPage.vue` and the existing composables still own asset lifecycle, suite/replay orchestration, timer, answers, drag/drop DOM sync, highlights, submission, and Coach orchestration.
- `ReadingPassagePane.vue`, `ReadingQuestionPane.vue`, `ReadingReviewPanel.vue`, `ReadingCoachPanel.vue`, and `ReadingAnswerNav.vue` are pure props/emits display components. They do not import the raw Practice client and do not create independent reading state. That is the important line; a child component that calls Practice API here would recreate the same garbage boundary under a new filename.
- Legacy reading surface markers moved with their DOM owners instead of staying in the parent page: passage owns `#left` and official passage explanations; questions own `#right`, `#question-groups`, official question explanations, and memorize panel; review owns `#results`, analysis, result table, and LLM review markers; Coach owns the FAB/panel/transcript/action markers; nav owns `data-reading-answer-nav`, `#question-nav`, `#exit-btn`, `#reset-btn`, and `#submit-btn`.
- Parent scoped CSS cannot style child component internals. `PracticeReadingPage.vue` therefore uses page-level `<style>` and normal selectors instead of `<style scoped>` / `:deep(...)`. The containment remains the existing `.reading-page`, `#left`, `#right`, and reading-specific class/id surface; leaving scoped CSS in place would have silently broken the extracted UI.
- Static coverage now reads the parent plus all five display component sources. It locks import/render wiring, props/emits contracts, legacy marker placement, no raw Practice API imports in display components, and the page-level stylesheet decision.
- CORE-06 is now checkpoint complete. CORE-07 AI Coach isolation is the next taskbook slice, but it should be started as a separate settings/feature-flag change, not hidden inside the display component split.

## Taskbook CORE-07 AI Coach Isolation
- The real CORE-07 data structure is one setting key: `practice.readingCoach.enabled`. Adding another localStorage key or a page-only boolean would split ownership and become garbage the first time a NAS/customer build needs to disable Coach consistently.
- The setting defaults to enabled. Missing `settingsService`, missing setting values, invalid setting values, and settings read failures must not disable Coach accidentally because that would be a behavior regression for existing users.
- `ReadingCoachFacade` is the correct backend gate. Both Practice Coach routes and legacy reading assistant routes flow through `PracticeService.coach()`, so the disabled check happens once before session-context hydration and before the real `ReadingAssistantService.query()` call.
- Disabled Coach returns `practice_coach_disabled` with `settingKey: practice.readingCoach.enabled`. Normal HTTP routes return 403; SSE routes keep the stream envelope and emit an error event, then end. This preserves endpoint registration without executing Coach logic.
- Reading submit, history replay/detail, and suite create/get/submit do not read the Coach setting and do not call ReadingCoach. The disabled switch cuts the plugin capability, not the basic reading lifecycle.
- On the Vue side, raw `/api/settings` access belongs in `apps/writing-vue/src/modules/practice-reading/api.ts` as `readingCoachSettingsApi`. `PracticeReadingPage.vue` should not import the raw settings client; otherwise CORE-04's module boundary starts leaking again.
- `PracticeReadingPage.vue` loads the Coach setting before loading assets/replay state. That order matters: replay can otherwise queue automatic review while the page is still assuming the default enabled value.
- `useReadingCoach()` now accepts `readCoachEnabled`. That puts the guard at the composable boundary for manual questions, quick actions, selection actions, automatic review, replay refresh, panel open state, and in-flight responses after a user disables Coach.
- The page still has explicit gates around `ReadingCoachPanel`, submit-time `runAutomaticReviewCoach()`, and replay-time `queueAutomaticReviewRefresh()`. These are intentional belt-and-suspenders gates at the lifecycle side-effect points, not duplicated data ownership.
- The reading settings panel now exposes an AI Coach enable/disable control backed by `/api/settings`. Save failure rolls the UI back and rehydrates Coach state from the current submission instead of leaving a half-disabled panel.
- CORE-08's real problem was not ordinary `localStorage`, `window.open`, or `window.confirm`; it was scattered ownership of legacy timer bridge state, duplicated page-local script/style loaders, and direct `window.*` tool globals across `useReadingTimer.ts`, `PracticeLibraryPage.vue`, `SettingsPage.vue`, and `ShuiBackground.vue`.
- `apps/writing-vue/src/modules/legacy/legacyBridge.ts` is now the single owner for `__IELTS_PRACTICE_TIMER__`, `practiceTimerStateChange`, more-tools entrypoints, onboarding/update-manager globals, and SHUI background theme/teardown hooks. This removes page-level special cases without changing the legacy key/event names userspace still depends on.
- `apps/writing-vue/src/modules/legacy/legacyScriptLoader.ts` is now the single loader owner. Vue business components no longer create `<script>` / `<link>` tags directly or maintain their own dedupe maps.
- The static contract was deliberately moved away from white-box page assertions like `window.openClockOverlay`, `new window.AppUpdateManager()`, and page-local `loadLegacyScript(...)`. Those were implementation-detail locks and would have made any future bridge cleanup look like a product regression.
- CORE-09 exposed a real local-service security hole: `server/src/app.ts` reflected arbitrary `Origin` into `Access-Control-Allow-Origin`, and `server/src/lib/shared/sse.ts` unconditionally returned `*`. On a loopback-only service this still allows a malicious webpage to drive destructive local API requests from the user's browser.
- `server/src/lib/shared/local-api-guard.ts` now defines the real trust model: allow `app://app`, `file:`/null origin, and localhost/127.0.0.1/::1 origins; reject foreign origins/referers on write methods and on preflight. This keeps Electron/Vue packaged traffic working without leaving `/api/practice/history` writable from arbitrary websites.
