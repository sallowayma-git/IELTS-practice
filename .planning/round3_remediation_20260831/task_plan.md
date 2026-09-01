# Round 3 对抗审计倒序整改计划

## Goal

依据 `developer/docs/PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md`，从修复路线图第 15 项倒序处理真实 P0/P1 缺陷；每个变更保持 Tauri 2 + Rust canonical authority + Python derived runtime 边界，并按仓库要求运行两道回归门。

## Order

1. [completed] 路线图 15-11：冻结 v1.3、建立 `developer/docs/INDEX.md`、补 drift 检查与 gate-report 语义。
2. [in_progress] 路线图 10-8：strategy/evolution 门、prompt overlay、coach/dream dispatch 接线。
3. [in_progress] 路线图 9-5：启动 catch-up、Context/eval/run-id、archive/FK/dream candidate 数据结构修复。
4. [pending] 路线图 4-1：Coach token ceiling、Dream 调度与三处安全绕过收口。
5. [pending] 全量证据核验、文档/规划同步、静态套件与 packaged E2E。

## Constraints

- 保留用户已有未提交修改；只改本次整改涉及文件。
- 子代理只做定位、对抗核验和建议；主代理负责修改、取舍和最终验证。
- 每批最多并发 2 个子代理；返回后立即关闭。
- 每次功能改动后依次运行 `python developer/tests/ci/run_static_suite.py` 与 `python developer/tests/e2e/suite_practice_flow.py`。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `rg.exe` 无法启动 | 历史 | 使用 PowerShell 原生检索；不重复该命令 |
