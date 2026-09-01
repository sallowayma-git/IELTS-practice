# 仓库文档与遗留代码清理计划

## 目标

保留唯一权威总任务书 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan.md`，清理已经没有工程价值、且不会被当前 Tauri 2/Vue 产品或必需 CI 使用的旧文档、旧代码和旧脚本。

## 范围冻结

- 先只读盘点；没有明确路径和引用证据不删除。
- 保留当前 shipping 路径：`src-tauri/**`、`crates/**`、`apps/writing-vue/**`、构建配置、发布脚本和必需的 `developer/tests/ci/**`、`developer/tests/e2e/**`。
- 保留权威总任务书、根目录工程说明、当前架构/评估记录，以及仍被测试或构建引用的历史兼容工具。
- 已经由用户确认并提交的 `.Jules/palette.md`、`ListeningPractice/**` 删除不是本次候选，不恢复。
- 不做“全目录清空”或无证据的旧代码重写；删除使用明确文件清单。

## 阶段

1. 审计文档、代码、脚本和构建引用（已完成）。
2. 输出保留/删除/归档候选，标注 `file:line` 证据，并获得用户确认（已完成）。
3. 对确认的路径做最小删除，更新必要索引/README（已完成）。
4. 运行静态 CI 与 E2E 门禁，复查 git diff 和未预期引用（已完成）。
5. 形成提交；只有用户另行要求时推送远端（待执行）。

## 不在本次范围

Memory、Dream、Learner Model、Context Compiler 或其他 M2+ 功能实现；不改变产品运行逻辑。
