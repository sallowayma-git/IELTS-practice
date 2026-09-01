# M7 Stage Gate Report

日期：2026-08-16
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M7 章（行 8190-8393）

## M7 交付结论

M7 Daily Journal + Daily Dream v1 阶段契约验证完成：

- **M7-01 SQLite Job Worker**（Rust authority）：`background_jobs`（atomic claim `BEGIN IMMEDIATE`+`RETURNING`、heartbeat、lease timeout、dedupe_key、startup recovery、retry count、checkpoint）。不复制 TechSpar process-local task_status。
- **M7-02 触发语义**：app 启动 catch-up（`startup_recovery_with_catch_up` 回收 interrupted，并从 canonical activity dates 为缺失窗口入队）+ 手动 `journal_rerun`/`dream_run_daily`。不引入 OS scheduler；不承诺关机后自动做梦。
- **M7-03 Deterministic JournalFacts**（不调 LLM）：§23.14 伪代码实现，从 attempts/writing_evals/learner_skill_observations/memory_mutations/coach_feedback/coach_reask 聚合；source_hash 稳定；private memory 只 count 不复制正文。
- **M7-04 LLM Journal Enrichment**（Python overlay）：LLM 只产 title/summary/openHypotheses；`facts_json` enrichment 前后逐字节不变；no-LLM path 仍产 deterministic enrichment。
- **M7-05 canonical 在 SQLite，Markdown 是 export view**：同天重算 → 新 version + 旧 superseded；不 append Markdown。
- **M7-06 today-only scope**：`journal.build_daily` 入参仅 `{day}`，不扫全部历史。
- **M7-07 Daily Dream 6 种 proposal**：REINFORCE/REFINE/IMPROVE/REGRESS/CONTRADICT/NOOP；dream 只产 pending candidate，no active-memory write bypass。
- **M7-08 capacity bounded + fail-closed**：MAX_INPUT_OBSERVATIONS=64/MAX_ACTIVE_CANDIDATES=16/MAX_OUTPUT_CANDIDATES=6/MAX_TOKEN_BUDGET=4000/MAX_LLM_RETRIES=2。dream failed 不阻塞 journal。

## M7 直接验证（本次会话实测）

| 命令 | 结果 |
|---|---|
| `cargo check -p ielts-{domain,db,application} --locked --offline` | pass（0 error） |
| `cargo check -p ielts-practice-tauri --locked --offline` | pass（0 error） |
| `cargo test -p ielts-db --test background_jobs --locked --offline` | 10/10 passed |
| `cargo test -p ielts-db --test journal --locked --offline` | 10/10 passed |
| `cargo test -p ielts-db --test journal_lifecycle --locked --offline` | 6/6 passed（restart catch-up/dedupe/lease recovery/exhausted 不重排/claim 原子/finish） |
| `cargo test -p ielts-application --test journal_dream --locked --offline` | 6/6 passed |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` | 4/4 passed（不回归） |
| `cargo test -p ielts-application --test context_materialization --locked --offline` | 7/7 passed（不回归） |
| `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline` | 11/11 passed（M7 表纳入 backup schema v11） |
| `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` | 154 passed（95 既有 + 59 新 dream 测试，不回归） |
| `python developer/tests/ci/check_m3_contracts.py` | pass（dream 包不触发 sqlite3 gate） |
| `python developer/tests/ci/check_m4_contracts.py` | pass |
| `python developer/tests/ci/run_static_suite.py` | 27/27 pass / 0 fail |

## 仓库级门禁状态

`run_static_suite.py` 27/27 pass。Rust workspace check、cognitive runtime contract、memory proposal contract、data-truth regressions（backup roundtrip 含 M7 表）、M4 learner model、AI config security、reading data integrity、Python cognitive protocol（154 测试）、M3/M4 contract boundary 全部通过。

## 诚实限制

1. **无 OS scheduler / 常驻 worker**：关机期间不执行 dream；启动时只从 canonical activity dates 补入缺失的 journal/dream 队列，仍需现有执行路径 claim/运行。产品文案不承诺关机后自动做梦。
2. **shadow/canary 未跑**：dream enrichment 是 Python overlay，未做 live model E2E（与 M3/M5/M6 一致：验 contract/protocol/persistence 边界 + 确定性测试，不验 live model 输出）。
3. **`journal_list_versions` 返回空**：JournalStore port 只暴露 latest journal；version 历史是 future diagnostic，返回空而非伪造单行。
4. **capacity 常量是基线**：未跨数据量验证；任务书未定义硬性阈值，是观测值。

## 遗留项

- 接入真实 LLM provider 后重跑 dream enrichment，对比 deterministic-only vs LLM-enriched 质量。
- 若 canary 证明 PythonPersonalizedCoach shadow（M6）稳定，dream orchestrator 可复用同一 sidecar 路径。
- `journal_list_versions` 补 version 历史 diagnostic（需 JournalStore port 扩展）。

## DoD 核对（任务书 §8382-8393）

- [x] 用户每天能看到今天做了什么（`JournalFacts` attempts/evals/time_spent）
- [x] 发生了什么变化（skill_deltas/memory_changes/coach_feedback/reask count）
- [x] 系统有哪些待验证观察（dream pending candidates + openHypotheses）
- [x] 而非无证据的「AI 日记」（facts 是 deterministic derived projection；LLM 只 overlay，不改数字）

下一阶段：M8 Weekly Dream + Cross-scope Pattern + Memory Consolidation（Python orchestration / Rust promotion gate）。

## Round 3 Post-Audit Addendum（2026-08-31）

本报告只证明 Daily Journal/Daily Dream 的确定性合同和持久化测试通过。当前启动 catch-up 已从 canonical activity dates 补入缺失窗口，但仍不执行关机期间的任务；Python enrichment 也不等于生产调用链。无 OS scheduler、无 live model E2E 和无常驻 worker 仍是当前限制。M6 No-Go 也不会因本阶段契约测试通过而自动解除。
