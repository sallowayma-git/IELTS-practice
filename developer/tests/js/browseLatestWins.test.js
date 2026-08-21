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
    async resolveActiveLibraryIndex() {
        const next = resolverQueue.shift();
        if (!next) throw new Error('unexpected index resolution');
        return next.promise;
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
        loadExamList(exams) { rendered.push(Array.from(exams, (exam) => exam.id)); },
        displayExams(exams) { rendered.push(Array.from(exams, (exam) => exam.id)); }
    },
    AppData: {
        ready: Promise.resolve(),
        preferences: {
            async getBrowse() { return {}; },
            async setBrowse(value) { return value; }
        },
        practice: {
            async list() { return []; },
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

const firstHydrationIndex = deferred();
const latestHydrationIndex = deferred();
const initialPersistedFilterReader = sandbox.getPersistedBrowseFilter;
let initialPersistedFilterReads = 0;
sandbox.getPersistedBrowseFilter = () => {
    initialPersistedFilterReads += 1;
    return { category: 'P2', type: 'reading' };
};
resolverQueue.push(firstHydrationIndex, latestHydrationIndex);
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
sandbox.ExamActions.loadExamList = function captureExamActionsRender(exams) {
    const result = productionLoadExamList.call(this, exams);
    if (Array.isArray(result)) {
        rendered.push(Array.from(result, (exam) => exam.id));
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
await helperFreeReset;
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
sandbox.ExamActions.loadExamList = function captureTerminalResetState(exams) {
    terminalResetStates.push({
        mode: sandbox.__browseFilterMode,
        path: sandbox.__browsePath,
        frequency: sandbox.__browseFrequencyFilter
    });
    return ownerAwareLoadExamList.call(this, exams);
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

console.log(JSON.stringify({
    status: 'pass',
    detail: 'browse search, filters, and repeat reset use latest-wins rendering'
}, null, 2));
