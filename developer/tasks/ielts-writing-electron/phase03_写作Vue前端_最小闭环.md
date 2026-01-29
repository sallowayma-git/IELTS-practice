# Phase 03：写作 Vue 前端（最小闭环：输入→评分→结果）

Based on current information, my understanding is: 本 Phase 用 Vue 3 做“写作专用前端”，并替换 Phase 01 的 writing 占位页；只实现最小闭环（Compose→Evaluating→Result），所有数据/LLM/DB 通过 `window.electronAPI` 走 IPC。

---

## 【需求文档定位】（对应章节，便于对照）
- 文档路径：`developer/docs/雅思AI作文评判应用完整需求文档.md`
- 关联章节：
  - 5. 前端组件树结构（写作模块视图/组件）
  - 6.2 作文输入与评分
  - 6.3 评分结果展示
  - 9. 用户体验流程（标准评分流程）

---

## 【核心判断】✅ 可以做，但必须守住边界
Vue/组件库不是问题；问题是把渲染进程做成“半个后端”——那是垃圾架构。

---

## 【边界（本 Phase 明确不做）】
- 不做题库管理/历史列表完整功能（Phase 04）。
- 不做多语言/复杂设置/备份恢复（Phase 04/05）。
- 不做“与 Legacy 同页面共存”（禁止混跑）。

---

## 【工程约束（必须满足，否则 `file://` 下会炸）】
- 路由：Hash 模式（刷新/深链不依赖服务器）
- 构建：资源路径使用相对 base（例如 Vite `base: './'`）
- 网络：前端不 `fetch` 第三方 LLM，不读本地文件；只调用 `window.electronAPI.*`

---

## 【页面最小集（闭环必须齐）】
- `Compose`：选择 Task1/Task2、输入作文、字数统计、提交
- `Evaluating`：显示进度（基于 `evaluate:event`）
- `Result`：显示总分+四项分数+句子错误高亮+整体建议
- `Nav`：返回 Legacy（调用 `window.electronAPI.openLegacy()`）

---

## 【任务清单】

### P03-001：创建写作 Vue 工程（独立目录，独立构建）
- [ ] `apps/writing-vue/` 初始化（Vite + Vue3）
- [ ] 依赖：Vue Router（Hash）、状态管理（可选 Pinia）、UI（先 minimal）
- [ ] 构建输出到 `dist/writing/`（Electron 用 `loadFile` 直接加载）

**验收**：
- 构建产物可被 Electron `loadFile(dist/writing/index.html)` 加载，静态资源不 404。

### P03-002：IPC 适配层（前端唯一数据入口）
- [ ] 前端封装一个 `apiClient`：
  - `configs.*` / `prompts.*` / `evaluate.*`
  - 统一错误展示（错误码→用户文案）
- [ ] 事件订阅：
  - `electronAPI.onEvaluateEvent((evt)=>...)`（preload 需要提供）

**验收**：
- 前端不出现“到处直接调用 electronAPI”的散弹式代码（那是维护垃圾）。

### P03-003：最小评测流程
- [ ] Compose 点击提交：
  - 基础校验（空内容、字数不足二次确认）
  - `evaluate.start` 获取 `sessionId`
  - 跳转 Evaluating
- [ ] Evaluating 监听事件，更新进度/展示 score/sentences 预览
- [ ] complete 后跳转 Result

**验收**：
- 端到端跑通一次（可用 mock provider）；取消/失败能回到 Compose。

### P03-004：结果渲染（最小但正确）
- [ ] 高亮渲染必须基于 `range.unit=utf16` 的 `start/end`
- [ ] 错误类型→颜色映射固定（与需求文档一致即可）
- [ ] 降级展示：结构化解析失败时展示 raw（并提示重试）

**验收**：
- 高亮不乱跳、不越界；坏数据不崩。

---

## 【测试与门禁】

### 写作 UI 冒烟（最少要有脚本/手册）
- [ ] 打开写作模块 → 输入 → 提交 → 看到 progress → 看到 complete → Result 正常渲染
- [ ] 取消评分 → 回 Compose，内容仍在（通过 DB/草稿机制，Phase 04 可补）
- [ ] 返回 Legacy → Legacy 重载正常

### 强制回归
```bash
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
```

---

## 【风险点与对策】
- 组件库/编辑器引入过早：先跑通闭环，Tiptap/ElementPlus 放 Phase 04 再加。
- `file://` 下模块脚本路径：Vite 的 base/assetFileNames 必须验证，不要想当然。
