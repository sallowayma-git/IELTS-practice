/**
 * 练习历史查看组件
 * 提供历史记录列表、详细视图、筛选搜索和导出功能
 */
class PracticeHistory {
    constructor() {
        this.currentRecords = [];
        this.filteredRecords = [];
        this.currentPage = 1;
        this.recordsPerPage = 20;
        this.sortBy = 'startTime';
        this.sortOrder = 'desc';
        this.filters = {
            category: 'all',
            frequency: 'all',
            status: 'all',
            dateRange: 'all',
            minAccuracy: 0,
            maxAccuracy: 100
        };
        this.searchQuery = '';
        
        this.initialize();
    }

    /**
     * 初始化组件
     */
    initialize() {
        console.log('PracticeHistory component initialized');
        this.setupEventListeners();
        this.createHistoryInterface();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 监听练习完成事件，自动刷新历史记录
        document.addEventListener('practiceSessionCompleted', () => {
            this.refreshHistory();
        });
        
        // 监听视图激活事件
        document.addEventListener('click', (e) => {
            // 历史记录项点击
            const recordItem = e.target.closest('.history-record-item');
            if (recordItem) {
                const recordId = recordItem.dataset.recordId;
                this.showRecordDetails(recordId);
            }
            
            // 操作按钮点击
            const actionBtn = e.target.closest('[data-history-action]');
            if (actionBtn) {
                e.preventDefault();
                e.stopPropagation();
                const action = actionBtn.dataset.historyAction;
                const recordId = actionBtn.dataset.recordId;
                this.handleRecordAction(action, recordId);
            }
            
            // 分页按钮点击
            const pageBtn = e.target.closest('.page-btn');
            if (pageBtn && !pageBtn.classList.contains('disabled')) {
                const page = parseInt(pageBtn.dataset.page);
                this.goToPage(page);
            }
        });
        
        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (document.getElementById('practice-view').classList.contains('active')) {
                switch (e.key) {
                    case 'r':
                        if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            this.refreshHistory();
                        }
                        break;
                    case 'e':
                        if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            this.exportHistory();
                        }
                        break;
                }
            }
        });
    }

    /**
     * 创建历史记录界面
     */
    createHistoryInterface() {
        const practiceView = document.getElementById('practice-view');
        if (!practiceView) return;
        
        practiceView.innerHTML = `
            <div class="practice-history-container">
                <div class="history-header">
                    <h2>练习历史记录</h2>
                    <div class="history-actions">
                        <button class="btn btn-primary" onclick="window.app.components.practiceHistory.refreshHistory()">
                            <span class="btn-icon">🔄</span>
                            刷新
                        </button>
                        <button class="btn btn-secondary" onclick="window.app.components.practiceHistory.exportHistory()">
                            <span class="btn-icon">📥</span>
                            导出
                        </button>
                        <button class="btn btn-outline" onclick="window.app.components.practiceHistory.showImportDialog()">
                            <span class="btn-icon">📤</span>
                            导入
                        </button>
                    </div>
                </div>
                
                <div class="history-filters">
                    <div class="filter-row">
                        <select id="category-filter" class="filter-select">
                            <option value="all">全部分类</option>
                            <option value="P1">P1</option>
                            <option value="P2">P2</option>
                            <option value="P3">P3</option>
                        </select>
                        
                        <select id="frequency-filter" class="filter-select">
                            <option value="all">全部频率</option>
                            <option value="high">高频</option>
                            <option value="low">次高频</option>
                        </select>
                        
                        <select id="status-filter" class="filter-select">
                            <option value="all">全部状态</option>
                            <option value="completed">已完成</option>
                            <option value="interrupted">中断</option>
                        </select>
                        
                        <select id="date-range-filter" class="filter-select">
                            <option value="all">全部时间</option>
                            <option value="today">今天</option>
                            <option value="week">本周</option>
                            <option value="month">本月</option>
                            <option value="custom">自定义</option>
                        </select>
                    </div>
                    
                    <div class="filter-row">
                        <div class="accuracy-filter">
                            <label>正确率范围：</label>
                            <input type="range" id="min-accuracy" min="0" max="100" value="0" class="accuracy-slider">
                            <span id="min-accuracy-value">0%</span>
                            <span>-</span>
                            <input type="range" id="max-accuracy" min="0" max="100" value="100" class="accuracy-slider">
                            <span id="max-accuracy-value">100%</span>
                        </div>
                        
                        <div class="search-filter">
                            <input type="text" id="history-search" placeholder="搜索题目标题..." class="search-input">
                        </div>
                        
                        <button class="btn btn-outline btn-sm" onclick="window.app.components.practiceHistory.resetFilters()">
                            重置筛选
                        </button>
                    </div>
                    
                    <div id="custom-date-range" class="custom-date-range" style="display: none;">
                        <input type="date" id="start-date" class="date-input">
                        <span>至</span>
                        <input type="date" id="end-date" class="date-input">
                        <button class="btn btn-sm btn-primary" onclick="window.app.components.practiceHistory.applyDateRange()">
                            应用
                        </button>
                    </div>
                </div>
                
                <div class="history-stats">
                    <div class="stat-item">
                        <span class="stat-label">总练习次数</span>
                        <span class="stat-value" id="total-practices">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">平均正确率</span>
                        <span class="stat-value" id="avg-accuracy">0%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">总用时</span>
                        <span class="stat-value" id="total-time">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">显示记录</span>
                        <span class="stat-value" id="filtered-count">0</span>
                    </div>
                </div>
                
                <div class="history-controls">
                    <div class="sort-controls">
                        <label>排序：</label>
                        <select id="sort-by" class="sort-select">
                            <option value="startTime">练习时间</option>
                            <option value="accuracy">正确率</option>
                            <option value="duration">用时</option>
                            <option value="examTitle">题目标题</option>
                        </select>
                        <select id="sort-order" class="sort-select">
                            <option value="desc">降序</option>
                            <option value="asc">升序</option>
                        </select>
                    </div>
                    
                    <div class="view-controls">
                        <label>每页显示：</label>
                        <select id="records-per-page" class="records-select">
                            <option value="10">10条</option>
                            <option value="20" selected>20条</option>
                            <option value="50">50条</option>
                            <option value="100">100条</option>
                        </select>
                    </div>
                </div>
                
                <div class="history-list" id="history-list">
                    <!-- 历史记录列表将在这里生成 -->
                </div>
                
                <div class="history-pagination" id="history-pagination">
                    <!-- 分页控件将在这里生成 -->
                </div>
            </div>
        `;
        
        this.setupFilterEvents();
        this.loadHistory();
    }

    /**
     * 设置筛选器事件
     */
    setupFilterEvents() {
        // 筛选器变化事件
        const filterElements = [
            'category-filter', 'frequency-filter', 'status-filter', 
            'date-range-filter', 'sort-by', 'sort-order', 'records-per-page'
        ];
        
        filterElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    this.updateFiltersFromUI();
                    this.applyFilters();
                });
            }
        });
        
        // 正确率滑块事件
        const minAccuracy = document.getElementById('min-accuracy');
        const maxAccuracy = document.getElementById('max-accuracy');
        
        if (minAccuracy && maxAccuracy) {
            minAccuracy.addEventListener('input', (e) => {
                document.getElementById('min-accuracy-value').textContent = e.target.value + '%';
                this.filters.minAccuracy = parseInt(e.target.value);
                this.applyFilters();
            });
            
            maxAccuracy.addEventListener('input', (e) => {
                document.getElementById('max-accuracy-value').textContent = e.target.value + '%';
                this.filters.maxAccuracy = parseInt(e.target.value);
                this.applyFilters();
            });
        }
        
        // 搜索输入事件
        const searchInput = document.getElementById('history-search');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.searchQuery = e.target.value.trim().toLowerCase();
                this.applyFilters();
            }, 300));
        }
        
        // 日期范围筛选器
        const dateRangeFilter = document.getElementById('date-range-filter');
        if (dateRangeFilter) {
            dateRangeFilter.addEventListener('change', (e) => {
                const customDateRange = document.getElementById('custom-date-range');
                if (e.target.value === 'custom') {
                    customDateRange.style.display = 'block';
                } else {
                    customDateRange.style.display = 'none';
                }
            });
        }
    }

    /**
     * 从UI更新筛选器
     */
    updateFiltersFromUI() {
        this.filters.category = document.getElementById('category-filter')?.value || 'all';
        this.filters.frequency = document.getElementById('frequency-filter')?.value || 'all';
        this.filters.status = document.getElementById('status-filter')?.value || 'all';
        this.filters.dateRange = document.getElementById('date-range-filter')?.value || 'all';
        
        this.sortBy = document.getElementById('sort-by')?.value || 'startTime';
        this.sortOrder = document.getElementById('sort-order')?.value || 'desc';
        this.recordsPerPage = parseInt(document.getElementById('records-per-page')?.value || '20');
        
        // 重置到第一页
        this.currentPage = 1;
    }

    /**
     * 加载历史记录
     */
    async loadHistory() {
        try {
            // 获取练习记录器实例
            const practiceRecorder = window.app?.components?.practiceRecorder;
            if (!practiceRecorder) {
                throw new Error('PracticeRecorder not available');
            }
            
            // 获取所有记录
            this.currentRecords = practiceRecorder.getPracticeRecords();
            
            // 应用筛选和排序
            this.applyFilters();
            
            console.log(`Loaded ${this.currentRecords.length} practice records`);
            
        } catch (error) {
            console.error('Failed to load practice history:', error);
            this.showError('加载历史记录失败');
        }
    }

    /**
     * 刷新历史记录
     */
    refreshHistory() {
        this.loadHistory();
    }

    /**
     * 应用筛选器
     */
    applyFilters() {
        let filtered = [...this.currentRecords];
        
        // 应用分类筛选
        if (this.filters.category !== 'all') {
            filtered = filtered.filter(record => 
                record.metadata.category === this.filters.category
            );
        }
        
        // 应用频率筛选
        if (this.filters.frequency !== 'all') {
            filtered = filtered.filter(record => 
                record.metadata.frequency === this.filters.frequency
            );
        }
        
        // 应用状态筛选
        if (this.filters.status !== 'all') {
            filtered = filtered.filter(record => 
                record.status === this.filters.status
            );
        }
        
        // 应用日期范围筛选
        filtered = this.applyDateRangeFilter(filtered);
        
        // 应用正确率筛选
        filtered = filtered.filter(record => {
            const accuracy = Math.round(record.accuracy * 100);
            return accuracy >= this.filters.minAccuracy && accuracy <= this.filters.maxAccuracy;
        });
        
        // 应用搜索筛选
        if (this.searchQuery) {
            filtered = filtered.filter(record => {
                const title = (record.metadata.examTitle || '').toLowerCase();
                const examId = (record.examId || '').toLowerCase();
                return title.includes(this.searchQuery) || examId.includes(this.searchQuery);
            });
        }
        
        // 应用排序
        filtered = this.applySorting(filtered);
        
        this.filteredRecords = filtered;
        
        // 更新统计信息
        this.updateHistoryStats();
        
        // 渲染记录列表
        this.renderHistoryList();
        
        // 渲染分页
        this.renderPagination();
    }

    /**
     * 应用日期范围筛选
     */
    applyDateRangeFilter(records) {
        if (this.filters.dateRange === 'all') {
            return records;
        }
        
        const now = new Date();
        let startDate, endDate;
        
        switch (this.filters.dateRange) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
                break;
            case 'week':
                const weekStart = new Date(now);
                weekStart.setDate(now.getDate() - now.getDay());
                weekStart.setHours(0, 0, 0, 0);
                startDate = weekStart;
                endDate = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                break;
            case 'custom':
                const startInput = document.getElementById('start-date');
                const endInput = document.getElementById('end-date');
                if (startInput?.value) startDate = new Date(startInput.value);
                if (endInput?.value) endDate = new Date(endInput.value + 'T23:59:59');
                break;
        }
        
        if (startDate || endDate) {
            return records.filter(record => {
                const recordDate = new Date(record.startTime);
                if (startDate && recordDate < startDate) return false;
                if (endDate && recordDate > endDate) return false;
                return true;
            });
        }
        
        return records;
    }

    /**
     * 应用排序
     */
    applySorting(records) {
        return records.sort((a, b) => {
            let aValue, bValue;
            
            switch (this.sortBy) {
                case 'startTime':
                    aValue = new Date(a.startTime).getTime();
                    bValue = new Date(b.startTime).getTime();
                    break;
                case 'accuracy':
                    aValue = a.accuracy;
                    bValue = b.accuracy;
                    break;
                case 'duration':
                    aValue = a.duration;
                    bValue = b.duration;
                    break;
                case 'examTitle':
                    aValue = (a.metadata.examTitle || '').toLowerCase();
                    bValue = (b.metadata.examTitle || '').toLowerCase();
                    break;
                default:
                    aValue = new Date(a.startTime).getTime();
                    bValue = new Date(b.startTime).getTime();
            }
            
            if (this.sortOrder === 'asc') {
                return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            } else {
                return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            }
        });
    }

    /**
     * 更新历史统计信息
     */
    updateHistoryStats() {
        const totalPractices = this.filteredRecords.length;
        const avgAccuracy = totalPractices > 0 
            ? Math.round(this.filteredRecords.reduce((sum, r) => sum + r.accuracy, 0) / totalPractices * 100)
            : 0;
        const totalTime = this.filteredRecords.reduce((sum, r) => sum + r.duration, 0);
        
        document.getElementById('total-practices').textContent = totalPractices;
        document.getElementById('avg-accuracy').textContent = avgAccuracy + '%';
        document.getElementById('total-time').textContent = Utils.formatDuration(totalTime);
        document.getElementById('filtered-count').textContent = totalPractices;
    }

    /**
     * 渲染历史记录列表
     */
    renderHistoryList() {
        const historyList = document.getElementById('history-list');
        if (!historyList) return;
        
        if (this.filteredRecords.length === 0) {
            historyList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <div class="empty-state-title">暂无练习记录</div>
                    <div class="empty-state-description">开始练习后，记录将显示在这里</div>
                </div>
            `;
            return;
        }
        
        // 计算当前页的记录
        const startIndex = (this.currentPage - 1) * this.recordsPerPage;
        const endIndex = startIndex + this.recordsPerPage;
        const pageRecords = this.filteredRecords.slice(startIndex, endIndex);
        
        historyList.innerHTML = pageRecords.map(record => this.createRecordItem(record)).join('');
    }

    /**
     * 创建记录项HTML
     */
    createRecordItem(record) {
        const accuracy = Math.round(record.accuracy * 100);
        const duration = Utils.formatDuration(record.duration);
        const startTime = Utils.formatDate(record.startTime, 'YYYY-MM-DD HH:mm');
        
        const accuracyClass = accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : 'needs-improvement';
        const statusClass = record.status === 'completed' ? 'completed' : 'interrupted';
        
        return `
            <div class="history-record-item" data-record-id="${record.id}">
                <div class="record-main">
                    <div class="record-status">
                        <div class="status-indicator ${statusClass}"></div>
                    </div>
                    <div class="record-content">
                        <h4 class="record-title">${record.metadata.examTitle || record.examId}</h4>
                        <div class="record-meta">
                            <span class="record-category">${record.metadata.category || 'Unknown'}</span>
                            <span class="record-frequency">${record.metadata.frequency === 'high' ? '高频' : '次高频'}</span>
                            <span class="record-time">${startTime}</span>
                        </div>
                    </div>
                    <div class="record-stats">
                        <div class="stat-item">
                            <span class="stat-value accuracy-${accuracyClass}">${accuracy}%</span>
                            <span class="stat-label">正确率</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-value">${duration}</span>
                            <span class="stat-label">用时</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-value">${record.correctAnswers}/${record.totalQuestions}</span>
                            <span class="stat-label">题目</span>
                        </div>
                    </div>
                    <div class="record-actions">
                        <button class="btn btn-sm btn-primary" data-history-action="retry" data-record-id="${record.id}">
                            重新练习
                        </button>
                        <button class="btn btn-sm btn-secondary" data-history-action="details" data-record-id="${record.id}">
                            查看详情
                        </button>
                        <button class="btn btn-sm btn-outline" data-history-action="delete" data-record-id="${record.id}">
                            删除
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染分页控件
     */
    renderPagination() {
        const pagination = document.getElementById('history-pagination');
        if (!pagination) return;
        
        const totalPages = Math.ceil(this.filteredRecords.length / this.recordsPerPage);
        
        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }
        
        let paginationHTML = '<div class="pagination">';
        
        // 上一页按钮
        paginationHTML += `
            <button class="page-btn ${this.currentPage === 1 ? 'disabled' : ''}" 
                    data-page="${this.currentPage - 1}">
                ← 上一页
            </button>
        `;
        
        // 页码按钮
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(totalPages, this.currentPage + 2);
        
        if (startPage > 1) {
            paginationHTML += `<button class="page-btn" data-page="1">1</button>`;
            if (startPage > 2) {
                paginationHTML += `<span class="page-ellipsis">...</span>`;
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="page-btn ${i === this.currentPage ? 'active' : ''}" 
                        data-page="${i}">
                    ${i}
                </button>
            `;
        }
        
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHTML += `<span class="page-ellipsis">...</span>`;
            }
            paginationHTML += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
        }
        
        // 下一页按钮
        paginationHTML += `
            <button class="page-btn ${this.currentPage === totalPages ? 'disabled' : ''}" 
                    data-page="${this.currentPage + 1}">
                下一页 →
            </button>
        `;
        
        paginationHTML += '</div>';
        
        // 页面信息
        const startRecord = (this.currentPage - 1) * this.recordsPerPage + 1;
        const endRecord = Math.min(this.currentPage * this.recordsPerPage, this.filteredRecords.length);
        
        paginationHTML += `
            <div class="pagination-info">
                显示 ${startRecord}-${endRecord} 条，共 ${this.filteredRecords.length} 条记录
            </div>
        `;
        
        pagination.innerHTML = paginationHTML;
    }

    /**
     * 跳转到指定页面
     */
    goToPage(page) {
        const totalPages = Math.ceil(this.filteredRecords.length / this.recordsPerPage);
        
        if (page < 1 || page > totalPages) return;
        
        this.currentPage = page;
        this.renderHistoryList();
        this.renderPagination();
        
        // 滚动到顶部
        document.getElementById('history-list').scrollIntoView({ behavior: 'smooth' });
    }

    /**
     * 处理记录操作
     */
    handleRecordAction(action, recordId) {
        const record = this.filteredRecords.find(r => r.id === recordId);
        if (!record) return;
        
        switch (action) {
            case 'retry':
                this.retryExam(record);
                break;
            case 'details':
                this.showRecordDetails(recordId);
                break;
            case 'delete':
                this.deleteRecord(recordId);
                break;
        }
    }

    /**
     * 重新练习题目
     */
    retryExam(record) {
        if (window.app && typeof window.app.openExam === 'function') {
            window.app.openExam(record.examId);
        } else {
            window.showMessage('无法重新打开题目', 'error');
        }
    }

    /**
     * 显示记录详情
     */
    showRecordDetails(recordId) {
        const record = this.filteredRecords.find(r => r.id === recordId);
        if (!record) return;
        
        const accuracy = Math.round(record.accuracy * 100);
        const duration = Utils.formatDuration(record.duration);
        const startTime = Utils.formatDate(record.startTime, 'YYYY-MM-DD HH:mm:ss');
        const endTime = Utils.formatDate(record.endTime, 'YYYY-MM-DD HH:mm:ss');
        
        const detailsContent = `
            <div class="record-details-modal">
                <div class="details-header">
                    <h3>练习记录详情</h3>
                    <button class="close-details" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="details-body">
                    <div class="details-section">
                        <h4>基本信息</h4>
                        <div class="details-grid">
                            <div class="detail-item">
                                <span class="detail-label">题目标题：</span>
                                <span class="detail-value">${record.metadata.examTitle || record.examId}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">分类：</span>
                                <span class="detail-value">${record.metadata.category || 'Unknown'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">频率：</span>
                                <span class="detail-value">${record.metadata.frequency === 'high' ? '高频' : '次高频'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">状态：</span>
                                <span class="detail-value">${record.status === 'completed' ? '已完成' : '中断'}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="details-section">
                        <h4>时间信息</h4>
                        <div class="details-grid">
                            <div class="detail-item">
                                <span class="detail-label">开始时间：</span>
                                <span class="detail-value">${startTime}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">结束时间：</span>
                                <span class="detail-value">${endTime}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">总用时：</span>
                                <span class="detail-value">${duration}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="details-section">
                        <h4>成绩信息</h4>
                        <div class="details-grid">
                            <div class="detail-item">
                                <span class="detail-label">正确率：</span>
                                <span class="detail-value accuracy-${accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : 'needs-improvement'}">${accuracy}%</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">总题数：</span>
                                <span class="detail-value">${record.totalQuestions}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">正确数：</span>
                                <span class="detail-value">${record.correctAnswers}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">错误数：</span>
                                <span class="detail-value">${record.totalQuestions - record.correctAnswers}</span>
                            </div>
                        </div>
                    </div>
                    
                    ${record.questionTypePerformance && Object.keys(record.questionTypePerformance).length > 0 ? `
                        <div class="details-section">
                            <h4>题型表现</h4>
                            <div class="question-type-performance">
                                ${Object.entries(record.questionTypePerformance).map(([type, perf]) => `
                                    <div class="type-performance-item">
                                        <span class="type-name">${this.formatQuestionType(type)}</span>
                                        <span class="type-stats">${perf.correct || 0}/${perf.total || 0}</span>
                                        <span class="type-accuracy">${Math.round((perf.accuracy || 0) * 100)}%</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <div class="details-actions">
                        <button class="btn btn-primary" onclick="window.app.components.practiceHistory.retryExam(${JSON.stringify(record).replace(/"/g, '&quot;')})">
                            重新练习
                        </button>
                        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        this.showModal(detailsContent);
    }

    /**
     * 删除记录
     */
    deleteRecord(recordId) {
        if (!confirm('确定要删除这条练习记录吗？此操作不可撤销。')) {
            return;
        }
        
        try {
            // 从存储中删除记录
            const allRecords = storage.get('practice_records', []);
            const updatedRecords = allRecords.filter(r => r.id !== recordId);
            storage.set('practice_records', updatedRecords);
            
            // 刷新显示
            this.refreshHistory();
            
            window.showMessage('记录已删除', 'success');
            
        } catch (error) {
            console.error('Failed to delete record:', error);
            window.showMessage('删除记录失败', 'error');
        }
    }

    /**
     * 重置筛选器
     */
    resetFilters() {
        // 重置筛选器值
        this.filters = {
            category: 'all',
            frequency: 'all',
            status: 'all',
            dateRange: 'all',
            minAccuracy: 0,
            maxAccuracy: 100
        };
        this.searchQuery = '';
        this.currentPage = 1;
        
        // 重置UI
        document.getElementById('category-filter').value = 'all';
        document.getElementById('frequency-filter').value = 'all';
        document.getElementById('status-filter').value = 'all';
        document.getElementById('date-range-filter').value = 'all';
        document.getElementById('min-accuracy').value = '0';
        document.getElementById('max-accuracy').value = '100';
        document.getElementById('min-accuracy-value').textContent = '0%';
        document.getElementById('max-accuracy-value').textContent = '100%';
        document.getElementById('history-search').value = '';
        document.getElementById('custom-date-range').style.display = 'none';
        
        // 重新应用筛选
        this.applyFilters();
    }

    /**
     * 应用自定义日期范围
     */
    applyDateRange() {
        this.applyFilters();
    }

    /**
     * 导出历史记录
     */
    exportHistory() {
        try {
            const practiceRecorder = window.app?.components?.practiceRecorder;
            if (!practiceRecorder) {
                throw new Error('PracticeRecorder not available');
            }
            
            // 导出为JSON格式
            const exportData = practiceRecorder.exportData('json');
            
            // 创建下载链接
            const blob = new Blob([exportData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `practice_history_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            window.showMessage('历史记录已导出', 'success');
            
        } catch (error) {
            console.error('Failed to export history:', error);
            window.showMessage('导出失败', 'error');
        }
    }

    /**
     * 显示导入对话框
     */
    showImportDialog() {
        const importContent = `
            <div class="import-dialog">
                <div class="import-header">
                    <h3>导入练习记录</h3>
                    <button class="close-import" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="import-body">
                    <div class="import-options">
                        <label>
                            <input type="radio" name="import-mode" value="merge" checked>
                            合并模式（保留现有记录，添加新记录）
                        </label>
                        <label>
                            <input type="radio" name="import-mode" value="replace">
                            替换模式（完全替换现有记录）
                        </label>
                    </div>
                    <div class="file-input-area">
                        <input type="file" id="import-file" accept=".json" style="display: none;">
                        <button class="btn btn-primary" onclick="document.getElementById('import-file').click()">
                            选择文件
                        </button>
                        <span id="file-name">未选择文件</span>
                    </div>
                    <div class="import-actions">
                        <button class="btn btn-primary" onclick="window.app.components.practiceHistory.performImport()">
                            导入
                        </button>
                        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                            取消
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        this.showModal(importContent);
        
        // 设置文件选择事件
        document.getElementById('import-file').addEventListener('change', (e) => {
            const fileName = e.target.files[0]?.name || '未选择文件';
            document.getElementById('file-name').textContent = fileName;
        });
    }

    /**
     * 执行导入
     */
    async performImport() {
        const fileInput = document.getElementById('import-file');
        const file = fileInput.files[0];
        
        if (!file) {
            window.showMessage('请选择要导入的文件', 'warning');
            return;
        }
        
        try {
            const importMode = document.querySelector('input[name="import-mode"]:checked').value;
            const fileContent = await this.readFile(file);
            
            const practiceRecorder = window.app?.components?.practiceRecorder;
            if (!practiceRecorder) {
                throw new Error('PracticeRecorder not available');
            }
            
            await practiceRecorder.importData(fileContent, { merge: importMode === 'merge' });
            
            // 关闭对话框
            document.querySelector('.modal-overlay').remove();
            
            // 刷新历史记录
            this.refreshHistory();
            
            window.showMessage('数据导入成功', 'success');
            
        } catch (error) {
            console.error('Failed to import data:', error);
            window.showMessage('导入失败：' + error.message, 'error');
        }
    }

    /**
     * 读取文件内容
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('文件读取失败'));
            reader.readAsText(file);
        });
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
     * 显示错误信息
     */
    showError(message) {
        const historyList = document.getElementById('history-list');
        if (historyList) {
            historyList.innerHTML = `
                <div class="error-state">
                    <div class="error-state-icon">⚠️</div>
                    <div class="error-state-title">加载失败</div>
                    <div class="error-state-description">${message}</div>
                    <button class="btn btn-primary" onclick="window.app.components.practiceHistory.refreshHistory()">
                        重试
                    </button>
                </div>
            `;
        }
    }

    /**
     * 销毁组件
     */
    destroy() {
        console.log('PracticeHistory component destroyed');
    }
}

// 确保全局可用
window.PracticeHistory = PracticeHistory;