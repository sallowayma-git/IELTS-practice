import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { reviewScenarios, exerciseReviewScenario, assertReviewScenario } from './operationReviewCases.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
fs.mkdirSync(reports, { recursive: true });
const fixture = path.join(reports, 'operation-diagnostics-fixture.html');
const sources = ['js/diagnostics/diagnosticContract.js', 'js/diagnostics/bootstrapCollector.js',
    'js/diagnostics/diagnosticReporter.js', 'js/diagnostics/operationDiagnostics.js',
    'js/data/practiceRecordSource.js', 'js/data/v2/dataCatalog.js', 'js/data/v2/dataKernel.js',
    'js/data/v2/readingVocabularyModel.js', 'js/data/v2/appData.js', 'js/core/practiceCore.js',
    'js/core/practiceRecorder.js', 'js/app/examSessionMixin.js', 'js/app/suitePracticeMixin.js',
    'js/presentation/incident-center.js', 'js/presentation/message-center.js'];
fs.writeFileSync(fixture, '<!doctype html><meta charset="utf-8"><title>Operation diagnostics fixture</title>'
    + '<link rel="stylesheet" href="../../../../css/main.css"><body><button id="focus">Practice</button>'
    + sources.map(source => `<script src="../../../../${source}"></script>` + (source.endsWith('dataKernel.js')
        ? '<script>window.TestKernel=__AppDataV2Internals.DataKernel;window.TestDataError=__AppDataV2Internals.AppDataError;</script>' : '')).join('\n')
    + '<script>AppData.ready.catch(()=>{});AppDiagnostics.markReady();window.resolveActiveLibraryIndex=async()=>[];</script>');
const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname).replace(/^\/app\//, '/');
    const target = path.resolve(root, '.' + pathname);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': target.endsWith('.js') ? 'application/javascript; charset=utf-8'
        : target.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(target));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
// Business completion and diagnostic capture intentionally precede ordinary
// notice DOM work. Keep assertions against the eventual visible presentation.
async function waitForIncidentPresentation(page, result) {
    const event = result.events.find(event => ['persistent', 'dialog'].includes(event.notification.kind));
    if (event) {
        await page.waitForFunction(id => document.body.textContent.includes(id), event.eventId);
        result.text = await page.locator('body').textContent();
    }
}
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const [mode, url] of [['file', pathToFileURL(fixture).href],
        ['http', origin + '/developer/tests/e2e/reports/operation-diagnostics-fixture.html'],
        ['subpath', origin + '/app/developer/tests/e2e/reports/operation-diagnostics-fixture.html']]) {
        for (const scenario of ['quota', 'aborted-transaction', 'timeout', 'backend-unavailable', 'readback-after-commit',
            'receipt-reconciliation', 'recovery-failure', 'import-export-failure', 'reporter-failure', ...reviewScenarios]) {
            const context = await browser.newContext();
            const page = await context.newPage();
            try {
                await page.goto(url);
                await page.evaluate(() => AppData.ready);
                if (reviewScenarios.includes(scenario)) {
                    if (scenario.includes('import')) {
                        await page.addScriptTag({ path: path.join(root, 'js/core/externalBackupService.js') });
                        await page.addScriptTag({ path: path.join(root, 'js/boot-fallbacks.js') });
                    }
                    const result = await page.evaluate(exerciseReviewScenario, scenario);
                    await waitForIncidentPresentation(page, result);
                    assertReviewScenario(scenario, result);
                    results.push({ mode, scenario, passed: true });
                    continue;
                }
                const result = await page.evaluate(async scenario => {
                    const record = { id: 'original-record', examId: 'reading-original', sessionId: 'original-session',
                        submissionId: 'original-submission', operationId: 'original-operation', type: 'reading',
                        status: 'completed', totalQuestions: 1, correctAnswers: 1,
                        startTime: '2026-09-28T00:00:00.000Z', endTime: '2026-09-28T00:01:00.000Z',
                        answers: { q1: 'PRIVATE_ANSWER' }, notes: 'PRIVATE_NOTES', windowSessionToken: 'PRIVATE_TOKEN' };
                    const r = Object.create(PracticeRecorder.prototype);
                    const nativeMutation = TestKernel.prototype.mutateEntities;
                    let businessWrites = 0;
                    TestKernel.prototype.mutateEntities = async function (...args) {
                        businessWrites++;
                        return nativeMutation.apply(this, args);
                    };
                    let caught = null, verified = null, businessResult = null;
                    const result = {};
                    if (scenario === 'quota') {
                        const put = IDBObjectStore.prototype.put;
                        IDBObjectStore.prototype.put = function (...args) {
                            if (this.name === 'practiceSummaries') throw new DOMException('PRIVATE_ANSWER', 'QuotaExceededError');
                            return put.apply(this, args);
                        };
                    }
                    if (scenario === 'aborted-transaction') {
                        const transaction = IDBDatabase.prototype.transaction;
                        IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
                            const tx = transaction.call(this, stores, mode, ...args);
                            if (mode === 'readwrite' && Array.from(tx.objectStoreNames).includes('practiceSummaries')) {
                                queueMicrotask(() => tx.abort());
                            }
                            return tx;
                        };
                    }
                    if (scenario === 'timeout' || scenario === 'backend-unavailable') {
                        TestKernel.prototype.mutateEntities = async function () {
                            businessWrites++;
                            throw new TestDataError('BACKEND_UNAVAILABLE', 'PRIVATE_TOKEN',
                                scenario === 'timeout' ? { reason: 'timeout' } : {});
                        };
                    }
                    if (scenario === 'readback-after-commit') {
                        let committed = false;
                        const read = TestKernel.prototype.readPracticeSnapshot;
                        TestKernel.prototype.readPracticeSnapshot = function (...args) {
                            if (committed) throw new TestDataError('BACKEND_UNAVAILABLE', 'PRIVATE_NOTES');
                            return read.apply(this, args);
                        };
                        TestKernel.prototype.mutateEntities = async function (...args) {
                            businessWrites++;
                            const receipt = await nativeMutation.apply(this, args);
                            committed = true;
                            return receipt;
                        };
                    }
                    if (scenario === 'recovery-failure') {
                        TestKernel.prototype.mutate = async function () { throw new TestDataError('QUOTA_EXCEEDED', 'PRIVATE_ANSWER'); };
                        try { await r.saveToTemporaryStorage(record); } catch (error) { caught = error; }
                    } else if (scenario === 'import-export-failure') {
                        try { await r.importData('PRIVATE_INVALID_JSON'); } catch (error) { caught = error; }
                        try { await r.exportData('PRIVATE_UNSUPPORTED_FORMAT'); } catch (error) { caught = error; }
                    } else {
                        if (scenario === 'reporter-failure') {
                            window.AppDiagnostics = { report() { throw Error('broken reporter'); }, breadcrumb() { throw Error('broken breadcrumb'); } };
                        }
                        try { businessResult = await r.savePracticeRecord(record); } catch (error) { caught = error; }
                        if (scenario === 'receipt-reconciliation' || scenario === 'readback-after-commit' || scenario === 'reporter-failure') {
                            const before = businessWrites;
                            verified = await AppData.practice.getCommitState(record.operationId);
                            result.reconciliationWrites = businessWrites - before;
                            result.missing = await AppData.practice.getCommitState('unknown-operation');
                        }
                        if (scenario === 'receipt-reconciliation') {
                            const source = { closed: false };
                            const info = { window: source };
                            const app = Object.assign({}, ExamSystemAppMixins.examSession, {
                                examWindows: new Map([['reading-original', info]]),
                                _resolveExamWindowSessionForTarget: () => ({ examId: 'reading-original', windowInfo: info }),
                                _resolveExamWindowSessionKey: () => 'reading-original',
                                _postExamMessage: () => false
                            });
                            app._announcePracticeSubmitOutcome('reading-original', record, source, true);
                            result.replayed = app._replayPracticeSubmitReceipt('reading-original', record, source);
                            result.originalIds = Object.values(info.practiceSubmitReceipts)[0];
                            result.count = (await AppData.practice.list()).length;
                        }
                    }
                    const events = AppDiagnosticBootstrap.current().snapshot().events;
                    result.events = events.filter(event => event.collection.source === 'business');
                    result.verified = verified;
                    result.caught = Boolean(caught);
                    result.saved = Boolean(businessResult?.id);
                    result.businessResult = businessResult === false ? false : null;
                    result.text = document.body.textContent;
                    return result;
                }, scenario);
                await waitForIncidentPresentation(page, result);
                assert.doesNotMatch(JSON.stringify(result.events), /PRIVATE_|original-operation|original-submission|original-session/);
                if (['quota', 'aborted-transaction', 'backend-unavailable', 'timeout'].includes(scenario)) {
                    assert.equal(result.caught, true);
                    assert.equal(result.events.length, 1);
                    const event = result.events[0];
                    assert.equal(event.code, 'PRACTICE_SAVE_FAILED');
                    assert.equal(event.causeCode, scenario === 'quota' ? 'QUOTA_EXCEEDED' : 'BACKEND_UNAVAILABLE');
                    assert.equal(event.persistence.operation, scenario === 'timeout' ? 'unconfirmed' : 'not-committed');
                    assert.equal(event.notification.kind, scenario === 'timeout' ? 'dialog' : 'persistent');
                    assert.ok(result.text.includes(event.eventId));
                } else if (scenario === 'readback-after-commit') {
                    assert.equal(result.caught, true);
                    assert.equal(result.events[0].persistence.operation, 'committed');
                    assert.equal(result.verified.operation, 'committed');
                    assert.equal(result.reconciliationWrites, 0);
                } else if (scenario === 'receipt-reconciliation') {
                    assert.equal(result.verified.operation, 'committed');
                    assert.equal(result.missing.operation, 'unconfirmed');
                    assert.equal(result.reconciliationWrites, 0);
                    assert.equal(result.count, 1);
                    assert.equal(result.replayed, true);
                    assert.equal(result.originalIds.submissionId, 'original-submission');
                    assert.ok(result.events.every(event => event.persistence.operation === 'unconfirmed'));
                    assert.ok(result.events.every(event => event.action === 'acknowledgement'
                        && event.notification.kind === 'persistent'));
                    assert.doesNotMatch(result.text, /练习提交尚未确认保存/);
                } else if (scenario === 'recovery-failure') {
                    assert.equal(result.events[0].code, 'RECOVERY_SAVE_FAILED');
                    assert.equal(result.events[0].causeCode, 'QUOTA_EXCEEDED');
                    assert.doesNotMatch(result.text, /已确认保存|快照已保留/);
                } else if (scenario === 'import-export-failure') {
                    assert.deepEqual(result.events.map(event => event.code), ['DATA_IMPORT_FAILED', 'DATA_EXPORT_FAILED']);
                } else if (scenario === 'reporter-failure') {
                    assert.equal(result.saved, true);
                    assert.equal(result.caught, false);
                    assert.equal(result.verified.operation, 'committed');
                }
                results.push({ mode, scenario, passed: true });
            } catch (error) {
                await page.screenshot({ path: path.join(reports, `operation-${mode}-${scenario}.png`) }).catch(() => {});
                throw new Error(`${mode}/${scenario}: ${error.message}`, { cause: error });
            } finally { await context.close(); }
        }
    }
    console.log(JSON.stringify({ passed: results.length, results }));
} finally {
    fs.writeFileSync(path.join(reports, 'operation-diagnostics.json'), JSON.stringify({ results }, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
