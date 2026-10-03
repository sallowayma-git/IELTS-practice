import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { runtimeFixture, runtimeRoot, reportRoot } from './diagnosticRuntimeFixture.js';

const fixture = await runtimeFixture();
const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'assets/generated/diagnostics/build-manifest.json')));
const browser = await chromium.launch({ headless: true });
const results = [];
const scenarios = ['required-lazy-load', 'storage-unavailable', 'storage-quota', 'storage-transaction',
    'hostile-propagation-and-storm', 'count-byte-age-limits', 'reload-concurrent-clear-opt-out-reset', 'passive-fallback'];
const sensitive = /PRIVATE_|private\.invalid|private-host|[A-Z]:[\\/]|windowSessionToken|private-query|private-fragment/;

async function ready(page, base) {
    await page.goto(base + 'index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.app?.isInitialized && window.AppDiagnosticExport && window.DiagnosticSettingsPanel);
    await page.evaluate(async () => { await AppData.ready; await AppDiagnosticStore.ready; await AppDiagnostics.flush(); });
    assert.equal(await page.evaluate(() => AppDiagnosticBuild.buildId), manifest.buildId);
}
async function output(page) {
    const result = await page.evaluate(() => AppDiagnosticExport.exportJSON());
    assert.doesNotMatch(result.json + result.text, sensitive);
    return result;
}

try {
    for (const [mode, base] of fixture.modes) {
        for (const scenario of scenarios) {
            const context = await browser.newContext({ acceptDownloads: true });
            context.setDefaultTimeout(15000);
            // No request may escape this disposable local fixture.
            await context.route(/^https?:/, route => new URL(route.request().url()).hostname === '127.0.0.1'
                ? route.continue() : route.abort());
            await context.addInitScript(() => { window.acceptanceClock = Date.now(); Date.now = () => acceptanceClock; });
            const page = await context.newPage();
            let restore;
            try {
                await ready(page, base);
                if (scenario === 'required-lazy-load') {
                    for (const [group, bundle] of [['diagnostics-tools', 'diagnostics'], ['reading-tools', 'reading-tools'],
                        ['reading-library', 'reading-library'], ['vocabulary-tools', 'vocabulary']]) {
                        const asset = `js/bundles/${bundle}.bundle.js`;
                        const target = path.join(fixture.root, asset);
                        const bytes = fs.readFileSync(target);
                        restore = () => fs.writeFileSync(target, bytes);
                        fs.unlinkSync(target);
                        const result = await page.evaluate(async group => {
                            let rejected = false;
                            try { await AppLazyLoader.ensureGroup(group); } catch (_) { rejected = true; }
                            return { rejected, events: AppDiagnostics.snapshot().events };
                        }, group);
                        assert.equal(result.rejected, true, group);
                        const failure = result.events.find(event => event.resource?.path === asset);
                        assert.ok(failure, asset);
                        assert.equal(failure.resource.status, 'unknown');
                        assert.equal(failure.action, 'load-resource');
                        restore();
                        restore = undefined;
                    }
                    await output(page);
                } else if (scenario.startsWith('storage-')) {
                    const state = await page.evaluate(async scenario => {
                        window.diagnosticWrites = 0;
                        const open = indexedDB.open.bind(indexedDB);
                        indexedDB.open = function (name, ...args) {
                            if (name === AppDiagnosticStorage.DATABASE_NAME && scenario === 'storage-unavailable') {
                                diagnosticWrites++;
                                throw new DOMException('PRIVATE_PATH', 'SecurityError');
                            }
                            return open(name, ...args);
                        };
                        const put = IDBObjectStore.prototype.put;
                        IDBObjectStore.prototype.put = function (...args) {
                            if (this.transaction.db.name === AppDiagnosticStorage.DATABASE_NAME) {
                                diagnosticWrites++;
                                if (scenario === 'storage-quota') throw new DOMException('PRIVATE_TOKEN', 'QuotaExceededError');
                                if (scenario === 'storage-transaction') this.transaction.abort();
                            }
                            return put.apply(this, args);
                        };
                        AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED', error: Error('PRIVATE_ANSWER') });
                        await AppDiagnostics.flush();
                        const first = diagnosticWrites;
                        for (let i = 0; i < 250; i++) AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED' });
                        await AppDiagnostics.flush();
                        return { first, after: diagnosticWrites, store: AppDiagnosticStore.status(), memory: AppDiagnostics.status() };
                    }, scenario);
                    assert.ok(state.first > 0);
                    assert.equal(state.after, state.first, 'failed persistence must not retry on every report');
                    assert.equal(state.store.persistence, 'memory-only');
                    assert.ok(state.store.failure);
                    assert.ok(state.memory.events <= 200 && state.memory.bytes <= 256 * 1024);
                    assert.ok((await output(page)).report.events.length > 0);
                } else if (scenario === 'hostile-propagation-and-storm') {
                    const state = await page.evaluate(async () => {
                        const hostile = { bigint: 3n, element: document.body };
                        hostile.self = hostile;
                        Object.defineProperty(hostile, 'message', { get() { throw Error('PRIVATE_GETTER'); } });
                        AppDiagnostics.report({ error: hostile, answers: 'PRIVATE_ANSWERS', notes: 'PRIVATE_NOTES' });
                        const error = Error('https://private.invalid/private?private-query#private-fragment C:\\private-host\\answers.txt');
                        const input = { code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'submit', error,
                            correlation: { session: 'PRIVATE_SESSION', submission: 'PRIVATE_SUBMISSION' },
                            notification: { kind: 'dialog' }, persistence: { operation: 'unconfirmed' } };
                        const id = AppDiagnostics.report(input);
                        const propagated = AppDiagnostics.report(input);
                        AppDiagnostics.captureConsole('error', [error]);
                        dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
                        const beforeStorm = AppDiagnostics.snapshot().events.filter(event => event.eventId === id).length;
                        for (let i = 0; i < 300; i++) AppDiagnostics.report({ ...input, error: new Error('PRIVATE_' + i),
                            correlation: { operation: 'synthetic-' + i } });
                        await AppDiagnostics.flush();
                        return { id, propagated, beforeStorm, memory: AppDiagnostics.status(),
                            events: AppDiagnostics.snapshot().events, dialogs: document.querySelectorAll('.incident-dialog').length };
                    });
                    assert.equal(state.id, state.propagated);
                    assert.equal(state.beforeStorm, 1);
                    assert.ok(state.memory.events <= 200 && state.memory.bytes <= 256 * 1024);
                    assert.ok(state.events.length > 1 && state.dialogs <= 1);
                    for (const event of state.events) {
                        assert.ok(Buffer.byteLength(JSON.stringify(event)) <= 8192);
                        assert.ok(event.breadcrumbs.length <= 50);
                    }
                    await output(page);
                } else if (scenario === 'count-byte-age-limits') {
                    const limits = await page.evaluate(async () => {
                        await AppDiagnosticStore.clear(); acceptanceClock++;
                        const n = AppDiagnosticContract.createNormalizer();
                        async function fill(count, large, store = AppDiagnosticStore) {
                            for (let start = 0; start < count; start += 20) {
                                const events = Array.from({ length: Math.min(20, count - start) }, () => n.normalize({
                                    timestamp: acceptanceClock,
                                    persistence: { generation: AppDiagnosticStore.status().generation },
                                    breadcrumbs: large ? Array.from({ length: 75 }, () => ({ module: 'practice', action: 'submit' })) : []
                                }));
                                await store.append(events);
                            }
                            const events = (await store.snapshot({ limit: 2000 })).events;
                            return { count: events.length, bytes: events.reduce((sum, event) => sum + AppDiagnosticContract.utf8Bytes(JSON.stringify(event)), 0),
                                maxEvent: Math.max(...events.map(event => AppDiagnosticContract.utf8Bytes(JSON.stringify(event)))),
                                maxBreadcrumbs: Math.max(...events.map(event => event.breadcrumbs.length)) };
                        }
                        // With the full schema the byte ceiling can precede 2,000
                        // rows. Lower only the count cap to exercise that branch.
                        const countStore = AppDiagnosticStorage.create({ limits: { events: 25 } });
                        await countStore.ready;
                        const count = await fill(60, false, countStore);
                        countStore.close();
                        await AppDiagnosticStore.clear(); acceptanceClock++;
                        const bytes = await fill(400, true);
                        await AppDiagnosticStore.setDetailedMode(true);
                        const active = AppDiagnosticStore.status().detailedMode;
                        acceptanceClock += 15 * 60000 + 1;
                        const expiredMode = AppDiagnosticStore.status().detailedMode;
                        acceptanceClock += 7 * 86400000;
                        const expired = (await AppDiagnosticStore.snapshot({ limit: 2000 })).events.length;
                        return { count, bytes, active, expiredMode, expired, eventLimit: AppDiagnosticStorage.LIMITS.events };
                    });
                    assert.equal(limits.count.count, 25); assert.equal(limits.eventLimit, 2000);
                    assert.ok(limits.bytes.count < 400 && limits.bytes.count > 200);
                    assert.ok(limits.bytes.bytes <= 2 * 1024 * 1024 && limits.bytes.bytes > 2 * 1024 * 1024 - 8192);
                    assert.ok(limits.bytes.maxEvent <= 8192 && limits.bytes.maxBreadcrumbs <= 50);
                    assert.equal(limits.active.active, true); assert.equal(limits.expiredMode.active, false);
                    assert.equal(limits.expired, 0);
                } else if (scenario === 'reload-concurrent-clear-opt-out-reset') {
                    const id = await page.evaluate(async () => {
                        await AppData.preferences.setTheme('light');
                        const id = AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED' });
                        await AppDiagnostics.flush(); return id;
                    });
                    await ready(page, base);
                    assert.ok(await page.evaluate(id => AppDiagnosticStore.getIncident(id), id));
                    const peer = await context.newPage(); await ready(peer, base);
                    await Promise.all([page, peer].map(p => p.evaluate(async () => {
                        for (let i = 0; i < 25; i++) AppDiagnostics.report({ code: 'RECOVERY_SAVE_FAILED' });
                        await AppDiagnostics.flush();
                    })));
                    const counts = await Promise.all([page, peer].map(p => p.evaluate(async () => (await AppDiagnosticStore.snapshot({ limit: 2000 })).events.length)));
                    assert.equal(counts[0], counts[1]); assert.ok(counts[0] >= 51);
                    assert.equal(await page.evaluate(async () => (await AppDiagnosticStore.clear()).success), true);
                    assert.equal(await peer.evaluate(async () => (await AppDiagnosticStore.snapshot()).events.length), 0);
                    assert.equal(await page.evaluate(() => AppData.preferences.getTheme()), 'light');
                    await page.evaluate(() => AppDiagnosticStore.setEnabled(false));
                    assert.equal(await peer.evaluate(() => AppDiagnosticStore.status().enabled), false);
                    await ready(page, base);
                    assert.equal(await page.evaluate(() => AppDiagnosticStore.status().enabled), false);
                    assert.equal(await page.evaluate(() => AppData.preferences.getTheme()), 'light');
                    await page.evaluate(() => AppDiagnosticStore.setEnabled(true));
                    const reset = await page.evaluate(() => SiteDataReset.perform({ reload: false }));
                    assert.equal(reset.success, true);
                    const survivor = await peer.evaluate(async () => {
                        AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED' }); await AppDiagnostics.flush();
                        return { suspended: AppDiagnosticStore.status().suspended,
                            events: (await AppDiagnosticStore.snapshot()).events.length,
                            retry: (await AppDiagnosticStore.retry()).success,
                            databases: (await indexedDB.databases()).map(db => db.name) };
                    });
                    assert.equal(survivor.suspended, true); assert.equal(survivor.events, 0); assert.equal(survivor.retry, false);
                    assert.ok(!survivor.databases.includes('IELTSAtlasDiagnosticsV1'));
                } else if (scenario === 'passive-fallback') {
                    const fallback = await page.evaluate(async () => {
                        AppDiagnostics.report({ code: 'DATA_EXPORT_FAILED', error: Error('PRIVATE_ANSWER') });
                        await AppDiagnostics.flush();
                        window.acceptanceEffects = [];
                        const forbidden = name => () => { acceptanceEffects.push(name); throw Error('PRIVATE_SIDE_EFFECT'); };
                        for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'open', 'close', 'postMessage']) window[name] = forbidden(name);
                        navigator.sendBeacon = forbidden('beacon');
                        Object.defineProperty(window, 'SystemDiagnostics', { configurable: true, get: forbidden('SystemDiagnostics') });
                        const transaction = IDBDatabase.prototype.transaction;
                        IDBDatabase.prototype.transaction = function (...args) {
                            if (this.name !== AppDiagnosticStorage.DATABASE_NAME || (args[1] && args[1] !== 'readonly')) {
                                return forbidden('business-or-writing-transaction')();
                            }
                            return transaction.apply(this, args);
                        };
                        Storage.prototype.setItem = forbidden('storage-write');
                        for (const name of ['put', 'add', 'delete', 'clear']) IDBObjectStore.prototype[name] = forbidden(name);
                        window.AppDiagnosticStore = { snapshot: async () => { throw Error('PRIVATE_STORAGE'); } };
                        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('PRIVATE_CLIPBOARD'); } } });
                        window.Blob = class { constructor() { throw Error('PRIVATE_FILE'); } };
                        const copy = await AppDiagnosticExport.copySummary();
                        const download = await AppDiagnosticExport.download();
                        const text = document.getElementById('diagnostic-export-text');
                        const selected = text?.readOnly && text.selectionStart === 0 && text.selectionEnd === text.value.length;
                        document.createElement = () => { throw Error('PRIVATE_UI'); };
                        const minimal = await AppDiagnosticExport.download();
                        return { copy: copy.status, download: download.status, selected, text: minimal.text,
                            json: (await AppDiagnosticExport.exportJSON()).json, effects: acceptanceEffects };
                    });
                    assert.equal(fallback.copy, 'text-fallback'); assert.equal(fallback.download, 'text-fallback');
                    assert.equal(fallback.selected, true); assert.ok(Buffer.byteLength(fallback.text) <= 8192);
                    assert.doesNotMatch(fallback.text + fallback.json, sensitive);
                    assert.deepEqual(fallback.effects, []); assert.equal(context.pages().length, 1);
                    assert.equal(page.url(), base + 'index.html');
                }
                results.push({ mode, scenario, passed: true, buildId: manifest.buildId });
                console.log(`PASS ${mode}/${scenario}`);
            } catch (error) {
                results.push({ mode, scenario, passed: false, buildId: manifest.buildId });
                throw error;
            } finally { restore?.(); await context.close(); }
        }
    }
} finally {
    fs.mkdirSync(reportRoot, { recursive: true });
    fs.writeFileSync(path.join(reportRoot, 'diagnostic-acceptance-report.json'), JSON.stringify({ results }, null, 2));
    await browser.close(); await fixture.close();
}
assert.equal(results.length, scenarios.length * 3);
