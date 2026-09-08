import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function harness(script) {
    let navigation = 1;
    let activeLibrary = 'current-library';
    const opens = [];
    const groups = [];
    const messages = [];
    const delegates = new Map();
    const listeners = new Map();
    const window = {
        console: { log() {}, warn() {} },
        document: {
            readyState: 'loading', addEventListener(type, listener) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(listener);
            },
            getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }
        },
        addEventListener() {},
        __getAppNavigationIntentGeneration: () => navigation,
        AppData: { library: { async getActive() { return activeLibrary; } } },
        AppLazyLoader: { async ensureGroup(group) { groups.push(group); } },
        ReadingVocabReader: { async open(id, options) { opens.push({ id, options }); } },
        DOM: { delegate(type, selector, callback) { delegates.set(`${type}:${selector}`, callback); } },
        showMessage: message => messages.push(message)
    };
    const context = vm.createContext({ window, document: window.document, console: window.console,
        setTimeout, clearTimeout, URL, URLSearchParams });
    vm.runInContext(fs.readFileSync(new URL(`../../../js/${script}`, import.meta.url), 'utf8'), context);
    return { window, opens, groups, messages, delegates, listeners,
        navigate() { navigation += 1; }, activate(id) { activeLibrary = id; } };
}

test('Browse first invocation loads its groups and keeps the rendered card source', async () => {
    const h = harness('app/examActions.js');
    const ready = deferred();
    h.window.AppLazyLoader.ensureGroup = async group => { h.groups.push(group); await ready.promise; };
    h.window.ExamActions.setupExamActionHandlers();
    const target = { dataset: { action: 'vocab-book', examId: 'same-id', libraryConfigurationId: 'library-a', contentRef: 'original-source-reference' } };
    h.delegates.get('click:[data-action="vocab-book"]').call(target, { preventDefault() {} });
    h.activate('library-b');
    ready.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.groups, ['exam-data', 'browse-runtime']);
    assert.equal(h.opens.length, 1);
    assert.equal(h.opens[0].options.libraryConfigurationId, 'library-a');
    assert.equal(h.opens[0].options.contentRef, 'original-source-reference');
    assert.equal(h.opens[0].options.returnFocus, target);
    await h.window.launchBrowseReadingVocab('builtin', { dataset: { libraryConfigurationId: '' } });
    assert.equal(h.opens[1].options.libraryConfigurationId, null, 'explicit default must not inherit an imported active library');
});

test('pending Browse reader opens respect the latest article and navigation intent', async () => {
    const h = harness('app/examActions.js');
    const ready = deferred();
    h.window.AppLazyLoader.ensureGroup = async () => ready.promise;
    const target = { dataset: { libraryConfigurationId: '' } };
    const first = h.window.launchBrowseReadingVocab('a', target);
    const second = h.window.launchBrowseReadingVocab('b', target);
    ready.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(h.opens.map(row => row.id), ['b']);
    const next = deferred();
    h.window.AppLazyLoader.ensureGroup = async () => next.promise;
    const abandoned = h.window.launchBrowseReadingVocab('c', target);
    h.navigate();
    next.resolve();
    await abandoned;
    assert.deepEqual(h.opens.map(row => row.id), ['b']);
});

test('Browse load failure reports an error and permits a fresh retry', async () => {
    const h = harness('app/examActions.js');
    h.window.AppLazyLoader.ensureGroup = async () => { throw new Error('offline'); };
    await h.window.launchBrowseReadingVocab('a', { dataset: {} });
    assert.equal(h.opens.length, 0);
    assert.equal(h.messages.length, 1);
    h.window.AppLazyLoader.ensureGroup = async () => {};
    await h.window.launchBrowseReadingVocab('a', { dataset: {} });
    assert.equal(h.opens.length, 1);
});

test('cold Bookshelf opens preserve the return view and ignore stale lazy completions', async () => {
    const h = harness('presentation/app-actions.js');
    const mounts = [];
    const navigations = [];
    h.window.BookshelfView = { mount(selector, options) { mounts.push({ selector, options }); } };
    h.window.app = { currentView: 'more', navigateToView(view) { navigations.push(view); } };
    const ready = deferred();
    h.window.AppLazyLoader.ensureGroup = async () => ready.promise;
    const stale = h.window.AppActions.openBookshelf({ fromView: 'overview' });
    await Promise.resolve();
    h.navigate();
    ready.resolve();
    await stale;
    assert.equal(mounts.length, 0);
    assert.equal(navigations.length, 0);
    await h.window.AppActions.openBookshelf({ fromView: 'more' });
    assert.equal(mounts.length, 1);
    assert.equal(mounts[0].options.fromView, 'more');
    assert.deepEqual(navigations, ['bookshelf']);
});

test('the visible More card accepts its first click before tools bind, without duplicating warm clicks', async () => {
    const h = harness('presentation/app-actions.js');
    const ready = deferred();
    const mounts = [];
    h.window.AppLazyLoader.ensureGroup = async group => {
        h.groups.push(group);
        await ready.promise;
        h.window.BookshelfView = { mount(selector, options) { mounts.push(options); } };
    };
    const target = { closest() { return this; } };
    const event = { target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    h.listeners.get('click').forEach(listener => listener(event));
    await Promise.resolve();
    assert.equal(event.defaultPrevented, true);
    assert.equal(mounts.length, 0);
    ready.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(mounts.length, 1);
    assert.equal(mounts[0].fromView, 'more');
    assert.deepEqual(h.groups, ['more-tools', 'exam-data']);
    // An installed More handler owns a warm click by preventing its default.
    h.listeners.get('click').forEach(listener => listener({ ...event, defaultPrevented: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(mounts.length, 1);
});
