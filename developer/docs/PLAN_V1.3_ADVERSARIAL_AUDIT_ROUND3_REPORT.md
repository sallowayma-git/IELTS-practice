# IELTS Atlas Agent Plan v1.3 对抗审计报告（Round 3 · 逐章 + 跨域并发）

- **审计对象**: `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md`（11248 行，26 章）
- **审计方式**: 18 个独立审计代理并发执行——14 个逐章对抗审计（第 1-26 章全覆盖）+ 4 个跨域审计（四链数据流、三条业务闭环、计划 vs 实现偏差、跨章命名/契约一致性）
- **审计基准**: 仓库实际代码（crates/、src-tauri/、agent-runtime-python/、apps/writing-vue/、migrations 0001-0022）、ADR-M2.1..M12、M3-M12 STAGE_GATE_REPORT、git 历史（tip `7928d75c`，2026-08-31）
- **审计日期**: 2026-08-31
- **严重度定义**: P0=照文档执行会出错/安全洞/闭环断裂；P1=声明失真会误导实现；P2=漂移/缺口；P3=瑕疵

---

## 一、总体判定

**【核心判断】** 🔴 这份文档作为"实施权威"已经失效。它的状态层冻结在 2026-08-12 的 Post-M2 快照，而仓库在同一条 gate 体系下跑到 M12；它声明的四条数据链只有一条（Learning Truth Chain）真正闭合；它声明的三条业务闭环一条也转不起来（Coach 是残缺缩水版、Dream 只能手动、自进化彻底死锁）；最严重的是安全章的三个核心承诺被自己的代码在白名单三行里直接打脸。

**全文档唯一经得起逐条审计的部分**：十二原则（9/12 有真实代码闸门）、21.7 迁移编号冻结表、21.10 TechSpar "不采用"红线、23.14/23.15/23.16 已实现伪代码段（代码注释回指文档）、7 章概念划分方向。**修复方向不是修补内容，而是换数据流**：把 v1.3 冻结为只读历史合同，状态一律外置到 ADR / STAGE_GATE_REPORT / `.planning/`，新建 `INDEX.md` 做入口。

**统计**：P0 × 28，P1 × 55+，P2 × 40+，P3 × 15+（详见各章节）。

---

## 二、P0 问题全录（按主题分组）

### A. 安全承诺被代码打脸（第 19 章 / 14.6）

| # | 问题 | 文档 | 代码 |
|---|---|---|---|
| A1 | weekly consolidation 把 LLM `statement` 原样 INSERT 进 `memory_items status='active'`，19.3 的"9 步防火墙"一条不走——stored prompt injection 闭环（投毒记忆经 M5 检索回流 Coach prompt），且 apply 时把健康 support 标 superseded | 5225 / 2474-2485 | `crates/ielts-db/src/consolidation.rs:102-119`（validator 仅在 memory_candidates 路径生效） |
| A2 | Python sidecar 反向 RPC 白名单注册 `prompt.promote_candidate` / `prompt.rollback` / `approval.decide`——19.8 明文"永不提供：修改产品 Prompt active version"；rollback 无任何门，可 mid-session 热替换（4.12 禁止） | 5340-5342 | `src-tauri/src/cognitive_runtime.rs:83-85, 1098-1105, 1668-1693`；`ielts-db/src/prompt_skill.rs:827-845` |
| A3 | Webview 主窗口 JS 可携带任意 patterns 直调 `dream_run_weekly` 绕过 Python 四重 pattern gates；Tauri capabilities 仅 `core:default`，170 个自定义命令无命令级 ACL | 19.8 no-write-bypass | `apps/writing-vue/src/api/memory-repository.js:77`；`src-tauri/src/commands/journal.rs:454-475`；`capabilities/main.json` |
| A4 | 14.6 权限分级模型（ToolEffect/ToolPolicy/审批矩阵）全仓零实现，"需明确授权"的文件写工具在 run loop 直接自动执行 | 3531-3567 | grep `ToolEffect\|ToolPolicy` 零命中；`src-tauri/src/agent/file_tools.rs:116-127` |

### B. 数据结构级失效（第 8/9/10/11 章）

| # | 问题 | 文档 | 代码 |
|---|---|---|---|
| B1 | `archive_stale` 用 `memory_capacity_state` 的 kind（knowledge/language/…）去匹配 `memory_items.memory_type`（semantic/episodic/…）——SQL 永远影响 0 行，Archive/衰减生命周期整体 no-op，且命令暴露给前端 | 10.4 / 10.9 | `crates/ielts-db/src/consolidation.rs:224-229`；0019:117-124 vs 0014:23-26 |
| B2 | `learning_events.attempt_id` 的 FK `ON DELETE CASCADE`——删除历史 attempt 级联删光原始事件，9.8"账本不可变/不删除原始事件"承诺被击穿 | 2128 | `migrations/0012:23`；`crates/ielts-db/src/history/mod.rs:743` |
| B3 | `dream_candidates` 是只写死信表：全仓零 `UPDATE dream_candidates`，审批/拒绝路径不存在，0018 注释承诺"必须走 M3 promote"但两表互不相通——候选无限堆积 | 2423 | `migrations/0018:116-119`；`ielts-db/src/memory.rs:367-397`（promote 只操作 memory_candidates） |
| B4 | 8.2 声明 "schema version 11" 并列出 0013-0018 的**错误**文件名（0013 实为 learning_observation_projection 而非 agent_threads_checkpoints 等）——照文档编号新建迁移会与现有 22 个冲突，炸数据库 | 1260-1270 | `crates/ielts-db/src/migrate/mod.rs:19-124` |
| B5 | ContextPack 不含正文：`render_context` 对非 Soul 项只输出 `- item_id (kind, n tok)` 目录头，`estimate_tokens` 按全文记账却从不渲染全文；13.13"证据召回率≥99%"是幽灵指标；注释声称"model gateway re-reads at invoke time"为假 | 3222-3242 / 7766 | `crates/ielts-application/src/context.rs:289-316`；`cognitive_runtime.rs:2025-2048` 原样透传 |

### C. 闭环断裂（第 5/6/13/15/16/21 章）

| # | 问题 | 文档 | 代码 |
|---|---|---|---|
| C1 | Coach 生产主链绕过整条文档架构：`CoachService::run` 仅 30 行（append→load_history(100)→单次 complete→parse JSON），无 learner state/memory/strategy 注入、无快照、无 tool、usage 被丢弃；且 attempt 证据由**前端组装**塞进 payload（信任客户端数据） | 6.3 / 15.6 | `crates/ielts-application/src/coach.rs:13-96`；`useReadingCoach.ts:362-391` |
| C2 | Python PersonalizedCoach 完全不可达：dispatch 表只有 4 方法，无 coach.*；M6 Runtime Rule 的 Shadow→Canary→Default 连 shadow 都没接 | 7904 | `agent-runtime-python/src/ielts_agent/runtime.py:75-93`；`cognitive_runtime.rs:502-720` |
| C3 | **M6 产品级 Go/No-Go 门实际答案是 No-Go**（gate report 诚实限制自认"Rust baseline 仍是唯一用户可见 Coach"），但 M7-M12 照常批量交付，21.8 的门禁被整体绕过 | 8186 / 9499-9501 | M6_STAGE_GATE_REPORT:69-70；git `1df006d0` 一次 commit 交付 M2.1-M12 |
| C4 | Evolution Chain 双重死锁：`eval_cases` 无生产写入方（唯一 INSERT 仅测试调用，无 Tauri 命令/host 能力）+ eval 执行器不存在（`run_eval` 只记账调用方自带结果）——晋升门要么空转要么永不放行 | 4125-4162 / 16.10 | `ielts-db/src/prompt_skill.rs:428,641+`；`eval/runner.py` 零调用方 |
| C5 | strategy 晋升门不查任何 eval：`promote_strategy_candidate` 仅凭布尔量翻 disposition，函数 docstring 自称"Promotion is the offline-eval gate" | M10-08 / 9013 | `ielts-db/src/teaching_strategy.rs:776-820` |
| C6 | Context Chain 无生产触发点：检索管线/任务分类/materialize/eval 编排在 sidecar dispatcher 不可达；`run_retrieval` 零调用方；前端 grep `context_materialize` 零命中 | 777-782 | `runtime.py:75-93`；`retrieval/__init__.py:48` |
| C7 | 审计三表死表：`retrieval_runs` / `llm_invocations` / `retrieval_index_registry` 全仓零 INSERT——"Agent 为什么这么答"在检索与 LLM 调用层永远无法回答；`agent_context_snapshots` 只写不读 | 7547 / 8.11 | 0016:39-86 建表；grep INSERT 零命中 |
| C8 | 5.3 三时间尺度不存在：无 scheduler、无启动补跑、无窗口触发，全系统只有"实时"和"手动点按钮"两种状态；lib.rs 注释还倒打一耙声称"计划禁止 auto-dream"（文档从未禁止） | 806 / 823 / 2487-2505 | `src-tauri/src/lib.rs:30-34` |

### D. 状态层失效（第 1/3/21/22 章）

| # | 问题 | 文档 | 代码 |
|---|---|---|---|
| D1 | v1.3 覆盖层自称"执行时优先"，但其锚点 tip `7a99ea4` 落后当前 7 个提交 / 10 个里程碑 | 284 | git log |
| D2 | 3.4 缺口矩阵 14 行"缺失/必须增加"全部已被 M1-M12 填掉，零标注 | 419-433 | migrations 0012-0022 全链 |
| D3 | 3.3 整节结论反转：AgentWorkspacePage.vue 已删除，替代者 AgentConsolePage 接真实后端——照文档执行会去改造一个不存在的文件 | 400-407 | git `dff588e8`；`apps/writing-vue/src/views/AgentConsolePage.vue` |
| D4 | 21.6.9 "Authoritative" 交付顺序冻结在 M2（M3 标 NEXT），尾部结语同样停在 M2.1 NEXT | 9387-9404 / 11234 | M12_STAGE_GATE_REPORT:64-78 |
| D5 | Feature Flag 体系是装饰品：19 个 flag 中 12 个从未存在，存在的 7 个 Cargo feature 全是空数组、代码零 `cfg` 引用 | 5778-5798 | `src-tauri/Cargo.toml:48-72`；全仓 cfg(feature) 仅 ts-export/developer-tools |
| D6 | 1.1 产品闭环写成现在时，但 Memory Center / Learner Model / AttemptReview 的前端 feature flags 默认全关——出厂构建闭环断裂，文档零字提及 | 75-100 | `apps/writing-vue/src/config/feature-flags.js` |
| D7 | "新复杂能力默认只实现一次，优先 Python"被 M3-M12 全面违反：整合/演化门禁/编译器/策略四大复杂能力全部长在 Rust；"不是两个产品"的 parity 禁令以 Rust 单方面跑完的形式破产 | 220 / 228 | `crates/ielts-application/src/{consolidation,prompt_skill,teaching_strategy,context}.rs` |
| D8 | 22.5 Vue modules 树整体虚构（画了 6 个 modules，实际只有 agent-console、practice-reading）；22.3 Python 树大面积不符（coaching/evals/datasets/replay 不存在），承诺的 memory/retrieval golden 与 crash-recovery 测试一个不存在 | 9827-9846 / 9697-9741 | `apps/writing-vue/src/modules/`；`agent-runtime-python/src/ielts_agent/`；`tests/` 实况 |

### E. 实时契约虚构（第 17/18 章）

| # | 问题 | 文档 | 代码 |
|---|---|---|---|
| E1 | 17.9 整套事件通道（AgentUiEvent 10 变体：ModelDelta/ToolRequested/…）虚构——src-tauri 全库零次 `emit`；单帧同步单飞协议物理上承载不了流式 | 4758-4777 | grep emit 零命中；`host_bridge.py:2-5` "one cognitive request at a time" |
| E2 | 17.8 的 37 个 Tauri 命令名与 lib.rs 实际注册面几乎零交集（agent_send_message→agent_thread_append_message 等 10+ 处改名，另有一批从未实现） | 4691-4754 | `src-tauri/src/lib.rs` invoke_handler |

---

## 三、四条数据链端到端判定（跨域审计 1）

| 链 | 判定 | 关键断点 |
|---|---|---|
| **Learning Truth Chain** | ✅ 全库唯一闭合链 | attempts→learning_events→learner_observations→skill_state→下游消费全部真实存在，FK 生效。轻微缺口：annotations 无直接 append 调用方 |
| **Memory Chain** | ⚠️ 主干闭合，三处悬空 | ①文档声明 messages 是候选输入源，实际 agent_messages 与记忆管线零交集；②`memory_items.created_run_id` 永不写入，run 级溯源断链；③`memory_evidence.event_ids_json` 无存在性校验，跨链 ID 可伪造 |
| **Context Chain** | ❌ 端到端未接通 | 三张审计表零写入、管线零生产调用方、快照只写不读、正文不在审计产物内（materialize 与 fetch 之间可被篡改且无 hash 比对）、Python 的 `rr-{uuid}` run_id 撞 FK 必炸 |
| **Evolution Chain** | ⚠️ prompt 腿有真门但没燃料；strategy 腿是橡皮图章 | eval_cases 无写入方（P0）、EvalOrchestrator 生产不可达、Rust 门只记不算、strategy 门不查 eval、shadow/canary 半缺位、traces→batch 无人驱动 |

**"四链相互独立"声明被证伪**：四链以 `learning_events` 与 `agent_runs` 为根构成 DAG，Evolution 显式依赖 Context 产物（`teaching_strategy_assignments.context_snapshot_id`，0020:69）。独立性只是实施顺序上的，不是数据拓扑上的——Context Chain 一断，Evolution 的可解释性随之断。

**最优先修复序**：① eval_cases 生产写入方（一个命令+一个 host 能力，解卡整条 Evolution）；② Context Chain 两表写入 + dispatcher 接通（否则"可审计产物"承诺整体失真）；③ `rr-` run_id FK 与 strategy 假门（一行级逻辑错误）。

---

## 四、三条业务闭环判定（跨域审计 2）

| 闭环 | 判定 | 第一卡点 |
|---|---|---|
| A. 个性化阅读 Coach | ⚠️ 转的是残缺缩水版 | 生产主链绕过文档架构（C1/C2）；strategy_assignment/reask/outcome 三张表无生产写入方→M10 演化上游恒空；ReadingCoachPanel 无反馈组件 |
| B. Daily/Weekly Dream | ⚠️ Daily 手动能转 / Weekly ❌ 死码 | Weekly 三处全断（Python 无 dream.weekly dispatch、Rust 命令要调用方自带 patterns、UI 无入口）；无定时器无补跑；job queue 实为审计台账（enqueue+claim 同命令） |
| C. 自进化（M10/M11） | ❌ 彻底转不起来 | eval 无燃料无执行器（C4）、strategy 假门（C5）、晋升后不生效（AgentService 仍用硬编码 prompt const）、演化层零 UI |

**全局瓶颈是同一个**：dispatch 表与"生产驱动方"。host capability 表注册了 34 项形成"反向 handler 公墓"（thread.*、approval.*、study_plan.*、dream.run_weekly、eval.run_case、strategy.*、prompt.* 共 10+ 项无 Python 调用方）；Python dispatch 只有 4 方法。修两个 dispatch 方法能消掉一大半断点。**接口倒挂**：`dream_run_weekly(patterns)` 让 UI 当 pattern 生产者、`run_eval(results)` 让调用方自带评分——数据所有权想反了。

---

## 五、逐章品味评分与要点

| 章 | 评分 | 一句话定性 | 该章最重要的 P1/P2 |
|---|---|---|---|
| 1 执行摘要 | 🟡 | 十二原则是全文档唯一不需道歉的部分（9/12 有代码闸门）；1.1 闭环图 dark launch、1.3 形态图画了没有的 Scheduler、漏了已有的 Thread/Planner/文件车道 | 原则 9 靠 M12 特例 gate 打补丁；原则 11 未定义推理出网边界 |
| 2 范围/术语 | 🟡 | 术语表与代码一致性高于预期；词汇/写作评测两域整块缺失；2.2"不复刻 Claude Code"与 file_tools 的 SHA-256 乐观并发同款语义需要豁免说明 | 术语缺 Evaluation Session/Lineage、Vocabulary Review State |
| 3 实现审计 | 🔴 | 教科书级腐烂现场：3.4 十四个"缺失"全部竣工、3.3 描述的页面整个被删、覆盖层自己是旧 tip | 3.2.1 扩展位置指引与 Python-first 决策自相矛盾；恢复语义已变两层未更新 |
| 4 调研 | 🟡 | 引用纪律真存在（26.8 分级表）；但正文零行内引用挂钩、云端前提（服务端 cron/常驻进程）不做迁移论证 | WorkBuddy/LangMem 后台整理被原样收编为单机能力；4.14 Beta/EWMA 四件套一件没实现且 time_weight=1.0 |
| 5 收敛决策 | 🔴 | 价值主张的承重墙是纸糊的：三时间尺度只有手动按钮；5.5 授权表盖不住一半真实写面 | 收敛矩阵 ✅ 静态冻结（FTS5 ✅ 名不副实、Background Dream ✅ 为手动）；prompt.rollback 无门 |
| 6 目标架构 | 🔴 | 把"目标态"写成"现在时"：8 个服务名对不上实际、ownership 矩阵对生产链路大面积失明（9 个命令模块零覆盖） | 6.5"不采用全量 ES"是少数守住的事实；6.4 时序图没有 UI 参与者而现实是 UI 驱动 |
| 7 概念边界 | 🟡 | 概念划分方向正确；但 0014 用 inferred_profile/user_explicit/system_policy 把四概念揉进一张表，文档还端着四个独立王国 | 权限矩阵约三成格子描述不存在的写路径；7.8 token 预算表零强制且冻结 Coach 无界注入 100 条历史 |
| 8 SQLite Schema | 🔴 | 数据结构已换三届（证据改观察投影、journal 改 facts、FTS 改 sidecar），文档停在第一届；照本章写代码第一次 INSERT 就失败 | 8.13 FTS5 方向相反（canonical 零 FTS5，实际在 Python sidecar）；8.8 auto_promoted 是被实现否决的后门；8.4 checkpoint 三方矛盾 |
| 9 事件账本 | 🔴 | 30 事件分类法 vs 代码 11 个 snake_case 词汇两套语言，约 80% 事件代码造不出来；置信度恒 1.0 | consolidation_state 四态死了四分之三（除 INSERT 外零 UPDATE）；9.5 backfill 只覆盖 reading |
| 10 记忆生命周期 | 🔴 | 状态机 8 个 status 有 4 个不可达（candidate/pending_review/rejected/quarantined 无写入方）；门槛常量/衰减公式/六档预算全部纸面化 | 隐私删除可经 Dream support"复活"（validate_one 不拒 deleted）；容量超限是抛错不是腾挪 |
| 11 Journal/Dream | 🟡 | 设计骨架品味不错（facts 与叙事分离、fail-closed）；落地是灾难性折扣，三层文档（11 章伪码/ADR-M7/0019 注释）各自描述不同系统 | 证据链伪造（所有提案共享最近一条观察）；kind_map 兜底 REINFORCE（supersede 事件生成强化旧记忆提案）；content-hash 短路未实现；journal_get_daily 读命令写库 |
| 12 学习者模型 | 🟡 | 代码侧品味不错（确定性 replay+state_hash 对账）；脏在文档：13 类错误分类退化成按题型命名 3 个标签 | 12.6 同题重复分析纯属愿景；12.4/12.9 公式与代码三处硬矛盾（ADR-M4 才是真规格）；Writing 七技能零实现 |
| 13 Context Compiler | 🔴 | 整章是没人执行的遗嘱：核心类型（BuildContextRequest/ContextBudget/AgentTaskKind）全仓零命中；两颗地雷（snapshot_id 撞主键、run_id 撞 FK）埋在持久化路径 | 分区 token 预算零执行点（Python 申请被 Rust 无声丢弃）；管线无生产调用方 |
| 14 Runtime/工具/权限 | 🔴 | 权限模型零实现、10 状态机 5 个是幻影、5 个 proposal 工具零实现；完全不知道 M12 已落地另一套 thread/checkpoint 模型——同一文档两个互不相识的 checkpoint 设计 | Python tool 面宽度=1（tool.invoke 白名单只允许 memory.candidate_input）；sidecar 超时=杀整个进程未记载 |
| 15 Coach 策略演化 | 🔴 | 在给死表写传记：策略空间被 SQL CHECK 冻结成 6 个枚举（演化对象不可变）、策略→coach prompt 注入零路径、Python 目录 6 vs Rust 目录 8 不一致 | 策略数据结构两套语言（sequence 模型 vs catalog 模型） |
| 16 Prompt/Skill 演化 | 🟡 | 三章里最实的一章（0021 registry/晋升门/rollback 链真的建成了）；但把"已建表的骨架"写成"已运行的管线" | 状态链逐值漂移（evaluated/retired 不存在、holdout 被漏）；skill 包结构蒸发成 blob（allowed_tools/risk_class 无载体）；canary/kill switch 无代码 |
| 17 Hybrid API | 🔴 | v1.2 愿望清单的化石层：trait 拆分、DDL、错误码、命令清单、事件通道五条主线逐节可证伪；连"这不是 JSON-RPC"都写错（实际是自定义信封+4 字节长度前缀） | 错误码第三宇宙（19 个码几乎零实现，ApplicationError 两处 struct）；17.5 ModelGateway 虚构（实际双轨 LanguageModel/AgentModel） |
| 18 Vue UI | 🟡 | 产品判断健康且部分被 domain 层超额吸收（11 种反馈 Kind > 文档 7 类）；页面矩阵/现状描述停在旧时代 | /memory-center 被 302 到 AgentConsole（五分区设计被一行 redirect 打发）；错误呈现三套方言（practice-client.js 自造码覆盖后端 envelope.code） |
| 19 安全/隐私 | 🔴 | 威胁模型清单写得像样、落地的部分质量不差；但对自己最大的三个洞（A1/A2/A3）一个没写进威胁模型 | quarantine 黑洞（原文当场销毁、无解除路径）；Provider 数据最小化零实现（model.invoke 原样出网）；sensitivity 全链常量 normal |
| 20 评测/门禁 | 🔴 | 愿望清单不是工程计划：全章没有一个指标有采集代码、没有一个阈值被任何 gate report 测过、声明的 13+ 数据文件不存在 | 注入 scanner 实为 6 条 ASCII 子串（无 Unicode 归一）；门禁报告从未对账 20.7 阈值 |
| 21 里程碑计划 | 🔴 | 同时扮演规格书/状态板/修订日志三个角色，全演砸：M6 No-Go 放行全部下游、依赖图纸面串联代码断开 | 21.1 十条规则 1/2/9/10 已被静默放弃；M9/M12 gate report 引用锚点张冠李戴（"任务书 §8832"，任务书只有 1432 行）；21.7 迁移冻结表是少数亮点 |
| 22 目录结构 | 🔴 | 一半虚构一半过期：Vue 六 modules 全不存在、Python 树大面积不符、测试清单一半虚构 | schemas/（4 个真实协议 schema）无任何章节声明权威地位；根目录工作文件不在视野 |
| 23 伪代码 | 🟡 | 真伪混装无状态标记：§23.14/23.15/23.16 被代码注释回指（全文唯一运转的文档-代码合同），另一半是愿望签名 | 23.10 ContextQueryPlan 与 22.2 自家叙事打架；EmbeddingSignature Rust/Python 主体错位 |
| 24 风险清单 | 🟡 | 反模式判断力不错，但对已真实发生的三类 P0 全部失守——缺的不是预见力是事故回填 | 缺"生成式输出即不可信输入"与"删除路径必须可观测可回滚"两条 |
| 25 验收标准 | 🔴 | 无法失败的标准不是标准：X 组数字零采集零基线、D/C/M/S 组无验收方式列、D-07 疑似无实现 | 25.11 产品指标同样无采集方 |
| 26 参考/结语 | 🟡 | 26.1 路径清单真实可用；结语时间线比仓库落后两周整 | Dream 概念命名靠 C 级预印本支撑却标 A/B 决策 |

---

## 六、跨章系统性病灶（跨域审计 3+4）

1. **三种生命周期混写一份文档**：目标态（计划）、观测态（审计快照）、状态板（COMPLETED/NEXT）生命周期不同，靠手工补丁层叠维护（v1.0/v1.1/v1.3 三层覆盖层同章共存）——补丁必然腐烂，这是结构问题不是勤奋问题。
2. **符号稳定性在三个接口层崩塌**：17.8 命令面几乎零交集、6.2 服务名与 17.3 trait 名文档内部互相打架、17.13 协议示例引用两侧都不存在的方法。最危险歧义：`MemoryMutationProposal`（文档 struct vs 代码同名 enum）。
3. **枚举漂移成灾**（完整对照表见审计原文）：agent_runs.status 文档 10 值 vs 代码 5 值；background_jobs 文档 waiting/cancelled 不存在；prompt status 文档 candidate/rejected vs 代码 eval/holdout；memory_items 文档状态机缺 deleted 节点。
4. **孤儿符号 ~30 个**（表 eval_suites/prompt_artifacts、命令 memory_pin/dream_list 等、trait LearningEvidenceStore/BackgroundJobStore、伪类型 ContextQueryPlan/CompactionPlan）；**反向公墓 ~26 项**（host capability 注册无调用方）。
5. **Gate report 的"完成"与 16.10 硬门槛精神相悖**：五份报告正文宣称全部完成，靠末尾"诚实限制"承认关键断点；M12 gate 判"已达到"之后紧接着三个 P0 断链修复提交（cd932af2/4ab2d371/15b74ad9）——契约通过 ≠ 闭环能转。
6. **代码注释开始替文档圆谎且圆错方向**（lib.rs "the plan forbids auto-dream"、0019 注释描述不存在的 enqueue 行为、context.rs "model gateway re-reads"）——文档失序已经污染代码真相源。

---

## 七、修复路线图（按杠杆率排序）

### 第一层：安全（立即，1-2 天）
1. weekly consolidation 复用 MemoryProposalValidator 同一管道——消灭 A1 特殊通道（一个数据结构决策消掉最大安全洞）
2. 从 sidecar 白名单摘掉 prompt.promote_candidate/rollback + approval.decide；rollback 补与 promote 同级审批门（A2）
3. dream_run_weekly 收敛为 host-internal 或加审批门（A3）
4. coach.rs 加 token ceiling（复用 32k 常量即可）（7.8）

### 第二层：数据结构（本周）
5. archive_stale 列语义对齐（B1）；learning_events 去业务 FK（B2）；dream_candidates 与 memory_candidates 二选一桥接（B3）
6. eval_cases 生产写入方 + Context Chain 两表写入（C4/C7 的最小解）
7. 修 rr- run_id FK、snapshot_id 确定性撞主键两颗地雷

### 第三层：接线（下周）
8. dispatch 表加 coach.reply + dream.weekly 两个方法（消掉 A/B 闭环大半断点）
9. 启动时检查缺失日期补 enqueue dream（一个函数，不需要 OS scheduler）
10. strategy promote 强制校验 passed eval；晋升后 prompt overlay 生效

### 第四层：文档换血（与上并行）
11. v1.3 顶部加冻结横幅，此后零编辑；新建 `developer/docs/INDEX.md`（里程碑→ADR→gate report→migration→代码入口映射，声明冲突优先级 ADR > gate report > 任务书）
12. 23.14/23.15/23.16、十二原则、21.7/21.10、7 章边界合同——原封保留为权威
13. gate report 补 post-audit addendum（链接 `.planning/agent_backend_audit_20260824/findings.md`），措辞"功能完成"→"契约验证完成"
14. run_static_suite.py 加静态 drift check：校验 ADR/gate report 引用的 migration 文件名与 Tauri 命令真实存在
15. 下一个大版本（Post-M12 / v2）开新文件，不续写这一份

---

*本报告由 18 个并发审计代理产出，全部发现基于只读核查（Read/Grep/ls/git log），每条含文档行号与代码 file:line 双证据。逐章完整发现清单（含全部 P1/P2/P3）见各审计代理原始输出，已按章节归档于本报告第五节表格。*
