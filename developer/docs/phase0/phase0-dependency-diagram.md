# main.js 拆分依赖关系图

## 一、加载时序图（Sequence Diagram）

```mermaid
sequenceDiagram
    participant Browser as 浏览器
    participant HTML as index.html
    participant Boot as bootScreen.js
    participant Lazy as lazyLoader.js
    participant Entry as main-entry.js
    participant Main as main.js
    participant Browse as browse-view组
    participant Practice as practice-suite组

    Browser->>HTML: file:// 打开
    HTML->>Boot: 同步加载启动脚本
    Boot->>Browser: 显示 Boot Screen
    HTML->>Lazy: 注册懒加载分组
    Lazy-->>Browser: 分组注册完成
    
    HTML->>Entry: 加载 main-entry.js
    Entry->>Entry: initializeLegacyComponents()
    Entry->>Lazy: ensureExamDataScripts()
    Lazy->>Browser: 加载 exam-data 组
    
    Browser->>Browser: examIndexLoaded 事件触发
    Browser->>Main: loadExamList() 调用
    Main->>Entry: 检查 examActions 是否加载
    
    alt examActions 未加载
        Main->>Lazy: ensureBrowseGroup()
        Lazy->>Browse: 顺序加载 browse-view 组
        Browse->>Main: examActions.js 加载完成
        Main->>Browse: 调用 examActions.loadExamList()
    else examActions 已加载
        Main->>Browse: 直接调用 examActions.loadExamList()
    end
    
    Browse-->>Browser: 渲染题库列表
    Boot->>Browser: 隐藏 Boot Screen
    
    Browser->>HTML: 用户点击"练习记录"
    HTML->>Lazy: ensurePracticeSuiteReady()
    Lazy->>Practice: 顺序加载 practice-suite 组
    Practice-->>Browser: 练习记录功能就绪
```

## 二、模块依赖关系图（Dependency Graph）

```mermaid
graph TD
    subgraph "同步加载层（index.html）"
        A[utils/storage.js] --> B[data/index.js]
        B --> C[views/overviewView.js]
        C --> D[presentation/navigation-controller.js]
        D --> E[app/examActions.js 新增]
        E --> F[app/main-entry.js]
    end
    
    subgraph "懒加载层 - browse-view 组"
        G1[app/state-service.js] --> G2[app/examActions.js]
        G1 --> G3[app/browseController.js]
        G1 --> G4[services/libraryManager.js]
        G2 --> G5[main.js 兼容转发]
        G3 --> G5
        G4 --> G5
        G6[components/PDFHandler.js] --> G5
        G7[components/BrowseStateManager.js] --> G5
    end
    
    subgraph "懒加载层 - practice-suite 组"
        H1[core/scoreStorage.js] --> H2[core/practiceRecorder.js]
        H2 --> H3[components/practiceHistoryEnhancer.js]
        H3 --> H4[services/GlobalStateService.js]
    end
    
    subgraph "懒加载层 - more-tools 组"
        I1[core/vocabStore.js] --> I2[presentation/moreView.js]
        I1 --> I3[presentation/miniGames.js]
    end
    
    F --> G1
    F -.触发懒加载.-> G5
    F -.触发懒加载.-> H4
    F -.触发懒加载.-> I2
    
    style G5 fill:#ff6b6b,stroke:#c92a2a,stroke-width:3px
    style F fill:#51cf66,stroke:#2f9e44,stroke-width:2px
    style G1 fill:#ffd43b,stroke:#fab005,stroke-width:2px
```

## 三、函数迁移流向图（Migration Flow）

```mermaid
graph LR
    subgraph "main.js 当前状态"
        M1[导航函数 20个]
        M2[浏览函数 45个]
        M3[练习记录函数 35个]
        M4[题库配置函数 25个]
        M5[工具函数 15个]
    end
    
    subgraph "阶段1目标"
        T1[navigation-controller.js]
        T2[main-entry.js]
    end
    
    subgraph "阶段2目标"
        T3[browseController.js]
        T4[examActions.js]
        T5[libraryManager.js]
    end
    
    subgraph "阶段3目标"
        T6[app-actions.js]
        T7[state-service.js]
    end
    
    subgraph "阶段4目标"
        T8[moreView.js]
        T9[miniGames.js]
    end
    
    M1 -->|ensureLegacyNavigation| T1
    M1 -->|showView 转发| T1
    M1 -->|reportBootStage| T2
    
    M2 -->|applyBrowseFilter| T3
    M2 -->|loadExamList| T4
    M2 -->|displayExams| T4
    M2 -->|switchLibraryConfig| T5
    M2 -->|resolveLibraryConfigurations| T5
    
    M3 -->|syncPracticeRecords| T6
    M3 -->|updatePracticeView| T6
    M3 -->|全局状态变量| T7
    
    M4 -->|题库配置管理| T5
    
    M5 -->|showDeveloperTeam| T8
    M5 -->|launchMiniGame| T9
    
    style M1 fill:#fa5252,stroke:#c92a2a
    style M2 fill:#ff6b6b,stroke:#e03131
    style M3 fill:#ff8787,stroke:#f03e3e
    style M4 fill:#ffa8a8,stroke:#f76707
    style M5 fill:#ffc9c9,stroke:#fd7e14
```

## 四、懒加载触发点流程图（Lazy Loading Triggers）

```mermaid
stateDiagram-v2
    [*] --> PageLoad: file:// 打开
    PageLoad --> BootScreen: 显示启动屏
    BootScreen --> RegisterGroups: 注册懒加载分组
    
    RegisterGroups --> ExamDataLoad: ensureExamDataScripts()
    ExamDataLoad --> IndexLoaded: examIndexLoaded 事件
    
    IndexLoaded --> CheckBrowseGroup: loadExamList() 调用
    CheckBrowseGroup --> LoadBrowseGroup: browse-view 组未加载
    LoadBrowseGroup --> BrowseReady: 顺序加载完成
    BrowseReady --> RenderList: 渲染题库列表
    
    RenderList --> OverviewView: 显示总览页面
    
    OverviewView --> BrowseClick: 点击"题库浏览"
    BrowseClick --> EnsureBrowseGroup: ensureBrowseGroup()
    EnsureBrowseGroup --> BrowseView: 切换到浏览视图
    
    OverviewView --> PracticeClick: 点击"练习记录"
    PracticeClick --> LoadPracticeSuite: ensurePracticeSuiteReady()
    LoadPracticeSuite --> PracticeView: 切换到练习视图
    
    OverviewView --> MoreClick: 点击"更多工具"
    MoreClick --> LoadMoreTools: 懒加载 more-tools 组
    LoadMoreTools --> MoreView: 切换到更多视图
    
    note right of LoadBrowseGroup
        browse-view 组加载顺序:
        1. state-service.js
        2. examActions.js
        3. browseController.js
        4. libraryManager.js
        5. main.js (兼容转发)
    end note
```

## 五、全局 API 兼容层映射图（Global API Compatibility）

```mermaid
graph TD
    subgraph "HTML 模板调用"
        H1[onclick='browseCategory()']
        H2[onclick='filterByType()']
        H3[onclick='searchExams()']
        H4[onclick='toggleBulkDelete()']
        H5[onclick='clearPracticeData()']
        H6[onclick='showDeveloperTeam()']
    end
    
    subgraph "window.* 全局 API"
        W1[window.browseCategory]
        W2[window.filterByType]
        W3[window.searchExams]
        W4[window.toggleBulkDelete]
        W5[window.clearPracticeData]
        W6[window.showDeveloperTeam]
        W7[window.switchLibraryConfig]
        W8[window.deleteLibraryConfig]
        W9[window.normalizeRecordId]
        W10[window.showMessage]
    end
    
    subgraph "main.js 兼容转发层"
        M1[browseCategory 转发]
        M2[filterByType 转发]
        M3[searchExams 转发]
        M4[toggleBulkDelete 转发]
        M5[clearPracticeData 转发]
        M6[showDeveloperTeam 转发]
        M7[switchLibraryConfig 转发]
        M8[deleteLibraryConfig 转发]
        M9[normalizeRecordId 保留]
        M10[showMessage 转发]
    end
    
    subgraph "实际实现模块"
        I1[browseController.browseCategory]
        I2[browseController.filterByType]
        I3[examActions.searchExams]
        I4[app-actions.toggleBulkDelete]
        I5[app-actions.clearPracticeData]
        I6[moreView.showDeveloperTeam]
        I7[libraryManager.switchLibraryConfig]
        I8[libraryManager.deleteLibraryConfig]
        I9[main.js normalizeRecordId]
        I10[message-center.showMessage]
    end
    
    H1 --> W1 --> M1 --> I1
    H2 --> W2 --> M2 --> I2
    H3 --> W3 --> M3 --> I3
    H4 --> W4 --> M4 --> I4
    H5 --> W5 --> M5 --> I5
    H6 --> W6 --> M6 --> I6
    W7 --> M7 --> I7
    W8 --> M8 --> I8
    W9 --> M9 --> I9
    W10 --> M10 --> I10
    
    style M1 fill:#ffd43b,stroke:#fab005
    style M2 fill:#ffd43b,stroke:#fab005
    style M3 fill:#ffd43b,stroke:#fab005
    style M4 fill:#ffd43b,stroke:#fab005
    style M5 fill:#ffd43b,stroke:#fab005
    style M6 fill:#ffd43b,stroke:#fab005
    style M7 fill:#ffd43b,stroke:#fab005
    style M8 fill:#ffd43b,stroke:#fab005
    style M9 fill:#51cf66,stroke:#2f9e44
    style M10 fill:#ffd43b,stroke:#fab005
```

## 六、阶段化迁移路线图（Phase Migration Roadmap）

```mermaid
gantt
    title main.js 拆分阶段化路线图
    dateFormat YYYY-MM-DD
    section 阶段0
    基线盘点与依赖分析           :done, phase0, 2025-11-28, 1d
    file:// 基线测试             :active, test0, after phase0, 1d
    
    section 阶段1
    入口/壳层函数迁移            :phase1, after test0, 2d
    全局状态出清                 :phase1b, after phase1, 1d
    兼容转发层验证               :test1, after phase1b, 1d
    
    section 阶段2
    浏览筛选函数迁移             :phase2a, after test1, 2d
    题库配置函数迁移             :phase2b, after phase2a, 2d
    懒加载顺序校正               :phase2c, after phase2b, 1d
    file:// 回归测试             :test2, after phase2c, 1d
    
    section 阶段3
    练习记录链路迁移             :phase3a, after test2, 2d
    导出/套题模式迁移            :phase3b, after phase3a, 1d
    懒加载触发点优化             :phase3c, after phase3b, 1d
    
    section 阶段4
    更多工具/小游戏迁移          :phase4a, after phase3c, 1d
    空壳函数清理                 :phase4b, after phase4a, 1d
    
    section 阶段5
    file:// 手测全流程            :test5a, after phase4b, 1d
    CI 静态测试套件              :test5b, after test5a, 1d
    E2E 练习流程测试             :test5c, after test5b, 1d
    临时日志清理                 :cleanup, after test5c, 1d
```

## 七、风险点与防御措施（Risk Mitigation）

```mermaid
mindmap
    root((main.js 拆分风险))
        顺序依赖断裂
            懒加载分组内保持依赖顺序
            state-service 必须最先加载
            main.js 必须最后加载
            入口 shim 要求可重入
        兼容层遗漏
            所有 window.* API 保留转发
            HTML onclick 事件不失效
            跨模块调用检查清单
        数据一致性
            统一使用 state-service
            避免跨模块各存一份
            练习记录同步机制保持
        懒加载缺文件
            lazyLoader 分组完整性检查
            404 错误监控
            降级加载策略
        TDZ 错误
            避免函数声明前调用
            使用函数表达式替代声明
            严格控制加载顺序
```

---

**图表说明**:
- 🔴 红色节点: 需要迁移的 main.js 函数
- 🟡 黄色节点: 兼容转发层（临时保留）
- 🟢 绿色节点: 最终实现模块
- 🔵 蓝色节点: 核心依赖模块

**使用方式**:
1. 在支持 Mermaid 的 Markdown 查看器中打开本文档
2. 或使用 [Mermaid Live Editor](https://mermaid.live/) 渲染图表
3. 或在 VS Code 中安装 Mermaid 插件查看

**维护者**: Antigravity AI  
**版本**: v1.0  
**更新时间**: 2025-11-28
