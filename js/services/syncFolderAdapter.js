/* Local directory transport. OneDrive itself transports these files between computers. */
(function installSyncFolderAdapter(global) {
    'use strict';
    const model = global.FolderSyncModel;
    const DB = 'IELTSAtlasExternalBackupV2', STORE = 'binding', KEY = 'onedrive-sync-binding-v1';
    const MAX_BYTES = 32 * 1024 * 1024;
    const cache = new Map();
    function supported() { return global.isSecureContext !== false && typeof global.showDirectoryPicker === 'function' && !!global.navigator?.locks; }
    function pick() {
        if (!supported()) throw new Error('请使用桌面 Chrome / Edge；若直接打开文件不支持，请通过固定 localhost 地址打开');
        // Invoke before awaiting anything: directory selection needs the original click activation.
        return global.showDirectoryPicker({ id: 'ielts-atlas-onedrive-sync', mode: 'readwrite', startIn: 'documents' });
    }
    async function binding(value) {
        const db = await new Promise((resolve, reject) => {
            const request = global.indexedDB.open(DB, 1);
            request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            return await new Promise((resolve, reject) => {
                const write = value !== undefined;
                const tx = db.transaction(STORE, write ? 'readwrite' : 'readonly');
                const store = tx.objectStore(STORE);
                const request = write ? (value === null ? store.delete(KEY) : store.put(value, KEY)) : store.get(KEY);
                tx.oncomplete = () => resolve(write ? value : request.result || null);
                tx.onerror = tx.onabort = () => reject(tx.error || new Error('同步文件夹绑定保存失败'));
            });
        } finally { db.close(); }
    }
    async function resetBarrier(active) {
        const db = await new Promise((resolve, reject) => {
            const request = global.indexedDB.open('IELTSAtlasDataV2');
            let absent = false;
            request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
            request.onerror = () => absent ? resolve(null) : reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
        if (!db) return { enabled: false, pending: 0 };
        try {
            if (!db.objectStoreNames.contains('system')) return { enabled: false, pending: 0 };
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('system', 'readwrite');
                const store = tx.objectStore('system');
                const request = store.get(model.STATE_KEY);
                if (active) store.put({ logicalKey: 'system.folderSyncResetBarrier', active: true });
                else store.delete('system.folderSyncResetBarrier');
                tx.oncomplete = () => {
                    const state = request.result?.envelope?.data;
                    try {
                        if (request.result) model.assertState(state);
                        resolve(state ? model.status(state) : { enabled: false, pending: 0 });
                    }
                    catch (error) { reject(error); }
                };
                tx.onabort = tx.onerror = () => reject(tx.error || new Error('无法建立数据清理屏障'));
            });
        } finally { db.close(); }
    }
    function requestPermission(handle) {
        if (!handle?.requestPermission) return Promise.resolve('denied');
        return handle.requestPermission({ mode: 'readwrite' });
    }
    async function permission(handle) {
        if (!handle?.queryPermission) return 'denied';
        return handle.queryPermission({ mode: 'readwrite' });
    }
    async function parseFile(file) {
        if (!file.size || file.size > MAX_BYTES) throw new Error('同步文件为空或超过 32 MB，请保留文件并检查');
        const text = await file.text();
        let value;
        try { value = JSON.parse(text); } catch (_) { throw new Error('同步文件尚未完整下载或 JSON 损坏，将自动重试'); }
        model.safeJson(value);
        return value;
    }
    async function readJson(dir, name) {
        const handle = await dir.getFileHandle(name, { create: false });
        return parseFile(await handle.getFile());
    }
    async function writeJson(dir, name, value) {
        const text = JSON.stringify(value);
        if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('单条同步操作超过 32 MB，已保留待发送队列');
        const file = await dir.getFileHandle(name, { create: true });
        if (name === 'workspace.json' && (await file.getFile()).size) throw new Error('同步空间已出现，请重新连接；不会覆盖原有空间');
        const writer = await file.createWritable();
        try { await writer.write(text); await writer.close(); }
        catch (error) { try { await writer.abort(); } catch (_) { /* already closed */ } throw error; }
        const stored = await parseFile(await file.getFile());
        if (!model.equal(stored, value)) throw new Error('同步文件回读校验失败，稍后会重试');
    }
    function assertWorkspace(value, expected) {
        if (!value || value.format !== model.FORMAT || value.version !== model.VERSION || !model.identifier(value.spaceId)) {
            throw new Error('同步空间标记无效或版本不兼容，请更新所有电脑上的项目');
        }
        if (expected && value.spaceId !== expected) throw new Error('文件夹的数据空间标识已改变，请重新连接；本机记录仍然保留');
        return value;
    }
    async function openWorkspace(selected, confirmCreate = () => false) {
        const found = async dir => {
            try { return assertWorkspace(await readJson(dir, 'workspace.json')); }
            catch (error) { if (error.name !== 'NotFoundError') throw error; return null; }
        };
        const direct = await found(selected);
        if (direct) return { directory: selected, spaceId: direct.spaceId, name: selected.name, existing: true };
        let dir;
        if (selected.name === 'user-data') dir = selected;
        else {
            try { dir = await selected.getDirectoryHandle('user-data', { create: false }); }
            catch (error) { if (error.name !== 'NotFoundError') throw error; }
        }
        if (dir) {
            const existing = await found(dir);
            if (existing) return { directory: dir, spaceId: existing.spaceId, name: selected.name, existing: true };
            throw new Error('同步文件夹尚不完整，请等待 OneDrive 下载完成并设置“始终保留在此设备上”，然后重试。为保护原有数据，不会创建其他空间。');
        }
        // Only a complete project root without any sync directory can be initialized.
        for (const name of ['index.html', 'ONEDRIVE_SYNC.md']) await selected.getFileHandle(name, { create: false });
        for (const name of ['js', 'css']) await selected.getDirectoryHandle(name, { create: false });
        if (typeof confirmCreate !== 'function' || !await confirmCreate()) throw new Error('已取消初始化，本机学习记录仍保留');
        // Reinspect after confirmation: a folder arriving during the prompt is never overwritten.
        try {
            await selected.getDirectoryHandle('user-data', { create: false });
            return openWorkspace(selected, () => false);
        } catch (error) { if (error.name !== 'NotFoundError') throw error; }
        dir = await selected.getDirectoryHandle('user-data', { create: true });
        for await (const entry of dir.values()) throw new Error('同步目录已出现内容，请等待 OneDrive 下载完成后重试');
        const late = await found(dir);
        if (late) return { directory: dir, spaceId: late.spaceId, name: selected.name, existing: true };
        const workspace = { format: model.FORMAT, version: model.VERSION, spaceId: model.uuid(), createdAt: new Date().toISOString() };
        await writeJson(dir, 'workspace.json', workspace);
        return { directory: dir, spaceId: workspace.spaceId, name: selected.name + '/user-data', existing: false };
    }
    async function workspace(binding) {
        assertWorkspace(await readJson(binding.directory, 'workspace.json'), binding.spaceId);
        const version = await binding.directory.getDirectoryHandle('sync-v1', { create: true });
        const space = await version.getDirectoryHandle(binding.spaceId, { create: true });
        return space.getDirectoryHandle('ops', { create: true });
    }
    async function publish(root, operation) {
        model.validateOperation(operation);
        const folder = await root.getDirectoryHandle(operation.writerId, { create: true });
        const name = operation.id + '.json';
        const envelope = { format: model.FORMAT + '-file', version: model.VERSION, sha256: model.digest(operation), operation };
        let previous = null;
        try { previous = await folder.getFileHandle(name, { create: false }); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
        if (previous) {
            const file = await previous.getFile();
            let existing = null;
            try { existing = await parseFile(file); } catch (_) { /* an interrupted own write can be recovered */ }
            if (existing && model.equal(existing, envelope)) return;
            if (existing?.format === model.FORMAT + '-file' && existing.sha256 === model.digest(existing.operation)) {
                throw new Error('日志文件名已存在但内容不同，已保留队列：' + name);
            }
            // Only an own pending filename is repaired, preserving the incomplete bytes for recovery.
            const recovery = await folder.getFileHandle(name + '.incomplete-' + model.uuid() + '.txt', { create: true });
            const writer = await recovery.createWritable();
            try { await writer.write(await file.text()); await writer.close(); }
            catch (error) { try { await writer.abort(); } catch (_) { } throw error; }
        }
        await writeJson(folder, name, envelope);
    }
    async function scan(root, visit) {
        const errors = [];
        let files = 0;
        for await (const writer of root.values()) {
            if (writer.kind !== 'directory') continue;
            for await (const handle of writer.values()) {
                if (handle.kind !== 'file' || !/\.json$/i.test(handle.name)) continue;
                const path = writer.name + '/' + handle.name;
                try {
                    const file = await handle.getFile();
                    const signature = file.lastModified + ':' + file.size;
                    if (cache.get(path) === signature) continue;
                    const envelope = await parseFile(file);
                    if (envelope.format !== model.FORMAT + '-file' || envelope.version !== model.VERSION
                        || envelope.sha256 !== model.digest(envelope.operation)) throw new Error('同步日志摘要校验失败');
                    model.validateOperation(envelope.operation);
                    await visit(envelope.operation);
                    cache.set(path, signature); files++;
                } catch (error) { errors.push({ path, message: error.message }); }
            }
        }
        return { files, errors };
    }
    global.SyncFolderAdapter = Object.freeze({ supported, pick, binding, permission, requestPermission,
        openWorkspace, workspace, publish, scan, resetBarrier, clearCache() { cache.clear(); } });
})(typeof window !== 'undefined' ? window : globalThis);
