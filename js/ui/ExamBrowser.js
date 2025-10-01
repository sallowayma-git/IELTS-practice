// ExamBrowser.js - Controller/glue for exam browsing UI
// Coordinates FilterBar, ExamList, Pagination components
// Inherits from BaseComponent, handles store integration and actions

class ExamBrowser extends BaseComponent {
    constructor(stores) {
        super(stores, {
            container: document.getElementById('browse-view'),
            categoryOverview: document.getElementById('category-overview'),
            loading: document.querySelector('.loading')
        });
        this.currentCategory = 'all';
        this.currentType = 'all';
        this.searchQuery = '';
        this.currentPage = 1;
        this._isRendering = false;
        this.checkRequiredElements();
        this.initSubComponents();
    }

    checkRequiredElements() {
        const required = ['container', 'loading'];
        const missing = required.filter(key => !this.elements[key]);
        if (missing.length > 0) {
            console.warn('[ExamBrowser] Missing elements:', missing);
            this.createFallbackElements(missing);
        }
    }

    createFallbackElements(missing) {
        if (missing.includes('container')) {
            this.elements.container = document.createElement('div');
            this.elements.container.id = 'browse-view';
            document.body.appendChild(this.elements.container);
        }
        if (missing.includes('loading')) {
            this.elements.loading = document.createElement('div');
            this.elements.loading.className = 'loading';
            this.elements.loading.innerHTML = '<div class="spinner"></div><p>正在加载题目列表...</p>';
            this.elements.loading.style.display = 'none';
            this.elements.container.appendChild(this.elements.loading);
        }
        if (!this.elements.categoryOverview) {
            this.elements.categoryOverview = document.createElement('div');
            this.elements.categoryOverview.id = 'category-overview';
            this.elements.container.appendChild(this.elements.categoryOverview);
        }
    }

    initSubComponents() {
        const filterContainer = document.createElement('div');
        filterContainer.id = 'filter-container';
        this.elements.container.appendChild(filterContainer);

        const listContainer = document.createElement('div');
        listContainer.id = 'list-container';
        this.elements.container.appendChild(listContainer);

        const paginationContainer = document.createElement('div');
        paginationContainer.id = 'pagination-container';
        this.elements.container.appendChild(paginationContainer);

        this.filterBar = new ExamFilterBar(this.stores, filterContainer, (change) => this.handleFilterChange(change));
        this.examList = new ExamList(this.stores, listContainer, (action, examId) => this.handleExamAction(action, examId));
        this.pagination = new Pagination(this.stores, paginationContainer, (page) => this.handlePageChange(page));
    }

    attach(container) {
        super.attach(container);
        this.filterBar.attach(this.elements.container.querySelector('#filter-container'));
        this.examList.attach(this.elements.container.querySelector('#list-container'));
        this.pagination.attach(this.elements.container.querySelector('#pagination-container'));
        this.updateLoadingState(false);
        this.render();

        // Subscribe to App events for view activation
        if (window.App && window.App.events) {
            window.App.events.on('viewActivated', (data) => {
                if (data.viewName === 'browse') {
                    this.render();
                }
            });
        }
    }

    subscribeToStores() {
        this.addSubscription(this.stores.exams.subscribe(this.handleExamStoreChange.bind(this)));
        this.addSubscription(this.stores.app.subscribe(this.handleAppStoreChange.bind(this)));
    }

    handleExamStoreChange(event) {
        switch (event.type) {
            case 'exams_loaded':
            case 'categories_updated':
                this.updateCategoryOverview();
                this.render();
                break;
        }
    }

    handleAppStoreChange(event) {
        switch (event.type) {
            case 'loading_changed':
                this.updateLoadingState(event.loading);
                break;
            case 'view_changed':
                if (event.view === 'browse') this.render();
                break;
        }
    }

    handleFilterChange(change) {
        if (change.type === 'search') this.searchQuery = change.query;
        if (change.type === 'filter') this.currentType = change.filter;
        this.currentPage = 1; // Reset page on filter
        this.render();
    }

    handlePageChange(page) {
        this.currentPage = page;
        this.render();
    }

    handleExamAction(action, examId) {
        const exam = this.stores.exams.getExamById(examId);
        if (!exam) return console.error('Exam not found:', examId);

        if (action === 'start') {
            this.handleExamStart(examId);
        } else if (action === 'pdf') {
            this.handlePdfView(examId);
        }
    }

    getFilteredExams() {
        let exams = this.stores.exams.exams || [];

        if (this.currentCategory !== 'all') {
            exams = exams.filter(exam => exam.category === this.currentCategory);
        }

        if (this.currentType !== 'all') {
            exams = exams.filter(exam => (exam.type || 'reading') === this.currentType);
        }

        if (this.searchQuery) {
            try {
                exams = this.stores.exams.searchExams(this.searchQuery);
            } catch (error) {
                console.warn('Store search failed, local search');
                const lowerQuery = this.searchQuery.toLowerCase().trim();
                exams = exams.filter(exam =>
                    exam.title.toLowerCase().includes(lowerQuery) ||
                    (exam.category && exam.category.toLowerCase().includes(lowerQuery)) ||
                    (exam.topics && exam.topics.some(topic => topic.toLowerCase().includes(lowerQuery)))
                );
            }
        }

        return exams;
    }

    render() {
        if (this._isRendering) return;
        this._isRendering = true;

        try {
            const allExams = this.getFilteredExams();
            const total = allExams.length;
            const startIndex = (this.currentPage - 1) * this.pagination.pageSize;
            const paginatedExams = allExams.slice(startIndex, startIndex + this.pagination.pageSize);

            this.examList.setExams(paginatedExams);
            this.pagination.setTotal(total);
            this.pagination.setPage(this.currentPage);
        } finally {
            setTimeout(() => { this._isRendering = false; }, 0);
        }
    }

    updateLoadingState(isLoading) {
        if (this.elements.loading) {
            this.elements.loading.style.display = isLoading ? 'block' : 'none';
        }
        if (this.elements.container) {
            this.elements.container.style.display = isLoading ? 'none' : 'block';
        }
    }

    updateCategoryOverview() {
        if (!this.elements.categoryOverview) return;

        try {
            const categoryStats = this.stores.exams.getCategoryStats();
            const recordStats = this.stores.records.stats.categoryStats || {};

            let html = '';
            Object.keys(categoryStats).forEach(category => {
                const examCount = categoryStats[category].count;
                const practiceCount = recordStats[category]?.count || 0;
                const averageScore = recordStats[category]?.averageScore || 0;

                html += `
                    <div class="category-card" onclick="window.ExamBrowserInstance && window.ExamBrowserInstance.setCategory('${category}')">
                        <div class="category-header">
                            <h3>${category}</h3>
                            <span class="category-count">${examCount}题</span>
                        </div>
                        <div class="category-stats">
                            <div class="stat"><span class="stat-label">已练习</span><span class="stat-value">${practiceCount}</span></div>
                            <div class="stat"><span class="stat-label">平均分</span><span class="stat-value">${averageScore.toFixed(1)}%</span></div>
                        </div>
                        <div class="category-progress">
                            <div class="progress-bar"><div class="progress-fill" style="width: ${examCount > 0 ? (practiceCount / examCount * 100) : 0}%"></div></div>
                            <span class="progress-text">${examCount > 0 ? Math.round(practiceCount / examCount * 100) : 0}% 完成</span>
                        </div>
                    </div>
                `;
            });

            if (html === '') {
                html = `
                    <div class="empty-overview">
                        <div class="empty-icon">📚</div>
                        <p>暂无题库数据</p>
                        <button class="btn btn-primary" onclick="window.loadLibrary && window.loadLibrary();">加载题库</button>
                    </div>
                `;
            }

            this.elements.categoryOverview.innerHTML = html;
        } catch (error) {
            console.error('[ExamBrowser] Failed to update category overview:', error);
        }
    }

    handleExamStart(examId) {
        try {
            const exam = this.stores.exams.getExamById(examId);
            if (!exam) throw new Error(`Exam not found: ${examId}`);

            const examPath = this.stores.exams.getExamPath(exam);
            if (!examPath) throw new Error('Exam file path not available');

            console.log('[ExamBrowser] Starting exam:', examId, examPath);

            if (window.openExamWindow) {
                window.openExamWindow(examPath, exam);
            } else if (window.app && window.app.openExam) {
                window.app.openExam(examId);
            } else {
                const examWindow = window.open(examPath, `exam_${exam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
                if (!examWindow) throw new Error('Failed to open exam window. Check popup blocker.');
                this.setupExamWindowCommunication(examWindow, exam);
            }

            if (window.globalEventBus) {
                window.globalEventBus.emit('exam_started', { examId, exam, timestamp: Date.now() });
            }
        } catch (error) {
            console.error('[ExamBrowser] Failed to start exam:', error);
            this.stores.app.addError({
                message: `Failed to start exam: ${error.message}`,
                context: 'ExamBrowser.handleExamStart',
                error,
                recoverable: true,
                userMessage: '无法开始练习。请检查题目文件是否存在。',
                actions: ['Try again', 'Check file path', 'Report issue']
            });
        }
    }

    setupExamWindowCommunication(examWindow, exam) {
        try {
            const initMessage = {
                type: 'INIT_EXAM_SESSION',
                examId: exam.id,
                examTitle: exam.title,
                timestamp: Date.now()
            };

            const sendInitMessage = () => {
                try {
                    examWindow.postMessage(initMessage, '*');
                } catch (e) {
                    console.warn('[ExamBrowser] Failed to send init message:', e);
                }
            };

            if (examWindow.document && examWindow.document.readyState === 'complete') {
                sendInitMessage();
            } else {
                examWindow.addEventListener('load', sendInitMessage);
            }

            console.log('[ExamBrowser] Setup exam window communication');
        } catch (error) {
            console.warn('[ExamBrowser] Failed to setup exam window communication:', error);
        }
    }

    handlePdfView(examId) {
        try {
            const exam = this.stores.exams.getExamById(examId);
            if (!exam) throw new Error(`Exam not found: ${examId}`);

            const pdfPath = exam.path + exam.filename.replace('.html', '.pdf');

            console.log('[ExamBrowser] Opening PDF:', examId, pdfPath);

            if (window.PDFHandler && window.PDFHandler.openPDF) {
                window.PDFHandler.openPDF(pdfPath, exam);
            } else {
                const pdfWindow = window.open(pdfPath, '_blank');
                if (!pdfWindow) throw new Error('Failed to open PDF. Check popup blocker.');
            }
        } catch (error) {
            console.error('[ExamBrowser] Failed to open PDF:', error);
            this.stores.app.addError({
                message: `Failed to open PDF: ${error.message}`,
                context: 'ExamBrowser.handlePdfView',
                error,
                recoverable: true,
                userMessage: '无法打开PDF文件。请检查文件是否存在。',
                actions: ['Try again', 'Check file path', 'Use HTML version']
            });
        }
    }

    handleCategoryFilter(category) {
        this.currentCategory = category;
        this.currentPage = 1;
        this.render();
        console.log('[ExamBrowser] Category filter:', category);
    }

    // Public API (for global compatibility)
    setCategory(category) {
        this.handleCategoryFilter(category);
    }

    setType(type) {
        this.currentType = type;
        this.currentPage = 1;
        this.render();
    }

    search(query) {
        this.searchQuery = query;
        this.currentPage = 1;
        this.render();
    }

    clearFilters() {
        this.currentCategory = 'all';
        this.currentType = 'all';
        this.searchQuery = '';
        this.currentPage = 1;
        this.filterBar.clearFilters();
        this.render();
    }

    refresh() {
        this.render();
        this.updateCategoryOverview();
    }

    // Global instance for onclick compatibility
    static instance = null;
}

// Export and set global instance
const examBrowserInstance = new ExamBrowser(window.stores || { exams: {}, app: {}, records: {} });
window.ExamBrowser = ExamBrowser;
window.ExamBrowserInstance = examBrowserInstance;
examBrowserInstance.attach(document.getElementById('browse-view') || document.body);

console.log('[ExamBrowser] Controller initialized');