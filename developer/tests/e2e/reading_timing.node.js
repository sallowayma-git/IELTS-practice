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
const certificate = path.join(reports, 'issue153-localhost-cert.pem');
const privateKey = path.join(reports, 'issue153-localhost-key.pem');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey,
    '-out', certificate, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'pipe' });
const server = http.createServer(serve);
const secureServer = https.createServer({ key: fs.readFileSync(privateKey), cert: fs.readFileSync(certificate) }, serve);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => secureServer.listen(0, '127.0.0.1', resolve));
let browser;
const report = { status: 'running', cases: [], hosting: 'Isolated local HTTPS static hosting under /IELTS-practice/; no production deployment.' };

const snapshot = page => page.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.collectCurrentDraft().readingTiming);
async function ready(page) {
    await page.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
    await page.evaluate(async () => { await AppData.ready; await LicenseModal.accept(); });
    await page.evaluate(async () => { await window.ensureBrowseGroup(); await window.AppEntry.ensureSessionSuiteReady(); });
    await page.waitForFunction(() => window.app?.isInitialized && typeof window.app.openExam === 'function');
    const close = page.locator('[data-library-action="close"]');
    if (await close.isVisible()) await close.click();
}
async function readingReady(page) {
    page.on('dialog', dialog => { console.log('dialog:', dialog.message()); dialog.accept(); });
    await page.bringToFront();
    try {
        await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__?.collectCurrentDraft()?.readingTiming, null, { timeout: 25000 });
    } catch (error) {
        console.log(await page.evaluate(() => {
            const state = window.__IELTS_UNIFIED_READING_PAGE_TEST__?.getTestState();
            return { url: location.href, timing: document.getElementById('reading-timing-status')?.textContent,
                state: state && { examId: state.examId, sessionId: state.sessionId, suiteSessionId: state.suiteSessionId,
                    suiteInline: state.suiteInline, suiteActivating: state.suiteActivating, reviewMode: state.reviewMode,
                    readOnly: state.readOnly, submissionStatus: state.submissionStatus } };
        }));
        throw error;
    }
}
async function select(page, questionId) {
    await page.locator(`.q-item[data-question-id="${questionId}"]`).click();
    await page.waitForTimeout(1100);
}
async function waitRecord(page, selector) {
    for (let i = 0; i < 100; i++) {
        const record = await page.evaluate(async key => (await window.AppData.practice.list())
            .find(item => key === 'suite' ? item.suiteMode : item.examId === key), selector);
        if (record) return record;
        await page.waitForTimeout(250);
    }
    throw new Error(`Saved record missing: ${selector}`);
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
        if (process.env.READING_TIMING_MODE && process.env.READING_TIMING_MODE !== mode) continue;
        console.log(`[${mode}] Reading timing acceptance`);
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1365, height: 1000 } });
        await context.addInitScript(() => { window.__IELTS_READING_PAGE_TEST_HOOKS__ = true; });
        const page = await context.newPage();
        const errors = [];
        context.on('page', child => child.on('pageerror', error => errors.push(error.message)));
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${url}?test_env=1`);
        await ready(page);

        // Real IndexedDB ownership and completion, independently of host mirrors.
        const ownership = await page.evaluate(async () => {
            const data = { questionOrder: ['q1'], questionGroups: [] };
            const identity = { attemptId: 'ownership-test', examId: 'timing-fixture', libraryConfigurationId: null, writer: 'first' };
            const meter = new ReadingTiming.Meter(data, identity);
            await AppData.recovery.acquireReadingTiming(meter.snapshot());
            meter.eligibility(true, 0); meter.select('q1', 0); meter.tick(1000);
            const saved = meter.snapshot();
            await AppData.recovery.saveReadingTiming(saved);
            await AppData.recovery.saveReadingTiming(saved);
            const takeover = await AppData.recovery.acquireReadingTiming({ ...saved, writer: 'second' });
            let staleRejected = false;
            try { await AppData.recovery.saveReadingTiming(saved); } catch (error) { staleRejected = error.code === 'TIMING_STALE_WRITER'; }
            const resumed = new ReadingTiming.Meter(data, { ...identity, writer: 'second' }, takeover.snapshot);
            resumed.freeze(90000);
            await AppData.recovery.saveReadingTiming(resumed.snapshot());
            const record = { id: 'timing-record', examId: identity.examId, type: 'reading', duration: 99,
                totalQuestions: 1, correctAnswers: 1, readingTiming: resumed.snapshot(), metadata: { libraryConfigurationId: null } };
            await AppData.practice.completeAttempt({ operationId: 'timing-complete', record });
            await AppData.practice.completeAttempt({ operationId: 'timing-complete', record });
            let finalizedRejected = false;
            try { await AppData.recovery.acquireReadingTiming({ ...saved, writer: 'third' }); } catch (error) { finalizedRejected = error.code === 'TIMING_FINALIZED'; }
            const full = await AppData.practice.get(record.id);
            const light = await AppData.practice.get(record.id, { projection: 'light' });
            const backup = await AppData.backups.create({ id: 'timing-backup' });
            return { staleRejected, finalizedRejected, full, light, backup: Boolean(backup) };
        });
        assert.equal(ownership.staleRejected, true);
        assert.equal(ownership.finalizedRejected, true);
        assert.equal(ownership.full.readingTiming.totalMs, 1000);
        assert.equal(ownership.light.readingTimingSummary.totalMs, 1000);
        assert.equal(ownership.light.readingTiming, undefined);
        assert.equal(ownership.full.duration, 99);
        assert.equal(ownership.backup, true);

        const [reading] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => window.app.openExam('p1-high-01'))]);
        reading.on('console', message => { if (message.type() === 'error') console.log('reading error:', message.text()); });
        await readingReady(reading);
        await reading.waitForTimeout(1200);
        const initial = await snapshot(reading);
        assert.ok(initial.unallocatedMs > 500);
        const first = initial.units[0].questionIds[0];
        await select(reading, first);
        const selected = await snapshot(reading);
        assert.ok(selected.units[0].durationMs > 500);
        if (initial.units[0].questionIds.length > 1) {
            await reading.locator(`.q-item[data-question-id="${initial.units[0].questionIds[1]}"]`).press('Enter');
            await reading.waitForTimeout(1100);
        }
        await reading.locator('#left p').first().click();
        await reading.waitForTimeout(1100);
        assert.ok((await snapshot(reading)).unallocatedMs > initial.unallocatedMs + 500);
        const control = reading.locator('#left .paragraph-dropzone[data-question="q1"]');
        const beforeFocus = await snapshot(reading);
        await control.focus(); // Script-driven autofocus must not select a timing unit.
        await reading.waitForTimeout(1100);
        const afterFocus = await snapshot(reading);
        assert.equal(afterFocus.units[0].durationMs, beforeFocus.units[0].durationMs);
        assert.ok(afterFocus.unallocatedMs > beforeFocus.unallocatedMs + 500);
        await control.click();
        await reading.waitForTimeout(1100);
        assert.ok((await snapshot(reading)).units[0].durationMs > afterFocus.units[0].durationMs + 500);
        await reading.locator('.drag-item[data-heading="viii"]').dragTo(control);
        assert.match(await control.innerText(), /viii/);
        // Headless Chromium keeps every page focused/visible after bringToFront.
        // Drive the DOM lifecycle boundary explicitly and exercise the real meter.
        await reading.evaluate(() => {
            document.hasFocus = () => false;
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            window.dispatchEvent(new Event('blur'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        const unfocused = await snapshot(reading);
        await reading.waitForTimeout(1200);
        assert.equal((await snapshot(reading)).totalMs, unfocused.totalMs);
        await reading.evaluate(() => {
            delete document.hasFocus; delete document.visibilityState; delete document.hidden;
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        });
        await reading.waitForTimeout(1100);
        const refocused = await snapshot(reading);
        assert.equal(refocused.units[0].durationMs, unfocused.units[0].durationMs);
        assert.ok(refocused.unallocatedMs > unfocused.unallocatedMs + 500);
        await reading.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.setTimerRunning(false));
        const paused = await snapshot(reading);
        await reading.waitForTimeout(1500);
        assert.equal((await snapshot(reading)).totalMs, paused.totalMs);
        await reading.reload();
        await readingReady(reading);
        const restored = await snapshot(reading);
        assert.equal(restored.attemptId, paused.attemptId);
        assert.equal(restored.totalMs, paused.totalMs);
        assert.equal(restored.paused, true);
        assert.ok(restored.partialReasons.includes('recovery-tail'));
        await reading.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.setTimerRunning(true));
        await select(reading, first);
        await reading.locator('#reading-timing-status').evaluate(node => { node.open = true; });
        await reading.evaluate(() => {
            window.__timingOriginalPut = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (value, ...args) {
                if (this.name === 'documents' && value.logicalKey === 'recovery.readingTiming') {
                    throw new DOMException('Simulated full storage', 'QuotaExceededError');
                }
                return window.__timingOriginalPut.call(this, value, ...args);
            };
        });
        await reading.locator('.q-item[data-question-id="q1"]').click();
        await reading.waitForFunction(() => document.querySelector('[data-timing-save]')?.textContent.includes('保存失败'));
        await reading.screenshot({ path: path.join(reports, `issue153-${mode}-save-failure.png`) });
        await reading.evaluate(() => {
            IDBObjectStore.prototype.put = window.__timingOriginalPut;
            delete window.__timingOriginalPut;
        });
        await reading.getByRole('button', { name: '重试计时保存', exact: true }).click();
        await reading.waitForFunction(() => document.querySelector('[data-timing-save]')?.textContent.includes('最近确认保存'));
        await reading.screenshot({ path: path.join(reports, `issue153-${mode}-live.png`) });
        await reading.locator('#submit-btn').click();
        const submitted = await waitRecord(page, 'p1-high-01');
        assert.ok(submitted.readingTiming?.frozen, 'submitted record retains its frozen timing');
        assert.ok(submitted.readingTiming.totalMs >= paused.totalMs);
        const frozen = submitted.readingTiming;
        await reading.waitForTimeout(1100);
        assert.deepEqual((await page.evaluate(id => AppData.practice.get(id), submitted.id)).readingTiming, frozen);
        await reading.close();

        // Inline suite: preserve each child across navigation, refresh, and finalization.
        const [suite] = await Promise.all([page.waitForEvent('popup'), page.evaluate(async () => {
            // Exercise the real reading runtime instead of the suite test placeholder.
            window.app._shouldUsePlaceholderPage = () => false;
            await window.app._ensureSuiteRecoveryReady();
            const index = await window.app._fetchSuiteExamIndex();
            const sequence = ['P1', 'P2', 'P3'].map(category => {
                const exam = index.find(item => item.category === category && item.type !== 'listening');
                return { examId: exam.id, exam };
            });
            return window.app._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation', frequencyScope: 'all' });
        })]);
        suite.on('console', message => { if (['error', 'warning'].includes(message.type())) console.log('suite:', message.text()); });
        await readingReady(suite);
        const childIds = [];
        for (let i = 0; i < 3; i++) {
            const state = await suite.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState());
            if (i > 0) {
                await suite.locator(`#part-section-${i + 1} .part-nav-name`).click();
                await suite.waitForFunction(id => window.__IELTS_UNIFIED_READING_PAGE_TEST__.collectCurrentDraft()?.readingTiming?.examId === id,
                    state.suiteSequence[i].examId);
                await suite.waitForTimeout(300);
            }
            const value = await snapshot(suite);
            childIds.push(value.attemptId);
            await select(suite, value.units[0].questionIds[0]);
        }
        await suite.locator('#part-section-1 .part-nav-name').click();
        await suite.waitForTimeout(1100);
        assert.equal((await snapshot(suite)).attemptId, childIds[0]);
        await suite.locator('#part-section-3 .part-nav-name').click();
        await suite.waitForFunction(id => window.__IELTS_UNIFIED_READING_PAGE_TEST__.collectCurrentDraft()?.readingTiming?.attemptId === id, childIds[2]);
        await suite.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.setTimerRunning(false));
        await suite.waitForTimeout(1700);
        await suite.reload();
        await readingReady(suite);
        assert.equal((await snapshot(suite)).attemptId, childIds[2]);
        await suite.locator('#submit-btn').click();
        const suiteRecord = await waitRecord(page, 'suite');
        assert.equal(suiteRecord.suiteEntries.length, 3);
        const actualIds = suiteRecord.suiteEntries.map(entry => entry.readingTiming?.attemptId);
        assert.deepEqual(actualIds, childIds);
        for (const child of suiteRecord.suiteEntries) assert.ok(child.readingTiming.totalMs >= 500);
        const totals = await page.evaluate(record => ReadingTiming.aggregate(record.suiteEntries), suiteRecord);
        assert.equal(totals.totalMs, suiteRecord.suiteEntries.reduce((sum, child) => sum + child.readingTiming.totalMs, 0));
        await page.locator('nav button[data-view="practice"]').click();
        await page.waitForFunction(() => typeof window.practiceHistoryEnhancer?.showRecordDetails === 'function');
        await page.evaluate(id => window.practiceHistoryEnhancer.showRecordDetails(id), suiteRecord.id);
        await page.waitForSelector('#practice-record-modal.modal-overlay.show');
        await page.locator('.reading-timing-record > details').first().evaluate(node => { node.open = true; });
        await page.locator('.reading-timing-record').first().scrollIntoViewIfNeeded();
        await page.locator('#practice-record-modal .modal-container').screenshot({ path: path.join(reports, `issue153-${mode}-records.png`) });
        await page.evaluate(async () => {
            await AppData.practice.completeAttempt({ operationId: 'legacy-timing-fixture', record: {
                id: 'legacy-timing-record', examId: 'historic-reading', type: 'reading', title: 'Historical reading',
                duration: 120, totalQuestions: 1, correctAnswers: 0, metadata: { libraryConfigurationId: null }
            } });
            await window.practiceHistoryEnhancer.showRecordDetails('legacy-timing-record');
        });
        await page.waitForFunction(() => document.querySelector('.reading-timing-record')?.textContent.includes('不可用：无可靠计时数据'));
        assert.doesNotMatch(await page.locator('.reading-timing-record').innerText(), /已测总时长.*0 秒/);
        assert.equal(errors.length, 0, errors.join('\n'));
        report.cases.push({ mode, status: 'pass', singleTotalMs: frozen.totalMs, suiteTotalMs: totals.totalMs,
            ownership: 'stale writer, duplicate snapshot/finalization and finalized takeover checked',
            background: 'controlled visibility/focus lifecycle in headless Chromium; not a native OS backgrounding test',
            browser: browser.version() });
        await context.close();
    }
    report.status = 'pass';
} catch (error) {
    report.status = 'fail'; report.error = error.stack;
    console.error(error);
    process.exitCode = 1;
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => secureServer.close(resolve));
    fs.writeFileSync(path.join(reports, 'reading-timing-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
