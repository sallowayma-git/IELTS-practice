/**
 * 题目浏览器组件
 * 处理题目列表的显示和筛选，支持网格和列表模式
 */
class ExamBrowser {
    constructor() {
        this.currentCategory = null;
        this.currentFrequency = null;
        this.viewMode = 'grid'; // 'grid' or 'list'
        this.sortBy = 'title'; // 'title', 'difficulty', 'frequency', 'completion'
        this.sortOrder = 'asc'; // 'asc' or 'desc'
        this.filters = {
            frequency: 'all',
            status: 'all',
            difficulty: 'all',
            questionType: 'all'
        };
        this.searchQuery = '';
        this.initialize();
    }

    /**
     * 初始化浏览器组件
     */
    initialize() {
        console.log('ExamBrowser component initialized');
        this.setupEventListeners();
        this.setupViewControls();
        this.setupSortControls();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 筛选器事件监听
        const frequencyFilter = document.getElementById('frequency-filter');
        const statusFilter = document.getElementById('status-filter');

        if (frequencyFilter) {
            frequencyFilter.addEventListener('change', (e) => {
                this.filters.frequency = e.target.value;
                this.refreshExamList();
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.filters.status = e.target.value;
                this.refreshExamList();
            });
        }

        // 题目卡片点击事件
        document.addEventListener('click', (e) => {
            const examCard = e.target.closest('.exam-card');
            if (examCard && !e.target.closest('button')) {
                const examId = examCard.dataset.examId;
                this.showExamPreview(examId);
            }

            // 题目操作按钮
            const actionBtn = e.target.closest('[data-exam-action]');
            if (actionBtn) {
                e.preventDefault();
                e.stopPropagation();
                const action = actionBtn.dataset.examAction;
                const examId = actionBtn.dataset.examId;
                this.handleExamAction(action, examId);
            }
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (document.getElementById('browse-view').classList.contains('active')) {
                switch (e.key) {
                    case 'g':
                        if (!e.ctrlKey && !e.metaKey) {
                            this.setViewMode('grid');
                        }
                        break;
                    case 'l':
                        if (!e.ctrlKey && !e.metaKey) {
                            this.setViewMode('list');
                        }
                        break;
                    case 'Escape':
                        this.closeExamPreview();
                        break;
                }
            }
        });
    }

    /**
     * 设置视图控制
     */
    setupViewControls() {
        const browseHeader = document.querySelector('.browse-header');
        if (!browseHeader) return;

        // 检查是否已存在视图控制
        if (browseHeader.querySelector('.view-controls')) return;

        const viewControls = document.createElement('div');
        viewControls.className = 'view-controls';
        viewControls.innerHTML = `
            <div class="view-mode-toggle">
                <button class="view-btn ${this.viewMode === 'grid' ? 'active' : ''}" data-view="grid" title="网格视图 (G)">
                    <span class="view-icon">⊞</span>
                </button>
                <button class="view-btn ${this.viewMode === 'list' ? 'active' : ''}" data-view="list" title="列表视图 (L)">
                    <span class="view-icon">☰</span>
                </button>
            </div>
            <div class="exam-search">
                <input type="text" id="exam-search-input" placeholder="搜索题目..." class="search-input-sm">
            </div>
        `;

        browseHeader.appendChild(viewControls);

        // 设置视图切换事件
        viewControls.addEventListener('click', (e) => {
            const viewBtn = e.target.closest('.view-btn');
            if (viewBtn) {
                const mode = viewBtn.dataset.view;
                this.setViewMode(mode);
            }
        });

        // 设置搜索事件
        const searchInput = viewControls.querySelector('#exam-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.searchQuery = e.target.value.trim().toLowerCase();
                this.refreshExamList();
            }, 300));
        }
    }

    /**
     * 设置排序控制
     */
    setupSortControls() {
        const browseFilters = document.querySelector('.browse-filters');
        if (!browseFilters) return;

        // 添加更多筛选选项
        const additionalFilters = document.createElement('div');
        additionalFilters.className = 'additional-filters';
        additionalFilters.innerHTML = `
            <select id="difficulty-filter" class="filter-select">
                <option value="all">全部难度</option>
                <option value="easy">简单</option>
                <option value="medium">中等</option>
                <option value="hard">困难</option>
            </select>
            <select id="sort-filter" class="filter-select">
                <option value="title-asc">标题 A-Z</option>
                <option value="title-desc">标题 Z-A</option>
                <option value="difficulty-asc">难度 ↑</option>
                <option value="difficulty-desc">难度 ↓</option>
                <option value="completion-desc">完成度 ↓</option>
                <option value="recent-desc">最近练习</option>
            </select>
        `;

        browseFilters.appendChild(additionalFilters);

        // 设置筛选事件
        const difficultyFilter = additionalFilters.querySelector('#difficulty-filter');
        const sortFilter = additionalFilters.querySelector('#sort-filter');

        if (difficultyFilter) {
            difficultyFilter.addEventListener('change', (e) => {
                this.filters.difficulty = e.target.value;
                this.refreshExamList();
            });
        }

        if (sortFilter) {
            sortFilter.addEventListener('change', (e) => {
                const [sortBy, sortOrder] = e.target.value.split('-');
                this.sortBy = sortBy;
                this.sortOrder = sortOrder;
                this.refreshExamList();
            });
        }
    }

    /**
     * 设置视图模式
     */
    setViewMode(mode) {
        this.viewMode = mode;
        
        // 更新按钮状态
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-view="${mode}"]`)?.classList.add('active');

        // 更新列表容器类名
        const examList = document.getElementById('exam-list');
        if (examList) {
            examList.className = mode === 'grid' ? 'exam-grid' : 'exam-list-view';
        }

        // 重新渲染
        this.refreshExamList();
    }

    /**
     * 显示指定分类的题目
     */
    showCategory(category, frequency = null) {
        this.currentCategory = category;
        this.currentFrequency = frequency;
        
        // 更新频率筛选器
        if (frequency) {
            this.filters.frequency = frequency;
            const frequencyFilter = document.getElementById('frequency-filter');
            if (frequencyFilter) {
                frequencyFilter.value = frequency;
            }
        }
        
        this.refreshExamList();
    }

    /**
     * 刷新题目列表
     */
    refreshExamList() {
        const examList = document.getElementById('exam-list');
        if (!examList) return;

        // 获取题目数据
        const examIndex = storage.get('exam_index', []);
        let filteredExams = [...examIndex];

        // 应用筛选条件
        filteredExams = this.applyFilters(filteredExams);

        // 应用搜索
        if (this.searchQuery) {
            filteredExams = this.applySearch(filteredExams);
        }

        // 应用排序
        filteredExams = this.applySorting(filteredExams);

        // 更新统计信息
        this.updateBrowseStats(filteredExams);

        // 渲染题目列表
        this.renderExamList(filteredExams);
    }

    /**
     * 应用筛选条件
     */
    applyFilters(exams) {
        let filtered = [...exams];

        // 按分类筛选
        if (this.currentCategory) {
            filtered = filtered.filter(exam => exam.category === this.currentCategory);
        }

        // 按频率筛选
        if (this.filters.frequency !== 'all') {
            filtered = filtered.filter(exam => exam.frequency === this.filters.frequency);
        }

        // 按难度筛选
        if (this.filters.difficulty !== 'all') {
            filtered = filtered.filter(exam => exam.difficulty === this.filters.difficulty);
        }

        // 按状态筛选
        if (this.filters.status !== 'all') {
            const practiceRecords = storage.get('practice_records', []);
            const completedExamIds = new Set(practiceRecords.map(r => r.examId));
            
            if (this.filters.status === 'completed') {
                filtered = filtered.filter(exam => completedExamIds.has(exam.id));
            } else if (this.filters.status === 'incomplete') {
                filtered = filtered.filter(exam => !completedExamIds.has(exam.id));
            }
        }

        return filtered;
    }

    /**
     * 应用搜索
     */
    applySearch(exams) {
        if (!this.searchQuery) return exams;

        return exams.filter(exam => {
            return exam.title.toLowerCase().includes(this.searchQuery) ||
                   exam.category.toLowerCase().includes(this.searchQuery) ||
                   (exam.tags && exam.tags.some(tag => tag.toLowerCase().includes(this.searchQuery))) ||
                   (exam.description && exam.description.toLowerCase().includes(this.searchQuery)) ||
                   (exam.questionTypes && exam.questionTypes.some(type => type.toLowerCase().includes(this.searchQuery)));
        });
    }

    /**
     * 应用排序
     */
    applySorting(exams) {
        const practiceRecords = storage.get('practice_records', []);
        
        return exams.sort((a, b) => {
            let aValue, bValue;

            switch (this.sortBy) {
                case 'title':
                    aValue = a.title.toLowerCase();
                    bValue = b.title.toLowerCase();
                    break;
                case 'difficulty':
                    const difficultyOrder = { 'easy': 1, 'medium': 2, 'hard': 3 };
                    aValue = difficultyOrder[a.difficulty] || 2;
                    bValue = difficultyOrder[b.difficulty] || 2;
                    break;
                case 'completion':
                    const aRecords = practiceRecords.filter(r => r.examId === a.id);
                    const bRecords = practiceRecords.filter(r => r.examId === b.id);
                    aValue = aRecords.length > 0 ? Math.max(...aRecords.map(r => r.accuracy || 0)) : 0;
                    bValue = bRecords.length > 0 ? Math.max(...bRecords.map(r => r.accuracy || 0)) : 0;
                    break;
                case 'recent':
                    const aRecentRecords = practiceRecords.filter(r => r.examId === a.id);
                    const bRecentRecords = practiceRecords.filter(r => r.examId === b.id);
                    aValue = aRecentRecords.length > 0 ? Math.max(...aRecentRecords.map(r => new Date(r.startTime).getTime())) : 0;
                    bValue = bRecentRecords.length > 0 ? Math.max(...bRecentRecords.map(r => new Date(r.startTime).getTime())) : 0;
                    break;
                default:
                    aValue = a.title.toLowerCase();
                    bValue = b.title.toLowerCase();
            }

            if (aValue < bValue) return this.sortOrder === 'asc' ? -1 : 1;
            if (aValue > bValue) return this.sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }

    /**
     * 更新浏览统计信息
     */
    updateBrowseStats(exams) {
        const browseTitle = document.getElementById('browse-title');
        if (browseTitle) {
            let title = '题目浏览';
            if (this.currentCategory) {
                title = `${this.currentCategory} 题库浏览`;
                if (this.currentFrequency) {
                    title += ` - ${this.currentFrequency === 'high' ? '高频' : '次高频'}题目`;
                }
            }
            title += ` (${exams.length})`;
            browseTitle.textContent = title;
        }
    }

    /**
     * 渲染题目列表
     */
    renderExamList(exams) {
        const examList = document.getElementById('exam-list');
        if (!examList) return;

        // 设置容器类名
        examList.className = this.viewMode === 'grid' ? 'exam-grid' : 'exam-list-view';

        if (exams.length === 0) {
            examList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📚</div>
                    <div class="empty-state-title">暂无题目</div>
                    <div class="empty-state-description">当前筛选条件下没有找到题目</div>
                    <button class="btn btn-primary" onclick="this.closest('#browse-view').querySelector('.browse-filters select').selectedIndex = 0; window.app.components.examBrowser.refreshExamList();">
                        清除筛选
                    </button>
                </div>
            `;
            return;
        }

        examList.innerHTML = exams.map(exam => 
            this.viewMode === 'grid' ? this.createExamCard(exam) : this.createExamListItem(exam)
        ).join('');
    }

    /**
     * 创建题目卡片HTML（网格模式）
     */
    createExamCard(exam) {
        const practiceRecords = storage.get('practice_records', []);
        const examRecords = practiceRecords.filter(r => r.examId === exam.id);
        const isCompleted = examRecords.length > 0;
        const bestScore = isCompleted ? Math.max(...examRecords.map(r => r.accuracy || 0)) : 0;
        const lastPractice = examRecords.length > 0 
            ? examRecords.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0].startTime
            : null;

        const difficultyColors = {
            'easy': 'success',
            'medium': 'warning', 
            'hard': 'error'
        };

        const difficultyLabels = {
            'easy': '简单',
            'medium': '中等',
            'hard': '困难'
        };

        return `
            <div class="exam-card" data-exam-id="${exam.id}">
                <div class="exam-card-header">
                    <div class="exam-status-indicator">
                        <div class="exam-status ${isCompleted ? 'completed' : examRecords.length > 0 ? 'in-progress' : ''}"></div>
                    </div>
                    <h3 class="exam-title">${exam.title}</h3>
                    <div class="exam-meta">
                        <span class="exam-tag frequency-${exam.frequency}">
                            ${exam.frequency === 'high' ? '高频' : '次高频'}
                        </span>
                        <span class="exam-tag difficulty-${exam.difficulty || 'medium'}">
                            ${difficultyLabels[exam.difficulty] || '中等'}
                        </span>
                        <span class="exam-tag">${exam.totalQuestions || 0} 题</span>
                        <span class="exam-tag">${exam.estimatedTime || 20} 分钟</span>
                    </div>
                </div>
                <div class="exam-card-body">
                    <div class="exam-stats">
                        <div class="stat-item">
                            <span class="stat-label">练习次数</span>
                            <span class="stat-value">${examRecords.length}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">最佳成绩</span>
                            <span class="stat-value">${Math.round(bestScore * 100)}%</span>
                        </div>
                    </div>
                    ${lastPractice ? `
                        <div class="last-practice-info">
                            <span class="last-practice-label">最近练习：</span>
                            <span class="last-practice-time">${Utils.formatRelativeTime(lastPractice)}</span>
                        </div>
                    ` : ''}
                    <div class="exam-description">
                        ${exam.description || '点击开始练习此题目'}
                    </div>
                    ${exam.questionTypes && exam.questionTypes.length > 0 ? `
                        <div class="question-types">
                            ${exam.questionTypes.slice(0, 3).map(type => `
                                <span class="question-type-tag">${this.formatQuestionType(type)}</span>
                            `).join('')}
                            ${exam.questionTypes.length > 3 ? `<span class="more-types">+${exam.questionTypes.length - 3}</span>` : ''}
                        </div>
                    ` : ''}
                    <div class="exam-actions">
                        <button class="btn btn-primary" data-exam-action="practice" data-exam-id="${exam.id}">
                            <span class="btn-icon">▶️</span>
                            开始练习
                        </button>
                        <button class="btn btn-secondary" data-exam-action="preview" data-exam-id="${exam.id}">
                            <span class="btn-icon">👁️</span>
                            预览
                        </button>
                        <button class="btn btn-outline" data-exam-action="details" data-exam-id="${exam.id}">
                            <span class="btn-icon">ℹ️</span>
                            详情
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 创建题目列表项HTML（列表模式）
     */
    createExamListItem(exam) {
        const practiceRecords = storage.get('practice_records', []);
        const examRecords = practiceRecords.filter(r => r.examId === exam.id);
        const isCompleted = examRecords.length > 0;
        const bestScore = isCompleted ? Math.max(...examRecords.map(r => r.accuracy || 0)) : 0;

        return `
            <div class="exam-list-item" data-exam-id="${exam.id}">
                <div class="exam-list-main">
                    <div class="exam-list-status">
                        <div class="exam-status ${isCompleted ? 'completed' : examRecords.length > 0 ? 'in-progress' : ''}"></div>
                    </div>
                    <div class="exam-list-content">
                        <h4 class="exam-list-title">${exam.title}</h4>
                        <div class="exam-list-meta">
                            <span class="exam-tag frequency-${exam.frequency}">
                                ${exam.frequency === 'high' ? '高频' : '次高频'}
                            </span>
                            <span class="exam-tag">${exam.category}</span>
                            <span class="exam-tag">${exam.totalQuestions || 0} 题</span>
                            <span class="exam-tag">${exam.estimatedTime || 20} 分钟</span>
                        </div>
                    </div>
                    <div class="exam-list-stats">
                        <div class="stat-item">
                            <span class="stat-value">${examRecords.length}</span>
                            <span class="stat-label">次练习</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-value">${Math.round(bestScore * 100)}%</span>
                            <span class="stat-label">最佳成绩</span>
                        </div>
                    </div>
                    <div class="exam-list-actions">
                        <button class="btn btn-sm btn-primary" data-exam-action="practice" data-exam-id="${exam.id}">
                            开始练习
                        </button>
                        <button class="btn btn-sm btn-secondary" data-exam-action="preview" data-exam-id="${exam.id}">
                            预览
                        </button>
                    </div>
                </div>
            </div>
        `;
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
     * 处理题目操作
     */
    handleExamAction(action, examId) {
        switch (action) {
            case 'practice':
                this.startExamPractice(examId);
                break;
            case 'preview':
                this.showExamPreview(examId);
                break;
            case 'details':
                this.showExamDetails(examId);
                break;
        }
    }

    /**
     * 开始题目练习
     */
    startExamPractice(examId) {
        if (window.app && typeof window.app.openExam === 'function') {
            window.app.openExam(examId);
        } else {
            // 降级处理
            const examIndex = storage.get('exam_index', []);
            const exam = examIndex.find(e => e.id === examId);
            if (exam) {
                window.showMessage(`开始练习: ${exam.title}`, 'info');
            }
        }
    }

    /**
     * 显示题目预览
     */
    showExamPreview(examId) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        if (!exam) return;

        const practiceRecords = storage.get('practice_records', []);
        const examRecords = practiceRecords.filter(r => r.examId === examId);

        const previewContent = `
            <div class="exam-preview-modal">
                <div class="preview-header">
                    <h3>${exam.title}</h3>
                    <button class="close-preview" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="preview-body">
                    <div class="preview-meta">
                        <div class="meta-item">
                            <span class="meta-label">分类：</span>
                            <span class="meta-value">${exam.category}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">频率：</span>
                            <span class="meta-value">${exam.frequency === 'high' ? '高频' : '次高频'}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">题目数：</span>
                            <span class="meta-value">${exam.totalQuestions || 0}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">预计用时：</span>
                            <span class="meta-value">${exam.estimatedTime || 20} 分钟</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">难度：</span>
                            <span class="meta-value">${exam.difficulty || '中等'}</span>
                        </div>
                    </div>
                    ${exam.questionTypes && exam.questionTypes.length > 0 ? `
                        <div class="preview-question-types">
                            <h4>题型分布</h4>
                            <div class="question-types-list">
                                ${exam.questionTypes.map(type => `
                                    <span class="question-type-item">${this.formatQuestionType(type)}</span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${examRecords.length > 0 ? `
                        <div class="preview-history">
                            <h4>练习历史</h4>
                            <div class="history-stats">
                                <div class="history-stat">
                                    <span class="stat-value">${examRecords.length}</span>
                                    <span class="stat-label">练习次数</span>
                                </div>
                                <div class="history-stat">
                                    <span class="stat-value">${Math.round(Math.max(...examRecords.map(r => r.accuracy || 0)) * 100)}%</span>
                                    <span class="stat-label">最佳成绩</span>
                                </div>
                                <div class="history-stat">
                                    <span class="stat-value">${Math.round(examRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / examRecords.length * 100)}%</span>
                                    <span class="stat-label">平均成绩</span>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                    <div class="preview-description">
                        <h4>题目描述</h4>
                        <p>${exam.description || '暂无描述'}</p>
                    </div>
                </div>
                <div class="preview-footer">
                    <button class="btn btn-primary" onclick="window.app.components.examBrowser.startExamPractice('${examId}')">
                        开始练习
                    </button>
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                        关闭
                    </button>
                </div>
            </div>
        `;

        this.showModal(previewContent);
    }

    /**
     * 显示题目详情
     */
    showExamDetails(examId) {
        // 这里可以显示更详细的题目信息
        this.showExamPreview(examId);
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
    }

    /**
     * 关闭题目预览
     */
    closeExamPreview() {
        const modal = document.querySelector('.modal-overlay');
        if (modal) {
            modal.remove();
        }
    }

    /**
     * 销毁组件
     */
    destroy() {
        // 清理事件监听器和模态框
        this.closeExamPreview();
    }
}

// 导出到全局对象
window.ExamBrowser = ExamBrowser;