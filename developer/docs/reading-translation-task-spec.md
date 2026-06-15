# IELTS Reading 逐段精翻任务书

## 1. 任务目标

把 `assets/generated/reading-exams/` 中每一篇 Reading 原题 JS 的正文段落，逐段翻译到 `assets/generated/reading-explanations/` 中同名详解 JS 的 `passageNotes` 结构内。

本任务产物用于学生学习和答案解析。翻译错误、漏译、概括替代原文、私自优化表达，都会造成学术误导，视为任务失败。

核心目标只有一个：让每篇文章的 `passageNotes[]` 成为对应原文段落的完整中文精翻，而不是总结、改写或提纲。

## 2. 当前数据事实

当前仓库中：

- 原题目录：`assets/generated/reading-exams/`
- 详解目录：`assets/generated/reading-explanations/`
- 原题文件注册格式：`global.__READING_EXAM_DATA__.register(examId, data)`
- 详解文件注册格式：`global.__READING_EXPLANATION_DATA__.register(examId, data)`
- 原题数据版本：`ReadingExamSourceV1`
- 详解数据版本：`ReadingExplanationV1`
- 原题文件与详解文件通过同名 `examId` 配对，例如 `p1-high-01.js`
- 当前原题 JS 数量为 225 个，详解 JS 数量为 167 个；存在原题有文件但详解缺失的情况
- 不能假设所有 JS 都可直接 `eval`，例如某些详解文件可能因未转义引号导致 JS 语法损坏

## 3. 非目标

本任务不做以下事情：

- 不重写题目、答案、题目解析。
- 不改变 `answerKey`、`questionGroups`、`questionOrder`、`questionDisplayMap`。
- 不修改用户答题交互逻辑。
- 不合并、拆分、重排原文段落。
- 不把翻译做成摘要、段意、知识点、考点提示。
- 不用机器批量把整篇文章一次性翻译完。

## 4. 数据结构定义

### 4.1 原题文件结构

原题文件位于：

```text
assets/generated/reading-exams/{examId}.js
```

每个文件注册一个对象：

```js
{
  schemaVersion: "ReadingExamSourceV1",
  examId: "p1-high-01",
  meta: {
    title: "...",
    category: "P1",
    frequency: "high"
  },
  passage: {
    blocks: [
      {
        blockId: "passage-main",
        kind: "html" | "text",
        html: "...",
        bodyHtml: "..."
      }
    ]
  },
  questionGroups: [],
  answerKey: {},
  questionOrder: [],
  questionDisplayMap: {}
}
```

正文来源字段按以下顺序读取：

1. 优先读取 `passage.blocks[].html`
2. 如果 `html` 不存在，读取 `passage.blocks[].bodyHtml`
3. 如果同一文件有多个 passage block，按 `passage.blocks[]` 原顺序拼接处理

### 4.2 原文段落结构

原文段落通常在正文 HTML 中表现为：

```html
<p><strong>A</strong> paragraph text...</p>
```

也可能是：

```html
<p>paragraph text...</p>
```

或由 `paragraph-wrapper` 包裹，UI 标签可能写作 `Paragraph A`、`Section A`、`Paragraph 1` 等。

段落抽取规则：

- 以正文阅读段落为准，不以题目区、说明区、空白占位区为准。
- 段落顺序必须与原题页面中阅读正文出现顺序一致。
- `<strong>A</strong>`、`<strong>1</strong>` 等段落标记属于定位标签，不应吞掉；翻译文本可保留为 `A段：...` 或通过 `label` 表达。
- 题目前说明如 `You should spend about 20 minutes...` 不属于正文段落，除非原文件没有其他正文段落且项目明确要求翻译说明文字。

### 4.3 详解文件结构

详解文件位于：

```text
assets/generated/reading-explanations/{examId}.js
```

每个文件注册一个对象：

```js
{
  schemaVersion: "ReadingExplanationV1",
  examId: "p1-high-01",
  meta: {
    examId: "p1-high-01",
    title: "...",
    category: "P1",
    sourceDoc: "...",
    noteType: "总结",
    matchedTitle: "..."
  },
  passageNotes: [
    {
      label: "Paragraph A",
      text: "..."
    }
  ],
  questionExplanations: []
}
```

本任务只更新 `passageNotes[]`。除非另有明确任务，不修改 `questionExplanations[]`。

### 4.4 目标 `passageNotes` 结构

翻译完成后，`passageNotes[]` 必须与原文段落一一对应：

```js
passageNotes: [
  {
    label: "Paragraph A",
    text: "A段完整中文精翻..."
  },
  {
    label: "Paragraph B",
    text: "B段完整中文精翻..."
  }
]
```

如果原文是数字段落：

```js
passageNotes: [
  {
    label: "Paragraph 1",
    text: "第1段完整中文精翻..."
  }
]
```

如果原文 UI 写作 `Section A`，但详解已有 `Paragraph A`，保留仓库现有 `Paragraph A` 风格，避免制造新格式。

## 5. 翻译工作单元

最小工作单元是“单篇文章中的单个正文段落”。

每次调用外部 LM，只允许传入一个工作单元：

```json
{
  "examId": "p1-high-01",
  "title": "A Brief History of Tea 茶叶简史",
  "sourceFile": "assets/generated/reading-exams/p1-high-01.js",
  "targetFile": "assets/generated/reading-explanations/p1-high-01.js",
  "paragraphIndex": 1,
  "paragraphLabel": "Paragraph A",
  "sourceText": "The story of tea began in ancient China...",
  "existingTargetText": "..."
}
```

禁止把以下内容交给外部 LM：

- 禁止一次传入多篇文章。
- 禁止一次传入同一篇文章的多个段落。
- 禁止一次传入整篇文章正文。
- 禁止让 LM 自行决定段落边界。
- 禁止让 LM 根据题目解析反推或补写原文翻译。

## 6. 翻译执行流程

### 6.1 生成任务清单

对每个 `assets/generated/reading-exams/{examId}.js`：

1. 查找 `assets/generated/reading-explanations/{examId}.js`。
2. 如果详解文件存在，进入逐段翻译流程。
3. 如果详解文件不存在，记录为 `missing_explanation`，不得静默跳过。
4. 从原题文件抽取正文段落，生成有序段落清单。
5. 从详解文件读取现有 `passageNotes[]`。
6. 校验原文段落数量与 `passageNotes[]` 数量是否一致。

数量不一致时：

- 不允许直接覆盖。
- 必须生成差异报告。
- 必须人工确认段落对应关系后才能继续。

### 6.2 单篇文章处理规则

处理顺序必须是：

1. 选定一个 `examId`。
2. 完成该 `examId` 的所有段落翻译。
3. 对该 `examId` 运行结构校验和内容校验。
4. 校验通过后，才允许进入下一篇文章。

禁止同时处理多篇文章。所谓“同时”包括并行调用 LM、批量提交、批量合并、批量生成 patch。

### 6.3 单段翻译规则

对每个段落：

1. 提取该段英文原文。
2. 只把该段原文交给外部 LM。
3. 要求 LM 输出完整中文精翻。
4. 把输出写入对应 `passageNotes[i].text`。
5. 立刻校验该段是否存在漏译、压缩、总结、错译风险。
6. 当前段校验通过后，才能处理下一段。

禁止先翻译完一整篇再回填。那会让错误扩散，属于垃圾流程。

## 7. 外部 LM 提示词硬约束

每次调用外部 LM 时，必须包含以下约束：

```text
你正在翻译 IELTS Reading 正文的一个段落。你只能处理当前这一段。

硬性要求：
1. 必须完整翻译原文每一句、每个事实、每个限定条件。
2. 不得总结、压缩、意译成段意、删掉重复信息。
3. 不得优化原文逻辑，不得补充原文没有的信息。
4. 不得改变数字、年份、比例、专有名词、因果关系、转折关系、比较关系。
5. 不得跳过括号、引号、破折号中的内容。
6. 不得根据常识纠正原文。
7. 不得输出解释、评价、提示、题目分析。
8. 只输出中文译文。
9. 如果原文有明显格式标签或段落编号，按要求保留或自然融入译文。

当前段落：
{sourceText}
```

如果 LM 输出出现以下任一情况，必须重试：

- 输出“这段主要讲...”等总结语。
- 输出比原文明显短，且遗漏事实。
- 合并多个原文句子的同时丢掉限定条件。
- 删除数字、年份、人名、地名、机构名、引用内容。
- 把题目解析、答案判断、学习建议混入译文。

## 8. 翻译质量标准

### 8.1 完整性

必须覆盖原文全部信息：

- 主句、从句、插入语都要翻译。
- 括号内容必须翻译。
- 引号内容必须翻译。
- 破折号两侧内容必须翻译。
- 列举项必须逐项翻译。
- 转折、让步、因果、比较、条件关系必须保留。

### 8.2 准确性

必须保持：

- 数字一致。
- 年份一致。
- 时间顺序一致。
- 人名、地名、机构名一致。
- 学术概念一致。
- 答题定位依据一致。

专有名词处理：

- 常见中文译名可使用中文译名，并在首次出现时保留英文。
- 无稳定译名的专有名词保留英文，必要时加中文解释。
- 不允许为了中文顺口而改写事实。

### 8.3 可读性

译文应是自然中文，但自然不等于改写。

允许：

- 调整英语语序，使中文通顺。
- 把长句拆成多个中文句子。
- 对代词指代做必要还原。

禁止：

- 为了顺口删掉原文细节。
- 为了简洁把多个事实合成一句笼统表述。
- 为了“帮助理解”添加原文没有的背景知识。

## 9. 写入规则

### 9.1 JS 字符串安全

写入详解 JS 时，必须保证文件仍是合法 JavaScript：

- 字符串中的英文双引号必须转义，或使用安全的 JSON 序列化生成字符串。
- 换行必须用 `\n` 或合法字符串形式表示。
- 不得手写未转义的 `"`、`\` 等危险字符。
- 不得破坏外层 IIFE 注册结构。

当前仓库已经存在未转义引号导致详解 JS 语法损坏的风险；这不是小问题，是会直接让详解加载失败的结构性错误。

### 9.2 字段保护

只允许修改：

```js
passageNotes[i].text
```

必要时允许修正：

```js
passageNotes[i].label
```

但必须满足：

- 不改变 `examId`。
- 不改变 `schemaVersion`。
- 不改变 `meta`。
- 不改变 `questionExplanations`。
- 不改变题目答案结构。

### 9.3 缺失详解文件

如果原题存在但详解文件不存在：

1. 记录 `examId`。
2. 记录原题标题和原题文件路径。
3. 标记状态为 `missing_explanation`。
4. 不得自动创建空详解文件，除非另有单独任务明确要求。

## 10. 校验与证明

每完成一篇文章，必须生成该文章的校验证据。

### 10.1 结构校验

必须证明：

- 原题文件存在。
- 详解文件存在。
- `examId` 一致。
- 原文段落数等于 `passageNotes.length`。
- 段落顺序一致。
- 每个 `passageNotes[i].text` 非空。
- 详解 JS 语法合法。
- 详解数据可被注册器加载。

### 10.2 内容校验

每段必须检查：

- 原文每一句在译文中有对应表达。
- 数字、年份、比例、范围没有丢失。
- 人名、地名、机构名没有丢失。
- 引号内容没有丢失。
- 否定、转折、因果、比较关系没有反向。
- 没有出现总结式替代。

### 10.3 证明材料格式

每篇文章必须输出一条验收记录：

```json
{
  "examId": "p1-high-01",
  "sourceFile": "assets/generated/reading-exams/p1-high-01.js",
  "targetFile": "assets/generated/reading-explanations/p1-high-01.js",
  "paragraphCount": 8,
  "translatedParagraphCount": 8,
  "structureCheck": "pass",
  "contentCheck": "pass",
  "jsSyntaxCheck": "pass",
  "reviewer": "human-or-tool-name",
  "notes": []
}
```

如果失败：

```json
{
  "examId": "p1-high-194",
  "status": "failed",
  "reason": "target_js_syntax_error",
  "details": "Unescaped quote inside passageNotes[1].text"
}
```

## 11. 自动化测试要求

翻译批次完成后，至少运行：

```bash
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

如果本机 `python` 命令不可用，可使用等价 Python 启动器，但报告里必须写明实际命令。

额外建议增加专门的翻译校验脚本，放在：

```text
developer/tests/
```

该脚本至少检查：

- `reading-exams` 与 `reading-explanations` 文件配对情况。
- 每个详解 JS 是否语法合法。
- 每个 `ReadingExplanationV1` 是否能注册成功。
- 每篇文章的原文段落数与 `passageNotes[]` 数是否一致。
- 每个 `passageNotes[].text` 是否为空。
- 是否存在明显总结词，例如 `本段主要`、`概述了`、`大意是`。

注意：自动化只能证明结构，不足以证明翻译完全正确。完整性必须有逐段人工或二次模型审校。

### 11.1 `file://` 兼容性

所有校验必须兼容用户双击 `index.html` 的 `file://` 使用方式：

- 不得要求本地 dev server 才能加载详解 JS。
- 不得使用只在 `http://localhost` 下成立的路径假设。
- 脚本路径必须保持相对路径可解析。
- 详解 JS 必须能在浏览器普通脚本标签下注册到全局 registry。
- 如果增加专门校验页面或脚本，必须能从本地文件路径直接运行，或明确说明只作为 CI 辅助，不作为用户运行前提。

## 12. 人工审校要求

每篇文章完成后，审校者必须逐段核对：

1. 对照英文原文逐句读。
2. 对照中文译文逐句划掉已覆盖信息。
3. 对数字、专名、否定、转折单独复核。
4. 对答案解析中引用的定位句重点复核。
5. 发现漏译或错译时，只重做当前段，不重做整篇。

审校不得只看中文是否通顺。通顺但漏信息，是最危险的垃圾。

## 13. 失败处理

出现以下情况，必须停止当前文章并记录，不得继续下一篇：

- 段落边界无法确定。
- 原文段落数与 `passageNotes[]` 数量不一致，且无法自动证明对应关系。
- 目标详解 JS 写入后语法不合法。
- 外部 LM 连续两次输出总结式译文。
- 译文与原文事实冲突。

处理原则：

- 能定位到单段的问题，只重做该段。
- 结构问题先修结构，不靠翻译绕过去。
- 缺失详解文件单独列入待处理，不混入逐段翻译流程。

## 14. 验收标准

整批任务完成必须同时满足：

- 每个有配对详解文件的原题，都完成 `passageNotes[]` 精翻。
- 每篇文章都是逐篇完成，有单篇验收记录。
- 每个段落都是逐段翻译，有单段输入输出记录。
- 没有整篇批量翻译记录。
- 没有多段合并翻译记录。
- 没有摘要式 `passageNotes`。
- 所有修改后的详解 JS 均可正常加载。
- 必须测试通过：
  - `python developer/tests/ci/run_static_suite.py`
  - `python developer/tests/e2e/suite_practice_flow.py`
- 所有缺失详解文件都有清单。
- 所有失败文章都有失败原因和下一步处理建议。

## 15. 执行纪律

最重要的纪律：

1. 一次只处理一篇文章。
2. 一次只翻译一个段落。
3. 当前段没验收，不碰下一段。
4. 当前篇没验收，不碰下一篇。
5. 任何省略、总结、吞内容，都是失败。
6. 任何无法证明的“应该没问题”，都不算通过。

这个任务的难点不是翻译，而是不要让流程偷懒。偷懒会产生看起来很顺、实际害人的答案。
