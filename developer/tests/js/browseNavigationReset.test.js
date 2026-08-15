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
const mainSource = fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');

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

async function waitForCondition(predicate, message, rounds = 100) {
    for (let index = 0; index < rounds; index += 1) {
        if (predicate()) {
            return;
        }
        await Promise.resolve();
    }
    assert.fail(message);
}

function installProductionBrowseControlsSetup(windowStub) {
    const start = mainSource.indexOf('let browseControlsSeeded = false;');
    const end = mainSource.indexOf('async function persistBrowsePreference', start);
    assert.notEqual(start, -1, 'main.js should expose the browse-controls seed block');
    assert.notEqual(end, -1, 'main.js should keep persistBrowsePreference after the seed block');

    const sandbox = {
        window: windowStub,
        console: windowStub.console || console,
        Promise
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(`
        function setupBrowseSortControl() {}
        function setupBrowseFrequencyFilterControl() {}
        ${mainSource.slice(start, end)}
        window.__productionSetupBrowseControls = setupBrowseControls;
    `, context, { filename: 'js/main.js#browse-controls-seed' });
    return windowStub.__productionSetupBrowseControls;
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
    const dispatchedEvents = [];
    const loaderCalls = [];
    const renderedFilterIndexes = [];
    const filterStateCalls = [];
    const titleCalls = [];
    const preferencePatches = [];
    let flushBrowsePreferenceCalls = 0;
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
        dispatchEvent(event) {
            dispatchedEvents.push(event);
        },
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
                    if (typeof options.patchBrowse === 'function') {
                        return options.patchBrowse(value);
                    }
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
            flushBrowsePreferenceCalls += 1;
            if (typeof options.flushBrowsePreferenceWrites === 'function') {
                return options.flushBrowsePreferenceWrites();
            }
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
        context,
        getFlushBrowsePreferenceCalls: () => flushBrowsePreferenceCalls,
        getClearedAutoScroll: () => clearedAutoScroll,
        getResetToDefaultCalls: () => resetToDefaultCalls
    };
}

test('ordinary Browse navigation records history without resetting BrowseStateManager', async () => {
    const harness = createHarness();
    await harness.stateManager.ready;
    let resetCalls = 0;
    harness.stateManager.resetToAllExams = () => {
        resetCalls += 1;
    };

    harness.stateManager.handleBrowseNavigation();

    assert.equal(resetCalls, 0);
    assert.equal(harness.stateManager.currentFilter, 'P2');
    assert.equal(harness.stateManager.state.searchQuery, 'ocean');
    assert.equal(harness.stateManager.getBrowseHistory().at(-1).action, 'navigate_to_browse');
    assert.equal(harness.stateManager.getBrowseHistory().at(-1).filter, 'P2');
});

test('repeat Browse reset atomically clears UI/state and reloads the active index through the global adapter', async () => {
    const activeIndex = [{ id: 'p3-active', title: 'Active P3', category: 'P3', type: 'reading' }];
    const harness = createHarness({ activeIndex });
    await harness.stateManager.ready;

    await harness.window.ExamActions.resetBrowseViewToAll();

    assert.equal(harness.loaderCalls.length, 1);
    assert.deepEqual(harness.loaderCalls[0].ids, ['p3-active']);
    assert.notDeepEqual(harness.loaderCalls[0].indexOverride, []);
    assert.equal(harness.getResetToDefaultCalls(), 0, 'reset must not trigger the controller filtering pipeline');
    assert.equal(harness.getClearedAutoScroll(), 1);
    assert.equal(harness.window.browseController.currentMode, 'default');
    assert.equal(harness.window.browseController.activeFilter, 'all');
    assert.equal(harness.window.browseController.filterInteractionId, 4);
    assert.deepEqual(harness.renderedFilterIndexes, [['p3-active']]);
    assert.deepEqual(harness.filterStateCalls.at(-1), { category: 'all', type: 'all' });
    assert.equal(harness.searchInput.value, '');
    assert.equal(harness.searchClearButton.hidden, true);
    assert.equal(harness.window.__browseFilterMode, 'default');
    assert.equal(harness.window.__browsePath, null);
    assert.equal(harness.window.__browseFrequencyFilter, 'all');
    assert.equal(harness.window.__readingMemorizeBrowseMode, false);
    assert.equal(harness.window.__browseMemorizeFilterMode, null);
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
    assert.equal(harness.typeButtons[1].classList.contains('active'), false);
    assert(harness.frequencyButtons.every((button) => button.ariaPressed === 'false'));
    assert.equal(harness.titleCalls.at(-1), '题库列表');
    assert.equal(
        harness.preferencePatches.some((patch) => patch.frequencyFilter === 'all'),
        true,
        'repeat reset must persist the cleared top-level frequency preference'
    );
});

test('repeat reset waits for browse controls to restore preferences before clearing them', async () => {
    const controlsReady = deferred();
    const harness = createHarness({
        async setupBrowseControls(windowStub) {
            await controlsReady.promise;
            windowStub.__browseFrequencyFilter = 'high';
        }
    });
    await harness.stateManager.ready;

    const reset = harness.window.ExamActions.resetBrowseViewToAll();
    await Promise.resolve();
    assert.equal(harness.loaderCalls.length, 0);

    controlsReady.resolve();
    await reset;

    assert.equal(harness.window.__browseFrequencyFilter, 'all');
    assert.equal(harness.loaderCalls.length, 1);
    assert.equal(
        harness.preferencePatches.some((patch) => patch.frequencyFilter === 'all'),
        true
    );
});

test('concurrent browse-control setup calls share the in-flight preference hydration', async () => {
    const hydration = deferred();
    const harness = createHarness();
    await harness.stateManager.ready;
    let preferenceReads = 0;
    harness.window.AppData.preferences.getBrowse = () => {
        preferenceReads += 1;
        return hydration.promise;
    };
    harness.window.setupBrowseControls = installProductionBrowseControlsSetup(harness.window);

    const earlierSetup = harness.window.setupBrowseControls();
    const reset = harness.window.ExamActions.resetBrowseViewToAll();
    await flushMicrotasks();

    assert.equal(preferenceReads, 1, 'reset must join the existing hydration instead of starting a second read');
    assert.equal(harness.loaderCalls.length, 0);

    hydration.resolve({ sortMode: 'difficulty-desc', frequencyFilter: 'high' });
    await Promise.all([earlierSetup, reset]);

    assert.equal(preferenceReads, 1);
    assert.equal(harness.window.__browseFrequencyFilter, 'all');
    assert.equal(harness.loaderCalls.length, 1);
});

test('repeat reset renders before durable preference writes settle, then awaits their completion', async () => {
    const frequencyPersistence = deferred();
    const lastFilterPersistence = deferred();
    const harness = createHarness({
        patchBrowse(value) {
            return value && value.frequencyFilter === 'all'
                ? frequencyPersistence.promise
                : value;
        },
        flushBrowsePreferenceWrites() {
            assert.deepEqual(harness.filterStateCalls.at(-1), { category: 'all', type: 'all' });
            return lastFilterPersistence.promise;
        }
    });
    await harness.stateManager.ready;

    let settled = false;
    const reset = harness.window.ExamActions.resetBrowseViewToAll().then((value) => {
        settled = true;
        return value;
    });
    await waitForCondition(
        () => harness.loaderCalls.length === 1,
        'the list reload should start without waiting for persistence'
    );

    assert.equal(harness.loaderCalls.length, 1, 'storage latency must not block the list reload');
    assert.equal(settled, false, 'reset should still expose a durability completion boundary');
    assert.equal(harness.getFlushBrowsePreferenceCalls(), 1);

    frequencyPersistence.resolve();
    await flushMicrotasks();
    assert.equal(settled, false, 'lastFilter durability must also complete before reset resolves');

    lastFilterPersistence.resolve();
    await reset;
    assert.equal(settled, true);
});

test('a superseded reset still waits for the durable writes it started', async () => {
    const render = deferred();
    const frequencyPersistence = deferred();
    const lastFilterPersistence = deferred();
    const harness = createHarness({
        loaderResult: render.promise,
        patchBrowse(value) {
            return value && value.frequencyFilter === 'all'
                ? frequencyPersistence.promise
                : value;
        },
        flushBrowsePreferenceWrites() {
            return lastFilterPersistence.promise;
        }
    });
    await harness.stateManager.ready;

    let settled = false;
    const reset = harness.window.ExamActions.resetBrowseViewToAll().then((value) => {
        settled = true;
        return value;
    });
    await waitForCondition(
        () => harness.loaderCalls.length === 1,
        'the reset render should start before its persistence completes'
    );

    harness.window.__beginBrowseResultsRequest();
    render.resolve([{ id: 'stale-render' }]);
    await flushMicrotasks();
    assert.equal(settled, false, 'supersession must not bypass the durability boundary');

    frequencyPersistence.resolve();
    await flushMicrotasks();
    assert.equal(settled, false, 'lastFilter persistence must still be awaited after supersession');

    lastFilterPersistence.resolve();
    assert.equal(await reset, false);
    assert.equal(settled, true);
});

test('repeat reset waits for BrowseStateManager restoration so saved search and filters cannot return', async () => {
    const restoredBrowse = deferred();
    const harness = createHarness({
        getBrowse() {
            return restoredBrowse.promise;
        }
    });

    const reset = harness.window.ExamActions.resetBrowseViewToAll();
    await Promise.resolve();
    assert.equal(harness.loaderCalls.length, 0);

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

    assert.equal(harness.stateManager.state.searchQuery, '');
    assert.equal(harness.stateManager.state.currentCategory, null);
    assert.equal(harness.stateManager.state.currentFrequency, null);
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.stateManager.state.filters)),
        { frequency: 'all', status: 'all', difficulty: 'all' }
    );
    assert.equal(harness.loaderCalls.length, 1);
});

test('only the latest asynchronous repeat reset may update state or render', async () => {
    const first = deferred();
    const second = deferred();
    const harness = createHarness({ resolverQueue: [first, second] });
    await harness.stateManager.ready;

    const staleReset = harness.window.ExamActions.resetBrowseViewToAll();
    const latestReset = harness.window.ExamActions.resetBrowseViewToAll();
    second.resolve([{ id: 'latest-index', category: 'P1', type: 'reading' }]);
    await latestReset;
    first.resolve([{ id: 'stale-index', category: 'P2', type: 'reading' }]);
    const staleResult = await staleReset;

    assert.equal(staleResult, false);
    assert.equal(harness.loaderCalls.length, 1);
    assert.deepEqual(harness.loaderCalls[0].ids, ['latest-index']);
    assert.deepEqual(harness.renderedFilterIndexes, [['latest-index']]);
});

test('an empty prefetch is delegated as unresolved and the adapter result resynchronizes filter buttons', async () => {
    const harness = createHarness({
        activeIndex: [],
        loaderResult: [{ id: 'adapter-index', category: 'P4', type: 'listening' }]
    });
    await harness.stateManager.ready;

    await harness.window.ExamActions.resetBrowseViewToAll();

    assert.equal(harness.loaderCalls.length, 1);
    assert.equal(harness.loaderCalls[0].indexOverride, null);
    assert.equal(harness.loaderCalls[0].ids, null);
    assert.deepEqual(harness.renderedFilterIndexes, [[], ['adapter-index']]);
});

test('a global adapter failure is contained by repeat reset instead of becoming an unhandled rejection', async () => {
    const harness = createHarness({ loaderError: new Error('adapter failed') });
    await harness.stateManager.ready;

    const result = await harness.window.ExamActions.resetBrowseViewToAll();

    assert.equal(result, false);
    assert.equal(harness.loaderCalls.length, 1);
});

test('an unexpected reset-state exception is contained by the public async boundary', async () => {
    const harness = createHarness();
    await harness.stateManager.ready;
    harness.stateManager.resetToAllExams = () => {
        throw new Error('unexpected state failure');
    };

    const result = await harness.window.ExamActions.resetBrowseViewToAll();

    assert.equal(result, false);
    assert.equal(harness.loaderCalls.length, 0);
});

test('repeat reset invalidates a captured pending Browse activation filter', async () => {
    const activation = deferred();
    const harness = createHarness();
    await harness.stateManager.ready;
    loadScript('js/app.js', harness.context);
    const app = vm.runInContext('new ExamSystemApp()', harness.context);
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

    assert.deepEqual(appliedFilters, [], 'captured activation must not restore the category after reset');
    assert.strictEqual(
        harness.window.__pendingBrowseFilter,
        replacementPendingFilter,
        'the stale activation cleanup must retain a newer pending intent'
    );
    assert.equal(harness.window.__browseFilterMode, 'default');
    assert.equal(harness.window.__browseFrequencyFilter, 'all');
});
