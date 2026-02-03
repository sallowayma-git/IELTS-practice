# Findings & Decisions
<!-- 
  WHAT: Your knowledge base for the task. Stores everything you discover and decide.
  WHY: Context windows are limited. This file is your "external memory" - persistent and unlimited.
  WHEN: Update after ANY discovery, especially after 2 view/browser/search operations (2-Action Rule).
-->

## Requirements
<!-- 
  WHAT: What the user asked for, broken down into specific requirements.
  WHY: Keeps requirements visible so you don't forget what you're building.
  WHEN: Fill this in during Phase 1 (Requirements & Discovery).
  EXAMPLE:
    - Command-line interface
    - Add tasks
    - List all tasks
    - Delete tasks
    - Python implementation
-->
<!-- Captured from user request -->
-

## Research Findings
<!-- 
  WHAT: Key discoveries from web searches, documentation reading, or exploration.
  WHY: Multimodal content (images, browser results) doesn't persist. Write it down immediately.
  WHEN: After EVERY 2 view/browser/search operations, update this section (2-Action Rule).
  EXAMPLE:
    - Python's argparse module supports subcommands for clean CLI design
    - JSON module handles file persistence easily
    - Standard pattern: python script.py <command> [args]
-->
<!-- Key discoveries during exploration -->
-

## Technical Decisions
<!-- 
  WHAT: Architecture and implementation choices you've made, with reasoning.
  WHY: You'll forget why you chose a technology or approach. This table preserves that knowledge.
  WHEN: Update whenever you make a significant technical choice.
  EXAMPLE:
    | Use JSON for storage | Simple, human-readable, built-in Python support |
    | argparse with subcommands | Clean CLI: python todo.py add "task" |
-->
<!-- Decisions made with rationale -->
| Decision | Rationale |
|----------|-----------|
|          |           |

## Issues Encountered
<!-- 
  WHAT: Problems you ran into and how you solved them.
  WHY: Similar to errors in task_plan.md, but focused on broader issues (not just code errors).
  WHEN: Document when you encounter blockers or unexpected challenges.
  EXAMPLE:
    | Empty file causes JSONDecodeError | Added explicit empty file check before json.load() |
-->
<!-- Errors and how they were resolved -->
| Issue | Resolution |
|-------|------------|
|       |            |

## Resources
<!-- 
  WHAT: URLs, file paths, API references, documentation links you've found useful.
  WHY: Easy reference for later. Don't lose important links in context.
  WHEN: Add as you discover useful resources.
  EXAMPLE:
    - Python argparse docs: https://docs.python.org/3/library/argparse.html
    - Project structure: src/main.py, src/utils.py
-->
<!-- URLs, file paths, API references -->
-

## Visual/Browser Findings
<!-- 
  WHAT: Information you learned from viewing images, PDFs, or browser results.
  WHY: CRITICAL - Visual/multimodal content doesn't persist in context. Must be captured as text.
  WHEN: IMMEDIATELY after viewing images or browser results. Don't wait!
  EXAMPLE:
    - Screenshot shows login form has email and password fields
    - Browser shows API returns JSON with "status" and "data" keys
-->
<!-- CRITICAL: Update after every 2 view/browser operations -->
<!-- Multimodal content must be captured as text immediately -->
-

---
<!-- 
  REMINDER: The 2-Action Rule
  After every 2 view/browser/search operations, you MUST update this file.
  This prevents visual information from being lost when context resets.
-->
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*

## 2026-02-03
- 任务范围：ListeningPractice 题源规模较大，需要系统扫描并记录问题 HTML。
- 顶层目录已发现 ListeningPractice 文件夹，需作为扫描入口。
- 本地无 rg，可改用 find/grep。
- ListeningPractice 目录按 P3/P4/100 P1/100 P4 等分区，HTML 数量巨大。
- 文件命名与标题前缀不一致（如 "PART4"/"PART 4"/缺前缀），说明标题抽取需要统一规则。
- 问题样本：ListeningPractice/P3/19. PART3 It brings teaching problems when based on old methods/PART3 It brings teaching problems when based on old methods.html
  - <title> 为 "IELTS Listening Practice - Part 3 Teaching Methods"
  - <h1> 为 "19. PART3 It brings teaching problems when based on old methods"
  - 标题来源不一致，可能导致父页/详情标题污染。
- P3/19 HTML 内存在大量 <span class="answer-highlight">... (Qxx: A/B/C)</span> 的标记，答案字母嵌在定位句中。
- 同页脚本存在 correctAnswers 对象（需确认其结构），实际正确答案应以该对象为准而非定位句文本。
- P3/19 脚本内存在 correctAnswers 对象（q21-q30 -> A/B/C），与 transcript 中 answer-highlight 的 (Qxx: 字母) 一致。
- 现有抽取若直接抓取 answer-highlight 文本会把整句当答案，导致结果区显示句子而非字母。
- 问题样本：ListeningPractice/P3/18. PART3 Maori Greenstone Tiki Carvings/Maori Greenstone Tiki Carvings.html
  - <title> 为 "IELTS Listening Practice - Part 3 Maori Greenstone Tiki Carvings"（父页应仅显示主题名）。
- P3/18 的 <h1> 为 "18. PART3 Maori Greenstone Tiki Carvings"；UI 期望显示主题名，需要统一裁剪规则（去编号/Part 前缀）。
- practice-page-enhancer.js 已内置 sanitizeExamTitle（从 title 中剥离 'IELTS Listening Practice - Part X' 前缀），但仍需统一使用权威字段。
- CorrectAnswerExtractor 使用多策略：包含 transcript .answer-highlight 的抽取入口（可能导致整句被当作答案）。
- practice-page-enhancer.js: extractAnswersFromTranscriptElement 会把 .answer-highlight 的整句清理后作为答案，且支持从 transcript 文本提取。
- CorrectAnswerExtractor 策略优先顺序包含 extractFromDOM → transcript 文本路径，容易覆盖正确答案对象并导致错误映射。
- practicePageEnhancer.extractFromTranscript 会把 transcript 的 answer-highlight 与文本解析结果写入 correctAnswers，未限制为单字母，导致结果区显示整句。
- extractFromTranscript 在 extractFromDataAttributes 之后调用，可能覆盖/混入正确答案对象。

## 2026-02-04 扫描摘要（ListeningPractice）
- HTML 总数：197
- 主要问题计数：
  - title_has_ielts_prefix: 195
  - title_h1_mismatch: 151
  - correctAnswers_not_global: 147
  - transcript_only_answers: 147
  - h1_has_leading_number: 118
  - answer_tag_not_global: 65
  - missing_h1: 43
  - h1_has_part_prefix: 26
- 样本路径（每类 1-3 个）：
  - missing_h1: ListeningPractice/100 P1/P1 中频(48)/1-10/套题T1-10.html
  - title_has_ielts_prefix: ListeningPractice/100 P1/P1 中频(48)/1-10/套题T1-10.html
  - title_h1_mismatch: ListeningPractice/P3/1. PART3 Julia and Bob’s science project is due/1. PART3 Julia and Bob’s science project is due.html
  - transcript_only_answers: ListeningPractice/P3/1. PART3 Julia and Bob’s science project is due/1. PART3 Julia and Bob’s science project is due.html
  - correctAnswers_not_global: ListeningPractice/P3/1. PART3 Julia and Bob’s science project is due/1. PART3 Julia and Bob’s science project is due.html
  - answer_tag_not_global: ListeningPractice/P3/10. PART3  Research for assignment of children playing outdoors/10. PART3  Research for assignment of children playing outdoors.html
  - h1_has_part_prefix: ListeningPractice/P3/36. PART3 Research into how babies learn/36. PART3 Research into how babies learn.html
- Dry-run 规范化报告显示 197 个文件会被改动（主要为 title/h1/答案全局化）。

## ListeningPractice 扫描摘要 (2026-02-04 00:54:11)
- 总文件数: 197
- title_has_ielts_prefix: 195
  - ListeningPractice/100 P1/P1 中频(48)/1-10/套题T1-10.html
- title_h1_mismatch: 151
  - ListeningPractice/P3/1. PART3 Julia and Bob’s science project is due/1. PART3 Julia and Bob’s science project is due.html
- correctAnswers_not_global: 147
  - ListeningPractice/P3/10. PART3  Research for assignment of children playing outdoors/10. PART3  Research for assignment of children playing outdoors.html
- transcript_only_answers: 147
  - ListeningPractice/P3/1. PART3 Julia and Bob’s science project is due/1. PART3 Julia and Bob’s science project is due.html
- h1_has_leading_number: 118
  - ListeningPractice/P3/11. PART3 About cookery books/11. PART3 About cookery books.html
- answer_tag_not_global: 65
  - ListeningPractice/P3/11. PART3 About cookery books/11. PART3 About cookery books.html
- missing_h1: 43
  - ListeningPractice/100 P1/P1 中频(48)/1-10/套题T1-10.html
- h1_has_part_prefix: 26
  - ListeningPractice/P3/36. PART3 Research into how babies learn/36. PART3 Research into how babies learn.html

## ListeningPractice 扫描摘要（修复后，2026-02-04 01:25:00）
- 总文件数: 197
- h1_has_part_prefix: 2
  - ListeningPractice/P4/14. PART4  Honeybee/14. PART4  Honeybee.html
  - ListeningPractice/P4/64. PART4 Organic Farming/64. PART4 Organic Farming.html

## ListeningPractice 扫描摘要（数字+PART 修复后，2026-02-04 01:33:00）
- 总文件数: 197
- issue 计数：全部为 0（扫描报告无 Issue Counts 项）
