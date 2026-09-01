# M10 Stage Gate Report

日期：2026-08-16
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M10 章（行 8845-9038）

## M10 交付结论

M10 Teaching Strategy Evolution / Procedural Memory 阶段契约验证完成：

- **M10-01 strategy catalog 8 策略**：M6 的 6 + error_then_rule_v1/rule_then_example_v1；每条 applicable activity/skill kind/prompt module/contraindications/max verbosity/version。
- **M10-02 strategy assignment**：strategy_id/why_selected/memory_ids/skill_keys/context_snapshot/response_message_id 持久化。
- **M10-03 两个 reward channel 分表**：satisfaction（teaching_strategy_feedback，5 值）≠ learning（teaching_strategy_outcomes，4 值）；enum disjoint；thumbs-up 不进 learning 轴。
- **M10-04 delayed outcome window**：按 relevant observation 计数；novel asset preference；超 window → OutOfWindow（不记 effectiveness claim）；same-asset repeat → DISCOUNTED_SAME_ASSET。
- **M10-05 user_strategy_state**：strategy×scope 统计；confidence = bounded success/(success+failure) clamped [0,1]；零证据 → 0.5；不做全局 RL。
- **M10-06 selection 规则优先**：explicit preference > contraindication > proven personal > default > exploration slot（仅证据足够 + Rust 10% cap）。
- **M10-07 preference vs effectiveness 冲突**：尊重显式偏好，不暗中切换；emit candidate suggestion only（不 auto-promote）。
- **M10-08 candidate strategy gate**：LLM candidate 落 pending batch；promotion 需开发者定义 prompt_module + 离线 eval，不直接 executable。
- reverse-RPC `strategy.select`/`strategy.record_assignment`/`strategy.record_feedback`/`strategy.record_outcome`/`strategy.user_state`（v1）+ Tauri commands。

## M10 直接验证（本次会话实测）

| 命令 | 结果 |
|---|---|
| `cargo check -p ielts-{domain,db,application} --locked --offline` | pass（0 error） |
| `cargo check -p ielts-practice-tauri --locked --offline` | pass（0 error） |
| `cargo test -p ielts-db --test teaching_strategy --locked --offline` | 11/11 passed（out_of_window/repeated_same_asset/explicit_preference/satisfaction_vs_learning/exploration_cap 等） |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` | 4/4 passed（不回归） |
| `cargo test -p ielts-application --test context_materialization --locked --offline` | 7/7 passed（不回归） |
| `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline` | 11/11 passed（不回归） |
| `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` | 257 passed（192 既有 + 65 新 strategy_eval，不回归） |
| `python developer/tests/ci/check_m3_contracts.py` | pass（coach 包无 sqlite3） |
| `python developer/tests/ci/check_m4_contracts.py` | pass |
| `python developer/tests/ci/run_static_suite.py` | 27/27 pass / 0 fail |

## 仓库级门禁状态

`run_static_suite.py` 27/27 pass。Rust workspace check、cognitive runtime contract（含新 strategy.* reverse-RPC）、memory proposal contract、data-truth regressions（backup roundtrip 含 M10 表）、M4 learner model、AI config security、reading data integrity、Python cognitive protocol（257 测试）、M3/M4 contract boundary 全部通过。

## 诚实限制

1. **shadow/canary 未跑**：strategy effectiveness 是 offline-estimated，未在真实用户上做 longitudinal canary（与 M3-M9 一致：验 contract/protocol/persistence 边界 + 确定性测试，不验 live model 输出）。
2. **exploration cap 是常量 10%**：未做 contextual bandit；Rust 强制。
3. **candidate strategy evaluator 是 Rust 结构安全门**：IPC 只能提交 `batchId`，verdict/metrics 由 Rust 从已持久化候选内容生成；这不是 M11 的效果评测流程。
4. **confidence 是 bounded formula**：未跨数据量验证；任务书未定义硬阈值，是观测值。

## 遗留项

- candidate strategy 离线 eval 流程（M11 完成）。
- longitudinal canary：小比例用户开 strategy effectiveness tracking，收集真实 outcome 数据。
- contextual bandit exploration（替代固定 10% cap）。

## DoD 核对（任务书 §9030-9037）

系统能够解释：
- [x] 「为什么这次用了例子优先？」（StrategyAssignment.why_selected + selection tier 记录）
- [x] 「以前这种讲法对我是否有效？」（user_strategy_state success/failure/novel_transfer + confidence）
- [x] 「这个判断依据的是点赞，还是后续学习结果？」（2 reward channel 分表，satisfaction ≠ learning；outcome attribution verdict 显式标注 attributed/out_of_window/discounted_same_asset）

下一阶段：M11 Prompt Registry、Skill Registry 与 Eval-driven Evolution（Python-first experiment / Rust release gate）。

## Round 3 Post-Audit Addendum（2026-08-31）

本报告只证明 strategy catalog、assignment/outcome 数据合同和确定性选择测试通过。Round 3 已补上 M10 candidate 的 Rust 结构安全 evaluator：IPC 只能请求指定 batch，不能提交 `passed`/`metrics`；这仍不是效果评测，也不等于策略已通过 M11 数据集 eval 或已在线生效。
