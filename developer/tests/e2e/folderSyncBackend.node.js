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
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.addInitScript(() => {
            // Substitute only the user chooser, using an isolated real directory handle.
            window.showDirectoryPicker = () => navigator.storage.getDirectory();
        });
        const base = 'http://127.0.0.1:' + server.address().port;
        await page.goto(base + '/?view=settings&test_env=1');
        await page.waitForFunction(() => window.AppData && window.app?.isInitialized);
        await page.evaluate(() => AppData.ready);
        await page.locator('#license-modal.show .lm-btn').click();
        await page.waitForFunction(() => getComputedStyle(document.getElementById('license-modal')).opacity === '0');
        await page.locator('button[data-view="settings"]').click();
        await page.locator('#folder-sync-entry-btn').click();
        assert(await page.locator('#folder-sync-modal').isVisible());
        assert.equal((await page.request.get(base + '/css/folder-sync.css')).status(), 200);
        if (process.env.ONEDRIVE_SYNC_SCREENSHOT) {
            await page.screenshot({ path: path.resolve(process.env.ONEDRIVE_SYNC_SCREENSHOT) });
        }
        await page.locator('#folder-sync-create-btn').click();
        await page.waitForFunction(() => {
            const status = FolderSyncService.getStatus();
            return status.enabled && status.permission === 'granted' && status.lastPublishAt && !status.busy && !status.pending;
        });
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
        assert.equal((await page.request.get(base + '/user-data/workspace.json')).status(), 404);
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
