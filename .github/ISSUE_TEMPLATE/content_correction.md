---
name: "内容或题目纠错 / Content or question correction"
about: "报告题干、答案、解析或题库元数据错误 / Report an error in question content, answers, explanations, or metadata"
title: "[Content] "
labels: ""
assignees: ""
---

<!--
适用范围：题干、选项、文章、答案、解析、翻译、题目元数据或题源映射有误。
Use this template for incorrect prompts, options, passages, answers, explanations, translations, metadata, or source mappings.
如果是页面无法加载、答案提交失败或记录没有保存，请使用“Bug 报告 / Bug report”。
For loading failures, submission failures, or unsaved records, use "Bug report" instead.
请只提供定位所需的最小摘录和来源信息，不要上传完整文章、PDF、音频或整套题库。
Provide only the minimum excerpt and source reference needed for verification. Do not upload complete articles, PDFs, audio, or question banks.
-->

## 模态与内容来源 / Modality and content source

- [ ] 阅读 / Reading
- [ ] 听力本地扩展 / Local listening extension
- 模态或内容来源 / Modality or content source details:
  - [ ] 仓库默认题库 / Repository default question bank
  - [ ] 导入或自定义题库 / Imported or custom question bank
  - [ ] 用户自备本地听力扩展 / User-provided local listening extension
  - [ ] 其他 / Other:
- 内容、题库或配置版本 / Content, question-bank, or configuration version:

<!--
对于用户自备听力扩展，请说明这是导入、索引或映射问题；仓库无法维护或更正用户自备题源本身。
For user-provided listening extensions, please report import, index, or mapping problems. The repository cannot maintain or correct the user-provided source material itself.
-->

## 题目定位 / Question location

- `examId`:
- 题目标题 / Exam or passage title:
- 部分 / Part: <!-- 阅读 P1-P3；听力 P1-P4 / Reading P1-P3; Listening P1-P4 -->
- 页面显示题号 / Displayed question number:
- 题目 ID（如已知）/ Question ID, if known: <!-- 例如 `q5` / e.g. `q5` -->
- 题型 / Question type:
- 资源路径或链接（如已知）/ Asset path or URL, if known:

## 错误字段 / Incorrect field

- [ ] 题干或文章 / Prompt or passage
- [ ] 选项 / Option
- [ ] 正确答案 / Correct answer
- [ ] 解析 / Explanation
- [ ] 翻译 / Translation
- [ ] 题目元数据 / Metadata
- [ ] 题源映射 / Source mapping
- [ ] 其他 / Other:

## 当前内容 / Current content

<!-- 粘贴能定位错误的最小文本片段，并说明它在页面中的位置。
Paste the smallest text excerpt that shows the problem and explain where it appears on the page. -->

## 建议修改 / Suggested correction

<!-- 给出建议文本、答案或元数据；如无法确定，请说明疑点。
Provide the suggested text, answer, or metadata. If uncertain, describe the concern instead. -->

## 依据 / Evidence

- 段落、PDF 页码或音频时间点 / Paragraph, PDF page, or audio timestamp:
- 来源链接 / Source link:
- 最小必要摘录 / Minimal supporting excerpt:

## 影响 / Impact

- [ ] 可能影响评分 / May affect scoring
- [ ] 可能影响解析理解 / May affect explanation or understanding
- [ ] 仅影响展示或元数据 / Affects display or metadata only
- 受影响的其他题目或页面 / Other affected questions or pages:

## 确认 / Confirmation

- [ ] 我已提供 `examId`、题号或其他足以定位题目的信息。
      I provided `examId`, a question number, or other information sufficient to locate the item.
- [ ] 我只提供了必要摘录，没有上传完整第三方材料。
      I included only necessary excerpts and did not upload complete third-party material.
- [ ] 我已移除个人信息、令牌和其他敏感数据。
      I removed personal information, tokens, and other sensitive data.
