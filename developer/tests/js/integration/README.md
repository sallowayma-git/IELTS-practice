# 集成测试

本目录包含词汇收集、词表切换和词汇会话视图的领域集成测试。

## 测试文件

### 1. spellingErrorCollection.test.js
测试拼写错误收集流程，包括：
- 错误检测
- 词表保存
- 词表同步
- 综合词表更新

### 2. vocabListSwitching.test.js
测试词表切换流程，包括：
- 词表加载
- UI更新
- 数据持久化
- 空词表处理

### 3. vocabSessionView.test.js
测试词汇会话视图流程，包括：
- 词表导入和切换
- 会话状态更新
- AppData 领域提交

## 运行测试

### 单独运行

```bash
# 功能测试
node developer/tests/js/integration/spellingErrorCollection.test.js
node developer/tests/js/integration/vocabListSwitching.test.js
node developer/tests/js/integration/vocabSessionView.test.js
```

### 批量运行

```bash
# Windows - 运行所有集成测试
developer\tests\run-integration-tests.bat

# 或通过CI脚本运行
python developer\tests\ci\run_static_suite.py
```

## 测试输出

### 功能测试输出

```json
{
  "status": "pass",
  "total": 8,
  "passed": 8,
  "failed": 0,
  "results": [...],
  "detail": "所有测试通过"
}
```

## 测试覆盖

### 功能测试
- 拼写错误收集流程
- 词表切换流程
- 词汇会话视图流程

## CI/CD集成

集成测试已添加到CI流程（`developer/tests/ci/run_static_suite.py`）：
- 自动运行所有集成测试
- 解析JSON输出
- 验证通过/失败状态
- 生成CI报告

## 注意事项

1. 测试使用Node.js运行，需要安装Node.js环境
2. 测试使用Mock环境，不依赖浏览器
3. 测试相互独立，可以单独运行
4. 测试失败会输出详细的错误信息

## 相关文档

- 详细实现说明：`developer/docs/task-12-integration-tests-summary.md`
- E2E测试：`developer/tests/e2e/listening_practice_flow.py`
