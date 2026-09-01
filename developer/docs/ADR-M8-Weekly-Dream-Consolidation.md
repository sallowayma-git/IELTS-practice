# ADR-M8: Weekly Dream + Cross-scope Pattern + Memory Consolidation

日期：2026-08-16
状态：Accepted
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M8 章（行 8396-8666）

## Context

M7 Daily Dream 完成后，引入跨题型/跨文章/跨时间的可证伪学习模式发现。这是 TechSpar Stage 3 对我们价值最大的部分：从分散低层 observation/memory 发现 cross-scope pattern。但必须比 TechSpar 更强地保留 evidence identity、并发安全和 promotion gate。M8 是 Python orchestration / Rust promotion gate。

## Decisions

### D1. Stable-ID validation，不复制 TechSpar index-based support（M8-02）
TechSpar consolidation 用 `supporting_wp_indices` 并在 LLM 返回后通过文本检查列表是否变化（`memory.py:1634`）。IELTS 给 LLM stable `mem-*` IDs + summaries，LLM 返回 `supportingMemoryIds`，Rust validator 从 DB 重新加载这些 IDs（不信任 LLM index），hallucinated ID → 整条 pattern 拒绝（M8-01 宁可 0 pattern）。

### D2. 四条 pattern gate + 宁可 0 pattern（M8-01，R2 clean-room）
保留 TechSpar `memory.py:1590-1705` 四 gate 思想：跨≥2 独立 scope/topic、抽象层次高于原 observation、有用户未显式意识到的新价值、可被未来证据证伪。系统 prompt 编码「prefer zero over wrong」。Python 侧预校验，Rust 重验（双 gate）。

### D3. 保守阈值，config 化（M8-03）
默认：min_supports=3、min_new_evidence=3、min_distinct_assets=2、min_distinct_scopes=2（cross-cutting）、cooldown=6d。不复制 TechSpar 数值；config 化供 longitudinal fixtures 调整。

### D4. Pattern 类型固定 5 种，禁止诊断类（M8-05）
允许：cross_skill_strategy/metacognitive_pattern/behavior_pattern/stable_learning_preference/recurrent_language_pattern。禁止 medical/personality/intelligence/mental_health。DB CHECK + Rust enum + Python allow-list 三重校验。新跨领域高阶 pattern 留 M8 已覆盖（cross_skill_strategy/metacognitive_pattern）；TechSpar 的「更高阶」实际不需额外类型。

### D5. Consolidation 不物理删除，保留 lineage + 可 reverse（M8-06，§23.17）
`apply_consolidation`：新建 consolidated memory（source_class='consolidated'），每个 support 插入 `memory_relations(support→consolidated, supports_consolidation)` + 标 superseded（不删除）。保留 statement/mutation history/supersedes_id。归档也不删除。

### D6. Independent evidence（M8-04）
同一题连做 3 次不算 3 个独立 support。diversity 用 `subject_key`（asset identity）+ scope + namespace 判定。

### D7. Improvement/regression propagation（M8-07，不文本匹配 supports）
`propagate_support_change(memory_id, new_status)`：support improve → pattern confidence decay（×0.7，不删除）；all supports refuted → pattern archive。按 stable memory_id，不按文本匹配（TechSpar `memory.py:965` 的反模式）。

### D8. Stale archive per-kind policy（M8-08，R2 clean-room）
`archive_stale`：per-kind policy（behavior=fast/21d、strategy=medium/60d、knowledge+language=slow/120d、preference=never_auto、goal=validity_driven）。policy 存 `memory_capacity_state` 表，可 replayable。归档不删除（status='archived'）。

### D9. User feedback backend（M8-09，stable memory_id）
`record_memory_feedback(memory_id, kind)`：6 种 kind（accurate/inaccurate/partially_accurate/outdated/not_about_me/acknowledged）。`inaccurate` 是强 contradiction，触发 M8-07 decay，但**不删 learning facts**（只记 feedback 行）。`outdated`/`not_about_me` archive 不删除。

### D10. Predicted hypothesis 禁止自动 promotion（M8-10）
`source_class='predicted'` 的 support 直接 reject（`predicted_only_support`）。必须有 observed support 才能晋升 active learner belief。

### D11. Rust 拥有 promotion gate；Python 只产 candidate
Python Weekly Dream 只产 `PatternProposal` candidate 提交给 `dream.run_weekly` reverse-RPC；Rust validator 重验 + apply。Python 从不直接写 active memory（no bypass）—— consolidation 通过 `apply_consolidation` 写新 consolidated memory，promotion 走 M3 路径。

## TechSpar clean-room 边界
- R2：借 `memory.py:1590-1705` 四 gate 思想，不复制 index-based support（D1）、不复制 process-local task_status（M7）、不复制 mutable profile.json truth。
- R2：`memory.py:965` decay 思想保留，但不按文本匹配 supports（D7，用 stable ID）。
- R2/R3：`memory.py:1492 apply_pattern_feedback` 思想保留，用 stable memory_id（D9）。

## 当前限制
- `memory.candidate_pool` reverse-RPC 当前 sample reading activity slice（bounded pool）；full cross-activity pool 是 M9 diagnostic surface。
- weekly dream 未做 live model E2E（与 M3/M5/M6/M7 一致：验 contract/protocol/persistence 边界 + 确定性测试）。
- archive policy 是基线，未跨数据量验证。
- `dream_runs.scope` 列未添加（改用 background_jobs.job_kind 区分 weekly/daily；ALTER TABLE ADD COLUMN 非幂等，省略以保 migration replay-safe）。

## Capabilities（供 Python 对齐）
- `dream.run_weekly` v1 — 入参 `{query: WeeklyDreamQuery{userId, journalId}, patterns: PatternProposal[]}`，出参 `WeeklyDreamResult{runId, query, report, receipts}`。
- `memory.candidate_pool` v1 — 入参 `{window: string}`，出参 `{candidates: [{memoryId, key, pendingVerification}], truncated}`。
- 复用既有 v1：`model.invoke`（weekly pattern discovery LLM）、`dream.run_daily`/`journal.build_daily`（M7）。
