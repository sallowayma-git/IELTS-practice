#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

const results = [];

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function createDocumentStub(inputState, buttonState) {
    const elementsById = new Map();
    const body = {
        appendChild(element) {
            element.parentNode = body;
            if (element.id) elementsById.set(element.id, element);
            return element;
        },
        removeChild(element) {
            if (element && element.id && elementsById.get(element.id) === element) {
                elementsById.delete(element.id);
            }
            if (element) element.parentNode = null;
            return element;
        }
    };

    return {
        readyState: 'complete',
        body,
        addEventListener() {},
        querySelector(selector) {
            if (selector === '.main-nav [data-view="practice"]' || selector === '.main-nav [data-view="browse"]' || selector === '.main-nav [data-view="more"]') {
                return { addEventListener() {} };
            }
            if (selector === '.search-input') {
                return inputState;
            }
            if (selector === '.view.active') {
                return { id: 'overview-view' };
            }
            return null;
        },
        querySelectorAll() {
            return [];
        },
        getElementById(id) {
            if (elementsById.has(id)) {
                return elementsById.get(id);
            }
            if (id === 'exam-search-input') {
                return inputState;
            }
            if (id === 'search-clear-btn') {
                return buttonState;
            }
            return null;
        },
        createElement(tagName) {
            const listeners = new Map();
            return {
                tagName: String(tagName || '').toUpperCase(),
                id: '',
                parentNode: null,
                style: {},
                innerHTML: '',
                addEventListener(type, listener) {
                    listeners.set(type, listener);
                },
                querySelector() {
                    return null;
                },
                querySelectorAll() {
                    return [];
                },
                __click(attribute, value) {
                    const listener = listeners.get('click');
                    assert(listener, `element ${this.id || tagName} should have a click listener`);
                    const target = {
                        closest(selector) {
                            if (selector === 'button' || selector.includes(`[${attribute}]`)) {
                                return this;
                            }
                            return null;
                        },
                        getAttribute(name) {
                            return name === attribute ? value : null;
                        },
                        hasAttribute(name) {
                            return name === attribute;
                        }
                    };
                    listener({ target });
                }
            };
        }
    };
}

function createHarness() {
    const ensureCalls = [];
    const messages = [];
    const inputState = {
        value: 'ocean',
        focusCalled: false,
        focus() {
            this.focusCalled = true;
        }
    };
    const buttonState = { hidden: false };
    const document = createDocumentStub(inputState, buttonState);
    const windowStub = {
        console,
        document,
        addEventListener() {},
        showMessage(message, type) {
            messages.push({ message, type });
        },
        async resolveActiveLibraryIndex() {
            return [
                { id: 'reading-1', title: 'Ocean Passage', type: 'reading', hasHtml: true, path: 'Reading/set-1' }
            ];
        },
        AppData: {
            ready: Promise.resolve(),
            preferences: {
                async getCandidateCode() { return null; },
                async setCandidateCode(value) { return value; }
            }
        },
        AppLazyLoader: {
            ensureGroup(name) {
                ensureCalls.push(name);
                if (name === 'browse-runtime') {
                    windowStub.openExam = function (examId) {
                        windowStub.__openedExamId = examId;
                    };
                    windowStub.viewPDF = function (examId) {
                        windowStub.__viewedPdfId = examId;
                    };
                    windowStub.searchExams = function (query) {
                        windowStub.__searchedQuery = query;
                    };
                    windowStub.clearSearch = function () {
                        windowStub.__clearSearchInvoked = true;
                    };
                }
                return Promise.resolve(true);
            }
        }
    };

    const sandbox = {
        window: windowStub,
        document,
        console,
        setTimeout(fn) {
            fn();
            return 1;
        },
        clearTimeout() {},
        Promise,
        Math: Object.create(Math),
        Date,
        JSON
    };
    sandbox.Math.random = () => 0;
    sandbox.globalThis = sandbox.window;
    return { context: vm.createContext(sandbox), ensureCalls, messages, inputState, buttonState, windowStub };
}

async function testRandomPracticeEnsuresBrowseRuntime(harness) {
    loadScript('js/app/main-entry.js', harness.context);
    loadScript('js/presentation/app-actions.js', harness.context);

    await harness.windowStub.AppActions.startRandomPractice('all', 'reading');

    assert(harness.ensureCalls.includes('browse-runtime'), '随机练习应主动确保 browse-runtime 已加载');
    assert.strictEqual(harness.windowStub.__openedExamId, 'reading-1', '随机练习应在严格按需模式下仍能打开题目');
    recordResult('严格按需模式随机练习可启动', true, {
        ensureCalls: harness.ensureCalls,
        openedExamId: harness.windowStub.__openedExamId
    });
}

async function testClearSearchProxyLoadsBrowseRuntime(harness) {
    delete harness.windowStub.clearSearch;
    harness.ensureCalls.length = 0;

    loadScript('js/app/main-entry.js', harness.context);
    await Promise.resolve();

    const result = harness.windowStub.clearSearch();
    await Promise.resolve(result);
    await Promise.resolve();

    assert(harness.ensureCalls.includes('browse-runtime'), 'clearSearch 应通过 browse-runtime 代理落到真实实现');
    assert.strictEqual(harness.windowStub.__clearSearchInvoked, true, 'clearSearch 应调用 browse-runtime 中的真实实现');
    recordResult('clearSearch 全局入口可用', true, {
        ensureCalls: harness.ensureCalls
    });
}

async function testColdBrowseProxyRestoresPreferences(harness) {
    const initializationCalls = [];
    let realLoadCalls = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') {
            return { id: 'browse-view' };
        }
        return originalQuerySelector(selector);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        if (name === 'browse-runtime') {
            harness.windowStub.initializeBrowseView = async function initializeBrowseView(options) {
                initializationCalls.push(options || {});
            };
            harness.windowStub.loadExamList = function loadExamList() {
                realLoadCalls += 1;
            };
        }
        return Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.loadExamList();

    assert.strictEqual(initializationCalls.length, 1, '冷加载 browse-runtime 后应初始化当前 browse 视图以恢复持久化偏好');
    assert.strictEqual(initializationCalls[0].skipLoad, false, '没有待处理分类时应让 initializeBrowseView 恢复并加载偏好筛选');
    assert.strictEqual(realLoadCalls, 1, '懒加载代理最终仍应调用真实 loadExamList');
    recordResult('browse 冷加载后恢复持久化偏好', true, {
        initializationCalls: initializationCalls.length,
        realLoadCalls
    });
}

async function testColdBrowseRuntimeInitializesNavigationAndStateManager() {
    const harness = createHarness();
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    const fallbackHandler = function fallbackNavigation() {};
    let fallbackRemovals = 0;
    const navRoot = {
        _legacyNavHandler: fallbackHandler,
        removeEventListener(type, handler) {
            if (type === 'click' && handler === fallbackHandler) {
                fallbackRemovals += 1;
            }
        }
    };
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.main-nav') {
            return navRoot;
        }
        if (selector === '.view.active') {
            return { id: 'browse-view' };
        }
        return originalQuerySelector(selector);
    };

    let navigationEnsureCalls = 0;
    let navigationOptions = null;
    let stateManagerCreations = 0;
    let repeatResets = 0;
    harness.windowStub.NavigationController = {
        ensure(options) {
            navigationEnsureCalls += 1;
            if (typeof harness.windowStub.ensureLegacyNavigationController !== 'function') {
                return null;
            }
            navigationOptions = options;
            return harness.windowStub.ensureLegacyNavigationController(options);
        }
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        if (name === 'browse-runtime') {
            harness.windowStub.ensureLegacyNavigationController = function ensureLegacyNavigationController() {
                return { mounted: true };
            };
            harness.windowStub.BrowseStateManager = function BrowseStateManager() {
                stateManagerCreations += 1;
                this.ready = Promise.resolve();
                harness.windowStub.browseStateManager = this;
            };
            harness.windowStub.resetBrowseViewToAll = function resetBrowseViewToAll() {
                repeatResets += 1;
            };
        }
        return Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    loadScript('js/presentation/app-actions.js', harness.context);
    await harness.windowStub.AppActions.preloadBrowseView();
    await harness.windowStub.AppEntry.ensureBrowseGroup();

    assert.strictEqual(navigationEnsureCalls, 2, '导航应在冷启动和 Browse 懒加载完成后各尝试初始化一次');
    assert.strictEqual(stateManagerCreations, 1, 'BrowseStateManager 应在懒加载完成后仅实例化一次');
    assert(harness.windowStub.browseStateManager, '冷启动 Browse 应暴露全局状态管理器实例');
    assert.strictEqual(fallbackRemovals, 1, '真实导航控制器挂载后应移除临时 fallback click handler');
    assert.strictEqual(navRoot._legacyNavHandler, undefined, 'fallback handler 标记应在升级后清理');
    assert(navigationOptions && typeof navigationOptions.onRepeatNavigate === 'function');
    assert.strictEqual(navigationOptions.initialView, 'browse', '导航升级必须保留 fallback 已激活的 Browse 高亮');

    navigationOptions.onRepeatNavigate('browse');
    assert.strictEqual(repeatResets, 1, '懒加载后的首个重复 Browse 点击应直接进入 reset handler');
    recordResult('browse 冷加载后补齐导航与状态管理器', true, {
        navigationEnsureCalls,
        stateManagerCreations,
        fallbackRemovals,
        repeatResets
    });
}

async function testSessionSuiteFinalizesBrowseDependencyOnce() {
    const harness = createHarness();
    let navigationEnsureCalls = 0;
    let stateManagerCreations = 0;
    harness.windowStub.NavigationController = {
        ensure() {
            navigationEnsureCalls += 1;
            if (typeof harness.windowStub.ensureLegacyNavigationController !== 'function') {
                return null;
            }
            return harness.windowStub.ensureLegacyNavigationController();
        }
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        if (name === 'browse-runtime') {
            harness.windowStub.ensureLegacyNavigationController = function ensureLegacyNavigationController() {
                return { mounted: true };
            };
            harness.windowStub.BrowseStateManager = function BrowseStateManager() {
                stateManagerCreations += 1;
                harness.windowStub.browseStateManager = this;
            };
        }
        return Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    await Promise.all([
        harness.windowStub.AppEntry.ensureSessionSuiteReady(),
        harness.windowStub.AppEntry.ensureSessionSuiteReady()
    ]);

    assert.strictEqual(
        harness.ensureCalls.filter((name) => name === 'browse-runtime').length,
        1,
        'session-suite startup must finalize its Browse dependency through the cached Browse entrypoint'
    );
    assert(harness.ensureCalls.includes('practice-suite'), 'session-suite startup must still preload practice-suite');
    assert(harness.ensureCalls.includes('session-suite'), 'session-suite runtime itself must still load');
    assert.strictEqual(navigationEnsureCalls, 2, 'navigation should initialize at shell boot and once after Browse loads');
    assert.strictEqual(stateManagerCreations, 1, 'concurrent session startup must create one BrowseStateManager');
    recordResult('session-suite 依赖统一完成 Browse 初始化', true, {
        ensureCalls: harness.ensureCalls,
        navigationEnsureCalls,
        stateManagerCreations
    });
}

async function testMoreViewActivationLoadsTools(harness) {
    let moreToolsLoads = 0;
    harness.windowStub.AppEntry = {
        ensureMoreToolsGroup() {
            moreToolsLoads += 1;
            return Promise.resolve(true);
        }
    };

    loadScript('js/app.js', harness.context);
    const app = vm.runInContext('new ExamSystemApp()', harness.context);
    app.onViewActivated('more');
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(moreToolsLoads, 1, 'more 深链接激活视图时应主动加载 more-tools');
    recordResult('more 深链接激活按需加载工具', true, { moreToolsLoads });
}

async function waitForElement(document, id) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const element = document.getElementById(id);
        if (element) return element;
        await Promise.resolve();
    }
    assert.fail(`timed out waiting for #${id}`);
}

function createSuiteRecoveryHarness(candidate, options = {}) {
    const harness = createHarness();
    const events = [];
    harness.windowStub.app = {
        async getSuiteRecoveryCandidate() {
            events.push({ type: 'candidate' });
            return candidate;
        },
        async abandonSuiteRecovery(sessionId) {
            events.push({ type: 'abandon', sessionId });
            return options.abandonResult !== false;
        },
        async startSuitePractice(startOptions) {
            events.push({ type: 'start', options: { ...startOptions } });
            return 'started';
        }
    };
    loadScript('js/presentation/app-actions.js', harness.context);
    return { ...harness, events };
}

async function testSuiteRecoveryRequiresExplicitContinueChoice() {
    const candidate = {
        id: 'suite-recovery-1',
        title: '<img src=x onerror=alert(1)>',
        completedCount: 1,
        total: 3
    };
    const harness = createSuiteRecoveryHarness(candidate);

    const firstLaunch = harness.windowStub.AppActions.startSuitePractice();
    const duplicateLaunch = harness.windowStub.AppActions.startSuitePractice();
    const modal = await waitForElement(harness.windowStub.document, 'suite-recovery-choice-modal');

    assert(modal.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'), '恢复标题应转义后再写入 modal');
    assert(!modal.innerHTML.includes('<img src=x onerror=alert(1)>'), '恢复标题不得作为 HTML 注入');
    assert.strictEqual(harness.events.filter((event) => event.type === 'candidate').length, 1, '重复点击只能读取一次恢复候选');
    assert.strictEqual(harness.events.filter((event) => event.type === 'start').length, 0, '用户选择前不得隐式恢复');

    modal.__click('data-suite-recovery-choice', 'continue');
    await Promise.all([firstLaunch, duplicateLaunch]);

    const starts = harness.events.filter((event) => event.type === 'start');
    assert.strictEqual(starts.length, 1, 'Continue 只能启动一次恢复');
    assert.strictEqual(starts[0].options.recoveryAction, 'continue');
    assert.strictEqual(starts[0].options.recoverySessionId, candidate.id);
    assert.strictEqual(harness.events.filter((event) => event.type === 'abandon').length, 0);
    recordResult('套题恢复必须显式选择 Continue', true, { events: harness.events });
}

async function testSuiteRecoveryAbandonThenStartsFreshSuite() {
    const candidate = {
        id: 'suite-recovery-2',
        title: 'Reading Passage 2',
        completedCount: 2,
        total: 3
    };
    const harness = createSuiteRecoveryHarness(candidate);

    const launch = harness.windowStub.AppActions.startSuitePractice();
    const recoveryModal = await waitForElement(harness.windowStub.document, 'suite-recovery-choice-modal');
    recoveryModal.__click('data-suite-recovery-choice', 'discard');

    const modeModal = await waitForElement(harness.windowStub.document, 'suite-mode-selector-modal');
    assert.deepStrictEqual(
        harness.events.filter((event) => event.type === 'abandon').map((event) => event.sessionId),
        [candidate.id],
        'Abandon 应先删除指定恢复候选'
    );
    assert.strictEqual(harness.events.filter((event) => event.type === 'start').length, 0, '放弃完成前不得启动新套题');

    modeModal.__click('data-suite-flow-mode', 'classic');
    await launch;

    const starts = harness.events.filter((event) => event.type === 'start');
    assert.strictEqual(starts.length, 1, '放弃后应仅启动一套新题');
    assert.strictEqual(starts[0].options.flowMode, 'classic');
    assert.strictEqual(starts[0].options.frequencyScope, 'all');
    assert.strictEqual(starts[0].options.recoveryAction, undefined, '新套题不得携带恢复动作');
    assert.strictEqual(harness.events[1].type, 'abandon');
    assert.strictEqual(harness.events[2].type, 'start');
    recordResult('套题恢复可显式 Abandon 后新建', true, { events: harness.events });
}

async function testSuiteRecoveryCancelDoesNotMutateSession() {
    const harness = createSuiteRecoveryHarness({
        id: 'suite-recovery-3',
        title: 'Reading Passage 3',
        completedCount: 0,
        total: 3
    });

    const launch = harness.windowStub.AppActions.startSuitePractice();
    const modal = await waitForElement(harness.windowStub.document, 'suite-recovery-choice-modal');
    modal.__click('data-suite-recovery-choice', 'cancel');
    await launch;

    assert.strictEqual(harness.events.filter((event) => event.type === 'start').length, 0, 'Cancel 不得启动或恢复套题');
    assert.strictEqual(harness.events.filter((event) => event.type === 'abandon').length, 0, 'Cancel 不得删除恢复候选');
    recordResult('套题恢复取消不改变会话', true, { events: harness.events });
}

async function main() {
    try {
        await testRandomPracticeEnsuresBrowseRuntime(createHarness());
        await testClearSearchProxyLoadsBrowseRuntime(createHarness());
        await testColdBrowseProxyRestoresPreferences(createHarness());
        await testColdBrowseRuntimeInitializesNavigationAndStateManager();
        await testSessionSuiteFinalizesBrowseDependencyOnce();
        await testMoreViewActivationLoadsTools(createHarness());
        await testSuiteRecoveryRequiresExplicitContinueChoice();
        await testSuiteRecoveryAbandonThenStartsFreshSuite();
        await testSuiteRecoveryCancelDoesNotMutateSession();
        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length
        }, null, 2));
    } catch (error) {
        recordResult('on-demand 入口测试执行失败', false, { error: error.message });
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
