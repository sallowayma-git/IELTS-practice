# Round 3 对抗审计倒序整改计划

## Goal

依据 `developer/docs/PLAN_V1.3_ADVERSARIAL_AUDIT_ROUND3_REPORT.md`，从修复路线图第 15 项倒序处理真实 P0/P1 缺陷；每个变更保持 Tauri 2 + Rust canonical authority + Python derived runtime 边界，并按仓库要求运行两道回归门。

## Order

1. [completed] 路线图 15-11：冻结 v1.3、建立 `developer/docs/INDEX.md`、补 drift 检查与 gate-report 语义。
2. [in_progress] 路线图 10-8：strategy/evolution 门、prompt overlay、coach/dream dispatch 接线。
3. [in_progress] 路线图 9-5：启动 catch-up、Context/eval/run-id、archive/FK/dream candidate 数据结构修复。
4. [in_progress] 路线图 4-1：已有 ceiling 和敏感入口修复；必保留输入超限、weekly 语义隔离/sensitivity/version 门仍待修。
5. [in_progress] 全量证据核验、文档/规划同步、静态套件与 packaged E2E（按批次验证，不代表整改整体完成）。

## Current batch (2026-10-01)

- [completed] 固定默认 Agent 工作区：用户已接受安装目录优先、app data 自动回退；移除手动选择，自动初始化/续期，拒绝 junction。host lib 54/54、静态 28/28、四屏宽 4/4、新 release packaged 18/18（同时核验 M11 authority 收口）。

- [completed] 六路只读核验，真实 prompt DTO 修复。
- [completed] recovery 事务、重复窗口去冲突、终止失败不自动重置预算；16 条后台任务回归已接静态门。
- [completed] 静态套件 28/28、Python 431、DB 全库测试、journal lifecycle 6/6。
- [completed] packaged E2E 16/16；匹配驱动重跑使用刚构建、同 SHA256 的 release。
- [pending] 下一批：可信 prompt eval 与 production overlay；历史 catch-up 生产消费、coach/weekly dispatch。仅补入队不能宣称路线 9 端到端完成。

## Constraints

2026-10-01 用户已接受并已实现：Agent 默认使用安装目录下的 agent-workspace，不可写时自动回退到应用数据目录下的同名子目录，无需目录选择。不提升权限、不授权整个安装目录。host 固定路径、UI 自动短期授权续期和真实 packaged 回归通过；只表示本批通过，不表示整体审计整改完成。

- 保留用户已有未提交修改；只改本次整改涉及文件。
- 子代理只做定位、对抗核验和建议；主代理负责修改、取舍和最终验证。
- 每批最多并发 6 个只读探子，显式不复制历史；派发后主线程等待全部返回，逐个关闭，30 分钟未完成时介入。
- 每次功能改动后依次运行 `python developer/tests/ci/run_static_suite.py` 与 `python developer/tests/e2e/suite_practice_flow.py`。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| 工作区批次静态门 27/28，host LNK1104 | 2026-10-01 | 定向 Agent 测试与静态重链接共用 exe 产生短暂锁；定向 20/20 已结束，改为串行重跑静态，再跑 packaged，不删文件或杀进程 |
| `rg.exe` 无法启动 | 历史 | 使用 PowerShell 原生检索；不重复该命令 |
| Cargo offline 缺 cc v1.2.67 等缓存 | 2026-10-01 | 按现有 Cargo.lock 联网获取后测试通过，无锁文件变更 |
| 两个猜测源码/ADR 路径不存在 | 2026-10-01 | 用 rg --files 定位实际 app/application_store.rs 与大小写命名 ADR，未修改错误路径 |
| Packaged E2E EdgeDriver 150 / WebView 154 会话创建失败 | 2026-10-01 | 用既有 install_edge_webdriver.ps1 在唯一临时目录获取并验证微软签名的 154.0.4258.48 驱动，通过 TAURI_NATIVE_DRIVER 单次覆盖后重跑 |
| 新 M11 定向测试首次链接 LNK1104 临时 exe 锁 | 2026-10-01 续 | 未删除/杀进程，下一条定向编译成功；再跑精确测试名 |
| 新 M11 原子性回归失败，eval_runs 残留 1 条 | 2026-10-01 续 | 修复前预期红灯，证实 run_eval 非事务写入 |
| 新 M11 latest-failed 回归仍可获批 | 2026-10-01 续 | 修复前预期红灯；记账始终更新 Proposed/EvalPassed 后 16/16 通过 |
| 新 packaged 首轮 Agent 工作区 wait 超时 | 2026-10-01 续 | 四写入口 not-found 与 read 正向已通过；补明确阶段、picker/按钮诊断，重跑；不放宽断言/不称全绿 |
| Packaged picker 第二轮错误选择 Documents | 2026-10-01 续 | 新诊断确认测试助手未进入临时目录；限定 staged exe 对话框，直接写已验证地址控件并等待导航，移除全局剪贴板依赖，保持主路径断言 |
