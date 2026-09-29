import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './helpers/diagnosticHarness.js';

function setup() {
    const h = harness();
    h.run('js/diagnostics/diagnosticReporter.js');
    h.run('js/diagnostics/operationDiagnostics.js');
    h.collector.markReady();
    h.presentations = [];
    h.sandbox.getMessageCenter = () => ({ showIncident(id, presentation) { h.presentations.push({ id, presentation }); } });
    h.events = () => h.collector.snapshot().events;
    return h;
}
function appError(code) {
    return Object.assign(new Error('PRIVATE_ANSWER PRIVATE_TOKEN /private/user/file.json'), { name: 'AppDataError', code });
}
function recorder(h) {
    h.run('js/core/practiceRecorder.js');
    h.sandbox.resolveActiveLibraryIndex = async () => [];
    const result = Object.create(h.sandbox.PracticeRecorder.prototype);
    Object.assign(result, { prepareRecordForStorage: value => value, normalizeRecordForAppData: value => value,
        restoreRecordAnswerState: value => value, verifyRecordSaved: async () => true, wait: async () => {} });
    return result;
}
function host(h) {
    h.run('js/app/examSessionMixin.js');
    const app = Object.assign({}, h.sandbox.ExamSystemAppMixins.examSession, {
        components: {}, examWindows: new Map(), suiteExamMap: new Map(),
        _normalizeListeningSpellingErrors() {}, _ensureRecorderSessionForPracticeCompletion() {},
        _isPracticeCompletionPersisted: async () => true, _announceSubmittedReadingRecord() {},
        clearReadingDraftForExam: async () => {}, updateExamStatus() {},
        showRealCompletionNotification: async () => {}, _isResetCapableUnifiedReadingCompletion: () => false,
        cleanupExamSession: async () => { app.cleanups++; }, cleanups: 0
    });
    h.sandbox.syncPracticeRecords = async () => {};
    h.sandbox.AppData = { practice: {} };
    return app;
}
const record = () => ({ id: 'record-original', examId: 'exam-original', sessionId: 'PRIVATE_SESSION',
    submissionId: 'PRIVATE_SUBMISSION', operationId: 'PRIVATE_OPERATION', answers: { q1: 'PRIVATE_ANSWER' },
    notes: 'PRIVATE_NOTES', endTime: '2026-09-28T00:00:00.000Z' });

test('operation adapters keep identity, cause, truthful outcomes and sanitized semantic context', () => {
    const h = setup();
    const error = appError('QUOTA_EXCEEDED');
    const correlation = { session: 'PRIVATE_SESSION', submission: 'PRIVATE_SUBMISSION', operation: 'PRIVATE_OPERATION' };
    h.sandbox.AppOperationDiagnostics.breadcrumb('practice', 'open-practice', 'started', correlation);
    const input = { code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'submit', error, correlation };
    const id = h.sandbox.AppOperationDiagnostics.failure(input);
    assert.equal(h.sandbox.AppOperationDiagnostics.failure(input), id);
    assert.equal(h.events().length, 1);
    const event = h.events()[0];
    assert.equal(event.causeCode, 'QUOTA_EXCEEDED');
    assert.equal(event.persistence.operation, 'unconfirmed');
    assert.equal(event.notification.kind, 'dialog');
    assert.equal(event.retry.available, false);
    assert.equal(event.breadcrumbs[0].action, 'open-practice');
    assert.doesNotMatch(JSON.stringify(event), /PRIVATE_|private\/user/);
    assert.equal(h.presentations[0].id, id);
});

test('only business evidence classifies a confirmed failure; arbitrary Error.committed is ignored', () => {
    const h = setup();
    const error = Object.assign(appError('BACKEND_UNAVAILABLE'), { committed: true });
    const input = { code: 'RECOVERY_SAVE_FAILED', module: 'reading', action: 'save-draft', error };
    h.sandbox.AppOperationDiagnostics.failure(input);
    assert.equal(h.events()[0].persistence.operation, 'unconfirmed');
    const knownFailure = appError('BACKEND_UNAVAILABLE');
    h.sandbox.AppData = { getOperationFailureState: value => value === knownFailure ? 'not-committed' : 'unconfirmed' };
    h.sandbox.AppOperationDiagnostics.failure({ ...input, error: knownFailure });
    assert.equal(h.events()[1].persistence.operation, 'not-committed');
    assert.equal(h.events()[1].notification.kind, 'persistent');
});

test('retry binds original aliases and performs only the supplied reconciliation on user invocation', async () => {
    const h = setup();
    let calls = 0;
    h.sandbox.AppOperationDiagnostics.failure({ code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'submit',
        correlation: { operation: 'original-operation', submission: 'original-submission' } }, async () => {
        calls++;
        return { verified: true, operation: 'committed' };
    });
    assert.equal(calls, 0);
    const retry = h.presentations[0].presentation.retry;
    assert.equal(retry.operationAlias, h.events()[0].correlation.operation);
    assert.equal(retry.submissionAlias, h.events()[0].correlation.submission);
    assert.equal((await retry.run()).operation, 'committed');
    assert.equal(calls, 1);
    assert.equal(h.events()[0].persistence.operation, 'unconfirmed', 'historical observation stays truthful');
});

test('cancellation, optional assets and diagnostic exporter failures cannot create critical notifications', () => {
    const h = setup();
    h.sandbox.AppOperationDiagnostics.failure({ code: 'DATA_IMPORT_FAILED', module: 'import', action: 'import', cancelled: true });
    h.sandbox.AppOperationDiagnostics.failure({ code: 'RESOURCE_LOAD_FAILED', module: 'main', action: 'load-resource',
        resource: { url: 'assets/generated/listening-exams/manifest.js', optional: true } });
    h.sandbox.AppOperationDiagnostics.failure({ code: 'DATA_EXPORT_FAILED', module: 'diagnostics', action: 'export' });
    assert.equal(h.events().length, 2);
    assert.ok(h.events().every(event => event.notification.kind === 'none'));
    assert.equal(h.presentations.length, 0);
});

for (const code of ['QUOTA_EXCEEDED', 'BACKEND_UNAVAILABLE', 'CONFLICT']) {
    test(`direct recorder captures ${code} without inventing a new operation during business retries`, async () => {
        const h = setup();
        const r = recorder(h);
        const error = appError(code);
        const ids = [];
        h.sandbox.AppData = { practice: { completeAttempt: async command => { ids.push(command.operationId); throw error; },
            getCommitState: async operationId => { assert.equal(operationId, 'PRIVATE_OPERATION'); return { verified: true, operation: 'unconfirmed' }; } } };
        await assert.rejects(r.savePracticeRecord(record()), value => value === error);
        assert.equal(new Set(ids).size, 1);
        assert.equal(ids[0], 'PRIVATE_OPERATION');
        assert.equal(h.events().length, 1);
        assert.equal(h.events()[0].causeCode, code);
        await h.presentations[0].presentation.retry.run();
        assert.equal(new Set(ids).size, 1);
        assert.doesNotMatch(JSON.stringify(h.events()), /PRIVATE_/);
    });
}

test('unsuccessful recovery receipts preserve cause and never announce a saved snapshot', async () => {
    const h = setup();
    const r = recorder(h);
    let cleaned = 0;
    h.sandbox.AppData = { recovery: { saveDraft: async () => ({ committed: false, error: appError('QUOTA_EXCEEDED') }),
        listDrafts: async () => { cleaned++; return []; } } };
    await assert.rejects(r.saveToTemporaryStorage(record()), /not confirmed/);
    assert.equal(cleaned, 0);
    assert.equal(h.events()[0].code, 'RECOVERY_SAVE_FAILED');
    assert.equal(h.events()[0].causeCode, 'QUOTA_EXCEEDED');
    assert.equal(h.events()[0].persistence.operation, 'unconfirmed');
    assert.ok(h.output.every(row => !String(row.args[0]).includes('记录已保存到临时存储')));
});

test('reading draft unsuccessful results remain failed and preserve the original AppDataError cause', async () => {
    const h = setup();
    const app = host(h);
    let cleanup = 0;
    h.sandbox.AppData.recovery = { saveDraft: async () => ({ committed: false, error: appError('QUOTA_EXCEEDED') }),
        listDrafts: async () => { cleanup++; return []; } };
    assert.equal(await app._writeReadingDraftStore({}, { id: 'draft', sessionId: 'PRIVATE_SESSION' }), false);
    assert.equal(cleanup, 0);
    assert.equal(h.events()[0].action, 'save-draft');
    assert.equal(h.events()[0].causeCode, 'QUOTA_EXCEEDED');
    assert.equal(h.events()[0].notification.kind, 'dialog');
});

test('an unsuccessful practice receipt cannot become a success even when it carries a record', async () => {
    const h = setup();
    const r = recorder(h);
    h.sandbox.AppData = { practice: { completeAttempt: async () => ({ committed: false,
        record: record(), error: appError('BACKEND_UNAVAILABLE') }) } };
    await assert.rejects(r.savePracticeRecord(record()), /not confirmed/);
    assert.equal(h.events()[0].code, 'PRACTICE_SAVE_FAILED');
    assert.equal(h.events()[0].causeCode, 'BACKEND_UNAVAILABLE');
    assert.ok(h.output.every(row => !String(row.args[0]).includes('保存成功')));
});

test('submission normalization preserves original submission and operation identities', () => {
    const h = setup();
    h.run('js/core/practiceCore.js');
    const r = recorder(h);
    const normalized = r.normalizePracticeCompletePayload(record());
    assert.equal(normalized.submissionId, 'PRIVATE_SUBMISSION');
    assert.equal(normalized.operationId, 'PRIVATE_OPERATION');
});

test('suite recovery failures pause at the same business boundary with or without reporting', async () => {
    for (const broken of [false, true]) {
        const h = setup();
        h.run('js/app/suitePracticeMixin.js');
        const error = appError('BACKEND_UNAVAILABLE');
        const session = { id: 'original-suite', revision: 9 };
        let writes = 0, mirrors = 0;
        h.sandbox.AppData = { recovery: { saveActiveSession: async () => { writes++; throw error; } } };
        if (broken) h.sandbox.AppDiagnostics = { breadcrumb() { throw Error('broken'); }, report() { throw Error('broken'); } };
        const app = Object.assign({}, h.sandbox.ExamSystemAppMixins.suitePractice, {
            _buildSuiteRecoverySnapshot: () => ({ id: session.id, revision: 9 }),
            _mirrorSuiteRecoverySnapshot() { mirrors++; }
        });
        assert.equal(await app._commitSuiteRecovery(session), false);
        assert.equal(writes, 1);
        assert.equal(mirrors, 0);
        assert.equal(session._suiteRecoveryCommitTail, undefined);
        if (!broken) assert.equal(h.events()[0].causeCode, 'BACKEND_UNAVAILABLE');
    }
});

test('committed but undelivered acknowledgement remains unconfirmed; replay never writes', () => {
    const h = setup();
    const app = host(h);
    const source = { closed: false };
    const info = { window: source };
    app.examWindows.set('exam-original', info);
    app._resolveExamWindowSessionForTarget = () => ({ examId: 'exam-original', windowInfo: info });
    app._resolveExamWindowSessionKey = () => 'exam-original';
    const replies = [];
    app._postExamMessage = (_exam, _window, type, payload) => { replies.push({ type, ...payload }); return false; };
    assert.equal(app._announcePracticeSubmitOutcome('exam-original', record(), source, true), false);
    assert.equal(h.events()[0].code, 'PRACTICE_CHANNEL_TIMEOUT');
    assert.equal(h.events()[0].persistence.operation, 'unconfirmed');
    assert.equal(h.events()[0].action, 'acknowledgement');
    assert.equal(h.events()[0].notification.kind, 'persistent');
    assert.equal(app._replayPracticeSubmitReceipt('exam-original', record(), source), true);
    assert.equal(replies.length, 2);
    assert.equal(replies[0].submissionId, replies[1].submissionId);
    assert.equal(replies[0].sessionId, replies[1].sessionId);
    assert.equal(app.cleanups, 0);
});

test('host NACK distinguishes a proven rejection from an unknown save outcome', () => {
    const h = setup();
    const app = host(h);
    const replies = [];
    app._postExamMessage = (_exam, _window, type, data) => { replies.push({ type, ...data }); return true; };
    for (const operation of [undefined, 'unconfirmed', 'committed', 'not-committed']) {
        app._announcePracticeSubmitOutcome('exam-original', record(), { closed: false }, false, { operation });
        assert.equal(replies.at(-1).type, 'PRACTICE_SUBMIT_FAILED');
        assert.equal(replies.at(-1).operation, operation === 'not-committed' ? operation : 'unconfirmed');
    }
});

for (const method of ['handleSuitePracticeComplete', '_handleInlineSimulationSuiteSubmit']) {
    for (const status of ['finalizing', 'completed']) test(`${method} only confirms the original ${status} submission`, async () => {
        const h = setup();
        h.run('js/app/suitePracticeMixin.js');
        const session = { id: 'suite', flowMode: 'simulation', status, _finalizeSubmissionId: 'original' };
        let finalizations = 0;
        const app = Object.assign({}, h.sandbox.ExamSystemAppMixins.suitePractice, {
            currentSuiteSession: session, _ensureSuiteRecoveryReady: async () => {},
            _finalizeSuiteRecordWithGate: async () => { finalizations++; return true; },
            _releaseSuiteCloseGuardAfterCommit() {}
        });
        const rejected = await app[method]('p3', { suiteSessionId: 'suite', submissionId: 'new', answers: { q1: 'B' } });
        assert.equal(rejected.committed, false);
        assert.equal(rejected.errorCode, 'suite_submission_conflict');
        assert.equal(session._finalizeSubmissionId, 'original');
        assert.equal(finalizations, 0);
        const reconciled = await app[method]('p3', { suiteSessionId: 'suite', submissionId: 'original' });
        assert.equal(reconciled.committed, true);
        assert.equal(finalizations, status === 'finalizing' ? 1 : 0);
    });
}

for (const branch of ['closed', 'exception']) {
    test(`ACK ${branch} is a channel incident without a blocking save dialog`, () => {
        const h = setup();
        const app = host(h);
        app._postExamMessage = () => { throw appError('BACKEND_UNAVAILABLE'); };
        assert.equal(app._announcePracticeSubmitOutcome('exam-original', record(), { closed: branch === 'closed' }, true), false);
        assert.equal(h.events().length, 1);
        assert.equal(h.events()[0].action, 'acknowledgement');
        assert.equal(h.events()[0].notification.kind, 'persistent');
        assert.equal(h.events()[0].persistence.operation, 'unconfirmed');
        assert.equal(app.cleanups, 0);
    });
}

for (const initial of ['committed', 'unconfirmed', 'not-committed']) {
    test(`host retains ${initial} recorder evidence after later definite rejections`, async () => {
        const h = setup();
        const app = host(h);
        const r = recorder(h);
        const states = new WeakMap();
        let attempts = 0;
        h.sandbox.AppData.getOperationFailureState = error => states.get(error) || 'unconfirmed';
        h.sandbox.AppData.practice.completeAttempt = async () => {
            const error = appError('BACKEND_UNAVAILABLE');
            states.set(error, ++attempts === 1 ? initial : 'not-committed');
            throw error;
        };
        h.sandbox.AppData.practice.getCommitState = async () => ({ verified: true, operation: initial });
        h.sandbox.resolveActiveLibraryIndex = async () => [{ id: 'exam-original', title: 'Practice' }];
        app.components.practiceRecorder = r;
        r.handleSessionCompleted = (data, options) => r.savePracticeRecord(data, options);
        const outcomes = [];
        app._announcePracticeSubmitOutcome = (_exam, _data, _source, saved, details) => outcomes.push({ saved, operation: details.operation });
        assert.equal(await app.handlePracticeComplete('exam-original', record()), false);
        assert.ok(attempts >= 3, 'recorder retry and host fallback both execute');
        assert.equal(h.events().length, 1);
        assert.equal(h.events()[0].persistence.operation, initial);
        assert.equal(h.events()[0].causeCode, 'BACKEND_UNAVAILABLE');
        assert.equal(h.events()[0].retry.available, initial === 'unconfirmed');
        assert.equal(h.events()[0].notification.kind, initial === 'unconfirmed' ? 'dialog' : 'persistent');
        assert.deepEqual(outcomes, initial === 'committed' ? [] : [{ saved: false, operation: initial }]);
        assert.equal(app.cleanups, 0);
    });
}

for (const route of ['recorder', 'standardized', 'recorder-fallback', 'fallback']) {
    test(`host retains the ${route} receipt and original final-readback Error`, async () => {
        const h = setup();
        const app = host(h);
        const error = appError('BACKEND_UNAVAILABLE');
        const rejected = appError('QUOTA_EXCEEDED');
        const failedAttempts = route === 'standardized' ? 3 : route === 'recorder-fallback' ? 4 : 0;
        let attempts = 0, returnedRecord, reportedError, draftClears = 0;
        h.sandbox.AppData.getOperationFailureState = value => value === rejected ? 'not-committed' : 'unconfirmed';
        h.sandbox.AppData.practice.completeAttempt = async command => {
            if (++attempts <= failedAttempts) throw rejected;
            return { committed: true, operationId: command.operationId, record: command.record };
        };
        h.sandbox.AppData.practice.get = async () => { throw error; };
        h.sandbox.AppData.practice.getCommitState = async () => ({ verified: true, operation: 'committed' });
        h.sandbox.resolveActiveLibraryIndex = async () => [{ id: 'exam-original', title: 'Practice' }];
        const diagnostics = h.sandbox.AppOperationDiagnostics;
        h.sandbox.AppOperationDiagnostics = { ...diagnostics, failure(input, retry) {
            reportedError = input.error;
            return diagnostics.failure(input, retry);
        } };
        if (route !== 'fallback') {
            const r = recorder(h);
            h.sandbox.resolveActiveLibraryIndex = async () => [{ id: 'exam-original', title: 'Practice' }];
            r.handleSessionCompleted = async (data, options) => (returnedRecord = await r.savePracticeRecord(data, options));
            app.components.practiceRecorder = r;
        }
        const fallback = app.saveRealPracticeData;
        app.saveRealPracticeData = async (...args) => (returnedRecord = await fallback.apply(app, args));
        app._isPracticeCompletionPersisted = h.sandbox.ExamSystemAppMixins.examSession._isPracticeCompletionPersisted;
        app.clearReadingDraftForExam = async () => { draftClears++; };
        const outcomes = [];
        app._announcePracticeSubmitOutcome = (_exam, _data, _source, saved) => outcomes.push(saved);

        assert.equal(await app.handlePracticeComplete('exam-original', record()), false);
        assert.equal(attempts, failedAttempts + 1);
        assert.equal(returnedRecord.id, record().id, 'persistence must return normally before host verification');
        assert.equal(reportedError, error);
        assert.equal(h.events().length, 1);
        assert.equal(h.events()[0].causeCode, 'BACKEND_UNAVAILABLE');
        assert.equal(h.events()[0].persistence.operation, 'committed');
        assert.equal(h.events()[0].notification.kind, 'persistent');
        assert.equal(h.events()[0].retry.available, false);
        assert.deepEqual(outcomes, []);
        assert.equal(draftClears, 0);
        assert.equal(app.cleanups, 0);
    });
}

test('a final readback miss cannot erase a receipt or authorize completion cleanup', async () => {
    const h = setup();
    const app = host(h);
    h.sandbox.resolveActiveLibraryIndex = async () => [{ id: 'exam-original', title: 'Practice' }];
    h.sandbox.AppData.practice.completeAttempt = async command => ({ committed: true, record: command.record });
    h.sandbox.AppData.practice.get = async () => null;
    app._isPracticeCompletionPersisted = h.sandbox.ExamSystemAppMixins.examSession._isPracticeCompletionPersisted;
    const outcomes = [];
    app._announcePracticeSubmitOutcome = (_exam, _data, _source, saved) => outcomes.push(saved);
    assert.equal(await app.handlePracticeComplete('exam-original', record()), false);
    assert.equal(h.events()[0].persistence.operation, 'committed');
    assert.equal(h.events()[0].retry.available, false);
    assert.deepEqual(outcomes, []);
    assert.equal(app.cleanups, 0);
});

test('a returned record without receipt evidence keeps a final readback failure unconfirmed', async () => {
    const h = setup();
    const app = host(h);
    const error = appError('BACKEND_UNAVAILABLE');
    app.components.practiceRecorder = { handleSessionCompleted: async () => ({ ...record(), committed: true }) };
    h.sandbox.AppData.practice.get = async () => { throw error; };
    h.sandbox.AppData.practice.getCommitState = async () => ({ verified: true, operation: 'unconfirmed' });
    app._isPracticeCompletionPersisted = h.sandbox.ExamSystemAppMixins.examSession._isPracticeCompletionPersisted;
    const outcomes = [];
    app._announcePracticeSubmitOutcome = (_exam, _data, _source, saved) => outcomes.push(saved);
    assert.equal(await app.handlePracticeComplete('exam-original', record()), false);
    assert.equal(h.events()[0].causeCode, 'BACKEND_UNAVAILABLE');
    assert.equal(h.events()[0].persistence.operation, 'unconfirmed');
    assert.equal(h.events()[0].retry.available, true);
    assert.deepEqual(outcomes, [false]);
    assert.equal(app.cleanups, 0);
});

test('host and multi-suite boundary reuse the original Error and clear stale session failures', async () => {
    const h = setup();
    const app = host(h);
    h.run('js/app/suitePracticeMixin.js');
    Object.assign(app, h.sandbox.ExamSystemAppMixins.suitePractice);
    const error = appError('QUOTA_EXCEEDED');
    h.sandbox.AppData.getOperationFailureState = value => value === error ? 'not-committed' : 'unconfirmed';
    h.sandbox.AppData.practice.finalizeSuite = async () => { throw error; };
    app._announcePracticeSubmitOutcome = () => {};
    const data = { ...record(), examId: 'listening-100-p1_set1', suiteId: 'set1', totalSuites: 1 };
    let outcome;
    const complete = app.handleSuitePracticeComplete;
    app.handleSuitePracticeComplete = async (...args) => (outcome = await complete.apply(app, args));
    assert.equal(await app.handlePracticeComplete(data.examId, data), false);
    assert.equal(outcome.error, error);
    assert.ok(app.multiSuiteSessionsMap.has('listening-100-p1'));
    assert.equal(h.events().length, 1);
    assert.equal(h.events()[0].causeCode, 'QUOTA_EXCEEDED');
    assert.equal(h.events()[0].persistence.operation, 'not-committed');
    assert.equal(h.events()[0].notification.kind, 'persistent');
    assert.equal(new Set(h.presentations.map(item => item.id)).size, 1);
    app.handleMultiSuitePracticeComplete = async () => false;
    const next = await complete.call(app, data.examId, data);
    assert.equal(next.error, undefined, 'a later attempt cannot inherit the previous failure');
});

test('post-commit UI failure cannot send a negative acknowledgement or undo cleanup', async () => {
    const h = setup();
    const app = host(h);
    const outcomes = [];
    app.components.practiceRecorder = { handleSessionCompleted: async () => record() };
    app._announcePracticeSubmitOutcome = (_exam, _data, _source, saved) => outcomes.push(saved);
    app.showRealCompletionNotification = async () => { throw appError('VALIDATION'); };
    assert.equal(await app.handlePracticeComplete('exam-original', record()), true);
    assert.deepEqual(outcomes, [true]);
    assert.equal(app.cleanups, 1);
    assert.equal(h.events()[0].persistence.operation, 'committed');
    assert.equal(h.events()[0].retry.available, false);
});

test('caught unsuccessful suite results are incidents and do not clean up the session', async () => {
    const h = setup();
    const app = host(h);
    const error = appError('QUOTA_EXCEEDED');
    app.handleSuitePracticeComplete = async () => ({ handled: true, committed: false, error });
    app._announcePracticeSubmitOutcome = () => {};
    assert.equal(await app.handlePracticeComplete('exam-original', { ...record(), suiteSessionId: 'suite-original' }), false);
    assert.equal(app.cleanups, 0);
    assert.equal(h.events()[0].code, 'PRACTICE_SAVE_FAILED');
    assert.equal(h.events()[0].causeCode, 'QUOTA_EXCEEDED');
});

test('reporter and presentation failures do not replace a business exception', async () => {
    for (const broken of ['report', 'presentation']) {
        const h = setup();
        const r = recorder(h);
        const error = appError('BACKEND_UNAVAILABLE');
        h.sandbox.AppData = { practice: { completeAttempt: async () => { throw error; } } };
        if (broken === 'report') h.sandbox.AppDiagnostics = { report() { throw Error('report failed'); } };
        else h.sandbox.getMessageCenter = () => { throw Error('UI failed'); };
        await assert.rejects(r.savePracticeRecord(record()), value => value === error);
    }
});

test('required lazy-load timeout identifies the resource and ignores a late load', async () => {
    const h = setup();
    const timers = [];
    h.sandbox.setTimeout = callback => { timers.push(callback); return timers.length; };
    h.sandbox.clearTimeout = () => {};
    h.run('js/runtime/lazyLoader.js');
    const pending = h.sandbox.AppLazyLoader.ensureGroup('practice-suite');
    const rejected = assert.rejects(pending);
    await new Promise(resolve => setImmediate(resolve));
    const script = h.nodes.find(node => node.src?.includes('practice.bundle.js'));
    timers.at(-1)();
    script.onload();
    await rejected;
    const event = h.events().find(event => event.code === 'RESOURCE_LOAD_FAILED');
    assert.equal(event.resource.path, 'js/bundles/practice.bundle.js');
    assert.equal(event.resource.status, 'unknown');
    assert.equal(event.notification.kind, 'persistent');
    assert.equal(h.sandbox.AppLazyLoader.getStatus('practice-suite').loaded, false);
});
