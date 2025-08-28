/**
 * 主应用程序
 * 负责应用的初始化和整体协调
 */
class ExamSystemApp {
    constructor() {
        this.currentView = 'overview';
        this.components = {};
        this.isInitialized = false;
        
        // 绑定方法上下文
        this.handleResize = this.handleResize.bind(this);
    }

    /**
     * 初始化应用
     */
    async initialize() {
        try {
            this.showLoading(true);
            
            // 检查必要的依赖
            this.checkDependencies();
            
            // 初始化响应式管理器
            this.initializeResponsiveFeatures();
            
            // 初始化组件
            await this.initializeComponents();
            
            // 设置事件监听器
            this.setupEventListeners();
            
            // 加载初始数据
            await this.loadInitialData();
            
            // 设置初始视图
            this.setupInitialView();
            
            // 创建返回导航
            this.createReturnNavigation();
            
            // 显示活动会话指示器
            this.showActiveSessionsIndicator();
            
            // 定期更新活动会话
            this.startSessionMonitoring();
            
            this.isInitialized = true;
            this.showLoading(false);
            
            console.log('Exam System App initialized successfully');
            
        } catch (error) {
            this.showLoading(false);
            window.handleError(error, 'App Initialization');
            this.showFallbackUI();
        }
    }
    
    /**
     * 初始化响应式功能
     */
    initializeResponsiveFeatures() {
        // 初始化响应式管理器
        if (window.ResponsiveManager) {
            this.responsiveManager = new ResponsiveManager();
            console.log('Responsive manager initialized');
        }
        
        // 初始化触摸处理器
        if (window.TouchHandler) {
            this.touchHandler = new TouchHandler();
            console.log('Touch handler initialized');
        }
        
        // 初始化主题管理器
        if (window.ThemeManager) {
            this.themeManager = new ThemeManager();
            console.log('Theme manager initialized');
        }
        
        // 初始化键盘快捷键
        if (window.KeyboardShortcuts) {
            this.keyboardShortcuts = new KeyboardShortcuts();
            console.log('Keyboard shortcuts initialized');
        }
        

        
        // 初始化教程系统
        if (window.TutorialSystem) {
            this.tutorialSystem = new TutorialSystem();
            console.log('Tutorial system initialized');
        }
        
        // 初始化设置面板
        if (window.SettingsPanel) {
            this.settingsPanel = new SettingsPanel();
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
        window.addEventListener('resize', Utils.throttle(() => {
            if (this.responsiveManager) {
                this.responsiveManager.recalculateLayout();
            }
        }, 250));
        
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
        const requiredGlobals = ['storage', 'Utils'];
        const missing = requiredGlobals.filter(name => !window[name]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required dependencies: ${missing.join(', ')}`);
        }
    }

    /**
     * 初始化组件
     */
    async initializeComponents() {
        try {
            // 等待组件类加载完成
            await this.waitForComponents();
            
            // 初始化各个组件
            this.components.examBrowser = new ExamBrowser();
            
            // 初始化练习记录器
            if (window.PracticeRecorder) {
                try {
                    this.components.practiceRecorder = new PracticeRecorder();
                    this.setupPracticeRecorderEvents();
                    console.log('[App] PracticeRecorder初始化成功');
                } catch (error) {
                    console.error('[App] PracticeRecorder初始化失败:', error);
                    // 创建一个简化的记录器作为降级方案
                    this.components.practiceRecorder = this.createFallbackRecorder();
                }
            } else {
                console.warn('[App] PracticeRecorder类不可用，创建降级记录器');
                this.components.practiceRecorder = this.createFallbackRecorder();
            }
            
            // 初始化练习历史组件
            if (window.PracticeHistory) {
                this.components.practiceHistory = new PracticeHistory();
            }
            
            if (window.ExamScanner) {
                this.components.examScanner = new ExamScanner();
            }
            

            
            // 初始化推荐显示组件
            if (window.RecommendationDisplay) {
                this.components.recommendationDisplay = new RecommendationDisplay();
            }
            
            // 初始化学习目标组件
            if (window.GoalSettings) {
                this.components.goalSettings = new GoalSettings();
                // 将实例暴露到全局以便在HTML中调用
                window.goalSettings = this.components.goalSettings;
            }
            
            // 初始化进度跟踪器
            if (window.ProgressTracker) {
                this.components.progressTracker = new ProgressTracker();
            }
            
            // 初始化专项练习组件
            if (window.SpecializedPractice) {
                this.components.specializedPractice = new SpecializedPractice();
            }
            
            // 初始化题型练习组件
            if (window.QuestionTypePractice) {
                this.components.questionTypePractice = new QuestionTypePractice();
            }
            
            // 初始化数据管理面板
            if (window.DataManagementPanel) {
                const dataManagementContainer = document.createElement('div');
                dataManagementContainer.id = 'dataManagementPanel';
                dataManagementContainer.style.display = 'none';
                document.body.appendChild(dataManagementContainer);
                
                this.components.dataManagementPanel = new DataManagementPanel(dataManagementContainer);
                window.dataManagementPanel = this.components.dataManagementPanel;
            }
            
            // 初始化系统维护面板
            if (window.SystemMaintenancePanel) {
                const systemMaintenanceContainer = document.createElement('div');
                systemMaintenanceContainer.id = 'systemMaintenancePanel';
                systemMaintenanceContainer.style.display = 'none';
                document.body.appendChild(systemMaintenanceContainer);
                
                this.components.systemMaintenancePanel = new SystemMaintenancePanel(systemMaintenanceContainer);
                window.systemMaintenancePanel = this.components.systemMaintenancePanel;
            }
            
        } catch (error) {
            console.error('Component initialization failed:', error);
            throw error;
        }
    }

    /**
     * 等待组件类加载
     */
    async waitForComponents() {
        const maxWait = 5000; // 最大等待5秒
        const checkInterval = 100;
        let waited = 0;
        
        while (waited < maxWait) {
            if (window.ExamBrowser) {
                return;
            }
            await Utils.sleep(checkInterval);
            waited += checkInterval;
        }
        
        throw new Error('Required component classes not loaded within timeout');
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
        window.addEventListener('resize', Utils.throttle(this.handleResize, 250));
        
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
            // 扫描题库（如果扫描器可用）
            if (this.components.examScanner) {
                await this.components.examScanner.scanExamLibrary();
            }
            
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
        const stats = storage.get('user_stats', {
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
    updateOverviewStats() {
        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        
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
        
        categories.forEach(category => {
            const categoryExams = examIndex.filter(exam => exam.category === category);
            const categoryRecords = practiceRecords.filter(record => {
                const exam = examIndex.find(e => e.id === record.examId);
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
        const urlView = Utils.getUrlParameter('view');
        const initialView = urlView || 'overview';
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
            Utils.setUrlParameter('view', viewName);
            
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
                if (this.components.practiceHistory) {
                    this.components.practiceHistory.refreshHistory();
                }
                break;
            case 'analysis':
                this.loadAnalysisData();
                break;
            case 'goals':
                this.loadGoalsData();
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
    browseCategory(category) {
        if (this.components.examBrowser) {
            this.components.examBrowser.showCategory(category);
            this.navigateToView('browse');
            
            // 更新浏览页面标题
            const browseTitle = document.getElementById('browse-title');
            if (browseTitle) {
                browseTitle.textContent = `${category} 题库浏览`;
            }
        }
    }

    /**
     * 开始分类练习
     */
    startCategoryPractice(category) {
        // 获取该分类的题目
        const examIndex = storage.get('exam_index', []);
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
    openExam(examId) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        
        if (!exam) {
            window.showMessage('题目不存在', 'error');
            return;
        }

        try {
            // 记录练习开始
            this.startPracticeSession(examId);
            
            // 构造题目URL
            const examUrl = this.buildExamUrl(exam);
            
            // 在新窗口中打开题目
            const examWindow = this.openExamWindow(examUrl, exam);
            
            // 新增：注入数据采集脚本
            this.injectDataCollectionScript(examWindow, examId);
            
            // 设置窗口管理
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
        // 基于exam对象构造完整的文件路径
        let examPath = exam.path;
        
        // 确保路径格式正确
        if (!examPath.endsWith('/')) {
            examPath += '/';
        }
        
        // 添加文件名
        const fullPath = examPath + exam.filename;
        
        // 返回相对于当前页面的路径
        return fullPath;
    }



    /**
     * 在新窗口中打开题目
     */
    openExamWindow(examUrl, exam) {
        // 计算窗口尺寸和位置
        const windowFeatures = this.calculateWindowFeatures();
        
        // 打开新窗口
        const examWindow = window.open(
            examUrl,
            `exam_${exam.id}`,
            windowFeatures
        );
        
        if (!examWindow) {
            throw new Error('无法打开新窗口，请检查浏览器弹窗设置');
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
        
        // 等待页面加载完成后注入脚本
        const injectScript = () => {
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
                fetch('./js/practice-page-enhancer.js')
                    .then(r => r.text())
                    .then(enhancerScript => {
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
                    })
                    .catch(error => {
                        console.error('[DataInjection] 脚本加载失败:', error);
                        // 降级到内联脚本注入
                        this.injectInlineScript(examWindow, examId);
                    });

            } catch (error) {
                console.error('[DataInjection] 脚本注入失败:', error);
                // 记录错误但不中断练习流程
                this.handleInjectionError(examId, error);
            }
        };

        // 更可靠的页面加载检测
        const checkAndInject = () => {
            try {
                if (examWindow.closed) return;
                
                const doc = examWindow.document;
                if (doc && (doc.readyState === 'complete' || doc.readyState === 'interactive')) {
                    injectScript();
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
    handleInjectionError(examId, error) {
        console.error('[DataInjection] 注入错误:', error);
        
        // 记录错误信息
        const errorInfo = {
            examId: examId,
            error: error.message,
            timestamp: Date.now(),
            type: 'script_injection_error'
        };
        
        // 保存错误日志到本地存储
        const errorLogs = storage.get('injection_errors', []);
        errorLogs.push(errorInfo);
        if (errorLogs.length > 50) {
            errorLogs.splice(0, errorLogs.length - 50); // 保留最近50条错误
        }
        storage.set('injection_errors', errorLogs);
        
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
        
        // 更新UI状态
        this.updateExamStatus(examId, 'in-progress');
    }

    /**
     * 设置题目窗口通信
     */
    setupExamWindowCommunication(examWindow, examId) {
        // 监听来自题目窗口的消息
        const messageHandler = (event) => {
            // 验证消息数据格式
            if (!event.data || typeof event.data !== 'object') return;
            
            // 只处理来自练习页面的消息
            if (event.data.source !== 'practice_page') return;
            
            // 验证窗口来源（如果可能的话）- 放宽验证条件
            if (event.source && examWindow && event.source !== examWindow) {
                console.log('[App] 消息来源窗口不匹配，但仍处理消息');
            }
            
            const { type, data } = event.data || {};
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
                    this.handleSessionReady(examId, data);
                    break;
                case 'PROGRESS_UPDATE':
                    this.handleProgressUpdate(examId, data);
                    break;
                case 'PRACTICE_COMPLETE':
                    this.handlePracticeComplete(examId, data);
                    break;
                case 'ERROR_OCCURRED':
                    this.handleDataCollectionError(examId, data);
                    break;
                default:
                    console.log('[App] 未处理的消息类型:', type);
            }
        };
        
        window.addEventListener('message', messageHandler);
        
        // 存储消息处理器以便清理
        if (!this.messageHandlers) {
            this.messageHandlers = new Map();
        }
        this.messageHandlers.set(examId, messageHandler);
        
        // 向题目窗口发送初始化消息
        examWindow.addEventListener('load', () => {
            examWindow.postMessage({
                type: 'init_exam_session',
                data: {
                    examId: examId,
                    parentOrigin: window.location.origin,
                    sessionId: this.generateSessionId()
                }
            }, '*');
        });
    }

    /**
     * 创建降级记录器
     */
    createFallbackRecorder() {
        return {
            handleRealPracticeData: (examId, realData) => {
                console.log('[FallbackRecorder] 处理真实练习数据:', examId, realData);
                try {
                    // 获取题目信息
                    const examIndex = storage.get('exam_index', []);
                    const exam = examIndex.find(e => e.id === examId);
                    
                    if (!exam) {
                        console.error('[FallbackRecorder] 无法找到题目信息:', examId);
                        return null;
                    }
                    
                    // 创建练习记录
                    const practiceRecord = this.createSimplePracticeRecord(exam, realData);
                    
                    // 直接保存到localStorage
                    const records = storage.get('practice_records', []);
                    records.unshift(practiceRecord);
                    
                    if (records.length > 1000) {
                        records.splice(1000);
                    }
                    
                    storage.set('practice_records', records);
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
            }
        };
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
    startPracticeSession(examId) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        
        if (!exam) {
            console.error('Exam not found:', examId);
            return;
        }
        
        // 使用练习记录器开始会话
        if (this.components.practiceRecorder) {
            try {
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
            } catch (error) {
                console.error('[App] 练习记录器启动失败:', error);
            }
        } else {
            // 降级处理
            console.log('[App] 使用降级会话管理');
            const sessionData = {
                examId: examId,
                startTime: new Date().toISOString(),
                status: 'started',
                sessionId: this.generateSessionId()
            };
            
            const activeSessions = storage.get('active_sessions', []);
            activeSessions.push(sessionData);
            storage.set('active_sessions', activeSessions);
        }
        
        // 更新题目状态
        this.updateExamStatus(examId, 'in-progress');
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
        
        window.showMessage(`题目出现错误: ${errorData.message || '未知错误'}`, 'error');
        
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
    handlePracticeComplete(examId, data) {
        console.log('[DataCollection] 练习完成（真实数据）:', examId, data);
        console.log('[DataCollection] PracticeRecorder状态:', !!this.components.practiceRecorder);
        
        try {
            // 使用真实数据更新练习记录
            if (this.components && this.components.practiceRecorder) {
                console.log('[DataCollection] 使用PracticeRecorder处理真实数据');
                const result = this.components.practiceRecorder.handleRealPracticeData(examId, data);
                console.log('[DataCollection] PracticeRecorder处理结果:', result);
            } else {
                // 降级处理：直接保存真实数据
                console.log('[DataCollection] PracticeRecorder不可用，使用降级保存');
                console.log('[DataCollection] Components状态:', this.components);
                this.saveRealPracticeData(examId, data);
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
    handleDataCollectionError(examId, data) {
        console.error('[DataCollection] 数据采集错误:', examId, data);
        
        // 记录错误但不中断用户体验
        const errorInfo = {
            examId: examId,
            error: data,
            timestamp: Date.now(),
            type: 'data_collection_error'
        };
        
        const errorLogs = storage.get('collection_errors', []);
        errorLogs.push(errorInfo);
        if (errorLogs.length > 50) {
            errorLogs.splice(0, errorLogs.length - 50);
        }
        storage.set('collection_errors', errorLogs);
        
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
     * 保存真实练习数据
     */
    saveRealPracticeData(examId, realData) {
        try {
            const examIndex = storage.get('exam_index', []);
            const exam = examIndex.find(e => e.id === examId);
            
            if (!exam) {
                console.error('无法找到题目信息:', examId);
                return;
            }
            
            // 构造增强的练习记录
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
            
            // 保存到练习记录
            const practiceRecords = storage.get('practice_records', []);
            practiceRecords.unshift(practiceRecord);
            
            // 限制记录数量
            if (practiceRecords.length > 100) {
                practiceRecords.splice(100);
            }
            
            storage.set('practice_records', practiceRecords);
            
            console.log('[DataCollection] 真实练习数据已保存:', practiceRecord);
            
        } catch (error) {
            console.error('[DataCollection] 保存真实数据失败:', error);
        }
    }

    /**
     * 显示真实完成通知
     */
    showRealCompletionNotification(examId, realData) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        
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
    showExamCompletionNotification(examId, resultData) {
        const examIndex = storage.get('exam_index', []);
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
    showDetailedResults(examId, resultData) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        
        if (!exam) return;
        
        const accuracy = Math.round((resultData.accuracy || 0) * 100);
        const duration = Utils.formatDuration(resultData.duration || 0);
        
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
    cleanupExamSession(examId) {
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
        const activeSessions = storage.get('active_sessions', []);
        const updatedSessions = activeSessions.filter(session => session.examId !== examId);
        storage.set('active_sessions', updatedSessions);
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
    showPracticeCompletionNotification(examId, practiceRecord) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        
        if (!exam) return;
        
        const accuracy = Math.round((practiceRecord.accuracy || 0) * 100);
        const duration = Utils.formatDuration(practiceRecord.duration || 0);
        
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
    showDetailedPracticeResults(examId, practiceRecord) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        
        if (!exam) return;
        
        const accuracy = Math.round((practiceRecord.accuracy || 0) * 100);
        const duration = Utils.formatDuration(practiceRecord.duration || 0);
        
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
        if (this.components.examBrowser) {
            this.components.examBrowser.showExamDetails(examId);
        }
    }

    /**
     * 创建返回总览的导航机制
     */
    createReturnNavigation() {
        // 检查是否已存在返回按钮
        if (document.querySelector('.return-to-overview')) return;

        // 创建返回按钮
        const returnButton = document.createElement('button');
        returnButton.className = 'return-to-overview';
        returnButton.innerHTML = `
            <span class="return-icon">←</span>
            <span class="return-text">返回总览</span>
        `;
        returnButton.title = '返回总览页面 (Alt+H)';
        
        // 添加点击事件
        returnButton.addEventListener('click', () => {
            this.navigateToView('overview');
        });
        
        // 添加到页面
        document.body.appendChild(returnButton);
        
        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key === 'h') {
                e.preventDefault();
                this.navigateToView('overview');
            }
        });
    }

    /**
     * 显示活动会话指示器
     */
    showActiveSessionsIndicator() {
        const activeSessions = storage.get('active_sessions', []);
        
        if (activeSessions.length === 0) {
            this.hideActiveSessionsIndicator();
            return;
        }
        
        let indicator = document.querySelector('.active-sessions-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'active-sessions-indicator';
            document.body.appendChild(indicator);
            
            // 点击显示会话详情
            indicator.addEventListener('click', () => {
                this.showActiveSessionsDetails();
            });
        }
        
        indicator.innerHTML = `
            <span class="indicator-text">活动练习</span>
            <span class="session-count">${activeSessions.length}</span>
        `;
        
        indicator.style.display = 'block';
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
    showActiveSessionsDetails() {
        const activeSessions = storage.get('active_sessions', []);
        const examIndex = storage.get('exam_index', []);
        
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
                                        <span>开始时间: ${Utils.formatDate(session.startTime, 'HH:mm')}</span>
                                        <span>已用时: ${Utils.formatDuration(Math.floor(duration / 1000))}</span>
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
    closeAllExamSessions() {
        const activeSessions = storage.get('active_sessions', []);
        
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
        if (Utils.isMobile()) {
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
    showFallbackUI() {
        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = `
                <div class="fallback-ui">
                    <div class="container">
                        <h1>系统初始化失败</h1>
                        <p>抱歉，系统无法正常启动。请尝试以下解决方案：</p>
                        <ul>
                            <li>刷新页面重试</li>
                            <li>清除浏览器缓存</li>
                            <li>检查网络连接</li>
                            <li>使用现代浏览器访问</li>
                        </ul>
                        <button onclick="window.location.reload()" class="btn btn-primary">
                            刷新页面
                        </button>
                    </div>
                </div>
            `;
        }
    }

    /**
     * 销毁应用
     */
    destroy() {
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
        
        // 销毁组件
        Object.values(this.components).forEach(component => {
            if (component && typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        
        this.isInitialized = false;
    }
}

// 应用启动
document.addEventListener('DOMContentLoaded', async () => {
    try {
        window.app = new ExamSystemApp();
        await window.app.initialize();
    } catch (error) {
        console.error('Failed to start application:', error);
        window.handleError(error, 'Application Startup');
    }
});

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app.destroy();
    }
});