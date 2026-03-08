# 阅读统一页重构交接文档

## 1. 目标与结论

本轮工作的核心目标，是把阅读题库从“每题一个异构 HTML 子页 + 父页注入补丁采集数据”的垃圾结构，推进到“统一阅读页 + 标准化题目数据源 + manifest 分流”的可维护结构。

当前结论：

- 阅读统一页链路已经打通，支持 `file://`
- 阅读题库已完成批量迁移底座，`190/192` 篇阅读题已生成标准化数据源
- 运行时分流已从“试点显式配置”切到 “manifest 驱动”
- JSON 真源与运行时 JS 分发物已完成职责分离
- 旧题仍可继续走 legacy 链路，未破坏现有用户路径

## 2. 本轮完成的工作

### 2.1 第一阶段：统一阅读页与数据结构落地

已完成内容：

- 定义统一数据结构 `ReadingExamSourceV1`
- 新增统一阅读页模板与运行时
- 新增全局注册器 `window.__READING_EXAM_DATA__`
- 新增阅读数据 manifest `window.__READING_EXAM_MANIFEST__`
- 父页支持根据题目分流到统一阅读页
- 统一页继续兼容现有 `INIT_SESSION / SESSION_READY / PRACTICE_COMPLETE` 协议

关键文件：

- [js/runtime/readingExamRegistry.js](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/readingExamRegistry.js)
- [js/runtime/unifiedReadingPage.js](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/unifiedReadingPage.js)
- [templates/reading-practice-unified.html](/Users/maziheng/Downloads/0.3.1%20working/templates/reading-practice-unified.html)
- [js/app/examSessionMixin.js](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js)
- [index.html](/Users/maziheng/Downloads/0.3.1%20working/index.html)

### 2.2 matching 交互问题修复

本轮中途修了统一页 matching 的业务 bug，并保留了逻辑修复：

- 用户把答案拖到另一个槽位时，旧答案会正确腾挪
- 已填答案可拖回待选区
- 已填答案可点击撤回

注意：

- 后续你要求“不要继续折腾 UI”，所以视觉层已经回退到更朴素的版本
- 这部分保留的是业务逻辑修复，不是审美改造

### 2.3 批量迁移底座

已完成内容：

- 新增批量生成器
- 新增源 JSON 校验器
- 支持从 `睡着过项目组` 批量抽取阅读题
- 使用 `IELTS` 作为交叉校验辅助源
- 支持生成：
  - JSON 真源
  - 运行时 JS wrapper
  - manifest
  - crosswalk
  - 迁移报告

关键文件：

- [developer/tests/tools/reading-json/generate_reading_assets.node.js](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/tools/reading-json/generate_reading_assets.node.js)
- [developer/tests/tools/reading-json/validate_reading_sources.node.js](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/tools/reading-json/validate_reading_sources.node.js)

### 2.4 生成器中修掉的关键垃圾点

本轮生成器不是简单“跑通”，而是修掉了几个会导致批量迁移失真的核心问题：

- 题组识别不再只认 `<div class="group">`
  - 现在可以识别 `group sentence-completion`、`group checkbox-question` 等变体
- 题号抽取改成多来源并集
  - `name`
  - `data-question`
  - `data-question-id`
  - `id="q8_input" / q8-nav / q8-13-anchor"`
  - 标题中的 `Questions 8–13`
  - 标题中的 `Questions 21 and 22`
- 不再把“抽到的一部分题号”当完整题组
- 答案键只认数字题号
  - 像 `qD: 'vi'` 这种脏键不会再被误当成真题号
- 支持更多旧页面结构
  - 不同 left/right pane 包裹形式
  - 题组 HTML 切块边界修复

### 2.5 第二阶段收口

本轮已完成第二阶段第一轮收口：

#### A. 去掉 `complete-exam-data.js` 中试点显式字段

已完成：

- 删除 12 个试点题里的 `launchMode: 'unified-reading'`
- 删除 12 个试点题里的 `dataKey`
- 现在阅读统一页分流不再依赖索引中显式写死字段

涉及文件：

- [assets/scripts/complete-exam-data.js](/Users/maziheng/Downloads/0.3.1%20working/assets/scripts/complete-exam-data.js)
- [js/app/examSessionMixin.js](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js)

#### B. 改为 manifest-only 驱动

已完成：

- 父页增加 `_getUnifiedReadingManifestEntry()`
- `_isUnifiedReadingExam()` 现在只认 manifest
- `_buildUnifiedReadingUrl()` 以 manifest 为主，不再依赖索引硬编码

#### C. JSON 真源迁入 `developer`

已完成：

- JSON 真源目录从生产资产区迁出
- 新目录为 [developer/reading-exams](/Users/maziheng/Downloads/0.3.1%20working/developer/reading-exams)
- 运行时继续只使用 [assets/generated/reading-exams](/Users/maziheng/Downloads/0.3.1%20working/assets/generated/reading-exams)
- 原 [assets/data/reading-exams](/Users/maziheng/Downloads/0.3.1%20working/assets/data/reading-exams) 已退出

#### D. 增加人工审查入口

已完成：

- 原 crosswalk 报告保留
- 新增 crosswalk 审查报告
- 自动输出：
  - 未迁移阅读题
  - 低置信匹配项
  - 需人工审查队列

关键文件：

- [developer/tests/fixtures/reading-crosswalk.json](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/fixtures/reading-crosswalk.json)
- [developer/tests/fixtures/reading-migration-report.json](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/fixtures/reading-migration-report.json)
- [developer/tests/fixtures/reading-crosswalk-review.json](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/fixtures/reading-crosswalk-review.json)

## 3. 当前数据与产物状态

### 3.1 迁移统计

当前状态：

- 总阅读题：`192`
- 有 `睡着过项目组` 可提取源的候选题：`190`
- 已成功迁移：`190`
- 生成失败：`0`

### 3.2 审查统计

当前状态：

- 未迁移阅读题：`2`
- 低置信 crosswalk 项：`87`
- 人工审查队列总数：`89`

### 3.3 目录职责

维护真源：

- [developer/reading-exams](/Users/maziheng/Downloads/0.3.1%20working/developer/reading-exams)

运行时分发物：

- [assets/generated/reading-exams](/Users/maziheng/Downloads/0.3.1%20working/assets/generated/reading-exams)

脚本与报告：

- [developer/tests/tools/reading-json](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/tools/reading-json)
- [developer/tests/fixtures](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/fixtures)

## 4. 明确没做的事情

这些事情本轮刻意没做，避免破坏 userspace：

- 没有原地修改 [睡着过项目组](/Users/maziheng/Downloads/0.3.1%20working/睡着过项目组) 和 [IELTS](/Users/maziheng/Downloads/0.3.1%20working/IELTS) 源题库
- 没有删除 legacy 阅读页
- 没有删除听力链路相关兜底逻辑
- 没有大规模删 `examSessionMixin.js` 中跨题型的 `inline_collector` / `fallback_recorder`
- 没有继续做统一页 UI 改造

原因很简单：

- 这些部分和听力、旧阅读页、套题模式混在一起
- 现在乱砍，极容易把现有流程一起打爆

## 5. 验证结果

本轮已通过：

```bash
node developer/tests/tools/reading-json/generate_reading_assets.node.js
node developer/tests/tools/reading-json/validate_reading_sources.node.js
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
python3 developer/tests/e2e/reading_single_flow.py
```

验证结论：

- `190` 个阅读 JSON 真源全部通过校验
- `file://` 下统一阅读页分流可用
- 阅读单题主链路可用
- 套题模式可用
- 未检测到 fallback/synthetic 异常路径

## 6. 已知遗留问题

### 6.1 两个未迁移阅读题

当前仍未迁移：

- `p2-high-26` `（无题目） Muscle Loss 肌肉流失`
- `p3-medium-169` `（无题目） Music Language We All Speak 音乐语言`

现状：

- 这两个条目在索引里 `filename` 为空
- 审查报告里已单独列出
- 需要人工确认源文件命名或补充映射

### 6.2 low-confidence 审查队列仍然偏大

当前 `87` 项低置信 crosswalk 还没分层，审查颗粒度偏粗。现在只是“把问题暴露出来了”，还没做精细分类。

### 6.3 父页 legacy 注入链路仍然偏重

[js/app/examSessionMixin.js](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js) 里仍然混着：

- legacy 阅读页增强器注入
- inline fallback
- placeholder 套题兼容
- fallback recorder

这部分虽然还能跑，但结构品味很差，后续必须继续拆。

## 7. 下一步建议

建议按下面顺序继续，不要跳步。

### Step 1. 处理 2 个未迁移阅读题

目标：

- 给 `p2-high-26`
- 给 `p3-medium-169`

补上明确的 HTML 源映射，确认能进入批量生成链路。

产出要求：

- 审查报告中的 `unmigratedCount` 从 `2` 变成 `0`
- 重新生成后迁移数从 `190` 到 `192`

### Step 2. 拆 low-confidence 审查队列

当前 `87` 项太粗，建议细分为：

- `shui_only`
- `ielts_only`
- `title_noise`
- `filename_noise`
- `manual_mapping_needed`

产出要求：

- `reading-crosswalk-review.json` 增加明确的 `reviewReason`
- 审查队列可按原因排序，不再是一坨

### Step 3. 把 crosswalk 规则做成可维护映射层

建议新增一份人工映射配置，例如：

- `developer/tests/fixtures/reading-crosswalk-overrides.json`

用途：

- 解决无题目、脏命名、AI Studio 输出文件名等异常情况
- 避免把特殊 case 写死进生成器代码

这是最符合品味的做法：  
不要在代码里堆 `if`，把特殊情况收敛到数据配置层。

### Step 4. 继续清理 legacy 阅读补丁

这一步要保守做，不要一口气删。

建议顺序：

1. 先把“只服务阅读 legacy 页”的注入逻辑从 `examSessionMixin.js` 里单独抽出
2. 再把“听力仍依赖”的兜底保留
3. 最后才考虑删掉阅读专属 enhancer 分支

目标不是“代码看起来少了”，而是“阅读和听力不再共用一坨垃圾父页逻辑”。

### Step 5. 增加批量迁移回归快照

建议补一个专门的阅读迁移回归，至少校验：

- manifest 中题目数量
- developer JSON 数量
- 未迁移数量
- 审查队列数量

避免以后改生成器时，统计 silently 漂移。

## 8. 推荐继续使用的命令

生成：

```bash
node developer/tests/tools/reading-json/generate_reading_assets.node.js
```

校验：

```bash
node developer/tests/tools/reading-json/validate_reading_sources.node.js
```

静态回归：

```bash
python3 developer/tests/ci/run_static_suite.py
```

E2E：

```bash
python3 developer/tests/e2e/suite_practice_flow.py
python3 developer/tests/e2e/reading_single_flow.py
```

## 9. 附：本轮核心文件清单

本轮最关键的文件如下：

- [developer/tests/tools/reading-json/generate_reading_assets.node.js](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/tools/reading-json/generate_reading_assets.node.js)
- [developer/tests/tools/reading-json/validate_reading_sources.node.js](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/tools/reading-json/validate_reading_sources.node.js)
- [developer/tests/fixtures/reading-crosswalk.json](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/fixtures/reading-crosswalk.json)
- [developer/tests/fixtures/reading-migration-report.json](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/fixtures/reading-migration-report.json)
- [developer/tests/fixtures/reading-crosswalk-review.json](/Users/maziheng/Downloads/0.3.1%20working/developer/tests/fixtures/reading-crosswalk-review.json)
- [developer/reading-exams](/Users/maziheng/Downloads/0.3.1%20working/developer/reading-exams)
- [assets/generated/reading-exams](/Users/maziheng/Downloads/0.3.1%20working/assets/generated/reading-exams)
- [js/app/examSessionMixin.js](/Users/maziheng/Downloads/0.3.1%20working/js/app/examSessionMixin.js)
- [js/runtime/readingExamRegistry.js](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/readingExamRegistry.js)
- [js/runtime/unifiedReadingPage.js](/Users/maziheng/Downloads/0.3.1%20working/js/runtime/unifiedReadingPage.js)
- [templates/reading-practice-unified.html](/Users/maziheng/Downloads/0.3.1%20working/templates/reading-practice-unified.html)
- [index.html](/Users/maziheng/Downloads/0.3.1%20working/index.html)

