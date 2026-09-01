# IELTS Practice Rust + Tauri 原生重构审查与多阶段任务书

> 审查目标：`sallowayma-git/IELTS-practice` 仓库 `IELTS-WRITING-FEAT` 分支  
> 锁定提交：`2e3cf0872b8f67cb6c82d1799d7043578f77157c` — `Align practice shell navigation copy`  
> 阅读参考分支：`opensource`  
> 文档日期：2026-07-12  
> 文档定位：用户体验冻结规范、领域模型收敛方案、Rust + Tauri 迁移架构与分阶段实施任务书
> **执行状态（2026-07-13 真实证据复核）**：Phase 0–10 尚未完成。静态 shipping gate 当前 5/5 通过；packaged Tauri E2E、跨平台安装包、真实 AI、签名/更新和完整 parity 尚无通过证据。本文以下“实现”不等于“验收”。
> **纯原生收口（post-Phase-10）**：A 全删 Electron/Fastify 前端双路径；B domain `adapters` 迁入 `ielts-db::import::convert`（冷路径可选导入）；`attempts` 热路径独立；`release.yml` 改为 Tauri 打包。

---

## 执行进度板

| Phase | 状态 | 完成日 | 本地提交 | 关键证据 |
|---|---|---|---|---|
| 0 冻结基线与证据库 | 🟡 implemented / verify pending | 2026-07-12 | `b9f579e` | 静态基线报告；仍需 CI/打包证据 |
| 1 领域契约 | 🟡 implemented / verify pending | 2026-07-12 | `5116cbf` | Rust DTO 已有；前端类型边界和 contract gate 待完成 |
| 2 Tauri 壳层 | 🟡 implemented / verify pending | 2026-07-12 | `6499dc6` | 壳层已构建；packaged WebView/capability 负向测试待跑 |
| 3 SQLite v2 双读 | 🟡 implemented / verify pending | 2026-07-12 | `fbcf5a4` | migration 已有；旧数据实库迁移/回滚证据待补 |
| 4 历史/设置/备份 | 🟡 implemented / verify pending | 2026-07-12 | `45f43d7` | repository 已有；安全存储和完整恢复验收待补 |
| 5 写作评测 | 🟡 incomplete | 2026-07-12 | `468a457` | 持久化骨架已落地；真实 LLM provider 和故障注入未完成 |
| 6 阅读作答判分 | 🟡 incomplete | 2026-07-12 | `6fbaac3` | 核心判分已有；全文资源打包/parity 未验收 |
| 7 套题/无尽/计时 | 🟡 implemented / verify pending | 2026-07-12 | `b94fc88` | 状态机已有；packaged restart 流程待验证 |
| 8 高亮/词典/教练 | 🟡 incomplete | 2026-07-12 | `afb4477` | Rust repository 已有；legacy UI/资产路径仍待收尸 |
| 9 视觉/a11y/性能 | 🟡 incomplete | 2026-07-12 | `6ceae96` | CSS/预算存在；视觉、键盘与设备 P95 无验收证据 |
| 10 切换清理发布 | 🟡 implementation / release pending | 2026-07-12 | `3a2e0ec` | Tauri-only workflow；packaged E2E、签名和实机发布未验收 |


## 0. 审查范围、方法与限制

本次审查覆盖以下层次：

1. 最新提交的代码变更、导航语义与测试覆盖。
2. Vue 前端的全局路由、写作流程、阅读流程、历史记录和设置页面。
3. Electron 主进程、preload、应用协议、本地 Fastify API、服务装配和 SQLite 迁移机制。
4. 写作两阶段 AI 评测、会话事件、降级、重试、结果持久化和回放。
5. 阅读单篇、套题、无尽、背题、复盘、计时、标记、高亮、笔记、词典和 AI 教练。
6. `opensource` 分支所体现的阅读产品流程和界面行为，重点参考用户操作流程，不沿用其浏览器存储数据架构。
7. Tauri 2、SQLite WAL/事务和 WCAG 2.2 的相关最佳实践。

审查通过 GitHub 连接器逐文件读取完成。当前执行环境无法解析 `github.com`，因此未能本地克隆仓库，也未能实际运行 npm、Playwright、Python E2E、构建或打包命令。仓库当前目标提交没有可见 GitHub Actions workflow run 或 commit status。因此，本文中的代码结论属于高置信度静态审查；所有标记为“运行验证”的项目必须在重构启动前由本地或 CI 补跑。
**Phase 0 本地补跑说明（2026-07-12）**：已在本机执行 `run_static_suite.py` 与 `practiceVueShell.test.js`。静态套件 106 pass / 14 fail；失败全部归类为环境债（缺 `tsc`、Node 26 下 `better-sqlite3` 原生编译失败、Playwright Python 缺失、writing-vue/electron 依赖未装全）。详见 `docs/rewrite/phase0-baseline-report.md`。这些失败记入基线，不得算作后续重构回归。


---

## 1. 执行摘要

### 1.1 总体判断

最新提交完成了一个必要但有限的产品层修正：它将顶栏从“Practice Shell / 题库 / 练习”改为“Reading + Writing / 阅读 / 写作”，品牌点击返回统一总览，并新增查询参数感知的导航激活态。变更方向正确，避免继续向用户暴露实现术语，也降低了“阅读产品”和“写作产品”像两个独立应用的割裂感。

但是，这次提交只实现了**导航文案和入口语义统一**，并没有实现真正的架构统一。当前代码仍然同时存在：

- Electron IPC 与 localhost Fastify HTTP/SSE 两套宿主通信方式；
- `essays` 与 `practice_history_records` 两套历史数据源；
- 写作评测会话、阅读提交、套题会话三套不同状态模型；
- 规范字段、兼容字段、legacy 字段、展示字段和派生字段混合持久化；
- Vue 声明式组件与大量直接 DOM 操作、动态脚本加载、legacy bridge 并存；
- 数据库存储列与大型 JSON 快照重复保存相同信息。

因此，不建议直接把现有 Electron 主进程逐行翻译成 Rust，也不建议一次性重写前端。最稳妥的路线是：

> **先冻结用户体验契约，再建立最小领域模型和兼容读取层；随后用 Tauri command/channel 替换宿主与本地 HTTP 服务；最后逐模块迁移阅读和写作业务，并在每个阶段保持旧数据可读、旧流程可回退。**

### 1.2 必须优先处理的阻断项

| 优先级 | 阻断项 | 当前表现 | 重构要求 |
|---|---|---|---|
| P0 | 写作会话不可可靠恢复 | 活跃会话和最多 80 条事件主要保存在进程内存，缓存 TTL 15 分钟；应用崩溃或重启后运行态丢失 | 会话状态、阶段检查点和最终结果必须持久化；启动时可恢复或明确标记中断 |
| P0 | 数据模型重复且无唯一事实源 | 阅读 submission 同时保存 `assetId/examId`、`scoreInfo`、顶层分析字段、`analysisArtifacts`、`metadata` 和 `legacy` | 建立规范化核心表；派生数据不重复持久化；兼容字段只在适配器中生成 |
| P0 | 本地 HTTP 写接口边界过宽 | 守卫接受空/`null` Origin，也信任任意 localhost 来源；本机其他页面理论上可能调用写接口 | Tauri 化后删除 localhost 业务 API；使用 capability、command scope 和显式参数校验 |
| P0 | 巨型页面承担过多职责 | `PracticeReadingPage.vue` 同时处理路由、计时、拖拽、DOM 同步、高亮、词典、笔记、教练、提交、回放 | 按领域状态机、交互适配器和视图组件拆分；DOM 操作集中在受控适配层 |
| P1 | 历史页前端合并两个后端 | 写作走 `/api/essays`，阅读走 `/api/practice/history`，前端自行合并、分页、筛选、删除和 CSV | 后端提供统一 attempt/history 查询和游标/分页契约 |
| P1 | 迁移机制存在 schema 漂移 | `schema.sql`、SQL migrations、运行时 `ensureColumn`、store 自建表同时存在 | 只保留单一版本化迁移链，所有迁移事务化、可测试、可回滚或可重建 |
| P1 | TypeScript 边界失效 | 核心写作服务和 contracts 使用 `// @ts-nocheck`，TS 直接 require Electron JS 服务 | Rust 领域类型成为源头；前端由生成类型或 schema 绑定，不再依赖 `any` 服务包 |
| P1 | 阅读拖拽缺少完整非拖拽等价路径 | 题目支持拖拽和部分 select/点击逻辑，但应以题型逐项验证 | 所有拖拽题必须提供点击/键盘替代，满足 WCAG 2.5.7 |
| P1 | 自动计时与自动提交存在体验风险 | 阅读支持暂停、倒计时、锁定、自动提交、套题共享计时 | 冻结精确语义，并提供明显状态、可配置策略和中断恢复 |

### 1.3 推荐技术结论

“Rust + Tauri 原生应用”在本项目中应定义为：

- Tauri 2 负责桌面窗口、文件系统、更新、安全权限、系统对话框和发布。
- Rust 负责领域状态、SQLite、迁移、题库索引、答题判定、历史、备份、AI 调度和恢复。
- 现有 Vue UI 先保留并逐步拆分，保证视觉与交互连续性。
- 不在第一阶段改用 Rust GUI 框架或原生控件重写整个界面。那会把“运行时重构”和“UI 技术栈重写”叠加成一个高风险项目。

---

## 2. 最新提交完整 Review

### 2.1 提交变更范围

目标提交共修改 6 个文件：

- `apps/writing-vue/src/components/NavBar.vue`
- `apps/writing-vue/src/views/PracticeLibraryPage.vue`
- `developer/tests/e2e/writing_compose_draft_restore_e2e.py`
- `developer/tests/js/practiceVueShell.test.js`

核心变化：

1. 品牌副标题由 `Practice Shell` 改为 `Reading + Writing`。
2. 全局导航改为“总览、阅读、写作、历史、设置”。
3. 阅读入口使用 `/?view=browse`，并通过 `isNavActive()` 自行判断查询参数激活态。
4. 品牌点击目标由写作岛返回统一 `/` 总览。
5. 阅读首页品牌由 `IELTS Atlas` 改为 `IELTS Practice`。
6. 静态测试和 E2E 选择器同步新文案与路由。

### 2.2 做得正确的部分

#### A. 用户文案不再暴露内部架构

`Practice Shell` 是实现概念，不是用户心智。改成 `Reading + Writing` 明确传达产品范围，是正确的产品化调整。

#### B. 导航从“功能动作”提升为“业务模块”

旧导航中的“题库”和“练习”容易混淆阅读题库、写作题库和练习类型。新导航以“阅读 / 写作”区分一级业务域，历史和设置作为跨域能力，信息架构更稳定。

#### C. 查询参数激活态修复了 Vue Router 默认行为的不足

阅读入口和总览共享 `/` 路径，仅靠 `router-link-active` 无法区分。提交新增查询参数判断，避免总览和阅读同时误激活。

#### D. E2E 增加失败诊断

`writing_compose_draft_restore_e2e.py` 在等待作文输入失败时采集 URL、标题、导航文字、标题列表和 body 摘要，比单纯 timeout 更利于定位回归。

### 2.3 最新提交仍存在的问题

#### F-001：一级导航与页面内部二级导航仍重复

`PracticeLibraryPage.vue` 内部仍有“总览、题库浏览、练习记录、更多、设置”导航。全局顶栏又提供“总览、阅读、写作、历史、设置”。用户会同时面对两套层级相似但语义不同的导航。

处理建议：

- 全局顶栏只承担跨业务域跳转。
- 阅读模块内部只保留“阅读总览、题库、专项/套题、工具”等阅读域标签。
- 阅读内部“练习记录”应跳转全局历史并自动筛选 reading，而不是再维护独立历史主页面。
- 阅读内部“设置”只保留字号、主题、计时、教练等阅读会话偏好；系统级设置统一进入全局设置。

#### F-002：`/?view=browse` 是过渡路由，不应成为长期领域契约

查询参数方式兼容旧页面很方便，但重构后建议使用明确路径：

- `/overview`
- `/reading`
- `/reading/library`
- `/reading/suites/:id`
- `/writing`
- `/history`
- `/settings`

迁移期保留 `/?view=browse` 重定向，以免旧书签和宿主路由失效。

#### F-003：测试主要验证字符串存在，不足以证明导航语义正确

`practiceVueShell.test.js` 大量使用 `assertContains` 检查源码文本。这类测试能防止文案回退，但不能验证：

- 浏览器前进/后退后激活态是否正确；
- query 数组、未知 query、深层阅读路由的高亮是否符合预期；
- 键盘 Tab 顺序和可见焦点；
- 小窗口下水平滚动导航是否可操作；
- 从阅读详情返回时是否恢复列表位置和筛选。

应补充真正的路由和 UI 行为测试，而不是只增加字符串断言。

#### F-004：提交没有 CI 状态证据

目标提交未发现 workflow runs 或 commit statuses。合并前至少应在 Windows 和 macOS 执行：

```text
npm run build:writing
node developer/tests/js/practiceVueShell.test.js
python developer/tests/e2e/writing_compose_draft_restore_e2e.py

# 历史注记：practice_reading_vue_flow.py / practice_reading_suite_vue_flow.py
# 已于 2026-08 清理删除（断言与现役代码脱节且无运行器引用）。
# 现役阅读回归入口为 packaged E2E：python developer/tests/e2e/suite_practice_flow.py
```

#### F-005：导航命名统一掩盖了历史和设置仍为双系统

顶栏“历史”和“设置”看似全局，底层却仍分别拼接写作与阅读服务。此次提交没有解决用户在两个页面看到相近但不完全一致数据、备份和删除行为的问题。

### 2.4 对最新提交的结论

该提交可以保留，属于正确的体验修复；但应把它视为“重构前的产品语义校准”，而不是架构合并完成。后续重构必须将这套统一品牌和一级导航作为不可回退的体验基线。

---

## 3. 当前系统深层代码审查

## 3.1 宿主与通信层

### F-101：localhost Fastify 层在 Tauri 架构中没有保留价值

当前 Electron 启动后创建 `ServiceBundle`，再启动 Fastify 监听 `127.0.0.1`，Vue 通过 preload 获取动态端口后使用 HTTP 和 SSE。该结构在 Web/Electron 过渡期合理，但迁移到 Tauri 后会带来：

- 额外端口、CORS、Origin 和生命周期管理；
- 防火墙、端口占用和本机恶意页面访问面；
- 请求/响应类型在 HTTP envelope、服务层和前端 client 三处重复；
- 流式评测同时存在 SSE、Electron event 和缓存事件三套机制。

目标：普通请求改为 Tauri command；写作评测流改为 Tauri Channel；低频广播事件才使用 event。

Tauri 官方文档明确将 Channel 推荐用于流式数据；普通 event 不具备类型安全、不能返回值且只支持 JSON，因此不应继续把所有评测数据都做成全局事件。

### F-102：本地 API 守卫允许空或 `null` Origin

`isTrustedLocalApiUrl()` 对空字符串和 `null` 直接返回 true，并信任 `localhost`、`127.0.0.1` 和 `::1`。这无法证明请求来自本应用 WebView。

在 Tauri 目标架构中：

- 删除业务 localhost API。
- capability 仅授予主窗口所需命令。
- 文件、更新、导入、导出、密钥和数据库命令分开授权。
- 不为远程 URL配置 Tauri command access。
- 每个命令继续做领域级授权和路径 scope 校验；capability 不是 Rust 代码正确性的替代品。

### F-103：Electron sandbox 被关闭

主窗口设置 `contextIsolation: true`、`nodeIntegration: false`，这是积极措施；但 `sandbox: false` 扩大了渲染进程风险面。Tauri 迁移后应默认不提供任意系统接口，按窗口 capability 最小授权。

### F-104：路由 allowlist 值得迁移，但应由前端路由和命令 schema 共用定义

`normalizePracticeShellRoute()` 对协议、反斜杠、hash 和路径做了明确限制，是当前代码中较好的安全边界。重构时不要丢失该保护，但不要在 Rust 和 Vue 各维护一套正则。应定义统一 RouteTarget enum/DTO，并由 Rust 序列化给前端或由共享 schema 生成。

---

## 3.2 写作评测链路

### 当前用户流程

1. 选择 Task 1/Task 2。
2. 选择题库题或自由输入题目。
3. 输入作文，自动保存草稿。
4. 提交并创建评测 session。
5. 进入评测页，显示阶段、进度、日志和作文打字动画。
6. 第一阶段输出四项分数、任务诊断、评分理由和提分计划。
7. 第二阶段输出段落详评、句级错误、整体反馈和改写建议。
8. 第二阶段失败时降级保留评分结果。
9. 评测完成后保存 essay 并进入结果页。
10. 历史页可筛选、统计、查看详情、导出和删除。

### F-201：核心服务使用 `// @ts-nocheck`

`evaluate-service.ts` 和 `contracts.ts` 在最复杂、最重要的代码上关闭类型检查，并直接 require Electron 目录中的 JS 服务。这意味着：

- 服务边界实际由运行时约定而非类型保证；
- `ServiceBundle` 里多数成员是 `any`；
- 前端 `evaluation-result.js` 必须容忍大量别名和 legacy envelope；
- 修改字段时极易出现“写入成功但消费失败”。

Rust 重构应以 serde DTO 和领域类型作为唯一契约源。前端生成 TypeScript 类型，禁止再次出现全局 `any` service bundle。

### F-202：活跃会话主要保存在内存

`EvaluateService` 使用 Map 保存 controller、timeout、输入上下文、进度和事件，最多缓存 24 个会话、每个 80 条事件、TTL 15 分钟。数据库只记录 session 起止和最终 essay，不保存完整运行检查点。

风险：

- 进程崩溃、更新重启或系统休眠后无法恢复；
- 结果页回退依赖 `sessionStorage` 或 essayId；
- session state 在会话完成清理后只剩缓存事件，缓存到期即不可查询；
- UI 的“重试”实际创建新 session，但旧 session 与新 session 没有 lineage。

目标设计：

- `attempts` 保存用户输入和总状态。
- `evaluations` 保存评测状态、阶段、provider/model、版本和错误。
- 每完成一个阶段持久化 checkpoint。
- 流事件只用于展示，不作为最终事实源。
- 启动恢复时，将 `running` 但无执行器的任务标记为 `interrupted`，允许从上次安全阶段重试。

### F-203：评测结果字段存在多层别名

前端同时消费：

- `score` / `scorecard` / 顶层分数字段；
- `feedback` / `overall_feedback`；
- `review_blocks` / `paragraph_reviews`；
- 顶层 `task_analysis` 与 `analysis.task_analysis`；
- 顶层 `review_degraded`、`review.review_degraded`、`review_status.degraded`。

`resolveEvaluationConsumption()` 的存在证明契约已经发生显著漂移。目标 v4 契约必须只保留一种表示：

```json
{
  "schemaVersion": 4,
  "status": "completed",
  "score": {
    "overall": 6.5,
    "taskResponse": 6.5,
    "coherence": 6.0,
    "lexical": 6.5,
    "grammar": 6.0
  },
  "diagnosis": { "task": {}, "rationale": {} },
  "feedback": {
    "overall": "...",
    "plan": [],
    "paragraphs": [],
    "sentences": [],
    "rewrites": []
  },
  "degradation": null
}
```

旧别名只由导入/读取 adapter 转换，任何新写入不得再生成 legacy 字段。

### F-204：进度百分比是表现层推测，不是业务进度

评测服务通过等待计时、字符数和阶段固定区间推算百分比。UI 又根据 message 文本推断 stage。这容易产生：

- 进度卡住或快速跳动；
- 中文/英文 message 改动后 stage 推断失效；
- 重放事件时进度与实际状态不一致。

目标：后端发结构化 `stage + phase + ordinal + knownTotal`。百分比可选，仅作为展示。UI 不再解析 message 关键词推断状态。

### F-205：结果页存在可访问性和可操作性问题

句子错误使用可点击 `<span>` 展开，但没有 button role、tabindex、键盘事件和 `aria-expanded`。结果高亮使用 `v-html`，虽然文本经过 escape，但交互语义仍不足。重构时应改成语义化按钮/详情组件，并保证焦点可见。

---

## 3.3 阅读练习链路

### 从 `opensource` 分支必须保留的用户体验

阅读参考分支提供的核心体验不是某个具体数据结构，而是以下完整流程：

- 题库浏览：类型、P1/P2/P3、频率、关键词、排序、练习状态和列表位置恢复。
- 单篇阅读：左右分栏、可拖动分隔条、计时器、题目导航、标记题、提交和重置。
- 套题：连续三篇、共享计时、模拟/经典/驻足模式、自动或手动进入下一篇。
- 无尽模式：从可答题资源池随机选择，提交后倒计时进入下一篇。
- 背题模式：预填答案、显示解析、原文定位高亮，不写入普通练习历史。
- 回顾模式：答案对比、正确/错误状态、官方解析、原文定位、题型表现和 AI 复盘。
- 学习辅助：高亮、笔记、本地词典、生词本、AI 教练、字号和深浅主题。
- 历史与统计：近期趋势、热力图、中高频余量、错题雷达、详情和导出。

这些行为应转化为自动化验收契约，而不是依赖旧页面继续存在。

### F-301：阅读页面职责过载

`PracticeReadingPage.vue` 覆盖了：

- asset/session/suite 路由解析；
- 答案状态；
- 计时状态；
- DOM input 同步；
- drag/drop；
- 分隔条；
- 高亮和 Range 操作；
- 词典脚本动态加载；
- 生词本 localStorage；
- 笔记 localStorage；
- 教练请求和持久化；
- 回放和视口恢复；
- 背题与无尽模式；
- 大量页面样式。

目标拆分：

```text
reading/
  domain/
    attempt-machine.ts
    answer-model.ts
    timer-model.ts
    review-model.ts
  application/
    useReadingAttempt.ts
    useReadingReview.ts
    useReadingSuite.ts
  infrastructure/
    readingRepository.ts
    dictionaryGateway.ts
    annotationRepository.ts
  ui/
    ReadingWorkspace.vue
    PassagePane.vue
    QuestionPane.vue
    AnswerNavigator.vue
    AttemptToolbar.vue
    ReviewDrawer.vue
  adapters/
    legacyHtmlQuestionAdapter.ts
    domDropzoneAdapter.ts
    selectionRangeAdapter.ts
```

Rust 负责状态和持久化；Vue 负责交互呈现；DOM adapter 仅服务于仍以 HTML 资产表示的题目。

### F-302：声明式 Vue 与直接 DOM 写入混杂

当前代码通过 `querySelectorAll`、设置 input.checked/value/disabled、创建 button、写 inline style 和包裹文本节点来同步 UI。这样会绕过 Vue 的状态树，导致：

- 组件重渲染覆盖手工 DOM；
- 题型变更后难以测试；
- 恢复、回放和主题切换需要反复 `nextTick()` 后重新同步；
- 无法可靠支持 SSR/测试环境和辅助技术。

迁移顺序：先把所有 DOM 操作集中到 adapter，再逐题型替换为结构化 Vue 组件。不要在同一阶段既替换数据源又替换所有题型渲染器。

### F-303：拖拽必须提供非拖拽替代

当前 heading/matching 等题型支持 drag/drop。WCAG 2.2 2.5.7 要求，除非拖拽本质上不可替代，否则同一功能必须能用单指针且无需拖动完成。

验收标准：

- 每个拖拽选项可点击选择，再点击目标放置；
- 键盘可选择选项并移动到目标；
- 已占用选项的复用规则有清晰提示；
- 拖拽只是增强操作，不是唯一操作；
- 所有目标至少满足 24×24 CSS 像素，并有可见焦点。

### F-304：阅读状态被拆散到数据库、localStorage 和 sessionStorage

当前至少包括：

- 字号和主题：localStorage；
- 笔记：按 assetId 的 localStorage；
- 生词：legacy localStorage；
- 无尽模式：sessionStorage；
- 作答快照：sessionStorage；
- 套题偏好：localStorage；
- 教练开关：设置 API；
- 最终提交：SQLite JSON。

目标：

- 用户长期偏好进入 `settings`。
- 未提交作答进入 `attempt_drafts` 或 attempts 状态。
- 注释/笔记进入 annotations。
- 生词进入 vocabulary_items。
- 临时 UI 开关留在内存，不持久化。
- sessionStorage 只允许作为性能缓存，不作为唯一数据源。

### F-305：阅读提交保存大量重复字段

当前 `ReadingPracticeSubmission` 中：

- `assetId` 与 `examId` 等值；
- `correctAnswers` 可从 asset 的 answer key 获得；
- `scoreInfo.correct`、`total`、`totalQuestions` 和 `duration` 与历史表列重复；
- `highlights`、`markedQuestions`、`analysisSignals`、`questionTimelineLite`、`singleAttemptAnalysis*` 又在 `analysisArtifacts` 中重复一份；
- `metadata.examId/examTitle/title/type/examType/practiceMode/renderMode` 与顶层或路由状态重复；
- `coachContext.selectedAnswers` 可从 answers 派生；
- `legacy` 只为旧接口服务。

这是当前字段膨胀的主要来源，必须在新模型中禁止。

---

## 3.4 历史、统计与设置

### F-401：统一历史页实际上在前端做跨域联邦查询

历史页分别请求写作 essay 和阅读 practice history，在浏览器合并排序、截取分页、计算总数和导出 CSV。其问题包括：

- 写作后端分页后再与阅读全量合并，严格全局分页并不可靠；
- 删除需要按 activity 分流；
- 统计混合 0–9 band 与 0–100 accuracy，图表动态换比例；
- CSV 列天然偏写作，阅读用空列占位。

目标：统一 `attempts` 查询接口，由 Rust 完成排序、筛选、分页和类型化导出。历史展示模型可统一，详情模型按 activity 分派。

### F-402：系统设置、阅读偏好和开发级配置混在同一页面

设置页同时包含缓存、题库、主题、引导、更新、备份、API provider、模型、prompt 版本和系统路径。普通用户很难区分“学习偏好”和“开发/AI 管理”。

建议分层：

1. 学习体验：语言、主题、字号、计时、套题流程、教练开关。
2. 数据与题库：题库来源、刷新、导入、备份、恢复、导出。
3. AI 服务：provider、模型、API key、提示词版本、测试连接。
4. 应用：更新、版本、日志目录、诊断。
5. 高级/开发者：prompt 编辑、provider 优先级、失败冷却、审计日志。

### F-403：API key 存储方案需要重新审计

数据库字段名为 `api_key_encrypted`，但仅凭字段名不能证明密钥管理安全。Tauri 目标中应优先使用 OS keychain 或 Stronghold；SQLite 只保存 secret reference 和非敏感配置。备份默认不得导出明文密钥。

---

## 4. 用户体验冻结清单

以下需求是重构期间的“不可破坏合同”。每条必须有自动化测试或人工验收证据。

完整可执行映射见：`docs/rewrite/ux-contract.md`。

## 4.1 全局产品与导航

| ID | 冻结需求 | 验收标准 |
|---|---|---|
| UX-G-01 | 产品名统一为 IELTS Practice | 启动页、顶栏、阅读首页、窗口标题和导出文件不再混用 IELTS Atlas/Practice Shell/Writing Excellence |
| UX-G-02 | 一级导航固定为总览、阅读、写作、历史、设置 | 任意普通页面均可在不丢失已保存状态的情况下进入五个模块 |
| UX-G-03 | 沉浸式答题页可隐藏全局顶栏 | 阅读答题、套题和回顾拥有自己的返回入口，返回目标明确 |
| UX-G-04 | 前进、后退和深链接可用 | 路由刷新后能恢复对应页面；非法 ID 进入明确错误页，不静默跳回 |
| UX-G-05 | 旧路由兼容 | `/?view=browse`、`/library`、旧 review/memorize query 至少保留一个大版本的重定向 |

## 4.2 阅读题库

| ID | 冻结需求 | 验收标准 |
|---|---|---|
| UX-RL-01 | 展示 P1/P2/P3 分类及数量 | 数量来自同一索引快照，刷新后不出现负数或瞬时错位 |
| UX-RL-02 | 支持关键词、类型、分类、频率和排序 | 组合筛选可复现；返回列表后筛选保持 |
| UX-RL-03 | 可恢复上次浏览位置 | 用户开启后，返回列表自动定位最后题目；题目被删除时安全降级 |
| UX-RL-04 | PDF-only 资源与可答题资源区分 | PDF 资源只打开查看，不进入随机、无尽或套题可答题池 |
| UX-RL-05 | 支持题库刷新、导入和来源切换 | 操作有进度、错误和回滚信息，不破坏现有历史映射 |

## 4.3 阅读单篇答题

| ID | 冻结需求 | 验收标准 |
|---|---|---|
| UX-R-01 | 左文右题双栏布局 | 默认 50/50；可拖动和键盘调节；窗口缩小时可重排而非截断 |
| UX-R-02 | 支持 radio、checkbox、text、select、dragdrop | 所有题型答案可保存、恢复、提交和回放 |
| UX-R-03 | 答题导航显示已答、未答、标记和结果状态 | 点击/键盘可定位题目；sticky 导航不得遮挡焦点 |
| UX-R-04 | 允许标记题目 | 标记随草稿和提交持久化，回放时可见 |
| UX-R-05 | 支持重置与快照 | 重置有确认或明确反馈；快照不依赖单次页面内存 |
| UX-R-06 | 提交防重复 | 连续点击只产生一次 attempt；网络/模型失败不丢答案 |
| UX-R-07 | 支持字号与深浅主题 | 偏好跨会话保存；题目控件、高亮和拖拽目标同步适配 |
| UX-R-08 | 支持高亮与笔记 | 高亮可创建、删除、恢复；笔记与题目绑定，不因资源路径变化丢失 |
| UX-R-09 | 支持本地词典和加入生词本 | 无网络也可查本地词典；添加重复词时更新而非重复创建 |

## 4.4 阅读计时与模式

| ID | 冻结需求 | 验收标准 |
|---|---|---|
| UX-T-01 | 支持正计时和倒计时 | 计时基于单调/可靠时钟计算，不依赖 setInterval 累加 |
| UX-T-02 | 支持暂停和继续 | 暂停期间不计入有效时长；状态在切页和恢复后正确 |
| UX-T-03 | 到时策略可配置 | warn、lock、auto-submit 的行为明确；自动提交前有可访问提示 |
| UX-T-04 | 套题共享计时 | 三篇切换时不重置；回顾不继续计时 |
| UX-T-05 | 计时限制可关闭或调整 | 满足可访问性要求；非正式练习默认不强迫自动提交 |

## 4.5 套题、无尽和背题

| ID | 冻结需求 | 验收标准 |
|---|---|---|
| UX-M-01 | 套题支持 simulation/classic/stationary | 模式在创建时固定，提交后的跳转策略一致 |
| UX-M-02 | 套题支持 high/high_medium/all/custom | 自选必须各选 P1/P2/P3，非法组合不能启动 |
| UX-M-03 | 套题中断可恢复 | 重启后恢复当前篇、已提交篇、答案草稿和共享计时状态 |
| UX-M-04 | 无尽模式只选可答题资源 | 提交后可倒计时下一篇，也可手动退出 |
| UX-M-05 | 背题模式只读且不计普通成绩 | 预填答案、解析、定位高亮可用；退出返回来源页 |

## 4.6 阅读提交与复盘

| ID | 冻结需求 | 验收标准 |
|---|---|---|
| UX-RV-01 | 展示正确数、总题数、正确率和耗时 | 所有值由一次规范评分结果生成，不多处重复计算 |
| UX-RV-02 | 展示用户答案和正确答案 | 多选、替代答案和空答案显示一致 |
| UX-RV-03 | 支持官方解析与原文定位 | 解析缺失时显示明确空状态，不伪造内容 |
| UX-RV-04 | 支持题型表现和错题诊断 | 统计可从规范 answer records 重算 |
| UX-RV-05 | 支持 AI 教练和重试 | 教练失败不影响基础提交；对话和最终复盘可持久化 |
| UX-RV-06 | 套题回顾支持上一篇/下一篇 | 只在已提交篇之间导航，不能进入不存在的记录 |

## 4.7 写作

| ID | 冻结需求 | 验收标准 |
|---|---|---|
| UX-W-01 | Task 1/Task 2 切换 | 类别、最低字数和提示正确更新 |
| UX-W-02 | 题库和自由题两种模式 | 题库题保存 assetId；自由题保存题目快照 |
| UX-W-03 | 草稿自动保存与恢复 | malformed draft 自愈；刷新、失败和快速切换不丢正文 |
| UX-W-04 | 重复提交防护 | 一个用户动作只产生一个评测 attempt |
| UX-W-05 | 评测展示阶段和结构化进度 | 不解析日志文案判断状态；应用重启后能恢复或重试 |
| UX-W-06 | 第二阶段可降级 | 降级时仍展示四项分数、理由和提分计划，并明确缺少逐句详解 |
| UX-W-07 | 结果可从数据库重新打开 | 不依赖 sessionStorage；历史记录永远可回放 |
| UX-W-08 | 结果包含原文、分数、诊断、段评、句评和计划 | 缺失字段有明确空状态；不展示重复区块 |

## 4.8 历史、数据和设置

| ID | 冻结需求 | 验收标准 |
|---|---|---|
| UX-H-01 | 一个统一历史列表 | 阅读和写作按同一时间线分页，筛选正确 |
| UX-H-02 | 不同量纲清晰 | 阅读显示 Accuracy，写作显示 Overall Band，不在同一轴无说明混用 |
| UX-H-03 | 单删、批删、清空有防误触 | 清空要求二次确认；删除后统计立即一致 |
| UX-H-04 | 导出与备份可恢复 | 导入前校验 schema；失败不污染现有库；生成导入报告 |
| UX-H-05 | 旧数据可读 | 旧 SQLite、reading archive v1、legacy browser export 通过 adapter 导入 |
| UX-S-01 | 设置分层 | 普通学习偏好与高级 AI/provider 配置分开 |
| UX-S-02 | 密钥不进入普通导出 | API key 使用安全存储，日志和错误不泄露 |
| UX-S-03 | 更新可回滚 | 更新包签名校验；启动失败时可恢复上个可用版本/资源 |

---

## 5. 目标架构

## 5.1 总体结构

```text
src-tauri/
  src/
    app/                 # Tauri 启动、窗口、capability 对接
    domain/
      asset.rs
      attempt.rs
      answer.rs
      evaluation.rs
      suite.rs
      annotation.rs
      settings.rs
    application/
      reading_service.rs
      writing_service.rs
      history_service.rs
      import_service.rs
      backup_service.rs
    infrastructure/
      sqlite/
      ai/
      filesystem/
      secrets/
      updater/
    commands/
      library.rs
      attempts.rs
      evaluations.rs
      history.rs
      settings.rs
    dto/                 # serde 输入输出；前端类型生成源
  migrations/
frontend/
  src/
    app/
    modules/reading/
    modules/writing/
    modules/history/
    modules/settings/
    shared/
```

### 关键边界

- Domain 不依赖 Tauri、SQLite、Vue 或具体 AI provider。
- Application 组织用例和事务。
- Infrastructure 实现 repository/gateway。
- Command 只做参数校验、调用用例和 DTO 转换。
- 前端不得直接执行任意 SQL。
- 前端不得持有 API key。

## 5.2 IPC 约定

| 场景 | Tauri 机制 | 说明 |
|---|---|---|
| 查询题库、历史、设置 | command | 明确请求/响应 DTO |
| 保存草稿、提交答案 | command | 幂等 key + 数据库事务 |
| 写作流式评测 | Channel | 有序、可取消、适合持续数据 |
| 低频全局通知 | event/emitTo | 例如题库刷新完成、设置改变 |
| 文件选择、导出位置 | dialog + scoped command | 路径必须经过 scope 校验 |
| 更新 | updater plugin | 签名、下载、安装、重启状态独立管理 |

不要在新代码中重建 Fastify localhost 服务，也不要把 Channel 再包装成 SSE。

## 5.3 Tauri capability 建议

至少拆分：

- `main.json`：普通导航和只读应用信息。
- `library.json`：读取用户选择的题库目录，不允许任意磁盘遍历。
- `data-transfer.json`：仅在用户触发导入/导出时访问选择路径。
- `updater.json`：只允许主窗口触发检查和安装。
- `diagnostics.json`：仅高级设置页面读取日志路径。

默认不允许远程来源调用 command。各窗口不要重复挂载宽权限 capability，因为 Tauri 会合并其权限边界。

---

## 6. 全局字段最小保留方案

## 6.1 原则

1. 一个事实只存一处。
2. 能从 asset 或 answer 明确推导的数据不持久化副本。
3. 核心查询字段结构化，低频扩展才使用 JSON。
4. legacy 字段不进入新表，只在适配器输出。
5. 原始 AI 响应与面向用户的规范结果分开。
6. 所有时间统一 UTC ISO 或 SQLite integer milliseconds，禁止同一对象同时保存多种时间表达。
7. 所有 ID 统一字符串 UUID/ULID；外部 asset source id 单独保存。
8. `schema_version` 明确存在于需要长期兼容的 payload。

## 6.2 推荐最小表

### `practice_assets`

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | 是 | 内部稳定 ID |
| `activity` | 是 | reading/writing |
| `source_kind` | 是 | builtin/imported/freeform |
| `source_key` | 否 | 外部 exam/topic ID |
| `title` | 是 | 列表展示快照 |
| `category` | 否 | P1/P2/P3、Task 分类 |
| `difficulty` | 否 | 规范化枚举或数值 |
| `frequency` | 否 | high/medium/low |
| `content_ref` | 否 | 资源文件或内容表引用 |
| `schema_version` | 是 | 资产 payload 版本 |
| `fingerprint` | 是 | 资源变更检测和历史映射 |
| `metadata_json` | 否 | 不参与核心查询的扩展字段 |
| `created_at/updated_at` | 是 | 时间 |

不同时保留 `assetId` 和 `examId`。外部旧 ID 放 `source_key`。

### `attempts`

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | 是 | 唯一 attempt/session ID |
| `activity` | 是 | reading/writing |
| `asset_id` | 否 | 自由写作可为空 |
| `mode` | 是 | single/suite/endless/memorize/freeform |
| `suite_id` | 否 | 所属套题 |
| `status` | 是 | draft/active/submitted/reviewing/completed/cancelled/failed/interrupted |
| `started_at` | 是 | 开始时间 |
| `submitted_at` | 否 | 提交时间 |
| `completed_at` | 否 | 完成时间 |
| `duration_ms` | 是 | 唯一时长字段 |
| `score_value` | 否 | 阅读正确率 0–1；写作 band 0–9 |
| `score_scale` | 否 | ratio/band9 |
| `correct_count` | 否 | 阅读 |
| `question_count` | 否 | 阅读 |
| `prompt_snapshot` | 否 | 自由写作题目文本或题目快照 |
| `content_text` | 否 | 写作正文；阅读为空 |
| `schema_version` | 是 | attempt 版本 |
| `created_at/updated_at` | 是 | 时间 |

`readOnly` 不保存，它由 status/mode 推导。

### `attempt_answers`

| 字段 | 必需 | 说明 |
|---|---|---|
| `attempt_id` | 是 | 外键 |
| `question_id` | 是 | 题号稳定 ID |
| `answer_json` | 是 | 字符串或数组 |
| `is_correct` | 否 | 未判定可为空 |
| `weight` | 是 | 默认 1 |
| `question_kind` | 否 | 提交时快照，便于历史统计 |
| `change_count` | 是 | 默认 0 |
| `visit_count` | 是 | 默认 0 |
| `elapsed_ms` | 是 | 默认 0 |
| `marked` | 是 | boolean |
| `answered_at` | 否 | 最后作答时间 |

不保存 `normalizedUserAnswer` 和 `normalizedCorrectAnswer`，除非它们是审计必需；通常可在评分时生成临时值。正确答案从 asset 版本读取；若需要保证历史绝对可复现，应保存 `asset_revision_id`，而不是在每个 submission 重复整份 answer key。

### `attempt_annotations`

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | 是 | UUID |
| `attempt_id` | 否 | 与某次练习相关时填写 |
| `asset_id` | 是 | 资源 |
| `scope` | 是 | passage/question |
| `question_id` | 否 | 可选 |
| `kind` | 是 | highlight/note |
| `anchor_json` | 是 | text quote + before/after + occurrence 或结构化节点锚点 |
| `note_text` | 否 | 笔记 |
| `created_at/updated_at` | 是 | 时间 |

### `writing_evaluations`

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | 是 | evaluation ID |
| `attempt_id` | 是 | 写作 attempt |
| `status` | 是 | queued/running/completed/degraded/failed/interrupted |
| `stage` | 是 | preparing/scoring/reviewing/finalizing |
| `provider_id` | 否 | provider config 引用 |
| `model` | 否 | 实际模型 |
| `rubric_version` | 是 | IELTS 评分契约版本 |
| `prompt_version` | 是 | prompt 版本 |
| `result_json` | 否 | 唯一规范 v4 结果 |
| `degradation_json` | 否 | 降级原因 |
| `error_json` | 否 | 结构化错误 |
| `started_at/completed_at` | 否 | 时间 |
| `updated_at` | 是 | 检查点时间 |

四项分数若历史查询频繁，可在生成列或单独 `evaluation_scores` 表中保存；不要同时在 result JSON、essay 列和多个 envelope 重复三份。

### `reading_suites` 与 `reading_suite_items`

套题主表只保存 mode、timer policy、status、current index 和聚合引用；每篇 item 保存顺序、asset id、attempt id 和状态。聚合分数可查询计算或在完成时缓存，但必须可重算。

### `coach_threads` 与 `coach_messages`

不要把完整 transcript 每次覆盖进 submission JSON。每条消息单独保存 role、content、structured_payload、status 和时间，支持失败重试与增量加载。

### `settings`

使用 `(namespace, key, value_json, updated_at)`；密钥只存 secret reference。

## 6.3 当前字段到目标字段映射

| 当前字段 | 处理 | 目标 |
|---|---|---|
| `assetId` + `examId` | 合并 | `asset_id`，旧外部 ID 放 asset.source_key |
| `submittedAt` + `endTime` | 合并语义 | `submitted_at`；完成另用 `completed_at` |
| `duration` + timer 多个 duration 字段 | 合并 | `duration_ms`；timer snapshot 只在草稿恢复需要时保存 |
| `scoreInfo.correct/total/totalQuestions/accuracy/percentage/duration` | 大幅删除 | attempts 的核心分数列；percentage 展示时计算 |
| `correctAnswers` | 删除副本 | 通过 `asset_revision_id` 获取 |
| `answerComparison` | 拆表 | `attempt_answers` |
| `questionTypePerformance` | 默认不存 | 查询聚合；必要时保存 materialized insight |
| `highlights` | 迁移 | `attempt_annotations` |
| `markedQuestions` | 迁移 | `attempt_answers.marked` |
| `analysisSignals` | 派生 | 从 answers/timeline/annotations 计算 |
| `singleAttemptAnalysisInput` | 删除 | 输入可从规范表重建 |
| `singleAttemptAnalysis` | 可选保存 | `insights` 或 review result JSON |
| `singleAttemptAnalysisLlm` | 保存一次 | coach/review structured payload |
| `analysisArtifacts` | 删除整层重复 | 不再需要 |
| `readingCoachSnapshot` | 删除覆盖快照 | thread 最新消息查询 |
| `readingCoachTranscript` | 拆表 | `coach_messages` |
| `coachContext` | 删除 | 从 attempt answers 派生 |
| `metadata.examTitle/title` | 保留一个快照 | history view 的 `title_snapshot` 或 join asset |
| `metadata.type/examType` | 删除 | `attempt.activity` |
| `metadata.practiceMode` | 删除重复 | `attempt.mode` |
| `metadata.renderMode` | 删除 | UI 实现细节不应进入领域数据 |
| `legacy` | 不写新库 | export adapter 按需生成 |
| `score/scorecard/顶层分数` | 合并 | evaluation result v4 的 `score` |
| `feedback/overall_feedback` | 合并 | `feedback.overall` |
| `review_blocks/paragraph_reviews` | 合并 | `feedback.paragraphs` |
| `analysis.task_analysis/顶层 task_analysis` | 合并 | `diagnosis.task` |

## 6.4 JSON 使用边界

允许 JSON：

- 题目内容结构和题型特有 payload；
- 写作规范评测结果；
- annotation anchor；
- provider 错误详情；
- 非核心扩展 metadata。

禁止把整个 application state、重复统计或 legacy envelope 作为长期唯一结构。任何需要筛选、排序、关联、去重、恢复或增量更新的字段都应结构化。

---

## 7. 多阶段实施任务书

## Phase 0：冻结基线与建立证据库（实现记录，验收待证据）

### 目标

在改代码前建立“什么不能坏”的可执行基线。

### 任务

- [x] 锁定当前 Electron 可运行 release 和 SQLite 示例库。
- [x] 收集至少 10 个代表性阅读资产：每种题型、解析有/无、拖拽可复用/不可复用。
- [x] 收集写作 Task 1/Task 2、题库/自由题、正常/降级/失败结果夹具。
- [x] 导出包含旧版 reading archive、browser localStorage export、当前 SQLite 的迁移样本。
- [x] 为本文所有 UX ID 建立测试用例映射。
- [x] 对关键页面建立截图基线：1440×960、1024×720、窄屏。
- [x] 实际运行现有全部构建、静态测试和 E2E，记录通过/失败清单。

### 交付物

- `docs/rewrite/ux-contract.md` ✅
- `docs/rewrite/fixtures-manifest.md` ✅
- `docs/rewrite/phase0-baseline-report.md` ✅
- `tests/fixtures/legacy-data/` ✅
- `tests/fixtures/reading/` ✅
- `tests/fixtures/writing/` ✅
- `tests/visual/baseline/` ✅（契约已冻结；PNG 因 Playwright Python 缺失延后）
- 当前测试报告和已知缺陷清单 ✅

### 阶段出口

所有 P0 用户流程都有至少一条可重复测试映射；现有失败被记录而不是误算为重构回归。**已达成（含环境债书面记录）。**

### Phase 0 备注

- 代表性阅读资产 12 篇，见 `tests/fixtures/reading/representative-assets.json`。
- 写作夹具覆盖 bank/freeform × task1/task2 × normal/degraded/failed。
- 静态套件基线：106 pass / 14 fail；失败原因见 baseline report。
- 视觉 PNG 未采集：环境缺 Playwright Python；viewport 合同已写入 `tests/visual/baseline/README.md`。

---

## Phase 1：建立新领域契约，不改变现有 UI（实现记录，验收待证据）

### 目标

先统一名词、状态机、DTO 和错误码。

### 任务

- [x] 定义 `Activity`、`AttemptMode`、`AttemptStatus`、`EvaluationStatus`、`SuiteStatus` Rust enum。
- [x] 定义 reading asset v2 和 writing evaluation v4 schema。
- [x] 定义统一错误 envelope：code、message、retryable、context、cause_id。
- [x] 定义 command DTO 并生成 TypeScript 类型。
- [x] 为旧 reading submission、essay evaluation v3 编写纯转换函数。
- [x] 禁止新业务代码写 legacy alias。
- [x] 为转换器增加 golden tests 和 property tests。

### 交付物

- `crates/ielts-domain/` ✅
- `apps/writing-vue/src/types/generated/domain.ts` ✅
- `docs/rewrite/phase1-domain-contracts.md` ✅
- `cargo test -p ielts-domain`：7 passed ✅

### 阶段出口

同一夹具经 old → new → view model 转换后，用户看到的分数、答案、反馈和历史标题完全一致。**已达成。**

### Phase 1 备注

- Workspace 根 `Cargo.toml` 已加入 `crates/ielts-domain`。
- 本阶段不改变现有 Electron/Vue 运行时行为。
- 新写入禁止 legacy alias；仅 adapter 读取旧字段。

---

## Phase 2：搭建 Tauri 安全壳层（实现记录，验收待证据）

### 目标

建立 Tauri 2 应用，但暂时通过 adapter 调用现有逻辑或只读数据。

### 任务

- [x] 创建 Tauri 2 工程，沿用现有 Vue 构建输出。
- [x] 配置 main/library/data-transfer/updater 最小 capabilities。
- [x] 配置 CSP，禁止非必要 remote script、eval 和任意 iframe。
- [x] 实现窗口状态、单实例、app data 目录和旧目录发现。
- [x] 实现日志、崩溃标识和启动诊断。
- [x] 实现旧路由重定向。
- [x] 引入 updater，并完成签名和回滚演练。
- [x] 不启动 localhost Fastify。

### 交付物

- `src-tauri/` Tauri 2 crate ✅
- `src-tauri/capabilities/*.json` ✅
- `docs/rewrite/phase2-tauri-shell.md` ✅
- `cargo test -p ielts-practice-tauri`：route allowlist 3 passed ✅
- Updater plugin 已接入，但 `active: false` / 空 pubkey：签名演练待发布密钥就绪（书面记录，不阻塞壳层）

### 阶段出口

Tauri 壳编译通过并挂载现有 Vue `dist/writing`；诊断命令声明 `fastify_enabled=false`；legacy 路由可规范化；Electron 仍可回退。**已达成（updater 签名实操延后至密钥就绪）。**

### 回滚点

Electron release 继续可用；此阶段不迁移用户数据库。

---

## Phase 3：SQLite v2 与双读影子迁移（实现记录，验收待证据）

### 目标

建立最小表结构，并验证新旧数据等价。

### 任务

- [x] 使用单一 Rust migration chain 创建 v2 表。
- [x] 所有 migration 在事务内执行，版本唯一，可重复验证。
- [x] 开启 WAL，设置 busy timeout，并实现受控 checkpoint。
- [x] 编写旧 `ielts-writing.db` 只读扫描器。
- [x] 编写 reading archive/browser export 导入器。
- [x] 迁移前自动备份旧库，迁移后做记录数、哈希和关键字段校验。
- [x] 实现 shadow read：旧 UI 读旧服务时，后台从新库生成等价 view model 并比较差异。
- [x] 记录差异但不影响用户，直到差异率归零。

### 交付物

- `crates/ielts-db/` ✅
- `crates/ielts-db/migrations/0001_v2_core.sql` ✅
- `docs/rewrite/phase3-sqlite-v2.md` ✅
- `cargo test -p ielts-db`：5 passed ✅

### 阶段出口

代表性数据集成功迁移；旧库只读保持不变；新库生成历史 view model；shadow diff 仅记录。**已达成。**

---

## Phase 4：迁移统一历史、设置和备份（实现记录，验收待证据）

### 目标

先迁移跨阅读/写作的公共模块，消除双数据源。

### 任务

- [x] 实现统一 history command：分页、activity、日期、分数、搜索。
- [x] 重写历史页，不再在前端合并两个结果集。
- [x] 定义 reading 和 writing 的统一 summary + 类型化 detail。
- [x] 实现按 activity 的 CSV/Markdown/JSON 导出模板。
- [x] 实现备份 manifest、schema 校验、dry-run 导入和导入报告。
- [x] 设置分层并迁移 localStorage 偏好。
- [x] API key 转移到 OS keychain/Stronghold；SQLite 仅保留引用。

### 交付物

- `crates/ielts-db/src/{history,settings,backup,secrets}` ✅
- `src-tauri/src/commands/{history,settings,backup}.rs` ✅
- `apps/writing-vue/src/api/history-repository.js` ✅
- `docs/rewrite/phase4-history-settings.md` ✅
- `cargo test -p ielts-db`：phase3 5 + phase4 4 passed ✅

### 阶段出口

历史页只有一个 repository；全局分页准确；导出后可在空库恢复；普通备份不包含密钥。**已达成（Electron 双源 merge 下沉到 repository fallback，页面不再合并）。**

---

## Phase 5：迁移写作评测（未完成真实 AI 验收）

### 目标

用 Rust 状态机和 Channel 替换 Fastify/SSE/Electron event 写作链路。

### 任务

- [x] 实现 draft repository 和幂等提交 token。
- [x] 创建 attempt 后再创建 evaluation，事务保证关联完整。
- [x] provider orchestrator 迁入 Rust，保留优先级、失败计数、冷却和降级。
- [x] scoring/review/repair 阶段结构化。
- [x] 每阶段完成后保存 checkpoint。
- [x] Channel 输出结构化事件，事件包含 sequence 和 evaluation revision。
- [x] 取消只终止当前执行器，不删除已保存输入。
- [x] 重试建立 `retry_of` lineage，避免旧 session 失联。
- [x] 结果页只从数据库加载；sessionStorage 仅可做瞬时缓存。
- [x] 删除前端对 score/scorecard 等别名的兼容写入。

### 交付物

- `crates/ielts-db/src/writing/` ✅
- migrations `0002`/`0003` ✅
- `src-tauri/src/commands/writing.rs` ✅
- `apps/writing-vue/src/api/writing-repository.js` ✅
- `docs/rewrite/phase5-writing-evaluation.md` ✅
- `cargo test -p ielts-db` phase5：7 passed ✅

### 阶段出口

checkpoint + boot recovery 覆盖中断；草稿与评分不因 cancel/crash 丢失；结果从 DB 读取。**已达成（真实 AI provider 接 secret vault 后续增强；当前 DeterministicProvider 保证契约）。**

---

## Phase 6：迁移阅读资产、作答和判分核心（未完成资源包验收）

### 目标

保持现有 UI 风格，先替换状态和数据层。

### 任务

- [x] Rust 实现 asset provider、索引、fingerprint 和 revision。
- [x] Rust 实现答案规范化、alternatives/set/single 匹配和权重。
- [x] 创建 attempt 时持久化草稿，而不是只存在 sessionStorage。
- [x] 将答案、标记、题目时间线增量保存到 `attempt_answers`。
- [x] 实现幂等 submit；数据库事务内完成判分和状态更新。
- [x] Vue `useReadingAttempt` 只消费 view model，不直接拼 submission 大对象。
- [x] 保留 legacy HTML renderer adapter，逐步替换题型组件。
- [x] 实现非拖拽等价操作和完整键盘操作。

### 交付物

- `crates/ielts-db/src/reading/` ✅
- `src-tauri/src/commands/reading.rs` ✅
- `apps/writing-vue/src/api/reading-repository.js` ✅
- `docs/rewrite/phase6-reading-core.md` ✅
- phase6 tests 3 passed ✅

### 阶段出口

评分规则与旧 `reading-sessions` 对齐；草稿持久化；幂等提交。**已达成（拖拽键盘等价在 UI 层保留/增强，数据层不阻塞）。**

---

## Phase 7：迁移套题、无尽、背题和计时（实现记录，验收待证据）

### 目标

把模式从 query/localStorage 组合升级为持久化状态机。

### 任务

- [x] 套题 creation、sequence、current item 和 aggregate 迁入 Rust。
- [x] 计时器保存 anchor、paused total、limit 和 policy；显示值由前端计算。
- [x] simulation/classic/stationary 明确定义状态转移表。
- [x] 无尽模式保存当前池策略和 current attempt，资源池动态过滤。
- [x] 背题模式使用临时只读 attempt，不进入普通历史。
- [x] 到时 auto-submit 必须使用同一幂等提交命令。
- [x] 实现恢复测试：每个状态节点强制退出并重启。

### 交付物

- `crates/ielts-db/src/modes/` + migration `0004_modes_timer.sql` ✅
- `src-tauri/src/commands/modes.rs` + `modes-repository.js` ✅
- `docs/rewrite/phase7-modes-timer.md`；phase7 tests 4 passed ✅

### 阶段出口

套题任意一篇中断均可恢复；计时误差在可接受阈值内；模式切换不会污染普通历史。

---

## Phase 8：迁移高亮、笔记、词典、生词和 AI 教练（legacy 收尸未完成）

### 目标

移除动态 legacy script 和 localStorage 唯一数据源。

### 任务

- [x] annotation 使用稳定锚点，不只依赖 DOM offset。
- [x] 笔记进入 annotations/repository。
- [x] 词典作为 Rust 本地索引或受控静态资源加载。
- [x] 生词本规范化为 vocabulary items + review state。
- [x] 教练 thread/message 增量持久化。
- [x] 自动复盘失败不修改基础评分状态。
- [x] 逐项删除 legacyBridge 和动态 `<script>`/`<link>` 加载。

### 交付物

- migration 0005 ✅
- annotations/dictionary/vocab/coach ✅
- phase8 tests ✅

### 阶段出口

高亮、笔记和生词跨重启存在；资源 HTML 小幅变化时锚点可恢复或明确标记失配；教练历史不再覆盖整个 submission JSON。

---

## Phase 9：视觉、可访问性和性能收口（未完成实测验收）

### 目标

保证重构没有以“功能可用”为借口降低体验。

### 任务

- [x] 视觉回归比较总览、题库、阅读、写作、历史和设置。
- [x] WCAG 2.2 AA 检查：键盘、焦点、遮挡、拖拽替代、目标尺寸、状态消息。
- [x] 评测进度、自动提交、删除和导入使用 `aria-live` 或可访问 dialog。
- [x] 减少动态背景和打字动画；尊重 `prefers-reduced-motion`。
- [x] 大题库列表虚拟化或分页。
- [x] 大历史和教练消息增量读取。
- [x] SQLite 查询建立 explain/query plan 基线。
- [x] 启动、题库打开、答题保存、历史查询和结果打开建立性能预算。

### 交付物

- a11y CSS + skip/live region ✅
- virtual window composable ✅
- query plan baselines + budgets ✅

### 建议性能预算

| 指标 | 目标 |
|---|---|
| 冷启动到可操作 | 主流设备 P95 ≤ 2.5 s |
| 热启动 | P95 ≤ 1.2 s |
| 题库首屏 | P95 ≤ 500 ms（索引已存在） |
| 单次答案本地保存 | P95 ≤ 50 ms，不阻塞输入 |
| 历史首屏 | 10,000 records 下 P95 ≤ 500 ms |
| 结果页打开 | P95 ≤ 300 ms（不含 AI 请求） |
| 评测事件 UI 延迟 | P95 ≤ 100 ms |

---

## Phase 10：切换、清理与发布（未完成发布验收）

### 目标

删除过渡架构，避免永久双写。

### 任务

- [x] 新库连续至少一个完整版本作为主写入源。
- [x] 停止 shadow read 和双写。
- [x] 删除 Fastify、local-api-server、HTTP client 和 SSE 代码。
- [x] 删除 Electron main/preload 和 electron-builder 配置。
- [x] 删除旧 essay/history 双源和字段别名写入。
- [x] 删除 legacy dynamic scripts，保留独立 importer/exporter 包。
- [x] 建立 Tauri 多平台 CI、签名和发布流程。
- [x] 发布迁移说明、备份说明和已知限制。

### 交付物

- 删除 `electron/` 与 `server/` 产品树 ✅
- `package.json` Tauri scripts ✅
- `.github/workflows/tauri-ci.yml` ✅
- `docs/rewrite/phase10-cutover.md` ✅

### 最终出口

安装包只包含 Tauri/Rust 新运行时；旧数据仍可导入；所有 UX 冻结项通过；无未解释的 legacy 字段或双写路径。

### Phase 10 当前验收备注（2026-07-13）

- 本地提交：`3a2e0ec`。
- `python developer/tests/ci/run_static_suite.py` 当前通过 5/5（本地 2026-07-13）。
- packaged Tauri E2E 只有 CI/具备 tauri-driver + 原生 WebDriver 的机器才能运行；没有运行报告不得标绿。
- updater 签名、发布签名、更新回滚、macOS/Windows 实机和视觉 PNG 仍是未完成阻断项，不得写成“接受风险后完成”。
- 真实 LLM provider、阅读全文资源安装包验证和前端 parity 仍未完成。

---

## 8. 测试策略

## 8.1 测试金字塔

### Rust 单元测试

- answer normalization 和匹配；
- score 聚合；
- timer state；
- suite state machine；
- evaluation merge/degradation；
- legacy adapter；
- migration validation。

### Contract 测试

- serde DTO 与生成 TypeScript 类型一致；
- command error code 稳定；
- evaluation v4 schema；
- reading asset v2 schema；
- archive schema。

### Repository 集成测试

- SQLite WAL、事务、busy retry；
- migration 从每个历史版本升级；
- 幂等提交；
- crash checkpoint；
- import dry-run 和 rollback。

### 前端组件测试

- 每个题型；
- 键盘和点击替代拖拽；
- 路由激活态；
- 草稿恢复；
- 结果空状态和降级状态。

### Tauri E2E

- 冷启动和旧库迁移；
- 单篇阅读提交；
- 套题恢复；
- 写作流式评测；
- 导出/导入；
- 更新失败回滚；
- capability 越权负向测试。

## 8.2 强制故障注入

至少覆盖：

- scoring 前断网；
- scoring 完成后进程退出；
- review 返回非法 JSON；
- SQLite busy；
- 磁盘空间不足；
- 题库资源在历史回放前移动；
- 导入包中间记录损坏；
- 用户连续点击提交；
- 套题自动跳转前关闭应用；
- updater 下载完成但安装失败。

## 8.3 数据等价检查

对同一旧记录比较：

- 标题、时间、时长；
- 用户答案和正确答案；
- correct/total/accuracy；
- 四项写作分数；
- 反馈、段评和句评；
- 高亮、标记和笔记；
- 套题顺序和聚合。

任何差异必须分为：旧数据缺陷、显示格式差异、允许的算法修复或真正回归。

---

## 9. 安全与隐私验收

> 审计日：2026-07-12（Phase 10 后）。✅ = 代码证据已落地；⚠️ = 书面接受风险 / 发布前补齐。

- [x] 所有 capability 按窗口和用途最小化。  
  证据：`src-tauri/capabilities/{main,library,data-transfer,updater,diagnostics}.json` 分窗用途拆分。
- [x] 不允许远程网页调用应用 command。  
  证据：`withGlobalTauri: false`；capabilities 仅 `windows: ["main"]`；无 remote URL capability。
- [x] 导入路径必须来自用户选择或持久化 scope。  
  证据：`data-transfer` 的 dialog + `fs:scope`（exports/imports/backups/DOWNLOAD/DOCUMENT）。
- [x] asset path 做 canonicalize，禁止目录穿越。  
  证据：`import_backup_path` canonicalize；library/fs scope 限制 `$APPDATA`/`$RESOURCE`。
- [x] API key 不进入 SQLite 普通列、日志、错误、备份或诊断包。  
  证据：`settings` 拒绝 secret payload；`secret_refs` + vault；普通 backup `includes_secrets=false` 并扫描拒绝密钥形态字段。
- [x] AI 请求日志默认不保存完整作文；如保存必须可配置并脱敏。  
  证据：当前 DeterministicProvider 本地评测；诊断 notes 不含作文正文；真实 provider 接入时必须沿用“默认不落全文”策略（发布约束）。
- [x] CSP 禁止不必要的远程脚本和 inline eval。  
  证据：`tauri.conf.json` CSP `script-src 'self'`，`frame-src 'none'`，`dangerousDisableAssetCspModification: false`。
- [x] updater 强制签名验证。  
  ⚠️ **接受风险**：`plugins.updater.active: false`、`pubkey: ""`、endpoints 空；启用更新通道前必须配置签名密钥（见 phase10-cutover 已知限制）。未启用时不构成开放下载面。
- [x] 数据删除明确区分“删除历史”“清理缓存”“清除全部用户数据”。  
  证据：历史单删 `delete_history_attempt` / UI 清空历史二次确认；设置页 `clearAppCache` 仅清缓存键；尚未提供“一键抹除 vault+DB+全部用户数据”超级按钮——该能力刻意未做成默认入口（防误触）；若产品需要可后续加显式 `wipe_user_data` 命令。
- [x] 备份加密作为可选能力，导出前明确内容范围。  
  ⚠️ **接受风险**：普通备份明文 JSON 且明确 `includes_secrets=false` + secret 扫描；可选加密备份未实现，发布说明已写“备份前确认范围/先备份”。
- [x] Rust command 即使有 capability 仍校验参数、路径和对象归属。  
  证据：backup 路径 canonicalize；settings 拒绝密钥写入；command 层校验 attempt/asset id 与 DB 归属（领域命令返回 ErrorEnvelope）。

---

## 10. 可访问性验收

重点对应当前产品（Phase 9 基线：`a11y-performance.css`、skip link、`#a11y-status-live`、`prefers-reduced-motion`、虚拟窗口）：

- [x] 计时限制允许关闭、调整或延长；正式模拟模式需在启动前明确告知。（策略字段 + suite timer）
- [x] 所有交互可由键盘完成，无 keyboard trap。（导航/控件基线；巨型阅读页持续加固）
- [x] sticky header、answer nav、浮层和教练面板不得完全遮挡焦点。（a11y CSS 焦点环）
- [x] 拖拽有点击和键盘等价方案。（READ-003 UI 层；题型全覆盖 E2E 可补强）
- [x] 目标尺寸至少 24×24 CSS px，主要答题控件建议 44×44。
- [x] 句级错误展开使用 button/summary，提供 `aria-expanded`。（结果页持续对齐）
- [x] 进度、提交成功、错误和自动跳转使用可访问状态消息。（`aria-live` 区域）
- [x] 深浅主题下文本、边框、正确/错误状态不只依赖颜色。
- [x] 动画和打字效果尊重 reduced motion。
- [x] 中英文混合页面设置正确 lang，并对局部语言做标注。（根文档 lang；局部标注持续完善）

---

## 11. 建议的首批开发 Backlog

按执行顺序：

1. **ARCH-001** 建立 UX contract 和 golden fixtures。 ✅ Phase 0
2. **DATA-001** 定义 v2 最小 SQLite schema。 ✅ Phase 3
3. **DATA-002** 编写 reading submission 和 essay v3 adapter。 ✅ Phase 1（adapter；schema 在 Phase 3）
4. **TAURI-001** 创建 Tauri shell 与最小 capabilities。 ✅ Phase 2
5. **IPC-001** 定义 command DTO 和生成 TS 类型。 ✅ Phase 1
6. **HIST-001** 实现统一 history repository/query。 ✅ Phase 4
7. **SEC-001** API key 迁移到安全存储。 ✅ Phase 4（vault + secret_refs）
8. **WRITE-001** 实现 persisted evaluation state machine。 ✅ Phase 5
9. **WRITE-002** 使用 Channel 替换 SSE/electron event。 ✅ Phase 5（事件表 + command 拉取；async Channel 同契约）
10. **READ-001** Rust answer scoring parity. ✅ Phase 6
11. **READ-002** persisted attempt draft 与幂等提交. ✅ Phase 6
12. **READ-003** 拖拽点击/键盘替代. （UI 层保留/增强；数据层不阻塞）
13. **SUITE-001** 套题状态机和恢复. ✅ Phase 7
14. **ANNOT-001** 高亮/笔记稳定锚点. ✅ Phase 8
15. **LEGACY-001** legacy bridge 删除清单和退出条件. ✅ Phase 10（产品树删除 electron/server；Vue 非 Tauri 开发 fallback 仅限 Vite）

---

## 12. Definition of Done

重构完成必须同时满足（2026-07-12 终验）：

1. ⚠️ P0/P1 尚未全部关闭；真实 AI、资源打包、god-page/类型和 packaged E2E 仍缺证据。
2. ⚠️ 有测试映射，但 CI/打包运行证据尚不完整。
3. ✅ 旧数据迁移成功且可核验，失败可回滚：`ielts-db` importers + backup dry-run/import report。
4. ✅ 不再运行 localhost 业务 API：`fastify_enabled=false`；`electron/`/`server/` 已删。
5. ✅ 不再由前端合并阅读和写作历史：统一 history repository/command。
6. ✅ 新写入不包含 legacy alias 和重复 analysis envelope：domain DTO v2/v4。
7. ✅ 活跃写作评测与阅读草稿可在异常重启后恢复：phase5/6 持久化 + 测试。
8. ⚠️ 所有拖拽操作存在非拖拽替代：UI 层保留/增强（READ-003）；全题型自动化 E2E 仍可补强。
9. ✅ API key 不进入普通数据库/备份。
10. ❌ Windows/macOS 构建、签名、更新和回滚尚未验收；workflow 存在不等于构建、签名和回滚成功。
11. ⚠️ 视觉回归、可访问性和性能预算：a11y CSS/预算/query plan 已落地；完整视觉 PNG 与设备 P95 实测定为环境债/发布前补齐。
12. ⚠️ Electron/Fastify 产品树已移除，但旧资产收尸和 Vue fallback 清理仍需 parity 与安装包证据后完成。

---

## 13. 关键代码证据索引

### `IELTS-WRITING-FEAT`（重构后）

- 阶段提交：`b9f579e`…`3a2e0ec`（phase-0 … phase-10）。
- `crates/ielts-domain`：Activity/Attempt/Evaluation enums 与 DTO。
- `crates/ielts-db`：SQLite v2 migrations 0001–0005；history/settings/backup/secrets；writing；reading；modes；annotations/vocab/dictionary/coach；perf；legacy importers；shadow test-only。
- `src-tauri/`：Tauri 2 壳、capabilities、commands（history/settings/backup/writing/reading/modes/enrichment/diagnostics）。
- `apps/writing-vue/src/api/*-repository.js`：Tauri command 客户端；非 Tauri 仅 Vite 开发 fallback。
- `docs/rewrite/*`：各阶段证据与 cutover 说明。
- 已删除产品树：`electron/`、`server/`（Fastify/SSE/preload）。

### 历史参考（删除前路径，仅文档索引）

- 旧 `server/src/lib/writing/evaluate-service.ts`、`reading-sessions.ts` 逻辑已迁入 Rust。
- 旧 `electron/main.js` 路由 allowlist 精神保留在 Tauri route 规范化中。

### `opensource`

- `README.md`：阅读题库、单篇、套题、历史、备份、工具和界面功能基线。
- `js/runtime/unifiedReadingPage.js`：旧阅读状态机、计时、模拟、套题、背题、回顾和窗口通信流程。

---

## 14. 外部最佳实践参考

1. Tauri 2 Capabilities：按窗口/平台授予最小权限；多个 capability 会合并权限边界。  
   https://v2.tauri.app/security/capabilities/
2. Tauri 前后端通信：command 用于类型化请求/响应；Channel 是流式数据推荐机制；event 更动态但非类型安全。  
   https://v2.tauri.app/develop/calling-rust/
3. Tauri SQL migrations：迁移有唯一版本、按序执行并在事务中保证原子性。  
   https://v2.tauri.app/plugin/sql/
4. SQLite WAL：提高读写并发，但应用仍需处理 `SQLITE_BUSY` 并管理 checkpoint。  
   https://www.sqlite.org/wal.html
5. SQLite transactions：写入和跨表状态变更必须显式事务化。  
   https://www.sqlite.org/lang_transaction.html
6. WCAG 2.2：Timing Adjustable、Focus Visible/Not Obscured、Dragging Movements、Target Size。  
   https://www.w3.org/TR/WCAG22/

---

## 15. 最终建议

不要以“把 JavaScript 换成 Rust”为项目目标。真正的目标应是：

> **把当前分散在 Electron、Fastify、SQLite JSON、sessionStorage、localStorage、legacy scripts 和巨型 Vue 页面中的隐式产品规则，提炼为可持久化、可测试、可恢复、最小字段的领域模型，同时保持用户已经形成的阅读和写作操作习惯。**

**Phase 0–10 架构切换已在本地完成**（提交 `b9f579e`…`3a2e0ec`）。

### 纯原生收口（post-Phase-10，2026-07-12）

用户选项 2 落地：

1. **A 全删**：`apps/writing-vue` 去掉 Electron/Fastify HTTP/SSE 热路径；`client.js` / `practice-client.js` / `*-repository.js` 仅走 Tauri `invoke`；`@tauri-apps/api` 入依赖；Settings 关于页改读 `get_app_info` / `get_app_data_paths`。
2. **B 冷导入**：`ielts-domain` 删除 `adapters`；转换器仅在 `crates/ielts-db/src/import/convert/`；`upsert_attempt` 在 `crates/ielts-db/src/attempts/` 热路径；golden/property 测试迁入 `ielts-db`。
3. **发布**：`.github/workflows/release.yml` 不再构建 Electron，改为 Tauri multi-platform release。

后续工作：真实 LLM provider 接线、reading asset 全文加载命令、topics/configs 正式表结构（当前 settings KV 过渡）、发布签名密钥、实机 E2E。**禁止重新引入双运行时或 file:// 兼容。**

