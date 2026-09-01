# ADR-M7: Daily Journal + Daily Dream v1

日期：2026-08-16
状态：Accepted
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M7 章（行 8190-8393）

## Context

M6 Reading+Coach 闭环成立后，引入「做梦」机制。M7 的 Daily 不是无限追加的聊天总结，而是：一天的 deterministic facts + 一天的 candidate/memory changes + 一天的 learner-state delta → versioned journal → bounded daily consolidation proposal。M7 必须保证用户每天能看到「今天做了什么 / 发生了什么变化 / 系统有哪些待验证观察」，而不是一段无证据的「AI 日记」。

## Decisions

### D1. Rust 拥有 SQLite job authority；不复制 TechSpar process-local task_status
TechSpar 用 `F:\workspace\TechSpa\backend\runtime.py` 的 process-local `_task_status` + FastAPI BackgroundTasks 作为「durable job system」。IELTS 明确拒绝此模式：单机单 worker，用 SQLite atomic claim（`BEGIN IMMEDIATE` + `UPDATE ... WHERE id=(SELECT ... LIMIT 1) RETURNING`，§23.15）+ heartbeat + lease timeout + dedupe_key + startup recovery。进程退出后 lease timeout 回 interrupted，有重试余量者回 queued，耗尽者留 terminal。

### D2. JournalFacts 是 deterministic derived projection（不调 LLM）
§23.14 伪代码直接实现：从 attempts/writing_evaluations/learner_skill_observations/memory_mutations/coach_feedback/coach_reask 聚合，不复制正文。`source_hash` 是 canonical sorted-key stream 的 SHA256，同输入稳定，输入变则变。private memory content 永不进 facts（只 count）。

### D3. canonical 放 SQLite；Markdown 只是 export/rendered view（M7-05）
不采用 TechSpar `insights/YYYY-MM-DD.md` append-only 作为 truth。`daily_journals` row = canonical derived projection；`rendered_markdown` = export view。同一天重算 → 新 version + 旧 status='superseded' + superseded_by 指向新行。不向一个无限 Markdown 文件 append。

### D4. LLM enrichment 不能改数字事实（M7-04）
LLM 只总结主题/组织语言/指出待验证假设/生成标题。`JournalFacts.facts_json()` 是 canonical sorted JSON，Python `JournalEnricher` 在 enrichment 前后 assert 逐字节不变。LLM 只产 title/summary/openHypotheses，不改 attempts/evals/skill_deltas/memory_changes 数字。

### D5. Dream 只产 candidate，no active-memory write bypass（M7-07）
Dream proposals（REINFORCE/REFINE/IMPROVE/REGRESS/CONTRADICT/NOOP，固定 6 种，跨领域高阶 pattern 留 M8）落 `dream_candidates.disposition='pending'`。promotion 仍走 M3 `promote_memory_candidate`。Dream 从不直接写 active memory。

### D6. capacity bounded + fail-closed（M7-08）
常量：MAX_INPUT_OBSERVATIONS=64、MAX_ACTIVE_CANDIDATES=16、MAX_OUTPUT_CANDIDATES=6、MAX_TOKEN_BUDGET=4000、MAX_LLM_RETRIES=2。失败时 journal deterministic 版仍完成、dream 标 failed、不阻塞练习、可 retry。Python orchestrator 全程 try/except，host 失败 → fallback_result，不抛 fatal。

### D7. M7-06 today-only scope
`journal.build_daily` 入参仅 `{day}`，无 cursor/since/allHistory。Python orchestrator 只读今日 observations + 今日 candidates + active memory 相关子集 + explicit corrections + learner delta。不扫全部历史。

### D8. 触发语义不承诺关机后自动做梦（M7-02）
触发只在 app idle / 启动 catch-up（`startup_recovery_with_catch_up` 回收 interrupted，并从 canonical activity dates 为缺失窗口入队）/ 手动「整理今日」/ 本地日界线后首次可运行。不引入 OS scheduler / 不后台常驻 worker 进程。产品文案禁止承诺「关机后凌晨 3 点自动做梦」。

## TechSpar clean-room 边界
- N：不复制 `runtime.py` process-local `_task_status`（用 SQLite atomic claim）。
- R1：借 `storage/sessions.py:122-160` stale recovery 思想（lease timeout 回 interrupted）。
- R3：`memory.py:288 _save_insight` Markdown append 只作 export view，canonical 放 SQLite（D3）。

## 当前限制
- 无 OS scheduler：dream 不在关机后自动跑；仅启动 catch-up + 手动 + idle。
- shadow / canary 未跑（M6 PythonPersonalizedCoach shadow 也未 canary）；dream enrichment 是 Python overlay，未做 live model E2E（与 M3/M5/M6 一致：验 contract/protocol/persistence 边界 + 确定性测试，不验 live model 输出）。
- `journal_list_versions` 当前返回空（JournalStore port 只暴露 latest；version 历史是 future diagnostic，不伪造单行）。
- preference promotion 仍需人工/M10 自动化（M6 遗留）。

## Feature gate
`daily-dream-v1 = ["context-compiler-v1"]`（M7 依赖 M3 memory + M4 learner + M5 context + M6 coach feedback）。加入 src-tauri default feature set。

## Capabilities（供 Python 对齐）
- `journal.build_daily` v1 — 入参 `{query: DailyJournalQuery{userId, journalDate}}`，出参 `JournalFacts`。
- `dream.run_daily` v1 — 入参 `{query: DailyDreamQuery{userId, journalId}, proposals: DreamProposal[], inputHash?}`，出参 `DailyDreamResult{run, candidates}`。
