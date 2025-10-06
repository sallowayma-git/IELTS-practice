/**
 * 主应用程序
 * 负责应用的初始化和整体协调
 */
class ExamSystemApp {
    constructor() {
        this.currentView = 'overview';
        this.components = {};
        this.isInitialized = false;

        // 统一状态管理 - 替代全局变量
        this.state = {
            // 考试相关状态
            exam: {
                index: [],
                currentCategory: 'all',
                currentExamType: 'all',
                filteredExams: [],
                configurations: {},
                activeConfigKey: 'exam_index'
            },

            // 练习相关状态
            practice: {
                records: [],
                selectedRecords: new Set(),
                bulkDeleteMode: false,
                dataCollector: null
            },

            // UI状态
            ui: {
                browseFilter: { category: 'all', type: 'all' },
                pendingBrowseFilter: null,
                legacyBrowseType: 'all',
                currentVirtualScroller: null,
                loading: false,
                loadingMessage: ''
            },

            // 组件实例
            components: {
                dataIntegrityManager: null,
                pdfHandler: null,
                browseStateManager: null,
                practiceListScroller: null
            },

            // 系统状态
            system: {
                processedSessions: new Set(),
                fallbackExamSessions: new Map(),
                failedScripts: new Set()
            }
        };

        // 绑定方法上下文
        this.handleResize = this.handleResize.bind(this);
    }

    // 状态管理方法
    getState(path) {
        return path.split('.').reduce((obj, key) => obj && obj[key], this.state);
    }

    setState(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => obj && obj[key], this.state);
        if (target && target.hasOwnProperty(lastKey)) {
            target[lastKey] = value;
        }
    }

    updateState(path, updates) {
        const current = this.getState(path);
        this.setState(path, { ...current, ...updates });
    }

    // 持久化状态到存储 (使用序列化适配器)
    async persistState(path, storageKey = null) {
        const value = this.getState(path);
        const key = storageKey || path.replace('.', '_');

        try {
            // 使用StateSerializer确保Set/Map对象正确序列化
            const serializedValue = StateSerializer.serialize(value);
            await storage.set(key, serializedValue);
        } catch (error) {
            console.error(`[App] 持久化状态失败 ${path}:`, error);
        }
    }

    // 批量持久化状态
    async persistMultipleState(mapping) {
        const promises = Object.entries(mapping).map(([path, storageKey]) =>
            this.persistState(path, storageKey)
        );

        try {
            await Promise.all(promises);
        } catch (error) {
            console.error('[App] 批量持久化状态失败:', error);
        }
    }

    // 从存储加载状态 (使用反序列化适配器)
    async loadState(path, storageKey = null) {
        const key = storageKey || path.replace('.', '_');

        try {
            const value = await storage.get(key, null);
            if (value !== null) {
                const deserializedValue = StateSerializer.deserialize(value);
                this.setState(path, deserializedValue);
                return deserializedValue;
            }
        } catch (error) {
            console.error(`[App] 加载状态失败 ${path}:`, error);
        }
        return null;
    }

    // 加载所有持久化状态
    async loadPersistedState() {
        const stateMappings = {
            'exam': 'app_exam_state',
            'practice': 'app_practice_state',
            'ui': 'app_ui_state',
            'system': 'app_system_state'
        };

        for (const [path, storageKey] of Object.entries(stateMappings)) {
            await this.loadState(path, storageKey);
        }

        console.log('[App] 持久化状态加载完成');
    }

    // 保存所有状态到持久化存储
    async saveAllState() {
        const stateMappings = {
            'exam': 'app_exam_state',
            'practice': 'app_practice_state',
            'ui': 'app_ui_state',
            'system': 'app_system_state'
        };

        await this.persistMultipleState(stateMappings);
        console.log('[App] 所有状态已保存');
    }

    // 组件检查功能
    async checkComponents() {
        console.log('=== 组件加载检查 ===');

        const components = {
            'SystemDiagnostics': window.SystemDiagnostics,
            'MarkdownExporter': window.MarkdownExporter,
            'practiceRecordModal': window.practiceRecordModal,
            'practiceHistoryEnhancer': window.practiceHistoryEnhancer
        };

        let allLoaded = true;

        Object.keys(components).forEach(name => {
            const component = components[name];
            const status = component ? '✅ 已加载' : '❌ 未加载';
            console.log(`${name}: ${status}`);

            if (!component) {
                allLoaded = false;
            }
        });

        // 检查全局函数
        const functions = {
            'exportPracticeData': window.exportPracticeData,
            'showRecordDetails': window.showRecordDetails,
            'showMessage': window.showMessage
        };

        console.log('\n=== 全局函数检查 ===');
        Object.keys(functions).forEach(name => {
            const func = functions[name];
            const status = (typeof func === 'function') ? '✅ 可用' : '❌ 不可用';
            console.log(`${name}: ${status}`);
        });

        // 检查数据
        console.log('\n=== 数据检查 ===');
        const practiceRecordsCount = this.getState('practice.records')?.length || 0;
        console.log(`practiceRecords: ${practiceRecordsCount} 条记录`);

        if (window.storage) {
            try {
                const arr = await window.storage.get('practice_records', []);
                const count = Array.isArray(arr) ? arr.length : 0;
                console.log(`storage.practice_records: ${count} 条记录`);
            } catch (_) {
                console.log('storage.practice_records: 0 条记录');
            }
        }

        console.log('\n=== 检查完成 ===');

        if (allLoaded) {
            console.log('✅ 所有组件已正确加载');

            // 尝试初始化增强器
            if (window.practiceHistoryEnhancer && !window.practiceHistoryEnhancer.initialized) {
                console.log('🔄 手动初始化增强器...');
                window.practiceHistoryEnhancer.initialize();
            }
        } else {
            console.log('⚠️ 部分组件未加载，功能可能受限');
        }

        return { allLoaded, components, functions };
    }

    // 初始化全局变量访问兼容层
    initializeGlobalCompatibility() {
        // 考试相关
        Object.defineProperty(window, 'examIndex', {
            get: () => this.state.exam.index,
            set: (value) => this.setState('exam.index', value),
            configurable: true
        });

        Object.defineProperty(window, 'currentCategory', {
            get: () => this.state.exam.currentCategory,
            set: (value) => this.setState('exam.currentCategory', value),
            configurable: true
        });

        Object.defineProperty(window, 'currentExamType', {
            get: () => this.state.exam.currentExamType,
            set: (value) => this.setState('exam.currentExamType', value),
            configurable: true
        });

        Object.defineProperty(window, 'filteredExams', {
            get: () => this.state.exam.filteredExams,
            set: (value) => this.setState('exam.filteredExams', value),
            configurable: true
        });

        // 练习相关
        Object.defineProperty(window, 'practiceRecords', {
            get: () => this.state.practice.records,
            set: (value) => this.setState('practice.records', value),
            configurable: true
        });

        Object.defineProperty(window, 'bulkDeleteMode', {
            get: () => this.state.practice.bulkDeleteMode,
            set: (value) => this.setState('practice.bulkDeleteMode', value),
            configurable: true
        });

        Object.defineProperty(window, 'selectedRecords', {
            get: () => this.state.practice.selectedRecords,
            set: (value) => this.setState('practice.selectedRecords', value),
            configurable: true
        });

        // UI状态
        Object.defineProperty(window, '__browseFilter', {
            get: () => this.state.ui.browseFilter,
            set: (value) => this.setState('ui.browseFilter', value),
            configurable: true
        });

        Object.defineProperty(window, '__pendingBrowseFilter', {
            get: () => this.state.ui.pendingBrowseFilter,
            set: (value) => this.setState('ui.pendingBrowseFilter', value),
            configurable: true
        });

        Object.defineProperty(window, '__legacyBrowseType', {
            get: () => this.state.ui.legacyBrowseType,
            set: (value) => this.setState('ui.legacyBrowseType', value),
            configurable: true
        });

        // 组件实例
        Object.defineProperty(window, 'dataIntegrityManager', {
            get: () => this.state.components.dataIntegrityManager,
            set: (value) => this.setState('components.dataIntegrityManager', value),
            configurable: true
        });

        Object.defineProperty(window, 'pdfHandler', {
            get: () => this.state.components.pdfHandler,
            set: (value) => this.setState('components.pdfHandler', value),
            configurable: true
        });

        Object.defineProperty(window, 'app', {
            get: () => this,
            set: (value) => { /* 保持app引用为当前实例 */ },
            configurable: true
        });

        // 全局组件检查函数
        window.checkComponents = () => this.checkComponents();
    }

    /**
     * 初始化应用
     */
    async initialize() {
        try {
            this.showLoading(true);
            this.updateLoadingMessage('正在检查系统依赖...');

            // 检查必要的依赖
            this.checkDependencies();

            this.updateLoadingMessage('正在初始化状态管理...');
            // 初始化统一状态管理和全局变量兼容层
            this.initializeGlobalCompatibility();
            this.updateLoadingMessage('正在加载持久化状态...');
            // 加载持久化状态
            await this.loadPersistedState();

            this.updateLoadingMessage('正在初始化响应式功能...');
            // 初始化响应式管理器
            this.initializeResponsiveFeatures();

            this.updateLoadingMessage('正在加载系统组件...');
            // 初始化组件
            await this.initializeComponents();

            this.updateLoadingMessage('正在设置事件监听器...');
            // 设置事件监听器
            this.setupEventListeners();

            // 调用 main.js 的遗留组件初始化
            if (typeof window.initializeLegacyComponents === 'function') {
                this.updateLoadingMessage('正在初始化遗留组件...');
                window.initializeLegacyComponents();
            }

            this.updateLoadingMessage('正在加载初始数据...');
            // 加载初始数据
            await this.loadInitialData();

            this.updateLoadingMessage('正在设置用户界面...');
            // 设置初始视图
            this.setupInitialView();

            // 返回导航已移除

            // 显示活动会话指示器
            
            // 定期更新活动会话
            this.startSessionMonitoring();

            // 设置全局错误处理
            this.setupGlobalErrorHandling();

            this.isInitialized = true;
            this.showLoading(false);

              this.showUserMessage('系统初始化完成', 'success');

        } catch (error) {
            this.showLoading(false);
            this.handleInitializationError(error);
        }
    }

    /**
     * 处理初始化错误
     */
    handleInitializationError(error) {
        console.error('[App] 系统初始化失败:', error);

        // 分析错误类型并提供相应的用户反馈
        let userMessage = '系统初始化失败';
        let canRecover = false;

        if (error.message.includes('组件加载超时')) {
            userMessage = '系统组件加载超时，请刷新页面重试';
            canRecover = true;
        } else if (error.message.includes('依赖')) {
            userMessage = '系统依赖检查失败，请确保所有必需文件已正确加载';
        } else if (error.message.includes('网络')) {
            userMessage = '网络连接问题，请检查网络连接后重试';
            canRecover = true;
        } else {
            userMessage = '系统遇到未知错误，请联系技术支持';
        }

        // 显示用户友好的错误信息
        this.showUserMessage(userMessage, 'error');

        // 记录详细错误信息（用于调试）
        if (window.handleError) {
            window.handleError(error, 'App Initialization');
        }

        // 显示降级UI或恢复选项
        this.showFallbackUI(canRecover);
    }

    /**
     * 设置全局错误处理
     */
    setupGlobalErrorHandling() {
        // 捕获未处理的Promise拒绝
        window.addEventListener('unhandledrejection', (event) => {
            console.error('[App] 未处理的Promise拒绝:', event.reason);
            this.handleGlobalError(event.reason, 'Promise拒绝');
            event.preventDefault(); // 防止默认的错误处理
        });

        // 捕获JavaScript错误
        window.addEventListener('error', (event) => {
            console.error('[App] JavaScript错误:', event.error);
            this.handleGlobalError(event.error, 'JavaScript错误');
        });

      }

    /**
     * 处理全局错误
     */
    handleGlobalError(error, context) {
        // 避免错误处理本身引起的循环错误
        try {
            // 记录错误
            if (!this.globalErrors) {
                this.globalErrors = [];
            }

            this.globalErrors.push({
                error: error.message || error,
                context: context,
                timestamp: Date.now(),
                stack: error.stack
            });

            // 限制错误记录数量
            if (this.globalErrors.length > 100) {
                this.globalErrors = this.globalErrors.slice(-50);
            }

            // 根据错误频率决定是否显示用户提示
            const recentErrors = this.globalErrors.filter(
                e => Date.now() - e.timestamp < 60000 // 最近1分钟的错误
            );

            if (recentErrors.length > 5) {
                this.showUserMessage('系统遇到多个错误，建议刷新页面', 'warning');
            } else if (!error.message || !error.message.includes('Script error')) {
                // 只对有意义的错误显示提示（排除跨域脚本错误）
                this.showUserMessage('系统遇到错误，但仍可继续使用', 'warning');
            }

        } catch (handlingError) {
            console.error('[App] 错误处理失败:', handlingError);
        }
    }

    /**
     * 更新加载消息
     */
    updateLoadingMessage(message) {
        const loadingText = document.querySelector('.loading-text');
        if (loadingText) {
            loadingText.textContent = message;
        }
    }

    /**
     * 显示用户消息
     */
    showUserMessage(message, type = 'info') {
        // 使用现有的showMessage函数或创建新的通知
        if (window.showMessage) {
            window.showMessage(message, type);
        } else {
          }
    }

    /**
     * 初始化响应式功能
     */
    initializeResponsiveFeatures() {
        // 初始化响应式管理器
        if (window.ResponsiveManager) {
            this.responsiveManager = new ResponsiveManager();
        }

        // 初始化触摸处理器
        if (window.TouchHandler) {
            this.touchHandler = new TouchHandler();
        }

        // 初始化主题管理器
        if (window.ThemeManager) {
            this.themeManager = new ThemeManager();
        }

        // 初始化键盘快捷键
        if (window.KeyboardShortcuts) {
            this.keyboardShortcuts = new KeyboardShortcuts();
        }



        // 初始化教程系统
        if (window.TutorialSystem) {
            this.tutorialSystem = new TutorialSystem();
        }

        // 初始化设置面板
        if (window.SettingsPanel) {
            this.settingsPanel = new SettingsPanel();
        }

        // 设置响应式事件监听
        this.setupResponsiveEvents();
    }

    /**
     * 设置响应式事件监听
     */
    setupResponsiveEvents() {
        // 监听断点变化
        // 简化的节流函数
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this.responsiveManager) {
                    this.responsiveManager.recalculateLayout();
                }
                // 应用级resize处理
                this.handleResize();
            }, 250);
        });

        // 监听方向变化
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                if (this.responsiveManager) {
                    this.responsiveManager.recalculateLayout();
                }
                this.adjustForOrientation();
            }, 100);
        });
    }

    /**
     * 调整方向变化
     */
    adjustForOrientation() {
        const isLandscape = window.innerHeight < window.innerWidth;

        // 在移动设备横屏时调整布局
        if (isLandscape && window.innerWidth <= 768) {
            document.body.classList.add('mobile-landscape');

            // 调整导航栏
            const header = document.querySelector('.main-header');
            if (header) {
                header.style.padding = '0.5rem 0';
            }

            // 调整统计卡片
            const statsGrid = document.querySelector('.stats-overview');
            if (statsGrid) {
                statsGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
                statsGrid.style.marginBottom = '1rem';
            }
        } else {
            document.body.classList.remove('mobile-landscape');

            // 恢复默认样式
            const header = document.querySelector('.main-header');
            if (header) {
                header.style.padding = '';
            }

            const statsGrid = document.querySelector('.stats-overview');
            if (statsGrid) {
                statsGrid.style.gridTemplateColumns = '';
                statsGrid.style.marginBottom = '';
            }
        }
    }

    /**
     * 检查必要的依赖
     */
    checkDependencies() {
        // 仅检查硬性依赖，保持向后兼容；Utils 可选
        const requiredGlobals = ['storage'];
        const missing = requiredGlobals.filter(name => !window[name]);

        if (missing.length > 0) {
            throw new Error(`Missing required dependencies: ${missing.join(', ')}`);
        }
        // 软依赖提示但不阻断
        if (!window.Utils) {
            console.warn('[App] Optional dependency missing: Utils (continuing)');
        }
    }

    /**
     * 初始化组件
     */
    async initializeComponents() {
        // 定义组件加载优先级 - 只加载实际存在的组件
        const coreComponents = ['PracticeRecorder']; // 只有PracticeRecorder是必需的
        const optionalComponents = [
            // ExamBrowser已移除，使用内置的题目列表功能
        ]; // 只加载真正需要且存在的组件

        try {
            // 首先加载核心组件
            await this.waitForComponents(coreComponents, 8000);
            await this.initializeCoreComponents();

            // 然后加载可选组件
            try {
                await this.waitForComponents(optionalComponents, 5000);
                await this.initializeOptionalComponents();
            } catch (error) {
                // 静默处理可选组件加载失败，直接初始化已加载的组件
                await this.initializeAvailableOptionalComponents();
            }


        } catch (error) {
            console.error('[App] 核心组件加载失败:', error);
            throw error;
        }
    }

    /**
     * 初始化核心组件
     */
    async initializeCoreComponents() {

        // ExamBrowser现在是可选组件，不在核心初始化中处理

        // 初始化PracticeRecorder（必需，但有降级方案）
        if (window.PracticeRecorder) {
            try {
                this.components.practiceRecorder = new PracticeRecorder();
                this.setupPracticeRecorderEvents();
            } catch (error) {
                console.error('[App] PracticeRecorder初始化失败:', error);
                this.components.practiceRecorder = this.createFallbackRecorder();
            }
        } else {
            console.warn('[App] PracticeRecorder类不可用，创建降级记录器');
            this.components.practiceRecorder = this.createFallbackRecorder();
        }
    }

    /**
     * 初始化可选组件
     */
    async initializeOptionalComponents() {

        const componentInitializers = [
            // ExamBrowser组件已移除，使用内置的题目列表功能
            // PracticeHistory组件已移除，使用简单的练习记录界面

            { name: 'RecommendationDisplay', init: () => new RecommendationDisplay() },
            {
                name: 'GoalSettings', init: () => {
                    const instance = new GoalSettings();
                    window.goalSettings = instance;
                    return instance;
                }
            },
            { name: 'ProgressTracker', init: () => new ProgressTracker() },
            { name: 'SpecializedPractice', init: () => new SpecializedPractice() },
            { name: 'QuestionTypePractice', init: () => new QuestionTypePractice() },
            {
                name: 'DataManagementPanel', init: () => {
                    const container = document.createElement('div');
                    container.id = 'dataManagementPanel';
                    if (typeof window.DOM !== 'undefined' && window.DOM.hide) {
                        window.DOM.hide(container);
                    } else {
                        container.style.display = 'none';
                    }
                    document.body.appendChild(container);
                    const instance = new DataManagementPanel(container);
                    window.dataManagementPanel = instance;
                    return instance;
                }
            },
            {
                name: 'SystemMaintenancePanel', init: () => {
                    const container = document.createElement('div');
                    container.id = 'systemMaintenancePanel';
                    if (typeof window.DOM !== 'undefined' && window.DOM.hide) {
                        window.DOM.hide(container);
                    } else {
                        container.style.display = 'none';
                    }
                    document.body.appendChild(container);
                    const instance = new SystemMaintenancePanel(container);
                    window.systemMaintenancePanel = instance;
                    return instance;
                }
            }
        ];

        for (const { name, init } of componentInitializers) {
            if (window[name]) {
                try {
                    const componentKey = name.charAt(0).toLowerCase() + name.slice(1);
                    this.components[componentKey] = init();
                } catch (error) {
                    console.error(`[App] ${name}初始化失败:`, error);
                }
            } else {
                // 静默跳过不可用的可选组件
            }
        }
    }

    /**
     * 初始化已加载的可选组件
     */
    async initializeAvailableOptionalComponents() {

        // 只初始化已经加载的组件
        const availableComponents = [
            // ExamBrowser已移除，使用内置的题目列表功能
            // PracticeHistory and ExamScanner were removed
        ].filter(name => window[name]);

        if (availableComponents.length > 0) {

            // 使用相同的初始化逻辑，但只处理可用的组件
            await this.initializeOptionalComponents();
        } else {
            console.warn('[App] 没有发现可用的可选组件');
        }

        // ExamBrowser组件已移除，使用内置的题目列表功能
    }

    /**
     * 等待组件类加载
     */
    async waitForComponents(requiredClasses = ['ExamBrowser'], timeout = 3000) {
        const startTime = Date.now();
        const checkInterval = 100;


        while (Date.now() - startTime < timeout) {
            const loadingStatus = requiredClasses.map(className => {
                const isLoaded = window[className] && typeof window[className] === 'function';
                if (!isLoaded) {
                    console.debug(`[App] 等待组件: ${className}`);
                }
                return { className, isLoaded };
            });

            const allLoaded = loadingStatus.every(status => status.isLoaded);

            if (allLoaded) {
                const elapsed = Date.now() - startTime;
                return true;
            }

            // 显示加载进度
            const loadedCount = loadingStatus.filter(s => s.isLoaded).length;
            const progress = Math.round((loadedCount / requiredClasses.length) * 100);

            if ((Date.now() - startTime) % 1000 < checkInterval) {
            }

            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        // 生成详细的错误信息
        const missingClasses = requiredClasses.filter(className =>
            !window[className] || typeof window[className] !== 'function'
        );

        const loadedClasses = requiredClasses.filter(className =>
            window[className] && typeof window[className] === 'function'
        );

        const errorMessage = [
            `组件加载超时 (${timeout}ms)`,
            `已加载: ${loadedClasses.join(', ') || '无'}`,
            `缺失: ${missingClasses.join(', ')}`,
            `请检查组件文件是否正确加载`
        ].join('\n');

        console.error('[App] 组件加载失败:', errorMessage);
        throw new Error(errorMessage);
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 导航事件
        document.addEventListener('click', (e) => {
            const navBtn = e.target.closest('.nav-btn');
            if (navBtn) {
                const view = navBtn.dataset.view;
                if (view) {
                    this.navigateToView(view);
                }
            }

            // 返回按钮
            const backBtn = e.target.closest('.btn-back');
            if (backBtn) {
                this.navigateToView('overview');
            }

            // 分类操作按钮
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const category = actionBtn.dataset.category;
                this.handleCategoryAction(action, category);
            }
        });

  
        // 页面可见性变化
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isInitialized) {
                this.refreshData();
            }
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case '1':
                        e.preventDefault();
                        this.navigateToView('overview');
                        break;
                    case '2':
                        e.preventDefault();
                        this.navigateToView('practice');
                        break;
                    case '3':
                        e.preventDefault();
                        this.navigateToView('analysis');
                        break;
                    case '4':
                        e.preventDefault();
                        this.navigateToView('goals');
                        break;
                }
            }
        });
    }

    /**
     * 加载初始数据
     */
    async loadInitialData() {
        try {
            // 加载考试索引到状态管理
            const examIndex = await storage.get('exam_index', []);
            if (Array.isArray(examIndex)) {
                this.setState('exam.index', examIndex);
            }

            // 加载练习记录到状态管理
            const practiceRecords = await storage.get('practice_records', []);
            if (Array.isArray(practiceRecords)) {
                this.setState('practice.records', practiceRecords);
            }

            // 加载浏览过滤器状态
            const browseFilter = await storage.get('browse_filter', { category: 'all', type: 'all' });
            this.setState('ui.browseFilter', browseFilter);

            // ExamScanner已移除，题库索引由其他方式管理

            // 加载用户统计
            await this.loadUserStats();

            // 更新UI
            this.updateOverviewStats();

        } catch (error) {
            console.error('Failed to load initial data:', error);
            // 不抛出错误，允许应用继续运行
        }
    }

    /**
     * 加载用户统计数据
     */
    async loadUserStats() {
        const stats = await storage.get('user_stats', {
            totalPractices: 0,
            totalTimeSpent: 0,
            averageScore: 0,
            categoryStats: {},
            questionTypeStats: {},
            streakDays: 0,
            lastPracticeDate: null,
            achievements: []
        });

        this.userStats = stats;
        return stats;
    }

    /**
     * 更新总览页面统计信息
     */
    async updateOverviewStats() {
        // 使用状态管理中的数据
        const examIndex = this.getState('exam.index') || [];
        const practiceRecords = this.getState('practice.records') || [];

        // 确保数据是数组
        if (!Array.isArray(examIndex) || !Array.isArray(practiceRecords)) {
            console.warn('[App] 状态管理中的数据格式异常');
            return;
        }

        // 更新总体统计
        const totalExams = examIndex.length;
        const completedExams = new Set(practiceRecords.map(r => r.examId)).size;
        const averageAccuracy = this.calculateAverageAccuracy(practiceRecords);
        const studyDays = this.calculateStudyDays(practiceRecords);

        this.updateStatElement('total-exams', totalExams);
        this.updateStatElement('completed-exams', completedExams);
        this.updateStatElement('average-accuracy', `${averageAccuracy}%`);
        this.updateStatElement('study-days', studyDays);

        // 更新分类统计
        this.updateCategoryStats(examIndex, practiceRecords);
    }

    /**
     * 更新统计元素
     */
    updateStatElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    /**
     * 计算平均正确率
     */
    calculateAverageAccuracy(records) {
        if (records.length === 0) return 0;

        const totalAccuracy = records.reduce((sum, record) => sum + (record.accuracy || 0), 0);
        return Math.round((totalAccuracy / records.length) * 100);
    }

    /**
     * 计算学习天数
     */
    calculateStudyDays(records) {
        if (records.length === 0) return 0;

        const dates = new Set(records.map(record => {
            return new Date(record.startTime).toDateString();
        }));

        return dates.size;
    }

    /**
     * 更新分类统计
     */
    updateCategoryStats(examIndex, practiceRecords) {
        const categories = ['P1', 'P2', 'P3'];
        const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);

        categories.forEach(category => {
            const categoryExams = list.filter(exam => exam.category === category);
            const categoryRecords = practiceRecords.filter(record => {
                const exam = list.find(e => e.id === record.examId);
                return exam && exam.category === category;
            });

            const completed = new Set(categoryRecords.map(r => r.examId)).size;
            const total = categoryExams.length;
            const progress = total > 0 ? (completed / total) * 100 : 0;

            // 更新进度条
            const progressBar = document.querySelector(`[data-category="${category}"] .progress-fill`);
            if (progressBar) {
                progressBar.style.width = `${progress}%`;
                progressBar.dataset.progress = progress;
            }

            // 更新进度文本
            const progressText = document.querySelector(`[data-category="${category}"] .progress-text`);
            if (progressText) {
                progressText.textContent = `${completed}/${total} 已完成`;
            }
        });
    }

    /**
     * 设置初始视图
     */
    setupInitialView() {
        // 简化的URL参数获取，避免依赖Utils
        const urlParams = new URLSearchParams(window.location.search);
        const urlView = urlParams.get('view');
        const initialView = urlView || 'overview';

        // 初始化完成后立即调用导航到指定视图
        this.navigateToView(initialView);
    }

    /**
     * 导航到指定视图
     */
    navigateToView(viewName) {
        if (this.currentView === viewName) return;

        // 隐藏所有视图
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });

        // 显示目标视图
        const targetView = document.getElementById(`${viewName}-view`);
        if (targetView) {
            targetView.classList.add('active');
            this.currentView = viewName;

            // 更新导航状态
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.remove('active');
            });

            const activeNavBtn = document.querySelector(`[data-view="${viewName}"]`);
            if (activeNavBtn) {
                activeNavBtn.classList.add('active');
            }

            // 更新URL
            const url = new URL(window.location);
            url.searchParams.set('view', viewName);
            window.history.replaceState({}, '', url);

            // 触发视图激活事件
            this.onViewActivated(viewName);
        }
    }

    /**
     * 视图激活回调
     */
    onViewActivated(viewName) {
        switch (viewName) {
            case 'overview':
                this.refreshOverviewData();
                break;
            case 'browse':
                // 如果存在待应用的筛选，则优先应用而不重置
                if (window.__pendingBrowseFilter && typeof window.applyBrowseFilter === 'function') {
                    const { category, type } = window.__pendingBrowseFilter;
                    try { window.applyBrowseFilter(category, type); } finally { delete window.__pendingBrowseFilter; }
                } else if (typeof window.initializeBrowseView === 'function') {
                    window.initializeBrowseView();
                }
                break;
            case 'specialized-practice':
                if (this.components.specializedPractice) {
                    this.components.specializedPractice.updateSpecializedProgress();
                }
                break;
            case 'question-type-practice':
                if (this.components.questionTypePractice) {
                    this.components.questionTypePractice.updateQuestionTypesDisplay();
                }
                break;
            case 'practice':
                // 练习视图已由其他组件处理
                console.log('[App] 练习视图已激活');
                break;
        }
    }

    /**
     * 处理分类操作
     */
    handleCategoryAction(action, category) {
        switch (action) {
            case 'browse':
                this.browseCategory(category);
                break;
            case 'practice':
                this.startCategoryPractice(category);
                break;
        }
    }

    /**
     * 浏览分类题目
     */
    browseCategory(category, type = null) {
        try {
            // 记录待应用筛选（可显式传入类型，如 'reading' 或 'listening'）
            window.__pendingBrowseFilter = { category, type };
            window.__browseFilter = { category, type };
        } catch (_) {}

        // 无论是否存在旧的 ExamBrowser，都统一走新浏览视图
        this.navigateToView('browse');

        // 立即尝试应用（如果浏览视图已在当前激活）
        try {
            if (typeof window.applyBrowseFilter === 'function' && document.getElementById('browse-view')?.classList.contains('active')) {
                window.applyBrowseFilter(category, type);
                delete window.__pendingBrowseFilter;
            }
        } catch (_) {}
    }

    /**
     * 开始分类练习
     */
    async startCategoryPractice(category) {
        // 获取该分类的题目
        const examIndex = await storage.get('exam_index', []);
        const categoryExams = examIndex.filter(exam => exam.category === category);

        if (categoryExams.length === 0) {
            window.showMessage(`${category} 分类暂无可用题目`, 'warning');
            return;
        }

        // 随机选择一个题目
        const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
        this.openExam(randomExam.id);
    }

    /**
      * 打开指定题目进行练习
      */
    async openExam(examId) {
        // 使用活动题库配置键，保证全量/增量切换后仍能打开
        let examIndex = [];
        try {
            const activeKey = await storage.get('active_exam_index_key', 'exam_index');
            examIndex = await storage.get(activeKey, []) || [];
            if ((!examIndex || examIndex.length === 0) && activeKey !== 'exam_index') {
                examIndex = await storage.get('exam_index', []);
            }
        } catch (_) {
            examIndex = await storage.get('exam_index', []);
        }

        // 增加数组化防御
        let list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
        const exam = list.find(e => e.id === examId);

        if (!exam) {
            window.showMessage('题目不存在', 'error');
            return;
        }

        try {
            // 若无HTML，直接打开PDF
            if (exam.hasHtml === false) {
                const pdfUrl = (typeof window.buildResourcePath === 'function')
                    ? window.buildResourcePath(exam, 'pdf')
                    : ((exam.path || '').replace(/\\/g,'/').replace(/\/+\//g,'/') + (exam.pdfFilename || '') );
                const pdfWin = window.open(pdfUrl, `pdf_${exam.id}`, 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
                if (!pdfWin) throw new Error('无法打开PDF窗口，请检查弹窗设置');
                window.showMessage(`正在打开PDF: ${exam.title}`, 'info');
                return;
            }

            // 先构造URL并立即打开窗口（保持用户手势，避免被浏览器拦截）
            const examUrl = this.buildExamUrl(exam);
            const examWindow = this.openExamWindow(examUrl, exam);

            // 再进行会话记录与脚本注入
            await this.startPracticeSession(examId);
            this.injectDataCollectionScript(examWindow, examId);
            this.setupExamWindowManagement(examWindow, examId);

            window.showMessage(`正在打开题目: ${exam.title}`, 'info');

        } catch (error) {
            console.error('Failed to open exam:', error);
            window.showMessage('打开题目失败，请重试', 'error');
        }
    }

    /**
     * 构造题目URL
     */
    buildExamUrl(exam) {
        // 使用全局的路径构建器以确保阅读/听力路径正确
        if (typeof window.buildResourcePath === 'function') {
            return window.buildResourcePath(exam, 'html');
        }

        // 回退：基于exam对象构造完整的文件路径（可能不含根前缀）
        let examPath = exam.path || '';
        if (!examPath.endsWith('/')) {
            examPath += '/';
        }
        return examPath + exam.filename;
    }



    /**
     * 在新窗口中打开题目
     */
    openExamWindow(examUrl, exam) {
        // 计算窗口尺寸和位置
        const windowFeatures = this.calculateWindowFeatures();

        // 打开新窗口
        let examWindow = null;
        try {
            examWindow = window.open(
                examUrl,
                `exam_${exam.id}`,
                windowFeatures
            );
        } catch (_) {}

        // 弹窗被拦截时，降级为当前窗口打开，确保用户可进入练习页
        if (!examWindow) {
            try {
                window.location.href = examUrl;
                return window; // 以当前窗口作为返回引用
            } catch (e) {
                throw new Error('无法打开题目页面，请检查弹窗/文件路径设置');
            }
        }

        return examWindow;
    }

    /**
     * 计算窗口特性
     */
    calculateWindowFeatures() {
        const screenWidth = window.screen.availWidth;
        const screenHeight = window.screen.availHeight;

        // 窗口尺寸（占屏幕的80%）
        const windowWidth = Math.floor(screenWidth * 0.8);
        const windowHeight = Math.floor(screenHeight * 0.8);

        // 窗口位置（居中）
        const windowLeft = Math.floor((screenWidth - windowWidth) / 2);
        const windowTop = Math.floor((screenHeight - windowHeight) / 2);

        return [
            `width=${windowWidth}`,
            `height=${windowHeight}`,
            `left=${windowLeft}`,
            `top=${windowTop}`,
            'scrollbars=yes',
            'resizable=yes',
            'status=yes',
            'toolbar=no',
            'menubar=no',
            'location=no'
        ].join(',');
    }

    /**
      * 注入数据采集脚本到练习页面
      */
    injectDataCollectionScript(examWindow, examId) {

        // 新增修复3E：修复await语法错误 - 将内部injectScript改为async
        const injectScript = async () => {
            try {
                // 检查窗口是否仍然存在
                if (examWindow.closed) {
                    console.warn('[DataInjection] 窗口已关闭');
                    return;
                }

                // 尝试访问文档，处理跨域情况
                let doc;
                try {
                    doc = examWindow.document;
                    if (!doc) {
                        console.warn('[DataInjection] 无法访问窗口文档');
                        return;
                    }
                } catch (e) {
                    console.warn('[DataInjection] 跨域限制，无法注入脚本');
                    // 对于跨域情况，只能等待页面主动通信
                    return;
                }

                // 检查是否已经注入过脚本
                if (examWindow.practiceDataCollector) {
                    this.initializePracticeSession(examWindow, examId);
                    return;
                }


                // 加载练习页面增强脚本
                const enhancerScript = await fetch('./js/practice-page-enhancer.js').then(r => r.text());

                // 注入练习页面增强脚本
                const enhancerScriptEl = doc.createElement('script');
                enhancerScriptEl.type = 'text/javascript';
                enhancerScriptEl.textContent = enhancerScript;
                doc.head.appendChild(enhancerScriptEl);


                // 等待脚本初始化完成后发送会话信息
                setTimeout(() => {
                    this.initializePracticeSession(examWindow, examId);
                }, 1500); // 增加等待时间确保脚本完全初始化

            } catch (error) {
                console.error('[DataInjection] 脚本注入失败:', error);
                // 降级到内联脚本注入
                this.injectInlineScript(examWindow, examId);
            }
        };

        // 更可靠的页面加载检测
        const checkAndInject = async () => {
            try {
                if (examWindow.closed) return;

                const doc = examWindow.document;
                if (doc && (doc.readyState === 'complete' || doc.readyState === 'interactive')) {
                    await injectScript();
                } else {
                    // 继续等待
                    setTimeout(checkAndInject, 200);
                }
            } catch (e) {
                // 跨域情况，无法注入脚本
            }
        };

        // 开始检测，给页面一些加载时间
        setTimeout(checkAndInject, 500);
    }

    /**
     * 内联脚本注入（备用方案）
     */
    injectInlineScript(examWindow, examId) {
        try {
            // 创建一个简化版的数据采集器
            const inlineScript = examWindow.document.createElement('script');
            inlineScript.textContent = `
                // 简化版数据采集器
                window.practiceDataCollector = {
                    sessionId: '${examId}_${Date.now()}',
                    startTime: Date.now(),
                    answers: {},
                    
                    initialize: function() {
                        this.setupBasicListeners();
                    },
                    
                    setupBasicListeners: function() {
                        // 基本的答题监听
                        document.addEventListener('change', (e) => {
                            if (e.target.name && (e.target.type === 'radio' || e.target.type === 'text')) {
                                this.answers[e.target.name] = e.target.value;
                            }
                        });
                        
                        // 监听提交按钮
                        const submitBtn = document.querySelector('button[onclick*="grade"]');
                        if (submitBtn) {
                            submitBtn.addEventListener('click', () => {
                                setTimeout(() => this.sendResults(), 200);
                            });
                        }
                    },
                    
                    sendResults: function() {
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'PRACTICE_COMPLETE',
                                data: {
                                    sessionId: this.sessionId,
                                    answers: this.answers,
                                    duration: Math.round((Date.now() - this.startTime) / 1000),
                                    source: 'inline_collector'
                                }
                            }, '*');
                        }
                    }
                };
                
                // 自动初始化
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        window.practiceDataCollector.initialize();
                    });
                } else {
                    window.practiceDataCollector.initialize();
                }
            `;

            examWindow.document.head.appendChild(inlineScript);

            // 初始化会话
            setTimeout(() => {
                this.initializePracticeSession(examWindow, examId);
            }, 300);

        } catch (error) {
            console.error('[DataInjection] 内联脚本注入失败:', error);
            this.handleInjectionError(examId, error);
        }
    }

    /**
     * 初始化练习会话
     */
    initializePracticeSession(examWindow, examId) {
        try {
            const sessionId = `${examId}_${Date.now()}`;

            // 发送会话初始化消息
            examWindow.postMessage({
                type: 'INIT_SESSION',
                data: {
                    sessionId: sessionId,
                    examId: examId,
                    parentOrigin: window.location.origin,
                    timestamp: Date.now()
                }
            }, '*');


            // 存储会话信息
            if (!this.examWindows) {
                this.examWindows = new Map();
            }

            if (this.examWindows.has(examId)) {
                const windowInfo = this.examWindows.get(examId);
                windowInfo.sessionId = sessionId;
                windowInfo.initTime = Date.now();
                this.examWindows.set(examId, windowInfo);
            } else {
                console.warn('[DataInjection] 未找到窗口信息，创建新的');
                this.examWindows.set(examId, {
                    window: examWindow,
                    sessionId: sessionId,
                    initTime: Date.now(),
                    status: 'initialized'
                });
            }

        } catch (error) {
            console.error('[DataInjection] 会话初始化失败:', error);
        }
    }

    /**
     * 处理注入错误
     */
    async handleInjectionError(examId, error) {
        console.error('[DataInjection] 注入错误:', error);

        // 记录错误信息
        const errorInfo = {
            examId: examId,
            error: error.message,
            timestamp: Date.now(),
            type: 'script_injection_error'
        };

        // 保存错误日志到本地存储
        const errorLogs = await storage.get('injection_errors', []);
        errorLogs.push(errorInfo);
        if (errorLogs.length > 50) {
            errorLogs.splice(0, errorLogs.length - 50); // 保留最近50条错误
        }
        await storage.set('injection_errors', errorLogs);

        // 不显示错误给用户，静默处理
        console.warn('[DataInjection] 将使用模拟数据模式');
    }

    /**
     * 设置题目窗口管理
     */
    setupExamWindowManagement(examWindow, examId) {
        // 存储窗口引用
        if (!this.examWindows) {
            this.examWindows = new Map();
        }

        this.examWindows.set(examId, {
            window: examWindow,
            startTime: Date.now(),
            status: 'active'
        });

        // 监听窗口关闭事件
        const checkClosed = setInterval(() => {
            if (examWindow.closed) {
                clearInterval(checkClosed);
                this.handleExamWindowClosed(examId);
            }
        }, 1000);

        // 设置窗口通信
        this.setupExamWindowCommunication(examWindow, examId);

        // 启动与练习页的会话握手（file:// 下更可靠）
        try {
            this.startExamHandshake(examWindow, examId);
        } catch (e) {
            console.warn('[App] 启动握手失败:', e);
        }

        // 更新UI状态
        this.updateExamStatus(examId, 'in-progress');
    }

    /**
     * 设置题目窗口通信
     */
    setupExamWindowCommunication(examWindow, examId) {
        // 监听来自题目窗口的消息
        const messageHandler = async (event) => {
            // 验证消息数据格式
            if (!event.data || typeof event.data !== 'object') return;

            // 兼容处理：允许缺失来源标记的消息（旧页面可能未填充 source）

            // 验证窗口来源（如果可能的话）- 放宽验证条件
            if (event.source && examWindow && event.source !== examWindow) {
            }

            // 放宽消息源过滤，兼容 inline_collector 与 practice_page
            const src = (event.data && event.data.source) || '';
            if (src && src !== 'practice_page' && src !== 'inline_collector') {
                return; // 非预期来源的消息忽略
            }

            const { type, data } = event.data || {};

            switch (type) {
                case 'exam_completed':
                    this.handleExamCompleted(examId, data);
                    break;
                case 'exam_progress':
                    this.handleExamProgress(examId, data);
                    break;
                case 'exam_error':
                    this.handleExamError(examId, data);
                    break;
                // 新增：处理数据采集器的消息
                case 'SESSION_READY':
                    this.handleSessionReady(examId, data);
                    break;
                case 'PROGRESS_UPDATE':
                    this.handleProgressUpdate(examId, data);
                    break;
                case 'PRACTICE_COMPLETE':
                    await this.handlePracticeComplete(examId, data);
                    break;
                case 'ERROR_OCCURRED':
                    this.handleDataCollectionError(examId, data);
                    break;
                default:
            }
        };

        window.addEventListener('message', messageHandler);

        // 存储消息处理器以便清理
        if (!this.messageHandlers) {
            this.messageHandlers = new Map();
        }
        this.messageHandlers.set(examId, messageHandler);

        // 向题目窗口发送初始化消息（兼容 0.2 增强器监听的 INIT_SESSION）
        examWindow.addEventListener('load', () => {
            const initPayload = {
                examId: examId,
                parentOrigin: window.location.origin,
                sessionId: this.generateSessionId()
            };
            try {
                // 首选 0.2 的大写事件名，保证 practicePageEnhancer 能收到并设置 sessionId
                examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
                // 同时发一份旧事件名，兼容历史实现
                examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
            } catch (e) {
                console.warn('[App] 发送初始化消息失败:', e);
            }
        });
    }

    /**
     * 与练习页建立握手（重复发送 INIT_SESSION，直到收到 SESSION_READY）
     */
    startExamHandshake(examWindow, examId) {
        if (!this._handshakeTimers) this._handshakeTimers = new Map();

        // 避免重复握手
        if (this._handshakeTimers.has(examId)) return;

        const initPayload = {
            examId,
            parentOrigin: window.location.origin,
            sessionId: this.generateSessionId()
        };

        let attempts = 0;
        const maxAttempts = 30; // ~9s
        const tick = () => {
            if (examWindow && !examWindow.closed) {
                try {
                    // 直接发送两种事件名，确保增强器任何实现都能收到
                    if (attempts === 0) {
                    }
                    examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
                    examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
                } catch (_) { /* 忽略 */ }
            }
            attempts++;
            if (attempts >= maxAttempts) {
                clearInterval(timer);
                this._handshakeTimers.delete(examId);
                console.warn('[App] 握手超时，练习页可能未加载增强器');
            }
        };
        const timer = setInterval(tick, 300);
        this._handshakeTimers.set(examId, timer);
        // 立即发送一次
        tick();
    }

    /**
     * 创建降级记录器
     */
    createFallbackRecorder() {
        return {
            handleRealPracticeData: async (examId, realData) => {
                try {
                    // 获取题目信息
                    const examIndex = await storage.get('exam_index', []);
                    const exam = examIndex.find(e => e.id === examId);

                    if (!exam) {
                        console.error('[FallbackRecorder] 无法找到题目信息:', examId);
                        return null;
                    }

                    // 创建练习记录
                    const practiceRecord = this.createSimplePracticeRecord(exam, realData);

                    // 直接保存到localStorage
                    const records = await storage.get('practice_records', []);
                    records.unshift(practiceRecord);

                    if (records.length > 1000) {
                        records.splice(1000);
                    }

                    await storage.set('practice_records', records);

                    return practiceRecord;
                } catch (error) {
                    console.error('[FallbackRecorder] 保存失败:', error);
                    return null;
                }
            },

            startSession: (examId) => {
                // 简单的会话管理
                return {
                    examId: examId,
                    startTime: new Date().toISOString(),
                    sessionId: this.generateSessionId(),
                    status: 'started'
                };
            },

            getPracticeRecords: async (filters = {}) => {
                try {
                    const records = await storage.get('practice_records', []);
                    
                    if (Object.keys(filters).length === 0) {
                        return records;
                    }
                    
                    return records.filter(record => {
                        if (filters.examId && record.examId !== filters.examId) return false;
                        if (filters.category && record.category !== filters.category) return false;
                        if (filters.startDate && new Date(record.startTime) < new Date(filters.startDate)) return false;
                        if (filters.endDate && new Date(record.startTime) > new Date(filters.endDate)) return false;
                        if (filters.minAccuracy && record.accuracy < filters.minAccuracy) return false;
                        if (filters.maxAccuracy && record.accuracy > filters.maxAccuracy) return false;
                        
                        return true;
                    });
                } catch (error) {
                    console.error('[FallbackRecorder] 获取记录失败:', error);
                    return [];
                }
            }
        };
    }

    // ExamBrowser组件已移除，使用内置的题目列表功能

    /**
     * 格式化时长
     */
    formatDuration(seconds) {
        if (seconds < 60) {
            return `${seconds}秒`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return remainingSeconds > 0 ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
        }
    }

    /**
     * 格式化日期
     */
    formatDate(dateString, format = 'YYYY-MM-DD HH:mm') {
        const date = new Date(dateString);
        if (format === 'HH:mm') {
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleString('zh-CN');
    }

    /**
     * 检查是否为移动设备
     */
    isMobile() {
        return window.innerWidth <= 768;
    }

    /**
     * 创建简单的练习记录
     */
    createSimplePracticeRecord(exam, realData) {
        const now = new Date();
        const recordId = `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 提取分数信息
        const scoreInfo = realData.scoreInfo || {};
        const score = scoreInfo.correct || 0;
        const totalQuestions = scoreInfo.total || Object.keys(realData.answers || {}).length;
        const accuracy = scoreInfo.accuracy || (totalQuestions > 0 ? score / totalQuestions : 0);

        return {
            id: recordId,
            examId: exam.id,
            title: exam.title,
            category: exam.category,
            frequency: exam.frequency,

            // 真实数据标识
            dataSource: 'real',
            isRealData: true,

            // 基本信息
            startTime: realData.startTime ? new Date(realData.startTime).toISOString() :
                new Date(Date.now() - realData.duration * 1000).toISOString(),
            endTime: realData.endTime ? new Date(realData.endTime).toISOString() : now.toISOString(),
            date: now.toISOString(),

            // 成绩数据
            score: score,
            totalQuestions: totalQuestions,
            accuracy: accuracy,
            percentage: Math.round(accuracy * 100),
            duration: realData.duration, // 秒

            // 详细数据
            realData: {
                sessionId: realData.sessionId,
                answers: realData.answers || {},
                interactions: realData.interactions || [],
                scoreInfo: scoreInfo,
                pageType: realData.pageType,
                url: realData.url,
                source: scoreInfo.source || 'fallback_recorder'
            }
        };
    }

    /**
     * 生成会话ID
     */
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 开始练习会话
     */
    async startPracticeSession(examId) {
        let examIndex = await storage.get('exam_index', []);
        if (!Array.isArray(examIndex)) {
            console.warn('[App] examIndex不是数组，回退到 window.examIndex');
            examIndex = Array.isArray(window.examIndex) ? window.examIndex : [];
        }
        const exam = examIndex.find(e => e.id === examId);

        if (!exam) {
            console.error('Exam not found:', examId);
            return;
        }

        try {
            // 优先使用新的练习页面管理器
            if (window.practicePageManager) {
                const sessionId = await window.practicePageManager.startPracticeSession(examId, exam);
                
                // 更新题目状态
                this.updateExamStatus(examId, 'in-progress');
                return sessionId;
            }
            
            // 使用练习记录器开始会话
            if (this.components.practiceRecorder) {
                let sessionData;
                if (typeof this.components.practiceRecorder.startPracticeSession === 'function') {
                    sessionData = this.components.practiceRecorder.startPracticeSession(examId, exam);
                } else if (typeof this.components.practiceRecorder.startSession === 'function') {
                    sessionData = this.components.practiceRecorder.startSession(examId, exam);
                } else {
                    console.warn('[App] PracticeRecorder没有可用的启动方法');
                    sessionData = null;
                }
            } else {
                // 降级处理
                const sessionData = {
                    examId: examId,
                    startTime: new Date().toISOString(),
                    status: 'started',
                    sessionId: this.generateSessionId()
                };

                const activeSessions = await storage.get('active_sessions', []);
                activeSessions.push(sessionData);
                await storage.set('active_sessions', activeSessions);
            }

            // 更新题目状态
            this.updateExamStatus(examId, 'in-progress');
            
        } catch (error) {
            console.error('[App] 启动练习会话失败:', error);
            
            // 最终降级方案
            this.startPracticeSessionFallback(examId, exam);
        }
    }

    /**
     * 降级启动练习会话
     */
    async startPracticeSessionFallback(examId, exam) {
        
        const sessionData = {
            examId: examId,
            startTime: new Date().toISOString(),
            status: 'started',
            sessionId: this.generateSessionId()
        };

        const activeSessions = await storage.get('active_sessions', []);
        activeSessions.push(sessionData);
        await storage.set('active_sessions', activeSessions);
        
        // 更新题目状态
        this.updateExamStatus(examId, 'in-progress');
        
        // 尝试打开练习页面
        const practiceUrl = `templates/ielts-exam-template.html?examId=${examId}`;
        window.open(practiceUrl, `practice_${sessionData.sessionId}`, 'width=1200,height=800');
    }

    /**
     * 处理题目完成
     */
    handleExamCompleted(examId, resultData) {

        // 练习记录器会自动处理完成事件
        // 这里只需要更新UI状态
        this.updateExamStatus(examId, 'completed');

        // 显示完成通知
        this.showExamCompletionNotification(examId, resultData);

        // 清理会话
        this.cleanupExamSession(examId);
    }

    /**
     * 处理题目进度
     */
    handleExamProgress(examId, progressData) {

        // 更新进度显示
        this.updateExamProgress(examId, progressData);
    }

    /**
     * 处理题目错误
     */
    handleExamError(examId, errorData) {
        console.error('Exam error:', examId, errorData);

        window.showMessage(`题目出现错误: ${errorData.message || '未知错误'}`, 'error');

        // 清理会话
        this.cleanupExamSession(examId);
    }

    /**
     * 处理数据采集器会话就绪
     */
    handleSessionReady(examId, data) {

        // 更新会话状态
        if (this.examWindows && this.examWindows.has(examId)) {
            const windowInfo = this.examWindows.get(examId);
            windowInfo.dataCollectorReady = true;
            windowInfo.pageType = data.pageType;
            this.examWindows.set(examId, windowInfo);
        }

        // 停止握手重试
        try {
            if (this._handshakeTimers && this._handshakeTimers.has(examId)) {
                clearInterval(this._handshakeTimers.get(examId));
                this._handshakeTimers.delete(examId);
            }
        } catch (_) {}

        // 可以在这里发送额外的配置信息给数据采集器
        // 例如题目信息、特殊设置等
    }

    /**
     * 处理练习进度更新
     */
    handleProgressUpdate(examId, data) {

        // 更新UI中的进度显示
        this.updateRealTimeProgress(examId, data);

        // 保存进度到会话数据
        if (this.examWindows && this.examWindows.has(examId)) {
            const windowInfo = this.examWindows.get(examId);
            windowInfo.lastProgress = data;
            windowInfo.lastUpdate = Date.now();
            this.examWindows.set(examId, windowInfo);
        }
    }

    /**
     * 处理练习完成（真实数据）
     */
    async handlePracticeComplete(examId, data) {

        try {
            // 直接保存真实数据（采用旧版本的简单方式）
            await this.saveRealPracticeData(examId, data);

            // 刷新内存中的练习记录，确保无需手动刷新即可看到
            try {
                if (typeof window.syncPracticeRecords === 'function') {
                    window.syncPracticeRecords();
                } else if (window.storage) {
                    const latest = await window.storage.get('practice_records', []);
                    window.practiceRecords = latest;
                }
            } catch (syncErr) {
                console.warn('[DataCollection] 刷新练习记录失败（UI可能需要手动刷新）:', syncErr);
            }

            // 更新UI状态
            this.updateExamStatus(examId, 'completed');

            // 显示完成通知（使用真实数据）
            this.showRealCompletionNotification(examId, data);

            // 刷新练习记录显示
            if (typeof updatePracticeView === 'function') {
                updatePracticeView();
            }

        } catch (error) {
            console.error('[DataCollection] 处理练习完成数据失败:', error);
            // 即使出错也要显示通知
            window.showMessage('练习已完成，但数据保存可能有问题', 'warning');
        } finally {
            // 清理会话
            this.cleanupExamSession(examId);
        }
    }

    /**
     * 处理数据采集错误
     */
    async handleDataCollectionError(examId, data) {
        console.error('[DataCollection] 数据采集错误:', examId, data);

        // 记录错误但不中断用户体验
        const errorInfo = {
            examId: examId,
            error: data,
            timestamp: Date.now(),
            type: 'data_collection_error'
        };

        const errorLogs = await storage.get('collection_errors', []);
        errorLogs.push(errorInfo);
        if (errorLogs.length > 50) {
            errorLogs.splice(0, errorLogs.length - 50);
        }
        await storage.set('collection_errors', errorLogs);

        // 标记该会话使用模拟数据
        if (this.examWindows && this.examWindows.has(examId)) {
            const windowInfo = this.examWindows.get(examId);
            windowInfo.useSimulatedData = true;
            this.examWindows.set(examId, windowInfo);
        }
    }

    /**
     * 更新实时进度显示
     */
    updateRealTimeProgress(examId, progressData) {
        // 在UI中显示实时进度
        const examCards = document.querySelectorAll(`[data-exam-id="${examId}"]`);
        examCards.forEach(card => {
            let progressInfo = card.querySelector('.real-progress-info');
            if (!progressInfo) {
                progressInfo = document.createElement('div');
                progressInfo.className = 'real-progress-info';
                progressInfo.style.cssText = `
                    font-size: 12px;
                    color: #666;
                    margin-top: 5px;
                    padding: 3px 6px;
                    background: #f0f8ff;
                    border-radius: 3px;
                `;
                card.appendChild(progressInfo);
            }

            const { answeredQuestions, totalQuestions, elapsedTime } = progressData;
            const minutes = Math.floor(elapsedTime / 60);
            const seconds = elapsedTime % 60;

            progressInfo.textContent = `进度: ${answeredQuestions}/${totalQuestions} | 用时: ${minutes}:${seconds.toString().padStart(2, '0')}`;
        });
    }

    /**
     * 保存真实练习数据（采用旧版本的简单直接方式）
     */
    async saveRealPracticeData(examId, realData) {
        try {
            
            let examIndex = await storage.get('exam_index', []);
            const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
            const exam = list.find(e => e.id === examId);

            if (!exam) {
                console.error('[DataCollection] 无法找到题目信息:', examId);
                return;
            }

            // 构造练习记录（与旧版本完全相同的格式）
            const practiceRecord = {
                id: Date.now(),
                examId: examId,
                title: exam.title,
                category: exam.category,
                frequency: exam.frequency,

                // 真实数据
                realData: {
                   score: realData.scoreInfo?.correct || 0,
                   totalQuestions: realData.scoreInfo?.total || 0,
                   accuracy: realData.scoreInfo?.accuracy || 0,
                   percentage: realData.scoreInfo?.percentage || 0,
                   duration: realData.duration,
                   answers: realData.answers,
                   correctAnswers: realData.correctAnswers || {},
                   answerHistory: realData.answerHistory,
                   interactions: realData.interactions,
                   isRealData: true,
                   source: realData.scoreInfo?.source || 'unknown'
               },

                // 数据来源标识
                dataSource: 'real',

                date: new Date().toISOString(),
                sessionId: realData.sessionId,
                timestamp: Date.now()
            };

            // 兼容旧视图字段（便于总览系统统计与详情展示）
            try {
                const sInfo = realData && realData.scoreInfo ? realData.scoreInfo : {};
                const correct = typeof sInfo?.correct === 'number' ? sInfo.correct : 0;
                const total = typeof sInfo?.total === 'number' ? sInfo.total : (practiceRecord.realData?.totalQuestions || Object.keys(realData.answers || {}).length || 0);
                const acc = typeof sInfo?.accuracy === 'number' ? sInfo.accuracy : (total > 0 ? correct / total : 0);
                const pct = typeof sInfo?.percentage === 'number' ? sInfo.percentage : Math.round(acc * 100);

                practiceRecord.score = correct;
                practiceRecord.correctAnswers = correct; // 兼容练习记录视图所需字段
                practiceRecord.totalQuestions = total;
                practiceRecord.accuracy = acc;
                practiceRecord.percentage = pct;
                practiceRecord.answers = realData.answers || {};
                practiceRecord.startTime = new Date((realData.startTime ?? (Date.now() - (realData.duration || 0) * 1000))).toISOString();
                practiceRecord.endTime = new Date((realData.endTime ?? Date.now())).toISOString();

                // 填充详情，便于在练习记录详情中显示正确答案
                const comp = realData && realData.answerComparison ? realData.answerComparison : {};
                const details = {};
                Object.entries(comp).forEach(([qid, obj]) => {
                    details[qid] = {
                        userAnswer: obj && obj.userAnswer != null ? obj.userAnswer : '',
                        correctAnswer: obj && obj.correctAnswer != null ? obj.correctAnswer : '',
                        isCorrect: !!(obj && obj.isCorrect)
                    };
                });
                // 将详情放入 realData.scoreInfo，便于历史详情与Markdown导出读取
                if (!practiceRecord.realData) practiceRecord.realData = {};
                practiceRecord.realData.scoreInfo = {
                    correct: correct,
                    total: total,
                    accuracy: acc,
                    percentage: pct,
                    details: details
                };
                
                // 同时保留顶层一致性（仅用于展示，不作为详情读取来源）
                practiceRecord.scoreInfo = {
                    correct: correct,
                    total: total,
                    accuracy: acc,
                    percentage: pct,
                    details: details
                };
                
                // 将比较结构提升到顶层，便于兼容读取
                practiceRecord.answerComparison = comp;
            } catch (compatErr) {
                console.warn('[DataCollection] 兼容字段填充失败:', compatErr);
            }

            // 直接保存到localStorage（与旧版本完全相同的方式）
            let practiceRecords = await storage.get('practice_records', []);
            if (!Array.isArray(practiceRecords)) {
                // 迁移修复：历史上可能被错误压缩为对象，这里强制纠正为数组
                practiceRecords = [];
            }

            practiceRecords.unshift(practiceRecord);

            // 限制记录数量
            if (practiceRecords.length > 100) {
                practiceRecords.splice(100);
            }

            const saveResult = await storage.set('practice_records', practiceRecords);

            // 立即验证保存是否成功
            const verifyRecords = await storage.get('practice_records', []);
            const savedRecord = Array.isArray(verifyRecords)
                ? verifyRecords.find(r => r.id === practiceRecord.id)
                : undefined;
            
            if (savedRecord) {
            } else {
                console.error('[DataCollection] ✗ 保存验证失败，记录未找到');
            }

        } catch (error) {
            console.error('[DataCollection] 保存真实数据失败:', error);
        }
    }

    /**
     * 显示真实完成通知
     */
    async showRealCompletionNotification(examId, realData) {
        const examIndex = await storage.get('exam_index', []);
        const list = Array.isArray(examIndex) ? examIndex : [];
        const exam = list.find(e => e.id === examId);

        if (!exam) return;

        const scoreInfo = realData.scoreInfo;
        if (scoreInfo) {
            const accuracy = scoreInfo.percentage || Math.round((scoreInfo.accuracy || 0) * 100);
            const duration = Math.round(realData.duration / 60); // 转换为分钟

            let message = `练习完成！\n${exam.title}\n`;

            if (scoreInfo.correct !== undefined && scoreInfo.total !== undefined) {
                message += `得分: ${scoreInfo.correct}/${scoreInfo.total} (${accuracy}%)\n`;
            } else {
                message += `正确率: ${accuracy}%\n`;
            }

            message += `用时: ${duration} 分钟`;

            if (scoreInfo.source) {
                message += `\n数据来源: ${scoreInfo.source === 'page_extraction' ? '页面提取' : '自动计算'}`;
            }

            window.showMessage(message, 'success');
        } else {
            // 没有分数信息的情况
            const duration = Math.round(realData.duration / 60);
            window.showMessage(`练习完成！\n${exam.title}\n用时: ${duration} 分钟`, 'success');
        }
    }

    /**
     * 处理题目窗口关闭
     */
    handleExamWindowClosed(examId) {

        // 更新题目状态
        this.updateExamStatus(examId, 'interrupted');

        // 清理会话
        this.cleanupExamSession(examId);
    }

    /**
     * 更新题目状态
     */
    updateExamStatus(examId, status) {
        // 更新UI中的题目状态指示器
        const examCards = document.querySelectorAll(`[data-exam-id="${examId}"]`);
        examCards.forEach(card => {
            const statusIndicator = card.querySelector('.exam-status');
            if (statusIndicator) {
                statusIndicator.className = `exam-status ${status}`;
            }
        });

        // 触发状态更新事件
        document.dispatchEvent(new CustomEvent('examStatusChanged', {
            detail: { examId, status }
        }));
    }

    /**
     * 更新题目进度
     */
    updateExamProgress(examId, progressData) {
        // 这里可以在UI中显示进度信息
        const progressPercentage = Math.round((progressData.completed / progressData.total) * 100);

        // 更新进度显示
        const examCards = document.querySelectorAll(`[data-exam-id="${examId}"]`);
        examCards.forEach(card => {
            let progressBar = card.querySelector('.exam-progress-bar');
            if (!progressBar) {
                // 创建进度条
                progressBar = document.createElement('div');
                progressBar.className = 'exam-progress-bar';
                progressBar.innerHTML = `
                    <div class="progress-fill" style="width: 0%"></div>
                    <span class="progress-text">0%</span>
                `;
                card.appendChild(progressBar);
            }

            const progressFill = progressBar.querySelector('.progress-fill');
            const progressText = progressBar.querySelector('.progress-text');

            if (progressFill) {
                progressFill.style.width = `${progressPercentage}%`;
            }
            if (progressText) {
                progressText.textContent = `${progressPercentage}%`;
            }
        });
    }

    /**
     * 显示题目完成通知
     */
    async showExamCompletionNotification(examId, resultData) {
        const examIndex = await storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);

        if (!exam) return;

        const accuracy = Math.round((resultData.accuracy || 0) * 100);
        const message = `题目完成！\n${exam.title}\n正确率: ${accuracy}%`;

        window.showMessage(message, 'success');

        // 可以显示更详细的结果模态框
        this.showDetailedResults(examId, resultData);
    }

    /**
     * 显示详细结果
     */
    async showDetailedResults(examId, resultData) {
        const examIndex = await storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);

        if (!exam) return;

        const accuracy = Math.round((resultData.accuracy || 0) * 100);
        const duration = this.formatDuration(resultData.duration || 0);

        const resultContent = `
            <div class="exam-result-modal">
                <div class="result-header">
                    <h3>练习完成</h3>
                    <div class="result-score ${accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : 'needs-improvement'}">
                        ${accuracy}%
                    </div>
                </div>
                <div class="result-body">
                    <h4>${exam.title}</h4>
                    <div class="result-stats">
                        <div class="result-stat">
                            <span class="stat-label">正确率</span>
                            <span class="stat-value">${accuracy}%</span>
                        </div>
                        <div class="result-stat">
                            <span class="stat-label">用时</span>
                            <span class="stat-value">${duration}</span>
                        </div>
                        <div class="result-stat">
                            <span class="stat-label">题目数</span>
                            <span class="stat-value">${resultData.totalQuestions || exam.totalQuestions || 0}</span>
                        </div>
                        <div class="result-stat">
                            <span class="stat-label">正确数</span>
                            <span class="stat-value">${resultData.correctAnswers || 0}</span>
                        </div>
                    </div>
                    <div class="result-actions">
                        <button class="btn btn-primary" onclick="window.app.openExam('${examId}')">
                            再次练习
                        </button>
                        <button class="btn btn-secondary" onclick="window.app.navigateToView('analysis')">
                            查看分析
                        </button>
                        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 显示结果模态框
        // 模态框功能已移除(resultContent);
    }

    /**
     * 显示模态框
     */
    
    /**
     * 清理题目会话
     */
    async cleanupExamSession(examId) {
        // 清理窗口引用
        if (this.examWindows && this.examWindows.has(examId)) {
            this.examWindows.delete(examId);
        }

        // 清理消息处理器
        if (this.messageHandlers && this.messageHandlers.has(examId)) {
            const handler = this.messageHandlers.get(examId);
            window.removeEventListener('message', handler);
            this.messageHandlers.delete(examId);
        }

        // 清理活动会话
        const activeSessions = await storage.get('active_sessions', []);
        const updatedSessions = activeSessions.filter(session => session.examId !== examId);
        await storage.set('active_sessions', updatedSessions);
    }

    /**
     * 设置练习记录器事件监听
     */
    setupPracticeRecorderEvents() {
        // 监听练习完成事件
        document.addEventListener('practiceSessionCompleted', (event) => {
            const { examId, practiceRecord } = event.detail;

            // 更新UI
            this.updateExamStatus(examId, 'completed');
            this.refreshOverviewData();

            // 显示完成通知
            this.showPracticeCompletionNotification(examId, practiceRecord);
        });

        // 监听练习开始事件
        document.addEventListener('practiceSessionStarted', (event) => {
            const { examId } = event.detail;

            this.updateExamStatus(examId, 'in-progress');
        });

        // 监听练习进度事件
        document.addEventListener('practiceSessionProgress', (event) => {
            const { examId, progress } = event.detail;
            this.updateExamProgress(examId, progress);
        });

        // 监听练习错误事件
        document.addEventListener('practiceSessionError', (event) => {
            const { examId, error } = event.detail;
            console.error('Practice session error:', examId, error);

            this.updateExamStatus(examId, 'error');
            window.showMessage(`练习出现错误: ${error.message || '未知错误'}`, 'error');
        });

        // 监听练习结束事件
        document.addEventListener('practiceSessionEnded', (event) => {
            const { examId, reason } = event.detail;

            if (reason !== 'completed') {
                this.updateExamStatus(examId, 'interrupted');
            }
        });
    }

    /**
     * 显示练习完成通知
     */
    async showPracticeCompletionNotification(examId, practiceRecord) {
        const examIndex = await storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);

        if (!exam) return;

        const accuracy = Math.round((practiceRecord.accuracy || 0) * 100);
        const duration = this.formatDuration(practiceRecord.duration || 0);

        // 显示简单通知
        const message = `练习完成！\n${exam.title}\n正确率: ${accuracy}% | 用时: ${duration}`;
        window.showMessage(message, 'success');

        // 显示详细结果模态框
        setTimeout(() => {
            this.showDetailedPracticeResults(examId, practiceRecord);
        }, 1000);
    }

    /**
     * 显示详细练习结果
     */
    async showDetailedPracticeResults(examId, practiceRecord) {
        const examIndex = await storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);

        if (!exam) return;

        const accuracy = Math.round((practiceRecord.accuracy || 0) * 100);
        const duration = this.formatDuration(practiceRecord.duration || 0);

        const resultContent = `
            <div class="practice-result-modal">
                <div class="result-header">
                    <h3>练习完成</h3>
                    <div class="result-score ${accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : 'needs-improvement'}">
                        ${accuracy}%
                    </div>
                </div>
                <div class="result-body">
                    <h4>${exam.title}</h4>
                    <div class="result-stats">
                        <div class="result-stat">
                            <span class="stat-label">正确率</span>
                            <span class="stat-value">${accuracy}%</span>
                        </div>
                        <div class="result-stat">
                            <span class="stat-label">用时</span>
                            <span class="stat-value">${duration}</span>
                        </div>
                        <div class="result-stat">
                            <span class="stat-label">题目数</span>
                            <span class="stat-value">${practiceRecord.totalQuestions || 0}</span>
                        </div>
                        <div class="result-stat">
                            <span class="stat-label">正确数</span>
                            <span class="stat-value">${practiceRecord.correctAnswers || 0}</span>
                        </div>
                    </div>
                    ${practiceRecord.questionTypePerformance && Object.keys(practiceRecord.questionTypePerformance).length > 0 ? `
                        <div class="question-type-performance">
                            <h5>题型表现</h5>
                            <div class="type-performance-list">
                                ${Object.entries(practiceRecord.questionTypePerformance).map(([type, perf]) => `
                                    <div class="type-performance-item">
                                        <span class="type-name">${this.formatQuestionType(type)}</span>
                                        <span class="type-accuracy">${Math.round((perf.accuracy || 0) * 100)}%</span>
                                        <span class="type-count">(${perf.correct || 0}/${perf.total || 0})</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <div class="result-actions">
                        <button class="btn btn-primary" onclick="window.app.openExam('${examId}')">
                            再次练习
                        </button>
                        <button class="btn btn-secondary" onclick="window.app.navigateToView('practice')">
                            查看记录
                        </button>
                        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 模态框功能已移除(resultContent);
    }

    /**
     * 格式化题型名称
     */
    formatQuestionType(type) {
        const typeMap = {
            'heading-matching': '标题匹配',
            'true-false-not-given': '判断题',
            'yes-no-not-given': '是非题',
            'multiple-choice': '选择题',
            'matching-information': '信息匹配',
            'matching-people-ideas': '人物观点匹配',
            'summary-completion': '摘要填空',
            'sentence-completion': '句子填空',
            'short-answer': '简答题',
            'diagram-labelling': '图表标注',
            'flow-chart': '流程图',
            'table-completion': '表格填空'
        };
        return typeMap[type] || type;
    }

    /**
     * 显示题目详情
     */
    showExamDetails(examId) {
        if (this.components.examBrowser) {
            this.components.examBrowser.showExamDetails(examId);
        }
    }

    // createReturnNavigation 方法已删除

    /**
     * 显示活动会话指示器
     */
    
    /**
     * 显示活动会话详情
     */
    async showActiveSessionsDetails() {
        const activeSessions = await storage.get('active_sessions', []);
        const examIndex = await storage.get('exam_index', []);

        if (activeSessions.length === 0) {
            window.showMessage('当前没有活动的练习会话', 'info');
            return;
        }

        const sessionsContent = `
            <div class="active-sessions-modal">
                <div class="sessions-header">
                    <h3>活动练习会话 (${activeSessions.length})</h3>
                    <button class="close-sessions" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="sessions-body">
                    ${activeSessions.map(session => {
            const exam = examIndex.find(e => e.id === session.examId);
            const duration = Date.now() - new Date(session.startTime).getTime();

            return `
                            <div class="session-item">
                                <div class="session-info">
                                    <h4>${exam ? exam.title : '未知题目'}</h4>
                                    <div class="session-meta">
                                        <span>开始时间: ${this.formatDate(session.startTime, 'HH:mm')}</span>
                                        <span>已用时: ${this.formatDuration(Math.floor(duration / 1000))}</span>
                                    </div>
                                </div>
                                <div class="session-actions">
                                    <button class="btn btn-sm btn-primary" onclick="window.app.focusExamWindow('${session.examId}')">
                                        切换到窗口
                                    </button>
                                    <button class="btn btn-sm btn-secondary" onclick="window.app.closeExamSession('${session.examId}')">
                                        结束会话
                                    </button>
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
                <div class="sessions-footer">
                    <button class="btn btn-outline" onclick="window.app.closeAllExamSessions()">
                        结束所有会话
                    </button>
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                        关闭
                    </button>
                </div>
            </div>
        `;

        // 模态框功能已移除(sessionsContent);
    }

    /**
     * 聚焦到题目窗口
     */
    focusExamWindow(examId) {
        if (this.examWindows && this.examWindows.has(examId)) {
            const windowData = this.examWindows.get(examId);
            if (windowData.window && !windowData.window.closed) {
                windowData.window.focus();
                window.showMessage('已切换到题目窗口', 'info');
            } else {
                window.showMessage('题目窗口已关闭', 'warning');
                this.cleanupExamSession(examId);
            }
        } else {
            window.showMessage('找不到题目窗口', 'error');
        }
    }

    /**
     * 关闭题目会话
     */
    closeExamSession(examId) {
        if (this.examWindows && this.examWindows.has(examId)) {
            const windowData = this.examWindows.get(examId);
            if (windowData.window && !windowData.window.closed) {
                windowData.window.close();
            }
        }

        this.cleanupExamSession(examId);
                window.showMessage('会话已结束', 'info');
    }

    /**
     * 关闭所有题目会话
     */
    async closeAllExamSessions() {
        const activeSessions = await storage.get('active_sessions', []);

        activeSessions.forEach(session => {
            this.closeExamSession(session.examId);
        });

        // 关闭模态框
        const modal = document.querySelector('.modal-overlay');
        if (modal) {
            modal.remove();
        }

        window.showMessage('所有会话已结束', 'info');
    }

    /**
     * 开始会话监控
     */
    startSessionMonitoring() {
        // 禁用活动会话监控，以避免误判窗口关闭状态
        if (this.sessionMonitorInterval) {
            clearInterval(this.sessionMonitorInterval);
            this.sessionMonitorInterval = null;
        }
        return;
        // 每30秒检查一次活动会话
        this.sessionMonitorInterval = setInterval(() => {
                        this.cleanupClosedWindows();
        }, 30000);
    }

    
    /**
     * 清理已关闭的窗口
     */
    cleanupClosedWindows() {
        if (!this.examWindows) return;

        const closedExamIds = [];

        this.examWindows.forEach((windowData, examId) => {
            if (windowData.window.closed) {
                closedExamIds.push(examId);
            }
        });

        closedExamIds.forEach(examId => {
            this.handleExamWindowClosed(examId);
        });
    }

    /**
     * 刷新总览数据
     */
    refreshOverviewData() {
        this.updateOverviewStats();
    }

    /**
     * 更新简单的练习记录视图
     */
    
    
    
    /**
     * 处理窗口大小变化
     */
    handleResize() {
        // 响应式调整逻辑
        if (this.isMobile()) {
            document.body.classList.add('mobile');
        } else {
            document.body.classList.remove('mobile');
        }
    }

    /**
     * 刷新数据
     */
    async refreshData() {
        try {
            await this.loadInitialData();
            this.onViewActivated(this.currentView);
        } catch (error) {
            console.error('Failed to refresh data:', error);
        }
    }

    /**
     * 显示/隐藏加载状态
     */
    showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) {
            if (typeof window.DOM !== 'undefined') {
                if (show) {
                    window.DOM.show(loading, 'flex');
                } else {
                    window.DOM.hide(loading);
                }
            } else {
                loading.style.display = show ? 'flex' : 'none';
            }
        }
    }

    /**
     * 显示降级UI
     */
    showFallbackUI(canRecover = false) {
        const app = document.getElementById('app');
        if (app) {
            const recoveryOptions = canRecover ? `
                <div class="recovery-options">
                    <h3>恢复选项</h3>
                    <button onclick="window.app.attemptRecovery()" class="btn btn-secondary">
                        尝试恢复
                    </button>
                    <button onclick="window.app.enterSafeMode()" class="btn btn-outline">
                        安全模式
                    </button>
                </div>
            ` : '';

            app.innerHTML = `
                <div class="fallback-ui">
                    <div class="container">
                        <div class="fallback-header">
                            <h1>⚠️ 系统初始化失败</h1>
                            <p class="fallback-description">
                                抱歉，IELTS考试系统无法正常启动。这可能是由于网络问题、浏览器兼容性或系统资源不足导致的。
                            </p>
                        </div>
                        
                        <div class="fallback-solutions">
                            <h3>建议解决方案</h3>
                            <ul class="solution-list">
                                <li>🔄 刷新页面重新加载系统</li>
                                <li>🧹 清除浏览器缓存和Cookie</li>
                                <li>🌐 检查网络连接是否正常</li>
                                <li>🔧 使用Chrome、Firefox或Edge等现代浏览器</li>
                                <li>💾 确保有足够的系统内存</li>
                            </ul>
                        </div>
                        
                        ${recoveryOptions}
                        
                        <div class="fallback-actions">
                            <button onclick="window.location.reload()" class="btn btn-primary">
                                🔄 刷新页面
                            </button>
                            <button onclick="alert('系统信息功能已移除')" class="btn btn-outline">
                                📊 系统信息
                            </button>
                        </div>
                        
                        <div class="fallback-footer">
                            <p>如果问题持续存在，请联系技术支持并提供系统信息。</p>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    /**
     * 尝试系统恢复
     */
    attemptRecovery() {
        this.showUserMessage('正在尝试恢复系统...', 'info');

        // 重置组件状态
        this.components = {};
        this.isInitialized = false;

        // 清理可能的错误状态
        if (this.globalErrors) {
            this.globalErrors = [];
        }

        // 重新初始化
        setTimeout(() => {
            this.initialize();
        }, 1000);
    }

    /**
     * 进入安全模式
     */
    enterSafeMode() {
        this.showUserMessage('正在启动安全模式...', 'info');

        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = `
                <div class="safe-mode-ui">
                    <div class="container">
                        <h1>🛡️ 安全模式</h1>
                        <p>系统正在安全模式下运行，部分功能可能不可用。</p>
                        
                        <div class="safe-mode-features">
                            <h3>可用功能</h3>
                            <ul>
                                <li>基本题库浏览</li>
                                <li>简单练习记录</li>
                                <li>系统诊断</li>
                            </ul>
                        </div>
                        
                        <div class="safe-mode-actions">
                            <button onclick="window.app.initialize()" class="btn btn-primary">
                                尝试完整启动
                            </button>
                            <button onclick="window.location.reload()" class="btn btn-secondary">
                                重新加载
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    
    /**
     * 销毁应用
     */
    destroy() {
        // 持久化当前状态
        this.persistMultipleState({
            'exam.index': 'exam_index',
            'practice.records': 'practice_records',
            'ui.browseFilter': 'browse_filter',
            'exam.currentCategory': 'current_category',
            'exam.currentExamType': 'current_exam_type'
        });

        // 清理事件监听器
        window.removeEventListener('resize', this.handleResize);

        // 清理会话监控
        if (this.sessionMonitorInterval) {
            clearInterval(this.sessionMonitorInterval);
        }

        // 关闭所有题目窗口
        if (this.examWindows) {
            this.examWindows.forEach((windowData, examId) => {
                if (windowData.window && !windowData.window.closed) {
                    windowData.window.close();
                }
                this.cleanupExamSession(examId);
            });
        }

        // 清理状态中的集合和Map
        if (this.state.practice.selectedRecords) {
            this.state.practice.selectedRecords.clear();
        }
        if (this.state.system.processedSessions) {
            this.state.system.processedSessions.clear();
        }
        if (this.state.system.fallbackExamSessions) {
            this.state.system.fallbackExamSessions.clear();
        }

        // 销毁组件
        Object.values(this.components).forEach(component => {
            if (component && typeof component.destroy === 'function') {
                component.destroy();
            }
        });

        this.isInitialized = false;
    }

}

// 新增修复3E：在js/app.js的DOMContentLoaded初始化中去除顶层await
// 应用启动
document.addEventListener('DOMContentLoaded', () => {
    try {
        (function(){ try { window.app = new ExamSystemApp(); window.app.initialize(); } catch(e) { console.error('[App] 初始化失败:', e); } })();
    } catch (error) {
        console.error('Failed to start application:', error);
        if (window.handleError) {
            window.handleError(error, 'Application Startup');
        } else {
            // Fallback: non-blocking user message if error handler is unavailable
            try {
                const container = document.getElementById('message-container');
                if (container) {
                    const msg = document.createElement('div');
                    msg.className = 'message error';
                    msg.textContent = '系统启动失败，请检查控制台日志。';
                    container.appendChild(msg);
                }
            } catch (_) {
                // no-op
            }
        }
    }
});

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app.destroy();
    }
});

