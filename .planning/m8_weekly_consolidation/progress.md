# Progress

## 2026-08-16 M8 开工

- 审计：M0-M7 全部完成且门禁 27/27。M8 = Weekly Dream + Cross-scope Pattern + Memory Consolidation（Python orchestration / Rust promotion gate）。
- 基线评估：M3 `memory_items` 已有 status（candidate/active/superseded/archived）+ supersedes_id FK；M7 `dream_runs`/`dream_candidates`/`background_jobs` 已就绪；`promote_memory_candidate` 已含 supersede 逻辑。无 memory_relations/memory_feedback/memory_capacity_state 表 —— M8 从零建 migration 0019。
- migration 当前到 0018；M8 用 `0019_memory_consolidation_v1.sql`。
- 派发并发两路子代理：
  - Agent A (Rust)：migration 0019 + pattern validator（§23.16 四 gate + M8-03 保守阈值）+ consolidation apply（§23.17 不删除+lineage+可 reverse）+ stale archive per-kind + feedback backend + predicted promotion gate。
  - Agent B (Python)：Weekly Dream orchestration（cross-scope pattern discovery，stable ID 给 LLM，Rust 重验）+ 四条 pattern gate clean-room。
- Slice 3（Tauri commands + 确定性测试 + ADR-M8 + stage gate）待 Slice 1/2 完成后第二波。

## 2026-08-16 Slice 2 (Python) 完成

- 新增 `agent-runtime-python/src/ielts_agent/dream/weekly.py`（WeeklyDreamOrchestrator + WeeklyDreamInput + fallback_result）。
- 追加 `agent-runtime-python/src/ielts_agent/dream/types.py`：`PatternKind` StrEnum（5 值）+ `WeeklyPatternProposal` + `WeeklyDreamResult` + capability 常量 + `__all__` 导出。
- 更新 `agent-runtime-python/src/ielts_agent/dream/__init__.py` 导出 weekly 模块；`agent-runtime-python/src/ielts_agent/__init__.py` 追加导出 `WeeklyDreamInput`/`WeeklyDreamOrchestrator`。
- 新增 `agent-runtime-python/tests/test_weekly_dream.py`（38 测试）。
- 验证结果：
  - `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` → 192 tests OK（154 既有 + 38 新增，无回归）。
  - `python developer/tests/ci/check_m3_contracts.py` → pass（dream 包不触发 sqlite3 gate）。
  - `python developer/tests/ci/run_static_suite.py` → 19/27 pass。Python 侧 3 项全过（Python cognitive protocol / M3 contract boundary / M4 learner model contract）。8 项 Rust 失败均源自 `crates/ielts-domain/src/consolidation.rs:151` const fn 编译错误（`destructor of RejectReason cannot be evaluated at compile-time`）—— 属 Rust Slice 1 (Agent A) WIP，与本 Slice 2 Python 交付无关（未编辑任何 Rust 文件；`git status` 确认 `agent-runtime-python/` 全目录 untracked，`crates/ielts-domain/src/consolidation.rs` 属 Agent A 独占）。
- 期望 Rust 侧暴露 capability：`dream.run_weekly` v1 + `memory.candidate_pool` v1（详见 findings.md）。

## 2026-08-16 Slice 1 (Rust) 完成（直接接管 + 验证）

- Agent A 停滞（只交付 migration 0019 + domain consolidation.rs，含 `const fn code` 编译错误阻塞全 Rust build）。我直接接管补齐：
  - 修复 `RejectReason::code` 从 `pub const fn code(self)` → `pub fn code(&self)`（String 字段 variant 不能在 const fn 中 drop）。
  - 新建 `crates/ielts-db/src/consolidation.rs`：`load_support_memories`/`insert_memory_relation`/`apply_consolidation`/`propagate_support_change`/`archive_stale`/`record_memory_feedback`/`validate_patterns`（§23.16 四 gate + M8-03 阈值 + M8-04 diversity + M8-05 禁止诊断类 + M8-10 predicted gate）。
  - 新建 `crates/ielts-application/src/consolidation.rs`：`ConsolidationService` + `ConsolidationStore` trait + `WeeklyDreamResult`。
  - `ApplicationStore` 实现 `ConsolidationStore`。
  - `cognitive_runtime.rs`：reverse-RPC `dream.run_weekly` + `memory.candidate_pool` 分支 + `load_candidate_pool` helper；`PROVIDED_HOST_CAPABILITIES` 追加。
  - `commands/journal.rs`：追加 `dream_run_weekly`/`memory_record_feedback`/`consolidation_archive_stale` Tauri commands。
  - 修复 migration 0019：`memory_feedback.id` CHECK 从 `substr(id,1,5)='mfb-'` 改为 `substr(id,1,4)='mfb-'`（'mfb-' 是 4 字符）；移除非幂等 `ALTER TABLE dream_runs ADD COLUMN scope`（改用 job_kind 区分）。
  - `crates/ielts-db/tests/consolidation.rs`：10 测试（min_supports/same_asset/hallucinated/predicted/superseded/valid/lineage_no_delete/user_refute_no_delete/empty_success/load_supports）。
- 验证：consolidation 10/10；history_retention 6/6 不回归；backup_full_roundtrip 11/11 不回归；cognitive_runtime 4/4 不回归；Python 192/192；M3+M4 contract pass；run_static_suite **27/27**（首次 LNK1104 transient，重跑通过）。
- ADR-M8 + M8_STAGE_GATE_REPORT 完成。DoD（§8657-8665）全勾。

### M8 全部完成
Slice 1 (Rust) + Slice 2 (Python) + Slice 3 (commands + 测试 + ADR + stage gate) 全部完成。
