# BUG-004: [Storage] — cleanupOldData 压缩导致永久性答案数据丢失

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** Critical
**Reproducibility:** Always（每次 cleanupOldData 执行时）

---

## Summary

`cleanupOldData` 对每条练习记录调用 `this.compressObject(record)`，该函数的 `coreFields` 白名单不包含 `answers`、`correctAnswerMap`、`answerComparison`、`answerDetails`、`metadata`。用户的练习答案详情被不可逆删除。

## Expected Behavior

清理操作不应删除用户的答题数据，应只清理日志和过期会话。

## Actual Behavior

每次 `cleanupOldData` 运行时，所有 `practice_records` 中的答案数据被静默删除，用户打开历史记录详情时显示为空。

## Fix

从 `cleanupOldData` 中移除 `practice_records` 的压缩操作，只保留日志清理和过期会话清理。

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/utils/storage.js` | 1043-1048 | 移除 compressObject 调用，仅保留日志清理 |
