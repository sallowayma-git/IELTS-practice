# M3 Stage Gate Report

日期：2026-08-14  
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md`

## M3 交付结论

M3 vertical slice 阶段契约验证完成（历史 gate），覆盖 M3-00A 到 M3-07 的 authority 边界：

- M3-00A cognitive runtime：4 字节大端 framed JSON-RPC + 握手 + reverse RPC（`model.invoke`/`tool.invoke`）+ sidecar SHA-256 校验 + `externalBin` 打包；
- M3-01 proposal validator 合同不变（7 namespace、9 action、activity scope、source class 规则、5 种 disposition）；
- `0014_memory_profile_core.sql` 落地（`memory_items`/`memory_candidate_batches`/`memory_candidates`/`memory_evidence`/`memory_mutations`/`explicit_user_preferences`）；
- persistence（`persist_memory_candidate_batch`，含幂等重放）、promotion（`promote_memory_candidate`，CAS + 容量上限）、audit（`memory_mutations`）、forget（redacted tombstone + 语义标签擦除）、context preview、explicit preference 全部落地；
- Tauri commands 已接通且 feature-gated（`memory-core-v1`）：`memory_generate_candidates`、`cognitive_runtime_status/health/cancel/restart`、`memory_promote_candidate`、`memory_put_explicit_preference`、`memory_context_preview`、`memory_forget`；
- Python 只通过 reverse RPC 调 model/tool，无 sqlite/keyring/DB 路径（静态门禁强制）。

## M3 直接验证（本次会话实测）

| 命令 | 结果 |
|---|---|
| `cargo test -p ielts-application --lib memory --locked --offline` | 10 passed |
| `cargo test -p ielts-db --test memory_profile_core --test cognitive_read --locked --offline` | 6 passed |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` | 4 passed |
| `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` | 20 passed |
| `python developer/tests/ci/check_m3_contracts.py` | pass |
| `python developer/tests/ci/smoke_agent_runtime_sidecar.py` | pass（coldStart 894ms / idleRss 8.9MB / unpacked 12.1MB） |

未在本会话单独重跑、但属于 `run_static_suite.py` 既有门禁的命令：`cargo test -p ielts-application --test memory_proposal_contract`、`--test memory_service_contract`。

## 仓库级门禁状态

`run_static_suite.py` 尚未在 M3 收尾后全量重跑；M4 报告记录的最新结果为 24/27 pass，3 个失败均来自并行 M3 工作树（`tauri-plugin-shell` 依赖/注册、v8 history-retention fixture、`externalBin` 状态），非 M3 新增检查。M3 的 contract gate（`check_m3_contracts.py`）、Python 单测、sidecar smoke 与 Rust authority 单测在本会话均为 green，构成 M3 自身的最小门禁闭环。

## 诚实的限制

- benchmark 为 baseline 数据，无任务书规定的硬性 pass/fail 阈值：`developer/tests/benchmarks/reports/m3_sidecar_release.json` 只记录单次实测（coldStart/idleRss/unpackedSize/compressedSize/installerDelta），是观测值而非逐 task 的判定标准。
- sidecar 冷启动 / RSS / 体积阈值目前只在 `smoke_agent_runtime_sidecar.py` 内以常量断言（`MAX_IDLE_RSS_BYTES=150MB`、`MAX_WINDOWS_COLD_START_MS=1500ms`、`MAX_UNPACKED_BYTES=60MB`），未跨平台、未做多轮统计稳定性验证。
- `memory_generate_candidates` 的端到端路径依赖真实 AI provider 配置；本会话验证的是合同/协议/持久化边界，未对真实模型输出做端到端断言。

## 遗留项收尾（2026-08-14）

交接说明列出的 5 个低危遗留项逐条处置如下：

1. **RuntimeManager 懒启动** — 保留懒启动，与任务书「按需启动」一致。已在 `ADR-M3-00A` 增补 Lifecycle 段落说明，不设开机预热。
2. **读网关未暴露为 Python host capability** — 判定为**推迟到 M5**。当前 Python 经 `tool.invoke(memory.candidate_input)` 取有界输入已满足「不直连 SQLite」，M3 DoD 不要求 Python 直读 `learning.observations.*`。M5-01 定义的是另一份合同（`retrieval.corpus_manifest`/`export_chunks`/`fetch_chunks`），届时按真实消费需求暴露，不在 M3 制造无消费者的死代码。
3. **forget 保留语义标签** — 已修复。`forget_memory` 现同时擦除 `canonical_key='redacted'`、`normalized_label='redacted'`、`subject_key=NULL`；`content_hash` 按任务书 10.10 作为不可反推的 tombstone/hash 保留。回归 `memory_profile_core` 新增三处断言。
4. **quarantine 残留 `issues_json` + candidate `content_hash`** — 接受为可保留。`issues_json` 是校验失败原因（如「prompt injection detected」），`content_hash` 是摘要，二者都不是原始模型文本，且已随 forget 清空 `proposed_statement/proposal_json/evidence`。见 `memory.rs` candidate 落库路径。
5. **基准无硬阈值** — 接受为基线数据。任务书未定义 M2.1 projection 的 pass/fail 阈值；`m2_1_projection.json` 是观测值。sidecar 的冷启动/RSS/体积阈值已由 `smoke_agent_runtime_sidecar.py` 常量断言固定，见本报告「诚实的限制」。

## 风险与后续边界

M3 已形成可独立验证的 authority 合同。遗留项收尾后需重跑原始两道命令（`run_static_suite.py` + `suite_practice_flow.py`），确认 `0014` migration、Tauri bundle/capability、`externalBin` 与 history-retention fixture 的最终合同。此复核不改变 M3 数据模型或 validator 合同。下一阶段为 M5 Python-first Retrieval/RAG + Context Planning。

## Round 3 Post-Audit Addendum（2026-08-31）

本报告的“阶段契约验证完成”只表示本报告列出的协议、validator、持久化和静态边界被验证；它不等于 M3 全部生产能力、真实 provider 输出或后续阶段闭环已经完成。M3 的历史限制和当前代码事实以 [Round 3 审计报告](PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md) 及 [工程文档入口](INDEX.md) 为准。
