// RecordViewer.js - Controller/glue for practice records UI
// Coordinates RecordStats, RecordList components
// Inherits from BaseComponent, handles store integration and actions

// BaseComponent 兜底处理 (Task 74)
if (!window.BaseComponent) {
    window.BaseComponent = class {
        constructor() { this.subscriptions = []; }
        attach() {}
        detach() { this.subscriptions.forEach(u => u()); }
        render() {}
        addSubscription(u) { this.subscriptions.push(u); }
        addEventListener() {}
        setupEventListeners() {}
        subscribeToStores() {}
        cleanupEventListeners() {}
        unsubscribeFromStores() {}
    };
    console.warn('[RecordViewer] BaseComponent missing, using fallback');
}

// UI子组件兜底处理 (Task 81)
if (!window.RecordStats) {
    window.RecordStats = class {
        constructor(){}
        render(){} update(){} destroy(){}
        attach(){}
        calculateStats(){ return { total: 0, avgScore: 0, studyTime: 0, streakDays: 0 }; }
        setStats(){}
    };
}

// RecordList 兜底处理 (Task 93)
if (!window.RecordList) {
    window.RecordList = class {
        constructor(container, options = {}){
            this.container = container;
            this.options = options;
            this.records = [];
            this.bulkMode = false;
        }
        render(){} update(){} destroy(){}
        attach(container){
            if (container) this.container = container;
        }
        setRecords(records = []){
            this.records = records || [];
        }
        setBulkMode(enabled = false){
            this.bulkMode = enabled;
        }
        clear(){
            this.records = [];
        }
    };
}

class RecordViewer extends BaseComponent {
    constructor(stores) {
        // Task 101: stores容错处理
        const safeStores = stores || window.App?.stores || {
            records: { subscribe: () => (), getRecords: () => [], stats: {} },
            exams: { subscribe: () => () => {}, getExamById: () => null },
            app: { subscribe: () => () => {}, addError: () => {} }
        };

        // Task 91: 必须先调用super()
        super(safeStores, {
            container: document.getElementById('practice-view'),
            filterButtons: document.getElementById('record-type-filter-buttons'),
            bulkDeleteBtn: document.getElementById('bulk-delete-btn')
        });

        this._failed = false; // Task 82: 错误状态标记
        this._subscriptions = []; // 订阅管理

        // Task 97: 设置视图名称
        this.setViewName('practice');

        try {
            this.currentFilter = 'all';
            this.bulkDeleteMode = false;
            this.selectedRecords = new Set();

            // Safe Mode 跳过昂贵设置 (Task 77)
            this.isSafeMode = window.__SAFE_MODE__ === true;
            if (this.isSafeMode) {
                if (window.__DEBUG__) console.debug('[RecordViewer] Safe Mode: 跳过昂贵统计计算和实时更新');
                this.realTimeUpdatesEnabled = false;
                this.advancedStatsEnabled = false;
            } else {
                this.realTimeUpdatesEnabled = true;
                this.advancedStatsEnabled = true;
            }

            this.checkRequiredElements();
            this.initSubComponents();
            this.initBasicStats(); // Task 86: 初始化基本统计
        } catch (error) {
            this._failed = true;
            console.error('[RecordViewer] UI bootstrap failed:', error);
            if (window.ErrorService) {
                window.ErrorService.showWarning('练习记录界面初始化失败: ' + error.message);
            }
            this.cleanupSubscriptions();
        }
    }

    // Task 82: 清理订阅，防止错误风暴
    cleanupSubscriptions() {
        this._subscriptions.forEach(unsubscribe => {
            try {
                unsubscribe();
            } catch (e) {
                if (window.__DEBUG__) console.debug('[RecordViewer] Failed to cleanup subscription:', e);
            }
        });
        this._subscriptions = [];
    }

    // Task 86: 初始化基本统计
    initBasicStats() {
        // 确保DOM元素存在
        const statElements = ['total-practiced', 'avg-score', 'study-time', 'streak-days'];
        statElements.forEach(id => {
            if (!document.getElementById(id)) {
                const container = document.createElement('span');
                container.id = id;
                container.textContent = '0';
                container.style.cssText = 'font-size: 2em; font-weight: bold;';
                document.body.appendChild(container);
            }
        });

        // 计算并显示基本统计
        this.updateBasicStats();
    }

    // Task 86: 更新基本统计
    updateBasicStats() {
        try {
            const stats = this.calculateDefensiveStats();

            // 更新DOM显示，防御NaN
            const updateElement = (id, value) => {
                const element = document.getElementById(id);
                if (element) {
                    const safeValue = isNaN(value) ? 0 : Math.round(value);
                    element.textContent = safeValue;
                }
            };

            updateElement('total-practiced', stats.total);
            updateElement('avg-score', stats.avgScore);
            updateElement('study-time', stats.studyTime);
            updateElement('streak-days', stats.streakDays);
        } catch (error) {
            console.error('[RecordViewer] Failed to update basic stats:', error);
        }
    }

    // Task 86: 防御性统计计算
    calculateDefensiveStats() {
        let records = [];

        // 尝试从多个来源获取记录
        if (this.stores.records && this.stores.records.getRecords) {
            records = this.stores.records.getRecords() || [];
        } else if (window.storage) {
            try {
                const storedRecords = window.storage.get('practice_records') || [];
                records = Array.isArray(storedRecords) ? storedRecords : [];
            } catch (e) {
                if (window.__DEBUG__) console.debug('[RecordViewer] Failed to calculate stats:', e);
            }
        }

        // 防御性计算
        const total = records.length || 0;
        const validScores = records.filter(r => r.score && typeof r.score.percentage === 'number');
        const avgScore = validScores.length > 0
            ? validScores.reduce((sum, r) => sum + r.score.percentage, 0) / validScores.length
            : 0;
        const studyTime = records.reduce((sum, r) => sum + (r.duration || 0), 0) / 60; // 转换为分钟
        const streakDays = 1; // 简化计算

        return {
            total,
            avgScore,
            studyTime,
            streakDays
        };
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

    // Task 98: 使用基类的错误处理模式
    _doActualRender() {
        // Task 82: 错误防护 - 失败时短路
        if (this._failed) {
            if (window.__DEBUG__) console.debug('[RecordViewer] Skipping render due to failed initialization');
            return;
        }

        // Task 86: 数据兜底
        let records = [];
        if (this.stores.records && this.stores.records.getRecords) {
            const filters = this.currentFilter !== 'all' ? { type: this.currentFilter } : {};
            records = this.stores.records.getRecords(filters);
        } else {
            // 从localStorage兜底获取
            records = this.getRecordsFromStorage();
        }

        // Safe Mode下限制渲染数量
        const maxRecords = this.isSafeMode ? 50 : records.length;
        const displayRecords = records.slice(0, maxRecords);

        this.stats.render();
        this.recordList.setRecords(displayRecords);
        this.recordList.setBulkMode(this.bulkDeleteMode);
        if (this.bulkDeleteMode) this.updateBulkDeleteButton();
    }

    // Task 86: 从localStorage获取记录
    getRecordsFromStorage() {
        try {
            if (window.storage) {
                const storedRecords = window.storage.get('practice_records') || [];
                const filters = this.currentFilter !== 'all' ? { type: this.currentFilter } : {};
                return this.applyRecordFilters(storedRecords, filters);
            }
        } catch (e) {
            if (window.__DEBUG__) console.debug('[RecordViewer] Failed to load records from storage:', e);
        }
        return [];
    }

    // Task 86: 应用记录过滤器
    applyRecordFilters(records, filters) {
        if (!filters.type || filters.type === 'all') return records;
        return records.filter(record => record.type === filters.type);
    }

    // Task 86: 空状态渲染
    renderEmptyState() {
        if (this.elements.container) {
            this.elements.container.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: #666;">
                    <div style="font-size: 3em; margin-bottom: 20px;">📊</div>
                    <h3>暂无练习记录</h3>
                    <p>开始练习后，这里会显示你的练习统计和记录</p>
                </div>
            `;
        }
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

// Export and provide bootstrap helper for controlled initialization
window.RecordViewer = RecordViewer;

RecordViewer.bootstrap = function bootstrapRecordViewer(stores = null, options = {}) {
    const resolvedStores = stores || (window.stores || { records: {}, exams: {}, app: {} });
    const instance = new RecordViewer(resolvedStores);
    const container = options.container || document.getElementById('practice-view') || document.body;
    if (container) {
        instance.attach(container);
    }
    RecordViewer.instance = instance;
    window.RecordViewerInstance = instance;
    console.log('[RecordViewer] Controller initialized');
    return instance;
};
