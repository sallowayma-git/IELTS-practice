# Implementation Plan

## Phase 1: 基础集成 - 总览和浏览界面

- [x] 1. 添加总览界面听力练习入口卡片




  - 在 index.html 或相关视图文件中添加 100 P1 和 100 P4 卡片
  - 实现卡片点击事件处理，传递 filterMode 参数
  - 添加卡片统计信息显示（题目数量、完成进度）
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. 扩展题库浏览控制器支持频率筛选

- [x] 2.1 定义浏览模式配置数据结构


  - 在 js/app/ 中创建或扩展 browseController.js
  - 定义 BROWSE_MODES 配置对象（default、frequency-p1、frequency-p4）
  - 实现 folderMap 映射逻辑
  - _Requirements: 2.1, 2.2, 2.8_


- [x] 2.2 实现动态筛选按钮渲染
  - 实现 renderFilterButtons() 方法
  - 根据当前模式动态生成按钮（超高频/高频/中频）
  - 添加按钮激活状态样式
  - _Requirements: 2.1, 2.2, 2.7_


- [x] 2.3 实现频率筛选逻辑
  - 实现 filterByFolder() 方法
  - 根据 folderMap 筛选题目列表
  - 处理 P4 的"全部"按钮特殊逻辑（1-100编号文件夹）
  - _Requirements: 2.3, 2.4, 2.5, 2.6_

- [x] 2.4 添加模式切换和状态管理



  - 实现 setMode() 方法
  - 保存当前筛选模式到状态
  - 实现模式切换时的UI更新
  - _Requirements: 2.8_

## Phase 2: Practice Page Enhancer 多套题支持

- [x] 3. 扩展 practice-page-enhancer.js 支持多套题结构



- [x] 3.1 实现多套题检测逻辑


  - 添加 detectMultiSuiteStructure() 方法
  - 检测页面中的 [data-suite-id] 或 .suite-container 元素
  - 添加 extractSuiteId() 方法提取套题标识
  - _Requirements: 3.1, 3.5_

- [x] 3.2 增强答案收集支持套题分组


  - 修改 collectAllAnswers() 方法
  - 实现 collectSuiteAnswers(suiteContainer) 方法
  - 为每个答案添加套题标识前缀（如 "set1_q1"）
  - _Requirements: 3.2, 3.5_

- [x] 3.3 实现单套题提交拦截


  - 增强 interceptSubmit() 方法
  - 拦截每个套题的提交按钮点击事件
  - 实现 handleSuiteSubmit(suiteId) 方法
  - 阻止并发提交，确保逐套提交
  - _Requirements: 3.3, 3.4, 3.7_

- [x] 3.4 实现套题正确答案提取


  - 扩展 extractCorrectAnswers() 方法支持多套题
  - 实现 extractSuiteCorrectAnswers(suiteId) 方法
  - 支持多套题的答案结构解析
  - _Requirements: 3.6_

- [x] 3.5 标准化消息格式


  - 修改 buildResultsPayload() 方法
  - 添加 suiteId 字段到消息
  - 确保答案键使用 "套题ID::问题ID" 格式
  - 添加 spellingErrors 字段到消息
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_


## Phase 3: 拼写错误收集组件

- [x] 4. 创建 SpellingErrorCollector 组件



- [x] 4.1 创建组件文件和基础结构


  - 在 js/app/ 中创建 spellingErrorCollector.js
  - 定义 SpellingError 和 VocabularyList 数据结构
  - 实现构造函数和初始化逻辑
  - _Requirements: 5.4, 5.7_


- [x] 4.2 实现拼写错误检测逻辑

  - 实现 detectErrors(answerComparison, suiteId, examId) 方法
  - 实现 isSpellingError(comparison) 判断方法
  - 实现 isWord(text) 单词过滤方法（排除数字、短语）
  - _Requirements: 5.1, 5.2, 5.3, 5.6_


- [x] 4.3 实现拼写相似度检测

  - 实现 isSimilarSpelling(input, correct) 方法
  - 实现 levenshteinDistance(a, b) 编辑距离算法
  - 设置相似度阈值（80%）
  - 处理大小写不同的情况
  - _Requirements: 5.8_


- [x] 4.4 实现错误保存和词表管理


  - 实现 saveErrors(errors) 方法
  - 实现词表加载和合并逻辑
  - 处理重复单词（更新错误次数）
  - 实现 syncToMasterList(errors) 同步到综合词表
  - _Requirements: 5.4, 5.5, 5.7_
-

- [x] 5. 集成拼写错误收集到 practice-page-enhancer




  - 在 handleSuiteSubmit() 中调用错误检测
  - 将 spellingErrors 添加到 PRACTICE_COMPLETE 消息
  - 确保错误数据正确传递到父页面
  - _Requirements: 5.1, 5.2, 5.3, 9.6, 9.7_

## Phase 4: 套题模式记录展示

- [x] 6. 扩展 suitePracticeMixin.js 支持多套题记录



- [x] 6.1 实现多套题会话管理


  - 添加 multiSuiteSessionsMap 存储多套题会话
  - 实现 getOrCreateMultiSuiteSession(examId) 方法
  - 实现 isMultiSuiteComplete(session) 检查方法
  - _Requirements: 4.1, 4.2_

- [x] 6.2 实现多套题完成处理


  - 实现 handleMultiSuitePracticeComplete(examId, suiteData) 方法
  - 收集每套题的结果到会话
  - 判断是否所有套题都已完成
  - _Requirements: 4.1, 4.2, 4.7_

- [x] 6.3 实现多套题记录聚合


  - 实现 finalizeMultiSuiteRecord(session) 方法
  - 实现 aggregateScores(suiteResults) 汇总分数
  - 实现 aggregateAnswers(suiteResults) 汇总答案
  - 实现 aggregateSpellingErrors(suiteResults) 汇总拼写错误
  - _Requirements: 4.3, 4.4, 4.5_

- [x] 6.4 实现记录保存和清理


  - 保存聚合记录到 practice_records
  - 保存拼写错误到词表
  - 清理会话数据
  - _Requirements: 4.3, 4.7, 10.1, 10.2_

- [x] 6.5 实现套题详情展示


  - 扩展练习记录详情视图
  - 显示每套题的独立得分
  - 显示与当前套题模式一致的详情界面
  - _Requirements: 4.2, 4.6_

## Phase 5: 单词背诵功能集成

- [x] 7. 扩展 VocabStore 支持多词表



- [x] 7.1 定义词表元数据结构


  - 定义 VOCAB_LISTS 配置对象
  - 包含 P1、P4、综合、自定义词表
  - 定义存储键映射
  - _Requirements: 6.1, 6.2, 7.3_

- [x] 7.2 实现词表加载和切换


  - 实现 loadList(listId) 方法
  - 实现 setActiveList(list) 方法
  - 实现 getListWordCount(listId) 方法
  - _Requirements: 6.1, 6.2, 7.4_

- [x] 7.3 集成拼写错误词表到背诵系统


  - 加载错误单词词表
  - 显示待学习单词数量
  - 按照 Leitner 分箱算法呈现单词
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 7.4 增强单词显示信息


  - 显示单词、用户的错误拼写、题目来源
  - 实现"记住"/"忘记"标记功能
  - 实现复习箱移动逻辑
  - 遵循艾宾浩斯遗忘曲线规律
  - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 8. 创建 VocabListSwitcher 组件



- [x] 8.1 实现词表切换器UI


  - 创建 js/app/vocabListSwitcher.js
  - 实现 render(container) 方法
  - 渲染切换按钮和下拉菜单
  - _Requirements: 7.1, 7.2_

- [x] 8.2 实现词表选项渲染


  - 实现 renderListOptions() 方法
  - 显示词表图标、名称、单词数量
  - 标注当前激活的词表
  - _Requirements: 7.3, 7.6_

- [x] 8.3 实现词表切换逻辑


  - 实现 switchList(listId) 方法
  - 加载新词表数据
  - 更新 UI 显示
  - 保存用户偏好
  - _Requirements: 7.4, 7.7_

- [x] 8.4 实现错误处理和空状态


  - 处理词表加载失败
  - 显示空词表提示
  - 实现回退到上一个词表
  - _Requirements: 7.5, 7.8_

- [x] 8.5 实现词表计数更新


  - 实现 updateListCounts() 方法
  - 定期更新每个词表的单词数量
  - 在切换后刷新计数
  - _Requirements: 7.6_


## Phase 6: 题目资源HTML逻辑修正

- [x] 9. 修正题目资源HTML提交逻辑






- [x] 9.1 审查现有HTML文件提交结构


  - 检查 ListeningPractice/100 P1 和 100 P4 文件夹中的HTML文件
  - 识别提交按钮和提交函数
  - 确认是否存在并发提交问题
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 9.2 修改提交按钮结构


  - 为每套题创建独立的提交按钮
  - 添加 data-submit-suite 属性标识套题
  - 移除或禁用全局提交按钮
  - _Requirements: 8.1, 8.7_


- [x] 9.3 修改提交函数逻辑

  - 修改 gradeAnswers() 或类似函数
  - 传递当前套题的标识符
  - 确保仅提交当前套题的答案
  - _Requirements: 8.2, 8.3_


- [x] 9.4 实现提交状态管理

  - 提交后禁用该套题的提交按钮
  - 防止重复提交同一套题
  - 所有套题提交完成后显示总体成绩
  - _Requirements: 8.4, 8.5, 8.6_

## Phase 7: 数据持久化和同步

- [x] 10. 实现数据持久化层





- [x] 10.1 扩展 storage.js 支持词表存储


  - 添加词表专用存储键
  - 实现词表数据的保存和加载
  - 实现数据验证和清理
  - _Requirements: 10.1, 10.2, 10.3_



- [x] 10.2 实现数据同步逻辑
  - 实现跨会话数据同步
  - 处理数据冲突（使用最新时间戳）
  - 确保页面关闭前数据已持久化
  - _Requirements: 10.4, 10.6_


- [x] 10.3 实现降级存储方案

  - 检测 IndexedDB 可用性
  - 实现 localStorage 降级逻辑
  - 处理存储空间不足情况
  - _Requirements: 10.5, 10.8_


- [x] 10.4 实现数据导出功能

  - 实现练习记录导出
  - 实现词表数据导出
  - 支持 JSON 格式导出
  - _Requirements: 10.7_

## Phase 8: 测试和优化

- [x] 11. 编写单元测试




- [x] 11.1 测试 SpellingErrorCollector


  - 测试拼写错误检测逻辑
  - 测试编辑距离计算
  - 测试单词过滤规则
  - 测试词表保存和合并

- [x] 11.2 测试 VocabListSwitcher


  - 测试词表切换逻辑
  - 测试词表计数更新
  - 测试用户偏好保存
  - 测试错误处理

- [x] 11.3 测试 BrowseController


  - 测试频率筛选逻辑
  - 测试按钮渲染
  - 测试模式切换
  - 测试 P4 "全部"按钮特殊逻辑

- [x] 12. 编写集成测试



- [x] 12.1 测试多套题提交流程


  - 测试单套题提交
  - 测试多套题聚合
  - 测试记录保存
  - 测试拼写错误收集


- [x] 12.2 测试拼写错误收集流程

  - 测试错误检测
  - 测试词表保存
  - 测试词表同步
  - 测试综合词表更新

- [x] 12.3 测试词表切换流程
  - 测试词表加载
  - 测试 UI 更新
  - 测试数据持久化
  - 测试空词表处理

- [x] 13. 编写 E2E 测试




- [x] 13.1 测试完整练习流程


  - 从总览进入 100 P1/P4
  - 选择题目并答题
  - 提交答案
  - 查看练习记录
  - 验证套题详情展示


- [x] 13.2 测试单词背诵流程

  - 答题出错触发错误收集
  - 打开单词背诵功能
  - 切换词表
  - 背诵单词并标记
  - 验证复习箱移动



- [ ] 13.3 测试频率筛选流程
  - 点击 P1/P4 入口
  - 验证筛选按钮显示
  - 应用不同频率筛选
  - 验证题目列表更新
  - 测试 P4 "全部"按钮

- [x] 14. 性能优化



- [x] 14.1 优化数据加载

  - 实现懒加载策略
  - 缓存频繁访问的数据
  - 优化词表查询性能


- [x] 14.2 优化 DOM 操作

  - 使用文档片段批量插入
  - 减少重排和重绘
  - 优化事件监听器


- [x] 14.3 优化存储性能

  - 定期清理过期数据
  - 压缩大型数据结构
  - 使用索引加速查询

- [x] 14.4 优化内存管理

  - 及时清理会话数据
  - 限制词表大小
  - 监控内存使用

- [ ] 15. 文档和代码审查
- [ ] 15.1 更新技术文档
  - 更新 README 说明新功能
  - 添加 API 文档
  - 更新架构图

- [ ] 15.2 代码审查和重构
  - 审查代码质量
  - 重构重复代码
  - 优化命名和注释

- [ ] 15.3 运行 CI/CD 测试
  - 运行 `python developer/tests/ci/run_static_suite.py`
  - 运行 `python developer/tests/e2e/suite_practice_flow.py`
  - 修复所有失败的测试

- [ ] 15.4 补齐 PRACTICE_COMPLETE/SpellingError 协议与词表存储字段
  - 在 requirements/design 中新增并锁定 schema：`examId`/`suiteId`/`answers` 前缀格式、`scoreInfo` 四元组、`answerComparison`、`spellingErrors` 含 `wordType`/`questionId` 前缀
  - 在 storage 层补充 store 名称、主键、时间戳字段与降级键名描述
  - 更新任务清单对应子项为“已落实”或回退为未完成

- [ ] 15.5 定义并验证持久化冲突/降级策略
  - 写明 IndexedDB 首选、localStorage 降级的判定与回退顺序
  - 指定冲突合并规则（按时间戳覆盖）并补充单元/集成用例
  - 生成一次验证报告路径并记录在此任务说明

- [ ] 15.6 频率筛选健壮性与 E2E 补测
  - 去除硬编码文件夹名/数量，改为配置驱动并处理“未加载/不存在/为空”状态 UI
  - 补完 13.3 频率筛选流程 E2E，包含 P4 “全部”按钮、异常状态回退
  - 在任务中登记测试证据（报告或截图路径）

- [ ] 15.7 “已完成”任务佐证登记
  - 为已勾选的存储/同步/测试任务补充证据列（commit/报告路径）；无证据者改回未完成
  - 标注责任人和截止时间，避免悬空

## Phase 9: 部署和监控

- [ ] 16. 部署准备
- [ ] 16.1 验证所有功能
  - 手动测试所有新功能
  - 验证与现有功能的兼容性
  - 确认无破坏性变更

- [ ] 16.2 准备发布说明
  - 编写功能说明
  - 列出已知问题
  - 提供使用指南

- [ ] 16.3 备份和回滚计划
  - 备份现有数据
  - 准备回滚脚本
  - 测试回滚流程

- [ ] 17. 监控和维护
- [ ] 17.1 设置错误监控
  - 添加错误日志记录
  - 监控关键指标
  - 设置告警机制

- [ ] 17.2 收集用户反馈
  - 收集使用数据
  - 分析用户行为
  - 识别改进点

- [ ] 17.3 持续优化
  - 根据反馈优化功能
  - 修复发现的 bug
  - 改进用户体验
