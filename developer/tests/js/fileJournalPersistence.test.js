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

test('interrupted initial marker, snapshot and manifest writes recover the original legacy records', async () => {
    await fixture(async ({ page }) => {
        for (const failure of ['bootstrap.json', 'snapshot-', 'head.json']) {
            const a = await page(false); await complete(a, 'legacy-' + failure);
            await a.reload();
            await a.evaluate(failure => {
                const original = FileSystemFileHandle.prototype.createWritable;
                FileSystemFileHandle.prototype.createWritable = function(...args) {
                    if (this.name.startsWith(failure)) throw new DOMException('interrupted bootstrap', 'AbortError');
                    return original.apply(this, args);
                };
            }, failure);
            await assert.rejects(() => load(a), /interrupted bootstrap/);
            assert.deepEqual(await a.evaluate(() => AppData.ready.catch(error => ({ code: error.code, native: error.details.originalCode }))),
                { code: 'BACKEND_UNAVAILABLE', native: 20 });
            await a.reload(); await load(a);
            assert((await ids(a)).includes('legacy-' + failure));
            await a.close();
            // Each fault starts with a fresh pre-file origin, not a previous journal.
            const cleaner = await a.context().newPage(); await cleaner.goto(a.url());
            await cleaner.evaluate(async () => {
                await (await navigator.storage.getDirectory()).removeEntry('ielts-atlas-local-v1', { recursive: true });
                await new Promise(resolve => { const r = indexedDB.deleteDatabase('IELTSAtlasDataV2'); r.onsuccess = resolve; });
            });
            await cleaner.close();
        }
    });
});

test('selected and saved local directories reject identical and nested exchange bindings before writing', async () => {
    await fixture(async ({ context, origin }) => {
        for (const relationship of ['same', 'local-parent', 'exchange-parent']) {
            const isolated = await context.browser().newContext();
            const a = await isolated.newPage(); await a.goto(origin);
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/data/v2/syncModel.js'), 'utf8') });
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncFolderAdapter.js'), 'utf8') });
            await a.evaluate(async relationship => {
                const opfs = await navigator.storage.getDirectory();
                const parent = await opfs.getDirectoryHandle('parent', { create: true });
                const child = await parent.getDirectoryHandle('child', { create: true });
                window.__local = relationship === 'exchange-parent' ? child : parent;
                const exchange = relationship === 'local-parent' ? child : parent;
                await SyncFolderAdapter.binding({ directory: exchange, spaceId: 'old-space' });
                navigator.storage.getDirectory = async () => { throw new DOMException('unavailable', 'SecurityError'); };
                window.showDirectoryPicker = async () => __local;
            }, relationship);
            // Load scripts without awaiting the deliberately blocked startup.
            for (const source of sources) await a.addScriptTag({ content: fs.readFileSync(path.join(root, source), 'utf8') });
            await a.getByRole('button', { name: '选择本地数据目录' }).click();
            await a.waitForFunction(() => document.querySelector('#local-file-storage-dialog [role=alert]')?.textContent.includes('必须分开'));
            assert.equal(await a.evaluate(async () => {
                try { await __local.getDirectoryHandle(FileJournal.directoryName); return true; }
                catch (error) { if (error.name === 'NotFoundError') return false; throw error; }
            }), false);
            // Simulate an overlapping binding saved by the previous release.
            await a.evaluate(() => new Promise((resolve, reject) => {
                const r = indexedDB.open(FileJournal.bindingDatabase, 1);
                r.onsuccess = () => {
                    const db = r.result, tx = db.transaction('handles', 'readwrite');
                    tx.objectStore('handles').put(__local, 'local');
                    tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
                };
            }));
            await assert.rejects(() => a.evaluate(async () => SyncFolderAdapter.workspace(await SyncFolderAdapter.binding())), /必须分开/);
            await a.reload(); await assert.rejects(() => load(a), /必须分开/);
            await isolated.close();
        }
    });
});

async function resetServices(page, fault = '') {
    for (const source of ['js/services/syncFolderAdapter.js', 'js/services/syncService.js']) {
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, source), 'utf8') });
    }
    await page.evaluate(fault => {
        window.__rollbacks = 0;
        window.__resetCommits = 0;
        window.AppDiagnosticStore = { withFullReset: async task => {
            const result = await task();
            if (fault === 'diagnostics') throw new Error('late diagnostics failure');
            return result;
        } };
        window.ExternalBackupService = {
            withFullResetLock: task => navigator.locks.request('ielts-atlas-external-backup-write', task),
            prepareForFullReset: async () => ({ success: fault !== 'backup' }),
            commitFullResetPreparation: async () => { window.__resetCommits++; if (fault === 'commit') throw new Error('late commit failure'); return true; },
            rollbackFullResetPreparation: async () => { window.__rollbacks++; return true; }
        };
        if (fault === 'history') {
            const remove = FileSystemDirectoryHandle.prototype.removeEntry;
            FileSystemDirectoryHandle.prototype.removeEntry = function(name, ...args) {
                if (name.startsWith('ops-')) throw new DOMException('cleanup denied', 'NoModificationAllowedError');
                return remove.call(this, name, ...args);
            };
        }
        if (fault === 'database') {
            const remove = indexedDB.deleteDatabase.bind(indexedDB);
            indexedDB.deleteDatabase = name => { if (name === 'ExamSystemDB') throw new Error('cache deletion failed'); return remove(name); };
        }
        if (fault === 'web-storage') Storage.prototype.clear = () => { throw new Error('web storage clear failed'); };
    }, fault);
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/core/siteDataReset.js'), 'utf8') });
}

test('reset cleanup and later-stage failures report the committed frontier without rollback', async () => {
    await fixture(async ({ page, browser }) => {
        for (const fault of ['history', 'database', 'web-storage', 'commit', 'diagnostics']) {
            const context = await browser.newContext();
            const a = await page(true, context); await complete(a, 'erased');
            await resetServices(a, fault);
            const result = await a.evaluate(() => SiteDataReset.perform({ reload: false }));
            assert.equal(result.success, fault === 'history', fault);
            assert.equal(result.resetCommitted, true, fault);
            assert.equal(result.retryable, false, fault);
            assert.equal(result.requiresReload, true, fault);
            assert.equal(await a.evaluate(() => __rollbacks), 0, fault);
            assert.equal(await a.evaluate(() => __resetCommits), 1, fault);
            if (fault === 'history') assert(result.cleanupWarnings.length > 0);
            await a.reload(); await load(a); assert.deepEqual(await ids(a), [], fault);
            await complete(a, 'after-' + fault);
            await context.close();
        }
    });
});

test('failed-startup reset repairs corrupt or missing manifests but retains sync and backup safeguards', async () => {
    await fixture(async ({ page, browser }) => {
        for (const scenario of ['corrupt', 'missing', 'pending', 'binding', 'backup']) {
            const context = await browser.newContext();
            const a = await page(true, context); await complete(a, 'protected');
            if (scenario === 'pending') await a.evaluate(async () => {
                await AppData.folderSync.connect('pending-space'); await AppData.folderSync.disconnect();
            });
            if (scenario === 'binding') {
                await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncFolderAdapter.js'), 'utf8') });
                await a.evaluate(async () => SyncFolderAdapter.binding({ directory: await navigator.storage.getDirectory(), spaceId: 'bound-space' }));
            }
            await a.evaluate(async missing => {
                const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
                if (missing) await dir.removeEntry('head.json');
                else { const w = await (await dir.getFileHandle('head.json')).createWritable(); await w.write('{broken'); await w.close(); }
            }, scenario === 'missing');
            await a.reload(); await assert.rejects(() => load(a));
            await resetServices(a, scenario);
            const result = await a.evaluate(() => SiteDataReset.perform({ reload: false }));
            const allowed = ['corrupt', 'missing'].includes(scenario);
            assert.equal(result.success, allowed, scenario);
            if (allowed) { await a.reload(); await load(a); assert.deepEqual(await ids(a), []); await complete(a, 'recovered'); }
            else {
                assert.equal(await a.evaluate(() => FileJournal.status().resetCommitted === true), false);
                assert.equal(await a.evaluate(() => FolderSyncService.getStatus().suspended), false);
            }
            await context.close();
        }
    });
});

async function failedStartupWithRealResetServices(context, origin) {
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => {
        const getFile = FileSystemFileHandle.prototype.getFile;
        FileSystemFileHandle.prototype.getFile = function(...args) {
            if (this.name === 'head.json') throw new DOMException('temporary startup head read failed', 'AbortError');
            return getFile.apply(this, args);
        };
        window.__restoreHeadReads = () => { FileSystemFileHandle.prototype.getFile = getFile; };
    });
    await assert.rejects(() => load(page), /temporary startup head read failed/);
    await page.evaluate(() => __restoreHeadReads());
    await realResetServices(page);
    return page;
}

async function realResetServices(page) {
    for (const source of ['js/diagnostics/diagnosticContract.js', 'js/diagnostics/diagnosticStore.js',
        'js/services/syncFolderAdapter.js', 'js/services/syncService.js',
        'js/core/externalBackupService.js', 'js/core/siteDataReset.js']) {
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, source), 'utf8') });
    }
    await page.evaluate(() => AppDiagnosticStore.ready);
}

const recoveryMarker = page => page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
    try { return JSON.parse(await (await (await dir.getFileHandle('recovery-reset.json')).getFile()).text()); }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
});

async function pauseRecoveryBeforeSnapshot(page) {
    await page.evaluate(() => {
        window.__resetSnapshotPaused = false;
        const getFileHandle = FileSystemDirectoryHandle.prototype.getFileHandle;
        const pause = new Promise(resolve => { window.__continueReset = resolve; });
        FileSystemDirectoryHandle.prototype.getFileHandle = async function(name, options) {
            if (this.name === FileJournal.directoryName && name.startsWith('snapshot-') && options?.create) {
                window.__resetSnapshotPaused = true;
                await pause;
            }
            return getFileHandle.call(this, name, options);
        };
        window.__reset = SiteDataReset.perform({ reload: false });
    });
    await page.waitForFunction(() => __resetSnapshotPaused === true);
}

test('an abandoned recovery reset can be retried from a fresh page after its owner exits', async () => {
    await fixture(async ({ page, context, origin }) => {
        const healthy = await page(); await complete(healthy, 'original');
        const before = await head(healthy);
        const owner = await failedStartupWithRealResetServices(context, origin);
        await pauseRecoveryBeforeSnapshot(owner);
        const marker = await recoveryMarker(healthy);
        assert(marker.token);
        assert.deepEqual(await head(healthy), before);
        await owner.close();
        await healthy.waitForFunction(async () => (await navigator.locks.query()).held.length === 0);
        assert.deepEqual(await head(healthy), before);
        assert.deepEqual(await recoveryMarker(healthy), marker);

        const recovering = await context.newPage(); await recovering.goto(origin);
        await assert.rejects(() => load(recovering), /本地数据正在清理/);
        await realResetServices(recovering);
        // Taking over an abandoned marker must still honor a saved sync binding.
        await recovering.evaluate(async () => SyncFolderAdapter.binding({ directory: await navigator.storage.getDirectory(), spaceId: 'protected-space' }));
        assert.equal((await recovering.evaluate(() => SiteDataReset.perform({ reload: false }))).success, false);
        assert.deepEqual(await recoveryMarker(healthy), marker);
        assert.deepEqual(await head(healthy), before);
        await recovering.evaluate(() => SyncFolderAdapter.binding(null));
        const result = await recovering.evaluate(() => SiteDataReset.perform({ reload: false }));
        assert.equal(result.success, true);
        assert.equal(result.resetCommitted, true);
        assert.notEqual((await head(healthy)).head.workspaceId, before.head.workspaceId);
        assert.equal(await recoveryMarker(healthy), null);
        await recovering.reload(); await load(recovering);
        assert.deepEqual(await ids(recovering), []);
        await complete(recovering, 'after-recovery');
        await recovering.reload(); await load(recovering);
        assert.deepEqual(await ids(recovering), ['after-recovery']);
    });
});

test('a live recovery reset keeps its marker while another full reset waits', async () => {
    await fixture(async ({ page, context, origin }) => {
        const healthy = await page(); await complete(healthy, 'original');
        const before = await head(healthy);
        const owner = await failedStartupWithRealResetServices(context, origin);
        const contender = await failedStartupWithRealResetServices(context, origin);
        await pauseRecoveryBeforeSnapshot(owner);
        const marker = await recoveryMarker(healthy);
        await contender.evaluate(() => {
            window.__finishedReset = false;
            window.__reset = SiteDataReset.perform({ reload: false }).finally(() => { window.__finishedReset = true; });
        });
        await healthy.waitForFunction(async () => (await navigator.locks.query()).pending
            .some(lock => lock.name === 'ielts-atlas-external-backup-write'));
        assert.equal(await contender.evaluate(() => __finishedReset), false);
        assert.deepEqual(await recoveryMarker(healthy), marker);
        assert.deepEqual(await head(healthy), before);
        await contender.close();
        await healthy.waitForFunction(async () => !(await navigator.locks.query()).pending
            .some(lock => lock.name === 'ielts-atlas-external-backup-write'));
        assert.deepEqual(await recoveryMarker(healthy), marker);
        await owner.evaluate(() => __continueReset());
        assert.equal((await owner.evaluate(() => __reset)).success, true);
        await healthy.reload(); await load(healthy);
        assert.deepEqual(await ids(healthy), []);
    });
});

for (const fault of ['writer', 'verification']) {
    test(`interrupted recovery-marker publication at ${fault} preserves surviving writes and reload`, async () => {
        await fixture(async ({ page, context, origin }) => {
            const healthy = await page(); await complete(healthy, 'original');
            const before = await head(healthy);
            const recovering = await failedStartupWithRealResetServices(context, origin);
            await recovering.evaluate(fault => {
                const method = fault === 'writer' ? 'createWritable' : 'getFile';
                const original = FileSystemFileHandle.prototype[method];
                window.__markerFaults = 0;
                const pause = new Promise(resolve => { window.__releaseMarkerFailure = resolve; });
                FileSystemFileHandle.prototype[method] = async function(...args) {
                    if (this.name === 'recovery-reset.json') {
                        window.__markerFaults++;
                        await pause;
                        throw new DOMException('interrupted recovery marker ' + fault, 'AbortError');
                    }
                    return original.apply(this, args);
                };
                window.__reset = SiteDataReset.perform({ reload: false });
            }, fault);
            await recovering.waitForFunction(() => __markerFaults === 1);
            // A healthy tab queues a write while the partial/complete marker exists.
            // Cleanup must finish before releasing the file lock to that writer.
            const pendingSave = complete(healthy, 'survivor').then(() => ({ success: true }), error => ({ error: error.message }));
            await healthy.waitForFunction(async () => (await navigator.locks.query()).pending.some(lock => lock.name === 'ielts-atlas-local-journal-v1'));
            await recovering.evaluate(() => __releaseMarkerFailure());
            const result = await recovering.evaluate(() => __reset);
            assert.equal(result.success, false);
            assert.equal(result.retryable, true);
            assert.equal(await recovering.evaluate(() => FileJournal.status().resetCommitted === true), false);
            assert.equal(await recovering.evaluate(() => FolderSyncService.getStatus().suspended), false);
            assert.deepEqual(await pendingSave, { success: true });
            assert.equal(await healthy.evaluate(() => AppData.status().state), 'ready');
            assert.equal((await head(healthy)).head.workspaceId, before.head.workspaceId);
            assert.deepEqual(await ids(healthy), ['original', 'survivor']);
            assert.equal(await healthy.evaluate(async () => {
                const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
                try { await dir.getFileHandle('recovery-reset.json'); return true; }
                catch (error) { if (error.name === 'NotFoundError') return false; throw error; }
            }), false);
            await recovering.reload(); await load(recovering);
            assert.deepEqual(await ids(recovering), ['original', 'survivor']);
            await complete(recovering, 'after-reload');
            assert.deepEqual(await ids(healthy), ['after-reload', 'original', 'survivor']);
        });
    });
}

test('recovery-reset rollback preserves another attempt marker', async () => {
    await fixture(async ({ page, browser, origin }) => {
        for (const existing of [true, false]) {
            const context = await browser.newContext();
            const healthy = await page(true, context); await complete(healthy, 'original');
            const recovering = await failedStartupWithRealResetServices(context, origin);
            if (!existing) await recovering.evaluate(() => FileJournal.resetBarrier(true));
            await healthy.evaluate(() => navigator.locks.request('ielts-atlas-local-journal-v1', async () => {
                const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
                const writer = await (await dir.getFileHandle('recovery-reset.json', { create: true })).createWritable();
                await writer.write(JSON.stringify({ token: 'another-reset-attempt' })); await writer.close();
            }));
            if (existing) {
                // A direct barrier call has no full-reset lock authorizing takeover.
                await assert.rejects(() => recovering.evaluate(() => FileJournal.resetBarrier(true)), /已有清理标记/);
            } else await recovering.evaluate(() => FileJournal.resetBarrier(false));
            const marker = await healthy.evaluate(async () => {
                const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
                return JSON.parse(await (await (await dir.getFileHandle('recovery-reset.json')).getFile()).text());
            });
            assert.deepEqual(marker, { token: 'another-reset-attempt' });
            // Only the simulated owner cancels the remaining barrier.
            await healthy.evaluate(() => navigator.locks.request('ielts-atlas-local-journal-v1', async () => {
                const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName);
                await dir.removeEntry('recovery-reset.json');
            }));
            assert.deepEqual(await ids(healthy), ['original']);
            await complete(healthy, 'after-cancellation');
            await recovering.reload(); await load(recovering);
            assert.deepEqual(await ids(recovering), ['after-cancellation', 'original']);
            await context.close();
        }
    });
});

test('native aborts and terminal journal failures retain details behind BACKEND_UNAVAILABLE', async () => {
    await fixture(async ({ page, browser }) => {
        for (const failure of ['AbortError', 'missing-head']) {
            const context = await browser.newContext(), a = await page(true, context);
            await a.evaluate(async failure => {
                if (failure === 'missing-head') {
                    await (await (await navigator.storage.getDirectory()).getDirectoryHandle(FileJournal.directoryName)).removeEntry('head.json');
                } else {
                    const original = FileSystemFileHandle.prototype.createWritable;
                    FileSystemFileHandle.prototype.createWritable = function(...args) {
                        if (this.name.startsWith('ops-')) throw new DOMException('native write aborted', 'AbortError');
                        return original.apply(this, args);
                    };
                }
            }, failure);
            const result = await a.evaluate(() => AppData.preferences.setTheme('changed').catch(error => ({ code: error.code, details: error.details })));
            assert.equal(result.code, 'BACKEND_UNAVAILABLE');
            assert.equal(result.details.originalCode, failure === 'AbortError' ? 20 : 'FILE_STORAGE_UNAVAILABLE');
            assert.equal(await a.evaluate(() => AppData.status().state), 'failed');
            await context.close();
        }
    });
});

test('a popup lock-callback refusal retries only before the transaction starts', async () => {
    await fixture(async ({ page }) => {
        const a = await page();
        await a.evaluate(() => {
            const request = navigator.locks.request.bind(navigator.locks);
            window.__refusedLock = false;
            navigator.locks.request = function(name, ...args) {
                if (name === 'ielts-atlas-local-journal-v1' && !window.__refusedLock) {
                    window.__refusedLock = true;
                    return Promise.reject(new Error("Failed to execute 'open' on 'Window': The provided callback is no longer runnable."));
                }
                return request(name, ...args);
            };
        });
        await complete(a, 'after-popup');
        assert.equal(await a.evaluate(() => __refusedLock), true);
        assert.deepEqual(await ids(a), ['after-popup']);
        const before = await head(a);
        await a.evaluate(() => {
            const create = FileSystemFileHandle.prototype.createWritable;
            window.__fileWriteAttempts = 0;
            FileSystemFileHandle.prototype.createWritable = function(...args) {
                if (this.name.startsWith('ops-')) {
                    window.__fileWriteAttempts++;
                    throw new Error('The provided callback is no longer runnable.');
                }
                return create.apply(this, args);
            };
        });
        await assert.rejects(() => complete(a, 'do-not-retry'), /backend failed/);
        assert.equal(await a.evaluate(() => __fileWriteAttempts), 1);
        assert.equal((await head(a)).sha256, before.sha256);
        await a.reload(); await load(a);
        assert.deepEqual(await ids(a), ['after-popup']);
    });
});
