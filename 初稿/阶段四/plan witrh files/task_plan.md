# Task Plan: 阶段四 — 功能完善与体验优化

## Goal
完成 IELTS Practice 阶段四全部 6 个任务（GoalManager UI、移动端优化、数据洞察增强、测试覆盖扩展、构建优化、词汇体验增强），将版本推进至 0.4.0。

## Current Phase
Phase 1 — 规划与任务拆解

## Phases

### Phase 1: 规划与任务拆解
- [x] 分析当前代码库状态
- [x] 识别已完成和未完成的功能
- [x] 编写阶段四任务书
- [x] 编写工程追踪记录表
- [x] 创建 planning-with-files 文档
- [ ] 创建外部资源路径索引
- **Status:** in_progress

### Phase 2: GoalManager 核心实现 (4.1)
- [ ] 创建 goalManager.js 核心逻辑
- [ ] 创建目标设定 UI 组件
- [ ] 总览页集成目标卡片
- [ ] 练习事件监听与进度更新
- [ ] 目标达成通知
- [ ] 数据持久化
- [ ] 单元测试
- **Status:** pending

### Phase 3: 数据洞察增强 (4.3)
- [ ] 本周学习趋势折线图
- [ ] 薄弱题型雷达图
- [ ] 学习热力图
- [ ] 最近练习快捷入口
- [ ] 统计刷新优化
- **Status:** pending

### Phase 4: 词汇体验增强 (4.6)
- [ ] 词汇复习提醒
- [ ] 词汇学习统计
- [ ] CSV 导入
- [ ] 生词本一键添加
- **Status:** pending

### Phase 5: 测试覆盖扩展 (4.4)
- [ ] GoalManager 单元测试
- [ ] vocabStore 单元测试
- [ ] dictionaryService 单元测试
- [ ] practiceRecorder 单元测试
- [ ] E2E 词汇学习流程
- [ ] E2E 目标流程
- [ ] 静态分析更新
- **Status:** pending

### Phase 6: 移动端优化 (4.2)
- [ ] CSS 媒体查询审计
- [ ] 题库卡片布局适配
- [ ] 导航栏折叠
- [ ] 阅读页移动端适配
- [ ] 触控目标尺寸
- [ ] 横屏兼容
- **Status:** pending

### Phase 7: 构建优化 (4.5)
- [ ] Bundle 大小分析
- [ ] 未使用模块清理
- [ ] 懒加载优化
- [ ] CSS 冗余清理
- [ ] 功能验证
- **Status:** pending

## Key Questions
1. GoalManager 是否需要与现有 achievementManager 联动？（是，目标达成可触发成就）
2. 图表渲染使用 Canvas 还是 SVG？（优先 SVG，file:// 兼容性更好）
3. 移动端导航用汉堡菜单还是底部标签栏？（汉堡菜单，保持与桌面端一致性）
4. CSV 导入是否需要支持批量？（是，支持多行导入）

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| GoalManager 独立模块 | 不与 achievementManager 耦合，保持单一职责 |
| SVG 图表 | file:// 兼容，无外部依赖 |
| CSS 媒体查询渐进增强 | 桌面优先，移动端补充 |
| 测试先行（GoalManager） | 新模块应有完整测试覆盖 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| — | — | — |

## Notes
- Update phase status as you progress: pending → in_progress → complete
- Re-read this plan before major decisions
- Log ALL errors
