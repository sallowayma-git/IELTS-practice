# BUG-010: [PracticeRecorder] — updateUserStats 死代码，分类/题型统计永为空

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** Medium
**Reproducibility:** Always

---

## Summary

`updateUserStats`（行1830-1908）包含完整的 categoryStats 和 questionTypeStats 更新逻辑，但从未被调用。降级路径只调用 `updateUserStatsManually`，后者缺少分类和题型统计更新。

## Expected Behavior

`updateUserStatsManually` 应复用 `updateUserStats` 的完整逻辑。

## Actual Behavior

分类统计（categoryStats）和题型统计（questionTypeStats）永远为空。

## Fix

`updateUserStatsManually` 改为直接调用 `this.updateUserStats(practiceRecord)`。

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/core/practiceRecorder.js` | 1739-1782 | 委托给 updateUserStats |
