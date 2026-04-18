(function initIndexInteractions(global) {
    'use strict';

    var browsePrefetched = false;
    var morePrefetched = false;
    var indexInteractionsInitialized = false;

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

    function startListeningSprint() {
        var list = typeof global.getExamIndexState === 'function' ? global.getExamIndexState() : [];
        var listeningExams = Array.isArray(list) ? list.filter(function (exam) { return exam && exam.type === 'listening'; }) : [];
        if (!listeningExams.length) {
            if (typeof global.showMessage === 'function') {
                global.showMessage('听力题库尚未加载', 'error');
            }
            return;
        }

        var selected = listeningExams[Math.floor(Math.random() * listeningExams.length)];
        if (typeof global.showMessage === 'function') {
            global.showMessage('听力随机冲刺: ' + selected.title, 'info');
        }

        if (typeof global.openExamWithFallback === 'function') {
            global.openExamWithFallback(selected);
        }
    }

    function startInstantLaunch() {
        var list = typeof global.getExamIndexState === 'function' ? global.getExamIndexState() : [];
        if (!Array.isArray(list) || !list.length) {
            if (typeof global.showMessage === 'function') {
                global.showMessage('题库尚未加载', 'error');
            }
            return;
        }

        var htmlPreferred = list.filter(function (exam) { return exam && exam.hasHtml; });
        var pool = htmlPreferred.length ? htmlPreferred : list;
        var selected = pool[Math.floor(Math.random() * pool.length)];

        if (typeof global.showMessage === 'function') {
            global.showMessage('即刻开局: ' + selected.title, 'info');
        }

        if (typeof global.openExamWithFallback === 'function') {
            global.openExamWithFallback(selected);
        }
    }

    function handleQuickLaneAction(target) {
        if (!target || !target.dataset) {
            return;
        }

        var action = target.dataset.laneAction;
        if (!action) {
            return;
        }

        switch (action) {
            case 'browse':
                (function () {
                    var laneCategory = target.dataset.laneCategory || 'all';
                    var laneType = target.dataset.laneType || 'all';

                    if (typeof global.browseCategory === 'function') {
                        global.browseCategory(laneCategory, laneType);
                        return;
                    }

                    if (global.app && typeof global.app.navigateToView === 'function') {
                        global.app.navigateToView('browse');
                    } else if (typeof global.showView === 'function') {
                        global.showView('browse', false);
                    }

                    if (typeof global.applyBrowseFilter === 'function') {
                        global.applyBrowseFilter(laneCategory, laneType);
                    } else if (laneType !== 'all' && typeof global.filterByType === 'function') {
                        setTimeout(function () { global.filterByType(laneType); }, 0);
                    }
                })();
                break;
            case 'listening-sprint':
                startListeningSprint();
                break;
            case 'instant-start':
                startInstantLaunch();
                break;
            case 'sync-library':
                if (typeof global.loadLibrary === 'function') {
                    global.loadLibrary();
                } else if (typeof global.showMessage === 'function') {
                    global.showMessage('题库加载模块未就绪', 'error');
                }
                break;
            case 'vocab-spark':
                if (typeof global.launchMiniGame === 'function') {
                    global.launchMiniGame('vocab-spark');
                }
                break;
            default:
                break;
        }
    }

    function setupQuickLaneInteractions() {
        document.addEventListener('click', function (event) {
            var laneButton = event.target.closest('[data-lane-action]');
            if (laneButton) {
                event.preventDefault();
                handleQuickLaneAction(laneButton);
                return;
            }

            var laneTrigger = event.target.closest('[data-action="launch-mini-game"]');
            if (laneTrigger) {
                event.preventDefault();
                if (typeof global.launchMiniGame === 'function') {
                    global.launchMiniGame(laneTrigger.dataset.game);
                }
            }
        });
    }

    function setupIndexSettingsButtons() {
        var bindings = [
            ['clear-cache-btn', function () { return typeof global.clearCache === 'function' && global.clearCache(); }],
            ['load-library-btn', function () {
                if (typeof global.showLibraryLoaderModal === 'function') {
                    global.showLibraryLoaderModal();
                } else if (typeof global.loadLibrary === 'function') {
                    global.loadLibrary(false);
                }
            }],
            ['library-config-btn', function () { return typeof global.showLibraryConfigListV2 === 'function' && global.showLibraryConfigListV2(); }],
            ['force-refresh-btn', function () {
                var notify = function (type, msg) {
                    if (typeof global.showMessage === 'function') {
                        global.showMessage(msg, type);
                    }
                };

                notify('info', '正在强制刷新题库...');

                if (typeof global.loadLibrary === 'function') {
                    try {
                        global.__forceLibraryRefreshInProgress = true;
                        var result = global.loadLibrary(true);
                        if (result && typeof result.then === 'function') {
                            result.then(function () {
                                if (global.__forceLibraryRefreshInProgress) {
                                    notify('success', '题库刷新完成');
                                    global.__forceLibraryRefreshInProgress = false;
                                }
                            }).catch(function (error) {
                                notify('error', '题库刷新失败: ' + (error && error.message || error));
                                global.__forceLibraryRefreshInProgress = false;
                            });
                        } else {
                            setTimeout(function () {
                                if (global.__forceLibraryRefreshInProgress) {
                                    notify('success', '题库刷新完成');
                                    global.__forceLibraryRefreshInProgress = false;
                                }
                            }, 800);
                        }
                    } catch (error) {
                        notify('error', '题库刷新失败: ' + (error && error.message || error));
                        global.__forceLibraryRefreshInProgress = false;
                    }
                }
            }],
            ['create-backup-btn', function () { return typeof global.createManualBackup === 'function' && global.createManualBackup(); }],
            ['backup-list-btn', function () { return typeof global.showBackupList === 'function' && global.showBackupList(); }],
            ['export-data-btn', function () { return typeof global.exportAllData === 'function' && global.exportAllData(); }],
            ['import-data-btn', function () { return typeof global.importData === 'function' && global.importData(); }]
        ];

        bindings.forEach(function (pair) {
            var id = pair[0];
            var handler = pair[1];
            var button = document.getElementById(id);
            if (button && typeof handler === 'function') {
                button.addEventListener('click', function (event) {
                    event.preventDefault();
                    handler();
                });
            }
        });
    }

    function attachNavPrefetch() {
        var browseBtn = document.querySelector('.main-nav [data-view=\"browse\"]');
        var moreBtn = document.querySelector('.main-nav [data-view=\"more\"]');

        if (browseBtn) {
            ['pointerenter', 'focus'].forEach(function (eventName) {
                browseBtn.addEventListener(eventName, ensureBrowse, { once: true });
            });
            browseBtn.addEventListener('click', ensureBrowse);
        }

        if (moreBtn) {
            ['pointerenter', 'focus'].forEach(function (eventName) {
                moreBtn.addEventListener(eventName, ensureMore, { once: true });
            });
            moreBtn.addEventListener('click', ensureMore);
        }
    }

    function getActiveHeroNavButton(nav) {
        if (!nav) {
            return null;
        }
        var active = nav.querySelector('.hero-nav__btn.active');
        if (active) {
            return active;
        }
        return nav.querySelector('.hero-nav__btn');
    }

    function getHeroNavIndicatorRect(nav, btn) {
        if (!nav || !btn || !btn.getBoundingClientRect) {
            return null;
        }

        var navRect = nav.getBoundingClientRect();
        var btnRect = btn.getBoundingClientRect();
        if (!btnRect || btnRect.width <= 0 || btnRect.height <= 0) {
            return null;
        }

        var inset = 3;
        return {
            left: Math.max(0, btnRect.left - navRect.left + inset),
            top: Math.max(0, btnRect.top - navRect.top + inset),
            width: Math.max(16, btnRect.width - inset * 2),
            height: Math.max(16, btnRect.height - inset * 2)
        };
    }

    function applyHeroNavIndicatorRect(indicator, rect) {
        if (!indicator || !rect) {
            return;
        }
        indicator.style.left = rect.left + 'px';
        indicator.style.top = rect.top + 'px';
        indicator.style.width = rect.width + 'px';
        indicator.style.height = rect.height + 'px';
    }

    function animateHeroNavIndicator(state, targetRect, immediate) {
        if (!state || !state.indicator || !targetRect) {
            return;
        }

        var indicator = state.indicator;
        
        // 如果需要瞬间完成（例如窗口 Resize），则临时关闭过渡动画
        var shouldReduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (immediate || shouldReduceMotion) {
            indicator.style.transition = 'none';
        } else {
            indicator.style.transition = ''; // 恢复 CSS 文件中定义的弹簧过渡动画
        }

        applyHeroNavIndicatorRect(indicator, targetRect);
        
        // 强制浏览器重排以便 none 立即生效后再恢复
        if (immediate || shouldReduceMotion) {
            void indicator.offsetWidth;
            indicator.style.transition = '';
        }

        state.lastRect = targetRect;
        state.ready = true;
    }

    function setupHeroNavLiquidIndicator() {
        if (global.__heroNavLiquidInitialized) {
            return;
        }

        var nav = document.querySelector('.hero-nav');
        if (!nav) {
            return;
        }

        var indicator = nav.querySelector('.hero-nav__liquid-indicator');
        if (!indicator) {
            indicator = document.createElement('span');
            indicator.className = 'hero-nav__liquid-indicator';
            nav.insertBefore(indicator, nav.firstChild);
        }

        var state = {
            nav: nav,
            indicator: indicator,
            lastRect: null,
            ready: false,
            animation: null
        };

        var sync = function (immediate) {
            var activeBtn = getActiveHeroNavButton(nav);
            var targetRect = getHeroNavIndicatorRect(nav, activeBtn);
            if (!targetRect) {
                return;
            }
            animateHeroNavIndicator(state, targetRect, !!immediate);
            nav.classList.add('hero-nav--liquid-ready');
        };

        var resizeToken = 0;
        var scheduleSync = function (immediate) {
            if (resizeToken) {
                global.cancelAnimationFrame(resizeToken);
            }
            resizeToken = global.requestAnimationFrame(function () {
                resizeToken = 0;
                sync(immediate);
            });
        };

        nav.addEventListener('click', function (event) {
            if (!event.target || !event.target.closest('.hero-nav__btn')) {
                return;
            }
            scheduleSync(false);
        });

        var observer = new MutationObserver(function (mutations) {
            var shouldSync = false;
            for (var i = 0; i < mutations.length; i += 1) {
                var mutation = mutations[i];
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    shouldSync = true;
                    break;
                }
            }
            if (shouldSync) {
                scheduleSync(false);
            }
        });
        observer.observe(nav, {
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        global.addEventListener('resize', function () {
            scheduleSync(true);
        });

        if (document.fonts && typeof document.fonts.ready === 'object' && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(function () {
                scheduleSync(true);
            });
        }

        scheduleSync(true);
        global.__heroNavLiquidInitialized = true;
    }

    function initializeIndexInteractions() {
        setupIndexSettingsButtons();
        setupQuickLaneInteractions();
    }

    function init() {
        if (indexInteractionsInitialized) {
            return;
        }
        indexInteractionsInitialized = true;
        attachNavPrefetch();
        setupHeroNavLiquidIndicator();
        initializeIndexInteractions();
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
