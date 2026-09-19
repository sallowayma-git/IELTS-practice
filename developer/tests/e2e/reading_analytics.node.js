import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
fs.mkdirSync(reports, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve(request, response) {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/IELTS-practice\//, '/');
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
        const body = fs.readFileSync(filename);
        response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
        response.end(body);
    }
    catch { response.writeHead(404).end(); }
}
let openssl = process.env.OPENSSL_EXECUTABLE_PATH || 'openssl';
if (process.platform === 'win32' && !process.env.OPENSSL_EXECUTABLE_PATH) {
    const git = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    const bundled = path.resolve(path.dirname(git), '../usr/bin/openssl.exe');
    if (fs.existsSync(bundled)) openssl = bundled;
}
const certificate = path.join(reports, 'issue152-localhost-cert.pem');
const privateKey = path.join(reports, 'issue152-localhost-key.pem');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey,
    '-out', certificate, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'pipe' });
const server = http.createServer(serve);
const secureServer = https.createServer({ key: fs.readFileSync(privateKey), cert: fs.readFileSync(certificate) }, serve);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => secureServer.listen(0, '127.0.0.1', resolve));
let browser;
const report = { status: 'running', cases: [], hosting: 'Isolated local HTTPS static hosting under /IELTS-practice/; no production deployment.' };

async function sync(page) {
    await page.evaluate(() => ensurePracticeRecordsSync('reading-analytics-e2e', { forceRender: true, requirePostCommitRead: true }));
}

try {
    browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'],
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const modes = [
        ['file', pathToFileURL(path.join(root, 'index.html')).href],
        ['http', `http://127.0.0.1:${server.address().port}/index.html`],
        ['https-subpath', `https://127.0.0.1:${secureServer.address().port}/IELTS-practice/index.html`]
    ];
    for (const [mode, url] of modes) {
        console.log(`[${mode}] Reading analytics acceptance`);
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1365, height: 1000 } });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${url}?test_env=1`);
        await page.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
        await page.evaluate(async () => { await window.AppData.ready; await window.LicenseModal.accept(); });
        const close = page.locator('[data-library-action="close"]');
        if (await close.isVisible()) await close.click();
        await page.locator('nav button[data-view="practice"]').click();
        await page.waitForSelector('#practice-view.active');
        await page.waitForFunction(() => !!window.ReadingAnalytics);
        await page.evaluate(async () => {
            await window.AppData.practice.clear();
            const now = new Date().toISOString();
            const row = (id, examId, earned, possible, category, extra = {}) => ({
                id, sessionId: id, examId, title: examId === 'a' ? 'Alpha passage' : `Passage ${examId}`,
                type: 'reading', status: 'completed', date: now, correctAnswers: earned, totalQuestions: possible,
                metadata: { libraryConfigurationId: 'analytics-a', category },
                questionTypePerformance: { 'multiple-choice': { correct: earned, total: possible } }, ...extra
            });
            const save = record => window.AppData.practice.completeAttempt({ record });
            await save(row('a1', 'a', 1, 2, 'P1', { date: new Date(Date.now() - 40 * 86400000).toISOString() }));
            await save(row('a2', 'a', 9, 10, 'P1'));
            await save(row('fraction', 'b', 1.5, 3, 'P2'));
            const child = row('child', 'c', 2, 4, 'P3');
            await window.AppData.practice.finalizeSuite({ record: row('suite', 'suite', 3, 5, null, {
                suiteMode: true, suiteEntries: [child, row('suite-a', 'a', 1, 1, 'P1')]
            }) });
            await save(child);
            await save(row('unknown', '', 0, 0, null, { date: undefined, questionTypePerformance: {} }));
            await save(row('parent-only', 'old-suite', 9, 10, null, { suiteMode: true }));
            for (const [id, extra] of Object.entries({ listening: { type: 'listening' }, draft: { status: 'draft' },
                interrupted: { status: 'interrupted' }, ungradable: { gradable: false }, demo: { dataSource: 'demo' } })) {
                await save(row(id, id, 100, 100, 'P3', extra));
            }
        });
        await sync(page);
        const panel = page.locator('.reading-analytics');
        await page.waitForFunction(() => document.querySelector('.reading-analytics__summary dd')?.textContent === '72.5%');
        assert.match(await panel.innerText(), /14.5 \/ 20 分/);
        assert.match(await panel.innerText(), /可评分 5 \/ 6 次/);
        assert.match(await panel.innerText(), /3 篇/);
        assert.match(await panel.innerText(), /90.0%/);
        assert.match(await panel.innerText(), /题型完整覆盖 5 \/ 5/);
        await panel.screenshot({ path: path.join(reports, `reading-analytics-${mode}-desktop.png`) });
        await page.locator('#reading-analytics-range').selectOption('7');
        assert.equal(await page.locator('.reading-analytics__summary dd').first().innerText(), '75.0%');
        assert.match(await panel.innerText(), /日期未知而排除 1 条/);
        await page.locator('#reading-analytics-range').selectOption('all');
        await page.locator('#record-type-filter-buttons [data-filter-type="listening"]').click();
        await page.waitForFunction(() => document.getElementById('reading-analytics-content').textContent.includes('当前选择的是听力记录'));
        assert.equal(await panel.locator('table').count(), 0);
        await page.locator('#record-type-filter-buttons [data-filter-type="reading"]').click();
        await page.waitForFunction(() => document.querySelector('.reading-analytics__summary dd')?.textContent === '72.5%');
        await page.evaluate(() => searchPracticeHistory('Alpha'));
        await page.waitForFunction(() => document.querySelector('.reading-analytics__summary dd')?.textContent === '83.3%');
        await page.evaluate(() => searchPracticeHistory(''));
        await sync(page);
        const beforeSwitch = await panel.innerText();
        await page.evaluate(async () => {
            const source = (await window.resolveActiveLibraryIndex()).filter(exam => exam.type === 'reading').slice(0, 3);
            const index = source.map((exam, i) => ({ ...exam, id: ['a', 'b', 'c'][i], category: 'P2' }));
            await window.AppData.library.import({ id: 'analytics-b', configuration: { name: 'Analytics B' }, index });
            await window.LibraryManager.switchLibraryConfig('analytics-b');
        });
        await page.locator('nav button[data-view="practice"]').click();
        await sync(page);
        assert.equal(await panel.innerText(), beforeSwitch);
        await page.reload();
        await page.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
        const closeAfterReload = page.locator('[data-library-action="close"]');
        if (await closeAfterReload.isVisible()) await closeAfterReload.click();
        await page.locator('nav button[data-view="practice"]').click();
        await sync(page);
        assert.equal(await page.locator('.reading-analytics__summary dd').first().innerText(), '72.5%');
        await page.setViewportSize({ width: 390, height: 844 });
        await panel.screenshot({ path: path.join(reports, `reading-analytics-${mode}-mobile.png`) });
        assert.equal(await panel.evaluate(element => element.getBoundingClientRect().right <= innerWidth + 1), true);
        await page.evaluate(() => window.AppData.practice.clear());
        await sync(page);
        assert.match(await panel.innerText(), /当前范围暂无可统计/);
        assert.doesNotMatch(await panel.innerText(), /0\.0%|NaN|Infinity/);
        assert.deepEqual(errors, []);
        report.cases.push({ mode, status: 'pass', checks: 'weighted/fractional scores, suite dedup/fallback, window and record/search filters, library switch, reload, mobile, empty state' });
        await context.close();
    }
    report.status = 'pass';
} catch (error) {
    report.status = 'fail'; report.error = error.stack; process.exitCode = 1;
    console.error(error);
} finally {
    fs.writeFileSync(path.join(reports, 'reading-analytics-report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => secureServer.close(resolve));
}
