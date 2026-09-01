# M7 Daily Journal + Daily Dream v1 Plan

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M7 章（行 8190-8393）+ 伪代码 §23.14/23.15 完成 Daily Journal + Daily Dream v1。在 M6 闭环成立后引入「做梦」：一天的 deterministic facts + candidate/memory changes + learner-state delta → versioned journal → bounded daily consolidation proposal。不扩展到 M8（Weekly Dream）。

## Baseline (M0-M6 已完成且门禁 27/27)

- M3 Memory：`persist_memory_candidate_batch`/`promote_memory_candidate`/`upsert_explicit_preference`/`memory_context_preview`/`forget_memory` 已落地。
- M4 Learner：`learner_state_snapshot`/`skill_review_needs_snapshot` + rebuild/verify。
- M2.1 Cognitive Read：`observation_snapshot`/`learning_events_by_ids`。
- M5 Context：`ContextMaterializerService` + `context.materialize`。
- M6 Coach：`coach_feedback`/`coach_reask_links`/`coach_strategy_assignments_v0`/`coach_outcome_links_v0`（0017）。
- migration 当前到 0017；M7 用 `0018_daily_journal_jobs.sql`。
- 无现有 background_jobs/journal/dream 表 —— M7 从零建。

## Slices

- [x] **Slice 1 (Rust, Agent A)** — migration 0018 + SQLite job worker + deterministic JournalFacts + Daily Dream Rust authority
  - `0018_daily_journal_jobs.sql`：`background_jobs`（atomic claim/heartbeat/lease/retry/scheduled_at/dedupe_key/checkpoint/status）、`daily_journals`（versioned，supersede，source_hash）、`daily_journal_sources`（event/observation range）、`dream_runs`（status/timing/input_hash/output_hash）、`dream_candidates`（proposal + capacity bounded）
  - M7-01 SQLite Job Worker：`claim_job`(BEGIN IMMEDIATE + RETURNING)、`heartbeat`、`lease_timeout` recovery、startup recovery、dedupe_key
  - M7-03 Deterministic JournalFacts：attempts count、writing eval summary、skill deltas、memory mutations、coach feedback/re-ask count、time spent、source_hash（不调 LLM）
  - M7-05 journal row = canonical derived projection；Markdown = rendered export view；同一天重算 → 新 version + 旧 superseded
  - M7-07 Daily Dream Rust authority：接收 Python proposals（REINFORCE/REFINE/IMPROVE/REGRESS/CONTRADICT/NOOP），capacity bounded（max input/output/candidates/retries），fail-closed（journal 仍完成，dream 标 failed，不阻塞练习）
  - M7-08 capacity limits 常量化；失败 dream 可 retry
  - 暴露 reverse-RPC capabilities：`journal.build_daily`、`dream.run_daily`（version "1"）
- [x] **Slice 2 (Python, Agent B)** — Daily Dream orchestration + LLM journal enrichment (干净室，不碰 Rust)
  - `agent-runtime-python/src/ielts_agent/dream/`：`daily_dream.py`（读 bounded 今日 facts + active memory subset + learner delta + explicit corrections → 产 proposals；不扫全部历史 M7-06）、`journal_enrichment.py`（LLM 只总结主题/组织语言/指出待验证假设/生成标题，不改数字 M7-04）、`types.py`（JournalFacts/DreamProposal/DailyDreamResult pydantic）、`capacity.py`（max input/output/candidates/token/retries）
  - proposal 只允许 REINFORCE/REFINE/IMPROVE/REGRESS/CONTRADICT/NOOP（M7-07）；新跨领域 pattern 留给 M8
  - 通过 host_bridge.invoke("journal.build_daily") 取 facts、invoke("dream.run_daily") 提交 proposals
  - LLM enrichment 调 model.invoke；no-LLM path 仍产 deterministic journal（M7-03/08）
- [x] **Slice 3 (Wave 2)** — Job worker lifecycle wiring + M7 stage gate + ADR-M7 + 确定性测试
  - Tauri commands：`journal_get_daily`/`journal_rerun`/`dream_status`/`background_job_status`（feature-gated `daily-dream-v1`）
  - app restart catch-up + idle/启动/manual 触发（M7-02；不承诺关机后自动做梦）
  - 确定性测试：restart catch missed job、duplicate day dedupe、lease recovery、deterministic facts exact、LLM 不能改数字、same-day rerun versioning、no-LLM path、private memory redaction、dream output limits、no active-memory write bypass
  - ADR-M7 + M7 stage gate report

## File ownership

- Agent A 独占：`crates/ielts-db/migrations/0018_*.sql`(NEW)、`crates/ielts-{domain,db,application}/src/journal.rs`+`dream.rs`(NEW)、`crates/ielts-db/src/background_jobs.rs`(NEW)、相关 lib.rs pub-mod 追加、`src-tauri/src/cognitive_runtime.rs`(EDIT reverse-RPC 新 method)、`src-tauri/src/app/application_store.rs`(最小追加 impl)、tests。
- Agent B 独占：`agent-runtime-python/src/ielts_agent/dream/`(NEW dir)、`agent-runtime-python/tests/test_dream_*.py`(NEW)。**不编辑** host_bridge/protocol/runtime/memory_*/retrieval/coach。
- Slice 3 独占：Tauri commands + 触发 wiring、ADR-M7、stage gate、product/确定性测试。

## Guardrails

- M7-05：canonical 放 SQLite；Markdown 只是 export/rendered view；不 append-only。
- M7-04：LLM 只总结/组织/指出待验证/生成标题；不改分数/事件数/memory confidence/不凭空产 profile。
- M7-06：dream 只读今日 observations + 今日 candidates + active memory 相关子集 + explicit corrections + learner delta；不扫全部历史。
- M7-08：capacity bounded；失败 journal deterministic 版仍完成、dream 标 failed、不阻塞练习、可 retry。
- Rust 拥有 job authority（durable SQLite job）；Python 拥有 orchestration。
- 私有 memory redaction；no active-memory write bypass（dream 只产 candidate，不直接写 active memory）。
- 每个 slice 完成后 `run_static_suite.py` + `suite_practice_flow.py` 保持 27/27 + 16/16。
- Linus 风格：数据结构优先、无特殊 case、≤3 层缩进、不破坏 userspace。
