import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
fs.mkdirSync(reports, { recursive: true });
const fixture = path.join(reports, 'diagnostic-export-fixture.html');
const sources = ['assets/generated/diagnostics/bootstrap-inline.js', 'js/diagnostics/diagnosticStore.js',
    'js/diagnostics/diagnosticReporter.js', 'js/diagnostics/diagnosticExport.js'];
const html = '<!doctype html><meta charset="utf-8"><title>Passive diagnostic export fixture</title><body>'
    + sources.map((source, index) => '<script>' + fs.readFileSync(path.join(root, source), 'utf8')
        + (index === 0 ? '\nAppDiagnosticBootstrap.install({context:"reading"});' : '') + '</script>').join('\n');
fs.writeFileSync(fixture, html);
const standaloneBundles = ['reading-page', 'practice-page-enhancer', 'listening-record-bridge', 'listening-wrapper'];
const standaloneHtml = (name, prefix) => '<!doctype html><meta charset="utf-8"><title>Standalone practice bundle</title><body>'
    + `<script src="${prefix}js/bundles/${name}.bundle.js"></script></body>`;
for (const name of standaloneBundles) fs.writeFileSync(path.join(reports, `standalone-${name}.html`), standaloneHtml(name, '../../../../'));
const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const name = standaloneBundles.find((entry) => pathname.endsWith(`/standalone-${entry}.html`));
    const bundle = standaloneBundles.find((entry) => pathname.endsWith(`/js/bundles/${entry}.bundle.js`));
    response.writeHead(200, { 'content-type': bundle ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
    response.end(bundle ? fs.readFileSync(path.join(root, `js/bundles/${bundle}.bundle.js`)) : name ? standaloneHtml(name, './') : html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const [mode, url] of [['file', pathToFileURL(fixture).href], ['http', origin + '/fixture.html'],
        ['subpath', origin + '/practice/fixture.html']]) {
        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        try {
            const metadata = JSON.parse(fs.readFileSync(path.join(root, 'assets/generated/diagnostics/build-manifest.json'), 'utf8'));
            for (const name of standaloneBundles) {
                // Standalone bootstraps can persist initialization incidents;
                // each provenance check owns disposable, separate storage.
                const standaloneContext = await browser.newContext();
                try {
                    const standalonePage = await standaloneContext.newPage();
                    await standalonePage.goto(new URL(`standalone-${name}.html`, url).href);
                    const standalone = await standalonePage.evaluate(() => AppDiagnosticExport.snapshot());
                    assert.equal(standalone.appVersion, metadata.appVersion, `${mode}: ${name}`);
                    assert.equal(standalone.buildId, metadata.buildId, `${mode}: ${name}`);
                    results.push({ mode, scenario: `${name}-standalone-build-provenance`, passed: true });
                } finally { await standaloneContext.close(); }
            }
            await page.goto(url);
            await page.evaluate(() => AppDiagnosticStore.ready);
            const id = await page.evaluate(async () => {
                AppDiagnostics.markReady();
                const id = AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'submit',
                    error: new Error('PRIVATE_ANSWER'), correlation: { session: 'PRIVATE_SESSION' },
                    persistence: { operation: 'unconfirmed' } });
                await AppDiagnostics.flush();
                window.readRows = () => new Promise((resolve, reject) => {
                    const request = indexedDB.open('IELTSAtlasDiagnosticsV1', 1);
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const db = request.result;
                        const tx = db.transaction('events', 'readonly');
                        const get = tx.objectStore('events').getAll();
                        get.onsuccess = () => resolve(JSON.stringify(get.result));
                        tx.oncomplete = () => db.close();
                    };
                });
                // Simulate retained schema-v1 input from a less strict old producer.
                const seed = AppDiagnosticContract.createNormalizer().normalize({ persistence: { generation: AppDiagnosticStore.status().generation } });
                const legacy = { ...seed, error: { name: 'Error', message: 'PRIVATE_LEGACY_ANSWER',
                    stack: [{ path: 'file:///C:/PRIVATE_USER/js/app.js?token=PRIVATE_TOKEN', line: 4, column: 5 }],
                    cause: { name: 'Error', message: 'PRIVATE_IMPORTED_CONTENT' } },
                    correlation: { scopeId: 'PRIVATE_TOKEN', operation: 'PRIVATE_NOTE' }, answers: 'PRIVATE_ANSWERS' };
                await new Promise((resolve, reject) => {
                    const request = indexedDB.open('IELTSAtlasDiagnosticsV1', 1);
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const db = request.result;
                        const tx = db.transaction('events', 'readwrite');
                        tx.objectStore('events').put({ eventId: legacy.eventId, event: legacy });
                        tx.oncomplete = () => { db.close(); resolve(); };
                        tx.onabort = () => { db.close(); reject(tx.error); };
                    };
                });
                window.originalRows = await readRows();
                window.originalMemory = JSON.stringify(AppDiagnostics.snapshot());
                window.sideEffects = [];
                const forbidden = (name) => () => { sideEffects.push(name); throw new Error('Forbidden export side effect: ' + name); };
                for (const name of ['AppData', 'app', 'SystemDiagnostics', 'AppLazyLoader']) Object.defineProperty(window, name, { get: forbidden(name), configurable: true });
                for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'open', 'close', 'postMessage']) window[name] = forbidden(name);
                navigator.sendBeacon = forbidden('sendBeacon');
                Storage.prototype.setItem = forbidden('storage-write');
                for (const name of ['put', 'add', 'delete', 'clear']) IDBObjectStore.prototype[name] = forbidden('idb-' + name);
                const transaction = IDBDatabase.prototype.transaction;
                IDBDatabase.prototype.transaction = function (stores, mode, options) {
                    if (mode && mode !== 'readonly') sideEffects.push('readwrite-transaction');
                    return transaction.call(this, stores, mode, options);
                };
                return id;
            });

            const report = await page.evaluate(() => AppDiagnosticExport.snapshot());
            assert.equal(report.events.length, 2, mode);
            assert.equal(report.collection.connection, 'disconnected');
            assert.equal(report.collection.aggregation, 'incomplete');
            assert.equal(report.environment.runMode, mode);
            assert.equal(report.environment.browser, 'chromium');
            assert.match(report.buildId, /^sha256:[a-f0-9]{64}$/);
            assert.ok(!JSON.stringify(report).includes('PRIVATE'));
            results.push({ mode, scenario: 'real-store-legacy-redaction-and-disconnected-coverage', passed: true });

            const downloadPromise = page.waitForEvent('download');
            const delivered = await page.evaluate((eventId) => AppDiagnosticExport.download({ eventId }), id);
            const download = await downloadPromise;
            assert.equal(delivered.status, 'download-started');
            assert.equal(download.suggestedFilename(), 'ielts-diagnostics.json');
            const chunks = [];
            for await (const chunk of await download.createReadStream()) chunks.push(chunk);
            const downloaded = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            assert.equal(downloaded.selection.eventId, id);
            assert.equal(downloaded.selection.found, true);
            assert.ok(downloaded.events.some((event) => event.eventId === id));
            assert.ok(!JSON.stringify(downloaded).includes('PRIVATE'));
            results.push({ mode, scenario: 'real-json-download-with-incident-context', passed: true });

            const fallbacks = await page.evaluate(async () => {
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                    writeText: () => Promise.reject(new Error('Denied')), readText: () => { sideEffects.push('clipboard-read'); } } });
                const copy = await AppDiagnosticExport.copySummary();
                const text = document.getElementById('diagnostic-export-text');
                const clipboardSelected = text.selectionStart === 0 && text.selectionEnd === text.value.length;
                window.Blob = class { constructor() { throw new Error('Blob unavailable'); } };
                const download = await AppDiagnosticExport.download();
                return { copy: copy.status, download: download.status, text: download.text, clipboardSelected,
                    selected: text.selectionStart === 0 && text.selectionEnd === text.value.length, readonly: text.readOnly };
            });
            assert.equal(fallbacks.copy, 'text-fallback');
            assert.equal(fallbacks.download, 'text-fallback');
            assert.ok(fallbacks.selected && fallbacks.clipboardSelected && fallbacks.readonly);
            assert.ok(Buffer.byteLength(fallbacks.text) <= 8192 && !fallbacks.text.includes('PRIVATE'));
            results.push({ mode, scenario: 'clipboard-and-file-failures-selectable-text', passed: true });

            const invariant = await page.evaluate(async () => ({ rows: await readRows() === originalRows,
                memory: JSON.stringify(AppDiagnostics.snapshot()) === originalMemory, sideEffects,
                lookup: (await AppDiagnosticExport.getIncident(AppDiagnostics.snapshot().events[0].eventId)).eventId }));
            assert.equal(invariant.rows, true);
            assert.equal(invariant.memory, true);
            assert.deepEqual(invariant.sideEffects, []);
            assert.equal(invariant.lookup, id);
            assert.equal(page.url(), url);
            assert.equal(context.pages().length, 1);
            results.push({ mode, scenario: 'repeated-export-no-business-or-history-mutations', passed: true });

            const failedRead = await page.evaluate(async () => {
                window.AppDiagnosticStore = { snapshot() { throw new Error('PRIVATE_READ_FAILURE'); } };
                const result = await AppDiagnosticExport.exportJSON();
                return { state: result.report.sources.persisted.state, events: result.report.events.length, text: result.text };
            });
            assert.equal(failedRead.state, 'failed');
            assert.equal(failedRead.events, 1);
            assert.ok(!failedRead.text.includes('PRIVATE'));
            results.push({ mode, scenario: 'storage-read-failure-keeps-page-evidence', passed: true });
        } finally { await context.close(); }
    }
    console.log(JSON.stringify({ passed: results.length, scenarios: results }, null, 2));
} finally {
    fs.writeFileSync(path.join(reports, 'diagnostic-export.json'), JSON.stringify(results, null, 2));
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
}
