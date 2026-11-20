# 九分学长可接入数据与接口核验

2026-11-19 · 客户端 0.9.21-rc.1 · Atlas 已登录测试账号

## 核心判断

九分学长还提供听力原文时间轴、逐句中文翻译、答案定位、听力词汇、拼写材料、写作题库、主题检索索引和历史统计。最适合下一步接入的是现有读听题面的补充数据，随后接词汇与写作题源。

本轮按业务 API 盘点用户所说的“端口”。最后一轮执行了 41 次认证 GET，全部 HTTP 200 且业务 code 为 200。请求使用 Atlas 已保存的测试账号会话，数据覆盖范围见各项抽查说明。研究记录包含字段结构、计数和少量核验结果，账号、令牌及完整题目正文均经过省略处理。

已同步的普通题库在上一轮实测为阅读 275、听力 341。本轮额外接口的计数有各自的统计口径，写作题、词条、拼写单元和搜索索引应分别存储。

## 关键洞察

### 实际取得的数据

| 数据 | 本账号实测结果 | 可在 Atlas 中使用的位置 |
|---|---|---|
| 听力原文与时间轴 | 《1960s NZ Architecture》有 36 段、51 句、1,615 个词级条目，51 句全部有起止时间 | 现有听力复盘可扩充原文显示、逐句重听和随播高亮 |
| 逐句中文翻译 | 上述听力 51 条，《A Brief History of Humans and Food》阅读 37 条 | 现有读听复盘、原文中译对照 |
| 单题解析与定位 | 阅读和听力各抽一题，均返回三层解析及原文句号 | 保留解析层级，关联原文与音频位置 |
| 听力词汇 | 服务端计数 1,812，抽查首 3 条及其中 1 条详情 | 现有词汇页，词条关联来源题目、中文释义及发音 |
| 拼写材料 | 目录 73 单元，抽查 1 单元的基础、学习和考试视图，均有 10 项 | 本地词汇学习与听写，按学习模式消费答案字段 |
| 词汇听写分组 | 29 组，带内容版本、组状态和既有轮次关联 | 后续对接本地听写进度 |
| 写作题库 | 小作文高频难题 121，大作文高频难题 252，共 373 条目录，两个专辑各取 1 题 | 现有写作题库、题图和编辑器 |
| 标题目录 | 737 条索引，有中英文标题和 Part 关联 | 题库搜索与目录补全，数量按索引条目统计 |
| 主题关键词包 | 705 条 Part 索引，有主题词、回忆别名、具体术语 | 题库中文主题和关键词搜索 |
| 高频专辑 | 读听共 2 个专辑，包含排名变化、七日上报量、热度及平均正确率 | 既有题目卡片标签、排序和筛选 |
| 历史与统计 | 取得 2026 年 11 月日历，11 月 18 日有 2 条记录，可读取既有官方复盘 | 历史页、已练状态、按 Part 与题型统计 |
| 标签与个人标记 | 阅读 6 个、听力 7 个标签，抽样题目的笔记及标签选择为空，highlight 返回 null | 现有笔记和标签字段的后续同步 |
| 引导音频及知识目录 | 2 条考试引导音频，2 个知识视频专辑目录 | 听力流程与资料目录，视频详情仍待核验 |

### 听力文本需要从 articleJson 解包

线上样题的 `parts[].sentences` 为空，完整原文与时间轴在 `parts[].articleJson` 的 JSON 字符串内。

```text
parts[].articleJson
  segments[]
    speaker.id / speaker.name
    sentences[]
      sentence_index / text / start_time / end_time
    words[]
      text / sentence_index / start_time / end_time
```

原客户端把 `start_time` 直接赋给音频 `currentTime`，其单位为秒。样题的首尾时间为 3.4 和 447.436 秒。原客户端本地资源包另有 `startTimeMillis`、`endTimeMillis`、句内断点字段，应在转换层明确处理单位。

本地 `plug/jiufen/native.rs` 的 `exam()` 当前仅在阅读分支解析 `articleJson`，再把句子拼成段落 HTML。听力时间轴、句子索引及说话人信息需要进入可持久化的本地结构。阅读也需要保留句子身份，供译文和答案定位关联。

### 翻译和答案定位可以关联已有题面

句译响应包含 `sourceArticleHash`、`sourceTextHash`、句子索引和键，可用于检查原文更新后的对应关系。单题解析中的 `sentenceIndex` 支持单句以及句号范围。

本轮抽查阅读解析定位到第 1 句，听力定位到第 6 句。两个响应的 `startTimeMillis` 和 `endTimeMillis` 都是 0。听力跳转可通过 `sentenceIndex` 关联 `articleJson` 中的有效时间轴。

`plug/jiufen/practice.rs` 已请求单题解析并将内容转为本地解析文本。进一步补充的工作包括保留结构化层级、句子定位与译文关联。题型方面，`native.rs::kind()` 仍把所有填空映射为 `sentence_completion`，上游的 `flowchart_fill`、`diagram_fill` 等子类型值得继续补齐。上游另有 `reading_heading`、`reading_person_match`，应和本地题型逐项核对。

### 词汇和拼写有足够的学习材料

词汇列表返回 `word`、`acceptedAnswers`、`glossZh`、`answerAudioUrl`、提示、分类、Part、收藏及最近作答状态。详情返回来源套题、中英文标题、Part、题号和来源形式。

详情路径使用 `keyDigest`。首次使用 `key` 得到 `LISTENING_VOCABULARY_ENTRY_STALE`，按原客户端详情调用修正参数后返回成功。分页使用 `cursor`、`nextCursor`、`hasMore`，更新检查使用 `snapshotVersion` 和 availability 的 `version`。

拼写学习视图 `mode=study` 实际返回标准词、可接受答案、中文词义、句子译文、整句音频和答案音频。考试视图实际返回题干前后缀、译文及音频字段。两者均有 `viewRevision`，本地练习需要绑定所用材料版本。

### 写作题源可以接入现有编辑器

两个写作专辑的完整目录分别返回 121 和 252 条。目录有 Task 分类、话题分类、中英文题名、材料缩略图、草稿与提交状态。抽查的小作文含题图资源，题面还包含 `articleJson` 和 `supplementPrompt1/2`。

当前证据覆盖写作题目与材料。原客户端写作复盘包含“暂不评分”处理，范文与服务端 AI 批改能力仍缺确认依据。

### 既有官方阅读成绩已核对

从账号历史返回的复盘目标读取《A Brief History of Humans and Food》，服务端结果为 11/13。

| 题号 | 用户答案 | 正确答案 | 分数 | 服务端 state |
|---|---|---|---|---|
| 1 | A | B | 0 | `2` |
| 13 | 空字符串 | meat | 0 | `0` |

这次核验读取的是既有提交。该记录的 `elapsedSeconds` 为 null，本地应保留缺失状态。导入历史应使用题源、账号、远端 attempt ID 共同去重，并校验关联 unit ID。

### 服务端权限与内容覆盖

当前账号的 `mixed_practice` 和 `high_frequency_more_rows` 都为 false，远端组卷及额外高频行数受对应权限控制。`sevenDayReportTotal` 表示平台近七日上报量，展示文案应采用这一含义。

独立 `IntensiveListeningPage` 的加载和保存函数使用 mock。现阶段可以接入的精听数据来自普通听力题面、句译和复盘；精听进度远端保存协议仍需服务端合同。

笔记、highlights、拼写错词接口在本账号抽查数据为空，其非空数据的完整渲染和双向冲突处理需要补样例。笔记保存封装含 `baseRevision`，客户端会处理 409 `note_conflict`。

## 已核验 GET 路径

统一前缀为 `https://www.9fnnn.com/api`。表中均为最后一轮实际调用的路径模板。

| 路径 | 参数或用途 |
|---|---|
| `/practice/v1/me/feature-entitlements` | 账号功能权限 |
| `/practice/v1/units/{unitId}/exam` | 阅读、听力各一套题面 |
| `/practice/v1/parts/{partId}/sentence-translations` | `locale=zh-CN` |
| `/practice/v1/question-analysis` | `questionId`、`partId`、`groupId` |
| `/practice/v1/listening/guidance-audios` | 引导和检查音频 |
| `/practice/v1/listening/vocabulary` | `limit=3`，可继续 cursor 分页 |
| `/practice/v1/listening/vocabulary/availability` | 词库版本 |
| `/practice/v1/listening/vocabulary/entries/{keyDigest}` | 单词来源详情 |
| `/practice/v1/listening/vocabulary-dictation/groups` | 听写分组 |
| `/practice/v1/spelling-recall/catalog` | 拼写目录 |
| `/practice/v1/spelling-recall/units/{unitId}` | 拼写基础材料 |
| `/practice/v1/spelling-recall/units/{unitId}/view` | 分别调用 `mode=study`、`mode=exam` |
| `/practice/v1/spelling-recall/wrong-words` | `offset=0&limit=3` |
| `/practice/v1/units/writing/albums` | 写作专辑 |
| `/practice/v1/units/writing/albums/{albumId}/units` | 两个写作专辑题目列表 |
| `/practice/v1/units/writing/{unitId}` | 各抽一套写作题面 |
| `/practice/v1/unit-title-directory` | 全标题索引 |
| `/practice/v1/part-keyword-search/manifest` | 主题包版本与获取方式 |
| `/practice/v1/part-keyword-search/package` | Part 主题索引 |
| `/practice/v1/high-frequency/albums` | `includeEntryModes=memory_link,spelling_recall` |
| `/practice/v1/me/practice-history/calendar-window` | `endMonth=2026-11&monthCount=1&historyMode=regular`，包含扩展入口模式 |
| `/practice/v1/me/practice-history/records` | `date=2026-11-18&pageNo=1&pageSize=20&historyMode=regular`，包含扩展入口模式 |
| `/practice/v1/me/practice-stats` | 读听、Part、题型及趋势统计 |
| `/practice/v1/results/{attemptId}/review` | 历史记录返回的复盘目标 |
| `/practice/v1/unit-status` | `unitIds`，题目已练状态 |
| `/practice/v1/question-notes` | `questionIds` |
| `/practice/v1/question-tags` | `mode=reading` 或 `listening` |
| `/practice/v1/question-tags/selections` | `questionIds` |
| `/practice/v1/highlights` | `unitId` |
| `/practice/v1/kepu/albums` | 知识视频专辑目录 |

另有静态已定位的 GET，包括既有词汇听写轮次、拼写 attempt 与 review、普通题目 required-parts。这些路径的额外响应合同可在需要对应功能时继续实测。历史趋势客户端当前采用 `active_day_v1`，最多保留六个活跃日点，长期图表需要本地持续积累。

## Linus式方案

1. **补齐读听的转换数据。** 在 `plug/jiufen` 保留 `partId`、`questionId`、句子索引、原文 hash 和时间轴。把译文、结构化解析、答案定位接入既有阅读与听力复盘。继续沿用原生练习入口。
2. **补目录元数据。** 合并现有专辑多归属、题型子类型、主题词和标签有效期，供现有题目卡片、Part 筛选与搜索使用。按 hash 更新关键词缓存。
3. **接词汇材料。** 将远端词条和来源关系映射到现有词汇数据结构，独立记录远端收藏、作答状态和本地复习进度。先接已证的列表与详情。
4. **接写作题源与历史。** 通过现有写作题目结构承载材料与题图。历史摘要按页同步，用户打开时再取得官方复盘，按远端作答 ID 去重。

每项产品改动都需要覆盖已有本地题、远端题、草稿恢复和历史复盘，并按仓库要求执行静态门禁与打包回归。本轮新增的是显式运行的开发取证测试，额外数据的产品接入属于后续实现。

## 复核材料

取证测试为 `developer/tests/rust/jiufen_api_audit.rs`，通过 `plug/jiufen/service.rs` 的 `cfg(test)` 挂接，默认忽略。它从 Atlas 自己的凭据存储恢复会话，只发送固定站点的 GET。任一 HTTP 或业务错误会在生成报告后使测试失败。复跑须显式设置 `ATLAS_JIUFEN_READONLY_AUDIT=1`，再执行以下命令。

```powershell
cargo test -p ielts-practice-tauri --lib live_readonly_api_inventory -- --ignored --nocapture
```

脱敏输出位于 `developer/tests/e2e/reports/jiufen-api-audit.json`。历史抽查日期固定为本次核验日期，复用于其他账号或日期时需要相应调整。

本轮验证通过，显式线上测试 1/1、静态门禁 62/62、既有 release 可执行文件的桌面回归 28/28。

包内静态定位采用 UTF-8 解码后的 0-based 字符偏移。以下均相对于解包后的 `app` 目录。

| 文件 | 定位 | 证据 |
|---|---|---|
| `dist-electron/main/index.js` | 1697–1709 行 | 正式 API、旧听力 API、测试环境配置 |
| `dist/assets/index-Bs1Ajour.js` | `fE.request`，偏移 124023 | 请求封装与业务 code 解包 |
| 同上 | 126487–129590 | 拼写、词汇、词汇听写接口 |
| 同上 | 133248–137984 | 解析、句译、笔记、标签、历史、统计及写作接口 |
| 同上 | 212200 | 题型分类与子类型 |
| 同上 | 689445 | 词条详情传入 `keyDigest` |
| `dist/assets/TextPanel-Cmzx27sd.js` | `ea`，30050；`co`，37137 | 秒级单句播放与词高亮 |
| `dist/assets/ExamReviewPage-CDwEoFpw.js` | 98433、103846、105690 | 句译、articleJson 解包、单题解析调用 |
| `dist/assets/IntensiveListeningPage-Py8KdtbW.js` | `Ne`、`De`，6723–6819 | 独立精听页面的 mock 加载与保存 |
| `dist/assets/WritingReviewPage-e-aTvBJY.js` | 2269 | 写作暂不评分处理 |

生产 API 使用 HTTPS 默认 443。包内另含 `/api/listen` 旧接口基址和测试环境 `https://xxgg-test.jingying.vip/api`。本轮线上证据来自正式 API 和当前账号。
