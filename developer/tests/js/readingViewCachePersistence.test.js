import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';
const paths = ['data/practiceRecordSource.js', 'data/v2/dataCatalog.js', 'data/v2/dataKernel.js',
    'data/v2/readingVocabularyModel.js', 'data/v2/readingViewCache.js', 'data/v2/appData.js'];
const sources = paths.map(path => fs.readFileSync(new URL(`../../../js/${path}`, import.meta.url), 'utf8'));
test('persistent reading previews survive reload, recover corruption, and reject obsolete pages after restore', async () => {
    const server = http.createServer((_req, res) => res.end('<!doctype html><title>Isolated cache test</title>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        async function open() {
            const page = await context.newPage();
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            for (const content of sources) await page.addScriptTag({ content });
            await page.evaluate(async () => { await AppData.ready; });
            return page;
        }
        const a = await open();
        const owner = await a.evaluate(async () => {
            const source = { kind: 'builtin', id: 'default' };
            for (let i = 0; i < 25; i++) await AppData.vocab.mutateReading('collect', {
                source, article: { examId: 'cache-test', title: 'Cache test' }, word: { word: `word${i}`, meaning: 'full meaning' }
            });
            const index = await AppData.vocab.getReadingBookshelf();
            return index.articles[0].articleId;
        });
        const b = await open();
        const warm = await b.evaluate(async owner => {
            let fullReads = 0;
            const get = IDBObjectStore.prototype.get;
            IDBObjectStore.prototype.get = function(key) {
                if (this.name === 'documents' && ['vocab.words', 'vocab.lists', 'vocab.readingState'].includes(key)) fullReads++;
                return get.apply(this, arguments);
            };
            const index = await AppData.vocab.getReadingBookshelf();
            const second = await AppData.vocab.getReadingArticleWords(owner, 1);
            const matches = await AppData.vocab.searchReadingArticles('word24');
            IDBObjectStore.prototype.get = get;
            return { fullReads, count: index.articles[0].wordCount, words: second.words, matches };
        }, owner);
        assert.equal(warm.fullReads, 0);
        assert.equal(warm.count, 25);
        assert.equal(warm.words.length, 10);
        assert.equal(warm.words[0], 'word10');
        assert.deepEqual(warm.matches, [owner]);
        // Removing a cache page must rebuild, not pretend the article has fewer words.
        await b.evaluate(owner => new Promise((resolve, reject) => {
            const request = indexedDB.open('IELTSAtlasReadingViewCache');
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('rows', 'readwrite');
                tx.objectStore('rows').delete(JSON.stringify(['words', owner, 1]));
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => reject(tx.error);
            };
        }), owner);
        assert.equal(await b.evaluate(async owner => (await AppData.vocab.getReadingArticleWords(owner, 1)).words.length, owner), 10);
        const backupId = await a.evaluate(async () => (await AppData.backups.create()).id);
        await a.evaluate(async owner => AppData.vocab.mutateReading('removeArticle', { articleId: owner, clearWords: true }), owner);
        assert.equal(await b.evaluate(async owner => (await AppData.vocab.getReadingArticleWords(owner, 0)).words.length, owner), 0);
        assert.equal(await b.evaluate(async () => (await AppData.vocab.getReadingBookshelf()).articles.length), 0);
        await a.evaluate(async backupId => { await AppData.backups.restore(backupId, { confirmed: true }); }, backupId);
        assert.equal(await b.evaluate(async owner => (await AppData.vocab.getReadingArticleWords(owner, 2)).words.length, owner), 5);
        assert.equal(await b.evaluate(async () => (await AppData.vocab.getReadingBookshelf()).articles[0].wordCount), 25);
        await context.close();
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
