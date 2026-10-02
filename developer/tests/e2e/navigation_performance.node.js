// Isolated browser profile; never opens a user's real database or bound folder.
// RECORDS=1000 BASELINE=1 node developer/tests/e2e/navigation_performance.node.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readingScenario } from './reading_performance_scenario.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const baseline = process.env.BASELINE === '1';
const count = Number(process.env.RECORDS || 1000);
const cache = new Map();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') return res.writeHead(204).end();
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
        if (process.env.PACKAGED === '1' && relative.startsWith('js/') && !relative.startsWith('js/bundles/')) return res.writeHead(404).end();
        if (!cache.has(relative)) cache.set(relative, baseline && /^(js|scripts)\//.test(relative)
            ? execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, maxBuffer: 20e6 }) : fs.readFileSync(filename));
        res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }).end(cache.get(relative));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
const missingResources = [];
page.on('response', response => { if (response.status() === 404) missingResources.push(response.url()); });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
await page.addInitScript(() => {
    window.__perfTasks = [];
    new PerformanceObserver(list => window.__perfTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
    window.__detailReads = 0;
    window.__readingFullReads = 0;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
        if (this.name === 'practiceDetails') window.__detailReads++;
        if (this.name === 'documents' && ['vocab.words', 'vocab.lists', 'vocab.readingState'].includes(args[0])) window.__readingFullReads++;
        return get.apply(this, args);
    };
});
const result = { baseline, records: count, metrics: {}, errors };
async function measure(name, action) {
    const start = performance.now();
    const value = await action();
    result.metrics[name] = Math.round((performance.now() - start) * 10) / 10;
    return value;
}
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
try {
    const url = `http://127.0.0.1:${server.address().port}/index.html?test_env=1`;
    await measure('emptyStartupMs', async () => {
        await page.goto(url);
        await page.waitForFunction(() => window.app?.isInitialized);
        await page.evaluate(async () => { await AppData.ready; await window.LicenseModal?.accept(); });
    });
    await page.evaluate(() => document.querySelector('[data-library-action="close"]')?.click());
    result.coldGroups = await page.evaluate(() => ['browse-runtime', 'practice-suite', 'more-tools'].map(name => [name, AppLazyLoader.getStatus(name).loaded]));
    if (process.env.READING_STRESS === '1') {
        await readingScenario(page, result, measure, baseline);
    } else {
    await measure('seedImportMs', () => page.evaluate(async count => {
        const index = await window.resolveActiveLibraryIndex();
        const exams = index.filter(exam => exam.type === 'reading');
        const records = Array.from({ length: count }, (_, i) => ({
            id: `perf-${i}`, sessionId: `perf-${i}`, examId: exams[i % exams.length]?.id || `exam-${i}`,
            type: 'reading', title: `Performance record ${i}`, duration: 1200, status: 'completed',
            date: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
            totalQuestions: 40, correctAnswers: i % 41,
            metadata: { libraryConfigurationId: null, category: `P${i % 3 + 1}` },
            answers: { q1: 'A' }, notes: Array.from({ length: 20 }, (_, n) => ({ id: `${i}-${n}`, body: 'note '.repeat(100) })),
            highlights: Array.from({ length: 20 }, (_, n) => ({ id: `${i}-h-${n}`, text: 'selected text', start: n * 20, end: n * 20 + 13 }))
        }));
        const plan = await AppData.backups.previewImport({ practice_records: records });
        await AppData.backups.commitImport(plan.id);
        // Model an existing V2 installation predating the new analytics fields.
        // Deliberately edit only this disposable test database, with valid checksums.
        const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? `[${v.map(stable).join(',')}]`
            : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v);
        const checksum = v => { let hash = 2166136261; for (const c of stable(v)) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`; };
        await new Promise((resolve, reject) => {
            const request = indexedDB.open('IELTSAtlasDataV2');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('practiceSummaries', 'readwrite');
                const cursor = tx.objectStore('practiceSummaries').openCursor();
                cursor.onsuccess = () => { const row = cursor.result; if (!row) return;
                    const value = row.value; delete value.data.readingAnalytics; delete value.data.browseScore;
                    value.checksum = checksum(value.data); row.update(value); row.continue(); };
                tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
            };
        });
    }, count));
    await measure('populatedStartupMs', async () => { await page.reload(); await page.waitForFunction(() => window.app?.isInitialized); });
    for (const view of ['browse', 'practice', 'more', 'settings', 'overview', 'browse', 'practice']) {
        await page.evaluate(() => { window.ExternalBackupService?.closeModal(); document.querySelector('[data-library-action="close"]')?.click(); });
        await measure(`${view}${result.metrics[`${view}ColdMs`] === undefined ? 'Cold' : 'Warm'}Ms`, async () => {
            await page.locator(`nav button[data-view="${view}"]`).click();
            await page.waitForSelector(`#${view}-view.active`);
            if (view === 'browse') await page.evaluate(() => window.ensureBrowseGroup());
            if (view === 'practice') await page.evaluate(() => window.ensurePracticeRecordsSync('performance', { forceRender: true }));
            await settle();
        });
    }
    result.historyRenderedNodes = await page.locator('.practice-history-list .history-record-item').count();
    if (!baseline) {
        assert.ok(result.historyRenderedNodes > 0 && result.historyRenderedNodes < 100,
            `history must render a bounded viewport, got ${result.historyRenderedNodes}`);
        await page.evaluate(() => {
            const list = document.getElementById('practice-history-list') || document.getElementById('history-list');
            list.scrollTop = list.scrollHeight;
            list.dispatchEvent(new Event('scroll'));
        });
        await page.waitForSelector('.practice-history-list [data-record-id="perf-0"]');
        result.historyBottomRenderedNodes = await page.locator('.practice-history-list .history-record-item').count();
        assert.ok(result.historyBottomRenderedNodes < 100);
        await page.evaluate(() => {
            const list = document.getElementById('practice-history-list') || document.getElementById('history-list');
            list.scrollTop = 0;
            list.dispatchEvent(new Event('scroll'));
        });
        await page.waitForSelector(`.practice-history-list [data-record-id="perf-${count - 1}"]`);
    }
    for (let i = 0; i < 3; i++) await measure(`summaryRead${i}Ms`, () => page.evaluate(async count => {
        const rows = await AppData.practice.list({ projection: 'light' });
        if (rows.length !== count) throw new Error(`Lost records: ${rows.length}/${count}`);
    }, count));
    await measure('fullReadMs', () => page.evaluate(async count => {
        const rows = await AppData.practice.list({ projection: 'full' });
        if (rows.length !== count || rows.some(row => row.notes.length !== 20)) throw new Error('Annotation data lost');
    }, count));
    await measure('jsonExportMs', () => page.evaluate(async () => { const data = await AppData.backups.export(); return JSON.stringify(data).length; }));
    await page.locator('nav button[data-view="browse"]').click();
    await page.waitForSelector('#browse-view.active');
    await page.locator('#browse-learning-trigger').click();
    for (const filter of ['completed', 'wrong', 'unattempted', 'all']) {
        await measure(`filter-${filter}Ms`, async () => {
            await page.locator(`[name="browse-learning-state"][value="${filter}"]`).check();
            await settle();
        });
    }
    }
    result.missingResources = missingResources;
    assert.equal(missingResources.filter(url => new URL(url).pathname.startsWith('/js/')).length, 0,
        'release bundles must not depend on unpackaged JavaScript sources');
    result.runtime = await page.evaluate(() => ({ detailReads: __detailReads, longTasks: __perfTasks.length,
        maxLongTaskMs: Math.max(0, ...__perfTasks), totalLongTaskMs: __perfTasks.reduce((a, b) => a + b, 0),
        scripts: [...document.scripts].map(s => s.src).filter(s => s.includes('bundle') || s.includes('readingVocab')) }));
    assert.equal(errors.length, 0, errors.join('\n'));
    result.status = 'pass';
} catch (error) { result.status = 'fail'; result.failure = error.stack; process.exitCode = 1; }
finally {
    const output = path.join(root, `developer/tests/e2e/reports/${process.env.READING_STRESS === '1' ? 'reading-performance' : 'navigation-performance'}-${baseline ? 'baseline' : 'optimized'}-${process.env.READING_STRESS === '1' ? process.env.WORDS || 1000 : count}.json`);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
