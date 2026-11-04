# Coach / Soul / Memory 闭环审计（2026-11-04）

基线：`IELTS-WRITING-FEAT` @ `996f323f`（含 #256、#257）。结论以代码和测试为准。

## 事实基线（与旧 ADR 的差异）

- M10 教学策略进化与 M11 Prompt/Skill 注册表的 Rust 实现、表（迁移 0033）均已删除；`ContextMaterializerService`、`PromptModule::CoreSoul` 不在当前树里，`crates/ielts-application/src/context_soul_policy.txt` 无任何读者。ADR-M5/M10/M11 描述的是历史设计，不是现状。
- 现在的 Soul 是 `soul.*` 显式偏好（称呼、昵称、语气、目标分、考试日期、留言）加只追加审计 `soul_revisions`；周报生成时模型最多提出两项带证据、可撤销的编辑（`soul.companionNotes`、`soul.toneSuggestion`）。没有任何流程改写学习者设置的字段。
- 教练每条回答都由宿主写一行 `coach_strategy_assignments_v0`，策略恒为 `evidence_first_v1`（常量），没有选择与变体；`coach_outcome_links_v0` 没有写入者（已删除，见下）。

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

- 教练策略恒为 `evidence_first_v1`，`memory_ids_used` 与反馈没有被任何读者联合使用：策略级别的效果评估（M10）没有输入也没有读者。`coach_outcome_links_v0` 没有写入者、因果归因不可靠，已由迁移 0036 删除（见 ADR-M6 末尾的修订）；策略满意度今后直接联结 `coach_strategy_assignments_v0.coach_message_id` 与 `coach_feedback.coach_message_id`。`afterCoach` 是不依赖这些表的确定性替代，但只是计数对比。
- 没有 Prompt Registry 与教练提示词的评测/发布流程（M11 已删除）；教练系统提示词在 `coach.rs` 里以常量字节断言。
- `context_soul_policy.txt` 无读者；Soul 策略层（CoreSoul）在当前树里不存在，周报的 `profileEdits` 是唯一由模型写 Soul 的路径，字段受限、可撤销。
- 阅读复盘代理（`readingAttemptReviewV1`，默认关）的 `search_active_memories` 仍是另一套记忆视图（含待核实候选），没有 Soul。
- 重复追问只在题目级判断，没有跨文章按题型/技能聚合。
- 教练反馈（点赞/太长等）没有投影成观察，只能用该次作答的得分观察作为证据。

## 第一阶段：笔记分层与近期信号

动机：教练的 `teachingNotes` 只存在 assistant 消息的 payload 上，只有每周一次的周整合会读，学习者今天说过的偏好/困惑下一个线程完全不知道。参考「当日工作层（今天和昨天自动加载）」的思路，第一阶段只做读取时切片，不写任何记忆，所以「长期记忆只由周整合写」这条不变量不变。

### 笔记新增字段（可选，向后兼容）

- `scope`：`profile`（关于学习者本人，跨题有价值）｜`question`（只关于当前题或这段原文）。缺省/非法 = `profile`。`question` 笔记只随消息存档：不进近期信号、不出偏好卡片（也不计入同一技能困惑 ≥2 次的累计）、不进周包与周报的教练事实。
- `horizon`：`session`｜`recent`｜`durable`。缺省/非法 = `recent`。第一阶段只有一个效果：`session` 不进跨线程近期信号。过期与晋升用它是第三阶段的事。
- 非法取值只丢该字段，不丢整条笔记；旧笔记反序列化再序列化字节不变。优先级不由模型声明。
- 定义只有一处：`ielts_domain::teaching_note`（`TeachingNoteScope` / `TeachingNoteHorizon`，缺省与解析）；写入校验在 `teaching_notes.rs`，读取方（卡片、周包、近期信号）都用同一份缺省。

### 近期信号（`ielts_db::recent_signals`，由 `build_coach_system_context` 调用）

- 窗口：`RECENT_SIGNAL_WINDOW_DAYS = 2`（第二阶段改名为 `RECENT_SIGNAL_RECENT_DAYS`，并为 `durable` 增加 14 天窗口），所有线程的已完成 assistant 消息，`now` 可注入（`build_coach_system_context_at`）。
- 纳入：`scope != question`、`horizon != session`、`kind` 为 `preference` / `difficulty` / `strategy_outcome`、文本过 `is_safe_for_prompt` 且 ≤ 200 字符；该消息的 `memoryCardState` 为 `dismissed`（学习者说不要记）或 `confirmed`（已成真正的记忆）则整条消息排除。
- 去重：同一 `(kind, skillKey)`（无 skillKey 则按规范化文本）只留最新一条。
- 优先级由宿主推导：`remember` 最高；其次窗口内同一 `(kind, skillKey)` 出现次数多者；最后按新近。至多 `RECENT_SIGNAL_MAX = 4` 条；顺序确定（同分时按消息时间、消息 id、笔记序号）。
- 形状：`LearnerProfileSnapshot.recent_signals`（`recentSignals`，空则不序列化），条目 id 为 `signal:<messageId>:<noteIndex>`，不以 `mem-` 开头，所以不计入 recalled memory、不增加 `recall_count`。
- 冻结：与画像其余部分一起在新线程首轮冻结；已冻结的旧画像 JSON 没有该字段，读取与重新序列化字节不变；无信号的学习者看到的画像字节与改动前一致（只有标签文字多了一段说明，已有线程会有一次前缀缓存失效）。
- 预算：仍受 `PROFILE_TOKEN_BUDGET` 约束，缩减顺序为 `recent_signals` → `memories` → `weak_skills` → `preferences`（信号最不确定，最先丢）。
- 标签：`signal:` 条目是学习者最近两天对教练说过的话的未确认观察，弱于 `preference`/`soul`，只用来调整讲解侧重点，不当作已确认事实，不复述给学习者。
- 不写任何记忆表，无迁移、无新表、无新增写路径。

### 同步改动

- 教练提示词「笔记规则」段补充 `scope` / `horizon` 定义与判断示例（默认只有跨题有价值的信号才写笔记）；整段仍 ≤ 1500 token 断言。
- 评测语料（`developer/tests/tools/coach-eval/`）每条期望带 `scope`，适用时带 `horizon`；补了 question 类与 profile/durable 类用例；评分器新增 `scope`、`horizon` 两项指标（question 类消息写出的笔记必须是 question 范围）。

### 仍未做

- ~~第二阶段（预整合落库）~~：评估后取消，由下面的「第二阶段：统一信号汇总」取代（不落库）。
- 第三阶段（周整合的晋升与遗忘）：周整合读取 `horizon` / `scope`，让 `durable` 信号优先晋升，`recent` 过期，`session` 不进周包；周整合提示词本阶段未改。
- 近期信号依赖模型自己正确声明 `scope`：写错成 `profile` 的题目级笔记仍会进入信号（但最多 4 条、只存活 2 天；只有带卡片的笔记才能被学习者一键否决）。评测语料的 `scope` 指标用来观察这一风险。

## 第二阶段：统一信号汇总（signal digest）

目标：同一批 `teachingNotes` 有三个读者，各自解析、各自过滤，规则会慢慢漂移。第二阶段把它们收敛成**一个读取函数 + 一个汇总函数**，让「当日工作层」（去重、计数、定优先级、按 horizon 定有效期）成为一个确定性的纯函数，并让第三阶段的周整合直接拿到带复现计数的输入。

### 为什么不落库

- 落库的「工作层」要么放宽「长期记忆只由周整合写」的不变量，要么变成又一张和笔记本身重复的表，需要同步、过期与撤销；而汇总只依赖笔记，重算的结果与存储的结果一样，却没有任何要保持一致的东西。
- 所以：**不新增迁移或表，不写 `memory_items`，不新增写路径，不调用模型**。学习者在卡片上确认/拒绝（`memoryCardState`）仍是唯一影响笔记是否参与汇总的输入。

### 单一来源：`ielts_db::coach_signal_digest`

- `payload_notes(payload)`：一条 payload 里的笔记的唯一接受规则。非数组/非对象条目、未知 `kind`、空 `text` 跳过；`scope = question` 永不读取（缺省/非法 = `profile`）；`horizon` 缺省/非法 = `recent`；`text`、`skillKey`、`strategy` 去首尾空白。
- `read_coach_notes(conn, NoteRange)`：已完成 assistant 消息中某时间段的全部笔记，每条带 `message_id`、`note_index`、`asset_id`（线程的 asset，否则所属 attempt 的 asset，都没有则空）、`attempt_id`、`created_at`、`card_handled`。JSON 容错：非 JSON 载荷、非数组 `teachingNotes` 不贡献任何笔记。
- `coach_signal_digest(conn, now, SignalWindows)`：窗口内的汇总，排除 `session`、排除所在消息 `memoryCardState` 为 `dismissed`/`confirmed` 的笔记、文本须 `is_safe_for_prompt` 且 ≤ 200 字符（跳过不截断）。按 `(kind, skillKey)`（无 skillKey 则规范化文本）聚合为 `SignalDigestEntry`。

### `SignalDigestEntry`

| 字段 | 含义 |
|---|---|
| `kind`、`skill_key`、`text` | 取最新一条笔记 |
| `remember` | 任一条为 true |
| `horizon` | 取最长（`Durable` > `Recent`），不会是 `Session` |
| `repeat_count` | 贡献它的**不同回答消息**数（同一条回答里说两遍只算一次） |
| `distinct_assets` | 不同 asset（passage）数，没有 asset 的线程不计 |
| `first_seen` / `last_seen` | 贡献它的回答的最早/最晚时间 |
| `source_message_ids` | 至多 3 个，最新优先 |
| `best_message_id` / `best_note_index` | 最新那条笔记的位置（画像里的 `signal:<id>:<index>`） |

排序确定：`remember` 降序 → `repeat_count` 降序 → `last_seen` 降序 → `best_message_id` 升序 → `best_note_index` 升序。

### 窗口

- `RECENT_SIGNAL_RECENT_DAYS = 2`：`horizon = recent`（默认）的有效期，与第一阶段一致。
- `RECENT_SIGNAL_DURABLE_DAYS = 14`：`horizon = durable` 的有效期。「以后都先讲结论」这类稳定偏好在周整合晋升之前一直可见，不会两天后从教练视野里消失。
- `session` 永不进汇总；`scope = question` 永不进汇总。

### 三个读者

- 教练近期信号切片（`recent_signals`）：变成 digest 的前 `RECENT_SIGNAL_MAX = 4` 条，id `signal:<best_message_id>:<best_note_index>`，statement 为最新文本。预算最先丢、冻结画像字节兼容、空窗口字节不变，与第一阶段一致。**有意变化**：`repeat_count` 按不同回答消息计（第一阶段按笔记计）；同分同时间的平局按消息 id、笔记序号升序（第一阶段是笔记序号降序）；`durable` 笔记活 14 天。
- 偏好卡片（`coach/cards.rs`）：解析与 `scope` 判断改用共享读取；「同技能困惑近 30 天 ≥ 2 个回答」的累计原语义不变（30 天窗口，不受 horizon 影响，`session` 笔记仍计入），只是由原来的一条 SQL 改成对共享读取结果在内存里数不同回答。卡片的文本只要求非空，不套信号的安全/长度规则。
- 周包与周报教练事实（`weekly_report/coach_facts.rs`、`weekly_pack.rs`）：改用共享读取，保留周内特有的映射（`outcome` → `helped`/`not_helped`，文本清洗并截断到 200 字符而非跳过）。周包输出逐字节不变（前后对照运行，见提交说明）。

### 仍未做

- 第三阶段（周整合的晋升与遗忘）：周包带上 `repeat_count` / `distinct_assets` / `first_seen` / `last_seen`，周整合据此决定晋升（多个回答、多篇文章、跨天复现者优先；`durable` 优先）与遗忘（`recent` 过期、`session` 不进周包）；周整合提示词本阶段未改，周包格式未变。
- 教练画像标签仍写「last two days」，实际 `durable` 信号可活 14 天；标签文字单独精简，本阶段未动。
