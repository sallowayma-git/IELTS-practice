# ADR-M4-01: Learner Model v1 与 Skill Review Scheduler

状态：Implemented / feature-gated  
日期：2026-08-13  
范围：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 的 M4

## 决策

M4 由 Rust domain + SQLite projection 持有 canonical derived learner state。M4 只消费 M2 的 `learner_observations` 和 canonical `learning_events`，不让 Python/RAG、Vue 或 Agent 直接写 learner state。

迁移顺序固定为：

```text
0012 learning event ledger
0013 learner observation projection
0014 memory profile core (M3)
0015 learner model v1 (M4)
```

`0015_learner_model_v1.sql` 创建并 seed 五个 M4 边界：`skill_catalog`、`question_skill_map`、`learner_skill_observations`、`learner_skill_state`、`skill_review_schedule`。

## 数据与所有权

- `skill_catalog` 是 versioned、curated taxonomy；`model_proposed` 永不直接 active。
- `question_skill_map` 记录 `builtin`、`content_pack`、`manual`、`model_proposed` 来源与 mapping version。确定性 question-kind fallback 以 builtin provenance 落库。
- `learner_skill_observations` 是从 M2 observation/event replay 的可删除重建投影，stable ID 由 event、skill、mapping version 和 source fingerprint 决定。
- `learner_skill_state` 和 `skill_review_schedule` 是 M4 derived rows；rebuild 会清理并重建它们，但不会删除 taxonomy/map 配置。
- intervention 只作为事件/观察 provenance 回链，不被解释为因果证明。

## 算法

对每条 skill observation 使用透明 weighted Beta：

```text
w = mapping_weight × evidence_weight × novelty_weight × familiarity_weight × time_weight
alpha += w × outcome
beta  += w × (1 - outcome)
mastery_mean = alpha / (alpha + beta)
uncertainty  = 2 / (alpha + beta)
```

posterior 会按配置的 half-life 向中性先验 `(1, 1)` 衰减。熟悉度权重按同 asset 的 `<12h`、`12–72h`、`>72h`，以及新 asset 分档；缓存键包含 `user_id`，避免用户之间污染。

Scheduler 按任务书的 weakness、uncertainty、overdue、recency gap 权重生成 `SkillReviewNeed`，同时返回 `avoid_asset_ids`、reason codes、supporting observation IDs 和 probe 类型。状态解释保留 recent outcomes、repeat/novel 计数、transition、error type 与 intervention IDs。

## 适配层与回滚

- application 层将生产 bounded read port 与 developer-only rebuild/verify port 分离。
- Tauri commands 受 `learner-model-v1` Cargo feature 约束；Vue 的 `VITE_FEATURE_LEARNER_MODEL_V1` 默认 `false`，关闭时不注册 learner route/nav。
- rollback 方式是关闭前端 flag、停止调用 learner commands，或回退 migration 前的应用版本；M4 rows 可由 full rebuild 删除/重建，M2 ledger/observation 不受影响。
- 未增加 filesystem、shell 或 process capability；M4 不引入 Python DB 路径。

## 验证与限制

已覆盖：replay idempotency、`mcq`/question-kind mapping、content-pack 优先级、mapping version、skill deactivation、same/new asset discount、corrected/still_wrong、time decay、uncertainty、distinct assets、intervention link、avoid-asset scheduler、v11→v15 upgrade 和 state full verify。

当前明确限制：M4 是可解释的启发式 posterior，不是心理测量真值；不会从一次样本断言人格或能力事实；delayed outcome 只保存可回链 provenance，不能声称策略因果；复杂 semantic skill enrichment 留给后续受审计的 content/model proposal 流程。

## 结果

M4 的最小完整 vertical slice 已落地：schema → deterministic projection → weighted state → scheduler → bounded Tauri read → feature-gated Vue surface → replay/integration/static checks。M3 并行工作树中的合同失败和 E2E 系统剪贴板失败均不属于 M4 代码路径，已记录在 session progress 中，未通过回滚处理。
