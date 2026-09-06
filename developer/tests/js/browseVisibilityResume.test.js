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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
        dataset: { ...dataset },
        classList: createClassList(active ? ['active'] : []),
        ariaPressed: active ? 'true' : 'false',
        setAttribute(name, value) {
            if (name === 'aria-pressed') this.ariaPressed = value;
        }
    };
}

async function createHarness() {
    const statsGate = deferred();
    const stalePreferenceRead = deferred();
    const preferencePatches = [];
    const renderedIds = [];
    const progressSyncCalls = [];
    let resumePreferenceReads = 0;
    let useDelayedResumePreference = false;
    let browseInitializations = 0;

    const durableBrowse = {
        lastFilter: { category: 'P1', type: 'listening' },
        filter: { category: 'all', type: 'all' },
        frequencyFilter: 'medium',
        sortMode: 'frequency-desc'
    };
    const examIndex = [
        {
            id: 'selected-ocean',
            title: 'Ocean currents',
            category: 'P4',
            type: 'listening',
            path: 'ListeningPractice/100 P4/P4 高频(52)/Ocean',
            frequency: 'high'
        },
        {
            id: 'wrong-frequency',
            title: 'Ocean climate',
            category: 'P4',
            type: 'listening',
            path: 'ListeningPractice/100 P4/P4 高频(52)/Ocean',
            frequency: 'low'
        },
        {
            id: 'wrong-query',
            title: 'Desert winds',
            category: 'P4',
            type: 'listening',
            path: 'ListeningPractice/100 P4/P4 高频(52)/Ocean',
            frequency: 'high'
        },
        {
            id: 'wrong-category',
            title: 'Ocean habitats',
            category: 'P1',
            type: 'listening',
            path: 'ListeningPractice/100 P1/P1 高频（35）/Ocean',
            frequency: 'high'
        }
    ];
    const practiceRecords = [{
        examId: 'selected-ocean',
        accuracy: 1,
        startTime: '2026-08-30T00:00:00.000Z'
    }];
    const searchInput = { value: 'ocean' };
    const typeButtons = [
        createButton({ filterType: 'all' }),
        createButton({ filterType: 'reading' }, true),
        createButton({ filterType: 'listening' })
    ];
    const frequencyButtons = [
        createButton({ frequencyFilter: 'high' }, true),
        createButton({ frequencyFilter: 'medium' }),
        createButton({ frequencyFilter: 'low' })
    ];
    const browseView = { id: 'browse-view', classList: createClassList(['active']) };
    const documentListeners = new Map();
    const documentStub = {
        hidden: false,
        readyState: 'loading',
        body: { classList: createClassList(), appendChild() {} },
        documentElement: { classList: createClassList() },
        addEventListener(type, handler) {
            if (!documentListeners.has(type)) documentListeners.set(type, []);
            documentListeners.get(type).push(handler);
        },
        removeEventListener() {},
        querySelector(selector) {
            if (selector === '.search-input') return searchInput;
            if (selector === '.view.active') return browseView;
            return null;
        },
        querySelectorAll() { return []; },
        getElementById(id) {
            if (id === 'browse-view') return browseView;
            if (id === 'exam-search-input') return searchInput;
            if (id === 'type-filter-buttons') {
                return { querySelectorAll() { return typeButtons; } };
            }
            if (id === 'browse-frequency-filter-buttons') {
                return { querySelectorAll() { return frequencyButtons; } };
            }
            return null;
        },
        createElement() {
            return {
                classList: createClassList(),
                dataset: {},
                style: {},
                appendChild() {},
                setAttribute() {}
            };
        }
    };

    const quietConsole = { log() {}, info() {}, warn() {}, error() {} };
    const sandbox = {
        console: quietConsole,
        document: documentStub,
        location: {
            href: 'https://example.test/index.html?view=browse',
            search: '?view=browse',
            origin: 'https://example.test',
            protocol: 'https:'
        },
        history: { replaceState() {} },
        navigator: {},
        URL,
        URLSearchParams,
        Promise,
        Set,
        Map,
        Date,
        Math,
        JSON,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame(callback) { return setTimeout(callback, 0); },
        cancelAnimationFrame: clearTimeout,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        confirm() { return false; },
        alert() {},
        __browseFilterMode: 'frequency-p1',
        __browsePath: 'ListeningPractice/100 P1',
        __browseFrequencyFilter: 'medium',
        __browseSortMode: 'frequency-desc',
        browseController: {
            currentMode: 'frequency-p1',
            activeFilter: 'medium',
            currentCategory: 'P1',
            currentExamType: 'listening'
        },
        browseStateManager: {
            currentFilter: 'P1',
            state: {
                currentCategory: 'P1',
                currentFrequency: 'medium',
                filters: { frequency: 'medium', status: 'all', difficulty: 'all' },
                searchQuery: 'ocean'
            }
        },
        async resolveActiveLibraryIndex() {
            return examIndex;
        },
        initializeBrowseView() {
            browseInitializations += 1;
            return Promise.resolve(examIndex);
        },
        AppData: {
            ready: Promise.resolve(),
            preferences: {
                async getBrowse() {
                    if (useDelayedResumePreference) {
                        resumePreferenceReads += 1;
                        return stalePreferenceRead.promise;
                    }
                    return clone(durableBrowse);
                },
                async patchBrowse(value) {
                    const patch = clone(value || {});
                    preferencePatches.push(patch);
                    Object.assign(durableBrowse, patch);
                    return clone(durableBrowse);
                },
                async setBrowse(value) {
                    Object.assign(durableBrowse, clone(value || {}));
                    return clone(durableBrowse);
                }
            },
            practice: {
                async getStats() {
                    await statsGate.promise;
                    return { totalPractices: practiceRecords.length };
                },
                async list() {
                    return clone(practiceRecords);
                }
            }
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    const context = vm.createContext(sandbox);

    loadScript('js/app/state-service.js', context);
    loadScript('js/utils/BrowsePreferencesUtils.js', context);
    await sandbox.whenBrowseViewPreferencesReady();
    loadScript('js/app.js', context);
    const app = vm.runInContext('new ExamSystemApp()', context);
    app.initializeGlobalCompatibility();
    app.currentView = 'browse';

    sandbox.setBrowseFilterState('P1', 'reading');
    await sandbox.flushBrowsePreferenceWrites();

    sandbox.ensurePracticeRecordsSync = async (...syncArgs) => {
        const [trigger, options] = syncArgs;
        progressSyncCalls.push({
            trigger,
            options: { ...(options || {}) },
            argumentCount: syncArgs.length
        });
        const activeFilter = sandbox.getBrowseFilterState();
        const query = searchInput.value.trim().toLowerCase();
        const pathFilter = sandbox.__browsePath;
        const frequencyFilter = sandbox.__browseFrequencyFilter;
        const ids = examIndex
            .filter((exam) => activeFilter.category === 'all'
                || exam.category === activeFilter.category)
            .filter((exam) => activeFilter.type === 'all'
                || exam.type === activeFilter.type)
            .filter((exam) => !pathFilter || exam.path.includes(pathFilter))
            .filter((exam) => frequencyFilter === 'all'
                || exam.frequency === frequencyFilter)
            .filter((exam) => !query || exam.title.toLowerCase().includes(query))
            .map((exam) => exam.id);
        renderedIds.push(ids);
        return clone(practiceRecords);
    };

    return {
        app,
        sandbox,
        durableBrowse,
        documentListeners,
        examIndex,
        frequencyButtons,
        preferencePatches,
        progressSyncCalls,
        renderedIds,
        searchInput,
        stalePreferenceRead,
        statsGate,
        typeButtons,
        getBrowseInitializations: () => browseInitializations,
        getResumePreferenceReads: () => resumePreferenceReads,
        beginDelayedResumePreferenceRead() {
            useDelayedResumePreference = true;
        }
    };
}

function applyLatestBrowseIntent(harness, searchQuery = 'ocean') {
    const { app, sandbox, searchInput, typeButtons, frequencyButtons } = harness;
    sandbox.setBrowseFilterState('P4', 'listening');
    sandbox.__browseFilterMode = 'frequency-p4';
    sandbox.__browsePath = 'ListeningPractice/100 P4/P4 高频(52)/Ocean';
    sandbox.__browseFrequencyFilter = 'high';
    sandbox.__browseSortMode = 'frequency-desc';
    sandbox.browseController.currentMode = 'frequency-p4';
    sandbox.browseController.activeFilter = 'high';
    sandbox.browseController.currentCategory = 'P4';
    sandbox.browseController.currentExamType = 'listening';
    sandbox.browseStateManager.currentFilter = 'P4';
    sandbox.browseStateManager.state.currentCategory = 'P4';
    sandbox.browseStateManager.state.currentFrequency = 'high';
    sandbox.browseStateManager.state.filters.frequency = 'high';
    sandbox.browseStateManager.state.searchQuery = searchQuery;
    searchInput.value = searchQuery;
    typeButtons.forEach((button) => {
        const active = button.dataset.filterType === 'listening';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    frequencyButtons.forEach((button) => {
        const active = button.dataset.frequencyFilter === 'high';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    assert.deepEqual(clone(app.state.ui.browseFilter), { category: 'P4', type: 'listening' });
}

test('visibility resume refreshes progress without rehydrating or reactivating Browse scope', async () => {
    const harness = await createHarness();
    harness.beginDelayedResumePreferenceRead();

    const refresh = harness.app.refreshData();
    await flushMicrotasks();
    applyLatestBrowseIntent(harness);
    await harness.sandbox.flushBrowsePreferenceWrites();

    harness.stalePreferenceRead.resolve({
        lastFilter: { category: 'P1', type: 'listening' },
        filter: { category: 'all', type: 'all' },
        frequencyFilter: 'medium',
        sortMode: 'frequency-desc'
    });
    harness.statsGate.resolve();
    await refresh;
    await harness.sandbox.flushBrowsePreferenceWrites();

    assert.equal(
        harness.getResumePreferenceReads(),
        0,
        'visibility resume must not start a persisted Browse-intent read'
    );
    assert.equal(
        harness.getBrowseInitializations(),
        0,
        'visibility resume must not run the cold Browse initializer'
    );
    assert.deepEqual(
        clone(harness.sandbox.getBrowseFilterState()),
        { category: 'P4', type: 'listening' }
    );
    assert.deepEqual(
        clone(harness.app.state.ui.browseFilter),
        { category: 'P4', type: 'listening' }
    );
    assert.equal(harness.sandbox.getBrowseFilterMutationRevision(), 2);
    assert.equal(harness.sandbox.__browseFilterMode, 'frequency-p4');
    assert.equal(harness.sandbox.__browsePath, 'ListeningPractice/100 P4/P4 高频(52)/Ocean');
    assert.equal(harness.sandbox.__browseFrequencyFilter, 'high');
    assert.equal(harness.sandbox.__browseSortMode, 'frequency-desc');
    assert.equal(harness.sandbox.browseController.currentMode, 'frequency-p4');
    assert.equal(harness.sandbox.browseController.activeFilter, 'high');
    assert.equal(harness.sandbox.browseStateManager.currentFilter, 'P4');
    assert.equal(harness.sandbox.browseStateManager.state.currentFrequency, 'high');
    assert.equal(harness.searchInput.value, 'ocean');
    assert.equal(harness.typeButtons[2].ariaPressed, 'true');
    assert.equal(harness.frequencyButtons[0].ariaPressed, 'true');
    assert.deepEqual(harness.durableBrowse.lastFilter, { category: 'P4', type: 'listening' });
    assert.deepEqual(harness.durableBrowse.filter, { category: 'all', type: 'all' });
    assert.deepEqual(harness.progressSyncCalls, [{
        trigger: 'visibility-resume',
        options: {},
        argumentCount: 1
    }]);
    assert.deepEqual(harness.renderedIds, [['selected-ocean']]);
});

test('visibility resume preserves an explicit empty Browse query', async () => {
    const harness = await createHarness();
    applyLatestBrowseIntent(harness, '');
    await harness.sandbox.flushBrowsePreferenceWrites();

    const refresh = harness.app.refreshData();
    harness.statsGate.resolve();
    await refresh;

    assert.equal(harness.searchInput.value, '');
    assert.equal(harness.sandbox.browseStateManager.state.searchQuery, '');
    assert.equal(harness.sandbox.__browseFilterMode, 'frequency-p4');
    assert.equal(harness.sandbox.__browsePath, 'ListeningPractice/100 P4/P4 高频(52)/Ocean');
    assert.equal(harness.sandbox.__browseFrequencyFilter, 'high');
    assert.deepEqual(
        clone(harness.sandbox.getBrowseFilterState()),
        { category: 'P4', type: 'listening' }
    );
    assert.deepEqual(harness.progressSyncCalls, [{
        trigger: 'visibility-resume',
        options: {},
        argumentCount: 1
    }]);
    assert.deepEqual(
        harness.renderedIds,
        [['selected-ocean', 'wrong-query']],
        'an empty query must retain every result in the selected path and frequency scope'
    );
});

test('visibility resume fallback sync omits hidden-Practice force-render options', async () => {
    const harness = await createHarness();
    const fallbackSyncCalls = [];
    delete harness.sandbox.ensurePracticeRecordsSync;
    harness.sandbox.syncPracticeRecords = async (...syncArgs) => {
        fallbackSyncCalls.push(syncArgs);
        return [];
    };

    const refresh = harness.app.refreshData();
    harness.statsGate.resolve();
    await refresh;

    assert.deepEqual(
        fallbackSyncCalls,
        [[]],
        'the fallback visibility refresh must not force the hidden Practice UI to render'
    );
});

test('visibilitychange uses the state-neutral refresh path after initialization', async () => {
    const harness = await createHarness();
    applyLatestBrowseIntent(harness);
    await harness.sandbox.flushBrowsePreferenceWrites();
    harness.app.isInitialized = true;
    harness.app.setupEventListeners();
    harness.statsGate.resolve();

    const handlers = harness.documentListeners.get('visibilitychange') || [];
    assert.equal(handlers.length, 2);
    handlers.at(-1)();
    await flushMicrotasks(16);

    assert.equal(harness.getResumePreferenceReads(), 0);
    assert.equal(harness.getBrowseInitializations(), 0);
    assert.deepEqual(harness.renderedIds, [['selected-ocean']]);
    assert.deepEqual(
        clone(harness.sandbox.getBrowseFilterState()),
        { category: 'P4', type: 'listening' }
    );
});
