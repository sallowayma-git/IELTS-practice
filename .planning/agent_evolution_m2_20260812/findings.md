# M2 研究发现

## 当前状态

- 用户已确认开始 M2。
- 仓库已有 `.planning/agent_evolution_m1_20260812/task_plan.md`，其状态标记 M1 完成；本轮不改写该历史计划。
- 权威输入是 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.1_Post_M1_TechSpar.md`，PowerShell 复核实际为 10,463 行，需由主代理完整阅读。

## 待确认

- M2 的精确目标、数据结构、命令/API 边界、迁移/backfill、测试和 DoD。
- 当前 M0/M1 代码实现与任务书契约之间的真实缺口。

## 总任务书 1-2000 行要点

- 文档明确规定：第 21-23 章优先于前文旧阶段顺序、migration 编号、目录建议和伪代码。
- 产品核心是“学习证据操作系统”，不是聊天框；Learning Truth、Memory、Context、Evolution 四条数据链必须分离。
- M0/M1 是历史合同；M1 的 `learning_events` 是分析账本，不是第二事实源，也不要求全产品 Event Sourcing。
- 已有 Agent loop、`agent_runs`/`agent_tool_calls` 审计和 workspace 文件工具应保留；当前 AgentWorkspacePage 仍是 UI 原型，不能视为后端主架构完成。
- 数据层级：原始学习事实 → 追加证据 → 派生画像/状态 → 有来源的 curated memory → Agent execution/context → Evolution governance。
- 任务书提出完整 schema 草案（threads、messages、memory、journal、dream、jobs、learner、context、prompt/eval），但不能一次性全建，必须按第 21 节阶段纵向切片。
- 核心安全/数据原则：Agent 只读原始学习事实；Memory 有 provenance、confidence、lifecycle；冲突用 supersede；Context Pack 有预算且可审计；生产 Agent 不直接改 Soul/Prompt/Skill。
- 当前需要继续读取第 21-23 章，确认 v1.1 对 M2 的最终范围、准确迁移编号、首个切片和 DoD。

## 总任务书 2001-3600 行要点

- M1 后续事件处理必须支持 deterministic backfill、固定幂等 key、批量 checkpoint；不得在 migration 中跑大规模 LLM/backfill。
- Memory 生命周期是 candidate → review/active → superseded/archived/quarantined；任何 promotion 都要验证 evidence 存在、内容非空、置信度、注入/secret、敏感度和冲突。
- Dream 分为 Hot Capture、Session Close、Daily、Weekly、Monthly；只有 Deep 阶段能改变 Active Memory，REM 只写 candidate。
- Learner Model 第一版采用人工版本化 taxonomy + Beta-Bernoulli/EWMA 类可解释模型；重复同题必须降权，跨 asset/date 的证据多样性优先。
- Context Compiler 必须位于 application 用例层，输入显式 task/surface/entity/budget；先精确实体/metadata/FTS，再排名、去重、预算打包，并持久化可审计 snapshot。
- 现有 Agent loop 保留；后续能力按 thread/session、context snapshot、checkpoint、cancel、approval、tool policy 等垂直增加。
- 第一批学习工具应是只读 canonical views（attempt detail、重复 attempt 比较、question history、skill state、learning event search、Coach history、active memory、daily journal）；禁止通用 `write_memory`，使用 proposal 语义并由 Memory Service 做确定性 mutation。
- 继续读取第 21 节是关键：前面只是长期目标和 schema 草案，M2 的实际工作边界以 v1.1 工程实施章节为准。

## 总任务书 3601-5600 行要点

- Agent cancellation、run kind、后台 job 都必须持久化且可恢复；Tauri command 只做反序列化、权限/adapter、调用 application、错误 envelope 和事件转发。
- M2 以后新增能力必须避免一个巨型 `match tool_name`；学习工具按业务语义提供只读/提议能力，工具输出的 model payload 与 audit payload 分离。
- Coach 个性化的长期策略只能由多证据和 outcome 形成 candidate；一次不满意不应污染长期画像；事实正确性和不泄题优先于风格偏好。
- Prompt/Skill 全局演化必须独立于用户 Memory，最低闭环是 registry、trace/eval dataset、deterministic evaluator、baseline replay、人工 candidate、holdout、shadow、rollback。
- Application ports 方向保持 `ielts-domain` → db/application → Tauri adapters；禁止 application 依赖 Tauri、reqwest、Keyring 或 raw SQLite。
- 事务合同：attempt+score+events、Coach message+event、memory mutation batch、learner observation+state、tool terminal audit 等必须原子；模型调用绝不能在事务内。
- UI 目标是把 Agent 嵌入阅读/写作/历史等主流程；Memory/Journal/Dream/Learner UI 必须展示来源、置信度、状态和用户治理，而非隐藏画像。
- 安全要求包含 Memory ingestion firewall、业务语义 SQL 工具、原始学习事实不可改、审批矩阵、最小披露、备份/恢复和 retention；自动学习失败不可破坏练习主流程。
- 评测分 L0-L7；关键硬门槛包括 unsupported mutation=0、quarantined activation=0、context overflow=0、superseded recall=0、确定性合同 100%。
- 第 21 节从这里开始，是本轮决定 M2 首个可交付切片的唯一依据。

## 总任务书第 21.1-21.5 行要点

- 每个阶段必须是纵向切片：schema/data + application use case + Tauri adapter + 最小 Vue 可观察界面 + unit/integration/packaged E2E + feature flag/rollback；模型输出必须有 fake-model 测试，核心功能不能依赖外部模型。
- M1 已冻结于 `c9e4f620bf2a0d5ed0a051c79ac66c0b8d07047d`，M2+ 不得修改 M1 event semantics；如扩展只能加 schema/event version 并保留旧 replay。
- 不能把 `learning_events.consolidation_state=processed` 当成所有消费者共用 offset；每个 consumer 要有自己的 deterministic output/checkpoint。
- v1.1 的实施顺序是：M1 Ledger → M2 deterministic Observations → M3 Memory Candidate → M4 Learner Model → M5 Context → M6 Reading/Coach → M7/M8 Dream → 后续 UI/演化/Agent threads。

## M2 精确范围（总任务书 6198-6473）

- Migration：`0013_learning_observation_projection.sql`。
- 表：`learner_observations`、`learner_observation_evidence`、`learning_projection_runs`；projection uniqueness 由 projector key/version/source fingerprint 冻结。
- Observation v1 仅允许：Reading outcome/answer-change/visit/elapsed/repeat transition/attempt score、Writing evaluation status/band/criterion/degraded、Coach asked/generated count/timestamps/linkage。
- 明确禁止：`user_is_bad_at_*`、`user_prefers_*`、`user_is_overconfident` 等长期画像推断；这些属于 M3/M4+。
- Observation ID 由 projector、version、排序去重 evidence IDs、observation key 做 SHA-256，禁止 UUID-only；事件顺序 shuffle 不能改变 fingerprint。
- Reading projector 必须复用 M1 `compare_attempts_for_asset` 的 transition logic，不能另造 corrected/still_wrong/newly_wrong/still_correct 分支；短间隔重复可标 `familiarity_risk=true`，但不判断 mastery。
- Writing projector 只投影 terminal status、overall/criterion bands、degraded reason、task type 和 provider/model provenance，不复制 essay/prompt/full response。
- Coach projector 只投影可靠的 question/response 事件的 count、timestamps、linkage；没有 canonical feedback/re-ask 事实时不得生成 preference observation。
- developer-only commands：`learning_observations_rebuild`、`learning_observations_verify`；rebuild 不调用 LLM/网络/Coach、不改业务记录、必须 exact hash 一致。
- Cursor 只是性能优化，不能作为 correctness source；event ID 不是时间序列且 backfill 可能插入旧 occurred_at。
- 测试必须覆盖：replay idempotency、event order shuffle、四类 Reading transition golden、delete cascade、exact hash、坏 payload quarantine、private/restricted authorization、Writing degraded/failed 不虚构 score、Coach 无 feedback 不造偏好。
- M2 DoD：删除全部 observations 后从 ledger 重建得到相同 deterministic hash；rollback 只关 projector/删 derived 表，M1 ledger 不动。

## 读取记录修正

- 初始 `Measure-Object -Line` 输出 8,027 与实际内容不符；改用 `@(Get-Content).Count` 复核为 10,463 行，后续按实际 EOF 继续读取。

## TechSpa 对照审计

- 总任务书明确指定 TechSpa 仅作 R1/反例对照：`backend/memory.py:1376` 的 Extract 前处理、`backend/storage/sessions.py:75-238` 的 session lifecycle；不得复制其 `session JSON → LLM profile update` 耦合，也不得用进程内 profile lock 代替 SQLite transaction/replay。
- `F:\workspace\TechSpa` 当前快照不是 IELTS Atlas 的同构实现：没有 `.rs`、`Cargo.toml`、`src-tauri`、`learning_observations`、M2 projector、rebuild/verify 命令或 M2 专项测试；实际为 FastAPI + React/Vite。
- TechSpa 可借鉴的只有边界性经验：真相源与可重算缓存分离、SQLite backup、安全归档路径处理、以及现有 profile/session 事务断点作为 M2 的反例测试输入。
- M2 实现基线仍是当前仓库的 M1 `learning_events` ledger、Rust/SQLite migration runner、application ports 和 Tauri developer-tools wiring。

## M2 缺口矩阵（冻结前）

| 契约 | M1 现状 | M2 最小补齐 |
|---|---|---|
| schema | `0012_learning_event_ledger.sql` 已存在 | `0013_learning_observation_projection.sql` 三张 derived 表及索引 |
| Reading 事实 | ledger payload 已有 outcome/attempt summary；M1 transition 在 `learning_tools.rs` | 复用 transition helper，生成 question/attempt/repeat observations |
| Writing 事实 | `WritingEvaluationCompleted` payload 已有 terminal/status/score/degradation/provenance | 只投影 terminal status、overall/criterion、degraded；failed/degraded 不造分 |
| Coach 事实 | 可靠事件只有 asked/generated，payload 已含 thread/attempt/asset/question linkage | 只生成 count/timestamp/linkage，不生成 preference |
| determinism | ledger event id 是 UUID，但内容 hash/idempotency 已稳定 | observation id/fingerprint 基于 projector/version/排序 evidence/key；hash 排序稳定 |
| replay | M1 rebuild 只重建 ledger，event search 有 50 条默认上限 | 独立全量 reader；rebuild 清 derived 表后事务内再生；verify 只读 |
| privacy | ledger 有 normal/private/restricted | 未授权 projector 只投影 normal；敏感事件跳过并计入报告 |
| adapter | Tauri 已有 developer-only `learning_events_rebuild/verify` | 增加对应 observation commands；不增加生产业务写接口 |
