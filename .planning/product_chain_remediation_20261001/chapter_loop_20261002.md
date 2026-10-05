# 章节独占审计→修复→复审 loop

## 第16/14/13/12/10/9章本批（2026-10-03）

六个限定修复代理返回关闭：遗忘清候选标签、同键Supersede、在途model取消、Context逐item裁剪、独立attempt趋势、删除后ledger chronology。随后六个无历史只读复审全部返回关闭；发现四个P2边界并由主线程精确阅读后补修：Soul section完整渲染预算、旧target遗忘保留resolved替代候选标签、同资产同时间首次attempt平均、部分ledger缺失复用当前attempt冻结序号并拒绝冲突。

专项DB learner19、ledger7、memory20、Supersede11通过；Context追加Soul回归。新增Supersede DB及agent取消纳入静态持续门禁。本批static→重新构建packaged尚待最终结果，旧39/39→21/21回执不覆盖本次新代码。

最终回执：Context22通过；本批static40/40（21:56:54 UTC，Python452）之后重新构建packaged21/21（22:03:26 UTC）通过，包含正常非recovered Daily审计及重启幂等、Coach成功/失败追踪。上述待验收状态已收口，仅覆盖本批修复，不抹掉以下剩余缺口。

仍未完成：第16章eval proposal wire及必选holdout覆盖；第14章tool审计异常即时收口；第13章真实模型token预算；第12章idle posterior只读衰减。这些不在本次修复范围，不宣称章节整体完成。不提交推送、不启用Weekly/canary/自晋升、不调用付费provider。

首组六章审计均只读、无历史并发完成并关闭。以下为可行动发现，不是全部章节完成声明。

| 章 | 出处与反例 | 本轮处理 |
| --- | --- | --- |
| 20 | packaged_tauri_flow.py:61 freshness漏application；:715仅workspace trace；:941仅普通重启 | native Coach成功/失败trace、自动closed-day Daily真实sidecar与重启幂等；QA修复代理 |
| 19 | cognitive_runtime.rs:1112只有Daily检查user；:1310透传query.userId；history/mod.rs:727仅解绑不清请求副本 | 合并runtime身份修复到Daily Rust代理；删除正文保留tombstone独立代理；暂停语义合并worker |
| 18 | AgentConsolePage.vue:326读取失败→[]；:267/:890所有Dream计运行；:348仅查今天 | UI代理修任务状态/错误/日期与竞态；Coach why-answer另排 |
| 17 | ai/runtime.rs:158整体DTO解码丢已返回model/usage；useReadingCoach.ts:231仅user review_set即success | gateway代理；UI hydrate后续限定补修，不把旧user当成功 |
| 15 | coach trace成功无assignment；coach_feedback.rs:253 upsert可伪造策略；:62/:77 feedback/event非原子 | 本轮优先feedback原子性与assignment声明收口，宿主策略纵切后续串行集成 |
| 11 | daily_dream.py:214 first target胜出、:312全target证据混入；worker:82覆盖checkpoint；:174每job全历史扫描 | Python候选方向代理 + Rust重试/原子批次/扫描/身份/暂停代理 |

授权边界：不提交推送、不调用真实付费provider、不启用Weekly/canary/selfpromotion，不碰.zcode。最大6个修复代理，严格不交叉写文件；主线程负责集成/门禁。约10分钟无证据不是异常，30分钟介入。

## 首组六修复回执

- Python Daily21项通过：无时间字段不假设last-write，冲突target安全NOOP，证据仅所选事件。
- Gateway真实HTTP12项通过：Value先提metadata，typed失败仍保留合法实际metadata，不把失败当成功。
- Feedback DB集成12+lib12通过：feedback/event/hydrate事务与immutable assignment声明校验。
- Agent UI33状态/证据测试+Vue typecheck通过：失败状态、readonly重读、历史日期、竞态。
- Native QA16安全单测+pycompile通过：Coach成功/失败trace，自动昨日Daily真实sidecar和重启幂等场景，尚未native实跑。
- Rust Daily DB26、runtime26、worker4通过；完整host73/75，两个HTTPfixture Windows10035/WouldBlock失败需主线程查明，不能记最终通过。旧半批候选修复代理封存并complete业务，独立复审必须核查是否误报完整处理。

全体修复代理已关闭；正在独立复审，尚未本轮完整门禁。

## 独立复审→第二修复轮

- Daily Rust P2：旧半批A重试[A,B]仍completed丢B。background_jobs.rs:663/runtime:1479，必须封存不误报全批success。
- Daily Python P1：journal.rs:421上游LIMIT128隐藏第129相反操作，:440仍全target/day证据混合；Python:242未映射kind默认REINFORCE。需贯通有界事实投影契约，不能仅Python末端去重。
- Native QA P1：stage :624漏externalBin，runtime:2315要求同目录ielts-agent-runtime.exe。P2canonical证据未验证与restart只比ID/count漏hash/checkpoint。
- Gateway fixture P2：acceptedstream继承nonblocking(:533)，timeout不恢复blocking→10035。明确set_nonblocking(false)+delayedpacket回归。
- Feedback事务/新assignment拒绝、AgentUI状态/日期/竞态复核无新增阻断；尚不是全部功能Go。

继续六并发限定补修，加入privacy正文删除与宿主strategy/hydrate纵切；不重复用户确认。

## 第二修复轮中断（2026-10-03）

六个新修复代理全部返回 workspace out of credits，后续 close 返回 not_found；无可用修复回执。主线程先检查工作树，对上一轮审计已证实的问题接手最小修复，不能将第二轮派发记为已完成，也不把10分钟无产出视为异常。之前五个专项成功不覆盖新发现的P1/P2。待代理额度恢复后再按章节独占审计循环派发。

用户告知额度恢复后，原六个限定scope重新派发并全部完成关闭。修复回执：半批旧候选A→[A,B]阻止普通完成（DB27）；上游超128条mutation则空列表保守跳过、单event证据、未知kind跳过（Rust18/Python22）；native QA补externalBin暂存校验、canonical请求证据及内容hash重启断言（安全单测19）；history删除清敏感request snapshot并保留audit redacted（11）；Coach固定evidence_first_v1真实请求并success assignment+trace同事务，UI按userMessageId恢复复盘（Rust专项40、JS4、Vue typecheck）；HTTP nonblocking fixture修复（hostlib76）。以上只是代理专项回执，主线程待独立复审及按序static→packaged。新增任何原生E2E阻断必须现场补修后重跑。

独立复审再次发现：journal memory_mutations汇总漏user过滤造成sourceHash跨用户漂移；Coach degraded thread未复用，历史100条之后最新review不可见；native harness使用旧10月1日sidecar/manifest（Python本轮10月3日）且固定Coach测试凭据落系统keyring。四项均需修复后才可启动packaged；19项QA安全单测不能替代当前Python sidecar字节新鲜度与凭据隔离。第三限定修复轮派4scope。

第三轮四scope返回关闭：journal加memory_items user过滤（SQLite19）；Coach复用degraded并在成功后active（DB trace10+phase8 4）；UI按sequence分页读到最新，越100条有界报错（JS10+Vue typecheck）；发布冻结脚本重建当前Python sidecar EXE/字节SHA/源码fingerprint，QA用唯一config ID并finally删除核对系统凭据（安全单测22）。源码指纹91b3814d2f25837872613789b2cbeb12f726496d86365ce56d8a3a2d09bbccad；sidecar SHA e3486dba281dd8136a3f3806cec0c3e76bb133dd94f82825f574178032539016。冻结首次冷启动1562ms >1500ms，第二次1389ms通过，时延门很接近。须以新host完整static→packaged确认，不沿用代理专项结论。

## 原生场景驱动的第四轮补修

static39/39后新增Coach成功/失败原生收据通过，但自动Daily超时；job/journal/dream均完成，agent audit未完成。两探子定位审计类型丢失与job先于audit提交，主线程复核发现Guard错误列名MAX(round)。两限定修复代理分别修Guard真实SQLite及持久化类型保留，专项2/8通过。主线程补正常/失败/取消audit优先收尾、原子recovered事实收据及旧完成缺audit恢复。两独立复审无P0/P1，指出原生正常场景应拒绝recovered和反向UPDATE失败测试，均采纳；一测试代理补四组故障/隔离/历史/幂等回归，队列33/33通过。所有代理关闭。完整static→新host packaged尚待本轮最终回执，不能以历史18/18宣称新增自动链闭环。

## 第二组六章独占审计（已返回关闭，待点验与修复）

第四轮原生严格复测又捕获启动生命周期竞争：Tauri setup在Ready才执行，而worker原在build之后先启动；自身Dream被同次startup recovery置interrupted。主线程本地依赖源码验证后移到Ready启动，独立探子确认；最新static39/39（21:36:09 UTC），新的packaged待最终回执。误判wire命名已撤销，现有DreamOutcome camelCase保持不变。

| 章 | 当前工作树仍存的线索与坐标 | 最小验证方向 |
| --- | --- | --- |
| 16 | eval/runner.py:185提议RPC形状/候选ID读错；prompt_skill.rs:667只评提交子集可遗漏holdout | 真实跨语言合同；冻结必评集合与遗漏/重复/外集合拒绝 |
| 14 | application/agent.rs:405模型await期间取消后仍Completed；:534工具审计失败直接退出留下running | 在途模型取消释放future；单run异常原子收口且禁止重放写工具 |
| 13 | domain/context.rs:181 chars/4可能低估CJK；application/context.rs:275超预算整section丢弃可容纳高rank证据 | 模型预算保守界；按item逐项保留与裁剪、快照一致 |
| 12 | db/learner.rs:849同轮题目被当时间趋势；:209闲置仅更新紧迫度不更新posterior副本 | 独立attempt趋势与同资产熟悉度分离；asOf只读衰减且replay不变 |
| 10 | db/memory.rs:645遗忘候选保留canonical_key/normalized_label；memory/validator.rs:246 SUPERSEDE匹配自己的目标当重复 | 删除标签/备份回归；同键替代放行、其他active占位仍拒绝 |
| 9 | learning_events.rs:520用剩余attempt计ordinal；learning_observations.rs:815优先ordinal造成删除后时序反转 | 真实A1-A4删除重练正确方向，verify/rebuild冻结元数据且幂等 |

以上来自六个独立只读探子，未执行验证，不冒充已确认复现或已修复。没有重报已经完成的trace/FK冻结/权限收口；当前原生Daily补修先完成统一门禁，再按不交叉文件界定修复scope。
