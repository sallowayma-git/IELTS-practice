# Coach / Soul / Memory 闭环审计（2026-11-04）

基线：`IELTS-WRITING-FEAT` @ `996f323f`（含 #256、#257）。结论以代码和测试为准。

## 事实基线（与旧 ADR 的差异）

- M10 教学策略进化与 M11 Prompt/Skill 注册表的 Rust 实现、表（迁移 0033）均已删除；`ContextMaterializerService`、`PromptModule::CoreSoul` 不在当前树里，`crates/ielts-application/src/context_soul_policy.txt` 无任何读者。ADR-M5/M10/M11 描述的是历史设计，不是现状。
- 现在的 Soul 是 `soul.*` 显式偏好（称呼、昵称、语气、目标分、考试日期、留言）加只追加审计 `soul_revisions`；周报生成时模型最多提出两项带证据、可撤销的编辑（`soul.companionNotes`、`soul.toneSuggestion`）。没有任何流程改写学习者设置的字段。
- 教练每条回答都由宿主写一行 `coach_strategy_assignments_v0`，策略恒为 `evidence_first_v1`（常量），没有选择与变体；`coach_outcome_links_v0` 没有写入者。

## 发现与处理

| 问题 | 证据 | 处理 |
|---|---|---|
| 教练画像直接读原始偏好表：已清空的 Soul 字段以 `soul.message: null` 泄入提示词；学习者自己的 `soul.tone` 和普通偏好被「5 条 + 按键名排序」截掉；`predicted` 假设不带标记进入提示词 | 对同一库的对照运行：旧 `select_learner_profile` 输出 `soul.message: null` 且丢掉 `soul.tone` 与普通偏好；新入口见 `tests/system_context.rs` | `ielts_db::build_coach_system_context`：Soul 经 `soul_profile` 校验后进入，学习者语气优先于模型建议，模型备注标注为「系统观察」；偏好槽位与 Soul 分开；排除 `predicted`；`preference/goal/strategy` 记忆排在知识类事实之前 |
| 周包的教练行只能引用「该次作答的得分观察」，教学笔记生成的记忆无法回溯到原话；教练观察命名空间 `coach` 无法作为证据（校验快照直接报 `unsupported observation activity namespace coach`） | `tests/teaching_note_chain.rs`（去掉映射后该测试失败） | 教练行的 `ids` 先放学习者原消息的 `coach.question.asked` 观察（仅当笔记引文确实出现在该消息里）；`coach` 观察计为阅读证据；`memory_coach_sources` 反查 memory → 学习者消息 id / 回答 id / 线程 / attempt / 引文 |
| 周报教练信号只数「点了反馈/重问」的练习；只聊天不点赞则整块不出现；教学笔记完全不进周报；没有任何「问过教练之后结果如何」的信号；`reask_same_question` 反馈行与重问链接双计数 | `tests/coach_signals_week.rs` | 新模块 `weekly_report/coach_facts.rs` 统一教练输入：提问数（自动复盘不算）、校验后的教学笔记（与周包同一接受规则）、同一题被问 ≥2 次、对每道重做的旧错题标记「重做前是否问过教练」。满意度与学习结果分字段，不声称因果。事实带 `assetIds` 以便叙事和 Soul 编辑引用 |
| 周整合不知道怎么对待教练行 | 提示词无相关规则 | 提示词：明确的教学愿望可成一条 `preference` 记忆；`strategy` 记忆需要同一策略在两篇不同文章上同结果；纯反馈行不是偏好 |
| 模型自己写出的 `preference/goal` 记忆受保护、永不被其他命名空间挤掉，可累积到占满 128 条 | `tests/memory_preference_capacity.rs` | 学习者本人与宿主策略的记忆不受影响；模型派生的 `preference/goal` 超过 32 条后，新增者先归档同池里价值最低的一条（原因 `capacity`） |

## 教练接线（需要合并者在教练提示词装配处完成）

1. `crates/ielts-db/src/coach/profile.rs`：`select_learner_profile` 的函数体换成 `crate::system_context::build_coach_system_context(conn, PROFILE_USER_ID)`，并删除不再使用的私有 `explicit_preference_rows`、`memory_rows`、`weak_skill_rows`、`accept`、`fit`。本分支已验证：替换后 `coach_learner_profile`、`coach_trace` 现有测试全部通过。
2. `crates/ielts-application/src/coach.rs` 的 `build_request`：画像消息改为 `ielts_db::coach_profile_message(profile)`，删除 `LEARNER_PROFILE_LABEL`。标签文字变了，已有线程会有一次前缀缓存失效。

## 仍存在的缺口

- 教练策略恒为 `evidence_first_v1`，`coach_outcome_links_v0` 没有写入者，`memory_ids_used` 与反馈没有被任何读者联合使用：策略级别的效果评估（M10）没有输入也没有读者。`afterCoach` 是不依赖这些表的确定性替代，但只是计数对比。
- 没有 Prompt Registry 与教练提示词的评测/发布流程（M11 已删除）；教练系统提示词在 `coach.rs` 里以常量字节断言。
- `context_soul_policy.txt` 无读者；Soul 策略层（CoreSoul）在当前树里不存在，周报的 `profileEdits` 是唯一由模型写 Soul 的路径，字段受限、可撤销。
- 阅读复盘代理（`readingAttemptReviewV1`，默认关）的 `search_active_memories` 仍是另一套记忆视图（含待核实候选），没有 Soul。
- 重复追问只在题目级判断，没有跨文章按题型/技能聚合。
- 教练反馈（点赞/太长等）没有投影成观察，只能用该次作答的得分观察作为证据。
