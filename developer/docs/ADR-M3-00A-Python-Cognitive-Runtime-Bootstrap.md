# ADR: M3-00A Python Cognitive Runtime Bootstrap

- 状态：Implemented / feature-gated（`memory-core-v1`）
- 日期：2026-08-14
- 范围：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 的 M3-00A

## 决策

M3-00A 冻结 4 字节大端长度前缀的 UTF-8 JSON 帧协议（`PROTOCOL_VERSION = 1`，`MAX_FRAME_BYTES = 1 MiB`），交付 Rust 托管生命周期 + Python sidecar 的最小完整链路：

- 严格 request/response 信封（`protocolVersion`/`requestId`/`traceId`/`deadlineMs`/`method`/`params`，响应 `ok`/`result`/`error`）；
- 协议/能力握手（`runtime.handshake`），runtime capabilities：`runtime.health`、`runtime.shutdown`、`memory.candidates.extract`、`memory.candidates.generate`；
- host 反向能力 `model.invoke`、`tool.invoke` 已实现，并在 Rust 侧强制 allowlist + run identity + deadline；
- 有界帧、request-scoped 取消注册表、优雅 shutdown、stderr-only 诊断。

## Scope

该 slice 已不止是 bootstrap：`model.invoke` 与 `tool.invoke` 均已落地。Rust 端 `dispatch_host_request` 只接受这两个 host method；`model.invoke` 走 `validate_model_request`（1–4 条消息、仅 `system`/`user` 角色、payload ≤ 1 MiB、`temperature` 必须为 0），`tool.invoke` 只 allowlist `memory.candidate_input` 一个工具并校验参数形状，同时落 `agent_tool_calls` 审计。每次 host 请求都校验 `protocolVersion`、`deadlineMs > 0`、active run 的 `trace_id` 与 `generation`，并按剩余 deadline 预算执行。

## Data and security boundary

Python runtime 仍无 `sqlite3`、无 canonical DB 路径、无 keyring、无 Tauri 内部文件系统访问（由 `developer/tests/ci/check_m3_contracts.py` 的 forbidden token 静态门禁强制）。Rust 仍是 canonical learning truth、授权、证据校验与 Memory 持久化的唯一所有者。runtime 依赖仅 `pydantic>=2.11,<3`（输入校验）；framing/protocol 走标准库。sidecar build ID 不是元数据：`build.rs` 读取 `binaries/ielts-agent-runtime-{target}.sha256` 注入 `IELTS_AGENT_RUNTIME_BUILD_ID`，`RuntimeManager::start` 先 `verify_sidecar_hash()` 比对可执行文件 SHA-256，握手再校验 `buildId`，三方一致才视为可信。

## Packaging

`tauri.conf.json` 的 `bundle.externalBin` 已固定为 `["binaries/ielts-agent-runtime"]`；`tauri-plugin-shell = "2"` 注册于 `lib.rs`，`RuntimeManager` 被 `.manage(...)`（`lib.rs:54`）并在 `RunEvent::Exit` 时 `shutdown()`（`lib.rs:253-259`）。sidecar 通过 `app.shell().sidecar()` 以 `env_clear()` + 最小环境（`SystemRoot`/`WINDIR`/`TEMP`/`TMP` + `IELTS_AGENT_BUILD_ID`）启动。冻结产物已存在：`binaries/ielts-agent-runtime-x86_64-pc-windows-msvc.exe`（12,129,853 bytes）+ `.sha256` 清单，依赖锁 `requirements.lock` / `requirements-build.lock`（PyInstaller 冻结）。smoke gate `smoke_agent_runtime_sidecar.py` 实测冷启动 ~894ms、idle RSS ~8.9MB、解包 ~12.1MB，均在阈值内。

## Lifecycle：按需懒启动（有意为之）

sidecar 采用懒启动：`setup()`（`lib.rs:199-248`）只 `.manage()` RuntimeManager，不调用 `runtime.start()`；首次 `memory_generate_candidates`（`reserve_generation` → `start`）才 spawn 进程。这是任务书 1.3「Python sidecar 按需启动，普通练习路径不需要常驻 Python 进程」的直接实现，不是遗漏。若未来 M5 检索侧需要更频繁复用，可在 `setup()` 中 `tauri::async_runtime::spawn(runtime.start(&app))` 预热；当前不做开机预热，避免为不消费 Python 的练习/写作路径付出 RSS 与冷启动成本。

## Rollback and metrics

该 slice 已接入 shipping bundle，但 Rust-only 回退仍在：sidecar 缺失或 hash 不匹配时 `memory_generate_candidates` 返回 `memory.runtime_unavailable`（retryable），不写任何 canonical 数据。回滚方式为删除 sidecar 源/产物并关闭 `memory-core-v1` feature；不产生 SQLite migration 或用户数据变更。`RuntimeMetrics`（starts/crashes/unavailable/forced_shutdowns）与 `RuntimeStatus` 已由 `cognitive_runtime_status`/`cognitive_runtime_health` 命令暴露。
