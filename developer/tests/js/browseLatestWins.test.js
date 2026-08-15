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
const quietConsole = { log() {}, info() {}, warn() {}, error() {} };
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
    normalizeCategoryKey(value) {
        const normalized = String(value || '').trim();
        if (!normalized || normalized.toLowerCase() === 'all') return 'all';
        const embedded = normalized.match(/\b(P[1-4])\b/i);
        return embedded ? embedded[1].toUpperCase() : normalized;
    },
    normalizeExamType(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return normalized === 'reading' || normalized === 'listening' ? normalized : 'all';
    },
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
vm.runInContext(source, vm.createContext(sandbox), { filename: 'js/main.js' });

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

const customCategoryIndex = [
    { id: 'custom-reading', title: 'Imported Custom', type: 'reading', category: 'Custom' },
    { id: 'p1-reading', title: 'Built-in P1', type: 'reading', category: 'P1' }
];
const customCategoryResolution = deferred();
resolverQueue.push(customCategoryResolution);
const customCategoryFilter = sandbox.applyBrowseFilter('Custom', 'reading');
customCategoryResolution.resolve(customCategoryIndex);
await customCategoryFilter;

assert.strictEqual(
    browseState.category,
    'Custom',
    'quick-picker navigation must preserve non-P1-P4 categories such as imported Custom'
);
assert.deepStrictEqual(
    Array.from(sandbox.getBrowseFilteredExamBase(customCategoryIndex), (exam) => exam.id),
    ['custom-reading'],
    'the preserved custom category must filter the Browse list instead of falling back to all reading exams'
);

const decoratedCategoryIndex = [
    { id: 'p1-mock', title: 'Imported P1 Mock', type: 'reading', category: 'P1 Mock' },
    { id: 'p1-mock-lower', title: 'Imported lowercase mock', type: 'reading', category: 'p1 mock' },
    { id: 'p1-reading', title: 'Built-in P1', type: 'reading', category: 'P1' }
];
const decoratedCategoryResolution = deferred();
resolverQueue.push(decoratedCategoryResolution);
const decoratedCategoryFilter = sandbox.applyBrowseFilter('P1 Mock', 'reading');
decoratedCategoryResolution.resolve(decoratedCategoryIndex);
await decoratedCategoryFilter;

assert.strictEqual(
    browseState.category,
    'P1 Mock',
    'an exact active-index category must take precedence over embedded P1-P4 legacy normalization'
);
assert.deepStrictEqual(
    Array.from(sandbox.getBrowseFilteredExamBase(decoratedCategoryIndex), (exam) => exam.id),
    ['p1-mock'],
    'a dynamically rendered decorated category must open its exact Browse subset'
);

const lowercaseCategoryResolution = deferred();
resolverQueue.push(lowercaseCategoryResolution);
const lowercaseCategoryFilter = sandbox.applyBrowseFilter('p1 mock', 'reading');
lowercaseCategoryResolution.resolve(decoratedCategoryIndex);
await lowercaseCategoryFilter;
assert.strictEqual(
    browseState.category,
    'p1 mock',
    'case-sensitive exact matches must win when an active index contains case-distinct categories'
);
assert.deepStrictEqual(
    Array.from(sandbox.getBrowseFilteredExamBase(decoratedCategoryIndex), (exam) => exam.id),
    ['p1-mock-lower'],
    'case-distinct category scopes must not collapse into the first compatibility match'
);

const existingBrowseStateManager = { source: 'lazy-prefetch' };
let browseStateManagerConstructionCount = 0;
let navigationInitialView = null;
const originalQuerySelector = documentStub.querySelector;
documentStub.querySelector = function querySelector(selector) {
    if (selector === '.view.active') {
        return { id: 'browse-view' };
    }
    return originalQuerySelector.call(this, selector);
};
sandbox.browseStateManager = existingBrowseStateManager;
sandbox.BrowseStateManager = function BrowseStateManager() {
    browseStateManagerConstructionCount += 1;
};
sandbox.NavigationController = {
    ensure(options) {
        navigationInitialView = options.initialView;
        return {};
    }
};
sandbox.LibraryManager = {
    getInstance() {
        return {
            async loadActiveLibrary() {}
        };
    }
};
sandbox.setupBrowsePreferenceUI = function setupBrowsePreferenceUI() {};

await sandbox.initializeLegacyComponents();
documentStub.querySelector = originalQuerySelector;

assert.strictEqual(
    browseStateManagerConstructionCount,
    0,
    'app initialization must reuse the manager already created by lazy Browse prefetch'
);
assert.strictEqual(
    sandbox.browseStateManager,
    existingBrowseStateManager,
    'app initialization must preserve the prefetched BrowseStateManager singleton'
);
assert.strictEqual(
    navigationInitialView,
    'browse',
    'second-stage navigation initialization must preserve the currently active Browse view'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'browse filters use latest-wins rendering, preserve custom categories, and keep lazy initialization idempotent'
}, null, 2));
