# Round 3 整改进度

## 2026-08-31

- 读取 `planning-with-files` 技能与 session catch-up；未发现需要恢复的未同步会话。
- 读取 Round 3 审计报告：确认倒序从路线图第 15 项开始，优先文档冻结、入口索引、drift 机制。
- 核对工作树：既有 `.zcode/` 与审计报告未跟踪，均保留。
- 下一步：并发派发 2 个只读探子，分别核验文档权威入口/drift 规则与最新 gate/ADR 的可引用事实。

- 第一批探子曾因误读确认条款未执行，已关闭并重派；第二批扫描范围较重，暂未返回结果，现已按用户要求恢复继续工作。
- 已完成路线图 15/13/14/11 的第一批治理改动：冻结 v1.3 历史合同、建立 `developer/docs/INDEX.md`、增加 `check_doc_drift.py` 并接入静态套件、为 M6-M12 加 Round 3 post-audit addendum；待运行 drift checker 后再继续代码缺陷批次。
- 已补 M3-M5 历史 gate 口径，并修正 M12 整体完成语义；探子 2 的证据与改动坐标已复核。
- 文档治理验证：`python developer/tests/ci/run_static_suite.py` 28/28 pass；`python developer/tests/e2e/suite_practice_flow.py` 16/16 pass。
- 当前进入路线图第 10 项：strategy candidate promotion 的 eval 证据化设计与实现。
- 两名探子已完成路线 10/9 的只读核验；按用户要求，超过约 10 分钟未返回不登记异常，探子继续后台工作直至完成。
- 路线 10 取舍：M10 与 M11 候选 ID/生命周期分离；新增 M10 批次级持久化 eval 表，promotion 在 Rust 事务内读取最新通过 verdict，拒绝调用方布尔值越权。
- 路线 10 实现：新增 migration 0023、Rust/domain/application/Tauri 评估记录入口；promotion gate 改为事务内读取最新 eval，补充无评估、失败最新评估、拒绝后反转回归测试；备份 schema 升至 16 并保留 v15 快照兼容。
- `cargo fmt --all -- --check` 未通过，报告的是仓库既有跨模块格式差异（未触及的 agent/memory/journal 等文件也在其中）；未执行全仓格式化，避免无关变更。
- 首次静态门 27/28：唯一失败为 `crates/ielts-db/tests/learner_model.rs` 的迁移序列/当前版本断言仍停在 22；已将其更新为包含 23，准备重跑。
- 第二次静态门 27/28：下一个旧断言位于 `crates/ielts-db/tests/learning_events.rs`；全仓检索确认这是剩余唯一硬编码 `[12..22]`/version 22 的升级断言，已统一更新为 23。
- 第三次静态门仍 27/28：`learning_events.rs` 同一测试底部还有重复 version 22 断言；扩大检索后另发现 `phase3_migration.rs` 的 fresh-db 断言，均更新为 23。
- 目标测试：`learning_events` 6/6 pass；`phase3_migration` 4/5，剩余失败为同文件 fresh migration 序列 `[1..22]`，已更新为 `[1..23]`，全仓同模式无剩余匹配。
- 静态门最终通过：28/28；其中文档 drift、Vue typecheck/build、Rust workspace、Python protocol 与 data-truth regressions 均通过。现有编译警告为未修改的 `consolidation.rs`/`AgentCancelRegistry` 可见性问题。
- 路线 8 复核探子返回并已关闭：确认 Python runtime dispatch、Context `rr-*` FK、archive 列错位、learning ledger CASCADE、dream_candidates 死信、Coach token ceiling、sidecar 敏感 RPC 与 webview weekly payload 仍未修复；证据已写入 findings.md。
- 当前 M10 修复缺口重新确认：`RecordStrategyCandidateEvaluationCommand` 仍允许 IPC 调用方提交 `passed`/`metrics`，Rust 只负责原样持久化；下一步改为仅接收 batch_id，由 Rust 受控评估器生成 verdict 与 metrics，并补充伪造 verdict 回归测试。
- M10 evaluator 首次定向编译发现空数组 match 的 `&Vec<Value>`/slice 类型不兼容；已统一候选集合为 `&[Value]`，准备重跑。
- M10 Rust evaluator 已完成：评估命令仅保留 `batchId`，从持久化 batch + developer catalog 计算固定版本结构 verdict/metrics；合法样本可晋升，非法样本记录失败；新增反向测试确认 `passed`/`metrics` IPC 字段被拒绝。定向 `teaching_strategy` 测试 14/14 通过。
- 路线 9 已完成：启动恢复现在从 canonical activity dates 发现缺失的 daily journal/dream 窗口，经既有 `enqueue_job`、dedupe、priority 和 CHECK 约束入队；支持 schema 中的多用户来源，排除未来日期，按最新 journal 版本判断 dream 是否已有运行，并保持旧 `startup_recovery` 返回值兼容。
- 路线 9 回归：`cargo test -p ielts-db --test background_jobs --locked --offline` 12/12 通过；新增覆盖 canonical attempts/learning events、多用户窗口、未来日期、已有 journal/dream 和二次启动幂等。

## 2026-08-31 (续) — R5a 修订 + R1 + R3

### R5a 修订（challenge 发现我引入的数据丢失路径）
- `apply_consolidation` 的 INSERT 从未写 `last_observed_at`（0014:39 可空），而我修好的
  namespace 谓词里带 `last_observed_at IS NULL` 析取项 → 周度 dream 产出的 pattern
  在第一次 sweep 就被归档，而它的 supports 已是 `superseded`，知识整体离开 active memory。
- 修：谓词改 `COALESCE(last_observed_at, updated_at, created_at) < ?3`
  （`created_at`/`updated_at` 是 NOT NULL，0014:49-50，必然终止；同时保护存量库里
  已写入 NULL 的行，source-side 修不到）；INSERT 补 `first_observed_at, last_observed_at`
  绑到 `?7`，与 promote 路径 memory.rs:1071-1074 对齐。
- 3 个新测试；mutation 验证：去掉 COALESCE → 2 个测试 FAILED；去掉 INSERT 补列 → 1 个 FAILED。

### R1 周度 validator 管线（A1）
- 判断：不走 `memory_candidates` pending 管线。challenge 证明结构上三重阻塞
  （0014:104-107 action CHECK 无 CONSOLIDATE；memory.rs:379 强制反序列化成
  `MemoryMutationProposal`；`insert_active_memory` 只接受闭合 `MemoryScope`），
  且要 rebuild 表 → 迁移 0024 + 版本断言级联 + BACKUP_SCHEMA_VERSION。
- 改为：把 domain 里**已声明但从未接线**的守卫接上，落在两个 caller 共同必经的
  `validate_one` 单一收敛点。
- 新 `crates/ielts-domain/src/text_guard.rs`：从 validator.rs 上提 3 个纯
  `&str -> bool` 谓词（injection/secret/security），新增
  `contains_forbidden_inference_domain`（临床/心理/人格/智力）。validator.rs 改为
  re-export，10 个既有 validator 测试零改动。
- `validate_one` 接上：`MAX_PATTERN_STATEMENT_BYTES`（全仓此前零引用）→ 新
  `RejectReason::StatementTooLong`；security marker + forbidden domain →
  `ForbiddenStatementContent`（此前从未被构造）。
- `ForbiddenPatternKind` / `NotFalsifiable` 保持不构造，并在 domain 写明原因
  （前者 serde 闭合枚举在反序列化前就挡掉；后者需语义判断，关键词启发式会既误杀
  又漏放，留给 M11 LLM grader）。不编造启发式。
- 所有权作用域：`load_support_memories` 加 `user_id` 谓词，`apply_consolidation`
  不再硬编码 `'local'`，supersede 也加 `user_id`。别人的 `mem-*` 现在读作
  `HallucinatedSupportId`，且不会被 supersede。
- `apply_consolidations` 原来 `.collect()` 短路，丢弃已提交的 receipts；改为返回
  `PartialConsolidation { applied, failed_statement, error }`，让 ledger 记录真实
  部分提交状态（`apply_consolidation` 每 pattern 自带事务，无法整批回滚）。
- mutation 验证：移除 3 个守卫 → 3 个测试 FAILED。

### R3 周度边界（A3）
- `dream_run_weekly` 从 `generate_handler!` 摘除；改为非 `#[tauri::command]` 的
  `pub(crate) fn run_weekly_consolidation`，serde 再也无法从 webview 反序列化 patterns。
- 反向 RPC 信封修好（此前 dead on arrival）：sidecar 发 `{window, patterns}`，
  Rust 却读 `params["query"]` → Null 反序列化进两个必填字段 → 每次真实调用都报错。
  回复形状同样错位：Rust 返回嵌套 `report.validated: Vec<_>`，Python 读顶层 int
  并 `.get(...,0)` 静默兜底成 0/0/0。两者都在
  `.planning/agent_backend_audit_20260824/findings.md:132` 记录为休眠 P1。
- 新 `resolve_weekly_window_day`：ISO 周（`2026-W33`，sidecar 实际发的）→ 周一；
  也接受 ISO 日；其余硬报错不猜。
- run 持久化：mutation 前先 `insert_dream_run` + `start_dream_run`，成功
  `finish_dream_run`（receipts 的确定性 hash），失败 `fail_run` 并带
  `appliedMemoryIds` / `partiallyApplied`。`journal_id` 由 FK 真正校验
  （仅证明存在性，不证明归属 — dream.rs:20-28 不关联 user_id）。
- 删 webview 桥：`triggerWeeklyDream` + barrel + `.d.ts` 声明 + 两个已失效的
  `.d.ts` interface。Vue typecheck 通过。
- 文档：M8_STAGE_GATE_REPORT.md:20 改写（check_doc_drift.py 唯一会红的一处）；
  ADR-M9:36 同步。注意 ADR-M9 那行不能出现 "reverse-RPC" 字样，否则会命中
  COMMAND_CONTEXT_RE 把反引号里的 `dream_runs` 也当成未注册命令。
- 诚实记录：修完后周度 consolidation 只剩 sidecar 一个入口，而 `WeeklyDreamOrchestrator`
  在 runtime.py 里无人构造 → 该路径整体仍是死代码。死的安全路径优于活的不安全路径，
  但必须如实记录，不能报成"周度已可用"。

### 门禁
- `cargo test -p ielts-db --test consolidation` 22/22；`-p ielts-domain` 全绿；
  `-p ielts-application --lib` 60/60；`-p ielts-practice-tauri --lib` cognitive_runtime 10/10、journal 3/3。
- Python 425 passed。
- `check_doc_drift.py` 通过（23 docs）。
- `run_static_suite.py` **28/28**。
- `suite_practice_flow.py` **16/16 exit 0**。
- 陷阱记录：E2E 会复用已有 release exe（`buildPerformed: false`）。静态套件会重建
  Vue dist，于是出现"新前端 + 旧后端"的不一致产物，`agentWorkspaceRun` 会挂在
  workspace picker 之后并只报 `WebDriver condition timed out: False`。强制重建后 16/16。
  排查这类失败先看报告里的 `buildPerformed`/`binaryModifiedAt`，别急着怀疑源码。

### 预存在问题（非本次改动引入，未处理）
- `crates/ielts-application/tests/teaching_strategy.rs:39` 的 `CapturingStore` 缺
  `record_strategy_candidate_evaluation`。用户未提交的
  `crates/ielts-application/src/teaching_strategy.rs` 给 trait 加了该方法
  （HEAD 0 处 / 工作区 2 处）但没同步测试。`cargo test -p ielts-application` 整体编译不过；
  门禁用的是定向 filter + 不带 `--all-targets` 的 `cargo check`，所以不影响 28/28。
- `crates/ielts-db/src/consolidation.rs:8` `unused import: chrono::Utc`（HEAD 即存在）。

## 2026-08-31 (续) — R7b + R2b + 门禁覆盖修补

### R7b `snapshot_id` 确定性撞主键（路线图 7 前半）

`crates/ielts-application/src/context.rs:190` 原来用
`format!("ctx-{}", content_hash)` 铸 id，而 `content_hash` 是渲染文本的
确定性摘要。`agent_context_snapshots.id` 是 PRIMARY KEY（0016:7），所以
**同一个 plan 在语料未变时重跑第二次就会撞主键** —— 而"渲染结果相同"
恰恰是设计意图（section 顺序固定、item 按 rank、文本规范化），不是边缘
情况。

改法：`format!("ctx-{}", uuid::Uuid::new_v4())`，保留 `ctx-` 前缀
（`tests/context_materialization.rs:132` 断言它）。`content_hash` 留在
它自己的列里继续做确定性摘要，去重/漂移比对能力不变——只把**身份**和
**内容**解耦。

**没有改成 upsert**，这点是刻意的：两张表有 FK 指向这个 id（0017:87、
0020:69），覆盖写会把早先某次运行已落库的反馈悄悄重指到描述另一次运行
的行上，正好破坏这张表存在的意义（审计轨迹）。

诚实定级：这是**未接线路径上的哑弹**，不是线上回归。materializer 只有
两个入口——Python 反向 RPC `context.materialize`（feature 门控
`context-compiler-v1`）和已注册但无前端调用方的 `context_materialize`
命令；审计报告自己在 :51 / :120 记了 Context Chain 没有生产触发点。

依赖代价：`crates/ielts-application/Cargo.toml` 加 `uuid`，
**同一次改动里重新生成了 `Cargo.lock`**。`run_static_suite.py:206` 跑
`cargo check --workspace --locked`，不同步 lock 第一道门就红。lock 只多
一条边（`ielts-application` → `uuid`），没有新包进来（uuid 1.23.4 早在
lock 里）。

回归测试（都做了变异测试，去掉修复即失败）：
- `crates/ielts-db/tests/context_snapshot.rs`（新建，2 个）：相同
  `content_hash` 的两次渲染必须都能落库；同一个 id 不许写两次（PK 仍是
  承重墙，修复是在铸造点保证唯一，不是放松约束）。
- `crates/ielts-application/tests/context_materialization.rs`：重复
  materialize 必须给出不同 `snapshot_id`、相同 `content_hash`，且 id 不
  含 content_hash（否则撞主键换个形式回来）。

### 门禁覆盖修补（本轮新增测试原本一道门都不跑）

更正我此前的判断：静态套件**有** `-p ielts-db` 调用（"Rust
data-truth regressions"），但它是显式 `--test` 白名单，漏掉了
`consolidation` / `prompt_skill` / `context_snapshot` —— 也就是本轮所有
新增回归测试。已把三个 target 加进那条既有检查，现已确认在门内实际执行
（19 + 14 + 2 全绿）。

### 门禁

- `run_static_suite.py`：**28/28，exit 0**
- `suite_practice_flow.py`：**16/16，exit 0**

### 一次误判的归因记录（值得留档）

E2E 曾连续两次停在 `agentWorkspaceRun`（`wait_for_value` 返回 `False`，
即原生目录选择器报了 submitted 但 `.agent-workspace-select` 文本始终没
出现工作区名）。把铸造那一行还原后跑出 16/16，看上去像是我改坏的。

但"snapshot_id 铸造影响原生目录选择器"不是可信因果链：
`agent_pick_workspace`（`src-tauri/src/commands/agent.rs:95`）走 Tauri
dialog 插件 + `WorkspaceGrants`，完全不碰 `ielts-application`。于是把
修复**重新装回去再跑一次**——同样 16/16。

真正原因在环境：失败那两次 driver log 报的是 Edge 151，而此刻装机版本
已是 152.0.4191.53，native driver 是 150 —— WebView2 151→152 正在升级
的窗口期。**诊断规则**：这条 UI 检查失败时先比对 Edge/WebView2 与
driver 版本，并且"还原改动就通过"单跑一次不构成归因，必须把改动装回去
再验一次。（与上一轮 `buildPerformed` 陈旧二进制那次是同一类错误。）

### R7a `rr-*` run_id 撞 FK（路线图 7 后半）

`agent_context_snapshots.run_id` 是指向 `agent_runs(id)` 的外键
（0016:17），且每条连接都开了 `PRAGMA foreign_keys = ON`
（`sqlite/mod.rs:76`，全仓唯一一处）。但
`crates/ielts-application/src/context.rs:191` 把它填成
`plan.retrieval_run_ids.first().cloned()` —— 那是 Python 铸的
`rr-<hex12>` 检索 id（`retrieval/planner.py:77`），而 host 的 run id 形状
是 `plan-<uuid>`（`commands/agent.rs:329`）。**任何非空值都必然让
snapshot+items 整个事务回滚。**

改法不是"把形状修对"，而是 `run_id: None`，两条独立理由：

1. **检索血缘早就无损保存着。** Step 8 把整个 `ContextPlan`（含
   `retrievalRunIds`）序列化进 `query_plan_json` —— 只有
   `json_valid` CHECK、没有 FK 的 TEXT 列（0016:11）。那个 FK 列从头到尾
   只是同一份数据的第二份、且是错的拷贝。
2. **`run_id` 是审计轨迹的运行归属，而 `plan` 是调用方给的。** 在
   `context_materialize` 命令路径上（`commands/context.rs:21`，注册于
   `lib.rs:203`）调用方就是 webview —— 按架构合同它永远不能作为可信
   安全相关值的来源。想把 snapshot 关联到真实 run 的 host 必须传自己的
   可信 run id，绝不能从 plan 里捞。

另加纵深防御（Step 4）：`insert_context_snapshot` 在事务内对
`Some(run_id)` 预检 `agent_runs`，不存在就返回
`DbError::Validation("context.unknown_run_id: ...")`。FK 本来就会拦，但只
给一句不可归因的 `FOREIGN KEY constraint failed`；这样换成有类型、点名
字段的错误，且这个保证不依赖将来任何调用方往 manifest 里塞什么。只查
`Some`：NULL 是常态（materializer 不再归属 run），列本身可空。

回归测试（均变异测试通过）：
- `crates/ielts-db/tests/context_snapshot.rs` +2：未知 run_id 报有类型错误
  且**一行没写**（guard 在 INSERT 之前，无残留 snapshot / 孤儿 item）；
  NULL 是一等常态值。
- `crates/ielts-application/tests/context_materialization.rs` +1：
  `manifest.run_id` 必须为 None，同时 `query_plan_json` 里
  `retrievalRunIds` 仍在（为此给 `FakeStore` 增了
  `recorded_query_plan`，原先它把这个参数丢掉，这也正是这类 bug 一直没
  被测到的原因）。

诚实定级：同 R7b，未接线路径上的哑弹。sidecar dispatch 表
（`runtime.py:76-93`）只服务七个方法，唯一调用 `context.materialize` 的
`personalized_coach.py:323` 没接进 dispatch。但它**会在 M6 coach shadow
路径接线的那一刻由哑弹变实弹**，且届时是每轮 coach 都炸。

### 门禁

- `run_static_suite.py`：**28/28，exit 0**
- `suite_practice_flow.py`：**16/16，exit 0**（`buildPerformed: true`）

### R5b `learning_events` 级联删除（路线图 5 中段）—— **按原文驳回，未改代码**

challenge 判定 `fix_needs_revision`，我逐条自查后同意，并进一步认为**这一条
按审计原文是站不住的**。三点证据：

**1. 审计对自己引用的文档证据做了过度解读。** 报告 B2（:37）声称 9.8 承诺
"账本不可变/不删除原始事件"，引用 plan doc :2128。实际 :2130 原文是
「处理状态只代表下游处理，不代表删除原始事件。」，位于
`## 9.8 事件处理状态`（:2121）下，紧跟 `consolidation_state` 四值枚举
（pending/processed/ignored/quarantined，:2124-2127）。它说的是
**一个处理状态不蕴含删事件**，既不是关于 attempts 外键的约定，也没承诺
用户主动删除时要保留事件。

**2. 相反的约定在代码里是显式、刻意且有测试的。**
- `migrations/0013_learning_observation_projection.sql:56`：
  `-- This closes the derived-row orphan hole when learning_events cascades on delete.`
  —— 写 schema 的人知道有级联，并围绕它设计了派生行清理。
- `crates/ielts-db/tests/learning_events.rs:110` 测试名本身就叫
  `..._and_cascades`，:175-181 显式断言删 attempt 后事件为空。

也就是说这是**有争议的设计意图**，不是缺陷；要改需要先有产品决策和 ADR，
不能由整改顺手翻掉。

**3. 照原方案改会把"静默丢数据"换成"用户擦除失效"——更严重的回归。**
四条删除路径（`history/mod.rs:467/:492/:530/:680`）都在删完 attempt 之后
调 M2 重投影，而 `learning_observations.rs:404-410` 的
`load_ledger_events` **没有 attempts join、没有存在性过滤**：

```sql
FROM learning_events ORDER BY occurred_at ASC, id ASC
```

生产代码里也**没有任何 `DELETE FROM learning_events`**（只有 :743 删
attempts）。所以一旦摘掉 FK，用户点"删除这次记录"或设置里"清空历史"之后，
逐题正确性/得分/用时/attempt id 会留在账本里，被重新投影进
`learner_observations` / `learner_observation_evidence`，继续喂 M4 学习者
模型（`learner.rs:360-381`），并写进之后每一份备份（`learning_events` 是
`CANONICAL_TABLES`，`backup/mod.rs:55`）。这正好击穿 `history/mod.rs:686`
自己写的约定：*"otherwise make a backup or idempotent replay lie about an
erased record"*。

四条路径里只有 `prune_terminal_attempts_in_transaction`（:656，默认上限
100，0008:60）属于**存储策略**；另外三条
（`delete_attempt` :463 / `delete_history_attempts` :476 /
`clear_history` :500）是**用户主动擦除**。摘 FK 无法区分二者，会同时"修好"
前者、"改坏"后者。而 findings 和 plan doc 都没有要求用户删除后保留学习数据。

**结论：不做 0024 表重建。** 省下的连带代价也一并记下（都是真的，只是不该
为一个被驳回的前提去付）：迁移运行器要加 `requires_fk_off`（`PRAGMA
foreign_keys` 在事务内是 no-op，而 `migrate/mod.rs:174` 每条迁移都包事务；
`defer_foreign_keys` 也压不住级联）、19 列必须保持 cid 原序
（`backup/mod.rs:983` 按 `Vec<String>` 比列表，错序则历史备份全部无法恢复）、
5 个索引 + 2 个 CHECK 全部重建、7 处硬编码 schema 版本断言、外加
`history_retention.rs:170/:201` 会 `DELETE FROM schema_migrations WHERE
version >= 8` 后重放，要求 0024 在部分回滚下幂等。

### 附带发现（真实、与 FK 之争无关、**未修**）

`learning_events_verify` 在任何一次保留期修剪之后就会报
`consistent == false`，**现在就是**，不需要动任何代码：

- 被哈希的 payload 里嵌了 `attemptOrdinal` / `gapHours`
  （`learning_events.rs:453-454`，逐题事件 :474）。
- 而 ordinal 是**对现存同资产已完成 attempt 的 `COUNT(*)`**
  （`learning_events.rs:530-537`）。
- 修剪删的是**最旧的** attempt（`history/mod.rs:664-665`
  `ORDER BY ... DESC LIMIT -1 OFFSET ?1`）。

于是每个存活的同资产 attempt 的 ordinal 都会下移，但它已落库的
`content_hash` 仍编码旧值 → `mismatched > 0`。这不是靠"过滤掉被删
attempt 的事件"能修的（那只处理 `orphaned`），要么用不依赖已删兄弟的稳定
ordinal 重算，要么把 ordinal/gap 从被哈希的 payload 里摘出去——两者都改哈希
契约，属于独立变更。影响面有限：该命令在
`#[cfg(feature = "developer-tools")]` 之后（`commands/learning.rs:88-92`），
是开发诊断，不是用户路径。留档待产品决策，本轮不动。

### R4 Coach token ceiling（路线图 4）—— 主体已在工作树，补一个真实算术缺陷

审计主体（7.8 coach 无 token 上限）**在用户未提交的工作树里已经修好**：
输出上限 `coach.rs` `COACH_OUTPUT_TOKEN_CEILING = 2_000` 并真的传进
`CompletionRequest.max_tokens`；输入侧按 newest-first 准入、复用
`CONTEXT_HARD_TOKEN_CEILING` 这一个 32k 权威而没有另造常量。这部分我只做了
核验，未改。

但两个常量原本是**并列**的：
`COACH_INPUT_TOKEN_BUDGET = CONTEXT_HARD_TOKEN_CEILING`（32_000）加上
`COACH_OUTPUT_TOKEN_CEILING`（2_000）。provider 的 window 约束的是
**prompt + completion 之和**，所以一个填满的 prompt 会向 32k 窗口要 ~34k ——
这是**硬拒绝，不是静默截断**。

改法（一行 + 注释）：
```rust
const COACH_INPUT_TOKEN_BUDGET: u32 =
    CONTEXT_HARD_TOKEN_CEILING.saturating_sub(COACH_OUTPUT_TOKEN_CEILING);
```
派生而非并列，任一个被重新调参也不会再漂开。`coach.rs:419` 的既有断言按符号
读常量，无需改动。

新增 `input_budget_and_output_ceiling_fit_inside_one_provider_window`（变异
测试通过：还原成并列即失败），同时断言预留输出后输入预算不至于塌成没用。

未处理、仅记录的两个残留（都是刻意的）：
- `estimate_tokens` 是 chars/4（`context.rs:181-184`），CJK 约 1 字 ≈ 1 token，
  所以中文 coach 线程可能实际超出名义 32k 数倍。复用共享估算器是正确的一致性
  取舍（materializer 同性质）；要硬保证得动 `ielts-domain` 的估算权重，那会
  移动 `ContextPack` 的 `rendered_hash`/`used_tokens` 并打破
  `context_materialization.rs:249`（它按 4 chars/token 构造长度）。
- `writing_evaluation.rs:128` 与 `commands/ai.rs:188` 仍传 `max_tokens: None`，
  两处都有显式注释说明是刻意保留历史行为；7.8 的范围是 coach，故按原样。

### 门禁

- `run_static_suite.py`：**28/28，exit 0**
- `suite_practice_flow.py`：**16/16，exit 0**

### 诊断规则追加：packaged E2E `agentWorkspaceRun` 的冷二进制竞态

同一份代码，`buildPerformed: true`（套件自己刚重建）时该检查会
超时失败，紧接着重跑一次（`buildPerformed: false`，二进制已热）就 16/16。
本轮观察到 3 次失败全部发生在刚重建之后，热跑全部通过（R7a 那次刚重建也过，
所以是**竞态而非确定性失败**）。

机制：`drive_windows_folder_picker`（`packaged_tauri_flow.py:337`）用
`EnumWindows` 找 `#32770` 对话框，只给 10s 发现窗口 + 15s join；新编出的
exe 首次启动会被 Defender/SmartScreen 扫描、页面冷加载，原生目录对话框出现
得比这个 deadline 晚。失败点是 `packaged_tauri_flow.py:738` 的
`wait_for_value`（返回 `False`，即 `.agent-workspace-select` 文本始终没出现
工作区名）。

**规则（后续修正，见下）**：这条检查失败时不要据单次失败归因到源码改动。

**修正**：上面"冷二进制"的结论样本太小，已被推翻。后续在
`buildPerformed: false`（二进制已热）的情况下同样复现了失败，随后连续两次
又都 16/16。实测失败率约 3-4/10，**与冷热无关**。

真实机制是原生对话框自动化本身的竞态：`agent_pick_workspace`
（`src-tauri/src/commands/agent.rs:95`）在
`blocking_pick_folder()` 返回 `None`（对话框被取消/关掉）时返回
`CommandResponse::success(None)`，而 Vue 侧 `pickWorkspace`
（`AgentConsolePage.vue:642-649`）对 `!grant` 直接 `return`，既不报错也不
设 `workspaceGrant` —— 于是按钮文本永远不出现工作区名，`wait_for_value`
超时返回 `False`。也就是说自动化"报了 submitted"但对话框实际是被 dismiss 的。

**最终规则**：`agentWorkspaceRun` 失败时重跑 2 次；只有连续 3 次以上失败
才考虑源码归因。判断某个改动是否真的破坏了它，必须把改动装回去/摘下来各跑
多次，单次对比无效（本轮就因此差点两次误判）。

### R6a / R6b / R5c —— 判定为「缺失功能」而非「缺陷」，本轮不做

三项的 challenge 都给了 `fix_needs_revision`，且核心都不是"某行写错了"，
而是"这条链路根本没有生产写入方"。把它们做完等于在整改批次里现造功能，
与"零回归的缺陷修复"是两种工作，硬塞进来风险大于收益。

- **R6b（Context Chain 五表只写两张）**：它 summary 点名的那颗真炸弹就是
  `ielts-application/src/context.rs:191` 的 `rr-*` 撞 FK —— **已作为 R7a 修
  掉**。剩下的 `retrieval_runs` / `llm_invocations` /
  `retrieval_index_registry` 三表零 INSERT，属于 M5 追踪链未接线，是功能缺口。
- **R6a（`eval_cases` 无生产写入方）**：verify 自己说defect 比审计 C4 描述的更
  重——`eval.run_case` 反向 RPC 因 params 线形不匹配独立死掉，且 Rust 侧 uuid
  case id 永远匹配不上 Python 硬编码的 `m11-*` 冻结 case id，M11 晋升门有三处
  各自独立的断点。这是 M11 整条 eval 管线未接线，不是一个补丁能收口的。
- **R5c（`dream_candidates` 死信表）**：需要新桥接 + 迁移 0024 + 一对 Tauri
  命令，同上。

留给后续里程碑按功能立项，不在本轮整改范围。**本轮有 verify+challenge 配对的
缺陷类条目至此处理完毕。**

## 2026-09-01 — API 配置专项（用户报告：无法保存/无法配置/无法连接/无法调用）

派了两个只读子代理分头审计**保存/持久化路径**与**连接/调用路径**，我逐条
复核后按杠杆率修复。**一个根因同时解释了用户列举的全部四种症状。**

### 根因：UUID 配置 id 被"疑似密钥"启发式拦掉（保存/配置/调用全断）

`crates/ielts-db/src/settings/mod.rs:424-427` 的启发式：

```rust
if namespace == NS_AI && s.len() >= 20 && !s.contains(' ') { return true; }  // = 疑似密钥
```

而 `set_default_ai_config` 把 `defaultConfigId` 走的是**带守卫的公共
`upsert_setting`**（:260），它的四个同胞运行时键
（`provider`/`baseUrl`/`model`/`secretName`）走的却是**不带守卫的
`write_ai_runtime_value`**。生产 id 是 `Uuid::new_v4()`（36 字符、无空格），
**必然命中**该启发式。

**已实测复现**（不是推理）：
```
upsert_setting(&conn, "ai", "defaultConfigId", &json!("67e55044-...-bb680e5fe0c8"))
  -> Err(Validation("refusing to store API key / secret material in settings table"))
```

连锁反应正好是用户描述的样子：首次保存带 Key 的配置时，keyring、secret-ref
行、config 行**其实都已写入**，然后在重新列举那步炸掉并弹出"refusing to
store API key…"；由于 `ai_list_configs` 也会 reconcile，此后**列表永久为空**，
所有取用 AI 的路径一起失败；而列表空 → `apiForm.id` 为 null → 每次重试都
新铸一个 UUID，于是**每重试一次就多一份孤儿配置 + 孤儿 keyring 条目**。

**修法**：把这一处可信的宿主内部写入改走宿主内部 helper
`write_ai_runtime_value(conn, AI_DEFAULT_ID, ...)`，与四个同胞一致。

**没有放松那条启发式**，这点很关键：`upsert_setting` 是**已注册的 Tauri
命令**（`src-tauri/src/lib.rs:224`），接受 webview 传来的任意
namespace/key/value —— 那条 ai 命名空间规则正是阻止 webview 把 API Key 塞进
`settings` 表的东西。这次写入之所以可信不是靠"名字看着像 id"，而是**结构性
证明**：写之前 `set_default_ai_config` 已经校验过 `is_enabled`、`has_secret`，
并且 `ai_secret_ref_for_config` 能解析出真实 secret 引用；同时 reconcile 传入
的 config 是**从库里读出来的**，不是 webview 载荷。

测试（变异测试通过）：`ai_config_security.rs` +2 ——
`a_production_shaped_uuid_config_id_can_become_the_default`（顺带覆盖设置页每次
加载都会走的 reconcile 路径）、以及反向的
`the_public_settings_command_still_refuses_a_long_opaque_ai_value` 钉住守卫没
被削弱。**该套件此前全部 id 都是 <20 字符的手写短名**（`primary`/`secondary`/
`forged`），这就是它一直没抓到这个 bug 的原因。

### `base_url` 从不做路径规范化（"无法连接"的头号成因）

`ai/runtime.rs:133-136` 只 `trim_end_matches('/')` 然后拼
`/chat/completions`，`normalize_provider` 只 trim 空白 + 空值兜底。于是：

- `https://api.deepseek.com`（厂商官网 URL，最自然的输入）→ 少 `/v1` → 404
- `https://api.openai.com/v1/chat/completions`（从文档直接粘贴）→ 路径重复 → 404
- `api.openai.com/v1`（缺 scheme）→ reqwest builder error

新增 `normalize_base_url`：补 scheme、去尾斜杠、剥掉误粘的
`/chat/completions`、裸 origin 补 `/v1`。放在 `normalize_provider` 里是因为
**保存路径（`commands/ai.rs:55`）和调用路径（`ai/config.rs:97`）都经过它**，
所以已经存错的配置也会被就地修正，不需要数据迁移。裸 host 补 `/v1` 是刻意
取舍（三家受支持厂商都在 `/v1`），根路径网关需显式写出路径，注释已说明。

9 个输入用例 + 空值兜底用例。原有那个 URL 测试传的是 `None`，只覆盖了硬编码
默认值 —— 也就是本来就能用的那些输入。

### 厂商错误响应体被丢弃（401/404/400/429 全长一样）

`ai/runtime.rs:167-175` 只保留状态码，body 从不读取。于是 Key 错、模型名错、
参数被拒、额度耗尽，用户看到的都是同一句 `连接失败: AI provider returned
HTTP 401`，无法自诊。

改为读取并附加**有界**摘要：优先 `{"error":{"message":...}}`，退到
`{"error":"..."}`，再退到原始 body；折叠空白保证单行；超过 300 字符截断。
body 是厂商自己的错误文本、不含我们的请求，所以不会带出 bearer token；仍然
不写日志。拆出纯函数 `extract_provider_error_detail` 以便无需起 HTTP 服务即可
测试，+2 测试（含超长截断）。

### 一次失败的 vault 读取会擦掉 canonical 配置

`ai/config.rs` 的 `vault_has_secret` 原本在 `Err` 分支返回 `false` —— **读失败
和"没有这个 Key"不可区分**。它喂给
`reconcile_default_ai_config_with_secret_availability`，后者在"没有任何配置有
密钥"时调 `set_default_ai_config(None)`，那会删掉 `defaultConfigId`、把
`provider` 覆写成 `"unconfigured"`、删掉 `baseUrl`/`model`/`secretName`
（`settings/mod.rs:274-281`）。

触发点是 `ai_list_configs` —— **设置页每次加载都走**。也就是说 Windows
凭据管理器打一次嗝，用户的 provider 配置就被静默清空，下一次调用报"未配置
可用 AI"，而且存的 base URL 和模型名已经没了。这同时把架构合同倒过来了：
**一次失败的读驱动了一次 canonical 写。**

改为 `DbResult<bool>` 并在 `available_secret_ref_ids` 里 `?` 传播 —— 读失败就
诚实地让列表失败，而不是喂一个会擦除状态的 reconcile。`Ok(None)` 仍是
`false`（引用存在但本机没密钥是正常状态，比如换机恢复备份后）。ielts-db 侧
`FnMut(&SecretRef) -> bool` 的签名未动，所以
`ai_config_security.rs:190/:202` 传 `|_| false` 的断言不受影响。

### 保存成功的假绿灯

`SettingsPage.vue` 的 `loadApiConfigs` 自己 catch、自己设错误提示、**不重新
抛出**，而三个变更调用方（保存 / 设为默认 / 启停）紧接着**无条件**设成功提示
—— 于是写入落库但列表刷新失败时，绿色"API 配置已保存"直接盖掉红色报错，用户
看到"保存成功"却面对一个空/过期的列表，正是"明明保存了又没了"的观感来源。

改为返回布尔（请求被后续请求取代**不算**失败），三处成功提示按它开关，失败时
给的是诚实的分述："配置已写入，但重新读取列表失败，请刷新后确认"。

### keyring 写成功但 secret-ref 写失败 → 有效密钥永久不可见

`commands/ai.rs` 里 `vault.0.set_secret`（写 OS keyring + vault 文件，**每次都
铸新 `ref_id`**，`secrets/mod.rs:63`）和 `put_secret_ref`（写 SQLite）是两次
独立提交。后者失败时 SQLite 留着旧 ref、vault 文件只有新 ref，而
`get_secret_by_ref` 严格按 ref_id 匹配、匹配不到返回 `Ok(None)`
（`secrets/mod.rs:78-91`）→ 配置报 `has_secret == false`，而一个完全有效的
凭据正躺在凭据管理器里，应用看不见，`ai_delete_config` 也清不掉（它按刚被删
掉的那行记录的名字去删）。

**没有**采用"让 `get_secret_by_ref` 退化成按名字查找"——那会让从备份恢复的
引用去匹配一个无关的本机凭据，正是
`ai_config_security.rs:171-218` 断言要防的。改为**补偿**：`put_secret_ref`
失败时回滚刚写的 keyring 条目（没有可挽回的损失，因为 `set_secret` 已经把该
名字下的旧值覆盖掉了）。

### 删除配置时静默吞掉 vault 删除失败

`commands/ai.rs` 两处 `let _ = vault.0.delete_secret(...)`。吞掉之后：UI 说
配置已删，用户的 API Key 却留在 OS 凭据存储里，而且**永远不会有人重试**——
记录这些 secret 名字的 SQLite 行刚刚被删掉了。改为 `tracing::warn!` 记录；
刻意不做成致命错误（canonical 行已提交，此时报失败等于告诉用户"没删掉"，
而它其实删了）。

### 门禁

- `run_static_suite.py`：**28/28，exit 0**
- `suite_practice_flow.py`：**16/16，exit 0**

### 已核实但本轮未修（留档）

- **测试连接与真实调用走的不是同一条路。** `load_provider_config_for_id`
  （`ai/config.rs`）不调 reconcile，而真实调用路径
  `load_provider_config` 调；且"测试连接"发的是
  `response_format: json_object` 且**不带 tools** 的 completion body，agent 跑的
  是**带 tools、不带 response_format** 的 body（`runtime.rs` 两处 body 构造）。
  所以"测试连接通过"与"agent 能用"由两段不同代码决定：只支持 JSON 模式、不支持
  function-calling 的网关会测试通过、agent 每次都 400。
- **`ai_test_provider` 会把成功的往返判成连接失败**：要求回包能解析成 JSON 且
  顶层 `ok == true`，否则报 `ai.invalid_test_response`。模型加了 ```json 围栏或
  任何解释性文字就误判。
- **超时被重试放大且没有 connect timeout**：`MAX_RETRIES = 2`（共 3 次尝试），
  超时与连接错误都算可重试，每次重试都烧满整个窗口 → 默认 45s 最坏约 136s，
  上限 300s 时约 15 分钟；测试按钮没有取消也没有客户端截止时间。另外
  `COGNITIVE_REQUEST_TIMEOUT = 60s` 比内层客户端预算更小，调大
  `timeoutSeconds` 反而让 sidecar 更早放弃。
- **没编入 SOCKS 支持**：`src-tauri/Cargo.toml` 的 reqwest 没开 `socks` feature，
  而 reqwest 默认读 `ALL_PROXY`/`HTTPS_PROXY`，所以 `socks5://127.0.0.1:7890`
  这类（Clash/v2ray 的标准配置）会在建请求时失败并报成一句含糊的
  "AI request failed: …"。对这个用户群命中率可能不低。
- **最后一个配置删不掉**（`SettingsPage.vue` `totalConfigCount <= 1` 直接
  返回 true），换机后唯一配置的 Key 失效时无法删掉重来。
- `map_ai_not_configured`（`commands/writing.rs:45-53`）把 `DbError` 绑成 `_`，
  所有不同原因坍缩成同一句"未配置可用 AI"。

上述每条都有 file:line 证据，属于独立可验证的后续项；本轮优先修了根因与
"无法连接"的头号成因，避免一次改动面过大。

## 2026-09-01 — 数据流全量普查（工作流）+ 一个实弹 P0

派了工作流做全量数据流核查：82 张表的写入方/读取方普查、三个方向的线形合同
比对（webview→Rust、host→sidecar、sidecar→host）、外键与级联语义、以及静默
失败面。每条发现再用两个独立对抗视角复核（一个查证据真伪，一个判"是缺陷还是
没造完的功能"）。

### P0（已修）：`coach_outcome_links_v0` 的自相矛盾外键让"删除历史"永久失败

`0017:105` 把 `future_observation_id` 声明为 `TEXT NOT NULL`，`0017:108` 又把它
放进 PRIMARY KEY，然后 `0017:112` 给它的外键写了
`ON DELETE SET NULL`。**这两件事不可能同时成立**：对一个 NOT NULL 的主键列
SET NULL 永远不会成功。

已实测（隔离 SQLite 复现，不是推理）：
```
DELETE FROM learner_observations WHERE id='obs-1'
  -> IntegrityError: NOT NULL constraint failed:
     coach_outcome_links_v0.future_observation_id
```
删除失败会把调用方**整个事务**一起带走。

**这条链路是实弹，不是哑弹**：
- 写入方 `coach_link_outcome` 是**已注册的 Tauri 命令**（`lib.rs:298`
  → `application_store.rs:144` → `coach_feedback.rs:319`），且插入前会校验
  observation 真实存在（`coach_feedback.rs:315`）。
- 删除方 `DELETE FROM learner_observations WHERE projector_key = ?1`
  （`learning_observations.rs:297`）来自 M2 重投影，而它被
  **四条历史删除路径**（`history/mod.rs:467/:492/:530/:680`）、**默认开启的
  保留期修剪**、以及注册命令 `learning_observations_rebuild`
  （`commands/learning.rs:97`）调用。
- 另有 `0013:57-61` 的触发器：删 `learner_observation_evidence` 会删
  `learner_observations`，而前者又从 `learning_events` 级联、后者从
  `attempts` 级联。

也就是说：**只要用户的 coach 学习结果被关联过一次，此后删历史、保留期修剪、
重建投影就全部硬失败。** 正是"bug 非常多"里那种说不清为什么的失败。

**修法**：迁移 `0024_coach_outcome_link_fk_fix.sql`，把动作改成
`ON DELETE CASCADE`。这也是这行数据的语义——它记录"某次策略指派导向了那条未来
观测"，观测没了这条链接就没有意义；而且和同表另一个外键
（`0017:110` 从 `coach_strategy_assignments_v0` 级联）保持一致。

**为什么这里可以直接 DROP TABLE 重建**：没有任何表声明外键指向
`coach_outcome_links_v0`（它只当子表）。这正是 R5b 那次不能照抄 0003 写法的
区别所在——那张表有两个外键子表，DROP 的隐式 DELETE 会触发它们的级联把子表
清空。迁移注释里写明了这个区别，避免以后有人照抄到有子表的表上。

同时保证的三件事：
- **列顺序与列集合逐字不变** —— `backup/mod.rs` 恢复时按列名列表比较，重排会
  让所有历史备份无法恢复（已跑 `backup_full_roundtrip` 验证）。
- **重放安全** —— `history_retention.rs:170/:201` 会
  `DELETE FROM schema_migrations WHERE version >= 8` 再 `migrate()`，在已经
  修正过的表上重放；用 `INSERT OR IGNORE` + 临时表用完即删做到幂等（已跑
  该测试验证）。
- 两个索引与 CHECK、复合主键全部重建（有测试钉住）。

新增 `crates/ielts-db/tests/coach_outcome_link_fk.rs` 4 个测试（变异测试：把
动作改回 `SET NULL` 则 2 个失败）：删被关联的 observation 必须成功且链接级联
消失、**按 `projector_key` 删的生产语句形状**（不是图省事换个写法）、同表另一个
级联在重建后仍有效、重建后 CHECK/主键/悬空父行拒绝都还在。

顺带处理了新增迁移的连带成本：7 处硬编码 schema 版本断言。只在真正需要"恰好
这些迁移被应用"的地方补 24，其余按仓库已有的健壮写法
（`agent_thread.rs:77` 的 `assert!(version >= 22, ...)`）改成 `>=`，这样下一次
加迁移不会再引发同样的连锁修改。

### 门禁

- `cargo test -p ielts-db`：**298 passed / 0 failed**
- `run_static_suite.py`：**28/28，exit 0**（含 `cargo check --workspace --locked`）
- `suite_practice_flow.py`：**前 5 项通过，`agentWorkspaceRun` 被环境阻塞**
  —— 报的是 `native Agent workspace picker automation failed: failed to open
  clipboard`。实测系统剪贴板处于**卡死**状态：`OpenClipboard` 失败，但
  `GetClipboardOwner` / `GetOpenClipboardWindow` 都返回 NULL（无持有者窗口），
  240 秒重试未恢复。最可能是本轮早前几次 picker 超时时，工作线程在
  `OpenClipboard` 与 `CloseClipboard` 之间被结束，把剪贴板锁在了一个已死线程上
  （自动化确实用剪贴板贴路径，`packaged_tauri_flow.py:353`）。

  **没有为此杀进程**：查过机器上 31 个 `msedgewebview2` 全部属于
  `MicrosoftWindows.Client.CBS`（Windows 外壳），**没有一个来自本项目的测试**
  （`ielts-practice-tauri` 与 `msedgedriver` 进程数均为 0），杀它们属于动别人的
  东西。这条被阻塞的检查驱动的是原生目录对话框，与本次迁移无关。

**harness 脆弱点（值得单独立项）**：picker 自动化对剪贴板是硬依赖且不做恢复，
一次超时就可能把剪贴板锁死、进而让后续每次运行都失败。建议它 `OpenClipboard`
带重试、用 `try/finally` 保证 `CloseClipboard`，或者改用不经剪贴板的路径输入
（直接 `SendMessage` 给文件名编辑框）。

### P0（已修）：M4 调度器的全部输出被 Python 静默丢弃，学习计划一直是空输入

`crates/ielts-domain/src/learner.rs` 的 `SkillReviewNeed` 有 **13 个字段**、
`SkillStateView` 有 **15 个**，都是 `rename_all = "camelCase"` 全量序列化上线。
而 Python 侧 `planner/types.py` 的对应模型只建了 **11** 个和 **5** 个字段，
且继承自 `extra="forbid"` 的 `_StrictModel`。

于是每一行真实数据都验证失败，而两个解析器都把失败行直接跳过：
`_parse_review_needs` / `_parse_uncertainty_map`（`planner/study_plan.py`）
都是 `except Exception: continue`。**结果是 planner 永远看到 0 条复习需求、
空的不确定度映射 —— 不报错、不记日志、计划照样生成，只是输入是空的。**

已实测（不是推理）：
```
11 字段行            -> OK
真实 13 字段行        -> 2 validation errors (extra_forbidden)
经 _parse_review_needs -> 0 rows parsed
```
缺的两个字段是 `distinctAssetCount` 与 `supportingObservationIds`；
`SkillStateView` 缺 10 个。

讽刺的是 `SkillReviewNeed` 的 docstring 早就写了正确意图：*"the snapshot
envelope is parsed loosely (extra fields the host adds are ignored at the
row-parse boundary so a host schema bump does not force a planner fallback)"*
—— 代码做的恰好相反。

**修法**：不是补那两个字段（下次 host 加字段又会断），而是消掉这一类。新增
`_HostViewModel` 基类（`extra="ignore"`，其余与 `_StrictModel` 相同），
`SkillReviewNeed` 与 `SkillStateView` 改继承它。

方向性判断写进了注释：`extra="forbid"` 对**不可信入站**是对的，这也是
`_StrictModel` 的职责；但这两个模型是**从权威 host 读回的派生视图**，host 后来
多加一个字段不是攻击，为它丢掉整行才是 bug。

新增 `HostWireShapeTests` 4 个测试（变异测试：改回 `_StrictModel` 则 3 个失败）。
fixture 用的是 Rust 结构体的**完整序列化形状**（13/15 字段），不是图省事的裁剪
版 —— 用裁剪 fixture 正是这个 bug 当初能通过评审的原因。同时钉住"未来 host
新增字段不丢行"和"真正畸形的行仍然要丢"（缺必填、越界值、未知枚举）。

### 门禁

- Python：**429 passed**（原 425 + 本次 4）
- `run_static_suite.py`：**28/28，exit 0**
- `suite_practice_flow.py`：**16/16，exit 0**

### P2（已修）：`apply_consolidation` 的收据可能在谎报

`apply_consolidation` 里给每个 support 打 `superseded` 的 UPDATE 原来是
`let _ = tx.execute(...)`，然后无条件构造 `ConsolidationReceipt` 声称
`support_ids` 全部已被 supersede。而 `weekly_output_hash`
（`src-tauri/src/commands/journal.rs`，R3 时我加的）会把收据哈希进 dream run
的 recorded output —— **一次被吞掉的失败会把假声明写进审计轨迹**：模式显示已
consolidated，它的 supports 却还是 `active`，正好反转 M8-06 的可逆性契约。

而且 R1 我给这条 UPDATE 加了 `AND user_id=?3` 之后，属于别人的 support 会静默
不被 supersede，收据却照样把它算进去。

改法：`?` 传播错误，并且**零行也算错误**——`validate_one` 已经确认过每个
support 都是 active 且属于该 user，miss 意味着在校验与应用之间行被改了；
fail-closed 让整个事务回滚，而不是把一次部分合并记成完成。

新增测试（变异测试：改回 `let _ =` 即失败）：在校验通过之后把一个 support 从
外部改成 archived（模拟并发归档），断言 apply 必须报错且错误里点名那个
support，并且回滚干净——没有部分写入的 consolidated 行，另一个 support 仍是
`active`。

### 门禁

- `cargo test -p ielts-db`：**300 passed / 0 failed**
- `run_static_suite.py`：**28/28**
- `suite_practice_flow.py`：**16/16**
