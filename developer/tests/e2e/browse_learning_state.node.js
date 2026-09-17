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
    const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
        const body = fs.readFileSync(filename);
        response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
        response.end(body);
    }
    catch { response.writeHead(404).end(); }
}
const server = http.createServer(serve);
let openssl = process.env.OPENSSL_EXECUTABLE_PATH || 'openssl';
if (process.platform === 'win32' && !process.env.OPENSSL_EXECUTABLE_PATH) {
    const git = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    const bundled = path.resolve(path.dirname(git), '../usr/bin/openssl.exe');
    if (fs.existsSync(bundled)) openssl = bundled;
}
const certificate = path.join(reports, 'issue151-localhost-cert.pem');
const privateKey = path.join(reports, 'issue151-localhost-key.pem');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey,
    '-out', certificate, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'pipe' });
const secureServer = https.createServer({ key: fs.readFileSync(privateKey), cert: fs.readFileSync(certificate) }, serve);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => secureServer.listen(0, '127.0.0.1', resolve));
let browser;
const report = { status: 'running', cases: [], hosting: 'Isolated local HTTPS static host under /IELTS-practice/; not a deployed-site smoke test.' };

async function boot(page, url) {
    await page.goto(url);
    await page.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
    await page.evaluate(async () => { await window.AppData.ready; await window.LicenseModal.accept(); });
    const close = page.locator('[data-library-action="close"]');
    if (await close.isVisible()) await close.click();
}
async function openBrowse(page) {
    await page.locator('nav button[data-view="browse"]').click();
    await page.waitForSelector('#browse-view.active .exam-item');
    await page.waitForFunction(() => !!window.BrowseLearningControls);
}
async function openMenu(page) {
    if (await page.locator('#browse-learning-panel').isHidden()) await page.locator('#browse-learning-trigger').click();
}
async function choose(page, value) {
    await openMenu(page);
    await page.locator(`[name="browse-learning-state"][value="${value}"]`).check();
    await page.waitForFunction(value => window.AppData.preferences.getBrowse().then(prefs => prefs.learningState === value), value);
}
async function visibleIds(page) { return page.locator('#exam-list-container .exam-item').evaluateAll(items => items.map(item => item.dataset.examId)); }
async function expectIds(page, expected) {
    try {
        await page.waitForFunction(ids => {
            const actual = Array.from(document.querySelectorAll('#exam-list-container .exam-item'), item => item.dataset.examId).sort();
            return JSON.stringify(actual) === JSON.stringify(ids.slice().sort());
        }, expected);
    } catch (error) {
        const actual = await visibleIds(page);
        const selection = await page.evaluate(async () => {
            const prefs = await window.AppData.preferences.getBrowse();
            return { learningState: prefs.learningState, favoritesOnly: prefs.favoritesOnly,
                label: document.querySelector('#browse-learning-label')?.textContent };
        });
        throw new Error(`Unexpected Browse results: ${JSON.stringify({ expected, actual, selection })}`, { cause: error });
    }
}
async function resetFilters(page) {
    await page.evaluate(() => {
        const reset = window.resetBrowseViewToAll;
        window.resetBrowseViewToAll = (...args) => {
            window.resetBrowseViewToAll = reset;
            window.__browseAcceptanceReset = reset(...args);
            return window.__browseAcceptanceReset;
        };
    });
    await page.locator('#browse-learning-reset').click();
    // Rendering is optimistic; wait for the reset owner to finish its durable
    // preference write before a following reload or keyboard interaction.
    const reset = await page.evaluate(async () => {
        const result = await window.__browseAcceptanceReset;
        delete window.__browseAcceptanceReset;
        const prefs = await window.AppData.preferences.getBrowse();
        return { succeeded: result !== false, learningState: prefs.learningState, favoritesOnly: prefs.favoritesOnly };
    });
    assert.deepEqual(reset, { succeeded: true, learningState: 'all', favoritesOnly: false });
}
async function syncRecords(page) {
    await page.evaluate(async () => {
        await ensurePracticeRecordsSync('issue-151-e2e', { forceRender: true, requirePostCommitRead: true });
        await window.__renderBrowseResultsForState();
    });
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
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1365, height: 900 } });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        page.setDefaultNavigationTimeout(60000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        console.log(`[${mode}] boot`);
        await boot(page, `${url}?test_env=1`);
        await openBrowse(page);
        const exams = await page.evaluate(async () => {
            const source = (await window.resolveActiveLibraryIndex()).filter(exam => exam.type === 'reading' && exam.category === 'P1').slice(0, 6);
            const index = source.map((exam, i) => ({ ...exam, title: `Browse Test ${i}`, frequency: i === 3 ? 'low' : 'high', difficultyScore: i + 1 }));
            await window.AppData.library.import({ id: 'browse-a', configuration: { name: 'Browse A' }, index });
            await window.AppData.library.import({ id: 'browse-b', configuration: { name: 'Browse B' }, index });
            await window.LibraryManager.switchLibraryConfig('browse-a');
            const save = (id, exam, score, extra = {}) => window.AppData.practice.completeAttempt({
                record: { id, examId: exam.id, type: 'reading', completedAt: '2026-09-01T10:00:00Z',
                    correctAnswers: score, totalQuestions: 10, metadata: { libraryConfigurationId: 'browse-a' }, ...extra }
            });
            await save('wrong', index[0], 5.99);
            await save('completed', index[1], 6);
            await save('interrupted', index[2], 10, { status: 'interrupted' });
            await save('ungradable', index[3], null);
            await window.AppData.recovery.saveDraft({ id: 'reading:browse-a:' + index[2].id,
                examId: index[2].id, libraryConfigurationId: 'browse-a', answers: { 1: 'KEEP-DRAFT' } });
            await window.AppData.practice.finalizeSuite({ record: {
                id: 'suite', examId: index[5].id, type: 'reading', completedAt: '2026-09-02T10:00:00Z',
                correctAnswers: 20, totalQuestions: 20, metadata: { libraryConfigurationId: 'browse-a' },
                suiteEntries: [{ examId: index[4].id, scoreInfo: { correct: 9, total: 10 } },
                    { examId: index[5].id, scoreInfo: { correct: 4, total: 10 } }]
            } });
            return index;
        });
        await syncRecords(page);
        await expectIds(page, exams.map(exam => exam.id));
        const favorite = page.locator(`.exam-item[data-exam-id="${exams[2].id}"] .browse-favorite-button`);
        await favorite.focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(id => document.querySelector(`.exam-item[data-exam-id="${id}"] .browse-favorite-button`)?.getAttribute('aria-pressed') === 'true', exams[2].id);
        await choose(page, 'wrong');
        await expectIds(page, [exams[0].id, exams[5].id]);
        await page.evaluate(async id => { await window.AppData.practice.completeAttempt({ record: {
            id: 'retake', examId: id, type: 'reading', completedAt: '2026-09-03T10:00:00Z',
            correctAnswers: 10, totalQuestions: 10, metadata: { libraryConfigurationId: 'browse-a' }
        } }); }, exams[0].id);
        await syncRecords(page);
        await expectIds(page, [exams[5].id]);
        await choose(page, 'completed');
        await expectIds(page, [exams[0].id, exams[1].id, exams[4].id, exams[5].id]);
        await choose(page, 'unattempted');
        await expectIds(page, [exams[2].id, exams[3].id]);
        await page.locator('#browse-favorites-only').check();
        await expectIds(page, [exams[2].id]);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#browse-learning-trigger').evaluate(el => el === document.activeElement), true);
        await page.locator('#exam-search-input').fill('no matching passage');
        await expectIds(page, []);
        await page.locator('#exam-search-input').fill('Browse Test');
        await expectIds(page, [exams[2].id]);
        await page.locator('[data-frequency-filter="low"]').click();
        await expectIds(page, []);
        await page.locator('[data-frequency-filter="low"]').click();
        await page.locator('#browse-sort-select').selectOption('difficulty-desc');
        await expectIds(page, [exams[2].id]);
        console.log(`[${mode}] reload and source isolation`);
        await page.reload();
        await page.waitForFunction(() => window.app?.isInitialized === true);
        // The category entry retains the saved learning controls. The top-level
        // Browse navigation is the application's explicit reset-to-all route.
        await page.evaluate(() => window.browseCategory('P1', 'reading'));
        await expectIds(page, [exams[2].id]);
        await page.evaluate(() => window.LibraryManager.switchLibraryConfig('browse-b'));
        await syncRecords(page);
        await expectIds(page, []);
        await openMenu(page);
        await page.locator('#browse-favorites-only').uncheck();
        await expectIds(page, exams.map(exam => exam.id));
        assert.equal(await page.locator('.completion-dot').count(), 0);
        await choose(page, 'completed');
        await expectIds(page, []);
        await page.evaluate(() => window.LibraryManager.switchLibraryConfig('browse-a'));
        await syncRecords(page);
        await expectIds(page, [exams[0].id, exams[1].id, exams[4].id, exams[5].id]);
        await openMenu(page);
        await page.screenshot({ path: path.join(reports, `browse-learning-${mode}-desktop.png`), fullPage: false });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#browse-learning-panel').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(reports, `browse-learning-${mode}-mobile.png`), fullPage: false });
        const panelBox = await page.locator('#browse-learning-panel').boundingBox();
        assert(panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, 'menu fits the narrow viewport');
        await resetFilters(page);
        await expectIds(page, exams.map(exam => exam.id));
        const persisted = await page.evaluate(async () => {
            await window.flushBrowsePreferenceWrites();
            return window.AppData.preferences.getBrowse();
        });
        assert.equal(persisted.learningState, 'all');
        assert.equal(persisted.favoritesOnly, false);
        assert.equal(Object.keys(persisted.readingFavorites).length, 1);
        assert.equal(await page.locator('.browse-favorite-button[aria-pressed="true"]').count(), 1);
        await page.locator('#browse-learning-trigger').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('ArrowDown');
        await expectIds(page, [exams[2].id, exams[3].id]);
        await page.keyboard.press('Escape');
        await openMenu(page);
        await resetFilters(page);
        await expectIds(page, exams.map(exam => exam.id));
        await page.reload();
        await page.waitForFunction(() => window.app?.isInitialized === true);
        await page.evaluate(() => window.browseCategory('P1', 'reading'));
        await expectIds(page, exams.map(exam => exam.id));
        assert.equal(await page.locator('#browse-learning-label').textContent(), '筛选');
        assert.equal(await page.locator('.browse-favorite-button[aria-pressed="true"]').count(), 1);
        assert.deepEqual(errors, []);
        report.cases.push({ mode, status: 'pass', assertions: 'grading, suites, favorites, composition, keyboard, reload, provenance, reset, responsive menu' });
        await context.close();
    }
    report.status = 'pass';
} catch (error) {
    report.status = 'fail'; report.error = error.stack; process.exitCode = 1;
    console.error(error);
} finally {
    fs.writeFileSync(path.join(reports, 'browse-learning-state-report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => secureServer.close(resolve));
}
