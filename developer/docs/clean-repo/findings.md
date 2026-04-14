# Findings & Decisions

## Requirements
- 从整体项目视角遍览整个仓库，不只盯某个文件。
- 识别 JS 过多、脚本分散、实际业务简单但结构臃肿的问题。
- 形成一份瘦身计划，明确优先级、边界、风险和验证方式。
- 计划写好后，启用 `gpt-5.3-codex` subagent 按计划执行。
- 全过程必须兼容 `file://` 协议，不能破坏现有静态运行与测试链。

## Research Findings
- `js/` 下共有 `90` 个 JS 文件，总代码量约 `64519` 行，明显超出一个浏览器静态 IELTS 练习应用的合理复杂度。
- 启动链至少有四层：`index.html` 脚本装配、[`js/app/main-entry.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/main-entry.js)、[`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js)、[`js/app.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app.js)。这不是分层，这是重复和相互兜底。
- [`js/runtime/lazyLoader.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/lazyLoader.js) 把应用切成 `state-core`、`browse-runtime`、`practice-suite`、`session-suite`、`more-tools` 等组，但页面本身又直接在 `index.html` 里静态加载大量脚本，懒加载和直载并存，导致链路难以判断。
- `fallback / legacy / 降级` 相关命中 `578` 次，`legacy / 兼容` 命中 `216` 次，`mixin` 命中 `83` 次。这说明仓库在长时间叠补丁，没有做清场。
- [`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js) 约 `3415` 行，`window.` 访问 `318` 次；[`js/app/examSessionMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js) 约 `3763` 行，`window.` 访问 `141` 次。这两个文件已经不是模块，是垃圾堆。
- 全仓存在约 `564` 处 `window.xxx =` 或 `global.xxx =` 形式的全局导出，说明真实依赖不是模块图，而是“谁先挂到 window 上谁就能活”。
- [`index.html`](/Users/maziheng/Downloads/0.3.1%20working/index.html) 里至少有 `27` 个 inline handler（`onclick` / `oninput` / `onkeyup`），这逼着运行时继续保留大量全局函数名。
- 目录体量热点：`js/app` 约 `11151` 行、`js/utils` 约 `10409` 行、`js/components` 约 `8753` 行、`js/core` 约 `7668` 行。说明“工具层”和“应用层”都在膨胀，而不是单一业务点爆炸。
- 测试和代码都明确依赖 `AppLazyLoader.getStatus(...)`、`showView`、`loadExamList`、`updatePracticeView`、`appStateService`。这些在瘦身初期必须保留兼容壳。
- 仓库规范明确要求每次功能或优化后跑：
  - `python developer/tests/ci/run_static_suite.py`
  - `python developer/tests/e2e/suite_practice_flow.py`
- 本机环境没有 `python` 命令，执行仓库测试需要改用 `python3`。
- 第一波瘦身后，`suite_practice_flow.py` 已通过；`run_static_suite.py` 剩余失败只来自根目录缺失 `checklist.md`，不是本轮代码回归。
- 用户已明确否定“拆文件式瘦身”。对于这个仓库，新增文件会加剧碎片化，必须改为减法式重构。
- 第二波减法已验证为净减少，不是代码搬家：
  - [`js/presentation/indexInteractions.js`](/Users/maziheng/Downloads/0.3.1%20working/js/presentation/indexInteractions.js) 从错误膨胀态 `397` 行压到 `236` 行，也低于 `HEAD` 的 `256` 行。
  - [`js/app/main-entry.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/main-entry.js) 从 `473` 行压到 `437` 行；[`js/runtime/lazyLoader.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/lazyLoader.js) 从 `307` 行压到 `303` 行。
  - [`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js) 从 `1463` 行压到 `1378` 行；[`js/app/fallbackMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/fallbackMixin.js) 从 `302` 行压到 `237` 行。
  - 当前 `js/` 总量为 `64291` 行，相比初始盘点 `64519` 行净减 `228` 行。
  - 全局赋值已从 `564` 级别降到 `516`，说明全局桥接垃圾确实在减少。
- `index.html` 的设置区和搜索框已经统一改为 `data-action` / `data-input-action`，`inline handler = 0` 仍然成立。
- `theme-switcher.js` 里残留的 `onclick` 选择器已补兼容，否则主题弹窗打开链路会带隐性回归风险。
- `suite_practice_flow.py` 在本轮出现过一次“手动回看模式 next 跳转超时”，随后连续两次重跑通过，表现更像历史抖动点而不是稳定回归。
- 第三波减法继续命中真正的垃圾层：
  - [`js/app/examSessionMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js) 里 `3360-3675` 一带的大段结果模态/活动会话模板，很多已经没有显示入口，只是在白白堆字符串和内联 `onclick`。
  - [`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js) 的 `browseCategory -> applyBrowseFilter -> loadExamList/resetBrowseViewToAll/displayExams` 仍有重复桥接和重复 fallback 判断，但能继续压缩而不破坏 `file://`。
- 第三波结束后，[`js/app/examSessionMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js) 的 `onclick=` 命中已归零。
- 用户新增约束已明确：后续瘦身不能再把视觉代码、动效代码、样式表达当垃圾删掉。尤其是 fallback / modal 里的视觉层，必须区分“视觉代码”和“业务垃圾”。
- [`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js) 的 `showImportModeModal` 被上一轮误删了关键动画和玻璃态视觉样式。已恢复：
  - `@keyframes importFadeIn`
  - `@keyframes importScaleIn`
  - overlay blur / modal glass / hover transform / icon hover motion
- `checklist.md` 已被仓库正式删除，因此：
  - [`developer/tests/ci/audit_pdf_checklist_and_mona.py`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/ci/audit_pdf_checklist_and_mona.py)
  - [`developer/tests/ci/check_checklist_consistency.py`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/ci/check_checklist_consistency.py)
  需要改为 `skip` 而不是 `fail`。
- 当前测试缺口已补上一块关键守卫：
  - [`developer/tests/js/practicePageUi.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageUi.test.js) 现在直接守 `practice-page-ui` 最近动过的合同，不再只靠大而化之的 E2E 兜底。
  - 覆盖点包括 marked questions 恢复/持久化、simulation mode 点击守卫、exit 按钮关闭合同。
- `practice-page-enhancer.js` 也已补上定向守卫：
  - [`developer/tests/js/practicePageEnhancer.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageEnhancer.test.js) 现在直接守 replay mark 恢复、`sendMessage` 只读阻断、`collectAnswersNow/getCorrectAnswers` 导出合同。
  - 这样后续继续压消息桥、suite guard 和 retry 样板时，不会只能靠 E2E 碰运气。
- `unifiedReadingPage.js` 也已补上定向守卫：
  - [`developer/tests/js/unifiedReadingPage.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/unifiedReadingPage.test.js) 现在直接守 `INIT_SESSION/SIMULATION_CONTEXT/SESSION_READY/REVIEW_NAVIGATE` 协议合同。
  - 这样后续继续压 unified 协议状态机时，不会只能靠套题 E2E 兜底。
- `practice-page-ui.js` 的守卫已从“只测基础交互”扩到“覆盖协议同步和 endless exit”：
  - [`developer/tests/js/practicePageUi.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageUi.test.js) 现在额外守 `updatePracticeSuiteModeUI` 保持隐藏合同，以及 `ENDLESS_COUNTDOWN -> ENDLESS_USER_EXIT -> window.close` 退出链。
  - 后续继续压 UI 与 protocol 层的重叠时，这两条不会再裸奔。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 先做“收口”，不做“直接大删” | 当前依赖面靠全局函数和 HTML inline handler 维持，直接删只会把测试和主题适配器炸掉 |
| 启动链是第一刀 | 入口重复、shim/fallback 重叠，是复杂度扩散源，先统一这里才能继续收缩其余层 |
| `main.js` / `boot-fallbacks.js` / `app.js mixin` / `lazyLoader` 作为第一批改造对象 | 它们串起全局状态、兼容壳、懒加载和页面切换，是最肥也最脏的几块 |
| 初期保留对外全局 API，内部改成单一实现 | 先让多个调用点指向同一个真实现，再删除旧壳，风险最低 |
| subagent 切分按“文件写入域”而不是“功能名” | 这个库横向耦合重，按责任范围拆文件边界更容易避免互相覆盖 |
| 新一轮 subagent 必须以净减指标验收 | 不看“拆得更模块化”，只看文件数、总代码量、桥接层是否真的下降 |

## Execution Plan
- Wave 1: 启动链瘦身
  - 目标：让启动、懒加载代理、外部公共入口只剩一个真实来源。
  - 目标文件：[`js/app/main-entry.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/main-entry.js)、[`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js)、[`js/runtime/lazyLoader.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/lazyLoader.js)
  - 动作：删重复 shim，保留单点代理，减少“如果没定义就再挂一次”的链式兜底。
- Wave 1: fallback 收口
  - 目标：把真正必要的紧急兜底和重复的历史垃圾分开。
  - 目标文件：[`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js)、[`js/app/fallbackMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/fallbackMixin.js)
  - 动作：保留 `file://` 和缺模块场景必需兜底，删除/抽离重复的 DOM 工具与 UI 构造。
- Wave 1: 页面事件收口
  - 目标：减少 `index.html` 对全局函数名的硬绑定。
  - 目标文件：[`index.html`](/Users/maziheng/Downloads/0.3.1%20working/index.html)、[`js/presentation/indexInteractions.js`](/Users/maziheng/Downloads/0.3.1%20working/js/presentation/indexInteractions.js)
  - 动作：把 inline handler 改成事件委托或初始化绑定；必要时保留兼容别名。
- Wave 2: 状态链收口
  - 目标：`appStateService` 成为浏览/练习态唯一写入口。
  - 目标文件：[`js/app/state-service.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/state-service.js)、[`js/app/stateMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/stateMixin.js)、[`js/app/browseController.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/browseController.js)、[`js/app/examActions.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/examActions.js)
  - 动作：去掉重复状态镜像与多处同步。
- Wave 3: 超级文件拆解
  - 目标：分裂并缩小 [`js/app/examSessionMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js) 和 [`js/practice-page-enhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-enhancer.js)。
  - 动作：按“会话桥接 / 记录落盘 / 套题导航 / 练习页增强”拆分。

## New Wave 2 Plan
- Worker A: 压缩 [`js/presentation/indexInteractions.js`](/Users/maziheng/Downloads/0.3.1%20working/js/presentation/indexInteractions.js) 与 [`index.html`](/Users/maziheng/Downloads/0.3.1%20working/index.html) 的事件链，消灭重复绑定函数，保持 inline handler 为 0，同时让总代码量净减少。
- Worker B: 在不新增文件的前提下压缩 [`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js)，合并重复的 browse fallback / display fallback / reset fallback 路径，减少桥接壳代码。
- Worker C: 压缩 [`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js) 与 [`js/app/fallbackMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/fallbackMixin.js)，继续删掉重复 DOM helper、重复 fallback 分支和无用兼容逻辑。

## New Wave 2 Outcome
- 主线本地修改：
  - 删掉 [`js/presentation/indexInteractions.js`](/Users/maziheng/Downloads/0.3.1%20working/js/presentation/indexInteractions.js) 里死掉的 quick-lane 逻辑和“按 ID 绑定 + data-action 委托”双系统。
  - 把 [`index.html`](/Users/maziheng/Downloads/0.3.1%20working/index.html) 设置区按钮、引导按钮、搜索框全部接到统一动作总线，减少散点监听。
  - 补上 [`js/theme-switcher.js`](/Users/maziheng/Downloads/0.3.1%20working/js/theme-switcher.js) 对新 `data-action` 按钮的识别，避免打开主题面板后立即被“点外关闭”逻辑误伤。
- Subagent 结果：
  - `Boyle`：压缩 [`js/app/main-entry.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/main-entry.js) / [`js/runtime/lazyLoader.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/lazyLoader.js)，净减 `40` 行。
  - `Newton`：继续压缩 [`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js) / [`js/app/fallbackMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/fallbackMixin.js)，在上一轮基础上再净减 `20` 行。

## New Wave 3 Outcome
- 主线策略：
  - 继续只做减法，不拆文件，直接处理 `main.js` 和 `examSessionMixin.js` 这两块高脂肪文件。
  - 先保住 userspace：`formatQuestionType` 虽然原实现只服务于已删死模板，但静态契约仍要求存在，所以改成最薄兼容壳而不是硬删。
- Subagent 结果：
  - `Lagrange`：压缩 [`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js)，净减 `16` 行。
  - `Beauvoir`：压缩 [`js/app/examSessionMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js)，删掉死模板和无用延迟弹窗，净减 `188` 行；随后主线补回 `formatQuestionType` 兼容壳 `+4` 行，最终净减 `184` 行。
- 当前累计结果：
  - `js/` 总量：`64519 -> 64091`，累计净减 `428` 行。
  - `js` 文件数：仍为 `90`，没有再制造碎文件。
  - 全局赋值：当前 `517`，比初始盘点 `564` 少 `47`。

## New Wave 4 Outcome
- 纠偏：
  - 恢复了 [`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js) 导入数据弹窗的原始视觉层，保留动效和玻璃态样式，不再把视觉表达误当垃圾代码删掉。
  - 将 checklist 相关静态测试改为“文件不存在则跳过”，使 [`developer/tests/ci/run_static_suite.py`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/ci/run_static_suite.py) 与仓库当前事实一致。
- 继续减法：
  - `Lorentz` 压缩了 [`js/components/practiceHistoryEnhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/components/practiceHistoryEnhancer.js)，净减 `31` 行，且未触碰弹窗视觉。
- 当前累计结果：
  - `js/` 总量：`64519 -> 64132`，累计净减 `387` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 515`，净减 `49`。
  - 静态套件：已整体通过，checklist 审计为 `skip`。

## New Wave 5 Outcome
- `Meitner` 压缩了 [`js/practice-page-enhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-enhancer.js)，只删逻辑层重复：
  - 合并重复脚本加载 fallback
  - 合并重复 fallback 存储实现
  - 删除重复的 debug 测试写读定时器
  - 合并初始化阶段重复的 `collectAllAnswers` 调度
- 本轮未触碰任何视觉层代码、样式、布局或动效。
- 当前累计结果：
  - `js/` 总量：`64519 -> 64108`，累计净减 `411` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 514`，净减 `50`。

## New Wave 6 Outcome
- 主线本地继续压缩 [`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js)：
  - 把一串重复的 `window.xxx = function(){...}` 浏览/资源桥接改成统一委托。
  - 保留外部全局接口名，不改 userspace，只删重复桥接垃圾。
  - 文件行数从 `3380` 压到 `3327`，净减 `53` 行。
- `gpt-5.3-codex` subagent `Gauss` 压缩了 [`js/app/suitePracticeMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/suitePracticeMixin.js)：
  - 13 处重复 `showMessage` 收口到 `_notifySuiteMessage(...)`
  - 多处 `sourceWindow/windowRef` 兜底链收口到 `_resolveSuiteWindow(...)`
  - 多处 `openExam` 选项对象重复收口到 `_buildSuiteOpenExamOptions(...)`
  - `aggregateAnswers/aggregateAnswerComparisons` 的重复循环收口到 `_aggregateSuiteFieldMap(...)`
  - 文件行数从 `2287` 压到 `2266`，净减 `21` 行。
- 本轮验证结果：
  - `node --check js/main.js js/app/suitePracticeMixin.js js/practice-page-enhancer.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过
- 当前累计结果：
  - `js/` 总量：`64519 -> 64037`，累计净减 `482` 行。
  - `js` 文件数：仍为 `90`，没有再制造碎文件。
  - 全局赋值：`564 -> 513`，净减 `51`。

## New Wave 7 Outcome
- `gpt-5.3-codex` subagent `Popper` 压缩了 [`js/utils/storage.js`](/Users/maziheng/Downloads/0.3.1%20working/js/utils/storage.js)：
  - 删除了被同名后置实现覆盖的死代码 `handleStorageQuotaExceeded`
  - 收口了 IndexedDB 初始化失败时重复的 fallback 分支
  - 收口了 `writePersistentValue/readPersistentValue/removePersistentValue` 的重复 webStorage/fallback 链
  - 收口了重复 `window.showMessage` 判断到 `showStorageMessage(...)`
  - 文件行数从 `2804` 压到 `2782`，净减 `22` 行
- 主线继续压缩数据层样板垃圾：
  - [`js/core/practiceRecorder.js`](/Users/maziheng/Downloads/0.3.1%20working/js/core/practiceRecorder.js)：
    - 收口 `PracticeCore.contracts/store` 取值
    - 收口重复的默认 `user_stats` 对象
    - 收口重复的 meta 写入链
    - 文件行数从 `2666` 压到 `2652`，净减 `14` 行
  - [`js/core/scoreStorage.js`](/Users/maziheng/Downloads/0.3.1%20working/js/core/scoreStorage.js)：
    - 收口重复的 `PracticeCore.contracts/store` 取值
    - 文件行数从 `1892` 变为 `1900`，净增 `8` 行，但减少了重复桥接垃圾
- 本轮最终净效果：
  - `js/` 总量：`64519 -> 63983`，累计净减 `536` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：仍为 `513`，较初始盘点净减 `51`。
- 本轮验证结果：
  - `node --check js/utils/storage.js js/core/practiceRecorder.js js/core/scoreStorage.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过

## New Wave 8 Outcome
- `gpt-5.3-codex` subagent `Halley` 压缩了 [`js/runtime/unifiedReadingPage.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/unifiedReadingPage.js)：
  - 合并 `review navigate` 的重复 payload 模板到 `buildReviewNavigatePayload(...)`
  - 合并 draft mirror 的 `sessionStorage get/set/remove` 链到 `withSimulationDraftStorage(...)`
  - 合并重复的 `JSON.stringify/JSON.parse` try/catch 到 `safeJsonStringify/safeJsonParse`
  - 合并重复 elapsed 计算到 `getElapsedSeconds()`
  - 文件行数从 `2467` 压到 `2457`，净减 `10` 行
- 主线压缩了 [`js/practice-page-ui.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-ui.js)：
  - 收口 marked questions 的 `sessionStorage` 读写
  - 收口 simulation mode 判断与 live-mode click 样板
  - 收口关闭窗口调用
  - 文件行数从 `1917` 压到 `1907`，净减 `10` 行
- 本轮过程说明：
  - 中途为了收口 `practice-page-ui.js` 的重复逻辑，helper 壳一度让文件短暂增肥。
  - 随后已继续压缩并重新跑回归，最终整轮仍是净减，不存在“左手删右手加后不认账”。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63963`，累计净减 `556` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/runtime/unifiedReadingPage.js js/practice-page-ui.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过

## New Wave 9 Outcome
- 新增 [`developer/tests/js/practicePageUi.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageUi.test.js)：
  - 用轻量 `vm` harness 直接守 `practice-page-ui` 的关键合同。
  - 覆盖 marked questions 恢复/规范化/持久化。
  - 覆盖 simulation mode 下 `submit/reset` 点击不应锁死页面。
  - 覆盖 `exit` 点击应调用 `window.close()`。
- [`developer/tests/ci/run_static_suite.py`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/ci/run_static_suite.py) 已接入新的 `练习页 UI 回归测试`，后续再砍阅读页交互链路时，静态套件会先报警。
- `gpt-5.3-codex` subagent `Confucius` 压缩了 [`js/app/examSessionMixin.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js)：
  - 收口重复的 practice record 保存/回读验证/fallback 存储链到统一 helper。
  - `createFallbackRecorder().handleRealPracticeData(...)` 不再重复一整段存储分支。
  - `saveRealPracticeData(...)` 不再重复维护 `PracticeCore/store/simpleStorageWrapper/storage` 三套写法。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63949`，累计净减 `570` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/app/examSessionMixin.js developer/tests/js/practicePageUi.test.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过

## New Wave 10 Outcome
- 新增 [`developer/tests/js/practicePageEnhancer.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageEnhancer.test.js)：
  - 用轻量 `vm` harness 守 `practice-page-enhancer` 的关键合同。
  - 覆盖 `collectAnswersNow/getCorrectAnswers` 的导出委托。
  - 覆盖 `sendMessage` 在 `readOnly` 下阻断 `PRACTICE_COMPLETE`。
  - 覆盖 replay 回放恢复 marked questions 的行为。
- [`developer/tests/ci/run_static_suite.py`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/ci/run_static_suite.py) 已接入新的 `练习页增强器回归测试`。
- `gpt-5.3-codex` subagent `Lovelace` 压缩了 [`js/practice-page-enhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-enhancer.js)：
  - 收口 replay/applyReview/init message 链里的重复 payload 与分支。
  - 收口 suite guard 里的 `close/open/history marker` 重复样板。
  - 收口重复的 `window.location` / `URLSearchParams` / `setTimeout(retry)` 样板。
  - `sendMessage` 改用统一 envelope，不改对外合同。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63915`，累计净减 `604` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/practice-page-enhancer.js developer/tests/js/practicePageEnhancer.test.js developer/tests/js/practicePageUi.test.js` 通过
  - `node developer/tests/js/practicePageEnhancer.test.js` 通过
  - `node developer/tests/js/practicePageUi.test.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过

## Structure Route
- 练习页运行时后续应继续按职责收口，而不是继续横向长胖：
  - [`js/runtime/unifiedReadingPage.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/unifiedReadingPage.js) 负责上下文、回放和提交协议。
  - [`js/practice-page-ui.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-ui.js) 负责 DOM 交互与只读态展示。
  - [`js/practice-page-enhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-enhancer.js) 负责答案采集、回放落地和父窗口通信。
- 启动链后续应继续减全局：
  - [`js/app/main-entry.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/main-entry.js) 保持唯一真实入口。
  - [`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js) 继续只保留兼容桥。
  - [`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js) 继续只保留真正兜底。

## New Wave 11 Outcome
- 新增 [`developer/tests/js/unifiedReadingPage.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/unifiedReadingPage.test.js)：
  - 用轻量 `vm` harness 守 unified 协议链关键合同。
  - 覆盖 `INIT_SESSION` simulation 模式下的按钮与 suite mode 同步。
  - 覆盖 `SIMULATION_CONTEXT` 对 runtime flags 和按钮文案的影响。
  - 覆盖 `SESSION_READY` envelope 与 `REVIEW_NAVIGATE` payload。
- [`developer/tests/ci/run_static_suite.py`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/ci/run_static_suite.py) 已接入新的 `统一阅读页协议回归测试`。
- `gpt-5.3-codex` subagent `Bacon` 压缩了 [`js/runtime/unifiedReadingPage.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/unifiedReadingPage.js)：
  - 收口 `INIT_SESSION / SIMULATION_CONTEXT / REVIEW_CONTEXT / REPLAY_PRACTICE_RECORD` 的重复状态写入。
  - 收口 `SESSION_READY / REQUEST_INIT` payload builder。
  - 收口 flow mode/query/simulation 序列解析。
  - 保留 `__UNIFIED_READING_SIMULATION_MODE__`、`updatePracticeSuiteModeUI`、marked questions 协议行为。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63897`，累计净减 `622` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/runtime/unifiedReadingPage.js developer/tests/js/unifiedReadingPage.test.js developer/tests/js/practicePageEnhancer.test.js developer/tests/js/practicePageUi.test.js` 通过
  - `node developer/tests/js/unifiedReadingPage.test.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过

## New Wave 12 Outcome
- 扩充 [`developer/tests/js/practicePageUi.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageUi.test.js)：
  - 继续保留 marked questions / simulation mode / exit close 守卫。
  - 新增 `suite mode UI` 保持隐藏合同。
  - 新增 `ENDLESS_COUNTDOWN -> ENDLESS_USER_EXIT` 退出链守卫。
- `gpt-5.3-codex` subagent `Kierkegaard` 压缩了 [`js/practice-page-ui.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-ui.js)：
  - 收口 exit 按钮显示/文案/handler 链到 `setExitButtonVisible / setExitButtonAction / restoreDefaultExitAction / notifyEndlessUserExit`。
  - 收口 marked questions 的 parse/normalize/set 链到 `parseSessionJson / applyMarkedQuestionValues`。
  - 收口 `resetPracticePage` 的多段输入重置样板和答案交互监听样板。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63896`，累计净减 `623` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/practice-page-ui.js developer/tests/js/practicePageUi.test.js developer/tests/js/unifiedReadingPage.test.js developer/tests/js/practicePageEnhancer.test.js` 通过
  - `node developer/tests/js/practicePageUi.test.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过

## New Wave 13 Outcome
- 主线压缩了 [`js/practice-page-enhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-enhancer.js)：
  - 删除 `applyReplayRecord()` 里与 `dispatchPracticeResultsEvent()` 重复的只读 replay fallback 调度。
  - 现在回放结果兜底表只保留单点调度，不再一份结果触发两次 `setTimeout`。
- 扩充 [`developer/tests/js/practicePageEnhancer.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageEnhancer.test.js)：
  - 新增“回放 fallback table 只调度一次”守卫。
  - 继续保留 replay marked questions / `sendMessage` 只读守卫 / 导出合同覆盖。
- `gpt-5.3-codex` subagent `Sartre` 压缩了 [`js/practice-page-ui.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-ui.js)：
  - 把 `renderResultsSummary()` 与 `handleResultsReady()` 之间重复的结果项解析收口到统一 helper。
  - 表格渲染、nav 状态更新、答案高亮现在复用同一份结果行数据，不再各算一遍。
- [`developer/tests/js/practicePageUi.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageUi.test.js) 同步补强：
  - 新增 `practiceResultsReady` 的 `pending` 合同。
  - 新增 `practiceResultsReady` 的 `final` 渲染与 nav/高亮映射合同。
  - 保留 marked questions / suite mode UI / endless exit 既有守卫。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63885`，累计净减 `634` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/practice-page-ui.js js/practice-page-enhancer.js` 通过
  - `node developer/tests/js/practicePageUi.test.js` 通过
  - `node developer/tests/js/practicePageEnhancer.test.js` 通过
  - `node developer/tests/js/unifiedReadingPage.test.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过（约 `14.75s`，`0 error`，`12 warnings`）

## New Wave 14 Outcome
- `gpt-5.3-codex` subagent `Curie` 压缩了 [`js/runtime/unifiedReadingPage.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/unifiedReadingPage.js)：
  - 收口 `applyReviewContext()`、`applyReplayRecord()`、`INIT_SESSION` 三处重复的 `reviewMode + readOnly` 协议样板到 `applyReviewMode(...)`。
  - 继续收口 `REVIEW_NAVIGATE` 组包样板。
  - 继续压掉 `buildInitSignature / buildReplaySignature / INIT_SESSION` 中重复的 `data &&` 噪音。
- 主线补强了 [`developer/tests/js/unifiedReadingPage.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/unifiedReadingPage.test.js)：
  - 新增 `INIT_SESSION(reviewMode=true, readOnly=false)` 可编辑合同。
  - 新增 `REVIEW_CONTEXT(viewMode=answering)` 退只读合同。
  - 继续保留 `INIT_SESSION/SIMULATION_CONTEXT/SESSION_READY/REVIEW_NAVIGATE` 既有协议守卫。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63879`，累计净减 `640` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/runtime/unifiedReadingPage.js` 通过
  - `node developer/tests/js/unifiedReadingPage.test.js` 通过
  - `node developer/tests/js/practicePageUi.test.js` 通过
  - `node developer/tests/js/practicePageEnhancer.test.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过（约 `14.22s`，`0 error`，`11 warnings`）

## New Wave 15 Outcome
- `gpt-5.3-codex` subagent `Beauvoir` 压缩了 [`js/practice-page-enhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-enhancer.js)：
  - 把 `startCorrectAnswerMonitoring()`、`startResultsMonitoring()`、`hasRenderableResults()`、`extractScore()` 周围重复的 `#results` 读取、可见性判断、表格/文本探测收口到 `readResultsState()`。
  - 把多处分数对象构造样板收口到 `buildScoreInfo()` / `buildPercentageScoreInfo()`。
  - 保持回放只读态、`PRACTICE_COMPLETE`、fallback table 与 score 提取行为不变。
- 扩充 [`developer/tests/js/practicePageEnhancer.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageEnhancer.test.js)：
  - 新增 `results monitoring` 合同守卫，覆盖结果表出现时触发 `extractFromResultsTable`。
  - 新增 `Final Score` 触发 `collectAllAnswers + handleSubmit` 合同守卫。
  - 新增监控重试参数兼容性守卫。
  - 新增 `extractScore` 对 `Accuracy: 85%` 的提取合同守卫。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63850`，累计净减 `669` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/practice-page-enhancer.js` 通过
  - `node developer/tests/js/practicePageEnhancer.test.js` 通过
  - `node developer/tests/js/practicePageUi.test.js` 通过
  - `node developer/tests/js/unifiedReadingPage.test.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过（约 `14.65s`，`0 error`，`12 warnings`）

## New Wave 16 Outcome
- `gpt-5.3-codex` subagent `Bernoulli` 继续压缩了 [`js/practice-page-enhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-enhancer.js)：
  - 收口 `generateSuiteAnswerComparison()` 与通用 comparison 生成间重复的键收集和 comparison 构造样板。
  - 收口 `calculateSuiteScore()` 到通用 score fallback 计算路径，同时保留 suite score 不携带 `source` 的旧合同。
  - 收口 `sendSuiteCompleteMessage()` 中去前缀 answers/correctAnswers 的重复遍历样板。
- 扩充 [`developer/tests/js/practicePageEnhancer.test.js`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/js/practicePageEnhancer.test.js)：
  - 新增 suite comparison 只包含当前套题键合同。
  - 新增 suite score 百分比与 `source` 兼容合同。
  - 新增 `comparison_fallback` 来源标签合同。
  - 新增 suite payload 的 `answers/correctAnswers/spellingErrors/scoreInfo` 合同。
- 当前累计结果：
  - `js/` 总量：`64519 -> 63830`，累计净减 `689` 行。
  - `js` 文件数：仍为 `90`。
  - 全局赋值：`564 -> 512`，净减 `52`。
- 本轮验证结果：
  - `node --check js/practice-page-enhancer.js` 通过
  - `node --check developer/tests/js/practicePageEnhancer.test.js` 通过
  - `node developer/tests/js/practicePageEnhancer.test.js` 通过
  - `node developer/tests/js/practicePageUi.test.js` 通过
  - `node developer/tests/js/unifiedReadingPage.test.js` 通过
  - `python3 developer/tests/ci/run_static_suite.py` 通过
  - `python3 developer/tests/e2e/suite_practice_flow.py` 通过（约 `14.23s`，`0 error`，`11 warnings`）

## Next Route
- 练习页运行时下一轮优先收口：
  - [`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js) 与 [`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js) 的剩余 bridge 垃圾。
  - 然后视总量回弹情况，再回头继续追回 [`js/practice-page-enhancer.js`](/Users/maziheng/Downloads/0.3.1%20working/js/practice-page-enhancer.js) 的测试成本。

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 代码库存在大量历史兼容、懒加载代理和 fallback，阅读链条噪音极高 | 用定量扫描先找热点，再围绕入口链、全局导出、测试依赖三条主线收敛 |
| 静态套件依赖仓库根目录 `checklist.md`，当前仓库缺失 | 记录为外部测试资产缺口，本轮不伪造文件掩盖问题 |

## Resources
- [`AGENTS.md`](/Users/maziheng/Downloads/0.3.1%20working/AGENTS.md)
- [`index.html`](/Users/maziheng/Downloads/0.3.1%20working/index.html)
- [`js/runtime/lazyLoader.js`](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/lazyLoader.js)
- [`js/app/main-entry.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app/main-entry.js)
- [`js/main.js`](/Users/maziheng/Downloads/0.3.1%20working/js/main.js)
- [`js/app.js`](/Users/maziheng/Downloads/0.3.1%20working/js/app.js)
- [`js/boot-fallbacks.js`](/Users/maziheng/Downloads/0.3.1%20working/js/boot-fallbacks.js)
- [`developer/tests/ci/run_static_suite.py`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/ci/run_static_suite.py)
- [`developer/tests/e2e/suite_practice_flow.py`](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/e2e/suite_practice_flow.py)

## Visual/Browser Findings
- 本轮未使用浏览器或图片工具；主要发现来自代码扫描与静态结构分析。

---
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
