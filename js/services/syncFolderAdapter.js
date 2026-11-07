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
    async function openWorkspace(selected, create) {
        let dir = selected;
        try {
            const direct = assertWorkspace(await readJson(dir, 'workspace.json'));
            return { directory: dir, spaceId: direct.spaceId, name: selected.name, existing: true };
        } catch (error) { if (error.name !== 'NotFoundError') throw error; }
        dir = selected.name === 'user-data' ? selected : await selected.getDirectoryHandle('user-data', { create });
        try {
            const existing = assertWorkspace(await readJson(dir, 'workspace.json'));
            return { directory: dir, spaceId: existing.spaceId, name: selected.name + '/user-data', existing: true };
        } catch (error) { if (error.name !== 'NotFoundError') throw error; }
        if (!create) throw new Error('未发现 workspace.json，请等待 OneDrive 下载完成，或在第一台电脑创建同步空间');
        // Explicit bootstrap only; new/empty folders are never interpreted as remote deletions.
        const workspace = { format: model.FORMAT, version: model.VERSION, spaceId: model.uuid(), createdAt: new Date().toISOString() };
        await writeJson(dir, 'workspace.json', workspace);
        return { directory: dir, spaceId: workspace.spaceId, name: selected.name + (selected.name === 'user-data' ? '' : '/user-data'), existing: false };
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
        openWorkspace, workspace, publish, scan, clearCache() { cache.clear(); } });
})(typeof window !== 'undefined' ? window : globalThis);
