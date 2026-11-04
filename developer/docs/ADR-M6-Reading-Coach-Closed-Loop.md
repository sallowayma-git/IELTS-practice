# ADR-M6: Reading + Coach First Closed Loop

日期：2026-08-16
状态：Accepted
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M6 章（行 7875-8186）

## Context

M6 是 Agent 自进化项目的第一个产品级 P0 gate：证明从 Reading attempt 到 Coach explanation 再到用户反馈与下一次改进的完整闭环。M1-M5 已经铺好了 event ledger、observation projection、memory core、learner model、retrieval/context materializer，M6 把它们接进 AttemptReview run 并补上 Coach feedback / strategy provenance / outcome link 三条交互事实。

## Decisions

### D1: Rust baseline fallback + Python shadow → canary → default

现有 Rust `CoachService` / `LanguageModel` baseline 不重写、不删除。`PythonPersonalizedCoach` 走 shadow（frozen input 并行评估，不展示用户）；通过质量/安全/延迟/失败恢复 gate 后进入小比例 canary；通过 canary 后可成为复杂 Coach default。sidecar unavailable / protocol mismatch / cognitive timeout / 空 model 输出 → 非致命 fallback（`fell_back=True` + `fallback_reason`），Rust baseline 接管。

禁止长期维护 `RustPersonalizedCoachV2 == PythonPersonalizedCoachV2` feature parity。维护的是"一套产品 contract + 两条不同复杂度 execution lane"。

### D2: 复用 AttemptReview，不新建 Agent

M6-01：不创建 `ReadingAgentV2` / `MemoryAgent` / `ReviewAgent2`。在现有 `AgentRunKind::AttemptReview` run 上增加三个 bounded read-only tool（M6-02），把 learner model / memory / cognitive read 接进同一 run。`LearningReadTools` 持有 `&AppDb`，execute 内构造 `ApplicationStore` 委托对应 service —— 保持 `new(db)` 签名不变，最小化破坏面。

### D3: feedback ≠ preference

M6-05 canonical coach feedback（thumbs_up / incorrect / need_example / ... / style_correction）是用户交互事实。单次 `need_example` 是 observation，不是 preference。M6-07 preference candidate extractor 只产 candidate（`preference.coach.*`），candidate 通过既有 memory candidate 提交路径持久化为 PENDING。promotion 是单独的 Rust-owned gate，需要 repeated signal + later better outcomes。`context_preview` 只返回 explicit preference 和 active memory，不返回 pending candidate —— 测试 `feedback_is_fact_not_preference_and_candidate_stays_pending` 断言此不变量。

### D4: satisfaction ≠ learning

M6-10 outcome link 把 satisfaction（thumbs_up 等交互反馈）和 learning（later skill observation confirms skill moved）放在不同行。`coach_outcome_links_v0` 的 `outcome_kind` 列区分 `satisfaction` / `learning`。一个 thumbs-up 永远不能当作学习效果。测试 `satisfaction_and_learning_outcomes_are_on_separate_rows` 断言两条 outcome 在不同行、引用不同 evidence、但都连回同一个 strategy assignment。

### D5: TechSpa drill 闭环参考，拆成三条 projection

TechSpa `topic_drill.py` 做到了"评估 → weak point → spaced repetition → profile update → next question generation reads profile"。IELTS 保留闭环，但把"写 profile"拆成 observation / memory / learner state 三条不同 projection：
- **observation**（M2）：每次 attempt 的 per-skill outcome，是 derived projection（可重建）。
- **memory**（M3）：candidate → pending → promoted active preference，有 promotion gate。
- **learner state**（M4）：weighted-beta skill mastery + uncertainty + review scheduling。

三条 projection 不可混用：observation 是事实层，memory 是候选/确认层，learner state 是聚合层。strategy assignment 的 outcome 只连 future observation（事实层），不直接写 memory 或 learner state。

### D6: 三个 M6-02 工具 read-only / bounded / schema-strict / 64KiB / sensitivity filter

`get_learner_skill_state` / `search_active_memories` / `get_memory_evidence` 复用 `encode_application_result`（与 `encode_result` 同构，只是 error 类型从 `DbResult` 变 `Result<_, ApplicationError>`）。每个工具：deny_unknown_fields 参数 schema、audit summary 不复制正文、64KiB ceiling、底层 store 已有 sensitivity filter + bounded。

## 当前限制

1. **shadow 未 canary**：`PythonPersonalizedCoach.evaluate_shadow` 走 shadow 路径，但尚未进入 canary / default。Rust baseline 仍是唯一用户可见 Coach。
2. **未 live model E2E**：与 M3/M5 stage gate 一致，M6 product gate 用 FakeStore 验证闭环数据流，不验 live model 质量。真实 provider E2E 不在本会话范围。
3. **preference candidate promotion 自动化未实现**：candidate 持久化为 pending 后，promotion 仍需 Rust-owned gate 手动触发。M6-07 只产 candidate，不自动晋升。
4. **outcome link 到 future observation 的时间窗未约束**：M6-10 只记录 linkage，不校验时间先后（future_observation_id 引用的是 derived projection，在 rebuild 后才存在）。

## Consequences

- AttemptReview run 现在有 7 个 read-only tool（原 4 + M6-02 三工具），registry 测试从 4 更新为 7。
- `ATTEMPT_REVIEW_SYSTEM_PROMPT` 更新为描述 M6-03 Reading Review Context 优先级（CURRENT ATTEMPT → RELEVANT HISTORY → PERSONAL MEMORY → TEACHING PREFERENCE）。
- M6 product gate 测试（7 tests）证明闭环数据流：feedback 是事实不自动变 preference、satisfaction ≠ learning、re-ask linkage exact、strategy assignment 含 contextSnapshotId、outcome link 连到 future observation。
- 仓库级门禁 27/27 不回归。

## 修订（2026-11-04）：outcome link 已移除

上文 D4、"当前限制" 第 4 条以及 Consequences 中涉及 M6-10 outcome link 的内容描述的是历史设计，不是现状。`coach_outcome_links_v0`（迁移 0017 创建、0024 修外键）已由迁移 `0036_drop_coach_outcome_links.sql` 删除，连同 `coach_link_outcome` 命令、`LinkCoachOutcomeCommand` / `CoachOutcomeLinkRecord` / `CoachOutcomeKind`、`link_coach_outcome` 持久化函数和 `CoachFeedbackStore::link_coach_outcome` 端口。

**原因**

- 没有任何写入者。唯一的入口 `coach_link_outcome` 在 DB 层始终失败（fail-closed）：宿主没有可信的「教练回答 -> 之后某条观察」的归属证据（context 快照与教练线程、作答之间没有宿主拥有的绑定），所以拒绝授权任何新链接；它也从未出现在 webview 的 capability 白名单里。表里只有读取方（观察重建时的保存/恢复、备份校验），没有数据。
- 因果归因本身不可靠。「教练回答之后某个技能观察变好了」无法区分是教练的功劳还是重做、遗忘曲线或题目难度；把它存成链接只会给下游一个看似可信的伪证据。
- D4 的不变量（满意度 != 学习效果）并不依赖这张表：满意度是 `coach_feedback` 的事实，学习结果是观察层的事实，两者本来就在不同的表里。

**替代方案**

- 策略满意度直接联结：`coach_strategy_assignments_v0.coach_message_id = coach_feedback.coach_message_id`（每条助手消息至多一行策略、至多一个裁决反馈），不需要中间表。
- 周报的 `afterCoach`（重做前是否问过教练的计数对比）是确定性 SQL，不读这张表，原样保留。它只报告计数对比，不声称因果。
- 若以后确实需要「策略 -> 学习效果」，应在有宿主拥有的归属证据之后重新设计，而不是复活这张表。

**兼容性**

- 迁移 0036 是 `DROP TABLE IF EXISTS`，可重复执行；该表是纯子表（引用 `coach_strategy_assignments_v0` 与 `learner_observations`，没有视图、触发器、外键指向它），其两个索引随表删除。迁移前快照（`backups/pre-migrate-*.db`）保留原行。
- 用旧版本导出的、含该表的备份包（格式 <= 22）仍可恢复：该表列入备份模块的 `DROPPED_TABLES`，恢复时接受并忽略（不校验列、不建表、不要求存在）；新导出的备份不再包含它。测试：`crates/ielts-db/tests/backup_release_history.rs` 中 `backups_exported_before_migration_0036_restore_without_the_outcome_link_table`、`the_ignored_outcome_link_table_is_not_validated_against_the_current_schema`；迁移测试 `migration_36_drops_the_outcome_link_table_and_its_rows_with_foreign_keys_on`。
- 随之删除的测试：`satisfaction_and_learning_outcomes_are_on_separate_rows` 与 outcome link 相关的 DB 层测试（`coach_outcome_link_fk.rs`、`coach_feedback.rs` 中的 fail-closed 用例）；M6 product gate 的完整闭环测试缩短为 Attempt A -> B（feedback、strategy assignment、pending candidate）。
