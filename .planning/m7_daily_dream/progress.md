# Progress

## 2026-08-16 M7 开工

- 审计：M0-M6 全部完成且门禁 27/27。M7 = Daily Journal + Daily Dream v1（Python orchestration / Rust job authority）。
- 基线评估：无现有 background_jobs/journal/dream 表 —— M7 从零建。M3 memory read/write、M4 learner snapshot、M2.1 cognitive read、M6 coach feedback 表已就绪可复用。
- migration 当前到 0017；M7 用 `0018_daily_journal_jobs.sql`。
- 派发并发两路子代理：
  - Agent A (Rust)：migration 0018 + SQLite job worker + deterministic JournalFacts + Daily Dream Rust authority。
  - Agent B (Python)：Daily Dream orchestration + LLM journal enrichment（干净室）。
- Slice 3（job lifecycle wiring + 触发 + 确定性测试 + ADR-M7 + stage gate）待 Slice 1/2 完成后第二波。

## 2026-08-16 Slice 2 (Python) 完成

- 干净室交付 `agent-runtime-python/src/ielts_agent/dream/` 包（types/capacity/daily_dream/journal_enrichment/__init__）+ `ielts_agent/__init__.py` 最小追加导出。
- 测试：`test_dream_types.py`（35）、`test_daily_dream.py`（13）、`test_journal_enrichment.py`（11）共 59 个新测试。
- 验证命令结果：
  - `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → **154 tests OK**（95 既有 + 59 新增，无回归）。
  - `python developer/tests/ci/check_m3_contracts.py` → **M3 contract gate passed**（dream 包不触发 sqlite3 gate）。
  - `python developer/tests/ci/run_static_suite.py` → **26/27 pass**。唯一 fail = `Rust data-truth regressions`（`backup_full_roundtrip.rs` legacy snapshot 测试因 Slice 1 migration 0018 新增 `daily_journals` 报 "unsupported table"）—— 属 Rust Slice 1 WIP 集成问题，与本 Python slice 无关。
- 期望 Rust 侧暴露 capability 方法名/版本：
  - `journal.build_daily` v1 — 入参 `{day}`，出参 `JournalFacts`（today-scoped bounded facts）。
  - `dream.run_daily` v1 — 入参 `{day, proposals[]}`，出参 `{runId, accepted, rejected, failed}`。
- 关键决策见 `findings.md` "## 2026-08-16 Slice 2 (Python) Findings"：fail-closed 不抛 fatal、today-only scope、no active-memory write bypass、facts immutable（LLM 只改 title/summary/openHypotheses）、private memory redaction、no-LLM deterministic path、proposal 6 种 kind、capacity bounded（200/50/10/4000/1）。

## 2026-08-16 Slice 1 (Rust) 完成

- 干净室交付 M7-01/03/05/07/08 Rust 侧：migration 0018（5 表）+ background_jobs worker + deterministic JournalFacts（§23.14）+ Daily Dream Rust authority + reverse-RPC 暴露。
- 新增测试 26 个：background_jobs 10 + journal 10 + journal_dream 6。回归测试不回归。
- Capability 声明（供 Python 对齐）：`journal.build_daily` v1 / `dream.run_daily` v1。
- 验证命令结果：
  - `cargo check -p ielts-{domain,db,application}` → **0 error**（0 warning）。
  - `cargo check -p ielts-practice-tauri --locked --offline` → **0 error**。
  - `cargo test -p ielts-db --test background_jobs --locked --offline` → **10 passed**。
  - `cargo test -p ielts-db --test journal --locked --offline` → **10 passed**。
  - `cargo test -p ielts-application --test journal_dream --locked --offline` → **6 passed**。
  - `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` → **4/4 passed**（不回归）。
  - `cargo test -p ielts-application --test context_materialization --locked --offline` → **7/7 passed**（不回归）。
  - `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline` → **11/11 passed**（不回归；M7 表入 CANONICAL_TABLES + V10 frozen list）。
  - `python developer/tests/ci/check_m3_contracts.py` → **M3 contract gate passed**（不回归）。
  - `python developer/tests/ci/check_m4_contracts.py` → **M4 learner-model contract verified**（不回归）。
  - `python developer/tests/ci/run_static_suite.py` → **27/27 passed**（不回归）。
- 关键决策见 `findings.md` "## 2026-08-16 Slice 1 (Rust) Findings"：job worker 不复制 TechSpar process-local、journal deterministic 不调 LLM、rendered_markdown 是 export view、dream fail-closed 不阻塞 journal、dream 只产 pending candidate（no active-memory write bypass）、backup schema 10→11 + V10 frozen、feature gate daily-dream-v1。
- backup_full_roundtrip 修复了 Slice 2 报告的 legacy snapshot "unsupported table" 问题（v9/v10 用 V10_CANONICAL_TABLES，restore 跳过缺失表）。

## 2026-08-16 Slice 3 完成（直接接管 + 验证）

- Agent 子代理停滞（停在设计推理，未写文件）；我直接交付 Slice 3。
- 新建 `src-tauri/src/commands/journal.rs`（feature-gate daily-dream-v1）：journal_get_daily/journal_rerun/journal_list_versions/dream_run_daily/background_job_status + BackgroundJobDto（Serialize-only）。
- `crates/ielts-db/src/background_jobs.rs`：追加 `list_recent_jobs(conn, limit)` 诊断函数。
- `commands/mod.rs` + `lib.rs`：注册 journal 模块 + 5 commands + M7-02 startup_recovery hook（lease 回收 interrupted，不常驻 worker）。
- `crates/ielts-db/tests/journal_lifecycle.rs`（6 测试）：dedupe/claim 原子/lease recovery/startup requeue/startup 不重排耗尽 job/finish。
- `developer/docs/ADR-M7-Daily-Journal-Daily-Dream.md`（D1-D8 决策 + TechSpar clean-room + 限制）。
- `developer/docs/M7_STAGE_GATE_REPORT.md`（验证 + DoD 核对 §8382-8393）。
- 验证：cargo check 0 error；journal_lifecycle 6/6；cognitive_runtime 4/4 不回归；backup_full_roundtrip 11/11 不回归；Python 154/154；M3+M4 contract pass；run_static_suite **27/27**（首次 LNK1104 链接器锁 transient，重跑通过）。

### M7 全部完成
Slice 1 (Rust) + Slice 2 (Python) + Slice 3 (commands+触发+测试+ADR+stage gate) 全部完成。DoD（§8382-8393）：用户每天能看到今天做了什么/发生了什么变化/系统有哪些待验证观察，而非无证据 AI 日记 —— 已通过 deterministic JournalFacts + LLM overlay 不能改数字 + dream pending candidate 达成。
