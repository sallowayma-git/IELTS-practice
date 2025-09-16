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
