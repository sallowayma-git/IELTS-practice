# ADR-M5: Retrieval / Context Materialization

日期：2026-08-15  
状态：Accepted  
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M5 章

## Context

M5 从零建立 Python-first Retrieval/RAG 引擎，并把旧的 Context Compiler 拆成两个责任层：

- **Python Context Planner**：query rewrite + candidate retrieval + ranking + section allocation + ContextPlan
- **Rust Context Materializer / Policy Gate**：authorization re-check + canonical chunk fetch + required policy sections + hard token ceiling + final ContextPack hash + trace persistence

目标是让复杂 retrieval/context cognition 只在 Python 写一份；Rust 只做它最擅长、也必须可信的 authority boundary。M5 同时把 embedding 能力立契约但默认不启用——任务书明确禁止「因为 RAG 三个字就默认向量化所有内容」。

## Decisions

### 1. Python-first retrieval；Rust 不实现并行 RAG backend

Python 拥有所有 retrieval index/search/ranking 实现（lexical FTS mirror + RRF + diversity + 可选 rerank）。Rust 永不实现并行 RAG backend。这避免了 TechSpa 的 storage 设计债务（mutable profile.json truth、session_id provenance loss、predicted mixed with observed），同时把复杂 cognition 收敛到一份代码。

Python 的 derived index（`<AppData>/cognition/retrieval/retrieval_v1.sqlite`）是 disposable cache：crash-safe delete+rebuild，不保存 credential，`source_content_hash` 变化即 invalidate chunk/vector。canonical truth 永远在 Rust SQLite。

### 2. Rust Context Materializer 是 fail-closed authority gate

Rust 收到 `ContextPlan` 后执行九步：验证 schema/planner version → 验证 stable IDs 存在 → 重新检查 sensitivity/scope/authorization → 从 canonical source 重取正文 → 注入不可删的 Soul/policy section → enforce hard token ceiling → 生成 `ContextManifest` + `rendered_hash` → 写 `agent_context_snapshots/items` → 才允许 `model.invoke`。

Python 无法通过在 `ContextPlan` 塞任意文本绕过 source lineage——它只 propose IDs，Rust materialize。任何失败（unknown ID、unauthorized sensitivity、over-budget）返回 error 且不写任何行。

### 3. Corpus export 契约：bounded + authorized

Rust 提供 `retrieval.corpus_manifest` / `retrieval.export_chunks(cursor, limit)` / `retrieval.fetch_chunks(ids)`。Python 只能缓存 derived copies；最终发给模型前 Rust 按 ranked IDs 再取/校验 canonical text。Chunk identity 由 canonical source identity + deterministic chunking version 形成，不用 Python 随机 UUID。

`context.materialize` 反向 RPC 让 Python 提交 `ContextPlan`，Rust 负责九步 materialization gate 并返回 audited `ContextPack`。

### 4. Embedding 默认 off；契约先行

`model.embed.batch` 反向 RPC 已在 Slice 4 立契约：Rust `LanguageModel` trait 有默认 `embed` 方法返回 `embedding_not_supported`（非 retryable）；`AiRuntime` 不 override（当前 OpenAI-compatible provider 未必有 embedding 端点，且任务书禁止默认向量化）。`cognitive_runtime.rs` 的新 `invoke_embed` 分支解析 `EmbeddingRequest` → `load_runtime` → `runtime.embed(request)` → 透传结果。

Python `embed_batch` 真正调用 `host_bridge.invoke("model.embed.batch", ...)`，fail-closed：host 报错（含默认 `embedding_not_supported`）即 raise，不静默回退到 lexical（那是 planner 层的决策）。

**只有 M5-11 golden set 证明 semantic embedding/reranker 有净收益时才启用更复杂阶段。** 当前 eval 跑 lexical+RRF 基线，embedding 相关指标标 `not_enabled`。

### 5. TechSpa clean-room 边界

从 TechSpa `vector_memory.py` / `memory.py` / `routers/settings.py` 借鉴思路（half-life time-decay、invalidate-on-model-change），但不复制其 storage 设计：

| TechSpa 局限 | IELTS 修正 |
|---|---|
| profile.json truth | canonical Rust truth |
| session_id provenance loss | mandatory source/session/chunk IDs |
| vector support by mutable text | stable relation IDs |
| predicted mixed with observed | source trust separation (`SourceKind`) |
| process-local task status | durable Rust job state |

TechSpa 的 `llm_update_profile()` 调 `index_session_memory()` 丢失 session provenance 的做法未迁移。

## Current Limitations

- **Embedding provider 未接**：`AiRuntime` 保留默认 `embedding_not_supported`。实际 provider embedding 端点待 M5-11 eval 证明价值后接（需 provider 配置支持 embedding model）。
- **Eval 是合成语料基线**：`developer/tests/retrieval_eval/golden_corpus.json`（20 chunks）不依赖真实 provider。证明了 lexical+RRF pipeline 的 soundness，不证明 semantic retrieval 不必要。
- **Cosine 路径未实测向量**：`planner._embedding_cosine` 读 `embeddings` 表 float32 BLOB，但表在 provider 未接时为空；路径可用但未被 eval 触发。
- **Rerank 默认 off**：`RetrievalRunConfig.enable_rerank=False`，与 embedding 同样待 eval 证明价值。

## Consequences

- Python 可以 delete/rebuild 它的 index 而不丢数据（canonical truth 在 Rust）。
- 每个 selected context item 都有 stable source lineage（chunk_id = activity:asset_id:v{N}:{i}）。
- Final ContextPack 由 Rust 授权/materialize/trace。
- 添加 embedding 不需要改 Rust materializer——只改 `AiRuntime::embed` override + Python planner opt-in。
- `llm_invocations` 表（migration 0016）同时容纳 `completion` 和 `embedding` kind，trace 统一。
