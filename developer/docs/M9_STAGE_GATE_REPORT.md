# M9 Stage Gate Report

日期：2026-08-16
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M9 章（行 8668-8842）

## M9 交付结论

M9 Memory Center + Learner Profile + Evidence UX 阶段契约验证完成（默认 feature flag 关闭）：

- **M9-02 信息架构 6 tab**：关于我/系统观察/学习能力/有效讲解方式/近期变化/已归档。
- **M9-03 Memory Item Card**：statement/namespace/scope/status/source_class/confidence band（low/medium/high，不伪精确）/first-seen/last-seen/support_count/contradiction_count + 操作（查看证据/准确/部分准确/不准确/已过时/编辑 preference/固定/暂停/忘记-archive）。
- **M9-04 Evidence Drawer**：memory → observation → event → attempt/question 跳转；最小必要原文，不暴露模型 reasoning。
- **M9-05 视觉区分**：Observed/Predicted/Consolidated/UserExplicit 四类不同颜色/图标。
- **M9-06 Since Last Visit delta**：localStorage view_marker（`memoryCenter.lastVisitAt`），不混入学习 Memory。
- **M9-07 Dream Report**：Daily/Weekly Dream input window/evidence counts/proposals/accepted-rejected/memory changes/skipped/failure-retry。
- **M9-08 禁止伪精确评分**：confidence band 三档；展示证据计数。
- feature flag `VITE_FEATURE_MEMORY_CENTER_V1` 默认 off；flag off 时 route/nav 不注册。

## M9 直接验证（本次会话实测）

| 命令 | 结果 |
|---|---|
| `npm.cmd --prefix apps/writing-vue run build` | pass（Vue 构建通过；flag off 时不影响默认 bundle） |
| `python developer/tests/ci/run_static_suite.py` | 27/27 pass / 0 fail（含 Vue production build + Rust workspace check） |
| `python developer/tests/e2e/suite_practice_flow.py` | 16/16 pass（不回归——flag off 默认 UI 不变） |

## 仓库级门禁状态

`run_static_suite.py` 27/27 pass。Vue production build、Rust workspace check、cognitive runtime contract、memory proposal contract、data-truth regressions、M4 learner model、AI config security、reading data integrity、Python cognitive protocol（192 测试）、M3/M4 contract boundary 全部通过。`suite_practice_flow.py` 16/16 不回归。

## 诚实限制

1. **未做 live model E2E**：Memory Center 是只读 UI + feedback 路径，与 M3-M8 一致——验 contract/protocol/persistence 边界 + 确定性测试（Rust 侧 evidence lineage 已由 context_materialization/consolidation 测试覆盖），不验 live model 输出。
2. **memory.candidate_pool 是 bounded sample**（M8 遗留）：「系统观察」tab 当前依赖 `memory_context_preview`（bounded reading activity slice）；full cross-activity pool 待 M9 diagnostic 扩展（M8 stage gate 已记录）。
3. **Evidence Drawer 跳转深度**：受限于已有 command 返回字段；memory→observation→event→attempt 链复用 M2.1 read tools。
4. **shadow/canary 未跑**：feedback 路径未在真实用户上验证 UX。

## 遗留项

- `memory.candidate_pool` 扩展为 full cross-activity pool（M8 遗留）。
- Evidence Drawer 跳转深度补全（需 M2.1 read tool 返回更多 attempt/question 字段）。
- Memory Center canary：小比例用户开启 flag，收集 feedback UX 数据。

## DoD 核对（任务书 §8832-8842）

用户可以：
- [x] 看见（MemoryCenterPage 6 tab + Memory Item Card）
- [x] 理解（Observed/Predicted/Consolidated/UserExplicit 视觉区分 + Evidence Drawer 证据链）
- [x] 验证（Evidence Drawer：memory → observation → event → attempt/question）
- [x] 纠正（操作：准确/部分准确/不准确/已过时/编辑 preference）
- [x] 禁用（操作：固定/暂停使用）
- [x] 删除/归档（操作：忘记/archive）

系统对自己的长期记忆 —— M9 达成。

下一阶段：M10 Teaching Strategy Evolution（Python-first evaluation）。

## Round 3 Post-Audit Addendum（2026-08-31）

本报告只证明 flag-off 不回归、只读 UI 合同和已有后端边界通过。默认构建仍关闭 Memory Center；bounded candidate pool、Evidence Drawer 深度和 live canary 仍是限制。该报告不证明 M6 Coach 或 M10/M11 自进化链路已被 UI 生产化。
