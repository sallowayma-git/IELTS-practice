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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushMicrotasks(rounds = 8) {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve();
    }
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
    await harness.windowStub.AppEntry.ensureBrowseGroup();

    assert(harness.ensureCalls.includes('browse-runtime'), '随机练习应主动确保 browse-runtime 已加载');
    assert.strictEqual(harness.windowStub.__openedExamId, 'reading-1', '随机练习应在严格按需模式下仍能打开题目');
    recordResult('严格按需模式随机练习可启动', true, {
        ensureCalls: harness.ensureCalls,
        openedExamId: harness.windowStub.__openedExamId
    });
}

async function testFallbackQueuesRepeatBrowseResetDuringLazyLoad() {
    const harness = createHarness();
    let fallbackHandler = null;
    let resetCalls = 0;
    const showViewCalls = [];
    const button = {
        classList: {
            contains(value) { return value === 'active'; }
        },
        getAttribute(name) { return name === 'data-view' ? 'browse' : null; }
    };
    const navRoot = {
        contains(value) { return value === button; },
        addEventListener(type, handler) {
            if (type === 'click') fallbackHandler = handler;
        },
        querySelectorAll() { return []; },
        querySelector() { return null; }
    };
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.main-nav') return navRoot;
        return originalQuerySelector(selector);
    };
    harness.windowStub.showView = function showView(viewName, resetCategory) {
        showViewCalls.push({ viewName, resetCategory });
    };
    harness.windowStub.resetBrowseViewToAll = function resetBrowseViewToAll() {
        resetCalls += 1;
        return Promise.resolve(true);
    };

    loadScript('js/boot-fallbacks.js', harness.context);
    assert(fallbackHandler, 'strict on-demand startup should install the temporary navigation handler');
    const showCallsBeforeRepeat = showViewCalls.length;
    fallbackHandler({
        preventDefault() {},
        target: {
            closest(selector) {
                return selector === '.nav-btn[data-view]' ? button : null;
            }
        }
    });
    await Promise.resolve();

    assert.strictEqual(resetCalls, 1, 'a repeat Browse click during lazy load must queue the reset intent');
    assert.strictEqual(
        showViewCalls.length,
        showCallsBeforeRepeat,
        'the repeat click must not run ordinary Browse navigation again'
    );

    delete harness.windowStub.resetBrowseViewToAll;
    fallbackHandler({
        preventDefault() {},
        target: {
            closest(selector) {
                return selector === '.nav-btn[data-view]' ? button : null;
            }
        }
    });

    assert.deepStrictEqual(
        showViewCalls.at(-1),
        { viewName: 'browse', resetCategory: true },
        'the helper-free fallback must use the reset-capable Browse activation path'
    );
    recordResult('Browse 冷加载窗口保留重复导航重置意图', true, {
        resetCalls,
        helperFreeFallback: showViewCalls.at(-1)
    });
}

async function testColdRepeatResetPreemptsBrowseSynchronization() {
    const harness = createHarness();
    const runtimeReady = deferred();
    const browseSynchronization = deferred();
    const resetCompletion = deferred();
    let synchronizationCalls = 0;
    let resetCalls = 0;
    let loadCalls = 0;
    let resultsRequestId = 0;
    let synchronizationRequestId = null;
    let resetRequestId = null;
    const callOrder = [];
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    const initialBrowseLoad = harness.windowStub.loadExamList();
    const repeatReset = harness.windowStub.resetBrowseViewToAll();
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        callOrder.push('initialize-start');
        synchronizationCalls += 1;
        synchronizationRequestId = ++resultsRequestId;
        return browseSynchronization.promise;
    };
    harness.windowStub.loadExamList = function loadExamList() {
        loadCalls += 1;
        resultsRequestId += 1;
    };
    harness.windowStub.resetBrowseViewToAll = function resetBrowseViewToAll() {
        callOrder.push('reset-start');
        resetCalls += 1;
        resetRequestId = ++resultsRequestId;
        return resetCompletion.promise;
    };

    runtimeReady.resolve(true);
    await flushMicrotasks();

    assert.strictEqual(synchronizationCalls, 1, 'the existing Browse synchronization should still start');
    assert.strictEqual(resetCalls, 1, 'repeat reset should run as soon as the raw runtime is available');
    assert.strictEqual(loadCalls, 0, 'the older Browse load should remain blocked on synchronization');
    assert.deepStrictEqual(callOrder, ['initialize-start', 'reset-start']);
    assert(resetRequestId > synchronizationRequestId, 'repeat reset must own the latest request token');
    assert.strictEqual(resetRequestId, resultsRequestId);

    browseSynchronization.resolve();
    await flushMicrotasks();
    assert.strictEqual(loadCalls, 0, 'an older lazy load must not reclaim the token while reset is pending');
    assert.strictEqual(resetRequestId, resultsRequestId);

    resetCompletion.resolve(true);
    await Promise.all([initialBrowseLoad, repeatReset]);
    assert.strictEqual(loadCalls, 0);
    recordResult('Browse 冷启动重复重置可抢占旧同步', true, {
        synchronizationCalls,
        resetCalls,
        loadCalls
    });
}

async function testDirectResetInvalidatesPendingColdBrowseLoad() {
    const harness = createHarness();
    const runtimeReady = deferred();
    const browseSynchronization = deferred();
    const resetPreparation = deferred();
    const loadArguments = [];
    let resultsRequestId = 0;
    let initializationRequestId = null;
    let resetRequestId = null;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.browseStateManager = {
        ready: resetPreparation.promise,
        resetToAllExams() {}
    };

    loadScript('js/app/main-entry.js', harness.context);
    const initialBrowseLoad = harness.windowStub.loadExamList();
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        initializationRequestId = harness.windowStub.__beginBrowseResultsRequest();
        return browseSynchronization.promise;
    };
    harness.windowStub.loadExamList = function loadExamList() {
        const args = Array.prototype.slice.call(arguments);
        loadArguments.push(args);
        return Promise.resolve(args[0]);
    };

    // The Browse bundle installs the real reset before its raw loader promise resolves.
    const contextConsole = harness.context.console;
    harness.context.console = Object.assign({}, contextConsole, { log() {} });
    loadScript('js/app/examActions.js', harness.context);
    harness.context.console = contextConsole;
    runtimeReady.resolve(true);
    await flushMicrotasks();
    assert.strictEqual(initializationRequestId, 1, 'Browse synchronization should own the first results token');

    const directReset = harness.windowStub.ExamActions.resetBrowseViewToAll();
    resetRequestId = resultsRequestId;
    assert(resetRequestId > initializationRequestId, 'direct reset should invalidate initialization immediately');

    browseSynchronization.resolve();
    await flushMicrotasks();
    assert.strictEqual(
        loadArguments.length,
        0,
        'the pre-runtime load must stay invalidated while the direct reset awaits preparation'
    );
    assert.strictEqual(resultsRequestId, resetRequestId);

    resetPreparation.resolve();
    await Promise.all([initialBrowseLoad, directReset]);
    assert.strictEqual(loadArguments.length, 1, 'only the reset-owned adapter load should run');
    assert(Array.isArray(loadArguments[0][0]));
    assert.strictEqual(loadArguments[0][1], resetRequestId);
    recordResult('Browse handoff 期间的直接重置会淘汰旧加载', true, {
        initializationRequestId,
        resetRequestId,
        loadCalls: loadArguments.length
    });
}

async function testHotBrowseCategorySupersedesQueuedColdCategory() {
    const harness = createHarness();
    const runtimeReady = deferred();
    const browseSynchronization = deferred();
    let resultsRequestId = 0;
    const appliedCategories = [];
    const snapshotReads = [];
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    loadScript('js/app/main-entry.js', harness.context);
    const repeatReset = harness.windowStub.resetBrowseViewToAll();
    const staleCategory = harness.windowStub.browseCategory('P1', 'reading');
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return browseSynchronization.promise;
    };
    harness.windowStub.resetBrowseViewToAll = function resetBrowseViewToAll() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve(true);
    };
    harness.windowStub.browseCategory = function browseCategory(category) {
        harness.windowStub.__beginBrowseResultsRequest();
        appliedCategories.push(category);
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        snapshotReads.push(resultsRequestId);
        return resultsRequestId;
    };

    runtimeReady.resolve(true);
    await flushMicrotasks();
    assert.strictEqual(snapshotReads[snapshotReads.length - 1], 2, 'cold category should snapshot after reset starts');
    harness.windowStub.browseCategory('P4', 'reading');
    assert.deepStrictEqual(appliedCategories, ['P4']);

    browseSynchronization.resolve();
    await Promise.all([repeatReset, staleCategory]);
    assert.deepStrictEqual(
        appliedCategories,
        ['P4'],
        'a queued cold category must not overwrite a newer hot category after handoff'
    );
    recordResult('热分类交互淘汰 handoff 中的旧冷分类', true, {
        appliedCategories,
        resultsRequestId
    });
}

async function testQueuedBrowseCategoryStandsDownAfterNewNavigation() {
    const harness = createHarness();
    const runtimeReady = deferred();
    let activeView = 'overview';
    const appliedCategories = [];
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: `${activeView}-view` };
        return originalQuerySelector(selector);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    const queuedCategory = harness.windowStub.browseCategory('P1', 'reading');
    activeView = 'settings';
    harness.windowStub.browseCategory = function browseCategory(category) {
        appliedCategories.push(category);
        activeView = 'browse';
    };

    runtimeReady.resolve(true);
    assert.strictEqual(await queuedCategory, false);
    assert.deepStrictEqual(
        appliedCategories,
        [],
        'a category queued from an older view must not navigate back after a newer view wins'
    );
    assert.strictEqual(activeView, 'settings');
    recordResult('较新的非 Browse 导航淘汰冷分类代理', true, { activeView, appliedCategories });
}

async function testQueuedBrowseCategoryStandsDownAfterNavigationRoundTrip() {
    const harness = createHarness();
    const runtimeReady = deferred();
    let activeView = 'overview';
    const appliedCategories = [];
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: `${activeView}-view` };
        return originalQuerySelector(selector);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    assert.strictEqual(typeof harness.windowStub.__markAppNavigationIntent, 'function');
    const queuedCategory = harness.windowStub.browseCategory('P1', 'reading');

    function navigate(viewName) {
        harness.windowStub.__markAppNavigationIntent();
        activeView = viewName;
    }

    navigate('settings');
    navigate('overview');
    harness.windowStub.browseCategory = function browseCategory(category) {
        appliedCategories.push(category);
        activeView = 'browse';
    };

    runtimeReady.resolve(true);
    assert.strictEqual(await queuedCategory, false);
    assert.deepStrictEqual(
        appliedCategories,
        [],
        'a navigation round trip must still invalidate the older queued category'
    );
    assert.strictEqual(activeView, 'overview');
    recordResult('导航往返仍淘汰旧冷分类代理', true, { activeView, appliedCategories });
}

async function testAppNavigationMarksIntentBeforeSameViewShortCircuit() {
    const harness = createHarness();
    const runtimeReady = deferred();
    const appliedCategories = [];
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    const queuedCategory = harness.windowStub.browseCategory('P1', 'reading');
    loadScript('js/app.js', harness.context);
    const app = vm.runInContext('new ExamSystemApp()', harness.context);
    app.currentView = 'overview';
    app.navigateToView('overview');
    harness.windowStub.browseCategory = function browseCategory(category) {
        appliedCategories.push(category);
    };

    runtimeReady.resolve(true);
    assert.strictEqual(await queuedCategory, false);
    assert.deepStrictEqual(
        appliedCategories,
        [],
        'even a same-view app navigation intent must cancel an older queued category'
    );
    recordResult('App 同视图导航也标记较新的导航意图', true, { appliedCategories });
}

async function testQueuedFilterBeatsLaterExamIndexRefresh() {
    const harness = createHarness();
    harness.inputState.value = 'ocean';
    const runtimeReady = deferred();
    const browseSynchronization = deferred();
    const filterCompletion = deferred();
    const listeners = new Map();
    const callOrder = [];
    let skippedBackgroundLoads = 0;
    let resultsRequestId = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };

    loadScript('js/app/main-entry.js', harness.context);
    const queuedFilter = harness.windowStub.filterByType('reading');
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'fresh-index' }] } });
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return browseSynchronization.promise;
    };
    harness.windowStub.filterByType = function filterByType(type) {
        harness.windowStub.__beginBrowseResultsRequest();
        callOrder.push(`filter:${type}`);
        return filterCompletion.promise;
    };
    harness.windowStub.loadExamList = function loadExamList(index, requestId) {
        const activeRequestId = requestId == null
            ? harness.windowStub.__beginBrowseResultsRequest()
            : requestId;
        if (!harness.windowStub.__isBrowseResultsRequestCurrent(activeRequestId)) {
            skippedBackgroundLoads += 1;
            return false;
        }
        callOrder.push('background-load');
        return index;
    };
    harness.windowStub.searchExams = function searchExams(query, requestId) {
        const activeRequestId = requestId == null
            ? harness.windowStub.__beginBrowseResultsRequest()
            : requestId;
        if (!harness.windowStub.__isBrowseResultsRequestCurrent(activeRequestId)) {
            skippedBackgroundLoads += 1;
            return false;
        }
        callOrder.push(`background-search:${query}`);
        return query;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };

    runtimeReady.resolve(true);
    await flushMicrotasks();
    browseSynchronization.resolve();
    await flushMicrotasks();

    assert.deepStrictEqual(callOrder, ['filter:reading'], 'the earlier user filter should start before background refresh');
    assert.strictEqual(skippedBackgroundLoads, 0, 'a stale background search must stand down before calling the adapter');
    assert.strictEqual(resultsRequestId, 2, 'background refresh must not claim a new results token');

    filterCompletion.resolve(true);
    await queuedFilter;
    recordResult('冷筛选优先于稍后登记的题库索引刷新', true, {
        callOrder,
        skippedBackgroundLoads,
        resultsRequestId
    });
}

async function testLaterQueuedFilterBeatsEarlierExamIndexRefresh() {
    const harness = createHarness();
    harness.inputState.value = '';
    const runtimeReady = deferred();
    const listeners = new Map();
    const callOrder = [];
    let resultsRequestId = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };

    loadScript('js/app/main-entry.js', harness.context);
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'background-index' }] } });
    const queuedFilter = harness.windowStub.filterByType('reading');
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };
    harness.windowStub.filterByType = function filterByType(type) {
        harness.windowStub.__beginBrowseResultsRequest();
        callOrder.push(`filter:${type}`);
        return true;
    };
    harness.windowStub.loadExamList = function loadExamList(index, requestId) {
        const activeRequestId = requestId == null
            ? harness.windowStub.__beginBrowseResultsRequest()
            : requestId;
        if (!harness.windowStub.__isBrowseResultsRequestCurrent(activeRequestId)) {
            return false;
        }
        callOrder.push(`background:${index[0].id}`);
        return index;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };

    runtimeReady.resolve(true);
    assert.strictEqual(await queuedFilter, true);
    await flushMicrotasks();

    assert.deepStrictEqual(
        callOrder,
        ['filter:reading'],
        'a later cold user filter must invalidate an earlier queued background refresh'
    );
    assert.strictEqual(resultsRequestId, 2);
    recordResult('较新的冷筛选淘汰更早的题库索引刷新', true, { callOrder, resultsRequestId });
}

async function createHotExamIndexRefreshHarness() {
    const harness = createHarness();
    const listeners = new Map();
    const inFlightUserRequests = new Set();
    const backgroundLoads = [];
    let resultsRequestId = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseUserResultsRequestInFlight = function isUserRequestInFlight(requestId) {
        return inFlightUserRequests.has(requestId);
    };
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };

    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();
    harness.windowStub.loadExamList = function loadExamList(index, requestId) {
        backgroundLoads.push([index.map((exam) => exam.id), requestId]);
        return index;
    };
    harness.inputState.value = '';

    return {
        harness,
        listeners,
        backgroundLoads,
        beginUserRequest() {
            const requestId = harness.windowStub.__beginBrowseResultsRequest();
            inFlightUserRequests.add(requestId);
            return requestId;
        },
        endUserRequest(requestId) {
            inFlightUserRequests.delete(requestId);
        },
        getResultsRequestId() {
            return resultsRequestId;
        }
    };
}

async function testHotFilterBeatsLaterExamIndexRefresh() {
    const state = await createHotExamIndexRefreshHarness();
    const userRequestId = state.beginUserRequest();

    state.listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'background-index' }] } });
    await flushMicrotasks(32);

    assert.strictEqual(state.getResultsRequestId(), userRequestId, 'background refresh must not revoke an active hot filter');
    assert.deepStrictEqual(state.backgroundLoads, []);
    state.endUserRequest(userRequestId);
    recordResult('热筛选先发生时题库索引刷新让行', true, { userRequestId });
}

async function testHotFilterAfterEventReceiptStillWins() {
    const state = await createHotExamIndexRefreshHarness();

    state.listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'background-index' }] } });
    const userRequestId = state.beginUserRequest();
    await flushMicrotasks(32);

    assert.strictEqual(
        state.getResultsRequestId(),
        userRequestId,
        'an index event must validate the token captured at receipt instead of borrowing the later hot token'
    );
    assert.deepStrictEqual(state.backgroundLoads, []);
    state.endUserRequest(userRequestId);
    recordResult('题库索引事件先登记时后续热筛选仍优先', true, { userRequestId });
}

async function testLatestQueuedExamIndexRefreshWinsDuringBrowseInitialization() {
    const harness = createHarness();
    harness.inputState.value = '';
    const runtimeReady = deferred();
    const listeners = new Map();
    const renders = [];
    let resultsRequestId = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };

    loadScript('js/app/main-entry.js', harness.context);
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'older-index' }] } });
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'latest-index' }] } });
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };
    harness.windowStub.loadExamList = function loadExamList(index, requestId) {
        if (harness.windowStub.__isBrowseResultsRequestCurrent(requestId)) {
            renders.push(index.map((exam) => exam.id));
        }
        return index;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };

    runtimeReady.resolve(true);
    await flushMicrotasks(32);

    assert.deepStrictEqual(
        renders,
        [['latest-index']],
        'multiple queued index events must coalesce to the latest snapshot'
    );
    assert.strictEqual(resultsRequestId, 2);
    recordResult('Browse 初始化期间仅重放最新题库索引', true, { renders, resultsRequestId });
}

async function testExamIndexRefreshPreservesActiveSearch() {
    const harness = createHarness();
    const listeners = new Map();
    const calls = [];
    let resultsRequestId = 0;
    let finalRender = null;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        const requestId = harness.windowStub.__beginBrowseResultsRequest();
        calls.push(`init:${requestId}`);
        return Promise.resolve();
    };
    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();
    harness.windowStub.searchExams = function searchExams(query, renderRequestId) {
        const requestId = renderRequestId == null
            ? harness.windowStub.__beginBrowseResultsRequest()
            : renderRequestId;
        if (!harness.windowStub.__isBrowseResultsRequestCurrent(requestId)) {
            return false;
        }
        calls.push(`search:${query}:${requestId}`);
        finalRender = `search:${query}`;
    };
    harness.windowStub.loadExamList = function loadExamList(index, requestId) {
        const activeRequestId = requestId == null
            ? harness.windowStub.__beginBrowseResultsRequest()
            : requestId;
        calls.push(`background:${activeRequestId}`);
        finalRender = 'background';
        return index;
    };
    harness.inputState.value = 'ocean';
    harness.windowStub.searchExams('ocean');
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'fresh-index' }] } });
    await flushMicrotasks();

    assert.deepStrictEqual(calls, ['init:1', 'search:ocean:2', 'search:ocean:3']);
    assert.strictEqual(finalRender, 'search:ocean', 'background index refresh must preserve active search results');
    recordResult('题库索引刷新保留活动搜索', true, { calls, finalRender });
}

async function testExamIndexRefreshPreemptsSameTokenLoad() {
    const harness = createHarness();
    const staleResolution = deferred();
    const listeners = new Map();
    const renders = [];
    let resultsRequestId = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };

    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();
    harness.inputState.value = '';
    harness.windowStub.loadExamList = function loadExamList(index, requestId) {
        const activeRequestId = requestId == null
            ? harness.windowStub.__beginBrowseResultsRequest()
            : requestId;
        if (Array.isArray(index)) {
            if (harness.windowStub.__isBrowseResultsRequestCurrent(activeRequestId)) {
                renders.push(index.map((exam) => exam.id));
            }
            return Promise.resolve(index);
        }
        return staleResolution.promise.then((resolvedIndex) => {
            if (!harness.windowStub.__isBrowseResultsRequestCurrent(activeRequestId)) {
                return false;
            }
            renders.push(resolvedIndex.map((exam) => exam.id));
            return resolvedIndex;
        });
    };

    const staleLoad = harness.windowStub.loadExamList(null);
    assert.strictEqual(resultsRequestId, 2, 'the pending load should own the captured token');
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'fresh-index' }] } });
    await flushMicrotasks(32);

    assert.strictEqual(resultsRequestId, 3, 'the accepted index refresh must claim a newer token');
    assert.deepStrictEqual(renders, [['fresh-index']]);

    staleResolution.resolve([{ id: 'stale-index' }]);
    assert.strictEqual(await staleLoad, false);
    assert.deepStrictEqual(
        renders,
        [['fresh-index']],
        'the older same-token continuation must not overwrite the fresh index render'
    );
    recordResult('题库索引刷新领取新 token 并淘汰旧 continuation', true, {
        resultsRequestId,
        renders
    });
}

async function testExamIndexRefreshStandsDownDuringReset() {
    const harness = createHarness();
    const resetIndex = deferred();
    const listeners = new Map();
    let resultsRequestId = 0;
    let searchCalls = 0;
    let resolverCalls = 0;
    const loadedIndexes = [];
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };
    harness.windowStub.resolveActiveLibraryIndex = function resolveActiveLibraryIndex() {
        resolverCalls += 1;
        return resetIndex.promise;
    };
    harness.windowStub.browseStateManager = {
        ready: Promise.resolve(),
        resetToAllExams() {
            harness.inputState.value = '';
        }
    };

    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();
    const contextConsole = harness.context.console;
    harness.context.console = Object.assign({}, contextConsole, { log() {} });
    loadScript('js/app/examActions.js', harness.context);
    harness.context.console = contextConsole;
    harness.windowStub.searchExams = function searchExams() {
        searchCalls += 1;
    };
    harness.windowStub.loadExamList = function loadExamList(index) {
        loadedIndexes.push(Array.isArray(index) ? index.map((exam) => exam.id) : null);
        return Promise.resolve(index);
    };
    harness.inputState.value = 'ocean';

    const reset = harness.windowStub.ExamActions.resetBrowseViewToAll();
    assert.strictEqual(harness.windowStub.__isBrowseResetIntentInFlight(), true);
    await flushMicrotasks();
    assert.strictEqual(resolverCalls, 1, 'reset must resolve the active index after restoration finishes');
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'fresh-index' }] } });
    await flushMicrotasks();
    assert.strictEqual(searchCalls, 0, 'index refresh must not replay an old query during reset preparation');
    assert.strictEqual(loadedIndexes.length, 0, 'index refresh must not share an in-flight reset token');

    resetIndex.resolve([{ id: 'stale-index' }]);
    await reset;
    assert.strictEqual(searchCalls, 0);
    assert.deepStrictEqual(loadedIndexes, [['fresh-index']], 'reset must render the latest active index');
    assert.strictEqual(harness.windowStub.__isBrowseResetIntentInFlight(), false);
    recordResult('题库索引刷新在重置期间让行', true, {
        searchCalls,
        loadedIndexes,
        resolverCalls,
        resultsRequestId
    });
}

async function testExamIndexRefreshDuringResetRenderUsesLatestSnapshot() {
    const harness = createHarness();
    const firstRender = deferred();
    const secondRender = deferred();
    const listeners = new Map();
    let resultsRequestId = 0;
    const loadedIndexes = [];
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };
    harness.windowStub.resolveActiveLibraryIndex = function resolveActiveLibraryIndex() {
        return Promise.resolve([{ id: 'initial-index' }]);
    };
    harness.windowStub.browseStateManager = {
        ready: Promise.resolve(),
        resetToAllExams() {
            harness.inputState.value = '';
        }
    };

    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();
    const contextConsole = harness.context.console;
    harness.context.console = Object.assign({}, contextConsole, { log() {} });
    loadScript('js/app/examActions.js', harness.context);
    harness.context.console = contextConsole;
    harness.windowStub.loadExamList = function loadExamList(index) {
        loadedIndexes.push(Array.isArray(index) ? index.map((exam) => exam.id) : null);
        if (loadedIndexes.length === 1) return firstRender.promise;
        if (loadedIndexes.length === 2) return secondRender.promise;
        return Promise.resolve(index);
    };

    const reset = harness.windowStub.ExamActions.resetBrowseViewToAll();
    await flushMicrotasks(32);
    assert.deepStrictEqual(loadedIndexes, [['initial-index']]);
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'fresh-index' }] } });
    await flushMicrotasks();
    assert.deepStrictEqual(loadedIndexes, [['initial-index']], 'the event must not start a competing load');

    firstRender.resolve([{ id: 'initial-index' }]);
    await flushMicrotasks();
    assert.deepStrictEqual(loadedIndexes, [['initial-index'], ['fresh-index']]);
    secondRender.resolve([{ id: 'fresh-index' }]);
    queueMicrotask(() => {
        listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'final-index' }] } });
    });
    await reset;
    await flushMicrotasks();
    assert.deepStrictEqual(
        loadedIndexes,
        [['initial-index'], ['fresh-index'], ['final-index']],
        'a final microtask event must run through reset replay or the normal background refresh'
    );
    assert.strictEqual(harness.windowStub.__isBrowseResetIntentInFlight(), false);
    recordResult('重置渲染期间采用最新题库快照', true, { loadedIndexes, resultsRequestId });
}

async function testBrowseResetIntentClearsAfterRuntimeFailure() {
    const harness = createHarness();
    const runtimeReady = deferred();
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    const reset = harness.windowStub.resetBrowseViewToAll();
    assert.strictEqual(harness.windowStub.__isBrowseResetIntentInFlight(), true);
    runtimeReady.reject(new Error('browse runtime failed'));
    await assert.rejects(reset, /browse runtime failed/);
    assert.strictEqual(
        harness.windowStub.__isBrowseResetIntentInFlight(),
        false,
        'a rejected lazy runtime must release its reset intent'
    );
    recordResult('Browse runtime 失败后释放重置意图', true);
}

async function testBrowseResetIntentClearsAfterResetFailure() {
    const harness = createHarness();
    const resetIndex = deferred();
    const listeners = new Map();
    const loadedIndexes = [];
    let resultsRequestId = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };
    harness.windowStub.resolveActiveLibraryIndex = function resolveActiveLibraryIndex() {
        return resetIndex.promise;
    };
    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();
    const contextConsole = harness.context.console;
    harness.context.console = Object.assign({}, contextConsole, { log() {}, warn() {} });
    loadScript('js/app/examActions.js', harness.context);
    harness.windowStub.browseStateManager = {
        ready: Promise.resolve(),
        resetToAllExams() {
            throw new Error('reset state failed');
        }
    };
    harness.windowStub.loadExamList = function loadExamList(index) {
        loadedIndexes.push(Array.isArray(index) ? index.map((exam) => exam.id) : null);
        return Promise.resolve(index);
    };
    harness.inputState.value = '';

    const reset = harness.windowStub.ExamActions.resetBrowseViewToAll();
    await flushMicrotasks();
    resetIndex.resolve([{ id: 'initial-index' }]);
    queueMicrotask(() => {
        listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'fresh-index' }] } });
    });
    const result = await reset;
    await flushMicrotasks();
    harness.context.console = contextConsole;
    assert.strictEqual(result, false);
    assert.deepStrictEqual(
        loadedIndexes,
        [['fresh-index']],
        'an event queued behind a failing reset continuation must use the normal refresh path'
    );
    assert.strictEqual(
        harness.windowStub.__isBrowseResetIntentInFlight(),
        false,
        'a failed real reset must release its reset intent'
    );
    recordResult('真实重置失败后释放重置意图', true, { loadedIndexes, resultsRequestId });
}

async function testBrowseResetAdapterFailureReplaysCapturedIndex() {
    const harness = createHarness();
    const failingRender = deferred();
    const listeners = new Map();
    const loadedIndexes = [];
    let resultsRequestId = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.addEventListener = function addEventListener(name, listener) {
        listeners.set(name, listener);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };
    harness.windowStub.resolveActiveLibraryIndex = function resolveActiveLibraryIndex() {
        return Promise.resolve([{ id: 'initial-index' }]);
    };
    harness.windowStub.browseStateManager = {
        ready: Promise.resolve(),
        resetToAllExams() {
            harness.inputState.value = '';
        }
    };

    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();
    const contextConsole = harness.context.console;
    harness.context.console = Object.assign({}, contextConsole, { log() {}, warn() {} });
    loadScript('js/app/examActions.js', harness.context);
    harness.windowStub.loadExamList = function loadExamList(index) {
        loadedIndexes.push(Array.isArray(index) ? index.map((exam) => exam.id) : null);
        return loadedIndexes.length === 1 ? failingRender.promise : Promise.resolve(index);
    };

    const reset = harness.windowStub.ExamActions.resetBrowseViewToAll();
    await flushMicrotasks(32);
    assert.deepStrictEqual(loadedIndexes, [['initial-index']]);
    listeners.get('examIndexLoaded')({ detail: { index: [{ id: 'fresh-index' }] } });
    await flushMicrotasks();
    assert.deepStrictEqual(loadedIndexes, [['initial-index']]);

    failingRender.reject(new Error('adapter failed'));
    assert.strictEqual(await reset, false);
    await flushMicrotasks(32);
    harness.context.console = contextConsole;
    assert.deepStrictEqual(
        loadedIndexes,
        [['initial-index'], ['fresh-index']],
        'an index captured before adapter rejection must be replayed after the reset releases ownership'
    );
    assert.strictEqual(harness.windowStub.__isBrowseResetIntentInFlight(), false);
    recordResult('重置适配器失败后重放最新题库索引', true, { loadedIndexes, resultsRequestId });
}

async function testFailedResetReplayCannotBorrowNewResetToken() {
    const harness = createHarness();
    let resultsRequestId = 0;
    const searches = [];
    const loads = [];
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return Promise.resolve();
    };

    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();
    harness.windowStub.searchExams = function searchExams(query, requestId) {
        searches.push([query, requestId]);
    };
    harness.windowStub.loadExamList = function loadExamList(index, requestId) {
        loads.push([Array.isArray(index) ? index.map((exam) => exam.id) : null, requestId]);
    };
    harness.inputState.value = 'old-query';

    const oldIntent = harness.windowStub.__beginBrowseResetIntent();
    const oldRequestId = harness.windowStub.__beginBrowseResultsRequest();
    harness.windowStub.__setBrowseResetResultsRequest(oldIntent, oldRequestId);
    harness.windowStub.__captureBrowseResetIndexSnapshot([{ id: 'old-index' }]);
    harness.windowStub.__endBrowseResetIntent(oldIntent);

    const newIntent = harness.windowStub.__beginBrowseResetIntent();
    const newRequestId = harness.windowStub.__beginBrowseResultsRequest();
    harness.windowStub.__setBrowseResetResultsRequest(newIntent, newRequestId);
    await flushMicrotasks(32);

    assert.strictEqual(newRequestId > oldRequestId, true);
    assert.deepStrictEqual(searches, [], 'an old replay must not use the newer reset request token');
    assert.deepStrictEqual(loads, [], 'an old replay must stand down after a newer reset starts');
    harness.windowStub.__endBrowseResetIntent(newIntent);
    recordResult('失败重置重放不得借用后续重置 token', true, {
        oldRequestId,
        newRequestId,
        searches,
        loads
    });
}

async function testQueuedFilterSupersedesOlderPendingCategory() {
    const harness = createHarness();
    const runtimeReady = deferred();
    const browseSynchronization = deferred();
    const calls = [];
    let resultsRequestId = 0;
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') return { id: 'browse-view' };
        return originalQuerySelector(selector);
    };
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        return name === 'browse-runtime' ? runtimeReady.promise : Promise.resolve(true);
    };
    harness.windowStub.__pendingBrowseFilter = {
        category: 'P1',
        type: 'reading',
        filterMode: null,
        path: null
    };
    harness.windowStub.__beginBrowseResultsRequest = function beginBrowseResultsRequest() {
        resultsRequestId += 1;
        return resultsRequestId;
    };
    harness.windowStub.__isBrowseResultsRequestCurrent = function isBrowseResultsRequestCurrent(requestId) {
        return requestId === resultsRequestId;
    };

    loadScript('js/app/main-entry.js', harness.context);
    const queuedFilter = harness.windowStub.filterByType('all');
    harness.windowStub.initializeBrowseView = function initializeBrowseView() {
        harness.windowStub.__beginBrowseResultsRequest();
        return browseSynchronization.promise;
    };
    harness.windowStub.applyBrowseFilter = function applyBrowseFilter(category, type, filterMode, path, requestId) {
        const activeRequestId = requestId == null
            ? harness.windowStub.__beginBrowseResultsRequest()
            : requestId;
        if (harness.windowStub.__isBrowseResultsRequestCurrent(activeRequestId)) {
            calls.push(`pending:${category}:${activeRequestId}`);
        }
        return Promise.resolve();
    };
    harness.windowStub.filterByType = function filterByType(type) {
        const requestId = harness.windowStub.__beginBrowseResultsRequest();
        calls.push(`filter:${type}:${requestId}`);
        return Promise.resolve();
    };
    harness.windowStub.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
        return resultsRequestId;
    };

    runtimeReady.resolve(true);
    await flushMicrotasks();
    browseSynchronization.resolve();
    await queuedFilter;

    assert.deepStrictEqual(calls, ['pending:P1:1', 'filter:all:2']);
    assert.strictEqual(resultsRequestId, 2);
    assert.strictEqual(harness.windowStub.__pendingBrowseFilter, undefined);
    recordResult('较新的冷筛选可覆盖旧 pending 分类', true, { calls, resultsRequestId });
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

async function testColdBrowseAppliesExplicitPendingFilter(harness) {
    const initializationCalls = [];
    const appliedFilters = [];
    const pendingFilter = {
        category: 'P4',
        type: 'listening',
        filterMode: 'default',
        path: 'ListeningPractice/P4'
    };
    const originalQuerySelector = harness.windowStub.document.querySelector.bind(harness.windowStub.document);
    harness.windowStub.document.querySelector = function querySelector(selector) {
        if (selector === '.view.active') {
            return { id: 'browse-view' };
        }
        return originalQuerySelector(selector);
    };
    harness.windowStub.__pendingBrowseFilter = pendingFilter;
    harness.windowStub.AppLazyLoader.ensureGroup = function ensureGroup(name) {
        harness.ensureCalls.push(name);
        if (name === 'browse-runtime') {
            harness.windowStub.initializeBrowseView = async function initializeBrowseView(options) {
                initializationCalls.push(options || {});
            };
            harness.windowStub.applyBrowseFilter = async function applyBrowseFilter(...args) {
                appliedFilters.push(args);
            };
        }
        return Promise.resolve(true);
    };

    loadScript('js/app/main-entry.js', harness.context);
    await harness.windowStub.AppEntry.ensureBrowseGroup();

    assert.strictEqual(
        initializationCalls.length,
        1,
        'cold Browse activation should initialize exactly once when a category is pending'
    );
    assert.strictEqual(
        initializationCalls[0].skipLoad,
        true,
        'cold Browse activation should initialize without an unfiltered render when a category is pending'
    );
    assert.deepStrictEqual(appliedFilters, [[
        pendingFilter.category,
        pendingFilter.type,
        pendingFilter.filterMode,
        pendingFilter.path
    ]], 'cold Browse activation should preserve and apply the explicit category intent');
    assert.strictEqual(
        harness.windowStub.__pendingBrowseFilter,
        undefined,
        'the applied cold-start category intent should be cleared'
    );
    recordResult('browse 冷加载保留显式分类意图', true, {
        initializationCalls: initializationCalls.length,
        appliedFilters: appliedFilters.length
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
    const showViewCalls = [];
    harness.windowStub.showView = function showView(viewName, resetCategory) {
        showViewCalls.push({ viewName, resetCategory });
    };
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

    assert.strictEqual(navigationEnsureCalls, 2, 'Browse 预取应在冷启动和懒加载完成后各尝试初始化导航');
    assert.strictEqual(stateManagerCreations, 1, 'BrowseStateManager 应在懒加载完成后仅实例化一次');
    assert(harness.windowStub.browseStateManager, '冷启动 Browse 应暴露全局状态管理器实例');
    assert.strictEqual(fallbackRemovals, 1, '真实导航控制器挂载后应移除临时 fallback click handler');
    assert.strictEqual(navRoot._legacyNavHandler, undefined, 'fallback handler 标记应在升级后清理');
    assert(navigationOptions && typeof navigationOptions.onRepeatNavigate === 'function');
    assert.strictEqual(navigationOptions.initialView, 'browse', '导航升级必须保留 fallback 已激活的 Browse 高亮');

    navigationOptions.onNavigate('browse');
    assert.deepStrictEqual(
        showViewCalls.at(-1),
        { viewName: 'browse', resetCategory: false },
        '普通 Browse 导航必须保留当前分类和筛选状态'
    );
    navigationOptions.onRepeatNavigate('browse');
    assert.strictEqual(repeatResets, 1, '懒加载后的重复 Browse 点击应进入 reset handler');
    recordResult('browse 冷加载后补齐导航与状态管理器', true, {
        navigationEnsureCalls,
        stateManagerCreations,
        fallbackRemovals,
        repeatResets
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
        await testFallbackQueuesRepeatBrowseResetDuringLazyLoad();
        await testColdRepeatResetPreemptsBrowseSynchronization();
        await testDirectResetInvalidatesPendingColdBrowseLoad();
        await testHotBrowseCategorySupersedesQueuedColdCategory();
        await testQueuedBrowseCategoryStandsDownAfterNewNavigation();
        await testQueuedBrowseCategoryStandsDownAfterNavigationRoundTrip();
        await testAppNavigationMarksIntentBeforeSameViewShortCircuit();
        await testQueuedFilterBeatsLaterExamIndexRefresh();
        await testLaterQueuedFilterBeatsEarlierExamIndexRefresh();
        await testHotFilterBeatsLaterExamIndexRefresh();
        await testHotFilterAfterEventReceiptStillWins();
        await testLatestQueuedExamIndexRefreshWinsDuringBrowseInitialization();
        await testExamIndexRefreshPreservesActiveSearch();
        await testExamIndexRefreshPreemptsSameTokenLoad();
        await testExamIndexRefreshStandsDownDuringReset();
        await testExamIndexRefreshDuringResetRenderUsesLatestSnapshot();
        await testBrowseResetIntentClearsAfterRuntimeFailure();
        await testBrowseResetIntentClearsAfterResetFailure();
        await testBrowseResetAdapterFailureReplaysCapturedIndex();
        await testFailedResetReplayCannotBorrowNewResetToken();
        await testQueuedFilterSupersedesOlderPendingCategory();
        await testClearSearchProxyLoadsBrowseRuntime(createHarness());
        await testColdBrowseProxyRestoresPreferences(createHarness());
        await testColdBrowseAppliesExplicitPendingFilter(createHarness());
        await testColdBrowseRuntimeInitializesNavigationAndStateManager();
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
