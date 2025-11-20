(function (global) {
    'use strict';

    // --- Legacy navigation controller ---
    function LegacyNavigationController(options) {
        options = options || {};
        this.options = {
            containerSelector: options.containerSelector || '.main-nav',
            navButtonSelector: options.navButtonSelector || '.nav-btn[data-view]',
            activeClass: options.activeClass || 'active',
            syncOnNavigate: options.syncOnNavigate !== false,
            onNavigate: typeof options.onNavigate === 'function' ? options.onNavigate : null,
            onRepeatNavigate: typeof options.onRepeatNavigate === 'function' ? options.onRepeatNavigate : null
        };
        this.container = options.container || null;
        this._boundClickHandler = this._handleClick.bind(this);
        this._isMounted = false;
    }

    LegacyNavigationController.prototype.updateOptions = function updateOptions(options) {
        if (!options) {
            return;
        }
        this.options = Object.assign({}, this.options, {
            containerSelector: options.containerSelector || this.options.containerSelector,
            navButtonSelector: options.navButtonSelector || this.options.navButtonSelector,
            activeClass: options.activeClass || this.options.activeClass,
            syncOnNavigate: options.syncOnNavigate === undefined ? this.options.syncOnNavigate : options.syncOnNavigate,
            onNavigate: typeof options.onNavigate === 'function' ? options.onNavigate : this.options.onNavigate,
            onRepeatNavigate: typeof options.onRepeatNavigate === 'function' ? options.onRepeatNavigate : this.options.onRepeatNavigate
        });
        if (options.container) {
            this.container = options.container;
        }
    };

    LegacyNavigationController.prototype.mount = function mount(container) {
        if (typeof document === 'undefined') {
            return null;
        }

        var targetContainer = container;
        if (!targetContainer) {
            if (this.container && document.contains(this.container)) {
                targetContainer = this.container;
            } else if (this.options.containerSelector) {
                targetContainer = document.querySelector(this.options.containerSelector);
            }
        }

        if (!targetContainer) {
            this.unmount();
            return null;
        }

        if (this.container && this.container !== targetContainer) {
            this.unmount();
        }

        this.container = targetContainer;
        if (!this._isMounted) {
            this.container.addEventListener('click', this._boundClickHandler);
        }
        this._isMounted = true;
        return this.container;
    };

    LegacyNavigationController.prototype.unmount = function unmount() {
        if (!this.container) {
            return;
        }
        try {
            this.container.removeEventListener('click', this._boundClickHandler);
        } catch (_) { }
        this.container = null;
        this._isMounted = false;
    };

    LegacyNavigationController.prototype.navigate = function navigate(viewName, event) {
        var handler = this.options.onNavigate;
        if (typeof handler === 'function') {
            handler(viewName, event);
            return;
        }

        if (typeof window.showView === 'function') {
            window.showView(viewName);
            return;
        }

        if (window.app && typeof window.app.navigateToView === 'function') {
            window.app.navigateToView(viewName);
        }
    };

    LegacyNavigationController.prototype.syncActive = function syncActive(viewName) {
        if (typeof document === 'undefined') {
            return;
        }
        var selector = this.options.navButtonSelector || '.nav-btn[data-view]';
        var activeClass = this.options.activeClass || 'active';
        var container = this.container || document.querySelector(this.options.containerSelector || '.main-nav');
        if (!container) {
            return;
        }

        var buttons = container.querySelectorAll(selector);
        for (var i = 0; i < buttons.length; i += 1) {
            var button = buttons[i];
            if (!button) {
                continue;
            }
            if (button.classList) {
                button.classList.toggle(activeClass, button.dataset.view === viewName);
            } else if (typeof button.className === 'string') {
                if (button.dataset.view === viewName) {
                    if ((' ' + button.className + ' ').indexOf(' ' + activeClass + ' ') === -1) {
                        button.className += ' ' + activeClass;
                    }
                } else {
                    button.className = button.className.replace(new RegExp('(?:^|\\s)' + activeClass + '(?:$|\\s)', 'g'), ' ').trim();
                }
            }
        }
    };

    LegacyNavigationController.prototype._handleClick = function _handleClick(event) {
        if (!event) {
            return;
        }
        var selector = this.options.navButtonSelector || '.nav-btn[data-view]';
        var target = event.target && event.target.closest ? event.target.closest(selector) : null;
        if (!target || (this.container && !this.container.contains(target))) {
            return;
        }

        var viewName = target.dataset ? target.dataset.view : null;
        if (!viewName) {
            return;
        }

        var activeClass = this.options.activeClass || 'active';
        var alreadyActive = false;
        if (target.classList && target.classList.contains(activeClass)) {
            alreadyActive = true;
        } else if (typeof target.className === 'string') {
            alreadyActive = new RegExp('(?:^|\\s)' + activeClass + '(?:$|\\s)').test(target.className);
        }

        event.preventDefault();
        this.navigate(viewName, event);
        if (alreadyActive && typeof this.options.onRepeatNavigate === 'function') {
            try {
                this.options.onRepeatNavigate(viewName, event);
            } catch (repeatError) {
                console.warn('[LegacyNavigationController] onRepeatNavigate 执行失败', repeatError);
            }
        }
        if (this.options.syncOnNavigate !== false) {
            this.syncActive(viewName);
        }
    };

    var legacyNavigationControllerInstance = null;

    function ensureLegacyNavigationController(options) {
        options = options || {};
        if (!legacyNavigationControllerInstance) {
            legacyNavigationControllerInstance = new LegacyNavigationController(options);
        } else {
            legacyNavigationControllerInstance.updateOptions(options);
        }

        var container = options.container;
        if (!container && options.containerSelector && typeof document !== 'undefined') {
            container = document.querySelector(options.containerSelector);
        }
        legacyNavigationControllerInstance.mount(container);

        if (options.initialView) {
            legacyNavigationControllerInstance.syncActive(options.initialView);
        }

        global.__legacyNavigationController = legacyNavigationControllerInstance;
        return legacyNavigationControllerInstance;
    }

    global.LegacyNavigationController = LegacyNavigationController;
    global.ensureLegacyNavigationController = ensureLegacyNavigationController;

})(typeof window !== "undefined" ? window : globalThis);
