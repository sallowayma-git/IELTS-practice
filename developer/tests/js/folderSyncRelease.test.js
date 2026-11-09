import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { prepareLocalFileStorage, authorizeLocalFileStorage } from '../e2e/localFileStorageFixture.js';
const root = process.env.READING_RELEASE_ROOT
    ? path.resolve(process.env.READING_RELEASE_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('built release: file URLs require local storage; HTTP setup and sync permission recovery work', async () => {
    const server = http.createServer((request, response) => {
        const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) { response.writeHead(404); response.end(); return; }
        const type = target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.html') ? 'text/html' : 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type }); fs.createReadStream(target).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, args: ['--enable-experimental-web-platform-features'] });
    try {
        for (const base of [pathToFileURL(path.join(root, 'index.html')).href, 'http://127.0.0.1:' + server.address().port + '/']) {
            const context = await browser.newContext();
            await prepareLocalFileStorage(context, { automatic: false });
            const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
            if (base.startsWith('http')) await page.addInitScript(() => {
                // Only the chooser is substituted; permission, IDB, FileSystem APIs and bundles are production code.
                window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('sync-test', { create: true });
            });
            const home = base + '?view=overview&test_env=1';
            await page.goto(home);
            if (base.startsWith('file:')) {
                await page.getByRole('dialog', { name: '连接本地数据目录' }).waitFor();
                assert.equal(await page.evaluate(() => FileJournal.status().backend), 'needs-directory');
                assert.equal(await page.evaluate(() => AppData.status().state), 'initializing');
                await authorizeLocalFileStorage(page);
            }
            await page.waitForFunction(() => window.AppData && window.app?.isInitialized);
            await page.evaluate(() => AppData.ready);
            assert.equal(await page.evaluate(() => AppData.status().backend), base.startsWith('file:') ? 'directory-json' : 'opfs-json');
            await page.evaluate(() => AppData.practice.completeAttempt({ operationId: 'local-release-save', record: {
                id: 'local-release-save', type: 'reading', examId: 'local-release', totalQuestions: 1, correctAnswers: 1
            } }));
            await page.reload(); await authorizeLocalFileStorage(page);
            await page.waitForFunction(() => window.app?.isInitialized);
            assert(await page.evaluate(() => AppData.practice.get('local-release-save')));
            await page.locator('#license-modal.show .lm-btn').click();
            await page.waitForFunction(() => !document.getElementById('license-modal').classList.contains('show'));
            await page.waitForFunction(() => !FolderSyncService.getStatus().initializing);
            assert.equal(await page.evaluate(() => FolderSyncService.getStatus().enabled), false);
            assert.equal(await page.locator('#folder-sync-startup-dialog').count(), 0);
            for (const view of ['overview', 'browse', 'practice', 'more']) {
                await page.locator('button[data-view="' + view + '"]').click();
                await page.locator('#' + view + '-view').waitFor({ state: 'visible' });
                assert.equal(await page.locator('#folder-sync-entry-btn').isVisible(), false);
                assert.equal(await page.locator('#folder-sync-modal').count(), 0);
            }
            await page.locator('button[data-view="settings"]').click();
            await page.locator('#folder-sync-entry-btn').click();
            assert(await page.locator('#folder-sync-modal').isVisible());
            const supported = await page.evaluate(() => FolderSyncService.getStatus().supported);
            assert(await page.locator('#folder-sync-enable-btn').isEnabled() === supported);
            if (base.startsWith('http')) {
                assert(supported);
                await page.locator('#folder-sync-enable-btn').click();
                await page.waitForFunction(() => FolderSyncService.getStatus().enabled && FolderSyncService.getStatus().permission === 'granted');
                await page.waitForFunction(() => {
                    const status = FolderSyncService.getStatus();
                    return !status.busy && status.pending === 0;
                });
                const previousPublish = await page.evaluate(() => FolderSyncService.getStatus().lastPublishAt);
                await page.evaluate(() => AppData.practice.completeAttempt({ operationId: 'built-record', record: {
                    id: 'built-record', type: 'reading', title: 'Compiled bundle sync', examId: 'built-exam',
                    totalQuestions: 1, correctAnswers: 1, answers: { 1: 'yes' }
                } }));
                // Exercise commit-triggered automatic publication, without invoking syncNow.
                await page.waitForFunction(previous => {
                    const status = FolderSyncService.getStatus();
                    return status.lastPublishAt !== previous && !status.busy && status.pending === 0;
                }, previousPublish, { timeout: 15000 });
                const stored = await page.evaluate(async () => {
                    const binding = await SyncFolderAdapter.binding();
                    const ops = await SyncFolderAdapter.workspace(binding);
                    let found = false; const files = [];
                    for await (const dir of ops.values()) if (dir.kind === 'directory') {
                        for await (const entry of dir.values()) if (entry.kind === 'file') {
                            const text = await (await entry.getFile()).text(); files.push({ name: entry.name, bytes: text.length, preview: text.slice(0, 350) });
                            if (text.includes('built-record')) found = true;
                        }
                    }
                    return { found, files, status: FolderSyncService.getStatus(), practice: await AppData.practice.get('built-record'), pending: await AppData.folderSync.pending() };
                });
                assert(stored.found, 'the built app should automatically publish a completed attempt: ' + JSON.stringify(stored));
                await page.goto(home);
                await page.waitForFunction(() => window.FolderSyncService?.getStatus().completedSyncs > 0);
                assert.equal(await page.locator('#folder-sync-startup-dialog').count(), 0,
                    'a saved grant resumes without a recovery dialog');

                // Recreate a session grant expiring. The saved handle and disk writes remain real OPFS.
                await page.evaluate(async () => {
                    FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt';
                    await AppData.practice.completeAttempt({ operationId: 'resume-record', record: {
                        id: 'resume-record', type: 'reading', examId: 'resume-exam',
                        totalQuestions: 1, correctAnswers: 1, answers: { 1: 'yes' }
                    } });
                });
                await page.addInitScript(() => {
                    let permission = 'prompt';
                    window.__startupRequests = 0;
                    FileSystemDirectoryHandle.prototype.queryPermission = async () => permission;
                    FileSystemDirectoryHandle.prototype.requestPermission = () => {
                        if (!navigator.userActivation.isActive) throw new DOMException('activation required', 'SecurityError');
                        window.__startupRequests++;
                        permission = 'granted';
                        return Promise.resolve(permission);
                    };
                });
                await page.goto(home);
                const recovery = page.getByRole('dialog', { name: /恢复 OneDrive 同步/ });
                await recovery.waitFor();
                assert.equal(await page.evaluate(() => window.__startupRequests), 0);
                assert.equal(await page.evaluate(async () => (await AppData.folderSync.pending()).length), 1);
                await recovery.getByRole('button', { name: '恢复同步' }).click();
                await recovery.waitFor({ state: 'detached' });
                await page.waitForFunction(() => {
                    const status = FolderSyncService.getStatus();
                    return !status.recovering && status.permission === 'granted' && status.pending === 0;
                });
                assert.equal(await page.evaluate(() => window.__startupRequests), 1);
            }
            await context.close();
        }
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('every shipped data entry includes file persistence before the kernel', () => {
    let entries = 0;
    for (const name of fs.readdirSync(path.join(root, 'js/bundles'))) {
        const source = fs.readFileSync(path.join(root, 'js/bundles', name), 'utf8');
        const kernel = source.indexOf('(function installDataKernel');
        if (kernel < 0) continue;
        entries++;
        const files = source.indexOf('(function installFileJournal');
        assert(files >= 0 && files < kernel, name + ' must not bypass local files');
    }
    assert.equal(entries, 5);
});
