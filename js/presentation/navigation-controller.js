(function (global) {
    'use strict';

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
            console.warn('[NavigationController] 初始化失败:', error);
            return null;
        }
    }

    if (!global.NavigationController) {
        global.NavigationController = {};
    }

    global.NavigationController.ensure = ensureNavigation;
})(typeof window !== 'undefined' ? window : this);
