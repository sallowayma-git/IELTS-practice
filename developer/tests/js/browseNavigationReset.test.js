#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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

function createClassList(initial = []) {
    const values = new Set(initial);
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        toggle(value, enabled) {
            if (enabled) values.add(value);
            else values.delete(value);
        },
        contains(value) { return values.has(value); }
    };
}

function createButton(dataset, active = false) {
    return {
        dataset: Object.assign({}, dataset),
        classList: createClassList(active ? ['active'] : []),
        ariaPressed: active ? 'true' : 'false',
        setAttribute(name, value) {
            if (name === 'aria-pressed') this.ariaPressed = value;
        }
    };
}

function createHarness(options = {}) {
    const documentListeners = new Map();
    const windowListeners = new Map();
    const loaderCalls = [];
    const renderedFilterIndexes = [];
    const filterStateCalls = [];
    const titleCalls = [];
    const preferencePatches = [];
    const resolverQueue = Array.isArray(options.resolverQueue) ? options.resolverQueue.slice() : [];
    const defaultIndex = Array.isArray(options.activeIndex)
        ? options.activeIndex
        : [{ id: 'p2-active', title: 'Active P2', category: 'P2', type: 'reading' }];

    const searchInput = { value: 'ocean' };
    const searchClearButton = { hidden: false };
    const typeButtons = [
        createButton({ filterId: 'all', filterType: 'all' }),
        createButton({ filterId: 'reading', filterType: 'reading' }, true),
        createButton({ filterId: 'listening', filterType: 'listening' })
    ];
    const frequencyButtons = [
        createButton({ frequencyFilter: 'high' }, true),
        createButton({ frequencyFilter: 'medium' })
    ];
    const typeContainer = {
        querySelectorAll() { return typeButtons; }
    };
    const frequencyContainer = {
        querySelectorAll() { return frequencyButtons; }
    };

    const documentStub = {
        readyState: 'complete',
        body: {},
        addEventListener(type, handler) {
            if (!documentListeners.has(type)) documentListeners.set(type, []);
            documentListeners.get(type).push(handler);
        },
        dispatchEvent() {},
        getElementById(id) {
            if (id === 'exam-search-input') return searchInput;
            if (id === 'search-clear-btn') return searchClearButton;
            if (id === 'type-filter-buttons') return typeContainer;
            if (id === 'browse-frequency-filter-buttons') return frequencyContainer;
            return null;
        },
        querySelector(selector) {
            if (selector === '.search-input') return searchInput;
            return null;
        },
        querySelectorAll() { return []; },
        createElement() {
            return {
                classList: createClassList(),
                dataset: {},
                style: {},
                appendChild() {},
                removeChild() {},
                addEventListener() {},
                setAttribute() {},
                querySelector() { return null; },
                querySelectorAll() { return []; }
            };
        },
        createTextNode(value) {
            return { textContent: String(value || '') };
        }
    };

    let browseRequestId = 0;
    let clearedAutoScroll = 0;
    let resetToDefaultCalls = 0;
    const browseController = {
        currentMode: 'frequency-p1',
        activeFilter: 'high',
        filterInteractionId: 3,
        clearPendingBrowseAutoScroll() {
            clearedAutoScroll += 1;
        },
        resetToDefault() {
            resetToDefaultCalls += 1;
            throw new Error('resetToDefault must not run during atomic reset');
        },
        renderFilterButtons(index) {
            renderedFilterIndexes.push(Array.from(index, (exam) => exam.id));
        }
    };

    const quietConsole = { log() {}, warn() {}, error() {}, info() {} };
    const windowStub = {
        console: quietConsole,
        document: documentStub,
        AppData: {
            ready: Promise.resolve(),
            preferences: {
                async getBrowse() {
                    return typeof options.getBrowse === 'function'
                        ? options.getBrowse()
                        : null;
                },
                async patchBrowse(value) {
                    preferencePatches.push(JSON.parse(JSON.stringify(value)));
                    return value;
                }
            }
        },
        browseController,
        __browseFilterMode: 'frequency-p1',
        __browsePath: 'ListeningPractice/100 P1',
        __browseFrequencyFilter: 'high',
        __readingMemorizeBrowseMode: true,
        __browseMemorizeFilterMode: 'reading-memorize',
        addEventListener(type, handler) {
            if (!windowListeners.has(type)) windowListeners.set(type, []);
            windowListeners.get(type).push(handler);
        },
        removeEventListener() {},
        setBrowseFilterState(category, type) {
            filterStateCalls.push({ category, type });
        },
        setBrowseTitle(value) {
            titleCalls.push(value);
        },
        updateBrowseFrequencyButtons(value) {
            this.__browseFrequencyFilter = value;
            frequencyButtons.forEach((button) => {
                const active = button.dataset.frequencyFilter === value;
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        },
        setReadingMemorizeBrowseMode(value) {
            this.__readingMemorizeBrowseMode = value;
        },
        syncReadingMemorizeBrowseModeUI() {},
        flushBrowsePreferenceWrites() {
            return Promise.resolve();
        },
        async setupBrowseControls() {
            if (typeof options.setupBrowseControls === 'function') {
                return options.setupBrowseControls(this);
            }
        },
        __beginBrowseResultsRequest() {
            browseRequestId += 1;
            return browseRequestId;
        },
        __isBrowseResultsRequestCurrent(requestId) {
            return requestId === browseRequestId;
        },
        resolveActiveLibraryIndex() {
            const queued = resolverQueue.shift();
            return queued ? queued.promise : Promise.resolve(defaultIndex);
        },
        loadExamList(indexOverride, renderRequestId) {
            loaderCalls.push({
                indexOverride,
                ids: Array.isArray(indexOverride) ? Array.from(indexOverride, (exam) => exam.id) : null,
                renderRequestId
            });
            if (options.loaderError) {
                return Promise.reject(options.loaderError);
            }
            if (Object.prototype.hasOwnProperty.call(options, 'loaderResult')) {
                return Promise.resolve(options.loaderResult);
            }
            return Promise.resolve(indexOverride);
        }
    };

    const sandbox = {
        window: windowStub,
        document: documentStub,
        console: quietConsole,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        Node: function Node() {},
        Event: class Event {},
        Promise,
        Set,
        Map,
        Date,
        Math,
        JSON,
        URL,
        URLSearchParams,
        setTimeout,
        clearTimeout
    };
    sandbox.globalThis = windowStub;
    sandbox.self = windowStub;
    const context = vm.createContext(sandbox);

    loadScript('js/components/BrowseStateManager.js', context);
    const stateManager = new windowStub.BrowseStateManager();
    stateManager.currentFilter = 'P2';
    stateManager.state.currentCategory = 'P2';
    stateManager.state.currentFrequency = 'high';
    stateManager.state.filters = { frequency: 'high', status: 'started', difficulty: 'hard' };
    stateManager.state.searchQuery = 'ocean';
    loadScript('js/app/examActions.js', context);

    return {
        window: windowStub,
        stateManager,
        searchInput,
        searchClearButton,
        typeButtons,
        frequencyButtons,
        loaderCalls,
        renderedFilterIndexes,
        filterStateCalls,
        titleCalls,
        preferencePatches,
        documentListeners,
        context,
        getClearedAutoScroll: () => clearedAutoScroll,
        getResetToDefaultCalls: () => resetToDefaultCalls
    };
}

test('ordinary Browse navigation preserves the selected scope and search state', async () => {
    const harness = createHarness();
    await harness.stateManager.ready;
    let resetCalls = 0;
    harness.stateManager.resetToAllExams = () => {
        resetCalls += 1;
    };

    harness.stateManager.handleBrowseNavigation();

    assert.equal(resetCalls, 0);
    assert.equal(harness.stateManager.currentFilter, 'P2');
    assert.equal(harness.stateManager.state.currentCategory, 'P2');
    assert.equal(harness.stateManager.state.searchQuery, 'ocean');
    assert.equal(harness.stateManager.getBrowseHistory().at(-1).action, 'navigate_to_browse');
    assert.equal(harness.stateManager.getBrowseHistory().at(-1).filter, 'P2');
});

test('repeat Browse reset clears all browse state and renders the active index through the global adapter', async () => {
    const activeIndex = [{ id: 'p3-active', title: 'Active P3', category: 'P3', type: 'reading' }];
    const harness = createHarness({ activeIndex });
    await harness.stateManager.ready;

    await harness.window.ExamActions.resetBrowseViewToAll();

    assert.equal(harness.loaderCalls.length, 1, 'reset must use the global loading adapter exactly once');
    assert.deepEqual(harness.loaderCalls[0].ids, ['p3-active']);
    assert.notDeepEqual(
        harness.loaderCalls[0].indexOverride,
        [],
        'reset must never render the module-local loader default empty array'
    );
    assert.equal(harness.getResetToDefaultCalls(), 0, 'reset must not start the controller filtering pipeline');
    assert.equal(harness.getClearedAutoScroll(), 1);
    assert.equal(harness.window.browseController.currentMode, 'default');
    assert.equal(harness.window.browseController.activeFilter, 'all');
    assert.equal(harness.window.browseController.filterInteractionId, 4);
    assert.deepEqual(harness.renderedFilterIndexes, [['p3-active']]);
    assert.deepEqual(harness.filterStateCalls.at(-1), { category: 'all', type: 'all' });
    assert.equal(harness.window.__browseFilterMode, 'default');
    assert.equal(harness.window.__browsePath, null);
    assert.equal(harness.window.__browseFrequencyFilter, 'all');
    assert.equal(harness.searchInput.value, '');
    assert.equal(harness.searchClearButton.hidden, true);
    assert.equal(harness.stateManager.currentFilter, 'all');
    assert.equal(harness.stateManager.state.currentCategory, null);
    assert.equal(harness.stateManager.state.currentFrequency, null);
    assert.equal(harness.stateManager.state.searchQuery, '');
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.stateManager.state.filters)),
        { frequency: 'all', status: 'all', difficulty: 'all' }
    );
    assert.equal(harness.typeButtons[0].classList.contains('active'), true);
    assert.equal(harness.typeButtons[0].ariaPressed, 'true');
    assert(harness.frequencyButtons.every((button) => button.ariaPressed === 'false'));
    assert.equal(harness.titleCalls.at(-1), '题库列表');
    assert.equal(
        harness.preferencePatches.some((patch) => patch.frequencyFilter === 'all'),
        true,
        'cleared frequency state must be durable'
    );
});

test('only the latest asynchronous repeat reset may update state or render', async () => {
    const latest = deferred();
    const harness = createHarness({ resolverQueue: [latest] });
    await harness.stateManager.ready;

    const staleReset = harness.window.ExamActions.resetBrowseViewToAll();
    const latestReset = harness.window.ExamActions.resetBrowseViewToAll();
    latest.resolve([{ id: 'latest-index', category: 'P1', type: 'reading' }]);
    await latestReset;
    const staleResult = await staleReset;

    assert.equal(staleResult, false);
    assert.equal(harness.loaderCalls.length, 1);
    assert.deepEqual(harness.loaderCalls[0].ids, ['latest-index']);
    assert.deepEqual(harness.renderedFilterIndexes, [['latest-index']]);
});

test('an empty prefetch is passed as null so the global adapter can resolve the active index', async () => {
    const adapterIndex = [{ id: 'adapter-index', category: 'P4', type: 'listening' }];
    const harness = createHarness({
        activeIndex: [],
        loaderResult: adapterIndex
    });
    await harness.stateManager.ready;

    const result = await harness.window.ExamActions.resetBrowseViewToAll();

    assert.deepEqual(result, adapterIndex);
    assert.equal(harness.loaderCalls.length, 1);
    assert.equal(harness.loaderCalls[0].indexOverride, null);
    assert.equal(harness.loaderCalls[0].ids, null);
    assert.deepEqual(harness.renderedFilterIndexes.at(-1), ['adapter-index']);
});

test('repeat reset waits for BrowseStateManager restoration before clearing saved filters', async () => {
    const restoredBrowse = deferred();
    const harness = createHarness({
        getBrowse() {
            return restoredBrowse.promise;
        }
    });

    const reset = harness.window.ExamActions.resetBrowseViewToAll();
    await flushMicrotasks();
    assert.equal(harness.loaderCalls.length, 0, 'reset must wait for persisted state restoration');

    restoredBrowse.resolve({
        stateManager: {
            previousFilter: 'P1',
            browseHistory: [],
            state: {
                currentCategory: 'P1',
                currentFrequency: 'high',
                filters: { frequency: 'high', status: 'started', difficulty: 'hard' },
                searchQuery: 'restored query'
            }
        }
    });
    await reset;

    assert.equal(harness.stateManager.state.currentCategory, null);
    assert.equal(harness.stateManager.state.currentFrequency, null);
    assert.equal(harness.stateManager.state.searchQuery, '');
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.stateManager.state.filters)),
        { frequency: 'all', status: 'all', difficulty: 'all' }
    );
    assert.equal(harness.loaderCalls.length, 1);
});

test('repeat reset waits for browse-control hydration before clearing frequency state', async () => {
    const controlsReady = deferred();
    const harness = createHarness({
        async setupBrowseControls(windowStub) {
            await controlsReady.promise;
            windowStub.__browseFrequencyFilter = 'high';
        }
    });
    await harness.stateManager.ready;

    const reset = harness.window.ExamActions.resetBrowseViewToAll();
    await flushMicrotasks();
    assert.equal(harness.loaderCalls.length, 0, 'reset must wait for in-flight browse-control hydration');

    controlsReady.resolve();
    await reset;

    assert.equal(harness.window.__browseFrequencyFilter, 'all');
    assert.equal(harness.loaderCalls.length, 1);
});

test('repeat reset owns frequency state when the main UI helper is unavailable', async () => {
    const harness = createHarness();
    await harness.stateManager.ready;
    harness.window.updateBrowseFrequencyButtons = undefined;

    await harness.window.ExamActions.resetBrowseViewToAll();

    assert.equal(harness.window.__browseFrequencyFilter, 'all');
    assert(harness.frequencyButtons.every((button) => button.ariaPressed === 'false'));
});

test('owner reset without an index preserves controller buttons and clears controller state', () => {
    const harness = createHarness();
    const controllerStateCalls = [];
    harness.window.setBrowseFilterState = undefined;
    harness.window.browseController.setBrowseFilterState = (category, type) => {
        controllerStateCalls.push({ category, type });
    };

    harness.window.ExamActions.resetBrowseFilterStateToAll();

    assert.deepEqual(harness.renderedFilterIndexes, [], 'an absent index must not be treated as an empty listening library');
    assert.deepEqual(controllerStateCalls, [{ category: 'all', type: 'all' }]);
    assert.equal(harness.window.__browseFilterMode, 'default');
    assert.equal(harness.window.__browsePath, null);
    assert.equal(harness.window.__browseFrequencyFilter, 'all');
});

test('one bubbling Browse click refreshes through the controller only once', () => {
    const harness = createHarness();
    const browseView = { classList: createClassList() };
    const originalGetElementById = harness.window.document.getElementById.bind(harness.window.document);
    harness.window.document.getElementById = (id) => {
        if (id === 'browse-view') return browseView;
        return originalGetElementById(id);
    };
    loadScript('js/views/legacyViewBundle.js', harness.context);
    loadScript('js/app.js', harness.context);
    const app = vm.runInContext('new ExamSystemApp()', harness.context);
    let activationSetups = 0;
    let terminalRenders = 0;
    let unexpectedAppActivations = 0;
    harness.window.activateBrowseView = () => {
        activationSetups += 1;
        terminalRenders += 1;
        return Promise.resolve();
    };
    harness.window.initializeBrowseView = () => {
        unexpectedAppActivations += 1;
    };
    loadScript('js/boot-fallbacks.js', harness.context);
    app.currentView = 'overview';
    app.setupEventListeners();

    const button = {
        dataset: { view: 'browse' },
        classList: createClassList()
    };
    let rootClickListener = null;
    const navRoot = {
        addEventListener(type, listener) {
            if (type === 'click') rootClickListener = listener;
        },
        removeEventListener() {},
        contains(value) { return value === button; },
        querySelectorAll() { return [button]; }
    };
    const controller = new harness.window.LegacyNavigationController({
        container: navRoot,
        onNavigate(viewName) {
            harness.window.showView(viewName, false);
        }
    });
    controller.mount(navRoot);

    const clickListeners = harness.documentListeners.get('click') || [];
    const appClickListener = clickListeners.at(-1);
    assert.equal(typeof rootClickListener, 'function');
    assert.equal(typeof appClickListener, 'function');
    const event = {
        preventDefault() {},
        target: {
            closest(selector) {
                if (selector === '.nav-btn' || selector === '.nav-btn[data-view]') {
                    return button;
                }
                return null;
            }
        }
    };
    rootClickListener(event);
    appClickListener(event);

    assert.equal(event.__browseNavigationHandled, true);
    assert.equal(app.currentView, 'browse');
    assert.equal(activationSetups, 1, 'the controller path must run first-activation setup exactly once');
    assert.equal(terminalRenders, 1, 'first activation must produce one terminal render');
    assert.equal(unexpectedAppActivations, 0, 'the bubbled document handler must not start a second activation');
    assert.equal(harness.searchInput.value, 'ocean', 'ordinary Browse navigation must preserve the active query');
});

test('repeat reset invalidates a captured pending Browse activation filter', async () => {
    const activation = deferred();
    const harness = createHarness();
    await harness.stateManager.ready;
    loadScript('js/app.js', harness.context);
    const app = vm.runInContext('new ExamSystemApp()', harness.context);
    app.currentView = 'browse';
    const appliedFilters = [];
    const pendingFilter = {
        category: 'P3',
        type: 'reading',
        filterMode: null,
        path: null
    };
    harness.window.__pendingBrowseFilter = pendingFilter;
    harness.window.initializeBrowseView = () => activation.promise;
    harness.window.applyBrowseFilter = (...args) => {
        appliedFilters.push(args);
        return Promise.resolve();
    };

    app.onViewActivated('browse');
    const reset = harness.window.ExamActions.resetBrowseViewToAll();
    assert.equal(harness.window.__pendingBrowseFilter, undefined);
    const replacementPendingFilter = {
        category: 'P4',
        type: 'listening',
        filterMode: null,
        path: null
    };
    harness.window.__pendingBrowseFilter = replacementPendingFilter;
    await reset;

    activation.resolve();
    await flushMicrotasks();

    assert.deepEqual(appliedFilters, [], 'captured activation must not restore the pre-reset category');
    assert.strictEqual(
        harness.window.__pendingBrowseFilter,
        replacementPendingFilter,
        'stale activation cleanup must retain a newer pending intent'
    );
    assert.equal(harness.window.__browseFilterMode, 'default');
    assert.equal(harness.window.__browseFrequencyFilter, 'all');
});

test('explicit category activation applies its pending filter when no reset supersedes it', async () => {
    const harness = createHarness();
    await harness.stateManager.ready;
    loadScript('js/app.js', harness.context);
    const app = vm.runInContext('new ExamSystemApp()', harness.context);
    app.currentView = 'browse';
    const initializationCalls = [];
    const appliedFilters = [];
    const pendingFilter = {
        category: 'P3',
        type: 'reading',
        filterMode: 'default',
        path: 'ReadingPractice/P3'
    };
    harness.window.__pendingBrowseFilter = pendingFilter;
    harness.window.initializeBrowseView = (options) => {
        initializationCalls.push(options);
        return Promise.resolve();
    };
    harness.window.applyBrowseFilter = (...args) => {
        appliedFilters.push(args);
        return Promise.resolve();
    };

    app.onViewActivated('browse');
    await flushMicrotasks();

    assert.equal(initializationCalls.length, 1);
    assert.equal(initializationCalls[0].skipLoad, true);
    assert.deepEqual(appliedFilters, [[
        pendingFilter.category,
        pendingFilter.type,
        pendingFilter.filterMode,
        pendingFilter.path
    ]]);
    assert.equal(
        harness.window.__pendingBrowseFilter,
        undefined,
        'the applied explicit category intent should be cleared'
    );
});

test('a newer navigation cancels a delayed hot pending Browse filter', async () => {
    const harness = createHarness();
    await harness.stateManager.ready;
    loadScript('js/app.js', harness.context);
    const app = vm.runInContext('new ExamSystemApp()', harness.context);
    const initialization = deferred();
    const appliedFilters = [];
    const browseView = { id: 'browse-view', classList: createClassList() };
    const overviewView = { id: 'overview-view', classList: createClassList(['active']) };
    const originalGetElementById = harness.window.document.getElementById.bind(harness.window.document);
    const originalQuerySelector = harness.window.document.querySelector.bind(harness.window.document);
    const originalQuerySelectorAll = harness.window.document.querySelectorAll.bind(harness.window.document);
    harness.window.document.getElementById = (id) => {
        if (id === 'browse-view') return browseView;
        if (id === 'overview-view') return overviewView;
        return originalGetElementById(id);
    };
    harness.window.document.querySelector = (selector) => {
        if (selector === '.view.active') {
            return [browseView, overviewView].find((view) => view.classList.contains('active')) || null;
        }
        if (selector.startsWith('[data-view=')) return null;
        return originalQuerySelector(selector);
    };
    harness.window.document.querySelectorAll = (selector) => {
        if (selector === '.view') return [browseView, overviewView];
        if (selector === '.nav-btn') return [];
        return originalQuerySelectorAll(selector);
    };
    harness.window.location = 'https://example.test/?view=overview';
    harness.window.history = { replaceState() {} };
    harness.window.initializeBrowseView = () => initialization.promise;
    harness.window.applyBrowseFilter = (...args) => {
        appliedFilters.push(args);
        return Promise.resolve();
    };
    app.refreshOverviewData = () => {};

    app.browseCategory('P3', 'reading');
    app.navigateToView('overview');
    initialization.resolve();
    await flushMicrotasks();

    assert.deepEqual(appliedFilters, [], 'the stale pending filter must not reactivate Browse');
    assert.equal(app.currentView, 'overview');
    assert.equal(overviewView.classList.contains('active'), true);
    assert.equal(browseView.classList.contains('active'), false);
    assert.equal(harness.window.__pendingBrowseFilter, undefined);
});

test('a fallback navigation round trip invalidates a delayed hot Browse filter', async () => {
    const harness = createHarness();
    await harness.stateManager.ready;
    loadScript('js/app.js', harness.context);
    const app = vm.runInContext('new ExamSystemApp()', harness.context);
    const initialization = deferred();
    const appliedFilters = [];
    let sharedNavigationGeneration = 0;
    const browseView = { id: 'browse-view', classList: createClassList() };
    const overviewView = { id: 'overview-view', classList: createClassList(['active']) };
    const views = [browseView, overviewView];
    const originalGetElementById = harness.window.document.getElementById.bind(harness.window.document);
    const originalQuerySelector = harness.window.document.querySelector.bind(harness.window.document);
    const originalQuerySelectorAll = harness.window.document.querySelectorAll.bind(harness.window.document);
    harness.window.document.getElementById = (id) => {
        if (id === 'browse-view') return browseView;
        if (id === 'overview-view') return overviewView;
        return originalGetElementById(id);
    };
    harness.window.document.querySelector = (selector) => {
        if (selector === '.view.active') {
            return views.find((view) => view.classList.contains('active')) || null;
        }
        if (selector.startsWith('[data-view=')) return null;
        return originalQuerySelector(selector);
    };
    harness.window.document.querySelectorAll = (selector) => {
        if (selector === '.view') return views;
        if (selector === '.nav-btn') return [];
        return originalQuerySelectorAll(selector);
    };
    harness.window.location = 'https://example.test/?view=overview';
    harness.window.history = { replaceState() {} };
    harness.window.__markAppNavigationIntent = () => {
        sharedNavigationGeneration += 1;
        return sharedNavigationGeneration;
    };
    harness.window.__getAppNavigationIntentGeneration = () => sharedNavigationGeneration;
    harness.window.showView = (viewName) => {
        harness.window.__markAppNavigationIntent();
        views.forEach((view) => view.classList.remove('active'));
        (viewName === 'browse' ? browseView : overviewView).classList.add('active');
    };
    harness.window.initializeBrowseView = () => initialization.promise;
    harness.window.applyBrowseFilter = (...args) => {
        appliedFilters.push(args);
        return Promise.resolve();
    };

    app.browseCategory('P3', 'reading');
    const capturedPendingFilter = harness.window.__pendingBrowseFilter;
    harness.window.showView('overview', false);
    harness.window.showView('browse', false);
    initialization.resolve();
    await flushMicrotasks();

    assert.deepEqual(
        appliedFilters,
        [],
        'returning to Browse must not make an older activation intent current again'
    );
    assert.equal(app.currentView, 'browse', 'the fallback does not update app-local view state');
    assert.equal(browseView.classList.contains('active'), true);
    assert.equal(overviewView.classList.contains('active'), false);
    assert.notEqual(capturedPendingFilter, undefined);
    assert.equal(harness.window.__pendingBrowseFilter, undefined);
});

test('activation reset waits for hydration and durably clears restored Browse state', async () => {
    const controlsReady = deferred();
    const harness = createHarness({
        async setupBrowseControls(windowStub) {
            await controlsReady.promise;
            windowStub.__browseFrequencyFilter = 'high';
        }
    });
    await harness.stateManager.ready;
    let cachedLastFilter = { category: 'P2', type: 'reading' };
    harness.window.saveBrowseViewPreferences = (partial) => {
        if (partial && partial.lastFilter) cachedLastFilter = partial.lastFilter;
        return { lastFilter: cachedLastFilter };
    };
    harness.window.flushBrowsePreferenceWrites = async () => ({ lastFilter: cachedLastFilter });
    harness.window.getPersistedBrowseFilter = () => cachedLastFilter;

    const reset = harness.window.ExamActions.browseFilterStateOwner.resetForActivation();
    await flushMicrotasks();
    assert.equal(harness.window.__browseFrequencyFilter, 'high');
    controlsReady.resolve();
    assert.equal(await reset, true);

    assert.deepEqual(
        JSON.parse(JSON.stringify(cachedLastFilter)),
        { category: 'all', type: 'all' }
    );
    assert.equal(harness.window.__browseFilterMode, 'default');
    assert.equal(harness.window.__browsePath, null);
    assert.equal(harness.window.__browseFrequencyFilter, 'all');
    assert.equal(harness.searchInput.value, '');
    assert.equal(harness.stateManager.currentFilter, 'all');
    assert.equal(harness.stateManager.state.currentCategory, null);
    assert.equal(harness.stateManager.state.currentFrequency, null);
    assert.equal(harness.stateManager.state.searchQuery, '');
    assert.equal(
        harness.preferencePatches.some((patch) => (
            patch.frequencyFilter === 'all'
            && patch.filter?.category === 'all'
            && patch.filter?.type === 'all'
        )),
        true,
        'the activation reset must persist both current and legacy cleared filters after hydration'
    );
});

test('a global adapter failure is contained by the public reset boundary', async () => {
    const harness = createHarness({ loaderError: new Error('adapter failed') });
    await harness.stateManager.ready;

    const result = await harness.window.ExamActions.resetBrowseViewToAll();

    assert.equal(result, false);
    assert.equal(harness.loaderCalls.length, 1);
});
