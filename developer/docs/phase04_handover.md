# Phase 04 交接文档

> 文档更新时间: 2026-04-07
> 当前判断: 写作模块已经从“单阶段能跑”推进到“二阶段评测链路已落地且有 live smoke 证据”，但距离真正可发布和真正有产品竞争力都还有差距。
> 下一步: 继续按 `developer/docs/phase05_plan.md` 做打包前硬化、评测质量收口和发布前验收；功能迁移方向统一参考 `developer/docs/phase05_competitor_audit.md`。

---

## 摘要

Based on current information, my understanding is:
Phase 04 打下的题库、历史、设置、上传和默认 seed 基础设施已经接进真实运行时。当前状态不只是“能提交作文”，而是已经具备 `Compose -> Evaluating -> Result -> History` 的真实闭环，且评测主链路已从单次大 prompt 重构为 `scoring -> review` 双阶段流水线。后续交接必须基于真实代码、真实回归和真实报告，不要再引用旧 checklist 和旧聊天记录。

---

## 【核心判断】

🟡 值得继续做，但问题已经从“链路断了”变成“评测质量和发布硬化不够”。

现在再继续堆页面没有价值。真正还缺的是把二阶段评测链路继续压实、做打包前验收，以及发布前的最后一轮全文案和行为巡检。

---

## 【事实源】

后续交接和开发统一看这些文件：

- 数据库
  - `electron/db/schema.sql`
- 题库
  - `electron/db/dao/topics.dao.js`
  - `electron/services/topic.service.js`
  - `electron/resources/default-topics.json`
- 评分/历史
  - `electron/services/evaluate.service.js`
  - `electron/services/essay.service.js`
  - `electron/db/dao/essays.dao.js`
- 竞品与产品方向
  - `developer/docs/phase05_competitor_audit.md`
- 设置
  - `electron/db/dao/configs.dao.js`
  - `electron/services/config.service.js`
- IPC
  - `electron/ipc-handlers.js`
- Vue 写作前端
  - `apps/writing-vue/src/views/ComposePage.vue`
  - `apps/writing-vue/src/views/EvaluatingPage.vue`
  - `apps/writing-vue/src/views/ResultPage.vue`
  - `apps/writing-vue/src/views/TopicManagePage.vue`
  - `apps/writing-vue/src/views/HistoryPage.vue`
  - `apps/writing-vue/src/views/SettingsPage.vue`
  - `apps/writing-vue/src/composables/useDraft.js`
  - `apps/writing-vue/src/main.js`
  - `apps/writing-vue/src/components/NavBar.vue`

---

## 【已完成】

### 1. 默认题库 seed 已经接进运行时

- 空库启动会通过 `topic.service.js` 的 `initializeDefaults()` 导入默认题库。
- `electron/resources/default-topics.json` 已作为运行时事实源。
- BC 大作文机经已投影成当前 `topics.batchImport` 可直接吃的 JSON 结构。

### 2. 写作入口已经接进题库

- `ComposePage.vue` 现在支持：
  - 自由写作 / 从题库选择
  - 按题型与分类拉取题目
  - 预览当前题目文本
  - 题库模式下提交真实 `topic_id`
- 题库模式下不再允许“没选题就提交”。
- `topic_id = null` 不再是唯一提交路径。

### 3. 草稿契约已经收口到一份状态

- `useDraft.js` 不再维护一套和页面脱节的旧接口。
- 草稿统一保存：
  - `task_type`
  - `topic_mode`
  - `topic_id`
  - `category`
  - `content`
  - `word_count`
- 恢复草稿时会同时恢复题型、题库模式、分类、题目和正文。
- 草稿清理后不会在页面卸载时又被偷偷写回去。
- `beforeunload` 改成静默保存，不再乱弹确认框。

### 4. 题目使用次数已经闭环

- `EssayService.create()` 在写作记录保存成功后会增加 `topics.usage_count`。
- 题目统计数据不再是纯展示垃圾。
- 这条更新失败只记日志，不会拖死 essay 主流程。

### 5. 历史页和设置页的破坏性操作已经加护栏

- `HistoryPage.vue`
  - 刷新列表后只保留当前页可见选择
  - 筛选/分页/删除后统计和选中态同步
  - 删掉了 `setTimeout(500)` 这种碰运气加载统计的垃圾
- `SettingsPage.vue`
  - 前端禁用危险按钮并显示页内消息
  - 后端硬性禁止删光配置、禁用唯一启用配置、禁用配置设默认
- 默认配置始终保持为启用状态

### 6. 评测链路已经改成二阶段状态机

- `electron/services/evaluate.service.js` 已从“单次 provider 调用 + 一次性 JSON”重构为：
  - Stage 1: `scoring`
  - Stage 2: `review`
- 两阶段请求均已透传 `response_format: json_schema`，结构化约束从 prompt 下沉到 provider 请求层。
- 第一阶段先产出稳定评分对象：
  - `total_score`
  - 四项分
  - `task_analysis`
  - `band_rationale`
  - `input_context`
- 第二阶段再产出详解对象：
  - `sentences`
  - `overall_feedback`
  - `improvement_plan`
  - 可选 `paragraph_reviews/review_blocks/rewrite_suggestions`
- SSE 已新增：
  - `stage`
  - `analysis`
  - `review`
- 旧事件仍保留：
  - `progress`
  - `score`
  - `sentence`
  - `feedback`
  - `complete`
- 第二阶段失败时已经做最小兜底，不会因为详解挂掉就把已生成的评分整条作废。
- 已修复 review 阶段异常时仍误发 `review completed` 的状态污染。

### 7. 路由/file:// 兼容护栏已补上

- `main.js` 增加了 catch-all 路由，非法路径回 `Compose`。
- `evaluating/result` 对无效 `sessionId` 增加前端级兜底。
- `NavBar.vue` 在非 Electron 场景不再是死按钮，会明确降级回首页。

### 8. 当前回归结果

本轮已执行并通过：

```bash
npm run build:writing
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
python3 developer/tests/ci/writing_backend_contract.py
python3 developer/tests/e2e/phase05_upload_flow_e2e.py
python3 developer/tests/e2e/phase05_eval_flow_e2e.py
python3 developer/tests/e2e/writing_compose_draft_restore_e2e.py
python3 developer/tests/e2e/phase05_eval_flow_e2e.py \
  --provider openai \
  --provider-base-url https://api.ccode.vip/v1 \
  --provider-model qwen-3-235b-a22b-free \
  --provider-api-key "$WRITING_LIVE_KEY_1" \
  --report-name phase05-eval-flow-live-provider-report.json
```

补充说明：

- `phase05-upload-flow-report.json` 已为通过态，验证真实 HTTP + 真实文件系统上传/删除/路径安全。
- `phase05-eval-flow-report.json` 已为通过态，验证 `Compose -> Evaluating -> Result` 的真实 HTTP + SSE + SQLite 编排链路。
- `phase05-eval-flow-live-provider-report.json` 已为通过态，验证用户提供的 OpenAI-compatible live provider 下的真实外部评测链路。
- 评测报告已覆盖双阶段 deterministic stub 编排链路，并额外覆盖一组真实外部 provider live smoke。
- live provider 常规 smoke 只认单一验收配置：`provider=openai`、`base_url=https://api.ccode.vip/v1`、`model=qwen-3-235b-a22b-free`。

---

## 【还没完成】

### 1. 评测链路已有双阶段自动化证据，但质量还没到可发布

- `developer/tests/e2e/reports/phase05-upload-flow-report.json`
- `developer/tests/e2e/reports/phase05-eval-flow-report.json`
- `developer/tests/e2e/reports/phase05-eval-flow-live-provider-report.json`
- `developer/tests/e2e/reports/phase05-eval-flow-live-provider-repeat-report.json`

现在已经有真实链路报告，但边界还是要说清楚：

- 已覆盖本地 deterministic stub 下的双阶段编排链路
- 已覆盖一组用户提供的 OpenAI-compatible live provider smoke
- 默认环境依旧没有内置 API key / 启用配置，所以这不是“开箱即用”的默认验收能力
- 二阶段详解目前是“可用优先”而不是“质量封顶”，输出质量还需要继续打磨

### 2. Task 1 默认题库只做了最小样本

- 当前默认 seed 以 Task 2 官方题库为主。
- Task 1 已补最小样本：8 个分类各 1 题。

这保证了题库模式在 Task 1 不会空白，但它不是“全量官方题库”。

### 3. 设置页文案已基本收口，但仍需发布前统一审校

- About 区阶段和功能列表已同步到 Phase 05 现实状态。
- 仍建议在发布前做一次全文案巡检，避免后续改动再漂移。

### 4. 还没进入打包发布阶段

- Electron 打包
- 发布前手工验收
- 用户说明/回归记录

这些仍是后续阶段任务，不是本轮已经完成的内容。

### 5. live provider 验收口径（固化）

- 仅使用第一把 key 做验收，不接受轮换 key 混跑。
- API key 只允许通过 CLI 参数注入，不写入仓库文件。
- 推荐命令：

```bash
python3 developer/tests/e2e/phase05_eval_flow_e2e.py \
  --provider openai \
  --provider-base-url https://api.ccode.vip/v1 \
  --provider-model qwen-3-235b-a22b-free \
  --provider-api-key "$WRITING_LIVE_KEY_1" \
  --report-name phase05-eval-flow-live-provider-report.json
```

### 6. 产品层竞争力仍明显弱于头部公开竞品

- `developer/docs/phase05_competitor_audit.md` 已明确：
  - `ielts9.me` 的强项是首页 demo 结果页、词汇学习层、复盘/历史/草稿的高价值 gating
  - `IELTS Rewind` 的强项是免费工具矩阵和低摩擦输入入口
- 我们当前虽然已有双阶段评分和基础闭环，但还缺：
  - 首页级结果演示
  - 词汇学习层
  - OCR / 观点 / 连词 / 计时等辅助层
  - 更清晰的连续性能力分层
- 这些不属于当前收口已完成内容，后续必须按单独阶段推进，不要混进 Phase 05 验收里假装已经做完

---

## 【已删除的过时文档】

这些文档已经删除，因为继续保留只会误导人：

- `developer/docs/phase04_checklist.md`

删除原因：

- 引用了不存在或已改名的页面
- 验收项与真实代码状态对不上
- 会让接手人按假清单做假验证

---

## 【强制测试命令】

每次继续收口都至少执行：

```bash
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
```

涉及写作后端契约时，再补：

```bash
python3 developer/tests/ci/writing_backend_contract.py
```

---

## 【下一步建议】

顺序不要乱：

1. 继续压二阶段评测质量，尤其是 `analysis/review` 输出稳定性
2. 再做 Electron 打包与发布前验收
3. 打包前不要乱扩功能；Phase 05 收口结束后，按 `developer/docs/phase05_competitor_audit.md` 做结果页分层与产品化迁移
3. 最后做文案与帮助信息的全量巡检

现在最大的缺口不是“有没有页面”，也不是“有没有报告”，而是“二阶段评测质量有没有稳定下来，以及发布前验收有没有硬证据”。
