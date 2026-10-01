# 发现与决策

- 视觉首跑失败原因：fixture用transport throw表示业务拒绝，bridge兼容fallback自动重试导致一次性失败被吞；改为真实Rust CommandResponse的ok=false业务错误。bridge对transport错误的写命令重试风险另行保留核查，不混入本批生命周期设计。

- Schema允许循环且backup fixture有自环；传播用recursive UNION，按source owner过滤每条边，拒绝跨用户路径再穿回本用户。
- 原UI helpful/not_helpful不在Rust反馈enum内；改为准确/不准确，inaccurate停用源及派生，不改canonical练习事实。
- 复用真实SQLite fixture覆盖archive内容/证据/backup保留、stale CAS、循环、跨owner、transitive、晚失败回滚；UI mock仅证明点击/IPC/刷新，不能充当DB闭环证据。

- 基线HEAD 6b4481bd，工作树仅用户.zcode未跟踪。
- 上轮源码复核：AgentConsole“归档”调用memory_forget，DB将正文脱敏、删memory_evidence；inaccurate只传播派生不改变源memory，forget未传播依赖失效。
- 核心数据结构应保持 memory_items状态/version、memory_evidence、memory_relations、memory_mutations原子一致；archive不等于delete，用户纠正不修改canonical learning facts。
