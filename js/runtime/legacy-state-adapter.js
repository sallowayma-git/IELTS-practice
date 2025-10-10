(function (global) {
    'use strict';

    if (!global.AppStateService) {
        return;
    }

    const service = global.AppStateService.getInstance({
        legacyAdapter: global.LegacyStateAdapter ? global.LegacyStateAdapter.getInstance() : null
    });

    function defineProxyProperty(key, getter, setter) {
        let updating = false;
        try {
            Object.defineProperty(global, key, {
                configurable: true,
                enumerable: false,
                get: getter,
                set(value) {
                    if (updating) {
                        return setter(value, true);
                    }
                    updating = true;
                    try {
                        return setter(value, false);
                    } finally {
                        updating = false;
                    }
                }
            });
        } catch (error) {
            console.warn('[LegacyStateAdapter] 无法定义全局代理属性:', key, error);
        }
    }

    defineProxyProperty('examIndex', function () {
        return service.getExamIndex();
    }, function (value, skipLegacy) {
        service.setExamIndex(value, skipLegacy ? { skipLegacy: true } : undefined);
    });

    defineProxyProperty('practiceRecords', function () {
        return service.getPracticeRecords();
    }, function (value, skipLegacy) {
        service.setPracticeRecords(value, skipLegacy ? { skipLegacy: true } : undefined);
    });

    defineProxyProperty('__browseFilter', function () {
        return service.getBrowseFilter();
    }, function (value, skipLegacy) {
        service.setBrowseFilter(value, skipLegacy ? { skipLegacy: true } : undefined);
    });

    if (!global.LegacyStateAdapterBridge) {
        global.LegacyStateAdapterBridge = {};
    }

    global.LegacyStateAdapterBridge.getStateService = function getStateService() {
        return service;
    };
})(typeof window !== 'undefined' ? window : this);
