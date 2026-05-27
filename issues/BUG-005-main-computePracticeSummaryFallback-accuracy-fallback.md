# BUG-005: [Main] — computePracticeSummaryFallback 缺少 accuracy 后备

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** High
**Reproducibility:** Always（当记录有 accuracy 但缺少 percentage 时）

---

## Summary

`computePracticeSummaryFallback` 行1755只用 `record.percentage` 计算平均分，完全忽略 `record.accuracy`。如果记录只有 `accuracy` 值而 `percentage` 未被显式设置（旧版数据、导入数据），则该记录对平均分的贡献为 0，严重拉低统计。

## Expected Behavior

当 `percentage` 不可用时，应从 `accuracy` 推导出百分比值（`Math.round(accuracy * 100)`）。

## Actual Behavior

`const percentage = typeof record.percentage === 'number' ? record.percentage : 0;` — 缺少 `accuracy` 后备，导致 `totalScore += 0`。

## Fix

增加对 `accuracy` 的降级读取：
```javascript
const percentage = typeof record.percentage === 'number' ? record.percentage : (typeof record.accuracy === 'number' ? Math.round(record.accuracy * 100) : 0);
```

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/main.js` | 1755 | 添加 accuracy→percentage 后备 |
