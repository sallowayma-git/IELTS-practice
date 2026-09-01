# Handoff: Agent 界面前端显示 + 后端逻辑(2026-08-30)

> 交接来源:UI 打磨会话(zcode,批次1-5 完成并提交)+ 后端审计会话(Phase 1 审计完成,修复未开始)。
> 本文档自包含,可直接作为新会话的起点。

## 0. 一句话任务

`/agent` 页(AgentConsolePage)当前是「编译器 Context Pack 预览 + localStorage 自造语义 + 裸 JSON」的混搭;后端 Agent 调用链(执行/checkpoint/取消/planner)整体未接线。你的任务:**先修后端契约与调用路径,再让前端消费正确的产品级读 API**。审计结论已备好,不要从前端黑盒猜测。

## 1. 仓库与架构事实

- 分支 `IELTS-WRITING-FEAT`,最近两笔提交:
  - `ff31bbca feat(ui): consolidate design system and polish reading/agent surfaces`(设计系统收束,静态 27/27 + E2E 16/16)
  - `25c954b3 wip(agent): land JournalFacts contract fixes and backend audit findings`(后端审计 WIP)
- 产品宿主:**Tauri 2 + Rust domain/SQLite**(`src-tauri/` 命令层,`crates/ielts-domain` 契约,`crates/ielts-db` 持久化,`crates/ielts-application` 服务层)。Electron/Fastify 已删除,不要复活。
- 认知编排:**Python sidecar**(`agent-runtime-python/src/ielts_agent/`),经 `src-tauri/cognitive_runtime.rs` 反向 RPC。**Rust 拥有真相/工具/持久化,Python 拥有认知编排**(计划 v1.3 ch.14/17/21 是实现权威:`developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md`)。
- 前端:`apps/writing-vue/`(Vue 3 + vue-router,无 UI 库)。设计系统四层:`src/styles/design-system/`(tokens→exam-theme→aliases→base)→ `opensource-skin.css` → 页面。
- 测试(每次改动后必须按序跑):
  ```bash
  python developer/tests/ci/run_static_suite.py      # 27 项,含 cargo test + Python 契约 + shell 契约
  python developer/tests/e2e/suite_practice_flow.py  # packaged Tauri E2E,16 项检查
  ```

## 2. 冻结约束(勿违反)

1. **EvaluatingPage.vue 冻结**,用户明确不改。
2. **E2E 钉死的选择器/英文 metadata 不能破坏**:`.agent-output-metadata dt/dd`(Run ID)、`.agent-run-steps`(read_file 文本)、`.agent-page-header__status` 的 `is-complete`/`is-error`、`[data-agent-console]`、`details[data-agent-workspace]`、`.agent-workspace-select`、`.agent-run-button`。见 `developer/tests/e2e/packaged_tauri_flow.py:700-810`。
3. Shell 契约测试 `developer/tests/js/practiceVueShell.test.js` 含「禁止裸 JSON」「workbench 三栏 grid」断言,改前端前先读它。
4. 设计系统纪律:新样式用 `--anth-*` token;`--lg-*` 已冻结禁止新增;考试皮肤 token 在 `exam-theme.css`(第二主题,勿折回陶土色)。z-index 只能用 `--anth-z-*` 七层。
5. 不改 M1/M2 冻结 schema;不做「往 UI 塞更多 JSON」式修复——修 UI 该调的后端契约。
6. 不提交 `.zcode/`;`agent-runtime-python/tests/__pycache__/` 不入库。
7. 沟通契约:按 AGENTS.md,先复述需求待确认;分析用【核心判断/关键洞察/Linus式方案】结构。

## 3. 前端现状(Agent 控制台)

文件结构(批次5 刚落地):
- `apps/writing-vue/src/views/AgentConsolePage.vue`(~1550 行,scoped 样式)
- `apps/writing-vue/src/modules/agent-console/format.js` — journal/memory/approval/evidence 的中文格式化(消灭 `{{ object }}` 裸 JSON 的唯一出口)
- `apps/writing-vue/src/modules/agent-console/styles/console.css` — 心跳/计划/演化卡 + `.agent-workbench` 三栏(陶土 token)

已知前端问题(都是后端契约缺位的症状):
- `AgentConsolePage.vue:292-295` 把 **thread id 当 plan id** 传给 `listStudyPlanItems(planThread.id)`,而 `ielts-domain/src/agent_thread.rs` 注释明确 "Plan IDs are not thread IDs";`.catch(()=>[])` 掩盖了错误 → 计划面板永远空。
- `AgentConsolePage.vue:131,287-289` "Since Last Visit" 是 **localStorage 前端模拟**,后端无 since 参数。
- Memory Center 页已删,`/memory-center` 重定向到 console;UI 曾把 `memory_context_preview`(编译器用的 `{source,key,value}`)当记忆条目渲染。
- Feature flags:`workspace` ON,`learner/memory/attempt-review` 默认 OFF(`Cargo.toml:47-72` + DB setting `features.memory_auto_candidates_v1`,默认 proposal_only)。

## 4. 后端现状:已修 vs 未修

### 已修并验证(在 `25c954b3` 中)
- `JournalFacts` 编译阻塞:`ielts-domain` 新增 `today_observation_ids`/`memory_events`;`ielts-db/src/journal.rs` 的 `build_daily_facts` 聚合(obs 上限 512;memory_events JOIN memory_items 且排除 private/restricted;operation→过去时映射)、`insert_journal` 落盘、`daily_source_hash` 纳入。测试 fake 已补。journal 13/13 + application 120 + Python 契约 59 + 静态 27/27 + E2E 16/16。

### 未修(按严重度,细节见 `.planning/agent_backend_audit_20260824/findings.md`)

**P0(生产断链,必须最先修)**
1. **Rust↔Python JournalFacts 契约分叉仍未闭合**:Rust 侧改了,但 Python `agent-runtime-python/src/ielts_agent/dream/types.py:107-181` 是 `_StrictModel extra="forbid"`,仍期望 `memoryChanges` 为 list(Rust 发单个 counts 对象)、`writingEvalSummary.attempts/taskTypes`(Rust 发 `completed/degraded`)、`skillDeltas[].skill/activity`(Rust 发 `skillKey/evidenceCount`)、不认识 `memoryEvents`。`journal.build_daily`(cognitive_runtime.rs:1123)原样序列化 → `model_validate` 必抛 `journal_facts_invalid` → **daily dream 生产必然 fallback 零提案**。修法:定一个规范契约形状,一侧翻译,别两边各拍一个。
2. **dream_runs 生命周期断链**:`crates/ielts-db/src/dream.rs:61-83` `start_dream_run` 全仓零调用方;`dream.run_daily` 只 insert+record_proposals,run 永远 `queued`。
3. **AgentService 不写 checkpoint**:`crates/ielts-application/src/agent.rs:335-524` 六阶段 CheckpointStage 只有合成 final 行,无真实生产者(M12 wire-up 缺口)。
4. **取消链路整体断裂**:`ielts-db/src/agent_thread.rs:234-262` cancellation 只写 DB 不终止执行;Rust loop 无 CancellationToken;`agent_cancel_run` 命令不存在。
5. **Study Planner 不可达**:Python `_dispatch`(runtime.py:69-83)只注册 `runtime.*` 与 `memory.candidates.*`;Rust `request()` 只调 `memory.candidates.generate`。

**P1(选摘,全量见 findings.md Audit A/B)**
- 死类型:`StudyPlanSnapshot`/`GenerateStudyPlanCommand` 零引用;`AgentRunKind::Dream/StudyPlan` 无创建方。
- 17.8 命令清单大幅缩水(`src-tauri/src/lib.rs:78-308`):缺 agent_thread_get/agent_send_message/agent_cancel_run/agent_retry_run/agent_get_run_trace/memory_list/get/search/archive/pin/dream_get_latest/list/review/apply/reject 等。
- 14.7 八工具:6 实 2 缺 1 改名(`src-tauri/src/agent/learning_tools.rs:29-96`)。
- run_kind 只是审计标签,无 per-kind 工具 allowlist/预算/轮次策略(14.12)。
- 两套并行 thread 真相:`commands/enrichment.rs:146-188` coach_threads vs agent_threads。
- 14.5/14.6 未落地:无 AgentToolRegistry/ToolEffect/ApprovalRule;write_file 直接写用户目录无审批矩阵。
- journal job 台账说谎:`commands/journal.rs:57-70,117-127` 在真实构建前就标 completed,claim 的是全局下一条而非刚入队那条;weekly_dream 撞 DB CHECK(0018 只允许 daily_journal/daily_dream)。
- `memory_context_preview` 读路径无 sensitivity 过滤(`ielts-db/src/memory.rs:463-497,1182-1281`),当前安全纯靠写入侧硬编码 'normal'。

**P2(后置)**:17.9 事件通道全缺(无流式推送,UI 只能轮询);`context.rs:321-327` `now_iso()` 生成 1970 假时间戳;checkpoint 反向 RPC 两端皆空;Memory Catalog(10.x)/证据查看/journal 版本读 API 缺位——**这是 UI 被迫用 preview API + localStorage 的根因**。

## 5. 建议攻击顺序(Linus 式)

1. **先定契约,再写代码**:JournalFacts 的 Rust↔Python 形状分歧,以「dream/types.py 的 strict 模型」或「Rust serde」单边为规范,另一侧加翻译层(建议在 Rust 序列化处,Python strict 模型保持生产环境的防呆)。修完跑 Python 契约测试,确认 daily dream 不再 fallback。
2. **把 run 生命周期这个数据结构立正**:`dream_runs`/`agent_runs` 的 start/finish 状态机由 Rust 独占推进(job 台账先别撒谎:claim 那条刚入队的,构建完成再标 completed)。
3. **取消链路**:CancellationToken 进 AgentService loop,`agent_cancel_run` 命令 → loop 检查点 → 中断模型/工具调用。checkpoint 写入在每阶段真实落一行(六阶段已有 Stage 表,别再造)。
4. **补产品读 API**(Memory Catalog 列表/详情、journal 可读摘要、study plan items by plan_id),让 UI 撤掉 localStorage 模拟与 preview 误用;前端只做消费与格式化(format.js 扩展)。
5. UI 收尾:计划面板换 plan_id 数据源、Since Last Visit 换后端参数、memory 卡片换 catalog API。E2E 选择器全程不动。

每步之后跑第 1 节的两条命令;不许跳过。

## 6. 陷阱清单(前人会话踩过)

- Python strict 模型 `extra="forbid"`:Rust 侧随意加字段=生产崩溃,加字段必须两侧同步 + 契约测试。
- Plan ID ≠ Thread ID(domain 注释明示);`.catch(()=>[])` 这类吞错误模式在 console 页还有,勿模仿。
- 审计会话曾因「上传截图做视觉核验」触发网关 400(**用户明确:跳过视觉核验、不上传图片**)。
- E2E 依赖 release 构建(`target/release/ielts-practice-tauri.exe`),跑之前确认二进制包含你的前端改动;偶发 `WebDriver condition timed out: False` 与改动无关,重跑即过。
- 并行会话可能同时在写工作树:动手前先 `git status` + 读 `.planning/*/progress.md` 确认没有接管冲突。
