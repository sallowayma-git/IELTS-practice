// RecordViewer.js - Controller/glue for practice records UI
// Coordinates RecordStats, RecordList components
// Inherits from BaseComponent, handles store integration and actions

class RecordViewer extends BaseComponent {
    constructor(stores) {
        super(stores, {
            container: document.getElementById('practice-view'),
            filterButtons: document.getElementById('record-type-filter-buttons'),
            bulkDeleteBtn: document.getElementById('bulk-delete-btn')
        });
        this.currentFilter = 'all';
        this.bulkDeleteMode = false;
        this.selectedRecords = new Set();
        this.checkRequiredElements();
        this.initSubComponents();
    }

    checkRequiredElements() {
        const required = ['container'];
        const missing = required.filter(key => !this.elements[key]);
        if (missing.length > 0) {
            console.warn('[RecordViewer] Missing elements:', missing);
            this.createFallbackElements(missing);
        }
    }

    createFallbackElements(missing) {
        if (missing.includes('container')) {
            this.elements.container = document.createElement('div');
            this.elements.container.id = 'practice-view';
            document.body.appendChild(this.elements.container);
        }
        if (!this.elements.filterButtons) {
            this.elements.filterButtons = document.createElement('div');
            this.elements.filterButtons.id = 'record-type-filter-buttons';
            this.elements.filterButtons.innerHTML = `
                <button>全部</button>
                <button>阅读</button>
                <button>听力</button>
            `;
            this.elements.container.appendChild(this.elements.filterButtons);
        }
        if (!this.elements.bulkDeleteBtn) {
            this.elements.bulkDeleteBtn = document.createElement('button');
            this.elements.bulkDeleteBtn.id = 'bulk-delete-btn';
            this.elements.bulkDeleteBtn.textContent = '📝 批量删除';
            this.elements.bulkDeleteBtn.className = 'btn btn-info';
            this.elements.container.appendChild(this.elements.bulkDeleteBtn);
        }
    }

    initSubComponents() {
        const statsContainer = document.createElement('div');
        statsContainer.id = 'stats-container';
        this.elements.container.appendChild(statsContainer);

        const listContainer = document.createElement('div');
        listContainer.id = 'list-container';
        this.elements.container.appendChild(listContainer);

        this.stats = new RecordStats(this.stores, statsContainer);
        this.recordList = new RecordList(this.stores, listContainer, (action, id) => this.handleRecordAction(action, id));
    }

    attach(container) {
        super.attach(container);
        this.stats.attach(this.elements.container.querySelector('#stats-container'));
        this.recordList.attach(this.elements.container.querySelector('#list-container'));
        this.setupEventListeners();
        this.render();
    }

    setupEventListeners() {
        if (this.elements.filterButtons) {
            const filterHandler = (e) => {
                if (e.target.tagName === 'BUTTON') {
                    const type = this.mapTypeButtonToFilter(e.target.textContent.trim());
                    this.currentFilter = type;
                    this.updateFilterButtons(e.target);
                    this.render();
                }
            };
            this.addEventListener(this.elements.filterButtons, 'click', filterHandler);
        }

        if (this.elements.bulkDeleteBtn) {
            this.addEventListener(this.elements.bulkDeleteBtn, 'click', () => this.toggleBulkDelete());
        }

        // Global compatibility
        window.filterRecordsByType = (type) => {
            this.currentFilter = type;
            this.render();
        };
        window.toggleBulkDelete = () => this.toggleBulkDelete();
        window.clearPracticeData = () => this.clearAllRecords();
    }

    mapTypeButtonToFilter(buttonText) {
        const mapping = { '全部': 'all', '阅读': 'reading', '听力': 'listening' };
        return mapping[buttonText] || 'all';
    }

    updateFilterButtons(activeButton) {
        if (!this.elements.filterButtons) return;
        this.elements.filterButtons.querySelectorAll('button').forEach(btn => {
            btn.classList.remove('active');
        });
        if (activeButton) activeButton.classList.add('active');
    }

    subscribeToStores() {
        this.addSubscription(this.stores.records.subscribe(this.handleRecordStoreChange.bind(this)));
        this.addSubscription(this.stores.app.subscribe(this.handleAppStoreChange.bind(this)));
    }

    handleRecordStoreChange(event) {
        switch (event.type) {
            case 'records_loaded':
            case 'record_saved':
            case 'record_deleted':
            case 'records_cleared':
            case 'records_imported':
                this.render();
                break;
            case 'stats_updated':
                this.stats.refresh();
                break;
        }
    }

    handleAppStoreChange(event) {
        switch (event.type) {
            case 'view_changed':
                if (event.view === 'practice') this.render();
                break;
        }
    }

    render() {
        this.stats.render();
        const filters = this.currentFilter !== 'all' ? { type: this.currentFilter } : {};
        const filteredRecords = this.stores.records.getRecords(filters);
        this.recordList.setRecords(filteredRecords);
        this.recordList.setBulkMode(this.bulkDeleteMode);
        if (this.bulkDeleteMode) this.updateBulkDeleteButton();
    }

    handleRecordAction(action, id) {
        if (action === 'view') {
            this.handleViewRecord(id);
        } else if (action === 'retry') {
            this.handleRetryExam(id);
        } else if (action === 'delete') {
            this.handleDeleteRecord(id);
        } else if (action === 'selectionChange') {
            this.selectedRecords = new Set(id);
            this.updateBulkDeleteButton();
        }
    }

    handleViewRecord(recordId) {
        try {
            const record = this.stores.records.getRecordById(recordId);
            if (!record) throw new Error(`Record not found: ${recordId}`);

            console.log('[RecordViewer] Viewing record:', recordId);

            if (window.showPracticeRecordModal) {
                window.showPracticeRecordModal(record);
            } else {
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
                error,
                recoverable: true,
                userMessage: '无法查看练习记录详情。',
                actions: ['Try again', 'Refresh page']
            });
        }
    }

    handleRetryExam(examId) {
        try {
            const exam = this.stores.exams.getExamById(examId);
            if (!exam) throw new Error(`Exam not found: ${examId}`);

            console.log('[RecordViewer] Retrying exam:', examId);

            if (window.ExamBrowserInstance && window.ExamBrowserInstance.handleExamStart) {
                window.ExamBrowserInstance.handleExamStart(examId);
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
                error,
                recoverable: true,
                userMessage: '无法重新开始练习。',
                actions: ['Try again', 'Go to exam browser']
            });
        }
    }

    async handleDeleteRecord(recordId) {
        try {
            const record = this.stores.records.getRecordById(recordId);
            if (!record) throw new Error(`Record not found: ${recordId}`);

            const exam = this.stores.exams.getExamById(record.examId);
            const examTitle = exam ? exam.title : record.examId;

            const confirmed = confirm(`确定要删除这条练习记录吗？\n\n题目: ${examTitle}\n日期: ${new Date(record.date).toLocaleString('zh-CN')}`);
            if (confirmed) {
                await this.stores.records.deleteRecord(recordId);
                console.log('[RecordViewer] Deleted record:', recordId);
                if (window.showMessage) window.showMessage('练习记录已删除', 'success');
            }
        } catch (error) {
            console.error('[RecordViewer] Failed to delete record:', error);
            this.stores.app.addError({
                message: `Failed to delete record: ${error.message}`,
                context: 'RecordViewer.handleDeleteRecord',
                error,
                recoverable: true,
                userMessage: '无法删除练习记录。',
                actions: ['Try again', 'Refresh page']
            });
        }
    }

    toggleBulkDelete() {
        this.bulkDeleteMode = !this.bulkDeleteMode;
        this.selectedRecords.clear();
        this.recordList.setBulkMode(this.bulkDeleteMode);
        this.recordList.clearSelection();
        this.updateBulkDeleteButton();
        console.log('[RecordViewer] Bulk delete mode:', this.bulkDeleteMode);
    }

    updateBulkDeleteButton() {
        if (!this.elements.bulkDeleteBtn) return;

        const selectedCount = this.selectedRecords.size;
        if (this.bulkDeleteMode) {
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
                        console.error('[RecordViewer] Failed to delete in bulk:', recordId, error);
                    }
                }

                this.selectedRecords.clear();
                this.bulkDeleteMode = false;
                this.recordList.setBulkMode(false);
                this.recordList.clearSelection();
                this.updateBulkDeleteButton();
                this.render();

                if (window.showMessage) window.showMessage(`已删除 ${deletedCount} 条练习记录`, 'success');
                console.log('[RecordViewer] Bulk delete completed:', deletedCount);
            } catch (error) {
                console.error('[RecordViewer] Bulk delete failed:', error);
                this.stores.app.addError({
                    message: `Bulk delete failed: ${error.message}`,
                    context: 'RecordViewer.executeBulkDelete',
                    error,
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
            if (window.showMessage) window.showMessage('没有练习记录需要清除', 'info');
            return;
        }

        const confirmed = confirm(`确定要清除所有 ${recordCount} 条练习记录吗？\n\n此操作不可撤销，建议先导出数据备份。`);
        if (confirmed) {
            try {
                await this.stores.records.clearAllRecords();
                if (window.showMessage) window.showMessage('所有练习记录已清除', 'success');
                console.log('[RecordViewer] All records cleared');
            } catch (error) {
                console.error('[RecordViewer] Failed to clear all records:', error);
                this.stores.app.addError({
                    message: `Failed to clear records: ${error.message}`,
                    context: 'RecordViewer.clearAllRecords',
                    error,
                    recoverable: true,
                    userMessage: '无法清除练习记录。',
                    actions: ['Try again', 'Export data first']
                });
            }
        }
    }

    formatDuration(seconds) {
        if (seconds < 60) return `${seconds}秒`;
        if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return remainingSeconds > 0 ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`;
        }
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
    }

    // Public API
    setFilter(type) {
        this.currentFilter = type;
        this.render();
    }

    refresh() {
        this.render();
    }

    async handleRecordComplete(recordData) {
        try {
            const record = await this.stores.records.saveRecord(recordData);
            console.log('[RecordViewer] Record saved:', record.id);
            if (window.showMessage) window.showMessage('练习记录已保存', 'success');
            return record;
        } catch (error) {
            console.error('[RecordViewer] Failed to save record:', error);
            this.stores.app.addError({
                message: `Failed to save record: ${error.message}`,
                context: 'RecordViewer.handleRecordComplete',
                error,
                recoverable: true,
                userMessage: '无法保存练习记录。',
                actions: ['Try again', 'Export data manually']
            });
            throw error;
        }
    }

    // Global instance
    static instance = null;
}

// Export and set global instance
const recordViewerInstance = new RecordViewer(window.stores || { records: {}, exams: {}, app: {} });
window.RecordViewer = RecordViewer;
window.RecordViewerInstance = recordViewerInstance;
recordViewerInstance.attach(document.getElementById('practice-view') || document.body);

console.log('[RecordViewer] Controller initialized');