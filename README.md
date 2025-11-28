# IELTS 练习系统使用说明

## 系统简介

这是一个本地化的 IELTS（雅思）练习系统，专为阅读和听力部分设计，支持 P1、P2、P3 难度级别。系统是纯前端应用，使用 HTML5、CSS3 和 JavaScript ES6+ 构建，无需服务器部署，直接在浏览器中运行。核心功能包括题库浏览、练习记录管理、数据备份/导入和系统设置。题库基于静态文件（HTML 交互式和 PDF 静态），通过 localStorage 持久化用户数据，支持跨窗口通信（postMessage）采集练习结果。当前版本 v1.0.0，总题目约 147 篇（包括阅读和听力），自动扫描题库路径，确保离线可用。

系统目标：提供高效的雅思练习管理，帮助用户跟踪进度、分析统计，并通过简单设置维护数据完整性。维护焦点：题库路径标准化、localStorage 容量管理（<5MB）和浏览器兼容性。

## 快速开始

### 1. 系统要求
- 现代浏览器：Chrome 60+、Firefox 55+、Safari 12+、Edge 79+（推荐 Chrome 以获得最佳性能）
- 支持 JavaScript ES6+、localStorage 和 postMessage
- 屏幕分辨率：建议 1024x768 或更高；移动设备支持响应式设计（横屏优先）
- 无需安装依赖，纯静态文件；首次运行可能需允许弹窗和文件访问

### 2. 启动系统
1. 下载并解压整个项目目录到本地文件夹（保持 `js/`、`css/`、`assets/` 和题库文件夹结构完整）
2. 双击打开主文件 `improved-working-system.html`（或 `index.html` 如果是备用入口）
3. 系统自动初始化：加载题库索引（`exam_index`），显示主界面；DevTools（F12）Console 无错误表示成功
4. 验证加载：点击“📚 题库浏览”，确认 P1/P2/P3 分类显示；检查“⚙️ 设置” > “系统信息” 中的题目总数（约 147）
5. 多窗口使用：新开标签练习不会冲突（localStorage 隔离）；刷新页面（Ctrl+Shift+R）清缓存重载

如果题库未加载，检查路径：阅读题库位于 `睡着过项目组/2. 所有文章(11.20)[192篇]/`，听力位于 `ListeningPractice/`；使用“⚙️ 设置” > “📂 加载题库” 手动导入。

### 3. 基本操作
- **总览**：点击“📊 总览”，查看分类卡片（P1/P2/P3 统计）
- **题库浏览**：点击“📚 题库浏览”，搜索/过滤题目（全部/阅读/听力）
- **练习记录**：点击“📝 练习记录”，查看统计和历史列表
- **设置**：点击“⚙️ 设置”，管理数据、备份和主题

## 主要功能

### 📚 题库浏览与管理
系统动态扫描题库文件夹，生成索引（`exam_index`：{id, title, path, filename, category}），支持阅读（P1/P2/P3，134 篇）和听力。总题目 147 篇，每题通常有 HTML（交互练习）和 PDF（静态查看）。
- **分类与过滤**：按 P1（基础）、P2（中级）、P3（高级）显示；顶部按钮过滤“全部/阅读/听力”。示例：P1 - "A survivor’s story 新西兰猫头鹰"（历史主题）；P2 - "Bird Migration 鸟类迁徙"；P3 - "Elephant Communication 大象交流"。
- **搜索功能**：输入框搜索标题/关键词（支持中英，如“tea 茶叶”），实时过滤列表。益处：快速定位弱点题目。
- **格式支持**：
  - **HTML**：点击“开始练习”打开新窗口，支持交互答题、计时和结果采集（通过 enhancer.js 注入脚本）。
  - **PDF**：直接查看/下载，适合打印或离线阅读（所有题目可用）。
- **加载与配置**：设置 > “📂 加载题库” 使用文件夹选择器导入新题库（全量重载生成新索引，或增量更新添加标识如 [新集]）；“⚙️ 题库配置切换” 查看/切换配置列表（默认 `exam_index`，新配置如 `exam_index_时间戳`）。状态显示：系统信息中“题目总数/HTML/PDF/最后更新”。
- **场景**：浏览时预览标题/难度，随机练习或针对分类；增量更新保护默认配置，避免覆盖旧数据。

### 📝 练习记录与统计
自动记录练习会话（通过 PracticeRecorder），存储在 localStorage（`exam_system_practice_records` 数组），支持分析和导出。核心字段：id、examId、title、category、date、duration、percentage、realData（答案/交互/scoreInfo）。
- **统计总览**：卡片显示“已练习题目”（total-practiced）、“平均正确率”（avg-score %）、“学习时长”（study-time 分钟）、“连续学习天数”（streak-days）。基于 ScoreAnalyzer 计算：总练习/平均分数/趋势（线性回归）。
- **历史列表**：时间线显示记录，支持过滤“全部/阅读/听力”；点击展开详情（分数、时间、笔记）。批量操作：选中后“📝 批量删除”；“📄 导出 Markdown” 生成报告（标题/日期/分数/解析）。
- **数据管理**：导入 JSON 记录（合并去重）；清除记录（clearPracticeData()）。益处：趋势分析（如最近 30 天进步率），识别弱分类/题型（e.g., P3 准确率 60%）。
- **高级分析**：通过 ScoreAnalyzer 生成雷达图数据（分类/题型准确率/稳定性）；RecommendationEngine 建议针对弱点（如“练习 P3 总结题”）。
- **场景**：练习后自动保存，查看“练习历史” 筛选本周阅读，导出 Markdown 分享进度。

### ⚙️ 系统设置与维护
提供工具管理数据和 UI，支持主题切换和诊断。存储键：`exam_system_user_stats`（统计）、`exam_system_settings`（配置）。
- **系统管理**：
  - “🗑️ 清除缓存”：清浏览器缓存，重载题库。
  - “📂 加载题库”：弹窗选择文件夹（阅读/听力两栏），全量/增量导入，生成/更新索引。
  - “⚙️ 题库配置切换”：列表显示配置（当前标记），切换/删除（默认不可删）。
  - “🔄 强制刷新题库”：重新扫描 exam_index，更新系统信息。
- **数据管理**：
  - “💾 创建备份”：生成 JSON（records/stats/校验和），限 20 个。
  - “📋 备份列表”：查看历史，恢复指定备份。
  - “📤 导出数据”：全量 JSON/CSV（包含历史/统计）。
  - “📥 导入数据”：上传 JSON，选项合并/替换/跳过，验证完整性。
- **系统信息**：显示“题库状态/总数/HTML/PDF/最后更新”；“🎨 主题切换” 弹窗选择 Academic/Bloom/Melody（跳转对应 HTML）。
- **其他**：开发团队弹窗（睡着过成员列表）；隐私：所有数据本地，无外部传输。
- **场景**：每月备份，导入旧记录；切换主题优化视觉（如 Melody 粉色 UI）。

### 📈 推荐与优化（内置引擎）
基于 RecommendationEngine，自动生成练习建议：分析弱点（低准确率分类/题型）、难度调整（±0.1 基于最近平均）、多样性过滤（max 30% 同类型）。在总览/记录中显示“推荐练习：P3 总结题”。

## 详细使用指南

### 开始练习
1. 点击“📚 题库浏览”，使用搜索框输入关键词或过滤类型（阅读/听力）。
2. 选择分类（P1/P2/P3），浏览列表，点击题目标题预览。
3. 点击“开始练习”：打开新窗口加载 HTML，系统注入 enhancer.js 采集答案（监听 change/click/drop）；计时器启动。
4. 答题：交互支持多选/填空/匹配，提交后显示分数/解析；postMessage 发送结果回主窗。
5. 完成：自动保存记录，通知“练习完成，分数 X%”；返回总览查看更新统计。
提示：听力练习类似，但需音频文件（若缺失，fallback 文本模式）；中断练习会保存 interrupted_record。

### 查看与管理练习记录
1. 点击“📝 练习记录”，查看顶部统计卡片（总览数字实时更新）。
2. 在“练习历史” 部分，过滤类型（全部/阅读/听力），滚动列表查看条目（日期/标题/分数/时长）。
3. 操作：点击记录展开详情；选中多条 > “📝 批量删除”；“📄 导出 Markdown” 下载报告（格式：# 练习记录\n- 日期：... 分数：...）。
4. 分析：查看趋势（e.g., 连续天数），使用导入恢复旧数据。
提示：记录限 1000 条，超限自动清理旧的；导出 CSV 适合 Excel 图表。

### 系统设置和维护
1. 点击“⚙️ 设置”，浏览分节：系统管理（按钮组）、数据管理（备份按钮）、系统信息（状态显示）。
2. **加载题库**：点击“📂 加载题库”，选择文件夹（webkitdirectory），选择全量/增量；确认路径（阅读：睡着过.../听力：ListeningPractice），系统生成索引并刷新。
3. **备份/恢复**：点击“💾 创建备份” 下载 JSON；“📥 导入数据” 上传文件，选择合并模式，验证后应用。
4. **主题与信息**：点击“🎨 主题切换” 选择风格（Academic 专业/Bloom 暖色/Melody 粉色），跳转新页面；查看“系统信息” 监控总数/更新时间。
5. **维护**：点击“🗑️ 清除缓存” 优化性能；定期“强制刷新题库” 更新索引。
提示：备份包含校验和，导入时自动验证；移动设备：横屏使用，测试 touch 交互。

## 练习技巧
- **备考策略**：从 P1 热身（multiple-choice/TFNG），渐进 P3（summary/heading-matching）；使用过滤针对题型弱点。
- **时间管理**：严格 20 分钟/文章，记录 duration 分析效率。
- **错误反思**：查看 realData.answerComparison（用户 vs 正确答案），笔记同义替换/陷阱。
- **进度追踪**：监控 streak-days 和 avg-score，目标 Band 7+（准确率 70%+）；每周导出 Markdown 回顾。
- **优化**：使用推荐引擎建议，结合官方 IELTS 标准自评；移动练习 PDF 模式通勤。

## 故障排除

### 常见问题

#### 1. 题目无法打开
**症状**：点击“开始练习”后空白页面或 Console 错误（如 404/跨域）。

**解决方案**：
- 允许浏览器弹窗（Chrome 设置 > 隐私 > 弹出窗口）。
- 检查题库路径：设置 > “系统信息” 确认总数；手动“📂 加载题库” 重新导入文件夹。
- DevTools（F12） > Network 查看文件加载（无 404）；Console 搜索“inject” 错误。
- 高级：enhancer.js 注入失败，重启浏览器或清缓存；fallback 直接打开 HTML 文件。

#### 2. 练习数据丢失
**症状**：统计为 0 或历史列表空，localStorage 键缺失。

**解决方案**：
- 检查浏览器模式（禁用隐私/隐身）；扩展未禁用 localStorage。
- 恢复备份：设置 > “📥 导入数据” 上传 JSON，选合并模式。
- 验证：DevTools > Application > localStorage > exam_system_practice_records（数组非空）。
- 高级：DataIntegrityManager 检查一致性，修复 orphaned records（examId 不匹配索引）。

#### 3. 系统运行缓慢
**症状**：加载 >5s，列表滚动卡顿，Console 警告内存高。

**解决方案**：
- 清缓存：设置 > “🗑️ 清除缓存” 或 DevTools > Application > Clear storage。
- 优化：关闭多标签，检查 Performance（录制 10s）；题库 >100 篇时使用搜索过滤。
- 更新浏览器；DevTools > Memory 查看 heap size（<500MB）。
- 高级：PerformanceOptimizer 报告 FPS/加载时间，throttle 事件（resize 250ms）。

#### 4. 移动设备显示异常
**症状**：布局错位，按钮无响应，触摸拖拽失效。

**解决方案**：
- 横屏使用现代移动浏览器（Chrome Mobile）；禁用缩放（viewport initial-scale=1）。
- 刷新页面；测试 PDF 模式静态查看。
- DevTools 设备模拟（iPhone），检查 media queries（@media 768px）。
- 高级：touchHandler.js 启用，测试 dropzone 交互。

#### 5. 搜索/过滤无结果
**症状**：输入关键词列表空，过滤按钮无效。

**解决方案**：
- 检查拼写（中英支持）；刷新题库（设置 > “🔄 强制刷新”）。
- 验证索引：系统信息 > “题库状态：已加载完整索引”；重新“📂 加载题库”。
- Console 搜索“scanExamLibrary” 错误。
- 高级：IndexValidator 重建 exam_index，检查 duplicateIds。

#### 6. 备份/导入失败
**症状**：导出空文件，导入报错（parse/validate）。

**解决方案**：
- 备份：确保 records 非空；格式 JSON/CSV，包含 exportInfo。
- 导入：上传有效 JSON（checksum 匹配）；选替换模式覆盖损坏数据。
- DevTools > Console “validateImportData” 错误，检查 required 字段（id/date）。
- 高级：createPreImportBackup 前备份，executeImport 跳过 invalid。

### 高级故障排除

#### 系统检测工具
1. 设置 > “🔧 系统管理” > 运行“强制刷新” 或 DevTools 检查。
2. 查看 Console 日志（[App]/[Enhancer] 过滤）；export 报告 JSON。
3. 完整扫描：checkExamIntegrity（index/files/consistency/storage），生成 summary（valid/missing）。
4. 修复：rebuildExamIndex 扫描文件夹，recalculateUserStats。

#### 数据完整性检查
1. 设置 > “数据管理” > “📥 导入” 前验证；或 DevTools > localStorage getAll。
2. checkDataConsistency：orphaned records/stats mismatch，自动 repair（reparse）。
3. 历史：getExport/ImportHistory，清理 expired (>1y)。

#### 重置系统
严重问题：
1. 备份：设置 > “📤 导出数据” 下载全量。
2. 清数据：设置 > “🗑️ 清除记录” 或 localStorage.clear()（DevTools）。
3. 刷新页面重载；导入备份恢复。
4. 测试：重新加载题库，确认无错误。
警告：重置丢失未备份数据；兼容 old records 通过 versionUpgrade。

## 技术说明

### 系统架构
- **前端技术**：纯原生 JS ES6+（class/async/Map），无框架；~50 模块（components/ UI、core/ 逻辑、utils/ 工具）。
- **数据存储**：localStorage（键前缀 `exam_system_`，JSON {data, timestamp, version}）；fallback 内存 Map。限 5MB，自动压缩/清理。
- **文件格式**：题库 HTML（交互，注入 enhancer.js 采集答案/进度）、PDF（浏览器查看器）；索引 exam_index（动态扫描文件夹）。
- **通信机制**：postMessage 跨窗口（父-子：INIT_SESSION → SESSION_READY → PRACTICE_COMPLETE）；握手 300ms 重试，容错 reconnect。
- **初始化流程**：DOMContentLoaded → ExamSystemApp.initialize()（dependencies → responsive → components → events → loadData → view）；核心组件：PracticeRecorder（记录）、StorageManager（持久化）。
- **性能/错误**：throttle 事件、懒加载题库；globalErrorHandling（unhandledrejection → log + fallback UI）。

### 数据格式
- **练习记录**（`practice_records` 数组）：
  ```json
  {
    "id": "unique-uuid",
    "examId": "p1-1",
    "title": "The History of Tea",
    "category": "P1",
    "date": "2025-09-17T17:00:00Z",
    "duration": 45,
    "percentage": 85,
    "dataSource": "real",
    "realData": {
      "answers": {"q1": "A", "q2": "TRUE"},
      "scoreInfo": {"correct": 12, "total": 14},
      "answerComparison": [{"q1": {"user": "A", "correct": "A", "match": true}}],
      "interactions": [{"type": "click", "time": 10}]
    }
  }
  ```
- **用户统计**（`user_stats`）：{totalPractices, avgScore, timeSpent, streakDays, categoryStats: {P1: {avg: 80}} }。
- **备份文件**：JSON {version, exportDate, data: {records, stats, backups}, checksum: SHA-256}；支持 CSV 导出（headers: id/examId/score 等）。
- **题库索引**（`exam_index`）：数组 [{id: "p1-1", title: "...", path: "睡着过.../", filename: "P1 - Topic.html", category: "P1"}]。

### 浏览器兼容性
- Chrome 60+、Firefox 55+、Safari 12+、Edge 79+（file:// 支持 postMessage）。
- 限制：IE 不支持 localStorage；移动 Safari PDF/触摸需测试。
- 安全：本地数据，无 API；sanitize HTML 防注入（utils/helpers.js）。

## 更新日志

### v0.5.0 (当前版本)
- ✅ 题库管理：动态扫描/加载（147 篇，阅读/听力过滤）
- ✅ 练习记录：自动采集（realData + fallback 模拟）、统计（avg/streak）、导出 Markdown/JSON
- ✅ 跨窗口通信：postMessage 注入 enhancer.js，握手/进度/完成
- ✅ 数据备份/恢复：export/import/validate，配置切换（多题库）
- ✅ 性能优化：懒加载/throttle，StorageManager 压缩
- ✅ 错误处理：globalError + fallback UI，SystemDiagnostics 检查
- ✅ 响应式设计：移动适配，主题切换（Academic/Bloom/Melody）
- ✅ 用户体验：搜索/批量操作，开发团队弹窗

## 联系支持

如果问题未解决：
1. 运行设置 > “系统管理” 检查状态，截图系统信息/Console 错误。
2. 测试不同浏览器（Chrome 优先），记录步骤/版本/路径。
3. 备份数据后重置（clear + reload）。
4. 反馈：睡着过开发团队（弹窗列表），或 GitHub Issues（若开源）。

## 许可证

代码采用 GNU General Public License v3 (GPL v3)，详情见 LICENSE 文件。使用、修改、分发必须提供源代码并遵守 GPL 条款。题库内容版权归原作者，仅供学习使用，禁止商业分发。[GPL v3 详情](https://www.gnu.org/licenses/gpl-3.0.html)
