import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

// Run production migration and storage code against Chromium IndexedDB. The
// first-start fault aborts only the legacy database's actual read transaction.
const source = (name) => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8');
const scripts = [
    'data/v2/dataCatalog.js', 'data/v2/dataKernel.js',
    'data/practiceRecordSource.js', 'data/v2/readingVocabularyModel.js'
].map(source);
const appDataSource = source('data/v2/appData.js');
const LEGACY_WORD = {
    id: 'legacy-reviewed-apple', word: 'apple', meaning: 'Personal apple definition', note: 'Keep my note',
    easeFactor: 2.3, repetitions: 7, interval: 21, correctCount: 9,
    lastReviewed: '2026-09-01T01:00:00.000Z', nextReview: '2026-09-22T01:00:00.000Z',
    reviewHistory: [{ at: '2026-09-01T01:00:00.000Z', grade: 4 }]
};
const LEGACY_LISTS = {
    'personal-list': {
        id: 'personal-list', name: 'My reviewed vocabulary', words: [{
            ...LEGACY_WORD, id: 'legacy-reviewed-banana', word: 'banana', meaning: 'Personal banana definition',
            repetitions: 11, interval: 35, correctCount: 15
        }]
    }
};

async function seedLegacyVocabulary(page) {
    return page.evaluate(({ words, lists }) => new Promise((resolve, reject) => {
        const open = indexedDB.open('ExamSystemDB', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('keyValueStore', { keyPath: 'key' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const database = open.result;
            const transaction = database.transaction('keyValueStore', 'readwrite');
            for (const [key, data] of [['exam_system_vocab_words', words], ['exam_system_vocab_lists', lists]]) {
                transaction.objectStore('keyValueStore').put({ key,
                    value: JSON.stringify({ data, version: '1.0.0', timestamp: 1000, compressed: false }),
                    timestamp: 1000 });
            }
            transaction.oncomplete = () => { database.close(); resolve(); };
            transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
        };
    }), { words: [LEGACY_WORD], lists: LEGACY_LISTS });
}

async function loadAppData(page, { failLegacyRead = false } = {}) {
    for (const content of scripts) await page.addScriptTag({ content });
    await page.evaluate((fail) => {
        window.legacyRecoveryTest = { fail, abortedReads: 0, internals: window.__AppDataV2Internals };
        const getAll = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (...args) {
            const request = getAll.apply(this, args);
            if (window.legacyRecoveryTest.fail && this.transaction.db.name === 'ExamSystemDB') {
                window.legacyRecoveryTest.abortedReads += 1;
                this.transaction.abort();
            }
            return request;
        };
    }, failLegacyRead);
    await page.addScriptTag({ content: appDataSource });
    await page.evaluate(() => AppData.ready);
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
}

async function durableRow(page, store, key) {
    return page.evaluate(({ store, key }) => new Promise((resolve, reject) => {
        const open = indexedDB.open('IELTSAtlasDataV2');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const database = open.result;
            const request = database.transaction(store, 'readonly').objectStore(store).get(key);
            request.onsuccess = () => { database.close(); resolve(request.result || null); };
            request.onerror = () => { database.close(); reject(request.error); };
        };
    }), { store, key });
}

test('reading migration waits for recoverable V1 vocabulary without weakening replacement authority', { timeout: 90000 }, async (t) => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><title>Reading legacy recovery integration</title>');
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

    async function newPage(t) {
        const context = await browser.newContext();
        t.after(() => context.close());
        const page = await context.newPage();
        await page.goto(url);
        return page;
    }

    await t.test('an aborted first V1 read recovers reviewed default and list words on a healthy reload', async (t) => {
        const page = await newPage(t);
        await seedLegacyVocabulary(page);
        await loadAppData(page, { failLegacyRead: true });
        assert.ok(await page.evaluate(() => window.legacyRecoveryTest.abortedReads) > 0,
            'the fixture must abort the production legacy read transaction');
        const firstMarker = (await durableRow(page, 'system', 'system.migrations'))?.envelope?.data || {};
        assert.notEqual(firstMarker.v1ToV2?.status, 'complete', 'an unread source is still pending recovery');
        assert.notEqual(firstMarker.readingVocabularyV1?.completed, true,
            'reading migration must not claim completion before canonical V1 vocabulary is available');
        for (const key of ['vocab.words', 'vocab.lists', 'vocab.readingState']) {
            assert.equal(await durableRow(page, 'documents', key), null,
                `${key} must not become an authoritative empty placeholder during a failed first startup`);
        }
        // Lazy readers, backups and canonical writes must obey the same barrier
        // as startup; a words-only write cannot discard unrecovered list words.
        for (const workflow of ['read', 'backup', 'saveWords', 'saveCollections']) {
            const failure = await page.evaluate(async (workflow) => {
                try {
                    if (workflow === 'read') await AppData.vocab.getReadingSnapshot();
                    if (workflow === 'backup') await AppData.backups.create({ id: 'incomplete-v1-backup' });
                    if (workflow === 'saveWords') await AppData.vocab.saveWords([{ id: 'new-word', word: 'new', meaning: 'new' }]);
                    if (workflow === 'saveCollections') await AppData.vocab.saveCollections({ newList: [] });
                    return null;
                } catch (error) { return { code: error.code, committed: error.committed }; }
            }, workflow);
            assert.deepEqual(failure, { code: 'BACKEND_UNAVAILABLE', committed: false },
                `${workflow} must keep incomplete legacy vocabulary recoverable`);
            assert.equal(await durableRow(page, 'documents', 'vocab.readingState'), null);
        }

        await page.reload();
        await loadAppData(page);
        const recovered = await page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
        assert.deepEqual(recovered.words, [LEGACY_WORD], 'retain default-word definitions, notes and review progress');
        assert.deepEqual(recovered.lists, LEGACY_LISTS, 'retain list membership and every reviewed-word field');
        const recoveredMarker = (await durableRow(page, 'system', 'system.migrations')).envelope.data;
        assert.equal(recoveredMarker.v1ToV2.status, 'complete');
        assert.equal(recoveredMarker.readingVocabularyV1.completed, true);
        const backup = await page.evaluate(() => AppData.backups.export({ domains: ['vocab'] }));
        assert.deepEqual(backup.envelopes['vocab.words'].data, [LEGACY_WORD]);
        assert.deepEqual(backup.envelopes['vocab.lists'].data, LEGACY_LISTS);
        await page.reload();
        await loadAppData(page);
        assert.deepEqual(await page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot), recovered,
            'subsequent startup is idempotent after the deferred recovery succeeds');
    });

    await t.test('a real empty backup replacement remains authoritative when a prior V1 migration is retried', async (t) => {
        const page = await newPage(t);
        await loadAppData(page);
        const empty = await page.evaluate(() => AppData.backups.export({ domains: ['vocab'] }));
        await page.evaluate(({ words, lists }) => AppData.vocab.saveWords(words).then(() => AppData.vocab.saveCollections(lists)),
            { words: [LEGACY_WORD], lists: LEGACY_LISTS });
        const replaced = await page.evaluate(async (snapshot) => {
            const plan = await AppData.backups.previewImport(snapshot, { replace: true });
            return AppData.backups.commitImport(plan.id, { confirmDestructive: true });
        }, empty);
        assert.equal(replaced.committed, true);
        const expected = await page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
        assert.deepEqual(expected.words, []);
        assert.deepEqual(expected.lists, {});
        await seedLegacyVocabulary(page);
        // Represent a persisted state from an earlier interrupted broad
        // migration. Preserve the actual replacement's documents and provenance.
        await page.evaluate(async () => {
            const kernel = new window.legacyRecoveryTest.internals.DataKernel();
            await kernel.initialize();
            try {
                const migration = await kernel.read('system.migrations', { withMeta: true });
                delete migration.data.v1ToV2;
                await kernel.mutate([{ logicalKey: 'system.migrations', data: migration.data,
                    expectedRevision: migration.envelope.revision }], { operationId: 'fixture-pending-v1-after-replace' });
            } finally { kernel.close(); }
        });
        await page.reload();
        await loadAppData(page);
        assert.deepEqual(await page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot), expected,
            'legacy recovery cannot resurrect vocabulary removed by an acknowledged replacement');
        assert.equal((await durableRow(page, 'system', 'system.migrations')).envelope.data.v1ToV2.status, 'complete');
    });
});
