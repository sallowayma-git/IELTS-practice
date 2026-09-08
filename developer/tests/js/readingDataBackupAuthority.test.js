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

async function loadAppData(page, { interceptInstall = false, failReadingMigration = false, trackReadingMigration = false } = {}) {
    await page.addScriptTag({ content: catalogSource });
    await page.addScriptTag({ content: kernelSource });
    await page.addScriptTag({ content: recordSource });
    if (trackReadingMigration) await trackReadingMigrationFault(page);
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

async function trackReadingMigrationFault(page) {
    await page.evaluate(() => {
        const fault = { enabled: false, logicalKey: null, migrationWrites: 0, installCalls: 0 };
        window.readingMigrationFault = fault;
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
            // Fail only the migration: a snapshot install could still succeed
            // and erase the local-only collection if the error is swallowed.
            if (fault.enabled && value?.logicalKey === fault.logicalKey
                && value.envelope?.operationId.startsWith('migrate-reading_')) {
                fault.migrationWrites += 1;
                throw new DOMException('Reading migration quota regression', 'QuotaExceededError');
            }
            return put.call(this, value, ...args);
        };
        const internals = window.__AppDataV2Internals;
        const prototype = internals.DataKernel.prototype;
        const install = prototype.installSnapshot;
        prototype.installSnapshot = function (...args) {
            fault.installCalls += 1;
            return install.apply(this, args);
        };
        window.makeReadingSnapshotForTest = (logicalKey, data) => {
            const catalog = internals.catalog;
            const snapshot = {
                format: 'ielts-atlas-data-v2', schemaVersion: catalog.version, scope: 'partial',
                envelopes: { [logicalKey]: internals.makeEnvelope(catalog.get(logicalKey), data) }, entities: {}
            };
            snapshot.checksum = internals.checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities });
            return snapshot;
        };
    });
}

async function failReadingMigration(page, logicalKey) {
    await page.evaluate((logicalKey) => {
        Object.assign(window.readingMigrationFault, { enabled: true, logicalKey, migrationWrites: 0, installCalls: 0 });
    }, logicalKey);
}

async function backupFailureState(page) {
    return page.evaluate(async ({ wordsKey, bookshelfKey }) => ({
        settings: await AppData.settings.getAll(),
        backupIds: (await AppData.backups.list()).map((entry) => entry.id),
        words: await AppData.vocab.listReadingWords({ withMeta: true }),
        bookshelf: await AppData.vocab.listReadingBookshelfExams({ withMeta: true }),
        rawWords: localStorage.getItem(wordsKey),
        rawBookshelf: localStorage.getItem(bookshelfKey),
        fault: { ...window.readingMigrationFault }
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

    for (const workflow of ['restore', 'replace-preview', 'replace-commit', 'replace-smaller']) {
        for (const logicalKey of ['vocab.readingVocabWords', 'vocab.readingBookshelfExams']) {
            await t.test(`${workflow} aborts when the only legacy copy of ${logicalKey} cannot migrate`, async () => {
                const context = await browser.newContext();
                try {
                    const page = await context.newPage();
                    await page.goto(url);
                    await loadAppData(page, { trackReadingMigration: true });
                    await page.evaluate(async ({ workflow, logicalKey, staleWords, staleBookshelf }) => {
                        await AppData.settings.patch({ theme: 'original' });
                        window.targetSnapshot = await AppData.backups.export();
                        await AppData.backups.create({ id: 'target' });
                        await AppData.settings.patch({ theme: 'changed' });
                        if (workflow === 'replace-commit') {
                            // A legacy tab can introduce local-only records after
                            // preview, so commit must recheck migration safety.
                            window.pendingPlan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                        }
                        if (workflow === 'replace-smaller') {
                            const data = logicalKey === 'vocab.readingVocabWords' ? staleWords : staleBookshelf;
                            window.targetSnapshot = window.makeReadingSnapshotForTest(logicalKey, data.slice(0, 1));
                            const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                            window.smallerPlanDestructive = plan.destructive;
                        }
                    }, { workflow, logicalKey, staleWords, staleBookshelf });
                    if (workflow === 'replace-smaller') {
                        assert.equal(await page.evaluate(() => window.smallerPlanDestructive), false,
                            'present smaller reading arrays must be protected even when the preview is not marked destructive');
                    }
                    await setMirrors(page);
                    await failReadingMigration(page, logicalKey);
                    const before = await backupFailureState(page);
                    const failure = await page.evaluate(async (workflow) => {
                        try {
                            if (workflow === 'restore') await AppData.backups.restore('target');
                            else {
                                const plan = workflow === 'replace-commit'
                                    ? window.pendingPlan
                                    : await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                                if (workflow === 'replace-preview') {
                                    await AppData.backups.create({ id: 'pre-import', type: 'pre-import' });
                                }
                                await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
                            }
                            return null;
                        } catch (error) {
                            return { code: error.code, message: error.message };
                        }
                    }, workflow);
                    assert.equal(failure?.code, 'QUOTA_EXCEEDED', 'destructive workflow must surface the required migration failure');
                    const after = await backupFailureState(page);
                    assert.ok(after.fault.migrationWrites > 0, 'exercise an actual failed IndexedDB migration write');
                    assert.equal(after.fault.installCalls, 0, 'abort before attempting snapshot installation');
                    assert.deepEqual(after.settings, before.settings, 'failed migration must not install target settings');
                    assert.deepEqual(after.backupIds, before.backupIds, 'do not create a misleading safety backup without the only legacy copy');
                    assert.equal(after.rawWords, before.rawWords, 'preserve the original words mirror byte for byte');
                    assert.equal(after.rawBookshelf, before.rawBookshelf, 'preserve the original bookshelf mirror byte for byte');
                    assert.equal(after[logicalKey === 'vocab.readingVocabWords' ? 'words' : 'bookshelf'].envelope, null,
                        'failed migration leaves this collection recoverable only from its preserved mirror');

                    await page.evaluate(() => { window.readingMigrationFault.enabled = false; });
                    if (workflow === 'replace-commit') {
                        const conflict = await page.evaluate(async () => {
                            try {
                                await AppData.backups.commitImport(window.pendingPlan.id, { confirmDestructive: true });
                                return null;
                            } catch (error) {
                                return error.code;
                            }
                        });
                        assert.equal(conflict, 'CONFLICT', 'late migration must preserve the original preview token and require a fresh preview');
                        assert.equal((await backupFailureState(page)).settings.theme, 'changed');
                        assert.deepEqual(await readingState(page), {
                            words: staleWords, bookshelf: staleBookshelf, localWords: staleWords, localBookshelf: staleBookshelf
                        }, 'successful migration after quota recovery must preserve records when the old plan conflicts');
                    }
                    const result = await page.evaluate(async (workflow) => {
                        let receipt;
                        let safety;
                        if (workflow === 'restore') {
                            receipt = await AppData.backups.restore('target');
                            safety = (await AppData.backups.list()).find((entry) => entry.id === receipt.preRestoreBackupId);
                        } else {
                            // Re-preview after a failed commit so newly migrated
                            // records are covered by its revision token.
                            const plan = await AppData.backups.previewImport(window.targetSnapshot, { replace: true });
                            safety = await AppData.backups.create({ id: 'pre-import-retry', type: 'pre-import' });
                            receipt = await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
                        }
                        return { receipt, safety, settings: await AppData.settings.getAll() };
                    }, workflow);
                    assert.equal(result.receipt.committed, true, 'retry succeeds after the migration write becomes available');
                    assert.equal(result.settings.theme, workflow === 'replace-smaller' ? 'changed' : 'original');
                    assert.equal(result.safety.data.envelopes['settings.values'].data.theme, 'changed');
                    assert.deepEqual(result.safety.data.envelopes['vocab.readingVocabWords'].data, staleWords);
                    assert.deepEqual(result.safety.data.envelopes['vocab.readingBookshelfExams'].data, staleBookshelf);
                    const words = workflow === 'replace-smaller'
                        ? (logicalKey === 'vocab.readingVocabWords' ? staleWords.slice(0, 1) : staleWords) : [];
                    const bookshelf = workflow === 'replace-smaller'
                        ? (logicalKey === 'vocab.readingBookshelfExams' ? staleBookshelf.slice(0, 1) : staleBookshelf) : [];
                    assert.deepEqual(await readingState(page), { words, bookshelf, localWords: words, localBookshelf: bookshelf });
                } finally {
                    await context.close();
                }
            });
        }
    }

    await t.test('settings-only import leaves broken reading migration alone, while a safety backup requires it', async () => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto(url);
            await loadAppData(page, { trackReadingMigration: true });
            await page.evaluate(async () => {
                await AppData.settings.patch({ theme: 'original' });
                window.settingsSnapshot = await AppData.backups.export({ domains: ['settings'] });
                await AppData.settings.patch({ theme: 'changed' });
            });
            await setMirrors(page);
            await failReadingMigration(page, 'vocab.readingBookshelfExams');
            const before = await backupFailureState(page);
            const receipt = await page.evaluate(async () => {
                const plan = await AppData.backups.previewImport(window.settingsSnapshot, { replace: true });
                return AppData.backups.commitImport(plan.id, { confirmDestructive: true });
            });
            assert.equal(receipt.committed, true);
            const imported = await backupFailureState(page);
            assert.equal(imported.settings.theme, 'original');
            assert.equal(imported.fault.migrationWrites, 0, 'an unrelated partial import must not require reading migration');
            assert.equal(imported.words.envelope, null);
            assert.equal(imported.bookshelf.envelope, null);
            assert.equal(imported.rawWords, before.rawWords);
            assert.equal(imported.rawBookshelf, before.rawBookshelf);

            const failure = await page.evaluate(async () => {
                try {
                    await AppData.backups.create({ id: 'pre-import', type: 'pre-import' });
                    return null;
                } catch (error) {
                    return error.code;
                }
            });
            assert.equal(failure, 'QUOTA_EXCEEDED', 'explicit safety backups must include recoverable local-only collections');
            const failed = await backupFailureState(page);
            assert.ok(failed.fault.migrationWrites > 0);
            assert.equal(failed.fault.installCalls, imported.fault.installCalls);
            assert.deepEqual(failed.settings, imported.settings);
            assert.deepEqual(failed.backupIds, before.backupIds, 'a failed backup must not leave an incomplete safety entry');
            assert.equal(failed.rawWords, before.rawWords);
            assert.equal(failed.rawBookshelf, before.rawBookshelf);

            const safety = await page.evaluate(async () => {
                window.readingMigrationFault.enabled = false;
                return AppData.backups.create({ id: 'pre-import', type: 'pre-import' });
            });
            assert.deepEqual(safety.data.envelopes['vocab.readingVocabWords'].data, staleWords);
            assert.deepEqual(safety.data.envelopes['vocab.readingBookshelfExams'].data, staleBookshelf);
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
