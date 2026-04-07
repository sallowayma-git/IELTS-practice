# Phase 05 实施计划

> 文档更新时间: 2026-04-07
> 目标: 把写作模块从“有交付证据”推进到“评测质量更稳、具备发布前硬化条件”，并为下一阶段产品化迁移建立事实依据
> 对应阶段: Phase 05 收口

---

## 摘要

Based on current information, my understanding is:
Phase 05 第一轮收口已经把最恶心的断链问题修掉，也补出了真实写作自动化证据。现在新增的关键变化是：评测链路已经从单阶段大 prompt 重构为 `scoring -> review` 双阶段流水线，且用户提供的 OpenAI-compatible live provider smoke 已再次跑通。当前重点不再是“写作入口能不能选题”，而是“如何继续压评测质量、把 live smoke 固化进验收，并补齐发布前硬化”。

同时，2026-04-07 已完成一轮公开竞品行为审计，结论见 `developer/docs/phase05_competitor_audit.md`。Phase 05 本身仍以收口和硬化为主，不在这一阶段直接大扩功能，但后续产品迁移优先级必须以该审计为依据，避免继续凭感觉堆页面和堆 prompt。

---

## 【核心判断】

✅ 值得继续做。
当前主风险已经从“功能断链”切到“二阶段评测质量稳定性不足、live provider 验收常态化不足、以及发布前验收不足”。这时候再乱扩功能就是垃圾。

---

## 【关键洞察】

1. `Compose -> Evaluating -> Result -> History -> Topics` 的基础链路已经接上。  
2. `topic_id`、草稿状态、`usage_count`、历史/设置/路由护栏都已经有代码落点。  
3. 写作专属自动化证据已经补上，live provider smoke 也已有通过样本。  
4. 评测链路已改为二阶段状态机，新增 `stage/analysis/review` 事件，同时保留旧 `progress/score/sentence/feedback/complete` 兼容面。  
5. 当前剩余缺口转成评测质量常态化、验收常态化与发布前验收。  
6. 零破坏红线不变：继续维持 `file://`、现有 IPC 契约和静态/E2E 回归。

---

## 【Linus式方案】

1. 承认已经完成的收口，不再重复修老问题。  
2. 把剩余风险压缩成少量可验证事项：双阶段评测质量、写作 E2E、文案收尾、默认数据补齐。  
3. 最笨但清晰的实现：沿用现有 `window.writingAPI.*`、SQLite、sessionStorage 兜底，不另造框架。  
4. 每完成一项就出真实报告，不接受“我看页面差不多”的假验收。

---

## 范围定义

### 已完成

- 05A: 交接文档与事实源对齐
- 05B: 写作入口接题库
- 05C: 草稿/题目/提交契约统一
- 05D: 题目使用次数闭环
- 05E: 历史/设置/路由护栏补齐
- 05F: 写作专属自动化与报告
- 05G: 文案/默认数据收尾

### 当前待做

- 05H: 二阶段评测质量硬化
- 05I: 打包发布前验收

### Out of Scope

- Provider 主备调度强化（Phase 06）
- 提示词版本治理强化（Phase 07）
- 设置页全量重构（Phase 08）

---

## 当前状态

以下项已经收口，不要重复修：

- `ComposePage.vue` 已支持自由写作 / 题库选题，并提交真实 `topic_id`
- `useDraft.js` 已统一草稿契约并修掉卸载回写与 `beforeunload` 干扰
- `EssayService.create()` 已增加 `usage_count`
- `HistoryPage.vue` 已修掉脏选中和统计 `setTimeout`
- `SettingsPage.vue` + `config.service.js` 已增加配置护栏
- `main.js` + `NavBar.vue` 已补非法路由与非 Electron 降级

以下项仍是当前缺口：

- 二阶段评测虽然能跑通，但 `analysis/review` 的内容质量和结构稳定性仍需继续压
- live provider smoke 已通过用户提供凭据验证，但默认环境仍无内置凭据，尚未固化成常规验收
- Task 1 默认题库目前仅提供最小样本（8 类各 1 题），不是全量覆盖
- Settings/About 文案已收口，发布前只需做全局巡检
- 尚未进入打包与发布前验收

新增事实输入：

- `developer/docs/phase05_competitor_audit.md` 已明确：
  - `ielts9.me` 值得迁移的是结果页产品化、词汇学习层和高价值能力 gating
  - `IELTS Rewind` 值得迁移的是免费工具矩阵和低摩擦输入入口
  - 下一阶段最该做的是结构化多阶段输出和结果页分层，不是继续把所有内容塞回单轮 prompt

---

## 05F：写作专属自动化与报告

### 目标

把“写作模块可用”变成可重复验证的事实，而不是口头结论。

### 任务清单

- [x] 补真实 `Compose -> Evaluating -> Result` 自动化
- [x] 补 `topic_id / essay_id / usage_count` 断言
- [x] 产出 `developer/tests/e2e/reports/phase05-eval-flow-report.json`
- [x] 产出 `developer/tests/e2e/reports/phase05-upload-flow-report.json`

### 验收标准

- [x] 选题写作后能拿到真实 `sessionId`
- [x] 结果页能拿到真实 `essayId`
- [x] 题目使用次数有真实前后差异
- [x] 报告来自真实链路，不是 Mock 垃圾

### 当前边界

- 上传报告已覆盖真实 HTTP + 文件系统上传/删除/路径安全。
- 评测报告已覆盖真实 HTTP + SSE + SQLite 双阶段编排链路。
- 评测报告使用本地 deterministic LLM stub，`Preflight` 明确标记真实外部 provider 未覆盖。
- live provider smoke 已通过一组用户提供的 OpenAI-compatible 凭据验证，报告见 `phase05-eval-flow-live-provider-report.json`。
- live provider 常规验收只认单一配置：`provider=openai`、`base_url=https://api.ccode.vip/v1`、`model=qwen-3-235b-a22b-free`，且 API key 仅允许通过 CLI 参数注入。

---

## 05H：二阶段评测质量硬化

### 目标

把“二阶段链路能跑”推进到“二阶段输出更稳、更适合真实产品消费”。

### 任务清单

- [x] 把 `EvaluateService` 重构为 `scoring -> review` 双阶段执行
- [x] 增加 `stage/analysis/review` SSE 事件并保持旧事件兼容
- [x] deterministic stub 升级为双阶段 fixture
- [x] live provider smoke 在双阶段链路上复验
- [x] `analysis/review` 解析与校验路径去混流（解析失败抛错、review 失败降级不污染正常态）
- [x] 修复 review 失败后误发 `completed` 的状态机污染
- [ ] 评估是否需要把段落详解、改写建议继续结构化细分

### 验收标准

- [x] 第一阶段先输出稳定评分 JSON，并驱动前端评分预览
- [x] 第二阶段再输出句级/段落详解
- [x] 旧 `complete/essay_id` 与旧 schema 不回归
- [ ] 真实外部 provider 下结构化字段波动可控

### 当前边界

- 当前实现优先保证“评分先出来、详解再补齐”，不是一步到位追求最复杂的多 agent 工作流。
- 第二阶段失败时已做最小兜底，避免整条会话作废。
- 但质量层面仍要继续收口，否则只是“链路可用”，还不是“产品足够稳”。

---

## 05G：文案与默认数据收尾

### 目标

清掉还能误导人的信息残留。

### 任务清单

- [x] 更新 Settings About 区里的阶段和功能状态
- [x] 清理“待实现”但其实已实现的提示文案
- [x] Task 1 默认题库采用最小样本 seed（8 类各 1 题）

### 验收标准

- [x] 用户看到的阶段描述与真实代码一致
- [x] 不再出现明显失真文案
- [x] Task 1 题库边界有明确结论（最小样本，不承诺全量）

---

## 05I：打包发布前验收

### 目标

在收口完成后进入可交付阶段。

### 任务清单

- [ ] Electron 打包 smoke
- [ ] 手工走一遍写作主流程
- [ ] 验证 Legacy ↔ 写作页跳转
- [ ] 记录发布前回归结论

### 验收标准

- [ ] `file://` 下主流程无回归
- [ ] Electron 壳内导航正常
- [ ] 发布工件可启动

---

## 公共约束

- [x] 保持 `window.writingAPI.*` 现有命名与调用方式
- [x] 保持返回壳结构不变：`{ success, data/error }`
- [x] 允许新增可选字段，但不能改坏旧调用
- [x] 禁止删除或重命名既有字段

---

## 当前已通过的回归

```bash
npm run build:writing
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
python3 developer/tests/ci/writing_backend_contract.py
python3 developer/tests/e2e/phase05_upload_flow_e2e.py
python3 developer/tests/e2e/phase05_eval_flow_e2e.py
python3 developer/tests/e2e/phase05_eval_flow_e2e.py \
  --provider openai \
  --provider-base-url https://api.ccode.vip/v1 \
  --provider-model qwen-3-235b-a22b-free \
  --provider-api-key "$WRITING_LIVE_KEY_1" \
  --report-name phase05-eval-flow-live-provider-report.json
```

说明：
- `WRITING_LIVE_KEY_1` 是外部注入的第一把 key（唯一验收 key），不写入仓库，不写入文档正文。
- 第二把 key 不在当前验收矩阵内，不参与发布门槛。

---

## Phase 05 额外核验清单

- [x] 选题流：进入写作页 -> 选择题目 -> 提交评分 -> 结果页可查（deterministic stub）
- [x] 选题流：进入写作页 -> 选择题目 -> 提交评分 -> 结果页可查（live provider smoke）
- [x] 评测流：第一阶段先出分，第二阶段再出详解（deterministic stub）
- [x] 自由写作流：不选题仍可正常提交
- [x] 恢复流：刷新或返回后草稿状态不乱（含失败保稿与成功清稿）
- [x] 恢复流：题库模式草稿恢复后能提交 `topic_id`（`topic_text=null`）
- [ ] 历史流：带题目标题的记录在历史页和导出中语义一致
- [x] 兼容流：`file://` 启动和既有套题流程不回归

---

## 交付物

- `developer/docs/phase05_plan.md`
- `developer/docs/phase04_handover.md`
- `developer/docs/phase05_competitor_audit.md`
- 对应代码
- 测试报告
