# IELTS Atlas Agent 自进化工程计划 v1.4 修订案（Amendment）

- **日期**：2026-10-05（owner 决策日：2026-10-04 / 2026-10-05）
- **性质**：对 [v1.3 计划](IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md) 的**定点取代**，不重写 v1.3。v1.3 保持冻结，仅在文首加一行指针。
- **事实基线**：分支 `IELTS-WRITING-FEAT` 的 **2026-10-05 工作树**（含未提交改动；含同日 owner 追加的四项决策：weekly 首跑仅周末且失败逐日重试直到完成、daily 只做摘要、推理模型只留最终答案、M10/M11 命令仅开发期，见 2.3 / 2.9 / 1.2）。文中 `path:line` 引用均已对照该工作树核对；工作树之后再变动，以代码为准。
- **优先级**：代码与测试 > 本文 > 其余文档。对 v1.3 与 ADR / Stage Gate 中与本文**明确列出的被取代条款**（第 4 节）冲突的描述，以本文为准；其余按 [INDEX.md](INDEX.md) 的权威顺序。
- **不在本文范围**：预算、配额、用量账本、成本 UI（owner 决定不做，见 2.8）。

---

## 1. 状态实况

v1.3 只把 M0–M2 标为完成。代码实际已包含 M3–M12 各阶段的大部分部件，但“代码存在”不等于“产品面启用”。下表以代码和迁移为准，最后一列区分产品面状态。

### 1.1 迁移清单（`crates/ielts-db/migrations/`，共 26 个，注册于 `crates/ielts-db/src/migrate/mod.rs:21-146`）

| # | 文件 | 内容 |
|---|---|---|
| 0001 | `0001_v2_core.sql` | v2 核心表 |
| 0002 | `0002_writing_eval_sessions.sql` | 写作评估会话 |
| 0003 | `0003_eval_lineage_multi.sql` | 评估谱系（多） |
| 0004 | `0004_modes_timer.sql` | 模式 / 计时 |
| 0005 | `0005_annotations_vocab_coach.sql` | 批注 / 词汇 / coach 线程 |
| 0006 | `0006_writing_topics.sql` | 写作题库 |
| 0007 | `0007_attempt_writing_task_type.sql` | attempt 写作任务类型 |
| 0008 | `0008_history_retention_policy.sql` | 历史保留策略 |
| 0009 | `0009_writing_prompt_policy.sql` | 写作 prompt 策略 |
| 0010 | `0010_reading_timer_states.sql` | 阅读计时状态 |
| 0011 | `0011_agent_runs_tool_calls.sql` | `agent_runs` / tool calls |
| 0012 | `0012_learning_event_ledger.sql` | 学习事件账本（M1） |
| 0013 | `0013_learning_observation_projection.sql` | Observation 投影（M2） |
| 0014 | `0014_memory_profile_core.sql` | Memory 核心（M3） |
| 0015 | `0015_learner_model_v1.sql` | 学习者模型（M4） |
| 0016 | `0016_context_retrieval_trace.sql` | Context / 检索 trace（M5） |
| 0017 | `0017_coach_learning_feedback.sql` | Coach 反馈闭环（M6） |
| 0018 | `0018_daily_journal_jobs.sql` | Daily journal / 后台 job（M7） |
| 0019 | `0019_memory_consolidation_v1.sql` | Weekly 整合（M8） |
| 0020 | `0020_teaching_strategy_evolution.sql` | 教学策略（M10） |
| 0021 | `0021_prompt_skill_evolution.sql` | Prompt / Skill 注册（M11） |
| 0022 | `0022_agent_threads_planner.sql` | Agent 线程 / 计划（M12） |
| 0023 | `0023_strategy_candidate_eval_gate.sql` | 策略候选离线评估证据（M10-08） |
| 0024 | `0024_coach_outcome_link_fk_fix.sql` | 修复 `coach_outcome_links_v0` 自相矛盾的外键 |
| 0025 | `0025_prompt_release_predecessor.sql` | 新建 `prompt_skill_releases` / `prompt_skill_release_heads`，记录发布序（predecessor） |
| 0026 | `0026_attempt_asset_revision.sql` | `attempts.submitted_asset_fingerprint`（可空，历史提交无可信 revision） |

### 1.2 里程碑实况

| 阶段 | v1.3 标注 | 代码实况 | 产品面 |
|---|---|---|---|
| M0 / M1 / M2 | 完成 | 0011–0013，事件账本与 Observation 投影 | 随主流程运行，零 LLM |
| M2.1 Cognitive Read | 要求先于 M3 | `crates/ielts-db/src/cognitive_read.rs` | 内部读网关 |
| M3 Runtime + Memory | 未标 | 0014；Python sidecar `agent-runtime-python/`；Rust 校验器 `crates/ielts-application/src/memory/validator.rs` | sidecar 随应用启动；候选提取命令仅开发期（2.5） |
| M4 Learner Model | 未标 | 0015；`crates/ielts-db/src/learner.rs` | “技能”页在 `learnerModelV1` 之后，默认关（`feature-flags.js:21`） |
| M5 Retrieval + Context | 未标 | 0016；context compiler 已接 coach 证据；embedding 与 LLM rerank 默认关（`retrieval/planner.py:48-49`），`AiRuntime` 的 embed 默认返回 `embedding_not_supported`（`ports.rs:109-115`） | 词法/确定性路径 |
| M6 Coach | 未标 | 0017、0024；Rust `CoachService`（`crates/ielts-application/src/coach.rs`）；反馈 / 再问 / 对错链接为确定性观测 | 阅读复盘页内的 coach |
| M7 Daily Journal（即唯一的“daily dream”） | 未标 | 0018；进程内 worker `src-tauri/src/app/daily_worker.rs`（无 OS 调度器），一次日任务 = `run_daily_journal`：生成/复用当天确定性日记并把任务绑定到该日记版本。**不调模型、不起 sidecar run、不产生 memory proposal，也不写 `dream_runs` / `agent_runs`**（2.1 规则 2） | 札记页的“日记”条目；“整理今天”（IPC 名仍为 `dream_run_daily`）走同一条任务路径 |
| M8 Weekly Dream | 未标 | 0019；首次尝试仅周末、失败后逐日重试直到完成的整合（2.3）：窗口规划 `plan_weekly_window`、到期谓词 `weekly_window_due`（`daily_worker.rs`），worker 入口 `run_weekly_if_due`；输入是窗口内**真实练习记录**（`ielts-db/src/weekly_pack.rs`），一次调用同时产出周记的标题、每个区块一句话与记忆变更（周记本身是确定性区块，3.3）；`dream_runs.input_hash="weekly:<ISO 周>:<start>..<end>"`（`ielts-db/src/dream.rs`，`WeeklyWindow`） | 札记页的“周记”条目（按窗口实际范围标注）；**未对真实 provider 跑通**（第 5 节） |
| M9 Memory Center | 未标 | `MemoryCenterPage.vue` 已不存在；`/memory-center` 重定向到 `/notebook`（`main.js:43-47`）；新页 `views/NotebookPage.vue` + `modules/notebook/compose.js`（**撰写时仍是未跟踪文件**） | 被札记取代（3.3） |
| M10 Teaching Strategy | 未标 | 0020、0023；`teaching_strategy_*` Tauri 命令**仅在 `developer-tools` feature 下编译并注册**（`lib.rs` handler、`commands/mod.rs`）；服务层与 sidecar 反向 RPC 保留 | **无前端调用，无 worker 调用，发布构建无此命令**；coach 固定使用 `evidence_first_v1`（`coach.rs:158`） |
| M11 Prompt / Skill Eval | 未标 | 0021、0025；`prompt_*` / `skill_*` Tauri 命令**仅在 `developer-tools` feature 下编译并注册**；Python `ielts_agent/eval/` 不被 `runtime.py` 引用 | **无前端调用，发布构建无此命令**；不进入产品路径（2.5） |
| M12 Threads + Planner | 未标 | 0022；`agent_thread_*` / `study_plan_*` 命令；前端仅 `AgentConsolePage.vue` 使用 | 仅 `/dev/agent`（3.4）；札记页只读取最近一份学习计划（`NotebookPage.vue:263`） |
| 跨阶段 | — | 0026：阅读 attempt 记录提交时的 asset 指纹 | 阅读复盘用 |

要点：M10 / M11 的 Tauri 命令（`teaching_strategy_*`、`prompt_list_versions`、`prompt_get_active`、`prompt_propose_candidate`、`skill_list_versions`）与 `memory_generate_candidates` 使用同一机制，**只在 `developer-tools` feature 下编译**（`commands/mod.rs` 的模块门控 + `lib.rs` handler 的 `cfg(all(feature = "daily-dream-v1", feature = "developer-tools"))`），默认构建既不编译也不注册。`apps/writing-vue/src` 对这些命令零引用，由 `run_static_suite.py` 的 Tauri shipping contract 检查把关（handler 条目必须带门控、前端不得引用）；打包版 E2E 断言它们在发布二进制里是 `Command … not found`。服务层（`TeachingStrategyService`、`PromptSkillService`）与 sidecar 反向 RPC（`strategy.*`、`prompt.*`）不受影响，仍供开发期工具与测试使用。

---

## 2. 成本模型（仅架构，不含预算 / 配额 / 账本 / 成本 UI）

### 2.1 硬规则

1. **每回合自进化成本为 0 次 LLM 调用。** coach 反馈、再问、对错链接都是确定性观测（`crates/ielts-db/src/coach_feedback.rs`，`commands/coach_feedback.rs` 不涉及模型）。用户发起的 coach 回答本身是一次 LLM 调用，但它不触发任何额外的自进化调用。
2. **Daily 只做摘要：journal 与 daily dream 是同一个功能，且确定性。** 每日只生成确定性日记（事实汇总），不调模型、不起 sidecar run、**不再产生任何 memory proposal**；`dream_candidates` 表保留（不做破坏性迁移）但没有任何代码写入或读取它。daily 的 sidecar 入口（`dream.daily`、`journal.build_daily`、`dream.run_daily`）、Python `DailyDreamOrchestrator`、宿主侧 `record_job_dream_proposals` / `begin_job_dream_run` 均已删除。日任务只剩 `daily_journal` 一种（新库只会入队这一种；旧库里残留的 `daily_dream` 任务按同样的日记任务被领取并完成）。
3. **Weekly dream 是唯一的整合类 LLM 调用，也是唯一的记忆整合点**（第 2.3 节）。
4. **AI 阅读复盘 opt-in**（第 2.4 节）。
5. **Coach prompt 缓存稳定**（第 2.6 节）。
6. **每次模型调用必须显式带输出上限**（第 2.2 节）。
7. **Shadow、eval、LLM grader、embedding、LLM rerank 不进入发布产品路径**（第 2.5 节）。

### 2.2 输出上限

`max_tokens` 为必填字段（`ports.rs:36` 的 `CompletionRequest.max_tokens`），请求体由 `completion_body` / `agent_request_body` 统一构造（`src-tauri/src/ai/runtime.rs:376-418`）。sidecar 请求的上限必须在 1..=8000（`cognitive_runtime.rs:30,2343`），0 与超限都被拒绝。

| 调用点 | 上限 | 位置 |
|---|---|---|
| 写作评估 | 6144 | `crates/ielts-application/src/ports.rs:42`；`writing_evaluation.rs:126` |
| Agent 单轮 | 1500 | `ports.rs:43`；`agent.rs:430` |
| Coach 回答 | 2000 | `coach.rs:38` |
| Memory 候选提取（仅开发期） | 2000 | `agent-runtime-python/src/ielts_agent/memory_manager.py:32` |
| Weekly dream（每次尝试最多 3 次调用，2.3） | 1500 | `ielts_agent/dream/weekly.py`（`WEEKLY_MODEL_MAX_TOKENS`） |
| Daily enrichment | 1500（常量存在，**未接线**，见 2.5） | `ielts_agent/dream/journal_enrichment.py:44` |
| Provider 连通探测 | 16 | `ports.rs:44`；`commands/ai.rs:232` |

推理类模型族由 `OUTPUT_LIMIT_RULES` 表决定字段名与下限（`src-tauri/src/ai/runtime.rs:357-372`）：模型名（去掉 `vendor/` 路由前缀、转小写）以 `o1` / `o3` / `o4` / `gpt-5` 开头时，使用 `max_completion_tokens`，值取 `max(请求值, 1024)`；其余 OpenAI 兼容端点（DeepSeek、OpenRouter、网关）保持 `max_tokens` 且数值不变。原因：推理模型会把一部分额度花在隐藏推理上，16 token 的探测会返回空串，所以给 1024 下限。新增模型族只需往表里加一行。推理内容的剥离与回传规则见 2.9；该表与 1024 下限不受影响。

### 2.3 Weekly dream：周末首跑、失败逐日重试、唯一整合调用

**数据归属（owner 决策 2026-10-05）。** 推断类记忆（`memory_items`）**只由 weekly 写入**；用户显式偏好留在各自的存储（`explicit_user_preferences`）。daily 保持确定性、零 LLM、不写记忆。

**调度：一个谓词。** 窗口是**自上一次已完成（completed）整合的结束时刻（不含）起，到本次开始时刻（含）**，最多回溯 28 天（`WEEKLY_MAX_LOOKBACK_DAYS`）；漏掉的周末自然并入下一个窗口，没有单独的补跑路径。窗口规划是纯函数 `plan_weekly_window(now, 上次完成的终点)`，它的幂等键是 `weekend_key(now)`：**本地时区下，不晚于 now 的最近一个周六/周日所在的 ISO 周**（`YYYY-Www`，用 ISO 年，W53 成立）。周六、周日以及其后的每个工作日共用同一个键，所以周一的重试属于它所重试的那个周末。是否到期只在一处判定（`weekly_window_due`，`daily_worker.rs`）：

```
due = 自动学习开启
    && 该键没有 completed 的 run
    && 该键今天（本地）没有尝试过（completed 或 failed，`weekly_attempted_since`）
    && (今天是周末 || 该键存在 failed 的尝试（`weekly_failed_attempt_exists`））
```

即：**首次尝试只在周六/周日**；一个周末的运行一旦尝试过并失败，就在其后的任何一天继续重试，**每个本地日至多一次**，直到该周末完成，此后到下个周末之前不再有任何运行；若下个周末到来时仍未完成，下个周末的运行（新键）覆盖自上次完成起的整个跨度（现有窗口规则，≤28 天）。三种情形各有测试：周六失败 → 周日失败 → 周一成功；周六成功 → 周一不跑；整周失败 → 下周六窗口覆盖两周。

**幂等键与回执。** 键 = 上面的 `weekend_key`；一个周末最多一个 completed 的 run（`weekly_run_completed`，`ielts-db/src/dream.rs`）。run 行的 `dream_runs.input_hash` 同时记录窗口：`weekly:<ISO 周>:<start>..<end>`（RFC3339 UTC，`WeeklyWindow::marker`）；失败的尝试只记 `weekly:<ISO 周>`。该窗口也是宿主发给 sidecar、原样回传的不透明 `window` 标识（`WeeklyWindow::token`），sidecar 无法加宽或移动它（`authorize_host_request` 校验）。改动前写入的 `weekly:<ISO 周>` 旧标记仍可读，按“该 ISO 周的周一至周日”解释。下一窗口的起点 = 最新 completed 窗口的终点（`last_weekly_window_end`）。

**触发点与前置条件。** 进程内 worker 空闲时每 10 分钟看一次（`WEEKLY_CHECK_INTERVAL`）。除上面的谓词外：已配置 AI provider（`run_weekly_if_due` 里再查，缺 provider 时 sidecar 会记空窗口并烧掉名额）；窗口内**已打分的观察数 ≥ `WEEKLY_MIN_OBSERVATIONS`（8）**（`weekly_has_evidence`，Python 侧镜像为 `MIN_OBSERVATIONS`）。证据不足的窗口**不记 run、不调模型**，窗口继续增长（≤28 天）直到有话可说；任一不满足则 0 次调用。

**输入：周包（weekly pack）。** 宿主按窗口确定性地构建（`ielts_db::weekly_pack`，经 `learning.weekly_pack` 读能力交给 sidecar），**没有新表**：行来自 M2 观察投影（阅读答题结果、重做迁移、写作分项分），以及投影不覆盖的规范表（学习者的作答 `attempt_answers`、答案键 `answerKey`、`coach_feedback` / `coach_reask_links` / `coach_threads`）；不含文章正文。形状：

| 字段 | 内容 |
|---|---|
| `observationCount` | 窗口内已打分的观察数（阅读已判分的题目结果 + 写作总分） |
| `header` | 由行**计算**的确定性汇总：按题型的错题数与涉及篇数、按错误类型（`learner::error_type`）计数、“跨不同文章重复错”的题型与“同一文章重复错”的题目、重做的修正/仍错/新错数、写作最低分项计数、coach 反馈种类与追问数、回看旧 attempt 的次数 |
| `lines[]` | 每个相关事件一行：`{ids, date, kind, text}`。`kind`：`reading`（日期、`资源 id "标题"`、得分、第几次）、`miss`（每道**错题**：题号（用 `questionDisplayMap`）、题型、`answered 学习者作答 -> key 标准答案`）、`redo`（同一文章的重做：修正了前次几道错题、仍错哪些、新错哪些）、`writing`（任务类型、总分、最低的两个分项）、`coach`（某 attempt 当天的反馈种类如 `too_long` / `need_example`、追问次数）、`review`（对更早完成的 attempt 新开 coach 线程，即回看；账本里没有“重新打开”事件，只能这样近似）。`ids` 是可被记忆变更引用的 `obs-*`：每行最多 3 个（coach / review 行引用对应 attempt 的得分观察） |
| `omitted` | 超限时一行 `omitted N older items` |
| `memories[]` | 当前 active 的推断记忆（≤30，每条 ≤160 字；排除 user_explicit / system_policy / predicted；仅阅读 / 写作作用域），让模型能强化 / 取代而不是重复 |
| `preferences[]` | 显式偏好（≤20，只读，不可被变更） |

**大小上限与取舍。** 整包按 `estimate_tokens` 不超过 `WEEKLY_PACK_TOKEN_CAP = 6000`。超限时确定性地取舍（`cap_lines`）：先**保留“在 ≥2 篇不同文章里都错过”的题型的全部行**，再从最新往前保留最近的行（遇到第一条放不下的即停），其余丢弃并写入一行 `omitted N older items`；保护行本身就超限时才丢其中最旧的。`header` 在丢弃之前由全部行计算，所以计数始终如实。行按“日期、种类、文本”排序，与行 id / 数据库行序无关。

**周记 v2：区块由宿主确定性计算，模型只写一句话**（`ielts-db/src/weekly_report/`，契约在 `ielts-domain/src/weekly_report.rs`）。周记是一组 `ReportBlock {id, kind, data, examples, memoryIds, narrative}`：`data` 是该区块页面上出现的全部数字（camelCase；比例是保留两位小数的分数），`examples` 至多 3 条、每条带可直接打开的练习链接（`PracticeLink`：复盘某次 attempt、重做、写作结果、题库）。区块由 8 个确定性技能按**数据形状**选出（不是模型选）：`volume`（量与每日分布）、`accuracy`（正确率与每日走势）、`question_types`（错题题型）、`repeated_misses`（跨文章 / 同题重复错）、`redo_progress`（重做修正 / 仍错 / 新错）、`writing_bands`（写作分数与最弱分项）、`coach_signals`（coach 反馈与追问）、`next_week_plan`（下周计划：旧 Python 学习计划器的确定性移植，取证据数 ≥2 的复习需求，至多 3 项、合计 ≤45 分钟）。每个区块没有可显示内容时不出现；没有练习的一周没有区块。周包同时带上本周区块的 `{id, kind, data}`（`learning.weekly_pack` 的 `blocks`）。

**一次调用，两种产出**（`dream/weekly.py`，`WEEKLY_MODEL_MAX_TOKENS = 4000`，中文输出按字计 token 留足余量）：`{"title", "sentences": {blockId: 一句话}, "mutations":[…]}`。宿主用 `narrative::apply_narrative` 逐句收下：标题 ≤40 字、每句 ≤120 字，命中注入 / 密钥 / 内部 id 的丢弃，**句中出现的每个数字都必须出现在该区块的 `data` 里**（标题对全部区块的数字取并集；中文数字后跟量词也算），否则丢弃该句、区块照常显示。mutations 只有 **ADD / REINFORCE / SUPERSEDE / ARCHIVE** 四种，线格式就是所有认知提案共用的 `MemoryMutationProposal`；被采纳的变更以 `memoryChanges` 记在周记上。

**写入闸门（宿主，唯一咽喉）。** `dream.run_weekly` 收到 `{window, narrative, mutations, modelAvailable, droppedMutations}` 后（`commands/journal.rs::run_weekly_consolidation`）：

1. **引用必须在包内**（`WeeklyEvidence::admits`）：每个 `evidenceObservationIds` 都必须是宿主此刻重算的周包里出现过的 id，`targetMemoryId` 必须是包里的记忆，动作限四种，至多 8 条；否则直接拒绝（计入 `rejected`，不进校验器）。Python 侧先做同样的预过滤。
2. 其余走**既有的 M3 校验器**（`MemoryProposalValidator`，来源 `Consolidated`）与提升路径（`MemoryService::apply_cognitive_mutations`）：证据存在 / 同用户 / 作用域匹配 / 无注入与密钥标记 / 规范键与重复 / 目标仍 active；REINFORCE 还要求有晚于旧证据的新证据。通过者以 `dream` 身份提升，`created_by='weekly_dream'`，`source_class='consolidated'`；SUPERSEDE 与 ARCHIVE 只改状态，**从不删除**。校验通过但提升失败（目标已变、作用域已满）的候选被置为 `rejected`（`reject_pending_candidate`），不留 `pending`——pending 候选会作为“未验证”上下文泄漏给 coach。
3. 宿主重算窗口的区块、套上模型的句子后，把整份 `WeeklyReport`（`schemaVersion = 2`）以 JSON 存入 `weekly_digests`（0029，键为 run id），连同 header 数字一起持久化，札记不再现算。**不加列**：`dream_runs` 属于冻结的备份形状。v1 散文行仍可读入备份，但札记不再显示。

整个 M8 旧路径（`PatternProposal` / `validate_patterns` / `apply_consolidation`）仍在库里供开发期测试，**周任务不再使用**；`memory.candidate_pool` 能力已移除，weekly 运行的宿主方法白名单现在是 `learning.weekly_pack`、`model.invoke`、`dream.run_weekly`。

**重试分层（显式且有界）。**

| 层 | 谁负责 | 触发 | 上界 |
|---|---|---|---|
| 传输层 | 模型网关 `ai/runtime.rs`（`MAX_RETRIES = 2`） | 5xx / 429 / 超时 / 连接错误 | 一次 `model.invoke` 内；**weekly 的 `model.invoke` 取 0 次**（`RunKind::model_transport_retries`），避免与下一层相乘 |
| 语义层 | sidecar `dream/weekly.py`（`MODEL_MAX_ATTEMPTS = 3`） | 网关标记为 retryable 的 provider 错误/超时；**畸形或非法输出**（非 JSON、形状错、`digest` / `mutations` 类型错、无内容；`{}` 不算“想清楚的空答案”） | 首次 + 2 次重试，退避 2 s、5 s；剩余时间装不下“退避 + 5 s”就不再重试 |
| 尝试层 | worker | 一次尝试仍失败 | 记为 failed（`record_failed_weekly_run`），**每个本地日最多一次尝试**，在其后的任何一天继续，直到该周末完成 |

一次 weekly 因此最多 3 个 provider 请求。不可修复的失败（401 / 400 等非 retryable、超出 deadline）立即失败，不重试。**空结果（没有可成立的内容）是成功**，不重试、不算失败。weekly 一次运行的宿主预算为 420 s（`WEEKLY_REQUEST_TIMEOUT`），sidecar 自限 400 s。

**失败语义。** provider / 超时 / 模型输出不合法 / sidecar 失败，一律记为 **failed 的 dream run**（锚定在窗口终点当日的日记上），不是“无事可整合”；`weekly_run_completed` 仍为 false。Python 侧同样 fail closed。失败的尝试也会存下当周的区块（`state = narrative_failed`），札记照常显示数字，只是没有模型写的句子；之后某天成功时由 completed 的那份取代。**没有配置模型**时不调用 sidecar：该周末直接记为 completed（输出哈希 `no-model`），周记状态为 `final_no_ai`，只有区块与默认标题（“这一周读了 N 篇，写了 M 篇”）。

**札记。** `weekly_report_list` 返回已存的周记（同一窗口 completed 优先于 failed，最新窗口在前，没有区块的不返回）；`weekly_report_current` 返回**本周到目前为止**的实时版本（`state = live`，从上一个完成窗口的终点到现在，确定性计算、不调模型；没有练习时为 `null`）。札记页按 `windowStart` / `windowEnd` 标注范围（例如“9月19日 – 10月10日”），逐个区块排版：小图、数字、一句话（有则显示）、例子链接。状态 `live` 标“本周进行中”，`final_no_ai` 与 `narrative_failed` 明示“没有 AI 总结”，周末之前的周中只看到实时版本。

**测试时钟。** 宿主的 `app::clock::now()` 在设置了 `IELTS_ATLAS_FAKE_NOW`（RFC3339）时返回该时刻，打包 E2E 用它把一次启动放在周三、再一次放在下周日 10:00，配合假模型的 weekly 分支跑完整的周记路径（`developer/tests/e2e/test_packaged_weekly.py`、`packaged_tauri_flow.py` 的 `weeklyReport` 检查）。

### 2.4 AI 阅读复盘：opt-in 且幂等

- 提交与回放**都不**自动发起复盘。`useReadingCoach.ts:3-6` 的注释即合同；`runAutomaticReviewCoach` 只有两个调用方：复盘面板的重试按钮（`PracticeReadingPage.vue:359`）与 coach 快捷动作 `review`（`useReadingCoach.ts:627-630`）。（函数名里的 “Automatic” 是历史遗留，不代表自动触发。）
- 主机侧幂等：`CoachService::run` 在 `action == review_set` 时先查 `find_completed_review`，已有 completed 的回答则直接返回，不再调用模型（`coach.rs:66-72`；`ielts-db/src/coach/mod.rs:335-359`）。失败或未完成的复盘不算结果，可重试。
- `readingAttemptReviewV1`（`feature-flags.js:17`）控制的 `agent_run_attempt_review` 是另一条 agent 路径，默认关，用户点击才触发。

### 2.5 不进入发布产品路径的部分

| 项 | 现状 | 证据 |
|---|---|---|
| Shadow / canary / eval / LLM grader | Python `eval/` 不被 sidecar 运行时引用；sidecar 入站分发有意不提供 `eval.run_case` | `cognitive_runtime.rs:1319,1865-1871`；`runtime.py` 无引用 |
| LLM grader | 仅 `eval/graders.py:322`（`maxTokens: 32`），只在 eval 中使用 | 同上 |
| Embedding | `enable_embeddings=False`；宿主 embed 默认不支持 | `retrieval/planner.py:48`；`ports.rs:109-115` |
| LLM rerank | `enable_rerank=False` | `retrieval/planner.py:49` |
| Memory 候选提取 | `memory_generate_candidates` 受 `developer-tools` feature 门控，release 不编译 | `commands/memory.rs:84-88`；`lib.rs:166-167`；`Cargo.toml:72`（该 feature 不在 `default` 中） |
| Daily journal enrichment | `JournalEnricher` 只在包内导出，没有运行时或宿主入口调用；daily 本身没有任何 sidecar 入口 | `dream/__init__.py` 之外无引用 |
| Python 版 personalized coach | 同样未接入 sidecar 分发；发布路径的 coach 是 Rust `CoachService` | `runtime.py` / `protocol.py` 无引用；`commands/enrichment.rs:179` |
| 教学策略 / Prompt / Skill 命令 | 仅 `developer-tools` 下编译并注册；发布构建没有这些命令；无前端与 worker 调用，命令内不调模型 | 第 1.2 节 |

结论：发布构建中，**会触发模型调用的只有**写作评估、coach 回答（含用户点击的复盘）、provider 探测、weekly dream，以及默认关闭的 agent 路径。

### 2.6 Coach prompt 的缓存稳定布局

`build_request`（`coach.rs:151-221`）按“从最稳定到最易变”排列，使 provider 端前缀缓存命中最长：

1. **system**：固定文本（含 `evidence_first_v1`）。
2. **evidence**：宿主解析的 `identity / result / source / evidenceLimitations`，同一 attempt 的每个回合字节一致（`ielts-db/src/coach/context.rs:10-19,174`）。
3. **history**：**只追加**。从线程起点回放，累计成本超过 `COACH_HISTORY_TOKEN_BUDGET = 8000`（`coach.rs:21`）时，**一次性丢掉最旧的一半**（`history_window_start`，`coach.rs:226-241`，`div_ceil(2)`）。两次裁剪之间，窗口起点不动，相邻回合共享整段历史前缀。载入上限 500 条，大到不会让窗口滑动而改变回放裁剪点（`coach.rs:15`）。
4. **最终 user 消息**：易变的 request controls（`controls / selectionQuote / selectionIsEvidence`）+ 当前问题。

输入预算 = `CONTEXT_HARD_TOKEN_CEILING(32000) − 输出上限(2000) = 30000`（`coach.rs:31`）。证据加当前问题超预算则直接报 `coach.input_budget_exceeded`，不会截断证据；兜底循环只会删旧历史（`coach.rs:197-214`）。

**CJK 估算**：`estimate_tokens`（`ielts-domain/src/context.rs:188-195`）对 CJK 标量按 1 token/字，其余标量每 4 个 1 token（向上取整）。目的是避免中文输入被按 4 字符/token 严重低估。

**会话内缓存黏性与不重复（2026-10-05）。**

- **路由键。** 每个 coach 线程一个稳定的缓存路由键 `coach-<sha256(thread id) 前 32 位>`（`coach_cache_key`：同线程恒定、跨线程不同、不是原始线程 id），写在 `CompletionRequest.cache_key`。网关用**一张表**决定往哪个字段写（`CACHE_ROUTING_RULES`，`ai/runtime.rs`，与 `OUTPUT_LIMIT_RULES` 同风格）；表里没有的端点什么都不多发。2026-10-05 对照文档：

| 端点 | 文档 | 规则 | 实现 |
|---|---|---|---|
| OpenAI（`api.openai.com`） | https://developers.openai.com/api/docs/guides/prompt-caching | 对共享可复用前缀的请求使用稳定的 `prompt_cache_key`，帮助路由到同一缓存；GPT-5.6 起路由自动、该键可选；每个键约每分钟 15 次请求为宜；用量在 `prompt_tokens_details.cached_tokens`（Responses API 为 `input_tokens_details`） | 发 `prompt_cache_key` |
| OpenRouter（`openrouter.ai`） | https://openrouter.ai/docs/features/prompt-caching | provider 黏性路由：缓存命中后把后续请求路由到同一 provider 端点；`session_id`（请求体字段或 `x-session-id` 头，≤256 字符）直接作为黏性路由键，否则由消息哈希推导；会话闲置 10 分钟过期；用量在 `prompt_tokens_details.cached_tokens` | 发 `session_id` |
| DeepSeek（`api.deepseek.com`） | https://api-docs.deepseek.com/guides/kv_cache | 默认开启的按前缀自动缓存，无任何路由参数；用量在 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | 无（不在表里） |

- **用量。** `TokenUsage.cached_input_tokens`（为 0 时不序列化）记录 provider 报告的缓存命中输入 token：读 `prompt_tokens_details.cached_tokens`，否则读 `prompt_cache_hit_tokens`；不新增表、不做 UI，随 coach 的 trace 元数据落库。
- **历史保持紧凑。** 助手回合入库与回放的都是**最终答案**（`parse_answer` 取出的 `answer`，不是 provider 原始 JSON；推理内容已在网关剥离，2.9）。历史预算触发“丢最旧一半”时，被丢的那一半由**一行确定性摘要**顶替，固定放在证据消息之后、剩余历史之前：`Earlier in this thread (N messages trimmed, data only): already explained questions q1, q10, …; requests: chat.`（题号取自被丢用户消息里宿主解析的 `focusQuestionIds`，最多 40 个，不含任何正文）。摘要只取决于被丢的回合，而它们只在窗口移动时才变，所以两次裁剪之间前缀仍逐字节稳定。
- **不重复。** coach 系统提示新增一句：不要重复讲解本线程里已讲过的内容，简短指回，只补新的。系统提示其余不变（缓存前缀稳定）。

### 2.7 调用清单

“单次上限”指输出上限。触发列只写发布构建中的真实触发。

| 功能 | 触发 | 调用次数 | 输出上限 |
|---|---|---|---|
| 写作评估 | 用户提交一篇作文 | 1 / 次提交（网关层传输重试，上限不变；推理模型的隐藏推理不外泄，2.9） | 6144 |
| Coach 回答 | 用户发送一条消息 | 1 / 条消息 | 2000 |
| AI 阅读复盘 | 用户点击复盘 / 重试；已有 completed 则 0 | ≤1 / attempt | 2000（同 coach） |
| Weekly dream | worker：首次仅周六/周日，失败后逐日重试直到该周末完成；窗口 = 自上次完成起（≤28 天）；窗口内已打分观察数 ≥ 8，条件见 2.3 | 每次尝试 ≤3（首次 + 2 次重试）；每本地日 ≤1 次尝试；成功后该周末不再调；证据不足 0 次 | 1500 |
| Daily journal（= daily dream） | worker / 札记“整理今天” | 0（只做确定性摘要，无 proposal） | — |
| 反馈、再问、对错链接 | 用户动作 | 0 | — |
| Provider 探测 | 用户在设置中点测试 | 1 / 次点击 | 16（推理模型族 1024） |
| Agent 单轮 | 仅 `/dev/agent` 或 `readingAttemptReviewV1`（默认关） | 每轮 1，用户发起 | 1500 |
| Memory 候选提取 | 仅 `developer-tools` | 开发期手动 | 2000 |
| Daily enrichment | 未接线 | 0 | （1500，未使用） |
| Embedding / rerank / eval / shadow | 不进入产品路径 | 0 | — |

### 2.8 典型日估算与边界

以下是 owner 在 2026-10-04 复盘时给出的**估算，不是实测**：

| | LLM 调用次数 | 输入 token | coach 输入可缓存比例 |
|---|---|---|---|
| 改造前 | ≈ 17 | ≈ 93k（无缓存命中） | 0 |
| 改造后 | ≈ 11–14 | ≈ 61–77k | ≈ 85% |

估算中未保存逐项假设，使用时只当数量级参考。仓库内没有 token 用量埋点汇总，本文也不新增（见下）。

**明确不做**：预算、日/月配额、用量账本、成本 UI。成本控制靠上面的**结构性规则**（调用次数有界、输出有上限、前缀可缓存），不靠运行时计量。

**计费方向**：产品将同时支持 BYOK 与托管 key。托管 key 的配额若将来需要（订阅档），必须放在**服务端代理**，不能放客户端（客户端可被绕过）。目前不存在该代理，也不在当前范围内。

### 2.9 推理模型：只保留最终答案

规则：**推理内容（chain-of-thought）永不持久化、永不展示、永不转发给任何调用方或 Python sidecar。** 唯一实现点是模型网关响应解析器 `src-tauri/src/ai/runtime.rs`，所以 coach、写作评估、provider 探测、agent 循环、sidecar `model.invoke` 拿到的都是干净的最终内容。

| 形态 | 处理 |
|---|---|
| 独立字段 `reasoning_content`（DeepSeek）、`reasoning` / `reasoning_details`（OpenRouter） | completion 路径不解析、不转发 |
| 内容块 `[{"type":"thinking"/"redacted_thinking"/"reasoning"}, {"type":"text"}]` | 只保留文本块 |
| 内联 `<think>…</think>` / `<thinking>…</thinking>`（Qwen / R1 类网关，大小写不敏感，可多段） | 剥离 |
| 未闭合的开头 `<think>`（输出在思考中被截断） | 整段视为思考，最终内容为空（调用方按“无内容”处理；weekly 会因此重试） |
| 只有 `</think>` 没有开头（模板把 `<think>` 放进了 prompt） | 其之前的内容视为思考 |
| 流式增量 | 本网关不使用流式（每次调用一个 JSON 响应）；若将来使用，增量必须经过同一过滤器 |

**工具调用。** agent / 工具循环只使用 provider 的结构化 `tool_calls`，**绝不从推理文本或正文里解析工具意图**（有测试：推理或正文里写出的“工具调用”不是调用）。

**多轮工具循环回传。** 2026-10-05 核对官方文档（见下）后的规则：

| Provider | 文档 | 规则 | 本实现 |
|---|---|---|---|
| DeepSeek | https://api-docs.deepseek.com/guides/thinking_mode | 请求带 `tools` 时，工具调用回合的 `reasoning_content` **必须**在该回合后续请求中原样传回；不带 `tools` 的多轮无需回传 | 工具回合：回传 |
| OpenRouter | https://openrouter.ai/docs/use-cases/reasoning-tokens | 带工具时须把 `reasoning_details`（及 `reasoning`）原样传回以保持推理连续；用量在 `usage.completion_tokens_details.reasoning_tokens` | 工具回合：回传 |
| OpenAI | https://developers.openai.com/api/docs/guides/reasoning | Chat Completions 不返回推理文本，无物可回传（“回传 reasoning item”是 Responses API 的规则，本网关不用）；推理 token 在 usage 中 | 无 |

因此：带 `tool_calls` 的 provider 回复，其回传字段保存在内存里的 `ReasoningEcho`（`ielts-application/src/agent.rs`；`Debug` 脱敏、`serde(skip)`），只在**这一次 `AgentService::run` 循环**的后续请求里原样带回；**从不写库、不进日志、不出现在任何序列化结果或审计 JSON 里**，循环结束即丢弃。不带工具调用的最终回复不携带回传字段。

**用量。** `TokenUsage` 新增 `reasoning_tokens`（`ports.rs`，默认 0，为 0 时不序列化）：provider 单独报告时记录推理份额，`output_tokens` 仍是 provider 的完成总数（其中已含推理）。不新增表、不做 UI。

**输出上限不变。** `OUTPUT_LIMIT_RULES` 的字段名与 1024 下限照旧生效（有测试在带回传的 agent 请求体上断言）。

---

## 3. 产品 / UI 决策

### 3.1 视觉语言

规则的唯一来源是 `apps/writing-vue/src/styles/design-system/tokens.css` 文件头注释（第 1-27 行）：暖纸色单一画布；1px hairline 分隔（墨色约 12%）；圆角 0–2px；**无** pill、卡片、阴影、统计块（stat tile）；页面标题、章节标题、长文用衬线（行宽约 66ch，行高约 1.7），控件 / 表格 / 元数据用无衬线，数字用等宽数字；clay 色稀用（链接、焦点环、每个视图至多一个主操作）；状态用“文字 + 小方块标记”，不用彩色徽章；表格按 booktabs 风格；动效仅短淡入，尊重 `prefers-reduced-motion`。

这些规则是“靠评审执行，不靠代码强制”（头注释原话）。新页面以该头注释为准，不在别处另立样式规范。

### 3.2 阅读考试页冻结

`PracticeReading`、`PracticeReadingSuite`、`PracticeReadingReview` 三个路由（`main.js:59-77`）是刻意冻结的第二套主题（CD-IELTS 模拟），使用 `styles/design-system/exam-frozen.css` 的独立 token，不跟随外壳换肤。

守卫：`developer/tests/e2e/exam_freeze_visual_check.py`——按桌面 / 平板 / 手机三个视口，对三条路由各抓“冷加载”与“先访问 Library 再进入”两种截图，与基线比对（计算样式与矩形为硬门禁，像素差异仅作容差内兜底），用于发现外壳样式泄漏；基线随仓库提交于 `developer/tests/e2e/baselines/exam-freeze/`，仅在有意改动后用 `--update-baseline` 显式重写并审阅 diff。

基线随仓库提交，位于 `developer/tests/e2e/baselines/exam-freeze/`；每次运行的输出写入被 `.gitignore` 忽略的 `developer/tests/e2e/reports/exam-freeze/current/`。

### 3.3 札记（Notebook）取代面向用户的 agent 控制台

- 路由 `/notebook`，导航名“札记”（`main.js:39-42`，`NavBar.vue:38`）；`/memory-center` 重定向到它（`main.js:43-47`）。
- 内容：按日的日记条目与按周的周记条目（**区块，不是散文**：每个区块是一张小图或一组数字、模型写的一句话与可点开的练习例子；周中显示实时版本，周末后显示定稿，2.3）；“下一步练习”；“关于你，我们记住了”——每条记忆**只有两个操作：不准确、忘记**（`NotebookPage.vue:161-170`）。“不准确”记 `inaccurate` 反馈，不删学习事实；“忘记”需确认，且删除该句及其依据，不影响练习记录。
- **不出现**：审批队列、待处理计数、候选数量、置信度、Dream Report 的 approve/reject/edit。
- 页面头部的“整理今天”是用户主动触发当天的确定性整理，不调模型。
- 视觉回归：`developer/tests/e2e/notebook_visual_check.py`（撰写时为未跟踪文件）。

### 3.4 Agent 工作台降级为开发者界面

- 路由 `/dev/agent`，**仅当** `agentWorkspaceV1` 为 true 时注册（`main.js:48-54`）；该 flag 默认 `false`（`feature-flags.js:13`，环境变量 `VITE_FEATURE_AGENT_WORKSPACE_V1`）。
- `/agent` 旧路径：flag 开则去 `/dev/agent`，否则去 `/notebook`（`main.js:55-58`）。
- 不在用户导航中出现。

### 3.4.1 导航

用户导航为 **阅读 · 写作 · 札记 · 历史 · 设置**（`NavBar.vue:32-40`）。唯一例外：`learnerModelV1` 打开时在写作与札记之间多一项“技能”，该 flag 默认关，所以默认导航就是上面五项。从历史打开的记录会让“历史”保持高亮。

### 3.5 统一历史 `/history`

一个页面覆盖阅读 / 写作 / 听力（`main.js:95`）。数据层只有一种规范化记录与两张表，位于 `apps/writing-vue/src/modules/history/records.js`：

- 记录形状：`{ id, activity, kind, title, subtitle, occurredAt, durationSec, score, detailRoute, meta, raw }`（文件头注释）。
- `ACTIVITIES`（`records.js:36`）：每个活动的展示数据（标签、分数过滤、趋势、汇总、空态、起点）。`reading` 与 `writing` 完整；`listening`（`:95`）已有条目。
- `adapters`（`records.js:130`）：把视图模型转成规范化记录；**没有 listening 适配器时走 `fallbackAdapter`**（`:145`），行仍可读，且有记录时活动页签自动出现。
- 约束：消费方不得按活动名分支；新增活动 = 两张表各加一项。

---

## 4. 被取代的 v1.3 条款

| v1.3 条款 | 原内容 | v1.4 处置 | 代码依据 |
|---|---|---|---|
| **18.6** Dream Report UI；**25.4 D-06** | 第一阶段所有 proposal 需用户逐条 review（approve/reject/edit） | **取代**：低风险变更自动生效，用户事后可用“不准确 / 忘记”撤销。无逐条审批 UI | weekly 模式经宿主校验后直接成为 active memory（`consolidation.rs:150-163`）；校验是单一咽喉（`:612-640`：长度、安全标记、证据存在性）；札记只提供两个撤销操作 |
| **18.3–18.4** Memory Center（六标签、五按钮）；**M9**（Memory Center / Evidence UX） | 完整的记忆管理中心 | **取代**为札记页（3.3） | `MemoryCenterPage.vue` 已不存在；`/memory-center` 重定向 |
| **18.2** Agent 工作台改造；**14.14** 工作台定位；**M12 的 UI 部分** | 工作台作为重要入口 | **降级**：仅开发者界面 `/dev/agent`，flag 默认关（3.4）。M12 的后端（线程、计划、受控动作）保留 | `main.js:48-58`；`feature-flags.js:13` |
| **11.2 Level 1** Session Close Reflection | 会话结束时的 LLM 总结 / 候选提取 | **移除**：不存在这次调用 | 代码中没有 session-close 的调用点（对 `crates/`、`src-tauri/`、`agent-runtime-python/src`、`apps/writing-vue/src` 检索无匹配） |
| **16** 产品级 Prompt/Skill 自进化；**M10–M12 的 shadow / canary**；**M11** | 应用内 shadow / canary / 提升 | **仅开发者侧，不随产品发布**。DB 表与命令作为合同保留，不作为产品功能运行 | 2.5 |
| **M7 的 daily dream proposal**（REINFORCE / REFINE / IMPROVE / REGRESS / CONTRADICT / NOOP 候选）；**M7-06～M7-08** 的 daily 编排与容量约束 | 每日生成 memory 候选 | **移除**：daily 只做确定性摘要（日记）；所有记忆整合只在 weekly。`dream_candidates` 表保留但无人读写 | 2.1 规则 2；`daily_dream.py` / `capacity.py` / `record_job_dream_proposals` 已删除 |
| **M8** “上一个已完成 ISO 周 / 每周每天最多重试一次 / 前置在 daily dream 之后”；ADR-M8 的 `memory.candidate_pool` 与跨 scope pattern 提案 | weekly 的调度、输入与产出 | **取代**：首次仅本地周末、失败后逐日重试直到完成；窗口 = 自上次完成起（≤28 天）；幂等键 = 最近一个周末所在 ISO 周；输入是窗口内真实练习记录（周包），一次调用产出标题与每区块一句话 + 记忆变更（周记区块由宿主确定性计算）（ADD / REINFORCE / SUPERSEDE / ARCHIVE）；`memory.candidate_pool` 能力移除、改为 `learning.weekly_pack` | 2.3 |
| **M10 / M11** 的 Tauri 命令随发布构建注册 | 命令在发布 handler 中 | **取代**：仅 `developer-tools` 下编译与注册 | 1.2；`lib.rs` handler |
| **11.12** Dream 成本控制 | 每日 token / cost hard limit、按 event group 调用等 | **由本文第 2 节取代**：以结构性规则控制成本，不做运行时硬限额与成本计量 | 第 2 节 |

补充说明：

- 18.6 的原文还写“后续只有低风险重复合并和过期归档可自动应用”，25.4 的 D-07 也写“低风险 auto policy 是 Rust 确定性逻辑”。本次决策把它收敛为单一原则：低风险自动生效、事后可撤销，不再分“第一阶段全审 / 后续放开”两段。
- **daily 不再产生 proposal。** 历史库里已有的 `pending` `dream_candidates` 行原样保留、无人消费；`memory_promote_candidate` 命令仍注册，但没有前端调用。真正产出 active 记忆的整合路径只有 weekly。

---

## 5. 开放事项

1. **Edge WebDriver 版本（已处理）**：`developer/tests/e2e/webdriver_select.py` 现在读取已安装的 WebView2 运行时版本（注册表 `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` 的 `pv`，再回退 HKLM 原生键与 HKCU），按顺序在本机已有的 driver 里挑**大版本一致**的：`TAURI_NATIVE_DRIVER`、PATH、`%TEMP%\ielts-msedgedriver-<版本>`、`%LOCALAPPDATA%\IELTSAtlas\webdriver`、Edge 安装目录。找不到匹配的则以 blocked 报告并给出可执行的修复步骤；**不下载任何东西**（下载仍由 `install_edge_webdriver.ps1` 在 CI 完成）。所选 driver、被跳过的 driver、运行时版本都写入 E2E 报告 metadata。
2. **`phase3_migration` 迁移数（已处理）**：`crates/ielts-db/tests/phase3_migration.rs` 的 `migrate_function_transactional_versions` 现在枚举到 `1..=26`（含 0025、0026）。
3. **Weekly 尚未对真实 provider 验证**：整条链路（周末窗口、周包、有界重试、失败记账、每日重试上界、幂等）有单元 / 合同测试，但没有用真实模型跑过一次。首次真跑要重点看：输出 JSON 的合法率与重试命中率、failed 记账是否按预期阻止同日重试、折叠窗口的行为、写出的 `weekly_dream` 记忆质量；推理模型（DeepSeek / OpenRouter）的真实响应形态是否都被 2.9 的解析覆盖。
4. **exam-freeze 基线已入库**：基线位于 `developer/tests/e2e/baselines/exam-freeze/`（计算样式与矩形为硬门禁，像素差异为容差内兜底）。有意改动冻结路由后，在已知良好的 dist 上运行 `exam_freeze_visual_check.py --update-baseline`，审阅 diff 后提交；默认运行永不写基线。
5. **工作树未提交**：札记页、`modules/notebook/`、`notebook_visual_check.py` 等在撰写时仍是未跟踪文件；本文所述行为以该工作树为准。
6. **M10 / M11 命令（已处理）**：现仅在 `developer-tools` 下编译与注册（见 1.2 末尾）。需要这些命令的开发期流程要带 `--features developer-tools` 构建。
7. **weekly 的输入来源（已处理）。** 原先 weekly 池只取 `memory_items`，发布构建里写入它的只有用户显式偏好与 weekly 自己，普通用户的 weekly 没有输入。现在输入是窗口内的真实练习记录（2.3 的周包），推断类记忆只由 weekly 写入。仍未做的：回看旧 attempt 只能用“新开 coach 线程”近似（账本没有“重新打开”事件）；coach / review 行引用的是 attempt 得分观察（coach 观察命名空间不在 M3 校验器认得的 reading / writing 之内）；周报摘要已迁入 `weekly_digests` 表（0029，见第 8 节）。
8. **weekly 的 sidecar 时间预算是按估算设的**（宿主 420 s、sidecar 400 s、3 次调用、退避 2/5 s）；provider 超时默认值与上限（5–300 s）下，最坏情况会因预算用尽而少于 3 次调用，首次真跑后再校准。

---

## 6. 核对记录（相对修订任务说明的更正）

动笔前逐条对照代码，以下几处与最初的说明不一致，文中已按代码为准：

1. **0025 的文件名**是 `0025_prompt_release_predecessor.sql`；`prompt_skill_releases` 是它**新建的表名**，不是文件名。
2. **Daily enrichment 的 1500 上限**：常量存在，但 `JournalEnricher` 没有任何运行时调用点，所以它在调用清单里是“未接线”，不是活跃调用。
3. **Coach 的实现位置**：发布路径的 coach 是 Rust `CoachService`；Python 的 `personalized_coach.py`（同样 2000）没有接入 sidecar 分发。
4. **导航**：默认五项成立，但 `learnerModelV1` 打开时会多一项“技能”。
5. **“低风险自动生效”的落点**：现状只有 weekly 整合会直接写 active 记忆；daily dream 的 proposal 是 `pending` 且无人消费（第 4 节补充说明）。
6. **M10 / M11**：不是“已移除”，而是命令仍注册、产品路径不调用。
7. **“AI 阅读复盘 opt-in”**：成立，但函数名仍叫 `runAutomaticReviewCoach`，且主机侧的幂等复用是 `review_set` 专用逻辑。
8. **estimate_tokens**：不是通用 4 字符 / token，对 CJK 单独按 1 token / 字。

---

## 7. 验证

```bash
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

另外：`cargo check -p ielts-practice-tauri --features developer-tools --tests --locked`（发布构建不含的开发期命令）已列入静态套件；E2E harness 自检（`test_packaged_receipts`、`test_webdriver_select`）同样在静态套件里。

文档登记：新文件放在 `developer/docs/`，从 [INDEX.md](INDEX.md) 链接。`check_doc_drift.py` 只检查 `ADR-*.md`、`*_STAGE_GATE_REPORT.md` 和 `INDEX.md`（迁移文件引用必须存在、本地 `.md` 链接必须可解析、Tauri 命令上下文里的命令 token 必须已注册）；v1.3 与本文不在其检查范围内，但本文的迁移名与链接仍按同一规则写成可解析的。

---

## 8. 数据隔离与防误删

原则：练习记录与用户写下的文字是**唯一不可再生**的数据；其余一律可以重算或按年龄清理。删除只允许用户明确发起的路径，删除前有快照，备份恢复是替换而不是合并。

### 8.1 数据分类

| 类 | 内容 | 删除规则 |
|---|---|---|
| A 原始事实 | `attempts`、`attempt_answers`、`attempt_annotations`、`writing_evaluations`、`writing_drafts`、`coach_threads`、`coach_messages`、`explicit_user_preferences`、`vocabulary_*` | 只能经过删除门（8.2）删除；从不因保留策略自动删除，除非用户自己设了上限 |
| B 持久派生 | `learning_events`（账本）、记忆、日记、周报摘要 `weekly_digests` | 不被 A 的级联带走（0028 为 RESTRICT）；删 attempt 时由显式路径一并删掉该 attempt 的账本行并重投影 |
| C 可重建投影 | `learner_observations`、学习者状态、检索元数据 | 随时重建 |
| D 运行痕迹 | `agent_runs`、`agent_tool_calls`、`agent_context_snapshots`、`llm_invocations`、`retrieval_runs`、已完成的 `background_jobs` | 按 90 天年龄清理（`prune_operational_records`，每日 worker 每 24 小时一次） |

### 8.2 删除门（migration 0030）

- `delete_gate` 单行表；A 类每张表有 `BEFORE DELETE` 触发器，门关闭时 `RAISE(ABORT)`。级联删除也会触发这些触发器，所以不能绕过门删 `attempts` 进而删掉其答案、批注与评分。
- 唯一的开门方式是 `ielts_db::safety::with_delete_gate`：在 SAVEPOINT 内打开门，成功时还原原值并释放，出错时回滚整段工作并关门。调用方只有显式用户路径：单条 / 批量删除历史、清空历史、用户自选的保留上限裁剪、删除批注与词汇、整组替换答案、备份恢复、档案导入。
- 已知豁免：`upsert_attempt` 保存草稿时替换该 attempt 的答案集合（学习者清空的答案必须真的消失），同样经由门；这是用户自己的写入，不是删除。
- 限制（SQLite 规则）：`DROP TABLE` 与 `INSERT OR REPLACE` 的隐式删除不触发触发器。需要重建 A 类表的迁移必须自己负责复制数据（见 0028 的做法）。

### 8.3 快照（pre-destructive snapshot）

- 在以下操作前写 `VACUUM INTO backups/pre-<op>-<unix-ms>.db`，写入后校验 schema 版本与 attempt 数，`.tmp` + fsync + 改名：恢复（`restore`）、清空历史（`clear-history`）、批量删除（`bulk-delete`）、会裁剪的保留上限变更（`retention-prune`）、待执行的迁移（`migrate`，启动时 `migrate_with_snapshot`）。
- 快照失败则操作不执行（失败关闭）。迁移失败时数据库未被改写，启动给出可读错误而不是 panic。
- 只保留最近 3 个 `pre-*.db`；不匹配命名模式的文件（如用户自己的 JSON 备份）不动。
- 没有周期性备份：快照回答的是“刚才那次操作之前是什么”。

### 8.4 默认无限与显式上限

- 迁移 0027：未被用户改过的保留策略（仍带 0008 的 `...Z` 戳且值为 100）改为 `NULL`（不限）。新安装直接为不限。提交练习不会裁剪；只有用户在设置里选了数字才会裁剪。

### 8.5 备份格式 18

- `attempts` 摘要数组不再写入（每条记录只在 `database` 里出现一次）。格式 17 及更早的包仍可恢复，测试 `format_17_backup_with_a_summary_array_still_restores_and_carries_digests` 与 `backup_full_roundtrip` 覆盖。
- 恢复是替换：干跑（dry run）返回 `delta.current` 与 `delta.incoming`（练习、作文评分、教练消息、记忆），设置页在确认框里逐项展示。
- 周报摘要移到 `weekly_digests`（0029），旧版 `settings` 里 `weekly_digest` 行在迁移与恢复时搬入；`weekly_digest_list` 的响应形状不变。

### 8.6 宿主白名单与确认令牌

- `upsert_setting` 只接受前端实际写入的命名空间：`app`、`frontend-preferences`（`check_webview_setting`，并拒绝宿主自有的 `app/history_limit`）。`secret_refs`、`weekly_digest`、`reading_draft`、`features` 等一律拒绝。
- `delete_history_attempts` 单次最多 200 个 id（`HISTORY_DELETE_MAX_IDS`，在 ielts-db 校验）。
- `clear_history` 需要单次使用的令牌：界面在用户输入确认词后调用 `history_issue_clear_token`，令牌 120 秒内有效、绑定 activity 范围、用一次即失效（`ClearHistoryTokens`）。设置页“清空”与历史页“清空”都走这条路径。

### 8.7 不做的事

- 没有通用的“软删除回收站”。删除门加快照已经覆盖误删的恢复路径，回收站会引入第二套可见性规则。
- 没有周期性整库备份。
- 没有对 B / C 类的自动删除。

### 8.8 验证

- `crates/ielts-db/tests/data_safety.rs`：默认不限且提交不裁剪；显式上限才裁剪；门阻止直接删除与级联；门在出错后关闭且回滚；用户路径经由门；账本 RESTRICT 与显式删除只清自己的账本行；快照生成、轮转为 3、非法名与事务内拒绝；待迁移快照；运行痕迹按年龄清理不碰原始数据；周报摘要表迁移；格式 18 原子写入；格式 17 恢复；干跑差值。
- `src-tauri/src/commands/settings.rs`、`history.rs` 的单元测试：命名空间与键白名单；令牌单次使用、范围绑定、过期、伪造拒绝。
