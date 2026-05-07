# BUG-006: [DataConsistencyManager] — calculateScoreFromComparison 分母只含已答题

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** High
**Reproducibility:** Always（当存在未作答题目时）

---

## Summary

`calculateScoreFromComparison` 将 `total`（分母）只算用户已作答的题目数，未作答的题目不计入 total，导致 accuracy 系统性虚高。

## Expected Behavior

`total` 应等于全部题目数（`Object.keys(answerComparison).length`），未作答应计入分母并视为答错。

## Actual Behavior

```javascript
if (comparison.userAnswer !== null) {
    total++;  // 只计已答题目
}
```
40题考试答了35题 → total=35，accuracy = correct/35 而非 correct/40。

## Fix

```javascript
total++;
if (comparison.userAnswer !== null && comparison.isCorrect) {
    correct++;
}
```
所有题目计入分母，未作答不增加 correct。

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/utils/dataConsistencyManager.js` | 296-302 | total 改为全部题目，未作答不算正确 |
