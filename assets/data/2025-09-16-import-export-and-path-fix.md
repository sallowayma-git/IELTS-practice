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

# 2025-09-16 设置页“加载题库”修复与增强

## 1) 概述

- 修复：全量加载后的题库无法打开网页/PDF（点击无响应/提示“题目不存在”）。
- 增强：每次加载（全量/增量）后导出时间命名的题库配置脚本，便于放置到 `assets/scripts/` 统一管理，格式与内置索引文件一致。

## 2) 根因（Root Cause）

- `js/app.js` 的 `openExam()` 固定从 `storage.get('exam_index')` 取数据，忽略了 “活动题库配置键” `active_exam_index_key`。
- 全量加载会将新索引写入 `exam_index_<timestamp>` 并切换为活动配置；App 仍查 `exam_index`，导致找不到新题目，网页和 PDF 均无法打开。

## 3) 变更（What Changed）

- js/app.js
  - openExam(): 改为优先读取 `active_exam_index_key` 指向的键，回退到 `exam_index`。
- js/main.js
  - 新增 `exportExamIndexToScriptFile(fullIndex, noteLabel)`：导出合并后的题库配置为 `exam-index-YYYYMMDD-HHmmss.js`（下载保存后请放入 `assets/scripts/`）。
    - 输出包含：
      - `window.completeExamIndex = [...]`（阅读，按内置文件规范，不带 `type` 字段）
      - `window.listeningExamIndex = [...]`（听力，原样保留 `type: 'listening'` 字段）
  - 在加载题库流程中调用导出：
    - 全量重载：创建并激活新配置后立即导出（刷新前）。
    - 增量更新：更新索引后亦导出一次，便于归档/回滚。
  - 暴露弹窗入口：`window.showLibraryLoaderModal = showLibraryLoaderModal`，确保设置面板按钮可用。

## 4) 兼容性（Never break userspace）

- 不改变既有数据结构与字段语义；仅修复索引选择逻辑并增加导出辅助能力。
- 继续兼容历史 `exam_index` 键；未切换活动配置时行为不变。
- 导出的脚本与 `assets/scripts/complete-exam-data.js`、`listening-exam-data.js` 保持同一接口字段。

## 5) 验证用例（Verification）

- 步骤：
  1. 设置 → 加载题库 → 选择阅读或听力目录 → 全量重载。
  2. 页面刷新后，浏览“题库浏览”，任意题目点击“开始”应能打开 HTML；“PDF” 按钮可正常打开 PDF。
  3. 在下载目录获取 `exam-index-YYYYMMDD-HHmmss.js`，放入 `assets/scripts/` 归档。
- 观测：
  - 不再出现“题目不存在”；窗口打开正常。
  - 导出提示成功；脚本内容含两段 `window.*ExamIndex` 赋值。

## 6) 风险与回滚

- 风险：若用户选择的目录不在项目根目录结构内，路径可能无法通过相对链接访问（浏览器 file:// 安全限制）。
- 回滚：恢复 `active_exam_index_key` 到 `exam_index`；或删除新配置键；将 UI 切换回默认配置。

---

变更涉及文件：

- js/app.js
- js/main.js
