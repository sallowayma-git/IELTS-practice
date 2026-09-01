# ADR-M9: Memory Center + Learner Profile + Evidence UX

日期：2026-08-16
状态：Accepted
基线：`IELTS_Atlas_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M9 章（行 8668-8842）

## Context

M3-M8 建立了完整的长期记忆 + learner model + dream + consolidation 能力，但对用户是隐藏黑盒。M9 让用户理解系统「记住了什么、为什么、发生了什么变化」，并可看见/理解/验证/纠正/禁用/删除-归档系统对自己的长期记忆。无新核心 migration（view_marker 用 local UI state，不混入学习 Memory）。

## Decisions

### D1. 信息架构 6 tab（M9-02）
关于我 / 系统观察 / 学习能力 / 有效讲解方式 / 近期变化 / 已归档。每个 tab 是 memory items 的一个 bucket（按 source_class + status + namespace 过滤）。不堆一个大列表；用户先选视角。

### D2. Observed/Predicted/Consolidated/UserExplicit 视觉明显不同（M9-05）
四类 source 用不同颜色/图标：
- Observed = 已在行为中发生（solid + check 图标）
- Predicted = 系统假设待验证（dashed + question 图标，标「待验证」）
- Consolidated = 多条 evidence 的高阶归纳（nested + pattern 图标，展开可见 supports）
- UserExplicit = 用户自己设定（highlighted + user 图标）

### D3. Memory Item Card（M9-03）
展示 statement/namespace/scope/status/source_class/confidence band（low/medium/high，**不展示伪精确小数** M9-08）/first-seen/last-seen/support_count/contradiction_count。操作：查看证据/准确/部分准确/不准确/已过时/编辑 preference/固定/暂停/忘记-archive。

### D4. Evidence Drawer（M9-04）
点「查看证据」展开 memory → observation → event → attempt/question/thread 跳转。展示最小必要原文，**不暴露模型 reasoning 为「证据」**。证据链复用 M2.1 CognitiveReadStore + M5 ContextMaterializer 的 lineage。

### D5. Since Last Visit delta（M9-06，view_marker 不混入 Memory）
用 localStorage `memoryCenter.lastVisitAt` 记 view_marker。mount 时读一次，计算 lastSeen > lastVisitAt 的 delta（新发现弱项/已改善/重新出现/新高阶 pattern/skill delta/new explicit preference），load 后重写 marker。**view_marker 是 local UI state，不混入学习 Memory**（与 TechSpar `derive.ts:261 buildVisitDelta` 的 R3 思想一致，但不写 profile.json）。

### D6. 禁止伪精确人格评分（M9-08）
禁止「73.4% 逻辑能力」「82% 视觉型学习者」。展示证据计数：「在 4 个 TFNG 题中 3 次 False/Not Given 边界误判」。confidence band 只有 low/medium/high 三档。

### D7. Dream Report（M9-07）
每个 Daily/Weekly Dream 显示 input window/evidence counts/proposals/accepted-rejected/memory changes/skipped reason/failure-retry。调 `journal_get_daily`/`background_job_status`/`dream_run_daily`。Weekly 部分不再有可调的前端入口（Round-3 audit A3），UI 只读周度 dream run 行与 M8 consolidation 已持久化的数据。复用 M7 journal + M8 consolidation 已持久化的数据。

### D8. feature flag 默认 off
`VITE_FEATURE_MEMORY_CENTER_V1` 默认 false；flag off 时 route/nav 不注册，默认用户体验不变。与 learnerModelV1 一致。

## TechSpar clean-room 边界
- R3：`frontend/src/pages/profile/EvidenceTable.jsx` 证据表交互思想保留（展开证据）。
- R3：`derive.ts:261 buildVisitDelta` since-last-visit 思想保留，但 view_marker 用 local UI state 不写 profile.json（D5）。
- R3：`derive.ts:98 weakPointWeight` / `:130 buildPriorityWeaknesses` 思想保留，但用 M4 LearnerModel 的 bounded skill state（不重新算 weight）。
- N：不复制 `Profile.jsx` 的 hidden-black-box 设计（M9 的核心目标就是反黑盒）。

## 当前限制
- shadow/canary 未跑：Memory Center 是只读 UI + feedback 路径，未做 live model E2E（与 M3-M8 一致：验 contract/protocol/persistence 边界 + 确定性测试）。
- `memory.candidate_pool` reverse-RPC 当前 sample reading activity slice（M8 遗留）；Memory Center 的「系统观察」tab 当前依赖 `memory_context_preview`（bounded）。
- Evidence Drawer 的 memory→observation→event→attempt 跳转复用 M2.1 read tools，但 UI 跳转深度受限于已有 command 返回的字段。
