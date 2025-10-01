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
    }

    // Attach to DOM container, setup listeners and subscriptions
    attach(container) {
        this.container = container;
        this.setupEventListeners();
        this.subscribeToStores();
        this.render(); // Initial render on attach
    }

    // Detach from DOM, cleanup listeners and subscriptions
    detach() {
        // Task 84: 取消待处理的渲染
        this._renderPending = false;

        this.cleanupEventListeners();
        this.unsubscribeFromStores();
        this.container = null;
    }

    // Render content (idempotent: should clear then rebuild)
    render() {
        if (!this.container) return;
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

    // 实际渲染方法，由子类重写
    _doRender() {
        // Subclasses implement specific rendering
        // Ensure: this.container.innerHTML = ''; then build HTML
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