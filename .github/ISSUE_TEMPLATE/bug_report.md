---
name: "Bug 报告 / Bug report"
about: "报告可复现的功能或运行问题 / Report a reproducible problem"
title: "[Bug] "
labels: ""
assignees: ""
---

<!--
适用范围：已有功能没有按预期工作，例如页面打不开、题库为空、资源 404、成绩没有保存或数据不可见。
Use this template when an existing feature does not work as expected, such as a page failing to open, an empty question bank, a 404 resource, an unsaved result, or missing data.
如果是题干、选项、文章、答案、解析、翻译、题目元数据或题源映射本身有误，请使用“内容或题目纠错 / Content or question correction”。
If the problem is incorrect prompt, option, passage, answer, explanation, translation, metadata, or source mapping, use "Content or question correction" instead.
-->

## 问题概述 / Summary

<!-- 请用一两句话说明发生了什么，以及影响了哪个页面或功能。
Please describe what happened and which page or feature is affected. -->

## 运行环境 / Environment

- 应用版本或 commit / App version or commit:
- 产品形态或分支 / Product variant or branch: <!-- 静态网页、Node.js 自部署版、AI 客户端 / Static site, Node.js self-hosted, AI client -->
- 浏览器及版本 / Browser and version:
- 操作系统及设备 / OS and device:
- 运行方式 / Run mode:
  - [ ] `file://` 直接打开 / Opened directly
  - [ ] 本地静态服务器 / Local static server
  - [ ] 静态网页托管 / Static hosting
  - [ ] 其他 / Other:
- 题库来源 / Data source:
  - [ ] 默认题库 / Default question bank
  - [ ] 导入或自定义题库 / Imported or custom question bank
  - [ ] 本地听力扩展 / Local listening extension
- 页面、功能或题目定位 / Page, feature, or question reference:

## 复现步骤 / Steps to reproduce

1.
2.
3.

## 预期结果 / Expected result

<!-- 说明正常情况下应该发生什么。
Describe what should have happened. -->

## 实际结果 / Actual result

<!-- 说明实际发生了什么；如有错误提示请保留原文。
Describe what actually happened and include the exact error message if there is one. -->

## 错误信息与证据 / Errors and evidence

<!--
请粘贴相关的 Console 错误、失败请求及状态码、资源 URL 或截图。
Please include relevant Console errors, failed requests and status codes, resource URLs, or screenshots.
请移除个人信息、令牌和其他敏感数据；不要粘贴完整的第三方文章、PDF 或音频内容。
Remove personal information, tokens, and other sensitive data. Do not paste complete third-party articles, PDFs, or audio content.
-->

```text
在此粘贴日志或错误信息 / Paste logs or error messages here
```

## 影响范围 / Impact

- 复现频率 / Reproducibility: <!-- 每次、偶尔、仅一次 / Every time, sometimes, once -->
- 是否造成数据丢失 / Data loss: <!-- 否 / No；是，请说明 / Yes, describe it -->
- 临时解决方法 / Workaround, if any:

## 补充信息 / Additional context

<!-- 任何有助于定位问题的背景、截图或相关 issue。
Add any other context, screenshots, or related issues that may help diagnose the problem. -->
