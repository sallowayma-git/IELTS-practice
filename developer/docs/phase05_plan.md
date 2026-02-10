# Phase 05 实施计划（05A/05B）

> 文档时间: 2026-02-09 21:45  
> 目标: 把写作后端从“可运行”收口到“可交付”，优先修复阻断链路并补齐查询/上传闭环  
> 对应阶段: Phase 05A + Phase 05B

---

## 摘要

Based on current information, my understanding is:  
Phase 05 不追求新功能堆叠，先把阻断缺陷和闭环缺口清零，确保“提交评分→结果入库→历史可查→图片链路完整”全程可验收、可回归、可交接。

---

## 【核心判断】

✅ 值得做。  
现在的主要风险不是功能点不足，而是链路可达性和验收标准不硬。Phase 05 的价值是建立交付基线，阻断后续返工。

---

## 【关键洞察】

1. 数据流核心对象只有三类：`evaluation_session`、`essay`、`upload_image`。  
2. 需要消灭的特殊情况：前端只读 `sessionStorage`、IPC 白名单误拦、上传后无缩略图/无配套删除。  
3. 复杂度控制策略：保持 `window.writingAPI.*` 兼容，不改调用壳结构，仅补服务层闭环。  
4. 零破坏红线：既有静态回归命令必须持续通过。

---

## 【Linus式方案】

1. 先简化数据结构：以 DB 结果为单一事实源，前端 `sessionStorage` 仅作降级兜底。  
2. 消除特殊情况：统一提交完成事件返回 `essay_id`，统一历史搜索语义，统一上传返回契约。  
3. 最笨但清晰的实现：优先补齐链路验证和契约测试，不引入额外抽象层。  
4. 确认零破坏：执行既有回归 + Phase05 清单测试。

---

## 范围定义

### In Scope

- 05A: 阻断缺陷修复与契约对齐  
- 05B: 查询/上传闭环补全  
- 文档与测试门槛同步

### Out of Scope

- Provider 主备调度强化（Phase 06）  
- 提示词版本治理强化（Phase 07）  
- 设置页全量重构（Phase 08）

---

## 05A：阻断缺陷修复（链路可达）

### 目标

保证主流程 `Compose -> Evaluating -> Result -> History` 可完整走通，且结果以 DB 为准。

### 任务清单

- [ ] 统一 `ComposePage` 与 `useDraft` 调用契约，清理无效 `stopAutoSave` 调用风险。  
- [ ] 修复 IPC 白名单，放行 `dist/writing/index.html` 合法调用。  
- [ ] 评分完成后主进程落库 `EssayService.create`，`complete` 事件返回 `essay_id`。  
- [ ] 结果页优先按 `essay_id` 读取 DB，`sessionStorage` 保留降级兜底。  
- [ ] 明确取消/失败分支不写入脏数据。
- [ ] 评分失败后写入 `evaluation_sessions.status='failed'`，并记录 `error_code`、`error_message`。

### 验收标准

- [ ] 提交一篇作文后，结果页可直接从 DB 读取评分 JSON。  
- [ ] 用户刷新结果页后数据不丢失。  
- [ ] IPC 不再误拦写作页面 API 调用。  
- [ ] 取消评测后会话状态正确，且无新 essay 脏记录。
- [ ] 模拟网络断开后，会话状态落为 `failed`，不存在残留 `running` 会话。

### 风险与回滚

- 风险: 事件字段扩展导致前端兼容问题。  
- 回滚: 保留原返回壳结构 `{ success, data/error }`，新增字段仅可选。

---

## 05B：查询/上传闭环（体验可交付）

### 目标

保证历史搜索命中题目与内容，图片上传返回完整路径并可清理残留。

### 任务清单

- [ ] `essays` 查询支持 `topic_title/content` 关键词 LIKE。  
- [ ] 历史导出沿用同一搜索语义，避免列表与导出不一致。  
- [ ] `upload:image` 返回扩展为 `{ image_path, thumbnail_path, size }`。  
- [ ] 删除图片时同时清理原图和缩略图，避免磁盘残留。  
- [ ] Task1 图片预览链路字段对齐。

### 验收标准

- [ ] 历史页按题目标题关键词可命中记录。  
- [ ] 历史页按作文正文关键词可命中记录。  
- [ ] 导出 CSV 与当前筛选结果一致。  
- [ ] 上传图片后可拿到缩略图路径并展示。  
- [ ] 删除后原图/缩略图均不存在。

### 风险与回滚

- 风险: 旧数据无缩略图字段。  
- 回滚: 前端对 `thumbnail_path` 使用可选渲染，不阻断旧记录显示。

---

## 公共接口与兼容约束

- [ ] 保持 `window.writingAPI.*` 现有命名与调用方式。  
- [ ] 保持返回壳结构不变：`{ success, data/error }`。  
- [ ] 允许新增可选字段：`essay_id`、`thumbnail_path`。  
- [ ] 禁止删除或重命名既有字段。

---

## 测试执行清单（发布前必须全绿）

```bash
npm run build:writing
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
python3 developer/tests/ci/writing_backend_contract.py
```

> [!CAUTION]
> Phase 05 新增场景必须有可执行脚本覆盖，手工验收不计入通过条件。

### 必须产出的测试报告

- `developer/tests/e2e/reports/phase05-eval-flow-report.json`
- `developer/tests/e2e/reports/phase05-upload-flow-report.json`

### Phase 05 新增场景核验

- [ ] 正常流：提交作文 -> 流式完成 -> 入库 -> 历史可查。  
- [ ] 取消流：取消后状态为 `cancelled`，无 essay 脏数据。  
- [ ] 搜索流：标题/正文关键词均可命中。  
- [ ] 文件流：上传返回缩略图，删除无残留。  
- [ ] 兼容流：`file://` 启动和既有套题流程不回归。

---

## 交付物

- `developer/docs/phase05_plan.md`（本文件）  
- `developer/docs/phase04_handover.md`（状态同步）  
- `developer/docs/phase04_checklist.md`（检查项同步）  
- 对应代码与测试报告（CI 报告路径保持现有规范）
