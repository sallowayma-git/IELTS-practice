# 发现

## 当前生产链路复核结论（主代理完整阅读任务书 + 六探子 + 关键点抽查）

### 核心判断 / 品味评分

🔴 组件完整度高于产品闭环完整度。用户“链路缺很多”的体验有源码依据；M6 No-Go 不能解除。不是全部实现无效：事实写入、按需 observation freshness、M3候选治理、权限闭锁、默认工作区、取消/中断恢复是真实实现。

最危险的现行用户问题是“归档”执行遗忘删除；最关键的闭环问题是 M4 不自动刷新与 Coach 绕过个性化路径。下述路径相对项目根；每个负面断言限定探子搜索过的 production src，不推断用户已有数据库内容。

| 优先级 | 生产断点 | 证据（file:line / 符号） | 最短整改方向 |
|---|---|---|---|
| P1 | “归档”实际脱敏正文并删除证据，承诺可查看归档是错的 | `apps/writing-vue/src/views/AgentConsolePage.vue:485` forgetEntry→forgetMemory；`crates/ielts-db/src/memory.rs:573` forget_memory，581 deleted/[deleted]，598删除memory_evidence | archive与forget使用不同操作；遗忘必须明确不可恢复及确认 |
| P1 | 新提交写events，M2按需freshness，但M4读取只load_stored_states，无生产自动rebuild调用 | `crates/ielts-db/src/reading/attempt.rs:330`；`crates/ielts-db/src/cognitive_read.rs:119`；`crates/ielts-db/src/learner.rs:164`；管理入口`src-tauri/src/commands/learner.rs:40` | 统一版本化projection维护/读取freshness，先保证真实新作答改变状态 |
| P1 | 用户Reading Coach仍baseline，未消费Memory/Learner/Context；前端任意questionContext放入system | `apps/writing-vue/src/api/practice-client.js:295`→`src-tauri/src/commands/enrichment.rs:179`→`crates/ielts-application/src/coach.rs:68,94,100`；`useReadingCoach.ts:381`手组装submitted/score/answers | Rust按thread→attempt→asset取canonical输入；现有Coach编排接Python增强shadow/canary，保留baseline |
| P1 | Python Coach/retrieval/weekly/eval类有代码，无inbound生产编排；reverse RPC服务不等于生产调用 | `agent-runtime-python/src/ielts_agent/runtime.py:75`仅memory/dream.daily/planner业务分支；`src-tauri/src/cognitive_runtime.rs:1129`是reverse handler | 先统一契约再沿具体场景接线，不机械暴露所有类为RPC |
| P1 | corpus跨语言manifest、query envelope、sensitivity合同不一致；Coach learner请求/响应也不同 | Rust `crates/ielts-domain/src/corpus.rs:16` vs Python `retrieval/types.py:112`；`retrieval/corpus_sync.py:81` vs `src-tauri/src/cognitive_runtime.rs:1215`；`coach/personalized_coach.py:300,405` vs host1280 | 一份真实wire schema，直接将Rust序列化输出喂Python测试，mock不能替代互操作 |
| P1 | ContextPack除Soul只有目录头，没有canonical正文；模型网关没有强制snapshot关联 | `crates/ielts-application/src/context.rs:156,351` render_context；`crates/ielts-db/src/context.rs:69`；`src-tauri/src/cognitive_runtime.rs:2109` invoke_model | 保留授权正文；按实际渲染文本预算/hash；受约束调用引用host snapshot |
| P2 | retrieval_index_registry/retrieval_runs/llm_invocations只有schema未找到生产写入 | `crates/ielts-db/migrations/0016_context_retrieval_trace.sql:39,51,69`；`src-tauri/src/ai/runtime.rs:75`；搜索crates/src-tauri/Python生产src | host持久化可信run/context/index/invocation成功及失败trace |
| P1 | daily漏日恢复入队已经实现，但无消费worker；旧日queued不自动完成 | `src-tauri/src/lib.rs:35,45`明确not spawn worker；`crates/ielts-db/src/background_jobs.rs:343`；`src-tauri/src/commands/journal.rs:55`按id内联 | 一个受控worker复用claim/lease/retry与既有journal/dream逻辑，验收完成而非仅queued |
| P1 | daily dream_candidates独立pending表无审批桥； accepted仅存储不表示active | `crates/ielts-application/src/dream.rs:73`→`crates/ielts-db/src/dream.rs:103,348`；M3 `memory.rs:918`读取不同表 | 转换到统一候选validator/审批状态机，证据与文本安全不能只检查数量 |
| P1/P2 | weekly未dispatch；pool字段缺summary/scope并固定Reading，独立证据可能用canonical_key冒充asset，新证据/冷却/容量未落实 | `dream/weekly.py:113,180`；host `cognitive_runtime.rs:1978`；`crates/ielts-db/src/consolidation.rs:423`；config `ielts-domain/src/consolidation.rs:219` | 接线前修专用跨scope pool与真实evidence独立性/容量治理，不直接开通潜在错误链 |
| P1 | inaccurate反馈不改变普通memory本体；forget未传播derived pattern支持失效 | `crates/ielts-db/src/consolidation.rs:299,198`；`crates/ielts-db/src/memory.rs:573` | feedback/archive/forget事务内统一支持失效传播；用户纠正必须实效 |
| P1 | Coach feedback/reask UI未接canonical消息，未来新题没有自动assignment/outcome归因 | `ReadingCoachPanel.vue:120`、`useReadingCoach.ts:593`；`api/memory-repository.js:48`错把memoryId当coachMessageId；`src-tauri/src/commands/coach_feedback.rs:20,58`仅独立命令 | 真实messageId与parent-child重问链，回答保存assignment，projection维护自动关联未来相关新题 |
| P1 | M10 satisfaction污染learning success/failure；is_some(novelAssetId)冒充新题，outcome类型冒充成功，窗口忽略skill | `crates/ielts-db/src/teaching_strategy.rs:328,338,395,414,448` | canonical observation派生成败/时间/技能/资产；独立reward计数，幂等归因 |
| P1 | M11真实baseline/candidate执行缺失；评分读调用方traces且recorded=false，Rust离线run_eval是收据；graders部分业务golden未检查 | Python `eval/runner.py:243,287`，`eval/graders.py:71,269`；Rust `prompt_skill.rs:627,682` | 可信双版本实验执行器→必要业务断言→holdout；结构安全verdict与效果评测分开 |
| P1/P2 | holdout/shadow/canary非完整发布链，version pin只是标签未绑定实际prompt内容 | `prompt_skill.rs:662,785,939`；`eval/runner.py:243,325`；`coach.rs:98`；`coach/personalized_coach.py:347` | 完整冻结集/隐藏holdout、实际shadow与canary路由；执行器生成不可变版本+hash |
| P1 | 高级Workspace仍一次性文件Agent，无durable thread消息/context/checkpoint/retry归属，取消与中断恢复已实现 | `AgentConsolePage.vue:665`；`src-tauri/src/commands/agent.rs:133`；`crates/ielts-application/src/agent.rs:382`两条初始消息 | thread为run归属，持久消息+有界历史+学习读取工具，再接显式retry |
| P1 | planner Rust DTO只保存skillKey，丢probeKind/avoidAssetIds；UI写死60分钟/goal，无练习导航 | `AgentConsolePage.vue:404,828`；Python `planner/study_plan.py:252`；host `cognitive_runtime.rs:165,1925` | 完整skill probe贯穿持久化/读取/材料选择；真实时间目标输入与练习启动 |
| P2 | Memory证据drawer只是数量，无原始attempt/question导航；隐私开关/纠正/显式偏好撤回无UI | `AgentConsolePage.vue:513,918,928,936`；`modules/agent-console/format.js:282`；`LearnerModelPage.vue:41` | stable observation→event→attempt/question可核验导航，绑定已有控制能力 |
| P2 | action批准只更新审批行，无执行结果消费 | `AgentConsolePage.vue:446`→`src-tauri/src/commands/agent_thread.rs:133`→`crates/ielts-db/src/agent_thread.rs:539` | Rust受控执行器，幂等行动状态与结果；不拓宽sidecar决定权限 |

### 已修复 / 不得重复报旧问题

- rr-* 不再写agent_runs FK；每次snapshot使用UUID，retrieval IDs留在query_plan_json，但可信run归属仍待补：`context.rs:208,235,246`。
- weekly已复用文本防火墙；旧Webview直传weekly patterns入口未注册：`consolidation.rs:391,399`、`src-tauri/src/lib.rs:220`。
- M10结构verdict由Rust持久候选与developer catalog计算，不接受调用方passed/metrics；但它不等于效果实验。
- M11四个生产发布写命令已移除、sidecar HOST_ONLY闭锁；可信offline服务事务收据存在，但真实evaluator缺失。
- 安装目录agent-workspace默认初始化、不可写时app-data回退与续期通过真实packaged测试，不恢复目录chooser。
- M3普通候选→validator→pending→晋升是真的；daily dream_candidates不能借此声称已审批。

### 验收边界

- 当前合并工作树静态29/29、packaged18/18、视觉17/17，覆盖shipping安全/普通练习/默认工作区/重启与visualstate；不外推M6–M12闭环。
- M6 `crates/ielts-application/tests/m6_product_gate.rs:720,728,820`为FakeStore与手填C observation，不是真实A/B跨资产作答→候选→个性化Coach→新题C改善。`developer/docs/M6_STAGE_GATE_REPORT.md:98`仍No-Go。
- 日志恢复测试证明catch-up入队，不证明worker完成；packaged sqliteRestart用setting marker，不是Dream恢复。
- CI选择列表`developer/tests/ci/run_static_suite.py:228-280`不包含DB teaching_strategy、m6_product_gate、journal_dream或agent_thread等全部专项，不能把专项历史收据混作当前29项全部执行。

### Linus式整改次序（建议，不是本轮新增功能授权）

1. 防伤数据：真实archive与明确forget分开；反馈/删除传播派生失效。
2. 统一跨语言wire schema与freshness维护，避免接上线后才发现协议不兼容。
3. canonical Coach输入→含正文Context→model snapshot/trace，保留baseline，先shadow再canary。
4. 接真实反馈/reask→assignment→相关新题outcome；修reward/归因垃圾实现，再验收A/B/C闭环。
5. 一个daily消费者、统一Dream候选审批；weekly证据/容量修完才接线。
6. thread/run持久化、完整probe与练习导航、审批执行；真实eval/holdout/shadow/canary最后按需要建设。

根本原则：减少平行状态机、让数据结构带足来源与归属、每次做一条可运行纵切；不继续用“表/方法存在”替代用户可运行和可验证的行为。

- 已验证整改提交 fddb930c，28 文件；静态 28/28、新 release packaged 18/18；.zcode 未暂存。
- 当前远端 IELTS-WRITING-FEAT tip 为 191c797a，本地 push 被拒绝；读取远端差异后决定安全处理。
- 任务书 1-800：产品是学习证据闭环，不是带工具的聊天框；四链为 truth、memory、context、evolution，要求后续练习收益验证、typed host authority、有界且可治理记忆、Python 认知编排、Rust canonical data/model/tool 审计。
- 远端新增 29 个提交、64 文件，重点为 sidecar 打包/签名、Windows 原生验收、视觉回归、发布门和 setup 文档；不能覆盖。merge-tree 预演仅两个 E2E 文件发生内容冲突，与本地“移除目录选择器”改动重叠。
- 任务书 801-2400：三时间尺度（实时/当日/跨日）、Rust host 最终 materialization、Memory source provenance/utility/promotion/删除防复生、SQLite-backed 单 worker/lease/checkpoint。历史前段 schema 与后续实施章节需按覆盖优先级解读，不能仅用旧 schema 找错。
- 任务书 2401-4800：session reflection/daily/weekly/monthly 各有入口与不同治理；Context 当前证据>画像、运行快照与版本固定；Coach canonical evidence→Context→策略→validator→反馈→后续 outcome，真实新题收益优先。Prompt 演化要求执行 baseline/candidate、多 grader、holdout/shadow/canary/rollback，而不仅持久化 grading。生产 Webview 不暴露全局发布；后台 job 不依赖 Vue 打开；thread/checkpoint 与长期 memory 分离。
- 任务书 4801-6400：每阶段必须 schema/application/Tauri/最小可观察Vue/packagedE2E/flag纵切；M6 first-reading-Coach Go/No-Go 是进阶前提；整份前段并非当前完成状态，21.6+覆盖旧安排。四链追踪、L0-L7（含跨时间真实效果）不能互相替代。事件 processed 不是所有consumer通用offset；隐私删除源证据应重验证派生memory。
