import assert from 'node:assert/strict';

export const reviewScenarios = ['host-readback', 'host-readback-then-rejection', 'host-timeout-then-rejection',
    'host-final-readback-recorder', 'host-final-readback-fallback',
    'host-multi-suite-quota', 'ack-closed', 'ack-exception',
    ...['payload-import', 'latest-import', 'file-import'].flatMap(boundary =>
        ['quota', 'timeout'].map(fault => `${boundary}-${fault}`)),
    'latest-import-post-commit', 'file-import-post-commit'];

// Runs in a fresh browser realm with the production AppData, recorder, host and incident UI.
export async function exerciseReviewScenario(scenario) {
    const result = { replies: [], cleanups: 0, eventIds: [] };
    const captured = [];
    const diagnostics = AppOperationDiagnostics;
    window.AppOperationDiagnostics = { ...diagnostics, failure(input, retry) {
        captured.push(input);
        const id = diagnostics.failure(input, retry);
        result.eventIds.push(id);
        return id;
    } };
    const record = { id: 'original-record', examId: 'reading-original', sessionId: 'original-session',
        submissionId: 'original-submission', operationId: 'original-operation', type: 'reading',
        status: 'completed', totalQuestions: 1, correctAnswers: 1, duration: 60,
        startTime: '2026-09-28T00:00:00.000Z', endTime: '2026-09-28T00:01:00.000Z',
        answers: { q1: 'PRIVATE_ANSWER' }, notes: 'PRIVATE_NOTES', windowSessionToken: 'PRIVATE_TOKEN' };
    window.resolveActiveLibraryIndex = async () => [{ id: record.examId, title: 'Practice', type: 'reading' }];
    const app = Object.assign({}, ExamSystemAppMixins.examSession, ExamSystemAppMixins.suitePractice, {
        components: {}, examWindows: new Map(), suiteExamMap: new Map(),
        _normalizeListeningSpellingErrors() {}, _ensureRecorderSessionForPracticeCompletion() {},
        cleanupExamSession: async () => { result.cleanups++; },
        _announcePracticeSubmitOutcome: (_exam, _data, _source, saved) => result.replies.push(saved)
    });
    const quota = () => new TestDataError('QUOTA_EXCEEDED', 'PRIVATE_ANSWER');
    const timeout = () => new TestDataError('BACKEND_UNAVAILABLE', 'PRIVATE_TOKEN', { reason: 'timeout' });
    let injected, caught;

    if (scenario.startsWith('host-') && scenario !== 'host-multi-suite-quota') {
        const finalReadback = scenario.startsWith('host-final-readback-');
        const recorder = Object.create(PracticeRecorder.prototype);
        recorder.activeSessions = new Map([[record.examId, { examId: record.examId,
            sessionId: record.sessionId, startTime: record.startTime, status: 'active', interactions: [] }]]);
        recorder.sessionListeners = new Map();
        recorder.practiceTypeCache = new Map();
        recorder.wait = async () => {};
        const complete = recorder.handleSessionCompleted;
        recorder.handleSessionCompleted = async function (...args) {
            try {
                const saved = await complete.apply(this, args);
                result.saveReturned = Boolean(saved?.id);
                return saved;
            }
            catch (error) { result.recorderRejected = true; throw error; }
        };
        const retry = recorder.retrySaveWithStandardizedRecord;
        recorder.retrySaveWithStandardizedRecord = function (...args) {
            result.standardizedRetry = true;
            return retry.apply(this, args);
        };
        const fallback = app.saveRealPracticeData;
        app.saveRealPracticeData = async function (...args) {
            result.hostFallback = true;
            const saved = await fallback.apply(this, args);
            result.saveReturned = Boolean(saved?.id);
            return saved;
        };
        if (scenario !== 'host-final-readback-fallback') app.components.practiceRecorder = recorder;
        const verify = app._isPracticeCompletionPersisted;
        app._isPracticeCompletionPersisted = function (...args) {
            result.finalVerification = true;
            return verify.apply(this, args);
        };
        result.draftClears = 0;
        app.clearReadingDraftForExam = async () => { result.draftClears++; };
        const mutate = TestKernel.prototype.mutateEntities;
        const read = TestKernel.prototype.readPracticeSnapshot;
        const operationIds = [];
        let committed = false, readbackFailed = false;
        TestKernel.prototype.mutateEntities = async function (...args) {
            operationIds.push(args[1].operationId);
            if (scenario === 'host-timeout-then-rejection' || (committed && scenario.endsWith('then-rejection'))) {
                injected = operationIds.length === 1 ? timeout() : quota();
                throw injected;
            }
            const receipt = await mutate.apply(this, args);
            committed = true;
            result.receiptCommitted = receipt.committed;
            return receipt;
        };
        TestKernel.prototype.readPracticeSnapshot = async function (...args) {
            if (committed && (finalReadback ? result.finalVerification
                : (scenario === 'host-readback' || !readbackFailed))) {
                if (finalReadback && !result.saveReturned) throw new Error('Persistence has not returned');
                readbackFailed = true;
                injected = new TestDataError('BACKEND_UNAVAILABLE', 'PRIVATE_NOTES');
                throw injected;
            }
            return read.apply(this, args);
        };
        result.completed = await app.handlePracticeComplete(record.examId, record);
        result.operationIds = operationIds;
        result.originalError = captured.at(-1)?.error === injected;
        result.journal = await AppData.practice.getCommitState(record.operationId);
    } else if (scenario === 'host-multi-suite-quota') {
        injected = quota();
        TestKernel.prototype.mutateEntities = async () => { throw injected; };
        const data = { ...record, examId: 'listening-100-p1_set1', suiteId: 'set1', totalSuites: 1 };
        result.completed = await app.handlePracticeComplete(data.examId, data);
        result.originalError = captured.length === 2 && captured.every(input => input.error === injected);
        result.baseSession = app.multiSuiteSessionsMap.has('listening-100-p1');
    } else if (scenario.startsWith('ack-')) {
        await AppData.practice.completeAttempt({ record, operationId: record.operationId });
        app._postExamMessage = () => { throw new Error('ACK transport failed'); };
        result.delivered = ExamSystemAppMixins.examSession._announcePracticeSubmitOutcome.call(app,
            record.examId, record, { closed: scenario === 'ack-closed' }, true);
        result.journal = await AppData.practice.getCommitState(record.operationId);
    } else {
        await AppData.practice.completeAttempt({ record, operationId: record.operationId });
        const payload = await AppData.backups.export();
        window.confirm = () => true;
        if (scenario.startsWith('latest-import')) {
            // file:// denies OPFS. Stand in only for the picked directory and its serialized
            // handle there; AppData, binding metadata and import transactions still use real IDB.
            let directory;
            if (location.protocol === 'file:') {
                directory = { kind: 'directory', name: 'fixture',
                    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
                    getFileHandle: async () => ({ getFile: async () => new File([JSON.stringify(payload)], 'backup.json') }) };
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function (value, ...args) {
                    return put.call(this, this.name === 'binding' && value === directory
                        ? { fixtureDirectory: true } : value, ...args);
                };
                const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result');
                Object.defineProperty(IDBRequest.prototype, 'result', { ...descriptor, get() {
                    const value = descriptor.get.call(this);
                    return value?.fixtureDirectory === true ? directory : value;
                } });
            } else {
                directory = await navigator.storage.getDirectory();
                FileSystemHandle.prototype.queryPermission = async () => 'granted';
                FileSystemHandle.prototype.requestPermission = async () => 'granted';
                const file = await directory.getFileHandle(ExternalBackupService.LATEST_FILENAME, { create: true });
                const writer = await file.createWritable();
                await writer.write(JSON.stringify(payload));
                await writer.close();
            }
            window.showDirectoryPicker = async () => directory;
            await ExternalBackupService.bindDirectory({ writeNow: false });
        }
        const install = TestKernel.prototype.installSnapshot;
        let installed = false;
        TestKernel.prototype.installSnapshot = async function (...args) {
            if (!scenario.endsWith('post-commit')) {
                injected = scenario.endsWith('quota') ? quota() : timeout();
                throw injected;
            }
            const receipt = await install.apply(this, args);
            installed = true;
            return receipt;
        };
        if (scenario === 'latest-import-post-commit') {
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args) {
                if (installed && this.name === 'binding') throw new DOMException('Metadata failed', 'QuotaExceededError');
                return put.apply(this, args);
            };
        }
        if (scenario.startsWith('file-import')) {
            let finish;
            const finished = new Promise(resolve => { finish = resolve; });
            window.showMessage = (_message, type) => {
                if (type === 'success' && scenario.endsWith('post-commit')) {
                    injected = new Error('Import success presentation failed');
                    throw injected;
                }
                if (type === 'error' || type === 'success') finish();
            };
            const click = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function () {
                if (this.type !== 'file') return click.call(this);
                const transfer = new DataTransfer();
                transfer.items.add(new File([JSON.stringify(payload)], 'PRIVATE_IMPORT.json', { type: 'application/json' }));
                this.files = transfer.files;
                this.dispatchEvent(new Event('change'));
            };
            window.importData();
            document.querySelector('.import-mode-option-lite').click();
            await finished;
        } else {
            try {
                result.restored = scenario.startsWith('latest-import')
                    ? await ExternalBackupService.restoreFromLatest({ confirmed: true })
                    : await ExternalBackupService.restorePayload(payload, { confirmed: true });
            } catch (error) { caught = error; }
        }
        result.originalError = captured.at(-1)?.error === injected;
        result.propagatedError = !caught || caught === injected;
        result.facadeState = AppData.getOperationFailureState(injected);
        result.installed = installed;
    }
    result.events = AppDiagnostics.snapshot().events.filter(event => event.collection.source === 'business');
    result.text = document.body.textContent;
    result.dialogs = Array.from(document.querySelectorAll('[role="alertdialog"]'))
        .filter(node => node.getClientRects().length > 0).length;
    return result;
}

export function assertReviewScenario(scenario, result) {
    assert.equal(result.events.length, 1, JSON.stringify(result.events));
    const event = result.events[0];
    assert.doesNotMatch(JSON.stringify(event), /PRIVATE_|original-operation|original-submission|original-session/);
    assert.ok(result.text.includes(event.eventId));
    assert.equal(new Set(result.eventIds).size, 1);
    assert.equal(result.cleanups, 0);
    if (scenario.startsWith('ack-')) {
        assert.equal(result.delivered, false);
        assert.equal(result.journal.operation, 'committed');
        assert.equal(event.code, 'PRACTICE_CHANNEL_TIMEOUT');
        assert.equal(event.action, 'acknowledgement');
        assert.equal(event.persistence.operation, 'unconfirmed');
        assert.equal(event.notification.kind, 'persistent');
        assert.equal(result.dialogs, 0);
        assert.doesNotMatch(result.text, /练习提交尚未确认保存/);
        return;
    }
    const uncertain = scenario.includes('timeout');
    const committed = scenario.includes('readback') || scenario.endsWith('post-commit');
    assert.equal(event.persistence.operation, committed ? 'committed' : uncertain ? 'unconfirmed' : 'not-committed');
    assert.equal(event.notification.kind, uncertain && scenario.startsWith('host-') ? 'dialog' : 'persistent');
    assert.equal(result.dialogs, uncertain && scenario.startsWith('host-') ? 1 : 0);
    if (scenario === 'latest-import-post-commit') {
        assert.equal(result.installed, true);
        assert.equal(result.restored.restored, true);
    } else {
        assert.equal(result.originalError, true);
    }
    if (scenario.startsWith('host-')) {
        assert.equal(event.code, 'PRACTICE_SAVE_FAILED');
        assert.equal(event.causeCode, scenario === 'host-readback' || scenario.startsWith('host-final-readback-')
            ? 'BACKEND_UNAVAILABLE' : 'QUOTA_EXCEEDED');
        assert.equal(result.completed, false);
        assert.deepEqual(result.replies, committed ? [] : [false]);
        assert.equal(event.retry.available, uncertain);
        if (scenario === 'host-multi-suite-quota') assert.equal(result.baseSession, true);
        else {
            if (scenario.startsWith('host-final-readback-')) {
                assert.equal(result.saveReturned, true);
                assert.equal(result.finalVerification, true);
                assert.equal(result.receiptCommitted, true);
                assert.equal(Boolean(result.recorderRejected), false);
                assert.equal(Boolean(result.standardizedRetry), false);
                assert.equal(Boolean(result.hostFallback), scenario.endsWith('fallback'));
                assert.equal(result.operationIds.length, 1);
                assert.equal(result.draftClears, 0);
                assert.doesNotMatch(result.text, /练习提交尚未确认保存/);
                assert.match(result.text, /已保存/);
            } else {
                assert.equal(result.recorderRejected, true);
                assert.equal(result.standardizedRetry, true);
                assert.equal(result.hostFallback, true);
            }
            assert.ok(result.operationIds.length >= 1);
            assert.deepEqual([...new Set(result.operationIds)], ['original-operation']);
            assert.equal(result.journal.operation, committed ? 'committed' : 'unconfirmed');
        }
    } else {
        assert.equal(event.code, 'DATA_IMPORT_FAILED');
        assert.equal(event.retry.available, false);
        if (!committed) {
            assert.equal(result.propagatedError, true);
            assert.equal(event.causeCode, uncertain ? 'BACKEND_UNAVAILABLE' : 'QUOTA_EXCEEDED');
            assert.equal(result.facadeState, uncertain ? 'unconfirmed' : 'not-committed');
            assert.ok(result.text.includes(uncertain ? '本次操作结果尚未确认' : '本次操作已确认未提交'));
        }
    }
}
