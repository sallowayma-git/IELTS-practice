# 发现与决策

## 六章补丁的独立边界复核（2026-10-03）

- injected Soul虽然不允许planner正文，但显式section budget仍须计算完整render并失败关闭；不能因空itemIds跳过。
- Supersede候选的target是旧记录、resolved是新记录。遗忘旧target不能把新resolved身份标签清掉；字段归属按COALESCE(resolved,target)，既有正文清理仍覆盖全部关联候选。
- 同资产最早时间并列的多个attempt必须先平均为一个资产结果，再进入时间bucket；按UUID/ID挑一个会制造趋势。
- ledger部分缺失要读取该attempt所有存量outcome/完成记录复用一致ordinal，冲突报错；不能用别的attempt的MAX分配新序号。专项实际删除完成事件并补回，保持3且重建幂等。

## 原生 Daily 审计断点（2026-10-03）

- Tauri2.11.5的Builder.build不执行用户setup，app.run的Ready事件先调用setup再交给用户callback。此前build后启动Daily worker与setup里的business/agent恢复竞争，可在同次启动把刚创建的audit标成interrupted。真实native新场景捕获此问题，worker已移至Ready回调；正常native依旧拒绝recovered收据，不放宽验收。

- run_audit.rs的MAX(round)查询与实际round_index列不符，导致共享Guard所有终态写入失败。单测必须用真实迁移SQLite验证，而不是模拟终态回执。
- runKind原先依附可覆盖result_json，Dream完成/失败/取消后变默认Workspace。finish_agent_run保留开始时类型并拒绝非对象结果，调用方不能改类型。
- job完成与audit必须有可验证关系。正常执行先终结audit再完成job；复用/失败恢复/租约恢复及旧completed缺audit时，同一事务补明确recovered事实回执并完成job。恢复不改原failed/interrupted审计，不编造sidecar计数，不重做候选。新正常原生场景必须拒绝recovered，以免掩盖执行失败。

## 生产追踪与自动 Daily（后续纵切）

- 自动消费只处理 local、已结束 UTC 日；复用持久化队列，不增加 OS 调度或通用调度框架。以最新 canonical source hash 判定 journal 新鲜度，宿主保存不可伪造的业务绑定。
- 任务成功以持久化业务为准，不能以 sidecar 返回成功或任意有效 runId 为准。业务完成/任务收据失败跨重启先修复收据，重试上限不得把真实完成翻成失败。
- Coach 真实调用前保存精确序列化请求，失败消息与终态同事务；完整请求记账包含 roles/JSON 包装。该快照不是全部 RAG/个性化上下文完成的证明。
- 两轮独立复审发现的失败原子性、预算、receipt 恢复及 final runId 漏口已补测；static39/39→重新构建packaged18/18通过，自动日终原生端到端场景尚未新增。详见 developer/docs/PRODUCTION_TRACE_DAILY_WIRING_20261002.md。

## 六阶段并发整改 loop（2026-10-02）

- M12–M7六阶段均Partial。完成本轮局部authority修复不等于产品门Go：后台自动消费、周度dispatch、持久线程run关联、审批执行、可信eval、策略生产assignment仍有断点。具体出处见phase_audits_20261002.md。
- 两轮修复保留真实证据：满意度不计学习效果；未来归因从生产ledger/projection/attempt解身份与维度，同次兄弟事件不是历史曝光；Daily引用目标memory真实关联，Weekly从真实独立练习验数量并在apply绑定可信policy及快照；空合法输出成功，畸形JSON失败。
- 发布前驱新增0025及备份v17；0026只新增nullable提交fingerprint，旧backup DB版本<26允许且仅允许缺这一列，NULL不伪造历史版本。新提交三种阅读mode固定版本；legacy只用保留成绩/答案、无source，display数字不猜对应但保留对话。
- UI证据链memory→observation→event→attempt有界读取；计划仅持久化ID可操作、成功写失败读只重读；目录版本保护避免旧响应恢复已遗忘正文。本轮JS回归通过，打包IPC/读屏实测待验。

## 第三批起点

- canonical Coach探索两探子完成并关闭。attempt/thread无userId/sensitivity列，不虚构跨用户过滤；固定桌面local边界内以thread绑定attempt、asset及持久化mode/session为身份。P2/P3的display编号与qN不同，旧selector按canonical questionDisplayMap反查；review是UI模式别名，不能要求DB mode=review。completed旧导入允许无completedAt。endless历史不能要求当前asset/attempt仍等于已提交篇目。
- 主代理完整阅读Coach服务及M6 ADR/gate。确实原始questionContext被提升system；本批先做baseline可信读取，不复制Python个性化实现、不启用canary。新增read-only resolver→固定system+canonical数据消息，写前拒绝无证据和scope冲突；选择文本仅为有长度上限的用户请求hint，不当canonical事实。
- 本次两处未知文件路径读取失败（domain attempt实际位于dto/attempt.rs），按rg/探子坐标读取正确位置；未编辑用户文件。

- 独立复核发现 atomic_sync 的 RELEASE 在try之外时，提交失败可让finish_sync_run错误提交未回滚索引。主代理点验并改RELEASE也受try保护，失败conn.rollback；begin_sync_run已先提交独立审计，因此这是sync专属事务，不是任意嵌套事务工具。故障注入确认旧chunks/lexical/embeddings完全保留，错误审计可独立写入。

- 四探子只读探索完成并立即关闭；主代理复核并修改。另确认 ContextPlan.to_wire 内层 section 为 snake_case，planner 跨区重复 ID，只靠外层字段与自造测试无法发现。现已统一内外层 wire，按优先级唯一分区。
- 基础纵切实现 corpus strict boundary adapter、原子失败回滚及审计、正文 render/hash/全量预算、scope 防自授权和 snapshot rank。SQLite/Rust→Python sync/search/plan→Rust decode 回归通过；真实 canonical Coach resolver 与 host-assigned run/snapshot/model trace 留到下一纵切，不以基础测试替代产品闭环。
- 第三批首次 snapshot 新测试编译 E0502 为 fixture push 同时借用错误，拆出 clone 后专项通过；查不存在的 context_plan/check_documentation_drift 文件后使用 rg 定位正确文件；未改用户数据。大规模/并发 corpus 导出仍非冻结快照，同数量内容漂移不承诺可发现，最终 materializer 仍 canonical re-fetch。

- 主代理已完整读M5/M6 ADR与gate、Rust corpus/context DTO及ContextMaterializer。当前Context非Soul项仅渲染provenance头，正文未进入model文本；tokens却按正文计算，requested budget未落实，renderedAt也非合法RFC3339。应从同一canonical文本渲染/记账/hash，先修authority合同再接线。
- Python corpus manifest字段corpusVersion/exportedAt与Rust schemaVersion/chunkingVersion/generatedAt错位，export请求顶层cursor/limit而host取query；sourceVersion的str类型与Rust整数、normal敏感级与Python枚举也错位。Rust DTO为权威，采用明确boundary转换而不是放宽生产closed schema。

## 第二批：evidence freshness / learner wire

- 隔离必须覆盖referenceAt而非仅输出过滤；每用户时钟回归通过。合并gateway已用domain LearnerSkillSnapshot与DB单事务同技能页，不再手拼平行JSON/吞needs错误；首技能页不能外推全库top-priority需求。
- 静态及Rust CI均先安装锁定Python依赖，再执行Rust集成；新增真实wire probe依赖Python且不会进入产品bundle，现有CI安装序列兼容。

- 三探子完成并关闭；主代理复核：M4两快照无自动维护，verify仅数observations且未预测首次builtin mapping，可能把空投影误判一致。新增纯读取预测mapping、完整observation比较、读前M2修复及M4事务内verify/rebuild/reverify。
- 生产快照限定既有桌面当前用户local，不新增调用方userId授权；完整rebuild/verify仍覆盖所有用户。review保持priority排序，游标在排序结果定位，不再skillKey字典比较漏项。
- Coach query必须query.skillKeys，返回states[].skillKey/masteryMean；Python shadow尚无dispatch，本批修合同不声称生产Coach接通。planner当前基本字段兼容。
- M4读事务内再次检查M2防另一连接在修复与读之间提交新证据；失败明确要求重试，不返回陈旧成功。未声称M2所有现有读入口已具备完整跨连接事务快照。

- 视觉首跑失败原因：fixture用transport throw表示业务拒绝，bridge兼容fallback自动重试导致一次性失败被吞；改为真实Rust CommandResponse的ok=false业务错误。bridge对transport错误的写命令重试风险另行保留核查，不混入本批生命周期设计。

- Schema允许循环且backup fixture有自环；传播用recursive UNION，按source owner过滤每条边，拒绝跨用户路径再穿回本用户。
- 原UI helpful/not_helpful不在Rust反馈enum内；改为准确/不准确，inaccurate停用源及派生，不改canonical练习事实。
- 复用真实SQLite fixture覆盖archive内容/证据/backup保留、stale CAS、循环、跨owner、transitive、晚失败回滚；UI mock仅证明点击/IPC/刷新，不能充当DB闭环证据。

- 基线HEAD 6b4481bd，工作树仅用户.zcode未跟踪。
- 上轮源码复核：AgentConsole“归档”调用memory_forget，DB将正文脱敏、删memory_evidence；inaccurate只传播派生不改变源memory，forget未传播依赖失效。
- 核心数据结构应保持 memory_items状态/version、memory_evidence、memory_relations、memory_mutations原子一致；archive不等于delete，用户纠正不修改canonical learning facts。
# 2026-10-02 生产接线探索

四个直属探子确认：Coach真实入口enrichment::coach_run无独立run且丢CompletionResponse；invocation只有schema。Daily仅入队无消费者，手动wrapper不能对已领取任务再claim；自动扫描须排除尚未结束的UTC窗口、续租、同身份重试、完成业务后的幂等恢复。Weekly仍封闭且无安全宿主用户/窗口/幂等绑定，本批不扩大Daily权限。新实现优先复用现有trace表和job账本，不启用付费provider。探子全部返回；最后close遇not_found，不复用。
