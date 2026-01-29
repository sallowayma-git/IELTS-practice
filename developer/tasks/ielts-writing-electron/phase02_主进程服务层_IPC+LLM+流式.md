# Phase 02：主进程服务层（IPC 合约 + LLM 调用 + 流式事件 + 加密存储）

Based on current information, my understanding is: 本 Phase 把“写作评判的后端能力”全部放到 Electron 主进程：API 配置（含密钥加密）、提示词、SQLite、LLM 调用与“流式事件”；渲染进程只负责 UI。

---

## 【需求文档定位】（对应章节，便于对照）
- 文档路径：`developer/docs/雅思AI作文评判应用完整需求文档.md`
- 关联章节：
  - 2.1 技术栈选型（后端/桌面）
  - 3. 数据库设计（topics/essays/api_configs/app_settings/prompts）
  - 4. API 接口设计（evaluate/configs/prompts/topics/essays）
  - 7. 文件存储结构（userData/db/images/logs）
  - 8. 提示词配置模板
  - 11. 技术风险与应对策略（LLM 质量/成本/SQLite 并发）

---

## 【核心判断】✅ 必须下沉主进程
让渲染进程直接拿 API Key/直连第三方就是安全设计垃圾；而且你还要兼容多供应商与流式，主进程集中处理才不会满地 if。

---

## 【边界（本 Phase 明确不做）】
- 不做完整 Vue UI（Phase 03 才做），本 Phase 可用最小 HTML 或简单调用脚本验证 IPC。
- 不做“题库/历史完整 UI”（Phase 04）。

---

## 【IPC 合约（先定死，后面照这个写 UI）】

> 目标：一个“清晰、最小、可测试”的 API。任何额外能力都必须证明必要性，否则就是垃圾膨胀。

### namespaces
- `app.*`：版本、路径、日志等
- `configs.*`：API 配置 CRUD + 测试连接
- `prompts.*`：提示词版本管理
- `topics.*`：题库（Phase 04 扩展）
- `essays.*`：历史记录（Phase 04 扩展）
- `evaluate.*`：评测会话（流式）

### evaluate（流式）
- `evaluate.start(payload) -> {sessionId}`
- `evaluate.cancel({sessionId}) -> {ok}`
- 事件通道：`evaluate:event`（`webContents.send`）
  - `{sessionId,type:'progress',step,percent,message}`
  - `{sessionId,type:'score',data:{...}}`
  - `{sessionId,type:'sentence',data:{...}}`
  - `{sessionId,type:'feedback',data:{...}}`
  - `{sessionId,type:'complete'}`
  - `{sessionId,type:'error',code,message,detail?}`

**强制约束**：
- 事件必须带 `sessionId`，否则并发时必乱。
- 主进程必须维护 `sessionId -> AbortController`，取消必须有效。
- 超时策略明确：例如 120s 无 complete 则 `error:timeout` 并清理资源。

---

## 【数据/安全约束】

### API Key 存储
- **不得**明文存 SQLite / localStorage。
- 优先方案：Electron `safeStorage` 加密字符串后入库（解密只在主进程进行）。
- 写作渲染进程永远只看到“配置名称/是否默认/是否启用”，看不到 key。

### 数据库位置
- 统一使用 Electron 的 `app.getPath('userData')` 下目录（不同 OS 路径差异别到处 if）。
- DB schema/migrations 必须可重复执行且幂等。

---

## 【任务清单】

### P02-001：建立 SQLite 层（schema + migrations + DAO）
- [ ] 选择 SQLite 实现（强制写决策记录）：
  - A: `better-sqlite3`（同步、性能好，但原生模块打包风险高）
  - B: `sqlite3`/`sqlite`（兼容性相对好，但 API/性能权衡）
- [ ] 落地：`db/schema.sql` + `db/migrations/` + 迁移执行器
- [ ] 提供最小 DAO：`api_configs`, `prompts`（Phase 04 再加 topics/essays）

**验收**：
- 冷启动自动初始化 DB；重复启动不重复插入默认设置。

### P02-002：API 配置 CRUD + 测试连接
- [ ] `configs.list/create/update/delete/setDefault/toggleEnabled/test`
- [ ] Provider 适配层（至少 OpenAI-compatible）：
  - base_url、headers、模型名
  - `test` 用最小请求，不要浪费 tokens

**验收**：
- UI/脚本能新增配置、测试连接、设默认；失败错误码清晰（`invalid_api_key`/`network_error`/`rate_limited`）。

### P02-003：提示词管理（默认版本 + 导入/导出）
- [ ] 默认提示词落地为内置资源（随应用发布）
- [ ] `prompts.getActive(task_type)` / `prompts.import(json)` / `prompts.exportActive()`
- [ ] 导入校验：版本号、必填字段、大小限制

**验收**：
- 导入坏 JSON 不崩；错误信息能定位问题字段。

### P02-004：评测会话（LLM 调用 + 流式解析 + 结构化校验）
- [ ] 评测输入：`task_type/topic/content/word_count/config_id/prompt_version`
- [ ] 输出必须满足 `evaluation v1` schema（不满足就走降级：保存 raw 文本 + error）
- [ ] 流式实现：
  - 主进程解析供应商流式响应
  - 逐步 emit `progress/score/sentence/feedback`
- [ ] 取消/超时/重试策略写清楚（不允许 UI 自己瞎猜状态）

**验收**：
- 能稳定从 start 到 complete；取消能立即终止网络请求并停止发事件。

### P02-005：日志与诊断（可定位问题，而不是“报错了”）
- [ ] 主进程统一 logger（按天滚动/大小限制，最少实现）
- [ ] 每个 sessionId 关联 trace（请求参数摘要、provider、耗时、错误栈）
- [ ] 写作 UI 提供“导出诊断信息”入口（Phase 05 可做）

---

## 【测试与门禁（本 Phase 重点）】

### 新增：主进程合约自测（放 `developer/tests/`）
> 不要等 UI 做完才发现 IPC 合约是垃圾。
- [ ] 可无 UI 启动主进程并跑：
  - configs CRUD（含 safeStorage 加/解密）
  - prompts import/export 校验
  - evaluate 的 mock provider（不用真打 LLM；验证事件顺序/取消/超时）

### 强制回归
```bash
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
```

---

## 【风险点与对策】
- 多供应商差异：先定义“OpenAI-compatible”作为主路径；其他 provider 通过 adapter 逐个补齐。
- 流式解析不稳定：所有解析都做容错，绝不让 JSON.parse 直接炸穿进程。
- SQLite 打包：尽早在 Phase 05 做一轮打包验证，不要拖到最后。
