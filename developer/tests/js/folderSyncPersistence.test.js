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
    async function page() {
        const context = await browser.newContext(); contexts.push(context);
        const page = await context.newPage(); await page.goto(origin); await load(page); return page;
    }
    try { await task({ page, load }); }
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
                    pick: () => navigator.storage.getDirectory(), permission: async () => window.__denySyncPermission ? 'prompt' : 'granted' });
            });
            await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncService.js'), 'utf8') });
            if (create) await page.evaluate(() => FolderSyncService.connect(true));
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
        await a.evaluate(() => FolderSyncService.syncNow());
        assert.equal((await pending(a)).length, 0);
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
