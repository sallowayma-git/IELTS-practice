# Findings & Decisions

## Requirements

- 严格围绕 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 开发。
- 推进 M2.1 与 M3 的工作进程，包含现状核对、实现、测试和验收记录。
- 不扩展到任务书之外的范围。
- 遵守仓库目标：Tauri 2 桌面客户端；优先 Tauri command/capability + Rust domain/SQLite；采用 Python-first RAG 方向。
- 每次优化或功能改动后按顺序运行：
  1. `python developer/tests/ci/run_static_suite.py`
  2. `python developer/tests/e2e/suite_practice_flow.py`

## Research Findings

- 任务书 v1.3 明确：M1 已冻结在 `c9e4f62`，M2 已完成在 `7a99ea4`；M2 的 Learning Truth → Event → Observation Rust 数据/证据底座保持冻结，Retrieval/RAG 从一开始采用 Python-first derived retrieval engine。
- 从 M2.1 起，以任务书第 21–23 章 v1.3 内容为实施权威；旧章节只作为背景，若冲突以 v1.3 为准。
- M2.1 是窄的 `Projection Freshness + Cognitive Read Gateway` hardening gate：不重做 M2 schema/taxonomy，只冻结 edge semantics（必要时 bump projector version），并解决 Python 消费前的 freshness、read-contract、domain-invariant、performance boundary。
- 总体架构是 One Agent Platform / Two Execution Lanes：Rust Product Host 拥有 canonical truth、事务、授权、审计、最终 materialization/persistence；Python Cognitive Runtime 负责 M3+ 新增复杂 Agent cognition、Memory、Dream、RAG orchestration 与 eval。
- Rust 不要求与 Python feature parity；既有 Rust Coach / AttemptReview / simple Q&A 保留为 baseline/fallback/低延迟 lane，不迁移 M1/M2 Observation 逻辑。
- Python sidecar 按需启动，通过 typed host capability / versioned local RPC 读取事实并提交 proposal；Python 不直接拥有 canonical SQLite truth，也不能绕过 Rust 的权限与事务。
- M3 bootstrap 应优先薄 Python orchestration + Pydantic / OpenAI Agents SDK 与标准 HTTP/async 依赖；LangGraph、torch、transformers、sentence-transformers、CUDA 和本地 ML runtime 不作为基础依赖。
- Base sidecar provisional 门禁：compressed artifact <= 60 MB、installer delta <= 80 MB、idle RSS <= 150 MB、参考 Windows cold start <= 1.5 s，且基础 sidecar 不依赖 torch/transformers/CUDA。
- M3 之后的建议目录包含 `agent-runtime-python/`、`schemas/cognitive_protocol/` 和 `src-tauri/src/cognitive_runtime/`；Rust 负责 SQLite/migration、deterministic projection、授权、最终 context materialization，Python 负责 typed plan/proposal 与复杂 cognition。
- 任务书推荐按能力拆分 migration，不把所有表塞进一个 migration；每个 migration 需支持 v11 upgrade、fresh DB、事务、rollback/recovery 说明、backup/retention/privacy delete 测试。
- 数据层分为 canonical learning truth、append-only evidence、derived projections、Agent execution/context、self-evolution governance 五级；`agent_runs` 不能替代长期 `agent_threads/messages/checkpoints`。
- `learning_events` 必须带 `idempotency_key`、source / stable IDs、content hash、schema version、consolidation state 与 sensitivity；事件账本是分析层，不是第二事实源。
- 记忆模型要求 `memory_items` 的 candidate/active/superseded/archive 等生命周期、confidence/importance/source_trust、canonical slot、supersedes 链；`memory_evidence` 与 `memory_mutations` 保留证据和审计。
- Background jobs 采用 SQLite 原子 claim、单 worker、heartbeat、stale-running recovery 和 dedupe key，不引入 Redis 或外部队列。
- Learner Model 初期使用可解释的 Beta-Bernoulli / EWMA、时间衰减、跨 asset 证据多样性、重复同题降权、错误 taxonomy 与 uncertainty，不先做 DKT。
- Context snapshot 必须记录 compiler version、query plan、token budget、rendered context、hash，以及 context item 的 rank/score/token/provenance；Context 由 typed plan + Rust 最终 materialization 形成。
- 第一阶段 retrieval 采用 SQLite FTS5 + metadata；embedding 只有在 retrieval eval 证明不足、拥有 100–300 条高质量 memory、固定 model version 且具备重建/回滚时才启用。
- 权威学习事件必须由 Rust use case 在业务事务成功后追加，不能由 Vue 构造；事件与业务结果同事务写入，避免提交成功但分析事件丢失。
- v11 数据迁移采用建表 + 一次性 deterministic backfill job，固定 idempotency key、可 checkpoint、不得在 schema migration 中调用 LLM 或大规模复杂 backfill。
- Promotion Gate 必须确定性检查 evidence 存在、非空、置信度、prompt injection、secret、procedural 最低证据量，并对敏感、破坏性、显式偏好冲突和低置信 profile inference 转人工审阅。
- Dream 分为 Hot Capture、Session Close、Daily、Weekly、Monthly；只有 Deep 阶段能改变 Active Memory，REM 只写 candidate。Dream 需可在应用重启后补跑、可暂停/取消并受 token/cost hard limit 约束。
- Learner Model 由人工维护且版本化的 taxonomy 与 error taxonomy 驱动；Beta-Bernoulli 权重包含题目映射、时间、novelty、完成质量、证据可信度；同题即时重复显著降权，跨 asset/延迟证据更可信。
- Context Compiler 是正式 use case，不应散落在 Vue/Prompt/command 中拼字符串；请求需包含 task/surface/current asset/attempt/question/text/capability/token budget，task 优先使用 UI hint + route/entity + deterministic rules。
- Context retrieval 顺序固定为精确实体、metadata、FTS5、状态/时间过滤、评分去重证据检查、预算打包；embedding 仅作为后续 hybrid 增强。已 superseded memory 注入率必须为 0，无来源推断注入率必须为 0，token 超预算率必须为 0。
- Rust Agent loop 冻结为 baseline/fallback；Python 不复制 existing Coach/AttemptReview。Rust/Python 共享 Model Gateway、Capability Gateway、audit、ContextManifest、Prompt Registry、Memory/Observation schema、error taxonomy 和 eval identity。
- M3 runtime 必须提供 persisted run/job state、idempotent host tools、checkpoint boundary、timeout/cancel、schema validation 与 replay tests；LangGraph 不是 M3 基础依赖。
- 工具注册应采用 `AgentTool` + `AgentToolRegistry` 与 effect policy，不让巨型 `match tool_name` 无限扩张；第一批 learning tools 只返回紧凑 canonical view，不返回自由文本结论或通用 SQL。
- Python sidecar v1 优先 framed JSON-RPC over stdin/stdout，支持 request correlation、protocol negotiation、deadline/cancel、payload limit、structured errors、trace/build hash；sidecar crash 只标记 interrupted，不自动重放 mutation。
- Sidecar release 必须锁定 `uv.lock`、生成 SBOM、记录体积/cold-start/RSS、校验 SHA-256、禁止 base profile 的 torch/transformers/sentence-transformers/CUDA。
- Coach 正确性、安全与证据 grounding 优先于诊断、教学适配和风格偏好；一次不满意只能生成 candidate，明确偏好可立即生效，长期策略需跨题目与 outcome 证据。
- Prompt/Skill 全局演化必须分离于用户 Memory/策略，采用 registry、train/validation/holdout/red-team、deterministic/LLM/human graders、shadow/canary、硬门槛与 rollback；MVP 先不部署 GEPA。
- Tauri command 只做反序列化、授权/桌面状态、adapter、application service 调用、error envelope 和事件转发，不拼 Prompt、不排 Memory、不编排 Dream 事务。
- M3 规划原则是纵向切片：Schema/Data + Application Use Case + Tauri Adapter + 最小 Vue 可观察面 + Unit/Integration/Packaged E2E + Flag/Rollback；旧路径在新路径验收前必须保持工作。
- 任务书权威交付顺序明确：M2.1 Freshness + Cognitive Read Gateway → M3 Python Cognitive Runtime + Memory Core → M4 Learner Model → M5 Python-first RAG；M2.1 可与 M3 无 DB 的 sidecar bootstrap 并行，但 M3 extractor 不得在 snapshot/freshness contract 通过前读取 observations。
- M2.1-01 必须冻结 scored transition：`wrong → unscored → correct = corrected`、`correct → unscored → wrong = newly_wrong`、无更早 scored 的 `unscored → correct = first_observation`、`unscored → unscored = no scored transition`；unscored 保留但不覆盖 last-scored state，并需 projector/evidence version 变化可解释。
- M2.1-02/03 必须提供 Rust 只读 `ObservationSnapshot` 与 `learning.observations.snapshot/get_by_ids/events.get_evidence_by_ids`；snapshot 携带 schema/projector/version、ledger/output hash、freshness、bounded/truncated metadata；Rust 比对 hash，stale 时 coalesced rebuild，不能把 rebuild 失败传导为 Reading submit 失败，Python 不能读 DB path。
- M2.1-04/05/06 必须完成 10k/50k/100k benchmark、projection run retention、IELTS score/count/status/source-reference domain invariants 与 corruption/quarantine tests；cursor 只能优化，full rebuild hash 才是 correctness source。
- M3-00 首个 vertical slice 是 Python sidecar bootstrap：lifecycle、handshake/build hash/capabilities、model/tool host adapters、observation snapshot、AgentRun/trace persistence；Python 只能拥有可删除可重建 derived state，禁止打开 canonical SQLite、credential/keyring、Tauri 内部路径。
- M3 Memory Core 固定一级 namespace `knowledge/language/strategy/behavior/metacognition/preference/goal`；LLM 可提出 leaf key，不能创一级 namespace；source class 必须区分 user_explicit/observed/inferred/predicted/consolidated/system_policy，predicted 默认 candidate/hypothesis，不能直接晋升。
- M3 mutation 必须以 stable `memory_id` 和 observation IDs 为目标，禁止 array-index mutation、文本外键、LLM 直接写库/决定 evidence/activate/delete；Rust resolver 负责 schema、namespace、ID/evidence/scope/source trust、冲突、容量、injection 和审计。
- M3 fallback 不依赖 embedding：exact canonical key → exact scope + normalized label → pending candidate；semantic merge 留到 M5 FTS/embedding。M3 DoD 是 explicit profile、evidence-backed pending candidate、无绕过 validator 的 active write、improve/regress、删除/归档后 Context 不再引用。
- M5 retrieval Rust 只做 corpus/auth/materialization/audit；Python 拥有 derived `retrieval_v1.sqlite` 与 query/ranking/fusion；最终 stable IDs 由 Rust 再授权、取 canonical text、硬 token ceiling 后形成 ContextPack。
- 任务书第 21.9 要求每阶段交付 ADR/scoped design、migration + previous-version fixture、domain types、repository/projection、application service、Tauri/Vue surface（需要时）、replay/golden、unit/integration/E2E、backup/restore、privacy/sensitivity、feature flag/rollback、metrics、参考许可说明、limitations 和 stage gate report。
- 任务书第 22.2 明确 Rust 当前 M2 文件优先，不为迎合旧目录重构；M2.1 目标文件可包括 `crates/ielts-application/src/cognitive_read.rs`，M3 可包括 `cognitive_runtime.rs`、`memory/validator.rs`、`memory/service.rs`；Rust 不新增 `vector_memory.rs`、`rag_engine.rs` 或 Python-equivalent extractor。
- 任务书第 22.3 明确 Python sidecar 是 internal worker，不需要 FastAPI/Web server；base profile 只允许 Pydantic、openai-agents（或等价薄 runner）和小型工具，禁止直接 `sqlite3.connect(<IELTS canonical db path>)`。
- 关键验收：M2.1 Python 请求 snapshot 时不能读 canonical SQLite、freshness/hash/version 必须可见且 stale 不能伪装 current；M3 每条 candidate 有 observation evidence，任何后台 LLM 不能绕过 validator 写 active memory，删除/归档后 Context preview 不再引用。
- 最终产品 gate 场景包括同题三次区分熟悉度、跨题错误聚合、风格反馈 candidate、旧画像 supersede、恶意题目 quarantine、关闭应用后的 job 恢复、Prompt candidate eval/shadow/rollback 和关闭自动学习。
- 核心数据原则：学习事实与 Agent 推断分离；原始事件追加；Memory 有 provenance、置信度、生命周期和 supersession；Context Pack 动态按需编译且可审计；Prompt/Skill 自进化必须离线评测后再发布。
- 当前仓库基线为 `7a99ea4`，分支 `IELTS-WRITING-FEAT`；M2 文件实际存在：`crates/ielts-db/src/learning_observations.rs`、`crates/ielts-db/tests/learning_observations.rs`、`crates/ielts-application/src/learning_observations.rs`、migration `0013`。
- 当前工作树已有大量与本任务无关的用户删除/修改（旧 planning、旧 tests、scripts、docs 等），不能清理、恢复或覆盖；本任务只触碰 M2.1/M3 相关新增/精确修复文件和本次规划文件。
- `ielts-domain::question_transition_state` 当前语义是 `(None, _) -> first_observation`，且调用者把 `current=None` 写回 previous state；这会使 `wrong → unscored → correct` 丢失 `corrected`，与 M2.1 hardening contract 冲突。
- M2 projector 当前 `LEARNING_OBSERVATION_PROJECTOR_VERSION=1`、`LEARNING_EVIDENCE_VERSION=1`，按 current version 删除/读取 derived rows；版本 bump 后若仍只删 current version，旧 projector rows 可能残留并污染下游读取，因此 rebuild 应清理该 projector key 的全部 owned rows。
- 当前 M2 已有 full rebuild/verify、deterministic input/output hash、quarantine、sensitivity skip、schema/hash/reference 校验、history delete 同事务 rebuild 与 golden tests；尚无 production observation snapshot/read gateway、freshness compare/rebuild contract、bounded DTO 或 projection-run retention。
- 当前 application 只有 developer-only rebuild/verify port；Tauri 只有对应 developer commands，`ApplicationStore` 也没有认知读取接口。`src-tauri/tauri.conf.json` 没有 `externalBin`/sidecar 配置，仓库未发现 `agent-runtime-python`、`pyproject.toml`、`uv.lock` 或 JSON-RPC runtime。
- 当前 `AppDb` 是进程内 Mutex SQLite handle，`ApplicationStore` 是现有 Tauri→application adapter；这是 M2.1 read gateway 和 M3 sidecar host orchestration 的最小复用入口。
- 当前 Tauri capability 只有 `core:*` 主窗口权限；command 注册集中在 `src-tauri/src/lib.rs`，没有 shell/process 权限，符合 sidecar 尚未接入的基线。
- 当前测试已有 replay/order/cascade/delete-middle/corruption/sensitivity/future-schema/writing-degraded/coach-no-preference/verify-loss 覆盖，但没有 unscored interleaving goldens、snapshot freshness/read contract、payload bound、projection-run retention 或 sidecar protocol tests。
- 基线验证：`cargo test -p ielts-db --test learning_observations` 在未改代码前通过 7/7；现有行为基线可保留，版本/语义修复后需更新受影响 golden hash。

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| 使用仓库根目录的 `task_plan.md`、`findings.md`、`progress.md` 作为持久工作记忆 | 长任务需要跨上下文保存计划、发现和测试结果 |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| 当前环境的 `rg.exe` 启动被 Windows 拒绝 | 改用 PowerShell `Get-ChildItem` / `Select-String`；不影响仓库本身 |
| 当前环境未提供 `uv` 命令 | M3 bootstrap 先采用 Python 标准库和协议测试，不增加未验证依赖或手写锁文件 |
| `ielts-db` 的 SQLite 模块采用目录布局 | 新增 DB gateway 前先读取实际 `src/sqlite/mod.rs` 与错误类型 |

## 2026-08-12 Implementation and Exploration Update

- M2.1 semantic hardening is now implemented: `question_transition_state` distinguishes `(None, None) -> unscored`, `(None, Some(_)) -> first_observation`, scored transitions, and `(_, None) -> unscored`; projection/tool callers retain the prior scored state across unscored observations.
- `LEARNING_EVIDENCE_VERSION` and `LEARNING_OBSERVATION_PROJECTOR_VERSION` are now `2`; rebuild removes all rows owned by the projector key before inserting the current version, preventing stale-version rows from contaminating reads.
- Reading `scoreValue` is validated as a finite ratio in `0..=1`; writing overall/criterion values are validated as finite IELTS bands in `0..=9`.
- Projection runs now retain the newest 20 completed runs per projector key; error history remains available.
- `crates/ielts-domain/src/cognitive_read.rs` and `crates/ielts-db/src/cognitive_read.rs` now provide bounded snapshot, observation batch, and canonical event evidence reads with Rust-owned freshness verification and stale rebuild.
- M2.1 local verification: `cargo test -p ielts-db --test learning_observations` passed 8/8, including a new `wrong -> unscored -> correct` projection golden.
- Required repository gates passed: `python developer/tests/ci/run_static_suite.py` passed 18/18; `python developer/tests/e2e/suite_practice_flow.py` passed after rerun with a 360-second outer timeout (the first 120-second outer timeout was only build-window exhaustion).
- Explorer confirmation: application/Tauri still lacks the three production read commands; add `generatedAt` sourced from matching projection run `finished_at` before wiring them. Keep developer-only rebuild/verify separate from production cognitive read.
- Explorer confirmation: M3-00A should be a no-DB Python framed JSON-RPC bootstrap with lazy lifecycle, handshake/build hash/capabilities, health/cancel/shutdown/crash handling; do not add extractor or Memory consumption before the fresh gateway is accepted.
- Explorer confirmation: Memory evidence must not have a cascading FK to `learner_observations`, because projection rebuild deletes/reinserts that table. Bind durable memory evidence to canonical event IDs and keep observation IDs logical/rebindable.
- M2.1 application/Tauri wiring is complete in the current worktree: `CognitiveReadStore` is separate from developer-only `LearningObservationStore`, and three production commands are registered behind `learning-observation-v1`; no DB path crosses the boundary.
- M2.1 DTOs now include `generatedAt` sourced from the successful projection run's `finished_at`; bounded responses enforce 16 KiB payloads, 128 evidence refs per observation, and 1 MiB serialized response size.
- M3-00A source contract is implemented but intentionally not release-ready: no `externalBin`, no `uv.lock`, no frozen executable/SHA/SBOM, no `model.invoke`/`tool.invoke`, no Memory extractor. This is an explicit limitation, not a hidden omission.
- M3-00A final gates: Python protocol 6/6, Rust host contract 4/4, static suite 20/20, packaged practice flow passed after one Windows native picker wait retry.

## 2026-08-12 M3 Memory Proposal Boundary Update

- `crates/ielts-domain/src/memory.rs` now freezes the M3 proposal-only domain contract: seven fixed namespaces, six source classes, six lifecycle statuses, nine operations, v1 schema bounds, stable `obs-*`/`mem-*` IDs, and an explicit `{type:"activity",key:"reading|writing"}` scope.
- `crates/ielts-application/src/memory/validator.rs` is the Rust authority for proposal validation. It rejects unsupported runtime source classes, missing/cross-user/cross-scope/untrusted evidence, inactive or missing targets, invalid namespace/key/statement, duplicate identity/evidence, and quarantines sensitive, prompt-injected, or secret-like content. It does not persist or activate anything.
- `schemas/memory_proposal/proposal.schema.json` plus `fixtures/v1` freeze the cross-language v1 wire contract. `agent-runtime-python/src/ielts_agent/memory_proposals.py` parses the same contract with standard library only and returns immutable typed proposals; Python remains unable to open canonical SQLite, keyring, or Tauri internal paths.
- M3 contract tests now include Python parser 14/14, Rust validator 10/10, Rust wire integration 11/11, and `check_m3_contracts.py` pass. The static suite includes both Rust memory checks and the M3 boundary checker.
- Integrated required gates after the concurrent development slice: `run_static_suite.py` 23/23 pass; `suite_practice_flow.py` packaged Tauri flow pass with all checks including `agentIpcBoundary`, archive, retention, backup, updater, and SQLite restart.
- Explicit remaining M3 gaps: no `0014_memory_profile_core.sql`, memory evidence/mutation audit tables, authoritative persistence/promotion/capacity transaction, backup/privacy/feature flag/rollback metrics, model/tool host adapter, real sidecar lifecycle/externalBin, observation snapshot/AgentRun trace wiring, or model-backed candidate extractor. These remain the next task-book slices.

## 2026-08-13 M3 Completion Audit

- M3-01 fixed namespace and M3-03 stable-ID wire contracts are implemented, but actual ID issuance and persistence are not yet proven.
- M3-02 source classes, M3-04 operations, M3-05 evidence checks, and M3-07 validator are partial: there is no promotion, state transition transaction, capacity/CAS enforcement, lineage persistence, or mutation audit.
- M3-06 Python candidate extractor and M3-08 explicit profile are absent. The current Python `memory_proposals.py` is a strict parser, not an extractor.
- The current Rust runtime host is framing plus an in-memory lifecycle contract. It does not yet spawn/own a process, correlate pending requests, perform real health/shutdown/crash handling, expose model/tool/snapshot host capabilities, or persist AgentRun traces.
- Memory evidence must not use a strong FK to `learner_observations`: the M2 projector rebuild deletes/reinserts owned observation rows. M3 persistence must store the stable observation ID plus immutable fingerprint/projector metadata and revalidate it inside the write transaction.
- The next persistence slice must use the task-book six-table boundary (`explicit_user_preferences`, `memory_items`, `memory_evidence`, `memory_mutations`, `memory_candidate_batches`, `memory_candidates`) rather than inventing a competing schema vocabulary.

## Resources

- `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md`
- `developer/tests/ci/run_static_suite.py`
- `developer/tests/e2e/suite_practice_flow.py`

## Task-book sections read

- Lines 1–11248 of 11248 read directly in the main thread; the task book is fully read. The authoritative M2.1/M3 scope, phase DoD, migration/order rules, directory guidance, pseudocode, final acceptance criteria, and v1.3 packaging notes are captured above.

## Visual/Browser Findings

- None.

## 2026-08-13 M4 Task Start

- 用户已明确要求直接完成 M4，不需要二次确认；另一个 agent 正在推进 M3，M4 必须避开其正在修改的文件和未冻结的 M3 persistence/runtime 语义。
- 任务书 v1.3 的 M4 权威范围是 `0015_learner_model_v1.sql`、Reading taxonomy v1、question→skill mapping、`learner_skill_observations`、weighted Beta mastery、same-item familiarity discount、skill review scheduler 和 trend/uncertainty 解释。
- M4 的 runtime owner 是 Rust deterministic state；不新增 Rust RAG backend、不让 Python 读取 canonical SQLite、不把 M3 proposal parser 当作 M4 persistence。
- 任务书明确要求 M4 输出可回答“为什么某技能需要复习”：skill state、uncertainty、支持的 attempt/question、重复题与 novel evidence 区分、下一次 probe 类型。
- 任务书 M4 测试硬要求：same evidence replay idempotency、same asset discount、new asset stronger evidence、mapping version migration、skill deactivation、corrected/still_wrong、few-sample uncertainty、time decay、scheduler 不重复选 exact asset、full rebuild equivalence、UI 不伪精确。
- 任务书验收对应 L-01..L-10：taxonomy versioned、mapping provenance、event rebuild、repeat downweight、distinct asset、uncertainty、无伪精度 UI、不人格化 state、delayed outcome linkage、优先新材料 transfer。
- 并行探子核对确认：当前 migration 只到 M2 `0013`，M4 五张表（`skill_catalog`、`question_skill_map`、`learner_skill_observations`、`learner_skill_state`、`skill_review_schedule`）均不存在；不能把 M2 `projector_version` 当 taxonomy version。
- 并行探子核对确认：M2 observation 已保留 `assetId`、question kind、gap/familiarity signals 和 event provenance，但尚未实现 novelty/familiarity 权重、Beta state、distinct-asset 聚合或 scheduler。
- 应用接线探子建议只新增独立 learner read contract/port/service/DB module/command/repository/page；复用 Cognitive Read 的 bounded response 形状，不修改巨型 `PracticeReadingPage.vue`，不开放额外 shell/filesystem capability。
- 并行风险文件暂列为：`crates/ielts-domain/src/lib.rs`、`crates/ielts-application/src/lib.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/app/application_store.rs`、`developer/tests/ci/run_static_suite.py`；这些文件只能做最小追加式变更，不能重排已有 M3 模块和 handler。

## 2026-08-13 M4 Implementation Findings

- M3 `0014_memory_profile_core.sql` 已在工作树出现，M4 `0015` 已追加到 migration registry 尾部；连续版本约束保持成立。
- M4 的 taxonomy 采用任务书示例命名：`reading.matching_headings`、`reading.tfng`、`reading.yng` 等 root，以及 `global_main_idea`、`proposition_boundary`、`false_vs_not_given` 等 curated child；question-kind fallback 以 `builtin` provenance 写入 map，content pack 优先于 builtin，manual 后置，model proposal 永不 active。
- `learner_model_rebuild` 只消费 M2 `learner_observations` 与 canonical `learning_events`，重建 M4 derived rows；taxonomy/map 配置保留。`learner_model_verify` 使用无写入 deterministic build 比较 counts/hash。
- 由于 M4 state hash 同时覆盖 state 与 schedule，bounded full state snapshot 也加载匹配 schedule 后计算同一 hash；subset snapshot 只对返回的 skill 子集计算 bounded hash。
- Rust schedule probe 必须写入裸 `snake_case` 文本而不是 JSON 字符串，否则 `skill_review_schedule.preferred_probe` CHECK 会失败；读取端反向从 SQL 文本解析 enum。
- 同 asset familiarity 必须按 `(user_id, asset_id)` 隔离，不能用单一 asset key，否则多用户数据会互相污染 novelty/familiarity。
- M4 UI 只展示 uncertainty band、trend、evidence、distinct assets、reason codes、probe 和 avoid assets；不展示 `masteryMean` 或 raw uncertainty 数字，符合任务书“不要伪精确”。
- 当前集成测试 3 个通过；剩余验收补强：corrected/still_wrong 的显式 golden、迁移升级/回滚/flag-off 的静态或临时 DB 证据，以及全量静态/E2E 两道仓库门禁。

## 2026-08-13 M4 Final Findings

- 当前 M4 DB integration 已为 5 tests：fresh/replay、curated mapping priority、mapping version/deactivation/recovery、corrected/still_wrong、v11 upgrade/idempotent migration。
- 现有 M2 fixture 使用 `questionKind=mcq`，M4 fallback 已显式兼容 `mcq -> reading.multi_choice`；未知 kind 会安全跳过，不凭空创建 taxonomy。
- 最终 UI/command path 不改变默认用户体验：`VITE_FEATURE_LEARNER_MODEL_V1` 默认 false；flag off 时 route/nav 不注册，旧 Reading/Writing/Agent route 保持原状。
- M4 直接 DoD 已闭环；仓库级静态/E2E 的 remaining failures 已写入 `developer/docs/M4_STAGE_GATE_REPORT.md`，责任边界是并行 M3/Windows clipboard，不是 M4 implementation。

## 2026-08-14 M5 Corpus Export Gateway Findings

- corpus 数据模型：`practice_assets`(canonical 身份) + `content_ref` 指向 JSON payload 文件（reading 的 `passage.blocks[].html` + `questionGroups[].bodyHtml` 是 HTML 正文）；writing 的 `writing_topics.title_json` 存 JSON 化 prompt。指纹 `practice_assets.fingerprint` 是 canonical 源哈希。
- chunk 粒度决策：v1 每 asset 一 chunk（reading 整篇 passage+questions、writing 整题 prompt），chunk_id=`{activity}:{asset_id}:v{CHUNKING_VERSION}:0`；不做段落级切分，留到 M5-11 eval 证明需要时再切。
- content_hash 复用 asset fingerprint（源变即失效 derived chunk/vector），不另算文本哈希，消除「源哈希 vs 文本哈希」双真源。
- HTML→text 用最小状态机（block 闭合标签补换行、去标签、解实体、collapse 空白），不引入 html 解析依赖；`extract_text_from_json`（writing）从 `writing/topics.rs` 提升为 `pub(crate)` 复用。
- fetch 的 stable-ID 解析用「剥已知 `:v{VERSION}:0` 后缀 + 首个 `:` 分割 activity」的右结合方式，asset_id 可含冒号也不歧义；非 chunkable/pdf_only/未知 activity 一律 missing_ids，fail-closed。
- M5 架构边界（勿越界）：Rust 只做 corpus export/fetch + final materialization + trace；Python 拥有 derived index/ranking；embedding（M5-04/05）默认不启用，等 golden eval 证明 lexical 不足再上。
