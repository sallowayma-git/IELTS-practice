jieshenshuduan/**
 * HP Design Iterations Fix Plugin
 * 专门修复 .superdesign/design_iterations/HP/ 四个页面的功能问题
 * 基于现有代码和修复审计文档
 */

(function() {
    'use strict';

    // 等待hpCore准备就绪
    if (typeof hpCore === 'undefined') {
        console.error('[HP-Design-Iterations-Fix] hpCore未定义');
        return;
    }

    const hpDesignIterationsFix = {
        // 插件状态
        isInitialized: false,
        currentPage: 'unknown',
        pagesStatus: {
            welcome: { loaded: false, functional: false },
            practice: { loaded: false, functional: false },
            history: { loaded: false, functional: false },
            setting: { loaded: false, functional: false }
        },

        // Performance optimization: Virtual scroller instance
        practiceVirtualScroller: null,

        // 事件委托 - 避免handler引用问题
        _isEventDelegationSetup: false,

        /**
         * 初始化插件
         */
        init() {
            if (this.isInitialized) {
                console.log('[HP-Design-Iterations-Fix] 插件已初始化，跳过重复初始化');
                return;
            }

            console.log('[HP-Design-Iterations-Fix] 开始初始化HP设计迭代页面修复插件');

            // 等待DOM加载完成
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this._initAfterDOM());
            } else {
                this._initAfterDOM();
            }
        },

        /**
         * DOM加载完成后初始化
         */
        _initAfterDOM() {
            try {
                this._detectCurrentPage();
                this._setupPageIntegration();
                this._fixCurrentPage();
                this._setupGlobalEventHandlers();
                this._setupDataSynchronization();
                this.isInitialized = true;
                console.log('[HP-Design-Iterations-Fix] 插件初始化完成');
            } catch (error) {
                console.error('[HP-Design-Iterations-Fix] 初始化失败:', error);
            }
        },

        /**
         * 检测当前页面
         */
        _detectCurrentPage() {
            const path = window.location.pathname;
            const filename = path.substring(path.lastIndexOf('/') + 1);

            if (filename === 'Welcome.html') {
                this.currentPage = 'welcome';
            } else if (filename === 'practice.html') {
                this.currentPage = 'practice';
            } else if (filename === 'Practice History.html') {
                this.currentPage = 'history';
            } else if (filename === 'setting.html') {
                this.currentPage = 'setting';
            } else {
                this.currentPage = 'unknown';
            }

            console.log(`[HP-Design-Iterations-Fix] 检测到当前页面: ${this.currentPage}`);
        },

        /**
         * 设置页面集成
         */
        _setupPageIntegration() {
            console.log('[HP-Design-Iterations-Fix] 设置页面集成');

            // 确保页面容器存在
            this._ensurePageContainers();

            // 设置导航事件
            this._setupNavigationEvents();

            // 初始化页面数据
            this._initializePageData();
        },

        /**
         * 确保页面容器存在
         */
        _ensurePageContainers() {
            switch (this.currentPage) {
                case 'welcome':
                    this._ensureWelcomeContainers();
                    break;
                case 'practice':
                    this._ensurePracticeContainers();
                    break;
                case 'history':
                    this._ensureHistoryContainers();
                    break;
                case 'setting':
                    this._ensureSettingContainers();
                    break;
            }
        },

        /**
         * 确保Welcome页面容器
         */
        _ensureWelcomeContainers() {
            // 确保练习卡片容器存在
            let cardsContainer = document.getElementById('practice-cards-container');
            if (!cardsContainer) {
                cardsContainer = document.createElement('div');
                cardsContainer.id = 'practice-cards-container';
                cardsContainer.className = 'mt-16 grid grid-cols-1 md:grid-cols-2 gap-8';

                const mainContent = document.querySelector('main .mist-content');
                if (mainContent) {
                    const section = mainContent.querySelector('section:last-child');
                    if (section) {
                        section.parentNode.insertBefore(cardsContainer, section.nextSibling);
                    }
                }
            }

            // 确保进度统计容器存在
            let statsContainer = document.getElementById('progress-stats-container');
            if (!statsContainer) {
                statsContainer = document.createElement('div');
                statsContainer.id = 'progress-stats-container';
                statsContainer.className = 'mt-16 bg-card-light dark:bg-card-dark rounded-lg shadow-lg p-8 border border-border-light dark:border-border-dark';

                const mainContent = document.querySelector('main .mist-content');
                if (mainContent) {
                    mainContent.appendChild(statsContainer);
                }
            }

            // 确保进度统计网格存在
            let statsGrid = document.getElementById('progress-stats-grid');
            if (!statsGrid) {
                statsGrid = document.createElement('div');
                statsGrid.id = 'progress-stats-grid';
                statsGrid.className = 'grid grid-cols-1 sm:grid-cols-3 gap-6 text-center';

                const statsContainer = document.getElementById('progress-stats-container');
                if (statsContainer) {
                    statsContainer.appendChild(statsGrid);
                }
            }
        },

        /**
         * 确保Practice页面容器
         */
        _ensurePracticeContainers() {
            // 确保题库网格容器存在
            let examGrid = document.getElementById('practice-exam-grid');
            if (!examGrid) {
                examGrid = document.createElement('div');
                examGrid.id = 'practice-exam-grid';
                examGrid.className = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

                const container = document.querySelector('.layout-content-container');
                if (container) {
                    const existingGrid = container.querySelector('.grid');
                    if (existingGrid) {
                        existingGrid.parentNode.replaceChild(examGrid, existingGrid);
                    }
                }
            }

            // 确保搜索框功能
            const searchInput = document.querySelector('input[placeholder="搜索题库..."]');
            if (searchInput) {
                searchInput.id = 'practice-search-input';
                searchInput.addEventListener('input', (e) => {
                    this._handlePracticeSearch(e.target.value);
                });
            }

            // 确保过滤器按钮功能
            const filterButtons = document.querySelectorAll('.flex.border-b a');
            filterButtons.forEach((button, index) => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    this._handlePracticeFilter(index);
                });
            });
        },

        /**
         * 确保History页面容器
         */
        _ensureHistoryContainers() {
            // 确保成就网格容器存在
            let achievementsGrid = document.getElementById('achievements-grid');
            if (!achievementsGrid) {
                achievementsGrid = document.createElement('div');
                achievementsGrid.id = 'achievements-grid';
                achievementsGrid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 w-full';

                const achievementsContainer = document.getElementById('achievements-container');
                if (achievementsContainer) {
                    achievementsContainer.appendChild(achievementsGrid);
                }
            }

            // 确保练习历史表格容器存在
            let historyTable = document.getElementById('practice-history-table');
            if (!historyTable) {
                historyTable = document.createElement('div');
                historyTable.id = 'practice-history-table';
                historyTable.className = 'flex overflow-hidden rounded-lg border border-[#543b3f] bg-[#181112]';

                const historyContainer = document.getElementById('practice-history-container');
                if (historyContainer) {
                    historyContainer.appendChild(historyTable);
                }
            }

            // 确保练习趋势网格容器存在
            let trendGrid = document.getElementById('practice-trend-grid');
            if (!trendGrid) {
                trendGrid = document.createElement('div');
                trendGrid.id = 'practice-trend-grid';
                trendGrid.className = 'flex flex-wrap gap-4 w-full';

                const trendContainer = document.getElementById('practice-trend-container');
                if (trendContainer) {
                    trendContainer.appendChild(trendGrid);
                }
            }
        },

        /**
         * 确保Setting页面容器
         */
        _ensureSettingContainers() {
            // 确保系统信息网格容器存在
            let systemInfoGrid = document.getElementById('system-info-grid');
            if (!systemInfoGrid) {
                systemInfoGrid = document.createElement('div');
                systemInfoGrid.id = 'system-info-grid';
                systemInfoGrid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6';

                const systemInfoContainer = document.getElementById('system-info-container');
                if (systemInfoContainer) {
                    systemInfoContainer.appendChild(systemInfoGrid);
                }
            }
        },

        /**
         * 设置导航事件
         */
        _setupNavigationEvents() {
            const navLinks = document.querySelectorAll('a[href]');
            navLinks.forEach(link => {
                link.addEventListener('click', (e) => {
                    const href = link.getAttribute('href');
                    if (href && (href.includes('Welcome.html') || href.includes('practice.html') ||
                        href.includes('Practice History.html') || href.includes('setting.html'))) {
                        e.preventDefault();
                        this._navigateToPage(href);
                    }
                });
            });
        },

        /**
         * 导航到指定页面
         */
        _navigateToPage(href) {
            console.log(`[HP-Design-Iterations-Fix] 导航到页面: ${href}`);
            window.location.href = href;
        },

        /**
         * 初始化页面数据
         */
        _initializePageData() {
            // 加载题库数据
            if (typeof loadLibrary === 'function') {
                loadLibrary();
            }

            // 同步练习记录
            if (typeof syncPracticeRecords === 'function') {
                syncPracticeRecords();
            }
        },

        /**
         * 修复当前页面
         */
        _fixCurrentPage() {
            console.log(`[HP-Design-Iterations-Fix] 修复当前页面: ${this.currentPage}`);

            switch (this.currentPage) {
                case 'welcome':
                    this._fixWelcomePage();
                    break;
                case 'practice':
                    this._fixPracticePage();
                    break;
                case 'history':
                    this._fixHistoryPage();
                    break;
                case 'setting':
                    this._fixSettingPage();
                    break;
            }
        },

        /**
         * 修复Welcome页面
         */
        _fixWelcomePage() {
            console.log('[HP-Design-Iterations-Fix] 修复Welcome页面');

            // 渲染练习卡片
            this._renderWelcomeCards();

            // 渲染进度统计
            this._renderWelcomeStats();

            this.pagesStatus.welcome.functional = true;
            console.log('[HP-Design-Iterations-Fix] Welcome页面修复完成');
        },

        /**
         * 渲染Welcome页面卡片
         */
        _renderWelcomeCards() {
            const container = document.getElementById('practice-cards-container');
            if (!container) return;

            const examIndex = hpCore.getExamIndex();
            const readingExams = examIndex.filter(e => e.type === 'reading');
            const listeningExams = examIndex.filter(e => e.type === 'listening');

            container.innerHTML = `
                <div class="bg-card-light dark:bg-card-dark rounded-lg shadow-lg p-8 flex flex-col items-center justify-center text-center border border-border-light dark:border-border-dark transform hover:scale-105 transition-transform duration-300">
                    <span class="material-icons text-7xl text-primary mb-4">menu_book</span>
                    <h2 class="font-display text-3xl font-bold mb-2">Reading</h2>
                    <p class="mb-6">${readingExams.length} 个题目</p>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn" onclick="hpDesignIterationsFix._handleReadingBrowse()">📚 浏览题库</button>
                        <button class="btn btn-secondary" onclick="hpDesignIterationsFix._handleReadingRandom()">🎲 随机练习</button>
                    </div>
                </div>
                <div class="bg-card-light dark:bg-card-dark rounded-lg shadow-lg p-8 flex flex-col items-center justify-center text-center border border-border-light dark:border-border-dark transform hover:scale-105 transition-transform duration-300">
                    <span class="material-icons text-7xl text-primary mb-4">headset</span>
                    <h2 class="font-display text-3xl font-bold mb-2">Listening</h2>
                    <p class="mb-6">${listeningExams.length} 个题目</p>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn" onclick="hpDesignIterationsFix._handleListeningBrowse()">📚 浏览题库</button>
                        <button class="btn btn-secondary" onclick="hpDesignIterationsFix._handleListeningRandom()">🎲 随机练习</button>
                    </div>
                </div>
            `;
        },

        /**
         * 渲染Welcome页面统计
         */
        _renderWelcomeStats() {
            const container = document.getElementById('progress-stats-grid');
            if (!container) return;

            const examIndex = hpCore.getExamIndex();
            const records = hpCore.getRecords();

            const totalExams = examIndex.length;
            const completedCount = records.length;
            const avgScore = records.length > 0 ?
                Math.round(records.reduce((sum, record) => sum + (record.score || 0), 0) / records.length) : 0;
            const studyHours = Math.round(records.reduce((sum, record) => sum + (record.duration || 0), 0) / 3600 * 10) / 10;

            container.innerHTML = `
                <div>
                    <p class="text-4xl font-bold text-primary font-display">${totalExams}</p>
                    <p class="text-sm uppercase tracking-wider mt-1">总题目数</p>
                </div>
                <div>
                    <p class="text-4xl font-bold text-primary font-display">${completedCount}</p>
                    <p class="text-sm uppercase tracking-wider mt-1">已完成</p>
                </div>
                <div>
                    <p class="text-4xl font-bold text-primary font-display">${avgScore}%</p>
                    <p class="text-sm uppercase tracking-wider mt-1">平均分数</p>
                </div>
            `;
        },

        /**
         * 处理阅读浏览
         */
        _handleReadingBrowse() {
            this._navigateToPage('practice.html');
            setTimeout(() => {
                if (window.filterByType) {
                    window.filterByType('reading');
                }
            }, 100);
        },

        /**
         * 处理阅读随机
         */
        _handleReadingRandom() {
            const examIndex = hpCore.getExamIndex();
            const readingExams = examIndex.filter(e => e.type === 'reading');
            if (readingExams.length > 0) {
                const randomExam = readingExams[Math.floor(Math.random() * readingExams.length)];
                if (window.openExam) {
                    window.openExam(randomExam.id);
                }
            }
        },

        /**
         * 处理听力浏览
         */
        _handleListeningBrowse() {
            this._navigateToPage('practice.html');
            setTimeout(() => {
                if (window.filterByType) {
                    window.filterByType('listening');
                }
            }, 100);
        },

        /**
         * 处理听力随机
         */
        _handleListeningRandom() {
            const examIndex = hpCore.getExamIndex();
            const listeningExams = examIndex.filter(e => e.type === 'listening');
            if (listeningExams.length > 0) {
                const randomExam = listeningExams[Math.floor(Math.random() * listeningExams.length)];
                if (window.openExam) {
                    window.openExam(randomExam.id);
                }
            }
        },

        /**
         * 修复Practice页面
         */
        _fixPracticePage() {
            console.log('[HP-Design-Iterations-Fix] 修复Practice页面');

            // 渲染题库网格
            this._renderPracticeGrid();

            // 设置搜索功能
            this._setupPracticeSearch();

            // 设置过滤器功能
            this._setupPracticeFilters();

            this.pagesStatus.practice.functional = true;
            console.log('[HP-Design-Iterations-Fix] Practice页面修复完成');
        },

        /**
         * 渲染Practice页面网格
         */
        _renderPracticeGrid() {
            const container = document.getElementById('practice-exam-grid');
            if (!container) return;

            const examIndex = hpCore.getExamIndex();
            const records = hpCore.getRecords();

            if (!examIndex || examIndex.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
                        <div class="empty-icon" style="font-size: 4rem; margin-bottom: 20px;">📚</div>
                        <div class="empty-title" style="margin-bottom: 10px;">暂无题库数据</div>
                        <div class="empty-description" style="margin-bottom: 20px;">请检查题库配置或刷新页面</div>
                        <button class="btn" onclick="hpDesignIterationsFix._refreshPracticeData()">刷新数据</button>
                    </div>
                `;
                return;
            }

            container.innerHTML = examIndex.map(exam => {
                const isCompleted = records.some(record =>
                    record.examId === exam.id || record.title === exam.title
                );

                const bestScore = isCompleted ?
                    Math.max(...records
                        .filter(record => record.examId === exam.id || record.title === exam.title)
                        .map(record => (record.score ?? record.percentage ?? 0))) : 0;

                return `
                    <div class="exam-card" style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; cursor: pointer; transition: all 0.3s ease;" onclick="hpDesignIterationsFix._openPracticeExam('${exam.id}')">
                        <div class="exam-title" style="font-weight: 600; margin-bottom: 10px;">${exam.title || '无标题'}</div>
                        <div class="exam-meta" style="opacity: 0.7; margin-bottom: 15px;">
                            <span>${exam.type === 'reading' ? '📖 阅读' : '🎧 听力'}</span>
                            <span>${exam.category || 'P1'}</span>
                            ${isCompleted ? `<span>最佳 ${bestScore}%</span>` : ''}
                        </div>
                        <div class="exam-actions" style="display: flex; gap: 10px;">
                            <button class="btn" onclick="event.stopPropagation(); hpDesignIterationsFix._openPracticeExam('${exam.id}')">
                                ${isCompleted ? '重新练习' : '开始练习'}
                            </button>
                            <button class="btn btn-secondary" onclick="event.stopPropagation(); hpDesignIterationsFix._viewPracticePDF('${exam.id}')">
                                查看PDF
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        },

        /**
         * 设置Practice搜索功能
         */
        _setupPracticeSearch() {
            const searchInput = document.getElementById('practice-search-input');
            if (searchInput) {
                let searchTimeout;
                searchInput.addEventListener('input', (e) => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        this._handlePracticeSearch(e.target.value);
                    }, 300);
                });
            }
        },

        /**
         * 处理Practice搜索
         */
        _handlePracticeSearch(searchTerm) {
            const examIndex = hpCore.getExamIndex();
            if (!examIndex) return;

            let filtered = examIndex;
            if (searchTerm) {
                filtered = examIndex.filter(exam => {
                    const title = (exam.title || '').toLowerCase();
                    const type = (exam.type || '').toLowerCase();
                    const category = (exam.category || '').toLowerCase();
                    const searchLower = searchTerm.toLowerCase();

                    return title.includes(searchLower) ||
                           type.includes(searchLower) ||
                           category.includes(searchLower);
                });
            }

            this._renderPracticeGridWithData(filtered);
        },

        /**
         * 设置Practice过滤器
         */
        _setupPracticeFilters() {
            const filterButtons = document.querySelectorAll('.flex.border-b a');
            filterButtons.forEach((button, index) => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();

                    // 更新按钮状态
                    filterButtons.forEach(btn => {
                        btn.classList.remove('border-b-[3px]', 'border-b-white');
                        btn.classList.add('border-b-[3px]', 'border-b-transparent');
                        btn.querySelector('p').classList.remove('text-white');
                        btn.querySelector('p').classList.add('text-[#b99da1]');
                    });

                    button.classList.remove('border-b-[3px]', 'border-b-transparent');
                    button.classList.add('border-b-[3px]', 'border-b-white');
                    button.querySelector('p').classList.remove('text-[#b99da1]');
                    button.querySelector('p').classList.add('text-white');

                    // 应用过滤器
                    this._handlePracticeFilter(index);
                });
            });
        },

        /**
         * 处理Practice过滤器
         */
        _handlePracticeFilter(filterIndex) {
            const examIndex = hpCore.getExamIndex();
            if (!examIndex) return;

            let filtered = examIndex;
            switch (filterIndex) {
                case 0: // 全部
                    filtered = examIndex;
                    break;
                case 1: // 阅读
                    filtered = examIndex.filter(e => e.type === 'reading');
                    break;
                case 2: // 听力
                    filtered = examIndex.filter(e => e.type === 'listening');
                    break;
            }

            this._renderPracticeGridWithData(filtered);
        },

        /**
         * 渲染Practice网格（带数据）
         */
        _renderPracticeGridWithData(exams) {
            const container = document.getElementById('practice-exam-grid');
            if (!container) return;

            const records = hpCore.getRecords();

            // 网格布局修复：保持原有grid布局，使用增量更新
            const shouldUseIncrementalUpdate = window.performanceOptimizer && exams.length > 20;

            if (shouldUseIncrementalUpdate) {
                // 性能优化：增量更新，保持网格布局
                this._incrementalUpdateGrid(container, exams, records);
            } else {
                // 直接渲染：使用DocumentFragment
                const fragment = document.createDocumentFragment();

                exams.forEach(exam => {
                    const element = this._createPracticeCardElement(exam, null, records);
                    fragment.appendChild(element);
                });

                // 清空容器并添加新元素
                container.innerHTML = '';
                container.appendChild(fragment);
            }
        },

        /**
         * 创建练习卡片DOM元素 - Performance optimized DOM creation
         */
        _createPracticeCardElement(exam, index = null, records) {
            const isCompleted = records.some(record =>
                record.examId === exam.id || record.title === exam.title
            );

            const bestScore = isCompleted ?
                Math.max(...records
                    .filter(record => record.examId === exam.id || record.title === exam.title)
                    .map(record => (record.score ?? record.percentage ?? 0))) : 0;

            // 主容器
            const examCard = document.createElement('div');
            examCard.className = 'exam-card';
            examCard.style.cssText = `
                background: rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 20px;
                cursor: pointer;
                transition: all 0.3s ease;
            `;

            // 事件委托：存储exam ID在data属性中
            examCard.dataset.examId = exam.id;

            // 标题
            const title = document.createElement('div');
            title.className = 'exam-title';
            title.style.cssText = 'font-weight: 600; margin-bottom: 10px;';
            title.textContent = exam.title || '无标题';

            // 元信息
            const meta = document.createElement('div');
            meta.className = 'exam-meta';
            meta.style.cssText = 'opacity: 0.7; margin-bottom: 15px;';
            meta.innerHTML = `
                <span>${exam.type === 'reading' ? '📖 阅读' : '🎧 听力'}</span>
                <span>${exam.category || 'P1'}</span>
                ${isCompleted ? `<span>最佳 ${bestScore}%</span>` : ''}
            `;

            // 操作按钮
            const actions = document.createElement('div');
            actions.className = 'exam-actions';
            actions.style.cssText = 'display: flex; gap: 10px;';

            const startBtn = document.createElement('button');
            startBtn.className = 'btn hp-practice-start';
            startBtn.textContent = isCompleted ? '重新练习' : '开始练习';
            startBtn.dataset.examId = exam.id;

            const pdfBtn = document.createElement('button');
            pdfBtn.className = 'btn btn-secondary hp-practice-pdf';
            pdfBtn.textContent = '查看PDF';
            pdfBtn.dataset.examId = exam.id;

            actions.appendChild(startBtn);
            actions.appendChild(pdfBtn);

            // 组装元素
            examCard.appendChild(title);
            examCard.appendChild(meta);
            examCard.appendChild(actions);

            // 设置事件委托（只设置一次）
            this._setupEventDelegation();

            return examCard;
        },

        /**
         * 设置事件委托 - 解决handler引用问题
         */
        _setupEventDelegation() {
            if (this._isEventDelegationSetup) return;

            // 在document或容器上设置事件委托
            const delegationHandler = (e) => {
                // 卡片点击
                const examCard = e.target.closest('.exam-card');
                if (examCard && examCard.dataset.examId) {
                    // 只有点击卡片本身（不是按钮）才触发
                    if (e.target === examCard || e.target.closest('.exam-title, .exam-meta')) {
                        this._openPracticeExam(examCard.dataset.examId);
                        return;
                    }
                }

                // 开始练习按钮
                const startBtn = e.target.closest('.hp-practice-start');
                if (startBtn && startBtn.dataset.examId) {
                    e.stopPropagation();
                    this._openPracticeExam(startBtn.dataset.examId);
                    return;
                }

                // PDF按钮
                const pdfBtn = e.target.closest('.hp-practice-pdf');
                if (pdfBtn && pdfBtn.dataset.examId) {
                    e.stopPropagation();
                    this._viewPracticePDF(pdfBtn.dataset.examId);
                    return;
                }
            };

            // 使用document作为委托目标（确保能捕获所有事件）
            document.addEventListener('click', delegationHandler);
            this._delegationHandler = delegationHandler;
            this._isEventDelegationSetup = true;

            console.log('[HP-Design-Iterations-Fix] 事件委托已设置');
        },

        /**
         * 网格增量更新 - 保持grid布局的高性能渲染
         */
        _incrementalUpdateGrid(container, exams, records) {
            // 使用requestAnimationFrame批量处理
            const updateGrid = () => {
                // 检查是否需要完全重建
                const currentCards = container.querySelectorAll('.exam-card');
                const currentCount = currentCards.length;
                const targetCount = exams.length;

                if (Math.abs(currentCount - targetCount) > targetCount * 0.3) {
                    // 差异过大，完全重建
                    this._fullRebuildGrid(container, exams, records);
                } else {
                    // 增量更新
                    this._smartUpdateGrid(container, exams, records, currentCards);
                }
            };

            // 使用PerformanceOptimizer的优化渲染
            if (window.performanceOptimizer && window.performanceOptimizer.optimizeRender) {
                const optimizedUpdate = window.performanceOptimizer.optimizeRender(updateGrid);
                optimizedUpdate();
            } else {
                requestAnimationFrame(updateGrid);
            }
        },

        /**
         * 完全重建网格
         */
        _fullRebuildGrid(container, exams, records) {
            const fragment = document.createDocumentFragment();

            // 分批处理避免阻塞UI
            const batchSize = 10;
            let currentIndex = 0;

            const processBatch = () => {
                const endIndex = Math.min(currentIndex + batchSize, exams.length);

                for (let i = currentIndex; i < endIndex; i++) {
                    const element = this._createPracticeCardElement(exams[i], i, records);
                    fragment.appendChild(element);
                }

                currentIndex = endIndex;

                if (currentIndex < exams.length) {
                    // 继续处理下一批
                    if (window.performanceOptimizer && window.performanceOptimizer.throttle) {
                        const throttledProcess = window.performanceOptimizer.throttle(processBatch, 16);
                        throttledProcess();
                    } else {
                        setTimeout(processBatch, 16);
                    }
                } else {
                    // 完成，更新DOM
                    container.innerHTML = '';
                    container.appendChild(fragment);
                }
            };

            processBatch();
        },

        /**
         * 智能更新网格 - 复用现有元素
         */
        _smartUpdateGrid(container, exams, records, currentCards) {
            const fragment = document.createDocumentFragment();
            const existingCards = Array.from(currentCards);
            let cardIndex = 0;

            exams.forEach((exam, index) => {
                if (cardIndex < existingCards.length) {
                    // 复用现有卡片，更新内容
                    const existingCard = existingCards[cardIndex];
                    const updatedCard = this._updatePracticeCardElement(existingCard, exam, index, records);
                    fragment.appendChild(updatedCard);
                    cardIndex++;
                } else {
                    // 创建新卡片
                    const newCard = this._createPracticeCardElement(exam, index, records);
                    fragment.appendChild(newCard);
                }
            });

            // 移除多余的卡片
            while (cardIndex < existingCards.length) {
                const extraCard = existingCards[cardIndex];
                if (extraCard.parentNode) {
                    extraCard.parentNode.removeChild(extraCard);
                }
                cardIndex++;
            }

            // 更新容器
            container.innerHTML = '';
            container.appendChild(fragment);
        },

        /**
         * 更新现有练习卡片元素 - 事件委托版本
         */
        _updatePracticeCardElement(existingCard, exam, index, records) {
            const isCompleted = records.some(record =>
                record.examId === exam.id || record.title === exam.title
            );

            const bestScore = isCompleted ?
                Math.max(...records
                    .filter(record => record.examId === exam.id || record.title === exam.title)
                    .map(record => (record.score ?? record.percentage ?? 0))) : 0;

            // 更新exam ID（事件委托依赖这个）
            existingCard.dataset.examId = exam.id;

            // 更新标题
            const titleElement = existingCard.querySelector('.exam-title');
            if (titleElement) {
                titleElement.textContent = exam.title || '无标题';
            }

            // 更新元信息
            const metaElement = existingCard.querySelector('.exam-meta');
            if (metaElement) {
                metaElement.innerHTML = `
                    <span>${exam.type === 'reading' ? '📖 阅读' : '🎧 听力'}</span>
                    <span>${exam.category || 'P1'}</span>
                    ${isCompleted ? `<span>最佳 ${bestScore}%</span>` : ''}
                `;
            }

            // 更新按钮exam ID和文本
            const startBtn = existingCard.querySelector('.hp-practice-start');
            if (startBtn) {
                startBtn.dataset.examId = exam.id;
                startBtn.textContent = isCompleted ? '重新练习' : '开始练习';
            }

            const pdfBtn = existingCard.querySelector('.hp-practice-pdf');
            if (pdfBtn) {
                pdfBtn.dataset.examId = exam.id;
            }

            // 事件委托已设置，无需重新绑定事件
            return existingCard;
        },

        /**
         * 打开Practice题目
         */
        _openPracticeExam(examId) {
            if (window.openExam) {
                window.openExam(examId);
            } else {
                alert('题目打开功能开发中...');
            }
        },

        /**
         * 查看Practice PDF
         */
        _viewPracticePDF(examId) {
            const exam = hpCore.getExamById(examId);
            if (exam && exam.pdfFilename) {
                if (window.openPDFSafely) {
                    window.openPDFSafely(exam.pdfFilename, exam.title);
                } else {
                    window.open(exam.pdfFilename, '_blank');
                }
            } else {
                alert('PDF文件不存在');
            }
        },

        /**
         * 刷新Practice数据
         */
        _refreshPracticeData() {
            if (typeof loadLibrary === 'function') {
                loadLibrary(true);
                setTimeout(() => {
                    this._renderPracticeGrid();
                }, 1000);
            }
        },

        /**
         * 修复History页面
         */
        _fixHistoryPage() {
            console.log('[HP-Design-Iterations-Fix] 修复History页面');

            // 渲染成就
            this._renderHistoryAchievements();

            // 渲染练习历史表格
            this._renderHistoryTable();

            // 渲染练习趋势
            this._renderHistoryTrends();

            this.pagesStatus.history.functional = true;
            console.log('[HP-Design-Iterations-Fix] History页面修复完成');
        },

        /**
         * 渲染History成就
         */
        _renderHistoryAchievements() {
            const container = document.getElementById('achievements-grid');
            if (!container) return;

            const records = hpCore.getRecords();
            const examIndex = hpCore.getExamIndex();

            const achievements = [
                {
                    icon: '⏰',
                    title: 'First Session',
                    description: 'Complete your first practice session.',
                    unlocked: records.length > 0
                },
                {
                    icon: '✅',
                    title: 'Score Master',
                    description: 'Achieve a score of 7.0 or higher.',
                    unlocked: records.some(r => (r.score || 0) >= 70)
                },
                {
                    icon: '🔥',
                    title: 'Consistent Learner',
                    description: 'Complete 5 practice sessions in a week.',
                    unlocked: this._checkWeeklyStreak(records, 5)
                },
                {
                    icon: '💯',
                    title: 'Perfect Score',
                    description: 'Achieve a perfect score in any section.',
                    unlocked: records.some(r => (r.score || 0) >= 100)
                }
            ];

            container.innerHTML = achievements.map(achievement => `
                <div class="bg-[#271c1d] rounded-lg p-4 border border-[#543b3f] flex flex-col items-center text-center ${achievement.unlocked ? 'opacity-100' : 'opacity-50'}">
                    <div class="w-16 h-16 rounded-full ${achievement.unlocked ? 'bg-gradient-to-r from-yellow-400 to-orange-500' : 'bg-gray-600'} flex items-center justify-center mb-3">
                        <span style="font-size: 24px;">${achievement.icon}</span>
                    </div>
                    <p class="text-white text-sm font-bold leading-normal">${achievement.title}</p>
                    <p class="text-gray-400 text-xs mt-1">${achievement.description}</p>
                    ${achievement.unlocked ? '<span class="text-green-400 text-xs mt-2">✓ 已解锁</span>' : '<span class="text-gray-500 text-xs mt-2">🔒 未解锁</span>'}
                </div>
            `).join('');
        },

        /**
         * 检查每周连续天数
         */
        _checkWeeklyStreak(records, targetDays) {
            if (records.length === 0) return false;

            const last7Days = [];
            for (let i = 0; i < 7; i++) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toDateString();

                const dayRecords = records.filter(r => {
                    const recordDate = new Date(r.date);
                    return recordDate.toDateString() === dateStr;
                });

                if (dayRecords.length > 0) {
                    last7Days.push(dateStr);
                }
            }

            return last7Days.length >= targetDays;
        },

        /**
         * 渲染History表格
         */
        _renderHistoryTable() {
            const container = document.getElementById('practice-history-table');
            if (!container) return;

            const records = hpCore.getRecords();

            if (!records || records.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px;">
                        <div style="font-size: 4rem; margin-bottom: 20px;">📝</div>
                        <h3 style="margin-bottom: 10px;">暂无练习历史</h3>
                        <p style="margin-bottom: 20px; opacity: 0.7;">开始练习后将显示历史记录</p>
                        <button class="btn" onclick="hpDesignIterationsFix._navigateToPage('practice.html')">开始练习</button>
                    </div>
                `;
                return;
            }

            // 按时间排序
            const sortedRecords = records.sort((a, b) => new Date(b.date) - new Date(a.date));

            container.innerHTML = `
                <table style="flex: 1;">
                    <thead>
                        <tr style="background: #271c1d;">
                            <th style="padding: 12px 16px; text-left; text-white; font-medium;">日期</th>
                            <th style="padding: 12px 16px; text-left; text-white; font-medium;">题目</th>
                            <th style="padding: 12px 16px; text-left; text-white; font-medium;">类型</th>
                            <th style="padding: 12px 16px; text-left; text-white; font-medium;">分数</th>
                            <th style="padding: 12px 16px; text-left; text-white; font-medium;">用时</th>
                            <th style="padding: 12px 16px; text-left; text-white; font-medium;">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sortedRecords.map(record => {
                            const score = record.score || (record.realData ? record.realData.percentage : 0);
                            const duration = record.duration || (record.realData ? record.realData.duration : 0);
                            const scoreClass = this._getScoreClass(score);

                            return `
                                <tr style="border-top: 1px solid #543b3f;">
                                    <td style="padding: 12px 16px; color: #b99da1;">${new Date(record.date).toLocaleDateString()}</td>
                                    <td style="padding: 12px 16px; color: #b99da1;">${record.title || '未命名练习'}</td>
                                    <td style="padding: 12px 16px; color: #b99da1;">${record.type === 'reading' ? '阅读' : '听力'}</td>
                                    <td style="padding: 12px 16px; color: #b99da1;">${score}%</td>
                                    <td style="padding: 12px 16px; color: #b99da1;">${this._formatDuration(duration)}</td>
                                    <td style="padding: 12px 16px;">
                                        <button class="btn btn-sm" onclick="hpDesignIterationsFix._viewHistoryDetails('${record.id}')">详情</button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        },

        /**
         * 渲染History趋势
         */
        _renderHistoryTrends() {
            const container = document.getElementById('practice-trend-grid');
            if (!container) return;

            const records = hpCore.getRecords();

            if (!records || records.length === 0) {
                container.innerHTML = `
                    <div style="flex: 1; text-align: center; padding: 40px;">
                        <div style="font-size: 3rem; margin-bottom: 15px;">📈</div>
                        <p style="margin-bottom: 10px;">暂无趋势数据</p>
                        <p style="opacity: 0.7; font-size: 0.9rem;">需要更多练习记录来生成趋势图表</p>
                    </div>
                `;
                return;
            }

            const avgScore = records.length > 0 ?
                Math.round(records.reduce((sum, record) => sum + (record.score || 0), 0) / records.length) : 0;

            const streakDays = this._calculateStreakDays(records);

            container.innerHTML = `
                <div style="flex: 1; background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; text-align: center;">
                    <h4 style="margin-bottom: 10px;">平均分数趋势</h4>
                    <div style="font-size: 3rem; font-weight: bold; color: #primary; margin-bottom: 10px;">${avgScore}%</div>
                    <p style="opacity: 0.7; font-size: 0.9rem;">最近${Math.min(records.length, 10)}次练习</p>
                </div>
                <div style="flex: 1; background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; text-align: center;">
                    <h4 style="margin-bottom: 10px;">连续练习天数</h4>
                    <div style="font-size: 3rem; font-weight: bold; color: #primary; margin-bottom: 10px;">${streakDays}</div>
                    <p style="opacity: 0.7; font-size: 0.9rem;">保持连续练习的习惯</p>
                </div>
            `;
        },

        /**
         * 计算连续天数
         */
        _calculateStreakDays(records) {
            if (records.length === 0) return 0;

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let streak = 0;
            let currentDate = new Date(today);

            while (true) {
                const dateStr = currentDate.toDateString();
                const hasRecord = records.some(record => {
                    const recordDate = new Date(record.date);
                    recordDate.setHours(0, 0, 0, 0);
                    return recordDate.toDateString() === dateStr;
                });

                if (hasRecord) {
                    streak++;
                    currentDate.setDate(currentDate.getDate() - 1);
                } else {
                    break;
                }
            }

            return streak;
        },

        /**
         * 查看历史详情
         */
        _viewHistoryDetails(recordId) {
            if (window.practiceRecordModal && typeof window.practiceRecordModal.showById === 'function') {
                window.practiceRecordModal.showById(recordId);
            } else {
                alert('详情查看功能开发中...');
            }
        },

        /**
         * 修复Setting页面
         */
        _fixSettingPage() {
            console.log('[HP-Design-Iterations-Fix] 修复Setting页面');

            // 渲染系统信息
            this._renderSettingSystemInfo();

            // 绑定设置按钮事件
            this._bindSettingButtons();

            this.pagesStatus.setting.functional = true;
            console.log('[HP-Design-Iterations-Fix] Setting页面修复完成');
        },

        /**
         * 渲染Setting系统信息
         */
        _renderSettingSystemInfo() {
            const container = document.getElementById('system-info-grid');
            if (!container) return;

            const examIndex = hpCore.getExamIndex();
            if (!examIndex) return;

            const readingExams = examIndex.filter(e => e.type === 'reading');
            const listeningExams = examIndex.filter(e => e.type === 'listening');
            const htmlExams = examIndex.filter(e => e.hasHtml);
            const pdfExams = examIndex.filter(e => e.pdfFilename);

            container.innerHTML = `
                <div style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; text-align: center;">
                    <p style="opacity: 0.7; margin-bottom: 10px;">题目总数</p>
                    <p style="font-size: 2rem; font-weight: bold;">${examIndex.length}</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; text-align: center;">
                    <p style="opacity: 0.7; margin-bottom: 10px;">阅读题目</p>
                    <p style="font-size: 2rem; font-weight: bold;">${readingExams.length}</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; text-align: center;">
                    <p style="opacity: 0.7; margin-bottom: 10px;">听力题目</p>
                    <p style="font-size: 2rem; font-weight: bold;">${listeningExams.length}</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; text-align: center;">
                    <p style="opacity: 0.7; margin-bottom: 10px;">HTML题目</p>
                    <p style="font-size: 2rem; font-weight: bold;">${htmlExams.length}</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; text-align: center;">
                    <p style="opacity: 0.7; margin-bottom: 10px;">PDF题目</p>
                    <p style="font-size: 2rem; font-weight: bold;">${pdfExams.length}</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; text-align: center;">
                    <p style="opacity: 0.7; margin-bottom: 10px;">最后更新</p>
                    <p style="font-size: 2rem; font-weight: bold;">${new Date().toLocaleDateString()}</p>
                </div>
            `;
        },

        /**
         * 绑定Setting按钮事件
         */
        _bindSettingButtons() {
            // 清除缓存按钮
            const clearCacheBtns = document.querySelectorAll('button:contains("清除缓存")');
            clearCacheBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleClearCache());
            });

            // 加载题库按钮
            const loadLibraryBtns = document.querySelectorAll('button:contains("加载题库")');
            loadLibraryBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleLoadLibrary());
            });

            // 题库配置切换按钮
            const configBtns = document.querySelectorAll('button:contains("题库配置")');
            configBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleLibraryConfig());
            });

            // 强制刷新题库按钮
            const refreshBtns = document.querySelectorAll('button:contains("强制刷新")');
            refreshBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleForceRefresh());
            });

            // 创建备份按钮
            const backupBtns = document.querySelectorAll('button:contains("创建备份")');
            backupBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleCreateBackup());
            });

            // 备份列表按钮
            const backupListBtns = document.querySelectorAll('button:contains("备份列表")');
            backupListBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleBackupList());
            });

            // 导出数据按钮
            const exportBtns = document.querySelectorAll('button:contains("导出数据")');
            exportBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleExportData());
            });

            // 导入数据按钮
            const importBtns = document.querySelectorAll('button:contains("导入数据")');
            importBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleImportData());
            });

            // 主题切换按钮
            const themeBtns = document.querySelectorAll('button:contains("主题切换")');
            themeBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleThemeSwitch());
            });
        },

        /**
         * 处理清除缓存
         */
        _handleClearCache() {
            if (confirm('确定要清除所有缓存数据吗？此操作不可撤销！')) {
                localStorage.clear();
                sessionStorage.clear();
                hpCore.showNotification('缓存已清除', 'success');
                setTimeout(() => location.reload(), 1500);
            }
        },

        /**
         * 处理加载题库
         */
        _handleLoadLibrary() {
            hpCore.showNotification('正在重新加载题库...', 'info');
            if (typeof loadLibrary === 'function') {
                loadLibrary(true);
            }
            setTimeout(() => {
                hpCore.showNotification('题库重新加载完成', 'success');
                this._renderSettingSystemInfo();
            }, 2000);
        },

        /**
         * 处理题库配置
         */
        _handleLibraryConfig() {
            hpCore.showNotification('题库配置功能开发中...', 'info');
        },

        /**
         * 处理强制刷新
         */
        _handleForceRefresh() {
            hpCore.showNotification('正在强制刷新题库...', 'info');
            this._handleLoadLibrary();
        },

        /**
         * 处理创建备份
         */
        _handleCreateBackup() {
            const data = {
                examData: hpCore.getExamIndex() || [],
                practiceRecords: hpCore.getRecords() || [],
                backupDate: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hp-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            hpCore.showNotification('备份创建成功', 'success');
        },

        /**
         * 处理备份列表
         */
        _handleBackupList() {
            hpCore.showNotification('备份列表功能开发中...', 'info');
        },

        /**
         * 处理导出数据
         */
        _handleExportData() {
            const data = {
                examData: hpCore.getExamIndex() || [],
                practiceRecords: hpCore.getRecords() || [],
                exportDate: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hp-data-export-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            hpCore.showNotification('数据导出成功', 'success');
        },

        /**
         * 处理导入数据
         */
        _handleImportData() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = JSON.parse(e.target.result);
                        if (data.practiceRecords && Array.isArray(data.practiceRecords)) {
                            const records = hpCore.getRecords();
                            data.practiceRecords.forEach(record => {
                                if (!records.find(r => r.id === record.id)) {
                                    records.push(record);
                                }
                            });
                            hpCore.saveRecords(records);
                            hpCore.showNotification('数据导入成功', 'success');
                        }
                    } catch (error) {
                        hpCore.showNotification('数据导入失败：格式错误', 'error');
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        },

        /**
         * 处理主题切换
         */
        _handleThemeSwitch() {
            if (window.HPTheme && typeof window.HPTheme.open === 'function') {
                window.HPTheme.open();
            } else {
                hpCore.showNotification('主题切换功能开发中...', 'info');
            }
        },

        /**
         * 获取分数样式类
         */
        _getScoreClass(score) {
            if (score >= 90) return 'score-excellent';
            if (score >= 80) return 'score-good';
            if (score >= 60) return 'score-fair';
            return 'score-poor';
        },

        /**
         * 格式化时长
         */
        _formatDuration(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            if (hours > 0) {
                return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        },

        /**
         * 设置全局事件处理器
         */
        _setupGlobalEventHandlers() {
            // 监听数据更新事件
            hpCore.on('dataUpdated', (data) => {
                this._onDataUpdated(data);
            });

            // 监听练习完成事件
            hpCore.on('practiceCompleted', (data) => {
                this._onPracticeCompleted(data);
            });

            // 监听页面切换事件
            hpCore.on('pageChanged', (page) => {
                this._onPageChanged(page);
            });
        },

        /**
         * 设置数据同步
         */
        _setupDataSynchronization() {
            // 定期检查页面状态
            setInterval(() => {
                this._checkPageStatus();
            }, 5000);

            // 监听存储变化
            window.addEventListener('storage', (e) => {
                if (e.key === 'exam_system_practice_records' ||
                    e.key === 'exam_system_exam_index') {
                    this._onStorageChanged(e);
                }
            });
        },

        /**
         * 数据更新时的处理
         */
        _onDataUpdated(data) {
            console.log('[HP-Design-Iterations-Fix] 数据已更新');

            // 根据当前页面更新相应内容
            switch (this.currentPage) {
                case 'welcome':
                    this._renderWelcomeCards();
                    this._renderWelcomeStats();
                    break;
                case 'practice':
                    this._renderPracticeGrid();
                    break;
                case 'history':
                    this._renderHistoryAchievements();
                    this._renderHistoryTable();
                    this._renderHistoryTrends();
                    break;
                case 'setting':
                    this._renderSettingSystemInfo();
                    break;
            }
        },

        /**
         * 练习完成时的处理
         */
        _onPracticeCompleted(data) {
            console.log('[HP-Design-Iterations-Fix] 练习完成');

            // 更新相关页面
            if (this.currentPage === 'history') {
                this._renderHistoryTable();
                this._renderHistoryTrends();
            }

            if (this.currentPage === 'welcome') {
                this._renderWelcomeStats();
            }
        },

        /**
         * 页面切换时的处理
         */
        _onPageChanged(page) {
            console.log(`[HP-Design-Iterations-Fix] 页面已切换到: ${page}`);
            this.currentPage = page;
            this._fixCurrentPage();
        },

        /**
         * 存储变化时的处理
         */
        _onStorageChanged(e) {
            console.log('[HP-Design-Iterations-Fix] 检测到存储变化');
            this._onDataUpdated({});
        },

        /**
         * 检查页面状态
         */
        _checkPageStatus() {
            // 检查当前页面的功能状态
            this._fixCurrentPage();
        },

        /**
         * 获取插件状态
         */
        getStatus() {
            return {
                isInitialized: this.isInitialized,
                currentPage: this.currentPage,
                pagesStatus: this.pagesStatus
            };
        },

        /**
         * 资源清理 - 事件委托版本
         */
        cleanup() {
            console.log('[HP-Design-Iterations-Fix] 清理插件资源');

            // 清理事件委托
            if (this._delegationHandler) {
                document.removeEventListener('click', this._delegationHandler);
                this._delegationHandler = null;
            }
            this._isEventDelegationSetup = false;

            // 网格布局不再使用VirtualScroller，无需额外清理
        }
    };

    // 导出到全局
    window.hpDesignIterationsFix = hpDesignIterationsFix;

    // 自动初始化
    hpCore.ready(() => {
        console.log('[HP-Design-Iterations-Fix] hpCore已就绪，开始初始化');
        hpDesignIterationsFix.init();
    });

    console.log('[HP-Design-Iterations-Fix] HP设计迭代页面修复插件已加载');

})();
