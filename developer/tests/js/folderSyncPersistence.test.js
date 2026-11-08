import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sources = ['js/data/v2/dataCatalog.js', 'js/data/v2/syncModel.js', 'js/data/v2/dataKernel.js',
    'js/data/practiceRecordSource.js', 'js/data/v2/appData.js'];
const SPACE = 'space-persistence-001';
const record = id => ({ id, title: id, examId: 'exam-one', type: 'reading', totalQuestions: 2, correctAnswers: 1,
    answers: { 1: 'yes', 2: 'no' }, date: '2026-11-08T01:00:00.000Z' });
async function fixture(task) {
    const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Sync test</title>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const contexts = [];
    async function page(boot = true) {
        const context = await browser.newContext(); contexts.push(context);
        const page = await context.newPage(); await page.goto(origin); if (boot) await load(page); return page;
    }
    try { await task({ page, load, origin }); }
    finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
async function load(page) {
    for (const source of sources) await page.addScriptTag({ content: fs.readFileSync(path.join(root, source), 'utf8') });
    await page.evaluate(() => AppData.ready);
}
async function complete(page, id, operationId = 'complete-' + id) {
    return page.evaluate(({ record, operationId }) => AppData.practice.completeAttempt({ record, operationId }), { record: record(id), operationId });
}
async function connect(page) { return page.evaluate(space => AppData.folderSync.connect(space), SPACE); }
async function pending(page) { return page.evaluate(() => AppData.folderSync.pending()); }
async function send(from, to) {
    for (const operation of await pending(from)) await to.evaluate(operation => AppData.folderSync.receive(operation), operation);
}
test('real IndexedDB: outbox is atomic, durable across reload, idempotent, and excluded from backup', async () => {
    await fixture(async ({ page, load }) => {
        const a = await page(); await connect(a);
        const initial = await pending(a);
        await complete(a, 'durable');
        const before = await pending(a);
        assert.equal(before.length, initial.length + 1);
        assert(before.at(-1).changes.some(item => item.key === 'practice/durable'));
        await complete(a, 'durable');
        assert.equal((await pending(a)).length, before.length);
        const writer = await a.evaluate(async () => (await AppData.folderSync.status()).writerId);
        await a.reload(); await load(a);
        assert.equal((await pending(a)).length, before.length);
        assert.equal(await a.evaluate(async () => (await AppData.folderSync.status()).writerId), writer);
        const backup = await a.evaluate(() => AppData.backups.export());
        assert(!Object.keys(backup.envelopes).some(key => key.includes('folderSync')));
        await a.evaluate(() => {
            const original = FolderSyncModel;
            window.__restoreModel = () => { window.FolderSyncModel = original; };
            window.FolderSyncModel = { ...original, capture() { throw new Error('injected outbox failure'); } };
        });
        await assert.rejects(() => complete(a, 'rolled-back'), /injected outbox failure/);
        await a.evaluate(() => __restoreModel());
        assert.equal(await a.evaluate(() => AppData.practice.get('rolled-back')), null);
        assert.equal((await pending(a)).length, before.length);
        assert.equal(await a.evaluate(() => AppData.status().state), 'ready');
    });
});
test('real IndexedDB: two isolated browsers union attempts, preserve details, transmit deletion and avoid echoes', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page(); await connect(a); await connect(b);
        await send(a, b); await send(b, a);
        await complete(a, 'A'); await complete(b, 'B');
        const localA = (await pending(a)).length, localB = (await pending(b)).length;
        await send(a, b); await send(b, a); await send(a, b);
        assert.equal((await pending(a)).length, localA);
        assert.equal((await pending(b)).length, localB);
        const records = await b.evaluate(() => AppData.practice.list());
        assert.equal(records.length, 2);
        assert(records.some(row => row.id === 'A' && row.answers['1'] === 'yes'));
        await a.evaluate(() => AppData.practice.delete({ recordId: 'A', operationId: 'delete-A' }));
        await send(a, b);
        assert.equal(await b.evaluate(() => AppData.practice.get('A')), null);
        assert.equal((await b.evaluate(() => AppData.practice.list())).length, 1);
        // Old files are retained and replayed: a causally later tombstone still wins.
        for (const op of [...await pending(a)].reverse()) await b.evaluate(op => AppData.folderSync.receive(op), op);
        assert.equal(await b.evaluate(() => AppData.practice.get('A')), null);
    });
});
test('real IndexedDB: concurrent annotations keep versions and resolution applies without changing score', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page(); await connect(a); await connect(b);
        await complete(a, 'shared'); await send(a, b); await send(b, a);
        const patch = (page, text) => page.evaluate(text => AppData.practice.updateAnnotations({ recordId: 'shared', patch: { note: text }, operationId: 'note-' + text }), text);
        await patch(a, 'alpha'); await patch(b, 'beta'); await send(a, b); await send(b, a);
        const status = await a.evaluate(() => AppData.folderSync.status());
        const conflict = status.conflicts.find(item => item.key === 'practice/shared');
        assert(conflict, 'concurrent note changes should be preserved');
        const selected = conflict.versions.find(item => item.value.value.practiceAnnotations.note === 'beta');
        await a.evaluate(({ key, id }) => AppData.folderSync.resolve(key, id), { key: conflict.key, id: selected.id });
        await send(a, b);
        const final = await b.evaluate(() => AppData.practice.get('shared'));
        assert.equal(final.correctAnswers, 1);
        assert.equal((await b.evaluate(() => AppData.folderSync.status())).conflicts.length, 0);
    });
});
test('real FileSystemDirectoryHandle: persistent binding, automatic exchange, and restart queue delivery', async () => {
    await fixture(async ({ page, load }) => {
        const a = await page(), b = await page();
        async function transport(page, create) {
            await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncFolderAdapter.js'), 'utf8') });
            await page.evaluate(() => {
                // Tests use origin-private directories, never the user's OneDrive or browser profile.
                window.SyncFolderAdapter = Object.freeze({ ...SyncFolderAdapter,
                    pick: async () => {
                        const dir = await navigator.storage.getDirectory();
                        for (const name of ['index.html', 'ONEDRIVE_SYNC.md']) await dir.getFileHandle(name, { create: true });
                        for (const name of ['js', 'css']) await dir.getDirectoryHandle(name, { create: true });
                        return dir;
                    }, permission: async () => window.__denySyncPermission ? 'prompt' : 'granted' });
            });
            await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncService.js'), 'utf8') });
            page.on('dialog', dialog => dialog.accept());
            if (create) await page.evaluate(() => FolderSyncService.connect());
        }
        await transport(a, true); await complete(a, 'filesystem-A'); await a.evaluate(() => FolderSyncService.syncNow());
        const readTree = async page => page.evaluate(async () => {
            const result = [];
            async function walk(dir, prefix = '') {
                for await (const item of dir.values()) {
                    if (item.kind === 'directory') await walk(item, prefix + item.name + '/');
                    else result.push({ path: prefix + item.name, text: await (await item.getFile()).text() });
                }
            }
            await walk(await navigator.storage.getDirectory()); return result;
        });
        async function copyFiles(from, to) {
            await to.evaluate(async files => {
                const root = await navigator.storage.getDirectory();
                for (const file of files) {
                    const parts = file.path.split('/'); let directory = root;
                    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
                    const handle = await directory.getFileHandle(parts.at(-1), { create: true });
                    const writer = await handle.createWritable(); await writer.write(file.text); await writer.close();
                }
            }, await readTree(from));
        }
        await copyFiles(a, b); await transport(b, false);
        await b.evaluate(() => FolderSyncService.connect(false));
        assert(await b.evaluate(() => AppData.practice.get('filesystem-A')));
        await complete(b, 'filesystem-B'); await b.evaluate(() => FolderSyncService.syncNow());
        await copyFiles(b, a); await a.evaluate(() => FolderSyncService.syncNow());
        assert.equal((await a.evaluate(() => AppData.practice.list())).length, 2);
        await complete(a, 'closed-before-send');
        assert((await pending(a)).length > 0);
        await a.evaluate(() => { window.__denySyncPermission = true; });
        await a.evaluate(() => FolderSyncService.syncNow());
        assert((await pending(a)).length > 0, 'permission loss must retain the outbox');
        await a.reload(); await load(a); await transport(a, false);
        await a.evaluate(() => FolderSyncService.init());
        await a.waitForFunction(() => !FolderSyncService.getStatus().busy && FolderSyncService.getStatus().pending === 0);
        assert.equal((await pending(a)).length, 0, 'reopening publishes without manual recovery');
        const files = await readTree(a);
        assert(files.some(file => file.text.includes('closed-before-send')));
        assert(files.every(file => !file.text.includes('directory-handle')));
        await complete(a, 'interrupted-file');
        const operation = (await pending(a)).at(-1);
        await a.evaluate(async operation => {
            const bound = await SyncFolderAdapter.binding();
            const ops = await SyncFolderAdapter.workspace(bound);
            const dir = await ops.getDirectoryHandle(operation.writerId, { create: true });
            const file = await dir.getFileHandle(operation.id + '.json', { create: true });
            const writer = await file.createWritable(); await writer.write('{"truncated":'); await writer.close();
        }, operation);
        await a.evaluate(() => FolderSyncService.syncNow());
        assert.equal((await pending(a)).length, 0, 'an own interrupted file must be repaired and retried');
        assert((await readTree(a)).some(file => file.path.includes('.incomplete-')));
        await a.evaluate(async () => {
            const bound = await SyncFolderAdapter.binding();
            const ops = await SyncFolderAdapter.workspace(bound);
            const dir = await ops.getDirectoryHandle('damaged-remote', { create: true });
            const file = await dir.getFileHandle('incomplete.json', { create: true });
            const writer = await file.createWritable(); await writer.write('{'); await writer.close();
        });
        await complete(a, 'still-publishes'); await a.evaluate(() => FolderSyncService.syncNow());
        assert.equal((await pending(a)).length, 0, 'a corrupt remote file must not block local publication');
        assert((await a.evaluate(() => FolderSyncService.getStatus())).errors.some(error => error.path.includes('damaged-remote')));
    });
});
test('real vocabulary: offline word collections merge and causal removal propagates', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page(); await connect(a); await connect(b);
        await send(a, b); await send(b, a);
        await a.evaluate(() => AppData.vocab.saveWords([{ id: 'apple', word: 'apple' }], { operationId: 'word-a' }));
        await b.evaluate(() => AppData.vocab.saveWords([{ id: 'banana', word: 'banana' }], { operationId: 'word-b' }));
        await send(a, b); await send(b, a);
        assert.equal((await a.evaluate(() => AppData.vocab.listWords())).length, 2);
        assert.equal((await b.evaluate(() => AppData.vocab.listWords())).length, 2);
        assert.equal((await a.evaluate(() => AppData.folderSync.status())).conflicts.length, 0);
        await a.evaluate(() => AppData.vocab.saveWords([{ id: 'banana', word: 'banana' }], { operationId: 'remove-apple' }));
        await send(a, b);
        assert.deepEqual(await b.evaluate(() => AppData.vocab.listWords()), [{ id: 'banana', word: 'banana' }]);
    });
});

test('real vocabulary: concurrent review states preserve alternatives and resolution converges', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page(); await connect(a); await connect(b);
        await a.evaluate(() => AppData.vocab.saveWords([{ id: 'apple', word: 'apple', reviewState: { interval: 1, repetitions: 1 } }], { operationId: 'seed-word' }));
        await send(a, b); await send(b, a);
        const change = (page, interval, repetitions, id) => page.evaluate(({ interval, repetitions, id }) =>
            AppData.vocab.saveWords([{ id: 'apple', word: 'apple', reviewState: { interval, repetitions } }], { operationId: id }), { interval, repetitions, id });
        await change(a, 6, 2, 'review-a'); await change(b, 1, 0, 'review-b');
        await send(a, b); await send(b, a);
        const conflict = (await a.evaluate(() => AppData.folderSync.status())).conflicts.find(item => item.key === 'vocabulary');
        assert(conflict, 'concurrent review states must retain whole versions');
        const chosen = conflict.versions[0];
        await a.evaluate(headId => AppData.folderSync.resolve('vocabulary', headId), chosen.id);
        await send(a, b);
        assert.deepEqual(await a.evaluate(() => AppData.vocab.listWords()), await b.evaluate(() => AppData.vocab.listWords()));
        assert.equal((await b.evaluate(() => AppData.folderSync.status())).conflicts.length, 0);
    });
});

async function installTransport(page) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncFolderAdapter.js'), 'utf8') });
    await page.evaluate(() => {
        window.showDirectoryPicker = () => navigator.storage.getDirectory();
        window.confirm = () => true;
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncService.js'), 'utf8') });
    await page.evaluate(() => FolderSyncService.init());
}
async function projectDirectory(page) {
    await page.evaluate(async () => {
        const dir = await navigator.storage.getDirectory();
        for (const name of ['index.html', 'ONEDRIVE_SYNC.md']) await dir.getFileHandle(name, { create: true });
        for (const name of ['js', 'css']) await dir.getDirectoryHandle(name, { create: true });
    });
}

test('fresh join skips empty defaults from both old and new clients, preserving independent local learning', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page(), c = await page();
        // Reproduce the original client: A published an empty vocabulary seed, then edited it.
        await a.evaluate(space => {
            const old = FolderSyncModel;
            window.FolderSyncModel = { ...old, capture(state, snapshot, id) {
                const actual = old.unitsFrom(snapshot, state.preferences);
                for (const key of Object.keys(actual)) if (!state.materialized[key]) state.materialized[key] = { exists: false };
                return old.capture(state, snapshot, id);
            } };
            window.__oldModel = old;
            return AppData.folderSync.connect(space);
        }, SPACE);
        await a.evaluate(() => { window.FolderSyncModel = __oldModel; });
        await a.evaluate(() => AppData.vocab.saveWords([{ id: 'apple', word: 'apple' }], { operationId: 'A-word' }));
        await complete(c, 'independent-before-connect');
        await c.evaluate(() => AppData.vocab.saveWords([{ id: 'banana', word: 'banana' }], { operationId: 'C-word' }));
        await connect(b); assert.equal((await pending(b)).length, 0);
        await send(a, b); await send(b, a);
        assert.deepEqual(await b.evaluate(() => AppData.vocab.listWords()), [{ id: 'apple', word: 'apple' }]);
        assert.equal((await b.evaluate(() => AppData.folderSync.status())).conflicts.length, 0);
        await connect(c); await send(a, c); await send(c, a);
        assert(await a.evaluate(() => AppData.practice.get('independent-before-connect')));
        const words = await c.evaluate(() => AppData.vocab.listWords());
        assert.deepEqual(words.map(word => word.id).sort(), ['apple', 'banana']);
        assert.equal((await c.evaluate(() => AppData.folderSync.status())).conflicts.length, 0);
    });
});

test('single entry detects existing roots and legacy user-data; refuses partial, incompatible and declined spaces', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await installTransport(a); await projectDirectory(a);
        const result = await a.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            let confirmations = 0;
            try { await SyncFolderAdapter.openWorkspace(root, () => false); } catch (_) { }
            let absent = false;
            try { await root.getDirectoryHandle('user-data'); } catch (e) { absent = e.name === 'NotFoundError'; }
            const first = await SyncFolderAdapter.openWorkspace(root, () => { confirmations++; return true; });
            const before = await (await (await first.directory.getFileHandle('workspace.json')).getFile()).text();
            const again = await SyncFolderAdapter.openWorkspace(root, () => { throw Error('must not prompt'); });
            const legacy = await SyncFolderAdapter.openWorkspace(first.directory);
            const after = await (await (await first.directory.getFileHandle('workspace.json')).getFile()).text();
            return { absent, confirmations, first: first.spaceId, again: again.spaceId, legacy: legacy.spaceId, before, after };
        });
        assert(result.absent); assert.equal(result.confirmations, 1);
        assert.equal(result.first, result.again); assert.equal(result.first, result.legacy); assert.equal(result.before, result.after);
        for (const content of [null, '', '{', JSON.stringify({ format: 'wrong', version: 99, spaceId: 'existing' })]) {
            const b = await page(); await installTransport(b); await projectDirectory(b);
            const error = await b.evaluate(async content => {
                const root = await navigator.storage.getDirectory();
                const dir = await root.getDirectoryHandle('user-data', { create: true });
                if (content !== null) { const w = await (await dir.getFileHandle('workspace.json', { create: true })).createWritable(); await w.write(content); await w.close(); }
                try { await SyncFolderAdapter.openWorkspace(root, () => { throw Error('unsafe confirmation'); }); return null; }
                catch (error) { return error.message; }
            }, content);
            assert(error); assert(!error.includes('unsafe confirmation'));
        }
        const c = await page(); await installTransport(c); await projectDirectory(c);
        await assert.rejects(() => c.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            await SyncFolderAdapter.openWorkspace(root, async () => {
                await root.getDirectoryHandle('user-data', { create: true }); return true;
            });
        }), /尚不完整/);
    });
});

async function resetHarness(page, { pause = false } = {}) {
    await page.evaluate(pause => {
        window.ExternalBackupService = {
            withFullResetLock: task => navigator.locks.request('ielts-atlas-external-backup-write', task),
            async prepareForFullReset() {
                window.__preparing = true;
                if (pause) await new Promise(resolve => { window.__releaseReset = resolve; });
                return { success: true };
            },
            async commitFullResetPreparation() { return true; },
            async rollbackFullResetPreparation() { return true; }
        };
    }, pause);
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/core/siteDataReset.js'), 'utf8') });
}

test('reset transaction barrier rejects another tab during preparation and publishes all earlier records', async () => {
    await fixture(async ({ page, load }) => {
        const a = await page(); await installTransport(a); await projectDirectory(a);
        await a.evaluate(async () => {
            window.SyncFolderAdapter = { ...SyncFolderAdapter, pick: () => navigator.storage.getDirectory(), permission: async () => 'granted' };
            window.confirm = () => true;
        });
        await a.evaluate(() => FolderSyncService.connect());
        const b = await a.context().newPage(); await b.goto(a.url()); await load(b);
        await complete(b, 'before-reset');
        await resetHarness(a, { pause: true });
        await a.evaluate(() => { window.__reset = SiteDataReset.perform({ reload: false }); });
        await a.waitForFunction(() => window.__preparing);
        await assert.rejects(() => complete(b, 'during-reset'), /正在清理/);
        assert.equal(await b.evaluate(() => AppData.practice.get('during-reset')), null);
        assert.equal((await pending(b)).length, 0);
        const published = await a.evaluate(async () => {
            const root = await SyncFolderAdapter.workspace(await SyncFolderAdapter.binding());
            for await (const dir of root.values()) for await (const f of dir.values())
                if ((await (await f.getFile()).text()).includes('before-reset')) return true;
            return false;
        });
        assert(published);
        await a.evaluate(() => __releaseReset());
        assert.equal((await a.evaluate(() => __reset)).success, true);
    });
});

test('reset failure releases write barrier; denied permission retains unpublished data', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await installTransport(a); await connect(a); await complete(a, 'unpublished');
        await assert.rejects(() => a.evaluate(() => FolderSyncService.withReset(async () => ({ success: true }))), /未写入/);
        assert((await pending(a)).length > 0); await complete(a, 'after-refused-reset');
        // A failed preparation also releases the barrier for unbound browsers.
        const b = await page(); await installTransport(b);
        assert.equal((await b.evaluate(() => FolderSyncService.withReset(async () => ({ success: false })))).success, false);
        await complete(b, 'after-failed-preparation');
    });
});

test('AppData readiness failure allows unbound site recovery but blocks a bound browser reset', async () => {
    await fixture(async ({ page }) => {
        for (const bound of [false, true]) {
            const a = await page(false);
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/data/v2/syncModel.js'), 'utf8') });
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncFolderAdapter.js'), 'utf8') });
            if (bound) await a.evaluate(async () => {
                await SyncFolderAdapter.binding({ directory: await navigator.storage.getDirectory(), spaceId: 'bound-space', name: 'test' });
            });
            await a.evaluate(() => {
                const ready = Promise.reject(new Error('injected initialization failure')); ready.catch(() => {});
                window.AppData = { ready, folderSync: { status: () => ready } };
            });
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncService.js'), 'utf8') });
            await resetHarness(a);
            const result = await a.evaluate(() => SiteDataReset.perform({ reload: false }));
            assert.equal(result.success, !bound);
            if (bound) assert(await a.evaluate(() => SyncFolderAdapter.binding()));
        }
    });
});

test('returning browser requests saved-folder access on one trusted click, retains denial and respects disconnect', async () => {
    await fixture(async ({ page, load }) => {
        for (const granted of [true, false]) {
            const a = await page(); await installTransport(a); await projectDirectory(a);
            await a.evaluate(() => FolderSyncService.connect());
            const space = await a.evaluate(async () => (await AppData.folderSync.status()).spaceId);
            await a.evaluate(() => { FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt'; });
            await complete(a, 'waiting-on-return');
            await a.reload(); await load(a);
            await a.evaluate(granted => {
                window.__requests = 0; window.__permission = 'prompt'; window.__practiceClicks = 0;
                FileSystemDirectoryHandle.prototype.queryPermission = async () => __permission;
                FileSystemDirectoryHandle.prototype.requestPermission = async () => {
                    if (!navigator.userActivation.isActive) throw new DOMException('activation required', 'SecurityError');
                    window.__requests++; return window.__permission = granted ? 'granted' : 'denied';
                };
                const button = document.createElement('button'); button.id = 'start-practice'; button.textContent = '开始做题';
                button.onclick = () => { window.__practiceClicks++; }; document.body.append(button);
            }, granted);
            await installTransport(a);
            await a.waitForFunction(() => !FolderSyncService.getStatus().busy);
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().enabled), true);
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().initializing), false);
            assert.equal(await a.evaluate(() => __requests), 0, 'no unsolicited prompt without activation');
            await a.evaluate(() => document.getElementById('start-practice').click());
            assert.equal(await a.evaluate(() => __requests), 0, 'synthetic clicks do not request access');
            await a.locator('#start-practice').click();
            await a.waitForFunction(() => __requests === 1 && !FolderSyncService.getStatus().busy);
            await a.locator('#start-practice').click();
            assert.equal(await a.evaluate(() => __requests), 1, 'at most one automatic request per visit');
            if (granted) await a.waitForFunction(() => !FolderSyncService.getStatus().busy && FolderSyncService.getStatus().pending === 0);
            else assert((await pending(a)).length > 0, 'denial preserves outbox');
            assert.equal(await a.evaluate(async () => (await AppData.folderSync.status()).spaceId), space);
            assert.equal(await a.evaluate(() => __practiceClicks), 3, 'automatic resume does not swallow practice clicks');
            await a.evaluate(() => FolderSyncService.disconnect());
            await a.reload(); await load(a); await installTransport(a);
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().bound), false);
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().enabled), false);
        }
    });
});

test('real persistent browser profile reopens and publishes automatically without connect or restore', async () => {
    await fixture(async ({ origin, load }) => {
        const profile = fs.mkdtempSync(path.join(root, 'developer/doc/onedrive-sync-resume-profile-'));
        const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
        let context;
        const launch = () => chromium.launchPersistentContext(profile, { headless: true, ...(executablePath ? { executablePath } : {}) });
        try {
            context = await launch(); let a = context.pages()[0]; await a.goto(origin); await load(a);
            await installTransport(a); await projectDirectory(a); await a.evaluate(() => FolderSyncService.connect());
            const before = await a.evaluate(async () => ({
                space: (await AppData.folderSync.status()).spaceId, writer: (await AppData.folderSync.status()).writerId
            }));
            await a.evaluate(() => { FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt'; });
            await complete(a, 'browser-restart-queued');
            assert((await pending(a)).length > 0);
            await context.close(); context = await launch(); a = context.pages()[0]; await a.goto(origin); await load(a);
            await installTransport(a);
            await a.waitForFunction(() => !FolderSyncService.getStatus().busy && FolderSyncService.getStatus().pending === 0);
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().enabled), true);
            const after = await a.evaluate(async () => ({
                space: (await AppData.folderSync.status()).spaceId, writer: (await AppData.folderSync.status()).writerId
            }));
            assert.deepEqual(after, before);
            assert(await a.evaluate(() => AppData.practice.get('browser-restart-queued')));
        } finally {
            await context?.close();
            if (path.dirname(profile) !== path.join(root, 'developer/doc') || !path.basename(profile).startsWith('onedrive-sync-resume-profile-')) throw Error('Unsafe profile cleanup');
            fs.rmSync(profile, { recursive: true, force: true });
        }
    });
});

test('returning first click is retained during slow startup and during an active permission check', async () => {
    await fixture(async ({ page, load }) => {
        for (const phase of ['startup', 'worker', 'security']) {
            const a = await page(); await installTransport(a); await projectDirectory(a);
            await a.evaluate(() => FolderSyncService.connect());
            await a.evaluate(() => { FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt'; });
            await complete(a, 'first-click-' + phase);
            await a.reload(); await load(a);
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncFolderAdapter.js'), 'utf8') });
            await a.evaluate(phase => {
                window.__permission = 'prompt'; window.__requests = 0;
                const original = SyncFolderAdapter;
                window.SyncFolderAdapter = { ...original,
                    async binding(value) {
                        if (phase === 'startup' && value === undefined && !window.__startupReleased)
                            await new Promise(resolve => { window.__releaseStartup = () => { window.__startupReleased = true; resolve(); }; });
                        return original.binding(value);
                    },
                    async permission() {
                        if (window.__holdWorker) { window.__checking = true; await new Promise(resolve => { window.__releaseWorker = resolve; }); }
                        return window.__permission;
                    },
                    requestPermission() {
                        window.__requests++;
                        if (!navigator.userActivation.isActive) return Promise.reject(new DOMException('activation required', 'SecurityError'));
                        if (phase === 'security' && window.__requests === 1) return Promise.reject(new DOMException('activation expired', 'SecurityError'));
                        window.__permission = 'granted'; return Promise.resolve('granted');
                    }
                };
                const button = document.createElement('button'); button.id = 'first-click'; button.textContent = '做题'; document.body.append(button);
            }, phase);
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncService.js'), 'utf8') });
            if (phase === 'startup') {
                await a.waitForFunction(() => !!window.__releaseStartup);
                await a.locator('#first-click').click();
                await a.evaluate(() => __releaseStartup());
            } else if (phase === 'worker') {
                await a.evaluate(() => FolderSyncService.init());
                await a.waitForFunction(() => !FolderSyncService.getStatus().busy);
                await a.evaluate(() => { window.__holdWorker = true; window.__worker = FolderSyncService.syncNow(); });
                await a.waitForFunction(() => !!window.__checking);
                await a.locator('#first-click').click();
                await a.evaluate(() => { window.__holdWorker = false; __releaseWorker(); });
            } else {
                await a.evaluate(() => FolderSyncService.init());
                await a.waitForFunction(() => !FolderSyncService.getStatus().busy);
                await a.locator('#first-click').click();
                await a.waitForFunction(() => __requests === 1);
                await a.locator('#first-click').click();
            }
            await a.waitForFunction(expected => __requests === expected && !FolderSyncService.getStatus().initializing
                && !FolderSyncService.getStatus().busy && FolderSyncService.getStatus().pending === 0, phase === 'security' ? 2 : 1);
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().permission), 'granted');
            assert(await a.evaluate(id => AppData.practice.get(id), 'first-click-' + phase));
        }
    });
});
