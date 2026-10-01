# ADR-M12: General Agent Thread + Study Planner + Controlled Actions

日期：2026-08-16
状态：Accepted
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M12 章（行 9204-9384）

## Context

M3-M11 让核心个性化学习闭环 + Memory/learner/dream/consolidation/strategy/prompt 演化成熟。M12 把 Agent Workspace 从「调试/显式对话入口」升级为「可以看、问、计划、解释、受控行动的学习控制台」。这是原 v1.0 M2 能力后移（agent thread + checkpoint + planner + controlled actions），不是删除。Python primary / Rust controlled actions。

## Decisions

### D1. Agent Thread 是 run 之上的逻辑容器（M12-01）
M0/M1 `agent_runs`（run-level 审计）保留。M12 `agent_threads`/`agent_messages`/`agent_checkpoints` 是 thread-level 容器：一个 thread 可含多 run，含多轮 message，含 checkpoint 状态机。thread_kind（workspace/study_plan/coach_review/attempt_review）。create/list/archive；sequence；summary slot；thread-level context scope。

### D2. Checkpoint / Cancellation 是 durable 状态机（M12-02）
`agent_checkpoints` stage enum：context_built→model_response→tool_before→tool_after→waiting_approval→final。cancellation token + cancel request DB；restart 后 interrupted thread 经 `restart_recovery` 标 interrupted（借鉴 M7 background_jobs startup_recovery）。**read-only tool safe replay；write tool never automatic replay**（M12-02 核心：write tool 重启后需 approval，不自动重放）。

### D3. Workspace 不是 Memory engine 本身（M12-03）
Workspace 只查询/计划/受控行动。Memory engine 是 M3-M8；Workspace 消费其 read tools + context，不重复实现 Memory 逻辑。

### D4. Study Planner 第一版只做 proposal（M12-04）
输入：user goal/available time/skill review needs/learner uncertainty/recent workload/user preferences/target date。输出 proposal：今天练什么/为什么/用什么 skill probe/预计多久。deterministic constraints（priority→uncertainty→target_date 距离→skill_key；时间约束；heavy week 0.5 折减；每 item ≥5min；≤8 items）。no-LLM path + fail-closed。

### D5. Skill probe 非重复原题（M12-05）
`SkillProbe` 只携带 skill_key + probe_kind + avoid_asset_ids，绝不携带原题 asset/question id。参考 TechSpar `get_due_reviews()` 思想但选 skill probe not exact question；不复制 process-local task_status。

### D6. Controlled Action Gate 三层（M12-06）
- allow（create_study_plan_draft/mark_plan_item_done/archive_memory_with_user_confirmation/set_explicit_preference）：执行，无需 approval。
- approval-gate（bulk_archive/reset_derived_memory/change_personalization_settings/modify_long_term_plan）：需 approval，pending→approved 后执行。
- forbidden（direct_sql/arbitrary_filesystem/api_key_read/production_prompt_mutation/schema_migration/silent_delete_history）：永不提供；reverse-RPC tool.invoke 显式拒绝。

### D7. Embeddings 不为架构完整强上（M12-07）
M5 lexical+FTS 已满足 retrieval goldens（M5-11 eval soundness）→ 不接 embedding。M12 确认此判断。若启用：derived index + model signature + rebuild + user setting + no canonical semantics。

### D8. Rust 拥有 controlled actions authority；Python 拥有 planner orchestration
Python planner 产 proposal 提交 `study_plan.create`；Rust 持久化 + 分配 planId。Python 不直接写 canonical truth（no bypass）。reverse-RPC `thread.create`/`thread.append_message`/`thread.list`/`thread.save_checkpoint`/`approval.list`/`approval.decide`/`study_plan.create`/`study_plan.list_items`/`study_plan.mark_done`（v1）。

## 当前限制
- Vue AgentWorkspacePage 升级（Slice 3 UI：thread list/message flow/tool trace/context trace/memory refs/cancel-retry/approval card/study plan panel）未做完整升级——现有 416 行原型保留，新 capabilities 通过 Tauri commands 暴露供前端消费。Workspace DoD 通过 Rust/Python contract + 既有原型达成，未做 full UI E2E（与 M3-M11 一致）。
- planner 未做 live model E2E（deterministic constraints 验证）。
- checkpoint/cancellation 的 child retry run 是 contract 就绪，未在 AgentService::run 核心 loop 完整 wire-up（不破坏现有 run loop）。

## Capabilities（供 Python 对齐）
- `thread.create`/`thread.append_message`/`thread.list`/`thread.save_checkpoint` v1 + `approval.list`/`approval.decide` v1 + `study_plan.create`/`study_plan.list_items`/`study_plan.mark_done` v1（均 daily-dream-v1 feature）。

## 产品默认工作区决策（2026-10-01，覆盖历史目录选择流程）

- 用户已确认默认使用可执行文件安装目录下的 `agent-workspace`；不能实际写入时，自动回退到应用数据目录下的同名子目录。无需选择目录，不请求提权；现有内容不清空，也不自动迁移。
- `agent_get_workspace` 由 Rust 解析固定路径并签发 15 分钟、进程内授权，无调用方路径输入。仅授予专用子目录，不授予整个安装目录或 app data。默认根目录的符号链接和 Windows junction 被拒绝。
- 控制台进入时自动初始化，每次运行前自动续期；目录只作信息展示。文件工具既有相对路径、越界拒绝和 SHA-256 并发保护不变。
- Packaged E2E 的临时对象是完整隔离的安装目录和 app data，不是要求用户选择的产品工作区；真实 IPC、文件读取和 SQLite trace 保留。
- 这是工作区默认路径的产品决策，不代表线程 checkpoint、历史 catch-up 或 M6-M12 产品闭环已经完成。
