(function bootstrapApp(global) {
    'use strict';

    function ensureLazyGroup(name) {
        if (!name || !global.AppLazyLoader || typeof global.AppLazyLoader.ensureGroup !== 'function') {
            return Promise.resolve();
        }
        return global.AppLazyLoader.ensureGroup(name);
    }

    var browseGroupPromise = null;

    function ensureBrowseGroup() {
        if (!browseGroupPromise) {
            browseGroupPromise = ensureLazyGroup('browse-view');
        }
        return browseGroupPromise;
    }

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
                if (typeof fn === 'function') {
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
    if (typeof global.normalizeRecordId !== 'function') {
        global.normalizeRecordId = function normalizeRecordId(id) {
            return id == null ? '' : String(id);
        };
    }

    if (typeof global.reportBootStage !== 'function') {
        global.reportBootStage = function reportBootStage(message, progress) {
            if (global.AppBootScreen && typeof global.AppBootScreen.setStage === 'function') {
                try {
                    global.AppBootScreen.setStage(message, progress);
                } catch (error) {
                    console.warn('[BootStage] 更新失败:', error);
                }
            }
        };
    }

    if (typeof global.ensureExamDataScripts !== 'function') {
        global.ensureExamDataScripts = function ensureExamDataScripts() {
            return ensureLazyGroup('exam-data');
        };
    }

    if (typeof global.ensurePracticeSuiteReady !== 'function') {
        global.ensurePracticeSuiteReady = function ensurePracticeSuiteReady() {
            if (global.AppActions && typeof global.AppActions.ensurePracticeSuite === 'function') {
                return global.AppActions.ensurePracticeSuite();
            }
            return ensureLazyGroup('practice-suite');
        };
    }

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
    if (typeof global.loadExamList !== 'function') {
        global.loadExamList = proxyAfterGroup('browse-view', function () {
            return global.__legacyLoadExamList || global.loadExamList;
        });
    }

    if (typeof global.resetBrowseViewToAll !== 'function') {
        global.resetBrowseViewToAll = proxyAfterGroup('browse-view', function () {
            return global.__legacyResetBrowseViewToAll || global.resetBrowseViewToAll;
        });
    }

    ensureGlobalFunctionAfterGroup('showLibraryLoaderModal', 'browse-view', function () {
        if (typeof global.showMessage === 'function') {
            global.showMessage('题库管理模块未就绪', 'warning');
        }
    });

    ensureGlobalFunctionAfterGroup('showThemeSwitcherModal', 'theme-tools', function () {
        if (typeof global.showMessage === 'function') {
            global.showMessage('主题切换模块未就绪', 'warning');
        }
    });

    // 懒加载代理（more 组/小游戏）
    if (typeof global.launchMiniGame !== 'function') {
        global.launchMiniGame = proxyAfterGroup('more-tools', function () {
            return global.__legacyLaunchMiniGame || global.launchMiniGame;
        }, function fallback(gameId) {
            if (typeof global.showMessage === 'function') {
                global.showMessage('小游戏模块未就绪', 'info');
            }
            return gameId;
        });
    }

    function handleExamIndexLoaded() {
        ensureBrowseGroup().then(function afterBrowseReady() {
            if (typeof global.loadExamList === 'function') {
                try { global.loadExamList(); } catch (_) { }
            }
            var loading = document.querySelector('#browse-view .loading');
            if (loading) {
                loading.style.display = 'none';
            }
            if (global.AppBootScreen && typeof global.AppBootScreen.complete === 'function') {
                global.AppBootScreen.complete();
            }
        }).catch(function handleBrowseLoadError(error) {
            console.error('[MainEntry] browse-view 组加载失败:', error);
        });
    }

    global.addEventListener('examIndexLoaded', function onExamIndexLoaded() {
        handleExamIndexLoaded();
    });

    function init() {
        setStorageNamespace();
        initializeNavigationShell();
        // 确保练习套件在 file:// 等环境下也预加载，避免懒加载失败导致记录丢失
        if (global.AppActions && typeof global.AppActions.preloadPracticeSuite === 'function') {
            try {
                global.AppActions.preloadPracticeSuite();
            } catch (_) { }
        } else {
            ensureLazyGroup('practice-suite').catch(function preloadPracticeSuiteError(err) {
                console.warn('[MainEntry] 预加载 practice-suite 失败:', err);
            });
        }
        // 预拉题库脚本，避免后续 loadLibrary 阻塞
        ensureExamData().catch(function preloadExamError(error) {
            console.warn('[MainEntry] 预加载 exam-data 失败:', error);
        });
        // 预先加载 browse 组，确保 loadLibrary 等遗留逻辑可用
        ensureBrowseGroup().catch(function preloadError(error) {
            console.warn('[MainEntry] 预加载 browse-view 失败:', error);
        });
        // 尝试闲时预加载更多工具
        if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(function () {
                ensureMoreToolsGroup().catch(function swallow(err) {
                    console.warn('[MainEntry] 预加载 more-tools 失败:', err);
                });
            }, { timeout: 5000 });
        } else {
            setTimeout(function () {
                ensureMoreToolsGroup().catch(function swallow(err) {
                    console.warn('[MainEntry] 预加载 more-tools 失败:', err);
                });
            }, 5000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.AppEntry = Object.assign({}, global.AppEntry || {}, {
        ensureBrowseGroup: ensureBrowseGroup,
        ensureMoreToolsGroup: ensureMoreToolsGroup,
        browseReady: function () { return browseGroupPromise || ensureBrowseGroup(); },
        examDataReady: ensureExamData
    });
})(typeof window !== 'undefined' ? window : this);
