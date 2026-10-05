# 生产追踪与自动 Daily 接线（2026-10-02）

## 核心判断

已实现 canonical Coach 的生产追踪纵切，以及应用运行期间的自动 Daily journal/Dream 消费。不是完整个性化 Coach、自进化或全部阶段 Go。

## 已接通

- Coach：服务在实际模型调用前原子保存宿主 run、精确 gateway 请求 snapshot 和 invocation。完成消息与成功终态同事务；失败消息与失败终态同事务。记录实际 model、usage、request ID、latency、retry count；启动恢复 interrupted。请求预算按完整序列化请求计算，必要当前任务不被静默裁掉。
- Daily：Tauri 启动消费者，发现 local 用户已结束的 UTC 活动日；同一队列依次执行 journal/Dream，复用 dedupe、lease、30 秒 heartbeat 和 60 秒失败退避。退出时停止消费者，不声称客户端关闭后仍有 OS 调度。
- 事实绑定：journal ID、source hash、day、user、job、worker 由宿主绑定到 checkpoint。反向 RPC 校验用户与日期，事实变更或 journal 被替换时拒绝旧绑定。
- 完成凭据：Dream business run 与 checkpoint 原子建立；重复 callback 不创建第二个业务 run。任务收尾校验真实 journal/business receipt，返回其他日期 runId 或尚未完成的 run 均不能完成任务。已完成业务但收据丢失时优先恢复，即使重试预算已耗尽，也不重复执行。

复用既有 schema；没有为接线增加空迁移。Dream 仍通过既有 pending 候选与证据门，不自动晋升 active memory。

## 独立复核与验证

四个只读探子定位现状，随后两轮独立复核；修改、取舍与最终验收由主线程负责。发现的失败原子性、完整请求预算、业务收据恢复以及 final runId 信任漏洞已补回归。

最终静态门禁 39/39（2026-10-02 22:26:04 UTC），包括 Python 445 项、真实 SQLite background_jobs 21 项、Coach trace 6 项、自动 worker 3 项。随后重新构建的 packaged Tauri 回归 18/18 通过（22:32:18 UTC）；程序 SHA256 `9ca991c832e9fbdc707162d1a6fdfdd93358f4ee2204e045e0594ab8dc6bd40b`。新增文件限定格式检查、文档漂移检查和 `git diff --check` 通过。专项 fixture/mock 验证不等于真实付费模型或真实用户日终端到端验收；现有 packaged 检查是桌面兼容回归，不包含新增自动日终全链场景。

## 剩余边界

2026-10-03 六章后续补丁回归：静态40/40（21:56:54 UTC，Python452）→重新构建packaged21/21（22:03:26 UTC）通过。新增持续门禁覆盖在途model取消及真实同键Supersede审批；遗忘标签、Context逐item裁剪与Soul预算、同时间独立练习趋势、缺失ledger补回冻结序号均有专项反例。正常自动Daily的真实执行审计为 `dream-11738657-b22f-4350-b6c6-861bf2bbbbcc`，重启幂等与Coach成功/失败追踪未回归。此回执仍不代表完整个性化或自进化闭环。

2026-10-03 原生场景追加验收：静态39/39（21:36:09 UTC）之后重建宿主，packaged21/21（21:41:47 UTC）通过。新增Coach真实gateway成功/失败run→snapshot→invocation核对，以及冻结Python侧车自动昨日Daily和重启后65秒去重观察。正常Daily严格要求非recovered执行审计；原生测试确实捕获并推动修复了Guard错误round列、终态runKind丢失、audit/job收尾次序以及worker在Tauri setup之前启动的竞争。恢复凭据明确标记recovered、保留原失败历史且与job完成同事务，不冒充正常执行。未调用真实付费模型。

- Weekly 生产入口继续关闭；未开放自晋升、canary 或高风险 prompt 写入口。
- Coach snapshot 是精确实际请求的审计快照，不代表个性化 retrieval/Context/strategy 全链已接入。
- Daily 自动消费仅覆盖 local 与已结束 UTC 日；mastery delta、enrichment、完整 Dream Report 和后续候选消费仍需下一纵切。
- 本批没有提交或推送，保留此前改动和用户 `.zcode/`。
