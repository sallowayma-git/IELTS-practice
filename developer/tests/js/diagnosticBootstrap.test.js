import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness, read } from './helpers/diagnosticHarness.js';
import { prepareStartupEnrichmentAtCapacity } from './helpers/diagnosticCapacity.js';

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

test('initialization keeps recovery available for component timeouts and network failures alongside diagnostics', () => {
    for (const [message, expected] of [
        ['组件加载超时: PRIVATE_DETAIL', true],
        ['网络连接失败: PRIVATE_DETAIL', true],
        ['依赖缺失: PRIVATE_DETAIL', false],
        ['依赖检查失败: 网络不可用 PRIVATE_DETAIL', false],
        ['未知错误: PRIVATE_DETAIL', false]
    ]) {
        const h = harness();
        h.sandbox.AppDiagnostics = h.collector;
        h.run('js/app.js');
        let canRecover;
        const messages = [];
        h.evaluate('ExamSystemApp.prototype.handleInitializationError').call({
            showUserMessage(text) { messages.push(text); },
            showFallbackUI(value) { canRecover = value; }
        }, new Error(message));
        assert.equal(canRecover, expected, message);
        const exported = JSON.parse(h.collector.exportText());
        assert.equal(exported.events.length, 1);
        assert.equal(exported.events[0].code, 'APP_BOOT_FAILED');
        assert.ok(h.document.getElementById('diagnostic-startup-failure'));
        assert.equal(JSON.stringify({ messages, exported }).includes('PRIVATE_DETAIL'), false);
    }
});

test('initialization recovery classification tolerates missing, non-string and hostile error messages', () => {
    let reads = 0;
    for (const error of [null, undefined, '网络', { message: 42 },
        { get message() { reads += 1; throw new Error('PRIVATE'); } }]) {
        const h = harness();
        h.sandbox.AppDiagnostics = h.collector;
        h.run('js/app.js');
        let canRecover;
        assert.doesNotThrow(() => h.evaluate('ExamSystemApp.prototype.handleInitializationError').call({
            showUserMessage() { throw new Error('optional UI unavailable'); },
            showFallbackUI(value) { canRecover = value; }
        }, error));
        assert.equal(canRecover, false);
        assert.equal(h.collector.snapshot().events[0].code, 'APP_BOOT_FAILED');
    }
    assert.equal(reads, 0);
});

test('successful startup keeps incident exports available without a blocking alert and restores the alert on another failure', () => {
    const h = harness();
    const first = h.collector.startupFailed(new Error('PRIVATE_FIRST'));
    const panel = h.document.getElementById('diagnostic-startup-failure');
    assert.equal(panel.style.position, 'fixed');
    assert.equal(panel.getAttribute('role'), 'alert');
    h.collector.markReady();
    assert.equal(panel.style.position, 'static');
    assert.equal(panel.getAttribute('role'), 'region');
    assert.equal(panel.children[0].textContent, '启动故障记录');
    assert.ok(panel.children.some((node) => node.textContent?.includes(first)));
    assert.equal(JSON.parse(h.collector.exportText(first)).events[0].eventId, first);
    const details = panel.children.find((node) => node.tagName === 'details');
    details.open = true;
    details.emit('toggle');
    assert.equal(JSON.parse(details.children[1].value).events[0].eventId, first);

    const second = h.collector.startupFailed(new Error('PRIVATE_SECOND'));
    assert.equal(h.document.getElementById('diagnostic-startup-failure'), panel);
    assert.equal(panel.style.position, 'fixed');
    assert.equal(panel.getAttribute('role'), 'alert');
    assert.equal(panel.children[0].textContent, '应用启动失败');
    assert.ok(panel.children.some((node) => node.textContent?.includes(second)));
    assert.equal(JSON.parse(details.children[1].value).events[0].eventId, second);
    assert.equal(h.collector.getIncident(first).eventId, first);
    assert.equal(h.collector.exportText().includes('PRIVATE'), false);
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

for (const early of [false, true]) {
    test(`console-first startup enrichment retains evidence at the byte limit with ${early ? 'deferred' : 'immediate'} panel rendering`, async () => {
        const h = harness({ early });
        const c = h.collector;
        const { error, first, before } = prepareStartupEnrichmentAtCapacity(c);
        const initial = c.snapshot().events;
        assert.equal(initial[0].eventId, first.eventId, 'the console record is the oldest retained event');
        assert.equal(first.collection.source, 'console');
        assert.ok(initial.slice(1).every((event) => event.notification.kind === 'persistent'));
        assert.equal(before.dropped, 0);
        assert.ok(before.events < 200);
        assert.ok(before.bytes >= 256 * 1024 - 4096 && before.bytes <= 256 * 1024);

        const id = c.startupFailed(error);
        assert.equal(id, first.eventId);
        const enriched = c.getIncident(id);
        assert.ok(enriched, 'the panel incident must survive trimming during enrichment');
        assert.equal(enriched.sequence, first.sequence);
        assert.equal(enriched.timestamp, first.timestamp);
        assert.ok(enriched.breadcrumbs.length > first.breadcrumbs.length);
        assert.equal(c.getIncident(initial[1].eventId), null, 'an unpinned critical event is evicted instead');
        assert.ok(c.status().dropped > 0, 'the enrichment crosses the byte limit');
        if (early) {
            assert.equal(h.document.getElementById('diagnostic-startup-failure'), null);
            h.document.body = h.element('body');
            h.emit('document:DOMContentLoaded');
        }
        const panel = h.document.getElementById('diagnostic-startup-failure');
        assert.ok(panel.children.some((node) => node.textContent?.includes(id)));
        const exported = JSON.parse(c.exportText()).events[0];
        assert.equal(JSON.parse(c.exportText(id)).events[0].eventId, id);
        const assertBounds = () => {
            assert.ok(c.status().events <= 200);
            assert.ok(c.status().bytes <= 256 * 1024);
            assert.equal(c.status().bytes, c.snapshot().events.reduce((size, event) => size + Buffer.byteLength(JSON.stringify(event)), 0));
            assert.ok(Buffer.byteLength(c.exportText()) <= 32 * 1024);
        };
        assertBounds();
        const delivered = [];
        c.attachSink({ async append(events) { delivered.push(...events); return { persistence: 'persisted' }; } });
        await c.flush();
        for (const event of [enriched, exported, c.getIncident(id), delivered.find((item) => item.eventId === id)]) {
            assert.ok(event);
            assert.equal(event.eventId, id);
            assert.equal(event.code, 'APP_BOOT_FAILED');
            assert.equal(event.causeCode, 'BACKEND_UNAVAILABLE');
            assert.equal(event.collection.source, 'business');
            assert.equal(event.notification.kind, 'startup');
        }
        assert.equal(c.getIncident(id).persistence.diagnostics, 'persisted');
        assertBounds();
    });
}

for (const code of ['APP_BOOT_FAILED', 'PRACTICE_SAVE_FAILED']) {
    for (const delivery of ['queued', 'persisted', 'in-flight']) {
        test(`console-first ${code} enriches the same incident when ${delivery}`, async () => {
            const h = harness();
            h.run('js/diagnostics/diagnosticReporter.js');
            h.run('js/utils/logger.js');
            const error = Object.assign(new Error('PRIVATE_DETAIL'), { name: 'AppDataError', code: 'BACKEND_UNAVAILABLE' });
            h.sandbox.console.error('[AppData v2] initialization blocked:', error);
            const first = h.collector.snapshot().events[0];
            assert.equal(first.collection.source, 'console');
            const batches = [];
            let finish;
            const sink = { append(events) {
                batches.push(events);
                return new Promise((resolve) => { finish = resolve; });
            } };
            if (delivery !== 'queued') {
                h.collector.attachSink(sink);
                await Promise.resolve();
                if (delivery === 'persisted') {
                    finish({ persistence: 'persisted' });
                    await h.collector.flush();
                }
            }
            const id = code === 'APP_BOOT_FAILED' ? h.collector.startupFailed(error)
                : h.collector.report({ code, module: 'practice', action: 'save', error,
                    notification: { kind: 'persistent' }, persistence: { operation: 'not-committed' } });
            assert.equal(id, first.eventId);
            const enriched = h.collector.getIncident(id);
            assert.equal(enriched.sequence, first.sequence);
            assert.equal(enriched.timestamp, first.timestamp);
            assert.equal(enriched.code, code);
            assert.equal(enriched.causeCode, 'BACKEND_UNAVAILABLE');
            assert.equal(enriched.collection.source, 'business');
            assert.equal(enriched.notification.kind, code === 'APP_BOOT_FAILED' ? 'startup' : 'persistent');
            assert.equal(enriched.persistence.diagnostics, 'memory-only', 'old delivery never confirms the new classification');
            assert.notEqual(enriched.fingerprint, first.fingerprint);
            assert.equal(JSON.parse(h.collector.exportText(id)).events[0].code, code);
            if (code === 'APP_BOOT_FAILED') {
                assert.ok(h.document.getElementById('diagnostic-startup-failure').children.some((node) => node.textContent?.includes(id)));
            }
            h.sandbox.console.error('[App] propagated failure:', error);
            h.emit('unhandledrejection', { reason: error });
            assert.equal(h.collector.getIncident(id), enriched, 'generic propagation cannot downgrade the business record');
            assert.equal(h.collector.snapshot().events.length, 1);
            assert.equal(h.collector.status().bytes, Buffer.byteLength(JSON.stringify(enriched)));
            if (delivery === 'queued') h.collector.attachSink(sink);
            if (delivery === 'in-flight') {
                finish({ persistence: 'persisted' });
                // Let the old append settle and the enriched version enter the next batch.
                for (let i = 0; i < 10 && batches.length < 2; i += 1) await Promise.resolve();
            } else await Promise.resolve();
            assert.equal(batches.length, delivery === 'queued' ? 1 : 2);
            assert.equal(batches.at(-1)[0].eventId, id);
            assert.equal(batches.at(-1)[0].code, code);
            assert.equal(h.collector.getIncident(id).persistence.diagnostics, 'pending');
            finish({ persistence: 'persisted' });
            await h.collector.flush();
            assert.equal(h.collector.getIncident(id).persistence.diagnostics, 'persisted');
            assert.equal(h.collector.getIncident(id).code, code);
            assert.equal(h.collector.exportText(id).includes('PRIVATE_DETAIL'), false);
        });
    }
}

test('a business boundary refines automatic startup classification while retaining its location and identity', () => {
    const h = harness();
    const error = new Error('private');
    h.emit('error', { target: h.sandbox, error,
        filename: 'file:///private/js/bundles/core-foundation.bundle.js', lineno: 17, colno: 9 });
    const first = h.collector.snapshot().events[0];
    assert.equal(first.collection.source, 'bootstrap');
    const id = h.collector.startupFailed(error);
    const confirmed = h.collector.getIncident(id);
    assert.equal(id, first.eventId);
    assert.equal(confirmed.code, 'APP_BOOT_FAILED');
    assert.equal(confirmed.collection.source, 'business');
    assert.equal(confirmed.module, 'main');
    assert.deepEqual(confirmed.resource, first.resource);
    h.collector.report({ error });
    h.emit('unhandledrejection', { reason: error });
    assert.equal(h.collector.getIncident(id), confirmed);
});

test('a confirmed startup failure promotes console evidence withheld during sink delivery', async () => {
    const h = harness();
    const batches = [];
    let finish;
    h.collector.attachSink({ append(events) {
        batches.push(events);
        return batches.length === 1 ? new Promise((resolve) => { finish = resolve; }) : { persistence: 'persisted' };
    } });
    h.collector.report({ error: new Error('unrelated') });
    await Promise.resolve();
    const error = new Error('startup');
    h.collector.captureConsole('error', [error]);
    const id = h.collector.startupFailed(error);
    finish({ persistence: 'persisted' });
    await h.collector.flush();
    assert.equal(batches.length, 2);
    assert.equal(batches[1][0].eventId, id);
    assert.equal(batches[1][0].code, 'APP_BOOT_FAILED');
    assert.equal(h.collector.getIncident(id).persistence.diagnostics, 'persisted');
});

test('native AbortError rejections remain noncritical without reading overridden properties', () => {
    const h = harness();
    let reads = 0;
    for (const overridden of [false, true]) {
        const error = new DOMException('PRIVATE_ABORT', 'AbortError');
        if (overridden) Object.defineProperty(error, 'name', { get() { reads += 1; throw new Error('private'); } });
        h.emit('unhandledrejection', { reason: error });
        const event = h.collector.snapshot().events.at(-1);
        assert.equal(event.code, 'UNEXPECTED_RUNTIME_ERROR');
        assert.equal(event.notification.kind, 'none');
    }
    assert.equal(reads, 0);
    assert.equal(h.document.getElementById('diagnostic-startup-failure'), null);
    assert.equal(h.collector.exportText().includes('PRIVATE_ABORT'), false);
});

test('forged DOMExceptions and hostile rejection getters cannot hide startup failures', () => {
    let reads = 0;
    const hostile = { get name() { reads += 1; return 'AbortError'; },
        get [Symbol.toStringTag]() { reads += 1; return 'DOMException'; } };
    const proxy = new Proxy({}, { get() { reads += 1; throw new Error('private'); } });
    for (const error of [new DOMException('private', 'SecurityError'), Object.create(DOMException.prototype), hostile, proxy]) {
        const h = harness();
        h.emit('unhandledrejection', { reason: error });
        assert.equal(h.collector.snapshot().events[0].code, 'APP_BOOT_FAILED');
        assert.ok(h.document.getElementById('diagnostic-startup-failure'));
    }
    assert.equal(reads, 0);
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

test('repeated immutable snapshots avoid sanitization serialization and bootstrap export sizes incrementally', () => {
    const h = harness();
    h.evaluate(`globalThis.__diagnosticSerializationCount = 0;
        const originalDiagnosticStringify = JSON.stringify;
        JSON.stringify = function (...args) {
            globalThis.__diagnosticSerializationCount++;
            return originalDiagnosticStringify.apply(this, args);
        };`);
    const ids = [];
    for (let i = 0; i < 40; i++) {
        ids.push(h.collector.report({ code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'save',
            error: new Error('private answer must be redacted'), newOccurrence: true }));
    }
    const before = h.evaluate('__diagnosticSerializationCount');
    const current = h.collector.snapshot();
    for (let i = 0; i < 20; i++) {
        const again = h.collector.snapshot();
        assert.equal(again.events[0], current.events[0], 'Unchanged validated event objects may be shared');
        assert.equal(again.events.at(-1), h.collector.getIncident(ids.at(-1)));
    }
    assert.equal(h.evaluate('__diagnosticSerializationCount'), before,
        'Snapshotting trusted events must not reconstruct or serialize them');
    const chosen = current.events.find(event => event.eventId === ids[0]);
    const ordered = current.events.filter(event => event !== chosen).reverse();
    ordered.unshift(chosen);
    const expected = { schemaVersion: 1, persistence: current.persistence, coverage: 'partial',
        entryCoverage: current.entryCoverage, truncated: current.truncated,
        notice: 'Local diagnostics; not an answer backup.', events: [] };
    for (const event of ordered) {
        expected.events.push(event);
        if (Buffer.byteLength(JSON.stringify(expected), 'utf8') > 32 * 1024 - 32) {
            expected.events.pop(); expected.truncated = true; break;
        }
    }
    const text = h.collector.exportText(ids[0]);
    assert.equal(text, JSON.stringify(expected), 'Incremental sizing must preserve exact bounded export contents');
    assert.equal(h.evaluate('__diagnosticSerializationCount') - before, 2,
        'Export should serialize its envelope and final report once each');
    assert.ok(Buffer.byteLength(text, 'utf8') <= 32 * 1024);
    assert.equal(h.collector.status().bytes,
        current.events.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event), 'utf8'), 0));
});
