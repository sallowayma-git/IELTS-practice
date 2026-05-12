# BUG-007: [DataManagementPanel] — 导入文件不解析 JSON

**Reporter:** CodeReview Agent
**Date:** 2026-05-07
**Severity:** High
**Reproducibility:** Always（通过文件导入时）

---

## Summary

`handleFileSelect` 用 `readAsText` 读取文件后将原始字符串赋给 `this.selectedFileContent`。`handleImport` 将原始字符串直接传给 `importPracticeData`，不做 `JSON.parse`。用户以为导入成功，实际数据无效。

## Expected Behavior

文件内容应在存储前解析为 JSON 对象。

## Actual Behavior

原始文本字符串被当作数据传入导入流程，导入静默失败。

## Fix

在 `handleFileSelect` 中对读取的内容执行 `JSON.parse(content)` 后再赋值。

## Related Files

| File | Line | Change |
|------|------|--------|
| `js/components/dataManagementPanel.js` | 593-594 | 添加 JSON.parse |
