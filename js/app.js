/**
 * App - 主应用程序入口
 *
 * 公共表面：
 * - App.stores: 应用存储管理 {AppStore, ExamStore, RecordStore}
 * - App.ui: UI 组件管理 {ExamBrowser, RecordViewer, SettingsPanel 等}
 * - App.events: 事件总线，用于所有内部通信 (基于 EventEmitter)
 * - App.initialize(): 初始化应用
 *
 * 所有全局通信通过 App.events 路由。兼容 file:// 协议。
 * 白名单全局：App, storage, EventEmitter (utils)。
 */
class App {
    constructor() {
        this.currentView = 'overview';
        this.components = {};
        this.stores = {};
        this.ui = {};
        this.isInitialized = false;
        this._messageListenerAttached = false;
        this._isRendering = false;
        this._loadedScripts = new Set(); // 跟踪已加载的脚本
        this._listeners = new Map(); // 监听器注册表
        this._intervals = new Set(); // 定时器注册表
        this._timeouts = new Set(); // 延时器注册表
        this.events = new EventEmitter(); // 单一事件中心，包装 globalEventBus

        // 绑定方法上下文
        this.handleResize = this.handleResize.bind(this);
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
            // 移除遗留初始化，统一到 App

            this.updateLoadingMessage('正在加载初始数据...');
            // 加载初始数据
            await this.loadInitialData();

            this.updateLoadingMessage('正在设置用户界面...');
            // 设置初始视图
            this.setupInitialView();

            // 返回导航已移除

            // 显示活动会话指示器
            this.showActiveSessionsIndicator();

            // 定期更新活动会话
            this.startSessionMonitoring();

            // 设置全局错误处理
            this.setupGlobalErrorHandling();

            this.isInitialized = true;
            this.showLoading(false);

            console.log('[App] IELTS考试系统初始化成功');
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
        // 使用 App 错误处理，如果可用
        if (this.handleGlobalError) {
            this.handleGlobalError(error, 'App Initialization');
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

        console.log('[App] 全局错误处理已设置');
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
        // 使用统一错误服务
        if (window.ErrorService) {
            window.ErrorService.showUser(message, type);
        } else if (window.showMessage) {
            // 回退到现有方法
            window.showMessage(message, type);
        } else {
            // 最终回退
            if (type === 'error') {
                console.error(`[App] ${type.toUpperCase()}: ${message}`);
            } else {
                alert(message);
            }
        }
    }

    /**
     * 初始化响应式功能
     */
    initializeResponsiveFeatures() {
        // 初始化响应式管理器
        // 通过 App.ui 管理 UI 组件
        if (window.ResponsiveManager) {
            this.ui.responsiveManager = new ResponsiveManager();
            console.log('Responsive manager initialized');
        }

        // 初始化触摸处理器
        if (window.TouchHandler) {
            this.ui.touchHandler = new TouchHandler();
            console.log('Touch handler initialized');
        }

        // 初始化主题管理器
        if (window.ThemeManager) {
            this.ui.themeManager = new ThemeManager();
            console.log('Theme manager initialized');
        }

        // 初始化键盘快捷键
        if (window.KeyboardShortcuts) {
            this.ui.keyboardShortcuts = new KeyboardShortcuts();
            console.log('Keyboard shortcuts initialized');
        }



        // 初始化教程系统
        if (window.TutorialSystem) {
            this.ui.tutorialSystem = new TutorialSystem();
            console.log('Tutorial system initialized');
        }

        // 初始化设置面板
        if (window.SettingsPanel) {
            this.ui.settingsPanel = new SettingsPanel();
            console.log('Settings panel initialized');
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
            console.log('[App] 开始加载核心组件...');
            await this.waitForComponents(coreComponents, 8000);
            await this.initializeCoreComponents();

            // 然后加载可选组件
            console.log('[App] 开始加载可选组件...');
            try {
                await this.waitForComponents(optionalComponents, 5000);
                await this.initializeOptionalComponents();
            } catch (error) {
                // 静默处理可选组件加载失败，直接初始化已加载的组件
                await this.initializeAvailableOptionalComponents();
            }

            console.log('[App] 组件初始化完成');

        } catch (error) {
            console.error('[App] 核心组件加载失败:', error);
            throw error;
        }
    }

    /**
     * 初始化核心组件
     */
    async initializeCoreComponents() {
        console.log('[App] 初始化核心组件...');

        // ExamBrowser现在是可选组件，不在核心初始化中处理
        console.log('[App] 核心组件初始化 - ExamBrowser将在可选组件阶段处理');

        // 初始化PracticeRecorder（必需，但有降级方案）
        // 通过 App.stores 和 App.components 管理
        if (window.PracticeRecorder) {
            try {
                this.stores.practiceRecorder = new PracticeRecorder();
                this.setupPracticeRecorderEvents();
                console.log('[App] PracticeRecorder初始化成功');
            } catch (error) {
                console.error('[App] PracticeRecorder初始化失败:', error);
                this.stores.practiceRecorder = this.createFallbackRecorder();
                console.log('[App] 使用降级版PracticeRecorder');
            }
        } else {
            console.warn('[App] PracticeRecorder类不可用，创建降级记录器');
            this.stores.practiceRecorder = this.createFallbackRecorder();
        }

        // 初始化 RecordStore
        if (window.RecordStore) {
            try {
                this.stores.recordStore = new window.RecordStore();
                await this.stores.recordStore.initialize();
                console.log('[App] RecordStore 初始化成功');
            } catch (error) {
                console.error('[App] RecordStore 初始化失败:', error);
                this.stores.recordStore = null;
            }
        } else {
            console.warn('[App] RecordStore 类不可用');
            this.stores.recordStore = null;
        }

        // Store 命名适配器 - 提供一致的访问方式 (Task 34)
        this.setupStoreAdapters();
    }

    /**
     * 设置 Store 命名适配器
     */
    setupStoreAdapters() {
        // 检查并初始化其他 Stores
        if (window.AppStore && !this.stores.app) {
            this.stores.app = new window.AppStore();
            console.log('[App] AppStore 初始化成功');
        }

        if (window.ExamStore && !this.stores.examStore) {
            this.stores.examStore = new window.ExamStore();
            console.log('[App] ExamStore 初始化成功');
        }

        // 创建命名适配器 - 支持新命名规范和向后兼容
        if (this.stores.examStore) {
            this.stores.exams = this.stores.examStore;

            // 开发模式下添加弃用日志
            if (location.hostname === 'localhost' || location.protocol === 'file:') {
                const originalExamStore = this.stores.examStore;
                this.stores.examStore = new Proxy(originalExamStore, {
                    get(target, prop) {
                        if (prop === 'deprecatedAccess') return true;
                        console.warn('[App] DEPRECATED: Using examStore - consider switching to stores.exams');
                        return target[prop];
                    }
                });
            }
        }

        if (this.stores.recordStore) {
            this.stores.records = this.stores.recordStore;

            // 开发模式下添加弃用日志
            if (location.hostname === 'localhost' || location.protocol === 'file:') {
                const originalRecordStore = this.stores.recordStore;
                this.stores.recordStore = new Proxy(originalRecordStore, {
                    get(target, prop) {
                        if (prop === 'deprecatedAccess') return true;
                        console.warn('[App] DEPRECATED: Using recordStore - consider switching to stores.records');
                        return target[prop];
                    }
                });
            }
        }

        if (this.stores.app) {
            // AppStore 本身就是标准命名
        }

        console.log('[App] Store adapters configured:', {
            exams: !!this.stores.exams,
            records: !!this.stores.records,
            app: !!this.stores.app,
            examStore: !!this.stores.examStore,
            recordStore: !!this.stores.recordStore
        });
    }

    /**
     * 初始化可选组件
     */
    async initializeOptionalComponents() {
        console.log('[App] 初始化可选组件...');

        const componentInitializers = [
            // ExamBrowser组件已移除，使用内置的题目列表功能
            // PracticeHistory组件已移除，使用简单的练习记录界面

            { name: 'RecommendationDisplay', init: () => new RecommendationDisplay() },
            {
                name: 'GoalSettings', init: () => {
                    const instance = new GoalSettings();
                    // 移除 window.goalSettings，使用 App.ui
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
                    container.style.display = 'none';
                    document.body.appendChild(container);
                    const instance = new DataManagementPanel(container);
                    // 移除 window.dataManagementPanel，使用 App.ui
                    return instance;
                }
            },
            {
                name: 'SystemMaintenancePanel', init: () => {
                    const container = document.createElement('div');
                    container.id = 'systemMaintenancePanel';
                    container.style.display = 'none';
                    document.body.appendChild(container);
                    const instance = new SystemMaintenancePanel(container);
                    // 移除 window.systemManagementPanel，使用 App.ui
                    return instance;
                }
            }
        ];

        for (const { name, init } of componentInitializers) {
            if (window[name]) {
                try {
                    const componentKey = name.charAt(0).toLowerCase() + name.slice(1);
                    this.components[componentKey] = init();
                    this.ui[componentKey] = init(); // 暴露到公共 UI
                    console.log(`[App] ${name}初始化成功`);
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
        console.log('[App] 初始化已加载的可选组件...');

        // 只初始化已经加载的组件
        const availableComponents = [
            // ExamBrowser已移除，使用内置的题目列表功能
            // PracticeHistory and ExamScanner were removed
        ].filter(name => window[name]);

        if (availableComponents.length > 0) {
            console.log(`[App] 发现可用组件: ${availableComponents.join(', ')}`);

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

        console.log(`[App] 等待组件加载: ${requiredClasses.join(', ')}`);

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
                console.log(`[App] 所有必需组件已加载 (用时: ${elapsed}ms)`);
                return true;
            }

            // 显示加载进度
            const loadedCount = loadingStatus.filter(s => s.isLoaded).length;
            const progress = Math.round((loadedCount / requiredClasses.length) * 100);

            if ((Date.now() - startTime) % 1000 < checkInterval) {
                console.log(`[App] 组件加载进度: ${progress}% (${loadedCount}/${requiredClasses.length})`);
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

        // 窗口大小变化
        let handleResizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(handleResizeTimeout);
            handleResizeTimeout = setTimeout(() => {
                this.handleResize();
            }, 250);
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

        // 设置单一消息路由器（防止重复监听）
        this.setupMessageRouter();
    }

    /**
     * 加载初始数据
     */
    async loadInitialData() {
        try {
            // ExamScanner已移除，题库索引由其他方式管理
            console.log('[App] 跳过ExamScanner扫描，使用现有题库索引');

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
        if (this._isRendering) return;
        this._isRendering = true;

        try {
            let examIndex = await storage.get('exam_index', []);
            if (!Array.isArray(examIndex)) {
                console.warn('[App] examIndex不是数组，回退到 window.examIndex');
                // 使用 App.stores 如果可用，否则 fallback
                examIndex = Array.isArray(this.stores.examStore?.examIndex) ? this.stores.examStore.examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
            }
            let practiceRecords = await storage.get('practice_records', []);

            // 确保practiceRecords是数组
            if (!Array.isArray(practiceRecords)) {
                console.warn('[App] practiceRecords不是数组，使用空数组替代');
                practiceRecords = this.stores.records?.records || this.stores.recordStore?.records || [];
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
        } finally {
            setTimeout(() => { this._isRendering = false; }, 0);
        }
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
        const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(this.stores.examStore?.examIndex) ? this.stores.examStore.examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []));

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
        if (typeof markFirstRenderStart === 'function') markFirstRenderStart();
        // 简化的URL参数获取，避免依赖Utils
        const urlParams = new URLSearchParams(window.location.search);
        const urlView = urlParams.get('view');
        const initialView = urlView || 'overview';

        // 初始化完成后立即调用导航到指定视图
        this.navigateToView(initialView);
        if (typeof markFirstRenderEnd === 'function') markFirstRenderEnd();
    }

    /**
     * 导航到指定视图
     */
    navigateToView(viewName) {
        if (this.currentView === viewName) return;

        if (this._isRendering) return;
        this._isRendering = true;

        try {
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
        } finally {
            setTimeout(() => { this._isRendering = false; }, 0);
        }
    }

    /**
     * 视图激活回调
     */
    onViewActivated(viewName) {
        if (this._isRendering) return;
        this._isRendering = true;

        try {
            // 触发事件，让 UI 组件 subscribe 并 render
            this.events.emit('viewActivated', { viewName });

            // 保留原有逻辑作为 fallback，但优先事件
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
                    // 使用简单的练习记录更新，不依赖复杂组件
                    this.updateSimplePracticeView();
                    break;
                case 'analysis':
                    this.loadAnalysisData();
                    break;
                case 'goals':
                    this.loadGoalsData();
                    break;
            }
        } finally {
            setTimeout(() => { this._isRendering = false; }, 0);
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
            this.showUserMessage(`${category} 分类暂无可用题目`, 'warning');
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
        // 动态加载按需脚本（Recorder for 练习记录, PDFHandler for PDF打开），兼容 file://
        if (typeof window.loadedScripts === 'undefined') {
            window.loadedScripts = new Set();
        }

        // 加载 PracticeRecorder 如果未加载
        if (!window.PracticeRecorder && !window.loadedScripts.has('practiceRecorder')) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'js/core/practiceRecorder.js';
                script.onload = () => {
                    window.loadedScripts.add('practiceRecorder');
                    resolve();
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        // 加载 PDFHandler 如果未加载
        if (!window.PDFHandler && !window.loadedScripts.has('PDFHandler')) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'js/components/PDFHandler.js';
                script.onload = () => {
                    window.loadedScripts.add('PDFHandler');
                    resolve();
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

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
            this.showUserMessage('题目不存在', 'error');
            return;
        }

        try {
            // 若无HTML，直接打开PDF
            if (exam.hasHtml === false) {
                const pdfUrl = (typeof this.buildResourcePath === 'function')
                    ? this.buildResourcePath(exam, 'pdf')
                    : ((exam.path || '').replace(/\\/g,'/').replace(/\/+\//g,'/') + (exam.pdfFilename || '') );
                const pdfWin = window.open(pdfUrl, `pdf_${exam.id}`, 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
                if (!pdfWin) throw new Error('无法打开PDF窗口，请检查弹窗设置');
                this.showUserMessage(`正在打开PDF: ${exam.title}`, 'info');
                return;
            }

            // 先构造URL并立即打开窗口（保持用户手势，避免被浏览器拦截）
            const examUrl = this.buildExamUrl(exam);
            const examWindow = this.openExamWindow(examUrl, exam);

            // 再进行会话记录与脚本注入
            await this.startPracticeSession(examId);
            this.injectDataCollectionScript(examWindow, examId);
            this.setupExamWindowManagement(examWindow, examId);

            this.showUserMessage(`正在打开题目: ${exam.title}`, 'info');

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
        if (typeof this.buildResourcePath === 'function') {
            return this.buildResourcePath(exam, 'html');
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
        console.log('[DataInjection] 开始注入数据采集脚本:', examId);

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
                    console.log('[DataInjection] 脚本已存在，发送初始化消息');
                    this.initializePracticeSession(examWindow, examId);
                    return;
                }

                console.log('[DataInjection] 开始加载脚本文件...');

                // 加载练习页面增强脚本
                // file:// 兼容：使用相对路径
                const enhancerScript = await fetch('./js/practice-page-enhancer.js').then(r => r.text()).catch(() => {
                    console.warn('[DataInjection] 无法加载增强脚本，使用内联');
                    return ''; // fallback to inline
                });
                console.log('[DataInjection] 增强脚本加载完成，开始注入...');

                // 注入练习页面增强脚本
                const enhancerScriptEl = doc.createElement('script');
                enhancerScriptEl.type = 'text/javascript';
                enhancerScriptEl.textContent = enhancerScript;
                doc.head.appendChild(enhancerScriptEl);

                console.log('[DataInjection] 练习页面增强脚本已注入');

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
                console.log('[DataInjection] 检测到跨域，无法注入脚本');
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
                        console.log('[InlineCollector] 简化版数据采集器已初始化');
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
            console.log('[DataInjection] 内联脚本已注入');

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
            console.log('[DataInjection] 初始化练习会话:', sessionId);

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

            console.log('[DataInjection] 会话初始化消息已发送:', sessionId);

            // 存储会话信息
            if (!this.examWindows) {
                this.examWindows = new Map();
            }

            if (this.examWindows.has(examId)) {
                const windowInfo = this.examWindows.get(examId);
                windowInfo.sessionId = sessionId;
                windowInfo.initTime = Date.now();
                this.examWindows.set(examId, windowInfo);
                console.log('[DataInjection] 会话信息已更新');
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
        // 类型守卫函数
        const isValidMessage = (msg) => msg && typeof msg === 'object' && msg.type && typeof msg.data === 'object';
        const isSessionReadyMsg = (msg) => msg.type === 'SESSION_READY' && msg.data && typeof msg.data.pageType === 'string' && typeof msg.data.timestamp === 'number';
        const isProgressUpdateMsg = (msg) => msg.type === 'PROGRESS_UPDATE' && msg.data && typeof msg.data.answeredQuestions === 'number' && typeof msg.data.totalQuestions === 'number' && typeof msg.data.elapsedTime === 'number';
        const isPracticeCompleteMsg = (msg) => msg.type === 'PRACTICE_COMPLETE' && msg.data && typeof msg.data.sessionId === 'string' && msg.data.answers && typeof msg.data.duration === 'number';
    
        // 监听来自题目窗口的消息
        const messageHandler = async (event) => {
            // 验证消息数据格式
            if (!isValidMessage(event.data)) {
                console.warn('[App] 无效消息格式:', event.data);
                return;
            }
    
            // 兼容处理：允许缺失来源标记的消息（旧页面可能未填充 source）
    
            // 验证窗口来源（如果可能的话）- 放宽验证条件
            if (event.source && examWindow && event.source !== examWindow) {
                console.log('[App] 消息来源窗口不匹配，但仍处理消息');
            }
    
            // 放宽消息源过滤，兼容 inline_collector 与 practice_page
            const src = (event.data && event.data.source) || '';
            if (src && src !== 'practice_page' && src !== 'inline_collector') {
                return; // 非预期来源的消息忽略
            }
    
            const { type, data } = event.data;
            console.log('[App] 收到练习页面消息:', type, data);
    
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
                    if (!isSessionReadyMsg(event.data)) {
                        console.warn('[App] SESSION_READY 消息验证失败');
                        return;
                    }
                    this.handleSessionReady(examId, data);
                    break;
                case 'PROGRESS_UPDATE':
                    if (!isProgressUpdateMsg(event.data)) {
                        console.warn('[App] PROGRESS_UPDATE 消息验证失败');
                        return;
                    }
                    this.handleProgressUpdate(examId, data);
                    break;
                case 'PRACTICE_COMPLETE':
                    if (!isPracticeCompleteMsg(event.data)) {
                        console.warn('[App] PRACTICE_COMPLETE 消息验证失败');
                        return;
                    }
                    await this.handlePracticeComplete(examId, data);
                    break;
                case 'ERROR_OCCURRED':
                    this.handleDataCollectionError(examId, data);
                    break;
                default:
                    console.log('[App] 未处理的消息类型:', type);
            }
        };

        // 向题目窗口发送初始化消息（兼容 0.2 增强器监听的 INIT_SESSION）
        examWindow.addEventListener('load', () => {
            const initPayload = {
                examId: examId,
                parentOrigin: window.location.origin,
                sessionId: this.generateSessionId()
            };
            try {
                // 首选 0.2 的大写事件名，保证 practicePageEnhancer 能收到并设置 sessionId
                console.log('[System] 发送初始化消息到练习页面:', { type: 'INIT_SESSION', data: {} });
                examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
                // 同时发一份旧事件名，兼容历史实现
                examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
            } catch (e) {
                console.warn('[App] 发送初始化消息失败:', e);
            }
        });
    }

    /**
     * 集中消息处理器 - 单一入口，避免重复绑定
     */
    async handleMessage(event) {
        // 类型守卫函数
        const isValidMessage = (msg) => msg && typeof msg === 'object' && msg.type && typeof msg.data === 'object';
        const isSessionReadyMsg = (msg) => msg.type === 'SESSION_READY' && msg.data && typeof msg.data.pageType === 'string' && typeof msg.data.timestamp === 'number';
        const isProgressUpdateMsg = (msg) => msg.type === 'PROGRESS_UPDATE' && msg.data && typeof msg.data.answeredQuestions === 'number' && typeof msg.data.totalQuestions === 'number' && typeof msg.data.elapsedTime === 'number';
        const isPracticeCompleteMsg = (msg) => msg.type === 'PRACTICE_COMPLETE' && msg.data && typeof msg.data.sessionId === 'string' && msg.data.answers && typeof msg.data.duration === 'number';

        // 验证消息数据格式
        if (!isValidMessage(event.data)) {
            console.warn('[App] 无效消息格式:', event.data);
            return;
        }

        // 查找消息来源对应的 examId
        let targetExamId = null;
        let targetWindowData = null;
        if (this.examWindows) {
            for (const [examId, windowData] of this.examWindows.entries()) {
                if (event.source === windowData.window) {
                    targetExamId = examId;
                    targetWindowData = windowData;
                    break;
                }
            }
        }

        if (!targetExamId || !targetWindowData) {
            console.warn('[App] 未知消息来源');
            return;
        }

        const examWindow = targetWindowData.window;

        // 兼容处理：允许缺失来源标记的消息（旧页面可能未填充 source）

        // 验证窗口来源（如果可能的话）- 放宽验证条件
        if (event.source && examWindow && event.source !== examWindow) {
            console.log('[App] 消息来源窗口不匹配，但仍处理消息');
        }

        // 放宽消息源过滤，兼容 inline_collector 与 practice_page
        const src = (event.data && event.data.source) || '';
        if (src && src !== 'practice_page' && src !== 'inline_collector') {
            return; // 非预期来源的消息忽略
        }

        const { type, data } = event.data;
        console.log('[App] 收到练习页面消息:', type, data);

        switch (type) {
            case 'exam_completed':
                this.handleExamCompleted(targetExamId, data);
                break;
            case 'exam_progress':
                this.handleExamProgress(targetExamId, data);
                break;
            case 'exam_error':
                this.handleExamError(targetExamId, data);
                break;
            // 新增：处理数据采集器的消息
            case 'SESSION_READY':
                if (!isSessionReadyMsg(event.data)) {
                    console.warn('[App] SESSION_READY 消息验证失败');
                    return;
                }
                this.handleSessionReady(targetExamId, data);
                break;
            case 'PROGRESS_UPDATE':
                if (!isProgressUpdateMsg(event.data)) {
                    console.warn('[App] PROGRESS_UPDATE 消息验证失败');
                    return;
                }
                this.handleProgressUpdate(targetExamId, data);
                break;
            case 'PRACTICE_COMPLETE':
                if (!isPracticeCompleteMsg(event.data)) {
                    console.warn('[App] PRACTICE_COMPLETE 消息验证失败');
                    return;
                }
                await this.handlePracticeComplete(targetExamId, data);
                break;
            case 'ERROR_OCCURRED':
                this.handleDataCollectionError(targetExamId, data);
                break;
            default:
                console.log('[App] 未处理的消息类型:', type);
        }
    }

    /**
     * 与练习页建立握手（重复发送 INIT_SESSION，直到收到 SESSION_READY）
     */
    // 重试机制：指数退避，最大5次尝试
    async retrySendInit(examWindow, initPayload, examId, attempt = 1, maxAttempts = 5) {
        const baseDelay = 500 * Math.pow(2, attempt - 1); // 500ms, 1s, 2s, 4s, 8s
        const delay = Math.min(baseDelay, 8000); // 最大8s

        try {
            examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
            examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
            console.log(`[App] 发送 INIT_SESSION 尝试 ${attempt}/${maxAttempts}`);
        } catch (e) {
            console.warn(`[App] 发送 INIT_SESSION 失败 (尝试 ${attempt}):`, e);
        }

        // 如果未收到 SESSION_READY，在延迟后重试
        await new Promise(resolve => setTimeout(resolve, delay));

        // 检查是否收到 SESSION_READY
        if (this.examWindows && this.examWindows.has(examId) && this.examWindows.get(examId).dataCollectorReady) {
            console.log('[App] SESSION_READY 已收到，重试成功');
            return true;
        }

        if (attempt < maxAttempts) {
            return this.retrySendInit(examWindow, initPayload, examId, attempt + 1, maxAttempts);
        } else {
            // 失败报告
            if (window.AppStore) {
                window.AppStore.addError({
                    message: 'SESSION_READY 丢失，重试失败',
                    context: `Handshake for examId: ${examId}`,
                    recoverable: true,
                    userMessage: '练习页面通信初始化失败，请刷新重试',
                    actions: ['刷新页面', '检查弹窗设置']
                });
            }
            console.error('[App] SESSION_READY 重试失败，进入降级模式');
            return false;
        }
    }

    startExamHandshake(examWindow, examId) {
        if (!this._handshakeTimers) this._handshakeTimers = new Map();

        // 避免重复握手
        if (this._handshakeTimers.has(examId)) return;

        const initPayload = {
            examId,
            parentOrigin: window.location.origin,
            sessionId: this.generateSessionId()
        };

        // 初始发送
        try {
            examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
            examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
            console.log('[System] 发送初始化消息到练习页面:', { type: 'INIT_SESSION', data: {} });
        } catch (_) { /* 忽略 */ }

        // 启动重试
        setTimeout(() => {
            this.retrySendInit(examWindow, initPayload, examId);
        }, 1000); // 1s 后开始重试检查

        // 旧定时器用于基本心跳
        let attempts = 0;
        const maxAttempts = 30;
        const tick = () => {
            if (examWindow.closed) {
                clearInterval(timer);
                this._handshakeTimers.delete(examId);
                return;
            }
            attempts++;
            if (attempts >= maxAttempts) {
                clearInterval(timer);
                this._handshakeTimers.delete(examId);
            }
        };
        const timer = setInterval(tick, 300);
        this._handshakeTimers.set(examId, timer);
    }

    /**
     * 创建降级记录器
     */
    createFallbackRecorder() {
        return {
            handleRealPracticeData: async (examId, realData) => {
                console.log('[FallbackRecorder] 处理真实练习数据:', examId, realData);
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
                    console.log('[FallbackRecorder] 记录已保存:', practiceRecord.id);

                    return practiceRecord;
                } catch (error) {
                    console.error('[FallbackRecorder] 保存失败:', error);
                    return null;
                }
            },

            startSession: (examId) => {
                console.log('[FallbackRecorder] 启动会话:', examId);
                // 简单的会话管理
                return {
                    examId: examId,
                    startTime: new Date().toISOString(),
                    sessionId: this.generateSessionId(),
                    status: 'started'
                };
            },

            getPracticeRecords: async (filters = {}) => {
                console.log('[FallbackRecorder] 获取练习记录');
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
            // 通过 App.stores 管理
            if (this.stores.practicePageManager) {
                console.log('[App] 使用练习页面管理器启动会话');
                const sessionId = await this.stores.practicePageManager.startPracticeSession(examId, exam);
                console.log('[App] 练习会话已启动:', sessionId);
                
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
                console.log('[App] 练习会话已通过记录器启动:', sessionData);
            } else {
                // 降级处理
                console.log('[App] 使用降级会话管理');
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
        console.log('[App] 使用最终降级方案启动练习');
        
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
        console.log('Exam completed:', examId, resultData);

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
        console.log('Exam progress:', examId, progressData);

        // 更新进度显示
        this.updateExamProgress(examId, progressData);
    }

    /**
     * 处理题目错误
     */
    handleExamError(examId, errorData) {
        console.error('Exam error:', examId, errorData);

        this.showUserMessage(`题目出现错误: ${errorData.message || '未知错误'}`, 'error');

        // 清理会话
        this.cleanupExamSession(examId);
    }

    /**
     * 处理数据采集器会话就绪
     */
    handleSessionReady(examId, data) {
        console.log('[DataCollection] 会话就绪:', examId, data);

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
        console.log('[DataCollection] 进度更新:', examId, data);

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
        console.log('[DataCollection] 练习完成（真实数据）:', examId, data);
        console.log('[DataCollection] PracticeRecorder状态:', !!this.components.practiceRecorder);

        try {
            // 直接保存真实数据（采用旧版本的简单方式）
            console.log('[DataCollection] 直接保存真实数据');
            await this.saveRealPracticeData(examId, data);

            // 刷新内存中的练习记录，确保无需手动刷新即可看到
            try {
                // 通过 App.stores 同步
                const recordStore = this.stores.records || this.stores.recordStore;
                if (recordStore && typeof recordStore.sync === 'function') {
                    await recordStore.sync();
                } else if (window.storage) {
                    const latest = await window.storage.get('practice_records', []);
                    if (recordStore) {
                        recordStore.records = latest;
                    }
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
            this.showUserMessage('练习已完成，但数据保存可能有问题', 'warning');
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
            console.log('[DataCollection] 开始保存真实练习数据:', examId, realData);
            
            let examIndex = await storage.get('exam_index', []);
            const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(this.stores.examStore?.examIndex) ? this.stores.examStore.examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []));
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

            // 使用 RecordStore 保存，支持去重
            const recordStore = this.stores.records || this.stores.recordStore;
            if (recordStore) {
                const savedRecord = await recordStore.saveRecord(practiceRecord);
                if (savedRecord) {
                    console.log('[DataCollection] ✓ 真实练习数据保存成功:', savedRecord.id);
                } else {
                    console.warn('[DataCollection] 记录被去重忽略');
                }

                // 立即验证
                await recordStore.loadRecords();
                const verifyRecords = recordStore.records;
                const verifySavedRecord = verifyRecords.find(r => r.id === practiceRecord.id);
                if (verifySavedRecord) {
                    console.log('[DataCollection] ✓ 验证成功，当前总记录数:', verifyRecords.length);
                } else {
                    console.error('[DataCollection] ✗ 保存验证失败，记录未找到');
                }
            } else {
                // 降级：直接保存
                let practiceRecords = await storage.get('practice_records', []);
                if (!Array.isArray(practiceRecords)) {
                    practiceRecords = [];
                }
                practiceRecords.unshift(practiceRecord);
                if (practiceRecords.length > 100) {
                    practiceRecords.splice(100);
                }
                await storage.set('practice_records', practiceRecords);
                console.log('[DataCollection] 降级保存成功');
            }

        } catch (error) {
            console.error('[DataCollection] 保存真实数据失败:', error);
        }
    }

    /**
     * 显示真实完成通知
     */
    async showRealCompletionNotification(examId, realData) {
        let examIndex = await storage.get('exam_index', []);
        const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(this.stores.examStore?.examIndex) ? this.stores.examStore.examIndex : []);
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
        console.log('Exam window closed:', examId);

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

        this.showUserMessage(message, 'success');

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
                        <button class="btn btn-primary" onclick="window.App.openExam('${examId}')">
                            再次练习
                        </button>
                        <button class="btn btn-secondary" onclick="window.App.navigateToView('analysis')">
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
        this.showModal(resultContent);
    }

    /**
     * 显示模态框
     */
    showModal(content) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay show';
        modalOverlay.innerHTML = `<div class="modal">${content}</div>`;

        document.body.appendChild(modalOverlay);

        // 点击背景关闭
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.remove();
            }
        });

        // ESC键关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modalOverlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    /**
     * 清理题目会话
     */
    async cleanupExamSession(examId) {
        // 清理窗口引用
        if (this.examWindows && this.examWindows.has(examId)) {
            this.examWindows.delete(examId);
        }

        // 消息处理器已集中管理，无需 per-session 清理

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
            console.log('Practice completed event received:', examId);

            // 更新UI
            this.updateExamStatus(examId, 'completed');
            this.refreshOverviewData();

            // 显示完成通知
            this.showPracticeCompletionNotification(examId, practiceRecord);
        });

        // 监听练习开始事件
        document.addEventListener('practiceSessionStarted', (event) => {
            const { examId } = event.detail;
            console.log('Practice started event received:', examId);

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
            console.log('Practice ended event received:', examId, reason);

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
        this.showUserMessage(message, 'success');

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
                        <button class="btn btn-primary" onclick="window.App.openExam('${examId}')">
                            再次练习
                        </button>
                        <button class="btn btn-secondary" onclick="window.App.navigateToView('practice')">
                            查看记录
                        </button>
                        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.showModal(resultContent);
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
        if (this.ui.examBrowser) {
            this.ui.examBrowser.showExamDetails(examId);
        }
    }

    // createReturnNavigation 方法已删除

    /**
     * 显示活动会话指示器
     */
    // 显示活动会话指示器（已禁用，无需统计活动会话）
    showActiveSessionsIndicator() {
        // 根据需求移除该功能，确保不显示“活动练习”浮动指示器
        const indicatorEl = document.querySelector('.active-sessions-indicator');
        if (indicatorEl) indicatorEl.remove();
        // 功能禁用，直接返回
        return;
    }

    /**
     * 隐藏活动会话指示器
     */
    hideActiveSessionsIndicator() {
        const indicator = document.querySelector('.active-sessions-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

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

        this.showModal(sessionsContent);
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
        this.showActiveSessionsIndicator();
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
            this.updateActiveSessionsIndicator();
            this.cleanupClosedWindows();
        }, 30000);
    }

    /**
     * 更新活动会话指示器
     */
    updateActiveSessionsIndicator() {
        // 已禁用活动会话显示
        const indicator = document.querySelector('.active-sessions-indicator');
        if (indicator) indicator.remove();
        return;
        this.showActiveSessionsIndicator();
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
    updateSimplePracticeView() {
        // This function is disabled because its logic has been moved to
        // updatePracticeView() in main.js to support virtual scrolling.
        // Leaving this empty prevents it from overwriting the virtual scroller DOM.
        console.log('[App] updateSimplePracticeView is disabled, functionality moved to main.js.');
        return;
    }

    /**
     * 更新简单的练习记录列表
     */
    updateSimplePracticeList(records) {
        const historyContainer = document.getElementById('practice-history-list');
        if (!historyContainer) return;
        
        if (records.length === 0) {
            historyContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; opacity: 0.7;">
                    <div style="font-size: 3em; margin-bottom: 15px;">📋</div>
                    <p>暂无练习记录</p>
                    <p style="font-size: 0.9em; margin-top: 10px;">开始练习后，记录将自动保存在这里</p>
                </div>
            `;
            return;
        }
        
        // 显示所有记录
        const recentRecords = records;
        
        historyContainer.innerHTML = recentRecords.map(record => {
            const accuracy = Math.round((record.accuracy || 0) * 100);
            const duration = Math.round((record.duration || 0) / 60); // 转换为分钟
            const date = new Date(record.startTime).toLocaleDateString();
            
            return `
                <div class="history-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <div>
                        <h4 style="margin: 0; color: white;">${record.title || record.examId}</h4>
                        <p style="margin: 5px 0 0 0; opacity: 0.8; font-size: 0.9em;">${date}</p>
                    </div>
                    <div style="text-align: right;">
                        <div style="color: ${accuracy >= 80 ? '#4ade80' : accuracy >= 60 ? '#fbbf24' : '#f87171'}; font-weight: bold;">${accuracy}%</div>
                        <div style="opacity: 0.8; font-size: 0.9em;">${duration}分钟</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * 加载练习记录
     */
    loadPracticeRecords() {
        // 练习记录页面逻辑
        console.log('Loading practice records...');
    }

    /**
     * 加载分析数据
     */
    loadAnalysisData() {
        // 分析页面逻辑
        console.log('Loading analysis data...');
    }

    /**
     * 加载目标数据
     */
    loadGoalsData() {
        // 刷新目标设置组件
        if (this.components.goalSettings) {
            this.components.goalSettings.refresh();
        }
        console.log('Goals data loaded');
    }

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
            loading.style.display = show ? 'flex' : 'none';
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
                    <button onclick="window.App.attemptRecovery()" class="btn btn-secondary">
                        尝试恢复
                    </button>
                    <button onclick="window.App.enterSafeMode()" class="btn btn-outline">
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
                            <button onclick="window.app.showSystemInfo()" class="btn btn-outline">
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
        console.log('[App] 尝试系统恢复...');
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
        console.log('[App] 进入安全模式...');
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
                            <button onclick="window.App.initialize()" class="btn btn-primary">
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
     * 显示系统信息
     */
    showSystemInfo() {
        const systemInfo = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine,
            screenResolution: `${screen.width}x${screen.height}`,
            windowSize: `${window.innerWidth}x${window.innerHeight}`,
            timestamp: new Date().toISOString(),
            errors: this.globalErrors || []
        };

        const infoWindow = window.open('', '_blank', 'width=600,height=400');
        infoWindow.document.write(`
            <html>
                <head><title>系统信息</title></head>
                <body style="font-family: monospace; padding: 20px;">
                    <h2>IELTS系统诊断信息</h2>
                    <pre>${JSON.stringify(systemInfo, null, 2)}</pre>
                    <button onclick="navigator.clipboard.writeText(document.querySelector('pre').textContent)">
                        复制到剪贴板
                    </button>
                </body>
            </html>
        `);
    }

    /**
     * 销毁应用
     */
    destroy() {
        // 通过 App.events 移除监听
        this.events.removeAllListeners();

        // 清理事件监听器
        window.removeEventListener('resize', this.handleResize);

        // 清理单一消息监听器
        if (this._messageListenerAttached) {
            window.removeEventListener('message', this.handleMessage);
            this._messageListenerAttached = false;
        }

        // 清理会话监控
        if (this.sessionMonitorInterval) {
            clearInterval(this.sessionMonitorInterval);
        }

        // 清理握手定时器 (Task 36)
        if (this._handshakeTimers) {
            this._handshakeTimers.forEach((timer, examId) => {
                clearTimeout(timer);
                console.log(`[App] Cleared handshake timer for exam: ${examId}`);
            });
            this._handshakeTimers.clear();
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

        // 销毁组件
        Object.values(this.components).forEach(component => {
            if (component && typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        Object.values(this.ui).forEach(component => {
            if (component && typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        Object.values(this.stores).forEach(store => {
            if (store && typeof store.destroy === 'function') {
                store.destroy();
            }
        });

        this.isInitialized = false;
    }

    /**
     * 验证练习消息 (Task 36)
     */
    validatePracticeMessage(data, type) {
        // 基本结构验证
        if (!data || typeof data !== 'object') {
            return { valid: false, reason: 'Invalid message structure' };
        }

        // 来源验证
        if (data.source !== 'practice_page') {
            return { valid: false, reason: 'Invalid source' };
        }

        // 类型特定验证
        switch (type) {
            case 'SESSION_READY':
                if (!data.sessionId || typeof data.sessionId !== 'string') {
                    return { valid: false, reason: 'Missing or invalid sessionId' };
                }
                if (!data.examId || typeof data.examId !== 'string') {
                    return { valid: false, reason: 'Missing or invalid examId' };
                }
                break;

            case 'PROGRESS_UPDATE':
                if (!data.sessionId || typeof data.sessionId !== 'string') {
                    return { valid: false, reason: 'Missing or invalid sessionId' };
                }
                if (!data.examId || typeof data.examId !== 'string') {
                    return { valid: false, reason: 'Missing or invalid examId' };
                }
                if (data.progress !== undefined && typeof data.progress !== 'number') {
                    return { valid: false, reason: 'Invalid progress value' };
                }
                break;

            case 'PRACTICE_COMPLETE':
                if (!data.sessionId || typeof data.sessionId !== 'string') {
                    return { valid: false, reason: 'Missing or invalid sessionId' };
                }
                if (!data.examId || typeof data.examId !== 'string') {
                    return { valid: false, reason: 'Missing or invalid examId' };
                }
                if (!data.duration || typeof data.duration !== 'number') {
                    return { valid: false, reason: 'Missing or invalid duration' };
                }
                if (!data.score || typeof data.score !== 'object') {
                    return { valid: false, reason: 'Missing or invalid score data' };
                }
                if (typeof data.score.percentage !== 'number') {
                    return { valid: false, reason: 'Invalid score percentage' };
                }
                break;

            case 'ERROR_OCCURRED':
                if (!data.error || typeof data.error !== 'object') {
                    return { valid: false, reason: 'Missing or invalid error data' };
                }
                break;

            default:
                return { valid: false, reason: `Unknown message type: ${type}` };
        }

        return { valid: true };
    }

    /**
     * 验证消息来源窗口
     */
    validateMessageSource(event, examId) {
        // 如果有 examWindows 映射，验证来源
        if (this.examWindows && this.examWindows.has(examId)) {
            const windowInfo = this.examWindows.get(examId);
            if (windowInfo.windowRef && event.source !== windowInfo.windowRef) {
                console.warn(`[App] Message source mismatch for exam ${examId}`);
                return false;
            }
        }

        // file:// 协议下的基本检查
        if (location.protocol === 'file:') {
            // 在 file:// 协议下，我们只能做基本检查
            return event.origin === 'null' || event.origin === location.origin;
        }

        // HTTP/HTTPS 协议下的严格检查
        try {
            const eventOrigin = new URL(event.origin);
            const currentOrigin = new URL(location.origin);

            // 允许相同域名下的消息
            if (eventOrigin.hostname === currentOrigin.hostname) {
                return true;
            }

            console.warn(`[App] Untrusted message origin: ${event.origin}`);
            return false;
        } catch (error) {
            console.warn('[App] Error validating message origin:', error);
            return false;
        }
    }

    /**
     * 设置单一消息路由器（防止重复监听）
     */
    setupMessageRouter() {
        // 只在父窗口（非练习窗口）中设置消息路由器 (Task 35)
        if (typeof window.isPracticeWindow === 'function' && window.isPracticeWindow()) {
            console.log('[App] Skipping message router setup - running in practice window');
            return;
        }

        if (this._messageListenerAttached) {
            console.warn('[App] Message listener already attached, skipping...');
            return;
        }

        this._messageListenerAttached = true;
        this._processedSessionIds = new Set();
        console.log('[App] Setting up message router for parent window');

        window.addEventListener('message', (event) => {
            try {
                // 基本结构验证
                if (!event.data || typeof event.data !== 'object') {
                    console.warn('[App] Invalid message structure:', event.data);
                    return;
                }

                const { type, data } = event.data;
                if (!type) {
                    console.warn('[App] Message missing type:', event.data);
                    return;
                }

                // 严格消息验证 (Task 36)
                const validation = this.validatePracticeMessage(event.data, type);
                if (!validation.valid) {
                    console.warn(`[App] Message validation failed: ${validation.reason}`, event.data);
                    return;
                }

                // 来源验证
                if (data.examId && !this.validateMessageSource(event, data.examId)) {
                    console.warn(`[App] Message source validation failed for exam ${data.examId}`);
                    return;
                }

                console.log(`[App] Received validated message: ${type}`);

                switch (type) {
                    case 'SESSION_READY':
                        this.handleSessionReady(event, data);
                        break;
                    case 'PROGRESS_UPDATE':
                        this.handleProgressUpdate(event, data);
                        break;
                    case 'PRACTICE_COMPLETE':
                        this.handlePracticeComplete(event, data);
                        break;
                    case 'ERROR_OCCURRED':
                        this.handleErrorOccurred(event, data);
                        break;
                    default:
                        console.warn(`[App] Unknown message type: ${type}`);
                }
            } catch (error) {
                console.error('[App] Error handling message:', error);
                this.stores.app?.addError(error);
            }
        });

        console.log('[App] Single message router attached');
    }

    /**
     * 处理会话准备就绪
     */
    handleSessionReady(event, data) {
        if (!data.sessionId) return;

        const examId = data.examId;
        if (!examId) return;

        // 清除握手超时
        if (this._handshakeTimers && this._handshakeTimers.has(examId)) {
            clearTimeout(this._handshakeTimers.get(examId));
            this._handshakeTimers.delete(examId);
        }

        // 标记窗口为就绪状态
        if (this.examWindows && this.examWindows.has(examId)) {
            const windowInfo = this.examWindows.get(examId);
            windowInfo.dataCollectorReady = true;
            windowInfo.lastUpdate = Date.now();
            windowInfo.status = 'ready';
        }

        console.log(`[App] Session ready for exam: ${examId}`);
    }

    /**
     * 处理进度更新
     */
    handleProgressUpdate(event, data) {
        if (!data.sessionId || !data.examId) return;

        // 更新窗口状态
        if (this.examWindows && this.examWindows.has(data.examId)) {
            const windowInfo = this.examWindows.get(data.examId);
            windowInfo.lastUpdate = Date.now();
            windowInfo.status = 'in_progress';
        }

        console.log(`[App] Progress update for exam: ${data.examId}`);
    }

    /**
     * 处理练习完成
     */
    async handlePracticeComplete(event, data) {
        if (!data.sessionId || !data.examId) return;

        // 防重复处理
        if (this._processedSessionIds.has(data.sessionId)) {
            console.warn(`[App] Duplicate practice completion detected: ${data.sessionId}`);
            return;
        }

        this._processedSessionIds.add(data.sessionId);

        try {
            // 通过 RecordStore 保存记录
            if (this.stores.record) {
                await this.stores.record.savePracticeRecord(data);
                console.log(`[App] Practice record saved for exam: ${data.examId}`);
            }

            // 更新窗口状态
            if (this.examWindows && this.examWindows.has(data.examId)) {
                const windowInfo = this.examWindows.get(data.examId);
                windowInfo.status = 'completed';
                windowInfo.lastUpdate = Date.now();
            }

        } catch (error) {
            console.error('[App] Error saving practice record:', error);
            this.stores.app?.addError(error);
        }
    }

    /**
     * 处理错误发生
     */
    handleErrorOccurred(event, data) {
        console.error('[App] Practice page error:', data);
        if (this.stores.app) {
            this.stores.app.addError(data.error || new Error('Unknown practice page error'));
        }
    }

    /**
     * 按需注入脚本（file:// 兼容）
     */
    injectScript(src) {
        return new Promise((resolve, reject) => {
            // 检查是否已加载
            if (this._loadedScripts.has(src)) {
                console.debug(`[Injector] Already loaded: ${src}`);
                return resolve();
            }

            console.debug(`[Injector] Loading: ${src}`);

            const s = document.createElement('script');
            s.src = src;
            s.async = false; // 保持执行顺序

            s.onload = () => {
                this._loadedScripts.add(src);
                console.debug(`[Injector] Loaded: ${src}`);
                resolve();
            };

            s.onerror = (e) => {
                console.error(`[Injector] Failed: ${src}`, e);
                reject(e);
            };

            document.head.appendChild(s);
        });
    }

    /**
     * 统一打开考试接口
     */
    async openExam(examId) {
        try {
            if (!examId) {
                throw new Error('Exam ID is required');
            }

            console.log(`[App] Opening exam: ${examId}`);

            // 确保练习记录器已加载
            if (!window.PracticeRecorder) {
                await this.injectScript('js/core/practiceRecorder.js');
            }

            // 获取考试信息
            let exam;
            if (this.stores.exams) {
                exam = this.stores.exams.getExamById(examId);
            } else {
                // 回退到全局数据
                exam = window.completeExamIndex?.find(e => e.id === examId);
            }

            if (!exam) {
                throw new Error(`Exam not found: ${examId}`);
            }

            // 如果是听力考试，确保听力数据已加载
            if (exam.category === 'listening') {
                await this.injectScript('assets/scripts/listening-exam-data.js');
            }

            // 使用练习记录器打开考试
            if (window.PracticeRecorder) {
                const recorder = new window.PracticeRecorder();
                recorder.startPractice(exam);
            } else {
                // 回退方案：直接打开考试页面
                const examUrl = exam.practiceUrl || `exam.html?id=${examId}`;
                window.open(examUrl, `exam_${examId}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
            }

            console.log(`[App] Exam opened successfully: ${examId}`);

        } catch (error) {
            console.error('[App] Error opening exam:', error);
            if (this.stores.app) {
                this.stores.app.addError(error);
            } else {
                this.showUserMessage(`打开考试失败: ${error.message}`, 'error');
            }
        }
    }

    /**
     * 统一查看PDF接口
     */
    async viewPDF(examId) {
        try {
            if (!examId) {
                throw new Error('Exam ID is required');
            }

            console.log(`[App] Viewing PDF for exam: ${examId}`);

            // 确保PDF处理器已加载
            if (!window.PDFHandler) {
                await this.injectScript('js/components/PDFHandler.js');
            }

            // 获取考试信息
            let exam;
            if (this.stores.exams) {
                exam = this.stores.exams.getExamById(examId);
            } else {
                // 回退到全局数据
                exam = window.completeExamIndex?.find(e => e.id === examId);
            }

            if (!exam) {
                throw new Error(`Exam not found: ${examId}`);
            }

            // 检查是否有PDF文件
            const pdfPath = exam.pdfPath || (exam.path ? `${exam.path}/exam.pdf` : null);
            if (!pdfPath) {
                throw new Error(`PDF not available for exam: ${examId}`);
            }

            // 使用PDF处理器打开PDF
            if (window.PDFHandler) {
                const pdfHandler = new window.PDFHandler();
                pdfHandler.openPDF(pdfPath, exam.title || `Exam ${examId}`);
            } else {
                // 回退方案：直接打开PDF文件
                window.open(pdfPath, '_blank');
            }

            console.log(`[App] PDF opened successfully: ${examId}`);

        } catch (error) {
            console.error('[App] Error viewing PDF:', error);
            if (this.stores.app) {
                this.stores.app.addError(error);
            } else {
                this.showUserMessage(`打开PDF失败: ${error.message}`, 'error');
            }
        }
    }

    /**
     * 添加窗口事件监听器（带注册）
     */
    addWindowListener(type, handler, options) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, []);
        }
        this._listeners.get(type).push(handler);
        window.addEventListener(type, handler, options);
    }

    /**
     * 移除窗口事件监听器（带注册清理）
     */
    removeWindowListener(type, handler) {
        if (this._listeners.has(type)) {
            const handlers = this._listeners.get(type);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
            if (handlers.length === 0) {
                this._listeners.delete(type);
            }
        }
        window.removeEventListener(type, handler);
    }

    /**
     * 添加定时器（带注册）
     */
    addInterval(fn, ms) {
        const id = setInterval(fn, ms);
        this._intervals.add(id);
        return {
            id,
            clear: () => {
                clearInterval(id);
                this._intervals.delete(id);
            }
        };
    }

    /**
     * 添加延时器（带注册）
     */
    addTimeout(fn, ms) {
        const id = setTimeout(fn, ms);
        this._timeouts.add(id);
        return {
            id,
            clear: () => {
                clearTimeout(id);
                this._timeouts.delete(id);
            }
        };
    }

    /**
     * 调试报告（显示监听器和定时器统计）
     */
    debugReport() {
        console.group('[App] Debug Report - Listener & Timer Statistics');

        // 监听器统计
        const listenerStats = [];
        this._listeners.forEach((handlers, type) => {
            listenerStats.push({
                type,
                count: handlers.length
            });
        });

        console.table(listenerStats);
        console.log(`[App] Total event listener types: ${this._listeners.size}`);
        console.log(`[App] Total registered listeners: ${listenerStats.reduce((sum, stat) => sum + stat.count, 0)}`);

        // 定时器统计
        console.log(`[App] Active intervals: ${this._intervals.size}`);
        console.log(`[App] Active timeouts: ${this._timeouts.size}`);

        // 脚本统计
        console.log(`[App] Loaded scripts: ${this._loadedScripts.size}`);
        console.log(`[App] Loaded scripts list:`, Array.from(this._loadedScripts));

        // 消息处理统计
        console.log(`[App] Processed session IDs: ${this._processedSessionIds?.size || 0}`);
        console.log(`[App] Message listener attached: ${this._messageListenerAttached}`);

        // 组件统计
        console.log(`[App] Active stores: ${Object.keys(this.stores).length}`);
        console.log(`[App] Active UI components: ${Object.keys(this.ui).length}`);
        console.log(`[App] Active components: ${Object.keys(this.components).length}`);

        console.groupEnd();

        return {
            listeners: listenerStats,
            intervals: this._intervals.size,
            timeouts: this._timeouts.size,
            scripts: this._loadedScripts.size,
            processedSessions: this._processedSessionIds?.size || 0,
            messageListenerAttached: this._messageListenerAttached,
            stores: Object.keys(this.stores).length,
            ui: Object.keys(this.ui).length,
            components: Object.keys(this.components).length
        };
    }

    /**
     * 清理所有注册的监听器和定时器
     */
    cleanup() {
        console.log('[App] Cleaning up registered listeners and timers...');

        // 清理定时器
        this._intervals.forEach(id => clearInterval(id));
        this._intervals.clear();

        // 清理延时器
        this._timeouts.forEach(id => clearTimeout(id));
        this._timeouts.clear();

        // 清理监听器
        this._listeners.forEach((handlers, type) => {
            handlers.forEach(handler => {
                window.removeEventListener(type, handler);
            });
        });
        this._listeners.clear();

        console.log('[App] Cleanup completed');
    }

}

// 应用启动 - 统一入口
(function() {
    try {
        window.App = new App();
        window.App.initialize();
        console.log('[App] 初始化成功');
    } catch (error) {
        console.error('[App] 初始化失败:', error);
        if (window.handleError) {
            window.handleError(error, 'Application Startup');
        }
    }
})();

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (window.App) {
        window.App.destroy();
    }
});

// 调试辅助：导出握手状态 (通过 App)
window.getHandshakeState = function() {
    try {
        const state = { timers: [], windows: [] };
        if (window.App) {
            if (window.App._handshakeTimers) {
                state.timers = Array.from(window.App._handshakeTimers.keys());
            }
            if (window.App.examWindows) {
                window.App.examWindows.forEach((info, id) => {
                    state.windows.push({
                        examId: id,
                        ready: !!info.dataCollectorReady,
                        pageType: info.pageType || null,
                        lastUpdate: info.lastUpdate || null,
                        status: info.status || null
                    });
                });
            }
        }
        return state;
    } catch (e) {
        return { error: e.message };
    }
};
