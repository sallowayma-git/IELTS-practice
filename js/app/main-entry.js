(function bootstrapApp(global) {
    'use strict';

    var STRICT_ON_DEMAND = true;
    var BROWSE_GROUP = 'browse-runtime';
    var PRACTICE_GROUP = 'practice-suite';
    var SESSION_GROUP = 'session-suite';
    var STATE_CORE_GROUP = 'state-core';
    var SETTINGS_GROUP = 'settings-tools';
    var READING_CANDIDATE_CODE_PATTERN = /^\d{6}$/;
    var readingCandidateCodeCache = { mode: 'auto', customCode: '' };
    var readingCandidateCodeReady = null;

    function ensureLazyGroup(name) {
        if (!name || !global.AppLazyLoader || typeof global.AppLazyLoader.ensureGroup !== 'function') {
            return Promise.resolve();
        }
        return global.AppLazyLoader.ensureGroup(name);
    }

    function hashReadingCandidateCode(sourceId) {
        var source = String(sourceId || '');
        if (!source) {
            return '';
        }
        var hash = 0;
        for (var index = 0; index < source.length; index += 1) {
            hash = ((hash << 5) - hash) + source.charCodeAt(index);
            hash |= 0;
        }
        return String(Math.abs(hash) % 900000 + 100000);
    }

    function createReadingCandidateCodeSeed() {
        var parts = [String(Date.now()), String(Math.random())];
        try {
            if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
                var values = new Uint32Array(4);
                global.crypto.getRandomValues(values);
                parts.push(Array.prototype.join.call(values, ':'));
            }
        } catch (_) { }
        try {
            parts.push(String(global.navigator && global.navigator.userAgent || ''));
        } catch (_) { }
        return parts.join(':');
    }

    function readReadingCandidateCodePreferences() {
        return Object.assign({}, readingCandidateCodeCache);
    }

    function loadReadingCandidateCodePreferences() {
        if (readingCandidateCodeReady) return readingCandidateCodeReady;
        readingCandidateCodeReady = Promise.resolve().then(async function loadCandidateCode() {
            await global.AppData.ready;
            var stored = await global.AppData.preferences.getCandidateCode();
            var mode = stored && stored.mode === 'custom' ? 'custom' : 'auto';
            var customCode = stored && typeof stored.customCode === 'string' ? stored.customCode.replace(/\D/g, '').slice(0, 6) : '';
            readingCandidateCodeCache = { mode: mode, customCode: READING_CANDIDATE_CODE_PATTERN.test(customCode) ? customCode : '' };
            return readingCandidateCodeCache;
        });
        return readingCandidateCodeReady;
    }

    async function saveReadingCandidateCodePreferences(preferences) {
        await loadReadingCandidateCodePreferences();
        var next = {
            mode: preferences && preferences.mode === 'custom' ? 'custom' : 'auto',
            customCode: preferences && typeof preferences.customCode === 'string'
                ? preferences.customCode.replace(/\D/g, '').slice(0, 6)
                : ''
        };
        await global.AppData.preferences.setCandidateCode(next);
        readingCandidateCodeCache = next;
        return next;
    }

    function setReadingCandidateCodeStatus(element, message, state) {
        if (!element) {
            return;
        }
        element.textContent = message || '';
        if (state) {
            element.dataset.state = state;
        } else {
            delete element.dataset.state;
        }
    }

    async function setupReadingCandidateCodeSettings() {
        await loadReadingCandidateCodePreferences();
        var input = document.getElementById('reading-candidate-code-input');
        var saveButton = document.getElementById('reading-candidate-code-save-btn');
        var randomButton = document.getElementById('reading-candidate-code-random-btn');
        var status = document.getElementById('reading-candidate-code-status');
        var modeInputs = Array.prototype.slice.call(
            document.querySelectorAll('input[name="reading-candidate-code-mode"]')
        );
        if (!input || !saveButton || !randomButton || !modeInputs.length) {
            return;
        }

        function getSelectedMode() {
            var selected = modeInputs.find(function findChecked(item) { return item.checked; });
            return selected && selected.value === 'custom' ? 'custom' : 'auto';
        }

        function setSelectedMode(mode) {
            modeInputs.forEach(function syncMode(item) {
                item.checked = item.value === mode;
            });
            input.disabled = mode !== 'custom';
        }

        function syncFromStorage() {
            var preferences = readReadingCandidateCodePreferences();
            setSelectedMode(preferences.mode);
            input.value = preferences.customCode || '';
            setReadingCandidateCodeStatus(
                status,
                preferences.mode === 'custom' && preferences.customCode
                    ? '当前使用自定义编码：' + preferences.customCode
                    : '当前使用自动生成：按练习会话生成 6 位编码。',
                ''
            );
        }

        modeInputs.forEach(function bindMode(item) {
            item.addEventListener('change', function onModeChange() {
                var mode = getSelectedMode();
                input.disabled = mode !== 'custom';
                if (mode === 'custom') {
                    input.focus();
                }
            });
        });

        input.addEventListener('input', function sanitizeCandidateCodeInput() {
            var cleaned = input.value.replace(/\D/g, '').slice(0, 6);
            if (input.value !== cleaned) {
                input.value = cleaned;
            }
            setReadingCandidateCodeStatus(status, '', '');
        });

        saveButton.addEventListener('click', async function saveCandidateCodeSettings() {
            var mode = getSelectedMode();
            var code = input.value.replace(/\D/g, '').slice(0, 6);
            if (mode === 'custom' && !READING_CANDIDATE_CODE_PATTERN.test(code)) {
                setReadingCandidateCodeStatus(status, '请输入 6 位数字编码。', 'error');
                input.focus();
                return;
            }
            await saveReadingCandidateCodePreferences({ mode: mode, customCode: code });
            setReadingCandidateCodeStatus(
                status,
                mode === 'custom' ? '已保存自定义编码：' + code : '已保存：自动生成。',
                'success'
            );
        });

        randomButton.addEventListener('click', async function generateCandidateCode() {
            var code = hashReadingCandidateCode(createReadingCandidateCodeSeed());
            setSelectedMode('custom');
            input.value = code;
            await saveReadingCandidateCodePreferences({ mode: 'custom', customCode: code });
            setReadingCandidateCodeStatus(status, '已随机生成并保存：' + code, 'success');
        });

        syncFromStorage();
    }

    function setPracticeTimerStatus(element, message, state) {
        if (!element) {
            return;
        }
        element.textContent = message || '';
        if (state) {
            element.dataset.state = state;
        } else {
            delete element.dataset.state;
        }
    }

    async function setupPracticeTimerSettings() {
        var manager = global.PracticeTimerPreferences;
        if (!manager || typeof manager.read !== 'function' || typeof manager.save !== 'function') {
            return;
        }

        if (manager.ready) await manager.ready;
        Array.prototype.slice.call(document.querySelectorAll('.practice-timer-card[data-timer-scope]'))
            .forEach(function bindTimerCard(card) {
                var scope = String(card.dataset.timerScope || '').toLowerCase() === 'listening'
                    ? 'listening'
                    : 'reading';
                var status = card.querySelector('.practice-timer-status');
                var saveButton = card.querySelector('[data-timer-save]');
                var fields = {
                    mode: card.querySelector('[data-timer-field="mode"]'),
                    countdownMinutes: card.querySelector('[data-timer-field="countdownMinutes"]'),
                    limitEnabled: card.querySelector('[data-timer-field="limitEnabled"]'),
                    limitMinutes: card.querySelector('[data-timer-field="limitMinutes"]'),
                    expiryAction: card.querySelector('[data-timer-field="expiryAction"]')
                };
                if (!saveButton || !fields.mode || !fields.countdownMinutes || !fields.limitEnabled || !fields.limitMinutes || !fields.expiryAction) {
                    return;
                }

                function syncLimitState() {
                    fields.limitMinutes.disabled = !fields.limitEnabled.checked;
                }

                function apply(preferences) {
                    var normalized = manager.normalize(preferences);
                    fields.mode.value = normalized.mode;
                    fields.countdownMinutes.value = String(normalized.countdownMinutes);
                    fields.limitEnabled.checked = Boolean(normalized.limitEnabled);
                    fields.limitMinutes.value = String(normalized.limitMinutes);
                    fields.expiryAction.value = normalized.expiryAction;
                    syncLimitState();
                    setPracticeTimerStatus(status, '已保存', '');
                }

                function collect() {
                    return manager.normalize({
                        mode: fields.mode.value,
                        countdownMinutes: fields.countdownMinutes.value,
                        limitEnabled: fields.limitEnabled.checked,
                        limitMinutes: fields.limitMinutes.value,
                        expiryAction: fields.expiryAction.value
                    });
                }

                fields.limitEnabled.addEventListener('change', function onLimitToggle() {
                    syncLimitState();
                    setPracticeTimerStatus(status, '', '');
                });
                [fields.mode, fields.countdownMinutes, fields.limitMinutes, fields.expiryAction].forEach(function bindField(field) {
                    field.addEventListener('input', function clearTimerStatus() {
                        setPracticeTimerStatus(status, '', '');
                    });
                    field.addEventListener('change', function clearTimerStatus() {
                        setPracticeTimerStatus(status, '', '');
                    });
                });
                saveButton.addEventListener('click', async function saveTimerPreferences() {
                    try {
                        var saved = await manager.save(scope, collect());
                        apply(saved);
                        setPracticeTimerStatus(status, '已保存', 'success');
                    } catch (error) {
                        setPracticeTimerStatus(status, '保存失败', 'error');
                    }
                });

                apply(manager.read(scope));
            });
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
    if (typeof global.ensureBrowseGroup !== 'function') {
        global.ensureBrowseGroup = ensureBrowseGroup;
    }
    if (typeof global.ensureSessionSuiteReady !== 'function') {
        global.ensureSessionSuiteReady = ensureSessionSuiteReady;
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

    function ensureSettingsToolsGroup() {
        return ensureLazyGroup(SETTINGS_GROUP);
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
            return ensurePracticeSuiteGroup();
        };
    }

    function ensureGlobalFunctionAfterGroup(name, group, fallback) {
        if (typeof global[name] === 'function' && global[name].__legacyPublicAPIBootstrapShim !== true) {
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
        proxy.__legacyPublicAPIBootstrapShim = true;
        global[name] = proxy;
    }

    function installLegacyGlobalFallback() {
        var doc = global.document || null;
        var groupByName = {
            switchLibraryConfig: STATE_CORE_GROUP,
            loadLibrary: STATE_CORE_GROUP,
            showThemeSwitcherModal: 'theme-tools',
            showAchievements: 'more-tools',
            hideAchievements: 'more-tools'
        };

        function message(text, type) {
            if (typeof global.showMessage === 'function') {
                global.showMessage(text, type || 'warning');
            }
        }

        function getLibraryManager() {
            if (global.LibraryManager && typeof global.LibraryManager.getInstance === 'function') {
                return global.LibraryManager.getInstance();
            }
            return global.LibraryManager || null;
        }

        function getSearchInput() {
            if (!doc) {
                return null;
            }
            return doc.getElementById('exam-search-input') || doc.querySelector('.search-input');
        }

        var fallbacks = {
            switchLibraryConfig: function (key) {
                var manager = getLibraryManager();
                return manager && typeof manager.switchLibraryConfig === 'function'
                    ? manager.switchLibraryConfig(key)
                    : undefined;
            },
            loadLibrary: function (keyOrForceReload) {
                var manager = getLibraryManager();
                return manager && typeof manager.loadLibrary === 'function'
                    ? manager.loadLibrary(keyOrForceReload)
                    : undefined;
            },
            showLibraryLoaderModal: function () { message('题库管理模块未就绪'); },
            showThemeSwitcherModal: function () { message('主题切换模块未就绪'); },
            filterByType: function () { message('题库筛选模块未就绪'); },
            filterByFrequency: function () { message('题库筛选模块未就绪'); },
            filterRecordsByType: function () { message('练习筛选模块未就绪'); },
            openExam: function (examId, options) {
                if (global.app && typeof global.app.openExam === 'function') {
                    return global.app.openExam(examId, options);
                }
                message('题目模块未就绪');
                return undefined;
            },
            viewPDF: function (examId) {
                if (global.app && typeof global.app.viewPDF === 'function') {
                    return global.app.viewPDF(examId);
                }
                message('PDF 模块未就绪');
                return examId;
            },
            searchExams: function (query) {
                var input = getSearchInput();
                if (input && typeof query === 'string') {
                    input.value = query;
                }
                return query;
            },
            clearSearch: function () {
                var input = getSearchInput();
                var clearButton = doc && doc.getElementById('search-clear-btn');
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
            },
            toggleBulkDelete: function () { message('批量删除模块未就绪'); },
            clearPracticeData: function () { message('练习数据模块未就绪'); },
            showAchievements: function () { message('成就模块未就绪'); },
            hideAchievements: function () { },
            browseCategory: function (category, type, filterMode, path) {
                if (global.app && typeof global.app.browseCategory === 'function') {
                    return global.app.browseCategory(category, type, filterMode, path);
                }
                if (typeof global.showView === 'function') {
                    global.showView('browse', false);
                }
                return undefined;
            }
        };

        Object.keys(fallbacks).forEach(function install(name) {
            ensureGlobalFunctionAfterGroup(name, groupByName[name] || BROWSE_GROUP, fallbacks[name]);
        });

        if (typeof global.launchMiniGame !== 'function' || global.launchMiniGame.__legacyPublicAPIBootstrapShim === true) {
            global.launchMiniGame = proxyAfterGroup('more-tools', function () {
                return global.__legacyLaunchMiniGame || global.launchMiniGame;
            }, function fallback(gameId) {
                if (typeof global.showMessage === 'function') {
                    global.showMessage('小游戏模块未就绪', 'info');
                }
                return gameId;
            });
        }
    }

    // 懒加载代理（browse 组）
    if (typeof global.loadExamList !== 'function') {
        global.loadExamList = proxyAfterGroup(BROWSE_GROUP, function () {
            return global.__legacyLoadExamList || global.loadExamList;
        });
    }

    if (typeof global.resetBrowseViewToAll !== 'function') {
        global.resetBrowseViewToAll = proxyAfterGroup(BROWSE_GROUP, function () {
            return global.__legacyResetBrowseViewToAll || global.resetBrowseViewToAll;
        });
    }

    installLegacyGlobalFallback();

    function getActiveViewName() {
        var active = document.querySelector('.view.active');
        if (!active || !active.id) {
            return '';
        }
        return active.id.replace(/-view$/, '');
    }

    function syncOverviewAfterIndexLoad(index) {
        var list = Array.isArray(index) ? index : [];
        if (!Array.isArray(list)) {
            return;
        }
        try {
            if (typeof global.updateOverview === 'function') {
                global.updateOverview(list);
            }
        } catch (error) {
            console.warn('[MainEntry] 同步总览数据失败:', error);
        }
    }

    function handleExamIndexLoaded(index) {
        var snapshot = Array.isArray(index) ? index : [];
        syncOverviewAfterIndexLoad(snapshot);
        var activeView = getActiveViewName();

        if (activeView === 'browse') {
            ensureBrowseGroup().then(function afterBrowseReady() {
                if (typeof global.loadExamList === 'function') {
                    try { global.loadExamList(snapshot); } catch (_) { }
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
                if (typeof global.startPracticeRecordsSyncInBackground === 'function') {
                    global.startPracticeRecordsSyncInBackground('exam-index-loaded', { forceRender: true });
                }
            }).catch(function handlePracticeLoadError(error) {
                console.error('[MainEntry] practice 视图模块加载失败:', error);
            });
        }
    }

    global.addEventListener('examIndexLoaded', function onExamIndexLoaded(event) {
        handleExamIndexLoaded(event && event.detail ? event.detail.index : []);
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
        initializeNavigationShell();
        setupReadingCandidateCodeSettings();
        setupPracticeTimerSettings();

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
        ensureSettingsToolsGroup: ensureSettingsToolsGroup,
        ensurePracticeSuiteGroup: ensurePracticeSuiteGroup,
        ensureStateCoreGroup: ensureStateCoreGroup,
        ensureSessionSuiteReady: ensureSessionSuiteReady,
        browseReady: function () { return browseGroupPromise || ensureBrowseGroup(); },
        examDataReady: ensureExamData
    });
})(typeof window !== 'undefined' ? window : this);
