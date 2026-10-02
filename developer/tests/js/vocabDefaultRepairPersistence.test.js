import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

const source = (name) => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8');
const scripts = [
    'data/v2/dataCatalog.js', 'data/v2/dataKernel.js',
    'data/practiceRecordSource.js', 'data/v2/readingVocabularyModel.js'
].map(source);
const appDataSource = source('data/v2/appData.js');
const vocabStoreSource = source('core/vocabStore.js');
const POLLUTED = [{ id: 'polluted-garden', word: 'garden', meaning: '你曾拼写为: gardon' }];
const BUNDLED = [{ id: 'default-apple', word: 'apple', meaning: 'Apple' }];

async function loadAppData(page, seedWords) {
    for (const content of scripts) await page.addScriptTag({ content });
    await page.evaluate(async (seedWords) => {
        const prototype = window.__AppDataV2Internals.DataKernel.prototype;
        window.vocabTest = { repairAttempts: 0, failedWrites: 0 };
        const mutate = prototype.mutate;
        prototype.mutate = async function (changes, options = {}) {
            if (options.operationId?.startsWith('vocab-default-repair')) {
                window.vocabTest.repairAttempts += 1;
                if (window.vocabTest.pauseRepair && !window.vocabTest.blocked) {
                    window.vocabTest.blocked = true;
                    await new Promise((resolve) => { window.vocabTest.release = resolve; });
                }
            }
            return mutate.call(this, changes, options);
        };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
            if (window.vocabTest.failRepair && value?.envelope?.operationId?.startsWith('vocab-default-repair')
                && (!window.vocabTest.failKey || value.logicalKey === window.vocabTest.failKey)) {
                window.vocabTest.failedWrites += 1;
                throw new DOMException('Injected default repair quota failure', 'QuotaExceededError');
            }
            return put.call(this, value, ...args);
        };
        if (seedWords !== undefined) {
            const kernel = new window.__AppDataV2Internals.DataKernel();
            await kernel.initialize();
            await kernel.mutate([{ logicalKey: 'vocab.words', data: seedWords }], { operationId: 'seed-persisted-default' });
            kernel.close();
        }
    }, seedWords);
    await page.addScriptTag({ content: appDataSource });
    await page.evaluate(() => AppData.ready);
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
}

async function loadVocabStore(page, bundledWords = BUNDLED) {
    await page.evaluate((words) => { window.__EMBEDDED_WORDLISTS__ = { ielts_core: words }; }, bundledWords);
    await page.addScriptTag({ content: vocabStoreSource });
}

test('default vocabulary pollution repair is acknowledged and preserves empty authority in IndexedDB', { timeout: 90000 }, async (t) => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><title>Default vocabulary repair integration</title>');
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
    const url = `http://127.0.0.1:${server.address().port}/`;
    const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

    async function pageWithWords(t, words) {
        const context = await browser.newContext();
        t.after(() => context.close());
        const page = await context.newPage();
        await page.goto(url);
        await loadAppData(page, words);
        await loadVocabStore(page);
        return page;
    }

    await t.test('a migrated polluted default envelope is durably repaired and remains repaired after reload', async (t) => {
        const page = await pageWithWords(t, POLLUTED);
        assert.equal(await page.evaluate(() => AppData.vocab.shouldInitializeDefaultWords()), false);
        await page.evaluate(() => VocabStore.init());
        const words = await page.evaluate(() => AppData.vocab.listWords());
        assert.deepEqual(words.map((word) => word.word), ['apple']);
        assert.deepEqual(await page.evaluate(() => VocabStore.getWords()), words);
        assert.equal(await page.evaluate(() => window.vocabTest.repairAttempts), 1);

        await page.reload();
        await loadAppData(page);
        await loadVocabStore(page);
        await page.evaluate(() => VocabStore.init());
        assert.deepEqual(await page.evaluate(() => AppData.vocab.listWords()), words);
        assert.deepEqual(await page.evaluate(() => VocabStore.getWords()), words);
        assert.equal(await page.evaluate(() => window.vocabTest.repairAttempts), 0);
    });

    await t.test('an acknowledged empty default list is never seeded or repaired', async (t) => {
        const page = await pageWithWords(t, []);
        assert.equal(await page.evaluate(() => AppData.vocab.shouldInitializeDefaultWords()), false);
        await page.evaluate(() => VocabStore.init());
        assert.deepEqual(await page.evaluate(() => AppData.vocab.listWords()), []);
        assert.deepEqual(await page.evaluate(() => VocabStore.getWords()), []);
        assert.equal(await page.evaluate(() => window.vocabTest.repairAttempts), 0);
    });

    await t.test('a failed IndexedDB repair keeps acknowledged words and retries after reload', async (t) => {
        const page = await pageWithWords(t, POLLUTED);
        const failed = await page.evaluate(async () => {
            window.vocabTest.failRepair = true;
            try { await VocabStore.init(); return { resolved: true }; }
            catch (error) { return { code: error.code, ready: VocabStore.state.ready }; }
        });
        assert.equal(failed.ready, false);
        assert.ok(failed.code, 'initialization must propagate the durable storage failure');
        assert.equal(await page.evaluate(() => window.vocabTest.failedWrites), 1);
        assert.deepEqual(await page.evaluate(() => AppData.vocab.listWords()), POLLUTED);
        assert.deepEqual(await page.evaluate(() => VocabStore.getWords().map((word) => word.word)), ['garden']);

        await page.reload();
        await loadAppData(page);
        assert.deepEqual(await page.evaluate(() => AppData.vocab.listWords()), POLLUTED);
        await loadVocabStore(page);
        await page.evaluate(() => VocabStore.init());
        assert.deepEqual(await page.evaluate(() => AppData.vocab.listWords().then((words) => words.map((word) => word.word))), ['apple']);
        assert.deepEqual(await page.evaluate(() => VocabStore.getWords().map((word) => word.word)), ['apple']);
    });

    for (const includesGarden of [true, false]) {
        await t.test(`repair retains reading owners when the bundle ${includesGarden ? 'changes their IDs' : 'omits their terms'}`, async (t) => {
            const owner = {
                ...POLLUTED[0], note: 'My garden note', phonetic: 'gɑːdən',
                correctCount: 9, interval: 21, repetitions: 7, easeFactor: 2.3,
                lastReviewed: '2026-09-01T01:00:00.000Z', nextReview: '2026-09-22T01:00:00.000Z',
                reviewHistory: [{ at: '2026-09-01T01:00:00.000Z', grade: 4 }]
            };
            const bundled = includesGarden ? [{ id: 'default-garden', word: 'garden', meaning: 'A cultivated plot' }] : BUNDLED;
            const page = await pageWithWords(t, [owner]);
            const baseId = JSON.stringify(['default-repair', owner.id]);
            const collisions = [
                { id: baseId, word: 'other', meaning: 'Existing row', correctCount: 3 },
                { id: `${baseId}-1`, word: 'another', meaning: 'Another row', correctCount: 5 }
            ];
            const existingCollection = includesGarden
                ? { id: 'reading-highlights', name: 'My reading words', words: collisions }
                : collisions;
            await page.evaluate(async ({ collection, bundled }) => {
                window.__EMBEDDED_WORDLISTS__.ielts_core = bundled;
                await AppData.vocab.saveCollection('reading-highlights', collection);
                await AppData.vocab.mutateReading('collect', {
                    source: { kind: 'imported', id: 'garden-library' },
                    article: { examId: 'garden-article', title: 'Garden article' },
                    word: { word: 'garden', meaning: 'Keep acknowledged owner' }, at: '2026-09-08T01:00:00.000Z',
                    occurrence: { scopeId: 'passage-1', contentVersion: 'garden-v1', startOffset: 0, endOffset: 6, quote: 'garden' }
                });
            }, { collection: existingCollection, bundled });
            const before = await page.evaluate(() => AppData.vocab.getReadingSnapshot().then((result) => result.snapshot));
            assert.deepEqual(before.reading.terms[0].wordRef, { listId: 'default', wordId: owner.id });

            const failed = await page.evaluate(async () => {
                window.vocabTest.failRepair = true;
                window.vocabTest.failKey = 'vocab.readingState';
                try { await VocabStore.init(); return { resolved: true }; }
                catch (error) { return { code: error.code, ready: VocabStore.state.ready }; }
            });
            assert.equal(failed.ready, false);
            assert.ok(failed.code);
            assert.equal(await page.evaluate(() => window.vocabTest.failedWrites), 1);
            assert.deepEqual(await page.evaluate(() => AppData.vocab.getReadingSnapshot().then((result) => result.snapshot)), before,
                'a failure after owner writes must roll back both owner relocation and the graph');

            await page.evaluate(async () => { window.vocabTest.failRepair = false; await VocabStore.init(); });
            const after = await page.evaluate(() => AppData.vocab.getReadingSnapshot().then((result) => result.snapshot));
            assert.deepEqual(after.words.map((word) => ({ id: word.id, word: word.word, meaning: word.meaning })), bundled);
            const collection = after.lists['reading-highlights'];
            const retainedWords = Array.isArray(collection) ? collection : collection.words;
            const retainedId = `${baseId}-2`;
            assert.equal(Array.isArray(collection), !includesGarden);
            if (includesGarden) assert.equal(collection.name, existingCollection.name);
            assert.deepEqual(retainedWords, [...collisions, { ...owner, id: retainedId }], 'preserve all acknowledged fields and avoid occupied IDs');
            const expectedReading = structuredClone(before.reading);
            expectedReading.terms[0].wordRef = { listId: 'reading-highlights', wordId: retainedId };
            assert.deepEqual(after.reading, expectedReading, 'only the canonical reference changes; every relationship remains intact');

            const replay = await page.evaluate((words) => AppData.vocab.repairDefaultWords({ words }), bundled);
            assert.equal(replay.committed, false);
            assert.deepEqual(await page.evaluate(() => AppData.vocab.getReadingSnapshot().then((result) => result.snapshot)), after,
                'retrying an acknowledged repair must not duplicate retained owners');
            await page.reload();
            await loadAppData(page);
            await loadVocabStore(page, bundled);
            await page.evaluate(() => VocabStore.init());
            assert.deepEqual(await page.evaluate(() => AppData.vocab.getReadingSnapshot().then((result) => result.snapshot)), after);
            assert.equal(await page.evaluate(() => window.vocabTest.repairAttempts), 0);
        });
    }

    await t.test('a concurrent empty replacement wins when the repair retries a stale transaction', async (t) => {
        const page = await pageWithWords(t, POLLUTED);
        const other = await page.context().newPage();
        await other.goto(url);
        await loadAppData(other);
        await page.evaluate(() => {
            window.vocabTest.pauseRepair = true;
            window.pendingInit = VocabStore.init().then(
                () => ({ ready: VocabStore.state.ready }),
                (error) => ({ error: error.message })
            );
        });
        await page.waitForFunction(() => window.vocabTest.blocked);
        await other.evaluate(() => AppData.vocab.saveWords([]));
        const result = await page.evaluate(async () => {
            window.vocabTest.release();
            return window.pendingInit;
        });
        assert.deepEqual(result, { ready: true });
        assert.deepEqual(await page.evaluate(() => AppData.vocab.listWords()), []);
        assert.deepEqual(await page.evaluate(() => VocabStore.getWords()), []);
        assert.deepEqual(await page.evaluate(() => VocabStore.loadList('default').then((list) => list.words)), []);
        assert.equal(await page.evaluate(() => window.vocabTest.repairAttempts), 1, 'the retry must stop before another write after rereading empty authority');

        await page.reload();
        await loadAppData(page);
        await loadVocabStore(page);
        await page.evaluate(() => VocabStore.init());
        assert.deepEqual(await page.evaluate(() => VocabStore.getWords()), []);
    });
});
