# M8 Weekly Dream + Memory Consolidation Plan

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M8 章（行 8396-8666）+ 伪代码 §23.16（Weekly Dream Validator）/§23.17（Consolidation Apply）完成 Weekly Dream、Cross-scope Pattern 与 Memory Consolidation。Python orchestration / Rust promotion gate。从分散低层 observation/memory 发现跨题型/跨文章/跨时间的可证伪学习模式，宁可 0 pattern 不要错 pattern。不扩展到 M9。

## Baseline (M0-M7 已完成且门禁 27/27)

- M3 Memory：`memory_items`（status: candidate/pending_review/active/superseded/archived/...）、`memory_mutations`、`memory_candidates`、`memory_evidence`、`promote_memory_candidate`（含 supersede：status='superseded'+supersedes_id）。
- M7 Daily Dream：`dream_runs`/`dream_candidates`（pending proposal）、`background_jobs`、`journal.build_daily`/`dream.run_daily` reverse-RPC。
- M6 Coach：coach feedback/re-ask/strategy/outcome。
- migration 当前到 0018；M8 用 `0019_memory_consolidation_v1.sql`。

## Slices

- [x] **Slice 1 (Rust, Agent A)** — migration 0019 + pattern validator + consolidation apply + stale archive + feedback backend
  - `0019_memory_consolidation_v1.sql`：`memory_relations`（source→target relation: supports_consolidation/supersedes/contradicts，保留 lineage，可 reverse）、`memory_feedback`（memory_id + feedback_kind: accurate/inaccurate/partially_accurate/outdated/not_about_me/acknowledged，stable memory_id）、`memory_capacity_state`（per-kind archive policy state）
  - M8-02：validator 从 DB 加载 supports（不信任 LLM 返回的 index；LLM 返回 supportingMemoryIds，Rust 用 stable ID 重验）
  - M8-03/M8-04：pattern validator（§23.16）：require_min_supports（默认 3）、require_distinct_assets（默认 2）、require_distinct_scopes_if_cross_cutting（默认 2）、require_no_predicted_only_support、require_not_superseded、require_statement_length、require_falsifiable_shape。config 化阈值。
  - M8-06 consolidation apply（§23.17）：不物理删除；old memory status=superseded + relation=SupportsConsolidation；保留 statement/mutation history/可 reverse
  - M8-07 improvement/regression propagation：supports improve → pattern confidence decay；all supports refuted → pattern archive/improved（按 stable ID，不文本匹配）
  - M8-08 stale archive per-kind policy（one-off behavior fast / learning weakness medium / stable preference slow / explicit preference never auto / user goal validity-driven）；归档不删除
  - M8-09 user feedback backend：inaccurate 是强 contradiction 但不删 learning facts
  - M8-10 predicted hypothesis 禁止自动 promotion（必须有 observed support）
  - M8-05 pattern 类型 CHECK：cross_skill_strategy/metacognitive_pattern/behavior_pattern/stable_learning_preference/recurrent_language_pattern；禁止 medical/personality/intelligence/mental-health
  - 暴露 reverse-RPC `dream.run_weekly`（version "1"）+ Tauri 命令
- [x] **Slice 2 (Python, Agent B)** — Weekly Dream orchestration (干净室，不碰 Rust)
  - `agent-runtime-python/src/ielts_agent/dream/weekly.py`：cross-scope pattern discovery。给 LLM stable memory IDs + summary（M8-02），不传 index。模型返回 statement+supportingMemoryIds+confidenceProposal+patternKind。Rust validator 重验。
  - M8-01 四条 pattern gate（R2 clean-room from TechSpar memory.py:1590-1705）：跨≥2 独立 scope、抽象层次高于原 observation、有新价值、可证伪。宁可 0 pattern。
  - no-LLM path（仍产 0 pattern success，不抛 fatal）；fail-closed。
  - 通过 host_bridge.invoke("dream.run_weekly") 提交 candidate patterns；Rust 是 promotion gate。
- [x] **Slice 3 (Wave 2)** — Tauri commands + 确定性测试 + ADR-M8 + stage gate report

## File ownership

- Agent A 独占：`crates/ielts-db/migrations/0019_*.sql`(NEW)、`crates/ielts-{domain,db,application}/src/consolidation.rs`(NEW)、相关 lib.rs pub-mod 追加、`src-tauri/src/cognitive_runtime.rs`(EDIT reverse-RPC dream.run_weekly)、`src-tauri/src/app/application_store.rs`(最小追加 impl)、tests。
- Agent B 独占：`agent-runtime-python/src/ielts_agent/dream/weekly.py`(NEW)、`agent-runtime-python/tests/test_weekly_*.py`(NEW)。**不编辑** host_bridge/protocol/runtime/memory_*/retrieval/coach/daily_dream。
- Slice 3 独占：Tauri commands + 确定性测试 + ADR-M8 + stage gate。

## Guardrails

- 宁可 0 pattern，不要错 pattern（M8-01）。
- stable ID validation（M8-02）：Rust 从 DB 重验 LLM 返回的 supportingMemoryIds，不信任 index。
- M8-03 保守阈值（min_supports=3/min_new_evidence=3/min_distinct_assets=2/min_distinct_scopes=2/cooldown=5-7d）；config 化。
- M8-06 不物理删除被整合 memory；保留 lineage + 可 reverse。
- M8-10 predicted 禁止自动 promotion。
- M8-05 禁止 medical/personality/intelligence/mental-health pattern。
- Rust 拥有 promotion gate；Python 拥有 orchestration。
- 每个 slice 完成后 `run_static_suite.py` 保持 27/27。
- Linus 风格：数据结构优先、无特殊 case、≤3 层缩进、不破坏 userspace。
