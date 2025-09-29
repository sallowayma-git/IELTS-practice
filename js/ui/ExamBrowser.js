// ExamBrowser.js - Global class for file:// protocol compatibility
// Manages exam browsing interface using existing DOM structure

window.ExamBrowser = class ExamBrowser {
    constructor(stores) {
        this.stores = stores;
        this.currentCategory = 'all';
        this.currentType = 'all';
        this.searchQuery = '';
        
        // Get existing DOM elements
        this.elements = {
            container: document.getElementById('exam-list-container'),
            searchInput: document.querySelector('.search-input'),
            loading: document.querySelector('.loading'),
            browseTitle: document.getElementById('browse-title'),
            typeFilterButtons: document.getElementById('type-filter-buttons'),
            categoryOverview: document.getElementById('category-overview')
        };
        
        // Verify required elements exist
        this.checkRequiredElements();
        
        // Subscribe to store changes
        this.unsubscribeExams = this.stores.exams.subscribe(this.handleExamStoreChange.bind(this));
        this.unsubscribeApp = this.stores.app.subscribe(this.handleAppStoreChange.bind(this));
        
        // Setup event listeners
        this.setupEventListeners();
        
        console.log('[ExamBrowser] Initialized with existing DOM structure');
    }
    
    checkRequiredElements() {
        const required = ['container', 'searchInput', 'loading'];
        const missing = required.filter(key => !this.elements[key]);
        
        if (missing.length > 0) {
            console.warn('[ExamBrowser] Missing DOM elements:', missing);
            // Create fallback elements if needed
            this.createFallbackElements(missing);
        }
    }
    
    createFallbackElements(missing) {
        if (missing.includes('container') && !this.elements.container) {
            this.elements.container = document.createElement('div');
            this.elements.container.id = 'exam-list-container';
            
            const browseView = document.getElementById('browse-view');
            if (browseView) {
                browseView.appendChild(this.elements.container);
            }
        }
        
        if (missing.includes('loading') && !this.elements.loading) {
            this.elements.loading = document.createElement('div');
            this.elements.loading.className = 'loading';
            this.elements.loading.innerHTML = `
                <div class="spinner"></div>
                <p>正在加载题目列表...</p>
            `;
            this.elements.loading.style.display = 'none';
        }
    }
    
    setupEventListeners() {
        // Search input
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
            
            this.elements.searchInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    this.handleSearch(e.target.value);
                }
            });
        }
        
        // Type filter buttons
        if (this.elements.typeFilterButtons) {
            this.elements.typeFilterButtons.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') {
                    const type = e.target.textContent.trim();
                    this.handleTypeFilter(this.mapTypeButtonToFilter(type));
                    this.updateTypeFilterButtons(e.target);
                }
            });
        }
        
        // Global functions for backward compatibility
        window.searchExams = (query) => this.handleSearch(query);
        window.filterByType = (type) => this.handleTypeFilter(type);
        window.filterByCategory = (category) => this.handleCategoryFilter(category);
    }
    
    mapTypeButtonToFilter(buttonText) {
        const mapping = {
            '全部': 'all',
            '阅读': 'reading',
            '听力': 'listening'
        };
        return mapping[buttonText] || 'all';
    }
    
    handleExamStoreChange(event) {
        switch (event.type) {
            case 'exams_loaded':
                this.render();
                this.updateCategoryOverview();
                break;
            case 'categories_updated':
                this.updateCategoryOverview();
                break;
            default:
                console.log('[ExamBrowser] Unhandled exam store event:', event.type);
        }
    }
    
    handleAppStoreChange(event) {
        switch (event.type) {
            case 'loading_changed':
                this.updateLoadingState(event.loading);
                break;
            case 'view_changed':
                if (event.view === 'browse') {
                    this.render();
                }
                break;
            default:
                // Ignore other app events
        }
    }
    
    handleSearch(query) {
        this.searchQuery = query;
        this.render();
        console.log('[ExamBrowser] Search:', query);
    }
    
    handleTypeFilter(type) {
        this.currentType = type;
        this.render();
        console.log('[ExamBrowser] Type filter:', type);
    }
    
    handleCategoryFilter(category) {
        this.currentCategory = category;
        this.render();
        console.log('[ExamBrowser] Category filter:', category);
    }
    
    updateTypeFilterButtons(activeButton) {
        if (!this.elements.typeFilterButtons) return;
        
        // Remove active class from all buttons
        this.elements.typeFilterButtons.querySelectorAll('button').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active class to clicked button
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }
    
    updateLoadingState(isLoading) {
        if (!this.elements.loading) return;
        
        this.elements.loading.style.display = isLoading ? 'block' : 'none';
        
        if (this.elements.container) {
            this.elements.container.style.display = isLoading ? 'none' : 'block';
        }
    }
    
    render() {
        if (!this.elements.container) {
            console.warn('[ExamBrowser] Cannot render: container element not found');
            return;
        }
        
        try {
            // Get filtered exams
            let exams = this.getFilteredExams();
            
            // Update title with count
            this.updateBrowseTitle(exams.length);
            
            // Render exam list
            this.renderExamList(exams);
            
        } catch (error) {
            console.error('[ExamBrowser] Render error:', error);
            this.renderError(error.message);
        }
    }
    
    getFilteredExams() {
        let exams = this.stores.exams.exams || [];
        
        // Filter by category
        if (this.currentCategory !== 'all') {
            exams = exams.filter(exam => exam.category === this.currentCategory);
        }
        
        // Filter by type
        if (this.currentType !== 'all') {
            exams = exams.filter(exam => (exam.type || 'reading') === this.currentType);
        }
        
        // Apply search
        if (this.searchQuery) {
            exams = this.stores.exams.searchExams(this.searchQuery);
        }
        
        return exams;
    }
    
    updateBrowseTitle(count) {
        if (!this.elements.browseTitle) return;
        
        let title = '📚 题库浏览';
        if (count > 0) {
            title += ` (${count}题)`;
        }
        
        this.elements.browseTitle.textContent = title;
    }
    
    renderExamList(exams) {
        if (!this.elements.container) return;
        
        if (exams.length === 0) {
            this.renderEmptyState();
            return;
        }
        
        // Group exams by category for better organization
        const groupedExams = this.groupExamsByCategory(exams);
        
        let html = '';
        
        Object.keys(groupedExams).forEach(category => {
            const categoryExams = groupedExams[category];
            
            html += `
                <div class="category-section">
                    <h3 class="category-title">${category} (${categoryExams.length}题)</h3>
                    <div class="exam-grid">
            `;
            
            categoryExams.forEach(exam => {
                html += this.renderExamCard(exam);
            });
            
            html += `
                    </div>
                </div>
            `;
        });
        
        this.elements.container.innerHTML = html;
        
        // Setup event listeners for exam cards
        this.setupExamCardListeners();
    }
    
    groupExamsByCategory(exams) {
        const grouped = {};
        
        exams.forEach(exam => {
            const category = exam.category || 'Unknown';
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(exam);
        });
        
        // Sort categories
        const sortedGrouped = {};
        const categoryOrder = ['P1', 'P2', 'P3', 'P4', 'Unknown'];
        
        categoryOrder.forEach(category => {
            if (grouped[category]) {
                sortedGrouped[category] = grouped[category];
            }
        });
        
        return sortedGrouped;
    }
    
    renderExamCard(exam) {
        const examPath = this.stores.exams.getExamPath(exam);
        const hasValidPath = examPath && exam.hasHtml !== false;
        
        return `
            <div class="exam-card" data-exam-id="${exam.id}">
                <div class="exam-header">
                    <span class="exam-category">${exam.category || 'Unknown'}</span>
                    <span class="exam-type">${this.getTypeIcon(exam.type)} ${exam.type || 'reading'}</span>
                </div>
                <h4 class="exam-title">${this.escapeHtml(exam.title)}</h4>
                <div class="exam-meta">
                    ${exam.difficulty ? `<span class="difficulty ${exam.difficulty}">${this.getDifficultyText(exam.difficulty)}</span>` : ''}
                    ${exam.topics && exam.topics.length > 0 ? `<div class="topics">${exam.topics.map(topic => `<span class="topic">${this.escapeHtml(topic)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="exam-actions">
                    ${hasValidPath ? `
                        <button class="btn btn-primary start-practice-btn" data-exam-id="${exam.id}">
                            📝 开始练习
                        </button>
                    ` : `
                        <button class="btn btn-disabled" disabled>
                            ❌ 文件缺失
                        </button>
                    `}
                    ${exam.hasPdf ? `
                        <button class="btn btn-secondary view-pdf-btn" data-exam-id="${exam.id}">
                            📄 查看PDF
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    getTypeIcon(type) {
        const icons = {
            'reading': '📖',
            'listening': '🎧'
        };
        return icons[type] || '📖';
    }
    
    getDifficultyText(difficulty) {
        const texts = {
            'easy': '简单',
            'medium': '中等',
            'hard': '困难'
        };
        return texts[difficulty] || difficulty;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    setupExamCardListeners() {
        if (!this.elements.container) return;
        
        // Start practice buttons
        this.elements.container.querySelectorAll('.start-practice-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const examId = e.target.getAttribute('data-exam-id');
                this.handleExamStart(examId);
            });
        });
        
        // View PDF buttons
        this.elements.container.querySelectorAll('.view-pdf-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const examId = e.target.getAttribute('data-exam-id');
                this.handlePdfView(examId);
            });
        });
    }
    
    handleExamStart(examId) {
        try {
            const exam = this.stores.exams.getExamById(examId);
            if (!exam) {
                throw new Error(`Exam not found: ${examId}`);
            }
            
            const examPath = this.stores.exams.getExamPath(exam);
            if (!examPath) {
                throw new Error('Exam file path not available');
            }
            
            console.log('[ExamBrowser] Starting exam:', examId, examPath);
            
            // Use existing exam opening logic if available
            if (window.openExamWindow) {
                window.openExamWindow(examPath, exam);
            } else {
                // Fallback: open in new window
                const examWindow = window.open(examPath, '_blank');
                if (!examWindow) {
                    throw new Error('Failed to open exam window. Please check popup blocker settings.');
                }
            }
            
            // Track exam start
            if (window.globalEventBus) {
                window.globalEventBus.emit('exam_started', {
                    examId: examId,
                    exam: exam,
                    timestamp: Date.now()
                });
            }
            
        } catch (error) {
            console.error('[ExamBrowser] Failed to start exam:', error);
            this.stores.app.addError({
                message: `Failed to start exam: ${error.message}`,
                context: 'ExamBrowser.handleExamStart',
                error: error,
                recoverable: true,
                userMessage: '无法开始练习。请检查题目文件是否存在。',
                actions: ['Try again', 'Check file path', 'Report issue']
            });
        }
    }
    
    handlePdfView(examId) {
        try {
            const exam = this.stores.exams.getExamById(examId);
            if (!exam) {
                throw new Error(`Exam not found: ${examId}`);
            }
            
            // Construct PDF path
            const pdfPath = exam.path + exam.filename.replace('.html', '.pdf');
            
            console.log('[ExamBrowser] Opening PDF:', examId, pdfPath);
            
            // Use existing PDF handler if available
            if (window.PDFHandler && window.PDFHandler.openPDF) {
                window.PDFHandler.openPDF(pdfPath, exam);
            } else {
                // Fallback: open in new window
                const pdfWindow = window.open(pdfPath, '_blank');
                if (!pdfWindow) {
                    throw new Error('Failed to open PDF. Please check popup blocker settings.');
                }
            }
            
        } catch (error) {
            console.error('[ExamBrowser] Failed to open PDF:', error);
            this.stores.app.addError({
                message: `Failed to open PDF: ${error.message}`,
                context: 'ExamBrowser.handlePdfView',
                error: error,
                recoverable: true,
                userMessage: '无法打开PDF文件。请检查文件是否存在。',
                actions: ['Try again', 'Check file path', 'Use HTML version']
            });
        }
    }
    
    renderEmptyState() {
        if (!this.elements.container) return;
        
        let message = '暂无题目';
        let suggestion = '';
        
        if (this.searchQuery) {
            message = `未找到包含 "${this.searchQuery}" 的题目`;
            suggestion = '尝试使用不同的关键词搜索';
        } else if (this.currentType !== 'all') {
            message = `暂无${this.currentType === 'reading' ? '阅读' : '听力'}题目`;
            suggestion = '尝试切换到其他题型';
        } else if (this.currentCategory !== 'all') {
            message = `${this.currentCategory} 类别暂无题目`;
            suggestion = '尝试切换到其他类别';
        }
        
        this.elements.container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📚</div>
                <h3>${message}</h3>
                ${suggestion ? `<p>${suggestion}</p>` : ''}
                <button class="btn btn-secondary" onclick="this.closest('.empty-state').parentElement.querySelector('.search-input').value=''; window.searchExams('');">
                    清除筛选
                </button>
            </div>
        `;
    }
    
    renderError(message) {
        if (!this.elements.container) return;
        
        this.elements.container.innerHTML = `
            <div class="error-state">
                <div class="error-icon">❌</div>
                <h3>加载失败</h3>
                <p>${this.escapeHtml(message)}</p>
                <button class="btn btn-primary" onclick="window.location.reload();">
                    刷新页面
                </button>
            </div>
        `;
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
                    <div class="category-card" onclick="window.showView && window.showView('browse'); window.filterByCategory && window.filterByCategory('${category}');">
                        <div class="category-header">
                            <h3>${category}</h3>
                            <span class="category-count">${examCount}题</span>
                        </div>
                        <div class="category-stats">
                            <div class="stat">
                                <span class="stat-label">已练习</span>
                                <span class="stat-value">${practiceCount}</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label">平均分</span>
                                <span class="stat-value">${averageScore.toFixed(1)}%</span>
                            </div>
                        </div>
                        <div class="category-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${examCount > 0 ? (practiceCount / examCount * 100) : 0}%"></div>
                            </div>
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
                        <button class="btn btn-primary" onclick="window.loadLibrary && window.loadLibrary();">
                            加载题库
                        </button>
                    </div>
                `;
            }
            
            this.elements.categoryOverview.innerHTML = html;
            
        } catch (error) {
            console.error('[ExamBrowser] Failed to update category overview:', error);
        }
    }
    
    // Public API methods
    refresh() {
        this.render();
        this.updateCategoryOverview();
    }
    
    setCategory(category) {
        this.currentCategory = category;
        this.render();
    }
    
    setType(type) {
        this.currentType = type;
        this.render();
    }
    
    search(query) {
        this.searchQuery = query;
        if (this.elements.searchInput) {
            this.elements.searchInput.value = query;
        }
        this.render();
    }
    
    clearFilters() {
        this.currentCategory = 'all';
        this.currentType = 'all';
        this.searchQuery = '';
        if (this.elements.searchInput) {
            this.elements.searchInput.value = '';
        }
        this.render();
    }
    
    // Cleanup
    destroy() {
        if (this.unsubscribeExams) {
            this.unsubscribeExams();
        }
        if (this.unsubscribeApp) {
            this.unsubscribeApp();
        }
        
        // Remove global functions
        delete window.searchExams;
        delete window.filterByType;
        delete window.filterByCategory;
        
        console.log('[ExamBrowser] Destroyed');
    }
};