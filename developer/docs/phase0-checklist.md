# Phase 0 快速检查清单

## ✅ 已完成项

- [x] **全局变量/函数归属清单**
  - 📄 文档: `developer/docs/phase0-inventory.md`
  - 📊 统计: 140+ 函数，10 个全局变量，10 大功能模块
  - 🎯 归属: 导航(20+) | 浏览(45+) | 练习(35+) | 配置(25+) | 工具(15+)

- [x] **加载顺序与依赖关系图**
  - 📄 文档: `developer/docs/phase0-dependency-diagram.md`
  - 🗺️ 图表: 6 类可视化依赖图（Mermaid 格式）
  - 🔗 依赖: 同步加载(34) | 懒加载分组(4) | 懒加载脚本(33)

---

## ⏳ 待执行项

### 🧪 基线测试（必须完成）

**目标**: 记录当前系统基线行为，确保重构不引入回归

#### 方法1: 手动测试（推荐，5-10分钟）

```bash
# 1. 打开测试手册
open developer/docs/phase0-baseline-test-manual.md

# 2. 在浏览器中打开 index.html (file:// 协议)
open index.html

# 3. 按照手册步骤测试，记录结果

# 4. 保存控制台日志
# 浏览器控制台 → 右键 → Save as...
# 保存到: developer/logs/phase0-baseline-manual-YYYYMMDD.log
```

#### 方法2: 自动化测试（可选，需要 Selenium）

```bash
# 1. 安装依赖（如果未安装）
brew install chromedriver
pip install selenium

# 2. 运行测试脚本
python developer/tests/baseline/phase0_baseline_test.py

# 3. 查看测试结果
cat developer/logs/phase0-baseline-*.log
```

#### 测试检查点（7项）

- [ ] **测试1**: 页面加载与启动屏幕
  - 启动屏幕显示并在 2-5 秒内消失
  - 控制台无红色错误

- [ ] **测试2**: 总览视图
  - 分类卡片正确渲染（P1/P2/P3/P4）
  - `examIndexLoaded` 事件触发
  - `loadExamList()` 正常调用

- [ ] **测试3**: 题库浏览视图
  - 点击"题库浏览"后视图切换流畅
  - 题库列表渲染（147 个题目）
  - `browse-view` 组懒加载成功

- [ ] **测试4**: 练习记录视图
  - 点击"练习记录"后视图切换流畅
  - 统计卡片正确显示
  - `practice-suite` 组懒加载成功

- [ ] **测试5**: 更多工具视图
  - 点击"更多"后视图切换流畅
  - 工具卡片显示（时钟、词汇）
  - `more-tools` 组懒加载成功

- [ ] **测试6**: 懒加载状态检查
  - 在控制台执行: `window.AppLazyLoader.getStatus()`
  - 所有分组加载状态正常

- [ ] **测试7**: 控制台日志完整性
  - 包含必需日志关键词（见测试手册）
  - 无不可接受的错误（见测试手册）

#### 通过标准

✅ **全部通过** → 可以开始阶段1重构  
⚠️ **部分通过** → 修复已知问题后再开始  
❌ **失败** → 必须先修复所有错误

---

## 📋 下一步行动

### 如果基线测试通过 ✅

#### 1. 更新重构计划
```bash
# 编辑 developer/docs/mainjs-refactor-plan.md
# 勾选阶段0第3项: [x] 手动 file:// 打开首屏...
```

#### 2. 创建重构分支
```bash
git checkout -b refactor/main-js-phase1
```

#### 3. 备份 main.js
```bash
cp js/main.js js/main.js.backup
```

#### 4. 开始阶段1迁移
参考: `developer/docs/mainjs-refactor-plan.md` 阶段1清单

**阶段1任务**:
- [ ] 迁移 boot/ensure 类函数 → `main-entry.js`
- [ ] 迁移导航/视图切换链 → `navigation-controller.js`
- [ ] 迁移全局状态变量 → `state-service.js`

---

### 如果基线测试失败 ❌

#### 1. 记录错误
```bash
# 创建错误日志目录
mkdir -p developer/logs/phase0-errors

# 保存控制台日志
# 浏览器控制台 → 右键 → Save as...
# 保存到: developer/logs/phase0-errors/console-YYYYMMDD.log

# 截图保存
# 保存到: developer/logs/phase0-errors/screenshot-YYYYMMDD.png
```

#### 2. 分析并修复
- 查看错误类型（404 / ReferenceError / TypeError）
- 检查是否是环境配置问题
- 修复代码 bug

#### 3. 重新测试
```bash
# 清除浏览器缓存
# 在控制台执行:
# localStorage.clear(); sessionStorage.clear(); location.reload(true);

# 重新运行基线测试
```

#### 4. ⚠️ 不要开始重构
- 在基线测试通过前，不要开始阶段1重构
- 避免在不稳定的基础上进行大规模重构

---

## 📚 文档快速链接

| 文档 | 路径 | 用途 |
|------|------|------|
| 重构计划 | `developer/docs/mainjs-refactor-plan.md` | 总体规划 |
| 阶段0盘点 | `developer/docs/phase0-inventory.md` | 函数归属清单 |
| 依赖关系图 | `developer/docs/phase0-dependency-diagram.md` | 可视化依赖 |
| 测试手册 | `developer/docs/phase0-baseline-test-manual.md` | 手动测试步骤 |
| 完成总结 | `developer/docs/phase0-summary.md` | 阶段0总结 |
| **本清单** | `developer/docs/phase0-checklist.md` | 快速检查 |

---

## 🔍 关键数据

### main.js 规模
- **总行数**: 3370 行
- **总字节数**: 125,294 字节
- **函数总数**: 161 个
- **待迁移函数**: 140+ 个

### 依赖关系
- **同步加载脚本**: 34 个
- **懒加载分组**: 4 个
- **懒加载脚本**: 33 个
- **全局 API**: 12 个（必须保留兼容）

### 预估工作量
- **阶段1**: 2-3 天
- **阶段2**: 4-5 天
- **阶段3**: 3-4 天
- **阶段4**: 2-3 天
- **阶段5**: 2-3 天
- **总计**: 13-18 天

---

## ⚠️ 风险提示

### 必须遵守的约束
1. **懒加载顺序**: `state-service.js` → 控制器 → `main.js`
2. **全局 API 兼容**: 12 个 `window.*` API 必须保留转发
3. **HTML onclick 调用**: 10+ 处不可破坏

### 每个阶段完成后必须
1. file:// 手测无回归
2. 跑 CI 测试: `python developer/tests/ci/run_static_suite.py`
3. 跑 E2E 测试: `python developer/tests/e2e/suite_practice_flow.py`

---

## 📞 需要帮助？

如有问题，请:
1. 查看 `developer/docs/` 中的详细文档
2. 在 GitHub Issues 中提问
3. 联系开发团队

---

**更新时间**: 2025-11-28  
**维护者**: Antigravity AI  
**状态**: ⏳ 等待用户完成基线测试
