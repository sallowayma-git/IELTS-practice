# 2025-09-17 练习记录导入显示为0/undefined 修复
- 执行人：Linus Torvalds
- 背景：在 index 练习记录页，导入 2025-09-16/17 的导出 JSON 后，卡片“用时=0、正确率=0”，详情页顶部“分数 undefined/undefined、准确率=0”。导入 2025-09-13 的旧文件显示正常。

## 根因
- 2025-09-16/17 的导出数据将字段集中到 `realData.scoreInfo`（correct/total/accuracy/percentage/details），且部分记录缺失顶层 `accuracy/percentage/totalQuestions/correctAnswers/duration/startTime/endTime`。
- UI 渲染（js/main.js、components/practiceHistory.js）直接读取顶层字段，缺失时回退为 0 或拼接 `undefined/undefined`。
- DataIntegrityManager.importData 导入“系统级导出”后直接写入存储，未做记录归一化，导致新旧数据结构并存。

## 变更（Never break userspace）
- js/core/scoreStorage.js：
  - 新增 `normalizeRecordFields(record)`，从 `realData/scoreInfo` 派生并填充缺失的顶层字段：
    - 时间：`startTime/endTime`（从 `realData.startTime/endTime/date` 派生）、`duration`（秒）
    - 成绩：`correctAnswers/totalQuestions/accuracy/percentage`
    - 详情：`scoreInfo/answers`
    - 元信息：`metadata.examTitle/category/frequency`
  - `getPracticeRecords()` 返回前对每条记录做归一化；
  - `recalculateUserStats()` 统计前对记录做归一化，保证用时/准确率正确累计。
- js/main.js：
  - `syncPracticeRecords()` 优先通过 `PracticeRecorder.getPracticeRecords()` 获取已归一化记录；若降级则做最小归一化回退。
  - `renderPracticeRecordItem()` 百分比缺失时从 `accuracy*100` 推导，避免 0% 误报。

## 验证
- 导入 `ielts_data_export_2025-09-13.json`：显示保持不变；
- 导入 `ielts_data_export_2025-09-16.json`/`2025-09-17.json`：
  - 练习卡片显示：用时正确（秒/分钟换算）、正确率正常（非 0%）；
  - 详情顶部：分数显示为 `correct/total`，准确率与用时正确；
  - 统计卡片：总学习时长与平均正确率符合记录。

## 影响面与回滚
- 仅在读取路径上做兼容扩展，不更改存储中的原始数据；旧数据完全不受影响；
- 如需回滚，移除上述归一化调用即可恢复原行为。

## 涉及文件
- js/core/scoreStorage.js
- js/main.js
