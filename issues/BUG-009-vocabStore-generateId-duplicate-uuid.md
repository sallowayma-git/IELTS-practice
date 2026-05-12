# BUG-009: [VocabStore] — convertSpellingErrorToWord 生成重复单词

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** Medium
**Reproducibility:** Always（当 crypto.randomUUID 可用时）

---

## Summary

`generateId` 在 `crypto.randomUUID` 可用时忽略 seed 参数，每次返回全新的随机 UUID。同一拼写错误词被多次重复添加到词库。

## Expected Behavior

同一单词应生成确定性 ID，避免重复添加。

## Actual Behavior

`crypto.randomUUID()` 每次返回不同 UUID → 同词重复入库。

## Fix

当 seed 非空时，使用字符串哈希算法生成确定性 ID（`'word-' + hash`）。

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/core/vocabStore.js` | 107-113 | crypto.randomUUID 分支改为确定性哈希 |
