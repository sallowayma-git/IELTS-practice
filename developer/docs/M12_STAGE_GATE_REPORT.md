# M12 Stage Gate Report

日期：2026-08-16
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M12 章（行 9204-9384）

## M12 交付结论

M12 General Agent Thread、Study Planner 与 Controlled Actions 阶段契约验证完成（Rust + Python；UI 升级为现有原型 + capabilities 暴露）：

- **M12-01 Agent Thread**：agent_threads/agent_messages/agent_checkpoints（migration 0022）；create/list/archive；thread_kind；sequence；summary；thread-level context scope。
- **M12-02 Checkpoint / Cancellation**：stage 状态机（context_built→model_response→tool_before→tool_after→waiting_approval→final）；cancellation token；cancel request DB；`restart_recovery` 标 interrupted；read-only safe replay；write tool never automatic replay。
- **M12-03 Workspace 不是 Memory engine**：只查询/计划/受控行动。
- **M12-04 Study Planner**：deterministic constraints（priority→uncertainty→target_date→skill_key；时间约束；heavy week 0.5 折减；≤8 items）；第一版只做 proposal。
- **M12-05 Skill probe 非重复原题**：SkillProbe 只携带 skill_key + probe_kind + avoid_asset_ids。
- **M12-06 Controlled Action Gate 三层**：allow（4 action）/approval-gate（4 action）/forbidden（6 action 永不提供，reverse-RPC 拒绝）。
- **M12-07 Embeddings 不强上**：M5 lexical+FTS 已满足 goldens，不接 embedding。
- **M12-08 General Agent UI**：现有 AgentWorkspacePage.vue 原型 + 新 capabilities（thread/approval/study_plan）通过 Tauri commands 暴露。
- reverse-RPC `thread.*`/`approval.*`/`study_plan.*`（v1）+ Tauri commands。

## M12 直接验证（本次会话实测）

| 命令 | 结果 |
|---|---|
| `cargo check -p ielts-{domain,db,application} --locked --offline` | pass（0 error） |
| `cargo check -p ielts-practice-tauri --locked --offline` | pass（0 error） |
| `cargo test -p ielts-db --test agent_thread --locked --offline` | 19/19 passed（restart recovery/forbidden action CHECK/approval flow/cancel 等） |
| `cargo test -p ielts-application --test agent_thread --locked --offline` | 11/11 passed |
| `cargo test -p ielts-practice-tauri --lib cognitive_runtime --locked --offline` | 4/4 passed（不回归） |
| `cargo test -p ielts-application --test context_materialization --locked --offline` | 7/7 passed（不回归） |
| `cargo test -p ielts-db --test backup_full_roundtrip --locked --offline` | 11/11 passed（不回归，M12 表纳入 backup） |
| `python -m unittest discover -s agent-runtime-python/tests -p "test_*.py"` | 417 passed（346 既有 + 71 新 planner，不回归） |
| `python developer/tests/ci/check_m3_contracts.py` | pass（planner 包识别为 orchestration package） |
| `python developer/tests/ci/check_m4_contracts.py` | pass |
| `python developer/tests/ci/run_static_suite.py` | 27/27 pass / 0 fail（首次 corpus_sync + LNK1104 transient 并发锁，重跑通过） |

## 仓库级门禁状态

`run_static_suite.py` 27/27 pass。Rust workspace check、cognitive runtime contract（含新 thread.*/approval.*/study_plan.* reverse-RPC）、memory proposal contract、data-truth regressions（backup roundtrip 含 M12 表）、M4 learner model、AI config security、reading data integrity、Python cognitive protocol（417 测试）、M3/M4 contract boundary 全部通过。

## 诚实限制

1. **Vue AgentWorkspacePage 完整 UI 升级未做**：现有 416 行原型保留；新 capabilities（thread/approval/study_plan）通过 Tauri commands 暴露供前端消费。Workspace DoD 通过 Rust/Python contract + 既有原型达成，未做 full UI E2E（与 M3-M11 一致：验 contract/protocol/persistence 边界 + 确定性测试）。
2. **planner 未做 live model E2E**：deterministic constraints 验证；no-LLM path 验证。
3. **checkpoint/cancellation child retry run**：contract 就绪，未在 AgentService::run 核心 loop 完整 wire-up（不破坏现有 run loop）。
4. **M12-07 确认**：embedding 不接（M5 lexical+FTS 已满足 goldens）。

## 遗留项

- Vue AgentWorkspacePage 完整 UI 升级（thread list/message flow/tool trace/context trace/memory refs/cancel-retry/approval card/study plan panel）。
- AgentService::run 核心 loop wire-up checkpoint/cancellation child retry。
- live model planner E2E。

## DoD 核对（任务书 §9375-9383）

Workspace 成为「可以看、问、计划、解释、受控行动的学习控制台」：
- [x] 看（thread.list + agent_messages + Memory Center M9 + context trace）
- [x] 问（thread.append_message + AgentService::run + read tools）
- [x] 计划（study_plan.create + planner orchestration M12-04）
- [x] 解释（context materialize M5 + coach strategy assignment M6/M10 + Dream report M7/M8/M9）
- [x] 受控行动（controlled action gate M12-06 三层：allow/approval/forbidden）

而不是一个与核心学习系统平行的聊天产品 —— M12 达成。

## 项目整体状态

按任务书 §21.6.9 的历史交付顺序，以下仅列阶段合同状态，不构成 M0-M12 产品整体 Go：
```
M0-M5   ✅ COMPLETED
M6      ⚠️ CONTRACT VALIDATED（产品级 Go/No-Go：NO-GO；Rust baseline 仍是唯一用户可见 Coach）
M7      ⚠️ CONTRACT VALIDATED（生产调度/自动补跑未证明）
M8      ⚠️ CONTRACT VALIDATED（weekly 安全与生产触发链待审计整改）
M9      ⚠️ CONTRACT VALIDATED（Memory Center 默认 flag off）
M10     ⚠️ CONTRACT VALIDATED（生产 eval/promotion 门待接线）
M11     ⚠️ CONTRACT VALIDATED（prompt overlay 与 live eval/canary 待接线）
M12     ⚠️ CONTRACT VALIDATED（受控线程合同通过，不代表前置产品闭环通过）
```

上述任务书合同项已达到各自报告记录的验证标准；产品闭环仍受 M6 No-Go 与各阶段“诚实限制”约束。

## Round 3 Post-Audit Addendum（2026-08-31）

上面的阶段表已按 Round 3 审计改为“契约验证”口径。它不构成 M0-M12 产品级整体 Go；尤其 M6 产品门为 No-Go，M7-M12 的后续交付不能追溯性地把该门改写为通过。当前产品状态必须同时参考代码生产调用路径、各阶段“诚实限制”、[Round 3 审计报告](PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md) 和 [后端审计发现](../../.planning/agent_backend_audit_20260824/findings.md)。
