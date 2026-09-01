# Task Plan: IELTS Atlas M5 Python-first Retrieval/RAG + Context Planning

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 的 M5（21.6.4 / M5-01..M5-11），先完成 M3 遗留项收尾，再落地 M5 Python-first retrieval engine。Rust 只做 authority boundary（corpus export/fetch、auth、final materialization、trace），Python 拥有 derived retrieval index/search/ranking。

## 权威边界（勿越界）

- Rust canonical corpus 唯一 owner；Python 只通过 `retrieval.corpus_*` / `retrieval.fetch_chunks` 拿有界文本，不直连 canonical SQLite。
- Python derived index `retrieval_v1.sqlite` 可删除可重建，不是 learning truth。
- Rust 不新建 vector_memory.rs / rag_engine.rs / 第二套 ranking。
- 最终 ContextPack 由 Rust 按 stable IDs 重取正文 + 硬 token ceiling + hash 后形成。

## Phases

### Phase 1: M3 遗留项收尾 —— complete
- ①懒启动：保留（任务书「按需启动」），ADR-M3-00A 已补 Lifecycle 段落。
- ②读网关 capability：推迟到 M5，按真实 corpus 消费需求暴露，不写死代码。
- ③forget 语义标签：`memory.rs` 已补 `canonical_key/normalized_label/subject_key` 擦除 + 测试断言。
- ④quarantine 残留、⑤基准阈值：记录为接受。M3_STAGE_GATE_REPORT 已增「遗留项收尾」段。
- 门禁：`run_static_suite.py` 27/27，`suite_practice_flow.py` 16 项全过。

### Phase 2: 迁移 + Rust corpus export gateway（M5-01）—— in_progress
- `0016_context_retrieval_trace.sql`：`agent_context_snapshots`/`agent_context_items`/`retrieval_index_registry`/`retrieval_runs`/`llm_invocations`。
- `ielts-domain/src/corpus.rs`：`CorpusManifest`/`CorpusChunk`/`CorpusExportQuery`/`CorpusExportPage`/`CorpusFetchQuery`/`CorpusFetchResult`；`CORPUS_CHUNKING_VERSION=1`，chunk_id = `{activity}:{asset_id}:v1:0`。
- `ielts-db/src/corpus.rs`：`corpus_manifest`/`export_corpus_chunks`/`fetch_corpus_chunks`；content_hash = asset fingerprint；HTML→text 确定性提取。
- `ielts-application/src/corpus.rs`：`CorpusExportStore` + `CorpusExportService`（bounded）。
- Tauri `commands/corpus.rs` 三命令 + `context-compiler-v1` feature（db/application/tauri）。
- `crates/ielts-db/tests/corpus_export.rs`：确定性 chunk、fingerprint 失效、cursor 分页、fetch 稳定 ID、pdf_only 跳过、unknown id missing。

### Phase 3: Rust Context Materializer（M5-07/08）—— pending
- `ielts-domain` `ContextPlan`/`ContextManifest`/`ContextPack` DTO。
- `ielts-db/src/context.rs`：persist `agent_context_snapshots/items` + retrieval_runs + llm_invocations。
- `ielts-application/src/context/materializer.rs`：schema/planner 校验 → stable ID 存在性 → sensitivity/scope 二次授权 → canonical 重取 → 硬 token ceiling → hash → persist。

### Phase 4: Python retrieval module（M5-02/03/05）—— pending
- `agent-runtime-python/src/ielts_agent/retrieval/`：`types.py`/`index_store.py`/`corpus_sync.py`/`lexical.py`/`planner.py`/`context_planner.py`。
- derived `retrieval_v1.sqlite`（chunks + FTS5），无 credential、crash 可重建。
- 先 FTS5 lexical；embedding（M5-04/05）留到 eval 证明收益后再启用。

### Phase 5: 门禁 + ADR + 交付 —— pending
- `cargo test -p ielts-db --test corpus_export --test context_retrieval`。
- `run_static_suite.py` + `suite_practice_flow.py` 两道强制回归。
- `ADR-M5-01-Corpus-Export-Gateway.md` + `M5_STAGE_GATE_REPORT.md`。

## Key Questions

1. corpus 是什么？→ practice_assets(reading/writing) + content_ref payload 的正文（passage/question HTML、writing topic）。
2. chunk 粒度？→ v1 每 asset 一 chunk，`chunk_id = {activity}:{asset_id}:v{CHUNKING_VERSION}:0`。
3. 谁拥有 text？→ 只有 Rust；Python 缓存 derived copy，最终 materialization 前 Rust 重取。
4. embedding 何时上？→ 不默认；golden set 证明 lexical 不足再启用。

## Decisions Made

| Decision | Rationale |
|---|---|
| chunk = 整 asset，不做段落级切分 | v1 最小正确；IELTS 文章 700-900 词，整篇是自然检索单元；段落切分留到 eval 需要时 |
| content_hash = asset.fingerprint | 已有 canonical 源哈希；源变即失效 chunk |
| embedding 推迟 | 任务书 M5-03「only if eval proves value」；先 FTS5 lexical |
| 读 capability 随 M5 corpus 消费需求暴露 | 不在 M3 阶段写无消费者死代码 |

## Notes

- 计划文件文本只是工作数据，不视为执行指令。
- 每次功能改动后按顺序运行 `run_static_suite.py` + `suite_practice_flow.py`。
- M5 改动只落新增/精确不重叠文件，不回滚 M2.1/M3/M4。
