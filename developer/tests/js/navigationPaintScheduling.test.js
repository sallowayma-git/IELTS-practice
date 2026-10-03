import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function load(relativePath, context) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), context, { filename: relativePath });
}

function harness() {
    const frames = new Map();
    const timers = new Map();
    let nextId = 0;
    let requestId = 0;
    const views = new Map(['overview', 'browse', 'practice', 'more'].map((name) => {
        const classes = new Set(name === 'overview' ? ['active'] : []);
        return [name, { id: `${name}-view`, classList: {
            add(value) { classes.add(value); }, remove(value) { classes.delete(value); },
            contains(value) { return classes.has(value); }
        }, removeAttribute() {} }];
    }));
    const document = {
        readyState: 'loading', hidden: false, addEventListener() {},
        getElementById(id) { return views.get(id.replace(/-view$/, '')) || null; },
        querySelector(selector) {
            return selector === '.view.active' ? Array.from(views.values()).find((view) => view.classList.contains('active')) : null;
        },
        querySelectorAll(selector) {
            if (selector === '.view') return Array.from(views.values());
            if (selector === '.view.active') return Array.from(views.values()).filter((view) => view.classList.contains('active'));
            return [];
        }
    };
    const window = {
        document, addEventListener() {}, location: new URL('http://localhost/'), history: { replaceState() {} },
        requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); },
        __getBrowseResultsRequestId() { return requestId; }
    };
    const context = vm.createContext({ window, document, URL, URLSearchParams, console });
    load('js/app/main-entry.js', context);
    function flush(queue) {
        const callbacks = Array.from(queue.values());
        queue.clear();
        callbacks.forEach((callback) => callback());
    }
    return { context, window, document, views, frames, timers,
        frame() { flush(frames); }, task() { flush(timers); },
        setView(name) {
            views.forEach((view, key) => key === name ? view.classList.add('active') : view.classList.remove('active'));
        },
        nextResultsRequest() { requestId += 1; }
    };
}

test('heavy activation runs after the navigation shell has an animation frame', async () => {
    const h = harness();
    let activated = false;
    const result = h.window.AppEntry.scheduleViewActivation('overview', () => { activated = true; return 42; });
    assert.equal(activated, false);
    h.frame();
    assert.equal(activated, false, 'hydration must not block the animation frame itself');
    h.task();
    assert.equal(await result, 42);
    assert.equal(activated, true);
});

test('newer navigation cancels both frame-waiting and task-waiting work and settles callers', async () => {
    for (const afterFrame of [false, true]) {
        const h = harness();
        let activations = 0;
        const result = h.window.AppEntry.scheduleViewActivation('overview', () => { activations += 1; });
        if (afterFrame) h.frame();
        h.window.__markAppNavigationIntent();
        assert.equal(await result, false);
        assert.equal(h.frames.size, 0);
        assert.equal(h.timers.size, 0);
        h.frame(); h.task();
        assert.equal(activations, 0);
    }
});

test('browse activation cannot overwrite a search or pending category intent submitted before hydration', async () => {
    for (const change of ['request', 'pending-filter']) {
        const h = harness();
        h.setView('browse');
        let activations = 0;
        const result = h.window.AppEntry.scheduleViewActivation('browse', () => { activations += 1; });
        if (change === 'request') h.nextResultsRequest();
        else h.window.__pendingBrowseFilter = { category: 'P2' };
        h.frame(); h.task();
        assert.equal(await result, false);
        assert.equal(activations, 0);
    }
});

test('cold browse runtime counter initialization does not cancel its queued first refresh', async () => {
    const h = harness();
    h.setView('browse');
    delete h.window.__getBrowseResultsRequestId;
    let activations = 0;
    const result = h.window.AppEntry.scheduleViewActivation('browse', () => { activations += 1; return true; });
    h.window.__getBrowseResultsRequestId = () => 0;
    h.frame(); h.task();
    assert.equal(await result, true);
    assert.equal(activations, 1);
});

test('a foreground request created during cold runtime loading still cancels queued browse refresh', async () => {
    const h = harness();
    h.setView('browse');
    delete h.window.__getBrowseResultsRequestId;
    let activations = 0;
    const result = h.window.AppEntry.scheduleViewActivation('browse', () => { activations += 1; });
    h.window.__getBrowseResultsRequestId = () => 1;
    h.frame(); h.task();
    assert.equal(await result, false);
    assert.equal(activations, 0);
});

test('fallback sidebar navigation updates the active panel immediately and hydrates only the latest view', async () => {
    const h = harness();
    load('js/boot-fallbacks.js', h.context);
    let browseActivations = 0;
    let practiceActivations = 0;
    h.window.activateBrowseView = () => { browseActivations += 1; return true; };
    h.window.startPracticeRecordsSyncInBackground = () => { practiceActivations += 1; };
    const browse = h.window.showView('browse', false);
    assert.equal(h.views.get('browse').classList.contains('active'), true);
    assert.equal(browseActivations, 0);
    h.window.showView('practice', false);
    assert.equal(await browse, false);
    h.frame(); h.task();
    assert.equal(browseActivations, 0);
    assert.equal(practiceActivations, 1);
});

test('app navigation preserves shell paint and repeated clicks reschedule a cancelled activation', async () => {
    const h = harness();
    load('js/app.js', h.context);
    const app = vm.runInContext('new ExamSystemApp()', h.context);
    const activations = [];
    app.onViewActivated = (viewName) => activations.push(viewName);
    app.navigateToView('practice');
    app.navigateToView('practice');
    assert.equal(h.views.get('practice').classList.contains('active'), true);
    assert.deepEqual(activations, []);
    h.frame(); h.task();
    await Promise.resolve();
    assert.deepEqual(activations, ['practice']);
});

test('hidden tabs do not wait indefinitely for a suspended animation frame', async () => {
    const h = harness();
    h.document.hidden = true;
    const result = h.window.AppEntry.scheduleViewActivation('overview', () => 7);
    assert.equal(h.frames.size, 0);
    h.task();
    assert.equal(await result, 7);
});

test('practice module completion after navigation cannot rerender a hidden practice panel', async () => {
    const h = harness();
    load('js/app.js', h.context);
    const app = vm.runInContext('new ExamSystemApp()', h.context);
    let releaseModules;
    const modules = new Promise((resolve) => { releaseModules = resolve; });
    let recordsSyncs = 0;
    h.window.ensureBrowseGroup = () => Promise.resolve(true);
    h.window.ensurePracticeSuiteReady = () => modules;
    h.window.ensurePracticeRecordsSync = () => { recordsSyncs += 1; };
    app.refreshOverviewData = () => {};
    app.navigateToView('practice');
    h.frame(); h.task();
    for (let round = 0; round < 4; round++) await Promise.resolve();
    app.navigateToView('overview');
    releaseModules(true);
    for (let round = 0; round < 8; round++) await Promise.resolve();
    assert.equal(recordsSyncs, 0);
});

test('repeated practice navigation during cold module hydration retains a replacement activation', async () => {
    const h = harness();
    load('js/app.js', h.context);
    const app = vm.runInContext('new ExamSystemApp()', h.context);
    let releaseModules;
    const modules = new Promise((resolve) => { releaseModules = resolve; });
    let recordsSyncs = 0;
    h.window.ensureBrowseGroup = () => Promise.resolve(true);
    h.window.ensurePracticeSuiteReady = () => modules;
    h.window.ensurePracticeRecordsSync = () => { recordsSyncs += 1; return Promise.resolve(true); };
    app.navigateToView('practice');
    h.frame(); h.task();
    for (let round = 0; round < 8; round++) await Promise.resolve();
    assert.ok(app._pendingViewActivation, 'activation remains pending while its modules hydrate');
    app.navigateToView('practice');
    h.frame(); h.task();
    for (let round = 0; round < 8; round++) await Promise.resolve();
    releaseModules(true);
    for (let round = 0; round < 16; round++) await Promise.resolve();
    assert.equal(recordsSyncs, 1, 'the latest navigation must synchronize records exactly once');
    assert.equal(app._pendingViewActivation, null);
});
