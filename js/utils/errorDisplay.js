// errorDisplay.js - User-friendly error display system
// Works with AppStore error handling to show actionable error messages

window.ErrorDisplay = class ErrorDisplay {
    constructor() {
        this.container = null;
        this.errors = new Map();
        this.maxErrors = 5;
        
        this.createContainer();
        this.setupStyles();
        
        // Subscribe to app store errors if available
        if (window.app && window.app.stores && window.app.stores.app) {
            window.app.stores.app.subscribe(this.handleAppStoreEvent.bind(this));
        }
        
        console.log('[ErrorDisplay] Initialized');
    }
    
    createContainer() {
        this.container = document.createElement('div');
        this.container.id = 'error-display-container';
        this.container.className = 'error-display-container';
        document.body.appendChild(this.container);
    }
    
    setupStyles() {
        if (document.getElementById('error-display-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'error-display-styles';
        styles.textContent = `
            .error-display-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                max-width: 400px;
                pointer-events: none;
            }
            
            .error-card {
                background: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 12px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                pointer-events: auto;
                animation: slideIn 0.3s ease-out;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                line-height: 1.4;
            }
            
            .error-card.warning {
                background: #fff3cd;
                color: #856404;
                border-color: #ffeaa7;
            }
            
            .error-card.info {
                background: #d1ecf1;
                color: #0c5460;
                border-color: #bee5eb;
            }
            
            .error-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 8px;
            }
            
            .error-title {
                font-weight: 600;
                margin: 0;
                font-size: 14px;
            }
            
            .error-close {
                background: none;
                border: none;
                font-size: 18px;
                cursor: pointer;
                padding: 0;
                margin-left: 8px;
                opacity: 0.7;
                transition: opacity 0.2s;
            }
            
            .error-close:hover {
                opacity: 1;
            }
            
            .error-message {
                margin: 8px 0;
                font-size: 13px;
            }
            
            .error-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
                flex-wrap: wrap;
            }
            
            .error-action-btn {
                background: rgba(0, 0, 0, 0.1);
                border: 1px solid rgba(0, 0, 0, 0.2);
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 12px;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            
            .error-action-btn:hover {
                background: rgba(0, 0, 0, 0.2);
            }
            
            .error-context {
                font-size: 11px;
                opacity: 0.8;
                margin-top: 8px;
                font-family: monospace;
            }
            
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
            
            .error-card.removing {
                animation: slideOut 0.3s ease-in forwards;
            }
        `;
        document.head.appendChild(styles);
    }
    
    handleAppStoreEvent(event) {
        switch (event.type) {
            case 'error_added':
                this.showError(event.error);
                break;
            case 'error_cleared':
                this.hideError(event.error.id);
                break;
            case 'errors_cleared':
                this.clearAllErrors();
                break;
        }
    }
    
    showError(errorInfo) {
        // Limit number of displayed errors
        if (this.errors.size >= this.maxErrors) {
            const oldestError = this.errors.keys().next().value;
            this.hideError(oldestError);
        }
        
        const errorCard = this.createErrorCard(errorInfo);
        this.container.appendChild(errorCard);
        this.errors.set(errorInfo.id, errorCard);
        
        // Auto-hide after delay for non-critical errors
        if (errorInfo.recoverable) {
            setTimeout(() => {
                this.hideError(errorInfo.id);
            }, 10000); // 10 seconds
        }
    }
    
    createErrorCard(errorInfo) {
        const card = document.createElement('div');
        card.className = `error-card ${this.getErrorClass(errorInfo)}`;
        card.dataset.errorId = errorInfo.id;
        
        const header = document.createElement('div');
        header.className = 'error-header';
        
        const title = document.createElement('h4');
        title.className = 'error-title';
        title.textContent = this.getErrorTitle(errorInfo);
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'error-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = () => this.hideError(errorInfo.id);
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        
        const message = document.createElement('div');
        message.className = 'error-message';
        message.textContent = errorInfo.userMessage || errorInfo.message;
        
        card.appendChild(header);
        card.appendChild(message);
        
        // Add action buttons
        if (errorInfo.actions && errorInfo.actions.length > 0) {
            const actions = document.createElement('div');
            actions.className = 'error-actions';
            
            errorInfo.actions.forEach(actionText => {
                const btn = document.createElement('button');
                btn.className = 'error-action-btn';
                btn.textContent = actionText;
                btn.onclick = () => this.handleErrorAction(actionText, errorInfo);
                actions.appendChild(btn);
            });
            
            card.appendChild(actions);
        }
        
        // Add context for developers (in debug mode)
        if (this.isDebugMode() && errorInfo.context) {
            const context = document.createElement('div');
            context.className = 'error-context';
            context.textContent = `Context: ${errorInfo.context}`;
            card.appendChild(context);
        }
        
        return card;
    }
    
    getErrorClass(errorInfo) {
        if (!errorInfo.recoverable) return 'error';
        if (errorInfo.message && errorInfo.message.includes('warning')) return 'warning';
        if (errorInfo.message && errorInfo.message.includes('info')) return 'info';
        return 'error';
    }
    
    getErrorTitle(errorInfo) {
        if (!errorInfo.recoverable) return '系统错误';
        if (errorInfo.message && errorInfo.message.includes('warning')) return '警告';
        if (errorInfo.message && errorInfo.message.includes('info')) return '提示';
        return '操作失败';
    }
    
    handleErrorAction(actionText, errorInfo) {
        switch (actionText.toLowerCase()) {
            case 'refresh page':
            case '刷新页面':
                window.location.reload();
                break;
            case 'try again':
            case '重试':
                // Close the error and let user try again
                this.hideError(errorInfo.id);
                break;
            case 'report issue':
            case '报告问题':
                this.reportIssue(errorInfo);
                break;
            case 'export data':
            case '导出数据':
                if (window.app && window.app.ui && window.app.ui.settings) {
                    window.app.ui.settings.exportData();
                }
                break;
            case 'check browser console':
            case '查看控制台':
                alert('请按 F12 打开开发者工具查看详细错误信息');
                break;
            default:
                // Generic action - just close the error
                this.hideError(errorInfo.id);
        }
    }
    
    reportIssue(errorInfo) {
        const issueData = {
            message: errorInfo.message,
            context: errorInfo.context,
            timestamp: errorInfo.timestamp,
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        const issueText = `Error Report:\n\n${JSON.stringify(issueData, null, 2)}`;
        
        // Copy to clipboard if possible
        if (navigator.clipboard) {
            navigator.clipboard.writeText(issueText).then(() => {
                alert('错误信息已复制到剪贴板，请发送给技术支持');
            }).catch(() => {
                this.showIssueDialog(issueText);
            });
        } else {
            this.showIssueDialog(issueText);
        }
    }
    
    showIssueDialog(issueText) {
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 2px solid #ccc;
            border-radius: 8px;
            padding: 20px;
            z-index: 10001;
            max-width: 500px;
            max-height: 400px;
            overflow: auto;
        `;
        
        dialog.innerHTML = `
            <h3>错误报告</h3>
            <p>请复制以下信息并发送给技术支持：</p>
            <textarea readonly style="width: 100%; height: 200px; font-family: monospace; font-size: 12px;">${issueText}</textarea>
            <div style="margin-top: 10px; text-align: right;">
                <button onclick="this.parentElement.parentElement.remove()">关闭</button>
            </div>
        `;
        
        document.body.appendChild(dialog);
    }
    
    hideError(errorId) {
        const errorCard = this.errors.get(errorId);
        if (errorCard) {
            errorCard.classList.add('removing');
            setTimeout(() => {
                if (errorCard.parentNode) {
                    errorCard.parentNode.removeChild(errorCard);
                }
                this.errors.delete(errorId);
            }, 300);
        }
        
        // Clear from app store if available
        if (window.app && window.app.stores && window.app.stores.app) {
            window.app.stores.app.clearError(errorId);
        }
    }
    
    clearAllErrors() {
        this.errors.forEach((errorCard, errorId) => {
            errorCard.classList.add('removing');
            setTimeout(() => {
                if (errorCard.parentNode) {
                    errorCard.parentNode.removeChild(errorCard);
                }
            }, 300);
        });
        
        setTimeout(() => {
            this.errors.clear();
        }, 300);
    }
    
    isDebugMode() {
        return localStorage.getItem('debug_mode') === 'true' || 
               window.location.search.includes('debug=true');
    }
    
    // Public API for manual error display
    show(message, type = 'error', actions = []) {
        const errorInfo = {
            id: 'manual_' + Date.now(),
            message: message,
            userMessage: message,
            recoverable: type !== 'error',
            actions: actions,
            timestamp: new Date().toISOString(),
            context: 'Manual display'
        };
        
        this.showError(errorInfo);
        return errorInfo.id;
    }
    
    hide(errorId) {
        this.hideError(errorId);
    }
    
    clear() {
        this.clearAllErrors();
    }
};

// Create global instance
window.errorDisplay = new window.ErrorDisplay();

// Provide global functions for backward compatibility
window.showErrorMessage = (message, actions = []) => {
    return window.errorDisplay.show(message, 'error', actions);
};

window.showWarningMessage = (message, actions = []) => {
    return window.errorDisplay.show(message, 'warning', actions);
};

window.showInfoMessage = (message, actions = []) => {
    return window.errorDisplay.show(message, 'info', actions);
};

window.hideErrorMessage = (errorId) => {
    window.errorDisplay.hide(errorId);
};

window.clearErrorMessages = () => {
    window.errorDisplay.clear();
};

// 统一错误服务门面 (Task 31)
window.ErrorService = {
    /**
     * 显示用户错误消息
     */
    showUser(message, type = 'error', actions = []) {
        try {
            // 使用 ErrorDisplay 显示错误
            if (window.errorDisplay) {
                return window.errorDisplay.show(message, type, actions);
            }

            // 回退方案
            this.fallbackShow(message, type);
        } catch (error) {
            console.error('[ErrorService] Failed to show error:', error);
            this.fallbackShow(message, type);
        }
    },

    /**
     * 记录错误（开发环境）
     */
    log(error, context = 'Unknown') {
        console.error(`[ErrorService] ${context}:`, error);

        // 在开发环境中显示详细错误
        if (location.hostname === 'localhost' || location.protocol === 'file:') {
            console.groupCollapsed(`[ErrorService] ${context} - Details`);
            console.log('Error:', error);
            console.log('Stack:', error.stack);
            console.log('Context:', context);
            console.groupEnd();
        }
    },

    /**
     * 显示带操作的错误
     */
    showErrorWithActions(message, actions = []) {
        return this.showUser(message, 'error', actions);
    },

    /**
     * 显示警告
     */
    showWarning(message, actions = []) {
        return this.showUser(message, 'warning', actions);
    },

    /**
     * 显示信息
     */
    showInfo(message, actions = []) {
        return this.showUser(message, 'info', actions);
    },

    /**
     * 隐藏特定错误
     */
    hide(errorId) {
        if (window.errorDisplay) {
            window.errorDisplay.hide(errorId);
        }
    },

    /**
     * 清除所有错误
     */
    clear() {
        if (window.errorDisplay) {
            window.errorDisplay.clear();
        }
    },

    /**
     * 回退显示方案
     */
    fallbackShow(message, type) {
        switch (type) {
            case 'error':
                console.error(`[ErrorService] ${message}`);
                if (typeof alert !== 'undefined') {
                    alert(`错误: ${message}`);
                }
                break;
            case 'warning':
                console.warn(`[ErrorService] ${message}`);
                break;
            case 'info':
                console.log(`[ErrorService] ${message}`);
                break;
            default:
                console.log(`[ErrorService] ${message}`);
        }
    }
};

// 向后兼容别名
window.showUserMessage = (message, type = 'info', actions = []) => {
    return window.ErrorService.showUser(message, type, actions);
};

console.log('[ErrorService] Initialized');