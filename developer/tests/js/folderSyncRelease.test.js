import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('built release: file and HTTP pages keep working; HTTP folder sync starts from its real UI', async () => {
    const server = http.createServer((request, response) => {
        const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const target = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) { response.writeHead(404); response.end(); return; }
        const type = target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.html') ? 'text/html' : 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type }); fs.createReadStream(target).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
        for (const base of [pathToFileURL(path.join(root, 'index.html')).href, 'http://127.0.0.1:' + server.address().port + '/']) {
            const context = await browser.newContext();
            const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
            if (base.startsWith('http')) await page.addInitScript(() => {
                // Only the chooser is substituted; permission, IDB, FileSystem APIs and bundles are production code.
                window.showDirectoryPicker = async () => {
                    const dir = await navigator.storage.getDirectory();
                    for (const name of ['index.html', 'ONEDRIVE_SYNC.md']) await dir.getFileHandle(name, { create: true });
                    for (const name of ['js', 'css']) await dir.getDirectoryHandle(name, { create: true });
                    return dir;
                };
            });
            await page.goto(base + '?view=settings&test_env=1');
            await page.waitForFunction(() => window.AppData && window.app?.isInitialized);
            await page.evaluate(() => AppData.ready);
            await page.locator('#license-modal.show .lm-btn').click();
            await page.waitForFunction(() => !document.getElementById('license-modal').classList.contains('show'));
            await page.locator('button[data-view="settings"]').click();
            await page.locator('#folder-sync-entry-btn').click();
            assert(await page.locator('#folder-sync-modal').isVisible());
            const supported = await page.evaluate(() => FolderSyncService.getStatus().supported);
            assert(await page.locator('#folder-sync-enable-btn').isEnabled() === supported);
            if (base.startsWith('file')) {
                // file:// cannot use OPFS as a test transport. Simulate only the saved
                // native handle and denied permission; retain real bundles and AppData.
                await page.addInitScript(() => {
                    window.__fileRequests = 0;
                    let adapter;
                    Object.defineProperty(window, 'SyncFolderAdapter', {
                        configurable: true, get: () => adapter,
                        set(value) {
                            const originalBinding = value.binding;
                            adapter = { ...value, binding: async value => value === undefined ? {
                                name: 'Saved OneDrive', spaceId: 'file-startup-space', directory: {
                                    queryPermission: async () => 'prompt',
                                    requestPermission: async () => {
                                        if (!navigator.userActivation.isActive) throw new DOMException('activation required', 'SecurityError');
                                        window.__fileRequests++; return 'denied';
                                    }
                                }
                            } : originalBinding(value) };
                        }
                    });
                });
                await page.evaluate(async () => {
                    await AppData.folderSync.connect('file-startup-space');
                    await AppData.practice.completeAttempt({ operationId: 'file-startup-queued', record: {
                        id: 'file-startup-queued', type: 'reading', examId: 'file-exam', title: 'File startup recovery',
                        totalQuestions: 1, correctAnswers: 1, answers: { 1: 'yes' }
                    } });
                });
                await page.goto(base + '?view=overview&test_env=1');
                await page.locator('#folder-sync-startup-dialog').waitFor({ state: 'visible' });
                assert.equal(await page.evaluate(() => __fileRequests), 0, 'file startup presents recovery without a user click');
                assert.equal(await page.locator('#folder-sync-modal').count(), 0, 'file recovery never enters settings');
                assert(await page.locator('#overview-view').isVisible());
                const before = await page.evaluate(() => AppData.folderSync.pending());
                await page.locator('#folder-sync-startup-restore-btn').click();
                await page.waitForFunction(() => __fileRequests === 1 && !FolderSyncService.getStatus().recovering);
                assert((await page.locator('#folder-sync-startup-dialog .folder-sync-error').textContent()).includes('尚未获得'));
                assert.deepEqual(await page.evaluate(() => AppData.folderSync.pending()), before);
                await page.locator('#folder-sync-startup-later-btn').click();
                await page.locator('button[data-view="overview"]').click();
                assert.equal(await page.evaluate(() => __fileRequests), 1, 'deferring file recovery prevents another automatic request');
            }
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
            }
            await context.close();
        }
    } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
