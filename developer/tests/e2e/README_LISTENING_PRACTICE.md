# 听力练习E2E测试

本文档描述听力练习P1/P4功能的端到端测试。

## 测试文件

### listening_practice_flow.py

完整的E2E测试套件，包含三个主要测试流程：

#### 1. 完整练习流程 (test_complete_practice_flow)
测试从浏览题目到查看记录的完整流程：
- 从总览进入Browse视图
- 点击P1入口
- 验证频率筛选按钮显示
- 选择并打开100 P1题目
- 在练习页面提交答案
- 返回查看练习记录
- 打开记录详情
- 验证套题详情展示

**截图输出**：
- `listening-practice-record-list.png` - 练习记录列表
- `listening-practice-record-detail.png` - 记录详情弹窗

#### 2. 单词背诵流程 (test_vocab_practice_flow)
测试词表切换和单词背诵功能：
- 进入单词背诵视图
- 验证词表切换器显示
- 切换到P1词表
- 切换到P4词表
- 切换到综合词表
- 验证词表加载和显示

**截图输出**：
- `vocab-list-p1.png` - P1词表
- `vocab-list-p4.png` - P4词表
- `vocab-list-master.png` - 综合词表

#### 3. 频率筛选流程 (test_frequency_filter_flow)
测试频率筛选功能：
- 进入Browse视图
- 点击P1入口
- 验证频率筛选按钮显示
- 应用高频筛选
- 切换到P4
- 测试P4"全部"按钮

**截图输出**：
- `frequency-filter-default.png` - 默认状态
- `frequency-filter-high.png` - 高频筛选（如果有）
- `frequency-filter-p4-all.png` - P4全部（如果有）

## 运行测试

### 前置条件

1. 安装Python 3.7+
2. 安装Playwright：
   ```bash
   pip install playwright
   playwright install chromium
   ```

### 运行方式

```bash
# 运行听力练习E2E测试
python developer/tests/e2e/listening_practice_flow.py

# 或使用现有的套题练习测试
python developer/tests/e2e/suite_practice_flow.py
```

## 测试输出

### 控制台输出

```
Captured console messages:
[LOG] http://...index.html: [PracticeEnhancer] 初始化增强器
[LOG] http://...index.html: [SpellingErrorCollector] 初始化拼写错误收集器
...

============================================================
E2E测试完成
============================================================
✓ 完整练习流程: pass
✓ 单词背诵流程: pass
✓ 频率筛选流程: pass
============================================================
总计: 3 个测试
通过: 3 个
失败: 0 个
============================================================
```

### 截图文件

所有截图保存在 `developer/tests/e2e/reports/` 目录：
- 练习记录相关截图
- 词表切换相关截图
- 频率筛选相关截图

## 测试覆盖

### 用户交互
- ✅ 导航切换
- ✅ 按钮点击
- ✅ 下拉选择
- ✅ 弹窗操作

### 功能验证
- ✅ 页面加载
- ✅ 数据显示
- ✅ 状态更新
- ✅ 错误处理

### 视觉验证
- ✅ 截图对比
- ✅ 元素可见性
- ✅ 布局正确性

## 与其他测试的关系

```
测试金字塔：

    E2E测试 (Playwright)
    ├── listening_practice_flow.py (新增)
    └── suite_practice_flow.py (现有)
           ↑
    集成测试 (Node.js)
    ├── multiSuiteSubmission.test.js
    ├── spellingErrorCollection.test.js
    ├── vocabListSwitching.test.js
    └── performance.benchmark.js
           ↑
    单元测试 (Node.js)
    ├── answerSanitizer.test.js
    ├── suiteModeFlow.test.js
    ├── browseController.test.js
    └── spellingErrorCollector.test.js
```

## 调试技巧

### 1. 启用有头模式
修改 `listening_practice_flow.py`：
```python
browser = await p.chromium.launch(headless=False)
```

### 2. 增加等待时间
```python
await page.wait_for_timeout(5000)  # 等待5秒
```

### 3. 查看控制台日志
测试会自动收集并输出所有控制台消息

### 4. 截图调试
在任何步骤添加截图：
```python
await page.screenshot(path="debug.png")
```

## 注意事项

1. E2E测试需要完整的应用环境
2. 测试使用真实浏览器（Chromium）
3. 测试时间较长（每个测试约10-30秒）
4. 截图文件会占用磁盘空间
5. 测试可能因网络或系统负载而不稳定

## 未来改进

### 1. 增加测试场景
- 多套题连续提交
- 拼写错误实时收集
- 词表导入导出
- 数据备份恢复

### 2. 增强验证
- 数据一致性验证
- 性能指标收集
- 错误日志分析
- 视觉回归测试

### 3. 测试工具
- 添加测试报告生成
- 集成到CI/CD流程
- 支持多浏览器测试
- 添加测试数据管理

## 相关文档

- 集成测试文档：`developer/tests/js/integration/README.md`
- 任务12总结：`developer/docs/task-12-integration-tests-summary.md`
- CI配置：`developer/tests/ci/run_static_suite.py`
