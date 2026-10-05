# Round 3 阶段整改回执（2026-10-02）

## 核心判断

M12→M7 六阶段已执行并发审计、隔离修复、独立复审和第二轮补修。所有阶段仍为 Partial；本报告不是产品 Go 声明，也不修改冻结任务书。

随后 M6→M1 再执行六审计、六隔离修复、六独立只读复审。最后六项复审未确认新增 P0/P1；已知产品链路缺口不因此消失。

最大并发六个，子代理不复制历史。两名第二轮修复代理因工作区额度中断，其未完成验证由主线程接手。约十分钟无产出没有被记作异常。既有未提交修改与用户 `.zcode/` 保留。

## 已实现的局部整改

| 范围 | 修复 | 验证边界 |
| --- | --- | --- |
| M12 | probe JSON 保留类型、避题、原因及收到的目标日期；兼容旧字符串；计划创建成功读失败只重读，只有持久化 ID 可完成 | DB 重开、DTO、JS 状态；不是线程执行闭环 |
| M11 | 保存真实发布前驱与链头；乱序发布连续回滚；legacy 不猜前驱；v17 备份保留发布链 | SQLite/FK/失败回滚/恢复；不是可信 eval 或生产发布授权 |
| M10 | 满意度与学习计数分离；归因核验用户、未来时间、相关技能及真实练习；历史状态重建；同次提交兄弟事件不算先前曝光；真实写作维度与题目来源 | 真实提交/评分 fixture，无真实 provider；不是生产 assignment 接线 |
| M9 | evidence 抽屉沿 memory→observation→event→attempt 读取；有界、缺失及失败披露；目录请求版本阻止旧响应恢复遗忘正文 | JS/DTO；读屏与真实 IPC 乱序未实测 |
| M8 | 从稳定练习证据计算独立性；apply 同事务重验快照并绑定可信 policy；host 候选池真实 summary/scope；Python 不再以 memory 数量冒充独立练习 | DB/application/Python/host 合同；不是周度自动调度 |
| M7 | Daily Dream 逐 memory 关联证据；缺关联 NOOP；Rust 落 pending 前复核关联、用户、日期、投影 | DB/Python 合同；不是后台自动消费 |
| Canonical Coach | 仅从绑定 completed attempt 读答案/成绩；可信资源正文作为数据；当前提问预算不丢；提交三种阅读 mode 固定 fingerprint；合法重新导入不混用旧答案/新原文 | SQLite→service→假 provider；不是个性化 Coach / invocation trace 全链 |
| M1 来源信任 | 题库只能进入 corpus 分区，不得标为显式偏好、learner、memory、当前任务或 Soul；可信当前任务由 host API 注入 | 真实 SQLite/corpus 19 项；host 任务入口仍待接线 |
| M2 证据出口 | projector 与 gateway 共用事件 hash/schema/语义/隔离判定，损坏事件进入 missing IDs | 实际读取与投影 17 项 |
| M3 运行权限 | host method 绑定 RunKind 及最小 reverse-RPC 能力，MemoryCandidate 禁止 Weekly active mutation；未接入口继续关闭 | runtime 23 项，不是已开放 Weekly |
| M3 生命周期 | REINFORCE/IMPROVE/REGRESS 统一新增、更晚、目标关联证据门；失败事务不翻转状态 | 真实提交→投影→validator→promotion 18 项 |
| M4 证据/时间/映射 | 同 attempt 各题共享 novelty；旧/新题型按各 ledger event 归属；读取 asOf 驱动逾期 priority，不修改重放 state hash | 真实提交/重导入/verify 14 项 |
| M6 v0 收口 | 精确 reask 校验角色、同线程、顺序、时间、local及幂等；v0 新 outcome 缺可信绑定时全部拒绝 | 19 项，**不是未来效果归因已实现** |

Legacy Coach 无提交版本时不加载今天的原文，仅使用保留结果并明确 evidence limitation；UI 默认显示题号不能猜映射，但对话仍可继续。旧 DB schema<26 的备份仅允许缺新增 nullable fingerprint 列，不放宽其他列校验，也不伪造版本。

## 验收

- 定向：DB consolidation 42、strategy 22、revision 6；备份 15；application policy 5、Coach 10；UI 25 项通过。
- 完整 static 最终 37/37（2026-10-02 16:08:27 UTC），其中 Python 445 项；其后 packaged Tauri 18/18（16:13:44 UTC），确实重新构建当前程序。
- 打包程序 SHA256：`e53f7b9c98bddb5ca8bc399ff21fcdd6554dfd5ffc6fbf9558f5be10f799becd`。回执：`developer/tests/e2e/reports/static-ci-report.json` 与 `suite-practice-flow-report.json`。
- Agent 四尺寸视觉/交互 4/4：1440、980、390、360；归档证据正文、事件来源、练习链接、取消遗忘、提交失败、提交成功但读取失败的只读恢复通过。初跑旧 mock 缺少证据读取命令且断言仅计数，已更新 fixture 核验真实展示，不回退业务实现。主线程查看 desktop/mobile 截图无明显横向溢出。此项使用 IPC fixture，不等同真实读屏或原生 IPC 乱序测试。
- 完整回归过程中 Windows LNK1104 与历史 fixture 假回退 schema 已解决；改真实历史 schema 构建，生产迁移仍严格。
- 限定 Rust 文件格式检查与 `git diff --check` 通过；未全仓格式化。

门禁已加入 Coach canonical、真实 submission revision、release backup、可信 consolidation policy、UI durable state/evidence、Coach v0 authority 等回归。旧迁移 fixture 改真实历史 schema，迁移预期更新到连续 26，不修改生产约束。

## 仍需后续闭环

后续接线状态见 [生产追踪与自动 Daily 接线](PRODUCTION_TRACE_DAILY_WIRING_20261002.md)：下列第 1 项的自动消费者/heartbeat、第 7 项的 canonical Coach 审计已实现；其余能力不由该纵切自动完成。本报告上方验收仅属于此前批次。

1. M7 自动 job 消费、lease heartbeat、真实 mastery delta、enrichment 和 source 写入。
2. M8 weekly dispatch/durable job/cooldown/new evidence 入口与完整报告。
3. M9 显式偏好可见及撤回、逐次 Dream Report。
4. M10 生产 select/assignment/feedback/outcome wire 和探索累计硬上限。
5. M11 可信实验收据及 holdout/shadow/canary 阶段门、active registry 消费和 invocation 固定版本。
6. M12 run/thread/checkpoint/retry 生产关联、审批幂等执行、planner 负荷和偏好输入。
7. Canonical Coach host run→snapshot→invocation 审计及个性化链；M6→M1 已分阶段局部复核，生产闭环仍未全部实现。

本轮没有调用真实付费 provider、启用 canary、开放自晋升权限或提交推送。

详尽 file:line 审计与回执位于 `.planning/product_chain_remediation_20261001/phase_{audits,repairs,review}_20261002.md`。
