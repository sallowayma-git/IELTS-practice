# Phase 01：Electron 壳与导航切换（同窗口切页，回 Legacy 重载）

Based on current information, my understanding is: 本 Phase 只做一件事——把 Electron 壳搭起来，并实现**同窗口**在 Legacy 页面与写作页面之间切换；返回 Legacy 时允许直接重载；不引入 LLM/DB/复杂 UI。

---

## 【核心判断】✅ 必须先做
没有可靠的壳与切换机制，后面所有写作/LLM/DB 都是空中楼阁。

---

## 【边界（本 Phase 明确不做）】
- 不做 LLM 调用、不做 SQLite、不做题库/历史、不做设置页。
- 写作页面先用“占位页/最小 HTML”即可（后续 Phase 03 再换成 Vue 构建产物）。
- 不引 Express，不引任何“本地 API 服务端口”。

---

## 【交付物】
- `electron/main.js`：主进程入口（窗口创建、切页导航）
- `electron/preload.js`：预加载脚本（只暴露最小 `electronAPI`）
- `electron/paths.js`（可选）：统一计算资源路径（避免特殊情况）
- Legacy 侧一个入口按钮 + 降级逻辑（检测不到 electronAPI 不报错）
- 写作占位页（例如 `electron/pages/writing.html`，后续替换为 Vue 输出）

---

## 【任务清单】

### P01-001：建立 Electron 运行骨架
- [ ] 新增根 `package.json` 脚本（或扩展现有）：
  - `dev:electron` 启动 Electron（加载 Legacy）
  - `start`（可选）用于本地运行
- [ ] 引入 Electron 依赖与最小启动代码（不引其他库）。

**验收**：
- 能从命令行启动 Electron 窗口，默认进入 Legacy 页面。

### P01-002：安全默认值（别一上来就把门拆了）
- [ ] `BrowserWindow`：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`（可评估）、`webSecurity: true`
- [ ] 禁止 `new-window`/`window.open` 随便打开（统一拦截并用 `shell.openExternal` 处理白名单外链）
- [ ] `preload` 只暴露必要 API，不泄露 `ipcRenderer` 全能力

**验收**：
- 在渲染进程控制台无法 `require('fs')`；无法直接读写磁盘。

### P01-003：同窗口切页 API（主进程唯一入口）
- [ ] 主进程实现两个动作：
  - `openLegacy()` → `mainWindow.loadFile(<repo>/index.html)`
  - `openWriting()` → `mainWindow.loadFile(<repo>/electron/pages/writing.html)`（Phase 03 替换为 Vue 输出）
- [ ] `preload` 暴露：
  - `window.electronAPI.openWriting()`
  - `window.electronAPI.openLegacy()`

**验收**：
- Legacy 页面点击按钮可切到写作占位页；写作页点击返回可回到 Legacy（页面会重载）。

### P01-004：Legacy 入口按钮（降级兼容）
- [ ] 在 Legacy 顶部导航/设置区新增“写作评判”入口
- [ ] 入口点击逻辑：
  - `if (window.electronAPI?.openWriting) window.electronAPI.openWriting()`
  - 否则提示“需在桌面版使用”或直接隐藏按钮（推荐隐藏）

**验收**：
- 浏览器 `file://` 打开 `index.html` 不报错，不出现死按钮。

---

## 【测试与门禁】

### 本 Phase 额外冒烟（必须手动做一次）
- [ ] Electron 启动 → 默认 Legacy
- [ ] 点击“写作评判” → 进入 writing 占位页
- [ ] 点击“返回练习” → 回 Legacy（确认重载可接受）
- [ ] DevTools 检查：渲染进程无 Node 权限

### 强制回归（不跑就是垃圾提交）
```bash
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
```

---

## 【风险点与对策】
- `file://` 下资源路径：所有新页面/资源都用相对路径；写作 Vue 必须 Hash 路由（Phase 03 处理）。
- 切回 Legacy 重载导致状态丢失：本路线接受；但要确认 Legacy 的关键进度本来就落在 localStorage（否则用户会骂）。

