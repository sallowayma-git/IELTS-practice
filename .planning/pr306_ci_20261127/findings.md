# 失败依据

PR head fc68aad3，Actions run 46072294605。

- Rust：coach_link_data_safety 的 format-18 合成包仍带 format-23 词书表，导致合法恢复测试与精确拒绝测试失败。生产备份版本约束正确，修复夹具并显式断言三张新表仍被旧格式拒绝。
- Visual：reading_library_surface_visual_check 仍断言两个工具入口；新增口语入口缺少稳定 data-action。补标识并把预期更新到实际三个入口，不降低布局检查。
- GitGuardian：incident 40836822 指向提交 13bff647 的 idictationBridge.test.mjs，值为无效测试字面量 do-not-return。当前代码改为运行时生成随机夹具；历史扫描可能仍需将这一具体事件标记为测试凭据，不能关闭检查或冒称真实密钥泄露。
