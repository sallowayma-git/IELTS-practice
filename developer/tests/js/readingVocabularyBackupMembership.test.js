import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

// Exercise full backup import through production AppData and actual IndexedDB.
const scripts = [
    'data/v2/dataCatalog.js', 'data/v2/dataKernel.js', 'data/practiceRecordSource.js',
    'data/v2/readingVocabularyModel.js', 'data/v2/appData.js'
].map((name) => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8'));
const AT = '2026-09-08T01:00:00.000Z';
const SOURCE = { kind: 'imported', id: 'membership-backup-library' };
const word = (id, repetitions, grade) => ({
    id, word: 'apple', meaning: `Definition for ${id}`, note: `Progress ${repetitions}`,
    easeFactor: 2.3, interval: repetitions * 3, repetitions, correctCount: repetitions + 1,
    lastReviewed: AT, nextReview: '2026-09-29T01:00:00.000Z',
    reviewHistory: [{ at: AT, grade }]
});
const incomingWords = [word('shared-apple-id', 2, 2)];
const incomingLists = {
    custom: { id: 'custom', name: 'Personal words', words: [word('shared-apple-id', 4, 3)] },
    'spelling-errors': { id: 'spelling-errors', name: 'Spelling errors', words: [word('spelling-apple', 6, 4)] }
};

async function loadAppData(page) {
    for (const content of scripts) await page.addScriptTag({ content });
    await page.evaluate(() => AppData.ready);
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
}

async function snapshot(page) {
    return page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
}

async function seed(page, words, lists, owner, examId) {
    await page.evaluate(async ({ words, lists, owner, examId, source, at }) => {
        await AppData.vocab.saveWords(words);
        await AppData.vocab.saveCollections(lists);
        await AppData.vocab.mutateReading('collect', {
            source, article: { examId, title: examId }, word: { word: 'apple' }, wordRef: owner, at,
            occurrence: { scopeId: 'passage-1', contentVersion: 'membership-fixture-v1',
                startOffset: 0, endOffset: 5, quote: 'apple' }
        });
    }, { words, lists, owner, examId, source: SOURCE, at: AT });
}

async function mergeBackup(page, backup) {
    const receipt = await page.evaluate(async (backup) => {
        const plan = await AppData.backups.previewImport(backup);
        return AppData.backups.commitImport(plan.id);
    }, backup);
    assert.equal(receipt.committed, true);
}

test('full backup merge preserves same-term list memberships and per-list review history in IndexedDB', { timeout: 60000 }, async (t) => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><title>Vocabulary backup membership integration</title>');
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    let browser;
    t.after(async () => {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });
    const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const url = `http://127.0.0.1:${server.address().port}/`;
    async function pageFor(t) {
        const context = await browser.newContext();
        t.after(() => context.close());
        const page = await context.newPage();
        await page.goto(url);
        await loadAppData(page);
        return page;
    }

    const exporter = await pageFor(t);
    await seed(exporter, incomingWords, incomingLists,
        { listId: 'spelling-errors', wordId: 'spelling-apple' }, 'imported-article');
    const backup = await exporter.evaluate(() => AppData.backups.export());
    assert.equal(backup.scope, 'full');

    for (const hasLocalProgress of [false, true]) {
        await t.test(hasLocalProgress ? 'existing list progress and explicit local owner survive'
            : 'an empty installation retains all incoming lists and its explicit owner', async (t) => {
            const page = await pageFor(t);
            const localWords = [word('shared-apple-id', 12, 5)];
            const localLists = { custom: { id: 'custom', name: 'Local personal words',
                words: [word('shared-apple-id', 14, 5)] } };
            if (hasLocalProgress) {
                await seed(page, localWords, localLists,
                    { listId: 'custom', wordId: 'shared-apple-id' }, 'local-article');
            }
            await mergeBackup(page, backup);
            const merged = await snapshot(page);
            assert.deepEqual(merged.words, hasLocalProgress ? localWords : incomingWords);
            assert.deepEqual(merged.lists.custom, hasLocalProgress ? localLists.custom : incomingLists.custom);
            assert.deepEqual(merged.lists['spelling-errors'], incomingLists['spelling-errors']);
            assert.equal(merged.reading.terms.length, 1);
            assert.equal(merged.reading.associations.length, hasLocalProgress ? 2 : 1);
            assert.equal(merged.reading.occurrences.length, hasLocalProgress ? 2 : 1);
            assert.deepEqual(merged.reading.terms[0].wordRef, hasLocalProgress
                ? { listId: 'custom', wordId: 'shared-apple-id' }
                : { listId: 'spelling-errors', wordId: 'spelling-apple' });

            await mergeBackup(page, backup);
            assert.deepEqual(await snapshot(page), merged, 'repeated merge preserves records and progress exactly');

            // Independently reviewing an imported non-default membership must
            // remain authoritative when the original backup is imported again.
            await page.evaluate(async () => {
                await AppData.vocab.patchWord({ listId: 'spelling-errors', wordId: 'spelling-apple', patch: {
                    repetitions: 20, interval: 60, reviewHistory: [{ at: '2026-09-08T02:00:00.000Z', grade: 5 }]
                } });
            });
            const reviewed = await snapshot(page);
            assert.equal(reviewed.lists['spelling-errors'].words[0].repetitions, 20);
            await mergeBackup(page, backup);
            assert.deepEqual(await snapshot(page), reviewed, 'backup cannot roll back a separately reviewed membership');

            await page.reload();
            await loadAppData(page);
            assert.deepEqual(await snapshot(page), reviewed, 'all memberships persist after reopening IndexedDB');
            const exported = await page.evaluate(() => AppData.backups.export());
            assert.deepEqual(exported.envelopes['vocab.words'].data, reviewed.words);
            assert.deepEqual(exported.envelopes['vocab.lists'].data, reviewed.lists);
        });
    }
});
