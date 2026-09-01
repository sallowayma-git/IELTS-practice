# Findings: UI polish takeover 2026-08-24

## Source

ZCode log `C:\Users\25788\.zcode\cli\log\zcode-2026-08-24.jsonl` + model-io for:

- `sess_ad9d8573-fb82-4e83-9042-4e29c8ce4604`（Anthropic 重构 / 考场皮肤 / Agent 控制台 / 清理提交）
- `sess_d1d85521-9e03-4799-8ed4-60964f852382`（前端打磨分批；批次4中断）

Workspace: `F:\workspace\IELTS Atlas APP`（不是 TeachingAssistantWorkstation）。

## User intent (verbatim gist)

1. 前端各种显示问题、按钮不匹配、边界不清晰、粗糙 → 打磨。
2. 分批、收束设计系统；除 EvaluatingPage 先不动。
3. 多次「继续」；zcode 在批次4中途因 API key 过期失败。

## Code state at takeover

- HEAD `957e6f5f`（清理过时测试脚本，已推送）。
- 未提交：批次1–3 的 token/原语/字号改动 + 批次4 半成品。
- 已有未跟踪 `apps/writing-vue/src/styles/design-system/exam-theme.css` 和 `apps/writing-vue/src/utils/score-color.js`。
- `PracticeReadingPage.vue` 考试皮肤已大部分改用 `var(--exam-*)`，仍残留 `#ffffff` 与 `rgba(255,255,255,0.88)`。
- 考试皮肤规则仍在 4700 行 Vue SFC 的未 scoped `<style>` 末尾；面板组件本身无 `<style>`。
- EvaluatingPage 工作树未改。

## Decisions

| Decision | Rationale |
|----------|-----------|
| 考试皮肤作为设计系统第二主题，token 放 `:root` | 获准偏离陶土主色；`.reading-page` 消费 `var(--exam-*)` |
| 面板 CSS 抽到 `modules/practice-reading/styles/page.css` | 组件无自身样式，父页未 scoped 块就是面板样式真值 |
| z-index 映射到 anth 分层，不保留 2500/9999 | 批次1已冻结分层；阅读页与 Nav/skip-link 共用同一把尺 |
| 不改 EvaluatingPage | 用户明确冻结 |
| Agent 今日整理必须过 format.js | `DailyJournal.facts` 是对象；Vue `{{ object }}` 会 JSON.stringify，这就是用户看到的裸代码 |
| 工作台布局 CSS 放回 console.css，不进 skin | Anthropic 重构把 `.agent-workbench` 从 opensource-skin 删掉；三栏 grid 变成 none，控件退回浏览器默认按钮 |
| E2E 钉死的 Run ID / read_file 保持英文 | `packaged_tauri_flow.py` 读 `.agent-output-metadata dt` 和 `.agent-run-steps` 文本 |
