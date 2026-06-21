(function (global) {
    'use strict';

    function summarizeNavigationControllerErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        const status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

    function ensureNavigation(options) {
        if (typeof global.ensureLegacyNavigationController !== 'function') {
            return null;
        }

        const mergedOptions = Object.assign({
            containerSelector: '.main-nav',
            activeClass: 'active',
            syncOnNavigate: true,
            onNavigate: function onNavigate(viewName) {
                if (typeof global.showView === 'function') {
                    global.showView(viewName);
                    return;
                }
                if (global.app && typeof global.app.navigateToView === 'function') {
                    global.app.navigateToView(viewName);
                }
            }
        }, options || {});

        try {
            return global.ensureLegacyNavigationController(mergedOptions);
        } catch (error) {
            console.warn('[NavigationController] initialization failed:', summarizeNavigationControllerErrorForLog(error));
            return null;
        }
    }

    if (!global.NavigationController) {
        global.NavigationController = {};
    }

    global.NavigationController.ensure = ensureNavigation;
})(typeof window !== 'undefined' ? window : this);
