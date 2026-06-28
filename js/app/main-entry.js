(function bootstrapApp(global) {
    'use strict';

    var STRICT_ON_DEMAND = true;
    var BROWSE_GROUP = 'browse-runtime';
    var PRACTICE_GROUP = 'practice-suite';
    var SESSION_GROUP = 'session-suite';
    var STATE_CORE_GROUP = 'state-core';
    var SETTINGS_GROUP = 'settings-tools';
    var READING_CANDIDATE_CODE_PREF_KEY = 'ielts_reading_candidate_code_preferences_v1';
    var READING_CANDIDATE_CODE_PATTERN = /^\d{6}$/;

    function summarizeMainEntryErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        const status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

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
        try {
            var raw = global.localStorage && global.localStorage.getItem(READING_CANDIDATE_CODE_PREF_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            var mode = parsed && parsed.mode === 'custom' ? 'custom' : 'auto';
            var customCode = parsed && typeof parsed.customCode === 'string'
                ? parsed.customCode.replace(/\D/g, '').slice(0, 6)
                : '';
            return {
                mode: mode,
                customCode: READING_CANDIDATE_CODE_PATTERN.test(customCode) ? customCode : ''
            };
        } catch (_) {
            return { mode: 'auto', customCode: '' };
        }
    }

    function saveReadingCandidateCodePreferences(preferences) {
        var next = {
            mode: preferences && preferences.mode === 'custom' ? 'custom' : 'auto',
            customCode: preferences && typeof preferences.customCode === 'string'
                ? preferences.customCode.replace(/\D/g, '').slice(0, 6)
                : ''
        };
        try {
            if (global.localStorage) {
                global.localStorage.setItem(READING_CANDIDATE_CODE_PREF_KEY, JSON.stringify(next));
            }
        } catch (_) { }
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

    function setupReadingCandidateCodeSettings() {
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
                    ? '当前使用自定义 code：' + preferences.customCode
                    : '当前使用自动生成：按练习 session 生成 6 位 code。',
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

        saveButton.addEventListener('click', function saveCandidateCodeSettings() {
            var mode = getSelectedMode();
            var code = input.value.replace(/\D/g, '').slice(0, 6);
            if (mode === 'custom' && !READING_CANDIDATE_CODE_PATTERN.test(code)) {
                setReadingCandidateCodeStatus(status, '请输入 6 位数字 code。', 'error');
                input.focus();
                return;
            }
            saveReadingCandidateCodePreferences({ mode: mode, customCode: code });
            setReadingCandidateCodeStatus(
                status,
                mode === 'custom' ? '已保存自定义 code：' + code : '已保存：自动生成。',
                'success'
            );
        });

        randomButton.addEventListener('click', function generateCandidateCode() {
            var code = hashReadingCandidateCode(createReadingCandidateCodeSeed());
            setSelectedMode('custom');
            input.value = code;
            saveReadingCandidateCodePreferences({ mode: 'custom', customCode: code });
            setReadingCandidateCodeStatus(status, '已随机生成并保存：' + code, 'success');
        });

        syncFromStorage();
    }

    function setupSettingsLayoutNavigation() {
        var view = document.getElementById('settings-view');
        if (!view || view.querySelector('.settings-layout')) {
            return;
        }
        var group = view.querySelector('.hero-settings-group');
        if (!group) {
            return;
        }

        var definitions = [
            { id: 'settings-system-management', label: 'System', selector: '.system-management-panel' },
            { id: 'settings-data-management', label: 'Data', selector: '.data-management-panel' },
            { id: 'settings-security', label: 'Security', selector: '.settings-security-panel' },
            { id: 'settings-reading-display', label: 'Reading Display', selector: '.reading-candidate-code-panel' },
            { id: 'settings-practice-timer', label: 'Practice Timer', selector: '.practice-timer-settings-panel' },
            { id: 'settings-system-info', label: 'System Info', selector: null }
        ];

        var panels = Array.prototype.slice.call(group.children)
            .filter(function filterElement(node) { return node && node.nodeType === 1; });
        var usedPanels = [];
        var layout = document.createElement('div');
        var sidebar = document.createElement('nav');
        var content = document.createElement('div');
        var sectionButtons = new Map();
        var sectionElements = [];
        var scrollFrame = null;
        var manualActiveTarget = '';
        var manualActiveUntil = 0;
        layout.className = 'settings-layout';
        sidebar.className = 'settings-sidebar';
        sidebar.setAttribute('aria-label', 'Settings sections');
        content.className = 'settings-content';

        function markActive(button) {
            if (!button) {
                return;
            }
            Array.prototype.slice.call(sidebar.querySelectorAll('.settings-sidebar__item'))
                .forEach(function syncButton(item) {
                    var active = item === button;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-current', active ? 'true' : 'false');
                });
            try {
                button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } catch (_) { }
        }

        function syncActiveSectionFromScroll() {
            if (scrollFrame) {
                return;
            }
            scrollFrame = global.requestAnimationFrame(function updateActiveSection() {
                scrollFrame = null;
                if (manualActiveTarget && Date.now() < manualActiveUntil) {
                    var manualButton = sectionButtons.get(manualActiveTarget);
                    if (manualButton) {
                        markActive(manualButton);
                        return;
                    }
                }
                manualActiveTarget = '';
                var headerOffset = 96;
                try {
                    var rootStyles = global.getComputedStyle(document.documentElement);
                    var declaredHeader = parseFloat(rootStyles.getPropertyValue('--header-height'));
                    if (Number.isFinite(declaredHeader) && declaredHeader > 0) {
                        headerOffset = declaredHeader;
                    }
                } catch (_) { }
                var anchorY = headerOffset + 120;
                var activeSection = sectionElements[0] || null;
                sectionElements.forEach(function resolveVisibleSection(section) {
                    var rect = section.getBoundingClientRect();
                    if (rect.top <= anchorY && rect.bottom > anchorY) {
                        activeSection = section;
                        return;
                    }
                    if (rect.top <= anchorY) {
                        activeSection = section;
                    }
                });
                if (activeSection) {
                    markActive(sectionButtons.get(activeSection.id));
                }
            });
        }

        function resolvePanel(definition, index) {
            var panel = definition.selector ? group.querySelector(definition.selector) : null;
            if (!panel && index === definitions.length - 1) {
                panel = panels.find(function findUnused(candidate) {
                    return usedPanels.indexOf(candidate) === -1;
                });
            }
            return panel;
        }

        definitions.forEach(function buildSection(definition, index) {
            var panel = resolvePanel(definition, index);
            if (!panel) {
                return;
            }
            usedPanels.push(panel);
            panel.id = definition.id;
            panel.classList.add('settings-section-card');
            Array.prototype.slice.call(panel.querySelectorAll('.hero-settings-actions'))
                .forEach(function markActionGrid(actions) {
                    actions.classList.add('settings-action-grid');
                });

            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'settings-sidebar__item';
            button.dataset.settingsTarget = definition.id;
            button.textContent = definition.label;
            button.addEventListener('click', function onSidebarClick() {
                manualActiveTarget = definition.id;
                manualActiveUntil = Date.now() + 900;
                markActive(button);
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            sidebar.appendChild(button);
            content.appendChild(panel);
            sectionButtons.set(definition.id, button);
            sectionElements.push(panel);
        });

        layout.appendChild(sidebar);
        layout.appendChild(content);
        group.replaceWith(layout);

        var firstButton = sidebar.querySelector('.settings-sidebar__item');
        if (firstButton) {
            markActive(firstButton);
        }
        global.addEventListener('scroll', syncActiveSectionFromScroll, { passive: true });
        global.addEventListener('resize', syncActiveSectionFromScroll, { passive: true });
        syncActiveSectionFromScroll();
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
                console.warn('[MainEntry] 重新应用 mixins 失败:', summarizeMainEntryErrorForLog(error));
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
                        console.warn('[MainEntry] 初始化题库偏好 UI 失败:', summarizeMainEntryErrorForLog(error));
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
            console.error('[MainEntry] 设置命名空间失败', summarizeMainEntryErrorForLog(error));
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
            console.warn('[MainEntry] 初始化导航失败:', summarizeMainEntryErrorForLog(error));
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
                    console.warn('[BootStage] 更新失败:', summarizeMainEntryErrorForLog(error));
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
            console.warn('[MainEntry] 同步总览数据失败:', summarizeMainEntryErrorForLog(error));
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
                console.error('[MainEntry] browse-runtime 组加载失败:', summarizeMainEntryErrorForLog(error));
            });
            return;
        }

        if (activeView === 'practice') {
            Promise.all([ensureBrowseGroup(), ensurePracticeSuiteGroup()]).then(function onPracticeReady() {
                if (typeof global.updatePracticeView === 'function') {
                    try { global.updatePracticeView(); } catch (_) { }
                }
            }).catch(function handlePracticeLoadError(error) {
                console.error('[MainEntry] practice 视图模块加载失败:', summarizeMainEntryErrorForLog(error));
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
                console.warn('[MainEntry] 后台题库引导失败:', summarizeMainEntryErrorForLog(error));
            });
    }

    function init() {
        setStorageNamespace();
        initializeNavigationShell();
        setupReadingCandidateCodeSettings();
        setupSettingsLayoutNavigation();

        if (STRICT_ON_DEMAND) {
            setTimeout(function () {
                bootstrapCoreDataInBackground();
            }, 0);
            return;
        }

        bootstrapCoreDataInBackground();
        ensurePracticeSuiteGroup().catch(function preloadPracticeSuiteError(err) {
            console.warn('[MainEntry] 预加载 practice-suite 失败:', summarizeMainEntryErrorForLog(err));
        });
        ensureBrowseGroup().catch(function preloadError(error) {
            console.warn('[MainEntry] 预加载 browse-runtime 失败:', summarizeMainEntryErrorForLog(error));
        });
        if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(function () {
                ensureMoreToolsGroup().catch(function swallow(err) {
                    console.warn('[MainEntry] 预加载 more-tools 失败:', summarizeMainEntryErrorForLog(err));
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
