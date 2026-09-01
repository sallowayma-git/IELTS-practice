# M4 Stage Gate Report

日期：2026-08-13  
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md`

## M4 交付结论

M4 vertical slice 阶段契约验证完成（历史 gate）：

- `0015_learner_model_v1.sql` 已在 M3 `0014` 之后注册；
- taxonomy、mapping provenance、M2 event rebuild、weighted Beta、neutral decay、familiarity discount、uncertainty、distinct assets、trend、review scheduler 已落地；
- application bounded read/admin port、Tauri commands、Cargo feature、默认关闭的 Vue flag 和最小 learner surface 已接通；
- no extra filesystem/shell/process capability，Python 不接触 canonical SQLite；
- M3 现有未提交文件未回滚、未覆盖。

## M4 直接验证

| 命令 | 结果 |
|---|---|
| `cargo test -p ielts-domain --locked --offline` | 6 passed |
| `cargo test -p ielts-db --test learner_model --locked --offline` | 5 passed |
| `cargo test -p ielts-application --lib learner --locked --offline` | 1 passed |
| `cargo check -p ielts-db --locked --offline` | pass |
| `cargo check -p ielts-application --locked --offline` | pass |
| `cargo check -p ielts-practice-tauri --locked --offline` | pass with existing M3 warnings; target env supplied for existing M3 `env!("TARGET")` |
| `python developer/tests/ci/check_m4_contracts.py` | pass |
| Vue typecheck/build | pass in integrated static suite |

新增集成测试覆盖：

- same evidence replay/idempotency；
- `mcq` 和 canonical question-kind mapping；
- content-pack mapping priority；
- mapping version migration；
- skill deactivation/no orphan；
- same asset vs new asset weights；
- corrected/still_wrong；
- intervention provenance；
- time decay、uncertainty、distinct asset；
- avoid exact recent assets、novel transfer probe；
- v11 upgrade 连续应用 v12–v15。

## 仓库级门禁状态

`run_static_suite.py` 已按要求运行两次，最新结果为 24/27 pass。3 个失败均来自并行 M3/既有环境，不是 M4 新增检查：

1. Tauri shipping contract 发现并行 M3 的 `tauri-plugin-shell` 依赖/注册；
2. data-truth regression 的两个 v8 history-retention fixture 因当前 M3 `0014` 工作树状态失败；
3. M3 contract boundary 发现并行 M3 的 `tauri.conf.json` `externalBin` 状态。

`suite_practice_flow.py` 已多次运行。launch、Vue routes、UI visuals、reading IPC、Agent IPC boundary 均通过；native Agent workspace picker 因 Windows 系统剪贴板 `failed to open clipboard` 失败，属于已知环境抖动，未触及 M4 路径。

## 风险与后续边界

M4 已验证任务书规定的 vertical slice 合同，但并行 M3 尚未形成干净的全仓 gate；待 M3 agent 收尾后，应重新运行原始两道命令，并确认 `0014`、Tauri bundle/capability 和 history-retention fixtures 的最终合同。此复核不需要改变 M4 数据模型或回滚 M4 代码。

## Round 3 Post-Audit Addendum（2026-08-31）

本报告的历史测试数字仅是当时的阶段证据，不代表当前全仓产品状态。Learner Model 是确定性派生投影，不是心理测量真值；默认 feature flag、真实生产调用链和 M6 产品 Go/No-Go 均需按当前代码、限制和 [Round 3 审计报告](PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md) 单独判断。
