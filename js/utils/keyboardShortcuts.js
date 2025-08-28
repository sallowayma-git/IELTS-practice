/**
 * 键盘快捷键管理器
 * 提供全局键盘快捷键支持和无障碍访问功能
 */
class KeyboardShortcuts {
    constructor() {
        this.shortcuts = new Map();
        this.isEnabled = true;
        this.modalStack = [];
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.registerDefaultShortcuts();
        this.setupAccessibilityFeatures();
        this.createShortcutsHelp();
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('keyup', this.handleKeyUp.bind(this));
        
        // 监听模态框打开/关闭
        document.addEventListener('modalOpened', (e) => {
            this.modalStack.push(e.detail.modalId);
        });
        
        document.addEventListener('modalClosed', (e) => {
            const index = this.modalStack.indexOf(e.detail.modalId);
            if (index > -1) {
                this.modalStack.splice(index, 1);
            }
        });
    }
    
    /**
     * 处理按键按下
     */
    handleKeyDown(e) {
        if (!this.isEnabled) return;
        
        // 检查是否在输入框中
        if (this.isInInputField(e.target)) {
            this.handleInputFieldShortcuts(e);
            return;
        }
        
        // 生成快捷键字符串
        const shortcutKey = this.generateShortcutKey(e);
        
        // 查找并执行快捷键
        if (this.shortcuts.has(shortcutKey)) {
            const shortcut = this.shortcuts.get(shortcutKey);
            
            // 检查上下文
            if (this.isShortcutAvailable(shortcut)) {
                e.preventDefault();
                shortcut.handler(e);
                
                // 显示快捷键提示
                this.showShortcutFeedback(shortcut.description);
            }
        }
        
        // 处理特殊按键
        this.handleSpecialKeys(e);
    }
    
    /**
     * 处理按键释放
     */
    handleKeyUp(e) {
        // 处理长按释放等特殊情况
    }
    
    /**
     * 生成快捷键字符串
     */
    generateShortcutKey(e) {
        const parts = [];
        
        if (e.ctrlKey || e.metaKey) parts.push('ctrl');
        if (e.altKey) parts.push('alt');
        if (e.shiftKey) parts.push('shift');
        
        // 添加主键
        const key = e.key.toLowerCase();
        parts.push(key);
        
        return parts.join('+');
    }
    
    /**
     * 检查是否在输入框中
     */
    isInInputField(element) {
        const inputTypes = ['input', 'textarea', 'select'];
        return inputTypes.includes(element.tagName.toLowerCase()) ||
               element.contentEditable === 'true';
    }
    
    /**
     * 处理输入框快捷键
     */
    handleInputFieldShortcuts(e) {
        const shortcutKey = this.generateShortcutKey(e);
        
        // 输入框专用快捷键
        const inputShortcuts = {
            'ctrl+a': () => {
                // 全选（浏览器默认行为）
            },
            'ctrl+z': () => {
                // 撤销（浏览器默认行为）
            },
            'ctrl+y': () => {
                // 重做（浏览器默认行为）
            },
            'escape': () => {
                e.target.blur();
                this.showShortcutFeedback('已退出输入框');
            }
        };
        
        if (inputShortcuts[shortcutKey]) {
            inputShortcuts[shortcutKey]();
        }
    }
    
    /**
     * 检查快捷键是否可用
     */
    isShortcutAvailable(shortcut) {
        // 检查模态框上下文
        if (this.modalStack.length > 0 && !shortcut.availableInModal) {
            return false;
        }
        
        // 检查视图上下文
        if (shortcut.context) {
            const currentView = document.querySelector('.view.active');
            if (currentView && !currentView.id.includes(shortcut.context)) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * 注册默认快捷键
     */
    registerDefaultShortcuts() {
        // 导航快捷键
        this.register('ctrl+1', {
            description: '切换到总览页面',
            handler: () => window.app?.navigateToView('overview'),
            category: 'navigation'
        });
        
        this.register('ctrl+2', {
            description: '切换到专项练习',
            handler: () => window.app?.navigateToView('specialized-practice'),
            category: 'navigation'
        });
        
        this.register('ctrl+3', {
            description: '切换到练习记录',
            handler: () => window.app?.navigateToView('practice'),
            category: 'navigation'
        });
        
        this.register('ctrl+4', {
            description: '切换到成绩分析',
            handler: () => window.app?.navigateToView('analysis'),
            category: 'navigation'
        });
        
        this.register('ctrl+5', {
            description: '切换到学习目标',
            handler: () => window.app?.navigateToView('goals'),
            category: 'navigation'
        });
        
        // 功能快捷键
        this.register('ctrl+f', {
            description: '打开搜索',
            handler: () => this.openSearch(),
            category: 'function'
        });
        
        this.register('ctrl+r', {
            description: '刷新数据',
            handler: (e) => {
                e.preventDefault();
                this.refreshCurrentView();
            },
            category: 'function'
        });
        
        this.register('ctrl+h', {
            description: '显示帮助',
            handler: () => this.showHelp(),
            category: 'help',
            availableInModal: true
        });
        
        // 模态框快捷键
        this.register('escape', {
            description: '关闭模态框',
            handler: () => this.closeTopModal(),
            category: 'modal',
            availableInModal: true
        });
        
        // 无障碍快捷键
        this.register('alt+1', {
            description: '跳转到主要内容',
            handler: () => this.skipToMainContent(),
            category: 'accessibility'
        });
        
        this.register('alt+2', {
            description: '跳转到导航',
            handler: () => this.skipToNavigation(),
            category: 'accessibility'
        });
        
        // 快速操作
        this.register('ctrl+n', {
            description: '开始新练习',
            handler: () => this.startQuickPractice(),
            category: 'quick-action'
        });
        
        this.register('ctrl+shift+s', {
            description: '打开设置',
            handler: () => this.openSettings(),
            category: 'quick-action'
        });
        
        // 开发者快捷键（仅在开发模式下）
        if (this.isDevelopmentMode()) {
            this.register('ctrl+shift+d', {
                description: '开发者工具',
                handler: () => this.openDeveloperTools(),
                category: 'developer'
            });
        }
    }
    
    /**
     * 注册快捷键
     */
    register(key, options) {
        this.shortcuts.set(key, {
            key,
            description: options.description || '',
            handler: options.handler,
            category: options.category || 'general',
            context: options.context,
            availableInModal: options.availableInModal || false
        });
    }
    
    /**
     * 注销快捷键
     */
    unregister(key) {
        this.shortcuts.delete(key);
    }
    
    /**
     * 处理特殊按键
     */
    handleSpecialKeys(e) {
        switch (e.key) {
            case 'Tab':
                this.handleTabNavigation(e);
                break;
            case 'Enter':
                this.handleEnterKey(e);
                break;
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
                this.handleArrowKeys(e);
                break;
        }
    }
    
    /**
     * 处理Tab导航
     */
    handleTabNavigation(e) {
        // 确保焦点在可见元素上
        const focusableElements = this.getFocusableElements();
        const currentIndex = focusableElements.indexOf(document.activeElement);
        
        if (currentIndex === -1) return;
        
        let nextIndex;
        if (e.shiftKey) {
            // Shift+Tab 向前
            nextIndex = currentIndex === 0 ? focusableElements.length - 1 : currentIndex - 1;
        } else {
            // Tab 向后
            nextIndex = currentIndex === focusableElements.length - 1 ? 0 : currentIndex + 1;
        }
        
        const nextElement = focusableElements[nextIndex];
        if (nextElement && this.isElementVisible(nextElement)) {
            nextElement.focus();
            e.preventDefault();
        }
    }
    
    /**
     * 处理回车键
     */
    handleEnterKey(e) {
        const activeElement = document.activeElement;
        
        // 如果焦点在按钮上，触发点击
        if (activeElement.tagName === 'BUTTON' && !activeElement.disabled) {
            activeElement.click();
            e.preventDefault();
        }
        
        // 如果焦点在卡片上，触发默认操作
        if (activeElement.classList.contains('exam-card') || 
            activeElement.classList.contains('category-card')) {
            const defaultBtn = activeElement.querySelector('.btn-primary');
            if (defaultBtn) {
                defaultBtn.click();
                e.preventDefault();
            }
        }
    }
    
    /**
     * 处理方向键
     */
    handleArrowKeys(e) {
        const activeElement = document.activeElement;
        
        // 在网格中导航
        if (activeElement.closest('.category-grid, .exam-grid')) {
            this.handleGridNavigation(e, activeElement);
        }
        
        // 在列表中导航
        if (activeElement.closest('.record-list, .search-results-list')) {
            this.handleListNavigation(e, activeElement);
        }
    }
    
    /**
     * 处理网格导航
     */
    handleGridNavigation(e, currentElement) {
        const grid = currentElement.closest('.category-grid, .exam-grid');
        const items = Array.from(grid.children);
        const currentIndex = items.indexOf(currentElement);
        
        if (currentIndex === -1) return;
        
        const gridColumns = this.getGridColumns(grid);
        let nextIndex;
        
        switch (e.key) {
            case 'ArrowLeft':
                nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                break;
            case 'ArrowRight':
                nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                break;
            case 'ArrowUp':
                nextIndex = currentIndex - gridColumns;
                if (nextIndex < 0) nextIndex = currentIndex;
                break;
            case 'ArrowDown':
                nextIndex = currentIndex + gridColumns;
                if (nextIndex >= items.length) nextIndex = currentIndex;
                break;
        }
        
        if (nextIndex !== undefined && items[nextIndex]) {
            items[nextIndex].focus();
            e.preventDefault();
        }
    }
    
    /**
     * 处理列表导航
     */
    handleListNavigation(e, currentElement) {
        const list = currentElement.closest('.record-list, .search-results-list');
        const items = Array.from(list.children);
        const currentIndex = items.indexOf(currentElement);
        
        if (currentIndex === -1) return;
        
        let nextIndex;
        
        switch (e.key) {
            case 'ArrowUp':
                nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                break;
            case 'ArrowDown':
                nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                break;
        }
        
        if (nextIndex !== undefined && items[nextIndex]) {
            items[nextIndex].focus();
            e.preventDefault();
        }
    }
    
    /**
     * 获取可聚焦元素
     */
    getFocusableElements() {
        const selector = [
            'button:not([disabled])',
            '[href]',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])',
            '.exam-card',
            '.category-card'
        ].join(', ');
        
        return Array.from(document.querySelectorAll(selector))
            .filter(el => this.isElementVisible(el));
    }
    
    /**
     * 检查元素是否可见
     */
    isElementVisible(element) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        
        return rect.width > 0 && 
               rect.height > 0 && 
               style.visibility !== 'hidden' && 
               style.display !== 'none' &&
               element.offsetParent !== null;
    }
    
    /**
     * 获取网格列数
     */
    getGridColumns(grid) {
        const style = getComputedStyle(grid);
        const columns = style.gridTemplateColumns.split(' ').length;
        return columns || 1;
    }
    
    /**
     * 快捷键功能实现
     */
    
    openSearch() {
        const searchInput = document.querySelector('.search-input, .search-input-sm');
        if (searchInput) {
            searchInput.focus();
            this.showShortcutFeedback('搜索已激活');
        } else {
            // 创建快速搜索
            this.createQuickSearch();
        }
    }
    
    refreshCurrentView() {
        const currentView = document.querySelector('.view.active');
        if (currentView && window.app) {
            const viewName = currentView.id.replace('-view', '');
            window.app.onViewActivated(viewName);
            this.showShortcutFeedback('数据已刷新');
        }
    }
    
    showHelp() {
        this.showShortcutsModal();
    }
    
    closeTopModal() {
        const modals = document.querySelectorAll('.modal-overlay.show');
        if (modals.length > 0) {
            const topModal = modals[modals.length - 1];
            const closeBtn = topModal.querySelector('.modal-close, .close-preview, .close-sessions');
            if (closeBtn) {
                closeBtn.click();
            } else {
                topModal.remove();
            }
        }
    }
    
    skipToMainContent() {
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.focus();
            mainContent.scrollIntoView({ behavior: 'smooth' });
            this.showShortcutFeedback('已跳转到主要内容');
        }
    }
    
    skipToNavigation() {
        const navigation = document.querySelector('.main-nav');
        if (navigation) {
            const firstNavBtn = navigation.querySelector('.nav-btn');
            if (firstNavBtn) {
                firstNavBtn.focus();
                this.showShortcutFeedback('已跳转到导航');
            }
        }
    }
    
    startQuickPractice() {
        // 随机选择一个题目开始练习
        const examIndex = window.storage?.get('exam_index', []);
        if (examIndex && examIndex.length > 0) {
            const randomExam = examIndex[Math.floor(Math.random() * examIndex.length)];
            if (window.app) {
                window.app.openExam(randomExam.id);
                this.showShortcutFeedback(`开始练习: ${randomExam.title}`);
            }
        } else {
            this.showShortcutFeedback('暂无可用题目', 'warning');
        }
    }
    
    openSettings() {
        // 打开设置模态框
        this.showSettingsModal();
    }
    
    openDeveloperTools() {
        console.log('Developer tools opened');
        console.log('Registered shortcuts:', this.shortcuts);
        console.log('Modal stack:', this.modalStack);
        this.showShortcutFeedback('开发者工具已打开（查看控制台）');
    }
    
    /**
     * 创建快速搜索
     */
    createQuickSearch() {
        const searchOverlay = document.createElement('div');
        searchOverlay.className = 'quick-search-overlay';
        searchOverlay.innerHTML = `
            <div class="quick-search-modal">
                <div class="quick-search-header">
                    <input type="text" class="quick-search-input" placeholder="搜索题目..." autofocus>
                    <button class="quick-search-close">×</button>
                </div>
                <div class="quick-search-results"></div>
            </div>
        `;
        
        document.body.appendChild(searchOverlay);
        
        const input = searchOverlay.querySelector('.quick-search-input');
        const results = searchOverlay.querySelector('.quick-search-results');
        const closeBtn = searchOverlay.querySelector('.quick-search-close');
        
        // 搜索功能
        input.addEventListener('input', Utils.debounce((e) => {
            this.performQuickSearch(e.target.value, results);
        }, 300));
        
        // 关闭功能
        closeBtn.addEventListener('click', () => {
            searchOverlay.remove();
        });
        
        searchOverlay.addEventListener('click', (e) => {
            if (e.target === searchOverlay) {
                searchOverlay.remove();
            }
        });
        
        // ESC关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                searchOverlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }
    
    /**
     * 执行快速搜索
     */
    performQuickSearch(query, resultsContainer) {
        if (!query.trim()) {
            resultsContainer.innerHTML = '';
            return;
        }
        
        const examIndex = window.storage?.get('exam_index', []) || [];
        const results = examIndex.filter(exam => 
            exam.title.toLowerCase().includes(query.toLowerCase()) ||
            exam.category.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 10);
        
        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">未找到相关题目</div>';
            return;
        }
        
        resultsContainer.innerHTML = results.map(exam => `
            <div class="quick-search-item" data-exam-id="${exam.id}">
                <div class="search-item-title">${exam.title}</div>
                <div class="search-item-meta">${exam.category} • ${exam.frequency === 'high' ? '高频' : '次高频'}</div>
            </div>
        `).join('');
        
        // 添加点击事件
        resultsContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.quick-search-item');
            if (item && window.app) {
                const examId = item.dataset.examId;
                window.app.openExam(examId);
                document.querySelector('.quick-search-overlay').remove();
            }
        });
    }
    
    /**
     * 显示快捷键模态框
     */
    showShortcutsModal() {
        const shortcuts = Array.from(this.shortcuts.values());
        const categories = [...new Set(shortcuts.map(s => s.category))];
        
        const modalContent = `
            <div class="shortcuts-modal">
                <div class="modal-header">
                    <h3>键盘快捷键</h3>
                    <button class="modal-close">×</button>
                </div>
                <div class="modal-body">
                    ${categories.map(category => `
                        <div class="shortcuts-category">
                            <h4>${this.getCategoryName(category)}</h4>
                            <div class="shortcuts-list">
                                ${shortcuts
                                    .filter(s => s.category === category)
                                    .map(s => `
                                        <div class="shortcut-item">
                                            <kbd class="shortcut-key">${this.formatShortcutKey(s.key)}</kbd>
                                            <span class="shortcut-desc">${s.description}</span>
                                        </div>
                                    `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        this.showModal(modalContent);
    }
    
    /**
     * 显示设置模态框
     */
    showSettingsModal() {
        const modalContent = `
            <div class="settings-modal">
                <div class="modal-header">
                    <h3>系统设置</h3>
                    <button class="modal-close">×</button>
                </div>
                <div class="modal-body">
                    <div class="settings-section">
                        <h4>快捷键设置</h4>
                        <label class="settings-item">
                            <input type="checkbox" ${this.isEnabled ? 'checked' : ''} id="enable-shortcuts">
                            启用键盘快捷键
                        </label>
                    </div>
                    
                    <div class="settings-section">
                        <h4>无障碍设置</h4>
                        <label class="settings-item">
                            <input type="checkbox" id="high-contrast">
                            高对比度模式
                        </label>
                        <label class="settings-item">
                            <input type="checkbox" id="reduce-motion">
                            减少动画效果
                        </label>
                        <label class="settings-item">
                            <input type="checkbox" id="large-text">
                            大字体模式
                        </label>
                    </div>
                    
                    <div class="settings-section">
                        <h4>其他设置</h4>
                        <label class="settings-item">
                            <input type="checkbox" id="auto-save">
                            自动保存进度
                        </label>
                        <label class="settings-item">
                            <input type="checkbox" id="sound-effects">
                            音效提示
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">
                        保存设置
                    </button>
                </div>
            </div>
        `;
        
        this.showModal(modalContent);
        
        // 设置事件监听
        setTimeout(() => {
            this.setupSettingsEvents();
        }, 100);
    }
    
    /**
     * 设置设置页面事件
     */
    setupSettingsEvents() {
        const modal = document.querySelector('.settings-modal');
        if (!modal) return;
        
        // 快捷键开关
        const shortcutsToggle = modal.querySelector('#enable-shortcuts');
        if (shortcutsToggle) {
            shortcutsToggle.addEventListener('change', (e) => {
                this.isEnabled = e.target.checked;
                this.showShortcutFeedback(
                    this.isEnabled ? '快捷键已启用' : '快捷键已禁用'
                );
            });
        }
        
        // 高对比度
        const highContrastToggle = modal.querySelector('#high-contrast');
        if (highContrastToggle) {
            highContrastToggle.checked = document.body.classList.contains('high-contrast');
            highContrastToggle.addEventListener('change', (e) => {
                document.body.classList.toggle('high-contrast', e.target.checked);
            });
        }
        
        // 减少动画
        const reduceMotionToggle = modal.querySelector('#reduce-motion');
        if (reduceMotionToggle) {
            reduceMotionToggle.checked = document.body.classList.contains('reduce-motion');
            reduceMotionToggle.addEventListener('change', (e) => {
                document.body.classList.toggle('reduce-motion', e.target.checked);
            });
        }
        
        // 大字体
        const largeTextToggle = modal.querySelector('#large-text');
        if (largeTextToggle) {
            largeTextToggle.checked = document.body.classList.contains('large-text');
            largeTextToggle.addEventListener('change', (e) => {
                document.body.classList.toggle('large-text', e.target.checked);
            });
        }
    }
    
    /**
     * 显示模态框
     */
    showModal(content) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay show';
        modalOverlay.innerHTML = `<div class="modal">${content}</div>`;
        
        document.body.appendChild(modalOverlay);
        
        // 触发模态框打开事件
        document.dispatchEvent(new CustomEvent('modalOpened', {
            detail: { modalId: Date.now() }
        }));
        
        // 点击背景关闭
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.remove();
            }
        });
        
        // 关闭按钮
        const closeBtn = modalOverlay.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modalOverlay.remove();
            });
        }
    }
    
    /**
     * 显示快捷键反馈
     */
    showShortcutFeedback(message, type = 'info') {
        if (window.showMessage) {
            window.showMessage(message, type);
        } else {
            console.log(`Shortcut: ${message}`);
        }
    }
    
    /**
     * 工具方法
     */
    
    getCategoryName(category) {
        const names = {
            navigation: '导航',
            function: '功能',
            help: '帮助',
            modal: '模态框',
            accessibility: '无障碍',
            'quick-action': '快速操作',
            developer: '开发者'
        };
        return names[category] || category;
    }
    
    formatShortcutKey(key) {
        return key
            .replace('ctrl', 'Ctrl')
            .replace('alt', 'Alt')
            .replace('shift', 'Shift')
            .replace('+', ' + ')
            .toUpperCase();
    }
    
    isDevelopmentMode() {
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1' ||
               window.location.search.includes('debug=true');
    }
    
    /**
     * 创建快捷键帮助
     */
    createShortcutsHelp() {
        // 创建帮助按钮
        const helpButton = document.createElement('button');
        helpButton.className = 'shortcuts-help-btn';
        helpButton.innerHTML = '?';
        helpButton.title = '键盘快捷键帮助 (Ctrl+H)';
        helpButton.addEventListener('click', () => this.showHelp());
        
        document.body.appendChild(helpButton);
    }
    
    /**
     * 启用/禁用快捷键
     */
    enable() {
        this.isEnabled = true;
    }
    
    disable() {
        this.isEnabled = false;
    }
    
    /**
     * 获取所有快捷键
     */
    getAllShortcuts() {
        return Array.from(this.shortcuts.values());
    }
}

// 添加相关样式
const shortcutStyles = `
.quick-search-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 1000;
    padding-top: 10vh;
}

.quick-search-modal {
    background: var(--bg-primary);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-lg);
    width: 90%;
    max-width: 600px;
    max-height: 70vh;
    overflow: hidden;
}

.quick-search-header {
    display: flex;
    align-items: center;
    padding: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
}

.quick-search-input {
    flex: 1;
    padding: var(--spacing-md);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    font-size: var(--font-size-base);
    margin-right: var(--spacing-md);
}

.quick-search-close {
    background: none;
    border: none;
    font-size: var(--font-size-xl);
    cursor: pointer;
    color: var(--text-muted);
    padding: var(--spacing-xs);
}

.quick-search-results {
    max-height: 400px;
    overflow-y: auto;
}

.quick-search-item {
    padding: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.quick-search-item:hover {
    background: var(--bg-secondary);
}

.search-item-title {
    font-weight: 600;
    margin-bottom: var(--spacing-xs);
}

.search-item-meta {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
}

.shortcuts-modal {
    max-width: 700px;
    width: 90%;
}

.shortcuts-category {
    margin-bottom: var(--spacing-xl);
}

.shortcuts-category h4 {
    margin-bottom: var(--spacing-md);
    color: var(--primary-color);
    border-bottom: 1px solid var(--border-color);
    padding-bottom: var(--spacing-sm);
}

.shortcuts-list {
    display: grid;
    gap: var(--spacing-sm);
}

.shortcut-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-sm);
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
}

.shortcut-key {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: var(--spacing-xs) var(--spacing-sm);
    font-family: monospace;
    font-size: var(--font-size-sm);
    min-width: 80px;
    text-align: center;
}

.shortcut-desc {
    flex: 1;
    color: var(--text-primary);
}

.settings-modal {
    max-width: 500px;
    width: 90%;
}

.settings-section {
    margin-bottom: var(--spacing-xl);
}

.settings-section h4 {
    margin-bottom: var(--spacing-md);
    color: var(--primary-color);
}

.settings-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) 0;
    cursor: pointer;
}

.settings-item input[type="checkbox"] {
    width: 18px;
    height: 18px;
}

.shortcuts-help-btn {
    position: fixed;
    bottom: var(--spacing-lg);
    left: var(--spacing-lg);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--primary-color);
    color: white;
    border: none;
    cursor: pointer;
    font-size: var(--font-size-lg);
    font-weight: bold;
    box-shadow: var(--shadow-lg);
    z-index: 999;
    transition: all 0.2s ease;
}

.shortcuts-help-btn:hover {
    background: var(--primary-hover);
    transform: scale(1.1);
}

.no-results {
    padding: var(--spacing-lg);
    text-align: center;
    color: var(--text-muted);
}

/* 高对比度模式 */
.high-contrast {
    filter: contrast(150%);
}

.high-contrast .shortcut-key {
    border-width: 2px;
    font-weight: bold;
}

/* 减少动画模式 */
.reduce-motion * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
}

/* 大字体模式 */
.large-text {
    font-size: 18px;
}

.large-text .shortcut-key {
    font-size: var(--font-size-base);
    padding: var(--spacing-sm);
}

.large-text .shortcuts-help-btn {
    width: 48px;
    height: 48px;
    font-size: var(--font-size-xl);
}

@media (max-width: 768px) {
    .quick-search-modal {
        width: 95%;
        margin: var(--spacing-md);
    }
    
    .shortcuts-modal,
    .settings-modal {
        width: 95%;
        max-height: 85vh;
    }
    
    .shortcuts-help-btn {
        bottom: var(--spacing-md);
        left: var(--spacing-md);
    }
}
`;

// 注入样式
const shortcutStyleSheet = document.createElement('style');
shortcutStyleSheet.textContent = shortcutStyles;
document.head.appendChild(shortcutStyleSheet);

// 导出类
window.KeyboardShortcuts = KeyboardShortcuts;