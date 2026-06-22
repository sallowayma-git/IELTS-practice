#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const source = fs.readFileSync(path.join(repoRoot, 'js/components/BrowseStateManager.js'), 'utf8');

function createContext(initialStorage = {}) {
    const storage = new Map(Object.entries(initialStorage));
    const dispatchedEvents = [];
    const titleNode = { textContent: '' };
    const searchInput = { value: 'query' };
    const testConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console)
    };
    const context = {
        console: testConsole,
        Date,
        JSON,
        Number,
        Object,
        Set,
        String,
        Array,
        CustomEvent: class CustomEvent {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail || {};
            }
        },
        localStorage: {
            getItem(key) {
                return storage.has(key) ? storage.get(key) : null;
            },
            setItem(key, value) {
                storage.set(key, String(value));
            },
            removeItem(key) {
                storage.delete(key);
            }
        },
        document: {
            addEventListener() {},
            dispatchEvent(event) {
                dispatchedEvents.push(event);
            },
            getElementById(id) {
                return id === 'browse-title' ? titleNode : null;
            },
            querySelector(selector) {
                return selector === '.search-input' ? searchInput : null;
            }
        },
        window: {
            addEventListener() {},
            currentCategory: 'all'
        },
        __storage: storage,
        __events: dispatchedEvents,
        __titleNode: titleNode,
        __searchInput: searchInput
    };
    context.window.window = context.window;
    context.window.document = context.document;
    context.window.localStorage = context.localStorage;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'js/components/BrowseStateManager.js' });
    return context;
}

const pollutedPersistedState = `{
  "previousFilter": "${'previous-filter-'.repeat(20)}",
  "browseHistory": [
    { "action": "filter_change", "to": "reading", "timestamp": 123, "extra": "drop" },
    { "__proto__": { "polluted": true }, "action": "filter_change", "to": "${'x'.repeat(500)}", "timestamp": "bad" },
    { "constructor": { "prototype": { "polluted": true } }, "action": "navigate_to_browse", "filter": "all", "timestamp": 456 }
  ],
  "state": {
    "currentCategory": "restored",
    "viewMode": "evil",
    "sortBy": "unknown",
    "sortOrder": "sideways",
    "searchQuery": "${'q'.repeat(1000)}",
    "filters": {
      "frequency": "p1",
      "status": "complete",
      "difficulty": "hard",
      "constructor": { "prototype": { "polluted": true } }
    },
    "pagination": {
      "page": -10,
      "pageSize": 999,
      "total": -5
    },
    "__proto__": { "polluted": true },
    "constructor": { "prototype": { "polluted": true } },
    "unsafe": "drop"
  }
}`;

const restoredContext = createContext({ browse_state: pollutedPersistedState });
const RestoredManager = restoredContext.window.BrowseStateManager;
const restored = new RestoredManager();
const restoredState = restored.getState();

assert.equal(Object.prototype.polluted, undefined);
assert.equal(restored.getCurrentFilter(), 'all');
assert(restored.getPreviousFilter().length <= 120);
assert.equal(restoredState.currentCategory, null);
assert.equal(restoredState.viewMode, 'grid');
assert.equal(restoredState.sortBy, 'title');
assert.equal(restoredState.sortOrder, 'asc');
assert.equal(restoredState.searchQuery.length, 300);
assert.equal(restoredState.filters.frequency, 'p1');
assert.equal(restoredState.filters.status, 'complete');
assert.equal(restoredState.filters.difficulty, 'hard');
assert.equal(restoredState.pagination.page, 1);
assert.equal(restoredState.pagination.pageSize, 200);
assert.equal(restoredState.pagination.total, 0);
assert.equal(Object.prototype.hasOwnProperty.call(restoredState, 'unsafe'), false);
assert.equal(Object.prototype.hasOwnProperty.call(restoredState, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(restoredState, 'constructor'), false);

const history = restored.getBrowseHistory();
assert.equal(history.length, 3);
assert(history.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'extra')));
assert(history.every((entry) => !Object.prototype.hasOwnProperty.call(entry, '__proto__')));
assert(history.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'constructor')));
assert(history.some((entry) => String(entry.to || '').length <= 160));

restored.setState({
    searchQuery: `${'q'.repeat(299)}\uD83D\uDE00tail`,
    currentFrequency: `${'f'.repeat(119)}\uD83D\uDE00tail`,
    filters: {
        frequency: `${'p'.repeat(119)}\uD83D\uDE00tail`
    }
});
const unicodeState = restored.getState();
assert.equal(unicodeState.searchQuery, 'q'.repeat(299));
assert.equal(unicodeState.currentFrequency, 'f'.repeat(119));
assert.equal(unicodeState.filters.frequency, 'p'.repeat(119));
assert.equal(/[\uD800-\uDFFF]/.test([
    unicodeState.searchQuery,
    unicodeState.currentFrequency,
    unicodeState.filters.frequency
].join('')), false);

const stateClone = restored.getState();
stateClone.filters.frequency = 'mutated';
assert.equal(restored.getState().filters.frequency, 'p'.repeat(119));

restored.setBrowseFilter('reading-' + 'x'.repeat(500));
assert(restored.getCurrentFilter().length <= 120);
assert(restoredContext.window.currentCategory.length <= 120);
const lastFilterEvent = restoredContext.__events.findLast((event) => event.type === 'browseFilterChanged');
assert(lastFilterEvent);
assert(lastFilterEvent.detail.filter.length <= 120);

const importedHistory = JSON.parse(`{
  "browseHistory": [
    ${Array.from({ length: 12 }, (_, index) => `{"action":"filter_change","to":"category-${index}","timestamp":${index}}`).join(',')},
    { "action": "filter_change", "to": "__proto__", "timestamp": 97 },
    { "action": "filter_change", "to": "constructor", "timestamp": 98 },
    { "action": "filter_change", "to": "${'z'.repeat(159)}\uD83D\uDE00tail", "timestamp": 98 },
    { "__proto__": { "polluted": true }, "action": "filter_change", "to": "${'y'.repeat(500)}", "timestamp": 99, "extra": "drop" },
    { "constructor": { "prototype": { "polluted": true } }, "action": "navigate_to_browse", "filter": "all", "timestamp": 100 }
  ]
}`);
assert.equal(restored.importBrowseHistory(importedHistory), true);
const imported = restored.getBrowseHistory();
assert.equal(imported.length, 10);
assert(imported.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'extra')));
assert(imported.every((entry) => !Object.prototype.hasOwnProperty.call(entry, '__proto__')));
assert(imported.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'constructor')));
assert(imported.some((entry) => entry.to === 'z'.repeat(159)));
assert.equal(/[\uD800-\uDFFF]/.test(imported.map((entry) => entry.to || entry.filter || '').join('')), false);
assert.equal(Object.prototype.polluted, undefined);
const importedStats = restored.getBrowseStats();
assert.equal(Object.getPrototypeOf(importedStats.filterUsage), null);
assert.equal(importedStats.filterUsage.__proto__, 1);
assert.equal(importedStats.filterUsage.constructor, 1);
assert.equal(Object.prototype.polluted, undefined);

const originalConsoleError = restoredContext.console.error;
restoredContext.console.error = () => {};
try {
    assert.equal(restored.importBrowseHistory('[]'), false);
    assert.equal(
        restored.importBrowseHistory('{"browseHistory":[],"padding":"' + 'x'.repeat(300 * 1024) + '"}'),
        false,
        'oversized browse history import strings should be rejected before parsing'
    );
} finally {
    restoredContext.console.error = originalConsoleError;
}

const oversizedRestoreContext = createContext({
    browse_state: '{"browseHistory":[],"padding":"' + 'x'.repeat(300 * 1024) + '"}'
});
oversizedRestoreContext.console.error = () => {};
const OversizedRestoreManager = oversizedRestoreContext.window.BrowseStateManager;
const oversizedRestored = new OversizedRestoreManager();
assert.equal(oversizedRestored.getCurrentFilter(), 'all');
assert.deepEqual(oversizedRestored.getBrowseHistory(), []);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'browse state manager import and restore guards passed'
}, null, 2));
