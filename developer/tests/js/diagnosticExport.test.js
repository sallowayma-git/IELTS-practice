import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, read } from './helpers/diagnosticHarness.js';

const plain = (value) => JSON.parse(JSON.stringify(value));
const size = (value) => Buffer.byteLength(value);
function fixture({ install = false, context = 'main', timeoutMs = 30 } = {}) {
    const h = harness({ install });
    h.run('js/diagnostics/diagnosticExport.js');
    const contract = h.sandbox.AppDiagnosticContract;
    const normalizer = contract.createNormalizer({ environment: { context, runMode: 'file' } });
    return { ...h, contract, normalizer, make: (input = {}) => normalizer.normalize(input),
        exporter: (options = {}) => h.sandbox.AppDiagnosticExport.create({ context, timeoutMs, ...options }) };
}
function source(events, extra = {}) {
    return { snapshot() { return { schemaVersion: 1, events, persistence: 'memory-only', coverage: 'partial', truncated: false, ...extra }; } };
}
function storage(extra = {}) {
    return { persistence: 'persisted', enabled: true, suspended: false, generation: 'dg-' + '1'.repeat(32),
        cutoff: -1, phase: 'active', failure: null, coverage: 'complete', pendingEvents: 0, pendingBytes: 0, dropped: 0, ...extra };
}

test('merges bootstrap, memory and durable identities; keeps specific classification and origin sequence despite clock skew', async () => {
    const h = fixture();
    const first = h.make({ code: 'PRACTICE_SAVE_FAILED', collection: { source: 'business' } });
    const second = h.make();
    const early = { ...first, code: 'UNEXPECTED_RUNTIME_ERROR', collection: { source: 'console' } };
    const pending = { ...first, persistence: { ...first.persistence, diagnostics: 'pending' } };
    const durable = { ...first, persistence: { ...first.persistence, diagnostics: 'persisted' } };
    const reporter = source([pending, { ...second, timestamp: first.timestamp - 10000 }]);
    const before = JSON.stringify(reporter.snapshot());
    const api = h.exporter({ reporter, bootstrap: source([early]), store: source([durable], { persistence: 'persisted', storage: storage() }) });
    const report = await api.snapshot();
    assert.equal(report.events.length, 2);
    assert.deepEqual(plain(report.timeline.windows[0].eventIds), [first.eventId, second.eventId]);
    assert.equal(report.events[0].code, 'PRACTICE_SAVE_FAILED');
    assert.equal(report.events[0].persistence.diagnostics, 'pending');
    assert.equal(report.persistence, 'pending');
    assert.match(report.timeline.ordering, /not synchronized/);
    assert.equal(report.collection.aggregation, 'incomplete');
    assert.equal((await api.getIncident(first.eventId)).eventId, first.eventId);
    assert.deepEqual(plain(await api.snapshot()), plain(report));
    assert.equal(JSON.stringify(reporter.snapshot()), before);
    assert.ok(Object.isFrozen(report) && Object.isFrozen(report.events[0]) && Object.isFrozen(report.timeline.windows[0].eventIds));
});

test('incident lookup includes bounded alias-related windows and nearby origin context without unrelated history', async () => {
    const h = fixture();
    const chosen = h.make({ correlation: { session: 'PRIVATE_SESSION', operation: 'PRIVATE_OPERATION' }, code: 'PRACTICE_SAVE_FAILED' });
    const child = h.contract.createNormalizer({ environment: { context: 'reading' } });
    const related = Array.from({ length: 60 }, () => child.normalize({ correlationAliases: chosen.correlation }));
    const unrelated = child.normalize({ correlation: { session: 'different' } });
    const report = await h.exporter({ reporter: source([chosen]), store: source([...related, unrelated]) }).snapshot({ eventId: chosen.eventId });
    assert.equal(report.events.length, 51);
    assert.equal(report.selection.found, true);
    assert.equal(report.truncated, true);
    assert.ok(report.events.some((event) => event.eventId === chosen.eventId));
    assert.ok(!report.events.some((event) => event.eventId === unrelated.eventId));
    assert.equal(report.timeline.windows.length, 2);
    assert.ok(!JSON.stringify(report).includes('PRIVATE'));
    const missing = await h.exporter({ reporter: source([chosen]) }).snapshot({ eventId: unrelated.eventId });
    assert.equal(missing.selection.found, false);
    assert.equal(missing.events.length, 0);
    const invalid = await h.exporter({ reporter: source([chosen]) }).exportJSON({ eventId: 'PRIVATE_REFERENCE' });
    assert.equal(invalid.report.events.length, 0);
    assert.ok(!invalid.json.includes('PRIVATE_REFERENCE'));
});

test('export revalidates sensitive legacy events, metadata, causes, stacks, resource and correlation fields', async () => {
    const h = fixture();
    const raw = plain(h.make());
    const secret = 'PRIVATE_答案_TOKEN_IMPORTED_CLIPBOARD';
    const privateUrl = 'https://private.internal/' + secret + '/js/app.js?token=' + secret + '#notes=' + secret;
    raw.answers = secret;
    raw.appVersion = secret;
    raw.buildId = secret;
    raw.error = { name: 'Error', message: secret, stack: [{ path: privateUrl, line: 12, column: 3 }],
        cause: { name: 'Error', message: secret, stack: [{ path: 'C:\\Users\\' + secret + '\\js\\app.js' }] }, details: secret };
    raw.resource = { path: privateUrl, status: 404, optional: false };
    raw.correlation = { scopeId: secret, session: secret, operation: secret };
    raw.environment = { context: secret, browser: secret, platform: secret, userAgent: secret };
    raw.collection = { source: secret, limitations: [secret], issues: [secret], coverage: 'complete' };
    raw.breadcrumbs = [{ action: 'submit', module: 'practice', correlation: { scopeId: secret, session: secret }, answers: secret }];
    const state = storage({ generation: secret, phase: secret, failure: secret, extra: secret });
    const olderSchema = { ...raw, schemaVersion: 0 };
    let getterCalls = 0;
    Object.defineProperty(raw, 'passage', { get() { getterCalls += 1; throw new Error(secret); } });
    const before = JSON.stringify(raw);
    const api = h.exporter({ store: source([raw, olderSchema], { storage: state, persistence: secret, coverage: secret }) });
    const result = await api.exportJSON();
    assert.equal(result.status, 'ready');
    assert.equal(result.report.events.length, 1);
    assert.equal(result.report.sources.persisted.rejected, 1);
    for (const value of [result.json, result.text]) {
        assert.ok(!value.includes(secret));
        assert.ok(!value.includes('private.internal'));
        assert.ok(!value.includes('C:\\Users'));
        assert.ok(!value.includes('token='));
    }
    assert.equal(getterCalls, 0);
    assert.equal(JSON.stringify(raw), before);
    assert.equal(result.report.storage.failure, 'unknown');
});

test('incident context follows semantic breadcrumb aliases across windows without merging scopes', async () => {
    const h = fixture();
    const chosen = h.make({ correlation: { submission: 'PRIVATE_SUBMISSION' } });
    const remote = h.contract.createNormalizer();
    const breadcrumb = remote.normalize({ breadcrumbs: [{ action: 'host-receipt', correlationAliases: chosen.correlation }] });
    const otherScope = remote.normalize({ correlation: { submission: 'PRIVATE_SUBMISSION' } });
    const result = await h.exporter({ reporter: source([chosen]), store: source([breadcrumb, otherScope]) }).snapshot({ eventId: chosen.eventId });
    assert.equal(result.events.length, 2);
    assert.ok(result.events.some((event) => event.eventId === breadcrumb.eventId));
    assert.ok(!result.events.some((event) => event.eventId === otherScope.eventId));
});

test('revoked source arrays and late reads cannot discard page evidence or mutate a returned snapshot', async () => {
    const h = fixture({ timeoutMs: 5 });
    const event = h.make();
    const proxy = Proxy.revocable([], {});
    proxy.revoke();
    const revoked = await h.exporter({ reporter: source([event]), store: source(proxy.proxy) }).snapshot();
    assert.equal(revoked.events[0].eventId, event.eventId);
    assert.equal(revoked.sources.persisted.state, 'failed');
    let finish;
    const api = h.exporter({ reporter: source([event]), store: { snapshot: () => new Promise((resolve) => { finish = resolve; }) } });
    const report = await api.snapshot();
    const before = JSON.stringify(report);
    finish(source([h.make()]).snapshot());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(JSON.stringify(report), before);
    assert.equal(report.sources.persisted.state, 'timed-out');
});

test('environment metadata exposes coarse browser information without the raw agent or URL', async () => {
    const h = fixture();
    h.sandbox.navigator = { userAgent: 'Windows Chrome/123.0.456.78 PRIVATE_AGENT', onLine: false };
    const result = await h.exporter().exportJSON();
    assert.equal(result.report.environment.browser, 'chromium');
    assert.equal(result.report.environment.browserVersion, '123.0.456.78');
    assert.equal(result.report.environment.platform, 'windows');
    assert.equal(result.report.environment.online, 'offline');
    assert.ok(!result.json.includes('PRIVATE_AGENT') && !result.json.includes('private.internal'));
});

test('hostile getters, cycles, proxies and oversized records remain bounded at the export boundary', async () => {
    const h = fixture();
    const event = plain(h.make());
    const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE'); } });
    event.error = { name: 'Error', message: 'PRIVATE'.repeat(20000) };
    event.error.cause = event.error;
    event.error.stack = Array.from({ length: 1000 }, () => ({ path: 'js/app.js', line: 2, column: 4 }));
    let getterCalls = 0;
    Object.defineProperty(event, 'correlation', { get() { getterCalls += 1; throw new Error('PRIVATE'); } });
    const result = await h.exporter({ store: source([event, hostile]) }).exportJSON();
    assert.equal(result.status, 'ready');
    assert.equal(getterCalls, 0);
    assert.equal(result.report.events.length, 1);
    assert.ok(size(JSON.stringify(result.report.events[0])) <= 8192);
    assert.ok(!result.json.includes('PRIVATE'));
});

test('history enforces total JSON and input byte/count limits and keeps the requested incident in a storm', async () => {
    const h = fixture();
    const events = Array.from({ length: 2300 }, () => h.make({ breadcrumbs: Array.from({ length: 50 }, () =>
        ({ action: 'submit', module: 'practice', correlation: { session: 'context' } })) }));
    const api = h.exporter({ store: source(events), reporter: source([events.at(-1)]) });
    const result = await api.exportJSON();
    assert.equal(result.status, 'ready');
    assert.equal(result.report.truncated, true);
    assert.ok(result.report.events.length <= 2000);
    assert.ok(size(result.json) <= h.sandbox.AppDiagnosticExport.LIMITS.bytes);
    assert.ok(size(result.text) <= 8192);
    const incident = await api.snapshot({ eventId: events.at(-1).eventId, limit: 0 });
    assert.equal(incident.events.length, 1);
    assert.equal(incident.events[0].eventId, events.at(-1).eventId);
    assert.equal((await api.snapshot({ limit: 0 })).events.length, 0);
});

for (const failure of ['throw', 'reject', 'timeout', 'invalid']) {
    test(`storage ${failure} leaves a usable bounded current-page report`, async () => {
        const h = fixture({ timeoutMs: 10 });
        const event = h.make();
        let reads = 0;
        const api = h.exporter({ reporter: source([event]), store: { snapshot() {
            reads += 1;
            if (failure === 'throw') throw new Error('PRIVATE');
            if (failure === 'reject') return Promise.reject(new Error('PRIVATE'));
            if (failure === 'timeout') return new Promise(() => {});
            return { events: null };
        } } });
        const result = await api.exportJSON();
        assert.equal(result.report.events[0].eventId, event.eventId);
        assert.equal(result.report.sources.persisted.state, failure === 'timeout' ? 'timed-out' : 'failed');
        assert.equal(reads, 1);
        assert.match(result.text, /not an answer backup/);
        assert.ok(size(result.text) <= 8192 && !result.text.includes('PRIVATE'));
    });
}

test('disabled, failed, pending and truncated storage statuses stay distinct from operation save confirmation', async () => {
    const h = fixture();
    const event = h.make({ persistence: { operation: 'unconfirmed' } });
    for (const [state, expected] of [[storage({ enabled: false, persistence: 'disabled' }), 'disabled'],
        [storage({ failure: 'QUOTA_EXCEEDED', persistence: 'memory-only', coverage: 'partial' }), 'memory-only']]) {
        const result = await h.exporter({ reporter: source([event]), store: source([], { storage: state }) }).exportJSON();
        assert.equal(result.report.persistence, expected);
        assert.equal(result.report.events[0].persistence.operation, 'unconfirmed');
        assert.match(result.text, /operation: unconfirmed/);
    }
    const report = await h.exporter({ store: source([event], { storage: storage({ dropped: 1 }) }) }).snapshot();
    assert.equal(report.truncated, true);
});

test('disconnected practice reports explicitly describe incomplete aggregation without reading the opener business state', async () => {
    for (const context of ['reading', 'listening', 'legacy']) {
        const h = fixture({ context });
        const api = h.exporter({ reporter: source([h.make()]) });
        assert.equal((await api.snapshot()).collection.connection, 'disconnected');
        h.sandbox.opener = { closed: true };
        assert.equal((await api.snapshot()).collection.connection, 'disconnected');
        h.sandbox.opener = { closed: false, get AppData() { throw new Error('must not inspect'); } };
        const report = await api.snapshot();
        assert.equal(report.collection.connection, 'unverified');
        assert.equal(report.collection.aggregation, 'incomplete');
    }
});

test('export only calls passive readers; business writes, probes, active diagnostics and collection are untouched', async () => {
    const h = fixture();
    const calls = [];
    const forbidden = (name) => () => { calls.push(name); throw new Error(name); };
    for (const name of ['AppData', 'SystemDiagnostics', 'AppLazyLoader', 'fetch', 'XMLHttpRequest', 'WebSocket', 'open', 'close', 'postMessage']) {
        Object.defineProperty(h.sandbox, name, { get: forbidden(name) });
    }
    h.sandbox.navigator = { sendBeacon: forbidden('telemetry') };
    h.sandbox.location.reload = forbidden('reload');
    const reader = { ...source([h.make()]), flush: forbidden('flush'), retry: forbidden('retry'), append: forbidden('append'),
        report: forbidden('report'), clear: forbidden('clear'), setEnabled: forbidden('setEnabled') };
    const api = h.exporter({ reporter: reader, store: reader });
    const before = JSON.stringify(reader.snapshot());
    const one = await api.exportJSON();
    const two = await api.exportJSON();
    assert.equal(one.json, two.json);
    assert.equal(JSON.stringify(reader.snapshot()), before);
    assert.deepEqual(calls, []);
    assert.equal(h.sandbox.AppDiagnosticBootstrap.current(), null);
    assert.equal(h.listeners.size, 0);
});

test('clipboard denial, missing support and timeout return selectable text without reading clipboard data', async () => {
    const h = fixture({ timeoutMs: 5 });
    const api = h.exporter({ reporter: source([h.make()]) });
    for (const writeText of [undefined, () => Promise.reject(new Error('PRIVATE')), () => new Promise(() => {})]) {
        h.sandbox.navigator = { clipboard: { writeText, readText() { assert.fail('must not read clipboard'); } } };
        const result = await api.copySummary();
        assert.equal(result.status, 'text-fallback');
        assert.equal(result.selectable, true);
        const text = h.document.getElementById('diagnostic-export-text');
        assert.equal(text.value, result.text);
        assert.ok(text.readOnly && text.selected && text.focused);
    }
    assert.equal(h.nodes.filter((node) => node.id === 'diagnostic-export-text').length, 1);
    let copied;
    h.sandbox.navigator = { clipboard: { async writeText(text) { copied = text; } } };
    const result = await api.copySummary();
    assert.equal(result.status, 'copied');
    assert.equal(copied, result.text);
});

test('Blob, object URL, download click, exporter and DOM failures preserve bounded fallback without recursion', async () => {
    for (const failure of ['blob', 'url', 'click', 'generation', 'dom']) {
        const h = fixture();
        let revoked = 0;
        h.sandbox.URL = { createObjectURL() { if (failure === 'url') throw new Error(); return 'blob:fixture'; }, revokeObjectURL() { revoked += 1; } };
        h.sandbox.setTimeout = (callback, delay) => delay === 1000 ? callback() : setTimeout(callback, delay);
        if (failure === 'blob') h.sandbox.Blob = class { constructor() { throw new Error(); } };
        if (failure === 'click' || failure === 'dom') {
            h.document.createElement = (tag) => {
                if (failure === 'dom') throw new Error();
                const node = h.element(tag);
                if (tag === 'a') node.click = () => { throw new Error(); };
                return node;
            };
        }
        let api = h.exporter({ reporter: source([h.make()]) });
        if (failure === 'generation') {
            h.sandbox.AppDiagnosticContract = { ...h.contract, utf8Bytes() { throw new Error('PRIVATE'); } };
            api = h.exporter();
        }
        const result = await api.download();
        assert.equal(result.status, 'text-fallback', failure);
        assert.ok(size(result.text) <= 8192 && !result.text.includes('PRIVATE'));
        assert.equal(h.output.length, 0, 'no logger/reporter recursion');
        assert.equal(h.document.body.children.some((node) => node.tagName === 'a'), false);
        if (['click', 'dom'].includes(failure)) assert.equal(revoked, 1);
    }
});

test('JSON download is local, correctly typed and releases its temporary link and URL', async () => {
    const h = fixture();
    let blob;
    let filename;
    let revoked;
    h.sandbox.URL = { createObjectURL(value) { blob = value; return 'blob:local'; }, revokeObjectURL(value) { revoked = value; } };
    h.sandbox.setTimeout = (fn, delay) => delay === 1000 ? fn() : setTimeout(fn, delay);
    h.document.createElement = (tag) => { const node = h.element(tag); node.click = () => { filename = node.download; }; return node; };
    const result = await h.exporter({ reporter: source([h.make()]) }).download();
    assert.equal(result.status, 'download-started');
    assert.equal(filename, 'ielts-diagnostics.json');
    assert.equal(blob.type, 'application/json;charset=utf-8');
    assert.equal(await blob.text(), result.json);
    assert.equal(revoked, 'blob:local');
    assert.equal(h.document.body.children.length, 0);
});

test('startup uses the richer incident export while missing/broken exporters retain the independent minimal path', async () => {
    for (const mode of ['rich', 'missing', 'broken']) {
        const h = harness();
        const id = h.collector.startupFailed(new Error('PRIVATE'));
        const panel = h.document.getElementById('diagnostic-startup-failure');
        const details = panel.children.find((node) => node.tagName === 'details');
        const button = panel.children.find((node) => node.tagName === 'button');
        if (mode === 'rich') h.run('js/diagnostics/diagnosticExport.js');
        if (mode === 'broken') h.sandbox.AppDiagnosticExport = { async download() { throw new Error('PRIVATE'); } };
        h.sandbox.Blob = class { constructor() { throw new Error(); } };
        await button.emit('click');
        assert.equal(details.open, true);
        details.emit('toggle');
        const text = details.children.find((node) => node.tagName === 'textarea');
        assert.ok(text.value.includes(id));
        assert.ok(!text.value.includes('PRIVATE'));
        if (mode === 'rich') assert.match(text.value, /aggregation: incomplete/);
        else assert.equal(JSON.parse(text.value).events[0].eventId, id);
        assert.equal(h.collector.snapshot().events.length, 1);
    }
});

for (const failure of ['null-report', 'generation-issue']) {
    for (const delivery of ['download', 'text']) {
        test(`startup retains minimal evidence after a handled ${failure} with ${delivery} delivery`, async () => {
            const h = fixture({ install: true });
            const id = h.collector.startupFailed(new Error('PRIVATE'));
            const panel = h.document.getElementById('diagnostic-startup-failure');
            const details = panel.children.find((node) => node.tagName === 'details');
            const button = panel.children.find((node) => node.tagName === 'button');
            const text = details.children.find((node) => node.tagName === 'textarea');
            // First cache a valid rich summary from a delivery-only fallback.
            h.sandbox.URL = { createObjectURL() { throw new Error('download unavailable'); } };
            await button.emit('click');
            assert.match(text.value, /aggregation: incomplete/);
            assert.ok(text.value.includes(id));

            // Exercise both handled failure shapes from the real exporter. A
            // snapshot-only failure returns an issue; persistent failure returns null.
            h.sandbox.failOnce = failure === 'generation-issue';
            h.evaluate(`
                const stringify = JSON.stringify;
                let failed = false;
                JSON.stringify = function (value, ...args) {
                    if (value?.reportType === 'passive-diagnostics' && (!failOnce || !failed)) {
                        failed = true;
                        throw new Error('PRIVATE_GENERATION');
                    }
                    return stringify.call(this, value, ...args);
                };
            `);
            let result;
            const exporter = h.sandbox.AppDiagnosticExport;
            h.sandbox.AppDiagnosticExport = { async download(...args) {
                result = await exporter.download(...args);
                return result;
            } };
            let blob;
            let revoked;
            h.sandbox.URL = {
                createObjectURL(value) {
                    if (delivery === 'text') throw new Error('download unavailable');
                    blob = value;
                    return 'blob:minimal';
                },
                revokeObjectURL(value) { revoked = value; }
            };
            h.sandbox.setTimeout = (fn, delay) => delay === 1000 ? fn() : setTimeout(fn, delay);
            await button.emit('click');
            assert.equal(result.status, 'text-fallback');
            if (failure === 'null-report') assert.equal(result.report, null);
            else assert.ok(result.report.issues.includes('export-generation-failed'));
            if (delivery === 'download') {
                assert.equal(h.nodes.find((node) => node.download)?.download, 'ielts-startup-diagnostics.txt');
                assert.equal(blob.type, 'text/plain;charset=utf-8');
                assert.equal(JSON.parse(await blob.text()).events[0].eventId, id);
                assert.equal(revoked, 'blob:minimal');
            } else {
                assert.ok(details.open && text.focused && text.selected);
            }
            details.open = false;
            details.emit('toggle');
            details.open = true;
            details.emit('toggle');
            assert.equal(JSON.parse(text.value).events[0].eventId, id, 'reopening must not restore failed or stale rich text');
            assert.ok(size(text.value) <= 32 * 1024 && !text.value.includes('PRIVATE'));
            assert.equal(h.collector.snapshot().events.length, 1);
            assert.equal(h.output.length, 0, 'fallback does not recursively report');
        });
    }
}

test('all supported practice bundles and foundation ship the passive exporter without the active workflow dependency', () => {
    for (const bundle of ['core-foundation', 'reading-page', 'practice-page-enhancer', 'listening-record-bridge', 'listening-wrapper']) {
        const source = read('js/bundles/' + bundle + '.bundle.js');
        assert.ok(source.includes('function defineDiagnosticExport'), bundle);
        assert.ok(!source.includes('class SystemDiagnostics'), bundle);
    }
});
