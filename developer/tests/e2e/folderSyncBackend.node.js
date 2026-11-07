import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Optional integration command: install both developer and backend lockfiles first.
const backend = createRequire(new URL('../../../backend/package.json', import.meta.url));
const { createApp } = backend('./src/app');
const { MemoryAuthStore } = backend('./src/auth');
const { MemoryPracticeRecordStore } = backend('./src/practiceRecords');
const { MemoryStore } = backend('express-session');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('backend HTTP entry serves a working opt-in folder-sync UI and publishes local commits', async () => {
    const app = createApp({
        repoRoot: root, authStore: new MemoryAuthStore(), practiceStore: new MemoryPracticeRecordStore(),
        sessionStore: new MemoryStore(), sessionSecret: 'folder-sync-isolated-integration-test-secret'
    });
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    let browser;
    try {
        const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
        browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
        const context = await browser.newContext({ viewport: { width: 1901, height: 908 } });
        const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
        await page.addInitScript(() => {
            // Substitute only the user chooser, using an isolated real directory handle.
            window.__pickerCalls = 0;
            window.showDirectoryPicker = async () => {
                    window.__pickerCalls++;
                    const dir = await navigator.storage.getDirectory();
                    for (const name of ['index.html', 'ONEDRIVE_SYNC.md']) await dir.getFileHandle(name, { create: true });
                    for (const name of ['js', 'css']) await dir.getDirectoryHandle(name, { create: true });
                    return dir;
                };
        });
        const base = 'http://127.0.0.1:' + server.address().port;
        await page.goto(base + '/?view=settings&test_env=1');
        await page.waitForFunction(() => window.AppData && window.app?.isInitialized);
        await page.evaluate(() => AppData.ready);
        await page.locator('#license-modal.show .lm-btn').click();
        await page.waitForFunction(() => getComputedStyle(document.getElementById('license-modal')).opacity === '0');
        const mainControls = () => page.evaluate(() => Array.from(document.querySelectorAll(
            'nav button, #overview-view h2, #overview-view h3, #overview-view button'
        ), node => node.textContent.trim()));
        const originalControls = await mainControls();
        assert.equal(await page.locator('#settings-view .data-management-panel #folder-sync-entry-btn').count(), 1);
        await page.locator('button[data-view="settings"]').click();
        await page.locator('#folder-sync-entry-btn').click();
        assert(await page.locator('#folder-sync-modal').isVisible());
        assert(await page.locator('#folder-sync-enable-btn').isVisible());
        assert(!(await page.locator('#folder-sync-sync-btn').isVisible()));
        assert(!(await page.locator('#folder-sync-disconnect-btn').isVisible()));
        assert(!(await page.locator('#folder-sync-permission-btn').isVisible()), 'unbound browsers have no recovery action');
        assert.equal((await page.request.get(base + '/css/folder-sync.css')).status(), 200);
        if (process.env.ONEDRIVE_SYNC_SCREENSHOT) {
            await page.screenshot({ path: path.resolve(process.env.ONEDRIVE_SYNC_SCREENSHOT) });
        }
        await page.locator('#folder-sync-enable-btn').click();
        await page.waitForFunction(() => {
            const status = FolderSyncService.getStatus();
            return status.enabled && status.permission === 'granted' && !status.busy && !status.pending;
        });
        assert(!(await page.locator('#folder-sync-enable-btn').isVisible()));
        assert(!(await page.locator('#folder-sync-permission-btn').isVisible()));
        assert(!(await page.locator('#folder-sync-setup-guide').isVisible()));
        assert((await page.locator('.folder-sync-status').textContent()).includes('自动同步已开启'));
        assert(await page.locator('#folder-sync-preferences').isEnabled());
        const previousPublish = await page.evaluate(() => FolderSyncService.getStatus().lastPublishAt);
        await page.evaluate(() => AppData.practice.completeAttempt({ operationId: 'backend-folder-record', record: {
            id: 'backend-folder-record', type: 'reading', examId: 'test-exam', title: 'Synthetic folder-sync record',
            totalQuestions: 1, correctAnswers: 1, answers: { 1: 'yes' }
        } }));
        await page.waitForFunction(previous => {
            const status = FolderSyncService.getStatus();
            return status.lastPublishAt !== previous && !status.pending && !status.busy;
        }, previousPublish);
        const published = await page.evaluate(async () => {
            const root = await SyncFolderAdapter.workspace(await SyncFolderAdapter.binding());
            let found = false;
            for await (const directory of root.values()) if (directory.kind === 'directory') {
                for await (const file of directory.values()) if (file.kind === 'file') {
                    const payload = JSON.parse(await (await file.getFile()).text());
                    if (payload.operation.changes.some(change => change.key === 'practice/backend-folder-record')) found = true;
                }
            }
            return found;
        });
        assert(published, 'a commit made on the backend-served page should publish without syncNow');
        await page.evaluate(() => {
            const show = window.showMessage;
            window.__syncNotices = [];
            window.showMessage = (text, type, duration) => {
                window.__syncNotices.push({ text, type }); return show(text, type, duration);
            };
        });
        const originalSpace = await page.evaluate(async () => (await SyncFolderAdapter.binding()).spaceId);
        await page.evaluate(async () => {
            // Simulate browser permission loss only. Worker, stored binding, queue and file writes remain real.
            window.__permission = 'prompt'; window.__permissionRequests = 0;
            FileSystemDirectoryHandle.prototype.queryPermission = async () => window.__permission;
            FileSystemDirectoryHandle.prototype.requestPermission = async () => {
                window.__permissionRequests++;
                return window.__grantRestore ? (window.__permission = 'granted') : 'denied';
            };
            await FolderSyncService.syncNow();
            await AppData.practice.completeAttempt({ operationId: 'paused-record', record: {
                id: 'paused-record', type: 'reading', examId: 'test-exam', title: 'Queued while paused',
                totalQuestions: 1, correctAnswers: 1, answers: { 1: 'yes' }
            } });
            await FolderSyncService.syncNow();
        });
        assert(await page.locator('#folder-sync-permission-btn').isVisible());
        assert((await page.locator('#folder-sync-permission-btn').textContent()).includes('恢复同步'));
        assert(!(await page.locator('#folder-sync-enable-btn').isVisible()));
        assert(!(await page.locator('#folder-sync-sync-btn').isEnabled()));
        assert((await page.locator('.folder-sync-status').textContent()).includes('同步已暂停'));
        assert.equal(await page.locator('#folder-sync-banner').count(), 0);
        assert((await page.locator('#message-container .message.warning .message-text').last().textContent()).includes('设置 → 数据管理'));
        assert.equal(await page.locator('#message-container button').count(), 0, 'shared notices add no sync shortcut');
        assert.equal(await page.evaluate(() => __syncNotices.length), 1);
        await page.evaluate(() => FolderSyncService.syncNow());
        assert.equal(await page.evaluate(() => __syncNotices.length), 1, 'unchanged attention does not repeat on polling');
        await page.locator('#folder-sync-modal .theme-modal-close').click();
        for (const view of ['overview', 'browse', 'practice', 'more']) {
            await page.locator('button[data-view="' + view + '"]').click();
            await page.waitForFunction(view => document.getElementById(view + '-view').classList.contains('active'), view);
            assert(!(await page.locator('#folder-sync-entry-btn').isVisible()), view + ' has no sync settings entry');
            assert(!(await page.locator('#folder-sync-modal').isVisible()));
            assert.equal(await page.getByRole('button', { name: '打开同步面板', exact: true }).count(), 0);
            assert.equal(await page.locator('#folder-sync-banner').count(), 0);
            if (view === 'overview' && process.env.ONEDRIVE_SYNC_OVERVIEW_SCREENSHOT) {
                await page.waitForFunction(() => document.querySelector('button[data-view="overview"]').classList.contains('active'));
                await page.screenshot({ path: path.resolve(process.env.ONEDRIVE_SYNC_OVERVIEW_SCREENSHOT), animations: 'disabled' });
            }
        }
        assert.deepEqual(await mainControls(), originalControls, 'original navigation and overview controls are unchanged');
        await page.locator('button[data-view="settings"]').click();
        assert((await page.locator('#folder-sync-entry-btn').textContent()).includes('已暂停'));
        await page.locator('#folder-sync-entry-btn').click();
        assert(await page.locator('#folder-sync-permission-btn').isVisible());
        const queued = await page.evaluate(() => AppData.folderSync.pending());
        assert(queued.some(op => op.changes.some(change => change.key === 'practice/paused-record')));
        await page.locator('#folder-sync-permission-btn').click();
        await page.waitForFunction(() => window.__permissionRequests === 1 && !document.getElementById('folder-sync-permission-btn').disabled);
        assert(await page.locator('#folder-sync-permission-btn').isVisible(), 'denial keeps recovery available');
        assert((await page.locator('.folder-sync-error').textContent()).includes('尚未获得'), 'denial is explained inside the settings panel');
        assert((await page.locator('#message-container .message.error .message-text').last().textContent()).includes('尚未获得'), 'action errors reuse disk backup notifications');
        assert.equal((await page.evaluate(() => AppData.folderSync.pending())).length, queued.length);
        await page.evaluate(() => { window.__grantRestore = true; });
        await page.locator('#folder-sync-permission-btn').click();
        await page.waitForFunction(() => {
            const status = FolderSyncService.getStatus();
            return status.permission === 'granted' && !status.busy && !status.pending;
        });
        assert(!(await page.locator('#folder-sync-permission-btn').isVisible()));
        assert((await page.locator('.folder-sync-status').textContent()).includes('自动同步已开启'));
        assert(await page.locator('#folder-sync-sync-btn').isEnabled());
        assert.equal(await page.locator('#folder-sync-banner').count(), 0);
        assert.equal(await page.locator('.folder-sync-error').textContent(), '');
        assert.equal(await page.evaluate(() => window.__pickerCalls), 1, 'restore reuses the bound folder');
        assert.equal(await page.evaluate(async () => (await SyncFolderAdapter.binding()).spaceId), originalSpace);
        await page.locator('#folder-sync-disconnect-btn').click();
        await page.waitForFunction(() => !FolderSyncService.getStatus().bound);
        assert(await page.locator('#folder-sync-enable-btn').isVisible());
        assert(await page.locator('#folder-sync-setup-guide').isVisible());
        assert(!(await page.locator('#folder-sync-permission-btn').isVisible()));
        assert(await page.evaluate(() => AppData.practice.get('paused-record')));
        await page.locator('#folder-sync-enable-btn').click();
        await page.waitForFunction(() => FolderSyncService.getStatus().bound && !FolderSyncService.getStatus().busy);
        assert.equal(await page.evaluate(async () => (await SyncFolderAdapter.binding()).spaceId), originalSpace);
        assert(!(await page.locator('#folder-sync-permission-btn').isVisible()));
        assert.equal((await page.request.get(base + '/user-data/workspace.json')).status(), 404);
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
