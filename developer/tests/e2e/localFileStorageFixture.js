import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium as nativeChromium } from 'playwright';

const init = fileURLToPath(new URL('./localFileStorageInit.js', import.meta.url));
const directories = new WeakMap();
const setups = new WeakMap();

export async function authorizeLocalFileStorage(page) {
    if (!page.url().startsWith('file:')) return;
    if (setups.has(page)) return setups.get(page);
    const work = (async () => {
        await page.waitForFunction(() => !window.FileJournal || ['needs-directory', 'directory-json', 'opfs-json'].includes(FileJournal.status().backend)
            || window.AppData?.status().state === 'failed', null, { timeout: 15000 });
        if (!await page.locator('#local-file-storage-dialog').count()) return;
        const directory = directories.get(page.context());
        if (!directory) throw new Error('Local directory fixture was not installed');
        await page.evaluate(() => { window.__testDirectoryDrop = true; });
        const session = await page.context().newCDPSession(page);
        try {
            for (const type of ['dragEnter', 'dragOver', 'drop']) {
                await session.send('Input.dispatchDragEvent', { type, x: 10, y: 10,
                    data: { items: [], files: [directory], dragOperationsMask: 1 } });
            }
        } finally { await session.detach(); }
        await page.getByRole('dialog', { name: '连接本地数据目录' }).getByRole('button').click();
        await page.locator('#local-file-storage-dialog').waitFor({ state: 'detached' });
        await page.evaluate(() => AppData.ready);
    })();
    setups.set(page, work);
    try { return await work; } finally { setups.delete(page); }
}

export async function prepareLocalFileStorage(context, { automatic = true } = {}) {
    if (directories.has(context)) return context;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-local-storage-test-'));
    directories.set(context, directory);
    await context.addInitScript({ path: init });
    if (automatic) context.on('page', page => page.on('domcontentloaded', () => {
        authorizeLocalFileStorage(page).catch(error => {
            if (!page.isClosed()) console.error('Local directory fixture failed:', error.message);
        });
    }));
    context.on('close', () => {
        if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('ielts-local-storage-test-')) {
            throw new Error('Unexpected local directory fixture path');
        }
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return context;
}

// Chromium headless shell has no native permission UI. Its experimental-platform
// test switch grants dragged directory handles; the production app still requires
// the explicit trusted click and saves the real handle in IndexedDB.
export const chromium = new Proxy(nativeChromium, {
    get(target, key) {
        if (key !== 'launch') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
        return async options => {
            const browser = await target.launch({ ...options,
                args: [...(options?.args || []), '--enable-experimental-web-platform-features'] });
            const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
            browser.newContext = async options => prepareLocalFileStorage(await newContext(options));
            browser.newPage = async options => {
                const page = await newPage(options);
                await prepareLocalFileStorage(page.context());
                page.on('domcontentloaded', () => authorizeLocalFileStorage(page).catch(error => {
                    if (!page.isClosed()) console.error('Local directory fixture failed:', error.message);
                }));
                return page;
            };
            return browser;
        };
    }
});
