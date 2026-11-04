import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

const scripts = ['data/v2/dataCatalog.js', 'data/v2/dataKernel.js', 'data/practiceRecordSource.js',
    'core/vocabScheduler.js', 'core/practiceReviewScheduler.js', 'data/v2/appData.js']
    .map(name => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8'));
const readingCatalog = fs.readFileSync(new URL('../../../assets/generated/reading-exams/manifest.js', import.meta.url), 'utf8');

async function withAppDataPages(count, run) {
    const server = http.createServer((_req, res) => res.end('<!doctype html><title>Isolated review database</title>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const pages = await Promise.all(Array.from({ length: count }, () => context.newPage()));
        for (const page of pages) {
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for (const content of scripts.slice(0, -1)) await page.addScriptTag({ content });
            await page.evaluate(() => { window.testDataInternals = window.__AppDataV2Internals; });
            await page.addScriptTag({ content: scripts.at(-1) });
            await page.addScriptTag({ content: readingCatalog });
            await page.evaluate(() => AppData.ready);
        }
        return await run(pages);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

test('the bundled ocean reading passage receives a persisted review plan despite its listening title', async t => {
    await withAppDataPages(2, async ([writer, reader]) => {
        const passage = await writer.evaluate(() => window.__READING_EXAM_MANIFEST__['p1-medium-182']);
        assert.equal(passage.title, 'Listening to the Ocean 海洋探测');
        const cases = [
            { id: 'ocean-reading', type: 'reading', title: passage.title, enrolled: true },
            { id: 'neutral-reading', type: 'reading', title: 'Ocean exploration', enrolled: true },
            { id: 'listening-control', type: 'listening', title: 'Reading strategies', enrolled: false }
        ];
        for (const { id, type, title, enrolled } of cases) {
            await t.test(id, async () => {
                const receipt = await writer.evaluate(async record => AppData.practice.completeAttempt({
                    operationId: record.id, record
                }), { id, type, title, examId: passage.examId, sessionId: id,
                    metadata: { libraryConfigurationId: id },
                    completedAt: '2026-09-01T00:20:00.000Z', totalQuestions: 13, correctAnswers: 8 });
                assert.equal(receipt.committed, true);
                assert.equal(receipt.record.type, type);
                const result = await reader.evaluate(async id => {
                    const queue = await AppData.practice.listReviewQueue();
                    const queued = queue.records.filter(record => record.recordId === id);
                    return { state: await AppData.practice.getReviewState(id), queued,
                        task: queued.length ? await AppData.practice.getReviewTask(queued[0].id) : null };
                }, id);
                if (enrolled) {
                    assert.equal(result.state?.reviewCount, 1);
                    assert.equal(result.state.nextReview, '2026-09-02T00:20:00.000Z');
                    assert.equal(result.queued.length, 1);
                    assert.equal(result.queued[0].wrongCount, 5);
                    assert.equal(result.task.recordId, id);
                    assert.equal(result.task.examId, passage.examId);
                    assert.equal(result.task.summary.title, title);
                } else {
                    assert.equal(result.state, null);
                    assert.deepEqual(result.queued, []);
                    assert.equal(result.task, null);
                }
            });
        }
    });
});

test('article plans and practice records commit atomically across real IndexedDB writers and restore', async () => {
    await withAppDataPages(2, async pages => {
        const firstRead = await pages[0].evaluate(async () => {
            const prototype = IDBObjectStore.prototype;
            const originals = {}; let writes = 0; let scans = 0;
            for (const method of ['put', 'getAll', 'openCursor']) {
                originals[method] = prototype[method];
                prototype[method] = function(...args) {
                    if (method === 'put') writes++;
                    else if (this.name.startsWith('practice')) scans++;
                    return originals[method].apply(this, args);
                };
            }
            try { return { total: (await AppData.practice.listReviewQueue()).records.length, writes, scans }; }
            finally { for (const method of Object.keys(originals)) prototype[method] = originals[method]; }
        });
        assert.deepEqual(firstRead, { total: 0, writes: 0, scans: 0 }, 'first read never migrates or scans history');
        const complete = (page, id, examId, day, correct = 7) => page.evaluate(async input => {
            return AppData.practice.completeAttempt({ operationId: input.id, record: {
                ...input, sessionId: input.id, type: 'reading', title: input.examId,
                completedAt: `2026-09-${input.day}T00:00:00.000Z`, totalQuestions: 10, correctAnswers: input.correct,
                notes: [{ id: input.id, body: 'latest evidence' }], answers: { q1: 'A' }
            } });
        }, { id, examId, day, correct });
        await Promise.all([complete(pages[0], 'one', 'reading-one', '01'), complete(pages[1], 'two', 'reading-two', '01')]);
        assert.equal(await pages[0].evaluate(async () => (await AppData.practice.listReviewQueue()).records.length), 2);
        await complete(pages[1], 'redo', 'reading-one', '02', 8);
        const taskId = await pages[0].evaluate(async () => (await AppData.practice.listReviewQueue()).records
            .find((record) => record.examId === 'reading-one').id);
        const task = await pages[0].evaluate((id) => AppData.practice.getReviewTask(id), taskId);
        assert.equal(task.recordId, 'redo');
        assert.equal(task.reviewState.reviewCount, 2);
        assert.equal(task.reviewState.lastQuality, 'good');
        await pages[0].evaluate(() => {
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function(value, ...args) {
                if (value?.logicalKey === 'practice.reviewPlans') throw new DOMException('Injected plan quota', 'QuotaExceededError');
                return put.call(this, value, ...args);
            };
        });
        await assert.rejects(complete(pages[0], 'aborted', 'reading-one', '03', 9));
        assert.equal(await pages[1].evaluate(() => AppData.practice.get('aborted')), null, 'plan failure rolls back the practice rows');
        assert.equal((await pages[1].evaluate((id) => AppData.practice.getReviewTask(id), taskId)).recordId, 'redo');
        await pages[1].evaluate(async () => {
            const snapshot = await AppData.backups.export({ domains: ['practice'] });
            await AppData.practice.clear();
            const plan = await AppData.backups.previewImport(snapshot);
            await AppData.backups.commitImport(plan.id);
        });
        const restored = await pages[1].evaluate((id) => AppData.practice.getReviewTask(id), taskId);
        assert.deepEqual(restored, task, 'practice-scoped export restores the complete article plan');
        assert.equal(await pages[1].evaluate(async () => (await AppData.practice.get('redo')).notes[0].id), 'redo');
    });
});

test('historical replay annotations retain stored identities and existing content', async t => {
    await withAppDataPages(1, async ([page]) => {
        const aliases = await page.evaluate(() => window.__READING_EXAM_ALIASES__);
        assert.equal(Object.keys(aliases).length, 3, 'exercise every released retired alias');
        for (const [retiredId, canonicalId] of Object.entries(aliases)) {
            for (const storedId of [retiredId, canonicalId]) {
                for (const suite of [false, true]) {
                    await t.test(`${storedId}: ${suite ? 'suite' : 'single'}`, async () => {
                        const result = await page.evaluate(async ({ retiredId, canonicalId, storedId, suite }) => {
                            const recordId = `${storedId}-${suite ? 'suite' : 'single'}`;
                            const annotations = {
                                notes: [{ id: 'existing-note', body: 'saved before replay' }],
                                highlights: [{ id: 'existing-highlight', text: 'original evidence' }],
                                markedQuestions: ['q1'], noteOutlines: [{ id: 'outline', title: 'Evidence' }]
                            };
                            const entry = { examId: storedId, metadata: { examId: storedId }, type: 'reading',
                                completedAt: '2026-09-01T00:00:00.000Z', totalQuestions: 10, correctAnswers: 7,
                                answers: { q1: 'A' }, ...annotations };
                            const record = suite
                                ? { id: recordId, examId: 'suite', type: 'reading-suite', suiteEntries: [entry,
                                    { ...entry, examId: 'other-passage', metadata: { examId: 'other-passage' } }] }
                                : { ...entry, id: recordId };
                            await AppData.practice.completeAttempt({ operationId: recordId, record });
                            const before = await AppData.backups.export({ domains: ['practice'] });
                            const replay = await AppData.practice.get(recordId, { projection: 'full' });
                            const replayEntry = suite ? replay.suiteEntries[0] : replay;
                            await AppData.practice.updateAnnotations({ recordId, examId: replayEntry.examId,
                                patch: { notes: [...replayEntry.notes, { id: 'new-note', body: 'added in replay' }] } });
                            await AppData.practice.updateAnnotations({ recordId, examId: canonicalId,
                                patch: { highlights: [...replayEntry.highlights, { id: 'new-highlight', text: 'new evidence' }] } });
                            // Older replay clients may still send the retired ID.
                            await AppData.practice.updateAnnotations({ recordId, examId: retiredId, patch: { scrollY: 123 } });
                            let unrelatedError;
                            try { await AppData.practice.updateAnnotations({ recordId, examId: 'unrelated-passage', patch: { notes: [] } }); }
                            catch (error) { unrelatedError = error.code; }
                            const after = await AppData.backups.export({ domains: ['practice'] });
                            const full = await AppData.practice.get(recordId, { projection: 'full' });
                            const stored = after.entities.practiceAnnotations.find(row => row.recordId === recordId).data;
                            return { before: before.entities, after: after.entities, replayEntry, full,
                                stored, unrelatedError, annotations };
                        }, { retiredId, canonicalId, storedId, suite });
                        assert.equal(result.replayEntry.examId, canonicalId);
                        assert.deepEqual(result.after.practiceSummaries, result.before.practiceSummaries, 'historical summaries are unchanged');
                        assert.deepEqual(result.after.practiceDetails, result.before.practiceDetails, 'historical facts and IDs are unchanged');
                        const full = suite ? result.full.suiteEntries[0] : result.full;
                        assert.equal(full.examId, canonicalId);
                        assert.deepEqual(full.notes.map(note => note.id), ['existing-note', 'new-note']);
                        assert.deepEqual(full.highlights.map(highlight => highlight.id), ['existing-highlight', 'new-highlight']);
                        assert.deepEqual(full.markedQuestions, result.annotations.markedQuestions);
                        assert.deepEqual(full.noteOutlines, result.annotations.noteOutlines);
                        assert.equal(full.scrollY, 123);
                        const keyed = suite ? result.stored.suiteEntries : result.stored.annotations;
                        assert.deepEqual(keyed[storedId].notes, full.notes, 'updates use the stored annotation key');
                        assert.equal(Object.hasOwn(keyed, storedId === retiredId ? canonicalId : retiredId), false, 'aliases do not create orphan annotation keys');
                        assert.equal(result.unrelatedError, 'VALIDATION', 'unrelated exam IDs remain invalid');
                        if (suite) {
                            assert.deepEqual(result.full.suiteEntries[1].notes, result.annotations.notes);
                            assert.deepEqual(result.full.suiteEntries[1].highlights, result.annotations.highlights);
                        }
                    });
                }
            }
        }
    });
});

for (const includePlans of [true, false]) {
    test(`backup merge ${includePlans ? 'with' : 'without'} imported plans rejects a concurrent review and can be previewed again`, async () => {
        await withAppDataPages(2, async ([importer, reviewer]) => {
            const snapshot = await importer.evaluate(async includePlans => {
                await AppData.practice.completeAttempt({ operationId: 'seed-review', record: {
                    id: 'review-record', examId: 'reading-review', type: 'reading',
                    completedAt: '2026-09-01T00:00:00.000Z', totalQuestions: 10, correctAnswers: 7,
                    answers: { q1: 'A' }
                } });
                const snapshot = await AppData.backups.export({ domains: ['practice'] });
                if (!includePlans) {
                    delete snapshot.envelopes['practice.reviewPlans'];
                    snapshot.checksum = window.testDataInternals.checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities });
                }
                return snapshot;
            }, includePlans);
            const before = await reviewer.evaluate(() => AppData.practice.getReviewTask('review-record'));
            assert.equal(before.reviewState.reviewCount, 1);
            let reviewReceipt;
            await importer.exposeFunction('commitConcurrentReview', async () => {
                reviewReceipt = await reviewer.evaluate(() => AppData.practice.recordReviewOutcome({
                    recordId: 'review-record', reviewAttemptId: 'other-tab-review',
                    quality: 'good', reviewedAt: '2026-09-02T01:00:00.000Z'
                }));
            });
            const plan = await importer.evaluate(async snapshot => {
                const prototype = window.testDataInternals.DataKernel.prototype;
                const read = prototype.read;
                let injected = false;
                prototype.read = async function(key, options) {
                    const current = await read.call(this, key, options);
                    if (key === 'practice.reviewPlans' && !injected) {
                        injected = true;
                        // Commit after the captured read, before preview can read again.
                        await window.commitConcurrentReview();
                    }
                    return current;
                };
                try { return await AppData.backups.previewImport(snapshot, { practiceMode: 'merge' }); }
                finally { prototype.read = read; }
            }, snapshot);
            assert.equal(reviewReceipt.committed, true);
            const concurrent = await reviewer.evaluate(() => AppData.practice.getReviewTask('review-record'));
            assert.equal(concurrent.reviewState.reviewCount, 2);
            assert.notEqual(concurrent.reviewState.nextReview, before.reviewState.nextReview);
            assert.ok(concurrent.reviewState.appliedReviewAttemptIds.includes('other-tab-review'));
            const commitError = await importer.evaluate(async planId => {
                try { await AppData.backups.commitImport(planId); return null; }
                catch (error) { return error.code; }
            }, plan.id);
            assert.equal(commitError, 'CONFLICT', 'a stale preview cannot install over a successful review');
            assert.deepEqual(await reviewer.evaluate(() => AppData.practice.getReviewTask('review-record')), concurrent);
            const retry = await importer.evaluate(async snapshot => {
                const preview = await AppData.backups.previewImport(snapshot, { practiceMode: 'merge' });
                return AppData.backups.commitImport(preview.id);
            }, snapshot);
            assert.equal(retry.committed, true, 'a fresh preview can be committed');
            assert.deepEqual(await reviewer.evaluate(() => AppData.practice.getReviewTask('review-record')), concurrent,
                'the new preview retains the review count, schedule, and attempt ID');
        });
    });
}
