# Anthropic 设计语言全量重构 — findings

## 背景
用户反馈前端审美过丑（Liquid Glass 冷蓝紫 + 磨砂玻璃 + 重投影）。要求全量重构为 Anthropic 设计语言（Claude.ai/Claude Code 视觉风格）：暖米白底、克制橘棕强调色、衬线标题 + 无衬线正文、细边框、极浅阴影、单色线性图标、仅浅色模式、系统字体兜底。

## 改动文件
- `apps/writing-vue/src/styles/design-system/tokens.css` — 新建 Anthropic token 系统。
- `apps/writing-vue/src/styles/design-system/aliases.css` — 重写：旧 token 名映射到新 token。
- `apps/writing-vue/src/styles/design-system/base.css` — 重写 reset + 结构原语。
- `apps/writing-vue/src/styles/design-system/index.css` — import 顺序 tokens -> aliases -> base。
- `apps/writing-vue/src/styles/main.css` — import design-system + opensource-skin。
- `apps/writing-vue/src/styles/opensource-skin.css` — 全量重写 4689 行 -> 1009 行 Anthropic 风格。
- `apps/writing-vue/src/styles/a11y-performance.css` — focus-ring / skip-link 改用 anth token。
- `apps/writing-vue/src/components/NavBar.vue` — scoped 样式清理（结构/逻辑不动）。
- `apps/writing-vue/src/components/ShuiBackground.vue` — 动态 orb 移除，静态暖米白底。

## 设计 token 关键决策
1. 强调色 --anth-accent: #C15F3C (Claude clay)，替换原 #6d5dfc/#3185ff 蓝紫。
2. 底色 --anth-canvas: #F5F4EE (暖米白)，surface #FFFFFF，sunken #EFEDE4。无冷白/渐变。
3. 文字 --anth-ink: #1F1F1F，soft #4A4A4A，faint #6B6B6B，strong #141414。
4. 字体栈（系统兜底零 webfont）：
   - serif (标题): "Source Han Serif SC","Noto Serif SC","Songti SC","SimSun",Georgia,"Times New Roman",serif
   - sans (正文): "Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif
5. 圆角克制：xs 4 / sm 6 / md 8 / lg 10 / xl 12 px。
6. 阴影极浅：最重 0 4px 12px rgba(31,31,31,0.08)，靠 1px 细边框分区。
7. 间距 4px 基准阶梯。
8. 仅浅色：删除 dark-mode 分支，无深色 alias。
9. 兼容性：aliases.css 把每个旧变量名映射到新 token，组件 var(--atlas-*)/var(--lg-*)/var(--shui-*) 全部透明解析，零 template 改动。

## 验证结果

### npm.cmd --prefix apps/writing-vue run build
built in 1.13s (CSS: index 46.00 kB/gzip 8.08 kB; PracticeLibraryPage 17.03 kB/gzip 3.40 kB; SettingsPage 29.85 kB/gzip 4.61 kB)

### npm.cmd --prefix apps/writing-vue run typecheck
vue-tsc --noEmit 退出 0，无错误。

### python developer/tests/ci/run_static_suite.py
status: pass
summary: {total: 27, passed: 27, failed: 0}
报告: developer/tests/e2e/reports/static-ci-report.json

关键子检查全 pass：Vue production build / Vue typecheck / Tauri Vue shell contract (含 .atlas-source-ui .practice-library 契约) / Reading+Writing 全部 JS 契约 9 项 / Phase 10 release contract / AI configuration security / Reading source data integrity / Python cognitive protocol 417 tests / M3+M4 contract / Rust workspace check + 各 Rust 测试。

## 不破坏功能的保证
- 仅改 CSS + 两个组件 scoped 样式 + ShuiBackground 静态化。未触碰 router/repositories/Tauri 调用/feature flags/业务逻辑。
- 全部旧 CSS 变量名保留并映射，组件 template class 名不变，selector 名不变。
- practiceVueShell 契约要求的选择器全部保留。
