import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

test('Reading timing survives ownership changes, transaction failures, suite folding and backup restoration', async () => {
    const server = http.createServer((_, response) => response.end('<!doctype html><title>Timing storage test</title>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        for (const file of ['data/v2/dataCatalog.js', 'data/v2/dataKernel.js', 'data/practiceRecordSource.js',
            'services/readingTiming.js', 'data/v2/appData.js']) {
            if (file === 'data/v2/appData.js') await page.evaluate(() => { window.TimingTestKernel = __AppDataV2Internals.DataKernel; });
            await page.addScriptTag({ content: fs.readFileSync(new URL(`../../../js/${file}`, import.meta.url), 'utf8') });
        }
        const result = await page.evaluate(async () => {
            await AppData.ready;
            const rejected = async (operation, code) => {
                try { await operation(); return false; } catch (error) { return error.code === code; }
            };
            const dataset = { questionOrder: ['q1', 'q2'], questionGroups: [] };
            const identity = { attemptId: 'child-a', examId: 'same-exam', libraryConfigurationId: null,
                parentAttemptId: 'suite-a', sequenceIndex: 0, writer: 'first' };
            const meter = new ReadingTiming.Meter(dataset, identity);
            await AppData.recovery.acquireReadingTiming(meter.snapshot());
            meter.eligibility(true, 0); meter.select('q1', 0); meter.tick(1000);
            const checkpoint = meter.snapshot();
            await AppData.recovery.saveReadingTiming(checkpoint);
            meter.tick(2000);
            const draft = meter.snapshot();
            await AppData.recovery.saveDraft({ id: 'draft-a', readingTiming: draft });
            const savedDraft = (await AppData.recovery.getDraft('draft-a')).readingTiming;
            const nextIdentity = { ...identity, writer: 'second' };
            const next = new ReadingTiming.Meter(dataset, nextIdentity, savedDraft);
            const acquired = await AppData.recovery.acquireReadingTiming(next.snapshot(), savedDraft);
            const resumed = new ReadingTiming.Meter(dataset, nextIdentity, acquired.snapshot);
            const draftTotal = resumed.snapshot().totalMs;
            const staleWriter = await rejected(() => AppData.recovery.saveReadingTiming(draft), 'TIMING_STALE_WRITER');
            const wrongSource = await rejected(() => AppData.recovery.acquireReadingTiming({
                ...resumed.snapshot(), libraryConfigurationId: 'another-library'
            }), 'VALIDATION');
            const conflict = structuredClone(resumed.snapshot());
            conflict.units[0].durationMs--; conflict.unallocatedMs++;
            const conflictingRevision = await rejected(() => AppData.recovery.saveReadingTiming(conflict), 'VALIDATION');
            const regressed = structuredClone(conflict); regressed.revision++;
            const regression = await rejected(() => AppData.recovery.saveReadingTiming(regressed), 'VALIDATION');

            // The browser's actual IDB transaction must roll back a document put
            // when a later entity revision fence rejects the same transaction.
            const kernel = new TimingTestKernel();
            await kernel.initialize();
            const before = await kernel.read('recovery.readingTiming', { withMeta: true });
            const rolledBack = await rejected(() => kernel.mutateEntities([
                { type: 'upsert', store: 'practiceSummaries', recordId: 'must-not-exist', data: { id: 'must-not-exist' }, expectedRevision: 1 }
            ], { operationId: 'forced-atomic-conflict', documentChanges: [
                { logicalKey: 'recovery.readingTiming', data: [], expectedRevision: before.envelope.revision }
            ] }), 'CONFLICT');
            const after = await kernel.read('recovery.readingTiming', { withMeta: true });
            const atomicUnchanged = JSON.stringify(before) === JSON.stringify(after)
                && await kernel.readEntity('practiceSummaries', 'must-not-exist') === null;

            const originalPut = IDBObjectStore.prototype.put;
            resumed.partial('test-checkpoint');
            IDBObjectStore.prototype.put = function (value, ...args) {
                if (this.name === 'documents' && value.logicalKey === 'recovery.readingTiming') {
                    throw new DOMException('Simulated full storage', 'QuotaExceededError');
                }
                return originalPut.call(this, value, ...args);
            };
            let quotaRejected;
            try { quotaRejected = await rejected(() => AppData.recovery.saveReadingTiming(resumed.snapshot()), 'QUOTA_EXCEEDED'); }
            finally { IDBObjectStore.prototype.put = originalPut; }
            const quotaUnchanged = (await AppData.recovery.getReadingTiming(identity.attemptId)).snapshot.revision === acquired.snapshot.revision;
            await AppData.recovery.saveReadingTiming(resumed.snapshot());

            resumed.freeze(90000);
            await AppData.recovery.saveReadingTiming(resumed.snapshot());
            const record = { id: 'child-record', sessionId: 'child-session', examId: identity.examId, type: 'reading',
                duration: 99, totalQuestions: 2, correctAnswers: 1, metadata: { libraryConfigurationId: null },
                readingTiming: resumed.snapshot() };
            await AppData.practice.completeAttempt({ operationId: 'complete-child', record });
            await AppData.practice.completeAttempt({ operationId: 'complete-child', record });
            const frozenWriter = await rejected(() => AppData.recovery.acquireReadingTiming(resumed.snapshot()), 'TIMING_FINALIZED');
            const full = await AppData.practice.get(record.id);
            const light = await AppData.practice.get(record.id, { projection: 'light' });

            const secondMeter = new ReadingTiming.Meter(dataset, { ...identity, attemptId: 'child-b', sequenceIndex: 1 });
            await AppData.recovery.acquireReadingTiming(secondMeter.snapshot());
            secondMeter.eligibility(true, 0); secondMeter.select('q2', 0); secondMeter.freeze(500);
            await AppData.recovery.saveReadingTiming(secondMeter.snapshot());
            const suiteRecord = { id: 'suite-record', sessionId: 'suite-a', examId: 'suite-a', type: 'reading', suiteMode: true,
                duration: 150, totalQuestions: 4, correctAnswers: 2, metadata: { libraryConfigurationId: null },
                suiteEntries: [full, { examId: identity.examId, readingTiming: secondMeter.snapshot(), totalQuestions: 2, correctAnswers: 1 }] };
            await AppData.practice.finalizeSuite({ operationId: 'complete-suite', childRecordIds: [record.id], record: suiteRecord });
            await AppData.practice.finalizeSuite({ operationId: 'complete-suite', childRecordIds: [record.id], record: suiteRecord });
            const folded = await AppData.practice.get('suite-record');
            const childRemoved = await AppData.practice.get(record.id) === null;
            const total = ReadingTiming.aggregate(folded.suiteEntries);
            const backup = await AppData.backups.create({ id: 'timing-backup' });
            const exported = await AppData.backups.export();
            await AppData.practice.clear();
            await AppData.recovery.clear();
            await AppData.backups.restore(backup.id);
            const restored = await AppData.practice.get('suite-record');
            const backupEqual = JSON.stringify(restored.suiteEntries) === JSON.stringify(folded.suiteEntries);
            const importPlan = await AppData.backups.previewImport(exported, { replace: true });
            await AppData.backups.commitImport(importPlan.id, { confirmDestructive: true });
            const imported = await AppData.practice.get('suite-record');
            const importEqual = JSON.stringify(imported.suiteEntries) === JSON.stringify(folded.suiteEntries);
            await AppData.practice.updateAnnotations({ recordId: 'suite-record', examId: identity.examId, patch: { noteText: 'Review notes' } });
            const reviewed = await AppData.practice.get('suite-record');
            const annotationUnchanged = JSON.stringify(reviewed.suiteEntries.map(entry => entry.readingTiming))
                === JSON.stringify(folded.suiteEntries.map(entry => entry.readingTiming));
            await AppData.recovery.clear();
            const changed = structuredClone(folded);
            changed.suiteEntries[0].readingTiming = null;
            const immutableWithoutJournal = await rejected(() => AppData.practice.completeAttempt({
                operationId: 'illegal-record-rewrite', record: changed
            }), 'TIMING_FINALIZED');
            kernel.close();
            return { draftTotal, staleWriter, wrongSource, conflictingRevision, regression, rolledBack, atomicUnchanged,
                quotaRejected, quotaUnchanged, frozenWriter, full, light, childRemoved, total, backupEqual, importEqual, annotationUnchanged, immutableWithoutJournal };
        });
        assert.equal(result.draftTotal, 2000, 'a newer committed host draft must survive journal takeover');
        for (const name of ['staleWriter', 'wrongSource', 'conflictingRevision', 'regression', 'rolledBack', 'atomicUnchanged',
            'quotaRejected', 'quotaUnchanged', 'frozenWriter', 'childRemoved', 'backupEqual', 'importEqual', 'annotationUnchanged', 'immutableWithoutJournal']) assert.equal(result[name], true, name);
        assert.equal(result.full.duration, 99, 'existing duration remains independent');
        assert.equal(result.light.readingTimingSummary.totalMs, 2000);
        assert.equal(result.light.readingTiming, undefined);
        assert.equal(result.total.totalMs, 2500, 'two occurrences of the same exam remain distinct child attempts');
        assert.equal(result.total.measuredChildren, 2);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
});
