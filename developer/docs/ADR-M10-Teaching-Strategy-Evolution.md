# ADR-M10: Teaching Strategy Evolution / Procedural Memory

日期：2026-08-16
状态：Accepted
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M10 章（行 8845-9038）

## Context

M6 让 Coach 记录用了什么解释形式；M10 把「用户喜欢什么回答」与「什么讲解方式真的提升这个用户后续学习表现」分开。这是 IELTS Atlas 超越 TechSpar 当前画像闭环的核心阶段。满意度（thumbs/reask）不能证明教学策略有效；只有后续 learning outcome（novel skill attempt improves / writing revision / corrected behavior / transfer）才能。

## Decisions

### D1. Strategy catalog 固定 8 策略（M10-01/08）
v1 catalog：M6 的 6（evidence_first/example_first/step_by_step/contrastive/socratic_prompt/concise_direct）+ error_then_rule_v1 + rule_then_example_v1。每条定义 applicable activity/skill kind/prompt module/contraindications/max verbosity/version。LLM 不可自创 strategy；可 propose candidate（落 strategy_candidate_batches pending），但 promotion 需开发者定义 prompt_module + 离线 eval，不直接 executable（M10-08）。

### D2. 两个 reward channel 分表（M10-03）
- satisfaction channel（teaching_strategy_feedback）：thumbs_up/thumbs_down/reask/explicit_correction/abandon。
- learning channel（teaching_strategy_outcomes）：next_novel_skill_attempt/next_writing_revision/corrected_repeated_behavior/transfer_to_another_asset。
两 enum disjoint（Python 测试验证）；thumbs-up 永不进 learning 轴；不能跨表归因。

### D3. Delayed outcome window（M10-04）
assignment at T0 → within next N relevant skill observations → prefer novel asset → compute outcome。window 按 relevant observation 计数（非墙钟）；irrelevant skill observation 不消耗 window slot；超 window → OutOfWindow（不记 effectiveness claim，不惩罚 strategy）。same-asset repeat → DISCOUNTED_SAME_ASSET（不 credit learning，停止扫描）；novel asset + relevant skill → ATTRIBUTED。

### D4. user_strategy_state per-user per-scope（M10-05）
strategy×scope 统计：success_count/failure_count/satisfaction_count/reask_count/novel_transfer_success/last_used/confidence。confidence = bounded formula success/(success+failure) clamped [0,1]；零证据 → 中性先验 0.5；satisfaction count 不 inflate confidence。不做全局 RL。

### D5. Selection 规则优先（M10-06）
explicit preference（M10-07，仅 contraindication 覆盖）> contraindication filter > proven personal（confidence > 0.5 且证据充足）> default > exploration slot（仅证据充足 + allow_exploration 时，Rust 强制 10% cap）。无证据时不 exploration。

### D6. Preference vs effectiveness 冲突尊重 explicit（M10-07）
用户喜欢 direct 但 evidence-first 效果更好时：**尊重显式偏好，不暗中切换**。emit candidate suggestion（标 `candidate_suggestion_only`，不 auto-promote M10-08）+ 解释 why。产品不以「系统更懂你」强制切换。

### D7. Candidate promotion gate（M10-08）
LLM candidate strategy 落 strategy_candidate_batches pending；Rust 受控 evaluator 只接收 batch identity，从已持久化候选内容计算结构/开发者模块约束并写入 verdict，IPC 调用方不能提交 `passed` 或 `metrics`；promotion 仍需最新通过 eval + 开发者定义 prompt_module，且不直接 executable。复用 M8 consolidation validator 的 stable-ID + eval-gated promotion 模式。该 evaluator 是结构安全门，不冒充 M11 的真实效果评测。

### D8. Rust 拥有 promotion + selection authority；Python 拥有 evaluation orchestration
Python strategy_eval 做 delayed outcome attribution + 2 channel 聚合 + confidence + selection 候选打分；Rust strategy.select/record_*/user_state 是 authority（持久化 + 10% exploration cap 跟踪）。Python 不直接写 active memory（no bypass）。

M10 candidate evaluation 的持久化入口只允许 `batchId`。Rust 在同一事务内读取 batch、执行固定版本的结构 evaluator、生成 `passed`/`metrics` 并写入 `strategy_candidate_evaluations`；旧的 caller-supplied verdict payload 不属于有效协议。

## 当前限制
- shadow/canary 未跑：strategy effectiveness 是 offline-estimated，未在真实用户上做 longitudinal canary（与 M3-M9 一致：验 contract/protocol/persistence 边界 + 确定性测试）。
- 未做 live model E2E。
- exploration cap 是 Rust 强制的 10% 常量，未做 contextual bandit。
- candidate strategy evaluator 目前是 Rust 固定版本的结构安全门，不是效果评测；M11 prompt/skill eval 的受控数据集与 grader 仍是实际效果评测入口。

## Capabilities（供 Python 对齐）
- `strategy.select` v1 / `strategy.record_assignment` v1 / `strategy.record_feedback` v1（satisfaction）/ `strategy.record_outcome` v1（learning，仅 attributed verdict）/ `strategy.user_state` v1。
