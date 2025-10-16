/**
 * 练习历史查看组件
 * 提供历史记录列表、详细视图、筛选搜索和导出功能
 */
class PracticeHistory {
    constructor() {
        this.currentRecords = [];
        this.filteredRecords = [];
        this.selectedSet = new Set();
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

        // 性能优化：虚拟滚动器实例
        this.virtualScroller = null;

        // 兼容性修复：保存原始方法支持enhancer
        this._originalCreateRecordItem = this.createRecordItem.bind(this);

        this.dom = window.DOM || null;
        this.domCreate = this.dom && typeof this.dom.create === 'function'
            ? this.dom.create.bind(this.dom)
            : null;
        this.domReplace = this.dom && typeof this.dom.replaceContent === 'function'
            ? this.dom.replaceContent.bind(this.dom)
            : null;

        this.initialize();
    }

    createNode(tag, attrs = {}, children = []) {
        if (this.domCreate) {
            return this.domCreate(tag, attrs, children);
        }

        const element = document.createElement(tag);
        const { dataset, style, ...rest } = attrs || {};

        if (dataset && typeof dataset === 'object') {
            Object.assign(element.dataset, dataset);
        }

        if (style && typeof style === 'object') {
            Object.assign(element.style, style);
        }

        Object.entries(rest || {}).forEach(([key, value]) => {
            if (value == null) {
                return;
            }
            if (key === 'className') {
                element.className = value;
                return;
            }
            if (key === 'textContent') {
                element.textContent = value;
                return;
            }
            if (key === 'htmlFor') {
                element.htmlFor = value;
                return;
            }
            element.setAttribute(key, value);
        });

        this.appendChildren(element, children);

        return element;
    }

    appendChildren(element, children) {
        if (children == null) {
            return;
        }

        const list = Array.isArray(children) ? children : [children];
        list.forEach((child) => {
            if (child == null) {
                return;
            }
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
    }

    replaceContent(container, content) {
        if (!container) {
            return;
        }

        if (this.domReplace) {
            this.domReplace(container, content);
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        if (content == null) {
            return;
        }

        if (Array.isArray(content)) {
            content.forEach(node => {
                if (node instanceof Node) {
                    container.appendChild(node);
                }
            });
        } else if (content instanceof Node) {
            container.appendChild(content);
        }
    }

    createFragment(items) {
        const fragment = document.createDocumentFragment();
        items.forEach((item) => {
            if (item instanceof Node) {
                fragment.appendChild(item);
            }
        });
        return fragment;
    }

    parseHTMLToNode(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
        const wrapper = doc.body.firstElementChild;
        return wrapper ? wrapper.firstElementChild : null;
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
            // 批量选择复选框
            const checkbox = e.target.closest('input[type="checkbox"][data-record-id]');
            if (checkbox) {
                const recordId = checkbox.dataset.recordId;
                this.toggleSelection(recordId);
                return;
            }
            
            // 题目标题点击 - 显示详情
            const recordTitle = e.target.closest('.record-title');
            if (recordTitle) {
                const recordItem = recordTitle.closest('.history-record-item');
                if (recordItem) {
                    const recordId = recordItem.dataset.recordId;
                    this.showRecordDetails(recordId);
                    return;
                }
            }
            
            // 操作按钮点击
            const actionBtn = e.target.closest('[data-history-action]');
            if (actionBtn) {
                e.preventDefault();
                e.stopPropagation();
                const action = actionBtn.dataset.historyAction;
                const recordId = actionBtn.dataset.recordId;
                this.handleRecordAction(action, recordId);
                return;
            }
            
            // 分页按钮点击
            const pageBtn = e.target.closest('.page-btn');
            if (pageBtn && !pageBtn.classList.contains('disabled')) {
                const page = parseInt(pageBtn.dataset.page);
                this.goToPage(page);
                return;
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
                        <button class="btn btn-danger" id="bulk-delete-btn" onclick="window.app.components.practiceHistory.bulkDeleteSelected()" style="display: none;">
                            <span class="btn-icon">🗑️</span>
                            批量删除
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
        
        // 搜索输入事件 - 使用事件委托如果可用
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            const handleSearch = (e) => {
                const debounceFunc = (window.Utils && typeof window.Utils.debounce === 'function')
                    ? Utils.debounce
                    : this.debounce;
                debounceFunc(() => {
                    this.searchQuery = e.target.value.trim().toLowerCase();
                    this.applyFilters();
                }, 300)();
            };

            window.DOM.delegate('input', '#history-search', handleSearch);
            console.log('[PracticeHistory] 搜索输入使用事件委托');
        } else {
            // Fallback to direct event binding
            const searchInput = document.getElementById('history-search');
            if (searchInput) {
                const debounceFunc = (window.Utils && typeof window.Utils.debounce === 'function')
                    ? Utils.debounce
                    : this.debounce;
                searchInput.addEventListener('input', debounceFunc((e) => {
                    this.searchQuery = e.target.value.trim().toLowerCase();
                    this.applyFilters();
                }, 300));
            }
        }
        
        // 日期范围筛选器 - 使用事件委托如果可用
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            const handleDateRange = (e) => {
                const customDateRange = document.getElementById('custom-date-range');
                if (e.target.value === 'custom') {
                    if (typeof window.DOM !== 'undefined' && window.DOM.show) {
                        window.DOM.show(customDateRange);
                    } else {
                        customDateRange.style.display = 'block';
                    }
                } else {
                    if (typeof window.DOM !== 'undefined' && window.DOM.hide) {
                        window.DOM.hide(customDateRange);
                    } else {
                        customDateRange.style.display = 'none';
                    }
                }
            };

            window.DOM.delegate('change', '#date-range-filter', handleDateRange);
            console.log('[PracticeHistory] 日期筛选器使用事件委托');
        } else {
            // Fallback to direct event binding
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
            
            // 检查getPracticeRecords方法是否存在
            if (typeof practiceRecorder.getPracticeRecords !== 'function') {
                console.error('getPracticeRecords method not found on practiceRecorder');
                const fallback = await storage.get('practice_records', []);
                this.currentRecords = Array.isArray(fallback) ? fallback : [];
            } else {
                const maybe = practiceRecorder.getPracticeRecords();
                const resolved = typeof maybe?.then === 'function' ? await maybe : maybe;
                this.currentRecords = Array.isArray(resolved) ? resolved : [];
            }

            // 应用筛选和排序
            this.applyFilters();
            this.selectedSet.clear();
            this.updateBulkActions();
            
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
        this.selectedSet.clear();
        this.updateBulkActions();
        
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
        try {
            const totalPractices = this.filteredRecords.length;
            const avgAccuracy = totalPractices > 0 
                ? Math.round(this.filteredRecords.reduce((sum, r) => sum + r.accuracy, 0) / totalPractices * 100)
                : 0;
            const totalTime = this.filteredRecords.reduce((sum, r) => sum + r.duration, 0);
            
            document.getElementById('total-practices').textContent = totalPractices;
            document.getElementById('avg-accuracy').textContent = avgAccuracy + '%';
            
            // 防御性检查 Utils 对象是否存在
            console.log('[PracticeHistory] Utils对象检查:', {
                windowUtils: !!window.Utils,
                formatDurationExists: window.Utils && typeof window.Utils.formatDuration === 'function',
                totalTime: totalTime
            });
            
            const formattedTime = (window.Utils && typeof window.Utils.formatDuration === 'function') 
                ? Utils.formatDuration(totalTime)
                : this.formatDurationFallback(totalTime);
            document.getElementById('total-time').textContent = formattedTime;
            document.getElementById('filtered-count').textContent = totalPractices;
        } catch (error) {
            console.error('[PracticeHistory] updateHistoryStats错误:', error);
            // 使用备用方案
            document.getElementById('total-time').textContent = '计算中...';
        }
    }

    /**
     * 备用时间格式化函数
     */
    formatDurationFallback(seconds) {
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

    /**
     * 备用日期格式化函数
     */
    formatDateFallback(date, format = 'YYYY-MM-DD') {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');

        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }

    /**
     * 备用防抖函数
     */
    debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(this, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(this, args);
        };
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

        // 性能修复：智能选择渲染方式，保持enhancer兼容性
        if (window.performanceOptimizer && pageRecords.length > 10) {
            // 销毁现有虚拟滚动器
            if (this.virtualScroller) {
                this.virtualScroller.destroy();
                this.virtualScroller = null;
            }

            // 创建虚拟滚动器
            this.virtualScroller = window.performanceOptimizer.createVirtualScroller(
                historyList,
                pageRecords,
                (record, index) => {
                    // 检查是否有enhancer修改了createRecordItem
                    if (window.practiceHistoryEnhancer && this.createRecordItem !== this._originalCreateRecordItem) {
                        // 使用enhancer增强的HTML创建DOM
                        const html = this.createRecordItem(record);
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = html;
                        return tempDiv.firstElementChild;
                    } else {
                        // 使用优化的DOM创建
                        return this.createRecordElement(record, index);
                    }
                },
                {
                    itemHeight: 120,
                    bufferSize: 3,
                    containerHeight: 600
                }
            );
        } else {
            // 降级方案：使用DocumentFragment，保持enhancer兼容性
            const fragment = document.createDocumentFragment();

            if (window.practiceHistoryEnhancer && this.createRecordItem !== this._originalCreateRecordItem) {
                // 使用enhancer增强的HTML创建
                pageRecords.forEach(record => {
                    const html = this.createRecordItem(record);
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = html;
                    fragment.appendChild(tempDiv.firstElementChild);
                });
            } else {
                // 使用优化的DOM创建
                pageRecords.forEach(record => {
                    fragment.appendChild(this.createRecordElement(record));
                });
            }

            // 清空容器并添加新元素
            while (historyList.firstChild) {
                historyList.removeChild(historyList.firstChild);
            }
            historyList.appendChild(fragment);
        }
    }

    /**
     * 创建记录项HTML
     */
    createRecordItem(record) {
        const accuracy = Math.round(record.accuracy * 100);
        const duration = (window.Utils && typeof window.Utils.formatDuration === 'function')
            ? Utils.formatDuration(record.duration)
            : this.formatDurationFallback(record.duration);
        const startTime = (window.Utils && typeof window.Utils.formatDate === 'function')
            ? Utils.formatDate(record.startTime, 'YYYY-MM-DD HH:mm')
            : this.formatDateFallback(record.startTime, 'YYYY-MM-DD HH:mm');

        const accuracyClass = accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : 'needs-improvement';
        const statusClass = record.status === 'completed' ? 'completed' : 'interrupted';
        const recordIdStr = String(record.id);
        const isSelected = this.selectedSet.has(recordIdStr) ? 'checked' : '';
        const metadata = record.metadata || {};
        const examTitle = metadata.examTitle || record.examId;
        const categoryLabel = this.formatCategoryLabel(metadata.category);
        const frequencyLabel = this.formatFrequencyLabel(metadata.frequency);

        return `
            <div class="history-record-item" data-record-id="${recordIdStr}">
                <div class="record-main">
                    <div class="record-checkbox">
                        <input type="checkbox" data-record-id="${recordIdStr}" ${isSelected}>
                    </div>
                    <div class="record-status">
                        <div class="status-indicator ${statusClass}"></div>
                    </div>
                    <div class="record-content">
                        <h4 class="record-title clickable">${examTitle}</h4>
                        <div class="record-meta">
                            <span class="record-category">${categoryLabel}</span>
                            <span class="record-frequency">${frequencyLabel}</span>
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
                        <button class="btn btn-sm btn-primary" data-history-action="retry" data-record-id="${recordIdStr}">
                            重新练习
                        </button>
                        <button class="btn btn-sm btn-secondary" data-history-action="details" data-record-id="${recordIdStr}">
                            查看详情
                        </button>
                        <button class="btn btn-sm btn-outline" data-history-action="delete" data-record-id="${recordIdStr}">
                            删除
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 创建记录项DOM元素 - Performance optimized DOM creation
     */
    createRecordElement(record, index = null) {
        const accuracy = Math.round(record.accuracy * 100);
        const duration = (window.Utils && typeof window.Utils.formatDuration === 'function')
            ? Utils.formatDuration(record.duration)
            : this.formatDurationFallback(record.duration);
        const startTime = (window.Utils && typeof window.Utils.formatDate === 'function')
            ? Utils.formatDate(record.startTime, 'YYYY-MM-DD HH:mm')
            : this.formatDateFallback(record.startTime, 'YYYY-MM-DD HH:mm');

        const accuracyClass = accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : 'needs-improvement';
        const statusClass = record.status === 'completed' ? 'completed' : 'interrupted';
        const recordIdStr = String(record.id);
        const isSelected = this.selectedSet.has(recordIdStr);
        const metadata = record.metadata || {};
        const examTitle = metadata.examTitle || record.examId;
        const categoryLabel = this.formatCategoryLabel(metadata.category);
        const frequencyLabel = this.formatFrequencyLabel(metadata.frequency);

        // 创建文档片段提高性能
        const fragment = document.createDocumentFragment();

        // 主容器
        const recordItem = document.createElement('div');
        recordItem.className = 'history-record-item';
        recordItem.dataset.recordId = recordIdStr;

        // 记录主内容
        const recordMain = document.createElement('div');
        recordMain.className = 'record-main';

        // 复选框
        const checkboxDiv = document.createElement('div');
        checkboxDiv.className = 'record-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.recordId = recordIdStr;
        checkbox.checked = isSelected;
        checkboxDiv.appendChild(checkbox);

        // 状态指示器
        const statusDiv = document.createElement('div');
        statusDiv.className = 'record-status';
        const statusIndicator = document.createElement('div');
        statusIndicator.className = `status-indicator ${statusClass}`;
        statusDiv.appendChild(statusIndicator);

        // 内容区域
        const contentDiv = document.createElement('div');
        contentDiv.className = 'record-content';

        const title = document.createElement('h4');
        title.className = 'record-title clickable practice-record-title';
        title.textContent = examTitle;
        title.title = '点击查看详情';

        // 兼容性修复：保持与practiceHistoryEnhancer的兼容性
        title.addEventListener('click', () => {
            // 优先使用enhancer的详情显示
            if (window.practiceHistoryEnhancer && window.practiceHistoryEnhancer.showRecordDetails) {
                window.practiceHistoryEnhancer.showRecordDetails(record.id);
            } else {
                // 降级到内置的详情显示
                this.showRecordDetails(record.id);
            }
        });

        const meta = document.createElement('div');
        meta.className = 'record-meta';
        meta.innerHTML = `
            <span class="record-category">${categoryLabel}</span>
            <span class="record-frequency">${frequencyLabel}</span>
            <span class="record-time">${startTime}</span>
        `;

        contentDiv.appendChild(title);
        contentDiv.appendChild(meta);

        // 统计信息
        const statsDiv = document.createElement('div');
        statsDiv.className = 'record-stats';
        statsDiv.innerHTML = `
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
        `;

        // 操作按钮
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'record-actions';

        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-sm btn-primary';
        retryBtn.dataset.historyAction = 'retry';
        retryBtn.dataset.recordId = recordIdStr;
        retryBtn.textContent = '重新练习';

        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn btn-sm btn-secondary';
        detailsBtn.dataset.historyAction = 'details';
        detailsBtn.dataset.recordId = recordIdStr;
        detailsBtn.textContent = '查看详情';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-outline';
        deleteBtn.dataset.historyAction = 'delete';
        deleteBtn.dataset.recordId = recordIdStr;
        deleteBtn.textContent = '删除';

        actionsDiv.appendChild(retryBtn);
        actionsDiv.appendChild(detailsBtn);
        actionsDiv.appendChild(deleteBtn);

        // 组装元素
        recordMain.appendChild(checkboxDiv);
        recordMain.appendChild(statusDiv);
        recordMain.appendChild(contentDiv);
        recordMain.appendChild(statsDiv);
        recordMain.appendChild(actionsDiv);

        recordItem.appendChild(recordMain);

        return recordItem;
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
    async handleRecordAction(action, recordId) {
        const recordIdStr = String(recordId);
        const record = this.filteredRecords.find(r => String(r.id) === recordIdStr);
        if (!record) return;
        
        switch (action) {
            case 'retry':
                this.retryExam(record);
                break;
            case 'details':
                this.showRecordDetails(recordIdStr);
                break;
            case 'delete':
                await this.deleteRecord(recordIdStr);
                break;
            case 'bulkDelete':
                await this.bulkDeleteSelected();
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
     * 切换选择
     */
    toggleSelection(recordId) {
        const id = String(recordId);
        if (this.selectedSet.has(id)) {
            this.selectedSet.delete(id);
        } else {
            this.selectedSet.add(id);
        }
        this.updateBulkActions();
    }
    
    /**
     * 更新批量操作UI
     */
    updateBulkActions() {
        const btn = document.getElementById('bulk-delete-btn');
        if (btn) {
            btn.style.display = this.selectedSet.size > 0 ? 'inline-block' : 'none';
            btn.textContent = `批量删除 (${this.selectedSet.size})`;
        }
    }
    
    /**
     * 批量删除选中记录
     */
    async bulkDeleteSelected() {
        const selectedIds = new Set(Array.from(this.selectedSet, id => String(id)));
        if (selectedIds.size === 0) {
            window.showMessage('请先选择要删除的记录', 'warning');
            return;
        }
        if (!confirm(`确定要删除选中 ${selectedIds.size} 条记录吗？此操作不可撤销。`)) return;
        
        try {
            const store = window.storage;
            if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
                throw new Error('存储管理器未就绪');
            }

            const records = await store.get('practice_records', []);
            const kept = records.filter(r => !selectedIds.has(String(r?.id)));
            const deletedCount = records.length - kept.length;
            await store.set('practice_records', kept);

            this.currentRecords = this.currentRecords.filter(r => !selectedIds.has(String(r.id)));
            this.filteredRecords = this.filteredRecords.filter(r => !selectedIds.has(String(r.id)));
            this.selectedSet.clear();
            
            if (typeof this.refreshHistory === 'function') {
                this.refreshHistory();
            } else {
                this.renderHistoryList();
            }
            if (typeof window.syncPracticeRecords === 'function') {
                window.syncPracticeRecords();
            }
            window.showMessage(`已删除 ${deletedCount} 条记录`, 'success');
        } catch (error) {
            console.error('批量删除失败:', error);
            window.showMessage('批量删除失败', 'error');
        }
    }
    
    /**
     * 显示记录详情
     */
    showRecordDetails(recordId) {
        const recordIdStr = String(recordId);
        const record = this.filteredRecords.find(r => String(r.id) === recordIdStr);
        if (!record) return;
        
        const accuracy = Math.round(record.accuracy * 100);
        const duration = (window.Utils && typeof window.Utils.formatDuration === 'function')
            ? Utils.formatDuration(record.duration)
            : this.formatDurationFallback(record.duration);
        const startTime = (window.Utils && typeof window.Utils.formatDate === 'function')
            ? Utils.formatDate(record.startTime, 'YYYY-MM-DD HH:mm:ss')
            : this.formatDateFallback(record.startTime, 'YYYY-MM-DD HH:mm:ss');
        const endTime = (window.Utils && typeof window.Utils.formatDate === 'function')
            ? Utils.formatDate(record.endTime, 'YYYY-MM-DD HH:mm:ss')
            : this.formatDateFallback(record.endTime, 'YYYY-MM-DD HH:mm:ss');
        const metadata = record.metadata || {};
        const examTitle = metadata.examTitle || record.examId;
        const categoryLabel = this.formatCategoryLabel(metadata.category);
        const frequencyLabel = this.formatFrequencyLabel(metadata.frequency);

        // 生成答案详情表格
        const answersTableHtml = this.generateAnswersTable(record);

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
                                <span class="detail-value">${examTitle}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">分类：</span>
                                <span class="detail-value">${categoryLabel}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">频率：</span>
                                <span class="detail-value">${frequencyLabel}</span>
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
                    
                    ${answersTableHtml}
                    
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
                        <button class="btn btn-secondary" onclick="window.app.components.practiceHistory.exportRecordAsMarkdown('${record.id}')">
                            📄 导出Markdown
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
     * 生成答案详情表格
     */
    generateAnswersTable(record) {
        const suiteEntries = this.getSuiteEntries(record);
        if (suiteEntries.length > 0) {
            const sections = suiteEntries.map((entry, index) => {
                const title = this.formatSuiteEntryTitle(entry, index);
                const sectionContent = this.generateAnswersTableForEntry(entry, { wrapWithSection: false });
                return `
                    <section class="suite-entry">
                        <h5>${title}</h5>
                        ${sectionContent}
                    </section>
                `;
            }).join('');

            const content = sections || `
                <div class="no-answers-message">
                    <p>暂无答案详情数据</p>
                </div>
            `;

            return `
                <div class="details-section answers-section">
                    <h4>答案详情</h4>
                    ${content}
                </div>
            `;
        }

        return this.generateAnswersTableForEntry(record, { wrapWithSection: true });
    }

    generateAnswersTableForEntry(entry, options = {}) {
        const { wrapWithSection = true } = options;
        const wrapStart = wrapWithSection ? '<div class="details-section answers-section">' : '';
        const wrapEnd = wrapWithSection ? '</div>' : '';
        const heading = wrapWithSection ? '<h4>答案详情</h4>' : '';
        const renderEmpty = () => wrapWithSection
            ? `${wrapStart}${heading}<div class="no-answers-message"><p>暂无答案详情数据</p></div>${wrapEnd}`
            : '<div class="no-answers-message"><p>暂无答案详情数据</p></div>';

        if (!entry) {
            return renderEmpty();
        }

        if (entry.answerComparison && Object.keys(entry.answerComparison).length > 0) {
            const merged = this.mergeComparisonWithCorrections(entry);
            const tableHtml = this.generateTableFromComparison(merged);
            return wrapWithSection ? `${wrapStart}${heading}${tableHtml}${wrapEnd}` : tableHtml;
        }

        const answersSource = entry.answers || entry.realData?.answers || {};
        const correctAnswers = this.getCorrectAnswers(entry);
        const questionNumbers = this.extractQuestionNumbers(answersSource, correctAnswers);

        if (questionNumbers.length === 0) {
            return wrapWithSection
                ? `${wrapStart}${heading}<p class="no-details">暂无答题数据</p>${wrapEnd}`
                : '<p class="no-details">暂无答题数据</p>';
        }

        const answersData = this.collectAnswersData(entry);
        if (answersData.length === 0) {
            return renderEmpty();
        }

        const tableRows = answersData.map((answer, index) => {
            const correctIcon = answer.isCorrect === true ? '✓'
                : answer.isCorrect === false ? '✗'
                : '-';
            const correctClass = answer.isCorrect === true ? 'correct'
                : answer.isCorrect === false ? 'incorrect'
                : 'unknown';

            return `
                <tr class="answer-row ${correctClass}">
                    <td class="question-number">${index + 1}</td>
                    <td class="correct-answer">${this.formatAnswer(answer.correctAnswer)}</td>
                    <td class="user-answer">${this.formatAnswer(answer.userAnswer)}</td>
                    <td class="result-icon ${correctClass}">${correctIcon}</td>
                </tr>
            `;
        }).join('');

        const totalQuestions = answersData.length;
        const correctCount = answersData.filter(a => a.isCorrect === true).length;
        const incorrectCount = answersData.filter(a => a.isCorrect === false).length;
        const unknownCount = answersData.filter(a => a.isCorrect === null).length;

        const summary = `
            <div class="answers-summary">
                <span class="summary-item">总题数：${totalQuestions}</span>
                ${correctCount > 0 ? `<span class="summary-item correct">正确：${correctCount}</span>` : ''}
                ${incorrectCount > 0 ? `<span class="summary-item incorrect">错误：${incorrectCount}</span>` : ''}
                ${unknownCount > 0 ? `<span class="summary-item unknown">无法判断：${unknownCount}</span>` : ''}
            </div>
        `;

        const table = `
            <div class="answers-table-container">
                <table class="answers-table">
                    <thead>
                        <tr>
                            <th class="col-number">序号</th>
                            <th class="col-correct">正确答案</th>
                            <th class="col-user">我的答案</th>
                            <th class="col-result">对错</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        `;

        const content = `${summary}${table}`;

        return wrapWithSection ? `${wrapStart}${heading}${content}${wrapEnd}` : content;
    }

    collectAnswersData(record) {
        if (!record) {
            return [];
        }

        const detailsSource = record.scoreInfo?.details
            || record.realData?.scoreInfo?.details
            || null;

        let answersData = [];

        if (detailsSource && Object.keys(detailsSource).length > 0) {
            answersData = Object.entries(detailsSource).map(([questionId, detail]) => ({
                questionId,
                userAnswer: detail?.userAnswer ?? '-',
                correctAnswer: detail?.correctAnswer ?? '-',
                isCorrect: typeof detail?.isCorrect === 'boolean' ? detail.isCorrect : null
            }));
        } else {
            const answersSource = record.answers || record.realData?.answers || {};
            answersData = Object.entries(answersSource).map(([questionId, userAnswer]) => ({
                questionId,
                userAnswer: userAnswer || '-',
                correctAnswer: '-',
                isCorrect: null
            }));
        }

        return answersData.sort((a, b) => {
            const aNum = parseInt(String(a.questionId).replace(/\D/g, ''), 10) || 0;
            const bNum = parseInt(String(b.questionId).replace(/\D/g, ''), 10) || 0;
            return aNum - bNum;
        });
    }

    getSuiteEntries(record) {
        if (!record || !Array.isArray(record.suiteEntries)) {
            return [];
        }
        return record.suiteEntries.filter(entry => entry);
    }

    formatSuiteEntryTitle(entry, index) {
        if (!entry) {
            return `套题第${index + 1}篇`;
        }
        const metadata = entry.metadata || {};
        return metadata.examTitle
            || entry.title
            || entry.examTitle
            || `套题第${index + 1}篇`;
    }

    formatCategoryLabel(category) {
        if (category == null) {
            return 'Unknown';
        }
        if (typeof category === 'string') {
            const trimmed = category.trim();
            return trimmed.length > 0 ? trimmed : 'Unknown';
        }
        return String(category);
    }

    formatFrequencyLabel(frequency) {
        const normalized = typeof frequency === 'string'
            ? frequency.toLowerCase()
            : '';

        if (normalized === 'suite') {
            return '套题';
        }
        if (normalized === 'high') {
            return '高频';
        }

        return '次高频';
    }

    extractQuestionNumbers(userAnswers, correctAnswers) {
        const questions = new Set();

        Object.keys(userAnswers || {}).forEach(key => {
            const num = this.extractNumberFromKey(key);
            if (num != null) {
                questions.add(num);
            }
        });

        Object.keys(correctAnswers || {}).forEach(key => {
            const num = this.extractNumberFromKey(key);
            if (num != null) {
                questions.add(num);
            }
        });

        return Array.from(questions).sort((a, b) => a - b);
    }

    extractNumberFromKey(key) {
        if (!key) {
            return null;
        }
        const match = String(key).match(/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }
    
    /**
     * 格式化答案显示
     */
    formatAnswer(answer) {
        if (!answer || answer === null || answer === undefined) {
            return '-';
        }
        
        // 处理布尔值
        if (typeof answer === 'boolean') {
            return answer ? 'True' : 'False';
        }
        
        // 处理字符串
        const answerStr = String(answer).trim();
        
        // 如果答案太长，截断并显示省略号
        if (answerStr.length > 50) {
            return answerStr.substring(0, 47) + '...';
        }
        
        return answerStr || '-';
    }
    async deleteRecord(recordId) {
        if (!confirm('确定要删除这条练习记录吗？此操作不可撤销。')) {
            return;
        }

        try {
            // 从存储中删除记录
            const allRecords = await storage.get('practice_records', []);
            const list = Array.isArray(allRecords) ? allRecords : [];
            const updatedRecords = list.filter(r => r.id !== recordId);
            await storage.set('practice_records', updatedRecords);

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
     * 生成Markdown格式的练习记录导出
     * @param {Object} record - 练习记录对象
     * @returns {string} Markdown格式的文本
     */
    generateMarkdownExport(record) {
        const metadata = record.metadata || {};
        const examTitle = metadata.examTitle || record.examId || '未知题目';
        const category = this.formatCategoryLabel(metadata.category);
        const suiteEntries = this.getSuiteEntries(record);
        const score = this.getScoreFraction(record);

        if (suiteEntries.length > 0) {
            const scoreSuffix = score ? ` ${score}` : '';
            let markdown = `## ${category} 套题 ${examTitle}${scoreSuffix}\n\n`;

            suiteEntries.forEach((entry, index) => {
                const entryTitle = this.formatSuiteEntryTitle(entry, index);
                const entryScore = this.getScoreFraction(entry);
                const scoreSuffix = entryScore ? ` ${entryScore}` : '';
                markdown += `### ${entryTitle}${scoreSuffix}\n\n`;
                markdown += this.generateMarkdownTableForEntry(entry);
                markdown += '\n';
            });

            return markdown.trimEnd();
        }

        const frequency = this.formatFrequencyLabel(metadata.frequency);
        const scoreSuffix = score ? ` ${score}` : '';
        let markdown = `## ${category} ${frequency} ${examTitle}${scoreSuffix}\n\n`;
        markdown += this.generateMarkdownTableForEntry(record);

        return markdown.trimEnd();
    }

    generateMarkdownTableForEntry(entry) {
        const answersData = this.collectAnswersData(entry);

        if (answersData.length === 0) {
            return '暂无答案详情\n';
        }

        let markdown = '';
        markdown += `| 序号  | 正确答案              | 我的答案              | 对错  | 错误分析 |\n`;
        markdown += `| --- | ----------------- | ----------------- | --- | ---- |\n`;

        answersData.forEach((answer, index) => {
            const questionId = answer.questionId
                ? String(answer.questionId).toUpperCase()
                : `Q${index + 1}`;
            const correctAnswer = (answer.correctAnswer || '').toString();
            const userAnswer = (answer.userAnswer || '').toString();
            const resultIcon = answer.isCorrect === true ? '✅'
                : answer.isCorrect === false ? '❌'
                : '❓';

            const formattedCorrect = correctAnswer.padEnd(17, ' ');
            const formattedUser = userAnswer.padEnd(17, ' ');

            markdown += `| ${questionId} | ${formattedCorrect} | ${formattedUser} | ${resultIcon}   |      |\n`;
        });

        return markdown;
    }

    getScoreFraction(record) {
        if (!record) {
            return '';
        }

        const correct = typeof record.correctAnswers === 'number'
            ? record.correctAnswers
            : typeof record.score === 'number'
                ? record.score
                : typeof record.scoreInfo?.correct === 'number'
                    ? record.scoreInfo.correct
                    : typeof record.realData?.scoreInfo?.correct === 'number'
                        ? record.realData.scoreInfo.correct
                        : null;

        const total = typeof record.totalQuestions === 'number'
            ? record.totalQuestions
            : typeof record.scoreInfo?.total === 'number'
                ? record.scoreInfo.total
                : typeof record.realData?.scoreInfo?.total === 'number'
                    ? record.realData.scoreInfo.total
                    : record.answers
                        ? Object.keys(record.answers).length
                        : record.realData?.answers
                            ? Object.keys(record.realData.answers).length
                            : null;

        if (correct == null || total == null) {
            return '';
        }

        return `${correct}/${total}`;
    }

    getCorrectAnswers(record) {
        if (!record) {
            return {};
        }

        if (record.correctAnswers && Object.keys(record.correctAnswers).length > 0) {
            return record.correctAnswers;
        }

        if (record.realData?.correctAnswers && Object.keys(record.realData.correctAnswers).length > 0) {
            return record.realData.correctAnswers;
        }

        if (record.answerComparison) {
            const answers = {};
            Object.keys(record.answerComparison).forEach(key => {
                const item = record.answerComparison[key];
                if (item && item.correctAnswer) {
                    answers[key] = item.correctAnswer;
                }
            });
            if (Object.keys(answers).length > 0) {
                return answers;
            }
        }

        const detailSources = [];
        if (record.realData?.scoreInfo?.details) {
            detailSources.push(record.realData.scoreInfo.details);
        }
        if (record.scoreInfo?.details) {
            detailSources.push(record.scoreInfo.details);
        }

        for (const details of detailSources) {
            const answers = {};
            Object.keys(details || {}).forEach(key => {
                const detail = details[key];
                if (detail && detail.correctAnswer != null && String(detail.correctAnswer).trim() !== '') {
                    answers[key] = detail.correctAnswer;
                }
            });
            if (Object.keys(answers).length > 0) {
                return answers;
            }
        }

        return {};
    }

    /**
     * 导出单个记录为Markdown文件
     * @param {string} recordId - 记录ID
     */
    exportRecordAsMarkdown(recordId) {
        const record = this.filteredRecords.find(r => r.id === recordId);
        if (!record) {
            window.showMessage('记录不存在', 'error');
            return;
        }

        try {
            const markdown = this.generateMarkdownExport(record);
            const examTitle = record.metadata.examTitle || record.examId;
            const fileName = `${examTitle}-练习记录-${new Date().toISOString().split('T')[0]}.md`;

            // 下载文件
            const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            window.showMessage('Markdown文件已导出', 'success');
        } catch (error) {
            console.error('Markdown导出失败:', error);
            window.showMessage('导出失败，请重试', 'error');
        }
    }

    /**
     * 批量导出多个记录为Markdown文件
     * @param {Array} recordIds - 记录ID数组
     */
    exportMultipleRecords(recordIds) {
        if (!recordIds || recordIds.length === 0) {
            window.showMessage('请选择要导出的记录', 'warning');
            return;
        }

        try {
            let combinedMarkdown = `# IELTS练习记录导出\n\n`;
            combinedMarkdown += `导出时间: ${new Date().toLocaleString()}\n\n`;
            
            recordIds.forEach(recordId => {
                const record = this.filteredRecords.find(r => r.id === recordId);
                if (record) {
                    combinedMarkdown += this.generateMarkdownExport(record) + '\n\n---\n\n';
                }
            });

            const fileName = `IELTS练习记录批量导出-${new Date().toISOString().split('T')[0]}.md`;

            // 下载文件
            const blob = new Blob([combinedMarkdown], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            window.showMessage(`已导出${recordIds.length}条记录`, 'success');
        } catch (error) {
            console.error('批量导出失败:', error);
            window.showMessage('批量导出失败，请重试', 'error');
        }
    }

    /**
     * 销毁组件
     */
    destroy() {
        console.log('PracticeHistory component destroyed');

        // 性能优化：虚拟滚动器清理
        if (this.virtualScroller) {
            this.virtualScroller.destroy();
            this.virtualScroller = null;
        }

        // 清理事件监听器
        this.selectedSet.clear();
    }
}

// 确保全局可用
window.PracticeHistory = PracticeHistory;
