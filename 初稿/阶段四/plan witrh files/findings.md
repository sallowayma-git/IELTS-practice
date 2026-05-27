# Findings & Decisions — 阶段四

## Requirements
- 实现学习目标系统（GoalManager UI）
- 优化移动端响应式体验
- 增强总览仪表盘数据洞察
- 扩展测试覆盖
- 优化构建产物
- 增强词汇学习体验

## Research Findings

### 项目当前状态分析 (2026-05-27)

**已完成的核心系统**：
- 阅读练习：统一阅读页面 (`unifiedReadingPage.js`)，支持答题、提交、解析、背题模式
- 听力练习：通过 `listeningRecordBridge.js` 接入，P1-P4 静态桥接已部署
- 套题模式：`suitePracticeMixin.js` 实现连续练习与聚合记录
- 练习记录：`practiceRecorder.js` + `practiceRepository.js`，IndexedDB 优先存储
- 词汇系统：`vocabStore.js` + `vocabScheduler.js`（SM-2 调度）+ `vocabSessionView.js` + `vocabDashboardCards.js`
- 成就系统：`achievementManager.js`，基于练习统计的成就解锁
- 数据管理：备份/导入/导出/完整性检查 (`dataBackupManager.js`, `DataIntegrityManager.js`)
- 词典服务：`dictionaryService.js`，支持离线查询
- 引导流程：`onboardingTour.js`，首次使用引导

**未实现的功能**：
- GoalManager：wiki 文档中有完整设计（`js/core/goalManager.js` L5-L391），但代码库中不存在该文件
- 目标 UI 组件：无
- 移动端专门适配：CSS 中有部分媒体查询，但未系统化
- 学习热力图：无
- 趋势折线图：无
- 薄弱题型雷达图：`legacyViewBundle.js` 中有阅读雷达图实现，但未在总览页集成

**关键文件清单**：
- `js/views/overviewView.js` — 总览视图，当前展示分类卡片和统计
- `js/views/legacyViewBundle.js` — 练习统计服务，含雷达图、趋势图等数据计算
- `js/services/overviewStats.js` — 统计数据服务
- `js/services/achievementManager.js` — 成就管理
- `js/core/vocabStore.js` — 词汇存储
- `js/core/vocabScheduler.js` — SM-2 调度
- `js/core/dictionaryService.js` — 词典服务
- `js/core/practiceRecorder.js` — 练习记录器
- `js/runtime/unifiedReadingPage.js` — 统一阅读页面
- `scripts/build-bundles.mjs` — 构建脚本

**Bundle 结构**：
- `runtime-entry.bundle.js` — 启动入口
- `core-foundation.bundle.js` — 核心基础
- `ui-shell.bundle.js` — UI 外壳
- `legacy-app.bundle.js` — 旧版兼容
- `practice.bundle.js` — 练习模块
- `session.bundle.js` — 会话模块
- `browse.bundle.js` — 浏览模块
- `settings.bundle.js` — 设置模块
- `more.bundle.js` — 更多工具
- `reading-page.bundle.js` — 阅读页面
- `listening-record-bridge.bundle.js` — 听力桥接

**测试基础设施**：
- `developer/tests/ci/run_static_suite.py` — 静态分析
- `developer/tests/e2e/suite_practice_flow.py` — E2E 流程测试
- `developer/tests/js/` — JS 单元测试（practiceCustomCard, serviceFacade, suiteModeRegression 等）

### 雷达图现状分析

`legacyViewBundle.js` 中已有 `renderReadingRadar()` 方法，基于 `readingRadarData` 渲染 Canvas 雷达图。数据来源于练习记录中的错题题型统计。该功能目前在练习记录页面使用，未集成到总览页。

### GoalManager 设计分析

Wiki 文档描述了完整的 GoalManager 架构：
- GoalManager 类管理目标生命周期
- 支持 daily/weekly/monthly 目标周期
- 支持 practices/time/accuracy 目标类型
- 通过 `practiceSessionCompleted` 事件自动更新进度
- 含 streak 计算逻辑
- 存储键：`learning_goals` 和 `goal_progress`

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| GoalManager 独立于 achievementManager | 单一职责，目标和成就是两个关注点 |
| 图表使用 SVG | file:// 兼容性好，无外部依赖，可直接嵌入 DOM |
| 保持现有 bundle 分组 | 避免引入不必要的变更风险 |
| CSS 媒体查询而非 JS 检测 | 性能更好，无布局抖动 |
| SM-2 调度器已有实现复用 | vocabScheduler.js 已实现 SM-2，复习提醒直接查询即可 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| — | — |

## Resources
- 项目 README: `README.md`
- 架构文档: `developer/doc/Wiki/`
- 开发路线图: `developer/doc/Wiki/Development-Roadmap-&-Refactoring-Tasks.md`
- 任务书: `初稿/阶段四/阶段四任务书.md`
- 追踪表: `初稿/阶段四/阶段四工程追踪记录表.md`

## Visual/Browser Findings
<!-- CRITICAL: Update after every 2 view/browser operations -->
-

---
*Update this file after every 2 view/browser/search operations*
