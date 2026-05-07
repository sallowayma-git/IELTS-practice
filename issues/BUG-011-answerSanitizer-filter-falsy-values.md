# BUG-011: [AnswerSanitizer] — filter 丢弃布尔 false 和数字 0

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** Medium
**Reproducibility:** Always（当答案数组包含 false 或 0 时）

---

## Summary

`normalizeValue` 中对数组元素使用 `.filter(function (item) { return item; })`，将 `false`（布尔）和 `0`（数字）视为 falsy 过滤掉。True/False/NG 题型的原始答案数据可能含 boolean 类型，过滤后结果被破坏。

## Expected Behavior

应只过滤 `null`、`undefined`、空字符串，保留 `false` 和 `0`。

## Actual Behavior

`[false, true]` → `[true]`，比对结果错误。

## Fix

改为 `.filter(function (item) { return item !== null && item !== undefined && item !== ''; })`。

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/utils/answerSanitizer.js` | 57 | 精确过滤 null/undefined/'' |
