/**
 * 统一事件管理器
 * 管理所有组件的事件监听器，避免重复绑定和内存泄漏
 */
class EventManager {
    constructor() {
        this.listeners = new Map();
        this.initialized = false;
        this.debounceTimers = new Map();
    }
    
    /**
     * 初始化事件管理器
     */
    initialize() {
        if (this.initialized) {
            console.warn('[EventManager] 已经初始化，跳过重复初始化');
            return;
        }
        
        console.log('[EventManager] 初始化事件管理器');
        
        // 清理旧的事件监听器
        this.cleanup();
        
        // 注册全局事件监听器
        this.registerGlobalListeners();
        this.registerSearchListeners();
        this.registerFilterListeners();
        this.registerViewListeners();
        this.registerNavigationListeners();
        
        this.initialized = true;
        console.log('[EventManager] 事件管理器初始化完成');
    }
    
    /**
     * 清理所有事件监听器
     */
    cleanup() {
        console.log('[EventManager] 清理事件监听器');
        
        // 移除所有已注册的事件监听器
        this.listeners.forEach((listenerData, key) => {
            const { element, event, handler } = listenerData;
            if (element && handler) {
                element.removeEventListener(event, handler);
            }
        });
        
        this.listeners.clear();
        
        // 清理防抖定时器
        this.debounceTimers.forEach(timer => clearTimeout(timer));
        this.debounceTimers.clear();
    }
    
    /**
     * 注册事件监听器
     */
    addEventListener(element, event, handler, options = {}) {
        if (!element || typeof handler !== 'function') {
            console.warn('[EventManager] 无效的事件监听器参数');
            return false;
        }
        
        const key = this.generateListenerKey(element, event);
        
        // 检查是否已经绑定过
        if (this.listeners.has(key)) {
            console.warn(`[EventManager] 事件监听器已存在: ${key}`);
            return false;
        }
        
        // 添加事件监听器
        element.addEventListener(event, handler, options);
        
        // 记录监听器信息
        this.listeners.set(key, {
            element,
            event,
            handler,
            options
        });
        
        return true;
    }
    
    /**
     * 移除事件监听器
     */
    removeEventListener(element, event) {
        const key = this.generateListenerKey(element, event);
        const listenerData = this.listeners.get(key);
        
        if (listenerData) {
            const { handler } = listenerData;
            element.removeEventListener(event, handler);
            this.listeners.delete(key);
            return true;
        }
        
        return false;
    }
    
    /**
     * 生成监听器唯一键
     */
    generateListenerKey(element, event) {
        const elementId = element.id || element.className || element.tagName;
        return `${elementId}-${event}`;
    }
    
    /**
     * 注册全局事件监听器
     */
    registerGlobalListeners() {
        // 窗口大小变化
        this.addEventListener(window, 'resize', this.throttle(() => {
            this.handleWindowResize();
        }, 250));
        
        // 页面可见性变化
        this.addEventListener(document, 'visibilitychange', () => {
            if (!document.hidden) {
                this.handlePageVisible();
            }
        });
        
        // 错误处理
        this.addEventListener(window, 'error', (event) => {
            this.handleGlobalError(event);
        });
        
        // 未处理的Promise错误
        this.addEventListener(window, 'unhandledrejection', (event) => {
            this.handleUnhandledRejection(event);
        });
    }
    
    /**
     * 注册搜索事件监听器
     */
    registerSearchListeners() {
        const searchInput = document.getElementById('exam-search-input');
        if (searchInput) {
            const handler = this.debounce((e) => {
                this.handleSearch(e.target.value);
            }, 300);
            
            this.addEventListener(searchInput, 'input', handler);
        }
        
        // 传统搜索框兼容
        const oldSearchInput = document.querySelector('.search-input');
        if (oldSearchInput && oldSearchInput !== searchInput) {
            const handler = this.debounce((e) => {
                this.handleSearch(e.target.value);
            }, 300);
            
            this.addEventListener(oldSearchInput, 'input', handler);
        }
    }
    
    /**
     * 注册筛选事件监听器
     */
    registerFilterListeners() {
        const filters = [
            'frequency-filter',
            'status-filter', 
            'difficulty-filter',
            'sort-filter'
        ];
        
        filters.forEach(filterId => {
            const element = document.getElementById(filterId);
            if (element) {
                const handler = (e) => {
                    this.handleFilterChange(filterId, e.target.value);
                };
                
                this.addEventListener(element, 'change', handler);
            }
        });
    }
    
    /**
     * 注册视图事件监听器
     */
    registerViewListeners() {
        // 视图切换按钮
        const viewControls = document.querySelector('.view-controls');
        if (viewControls) {
            const handler = (e) => {
                const viewBtn = e.target.closest('.view-btn');
                if (viewBtn) {
                    this.handleViewChange(viewBtn.dataset.view);
                }
            };
            
            this.addEventListener(viewControls, 'click', handler);
        }
        
        // 题目卡片点击（使用事件委托）
        const handler = (e) => {
            // 只在浏览视图激活时处理
            if (!document.getElementById('browse-view').classList.contains('active')) {
                return;
            }
            
            const examCard = e.target.closest('.exam-card');
            if (examCard && !e.target.closest('button')) {
                this.handleExamCardClick(examCard.dataset.examId);
                return;
            }

            // 题目操作按钮
            const actionBtn = e.target.closest('[data-exam-action]');
            if (actionBtn) {
                e.preventDefault();
                e.stopPropagation();
                this.handleExamAction(actionBtn.dataset.examAction, actionBtn.dataset.examId);
                return;
            }
        };
        
        this.addEventListener(document, 'click', handler);
    }
    
    /**
     * 注册导航事件监听器
     */
    registerNavigationListeners() {
        // 主导航按钮
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(btn => {
            const handler = (e) => {
                const text = btn.textContent;
                if (text.includes('题库浏览')) {
                    this.handleBrowseNavigation();
                } else if (text.includes('总览')) {
                    this.handleOverviewNavigation();
                } else if (text.includes('练习记录')) {
                    this.handlePracticeNavigation();
                } else if (text.includes('设置')) {
                    this.handleSettingsNavigation();
                }
            };
            
            this.addEventListener(btn, 'click', handler);
        });
        
        // 返回按钮
        const backButton = document.querySelector('.back-btn');
        if (backButton) {
            const handler = () => {
                this.handleBackNavigation();
            };
            
            this.addEventListener(backButton, 'click', handler);
        }
        
        // 键盘快捷键
        const keyboardHandler = (e) => {
            this.handleKeyboardShortcuts(e);
        };
        
        this.addEventListener(document, 'keydown', keyboardHandler);
    }
    
    /**
     * 事件处理方法
     */
    handleWindowResize() {
        console.log('[EventManager] 窗口大小变化');
        
        // 响应式调整
        if (window.innerWidth <= 768) {
            document.body.classList.add('mobile');
        } else {
            document.body.classList.remove('mobile');
        }
        
        // 通知其他组件
        this.dispatchCustomEvent('windowResized', {
            width: window.innerWidth,
            height: window.innerHeight
        });
    }
    
    handlePageVisible() {
        console.log('[EventManager] 页面变为可见');
        
        // 刷新数据
        if (window.app && window.app.refreshData) {
            window.app.refreshData();
        }
        
        this.dispatchCustomEvent('pageVisible');
    }
    
    handleGlobalError(event) {
        console.error('[EventManager] 全局错误:', event.error);
        
        if (window.handleError) {
            window.handleError(event.error, '全局错误');
        }
    }
    
    handleUnhandledRejection(event) {
        console.error('[EventManager] 未处理的Promise错误:', event.reason);
        
        if (window.handleError) {
            window.handleError(event.reason, 'Promise错误');
        }
    }
    
    handleSearch(query) {
        console.log(`[EventManager] 搜索: ${query}`);
        
        // 通知ExamBrowser组件
        if (window.app && window.app.components && window.app.components.examBrowser) {
            window.app.components.examBrowser.searchQuery = query.trim().toLowerCase();
            window.app.components.examBrowser.refreshExamList();
        }
        
        // 兼容旧的搜索函数
        if (window.searchExams) {
            window.searchExams(query);
        }
    }
    
    handleFilterChange(filterId, value) {
        console.log(`[EventManager] 筛选器变化: ${filterId} = ${value}`);
        
        // 通知ExamBrowser组件
        if (window.app && window.app.components && window.app.components.examBrowser) {
            const examBrowser = window.app.components.examBrowser;
            
            switch (filterId) {
                case 'frequency-filter':
                    examBrowser.filters.frequency = value;
                    break;
                case 'status-filter':
                    examBrowser.filters.status = value;
                    break;
                case 'difficulty-filter':
                    examBrowser.filters.difficulty = value;
                    break;
                case 'sort-filter':
                    const [sortBy, sortOrder] = value.split('-');
                    examBrowser.sortBy = sortBy;
                    examBrowser.sortOrder = sortOrder;
                    break;
            }
            
            examBrowser.refreshExamList();
        }
        
        this.dispatchCustomEvent('filterChanged', { filterId, value });
    }
    
    handleViewChange(viewMode) {
        console.log(`[EventManager] 视图变化: ${viewMode}`);
        
        // 通知ExamBrowser组件
        if (window.app && window.app.components && window.app.components.examBrowser) {
            window.app.components.examBrowser.setViewMode(viewMode);
        }
        
        this.dispatchCustomEvent('viewChanged', { viewMode });
    }
    
    handleExamCardClick(examId) {
        console.log(`[EventManager] 题目卡片点击: ${examId}`);
        
        // 通知ExamBrowser组件
        if (window.app && window.app.components && window.app.components.examBrowser) {
            window.app.components.examBrowser.showExamPreview(examId);
        }
        
        this.dispatchCustomEvent('examCardClicked', { examId });
    }
    
    handleExamAction(action, examId) {
        console.log(`[EventManager] 题目操作: ${action} - ${examId}`);
        
        // 通知ExamBrowser组件
        if (window.app && window.app.components && window.app.components.examBrowser) {
            window.app.components.examBrowser.handleExamAction(action, examId);
        }
        
        this.dispatchCustomEvent('examAction', { action, examId });
    }
    
    handleBrowseNavigation() {
        console.log('[EventManager] 浏览导航');
        
        // 通知BrowseStateManager
        if (window.app && window.app.components && window.app.components.browseStateManager) {
            window.app.components.browseStateManager.handleBrowseNavigation();
        }
        
        this.dispatchCustomEvent('browseNavigation');
    }
    
    handleOverviewNavigation() {
        console.log('[EventManager] 总览导航');
        this.dispatchCustomEvent('overviewNavigation');
    }
    
    handlePracticeNavigation() {
        console.log('[EventManager] 练习记录导航');
        this.dispatchCustomEvent('practiceNavigation');
    }
    
    handleSettingsNavigation() {
        console.log('[EventManager] 设置导航');
        this.dispatchCustomEvent('settingsNavigation');
    }
    
    handleBackNavigation() {
        console.log('[EventManager] 返回导航');
        
        if (window.showView) {
            window.showView('overview');
        }
        
        this.dispatchCustomEvent('backNavigation');
    }
    
    handleKeyboardShortcuts(e) {
        // 只在合适的时候处理快捷键
        if (e.target.matches('input, textarea, [contenteditable]')) {
            return;
        }
        
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case '1':
                    e.preventDefault();
                    if (window.showView) window.showView('overview');
                    break;
                case '2':
                    e.preventDefault();
                    if (window.showView) window.showView('browse');
                    break;
                case '3':
                    e.preventDefault();
                    if (window.showView) window.showView('practice');
                    break;
                case '4':
                    e.preventDefault();
                    if (window.showView) window.showView('settings');
                    break;
            }
        } else if (document.getElementById('browse-view').classList.contains('active')) {
            switch (e.key) {
                case 'g':
                    e.preventDefault();
                    this.handleViewChange('grid');
                    break;
                case 'l':
                    e.preventDefault();
                    this.handleViewChange('list');
                    break;
                case 'Escape':
                    if (window.app && window.app.components && window.app.components.examBrowser) {
                        window.app.components.examBrowser.closeExamPreview();
                    }
                    break;
            }
        }
    }
    
    /**
     * 发送自定义事件
     */
    dispatchCustomEvent(eventName, detail = {}) {
        const event = new CustomEvent(eventName, {
            detail: {
                ...detail,
                timestamp: Date.now(),
                source: 'EventManager'
            }
        });
        
        document.dispatchEvent(event);
    }
    
    /**
     * 防抖函数
     */
    debounce(func, wait) {
        return (...args) => {
            const key = func.toString();
            
            if (this.debounceTimers.has(key)) {
                clearTimeout(this.debounceTimers.get(key));
            }
            
            const timeout = setTimeout(() => {
                func.apply(this, args);
                this.debounceTimers.delete(key);
            }, wait);
            
            this.debounceTimers.set(key, timeout);
        };
    }
    
    /**
     * 节流函数
     */
    throttle(func, wait) {
        let lastTime = 0;
        
        return (...args) => {
            const now = Date.now();
            
            if (now - lastTime >= wait) {
                lastTime = now;
                func.apply(this, args);
            }
        };
    }
    
    /**
     * 销毁事件管理器
     */
    destroy() {
        console.log('[EventManager] 销毁事件管理器');
        
        this.cleanup();
        this.initialized = false;
    }
}

// 导出到全局
window.EventManager = EventManager;