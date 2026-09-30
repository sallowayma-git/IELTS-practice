import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { runRejectedResubmission, runCommittedAcknowledgementLoss, runDelayedSuiteAcknowledgement } from './readingSubmissionReviewCases.js';

const root = path.resolve(process.env.DIAGNOSTIC_RUNTIME_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const reports = path.resolve(process.env.DIAGNOSTIC_REPORT_DIR || path.join(root, 'developer/tests/e2e/reports'));
fs.mkdirSync(reports, { recursive: true });
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-reading-diagnostics-'));
for (const source of ['index.html', 'css', 'js/bundles', 'assets/vendor', 'assets/images',
    'assets/generated/reading-exams', 'assets/generated/reading-explanations']) {
    const destination = path.join(fixture, source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(root, source), destination, { recursive: true });
}
const entry = 'assets/generated/reading-exams/reading-practice-unified.html';
const bundle = 'js/bundles/reading-page.bundle.js';
const dataset = 'assets/generated/reading-exams/p1-high-01.js';
const originalBundle = fs.readFileSync(path.join(root, bundle));
const originalDataset = fs.readFileSync(path.join(root, dataset));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/app\//, '/');
    const file = path.resolve(fixture, '.' + pathname);
    if (!file.startsWith(fixture + path.sep)) return response.writeHead(403).end();
    try {
        const body = fs.readFileSync(file);
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); response.end(body);
    }
    catch (_) { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];

async function openPractice(host, context, base, { examId = 'p1-high-01', suite = false } = {}) {
    await host.goto(base + 'index.html?view=practice', { waitUntil: 'domcontentloaded' });
    await host.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
    await host.waitForFunction(() => window.app?.components.practiceRecorder?.constructor.name === 'PracticeRecorder' && typeof window.app.openExam === 'function');
    const [child] = await Promise.all([context.waitForEvent('page'),
        host.evaluate(async ({ examId, suite }) => {
            if (!suite) return window.app.openExam(examId, { practiceMode: 'single' });
            await window.AppEntry.ensureSessionSuiteReady();
            const index = await window.app._fetchSuiteExamIndex();
            window.app._fetchSuiteExamIndex = async () => ['p1-low-67', 'p2-low-148', 'p3-high-32']
                .map(id => index.find(exam => exam.id === id));
            await window.SuitePreferenceUtils.resolveSuitePreference({ flowMode: 'simulation', frequencyScope: 'all' });
            return window.app.startSuitePractice({ flowMode: 'simulation', frequencyScope: 'all' });
        }, { examId, suite })]);
    await child.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__?.getTestState().sessionReadySent, null, { timeout: 20000 });
    await child.waitForFunction(() => AppDiagnostics.status().transport?.connection === 'connected');
    if (suite) await child.waitForFunction(() => {
        const state = __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
        return state.suiteInline && !state.suiteActivating && state.suiteSequence.length === 3;
    });
    return child;
}

try {
    for (const [mode, base] of [['file', pathToFileURL(fixture + path.sep).href], ['http', origin + '/'], ['subpath', origin + '/app/']]) {
        for (const scenario of ['missing-bundle', 'parse-bundle', 'missing-dataset', 'rejected-initialization',
            'lost-ack-retry', 'rejected-not-committed', 'rejected-nack', 'rejected-timeout',
            'committed-lost-ack-single', 'committed-lost-ack-suite', 'delayed-suite-ack', 'delayed-suite-ack-open',
            'parent-closed', 'parent-reloaded', 'recovery-quota', 'opaque-error']) {
            fs.writeFileSync(path.join(fixture, bundle), originalBundle);
            fs.writeFileSync(path.join(fixture, dataset), originalDataset);
            if (scenario === 'missing-bundle') fs.unlinkSync(path.join(fixture, bundle));
            if (scenario === 'parse-bundle') fs.writeFileSync(path.join(fixture, bundle), 'function invalid( {');
            if (scenario === 'missing-dataset') fs.unlinkSync(path.join(fixture, dataset));
            if (scenario === 'rejected-initialization') fs.appendFileSync(path.join(fixture, bundle),
                '\nwindow.PracticeTimerPreferences = { ready: Promise.reject(new Error("PRIVATE_INITIALIZATION")) };');
            const context = await browser.newContext();
            await context.addInitScript(() => { window.__IELTS_READING_PAGE_TEST_HOOKS__ = true; });
            context.on('page', page => page.on('pageerror', error => errors.push({ mode, scenario, message: error.message })));
            const host = await context.newPage();
            let child = host;
            try {
                if (['missing-bundle', 'parse-bundle', 'missing-dataset', 'rejected-initialization'].includes(scenario)) {
                    await child.goto(base + entry + '?examId=p1-high-01&private=PRIVATE_QUERY', { waitUntil: 'load' });
                    await child.locator('#diagnostic-startup-failure').waitFor();
                    const snapshot = await child.evaluate(() => ({ evidence: AppDiagnosticBootstrap.current().snapshot(),
                        text: AppDiagnosticBootstrap.current().exportText() }));
                    assert.ok(snapshot.evidence.events.length);
                    assert.ok(snapshot.evidence.events.every(event => event.environment.context === 'reading'));
                    assert.ok(snapshot.evidence.events.every(event => event.environment.runMode === mode));
                    assert.ok(!snapshot.text.includes('PRIVATE_'));
                    assert.ok(!snapshot.text.includes(fixture));
                    if (scenario === 'missing-bundle') {
                        const event = snapshot.evidence.events.find(event => event.code === 'RESOURCE_LOAD_FAILED');
                        assert.equal(event.resource.path, bundle); assert.equal(event.resource.status, 'unknown');
                    }
                    if (scenario === 'missing-dataset') assert.ok(snapshot.evidence.events.some(event => event.resource.path === dataset));
                    await child.locator('#diagnostic-startup-failure summary').click();
                    await child.waitForFunction(() => document.querySelector('#diagnostic-startup-failure textarea')?.value.includes('events'));
                    assert.ok((await child.locator('#diagnostic-startup-failure textarea').inputValue()).includes('events'));
                    const download = child.waitForEvent('download');
                    await child.locator('#diagnostic-startup-failure button').click();
                    assert.ok((await download).suggestedFilename().includes('diagnostic'));
                } else {
                    child = await openPractice(host, context, base, {
                        examId: /^(rejected-|committed-lost-ack)/.test(scenario) ? 'p1-low-67' : 'p1-high-01',
                        suite: scenario.startsWith('delayed-suite-ack') || scenario === 'committed-lost-ack-suite'
                    });
                    if (scenario.startsWith('rejected-')) {
                        await runRejectedResubmission(host, child, scenario.slice('rejected-'.length));
                    } else if (scenario.startsWith('committed-lost-ack-')) {
                        await runCommittedAcknowledgementLoss(host, child, scenario.endsWith('suite'));
                    } else if (scenario.startsWith('delayed-suite-ack')) {
                        await runDelayedSuiteAcknowledgement(host, child, scenario.endsWith('-open'));
                    } else if (scenario === 'lost-ack-retry') {
                        await host.evaluate(() => {
                            window.originalPost = window.app._postExamMessage;
                            window.app._postExamMessage = function (examId, target, type, data) {
                                if (type === 'PRACTICE_SUBMIT_ACK') return true; // Commit succeeds, receipt is lost.
                                return originalPost.call(this, examId, target, type, data);
                            };
                        });
                        await child.evaluate(() => __IELTS_UNIFIED_READING_PAGE_TEST__.handleSubmit());
                        await host.waitForFunction(async () => (await AppData.practice.list()).length === 1);
                        await child.evaluate(() => __IELTS_UNIFIED_READING_PAGE_TEST__.expirePendingSubmission());
                        await child.locator('.incident-dialog').waitFor();
                        assert.match(await child.locator('.incident-dialog').innerText(), /尚未确认保存/);
                        const before = await child.evaluate(() => ({ state: __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState(),
                            event: AppDiagnostics.snapshot().events.find(event => event.code === 'PRACTICE_CHANNEL_TIMEOUT' && event.action === 'submit') }));
                        assert.equal(before.event.persistence.operation, 'unconfirmed'); assert.equal(before.event.retry.available, true);
                        await host.waitForFunction(id => !!AppDiagnostics.getIncident(id), before.event.eventId);
                        await host.evaluate(() => { window.app._postExamMessage = originalPost; });
                        await child.getByRole('button', { name: '安全重试原操作' }).click();
                        await child.waitForFunction(() => __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'submitted');
                        await child.waitForFunction(() => document.querySelector('.incident-dialog')?.textContent.includes('已确认保存'));
                        assert.equal(await host.evaluate(async () => (await AppData.practice.list()).length), 1);
                        assert.equal(await child.evaluate(() => __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionId), before.state.submissionId);
                        const hostEvidence = await host.evaluate(() => {
                            const id = AppDiagnostics.report({ code: 'UNEXPECTED_RUNTIME_ERROR', module: 'practice', action: 'report' });
                            return AppDiagnostics.getIncident(id);
                        });
                        const receipt = hostEvidence.breadcrumbs.find(crumb => crumb.action === 'host-receipt' && crumb.correlation.submission === before.event.correlation.submission);
                        assert.ok(receipt, 'host and child share the submission alias');
                        assert.equal(receipt.correlation.scopeId, before.event.correlation.scopeId);
                        assert.equal(receipt.correlation.session, before.event.correlation.session);
                        const exported = await child.evaluate(() => AppDiagnosticExport.exportJSON());
                        assert.equal(exported.report.events.filter(event => event.eventId === before.event.eventId).length, 1);
                        assert.ok(!exported.json.includes(before.state.windowSessionToken));
                        await child.screenshot({ path: path.join(reports, `reading-diagnostics-${mode}-retry.png`) });
                        await child.getByRole('button', { name: '关闭提示（不代表已保存）', exact: true }).click();
                        await child.setViewportSize({ width: 390, height: 844 });
                        assert.equal(await child.evaluate(() => {
                            const notice = document.querySelector('.incident-notifications').getBoundingClientRect();
                            const footer = document.querySelector('.practice-nav').getBoundingClientRect();
                            return notice.bottom <= footer.top;
                        }), true, 'retained notices leave the mobile practice toolbar accessible');
                        await child.screenshot({ path: path.join(reports, `reading-diagnostics-${mode}-mobile.png`) });
                    } else if (scenario === 'parent-closed' || scenario === 'parent-reloaded') {
                        await child.evaluate(() => __IELTS_UNIFIED_READING_PAGE_TEST__.stopReadingDraftSync());
                        if (scenario === 'parent-closed') await host.close({ runBeforeUnload: true }); else await host.reload();
                        const id = await child.evaluate(() => AppDiagnostics.report({ code: 'PRACTICE_CHANNEL_TIMEOUT', module: 'reading', action: 'handshake' }));
                        await child.waitForFunction(() => ['disconnected', 'unavailable'].includes(AppDiagnostics.status().transport.connection));
                        const output = await child.evaluate(() => AppDiagnosticExport.exportJSON());
                        assert.ok(output.report.events.some(event => event.eventId === id));
                        assert.equal(output.report.collection.aggregation, 'incomplete');
                        assert.ok(output.report.collection.limitations.includes('cross-origin-details'));
                        await child.getByRole('button', { name: '错误与诊断', exact: true }).click();
                        await child.getByRole('button', { name: '导出保留的诊断历史' }).waitFor();
                        const download = child.waitForEvent('download');
                        await child.getByRole('button', { name: '导出保留的诊断历史' }).click();
                        await download;
                    } else if (scenario === 'recovery-quota') {
                        const outcome = await child.evaluate(() => {
                            __IELTS_UNIFIED_READING_PAGE_TEST__.stopReadingDraftSync();
                            __IELTS_UNIFIED_READING_PAGE_TEST__.setTestState({ suiteSessionId: 'private-suite' });
                            const original = Storage.prototype.setItem;
                            Storage.prototype.setItem = function (key, value) {
                                if (key.includes(':session:simulation-draft:')) throw new DOMException('PRIVATE_NOTE', 'QuotaExceededError');
                                return original.call(this, key, value);
                            };
                            const result = __IELTS_UNIFIED_READING_PAGE_TEST__.persistSimulationDraftMirror({ answers: { q1: 'PRIVATE_ANSWER' }, noteText: 'PRIVATE_NOTE' });
                            Storage.prototype.setItem = original;
                            return { result, evidence: AppDiagnostics.snapshot() };
                        });
                        assert.equal(outcome.result, false);
                        const failure = outcome.evidence.events.find(event => event.code === 'RECOVERY_SAVE_FAILED');
                        assert.equal(failure.causeCode, 'QUOTA_EXCEEDED');
                        assert.equal(failure.persistence.operation, 'not-committed');
                        assert.ok(!JSON.stringify(outcome).includes('PRIVATE_'));
                        await child.locator('.incident-notice').first().waitFor();
                    } else {
                        const output = await child.evaluate(async () => {
                            dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: 'https://PRIVATE_HOST/hidden.js' }));
                            return AppDiagnosticExport.exportJSON();
                        });
                        const failure = output.report.events.find(event => event.code === 'UNEXPECTED_RUNTIME_ERROR');
                        assert.equal(failure.resource.path, 'unknown');
                        assert.ok(!output.json.includes('PRIVATE_'));
                    }
                }
                results.push({ mode, scenario, passed: true });
                console.log(`PASS ${mode} ${scenario}`);
            } catch (error) {
                console.error(String(error));
                results.push({ mode, scenario, passed: false, error: String(error) });
                if (!child.isClosed()) {
                    await child.screenshot({ path: path.join(reports, `reading-diagnostics-${mode}-${scenario}-failure.png`) }).catch(() => {});
                    console.error(await child.evaluate(() => ({ state: window.__IELTS_UNIFIED_READING_PAGE_TEST__?.getTestState(),
                        diagnostics: window.AppDiagnosticBootstrap?.current()?.snapshot() })).catch(() => ({})));
                }
                throw error;
            } finally { await context.close(); }
        }
    }
} finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(reports, 'reading-diagnostics-report.json'), JSON.stringify({ results, errors }, null, 2));
    assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(fixture, { recursive: true, force: true });
}
