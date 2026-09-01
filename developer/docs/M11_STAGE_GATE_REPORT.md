# M11 Stage Gate Report

日期：2026-08-16
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M11 章（行 9040-9200）

## M11 交付结论

M11 Prompt Registry、Skill Registry 与 Eval-driven Evolution 阶段契约验证完成：

- **M11-01 Soul 稳定 Policy Layer**：core_soul module 不由 Dream 改写；`edit_soul` 工具被禁（M11-06）。
- **M11-02 Prompt Module Registry**：10 module enum（core_soul/attempt_review/coach_reading/coach_writing/memory_extract/memory_resolve/daily_dream/weekly_dream/strategy_selector/study_planner）+ prompt_versions versioned。
- **M11-03 Skill Registry**：4 skill（read_attempt_evidence/compare_repeated_attempts/explain_tfng_error/build_weekly_reflection），versioning 与 user memory 分离。
- **M11-04 Eval Dataset**：8 类 case（memory_extraction_goldens/false_merge_split/consolidation_zero/context_selection/coach_personalization/prompt_injection/repeated_familiarity/strategy_outcome）+ holdout isolation。
- **M11-05 Candidate Lifecycle**：propose→eval→holdout→shadow→approval→canary→promote→rollback；holdout never enters prompt generation context；shadow no user-visible side effect；rollback exact。
- **M11-06 禁止 online self-modifying prompt**：`update_system_prompt`/`edit_soul`/`install_unreviewed_skill` agent tool 黑名单（Rust tool.invoke 白名单 + Python FORBIDDEN_AGENT_TOOLS 双 gate）。
- **M11-07 Hermes 安全落地**：candidate→eval→门禁批准→发布→回滚；不是生产 Agent 自改代码。
- **M11-08 Trace Graders**：final answer/context used/irrelevant tool/memory citation/counter-evidence/oversized output/cost-latency；version pinned in trace。
- reverse-RPC `prompt.list_versions`/`prompt.get_active`/`prompt.propose_candidate`/`prompt.promote_candidate`/`prompt.rollback`/`eval.run_case`/`skill.list_versions`（v1）+ Tauri commands。

## M11 直接验证（本次会话实测）

| 命令 | 结果 |
|---|---|
| `cargo check -p ielts-{domain,db,application} --locked --offline` | pass（0 error） |
| `cargo check -p ielts-practice-tauri --locked --offline` | pass（0 error） |
| `cargo test -p ielts-db --test prompt_skill --locked --offline` | 10/10 passed（candidate cannot skip eval/holdout isolation/shadow no side effect/rollback exact/version pinning 等） |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` | 4/4 passed（不回归） |
| `cargo test -p ielts-application --test context_materialization --locked --offline` | 7/7 passed（不回归） |
| `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline` | 11/11 passed（不回归） |
| `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` | 346 passed（257 既有 + 89 新 eval，不回归） |
| `python developer/tests/ci/check_m3_contracts.py` | pass（eval 包无 sqlite3） |
| `python developer/tests/ci/check_m4_contracts.py` | pass |
| `python developer/tests/ci/run_static_suite.py` | 27/27 pass / 0 fail |

## 仓库级门禁状态

`run_static_suite.py` 27/27 pass。Rust workspace check、cognitive runtime contract（含新 prompt.*/skill.*/eval.run_case reverse-RPC）、memory proposal contract、data-truth regressions（backup roundtrip 含 M11 表）、M4 learner model、AI config security、reading data integrity、Python cognitive protocol（346 测试）、M3/M4 contract boundary 全部通过。

## 诚实限制

1. **现有硬编码 prompt const 未被 registry overlay override**：registry schema + service + reverse-RPC 就绪，但 AgentService 的 prompt 注入 wire-up 是 future（M11 只立契约 + eval pipeline，不破坏现有 prompt 路径）。
2. **eval 是合成 dataset**：8 类 case，未做 live model E2E（与 M3-M10 一致：验 contract/protocol/persistence 边界 + 确定性测试）。
3. **candidate approval 是 API gate**：未做 UI 审批界面（M9 Memory Center 可扩展）。

## 遗留项

- AgentService prompt 注入 wire-up：用 registry active version override fallback const（future slice）。
- UI 审批界面（M9 Memory Center 扩展）。
- live model eval（真实 LLM 跑 frozen eval cases，对比 candidate vs active version）。

## DoD 核对（任务书 §9190-9200）

任何 production Prompt/Skill 变化都可以回答：
- [x] 谁提出的？（candidate_promotions.proposed_by）
- [x] 基于什么问题？（proposal_json + eval_cases input）
- [x] 通过哪些 eval？（eval_runs/eval_results + EvalRunOutcome）
- [x] 和上一版相比改善什么？（eval metrics_json + shadow output_diff）
- [x] 有哪些退化？（grading_json + failed cases）
- [x] 如何回滚？（rollback_version exact rollback，旧 version 标 active）

下一阶段：M12 General Agent Thread、Study Planner 与 Controlled Actions（最后一个里程碑）。

## Round 3 Post-Audit Addendum（2026-08-31）

本报告只证明 registry/schema/promotion 状态机和边界测试通过。当前硬编码 AgentService prompt overlay 尚未接入；eval case 的生产燃料与执行器、shadow/canary 运行证据也不能由合同测试替代。因此 M11 不应被解释为 Prompt/Skill 已在线自进化或已完成产品级 release gate。
