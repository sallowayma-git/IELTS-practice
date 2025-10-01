# 风险和回滚计划

## 功能对等检查清单

此清单确保新架构（App.stores, App.events）与遗留系统功能对等。仅在所有项目获得对等签字后，方可移除遗留代码。签字需由开发者和测试者共同完成。

### 题库浏览
- [ ] ExamBrowser 正确加载和显示题库列表，与旧版浏览一致。
- [ ] ExamFilterBar 和 ExamList 支持过滤、分页，与旧版行为相同。
- [ ] file:// 协议下，题库数据从 localStorage 或 assets/data/path-map.json 加载正常，无网络依赖。
- [ ] 签字：___________________ (开发者) / ___________________ (测试者)

### 练习
- [ ] PracticeSessionSystem 启动练习会话，题型渲染（question-types.js）与旧版对等。
- [ ] practiceRecorder 记录练习过程，支持中断恢复，与旧版相同。
- [ ] PDFHandler 处理 PDF 练习文件，兼容 file:// 路径。
- [ ] 签字：___________________ (开发者) / ___________________ (测试者)

### 记录
- [ ] RecordStore 保存/加载练习记录到 localStorage，与旧版数据格式兼容。
- [ ] RecordViewer 和 RecordStats 显示历史记录、统计，与旧版 UI 和计算一致。
- [ ] practiceHistoryEnhancer 生成趋势图和成就，与旧版功能匹配。
- [ ] 签字：___________________ (开发者) / ___________________ (测试者)

### 设置
- [ ] SettingsPanel 显示系统信息（考试总数、更新时间），与旧版对等。
- [ ] themeManager 和 SettingsActions 处理主题切换、备份恢复，与旧版设置一致。
- [ ] "Rebuild indexes" 和 "Restore backup" 按钮功能正常，localStorage 操作兼容 file://。
- [ ] 签字：___________________ (开发者) / ___________________ (测试者)

所有核心功能对等确认后，方可移除遗留代码（如 js/compatibility/legacy-bridge.js）。

## 回滚步骤

如果新架构引入问题，按以下步骤回滚到遗留系统。假设遗留文件已存档在 `assets/legacy/` 目录（包含旧 JS、CSS 和数据文件）。脚本标签指 HTML 中的 `<script>` 标签加载旧 JS 文件。

1. **停止新架构加载**：
   - 在 index.html 中注释或移除加载 App.stores 和 App.events 的脚本标签。
   - 示例：`<!-- <script src="js/app.js"></script> -->`（保留遗留 main.js 等）。

2. **恢复遗留文件**：
   - 从备份复制遗留文件到根目录：`cp -r assets/legacy/* .`（使用终端或手动）。
   - 覆盖 js/main.js、css/style.css、assets/scripts/complete-exam-data.js 等核心遗留文件。
   - 验证文件完整性：检查 MD5 或行数与存档匹配。

3. **恢复 localStorage 数据**：
   - 在浏览器控制台运行：`localStorage.clear();` 清空新数据。
   - 重新加载页面，遗留系统将从 assets/data/ 重新初始化 localStorage。
   - 或使用 "Restore backup" 按钮（如果可用）从 assets/data/backup.json 恢复。

4. **重新加载脚本标签**：
   - 在 index.html 中取消注释遗留脚本：`<script src="js/main.js"></script>`、`<script src="assets/scripts/listening-exam-data.js"></script>` 等。
   - 移除新架构入口：注释 `window.App = new App();` 或类似全局初始化。

5. **测试回滚**：
   - 刷新页面，验证核心功能（题库浏览、练习、记录、设置）恢复到遗留状态。
   - 检查控制台无错误，file:// 协议正常运行。
   - 如果问题持续，手动恢复 index.html 从 `assets/legacy/index.html`。

6. **文档更新**：
   - 在此文件添加回滚时间戳和问题描述。
   - 通知团队，回滚完成。

回滚预计时间：15-30 分钟。确保备份当前状态前执行（使用 dataBackupManager.js 导出 localStorage）。

此计划确保系统 resilience，兼容 file:// 环境。