import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/suite-finalizing-pre-fix.json', import.meta.url), 'utf8'));
const legacyFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/suite-finalizing-no-timing.json', import.meta.url), 'utf8'));
let browser;
const server = http.createServer((_, response) => response.end('<!doctype html><title>Suite recovery</title>'));
before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
});
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

async function load(page) {
    for (const file of ['data/v2/dataCatalog.js', 'data/v2/dataKernel.js', 'data/practiceRecordSource.js',
        'services/readingTiming.js', 'core/vocabScheduler.js', 'core/practiceReviewScheduler.js',
        'data/v2/appData.js', 'app/suitePracticeMixin.js']) {
        if (file === 'data/v2/appData.js') await page.evaluate(() => { window.TestKernel = __AppDataV2Internals.DataKernel; });
        await page.addScriptTag({ content: fs.readFileSync(new URL(`../../../js/${file}`, import.meta.url), 'utf8') });
    }
    await page.evaluate(async () => {
        await AppData.ready;
        window.kernel = new TestKernel(); await kernel.initialize();
        window.command = { sessionId: 'legacy-suite-294', operationId: 'practice-suite:legacy-suite-294:finalize' };
        window.recover = () => AppData.practice.recoverSuiteFinalization(command);
        window.capture = async () => ({
            sessions: await kernel.read('recovery.activeSessions', { withMeta: true }),
            timing: await kernel.read('recovery.readingTiming', { withMeta: true }),
            records: await kernel.readPracticeSnapshot(null, { withMeta: true }),
            drafts: await kernel.read('recovery.drafts', { withMeta: true })
        });
        window.makeApp = async () => {
            const mixin = ExamSystemAppMixins.suitePractice;
            const session = mixin._restoreSessionFromStorage(await AppData.recovery.getActiveSession(command.sessionId));
            const app = Object.assign({ components: {}, suiteExamMap: new Map(), currentSuiteSession: session, _suiteModeReady: true }, mixin);
            app._updatePracticeRecordsState = async () => {};
            app._teardownSuiteSession = async () => {};
            return app;
        };
    });
}
async function seeded(source = fixture) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await load(page);
    await page.evaluate(async fixture => {
        fixture.session.lastUpdate = Date.now(); fixture.session.updatedAt = new Date().toISOString();
        fixture.timingRows.forEach(row => { row.updatedAt = new Date().toISOString(); });
        await kernel.mutate([
            { logicalKey: 'recovery.activeSessions', data: [fixture.session, { id: 'unrelated-session', updatedAt: new Date().toISOString() }] },
            { logicalKey: 'recovery.readingTiming', data: fixture.timingRows },
            { logicalKey: 'recovery.drafts', data: [{ id: 'unrelated-draft', answers: { q1: 'keep' }, updatedAt: new Date().toISOString() }] }
        ], { operationId: 'seed-legacy' });
        await AppData.practice.completeAttempt({ operationId: 'unrelated-completion', record: {
            id: 'unrelated', examId: 'other', type: 'reading', answers: { q1: 'keep' }, totalQuestions: 1, correctAnswers: 1
        } });
    }, structuredClone(source));
    return { context, page };
}

async function failFinalizationCheckpoint(page) {
    return page.evaluate(async () => {
        const sessions = await kernel.read('recovery.activeSessions');
        const timing = await kernel.read('recovery.readingTiming');
        const session = sessions.find(item => item.id === command.sessionId);
        session.finalizeRecord = null;
        session.finalizeOperationId = null;
        session.finalizeSubmissionId = 'original-submit';
        for (const row of timing) {
            row.snapshot.frozen = true;
            session.results.find(entry => entry.examId === row.snapshot.examId).readingTiming = structuredClone(row.snapshot);
            session.draftsByExam[row.snapshot.examId].readingTiming = structuredClone(row.snapshot);
        }
        await kernel.mutate([{ logicalKey: 'recovery.activeSessions', data: sessions },
            { logicalKey: 'recovery.readingTiming', data: timing }], { operationId: 'seed-before-finalize' });
        window.app = await makeApp();
        app.currentSuiteSession.results = app.currentSuiteSession.sequence.map(source => {
            source.exam.category = source.category;
            return app._normalizeSuiteResult(source.exam, {
                ...session.results.find(entry => entry.examId === source.examId), ...session.draftsByExam[source.examId]
            });
        });
        const put = IDBObjectStore.prototype.put;
        let failures = 0;
        IDBObjectStore.prototype.put = function(value, ...args) {
            if (!failures && value.logicalKey === 'recovery.activeSessions'
                && value.envelope.data.some(item => item.id === command.sessionId && item.finalizeRecord)) {
                failures++;
                throw new DOMException('Synthetic finalize-record failure', 'QuotaExceededError');
            }
            return put.call(this, value, ...args);
        };
        let first;
        try { first = await app._finalizeSuiteRecordWithGate(app.currentSuiteSession); }
        finally { IDBObjectStore.prototype.put = put; }
        const durable = await AppData.recovery.getActiveSession(command.sessionId);
        return { first, failures, durableStatus: durable.status, durableRecord: durable.finalizeRecord,
            durableOperationId: durable.finalizeOperationId, retained: app.currentSuiteSession.finalizeRecord,
            operation: (await AppData.practice.getSuiteCommitState(command.sessionId, command.operationId)).operation };
    });
}

test('a failed finalize-record checkpoint retries the retained snapshot and completes once', async () => {
    const { page, context } = await seeded();
    try {
        const failed = await failFinalizationCheckpoint(page);
        assert.equal(failed.failures, 1); assert.equal(failed.first, false);
        assert.equal(failed.durableStatus, 'finalizing'); assert.equal(failed.durableRecord, null);
        assert.equal(failed.durableOperationId, null); assert.equal(failed.operation, 'not-committed');
        assert.ok(failed.retained); assert.equal(failed.retained.submissionId, 'original-submit');
        const result = await page.evaluate(async () => {
            const before = await capture();
            const session = app.currentSuiteSession;
            const retries = await Promise.all([app._finalizeSuiteRecordWithGate(session), app._finalizeSuiteRecordWithGate(session)]);
            const durable = await AppData.recovery.getActiveSession(session.id);
            const saved = await AppData.practice.get(session.id);
            const first = JSON.stringify(await kernel.readPracticeSnapshot([session.id], { withMeta: true }));
            const repeated = await app._finalizeSuiteRecordWithGate(session);
            const after = await capture();
            return { retries, repeated, saved, durableRecord: durable.finalizeRecord,
                immutable: first === JSON.stringify(await kernel.readPracticeSnapshot([session.id], { withMeta: true })),
                draftsPreserved: JSON.stringify(before.drafts) === JSON.stringify(after.drafts),
                unrelatedPreserved: JSON.stringify(before.sessions.data.find(item => item.id === 'unrelated-session'))
                    === JSON.stringify(after.sessions.data.find(item => item.id === 'unrelated-session')),
                records: (await AppData.practice.list()).length };
        });
        assert.deepEqual(result.retries, [true, true]); assert.equal(result.repeated, true);
        assert.equal(result.immutable, true); assert.equal(result.records, 2);
        assert.equal(result.draftsPreserved, true); assert.equal(result.unrelatedPreserved, true);
        for (const field of ['id', 'sessionId', 'operationId', 'submissionId', 'duration', 'startTime', 'endTime']) {
            assert.equal(result.saved[field], failed.retained[field]);
        }
        assert.deepEqual(result.saved.answers, failed.retained.answers);
        assert.equal(result.durableRecord.operationId, failed.retained.operationId);
        assert.equal(result.durableRecord.submissionId, failed.retained.submissionId);
        for (const [index, entry] of result.saved.suiteEntries.entries()) {
            assert.deepEqual(entry.readingTiming, result.durableRecord.suiteEntries[index].readingTiming);
            for (const field of ['answers', 'answerComparison', 'scoreInfo', 'highlights', 'notes', 'noteOutlines', 'noteText', 'markedQuestions']) {
                assert.deepEqual(entry[field], failed.retained.suiteEntries[index][field]);
            }
        }
    } finally { await context.close(); }
});

for (const outcome of ['unconfirmed', 'committed']) {
    test(`failed snapshot retry reconciles ${outcome} completion without rewriting recovery`, async () => {
        const { page, context } = await seeded();
        try {
            await failFinalizationCheckpoint(page);
            const result = await page.evaluate(async outcome => {
                if (outcome === 'committed') {
                    await AppData.practice.finalizeSuite({ record: app.currentSuiteSession.finalizeRecord, operationId: command.operationId });
                } else await kernel.journalNoop({ operationId: command.operationId });
                const before = JSON.stringify(await capture());
                const retried = await app._finalizeSuiteRecordWithGate(app.currentSuiteSession);
                return { retried, unchanged: before === JSON.stringify(await capture()) };
            }, outcome);
            assert.deepEqual(result, { retried: outcome === 'committed', unchanged: true });
        } finally { await context.close(); }
    });
}

for (const interference of ['checkpoint', 'completion']) {
    test(`failed snapshot retry respects a competing ${interference} at the write fence`, async () => {
        const { page, context } = await seeded();
        try {
            await failFinalizationCheckpoint(page);
            const result = await page.evaluate(async interference => {
                const mutate = TestKernel.prototype.mutate;
                let interfered = false;
                let winner;
                TestKernel.prototype.mutate = async function(changes, options = {}) {
                    if (!interfered && options.operationId?.startsWith('suite-recovery:')) {
                        interfered = true;
                        if (interference === 'checkpoint') {
                            await mutate.call(this, changes, { ...options, operationId: 'competing-checkpoint' });
                            await recover();
                        } else {
                            await AppData.practice.finalizeSuite({ record: app.currentSuiteSession.finalizeRecord, operationId: command.operationId });
                        }
                        winner = JSON.stringify(await AppData.recovery.getActiveSession(command.sessionId));
                    }
                    return mutate.call(this, changes, options);
                };
                let retried;
                try { retried = await app._finalizeSuiteRecordWithGate(app.currentSuiteSession); }
                finally { TestKernel.prototype.mutate = mutate; }
                return { retried, interfered, preserved: winner === JSON.stringify(await AppData.recovery.getActiveSession(command.sessionId)),
                    operation: (await recover()).operation, count: (await AppData.practice.list()).length };
            }, interference);
            assert.deepEqual(result, { retried: true, interfered: true, preserved: true, operation: 'committed', count: 2 });
        } finally { await context.close(); }
    });
}

test('persisted legacy finalization without timing survives host reload and preserves its original completion', async () => {
    const { page, context } = await seeded(legacyFixture);
    try {
        await page.reload(); await load(page);
        const result = await page.evaluate(async () => {
            const before = await capture();
            const app = await makeApp();
            const committed = await app.resumeSuitePractice(command.sessionId);
            const saved = await AppData.practice.get(command.sessionId);
            const first = JSON.stringify(await kernel.readPracticeSnapshot([command.sessionId], { withMeta: true }));
            const other = await makeApp();
            const repeated = await other.resumeSuitePractice(command.sessionId);
            const after = await capture();
            return { committed, repeated, saved,
                immutable: first === JSON.stringify(await kernel.readPracticeSnapshot([command.sessionId], { withMeta: true })),
                timingRows: after.timing.data, draftsPreserved: JSON.stringify(before.drafts) === JSON.stringify(after.drafts),
                records: (await AppData.practice.list()).length };
        });
        assert.equal(result.committed, true); assert.equal(result.repeated, true);
        assert.equal(result.immutable, true); assert.equal(result.records, 2); assert.equal(result.draftsPreserved, true);
        assert.deepEqual(result.timingRows, []);
        assert.equal(result.saved.id, legacyFixture.session.id);
        assert.equal(result.saved.operationId, legacyFixture.session.finalizeOperationId);
        assert.equal(result.saved.submissionId ?? null, null);
        assert.equal(result.saved.duration, legacyFixture.session.finalizeRecord.duration);
        assert.deepEqual(result.saved.answers, legacyFixture.session.finalizeRecord.answers);
        for (const [index, entry] of result.saved.suiteEntries.entries()) {
            assert.equal(entry.readingTiming ?? null, null);
            for (const field of ['answers', 'answerComparison', 'scoreInfo', 'highlights', 'notes', 'noteOutlines', 'noteText', 'markedQuestions']) {
                assert.deepEqual(entry[field], legacyFixture.session.finalizeRecord.suiteEntries[index][field]);
            }
        }
    } finally { await context.close(); }
});

test('mixed legacy passages repair present timing and leave absent timing absent', async () => {
    const mixed = structuredClone(fixture);
    const examId = mixed.session.sequence[0].examId;
    mixed.session.finalizeRecord.suiteEntries[0].readingTiming = null;
    mixed.session.results[0].readingTiming = null;
    delete mixed.session.draftsByExam[examId].readingTiming;
    mixed.timingRows.shift();
    const { page, context } = await seeded(mixed);
    try {
        const result = await page.evaluate(async () => {
            const app = await makeApp();
            const committed = await app.resumeSuitePractice(command.sessionId);
            return { committed, saved: await AppData.practice.get(command.sessionId), timing: await kernel.read('recovery.readingTiming') };
        });
        assert.equal(result.committed, true);
        assert.equal(result.saved.suiteEntries[0].readingTiming ?? null, null);
        assert.equal(result.timing.length, 2);
        assert.ok(result.timing.every(row => row.recordId === fixture.session.id && row.snapshot.frozen));
    } finally { await context.close(); }
});

for (const scenario of ['entry', 'result', 'draft', 'durable-row']) {
    test(`legacy recovery does not treat present invalid timing as absent: ${scenario}`, async () => {
        const invalid = structuredClone(legacyFixture);
        if (scenario === 'entry') invalid.session.finalizeRecord.suiteEntries[0].readingTiming = false;
        if (scenario === 'result') invalid.session.results[0].readingTiming = {};
        if (scenario === 'draft') invalid.session.draftsByExam.p1.readingTiming = '';
        if (scenario === 'durable-row') invalid.timingRows = [structuredClone(fixture.timingRows[0])];
        const { page, context } = await seeded(invalid);
        try {
            const result = await page.evaluate(async () => {
                const before = JSON.stringify(await capture());
                let code;
                try { await recover(); } catch (error) { code = error.code; }
                return { code, unchanged: before === JSON.stringify(await capture()) };
            });
            assert.equal(result.code, 'VALIDATION'); assert.equal(result.unchanged, true);
        } finally { await context.close(); }
    });
}

test('persisted pre-fix suite recovers after host reload with one immutable completion', async () => {
    const { page, context } = await seeded();
    try {
        await page.reload(); await load(page);
        const result = await page.evaluate(async () => {
            const before = await capture();
            const app = await makeApp();
            const session = app.currentSuiteSession;
            const commits = await Promise.all([app.resumeSuitePractice(session.id), app.resumeSuitePractice(session.id)]);
            const saved = await AppData.practice.get(session.id);
            const first = await kernel.readPracticeSnapshot([session.id], { withMeta: true });
            // A different host holding the old persisted snapshot sees the same result.
            const other = await makeApp();
            const repeated = await other.resumeSuitePractice(session.id);
            const second = await kernel.readPracticeSnapshot([session.id], { withMeta: true });
            const timing = await kernel.read('recovery.readingTiming');
            const after = await capture();
            return { commits, repeated, saved, immutable: JSON.stringify(first) === JSON.stringify(second),
                frozen: timing.every(row => row.recordId === session.id && row.snapshot.frozen),
                draftsPreserved: JSON.stringify(before.drafts) === JSON.stringify(after.drafts),
                unrelatedPreserved: JSON.stringify(before.records.practiceDetails.find(row => row.recordId === 'unrelated'))
                    === JSON.stringify(after.records.practiceDetails.find(row => row.recordId === 'unrelated')),
                records: (await AppData.practice.list()).length };
        });
        assert.deepEqual(result.commits, [true, true]); assert.equal(result.repeated, true);
        assert.equal(result.records, 2); assert.equal(result.immutable, true); assert.equal(result.frozen, true);
        assert.equal(result.draftsPreserved, true); assert.equal(result.unrelatedPreserved, true);
        assert.deepEqual(result.saved.answers, fixture.session.finalizeRecord.answers);
        assert.equal(result.saved.correctAnswers, 3); assert.equal(result.saved.duration, 30);
        assert.deepEqual(result.saved.suiteEntries.map(entry => entry.noteText), ['synthetic note 0', 'synthetic note 1', 'synthetic note 2']);
        assert.deepEqual(result.saved.suiteEntries.map(entry => entry.highlights), fixture.session.finalizeRecord.suiteEntries.map(entry => entry.highlights));
        assert.deepEqual(result.saved.suiteEntries.map(entry => entry.readingTiming.totalMs), [1000, 1000, 1000]);
    } finally { await context.close(); }
});

test('replacement fences late saves, acquisitions and checkpoints; concurrent retries keep identities', async () => {
    const { page, context } = await seeded();
    try {
        const result = await page.evaluate(async () => {
            const original = await AppData.recovery.getActiveSession(command.sessionId);
            const attempts = await Promise.allSettled([recover(), recover()]);
            const prepared = await recover();
            const rejected = async fn => { try { await fn(); return false; } catch { return true; } };
            const stale = structuredClone(original.results[2].readingTiming); stale.revision += 100;
            const blocked = await Promise.all([
                rejected(() => AppData.recovery.saveReadingTiming(stale)),
                rejected(() => AppData.recovery.acquireReadingTiming({ ...stale, writer: 'takeover' })),
                rejected(() => AppData.recovery.saveActiveSession({ ...original, revision: 999 }, { operationId: 'late-checkpoint' }))
            ]);
            const finalize = () => AppData.practice.finalizeSuite({ record: prepared.record, operationId: command.operationId });
            await Promise.all([finalize(), finalize()]);
            const committed = await recover();
            return { prepared: attempts.some(result => result.value?.prepared), blocked,
                operationId: committed.operationId, id: committed.record.id,
                operation: committed.operation, count: (await AppData.practice.list()).length };
        });
        assert.equal(result.prepared, true); assert.deepEqual(result.blocked, [true, true, true]);
        assert.equal(result.operationId, fixture.session.finalizeOperationId); assert.equal(result.id, fixture.session.id);
        assert.equal(result.operation, 'committed'); assert.equal(result.count, 2);
    } finally { await context.close(); }
});

for (const scenario of ['writer', 'finalized', 'source', 'answers', 'annotations', 'coverage', 'revision', 'score',
    'invalid-result-timing', 'invalid-draft-timing', 'missing-timing-row']) {
    test(`invalid recovery remains rejected and preserves durable data: ${scenario}`, async () => {
        const { page, context } = await seeded();
        try {
            const result = await page.evaluate(async scenario => {
                const sessions = await kernel.read('recovery.activeSessions');
                const timing = await kernel.read('recovery.readingTiming');
                if (scenario === 'writer') {
                    await AppData.recovery.acquireReadingTiming({ ...timing[2].snapshot, writer: 'other-window' });
                } else {
                    if (scenario === 'finalized') timing[2].recordId = 'other-completion';
                    if (scenario === 'source') timing[2].snapshot.libraryConfigurationId = 'other-library';
                    if (scenario === 'answers') sessions[0].draftsByExam.p3.answers.q1 = 'changed';
                    if (scenario === 'annotations') sessions[0].draftsByExam.p3.noteText = 'changed';
                    if (scenario === 'coverage') sessions[0].results.pop();
                    if (scenario === 'revision') timing[2].snapshot.revision = 99;
                    if (scenario === 'score') sessions[0].finalizeRecord.scoreInfo.accuracy = 'invalid';
                    if (scenario === 'invalid-result-timing') sessions[0].results[2].readingTiming = false;
                    if (scenario === 'invalid-draft-timing') sessions[0].draftsByExam.p3.readingTiming = '';
                    if (scenario === 'missing-timing-row') timing.pop();
                    await kernel.mutate([{ logicalKey: 'recovery.activeSessions', data: sessions },
                        { logicalKey: 'recovery.readingTiming', data: timing }], { operationId: `setup-${scenario}` });
                }
                const before = JSON.stringify(await capture());
                let code, timingReason;
                try { await recover(); } catch (error) { code = error.code; timingReason = error.details?.timingReason; }
                return { code, timingReason, unchanged: before === JSON.stringify(await capture()) };
            }, scenario);
            assert.ok(result.code); assert.equal(result.unchanged, true);
            assert.equal(result.timingReason, { writer: 'writer-mismatch', finalized: 'finalized-row-conflict',
                revision: 'stale-revision', 'missing-timing-row': 'missing-row' }[scenario]);
        } finally { await context.close(); }
    });
}

for (const scenario of ['partial-record', 'deleted-record', 'journal-only']) {
    test(`unknown outcome does not speculate or replace recovery: ${scenario}`, async () => {
        const { page, context } = await seeded();
        try {
            const result = await page.evaluate(async scenario => {
                const op = { type: 'upsert', store: 'practiceSummaries', recordId: command.sessionId, data: { id: command.sessionId } };
                if (scenario === 'journal-only') await kernel.journalNoop({ operationId: command.operationId });
                else {
                    await kernel.mutateEntities([op], { operationId: 'partial-completion' });
                    if (scenario === 'deleted-record') await kernel.mutateEntities([{ ...op, type: 'delete' }], { operationId: 'delete-partial' });
                }
                const before = JSON.stringify(await capture());
                const state = await recover();
                return { operation: state.operation, unchanged: before === JSON.stringify(await capture()) };
            }, scenario);
            assert.equal(result.operation, 'unconfirmed'); assert.equal(result.unchanged, true);
        } finally { await context.close(); }
    });
}

for (const phase of ['replacement', 'completion']) {
    test(`failed ${phase} transaction rolls back and supports later recovery`, async () => {
        const { page, context } = await seeded();
        try {
            const result = await page.evaluate(async phase => {
                let prepared = phase === 'completion' ? await recover() : null;
                const before = JSON.stringify(await capture());
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function(value, ...args) {
                    if ((phase === 'replacement' && value.logicalKey === 'recovery.readingTiming')
                        || (phase === 'completion' && this.name === 'practiceDetails' && value.recordId === command.sessionId)) {
                        throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
                    }
                    return put.call(this, value, ...args);
                };
                let failed = false;
                try {
                    if (prepared) await AppData.practice.finalizeSuite({ record: prepared.record, operationId: command.operationId });
                    else await recover();
                } catch { failed = true; } finally { IDBObjectStore.prototype.put = put; }
                const preserved = before === JSON.stringify(await capture());
                prepared = await recover();
                await AppData.practice.finalizeSuite({ record: prepared.record, operationId: command.operationId });
                return { failed, preserved, operation: (await recover()).operation };
            }, phase);
            assert.deepEqual(result, { failed: true, preserved: true, operation: 'committed' });
        } finally { await context.close(); }
    });
}

for (const interference of ['writer', 'completion']) {
    test(`a concurrent ${interference} between validation and replacement wins the transaction fence`, async () => {
        const { page, context } = await seeded();
        try {
            const result = await page.evaluate(async interference => {
                const sessions = await kernel.read('recovery.activeSessions');
                const timing = await kernel.read('recovery.readingTiming');
                if (interference === 'completion') {
                    const accepted = sessions[0].finalizeRecord.suiteEntries[2].readingTiming;
                    accepted.frozen = true;
                    sessions[0].results[2].readingTiming = structuredClone(accepted);
                    sessions[0].draftsByExam.p3.readingTiming = structuredClone(accepted);
                    timing[2].snapshot = structuredClone(accepted);
                    await kernel.mutate([{ logicalKey: 'recovery.activeSessions', data: sessions },
                        { logicalKey: 'recovery.readingTiming', data: timing }], { operationId: 'valid-race-fixture' });
                }
                const before = await AppData.recovery.getActiveSession(command.sessionId);
                const mutate = TestKernel.prototype.mutate;
                let interfered = false;
                TestKernel.prototype.mutate = async function(changes, options = {}) {
                    if (!interfered && options.operationId?.startsWith('suite-repair:')) {
                        interfered = true;
                        if (interference === 'writer') {
                            await AppData.recovery.acquireReadingTiming({ ...timing[2].snapshot, writer: 'concurrent-writer' });
                        } else {
                            await AppData.practice.finalizeSuite({ record: before.finalizeRecord, operationId: command.operationId });
                        }
                    }
                    return mutate.call(this, changes, options);
                };
                let outcome;
                try { outcome = (await recover()).operation; } catch (error) { outcome = error.code; }
                finally { TestKernel.prototype.mutate = mutate; }
                const after = await AppData.recovery.getActiveSession(command.sessionId);
                return { outcome, preserved: JSON.stringify(before) === JSON.stringify(after),
                    writer: (await AppData.recovery.getReadingTiming('timing-2')).snapshot.writer,
                    count: (await AppData.practice.list()).length };
            }, interference);
            assert.equal(result.preserved, true);
            assert.equal(result.outcome, interference === 'writer' ? 'CONFLICT' : 'committed');
            assert.equal(result.count, interference === 'writer' ? 1 : 2);
            if (interference === 'writer') assert.equal(result.writer, 'concurrent-writer');
        } finally { await context.close(); }
    });
}

test('a commit whose return was lost is reused after reload without rewriting annotations or review plans', async () => {
    const { page, context } = await seeded();
    try {
        await page.evaluate(async () => {
            const prepared = await recover();
            const mutate = TestKernel.prototype.mutateEntities;
            TestKernel.prototype.mutateEntities = async function(operations, options) {
                const receipt = await mutate.call(this, operations, options);
                if (options.operationId === command.operationId) throw new Error('Synthetic lost commit response');
                return receipt;
            };
            try { await AppData.practice.finalizeSuite({ record: prepared.record, operationId: command.operationId }); }
            catch (_) {} finally { TestKernel.prototype.mutateEntities = mutate; }
            await AppData.practice.updateAnnotations({ recordId: command.sessionId, examId: 'p1', patch: { noteText: 'post-commit review note' } });
            sessionStorage.setItem('before-reconcile', JSON.stringify({ records: await kernel.readPracticeSnapshot(null, { withMeta: true }),
                plans: await kernel.read('practice.reviewPlans', { withMeta: true }) }));
        });
        await page.reload(); await load(page);
        const result = await page.evaluate(async () => {
            const app = await makeApp();
            const committed = await app.resumeSuitePractice(command.sessionId);
            const after = { records: await kernel.readPracticeSnapshot(null, { withMeta: true }),
                plans: await kernel.read('practice.reviewPlans', { withMeta: true }) };
            return { committed, unchanged: sessionStorage.getItem('before-reconcile') === JSON.stringify(after) };
        });
        assert.deepEqual(result, { committed: true, unchanged: true });
    } finally { await context.close(); }
});
