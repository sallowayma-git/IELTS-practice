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
            const page = await context.newPage();
            if (base.startsWith('http')) await page.addInitScript(() => {
                // Only the chooser is substituted; permission, IDB, FileSystem APIs and bundles are production code.
                window.showDirectoryPicker = () => navigator.storage.getDirectory();
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
            assert(await page.locator('#folder-sync-create-btn').isEnabled() === supported);
            if (base.startsWith('http')) {
                assert(supported);
                await page.locator('#folder-sync-create-btn').click();
                await page.waitForFunction(() => FolderSyncService.getStatus().enabled && FolderSyncService.getStatus().permission === 'granted');
                await page.waitForFunction(() => {
                    const status = FolderSyncService.getStatus();
                    return status.lastPublishAt && !status.busy && status.pending === 0;
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
