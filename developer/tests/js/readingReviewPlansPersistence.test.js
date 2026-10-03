import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

const scripts = ['data/v2/dataCatalog.js', 'data/v2/dataKernel.js', 'data/practiceRecordSource.js',
    'core/vocabScheduler.js', 'core/practiceReviewScheduler.js', 'data/v2/appData.js']
    .map(name => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8'));

test('article plans and practice records commit atomically across real IndexedDB writers and restore', async () => {
    const server = http.createServer((_req, res) => res.end('<!doctype html><title>Isolated review database</title>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
        const pages = await Promise.all([context.newPage(), context.newPage()]);
        for (const page of pages) {
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for (const content of scripts) await page.addScriptTag({ content });
            await page.evaluate(() => AppData.ready);
        }
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
        const task = await pages[0].evaluate(() => AppData.practice.getReviewTask('article:reading-one'));
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
        assert.equal((await pages[1].evaluate(() => AppData.practice.getReviewTask('article:reading-one'))).recordId, 'redo');
        await pages[1].evaluate(async () => {
            const snapshot = await AppData.backups.export({ domains: ['practice'] });
            await AppData.practice.clear();
            const plan = await AppData.backups.previewImport(snapshot);
            await AppData.backups.commitImport(plan.id);
        });
        const restored = await pages[1].evaluate(() => AppData.practice.getReviewTask('article:reading-one'));
        assert.deepEqual(restored, task, 'practice-scoped export restores the complete article plan');
        assert.equal(await pages[1].evaluate(async () => (await AppData.practice.get('redo')).notes[0].id), 'redo');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
