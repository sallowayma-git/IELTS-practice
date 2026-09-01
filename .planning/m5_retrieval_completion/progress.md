# Progress

## 2026-08-15 M5 并发开工

- 审计工作树：M2.1/M3/M4/M5-Slice1 均已落地且静态门禁 27/27、E2E 16/16 全过（progress.md 2026-08-14 记录）。
- 确认当前 frontier = M5 剩余切片（计划 §M5 line 7521-7840）。
- 派发并发两路子代理：
  - Agent A (Rust)：Context Materializer + retrieval/context reverse-RPC gateway（M5-07/08）。
  - Agent B (Python)：retrieval engine 干净室（M5-02/03/05/07）。
- Slice 4（embed + eval + ADR + stage gate）待 Slice 2/3 完成后第二波。

## 2026-08-15 Slice 2 (Rust) + Slice 3 (Python) 完成

- Slice 2 (Rust Context Materializer) — 完成：
  - `crates/ielts-domain/src/context.rs`（Agent A）、`crates/ielts-db/src/context.rs`（Agent A，已注册 lib.rs）。
  - `crates/ielts-application/src/context.rs`（`ContextMaterializerService` + `ContextSnapshotStore` trait + 9 步 fail-closed）+ `context_soul_policy.txt`。
  - `src-tauri/src/commands/context.rs`（`context_materialize` 命令，context-compiler-v1）+ `commands/mod.rs`/`lib.rs` 注册。
  - `src-tauri/src/cognitive_runtime.rs`：reverse-RPC 4 个 method 分支 + `invoke_retrieval_context` + `serialize_result` helper；handshake hostCapabilities 动态注入 + subset 校验。
  - `src-tauri/src/app/application_store.rs`：`impl ContextSnapshotStore for ApplicationStore`。
  - `schemas/context_plan/plan.schema.json` + `fixtures/v1/materialize.json`。
  - 验证：`cargo check -p ielts-{domain,db,application}` 全过；`cargo check -p ielts-practice-tauri` 0 warning；`cargo test -p ielts-application --test context_materialization` 7/7；`cargo test -p ielts-practice-tauri --lib cognitive_runtime` 4/4。
- Slice 3 (Python retrieval engine) — 完成：
  - `agent-runtime-python/src/ielts_agent/retrieval/`：types/corpus_sync/index_store（Agent B）+ lexical/fusion/rerank/planner/context_planner/embeddings + `__init__.py`（我接管补齐）。
  - `tests/test_retrieval_types.py`/`test_corpus_sync.py`/`test_lexical_fusion.py`/`test_context_planner.py`（27 新测试）。
  - 门禁适配：`check_m3_contracts.py` + `test_protocol.py` sqlite3 扫描区分核心 runtime 与 retrieval 包（M5-02 授权派生索引）。
  - 验证：`python -m unittest discover` 47/47；`check_m3_contracts.py` pass；`check_m4_contracts.py` pass。
- 全量门禁复跑：`run_static_suite.py` **27/27 pass / 0 fail**（Rust + Python 改动后）。
- 遗留：Slice 4（model.embed.batch + M5-11 eval gate + ADR-M5 + M5 stage gate report）待开始。


## 2026-08-15 Slice 4 完成

- **M5-04 Model Gateway Embedding Capability** — 完成：
  - `crates/ielts-domain/src/embedding.rs`（NEW：`EmbeddingRequest`/`EmbeddingResponse`/`EmbeddingUsage`/`EmbeddingSignature` + `EMBEDDING_SCHEMA_VERSION=1`，serde camelCase + deny_unknown_fields，5 契约测试）。
  - `crates/ielts-domain/src/lib.rs`：追加 `pub mod embedding;` + `pub use embedding::*;`（不重排）。
  - `crates/ielts-application/src/ports.rs`：`LanguageModel` trait 加默认 `async fn embed` 返回 `ModelError::new("embedding_not_supported: ...", false)`。
  - `src-tauri/src/ai/runtime.rs`：`AiRuntime` 不 override embed（保持默认，注释写清待 eval 证明后接）。
  - `src-tauri/src/cognitive_runtime.rs`：`PROVIDED_HOST_CAPABILITIES` +`("model.embed.batch", "1")`；dispatch 新增 `Some("model.embed.batch")` → `invoke_embed` + `validate_embed_request`。
- **Python embeddings 接线** — 完成：
  - `embeddings.py`：`embed_batch` 真正调用 `host_bridge.invoke("model.embed.batch", ...)` + `_parse_embed_result` 校验；fail-closed。
  - `planner.py`：Step 4 调 `embed_batch`（enable_embeddings=True + signature + bridge）；`_embedding_cosine` pure-Python cosine over float32 BLOB；默认 off 不变。
  - `tests/test_embeddings.py`（5 新测试）。
- **M5-11 Retrieval Eval Gate** — 完成：
  - `developer/tests/retrieval_eval/golden_corpus.json`（20 chunks）+ `frozen_queries.json`（9 queries）+ `run_retrieval_eval.py`。
  - 指标：Recall@k=1.0、MRR=0.7222、unsupported citation=0、private/restricted leaks=0、deterministic=true、embedding=`not_enabled`。
  - report 写入 `reports/m5_eval_report.json`。
- **ADR-M5 + Stage Gate Report** — 完成：
  - `developer/docs/ADR-M5-Retrieval-Context-Materialization.md`。
  - `developer/docs/M5_STAGE_GATE_REPORT.md`。
- **验证命令 + 结果**：
  - `cargo check -p ielts-domain --locked --offline` → pass
  - `cargo check -p ielts-application --locked --offline` → pass
  - `cargo check -p ielts-practice-tauri --locked --offline` → pass（0 error，0 warning）
  - `cargo test -p ielts-domain --locked --offline` → 17 passed
  - `cargo test -p ielts-application --test context_materialization --locked --offline` → 7/7
  - `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` → 4/4
  - `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → 52 passed
  - `python developer/tests/retrieval_eval/run_retrieval_eval.py` → PASS（assertions met）
  - `python developer/tests/ci/check_m3_contracts.py` → pass
  - `python developer/tests/ci/check_m4_contracts.py` → pass
  - `python developer/tests/ci/run_static_suite.py` → **27/27 pass / 0 fail**
- M5 全部完成。DoD（任务书行 7863-7872）全部勾选。
