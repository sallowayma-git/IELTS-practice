# Task Plan: IELTS Vue UI polish (design-system consolidation)

## Goal

在 `apps/writing-vue` 收束设计系统：统一 token/原语，消除按钮/弹窗/字号/考试皮肤分叉；不改 `EvaluatingPage.vue`；每批后跑静态套件 + E2E。

## Frozen constraints (from zcode session 2026-08-24)

- 分批进行，遵循统一视觉框架。
- 不改 `EvaluatingPage.vue`。
- 保留已打磨的动画（极光球等），不特殊化、不削弱。
- 考试皮肤是获准的第二主题（CD-IELTS 藏青/白纸），不得折回陶土主色。

## Current Phase

全部批次完成（批次1-5）。等待用户确认后提交。

## Phases

### 批次1: Token 治理

- [x] tokens.css 补齐 z-index 分层 / 宽度档位 / 状态色
- [x] 清除死别名（bloom/bauhaus 已删；`--lg-*` 冻结保留）
- **Status:** complete

### 批次2: 共享原语

- [x] 皮肤层建立 dialog / dialog-actions / inline-message
- [x] Compose / Settings / TopicManage / Library 本地副本删除
- [x] History / TopicManage 宽弹窗适配
- [x] 按钮收敛（btn-text / btn-sm / secondary-button）
- **Status:** complete

### 批次3: 字号与色彩

- [x] 裸 px 字号收敛、裸 hex 换 token、getScoreColor 合并到 `utils/score-color.js`
- [x] 静态套件 + E2E 验证
- **Status:** complete

### 批次4: 考试皮肤与面板剥离

- [x] `exam-theme.css` 提升为设计系统第二主题 token
- [x] 考试皮肤剩余裸 hex 换成 token
- [x] 考试皮肤规则迁入 `exam-theme.css`
- [x] PracticeReadingPage 面板/布局 CSS 剥离到 `modules/practice-reading/styles/page.css`
- [x] skip-link 使用 `--anth-z-skip-link`；阅读页 overlay/nav 数值层未改，避免叠层回归
- [x] 静态套件 27/27 + E2E 16/16 通过
- **Status:** complete

### 批次5: Agent 控制台产品化

- [x] 今日整理：JournalFacts 对象改成中文统计行，不再 `{{ object }}` 出 JSON
- [x] 记忆陈述 / 审批 payload / 证据抽屉：去掉 JSON.stringify 与裸 UUID
- [x] 补回 Anthropic 重构时丢掉的 `.agent-workbench` 三栏布局（陶土 token，不要玻璃拟态）
- [x] 计划区 / 演化区与心跳卡同一套卡片铬；英文 eyebrow 收成中文
- [x] 保留 E2E 钉死的选择器与 metadata 英文字段（Run ID / read_file / is-complete）
- [x] 静态套件 27/27 + packaged E2E passed（2026-08-30 复验）
- **Status:** complete

## Immediate Next Actions

1. 完成批次5 并跑静态套件 + E2E。
2. 用户确认后再提交 `IELTS-WRITING-FEAT` 上的未提交打磨改动（不要提交 `.zcode/`）。
3. EvaluatingPage 仍按用户要求冻结，未改。

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| zcode API key 过期，批次4中断 | 1 | 从工作树 + model-io 恢复进度后在 Cursor 继续 |
