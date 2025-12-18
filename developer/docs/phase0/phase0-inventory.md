# 阶段0：main.js 拆分基线盘点与依赖分析

## 一、全局变量/函数归属清单

### 1. 导航/视图控制模块 → `js/presentation/navigation-controller.js` + `js/app/main-entry.js`

#### 全局变量
- `legacyNavigationController` (line 27) - 导航控制器实例
- `overviewViewInstance` (line 886) - 总览视图实例
- `overviewDelegatesConfigured` (line 1080) - 总览事件委托配置标志

#### 函数
- `ensureLegacyNavigation(options)` (line 110-142) - 确保导航控制器初始化
  - 子函数: `onRepeatNavigate(viewName)` (line 115-119)
  - 子函数: `onNavigate(viewName)` (line 120-128)
- `getViewName(viewName)` (line 2417-2426) - 视图名称规范化
- `showView` - **需从 navigation-controller.js 暴露全局兼容层**

### 2. 浏览/题库模块 → `js/app/browseController.js` + `js/app/examActions.js` + `js/services/libraryManager.js`

#### 全局变量
- `browseStateManager` (line 27) - 浏览状态管理器
- `examListViewInstance` (line 27) - 题库列表视图实例
- `libraryConfigViewInstance` (line 2692) - 题库配置视图实例
- `preferredFirstExamByCategory` (line 78-89) - 分类首选题目配置

#### 函数 - 浏览筛选与列表
- `loadExamList()` (line 1751-1831) → **examActions.js**
- `displayExams(exams)` (line 1849-1955) → **examActions.js**
- `resetBrowseViewToAll()` (line 1833-1847) → **examActions.js**
- `browseCategory(category, type, filterMode, path)` (line 1532-1594, 1731-1742) → **browseController.js**
- `filterByType(type)` (line 1596-1616) → **browseController.js**
- `applyBrowseFilter(category, type, filterMode, path)` (line 1618-1702) → **browseController.js**
- `initializeBrowseView()` (line 1704-1727) → **browseController.js**
- `searchExams(query)` (line 2499-2507) → **examActions.js**
- `performSearch(query)` (line 2509-2535) → **examActions.js**
- `ensureExamListView()` (line 91-99) → **examActions.js**
- `refreshBrowseProgressFromRecords(recordsOverride)` (line 1393-1411) → **browseController.js**

#### 函数 - 题库配置管理
- `getLibraryManager()` (line 62-67) → **libraryManager.js**
- `ensureLibraryManagerReady()` (line 69-77) → **libraryManager.js**
- `ensureLibraryConfigView()` (line 2694-2702) → **libraryManager.js**
- `resolveLibraryConfigurations()` (line 2842-2879) → **libraryManager.js**
- `fetchLibraryDataset(key)` (line 2881-2887) → **libraryManager.js**
- `updateLibraryConfigurationMetadata(key, examCount)` (line 2889-2894) → **libraryManager.js**
- `normalizeLibraryConfigurationRecords(rawConfigs)` (line 2704-2840) → **libraryManager.js**
- `renderLibraryConfigList(options)` (line 3135-3170) → **libraryManager.js**
- `renderLibraryConfigFallback(container, configs, options)` (line 2967-3133) → **libraryManager.js**
- `showLibraryConfigList(options)` (line 3172-3174) → **libraryManager.js**
- `showLibraryConfigListV2(options)` (line 3176-3178) → **libraryManager.js**
- `switchLibraryConfig(configKey)` (line 3180-3205) → **libraryManager.js** ⚠️ **保留 window.switchLibraryConfig**
- `deleteLibraryConfig(configKey)` (line 3207-3250) → **libraryManager.js** ⚠️ **保留 window.deleteLibraryConfig**
- `resetBrowseStateAfterLibrarySwitch()` (line 2896-2907) → **libraryManager.js**
- `applyLibraryConfiguration(key, dataset, options)` (line 2909-2915) → **libraryManager.js**
- `debugCompareActiveIndexWithDefault()` (line 2917-2965) → **libraryManager.js**

#### 函数 - 路径与资源解析
- `resolveExamBasePath(exam)` (line 2010-2045) → **examActions.js** ⚠️ **保留 window.resolveExamBasePath**
- `buildResourcePath(exam, kind)` (line 2249-2276) → **examActions.js** ⚠️ **保留 window.buildResourcePath**
- `extractTopLevelRootSegment(root)` (line 2047-2057) → **examActions.js**
- `clonePathMap(map, fallback)` (line 2065-2080) → **examActions.js**
- `normalizePathRoot(value)` (line 2082-2092) → **examActions.js**
- `mergeRootWithFallback(root, fallbackRoot)` (line 2094-2100) → **examActions.js**
- `buildOverridePathMap(metadata, fallback)` (line 2102-2108) → **examActions.js**
- `derivePathMapFromIndex(exams, fallbackMap)` (line 2115-2121) → **examActions.js**
- `loadPathMapForConfiguration(key)` (line 2123-2129) → **examActions.js**
- `setActivePathMap(map)` (line 2131-2135) → **examActions.js**
- `savePathMapForConfiguration(key, examIndex, options)` (line 2137-2146) → **examActions.js**
- `getPathMap()` (line 2148-2165) → **examActions.js**
- `normalizeThemeBasePrefix(prefix)` (line 2167-2178) → **examActions.js**
- `stripQueryAndHash(url)` (line 2180-2186) → **examActions.js**
- `detectScriptBasePrefix()` (line 2188-2230) → **examActions.js**
- `resolveThemeBasePrefix()` (line 2232-2247) → **examActions.js**
- `sanitizeFilename(name, kind)` (line 2277-2288) → **examActions.js**
- `isAbsolutePath(value)` (line 1960-1970) → **examActions.js**
- `ensureTrailingSlash(value)` (line 1972-1977) → **examActions.js**
- `joinAbsoluteResource(base, file)` (line 1979-1990) → **examActions.js**
- `encodePathSegments(path)` (line 1992-2008) → **examActions.js**

#### 函数 - 题库加载与缓存
- `loadLibrary(forceReload)` (line 858-865) → **libraryManager.js**
- `resolveScriptPathRoot(type)` (line 867-875) → **libraryManager.js**
- `finishLibraryLoading(startTime)` (line 877-882) → **libraryManager.js**
- `getActiveLibraryConfigurationKey()` (line 2464-2471) → **libraryManager.js**
- `getLibraryConfigurations()` (line 2472-2478) → **libraryManager.js**
- `saveLibraryConfiguration(name, key, examCount)` (line 2479-2484) → **libraryManager.js**
- `setActiveLibraryConfiguration(key)` (line 2485-2490) → **libraryManager.js**
- `triggerFolderPicker()` (line 2491) → **libraryManager.js**
- `handleFolderSelection(event)` (line 2492) → **libraryManager.js**

### 3. 练习记录/导出模块 → `js/presentation/app-actions.js` + `js/app/state-service.js`

#### 全局变量
- `fallbackExamSessions` (line 17) - 降级会话存储 Map
- `processedSessions` (line 18) - 已处理会话 Set
- `practiceListScroller` (line 19) - 练习列表滚动器
- `practiceDashboardViewInstance` (line 27) - 练习仪表板视图实例
- `practiceRecordsLoadPromise` (line 350) - 练习记录加载 Promise
- `completionNoticeState` (line 373-377) - 完成通知状态
- `practiceHistoryDelegatesConfigured` (line 1184) - 练习历史事件委托配置标志
- `practiceSessionEventBound` (line 1413) - 练习会话事件绑定标志

#### 函数 - 记录同步与存储
- `syncPracticeRecords()` (line 229-348) → **app-actions.js**
- `ensurePracticeRecordsSync(trigger)` (line 351-364) → **app-actions.js**
- `startPracticeRecordsSyncInBackground(trigger)` (line 366-372) → **app-actions.js**
- `ensurePracticeSessionSyncListener()` (line 1414-1442) → **app-actions.js**
- `savePracticeRecordFallback(examId, realData)` (line 695-856) → **app-actions.js**
  - 子函数: `normalizeTitle(str)` (line 751-757)
- `setupMessageListener()` (line 515-563) → **app-actions.js**
- `setupStorageSyncListener()` (line 565-573) → **app-actions.js**

#### 函数 - 完成通知与统计
- `extractCompletionPayload(envelope)` (line 379-398) → **app-actions.js**
- `extractCompletionSessionId(envelope)` (line 400-412) → **app-actions.js**
- `shouldAnnounceCompletion(sessionId)` (line 414-425) → **app-actions.js**
- `pickNumericValue(values)` (line 427-439) → **app-actions.js**
- `extractCompletionStats(payload)` (line 441-485) → **app-actions.js**
- `formatPercentageDisplay(value)` (line 487-493) → **app-actions.js**
- `showCompletionSummary(envelope)` (line 495-513) → **app-actions.js**

#### 函数 - 答案规范化与比较
- `normalizeFallbackAnswerValue(value)` (line 575-610) → **app-actions.js**
- `normalizeFallbackAnswerMap(rawAnswers)` (line 612-635) → **app-actions.js**
- `buildFallbackAnswerDetails(answerMap, correctMap)` (line 637-657) → **app-actions.js**
- `normalizeFallbackAnswerComparison(existingComparison, answerMap, correctMap)` (line 659-693) → **app-actions.js**

#### 函数 - 视图更新与交互
- `ensurePracticeDashboardView()` (line 101-108) → **app-actions.js**
- `updatePracticeView()` (line 1332-1391) → **app-actions.js**
- `computePracticeSummaryFallback(records)` (line 1444-1498) → **app-actions.js**
- `applyPracticeSummaryFallback(summary)` (line 1500-1526) → **app-actions.js**
- `setupPracticeHistoryInteractions()` (line 1186-1286) → **app-actions.js**
  - 子函数: `handleDetails(recordId, event)` (line 1196-1202)
  - 子函数: `handleDelete(recordId, event)` (line 1204-1210)
  - 子函数: `handleSelection(recordId, event)` (line 1212-1216)
  - 子函数: `handleCheckbox(recordId, event)` (line 1218-1227)
- `normalizeRecordType(value)` (line 1288-1300) → **app-actions.js**
- `recordMatchesExamType(record, targetType, examIndex)` (line 1302-1330) → **app-actions.js**
- `filterRecordsByType(type)` (line 1745-1748) → **app-actions.js**

#### 函数 - 批量操作与删除
- `refreshBulkDeleteButton()` (line 1149-1168) → **app-actions.js**
- `ensureBulkDeleteMode(options)` (line 1170-1182) → **app-actions.js**
- `toggleBulkDelete()` (line 2537-2567) → **app-actions.js**
- `bulkDeleteRecords(selectedSnapshot)` (line 2569-2598) → **app-actions.js**
- `toggleRecordSelection(recordId)` (line 2600-2615) → **app-actions.js**
- `deleteRecord(recordId)` (line 2618-2656) → **app-actions.js**
- `clearPracticeData()` (line 2658-2666) → **app-actions.js**

### 4. 总览页面模块 → `js/views/overviewView.js` + `js/presentation/app-actions.js`

#### 函数
- `getOverviewView()` (line 888-898) → **overviewView.js**
- `updateOverview()` (line 900-955) → **overviewView.js**
  - 子函数: `onBrowseCategory(category, type, filterMode, path)` (line 928-932)
  - 子函数: `onRandomPractice(category, type, filterMode, path)` (line 933-937)
  - 子函数: `onStartSuite()` (line 938-940)
- `renderOverviewLegacy(container, stats)` (line 957-1078) → **overviewView.js**
  - 子函数: `appendSection(title, entries, icon)` (line 1002-1065)
- `setupOverviewInteractions()` (line 1082-1147) → **overviewView.js**
  - 子函数: `invokeAction(target, event)` (line 1092-1126)

### 5. 练习启动/套题模块 → `js/presentation/app-actions.js`

#### 函数
- `openExam(examId)` (line 2293-2318) → **app-actions.js** ⚠️ **保留 window.openExam 兼容**
- `startHandshakeFallback(examWindow, examId)` (line 2320-2354) → **app-actions.js**
  - 子函数: `tick()` (line 2328-2346)
- `viewPDF(examId)` (line 2356-2364) → **app-actions.js**
- `showRecordDetails(recordId)` (line 2366-2386) → **app-actions.js**
- `openPDFSafely(pdfPath, examTitle)` (line 2388-2415) → **app-actions.js**
- `startSuitePractice()` (line 3268-3288) → **app-actions.js** ⚠️ **保留 window.startSuitePractice**
- `openExamWithFallback(exam, delay)` (line 3290-3318) → **app-actions.js**
  - 子函数: `launch()` (line 3298-3311)
- `startRandomPractice(category, type, filterMode, path)` (line 3320-3362) → **app-actions.js**

### 6. 更多工具/小游戏模块 → `js/presentation/moreView.js` + `js/presentation/miniGames.js`

#### 函数
- `showDeveloperTeam()` (line 3258-3261) → **moreView.js**
- `hideDeveloperTeam()` (line 3263-3266) → **moreView.js**
- `launchMiniGame` - **需从 miniGames.js 暴露全局兼容层**

### 7. 启动/引导模块 → `js/app/main-entry.js` + `js/presentation/app-actions.js`

#### 函数
- `reportBootStage(message, progress)` (line 28-36) → **main-entry.js**
- `ensureExamDataScripts()` (line 38-43) → **main-entry.js**
- `ensurePracticeSuiteReady()` (line 45-53) → **main-entry.js**
- `ensureBrowseGroup()` (line 55-60) → **main-entry.js**
- `initializeLegacyComponents()` (line 144-211) → **main-entry.js**
- `cleanupOldCache()` (line 213-224) → **main-entry.js**

### 8. 工具/辅助函数 → `js/utils/` 或保留在 main.js

#### 函数
- `normalizeRecordId(id)` (line 6-11) → **保留在 main.js** ⚠️ **已暴露 window.normalizeRecordId**
- `updateSystemInfo()` (line 2428-2444) → **app-actions.js**
- `showMessage(message, type, duration)` (line 2446-2458) → **已在 message-center.js** ⚠️ **保留 window.showMessage**
- `clearCache()` (line 2668-2690) → **app-actions.js**

### 9. PDF 处理模块 → `js/components/PDFHandler.js`

#### 全局变量
- `pdfHandler` (line 27) - PDF 处理器实例

### 10. 应用实例 → `js/app.js`

#### 全局变量
- `app` (line 20) - 应用主实例

---

## 二、懒加载顺序与触发点依赖图

### 加载阶段流程图

```
┌─────────────────────────────────────────────────────────────────┐
│ index.html 同步加载（启动前必需）                                  │
├─────────────────────────────────────────────────────────────────┤
│ 1. js/presentation/shuiBackground.js (defer)                    │
│ 2. js/runtime/bootScreen.js (defer)                             │
│ 3. js/runtime/lazyLoader.js (defer) ← 懒加载核心                 │
│ 4. js/presentation/app-actions.js (defer)                       │
│ 5. js/utils/environmentDetector.js                              │
│ 6. js/utils/logger.js                                           │
│ 7. js/utils/storage.js                                          │
│ 8. js/core/storageProviderRegistry.js                           │
│ 9. js/data/dataSources/storageDataSource.js                     │
│ 10. js/data/repositories/*.js (baseRepository, registry, etc.)  │
│ 11. js/data/index.js                                            │
│ 12. js/utils/stateSerializer.js                                 │
│ 13. js/utils/simpleStorageWrapper.js                            │
│ 14. js/utils/dom.js                                             │
│ 15. js/views/legacyViewBundle.js                                │
│ 16. js/utils/performance.js                                     │
│ 17. js/utils/typeChecker.js                                     │
│ 18. js/utils/codeStandards.js                                   │
│ 19. js/services/overviewStats.js                                │
│ 20. js/views/overviewView.js                                    │
│ 21. js/presentation/navigation-controller.js                    │
│ 22. js/app/examActions.js ← 新增同步加载                         │
│ 23. js/app/main-entry.js                                        │
│ 24. js/presentation/indexInteractions.js                        │
│ 25. js/boot-fallbacks.js                                        │
│ 26. js/patches/runtime-fixes.js                                 │
│ 27. js/app/stateMixin.js                                        │
│ 28. js/app/bootstrapMixin.js                                    │
│ 29. js/app/lifecycleMixin.js                                    │
│ 30. js/app/navigationMixin.js                                   │
│ 31. js/app/examSessionMixin.js                                  │
│ 32. js/app/suitePracticeMixin.js                                │
│ 33. js/app/fallbackMixin.js                                     │
│ 34. js/app.js                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ examIndexLoaded 事件触发 → loadExamList() 调用                    │
└─────────────────────────────────────────────────────────────────┘
```

### 懒加载分组触发点

#### 1. `exam-data` 组（题库数据脚本）
**触发时机**: `ensureExamDataScripts()` 调用
- `assets/scripts/complete-exam-data.js`
- `assets/scripts/listening-exam-data.js`

**依赖关系**: 
- 必须在 `loadExamList()` 之前完成
- 由 `main-entry.js` 的初始化流程触发

#### 2. `browse-view` 组（浏览视图核心）
**触发时机**: 
- 用户点击"📚 题库浏览"导航按钮
- 总览页面点击分类卡片
- `ensureBrowseGroup()` 调用

**当前加载顺序**:
```
1. js/app/examActions.js ← 题库操作核心
2. js/app/state-service.js ← 状态服务
3. js/app/browseController.js ← 浏览控制器
4. js/services/libraryManager.js ← 题库管理器
5. js/presentation/message-center.js
6. js/runtime/legacy-state-adapter.js
7. js/components/PDFHandler.js
8. js/components/SystemDiagnostics.js
9. js/components/PerformanceOptimizer.js
10. js/components/DataIntegrityManager.js
11. js/components/BrowseStateManager.js
12. js/utils/dataConsistencyManager.js
13. js/utils/answerComparisonUtils.js
14. js/utils/BrowsePreferencesUtils.js
15. js/main.js ← 最后加载，提供兼容转发
```

**⚠️ 关键依赖约束**:
- `examActions.js` 必须先于 `main.js` 加载（提供 `loadExamList`、`displayExams` 实现）
- `browseController.js` 必须先于 `main.js` 加载（提供 `applyBrowseFilter` 实现）
- `libraryManager.js` 必须先于 `main.js` 加载（提供题库配置管理）
- `state-service.js` 必须先于所有控制器加载（提供状态管理）

#### 3. `practice-suite` 组（练习记录功能）
**触发时机**:
- 用户点击"📝 练习记录"导航按钮
- 练习完成后自动触发记录同步
- `ensurePracticeSuiteReady()` 调用

**当前加载顺序**:
```
1. js/utils/markdownExporter.js
2. js/components/practiceRecordModal.js
3. js/components/practiceHistoryEnhancer.js
4. js/core/scoreStorage.js
5. js/utils/answerSanitizer.js
6. js/core/practiceRecorder.js
7. js/core/legacyStateBridge.js
8. js/utils/legacyStateAdapter.js
9. js/services/GlobalStateService.js
```

**依赖关系**:
- 必须在练习记录视图显示前完成
- `syncPracticeRecords()` 依赖此组加载完成

#### 4. `more-tools` 组（更多工具）
**触发时机**:
- 用户点击"✨ 更多"导航按钮
- 点击时钟/词汇卡片

**当前加载顺序**:
```
1. js/utils/vocabDataIO.js
2. js/core/vocabScheduler.js
3. js/core/vocabStore.js
4. js/components/vocabDashboardCards.js
5. js/components/vocabSessionView.js
6. js/utils/dataBackupManager.js
7. js/presentation/moreView.js
8. js/presentation/miniGames.js
```

#### 5. `theme-tools` 组（主题切换）
**触发时机**: 用户点击主题切换按钮
```
1. js/theme-switcher.js
```

---

## 三、必须先于 main.js 的依赖清单

### 同步加载依赖（index.html 中）
✅ 已正确排序，无需调整：
1. `js/utils/storage.js` - localStorage 封装
2. `js/data/index.js` - 数据层初始化
3. `js/views/overviewView.js` - 总览视图（main.js 中 `getOverviewView()` 依赖）
4. `js/presentation/navigation-controller.js` - 导航控制器
5. `js/app/examActions.js` - **新增**，提供题库操作核心功能
6. `js/app/main-entry.js` - 主入口（调用 main.js 函数）

### 懒加载依赖（browse-view 组内）
⚠️ **必须严格保持顺序**：
1. `js/app/state-service.js` - 状态服务（所有控制器依赖）
2. `js/app/examActions.js` - 题库操作（main.js 转发目标）
3. `js/app/browseController.js` - 浏览控制器（main.js 转发目标）
4. `js/services/libraryManager.js` - 题库管理器（main.js 转发目标）
5. `js/main.js` - **最后加载**，仅提供兼容转发

---

## 四、file:// 基线测试检查点

### 测试步骤
1. **清除浏览器缓存与 localStorage**
   ```javascript
   localStorage.clear();
   location.reload(true);
   ```

2. **打开 index.html (file:// 协议)**
   - 检查控制台无 404 错误
   - 检查无 `Uncaught ReferenceError` 错误
   - 检查无 `Temporal Dead Zone` 错误

3. **观察启动流程**
   - ✅ Boot Screen 显示进度
   - ✅ `examIndexLoaded` 事件触发
   - ✅ `loadExamList()` 正常调用
   - ✅ 总览页面正常渲染（分类卡片显示）

4. **测试导航切换**
   - ✅ 点击"题库浏览" → 懒加载 `browse-view` 组
   - ✅ 点击"练习记录" → 懒加载 `practice-suite` 组
   - ✅ 点击"更多" → 懒加载 `more-tools` 组

5. **记录基线日志**
   - 记录控制台所有 `console.log`、`console.warn`、`console.error`
   - 记录网络请求（检查是否有失败的脚本加载）
   - 记录 `AppLazyLoader.getStatus()` 输出

### 预期基线输出
```javascript
// 控制台应包含以下关键日志
[BootScreen] 正在唤醒考试总览系统...
[LazyLoader] 注册默认分组: exam-data, browse-view, practice-suite, more-tools, theme-tools
[MainEntry] 初始化应用...
[examIndexLoaded] 题库索引加载完成
[loadExamList] 开始加载题库列表
[displayExams] 渲染 147 个题目
```

### 已知告警（可接受）
- ⚠️ `LegacyStateAdapter` 兼容性警告（预期行为）
- ⚠️ 某些旧版浏览器的 `Promise` polyfill 警告

### 不可接受的错误
- ❌ `Uncaught ReferenceError: xxx is not defined`
- ❌ `Cannot read property 'xxx' of undefined`
- ❌ `Failed to load script: xxx.js`
- ❌ 懒加载组加载失败（`[LazyLoader] 组加载失败`）

---

## 五、阶段0任务勾选清单

### ✅ 已完成
- [x] 列出 `js/main.js` 全局变量/函数归属清单
- [x] 标注归属模块（导航/浏览/练习/工具/配置）
- [x] 绘制加载顺序与懒加载触发点流程图
- [x] 标出必须先于 main.js 的依赖

### ⏳ 待执行（需用户确认后进行）
- [ ] 手动 file:// 打开首屏，记录控制台基线日志/告警
- [ ] 确认 `examIndexLoaded` → `loadExamList` 正常
- [ ] 保存基线日志到 `developer/logs/phase0-baseline.log`

---

## 六、下一步行动建议

### 立即执行（阶段0完成）
1. **用户手动测试**: 在 file:// 协议下打开 index.html，记录基线日志
2. **确认无回归**: 确保当前版本无控制台错误
3. **保存基线**: 将控制台输出保存到日志文件

### 准备阶段1（入口/壳层出清）
1. **创建迁移分支**: `git checkout -b refactor/main-js-phase1`
2. **备份 main.js**: `cp js/main.js js/main.js.backup`
3. **开始迁移**: 按阶段1清单逐项迁移函数

### 风险提示
⚠️ **关键约束**:
- 所有 `window.*` 全局 API 必须保留兼容转发
- 懒加载分组顺序不可打乱（state-service → controllers → main.js）
- 每个阶段完成后必须跑 file:// 手测 + CI 测试

---

## 七、补充依赖标注

### HTML 模板中的全局调用（必须保留兼容层）
```html
<!-- index.html 中直接调用的函数 -->
onclick="filterByType('all')" → window.filterByType
onclick="searchExams(this.value)" → window.searchExams
onclick="filterRecordsByType('all')" → window.filterRecordsByType
onclick="toggleBulkDelete()" → window.toggleBulkDelete
onclick="clearPracticeData()" → window.clearPracticeData
onclick="clearCache()" → window.clearCache
onclick="showDeveloperTeam()" → window.showDeveloperTeam
onclick="hideDeveloperTeam()" → window.hideDeveloperTeam
onclick="showThemeSwitcherModal()" → window.showThemeSwitcherModal
onclick="hideThemeSwitcherModal()" → window.hideThemeSwitcherModal
onclick="browseCategory('P1','reading')" → window.browseCategory
```

### 跨模块调用（需确保加载顺序）
```javascript
// app-actions.js 依赖
window.AppActions.exportPracticeMarkdown() ← 需在 app-actions.js 中暴露

// 题库管理器依赖
getLibraryManager() ← 需在 libraryManager.js 加载后可用

// 导航控制器依赖
ensureLegacyNavigation() ← 需在 navigation-controller.js 加载后可用

// 视图实例依赖
getOverviewView() ← 需在 overviewView.js 加载后可用
ensureExamListView() ← 需在 examActions.js 中实现
ensurePracticeDashboardView() ← 需在 app-actions.js 中实现
```

---

**文档版本**: Phase 0 - v1.0  
**创建时间**: 2025-11-28  
**维护者**: Antigravity AI  
**状态**: ✅ 清单完成，等待用户确认基线测试
