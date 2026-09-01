# Progress Log

## Session: 2026-08-12

### Phase 1: 任务书与仓库基线发现

- **Status:** complete
- **Started:** 2026-08-12 Asia/Shanghai
- Actions taken:
  - 已收到用户对推进 M2.1 与 M3 的明确确认。
  - 已登记当前任务目标。
  - 已读取 `planning-with-files` 技能说明及其计划文件模板。
  - 已执行 session catch-up；未发现需要同步的旧会话上下文。
  - 已创建本次任务的三个持久规划文件。
  - 已核对当前分支为 `IELTS-WRITING-FEAT`、HEAD 为 `7a99ea4`，并记录工作树已有的大量用户无关删除/修改。
  - 已完成 M2 代码、domain transition helper、Tauri command/application adapter 与测试基线读取。
  - 未改代码基线下运行 `cargo test -p ielts-db --test learning_observations`：7/7 通过。
- Files created/modified:
  - `task_plan.md`（创建）
  - `findings.md`（创建）
  - `progress.md`（创建）

### Phase 2: 交付边界与实施切片

- **Status:** complete
- Actions taken:
  - 将任务书 M2.1/M3 条款映射到 domain contract、DB gateway、application port、Tauri command、Python sidecar 和 memory validator 的最小切片。
  - 确定 M2.1 先于 M3 candidate consumption；M3 sidecar 无 DB bootstrap 可并行，但本次按 M2.1 先落地。
  - 确定不重写 M2 projector，不新建 Rust RAG backend，不让 Python 直连 canonical SQLite。
- Files created/modified:
  - `task_plan.md`（更新阶段与决策）
  - `findings.md`（更新基线与缺口）

### Phase 3: M2.1 实现

- **Status:** complete
- Actions taken:
  - 已修复 scored/unscored transition：未评分观察保留，但不覆盖 last-scored 状态。
  - 已将 evidence/projector version bump 到 v2，并让 rebuild 清理同 projector key 的旧版本派生行。
  - 已加入 Reading score ratio 0..=1、Writing band 0..=9 的域校验，以及 projection run 成功记录保留策略。
  - 已建立 domain 层 Cognitive Read DTO、DB bounded snapshot/batch/evidence 查询与 freshness verify→rebuild→verify 主链。
  - 已新增 unscored interleaving golden test；局部测试 8/8 通过。
  - 已运行静态套件 18/18 通过；practice flow E2E 首次外层 120 秒超时，延长命令窗口重跑通过。
  - 探查确认：production read 必须独立于 developer-only rebuild/verify；DTO 还缺 generatedAt，应用/Tauri 三条只读 command 尚未接入。
  - 探查确认：M3 先做无 DB 的 M3-00A sidecar bootstrap；Memory evidence 不得 FK 到会全量重建的 Observation 表。
- Files created/modified:
  - `crates/ielts-domain/src/learning_tools.rs`
  - `crates/ielts-domain/src/cognitive_read.rs`
  - `crates/ielts-db/src/learning_observations.rs`
  - `crates/ielts-db/src/learning_tools.rs`
  - `crates/ielts-db/src/cognitive_read.rs`
  - `crates/ielts-db/tests/learning_observations.rs`
  - `crates/ielts-domain/src/lib.rs`
  - `crates/ielts-db/src/lib.rs`

### Phase 4: M3 实现

- **Status:** in_progress（M3-00A 与 Memory proposal boundary 已完成；M3 production runtime/persistence 仍在后续）
- Actions taken:
  - 已建立 `agent-runtime-python` 标准库 framed JSON-RPC bootstrap：4-byte big-endian frame、严格 envelope、handshake、health、request-scoped cancel registry、shutdown、structured error、frame limit。
  - 已建立 Rust `cognitive_runtime` host contract：单一 lifecycle state、protocol/build/capability/frame 校验、partial/coalesced frame 单元测试。
  - 已冻结 `schemas/cognitive_protocol` 的 envelope/runtime schema 与 v1 fixtures。
  - 已记录 M3-00A ADR；明确当前无 `uv`，不伪造 `uv.lock`，externalBin/frozen artifact/真实 model-tool adapter 尚未声称完成。
  - Python protocol tests 6/6 通过；Rust host contract tests 4/4 通过。
  - required static gate 20/20 通过；packaged practice flow 首次原生 picker UI wait 抖动失败，重跑后全部通过。
- 已新增 `crates/ielts-domain/src/memory.rs`：固定七 namespace、六 source class、生命周期状态、九种 stable-ID mutation action、tagged activity scope 与 v1 schema bounds。
- 已新增 `crates/ielts-application/src/memory/validator.rs`：CognitiveRuntime source authority、evidence/user/scope/trust/sensitivity 校验、duplicate/target 状态、injection/secret quarantine；不执行 persistence。
- 已新增 `schemas/memory_proposal/proposal.schema.json` 与 v1 fixtures；已新增 `ADR-M3-01-Memory-Proposal-Validator.md`，明确 migration/persistence deferred，不伪装 M3 完成。
- 已新增 Python `memory_proposals.py` strict proposal parser：标准库、不可变 typed proposal、重复字段/evidence、unknown field/index、大小、版本、stable ID、scope 全部 fail closed；不接 SQLite/keyring/Tauri 路径。
- 已并发完成 Rust wire integration tests 与 `check_m3_contracts.py`，并接入静态套件；没有引入 Rust RAG backend 或 Python-equivalent Rust extractor。
- M3 Memory 单元/集成验证：Python 14/14、Rust validator 10/10、Rust wire contract 11/11、M3 checker pass。
- 当前 M3 明确未完成：model/tool host adapter、真实 sidecar lifecycle/externalBin、observation snapshot/AgentRun trace wiring、`0014_memory_profile_core.sql`、memory persistence/promotion/capacity/backup/privacy/flag/rollback、model-backed candidate extractor。
- Files created/modified:
  - `agent-runtime-python/pyproject.toml`
  - `agent-runtime-python/src/ielts_agent/{__init__,__main__,framing,protocol,runtime}.py`
  - `agent-runtime-python/tests/test_protocol.py`
  - `schemas/cognitive_protocol/envelope.schema.json`
  - `schemas/cognitive_protocol/runtime.schema.json`
  - `schemas/cognitive_protocol/fixtures/v1/*.json`
  - `src-tauri/src/cognitive_runtime.rs`
  - `src-tauri/src/lib.rs`
  - `developer/docs/ADR-M3-00A-Python-Cognitive-Runtime-Bootstrap.md`
  - `developer/tests/ci/run_static_suite.py`
  - `crates/ielts-domain/src/memory.rs`
  - `crates/ielts-application/src/memory/{mod,validator}.rs`
  - `crates/ielts-application/tests/memory_proposal_contract.rs`
  - `agent-runtime-python/src/ielts_agent/memory_proposals.py`
  - `agent-runtime-python/tests/test_memory_proposals.py`
  - `schemas/memory_proposal/{proposal.schema.json,fixtures/v1/*.json}`
  - `developer/docs/ADR-M3-01-Memory-Proposal-Validator.md`
  - `developer/tests/ci/check_m3_contracts.py`

### Test Results (updated)

| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| `cargo test -p ielts-db --test learning_observations` | M2.1 semantic/version/invariant patch | 全部通过 | 8/8 通过 | pass |
| `python developer/tests/ci/run_static_suite.py` | Tauri/Vue/Rust static gate | 18 checks pass | 18/18 pass，生成 static-ci-report.json | pass |
| `python developer/tests/e2e/suite_practice_flow.py` | packaged Tauri practice flow | packaged flow pass | 首次外层 120s 超时；用 360s 重跑，全部 checks pass | pass |
| `python -m unittest discover -s agent-runtime-python/tests -p 'test_*.py'` | M3-00A Python protocol | 全部通过 | 6/6 通过 | pass |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime` | M3-00A Rust host contract | 全部通过 | 4/4 通过 | pass |
| `python developer/tests/ci/run_static_suite.py` | M3-00A static gate | 全部通过 | 20/20 通过 | pass |
| `python developer/tests/e2e/suite_practice_flow.py` | M3-00A no-regression packaged flow | 通过 | 首次 picker wait 抖动；重跑全部通过 | pass |
| `python -m unittest discover -s agent-runtime-python/tests -p 'test_*.py'` | M3 Python protocol + proposal boundary | 全部通过 | 14/14 通过 | pass |
| `cargo test -p ielts-application --lib memory` | Rust Memory validator | 全部通过 | 10/10 通过 | pass |
| `cargo test -p ielts-application --test memory_proposal_contract` | Rust/Python-compatible Memory wire contract | 全部通过 | 11/11 通过 | pass |
| `python developer/tests/ci/check_m3_contracts.py` | M3 schema/dependency/sidecar static boundary | pass | pass | pass |
| `python developer/tests/ci/run_static_suite.py` | M2.1 + M3 integrated static gate | 全部通过 | 23/23 通过 | pass |
| `python developer/tests/e2e/suite_practice_flow.py` | M2.1 + M3 packaged Tauri regression | pass | pass；picker 未复现抖动 | pass |

## Error Log

| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-08-12 | `rg.exe` 被 Windows 拒绝启动 | 1 | 切换到 PowerShell 原生只读检索，不重复失败命令 |
| 2026-08-12 | `uv` 命令不可用 | 1 | 先用 Python 标准库完成 sidecar bootstrap；锁文件留到可用依赖工具后生成 |
| 2026-08-12 | 错误假设 `sqlite.rs` 为文件 | 1 | 改为定位目录模块后读取 |
| 2026-08-12 | M2.1 targeted test 首次 golden hash 仍是旧 score fixture | 1 | 将 Reading `scoreValue` fixture 修正为 ratio `0.75` 并更新受影响 golden hash |
| 2026-08-12 | practice flow E2E 外层命令窗口 120 秒超时 | 1 | 延长到 360 秒；release 构建和 packaged flow 全部通过 |
| 2026-08-12 | M3-00A E2E 原生 workspace picker 回填后 UI wait 超时 | 1 | 不改测试；立即重跑后 packaged flow 全部通过，记录为环境抖动 |
| 2026-08-12 | 并发 M3 persistence/runtime 审计在用户中断后四个 agent 均变为 `not_found` | 1 | 不采纳任何缺失结果；执行 session catch-up、重读计划，并将审计拆小后重新并发 |

## Session: 2026-08-13 — M4

### Phase 1: M4 任务书与仓库基线发现

- **Status:** in_progress
- **Started:** 2026-08-13 Asia/Shanghai
- 已创建 active goal，范围锁定为任务书 v1.3 的 M4，不回滚或覆盖并行 M3 改动。
- 已读取 `planning-with-files` 技能、执行 session catch-up，并复核现有 `task_plan.md` / `findings.md` / `progress.md`。
- 已复核任务书 M4、v1.3 delivery order、Rust/Python ownership、建议 schema、关键伪代码及 Learner Model 验收项。
- 当前工作树包含大量既有用户/M3 未提交改动；所有 M4 写入必须以新增/精确不重叠文件为优先，并在每次修改前复核状态。
- 下一步：等待并行探子返回迁移入口、现有 M2 contract、参考实现、接线点、测试门禁和冲突面证据。

## 5-Question Reboot Check

| Question | Answer |
|----------|--------|
| Where am I? | Phase 4：M3-00A 与 Memory proposal boundary 已完成，production persistence 仍待推进 |
| Where am I going? | 完成任务书规定的 M3 vertical slices，并逐阶段回归验收 |
| What's the goal? | 严格依据指定任务书推进 M2.1 与 M3，保持架构边界与零回归 |
| What have I learned? | M2.1 gateway 已可供 bounded read；M3 proposal 只能由 Rust validator 授权，Python 不能触碰 canonical truth |
| What have I done? | 完成 M2.1、M3-00A、Memory proposal/parser/test/gate 的第一批实现，并通过 23 项 static 与 packaged E2E |

## 2026-08-13 M4 Implementation Update

- 已新增并注册 `0015_learner_model_v1.sql`；在 M3 的 `0014_memory_profile_core.sql` 之后顺序应用，未创建或覆盖 `0014`。
- 已新增 `ielts-domain::learner`：versioned taxonomy/query DTO、weighted Beta、neutral decay、familiarity config、uncertainty/trend/priority/probe 纯函数。
- 已新增 `ielts-db::learner`：从 `learner_observations` + canonical `learning_events` deterministic 重建五张 M4 表，稳定 skill-observation ID、映射来源优先级、用户隔离的同 asset discount、state/schedule hash、bounded snapshots、verify。
- 已新增 application learner read/admin ports、Tauri learner commands、`learner-model-v1` Cargo features、默认关闭的 Vue feature flag、技能复习页与导航入口；未增加额外 shell/filesystem capability。
- 已新增 `crates/ielts-db/tests/learner_model.rs`，覆盖 replay、same/new asset 权重、mapping source/version、deactivation、intervention provenance、uncertainty、avoid assets、probe 与 full verify。
- 已新增 `developer/tests/ci/check_m4_contracts.py` 并接入 static suite；单独运行已通过。
- 已验证：`cargo check -p ielts-db --locked`、`cargo check -p ielts-application --locked`、`cargo check -p ielts-practice-tauri --locked`、`cargo test -p ielts-domain --locked`、`cargo test -p ielts-db --test learner_model --locked` 均通过。
- 期间修复：schedule probe 不能把 serde JSON 字符串（带引号）直接写入 SQL CHECK；同 asset familiarity cache 改为 `(user_id, asset_id)` 复合键；mapping source 遵从任务书四类枚举，deterministic fallback 使用 builtin provenance。
- 当前阶段：Phase 5；下一步补 corrected/still_wrong 与 migration/flag-off 静态证据，然后按仓库要求依次运行 static suite 与 packaged practice-flow E2E。

## 2026-08-13 M4 Final Gate

- 已新增 `developer/docs/ADR-M4-01-Learner-Model-v1.md` 与 `developer/docs/M4_STAGE_GATE_REPORT.md`，记录 M4 ownership、算法、迁移顺序、回滚、限制和门禁证据。
- M4 最终直接验证：domain 6 tests、application learner 1 test、DB learner integration 5 tests、M4 static contract 均通过。
- 最新 `python developer/tests/ci/run_static_suite.py`：27 checks，24 pass / 3 fail。失败仍是并行 M3 的 `tauri-plugin-shell` shipping contract、`externalBin` M3 contract、以及 M3 `0014` 造成的两个 v8 history-retention fixture；M4 新增检查与 M4 测试均通过。
- 最新 `python developer/tests/e2e/suite_practice_flow.py`：launch、Vue routes、UI visuals、reading IPC、Agent IPC boundary 全部通过；Agent workspace picker 多次受系统 clipboard `failed to open clipboard` 阻塞，未改动 E2E 或 M4 代码。
- 迁移验证已覆盖 fresh DB、v11→v15 upgrade、idempotent migrate、deactivate/recover；feature flag 默认 false 由静态 contract 锁定。
- M4 目标已完成；剩余全仓 gate 失败属于并行 M3 尚未收尾的外部工作树状态，按用户要求未回滚、未重写、未抢占其代码。

## 2026-08-14 M2.1/M3 收口：迁移幂等修复 + 全量门禁转绿

- 接手历史 Codex 会话，核对工作树权威状态：M2.1 认知读网关与 M3 Memory/sidecar 主干代码均已落地，此前 27 项静态门禁中 3 项红灯是「源码已修、报告未刷新」+「M4 并行迁移使 fixture 过期」两类残留。
- 修复 `crates/ielts-db/migrations/0014_memory_profile_core.sql`：六表与索引补 `IF NOT EXISTS`，对齐仓库迁移约定（0012/0013 均为 `IF NOT EXISTS`），消除 history_retention 重放 v8→remigrate 路径上的 `table explicit_user_preferences already exists` 失败。
- 修复过期迁移版本 fixture：`tests/learning_events.rs`（forward-only 期望 `[12,13,14,15]` 且 `version==15`）、`tests/phase3_migration.rs`（`version==15` 与 `migrate()` 全量 applied 列表含 15）。二者此前硬编码 M3 末版本 14，被并行 M4 的 0015 迁移打破。
- 并发派子代理三路：① M2.1/M3 任务书 DoD 证据矩阵（结论：无正确性阻断项，仅余「懒启动」「读网关未暴露为 Python host capability」「forget 保留语义标签」等低危待办）；② 基准/测试覆盖核查（确认 `[[bench]] m2_1_projection` 已注册于 `crates/ielts-db/Cargo.toml` 且 `cargo bench --no-run` 可编译，golden/privacy/forget 测试均断言到位）；③ 文档收口（新增 `ADR-M2.1-Cognitive-Read-Gateway.md`、`M3_STAGE_GATE_REPORT.md`，改写 `ADR-M3-00A`/`ADR-M3-01` 移除「未接线 externalBin / model-tool 未实现 / 持久化暂缓」等陈旧声明）。
- 强制门禁结果：
  - `python developer/tests/ci/run_static_suite.py`：**27/27 pass**（此前 3 项红灯全部转绿）。
  - `python developer/tests/e2e/suite_practice_flow.py`：**passed / exitCode 0**，16 项 checks 全通过（含 agentWorkspaceRun）；首次运行复现原生 picker UI 文本等待抖动，立即重跑通过，与历史记录一致，属环境抖动非回归。
- 遗留（低危，未阻断验收）：RuntimeManager 为懒启动（首 `memory_generate_candidates` 才 spawn sidecar，非启动即预热）；M2.1 三条读 capability 尚未作为 Python host capability 暴露（当前 Python 仅经 `tool.invoke(memory.candidate_input)` 取得有界输入，满足「Python 不直连 SQLite」）；`forget_memory` 保留 `canonical_key/normalized_label/subject_key` 语义标签（正文 content/title/structured_json 与 mutations 审计均已擦除/脱敏）。

## 2026-08-14 M3 遗留项收尾 + M5 开跑

### M3 遗留项（5 项全清）
1. 懒启动：保留（任务书「按需启动」），`ADR-M3-00A` 增补 Lifecycle 段落。
2. 读网关 capability：推迟到 M5（按真实 corpus 消费需求暴露，不写死代码）。
3. forget 语义标签：`memory.rs` `forget_memory` 补 `canonical_key='redacted', normalized_label='redacted', subject_key=NULL`；`content_hash` 按任务书 10.10 作为不可反推 tombstone 保留；`memory_profile_core` 测试新增三处断言。已 `cargo test -p ielts-db --test memory_profile_core` 4/4。
4. quarantine 残留 `issues_json`+`content_hash`、5. 基准无硬阈值：记录为接受（非原始模型文本 / 基线数据）。`M3_STAGE_GATE_REPORT.md` 增「遗留项收尾」段。
- 门禁复跑：`run_static_suite.py` 27/27；`suite_practice_flow.py` 16 项全过。

### M5 Slice 1（Rust corpus export gateway）—— complete
- `0016_context_retrieval_trace.sql`：`agent_context_snapshots`/`agent_context_items`/`retrieval_index_registry`/`retrieval_runs`/`llm_invocations`，注册为 version 16。
- `ielts-domain/src/corpus.rs`：`CorpusManifest`/`CorpusChunk`/`CorpusExportQuery`/`CorpusExportPage`/`CorpusFetchQuery`/`CorpusFetchResult`；`CORPUS_CHUNKING_VERSION=1`，chunk_id=`{activity}:{asset_id}:v1:0`。
- `ielts-db/src/corpus.rs`：`corpus_manifest`/`export_corpus_chunks`（cursor 分页）/`fetch_corpus_chunks`（stable ID 解析）；content_hash=asset fingerprint；HTML→text 确定性提取；reading=passage+questions，writing=topic prompt。
- `ielts-application/src/corpus.rs`：`CorpusExportStore` + `CorpusExportService`。
- `src-tauri/commands/corpus.rs` 三命令 + `context-compiler-v1` feature（tauri default on）；`ApplicationStore` 实现 `CorpusExportStore`。
- 迁移版本 fixture 同步 15→16：`learning_events.rs`/`phase3_migration.rs`/`learner_model.rs`。
- 测试：`corpus_export.rs` 4/4（manifest 计数、cursor 分页、fetch 稳定 ID + missing、pdf_only 排除）。
- `cargo check -p ielts-practice-tauri --locked` 通过；受影响迁移/内存测试全绿。
- 门禁复跑：`run_static_suite.py` 27/27；`suite_practice_flow.py` 16 项全过。

### M5 剩余切片（下一会话）
- Slice 2：Rust Context Materializer（M5-07/08，stable ID 二次授权 + canonical 重取 + 硬 token ceiling + hash + 落 `agent_context_snapshots/items`）。
- Slice 3：Python retrieval module（`corpus_sync`/`index_store`(FTS5)/`lexical`/`planner`/`context_planner`，derived `retrieval_v1.sqlite`）。
- Slice 4：`model.embed.batch`（M5-04，仅 eval 证明价值后启用）+ ADR + stage gate report。
