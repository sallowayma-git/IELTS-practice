(function initExamActionProxies(global) {
    'use strict';

    function ensureBrowse() {
        if (global.AppEntry && typeof global.AppEntry.ensureBrowseGroup === 'function') {
            return global.AppEntry.ensureBrowseGroup();
        }
        if (global.AppLazyLoader && typeof global.AppLazyLoader.ensureGroup === 'function') {
            return global.AppLazyLoader.ensureGroup('browse-view');
        }
        return Promise.resolve();
    }

    function createProxy(targetName) {
        return function proxy() {
            var args = Array.prototype.slice.call(arguments);
            return ensureBrowse().then(function () {
                var impl = global['__legacy' + targetName] || global[targetName];
                if (impl && impl !== proxy && typeof impl === 'function') {
                    return impl.apply(global, args);
                }
                return undefined;
            });
        };
    }

    if (typeof global.loadExamList !== 'function') {
        global.loadExamList = createProxy('LoadExamList');
    }

    if (typeof global.resetBrowseViewToAll !== 'function') {
        global.resetBrowseViewToAll = createProxy('ResetBrowseViewToAll');
    }
})(typeof window !== 'undefined' ? window : this);
