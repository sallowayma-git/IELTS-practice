# 实施计划

- [x] 1. 创建正确答案提取器组件


  - 实现CorrectAnswerExtractor类，支持多种答案提取策略
  - 添加从DOM、全局对象和结果表格提取答案的方法
  - 实现答案标准化和验证功能
  - _需求: 5.1, 5.2, 5.4_

- [x] 2. 修复导出按钮冻结问题


  - 创建AsyncExportHandler类处理异步导出
  - 实现进度指示器显示和隐藏功能
  - 添加导出错误处理和用户反馈机制
  - 修改exportPracticeData函数使用异步处理
  - _需求: 1.1, 1.2, 1.3, 1.4_

- [x] 3. 增强PracticePageEnhancer收集正确答案


  - 集成CorrectAnswerExtractor到PracticePageEnhancer中
  - 在练习开始时提取并存储正确答案
  - 修改数据传输格式包含正确答案信息
  - 确保答案比较数据的完整性
  - _需求: 5.1, 5.2, 5.3_

- [x] 4. 创建数据一致性管理器


  - 实现DataConsistencyManager类
  - 添加记录数据验证和补充功能
  - 实现答案格式标准化方法
  - 确保弹窗和导出使用相同数据源
  - _需求: 3.1, 3.2, 3.3, 3.4_

- [x] 5. 修复PracticeRecordModal显示问题


  - 更新modal组件使用增强的数据格式
  - 修复正确答案显示逻辑
  - 确保答案比较结果的准确性
  - 添加数据缺失时的降级处理
  - _需求: 2.1, 2.2, 2.3, 2.4_

- [x] 6. 更新MarkdownExporter使用一致数据


  - 修改导出器使用DataConsistencyManager
  - 确保导出的答案详情与弹窗一致
  - 添加正确答案列的正确显示
  - 实现导出数据的验证机制
  - _需求: 3.1, 3.2, 3.3, 3.4_

- [x] 7. 改进组件加载和错误处理


  - 修复PracticeHistoryEnhancer初始化问题
  - 添加组件加载失败的备用机制
  - 实现组件状态检查和重试逻辑
  - 优化控制台日志和错误报告
  - _需求: 4.1, 4.2, 4.3, 4.4_

- [x] 8. 集成测试和验证



  - 创建完整流程测试脚本
  - 验证弹窗和导出数据一致性
  - 测试各种练习页面格式的兼容性
  - 确保所有组件正确加载和通信
  - _需求: 1.1-1.4, 2.1-2.4, 3.1-3.4, 4.1-4.4, 5.1-5.4_

- [x] 9. 修复练习页面脚本注入问题
  - 创建练习页面注入器，确保增强脚本正确加载到练习页面
  - 修复答案收集不完整问题，实现全面的答案监听
  - 解决正确答案提取失败问题，增强答案数据源检测
  - 优化跨页面通信机制，确保数据传输完整性
  - _需求: 5.1, 5.2, 5.3, 2.1, 2.2_

- [x] 10. 合并重复文件并修复语法错误





  - 删除practicePageManager.js，其功能已整合到practice-page-enhancer.js
  - 修复practice-page-enhancer.js中的JavaScript语法错误
  - 统一代码风格，使用function声明替代箭头函数避免this绑定问题
  - 确保所有事件监听器正确绑定上下文
  - _需求: 代码整理和错误修复_

- [x] 11. 修复正确答案数据传输问题




  - 增强practice-page-enhancer.js的正确答案提取功能
  - 确保answerComparison数据正确生成并传输到主系统
  - 修复practiceRecordModal.js中正确答案显示为N/A的问题
  - 实现从练习页面结果表格提取正确答案的功能
  - _需求: 数据一致性修复_

- [x] 12. 解决导出功能卡死问题


  - 修复MarkdownExporter中的无限循环或阻塞问题
  - 添加导出进度指示和超时处理机制
  - 优化大数据量导出的性能
  - 确保导出过程中UI保持响应
  - _需求: 导出功能稳定性_

- [x] 13. 清理测试文件和优化代码库


  - 删除tests目录下的开发测试文件
  - 移除test-practice-page.html等测试页面
  - 清理不必要的调试代码和console.log
  - 优化文件结构，减少代码冗余
  - _需求: 代码库清理_
- [x] 14. 诊断并修复正确答案数据传输链路


  - 分析practice-page-enhancer.js中正确答案提取失败的根本原因
  - 修复extractFromResultsTable函数，确保能从练习结果表格正确提取答案
  - 验证answerComparison数据结构正确生成并传输到主系统
  - 确保practiceRecordModal.js能正确接收和显示正确答案数据
  - 修改文件：js/practice-page-enhancer.js, js/components/practiceRecordModal.js
  - _需求: 5.1, 5.2, 5.3, 2.1, 2.2_

- [x] 15. 修复MarkdownExporter导出卡死问题



  - 识别并修复markdownExporter.js中导致页面冻结的代码段
  - 实现真正的异步处理，避免长时间阻塞主线程
  - 优化大数据量处理，添加适当的yield点让出控制权
  - 修复进度指示器显示和隐藏逻辑
  - 修改文件：js/utils/markdownExporter.js, js/utils/asyncExportHandler.js
  - _需求: 1.1, 1.2, 1.3, 1.4_

- [x] 16. 修复组件加载失败问题


  - 诊断PracticeHistory和PracticePageEnhancer组件未加载的原因
  - 修复文件路径、依赖关系或初始化顺序问题
  - 确保所有必要的脚本文件正确加载到页面中
  - 添加组件加载状态检查和错误恢复机制
  - 修改文件：improved-working-system.html, js/core/practiceRecorder.js
  - _需求: 4.1, 4.2, 4.3, 4.4_

- [x] 17. 实现数据一致性验证和修复


  - 创建数据验证函数，检查练习记录的完整性
  - 实现数据修复逻辑，补充缺失的正确答案和比较结果
  - 确保弹窗显示和导出使用完全相同的数据源和处理逻辑
  - 添加数据质量检查和报告功能
  - 修改文件：js/components/practiceRecordModal.js, js/utils/markdownExporter.js
  - _需求: 3.1, 3.2, 3.3, 3.4_

- [x] 18. 端到端测试和验证



  - 创建完整流程测试脚本
  - 验证弹窗和导出数据一致性
  - 测试各种边缘情况和错误恢复场景
  - 创建文件：js/testing/end-to-end-test.js
  - _需求: 1.1-1.4, 2.1-2.4, 3.1-3.4, 4.1-4.4, 5.1-5.4_

- [x] 19. 修复Utils.formatDuration缺失导致的系统崩溃



  - 诊断Utils.formatDuration函数缺失的根本原因
  - 在utils模块中实现formatDuration函数
  - 修复practiceHistory.js中的无限错误循环
  - 确保所有依赖Utils的组件正常工作
  - 修改文件：js/utils/utils.js, js/components/practiceHistory.js
  - _需求: 系统稳定性和基本功能恢复_

- [x] 20. 修复practiceRecorder.getPracticeRecords缺失和DOM访问错误


  - 诊断practiceRecorder.getPracticeRecords函数缺失的根本原因
  - 修复DOM元素访问错误，确保元素存在后再设置属性
  - 修复practiceHistory组件初始化和数据加载问题
  - 确保练习历史记录界面正确显示和功能正常
  - 修改文件：js/core/practiceRecorder.js, js/components/practiceHistory.js, improved-working-system.html
  - _需求: 系统稳定性和练习历史功能恢复_

- [x] 21. 恢复简单的练习记录界面


  - 移除复杂的PracticeHistory组件和相关功能
  - 恢复原来简单的练习记录显示方式
  - 保持基本的统计信息显示（总练习次数、平均正确率等）
  - 移除不必要的筛选、分页、导出等复杂功能
  - 确保界面简洁直观，符合用户需求
  - 修改文件：improved-working-system.html, js/app.js
  - _需求: 界面简化和用户体验优化_
  - [x] 22. 恢复导出数据和批量管理功能
  - 在简化界面中恢复导出数据按钮
  - 恢复批量管理功能
  - 显示所有练习记录而不是仅10条
  - 保持界面简洁但功能完整
  - 修改文件：improved-working-system.html, js/app.js
  - _需求: 功能完整性和用户需求_

- [x] 23. 修复正确答案获取问题


  - 实现CorrectAnswerExtractor类按照设计文档
  - 修复PracticePageEnhancer中的正确答案提取逻辑
  - 确保从DOM、全局对象和结果表格正确提取答案
  - 验证答案标准化和传输功能
  - 修改文件：js/practice-page-enhancer.js, js/utils/correctAnswerExtractor.js
  - _需求: 5.1, 5.2, 5.4_

- [x] 24. 修复用户答案获取不完全问题





  - 增强PracticeDataCollector的答案收集功能
  - 实现全面的答案监听机制
  - 修复答案收集遗漏问题
  - 确保所有用户输入都被正确记录
  - 修改文件：js/practice-page-enhancer.js
  - _需求: 数据收集完整性_

- [x] 25. 修复导出数据按钮卡死问题


  - 实现AsyncExportHandler类按照设计文档
  - 修复MarkdownExporter中的阻塞问题
  - 添加真正的异步处理和进度指示
  - 优化大数据量导出性能
  - 修改文件：js/utils/markdownExporter.js, js/utils/asyncExportHandler.js
  - _需求: 1.1, 1.2, 1.3, 1.4_

- [x] 26. 删除设置页面中的测试按钮


  - 移除性能报告、完整功能验证等测试按钮
  - 清理相关的测试组件和函数
  - 简化设置页面界面
  - 保留必要的系统设置功能
  - 修改文件：improved-working-system.html, js/app.js
  - _需求: 界面清理和简化_

- [x] 27. 诊断并修复正确答案提取失败问题



  - 分析CorrectAnswerExtractor所有策略失败的根本原因
  - 检查练习页面的实际HTML结构，确定正确答案的存储位置
  - 修复extractFromResultsTable函数，适配实际的表格结构
  - 增强DOM查找策略，支持更多的答案存储格式
  - 确保正确答案能够成功提取并传输到主系统
  - 修改文件：js/utils/correctAnswerExtractor.js, js/practice-page-enhancer.js
  - _需求: 5.1, 5.2, 5.3, 2.1, 2.2_

- [x] 28. 验证修复效果并优化用户体验


  - 测试正确答案提取功能是否正常工作
  - 验证练习记录弹窗中正确答案显示是否正确
  - 确认练习历史界面文本颜色在深色主题下可读性
  - 测试完整的练习流程从开始到数据导出
  - 优化错误处理和用户反馈机制
  - 修改文件：所有相关文件的最终验证
  - _需求: 系统稳定性和用户体验优化_

- [x] 29. 修复练习页面脚本加载404错误


  - 分析练习页面中practice-page-enhancer.js加载失败的原因
  - 检查练习页面HTML中的脚本路径是否正确
  - 修复相对路径问题，确保脚本能正确加载
  - 验证内联增强器是否能正常工作作为备用方案
  - 修改文件：练习页面HTML文件中的脚本引用路径
  - _需求: 脚本加载稳定性_

- [x] 30. 修复正确答案提取和传输问题


  - 分析为什么内嵌的CorrectAnswerExtractor未能提取正确答案
  - 检查练习页面中correctAnswers对象的实际结构和位置
  - 修复答案提取逻辑，确保能从脚本中正确解析答案
  - 验证answerComparison数据生成和传输到主系统
  - 确保练习记录显示正确答案而不是N/A
  - 修改文件：js/practice-page-enhancer.js, 练习页面HTML
  - _需求: 5.1, 5.2, 5.3, 2.1, 2.2_

- [x] 31. 修复练习历史界面标题可读性问题


  - 检查练习历史界面中深蓝色标题的CSS样式
  - 更新标题颜色使用CSS变量，适配深色和浅色主题
  - 确保所有文本在不同主题下都有良好的对比度和可读性
  - 测试主题切换时的视觉效果
  - 修改文件：improved-working-system.html中的CSS样式
  - _需求: 用户界面可读性优化_

- [x] 32. 最终验证和测试所有修复


  - 验证练习页面脚本路径修复后能正确加载
  - 测试内联增强器的正确答案提取功能
  - 确认练习记录弹窗显示正确答案而不是N/A
  - 验证练习历史界面标题在深色主题下的可读性
  - 测试完整的练习流程：开始练习 → 答题 → 提交 → 查看记录
  - 确保所有CSS变量正确应用，支持主题切换
  - 修改文件：最终系统验证
  - _需求: 系统完整性验证_

- [x] 33. 修复 `practice-page-enhancer.js` 404 Not Found Error
  - 纠正所有练习HTML文件中错误的脚本路径
  - 使用工具进行批量替换，确保所有文件都被修复
  - _需求: 脚本加载稳定性_

- [x] 34. 确保数据收集的准确性
  - 验证脚本加载后，用户答案和正确答案能被完整、准确地提取和传输
  - 检查 `CorrectAnswerExtractor` 逻辑
  - _需求: 数据完整性_

- [x] 35. 优化UI可读性
  - 修改练习历史界面的CSS，确保标题文本在所有主题下都清晰可读
  - _需求: 用户界面优化_

- [x] 36. 端到端验证
  - 在修复后，执行完整的测试流程
  - 验证从练习、提交到记录查看的整个过程
  - _需求: 系统完整性验证_

- [x] 37. 强化内联增强器
  - 修复内联增强器中的答案提取逻辑，将脆弱的 `JSON.parse` 方法替换为更可靠的JavaScript对象评估方式 (`new Function()`)，以防止在主脚本加载失败时出现解析错误。
  - _需求: 系统备用方案可靠性_

- [x] 38. 修复填空题答案收集不完整问题
  - 检查并修复 `practice-page-enhancer.js` 中的答案收集逻辑，确保能正确捕获所有问题类型（特别是文本填空题）的用户输入。
  - _需求: 数据收集完整性_

- [x] 39. 创建批量修复脚本
  - 开发一个Node.js脚本 (`tools/batch-fix-paths.js`)，用于递归查找所有HTML练习文件并应用必要的修复：更新 `practice-page-enhancer.s` 的脚本 `src` 为绝对路径，并将有问题的内联解析器替换为更可靠的版本。
  - _需求: 自动化修复_

- [x] 40. 调试填空题答案收集
  - 在 `practice-page-enhancer.js` 的 `collectAllAnswers` 函数中添加详细日志，以追踪文本输入框的 `questionId` 和 `value` 的捕获情况，诊断数据未能保存的原因。
  - _需求: 问题诊断_

- [x] 41. 修正增强器脚本的相对路径
  - 重新计算并应用正确的相对路径 (`../../../../../js/practice-page-enhancer.js`) 到 `40. P2...` HTML文件的脚本标签中。解决脚本加载失败这一根本问题。
  - _需求: 脚本加载稳定性_

- [x] 42. 直接嵌入增强器脚本
  - 作为最终诊断手段，将 `practice-page-enhancer.js` 的全部内容直接嵌入到 `40. P2...` HTML文件中，以完全消除路径问题，确保脚本执行。
  - _需求: 根本原因诊断_

- [ ] 43. 创建并部署最终批量脚本
  - 基于已确认的嵌入式修复方案，创建最终的Node.js脚本 (`tools/batch-embed-enhancer.js`)，该脚本读取 `js/practice-page-enhancer.js` 的内容，并将其替换掉所有练习HTML文件中的旧脚本加载块。
  - _需求: 自动化部署_

- [x] 44. Optimize `improved-working-system.html` by removing redundant scripts.
  - **Reason:** `practice-page-enhancer.js` and `correctAnswerExtractor.js` are designed for individual practice pages and cause unnecessary resource consumption and console errors on the main system page.
  - **Action:** Remove the `<script>` tags for `js/practice-page-enhancer.js` and `js/utils/correctAnswerExtractor.js` from `improved-working-system.html`.

- [x] 45. Delete redundant `correctAnswerExtractor.js` script file.
  - **Reason:** The file is obsolete as its functionality is now included in `practice-page-enhancer.js` and it is not used by any other script.
  - **Action:** Deleted `js/utils/correctAnswerExtractor.js`.

- [ ] 46. Synchronize master `practice-page-enhancer.js` with embedded version.
  - **Reason:** Ensure the master script, used by the batch embedding tool, is as up-to-date as the scripts already deployed in the HTML files.
  - **Action:** Compare the master script with an embedded version and update the master if necessary.

- [x] 47. Delete non-functional `ExamScanner.js` component.
  - **Reason:** The component relies on Node.js filesystem access and cannot work in a browser environment.
  - **Action:** Deleted `js/components/ExamScanner.js`.

- [x] 48. Implement client-side dynamic library reloading.
  - **Reason:** To allow users to update the exam index dynamically without a server or command-line tools.
  - **Action:** Modify the "Reload Library" button to use a folder picker input (`<input type="file" webkitdirectory>`). Implement a JavaScript function to parse the selected folder structure, generate a new `examIndex` in memory, save it to `localStorage`, and refresh the application views.

- [x] 49. Fix component loading timeout error.
  - **Reason:** The application was waiting for deleted/obsolete components (`PracticeHistory`, `ExamScanner`), causing a timeout error on startup.
  - **Action:** Removed references to the obsolete components from the component loading list in `js/app.js`.

- [x] 50. Fix component health check false positives.
  - **Reason:** The health check function was still checking for obsolete components (`PracticeHistory`, `PracticePageEnhancer`), causing misleading warnings in the console.
  - **Action:** Removed the obsolete components from the `criticalComponents` list in the `performComponentHealthCheck` function in `improved-working-system.html`.

- [x] 51. 重构题库加载并实现配置切换
    - **原因:** 当前的题库重载机制会覆盖主索引，导致页面访问中断。此任务旨在创建一个能管理多个题库配置的健壮系统。
    - **操作:**
        1.  修改 `improved-working-system.html` 中的“Reload Library”按钮：
            -   重命名为“加载题库”。
            -   更新其 Emoji。
        2.  在“加载题库”按钮旁添加一个新按钮“题库配置切换”。
        3.  实现“加载题库”功能：
            -   选择文件夹后，生成一个新的静态索引文件（例如，以时间戳或文件夹名称命名）。
            -   将新索引的配置信息（如名称和 `localStorage` 中的键）存储在 `localStorage` 的一个列表（`examIndexConfigurations`）中。
        4.  实现“题库配置切换”功能：
            -   创建一个UI（弹窗或下拉菜单），仿照备份列表的样式，显示所有可用的题库配置。
            -   允许用户选择一个配置。
            -   选择后，更新应用在 `localStorage` 中使用的当前 `examIndex` 的键。
            -   刷新应用视图以应用新的索引。
        5.  确保应用中所有打开的逻辑都使用 `localStorage` 中当前激活的 `examIndex`。

- [x] 52. 澄清文件夹选择说明
    - **原因:** 用户在加载新题库后打开考试或 PDF 时遇到“文件未找到”错误，这可能是由于选择了子文件夹而不是应用程序的根目录。
    - **操作:** 修改 `triggerFolderPicker()` 中的说明，明确引导用户选择应用程序的根目录（例如，`0.1 working 睡`）。

- [x] 53. 调试考试和 PDF 路径解析
    - **原因:** 尽管澄清了文件夹选择说明，但“文件未找到”错误仍然存在，这表明 `exam.path` 的构建或 `openExam` 和 `viewPDF` 解析它时存在问题。
    - **操作:**
        1.  在 `handleFolderSelection` 中添加控制台日志，以显示 `file.webkitRelativePath`、`rootDir` 以及存储在 `exam.path` 中的最终 `relativePath`。
        2.  在 `openExam` 和 `viewPDF` 中添加控制台日志，以显示用于打开文件的 `fullPath` 或 `pdfPath`。
        3.  根据日志，确定路径是否构建不正确，或者浏览器解析是否存在问题。
        4.  如果路径不正确，调整 `handleFolderPicker` 以构建相对于 `improved-working-system.html` 的正确路径。

- [x] 54. 解决题库加载与文件打开的核心问题 (系列修复)
    - **背景:** 经过多轮调试，发现加载新题库后文件无法打开，且默认配置列表显示不全，用户对加载全量文件有性能顾虑。
    - **最终诊断:**
        1.  **路径错误:** `handleFolderSelection` 函数在处理浏览器返回的 `webkitRelativePath` 时，未能正确移除用户所选的顶层文件夹名称，导致生成的路径多了一层，与可正常工作的默认配置路径格式不符。
        2.  **配置列表Bug:** `loadLibrary` 函数在从缓存加载题库时，没有将该题库信息重新注册到配置列表中，导致列表显示不全。
        3.  **用户体验问题:** 指示用户选择根目录时，程序会扫描上千个无关文件，导致加载缓慢，引起用户困惑和抵触。
    - **综合修复措施:**
        1.  **修正路径处理:** 重写 `handleFolderSelection` 函数，增加新逻辑：首先从文件列表中自动识别出公共的顶层目录名，然后在处理每个文件路径时，从此路径的头部强行“砍掉”这个顶层目录名，确保最终生成的相对路径正确无误。
        2.  **修复配置列表:** 在 `DOMContentLoaded` 事件中增加 `ensureDefaultConfigExists` 函数，强制在每次启动时检查并注册默认配置，确保其始终可见。
        3.  **优化加载性能与体验:** 修改 `handleFolderSelection` 函数，不再扫描所有文件，而是仅在 `睡着过项目组` 子目录中查找HTML文件。同时更新 `triggerFolderPicker` 中的提示信息，告知用户程序会进行智能扫描，打消其性能顾虑。
        4.  **清理与验证:** 移除了所有调试代码，并确认了默认配置和新加载的配置都能正常打开文件，至此所有相关问题都已解决。

- [ ] 55. 隔离 `Octal escape sequences` 错误
    - **原因:** `Octal escape sequences` 错误仍然存在，尽管尝试修复反斜杠转义，这表明存在更深层次的语法问题或另一个有问题的模板字面量。
    - **操作:**
        1.  简化了 `instructions` 字符串在 `triggerFolderPicker` 中以隔离问题。
        2.  **下一步:** 用户重新运行应用程序并报告控制台错误。
- [x] 56. 修复练习记录未保存问题
  - **原因:** 练习页面发送的 `PRACTICE_COMPLETE` 消息在主页面 `improved-working-system.html` 中被一个监听器接收，但处理函数 `handlePracticeDataReceived` 未定义，导致脚本错误，练习记录无法被保存。
  - **操作:**
    1. 在 `improved-working-system.html` 中定义 `handlePracticeDataReceived` 函数。
    2. 在函数中添加详细的诊断日志，以追踪记录的保存流程，包括接收到的数据、题库索引的匹配结果以及最终创建的记录对象。
    3. 根据诊断日志，修复数据不匹配或处理逻辑中的任何错误，确保练习记录能被正确创建并保存到 `localStorage`。
    4. 验证记录保存后，练习历史和题库浏览界面的状态（圆点颜色）能正确更新。