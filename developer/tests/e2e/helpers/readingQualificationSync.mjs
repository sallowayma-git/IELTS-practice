import assert from 'node:assert/strict';
import { openHost } from './readingQualification.mjs';

export const syncEnabled = process.env.READING_QUALIFICATION_SYNC === '1';
export async function configureSyncContext(context) {
    if (!syncEnabled) return;
    await context.addInitScript(() => {
        window.confirm = () => true;
        Object.defineProperty(window, 'SyncFolderAdapter', { configurable: true, set(adapter) {
            // Only chooser/permission are substituted. Real directory handles,
            // operation files, checksums, scans, outbox and IndexedDB are retained.
            Object.defineProperty(window, 'SyncFolderAdapter', { configurable: true, writable: true, value: Object.freeze({
                ...adapter,
                pick: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('qualification-sync', { create: true }),
                permission: async () => 'granted', requestPermission: async () => 'granted'
            }) });
        } });
    });
}
async function copyFiles(from, to) {
    const files = await from.evaluate(async () => {
        const files = [];
        async function walk(directory, prefix = '') {
            for await (const item of directory.values()) {
                if (item.kind === 'directory') await walk(item, prefix + item.name + '/');
                else files.push({ path: prefix + item.name, text: await (await item.getFile()).text() });
            }
        }
        await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('qualification-sync'));
        return files;
    });
    await to.evaluate(async files => {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('qualification-sync', { create: true });
        for (const file of files) {
            let directory = root;
            const parts = file.path.split('/');
            for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
            const handle = await directory.getFileHandle(parts.at(-1), { create: true });
            const writer = await handle.createWritable(); await writer.write(file.text); await writer.close();
        }
    }, files);
    return files.length;
}
async function flush(page) {
    await page.evaluate(() => FolderSyncService.syncNow());
    assert.deepEqual(await page.evaluate(() => FolderSyncService.getStatus().errors), []);
}
export async function prepareSync(host, env) {
    if (!syncEnabled) return null;
    assert.equal(env.provenance.mode, 'http', 'OPFS compatibility transport requires a secure localhost origin');
    const peerContext = await env.browser.newContext();
    await configureSyncContext(peerContext);
    try {
        const peer = await openHost(peerContext, env);
        await host.evaluate(() => FolderSyncService.connect()); await flush(host);
        await copyFiles(host, peer); await peer.evaluate(() => FolderSyncService.connect());
        await peer.evaluate(() => AppData.vocab.patchConfig({ dailyNew: 55 })); await flush(peer);
        return {
            async incoming() {
                // Copy only at the caller's submission/recovery boundary, so
                // background polling cannot consume the operation beforehand.
                await copyFiles(peer, host);
                await flush(host);
                assert.equal(await host.evaluate(async () => (await AppData.vocab.getConfig()).dailyNew), 55);
            },
            async verify(recordId) {
                await flush(host); const files = await copyFiles(host, peer); await flush(peer);
                const first = await peer.evaluate(id => AppData.practice.get(id), recordId);
                const local = await host.evaluate(id => AppData.practice.get(id), recordId);
                assert.ok(first); assert.deepEqual(first.answers, local.answers);
                assert.equal(first.correctAnswers, local.correctAnswers);
                assert.deepEqual(first.suiteEntries.map(entry => entry.answers), local.suiteEntries.map(entry => entry.answers));
                await copyFiles(host, peer); await flush(peer); await copyFiles(peer, host); await flush(host);
                assert.deepEqual(await peer.evaluate(id => AppData.practice.get(id), recordId), first);
                assert.deepEqual(await host.evaluate(id => AppData.practice.get(id), recordId), local);
                const count = await peer.evaluate(async id => (await AppData.practice.list()).filter(row => row.id === id).length, recordId);
                assert.equal(count, 1);
                return { transport: 'simulated copy between isolated OPFS folders', files, peerCompletedRecords: count, duplicateReplayUnchanged: true };
            },
            close: () => peerContext.close()
        };
    } catch (error) { await peerContext.close(); throw error; }
}
