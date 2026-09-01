# M8 Stage Gate Report

日期：2026-08-16
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M8 章（行 8396-8666）

## M8 交付结论

M8 Weekly Dream + Cross-scope Pattern + Memory Consolidation 阶段契约验证完成：

- **M8-01 四条 pattern gate + 宁可 0 pattern**（R2 clean-room）：跨≥2 独立 scope、抽象层次高于原 observation、有新价值、可证伪。双 gate（Python 预校验 + Rust 重验）。
- **M8-02 stable-ID validation**：Rust 从 DB 重验 LLM 返回的 supportingMemoryIds（不信任 index）；hallucinated ID → 整条 pattern 拒绝。
- **M8-03 保守阈值**（config 化）：min_supports=3/min_new_evidence=3/min_distinct_assets=2/min_distinct_scopes=2/cooldown=6d。
- **M8-04 independent evidence**：subject_key（asset identity）+ scope + namespace diversity。
- **M8-05 pattern 类型 5 种**：cross_skill_strategy/metacognitive_pattern/behavior_pattern/stable_learning_preference/recurrent_language_pattern；禁止 medical/personality/intelligence/mental_health（DB CHECK + Rust enum + Python allow-list 三重）。
- **M8-06 consolidation 不物理删除**（§23.17）：memory_relations 保留 lineage + support 标 superseded + 可 reverse。
- **M8-07 improvement/regression propagation**：support improve → pattern confidence decay；all refuted → archive（按 stable ID，不文本匹配）。
- **M8-08 stale archive per-kind policy**：fast/medium/slow/never_auto/validity_driven，policy 存 memory_capacity_state，可 replayable。
- **M8-09 user feedback backend**：6 种 kind；inaccurate 是强 contradiction 但不删 learning facts。
- **M8-10 predicted 禁止自动 promotion**：source_class='predicted' → reject。
- reverse-RPC `dream.run_weekly` v1 + `memory.candidate_pool` v1；Tauri commands `memory_record_feedback`/`consolidation_archive_stale`。
- **Round-3 audit (A3) 修正**：周度 consolidation 不再注册为 Tauri command。它写 active memory 并 supersede supports，因此 webview 绝不能作为 patterns 的来源；唯一入口是 host-gated 的 sidecar reverse-RPC，内部调用 `commands::journal::run_weekly_consolidation`（非 `#[tauri::command]`）。

## M8 直接验证（本次会话实测）

| 命令 | 结果 |
|---|---|
| `cargo check -p ielts-{domain,db,application} --locked --offline` | pass（0 error） |
| `cargo check -p ielts-practice-tauri --locked --offline` | pass（0 error） |
| `cargo test -p ielts-db --test consolidation --locked --offline` | 10/10 passed |
| `cargo test -p ielts-db --test history_retention --locked --offline` | 6/6 passed（不回归） |
| `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline` | 11/11 passed（不回归） |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` | 4/4 passed（不回归） |
| `cargo test -p ielts-application --test context_materialization --locked --offline` | 7/7 passed（不回归） |
| `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` | 192 passed（95 既有 + 59 dream + 38 weekly，不回归） |
| `python developer/tests/ci/check_m3_contracts.py` | pass（dream 包不触发 sqlite3 gate） |
| `python developer/tests/ci/check_m4_contracts.py` | pass |
| `python developer/tests/ci/run_static_suite.py` | 27/27 pass / 0 fail（首次 LNK1104 链接器锁 transient，重跑通过） |

## 仓库级门禁状态

`run_static_suite.py` 27/27 pass。Rust workspace check、cognitive runtime contract、memory proposal contract、data-truth regressions（backup roundtrip 含 M8 表）、M4 learner model、AI config security、reading data integrity、Python cognitive protocol（192 测试）、M3/M4 contract boundary 全部通过。

## 诚实限制

1. **memory.candidate_pool 是 bounded sample**：当前 sample reading activity slice；full cross-activity pool 是 M9 diagnostic surface（M8 保持 reverse-RPC bounded + simple）。
2. **weekly dream 未做 live model E2E**：与 M3/M5/M6/M7 一致——验 contract/protocol/persistence 边界 + 确定性测试，不验 live model 输出。
3. **archive policy 是基线**：未跨数据量验证；任务书未定义硬性阈值，是观测值。
4. **`dream_runs.scope` 列未添加**：ALTER TABLE ADD COLUMN 非幂等（rewind-reapply 测试失败），改用 background_jobs.job_kind 区分 weekly/daily（该列无代码读取）。

## 遗留项

- 接入真实 LLM 后重跑 weekly dream，对比 deterministic-only vs LLM-enriched pattern 质量。
- `memory.candidate_pool` 扩展为 full cross-activity pool（M9）。
- M9 Memory Center UI 暴露 consolidation lineage（用户可查看 pattern → supports → 证据）。

## DoD 核对（任务书 §8657-8665）

- [x] 这条结论来自哪几次练习？（ConsolidationReceipt.support_ids + memory_relations lineage 可追溯）
- [x] 为什么这些证据彼此独立？（M8-04 distinct asset/scope gate + validator 拒绝 same-asset-3x）
- [x] 什么时候会被判定为过期或错误？（M8-07 decay/archive + M8-08 stale archive per-kind + M8-09 user refute）
- [x] 用户如何纠正它？（M8-09 record_memory_feedback：inaccurate/outdated/not_about_me 触发 archive/decay，不删 facts）

下一阶段：M9 Memory Center + Learner Profile + Evidence UX。

## Round 3 Post-Audit Addendum（2026-08-31）

本报告只证明 pattern gate、lineage、consolidation 数据合同和确定性测试通过，不证明 weekly dream 已有完整生产触发链或所有写入都经过同一 MemoryProposalValidator。Round 3 审计发现 weekly 路径、archive 语义和候选桥接仍需修复；在这些修复完成并复跑安全回归前，不得把本报告的“契约验证完成”解释为 Weekly Dream 产品闭环通过。
