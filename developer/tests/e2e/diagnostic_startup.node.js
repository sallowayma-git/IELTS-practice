import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { prepareStartupEnrichmentAtCapacity } from '../js/helpers/diagnosticCapacity.js';
import { runtimeRoot, reportRoot } from './diagnosticRuntimeFixture.js';

const root = runtimeRoot;
const reports = reportRoot;
fs.mkdirSync(reports, { recursive: true });
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-diagnostic-startup-'));
for (const source of ['index.html', 'css', 'js/bundles', 'assets/vendor', 'assets/images']) {
    const destination = path.join(fixture, source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(root, source), destination, { recursive: true });
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/IELTS-practice\//, '/');
    const filename = path.resolve(fixture, '.' + pathname);
    if (!filename.startsWith(fixture + path.sep)) return response.writeHead(403).end();
    try {
        const body = fs.readFileSync(filename);
        response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
        response.end(body);
    } catch (_) { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true,
    args: ['--allow-file-access-from-files', '--log-file=' + path.join(reports, 'diagnostic-chromium.log')] });
const results = [];
const foundationPath = 'js/bundles/core-foundation.bundle.js';
const legacyPath = 'js/bundles/legacy-app.bundle.js';
const foundation = fs.readFileSync(path.join(root, foundationPath), 'utf8');
const legacy = fs.readFileSync(path.join(root, legacyPath), 'utf8');
const initializationFailures = {
    'caught-initialization': 'PRIVATE_INITIALIZATION_DETAIL',
    'component-timeout': '组件加载超时: PRIVATE_INITIALIZATION_DETAIL',
    network: '网络连接失败: PRIVATE_INITIALIZATION_DETAIL',
    'component-timeout-safe-mode': '组件加载超时: PRIVATE_INITIALIZATION_DETAIL',
    'network-safe-mode': '网络连接失败: PRIVATE_INITIALIZATION_DETAIL',
    'network-repeated': '网络连接失败: PRIVATE_INITIALIZATION_DETAIL',
    dependency: '依赖检查失败: 网络不可用 PRIVATE_INITIALIZATION_DETAIL',
    'rich-generation': 'PRIVATE_INITIALIZATION_DETAIL',
    'rich-generation-no-download': 'PRIVATE_INITIALIZATION_DETAIL'
};
const recoveryRoutes = {
    'component-timeout': 'attempt-recovery',
    network: 'attempt-recovery',
    'component-timeout-safe-mode': 'safe-mode',
    'network-safe-mode': 'safe-mode',
    'network-repeated': 'attempt-recovery'
};
const faults = ['missing', 'parse', 'rejection', ...Object.keys(initializationFailures),
    'indexeddb-blocked', 'startup-capacity', 'native-abort', 'healthy'];
try {
    for (const [mode, url] of [
        ['file', pathToFileURL(path.join(fixture, 'index.html')).href],
        ['http', origin + '/index.html'],
        ['subpath', origin + '/IELTS-practice/index.html']
    ]) {
        for (const fault of faults) {
            fs.writeFileSync(path.join(fixture, foundationPath), foundation);
            fs.writeFileSync(path.join(fixture, legacyPath), legacy);
            if (fault === 'missing') fs.unlinkSync(path.join(fixture, foundationPath));
            if (fault === 'parse') fs.writeFileSync(path.join(fixture, foundationPath), 'function invalid( {');
            if (fault === 'rejection') fs.writeFileSync(path.join(fixture, foundationPath), 'Promise.reject(new Error("PRIVATE_INITIALIZATION_DETAIL"));');
            if (initializationFailures[fault]) {
                fs.appendFileSync(path.join(fixture, legacyPath), `
                    (function injectInitializationFailure() {
                        const initialize = ExamSystemApp.prototype.initializeComponents;
                        window.ExamSystemAppMixins.bootstrap = {
                            ...window.ExamSystemAppMixins.bootstrap,
                            async initializeComponents(...args) {
                                window.__startupAttempts = (window.__startupAttempts || 0) + 1;
                                window.__startupShellNodes ||= Array.from(document.querySelectorAll('#app .view, #app .nav-btn'));
                                if (${!!recoveryRoutes[fault]} && window.__startupAttempts > ${fault === 'network-repeated' ? 2 : 1}) {
                                    return initialize.apply(this, args);
                                }
                                throw new Error(${JSON.stringify(initializationFailures[fault])});
                            }
                        };
                    })();
                `);
            }
            if (fault === 'startup-capacity') {
                fs.writeFileSync(path.join(fixture, foundationPath), `
                    window.__diagnosticCapacity = (${prepareStartupEnrichmentAtCapacity.toString()})(AppDiagnosticBootstrap.install());
                    AppDiagnosticBootstrap.install().startupFailed(window.__diagnosticCapacity.error);
                ` + foundation);
            }
            if (fault === 'native-abort') {
                fs.writeFileSync(path.join(fixture, foundationPath), `
                    window.__diagnosticFaultObserved = new Promise((resolve) => {
                        addEventListener('unhandledrejection', function observed(event) {
                            if (!(event.reason instanceof DOMException) || event.reason.name !== 'AbortError') return;
                            window.__diagnosticAbort = {
                                native: true, beforeReady: !window.app?.isInitialized,
                                event: AppDiagnosticBootstrap.install().snapshot().events.at(-1)
                            };
                            removeEventListener('unhandledrejection', observed);
                            resolve();
                        });
                    });
                    (function abortFetch() {
                        const controller = new AbortController();
                        controller.abort();
                        fetch('data:text/plain,PRIVATE_INITIALIZATION_DETAIL', { signal: controller.signal });
                    })();
                ` + foundation);
            }
            if (fault === 'native-abort' || fault === 'indexeddb-blocked') {
                // Hold startup until fetch cancellation is observed, or propagate the
                // real AppData rejection through the application's initialization catch.
                fs.appendFileSync(path.join(fixture, legacyPath), `
                    (function waitForFaultObservation() {
                        const initialize = ExamSystemApp.prototype.initializeComponents;
                        window.ExamSystemAppMixins.bootstrap = {
                            ...window.ExamSystemAppMixins.bootstrap,
                            async initializeComponents(...args) {
                                await ${fault === 'native-abort' ? 'window.__diagnosticFaultObserved' : 'AppData.ready'};
                                return initialize.apply(this, args);
                            }
                        };
                    })();
                `);
            }
            const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
            if (fault === 'indexeddb-blocked') await context.addInitScript(() => {
                indexedDB.open = () => { throw new DOMException('PRIVATE_INITIALIZATION_DETAIL', 'SecurityError'); };
                const nativeError = console.error;
                console.error = function (...args) {
                    if (!window.__diagnosticConsoleFirst && args.some((arg) => arg?.name === 'AppDataError' && arg.code === 'BACKEND_UNAVAILABLE')) {
                        window.__diagnosticConsoleFirst = window.AppDiagnostics?.snapshot().events.find((event) =>
                            event.causeCode === 'BACKEND_UNAVAILABLE' && event.collection.source === 'console');
                    }
                    return nativeError.apply(this, args);
                };
            });
            const page = await context.newPage();
            const nativeErrors = [];
            page.on('pageerror', (error) => nativeErrors.push(error.name));
            await page.goto(url + '?v=private-cache-value', { waitUntil: 'load' });
            if (fault === 'healthy' || fault === 'native-abort') {
                await page.waitForFunction(() => window.app?.isInitialized === true);
                assert.equal(await page.locator('#diagnostic-startup-failure').count(), 0, `${mode}: optional listening files must not block startup`);
                const state = await page.evaluate(() => ({
                    same: AppDiagnostics === AppDiagnosticBootstrap.install(),
                    status: AppDiagnostics.status(), buildId: AppDiagnosticBuild.buildId,
                    startupErrors: AppDiagnostics.snapshot().events.filter((event) => event.notification.kind === 'startup').length
                }));
                assert.ok(state.same && state.status.handedOff);
                assert.equal(state.startupErrors, 0);
                if (fault === 'native-abort') {
                    const abort = await page.evaluate(() => window.__diagnosticAbort);
                    assert.ok(abort.native && abort.beforeReady, 'a browser-generated abort rejection occurs during startup');
                    assert.equal(abort.event.code, 'UNEXPECTED_RUNTIME_ERROR');
                    assert.equal(abort.event.notification.kind, 'none');
                    assert.ok(nativeErrors.length > 0, 'the rejection retains native browser output');
                }
                results.push({ mode, fault, buildId: state.buildId, passed: true });
            } else {
                const panel = page.locator('#diagnostic-startup-failure');
                await panel.waitFor({ state: 'visible' });
                const canRecover = !!recoveryRoutes[fault];
                if (initializationFailures[fault]) {
                    await page.locator('.fallback-ui').waitFor({ state: 'visible' });
                    for (const action of ['attempt-recovery', 'safe-mode']) {
                        assert.equal(await page.locator(`[data-fallback-action="${action}"]`).count(), canRecover ? 1 : 0);
                    }
                }
                const evidence = await page.evaluate(() => JSON.parse(AppDiagnosticBootstrap.install().exportText()));
                const code = fault === 'missing' ? 'RESOURCE_LOAD_FAILED' : 'APP_BOOT_FAILED';
                assert.ok(evidence.events.some((event) => event.code === code), `${mode}/${fault}: expected ${code}`);
                assert.ok(evidence.events.every((event) => event.resource.status === 'unknown'));
                if (fault === 'indexeddb-blocked' || fault === 'startup-capacity') {
                    await page.waitForFunction(() => {
                        const id = (window.__diagnosticConsoleFirst || window.__diagnosticCapacity?.first)?.eventId;
                        return id && AppDiagnostics.getIncident(id)?.collection.source === 'business';
                    });
                    const observed = await page.evaluate(async () => {
                        const collector = AppDiagnosticBootstrap.install();
                        const first = window.__diagnosticConsoleFirst || window.__diagnosticCapacity.first;
                        await collector.flush();
                        return { first, current: collector.getIncident(first?.eventId),
                            exported: JSON.parse(collector.exportText(first?.eventId)).events[0],
                            delivered: await AppDiagnosticStore.getIncident(first?.eventId),
                            before: window.__diagnosticCapacity?.before, after: collector.status(),
                            actualBytes: collector.snapshot().events.reduce((size, event) =>
                                size + new TextEncoder().encode(JSON.stringify(event)).length, 0) };
                    });
                    assert.equal(observed.first?.code, 'UNEXPECTED_RUNTIME_ERROR', 'the console observation precedes startup reporting');
                    assert.equal(observed.first.collection.source, 'console');
                    for (const event of [observed.current, observed.exported,
                        ...(fault === 'indexeddb-blocked' ? [] : [observed.delivered])]) {
                        assert.equal(event.eventId, observed.first.eventId);
                        assert.equal(event.code, 'APP_BOOT_FAILED');
                        assert.equal(event.causeCode, 'BACKEND_UNAVAILABLE');
                        assert.equal(event.collection.source, 'business');
                        assert.equal(event.notification.kind, 'startup');
                    }
                    assert.ok((await panel.innerText()).includes(observed.first.eventId));
                    if (fault === 'indexeddb-blocked') {
                        assert.equal(observed.delivered, null);
                        assert.equal(observed.after.persistence, 'memory-only');
                        assert.equal(observed.after.storage.failure, 'UNAVAILABLE');
                    }
                    if (fault === 'startup-capacity') {
                        assert.equal(observed.before.dropped, 0);
                        assert.ok(observed.before.events < 200);
                        assert.ok(observed.before.bytes >= 256 * 1024 - 4096 && observed.before.bytes <= 256 * 1024);
                        assert.ok(observed.after.dropped > 0, 'enrichment forces eviction at the byte limit');
                        assert.ok(observed.after.events <= 200);
                        assert.ok(observed.after.bytes <= 256 * 1024);
                        assert.equal(observed.after.bytes, observed.actualBytes);
                        assert.equal(evidence.events[0].eventId, observed.first.eventId, 'default export prioritizes the displayed incident');
                    }
                }
                const serialized = JSON.stringify(evidence);
                for (const secret of ['PRIVATE_INITIALIZATION_DETAIL', 'private-cache-value', fixture, '127.0.0.1']) assert.equal(serialized.includes(secret), false);
                assert.ok(Buffer.byteLength(serialized) <= 32 * 1024);
                if (fault === 'parse' || fault === 'rejection') assert.ok(nativeErrors.length > 0, 'native browser output is preserved');
                if (canRecover || fault === 'startup-capacity') {
                    assert.ok(await page.evaluate(async () => {
                        await LicenseModal.init();
                        return LicenseModal.accept();
                    }));
                    await page.waitForFunction(() => !document.getElementById('license-modal').classList.contains('show'));
                }
                const generationFailed = fault.startsWith('rich-generation');
                if (fault === 'startup-capacity') {
                    // The filler contains real unconfirmed-save notifications. Once
                    // startup recovers, B2 correctly asks the user to acknowledge them.
                    for (let i = 0; i < 6 && await page.locator('.incident-dialog').count(); i += 1) {
                        await page.keyboard.press('Escape');
                    }
                    assert.equal(await page.locator('.incident-dialog').count(), 0);
                }
                if (generationFailed) await page.evaluate((blockDownload) => {
                    const stringify = JSON.stringify;
                    JSON.stringify = function (value, ...args) {
                        if (value?.reportType === 'passive-diagnostics') throw new Error('PRIVATE_GENERATION_DETAIL');
                        return stringify.call(this, value, ...args);
                    };
                    if (blockDownload) URL.createObjectURL = () => { throw new Error('download unavailable'); };
                }, fault === 'rich-generation-no-download');
                const [downloaded] = await Promise.all([
                    fault === 'rich-generation-no-download' ? Promise.resolve(null) : page.waitForEvent('download'),
                    panel.getByRole('button', { name: '导出诊断' }).click()
                ]);
                const richerExport = !generationFailed && await page.evaluate(() => typeof window.AppDiagnosticExport?.download === 'function');
                if (downloaded) {
                    assert.equal(downloaded.suggestedFilename(), richerExport ? 'ielts-diagnostics.json' : 'ielts-startup-diagnostics.txt');
                    const chunks = [];
                    for await (const chunk of await downloaded.createReadStream()) chunks.push(chunk);
                    const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (richerExport) {
                        assert.equal(report.selection.found, true);
                        assert.ok(report.events.some((event) => event.eventId === report.selection.eventId));
                        assert.equal(report.collection.aggregation, 'incomplete');
                    } else assert.equal(report.events[0].eventId, evidence.events[0].eventId);
                }
                if (generationFailed) {
                    const text = panel.locator('textarea');
                    await page.waitForFunction((id) => {
                        const value = document.querySelector('#diagnostic-startup-failure textarea').value;
                        try { return JSON.parse(value).events[0].eventId === id; } catch (_) { return false; }
                    }, evidence.events[0].eventId);
                    await panel.locator('details').evaluate((details) => { details.open = false; });
                    await panel.locator('summary').click();
                    assert.equal(JSON.parse(await text.inputValue()).events[0].eventId, evidence.events[0].eventId);
                    assert.equal((await text.inputValue()).includes('PRIVATE'), false);
                }
                if (canRecover) {
                    let recoveryIncident = evidence.events[0].eventId;
                    const route = recoveryRoutes[fault];
                    await page.locator(`[data-fallback-action="${route}"]`).click();
                    if (route === 'safe-mode') {
                        await page.locator('.safe-mode-ui').waitFor({ state: 'visible' });
                        await page.locator('[data-safe-mode-action="initialize"]').click();
                    }
                    if (fault === 'network-repeated') {
                        await page.waitForFunction(() => window.__startupAttempts === 2 && !app.isInitialized);
                        await page.locator('.fallback-ui').waitFor({ state: 'visible' });
                        assert.equal(await page.locator('#app-recovery').count(), 1);
                        assert.equal(await page.locator('#app').isVisible(), false);
                        recoveryIncident = await page.evaluate(() => JSON.parse(AppDiagnostics.exportText()).events[0].eventId);
                        await page.locator('[data-fallback-action="attempt-recovery"]').click();
                    }
                    await page.waitForFunction(() => window.app?.isInitialized === true);
                    const recovered = await page.evaluate(() => ({
                        attempts: window.__startupAttempts,
                        originalNodes: window.__startupShellNodes.length,
                        preserved: window.__startupShellNodes.every((node) => node.isConnected && document.getElementById('app').contains(node)),
                        views: document.querySelectorAll('#app .view').length,
                        navigation: document.querySelectorAll('#app .nav-btn').length
                    }));
                    assert.equal(recovered.attempts, fault === 'network-repeated' ? 3 : 2);
                    assert.ok(recovered.originalNodes > 0 && recovered.preserved, `${mode}/${fault}: recovery preserves the original shell nodes`);
                    assert.ok(recovered.views >= 2 && recovered.navigation >= 2);
                    assert.equal(await page.locator('.fallback-ui, .safe-mode-ui, #app-recovery').count(), 0);
                    await page.locator('#overview-view').waitFor({ state: 'visible' });
                    await page.locator('.nav-btn[data-view="browse"]').click();
                    await page.locator('#browse-view').waitFor({ state: 'visible' });
                    await page.locator('.nav-btn[data-view="overview"]').click();
                    await page.locator('#overview-view').waitFor({ state: 'visible' });
                    assert.ok((await panel.innerText()).includes(recoveryIncident));
                    assert.equal(await panel.evaluate((node) => getComputedStyle(node).position), 'static');
                    assert.equal(await page.evaluate((id) => AppDiagnostics.getIncident(id)?.code, evidence.events[0].eventId), 'APP_BOOT_FAILED');
                }
                if (mode === 'http' && fault === 'missing') await page.screenshot({ path: path.join(reports, 'diagnostic-startup-panel.png') });
                results.push({ mode, fault, events: evidence.events.length, code, nativeErrors: nativeErrors.length, passed: true });
            }
            await context.close();
            console.log(`PASS ${mode}/${fault}`);
        }
    }
} finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    // Only delete the exact task-owned directory returned by mkdtemp, under the OS temp root.
    const resolved = path.resolve(fixture);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('ielts-diagnostic-startup-'));
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.writeFileSync(path.join(reports, 'diagnostic-startup-report.json'), JSON.stringify({ cases: results }, null, 2));
}
assert.equal(results.length, 3 * faults.length);
