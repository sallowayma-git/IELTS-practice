import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sources = ['js/data/v2/dataCatalog.js', 'js/data/v2/syncModel.js', 'js/data/v2/dataKernel.js',
    'js/data/practiceRecordSource.js', 'js/core/vocabScheduler.js', 'js/core/practiceReviewScheduler.js',
    'js/data/v2/readingVocabularyModel.js', 'js/data/v2/readingViewCache.js', 'js/data/v2/appData.js'];
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
    async function page(loadSources = true) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(origin);
        if (loadSources) await load(page);
        return page;
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
test('listening and suite attempts retain answers while device addresses stay local', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page();
        await connect(a); await connect(b);
        await a.evaluate(async () => {
            const localUrl = 'file:///synthetic-private-folder/exam.html';
            await AppData.practice.completeAttempt({
                record: { id: 'listen', examId: 'listening-one', type: 'listening', totalQuestions: 2,
                    correctAnswers: 1, answers: { 1: 'blue' }, url: localUrl }
            });
            await AppData.practice.completeAttempt({
                record: { id: 'suite', examId: 'suite-one', type: 'suite', totalQuestions: 2,
                    correctAnswers: 1, suiteEntries: [
                        { examId: 'reading-one', type: 'reading', answers: { 1: 'true' }, url: localUrl },
                        { examId: 'listening-one', type: 'listening', answers: { 1: 'blue' }, url: localUrl }
                    ] }
            });
        });
        assert(!JSON.stringify(await pending(a)).includes('synthetic-private-folder'));
        await send(a, b);
        const listening = await b.evaluate(() => AppData.practice.get('listen'));
        const suite = await b.evaluate(() => AppData.practice.get('suite'));
        assert.equal(listening.answers[1], 'blue');
        assert.equal(listening.url, undefined);
        assert.deepEqual(suite.suiteEntries.map(entry => entry.answers[1]), ['true', 'blue']);
        assert(suite.suiteEntries.every(entry => entry.url === undefined));
        await b.evaluate(() => AppData.practice.updateAnnotations({ recordId: 'listen', patch: { noteText: 'reviewed' } }));
        await send(b, a);
        const local = await a.evaluate(() => AppData.practice.get('listen'));
        assert.equal(local.noteText, 'reviewed');
        assert.equal(local.url, 'file:///synthetic-private-folder/exam.html');
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
            if (create) await page.evaluate(() => { window.confirm = () => true; return FolderSyncService.connect(); });
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
        await b.evaluate(() => FolderSyncService.connect());
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
test('real vocabulary: offline collections preserve graph, mirrors and later removals', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page(); await connect(a); await connect(b);
        assert.deepEqual(await pending(a), [], 'the empty migrated reading model is not an edit');
        await send(a, b); await send(b, a);
        const collect = (page, word, at) => page.evaluate(({ word, at }) => AppData.vocab.mutateReading('collect', {
            source: { kind: 'builtin', id: 'default' }, article: { examId: 'vocab-article', title: 'Vocabulary article' },
            word: { word, meaning: 'Definition of ' + word }, at,
            occurrence: { scopeId: 'passage', contentVersion: 'v1', startOffset: 0, endOffset: word.length, quote: word }
        }, { operationId: 'collect-' + word }), { word, at });
        await collect(a, 'apple', '2026-11-08T02:00:00.000Z');
        await collect(b, 'banana', '2026-11-08T02:01:00.000Z');
        await send(a, b); await send(b, a);
        const read = page => page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
        const left = await read(a), right = await read(b);
        assert.equal(left.reading.terms.length, 2);
        assert.equal(right.reading.terms.length, 2);
        assert.equal((await a.evaluate(() => AppData.folderSync.status())).conflicts.length, 0);
        assert.equal(left.reading.associations.length, 2);
        assert.equal(left.reading.occurrences.length, 2);
        const shelf = page => page.evaluate(() => AppData.vocab.getReadingBookshelf());
        const populated = await shelf(b);
        await a.evaluate(() => AppData.vocab.mutateReading('clearArticle', {
            articleId: ReadingVocabularyModel.articleId({ kind: 'builtin', id: 'default' }, 'vocab-article'),
            at: '2026-11-08T03:00:00.000Z'
        }, { operationId: 'clear-reading-article' }));
        await send(a, b);
        assert.equal((await read(b)).reading.associations.length, 0);
        assert.notDeepEqual(await shelf(b), populated, 'receiving changes invalidates the reading view cache');
        const after = await pending(b);
        await send(a, b); assert.equal((await pending(b)).length, after.length);
    });
});
test('real review plans: causal review sync is stable; concurrent outcomes stay separate', async () => {
    await fixture(async ({ page }) => {
        const a = await page(), b = await page(); await connect(a); await connect(b);
        await complete(a, 'reviewable'); await send(a, b); await send(b, a);
        const initial = await b.evaluate(() => AppData.practice.getReviewState('reviewable'));
        assert(initial, 'half-score completion should have a review plan');
        const review = (page, quality, id) => page.evaluate(({ quality, id }) => AppData.practice.recordReviewOutcome({
            recordId: 'reviewable', quality, reviewAttemptId: id, reviewedAt: '2026-11-09T01:00:00.000Z', operationId: id
        }), { quality, id });
        await review(a, 'good', 'review-A'); await review(b, 'hard', 'review-B');
        await send(a, b); await send(b, a);
        const status = await a.evaluate(() => AppData.folderSync.status());
        const conflict = status.conflicts.find(item => item.key.startsWith('practice.reviewPlans/'));
        assert(conflict, 'concurrent SM-2 outcomes must not be blended');
        const chosen = conflict.versions[0];
        await a.evaluate(({ key, headId }) => AppData.folderSync.resolve(key, headId), { key: conflict.key, headId: chosen.id });
        await send(a, b);
        assert.deepEqual(await a.evaluate(() => AppData.practice.getReviewState('reviewable')),
            await b.evaluate(() => AppData.practice.getReviewState('reviewable')));
        assert.equal((await b.evaluate(() => AppData.practice.list())).length, 1);
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

test('dedicated directory initialization and joining preserve compatible markers and reject older spaces', async () => {
    await fixture(async ({ page }) => {
        const a = await page(); await installTransport(a);
        const result = await a.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle('user-data', { create: true });
            const read = async handle => (await (await handle.getFileHandle('workspace.json')).getFile()).text();
            const write = async (handle, content) => {
                const stream = await (await handle.getFileHandle('workspace.json', { create: true })).createWritable();
                await stream.write(content);
                await stream.close();
            };
            const refuse = () => { throw new Error('should not confirm an existing space'); };
            const refused = await SyncFolderAdapter.openWorkspace(dir, () => false).then(() => false, () => true);
            const first = await SyncFolderAdapter.openWorkspace(dir, () => true);
            const original = await read(dir);
            const direct = await SyncFolderAdapter.openWorkspace(dir, refuse);
            const fromParent = await SyncFolderAdapter.openWorkspace(root, refuse);
            const arriving = await root.getDirectoryHandle('arriving', { create: true });
            const arrived = await SyncFolderAdapter.openWorkspace(arriving, async () => {
                await write(arriving, original);
                return true;
            });
            const rejected = [];
            for (const [index, marker] of ['', '{', JSON.stringify({
                format: 'ielts-atlas-folder-sync', version: 1, spaceId: first.spaceId
            })].entries()) {
                const old = await root.getDirectoryHandle('old-' + index, { create: true });
                await write(old, marker);
                const error = await SyncFolderAdapter.openWorkspace(old, refuse).catch(error => error.message);
                rejected.push(typeof error === 'string' && !error.includes('should not confirm') && await read(old) === marker);
            }
            const partial = await root.getDirectoryHandle('partial', { create: true });
            await partial.getDirectoryHandle('sync-v1', { create: true });
            const error = await SyncFolderAdapter.openWorkspace(partial, refuse).catch(error => error.message);
            return { refused, spaceId: first.spaceId, direct: direct.spaceId, parent: fromParent.spaceId,
                arrived: arrived.spaceId, unchanged: await read(dir) === original, rejected, partial: /已有内容/.test(error) };
        });
        assert(result.refused && result.unchanged && result.partial && result.rejected.every(Boolean));
        assert.equal(result.direct, result.spaceId);
        assert.equal(result.parent, result.spaceId);
        assert.equal(result.arrived, result.spaceId);
    });
});

test('disconnect retains the old queue until the same space reconnects', async () => {
    await fixture(async ({ page }) => {
        const a = await page();
        await connect(a);
        await complete(a, 'pending-before-disconnect');
        await a.evaluate(() => AppData.folderSync.disconnect());
        const before = await pending(a);
        await assert.rejects(() => a.evaluate(() => AppData.folderSync.connect('other-space')), /原空间仍有未写入/);
        assert.deepEqual(await pending(a), before);
        await complete(a, 'changed-while-disconnected');
        await connect(a);
        assert.equal((await pending(a)).length, before.length + 1);
    });
});
async function resetHarness(page, { pause = false } = {}) {
    await page.evaluate(pause => {
        window.AppDiagnosticStore = { withFullReset: task => task() };
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
        const a = await page(); await installTransport(a);
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
            const a = await page(); await installTransport(a);
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
            await a.waitForFunction(() => !FolderSyncService.getStatus().initializing && !FolderSyncService.getStatus().busy);
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().enabled), true);
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().initializing), false);
            assert.equal(await a.evaluate(() => __requests), 0, 'no unsolicited prompt without activation');
            await a.evaluate(() => document.getElementById('start-practice').click());
            assert.equal(await a.evaluate(() => __requests), 0, 'synthetic clicks do not request access');
            await a.locator('#start-practice').click();
            await a.waitForFunction(() => __requests === 1 && !FolderSyncService.getStatus().busy);
            await a.locator('#start-practice').click();
            assert.equal(await a.evaluate(() => __requests), 1, 'at most one automatic request per visit');
            if (granted) await a.waitForFunction(() => !FolderSyncService.getStatus().initializing && !FolderSyncService.getStatus().busy && FolderSyncService.getStatus().pending === 0);
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
            await installTransport(a); await a.evaluate(() => FolderSyncService.connect());
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
            const a = await page(); await installTransport(a);
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

test('saved binding starts and publishes before DOMContentLoaded without opening settings', async () => {
    await fixture(async ({ page, load, origin }) => {
        const a = await page(); await installTransport(a);
        await a.evaluate(() => FolderSyncService.connect());
        await a.evaluate(() => { FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt'; });
        await complete(a, 'before-dom-ready');
        let release;
        await a.route('**/startup-hold.js', route => new Promise(resolve => {
            release = () => route.fulfill({ contentType: 'text/javascript', body: '' }).then(resolve);
        }));
        await a.route('**/startup-page', route => route.fulfill({ contentType: 'text/html',
            body: '<!doctype html><body><h1>Home</h1><script src="/startup-hold.js"></script>' }));
        try {
            await a.goto(origin + '/startup-page', { waitUntil: 'commit' });
            await a.waitForFunction(() => document.querySelector('h1'));
            await load(a);
            // Do not call init(), syncNow(), connect() or any settings entry on this visit.
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncFolderAdapter.js'), 'utf8') });
            await a.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/services/syncService.js'), 'utf8') });
            await a.waitForFunction(() => !FolderSyncService.getStatus().initializing
                && FolderSyncService.getStatus().completedSyncs > 0 && FolderSyncService.getStatus().pending === 0);
            assert.equal(await a.evaluate(() => document.readyState), 'loading');
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().permission), 'granted');
            assert(await a.evaluate(() => AppData.practice.get('before-dom-ready')));
        } finally { if (release) await release(); }
    });
});

test('ordinary pointer and keyboard interactions restore once, including permission loss after setup', async () => {
    await fixture(async ({ page }) => {
        for (const input of ['pointer', 'keyboard']) {
            const a = await page(); await installTransport(a);
            await a.evaluate(() => FolderSyncService.connect());
            await a.evaluate(async () => {
                window.__permission = 'prompt'; window.__requests = 0;
                FileSystemDirectoryHandle.prototype.queryPermission = async () => __permission;
                FileSystemDirectoryHandle.prototype.requestPermission = () => {
                    if (!navigator.userActivation.isActive) return Promise.reject(new DOMException('activation required', 'SecurityError'));
                    window.__requests++;
                    return new Promise(resolve => { window.__grant = () => resolve(window.__permission = 'granted'); });
                };
                const button = document.createElement('button'); button.id = 'home-action'; button.textContent = 'Home';
                document.body.append(button);
                await FolderSyncService.syncNow();
            });
            await complete(a, 'ordinary-' + input);
            if (input === 'pointer') {
                await a.locator('#home-action').hover(); await a.mouse.down();
            } else {
                await a.locator('#home-action').focus(); await a.keyboard.down('Enter');
            }
            await a.waitForFunction(() => __requests === 1 && FolderSyncService.getStatus().recovering);
            await a.evaluate(() => __grant());
            await a.waitForFunction(() => !FolderSyncService.getStatus().recovering && !FolderSyncService.getStatus().busy
                && FolderSyncService.getStatus().pending === 0);
            if (input === 'pointer') await a.mouse.up(); else await a.keyboard.up('Enter');
            assert.equal(await a.evaluate(() => __requests), 1, 'the trailing click does not duplicate the request');
            assert.equal(await a.evaluate(() => FolderSyncService.getStatus().permission), 'granted');
        }
    });
});
