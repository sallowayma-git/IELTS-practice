# 2025-09-16 导入/导出兼容与阅读路径修复

- 执行人：Linus Torvalds
- 背景：全量加载后题库网页/PDF 无法打开；导出文件导入后无做题记录显示。

## 根因
- 路径问题：`js/main.js` 中阅读根路径常量出现乱码，`resolveExamBasePath` 拼接错误，导致 `window.open` 指向不存在的路径。
- 导入/导出问题：
  - 使用 `StorageManager` 后，localStorage 键带前缀（`exam_system_*`）且值被 `{ data, timestamp, version }` 包裹；
  - 导出直接吐出包装对象；导入时用 `storage.set(key, value)` 导致“二次加前缀+二次包裹”，记录写入错误键（`exam_system_exam_system_*`），UI 读不到。

## 变更
- 路径修复（不破坏用户空间）：
  - `js/main.js:resolveExamBasePath` 注入 Hotfix，强制使用正确阅读根路径 `睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/`，并保持原有判定避免双重拼接。
  - `js/script.js` 的 `openExam/viewPDF` 优先使用统一的 `buildResourcePath`，减少分散逻辑与编码差异。
  - `js/app.js:openExam` 读取 `active_exam_index_key`，回退 `exam_index`，确保全量/增量切换后能打开。

- 导出兼容（Never break userspace）：
  - `DataIntegrityManager.exportData` 增补扁平字段：
    - `data.practice_records`：优先取 `exam_system_practice_records.data`，否则从 `storage.get('practice_records')`。
    - `data.user_stats`：优先取 `exam_system_user_stats.data`，否则从 `storage.get('user_stats')`。

- 导入兼容（去前缀+解包 data）：
  - `DataIntegrityManager.importData` 早期分支：
    - 识别新旧结构（扁平 `practice_records`、`exam_system_practice_records.data`、旧版 `records/practiceRecords`）。
    - 将记录写入 `storage.set('practice_records', records)`；`user_stats` 同理。
    - 对 `data` 其余键：移除前缀（`exam_system_`）并解包 `{ data }` 再 `storage.set`，避免双前缀与嵌套。
  - 旧逻辑兜底也改为去前缀+解包，避免再次写入错误键。

## 验证要点
- 用旧文件 `ielts_data_export_2025-09-13.json` 导入：练习记录可见，数量一致。
- 用新文件 `ielts_data_export_2025-09-16 (1).json` 导入：练习记录加载正常（不再写入 `exam_system_exam_system_*`）。
- 全量加载阅读题库后：
  - 任意题目“开始”可打开 HTML；
  - “PDF”按钮可打开 PDF；
  - 无需手动修改路径配置。

## 影响面与回滚
- 变更均为兼容增强与路径修复，不改变旧数据语义；
- 回滚可恢复到上一个版本文件或移除新增 Hotfix 代码块。

