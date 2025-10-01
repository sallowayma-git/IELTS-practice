// BaseComponent.js - Simple base class for UI components without framework
// Provides attach, detach, render lifecycle methods for predictable management

class BaseComponent {
    constructor(stores, elements = {}) {
        this.stores = stores;
        this.elements = elements;
        this.container = null;
        this.subscriptions = [];
        this.eventListeners = [];
        this._renderPending = false; // Task 84: 渲染防抖标记
        this.viewName = null; // Task 97: 视图名称，用于渲染门控
    }

    // Attach to DOM container, setup listeners and subscriptions
    attach(container) {
        // Task 94: 防止重复attach
        if (this._attached) {
            if (window.__DEBUG__) console.debug('[BaseComponent] Already attached, skipping');
            return;
        }

        this.container = container;
        this._attached = true;

        this.setupEventListeners();
        this.subscribeToStores();
        this.render(); // Initial render on attach
    }

    // Detach from DOM, cleanup listeners and subscriptions
    detach() {
        // Task 84: 取消待处理的渲染
        this._renderPending = false;
        // Task 94: 重置attach标记
        this._attached = false;

        this.cleanupEventListeners();
        this.unsubscribeFromStores();
        this.container = null;
    }

    // Render content (idempotent: should clear then rebuild)
    render() {
        if (!this.container) return;

        // Task 97: 视图激活渲染防护
        if (!this.isViewActive()) {
            if (window.__DEBUG__) console.debug(`[BaseComponent] View ${this.viewName} not active, skipping render`);
            return;
        }

        // Task 84: 渲染重入防护和防抖
        if (this._renderPending) {
            if (window.__DEBUG__) console.debug('[BaseComponent] Render already pending, skipping');
            return;
        }

        this._renderPending = true;
        queueMicrotask(() => {
            this._renderPending = false;
            this._doRender();
        });
    }

    // Task 97: 检查视图是否激活
    isViewActive() {
        if (!this.viewName) return true; // 无视图名称的组件总是渲染

        try {
            // 检查当前激活的视图
            const currentView = window.stores?.app?.getCurrentView?.() ||
                              window.App?.currentView ||
                              document.querySelector('.nav-item.active')?.dataset?.view ||
                              document.querySelector('.view.active')?.id;

            return currentView === this.viewName ||
                   (typeof currentView === 'string' && currentView.includes(this.viewName));
        } catch (error) {
            if (window.__DEBUG__) console.debug('[BaseComponent] Error checking view active:', error);
            return true; // 出错时默认渲染，避免功能失效
        }
    }

    // Task 97: 设置视图名称
    setViewName(name) {
        this.viewName = name;
    }

    // 实际渲染方法，由子类重写
    _doRender() {
        // Task 98: 未知失败时的兜底空状态
        try {
            this._doActualRender();
        } catch (error) {
            console.error(`[${this.constructor.name}] Render failed, falling back to empty state:`, error);
            this._renderEmptyState(error);
        }
    }

    // 子类需要重写此方法
    _doActualRender() {
        // Subclasses implement specific rendering
        // Ensure: this.container.innerHTML = ''; then build HTML
    }

    // Task 98: 友好的空状态渲染
    _renderEmptyState(error = null) {
        if (!this.container) return;

        const errorMessage = error && window.__DEBUG__ ?
            `<details><summary>错误详情</summary><pre>${error.message}</pre></details>` :
            '';

        this.container.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 60px 20px;
                text-align: center;
                color: #666;
                min-height: 200px;
            ">
                <div style="font-size: 3em; margin-bottom: 20px; opacity: 0.5;">⚠️</div>
                <h3>暂时无法显示内容</h3>
                <p style="margin: 10px 0; max-width: 400px;">
                    系统遇到了一些问题，正在尝试恢复...
                </p>
                <button
                    onclick="location.reload()"
                    style="
                        margin-top: 20px;
                        padding: 8px 16px;
                        background: #007bff;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    "
                >
                    刷新页面
                </button>
                ${errorMessage}
            </div>
        `;
    }

    // Setup DOM event listeners (subclasses override)
    setupEventListeners() {
        // Add listeners with this.addEventListener method
    }

    // Cleanup all event listeners
    cleanupEventListeners() {
        this.eventListeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        this.eventListeners = [];
    }

    // Helper to add event listener with auto-cleanup
    addEventListener(element, event, handler) {
        element.addEventListener(event, handler);
        this.eventListeners.push({ element, event, handler });
    }

    // Subscribe to stores (subclasses override)
    subscribeToStores() {
        // Add subscriptions with this.addSubscription
    }

    // Helper to add store subscription with auto-unsubscribe
    addSubscription(unsubscribeFn) {
        this.subscriptions.push(unsubscribeFn);
    }

    // Unsubscribe from all stores
    unsubscribeFromStores() {
        this.subscriptions.forEach(unsub => unsub());
        this.subscriptions = [];
    }
}

// Export for global compatibility (file:// protocol)
window.BaseComponent = BaseComponent;

console.log('[BaseComponent] Base class loaded');