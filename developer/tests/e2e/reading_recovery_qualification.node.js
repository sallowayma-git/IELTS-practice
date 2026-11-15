import assert from 'node:assert/strict';
import fs from 'node:fs';
import { environment, openHost, saveReport, restoreInstrumentation } from './helpers/readingQualification.mjs';
import { configureSyncContext, prepareSync } from './helpers/readingQualificationSync.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/suite-finalizing-pre-fix.json', import.meta.url)));
const env = await environment();
const report = { ...env.provenance, cases: [] };
const id = fixture.session.id;
const command = { sessionId: id, operationId: fixture.session.finalizeOperationId };
const scenarios = (process.env.READING_RECOVERY_SCENARIOS ? process.env.READING_RECOVERY_SCENARIOS.split(',') : null) || ['persisted-fixture', 'concurrent-confirmation',
    'replacement-write-failure', 'completion-write-failure', 'unknown-outcome', 'commit-return-lost',
    'writer-takeover', 'revision-drift'];

async function context() {
    const context = await env.browser.newContext({ viewport: { width: 1365, height: 1000 } });
    await configureSyncContext(context);
    await context.addInitScript(() => {
        // Retain the real constructor solely to seed/read synthetic fixtures and
        // gate transaction boundaries; production bootstrap still closes its channel.
        const remove = Reflect.deleteProperty;
        Reflect.deleteProperty = function(object, key) {
            if (object === window && key === '__AppDataV2Internals') {
                window.__qualificationKernel = object[key].DataKernel;
                Reflect.deleteProperty = remove;
            }
            return remove(object, key);
        };
    });
    return context;
}
async function seed(page) {
    await page.evaluate(async source => {
        const kernel = new window.__qualificationKernel(); await kernel.initialize();
        source.session.lastUpdate = Date.now(); source.session.updatedAt = new Date().toISOString();
        source.timingRows.forEach(row => { row.updatedAt = new Date().toISOString(); });
        await kernel.mutate([
            { logicalKey: 'recovery.activeSessions', data: [source.session, { id: 'unrelated-session', updatedAt: new Date().toISOString() }] },
            { logicalKey: 'recovery.readingTiming', data: source.timingRows },
            { logicalKey: 'recovery.drafts', data: [{ id: 'unrelated-draft', answers: { q1: 'synthetic keep' }, updatedAt: new Date().toISOString() }] }
        ], { operationId: 'qualification-fixture' });
        await AppData.practice.completeAttempt({ operationId: 'unrelated-completion', record: {
            id: 'unrelated', examId: 'other', type: 'reading', answers: { q1: 'synthetic keep' }, totalQuestions: 1, correctAnswers: 1
        } });
        kernel.close();
    }, structuredClone(fixture));
}
async function capture(page) {
    return page.evaluate(async id => {
        const kernel = new window.__qualificationKernel(); await kernel.initialize();
        try {
            return { session: await AppData.recovery.getActiveSession(id),
                timing: await kernel.read('recovery.readingTiming', { withMeta: true }),
                drafts: await kernel.read('recovery.drafts', { withMeta: true }),
                records: await kernel.readPracticeSnapshot(null, { withMeta: true }),
                plans: await kernel.read('practice.reviewPlans', { withMeta: true }),
                unrelated: await AppData.practice.get('unrelated') };
        } finally { kernel.close(); }
    }, id);
}
async function recoverUI(page) {
    await page.evaluate(() => { void window.startSuitePractice(); });
    await page.locator('[data-suite-recovery-choice="continue"]').filter({ hasText: '恢复并确认提交' }).click();
}
async function committed(page) {
    return page.evaluate(async command => {
        for (let poll = 0; poll < 300; poll++) {
            const state = await AppData.practice.getSuiteCommitState(command.sessionId, command.operationId);
            const record = await AppData.practice.get(command.sessionId);
            if (state.operation === 'committed' && record) return record;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('No authoritative suite commit: ' + JSON.stringify(AppDiagnostics.snapshot().events.map(event =>
            ({ code: event.code, reason: event.timingReason, operation: event.persistence?.operation }))));
    }, command);
}
async function verify(page, before) {
    const saved = await committed(page);
    const after = await capture(page);
    assert.equal(saved.id, id); assert.equal(saved.operationId, command.operationId);
    assert.equal(saved.submissionId ?? null, null, 'the pre-fix fixture has no receipt ID; recovery must not invent one');
    for (const field of ['answers', 'answerComparison', 'correctAnswers', 'totalQuestions', 'duration', 'scoreInfo']) {
        assert.deepEqual(saved[field], fixture.session.finalizeRecord[field], `preserved ${field}`);
    }
    for (const [index, entry] of saved.suiteEntries.entries()) {
        const original = fixture.session.finalizeRecord.suiteEntries[index];
        for (const field of ['examId', 'sessionId', 'answers', 'answerComparison', 'scoreInfo', 'duration',
            'highlights', 'notes', 'noteOutlines', 'noteText', 'markedQuestions']) assert.deepEqual(entry[field], original[field], field);
        const timing = entry.readingTiming;
        for (const field of ['attemptId', 'examId', 'libraryConfigurationId', 'parentAttemptId', 'sequenceIndex',
            'writer', 'totalMs', 'unallocatedMs', 'units']) assert.deepEqual(timing[field], original.readingTiming[field], field);
        assert.equal(timing.frozen, true);
        const row = after.timing.data.find(row => row.id === timing.attemptId);
        assert.equal(row.recordId, id); assert.deepEqual(row.snapshot, timing);
    }
    assert.deepEqual(after.unrelated, before.unrelated);
    assert.deepEqual(after.drafts, before.drafts);
    const records = await page.evaluate(() => AppData.practice.list());
    assert.equal(records.filter(row => row.id === id).length, 1);
    assert.equal(records.length, 2);
    return { saved, after };
}

try {
    for (const scenario of scenarios) {
        const ctx = await context();
        let sync;
        try {
            const host = await openHost(ctx, env);
            await seed(host);
            sync = await prepareSync(host, env);
            await sync?.incoming();
            const before = await capture(host);
            let evidence = {};
            if (scenario === 'writer-takeover' || scenario === 'revision-drift') {
                const writer = await openHost(ctx, env);
                const advanced = await writer.evaluate(async scenario => {
                    const old = (await AppData.recovery.getReadingTiming('timing-2')).snapshot;
                    const next = scenario === 'writer-takeover'
                        ? (await AppData.recovery.acquireReadingTiming({ ...old, writer: 'second-window-writer' })).snapshot
                        : { ...old, revision: old.revision + 100 };
                    if (scenario === 'revision-drift') await AppData.recovery.saveReadingTiming(next);
                    return next;
                }, scenario);
                const valid = await capture(writer);
                const rejected = await host.evaluate(async command => {
                    try { await AppData.practice.recoverSuiteFinalization(command); return null; }
                    catch (error) { return { code: error.code, reason: error.details?.timingReason }; }
                }, command);
                assert.equal(rejected?.reason, scenario === 'writer-takeover' ? 'writer-mismatch' : 'stale-revision');
                assert.deepEqual(await capture(host), valid, 'the stale window cannot overwrite the valid writer');
                // Let the valid window commit its own result, then retry the stale
                // suite and prove the valid result and unrelated records survive.
                await writer.evaluate(async timing => {
                    timing.frozen = true; timing.revision++;
                    await AppData.recovery.saveReadingTiming(timing);
                    await AppData.practice.completeAttempt({ operationId: 'valid-writer-complete', record: {
                        id: 'valid-writer', examId: timing.examId, type: 'reading', readingTiming: timing,
                        answers: { q1: 'valid writer answer' }, correctAnswers: 1, totalQuestions: 1
                    } });
                }, advanced);
                const winning = await capture(writer);
                await recoverUI(host);
                await host.waitForFunction(() => AppDiagnostics.snapshot().events.some(event => event.timingReason === 'finalized-row-conflict'));
                assert.deepEqual(await capture(host), winning);
                assert.deepEqual(winning.session.draftsByExam, before.session.draftsByExam);
                evidence = { rejection: rejected, completedSuiteRecords: 0, validWriterRecords: 1, unrelatedPreserved: true };
            } else if (scenario === 'unknown-outcome') {
                // Journal-only evidence represents a real ambiguous durable state.
                await host.evaluate(async command => {
                    const kernel = new __qualificationKernel(); await kernel.initialize();
                    await kernel.journalNoop({ operationId: command.operationId }); kernel.close();
                }, command);
                const uncertain = await capture(host);
                await recoverUI(host);
                await host.waitForFunction(() => AppDiagnostics.snapshot().events.some(event => event.module === 'suite'
                    && event.persistence?.operation === 'unconfirmed'));
                assert.deepEqual(await capture(host), uncertain);
                assert.equal(await host.evaluate(id => AppData.practice.get(id), id), null);
                evidence = { operation: 'unconfirmed', completedSuiteRecords: 0, recoveryPreserved: true };
            } else {
                if (scenario.endsWith('write-failure')) {
                    await host.evaluate(({ scenario, id }) => {
                        window.__qualificationFailures = 0;
                        const shouldFail = (store, value) =>
                            (scenario === 'replacement-write-failure' && value?.logicalKey === 'recovery.readingTiming')
                            || (scenario === 'completion-write-failure' && store === 'practiceDetails' && value?.recordId === id);
                        const fail = () => {
                            window.__qualificationFailures++;
                            throw new DOMException('Synthetic qualification storage fault', 'QuotaExceededError');
                        };
                        if (window.FileJournal) {
                            // The database is a disposable projection. Fail the
                            // authoritative JSONL write before publishing its head.
                            const create = FileSystemFileHandle.prototype.createWritable;
                            window.__restoreQualification = () => { FileSystemFileHandle.prototype.createWritable = create; };
                            FileSystemFileHandle.prototype.createWritable = async function(...args) {
                                const writer = await create.apply(this, args);
                                if (this.name.startsWith('ops-')) {
                                    const write = writer.write.bind(writer);
                                    writer.write = async value => {
                                        const segment = JSON.parse(value);
                                        if (segment.changes?.some(change => change.type === 'put' && shouldFail(change.store, change.row))) fail();
                                        return write(value);
                                    };
                                }
                                return writer;
                            };
                        } else {
                            const put = IDBObjectStore.prototype.put;
                            window.__restoreQualification = () => { IDBObjectStore.prototype.put = put; };
                            IDBObjectStore.prototype.put = function(value, ...args) {
                                if (shouldFail(this.name, value)) fail();
                                return put.call(this, value, ...args);
                            };
                        }
                    }, { scenario, id });
                    await recoverUI(host);
                    await host.waitForFunction(() => window.__qualificationFailures > 0
                        && AppDiagnostics.snapshot().events.some(event => event.module === 'suite' && event.code === 'PRACTICE_SAVE_FAILED'));
                    await host.evaluate(() => window.__restoreQualification());
                    const failed = await capture(host);
                    assert.equal(await host.evaluate(id => AppData.practice.get(id), id), null);
                    assert.deepEqual(failed.unrelated, before.unrelated); assert.deepEqual(failed.drafts, before.drafts);
                    assert.deepEqual(failed.session.finalizeRecord.answers, before.session.finalizeRecord.answers);
                    if (scenario === 'replacement-write-failure') assert.deepEqual(failed.timing, before.timing);
                    else assert.equal(failed.session.finalizeRecoveryVersion, 1);
                    evidence.failedWriteRetainedDraft = true;
                    await host.reload();
                    await host.waitForFunction(() => window.app?.isInitialized === true);
                }
                if (scenario === 'commit-return-lost') {
                    await host.evaluate(command => {
                        const proto = __qualificationKernel.prototype, mutate = proto.mutateEntities;
                        window.__restoreQualification = () => { proto.mutateEntities = mutate; };
                        proto.mutateEntities = async function(ops, options) {
                            const receipt = await mutate.call(this, ops, options);
                            if (options.operationId === command.operationId) {
                                window.__qualificationLost = true;
                                throw new Error('Synthetic lost transaction return');
                            }
                            return receipt;
                        };
                    }, command);
                }
                if (scenario === 'concurrent-confirmation') {
                    const other = await openHost(ctx, env);
                    await Promise.all([recoverUI(host), recoverUI(other)]);
                    await committed(other);
                } else await recoverUI(host);
                const { saved, after } = await verify(host, before);
                if (scenario === 'commit-return-lost') assert.equal(await host.evaluate(() => window.__qualificationLost), true);
                await restoreInstrumentation(ctx);
                // A second live host and a reload both reconcile the same operation.
                const other = await openHost(ctx, env);
                await other.evaluate(id => window.app.resumeSuitePractice(id), id);
                await host.reload(); await host.waitForFunction(() => window.app?.isInitialized === true);
                assert.deepEqual(await host.evaluate(id => AppData.practice.get(id), id), saved);
                const repeated = await capture(host);
                assert.deepEqual(repeated.records, after.records);
                assert.deepEqual(repeated.plans, after.plans);
                evidence = { ...evidence, completedSuiteRecords: 1, totalRecords: 2, preservedAnswersAnnotationsScoreTiming: true,
                    originalIdentities: true, unrelatedPreserved: true, immutableAfterRepeatAndReload: true };
                if (sync) evidence.sync = await sync.verify(id);
            }
            report.cases.push({ scenario, outcome: 'passed', ...evidence });
            console.log(`${scenario}: passed`);
        } finally { await sync?.close(); await restoreInstrumentation(ctx); await ctx.close(); }
    }
    report.status = 'passed';
} catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, message: error.message };
    throw error;
} finally {
    await env.close(); saveReport('reading-recovery-qualification.json', report);
}
