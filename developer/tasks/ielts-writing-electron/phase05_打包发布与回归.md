# Phase 05：打包发布与回归（electron-builder、崩溃诊断、跨平台）

Based on current information, my understanding is: 本 Phase 把“能跑的应用”变成“用户能安装/升级、出现问题能定位、跨平台不炸”的可交付产品；并把回归做成固定门禁。

---

## 【需求文档定位】（对应章节，便于对照）
- 文档路径：`developer/docs/雅思AI作文评判应用完整需求文档.md`
- 关联章节：
  - 2.1 技术栈选型（Electron Builder）
  - 7. 文件存储结构（userData/db/images/logs）
  - 10. 开发优先级建议（Phase 5）
  - 11. 技术风险与应对策略（跨平台/SQLite/备份）

---

## 【核心判断】✅ 必做
不打包、不回归、不诊断，前面做的功能只是自嗨。

---

## 【边界】
- 自动更新/代码签名可按实际资源决定，但必须在文档里明确“做/不做”的理由。
- 先保证 macOS（你的开发机）闭环，再扩到 Windows/Linux。

---

## 【改进章节：已知阻断问题修复方案（必须先做）】

### I-01 写作页无导航 UI（Electron）
**问题定位**
- `electron/main.js`：写作页优先加载 `dist/writing/index.html`，不存在则回退 `electron/pages/writing.html`（占位页无导航）。
- `apps/writing-vue/src/App.vue` + `apps/writing-vue/src/components/NavBar.vue`：导航实际已做，但 Electron 没加载到 Vue 构建产物。

**根因**
- 打包/开发未构建 `dist/writing`，触发占位页回退。
- 打包文件未明确包含 `dist/writing/**`，运行时找不到构建产物。

**解决方案**
- P0：把 `apps/writing-vue` 构建变成硬依赖（打包/启动前强制 `vite build` 输出到 `dist/writing`）。
- P0：electron-builder files/include 显式加入 `dist/writing/**`（避免被忽略）。
- P1：`electron/main.js` 若检测不到构建产物，弹窗提示 + 自动回退 Legacy（不要悄悄展示占位页）。

**涉及文件**
- `apps/writing-vue/vite.config.js`
- `electron/main.js`
- `electron/pages/writing.html`

**验证**
- Electron 切到写作页后，顶栏导航可用（作文/题目/历史/设置均可进入）。

---

### I-02 Legacy 题目页缺退出/返回按钮（Electron）
**问题定位**
- `js/practice-page-enhancer.js` 只在 `.practice-nav .controls` 注入返回按钮。
- Listening/Reading 的大量旧 HTML 页面使用 `.bottom-bar` 布局（无 `.practice-nav`），导致注入失败。
- 这段注入逻辑是 **垃圾**：它把容器写死为单一结构，直接破坏现有页面兼容性。

**解决方案**
- P0：抽象 `resolveBackButtonHost()`，按优先级寻找容器：`.practice-nav .controls` → `.bottom-bar .bb-left` → `.bottom-bar` → `body`（固定浮层按钮）。
- P0：按钮样式复用页面已有样式类（如 `.top-bar-button` / `.bb-center button`），无则 fallback 内联样式。
- P1：保留 `window.electronAPI.openLegacy()` 作为唯一返回入口，不依赖 `window.close()`。
- P1（可选）：在 `electron/main.js` 放行项目内 `file://` 的 `window.open`（白名单路径），确保新窗口可关闭但不放开外域。

**涉及文件**
- `js/practice-page-enhancer.js`
- `electron/main.js`（可选）

**验证**
- 任一题目页（听力/阅读/套题）均出现“返回主页”按钮，点击可回到 Legacy 主界面。

---

### I-03 写作模块 UI 丑，与 Legacy 视觉割裂
**问题定位**
- 写作页当前使用独立紫色渐变/按钮体系（`apps/writing-vue/src/styles/main.css` + `App.vue`），与 Legacy 主界面风格不一致。

**解决方案**
- P0：以 `css/main.css` + `css/heroui-bridge.css` 作为视觉基准，抽取关键 Design Tokens（字体、按钮、圆角、阴影、背景）到写作模块。
- P0：替换 `App.vue` 背景与 `NavBar` 风格，改为 Legacy 的 panel/hero 风格（避免继续紫色渐变）。
- P1：统一按钮（`btn/btn-primary/btn-secondary`）与卡片样式（阴影/边框/圆角），对齐 Legacy 交互手感。

**涉及文件**
- `apps/writing-vue/src/styles/main.css`
- `apps/writing-vue/src/App.vue`
- `apps/writing-vue/src/components/NavBar.vue`
- `apps/writing-vue/src/views/*.vue`

**验证**
- 写作模块按钮、卡片、背景与 Legacy 主界面视觉一致，整体不违和。

---

### I-04 题目资源不打包，改为外部分发（用户自放）
**问题定位**
- 题库体量巨大，打进安装包会导致体积暴涨、下载慢、更新痛苦。

**解决方案**
- P0：题库不进安装包，改为单独资源包分发（Listening / Reading）。
- P0：**路径约定固定**，用户只需解压到应用目录同级：
  - `ListeningPractice/`（听力）
  - `睡着过项目组/2. 所有文章(11.20)[192篇]/`（阅读）
- P1：启动/进入题库时做缺失提示（明确告诉用户“放到哪里、叫什么”）。
- P1：文档写清安装步骤（下载 → 解压 → 放置 → 重启）。

**涉及文件（文档/说明为主）**
- `developer/tasks/ielts-writing-electron/phase05_打包发布与回归.md`
- （若需要 UI 提示）`js/services/libraryManager.js` / 相关设置页

**验证（必须手动测试打包后路径机制）**
- 打包配置验证：`package.json` build.files 已排除 `!ListeningPractice/**/*` 和 `!睡着过项目组/**/*`
- **路径可达性验证（P0 关键）**：
  1. 运行 `npm run pack` 打包应用到 `dist/`
  2. 安装/解压打包产物，运行应用
  3. 将 `ListeningPractice/` 和 `睡着过项目组/` 放到应用安装目录同级
  4. 验证Listening/Reading题目能正常打开（file://协议 + 相对路径机制）
  5. **若失败**：检查 `hp-path.js` 的 `HP_BASE_PREFIX` 在打包环境下的路径解析逻辑
- 资源缺失提示：启动时若资源不存在，给出明确提示（告知放置位置和目录名）
- 路径大小写：macOS/Windows/Linux 均使用 `ListeningPractice`（大写P）确保跨平台兼容

---

## 【任务清单】

### P05-001：electron-builder 配置与产物验证
- [ ] 配置打包（appId、产物目录、图标、文件包含规则）
- [ ] 验证构建产物能启动并完成关键路径（Legacy→写作→返回）
- [ ] 原生依赖（若使用 better-sqlite3 等）在打包环境可用

### P05-002：崩溃/日志/诊断导出
- [ ] 主进程崩溃捕获与提示（防止静默退出）
- [ ] 诊断导出：打包一份（版本、平台、最近日志、DB schema 版本，不含明文 key）

### P05-003：发布流程与版本策略
- [ ] 版本号策略：与仓库版本一致
- [ ] Release checklist（人工也行，先把步骤写死）

### P05-004：外部资源路径验证（I-04配套验证）
- [ ] 执行 `npm run pack` 打包应用到 `dist/`
- [ ] 安装/解压打包产物并运行
- [ ] 将 `ListeningPractice/` 和 `睡着过项目组/` 放到应用安装目录同级
- [ ] 验证Listening/Reading题目能正常加载（file://协议 + hp-path.js相对路径机制）
- [ ] 若失败：调整 `HP_BASE_PREFIX` 或路径解析逻辑

---

## 【回归门禁（交付前必须全部通过）】

### 现有套件（必须）
```bash
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
```

### Electron 冒烟（必须）
- [ ] 新装启动：默认进入 Legacy
- [ ] 切到写作：可评分一次（或 mock 评分）并看到结果
- [ ] 取消评分：不崩，回编辑页
- [ ] 返回 Legacy：重载正常
- [ ] 断网/坏 key：错误码与提示正确，不崩

---

## 【风险点与对策】
- Windows 路径/权限：所有路径必须来自 `app.getPath('userData')`，不要手拼。
- 原生模块：越晚验证越痛苦；Phase 02 选型后就应该尽快跑一次打包试验。
