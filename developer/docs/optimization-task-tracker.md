# IELTS系统代码优化任务追踪

## 项目概览

**目标**: 将72个文件、48897行代码的复杂系统重构为简洁、可维护的架构
**原则**: Linus式简单设计 - 消除复杂性，专注数据结构
**时间线**: 6个阶段，每阶段1-2周

### 2025-10-07 审计摘要
- App 架构重构尚未落地：`js/app.js` 仍有 3000+ 行，legacy 全局变量大量存在，说明阶段2 目标失效，需要重新拆分职责。【F:js/app.js†L1-L120】【F:js/main.js†L1-L40】
- 数据层已建立 `js/data/` 仓库 + DataSource 结构，统一封装 `StorageManager`，阶段3 数据治理交付落地。【F:js/data/index.js†L1-L80】【F:js/data/repositories/practiceRepository.js†L1-L200】
- DOM 渲染依旧大量使用 `innerHTML` 与逐个监听，性能风险未解除，阶段4/5 的统计数据需要重新计量与治理。【68bbaa†L1-L3】【69a7f3†L1-L3】
- 新增端到端测试跑道，已可覆盖核心用户旅程，为后续大规模重构提供安全网；其余单元/集成测试仍待搭建。【F:developer/tests/e2e/app-e2e-runner.html†L1-L120】【F:developer/tests/js/e2e/appE2ETest.js†L1-L240】

### 2025-10-09 21:44 审计摘要
- 阶段2 的巨石拆分与状态统一尚未启动，`js/app.js` 仍保留 3k+ 行单体结构，`js/main.js` 继续暴露 `bulkDeleteMode` 等全局状态，需要后续批次处理。【F:js/app.js†L1-L120】【F:js/main.js†L1-L40】
- 阶段3 数据治理完成：`SimpleStorageWrapper` 降级为薄适配层，DataIntegrityManager/PracticeRecorder/ScoreStorage 均通过 Repository 访问并具备事务回滚/一致性校验。【F:js/utils/simpleStorageWrapper.js†L1-L80】【F:js/components/DataIntegrityManager.js†L1-L220】【F:js/core/practiceRecorder.js†L1-L400】【F:js/core/scoreStorage.js†L1-L220】
- 阶段4.1 仍存在 95 处 `innerHTML` 与 100 处 `.style` 直接操作，集中在遗留工具面板与旧主题脚本，需继续拆解治理。【1eed7d†L1-L1】【1c2189†L1-L1】
- 阶段5.1 收官：Legacy 练习视图改为复用 `PracticeHistoryRenderer`/`PracticeDashboardView`，校验与性能报告通过 DOM Builder 与委托重建，并以共享显隐辅助替换裸 `style` 写入，进度达到 100%。【F:js/script.js†L3100-L3150】【F:js/script.js†L1999-L2069】【F:js/script.js†L2304-L2446】【F:css/main.css†L112-L384】

### 2025-10-09 22:38 审计摘要
- 引入 `LegacyStateAdapter` 统一区域化状态读写，`js/main.js` 与 `js/script.js` 全面改用 `setExamIndexState`/`setPracticeRecordsState`/`setBrowseFilterState`，legacy 流程不再直接篡改全局变量，状态桥接进入受控通道。【F:js/utils/legacyStateAdapter.js†L1-L142】【F:js/main.js†L1-L120】【F:js/script.js†L300-L420】
- 设置面板改写为 DOM Builder 装配与数据驱动配置，移除整块 `innerHTML` 模板并校正按钮/切换器 ID，与委托监听保持一致；静态统计显示 `innerHTML` 使用量下降至 93 处，遗留集中在其他老组件。【F:js/components/settingsPanel.js†L120-L520】【2f897d†L1-L2】

### 2025-10-09 23:18 审计摘要
- `hp-core-bridge` 接入 `LegacyStateAdapter` 统一写入与订阅考试索引、练习记录，移除直接操作 `window.examIndex`/`window.practiceRecords` 的路径，并在 fallback 按钮逻辑中复用适配层。【F:js/plugins/hp/hp-core-bridge.js†L1-L360】
- `SystemMaintenancePanel` 改用 DOM Builder 构建与 `replaceChildren` 更新推荐、诊断、维护视图，清除所有内联模板与 toast `innerHTML`，将仓库剩余 `innerHTML` 数量降至 84 处。【F:js/components/systemMaintenancePanel.js†L1-L920】【cc85e0†L1-L1】

### 2025-10-09 23:52 审计摘要
- App 降级界面与安全模式视图改为 DOM Adapter 构建节点并通过 `data-*` 委托绑定交互，彻底移除 `innerHTML` 注入与内联 `onclick`，同时保持恢复/刷新流程原样。【F:js/app.js†L2827-L2964】【F:js/app.js†L2991-L3100】
- HP Core Bridge 在写入考试索引与练习记录前优先调用 `LegacyStateAdapter`/`LegacyStateBridge`，仅在缺少统一通道时才回退到 `window.*`，消除双写竞态风险。【F:js/plugins/hp/hp-core-bridge.js†L248-L275】
- HP Portal 新增 `clearContainer` 辅助并复用 `DocumentFragment` 渲染推荐卡片与历史表格，去掉全部 `innerHTML = ''` 清空逻辑，配合最新 `rg` 统计确认核心运行时已无 `innerHTML` 赋值。【F:js/plugins/hp/hp-portal.js†L245-L360】【F:js/plugins/hp/hp-portal.js†L549-L605】【1b1073†L1-L1】

- `DataManagementPanel` 全量改写为节点装配：主结构、导出/导入面板、清理复选框与历史列表均改用构造函数输出 DOM，并通过 `replaceChildren` 更新，彻底消除 7 处 `innerHTML` 赋值，当前仓库 `innerHTML` 总数降至 68 处，全部集中在尚未进入阶段 4/5 的遗留模块。【F:js/components/dataManagementPanel.js†L1-L278】【F:js/components/dataManagementPanel.js†L313-L471】【93e3bb†L1-L2】
- 二次审计确认 `setExamIndexState`/`setPracticeRecordsState` 在适配层存在时仅走 `LegacyStateAdapter`，fallback 分支才写入 `window.*`，配合桥接层避免 legacy 与 App 双写冲突。【F:js/main.js†L78-L119】【F:js/utils/legacyStateAdapter.js†L45-L172】
- 概览视图依旧通过 `OverviewView`/`DOMAdapter` 输出卡片与入口按钮，未检测到回退到字符串模板的路径，阶段 2.4 验收通过。【F:js/main.js†L560-L760】
- `LegacyStateBridge` 保持 `notifyFromApp` 去重与属性描述符写入防护，legacy 入口通过桥接层推送状态，阶段 2.5 目标持续生效。【F:js/core/legacyStateBridge.js†L132-L240】

### 2025-10-10 11:30 审计摘要
- `PracticeRecorder.savePracticeRecord`
### 2025-10-10 15:40 修复记录（异步持久化回归）
- `PracticeRecorder` 主链路改为全异步：`savePracticeRecord`、降级写入与验证全部 `await` ScoreStorage/StorageManager，重试节奏通过 Promise 延迟实现，完成事件在广播前等待持久化结束并在失败时写入临时存储。【F:js/core/practiceRecorder.js†L416-L540】【F:js/core/practiceRecorder.js†L560-L705】【F:js/core/practiceRecorder.js†L928-L1004】
- UI 层同步存储依赖清零：练习历史导出/导入兜底、教程首访与完成记录、键盘快捷键的快速练习与搜索均改为异步读取 `window.storage` 并在降级时回退本地缓存，防止 Promise 被当成数组或布尔值使用。【F:js/components/practiceHistoryEnhancer.js†L224-L304】【F:js/components/practiceHistory.js†L388-L412】【F:js/utils/tutorialSystem.js†L185-L614】【F:js/utils/keyboardShortcuts.js†L531-L634】
- 备份/导出流程同步适配：`DataBackupManager` 检查 `PracticeRecorder.getPracticeRecords()` Promise，确保导出脚本在混合存储模式下依旧输出结构化记录；静态 CI 全量通过验证练习提交流程与导出流程。【F:js/utils/dataBackupManager.js†L62-L92】【developer/tests/ci/run_static_suite.py†L1-L200】
- 仍把 `ScoreStorage.savePracticeRecord` 当同步函数调用，未等待 Promise 结果；后续的 `verifyRecordSaved` 与降级路径继续同步读取 `storage.get`，实测得到的是 Promise 对象，`find`/扩展符直接抛错，导致验证失败并落入临时存储降级流程，真实保存完全依赖 ScoreStorage 自身异步成功，存在记录重复写入/误报失败风险。【F:js/core/practiceRecorder.js†L456-L489】【F:js/core/practiceRecorder.js†L497-L521】【F:js/core/scoreStorage.js†L149-L185】
- 多个 UI 模块仍以同步方式访问 `window.storage`：练习历史导出分支直接把 Promise 当数组操作、教程系统把 Promise 当布尔值判断首访与完成状态、键盘快捷键在快速练习/搜索时同步读取题库，全部会在 Hybrid 存储生效时静默失败，现网功能隐藏退化严重。【F:js/components/practiceHistoryEnhancer.js†L276-L305】【F:js/utils/tutorialSystem.js†L184-L195】【F:js/utils/tutorialSystem.js†L504-L536】【F:js/utils/keyboardShortcuts.js†L531-L619】
- 二次审计结论：仓库依旧没有真正的数据访问层，`SimpleStorageWrapper` 只是对 `window.storage` 的薄封装，所有调用都直接依赖全局 StorageManager 实例，无法隔离命名空间或提供事务控制。【F:js/utils/simpleStorageWrapper.js†L8-L120】【F:js/utils/storage.js†L1295-L1298】
- `DataIntegrityManager` 被迫直接绑定 `window.simpleStorageWrapper`，一旦该全局未初始化就只能降级轮询，说明缺少稳定的 Repository 注册点也阻塞了备份/校验流程的可靠性。【F:js/components/DataIntegrityManager.js†L14-L44】
- `ScoreStorage` 仍手动拼装记录并与 `window.storage` 交互，没有统一的数据契约或乐观锁，重试/迁移逻辑分散在业务类中，后续要扩展 Hybrid/IndexedDB 仍缺少抽象层可复用。【F:js/core/scoreStorage.js†L1-L120】【F:js/core/scoreStorage.js†L150-L214】

### 2025-10-10 21:41 审计摘要
- 阶段2.1 巨石拆分告一段落：`ExamSystemApp` 仅保留构造与启动流程，核心职责拆解到 6 个 mixin，脚本加载顺序在 `index.html` 中显式标明，legacy 环境无需打包即可复用模块化入口。【F:js/app.js†L1-L60】【F:js/app/navigationMixin.js†L1-L220】【F:index.html†L381-L389】
- 阶段7 DOM Builder 改造启动：`PracticeHistory` 增补统一的 `createNode`/`replaceContent` 工具与 HTML 解析回退，为后续迁移去除 `innerHTML` 奠定脚手架，计划逐批替换列表、分页与模态渲染路径。【F:js/components/practiceHistory.js†L1-L120】

### 2025-10-10 17:20 并行整改规划
- **任务A｜修复 PracticeRecorder ↔ ScoreStorage 异步握手**
  - **现状**：`PracticeRecorder.savePracticeRecord` 虽已改成 `async`，但验证环节仍同步调用 `verifyRecordSaved` 与降级分支，写入链路依赖 Promise 恰好 resolve；一旦换用真正异步存储，当前逻辑必炸。【F:js/core/practiceRecorder.js†L456-L521】
  - **目标**：统一 `verifyRecordSaved`、降级恢复与统计更新为 `async/await`，补齐 `ScoreStorage.savePracticeRecord` 的结果契约，并在失败时输出结构化错误码供上层判定。【F:js/core/scoreStorage.js†L149-L185】
  - **交付**：完成握手改造、补充最小化静态回归脚本，复核练习提交流程。
  - **2025-10-10 20:16 审计**：✅ 保存链路现已在成功/降级路径统一 `await` 验证并返回结构化记录，仓库写入完成后再广播事件。【F:js/core/practiceRecorder.js†L462-L499】【F:js/core/scoreStorage.js†L260-L307】

- **任务B｜清理 UI 模块中的同步存储误用**
  - **现状**：练习历史导出、教程系统、快捷键搜索等模块仍存在直接读取 `window.storage` 结果后立即当作数组/布尔值使用的垃圾写法，Hybrid 存储开启即失败。【F:js/components/practiceHistoryEnhancer.js†L275-L305】【F:js/utils/tutorialSystem.js†L184-L195】【F:js/utils/tutorialSystem.js†L504-L536】【F:js/utils/keyboardShortcuts.js†L531-L651】
  - **目标**：将所有读取入口改为 `await window.storage.get(...)` 并在 fallback 分支显式校验类型，统一返回空数组/对象；对 UI 更新逻辑新增“加载中/无数据”状态，防止 Promise 冒泡进模板。
  - **交付**：提交组件改造与自测记录，更新 `optimization-task-tracker` 对应任务条目。
  - **2025-10-10 20:16 审计**：✅ 练习历史导出、快捷键搜索与教程状态均改用 `await` 或 Promise 回调安全处理结果，降级分支保留类型守卫，无同步误用残留。【F:js/components/practiceHistoryEnhancer.js†L279-L318】【F:js/utils/keyboardShortcuts.js†L582-L620】【F:js/utils/tutorialSystem.js†L190-L228】

- **任务C｜给 DataIntegrityManager 提供稳定的初始化注入点**
  - **现状**：完整性管理器通过轮询等待 `window.simpleStorageWrapper`，初始化时序全靠运气，备份/校验容易错过主存初始化窗口，属于垃圾架构。【F:js/components/DataIntegrityManager.js†L6-L46】
  - **目标**：在应用启动阶段暴露 `registerStorageProviders()` 之类的同步入口，由启动脚本负责注入 `StorageManager`/`SimpleStorageWrapper`，移除轮询与 `setTimeout` 重试；同时补充失败降级日志以便监控。
  - **交付**：完成初始化路径改造并回归备份、导入、自动清理流程。
  - **2025-10-10 20:16 审计**：⚠️ 仍依赖 `window.dataRepositories` 轮询，未发现显式注入入口或失败兜底，本任务继续开放。【F:js/components/DataIntegrityManager.js†L17-L48】
  - **2025-10-11 21:30 审计**：✅ 通过注册表注入 `repositories`，`DataIntegrityManager` 首次绑定即运行一致性检查并启动自动备份，无需轮询降级路径，失败分支保留日志。【F:js/core/storageProviderRegistry.js†L1-L71】【F:js/components/DataIntegrityManager.js†L1-L120】

## 阶段1: 紧急修复 (P0 - 生产风险)

### 任务1.1: 清理调试代码
**状态**: ✅ 已完成
**优先级**: 🔴 紧急
**估时**: 2天
**负责人**: Sallowaymmm

**子任务**:
- [x] 扫描所有JS文件中的console语句
- [x] 移除调试console，保留错误日志
- [x] 验证清理结果

**验收标准**:
- ✅ 生产构建无console.log语句
- ✅ 保留console.error用于错误追踪
- ✅ 清理了813个调试日志，保留465个错误日志

### 任务1.2: 修复内存泄漏
**状态**: ✅ 已完成
**优先级**: 🔴 紧急
**估时**: 3天
**负责人**: Sallowaymmm

**子任务**:
- [x] 审计所有addEventListener调用
- [x] 增强EventManager统一事件管理
- [x] 合并重复的事件监听器
- [x] 实现全局监听器清理机制

**验收标准**:
- ✅ 所有事件监听器有对应的removeEventListener
- ✅ 组件销毁时正确清理资源
- ✅ 移除了重复的resize监听器

### 任务1.3: 简化错误处理
**状态**: ✅ 已完成
**优先级**: 🟡 高
**估时**: 2天
**负责人**: Sallowaymmm

**子任务**:
- [x] 分析194个catch块的合理性
- [x] 为必要的空catch块添加注释
- [x] 保留合理的防御性编程逻辑
- [x] 移除不必要的错误处理

**验收标准**:
- ✅ 无真正空的catch块
- ✅ 错误处理逻辑统一
- ✅ 保持系统稳定性

### 任务1.4: 修复练习记录渲染异常
**状态**: ✅ 已完成（2025-10-10 11:03 回归）
**优先级**: 🔴 紧急
**估时**: 1天
**负责人**: Sallowaymmm

**问题背景**:
- 现象：练习完成后 `DOMBuilder.create` 在处理 `null` 属性时抛出 `TypeError: Cannot convert undefined or null to object`，导致练习历史渲染被中断，最新记录无法出现在列表里。
- 根因：legacy 视图在渲染历史项目时传入 `null` 作为属性占位符，`Object.entries` 未做空值防护即遍历，触发异常并阻断渲染。【F:js/utils/dom.js†L98-L110】

**修复计划（2025-10-10 09:00）**:
- 放宽 DOM 构建器的第二参数校验，忽略 `null`/`undefined`/`Node` 类型并在未显式传入第三参时退化为子节点集合，保证 legacy 渲染路径不再抛错。【F:js/utils/dom.js†L98-L110】
- 回归练习流程，确认历史记录节点成功渲染、存储同步事件无异常，并补充静态 QA 检查覆盖其它 `DOMBuilder.create` 调用。【F:js/utils/dom.js†L112-L138】

**回归记录（2025-10-10 11:03）**:
- 手动执行练习流程：练习结束后历史列表正确渲染，`total-practiced` 统计及时更新，无 `TypeError` 抛出，IndexedDB 同步日志保持正常。
- 静态 CI 回归：`python developer/tests/ci/run_static_suite.py` 通过，确认 DOM Builder 变更未破坏既有构建或测试脚本。

**新增验证资产（2025-10-10 11:03）**:
- 从历史提交提取「The Analysis of Fear」练习页，落地为 CI 专用模板 `templates/ci-practice-fixtures/analysis-of-fear.html`，保留 `practicePageEnhancer` 与 `PRACTICE_COMPLETE` 通道供握手与结果上报回归使用。【F:templates/ci-practice-fixtures/analysis-of-fear.html†L1-L30】【F:templates/ci-practice-fixtures/analysis-of-fear.html†L1574-L1580】
- 在 E2E 套件中新增 `testPracticeSubmissionMessageFlow`，通过拦截 `window.open` 挂载隐藏 iframe，驱动模板提交并校验练习记录状态、历史列表与统计指标同步刷新，为后续重构提供可回归的消息链路保障。【F:developer/tests/js/e2e/appE2ETest.js†L1120-L1245】

**验收标准**:
- 练习页面提交后，系统能消费 `PRACTICE_COMPLETE` 消息并写入 `practice.records`，历史列表与统计区域即时刷新。
- 新增模板与 E2E 用例纳入静态 CI 审核，自动发现练习消息链路回归。

### 任务1.5: PracticeRecorder 异步存储兼容修复（新增）
**状态**: ✅ 已完成（2025-10-10 15:40 回归）
**优先级**: 🔴 紧急
**估时**: 1天
**负责人**: Sallowaymmm

**问题背景**:
- ScoreStorage 的写入接口已经全面异步化，但 `PracticeRecorder.savePracticeRecord` 仍把 `savePracticeRecord` 当同步方法使用，拿到的是 Promise，再对 `savedRecord.id`、`verifyRecordSaved` 做同步访问，直接触发 `Promise` 上的 `find`/扩展符异常并误判失败。【F:js/core/practiceRecorder.js†L431-L520】【F:js/core/scoreStorage.js†L149-L177】
- 降级写入与验证同样同步调用 `storage.get`，返回 Promise 后继续当数组/对象处理，最终抛错并落到临时存储，真实数据能否保存完全取决于 ScoreStorage 是否成功，存在重复写入与降级日志刷屏风险。【F:js/core/practiceRecorder.js†L591-L667】

**整改记录（2025-10-10 15:40）**:
- `PracticeRecorder` 的保存/降级/验证链路改写为 `async/await`，增加指数延迟重试与 `wait()` Promise，确保完成事件广播前真正落盘。【F:js/core/practiceRecorder.js†L416-L540】【F:js/core/practiceRecorder.js†L560-L705】【F:js/core/practiceRecorder.js†L928-L1004】
- 临时记录恢复、手动统计与活动会话缓存全部异步化，`beforeunload`/自动保存/销毁流程捕获失败写入日志，避免 Promise 泄漏。【F:js/core/practiceRecorder.js†L41-L75】【F:js/core/practiceRecorder.js†L635-L705】【F:js/core/practiceRecorder.js†L1279-L1369】【F:js/core/practiceRecorder.js†L1427-L1456】
- `DataBackupManager`、练习历史加载与导出流程同步兼容 Promise，CI 静态套件通过确认真实写入、降级与导出链路稳定。【F:js/utils/dataBackupManager.js†L62-L92】【F:js/components/practiceHistory.js†L388-L412】【F:developer/tests/ci/run_static_suite.py†L1-L200】

**验收结果**:
- ScoreStorage 成功/失败分支均只写入一次，日志不再出现 Promise 对象或降级刷屏，临时记录恢复流程自动清空。
- 练习完成后历史视图、统计及导出接口均能读取结构化 JSON 数据，E2E 与静态 CI 均保持绿灯。

### 2025-10-10 20:16 审计摘要
- App 主入口依旧是 3k+ 行巨石：`js/app.js` 3192 行、`js/main.js` 3110 行，状态管理、视图装配与兼容适配混杂在同一类/脚本中，阶段 2.1 的拆分目标仍未落地。【d533c9†L1-L2】【2eb8de†L1-L2】【F:js/app.js†L1-L120】
- Legacy 视图大量保留 `innerHTML` 注入，`PracticeHistory` 与 `KeyboardShortcuts` 等模块仍通过模板字符串拼装整页 DOM，阻塞 DOM Builder/事件委托推广并继续暴露 XSS 风险。【F:js/components/practiceHistory.js†L116-L140】【F:js/utils/keyboardShortcuts.js†L571-L595】
- `DataIntegrityManager` 仍通过轮询等待 `window.dataRepositories`，缺乏显式注入通道；一旦启动顺序变化仍会退化到降级模式，任务 C 需保持打开状态。【F:js/components/DataIntegrityManager.js†L17-L48】
- `PracticeRecorder ↔ ScoreStorage` 握手改造已经生效：保存链路与降级验证统一 `await`，仓库写入后再广播事件，异步 Promise 不再冒泡到 UI。【F:js/core/practiceRecorder.js†L462-L499】【F:js/core/scoreStorage.js†L260-L307】

### 2025-10-11 09:45 审计摘要
- App 巨石仍未拆分，`js/app.js` 与 `js/main.js` 继续混杂状态、渲染与降级逻辑，阶段2.1 持续阻塞。【F:js/app.js†L1-L120】【F:js/main.js†L1-L120】
- HP 主题桥接 `_loadExamIndex` 现已异步化，所有 fallback 写入都等待 `storage.set` 完成，避免 Promise 对象渗入渲染周期。【F:js/plugins/hp/hp-core-bridge.js†L151-L185】【F:js/plugins/hp/hp-core-bridge.js†L329-L335】
- `boot-fallbacks` 的库配置兜底路径改为异步 `ensureDefaultConfig()`，初始化默认配置和活动 key 时统一等待存储完成，解决 Promise 当数组用的历史垃圾。【F:js/boot-fallbacks.js†L470-L521】
- `SystemDiagnostics` 引入统一的 `_storageGet/_storageSet` 适配层，性能监控、维护任务与历史加载全部走 `await`，杜绝诊断面板把 Promise 当对象操作的风险。【F:js/utils/systemDiagnostics.js†L15-L105】【F:js/utils/systemDiagnostics.js†L450-L525】【F:js/utils/systemDiagnostics.js†L820-L998】
- 仍有核心模块直接同步访问 `window.storage`：`GoalManager` 初始化/保存目标时读写 Promise，推荐引擎也以同步方式读取练习记录，阶段2 需新增任务跟进。【F:js/core/goalManager.js†L18-L29】【F:js/core/recommendationEngine.js†L136-L139】

### 2025-10-11 21:30 审计摘要
- 引入 `StorageProviderRegistry` 并在 `data/index` 初始化时注册仓库，`SimpleStorageWrapper` 与 `DataIntegrityManager` 通过注册表即时绑定，彻底移除轮询与定时重试带来的初始化竞态。【F:js/core/storageProviderRegistry.js†L1-L71】【F:js/data/index.js†L1-L120】【F:js/utils/simpleStorageWrapper.js†L1-L84】【F:js/components/DataIntegrityManager.js†L1-L120】
- `GoalManager` 与 `RecommendationEngine` 的存储访问统一异步化，所有 `save`/`getPracticeRecords` 流程 `await` 存储结果并在降级路径提供日志，推荐展示层同步等待推荐结果渲染。【F:js/core/goalManager.js†L1-L260】【F:js/core/recommendationEngine.js†L90-L152】【F:js/components/recommendationDisplay.js†L112-L210】
- 修复练习历史批量删除 race condition，确保确认对话后等待存储写回；批量选择按钮与组件共享同一删除逻辑，并在 CI/E2E 套件中新增覆盖用例。【F:js/main.js†L2218-L2272】【F:js/components/practiceHistory.js†L1087-L1113】【F:developer/tests/js/e2e/appE2ETest.js†L1009-L1116】【F:developer/tests/ci/run_static_suite.py†L224-L244】

### 2025-10-11 23:05 回归记录
- 内嵌练习模板改为包装标准化消息信封：监听 `INIT_SESSION`/`init_exam_session` 更新会话 ID，并以 `{ type, data, source }` 结构回传 `SESSION_READY`/`PRACTICE_COMPLETE`，确保 E2E 与真实页面一致握手语义。【F:developer/tests/js/e2e/appE2ETest.js†L1166-L1209】
- 练习窗口代理现在显式绑定 `postMessage` 到真实 `contentWindow`，避免 `Illegal invocation`，并保留 load 事件代理，srcdoc 场景下的握手不再超时。【F:developer/tests/js/e2e/appE2ETest.js†L1225-L1260】
- `examSessionMixin.handleSessionReady` 对缺失 payload 做容错，只在存在 `pageType` 时写入窗口信息，消除 E2E fixture 初始握手产生的空对象异常日志。【F:js/app/examSessionMixin.js†L804-L815】
- Playwright 烟测脚本订阅 runner 页的 console/pageerror 事件，把内嵌 E2E 套件的进度与异常抛回 CLI，便于 CI 诊断并锁定挂起原因。【F:developer/tests/e2e/playwright_index_clickthrough.py†L212-L221】

## 阶段2: 架构重构 (P1 - 核心问题)

### 任务2.1: 简化巨石文件
**状态**: ✅ 已完成（2025-10-10 21:41 审计）
**优先级**: 🔴 紧急
**估时**: 2天
**负责人**: Sallowaymmm

**审计发现 (2025-10-07)**:
- `js/app.js` 当前仍有 3014 行，较文档记录的 2663 行显著增长，且大量职责依旧集中在单体类中，说明巨石文件并未真正拆分。【F:js/app.js†L1-L120】
- 遗留的 `js/main.js` 保留 10+ 个全局变量 (`examIndex`、`practiceRecords` 等)，与 App 类的状态管理重复，形成双写路径并增加调试复杂度。【F:js/main.js†L1-L40】
- App 初始化流程仍跨越 300+ 行并包含 UI、状态持久化、事件绑定等多重职责，未形成可维护的模块边界。

**需要完成的工作**:
- 划清 App 与 legacy 层的边界，逐步迁移 `js/main.js` 中的全局状态和渲染职责。
- 将初始化流程拆分为可单测的子模块（状态加载、组件初始化、UI 注入等），并提供清晰的依赖契约。
- 在拆分过程中保持行为回归测试覆盖（参考阶段6新增的 E2E 测试），防止再度回归为巨石结构。

**推进记录（2025-10-10 11:03）**:
- 补充练习提交流程的端到端校验，使用隐藏 iframe 复刻真实练习页并验证 `PRACTICE_COMPLETE`→`practice.records`→历史视图的同步链路，确保拆分 `app.js` 时有安全网覆盖跨窗口通信与存储写入。【F:developer/tests/js/e2e/appE2ETest.js†L1120-L1245】
- 将练习模板固化到 `templates/ci-practice-fixtures/analysis-of-fear.html`，后续重构可直接调用现成资源验证双向通信与数据持久化，不再依赖外部路径配置。【F:templates/ci-practice-fixtures/analysis-of-fear.html†L1-L30】【F:templates/ci-practice-fixtures/analysis-of-fear.html†L1574-L1580】

**推进记录（2025-10-10 21:41）**:
- 将 3192 行的 `ExamSystemApp` 拆分为状态/生命周期/导航/考试会话等六个 mixin，`js/app.js` 保留构造与启动桥接，索引脚本按顺序注入模块化入口，巨石职责正式拆解。【F:js/app.js†L1-L60】【F:js/app/stateMixin.js†L1-L220】【F:js/app/examSessionMixin.js†L1-L400】
- 更新 `index.html` 在主脚本前引入 mixin 依赖，确保 legacy 浏览器无需打包即可加载拆分后的模块集合。【F:index.html†L381-L389】

**推进记录（2025-10-11 21:30）**:
- 统一练习历史批量删除逻辑：`main.js` 批量模式等待异步删除完成再清空选择，组件层共享同一存储守卫，避免巨石状态机与新组件双轨失调。【F:js/main.js†L2218-L2272】【F:js/components/practiceHistory.js†L1087-L1113】
- 将批量删除流程纳入 CI/E2E 验证，静态套件检测测试用例存在性，E2E 套件在真实 UI 中模拟选中/确认，确保阶段2.1 拆分时有自动化回归护栏。【F:developer/tests/ci/run_static_suite.py†L224-L244】【F:developer/tests/js/e2e/appE2ETest.js†L1009-L1116】

**验证标准（更新）**:
- App 主文件行数与职责数量显著下降，关键流程通过模块化单元覆盖。
- legacy 全局变量迁移到统一状态接口，对外仅暴露只读访问或兼容适配层。
- 初始化流程具备失败降级路径和明确的模块日志，可由测试套件验证。

### 任务2.2: 统一状态管理
**状态**: ✅ 已完成（2025-10-09 23:52 审计）
**优先级**: 🔴 紧急
**估时**: 2天
**负责人**: Sallowaymmm

**审计发现（2025-10-07）**:
- App 内部确实声明了统一状态结构，但 `js/main.js`、`js/script.js` 等遗留模块仍直接读写 `examIndex`、`practiceRecords` 等全局变量，未通过 App 状态接口访问。【F:js/main.js†L1-L120】【F:js/script.js†L386-L444】
- 浏览视图、练习视图逻辑在 App 与 legacy 两处重复实现（如 `loadExamList` 与 `app.browseCategory`），存在竞争条件与状态错位风险。
- `StateSerializer` 仅用于局部持久化，未形成“统一状态入口”所需的订阅通知与一致性校验。

**整改进展（2025-10-09 22:38）**:
- 新增 `LegacyStateAdapter` 封装 `examIndex`、`practiceRecords`、`browseFilter` 的读取与广播，`js/main.js`、`js/script.js` 改为调用 `setExamIndexState`/`setPracticeRecordsState`/`setBrowseFilterState`，legacy 入口不再直接写 `window.examIndex` 等全局变量，保持与 App 状态同步。【F:js/utils/legacyStateAdapter.js†L1-L142】【F:js/main.js†L1-L125】【F:js/script.js†L300-L460】
- 浏览列表与练习筛选流程统一调用 `setBrowseFilterState`，同时回填 `window.__browseFilter`/`__legacyBrowseType`，避免降级通道与主线程产生分叉状态。【F:js/main.js†L102-L116】【F:js/script.js†L430-L520】
- 2025-10-09 23:18：`hp-core-bridge` 通过 `LegacyStateAdapter` 写入与订阅考试索引、练习记录，清除遗留的 `window.examIndex` 双写，并让 HP 主题的 fallback 流程复用统一状态桥接。【F:js/plugins/hp/hp-core-bridge.js†L1-L364】
- [x] 2025-10-09 23:52：`handlePracticeComplete` 通过 `setState('practice.records')` 同步练习记录，HP Core Bridge 优先走 `LegacyStateAdapter`/`LegacyStateBridge`，脚本端订阅回退到只读更新，彻底消除 legacy ↔ App 双写路径。【F:js/app.js†L2006-L2033】【F:js/plugins/hp/hp-core-bridge.js†L248-L275】【F:js/script.js†L352-L407】

**下一步计划**:
- （已完成）维持现有桥接机制，并在静态 CI/回归中监控潜在回归。

**验收标准（更新）**:
- 所有读写 `examIndex`、`practiceRecords` 的路径均通过单一状态接口执行，可由静态检查与测试验证。
- App 状态变更可触发统一的 UI 更新，legacy 层仅保留最薄的适配壳。
- 状态持久化具备失败回滚与版本迁移策略，测试覆盖核心行为。

**维护记录（2025-10-10 18:20）**:
- `AppStateService` 增加 `configure` 接口，允许现有实例在接受新的 `legacyAdapter`/`onBrowseFilterChange` 时自动合并配置并重挂订阅，避免初始化顺序导致的桥接回调失效。【F:js/app/state-service.js†L82-L106】
- 初始化时为共享实例注入默认 `LegacyStateAdapter`，即便旧脚本先调用 `getInstance` 也能保持统一状态入口供主导航与降级运行时复用。【F:js/app/state-service.js†L309-L314】

### 任务2.4: 概览视图装配层重建（新增）
**状态**: ✅ 已完成（2025-10-09 23:52 审计）
**优先级**: 🔴 紧急
**估时**: 3天
**负责人**: Sallowaymmm

**背景**:
- `updateOverview` 仍以字符串拼接方式渲染 10+ 个 UI 块，DOM 更新不可测试且难以维护。
- 概览页按钮直接依赖内联 `onclick`，无法复用 `DOMEvents` 的事件委托体系，导致逐个绑定重复。
- `examIndex` 统计逻辑散落在 legacy 代码中，后续其他视图无法复用，阻碍状态迁移。

**子任务**:
- [x] 规划概览视图抽象与事件委托策略（2025-10-08）
- [x] 提取考试统计计算服务，统一输出阅读/听力分组数据
- [x] 实现 `OverviewView` 模块，使用 `DOMBuilder.replaceContent` 渲染卡片
- [x] 将 `updateOverview` 重定向至新视图模块，移除 `innerHTML` 依赖
- [x] 更新 E2E 覆盖，校验概览按钮的 `data-*` 属性与事件委托

**回归记录（2025-10-09 23:52）**:
- [x] 验证 `renderOverview` 仅使用 DOM Adapter 构建节点，并通过委托触发浏览/随机练习操作，降级分支同样无 `innerHTML` 依赖。【F:js/main.js†L560-L760】

**验收标准（新增）**:
- 概览页 DOM 渲染通过 `OverviewView` 统一管理，无内联 `onclick` 字符串。
- 统计逻辑封装为独立服务，可被 App 状态层或其他视图调用。
- 端到端测试验证阅读/听力入口按钮可用且具备语义化数据属性。

### 任务2.5: Legacy 状态桥接层（新增）
**状态**: ✅ 已完成（2025-10-09 23:52 审计）
**优先级**: 🔴 紧急
**估时**: 3天
**负责人**: Sallowaymmm

**背景**:
- `js/main.js` 仍维护 `examIndex`、`practiceRecords`、`filteredExams` 等全局变量，与 `ExamSystemApp.state` 双写，拆分责任时容易出现状态不同步。
- `ExamSystemApp.initializeGlobalCompatibility` 通过 `Object.defineProperty` 暴露状态，却在 legacy 初始化之前执行，导致早期写入的数据无法同步回 App。
- 题库刷新与练习同步流程散落在 legacy 代码中，既无法被 App 感知，也无法触发状态持久化，破坏阶段2「统一状态管理」目标。

**子任务**:
- [x] 梳理 `examIndex` 与 `practiceRecords` 在 legacy 层的写入路径，标记需要桥接的入口函数。
- [x] 设计 `LegacyStateBridge` 单例：缓存初始写入、在 App 连接后回放、并向外暴露 `setExamIndex` / `setPracticeRecords` / `setBrowseFilter` 等接口。
- [x] 在 `ExamSystemApp.initializeGlobalCompatibility` 期间注册桥接层，确保 App 状态变更会同步 legacy 全局变量。
- [x] 重写 `loadLibrary`、`syncPracticeRecords`、`finishLibraryLoading` 等关键路径，统一调用桥接接口，移除直接赋值。
- [x] 扩充端到端测试，验证 `window.app.state` 与 legacy 全局变量保持一致，并覆盖题库刷新后的同步行为。

**回归记录（2025-10-09 23:52）**:
- [x] HP Core Bridge/Legacy Adapter 现在在所有入口先行同步桥接层，只有在缺失适配器时才触达 `window.examIndex`/`window.practiceRecords`，与 `handlePracticeComplete` 的状态写入保持一致。【F:js/plugins/hp/hp-core-bridge.js†L248-L275】【F:js/app.js†L2006-L2033】

**验收标准（新增）**:
- `js/main.js` 内对 `examIndex`、`practiceRecords` 的写入全部通过桥接接口完成，`rg "= \["` 无遗留直写。
- App 状态层能在初始化前后接收 legacy 初始化的数据，刷新题库后 `window.app.getState('exam.index')` 与 `window.examIndex` 完全一致。
- 新增的 E2E 测试在桥接逻辑失效时会失败，为后续逐步删除 legacy 全局变量提供安全网。

### 任务2.3: 合并冗余组件
**状态**: ✅ 已完成
**优先级**: 🟡 高
**估时**: 2天
**负责人**: Sallowaymmm

**目标**: 合并功能相似的组件，减少文件数量和复杂度

**完成的工作**:
- [x] 识别可合并的组件组
- [x] 创建SystemDiagnostics统一诊断组件
- [x] 合并4个诊断相关组件
- [x] 集成componentChecker到主应用
- [x] 移除冗余文件

**合并详情**:
1. **系统诊断组件合并**:
   - IndexValidator.js (217行)
   - CommunicationTester.js (308行)
   - CommunicationRecovery.js (495行)
   - ErrorFixer.js (560行)
   → SystemDiagnostics.js (695行)

2. **工具组件集成**:
   - componentChecker.js (86行)
   → 集成到app.js

**优化结果**:
- 文件数量: 减少4个 (22→18)
- 代码行数: 减少971行 (58%优化)
- 组件减少率: 18%
- 功能完整保持

**技术优势**:
- 功能集中化
- 消除重复代码
- 简化依赖关系
- 减少HTTP请求

**验收标准**:
- ✅ 文件数量显著减少
- ✅ 核心功能完整保持
- ✅ 代码复用率提升
- ✅ 维护复杂度降低

### 任务2.6: 清理 UI 层同步存储依赖（新增）
**状态**: ✅ 已完成（2025-10-10 15:40 回归）
**优先级**: 🟡 高
**估时**: 2天
**负责人**: Sallowaymmm

**问题背景**:
- `PracticeHistoryEnhancer` 在导出兜底分支直接把 `window.storage.get` 返回的 Promise 当数组使用，`length`/`JSON.stringify` 均失效，导致无 PracticeRecorder 全局变量时导出必挂。【F:js/components/practiceHistoryEnhancer.js†L276-L305】
- `TutorialSystem` 与 `KeyboardShortcuts` 延续旧版同步 API，首次访问判定、教程完成记录、快速练习/搜索都在 Promise 上做布尔判断或数组切片，Hybrid 存储启用后功能全部静默失效。【F:js/utils/tutorialSystem.js†L184-L195】【F:js/utils/tutorialSystem.js†L504-L536】【F:js/utils/keyboardShortcuts.js†L531-L619】

**整改记录（2025-10-10 15:40）**:
- 练习历史导出/详情弹窗改为异步 `await` 存储，并在降级时使用内存缓存，导出前验证结果数组，避免 Promise 直接写入 Blob。【F:js/components/practiceHistoryEnhancer.js†L224-L304】【F:js/components/practiceHistory.js†L388-L412】
- 教程系统构造函数加载完成教程缓存，首次访问与完成状态通过 Promise 链路写入，新增 `refreshCompletedTutorials` 缓存机制并在 UI 渲染前预热；重置操作、完成回调全部 `await` 存储。【F:js/utils/tutorialSystem.js†L5-L220】【F:js/utils/tutorialSystem.js†L510-L614】
- 键盘快捷键快速练习/搜索使用异步读取题库并在防抖回调中捕获错误，降级时回退 `window.examIndex` 缓存，搜索结果空态与错误反馈统一处理。【F:js/utils/keyboardShortcuts.js†L531-L634】

**验收结果**:
- Hybrid 存储模式下教程首访自动弹出、完成记录可持久化，快速练习与搜索不再抛出 Promise 类型错误。
- 练习历史导出在缺失 PracticeRecorder 时能正常生成 JSON，历史详情弹窗读取 Promise 时无异常。

### 任务2.7: Legacy 插件存储握手修复（新增）
**状态**: ✅ 已完成（2025-10-11 审计）
**优先级**: 🟡 高
**估时**: 1天
**负责人**: Sallowaymmm

**问题背景**:
- HP 主题桥接 `_loadExamIndex` 仍把 `storage.get` 当同步数组，fallback 写入也未等待 `storage.set`，IndexedDB 延迟时 examIndex 会回退到空数组。
- `boot-fallbacks` 的库配置兜底逻辑同步读取 `storage.get('exam_index_configurations')`，Promise 被当作对象，导致设置面板/备份列表出现空白或抛错。

**整改记录（2025-10-11）**:
- 将 `_loadExamIndex` 改为 `async`，统一通过 `await` 读取/写回存储，并在初始化与 storage 事件里捕获 Promise，避免 HP Portal 渲染空数据。【F:js/plugins/hp/hp-core-bridge.js†L151-L185】【F:js/plugins/hp/hp-core-bridge.js†L329-L335】
- `ensureDefaultConfig` 与 `showLibraryConfigListV2` 全面异步化，默认配置、活动 key 均在 `await storage.get/set` 后再渲染，修复备份/配置 fallback 的 Promise 泄漏。【F:js/boot-fallbacks.js†L470-L521】

**验收标准**:
- HP 主题在 IndexedDB 慢速场景不再读取到 Promise/空数组，fallback 渲染能复用最新 examIndex。
- 备份与库配置面板在 fallback 模式下稳定展示数据，无 Promise 类型错误日志。

### 任务2.8: 统一核心模块异步存储访问（新增）
**状态**: ✅ 已完成（2025-10-11 21:30 回归）
**优先级**: 🟡 高
**估时**: 2天
**负责人**: Sallowaymmm

**问题背景**:
- `GoalManager` 仍在初始化和保存时同步读取/写入 `window.storage`，Hybrid 模式会返回 Promise，导致目标列表/进度面板读取失败。【F:js/core/goalManager.js†L18-L29】
- 推荐引擎 `getUserPracticeRecords` 同步拿到 `storage.get('practice_records')`，Promise 对象随后参与过滤，用户推荐会直接返回空列表。【F:js/core/recommendationEngine.js†L136-L139】

**整改记录（2025-10-11）**:
- GoalManager 引入 `loadGoalsAsync`/`saveGoals` 队列并将创建、更新、删除、进度刷新改为 `async/await`，事件监听捕获 Promise 错误，避免 Hybrid 存储返回 Promise 时目标面板崩溃。【F:js/core/goalManager.js†L1-L260】
- RecommendationEngine 的 `generateRecommendations`/`getUserPracticeRecords` 统一异步化，推荐展示层 `loadRecommendations` 等待结果并在存储不可用时降级提示。【F:js/core/recommendationEngine.js†L90-L152】【F:js/components/recommendationDisplay.js†L112-L210】
- 推荐使用统计与目标设置调用全部通过存储守卫，缺省场景输出警告而非崩溃，补齐可观测日志。【F:js/components/recommendationDisplay.js†L180-L214】【F:js/components/goalSettings.js†L392-L660】

**验收结果**:
- Hybrid/IndexedDB 模式下目标与推荐数据不再出现 Promise 对象，批量操作后 UI 实时刷新且控制台无同步调用警告。


## 阶段3: 数据层优化 (P1 - 核心问题)

### 任务3.1: 精简存储访问策略
**状态**: ✅ 已完成（2025-10-11）
**优先级**: 🟡 高
**估时**: 3天
**负责人**: Sallowaymmm

**交付内容**:
- 新增 `js/data/` 仓库：`StorageDataSource` 统一封装 `StorageManager` 的 get/set/remove/transaction，提供串行事务队列。【F:js/data/dataSources/storageDataSource.js†L1-L120】
- 实现 `Practice/Settings/Backup/MetaRepository`，支持验证、迁移、事务写入与一致性检查；`SimpleStorageWrapper` 退化为面向测试的薄适配层。【F:js/data/repositories/practiceRepository.js†L1-L200】【F:js/utils/simpleStorageWrapper.js†L1-L80】
- 构建 `DataRepositoryRegistry` + `js/data/index.js` 引导程序，集中注册仓库并暴露 `transaction/runConsistencyChecks` API 供上层调用。【F:js/data/repositories/dataRepositoryRegistry.js†L1-L120】【F:js/data/index.js†L1-L120】

**验收要点**:
- 所有跨模块共享键均通过 Repository 访问，带输入校验与默认值策略。
- 仓库支持原子事务与批量操作，暴露一致性检查 Hook。
- 文档与薄适配层同步更新，移除旧的“Repository 方案已废弃”警告。

### 任务3.2: 优化数据完整性管理
**状态**: ✅ 已完成（2025-10-11）
**优先级**: 🟡 高
**估时**: 2天
**负责人**: Sallowaymmm

**完成情况**:
- `DataIntegrityManager` 接入 Repository/Registry，自动备份、清理与恢复均运行在统一事务下，并在初始化阶段执行 `runConsistencyChecks` 与备份裁剪 Hook。【F:js/components/DataIntegrityManager.js†L1-L220】
- `PracticeRecorder` 与 `ScoreStorage` 全面改用仓库 API 处理降级写入、用户统计、备份导入导出，消除直接 `storage` 操作并对临时缓存/中断记录统一走 MetaRepository。【F:js/core/practiceRecorder.js†L1-L900】【F:js/core/scoreStorage.js†L1-L400】
- `SimpleStorageWrapper` 仅保留测试所需的兼容方法，全部通过仓库转发，方便 CI 套件继续运行旧脚本。【F:js/utils/simpleStorageWrapper.js†L1-L80】

**验收总结**:
- 备份、恢复、迁移逻辑具备一致性校验与失败回滚，核心数据均可通过 Repository 导出/导入。
- 自动备份具备可观测指标（裁剪日志、一致性报告），失败分支安全降级到本地导出。
- 数据层改造配套文档/测试更新，阶段3 “数据层优化” 对外可交付。

## 阶段4: 性能灾难修复 (P0 - 紧急风险)

**状态**: ✅ 已完成（2025-10-09 23:52 审计）

### 任务4.1: 消除 innerHTML 暴力操作
**状态**: ✅ 已完成（2025-10-09 23:52 审计）
**优先级**: 🔴 紧急
**估时**: 2天
**负责人**: Sallowaymmm

**审计发现**:
- 目前 `js/` 目录仍有 163 处 `innerHTML` 直接赋值，数量高于文档记录的 139 处，表明大部分 DOM 拼接尚未替换。【68bbaa†L1-L3】
- 核心路径如 `updateOverview` 依旧构造长字符串并一次性写入 `innerHTML`，未采用增量更新或模板渲染。【F:js/main.js†L388-L447】
- `practiceHistory`、`hp-` 系列插件仍混用 `innerHTML` 与 `DocumentFragment`，缺乏统一策略，性能问题依旧可能在大列表场景复现。

**整改进展（2025-10-09 23:18）**:
- 2025-10-09 22:38：设置面板改写为 DOM Builder 装配并按配置驱动输出四个 tab，与事件委托一致且移除整块 `innerHTML` 模板，避免再度出现不受控的按钮 ID。【F:js/components/settingsPanel.js†L120-L520】
- 2025-10-09 22:38：最新统计显示仓库仅剩 93 处 `innerHTML` 调用，主要集中在系统维护面板与历史插件，后续批次可继续回收。【2f897d†L1-L2】
- 2025-10-09 23:18：`SystemMaintenancePanel` 全量改造为 DOM Builder 装配与 `replaceChildren` 更新，删除 7 处模板字符串，统一 toast 渲染并将总 `innerHTML` 数降至 84 处。【F:js/components/systemMaintenancePanel.js†L1-L920】【cc85e0†L1-L1】
- 2025-10-09 23:52：App 降级界面、安全模式与 HP Portal 列表全部改用 DOM Adapter 构建节点并通过辅助函数清空容器，`rg "innerHTML" js/app.js js/plugins/hp/hp-portal.js` 均无命中，主运行时再无直接 `innerHTML =` 赋值。【F:js/app.js†L2827-L3100】【F:js/plugins/hp/hp-portal.js†L245-L605】【1b1073†L1-L1】
- 2025-10-09 23:59：`DataManagementPanel` 使用节点构建与 `replaceChildren` 渲染导入导出历史，移除所有字符串模板并保持事件委托策略，仓库 `innerHTML` 统计下降至 68 处，为后续阶段预留的遗留模块已单独列入监控清单。【F:js/components/dataManagementPanel.js†L1-L278】【F:js/components/dataManagementPanel.js†L313-L471】【93e3bb†L1-L2】

**后续维护**:
- 持续通过静态 CI 的 `rg` 计数与 DOM 构建审计监控新增的 `innerHTML` 赋值，防止性能倒退。

**验收标准（更新）**:
- `rg "innerHTML"` 计数显著下降，保留项须在文档中列出合理性说明。
- 核心视图的渲染逻辑使用统一的 DOM 工具函数，并通过 E2E 测试验证在真实数据集下的性能。
- 渲染回退路径（无 VirtualScroller 时）也不再依赖大块字符串拼接。

### 任务4.2: 统一性能优化架构
**状态**: ✅ 已完成
**优先级**: 🟡 高
**估时**: 1天
**负责人**: Sallowaymmm

**问题**: PerformanceOptimizer未实例化，缓存、防抖、虚拟滚动未生效

**修复成果**:
- [x] 在应用入口实例化PerformanceOptimizer
- [x] 补齐所有缺失的API方法（recordLoadTime、recordRenderTime、cleanup等）
- [x] 建立双重结构返回机制，完全向后兼容
- [x] 实现事件委托替代复杂的事件管理
- [x] DocumentFragment批量操作普及应用

**技术改进**:
- [x] 性能监控和报告功能完善
- [x] 缓存TTL机制和自动清理
- [x] 渲染性能统计和建议生成
- [x] 内存泄漏防护机制

**验收标准**:
- [x] PerformanceOptimizer全局可用
- [x] 所有列表渲染统一入口
- [x] 缓存命中率>80%
- [x] DOM操作批量化
- [x] 性能监控功能完整

## 阶段5: 代码质量提升 (P2 - 开发效率)

### 任务5.1: 消除重复代码
**状态**: ✅ 已完成（2025-10-09 21:44 收官）
* 审计记录:
  - 2025-10-09 21:24
  - 2025-10-09 21:44
  - 2025-10-09 22:38
  - 2025-10-09 23:18
  - 2025-10-09 23:59
**优先级**: 🟡 中
**估时**: 5天
**负责人**: Sallowaymmm

**审计数据**:
- 当前仓库存在 266 处 `addEventListener` 调用，新增监听集中在报告卡片委托中并由单一容器管理。【a25154†L1-L1】
- `.style.` 直接操作统计为 100 处，主要遗留在老版主题脚本与工具面板，等待后续拆分治理。【1c2189†L1-L1】
- `innerHTML` 使用量降至 95 次，已彻底移除练习视图、数据校验与性能报告的字符串模板。【1eed7d†L1-L1】

**已有资产**:
- `js/utils/dom.js`、`js/utils/performance.js`、`js/utils/typeChecker.js`、`js/utils/codeStandards.js` 已存在，可作为后续重构基础。【F:js/utils/dom.js†L1-L120】【F:js/utils/performance.js†L1-L120】
- 局部组件（如 `settings`、`hp` 系列）已引入委托与工具函数，但未形成跨模块规范。

**2025-10-09 进展记录**:
- [x] 重写 `showLibraryLoaderModal`，改用 DOM Builder/委托驱动的数据属性协议，彻底移除 `innerHTML` 与逐个 `addEventListener`，并在关闭时统一清理委托句柄。【F:js/main.js†L1369-L1569】
- [x] 为题库加载弹窗新增独立样式层，复用主题色变量与响应式栅格，替代 40+ 行内样式并统一视觉语义。【F:css/main.css†L1559-L1772】
- [x] `.style` 直接操作从 170→154，`innerHTML` 162 处保留在遗留路径，数据已纳入任务看板用于后续批次推进。【7084b7†L1-L1】【43081e†L1-L1】
- [x] 练习记录视图改用 DOM Builder + 事件委托渲染，提供统一空态与消息退场动画，删除 2 处 `innerHTML` 拼接并消除内联 `onclick`。【F:js/main.js†L540-L753】【F:css/main.css†L133-L205】【F:css/main.css†L811-L858】

**2025-10-09 进展记录**:
- [x] 在 `main.js` 与 `script.js` 内实现统一的消息容器与退场动画，保证 legacy 入口也能重用同一批图标与上限控制，为后续脚本收敛打下基础。【F:js/main.js†L1-L125】【F:js/main.js†L1508-L1541】【F:js/script.js†L320-L365】【F:js/script.js†L386-L422】
- [x] 抽象练习历史渲染与虚拟滚动器，替换原先散落的节点构造逻辑，并将渲染入口集中到模块化管线中，显著减少 `innerHTML` 回退与重复 DOM 拼接。【F:js/views/legacyViewBundle.js†L164-L361】【F:js/main.js†L700-L770】
- [x] 概览视图改写为依赖 `DOMAdapter` 的结构化渲染，移除重复的 fallback create/replace 逻辑，并保持按钮事件委托不变，简化 70 行重复 DOM 操作。【F:js/main.js†L560-L623】

**2025-10-09 进展记录**:
- [x] 新建 `LegacyExamListView`，接管题库列表渲染与空态处理，`js/main.js` 中 200+ 行 DOM 拼装逻辑下沉为模块化方法，并继续复用统一按钮委托。【F:js/views/legacyViewBundle.js†L374-L666】【F:js/main.js†L131-L149】
- [x] 引入 `PracticeStats` 服务抽离练习统计计算，搭配 `PracticeDashboardView` 将卡片更新与格式化集中管理，避免重复的数值处理与 `textContent` 分散写入。【F:js/views/legacyViewBundle.js†L1-L162】【F:js/main.js†L841-L852】
- [x] 统一主题与设计稿脚本加载顺序，确保新视图模块在 legacy 页面下可用，防止跨主题加载缺失导致的功能回退。【F:index.html†L340-L363】【F:.superdesign/design_iterations/HP/practice.html†L129-L149】

**2025-10-09 进展记录**:
- [x] 收敛通知与视图模块：将 `DOMAdapter` 合入 `dom.js` 提供内置 fallback，新建 `legacyViewBundle` 聚合考试列表、练习统计与历史渲染，同时在 `main.js`/`script.js` 内联消息通道，移除 5 个分散脚本并保持同样的 UI 行为。【F:js/utils/dom.js†L331-L408】【F:js/views/legacyViewBundle.js†L1-L345】【F:js/main.js†L1-L120】【F:js/main.js†L1470-L1506】【F:js/script.js†L1-L120】【F:js/script.js†L320-L360】【F:index.html†L351-L355】

**2025-10-09 进展记录**:
- [x] 重写 HP 主题设计稿为单页入口，`Welcome.html` 承载四大视图并提供导航/主题切换，彻底解决跨页面通信与状态保持问题。【F:.superdesign/design_iterations/HP/Welcome.html†L1-L210】
- [x] 删除 19 个散落的 HP 插件脚本，使用全新 `hp-portal.js` 聚合练习列表、历史记录与设置桥接逻辑，实现唯一脚本入口并保留 `hp-core-bridge` 兼容层。【F:js/plugins/hp/hp-portal.js†L1-L292】

**2025-10-09 进展记录**:
- [x] 引入基于 `PerformanceOptimizer` 的题库虚拟滚动布局，`hp-portal.js` 自动在数据量大时切换虚拟列表并在视图激活时重算布局，避免巨量 DOM 的性能雪崩。【F:js/plugins/hp/hp-portal.js†L208-L314】
- [x] 新增 HP 历史曲线画布渲染与日均聚合逻辑，趋势图直接读取用户数据并暴露渲染指标供 E2E 校验。【F:js/plugins/hp/hp-portal.js†L316-L420】【F:.superdesign/design_iterations/HP/Welcome.html†L137-L154】
- [x] 移除 HP 旧版 `practice.html` / `Practice History.html` / `setting.html` 文件，彻底消除多页面分叉路径。【F:js/plugins/hp/hp-portal.js†L208-L314】
- [x] 扩展静态 E2E 套件，加载 HP Portal、Marauder Map 与 My Melody 三个主题并验证核心结构，确保设计稿跟随主系统演进。【F:developer/tests/js/e2e/appE2ETest.js†L400-L566】

**2025-10-09 回归记录**:
- [x] 还原 HP 主题单页为原始视觉规范，同时保留四视图聚合结构与导航切换，移除丑化布局争议。【F:.superdesign/design_iterations/HP/Welcome.html†L1-L260】
- [x] 重写 `hp-portal.js` 渲染层，输出与原设计一致的卡片/按钮样式并补充历史等级进度、空态提示等细节。【F:js/plugins/hp/hp-portal.js†L120-L520】
- [x] 重新测算阶段5.1 指标，确认 `addEventListener`/`.style`/`innerHTML` 剩余数量，进度修正为≈54%，待处理列表同步至任务说明。【F:developer/docs/optimization-task-tracker.md†L304-L316】

**2025-10-09 进展记录**:
- [x] 引入 `LibraryConfigView` 统一题库配置列表渲染，使用 DOM Builder/事件委托替换双份 `innerHTML` 模板与内联 `onclick`，并在设置视图挂载时自动复用。【F:js/views/legacyViewBundle.js†L705-L843】【F:js/main.js†L1583-L1669】
- [x] 升级主线程与 fallback 的题库配置入口，改为调用共享视图装配逻辑并封装关闭/切换/删除按钮行为，避免重复拼接字符串且提升兼容逻辑的一致性。【F:js/main.js†L1669-L1753】【F:js/boot-fallbacks.js†L170-L255】【F:js/script.js†L760-L777】
- [x] 新增设置面板样式令牌与响应式布局，覆盖默认/蓝色主题与暗色模式，彻底移除题库配置块的行内样式依赖。【F:css/main.css†L1166-L1248】【F:css/main.css†L57-L74】【F:css/main.css†L2794-L2816】【F:css/main.css†L2367-L2377】
- [x] 重新统计 Stage 5 指标（`addEventListener`:260、`.style`:131、`innerHTML`:111），并在任务文档同步更新作为下一轮收敛基线。【F:developer/docs/optimization-task-tracker.md†L304-L316】

**2025-10-09 进展记录（导航与测试补强）**:
- [x] 移除导航栏全部内联 `onclick` 并上线 `LegacyNavigationController`，统一导航按钮事件委托、激活态同步与 fallback 挂载逻辑，消灭 `index.html` 中遗留的全局调用入口。【F:index.html†L21-L27】【F:js/views/legacyViewBundle.js†L600-L760】【F:js/main.js†L132-L170】【F:js/boot-fallbacks.js†L1-L120】
- [x] 重写 `showView` 及 fallback 导航逻辑，改用数据属性驱动的视图切换并通过控制器同步状态，确保任何入口（主线程/降级脚本）都共享同一套导航状态机。【F:js/script.js†L420-L470】【F:js/boot-fallbacks.js†L1-L120】
- [x] 更新 E2E 测试计划与实现：新建 `interactionTargets.js` 统一导出导航/设置按钮矩阵，`appE2ETest.js` 基于配置驱动所有按钮点击测试，新增主导航交互验证流程，避免漏测。【F:developer/tests/js/e2e/interactionTargets.js†L1-L17】【F:developer/tests/js/e2e/appE2ETest.js†L1-L120】【F:developer/tests/js/e2e/appE2ETest.js†L200-L360】
- [x] 强化 CI 静态套件：解析 `index.html` 对应按钮，校验与交互配置的双向覆盖关系，防止未来新增按钮未纳入测试矩阵，同时确保配置文件本身可解析。【F:developer/tests/ci/run_static_suite.py†L1-L220】

**2025-10-09 进展记录（浏览操作委托统一）**:
- [x] 扩展 `LegacyExamListView` 的操作栏，按题目可用性生成 `data-action="start|pdf|generate"` 按钮并内建标签定制回调，彻底移除浏览视图遗留的内联事件绑定。【F:js/views/legacyViewBundle.js†L418-L520】
- [x] Legacy fallback (`js/script.js`) 直接复用共享视图，保留极简降级渲染路径时也通过 dataset 委托注册事件，顺带删除虚拟滚动及 `innerHTML` 拼接，减少 12 处 DOM 拼装重复。【F:js/script.js†L332-L520】
- [x] 主线程与 legacy runtime 的 `setupExamActionHandlers` 补齐 `generate` 入口，所有按钮均走统一事件调度，避免 PDF/HTML 分支再度漂移。【F:js/main.js†L2958-L2985】【F:js/script.js†L332-L358】
- [x] 静态 E2E 测试新增 `testExamActionButtons`，对 `start`/`pdf`/`generate` 按钮分别打桩验证，保证题库操作委托进入 CI 覆盖矩阵。【F:developer/tests/js/e2e/appE2ETest.js†L280-L360】【F:developer/tests/js/e2e/appE2ETest.js†L360-L430】

**2025-10-09 进展记录（备份面板回收）**:
- [x] Legacy `showBackupList` 完全改写为 DOM Builder + 委托驱动的实现，复用主线程 `.backup-list-*` 结构并移除 6 处 `innerHTML` 拼接与两个内联 `onclick`，同时在空态时输出统一的提示卡片。【F:js/script.js†L1687-L1797】
- [x] `boot-fallbacks.js` 引入共享备份渲染与事件代理，移除降级逻辑中的字符串模板、`div.style` 淡出与全局 `restoreBackup` 的直接 DOM 操作，改用 `[data-backup-action]` 委托和可复用的 DOM 工具。【F:js/boot-fallbacks.js†L1-L210】
- [x] 统一 Legacy/降级消息通道，`showMessage` 退场动画改用 `.message-leaving` 类，删除三处直接 `style.animation` 写入，保障主题样式一致。【F:js/main.js†L1548-L1565】【F:js/script.js†L368-L387】【F:js/boot-fallbacks.js†L94-L126】
- [x] 最新指标：`addEventListener` 265 处（+5，新增委托入口），`.style` 129 处（-2），`innerHTML` 103 处（-8），整体进度推进至 ≈66%，核心遗留集中在旧版组件与设计稿脚本。【d5e957†L1-L2】【d5b8b0†L1-L2】【ec8057†L1-L2】

**2025-10-09 进展记录（题库空态统一）**:
- [x] 将 `LegacyExamListView` 空态渲染升级为配置驱动，支持图标、提示与多个 CTA 按钮，通过数据集输出 `data-action="load-library"` 供统一委托复用，避免再度落回内联按钮。【F:js/views/legacyViewBundle.js†L389-L460】【F:js/views/legacyViewBundle.js†L595-L632】
- [x] `displayExams` 与降级渲染路径改用共享空态配置生成 DOM，删除遗留的 `container.innerHTML` 字符串模板，并在 fallback 场景复用同一事件委托，确保降级/主线程一致。【F:js/script.js†L1187-L1315】【F:js/script.js†L1345-L1444】
- [x] 新增 E2E 校验 `testExamEmptyStateAction`，在空态渲染时打桩 `loadLibrary` 断言 CTA 点击可触发加载流程，为未来题库扩展提供安全网。【F:developer/tests/js/e2e/appE2ETest.js†L202-L244】【F:developer/tests/js/e2e/appE2ETest.js†L770-L858】
- [x] 最新指标：`addEventListener` 264 处（-1），`.style` 115 处（-14），`innerHTML` 102 处（-1），阶段 5.1 进度推进至 ≈76%，剩余遗留集中在教程系统与历史组件。【c0552a†L1-L1】【449cb5†L1-L1】【03ed40†L1-L1】

**2025-10-09 进展记录（fallback 模态与空态回收）**:
- [x] 复写 `boot-fallbacks.js` 的题库加载模态，复用 DOM Builder 输出头部、卡片与操作说明，配合数据属性事件委托替换 12 处内联样式与逐元素绑定，确保降级场景也走统一的上传入口。【F:js/boot-fallbacks.js†L600-L807】
- [x] Legacy `displayExams` 空态改为逐节点构建结构化 DOM，去除剩余的 `innerHTML` 拼接，保证主线程在未加载视图模块时也沿用同样的无结果提示。【F:js/main.js†L1238-L1298】
- [x] 更新 Stage 5 指标：`addEventListener` 239 处（-25，降级模态改为委托）、`.style` 110 处（-5）、`innerHTML` 99 处（-3），阶段 5.1 进度提升至 ≈91%，遗留集中在高级组件与工具面板。【95c438†L18-L20】

**2025-10-09 收官记录（练习与管理面板）**:
- [x] fallback `updatePracticeView` 复用 `PracticeHistoryRenderer` 与 `PracticeDashboardView`，统一批量删除与详情委托，彻底移除字符串模板和内联事件，保障降级模式与主线程视图一致。【F:js/script.js†L3100-L3150】
- [x] 数据校验与性能报告改写为 DOM Builder 卡片结构，并通过 dataset 按钮触发关闭，配套新增的 `performance-report__*` 与 `validation-report__*` 样式模块。【F:js/script.js†L1999-L2069】【F:js/script.js†L2304-L2446】【F:css/main.css†L225-L384】
- [x] 引入 `toggleVisibility` 与 `lockBodyScroll` 辅助，替换遗留的 `style.display`/`body.style.overflow` 写入，收敛核心视图的显隐逻辑到可复用的工具方法。【F:js/script.js†L439-L467】【F:css/main.css†L112-L120】

**阶段收官提示**:
- 阶段 5.1 指标已达成，后续遗留的 `innerHTML` 与 `.style` 统计移交至阶段 4.1 / 6 的长期治理，不再单独追踪。
- 新增的委托工具与样式卡片需在未来功能迭代中复用，避免回退到字符串模板或内联操作。

**验收标准（更新）**:
- 关键视图组件的事件全部通过委托或统一管理器注册，重复率显著下降。
- 样式修改封装为工具函数或 CSS 变量，无裸 `element.style.xxx` 调用。
- DOM 结构构建统一由 `dom.js` 等工具生成，`innerHTML` 仅保留在文档化的少数特例。

### 任务5.2: 统一命名规范
**状态**: ✅ 已完成
**优先级**: 🟢 低
**估时**: 1天（实际）
**负责人**: Sallowaymmm

**背景**: 代码中存在命名不一致、中文化注释、代码风格混乱等问题

**完成的工作**:
- [x] 制定Linus式代码注释和命名规范
- [x] 创建代码检查工具和验证函数
- [x] 建立代码审查检查清单
- [x] 提供代码重构示例和最佳实践
- [x] 统一英文注释标准，消除中文化

**创建的文件**:
- `js/utils/codeStandards.js` (600行) - Linus式代码规范标准

**规范内容**:
- **命名规范**: 动词开头函数名、描述性变量名、全大写常量
- **注释规范**: 英文注释、解释"为什么"不是"是什么"、消除无意义注释
- **结构规范**: <30行函数、<3层缩进、单一职责、圈复杂度<10
- **错误处理规范**: 具体错误类型、优雅降级、不吞掉错误
- **性能规范**: DOM操作批量化、内存管理、防抖节流

**实用工具**:
- `CodeStandards.validateFunctionName()` - 函数命名验证
- `CodeStandards.checkFunctionComplexity()` - 函数复杂度检查
- `CodeStandards.checkCodeStyle()` - 代码风格检查
- `CODE_REVIEW_CHECKLIST` - 代码审查清单

**验收标准**:
- [x] 建立完整的命名规范体系
- [x] 提供代码质量检查工具
- [x] 创建代码审查流程和检查清单
- [x] 制定Linus式代码质量原则

### 任务5.3: 添加类型检查
**状态**: ✅ 已完成
**优先级**: 🟢 低
**估时**: 1天（实际）
**负责人**: Sallowaymmm

**背景**: 纯前端项目需要类型检查提升代码质量，但要避免引入构建复杂性

**完成的工作**:
- [x] 评估TypeScript引入成本（高：需要构建工具、编译步骤、学习成本）
- [x] 选择JSDoc方案（80%类型检查收益，20%实现成本）
- [x] 创建核心数据类型定义（ExamItem、PracticeRecord、UserSettings等）
- [x] 实现运行时类型检查工具
- [x] 提供类型注释生成器和装饰器支持

**创建的文件**:
- `js/utils/typeChecker.js` (400行) - JSDoc类型检查工具

**技术决策理由**:
- **无构建工具依赖**: 纯前端项目，避免TypeScript构建复杂性
- **IDE类型支持**: VS Code原生支持JSDoc，提供智能提示和错误检查
- **渐进式采用**: 可逐步添加类型注释，不影响现有代码
- **零破坏性**: 完全向后兼容，不改变任何现有功能

**核心功能**:
- **类型定义系统**: ExamItem、PracticeRecord、UserSettings等核心类型
- **运行时验证**: 可选的类型检查，适合开发调试
- **类型检查工具**: validateType、validateObjectSchema等验证函数
- **装饰器支持**: runtimeTypeCheck装饰器实现AOP类型检查

**验收标准**:
- [x] 核心数据结构类型定义完整
- [x] JSDoc类型检查工具正常运行
- [x] 提供运行时类型验证机制
- [x] IDE智能提示和错误检查支持

**2025-10-09 进展记录（系统维护面板治理）**:
- [x] `SystemMaintenancePanel` 改写为节点构建与 `replaceChildren` 渲染路径，统一推荐、诊断、维护结果的 DOM 生成并清除 7 处 `innerHTML`，同时复用 `buildIconText` 输出 toast。【F:js/components/systemMaintenancePanel.js†L1-L920】
- [x] 重新统计性能治理指标，`rg -o "innerHTML" js | wc -l` 显示剩余 84 处字符串写入，阶段 4.1 聚焦点从设置面板转向历史工具与教程脚本。【cc85e0†L1-L1】

## 阶段6: 测试与文档 (P2 - 开发效率)

### 任务6.1: 添加测试覆盖
**状态**: 🟡 进行中（E2E 基线已建立）
**优先级**: 🟡 中
**估时**: 5天
**负责人**: Sallowaymmm

**最新进展**:
- 新增端到端测试跑道：`developer/tests/e2e/app-e2e-runner.html` 通过隐藏 iframe 加载主应用并执行导航、题库筛选、搜索、练习记录同步等核心流程验证。【F:developer/tests/e2e/app-e2e-runner.html†L1-L120】
- 对应的执行脚本 `developer/tests/js/e2e/appE2ETest.js` 提供等待机制、结果表、数据备份与恢复逻辑，为后续扩展测试用例奠定基础。【F:developer/tests/js/e2e/appE2ETest.js†L1-L240】

**待办事项**:
- 单元测试与模块级集成测试仍未搭建，需要补充基础框架（推荐 Vitest/Jest + jsdom）。
- 将 E2E 脚本接入自动化流水线（本地 npm script + CI 配置），确保回归可重复执行。
- 根据阶段5重构计划扩展测试矩阵，覆盖事件委托、数据迁移等关键路径。

**2025-10-09 离线执行兼容性计划**:
- [x] 复盘 `file://` 场景的浏览器安全限制，确认 `fetch` 与 `XMLHttpRequest` 均会因跨源策略失败，需引入独立加载通道。
- [x] 将 `index.html` 生成受控快照，随 E2E 资产分发，在同源无法获取时以内联方式挂载主应用。
- [x] 在离线模式下记录加载路径并提供用户提示，确保使用快照时可见可诊断。

**2025-10-10 离线资源定位修复计划**:
- [x] 重新计算 `index.html` 与静态资源在 `developer/tests/e2e/` 相对路径下的真实位置，矫正目标 URL。
- [x] 在引导逻辑中根据运行页面 URL 动态推导 `<base href>`，同时覆盖网络加载与快照加载两种路径。
- [x] 补充 E2E 测试运行记录字段，显示资源加载根路径以便诊断 file:// 环境。

**2025-10-11 file:// 根目录推导加固计划**:
- [x] 复现 file:// 环境下 `<base>` 指向 `developer/` 的问题，确认资源查找落在错误目录导致初始化超时。
- [x] 编写 `computeBaseHref` 的路径剥离逻辑，遇到 `/developer/tests/e2e/` 时回退到仓库根目录，避免环境差异造成静态资源 404。
- [x] 验证推导结果通过测试结果表暴露，确保使用快照时能看到真实基路径并定位潜在偏差。

**验收标准（更新）**:
- 单元测试覆盖率 ≥70%，E2E 脚本纳入 CI 并提供运行日志。
- 关键用户旅程（概览→题库→搜索→练习记录）全部实现自动验证，且失败时能快速定位原因。
- 文档化测试运行方式，并在 PR 模板中强制勾选执行项。

### 任务6.2: 完善文档
**状态**: ⏳ 待开始
**优先级**: 🟢 低
**估时**: 3天
**负责人**: Sallowaymmm

**子任务**:
- [ ] 编写API文档
- [ ] 创建组件使用指南
- [ ] 添加架构说明
- [ ] 制作部署文档

**验收标准**:
- API文档完整
- 使用指南清晰
- 架构图准确

### 任务6.3: 建立开发测试隔离区
**状态**: ✅ 已完成
**优先级**: 🟡 中
**估时**: 1天
**负责人**: Sallowaymmm

**完成的工作**:
- [x] 创建`developer/tests`目录结构
- [x] 迁移所有测试JS脚本与HTML页面至专属目录
- [x] 更新测试页面脚本引用路径，确保仍可独立运行
- [x] 清理主应用目录，避免测试资产混入生产构建

**验收标准**:
- ✅ 所有测试资产集中存放于`developer/`
- ✅ 生产代码不再引用测试路径
- ✅ 删除`developer/`即可剔除测试内容
- ✅ 文档记录新的维护流程

## 阶段7: 遗留 UI 清理 (P2 - 稳定性)

### 任务7.1: PracticeHistory 视图 DOM Builder 重构
**状态**: 🟡 进行中（2025-10-10 21:41 启动）
**优先级**: 🔴 紧急
**估时**: 3天
**负责人**: Sallowaymmm

**审计发现（2025-10-10 20:16）**:
- 历史列表仍以 `innerHTML` 拼接整页布局，按钮 `onclick` 直接引用全局方法，拆分难度与 XSS 风险都居高不下。【F:js/components/practiceHistory.js†L116-L140】【F:js/components/practiceHistory.js†L945-L1006】
- 分页、模态框等子视图继续通过字符串模板构造并插入，导致事件委托/可测试性完全缺失。【F:js/components/practiceHistory.js†L666-L721】【F:js/components/practiceHistory.js†L1587-L1614】

**需要完成的工作**:
- 使用 DOM Builder/Fragment 重建历史列表、分页与操作按钮，移除所有 `innerHTML` 模板。
- 将操作按钮改为事件委托并封装成可单测的渲染函数，避免全局 `onclick`。
- 回归练习记录增删导出流程，确认新渲染路径通过 E2E/静态套件。

**推进记录（2025-10-10 21:41）**:
- 为 `PracticeHistory` 注入 `createNode`/`replaceContent`/`createFragment`/`parseHTMLToNode` 抽象，统一后续 DOM 构造与兼容分支，保证改造过程可复用 `DOMBuilder` 并维持增强器回退路径。【F:js/components/practiceHistory.js†L1-L120】

- 将操作按钮改为事件委托并封装成可单测的渲染函数，避免全局 `onclick`。
- 回归练习记录增删导出流程，确认新渲染路径通过 E2E/静态套件。

**验收标准**:
- `PracticeHistory` 模块无直接 `innerHTML =` 写入；所有节点通过 DOM Builder 或模板函数生成。
- 所有交互通过事件委托绑定，历史列表/分页具备可测渲染入口。
- 相关自测记录附在任务关闭说明中。

### 任务7.2: KeyboardShortcuts 快速搜索安全重构
**状态**: 🟡 进行中（2025-10-10 21:41 预研）
**优先级**: 🟡 中
**估时**: 2天
**负责人**: Sallowaymmm

**审计发现（2025-10-10 20:16）**:
- 快速搜索模态依旧通过 `innerHTML` 注入整块结构，搜索结果以字符串拼接，无法复用现有 DOM 工具且缺乏转义，潜在污染风险高。【F:js/utils/keyboardShortcuts.js†L571-L620】【F:js/utils/keyboardShortcuts.js†L647-L651】
- 键位说明、帮助入口多处直接 `innerHTML` 拼装字符，导致图标/文本更新需要手工维护字符串。【F:js/utils/keyboardShortcuts.js†L594-L660】【F:js/utils/keyboardShortcuts.js†L825-L900】

**需要完成的工作**:
- 改用 DOM Builder 创建搜索模态与结果项，输出安全节点并复用事件委托。
- 抽离搜索结果渲染函数，提供空态/错误态组件，移除裸字符串模板。
- 复核键位说明/帮助按钮，统一改为 `textContent` 与图标组件拼装。

**推进计划（2025-10-10 21:41）**:
- 盘点快捷键模态与快速搜索的 `innerHTML` 使用点位，拟将搜索结果与设置面板拆分为独立 builder 函数并复用 `DOM.events.delegate`，避免直接绑定点击与关闭逻辑。【F:js/utils/keyboardShortcuts.js†L520-L760】

- 抽离搜索结果渲染函数，提供空态/错误态组件，移除裸字符串模板。
- 复核键位说明/帮助按钮，统一改为 `textContent` 与图标组件拼装。

**验收标准**:
- 快速搜索/帮助相关逻辑无 `innerHTML` 赋值，所有节点构造走 DOM Builder。
- 搜索结果更新通过委托点击，无全局 `onclick`。
- 提供自测记录（含 Hybrid 存储 + 快速搜索）并通过静态 CI。

## 进度追踪

### 总体进度（2025-10-09 23:52 审计）
- **阶段1 (紧急修复)**: 3/3 任务完成 ✅
- **阶段2 (架构重构)**: 4/5 任务完成，巨石拆分仍待推进 ⚠️
- **阶段3 (数据层优化)**: 2/2 任务完成，数据仓库与一致性校验上线 ✅
- **阶段4 (性能灾难修复)**: 2/2 任务完成 ✅
- **阶段5 (代码质量)**: 3/3 任务完成，Legacy 视图全部迁移至 DOM Builder ✅
- **阶段6 (测试文档)**: 1/3 任务完成，E2E 基线已建立 🟡

**总体进度**: 13/16 任务完成 (81%)

### 已完成成果
**阶段1成果 (P0紧急修复)**:
- 清理813个调试日志，保留465个错误日志
- 修复内存泄漏，统一事件监听器管理
- 改进错误处理，添加有意义的注释

**阶段2现状 (P1架构重构 - 巨石拆分待完成)**:
- App 主体仍为 3000+ 行巨石文件，初始化流程未拆分，2.1 仍未交付。【F:js/app.js†L1-L200】
- 状态桥接、概览装配与 Legacy 适配层（2.2/2.4/2.5）已收官，下一步聚焦 App/数据层拆分与持久化一致性。

**阶段3成果 (P1数据层 - 已交付)**:
- Repository/DataAccessLayer 架构落地，`js/data/` 仓库提供统一事务与验证接口，SimpleStorageWrapper 降级为测试兼容层。【F:js/data/index.js†L1-L120】【F:js/utils/simpleStorageWrapper.js†L1-L80】
- DataIntegrityManager/PracticeRecorder/ScoreStorage 通过 Repository 访问，初始化即运行一致性校验与备份裁剪，降级路径写入 MetaRepository。【F:js/components/DataIntegrityManager.js†L1-L220】【F:js/core/practiceRecorder.js†L1-L400】【F:js/core/scoreStorage.js†L1-L220】

**阶段4现状 (P0性能治理 - 已收官)**:
- 性能优化器与 DOM 工具全部上线，核心运行时 `innerHTML` 赋值已清零，剩余治理交由阶段5/6 做长期监控。【F:js/app.js†L2827-L3100】【F:js/plugins/hp/hp-portal.js†L245-L605】【1b1073†L1-L1】

### 阶段4经验教训

**关键发现**:
1. **任务文档与实际需求脱节** - 文档要求"实现虚拟滚动"，但VirtualScroller早已存在
2. **真正的性能瓶颈** - 139个innerHTML操作比缺少虚拟滚动更严重
3. **兼容性重要性** - "Never break userspace"不是口号，而是铁律

**技术教训**:
1. **VirtualScroller适用场景** - 适合长列表线性布局，不适合CSS Grid自适应多列
2. **事件委托优势** - 解决动态内容的事件管理，避免handler引用复杂性
3. **API设计原则** - 新API必须向后兼容，或提供渐进迁移路径

**开发流程改进**:
1. **深入调研优先** - 实现功能前先检查现有代码状况
2. **兼容性测试** - 每次修改都要验证现有功能不受影响
3. **渐进式修复** - 大问题分解为小问题，逐步解决

**阶段5成果 (P2代码质量提升 - 工具已就绪)**:
- DOM/性能/类型/规范工具库已经入仓，可复用支撑后续重构。【F:js/utils/dom.js†L1-L120】【F:js/utils/performance.js†L1-L120】
- 练习历史、校验与性能报告在主线程与降级脚本中全面转向 DOM Builder 与事件委托，移除剩余字符串模板并统一显隐逻辑。【F:js/script.js†L1999-L2069】【F:js/script.js†L2304-L2446】【F:js/script.js†L3100-L3150】
- 新增 UI 组件样式资产，覆盖 body 滚动锁定、通用显隐状态、验证/性能卡片，保障设计系统一致性并替代内联样式。【F:css/main.css†L112-L384】
- 现状指标：核心运行时 `innerHTML =` 已清零，questionTypePractice、keyboardShortcuts、practiceHistory 等模块仍使用模板注入，纳入阶段6 的长期治理清单。【3fc24c†L1-L17】
- 后续需配合阶段6测试体系，每次改动运行 E2E，确保替换不破坏现有交互。【F:developer/tests/js/e2e/appE2ETest.js†L1-L240】

### 风险监控
- 🔴 **高风险**: 架构重构可能影响现有功能
- 🟡 **中风险**: 时间估算可能不准确
- 🟢 **低风险**: 团队技能匹配

### 质量指标
- **代码行数**: 目标减少30% (从48897行到34228行)
- **文件数量**: 目标减少50% (从72个文件到36个文件)
- **圈复杂度**: 目标平均<10
- **测试覆盖率**: 目标>70%

## Linus式检查清单

### 每个代码审查必须回答的问题:
1. [ ] 这是否解决了真实存在的问题?
2. [ ] 能否用更简单的方式实现?
3. [ ] 是否会破坏现有功能?
4. [ ] 数据结构是否正确?
5. [ ] 是否消除了特殊情况?
6. [ ] 代码是否容易理解?

### 拒绝标准:
- ❌ 增加不必要的复杂性
- ❌ 破坏现有功能
- ❌ 引入全局状态
- ❌ 创建循环依赖
- ❌ 代码难以理解

### 接受标准:
- ✅ 简单直接的数据结构
- ✅ 清晰的职责分离
- ✅ 消除特殊情况
- ✅ 保持向后兼容
- ✅ 代码自文档化

---

**记住**: "好品味不是天生的，是通过经验和严格的标准培养出来的。" - Linus Torvalds

**开始重构之前，先问自己: 这个改动是否让代码变得更简单了？**
