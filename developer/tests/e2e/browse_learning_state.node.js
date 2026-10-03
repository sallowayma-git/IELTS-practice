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
let activePage;
let activeMode;
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
async function committedBrowsePreferences(page) {
    return page.evaluate(async () => {
        // Playwright 1.56 treats an async waitForFunction predicate's Promise
        // as truthy, even when it resolves to false. Wait for the actual write
        // queue before reading, particularly before a reload can abort it.
        await window.flushBrowsePreferenceWrites();
        return window.AppData.preferences.getBrowse();
    });
}
async function choose(page, value) {
    await openMenu(page);
    await page.locator(`[name="browse-learning-state"][value="${value}"]`).check();
    assert.equal((await committedBrowsePreferences(page)).learningState, value);
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
    await page.locator('#browse-learning-reset').click();
    const reset = await committedBrowsePreferences(page);
    assert.equal(reset.learningState, 'all');
    assert.equal(reset.favoritesOnly, false);
    assert.equal(reset.sortMode, 'difficulty-desc');
}
async function syncRecords(page) {
    await page.evaluate(async () => {
        await ensurePracticeRecordsSync('issue-151-e2e', { forceRender: true, requirePostCommitRead: true });
        await window.__renderBrowseResultsForState();
    });
}

async function verifyThemeContrast(page, mode) {
    const contrasts = [];
    const original = await page.locator('body').getAttribute('data-bg-theme');
    for (const theme of [null, 'ascii-flower']) {
        await page.evaluate(theme => {
            if (theme) document.body.setAttribute('data-bg-theme', theme);
            else document.body.removeAttribute('data-bg-theme');
        }, theme);
        const values = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            const rgba = color => {
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                return [...context.getImageData(0, 0, 1, 1).data].map(value => value / 255);
            };
            const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
            const luminance = color => color.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
                .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
            return ['browse-learning-trigger', 'browse-learning-reset'].map(id => {
                const element = document.getElementById(id);
                const chain = [];
                for (let current = element; current; current = current.parentElement) chain.unshift(current);
                const background = chain.reduce((color, node) => over(rgba(getComputedStyle(node).backgroundColor), color), [1, 1, 1]);
                const text = over(rgba(getComputedStyle(element).color), background);
                const lights = [luminance(text), luminance(background)].sort((a, b) => a - b);
                return { id, ratio: (lights[1] + 0.05) / (lights[0] + 0.05) };
            });
        });
        for (const value of values) assert(value.ratio >= 4.5, `${theme || 'default'} ${value.id} contrast ${value.ratio} must reach 4.5:1`);
        contrasts.push({ theme: theme || 'default', values });
        await page.screenshot({ path: path.join(reports, `browse-learning-${mode}-${theme || 'default'}-contrast.png`), fullPage: false });
    }
    await page.evaluate(theme => {
        if (theme) document.body.setAttribute('data-bg-theme', theme);
        else document.body.removeAttribute('data-bg-theme');
    }, original);
    return contrasts;
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
        activeMode = mode;
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1365, height: 900 } });
        // Record state transitions without inserting awaits into the flow: an
        // extra preference read can hide the ordering race being diagnosed.
        await context.addInitScript(() => {
            window.__browseSortTrace = [];
            let sortMode;
            let lastChange = null;
            document.addEventListener('change', event => {
                lastChange = { name: event.target.name, id: event.target.id,
                    value: event.target.value, checked: event.target.checked };
            }, true);
            Object.defineProperty(window, '__browseSortMode', {
                configurable: true,
                get() { return sortMode; },
                set(value) {
                    const previous = sortMode;
                    sortMode = value;
                    if (previous === value) return;
                    window.__browseSortTrace.push({ previous, value, lastChange,
                        checked: document.querySelector('[name="browse-sort-mode"]:checked')?.value,
                        stack: new Error().stack });
                }
            });
        });
        const page = await context.newPage();
        activePage = page;
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
        await page.evaluate(() => window.AppData.backups.create({ id: 'browse-empty-favorites' }));
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
        await openMenu(page);
        await page.locator('[name="browse-sort-mode"][value="difficulty-desc"]').check();
        await expectIds(page, [exams[2].id]);
        assert.equal((await committedBrowsePreferences(page)).sortMode, 'difficulty-desc');
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
        const contrast = await verifyThemeContrast(page, mode);
        await page.screenshot({ path: path.join(reports, `browse-learning-${mode}-desktop.png`), fullPage: false });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#browse-learning-panel').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(reports, `browse-learning-${mode}-mobile.png`), fullPage: false });
        const panelBox = await page.locator('#browse-learning-panel').boundingBox();
        assert(panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, 'menu fits the narrow viewport');
        await resetFilters(page);
        await expectIds(page, exams.map(exam => exam.id));
        const persisted = await committedBrowsePreferences(page);
        assert.equal(persisted.learningState, 'all');
        assert.equal(persisted.favoritesOnly, false);
        assert.equal(Object.keys(persisted.readingFavorites).length, 1);
        assert.equal(await page.locator('.browse-favorite-button[aria-pressed="true"]').count(), 1);
        await page.locator('#browse-learning-trigger').focus();
        await page.keyboard.press('Enter');
        // The panel contains independent sort and learning-state radio
        // groups. Focus the state group's current option before exercising
        // native ArrowDown navigation so the assertion cannot accidentally
        // mutate the preserved sort mode.
        await page.locator('[name="browse-learning-state"][value="all"]').focus();
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
        assert.equal(await page.locator('#browse-learning-label').textContent(), '排序筛选');
        assert.equal(await page.locator('.browse-favorite-button[aria-pressed="true"]').count(), 1);
        console.log(`[${mode}] same-page backup restore`);
        await page.evaluate(() => window.AppData.backups.create({ id: 'browse-saved-favorite' }));
        await page.locator('nav button[data-view="settings"]').click();
        await page.locator('#backup-list-btn').click();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('[data-backup-action="restore"][data-backup-id="browse-empty-favorites"]').click();
        // Wait for Settings' delayed post-restore list refresh before dismissing.
        await page.locator('#backup-list-modal .backup-entry[data-backup-id^="pre_restore_"]').first().waitFor();
        const restored = await committedBrowsePreferences(page);
        assert.equal(Object.keys(restored?.readingFavorites || {}).length, 0);
        await page.locator('#backup-list-modal [data-backup-action="close-modal"]').click();
        await openBrowse(page);
        await expectIds(page, exams.map(exam => exam.id));
        await page.waitForFunction(() => document.querySelectorAll('.browse-favorite-button[aria-pressed="true"]').length === 0);
        assert.equal(await page.locator('.browse-favorite-button[aria-pressed="true"]').count(), 0);
        await openMenu(page);
        await page.locator('#browse-favorites-only').check();
        await expectIds(page, []);
        assert.equal((await committedBrowsePreferences(page)).favoritesOnly, true);
        await page.waitForFunction(() => !window.__isBrowseUserResultsRequestInFlight(window.__getBrowseResultsRequestId()));
        await page.evaluate(async () => {
            // The filter's scroll adjustment persists after a 150ms debounce.
            // Wait for preference commits to settle before taking a restore plan;
            // a real intervening write must still fail snapshot revalidation.
            await new Promise(resolve => {
                let timer;
                const settled = () => {
                    clearTimeout(timer);
                    timer = setTimeout(() => { unsubscribe(); resolve(); }, 250);
                };
                const unsubscribe = window.AppData.backups.onDataCommitted(event => {
                    if (event.targets.some(target => target.logicalKey === 'preferences.values')) settled();
                });
                settled();
            });
            await window.flushBrowsePreferenceWrites();
        });
        // Restore a nonempty map while Browse is active: no navigation or reload
        // may be needed to update both the filtered results and star state.
        await page.evaluate(() => window.AppData.backups.restore('browse-saved-favorite'));
        await expectIds(page, [exams[2].id]);
        assert.equal(await page.locator('.browse-favorite-button[aria-pressed="true"]').count(), 1);
        assert.deepEqual(errors, []);
        report.cases.push({ mode, status: 'pass', contrast, assertions: 'grading, suites, favorites, composition, keyboard, reload, provenance, reset, same-page restore, theme contrast, responsive menu' });
        await context.close();
    }
    report.status = 'pass';
} catch (error) {
    report.status = 'fail'; report.error = error.stack; process.exitCode = 1;
    console.error(error);
    if (activePage && !activePage.isClosed()) {
        report.failureMode = activeMode;
        report.browseDiagnostics = await activePage.evaluate(async () => ({
            sortMode: window.__browseSortMode,
            checkedSortMode: document.querySelector('[name="browse-sort-mode"]:checked')?.value,
            preferences: await window.AppData?.preferences.getBrowse(),
            sortTrace: window.__browseSortTrace
        })).catch(diagnosticError => ({ error: diagnosticError.message }));
        console.error('Browse failure diagnostics:', JSON.stringify(report.browseDiagnostics));
    }
} finally {
    fs.writeFileSync(path.join(reports, 'browse-learning-state-report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => secureServer.close(resolve));
}
