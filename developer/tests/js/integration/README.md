# 集成测试

本目录包含听力练习P1/P4集成功能的集成测试和性能基准测试。

## 测试文件

### 1. multiSuiteSubmission.test.js
测试多套题提交流程，包括：
- 单套题提交
- 多套题聚合
- 记录保存
- 拼写错误收集

### 2. spellingErrorCollection.test.js
测试拼写错误收集流程，包括：
- 错误检测
- 词表保存
- 词表同步
- 综合词表更新

### 3. vocabListSwitching.test.js
测试词表切换流程，包括：
- 词表加载
- UI更新
- 数据持久化
- 空词表处理

### 4. performance.benchmark.js
性能基准测试，包括：
- 不同数据量的保存性能（10/100/1000个单词）
- 词表加载性能（小/大词表）
- 拼写错误检测性能
- 多套题聚合性能
- 编辑距离计算性能
- 性能评分和评级

## 运行测试

### 单独运行

```bash
# 功能测试
node developer/tests/js/integration/multiSuiteSubmission.test.js
node developer/tests/js/integration/spellingErrorCollection.test.js
node developer/tests/js/integration/vocabListSwitching.test.js

# 性能测试
node developer/tests/js/integration/performance.benchmark.js
```

### 批量运行

```bash
# Windows - 运行所有集成测试和性能测试
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

### 性能测试输出

```json
{
  "status": "pass",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "benchmarks": [
    {
      "name": "保存10个单词",
      "iterations": 10,
      "avgMs": "15.23",
      "minMs": "12.45",
      "maxMs": "18.90",
      "totalMs": "152.30"
    }
  ],
  "summary": {
    "totalTests": 13,
    "performanceScore": 85,
    "rating": "良好"
  }
}
```

## 测试覆盖

### 功能测试
- ✅ 多套题提交流程（8个测试场景）
- ✅ 拼写错误收集流程（12个测试场景）
- ✅ 词表切换流程（12个测试场景）

总计：32个测试场景

### 性能测试
- ✅ 数据保存性能（3个场景）
- ✅ 数据加载性能（2个场景）
- ✅ 错误检测性能（2个场景）
- ✅ 算法性能（2个场景）
- ✅ 聚合性能（2个场景）
- ✅ 其他操作（2个场景）

总计：13个性能基准

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
5. 性能测试结果可能因系统负载而波动

## 相关文档

- 详细实现说明：`developer/docs/task-12-integration-tests-summary.md`
- E2E测试：`developer/tests/e2e/listening_practice_flow.py`
