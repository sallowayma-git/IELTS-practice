const DEFAULT_INTERACTION_TARGETS = Object.freeze({
    mainNavigationViews: ['overview', 'browse', 'practice', 'settings'],
    settingsButtonIds: [
        'clear-cache-btn',
        'load-library-btn',
        'library-config-btn',
        'force-refresh-btn',
        'create-backup-btn',
        'backup-list-btn',
        'export-data-btn',
        'import-data-btn'
    ]
});

function resolveInteractionTargets() {
    const globalTargets = typeof window !== 'undefined' ? window.__E2E_INTERACTION_TARGETS__ : null;
    if (!globalTargets || typeof globalTargets !== 'object') {
        return DEFAULT_INTERACTION_TARGETS;
    }
    const views = Array.isArray(globalTargets.mainNavigationViews) && globalTargets.mainNavigationViews.length
        ? globalTargets.mainNavigationViews.slice()
        : DEFAULT_INTERACTION_TARGETS.mainNavigationViews.slice();
    const settingsButtons = Array.isArray(globalTargets.settingsButtonIds) && globalTargets.settingsButtonIds.length
        ? globalTargets.settingsButtonIds.slice()
        : DEFAULT_INTERACTION_TARGETS.settingsButtonIds.slice();
    return Object.freeze({
        mainNavigationViews: views,
        settingsButtonIds: settingsButtons
    });
}

const INTERACTION_TARGETS = resolveInteractionTargets();

const SETTINGS_BUTTON_TESTS = {
    'clear-cache-btn': {
        name: '设置 - 清除缓存按钮',
        stubbed: ['clearCache'],
        stubImplementation: () => Promise.resolve('cleared')
    },
    'load-library-btn': {
        name: '设置 - 加载题库按钮',
        stubbed: ['showLibraryLoaderModal', 'loadLibrary'],
        stubImplementation: () => Promise.resolve('loaded')
    },
    'library-config-btn': {
        name: '设置 - 题库配置列表按钮',
        expectInvocation: false,
        waitForSelector: '.library-config-list',
        waitDescription: '题库配置列表渲染',
        cleanupSelector: '.library-config-list'
    },
    'force-refresh-btn': {
        name: '设置 - 强制刷新题库按钮',
        stubbed: ['loadLibrary'],
        stubImplementation: () => Promise.resolve('refreshed')
    },
    'create-backup-btn': {
        name: '设置 - 创建手动备份按钮',
        stubbed: ['createManualBackup'],
        stubImplementation: () => Promise.resolve({ id: 'stub-backup' })
    },
    'backup-list-btn': {
        name: '设置 - 查看备份列表按钮',
        expectInvocation: false,
        waitForSelector: '.backup-list-container',
        waitDescription: '备份列表渲染',
        cleanupSelector: '.backup-list-container'
    },
    'export-data-btn': {
        name: '设置 - 导出数据按钮',
        stubbed: ['exportAllData'],
        stubImplementation: () => ({ downloaded: true })
    },
    'import-data-btn': {
        name: '设置 - 导入数据按钮',
        stubbed: ['importData'],
        stubImplementation: () => Promise.resolve('import-started')
    }
};

class AppE2ETestSuite {
    constructor(frame, { statusEl, statusTextEl, resultsTable }) {
        this.frame = frame;
        this.statusEl = statusEl;
        this.statusTextEl = statusTextEl;
        this.resultsTable = resultsTable;
        this.results = [];
        this.win = null;
        this.doc = null;
        this.originalPracticeRecords = null;
    }

    setStatus(message) {
        if (this.statusTextEl) {
            this.statusTextEl.textContent = message;
        }
    }

    async waitFor(condition, { timeout = 8000, interval = 50, description = '等待条件成立' } = {}) {
        const start = performance.now();
        return new Promise((resolve, reject) => {
            const check = () => {
                try {
                    if (condition()) {
                        resolve();
                        return;
                    }
                } catch (error) {
                    reject(error);
                    return;
                }
                if (performance.now() - start >= timeout) {
                    reject(new Error(`${description} 超时 (${timeout}ms)`));
                    return;
                }
                setTimeout(check, interval);
            };
            check();
        });
    }

    recordResult(name, passed, details) {
        const result = { name, passed, details };
        this.results.push(result);

        if (!this.resultsTable) {
            return;
        }

        const row = document.createElement('tr');
        row.className = passed ? 'pass' : 'fail';

        const statusCell = document.createElement('td');
        statusCell.className = 'status';
        statusCell.textContent = passed ? '✅ 成功' : '❌ 失败';

        const nameCell = document.createElement('td');
        nameCell.textContent = name;

        const detailCell = document.createElement('td');
        detailCell.className = 'details';
        detailCell.textContent = this.formatDetails(details);

        row.appendChild(statusCell);
        row.appendChild(nameCell);
        row.appendChild(detailCell);
        this.resultsTable.appendChild(row);
    }

    formatDetails(details) {
        if (details === undefined || details === null) {
            return '';
        }
        if (typeof details === 'string') {
            return details;
        }
        try {
            return JSON.stringify(details, null, 2);
        } catch (_) {
            return String(details);
        }
    }

    async setup() {
        this.win = this.frame.contentWindow;
        this.doc = this.win.document;
        await this.waitFor(() => this.doc && this.doc.readyState === 'complete', {
            timeout: 10000,
            description: '主应用 DOM 加载完成'
        });
        await this.waitFor(() => this.win.app && this.win.app.isInitialized, {
            timeout: 15000,
            description: '主应用完成初始化'
        });

        if (this.win.simpleStorageWrapper && typeof this.win.simpleStorageWrapper.getPracticeRecords === 'function') {
            try {
                this.originalPracticeRecords = await this.win.simpleStorageWrapper.getPracticeRecords();
            } catch (error) {
                console.warn('[E2E] 备份练习记录失败:', error);
                this.originalPracticeRecords = null;
            }
        }
    }

    async teardown() {
        if (this.originalPracticeRecords && this.win?.simpleStorageWrapper) {
            try {
                await this.win.simpleStorageWrapper.savePracticeRecords(this.originalPracticeRecords);
                if (typeof this.win.syncPracticeRecords === 'function') {
                    await this.win.syncPracticeRecords();
                }
            } catch (error) {
                console.warn('[E2E] 恢复原始练习记录失败:', error);
            }
        }
        if (this.win && typeof this.win.showView === 'function') {
            try { this.win.showView('overview'); } catch (_) {}
        }
    }

    async run() {
        try {
            this.setStatus('正在等待应用初始化...');
            await this.setup();
            this.setStatus('应用已就绪，开始执行测试...');

            await this.testInitialization();
            await this.testOverviewRendering();
            await this.testMainNavigationButtons();
            await this.testBrowseNavigation();
            await this.testExamFiltering();
            await this.testSearchFunction();
            await this.testExamActionButtons();
            await this.testExamEmptyStateAction();
            await this.testLegacyBridgeSynchronization();
            await this.testPracticeRecordsFlow();
            await this.testPracticeHistoryBulkDelete();
            await this.testPracticeSubmissionMessageFlow();
            await this.testSettingsControlButtons();
            await this.testThemePortals();

            this.setStatus('全部测试执行完毕');
        } catch (error) {
            this.recordResult('测试套件初始化', false, error.message || String(error));
            this.setStatus('执行中断: ' + (error.message || error));
        } finally {
            await this.teardown();
            this.renderSummary();
        }
    }

    renderSummary() {
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.length - passed;
        const summary = `已完成 ${this.results.length} 项测试 · ✅ ${passed} · ❌ ${failed}`;
        this.setStatus(summary);

        if (this.statusEl) {
            this.statusEl.textContent = failed > 0 ? '部分失败' : '全部通过';
            this.statusEl.className = failed > 0 ? 'status-badge fail' : 'status-badge pass';
        }

        const summaryState = {
            total: this.results.length,
            passed,
            failed,
            proxyConfig: window.__APP_FRAME_PROXY_CONFIG__ || window.__E2E_PROXY_CONFIG__ || null,
            results: this.results.slice()
        };

        window.__E2E_TEST_RESULTS__ = summaryState;
        try {
            window.dispatchEvent(new CustomEvent('app-e2e-suite:complete', { detail: summaryState }));
        } catch (error) {
            console.warn('[E2E] 分发测试完成事件失败', error);
        }
    }

    async testInitialization() {
        const name = '应用初始化状态';
        try {
            const activeView = this.doc.querySelector('.view.active');
            const activeNav = this.doc.querySelector('.main-nav .nav-btn.active');
            const stats = {
                activeView: activeView ? activeView.id : null,
                activeNav: activeNav ? activeNav.getAttribute('data-view') : null,
                appInitialized: !!(this.win.app && this.win.app.isInitialized)
            };
            const passed = stats.appInitialized && stats.activeView === 'overview-view' && stats.activeNav === 'overview';
            this.recordResult(name, passed, stats);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async testOverviewRendering() {
        const name = '概览视图渲染结构';
        try {
            await this.waitFor(() => this.doc.querySelectorAll('#category-overview .category-card').length >= 3, {
                timeout: 6000,
                description: '概览卡片渲染完成'
            });

            const browseButtons = Array.from(this.doc.querySelectorAll('#category-overview button[data-action="browse-category"]'));
            const randomButtons = Array.from(this.doc.querySelectorAll('#category-overview button[data-action="start-random-practice"]'));
            const allButtons = browseButtons.concat(randomButtons);

            const datasetSummary = allButtons.slice(0, 4).map((btn) => ({
                action: btn.dataset.action,
                category: btn.dataset.category,
                type: btn.dataset.type
            }));

            const hasDelegatedAttributes = allButtons.every((btn) => btn.dataset.action && btn.dataset.category && btn.dataset.type);
            const hasReadingEntry = browseButtons.some((btn) => btn.dataset.type === 'reading');
            const hasRandomEntry = randomButtons.length > 0;

            const details = {
                cardCount: this.doc.querySelectorAll('#category-overview .category-card').length,
                buttonCount: allButtons.length,
                sampleDatasets: datasetSummary
            };

            this.recordResult(name, hasDelegatedAttributes && hasReadingEntry && hasRandomEntry, details);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async testMainNavigationButtons() {
        const name = '主导航按钮交互';
        try {
            const expectedViews = (Array.isArray(INTERACTION_TARGETS.mainNavigationViews) && INTERACTION_TARGETS.mainNavigationViews.length)
                ? INTERACTION_TARGETS.mainNavigationViews
                : DEFAULT_INTERACTION_TARGETS.mainNavigationViews;
            const flows = [];

            for (const view of expectedViews) {
                const button = this.doc.querySelector(`.main-nav .nav-btn[data-view="${view}"]`);
                if (!button) {
                    flows.push({ view, missing: true });
                    continue;
                }

                button.click();
                await this.waitFor(() => this.doc.getElementById(`${view}-view`)?.classList.contains('active'), {
                    timeout: 6000,
                    description: `切换到 ${view} 视图`
                });

                const viewElement = this.doc.getElementById(`${view}-view`);
                const navActive = button.classList.contains('active');
                const viewActive = !!(viewElement && viewElement.classList.contains('active'));
                flows.push({ view, navActive, viewActive });
            }

            if (typeof this.win.showView === 'function') {
                try { this.win.showView('overview'); } catch (_) {}
            }

            const expectedCount = expectedViews.length;
            const validFlows = flows.filter(flow => !flow.missing);
            const passed = validFlows.length === expectedCount && validFlows.every(flow => flow.viewActive && flow.navActive);
            this.recordResult(name, passed, { flows, expectedCount });
        } catch (error) {
            this.recordResult(name, false, error?.message || String(error));
        }
    }

    async ensureBrowseView() {
        if (!this.doc.getElementById('browse-view')?.classList.contains('active')) {
            if (typeof this.win.showView === 'function') {
                this.win.showView('browse');
            }
            await this.waitFor(() => this.doc.getElementById('browse-view')?.classList.contains('active'), {
                timeout: 4000,
                description: '切换到题库浏览视图'
            });
        }
    }

    async ensureSettingsView() {
        if (!this.doc.getElementById('settings-view')?.classList.contains('active')) {
            if (typeof this.win.showView === 'function') {
                this.win.showView('settings');
            }
            await this.waitFor(() => this.doc.getElementById('settings-view')?.classList.contains('active'), {
                timeout: 5000,
                description: '切换到设置视图'
            });
        }

        await this.waitFor(() => {
            const settingsView = this.doc.getElementById('settings-view');
            if (!settingsView) {
                return false;
            }
            const buttons = settingsView.querySelectorAll('button');
            return buttons && buttons.length >= 8;
        }, {
            timeout: 6000,
            description: '设置视图按钮渲染'
        });
    }

    delay(ms = 120) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    resolvePropertyPath(path) {
        if (!path) {
            return null;
        }
        const segments = path.split('.');
        let context = this.win;
        for (let i = 0; i < segments.length - 1; i++) {
            if (!context) {
                return null;
            }
            context = context[segments[i]];
        }
        if (!context) {
            return null;
        }
        const key = segments[segments.length - 1];
        return { context, key };
    }

    async runSettingsButtonAssertion(action) {
        const { id, name } = action;
        try {
            const button = this.doc.getElementById(id);
            if (!button) {
                this.recordResult(name, false, `未找到按钮 #${id}`);
                return;
            }

            const details = { buttonId: id };
            let invoked = false;
            let invokedMethod = null;
            let selectorElement = null;
            let selectorError = null;
            let conditionError = null;
            let stubbed = false;
            const restores = [];

            if (Array.isArray(action.stubbed) && action.stubbed.length > 0) {
                for (const candidate of action.stubbed) {
                    const resolved = this.resolvePropertyPath(candidate);
                    if (!resolved || typeof resolved.context?.[resolved.key] !== 'function') {
                        continue;
                    }

                    const original = resolved.context[resolved.key];
                    const impl = action.stubImplementation || (() => Promise.resolve('stubbed'));
                    resolved.context[resolved.key] = (...args) => {
                        invoked = true;
                        invokedMethod = candidate;
                        try {
                            return impl({ args, original, context: resolved.context, action });
                        } catch (error) {
                            details.stubError = error?.message || String(error);
                            return undefined;
                        }
                    };
                    restores.push(() => { resolved.context[resolved.key] = original; });
                    stubbed = true;
                    details.stubbedMethod = candidate;
                    break;
                }

                if (!stubbed && action.requireHandler !== false) {
                    this.recordResult(name, false, {
                        reason: '未找到可替换的处理函数',
                        candidates: action.stubbed
                    });
                    return;
                }
            }

            button.click();
            await this.delay(action.postClickDelay || 160);

            if (action.waitForSelector) {
                try {
                    await this.waitFor(() => {
                        selectorElement = this.doc.querySelector(action.waitForSelector);
                        return !!selectorElement;
                    }, {
                        timeout: action.waitTimeout || 4000,
                        description: action.waitDescription || `${name} DOM 更新`
                    });
                } catch (error) {
                    selectorError = error?.message || String(error);
                }
            }

            if (action.waitForCondition) {
                try {
                    await this.waitFor(() => action.waitForCondition({
                        doc: this.doc,
                        win: this.win,
                        invoked,
                        selectorElement
                    }), {
                        timeout: action.waitTimeout || 2000,
                        description: action.waitDescription || `${name} 条件验证`
                    });
                } catch (error) {
                    conditionError = error?.message || String(error);
                }
            }

            restores.forEach((restore) => {
                try { restore(); } catch (_) {}
            });

            if (action.cleanupSelector === true && selectorElement?.remove) {
                try { selectorElement.remove(); } catch (_) {}
            } else if (typeof action.cleanupSelector === 'string') {
                const cleanupEl = this.doc.querySelector(action.cleanupSelector);
                if (cleanupEl?.remove) {
                    try { cleanupEl.remove(); } catch (_) {}
                }
            }

            const domVerified = action.waitForSelector ? (!!selectorElement && !selectorError) : undefined;
            const conditionVerified = action.waitForCondition ? !conditionError : undefined;
            const invocationRequired = stubbed && action.expectInvocation !== false;
            const invocationSatisfied = invocationRequired ? invoked : true;
            const domSatisfied = action.waitForSelector ? !!selectorElement && !selectorError : true;
            const conditionSatisfied = action.waitForCondition ? !conditionError : true;
            const passed = invocationSatisfied && domSatisfied && conditionSatisfied;

            details.invoked = invoked;
            if (invokedMethod) {
                details.invokedMethod = invokedMethod;
            }
            if (selectorElement) {
                details.domVerified = true;
                details.domPreview = selectorElement.outerHTML?.slice(0, 200);
            }
            if (selectorError) {
                details.domError = selectorError;
            }
            if (conditionError) {
                details.conditionError = conditionError;
            }

            this.recordResult(name, passed, details);
        } catch (error) {
            this.recordResult(name, false, error?.message || String(error));
        }
    }

    async testSettingsControlButtons() {
        await this.ensureSettingsView();

        const requiredIds = (Array.isArray(INTERACTION_TARGETS.settingsButtonIds) && INTERACTION_TARGETS.settingsButtonIds.length)
            ? INTERACTION_TARGETS.settingsButtonIds
            : DEFAULT_INTERACTION_TARGETS.settingsButtonIds;

        for (const buttonId of requiredIds) {
            const plan = SETTINGS_BUTTON_TESTS[buttonId];
            if (!plan) {
                this.recordResult(`设置按钮测试缺失: ${buttonId}`, false, {
                    reason: '未在测试计划中定义',
                    buttonId
                });
                continue;
            }

            const action = Object.assign({ id: buttonId }, plan);
            if (!action.name) {
                action.name = `设置 - ${buttonId}`;
            }

            await this.runSettingsButtonAssertion(action);
        }
    }

    async testThemePortals() {
        const repoRoot = new URL('../../../', window.location.href);
        const themes = [
            {
                name: 'HP Portal',
                path: '.superdesign/design_iterations/HP/Welcome.html',
                validator: async function hpPortalValidator(win, doc) {
                    await this.waitFor(() => win.hpPortal && win.hpPortal.state, {
                        timeout: 9000,
                        description: 'HP Portal 初始化'
                    });
                    const practiceList = doc.getElementById('hp-practice-list');
                    await this.waitFor(() => practiceList && practiceList.dataset.mode, {
                        timeout: 7000,
                        description: 'HP 练习列表模式就绪'
                    }).catch(() => {});
                    const navCount = doc.querySelectorAll('[data-hp-view]').length;
                    const chart = doc.getElementById('hp-history-chart');
                    const chartPoints = chart && chart.dataset.pointCount ? Number(chart.dataset.pointCount) : 0;
                    const practiceMode = practiceList ? (practiceList.dataset.mode || 'unknown') : 'missing';
                    const virtualized = !!(win.hpPortal && win.hpPortal.practiceVirtualizer);
                    const details = { navCount, practiceMode, virtualized, chartPoints };
                    const passed = navCount >= 4 && !!practiceList && !!chart;
                    return { passed, details };
                }
            },
            {
                name: 'Marauder Map',
                path: '.superdesign/design_iterations/HarryPoter.html',
                validator: async function marauderValidator(_win, doc) {
                    const viewport = doc.querySelector('.map-viewport');
                    const stage = doc.querySelector('.stage');
                    const details = { hasViewport: !!viewport, hasStage: !!stage };
                    return { passed: !!viewport && !!stage, details };
                }
            },
            {
                name: 'My Melody Prototype',
                path: '.superdesign/design_iterations/my_melody_ielts_1.html',
                validator: async function melodyValidator(win, doc) {
                    await this.waitFor(() => doc.querySelector('.container'), {
                        timeout: 8000,
                        description: 'My Melody 主容器加载'
                    });
                    const shell = doc.querySelector('.container');
                    const optimizerReady = !!win.performanceOptimizer;
                    const navIslands = doc.querySelectorAll('.nav-islands .island').length;
                    const details = { hasShell: !!shell, optimizerReady, navIslands };
                    return { passed: !!shell && navIslands >= 3, details };
                }
            }
        ];

        for (const theme of themes) {
            try {
                const url = new URL(theme.path, repoRoot).href;
                const result = await this.withThemePage(url, theme.validator.bind(this));
                const passed = typeof result?.passed === 'boolean' ? result.passed : !!result;
                const details = result && result.details !== undefined ? result.details : (result || {});
                this.recordResult(`主题：${theme.name}`, passed, details);
            } catch (error) {
                this.recordResult(`主题：${theme.name}`, false, error?.message || String(error));
            }
        }
    }

    async withThemePage(url, validator) {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
        frame.style.position = 'absolute';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.opacity = '0';
        document.body.appendChild(frame);

        await new Promise((resolve, reject) => {
            frame.onload = () => resolve();
            frame.onerror = (event) => reject(event?.error || new Error('主题页面加载失败'));
            frame.src = url;
        });

        try {
            const win = frame.contentWindow;
            const doc = frame.contentDocument || win.document;
            return await validator(win, doc);
        } finally {
            frame.remove();
        }
    }

    async testBrowseNavigation() {
        const name = '切换到题库浏览视图';
        try {
            await this.ensureBrowseView();
            const activeNav = this.doc.querySelector('.main-nav .nav-btn.active');
            const details = {
                activeView: this.doc.getElementById('browse-view')?.classList.contains('active'),
                activeNav: activeNav ? activeNav.getAttribute('data-view') : null
            };
            const passed = details.activeView && details.activeNav === 'browse';
            this.recordResult(name, passed, details);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async waitForExamIndex() {
        await this.waitFor(() => Array.isArray(this.win.examIndex) && this.win.examIndex.length > 0, {
            timeout: 15000,
            description: '题库索引加载完成'
        });
    }

    async testExamFiltering() {
        const nameReading = '题库筛选 - 阅读分类';
        const nameListening = '题库筛选 - 听力分类';

        try {
            await this.ensureBrowseView();
            await this.waitForExamIndex();

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('reading');
            }
            await this.waitFor(() => {
                const filter = this.win.app?.getState?.('ui.browseFilter');
                return filter && filter.type === 'reading';
            }, {
                timeout: 10000,
                description: '阅读筛选状态同步'
            });
            await this.waitFor(() => {
                const metas = Array.from(this.doc.querySelectorAll('#exam-list-container .exam-item .exam-meta'));
                return metas.length > 0 && metas.every(meta => /reading/i.test(meta.textContent || ''));
            }, {
                timeout: 8000,
                description: '阅读筛选卡片渲染'
            });

            const readingMetas = Array.from(this.doc.querySelectorAll('#exam-list-container .exam-item .exam-meta'));
            this.recordResult(nameReading, readingMetas.length > 0 && readingMetas.every(meta => /reading/i.test(meta.textContent || '')), {
                renderedCards: readingMetas.length,
                sampleMeta: readingMetas.slice(0, 3).map(meta => meta.textContent)
            });

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('listening');
            }
            await this.waitFor(() => {
                const filter = this.win.app?.getState?.('ui.browseFilter');
                return filter && filter.type === 'listening';
            }, {
                timeout: 10000,
                description: '听力筛选状态同步'
            });
            await this.waitFor(() => {
                const metas = Array.from(this.doc.querySelectorAll('#exam-list-container .exam-item .exam-meta'));
                return metas.length > 0 && metas.every(meta => /listening/i.test(meta.textContent || ''));
            }, {
                timeout: 8000,
                description: '听力筛选卡片渲染'
            });
            const listeningMetas = Array.from(this.doc.querySelectorAll('#exam-list-container .exam-item .exam-meta'));
            this.recordResult(nameListening, listeningMetas.length > 0 && listeningMetas.every(meta => /listening/i.test(meta.textContent || '')), {
                renderedCards: listeningMetas.length,
                sampleMeta: listeningMetas.slice(0, 3).map(meta => meta.textContent)
            });
        } catch (error) {
            this.recordResult(nameReading, false, error.message || String(error));
            this.recordResult(nameListening, false, '依赖阅读筛选失败，未执行');
        }
    }

    async testSearchFunction() {
        const name = '题库搜索功能';
        try {
            await this.ensureBrowseView();
            await this.waitForExamIndex();

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('all');
            }
            if (typeof this.win.performSearch === 'function') {
                this.win.performSearch('ocean');
            } else if (typeof this.win.searchExams === 'function') {
                this.win.searchExams('ocean');
            }

            await this.waitFor(() => this.doc.querySelectorAll('#exam-list-container .exam-item').length > 0, {
                timeout: 4000,
                description: '搜索结果渲染'
            });

            const cards = Array.from(this.doc.querySelectorAll('#exam-list-container .exam-item'));
            const titles = cards.map(card => card.querySelector('h4')?.textContent || '');
            const normalized = titles.map(text => text.toLowerCase());
            const passed = titles.length > 0 && normalized.every(text => text.includes('ocean'));
            this.recordResult(name, passed, {
                matches: titles,
                matchCount: titles.length
            });

            if (typeof this.win.performSearch === 'function') {
                this.win.performSearch('');
            }
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async testExamActionButtons() {
        const name = '题库操作按钮事件';
        const originalOpenExam = this.win.openExam;
        const originalViewPDF = this.win.viewPDF;
        const originalGenerateHTML = this.win.generateHTML;

        const restore = () => {
            this.win.openExam = originalOpenExam;
            this.win.viewPDF = originalViewPDF;
            this.win.generateHTML = originalGenerateHTML;
        };

        try {
            await this.ensureBrowseView();
            await this.waitForExamIndex();
            await this.waitFor(() => this.doc.querySelectorAll('#exam-list-container .exam-item button[data-action]').length > 0, {
                timeout: 8000,
                description: '题库操作按钮渲染完成'
            });

            const buttons = Array.from(this.doc.querySelectorAll('#exam-list-container .exam-item button[data-action]'));
            const actions = Array.from(new Set(buttons.map((btn) => btn.dataset.action))).filter(Boolean);

            if (!actions.length) {
                this.recordResult(name, false, { reason: '未找到任何操作按钮' });
                return;
            }

            const invoked = {};

            if (actions.includes('start')) {
                this.win.openExam = (examId) => {
                    invoked.start = (invoked.start || 0) + 1;
                    invoked.lastStart = examId;
                    return null;
                };
            }

            if (actions.includes('pdf')) {
                this.win.viewPDF = (examId) => {
                    invoked.pdf = (invoked.pdf || 0) + 1;
                    invoked.lastPdf = examId;
                    return null;
                };
            }

            if (actions.includes('generate') && typeof this.win.generateHTML === 'function') {
                this.win.generateHTML = (examId) => {
                    invoked.generate = (invoked.generate || 0) + 1;
                    invoked.lastGenerate = examId;
                    return null;
                };
            }

            for (const action of actions) {
                const button = this.doc.querySelector(`#exam-list-container button[data-action="${action}"]`);
                if (!button) {
                    continue;
                }
                button.click();
                await new Promise((resolve) => setTimeout(resolve, 40));
            }

            const expected = actions.filter((action) => action === 'start' || action === 'pdf' || action === 'generate');
            const passed = expected.every((action) => (invoked[action] || 0) > 0);
            this.recordResult(name, passed, { actions, invoked });
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        } finally {
            restore();
        }
    }

    async testExamEmptyStateAction() {
        const name = '题库空态加载按钮';
        const originalLoadLibrary = this.win.loadLibrary;

        try {
            await this.ensureBrowseView();
            await this.waitForExamIndex();

            const container = this.doc.getElementById('exam-list-container');
            if (!container) {
                this.recordResult(name, false, '未找到题库容器');
                return;
            }

            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }

            const ViewCtor = this.win.LegacyExamListView;
            if (typeof ViewCtor !== 'function') {
                this.recordResult(name, false, 'LegacyExamListView 未加载');
                return;
            }

            const view = new ViewCtor({ domAdapter: this.win.DOMAdapter, containerId: 'exam-list-container' });
            let invoked = 0;

            this.win.loadLibrary = () => {
                invoked += 1;
                return Promise.resolve();
            };

            const baseConfig = this.win.__legacyExamEmptyStateConfig;
            let emptyConfig = null;
            if (baseConfig) {
                try {
                    emptyConfig = JSON.parse(JSON.stringify(baseConfig));
                } catch (error) {
                    emptyConfig = {
                        icon: baseConfig.icon,
                        title: baseConfig.title,
                        description: baseConfig.description,
                        actionGroupLabel: baseConfig.actionGroupLabel,
                        actions: Array.isArray(baseConfig.actions)
                            ? baseConfig.actions.map((action) => ({
                                action: action.action,
                                label: action.label,
                                variant: action.variant,
                                ariaLabel: action.ariaLabel
                            }))
                            : []
                    };
                }
            }

            view.render([], { emptyState: emptyConfig || { actions: [] } });

            const button = container.querySelector('button[data-action="load-library"]');
            if (!button) {
                this.recordResult(name, false, { reason: '未渲染加载按钮' });
                return;
            }

            button.click();
            await this.delay(60);

            const passed = invoked === 1;
            this.recordResult(name, passed, { invoked, hasButton: !!button });
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        } finally {
            this.win.loadLibrary = originalLoadLibrary;
            if (typeof this.win.displayExams === 'function') {
                try {
                    const exams = Array.isArray(this.win.filteredExams) && this.win.filteredExams.length
                        ? this.win.filteredExams
                        : (Array.isArray(this.win.examIndex) ? this.win.examIndex : []);
                    this.win.displayExams(exams);
                } catch (restoreError) {
                    console.warn('[E2E] 无法恢复题库列表', restoreError);
                }
            }
        }
    }

    async testLegacyBridgeSynchronization() {
        const name = 'Legacy 状态桥同步';
        try {
            const bridge = this.win.LegacyStateBridge?.getInstance?.();
            if (!bridge) {
                this.recordResult(name, false, 'LegacyStateBridge 未加载');
                return;
            }

            const originalExamIndex = Array.isArray(this.win.examIndex) ? this.win.examIndex.slice() : [];
            const originalPractice = Array.isArray(this.win.practiceRecords) ? this.win.practiceRecords.slice() : [];

            const examSampleSize = originalExamIndex.length > 1 ? 1 : originalExamIndex.length;
            const examSample = examSampleSize > 0 ? originalExamIndex.slice(0, examSampleSize) : [];

            bridge.setExamIndex(examSample);
            await this.waitFor(() => {
                const state = this.win.app?.getState?.('exam.index');
                return Array.isArray(state) && state.length === examSample.length;
            }, { description: 'App exam state 接收 Legacy 更新' });
            const examState = this.win.app.getState('exam.index') || [];
            const examSynced = Array.isArray(examState) && examState.length === examSample.length;

            let practiceSynced = true;
            let practiceSampleSize = 0;
            if (originalPractice.length > 0) {
                practiceSampleSize = 1;
                const practiceSample = originalPractice.slice(0, practiceSampleSize);
                bridge.setPracticeRecords(practiceSample);
                await this.waitFor(() => {
                    const state = this.win.app?.getState?.('practice.records');
                    return Array.isArray(state) && state.length === practiceSample.length;
                }, { description: 'App practice state 接收 Legacy 更新' });
                const practiceState = this.win.app.getState('practice.records') || [];
                practiceSynced = Array.isArray(practiceState) && practiceState.length === practiceSample.length;
            }

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('reading');
            } else {
                throw new Error('filterByType 不可用');
            }
            await this.waitFor(() => {
                const filter = this.win.app?.getState?.('ui.browseFilter');
                return filter && filter.type === 'reading';
            }, { description: '浏览筛选通过桥接层同步' });
            const filter = this.win.app.getState('ui.browseFilter') || {};
            const filterSynced = filter.type === 'reading' && (!filter.category || filter.category === 'all');

            bridge.setExamIndex(originalExamIndex);
            await this.waitFor(() => {
                const state = this.win.app?.getState?.('exam.index');
                return Array.isArray(state) && state.length === originalExamIndex.length;
            }, { description: 'App exam state 恢复原始数据' });

            bridge.setPracticeRecords(originalPractice);
            await this.waitFor(() => {
                const state = this.win.app?.getState?.('practice.records');
                return Array.isArray(state) && state.length === originalPractice.length;
            }, { description: 'App practice state 恢复原始数据' });

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('all');
            }
            await this.waitFor(() => {
                const restored = this.win.app?.getState?.('ui.browseFilter');
                return restored && restored.type === 'all';
            }, { description: '浏览筛选恢复默认' });

            this.recordResult(name, examSynced && practiceSynced && filterSynced, {
                examSampleSize,
                practiceSampleSize,
                filterSnapshot: filter
            });
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async testPracticeRecordsFlow() {
        const name = '练习记录同步流程';
        try {
            if (!this.win.simpleStorageWrapper || typeof this.win.simpleStorageWrapper.savePracticeRecords !== 'function') {
                this.recordResult(name, false, 'simpleStorageWrapper 不可用');
                return;
            }

            if (typeof this.win.showView === 'function') {
                this.win.showView('practice');
            }
            await this.waitFor(() => this.doc.getElementById('practice-view')?.classList.contains('active'), {
                timeout: 4000,
                description: '切换到练习记录视图'
            });

            await this.win.simpleStorageWrapper.savePracticeRecords([]);
            if (typeof this.win.syncPracticeRecords === 'function') {
                await this.win.syncPracticeRecords();
            }
            await this.waitFor(() => this.doc.getElementById('total-practiced')?.textContent === '0', {
                timeout: 4000,
                description: '清空练习记录'
            });

            const sampleRecord = {
                id: 'e2e-record',
                title: 'E2E 阅读测试题',
                type: 'reading',
                score: 85,
                percentage: 85,
                totalQuestions: 40,
                correctAnswers: 34,
                duration: 1800,
                date: new Date().toISOString(),
                dataSource: 'real'
            };

            await this.win.simpleStorageWrapper.savePracticeRecords([sampleRecord]);
            if (typeof this.win.syncPracticeRecords === 'function') {
                await this.win.syncPracticeRecords();
            }

            await this.waitFor(() => this.doc.getElementById('total-practiced')?.textContent === '1', {
                timeout: 5000,
                description: '新练习记录渲染'
            });

            const stats = {
                total: this.doc.getElementById('total-practiced')?.textContent,
                average: this.doc.getElementById('avg-score')?.textContent,
                studyTime: this.doc.getElementById('study-time')?.textContent,
                streak: this.doc.getElementById('streak-days')?.textContent
            };
            const passed = stats.total === '1' && stats.average === '85.0%' && stats.studyTime === '30';
            this.recordResult(name, passed, stats);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async testPracticeHistoryBulkDelete() {
        const name = '练习历史批量删除';
        const sampleRecords = [
            {
                id: 'bulk-a',
                metadata: { examTitle: 'Bulk Delete A', category: 'P1', frequency: 'high' },
                status: 'completed',
                accuracy: 0.85,
                duration: 900,
                correctAnswers: 34,
                totalQuestions: 40,
                startTime: new Date(Date.now() - 3600000).toISOString(),
                endTime: new Date().toISOString()
            },
            {
                id: 'bulk-b',
                metadata: { examTitle: 'Bulk Delete B', category: 'P2', frequency: 'high' },
                status: 'completed',
                accuracy: 0.72,
                duration: 1100,
                correctAnswers: 29,
                totalQuestions: 40,
                startTime: new Date(Date.now() - 5400000).toISOString(),
                endTime: new Date(Date.now() - 4500000).toISOString()
            },
            {
                id: 'bulk-c',
                metadata: { examTitle: 'Bulk Delete C', category: 'P3', frequency: 'low' },
                status: 'completed',
                accuracy: 0.95,
                duration: 1200,
                correctAnswers: 38,
                totalQuestions: 40,
                startTime: new Date(Date.now() - 7200000).toISOString(),
                endTime: new Date(Date.now() - 6300000).toISOString()
            }
        ];

        let originalConfirm = null;

        try {
            if (!this.win.simpleStorageWrapper || typeof this.win.simpleStorageWrapper.savePracticeRecords !== 'function') {
                this.recordResult(name, false, 'simpleStorageWrapper 不可用');
                return;
            }

            if (typeof this.win.showView === 'function') {
                this.win.showView('practice');
            }

            await this.waitFor(() => this.doc.getElementById('practice-view')?.classList.contains('active'), {
                timeout: 5000,
                description: '切换到练习视图'
            });

            await this.win.simpleStorageWrapper.savePracticeRecords(sampleRecords);
            if (typeof this.win.syncPracticeRecords === 'function') {
                await this.win.syncPracticeRecords();
            }

            await this.waitFor(() => this.doc.querySelectorAll('#history-list .history-record-item').length >= sampleRecords.length, {
                timeout: 6000,
                description: '渲染批量删除测试数据'
            });

            originalConfirm = this.win.confirm;
            this.win.confirm = () => true;

            const selectIds = ['bulk-a', 'bulk-b'];
            for (const recordId of selectIds) {
                const checkbox = this.doc.querySelector(`#history-list input[data-record-id="${recordId}"]`);
                if (!checkbox) {
                    throw new Error(`未找到记录复选框: ${recordId}`);
                }
                checkbox.click();
            }

            await this.waitFor(() => {
                const btn = this.doc.getElementById('bulk-delete-btn');
                return btn && btn.style.display !== 'none' && /\(2\)/.test(btn.textContent);
            }, { timeout: 4000, description: '批量删除按钮显示选择数量' });

            const deleteBtn = this.doc.getElementById('bulk-delete-btn');
            if (!deleteBtn) {
                throw new Error('批量删除按钮缺失');
            }
            deleteBtn.click();

            await this.waitFor(() => this.doc.querySelectorAll('#history-list .history-record-item').length === 1, {
                timeout: 6000,
                description: '等待列表刷新到剩余记录'
            });

            const remaining = await this.win.simpleStorageWrapper.getPracticeRecords();
            const remainingIds = Array.isArray(remaining) ? remaining.map(record => record.id) : [];
            const passed = remainingIds.length === 1 && remainingIds[0] === 'bulk-c';

            this.recordResult(name, passed, { remainingIds });
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        } finally {
            if (originalConfirm) {
                this.win.confirm = originalConfirm;
            }
        }
    }

    async testPracticeSubmissionMessageFlow() {
        const name = '练习页面提交回传';
        const fixtureRelativePath = 'templates/ci-practice-fixtures/analysis-of-fear.html';
        const fixtureUrl = './' + fixtureRelativePath;
        const originalOpen = this.win.open;
        const originalBuildResourcePath = this.win.buildResourcePath;
        const fixtureFrames = [];
        let handledOpen = false;

        try {
            if (!this.win.app || typeof this.win.app.openExam !== 'function') {
                this.recordResult(name, false, 'app.openExam 不可用');
                return;
            }
            if (!this.win.simpleStorageWrapper || typeof this.win.simpleStorageWrapper.savePracticeRecords !== 'function') {
                this.recordResult(name, false, 'simpleStorageWrapper 不可用');
                return;
            }

            await this.waitFor(() => {
                const index = this.win.app?.getState?.('exam.index');
                return Array.isArray(index) && index.length > 0;
            }, { timeout: 8000, description: '加载题库索引' });

            const examIndex = this.win.app?.getState?.('exam.index') || this.win.examIndex || [];
            const targetExam = examIndex.find((exam) => exam && typeof exam.title === 'string' && exam.title.includes('Analysis of Fear'));
            if (!targetExam) {
                this.recordResult(name, false, '未找到目标练习题');
                return;
            }

            await this.win.simpleStorageWrapper.savePracticeRecords([]);
            if (typeof this.win.syncPracticeRecords === 'function') {
                await this.win.syncPracticeRecords();
            }

            if (typeof this.win.showView === 'function') {
                this.win.showView('practice');
            }

            await this.waitFor(() => this.doc.getElementById('practice-view')?.classList.contains('active'), {
                timeout: 4000,
                description: '切换到练习记录视图'
            });

            await this.waitFor(() => this.doc.getElementById('total-practiced')?.textContent === '0', {
                timeout: 4000,
                description: '清空练习记录统计'
            });

            if (typeof originalBuildResourcePath === 'function') {
                this.win.buildResourcePath = (exam, kind = 'html') => {
                    if (exam && exam.id === targetExam.id && kind === 'html') {
                        return fixtureUrl;
                    }
                    return originalBuildResourcePath.call(this.win, exam, kind);
                };
            } else {
                this.win.buildResourcePath = (exam, kind = 'html') => {
                    if (exam && exam.id === targetExam.id && kind === 'html') {
                        return fixtureUrl;
                    }
                    return fixtureUrl;
                };
            }

            this.win.open = (requestedUrl, target, features) => {
                if (handledOpen) {
                    return typeof originalOpen === 'function' ? originalOpen(requestedUrl, target, features) : null;
                }
                handledOpen = true;

                const frame = this.doc.createElement('iframe');
                frame.style.position = 'absolute';
                frame.style.left = '-9999px';
                frame.style.top = '-9999px';
                frame.style.width = '0';
                frame.style.height = '0';
                frame.style.border = '0';
                frame.style.visibility = 'hidden';
                frame.setAttribute('data-e2e-practice-fixture', 'analysis-of-fear');
                this.doc.body.appendChild(frame);
                frame.src = fixtureUrl;
                fixtureFrames.push(frame);

                const targetWindow = frame.contentWindow;
                return new Proxy(targetWindow, {
                    get: (t, prop) => {
                        if (prop === 'closed') {
                            return !frame.isConnected;
                        }
                        if (prop === 'close') {
                            return () => {
                                if (frame.isConnected) {
                                    frame.remove();
                                }
                            };
                        }
                        if (prop === 'addEventListener') {
                            return (type, listener, options) => {
                                if (type === 'load') {
                                    frame.addEventListener('load', listener, options);
                                    return undefined;
                                }
                                return t.addEventListener(type, listener, options);
                            };
                        }
                        if (prop === 'removeEventListener') {
                            return (type, listener, options) => {
                                if (type === 'load') {
                                    frame.removeEventListener('load', listener, options);
                                    return undefined;
                                }
                                return t.removeEventListener(type, listener, options);
                            };
                        }
                        return Reflect.get(t, prop);
                    },
                    set: (t, prop, value) => Reflect.set(t, prop, value)
                });
            };

            await this.win.app.openExam(targetExam.id);

            await this.waitFor(() => {
                const frame = fixtureFrames[0];
                return frame && frame.contentDocument && frame.contentDocument.readyState === 'complete';
            }, { timeout: 10000, description: '练习模板加载' });

            const fixtureFrame = fixtureFrames[0];
            const fixtureWin = fixtureFrame.contentWindow;
            const fixtureDoc = fixtureWin.document;

            await this.waitFor(() => fixtureWin.practicePageEnhancer && fixtureWin.practicePageEnhancer.sessionId, {
                timeout: 12000,
                description: '练习页面会话握手'
            });

            const submitBtn = fixtureDoc.getElementById('submit-btn');
            if (!submitBtn) {
                this.recordResult(name, false, '练习页面缺少提交按钮');
                return;
            }

            submitBtn.click();

            await this.waitFor(() => {
                const records = this.win.app?.getState?.('practice.records');
                if (!Array.isArray(records) || records.length === 0) {
                    return false;
                }
                const record = records[0];
                return record && record.dataSource === 'real' && typeof record.title === 'string' && record.title.includes('Fear');
            }, { timeout: 12000, description: '等待练习记录写入' });

            const records = this.win.app.getState('practice.records') || [];
            const latest = records[0] || null;

            await this.waitFor(() => {
                const item = this.doc.querySelector('#practice-history-list .history-item');
                return !!item;
            }, { timeout: 6000, description: '练习记录列表渲染' });

            const historyItem = this.doc.querySelector('#practice-history-list .history-item');
            const totalCount = this.doc.getElementById('total-practiced')?.textContent || '';

            const passed = !!latest && latest.dataSource === 'real' && latest.realData?.isRealData === true && totalCount === '1';
            const details = {
                recordTitle: latest?.title || null,
                percentage: latest?.percentage,
                totalCount,
                historyItem: historyItem?.textContent?.trim().slice(0, 120) || '',
                hasAnswerComparison: !!(latest && typeof latest.answerComparison === 'object')
            };

            this.recordResult(name, passed, details);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        } finally {
            if (typeof originalOpen === 'function') {
                this.win.open = originalOpen;
            } else if (originalOpen === null) {
                this.win.open = null;
            } else {
                delete this.win.open;
            }

            if (originalBuildResourcePath) {
                this.win.buildResourcePath = originalBuildResourcePath;
            }

            fixtureFrames.forEach((frame) => {
                try {
                    frame.remove();
                } catch (_) {}
            });
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const frame = document.getElementById('app-frame');
    const statusBadge = document.getElementById('suite-status');
    const statusText = document.getElementById('suite-status-text');
    const resultsTable = document.getElementById('test-results');

    if (!frame) {
        console.error('[E2E] 找不到应用 iframe');
        if (statusText) {
            statusText.textContent = '执行中断: 找不到测试 iframe 容器';
        }
        return;
    }

    const suite = new AppE2ETestSuite(frame, {
        statusEl: statusBadge,
        statusTextEl: statusText,
        resultsTable
    });

    if (typeof window.__bootstrapAppFrame !== 'function') {
        const message = '执行中断: 缺少应用加载引导函数';
        console.error('[E2E]', message);
        suite.recordResult('测试套件初始化', false, message);
        suite.setStatus(message);
        return;
    }

    window.__bootstrapAppFrame()
        .then(() => {
            const method = window.__APP_FRAME_LOAD_SOURCE__ || 'unknown';
            const baseHref = window.__APP_FRAME_BASE_HREF__ || '未推导';
            const proxyConfig = window.__APP_FRAME_PROXY_CONFIG__ || window.__E2E_PROXY_CONFIG__ || null;
            suite.recordResult('主应用加载通道', true, { source: method, baseHref, proxyConfig });
            suite.run();
        })
        .catch((error) => {
            const message = error && error.message ? error.message : String(error || '未知错误');
            console.error('[E2E] 无法加载主应用:', message);
            suite.recordResult('测试套件初始化', false, message);
            suite.setStatus('执行中断: ' + message);
        });
});
