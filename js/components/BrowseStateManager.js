/**
 * 浏览状态管理器
 * 负责管理题库浏览的状态和过滤器，支持完整的状态持久化和回滚
 */
class BrowseStateManager {
    constructor() {
        this.currentFilter = 'all';
        this.previousFilter = null;
        this.browseHistory = [];
        this.maxHistorySize = 10;
        this.subscribers = [];
        this.state = {
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
        console.log(`[BrowseStateManager] 设置浏览过滤器: ${filter}`);
        
        // 保存之前的过滤器
        this.previousFilter = this.currentFilter;
        
        // 设置新的过滤器
        this.currentFilter = filter;
        
        // 更新全局变量（保持向后兼容）
        if (window.currentCategory !== undefined) {
            window.currentCategory = filter;
        }
        
        // 更新状态
        this.setState({
            currentCategory: filter === 'all' ? null : filter
        });
        
        // 更新浏览标题
        this.updateBrowseTitle(filter);
        
        // 记录状态变更
        this.addToHistory({
            action: 'filter_change',
            from: this.previousFilter,
            to: filter,
            timestamp: Date.now()
        });
        
        // 保存状态
        this.saveBrowseState();
        
        // 触发过滤器变更事件
        this.dispatchFilterChangeEvent(filter);
    }

    /**
     * 设置状态并通知订阅者
     */
    setState(newState) {
        // 保存历史状态
        this.browseHistory.push({
            action: 'state_change',
            previousState: JSON.parse(JSON.stringify(this.state)),
            newState: JSON.parse(JSON.stringify(newState)),
            timestamp: Date.now()
        });
        
        if (this.browseHistory.length > this.maxHistorySize) {
            this.browseHistory.shift();
        }
        
        // 更新状态
        this.state = { ...this.state, ...newState };
        
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
                currentFilter: this.currentFilter,
                previousFilter: this.previousFilter,
                state: this.state,
                browseHistory: this.browseHistory.slice(-this.maxHistorySize),
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
                
                // 恢复基本状态
                this.previousFilter = data.previousFilter || null;
                this.browseHistory = data.browseHistory || [];
                
                // 恢复完整状态
                if (data.state) {
                    this.state = { ...this.state, ...data.state };
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
        this.state = {
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

    /**
     * 获取当前状态
     */
    getState() {
        return { ...this.state };
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
        const label = filter === 'all'
            ? '题库浏览'
            : `${filter} 题库浏览`;
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
        this.browseHistory.push(historyItem);
        
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
        return this.currentFilter;
    }

    /**
     * 获取之前的过滤器
     */
    getPreviousFilter() {
        return this.previousFilter;
    }

    /**
     * 获取浏览历史
     */
    getBrowseHistory() {
        return [...this.browseHistory];
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
        const event = new CustomEvent('browseFilterChanged', {
            detail: {
                filter: filter,
                previousFilter: this.previousFilter,
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
                previousFilter: this.previousFilter,
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
                filterCounts[item.to] = (filterCounts[item.to] || 0) + 1;
            }
        });

        return {
            currentFilter: this.currentFilter,
            previousFilter: this.previousFilter,
            historySize: this.browseHistory.length,
            filterUsage: filterCounts,
            lastActivity: this.browseHistory.length > 0 ? 
                this.browseHistory[this.browseHistory.length - 1].timestamp : null
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
            currentFilter: this.currentFilter,
            previousFilter: this.previousFilter,
            browseHistory: this.browseHistory,
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
            
            if (data.browseHistory && Array.isArray(data.browseHistory)) {
                this.browseHistory = data.browseHistory.slice(-this.maxHistorySize);
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