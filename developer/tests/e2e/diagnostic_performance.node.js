// Isolated diagnostic history loading and steady-state writes; no personal data.
// SNAPSHOT_ROOT can point at a prior source snapshot for the same benchmark.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = process.env.SNAPSHOT_ROOT || root;
const cpuRate = Number(process.env.CPU_RATE || 4);
const reportFile = process.env.REPORT_FILE || path.join(root, 'developer/tests/e2e/reports/diagnostic-performance.json');
const server = http.createServer((_request, response) => response.end('<!doctype html><title>Isolated diagnostic benchmark</title>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const result = { cpuRate, sourceRoot, cases: [] };
try {
    for (const history of [0, 1000, 2000]) {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            await page.addScriptTag({ content: fs.readFileSync(path.join(sourceRoot, 'js/diagnostics/diagnosticContract.js'), 'utf8') });
            await page.evaluate(async history => {
                const normalizer = AppDiagnosticContract.createNormalizer();
                window.fixtureEvents = Array.from({ length: history + 40 }, (_, index) => normalizer.normalize({
                    code: 'UNEXPECTED_RUNTIME_ERROR', module: 'diagnostics', action: 'report',
                    error: new Error(`Synthetic diagnostic ${index}`), notification: { kind: 'none' },
                    persistence: { generation: 'dg-' + '0'.repeat(32) }
                }));
                if (history) await new Promise((resolve, reject) => {
                    const request = indexedDB.open('IELTSAtlasDiagnosticsV1', 1);
                    request.onupgradeneeded = () => request.result.createObjectStore('events', { keyPath: 'eventId' });
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const db = request.result;
                        const tx = db.transaction('events', 'readwrite');
                        for (const event of fixtureEvents.slice(0, history)) tx.objectStore('events').put({ eventId: event.eventId, event });
                        tx.oncomplete = () => { db.close(); resolve(); };
                        tx.onabort = () => { db.close(); reject(tx.error); };
                    };
                });
                window.measureDiagnostics = async operation => {
                    const tasks = [], gaps = [];
                    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(task => task.duration)));
                    observer.observe({ type: 'longtask' });
                    let last = performance.now(), raf;
                    function frame() { const time = performance.now(); gaps.push(time - last); last = time; raf = requestAnimationFrame(frame); }
                    raf = requestAnimationFrame(frame);
                    const started = performance.now();
                    const receipt = await operation();
                    const elapsedMs = performance.now() - started;
                    await new Promise(resolve => setTimeout(resolve, 60));
                    cancelAnimationFrame(raf);
                    tasks.push(...observer.takeRecords().map(task => task.duration)); observer.disconnect();
                    return { elapsedMs: +elapsedMs.toFixed(1), maxFrameGapMs: +Math.max(0, ...gaps).toFixed(1),
                        longTasks: tasks.map(ms => +ms.toFixed(1)), persistence: receipt?.persistence,
                        persisted: receipt?.persistedEventIds?.length };
                };
            }, history);
            const cdp = await context.newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
            const source = fs.readFileSync(path.join(sourceRoot, 'js/diagnostics/diagnosticStore.js'), 'utf8');
            const startup = await page.evaluate(source => measureDiagnostics(async () => {
                const script = document.createElement('script'); script.textContent = source; document.head.appendChild(script);
                await AppDiagnosticStore.ready;
            }), source);
            const batches = [];
            for (let index = 0; index < 2; index += 1) {
                const sample = await page.evaluate(({ history, index }) => measureDiagnostics(() =>
                    AppDiagnosticStore.append(fixtureEvents.slice(history + index * 20, history + (index + 1) * 20))), { history, index });
                assert.equal(sample.persistence, 'persisted'); assert.equal(sample.persisted, 20);
                batches.push(sample);
            }
            const retained = await page.evaluate(async () => {
                const snapshot = await AppDiagnosticStore.snapshot({ limit: 2000 });
                return { count: snapshot.events.length, bytes: snapshot.events.reduce((sum, event) => sum + AppDiagnosticContract.utf8Bytes(JSON.stringify(event)), 0) };
            });
            assert.ok(retained.count <= 2000 && retained.bytes <= 2 * 1024 * 1024);
            result.cases.push({ history, startup, batches, retained });
        } finally { await context.close(); }
    }
    result.status = 'pass';
} catch (error) { result.status = 'fail'; result.failure = error.stack; process.exitCode = 1; }
finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
