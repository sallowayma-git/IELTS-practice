# M6→M1 修复回执（主线程集成前）

## 01a0fd53-26a3-7e01-b36a-664a1aee1ba3
【核心判断】✅ 已修复，仅修改 [cognitive_runtime.rs](<F:/workspace/IELTS Atlas APP/src-tauri/src/cognitive_runtime.rs:382>) 及内部测试。

【关键洞察】

- ActiveRun 权限由 host 发起方法绑定，sidecar 无法自选。
- MemoryCandidate 禁止 Weekly、apply、审批决定及策略晋升。
- Daily／Planner 使用最小权限；未知方法在 DB／provider 路由前拒绝。
- Weekly 能力广告已撤下；保留 learnerWire、planner probe、candidate pool 现有修改。

【Linus式方案】实现完成并通过定向验证：

`cargo test -p ielts-practice-tauri --lib cognitive_runtime:: --locked`

结果：**23 passed，0 failed，42 filtered out**；新增 5 个权限测试。framed fixture 直接调用生产预路由门禁，未启动 fake-sidecar 子进程。

未解决依赖：Weekly 的受控 host 入口尚未接通，继续关闭。未运行完整 static/E2E、真实 provider 或提交推送。

## 01a0fd53-2556-7493-a601-0a6a9dc1f98c
【核心判断】✅ 已修复 corpus 冒充 `EXPLICIT_USER` 等可信来源的问题，仅修改授权两文件。

【关键洞察】

- [context.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-application/src/context.rs:446>)：`reading_asset`／`writing_topic` 仅允许 `RETRIEVED_CORPUS`；非法归属在裁剪前拒绝。
- [context_materialization.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-application/tests/context_materialization.rs:104>)：真实 SQLite／corpus DTO 验证非法请求零 snapshot／item 写入，并覆盖任务、Soul、scope、rank、budget、render。

【Linus式方案】定向验证完成：

`cargo test -p ielts-application --test context_materialization`：**19 passed，0 failed**。`git diff --check` 通过。

未解决依赖：生产 host 需调用 `with_current_task(...)` 注入可信任务；真实偏好引用合同缺失，保持 fail closed。未派生子代理、运行完整 static/E2E、调用真实 provider 或提交推送。

## 01a0fd53-2346-7350-9b2e-45d87eb55948
【核心判断】✅ 已修复：损坏或 quarantine 事件不再返回为 canonical，明确进入 `missing_ids`。

【关键洞察】仅修改授权文件：

- [learning_observations.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/learning_observations.rs:154>)：共享 hash／语义／schema／quarantine／sensitivity 判定。
- [cognitive_read.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/cognitive_read.rs:458>)：证据出口执行同一判定，保留现有读取逻辑。
- [cognitive_read 测试](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/cognitive_read.rs:128>)：覆盖真实提交→篡改→隔离、writing band 越界、坏 JSON、restricted、恢复重放及合法非投影事件。

【Linus式方案】已完成实现与定向验证：

`cargo test -p ielts-db --test cognitive_read --test learning_observations`

结果：**6 + 11 项通过，0 失败**；`git diff --check` 通过。未解决依赖：无。未派生子代理、运行完整 static/E2E、写共享报告或提交推送。

## 01a0fd53-242a-72f1-8f30-dc191f1aabdd
【核心判断】✅ 三项 M4 P1 已修复。

【关键洞察】

- 同 attempt 各题共享首次／重复权重；交换题 ID 不改变权重。
- builtin 按各 ledger 事件题型归属，TFNG→MCQ 重导入保留新旧证据；active curated 优先。
- 复习读取支持固定 `asOf`，旧调用默认当前时钟；空闲逾期提高 priority，重放 `state_hash` 保持确定性。

【Linus式方案】修改仅涉及 [DB learner.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/learner.rs>) 和 [learner_model.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/learner_model.rs>)，保留 expected26、freshness、wire 代码，未新增迁移。

验证：`cargo test -p ielts-db --test learner_model` **14 passed，0 failed**；包含真实生产提交／重导入 fixture 和 rebuild/verify。定向 `git diff --check` 通过。

未解决依赖：无。本轮未运行完整 static/E2E，未写共享报告。

## 01a0fd53-28e9-7fb1-8611-793748708e4a
【核心判断】已完成授权范围修复，定向测试 19/19 通过。

【关键洞察】

- [DB 实现](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/coach_feedback.rs:139>)：重问要求 assistant→user、同线程、序号和时间递增、local 用户；合法重试幂等，普通 follow-up 不自动标记。
- v0 outcome 缺少可信 snapshot/scope→Coach thread/attempt 绑定，现明确 fail-closed，拒绝所有新增归因；反馈、策略记录仍支持。
- [真实 API fixture](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/coach_feedback.rs:260>) 覆盖真实消息追加、阅读提交与投影。
- [domain 限制说明](<F:/workspace/IELTS Atlas APP/crates/ielts-domain/src/coach_feedback.rs:261>) 已补充。

【Linus式方案／验证】

- `cargo test -p ielts-db --lib coach_feedback::tests`：11 passed，0 failed。
- `cargo test -p ielts-db --test coach_feedback`：8 passed，0 failed。
- 限定文件 `git diff --check`：通过。

未解决依赖：可信归因绑定，以及 satisfaction observation projector。未来同技能新资产的成功归因尚不支持，未借用 M10 宣称覆盖。未运行完整 static/E2E、写共享报告或触碰 UI／canonical Coach。

## 01a0fd53-27d0-7452-b364-7ddd0ba801da
【核心判断】✅ 已修复旧 observation 反复制造改善／复发的问题。

【关键洞察】

- [memory.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/src/memory.rs:1047>)：统一 REINFORCE／IMPROVE／REGRESS 门禁，要求实际新增目标证据，且 `observedAt` 严格晚于已有证据。
- [memory_profile_core.rs](<F:/workspace/IELTS Atlas APP/crates/ielts-db/tests/memory_profile_core.rs:705>)：贯通真实提交→投影→生产 validator→promotion，覆盖改善、复发、旧观察复用及混合证据插入失败。拒绝时五张相关表完整不变。

【Linus式方案】已实施并完成定向验证：

- `memory_profile_core`：18 passed，0 failed。
- 级联失效专项：1 passed，0 failed，41 filtered out。
- `git diff --check`：通过。

仅修改上述两文件；保留归档／遗忘／cascade 补丁及其他 dirty 改动。未解决依赖：无；历史证据投影缺失时会拒绝采纳，需恢复投影。测试使用独立 target 目录，未运行完整 static／E2E 或写共享报告。


