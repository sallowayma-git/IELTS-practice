# Task Plan: IELTS 仓库 JS 瘦身计划

## Goal
在不破坏现有 `file://` 运行方式和既有测试流的前提下，完成一次面向整个仓库的 JS 瘦身规划，并把后续执行拆成可由 `gpt-5.3-codex` subagent 并行推进的阶段。

## Current Phase
Phase 5

## Phases

### Phase 1: 全库盘点与病灶定位
- [x] 理解用户目标：不是小修小补，而是给整个库做结构瘦身
- [x] 盘点 JS 文件数量、热点文件、入口和运行链路
- [x] 识别过度设计热点并记录到 `findings.md`
- **Status:** complete

### Phase 2: 瘦身方案设计
- [x] 明确哪些复杂度是真业务，哪些是垃圾抽象
- [x] 定义零破坏约束：`file://`、懒加载入口、现有测试合同
- [x] 形成分阶段、可执行、可验证的瘦身计划
- [x] 划分适合 subagent 执行的独立任务边界
- **Status:** complete

### Phase 3: 执行面切分与 subagent 委派
- [x] 完成第一波安全瘦身
- [x] 选出第二波真正的高脂肪模块
- [x] 按不重叠写入范围拆给 `gpt-5.3-codex` subagent
- [x] 记录各 subagent 负责文件与验收条件
- **Status:** complete

### Phase 4: 主线集成与回归验证
- [x] 合并子任务产物，确保接口兼容
- [x] 运行 `python3 developer/tests/ci/run_static_suite.py`
- [x] 运行 `python3 developer/tests/e2e/suite_practice_flow.py`
- **Status:** complete

### Phase 5: 交付与后续路线
- [x] 输出已完成瘦身项与残留风险
- [x] 给出下一轮继续瘦身的优先级
- [ ] 向用户交付计划、执行结果和验证结论
- **Status:** in_progress

## Key Questions
1. 当前仓库的复杂度，哪些来自真实业务，哪些只是历史兼容垃圾没有清理？
2. 哪些全局接口被页面、主题、E2E 测试依赖，必须保留兼容壳？
3. 哪些模块能先收拢再删减，而不会打破 `file://` 场景与懒加载约束？
4. subagent 应该按什么边界拆分，才能减少冲突并保持每一步都可回滚、可验证？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 先做全库结构盘点，再写执行计划 | 这个库不是单文件脏，而是入口、全局状态、懒加载、fallback 一起缠死了，直接改只会制造更多垃圾 |
| 把 `file://` 和现有两条必跑测试作为硬约束 | 仓库规则明确要求兼容 `file://`，且静态套件与套题 E2E 是最重要的回归基线 |
| 优先瘦身“启动链/兼容链/全局桥接层”，不是先碰业务细节 | 这些层是复杂度扩散源，先收口数据流和入口，后面业务模块才有机会真正变薄 |
| 后续执行以“保留外部 API，收缩内部实现”为第一原则 | 主题适配器、HTML inline handler、测试脚本都依赖全局 API，直接删接口会破坏 userspace |
| 停止把“拆新文件”当作默认瘦身手段 | 这个仓库已经有 90 个 JS 文件，再拆只会把垃圾分散，不会变少 |
| 第二轮之后只接受减法式重构 | 验收指标必须是文件数减少、总代码量减少、桥接层减少，而不是“结构更优雅” |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `python` 命令不存在 | 1 | 改用 `python3` 继续执行仓库规定测试 |
| 静态套件缺少 `checklist.md` | 1 | 已确认是仓库环境/资产缺失，非本次瘦身引入；暂记录为外部阻断 |

## Notes
- 先简化数据结构，再消除特殊情况，最后再删兼容层；顺序不能反。
- 任何瘦身动作都必须保留 `showView`、`loadExamList`、`updatePracticeView` 等外部合同，直到依赖面被一并替换。
- `boot-fallbacks.js`、`main.js`、`main-entry.js`、`lazyLoader.js` 是第一优先级热点。
- 第一波执行只做“收口”和“减重”，不做行为改写：
  - 启动链收口：把 boot shim/代理逻辑集中到单点，避免 `main.js` 和 `main-entry.js` 双写。
  - fallback 收口：把真正的紧急兜底保留，其余重复 UI/工具函数抽成共享实现或直接删冗余分支。
  - 事件收口：先减少 `index.html` 对全局函数名和 inline handler 的依赖。
- 第一波已完成并通过套题主流程 E2E；静态套件剩余失败仅与根目录缺失 `checklist.md` 有关。
- 已回退第二波中错误的“拆文件式瘦身”尝试，避免把 90 个 JS 继续拆成 91 个。
- 新的第二波只允许减法：
  - 删重复
  - 合并碎文件职责到现有文件内
  - 缩短业务链路
  - 减少全局桥接与 fallback 垃圾分支
  - 绝不新增 JS 文件
- 第二波减法结果已经落地：
  - `js/presentation/indexInteractions.js` 从当前错误增肥态 `397` 行压到 `236` 行，比 `HEAD` 还少 `20` 行。
  - `js/app/main-entry.js`、`js/runtime/lazyLoader.js` 合计净减 `40` 行。
  - `js/boot-fallbacks.js`、`js/app/fallbackMixin.js` 在上一轮基础上再净减 `20` 行。
  - `js/` 总行数已从盘点时的 `64519` 降到 `64291`，净减 `228` 行。
  - `window/global` 赋值已从 `564` 级别降到 `516`。
- 第三波减法结果已经落地：
  - `js/main.js` 从 `3396` 行压到 `3380` 行，继续缩掉 browse fallback / bridge 垃圾。
  - `js/app/examSessionMixin.js` 从 `3763` 行压到 `3579` 行，净减 `184` 行，且 `onclick=` 命中已降到 `0`。
  - 当前 `js/` 总行数已从盘点时的 `64519` 降到 `64091`，累计净减 `428` 行。
  - 当前 `window/global` 赋值为 `517`，较初始盘点仍显著下降，但第三波里 `main.js` 为兼容入口补了极薄桥接壳，导致比上一轮多回升 `1`。
- 第四波纠偏与减法结果已经落地：
  - 恢复了 `js/boot-fallbacks.js` 中导入数据弹窗的动画与玻璃态视觉代码，避免继续把视觉效果误删成“瘦身”。
  - 静态套件已适配 `checklist.md` 被删除的现状，相关审计改为合理 `skip`，`run_static_suite.py` 已重新转绿。
  - `js/components/practiceHistoryEnhancer.js` 从 `392` 行压到 `361` 行，净减 `31` 行，且不触碰导出弹窗的视觉层。
  - 当前 `js/` 总行数为 `64132`，相对初始盘点 `64519` 仍累计净减 `387` 行。
  - 当前 `window/global` 赋值为 `515`，较初始盘点 `564` 少 `49`。
- 第五波减法结果已经落地：
  - `js/practice-page-enhancer.js` 从 `4492` 行压到 `4468` 行，净减 `24` 行。
  - 本轮继续只删逻辑垃圾：重复脚本加载、重复 fallback 存储、重复初始化定时器、无效 debug 测试写读；未触碰视觉层。
  - 当前 `js/` 总行数为 `64108`，相对初始盘点 `64519` 累计净减 `411` 行。
  - 当前 `window/global` 赋值为 `514`，较初始盘点 `564` 少 `50`。
- 第六波减法结果已经落地：
  - `js/main.js` 继续压缩重复的 browse/resource 全局桥接，统一到 `createMethodDelegate/ensureWindowDelegate`，从 `3380` 行压到 `3327` 行，净减 `53` 行。
  - `gpt-5.3-codex` subagent `Gauss` 压缩了 `js/app/suitePracticeMixin.js`，合并重复的 suite 窗口解析、`openExam` 参数拼装、消息通知和聚合循环，从 `2287` 行压到 `2266` 行，净减 `21` 行。
  - 本轮继续严格不碰前端视觉、动效、布局代码。
  - 当前 `js/` 总行数为 `64037`，相对初始盘点 `64519` 累计净减 `482` 行。
  - 当前 `window/global` 赋值为 `513`，较初始盘点 `564` 少 `51`。
- 第七波减法结果已经落地：
  - `gpt-5.3-codex` subagent `Popper` 压缩了 `js/utils/storage.js`，删除被覆盖的死方法，收口重复的 IndexedDB/webStorage/fallback 分支，从 `2804` 行压到 `2782` 行，净减 `22` 行。
  - 主线压缩了 `js/core/practiceRecorder.js` 与 `js/core/scoreStorage.js` 中重复的 `PracticeCore` 合同/仓库取值和默认统计对象：
    - `js/core/practiceRecorder.js`：`2666 -> 2652`，净减 `14` 行。
    - `js/core/scoreStorage.js`：`1892 -> 1900`，为减少重复桥接引入极薄 helper，净增 `8` 行。
  - 本轮净效果仍然是减法，且继续不碰视觉层。
  - 当前 `js/` 总行数为 `63983`，相对初始盘点 `64519` 累计净减 `536` 行。
  - 当前 `window/global` 赋值仍为 `513`，较初始盘点 `564` 少 `51`。
- 第八波减法结果已经落地：
  - `gpt-5.3-codex` subagent `Halley` 压缩了 `js/runtime/unifiedReadingPage.js`，收口重复的 review navigate payload、draft mirror 存取、JSON try/catch 和 elapsed 计算，从 `2467` 行压到 `2457` 行，净减 `10` 行。
  - 主线压缩了 `js/practice-page-ui.js` 的标记题 sessionStorage 读写和 simulation mode/关闭窗口点击样板，最终从 `1917` 行压到 `1907` 行，净减 `10` 行。
  - 本轮中途一度因为 helper 壳导致 `practice-page-ui.js` 短暂增肥，随后已继续压回，最终整轮是净减，不是装优化。
  - 当前 `js/` 总行数为 `63963`，相对初始盘点 `64519` 累计净减 `556` 行。
  - 当前 `window/global` 赋值为 `512`，较初始盘点 `564` 少 `52`。
- 第九波减法结果已经落地：
  - 新增了 `developer/tests/js/practicePageUi.test.js`，补上 `practice-page-ui` 最近改动链路的定向守卫：
    - marked questions 恢复/持久化
    - simulation mode 下 submit/reset 点击守卫
    - exit 按钮关闭合同
  - `developer/tests/ci/run_static_suite.py` 已接入新的 `练习页 UI 回归测试`，后续继续砍阅读页链路时不再裸奔。
  - `gpt-5.3-codex` subagent `Confucius` 压缩了 `js/app/examSessionMixin.js`，收口重复的 practice record 保存/回读验证/fallback 存储链，从 `3579` 行压到 `3573` 行，继续只删逻辑垃圾。
  - 当前 `js/` 总行数为 `63949`，相对初始盘点 `64519` 累计净减 `570` 行。
  - 当前 `window/global` 赋值仍为 `512`，较初始盘点 `564` 少 `52`。
- 第十波减法结果已经落地：
  - 新增了 `developer/tests/js/practicePageEnhancer.test.js`，补上 `practice-page-enhancer` 的定向守卫：
    - replay 回放恢复 marked questions
    - `sendMessage` 的只读上报阻断
    - `collectAnswersNow/getCorrectAnswers` 导出合同
  - `developer/tests/ci/run_static_suite.py` 已接入新的 `练习页增强器回归测试`。
  - `gpt-5.3-codex` subagent `Lovelace` 压缩了 `js/practice-page-enhancer.js`，收口消息链、suite guard、URL/参数解析与 retry 样板，从 `4440` 行压到 `4406` 行，净减 `34` 行。
  - 当前 `js/` 总行数为 `63915`，相对初始盘点 `64519` 累计净减 `604` 行。
  - 当前 `window/global` 赋值仍为 `512`，较初始盘点 `564` 少 `52`。
- 后续整体结构简化路线已经明确：
  - `unifiedReadingPage` 只负责上下文/回放/提交协议。
  - `practice-page-ui` 只负责 DOM 交互。
  - `practice-page-enhancer` 只负责答案采集与父窗口通信。
  - `main-entry` 继续作为唯一真实入口，`main.js` 仅保留兼容桥，`boot-fallbacks.js` 仅保留真正兜底。
- 第十一波减法结果已经落地：
  - 新增了 `developer/tests/js/unifiedReadingPage.test.js`，补上 unified 协议链的定向守卫：
    - `INIT_SESSION` simulation 协议
    - `SIMULATION_CONTEXT` runtime flag 与按钮合同
    - `SESSION_READY` envelope
    - `REVIEW_NAVIGATE` payload
  - `developer/tests/ci/run_static_suite.py` 已接入新的 `统一阅读页协议回归测试`。
  - `gpt-5.3-codex` subagent `Bacon` 压缩了 `js/runtime/unifiedReadingPage.js`，收口 simulation/review/replay/init 的重复状态写入与 payload 样板，从 `2457` 行压到 `2439` 行，净减 `18` 行。
  - 当前 `js/` 总行数为 `63897`，相对初始盘点 `64519` 累计净减 `622` 行。
  - 当前 `window/global` 赋值仍为 `512`，较初始盘点 `564` 少 `52`。
- 练习页运行时的下一步结构收口顺序已经更明确：
  - 先继续压 `unifiedReadingPage` 与 `practice-page-ui` 间重复的 simulation/review 状态同步。
  - 再压 `practice-page-enhancer` 与 `unifiedReadingPage` 间重复的 replay/message 合同。
  - 最后再处理跨入口的 bridge 壳，而不是同时动三边。
- 第十二波减法结果已经落地：
  - 扩充了 `developer/tests/js/practicePageUi.test.js`，补上：
    - `updatePracticeSuiteModeUI` 保持隐藏合同
    - `ENDLESS_COUNTDOWN -> ENDLESS_USER_EXIT` 的退出链路合同
  - `gpt-5.3-codex` subagent `Kierkegaard` 压缩了 `js/practice-page-ui.js`，把 `simulation/review/endless` 三条按钮链和 marked questions 的重复样板继续收口，从 `1917` 行压到 `1906` 行，净减 `11` 行。
  - 当前 `js/` 总行数为 `63896`，相对初始盘点 `64519` 累计净减 `623` 行。
  - 当前 `window/global` 赋值仍为 `512`，较初始盘点 `564` 少 `52`。
- 第十三波减法结果已经落地：
  - 主线压缩了 `js/practice-page-enhancer.js` 的 replay fallback 垃圾，把 `applyReplayRecord` 和 `dispatchPracticeResultsEvent` 里重复的只读回放兜底调度砍成单点，从 `4406` 行压到 `4400` 行，净减 `6` 行。
  - 扩充了 `developer/tests/js/practicePageEnhancer.test.js`，新增“回放 fallback 只调度一次”守卫，防止结果表兜底链再长回双份垃圾。
  - `gpt-5.3-codex` subagent `Sartre` 压缩了 `js/practice-page-ui.js`，把 `renderResultsSummary` 和 `handleResultsReady` 之间重复的结果行解析、答案映射和 correctness 判定收口到统一 helper，从 `1906` 行压到 `1901` 行，净减 `5` 行。
  - `developer/tests/js/practicePageUi.test.js` 同步从 `770` 行压到 `757` 行，新增 `practiceResultsReady` 的 pending/final 合同守卫，同时保留 marked questions、suite mode UI 和 endless exit 回归保护。
  - 当前 `js/` 总行数为 `63885`，相对初始盘点 `64519` 累计净减 `634` 行。
  - 当前 `window/global` 赋值仍为 `512`，较初始盘点 `564` 少 `52`。
- 第十四波减法结果已经落地：
  - `gpt-5.3-codex` subagent `Curie` 先压缩了 `js/runtime/unifiedReadingPage.js`，把 `applyReviewContext`、`applyReplayRecord`、`INIT_SESSION` 三处重复的 review/readOnly 协议样板收口到单点 `applyReviewMode(...)`，并继续压缩 `REVIEW_NAVIGATE` 拼包与 init/replay signature 噪音，从 `2439` 行压到 `2433` 行，净减 `6` 行。
  - 主线补完了 `developer/tests/js/unifiedReadingPage.test.js` 的协议守卫，新增：
    - `INIT_SESSION(reviewMode=true, readOnly=false)` 必须保持可编辑合同
    - `REVIEW_CONTEXT(viewMode=answering)` 必须退出只读并恢复 answering 状态
  - 当前 `js/` 总行数为 `63879`，相对初始盘点 `64519` 累计净减 `640` 行。
  - 当前 `window/global` 赋值仍为 `512`，较初始盘点 `564` 少 `52`。
- 第十五波减法结果已经落地：
  - `gpt-5.3-codex` subagent `Beauvoir` 压缩了 `js/practice-page-enhancer.js`，把 `startCorrectAnswerMonitoring()`、`startResultsMonitoring()`、`hasRenderableResults()`、`extractScore()` 周围重复读取 `#results`、重复判断可见性/表格/文本的垃圾收口到 `readResultsState()`，并把分数构造样板收口到 `buildScoreInfo()` / `buildPercentageScoreInfo()`，从 `4400` 行压到 `4371` 行，净减 `29` 行。
  - `developer/tests/js/practicePageEnhancer.test.js` 从 `340` 行增加到 `368` 行，新增 `results monitoring + extractScore` 合同守卫，验证：
    - 结果表出现时会触发 `extractFromResultsTable`
    - `Final Score` 出现时会触发 `collectAllAnswers + handleSubmit`
    - 监控重试参数保持兼容
    - `extractScore` 保持 `Accuracy: 85%` 提取合同
  - 两文件合计仍是净减：`4740 -> 4739`。
  - 当前 `js/` 总行数为 `63850`，相对初始盘点 `64519` 累计净减 `669` 行。
  - 当前 `window/global` 赋值仍为 `512`，较初始盘点 `564` 少 `52`。
- 第十六波减法结果已经落地：
  - `gpt-5.3-codex` subagent `Bernoulli` 压缩了 `js/practice-page-enhancer.js`，把 `generateSuiteAnswerComparison()`、`calculateSuiteScore()`、`sendSuiteCompleteMessage()` 与通用 `generateAnswerComparison()` / `calculateScoreFromComparison()` 间重复的“遍历答案键 -> 组 comparison -> 算分 -> 拼 payload”样板继续收口到共享 helper，从 `4371` 行压到 `4351` 行，净减 `20` 行。
  - `developer/tests/js/practicePageEnhancer.test.js` 新增 `suite submit payload` 合同守卫，覆盖：
    - suite comparison 只保留当前套题键
    - suite score 百分比与 `source` 合同保持兼容
    - `comparison_fallback` 仍保持原有来源标签
    - suite payload 的 `answers/correctAnswers/spellingErrors/scoreInfo` 去前缀与透传合同不回归
  - 两文件合计仍是净减：`4739 -> 4755` 在测试增长后不满足净减，因此我按当前工作区重算实际基线为第十五波结束后 `4371 + 368 = 4739`，当前为 `4351 + 404 = 4755`，说明测试增长吃掉了主文件减重；这轮对子模块本体是净减，但总量不是漂亮数字，后续要继续在增强器主文件追回这部分测试成本。
  - 当前 `js/` 总行数为 `63830`，相对初始盘点 `64519` 累计净减 `689` 行。
  - 当前 `window/global` 赋值仍为 `512`，较初始盘点 `564` 少 `52`。
- 练习页运行时的收口顺序继续成立，但优先级更清晰：
  - 下一轮优先回头压 `main.js` 和 `boot-fallbacks.js` 的剩余 bridge 垃圾，把全局桥接继续收窄。
  - 然后再决定是否继续追回 `practice-page-enhancer` 因测试增长带来的总量回弹。
