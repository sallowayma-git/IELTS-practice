// RecordViewer.js - Global class for file:// protocol compatibility
// Manages practice records display using existing DOM structure

window.RecordViewer = class RecordViewer {
    constructor(stores) {
        this.stores = stores;
        this.currentFilter = 'all';
        this.bulkDeleteMode = false;
        this.selectedRecords = new Set();
        
        // Get existing DOM elements
        this.elements = {
            totalPracticed: document.getElementById('total-practiced'),
            avgScore: document.getElementById('avg-score'),
            studyTime: document.getElementById('study-time'),
            streakDays: document.getElementById('streak-days'),
            historyList: document.getElementById('practice-history-list'),
            filterButtons: document.getElementById('record-type-filter-buttons'),
            bulkDeleteBtn: document.getElementById('bulk-delete-btn')
        };
        
        // Verify required elements exist
        this.checkRequiredElements();
        
        // Subscribe to store changes
        this.unsubscribeRecords = this.stores.records.subscribe(this.handleRecordStoreChange.bind(this));
        this.unsubscribeApp = this.stores.app.subscribe(this.handleAppStoreChange.bind(this));
        
        // Setup event listeners
        this.setupEventListeners();
        
        console.log('[RecordViewer] Initialized with existing DOM structure');
    }
    
    checkRequiredElements() {
        const required = ['totalPracticed', 'avgScore', 'studyTime', 'streakDays', 'historyList'];
        const missing = required.filter(key => !this.elements[key]);
        
        if (missing.length > 0) {
            console.warn('[RecordViewer] Missing DOM elements:', missing);
            // Create fallback elements if needed
            this.createFallbackElements(missing);
        }
    }
    
    createFallbackElements(missing) {
        // Create minimal fallback elements
        missing.forEach(elementKey => {
            if (!this.elements[elementKey]) {
                this.elements[elementKey] = document.createElement('div');
                this.elements[elementKey].id = elementKey.replace(/([A-Z])/g, '-$1').toLowerCase();
                console.warn(`[RecordViewer] Created fallback element: ${elementKey}`);
            }
        });
    }
    
    setupEventListeners() {
        // Filter buttons
        if (this.elements.filterButtons) {
            this.elements.filterButtons.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') {
                    const type = e.target.textContent.trim();
                    this.handleTypeFilter(this.mapTypeButtonToFilter(type));
                    this.updateFilterButtons(e.target);
                }
            });
        }
        
        // Bulk delete button
        if (this.elements.bulkDeleteBtn) {
            this.elements.bulkDeleteBtn.addEventListener('click', () => {
                this.toggleBulkDelete();
            });
        }
        
        // Global functions for backward compatibility
        window.filterRecordsByType = (type) => this.handleTypeFilter(type);
        window.toggleBulkDelete = () => this.toggleBulkDelete();
        window.clearPracticeData = () => this.clearAllRecords();
    }
    
    mapTypeButtonToFilter(buttonText) {
        const mapping = {
            '全部': 'all',
            '阅读': 'reading',
            '听力': 'listening'
        };
        return mapping[buttonText] || 'all';
    }
    
    handleRecordStoreChange(event) {
        switch (event.type) {
            case 'records_loaded':
            case 'record_saved':
            case 'record_deleted':
            case 'records_cleared':
            case 'records_imported':
                this.renderRecordList();
                break;
            case 'stats_updated':
                this.renderStats();
                break;
            default:
                console.log('[RecordViewer] Unhandled record store event:', event.type);
        }
    }
    
    handleAppStoreChange(event) {
        switch (event.type) {
            case 'view_changed':
                if (event.view === 'practice') {
                    this.render();
                }
                break;
            default:
                // Ignore other app events
        }
    }
    
    handleTypeFilter(type) {
        this.currentFilter = type;
        this.renderRecordList();
        console.log('[RecordViewer] Type filter:', type);
    }
    
    updateFilterButtons(activeButton) {
        if (!this.elements.filterButtons) return;
        
        // Remove active class from all buttons
        this.elements.filterButtons.querySelectorAll('button').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active class to clicked button
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }
    
    render() {
        this.renderStats();
        this.renderRecordList();
    }
    
    renderStats() {
        const stats = this.stores.records.stats;
        
        try {
            // Update stat cards
            if (this.elements.totalPracticed) {
                this.elements.totalPracticed.textContent = stats.totalPracticed || 0;
            }
            
            if (this.elements.avgScore) {
                this.elements.avgScore.textContent = `${stats.averageScore || 0}%`;
            }
            
            if (this.elements.studyTime) {
                const minutes = Math.round((stats.studyTime || 0) / 60);
                this.elements.studyTime.textContent = minutes;
            }
            
            if (this.elements.streakDays) {
                this.elements.streakDays.textContent = stats.streakDays || 0;
            }
            
        } catch (error) {
            console.error('[RecordViewer] Failed to render stats:', error);
        }
    }
    
    renderRecordList() {
        if (!this.elements.historyList) {
            console.warn('[RecordViewer] Cannot render records: historyList element not found');
            return;
        }
        
        try {
            // Get filtered records
            const records = this.getFilteredRecords();
            
            if (records.length === 0) {
                this.renderEmptyState();
                return;
            }
            
            // Group records by date for better organization
            const groupedRecords = this.groupRecordsByDate(records);
            
            let html = '';
            
            Object.keys(groupedRecords).forEach(dateGroup => {
                const dayRecords = groupedRecords[dateGroup];
                
                html += `
                    <div class="record-date-group">
                        <h4 class="record-date-header">${dateGroup} (${dayRecords.length}次练习)</h4>
                        <div class="record-list">
                `;
                
                dayRecords.forEach(record => {
                    html += this.renderRecordCard(record);
                });
                
                html += `
                        </div>
                    </div>
                `;
            });
            
            this.elements.historyList.innerHTML = html;
            
            // Setup event listeners for record cards
            this.setupRecordCardListeners();
            
        } catch (error) {
            console.error('[RecordViewer] Failed to render record list:', error);
            this.renderError(error.message);
        }
    }
    
    getFilteredRecords() {
        const filters = {};
        
        if (this.currentFilter !== 'all') {
            filters.type = this.currentFilter;
        }
        
        return this.stores.records.getRecords(filters);
    }
    
    groupRecordsByDate(records) {
        const grouped = {};
        
        records.forEach(record => {
            const date = new Date(record.date);
            const dateKey = this.formatDateGroup(date);
            
            if (!grouped[dateKey]) {
                grouped[dateKey] = [];
            }
            grouped[dateKey].push(record);
        });
        
        return grouped;
    }
    
    formatDateGroup(date) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        
        const recordDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const yesterdayDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        
        if (recordDate.getTime() === todayDate.getTime()) {
            return '今天';
        } else if (recordDate.getTime() === yesterdayDate.getTime()) {
            return '昨天';
        } else {
            return date.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
    }
    
    renderRecordCard(record) {
        const exam = this.stores.exams.getExamById(record.examId);
        const examTitle = exam ? exam.title : `题目 ${record.examId}`;
        const examCategory = exam ? exam.category : 'Unknown';
        const examType = exam ? (exam.type || 'reading') : 'reading';
        
        const score = record.score || {};
        const percentage = score.percentage || 0;
        const correct = score.correct || 0;
        const total = score.total || 0;
        
        const duration = this.formatDuration(record.duration || 0);
        const time = new Date(record.date).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const scoreClass = this.getScoreClass(percentage);
        
        return `
            <div class="record-card" data-record-id="${record.id}">
                ${this.bulkDeleteMode ? `
                    <div class="record-checkbox">
                        <input type="checkbox" class="record-select" data-record-id="${record.id}">
                    </div>
                ` : ''}
                <div class="record-header">
                    <div class="record-exam-info">
                        <span class="record-category">${examCategory}</span>
                        <span class="record-type">${this.getTypeIcon(examType)} ${examType === 'reading' ? '阅读' : '听力'}</span>
                        <span class="record-time">${time}</span>
                    </div>
                    <div class="record-score ${scoreClass}">
                        ${percentage.toFixed(1)}%
                    </div>
                </div>
                <h5 class="record-title">${this.escapeHtml(examTitle)}</h5>
                <div class="record-details">
                    <span class="record-detail">
                        <span class="detail-label">正确率:</span>
                        <span class="detail-value">${correct}/${total}</span>
                    </span>
                    <span class="record-detail">
                        <span class="detail-label">用时:</span>
                        <span class="detail-value">${duration}</span>
                    </span>
                    <span class="record-detail">
                        <span class="detail-label">数据源:</span>
                        <span class="detail-value">${record.dataSource === 'real' ? '真实' : '模拟'}</span>
                    </span>
                </div>
                <div class="record-actions">
                    <button class="btn btn-sm btn-secondary view-record-btn" data-record-id="${record.id}">
                        📊 查看详情
                    </button>
                    ${exam ? `
                        <button class="btn btn-sm btn-primary retry-exam-btn" data-exam-id="${record.examId}">
                            🔄 重新练习
                        </button>
                    ` : ''}
                    <button class="btn btn-sm btn-danger delete-record-btn" data-record-id="${record.id}">
                        🗑️ 删除
                    </button>
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
    
    getScoreClass(percentage) {
        if (percentage >= 80) return 'score-excellent';
        if (percentage >= 60) return 'score-good';
        if (percentage >= 40) return 'score-fair';
        return 'score-poor';
    }
    
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
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    setupRecordCardListeners() {
        if (!this.elements.historyList) return;
        
        // View record details buttons
        this.elements.historyList.querySelectorAll('.view-record-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const recordId = e.target.getAttribute('data-record-id');
                this.handleViewRecord(recordId);
            });
        });
        
        // Retry exam buttons
        this.elements.historyList.querySelectorAll('.retry-exam-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const examId = e.target.getAttribute('data-exam-id');
                this.handleRetryExam(examId);
            });
        });
        
        // Delete record buttons
        this.elements.historyList.querySelectorAll('.delete-record-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const recordId = e.target.getAttribute('data-record-id');
                this.handleDeleteRecord(recordId);
            });
        });
        
        // Bulk select checkboxes
        this.elements.historyList.querySelectorAll('.record-select').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const recordId = e.target.getAttribute('data-record-id');
                if (e.target.checked) {
                    this.selectedRecords.add(recordId);
                } else {
                    this.selectedRecords.delete(recordId);
                }
                this.updateBulkDeleteButton();
            });
        });
    }
    
    handleViewRecord(recordId) {
        try {
            const record = this.stores.records.getRecordById(recordId);
            if (!record) {
                throw new Error(`Record not found: ${recordId}`);
            }
            
            console.log('[RecordViewer] Viewing record:', recordId);
            
            // Use existing record modal if available
            if (window.showPracticeRecordModal) {
                window.showPracticeRecordModal(record);
            } else {
                // Fallback: show basic info
                const exam = this.stores.exams.getExamById(record.examId);
                const examTitle = exam ? exam.title : record.examId;
                const score = record.score || {};
                
                alert(`练习记录详情\n\n题目: ${examTitle}\n正确率: ${score.percentage || 0}%\n用时: ${this.formatDuration(record.duration || 0)}\n日期: ${new Date(record.date).toLocaleString('zh-CN')}`);
            }
            
        } catch (error) {
            console.error('[RecordViewer] Failed to view record:', error);
            this.stores.app.addError({
                message: `Failed to view record: ${error.message}`,
                context: 'RecordViewer.handleViewRecord',
                error: error,
                recoverable: true,
                userMessage: '无法查看练习记录详情。',
                actions: ['Try again', 'Refresh page']
            });
        }
    }
    
    handleRetryExam(examId) {
        try {
            const exam = this.stores.exams.getExamById(examId);
            if (!exam) {
                throw new Error(`Exam not found: ${examId}`);
            }
            
            console.log('[RecordViewer] Retrying exam:', examId);
            
            // Use ExamBrowser to start the exam
            if (window.app && window.app.ui && window.app.ui.browser) {
                window.app.ui.browser.handleExamStart(examId);
            } else if (window.openExamWindow) {
                const examPath = this.stores.exams.getExamPath(exam);
                window.openExamWindow(examPath, exam);
            } else {
                throw new Error('Exam browser not available');
            }
            
        } catch (error) {
            console.error('[RecordViewer] Failed to retry exam:', error);
            this.stores.app.addError({
                message: `Failed to retry exam: ${error.message}`,
                context: 'RecordViewer.handleRetryExam',
                error: error,
                recoverable: true,
                userMessage: '无法重新开始练习。',
                actions: ['Try again', 'Go to exam browser']
            });
        }
    }
    
    async handleDeleteRecord(recordId) {
        try {
            const record = this.stores.records.getRecordById(recordId);
            if (!record) {
                throw new Error(`Record not found: ${recordId}`);
            }
            
            const exam = this.stores.exams.getExamById(record.examId);
            const examTitle = exam ? exam.title : record.examId;
            
            const confirmed = confirm(`确定要删除这条练习记录吗？\n\n题目: ${examTitle}\n日期: ${new Date(record.date).toLocaleString('zh-CN')}`);
            
            if (confirmed) {
                await this.stores.records.deleteRecord(recordId);
                console.log('[RecordViewer] Deleted record:', recordId);
                
                if (window.showMessage) {
                    window.showMessage('练习记录已删除', 'success');
                }
            }
            
        } catch (error) {
            console.error('[RecordViewer] Failed to delete record:', error);
            this.stores.app.addError({
                message: `Failed to delete record: ${error.message}`,
                context: 'RecordViewer.handleDeleteRecord',
                error: error,
                recoverable: true,
                userMessage: '无法删除练习记录。',
                actions: ['Try again', 'Refresh page']
            });
        }
    }
    
    toggleBulkDelete() {
        this.bulkDeleteMode = !this.bulkDeleteMode;
        this.selectedRecords.clear();
        
        this.renderRecordList();
        this.updateBulkDeleteButton();
        
        console.log('[RecordViewer] Bulk delete mode:', this.bulkDeleteMode);
    }
    
    updateBulkDeleteButton() {
        if (!this.elements.bulkDeleteBtn) return;
        
        if (this.bulkDeleteMode) {
            const selectedCount = this.selectedRecords.size;
            this.elements.bulkDeleteBtn.textContent = selectedCount > 0 ? `删除选中 (${selectedCount})` : '取消批量删除';
            this.elements.bulkDeleteBtn.className = selectedCount > 0 ? 'btn btn-danger' : 'btn btn-secondary';
            
            if (selectedCount > 0) {
                this.elements.bulkDeleteBtn.onclick = () => this.executeBulkDelete();
            } else {
                this.elements.bulkDeleteBtn.onclick = () => this.toggleBulkDelete();
            }
        } else {
            this.elements.bulkDeleteBtn.textContent = '📝 批量删除';
            this.elements.bulkDeleteBtn.className = 'btn btn-info';
            this.elements.bulkDeleteBtn.onclick = () => this.toggleBulkDelete();
        }
    }
    
    async executeBulkDelete() {
        if (this.selectedRecords.size === 0) return;
        
        const confirmed = confirm(`确定要删除选中的 ${this.selectedRecords.size} 条练习记录吗？\n\n此操作不可撤销。`);
        
        if (confirmed) {
            try {
                const recordIds = Array.from(this.selectedRecords);
                let deletedCount = 0;
                
                for (const recordId of recordIds) {
                    try {
                        await this.stores.records.deleteRecord(recordId);
                        deletedCount++;
                    } catch (error) {
                        console.error('[RecordViewer] Failed to delete record in bulk:', recordId, error);
                    }
                }
                
                this.selectedRecords.clear();
                this.bulkDeleteMode = false;
                this.renderRecordList();
                this.updateBulkDeleteButton();
                
                if (window.showMessage) {
                    window.showMessage(`已删除 ${deletedCount} 条练习记录`, 'success');
                }
                
                console.log('[RecordViewer] Bulk delete completed:', deletedCount);
                
            } catch (error) {
                console.error('[RecordViewer] Bulk delete failed:', error);
                this.stores.app.addError({
                    message: `Bulk delete failed: ${error.message}`,
                    context: 'RecordViewer.executeBulkDelete',
                    error: error,
                    recoverable: true,
                    userMessage: '批量删除失败。',
                    actions: ['Try again', 'Delete individually']
                });
            }
        }
    }
    
    async clearAllRecords() {
        const recordCount = this.stores.records.records.length;
        if (recordCount === 0) {
            if (window.showMessage) {
                window.showMessage('没有练习记录需要清除', 'info');
            }
            return;
        }
        
        const confirmed = confirm(`确定要清除所有 ${recordCount} 条练习记录吗？\n\n此操作不可撤销，建议先导出数据备份。`);
        
        if (confirmed) {
            try {
                await this.stores.records.clearAllRecords();
                
                if (window.showMessage) {
                    window.showMessage('所有练习记录已清除', 'success');
                }
                
                console.log('[RecordViewer] All records cleared');
                
            } catch (error) {
                console.error('[RecordViewer] Failed to clear all records:', error);
                this.stores.app.addError({
                    message: `Failed to clear records: ${error.message}`,
                    context: 'RecordViewer.clearAllRecords',
                    error: error,
                    recoverable: true,
                    userMessage: '无法清除练习记录。',
                    actions: ['Try again', 'Export data first']
                });
            }
        }
    }
    
    renderEmptyState() {
        if (!this.elements.historyList) return;
        
        let message = '暂无练习记录';
        let suggestion = '开始练习后，记录将自动保存在这里';
        
        if (this.currentFilter !== 'all') {
            message = `暂无${this.currentFilter === 'reading' ? '阅读' : '听力'}练习记录`;
            suggestion = '尝试切换到其他题型或开始练习';
        }
        
        this.elements.historyList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <h3>${message}</h3>
                <p>${suggestion}</p>
                <div class="empty-actions">
                    <button class="btn btn-primary" onclick="window.showView && window.showView('browse');">
                        📚 去练习
                    </button>
                    ${this.currentFilter !== 'all' ? `
                        <button class="btn btn-secondary" onclick="window.filterRecordsByType && window.filterRecordsByType('all');">
                            显示全部
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    renderError(message) {
        if (!this.elements.historyList) return;
        
        this.elements.historyList.innerHTML = `
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
    
    // Public API methods
    refresh() {
        this.render();
    }
    
    setFilter(type) {
        this.currentFilter = type;
        this.renderRecordList();
    }
    
    // Handle record completion from exam windows
    async handleRecordComplete(recordData) {
        try {
            const record = await this.stores.records.saveRecord(recordData);
            console.log('[RecordViewer] Record saved:', record.id);
            
            if (window.showMessage) {
                window.showMessage('练习记录已保存', 'success');
            }
            
            return record;
        } catch (error) {
            console.error('[RecordViewer] Failed to save record:', error);
            this.stores.app.addError({
                message: `Failed to save record: ${error.message}`,
                context: 'RecordViewer.handleRecordComplete',
                error: error,
                recoverable: true,
                userMessage: '无法保存练习记录。',
                actions: ['Try again', 'Export data manually']
            });
            throw error;
        }
    }
    
    // Cleanup
    destroy() {
        if (this.unsubscribeRecords) {
            this.unsubscribeRecords();
        }
        if (this.unsubscribeApp) {
            this.unsubscribeApp();
        }
        
        // Remove global functions
        delete window.filterRecordsByType;
        delete window.toggleBulkDelete;
        delete window.clearPracticeData;
        
        console.log('[RecordViewer] Destroyed');
    }
};