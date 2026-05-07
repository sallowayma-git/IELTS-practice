# Issue Tracker

> 最后更新: 2026-05-07

## 概览

| 状态 | 数量 |
|------|------|
| Open | 0 |
| Fixed | 11 |
| WontFix | 0 |

## 详细列表

| ID | 标题 | 严重度 | 状态 | 发现日期 | 修复日期 | 涉及文件 |
|----|------|--------|------|----------|----------|----------|
| [BUG-001](./BUG-001-syncPracticeRecords-accuracy-percentage-overflow.md) | syncPracticeRecords 旧版记录 accuracy 未归一化导致百分比数值溢出 | High | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/main.js:350-352, 980-982` |
| [BUG-002](./BUG-002-buildAnswerDetails-simple-comparison-isCorrect-inaccuracy.md) | buildAnswerDetails/convertAnswerMapToArray 简单字符串对比替代 AnswerMatchCore 导致 isCorrect 判定失真 | Medium | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/core/practiceCore.js:349`, `js/core/practiceRecorder.js:787,830`, `js/core/scoreStorage.js:1127` |
| [BUG-003](./BUG-003-vocabScheduler-missing-DEFAULT_EASE_FACTOR.md) | SM2_CONSTANTS.DEFAULT_EASE_FACTOR 不存在导致 NaN | High | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/core/vocabScheduler.js:3-9, 59, 81` |
| [BUG-004](./BUG-004-storage-cleanupOldData-data-loss.md) | cleanupOldData 压缩导致永久性答案数据丢失 | Critical | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/utils/storage.js:1043-1048` |
| [BUG-005](./BUG-005-main-computePracticeSummaryFallback-accuracy-fallback.md) | computePracticeSummaryFallback 缺少 accuracy 后备 | High | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/main.js:1755` |
| [BUG-006](./BUG-006-dataConsistencyManager-calculateScoreFromComparison-inflated-accuracy.md) | calculateScoreFromComparison 分母只含已答题 | High | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/utils/dataConsistencyManager.js:296-302` |
| [BUG-007](./BUG-007-dataManagementPanel-import-json-parse.md) | 导入文件不解析 JSON | High | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/components/dataManagementPanel.js:593-594` |
| [BUG-008](./BUG-008-answerComparisonUtils-inferCategory-p4-missing.md) | inferCategory 正则不匹配 P4 | Medium | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/utils/answerComparisonUtils.js:722` |
| [BUG-009](./BUG-009-vocabStore-generateId-duplicate-uuid.md) | convertSpellingErrorToWord 生成重复单词 | Medium | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/core/vocabStore.js:107-113` |
| [BUG-010](./BUG-010-practiceRecorder-updateUserStats-dead-code.md) | updateUserStats 死代码，分类/题型统计永为空 | Medium | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/core/practiceRecorder.js:1739-1782` |
| [BUG-011](./BUG-011-answerSanitizer-filter-falsy-values.md) | filter 丢弃布尔 false 和数字 0 | Medium | ✅ Fixed | 2026-05-07 | 2026-05-07 | `js/utils/answerSanitizer.js:57` |

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-05-07 | 初始化 issue tracker；BUG-001 已修复 |
| 2026-05-07 | 全量代码审阅发现 BUG-002：answerDetails 简单字符串对比导致 isCorrect 失真 |
| 2026-05-07 | 批量修复 BUG-003 ~ BUG-011（9个bug）：vocabScheduler NaN、storage 数据丢失、averageScore 后备、calculateScore 分母、导入JSON解析、P4正则、generateId重复、updateUserStats死代码、filter falsy值 |
| 2026-05-07 | BUG-002 已修复：4处 isCorrect 判定改用 AnswerMatchCore.compareAnswers()，保留简单对比 fallback |
