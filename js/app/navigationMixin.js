(function(global) {
    const mixin = {
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
        },

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
        },

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
                        const { category, type, filterMode, path } = window.__pendingBrowseFilter;
                        try {
                            window.applyBrowseFilter(category, type, filterMode, path);
                        } finally {
                            delete window.__pendingBrowseFilter;
                        }
                    } else if (typeof window.initializeBrowseView === 'function') {
                        window.initializeBrowseView();
                    }
                    break;
                case 'practice':
                    // 练习视图已由其他组件处理
                    console.log('[App] 练习视图已激活');
                    break;
            }
        },

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
        },

        /**
         * 浏览分类题目
         */
        browseCategory(category, type = null, filterMode = null, path = null) {
            try {
                // 记录待应用筛选（可显式传入类型、filterMode 和 path）
                window.__pendingBrowseFilter = { category, type, filterMode, path };
                const descriptor = Object.getOwnPropertyDescriptor(window, '__browseFilter');
                if (!descriptor || typeof descriptor.set !== 'function') {
                    window.__browseFilter = { category, type, filterMode, path };
                }
            } catch (_) {}

            try {
                if (typeof window.requestBrowseAutoScroll === 'function') {
                    window.requestBrowseAutoScroll(category, type);
                }
            } catch (_) {}

            // 无论是否存在旧的 ExamBrowser，都统一走新浏览视图
            this.navigateToView('browse');

            // 立即尝试应用（如果浏览视图已在当前激活）
            try {
                if (typeof window.applyBrowseFilter === 'function' && document.getElementById('browse-view')?.classList.contains('active')) {
                    window.applyBrowseFilter(category, type, filterMode, path);
                    delete window.__pendingBrowseFilter;
                }
            } catch (_) {}
        },

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
        },

        /**
         * 显示题目详情
         */
        showExamDetails(examId) {
            if (this.components.examBrowser) {
                this.components.examBrowser.showExamDetails(examId);
            }
        },
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.navigation = mixin;
})(typeof window !== "undefined" ? window : globalThis);
