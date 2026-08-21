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

    var browseRuntimePromise = null;
    var browseGroupPromise = null;
    var browseResetIntentGeneration = 0;
    var activeBrowseResetIntent = null;
    var browseResultsProxyGeneration = 0;
    var appNavigationIntentGeneration = 0;
    var examIndexRefreshGeneration = 0;
    var deferredBrowseIndexRefresh = null;
    var browseFunctionalResetBarrier = null;
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

    function ensureBrowseStateManager() {
        if (global.browseStateManager) {
            return global.browseStateManager;
        }
        if (typeof global.BrowseStateManager !== 'function') {
            return null;
        }
        try {
            return new global.BrowseStateManager();
        } catch (error) {
            console.warn('[MainEntry] 初始化浏览状态管理器失败:', error);
            return null;
        }
    }

    function registerBrowseFunctionalResetBarrier(resetPromise) {
        var barrier = Promise.resolve(resetPromise).catch(function () {
            return false;
        });
        browseFunctionalResetBarrier = barrier;
        barrier.finally(function clearBrowseFunctionalResetBarrier() {
            if (browseFunctionalResetBarrier === barrier) {
                browseFunctionalResetBarrier = null;
            }
        });
        return barrier;
    }

    function synchronizeActiveBrowseViewNow() {
        if (getActiveViewName() !== 'browse' || typeof global.initializeBrowseView !== 'function') {
            return Promise.resolve();
        }

        var pendingFilter = global.__pendingBrowseFilter || null;
        var canApplyPendingFilter = !!pendingFilter && typeof global.applyBrowseFilter === 'function';
        var initialization;
        var initializationRequestId = null;
        try {
            // Start synchronization in this reaction so a queued repeat reset can
            // acquire the next latest-wins token immediately after it.
            initialization = global.initializeBrowseView({ skipLoad: canApplyPendingFilter });
            if (typeof global.__getBrowseResultsRequestId === 'function') {
                initializationRequestId = global.__getBrowseResultsRequestId();
            }
        } catch (error) {
            return Promise.reject(error);
        }
        return Promise.resolve(initialization)
            .then(function applyPendingBrowseFilter() {
                if (!canApplyPendingFilter || global.__pendingBrowseFilter !== pendingFilter) {
                    return undefined;
                }
                var filterArgs = [
                    pendingFilter.category,
                    pendingFilter.type,
                    pendingFilter.filterMode,
                    pendingFilter.path
                ];
                if (initializationRequestId != null) {
                    filterArgs.push(initializationRequestId);
                }
                return global.applyBrowseFilter.apply(global, filterArgs);
            })
            .finally(function clearConsumedPendingBrowseFilter() {
                if (pendingFilter && global.__pendingBrowseFilter === pendingFilter) {
                    delete global.__pendingBrowseFilter;
                }
            });
    }

    function synchronizeActiveBrowseViewAfterLoad() {
        var resetBarrier = browseFunctionalResetBarrier;
        if (!resetBarrier) {
            return synchronizeActiveBrowseViewNow().then(function () {
                return true;
            });
        }
        return Promise.resolve(resetBarrier).then(function afterFunctionalReset(resetSucceeded) {
            if (!resetSucceeded) {
                return false;
            }
            return synchronizeActiveBrowseViewNow().then(function () {
                return true;
            });
        });
    }

    function ensureBrowseRuntimeGroup() {
        if (!browseRuntimePromise) {
            browseRuntimePromise = ensureLazyGroup(BROWSE_GROUP).catch(function onBrowseRuntimeLoadError(error) {
                browseRuntimePromise = null;
                throw error;
            });
        }
        return browseRuntimePromise;
    }

    function ensureBrowseGroup() {
        if (!browseGroupPromise) {
            browseGroupPromise = ensureBrowseRuntimeGroup().then(function onBrowseLoaded() {
                reapplyAppMixins();
                initializeNavigationShell();
                ensureBrowseStateManager();
                if (typeof global.setupBrowsePreferenceUI === 'function') {
                    try {
                        global.setupBrowsePreferenceUI();
                    } catch (error) {
                        console.warn('[MainEntry] 初始化题库偏好 UI 失败:', error);
                    }
                }
                return synchronizeActiveBrowseViewAfterLoad()
                    .catch(function onBrowseViewSyncError(error) {
                        console.warn('[MainEntry] 恢复题库视图状态失败:', error);
                        return true;
                    })
                    .then(function browseViewSynchronized(synchronized) {
                        if (synchronized === false) {
                            browseGroupPromise = null;
                            return false;
                        }
                        return true;
                    });
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

    function markAppNavigationIntent(event) {
        if (event && event.__appEntryNavigationIntentTracked === true) {
            return appNavigationIntentGeneration;
        }
        appNavigationIntentGeneration += 1;
        if (event) {
            try {
                event.__appEntryNavigationIntentTracked = true;
            } catch (_) { }
        }
        return appNavigationIntentGeneration;
    }

    global.__markAppNavigationIntent = markAppNavigationIntent;
    global.__getAppNavigationIntentGeneration = function getAppNavigationIntentGeneration() {
        return appNavigationIntentGeneration;
    };

    function initializeNavigationShell() {
        var controller = null;
        try {
            if (global.NavigationController && typeof global.NavigationController.ensure === 'function') {
                controller = global.NavigationController.ensure({
                    containerSelector: '.main-nav',
                    activeClass: 'active',
                    initialView: getActiveViewName() || 'overview',
                    syncOnNavigate: true,
                    onRepeatNavigate: function onRepeatNavigate(viewName) {
                        if (viewName === 'browse' && typeof global.resetBrowseViewToAll === 'function') {
                            return global.resetBrowseViewToAll();
                        }
                        return false;
                    },
                    onNavigate: function onNavigate(viewName, event) {
                        markAppNavigationIntent(event);
                        if (typeof global.showView === 'function') {
                            global.showView(viewName, false);
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
        if (controller && typeof document !== 'undefined') {
            var navRoot = document.querySelector('.main-nav');
            var fallbackHandler = navRoot && navRoot._legacyNavHandler;
            if (typeof fallbackHandler === 'function' && typeof navRoot.removeEventListener === 'function') {
                navRoot.removeEventListener('click', fallbackHandler);
                try {
                    delete navRoot._legacyNavHandler;
                } catch (_) {
                    navRoot._legacyNavHandler = null;
                }
            }
        }
        return controller;
    }

    function beginBrowseResetIntent() {
        browseResetIntentGeneration += 1;
        browseResultsProxyGeneration += 1;
        activeBrowseResetIntent = {
            __browseResetIntent: true,
            generation: browseResetIntentGeneration,
            examIndexSnapshot: null,
            examIndexSnapshotVersion: 0,
            resultsRequestId: null
        };
        return activeBrowseResetIntent;
    }

    function isBrowseResetIntentCurrent(intent) {
        return activeBrowseResetIntent === intent
            && !!intent
            && intent.__browseResetIntent === true
            && intent.generation === browseResetIntentGeneration;
    }

    function captureBrowseResetIndexSnapshot(index) {
        if (!isBrowseResetIntentInFlight()) {
            return false;
        }
        activeBrowseResetIntent.examIndexSnapshot = Array.isArray(index)
            ? index.slice()
            : [];
        activeBrowseResetIntent.examIndexSnapshotVersion += 1;
        return true;
    }

    function getBrowseResetIndexSnapshot(intent) {
        if (!isBrowseResetIntentCurrent(intent)
            || !isBrowseResetIntentInFlight()
            || intent.examIndexSnapshotVersion < 1) {
            return null;
        }
        return {
            index: intent.examIndexSnapshot.slice(),
            version: intent.examIndexSnapshotVersion
        };
    }

    function endBrowseResetIntent(intent) {
        if (activeBrowseResetIntent === intent) {
            var shouldReplaySnapshot = isBrowseResetIntentInFlight()
                && intent.examIndexSnapshotVersion > 0;
            var snapshot = shouldReplaySnapshot
                ? intent.examIndexSnapshot.slice()
                : null;
            var resultsRequestId = intent.resultsRequestId;
            activeBrowseResetIntent = null;
            if (snapshot) {
                handleExamIndexLoaded(snapshot, resultsRequestId);
            }
        }
    }

    function closeBrowseResetIntent(intent, consumedSnapshotVersion) {
        if (activeBrowseResetIntent !== intent) {
            return { closed: true, snapshot: null };
        }
        if (!isBrowseResetIntentInFlight()) {
            activeBrowseResetIntent = null;
            return { closed: true, snapshot: null };
        }
        var consumedVersion = Number(consumedSnapshotVersion) || 0;
        if (intent.examIndexSnapshotVersion > consumedVersion) {
            return {
                closed: false,
                snapshot: {
                    index: intent.examIndexSnapshot.slice(),
                    version: intent.examIndexSnapshotVersion
                }
            };
        }
        activeBrowseResetIntent = null;
        return { closed: true, snapshot: null };
    }

    function setBrowseResetResultsRequest(intent, requestId) {
        if (!isBrowseResetIntentCurrent(intent)) {
            return false;
        }
        intent.resultsRequestId = requestId;
        return true;
    }

    function isBrowseResetIntentInFlight() {
        if (!activeBrowseResetIntent) {
            return false;
        }
        var requestId = activeBrowseResetIntent.resultsRequestId;
        return requestId == null
            || typeof global.__isBrowseResultsRequestCurrent !== 'function'
            || global.__isBrowseResultsRequestCurrent(requestId);
    }

    global.__beginBrowseResetIntent = beginBrowseResetIntent;
    global.__isBrowseResetIntentCurrent = isBrowseResetIntentCurrent;
    global.__captureBrowseResetIndexSnapshot = captureBrowseResetIndexSnapshot;
    global.__getBrowseResetIndexSnapshot = getBrowseResetIndexSnapshot;
    global.__setBrowseResetResultsRequest = setBrowseResetResultsRequest;
    global.__closeBrowseResetIntent = closeBrowseResetIntent;
    global.__endBrowseResetIntent = endBrowseResetIntent;
    global.__isBrowseResetIntentInFlight = isBrowseResetIntentInFlight;

    function beginBrowseResultsProxyIntent() {
        browseResultsProxyGeneration += 1;
        return browseResultsProxyGeneration;
    }

    function captureBrowseResultsRequest() {
        return ensureBrowseRuntimeGroup().then(function captureRequestId() {
            return typeof global.__getBrowseResultsRequestId === 'function'
                ? global.__getBrowseResultsRequestId()
                : null;
        });
    }

    function getCurrentBrowseResultsRequest() {
        return typeof global.__getBrowseResultsRequestId === 'function'
            ? global.__getBrowseResultsRequestId()
            : null;
    }

    function isBrowseResultsSnapshotCurrent(requestId) {
        return requestId == null
            || typeof global.__isBrowseResultsRequestCurrent !== 'function'
            || global.__isBrowseResultsRequestCurrent(requestId);
    }

    function isBrowseUserResultsRequestInFlight(requestId) {
        return requestId != null
            && typeof global.__isBrowseUserResultsRequestInFlight === 'function'
            && global.__isBrowseUserResultsRequestInFlight(requestId);
    }

    function isBrowseUserResultsRequest(requestId) {
        return requestId != null
            && typeof global.__isBrowseUserResultsRequest === 'function'
            && global.__isBrowseUserResultsRequest(requestId);
    }

    function deferBrowseIndexRefresh(snapshot, refreshGeneration, proxyGeneration, navigationGeneration) {
        deferredBrowseIndexRefresh = {
            snapshot: Array.isArray(snapshot) ? snapshot.slice() : [],
            refreshGeneration: refreshGeneration,
            proxyGeneration: proxyGeneration,
            navigationGeneration: navigationGeneration
        };
    }

    function replayDeferredBrowseIndexRefresh(settledRequestId) {
        var deferred = deferredBrowseIndexRefresh;
        if (!deferred) {
            return;
        }
        if (deferred.refreshGeneration !== examIndexRefreshGeneration
            || deferred.proxyGeneration !== browseResultsProxyGeneration
            || deferred.navigationGeneration !== appNavigationIntentGeneration
            || getActiveViewName() !== 'browse') {
            deferredBrowseIndexRefresh = null;
            return;
        }
        var currentRequestId = getCurrentBrowseResultsRequest();
        if (isBrowseUserResultsRequestInFlight(currentRequestId)) {
            return;
        }
        if (currentRequestId !== settledRequestId) {
            deferredBrowseIndexRefresh = null;
            return;
        }
        deferredBrowseIndexRefresh = null;
        handleExamIndexLoaded(deferred.snapshot, currentRequestId);
    }

    function proxyAfterGroup(groupName, getter, fallback) {
        return function proxiedCall() {
            var args = Array.prototype.slice.call(arguments);
            var resultsProxyGeneration = groupName === BROWSE_GROUP
                ? beginBrowseResultsProxyIntent()
                : null;
            var resetGeneration = groupName === BROWSE_GROUP
                ? browseResetIntentGeneration
                : null;
            var groupReady = groupName === BROWSE_GROUP
                ? ensureBrowseGroup()
                : ensureLazyGroup(groupName);
            var resultsRequest = groupName === BROWSE_GROUP
                ? captureBrowseResultsRequest()
                : Promise.resolve(null);
            var resultsRequestId = null;
            var resultsRequestCaptured = false;
            if (groupName === BROWSE_GROUP) {
                resultsRequest.then(function rememberRequestId(requestId) {
                    resultsRequestId = requestId;
                    resultsRequestCaptured = true;
                }).catch(function ignoreRequestCaptureError() {
                    resultsRequestCaptured = true;
                });
            }
            return groupReady.then(function invoke(groupSucceeded) {
                if (groupName === BROWSE_GROUP && groupSucceeded === false) {
                    return false;
                }
                if (groupName === BROWSE_GROUP && resetGeneration !== browseResetIntentGeneration) {
                    return false;
                }
                if (groupName === BROWSE_GROUP
                    && (resultsProxyGeneration !== browseResultsProxyGeneration
                        || !isBrowseResultsSnapshotCurrent(
                            resultsRequestCaptured ? resultsRequestId : getCurrentBrowseResultsRequest()
                        ))) {
                    return false;
                }
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

    function proxyAfterBrowseRuntime(getter, fallback) {
        var proxy = function proxiedBrowseRuntimeCall() {
            var args = Array.prototype.slice.call(arguments);
            var resetIntent = beginBrowseResetIntent();
            // Start the full handoff, but let repeat reset acquire its latest-wins
            // token as soon as the raw runtime is available instead of waiting for
            // an older initializeBrowseView synchronization to finish.
            ensureBrowseGroup().catch(function swallowBrowseHandoffError() {});
            return ensureBrowseRuntimeGroup().then(function invoke() {
                if (!isBrowseResetIntentCurrent(resetIntent)) {
                    return false;
                }
                var fn = getter();
                if (typeof fn === 'function' && fn !== proxy) {
                    return fn.apply(global, args.concat([resetIntent]));
                }
                if (typeof fallback === 'function') {
                    return fallback.apply(global, args);
                }
                return undefined;
            }).finally(function finishBrowseResetIntent() {
                endBrowseResetIntent(resetIntent);
            });
        };
        return proxy;
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
            var activeViewAtRequest = name === 'browseCategory'
                ? getActiveViewName()
                : null;
            var navigationIntentAtRequest = name === 'browseCategory'
                ? appNavigationIntentGeneration
                : null;
            var tracksBrowseResults = group === BROWSE_GROUP && (
                name === 'filterByType'
                || name === 'filterByFrequency'
                || name === 'searchExams'
                || name === 'clearSearch'
                || name === 'browseCategory'
            );
            var resultsProxyGeneration = tracksBrowseResults
                ? beginBrowseResultsProxyIntent()
                : null;
            var resetGeneration = group === BROWSE_GROUP
                ? browseResetIntentGeneration
                : null;
            var groupReady = group === BROWSE_GROUP
                ? ensureBrowseGroup()
                : ensureLazyGroup(group);
            var resultsRequest = tracksBrowseResults
                ? captureBrowseResultsRequest()
                : Promise.resolve(null);
            var resultsRequestId = null;
            var resultsRequestCaptured = false;
            if (tracksBrowseResults) {
                resultsRequest.then(function rememberRequestId(requestId) {
                    resultsRequestId = requestId;
                    resultsRequestCaptured = true;
                }).catch(function ignoreRequestCaptureError() {
                    resultsRequestCaptured = true;
                });
            }
            return groupReady.then(function (groupSucceeded) {
                if (group === BROWSE_GROUP && groupSucceeded === false) {
                    return false;
                }
                if (group === BROWSE_GROUP && resetGeneration !== browseResetIntentGeneration) {
                    return false;
                }
                if (tracksBrowseResults
                    && (resultsProxyGeneration !== browseResultsProxyGeneration
                        || !isBrowseResultsSnapshotCurrent(
                            resultsRequestCaptured ? resultsRequestId : getCurrentBrowseResultsRequest()
                        ))) {
                    return false;
                }
                if (name === 'browseCategory'
                    && (getActiveViewName() !== activeViewAtRequest
                        || navigationIntentAtRequest !== appNavigationIntentGeneration)) {
                    return false;
                }
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
        global.resetBrowseViewToAll = proxyAfterBrowseRuntime(function () {
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

    function handleExamIndexLoaded(index, replayRequestId) {
        var snapshot = Array.isArray(index) ? index : [];
        syncOverviewAfterIndexLoad(snapshot);
        var activeView = getActiveViewName();

        if (activeView === 'browse') {
            var refreshGeneration = ++examIndexRefreshGeneration;
            var resultsProxyGenerationAtReceipt = browseResultsProxyGeneration;
            var navigationGenerationAtReceipt = appNavigationIntentGeneration;
            var resetInFlight = typeof global.__isBrowseResetIntentInFlight === 'function'
                && global.__isBrowseResetIntentInFlight();
            if (resetInFlight) {
                if (typeof global.__captureBrowseResetIndexSnapshot === 'function') {
                    global.__captureBrowseResetIndexSnapshot(snapshot);
                }
                var resetLoading = document.querySelector('#browse-view .loading');
                if (resetLoading) {
                    resetLoading.style.display = 'none';
                }
                return;
            }
            var hasReplayRequest = arguments.length > 1 && replayRequestId != null;
            if (hasReplayRequest && !isBrowseResultsSnapshotCurrent(replayRequestId)) {
                var staleReplayLoading = document.querySelector('#browse-view .loading');
                if (staleReplayLoading) {
                    staleReplayLoading.style.display = 'none';
                }
                return;
            }
            var browseReady = ensureBrowseGroup();
            var resultsRequestId = hasReplayRequest ? replayRequestId : null;
            var resultsRequestCaptured = hasReplayRequest;
            if (!hasReplayRequest && typeof global.__getBrowseResultsRequestId === 'function') {
                try {
                    resultsRequestId = global.__getBrowseResultsRequestId();
                    resultsRequestCaptured = true;
                } catch (_) { }
            }
            if (!hasReplayRequest && !resultsRequestCaptured) {
                captureBrowseResultsRequest().then(function rememberRequestId(requestId) {
                    resultsRequestId = requestId;
                    resultsRequestCaptured = true;
                }).catch(function ignoreRequestCaptureError() {
                    resultsRequestCaptured = true;
                });
            }
            browseReady.then(function afterBrowseReady(groupSucceeded) {
                if (groupSucceeded === false) {
                    return;
                }
                if (refreshGeneration !== examIndexRefreshGeneration
                    || resultsProxyGenerationAtReceipt !== browseResultsProxyGeneration
                    || navigationGenerationAtReceipt !== appNavigationIntentGeneration
                    || getActiveViewName() !== 'browse') {
                    return;
                }
                var effectiveRequestId = resultsRequestCaptured
                    ? resultsRequestId
                    : getCurrentBrowseResultsRequest();
                if (!isBrowseResultsSnapshotCurrent(effectiveRequestId)) {
                    var currentRequestId = getCurrentBrowseResultsRequest();
                    if (isBrowseUserResultsRequestInFlight(currentRequestId)) {
                        deferBrowseIndexRefresh(
                            snapshot,
                            refreshGeneration,
                            resultsProxyGenerationAtReceipt,
                            navigationGenerationAtReceipt
                        );
                    } else if (isBrowseUserResultsRequest(currentRequestId)) {
                        deferBrowseIndexRefresh(
                            snapshot,
                            refreshGeneration,
                            resultsProxyGenerationAtReceipt,
                            navigationGenerationAtReceipt
                        );
                        replayDeferredBrowseIndexRefresh(currentRequestId);
                    }
                    var staleLoading = document.querySelector('#browse-view .loading');
                    if (staleLoading) {
                        staleLoading.style.display = 'none';
                    }
                    return;
                }
                if (typeof global.__isBrowseUserResultsRequestInFlight === 'function'
                    && global.__isBrowseUserResultsRequestInFlight(effectiveRequestId)) {
                    deferBrowseIndexRefresh(
                        snapshot,
                        refreshGeneration,
                        resultsProxyGenerationAtReceipt,
                        navigationGenerationAtReceipt
                    );
                    var deferredLoading = document.querySelector('#browse-view .loading');
                    if (deferredLoading) {
                        deferredLoading.style.display = 'none';
                    }
                    return;
                }
                var refreshRequestId = typeof global.__beginBrowseResultsRequest === 'function'
                    ? global.__beginBrowseResultsRequest()
                    : effectiveRequestId;
                if (deferredBrowseIndexRefresh
                    && deferredBrowseIndexRefresh.refreshGeneration <= refreshGeneration) {
                    deferredBrowseIndexRefresh = null;
                }
                var searchInput = document.getElementById('exam-search-input')
                    || document.querySelector('.search-input');
                var searchQuery = searchInput && typeof searchInput.value === 'string'
                    ? searchInput.value.trim()
                    : '';
                if (typeof global.__renderBrowseResultsForState === 'function') {
                    try {
                        global.__renderBrowseResultsForState(snapshot, refreshRequestId);
                    } catch (_) { }
                } else if (searchQuery && typeof global.searchExams === 'function') {
                    try {
                        global.searchExams(
                            searchQuery,
                            refreshRequestId
                        );
                    } catch (_) { }
                } else if (typeof global.loadExamList === 'function') {
                    try {
                        global.loadExamList(
                            snapshot,
                            refreshRequestId
                        );
                    } catch (_) { }
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

    global.addEventListener('browseUserResultsRequestSettled', function onBrowseUserResultsRequestSettled(event) {
        var requestId = event && event.detail ? event.detail.requestId : null;
        replayDeferredBrowseIndexRefresh(requestId);
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
        ensureBrowseRuntimeGroup: ensureBrowseRuntimeGroup,
        ensureBrowseRuntime: ensureBrowseGroup,
        registerBrowseFunctionalResetBarrier: registerBrowseFunctionalResetBarrier,
        ensureMoreToolsGroup: ensureMoreToolsGroup,
        ensureSettingsToolsGroup: ensureSettingsToolsGroup,
        ensurePracticeSuiteGroup: ensurePracticeSuiteGroup,
        ensureStateCoreGroup: ensureStateCoreGroup,
        ensureSessionSuiteReady: ensureSessionSuiteReady,
        browseReady: function () { return browseGroupPromise || ensureBrowseGroup(); },
        examDataReady: ensureExamData
    });
})(typeof window !== 'undefined' ? window : this);
