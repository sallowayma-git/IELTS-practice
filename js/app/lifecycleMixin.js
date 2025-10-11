(function(global) {
    const mixin = {
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
        },

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
        },

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

          },

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
        },

        /**
         * 更新加载消息
         */
        updateLoadingMessage(message) {
            const loadingText = document.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = message;
            }
        },

        /**
         * 显示用户消息
         */
        showUserMessage(message, type = 'info') {
            // 使用现有的showMessage函数或创建新的通知
            if (window.showMessage) {
                window.showMessage(message, type);
            } else {
              }
        },

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
        },

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
        },

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
        },

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
        },

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
        },

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
        },

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
        },

        /**
         * 更新统计元素
         */
        updateStatElement(id, value) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        },

        /**
         * 计算平均正确率
         */
        calculateAverageAccuracy(records) {
            if (records.length === 0) return 0;

            const totalAccuracy = records.reduce((sum, record) => sum + (record.accuracy || 0), 0);
            return Math.round((totalAccuracy / records.length) * 100);
        },

        /**
         * 计算学习天数
         */
        calculateStudyDays(records) {
            if (records.length === 0) return 0;

            const dates = new Set(records.map(record => {
                return new Date(record.startTime).toDateString();
            }));

            return dates.size;
        },

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
        },

        /**
         * 刷新总览数据
         */
        refreshOverviewData() {
            this.updateOverviewStats();
        },

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
        },

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
        },

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
        },
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.lifecycle = mixin;
})(typeof window !== "undefined" ? window : globalThis);
