import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness, read } from './helpers/diagnosticHarness.js';

test('generated inline collector precedes every external dependency and preserves early IDs at handoff', async () => {
    const html = read('index.html');
    const inline = /<script>\s*([\s\S]*?)<\/script>/.exec(html);
    assert.ok(inline.index < html.indexOf('<link'));
    const h = harness({ install: false, early: true });
    h.evaluate(inline[1]);
    const c = h.sandbox.AppDiagnosticBootstrap.install();
    const failure = new Error('private answer');
    h.emit('error', { target: h.sandbox, error: failure, filename: 'https://private.internal/app/js/bundles/core-foundation.bundle.js?token=secret', lineno: 15, colno: 4 });
    const early = c.snapshot().events[0];
    assert.equal(early.code, 'APP_BOOT_FAILED');
    assert.equal(early.resource.line, 15);
    assert.equal(early.resource.column, 4);
    assert.match(early.buildId, /^sha256:[a-f0-9]{64}$/);
    h.run('js/diagnostics/diagnosticReporter.js');
    h.run('js/diagnostics/diagnosticReporter.js');
    h.run('js/diagnostics/bootstrapCollector.js');
    assert.equal(h.sandbox.AppDiagnostics, c);
    assert.equal(h.listeners.get('error').length, 1);
    assert.equal(h.listeners.get('error')[0].options, true);
    assert.equal(h.listeners.get('unhandledrejection').length, 1);
    assert.equal(c.report({ error: failure }), early.eventId);
    assert.equal(c.snapshot().events.length, 1);
    const batches = [];
    class Sink { async append(events) { batches.push(...events); return { persistence: 'persisted' }; } }
    const sink = new Sink();
    c.attachSink(sink);
    c.attachSink(sink);
    assert.equal(batches.length, 0, 'delivery is asynchronous');
    assert.equal((await c.flush()).persistence, 'persisted');
    assert.equal(c.getIncident(early.eventId).persistence.diagnostics, 'persisted');
    assert.deepEqual(batches.map((event) => event.eventId), [early.eventId]);
    h.document.body = h.element('body');
    h.emit('document:DOMContentLoaded');
    assert.ok(h.document.getElementById('diagnostic-startup-failure'));
});

test('required resources, bundle parsing and rejected initialization leave exportable evidence', () => {
    for (const kind of ['missing', 'parse', 'rejection', 'caught']) {
        const h = harness();
        let prevented = false;
        const event = { preventDefault() { prevented = true; } };
        if (kind === 'missing') h.emit('error', { ...event, target: { src: 'https://private.internal/js/bundles/core-foundation.bundle.js?token=secret' } });
        if (kind === 'parse') h.emit('error', { ...event, target: h.sandbox, error: new SyntaxError('private'), filename: 'file:///C:/private/js/bundles/core-foundation.bundle.js', lineno: 7 });
        if (kind === 'rejection') h.emit('unhandledrejection', { ...event, reason: new Error('private') });
        if (kind === 'caught') h.collector.startupFailed(new Error('private'));
        assert.equal(prevented, false);
        assert.equal(h.output.length, 0, 'no duplicate console echo');
        const saved = JSON.parse(h.collector.exportText());
        assert.equal(saved.events.length, 1);
        assert.equal(saved.events[0].notification.kind, 'startup');
        assert.equal(saved.events[0].resource.status, 'unknown');
        assert.equal(JSON.stringify(saved).includes('private'), false);
        assert.ok(h.document.getElementById('diagnostic-startup-failure'));
    }
});

test('optional loads are declared before insertion and share identity with capture-phase failure', async () => {
    const h = harness();
    h.run('js/diagnostics/diagnosticReporter.js');
    h.document.head.appendChild = (script) => {
        h.emit('error', { target: script });
        assert.equal(h.collector.snapshot().events.at(-1).resource.optional, true);
        queueMicrotask(() => script.onerror({ message: 'opaque' }));
    };
    h.run('js/runtime/lazyLoader.js');
    h.sandbox.AppLazyLoader.markProvided(['assets/generated/reading-exams/manifest.js']);
    await h.sandbox.AppLazyLoader.ensureGroup('exam-data');
    assert.equal(h.collector.snapshot().events.length, 1);
    assert.equal(h.collector.snapshot().events[0].notification.kind, 'none');
    assert.equal(h.document.getElementById('diagnostic-startup-failure'), null);
    // Syntax errors in optional scripts have a Window target and still use the declaration.
    h.emit('error', { target: h.sandbox, error: new SyntaxError('private'), filename: 'assets/generated/listening-exams/manifest.js' });
    assert.equal(h.collector.snapshot().events.at(-1).notification.kind, 'none');
});

test('a required lazy failure after startup records resource and persistent impact without inventing status', async () => {
    const h = harness();
    h.run('js/diagnostics/diagnosticReporter.js');
    h.collector.markReady();
    h.document.head.appendChild = (script) => {
        h.emit('error', { target: script });
        queueMicrotask(() => script.onerror({}));
    };
    h.run('js/runtime/lazyLoader.js');
    await assert.rejects(h.sandbox.AppLazyLoader.ensureGroup('theme-tools'));
    const events = h.collector.snapshot().events;
    assert.equal(events.length, 1);
    assert.equal(events[0].resource.path, 'js/bundles/theme.bundle.js');
    assert.equal(events[0].resource.optional, false);
    assert.equal(events[0].resource.status, 'unknown');
    assert.equal(events[0].notification.kind, 'persistent');
});

test('cancellation and semantic breadcrumbs stay noncritical and sanitized', () => {
    const h = harness();
    h.collector.breadcrumb({ action: 'import', outcome: 'cancelled', module: 'import', text: 'private' });
    h.collector.breadcrumb({ action: 'keypress', text: 'private' });
    const id = h.collector.report({ error: new Error('private'), cancelled: true, notification: { kind: 'startup' } });
    const event = h.collector.getIncident(id);
    assert.equal(event.notification.kind, 'none');
    assert.equal(event.breadcrumbs.length, 1);
    assert.equal(event.breadcrumbs[0].outcome, 'cancelled');
    assert.equal(h.document.getElementById('diagnostic-startup-failure'), null);
    const abort = new Error('private');
    abort.name = 'AbortError';
    h.emit('unhandledrejection', { reason: abort });
    assert.equal(h.collector.snapshot().events.at(-1).notification.kind, 'none');
});

test('storms respect event and byte limits, prefer critical evidence, and bound text export', () => {
    const h = harness();
    const critical = h.collector.startupFailed(new Error('startup'));
    for (let i = 0; i < 400; i += 1) h.collector.report({ error: new Error('noise') });
    assert.ok(h.collector.status().events <= 200);
    assert.ok(h.collector.status().bytes <= 256 * 1024);
    assert.ok(h.collector.getIncident(critical));
    for (let i = 0; i < 50; i += 1) h.collector.breadcrumb({ action: 'submit', correlation: { session: 'secret' + i } });
    for (let i = 0; i < 400; i += 1) h.collector.report({ error: new Error('heavy'), notification: { kind: 'persistent' } });
    const snapshot = h.collector.snapshot();
    assert.ok(snapshot.events.length < 200, 'byte limit is independently exercised');
    assert.ok(h.collector.status().bytes <= 256 * 1024);
    assert.equal(h.collector.status().bytes, snapshot.events.reduce((size, event) => size + Buffer.byteLength(JSON.stringify(event)), 0));
    assert.ok(Buffer.byteLength(h.collector.exportText()) <= 32 * 1024);
    assert.equal(JSON.parse(h.collector.exportText()).truncated, true);
    assert.ok(h.collector.getIncident(critical), 'the visible startup reference retains its exportable evidence');
    assert.equal(JSON.parse(h.collector.exportText()).events[0].eventId, critical);
    assert.equal(snapshot.truncated, true);
});

test('sink rejection is isolated, suspends automatic retries and permits explicit retry', async () => {
    const h = harness();
    let calls = 0;
    const sink = { async append() { calls += 1; throw new Error('sink failure'); } };
    h.collector.attachSink(sink);
    const id = h.collector.report({ code: 'PRACTICE_SAVE_FAILED', error: new Error('business') });
    assert.equal(typeof id, 'string');
    assert.equal((await h.collector.flush()).persistence, 'failed');
    h.collector.report({ error: new Error('next business') });
    await h.collector.flush();
    h.collector.attachSink(sink);
    assert.equal(calls, 1);
    h.collector.retrySink();
    await h.collector.flush();
    assert.equal(calls, 2);
    assert.equal(h.collector.snapshot().events.length, 2);
});

test('hung sink retains one bounded batch while storms evict only non-flight records', async () => {
    const h = harness();
    let finish;
    const batches = [];
    h.collector.attachSink({ append(events) { batches.push(events); return new Promise((resolve) => { finish = resolve; }); } });
    for (let i = 0; i < 30; i += 1) h.collector.report({ error: new Error('first') });
    await Promise.resolve();
    for (let i = 0; i < 400; i += 1) h.collector.report({ error: new Error('later') });
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 20);
    assert.ok(batches[0].every((event) => h.collector.getIncident(event.eventId)));
    assert.ok(h.collector.status().events <= 200);
    assert.ok(h.collector.status().bytes <= 256 * 1024);
    finish({ persistence: 'failed' });
    await h.collector.flush();
});

test('fallback DOM and file export failures do not recursively report or lose text access', () => {
    const h = harness();
    h.collector.startupFailed(new Error('private'));
    h.sandbox.URL = { createObjectURL() { throw new Error('download denied'); } };
    h.nodes.find((node) => node.tagName === 'button').click();
    const text = h.nodes.find((node) => node.tagName === 'textarea');
    assert.ok(text.focused && text.selected);
    assert.equal(JSON.parse(text.value).events.length, 1);
    const broken = harness();
    broken.document.createElement = () => { throw new Error('DOM unavailable'); };
    assert.doesNotThrow(() => broken.collector.startupFailed(new Error('private')));
    assert.equal(broken.collector.status().fallbackFailed, true);
    assert.equal(broken.collector.snapshot().events.length, 1);
    assert.equal(JSON.parse(broken.collector.exportText()).events.length, 1);
    assert.equal(broken.output.length, 0);
});

test('hostile report inputs cannot invoke arbitrary getters or leak raw values', () => {
    const h = harness();
    let reads = 0;
    const input = { get error() { reads += 1; throw new Error('secret'); }, answers: 'secret' };
    assert.doesNotThrow(() => h.collector.report(input));
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('secret'); } });
    assert.doesNotThrow(() => h.collector.report(proxy));
    assert.equal(reads, 0);
    assert.equal(h.collector.exportText().includes('secret'), false);
});

test('AppLogger preserves calls and display preferences while capturing filtered critical errors once', async () => {
    const h = harness();
    h.run('js/diagnostics/diagnosticReporter.js');
    h.run('js/utils/logger.js');
    const logger = h.sandbox.AppLogger;
    const error = new Error('PRIVATE_ANSWER');
    const id = h.collector.report({ code: 'PRACTICE_SAVE_FAILED', error });
    logger.shouldLog = () => false;
    logger.createScope('PracticeRecorder').error('PRIVATE_ANSWER', error, { answers: 'PRIVATE_ANSWER' });
    h.sandbox.console.error('[PracticeRecorder] private', error);
    h.emit('error', { target: h.sandbox, error });
    assert.equal(h.collector.snapshot().events.length, 1);
    assert.equal(h.collector.getIncident(id).code, 'PRACTICE_SAVE_FAILED');
    h.sandbox.console.error('raw private', { answers: 'PRIVATE_ANSWER' });
    assert.equal(h.output.at(-1).args[0], 'raw private', 'uncategorized console passes through');
    assert.equal(h.collector.snapshot().events.length, 2);
    assert.equal(h.collector.exportText().includes('PRIVATE_ANSWER'), false);
    logger.shouldLog = () => { throw new Error('logger failed'); };
    assert.doesNotThrow(() => logger.error('System', new Error('fresh')));
    logger.nativeConsole.error = () => { throw new Error('console failed'); };
    assert.doesNotThrow(() => h.sandbox.console.error('raw'));
    await Promise.resolve();
});

test('sink/logger feedback is finite and async console evidence stays in memory', async () => {
    const h = harness();
    h.run('js/diagnostics/diagnosticReporter.js');
    h.run('js/utils/logger.js');
    let calls = 0;
    h.collector.attachSink({ async append() {
        calls += 1;
        h.sandbox.console.error('synchronous sink detail');
        h.collector.startupFailed(new Error('internal sink failure'));
        await Promise.resolve();
        h.sandbox.console.error('asynchronous sink detail');
        return { persistence: 'persisted' };
    } });
    h.collector.report({ error: new Error('business') });
    assert.equal((await h.collector.flush()).persistence, 'memory-only');
    assert.equal(calls, 1);
    assert.equal(h.collector.snapshot().events.length, 2);
    assert.equal(h.document.getElementById('diagnostic-startup-failure'), null);
});

test('diagnostic persistence requires sink confirmation and never changes business save state', async () => {
    const h = harness();
    const id = h.collector.report({ code: 'PRACTICE_SAVE_FAILED',
        persistence: { operation: 'committed', diagnostics: 'persisted' } });
    assert.equal(h.collector.getIncident(id).persistence.diagnostics, 'memory-only');
    let finish;
    h.collector.attachSink({ append() { return new Promise((resolve) => { finish = resolve; }); } });
    await Promise.resolve();
    assert.equal(h.collector.getIncident(id).persistence.diagnostics, 'pending');
    finish({ persistence: 'persisted' });
    await h.collector.flush();
    assert.equal(h.collector.getIncident(id).persistence.diagnostics, 'persisted');
    assert.equal(h.collector.getIncident(id).persistence.operation, 'committed');
});

test('redeclaration of a reused element creates a distinct resource failure attempt', () => {
    const h = harness();
    const script = { src: 'js/bundles/theme.bundle.js' };
    h.collector.declareResource(script, { url: script.src, optional: false });
    h.emit('error', { target: script });
    const first = h.collector.snapshot().events[0];
    h.collector.declareResource(script, { url: script.src, optional: false });
    h.emit('error', { target: script });
    const second = h.collector.snapshot().events[1];
    assert.notEqual(first.eventId, second.eventId);
    assert.equal(first.fingerprint, second.fingerprint);
});

test('directory entry URLs retain the correct root or subpath run mode', () => {
    for (const [pathname, expected] of [['/', 'http'], ['/index.html', 'http'], ['/IELTS-practice/', 'subpath']]) {
        const h = harness({ install: false });
        h.sandbox.location.pathname = pathname;
        const c = h.sandbox.AppDiagnosticBootstrap.install({ context: 'main' });
        const id = c.report({ error: new Error('test') });
        assert.equal(c.getIncident(id).environment.runMode, expected);
    }
});
