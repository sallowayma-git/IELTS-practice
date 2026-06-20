/**
 * 主应用程序
 * 负责应用的初始化和整体协调
 */

class ExamSystemApp {
    constructor() {
        this.currentView = 'overview';
        this.components = {};
        this.isInitialized = false;

        // 统一状态管理 - 替代全局变量
        this.state = {
            // 考试相关状态
            exam: {
                index: [],
                currentCategory: 'all',
                currentExamType: 'all',
                filteredExams: [],
                configurations: {},
                activeConfigKey: 'exam_index'
            },

            // 练习相关状态
            practice: {
                records: [],
                selectedRecords: new Set(),
                bulkDeleteMode: false,
                dataCollector: null
            },

            // UI状态
            ui: {
                browseFilter: { category: 'all', type: 'all' },
                pendingBrowseFilter: null,
                legacyBrowseType: 'all',
                customSuiteDraft: null,
                currentVirtualScroller: null,
                loading: false,
                loadingMessage: ''
            },

            // 组件实例
            components: {
                dataIntegrityManager: null,
                pdfHandler: null,
                browseStateManager: null,
                practiceListScroller: null
            },

            // 系统状态
            system: {
                processedSessions: new Set(),
                fallbackExamSessions: new Map(),
                failedScripts: new Set()
            }
        };

        // 绑定方法上下文
        this.handleResize = this.handleResize.bind(this);
    }

}

(function(global) {
    function escapeCssSelectorValue(value) {
        if (global.CSS && typeof global.CSS.escape === 'function') {
            try {
                return global.CSS.escape(String(value == null ? '' : value));
            } catch (_) {
                // fallback below
            }
        }
        return String(value == null ? '' : value).replace(/["\\]/g, '\\$&');
    }

    function isAppUnsafeAttributeName(name) {
        const key = String(name || '').toLowerCase();
        return key.startsWith('on') || key === 'srcdoc';
    }

    function isAppUnsafeUrlAttribute(name, value, tagName) {
        const key = String(name || '').toLowerCase();
        const urlAttributes = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster']);
        if (!urlAttributes.has(key)) {
            return false;
        }
        const text = String(value == null ? '' : value).trim();
        if (!text) {
            return false;
        }
        const compact = text.replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase();
        if (compact.startsWith('javascript:') || compact.startsWith('vbscript:')) {
            return true;
        }
        if (compact.startsWith('data:')) {
            const tag = String(tagName || '').toLowerCase();
            if (key !== 'src' || tag !== 'img') {
                return true;
            }
            return /^data:(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)/i.test(compact);
        }
        return false;
    }

    function isAppUnsafeObjectKey(name) {
        const key = String(name || '').toLowerCase();
        return key === '__proto__' || key === 'prototype' || key === 'constructor';
    }

    function isAppUnsafeStyleValue(name, value) {
        if (isAppUnsafeObjectKey(name) || value == null) {
            return true;
        }
        const compact = String(value)
            .replace(/[\u0000-\u001f\u007f\s]+/g, '')
            .toLowerCase();
        return compact.includes('javascript:')
            || compact.includes('vbscript:')
            || compact.includes('expression(')
            || compact.includes('data:text/html')
            || compact.includes('data:application/xhtml+xml')
            || compact.includes('data:image/svg+xml');
    }

    function applySafeElementAttributes(element, attrs) {
        if (!element || !attrs || typeof attrs !== 'object') {
            return;
        }
        Object.keys(attrs).forEach((key) => {
            const value = attrs[key];
            if (value == null || value === false) {
                return;
            }
            if (isAppUnsafeAttributeName(key) || isAppUnsafeUrlAttribute(key, value, element.tagName)) {
                console.warn(`[App] Skipped unsafe fallback attribute: ${key}`);
                return;
            }
            if (key === 'className') {
                element.className = value;
                return;
            }
            if (key === 'dataset' && typeof value === 'object') {
                Object.keys(value).forEach((dataKey) => {
                    if (!isAppUnsafeObjectKey(dataKey) && value[dataKey] != null) {
                        element.dataset[dataKey] = String(value[dataKey]);
                    }
                });
                return;
            }
            if (key === 'style' && typeof value === 'object') {
                Object.keys(value).forEach((styleKey) => {
                    const styleValue = value[styleKey];
                    if (!isAppUnsafeStyleValue(styleKey, styleValue)) {
                        element.style[styleKey] = styleValue;
                    }
                });
                return;
            }
            if (key === 'type') {
                element.setAttribute('type', value);
                return;
            }
            element.setAttribute(key, value === true ? '' : String(value));
        });
    }

    const integratedStateMixin = {
        getState(path) {
            return path.split('.').reduce((obj, key) => obj && obj[key], this.state);
        },
        setState(path, value) {
            const keys = path.split('.');
            const lastKey = keys.pop();
            const target = keys.reduce((obj, key) => obj && obj[key], this.state);
            if (target && Object.prototype.hasOwnProperty.call(target, lastKey)) {
                target[lastKey] = value;
            }
        },
        updateState(path, updates) {
            const current = this.getState(path);
            this.setState(path, { ...current, ...updates });
        },
        async persistState(path, storageKey = null) {
            const value = this.getState(path);
            const key = storageKey || path.replace('.', '_');
            try {
                const serializedValue = StateSerializer.serialize(value);
                await storage.set(key, serializedValue);
            } catch (error) {
                console.error(`[App] 持久化状态失败 ${path}:`, error);
            }
        },
        async persistMultipleState(mapping) {
            const promises = Object.entries(mapping).map(([path, storageKey]) =>
                this.persistState(path, storageKey)
            );
            try {
                await Promise.all(promises);
            } catch (error) {
                console.error('[App] 批量持久化状态失败:', error);
            }
        },
        async loadState(path, storageKey = null) {
            const key = storageKey || path.replace('.', '_');
            try {
                const value = await storage.get(key, null);
                if (value !== null) {
                    const deserializedValue = StateSerializer.deserialize(value);
                    this.setState(path, deserializedValue);
                    return deserializedValue;
                }
            } catch (error) {
                console.error(`[App] 加载状态失败 ${path}:`, error);
            }
            return null;
        },
        async loadPersistedState() {
            const stateMappings = {
                exam: 'app_exam_state',
                practice: 'app_practice_state',
                ui: 'app_ui_state',
                system: 'app_system_state'
            };
            for (const [path, storageKey] of Object.entries(stateMappings)) {
                await this.loadState(path, storageKey);
            }
            console.log('[App] 持久化状态加载完成');
        },
        async saveAllState() {
            const stateMappings = {
                exam: 'app_exam_state',
                practice: 'app_practice_state',
                ui: 'app_ui_state',
                system: 'app_system_state'
            };
            await this.persistMultipleState(stateMappings);
            console.log('[App] 所有状态已保存');
        },
        async checkComponents() {
            console.log('=== 组件加载检查 ===');
            try {
                if (window.AppActions && typeof window.AppActions.ensurePracticeSuite === 'function') {
                    await window.AppActions.ensurePracticeSuite();
                } else if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
                    await window.AppLazyLoader.ensureGroup('practice-suite');
                }
            } catch (error) {
                console.warn('[App] 练习组件预加载失败:', error);
            }
            const components = {
                SystemDiagnostics: window.SystemDiagnostics,
                MarkdownExporter: window.MarkdownExporter,
                practiceRecordModal: window.practiceRecordModal,
                practiceHistoryEnhancer: window.practiceHistoryEnhancer
            };
            let allLoaded = true;
            Object.keys(components).forEach((name) => {
                const component = components[name];
                const status = component ? '✅ 已加载' : '❌ 未加载';
                console.log(`${name}: ${status}`);
                if (!component) {
                    allLoaded = false;
                }
            });
            const functions = {
                exportPracticeData: window.exportPracticeData,
                showRecordDetails: window.showRecordDetails,
                showMessage: window.showMessage
            };
            console.log('\n=== 全局函数检查 ===');
            Object.keys(functions).forEach((name) => {
                const func = functions[name];
                const status = (typeof func === 'function') ? '✅ 可用' : '❌ 不可用';
                console.log(`${name}: ${status}`);
            });
            console.log('\n=== 数据检查 ===');
            const practiceRecordsCount = this.getState('practice.records')?.length || 0;
            console.log(`practiceRecords: ${practiceRecordsCount} 条记录`);
            if (window.storage) {
                try {
                    const arr = await window.storage.get('practice_records', []);
                    const count = Array.isArray(arr) ? arr.length : 0;
                    console.log(`storage.practice_records: ${count} 条记录`);
                } catch (_) {
                    console.log('storage.practice_records: 0 条记录');
                }
            }
            console.log('\n=== 检查完成 ===');
            if (allLoaded) {
                console.log('✅ 所有组件已正确加载');
                if (window.practiceHistoryEnhancer && !window.practiceHistoryEnhancer.initialized) {
                    console.log('🔄 手动初始化增强器...');
                    window.practiceHistoryEnhancer.initialize();
                }
            } else {
                console.log('⚠️ 部分组件未加载，功能可能受限');
            }
            return { allLoaded, components, functions };
        },
        initializeGlobalCompatibility() {
            if (window.appStateService) {
                try {
                    window.appStateService.installGlobalBindings(window);
                    window.appStateService.connectApp(this);
                } catch (error) {
                    console.warn('[App] AppStateService connect failed:', error);
                }
            }
            Object.defineProperty(window, 'dataIntegrityManager', {
                get: () => this.state.components.dataIntegrityManager,
                set: (value) => this.setState('components.dataIntegrityManager', value),
                configurable: true
            });
            Object.defineProperty(window, 'pdfHandler', {
                get: () => this.state.components.pdfHandler,
                set: (value) => this.setState('components.pdfHandler', value),
                configurable: true
            });
            Object.defineProperty(window, 'app', {
                get: () => this,
                set: () => {},
                configurable: true
            });
            window.checkComponents = () => this.checkComponents();
        }
    };

    const integratedBootstrapMixin = {
        checkDependencies() {
            const requiredGlobals = ['storage'];
            const missing = requiredGlobals.filter((name) => !window[name]);
            if (missing.length > 0) {
                throw new Error(`Missing required dependencies: ${missing.join(', ')}`);
            }
        },
        async initializeComponents() {
            const optionalComponents = [];
            try {
                await this.initializeCoreComponents();
                if (optionalComponents.length > 0) {
                    try {
                        await this.waitForComponents(optionalComponents, 5000);
                        await this.initializeOptionalComponents();
                    } catch (_) {
                        await this.initializeAvailableOptionalComponents();
                    }
                } else {
                    await this.initializeOptionalComponents();
                }
            } catch (error) {
                console.error('[App] 核心组件加载失败:', error);
                throw error;
            }
        },
        async initializeCoreComponents() {
            if (this.instantiatePracticeRecorder()) {
                return;
            }
            console.warn('[App] PracticeRecorder类不可用，使用降级记录器');
            this.components.practiceRecorder = this.createFallbackRecorder();
            this.ensurePracticeRecorderEvents();
            this.schedulePracticeRecorderUpgrade();
        },
        instantiatePracticeRecorder() {
            if (typeof window.PracticeRecorder !== 'function') {
                return false;
            }
            try {
                this.components.practiceRecorder = new PracticeRecorder();
                this.ensurePracticeRecorderEvents();
                return true;
            } catch (error) {
                console.error('[App] PracticeRecorder初始化失败:', error);
                return false;
            }
        },
        ensurePracticeRecorderEvents() {
            if (this._practiceRecorderEventsBound) {
                return;
            }
            if (typeof this.setupPracticeRecorderEvents === 'function') {
                this.setupPracticeRecorderEvents();
            }
        },
        createFallbackRecorder() {
            function normalizeRecords(records) {
                return Array.isArray(records) ? records : [];
            }
            return {
                startPracticeSession: (examId) => ({ examId: examId || '', startTime: Date.now(), sessionId: `fallback_${Date.now()}`, status: 'started' }),
                startSession: (examId) => ({ examId: examId || '', startTime: Date.now(), sessionId: `fallback_${Date.now()}`, status: 'started' }),
                handleRealPracticeData: async () => null,
                savePracticeRecord: async (record) => {
                    if (!window.storage || typeof window.storage.get !== 'function' || typeof window.storage.set !== 'function') {
                        return record || null;
                    }
                    try {
                        if (window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.savePracticeRecord === 'function') {
                            await window.PracticeCore.store.savePracticeRecord(record);
                        } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.addPracticeRecord === 'function') {
                            await window.simpleStorageWrapper.addPracticeRecord(record);
                        } else {
                            const current = await window.storage.get('practice_records', []);
                            const list = normalizeRecords(current);
                            if (record && typeof record === 'object') {
                                list.unshift(record);
                            }
                            await window.storage.set(['practice', 'records'].join('_'), list);
                        }
                    } catch (error) {
                        console.warn('[App] 降级记录器保存失败:', error);
                    }
                    return record || null;
                },
                getPracticeRecords: async () => {
                    if (!window.storage || typeof window.storage.get !== 'function') {
                        return [];
                    }
                    try {
                        return normalizeRecords(await window.storage.get('practice_records', []));
                    } catch (error) {
                        console.warn('[App] 降级记录器读取失败:', error);
                        return [];
                    }
                }
            };
        },
        schedulePracticeRecorderUpgrade(maxAttempts = 20, interval = 500) {
            if (this._practiceRecorderUpgradeTimer || typeof window === 'undefined') {
                return;
            }
            let attempts = 0;
            const tryUpgrade = () => {
                if (this.instantiatePracticeRecorder()) {
                    clearInterval(this._practiceRecorderUpgradeTimer);
                    this._practiceRecorderUpgradeTimer = null;
                    console.info('[App] PracticeRecorder 脚本加载完成，已升级为完整记录器');
                    return;
                }
                attempts += 1;
                if (attempts >= maxAttempts) {
                    clearInterval(this._practiceRecorderUpgradeTimer);
                    this._practiceRecorderUpgradeTimer = null;
                    console.warn('[App] PracticeRecorder 脚本仍未加载，继续使用降级模式');
                }
            };
            this._practiceRecorderUpgradeTimer = setInterval(tryUpgrade, interval);
            tryUpgrade();
        },
        async initializeOptionalComponents() {},
        async initializeAvailableOptionalComponents() {
            const availableComponents = [].filter((name) => window[name]);
            if (availableComponents.length > 0) {
                await this.initializeOptionalComponents();
            } else {
                console.warn('[App] 没有发现可用的可选组件');
            }
        },
        async waitForComponents(requiredClasses = ['ExamBrowser'], timeout = 3000) {
            const startTime = Date.now();
            const checkInterval = 100;
            while (Date.now() - startTime < timeout) {
                const loadingStatus = requiredClasses.map((className) => {
                    const isLoaded = window[className] && typeof window[className] === 'function';
                    if (!isLoaded) {
                        console.debug(`[App] 等待组件: ${className}`);
                    }
                    return { className, isLoaded };
                });
                const allLoaded = loadingStatus.every((status) => status.isLoaded);
                if (allLoaded) {
                    return true;
                }
                await new Promise((resolve) => setTimeout(resolve, checkInterval));
            }
            const missingClasses = requiredClasses.filter((className) => !window[className] || typeof window[className] !== 'function');
            const loadedClasses = requiredClasses.filter((className) => window[className] && typeof window[className] === 'function');
            const errorMessage = [
                `组件加载超时 (${timeout}ms)`,
                `已加载: ${loadedClasses.join(', ') || '无'}`,
                `缺失: ${missingClasses.join(', ')}`,
                '请检查组件文件是否正确加载'
            ].join('\n');
            console.error('[App] 组件加载失败:', errorMessage);
            throw new Error(errorMessage);
        }
    };

    const integratedFallbackMixin = {
        showLoading(show) {
            const loading = document.getElementById('loading');
            if (!loading) {
                return;
            }
            if (typeof window.DOM !== 'undefined') {
                if (show) {
                    window.DOM.show(loading, 'flex');
                } else {
                    window.DOM.hide(loading);
                }
            } else {
                loading.style.display = show ? 'flex' : 'none';
            }
        },
        showFallbackUI(canRecover = false) {
            const appContainer = document.getElementById('app');
            if (!appContainer) {
                return;
            }
            const adapter = window.DOMAdapter;
            const createNode = (tag, attrs, children) => {
                if (adapter && typeof adapter.create === 'function') {
                    return adapter.create(tag, attrs, children);
                }
                const element = document.createElement(tag);
                applySafeElementAttributes(element, attrs);
                const nodes = Array.isArray(children) ? children : [children];
                nodes.forEach((child) => {
                    if (child == null) {
                        return;
                    }
                    if (child instanceof Node) {
                        element.appendChild(child);
                    } else if (typeof child === 'string') {
                        element.appendChild(document.createTextNode(child));
                    }
                });
                return element;
            };
            const replaceContent = (container, content) => {
                while (container.firstChild) {
                    container.removeChild(container.firstChild);
                }
                const nodes = Array.isArray(content) ? content : [content];
                nodes.forEach((node) => {
                    if (!node) {
                        return;
                    }
                    container.appendChild(node);
                });
            };
            const solutionList = createNode('ul', { className: 'solution-list' }, [
                createNode('li', null, '🔄 刷新页面重新加载系统'),
                createNode('li', null, '🧹 清除浏览器缓存和Cookie'),
                createNode('li', null, '🌐 检查网络连接是否正常'),
                createNode('li', null, '🔧 使用Chrome、Firefox或Edge等现代浏览器'),
                createNode('li', null, '💾 确保有足够的系统内存')
            ]);
            const recoverySection = canRecover ? createNode('div', { className: 'recovery-options' }, [
                createNode('h3', null, '恢复选项'),
                createNode('div', { className: 'recovery-buttons' }, [
                    createNode('button', { type: 'button', className: 'btn btn-secondary', dataset: { fallbackAction: 'attempt-recovery' } }, '尝试恢复'),
                    createNode('button', { type: 'button', className: 'btn btn-outline', dataset: { fallbackAction: 'safe-mode' } }, '安全模式')
                ])
            ]) : null;
            const fallbackRoot = createNode('div', { className: 'fallback-ui' }, [
                createNode('div', { className: 'container' }, [
                    createNode('div', { className: 'fallback-header' }, [
                        createNode('h1', null, '⚠️ 系统初始化失败'),
                        createNode('p', { className: 'fallback-description' }, '抱歉，IELTS考试系统无法正常启动。这可能是由于网络问题、浏览器兼容性或系统资源不足导致的。')
                    ]),
                    createNode('div', { className: 'fallback-solutions' }, [createNode('h3', null, '建议解决方案'), solutionList]),
                    recoverySection,
                    createNode('div', { className: 'fallback-actions' }, [
                        createNode('button', { type: 'button', className: 'btn btn-primary', dataset: { fallbackAction: 'reload' } }, '🔄 刷新页面'),
                        createNode('button', { type: 'button', className: 'btn btn-outline', dataset: { fallbackAction: 'show-info' } }, '📊 系统信息')
                    ]),
                    createNode('div', { className: 'fallback-footer' }, [createNode('p', null, '如果问题持续存在，请联系技术支持并提供系统信息。')])
                ])
            ]);
            replaceContent(appContainer, fallbackRoot);
            const bindAction = (selector, handler) => {
                const node = appContainer.querySelector(selector);
                if (!node) {
                    return;
                }
                node.addEventListener('click', (event) => {
                    event.preventDefault();
                    handler();
                });
            };
            bindAction('[data-fallback-action="reload"]', () => window.location.reload());
            bindAction('[data-fallback-action="show-info"]', () => alert('系统信息功能已移除'));
            bindAction('[data-fallback-action="attempt-recovery"]', () => this.attemptRecovery());
            bindAction('[data-fallback-action="safe-mode"]', () => this.enterSafeMode());
        },
        attemptRecovery() {
            this.showUserMessage('正在尝试恢复系统...', 'info');
            this.components = {};
            this.isInitialized = false;
            if (this.globalErrors) {
                this.globalErrors = [];
            }
            setTimeout(() => {
                this.initialize();
            }, 1000);
        },
        enterSafeMode() {
            this.showUserMessage('正在启动安全模式...', 'info');
            const appContainer = document.getElementById('app');
            if (!appContainer) {
                return;
            }
            const adapter = window.DOMAdapter;
            const createNode = (tag, attrs, children) => {
                if (adapter && typeof adapter.create === 'function') {
                    return adapter.create(tag, attrs, children);
                }
                const element = document.createElement(tag);
                applySafeElementAttributes(element, attrs);
                const nodes = Array.isArray(children) ? children : [children];
                nodes.forEach((child) => {
                    if (child == null) {
                        return;
                    }
                    if (child instanceof Node) {
                        element.appendChild(child);
                    } else if (typeof child === 'string') {
                        element.appendChild(document.createTextNode(child));
                    }
                });
                return element;
            };
            const replaceContent = (container, content) => {
                while (container.firstChild) {
                    container.removeChild(container.firstChild);
                }
                const nodes = Array.isArray(content) ? content : [content];
                nodes.forEach((node) => {
                    if (!node) {
                        return;
                    }
                    container.appendChild(node);
                });
            };
            const featuresList = createNode('ul', null, [
                createNode('li', null, '基本题库浏览'),
                createNode('li', null, '简单练习记录'),
                createNode('li', null, '系统诊断')
            ]);
            const safeModeRoot = createNode('div', { className: 'safe-mode-ui' }, [
                createNode('div', { className: 'container' }, [
                    createNode('h1', null, '🛡️ 安全模式'),
                    createNode('p', null, '系统正在安全模式下运行，部分功能可能不可用。'),
                    createNode('div', { className: 'safe-mode-features' }, [createNode('h3', null, '可用功能'), featuresList]),
                    createNode('div', { className: 'safe-mode-actions' }, [
                        createNode('button', { type: 'button', className: 'btn btn-primary', dataset: { safeModeAction: 'initialize' } }, '尝试完整启动'),
                        createNode('button', { type: 'button', className: 'btn btn-secondary', dataset: { safeModeAction: 'reload' } }, '重新加载')
                    ])
                ])
            ]);
            replaceContent(appContainer, safeModeRoot);
            const bindAction = (selector, handler) => {
                const node = appContainer.querySelector(selector);
                if (!node) {
                    return;
                }
                node.addEventListener('click', (event) => {
                    event.preventDefault();
                    handler();
                });
            };
            bindAction('[data-safe-mode-action="initialize"]', () => this.initialize());
            bindAction('[data-safe-mode-action="reload"]', () => window.location.reload());
        }
    };

    const integratedNavigationMixin = {
        setupInitialView() {
            const urlParams = new URLSearchParams(window.location.search);
            const urlView = urlParams.get('view');
            const initialView = urlView || 'overview';
            this.navigateToView(initialView);
        },
        navigateToView(viewName) {
            if (this.currentView === viewName) {
                return;
            }
            document.querySelectorAll('.view').forEach((view) => {
                view.classList.remove('active');
            });
            const targetView = document.getElementById(`${viewName}-view`);
            if (targetView) {
                targetView.classList.add('active');
                this.currentView = viewName;
                document.querySelectorAll('.nav-btn').forEach((btn) => {
                    btn.classList.remove('active');
                });
                const activeNavBtn = document.querySelector(`[data-view="${escapeCssSelectorValue(viewName)}"]`);
                if (activeNavBtn) {
                    activeNavBtn.classList.add('active');
                }
                const url = new URL(window.location);
                url.searchParams.set('view', viewName);
                window.history.replaceState({}, '', url);
                this.onViewActivated(viewName);
            }
        },
        onViewActivated(viewName) {
            switch (viewName) {
                case 'overview':
                    this.refreshOverviewData();
                    break;
                case 'browse':
                    if (window.__pendingBrowseFilter && typeof window.applyBrowseFilter === 'function') {
                        const { category, type, filterMode, path } = window.__pendingBrowseFilter;
                        try {
                            window.applyBrowseFilter(category, type, filterMode, path);
                        } finally {
                            delete window.__pendingBrowseFilter;
                        }
                    } else if (typeof window.initializeBrowseView === 'function') {
                        window.initializeBrowseView();
                    }
                    break;
                case 'practice':
                    console.log('[App] 练习视图已激活，开始加载练习记录模块');
                    Promise.resolve()
                        .then(() => (typeof window.ensureBrowseGroup === 'function' ? window.ensureBrowseGroup() : null))
                        .then(() => (typeof window.ensurePracticeSuiteReady === 'function' ? window.ensurePracticeSuiteReady() : null))
                        .then(() => {
                            if (typeof window.syncPracticeRecords === 'function') {
                                return window.syncPracticeRecords();
                            }
                            if (typeof window.updatePracticeView === 'function') {
                                window.updatePracticeView();
                            }
                            return null;
                        })
                        .catch((error) => {
                            console.error('[App] 激活练习视图失败:', error);
                        });
                    break;
                default:
                    break;
            }
        },
        handleCategoryAction(action, category) {
            switch (action) {
                case 'browse':
                    this.browseCategory(category);
                    break;
                case 'practice':
                    this.startCategoryPractice(category);
                    break;
                default:
                    break;
            }
        },
        browseCategory(category, type = null, filterMode = null, path = null) {
            try {
                window.__pendingBrowseFilter = { category, type, filterMode, path };
                const descriptor = Object.getOwnPropertyDescriptor(window, '__browseFilter');
                if (!descriptor || typeof descriptor.set !== 'function') {
                    window.__browseFilter = { category, type, filterMode, path };
                }
            } catch (_) {}
            try {
                if (typeof window.requestBrowseAutoScroll === 'function') {
                    window.requestBrowseAutoScroll(category, type);
                }
            } catch (_) {}
            this.navigateToView('browse');
            try {
                if (typeof window.applyBrowseFilter === 'function' && document.getElementById('browse-view')?.classList.contains('active')) {
                    window.applyBrowseFilter(category, type, filterMode, path);
                    delete window.__pendingBrowseFilter;
                }
            } catch (_) {}
        },
        async startCategoryPractice(category) {
            const examIndex = await storage.get('exam_index', []);
            const categoryExams = examIndex.filter((exam) => exam.category === category);
            if (categoryExams.length === 0) {
                window.showMessage(`${category} 分类暂无可用题目`, 'warning');
                return;
            }
            const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
            this.openExam(randomExam.id);
        },
        showExamDetails(examId) {
            if (this.components.examBrowser) {
                this.components.examBrowser.showExamDetails(examId);
            }
        }
    };

    const integratedLifecycleMixin = {
        async initialize() {
            try {
                this.showLoading(true);
                this.updateLoadingMessage('正在检查系统依赖...');
                this.checkDependencies();
                this.updateLoadingMessage('正在初始化状态管理...');
                this.initializeGlobalCompatibility();
                this.updateLoadingMessage('正在加载持久化状态...');
                await this.loadPersistedState();
                this.updateLoadingMessage('正在初始化响应式功能...');
                this.initializeResponsiveFeatures();
                this.updateLoadingMessage('正在加载系统组件...');
                await this.initializeComponents();
                this.updateLoadingMessage('正在设置事件监听器...');
                this.setupEventListeners();
                if (typeof this.initializeSuiteMode === 'function') {
                    this.initializeSuiteMode();
                }
                if (typeof window.initializeLegacyComponents === 'function') {
                    this.updateLoadingMessage('正在初始化遗留组件...');
                    await window.initializeLegacyComponents();
                }
                this.updateLoadingMessage('正在加载初始数据...');
                await this.loadInitialData();
                this.updateLoadingMessage('正在设置用户界面...');
                this.setupInitialView();
                if (typeof this.startSessionMonitoring === 'function') {
                    this.startSessionMonitoring();
                }
                this.setupGlobalErrorHandling();
                this.isInitialized = true;
                this.showLoading(false);
                this.showUserMessage('系统初始化完成', 'success');
            } catch (error) {
                this.showLoading(false);
                this.handleInitializationError(error);
            }
        },
        handleInitializationError(error) {
            console.error('[App] 系统初始化失败:', error);
            let userMessage = '系统初始化失败';
            let canRecover = false;
            if (error.message.includes('组件加载超时')) {
                userMessage = '系统组件加载超时，请刷新页面重试';
                canRecover = true;
            } else if (error.message.includes('依赖')) {
                userMessage = '系统依赖检查失败，请确保所有必需文件已正确加载';
            } else if (error.message.includes('网络')) {
                userMessage = '网络连接问题，请检查网络连接后重试';
                canRecover = true;
            } else {
                userMessage = '系统遇到未知错误，请联系技术支持';
            }
            this.showUserMessage(userMessage, 'error');
            if (window.handleError) {
                window.handleError(error, 'App Initialization');
            }
            this.showFallbackUI(canRecover);
        },
        setupGlobalErrorHandling() {
            window.addEventListener('unhandledrejection', (event) => {
                console.error('[App] 未处理的Promise拒绝:', event.reason);
                this.handleGlobalError(event.reason, 'Promise拒绝');
                event.preventDefault();
            });
            window.addEventListener('error', (event) => {
                console.error('[App] JavaScript错误:', event.error);
                this.handleGlobalError(event.error, 'JavaScript错误');
            });
        },
        handleGlobalError(error, context) {
            try {
                const normalizedError = error && typeof error === 'object'
                    ? error
                    : { message: String(error || 'Unknown error'), stack: undefined };
                if (!this.globalErrors) {
                    this.globalErrors = [];
                }
                this.globalErrors.push({
                    error: normalizedError.message || String(error),
                    context,
                    timestamp: Date.now(),
                    stack: normalizedError.stack
                });
                if (this.globalErrors.length > 100) {
                    this.globalErrors = this.globalErrors.slice(-50);
                }
                const recentErrors = this.globalErrors.filter((e) => Date.now() - e.timestamp < 60000);
                if (recentErrors.length > 5) {
                    this.showUserMessage('系统遇到多个错误，建议刷新页面', 'warning');
                } else if (!normalizedError.message || !normalizedError.message.includes('Script error')) {
                    this.showUserMessage('系统遇到错误，但仍可继续使用', 'warning');
                }
            } catch (handlingError) {
                console.error('[App] 错误处理失败:', handlingError);
            }
        },
        updateLoadingMessage(message) {
            const loadingText = document.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = message;
            }
        },
        showUserMessage(message, type = 'info') {
            if (window.showMessage) {
                window.showMessage(message, type);
            }
        },
        initializeResponsiveFeatures() {
            this.setupResponsiveEvents();
        },
        setupResponsiveEvents() {
            let resizeTimeout;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    if (this.responsiveManager) {
                        this.responsiveManager.recalculateLayout();
                    }
                    this.handleResize();
                }, 250);
            });
            window.addEventListener('orientationchange', () => {
                setTimeout(() => {
                    if (this.responsiveManager) {
                        this.responsiveManager.recalculateLayout();
                    }
                    this.adjustForOrientation();
                }, 100);
            });
        },
        adjustForOrientation() {
            const isLandscape = window.innerHeight < window.innerWidth;
            if (isLandscape && window.innerWidth <= 768) {
                document.body.classList.add('mobile-landscape');
                const header = document.querySelector('.main-header');
                if (header) {
                    header.style.padding = '0.5rem 0';
                }
                const statsGrid = document.querySelector('.stats-overview');
                if (statsGrid) {
                    statsGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
                    statsGrid.style.marginBottom = '1rem';
                }
            } else {
                document.body.classList.remove('mobile-landscape');
                const header = document.querySelector('.main-header');
                if (header) {
                    header.style.padding = '';
                }
                const statsGrid = document.querySelector('.stats-overview');
                if (statsGrid) {
                    statsGrid.style.gridTemplateColumns = '';
                    statsGrid.style.marginBottom = '';
                }
            }
        },
        setupEventListeners() {
            document.addEventListener('click', (e) => {
                const navBtn = e.target.closest('.nav-btn');
                if (navBtn) {
                    const view = navBtn.dataset.view;
                    if (view) {
                        this.navigateToView(view);
                    }
                }
                const backBtn = e.target.closest('.btn-back');
                if (backBtn) {
                    this.navigateToView('overview');
                }
                const actionBtn = e.target.closest('[data-action]');
                if (actionBtn) {
                    const action = actionBtn.dataset.action;
                    const category = actionBtn.dataset.category;
                    this.handleCategoryAction(action, category);
                }
            });
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && this.isInitialized) {
                    this.refreshData();
                }
            });
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    switch (e.key) {
                        case '1':
                            e.preventDefault();
                            this.navigateToView('overview');
                            break;
                        case '2':
                            e.preventDefault();
                            this.navigateToView('practice');
                            break;
                        case '3':
                            e.preventDefault();
                            this.navigateToView('analysis');
                            break;
                        case '4':
                            e.preventDefault();
                            this.navigateToView('goals');
                            break;
                        default:
                            break;
                    }
                }
            });
        },
        async loadInitialData() {
            try {
                const examIndex = await storage.get('exam_index', []);
                if (Array.isArray(examIndex)) {
                    this.setState('exam.index', examIndex);
                }
                const practiceRecords = await storage.get('practice_records', []);
                if (Array.isArray(practiceRecords)) {
                    this.setState('practice.records', practiceRecords);
                }
                const browseFilter = await storage.get('browse_filter', { category: 'all', type: 'all' });
                this.setState('ui.browseFilter', browseFilter);
                await this.loadUserStats();
                this.updateOverviewStats();
            } catch (error) {
                console.error('Failed to load initial data:', error);
            }
        },
        async loadUserStats() {
            const stats = await storage.get('user_stats', {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                lastPracticeDate: null,
                achievements: []
            });
            this.userStats = stats;
            return stats;
        },
        async updateOverviewStats() {
            const examIndex = this.getState('exam.index') || [];
            const practiceRecords = this.getState('practice.records') || [];
            if (!Array.isArray(examIndex) || !Array.isArray(practiceRecords)) {
                console.warn('[App] 状态管理中的数据格式异常');
                return;
            }
            const totalExams = examIndex.length;
            const completedExams = new Set(practiceRecords.map((r) => r.examId)).size;
            const averageAccuracy = this.calculateAverageAccuracy(practiceRecords);
            const studyDays = this.calculateStudyDays(practiceRecords);
            this.updateStatElement('total-exams', totalExams);
            this.updateStatElement('completed-exams', completedExams);
            this.updateStatElement('average-accuracy', `${averageAccuracy}%`);
            this.updateStatElement('study-days', studyDays);
            this.updateCategoryStats(examIndex, practiceRecords);
            this.renderOverviewCards(examIndex);
        },
        updateStatElement(id, value) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        },
        normalizePracticeAccuracy(record) {
            const value = record && record.accuracy;
            if (value == null || value === '') {
                return null;
            }
            const numeric = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(numeric) || numeric < 0) {
                return null;
            }
            return Math.min(1, numeric > 1 && numeric <= 100 ? numeric / 100 : numeric);
        },
        calculateAverageAccuracy(records) {
            if (!Array.isArray(records) || records.length === 0) {
                return 0;
            }
            const validAccuracies = records
                .map((record) => this.normalizePracticeAccuracy(record))
                .filter((value) => value !== null);
            if (!validAccuracies.length) {
                return 0;
            }
            const totalAccuracy = validAccuracies.reduce((sum, value) => sum + value, 0);
            return Math.round((totalAccuracy / validAccuracies.length) * 100);
        },
        calculateStudyDays(records) {
            if (!Array.isArray(records) || records.length === 0) {
                return 0;
            }
            const dates = new Set(records
                .map((record) => {
                    const timestamp = record && (record.startTime || record.completedAt || record.timestamp);
                    const date = new Date(timestamp);
                    return Number.isFinite(date.getTime()) ? date.toDateString() : '';
                })
                .filter(Boolean));
            return dates.size;
        },
        updateCategoryStats(examIndex, practiceRecords) {
            const categories = ['P1', 'P2', 'P3'];
            const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
            categories.forEach((category) => {
                const escapedCategory = escapeCssSelectorValue(category);
                const categoryExams = list.filter((exam) => exam.category === category);
                const categoryRecords = practiceRecords.filter((record) => {
                    const exam = list.find((e) => e.id === record.examId);
                    return exam && exam.category === category;
                });
                const completed = new Set(categoryRecords.map((r) => r.examId)).size;
                const total = categoryExams.length;
                const progress = total > 0 ? (completed / total) * 100 : 0;
                const progressBar = document.querySelector(`[data-category="${escapedCategory}"] .progress-fill`);
                if (progressBar) {
                    progressBar.style.width = `${progress}%`;
                    progressBar.dataset.progress = progress;
                }
                const progressText = document.querySelector(`[data-category="${escapedCategory}"] .progress-text`);
                if (progressText) {
                    progressText.textContent = `${completed}/${total} 已完成`;
                }
            });
        },
        renderOverviewCards(examIndex) {
            const list = Array.isArray(examIndex) ? examIndex : [];
            const statsService = window.AppServices && window.AppServices.overviewStats;
            const OverviewView = window.AppViews && window.AppViews.OverviewView;
            const container = document.getElementById('category-overview');
            if (!container || !statsService || typeof statsService.calculate !== 'function' || typeof OverviewView !== 'function') {
                return;
            }
            if (!this._overviewViewInstance) {
                this._overviewViewInstance = new OverviewView({ containerSelector: '#category-overview' });
            }
            const stats = statsService.calculate(list);
            const app = this;
            this._overviewViewInstance.render(stats, {
                container,
                actions: {
                    onBrowseCategory(category, type, filterMode, path) {
                        try {
                            if (typeof window.requestBrowseAutoScroll === 'function') {
                                window.requestBrowseAutoScroll(category, type);
                            }
                        } catch (_) {}
                        if (typeof window.browseCategory === 'function') {
                            window.browseCategory(category, type, filterMode, path);
                            return;
                        }
                        if (app && typeof app.browseCategory === 'function') {
                            app.browseCategory(category, type, filterMode, path);
                            return;
                        }
                        try {
                            window.__pendingBrowseFilter = { category: category || 'all', type: type || 'all', filterMode: filterMode || null, path: path || null };
                        } catch (_) {}
                        if (typeof window.showView === 'function') {
                            window.showView('browse', false);
                        }
                    },
                    onRandomPractice(category, type, filterMode, path) {
                        if (window.AppActions && typeof window.AppActions.startRandomPractice === 'function') {
                            window.AppActions.startRandomPractice(category, type, filterMode, path);
                            return;
                        }
                        if (typeof window.showMessage === 'function') {
                            window.showMessage('随机练习模块未就绪', 'warning');
                        }
                    },
                    onStartSuite() {
                        const ensureSuiteReady = window.AppEntry && typeof window.AppEntry.ensureSessionSuiteReady === 'function'
                            ? window.AppEntry.ensureSessionSuiteReady()
                            : Promise.resolve();
                        Promise.resolve(ensureSuiteReady).then(() => {
                            if (window.AppActions && typeof window.AppActions.startSuitePractice === 'function') {
                                window.AppActions.startSuitePractice();
                                return;
                            }
                            if (typeof window.showMessage === 'function') {
                                window.showMessage('套题模块未就绪', 'warning');
                            }
                        }).catch((error) => {
                            console.error('[App] 套题模块加载失败:', error);
                            if (typeof window.showMessage === 'function') {
                                window.showMessage('套题模块加载失败，请稍后重试', 'error');
                            }
                        });
                    },
                    onStartEndless() {
                        if (window.AppActions && typeof window.AppActions.startEndlessPractice === 'function') {
                            window.AppActions.startEndlessPractice();
                            return;
                        }
                        if (typeof window.showMessage === 'function') {
                            window.showMessage('无尽模式未就绪，请稍后重试', 'warning');
                        }
                    }
                }
            });
        },
        refreshOverviewData() {
            this.updateOverviewStats();
        },
        isMobile() {
            try {
                return Number(window.innerWidth) <= 768;
            } catch (_) {
                return false;
            }
        },
        handleResize() {
            if (this.isMobile()) {
                document.body.classList.add('mobile');
            } else {
                document.body.classList.remove('mobile');
            }
        },
        async refreshData() {
            try {
                await this.loadInitialData();
                this.onViewActivated(this.currentView);
            } catch (error) {
                console.error('Failed to refresh data:', error);
            }
        },
        destroy() {
            this.persistMultipleState({
                'exam.index': 'exam_index',
                'practice.records': 'practice_records',
                'ui.browseFilter': 'browse_filter',
                'exam.currentCategory': 'current_category',
                'exam.currentExamType': 'current_exam_type'
            });
            window.removeEventListener('resize', this.handleResize);
            if (this.sessionMonitorInterval) {
                clearInterval(this.sessionMonitorInterval);
            }
            if (this._practiceRecorderUpgradeTimer) {
                clearInterval(this._practiceRecorderUpgradeTimer);
                this._practiceRecorderUpgradeTimer = null;
            }
            if (this.examWindows) {
                this.examWindows.forEach((windowData, examId) => {
                    if (windowData.window && !windowData.window.closed) {
                        windowData.window.close();
                    }
                    this.cleanupExamSession(examId);
                });
            }
            if (this.state.practice.selectedRecords) {
                this.state.practice.selectedRecords.clear();
            }
            if (this.state.system.processedSessions) {
                this.state.system.processedSessions.clear();
            }
            if (this.state.system.fallbackExamSessions) {
                this.state.system.fallbackExamSessions.clear();
            }
            Object.values(this.components).forEach((component) => {
                if (component && typeof component.destroy === 'function') {
                    component.destroy();
                }
            });
            this.isInitialized = false;
        }
    };

    Object.assign(
        ExamSystemApp.prototype,
        integratedStateMixin,
        integratedBootstrapMixin,
        integratedLifecycleMixin,
        integratedNavigationMixin,
        integratedFallbackMixin
    );

    function applyMixins() {
        const mixins = global.ExamSystemAppMixins || {};
        Object.assign(
            ExamSystemApp.prototype,
            mixins.examSession || {},
            mixins.suitePractice || {},
            mixins.state || {},
            mixins.bootstrap || {},
            mixins.lifecycle || {},
            mixins.navigation || {},
            mixins.fallback || {}
        );
    }

    applyMixins();
    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.__applyToApp = applyMixins;
})(typeof window !== 'undefined' ? window : globalThis);


// 新增修复3E：在js/app.js的DOMContentLoaded初始化中去除顶层await
// 应用启动
document.addEventListener('DOMContentLoaded', () => {
    const existingPracticeConfig = (window.practiceConfig && typeof window.practiceConfig === 'object')
        ? window.practiceConfig
        : {};
    const existingSuiteConfig = (existingPracticeConfig.suite && typeof existingPracticeConfig.suite === 'object')
        ? existingPracticeConfig.suite
        : {};
    window.practiceConfig = Object.assign({}, existingPracticeConfig, {
        suite: Object.assign({
            autoAdvanceAfterSubmit: true,
            flowMode: 'classic'
        }, existingSuiteConfig)
    });

    const signalAppCoreReady = () => {
        try {
            window.dispatchEvent(new CustomEvent('appCoreReady'));
        } catch (_) { }
    };

    const startApp = () => {
        try {
            const mixinGlue = window.ExamSystemAppMixins && window.ExamSystemAppMixins.__applyToApp;
            if (typeof mixinGlue === 'function') {
                mixinGlue();
            }
            (function () {
                try {
                    window.app = new ExamSystemApp();
                    Promise.resolve(window.app.initialize())
                        .catch((error) => {
                            console.error('[App] 初始化失败:', error);
                        })
                        .finally(() => {
                            signalAppCoreReady();
                        });
                } catch (e) {
                    console.error('[App] 初始化失败:', e);
                    signalAppCoreReady();
                }
            })();
        } catch (error) {
            console.error('Failed to start application:', error);
            if (window.handleError) {
                window.handleError(error, 'Application Startup');
            } else {
                // Fallback: non-blocking user message if error handler is unavailable
                try {
                    const container = document.getElementById('message-container');
                    if (container) {
                        const msg = document.createElement('div');
                        msg.className = 'message error';
                        msg.textContent = '系统启动失败，请检查控制台日志。';
                        container.appendChild(msg);
                    }
                } catch (_) {
                    // no-op
                }
            }
            signalAppCoreReady();
        }
    };

    startApp();
});

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app.destroy();
    }
});
