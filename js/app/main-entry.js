(function bootstrapApp(global) {
    'use strict';

    var STRICT_ON_DEMAND = true;
    var BROWSE_GROUP = 'browse-runtime';
    var PRACTICE_GROUP = 'practice-suite';
    var SESSION_GROUP = 'session-suite';
    var STATE_CORE_GROUP = 'state-core';

    function ensureLazyGroup(name) {
        if (!name || !global.AppLazyLoader || typeof global.AppLazyLoader.ensureGroup !== 'function') {
            return Promise.resolve();
        }
        return global.AppLazyLoader.ensureGroup(name);
    }

    function setGlobalFunctionIfAbsent(name, fn) {
        if (typeof global[name] !== 'function') {
            global[name] = fn;
        }
    }

    function showNotReady(message, type) {
        if (typeof global.showMessage === 'function') {
            global.showMessage(message, type || 'warning');
        }
    }

    var browseGroupPromise = null;
    var stateCorePromise = null;
    var sessionSuitePromise = null;
    var coreBootstrapStarted = false;

    function reapplyAppMixins() {
        if (global.ExamSystemAppMixins && typeof global.ExamSystemAppMixins.__applyToApp === 'function') {
            try {
                global.ExamSystemAppMixins.__applyToApp();
            } catch (error) {
                console.warn('[MainEntry] 重新应用 mixins 失败:', error);
            }
        }
    }

    function ensureBrowseGroup() {
        if (!browseGroupPromise) {
            browseGroupPromise = ensureLazyGroup(BROWSE_GROUP).then(function onBrowseLoaded() {
                reapplyAppMixins();
                if (typeof global.setupBrowsePreferenceUI === 'function') {
                    try {
                        global.setupBrowsePreferenceUI();
                    } catch (error) {
                        console.warn('[MainEntry] 初始化题库偏好 UI 失败:', error);
                    }
                }
                return true;
            }).catch(function onBrowseLoadError(error) {
                browseGroupPromise = null;
                throw error;
            });
        }
        return browseGroupPromise;
    }

    function ensureStateCoreGroup() {
        if (!stateCorePromise) {
            stateCorePromise = ensureLazyGroup(STATE_CORE_GROUP);
        }
        return stateCorePromise;
    }

    function ensurePracticeSuiteGroup() {
        return ensureLazyGroup(PRACTICE_GROUP);
    }

    function ensureSessionSuiteReady() {
        if (!sessionSuitePromise) {
            sessionSuitePromise = Promise.all([
                ensurePracticeSuiteGroup(),
                ensureLazyGroup(SESSION_GROUP)
            ]).then(function afterSuiteLoaded() {
                reapplyAppMixins();
                return true;
            }).catch(function onSuiteFailed(error) {
                sessionSuitePromise = null;
                throw error;
            });
        }
        return sessionSuitePromise;
    }

    // 向后兼容：提供 window.ensureBrowseGroup，避免 main.js 注入垃圾 shim 警告
    setGlobalFunctionIfAbsent('ensureBrowseGroup', ensureBrowseGroup);
    setGlobalFunctionIfAbsent('ensureSessionSuiteReady', ensureSessionSuiteReady);

    function ensureExamData() {
        if (typeof global.ensureExamDataScripts === 'function') {
            return global.ensureExamDataScripts();
        }
        return ensureLazyGroup('exam-data');
    }

    function ensureMoreToolsGroup() {
        return ensureLazyGroup('more-tools');
    }

    function ensureThemeToolsGroup() {
        return ensureLazyGroup('theme-tools');
    }

    function setStorageNamespace() {
        if (!global.storage || !global.storage.ready || typeof global.storage.setNamespace !== 'function') {
            return;
        }
        global.storage.ready.then(function applyNamespace() {
            global.storage.setNamespace('exam_system');
            try {
                console.log('[MainEntry] 已设置存储命名空间: exam_system');
            } catch (_) { }
        }).catch(function handleNamespaceError(error) {
            console.error('[MainEntry] 设置命名空间失败', error);
        });
    }

    function initializeNavigationShell() {
        try {
            if (global.NavigationController && typeof global.NavigationController.ensure === 'function') {
                global.NavigationController.ensure({
                    containerSelector: '.main-nav',
                    activeClass: 'active',
                    initialView: 'overview',
                    syncOnNavigate: true,
                    onRepeatNavigate: function onRepeatNavigate(viewName) {
                        if (viewName === 'browse' && typeof global.resetBrowseViewToAll === 'function') {
                            global.resetBrowseViewToAll();
                        }
                    },
                    onNavigate: function onNavigate(viewName) {
                        if (typeof global.showView === 'function') {
                            global.showView(viewName);
                            return;
                        }
                        if (global.app && typeof global.app.navigateToView === 'function') {
                            global.app.navigateToView(viewName);
                        }
                    }
                });
            }
        } catch (error) {
            console.warn('[MainEntry] 初始化导航失败:', error);
        }
    }

    function proxyAfterGroup(groupName, getter, fallback) {
        return function proxiedCall() {
            var args = Array.prototype.slice.call(arguments);
            return ensureLazyGroup(groupName).then(function invoke() {
                var fn = getter();
                if (typeof fn === 'function' && fn !== proxiedCall) {
                    return fn.apply(global, args);
                }
                if (typeof fallback === 'function') {
                    return fallback.apply(global, args);
                }
                return undefined;
            });
        };
    }

    // 保持对外接口
    setGlobalFunctionIfAbsent('normalizeRecordId', function normalizeRecordId(id) {
        return id == null ? '' : String(id);
    });

    setGlobalFunctionIfAbsent('reportBootStage', function reportBootStage(message, progress) {
        if (global.AppBootScreen && typeof global.AppBootScreen.setStage === 'function') {
            try {
                global.AppBootScreen.setStage(message, progress);
            } catch (error) {
                console.warn('[BootStage] 更新失败:', error);
            }
        }
    });

    setGlobalFunctionIfAbsent('ensureExamDataScripts', function ensureExamDataScripts() {
        return ensureLazyGroup('exam-data');
    });

    setGlobalFunctionIfAbsent('ensurePracticeSuiteReady', function ensurePracticeSuiteReady() {
        if (global.AppActions && typeof global.AppActions.ensurePracticeSuite === 'function') {
            return global.AppActions.ensurePracticeSuite();
        }
        return ensurePracticeSuiteGroup();
    });

    function ensureGlobalFunctionAfterGroup(name, group, fallback) {
        if (typeof global[name] === 'function') {
            return;
        }
        var proxy = function lazyProxy() {
            var args = Array.prototype.slice.call(arguments);
            return ensureLazyGroup(group).then(function () {
                var fn = global[name];
                if (typeof fn === 'function' && fn !== proxy) {
                    return fn.apply(global, args);
                }
                if (typeof fallback === 'function') {
                    return fallback.apply(global, args);
                }
                return undefined;
            });
        };
        global[name] = proxy;
    }

    // 懒加载代理（browse 组）
    setGlobalFunctionIfAbsent('loadExamList', proxyAfterGroup(BROWSE_GROUP, function () {
        return global.__legacyLoadExamList || global.loadExamList;
    }));

    setGlobalFunctionIfAbsent('resetBrowseViewToAll', proxyAfterGroup(BROWSE_GROUP, function () {
        return global.__legacyResetBrowseViewToAll || global.resetBrowseViewToAll;
    }));

    [
        ['showLibraryLoaderModal', BROWSE_GROUP, '题库管理模块未就绪'],
        ['showThemeSwitcherModal', 'theme-tools', '主题切换模块未就绪'],
        ['filterByType', BROWSE_GROUP, '题库筛选模块未就绪'],
        ['filterRecordsByType', BROWSE_GROUP, '练习筛选模块未就绪'],
        ['toggleBulkDelete', BROWSE_GROUP, '批量删除模块未就绪'],
        ['clearPracticeData', BROWSE_GROUP, '练习数据模块未就绪'],
        ['showAchievements', 'more-tools', '成就模块未就绪'],
        ['hideAchievements', 'more-tools', null]
    ].forEach(function registerLazyContract(item) {
        var name = item[0];
        var group = item[1];
        var message = item[2];
        ensureGlobalFunctionAfterGroup(name, group, function () {
            if (message) {
                showNotReady(message);
            }
        });
    });

    ensureGlobalFunctionAfterGroup('openExam', BROWSE_GROUP, function (examId, options) {
        if (global.app && typeof global.app.openExam === 'function') {
            return global.app.openExam(examId, options);
        }
        showNotReady('题目模块未就绪');
        return undefined;
    });

    ensureGlobalFunctionAfterGroup('viewPDF', BROWSE_GROUP, function (examId) {
        showNotReady('PDF 模块未就绪');
        return examId;
    });

    ensureGlobalFunctionAfterGroup('searchExams', BROWSE_GROUP, function (query) {
        var input = document.getElementById('exam-search-input') || document.querySelector('.search-input');
        if (input && typeof query === 'string') {
            input.value = query;
        }
        return query;
    });

    ensureGlobalFunctionAfterGroup('clearSearch', BROWSE_GROUP, function () {
        var input = document.getElementById('exam-search-input') || document.querySelector('.search-input');
        var clearButton = document.getElementById('search-clear-btn');
        if (input) {
            input.value = '';
        }
        if (clearButton) {
            clearButton.hidden = true;
        }
        if (typeof global.searchExams === 'function') {
            return global.searchExams('');
        }
        return undefined;
    });

    ensureGlobalFunctionAfterGroup('browseCategory', BROWSE_GROUP, function (category, type, filterMode, path) {
        if (global.app && typeof global.app.browseCategory === 'function') {
            return global.app.browseCategory(category, type, filterMode, path);
        }
        if (typeof global.showView === 'function') {
            global.showView('browse', false);
        }
        return undefined;
    });

    // 懒加载代理（more 组/小游戏）
    setGlobalFunctionIfAbsent('launchMiniGame', proxyAfterGroup('more-tools', function () {
        return global.__legacyLaunchMiniGame || global.launchMiniGame;
    }, function fallback(gameId) {
        showNotReady('小游戏模块未就绪', 'info');
        return gameId;
    }));

    function getActiveViewName() {
        var active = document.querySelector('.view.active');
        if (!active || !active.id) {
            return '';
        }
        return active.id.replace(/-view$/, '');
    }

    function syncOverviewAfterIndexLoad() {
        if (!global.app || typeof global.app.setState !== 'function') {
            return;
        }
        if (typeof global.getExamIndexState !== 'function') {
            return;
        }
        var list = global.getExamIndexState();
        if (!Array.isArray(list)) {
            return;
        }
        try {
            global.app.setState('exam.index', list.slice());
            if (typeof global.app.refreshOverviewData === 'function') {
                global.app.refreshOverviewData();
            }
        } catch (error) {
            console.warn('[MainEntry] 同步总览数据失败:', error);
        }
    }

    function handleExamIndexLoaded() {
        syncOverviewAfterIndexLoad();
        var activeView = getActiveViewName();

        if (activeView === 'browse') {
            ensureBrowseGroup().then(function afterBrowseReady() {
                if (typeof global.loadExamList === 'function') {
                    try { global.loadExamList(); } catch (_) { }
                }
                var loading = document.querySelector('#browse-view .loading');
                if (loading) {
                    loading.style.display = 'none';
                }
            }).catch(function handleBrowseLoadError(error) {
                console.error('[MainEntry] browse-runtime 组加载失败:', error);
            });
            return;
        }

        if (activeView === 'practice') {
            Promise.all([ensureBrowseGroup(), ensurePracticeSuiteGroup()]).then(function onPracticeReady() {
                if (typeof global.updatePracticeView === 'function') {
                    try { global.updatePracticeView(); } catch (_) { }
                }
            }).catch(function handlePracticeLoadError(error) {
                console.error('[MainEntry] practice 视图模块加载失败:', error);
            });
        }
    }

    global.addEventListener('examIndexLoaded', function onExamIndexLoaded() {
        handleExamIndexLoaded();
    });

    global.addEventListener('appCoreReady', function onAppCoreReady() {
        if (global.AppBootScreen && typeof global.AppBootScreen.complete === 'function') {
            global.AppBootScreen.complete();
        }
    });

    function bootstrapCoreDataInBackground() {
        if (coreBootstrapStarted) {
            return;
        }
        coreBootstrapStarted = true;

        Promise.resolve()
            .then(function () {
                return ensureStateCoreGroup();
            })
            .then(function () {
                if (global.LibraryManager && typeof global.LibraryManager.getInstance === 'function') {
                    return global.LibraryManager.getInstance().loadActiveLibrary(false);
                }
                return ensureExamData();
            })
            .catch(function onBackgroundBootstrapError(error) {
                console.warn('[MainEntry] 后台题库引导失败:', error);
            });
    }

    function init() {
        setStorageNamespace();
        initializeNavigationShell();

        if (STRICT_ON_DEMAND) {
            setTimeout(function () {
                bootstrapCoreDataInBackground();
            }, 0);
            return;
        }

        bootstrapCoreDataInBackground();
        ensurePracticeSuiteGroup().catch(function preloadPracticeSuiteError(err) {
            console.warn('[MainEntry] 预加载 practice-suite 失败:', err);
        });
        ensureBrowseGroup().catch(function preloadError(error) {
            console.warn('[MainEntry] 预加载 browse-runtime 失败:', error);
        });
        if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(function () {
                ensureMoreToolsGroup().catch(function swallow(err) {
                    console.warn('[MainEntry] 预加载 more-tools 失败:', err);
                });
            }, { timeout: 5000 });
        }

        // 初始化引导流程（在页面初始化完成后）
        if (typeof global.OnboardingTour !== 'undefined') {
            global.OnboardingTour.init();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.AppEntry = Object.assign({}, global.AppEntry || {}, {
        STRICT_ON_DEMAND: STRICT_ON_DEMAND,
        ensureBrowseGroup: ensureBrowseGroup,
        ensureBrowseRuntime: ensureBrowseGroup,
        ensureMoreToolsGroup: ensureMoreToolsGroup,
        ensurePracticeSuiteGroup: ensurePracticeSuiteGroup,
        ensureStateCoreGroup: ensureStateCoreGroup,
        ensureSessionSuiteReady: ensureSessionSuiteReady,
        browseReady: function () { return browseGroupPromise || ensureBrowseGroup(); },
        examDataReady: ensureExamData
    });
})(typeof window !== 'undefined' ? window : this);
