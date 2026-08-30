#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function waitForCondition(predicate, message, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(message || 'timed out waiting for condition');
}

function createClassList() {
    const values = new Set();
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

const typeButtons = ['all', 'reading', 'listening'].map((type) => ({
    dataset: { filterType: type, filterId: type },
    classList: createClassList(),
    ariaPressed: 'false',
    setAttribute(name, value) {
        if (name === 'aria-pressed') this.ariaPressed = value;
    }
}));
const typeButtonContainer = {
    querySelectorAll() { return typeButtons; }
};
const browseView = { id: 'browse-view', classList: createClassList() };
const overviewView = { id: 'overview-view', classList: createClassList() };
browseView.classList.add('active');
const searchInput = { value: '' };
const searchClearButton = { hidden: true };
const documentStub = {
    readyState: 'loading',
    body: { appendChild() {}, classList: createClassList() },
    documentElement: { classList: createClassList() },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
        if (selector === '.search-input') return searchInput;
        if (selector === '.view.active') {
            return [browseView, overviewView].find((view) => view.classList.contains('active')) || null;
        }
        return null;
    },
    querySelectorAll(selector) {
        if (selector === '.view.active') {
            return [browseView, overviewView].filter((view) => view.classList.contains('active'));
        }
        return [];
    },
    createElement() { return { style: {}, classList: createClassList(), appendChild() {}, setAttribute() {} }; },
    getElementById(id) {
        if (id === 'type-filter-buttons') return typeButtonContainer;
        if (id === 'browse-view') return browseView;
        if (id === 'overview-view') return overviewView;
        if (id === 'exam-search-input') return searchInput;
        if (id === 'search-clear-btn') return searchClearButton;
        return null;
    }
};

const rendered = [];
const dispatchedWindowEvents = [];
const browseState = { category: 'all', type: 'all' };
const resolverQueue = [];
const persistedBrowseState = {
    lastFilter: null,
    filter: { category: 'all', type: 'all' },
    frequencyFilter: 'all'
};
const quietConsole = { log() {}, warn() {}, error() {} };
const sandbox = {
    console: quietConsole,
    document: documentStub,
    location: { href: 'https://example.test/index.html', search: '', origin: 'https://example.test', protocol: 'https:' },
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
        constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame(callback) { return setTimeout(callback, 0); },
    cancelAnimationFrame: clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) { dispatchedWindowEvents.push(event); },
    confirm() { return false; },
    alert() {},
    setBrowseFilterState(category, type) {
        browseState.category = category;
        browseState.type = type;
    },
    getCurrentCategory() { return browseState.category; },
    getCurrentExamType() { return browseState.type; },
    setBrowseTitle() {},
    formatBrowseTitle(category, type) { return `${category}:${type}`; },
    normalizeExamType(type) { return type || 'all'; },
    getPersistedBrowseFilter() { return null; },
    saveBrowseViewPreferences(partial = {}) {
        if (Object.prototype.hasOwnProperty.call(partial, 'lastFilter')) {
            persistedBrowseState.lastFilter = partial.lastFilter
                ? { ...partial.lastFilter }
                : null;
        }
        return { lastFilter: persistedBrowseState.lastFilter };
    },
    async flushBrowsePreferenceWrites() {
        return { lastFilter: persistedBrowseState.lastFilter };
    },
    async resolveActiveLibraryIndex() {
        const next = resolverQueue.shift();
        if (!next) throw new Error('unexpected index resolution');
        return next.promise;
    },
    prepareBrowseCompletionIndex(records) {
        return { records: Array.from(records || []) };
    },
    isPreparedBrowseCompletionIndex(prepared) {
        return !!prepared;
    },
    commitBrowseCompletionIndex() {
        return true;
    },
    prepareBrowseAnchorUpdates(records, index) {
        return { records: Array.from(records || []), index: Array.from(index || []) };
    },
    commitBrowseAnchorUpdates() {
        return true;
    },
    browseController: {
        currentMode: 'default',
        buttonContainer: typeButtonContainer,
        currentCategory: 'all',
        currentExamType: 'all',
        setBrowseFilterState(category, type) {
            browseState.category = category;
            browseState.type = type;
        },
        getCurrentCategory() { return browseState.category; },
        getCurrentExamType() { return browseState.type; },
        updateBrowseTitle() {}
    },
    ExamActions: {
        loadExamList(exams, options = {}) {
            rendered.push(Array.from(exams, (exam) => exam.id));
            sandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
            return exams;
        },
        displayExams(exams, options = {}) {
            rendered.push(Array.from(exams, (exam) => exam.id));
            sandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
            return true;
        }
    },
    AppData: {
        ready: Promise.resolve(),
        preferences: {
            async getBrowse() { return JSON.parse(JSON.stringify(persistedBrowseState)); },
            async setBrowse(value) {
                Object.assign(persistedBrowseState, JSON.parse(JSON.stringify(value || {})));
                return value;
            },
            async patchBrowse(value) {
                Object.assign(persistedBrowseState, JSON.parse(JSON.stringify(value || {})));
                return value;
            }
        },
        practice: {
            async list() { return []; },
            async listInsights() { return []; },
            async getStats() { return {}; }
        },
        library: {
            async getActive() { return null; },
            async listConfigurations() { return []; }
        }
    }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext(source, context, { filename: 'js/main.js' });

let hydrationNavigationGeneration = 0;
sandbox.__getAppNavigationIntentGeneration = () => hydrationNavigationGeneration;
const cancelledApplyIndex = deferred();
resolverQueue.push(cancelledApplyIndex);
const cancelledApply = sandbox.applyBrowseFilter(
    'P3',
    'listening',
    null,
    null,
    null,
    hydrationNavigationGeneration
);
hydrationNavigationGeneration += 1;
browseView.classList.remove('active');
overviewView.classList.add('active');
cancelledApplyIndex.resolve([
    { id: 'cancelled-listening', title: 'Cancelled Listening', category: 'P3', type: 'listening' }
]);
assert.strictEqual(await cancelledApply, false, 'a navigation-cancelled explicit filter must stand down');

browseView.classList.add('active');
overviewView.classList.remove('active');
const cancelledTypeIndex = deferred();
const firstHydrationIndex = deferred();
const latestHydrationIndex = deferred();
const initialPersistedFilterReader = sandbox.getPersistedBrowseFilter;
let initialPersistedFilterReads = 0;
sandbox.getPersistedBrowseFilter = () => {
    initialPersistedFilterReads += 1;
    return { category: 'P2', type: 'reading' };
};
resolverQueue.push(cancelledTypeIndex, firstHydrationIndex, latestHydrationIndex);
const cancelledType = sandbox.filterByType('listening');
const firstHydration = sandbox.initializeBrowseView({ skipLoad: true });
const latestHydration = sandbox.initializeBrowseView({ skipLoad: true });
latestHydrationIndex.resolve([
    { id: 'hydrated-reading', title: 'Hydrated Reading', category: 'P2', type: 'reading' }
]);
await latestHydration;
assert.deepStrictEqual(browseState, { category: 'P2', type: 'reading' });
assert.strictEqual(initialPersistedFilterReads, 1, 'the latest successful initialization must hydrate once');
firstHydrationIndex.resolve([
    { id: 'stale-reading', title: 'Stale Reading', category: 'P1', type: 'reading' }
]);
assert.strictEqual(await firstHydration, null, 'the superseded initialization must stand down');
assert.strictEqual(initialPersistedFilterReads, 1, 'a stale initialization must not hydrate a second time');
cancelledTypeIndex.resolve([
    { id: 'late-listening', title: 'Late Listening', category: 'P1', type: 'listening' }
]);
await cancelledType;
assert.deepStrictEqual(
    browseState,
    { category: 'P2', type: 'reading' },
    'a superseded first explicit type intent must not suppress or replace persisted hydration'
);
assert.strictEqual(initialPersistedFilterReads, 1);
sandbox.getPersistedBrowseFilter = initialPersistedFilterReader;

const searchFirst = deferred();
const searchSecond = deferred();
resolverQueue.push(searchFirst, searchSecond);
sandbox.searchExams('tea');
sandbox.searchExams('zzzz-no-match');
searchSecond.resolve([{ id: 'latest', title: 'Latest', type: 'reading', category: 'P1', searchText: 'latest' }]);
await new Promise((resolve) => setTimeout(resolve, 0));
searchFirst.resolve([{ id: 'stale', title: 'Tea', type: 'reading', category: 'P1', searchText: 'tea' }]);
await new Promise((resolve) => setTimeout(resolve, 0));

assert.deepStrictEqual(rendered, [[]], '较早完成的搜索不得覆盖较新的查询结果');

rendered.length = 0;
const filterFirst = deferred();
const filterSecond = deferred();
resolverQueue.push(filterFirst, filterSecond);
const staleFilter = sandbox.filterByType('reading');
const latestFilter = sandbox.filterByType('all');
const latestFilterRequestId = sandbox.__getBrowseResultsRequestId();
dispatchedWindowEvents.length = 0;
assert.strictEqual(
    sandbox.__isBrowseUserResultsRequestInFlight(latestFilterRequestId),
    true,
    'a hot type filter must own its request while the active index is unresolved'
);
const allExams = [
    {
        id: 'reading',
        title: 'Reading',
        type: 'reading',
        category: 'P1',
        path: 'ReadingPractice/P1/reading.html',
        frequency: 'high'
    },
    {
        id: 'listening',
        title: 'Listening',
        type: 'listening',
        category: 'P1',
        path: 'ListeningPractice/P1/listening.html',
        frequency: 'low'
    }
];
filterSecond.resolve(allExams);
await latestFilter;
assert.strictEqual(sandbox.__isBrowseUserResultsRequestInFlight(latestFilterRequestId), false);
assert.ok(
    dispatchedWindowEvents.some((event) => event.type === 'browseUserResultsRequestSettled'
        && event.detail.requestId === latestFilterRequestId),
    'the final retain release must dispatch the production settlement notification'
);
filterFirst.resolve(allExams);
await staleFilter;

assert.strictEqual(browseState.type, 'all', '较早的筛选解析完成后不得回写筛选状态');
assert.deepStrictEqual(rendered.at(-1), ['reading', 'listening'], '最终列表应对应最后一次筛选');
assert.strictEqual(typeButtons.find((button) => button.dataset.filterType === 'all').ariaPressed, 'true');
assert.strictEqual(typeButtons.find((button) => button.dataset.filterType === 'reading').ariaPressed, 'false');

rendered.length = 0;
const sharedPendingFilterIndex = deferred();
resolverQueue.push(sharedPendingFilterIndex);
const sharedPendingFilterRequestId = sandbox.__beginBrowseResultsRequest();
const sharedPendingFilter = sandbox.applyBrowseFilter(
    'P1',
    'reading',
    null,
    null,
    sharedPendingFilterRequestId
);
assert.strictEqual(
    sandbox.__isBrowseUserResultsRequestInFlight(sharedPendingFilterRequestId),
    true,
    'a caller-supplied user request must be retained during filter resolution'
);
assert.strictEqual(
    sandbox.__getBrowseResultsRequestId(),
    sharedPendingFilterRequestId,
    'a synchronized pending filter must reuse the initialization request token'
);
sharedPendingFilterIndex.resolve(allExams);
await sharedPendingFilter;
assert.strictEqual(sandbox.__isBrowseUserResultsRequestInFlight(sharedPendingFilterRequestId), false);
assert.strictEqual(browseState.category, 'P1');
assert.strictEqual(browseState.type, 'reading');

rendered.length = 0;
searchInput.value = 'zzzz-no-match';
const queryAwareTypeIndex = deferred();
resolverQueue.push(queryAwareTypeIndex);
const queryAwareTypeFilter = sandbox.filterByType('reading');
queryAwareTypeIndex.resolve(allExams);
await queryAwareTypeFilter;
assert.strictEqual(searchInput.value, 'zzzz-no-match');
assert.strictEqual(browseState.category, 'all');
assert.strictEqual(browseState.type, 'reading');
assert.deepStrictEqual(rendered.at(-1), [], 'type filtering must preserve and apply the visible query');

const queryAwareCategoryIndex = deferred();
resolverQueue.push(queryAwareCategoryIndex);
const queryAwareCategoryFilter = sandbox.applyBrowseFilter('P1', 'listening');
queryAwareCategoryIndex.resolve(allExams);
await queryAwareCategoryFilter;
assert.strictEqual(searchInput.value, 'zzzz-no-match');
assert.strictEqual(browseState.category, 'P1');
assert.strictEqual(browseState.type, 'listening');
assert.deepStrictEqual(rendered.at(-1), [], 'category filtering must preserve and apply the visible query');
searchInput.value = '';

rendered.length = 0;
searchInput.value = 'ocean';
const browseScopeBeforeColdProgress = { ...browseState };
sandbox.setBrowseFilterState('all', 'all');
const coldBrowseIndex = [
    { id: 'ocean', title: 'Ocean Passage', searchText: 'ocean passage', category: 'P1', type: 'reading' },
    { id: 'desert', title: 'Desert Passage', searchText: 'desert passage', category: 'P2', type: 'reading' }
];
const coldActivationIndex = deferred();
const coldProgressIndex = deferred();
resolverQueue.push(coldActivationIndex);
const coldActivation = sandbox.activateBrowseView();
resolverQueue.push(coldProgressIndex);
sandbox.updatePracticeView = () => {};
const coldProgressSync = sandbox.syncPracticeRecords({ forceRender: true });
coldProgressIndex.resolve(coldBrowseIndex);
await coldProgressSync;
const coldActivationRequestId = sandbox.__getBrowseResultsRequestId();
assert.strictEqual(
    sandbox.__isBrowseUserResultsRequestInFlight(coldActivationRequestId),
    true,
    'the first activation must retain its request while hydration is unresolved'
);
assert.deepStrictEqual(rendered, [], 'background progress must wait for the explicit activation');

coldActivationIndex.resolve(coldBrowseIndex);
await coldActivation;
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    rendered,
    [['ocean'], ['ocean']],
    'practice progress refresh must stay query-aware instead of restoring the full library'
);
searchInput.value = '';
sandbox.setBrowseFilterState(
    browseScopeBeforeColdProgress.category,
    browseScopeBeforeColdProgress.type
);

const integrationListeners = new Map();
const integrationBrowseView = { id: 'browse-view', classList: createClassList() };
const integrationOverviewView = { id: 'overview-view', classList: createClassList() };
integrationOverviewView.classList.add('active');
const integrationSearchInput = { value: '' };
const integrationDocument = {
    readyState: 'loading',
    body: { appendChild() {}, classList: createClassList() },
    documentElement: { classList: createClassList() },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
        if (selector === '.search-input') return integrationSearchInput;
        if (selector === '.view.active') {
            return [integrationBrowseView, integrationOverviewView]
                .find((view) => view.classList.contains('active')) || null;
        }
        return null;
    },
    querySelectorAll(selector) {
        if (selector === '.view.active') {
            return [integrationBrowseView, integrationOverviewView]
                .filter((view) => view.classList.contains('active'));
        }
        return [];
    },
    createElement() {
        return { style: {}, classList: createClassList(), appendChild() {}, setAttribute() {} };
    },
    getElementById(id) {
        if (id === 'browse-view') return integrationBrowseView;
        if (id === 'overview-view') return integrationOverviewView;
        if (id === 'exam-search-input') return integrationSearchInput;
        if (id === 'search-clear-btn') return { hidden: true };
        if (id === 'type-filter-buttons') return { querySelectorAll() { return []; } };
        return null;
    }
};
const integrationRenders = [];
const integrationAnchorIndexes = [];
const integrationAnchorPublicationGenerations = [];
const integrationCompletionRefreshes = [];
const integrationPracticeUpdates = [];
const integrationBrowseState = { category: 'all', type: 'all' };
const integrationIndexResolvers = [];
const integrationPracticeRecordResolvers = [];
let integrationIndexResolutionCount = 0;
let integrationPracticeListCount = 0;
let integrationCanonicalPracticeRecords = [];
const IntegrationCustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
const integrationSandbox = {
    console: quietConsole,
    document: integrationDocument,
    location: { href: 'https://example.test/index.html', search: '', origin: 'https://example.test', protocol: 'https:' },
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
    CustomEvent: IntegrationCustomEvent,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame(callback) { return setTimeout(callback, 0); },
    cancelAnimationFrame: clearTimeout,
    addEventListener(type, listener) {
        const listeners = integrationListeners.get(type) || [];
        listeners.push(listener);
        integrationListeners.set(type, listeners);
    },
    removeEventListener() {},
    dispatchEvent(event) {
        (integrationListeners.get(event.type) || []).slice().forEach((listener) => listener(event));
        return true;
    },
    confirm() { return false; },
    alert() {},
    showMessage() {},
    setBrowseFilterState(category, type) {
        integrationBrowseState.category = category;
        integrationBrowseState.type = type;
    },
    getCurrentCategory() { return integrationBrowseState.category; },
    getCurrentExamType() { return integrationBrowseState.type; },
    getPersistedBrowseFilter() { return null; },
    setBrowseTitle() {},
    formatBrowseTitle(category, type) { return `${category}:${type}`; },
    normalizeExamType(type) { return type || 'all'; },
    async resolveActiveLibraryIndex() {
        integrationIndexResolutionCount += 1;
        const next = integrationIndexResolvers.shift();
        return next ? next.promise : [];
    },
    updateBrowseAnchorsFromRecords(records, index) {
        integrationAnchorIndexes.push(Array.from(index || [], (exam) => exam.id));
    },
    rebuildBrowseCompletionIndex(records) {
        integrationCompletionRefreshes.push(
            Array.isArray(records) ? Array.from(records, (record) => record && record.id) : null
        );
    },
    prepareBrowseCompletionIndex(records) {
        return {
            records: Array.isArray(records)
                ? Array.from(records, (record) => record && record.id)
                : null
        };
    },
    isPreparedBrowseCompletionIndex(prepared) {
        return !!prepared;
    },
    commitBrowseCompletionIndex(prepared) {
        integrationCompletionRefreshes.push(prepared.records);
        return true;
    },
    prepareBrowseAnchorUpdates(records, index) {
        return {
            index: Array.from(index || [], (exam) => exam.id)
        };
    },
    commitBrowseAnchorUpdates(prepared, publication = null) {
        integrationAnchorIndexes.push(prepared.index);
        integrationAnchorPublicationGenerations.push(
            publication && publication.practiceProjectionGeneration
        );
        return true;
    },
    browseController: {
        currentMode: 'default',
        buttonContainer: {},
        currentCategory: 'all',
        currentExamType: 'all',
        getCurrentCategory() { return integrationBrowseState.category; },
        getCurrentExamType() { return integrationBrowseState.type; },
        updateBrowseTitle() {}
    },
    ExamActions: {
        setBrowseFrequencyFilter(value) {
            integrationSandbox.__browseFrequencyFilter = value;
            return value;
        },
        loadExamList(exams, options = {}) {
            integrationRenders.push(Array.from(exams, (exam) => exam.id));
            integrationSandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
            return exams;
        },
        displayExams(exams, options = {}) {
            integrationSandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
            return true;
        }
    },
    AppLazyLoader: {
        ensureGroup() { return Promise.resolve(true); }
    },
    AppData: {
        ready: Promise.resolve(),
        preferences: {
            async getBrowse() { return { lastFilter: null, frequencyFilter: 'all' }; },
            async patchBrowse(value) { return value; },
            async setBrowse(value) { return value; }
        },
        practice: {
            async list() {
                integrationPracticeListCount += 1;
                const next = integrationPracticeRecordResolvers.shift();
                return next
                    ? next.promise
                    : integrationCanonicalPracticeRecords.map((record) => ({ ...record }));
            },
            async listInsights() { return []; },
            async getStats() { return {}; }
        },
        library: {
            async getActive() { return null; },
            async listConfigurations() { return []; }
        }
    }
};
integrationSandbox.window = integrationSandbox;
integrationSandbox.globalThis = integrationSandbox;
integrationSandbox.self = integrationSandbox;
const integrationContext = vm.createContext(integrationSandbox);
const mainEntrySource = fs.readFileSync(path.join(repoRoot, 'js/app/main-entry.js'), 'utf8');
vm.runInContext(mainEntrySource, integrationContext, { filename: 'js/app/main-entry.js' });
vm.runInContext(source, integrationContext, { filename: 'js/main.js' });
integrationSandbox.PracticeHistoryRenderer = {
    helpers: {
        computeRecordsSignature(records) {
            return Array.from(records || [], (record) => record && record.id).join('|');
        }
    }
};
integrationSandbox.updatePracticeView = function capturePracticeUpdate(records, index) {
    integrationPracticeUpdates.push({
        records: Array.from(records || [], (record) => record && record.id),
        index: Array.from(index || [], (exam) => exam && exam.id)
    });
};
await integrationSandbox.AppEntry.ensureBrowseGroup();
integrationOverviewView.classList.remove('active');
integrationBrowseView.classList.add('active');

assert.ok(
    !source.includes('practiceRecordsDataGeneration')
        && !source.includes('ensurePracticeRecordsCommitSubscription')
        && !source.includes('activePracticeRecordsSyncInvocations')
        && !source.includes('pendingPracticeRecordsSyncRequest'),
    'Browse reset scope must not add a generic practice-data commit scheduler contract'
);

const productionIntegrationGetBrowse = integrationSandbox.AppData.preferences.getBrowse;
const staleBrowseControlSeed = deferred();
let staleBrowseControlSeedReads = 0;
let staleBrowseControlSeedCallerCurrent = true;
integrationSandbox.AppData.preferences.getBrowse = function getStaleBrowseControlSeed() {
    staleBrowseControlSeedReads += 1;
    return staleBrowseControlSeed.promise;
};
const staleBrowseControlSeedWaiter = integrationSandbox.setupBrowseControls({
    isCurrent() { return staleBrowseControlSeedCallerCurrent; }
});
await waitForCondition(
    () => staleBrowseControlSeedReads === 1,
    'the first Browse-controls waiter must enter the shared persisted seed read'
);
const currentBrowseControlSeedWaiter = integrationSandbox.setupBrowseControls({
    isCurrent() { return true; }
});
const liveFrequencyIndex = deferred();
integrationIndexResolvers.push(liveFrequencyIndex);
integrationSandbox.filterByFrequency('high');
liveFrequencyIndex.resolve([{ id: 'live-frequency-high', frequency: 7 }]);
staleBrowseControlSeedCallerCurrent = false;
staleBrowseControlSeed.resolve({ sortMode: 'default', frequencyFilter: 'all' });
assert.strictEqual(await staleBrowseControlSeedWaiter, false);
assert.strictEqual(await currentBrowseControlSeedWaiter, true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.strictEqual(
    staleBrowseControlSeedReads,
    1,
    'a stale waiter must not discard and reread the shared controls seed for a current waiter'
);
assert.strictEqual(
    integrationSandbox.__browseFrequencyFilter,
    'high',
    'a live high-frequency intent during seed hydration must beat the older persisted all value'
);
integrationSandbox.AppData.preferences.getBrowse = productionIntegrationGetBrowse;
integrationRenders.length = 0;

const oldProgressIndex = deferred();
integrationIndexResolvers.push(oldProgressIndex);
const arbitrationUserRequest = integrationSandbox.__beginBrowseUserResultsRequest();
await integrationSandbox.__renderBrowseResultsForState(
    [{ id: 'user-current' }],
    arbitrationUserRequest
);
const oldProgressSync = integrationSandbox.syncPracticeRecords({ forceRender: true });
integrationSandbox.dispatchEvent(new IntegrationCustomEvent('examIndexLoaded', {
    detail: { index: [{ id: 'index-fresh' }] }
}));
oldProgressIndex.resolve([{ id: 'progress-old' }]);
await oldProgressSync;
integrationSandbox.__endBrowseUserResultsRequest(arbitrationUserRequest);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [['user-current'], ['index-fresh']],
    'a fresher authoritative index publication must beat an older progress resolver at settlement'
);
assert.strictEqual(
    integrationSandbox.__getBrowseResultsRequestId(),
    arbitrationUserRequest + 1,
    'discarding stale progress must not consume an extra results token'
);

integrationRenders.length = 0;
const laterProgressUserRequest = integrationSandbox.__beginBrowseUserResultsRequest();
integrationSandbox.dispatchEvent(new IntegrationCustomEvent('examIndexLoaded', {
    detail: { index: [{ id: 'index-older-than-progress' }] }
}));
integrationSandbox.refreshBrowseProgressFromRecords([], [{ id: 'progress-newest' }]);
integrationSandbox.__endBrowseUserResultsRequest(laterProgressUserRequest);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [['progress-newest']],
    'a progress snapshot received after an index publication must remain the latest background render'
);
assert.strictEqual(
    integrationSandbox.__getBrowseResultsRequestId(),
    laterProgressUserRequest + 1,
    'the later progress render must claim exactly one results token'
);

integrationRenders.length = 0;
const abaUserRequest = integrationSandbox.__beginBrowseUserResultsRequest();
integrationSandbox.refreshBrowseProgressFromRecords([], [{ id: 'aba-progress-old' }]);
integrationSandbox.__markAppNavigationIntent();
integrationBrowseView.classList.remove('active');
integrationOverviewView.classList.add('active');
integrationSandbox.__markAppNavigationIntent();
integrationOverviewView.classList.remove('active');
integrationBrowseView.classList.add('active');
const abaCurrentRequest = integrationSandbox.__beginBrowseUserResultsRequest();
await integrationSandbox.__renderBrowseResultsForState(
    [{ id: 'aba-current' }],
    abaCurrentRequest
);
integrationSandbox.__endBrowseUserResultsRequest(abaCurrentRequest);
integrationSandbox.__endBrowseUserResultsRequest(abaUserRequest);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [['aba-current']],
    'a queued progress snapshot must not survive a Browse navigation ABA epoch'
);
assert.strictEqual(
    integrationSandbox.__getBrowseResultsRequestId(),
    abaCurrentRequest,
    'discarding an ABA progress snapshot must preserve the new activation token'
);

integrationRenders.length = 0;
const libraryEpochUserRequest = integrationSandbox.__beginBrowseUserResultsRequest();
integrationSandbox.refreshBrowseProgressFromRecords([], [{ id: 'library-progress-old' }]);
integrationBrowseView.classList.remove('active');
integrationOverviewView.classList.add('active');
integrationSandbox.dispatchEvent(new IntegrationCustomEvent('examIndexLoaded', {
    detail: { index: [{ id: 'library-publication' }] }
}));
integrationOverviewView.classList.remove('active');
integrationBrowseView.classList.add('active');
integrationSandbox.__endBrowseUserResultsRequest(libraryEpochUserRequest);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [],
    'an authoritative index publication must invalidate queued progress even without a navigation epoch change'
);

integrationRenders.length = 0;
const resetEpochUserRequest = integrationSandbox.__beginBrowseUserResultsRequest();
integrationSandbox.refreshBrowseProgressFromRecords([], [{ id: 'pre-reset-progress' }]);
const resetEpochIntent = integrationSandbox.__beginBrowseResetIntent();
integrationSandbox.__endBrowseResetIntent(resetEpochIntent);
integrationSandbox.__endBrowseUserResultsRequest(resetEpochUserRequest);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [],
    'a progress snapshot captured before a reset must not repaint after the reset epoch closes'
);

integrationRenders.length = 0;
integrationAnchorIndexes.length = 0;
integrationCompletionRefreshes.length = 0;
integrationPracticeUpdates.length = 0;
const successfulProjectionRecords = deferred();
const successfulProjectionIndex = deferred();
const failedNewerProjectionRecords = deferred();
const failedNewerProjectionIndex = deferred();
integrationPracticeRecordResolvers.push(
    successfulProjectionRecords,
    failedNewerProjectionRecords
);
integrationIndexResolvers.push(successfulProjectionIndex, failedNewerProjectionIndex);
const projectionUserRequest = integrationSandbox.__beginBrowseUserResultsRequest();
const successfulProjection = integrationSandbox.syncPracticeRecords({ forceRender: true });
successfulProjectionRecords.resolve([{ id: 'successful-projection-record' }]);
successfulProjectionIndex.resolve([{ id: 'successful-projection-index' }]);
assert.deepStrictEqual(
    Array.from(await successfulProjection, (record) => record.id),
    ['successful-projection-record']
);
const failedNewerProjection = integrationSandbox.syncPracticeRecords({ forceRender: true });
failedNewerProjectionRecords.resolve([{ id: 'failed-newer-projection-record' }]);
failedNewerProjectionIndex.reject(new Error('newer projection read failed'));
await assert.rejects(failedNewerProjection, /newer projection read failed/);
integrationSandbox.__endBrowseUserResultsRequest(projectionUserRequest);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationCompletionRefreshes,
    [['successful-projection-record']],
    'a failed newer sync must not invalidate an already successful completion projection'
);
assert.deepStrictEqual(
    integrationAnchorIndexes,
    [['successful-projection-index']],
    'a failed newer sync must not invalidate the successful Browse anchor projection'
);
assert.deepStrictEqual(
    integrationPracticeUpdates,
    [{
        records: ['successful-projection-record'],
        index: ['successful-projection-index']
    }],
    'the successful direct sync must keep the baseline Practice commit contract'
);
assert.deepStrictEqual(
    integrationRenders,
    [['successful-projection-index']],
    'the successful queued Browse projection must render after the foreground request settles'
);

for (const failurePoint of [
    'prepareBrowseCompletionIndex',
    'prepareBrowseAnchorUpdates',
    'commitBrowseAnchorUpdates'
]) {
    integrationRenders.length = 0;
    integrationAnchorIndexes.length = 0;
    integrationAnchorPublicationGenerations.length = 0;
    integrationCompletionRefreshes.length = 0;
    integrationPracticeUpdates.length = 0;
    const acceptedRecordId = `accepted-${failurePoint}-record`;
    const acceptedIndexId = `accepted-${failurePoint}-index`;
    const rejectedRecordId = `rejected-${failurePoint}-record`;
    const rejectedIndexId = `rejected-${failurePoint}-index`;
    const acceptedPublicationRecords = deferred();
    const acceptedPublicationIndex = deferred();
    const rejectedPublicationRecords = deferred();
    const rejectedPublicationIndex = deferred();
    integrationPracticeRecordResolvers.push(
        acceptedPublicationRecords,
        rejectedPublicationRecords
    );
    integrationIndexResolvers.push(acceptedPublicationIndex, rejectedPublicationIndex);
    const publicationUserRequest = integrationSandbox.__beginBrowseUserResultsRequest();
    const acceptedPublication = integrationSandbox.syncPracticeRecords({ forceRender: true });
    acceptedPublicationRecords.resolve([{ id: acceptedRecordId }]);
    acceptedPublicationIndex.resolve([{ id: acceptedIndexId }]);
    assert.deepStrictEqual(
        Array.from(await acceptedPublication, (record) => record.id),
        [acceptedRecordId]
    );
    const productionPublicationStage = integrationSandbox[failurePoint];
    integrationSandbox[failurePoint] = function rejectProjectionPublication() {
        throw new Error(`newer projection ${failurePoint} failed`);
    };
    const rejectedPublication = integrationSandbox.syncPracticeRecords({ forceRender: true });
    rejectedPublicationRecords.resolve([{ id: rejectedRecordId }]);
    rejectedPublicationIndex.resolve([{ id: rejectedIndexId }]);
    assert.deepStrictEqual(
        Array.from(await rejectedPublication, (record) => record.id),
        [rejectedRecordId],
        'Browse publication failure must not change the baseline Practice sync result'
    );
    integrationSandbox[failurePoint] = productionPublicationStage;
    integrationSandbox.__endBrowseUserResultsRequest(publicationUserRequest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(
        integrationCompletionRefreshes,
        [[acceptedRecordId]],
        `${failurePoint} failure must preserve the accepted completion projection`
    );
    assert.deepStrictEqual(
        integrationAnchorIndexes,
        [[acceptedIndexId]],
        `${failurePoint} failure must preserve the accepted anchor projection`
    );
    assert.strictEqual(
        integrationAnchorPublicationGenerations.length,
        1,
        `${failurePoint} failure must not publish a generation for rejected B anchors`
    );
    assert.ok(
        Number.isFinite(integrationAnchorPublicationGenerations[0]),
        'the accepted anchor projection must receive the Practice publication generation'
    );
    assert.deepStrictEqual(
        integrationPracticeUpdates,
        [
            { records: [acceptedRecordId], index: [acceptedIndexId] },
            { records: [rejectedRecordId], index: [rejectedIndexId] }
        ],
        'Browse publication rejection must not suppress either Practice update'
    );
    assert.deepStrictEqual(
        integrationRenders,
        [[acceptedIndexId]],
        `${failurePoint} failure must not invalidate the accepted queued repaint`
    );
}

const identicalHeadIndex = deferred();
const redundantTailPoison = {
    get promise() {
        return Promise.reject(new Error('an identical join must not start a redundant tail'));
    }
};
integrationIndexResolvers.push(identicalHeadIndex, redundantTailPoison);
const identicalResolutionCountBefore = integrationIndexResolutionCount;
const identicalHeadCycle = integrationSandbox.ensurePracticeRecordsSync(
    'practice-view',
    { forceRender: true }
);
const identicalJoinCycle = integrationSandbox.ensurePracticeRecordsSync(
    'practice-view',
    { forceRender: true }
);
const sameEpochAliasCycle = integrationSandbox.ensurePracticeRecordsSync(
    'exam-index-loaded',
    { forceRender: true }
);
assert.strictEqual(identicalJoinCycle, identicalHeadCycle);
assert.strictEqual(sameEpochAliasCycle, identicalHeadCycle);
identicalHeadIndex.resolve([{ id: 'identical-head' }]);
await identicalHeadCycle;
assert.strictEqual(
    integrationIndexResolutionCount,
    identicalResolutionCountBefore + 1,
    'identical and trigger-alias joins in the same epoch must share one physical read'
);
assert.strictEqual(
    integrationIndexResolvers.shift(),
    redundantTailPoison,
    'a head success must not be overturned by an invented failing tail'
);

integrationRenders.length = 0;
integrationAnchorIndexes.length = 0;
integrationCompletionRefreshes.length = 0;
integrationPracticeUpdates.length = 0;
integrationBrowseState.category = 'P4';
integrationBrowseState.type = 'listening';
integrationSearchInput.value = '';
integrationSandbox.__browseFilterMode = 'frequency-p4';
integrationSandbox.__browsePath = 'ListeningPractice/100 P4/P4 高频(52)';
integrationSandbox.__browseFrequencyFilter = 'high';
integrationSandbox.__browseSortMode = 'frequency-desc';
integrationSandbox.browseController.currentMode = 'frequency-p4';
integrationSandbox.browseController.currentCategory = 'P4';
integrationSandbox.browseController.currentExamType = 'listening';
const completionResumeScope = {
    filter: { ...integrationBrowseState },
    query: integrationSearchInput.value,
    mode: integrationSandbox.__browseFilterMode,
    path: integrationSandbox.__browsePath,
    frequency: integrationSandbox.__browseFrequencyFilter,
    sort: integrationSandbox.__browseSortMode,
    controllerMode: integrationSandbox.browseController.currentMode,
    controllerCategory: integrationSandbox.browseController.currentCategory,
    controllerType: integrationSandbox.browseController.currentExamType
};
const visibilityResumeIndex = deferred();
const postCommitIndex = deferred();
const visibilityIndexSnapshot = [{
    id: 'p4-high-current',
    title: 'Current P4 listening exam',
    category: 'P4',
    type: 'listening',
    path: 'ListeningPractice/100 P4/P4 高频(52)',
    frequency: 'high'
}];
integrationIndexResolvers.push(visibilityResumeIndex, postCommitIndex);
integrationCanonicalPracticeRecords = [{ id: 'before-completion' }];
const completionResumeReadCountBefore = integrationPracticeListCount;
const visibilityResumeCycle = integrationSandbox.ensurePracticeRecordsSync(
    'visibility-resume'
);
await waitForCondition(
    () => integrationPracticeListCount === completionResumeReadCountBefore + 1,
    'visibility resume must read the pre-commit Practice snapshot'
);
await Promise.resolve();
integrationCanonicalPracticeRecords = [
    { id: 'before-completion' },
    { id: 'saved-completion' }
];
const completionSavedJoin = integrationSandbox.ensurePracticeRecordsSync(
    'completion-saved',
    { forceRender: true, requirePostCommitRead: true }
);
assert.strictEqual(
    completionSavedJoin,
    visibilityResumeCycle,
    'completion-saved must remain part of the active managed cycle'
);
visibilityResumeIndex.resolve(visibilityIndexSnapshot);
await waitForCondition(
    () => integrationPracticeListCount === completionResumeReadCountBefore + 2,
    'completion-saved must start one authoritative read after the visibility cycle'
);
postCommitIndex.resolve(visibilityIndexSnapshot);
assert.deepStrictEqual(
    Array.from(await completionSavedJoin, (record) => record.id),
    ['before-completion', 'saved-completion'],
    'the managed cycle must resolve with the post-commit Practice snapshot'
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.strictEqual(
    integrationPracticeListCount,
    completionResumeReadCountBefore + 2,
    'the save/resume ordering must perform exactly one head and one trailing read'
);
assert.deepStrictEqual(
    integrationCompletionRefreshes,
    [
        ['before-completion'],
        ['before-completion', 'saved-completion']
    ],
    'the production projection path must publish the authoritative completion state'
);
assert.deepStrictEqual(
    integrationPracticeUpdates,
    [
        { records: ['before-completion'], index: ['p4-high-current'] },
        { records: ['before-completion', 'saved-completion'], index: ['p4-high-current'] }
    ],
    'the post-commit read must reach the production Practice projection'
);
assert.deepStrictEqual(
    {
        filter: { ...integrationBrowseState },
        query: integrationSearchInput.value,
        mode: integrationSandbox.__browseFilterMode,
        path: integrationSandbox.__browsePath,
        frequency: integrationSandbox.__browseFrequencyFilter,
        sort: integrationSandbox.__browseSortMode,
        controllerMode: integrationSandbox.browseController.currentMode,
        controllerCategory: integrationSandbox.browseController.currentCategory,
        controllerType: integrationSandbox.browseController.currentExamType
    },
    completionResumeScope,
    'the post-commit tail must not rehydrate or replace the live Browse scope'
);
integrationCanonicalPracticeRecords = [];
integrationBrowseState.category = 'all';
integrationBrowseState.type = 'all';
integrationSearchInput.value = '';
integrationSandbox.__browseFilterMode = 'default';
integrationSandbox.__browsePath = null;
integrationSandbox.__browseFrequencyFilter = 'all';
integrationSandbox.__browseSortMode = 'default';
integrationSandbox.browseController.currentMode = 'default';
integrationSandbox.browseController.currentCategory = 'all';
integrationSandbox.browseController.currentExamType = 'all';

integrationRenders.length = 0;
integrationAnchorIndexes.length = 0;
integrationCompletionRefreshes.length = 0;
integrationPracticeUpdates.length = 0;
const unchangedVisibilityFirstIndex = deferred();
const unchangedVisibilitySecondIndex = deferred();
const unchangedVisibilityIndexSnapshot = [{ id: 'visibility-unchanged-index' }];
integrationIndexResolvers.push(
    unchangedVisibilityFirstIndex,
    unchangedVisibilitySecondIndex
);
integrationCanonicalPracticeRecords = [{ id: 'visibility-unchanged-record' }];
const firstUnchangedVisibilityCycle = integrationSandbox.ensurePracticeRecordsSync(
    'visibility-resume'
);
unchangedVisibilityFirstIndex.resolve(unchangedVisibilityIndexSnapshot);
await firstUnchangedVisibilityCycle;
await new Promise((resolve) => setTimeout(resolve, 0));
const secondUnchangedVisibilityCycle = integrationSandbox.ensurePracticeRecordsSync(
    'visibility-resume'
);
unchangedVisibilitySecondIndex.resolve(unchangedVisibilityIndexSnapshot);
await secondUnchangedVisibilityCycle;
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationCompletionRefreshes,
    [
        ['visibility-unchanged-record'],
        ['visibility-unchanged-record']
    ],
    'unchanged visibility records must still refresh the production Browse projection'
);
assert.deepStrictEqual(
    integrationAnchorIndexes,
    [
        ['visibility-unchanged-index'],
        ['visibility-unchanged-index']
    ],
    'unchanged visibility records must still refresh production Browse anchors'
);
assert.deepStrictEqual(
    integrationPracticeUpdates,
    [{
        records: ['visibility-unchanged-record'],
        index: ['visibility-unchanged-index']
    }],
    'the repeated visibility refresh must not rebuild the hidden Practice UI'
);
integrationCanonicalPracticeRecords = [];

integrationRenders.length = 0;
integrationAnchorIndexes.length = 0;
integrationCompletionRefreshes.length = 0;
integrationPracticeUpdates.length = 0;
const libraryARecords = deferred();
const libraryBRecords = deferred();
const libraryAIndex = deferred();
const libraryBIndex = deferred();
const redundantLibraryTailPoison = {
    get promise() {
        return Promise.reject(new Error('one library generation change must schedule only one tail'));
    }
};
integrationPracticeRecordResolvers.push(libraryARecords, libraryBRecords);
integrationIndexResolvers.push(libraryAIndex, libraryBIndex, redundantLibraryTailPoison);
const libraryTailResolutionCountBefore = integrationIndexResolutionCount;
const libraryACycle = integrationSandbox.ensurePracticeRecordsSync(
    'library-a',
    { forceRender: true }
);
integrationSandbox.dispatchEvent(new IntegrationCustomEvent('examIndexLoaded', {
    detail: { index: [{ id: 'library-b-publication' }] }
}));
const libraryBJoin = integrationSandbox.ensurePracticeRecordsSync(
    'library-b',
    { forceRender: true }
);
assert.strictEqual(
    libraryBJoin,
    libraryACycle,
    'the newer library request must join the active managed cycle'
);
libraryARecords.resolve([{ id: 'library-a-record' }]);
libraryAIndex.resolve([{ id: 'library-a-index' }]);
await waitForCondition(
    () => integrationIndexResolutionCount === libraryTailResolutionCountBefore + 2,
    'settling library A must start exactly one coalesced library B tail'
);
libraryBRecords.resolve([{ id: 'library-b-record' }]);
libraryBIndex.resolve([{ id: 'library-b-index' }]);
await libraryBJoin;
await new Promise((resolve) => setTimeout(resolve, 0));
assert.strictEqual(
    integrationIndexResolutionCount,
    libraryTailResolutionCountBefore + 2,
    'a single library change must perform one head read and one current-library tail read'
);
assert.strictEqual(
    integrationIndexResolvers.shift(),
    redundantLibraryTailPoison,
    'the current-library tail must cover the joined B request without a third read'
);
assert.deepStrictEqual(
    integrationCompletionRefreshes,
    [['library-b-record']],
    'only the current library tail may rebuild Browse completion state'
);
assert.deepStrictEqual(
    integrationAnchorIndexes,
    [['library-b-index']],
    'only the current library tail may update Browse anchors'
);
assert.deepStrictEqual(
    integrationRenders,
    [['library-b-publication'], ['library-b-index']],
    'the authoritative publication and current tail must never be followed by library A'
);

integrationRenders.length = 0;
const postNavigationProgressIndex = deferred();
integrationIndexResolvers.push(postNavigationProgressIndex);
const postNavigationProgressSync = integrationSandbox.syncPracticeRecords({ forceRender: true });
integrationSandbox.__markAppNavigationIntent();
integrationBrowseView.classList.remove('active');
integrationOverviewView.classList.add('active');
integrationSandbox.__markAppNavigationIntent();
integrationOverviewView.classList.remove('active');
integrationBrowseView.classList.add('active');
const postNavigationRequest = integrationSandbox.__beginBrowseUserResultsRequest();
await integrationSandbox.__renderBrowseResultsForState(
    [{ id: 'post-navigation-current' }],
    postNavigationRequest
);
postNavigationProgressIndex.resolve([{ id: 'post-navigation-progress' }]);
await postNavigationProgressSync;
integrationSandbox.__endBrowseUserResultsRequest(postNavigationRequest);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [['post-navigation-current'], ['post-navigation-progress']],
    'a same-library sync resolving after navigation must bind to and repaint the current Browse epoch'
);

integrationRenders.length = 0;
const postResetProgressIndex = deferred();
integrationIndexResolvers.push(postResetProgressIndex);
const postResetProgressSync = integrationSandbox.syncPracticeRecords({ forceRender: true });
const postResetIntent = integrationSandbox.__beginBrowseResetIntent();
integrationSandbox.__endBrowseResetIntent(postResetIntent);
postResetProgressIndex.resolve([{ id: 'post-reset-progress' }]);
await postResetProgressSync;
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [['post-reset-progress']],
    'a same-library sync resolving after reset must bind to and repaint the post-reset epoch'
);

const bootFallbackIntegrationSource = fs.readFileSync(
    path.join(repoRoot, 'js/boot-fallbacks.js'),
    'utf8'
);
vm.runInContext(bootFallbackIntegrationSource, integrationContext, {
    filename: 'js/boot-fallbacks.js'
});
integrationRenders.length = 0;
integrationBrowseView.classList.remove('active');
integrationOverviewView.classList.add('active');
const failedFunctionalReset = deferred();
integrationSandbox.ExamActions.browseFilterStateOwner = {
    resetForActivation() { return failedFunctionalReset.promise; },
    resetToAll() { return true; }
};
const originalIntegrationBrowseAdd = integrationBrowseView.classList.add;
let activationProgressProbe = () => {
    integrationSandbox.refreshBrowseProgressFromRecords(
        [],
        [{ id: 'functional-reset-progress-failed' }]
    );
};
integrationBrowseView.classList.add = function addWithFunctionalResetProbe(value) {
    originalIntegrationBrowseAdd.call(this, value);
    if (value === 'active' && activationProgressProbe) {
        activationProgressProbe();
    }
};
const failedFunctionalResetNavigation = integrationSandbox.showView('browse', true);
activationProgressProbe = null;
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'pending',
    'the cold functional barrier must exist before Browse becomes active'
);
assert.deepStrictEqual(integrationRenders, []);
failedFunctionalReset.resolve(false);
assert.strictEqual(await failedFunctionalResetNavigation, false);
await waitForCondition(
    () => integrationSandbox.__getBrowseFunctionalResetState().status === 'failed',
    'the failed functional reset must settle to the fail-closed state'
);
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'failed');
assert.deepStrictEqual(
    integrationRenders,
    [],
    'a progress snapshot captured during a failed functional reset must never render'
);
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'functional-reset-progress-after-failure' }]
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [],
    'a failed functional reset must remain fail-closed for later progress refreshes'
);

integrationSandbox.showView('overview', false);
const ordinaryRecoveryIndex = deferred();
integrationIndexResolvers.push(ordinaryRecoveryIndex);
const ordinaryRecoveryNavigation = integrationSandbox.showView('browse', false);
ordinaryRecoveryIndex.resolve([{ id: 'functional-reset-ordinary-recovery' }]);
assert.notStrictEqual(await ordinaryRecoveryNavigation, false);
assert.deepStrictEqual(
    integrationRenders,
    [['functional-reset-ordinary-recovery']],
    'a successful ordinary Browse activation must provide the canonical recovery render'
);
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'functional-reset-progress-after-ordinary-recovery' }]
);
await waitForCondition(
    () => integrationRenders.length === 2,
    'progress must resume after a successful ordinary Browse recovery'
);
assert.deepStrictEqual(
    integrationRenders,
    [
        ['functional-reset-ordinary-recovery'],
        ['functional-reset-progress-after-ordinary-recovery']
    ],
    'a failed functional reset must not poison progress after ordinary activation recovers'
);

integrationRenders.length = 0;
integrationSandbox.showView('overview', false);
const successfulFunctionalReset = deferred();
const successfulFunctionalResetIndex = deferred();
integrationIndexResolvers.push(successfulFunctionalResetIndex);
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation = function () {
    return successfulFunctionalReset.promise;
};
activationProgressProbe = () => {
    integrationSandbox.refreshBrowseProgressFromRecords(
        [],
        [{ id: 'functional-reset-progress-success' }]
    );
};
const successfulFunctionalResetNavigation = integrationSandbox.showView('browse', true);
activationProgressProbe = null;
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'pending');
assert.deepStrictEqual(integrationRenders, []);
successfulFunctionalReset.resolve(true);
successfulFunctionalResetIndex.resolve([{ id: 'functional-reset-canonical' }]);
assert.notStrictEqual(await successfulFunctionalResetNavigation, false);
await waitForCondition(
    () => integrationSandbox.__getBrowseFunctionalResetState().status === 'succeeded',
    'the successful functional reset must complete its canonical barrier'
);
assert.deepStrictEqual(
    integrationRenders,
    [['functional-reset-canonical']],
    'a successful functional reset must render only its canonical post-reset snapshot'
);
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'succeeded');
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'functional-reset-next-progress' }]
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [['functional-reset-canonical'], ['functional-reset-next-progress']],
    'a completed functional reset must not permanently block later progress refreshes'
);

integrationRenders.length = 0;
integrationSandbox.showView('overview', false);
const navigationAbaFunctionalReset = deferred();
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation = function () {
    return navigationAbaFunctionalReset.promise;
};
const navigationAbaFunctionalNavigation = integrationSandbox.showView('browse', true);
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'pending');
integrationSandbox.showView('overview', false);
const navigationAbaReentryIndex = deferred();
integrationIndexResolvers.push(navigationAbaReentryIndex);
const navigationAbaReentry = integrationSandbox.showView('browse', false);
navigationAbaReentryIndex.resolve([{ id: 'navigation-aba-reentry', category: 'all', type: 'reading' }]);
assert.notStrictEqual(await navigationAbaReentry, false);
integrationRenders.length = 0;
const navigationAbaFilterIndex = deferred();
integrationIndexResolvers.push(navigationAbaFilterIndex);
const navigationAbaFilter = integrationSandbox.applyBrowseFilter('P2', 'reading');
const navigationAbaPoisonIndex = {
    promise: Promise.resolve([{ id: 'navigation-aba-stale-reset' }])
};
integrationIndexResolvers.push(navigationAbaPoisonIndex);
const navigationAbaResolutionCount = integrationIndexResolutionCount;
const navigationAbaResultsToken = integrationSandbox.__getBrowseResultsRequestId();
navigationAbaFunctionalReset.resolve(true);
assert.strictEqual(
    await navigationAbaFunctionalNavigation,
    false,
    'a functional reset superseded by a navigation ABA must stand down'
);
assert.strictEqual(
    integrationIndexResolutionCount,
    navigationAbaResolutionCount,
    'the superseded functional reset must not start another index read'
);
assert.strictEqual(
    integrationSandbox.__getBrowseResultsRequestId(),
    navigationAbaResultsToken,
    'the superseded functional reset must not claim the newer filter token'
);
assert.strictEqual(
    integrationIndexResolvers.shift(),
    navigationAbaPoisonIndex,
    'the superseded functional reset must leave the poison index untouched'
);
navigationAbaFilterIndex.resolve([
    { id: 'navigation-aba-p2-reading', category: 'P2', type: 'reading' }
]);
assert.notStrictEqual(await navigationAbaFilter, false);
assert.deepStrictEqual(integrationBrowseState, { category: 'P2', type: 'reading' });
assert.deepStrictEqual(
    integrationRenders,
    [['navigation-aba-p2-reading']],
    'the newer filter must remain authoritative after the old reset settles'
);
assert.ok(
    !['pending', 'failed'].includes(integrationSandbox.__getBrowseFunctionalResetState().status),
    'a superseded functional reset must not leave a pending or failed global gate'
);

integrationRenders.length = 0;
integrationSandbox.showView('overview', false);
const midCanonicalFunctionalReset = deferred();
const midCanonicalFunctionalIndex = deferred();
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation = function () {
    return midCanonicalFunctionalReset.promise;
};
integrationIndexResolvers.push(midCanonicalFunctionalIndex);
const midCanonicalResolutionCountBefore = integrationIndexResolutionCount;
const midCanonicalFunctionalNavigation = integrationSandbox.showView('browse', true);
midCanonicalFunctionalReset.resolve(true);
await waitForCondition(
    () => integrationIndexResolutionCount === midCanonicalResolutionCountBefore + 1,
    'the functional reset canonical refresh must start before the navigation supersedes it'
);
integrationSandbox.showView('overview', false);
midCanonicalFunctionalIndex.resolve([{ id: 'mid-canonical-stale-reset' }]);
assert.strictEqual(
    await midCanonicalFunctionalNavigation,
    false,
    'navigation must cancel an already-started functional-reset canonical refresh'
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationRenders,
    [],
    'an in-flight functional canonical refresh must not render after leaving Browse'
);
assert.ok(
    !['pending', 'failed'].includes(integrationSandbox.__getBrowseFunctionalResetState().status),
    'mid-canonical navigation cancellation must release the global barrier gate'
);

integrationRenders.length = 0;
integrationBrowseView.classList.remove('active');
integrationOverviewView.classList.add('active');
const supersededFunctionalReset = deferred();
const currentFunctionalReset = deferred();
const supersededFunctionalIndex = deferred();
const currentFunctionalIndex = deferred();
const overlappingFunctionalResets = [supersededFunctionalReset, currentFunctionalReset];
integrationIndexResolvers.push(supersededFunctionalIndex, currentFunctionalIndex);
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation = function () {
    const next = overlappingFunctionalResets.shift();
    return next ? next.promise : false;
};
const supersededFunctionalNavigation = integrationSandbox.showView('browse', true);
supersededFunctionalReset.resolve(true);
const overlappingResolutionCountBefore = integrationIndexResolutionCount;
await waitForCondition(
    () => integrationIndexResolutionCount === overlappingResolutionCountBefore + 1,
    'the first overlapping functional reset must enter its canonical refresh'
);
const currentFunctionalNavigation = integrationSandbox.showView('browse', true);
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'pending');
supersededFunctionalIndex.resolve([{ id: 'superseded-functional-canonical' }]);
assert.strictEqual(
    await supersededFunctionalNavigation,
    false,
    'a newer functional barrier must invalidate an older canonical continuation'
);
assert.deepStrictEqual(integrationRenders, []);
currentFunctionalReset.resolve(true);
currentFunctionalIndex.resolve([{ id: 'current-functional-canonical' }]);
assert.notStrictEqual(await currentFunctionalNavigation, false);
assert.deepStrictEqual(
    integrationRenders,
    [['current-functional-canonical']],
    'only the newest functional reset may complete a canonical render'
);

integrationRenders.length = 0;
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation = function () {
    return false;
};
assert.strictEqual(await integrationSandbox.showView('browse', true), false);
await waitForCondition(
    () => integrationSandbox.__getBrowseFunctionalResetState().status === 'failed',
    'the second failed functional reset must settle before reset recovery begins'
);
const integrationExamActionsSource = fs.readFileSync(
    path.join(repoRoot, 'js/app/examActions.js'),
    'utf8'
);
vm.runInContext(integrationExamActionsSource, integrationContext, {
    filename: 'js/app/examActions.js'
});
const integrationProductionExamListLoader = integrationSandbox.ExamActions.loadExamList;
integrationSandbox.ExamActions.loadExamList = function captureResetRecoveryRender(exams, options = {}) {
    const snapshot = Array.isArray(exams) ? exams : [];
    integrationRenders.push(Array.from(snapshot, (exam) => exam && exam.id));
    integrationSandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
    return snapshot;
};

const productionActivationReset = integrationSandbox.ExamActions
    .browseFilterStateOwner.resetForActivation;
const productionBrowseStateManager = integrationSandbox.browseStateManager;
const productionSetBrowseFilterState = integrationSandbox.setBrowseFilterState;
const productionSaveBrowseViewPreferences = integrationSandbox.saveBrowseViewPreferences;
const productionFlushBrowsePreferenceWrites = integrationSandbox.flushBrowsePreferenceWrites;
const productionPatchBrowse = integrationSandbox.AppData.preferences.patchBrowse;
const activationManagerReady = deferred();
let activationManagerReadyObserved = false;
let staleActivationManagerResetCount = 0;
const staleActivationStateCalls = [];
const staleActivationPreferenceWrites = [];
integrationSandbox.browseStateManager = {
    ready: {
        then(resolve, reject) {
            activationManagerReadyObserved = true;
            return activationManagerReady.promise.then(resolve, reject);
        }
    },
    currentFilter: 'high',
    state: {
        currentCategory: 'P1',
        currentFrequency: 'high',
        filters: { frequency: 'high' },
        searchQuery: 'keep-current-search'
    },
    clearSearchState() {},
    resetToAllExams() { staleActivationManagerResetCount += 1; },
    async persistState() {
        staleActivationPreferenceWrites.push({ stateManager: true });
    }
};
integrationSandbox.setBrowseFilterState = function captureActivationState(category, type) {
    staleActivationStateCalls.push({ category, type });
    productionSetBrowseFilterState(category, type);
};
integrationSandbox.saveBrowseViewPreferences = function captureActivationSave(patch) {
    staleActivationPreferenceWrites.push({ save: patch });
};
integrationSandbox.flushBrowsePreferenceWrites = async function flushActivationSave() {
    return {
        lastFilter: {
            category: integrationBrowseState.category,
            type: integrationBrowseState.type
        }
    };
};
integrationSandbox.AppData.preferences.patchBrowse = async function captureActivationPatch(patch) {
    staleActivationPreferenceWrites.push({ patch });
    return patch;
};
productionSetBrowseFilterState('P1', 'listening');
integrationSandbox.__browseFilterMode = 'legacy-mode';
integrationSandbox.__browsePath = 'legacy/path';
integrationSandbox.__browseFrequencyFilter = 'high';
const staleProductionActivation = integrationSandbox.showView('browse', true);
await waitForCondition(
    () => activationManagerReadyObserved,
    'the production activation reset must enter its awaited manager preparation'
);
integrationSandbox.showView('overview', false);
const activationReentryIndex = deferred();
integrationIndexResolvers.push(activationReentryIndex);
const activationReentry = integrationSandbox.showView('browse', false);
activationReentryIndex.resolve([
    { id: 'activation-reentry-reading', category: 'P1', type: 'reading' }
]);
assert.notStrictEqual(await activationReentry, false);
integrationRenders.length = 0;
const activationNewerFilterIndex = deferred();
integrationIndexResolvers.push(activationNewerFilterIndex);
const activationNewerFilter = integrationSandbox.applyBrowseFilter(
    'P2',
    'reading',
    'frequency',
    'newer/path'
);
activationNewerFilterIndex.resolve([
    { id: 'activation-newer-reading', category: 'P2', type: 'reading' },
    { id: 'activation-listening-capability', category: 'P2', type: 'listening' }
]);
assert.notStrictEqual(await activationNewerFilter, false);
activationManagerReady.resolve();
assert.strictEqual(
    await staleProductionActivation,
    false,
    'a real activation reset canceled during manager preparation must stand down'
);
assert.deepStrictEqual(integrationBrowseState, { category: 'P2', type: 'reading' });
assert.strictEqual(integrationSandbox.__browseFilterMode, 'frequency');
assert.strictEqual(integrationSandbox.__browsePath, 'newer/path');
assert.strictEqual(integrationSandbox.__browseFrequencyFilter, 'high');
assert.strictEqual(staleActivationManagerResetCount, 0);
assert.deepStrictEqual(
    staleActivationStateCalls.filter((call) => call.category === 'all' && call.type === 'all'),
    [],
    'the canceled production reset must not apply all/all over the newer filter'
);
assert.deepStrictEqual(
    staleActivationPreferenceWrites,
    [],
    'the canceled production reset must not persist any all/all state'
);
integrationSandbox.browseStateManager = productionBrowseStateManager;
integrationSandbox.setBrowseFilterState = productionSetBrowseFilterState;
integrationSandbox.saveBrowseViewPreferences = productionSaveBrowseViewPreferences;
integrationSandbox.flushBrowsePreferenceWrites = productionFlushBrowsePreferenceWrites;
integrationSandbox.AppData.preferences.patchBrowse = productionPatchBrowse;

integrationRenders.length = 0;
const warmFunctionalManagerReady = deferred();
const warmFunctionalCanonicalIndex = deferred();
const warmFunctionalLatestIndex = [
    { id: 'warm-functional-latest-p2', category: 'P2', type: 'reading' },
    { id: 'warm-functional-latest-listening', category: 'all', type: 'listening' }
];
const warmFunctionalPersistedBrowse = {
    lastFilter: { category: 'P2', type: 'reading' },
    filter: { category: 'P2', type: 'reading' },
    frequencyFilter: 'high',
    stateManager: null
};
const warmFunctionalOriginalGetBrowse = integrationSandbox.AppData.preferences.getBrowse;
let warmFunctionalManagerReadyObserved = false;
integrationSandbox.browseStateManager = {
    ready: {
        then(resolve, reject) {
            warmFunctionalManagerReadyObserved = true;
            return warmFunctionalManagerReady.promise.then(resolve, reject);
        }
    },
    currentFilter: 'P2',
    state: {
        currentCategory: 'P2',
        currentFrequency: 'high',
        filters: { frequency: 'high' },
        searchQuery: 'warm-reset-search'
    },
    clearSearchState() {
        this.state.searchQuery = '';
    },
    resetToAllExams() {
        this.currentFilter = 'all';
        this.state.currentCategory = null;
        this.state.currentFrequency = null;
        this.state.filters.frequency = 'all';
        this.state.searchQuery = '';
    },
    async persistState() {
        warmFunctionalPersistedBrowse.stateManager = {
            currentFilter: this.currentFilter,
            state: JSON.parse(JSON.stringify(this.state))
        };
    }
};
integrationSandbox.saveBrowseViewPreferences = function saveWarmFunctionalPreferences(patch) {
    if (patch && patch.lastFilter) {
        warmFunctionalPersistedBrowse.lastFilter = Object.assign({}, patch.lastFilter);
    }
    return warmFunctionalPersistedBrowse;
};
integrationSandbox.flushBrowsePreferenceWrites = async function flushWarmFunctionalPreferences() {
    return JSON.parse(JSON.stringify(warmFunctionalPersistedBrowse));
};
integrationSandbox.AppData.preferences.patchBrowse = async function patchWarmFunctionalPreferences(patch) {
    Object.assign(warmFunctionalPersistedBrowse, JSON.parse(JSON.stringify(patch || {})));
    return patch;
};
integrationSandbox.AppData.preferences.getBrowse = async function getWarmFunctionalPreferences() {
    return JSON.parse(JSON.stringify(warmFunctionalPersistedBrowse));
};
productionSetBrowseFilterState('P2', 'reading');
integrationSandbox.__browseFilterMode = 'frequency';
integrationSandbox.__browsePath = 'warm/reset/path';
integrationSandbox.__browseFrequencyFilter = 'high';
integrationIndexResolvers.push(warmFunctionalCanonicalIndex);
const warmFunctionalNavigation = integrationSandbox.showView('browse', true);
await waitForCondition(
    () => warmFunctionalManagerReadyObserved,
    'the warm production reset must pause at manager readiness'
);
const warmFunctionalBarrierToken = integrationSandbox.__getBrowseResultsRequestId();
integrationSandbox.dispatchEvent(new IntegrationCustomEvent('examIndexLoaded', {
    detail: { index: warmFunctionalLatestIndex }
}));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.strictEqual(
    integrationSandbox.__getBrowseResultsRequestId(),
    warmFunctionalBarrierToken,
    'a warm-runtime index publication must not steal a pending functional-reset token'
);
assert.deepStrictEqual(
    integrationRenders,
    [],
    'a warm-runtime index publication must wait for the functional canonical barrier'
);
warmFunctionalCanonicalIndex.resolve(warmFunctionalLatestIndex);
warmFunctionalManagerReady.resolve();
assert.notStrictEqual(
    await warmFunctionalNavigation,
    false,
    'the foreground functional reset must survive a warm-runtime index publication'
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(integrationBrowseState, { category: 'all', type: 'all' });
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'succeeded');
assert.ok(integrationRenders.length > 0, 'the successful functional reset must render canonically');
assert.deepStrictEqual(
    integrationRenders.at(-1),
    warmFunctionalLatestIndex.map((exam) => exam.id),
    'the latest published index must remain authoritative after the functional canonical render'
);
integrationSandbox.browseStateManager = productionBrowseStateManager;
integrationSandbox.saveBrowseViewPreferences = productionSaveBrowseViewPreferences;
integrationSandbox.flushBrowsePreferenceWrites = productionFlushBrowsePreferenceWrites;
integrationSandbox.AppData.preferences.patchBrowse = productionPatchBrowse;
integrationSandbox.AppData.preferences.getBrowse = warmFunctionalOriginalGetBrowse;

const productionBeginBrowseResultsRequest = integrationSandbox.__beginBrowseResultsRequest;
const productionGetBrowseResultsRequestId = integrationSandbox.__getBrowseResultsRequestId;
const productionIsBrowseResultsRequestCurrent = integrationSandbox.__isBrowseResultsRequestCurrent;
integrationSandbox.__beginBrowseResultsRequest = undefined;
integrationSandbox.__getBrowseResultsRequestId = undefined;
integrationSandbox.__isBrowseResultsRequestCurrent = undefined;
const coldFunctionalLeaseReset = deferred();
const coldFunctionalLeaseBarrier = integrationSandbox.AppEntry.registerBrowseFunctionalResetBarrier(
    coldFunctionalLeaseReset.promise
);
let coldFunctionalResultsRequestId = 0;
integrationSandbox.__beginBrowseResultsRequest = function beginColdFunctionalResultsRequest() {
    coldFunctionalResultsRequestId += 1;
    return coldFunctionalResultsRequestId;
};
integrationSandbox.__getBrowseResultsRequestId = function getColdFunctionalResultsRequestId() {
    return coldFunctionalResultsRequestId;
};
integrationSandbox.__isBrowseResultsRequestCurrent = function isColdFunctionalResultsRequestCurrent(
    requestId
) {
    return requestId == null || requestId === coldFunctionalResultsRequestId;
};
await waitForCondition(
    () => coldFunctionalResultsRequestId === 1,
    'a cold functional barrier must bind the first token as soon as the runtime API appears'
);
assert.strictEqual(
    integrationSandbox.AppEntry.isBrowseFunctionalResetBarrierCurrent(
        coldFunctionalLeaseBarrier
    ),
    true,
    'the newly bound cold functional lease must initially own the results token'
);
const coldFunctionalPendingGeneration =
    integrationSandbox.__getBrowseFunctionalResetState().generation;
const newerColdFilterRequestId = integrationSandbox.__beginBrowseResultsRequest();
assert.strictEqual(newerColdFilterRequestId, 2);
assert.strictEqual(
    integrationSandbox.AppEntry.isBrowseFunctionalResetBarrierCurrent(
        coldFunctionalLeaseBarrier
    ),
    false,
    'a newer cold-runtime filter token must cancel the older functional lease'
);
const coldFunctionalCancelledState = integrationSandbox.__getBrowseFunctionalResetState();
assert.strictEqual(coldFunctionalCancelledState.status, 'idle');
assert.strictEqual(coldFunctionalCancelledState.outcome, null);
assert.ok(
    coldFunctionalCancelledState.generation > coldFunctionalPendingGeneration,
    'cold token supersession must cancel neutrally and invalidate pending-era work'
);
coldFunctionalLeaseReset.resolve(true);
assert.strictEqual(await coldFunctionalLeaseBarrier, true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'idle',
    'a late cold reset settlement must not reclaim ownership after cancellation'
);
integrationSandbox.__beginBrowseResultsRequest = productionBeginBrowseResultsRequest;
integrationSandbox.__getBrowseResultsRequestId = productionGetBrowseResultsRequestId;
integrationSandbox.__isBrowseResultsRequestCurrent = productionIsBrowseResultsRequestCurrent;

async function establishFailedIntegrationFunctionalReset(message) {
    integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation = function () {
        return false;
    };
    try {
        assert.strictEqual(await integrationSandbox.showView('browse', true), false);
        await waitForCondition(
            () => integrationSandbox.__getBrowseFunctionalResetState().status === 'failed',
            message
        );
    } finally {
        integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation
            = productionActivationReset;
    }
}

await establishFailedIntegrationFunctionalReset(
    'the retry-cancellation fixture must start with durable failed-reset debt'
);
integrationRenders.length = 0;
const retryingFunctionalReset = deferred();
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation = function () {
    return retryingFunctionalReset.promise;
};
const retryingFunctionalNavigation = integrationSandbox.showView('browse', true);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'pending',
    'a retry may temporarily own the active functional-reset lease'
);
const failedOrdinaryReentryIndex = deferred();
integrationIndexResolvers.push(failedOrdinaryReentryIndex);
const loaderBeforeFailedOrdinaryReentry = integrationSandbox.ExamActions.loadExamList;
integrationSandbox.ExamActions.loadExamList = function failOrdinaryReentry() {
    return false;
};
const failedOrdinaryReentry = integrationSandbox.showView('browse', false);
failedOrdinaryReentryIndex.resolve([{ id: 'failed-ordinary-reentry' }]);
assert.strictEqual(await failedOrdinaryReentry, false);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'superseding a retry with a failed ordinary re-entry must preserve the predecessor debt'
);
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'progress-must-remain-blocked-after-failed-reentry' }]
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(integrationRenders, []);
retryingFunctionalReset.resolve(true);
assert.strictEqual(
    await retryingFunctionalNavigation,
    false,
    'the canceled retry must not settle over the newer failed re-entry'
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'a late canceled retry settlement must not erase durable failed-reset debt'
);
integrationSandbox.ExamActions.loadExamList = loaderBeforeFailedOrdinaryReentry;
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation
    = productionActivationReset;

await establishFailedIntegrationFunctionalReset(
    'the successful supersession fixture must start with durable failed-reset debt'
);
integrationRenders.length = 0;
const staleSuccessfulRetry = deferred();
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation = function () {
    return staleSuccessfulRetry.promise;
};
const staleSuccessfulRetryNavigation = integrationSandbox.showView('browse', true);
const staleSuccessfulRetryRequestId = integrationSandbox.__getBrowseResultsRequestId();
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'pending',
    'the retry barrier must own its request before a newer foreground intent starts'
);
assert.notStrictEqual(
    await integrationSandbox.__renderBrowseResultsForState(
        [{ id: 'newer-foreground-clears-failed-debt' }],
        null,
        { foreground: true }
    ),
    false
);
const newerSuccessfulForegroundRequestId = integrationSandbox.__getBrowseResultsRequestId();
assert.ok(
    newerSuccessfulForegroundRequestId > staleSuccessfulRetryRequestId,
    'the successful foreground commit must own a request newer than the retry barrier'
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'succeeded',
    'the atomic foreground preparation and commit must clear the predecessor debt'
);
assert.deepStrictEqual(integrationRenders, [['newer-foreground-clears-failed-debt']]);
assert.strictEqual(
    integrationSandbox.AppEntry.captureBrowseFunctionalResetRecovery(),
    null,
    'a successful foreground commit must leave no failed-reset debt to recapture'
);
staleSuccessfulRetry.resolve(true);
assert.strictEqual(
    await staleSuccessfulRetryNavigation,
    false,
    'the retry that lost its request must remain stale when it settles'
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'succeeded',
    'a late stale retry settlement must not recreate cleared failed-reset debt'
);
integrationSandbox.ExamActions.browseFilterStateOwner.resetForActivation
    = productionActivationReset;

await establishFailedIntegrationFunctionalReset(
    'the old-library foreground fixture must start with durable failed-reset debt'
);
integrationRenders.length = 0;
const displayBeforeLibraryEpochForeground = integrationSandbox.ExamActions.displayExams;
const libraryEpochForegroundDisplays = [];
integrationSandbox.ExamActions.displayExams = function captureLibraryEpochForeground(exams, options = {}) {
    const snapshot = Array.isArray(exams) ? exams : [];
    libraryEpochForegroundDisplays.push(Array.from(snapshot, (exam) => exam && exam.id));
    integrationSandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
    return true;
};
const oldLibraryForegroundIndex = deferred();
integrationIndexResolvers.push(oldLibraryForegroundIndex);
assert.strictEqual(integrationSandbox.searchExams('old-library-query'), true);
const oldLibraryForegroundRequestId = integrationSandbox.__getBrowseResultsRequestId();
assert.strictEqual(
    integrationSandbox.__isBrowseUserResultsRequestInFlight(oldLibraryForegroundRequestId),
    true,
    'the foreground search must retain its request across the asynchronous library read'
);
integrationBrowseView.classList.remove('active');
integrationOverviewView.classList.add('active');
integrationSandbox.dispatchEvent(new IntegrationCustomEvent('examIndexLoaded', {
    detail: { index: [{ id: 'new-library-publication-without-token-steal' }] }
}));
integrationOverviewView.classList.remove('active');
integrationBrowseView.classList.add('active');
assert.strictEqual(
    integrationSandbox.__getBrowseResultsRequestId(),
    oldLibraryForegroundRequestId,
    'advancing only the active library generation must not steal the foreground token'
);
oldLibraryForegroundIndex.resolve([{
    id: 'old-library-result-must-not-display',
    title: 'Old Library Query',
    searchText: 'old-library-query',
    category: 'P1',
    type: 'reading'
}]);
await waitForCondition(
    () => !integrationSandbox.__isBrowseUserResultsRequestInFlight(
        oldLibraryForegroundRequestId
    ),
    'the old-library foreground request must settle without displaying its stale result'
);
assert.deepStrictEqual(
    libraryEpochForegroundDisplays,
    [],
    'a retained foreground result from the previous active library must not display'
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'discarding the old-library result must not clear failed-reset debt'
);
const currentLibraryForegroundIndex = deferred();
integrationIndexResolvers.push(currentLibraryForegroundIndex);
assert.strictEqual(integrationSandbox.searchExams('current-library-query'), true);
const currentLibraryForegroundRequestId = integrationSandbox.__getBrowseResultsRequestId();
currentLibraryForegroundIndex.resolve([{
    id: 'current-library-result',
    title: 'Current Library Query',
    searchText: 'current-library-query',
    category: 'P2',
    type: 'reading'
}]);
await waitForCondition(
    () => libraryEpochForegroundDisplays.length === 1
        && !integrationSandbox.__isBrowseUserResultsRequestInFlight(
            currentLibraryForegroundRequestId
        ),
    'a later current-library foreground search must render and settle normally'
);
assert.deepStrictEqual(libraryEpochForegroundDisplays, [['current-library-result']]);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'succeeded',
    'the later current-library foreground commit must be allowed to recover the debt'
);
integrationSandbox.ExamActions.displayExams = displayBeforeLibraryEpochForeground;

integrationRenders.length = 0;
integrationSearchInput.value = '';
const setBrowseFilterStateBeforeApplyFailure = integrationSandbox.setBrowseFilterState;
const resetToDefaultBeforeApplyFailure = integrationSandbox.browseController.resetToDefault;
const showMessageBeforeApplyFailure = integrationSandbox.showMessage;
const loadExamListBeforeApplyFailure = integrationSandbox.ExamActions.loadExamList;
const applyFailureStateWrites = [];
const applyFailureControllerResets = [];
const applyFailureToasts = [];
const applyFailureFallbackRenders = [];
integrationSandbox.setBrowseFilterState = function captureApplyFailureState(category, type) {
    applyFailureStateWrites.push({ category, type });
    setBrowseFilterStateBeforeApplyFailure(category, type);
};
integrationSandbox.browseController.resetToDefault = function captureApplyFailureReset(...args) {
    applyFailureControllerResets.push(args);
};
integrationSandbox.showMessage = function captureApplyFailureToast(...args) {
    applyFailureToasts.push(args);
};
integrationSandbox.ExamActions.loadExamList = function captureApplyFailureFallback(exams, options = {}) {
    const snapshot = Array.isArray(exams) ? exams : [];
    applyFailureFallbackRenders.push(Array.from(snapshot, (exam) => exam && exam.id));
    integrationSandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
    return snapshot;
};
setBrowseFilterStateBeforeApplyFailure('P2', 'reading');
const staleApplyFailureIndex = deferred();
integrationIndexResolvers.push(staleApplyFailureIndex);
const staleApplyFailureResolutionCount = integrationIndexResolutionCount;
const staleApplyFailure = integrationSandbox.applyBrowseFilter('P1', 'reading');
const staleApplyFailureRequestId = integrationSandbox.__getBrowseResultsRequestId();
assert.strictEqual(
    integrationSandbox.__isBrowseUserResultsRequestInFlight(staleApplyFailureRequestId),
    true,
    'the failing filter must retain its foreground request while resolving the index'
);
assert.strictEqual(
    integrationIndexResolutionCount,
    staleApplyFailureResolutionCount + 1,
    'the stale failure fixture must enter its asynchronous index read'
);
integrationBrowseView.classList.remove('active');
integrationOverviewView.classList.add('active');
integrationSandbox.dispatchEvent(new IntegrationCustomEvent('examIndexLoaded', {
    detail: { index: [{ id: 'apply-failure-new-library' }] }
}));
integrationOverviewView.classList.remove('active');
integrationBrowseView.classList.add('active');
assert.strictEqual(
    integrationSandbox.__getBrowseResultsRequestId(),
    staleApplyFailureRequestId,
    'a library-only generation change must not hide the stale catch behind token supersession'
);
staleApplyFailureIndex.reject(new Error('stale apply index failure'));
assert.strictEqual(await staleApplyFailure, false);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(
    integrationBrowseState,
    { category: 'P2', type: 'reading' },
    'a stale catch must not replace the live filter with all/all'
);
assert.deepStrictEqual(applyFailureStateWrites, []);
assert.deepStrictEqual(applyFailureControllerResets, []);
assert.deepStrictEqual(applyFailureToasts, []);
assert.deepStrictEqual(applyFailureFallbackRenders, []);
assert.strictEqual(
    integrationIndexResolutionCount,
    staleApplyFailureResolutionCount + 1,
    'a stale catch must not start the deferred fallback index read'
);

const currentApplyFailureIndex = deferred();
const currentApplyFallbackIndex = deferred();
integrationIndexResolvers.push(currentApplyFailureIndex, currentApplyFallbackIndex);
const currentApplyFailureResolutionCount = integrationIndexResolutionCount;
const currentApplyFailure = integrationSandbox.applyBrowseFilter('P3', 'listening');
const currentApplyFailureRequestId = integrationSandbox.__getBrowseResultsRequestId();
currentApplyFailureIndex.reject(new Error('current apply index failure'));
await waitForCondition(
    () => integrationIndexResolutionCount === currentApplyFailureResolutionCount + 2,
    'a current-epoch catch must retain ownership through its deferred fallback read'
);
assert.strictEqual(
    integrationSandbox.__getBrowseResultsRequestId(),
    currentApplyFailureRequestId,
    'the current fallback must reuse the retained foreground request'
);
currentApplyFallbackIndex.resolve([{ id: 'current-apply-fallback' }]);
assert.strictEqual(await currentApplyFailure, false);
assert.deepStrictEqual(
    integrationBrowseState,
    { category: 'all', type: 'all' },
    'a current-epoch failure may still reset the filter to its safe fallback'
);
assert.deepStrictEqual(applyFailureStateWrites, [{ category: 'all', type: 'all' }]);
assert.strictEqual(applyFailureControllerResets.length, 1);
assert.deepStrictEqual(applyFailureFallbackRenders, [['current-apply-fallback']]);
integrationSandbox.setBrowseFilterState = setBrowseFilterStateBeforeApplyFailure;
integrationSandbox.browseController.resetToDefault = resetToDefaultBeforeApplyFailure;
integrationSandbox.showMessage = showMessageBeforeApplyFailure;
integrationSandbox.ExamActions.loadExamList = loadExamListBeforeApplyFailure;

await establishFailedIntegrationFunctionalReset(
    'the explicit-token search fixture must start from failed-reset debt'
);
integrationRenders.length = 0;
integrationSearchInput.value = 'raw-background-query';
integrationSandbox.__browseFrequencyFilter = 'all';
const displayBeforeExplicitTokenSearch = integrationSandbox.ExamActions.displayExams;
integrationSandbox.ExamActions.displayExams = function captureExplicitTokenSearch(exams, options = {}) {
    const snapshot = Array.isArray(exams) ? exams : [];
    integrationRenders.push(Array.from(snapshot, (exam) => exam && exam.id));
    integrationSandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
    return true;
};
const explicitTokenSearchIndex = deferred();
integrationIndexResolvers.push(explicitTokenSearchIndex);
const explicitTokenSearchRequestId = integrationSandbox.__beginBrowseResultsRequest();
assert.strictEqual(
    integrationSandbox.__isBrowseUserResultsRequestInFlight(explicitTokenSearchRequestId),
    false,
    'a raw results token must not acquire foreground ownership before search replay'
);
assert.strictEqual(
    integrationSandbox.searchExams('raw-background-query', explicitTokenSearchRequestId),
    true
);
assert.strictEqual(
    integrationSandbox.__isBrowseUserResultsRequestInFlight(explicitTokenSearchRequestId),
    false,
    'search replay must not silently promote an unretained explicit token to foreground'
);
explicitTokenSearchIndex.resolve([{
    id: 'explicit-token-background-search',
    title: 'Raw Background Query',
    searchText: 'raw-background-query',
    category: 'P1',
    type: 'reading',
    frequency: 7
}]);
await waitForCondition(
    () => integrationRenders.length === 1,
    'a current explicit-token search replay may still render as background work'
);
assert.deepStrictEqual(integrationRenders, [['explicit-token-background-search']]);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'a background search replay must not clear failed-reset debt'
);
const explicitTokenSearchDebt =
    integrationSandbox.AppEntry.captureBrowseFunctionalResetRecovery();
assert.ok(
    explicitTokenSearchDebt,
    'failed-reset debt must remain capturable after the background search render'
);
assert.strictEqual(
    integrationSandbox.AppEntry.completeBrowseFunctionalResetRecovery(
        explicitTokenSearchDebt,
        false
    ),
    false,
    'discarding the audit capture must leave the failed debt unresolved'
);
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'failed');
integrationSandbox.ExamActions.displayExams = displayBeforeExplicitTokenSearch;

await establishFailedIntegrationFunctionalReset(
    'the central foreground-boundary fixture must start from failed-reset debt'
);
integrationRenders.length = 0;
const backgroundRecoveryRequestId = integrationSandbox.__beginBrowseResultsRequest();
assert.notStrictEqual(
    await integrationSandbox.__renderBrowseResultsForState(
        [{ id: 'background-must-not-recover' }],
        backgroundRecoveryRequestId
    ),
    false
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'a current background render must not clear failed-reset debt'
);
assert.deepStrictEqual(integrationRenders, [['background-must-not-recover']]);
assert.notStrictEqual(
    await integrationSandbox.__renderBrowseResultsForState(
        [{ id: 'foreground-recovers-centrally' }],
        null,
        { foreground: true }
    ),
    false
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'succeeded',
    'the same canonical commit boundary must recover only an owned foreground render'
);
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'progress-after-central-foreground-recovery' }]
);
await waitForCondition(
    () => integrationRenders.length === 3,
    'background progress must resume after the central foreground recovery commit'
);
assert.deepStrictEqual(integrationRenders, [
    ['background-must-not-recover'],
    ['foreground-recovers-centrally'],
    ['progress-after-central-foreground-recovery']
]);

const displayBeforeForegroundRecoveryMatrix = integrationSandbox.ExamActions.displayExams;
integrationSandbox.ExamActions.displayExams = function captureForegroundSearch(exams, options = {}) {
    const snapshot = Array.isArray(exams) ? exams : [];
    integrationRenders.push(Array.from(snapshot, (exam) => exam && exam.id));
    integrationSandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
    return true;
};
const foregroundRecoveryScenarios = [
    {
        name: 'type',
        start() {
            integrationSearchInput.value = '';
            return integrationSandbox.filterByType('reading');
        }
    },
    {
        name: 'search',
        start() {
            integrationSearchInput.value = 'needle';
            return integrationSandbox.searchExams('needle');
        }
    },
    {
        name: 'sort',
        start() {
            integrationSearchInput.value = '';
            integrationSandbox.__browseSortMode = 'difficulty-desc';
            return integrationSandbox.refreshBrowseResults({ foreground: true });
        }
    },
    {
        name: 'frequency',
        start() {
            integrationSearchInput.value = '';
            integrationSandbox.__browseFrequencyFilter = 'all';
            return integrationSandbox.filterByFrequency('high');
        }
    }
];
for (const scenario of foregroundRecoveryScenarios) {
    await establishFailedIntegrationFunctionalReset(
        `the ${scenario.name} recovery fixture must start from failed-reset debt`
    );
    integrationRenders.length = 0;
    const foregroundIndex = deferred();
    integrationIndexResolvers.push(foregroundIndex);
    const foregroundResult = scenario.start();
    foregroundIndex.resolve([{
        id: `foreground-${scenario.name}`,
        title: `Needle ${scenario.name}`,
        searchText: `needle ${scenario.name}`,
        category: 'P1',
        type: 'reading',
        frequency: 7
    }]);
    if (foregroundResult && typeof foregroundResult.then === 'function') {
        assert.notStrictEqual(await foregroundResult, false);
    }
    await waitForCondition(
        () => integrationSandbox.__getBrowseFunctionalResetState().status === 'succeeded',
        `a current ${scenario.name} render must recover the failed-reset gate`
    );
    assert.deepStrictEqual(
        integrationRenders,
        [[`foreground-${scenario.name}`]],
        `the ${scenario.name} path must commit one current foreground render`
    );
    integrationSearchInput.value = '';
    integrationSandbox.refreshBrowseProgressFromRecords(
        [],
        [{ id: `progress-after-${scenario.name}` }]
    );
    await waitForCondition(
        () => integrationRenders.length === 2,
        `progress must resume after the ${scenario.name} foreground recovery`
    );
    assert.deepStrictEqual(integrationRenders.at(-1), [`progress-after-${scenario.name}`]);
}
integrationSandbox.ExamActions.displayExams = displayBeforeForegroundRecoveryMatrix;

await establishFailedIntegrationFunctionalReset(
    'the folder-filter recovery fixture must start from failed-reset debt'
);
integrationRenders.length = 0;
integrationSearchInput.value = '';
const browseControllerBeforeFolderRecovery = integrationSandbox.browseController;
const displayBeforeFolderRecovery = integrationSandbox.displayExams;
const refreshListeningBeforeFolderRecovery =
    integrationSandbox.refreshListeningAvailabilityUI;
const BrowseControllerBeforeFolderRecovery = integrationSandbox.BrowseController;
const browseModesBeforeFolderRecovery = integrationSandbox.BROWSE_MODES;
const folderRecoveryBrowseControllerSource = fs.readFileSync(
    path.join(repoRoot, 'js/app/browseController.js'),
    'utf8'
);
vm.runInContext(folderRecoveryBrowseControllerSource, integrationContext, {
    filename: 'js/app/browseController.js'
});
const folderRecoveryController = integrationSandbox.browseController;
folderRecoveryController.currentMode = 'frequency-p1';
folderRecoveryController.activeFilter = 'high';
integrationSandbox.__browseFilterMode = 'frequency-p1';
integrationSandbox.__browsePath = 'ListeningPractice/100 P1';
integrationSandbox.displayExams = function captureFolderRecoveryCommit(exams, options = {}) {
    const snapshot = Array.isArray(exams) ? exams : [];
    integrationRenders.push(Array.from(snapshot, (exam) => exam && exam.id));
    integrationSandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
    return true;
};
const folderRecoveryRequestId = integrationSandbox.__beginBrowseUserResultsRequest();
const folderRecoveryEpoch = integrationSandbox.__captureBrowseForegroundRenderEpoch();
const folderRecoveryResult = folderRecoveryController.filterByFolder(
    'high',
    [
        {
            id: 'folder-recovery-high',
            path: 'ListeningPractice/100 P1/P1 高频（35）/question.html',
            type: 'listening'
        },
        {
            id: 'folder-recovery-medium',
            path: 'ListeningPractice/100 P1/P1 中频(48)/question.html',
            type: 'listening'
        }
    ],
    folderRecoveryRequestId,
    { foregroundEpoch: folderRecoveryEpoch }
);
integrationSandbox.__endBrowseUserResultsRequest(folderRecoveryRequestId);
assert.ok(Array.isArray(folderRecoveryResult));
assert.deepStrictEqual(
    Array.from(folderRecoveryResult, (exam) => exam.id),
    ['folder-recovery-high']
);
assert.deepStrictEqual(
    integrationRenders,
    [['folder-recovery-high']],
    'the direct folder path must commit through the authoritative foreground boundary'
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'succeeded',
    'a receipted folder DOM commit must recover failed-reset debt'
);
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'progress-after-folder-recovery' }]
);
await waitForCondition(
    () => integrationRenders.length === 2,
    'progress must resume after the folder path recovers failed-reset debt'
);
assert.deepStrictEqual(integrationRenders.at(-1), ['progress-after-folder-recovery']);
integrationSandbox.displayExams = displayBeforeFolderRecovery;
integrationSandbox.browseController = browseControllerBeforeFolderRecovery;
if (refreshListeningBeforeFolderRecovery === undefined) {
    integrationSandbox.refreshListeningAvailabilityUI = undefined;
} else {
    integrationSandbox.refreshListeningAvailabilityUI =
        refreshListeningBeforeFolderRecovery;
}
if (BrowseControllerBeforeFolderRecovery === undefined) {
    integrationSandbox.BrowseController = undefined;
} else {
    integrationSandbox.BrowseController = BrowseControllerBeforeFolderRecovery;
}
if (browseModesBeforeFolderRecovery === undefined) {
    integrationSandbox.BROWSE_MODES = undefined;
} else {
    integrationSandbox.BROWSE_MODES = browseModesBeforeFolderRecovery;
}
integrationSandbox.__browseFilterMode = 'default';
integrationSandbox.__browsePath = null;

await establishFailedIntegrationFunctionalReset(
    'the rejected type-index fixture must start from failed-reset debt'
);
integrationRenders.length = 0;
const rejectedTypeIndex = deferred();
integrationIndexResolvers.push(rejectedTypeIndex);
const rejectedTypeFilter = integrationSandbox.filterByType('reading');
rejectedTypeIndex.reject(new Error('type filter index read failed'));
assert.strictEqual(await rejectedTypeFilter, false);
assert.deepStrictEqual(
    integrationRenders,
    [],
    'an index-read rejection must not manufacture an empty-list DOM commit'
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'an index-read rejection must leave failed-reset debt intact'
);
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'progress-blocked-after-type-index-rejection' }]
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(integrationRenders, []);

await establishFailedIntegrationFunctionalReset(
    'the missing-commit-receipt fixture must start from failed-reset debt'
);
integrationRenders.length = 0;
const receiptedLoaderBeforeMissingCommit = integrationSandbox.ExamActions.loadExamList;
const browseControllerBeforeMissingCommit = integrationSandbox.browseController;
const missingContainerView = {
    render() {
        return false;
    }
};
integrationSandbox.browseController = Object.assign({}, browseControllerBeforeMissingCommit, {
    getExamListView() {
        return missingContainerView;
    },
    ensureExamListView() {
        return missingContainerView;
    }
});
integrationSandbox.ExamActions.loadExamList = integrationProductionExamListLoader;
assert.strictEqual(
    await integrationSandbox.__renderBrowseResultsForState(
        [{ id: 'uncommitted-foreground-result' }],
        null,
        { foreground: true }
    ),
    false,
    'a resolved loader value without a DOM commit receipt must fail closed'
);
assert.deepStrictEqual(integrationRenders, []);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'only a terminal DOM commit receipt may clear failed-reset debt'
);
const getElementByIdBeforeMissingCommit = integrationDocument.getElementById;
integrationDocument.getElementById = function getElementByIdWithUncommittedContainer(id) {
    if (id === 'exam-list-container') {
        return {};
    }
    return getElementByIdBeforeMissingCommit.call(this, id);
};
assert.strictEqual(
    integrationSandbox.ExamListView.render([{ id: 'uncommitted-wrapper-result' }]),
    false,
    'the exported view wrapper must propagate a cached view commit failure'
);
integrationDocument.getElementById = getElementByIdBeforeMissingCommit;
const missingCommitResetIndex = deferred();
integrationIndexResolvers.push(missingCommitResetIndex);
const missingCommitReset = integrationSandbox.ExamActions.resetBrowseViewToAll();
missingCommitResetIndex.resolve([{ id: 'uncommitted-direct-reset-result' }]);
assert.strictEqual(
    await missingCommitReset,
    false,
    'the direct reset path must propagate a missing-container view failure'
);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'an uncommitted direct reset must leave failed-reset debt intact'
);
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'progress-blocked-after-missing-commit-receipt' }]
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(integrationRenders, []);
integrationSandbox.ExamActions.loadExamList = receiptedLoaderBeforeMissingCommit;
integrationSandbox.browseController = browseControllerBeforeMissingCommit;

await establishFailedIntegrationFunctionalReset(
    'the pending-filter recovery fixture must start from a failed functional barrier'
);
integrationRenders.length = 0;
const pendingRecoveryInitializationIndex = deferred();
const pendingRecoveryFilterIndex = deferred();
integrationIndexResolvers.push(pendingRecoveryInitializationIndex, pendingRecoveryFilterIndex);
const pendingRecoveryRequestId = integrationSandbox.__beginBrowseUserResultsRequest();
const pendingRecoveryFilter = {
    category: 'P2',
    type: 'reading',
    filterMode: null,
    path: null
};
integrationSandbox.__pendingBrowseFilter = pendingRecoveryFilter;
const pendingRecoveryInitialization = integrationSandbox.initializeBrowseView({
    skipLoad: true,
    renderRequestId: pendingRecoveryRequestId
});
pendingRecoveryInitializationIndex.resolve([
    { id: 'pending-recovery-initialize', category: 'all', type: 'reading' }
]);
assert.ok(Array.isArray(await pendingRecoveryInitialization));
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'the pending-filter skipLoad initialization must not recover the failed barrier early'
);
const pendingRecoveryApply = integrationSandbox.applyBrowseFilter(
    pendingRecoveryFilter.category,
    pendingRecoveryFilter.type,
    pendingRecoveryFilter.filterMode,
    pendingRecoveryFilter.path,
    pendingRecoveryRequestId
);
pendingRecoveryFilterIndex.resolve([
    { id: 'pending-recovery-current', category: 'P2', type: 'reading' }
]);
assert.notStrictEqual(await pendingRecoveryApply, false);
delete integrationSandbox.__pendingBrowseFilter;
integrationSandbox.__endBrowseUserResultsRequest(pendingRecoveryRequestId);
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'succeeded');
assert.deepStrictEqual(
    integrationRenders,
    [['pending-recovery-current']],
    'only the successful shared-token pending filter may provide the recovery render'
);

await establishFailedIntegrationFunctionalReset(
    'the stale-filter recovery fixture must start from a failed functional barrier'
);
integrationRenders.length = 0;
const staleRecoveryFilterIndex = deferred();
integrationIndexResolvers.push(staleRecoveryFilterIndex);
const staleRecoveryResolutionCount = integrationIndexResolutionCount;
const staleRecoveryFilter = integrationSandbox.applyBrowseFilter('P1', 'reading');
await waitForCondition(
    () => integrationIndexResolutionCount === staleRecoveryResolutionCount + 1,
    'the failed-barrier filter recovery must enter its canonical index read'
);
integrationSandbox.showView('overview', false);
staleRecoveryFilterIndex.resolve([
    { id: 'stale-filter-must-not-recover', category: 'P1', type: 'reading' }
]);
assert.strictEqual(await staleRecoveryFilter, false);
assert.deepStrictEqual(integrationRenders, []);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'a filter made stale by navigation must not recover the failed barrier'
);

integrationOverviewView.classList.remove('active');
integrationBrowseView.classList.add('active');
const resetSupersededRecoveryIndex = deferred();
integrationIndexResolvers.push(resetSupersededRecoveryIndex);
const resetSupersededResolutionCount = integrationIndexResolutionCount;
const resetSupersededRecovery = integrationSandbox.activateBrowseView();
await waitForCondition(
    () => integrationIndexResolutionCount === resetSupersededResolutionCount + 1,
    'the failed-barrier activation recovery must enter its canonical index read'
);
const supersedingRecoveryResetIntent = integrationSandbox.__beginBrowseResetIntent();
resetSupersededRecoveryIndex.resolve([{ id: 'reset-superseded-recovery' }]);
assert.strictEqual(await resetSupersededRecovery, false);
integrationSandbox.__endBrowseResetIntent(supersedingRecoveryResetIntent);
assert.deepStrictEqual(integrationRenders, []);
assert.strictEqual(
    integrationSandbox.__getBrowseFunctionalResetState().status,
    'failed',
    'a reset intent superseding mid-canonical must not allow stale state recovery'
);

const explicitResetRecoveryIndex = deferred();
integrationIndexResolvers.push(explicitResetRecoveryIndex);
const explicitResetRecovery = integrationSandbox.ExamActions.resetBrowseViewToAll();
explicitResetRecoveryIndex.resolve([{ id: 'functional-reset-explicit-recovery' }]);
assert.notStrictEqual(await explicitResetRecovery, false);
assert.strictEqual(integrationSandbox.__getBrowseFunctionalResetState().status, 'succeeded');
integrationSandbox.refreshBrowseProgressFromRecords(
    [],
    [{ id: 'functional-reset-progress-after-explicit-recovery' }]
);
await waitForCondition(
    () => integrationRenders.length === 2,
    'progress must resume after resetBrowseViewToAll recovers a failed barrier'
);
assert.deepStrictEqual(
    integrationRenders,
    [
        ['functional-reset-explicit-recovery'],
        ['functional-reset-progress-after-explicit-recovery']
    ],
    'a real resetBrowseViewToAll recovery must release the failed progress gate'
);
integrationSandbox.ExamActions.loadExamList = integrationProductionExamListLoader;
integrationBrowseView.classList.add = originalIntegrationBrowseAdd;

rendered.length = 0;
const sharedSearchIndex = deferred();
resolverQueue.push(sharedSearchIndex);
const sharedSearchRequestId = sandbox.__beginBrowseResultsRequest();
sandbox.searchExams('reading', sharedSearchRequestId);
assert.strictEqual(
    sandbox.__getBrowseResultsRequestId(),
    sharedSearchRequestId,
    'a background search replay must reuse the index event request token'
);
sharedSearchIndex.resolve(allExams);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.strictEqual(sandbox.__getBrowseResultsRequestId(), sharedSearchRequestId);

const debouncedSearchCalls = [];
sandbox.performanceOptimizer = {
    debounce() {
        return function captureDebouncedSearch() {
            debouncedSearchCalls.push(Array.from(arguments));
        };
    }
};
const latestDebouncedSearchRequestId = sandbox.__beginBrowseResultsRequest();
sandbox.searchExams('latest-query', latestDebouncedSearchRequestId);
assert.strictEqual(debouncedSearchCalls.length, 1);
assert.strictEqual(
    sandbox.searchExams('stale-replay', latestDebouncedSearchRequestId - 1),
    false,
    'a stale background replay must stand down before touching the shared debounce'
);
assert.strictEqual(debouncedSearchCalls.length, 1, 'stale replay must not replace the pending latest search');
delete sandbox.performanceOptimizer;

let navigationIntentMarks = 0;
sandbox.__markAppNavigationIntent = function markAppNavigationIntent() {
    navigationIntentMarks += 1;
    return navigationIntentMarks;
};
sandbox.__getAppNavigationIntentGeneration = () => navigationIntentMarks;
const bootFallbackSource = fs.readFileSync(path.join(repoRoot, 'js/boot-fallbacks.js'), 'utf8');
vm.runInContext(bootFallbackSource, context, { filename: 'js/boot-fallbacks.js' });
rendered.length = 0;
searchInput.value = 'zzzz-no-match';
const initialNoMatchIndex = deferred();
resolverQueue.push(initialNoMatchIndex);
sandbox.searchExams(searchInput.value);
initialNoMatchIndex.resolve(allExams);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(rendered, [[]], 'the active no-match search should render an empty result');

sandbox.showView('overview', false);
const reentryNoMatchIndex = deferred();
resolverQueue.push(reentryNoMatchIndex);
sandbox.showView('browse', false);
reentryNoMatchIndex.resolve(allExams);
await new Promise((resolve) => setTimeout(resolve, 0));

assert.strictEqual(searchInput.value, 'zzzz-no-match', 'ordinary Browse re-entry must preserve the query');
assert.strictEqual(browseState.category, 'P1', 'ordinary Browse re-entry must preserve the live category');
assert.strictEqual(
    browseState.type,
    'listening',
    'ordinary Browse re-entry must not restore an older persisted type over the live selection'
);
assert.deepStrictEqual(
    rendered,
    [[], []],
    'ordinary Browse re-entry must reapply the preserved query instead of flashing the full list'
);
assert.strictEqual(navigationIntentMarks, 2, 'each fallback view activation must mark a navigation intent');

rendered.length = 0;
const stateBeforeCancelledApply = { ...browseState };
const delayedNavigationFilterIndex = deferred();
resolverQueue.push(delayedNavigationFilterIndex);
const delayedNavigationFilter = sandbox.applyBrowseFilter(
    'P3',
    'listening',
    null,
    null,
    null,
    sandbox.__getAppNavigationIntentGeneration()
);
sandbox.showView('overview', false);
delayedNavigationFilterIndex.resolve(allExams);
assert.strictEqual(
    await delayedNavigationFilter,
    false,
    'a filter continuation must stop when a newer navigation intent wins'
);
assert.deepStrictEqual(browseState, stateBeforeCancelledApply);
assert.deepStrictEqual(rendered, [], 'the cancelled filter must not render after leaving Browse');
assert.strictEqual(overviewView.classList.contains('active'), true);
assert.strictEqual(browseView.classList.contains('active'), false);

rendered.length = 0;
searchInput.value = '';
const directOverviewFilterIndex = deferred();
resolverQueue.push(directOverviewFilterIndex);
const productionShowView = sandbox.showView;
const directOverviewNavigations = [];
sandbox.showView = (viewName, resetCategory) => {
    directOverviewNavigations.push([viewName, resetCategory]);
    sandbox.__markAppNavigationIntent();
    browseView.classList.remove('active');
    overviewView.classList.remove('active');
    (viewName === 'browse' ? browseView : overviewView).classList.add('active');
};
const directOverviewFilter = sandbox.applyBrowseFilter('P1', 'reading');
directOverviewFilterIndex.resolve(allExams);
await directOverviewFilter;
assert.deepStrictEqual(rendered, [['reading', 'listening']]);
assert.deepStrictEqual(browseState, { category: 'P1', type: 'reading' });
assert.deepStrictEqual(
    directOverviewNavigations,
    [['browse', false]],
    'a direct stable Overview filter must retain its contract of entering Browse after rendering'
);
sandbox.showView = productionShowView;

const examActionsSource = fs.readFileSync(path.join(repoRoot, 'js/app/examActions.js'), 'utf8');
vm.runInContext(examActionsSource, context, { filename: 'js/app/examActions.js' });
const productionLoadExamList = sandbox.ExamActions.loadExamList;
const successfulProductionExamListView = {
    render() {
        return true;
    }
};
sandbox.browseController.getExamListView = function getExamListView() {
    return successfulProductionExamListView;
};
sandbox.browseController.ensureExamListView = function ensureExamListView() {
    return successfulProductionExamListView;
};
sandbox.ExamActions.loadExamList = function captureExamActionsRender(exams, options = {}) {
    const result = productionLoadExamList.call(this, exams, options);
    if (Array.isArray(result)) {
        rendered.push(Array.from(result, (exam) => exam.id));
        sandbox.__markBrowseRenderCommitReceipt?.(options.commitReceipt);
    }
    return result;
};

rendered.length = 0;
searchInput.value = '';
const firstActivationIndex = deferred();
resolverQueue.push(firstActivationIndex);
let firstActivationControllerSetups = 0;
let firstActivationListeningSyncs = 0;
const previousControllerInitialize = sandbox.browseController.initialize;
const previousControllerContainer = sandbox.browseController.buttonContainer;
const previousPersistedFilter = sandbox.getPersistedBrowseFilter;
const previousListeningAvailabilityRefresh = sandbox.refreshListeningAvailabilityUI;
let stalePersistedFilterReads = 0;
sandbox.browseController.buttonContainer = null;
sandbox.browseController.initialize = function initializeBrowseController(containerId) {
    firstActivationControllerSetups += 1;
    this.buttonContainer = containerId === 'type-filter-buttons' ? typeButtonContainer : null;
    return true;
};
sandbox.setBrowseFilterState('P2', 'reading');
sandbox.getPersistedBrowseFilter = () => {
    stalePersistedFilterReads += 1;
    return { category: 'all', type: 'all' };
};
sandbox.refreshListeningAvailabilityUI = () => {
    firstActivationListeningSyncs += 1;
};
sandbox.showView('overview', false);
const firstActivation = sandbox.showView('browse', false);
firstActivationIndex.resolve([
    { id: 'p2-reading', title: 'P2 Reading', category: 'P2', type: 'reading' },
    { id: 'p2-listening', title: 'P2 Listening', category: 'P2', type: 'listening' }
]);
await firstActivation;
assert.strictEqual(firstActivationControllerSetups, 1, 'first Browse activation must initialize its controller');
assert.strictEqual(firstActivationListeningSyncs, 1, 'first Browse activation must refresh listening availability');
assert.strictEqual(browseState.category, 'P2');
assert.strictEqual(browseState.type, 'reading');
assert.strictEqual(
    stalePersistedFilterReads,
    0,
    'ordinary Browse re-entry must not read stale persisted scope after an explicit filter intent'
);
assert.deepStrictEqual(
    rendered,
    [['p2-reading']],
    'ordinary Browse re-entry must keep the live scope while an older persisted filter is still visible'
);
sandbox.browseController.initialize = previousControllerInitialize;
sandbox.browseController.buttonContainer = previousControllerContainer;
sandbox.getPersistedBrowseFilter = previousPersistedFilter;
sandbox.refreshListeningAvailabilityUI = previousListeningAvailabilityRefresh;

searchInput.value = 'stale-query';
sandbox.__browseFilterMode = 'frequency-p1';
sandbox.__browsePath = 'ReadingPractice/P1';
sandbox.__browseFrequencyFilter = 'high';
sandbox.browseController.currentMode = 'frequency-p1';
sandbox.browseController.activeFilter = 'reading';
const mainResetBrowseFilterStateToAll = sandbox.resetBrowseFilterStateToAll;
const mainUpdateBrowseFrequencyButtons = sandbox.updateBrowseFrequencyButtons;
sandbox.resetBrowseFilterStateToAll = undefined;
sandbox.updateBrowseFrequencyButtons = undefined;
const helperFreeResetIndex = deferred();
resolverQueue.push(helperFreeResetIndex);
const helperFreeReset = sandbox.showView('browse', true);
helperFreeResetIndex.resolve(allExams);
assert.notStrictEqual(await helperFreeReset, false, 'the helper-free reset must complete');
assert.strictEqual(searchInput.value, '', 'the helper-free repeat reset must clear the preserved query');
assert.strictEqual(sandbox.__browseFilterMode, 'default');
assert.strictEqual(sandbox.__browsePath, null);
assert.strictEqual(sandbox.__browseFrequencyFilter, 'all');
assert.strictEqual(sandbox.browseController.currentMode, 'default');
assert.strictEqual(sandbox.browseController.activeFilter, 'all');
assert.deepStrictEqual(rendered.at(-1), ['reading', 'listening']);
sandbox.resetBrowseFilterStateToAll = mainResetBrowseFilterStateToAll;
sandbox.updateBrowseFrequencyButtons = mainUpdateBrowseFrequencyButtons;
searchInput.value = '';

rendered.length = 0;
sandbox.__browseFilterMode = 'frequency-p1';
sandbox.__browsePath = 'ListeningPractice/100 P1';
sandbox.__browseFrequencyFilter = 'high';
sandbox.browseController.currentMode = 'frequency-p1';
sandbox.browseController.activeFilter = 'high';
const throwingMainReset = sandbox.resetBrowseFilterStateToAll;
const throwingPublicOwnerReset = sandbox.ExamActions.resetBrowseFilterStateToAll;
sandbox.resetBrowseFilterStateToAll = () => {
    throw new Error('main reset unavailable');
};
sandbox.ExamActions.resetBrowseFilterStateToAll = () => {
    throw new Error('public owner reset unavailable');
};
const terminalOwnerIndex = deferred();
resolverQueue.push(terminalOwnerIndex);
const terminalResetStates = [];
const ownerAwareLoadExamList = sandbox.ExamActions.loadExamList;
sandbox.ExamActions.loadExamList = function captureTerminalResetState(exams, options = {}) {
    terminalResetStates.push({
        mode: sandbox.__browseFilterMode,
        path: sandbox.__browsePath,
        frequency: sandbox.__browseFrequencyFilter
    });
    return ownerAwareLoadExamList.call(this, exams, options);
};
const terminalOwnerReset = sandbox.showView('browse', true);
terminalOwnerIndex.resolve(allExams);
assert.notStrictEqual(await terminalOwnerReset, false);
assert.deepStrictEqual(
    terminalResetStates,
    [{ mode: 'default', path: null, frequency: 'all' }],
    'the loader must only run after the stable functional-state owner resets all globals'
);
assert.deepStrictEqual(rendered.at(-1), ['reading', 'listening']);
sandbox.ExamActions.loadExamList = ownerAwareLoadExamList;
sandbox.resetBrowseFilterStateToAll = throwingMainReset;
sandbox.ExamActions.resetBrowseFilterStateToAll = throwingPublicOwnerReset;

const failedReentryIndex = deferred();
resolverQueue.push(failedReentryIndex);
const failedReentry = sandbox.showView('browse', false);
failedReentryIndex.reject(new Error('index unavailable'));
assert.strictEqual(
    await failedReentry,
    false,
    'fallback navigation must observe and contain an asynchronous Browse refresh failure'
);

rendered.length = 0;
const latestFilterIndex = deferred();
resolverQueue.push(latestFilterIndex);
const staleReset = sandbox.ExamActions.resetBrowseViewToAll();
const latestFilterAfterReset = sandbox.filterByType('reading');
latestFilterIndex.resolve(allExams);
await latestFilterAfterReset;
assert.strictEqual(await staleReset, false, 'a newer explicit filter must supersede an older reset');
assert.deepStrictEqual(rendered.at(-1), ['reading'], 'the newer explicit filter must remain the final render');
assert.strictEqual(browseState.type, 'reading', 'a stale reset must not clear the newer filter state');
assert.strictEqual(
    typeButtons.find((button) => button.dataset.filterType === 'reading').ariaPressed,
    'true',
    'a stale reset must not clear the newer filter UI'
);

rendered.length = 0;
const staleFilterIndex = deferred();
const latestResetIndex = deferred();
resolverQueue.push(staleFilterIndex, latestResetIndex);
const staleFilterBeforeReset = sandbox.filterByType('reading');
const latestReset = sandbox.ExamActions.resetBrowseViewToAll();
latestResetIndex.resolve(allExams);
await latestReset;
staleFilterIndex.resolve(allExams);
await staleFilterBeforeReset;
assert.strictEqual(browseState.type, 'all', 'a newer reset must supersede an older explicit filter');
assert.deepStrictEqual(rendered.at(-1), ['reading', 'listening'], 'the reset must remain the final all-exams render');

rendered.length = 0;
const emptyResetPrefetch = deferred();
const adapterResolvedIndex = deferred();
resolverQueue.push(emptyResetPrefetch, adapterResolvedIndex);
const resetThroughAdapter = sandbox.ExamActions.resetBrowseViewToAll();
emptyResetPrefetch.resolve([]);
adapterResolvedIndex.resolve(allExams);
const adapterResult = await resetThroughAdapter;
assert.deepStrictEqual(
    Array.from(adapterResult, (exam) => exam.id),
    ['reading', 'listening'],
    'the real global adapter must re-resolve the active index when reset passes null'
);
assert.deepStrictEqual(
    rendered.at(-1),
    ['reading', 'listening'],
    'an empty reset prefetch must never render the module-local [] default'
);

const previousGetElementByIdForComposition = documentStub.getElementById.bind(documentStub);
const previousCreateElementForComposition = documentStub.createElement.bind(documentStub);
const compositionButtons = [];
const compositionButtonContainer = {
    classList: createClassList(),
    appendChild(button) { compositionButtons.push(button); },
    querySelectorAll(selector) {
        if (selector.includes('listening')) {
            return compositionButtons.filter((button) => button.dataset.filterType === 'listening');
        }
        return compositionButtons;
    }
};
Object.defineProperty(compositionButtonContainer, 'innerHTML', {
    set() { compositionButtons.length = 0; }
});
documentStub.getElementById = function getCompositionElementById(id) {
    if (id === 'type-filter-buttons') return compositionButtonContainer;
    return previousGetElementByIdForComposition(id);
};
documentStub.createElement = function createCompositionElement(tagName) {
    if (tagName === 'button') {
        return {
            className: '',
            textContent: '',
            dataset: {},
            classList: createClassList(),
            addEventListener() {},
            setAttribute() {},
            appendChild() {}
        };
    }
    return previousCreateElementForComposition(tagName);
};
sandbox.appStateService = {
    setBrowseFilter(filter) {
        browseState.category = filter.category;
        browseState.type = filter.type;
    },
    getBrowseFilter() {
        return { category: browseState.category, type: browseState.type };
    },
    setFilteredExams() {}
};
const browseControllerSource = fs.readFileSync(path.join(repoRoot, 'js/app/browseController.js'), 'utf8');
vm.runInContext(browseControllerSource, context, { filename: 'js/app/browseController.js' });
const productionBrowseController = sandbox.browseController;
const frequencyIndex = [
    {
        id: 'p1-ultra', title: 'Shared Ultra', searchText: 'shared ultra', category: 'P1', type: 'listening',
        path: 'ListeningPractice/100 P1/P1 超高频（43）/ultra.html'
    },
    {
        id: 'p1-high', title: 'Shared High', searchText: 'shared high', category: 'P1', type: 'listening',
        path: 'ListeningPractice/100 P1/P1 高频（35）/high.html'
    },
    {
        id: 'p1-medium', title: 'Shared Medium', searchText: 'shared medium', category: 'P1', type: 'listening',
        path: 'ListeningPractice/100 P1/P1 中频(48)/medium.html'
    },
    {
        id: 'p4-numbered', title: 'Shared P4', searchText: 'shared p4', category: 'P4', type: 'listening',
        path: 'ListeningPractice/100 P4/1-10/p4.html'
    }
];
const compositionRenders = [];
sandbox.displayExams = (exams) => {
    compositionRenders.push(Array.from(exams, (exam) => exam.id));
};
sandbox.ExamActions.displayExams = sandbox.displayExams;
sandbox.setFilteredExamsState = () => {};
sandbox.handlePostExamListRender = () => {};
let compositionLoadCalls = 0;
sandbox.ExamActions.loadExamList = function guardedProductionLoad(exams) {
    compositionLoadCalls += 1;
    assert.ok(compositionLoadCalls <= 4, 'frequency-mode rendering must not recurse');
    return productionLoadExamList.call(this, exams);
};
sandbox.__browseFilterMode = 'default';
sandbox.__browsePath = null;
sandbox.__browseFrequencyFilter = 'all';
productionBrowseController.initialize('type-filter-buttons', frequencyIndex);

for (const scenario of [
    {
        mode: 'frequency-p1',
        path: 'ListeningPractice/100 P1',
        filter: 'ultra-high',
        expected: ['p1-ultra']
    },
    {
        mode: 'frequency-p4',
        path: 'ListeningPractice/100 P4',
        filter: 'all',
        expected: ['p4-numbered']
    }
]) {
    compositionRenders.length = 0;
    compositionLoadCalls = 0;
    searchInput.value = '';
    sandbox.__browseFilterMode = scenario.mode;
    sandbox.__browsePath = scenario.path;
    productionBrowseController.currentMode = scenario.mode;
    productionBrowseController.activeFilter = scenario.filter;
    const requestId = sandbox.__beginBrowseResultsRequest();

    await sandbox.__renderBrowseResultsForState(frequencyIndex, requestId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(compositionLoadCalls, 1, `${scenario.mode} must enter ExamActions once`);
    assert.strictEqual(sandbox.__getBrowseResultsRequestId(), requestId);
    assert.deepStrictEqual(compositionRenders, [scenario.expected]);
}

const duplicateP4Numbered = {
    id: 'p4-shared-numbered',
    title: 'Shared P4 Duplicate',
    searchText: 'shared p4 duplicate',
    category: 'P4',
    type: 'listening',
    path: 'ListeningPractice/100 P4/1-10/shared.html'
};
const duplicateP4High = {
    id: 'p4-shared-high',
    title: 'Shared P4 Duplicate',
    searchText: 'shared p4 duplicate',
    category: 'P4',
    type: 'listening',
    path: 'ListeningPractice/100 P4/P4 高频(52)/shared.html'
};
sandbox.__browseFilterMode = 'frequency-p4';
sandbox.__browsePath = 'ListeningPractice/100 P4';
sandbox.__browseFrequencyFilter = 'all';
productionBrowseController.currentMode = 'frequency-p4';
productionBrowseController.activeFilter = 'high';
sandbox.setBrowseFilterState('P4', 'listening');
searchInput.value = 'shared p4';
for (const duplicateOrder of [
    [duplicateP4Numbered, duplicateP4High],
    [duplicateP4High, duplicateP4Numbered]
]) {
    compositionRenders.length = 0;
    const requestId = sandbox.__beginBrowseResultsRequest();
    await sandbox.__renderBrowseResultsForState(duplicateOrder, requestId);
    assert.deepStrictEqual(
        compositionRenders,
        [['p4-shared-high']],
        'the active folder must be applied before deduplication regardless of index order'
    );
}

compositionRenders.length = 0;
compositionLoadCalls = 0;
searchInput.value = 'shared';
sandbox.resolveActiveLibraryIndex = async () => frequencyIndex;
sandbox.getPersistedBrowseFilter = () => ({ category: 'P1', type: 'listening' });
await sandbox.applyBrowseFilter(
    'P1',
    'listening',
    'frequency-p1',
    'ListeningPractice/100 P1'
);
assert.strictEqual(productionBrowseController.activeFilter, 'ultra-high');
assert.deepStrictEqual(compositionRenders, [['p1-ultra']], 'mode entry search must honor the active folder');

compositionRenders.length = 0;
await productionBrowseController.handleFilterClick('high', frequencyIndex);
assert.deepStrictEqual(compositionRenders, [['p1-high']]);
compositionRenders.length = 0;
sandbox.showView('overview', false);
await sandbox.showView('browse', false);
assert.strictEqual(searchInput.value, 'shared');
assert.strictEqual(productionBrowseController.activeFilter, 'high');
assert.deepStrictEqual(
    compositionRenders,
    [['p1-high']],
    'ordinary Browse re-entry must preserve the live query and active folder subfilter'
);

const savedResetDelegate = sandbox.resetBrowseFilterStateToAll;
const savedExamActions = sandbox.ExamActions;
const savedEnsureBrowseGroup = sandbox.ensureBrowseGroup;
const savedAppEntry = sandbox.AppEntry;
const savedAppLazyLoader = sandbox.AppLazyLoader;
const savedRefreshBrowseResults = sandbox.refreshBrowseResults;
const savedLoadExamList = sandbox.loadExamList;
const coldResetOrder = [];
let unsafeBrowseGroupCalls = 0;
sandbox.resetBrowseFilterStateToAll = undefined;
sandbox.ExamActions = undefined;
sandbox.refreshBrowseResults = undefined;
sandbox.ensureBrowseGroup = () => {
    unsafeBrowseGroupCalls += 1;
    throw new Error('the synchronizing group loader must not run before reset');
};
sandbox.AppEntry = {
    ...(savedAppEntry || {}),
    registerBrowseFunctionalResetBarrier(resetPromise) {
        coldResetOrder.push('barrier');
        return resetPromise;
    },
    isBrowseFunctionalResetBarrierCurrent() {
        return true;
    },
    completeBrowseFunctionalResetBarrier(_barrier, succeeded) {
        return succeeded === true;
    },
    updateBrowseFunctionalResetResultsRequest() {
        return true;
    },
    async ensureBrowseRuntimeGroup() {
        coldResetOrder.push('ensure');
        sandbox.ExamActions = {
            browseFilterStateOwner: {
                resetForActivation() {
                    coldResetOrder.push('owner-activation');
                    sandbox.__browseFilterMode = 'default';
                    sandbox.__browsePath = null;
                    sandbox.__browseFrequencyFilter = 'all';
                    return true;
                },
                resetToAll() {
                    throw new Error('the cold fallback must prefer the hydration-aware activation reset');
                }
            }
        };
    },
    async ensureBrowseGroup() {
        coldResetOrder.push('activate');
        return sandbox.loadExamList();
    }
};
sandbox.loadExamList = () => {
    coldResetOrder.push('load');
    return [];
};
sandbox.__browseFilterMode = 'frequency-p1';
sandbox.__browsePath = 'ReadingPractice/P1';
sandbox.__browseFrequencyFilter = 'high';
assert.notStrictEqual(await sandbox.showView('browse', true), false);
assert.deepStrictEqual(
    coldResetOrder,
    ['barrier', 'ensure', 'owner-activation', 'activate', 'load'],
    'a cold reset must run its owner before the synchronized activation can render'
);
assert.strictEqual(unsafeBrowseGroupCalls, 0, 'cold reset must not invoke the synchronizing Browse loader');

let unsafeFallbackLoads = 0;
sandbox.ExamActions = undefined;
sandbox.ensureBrowseGroup = undefined;
sandbox.AppEntry = undefined;
sandbox.AppLazyLoader = undefined;
sandbox.loadExamList = () => {
    unsafeFallbackLoads += 1;
    return [];
};
sandbox.__browseFilterMode = 'frequency-p1';
sandbox.__browsePath = 'ReadingPractice/P1';
sandbox.__browseFrequencyFilter = 'high';
assert.strictEqual(await sandbox.showView('browse', true), false);
assert.strictEqual(
    unsafeFallbackLoads,
    0,
    'an irrecoverable reset must fail closed instead of loading with stale functional state'
);
sandbox.resetBrowseFilterStateToAll = savedResetDelegate;
sandbox.ExamActions = savedExamActions;
sandbox.ensureBrowseGroup = savedEnsureBrowseGroup;
sandbox.AppEntry = savedAppEntry;
sandbox.AppLazyLoader = savedAppLazyLoader;
sandbox.refreshBrowseResults = savedRefreshBrowseResults;
sandbox.loadExamList = savedLoadExamList;

const authoritativeBrowseView = { id: 'browse-view', classList: createClassList() };
authoritativeBrowseView.classList.add('active');
const authoritativeDocument = {
    readyState: 'loading',
    body: { appendChild() {}, classList: createClassList() },
    documentElement: { classList: createClassList() },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
        if (selector === '.view.active') return authoritativeBrowseView;
        return null;
    },
    querySelectorAll() { return []; },
    createElement() {
        return { style: {}, classList: createClassList(), appendChild() {}, setAttribute() {} };
    },
    getElementById(id) {
        return id === 'browse-view' ? authoritativeBrowseView : null;
    }
};
let authoritativePersistedReads = 0;
let authoritativeDurableReads = 0;
let authoritativeWritesDurably = false;
const authoritativePatchGate = deferred();
const authoritativePreferencePatches = [];
const authoritativeDurableBrowse = {
    lastFilter: { category: 'P2', type: 'reading' },
    filter: { category: 'all', type: 'all' },
    frequencyFilter: 'high'
};
const authoritativeIndex = [
    { id: 'authoritative-reading', title: 'Authoritative Reading', category: 'P1', type: 'reading' }
];
const authoritativeSandbox = {
    console: quietConsole,
    document: authoritativeDocument,
    location: { href: 'https://example.test/index.html', search: '', origin: 'https://example.test', protocol: 'https:' },
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
        constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
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
    setBrowseTitle() {},
    formatBrowseTitle(category, type) { return `${category}:${type}`; },
    normalizeExamType(type) { return type || 'all'; },
    async resolveActiveLibraryIndex() { return authoritativeIndex; },
    browseController: {
        currentMode: 'default',
        buttonContainer: {},
        currentCategory: 'all',
        currentExamType: 'all',
        getCurrentCategory() { return 'all'; },
        getCurrentExamType() { return 'all'; },
        updateBrowseTitle() {}
    },
    ExamActions: {
        loadExamList(exams) { return exams; },
        displayExams(exams) { return exams; }
    },
    AppData: {
        ready: Promise.resolve(),
        preferences: {
            async getBrowse() {
                authoritativeDurableReads += 1;
                return JSON.parse(JSON.stringify(authoritativeDurableBrowse));
            },
            async setBrowse(value) {
                Object.assign(authoritativeDurableBrowse, JSON.parse(JSON.stringify(value || {})));
                return value;
            },
            async patchBrowse(value) {
                authoritativePreferencePatches.push(JSON.parse(JSON.stringify(value || {})));
                await authoritativePatchGate.promise;
                if (authoritativeWritesDurably) {
                    Object.assign(authoritativeDurableBrowse, JSON.parse(JSON.stringify(value || {})));
                }
                return value;
            }
        },
        practice: {
            async list() { return []; },
            async listInsights() { return []; },
            async getStats() { return {}; }
        },
        library: {
            async getActive() { return null; },
            async listConfigurations() { return []; }
        }
    }
};
authoritativeSandbox.window = authoritativeSandbox;
authoritativeSandbox.globalThis = authoritativeSandbox;
authoritativeSandbox.self = authoritativeSandbox;
const authoritativeContext = vm.createContext(authoritativeSandbox);
const stateServiceSource = fs.readFileSync(path.join(repoRoot, 'js/app/state-service.js'), 'utf8');
vm.runInContext(stateServiceSource, authoritativeContext, { filename: 'js/app/state-service.js' });
assert.strictEqual(authoritativeSandbox.getBrowseFilterMutationRevision(), 0);
authoritativeSandbox.appStateService.syncFromAppPath(
    'ui.browseFilter',
    { category: 'all', type: 'all' }
);
assert.strictEqual(
    authoritativeSandbox.getBrowseFilterMutationRevision(),
    0,
    'legacy-app startup preference hydration must not masquerade as a live mutation'
);
authoritativeSandbox.setBrowseFilterState('all', 'all');
assert.strictEqual(
    authoritativeSandbox.getBrowseFilterMutationRevision(),
    1,
    'a same-value authoritative reset before Browse loads must advance the mutation revision'
);
assert.strictEqual(
    authoritativePreferencePatches.length,
    0,
    'a strict pre-activation library mutation cannot persist before BrowsePreferencesUtils loads'
);
const browsePreferencesSource = fs.readFileSync(path.join(repoRoot, 'js/utils/BrowsePreferencesUtils.js'), 'utf8');
vm.runInContext(browsePreferencesSource, authoritativeContext, { filename: 'js/utils/BrowsePreferencesUtils.js' });
await authoritativeSandbox.whenBrowseViewPreferencesReady();
const authoritativeDurableReadsAfterPreferencesLoad = authoritativeDurableReads;
const productionAuthoritativePersistedReader = authoritativeSandbox.getPersistedBrowseFilter;
authoritativeSandbox.getPersistedBrowseFilter = () => {
    authoritativePersistedReads += 1;
    return productionAuthoritativePersistedReader();
};
vm.runInContext(source, authoritativeContext, { filename: 'js/main.js' });
const authoritativeInitialization = authoritativeSandbox.initializeBrowseView({ skipLoad: true });
for (let attempt = 0; attempt < 16 && authoritativePreferencePatches.length === 0; attempt += 1) {
    await Promise.resolve();
}
assert.strictEqual(
    authoritativePreferencePatches.length,
    1,
    'first Browse initialization must drain the live authoritative filter once preferences are ready'
);
assert.deepStrictEqual(
    authoritativeDurableBrowse.lastFilter,
    { category: 'P2', type: 'reading' },
    'the durable filter must remain old until the authoritative drain commits'
);
authoritativePatchGate.resolve();
assert.strictEqual(
    await authoritativeInitialization,
    null,
    'a resolved preference write without durable readback must fail closed'
);
assert.strictEqual(
    authoritativeDurableReads,
    authoritativeDurableReadsAfterPreferencesLoad + 1,
    'the authoritative drain must verify the storage adapter after flushing its write queue'
);
assert.deepStrictEqual(
    authoritativeDurableBrowse.lastFilter,
    { category: 'P2', type: 'reading' },
    'a no-op storage adapter must not be mistaken for a durable commit'
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(authoritativeSandbox.getBrowseFilterState())),
    { category: 'all', type: 'all' },
    'failed durable verification must not hydrate the older persisted filter'
);

authoritativeWritesDurably = true;
const authoritativeRetry = await authoritativeSandbox.initializeBrowseView({ skipLoad: true });
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(authoritativeRetry)),
    authoritativeIndex,
    'a later initialization must retry the unconsumed authoritative drain'
);
assert.strictEqual(
    authoritativeDurableReads,
    authoritativeDurableReadsAfterPreferencesLoad + 2,
    'the successful retry must perform a fresh durable readback'
);
assert.strictEqual(
    authoritativePersistedReads,
    0,
    'lazy Browse hydration must not revive committed preferences older than an authoritative mutation'
);
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(authoritativeSandbox.getBrowseFilterState())),
    { category: 'all', type: 'all' }
);
await authoritativeSandbox.flushBrowsePreferenceWrites();
assert.deepStrictEqual(authoritativeDurableBrowse.lastFilter, { category: 'all', type: 'all' });
assert.strictEqual(
    authoritativePreferencePatches.some((patch) => (
        patch.lastFilter?.category === 'P2' && patch.lastFilter?.type === 'reading'
    )),
    false,
    'initial hydration must not enqueue a trailing stale P2/reading write'
);

let reloadPersistedReads = 0;
const reloadSandbox = {
    console: quietConsole,
    document: authoritativeDocument,
    location: { href: 'https://example.test/index.html', search: '', origin: 'https://example.test', protocol: 'https:' },
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
    CustomEvent: authoritativeSandbox.CustomEvent,
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
    setBrowseTitle() {},
    formatBrowseTitle(category, type) { return `${category}:${type}`; },
    normalizeExamType(type) { return type || 'all'; },
    async resolveActiveLibraryIndex() { return authoritativeIndex; },
    browseController: {
        currentMode: 'default',
        buttonContainer: {},
        currentCategory: 'all',
        currentExamType: 'all',
        getCurrentCategory() { return 'all'; },
        getCurrentExamType() { return 'all'; },
        updateBrowseTitle() {}
    },
    ExamActions: {
        loadExamList(exams) { return exams; },
        displayExams(exams) { return exams; }
    },
    AppData: authoritativeSandbox.AppData
};
reloadSandbox.window = reloadSandbox;
reloadSandbox.globalThis = reloadSandbox;
reloadSandbox.self = reloadSandbox;
const reloadContext = vm.createContext(reloadSandbox);
vm.runInContext(stateServiceSource, reloadContext, { filename: 'js/app/state-service.js' });
assert.strictEqual(
    reloadSandbox.getBrowseFilterMutationRevision(),
    0,
    'a clean reload must begin with no live mutation revision'
);
vm.runInContext(browsePreferencesSource, reloadContext, { filename: 'js/utils/BrowsePreferencesUtils.js' });
await reloadSandbox.whenBrowseViewPreferencesReady();
const reloadPersistedFilterReader = reloadSandbox.getPersistedBrowseFilter;
reloadSandbox.getPersistedBrowseFilter = () => {
    reloadPersistedReads += 1;
    return reloadPersistedFilterReader();
};
vm.runInContext(source, reloadContext, { filename: 'js/main.js' });
await reloadSandbox.initializeBrowseView({ skipLoad: true });
await reloadSandbox.flushBrowsePreferenceWrites();
assert.strictEqual(reloadPersistedReads, 1, 'a clean reload must hydrate the committed filter once');
assert.deepStrictEqual(
    JSON.parse(JSON.stringify(reloadSandbox.getBrowseFilterState())),
    { category: 'all', type: 'all' },
    'a clean reload must retain the drained all/all filter instead of reviving P2/reading'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'browse search, filters, and repeat reset use latest-wins rendering'
}, null, 2));
