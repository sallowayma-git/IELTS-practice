# BUG-003: [VocabScheduler] — SM2_CONSTANTS.DEFAULT_EASE_FACTOR 不存在导致 NaN

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** High
**Reproducibility:** Always（当 easeFactor 为 0 或 null 时）

---

## Summary

`calculateEaseFactor` 和 `calculateInterval` 引用 `SM2_CONSTANTS.DEFAULT_EASE_FACTOR`，但 `SM2_CONSTANTS` 对象中不存在该常量（只定义了 `MIN_EASE_FACTOR`、`MAX_EASE_FACTOR` 等）。当 `oldEF`/`easeFactor` 为 `0` 或 `null` 时，`ef` 变为 `undefined`，后续所有数学运算产生 `NaN`，破坏整个 SM-2 调度链。

## Expected Behavior

`DEFAULT_EASE_FACTOR` 应可用，fallback 到标准值 2.5。

## Actual Behavior

`SM2_CONSTANTS.DEFAULT_EASE_FACTOR` 为 `undefined`，`ef = undefined` → `newEF = NaN` → 间隔计算为 `NaN` → `nextReview` 为 `Invalid Date`，导致该单词永久卡在错误状态。

## Fix

在 `SM2_CONSTANTS` 中添加 `DEFAULT_EASE_FACTOR: 2.5`。

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/core/vocabScheduler.js` | 3-9 | 添加 `DEFAULT_EASE_FACTOR: 2.5` |
