# Phase 0 基线测试手册（手动测试版）

## 测试目的
在开始 main.js 拆分前，记录当前系统的基线行为，确保后续重构不引入回归问题。

## 测试环境
- **协议**: file:// （本地文件协议）
- **浏览器**: Chrome/Safari/Firefox（推荐 Chrome）
- **清除缓存**: 测试前必须清除浏览器缓存和 localStorage

---

## 测试步骤

### 准备工作

1. **打开浏览器开发者工具**
   - Chrome: `Cmd + Option + I` (Mac) / `F12` (Windows)
   - 切换到 **Console** 标签页

2. **清除缓存和存储**
   ```javascript
   // 在控制台执行以下命令
   localStorage.clear();
   sessionStorage.clear();
   console.clear();
   ```

3. **刷新页面**
   - 硬刷新: `Cmd + Shift + R` (Mac) / `Ctrl + Shift + R` (Windows)

---

### 测试1: 页面加载与启动屏幕

#### 操作步骤
1. 在浏览器中打开 `index.html`（使用 file:// 协议）
2. 观察启动屏幕（Boot Screen）是否显示
3. 等待启动屏幕消失

#### 预期结果
✅ **正常行为**:
- 启动屏幕显示 "正在唤醒考试总览系统..."
- 进度条动画流畅
- 启动屏幕在 2-5 秒内消失
- 控制台无红色错误

❌ **异常行为**:
- 启动屏幕一直不消失（超过 10 秒）
- 控制台出现 `Uncaught ReferenceError`
- 控制台出现 `Failed to load script`

#### 记录内容
```
[ ] 启动屏幕是否显示: 是 / 否
[ ] 启动屏幕消失时间: _____ 秒
[ ] 控制台错误数量: _____
[ ] 控制台警告数量: _____
```

---

### 测试2: 总览视图（Overview View）

#### 操作步骤
1. 启动屏幕消失后，观察总览页面
2. 检查分类卡片是否正确渲染

#### 预期结果
✅ **正常行为**:
- 总览页面自动显示（默认视图）
- 分类卡片显示（P1/P2/P3/P4 阅读、P1/P3 听力）
- 统计数字正确显示
- 控制台日志包含:
  ```
  [examIndexLoaded] 题库索引加载完成
  [loadExamList] 开始加载题库列表
  ```

❌ **异常行为**:
- 总览页面空白
- 分类卡片未渲染
- 控制台出现 `Cannot read property 'xxx' of undefined`

#### 记录内容
```
[ ] 总览页面是否显示: 是 / 否
[ ] 分类卡片数量: _____
[ ] examIndexLoaded 事件是否触发: 是 / 否
[ ] loadExamList 是否调用: 是 / 否
```

---

### 测试3: 题库浏览视图（Browse View）

#### 操作步骤
1. 点击导航栏的 "📚 题库浏览" 按钮
2. 观察懒加载过程
3. 检查题库列表是否渲染

#### 预期结果
✅ **正常行为**:
- 视图切换流畅（无明显卡顿）
- 题库列表正确显示（147 个题目）
- 筛选按钮（全部/阅读/听力）可用
- 控制台日志包含:
  ```
  [LazyLoader] 加载分组: browse-view
  [displayExams] 渲染 147 个题目
  ```

❌ **异常行为**:
- 视图切换后页面空白
- 题库列表未渲染
- 控制台出现 `[LazyLoader] 组加载失败: browse-view`
- 控制台出现 `Uncaught TypeError`

#### 记录内容
```
[ ] 浏览视图是否显示: 是 / 否
[ ] 题库列表项数量: _____
[ ] browse-view 组是否加载成功: 是 / 否
[ ] 筛选按钮是否可用: 是 / 否
```

---

### 测试4: 练习记录视图（Practice View）

#### 操作步骤
1. 点击导航栏的 "📝 练习记录" 按钮
2. 观察懒加载过程
3. 检查练习记录视图是否显示

#### 预期结果
✅ **正常行为**:
- 视图切换流畅
- 练习记录视图显示（即使无记录也显示空状态）
- 统计卡片显示（已练习题目、平均正确率等）
- 控制台日志包含:
  ```
  [LazyLoader] 加载分组: practice-suite
  [syncPracticeRecords] 同步练习记录
  ```

❌ **异常行为**:
- 视图切换后页面空白
- 控制台出现 `[LazyLoader] 组加载失败: practice-suite`
- 统计卡片未渲染

#### 记录内容
```
[ ] 练习记录视图是否显示: 是 / 否
[ ] practice-suite 组是否加载成功: 是 / 否
[ ] 统计卡片是否渲染: 是 / 否
[ ] 练习记录数量: _____
```

---

### 测试5: 更多工具视图（More View）

#### 操作步骤
1. 点击导航栏的 "✨ 更多" 按钮
2. 观察懒加载过程
3. 检查工具卡片是否显示

#### 预期结果
✅ **正常行为**:
- 视图切换流畅
- 工具卡片显示（全屏时钟、单词背诵）
- 控制台日志包含:
  ```
  [LazyLoader] 加载分组: more-tools
  ```

❌ **异常行为**:
- 视图切换后页面空白
- 工具卡片未渲染
- 控制台出现懒加载错误

#### 记录内容
```
[ ] 更多工具视图是否显示: 是 / 否
[ ] more-tools 组是否加载成功: 是 / 否
[ ] 工具卡片数量: _____
```

---

### 测试6: 懒加载状态检查

#### 操作步骤
在控制台执行以下命令，检查懒加载器状态：

```javascript
// 检查懒加载器是否存在
console.log('AppLazyLoader:', window.AppLazyLoader);

// 获取所有分组状态
console.log('Lazy Loader Status:', window.AppLazyLoader.getStatus());

// 检查各分组加载状态
['exam-data', 'browse-view', 'practice-suite', 'more-tools', 'theme-tools'].forEach(group => {
    const status = window.AppLazyLoader.getStatus(group);
    console.log(`${group}:`, status.loaded ? '✅ 已加载' : '❌ 未加载', status.files);
});
```

#### 预期结果
✅ **正常行为**:
- `AppLazyLoader` 对象存在
- `exam-data` 组已加载（包含 2 个文件）
- `browse-view` 组已加载（包含 14 个文件）
- `practice-suite` 组已加载（包含 9 个文件）
- `more-tools` 组已加载（包含 8 个文件）

#### 记录内容
```
[ ] AppLazyLoader 是否存在: 是 / 否
[ ] exam-data 组状态: 已加载 / 未加载
[ ] browse-view 组状态: 已加载 / 未加载
[ ] practice-suite 组状态: 已加载 / 未加载
[ ] more-tools 组状态: 已加载 / 未加载
```

---

### 测试7: 控制台日志完整性检查

#### 操作步骤
1. 在控制台中右键点击
2. 选择 "Save as..." 保存控制台日志
3. 或手动复制所有日志内容

#### 必需日志关键词
检查控制台日志是否包含以下关键词（按顺序）：

```
✅ 必需日志:
[ ] [BootScreen] 正在唤醒考试总览系统
[ ] [LazyLoader] 注册默认分组
[ ] [MainEntry] 初始化应用
[ ] [examIndexLoaded] 题库索引加载完成
[ ] [loadExamList] 开始加载题库列表
[ ] [displayExams] 渲染题目
[ ] [LazyLoader] 加载分组: browse-view
[ ] [LazyLoader] 加载分组: practice-suite
```

#### 不应出现的错误
```
❌ 不应出现:
[ ] Uncaught ReferenceError
[ ] Uncaught TypeError
[ ] Failed to load script
[ ] [LazyLoader] 组加载失败
[ ] Cannot read property 'xxx' of undefined
[ ] Temporal Dead Zone (TDZ) 错误
```

---

## 日志保存

### 方法1: 浏览器控制台保存
1. 在控制台中右键点击
2. 选择 "Save as..."
3. 保存为: `developer/logs/phase0-baseline-manual-YYYYMMDD.log`

### 方法2: 手动复制
1. 全选控制台内容（Cmd+A / Ctrl+A）
2. 复制（Cmd+C / Ctrl+C）
3. 粘贴到文本文件
4. 保存为: `developer/logs/phase0-baseline-manual-YYYYMMDD.log`

### 方法3: 使用控制台命令
```javascript
// 复制所有日志到剪贴板
copy(console.log.toString());
```

---

## 测试总结

### 测试结果汇总表

| 测试项 | 通过 | 失败 | 备注 |
|--------|------|------|------|
| 页面加载与启动屏幕 | ☐ | ☐ | |
| 总览视图 | ☐ | ☐ | |
| 题库浏览视图 | ☐ | ☐ | |
| 练习记录视图 | ☐ | ☐ | |
| 更多工具视图 | ☐ | ☐ | |
| 懒加载状态检查 | ☐ | ☐ | |
| 控制台日志完整性 | ☐ | ☐ | |

### 错误统计
```
总错误数: _____
总警告数: _____
致命错误数: _____
```

### 测试结论
```
[ ] ✅ 通过 - 可以开始 Phase 1 重构
[ ] ⚠️ 部分通过 - 需要修复已知问题后再开始重构
[ ] ❌ 失败 - 必须先修复所有错误
```

---

## 下一步行动

### 如果测试通过
1. 将日志文件保存到 `developer/logs/`
2. 更新 `mainjs-refactor-plan.md`，勾选阶段0第3项
3. 开始阶段1重构

### 如果测试失败
1. 记录所有错误和警告
2. 在 GitHub Issues 中创建问题报告
3. 修复问题后重新测试

---

**测试人员**: _________________  
**测试日期**: _________________  
**浏览器版本**: _________________  
**测试结果**: ☐ 通过 ☐ 失败  
**备注**: _________________
