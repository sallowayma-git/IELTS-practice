# BUG-002: [AnswerComparison] — buildAnswerDetails/convertAnswerMapToArray — 简单字符串对比替代 AnswerMatchCore 导致 isCorrect 判定失真

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** Medium
**Reproducibility:** Always（当用户答案与正确答案存在格式差异时）

---

## Summary

多个核心函数在判定答案正确性时使用简单的 `userAnswer.toLowerCase() === correctAnswer.toLowerCase()` 字符串比较，而非调用 `AnswerMatchCore.compareAnswers()` 进行语义级对比。当用户答案与正确答案仅存在格式差异（如多余空格、逗号分隔、"Yes"/"True" 等布尔同义词、NOT GIVEN 简写等），`isCorrect` 会被错误标记为 `false`。对比之下，`answerComparisonUtils.js` 中的 `answersMatch` 正确使用了 `AnswerMatchCore`。

受影响的函数：
- `practiceCore.js:349` — `buildAnswerDetails`
- `practiceRecorder.js:786-788` — `convertAnswerMapToArray`
- `practiceRecorder.js:829-830` — `buildAnswerDetails`
- `scoreStorage.js:1127` — `buildAnswerDetailsFromMaps`

## Expected Behavior

正确性判定应使用 `AnswerMatchCore.compareAnswers(userAnswer, correctAnswer)`，该函数能够：
- 正确拆分多值答案（如 `"A,B"` vs `"A, B"`）
- 识别布尔同义词（`yes`/`true`, `no`/`false`）
- 识别 NOT GIVEN 简写（`ng` → `not given`）
- 统一标点符号和空白字符

## Actual Behavior

使用简单 `.toLowerCase()` 全等比较，导致以下场景均被误判为错误答案：
- `"A,B"` vs `"A, B"` → ❌（应为 ✅）
- `"yes"` vs `"True"` → ❌（应为 ✅）
- `"ng"` vs `"not given"` → ❌（应为 ✅）
- `"  reading"` vs `"reading"` → ❌（经 normalizeAnswerValue trim 后可能正确，但不可靠）

错误的 `isCorrect` 标志被持久化到 answerList 和 answerDetails 中，影响数据导出、统计重算和记录回放的逐题判定。

## Reproduction Steps

**Prerequisites:** 任意包含多选题（如听力多选题，答案形式为 "A, B"）或 True/False/Not Given 题的练习页面。

1. 在浏览器中打开 `index.html`
2. 进入任意包含多选题的练习页面
3. 用户提交答案 `A,B`（无空格），正确答案为 `A, B`（有空格）
4. 完成练习，练习记录被保存
5. 检查保存记录的 `answerList` 或 `scoreInfo.details` 中对应题目的 `isCorrect`
6. 或通过 `listCanonicalPracticeRecords()` 导出记录后检查

**Observe:** 对应题目的 `isCorrect` 为 `false`，而非 `true`。

### Minimal Reproduction

```javascript
// 模拟两个格式不同的答案
const userAnswer = 'A,B';
const correctAnswer = 'A, B';

// practiceCore.buildAnswerDetails 的行为
const answerMap = { q1: userAnswer };
const correctMap = { q1: correctAnswer };
const details = PracticeCore.contracts.buildAnswerDetails(answerMap, correctMap);
console.log(details.q1.isCorrect);  // false（应为 true）

// AnswerMatchCore 的正确结果
const expected = AnswerMatchCore.compareAnswers(userAnswer, correctAnswer);
console.log(expected);  // true
```

## Environment

### Platform

| Detail | Value |
|--------|-------|
| **OS** | Windows (win32) |
| **Protocol** | file:// |
| **Workspace** | `C:\Users\lenovo\Desktop\working space\0.3.1 working` |

## Error Output

无控制台错误。此 bug 为**静默逻辑错误**——判定函数选择不正确，不抛异常。

实际影响：
- 导出的练习记录 JSON 中 `isCorrect` 字段不可靠
- `answerList[i].correct` 字段可能错误
- 基于 `answerList` 重算 `correctAnswers` 时（如 `deriveCorrectAnswerCount`）得到偏低的数值
- 记录回放时的逐题正确/错误指示可能失真

## Impact

- **Scope:** 所有包含格式差异答案的练习记录（多选题、T/F/NG 题、填空题）
- **Workaround:** 暂无。数据一旦保存，错误的 `isCorrect` 已固化。只能依赖 `answerComparisonUtils.getNormalizedEntries` 在展示层重新计算（该函数正确使用了 `AnswerMatchCore`）
- **Blocking:** 不影响主流程（`correctAnswers` 计数来自 scoreInfo 而非重算），但数据质量受损；若未来任何功能依赖 `answerList[i].correct` 字段，将产生级联错误

## Related Files

| File | Relevance |
|------|-----------|
| `js/core/practiceCore.js:337-359` | `buildAnswerDetails` — simple `.toLowerCase()` at line 349 |
| `js/core/practiceRecorder.js:767-799` | `convertAnswerMapToArray` — simple `.toLowerCase()` at line 787 |
| `js/core/practiceRecorder.js:815-838` | `buildAnswerDetails` (fallback) — simple `.toLowerCase()` at line 830 |
| `js/core/scoreStorage.js:1112-1136` | `buildAnswerDetailsFromMaps` — simple `.toLowerCase()` at line 1127 |
| `js/utils/answerComparisonUtils.js:209-231` | `answersMatch` — **正确实现**（使用 `AnswerMatchCore.compareAnswers`），作为修复参考 |
| `js/utils/answerMatchCore.js:121-143` | `compareAnswers` — 正确的语义级对比实现 |

## Notes

**根本原因:**
1. 四处代码在实现时选择了最直接的字符串全等比较，而非调用已存在的 `AnswerMatchCore.compareAnswers`
2. `answerComparisonUtils.js:answersMatch` 中已有正确实现，但在 `buildAnswerDetails`、`convertAnswerMapToArray` 等核心函数中未被复用
3. `normalizeAnswerValue()` 仅做 trim 和基本清洗，不做语义归一化，因此依赖其上层的对比函数必须考虑格式差异

**修复方向:**
各受影响的 `isCorrect` 判定行应从：
```javascript
isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
```
改为：
```javascript
const matchCore = window.AnswerMatchCore;
isCorrect = matchCore && typeof matchCore.compareAnswers === 'function'
    ? matchCore.compareAnswers(userAnswer, correctAnswer) === true
    : userAnswer.toLowerCase() === correctAnswer.toLowerCase();
```
