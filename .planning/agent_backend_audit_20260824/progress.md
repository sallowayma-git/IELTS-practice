# Progress Log

## Session: 2026-08-28 (Claude takeover, interrupted)

### 修复 JournalFacts 编译阻塞（Phase 1 前置）

- **Status:** complete
- Root cause: zcode 半成品——`ielts-domain` 的 `JournalFacts` 新增 `today_observation_ids`/`memory_events`，但 `ielts-db` 四处构造点、`insert_journal` 落盘、`daily_source_hash`、三处测试 fake 均未落地。
- Fixes applied in working tree:
  - `crates/ielts-db/src/journal.rs`: `build_daily_facts` 聚合两新字段（当日 obs-* ID 上限 512；memory_events JOIN memory_items 排除 private/restricted 敏感度，`past_tense_change_kind` 映射 operation→过去时）；`insert_journal` facts_json 落盘新字段；`daily_source_hash` 纳入新字段
  - `crates/ielts-db/src/consolidation.rs`: 测试补 `DEFAULT_MIN_SUPPORTS` import（半成品遗留）
  - `ielts-application` 两处 + `ielts-db` 测试 fake 补字段
- Verification: journal 13/13, application 120, Python 契约 59, 静态套件 27/27, packaged E2E 16/16（exit 0）
- 会话在「Read 截图视觉核验」处因 API 400 中断（网关不支持 image block）。用户指示：后续跳过视觉核验、不上传图片。

### 已发现未修复：Rust↔Python JournalFacts 契约分叉

- Python strict 模型期望 `writingEvalSummary.attempts`/`skillDeltas[].skill`，Rust 序列化产物是 `completed`/`skillKey`；Python 侧还有 `todayCandidateIds` 而 Rust 发 `todayObservationIds`。中间缺翻译层（`journal.build_daily` 原样序列化）。需在审计中确认严重度。

## Session: 2026-08-29 (Claude takeover, current)

### Phase 1: Concurrent audit

- **Status:** in_progress
- 上下文恢复自 jsonl + 规划文件；工作树与 8-28 会话结束一致。
- 四路只读审计子代理启动：Rust loop / Python sidecar / memory-context / M12 threads。
- 用户约束：跳过视觉核验（不上传/读取截图）。

## Session: 2026-08-30 (handoff execution: P0 contract + wiring)

详见 task_plan.md Phase 3/4 与本节要点。按顺序完成:

### 3.1 JournalFacts 契约对齐 ✅
- 规范形状 = Rust serde;Python strict 模型镜像,保留 extra="forbid"。**零翻译层**。
- types.py 重写:WritingEvalSummary{completed,degraded,averageBand}、SkillDelta{skillKey,delta,evidenceCount}、memoryChanges=counts、新增 JournalMemoryEvent(memoryEvents cap128);删 activity/taskTypes/todayCandidateIds。daily_dream.py 消费 memory_events。Python 425 全绿。

### 3.2 dream.run_daily 三处断链 ✅(handoff 只记了一处)
1. 参数:Python `{day,proposals}` vs Rust `params["query"]`→DailyDreamQuery 必炸
2. 响应:`{run,candidates}` vs Python `{runId,accepted,rejected,failed}`
3. `filter_map(ok())` 静默吞坏提案
- 修复:按 day 解析 + journal 解析/补建(FK)+ 严格解析计 rejected + insert→start→record→finish/fail 生命周期 + output_hash(SHA-256)。DreamStore 补 start_dream_run;record_proposals 返回 (candidates, rejected)。

### 3.3 job 台账诚实化 ✅
- 新增 `claim_job_by_id`;命令 claim 刚入队那条,工作完成后 finish/失败 fail_job。删 Rust weekly_dream job_kind(CHECK 必炸)。

### 3.4 正向 dream 入口 ✅
- Python `dream.daily` dispatch(+hostCapabilities 存 handshake)+7 测试;Rust `run_daily_dream()`;`dream_run_daily` 命令重写为 async:诚实台账 + AgentRunKind::Dream 审计(消灭"无创建方")+ 驱动 sidecar。签名改 `{userId, day}`;UI 同步。
- RunAuditGuard 提为共享 `app/run_audit.rs`(drop 状态参数化,保持 memory 的 Interrupted 语义)。

### 3.5 取消链路 ✅
- AgentCancelToken 进 loop(round 边界 + 每个 tool call 前);取消落 Interrupted + retryable `agent.run_cancelled`;测试验证模型未被触达。
- `AgentCancelRegistry` + `agent_cancel_run` 命令;agent_run 接受客户端 runId;UI 生成 uuid + 「取消运行」按钮。

### 3.6 每阶段 checkpoint — 判定延期 ⚠️
- agent_checkpoints FK 强制 thread_id,而全仓没有任何 thread-scoped run(agent_send_message 不存在)→ 无消费者,先造 = 死代码。前置:14.5/14.6 Tool Gateway + thread-scoped run。

### 3.7 Planner 可达 ✅(又发现两处断链)
- `study_plan.create`:参数(`{proposal}` vs `params["command"]`)+ 响应(StudyPlan `id` vs Python `planId`)全错。重写:PlannerProposalWire 翻译(skillProbe 结构→skill_probe 字符串),响应 `{planId,accepted}`。
- Python `planner.study_plan` dispatch;`run_study_planner()`;`study_plan_run` 命令。

### 4.x 读 API + UI ✅
- `study_plan_get_latest`(死代码 StudyPlanSnapshot 消灭):plan 面板不再 thread id 当 plan id。
- `memory_catalog_list`(死代码 MemoryCatalog 消灭):含 evidence_observation_ids(证据抽屉活)+ **读路径 sensitivity 过滤**(补 P1 漏网点)。UI 用 20 行 catalog→entry 适配器,readers 零改动。
- 生成计划按钮接 study_plan_run + 重读快照(persisted item id 才能勾选)。

### Verification
- 静态套件 **27/27**;Python 425;前端 vite build OK;release 构建 + E2E 待跑。
