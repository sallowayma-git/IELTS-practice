# BUG-008: [AnswerComparisonUtils] — inferCategory 正则不匹配 P4

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** Medium
**Reproducibility:** Always（当记录属于 P4 听力时）

---

## Summary

`inferCategory` 使用正则 `/p([1-3])/i` 匹配题目分类，遗漏了 P4（听力 Section 4）。所有 P4 听力记录被分配到 `Unknown` 分类。

## Expected Behavior

P4 题目应正确识别分类为 `P4`。

## Actual Behavior

`/p([1-3])/i` 不包含 4，P4 记录 → `Unknown`。

## Fix

改为 `/p([1-4])/i`。

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/utils/answerComparisonUtils.js` | 722 | `/p([1-3])/i` → `/p([1-4])/i` |
