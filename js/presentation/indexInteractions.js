(function initIndexInteractions(global) {
    'use strict';

    var browsePrefetched = false;
    var morePrefetched = false;
    var settingsPrefetched = false;
    var browsePrefetchPromise = null;
    var morePrefetchPromise = null;
    var settingsPrefetchPromise = null;
    var indexInteractionsInitialized = false;
    var licenseModalInitialized = false;
    var LICENSE_STORAGE_KEY = 'hasSeenGplLicense';

    function ensureBrowse() {
        if (browsePrefetched) {
            return browsePrefetchPromise || Promise.resolve();
        }
        browsePrefetched = true;
        var loader = global.AppEntry && typeof global.AppEntry.ensureBrowseGroup === 'function'
            ? global.AppEntry.ensureBrowseGroup
            : function fallback() { return Promise.resolve(); };
        browsePrefetchPromise = loader().catch(function swallow(error) {
            browsePrefetched = false;
            browsePrefetchPromise = null;
            console.warn('[IndexInteractions] 预加载 browse-view 失败:', error);
        });
        return browsePrefetchPromise;
    }

    function ensureMore() {
        if (morePrefetched) {
            return morePrefetchPromise || Promise.resolve();
        }
        morePrefetched = true;
        var loader = global.AppEntry && typeof global.AppEntry.ensureMoreToolsGroup === 'function'
            ? global.AppEntry.ensureMoreToolsGroup
            : function fallback() { return Promise.resolve(); };
        morePrefetchPromise = loader().catch(function swallow(error) {
            morePrefetched = false;
            morePrefetchPromise = null;
            console.warn('[IndexInteractions] 预加载 more-tools 失败:', error);
        });
        return morePrefetchPromise;
    }

    function ensureSettings() {
        if (settingsPrefetched) {
            return settingsPrefetchPromise || Promise.resolve();
        }
        settingsPrefetched = true;
        var loader = global.AppEntry && typeof global.AppEntry.ensureSettingsToolsGroup === 'function'
            ? global.AppEntry.ensureSettingsToolsGroup
            : function fallback() { return Promise.resolve(); };
        settingsPrefetchPromise = loader().catch(function swallow(error) {
            settingsPrefetched = false;
            settingsPrefetchPromise = null;
            console.warn('[IndexInteractions] 预加载 settings-tools 失败:', error);
        });
        return settingsPrefetchPromise;
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
            ['theme-switcher-btn-entry', function () { return typeof global.showThemeSwitcherModal === 'function' && global.showThemeSwitcherModal(); }],
            ['show-onboarding-btn', function () {
                return global.OnboardingTour && typeof global.OnboardingTour.start === 'function'
                    ? global.OnboardingTour.start(true)
                    : undefined;
            }],
            ['create-backup-btn', function () {
                return ensureSettings().then(function () {
                    return typeof global.createManualBackup === 'function' && global.createManualBackup();
                });
            }],
            ['backup-list-btn', function () {
                return ensureSettings().then(function () {
                    return typeof global.showBackupList === 'function' && global.showBackupList();
                });
            }],
            ['export-data-btn', function () {
                return ensureSettings().then(function () {
                    return typeof global.exportAllData === 'function' && global.exportAllData();
                });
            }],
            ['import-data-btn', function () {
                return ensureSettings().then(function () {
                    return typeof global.importData === 'function' && global.importData();
                });
            }]
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

    function refreshPracticeSummaryDependentLayout() {
        global.setTimeout(function () {
            try {
                global.dispatchEvent(new Event('resize'));
            } catch (_) { }
        }, 680);
    }

    function togglePracticeSummary(target) {
        var practiceView = global.document ? global.document.getElementById('practice-view') : null;
        var region = global.document ? global.document.getElementById('practice-summary-region') : null;
        var button = target || (global.document ? global.document.getElementById('practice-summary-toggle') : null);
        if (!practiceView || !region || !button) {
            return;
        }

        var collapsed = !practiceView.classList.contains('is-practice-summary-collapsed');
        practiceView.classList.toggle('is-practice-summary-collapsed', collapsed);
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        button.setAttribute('aria-label', collapsed ? '展开练习统计卡片' : '折叠练习统计卡片');
        region.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
        region.inert = collapsed;
        if (collapsed && region.contains(global.document.activeElement)) {
            button.focus();
        }
        refreshPracticeSummaryDependentLayout();
    }

    function handleInlineAction(action, target) {
        var value = target && target.dataset ? target.dataset.actionValue : undefined;

        switch (action) {
            case 'open-view':
                if (!value) {
                    return undefined;
                }
                if (value === 'browse') {
                    ensureBrowse();
                } else if (value === 'more') {
                    ensureMore();
                } else if (value === 'settings') {
                    ensureSettings();
                }
                if (typeof global.showView === 'function') {
                    return global.showView(value);
                }
                if (global.app && typeof global.app.navigateToView === 'function') {
                    return global.app.navigateToView(value);
                }
                return undefined;
            case 'filter-exams':
                return typeof global.filterByType === 'function' ? global.filterByType(value || 'all') : undefined;
            case 'filter-frequency':
                return typeof global.filterByFrequency === 'function' ? global.filterByFrequency(value || 'all') : undefined;
            case 'filter-records':
                return typeof global.filterRecordsByType === 'function' ? global.filterRecordsByType(value || 'all') : undefined;
            case 'clear-search':
                return typeof global.clearSearch === 'function' ? global.clearSearch() : undefined;
            case 'export-practice-markdown':
                return global.AppActions && typeof global.AppActions.exportPracticeMarkdown === 'function'
                    ? global.AppActions.exportPracticeMarkdown()
                    : undefined;
            case 'toggle-bulk-delete':
                return typeof global.toggleBulkDelete === 'function' ? global.toggleBulkDelete() : undefined;
            case 'clear-practice-data':
                return typeof global.clearPracticeData === 'function' ? global.clearPracticeData() : undefined;
            case 'toggle-practice-summary':
                return togglePracticeSummary(target);
            case 'show-achievements':
                return typeof global.showAchievements === 'function' ? global.showAchievements() : undefined;
            case 'hide-achievements':
                return typeof global.hideAchievements === 'function' ? global.hideAchievements() : undefined;
            case 'hide-theme-switcher':
                return typeof global.hideThemeSwitcherModal === 'function' ? global.hideThemeSwitcherModal() : undefined;
            case 'switch-bg-theme':
                return typeof global.switchBgTheme === 'function' ? global.switchBgTheme(value) : undefined;
            case 'accept-license':
                return typeof global.acceptGplLicense === 'function' ? global.acceptGplLicense() : undefined;
            default:
                return undefined;
        }
    }

    function setupDeclarativeActions() {
        if (global.__indexDeclarativeActionsInitialized) {
            return;
        }

        document.addEventListener('click', function (event) {
            var target = event.target && event.target.closest
                ? event.target.closest('[data-index-action]')
                : null;
            if (!target) {
                return;
            }
            event.preventDefault();
            handleInlineAction(target.dataset.indexAction, target);
        });

        document.addEventListener('input', function (event) {
            var target = event.target;
            if (!target || !target.dataset || target.dataset.indexAction !== 'search-exams') {
                return;
            }
            if (typeof global.searchExams === 'function') {
                global.searchExams(target.value);
            }
        });

        global.__indexDeclarativeActionsInitialized = true;
    }

    function attachNavPrefetch() {
        var browseBtn = document.querySelector('.main-nav [data-view=\"browse\"]');
        var moreBtn = document.querySelector('.main-nav [data-view=\"more\"]');
        var settingsBtn = document.querySelector('.main-nav [data-view=\"settings\"]');

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

        if (settingsBtn) {
            ['pointerenter', 'focus'].forEach(function (eventName) {
                settingsBtn.addEventListener(eventName, ensureSettings, { once: true });
            });
            settingsBtn.addEventListener('click', ensureSettings);
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

    function setupSegmentedControls() {
        if (global.__segmentedControlsInitialized) return;
        
        function syncIndicator(control) {
            // indicator 可能在 innerHTML='' 后被销毁，必须每次检查重建
            var indicator = control.querySelector('.shui-segmented-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'shui-segmented-indicator';
                control.insertBefore(indicator, control.firstChild);
            }
            
            var activeBtn = control.querySelector('.shui-segmented-btn.active') || control.querySelector('.shui-segmented-btn[aria-pressed="true"]');
            if (activeBtn && activeBtn.offsetWidth > 0) {
                indicator.style.width = activeBtn.offsetWidth + 'px';
                indicator.style.transform = 'translateX(' + activeBtn.offsetLeft + 'px)';
                indicator.style.opacity = '1';
            } else {
                indicator.style.opacity = '0';
            }
        }

        function syncAll() {
            var controls = document.querySelectorAll('.shui-segmented-control');
            for (var i = 0; i < controls.length; i++) {
                syncIndicator(controls[i]);
            }
        }

        // 点击任何 segmented btn 时立即同步
        document.addEventListener('click', function(e) {
            if (e.target && e.target.closest && e.target.closest('.shui-segmented-btn')) {
                setTimeout(syncAll, 10);
                setTimeout(syncAll, 60);
            }
        });

        // 监听 DOM 变更：browseController 重建按钮时 childList 会变更
        var observer = new MutationObserver(function(mutations) {
            var needsSync = false;
            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                var target = mutation.target;
                // childList 变更直接在 segmented-control 容器上
                if (mutation.type === 'childList' && target.classList && target.classList.contains('shui-segmented-control')) {
                    needsSync = true;
                    break;
                }
                // class 属性变更在 segmented-btn 上（active 切换）
                if (mutation.type === 'attributes' && target.classList && target.classList.contains('shui-segmented-btn')) {
                    needsSync = true;
                    break;
                }
                // 向上查找（safety net）
                if (target.closest && target.closest('.shui-segmented-control')) {
                    needsSync = true;
                    break;
                }
            }
            if (needsSync) {
                setTimeout(syncAll, 15);
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        global.addEventListener('resize', syncAll);
        
        // 视图切换时重新同步（view 从 display:none 变为可见后 offsetLeft 才有效）
        document.addEventListener('click', function(e) {
            var navBtn = e.target && e.target.closest && e.target.closest('.hero-nav__btn');
            if (navBtn) {
                // 视图切换动画完成后同步
                setTimeout(syncAll, 50);
                setTimeout(syncAll, 200);
                setTimeout(syncAll, 500);
            }
        });
        
        if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(syncAll);
        }
        
        setTimeout(syncAll, 50);
        setTimeout(syncAll, 300);
        global.__segmentedControlsInitialized = true;
        global.updateSegmentedIndicators = syncAll;
    }

    function getLicenseModal() {
        return global.document ? global.document.getElementById('license-modal') : null;
    }

    function hasAcceptedLicense() {
        try {
            return global.localStorage && global.localStorage.getItem(LICENSE_STORAGE_KEY) === 'true';
        } catch (_) {
            return true;
        }
    }

    function showLicenseModal() {
        var modal = getLicenseModal();
        if (!modal) {
            return;
        }
        global.requestAnimationFrame(function () {
            global.requestAnimationFrame(function () {
                modal.classList.add('show');
            });
        });
    }

    function hideLicenseModal() {
        var modal = getLicenseModal();
        if (modal) {
            modal.classList.remove('show');
        }
    }

    function acceptGplLicense() {
        try {
            if (global.localStorage) {
                global.localStorage.setItem(LICENSE_STORAGE_KEY, 'true');
            }
        } catch (error) {
            console.warn('LocalStorage error:', error);
        }
        hideLicenseModal();
    }

    function initLicenseModal() {
        if (licenseModalInitialized) {
            return;
        }
        licenseModalInitialized = true;
        if (!hasAcceptedLicense()) {
            showLicenseModal();
        }
    }

    global.LicenseModal = Object.assign({}, global.LicenseModal || {}, {
        init: initLicenseModal,
        show: showLicenseModal,
        hide: hideLicenseModal,
        accept: acceptGplLicense,
        hasAccepted: hasAcceptedLicense
    });
    global.acceptGplLicense = acceptGplLicense;

    function initializeIndexInteractions() {
        setupIndexSettingsButtons();
        setupQuickLaneInteractions();
        setupDeclarativeActions();
        setupSegmentedControls();
    }

    function init() {
        if (indexInteractionsInitialized) {
            return;
        }
        indexInteractionsInitialized = true;
        attachNavPrefetch();
        setupHeroNavLiquidIndicator();
        initializeIndexInteractions();
        initLicenseModal();
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
