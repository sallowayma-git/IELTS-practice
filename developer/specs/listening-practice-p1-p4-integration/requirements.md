# Requirements Document

## Introduction

本需求文档定义了将新的听力练习资源（100 P1 和 100 P4）集成到现有IELTS练习管理平台的功能需求。这些新资源采用了更新的页面架构，包含多套题目的HTML文件，并具有频率分类（超高频、高频、中频）。此外，系统需要新增单词错误收集和背诵功能，帮助用户针对性地学习在听力填空题中拼写错误的单词。

## Requirements

### Requirement 1: 总览界面新增听力练习入口

**User Story:** 作为一名IELTS学习者，我希望在总览界面看到新的听力练习入口（100 P1 和 100 P4），以便快速访问这些新增的练习资源。

#### Acceptance Criteria

1. WHEN 用户访问总览页面 THEN 系统 SHALL 在听力部分显示两个新的卡片入口："100 P1"和"100 P4"
2. WHEN 用户点击"100 P1"卡片 THEN 系统 SHALL 跳转到题库浏览界面，并自动应用P1频率筛选模式
3. WHEN 用户点击"100 P4"卡片 THEN 系统 SHALL 跳转到题库浏览界面，并自动应用P4频率筛选模式
4. WHEN 卡片显示时 THEN 系统 SHALL 显示该类别的题目数量统计
5. IF 题库数据未加载完成 THEN 系统 SHALL 显示加载状态指示器

### Requirement 2: 题库浏览界面频率筛选适配

**User Story:** 作为一名IELTS学习者，当我从100 P1或100 P4入口进入题库浏览界面时，我希望看到与该资源对应的频率筛选按钮（超高频、高频、中频），以便按照题目频率进行筛选练习。

#### Acceptance Criteria

1. WHEN 用户从"100 P1"入口进入题库浏览界面 THEN 系统 SHALL 将右上角的筛选按钮替换为："超高频"、"高频"、"中频"
2. WHEN 用户从"100 P4"入口进入题库浏览界面 THEN 系统 SHALL 将右上角的筛选按钮替换为："全部"、"超高频"、"高频"、"中频"
3. WHEN 用户点击"超高频"按钮 THEN 系统 SHALL 仅显示对应频率文件夹内的题目
4. WHEN 用户点击"高频"按钮 THEN 系统 SHALL 仅显示对应频率文件夹内的题目
5. WHEN 用户点击"中频"按钮 THEN 系统 SHALL 仅显示对应频率文件夹内的题目
6. WHEN 用户在100 P4模式下点击"全部"按钮 THEN 系统 SHALL 显示1-100编号文件夹内不在频率分类中的题目
7. WHEN 筛选按钮状态改变 THEN 系统 SHALL 高亮显示当前激活的筛选按钮
8. WHEN 用户从其他入口进入题库浏览界面 THEN 系统 SHALL 保持原有的"全部"、"阅读"、"听力"筛选按钮

### Requirement 3: Practice Page Enhancer适配多套题结构

**User Story:** 作为系统开发者，我需要增强practice-page-enhancer.js组件以支持新的多套题HTML结构，确保用户答题数据能够正确收集并传输回父页面。

#### Acceptance Criteria

1. WHEN 用户在包含多套题的HTML页面答题 THEN 系统 SHALL 正确识别每套题的题目ID和答案
2. WHEN 用户提交单套题答案 THEN 系统 SHALL 仅收集并发送该套题的答案数据
3. WHEN 页面包含多个提交按钮 THEN 系统 SHALL 正确拦截每个提交按钮的点击事件
4. WHEN 用户完成一套题 THEN 系统 SHALL 发送包含套题序号的PRACTICE_COMPLETE消息
5. WHEN 系统收集答案时 THEN 系统 SHALL 为每个答案添加套题标识前缀（如"set1_q1"）
6. WHEN 系统提取正确答案时 THEN 系统 SHALL 支持多套题的答案结构解析
7. IF 页面存在10套题并发提交的情况 THEN 系统 SHALL 阻止并发提交，确保逐套提交

### Requirement 4: 套题模式记录展示适配

**User Story:** 作为一名IELTS学习者，当我完成100 P1或100 P4的练习后，我希望在练习记录页面看到详细的套题记录，包括每套题的得分和答题详情。

#### Acceptance Criteria

1. WHEN 用户完成多套题练习 THEN 系统 SHALL 在练习记录中创建一条聚合记录
2. WHEN 用户查看聚合记录详情 THEN 系统 SHALL 显示每套题的独立得分和答题情况
3. WHEN 系统保存练习记录 THEN 系统 SHALL 包含suiteEntries数组，存储每套题的详细数据
4. WHEN 系统计算总分 THEN 系统 SHALL 汇总所有套题的正确题数和总题数
5. WHEN 系统显示记录标题 THEN 系统 SHALL 包含练习日期和套题数量信息
6. WHEN 用户展开套题详情 THEN 系统 SHALL 显示与当前套题模式一致的详情界面
7. IF 练习未完成所有套题 THEN 系统 SHALL 保存已完成套题的独立记录

### Requirement 5: 单词错误收集组件

**User Story:** 作为一名IELTS学习者，当我在P1或P4听力填空题中拼写错误时，我希望系统自动收集这些错误单词的正确拼写，以便后续进行针对性背诵。

#### Acceptance Criteria

1. WHEN 用户提交听力填空题答案 THEN 系统 SHALL 比对用户答案与正确答案
2. WHEN 检测到填空题答案错误 THEN 系统 SHALL 判断是否为单词拼写错误
3. WHEN 确认为单词拼写错误 THEN 系统 SHALL 提取正确单词并存储到词表
4. WHEN 存储单词时 THEN 系统 SHALL 记录单词、错误拼写、题目来源、错误时间
5. WHEN 同一单词多次拼写错误 THEN 系统 SHALL 更新错误次数和最后错误时间
6. WHEN 系统收集单词 THEN 系统 SHALL 过滤非单词类型的答案（如数字、短语）
7. WHEN 单词收集完成 THEN 系统 SHALL 将词表数据持久化到本地存储
8. IF 用户答案与正确答案仅大小写不同 THEN 系统 SHALL 仍然收集该单词

### Requirement 6: 单词背诵功能集成

**User Story:** 作为一名IELTS学习者，我希望在"更多工具"下的单词背诵功能中，能够背诵我在听力练习中拼写错误的单词，以提高我的单词拼写能力。

#### Acceptance Criteria

1. WHEN 用户打开单词背诵功能 THEN 系统 SHALL 加载错误单词词表
2. WHEN 词表中有新单词 THEN 系统 SHALL 在背诵界面显示待学习单词数量
3. WHEN 用户开始背诵 THEN 系统 SHALL 按照Leitner分箱算法呈现单词
4. WHEN 显示单词时 THEN 系统 SHALL 显示单词、用户的错误拼写、题目来源
5. WHEN 用户标记"记住"THEN 系统 SHALL 将单词移至下一个复习箱
6. WHEN 用户标记"忘记"THEN 系统 SHALL 将单词移回第一个复习箱
7. WHEN 单词达到最后一个复习箱 THEN 系统 SHALL 标记为已掌握
8. WHEN 系统计算复习时间 THEN 系统 SHALL 遵循艾宾浩斯遗忘曲线规律

### Requirement 7: 词表切换功能

**User Story:** 作为一名IELTS学习者，我希望在单词背诵界面右上角能够切换不同来源的词表（如P1错误词表、P4错误词表、自定义词表），以便灵活管理我的学习内容。

#### Acceptance Criteria

1. WHEN 用户进入单词背诵界面 THEN 系统 SHALL 在右上角显示词表切换菜单按钮
2. WHEN 用户点击词表切换按钮 THEN 系统 SHALL 显示可用词表列表
3. WHEN 词表列表显示时 THEN 系统 SHALL 包含："P1错误词表"、"P4错误词表"、"综合错误词表"、"自定义词表"
4. WHEN 用户选择某个词表 THEN 系统 SHALL 切换到该词表并重新加载单词数据
5. WHEN 词表为空 THEN 系统 SHALL 显示"暂无单词"提示
6. WHEN 系统显示词表选项 THEN 系统 SHALL 标注每个词表的单词数量
7. WHEN 用户切换词表 THEN 系统 SHALL 保存用户的词表选择偏好
8. IF 词表数据加载失败 THEN 系统 SHALL 显示错误提示并回退到上一个词表

### Requirement 8: 题目资源HTML逻辑修正

**User Story:** 作为系统开发者，我需要确保新题目资源HTML文件的提交逻辑正确，每套题独立提交而非10套题并发提交，以避免enhancer组件接收错误消息。

#### Acceptance Criteria

1. WHEN 页面加载时 THEN 系统 SHALL 为每套题创建独立的提交按钮
2. WHEN 用户点击某套题的提交按钮 THEN 系统 SHALL 仅提交该套题的答案
3. WHEN 提交函数执行时 THEN 系统 SHALL 传递当前套题的标识符
4. WHEN 一套题提交后 THEN 系统 SHALL 禁用该套题的提交按钮
5. WHEN 所有套题提交完成 THEN 系统 SHALL 显示总体成绩统计
6. IF 用户尝试重复提交同一套题 THEN 系统 SHALL 阻止重复提交
7. IF 页面存在全局提交按钮 THEN 系统 SHALL 移除或禁用该按钮

### Requirement 9: 消息格式标准化

**User Story:** 作为系统开发者，我需要确保子练习页面发送的消息格式与enhancer组件和父页面的期望格式一致，以保证数据传输的准确性。

#### Acceptance Criteria

1. WHEN 子页面发送PRACTICE_COMPLETE消息 THEN 消息 SHALL 包含examId、sessionId、answers、correctAnswers、scoreInfo字段
2. WHEN 消息包含多套题数据 THEN 消息 SHALL 在examId中包含套题标识
3. WHEN 消息包含答案数据 THEN 答案键 SHALL 使用"套题ID::问题ID"格式
4. WHEN 消息包含分数信息 THEN scoreInfo SHALL 包含correct、total、accuracy、percentage字段
5. WHEN 消息包含答案比较 THEN answerComparison SHALL 包含每个问题的userAnswer、correctAnswer、isCorrect
6. WHEN 系统发送单词错误数据 THEN 消息 SHALL 包含spellingErrors数组
7. WHEN spellingErrors数组存在 THEN 每个错误 SHALL 包含questionId、userAnswer、correctAnswer、wordType字段
8. IF 消息格式验证失败 THEN 系统 SHALL 记录错误日志并使用降级格式

### Requirement 10: 数据持久化和同步

**User Story:** 作为一名IELTS学习者，我希望我的练习记录和错误单词词表能够可靠地保存在本地，并在不同会话间保持同步。

#### Acceptance Criteria

1. WHEN 用户完成练习 THEN 系统 SHALL 将记录保存到IndexedDB
2. WHEN 系统收集错误单词 THEN 系统 SHALL 将词表保存到独立的存储键
3. WHEN 用户关闭页面 THEN 系统 SHALL 确保所有数据已持久化
4. WHEN 用户重新打开应用 THEN 系统 SHALL 加载最新的练习记录和词表数据
5. WHEN 数据保存失败 THEN 系统 SHALL 尝试使用localStorage作为降级方案
6. WHEN 系统检测到数据冲突 THEN 系统 SHALL 使用最新时间戳的数据
7. WHEN 用户导出数据 THEN 系统 SHALL 包含练习记录和词表数据
8. IF 存储空间不足 THEN 系统 SHALL 提示用户清理旧数据
