/**
 * View Manager Component
 * Handles view switching, lazy loading, and lifecycle management.
 */
class ViewManager {
    constructor() {
        this.views = new Map();
        this.currentViewId = null;
        this.viewLoaders = new Map();
        this._init();
    }

    _init() {
        // Register default views
        const viewElements = document.querySelectorAll('.view');
        viewElements.forEach(el => {
            this.views.set(el.id, el);
        });

        // Bind navigation buttons
        document.querySelectorAll('[data-view]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const viewId = btn.getAttribute('data-view');
                this.switchTo(`${viewId}-view`);
            });
        });
    }

    /**
     * Register a lazy loader for a view
     * @param {string} viewId - The ID of the view
     * @param {Function} loader - Async function that loads the view's dependencies
     */
    registerLoader(viewId, loader) {
        this.viewLoaders.set(viewId, loader);
    }

    async switchTo(viewId) {
        if (this.currentViewId === viewId) return;

        // Show loading if there's a loader
        if (this.viewLoaders.has(viewId)) {
            const loadingOverlay = new window.LoadingOverlay();
            loadingOverlay.show('正在加载模块...');

            try {
                await this.viewLoaders.get(viewId)();
                // Remove loader after successful load so we don't load again
                this.viewLoaders.delete(viewId);
            } catch (error) {
                console.error(`Failed to load view ${viewId}:`, error);
                loadingOverlay.hide();
                return;
            }
            loadingOverlay.hide();
        }

        // Update UI
        this.views.forEach((el, id) => {
            if (id === viewId) {
                el.classList.add('active');
                el.hidden = false;
            } else {
                el.classList.remove('active');
                // Optional: set hidden attribute for accessibility
                // el.hidden = true; 
            }
        });

        // Update Navigation Buttons
        const navId = viewId.replace('-view', '');
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if (btn.getAttribute('data-view') === navId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        this.currentViewId = viewId;

        // Trigger event
        window.dispatchEvent(new CustomEvent('viewChanged', { detail: { viewId } }));
    }
}

// Export for global use
window.ViewManager = ViewManager;
