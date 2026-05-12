# BUG-001: [PracticeRecords] — syncPracticeRecords — 旧版记录accuracy未归一化导致百分比数值溢出

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** High
**Reproducibility:** Always（当旧版记录存在且accuracy以百分比形式存储时）

---

## Summary

`syncPracticeRecords` 在 `js/main.js:345-351` 读取旧版练习记录时，未对 `accuracy` 做百分比→小数的归一化（而 `scoreStorage.js` 和 `practiceCore.js` 均做了此归一化），导致 `accuracy=80`（百分比形式）时计算出 `percentage = Math.round(80 * 100) = 8000%`，最终在练习记录UI中显示错误的百分比。

## Expected Behavior

旧版记录中 `accuracy: 80` 应当被正确解释为 80% 的正确率，UI 中应显示 `80%`，对应的 `percentage` 字段应为 `80`。

## Actual Behavior

`syncPracticeRecords` 第一遍 map（行 345-368）将 `accuracy=80` 原值保留为 `acc=80`，然后 `pct = Math.round(80 * 100) = 8000`。第二遍 map（行 379-426）虽然设计了重新计算的逻辑，但因为 `r.accuracy` 和 `r.percentage` 已在第一遍被赋值，两个检查条件 `(accuracy === undefined || percentage === undefined)` 永远不成立，重新计算路径成为死代码，无法修复前面的错误值。

最终记录中 `accuracy: 80`、`percentage: 8000` 被写入 UI 和 app state。

## Reproduction Steps

**Prerequisites:** 本地 localStorage 或 IndexedDB 中存在一条旧版练习记录，其 `accuracy` 字段存储为百分比形式（例如 `accuracy: 80` 而非 `accuracy: 0.8`），且该记录未经过 `scoreStorage.js` 或 `practiceCore.js` 的标准化流程。

1. 在浏览器中打开 `index.html`
2. 等待页面完成启动和练习记录同步（`syncPracticeRecords` 被调用）
3. 导航到「练习记录」视图
4. 观察该旧版记录的显示百分比

**Observe:** 该记录在「平均正确率」统计或列表行中显示为 `8000%` 而非 `80%`。

### Minimal Reproduction

```javascript
// 模拟一条旧版记录
const legacyRecord = {
  id: 'record_test',
  examId: 'test-001',
  accuracy: 80,        // 百分比形式，未归一化为 0.8
  correctAnswers: 8,
  totalQuestions: 10,
  title: '测试题目',
  date: new Date().toISOString()
};

// 直接存入 storage 绕过 ScoreStorage 标准化
await storage.set('practice_records', [legacyRecord]);

// 触发 syncPracticeRecords()
await syncPracticeRecords({ forceRender: true });

// 检查结果
const rec = window.app.state.practice.records[0];
console.log(rec.accuracy);    // 80  (应为 0.8)
console.log(rec.percentage);  // 8000 (应为 80)
```

## Environment

### Platform

| Detail | Value |
|--------|-------|
| **OS** | Windows (win32) |
| **Protocol** | file:// |
| **Workspace** | `C:\Users\lenovo\Desktop\working space\0.3.1 working` |

## Error Output

无控制台错误。此 bug 为**静默数据损坏**——数值计算错误但不抛异常。

实际影响可在 UI 中观察到：
- 练习记录列表中该记录的百分比显示为 `8000%`
- 该记录对应的 `avg-score` 统计卡片数值严重偏离
- `accuracy` 字段保留为 `80`（应为 0~1 之间的小数），下游任何依赖 accuracy 为 [0,1] 区间的计算同样受影响

## Impact

- **Scope:** 所有拥有未经标准化流水线（ScoreStorage/PracticeCore）写入的旧版练习记录的用户
- **Workaround:** 手动清理 localStorage 中 `practice_records` 键或通过 `ScoreStorage.standardizeRecord()` 重新标准化后写回
- **Blocking:** 导致练习记录页面的「平均正确率」统计卡片数值严重失真，影响用户对学习进度的判断；任何依赖 `accuracy` 为 [0,1] 区间假设的下游计算均受影响

## Related Files

| File | Relevance |
|------|-----------|
| `js/main.js:326-461` | `syncPracticeRecords` 函数——两遍 map 处理均存在此问题 |
| `js/core/scoreStorage.js:878-889` | `standardizeRecord` 中有正确的归一化逻辑（`accuracy > 1 && accuracy <= 100` → `/100`），可作为修复参考 |
| `js/core/practiceCore.js:636-642` | `standardizeRecord` 中同样有正确的归一化逻辑 |
| `js/main.js:975-980` | `savePracticeRecordFallback` 中的 `pct` 计算同样存在此问题 |

## Notes

**根本原因推测（仅供调查参考，非结论）：**

1. `syncPracticeRecords` 直接读取原始存储数据，未委托给 `ScoreStorage.standardizeRecord()` 或 `practiceCore.standardizeRecord()` 做标准化——两者均在各自 `standardizeRecord` 中有 `accuracy > 1 && accuracy <= 100 → accuracy / 100` 的归一化
2. 第一遍 map（行 345-368）无条件将 `r.accuracy` 保留为 `acc`，然后用 `acc * 100` 算 `pct`，隐含假设 `acc` 永远在 [0,1] 区间
3. 第二遍 map（行 379-426）设计上想兜底修复，但因第一遍已给 `r.accuracy` 和 `r.percentage` 赋值，条件 `accuracy === undefined || percentage === undefined` 永远不成立，导致归一化逻辑成为死代码
4. `savePracticeRecordFallback`（行 975-980）有相同模式的 `pct = Math.round(acc * 100)` 计算，同样存在风险
