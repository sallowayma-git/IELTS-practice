# M5 Retrieval + Context Planning Completion Plan

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M5 章（line 7521-7840）完成 M5 剩余切片 Slice 2/3/4，不扩展到 M6+。

## Baseline (working tree, uncommitted but gate-green)

- M5 Slice 1 已完成：`0016_context_retrieval_trace.sql`、`crates/ielts-db/src/corpus.rs`、`crates/ielts-application/src/corpus.rs`、`crates/ielts-domain/src/corpus.rs`、`src-tauri/src/commands/corpus.rs`、`context-compiler-v1` feature (Tauri default on)、`corpus_export.rs` 4/4。
- `agent-runtime-python/` sidecar：framed JSON-RPC + 握手 + reverse RPC `model.invoke`/`tool.invoke` 已通；`host_bridge.py` 提供 generic `invoke(method, params)`。
- 门禁：`run_static_suite.py` 27/27；`suite_practice_flow.py` 16/16。

## Slices

- [x] **Slice 2 (Rust, Agent A)** — Rust Context Materializer + retrieval/context reverse-RPC gateway
- [x] **Slice 3 (Python, Agent B)** — Python retrieval engine (干净室，不碰 Rust 文件)
- [x] **Slice 4 (Wave 2, after Slice 2/3)** — `model.embed.batch` (Rust AiRuntime + reverse RPC) + Python embeddings 接线 + M5-11 frozen eval query set + ADR-M5 + M5 stage gate report

## File ownership (avoid concurrent-edit conflicts)

- Agent A 独占：`crates/ielts-{domain,db,application}/src/context.rs`(NEW)、`src-tauri/src/commands/context.rs`(NEW)、`src-tauri/src/cognitive_runtime.rs`(EDIT)、commands/mod.rs + lib.rs + 三个 lib.rs pub-mod glue、`schemas/context_plan/`(NEW)、相关 tests。
- Agent B 独占：`agent-runtime-python/src/ielts_agent/retrieval/`(NEW dir)、`agent-runtime-python/tests/test_retrieval_*.py`(NEW)。**不编辑** host_bridge.py/protocol.py/runtime.py（用现有 generic invoke）。
- Slice 4 独占：`src-tauri/src/ai/runtime.rs`(embed)、`cognitive_runtime.rs`(embed reverse RPC，待 Slice 2 完成后无冲突)、`agent-runtime-python/src/ielts_agent/retrieval/embeddings.py`(待 Slice 3 完成后无冲突)、`schemas/embedding/`、ADR-M5、eval gate、stage gate report。

## Guardrails

- Rust owns SQLite/canonical truth/authorization/materialization/trace；Python 只拥有 derived disposable index。
- Python 不直接打开 canonical IELTS SQLite；不持有 provider secret；embedding 走 host gateway。
- 不在 base installer 引入 torch/transformers/sentence-transformers；NumPy 仅当 sidecar gate 通过。
- 不重写已冻结 M2/M2.1/M3/M4 代码；只追加 M5 模块。
- 每个 slice 完成后重跑 `run_static_suite.py` + `suite_practice_flow.py` 必须保持 27/27 + 16/16。
- 严格 Linus 风格：数据结构优先、无特殊 case 分支、≤3 层缩进、不破坏 userspace。
