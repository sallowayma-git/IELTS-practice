import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(process.env.DIAGNOSTIC_RUNTIME_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const reports = path.resolve(process.env.DIAGNOSTIC_REPORT_DIR || path.join(root, 'developer/tests/e2e/reports'));
fs.mkdirSync(reports, { recursive: true });
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-listening-diagnostics-'));
for (const source of ['index.html', 'css', 'js/bundles', 'assets/vendor', 'assets/images',
    'assets/generated/reading-exams', 'assets/generated/reading-explanations',
    'assets/generated/listening-exams/listening-practice-unified.html']) {
    const target = path.join(fixture, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, source), target, { recursive: true });
}
const inline = fs.readFileSync(path.join(root, 'assets/generated/diagnostics/bootstrap-inline.js'), 'utf8');
const wrapper = 'assets/generated/listening-exams/listening-practice-unified.html';
const wrapperBundle = 'js/bundles/listening-wrapper.bundle.js';
const originalWrapper = fs.readFileSync(path.join(root, wrapperBundle));
const bridgeBundle = 'js/bundles/listening-record-bridge.bundle.js';
const originalBridge = fs.readFileSync(path.join(root, bridgeBundle));
fs.mkdirSync(path.join(fixture, 'fixtures'));
function writePractice(kind, early = true) {
    const bridge = kind === 'listening';
    const bundle = bridge ? 'listening-record-bridge' : 'practice-page-enhancer';
    const hook = `AppDiagnosticBootstrap.install(${JSON.stringify({ context: bridge ? 'listening' : 'legacy',
        entryCoverage: { entry: bridge ? 'listening-bridge' : 'legacy-enhancer', capture: 'before-dependencies' },
        optionalMedia: true, requiredResources: [`js/bundles/${bundle}.bundle.js`, 'css/incident-center.css'] })});`;
    const html = `<!doctype html><html><head><meta charset="utf-8">${early ? `<script>${inline}\n${hook}</script>` : ''}
        ${early ? '<link rel="stylesheet" href="../css/incident-center.css">' : ''}<title>Synthetic practice</title></head><body>
        <input name="q1" value="PRIVATE_ANSWER"><button id="finish-btn">Finish</button>
        <audio src="PRIVATE_OPTIONAL_AUDIO.mp3"></audio><script>
        window.App = { state: { isReviewing: true }, config: { questionList: [1], answerKey: { text: { q1: 'PRIVATE_TRANSCRIPT' } } } };
        window.practicePageEnhancerConfig = { autoInitialize: false };
        </script><script src="../js/bundles/${bundle}.bundle.js"></script>
        ${bridge ? '' : '<script>practicePageEnhancer.setupCommunication();</script>'}</body></html>`;
    fs.writeFileSync(path.join(fixture, `fixtures/${kind}.html`), html);
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/app\//, '/');
    const file = path.resolve(fixture, '.' + name);
    if (!file.startsWith(fixture + path.sep)) return response.writeHead(403).end();
    try { const body = fs.readFileSync(file); response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); response.end(body); }
    catch (_) { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];

async function openPractice(context, host, base, kind, dropAck) {
    await host.goto(base + 'index.html?view=practice', { waitUntil: 'domcontentloaded' });
    await host.waitForFunction(() => window.app?.isInitialized && typeof window.app.openExam === 'function', null, { timeout: 60000 });
    await host.waitForFunction(() => window.app?.components.practiceRecorder?.constructor.name === 'PracticeRecorder');
    await host.evaluate(async () => { await window.app._practiceRecorderRebindPromise; await AppData.ready; });
    const [child] = await Promise.all([context.waitForEvent('page'), host.evaluate(async ({ kind, dropAck }) => {
        await window.ensureBrowseGroup();
        window.buildResourcePath = () => new URL(`fixtures/${kind}.html`, location.href).href;
        window.__originalPostExam = window.app._postExamMessage;
        window.__dropAck = dropAck;
        window.__droppedAck = false;
        window.__submitCheckpoint = { completionReceived: false, ackAttempted: false, nackAttempted: false };
        const originalComplete = window.app.handlePracticeComplete;
        window.app.handlePracticeComplete = function (...args) {
            __submitCheckpoint.completionReceived = true;
            return originalComplete.apply(this, args);
        };
        window.app._postExamMessage = function (...args) {
            if (args[2] === 'PRACTICE_SUBMIT_ACK') __submitCheckpoint.ackAttempted = true;
            if (args[2] === 'PRACTICE_SUBMIT_FAILED') __submitCheckpoint.nackAttempted = true;
            // Drop outcome replies throughout the fault window. An automatic
            // retry may receive a transient NACK while the first save is still
            // running; delivering it would test rejection instead of reply loss.
            if (__dropAck && ['PRACTICE_SUBMIT_ACK', 'PRACTICE_SUBMIT_FAILED'].includes(args[2])) {
                if (args[2] === 'PRACTICE_SUBMIT_ACK') __droppedAck = true;
                return true;
            }
            return __originalPostExam.apply(this, args);
        };
        return window.app.openExam(kind === 'listening' ? 'listening-diagnostic-fixture' : 'legacy-diagnostic-fixture', {
            practiceMode: 'single', examDefinition: { id: kind === 'listening' ? 'listening-diagnostic-fixture' : 'legacy-diagnostic-fixture',
                type: kind === 'listening' ? 'listening' : 'other', title: 'Synthetic practice', category: 'P1',
                path: 'fixtures/', filename: `${kind}.html`, hasHtml: true } });
    }, { kind, dropAck })]);
    await child.waitForLoadState('load');
    const practice = kind === 'listening' && !base.startsWith('file:')
        ? await (async () => { await child.waitForSelector('#listening-practice-frame');
            const frame = await (await child.$('#listening-practice-frame')).contentFrame();
            return frame; })() : child;
    await practice.waitForFunction(() => window.__listeningBridgeGetState?.().initialized || window.practicePageEnhancer?.sessionId, null, { timeout: 20000 });
    await practice.waitForFunction(() => AppDiagnostics.status().transport?.connection === 'connected', null, { timeout: 15000 });
    return { child, practice };
}
async function submit(practice, kind) {
    return practice.evaluate(kind => kind === 'listening' ? __listeningBridgeComplete()
        : practicePageEnhancer.sendMessage('PRACTICE_COMPLETE', {
            answers: { q1: 'PRIVATE_ANSWER' }, answerComparison: { q1: { userAnswer: 'PRIVATE_ANSWER', correctAnswer: 'PRIVATE_TRANSCRIPT', isCorrect: false } },
            scoreInfo: { correct: 0, total: 1, percentage: 0 }, duration: 1, type: 'listening'
        }), kind);
}
async function exported(practice) {
    const report = await practice.evaluate(() => AppDiagnosticExport.exportJSON());
    assert.ok(report.json); assert.doesNotMatch(report.json, /PRIVATE_|windowSessionToken|sourceUrl=/);
    assert.equal(report.report.collection.aggregation, 'incomplete');
    return report.report;
}

async function verifyLocalExport(host, child, practice, scenario) {
    const storage = await practice.evaluate(async scenario => {
        if (scenario === 'disabled-persistence') {
            const result = await AppDiagnosticStore.setEnabled(false);
            if (!result.success) throw new Error('Could not disable diagnostic persistence');
        }
        return AppDiagnosticStore.status();
    }, scenario);
    if (scenario === 'disabled-persistence') assert.equal(storage.enabled, false);
    else assert.equal(storage.failure, 'COORDINATION_UNAVAILABLE');

    // Capture a real post-readiness error that has no active notification.
    await practice.evaluate(() => { setTimeout(() => { throw new Error('PRIVATE_FRAME_RUNTIME'); }, 0); });
    await practice.waitForFunction(() => AppDiagnostics.snapshot().events.some(event => event.code === 'UNEXPECTED_RUNTIME_ERROR'));
    const report = await exported(practice);
    const event = report.events.find(event => event.code === 'UNEXPECTED_RUNTIME_ERROR');
    assert.equal(event.notification.kind, 'none');
    await practice.waitForFunction(() => AppDiagnostics.status().transport?.pendingEvents === 0);
    if (practice !== child) {
        assert.equal((await exported(child)).events.some(candidate => candidate.eventId === event.eventId), false);
        assert.equal(await child.getByRole('button', { name: 'Errors and diagnostics', exact: true }).count(), 1);
    }

    // Keep IndexedDB snapshot reads in the foreground while the popup is open.
    await host.bringToFront();
    const records = await host.evaluate(() => AppData.practice.list());
    await child.bringToFront();
    const access = practice.getByRole('button', { name: /^Errors and diagnostics/ });
    assert.equal(await access.count(), 1, 'Locally retained errors need a frame-local history/export entry');
    await access.click();
    await practice.locator('.incident-history button').filter({ hasText: event.eventId }).waitFor();
    const [download] = await Promise.all([child.waitForEvent('download'),
        practice.getByRole('button', { name: '导出保留的诊断历史', exact: true }).click()]);
    assert.match(download.suggestedFilename(), /\.json$/);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const json = Buffer.concat(chunks).toString('utf8');
    assert.doesNotMatch(json, /PRIVATE_|windowSessionToken|sourceUrl=/);
    assert.ok(JSON.parse(json).events.some(candidate => candidate.eventId === event.eventId));

    // The same local entry must still expose selectable evidence without the UI.
    await practice.getByRole('button', { name: '关闭历史', exact: true }).click();
    await practice.evaluate(() => { window.getMessageCenter = () => null; });
    await access.click();
    const text = await practice.getByRole('textbox', { name: 'Local diagnostic report' }).inputValue();
    assert.ok(JSON.parse(text).events.some(candidate => candidate.eventId === event.eventId));
    assert.doesNotMatch(text, /PRIVATE_|windowSessionToken|sourceUrl=/);
    await host.bringToFront();
    assert.deepEqual(await host.evaluate(() => AppData.practice.list()), records);
    await child.bringToFront();
    assert.equal(await practice.locator('[name="q1"]').inputValue(), 'PRIVATE_ANSWER');
    const after = await practice.evaluate(() => AppDiagnosticStore.status());
    assert.equal(after.enabled, storage.enabled);
    assert.equal(after.generation, storage.generation);
    assert.equal(after.failure, storage.failure);
}

try {
    for (const [mode, base] of [['file', pathToFileURL(fixture + path.sep).href], ['http', origin + '/'], ['subpath', origin + '/app/']]) {
        for (const scenario of ['missing-wrapper', 'invalid-wrapper', 'rejected-wrapper-init', 'missing-bridge', 'optional-media', 'lost-ack',
            'parent-closed', 'parent-reloaded', 'late-injection', 'legacy-lost-ack', 'legacy-disconnected',
            'disabled-persistence', 'coordination-unavailable']) {
            const selected = process.argv.find(value => value.startsWith('--case='))?.slice(7);
            if (selected && selected !== `${mode}/${scenario}`) continue;
            fs.writeFileSync(path.join(fixture, wrapperBundle), originalWrapper);
            fs.writeFileSync(path.join(fixture, bridgeBundle), originalBridge);
            const kind = scenario.startsWith('legacy') ? 'legacy' : 'listening';
            writePractice(kind, scenario !== 'late-injection');
            const context = await browser.newContext();
            if (scenario === 'coordination-unavailable') await context.addInitScript(() => {
                if (location.pathname.endsWith('/fixtures/listening.html')) {
                    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
                }
            });
            const runtimeErrors = [];
            context.on('page', page => page.on('pageerror', error => runtimeErrors.push(error.stack)));
            const host = await context.newPage();
            let child = host, practice = host;
            try {
                if (['missing-wrapper', 'invalid-wrapper', 'rejected-wrapper-init'].includes(scenario)) {
                    if (scenario === 'missing-wrapper') fs.unlinkSync(path.join(fixture, wrapperBundle));
                    else if (scenario === 'invalid-wrapper') fs.writeFileSync(path.join(fixture, wrapperBundle), 'function broken( {');
                    else fs.appendFileSync(path.join(fixture, wrapperBundle), '\nwindow.PracticeTimerPreferences = { ready: Promise.reject(new Error("PRIVATE_INIT_FAILURE")) };');
                    await child.goto(base + wrapper, { waitUntil: 'load' });
                    await child.waitForSelector('#diagnostic-startup-failure');
                    const evidence = await child.evaluate(() => JSON.parse(AppDiagnosticBootstrap.current().exportText()));
                    assert.equal(evidence.entryCoverage.capture, 'before-dependencies');
                    assert.ok(evidence.events.some(event => ['RESOURCE_LOAD_FAILED', 'APP_BOOT_FAILED'].includes(event.code)));
                } else if (scenario === 'missing-bridge') {
                    fs.unlinkSync(path.join(fixture, bridgeBundle));
                    await child.goto(base + 'fixtures/listening.html', { waitUntil: 'load' });
                    await child.waitForSelector('#diagnostic-startup-failure');
                    const events = await child.evaluate(() => AppDiagnosticBootstrap.current().snapshot().events);
                    assert.ok(events.some(event => event.resource.path === 'js/bundles/listening-record-bridge.bundle.js'));
                } else {
                    ({ child, practice } = await openPractice(context, host, base, kind, scenario.includes('lost-ack')));
                    if (['disabled-persistence', 'coordination-unavailable'].includes(scenario)) {
                        await verifyLocalExport(host, child, practice, scenario);
                    } else if (scenario.includes('lost-ack')) {
                        assert.equal(await submit(practice, kind), true);
                        // Wait for the real commit receipt, then read canonical data
                        // once instead of opening transactions in every polling frame.
                        // The practice popup owns the foreground. Poll this host-side
                        // protocol flag on a timer instead of background animation frames.
                        await host.waitForFunction(() => __droppedAck, null, { polling: 100 });
                        assert.equal(await host.evaluate(async () => (await AppData.practice.list()).length), 1);
                        await practice.waitForFunction(() => AppDiagnostics.snapshot().events.some(event => event.code === 'PRACTICE_CHANNEL_TIMEOUT' && event.action === 'submit'), null, { timeout: 15000 });
                        const report = await exported(practice);
                        const failure = report.events.find(event => event.code === 'PRACTICE_CHANNEL_TIMEOUT' && event.action === 'submit');
                        assert.equal(failure.persistence.operation, 'unconfirmed');
                        const hostSessionAlias = await host.evaluate(() => AppDiagnostics.correlate({
                            session: [...window.app.examWindows.values()][0].expectedSessionId }).session);
                        assert.equal(failure.correlation.session, hostSessionAlias);
                        await practice.evaluate(() => { document.querySelector('[name="q1"]').value = 'PRIVATE_EDITED'; });
                        await host.evaluate(() => { __dropAck = false; });
                        // Exercise the actual explicit incident retry, including its receipt promise.
                        await child.bringToFront();
                        await practice.getByRole('button', { name: /重试/ }).click();
                        await practice.waitForFunction(kind => kind === 'listening' ? __listeningBridgeGetState().completed
                            : practicePageEnhancer.pendingSubmissions.size === 0, kind);
                        const records = await host.evaluate(() => AppData.practice.list());
                        assert.equal(records.length, 1);
                        assert.equal(records[0].answers.q1, 'PRIVATE_ANSWER');
                        await child.screenshot({ path: path.join(reports, `listening-${mode}-${scenario}.png`) });
                    } else if (scenario.includes('closed') || scenario.includes('disconnected') || scenario === 'parent-reloaded') {
                        if (scenario === 'parent-reloaded') await host.reload(); else await host.close();
                        assert.equal(child.isClosed(), false);
                        await practice.evaluate(() => AppDiagnostics.report({ code: 'PRACTICE_CHANNEL_TIMEOUT', module: 'listening', action: 'handshake' }));
                        await child.evaluate(() => AppDiagnostics.report({ code: 'PRACTICE_CHANNEL_TIMEOUT', module: 'listening', action: 'handshake' }));
                        await child.waitForFunction(() => ['disconnected', 'incomplete'].includes(AppDiagnostics.status().transport?.connection), null, { timeout: 10000 });
                        await child.getByRole('button', { name: 'Errors and diagnostics' }).click();
                        await exported(practice);
                        const [download] = await Promise.all([child.waitForEvent('download'), child.evaluate(() => AppDiagnosticExport.download())]);
                        assert.match(download.suggestedFilename(), /\.json$/);
                    } else {
                        const report = await exported(practice);
                        assert.ok(report.events.every(event => event.notification.kind !== 'dialog'));
                        if (scenario === 'late-injection') {
                            assert.equal(report.collection.entryCoverage.capture, 'late-injection');
                            await practice.waitForFunction(() => Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith('/css/incident-center.css')));
                        }
                        const before = await practice.evaluate(() => AppDiagnostics.snapshot().events.length);
                        await practice.evaluate(() => window.postMessage({ type: 'IELTS_DIAGNOSTIC_V1', kind: 'events', payload: 'PRIVATE_TOKEN' }, '*'));
                        assert.equal(await practice.evaluate(() => AppDiagnostics.snapshot().events.length), before);
                    }
                }
                results.push({ mode, scenario, status: 'pass' });
                console.log(`PASS ${mode} ${scenario}`);
            } catch (error) {
                const submitCheckpoint = scenario.includes('lost-ack') && !host.isClosed()
                    ? await host.evaluate(() => window.__submitCheckpoint).catch(() => null) : null;
                results.push({ mode, scenario, status: 'fail', error: error.stack, submitCheckpoint });
                console.error(`FAIL ${mode} ${scenario}: ${error.stack}`);
                console.error('Runtime errors', runtimeErrors);
                if (!host.isClosed()) console.error('Host state', await host.evaluate(async () => ({
                    backend: AppData.status(),
                    records: await AppData.practice.list().then(records => records.map(record => ({ submissionId: record.submissionId, sessionId: record.sessionId }))).catch(error => ({ error: error.message, details: error.details })),
                    incidents: AppDiagnostics.snapshot().events.map(event => ({ code: event.code, action: event.action, cause: event.causeCode })),
                    sessions: [...window.app.examWindows.values()].map(info => ({ status: info.status, receipts: info.practiceSubmitReceipts }))
                })).catch(() => null));
                console.error('Child state', await practice.evaluate(() => ({
                    incidents: AppDiagnostics.snapshot().events.map(event => ({ code: event.code, action: event.action })),
                    pending: window.__listeningBridgeGetState?.().pendingCompletion?.submissionId,
                    complete: window.__listeningBridgeGetState?.().completed
                })).catch(() => null));
            } finally { await context.close(); }
        }
    }
} finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.writeFileSync(path.join(reports, 'listening-diagnostics-report.json'), JSON.stringify({ results }, null, 2));
}
assert.equal(results.filter(item => item.status === 'fail').length, 0, JSON.stringify(results.filter(item => item.status === 'fail')));
console.log(`${results.length}/${results.length} listening/legacy scenarios passed`);
