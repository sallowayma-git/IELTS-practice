import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

const source = (name) => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8');
const catalogSource = source('data/v2/dataCatalog.js');
const kernelSource = source('data/v2/dataKernel.js');
const recordSource = source('data/practiceRecordSource.js');
const appDataSource = source('data/v2/appData.js');
const bookshelfSource = source('components/bookshelfView.js');
const readerSource = source('components/readingVocabReader.js');
const wordsKey = 'ielts_reading_vocab_words_v1';
const bookshelfKey = 'ielts_reading_bookshelf_exams_v1';
const staleWords = [{ id: 'keep', word: 'keep', examId: 'keep' }, { id: 'removed', word: 'removed', examId: 'removed' }];
const staleBookshelf = [{ examId: 'keep', firstUsedAt: 10 }, { examId: 'removed', firstUsedAt: 20 }];

async function loadAppData(page, { interceptInstall = false, failReadingMigration = false } = {}) {
    await page.addScriptTag({ content: catalogSource });
    await page.addScriptTag({ content: kernelSource });
    await page.addScriptTag({ content: recordSource });
    if (failReadingMigration) {
        await page.evaluate(() => {
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (value, ...args) {
                if (['vocab.readingVocabWords', 'vocab.readingBookshelfExams'].includes(value?.logicalKey)) {
                    throw new DOMException('Reading migration quota regression', 'QuotaExceededError');
                }
                return put.call(this, value, ...args);
            };
        });
    }
    if (interceptInstall) {
        // Only the competing-writer test intercepts this boundary. The write and
        // snapshot installation still use the real kernel and IndexedDB.
        await page.evaluate(() => {
            const prototype = window.__AppDataV2Internals.DataKernel.prototype;
            const install = prototype.installSnapshot;
            prototype.installSnapshot = async function (snapshot, options) {
                if (window.beforeSnapshotInstall) {
                    const beforeInstall = window.beforeSnapshotInstall;
                    window.beforeSnapshotInstall = null;
                    await beforeInstall();
                }
                return install.call(this, snapshot, options);
            };
        });
    }
    await page.addScriptTag({ content: appDataSource });
    await page.evaluate(() => AppData.ready);
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2', 'exercise the actual IndexedDB backend');
}

async function setMirrors(page, words = staleWords, bookshelf = staleBookshelf) {
    await page.evaluate(({ wordsKey, bookshelfKey, words, bookshelf }) => {
        localStorage.setItem(wordsKey, JSON.stringify(words));
        localStorage.setItem(bookshelfKey, JSON.stringify(bookshelf));
    }, { wordsKey, bookshelfKey, words, bookshelf });
}

async function readingState(page) {
    return page.evaluate(async ({ wordsKey, bookshelfKey }) => ({
        words: await AppData.vocab.listReadingWords(),
        bookshelf: await AppData.vocab.listReadingBookshelfExams(),
        localWords: JSON.parse(localStorage.getItem(wordsKey) || '[]'),
        localBookshelf: JSON.parse(localStorage.getItem(bookshelfKey) || '[]')
    }), { wordsKey, bookshelfKey });
}

test('reading collections retain canonical authority through backup workflows in IndexedDB', { timeout: 120000 }, async (t) => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><title>Reading backup regression</title>');
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

    for (const workflow of ['restore', 'replace']) {
        for (const collection of ['cleared', 'empty', 'smaller']) {
            await t.test(`${workflow} preserves ${collection} collections without a loaded reader`, async () => {
                const context = await browser.newContext();
                try {
                    const page = await context.newPage();
                    await page.goto(url);
                    await loadAppData(page);
                    const words = collection === 'smaller' ? staleWords.slice(0, 1) : [];
                    const bookshelf = collection === 'smaller' ? staleBookshelf.slice(0, 1) : [];
                    await page.evaluate(async ({ words, bookshelf, collection }) => {
                        if (collection !== 'cleared') {
                            await AppData.vocab.saveReadingWords(words);
                            await AppData.vocab.saveReadingBookshelfExams(bookshelf);
                        }
                        window.targetSnapshot = await AppData.backups.export();
                        await AppData.backups.create({ id: 'target' });
                    }, { words, bookshelf, collection });
                    await page.evaluate(async ({ staleWords, staleBookshelf }) => {
                        await AppData.vocab.saveReadingWords(staleWords);
                        await AppData.vocab.saveReadingBookshelfExams(staleBookshelf);
                    }, { staleWords, staleBookshelf });
                    await setMirrors(page);
                    assert.equal(await page.evaluate(() => typeof ReadingVocabStore), 'undefined');
                    await page.evaluate(async (workflow) => {
                        if (workflow === 'restore') await AppData.backups.restore('target');
                        else {
                            const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                            await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
                        }
                    }, workflow);
                    const expected = { words, bookshelf, localWords: words, localBookshelf: bookshelf };
                    assert.deepEqual(await readingState(page), expected, 'snapshot installation refreshes both mirrors with no reader listener');

                    // An old tab can leave a stale mirror again. It must not win on
                    // a cold startup, subsequent export, or bookshelf lazy load.
                    await setMirrors(page);
                    await page.reload();
                    await loadAppData(page);
                    assert.deepEqual(await readingState(page), expected);
                    const exported = await page.evaluate(() => AppData.backups.export());
                    assert.deepEqual(exported.envelopes['vocab.readingVocabWords'].data || [], words);
                    assert.deepEqual(exported.envelopes['vocab.readingBookshelfExams'].data || [], bookshelf);
                    await setMirrors(page, words, staleBookshelf);
                    await page.addScriptTag({ content: bookshelfSource });
                    await page.evaluate(() => ReadingBookshelfStore.init());
                    assert.deepEqual(await readingState(page), expected, 'bookshelf initialization adopts the canonical array without merging stale records');
                } finally {
                    await context.close();
                }
            });
        }
    }

    await t.test('genuine legacy words and bookshelf migrate on the first startup and survive a reload', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto(url);
            await setMirrors(page);
            await loadAppData(page);
            const expected = {
                words: staleWords, bookshelf: staleBookshelf,
                localWords: staleWords, localBookshelf: staleBookshelf
            };
            assert.deepEqual(await readingState(page), expected, 'legacy data seeds previously absent canonical documents');
            await page.reload();
            await loadAppData(page);
            assert.deepEqual(await readingState(page), expected);
        } finally {
            await context.close();
        }
    });

    await t.test('failed initial migration preserves the only legacy copy through lazy stores and retries on reload', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto(url);
            await setMirrors(page);
            await loadAppData(page, { failReadingMigration: true });
            await page.addScriptTag({ content: bookshelfSource });
            await page.addScriptTag({ content: readerSource });
            await page.evaluate(async () => {
                await ReadingBookshelfStore.init();
                await ReadingVocabStore.init();
            });
            assert.deepEqual(await readingState(page), {
                words: [], bookshelf: [], localWords: staleWords, localBookshelf: staleBookshelf
            }, 'absent documents after a failed migration must not overwrite legacy data with defaults');
            assert.deepEqual(await page.evaluate(() => ReadingVocabStore.getAll()), staleWords);

            await page.reload();
            await loadAppData(page);
            assert.deepEqual(await readingState(page), {
                words: staleWords, bookshelf: staleBookshelf, localWords: staleWords, localBookshelf: staleBookshelf
            }, 'the preserved legacy copy remains available for the next successful migration');
        } finally {
            await context.close();
        }
    });

    await t.test('restore migrates late legacy mirrors before its revision token and retains its safety backup', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto(url);
            await loadAppData(page);
            await page.evaluate(async () => {
                await AppData.settings.patch({ theme: 'original' });
                await AppData.backups.create({ id: 'target' });
                await AppData.settings.patch({ theme: 'changed' });
            });
            await setMirrors(page);
            const result = await page.evaluate(async () => {
                const receipt = await AppData.backups.restore('target');
                const safety = (await AppData.backups.list()).find((entry) => entry.id === receipt.preRestoreBackupId);
                return { receipt, settings: await AppData.settings.getAll(), safety };
            });
            assert.equal(result.receipt.committed, true, 'restore succeeds on its first attempt without a competing writer');
            assert.equal(result.settings.theme, 'original');
            assert.equal(result.safety.type, 'pre-restore');
            assert.equal(result.safety.data.envelopes['settings.values'].data.theme, 'changed');
            assert.deepEqual(result.safety.data.envelopes['vocab.readingVocabWords'].data, staleWords);
            assert.deepEqual(result.safety.data.envelopes['vocab.readingBookshelfExams'].data, staleBookshelf);
            assert.deepEqual(await readingState(page), { words: [], bookshelf: [], localWords: [], localBookshelf: [] });
            await page.reload();
            await loadAppData(page);
            assert.equal(await page.evaluate(async () => (await AppData.settings.getAll()).theme), 'original');
            assert.deepEqual(await readingState(page), { words: [], bookshelf: [], localWords: [], localBookshelf: [] });
        } finally {
            await context.close();
        }
    });

    await t.test('replace import migrates late mirrors before preview so its safety backup does not invalidate the plan', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto(url);
            await loadAppData(page);
            await page.evaluate(async () => {
                await AppData.settings.patch({ theme: 'original' });
                window.targetSnapshot = await AppData.backups.export();
                await AppData.settings.patch({ theme: 'changed' });
            });
            await setMirrors(page);
            const result = await page.evaluate(async () => {
                const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                const safety = await AppData.backups.create({ id: 'pre-import', type: 'pre-import' });
                const receipt = await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
                return { receipt, safety, settings: await AppData.settings.getAll() };
            });
            assert.equal(result.receipt.committed, true, 'preview, safety backup, and commit succeed on the first attempt');
            assert.equal(result.settings.theme, 'original');
            assert.equal(result.safety.data.envelopes['settings.values'].data.theme, 'changed');
            assert.deepEqual(result.safety.data.envelopes['vocab.readingVocabWords'].data, staleWords);
            assert.deepEqual(result.safety.data.envelopes['vocab.readingBookshelfExams'].data, staleBookshelf);
            await page.reload();
            await loadAppData(page);
            assert.deepEqual(await readingState(page), { words: [], bookshelf: [], localWords: [], localBookshelf: [] });
            assert.equal(await page.evaluate(async () => (await AppData.settings.getAll()).theme), 'original');
        } finally {
            await context.close();
        }
    });

    await t.test('a competing reading writer still aborts restore after the safety backup', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            const writer = await context.newPage();
            await page.goto(url);
            await loadAppData(page, { interceptInstall: true });
            await page.evaluate(async () => {
                await AppData.settings.patch({ theme: 'original' });
                await AppData.backups.create({ id: 'target' });
                await AppData.settings.patch({ theme: 'changed' });
            });
            await writer.goto(url);
            await loadAppData(writer);
            await page.exposeFunction('commitConcurrentReading', () => writer.evaluate(async () => {
                await AppData.vocab.saveReadingWords([{ id: 'concurrent', word: 'concurrent' }]);
            }));
            const result = await page.evaluate(async () => {
                window.beforeSnapshotInstall = () => window.commitConcurrentReading();
                try { await AppData.backups.restore('target'); } catch (error) {
                    return { code: error.code, settings: await AppData.settings.getAll(), backups: await AppData.backups.list() };
                }
                return null;
            });
            assert.equal(result.code, 'CONFLICT');
            assert.equal(result.settings.theme, 'changed', 'failed restore must not partially install the target snapshot');
            assert.ok(result.backups.some((entry) => entry.type === 'pre-restore'));
            assert.deepEqual((await readingState(writer)).words, [{ id: 'concurrent', word: 'concurrent' }]);
        } finally {
            await context.close();
        }
    });
});
