import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
fs.mkdirSync(reports, { recursive: true });
const fixture = path.join(reports, 'diagnostic-channel-fixture.html');
const sources = ['js/diagnostics/diagnosticContract.js', 'js/diagnostics/bootstrapCollector.js',
    'js/diagnostics/diagnosticStore.js', 'js/diagnostics/diagnosticExport.js', 'js/diagnostics/diagnosticChannel.js',
    'js/core/practiceCore.js', 'js/app/examSessionMixin.js'];
fs.writeFileSync(fixture, '<!doctype html><meta charset="utf-8"><title>Diagnostic channel fixture</title><body>'
    + sources.map(source => `<script src="../../../../${source}"></script>`).join('\n')
    + `<script>
    window.AppDiagnostics = AppDiagnosticBootstrap.install({ context: location.search ? 'reading' : 'main' });
    AppDiagnostics.attachSink(AppDiagnosticStore); AppDiagnostics.markReady();
    window.businessCalls = 0;
    window.diagnosticMessages = [];
    addEventListener('message', event => {
        if (event.data?.type !== AppDiagnosticChannel.TYPE) { businessCalls++; return; }
        if (event.data.kind === 'events') {
            diagnosticMessages.push(event.data);
            if (window.holdEvents) { window.held = event.data; event.stopImmediatePropagation(); }
        }
    });
    window.registerPractice = function () {
        window.app = Object.assign({ examWindows: new Map() }, ExamSystemAppMixins.examSession);
        for (const name of ['_reportExamMessageRejected', 'handlePracticeComplete', 'handlePracticeError', 'handleExamWindowClosed']) {
            app[name] = () => businessCalls++;
        }
        const info = { window: practiceWindow, expectedSessionId: 'fixture-session',
            windowSessionToken: app.generateWindowSessionToken('fixture-exam'), expectedOrigin: location.origin,
            allowOpaqueOrigin: location.protocol === 'file:', registrationId: 1, sessionGeneration: 1,
            suiteSessionId: 'fixture-suite', status: 'active', submittedRecordId: '', pendingSubmission: 'unchanged' };
        app.examWindows.set('fixture-exam', info);
        app.setupExamWindowCommunication(practiceWindow, 'fixture-exam', null,
            { expectedRegistration: app._captureExamSessionRegistration('fixture-exam', info), deferInitialHandshake: true });
        return { sessionId: info.expectedSessionId, windowSessionToken: info.windowSessionToken,
            origin: info.allowOpaqueOrigin ? 'null' : location.origin, allowOpaqueOrigin: info.allowOpaqueOrigin };
    };
    window.captureFailure = () => AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED', module: 'reading', action: 'save',
        error: new Error('PRIVATE_ANSWER file:///PRIVATE_PATH?token=PRIVATE_TOKEN'),
        notification: { kind: 'dialog', requiresDismissal: true }, persistence: { operation: 'unconfirmed' } });
    </script>`);
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/app\//, '/');
    const target = path.resolve(root, '.' + pathname);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': target.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(target));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const foreignServer = http.createServer(server.listeners('request')[0]);
await new Promise(resolve => foreignServer.listen(0, '127.0.0.1', resolve));
const foreignOrigin = `http://127.0.0.1:${foreignServer.address().port}`;
async function openPractice(host, url) {
    const popupPromise = host.waitForEvent('popup');
    await host.evaluate(url => { window.practiceWindow = window.open(url + '?child', ''); }, url);
    const child = await popupPromise;
    await child.waitForLoadState('load'); await child.evaluate(() => AppDiagnosticStore.ready);
    return child;
}
async function connectPractice(host, child) {
    const auth = await host.evaluate(() => registerPractice());
    await child.evaluate(auth => {
        window.transport = AppDiagnosticChannel.createChild();
        transport.connect({ ...auth, window: opener });
    }, auth);
    await child.waitForFunction(() => transport.status().connection === 'connected', null, { timeout: 5000 });
    return auth;
}
const results = [];
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const [mode, url] of [['file', pathToFileURL(fixture).href],
        ['http', origin + '/developer/tests/e2e/reports/diagnostic-channel-fixture.html'],
        ['subpath', origin + '/app/developer/tests/e2e/reports/diagnostic-channel-fixture.html']]) {
        for (const scenario of ['relay-and-shared-store', 'untrusted-input', 'parent-closed', 'parent-reloaded',
            'clear-delayed', 'opt-out-delayed', 'reset-delayed', 'reset-fresh-connection', 'queue-overflow-pending-ack', 'replacement']) {
            const context = await browser.newContext();
            const host = await context.newPage();
            try {
                await host.goto(url); await host.evaluate(() => AppDiagnosticStore.ready);
                const child = await openPractice(host, url);
                const auth = await connectPractice(host, child).catch(async error => {
                    console.error(JSON.stringify({ mode, scenario,
                        host: await host.evaluate(() => ({ storage: AppDiagnosticStore.status(), channels: app._diagnosticChannels?.size,
                            calls: businessCalls, events: AppDiagnostics.snapshot().events })),
                        child: await child.evaluate(() => ({ storage: AppDiagnosticStore.status(), transport: transport.status() })) }));
                    throw error;
                });
                if (scenario === 'relay-and-shared-store') {
                    const id = await child.evaluate(() => captureFailure());
                    await host.waitForFunction(id => !!AppDiagnostics.getIncident(id), id);
                    await child.waitForFunction(() => transport.status().pendingEvents === 0);
                    await child.evaluate(() => AppDiagnostics.flush()); await host.evaluate(() => AppDiagnostics.flush());
                    const result = await host.evaluate(id => ({ event: AppDiagnostics.getIncident(id),
                        state: app.examWindows.get('fixture-exam').pendingSubmission, calls: businessCalls,
                        envelopes: diagnosticMessages.length }), id);
                    assert.equal(result.event.notification.kind, 'none'); assert.equal(result.event.persistence.operation, 'unconfirmed');
                    assert.equal(result.state, 'unchanged'); assert.equal(result.calls, 0); assert.equal(result.envelopes, 1);
                    const exported = await host.evaluate(() => AppDiagnosticExport.exportJSON());
                    assert.equal(exported.report.events.filter(event => event.eventId === id).length, 1);
                    assert.ok(!exported.json.includes(auth.windowSessionToken)); assert.ok(!exported.json.includes('PRIVATE_'));
                } else if (scenario === 'parent-closed' || scenario === 'parent-reloaded') {
                    if (scenario === 'parent-closed') await host.close(); else await host.reload();
                    const id = await child.evaluate(() => captureFailure());
                    await child.waitForFunction(() => ['disconnected', 'unavailable'].includes(transport.status().connection));
                    const output = await child.evaluate(() => AppDiagnosticExport.exportJSON());
                    assert.ok(output.report.events.some(event => event.eventId === id));
                    assert.equal(output.report.collection.aggregation, 'incomplete');
                    assert.ok(['disconnected', 'unavailable'].includes(output.report.transport.connection));
                } else if (scenario === 'reset-fresh-connection') {
                    await host.evaluate(() => { window.holdEvents = true; });
                    const oldId = await child.evaluate(() => captureFailure());
                    await host.waitForFunction(() => !!window.held);
                    const oldEnvelope = await host.evaluate(() => window.held);
                    await host.evaluate(() => AppDiagnosticStore.withFullReset(async () => {
                        await new Promise((resolve, reject) => {
                            const request = indexedDB.deleteDatabase(AppDiagnosticStorage.DATABASE_NAME);
                            request.onsuccess = resolve; request.onerror = () => reject(request.error);
                        });
                        localStorage.clear();
                        return { success: true };
                    }));
                    const completed = await host.evaluate(() => AppDiagnosticStore.status());
                    assert.equal(completed.phase, 'reset-complete'); assert.equal(completed.suspended, true);
                    await child.waitForFunction(() => AppDiagnosticStore.status().suspended);
                    assert.equal(await child.evaluate(() => transport.status().connection), 'incomplete');
                    await host.reload(); await host.evaluate(() => AppDiagnosticStore.ready);
                    const fresh = await openPractice(host, url);
                    await connectPractice(host, fresh);
                    for (const page of [host, fresh]) {
                        const state = await page.evaluate(() => AppDiagnosticStore.status());
                        assert.equal(state.phase, 'reset-complete'); assert.equal(state.generation, completed.generation);
                        assert.equal(state.enabled, true); assert.equal(state.suspended, false); assert.equal(state.failure, null);
                    }
                    await child.evaluate(data => opener.postMessage(data, '*'), oldEnvelope);
                    const id = await fresh.evaluate(() => captureFailure());
                    await host.waitForFunction(id => !!AppDiagnostics.getIncident(id), id);
                    await fresh.waitForFunction(() => transport.status().pendingEvents === 0);
                    await fresh.evaluate(() => AppDiagnostics.flush()); await host.evaluate(() => AppDiagnostics.flush());
                    const result = await host.evaluate(async ({ id, oldId }) => ({
                        event: AppDiagnostics.getIncident(id), oldEvent: AppDiagnostics.getIncident(oldId),
                        persisted: (await AppDiagnosticStore.snapshot()).events, calls: businessCalls,
                        state: app.examWindows.get('fixture-exam').pendingSubmission
                    }), { id, oldId });
                    assert.equal(result.event.persistence.generation, completed.generation);
                    assert.equal(result.oldEvent, null); assert.equal(result.calls, 0); assert.equal(result.state, 'unchanged');
                    assert.ok(result.persisted.some(event => event.eventId === id));
                    assert.ok(!result.persisted.some(event => event.eventId === oldId));
                    assert.equal(await child.evaluate(() => AppDiagnosticStore.status().suspended), true);
                } else if (scenario === 'queue-overflow-pending-ack') {
                    await host.evaluate(() => { window.holdEvents = true; });
                    const first = await child.evaluate(() => captureFailure());
                    await host.waitForFunction(() => !!window.held);
                    const envelope = await host.evaluate(() => window.held);
                    const burst = await child.evaluate(() => {
                        let last;
                        for (let i = 0; i < 210; i++) last = captureFailure();
                        return { last, status: transport.status() };
                    });
                    assert.ok(burst.status.dropped > 0); assert.ok(burst.status.pendingEvents < 200);
                    assert.ok(burst.status.pendingBytes <= 256 * 1024);
                    await host.evaluate(() => { window.holdEvents = false; });
                    await child.evaluate(data => opener.postMessage(data, '*'), envelope);
                    await host.waitForFunction(id => !!AppDiagnostics.getIncident(id), first);
                    await child.waitForFunction(() => transport.status().pendingEvents === 0, null, { timeout: 25000 });
                    assert.equal(await child.evaluate(() => transport.status().connection), 'connected');
                    assert.ok(await host.evaluate(id => !!AppDiagnostics.getIncident(id), burst.last));
                    const later = await child.evaluate(() => captureFailure());
                    await host.waitForFunction(id => !!AppDiagnostics.getIncident(id), later);
                    await child.waitForFunction(() => transport.status().pendingEvents === 0);
                    const result = await host.evaluate(() => ({ calls: businessCalls,
                        state: app.examWindows.get('fixture-exam').pendingSubmission }));
                    assert.equal(result.calls, 0); assert.equal(result.state, 'unchanged');
                } else {
                    await host.evaluate(() => { window.holdEvents = true; });
                    const id = await child.evaluate(() => captureFailure());
                    await host.waitForFunction(() => !!window.held);
                    const envelope = await host.evaluate(() => window.held);
                    if (scenario === 'clear-delayed') await host.evaluate(() => AppDiagnosticStore.clear());
                    if (scenario === 'opt-out-delayed') await host.evaluate(() => AppDiagnosticStore.setEnabled(false));
                    if (scenario === 'reset-delayed') await host.evaluate(() => AppDiagnosticStore.withFullReset(async () => {
                        await new Promise((resolve, reject) => {
                            const request = indexedDB.deleteDatabase(AppDiagnosticStorage.DATABASE_NAME);
                            request.onsuccess = resolve; request.onerror = () => reject(request.error);
                        });
                        return { success: true };
                    }));
                    if (scenario === 'replacement') await host.evaluate(() => {
                        const previous = app.examWindows.get('fixture-exam');
                        app.examWindows.set('fixture-exam', { ...previous, expectedSessionId: 'replacement-session', registrationId: 2 });
                    });
                    // Halt automatic attempts, then deliver captured envelopes through native postMessage.
                    await child.evaluate(() => transport.dispose());
                    await host.evaluate(() => { window.holdEvents = false; });
                    const post = data => child.evaluate(data => opener.postMessage(data, '*'), data);
                    if (scenario === 'untrusted-input') {
                        for (const edited of [{ ...envelope, sessionId: 'old-session' }, { ...envelope, windowSessionToken: 'wrong-token' },
                            { ...envelope, hop: 2 }, { ...envelope, payload: '{broken' },
                            { ...envelope, payload: 'x'.repeat(80 * 1024) }]) await post(edited);
                        const outsiderPromise = host.waitForEvent('popup');
                        await host.evaluate(url => window.open(url + '?outsider', ''), url);
                        const outsider = await outsiderPromise; await outsider.waitForLoadState('load');
                        await outsider.evaluate(data => opener.postMessage(data, '*'), envelope);
                        // Same WindowProxy, wrong HTTP origin after navigation.
                        if (mode !== 'file') {
                            const foreign = url.replace(origin, foreignOrigin) + '?foreign';
                            await child.goto(foreign);
                            await post(envelope);
                        }
                    } else await post(envelope);
                    // A task boundary after postMessage delivery, without flushing or changing business state.
                    await host.waitForTimeout(100);
                    const result = await host.evaluate(async id => ({ memory: AppDiagnostics.getIncident(id), calls: businessCalls,
                        state: app.examWindows.get('fixture-exam').pendingSubmission,
                        rows: (await AppDiagnosticStore.snapshot()).events.length,
                        databases: (await indexedDB.databases()).map(db => db.name) }), id);
                    assert.equal(result.memory, null); assert.equal(result.calls, 0); assert.equal(result.state, 'unchanged');
                    if (scenario.endsWith('-delayed')) {
                        assert.equal(result.rows, 0);
                        assert.ok(!result.databases.includes('IELTSAtlasDiagnosticsV1'));
                        const local = await child.evaluate(id => AppDiagnostics.getIncident(id), id);
                        assert.ok(local, 'originating page keeps short-lived evidence');
                    }
                }
                results.push({ mode, scenario, passed: true });
                console.log(`PASS ${mode}: ${scenario}`);
            } finally { await context.close(); }
        }
    }
} finally {
    fs.writeFileSync(path.join(reports, 'diagnostic-channel-report.json'), JSON.stringify({ results }, null, 2));
    await browser?.close(); server.closeAllConnections(); foreignServer.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => foreignServer.close(resolve))]);
}
console.log(`Diagnostic channel: ${results.length}/${results.length} scenarios passed.`);
