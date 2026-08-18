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
const browseView = { classList: { contains(value) { return value === 'active'; } } };
const searchClearButton = { hidden: true };
const documentStub = {
    readyState: 'loading',
    body: { appendChild() {}, classList: createClassList() },
    documentElement: { classList: createClassList() },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: createClassList(), appendChild() {}, setAttribute() {} }; },
    getElementById(id) {
        if (id === 'type-filter-buttons') return typeButtonContainer;
        if (id === 'browse-view') return browseView;
        if (id === 'search-clear-btn') return searchClearButton;
        return null;
    }
};

const rendered = [];
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
    dispatchEvent() {},
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
const allExams = [
    { id: 'reading', title: 'Reading', type: 'reading', category: 'P1' },
    { id: 'listening', title: 'Listening', type: 'listening', category: 'P1' }
];
filterSecond.resolve(allExams);
await latestFilter;
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
    sandbox.__getBrowseResultsRequestId(),
    sharedPendingFilterRequestId,
    'a synchronized pending filter must reuse the initialization request token'
);
sharedPendingFilterIndex.resolve(allExams);
await sharedPendingFilter;
assert.strictEqual(browseState.category, 'P1');
assert.strictEqual(browseState.type, 'reading');

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

console.log(JSON.stringify({
    status: 'pass',
    detail: 'browse search, filters, and repeat reset use latest-wins rendering'
}, null, 2));
