/**
 * HP Practice页面渲染插件
 * 负责Practice页面的题目网格渲染、搜索过滤和交互
 */

(function() {
    'use strict';

    // 等待hpCore准备就绪
    if (typeof hpCore === 'undefined') {
        console.error('[HP Practice Render] hpCore未定义');
        return;
    }

    const hpPracticeRender = {
        // 插件状态
        isInitialized: false,
        currentFilter: {
            type: 'all',
            category: 'all',
            searchTerm: ''
        },
        filteredExams: [],
        isLoading: false,

        /**
         * 初始化插件
         */
        init() {
            if (this.isInitialized) {
                console.log('[HP Practice Render] 插件已初始化，跳过重复初始化');
                return;
            }

            console.log('[HP Practice Render] 开始初始化Practice页面渲染插件');

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
                this._setupEventListeners();
                this._enhanceUI();
                this._loadInitialData();
                this.isInitialized = true;
                console.log('[HP Practice Render] 插件初始化完成');
            } catch (error) {
                console.error('[HP Practice Render] 初始化失败:', error);
            }
        },

        /**
         * 设置事件监听器
         */
        _setupEventListeners() {
            // 监听数据更新事件
            hpCore.on('dataUpdated', (data) => {
                console.log('[HP Practice Render] 收到数据更新事件');
                this._updateExamData(data);
            });

            // 监听搜索事件
            hpCore.on('searchChanged', (searchTerm) => {
                this._handleSearch(searchTerm);
            });

            // 监听过滤器变化事件
            hpCore.on('filterChanged', (filter) => {
                this._handleFilterChange(filter);
            });

            // 设置搜索框事件
            this._setupSearchBox();

            // 设置分类卡片事件
            this._setupCategoryCards();
        },

        /**
         * 设置搜索框事件
         */
        _setupSearchBox() {
            const searchBox = document.getElementById('searchBox') ||
                             document.querySelector('.search-box') ||
                             document.querySelector('input[placeholder*="搜索"]');

            if (searchBox) {
                // 移除现有的onkeyup事件监听器，避免冲突
                searchBox.removeAttribute('onkeyup');

                // 添加新的搜索事件
                let searchTimeout;
                searchBox.addEventListener('input', (e) => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        this._handleSearch(e.target.value);
                    }, 300); // 300ms防抖
                });

                // 添加搜索快捷键
                searchBox.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this._handleSearch(e.target.value);
                    } else if (e.key === 'Escape') {
                        e.target.value = '';
                        this._handleSearch('');
                    }
                });
            }
        },

        /**
         * 设置分类卡片事件
         */
        _setupCategoryCards() {
            const categoryCards = document.querySelectorAll('.category-card, .categories-grid .category-card');

            categoryCards.forEach(card => {
                card.addEventListener('click', (e) => {
                    e.preventDefault();
                    const type = card.dataset.type || this._getCategoryType(card);
                    const category = card.dataset.category || this._getCategoryValue(card);

                    if (type && category) {
                        this._handleCategoryClick(type, category);
                    }
                });
            });
        },

        /**
         * 获取分类卡片的类型
         */
        _getCategoryType(card) {
            const title = card.querySelector('.category-title')?.textContent || '';
            if (title.includes('阅读')) return 'reading';
            if (title.includes('听力')) return 'listening';
            return 'reading'; // 默认
        },

        /**
         * 获取分类卡片的值
         */
        _getCategoryValue(card) {
            const title = card.querySelector('.category-title')?.textContent || '';
            if (title.includes('P1')) return 'P1';
            if (title.includes('P2')) return 'P2';
            if (title.includes('P3')) return 'P3';
            if (title.includes('P4')) return 'P4';
            return 'P1'; // 默认
        },

        /**
         * 增强UI元素
         */
        _enhanceUI() {
            // 增强搜索框
            this._enhanceSearchBox();

            // 增强分类卡片
            this._enhanceCategoryCards();

            // 增强题目网格
            this._enhanceExamGrid();

            // 添加加载状态
            this._addLoadingIndicator();
        },

        /**
         * 增强搜索框
         */
        _enhanceSearchBox() {
            const searchBox = document.getElementById('searchBox') ||
                             document.querySelector('.search-box') ||
                             document.querySelector('input[placeholder*="搜索"]');

            if (searchBox) {
                searchBox.classList.add('enhanced-search');
                searchBox.placeholder = '🔍 搜索题目、类型或难度...';

                // 添加搜索建议
                this._addSearchSuggestions(searchBox);
            }
        },

        /**
         * 添加搜索建议
         */
        _addSearchSuggestions(searchBox) {
            const suggestions = [
                'P1 阅读', 'P2 阅读', 'P3 阅读',
                'P3 听力', 'P4 听力',
                '高频', '中频', '低频',
                '简单', '中等', '困难'
            ];

            let suggestionsContainer;

            searchBox.addEventListener('focus', () => {
                if (!suggestionsContainer) {
                    suggestionsContainer = this._createSuggestionsContainer(searchBox, suggestions);
                }
                suggestionsContainer.style.display = 'block';
            });

            searchBox.addEventListener('blur', () => {
                setTimeout(() => {
                    if (suggestionsContainer) {
                        suggestionsContainer.style.display = 'none';
                    }
                }, 200);
            });
        },

        /**
         * 创建建议容器
         */
        _createSuggestionsContainer(searchBox, suggestions) {
            const container = document.createElement('div');
            container.className = 'search-suggestions';
            container.style.cssText = `
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                z-index: 1000;
                max-height: 200px;
                overflow-y: auto;
                margin-top: 4px;
            `;

            suggestions.forEach(suggestion => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = suggestion;
                item.style.cssText = `
                    padding: 8px 12px;
                    cursor: pointer;
                    border-bottom: 1px solid #f1f5f9;
                    transition: background-color 0.2s;
                `;

                item.addEventListener('mouseenter', () => {
                    item.style.backgroundColor = '#f8fafc';
                });

                item.addEventListener('mouseleave', () => {
                    item.style.backgroundColor = 'transparent';
                });

                item.addEventListener('click', () => {
                    searchBox.value = suggestion;
                    this._handleSearch(suggestion);
                    container.style.display = 'none';
                });

                container.appendChild(item);
            });

            searchBox.parentElement.style.position = 'relative';
            searchBox.parentElement.appendChild(container);

            return container;
        },

        /**
         * 增强分类卡片
         */
        _enhanceCategoryCards() {
            const categoryCards = document.querySelectorAll('.category-card, .categories-grid .category-card');

            categoryCards.forEach((card, index) => {
                // 添加悬停效果
                card.addEventListener('mouseenter', () => {
                    card.style.transform = 'translateY(-5px) scale(1.02)';
                });

                card.addEventListener('mouseleave', () => {
                    card.style.transform = 'translateY(0) scale(1)';
                });

                // 添加加载动画
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';

                setTimeout(() => {
                    card.style.transition = 'all 0.5s ease';
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, index * 100 + 200);
            });
        },

        /**
         * 增强题目网格
         */
        _enhanceExamGrid() {
            const examGrid = document.getElementById('examGrid') ||
                           document.querySelector('.exam-grid') ||
                           document.querySelector('.categories-grid');

            if (examGrid) {
                examGrid.classList.add('enhanced-grid');

                // 添加虚拟滚动支持
                this._setupVirtualScrolling(examGrid);
            }
        },

        /**
         * 设置虚拟滚动
         */
        _setupVirtualScrolling(container) {
            if (this.filteredExams.length < 50) return; // 小数据量不需要虚拟滚动

            // 简单的虚拟滚动实现
            const itemHeight = 120; // 估算每个题目卡片的高度
            const containerHeight = Math.min(window.innerHeight * 0.7, 600);
            const visibleCount = Math.ceil(containerHeight / itemHeight) + 5; // 可见数量+缓冲

            container.style.maxHeight = containerHeight + 'px';
            container.style.overflowY = 'auto';

            // 监听滚动事件
            container.addEventListener('scroll', this._throttle(() => {
                this._updateVisibleItems(container, itemHeight, visibleCount);
            }, 100));
        },

        /**
         * 更新可见项目
         */
        _updateVisibleItems(container, itemHeight, visibleCount) {
            const scrollTop = container.scrollTop;
            const startIndex = Math.floor(scrollTop / itemHeight);
            const endIndex = Math.min(startIndex + visibleCount, this.filteredExams.length);

            // 这里可以实现更复杂的虚拟滚动逻辑
            // 目前只做基本的性能优化
        },

        /**
         * 添加加载指示器
         */
        _addLoadingIndicator() {
            const browseSection = document.getElementById('browse') ||
                                document.querySelector('.page:has(#examGrid)') ||
                                document.querySelector('.page:has(.exam-grid)');

            if (browseSection && !document.getElementById('browseLoading')) {
                const loadingDiv = document.createElement('div');
                loadingDiv.id = 'browseLoading';
                loadingDiv.className = 'loading';
                loadingDiv.innerHTML = `
                    <div class="spinner"></div>
                    <p>正在加载题库...</p>
                `;
                loadingDiv.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(255, 255, 255, 0.9);
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    z-index: 1000;
                    display: none;
                `;

                browseSection.appendChild(loadingDiv);
            }
        },

        /**
         * 加载初始数据
         */
        _loadInitialData() {
            const examIndex = hpCore.getExamIndex();
            if (examIndex && examIndex.length > 0) {
                this._updateExamData({ examIndex });
            }
        },

        /**
         * 更新题目数据
         */
        _updateExamData(data) {
            const examIndex = data?.examIndex || hpCore.getExamIndex();
            if (!examIndex) return;

            this._updateCategoryStats(examIndex);
            this._applyFilters();
        },

        /**
         * 更新分类统计
         */
        _updateCategoryStats(examIndex) {
            const categoryStats = {
                'reading': { 'P1': { total: 0, completed: 0 }, 'P2': { total: 0, completed: 0 }, 'P3': { total: 0, completed: 0 } },
                'listening': { 'P3': { total: 0, completed: 0 }, 'P4': { total: 0, completed: 0 } }
            };

            // 统计题目数量
            examIndex.forEach(exam => {
                const type = (exam.type || '').toLowerCase().trim();
                const category = (exam.category || exam.part || '').toUpperCase().trim();

                if (categoryStats[type] && categoryStats[type][category]) {
                    categoryStats[type][category].total++;
                }
            });

            // 统计完成数量
            const records = hpCore.getRecords();
            records.forEach(record => {
                const exam = examIndex.find(e => e.id === record.examId || e.title === record.title);
                if (exam) {
                    const type = (exam.type || '').toLowerCase().trim();
                    const category = (exam.category || exam.part || '').toUpperCase().trim();

                    if (categoryStats[type] && categoryStats[type][category]) {
                        categoryStats[type][category].completed++;
                    }
                }
            });

            // 更新UI显示
            Object.entries(categoryStats).forEach(([type, categories]) => {
                Object.entries(categories).forEach(([category, stats]) => {
                    const countEl = document.getElementById(`${type}-${category.toLowerCase()}-count`);
                    const completedEl = document.getElementById(`${type}-${category.toLowerCase()}-completed`);
                    const avgEl = document.getElementById(`${type}-${category.toLowerCase()}-avg`);

                    if (countEl) countEl.textContent = stats.total;
                    if (completedEl) completedEl.textContent = stats.completed;

                    // 计算平均分
                    const categoryRecords = records.filter(record => {
                        const exam = examIndex.find(e => e.id === record.examId || e.title === record.title);
                        return exam && (exam.type || '').toLowerCase().trim() === type &&
                               (exam.category || exam.part || '').toUpperCase().trim() === category;
                    });

                    const avgScore = categoryRecords.length > 0
                        ? Math.round(categoryRecords.reduce((sum, r) => sum + (r.score || 0), 0) / categoryRecords.length)
                        : 0;

                    if (avgEl) avgEl.textContent = avgScore + '%';
                });
            });
        },

        /**
         * 应用过滤器
         */
        _applyFilters() {
            const examIndex = hpCore.getExamIndex();
            if (!examIndex) return;

            let filtered = examIndex.filter(exam => {
                // 类型过滤
                if (this.currentFilter.type !== 'all' && exam.type !== this.currentFilter.type) {
                    return false;
                }

                // 分类过滤
                if (this.currentFilter.category !== 'all' &&
                    exam.category !== this.currentFilter.category &&
                    exam.part !== this.currentFilter.category) {
                    return false;
                }

                // 搜索过滤
                if (this.currentFilter.searchTerm) {
                    const searchTerm = this.currentFilter.searchTerm.toLowerCase();
                    const title = (exam.title || '').toLowerCase();
                    const description = (exam.description || '').toLowerCase();
                    const type = (exam.type || '').toLowerCase();
                    const category = (exam.category || exam.part || '').toLowerCase();

                    if (!title.includes(searchTerm) &&
                        !description.includes(searchTerm) &&
                        !type.includes(searchTerm) &&
                        !category.includes(searchTerm)) {
                        return false;
                    }
                }

                return true;
            });

            this.filteredExams = filtered;
            this._renderExams(filtered);
        },

        /**
         * 渲染题目列表
         */
        _renderExams(exams) {
            const container = document.getElementById('examGrid') ||
                            document.querySelector('.exam-grid') ||
                            document.querySelector('.categories-grid');

            if (!container) return;

            // 显示加载状态
            this._showLoading(true);

            // 异步渲染，避免阻塞UI
            setTimeout(() => {
                if (exams.length === 0) {
                    this._renderEmptyState(container);
                } else {
                    this._renderExamCards(container, exams);
                }

                this._showLoading(false);
            }, 100);
        },

        /**
         * 渲染空状态
         */
        _renderEmptyState(container) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📚</div>
                    <div class="empty-title">没有找到题目</div>
                    <div class="empty-description">尝试调整搜索条件或分类过滤器</div>
                    <button class="btn" onclick="hpPracticeRender._clearFilters()">清除过滤器</button>
                </div>
            `;
        },

        /**
         * 渲染题目卡片
         */
        _renderExamCards(container, exams) {
            const records = hpCore.getRecords();

            container.innerHTML = exams.map(exam => {
                const isCompleted = records.some(record =>
                    record.examId === exam.id || record.title === exam.title
                );

                const bestScore = isCompleted ?
                    Math.max(...records
                        .filter(record => record.examId === exam.id || record.title === exam.title)
                        .map(record => (record.score ?? record.percentage ?? 0))) : 0;

                return `
                    <div class="exam-card" onclick="hpPracticeRender._openExam('${exam.id}')">
                        <div class="exam-title">${exam.title || '无标题'}</div>
                        <div class="exam-meta">
                            <span>${exam.type === 'reading' ? '📖 阅读' : '🎧 听力'}</span>
                            <span>${exam.category || 'P1'}</span>
                            ${isCompleted ? `<span class="best-score">最佳 ${bestScore}%</span>` : ''}
                        </div>
                        <div class="exam-actions">
                            <button class="btn" onclick="event.stopPropagation(); hpPracticeRender._openExam('${exam.id}')">
                                ${isCompleted ? '重新练习' : '开始练习'}
                            </button>
                            <button class="btn btn-secondary" onclick="event.stopPropagation(); hpPracticeRender._viewExamPDF('${exam.id}')">
                                查看PDF
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        },

        /**
         * 显示/隐藏加载状态
         */
        _showLoading(show) {
            const loadingEl = document.getElementById('browseLoading');
            if (loadingEl) {
                loadingEl.style.display = show ? 'block' : 'none';
            }
            this.isLoading = show;
        },

        /**
         * 处理搜索
         */
        _handleSearch(searchTerm) {
            this.currentFilter.searchTerm = searchTerm;
            hpCore.emit('searchChanged', searchTerm);
            this._applyFilters();
        },

        /**
         * 处理分类点击
         */
        _handleCategoryClick(type, category) {
            this.currentFilter.type = type;
            this.currentFilter.category = category;
            hpCore.emit('filterChanged', this.currentFilter);
            this._applyFilters();

            // 显示对应题目列表
            this._showCategoryExams(type, category);
        },

        /**
         * 显示分类题目
         */
        _showCategoryExams(type, category) {
            const examIndex = hpCore.getExamIndex();
            const exams = examIndex.filter(exam => {
                const examType = (exam.type || '').toLowerCase().trim();
                const examCategory = (exam.category || exam.part || '').toUpperCase().trim();
                return examType === type && examCategory === category;
            });

            const typeText = type === 'reading' ? '阅读' : '听力';
            const modalTitle = document.getElementById('modalTitle');
            const modalExamList = document.getElementById('modalExamList');

            if (modalTitle) modalTitle.textContent = `${category} ${typeText}题目列表`;
            if (modalExamList) {
                this._renderExamCards(modalExamList, exams);
            }

            const modal = document.getElementById('examListModal');
            if (modal) modal.style.display = 'flex';
        },

        /**
         * 清除过滤器
         */
        _clearFilters() {
            this.currentFilter = {
                type: 'all',
                category: 'all',
                searchTerm: ''
            };

            const searchBox = document.getElementById('searchBox') ||
                             document.querySelector('.search-box') ||
                             document.querySelector('input[placeholder*="搜索"]');

            if (searchBox) searchBox.value = '';

            this._applyFilters();
        },

        /**
         * 打开题目
         */
        _openExam(examId) {
            hpCore.startExam(examId);
        },

        /**
         * 查看题目PDF
         */
        _viewExamPDF(examId) {
            hpCore.viewExamPDF(examId);
        },

        /**
         * 节流函数
         */
        _throttle(func, limit) {
            let inThrottle;
            return function() {
                const args = arguments;
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        },

        /**
         * 获取插件状态
         */
        getStatus() {
            return {
                isInitialized: this.isInitialized,
                filteredCount: this.filteredExams.length,
                currentFilter: this.currentFilter,
                isLoading: this.isLoading
            };
        }
    };

    // 导出到全局
    window.hpPracticeRender = hpPracticeRender;

    // 自动初始化
    hpCore.ready(() => {
        console.log('[HP Practice Render] hpCore已就绪，开始初始化');
        hpPracticeRender.init();
    });

    console.log('[HP Practice Render] Practice页面渲染插件已加载');

})();
