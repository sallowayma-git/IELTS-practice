# E2E测试快速运行指南

## 快速开始

### 1. 安装依赖（首次运行）

```bash
# 安装Playwright
py -m pip install playwright

# 安装浏览器驱动
py -m playwright install chromium
```

### 2. 运行测试

```bash
# 统一入口（推荐）：串行执行 browse偏好 + reading + suite
py developer/tests/e2e/e2e_runner.py

# 运行听力练习E2E测试（任务13）
py developer/tests/e2e/listening_practice_flow.py

# 运行套题练习E2E测试（现有）
py developer/tests/e2e/suite_practice_flow.py
```

### 3. 查看结果

测试完成后会输出：

```
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

截图保存在：`developer/tests/e2e/reports/`

## 测试内容

### listening_practice_flow.py（任务13）

测试100 P1/P4听力练习功能：

1. **完整练习流程**
   - 从总览进入Browse视图
   - 点击P1入口
   - 选择并打开题目
   - 提交答案
   - 查看练习记录
   - 打开记录详情

2. **单词背诵流程**
   - 进入单词背诵视图
   - 切换P1/P4/综合词表
   - 验证词表加载

3. **频率筛选流程**
   - 点击P1/P4入口
   - 验证筛选按钮显示
   - 应用高频筛选
   - 测试P4"全部"按钮

### suite_practice_flow.py（现有）

测试套题练习功能（现有功能）

## 调试模式

### 启用有头模式（看到浏览器）

编辑测试文件，修改：

```python
browser = await p.chromium.launch(headless=False)
```

### 慢速执行（看清每一步）

```python
browser = await p.chromium.launch(headless=False, slow_mo=1000)
```

### 增加等待时间

```python
await page.wait_for_timeout(5000)  # 等待5秒
```

## 常见问题

### Q: Playwright未安装

```bash
# 错误: No module named 'playwright'
# 解决:
py -m pip install playwright
py -m playwright install chromium
```

### Q: 测试超时

```bash
# 错误: TimeoutError: Timeout 10000ms exceeded
# 解决: 增加超时时间或检查应用是否正常运行
```

### Q: 元素未找到

```bash
# 错误: Error: locator.click: Target closed
# 解决: 检查DOM选择器是否正确，或UI是否有变化
```

### Q: 截图为空

```bash
# 原因: 元素未加载完成
# 解决: 增加wait_for_timeout或wait_for_selector
```

## 完整测试流程

按照AGENT.md中的要求，完整测试流程应该是：

```bash
# 1. 运行静态测试套件（包含单元测试和集成测试）
py developer/tests/ci/run_static_suite.py

# 2. 运行E2E测试
py developer/tests/e2e/e2e_runner.py
py developer/tests/e2e/listening_practice_flow.py
```

## 测试时间估算

- listening_practice_flow.py: ~40-60秒
- suite_practice_flow.py: ~30-45秒
- **总计**: ~70-105秒

## 相关文档

- 详细验证报告: `developer/docs/task-13-e2e-tests-verification.md`
- E2E测试README: `developer/tests/e2e/README_LISTENING_PRACTICE.md`
- 测试改进总结: `developer/docs/testing-improvements-summary.md`

## 注意事项

1. E2E测试需要完整的应用环境
2. 测试使用真实浏览器（Chromium）
3. 测试时间较长，请耐心等待
4. 截图文件会占用磁盘空间（约1-2MB）
5. 测试可能因网络或系统负载而不稳定

## 下一步

任务13已完成，可以继续：
- 任务14: 性能优化
- 任务15: 文档和代码审查
- 任务16-17: 部署和监控
