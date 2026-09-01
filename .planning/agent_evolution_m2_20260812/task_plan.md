# IELTS Atlas Agent Self-Evolution M2 Execution Plan

## Goal

在 M0/M1 已完成的事实基线上，依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.1_Post_M1_TechSpar.md` 完成 M2 的最小可交付实现，不把 M3+ Memory/Dream/Learner Model/Context Compiler 行为提前混入，并保持现有 Tauri/Vue/Rust/SQLite 用户合同不回归。

## Scope guard

- M2 只实现总任务书明确的 M2 范围与 DoD。
- Rust/SQLite 是持久化事实源；不恢复 Electron、Fastify、file:// 或前端 durable storage。
- 每个切片先简化数据结构，再消除特殊情况，最后用 characterization/regression tests 冻结兼容行为。
- 任何改动完成后按仓库要求依次运行：
  - `python developer/tests/ci/run_static_suite.py`
  - `python developer/tests/e2e/suite_practice_flow.py`

## Phases

- [completed] P0. 完整读取总任务书，提炼 M2 契约、边界、依赖和 DoD
- [completed] P1. 核验 M0/M1 实际落地状态并建立 M2 缺口矩阵
- [completed] P2. 冻结最小数据结构、事务/幂等/兼容合同与测试切片
- [completed] P3. 实现首个 M2 最小垂直切片
- [completed] P4. 运行定向测试与仓库规定的全量门禁
- [completed] P5. 复核变更、更新文档证据并交付

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `rg.exe` failed to start with access denied | 1 | 改用 PowerShell `Select-String`/`Get-Content` 读取；不重复执行同一 `rg` 命令 |
| Four narrow audit agents timed out after 180s without a result | 1 | Closed them and continued with direct targeted reads; no code change was blocked |
| Windows linker lock / 120s test timeout | 1 | 改用 `cargo test --workspace --jobs 1` 且提高超时；全量 workspace 最终通过 |
| Packaged E2E native picker transient timeout before final snapshot | 3 | 未改动 E2E harness；最终代码快照重新构建并完整通过 |

## Decision Log

- 2026-08-12：M2 使用独立 scoped planning 目录，避免覆盖既有 M1/仓库清理计划。
- 2026-08-12：TechSpa 只作为总任务书指定的 R1/反例参考：可看 Extract 前处理、session lifecycle、备份安全；不移植其 FastAPI/React、LLM profile update、进程内锁或 JSON 快照耦合。
- 2026-08-12：M2 首个切片固定在 `ielts-db` 的 `0013` derived tables + deterministic projector/rebuild/verify，再由 application/Tauri 暴露 developer-only commands；不新增用户画像 UI。
- 2026-08-12：复核后将 Reading repeat 排序固定为 ledger payload 的 `attemptOrdinal` + attempt ID，避免相同时间戳下依赖随机 event ID；三类 v1 payload 改为 typed schema 校验，Writing degraded 只输出稳定 category。
- 2026-08-12：历史删除/retention 在同一事务内调用 M2 rebuild，确保删除中间 attempt 后相邻 repeat transition 与完整 ledger 重算一致；rebuild 仅删除本 projector/version 的 derived rows。
