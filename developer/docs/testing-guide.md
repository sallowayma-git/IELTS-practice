# 测试运行快速指南

## 📋 测试概览

项目现在包含三类测试：

1. **Phase 0 基线测试** - 验证当前系统基线行为
2. **CI 静态测试** - 验证代码结构和静态分析
3. **E2E 测试** - 验证套题练习完整流程
4. **写作后端契约测试** - 验证 Phase 05-09 核心后端契约是否落地

---

## 🚀 快速开始

### 安装依赖

```bash
# 安装 Playwright（如果未安装）
pip install playwright
playwright install chromium

# 或使用 pip 安装所有依赖
pip install -r developer/tests/requirements.txt
```

---

## 🧪 运行测试

### 方法1: 运行所有测试（推荐）

```bash
# 运行所有测试并生成综合报告
python developer/tests/run_all_tests.py
```

### 方法2: 运行单个测试

```bash
# 仅运行基线测试
python developer/tests/run_all_tests.py --only-baseline

# 仅运行 CI 测试
python developer/tests/run_all_tests.py --only-ci

# 仅运行 E2E 测试
python developer/tests/run_all_tests.py --only-e2e
```

### 方法3: 跳过特定测试

```bash
# 跳过基线测试
python developer/tests/run_all_tests.py --skip-baseline

# 跳过 CI 测试
python developer/tests/run_all_tests.py --skip-ci

# 跳过 E2E 测试
python developer/tests/run_all_tests.py --skip-e2e
```

### 方法4: 直接运行单个测试脚本

```bash
# Phase 0 基线测试
python developer/tests/baseline/phase0_baseline_playwright.py

# CI 静态测试
python developer/tests/ci/run_static_suite.py

# E2E 套题练习流程测试
python developer/tests/e2e/suite_practice_flow.py

# 写作后端契约静态验证
python3 developer/tests/ci/writing_backend_contract.py
```

---

## 📊 测试报告

### 报告位置

所有测试报告保存在 `developer/tests/` 目录下：

```
developer/tests/
├── baseline/reports/          # 基线测试报告
│   └── phase0-baseline-*.json
├── e2e/reports/               # E2E 测试报告
│   ├── suite-practice-flow-report.json
│   ├── suite-practice-record-list.png
│   ├── suite-practice-record-detail.png
│   ├── static-ci-report.json
│   └── writing-backend-contract-report.json
└── reports/                   # 综合测试报告
    └── test-summary-*.json
```

### 查看报告

```bash
# 查看最新的综合测试报告
cat developer/tests/reports/test-summary-*.json | jq .

# 查看基线测试报告
cat developer/tests/baseline/reports/phase0-baseline-*.json | jq .

# 查看 E2E 测试报告
cat developer/tests/e2e/reports/suite-practice-flow-report.json | jq .

# 查看 CI 测试报告
cat developer/tests/e2e/reports/static-ci-report.json | jq .
```

---

## 📝 测试日志

### 日志位置

```
developer/logs/
└── phase0-baseline-*.log      # 基线测试文本日志
```

### 查看日志

```bash
# 查看最新的基线测试日志
cat developer/logs/phase0-baseline-*.log

# 实时查看测试输出
python developer/tests/run_all_tests.py 2>&1 | tee test-output.log
```

---

## ✅ 测试通过标准

### Phase 0 基线测试

- ✅ 页面正常加载，无 404 错误
- ✅ 启动屏幕正常显示并消失
- ✅ 总览视图正常渲染（分类卡片显示）
- ✅ `examIndexLoaded` 事件触发
- ✅ `loadExamList()` 正常调用
- ✅ 题库列表正常渲染（147 个题目）
- ✅ 懒加载分组正常加载
- ✅ 无关键控制台错误

### CI 静态测试

- ✅ 所有必需文件存在
- ✅ HTML 文件包含 DOCTYPE
- ✅ E2E 测试配置正确
- ✅ 数据层文件完整
- ✅ main.js 函数定义正确
- ✅ 单元测试通过
- ✅ 集成测试通过

### E2E 测试

- ✅ 套题练习窗口正常打开
- ✅ 完成 3 篇练习
- ✅ 练习记录正确保存
- ✅ 练习记录列表正常显示
- ✅ 练习记录详情正常打开
- ✅ 截图成功保存

---

## 🐛 故障排除

### 问题1: Playwright 未安装

```bash
# 错误信息
ModuleNotFoundError: No module named 'playwright'

# 解决方案
pip install playwright
playwright install chromium
```

### 问题2: ChromeDriver 未找到

```bash
# 错误信息
WebDriverException: 'chromedriver' executable needs to be in PATH

# 解决方案（macOS）
brew install chromedriver

# 解决方案（Linux）
sudo apt-get install chromium-chromedriver
```

### 问题3: 测试超时

```bash
# 错误信息
TimeoutError: Timeout 60000ms exceeded

# 解决方案
# 1. 检查网络连接
# 2. 增加超时时间（修改测试脚本中的 timeout 参数）
# 3. 检查系统资源（CPU/内存）
```

### 问题4: 文件权限错误

```bash
# 错误信息
PermissionError: [Errno 13] Permission denied

# 解决方案
chmod +x developer/tests/**/*.py
```

---

## 🔄 CI/CD 集成

### GitHub Actions 示例

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      
      - name: Install dependencies
        run: |
          pip install playwright
          playwright install chromium
      
      - name: Run all tests
        run: python developer/tests/run_all_tests.py
      
      - name: Upload test reports
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-reports
          path: developer/tests/**/reports/
```

---

## 📚 相关文档

- **重构计划**: `developer/docs/mainjs-refactor-plan.md`
- **阶段0盘点**: `developer/docs/phase0-inventory.md`
- **依赖关系图**: `developer/docs/phase0-dependency-diagram.md`
- **测试手册**: `developer/docs/phase0-baseline-test-manual.md`
- **快速检查清单**: `developer/docs/phase0-checklist.md`

---

## 💡 最佳实践

### 重构前

```bash
# 1. 运行所有测试确保基线通过
python developer/tests/run_all_tests.py

# 2. 保存测试报告作为基线
cp developer/tests/reports/test-summary-*.json baseline-before-refactor.json
```

### 重构后

```bash
# 1. 运行所有测试验证无回归
python developer/tests/run_all_tests.py

# 2. 对比测试报告
diff baseline-before-refactor.json developer/tests/reports/test-summary-*.json
```

### 每日开发

```bash
# 快速验证（跳过耗时的 E2E 测试）
python developer/tests/run_all_tests.py --skip-e2e

# 完整验证（提交前）
python developer/tests/run_all_tests.py
```

---

**更新时间**: 2025-11-28  
**维护者**: Antigravity AI  
**版本**: v1.0
