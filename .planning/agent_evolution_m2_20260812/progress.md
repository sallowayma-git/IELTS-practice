# M2 工作进度

## 2026-08-12

- 已收到用户对 M2 启动的明确确认。
- 已读取 `planning-with-files` 技能说明，并执行 session catch-up；无未同步上下文输出。
- 已检查现有 planning 目录，确认没有现成 M2 计划。
- 已创建本 M2 scoped plan、findings 和 progress 文件。
- 已记录 `rg.exe` 启动失败，后续改用 PowerShell 读取。
- 已完整读取总任务书至 EOF（实际 10,463 行），并保存 M2 精确范围、迁移、测试、DoD 和回滚要求。
- P0 已完成；下一步：并行核验 M0/M1 代码和测试落地状态。
- 已收到一份有效的 application/domain 审计：现有 learning event search 有默认 50 条限制，不适合作为完整 projector reader；建议复用现有 domain DTO，增加独立 reader port 和纯 projector。
- 第二轮四个窄审计探子在 180 秒内未返回结果，已关闭；改为主代理直接读取即将修改的具体代码，避免继续盲等。
- 已完成 M1 migration/ledger/domain/application/Tauri/feature wiring 读取；确认 TechSpa 只有 R1/反例参考价值，没有可移植 M2 实现。
- P1 已完成；P2 冻结为 `0013` 三表、独立全量 ledger reader、确定性 Reading/Writing/Coach candidates、事务化 rebuild、只读 verify、developer-only Tauri commands。
- 已实现首个 M2 垂直切片：迁移 v13、共享 Reading transition helper、deterministic observation projector、rebuild/verify reports、application port/service、Tauri developer-only commands 和 feature flag。
- M2 定向测试 11/11 通过；Tauri `developer-tools` 编译通过。
- 初次 workspace 测试发现旧 phase3 migration 断言仍写死 v12，已更新为 v13；串行 `cargo test --workspace --jobs 1` 全部通过。
- 已补 ledger `content_hash` 校验：合法 JSON 但 hash 不匹配同样 quarantine。
- 独立复核发现并已修复：相同 occurred_at 的 repeat transition 不再按随机 event ID 排序；Reading/Writing/Coach payload 改为 typed schema + envelope/source 一致性校验；Writing degraded 不再保留 provider 自由文本，只映射稳定 category；observation feature 显式依赖 ledger feature。
- 历史 `delete_attempt`、bulk delete、clear history、retention prune 均在所属事务内重建 M2 projector；新增真实 attempt→learning_event→FK cascade 的中间 attempt 删除测试，`verify` 保持一致并生成 A→C transition。
- 新增同时间戳 ordinal golden、合法 JSON 但 hash 损坏、字段结构损坏、private/restricted quarantine、degraded category 与 exact output hash 断言；M2 专项 7/7、M1/迁移专项 6/6 通过。
- 最终门禁：`cargo test --workspace --jobs 1` 全部通过；`python developer/tests/ci/run_static_suite.py` 18/18 通过；`python developer/tests/e2e/suite_practice_flow.py` packaged-tauri-2 完整通过（launch、IPC、workspace agent、reading submit、backup、updater、sqlite restart 全部 passed）。
