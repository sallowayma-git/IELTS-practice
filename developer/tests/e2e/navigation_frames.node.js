// Frame callbacks and long tasks around actual page switches in an isolated profile.
// SNAPSHOT_ROOT=/tmp/ielts-navigation-before RECORDS=5000 CPU_RATE=4 node ...
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const snapshot = process.env.SNAPSHOT_ROOT;
const records = Number(process.env.RECORDS || 5000);
const cpuRate = Number(process.env.CPU_RATE || 4);
const windowMs = Number(process.env.WINDOW_MS || 1000);
const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
    let file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    if (relative.startsWith('js/') && !relative.startsWith('js/bundles/')) return res.writeHead(404).end();
    if (snapshot && fs.existsSync(path.join(snapshot, relative))) file = path.join(snapshot, relative);
    try { const bytes = fs.readFileSync(file); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream' }).end(bytes); }
    catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const result = { snapshot: snapshot || null, records, cpuRate, windowMs, switches: [], errors };
try {
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test_env=1`);
    await page.waitForFunction(() => window.app?.isInitialized);
    await page.evaluate(async records => {
        await AppData.ready; await window.LicenseModal?.accept();
        const exams = (await resolveActiveLibraryIndex()).filter(e => e.type === 'reading');
        const rows = Array.from({ length: records }, (_, i) => ({ id: `frame-${i}`, sessionId: `frame-${i}`,
            examId: exams[i % exams.length]?.id || 'missing', title: `Frame record ${i}`, type: 'reading',
            duration: 1200, status: 'completed', date: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
            totalQuestions: 40, correctAnswers: i % 41, answers: { q1: 'A' } }));
        const plan = await AppData.backups.previewImport({ practice_records: rows });
        await AppData.backups.commitImport(plan.id);
    }, records);
    await page.reload(); await page.waitForFunction(() => window.app?.isInitialized);
    // Let boot-only work settle; the window below measures navigation work.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    const sequence = ['browse', 'practice', 'more', 'settings', 'overview', 'practice', 'overview', 'settings', 'more', 'browse', 'practice', 'overview', 'settings', 'more', 'browse'];
    for (const [index, view] of sequence.entries()) {
        const sample = await page.evaluate(async ({ view, windowMs }) => {
            window.ExternalBackupService?.closeModal(); document.querySelector('[data-library-action="close"]')?.click();
            let done = false, last, activeFrameMs = null, raf;
            const gaps = [], tasks = [];
            const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
            observer.observe({ type: 'longtask' });
            const started = performance.now();
            function frame(now) {
                now = performance.now();
                if (done) return;
                if (last !== undefined) gaps.push(now - last);
                else gaps.push(now - started);
                last = now;
                if (activeFrameMs === null && document.getElementById(`${view}-view`)?.classList.contains('active')) activeFrameMs = now - started;
                raf = requestAnimationFrame(frame);
            }
            raf = requestAnimationFrame(frame);
            document.querySelector(`nav button[data-view="${view}"]`).click();
            await new Promise(resolve => setTimeout(resolve, windowMs));
            await new Promise(resolve => requestAnimationFrame(resolve));
            done = true; cancelAnimationFrame(raf);
            tasks.push(...observer.takeRecords().map(e => e.duration)); observer.disconnect();
            const sorted = gaps.slice().sort((a, b) => a - b);
            return { view, activeFrameMs: Math.round(activeFrameMs), frameCallbacks: gaps.length,
                maxFrameGapMs: Math.round(Math.max(0, ...gaps)), p95FrameGapMs: Math.round(sorted[Math.floor(sorted.length * .95)] || 0),
                gapsOver35Ms: gaps.filter(ms => ms > 35).length, longTasks: tasks.length,
                longestTaskMs: Math.round(Math.max(0, ...tasks)), longTaskTotalMs: Math.round(tasks.reduce((a, b) => a + b, 0)),
                active: document.querySelector('.view.active')?.id };
        }, { view, windowMs });
        sample.phase = index < 5 ? 'cold' : 'warm'; result.switches.push(sample);
        assert.equal(sample.active, `${view}-view`);
    }
    await page.evaluate(async () => {
        // Consecutive intents must cancel obsolete deferred activation.
        showView('practice', false); showView('browse', false); showView('more', false); showView('settings', false);
        await new Promise(resolve => setTimeout(resolve, 400));
    });
    assert.equal(await page.evaluate(() => document.querySelector('.view.active')?.id), 'settings-view');
    assert.equal(await page.evaluate(async () => (await AppData.practice.list({ projection: 'light' })).length), records);
    assert.deepEqual(errors, []);
    result.status = 'pass';
} catch (error) { result.status = 'fail'; result.failure = error.stack; process.exitCode = 1; }
finally {
    const directory = path.join(root, 'developer/tests/e2e/reports'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `navigation-frames-${snapshot ? 'before' : 'after'}-${records}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
