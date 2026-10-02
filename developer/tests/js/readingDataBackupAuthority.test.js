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
const AT = '2026-09-08T01:00:00.000Z';
const SOURCE = { kind: 'imported', id: 'backup-library' };
const wordsKey = 'ielts_reading_vocab_words_v1';
const bookshelfKey = 'ielts_reading_bookshelf_exams_v1';

async function loadAppData(page) {
    for (const content of scripts) await page.addScriptTag({ content });
    await page.evaluate(() => {
        const prototype = window.__AppDataV2Internals.DataKernel.prototype;
        const install = prototype.installSnapshot;
        prototype.installSnapshot = async function (...args) {
            if (window.beforeSnapshotInstall) {
                const intercept = window.beforeSnapshotInstall;
                window.beforeSnapshotInstall = null;
                await intercept();
            }
            return install.apply(this, args);
        };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
            if (window.failSnapshotInstall && value?.logicalKey === 'vocab.readingState') {
                window.failedSnapshotPuts = (window.failedSnapshotPuts || 0) + 1;
                throw new DOMException('Injected snapshot quota failure', 'QuotaExceededError');
            }
            return put.call(this, value, ...args);
        };
    });
    await page.addScriptTag({ content: appDataSource });
    await page.evaluate(() => AppData.ready);
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
}

async function collect(page, word, article = 'article-a') {
    return page.evaluate(({ word, article, source, at }) => AppData.vocab.mutateReading('collect', {
        source, article: { examId: article, title: article }, word: { word, meaning: `Definition of ${word}` }, at,
        occurrence: { scopeId: 'passage-1', contentVersion: 'backup-fixture-v1',
            startOffset: 0, endOffset: word.length, quote: word }
    }), { word, article, source: SOURCE, at: AT });
}

async function readingState(page) {
    return page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
}

async function staleMirrors(page) {
    await page.evaluate(({ wordsKey, bookshelfKey }) => {
        localStorage.setItem(wordsKey, JSON.stringify([{ id: 'stale', word: 'stale', examId: 'stale' }]));
        localStorage.setItem(bookshelfKey, JSON.stringify([{ examId: 'stale', firstUsedAt: 1 }]));
    }, { wordsKey, bookshelfKey });
}

test('reading backup restoration preserves canonical authority, safety backups and revision checks in IndexedDB', { timeout: 120000 }, async (t) => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><title>Reading backup authority integration</title>');
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

    async function pages(t, count = 1) {
        const context = await browser.newContext();
        t.after(() => context.close());
        const result = [];
        for (let index = 0; index < count; index += 1) {
            const page = await context.newPage();
            await page.goto(url);
            await loadAppData(page);
            result.push(page);
        }
        return result;
    }

    // Replaces the former late-localStorage-migration fixtures: after one-time
    // migration, mirrors are no longer new user writes and must never be imported.
    for (const workflow of ['restore', 'replace']) {
        for (const collection of ['cleared', 'empty', 'smaller']) {
            await t.test(`${workflow} preserves ${collection} canonical collections without a loaded reader`, async (t) => {
                const [page] = await pages(t);
                if (collection !== 'empty') await collect(page, 'apple');
                if (collection === 'cleared') await page.evaluate(() => AppData.vocab.mutateReading('clearReading', {}));
                const expected = await readingState(page);
                await page.evaluate(async () => {
                    window.targetSnapshot = await AppData.backups.export();
                    await AppData.backups.create({ id: 'target' });
                });
                await collect(page, 'apple');
                await collect(page, 'banana', 'article-b');
                const before = await readingState(page);
                await staleMirrors(page);
                assert.equal(await page.evaluate(() => typeof ReadingVocabStore), 'undefined');
                const receipt = await page.evaluate(async (workflow) => {
                    if (workflow === 'restore') return AppData.backups.restore('target');
                    const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                    return AppData.backups.commitImport(plan.id, { confirmDestructive: true });
                }, workflow);
                assert.equal(receipt.committed, true);
                assert.deepEqual(await readingState(page), expected);
                if (workflow === 'restore') {
                    const safety = await page.evaluate(async (id) => (await AppData.backups.list()).find((entry) => entry.id === id), receipt.preRestoreBackupId);
                    assert.equal(safety.type, 'pre-restore');
                    assert.deepEqual(safety.data.envelopes['vocab.readingState'].data.reading, before.reading, 'pre-restore backup retains all preexisting relationships');
                    assert.deepEqual(safety.data.envelopes['vocab.lists'].data, before.lists);
                }
                await staleMirrors(page);
                await page.reload();
                await loadAppData(page);
                assert.deepEqual(await readingState(page), expected);
                const exported = await page.evaluate(() => AppData.backups.export());
                assert.deepEqual(exported.envelopes['vocab.readingState'].data.reading, expected.reading);
                assert.deepEqual(exported.envelopes['vocab.lists'].data, expected.lists);
            });
        }
    }

    await t.test('a safety backup between replace preview and commit does not invalidate the reviewed reading revisions', async (t) => {
        const [page] = await pages(t);
        await collect(page, 'apple');
        const expected = await readingState(page);
        await page.evaluate(async () => { window.targetSnapshot = await AppData.backups.export(); });
        await collect(page, 'banana', 'article-b');
        const before = await readingState(page);
        const result = await page.evaluate(async () => {
            const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
            const safety = await AppData.backups.create({ id: 'pre-import', type: 'pre-import' });
            const receipt = await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
            return { safety, receipt };
        });
        assert.equal(result.receipt.committed, true);
        assert.deepEqual(result.safety.data.envelopes['vocab.readingState'].data.reading, before.reading);
        assert.deepEqual(await readingState(page), expected);
    });

    for (const workflow of ['restore', 'replace']) {
        await t.test(`${workflow} detects a competing reader after its revision token and preserves its safety backup`, async (t) => {
            const [page, writer] = await pages(t, 2);
            await page.evaluate(async () => {
                await AppData.settings.patch({ theme: 'original' });
                window.targetSnapshot = await AppData.backups.export();
                await AppData.backups.create({ id: 'target' });
                await AppData.settings.patch({ theme: 'changed' });
            });
            await collect(page, 'apple');
            await page.exposeFunction('commitConcurrentReading', () => collect(writer, 'banana', 'article-b'));
            const result = await page.evaluate(async (workflow) => {
                window.beforeSnapshotInstall = () => window.commitConcurrentReading();
                try {
                    if (workflow === 'restore') await AppData.backups.restore('target');
                    else {
                        const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                        await AppData.backups.create({ id: 'pre-import', type: 'pre-import' });
                        await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
                    }
                    return null;
                } catch (error) {
                    return { code: error.code, committed: error.committed,
                        settings: await AppData.settings.getAll(), backups: await AppData.backups.list() };
                }
            }, workflow);
            assert.equal(result?.code, 'CONFLICT');
            assert.equal(result.committed, false);
            assert.equal(result.settings.theme, 'changed', 'failed install cannot partially change settings');
            assert.ok(result.backups.some((entry) => entry.type === (workflow === 'restore' ? 'pre-restore' : 'pre-import')));
            const current = await readingState(writer);
            assert.deepEqual(current.reading.terms.map((row) => row.normalizedTerm).sort(), ['apple', 'banana']);
            assert.equal(current.reading.associations.length, 2);
            assert.equal(current.reading.occurrences.length, 2);
        });
    }

    for (const workflow of ['restore', 'replace']) {
        await t.test(`${workflow} transaction quota failure leaves the current snapshot intact and supports retry`, async (t) => {
            const [page] = await pages(t);
            await page.evaluate(async () => {
                await AppData.settings.patch({ theme: 'original' });
                window.targetSnapshot = await AppData.backups.export();
                await AppData.backups.create({ id: 'target' });
                await AppData.settings.patch({ theme: 'changed' });
            });
            await collect(page, 'apple');
            const before = await readingState(page);
            const failed = await page.evaluate(async (workflow) => {
                window.failSnapshotInstall = true;
                try {
                    if (workflow === 'restore') await AppData.backups.restore('target');
                    else {
                        const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                        await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
                    }
                    return null;
                } catch (error) { return { code: error.code, committed: error.committed, puts: window.failedSnapshotPuts }; }
            }, workflow);
            assert.equal(failed?.code, 'QUOTA_EXCEEDED');
            assert.equal(failed.committed, false);
            assert.equal(failed.puts, 1, 'the actual IndexedDB snapshot transaction failed');
            assert.equal(await page.evaluate(async () => (await AppData.settings.getAll()).theme), 'changed');
            assert.deepEqual(await readingState(page), before, 'graph, canonical owners and visits roll back together');
            const receipt = await page.evaluate(async (workflow) => {
                window.failSnapshotInstall = false;
                if (workflow === 'restore') return AppData.backups.restore('target');
                const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                return AppData.backups.commitImport(plan.id, { confirmDestructive: true });
            }, workflow);
            assert.equal(receipt.committed, true);
            assert.equal((await readingState(page)).reading.associations.length, 0);
            assert.equal(await page.evaluate(async () => (await AppData.settings.getAll()).theme), 'original');
        });
    }
});
