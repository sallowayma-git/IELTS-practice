/**
 * 浏览状态管理器
 * 负责管理题库浏览的状态和过滤器，支持完整的状态持久化和回滚
 */
const BROWSE_STATE_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const BROWSE_STATE_MAX_TEXT_LENGTH = 120;
const BROWSE_STATE_MAX_SEARCH_LENGTH = 300;
const BROWSE_STATE_MAX_HISTORY_TEXT_LENGTH = 160;
const BROWSE_STATE_MAX_PAGE_SIZE = 200;
const BROWSE_STATE_VIEW_MODES = new Set(['grid', 'list']);
const BROWSE_STATE_SORT_FIELDS = new Set(['title', 'category', 'frequency', 'difficulty', 'date', 'score']);
const BROWSE_STATE_SORT_ORDERS = new Set(['asc', 'desc']);

function createDefaultBrowseState() {
    return {
        currentCategory: null,
        currentFrequency: null,
        viewMode: 'grid',
        sortBy: 'title',
        sortOrder: 'asc',
        filters: {
            frequency: 'all',
            status: 'all',
            difficulty: 'all'
        },
        searchQuery: '',
        pagination: {
            page: 1,
            pageSize: 20,
            total: 0
        }
    };
}

function isPlainBrowseObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function isUnsafeBrowseKey(key) {
    return BROWSE_STATE_POLLUTION_KEYS.has(String(key));
}

function safeBrowseEntries(value) {
    if (!isPlainBrowseObject(value)) {
        return [];
    }
    return Object.entries(value).filter(([key]) => !isUnsafeBrowseKey(key));
}

function normalizeBrowseText(value, maxLength = BROWSE_STATE_MAX_TEXT_LENGTH) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value)
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .trim()
        .slice(0, maxLength);
    return text || null;
}

function normalizeBrowseEnum(value, allowed, fallback) {
    const text = normalizeBrowseText(value, BROWSE_STATE_MAX_TEXT_LENGTH);
    return text && allowed.has(text) ? text : fallback;
}

function normalizeBrowseInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(Math.max(Math.trunc(number), min), max);
}

function cloneBrowseState(state) {
    return {
        currentCategory: state.currentCategory || null,
        currentFrequency: state.currentFrequency || null,
        viewMode: state.viewMode || 'grid',
        sortBy: state.sortBy || 'title',
        sortOrder: state.sortOrder || 'asc',
        filters: {
            frequency: state.filters?.frequency || 'all',
            status: state.filters?.status || 'all',
            difficulty: state.filters?.difficulty || 'all'
        },
        searchQuery: state.searchQuery || '',
        pagination: {
            page: state.pagination?.page || 1,
            pageSize: state.pagination?.pageSize || 20,
            total: state.pagination?.total || 0
        }
    };
}

function normalizeBrowseStatePatch(input) {
    if (!isPlainBrowseObject(input)) {
        return {};
    }
    const patch = {};
    for (const [key, value] of safeBrowseEntries(input)) {
        if (key === 'currentCategory') {
            patch.currentCategory = normalizeBrowseText(value);
        } else if (key === 'currentFrequency') {
            patch.currentFrequency = normalizeBrowseText(value);
        } else if (key === 'viewMode') {
            patch.viewMode = normalizeBrowseEnum(value, BROWSE_STATE_VIEW_MODES, undefined);
        } else if (key === 'sortBy') {
            patch.sortBy = normalizeBrowseEnum(value, BROWSE_STATE_SORT_FIELDS, undefined);
        } else if (key === 'sortOrder') {
            patch.sortOrder = normalizeBrowseEnum(value, BROWSE_STATE_SORT_ORDERS, undefined);
        } else if (key === 'searchQuery') {
            patch.searchQuery = normalizeBrowseText(value, BROWSE_STATE_MAX_SEARCH_LENGTH) || '';
        } else if (key === 'filters' && isPlainBrowseObject(value)) {
            patch.filters = {};
            for (const filterKey of ['frequency', 'status', 'difficulty']) {
                if (Object.prototype.hasOwnProperty.call(value, filterKey) && !isUnsafeBrowseKey(filterKey)) {
                    patch.filters[filterKey] = normalizeBrowseText(value[filterKey]) || 'all';
                }
            }
        } else if (key === 'pagination' && isPlainBrowseObject(value)) {
            patch.pagination = {};
            if (Object.prototype.hasOwnProperty.call(value, 'page')) {
                patch.pagination.page = normalizeBrowseInteger(value.page, 1, 1, Number.MAX_SAFE_INTEGER);
            }
            if (Object.prototype.hasOwnProperty.call(value, 'pageSize')) {
                patch.pagination.pageSize = normalizeBrowseInteger(value.pageSize, 20, 1, BROWSE_STATE_MAX_PAGE_SIZE);
            }
            if (Object.prototype.hasOwnProperty.call(value, 'total')) {
                patch.pagination.total = normalizeBrowseInteger(value.total, 0, 0, Number.MAX_SAFE_INTEGER);
            }
        }
    }
    return patch;
}

function mergeBrowseState(baseState, patchInput) {
    const base = cloneBrowseState(baseState || createDefaultBrowseState());
    const patch = normalizeBrowseStatePatch(patchInput);
    if (Object.prototype.hasOwnProperty.call(patch, 'currentCategory')) base.currentCategory = patch.currentCategory;
    if (Object.prototype.hasOwnProperty.call(patch, 'currentFrequency')) base.currentFrequency = patch.currentFrequency;
    if (patch.viewMode) base.viewMode = patch.viewMode;
    if (patch.sortBy) base.sortBy = patch.sortBy;
    if (patch.sortOrder) base.sortOrder = patch.sortOrder;
    if (Object.prototype.hasOwnProperty.call(patch, 'searchQuery')) base.searchQuery = patch.searchQuery;
    if (patch.filters) base.filters = { ...base.filters, ...patch.filters };
    if (patch.pagination) base.pagination = { ...base.pagination, ...patch.pagination };
    return base;
}

function normalizeBrowseHistoryItem(item) {
    if (!isPlainBrowseObject(item)) {
        return null;
    }
    const normalized = {};
    const allowedKeys = new Set(['action', 'filter', 'from', 'to', 'timestamp']);
    for (const [key, value] of safeBrowseEntries(item)) {
        if (!allowedKeys.has(key)) {
            continue;
        }
        if (key === 'timestamp') {
            normalized.timestamp = normalizeBrowseInteger(value, Date.now(), 0, Number.MAX_SAFE_INTEGER);
        } else {
            normalized[key] = normalizeBrowseText(value, BROWSE_STATE_MAX_HISTORY_TEXT_LENGTH);
        }
    }
    return normalized.action ? normalized : null;
}

function normalizeBrowseHistory(history, maxHistorySize) {
    if (!Array.isArray(history)) {
        return [];
    }
    return history
        .slice(-maxHistorySize)
        .map(normalizeBrowseHistoryItem)
        .filter(Boolean);
}

class BrowseStateManager {
    constructor() {
        this.currentFilter = 'all';
        this.previousFilter = null;
        this.browseHistory = [];
        this.maxHistorySize = 10;
        this.subscribers = [];
        this.state = createDefaultBrowseState();

        // 全局引用，供事件委托使用
        window.browseStateManager = this;
        
        // 绑定方法上下文
        this.handleBrowseNavigation = this.handleBrowseNavigation.bind(this);
        
        // 初始化
        this.initialize();
    }

    /**
     * 初始化浏览状态管理器
     */
    initialize() {
        console.log('[BrowseStateManager] 初始化浏览状态管理器');
        
        // 恢复保存的状态
        this.restorePersistentState();
        
        // 设置事件监听器
        this.setupEventListeners();
        
        // 初始化完成后通知订阅者
        this.notifySubscribers();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 使用事件委托替换独立监听器
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            // 监听导航按钮点击
            window.DOM.delegate('click', '.nav-btn', function(e) {
                if (this.textContent.includes('题库浏览')) {
                    window.browseStateManager.handleBrowseNavigation();
                }
            });

            console.log('[BrowseStateManager] 使用事件委托设置监听器');
        } else {
            // 降级到传统监听器
            document.addEventListener('click', (event) => {
                const navBtn = event.target.closest('.nav-btn');
                if (navBtn && navBtn.textContent.includes('题库浏览')) {
                    this.handleBrowseNavigation();
                }
            });
        }

        // 自定义事件和窗口事件监听（这些事件不能用DOM.delegate处理）
        document.addEventListener('categoryBrowse', (event) => {
            window.browseStateManager.setBrowseFilter(event.detail.category);
        });

        window.addEventListener('beforeunload', () => {
            window.browseStateManager.saveBrowseState();
        });
    }

    /**
     * 处理浏览导航
     */
    handleBrowseNavigation() {
        console.log('[BrowseStateManager] 处理浏览导航，重置为显示所有考试');

        if (typeof window.clearPendingBrowseAutoScroll === 'function') {
            try { window.clearPendingBrowseAutoScroll(); } catch (_) {}
        }

        // 重置到全部考试视图
        this.resetToAllExams();

        // 记录导航历史
        this.addToHistory({
            action: 'navigate_to_browse',
            filter: 'all',
            timestamp: Date.now()
        });
    }

    /**
     * 设置浏览过滤器
     */
    setBrowseFilter(filter) {
        const safeFilter = normalizeBrowseText(filter) || 'all';
        console.log(`[BrowseStateManager] 设置浏览过滤器: ${safeFilter}`);
        
        // 保存之前的过滤器
        this.previousFilter = normalizeBrowseText(this.currentFilter);
        
        // 设置新的过滤器
        this.currentFilter = safeFilter;
        
        // 更新全局变量（保持向后兼容）
        if (window.currentCategory !== undefined) {
            window.currentCategory = safeFilter;
        }
        
        // 更新状态
        this.setState({
            currentCategory: safeFilter === 'all' ? null : safeFilter
        });
        
        // 更新浏览标题
        this.updateBrowseTitle(safeFilter);
        
        // 记录状态变更
        this.addToHistory({
            action: 'filter_change',
            from: this.previousFilter,
            to: safeFilter,
            timestamp: Date.now()
        });
        
        // 保存状态
        this.saveBrowseState();
        
        // 触发过滤器变更事件
        this.dispatchFilterChangeEvent(safeFilter);
    }

    /**
     * 设置状态并通知订阅者
     */
    setState(newState) {
        // 保存历史状态
        this.browseHistory.push({
            action: 'state_change',
            previousState: cloneBrowseState(this.state),
            newState: normalizeBrowseStatePatch(newState),
            timestamp: Date.now()
        });
        
        if (this.browseHistory.length > this.maxHistorySize) {
            this.browseHistory.shift();
        }
        
        // 更新状态
        this.state = mergeBrowseState(this.state, newState);
        
        // 通知订阅者
        this.notifySubscribers();
        
        // 持久化状态
        this.persistState();
    }

    /**
     * 订阅状态变化
     */
    subscribe(callback) {
        this.subscribers.push(callback);
        
        // 返回取消订阅的方法
        return () => {
            const index = this.subscribers.indexOf(callback);
            if (index > -1) {
                this.subscribers.splice(index, 1);
            }
        };
    }

    /**
     * 通知所有订阅者
     */
    notifySubscribers() {
        this.subscribers.forEach(callback => {
            try {
                callback(this.state);
            } catch (error) {
                console.error('[BrowseStateManager] 订阅者回调错误:', error);
            }
        });
    }

    /**
     * 持久化状态
     */
    persistState() {
        try {
            const dataToSave = {
                currentFilter: normalizeBrowseText(this.currentFilter) || 'all',
                previousFilter: normalizeBrowseText(this.previousFilter),
                state: cloneBrowseState(this.state),
                browseHistory: normalizeBrowseHistory(this.browseHistory, this.maxHistorySize),
                timestamp: Date.now()
            };
            
            localStorage.setItem('browse_state', JSON.stringify(dataToSave));
            console.log('[BrowseStateManager] 状态已持久化');
        } catch (error) {
            console.error('[BrowseStateManager] 持久化状态失败:', error);
        }
    }

    /**
     * 恢复持久化的状态
     */
    restorePersistentState() {
        try {
            const savedData = localStorage.getItem('browse_state');
            if (savedData) {
                const data = JSON.parse(savedData);
                if (!isPlainBrowseObject(data)) {
                    throw new Error('Invalid browse state payload');
                }
                
                // 恢复基本状态
                this.previousFilter = normalizeBrowseText(data.previousFilter);
                this.browseHistory = normalizeBrowseHistory(data.browseHistory, this.maxHistorySize);
                
                // 恢复完整状态
                if (data.state) {
                    this.state = mergeBrowseState(this.state, data.state);
                }
                
                // 默认重置为'all'，确保主界面浏览按钮总是显示所有考试
                this.currentFilter = 'all';
                this.state.currentCategory = null;
                
                console.log('[BrowseStateManager] 持久化状态已恢复');
            }
        } catch (error) {
            console.error('[BrowseStateManager] 恢复持久化状态失败:', error);
            this.resetToDefaults();
        }
    }

    /**
     * 重置为默认状态
     */
    resetToDefaults() {
        this.currentFilter = 'all';
        this.previousFilter = null;
        this.browseHistory = [];
        this.state = createDefaultBrowseState();
    }

    /**
     * 获取当前状态
     */
    getState() {
        return cloneBrowseState(this.state);
    }

    /**
     * 重置到全部考试视图
     */
    resetToAllExams() {
        console.log('[BrowseStateManager] 重置到全部考试视图');
        
        // 保存之前的状态
        this.previousFilter = this.currentFilter;
        
        // 重置过滤器
        this.currentFilter = 'all';

        // 更新全局变量
        if (window.currentCategory !== undefined) {
            window.currentCategory = 'all';
        }

        if (typeof window.setBrowseFilterState === 'function') {
            try { window.setBrowseFilterState('all', 'all'); } catch (_) {}
        }

        // 更新状态
        this.setState({
            currentCategory: null,
            currentFrequency: null,
            searchQuery: '',
            pagination: {
                page: 1,
                pageSize: 20,
                total: 0
            }
        });
        
        // 更新浏览标题
        this.updateBrowseTitle('all');
        
        // 清除搜索状态
        this.clearSearchState();
        
        // 记录重置操作
        this.addToHistory({
            action: 'reset_to_all',
            from: this.previousFilter,
            timestamp: Date.now()
        });
        
        // 保存状态
        this.persistState();
        
        // 触发重置事件
        this.dispatchResetEvent();
    }

    /**
     * 更新浏览标题
     */
    updateBrowseTitle(filter) {
        const safeFilter = normalizeBrowseText(filter) || 'all';
        const label = safeFilter === 'all'
            ? '题库浏览'
            : `${safeFilter} 题库浏览`;
        if (typeof window.setBrowseTitle === 'function') {
            window.setBrowseTitle(label);
            return;
        }
        const browseTitle = document.getElementById('browse-title');
        if (browseTitle) {
            browseTitle.textContent = label;
        }
    }

    /**
     * 清除搜索状态
     */
    clearSearchState() {
        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.value = '';
        }
    }

    /**
     * 保存浏览状态（兼容性方法）
     */
    saveBrowseState() {
        this.persistState();
    }

    /**
     * 恢复浏览状态（兼容性方法）
     */
    restoreBrowseState() {
        this.restorePersistentState();
    }

    /**
     * 添加到历史记录
     */
    addToHistory(historyItem) {
        const normalized = normalizeBrowseHistoryItem(historyItem);
        if (!normalized) {
            return;
        }
        this.browseHistory.push(normalized);
        
        // 限制历史记录大小
        if (this.browseHistory.length > this.maxHistorySize) {
            this.browseHistory.shift();
        }
    }

    /**
     * 清除浏览历史
     */
    clearBrowseHistory() {
        this.browseHistory = [];
        this.saveBrowseState();
        console.log('[BrowseStateManager] 浏览历史已清除');
    }

    /**
     * 获取当前过滤器
     */
    getCurrentFilter() {
        return normalizeBrowseText(this.currentFilter) || 'all';
    }

    /**
     * 获取之前的过滤器
     */
    getPreviousFilter() {
        return normalizeBrowseText(this.previousFilter);
    }

    /**
     * 获取浏览历史
     */
    getBrowseHistory() {
        return normalizeBrowseHistory(this.browseHistory, this.maxHistorySize);
    }

    /**
     * 检查是否可以返回上一个状态
     */
    canGoBack() {
        return this.previousFilter !== null && this.previousFilter !== this.currentFilter;
    }

    /**
     * 返回上一个浏览状态
     */
    goBack() {
        if (this.canGoBack()) {
            const backToFilter = this.previousFilter;
            this.setBrowseFilter(backToFilter);
            
            console.log(`[BrowseStateManager] 返回到上一个状态: ${backToFilter}`);
            return true;
        }
        return false;
    }

    /**
     * 触发过滤器变更事件
     */
    dispatchFilterChangeEvent(filter) {
        const safeFilter = normalizeBrowseText(filter) || 'all';
        const event = new CustomEvent('browseFilterChanged', {
            detail: {
                filter: safeFilter,
                previousFilter: this.getPreviousFilter(),
                timestamp: Date.now()
            }
        });
        document.dispatchEvent(event);
    }

    /**
     * 触发重置事件
     */
    dispatchResetEvent() {
        const event = new CustomEvent('browseReset', {
            detail: {
                previousFilter: this.getPreviousFilter(),
                timestamp: Date.now()
            }
        });
        document.dispatchEvent(event);
    }

    /**
     * 获取浏览统计信息
     */
    getBrowseStats() {
        const filterCounts = {};
        this.browseHistory.forEach(item => {
            if (item.action === 'filter_change') {
                const key = normalizeBrowseText(item.to) || 'unknown';
                filterCounts[key] = (filterCounts[key] || 0) + 1;
            }
        });

        return {
            currentFilter: this.getCurrentFilter(),
            previousFilter: this.getPreviousFilter(),
            historySize: normalizeBrowseHistory(this.browseHistory, this.maxHistorySize).length,
            filterUsage: filterCounts,
            lastActivity: this.browseHistory.length > 0 ?
                normalizeBrowseInteger(this.browseHistory[this.browseHistory.length - 1].timestamp, 0, 0, Number.MAX_SAFE_INTEGER) : null
        };
    }

    /**
     * 重置浏览状态管理器
     */
    reset() {
        console.log('[BrowseStateManager] 重置浏览状态管理器');
        
        this.currentFilter = 'all';
        this.previousFilter = null;
        this.browseHistory = [];
        
        // 更新UI
        this.updateBrowseTitle('all');
        this.clearSearchState();
        
        // 更新全局变量
        if (window.currentCategory !== undefined) {
            window.currentCategory = 'all';
        }
        
        // 保存重置后的状态
        this.saveBrowseState();
        
        // 触发重置事件
        this.dispatchResetEvent();
    }

    /**
     * 导出浏览历史
     */
    exportBrowseHistory() {
        const exportData = {
            currentFilter: this.getCurrentFilter(),
            previousFilter: this.getPreviousFilter(),
            browseHistory: normalizeBrowseHistory(this.browseHistory, this.maxHistorySize),
            stats: this.getBrowseStats(),
            exportTime: new Date().toISOString()
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * 导入浏览历史
     */
    importBrowseHistory(importData) {
        try {
            const data = typeof importData === 'string' ? JSON.parse(importData) : importData;
            
            if (isPlainBrowseObject(data) && data.browseHistory && Array.isArray(data.browseHistory)) {
                this.browseHistory = normalizeBrowseHistory(data.browseHistory, this.maxHistorySize);
                this.saveBrowseState();
                
                console.log('[BrowseStateManager] 浏览历史导入成功');
                return true;
            } else {
                throw new Error('无效的导入数据格式');
            }
        } catch (error) {
            console.error('[BrowseStateManager] 导入浏览历史失败:', error);
            return false;
        }
    }
}

// 导出类
window.BrowseStateManager = BrowseStateManager;
