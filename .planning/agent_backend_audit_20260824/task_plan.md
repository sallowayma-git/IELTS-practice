# Task Plan: Backend Agent Architecture Audit + Fix

## Goal

修复后端 Agent 调用链(P0),让前端能消费正确的产品级读 API。Plan v1.3 ch.14/17/21 为实现权威;Rust 拥有真相/工具/持久化,Python 拥有认知编排。

## Current Phase

All phases complete (2026-08-30 session). 遗留: per-stage checkpoint(前置 thread-scoped run)、Memory Catalog 分页/详情、17.8 其余命令、事件通道 17.9。

## Phases

### Phase 1: Concurrent audit against v1.3 plan
- [x] Four parallel read-only subagent audits (A/B/C/D)
- [x] Synthesize findings; rank by severity / userspace risk
- **Status:** complete

### Phase 2: Architecture decisions
- [x] Freeze what we fix this session vs defer
- [x] Canonical contract = Rust serde shape (authority produces it honestly); Python strict model mirrors it, keeps extra="forbid" guard. NO translation layer — one shape, both sides validate.
- **Status:** complete

### Phase 3: P0 fixes
- [x] **3.1 JournalFacts 契约**: Python model 改为 Rust 形状 (writingEvalSummary{completed,degraded,averageBand}, skillDeltas[{skillKey,delta,evidenceCount}], memoryChanges=counts 对象, memoryEvents 列表; 删 activity/taskTypes/todayCandidateIds); daily_dream.py 消费 memory_events; Python 测试同步。
- [x] **3.2 dream.run_daily**: 响应改 {runId,accepted,rejected,failed}; 严格解析提案(拒绝数可见,不再 filter_map 丢弃); run 生命周期 insert→start→record→finish/fail。
- [x] **3.3 journal job 台账**: journal_rerun/dream_run_daily claim 刚入队那条,真实工作完成后再 finish/失败。
- [x] **3.4 正向 dream 入口**: Python dispatch 增加 dream.daily → DailyDreamOrchestrator; Rust 增加 run_daily_dream() 正向调用; dream_run_daily 命令驱动 sidecar。
- [x] **3.5 取消链路**: CancellationToken 进 AgentService loop; agent_cancel_run 命令; 取消写 interrupted checkpoint。
- [ ] **3.6 真实 checkpoint**: AgentService 六阶段每阶段落一行 agent_checkpoints。
- [x] **3.7 Planner 可达**: Python dispatch 增加 planner.study_plan → StudyPlanOrchestrator; Rust 正向调用 + AgentService 接线。
- **Status:** complete

### Phase 4: Product read APIs + UI consumption
- [x] **4.1 memory_catalog_list**: 死代码 MemoryCatalog 消灭;含 evidence_observation_ids + 读路径 sensitivity 过滤;UI 20 行适配器接入。
- [x] **4.2 plan_id 数据源**: study_plan_get_latest(死代码 StudyPlanSnapshot 消灭)+ study_plan_run 生成计划;不再拿 thread id 当 plan id。
- [x] **4.3 Since Last Visit 判定保留**: localStorage 是 M9-06 有意设计的 view marker(纯 UI 状态);since 后端参数属 Memory Catalog 读面扩展,P2。
- **Status:** pending

### Phase 5: Verification
- [x] `python developer/tests/ci/run_static_suite.py` → 27/27
- [x] `python developer/tests/e2e/suite_practice_flow.py` → 16/16(release 二进制重编含新前端)
- **Status:** pending

### Phase 6: Delivery
- [x] Report Core Verdict / what changed / what was deferred
- **Status:** pending

## Frozen constraints

- Product host is Tauri 2 + Rust domain/SQLite. Do not revive Electron/Fastify.
- Do not rewrite M1/M2 frozen schemas.
- Do not "fix" the UI by dumping more JSON; fix the backend contracts the UI should call.
- Keep existing E2E selectors for workspace `agent_run` working (userspace).
- EvaluatingPage.vue 冻结。
- No git commit unless user asks.

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
|       |         |            |
