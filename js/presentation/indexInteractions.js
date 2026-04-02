(function initIndexInteractions(global) {
    'use strict';

    var initialized = false;
    var browsePrefetched = false;
    var morePrefetched = false;

    function invokeGlobal(name) {
        var fn = global[name];
        if (typeof fn !== 'function') {
            return;
        }
        var args = Array.prototype.slice.call(arguments, 1);
        return fn.apply(global, args);
    }

    function prevent(event) {
        if (event) {
            event.preventDefault();
        }
    }

    function callAction(name, datasetKey, fallbackValue) {
        return function (target, event) {
            prevent(event);
            if (!datasetKey) {
                return invokeGlobal(name);
            }
            return invokeGlobal(name, target.dataset[datasetKey] || fallbackValue);
        };
    }

    function notify(type, message) {
        if (typeof global.showMessage === 'function') {
            global.showMessage(message, type);
        }
    }

    function ensureBrowse() {
        if (browsePrefetched) {
            return;
        }
        browsePrefetched = true;
        var loader = global.AppEntry && typeof global.AppEntry.ensureBrowseGroup === 'function'
            ? global.AppEntry.ensureBrowseGroup
            : function fallback() { return Promise.resolve(); };
        loader().catch(function swallow(error) {
            console.warn('[IndexInteractions] 预加载 browse-view 失败:', error);
        });
    }

    function ensureMore() {
        if (morePrefetched) {
            return;
        }
        morePrefetched = true;
        var loader = global.AppEntry && typeof global.AppEntry.ensureMoreToolsGroup === 'function'
            ? global.AppEntry.ensureMoreToolsGroup
            : function fallback() { return Promise.resolve(); };
        loader().catch(function swallow(error) {
            console.warn('[IndexInteractions] 预加载 more-tools 失败:', error);
        });
    }

    function finishForceRefresh(type, message) {
        if (!global.__forceLibraryRefreshInProgress) {
            return;
        }
        global.__forceLibraryRefreshInProgress = false;
        notify(type, message);
    }

    function forceRefreshLibrary() {
        if (typeof global.loadLibrary !== 'function') {
            return;
        }
        notify('info', '正在强制刷新题库...');
        try {
            global.__forceLibraryRefreshInProgress = true;
            var result = global.loadLibrary(true);
            if (result && typeof result.then === 'function') {
                result.then(function () {
                    finishForceRefresh('success', '题库刷新完成');
                }).catch(function (error) {
                    finishForceRefresh('error', '题库刷新失败: ' + (error && error.message || error));
                });
                return;
            }
            setTimeout(function () {
                finishForceRefresh('success', '题库刷新完成');
            }, 800);
        } catch (error) {
            finishForceRefresh('error', '题库刷新失败: ' + (error && error.message || error));
        }
    }

    function launchOnboarding(_, event) {
        prevent(event);
        if (global.OnboardingTour && typeof global.OnboardingTour.start === 'function') {
            global.OnboardingTour.start(true);
        }
    }

    function loadLibraryAction(_, event) {
        prevent(event);
        if (typeof global.showLibraryLoaderModal === 'function') {
            global.showLibraryLoaderModal();
            return;
        }
        if (typeof global.loadLibrary === 'function') {
            global.loadLibrary(false);
        }
    }

    function exportPracticeMarkdown(_, event) {
        prevent(event);
        if (global.AppActions && typeof global.AppActions.exportPracticeMarkdown === 'function') {
            global.AppActions.exportPracticeMarkdown();
        }
    }

    function navigateThemePortal(target, event) {
        prevent(event);
        if (typeof global.navigateToThemePortal !== 'function') {
            return;
        }
        var options = {};
        if (target.dataset.themeLabel) {
            options.label = target.dataset.themeLabel;
        }
        if (target.dataset.themeName) {
            options.theme = target.dataset.themeName;
        }
        global.navigateToThemePortal(target.dataset.themeUrl || '', options);
    }

    var actionHandlers = {
        'show-developer-team': callAction('showDeveloperTeam'),
        'hide-developer-team': callAction('hideDeveloperTeam'),
        'show-theme-switcher': callAction('showThemeSwitcherModal'),
        'hide-theme-switcher': callAction('hideThemeSwitcherModal'),
        'show-achievements': callAction('showAchievements'),
        'hide-achievements': callAction('hideAchievements'),
        'filter-exam-type': callAction('filterByType', 'filterType', 'all'),
        'filter-record-type': callAction('filterRecordsByType', 'filterType', 'all'),
        'clear-exam-search': callAction('clearSearch'),
        'clear-history-search': callAction('clearPracticeHistorySearch'),
        'toggle-bulk-delete': callAction('toggleBulkDelete'),
        'clear-practice-data': callAction('clearPracticeData'),
        'toggle-bloom-theme': callAction('toggleBloomDarkMode'),
        'apply-theme': callAction('applyTheme', 'theme', 'default'),
        'clear-cache': callAction('clearCache'),
        'library-config': callAction('showLibraryConfigListV2'),
        'create-backup': callAction('createManualBackup'),
        'backup-list': callAction('showBackupList'),
        'export-data': callAction('exportAllData'),
        'import-data': callAction('importData'),
        'show-onboarding': launchOnboarding,
        'load-library': loadLibraryAction,
        'force-refresh': function (_, event) {
            prevent(event);
            forceRefreshLibrary();
        },
        'export-practice-markdown': exportPracticeMarkdown,
        'navigate-theme-portal': navigateThemePortal
    };

    var inputHandlers = {
        'search-exams': function (target) {
            invokeGlobal('searchExams', target.value || '');
        },
        'search-practice-history': function (target) {
            invokeGlobal('searchPracticeHistory', target.value || '');
        }
    };

    function attachPrefetch(button, handler) {
        if (!button) {
            return;
        }
        ['pointerenter', 'focus'].forEach(function (eventName) {
            button.addEventListener(eventName, handler, { once: true });
        });
        button.addEventListener('click', handler);
    }

    function attachNavPrefetch() {
        attachPrefetch(document.querySelector('.main-nav [data-view=\"browse\"]'), ensureBrowse);
        attachPrefetch(document.querySelector('.main-nav [data-view=\"more\"]'), ensureMore);
    }

    function handleClick(event) {
        var target = event.target.closest('[data-action]');
        if (!target) {
            return;
        }
        var handler = actionHandlers[target.dataset.action];
        if (typeof handler === 'function') {
            handler(target, event);
        }
    }

    function handleInput(event) {
        var target = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('[data-input-action]')
            : null;
        if (!target || (target.dataset.inputEvent && target.dataset.inputEvent !== event.type)) {
            return;
        }
        var handler = inputHandlers[target.dataset.inputAction];
        if (typeof handler === 'function') {
            handler(target, event);
        }
    }

    function init() {
        if (initialized) {
            return;
        }
        initialized = true;
        attachNavPrefetch();
        document.addEventListener('click', handleClick);
        document.addEventListener('input', handleInput);
        document.addEventListener('keyup', handleInput);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.ensureIndexInteractions = function ensureIndexInteractions() {
        init();
    };
})(typeof window !== 'undefined' ? window : this);
