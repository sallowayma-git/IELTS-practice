import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sources = ['js/data/v2/dataCatalog.js', 'js/data/v2/syncModel.js', 'js/data/v2/fileJournal.js',
    'js/data/v2/dataKernel.js', 'js/data/practiceRecordSource.js', 'js/core/vocabScheduler.js',
    'js/core/practiceReviewScheduler.js', 'js/data/v2/readingVocabularyModel.js',
    'js/data/v2/readingViewCache.js', 'js/data/v2/appData.js'];
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
async function load(page, files = true) {
    for (const source of sources.filter(source => files || !source.endsWith('/fileJournal.js'))) {
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, source), 'utf8') });
    }
    await page.evaluate(() => AppData.ready);
}
async function fixture(run) {
    const server = http.createServer((req, res) => res.end('<!doctype html><title>File journal test</title>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext();
    const page = async (files = true, chosenContext = context) => {
        const page = await chosenContext.newPage(); await page.goto(origin); await load(page, files); return page;
    };
    try { await run({ page, browser, context, origin }); }
    finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
const complete = (page, id) => page.evaluate(id => AppData.practice.completeAttempt({ operationId: 'complete-' + id,
    record: { id, title: id, examId: 'exam', type: 'reading', totalQuestions: 1, correctAnswers: 1,
        answers: { 1: 'yes' }, date: '2026-11-09T01:00:00.000Z' } }), id);
const ids = page => page.evaluate(async () => (await AppData.practice.list()).map(row => row.id).sort());
const head = page => page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
    return JSON.parse(await (await (await root.getFileHandle('head.json')).getFile()).text());
});
async function discardCache(page) {
    await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('IELTSAtlasDataV2');
        request.onsuccess = resolve; request.onerror = () => reject(request.error);
    }));
}

test('OPFS is durable with sync off, through toggles, and after cache removal', async () => {
    await fixture(async ({ page }) => {
        const a = await page();
        assert.equal(await a.evaluate(() => AppData.status().backend), 'opfs-json');
        assert.equal(await a.evaluate(async () => (await AppData.folderSync.status()).enabled), false);
        const initial = await head(a);
        await complete(a, 'offline');
        const written = await head(a);
        assert(written.head.sequence > initial.head.sequence);
        const durable = await a.evaluate(async () => {
            const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
            const texts = [];
            for await (const file of dir.values()) if (file.name.endsWith('.jsonl')) texts.push(await (await file.getFile()).text());
            return texts.join('\n');
        });
        assert(durable.includes('offline'));
        assert(durable.includes('practiceSummaries') && durable.includes('practiceDetails') && durable.includes('practiceAnnotations'));
        await a.evaluate(() => AppData.folderSync.connect('space-file-journal'));
        await complete(a, 'online');
        await a.evaluate(() => AppData.folderSync.disconnect());
        await complete(a, 'offline-again');
        assert.equal((await head(a)).head.workspaceId, initial.head.workspaceId);
        await discardCache(a);
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['offline', 'offline-again', 'online']);
        assert.equal(await a.evaluate(async () => (await AppData.practice.get('offline')).answers[1]), 'yes');
        assert.equal(await a.evaluate(async () => (await AppData.folderSync.status()).enabled), false);
    });
});

test('existing IndexedDB data migrates once and stale cache edits cannot override files', async () => {
    await fixture(async ({ page }) => {
        const a = await page(false); await complete(a, 'legacy');
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['legacy']);
        await complete(a, 'file-only');
        // Simulate an older application modifying the disposable database.
        await a.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.open('IELTSAtlasDataV2');
            request.onsuccess = () => {
                const db = request.result, tx = db.transaction('practiceSummaries', 'readwrite');
                tx.objectStore('practiceSummaries').clear();
                tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
            };
        }));
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['file-only', 'legacy']);
    });
});

test('cold reads use a verified current IndexedDB projection without replaying the snapshot', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await complete(a, 'fast-read');
        await a.addInitScript(() => {
            window.__snapshotReads = 0;
            const original = FileSystemFileHandle.prototype.getFile;
            FileSystemFileHandle.prototype.getFile = function(...args) {
                if (this.name.startsWith('snapshot-')) window.__snapshotReads++;
                return original.apply(this, args);
            };
        });
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['fast-read']);
        assert.equal(await a.evaluate(() => window.__snapshotReads), 0);
    });
});

test('first file migration fences an older tab before its database becomes a cache', async () => {
    await fixture(async ({ page }) => {
        const old = await page(false); await complete(old, 'before-upgrade');
        const current = await page();
        assert.deepEqual(await ids(current), ['before-upgrade']);
        await assert.rejects(() => complete(old, 'old-tab-write'), /backend failed/);
        const cannotReopen = await old.evaluate(() => new Promise(resolve => {
            const request = indexedDB.open('IELTSAtlasDataV2', 2);
            request.onerror = () => resolve(request.error.name);
            request.onsuccess = () => { request.result.close(); resolve('opened'); };
        }));
        assert.equal(cannotReopen, 'VersionError');
        await complete(current, 'after-upgrade');
        assert.deepEqual(await ids(current), ['after-upgrade', 'before-upgrade']);
    });
});

test('cache write failure cannot turn a committed file save into a failed save', async () => {
    await fixture(async ({ page }) => {
        const a = await page();
        await a.evaluate(() => {
            const original = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function(stores, mode, ...rest) {
                if (this.name === 'IELTSAtlasDataV2' && mode === 'readwrite') throw new DOMException('injected cache failure', 'QuotaExceededError');
                return original.call(this, stores, mode, ...rest);
            };
        });
        await complete(a, 'cache-failed');
        assert.equal(await a.evaluate(() => AppData.status().files.cache), 'unavailable');
        assert.deepEqual(await ids(a), ['cache-failed']);
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['cache-failed']);
    });
});

test('an established OPFS journal still operates when IndexedDB cannot open at all', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await complete(a, 'files-alone');
        await a.addInitScript(() => { indexedDB.open = () => { throw new Error('IndexedDB unavailable'); }; });
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['files-alone']);
        await complete(a, 'without-database');
        assert.equal(await a.evaluate(() => AppData.status().files.cache), 'unavailable');
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['files-alone', 'without-database']);
    });
});

test('failed JSONL write rolls back all entity layers and leaves the outbox untouched', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await a.evaluate(() => AppData.folderSync.connect('space-write-failure'));
        await complete(a, 'before');
        const before = await head(a);
        const pending = await a.evaluate(() => AppData.folderSync.pending());
        await a.evaluate(() => {
            const original = FileSystemFileHandle.prototype.createWritable;
            FileSystemFileHandle.prototype.createWritable = async function(...args) {
                if (this.name.startsWith('ops-')) throw new DOMException('injected file failure', 'QuotaExceededError');
                return original.apply(this, args);
            };
        });
        await assert.rejects(() => complete(a, 'failed'), /quota/i);
        assert.equal((await head(a)).sha256, before.sha256);
        assert.deepEqual(await ids(a), ['before']);
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['before']);
        assert.deepEqual(await a.evaluate(() => AppData.folderSync.pending()), pending);
        await complete(a, 'failed'); // Retry the same operation ID after recovery.
        assert.deepEqual(await ids(a), ['before', 'failed']);
    });
});

test('head publication failure never exposes an uncommitted transaction after reload', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await complete(a, 'before');
        const before = await head(a);
        await a.evaluate(() => {
            const original = FileSystemFileHandle.prototype.createWritable;
            FileSystemFileHandle.prototype.createWritable = async function(...args) {
                if (this.name === 'head.json') throw new DOMException('injected manifest failure', 'QuotaExceededError');
                return original.apply(this, args);
            };
        });
        await assert.rejects(() => complete(a, 'orphan'), /quota/i);
        assert.equal((await head(a)).sha256, before.sha256);
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['before']);
        await complete(a, 'after'); assert.deepEqual(await ids(a), ['after', 'before']);
    });
});

test('two tabs serialize file commits and refresh stale memory without notifications', async () => {
    await fixture(async ({ page, context }) => {
        await context.addInitScript(() => { window.BroadcastChannel = undefined; });
        const a = await page(), b = await page();
        await Promise.all([complete(a, 'A'), complete(b, 'B')]);
        assert.deepEqual(await ids(a), ['A', 'B']);
        assert.deepEqual(await ids(b), ['A', 'B']);
        const frontier = await head(a);
        assert(frontier.head.tail.every((part, index, parts) => index === 0 || part.sequence === parts[index - 1].sequence + 1));
        await a.reload(); await load(a); assert.deepEqual(await ids(a), ['A', 'B']);
    });
});

test('received operations persist before projection and replay without generating echoes', async () => {
    await fixture(async ({ page, browser }) => {
        const a = await page(), b = await page(true, await browser.newContext());
        await a.evaluate(() => AppData.folderSync.connect('space-receive-json'));
        await b.evaluate(() => AppData.folderSync.connect('space-receive-json'));
        await complete(a, 'remote');
        const operations = await a.evaluate(() => AppData.folderSync.pending());
        const before = await b.evaluate(() => AppData.folderSync.pending());
        for (const operation of operations) await b.evaluate(operation => AppData.folderSync.receive(operation), operation);
        await discardCache(b); await b.reload(); await load(b);
        assert.deepEqual(await ids(b), ['remote']);
        for (const operation of operations.reverse()) await b.evaluate(operation => AppData.folderSync.receive(operation), operation);
        assert.deepEqual(await b.evaluate(() => AppData.folderSync.pending()), before);
    });
});

test('local reset cannot resurrect an old cache and fences surviving tabs', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page(); await complete(a, 'old');
        await a.evaluate(() => FileJournal.resetLocal());
        await assert.rejects(() => complete(b, 'stale'), /Local data backend failed/);
        await a.reload(); await load(a); assert.deepEqual(await ids(a), []);
        await complete(a, 'new'); assert.deepEqual(await ids(a), ['new']);
    });
});

test('corrupt committed segments fail closed instead of importing a stale database', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await complete(a, 'protected');
        const current = await head(a);
        await a.evaluate(async name => {
            const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
            const file = await dir.getFileHandle(name), writer = await file.createWritable();
            await writer.write('{broken'); await writer.close();
        }, current.head.tail.at(-1).name);
        await discardCache(a); await a.reload();
        await assert.rejects(() => load(a), /Local JSON storage is unavailable/);
    });
});

test('checkpoint plus its tail rebuilds the latest state without IndexedDB', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await complete(a, 'checkpoint-record');
        await a.evaluate(async () => {
            for (let index = 0; index < 132; index++) await AppData.preferences.setTheme('theme-' + index);
        });
        const current = await head(a);
        assert(current.head.snapshot.sequence >= 128);
        assert(current.head.tail.length > 0 && current.head.tail.length < 128);
        await discardCache(a); await a.reload(); await load(a);
        assert.equal(await a.evaluate(() => AppData.preferences.getTheme()), 'theme-131');
        assert.deepEqual(await ids(a), ['checkpoint-record']);
    });
});

test('OPFS failure requests a local directory and reopens the saved file authority', async () => {
    await fixture(async ({ context, origin }) => {
        await context.addInitScript(() => {
            const original = navigator.storage.getDirectory.bind(navigator.storage);
            navigator.storage.getDirectory = async () => { throw new DOMException('file URL simulation', 'SecurityError'); };
            window.showDirectoryPicker = async () => (await original()).getDirectoryHandle('visible-test', { create: true });
        });
        const a = await context.newPage(); await a.goto(origin);
        const loading = load(a);
        await a.getByRole('button', { name: '选择本地数据目录' }).click(); await loading;
        assert.equal(await a.evaluate(() => AppData.status().backend), 'directory-json');
        await complete(a, 'visible');
        await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncFolderAdapter.js'), 'utf8') });
        await assert.rejects(() => a.evaluate(async () => SyncFolderAdapter.openWorkspace(await showDirectoryPicker(), () => true)), /必须分开/);
        await a.reload(); await load(a);
        assert.equal(await a.locator('#local-file-storage-dialog').count(), 0);
        assert.deepEqual(await ids(a), ['visible']);
    });
});

test('a missing manifest with remaining files cannot bootstrap stale IndexedDB data', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await complete(a, 'protected');
        await a.evaluate(async () => {
            const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
            await dir.removeEntry('head.json');
        });
        await a.reload(); await assert.rejects(() => load(a), /本地清单缺失/);
    });
});
