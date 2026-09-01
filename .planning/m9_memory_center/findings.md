# Findings

## 2026-08-16 M9

- MemoryCenterPage.vue：6 tab（关于我/系统观察/学习能力/有效讲解方式/近期变化/已归档）；Memory Item Card 含 confidence band（low/medium/high，不伪精确 M9-08）；Observed/Predicted/Consolidated/UserExplicit 视觉区分（M9-05）；Evidence Drawer 跳转 memory→observation→event→attempt（M9-04，最小必要原文，不暴露模型 reasoning）。
- view_marker 用 localStorage `memoryCenter.lastVisitAt`（M9-06），mount 读一次算 delta（新发现/已改善/重新出现/新高阶 pattern/skill delta/new preference），load 后重写。**不混入学习 Memory**。
- memory-repository.js：调 memory_context_preview/promote/put_explicit/forget + coach_record_feedback（M6）+ memory_record_feedback（M8）+ dream_run_daily/weekly（M7/M8）+ journal_get_daily + background_job_status + consolidation_archive_stale。
- feature flag `VITE_FEATURE_MEMORY_CENTER_V1` 默认 off（与 learnerModelV1 一致）；main.js route + NavBar nav 均 flag 守卫，flag off 时默认 UI 不变。
- ADR-M9 决策 D1-D8（6 tab 架构/四类视觉区分/Evidence Drawer 最小必要/view_marker local UI state/禁止伪精确/Dream Report/TechSpar derive.ts R3 clean-room）。
