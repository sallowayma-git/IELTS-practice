# IELTS系统测试指南

本指南说明如何使用新的测试基线加载器和兼容层，确保测试页面能够正常运行。

## 基线加载系统

### 概述

新的测试基线加载系统（`tests/include-baseline.js`）提供了一个统一的脚本加载流程，确保所有必需的组件按正确顺序加载，避免依赖问题。

### 使用方法

#### 1. 测试页面引入

只需要在测试页面中引入一个脚本：

```html
<!DOCTYPE html>
<html>
<head>
    <title>测试页面</title>
</head>
<body>
    <!-- 你的测试内容 -->

    <!-- 引入基线加载器 -->
    <script src="tests/include-baseline.js"></script>

    <!-- 测试脚本 -->
    <script>
        // 等待基线就绪
        onBaselineReady(async () => {
            // 等待存储系统就绪
            await waitForStorageReady();

            // 开始你的测试
            console.log('测试开始');
            runTests();
        });

        // 错误处理
        onBaselineError((error) => {
            console.error('基线加载失败:', error);
        });
    </script>
</body>
</html>
```

#### 2. 基线加载状态检查

```javascript
// 获取加载状态
const status = getBaselineStatus();
console.log('基线状态:', status);

// 输出示例：
// {
//     isLoading: false,
//     isReady: true,
//     loadedScripts: ['../js/utils/storage.js', '../js/stores/AppStore.js', ...],
//     dependencies: {
//         storage: true,
//         EventEmitter: true,
//         AppStore: true,
//         ExamStore: true,
//         RecordStore: true,
//         SettingsPanel: true,
//         App: true
//     }
// }
```

#### 3. 存储就绪检查

```javascript
// 等待存储系统就绪
try {
    await waitForStorageReady();
    console.log('存储系统已就绪');
} catch (error) {
    console.error('存储系统未就绪:', error);
}
```

### 脚本加载顺序

基线加载器按以下顺序加载脚本：

1. **基础数据**
   - `assets/scripts/complete-exam-data.js`

2. **Utils层**
   - `js/utils/events.js`
   - `js/utils/helpers.js`
   - `js/utils/storage.js`
   - `js/utils/performanceOptimizer.js`
   - `js/utils/errorDisplay.js`

3. **Stores层**
   - `js/stores/AppStore.js`
   - `js/stores/ExamStore.js`
   - `js/stores/RecordStore.js`

4. **UI层**
   - `js/ui/ExamBrowser.js`
   - `js/ui/RecordViewer.js`
   - `js/ui/SettingsPanel.js`

5. **Core组件**
   - `js/core/scoreStorage.js`

6. **Legacy函数**
   - `js/script.js`

7. **App初始化**
   - `js/app.js`

8. **兼容层**
   - `tests/compat-shims.js`

## 兼容层API

### 概述

兼容层（`tests/compat-shims.js`）为旧测试期望的全局函数提供代理，确保测试代码能够正常运行，同时提供向新API迁移的路径。

### 可用的全局函数

#### 题库管理

```javascript
// 刷新题库
await loadLibrary(force);

// 刷新考试库
await refreshExamLibrary();

// 加载考试库
await loadExamLibrary();

// 显示题库配置
showLibraryConfigListV2();

// 显示题库加载器
showLibraryLoaderModal();
```

#### 数据管理

```javascript
// 创建手动备份
await createManualBackup();

// 导出所有数据
await exportAllData();

// 导入数据
await importData();

// 清除缓存
await clearCache();

// 刷新考试
refreshExams();
```

#### 搜索和筛选

```javascript
// 搜索考试
searchExams(query);

// 按类型筛选
filterByType('reading'); // 'reading', 'listening', 'all'

// 按分类筛选
filterByCategory('P1'); // 'P1', 'P2', 'P3'
```

#### 练习记录

```javascript
// 按类型筛选记录
filterRecordsByType('reading');

// 清除练习数据
clearPracticeData();

// 切换批量删除
toggleBulkDelete();
```

#### 主题和UI

```javascript
// 显示主题切换器
showThemeSwitcherModal();

// 隐藏主题切换器
hideThemeSwitcherModal();

// 显示开发团队
showDeveloperTeam();

// 隐藏开发团队
hideDeveloperTeam();
```

### SettingsPanel API

```javascript
// 获取SettingsPanel实例
const panel = SettingsPanelAPI.getInstance();

// 创建备份
await SettingsPanelAPI.createBackup();

// 导出数据
await SettingsPanelAPI.exportData();

// 导入数据
await SettingsPanelAPI.importData();

// 显示题库配置
SettingsPanelAPI.showLibraryConfig();

// 显示题库配置列表
SettingsPanelAPI.showLibraryConfigListV2();

// 切换题库配置
await SettingsPanelAPI.switchLibraryConfig(configKey);

// 删除题库配置
await SettingsPanelAPI.deleteLibraryConfig(configKey);
```

## API迁移指南

### 旧API → 新API映射

| 旧API | 新API | 说明 |
|-------|-------|------|
| `loadLibrary()` | `App.stores.exams.refreshExams()` | 题库刷新 |
| `showLibraryConfigListV2()` | `App.ui.settingsPanel.showLibraryConfigListV2()` | 题库配置 |
| `searchExams(query)` | `App.ui.examBrowser.search(query)` | 考试搜索 |
| `filterByType(type)` | `App.ui.examBrowser.setType(type)` | 类型筛选 |
| `filterByCategory(category)` | `App.ui.examBrowser.setCategory(category)` | 分类筛选 |
| `createManualBackup()` | `SettingsPanelAPI.createBackup()` | 创建备份 |
| `exportAllData()` | `SettingsPanelAPI.exportData()` | 数据导出 |
| `importData()` | `SettingsPanelAPI.importData()` | 数据导入 |

### 推荐的迁移步骤

1. **使用兼容层**：继续使用现有的全局函数，兼容层会自动代理到新实现。

2. **逐步迁移**：在新测试中直接使用新的API：
   ```javascript
   // 旧方式
   await loadLibrary();

   // 新方式
   await App.stores.exams.refreshExams();
   ```

3. **测试验证**：确保迁移后的测试功能正常。

4. **移除旧调用**：在确认新API工作正常后，移除对旧全局函数的调用。

## 调试和故障排除

### 启用调试模式

```javascript
// 在测试页面中启用调试
window.__DEBUG__ = true;
```

### 常见问题

1. **存储系统未就绪**
   ```javascript
   // 解决方案：等待存储就绪
   await waitForStorageReady();
   ```

2. **App未初始化**
   ```javascript
   // 解决方案：检查App状态
   if (!App.isInitialized()) {
       console.error('App未初始化');
   }
   ```

3. **依赖缺失**
   ```javascript
   // 解决方案：检查依赖状态
   const status = getBaselineStatus();
   console.log('依赖状态:', status.dependencies);
   ```

4. **函数不存在**
   ```javascript
   // 解决方案：检查函数可用性
   if (typeof loadLibrary === 'function') {
       await loadLibrary();
   } else {
       console.error('loadLibrary函数不可用');
   }
   ```

### 错误处理

```javascript
// 基线加载错误处理
onBaselineError((error) => {
    console.error('基线加载失败:', error);
    // 可以在这里添加错误恢复逻辑
});

// 测试函数错误处理
try {
    await loadLibrary();
    console.log('题库加载成功');
} catch (error) {
    console.error('题库加载失败:', error);
}
```

## 最佳实践

1. **始终等待基线就绪**：在开始测试前，确保所有组件都已加载完成。

2. **检查存储状态**：在进行存储操作前，使用`waitForStorageReady()`确保存储系统就绪。

3. **使用新的API**：在新测试中优先使用新的API，兼容层主要用于过渡。

4. **适当的错误处理**：为所有异步操作添加适当的错误处理。

5. **调试模式**：在开发时启用调试模式，获取详细的日志信息。

## 示例测试用例

```javascript
// 完整的测试用例示例
onBaselineReady(async () => {
    try {
        // 等待存储系统就绪
        await waitForStorageReady();

        console.log('开始测试...');

        // 测试题库管理
        console.log('测试题库管理...');
        await loadLibrary();
        console.log('✅ 题库加载成功');

        // 测试设置面板
        console.log('测试设置面板...');
        SettingsPanelAPI.showLibraryConfig();
        console.log('✅ 设置面板打开成功');

        // 测试搜索功能
        console.log('测试搜索功能...');
        searchExams('test');
        console.log('✅ 搜索功能正常');

        console.log('🎉 所有测试通过');

    } catch (error) {
        console.error('❌ 测试失败:', error);
    }
});

onBaselineError((error) => {
    console.error('❌ 基线加载失败:', error);
});
```

## 弃用计划

兼容层主要用于过渡期，未来将逐步弃用：

1. **DEBUG模式警告**：在DEBUG模式下，使用旧API时会显示弃用警告。

2. **分阶段弃用**：根据使用情况，分阶段移除旧API的兼容层。

3. **文档更新**：及时更新文档，引导开发者使用新的API。

4. **测试迁移**：逐步将现有测试迁移到新的API。

---

如有问题或建议，请查看相关文档或联系开发团队。