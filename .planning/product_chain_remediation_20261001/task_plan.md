# 产品链路整改（2026-10-01）

## 授权与目标

用户确认按复核顺序继续修复优化。第一批解决归档误删除与用户反馈/删除的派生失效；后续状态新鲜度→canonical Coach/Context→反馈/新题效果闭环分批验收。主线程负责修改与最终验证，探子只读，不复制历史。保留.zcode，避免破坏性Git操作。

## 第一批阶段

- [complete] 主代理阅读生命周期设计、待修改代码；两个并发探子完成并关闭。
- [complete] 单一可审计生命周期入口；归档保留正文证据，遗忘明确确认；反馈及源失效事务传播。
- [complete] Rust真实SQLite专项通过：memory 6/6、consolidation 29/29、application memory 2/2、M6合同7/7；Vue静态与typecheck通过。新增UI行为脚本待完整视觉执行。
- [complete] 顺序执行静态套件29/29、packaged Tauri E2E18/18，再执行完整视觉回归17/17；主代理检查desktop/mobile截图。第一批验证完成，后续链路仍待整改。

## 后续

- [pending] M2/M4新鲜度与跨语言真实wire合同。
- [pending] canonical Coach→含正文Context→snapshot/model trace。
- [pending] canonical反馈/reask→assignment→未来相关新题outcome。
- [pending] 统一Dream候选与daily消费者；再推进线程/计划及真实eval。

## 约束

本批不恢复生产Prompt写入口，不拓宽sidecar权限，不把mock通过当产品闭环；无需迁移时不创建空migration。只有实际验证后才能报告完成。
