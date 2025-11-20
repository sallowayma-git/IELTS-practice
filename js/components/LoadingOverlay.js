/**
 * Loading Overlay Component
 * Handles the global loading animation and transition.
 */
class LoadingOverlay {
    constructor() {
        this.overlay = null;
        this.spinner = null;
        this.message = null;
        this.isShowing = false;
        this._init();
    }

    _init() {
        // Create overlay element if it doesn't exist
        if (!document.getElementById('global-loading-overlay')) {
            this.overlay = document.createElement('div');
            this.overlay.id = 'global-loading-overlay';
            this.overlay.className = 'loading-overlay';

            const content = document.createElement('div');
            content.className = 'loading-content';

            this.spinner = document.createElement('div');
            this.spinner.className = 'loading-spinner';

            this.message = document.createElement('p');
            this.message.className = 'loading-message';
            this.message.textContent = '正在加载资源...';

            content.appendChild(this.spinner);
            content.appendChild(this.message);
            this.overlay.appendChild(content);
            document.body.appendChild(this.overlay);
        } else {
            this.overlay = document.getElementById('global-loading-overlay');
            this.spinner = this.overlay.querySelector('.loading-spinner');
            this.message = this.overlay.querySelector('.loading-message');
        }
    }

    show(message = '正在加载...') {
        if (this.message) {
            this.message.textContent = message;
        }
        this.overlay.classList.add('active');
        this.isShowing = true;
    }

    hide() {
        this.overlay.classList.remove('active');
        this.overlay.classList.add('hiding');

        // Wait for animation to finish
        setTimeout(() => {
            this.overlay.classList.remove('hiding');
            this.isShowing = false;
        }, 500);
    }
}

// Export for global use
window.LoadingOverlay = LoadingOverlay;
