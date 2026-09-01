# Findings

## 2026-08-15 M5 并发开工边界

- `cognitive_runtime.rs` 当前 reverse RPC 只 handle `tool.invoke`/`model.invoke`（line 804-806 match）。Slice 2 需在此 match 追加 `retrieval.*` 与 `context.materialize` 分支，路由到 CorpusExportService / 新 ContextMaterializerService。
- `host_bridge.py:24` 已有 generic `invoke(method, params)` —— Python retrieval 模块可直接 `host.invoke("retrieval.export_chunks", {...})`，无需编辑 host_bridge.py，避免与潜在 Rust 侧并发冲突。
- 0016 已建 `agent_context_snapshots`/`agent_context_items`/`retrieval_index_registry`/`retrieval_runs`/`llm_invocations` —— Materializer 只写不改 schema。
- `context-compiler-v1` feature 已是 Tauri default on；Materializer 命令复用同一 feature。
- CorpusExportStore trait 已在 `crates/ielts-application/src/corpus.rs` 定义并由 ApplicationStore 实现 —— Materializer 复用其 `fetch_chunks` 做 canonical re-fetch。

## 2026-08-15 Slice 2 (Rust) Findings

- Agent A 子代理交付 domain `context.rs`（ContextPlan/ContextSection/ContextManifest/ContextPack DTO + serde camelCase + truncation_rank + estimate_tokens + rendered_hash）与 db `context.rs`（insert_context_snapshot/load_context_snapshot，只写 0016 表）。我接管后补齐 application/Tauri/schemas/tests。
- 新建 `crates/ielts-application/src/context.rs`：`ContextMaterializerService` + `ContextSnapshotStore` trait。九步 fail-closed：validate plan header → collect ranked IDs → fetch_chunks canonical re-fetch → 验证 missing_ids 为空 → per-section 物化（canonical.get 逐项 + is_authorized 重检 sensitivity）→ 注入 Soul/policy（include_str! context_soul_policy.txt，永不被 plan 删除）→ truncate_to_budget（SOUL/CURRENT_TASK 永不删）→ render_context 确定性渲染 + rendered_hash → insert_context_snapshot → 返回 ContextPack。
- application crate 无 chrono 依赖：用 `std::time::SystemTime` 写 `now_iso()`，避免新增重依赖（Linus 原则：数据结构优先，不为单字段加依赖）。db 层 `created_at` 仍用 chrono 高精度。
- is_authorized 语义：public/internal 全 scope 放行；restricted 仅 restricted/private scope；private 仅 private scope。Python 的 sensitivity 字段不被信任，从 canonical chunk 重读。
- 新建 `src-tauri/src/commands/context.rs`：`context_materialize` 命令（context-compiler-v1 feature），注册到 `lib.rs` invoke_handler。ApplicationStore 同时实现 `CorpusExportStore` + `ContextSnapshotStore`。
- `cognitive_runtime.rs` reverse-RPC：match 新增 4 个 method 分支（retrieval.corpus_manifest/export_chunks/fetch_chunks + context.materialize），委托给新 `invoke_retrieval_context(app, method, params)`。handshake `hostCapabilities` 动态注入 PROVIDED_HOST_CAPABILITIES（context-compiler-v1 下追加 4 条 v1）。握手校验从「exact equality」改为「subset」——Python 的 requiredHostCapabilities 必须是 Rust 提供能力的子集且版本匹配，retrieval/context 作为可选能力。
- schemas：`schemas/context_plan/plan.schema.json` + fixture `materialize.json`（camelCase，schemaVersion=1，plannerVersion=m5-retrieval-v1，固定 9 个 section enum）。
- **Capability 版本（供 Python 对齐）**：`retrieval.corpus_manifest=1`、`retrieval.export_chunks=1`、`retrieval.fetch_chunks=1`、`context.materialize=1`。Python `types.py` 已用相同占位，无需改动。
- Rust 错误路由：`invoke_retrieval_context` 用 `serialize_result` helper 把 `Result<T, ApplicationError>` → `Result<Value, String>` → `RuntimeHostError::InvalidResponse`，单一错误通道，无 `?` 类型穿透问题。
- 测试：`crates/ielts-application/tests/context_materialization.rs` 7/7（valid+Soul 注入、unknown ID fail-closed、restricted 在 internal scope 被拒、restricted 在 restricted scope 通过、planner 版本不匹配被拒、rendered_hash 稳定、token ceiling fail-closed）。cognitive_runtime 4/4 handshake/framing 测试仍全过。

## 2026-08-15 Slice 3 (Python) Findings

- Agent B 子代理两次停滞（停在 lexical.py 前），只交付 types/corpus_sync/index_store 三文件。我接管后补齐 lexical/fusion/rerank/planner/context_planner/embeddings + `__init__.py` + 4 个测试。
- lexical.py：弃用 FTS5 BM25（Python builtin sqlite 不保证编译 FTS5，且 `bm25()`/`MATCH` 需虚拟表），改用 portable `LIKE` over `fts_chunks` 表 + Python 端命中计数排序。score = hit_count/term_count 归一化，inclusion reason 含 rank+hits。
- fusion.py：RRF k=60；salience/time-decay 用 canonical `updated_at` 半衰期 30 天（借 TechSpa `_time_decay` 思想，但从 canonical truth 驱动，不从 mutable profile.json）；diversity 按 chunk_id 的 activity:asset group 限 max_per_source。
- rerank.py：默认 disabled；enabled 时经 `host_bridge.invoke("model.invoke")`，失败回退原序 + `rerank:fallback` reason，永不丢候选。不持有 provider secret。
- planner.py：M5-03 pipeline 顺序 exact→scope filter→lexical→embedding(skipped, Slice4)→RRF→time_decay→diversity→可选 rerank。默认全离线确定。
- context_planner.py：M5-05 rewrite + M5-07 ContextPlan 输出。budget ratios 修正为 sum=1.0（0.12/0.32/0.06/0.16/0.10/0.08/0.08/0.0/0.08）。SOUL_POLICY item_ids 留空给 Rust 注入。ranked IDs 按 section 优先级去重。计划只含 stable IDs + reasons，绝不含 prompt 文本。
- embeddings.py：占位骨架（Slice 4 才接 `model.embed.batch`）。`assert_signature_compatible`/`install_signature` 已实现签名校验 + 失效逻辑；`embed_batch` 显式 `NotImplementedError`，lexical+RRF 为默认直到 eval 证明需要向量。
- 派生 DB 路径策略：`<AppData>/cognition/retrieval/retrieval_v1.sqlite`，由 host 提供或运行时解析，**不硬编码 canonical DB 路径**。tables：index_meta/chunks/fts_chunks/embeddings/sync_runs。source_content_hash 变即 invalidate chunk+embedding。
- **期望 Rust 侧 capability 方法名/版本**（已与 Rust 对齐）：`retrieval.corpus_manifest=1`、`retrieval.export_chunks=1`、`retrieval.fetch_chunks=1`、`context.materialize=1`、`model.embed.batch=1`(Slice4)。
- 测试：`test_retrieval_types.py`、`test_corpus_sync.py`(fake host bridge)、`test_lexical_fusion.py`、`test_context_planner.py` 共 27 个新测试 + 20 个既有 memory/protocol = 47/47 全过。
- 静态门禁适配：`check_m3_contracts.py` 与 `test_protocol.py` 的 sqlite3 全源扫描已更新为「核心 runtime 禁 sqlite3/keyring/v2.db；retrieval 包允许 sqlite3 仅用于派生索引，但禁 keyring/v2.db/getpass」。M5-02 明确授权 Python 拥有派生 disposable 索引。

## 2026-08-15 Slice 4 Findings

- **M5-04 Rust embedding 契约**：新建 `crates/ielts-domain/src/embedding.rs`（`EmbeddingRequest`/`EmbeddingResponse`/`EmbeddingUsage`/`EmbeddingSignature` + `EMBEDDING_SCHEMA_VERSION=1`，serde camelCase + deny_unknown_fields）。注册到 domain `lib.rs`（追加 `pub mod embedding;` + `pub use embedding::*;`，不重排既有 mod）。
- **LanguageModel trait 默认 embed**：`crates/ielts-application/src/ports.rs` 的 `LanguageModel` trait 加 `async fn embed(&self, request: EmbeddingRequest) -> Result<EmbeddingResponse, ModelError>`，提供默认实现返回 `ModelError::new("embedding_not_supported: ...", false)`（非 retryable）。这样不强制所有实现者实现，符合 M5「embedding 默认不启用，eval 证明价值才上」。注意 `ModelError::new` 签名是 `(message, retryable)` 无 code 字段——code 编入 message。
- **AiRuntime 不 override embed**：`src-tauri/src/ai/runtime.rs` 保持默认 `embedding_not_supported`。当前 OpenAI-compatible provider 未必有 embedding 端点且任务书禁止默认向量化。注释写清「Slice 4 只立契约，实际 provider embedding 待 M5-11 eval 证明价值后接」。
- **cognitive_runtime reverse-RPC**：`PROVIDED_HOST_CAPABILITIES` 追加 `("model.embed.batch", "1")`（context-compiler-v1 feature 下）。dispatch match 新增 `Some("model.embed.batch")` 分支委托给新 `invoke_embed(app, params, request_budget)`。`invoke_embed` 解析 `EmbeddingRequest` → `validate_embed_request`（非空 + 数量/字节上限）→ `load_runtime(&db, &vault)` → `runtime.embed(request)` → `serialize_result` 透传。handshake hostCapabilities 已动态注入 PROVIDED_HOST_CAPABILITIES，无需额外改。
- **Python embeddings 接线**：`embeddings.py` 的 `embed_batch` 从 NotImplementedError 改为真正调用 `host_bridge.invoke("model.embed.batch", {"request": {"texts": [...]}})`。`_parse_embed_result` 校验 requestId/model/dimension/vectors，vector 长度必须等于 declared dimension。fail-closed：host 报错（含默认 `embedding_not_supported`）即 raise，不静默回退 lexical。签名校验 `assert_signature_compatible`/`install_signature` 保持 public 供 planner/index_store 层调用——`embed_batch` 不持有 IndexStore，签名 reconcile 是 caller 责任。
- **planner.py embedding 路径**：Step 4 从 `embedding_skipped_no_impl` 改为真正调 `embed_batch`（当 `enable_embeddings=True` 且 signature 存在且 bridge 可用时）。无 signature（provider 未接时常态）→ `embedding_skipped_no_signature`；host 报错 → `embedding_skipped_host_error`（fail-closed 降级到 lexical，但不伪造向量）。`_embedding_cosine` 读 `embeddings` 表 float32 BLOB + pure-Python cosine（表在 provider 未接时为空，返回 []）。`enable_embeddings` 仍默认 False——Slice 4 不改默认行为，只保证路径可用。
- **M5-11 Retrieval Eval Gate**：`developer/tests/retrieval_eval/`（在 developer/tests 下，符合 AGENTS.md QA/tooling 纪律）。`golden_corpus.json`（20 chunks，含 sensitivity 标记 public/internal/restricted/private）+ `frozen_queries.json`（9 条覆盖任务书行 7817-7828 全部类别）+ `run_retrieval_eval.py`。指标：Recall@k=1.0、MRR=0.7222、source hit=0.8889、unsupported citation=0（目标达成）、private/restricted leaks=0（materializer gate 模拟 + 断言）、deterministic=true。embedding 指标标 `not_enabled`。
- **Eval 限制诚实记录**：`forbiddenIdViolations=1`——stale strategy chunk 通过 lexical 浮现但被 time-decay 降权。这是 lexical 的已知局限，正是 embedding/rerank 可能补足的场景，不伪造 embedding 指标掩盖。
- **错误教训**：`CorpusChunk` pydantic 模型是 snake_case 字段（`populate_by_name=True` 但无 alias），golden_corpus.json 初版用 camelCase 导致 `model_validate` 失败——改为 snake_case。`ModelError::new` 签名是 `(message, retryable)` 而非 `(code, message, retryable)`，task 描述里的 `ModelError::new("embedding_not_supported", ..., false)` 不能字面照搬，code 编入 message。
- **测试新增**：`agent-runtime-python/tests/test_embeddings.py`（5 测试：invoke capability、reject empty、fail-closed on host error、dimension mismatch、missing vectors）。Python 47→52。Rust domain 6→17（含 5 新 embedding 契约测试）。cognitive_runtime 4/4 不回归，context_materialization 7/7 不回归。
