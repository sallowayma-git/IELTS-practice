/**
 * 浏览状态管理器
 * 负责管理题库浏览的状态和过滤器
 */
class BrowseStateManager {
    constructor() {
        this.currentFilter = 'all';
        this.previousFilter = null;
        this.browseHistory = [];
        this.maxHistorySize = 10;
        
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
        this.restoreBrowseState();
        
        // 设置事件监听器
        this.setupEventListeners();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 监听导航按钮点击
        document.addEventListener('click', (event) => {
            const navBtn = event.target.closest('.nav-btn');
            if (navBtn && navBtn.textContent.includes('题库浏览')) {
                this.handleBrowseNavigation();
            }
        });

        // 监听分类浏览
        document.addEventListener('categoryBrowse', (event) => {
            this.setBrowseFilter(event.detail.category);
        });

        // 监听页面卸载，保存状态
        window.addEventListener('beforeunload', () => {
            this.saveBrowseState();
        });
    }

    /**
     * 处理浏览导航
     */
    handleBrowseNavigation() {
        console.log('[BrowseStateManager] 处理浏览导航，重置为显示所有考试');
        
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
        this.saveBrowseState();
        
        // 触发重置事件
        this.dispatchResetEvent();
    }

    /**
     * 更新浏览标题
     */
    updateBrowseTitle(filter) {
        const browseTitle = document.getElementById('browse-title');
        if (browseTitle) {
            if (filter === 'all') {
                browseTitle.textContent = '📚 题库浏览';
            } else {
                browseTitle.textContent = `📚 ${filter} 题库浏览`;
            }
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
     * 保存浏览状态
     */
    saveBrowseState() {
        const state = {
            currentFilter: this.currentFilter,
            previousFilter: this.previousFilter,
            browseHistory: this.browseHistory.slice(-this.maxHistorySize), // 只保存最近的历史
            timestamp: Date.now()
        };
        
        try {
            localStorage.setItem('browse_state', JSON.stringify(state));
            console.log('[BrowseStateManager] 浏览状态已保存');
        } catch (error) {
            console.error('[BrowseStateManager] 保存浏览状态失败:', error);
        }
    }

    /**
     * 恢复浏览状态
     */
    restoreBrowseState() {
        try {
            const savedState = localStorage.getItem('browse_state');
            if (savedState) {
                const state = JSON.parse(savedState);
                
                // 恢复过滤器状态（但不自动应用，等用户操作）
                this.previousFilter = state.previousFilter || null;
                this.browseHistory = state.browseHistory || [];
                
                // 默认重置为'all'，确保主界面浏览按钮总是显示所有考试
                this.currentFilter = 'all';
                
                console.log('[BrowseStateManager] 浏览状态已恢复');
            }
        } catch (error) {
            console.error('[BrowseStateManager] 恢复浏览状态失败:', error);
            // 使用默认状态
            this.currentFilter = 'all';
            this.previousFilter = null;
            this.browseHistory = [];
        }
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