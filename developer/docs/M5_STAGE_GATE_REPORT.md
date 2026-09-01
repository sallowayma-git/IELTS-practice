# M5 Stage Gate Report

日期：2026-08-15  
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M5 章（行 7521-7872）

## M5 交付结论

M5 Python-first Retrieval/RAG + Context Planning + Invocation Trace 阶段契约验证完成：

- **M5-01 Corpus Export Contract**（Rust Authority）：`retrieval.corpus_manifest` / `retrieval.export_chunks` / `retrieval.fetch_chunks` 反向 RPC；bounded + authorized；chunk identity 由 canonical source identity + deterministic chunking version 形成。
- **M5-02 Python Retrieval Index v1**：`retrieval_v1.sqlite` derived index（index_meta / chunks / fts_chunks / embeddings / sync_runs）；crash-safe delete+rebuild；`source_content_hash` 变化即 invalidate。
- **M5-03 Retrieval Pipeline v1**：exact lookup → scope filter → lexical FTS → RRF fusion → time-decay → diversity → ContextPlan。
- **M5-04 Model Gateway Embedding Capability**（Slice 4）：`model.embed.batch` 反向 RPC 立契约；`LanguageModel::embed` 默认返回 `embedding_not_supported`；`AiRuntime` 不 override；Python `embed_batch` 真正调用 host gateway 并 fail-closed。
- **M5-05 Query Rewrite / Fusion / Rerank**：`rewrite_query` + `reciprocal_rank_fusion` + `apply_time_decay` + `apply_diversity` + 可选 `rerank_candidates`（默认 off）。
- **M5-07 Typed Context Plan**：`ContextPlan` 只 emit stable IDs + inclusion reasons，绝不 emit prompt text。
- **M5-08 Rust Context Materializer / Fail-closed Gate**：九步 materialization（schema 验证 → ID 存在 → sensitivity re-auth → canonical re-fetch → Soul 注入 → token ceiling → hash → snapshot 持久化）。
- **M5-10 Invocation/Retrieval Trace**：`0016_context_retrieval_trace.sql` 含 `llm_invocations`（kind ∈ completion/embedding）/ `agent_context_snapshots` / `agent_context_items` / `retrieval_runs` / `retrieval_index_registry`。
- **M5-11 Retrieval Evaluation Gate**（Slice 4）：`developer/tests/retrieval_eval/` 9 条 frozen query + 20 chunk 合成语料；Recall@k / MRR / source hit rate / unsupported citation rate / p50/p95 latency / index size 指标。

## M5 直接验证

| 命令 | 结果 |
|---|---|
| `cargo check -p ielts-domain --locked --offline` | pass |
| `cargo check -p ielts-application --locked --offline` | pass |
| `cargo check -p ielts-practice-tauri --locked --offline` | pass（0 error，无 warning） |
| `cargo test -p ielts-domain --locked --offline` | 17 passed（含 5 新 embedding 契约测试） |
| `cargo test -p ielts-application --test context_materialization --locked --offline` | 7/7 passed（不回归） |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` | 4/4 passed（不回归） |
| `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` | 52 passed（47 baseline + 5 新 `test_embeddings.py`） |
| `python developer/tests/retrieval_eval/run_retrieval_eval.py` | PASS — assertions met；report 写入 `reports/m5_eval_report.json` |
| `python developer/tests/ci/check_m3_contracts.py` | pass |
| `python developer/tests/ci/check_m4_contracts.py` | pass |
| `python developer/tests/ci/run_static_suite.py` | 27/27 pass（不回归） |

### Eval gate 指标（合成语料基线，embeddings off）

| 指标 | 值 |
|---|---|
| Recall@k Mean | 1.0 |
| MRR Mean | 0.7222 |
| Source Hit Rate Mean | 0.8889 |
| Unsupported Citation Rate | 0.0（目标 = 0 达成） |
| Private/Restricted Leaks | 0（materializer gate 模拟 + 断言） |
| p50 Latency (ms) | 0（合成语料 <1ms） |
| p95 Latency (ms) | 0.0 |
| Index Size | 20 chunks |
| Query Count | 9 |
| Embedding Metrics | `not_enabled` |
| Deterministic | true（同 config 两次跑结果一致） |

Frozen query 覆盖任务书行 7817-7828 全部 9 类：exact question/attempt lookup、skill-specific memory recall、cross-session Coach evidence、writing criterion history、lexical synonym query、same-term distractor、private/restricted exclusion、stale/superseded memory exclusion、anti-repeat/diversity。

## 仓库级门禁状态

`run_static_suite.py` 27/27 pass。Tauri shipping contract、Rust workspace check、cognitive runtime contract、memory proposal contract、data-truth regressions、M4 learner model、AI config security、reading data integrity、Python cognitive protocol、M3/M4 contract boundary 全部通过。

## 诚实限制

1. **Embedding provider 未接**：`AiRuntime` 保留默认 `embedding_not_supported`。`model.embed.batch` 契约就绪但实际 provider embedding 端点待 M5-11 eval 证明价值后接。
2. **Eval 是合成语料基线**：20 chunk golden corpus 不依赖真实 provider；证明 lexical+RRF soundness，不证明 semantic retrieval 不必要。`forbiddenIdViolations=1`（stale strategy chunk 通过 lexical 浮现但被 time-decay 降权）是 lexical 的已知局限，正是 embedding/rerank 可能补足的场景。
3. **Cosine 路径未实测向量**：`planner._embedding_cosine` 读 `embeddings` 表 float32 BLOB，但表在 provider 未接时为空；路径可用但未被 eval 触发。
4. **Rerank 默认 off**：与 embedding 同样待 eval 证明价值。

## 遗留项

- 接入真实 embedding provider（OpenAI-compatible embedding endpoint）后重跑 eval，对比 lexical vs embedding 指标，决定是否 enable embeddings by default。
- 若 eval 证明 rerank 有净收益，`RetrievalRunConfig.enable_rerank` opt-in。
- `llm_invocations` trace 写入路径（kind=embedding）在 provider 接入后由 `invoke_embed` 落地。

## DoD 核对（任务书行 7863-7872）

- [x] Canonical corpus remains Rust-owned（`CorpusExportStore` / `CorpusExportService`）
- [x] Python owns all retrieval index/search/ranking implementation
- [x] Python can delete/rebuild its index without data loss（derived disposable cache）
- [x] Rust never implements a parallel RAG backend
- [x] Every selected context item has stable source lineage（chunk_id = activity:asset_id:v{N}:{i}）
- [x] Final ContextPack is authorized/materialized by Rust（九步 fail-closed gate）

## Round 3 Post-Audit Addendum（2026-08-31）

本报告只证明 Python retrieval、Rust materialization、trace schema 和合成 eval 合同通过；embedding provider、真实向量评测、rerank 默认启用和生产调用链仍受“诚实限制”约束。Context Chain 是否端到端运行不能由本报告的合成数据结果推断，详见 [Round 3 审计报告](PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md)。
