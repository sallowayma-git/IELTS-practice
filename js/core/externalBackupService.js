/**
 * V2 external disk backup adapter.
 *
 * The selected directory is not a DataKernel backend. Durable application
 * commits stay authoritative in AppData; this adapter writes portable v2
 * snapshots after the commit and isolates every filesystem failure.
 */
(function initExternalBackupService(global) {
    'use strict';

    if (global.ExternalBackupService && global.ExternalBackupService.__v2 === true) return;

    var DB_NAME = 'IELTSAtlasExternalBackupV2';
    var DB_VERSION = 1;
    var STORE_NAME = 'binding';
    var HANDLE_KEY = 'directory-handle';
    var META_KEY = 'metadata';
    var LATEST_FILENAME = 'ielts-atlas-backup-latest.json';
    var WRITE_DELAY_MS = 8000;
    var ENTRY_ID = 'external-backup-entry-btn';
    var MODAL_ID = 'external-backup-modal';

    var state = {
        ready: false,
        readyPromise: null,
        initialized: false,
        suspended: false,
        directoryHandle: null,
        permission: 'prompt',
        dirty: false,
        dirtyGeneration: 0,
        writing: false,
        writeQueue: Promise.resolve(),
        silentFlushTimer: null,
        unsubscribeCommitted: null,
        visibilityHandler: null,
        meta: {
            directoryName: null,
            lastWriteAt: null,
            lastChecksum: null,
            lastWriteError: null,
            awaitingRestore: false
        }
    };

    function nowIso() {
        return new Date().toISOString();
    }

    function dayKey(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function cloneMeta(value) {
        var source = value && typeof value === 'object' ? value : {};
        return {
            directoryName: source.directoryName ? String(source.directoryName) : null,
            lastWriteAt: source.lastWriteAt ? String(source.lastWriteAt) : null,
            lastChecksum: source.lastChecksum ? String(source.lastChecksum) : null,
            lastWriteError: source.lastWriteError ? String(source.lastWriteError) : null,
            awaitingRestore: source.awaitingRestore === true
        };
    }

    function getIndexedDB() {
        try {
            return global.indexedDB || null;
        } catch (_) {
            return null;
        }
    }

    function supportsFileSystemAccess() {
        return typeof global.showDirectoryPicker === 'function'
            && global.isSecureContext !== false;
    }

    function openBindingDb() {
        return new Promise(function (resolve, reject) {
            var indexedDb = getIndexedDB();
            if (!indexedDb) {
                reject(new Error('IndexedDB unavailable for directory binding'));
                return;
            }
            var request;
            try {
                request = indexedDb.open(DB_NAME, DB_VERSION);
            } catch (error) {
                reject(error);
                return;
            }
            request.onerror = function () {
                reject(request.error || new Error('Failed to open external backup binding database'));
            };
            request.onupgradeneeded = function (event) {
                var db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            request.onsuccess = function () {
                resolve(request.result);
            };
        });
    }

    async function readStoredValue(key) {
        var db = await openBindingDb();
        try {
            return await new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var request = tx.objectStore(STORE_NAME).get(key);
                request.onsuccess = function () { resolve(request.result); };
                request.onerror = function () { reject(request.error || tx.error); };
                tx.onabort = function () { reject(tx.error || new Error('Binding read transaction aborted')); };
            });
        } finally {
            try { db.close(); } catch (_) { /* ignore */ }
        }
    }

    async function writeStoredValues(values) {
        var db = await openBindingDb();
        try {
            await new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                Object.keys(values).forEach(function (key) {
                    store.put(values[key], key);
                });
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error || new Error('Binding write transaction failed')); };
                tx.onabort = function () { reject(tx.error || new Error('Binding write transaction aborted')); };
            });
        } finally {
            try { db.close(); } catch (_) { /* ignore */ }
        }
    }

    async function clearStoredBinding() {
        var db = await openBindingDb();
        try {
            await new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                store.delete(HANDLE_KEY);
                store.delete(META_KEY);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error || new Error('Binding clear transaction failed')); };
                tx.onabort = function () { reject(tx.error || new Error('Binding clear transaction aborted')); };
            });
        } finally {
            try { db.close(); } catch (_) { /* ignore */ }
        }
    }

    async function persistMeta(patch) {
        if (state.suspended) return false;
        state.meta = Object.assign({}, state.meta, cloneMeta(Object.assign({}, state.meta, patch || {})));
        try {
            await writeStoredValues((function () {
                var values = {};
                values[META_KEY] = state.meta;
                return values;
            })());
        } catch (error) {
            if (global.console && console.warn) console.warn('[ExternalBackup v2] metadata persistence failed:', error);
        }
        return true;
    }

    async function queryPermission(handle, mode) {
        if (!handle) return 'denied';
        try {
            if (typeof handle.queryPermission === 'function') {
                return await handle.queryPermission({ mode: mode || 'readwrite' });
            }
        } catch (_) { /* ignore */ }
        return 'prompt';
    }

    async function ensurePermission(handle, interactive) {
        var permission = await queryPermission(handle, 'readwrite');
        if (permission === 'granted') {
            state.permission = permission;
            return true;
        }
        if (!interactive) {
            state.permission = permission;
            return false;
        }
        try {
            if (typeof handle.requestPermission === 'function') {
                permission = await handle.requestPermission({ mode: 'readwrite' });
            }
        } catch (_) {
            permission = 'denied';
        }
        state.permission = permission;
        return permission === 'granted';
    }

    async function requestPersistentStorage() {
        try {
            var storage = global.navigator && global.navigator.storage;
            if (!storage || typeof storage.persist !== 'function') return false;
            if (typeof storage.persisted === 'function' && await storage.persisted()) return true;
            return await storage.persist();
        } catch (_) {
            return false;
        }
    }

    async function writeAndVerify(directoryHandle, filename, text, snapshot) {
        var fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
        var writable = await fileHandle.createWritable();
        try {
            await writable.write(text);
            await writable.close();
        } catch (error) {
            try { await writable.abort(); } catch (_) { /* ignore */ }
            throw error;
        }

        var file = await fileHandle.getFile();
        var storedText = await file.text();
        var stored;
        try {
            stored = JSON.parse(storedText);
        } catch (error) {
            throw new Error('Backup verification failed: written file is not valid JSON');
        }
        if (!stored || stored.format !== 'ielts-atlas-data-v2'
            || stored.schemaVersion !== snapshot.schemaVersion
            || stored.checksum !== snapshot.checksum) {
            throw new Error('Backup verification failed: snapshot metadata mismatch');
        }
        return storedText.length;
    }

    async function fileExists(directoryHandle, filename) {
        try {
            await directoryHandle.getFileHandle(filename, { create: false });
            return true;
        } catch (error) {
            if (error && error.name === 'NotFoundError') return false;
            throw error;
        }
    }

    function uniqueGenerationFilename(date) {
        var time = [
            String(date.getHours()).padStart(2, '0'),
            String(date.getMinutes()).padStart(2, '0'),
            String(date.getSeconds()).padStart(2, '0'),
            String(date.getMilliseconds()).padStart(3, '0')
        ].join('');
        return 'ielts-atlas-backup-' + dayKey(date) + '-' + time + '.json';
    }

    function requireBackupApi() {
        var backups = global.AppData && global.AppData.backups;
        if (!backups || typeof backups.export !== 'function'
            || typeof backups.previewImport !== 'function'
            || typeof backups.commitImport !== 'function') {
            throw new Error('AppData v2 backup API is unavailable');
        }
        return backups;
    }

    async function withDiskWriteLock(callback) {
        var previous = state.writeQueue.catch(function () {});
        var releaseCurrent;
        state.writeQueue = new Promise(function (resolve) {
            releaseCurrent = resolve;
        });
        await previous;
        try {
            var locks = global.navigator && global.navigator.locks;
            if (locks && typeof locks.request === 'function') {
                return await locks.request('ielts-atlas-external-backup-write', { mode: 'exclusive' }, callback);
            }
            return await callback();
        } finally {
            releaseCurrent();
        }
    }

    async function refreshStoredBindingForWrite() {
        if (state.suspended) return;
        var stored = await Promise.all([
            readStoredValue(HANDLE_KEY),
            readStoredValue(META_KEY)
        ]);
        state.directoryHandle = stored[0] || null;
        if (stored[1]) state.meta = cloneMeta(stored[1]);
        if (state.directoryHandle && !state.meta.directoryName) {
            state.meta.directoryName = state.directoryHandle.name || 'backup';
        }
    }

    async function writeToBoundDirectory(options) {
        var opts = options || {};
        await ensureReady();
        if (state.suspended) return { success: false, reason: 'suspended' };
        return withDiskWriteLock(async function () {
            if (state.suspended) return { success: false, reason: 'suspended' };
            if (state.writing) return { success: false, reason: 'busy' };
            try {
                await refreshStoredBindingForWrite();
            } catch (error) {
                return { success: false, reason: 'binding_unavailable', error: error };
            }
            if (!state.directoryHandle) return { success: false, reason: 'unbound' };
            if (state.meta.awaitingRestore && opts.allowOverwriteExisting !== true) {
                return { success: false, reason: 'restore_required' };
            }

            var startedGeneration = state.dirtyGeneration;
            var followupNeeded = false;
            state.writing = true;
            refreshPanel();
            try {
                if (!await ensurePermission(state.directoryHandle, opts.interactive === true)) {
                    await persistMeta({ lastWriteError: 'permission_denied' });
                    return { success: false, reason: 'permission_denied' };
                }

                var backups = requireBackupApi();
                var snapshot = await backups.export();
                if (!snapshot || snapshot.format !== 'ielts-atlas-data-v2' || !snapshot.checksum) {
                    throw new Error('AppData returned an invalid v2 backup snapshot');
                }
                if (!opts.force && snapshot.checksum === state.meta.lastChecksum) {
                    state.dirty = state.dirtyGeneration !== startedGeneration;
                    followupNeeded = state.dirty;
                    return { success: true, reason: 'unchanged', skipped: true, checksum: snapshot.checksum };
                }

                var text = JSON.stringify(snapshot, null, 2);
                var writeDate = new Date();
                var datedFilename = 'ielts-atlas-backup-' + dayKey(writeDate) + '.json';
                if (await fileExists(state.directoryHandle, datedFilename)) {
                    datedFilename = uniqueGenerationFilename(writeDate);
                }
                await writeAndVerify(state.directoryHandle, datedFilename, text, snapshot);
                var bytes = await writeAndVerify(state.directoryHandle, LATEST_FILENAME, text, snapshot);

                var latestSnapshot = await backups.export();
                var changedDuringWrite = state.dirtyGeneration !== startedGeneration
                    || !latestSnapshot || latestSnapshot.checksum !== snapshot.checksum;
                if (changedDuringWrite && state.dirtyGeneration === startedGeneration) {
                    state.dirtyGeneration += 1;
                }
                state.dirty = changedDuringWrite;
                followupNeeded = changedDuringWrite;
                await persistMeta({
                    directoryName: state.directoryHandle.name || state.meta.directoryName || 'backup',
                    lastWriteAt: nowIso(),
                    lastChecksum: snapshot.checksum,
                    lastWriteError: null
                });
                return {
                    success: true,
                    reason: 'written',
                    filename: LATEST_FILENAME,
                    generationFilename: datedFilename,
                    checksum: snapshot.checksum,
                    bytes: bytes,
                    followupPending: followupNeeded
                };
            } catch (error) {
                followupNeeded = state.dirtyGeneration !== startedGeneration;
                await persistMeta({ lastWriteError: error && error.message ? error.message : String(error) });
                if (global.console && console.error) console.error('[ExternalBackup v2] write failed:', error);
                return { success: false, reason: 'write_error', error: error };
            } finally {
                state.writing = false;
                if (followupNeeded && state.directoryHandle) scheduleSilentFlush();
                refreshPanel();
            }
        });
    }

    async function bindDirectory(options) {
        if (state.suspended) throw new Error('本地备份服务正在重置');
        if (!supportsFileSystemAccess()) {
            throw new Error('当前浏览器不支持绑定本地文件夹（请使用 Chrome/Edge 并通过 http(s) 或 localhost 打开）');
        }
        var handle = await global.showDirectoryPicker({
            id: 'ielts-atlas-external-backup',
            mode: 'readwrite',
            startIn: 'documents'
        });
        if (!handle) throw new Error('未选择文件夹');
        if (!await ensurePermission(handle, true)) throw new Error('未获得文件夹读写权限');

        var existingBackupFound = await fileExists(handle, LATEST_FILENAME);
        var meta = cloneMeta({
            directoryName: handle.name || 'backup',
            lastWriteAt: null,
            lastChecksum: null,
            lastWriteError: null,
            awaitingRestore: existingBackupFound
        });
        var values = {};
        values[HANDLE_KEY] = handle;
        values[META_KEY] = meta;
        await writeStoredValues(values);
        state.directoryHandle = handle;
        state.meta = meta;
        state.dirty = !existingBackupFound;
        state.dirtyGeneration += 1;
        await requestPersistentStorage();

        var writeResult = null;
        if (!existingBackupFound && (!options || options.writeNow !== false)) {
            writeResult = await writeToBoundDirectory({ interactive: true, force: true });
        }
        refreshPanel();
        return {
            directoryName: meta.directoryName,
            existingBackupFound: existingBackupFound,
            writeResult: writeResult
        };
    }

    function cancelSilentFlush() {
        if (state.silentFlushTimer) {
            global.clearTimeout(state.silentFlushTimer);
            state.silentFlushTimer = null;
        }
    }

    function clearBindingState() {
        state.directoryHandle = null;
        state.permission = 'prompt';
        state.dirty = false;
        state.dirtyGeneration += 1;
        state.meta = cloneMeta({});
        refreshPanel();
    }

    async function unbindDirectory() {
        cancelSilentFlush();
        await withDiskWriteLock(async function () {
            await clearStoredBinding();
            clearBindingState();
        });
        return true;
    }

    async function prepareForFullReset() {
        state.suspended = true;
        cancelSilentFlush();
        if (typeof state.unsubscribeCommitted === 'function') {
            try { state.unsubscribeCommitted(); } catch (_) { /* ignore */ }
        }
        state.unsubscribeCommitted = null;
        if (global.document && state.visibilityHandler) {
            try { global.document.removeEventListener('visibilitychange', state.visibilityHandler); } catch (_) { /* ignore */ }
        }
        state.visibilityHandler = null;
        state.initialized = false;

        await withDiskWriteLock(async function () {
            await clearStoredBinding();
            clearBindingState();
        });
        return {
            success: true,
            diskFilesPreserved: true,
            bindingCleared: true
        };
    }

    async function readLatestPayload(interactive) {
        await ensureReady();
        if (!state.directoryHandle) throw new Error('请先绑定备份文件夹');
        if (!await ensurePermission(state.directoryHandle, interactive === true)) {
            throw new Error('需要允许文件夹访问权限');
        }
        var fileHandle;
        try {
            fileHandle = await state.directoryHandle.getFileHandle(LATEST_FILENAME, { create: false });
        } catch (error) {
            throw new Error('未找到 ' + LATEST_FILENAME);
        }
        var file = await fileHandle.getFile();
        var text = await file.text();
        try {
            return JSON.parse(text);
        } catch (_) {
            throw new Error('本地备份文件不是有效的 JSON');
        }
    }

    function summarizePreview(preview) {
        var keys = Array.isArray(preview.keys) ? preview.keys : [];
        var cleared = Array.isArray(preview.clearedKeys) ? preview.clearedKeys : [];
        var practice = preview.practice || {};
        var lines = [
            '将从本地磁盘备份覆盖恢复当前数据。',
            '格式：' + (preview.format || 'unknown') + (preview.scope ? ' / ' + preview.scope : ''),
            '数据域：' + (keys.length ? keys.join('、') : '无')
        ];
        if (cleared.length) lines.push('将清空：' + cleared.join('、'));
        if (practice && Number.isFinite(Number(practice.finalCount))) {
            lines.push('练习记录：现有 ' + (Number(practice.existingCount) || 0)
                + ' 条 → 恢复后 ' + Number(practice.finalCount) + ' 条'
                + '（删除 ' + (Number(practice.removedCount) || 0) + ' 条）');
        }
        var diagnostics = preview.diagnostics || {};
        if (Array.isArray(diagnostics.missingKeys) && diagnostics.missingKeys.length) {
            lines.push('备份缺失且将保留现状：' + diagnostics.missingKeys.join('、'));
        }
        if (Array.isArray(diagnostics.repairedKeys) && diagnostics.repairedKeys.length) {
            lines.push('已修复旧格式数据：' + diagnostics.repairedKeys.join('、'));
        }
        if (Array.isArray(diagnostics.ignoredKeys) && diagnostics.ignoredKeys.length) {
            lines.push('已隔离不安全数据：' + diagnostics.ignoredKeys.join('、'));
        }
        if (Array.isArray(preview.warnings) && preview.warnings.length) {
            lines.push('警告：' + preview.warnings.join('；'));
        }
        lines.push('', '恢复前会创建一个应用内安全快照。是否继续？');
        return lines.join('\n');
    }

    function createOperationId(prefix) {
        try {
            if (global.crypto && typeof global.crypto.randomUUID === 'function') {
                return prefix + '-' + global.crypto.randomUUID();
            }
        } catch (_) { /* ignore */ }
        return prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }

    async function restorePayload(payload, options) {
        var opts = options || {};
        var backups = requireBackupApi();
        var preview = await backups.previewImport(payload, {
            replace: true,
            practiceMode: 'replace',
            applyClears: true,
            fullRestore: true
        });
        var confirmed = opts.confirmed === true;
        if (!confirmed) {
            try {
                confirmed = global.confirm(summarizePreview(preview));
            } catch (_) {
                confirmed = false;
            }
        }
        if (!confirmed) return { success: false, reason: 'cancelled', preview: preview };

        await backups.create({
            type: 'pre-external-restore',
            operationId: createOperationId('pre-external-restore')
        });
        var result = await backups.commitImport(preview.id, {
            operationId: opts.operationId || createOperationId('external-restore'),
            confirmDestructive: preview.destructive === true
        });
        try {
            if (typeof backups.recordImport === 'function') {
                await backups.recordImport({
                    source: 'external-backup',
                    format: preview.format,
                    keys: preview.keys,
                    clearedKeys: preview.clearedKeys,
                    practice: preview.practice || null
                });
            }
        } catch (historyError) {
            if (global.console && console.warn) console.warn('[ExternalBackup v2] import history failed:', historyError);
        }
        return { success: true, preview: preview, result: result };
    }

    async function restoreFromLatest(options) {
        var payload = await readLatestPayload(true);
        var result = await restorePayload(payload, options);
        if (result && result.success) {
            state.dirty = false;
            await persistMeta({
                lastChecksum: payload && payload.checksum ? payload.checksum : state.meta.lastChecksum,
                lastWriteError: null,
                awaitingRestore: false
            });
        }
        return result;
    }

    function scheduleSilentFlush() {
        if (state.suspended || state.meta.awaitingRestore) return;
        if (state.silentFlushTimer) global.clearTimeout(state.silentFlushTimer);
        state.silentFlushTimer = global.setTimeout(function () {
            state.silentFlushTimer = null;
            return flushSilentlyIfPermitted().catch(function (error) {
                if (global.console && console.warn) console.warn('[ExternalBackup v2] silent flush failed:', error);
            });
        }, WRITE_DELAY_MS);
    }

    function markDirty() {
        if (state.suspended) return;
        state.dirty = true;
        state.dirtyGeneration += 1;
        refreshPanel();
        scheduleSilentFlush();
    }

    async function flushSilentlyIfPermitted() {
        await ensureReady();
        if (state.suspended) return { success: false, reason: 'suspended' };
        if (state.meta.awaitingRestore) return { success: false, reason: 'restore_required' };
        if (!state.directoryHandle || !state.dirty) {
            return { success: false, reason: 'skip' };
        }
        if (state.writing) {
            scheduleSilentFlush();
            return { success: false, reason: 'busy' };
        }
        if (!await ensurePermission(state.directoryHandle, false)) {
            refreshPanel();
            return { success: false, reason: 'permission_denied' };
        }
        return writeToBoundDirectory({ interactive: false, force: false });
    }

    function getStatus() {
        return {
            supported: supportsFileSystemAccess(),
            bound: !!state.directoryHandle,
            directoryName: state.meta.directoryName,
            permission: state.permission,
            permissionGranted: state.permission === 'granted',
            dirty: state.dirty,
            writing: state.writing,
            suspended: state.suspended,
            lastWriteAt: state.meta.lastWriteAt,
            lastChecksum: state.meta.lastChecksum,
            lastWriteError: state.meta.lastWriteError,
            awaitingRestore: state.meta.awaitingRestore
        };
    }

    function formatTime(value) {
        if (!value) return '';
        var parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
    }

    function formatStatusText(status) {
        if (!status.supported) return '当前环境不支持文件夹绑定，请使用「导出到下载」和「导入数据」。';
        if (!status.bound) return '未绑定本地备份文件夹。';
        var parts = ['已绑定：' + (status.directoryName || '文件夹')];
        if (status.awaitingRestore) parts.push('检测到已有备份，请先恢复');
        if (!status.permissionGranted) parts.push('需要重新授权');
        if (status.writing) parts.push('正在写入');
        else if (status.lastWriteAt) parts.push('上次写入 ' + formatTime(status.lastWriteAt));
        else parts.push('尚未写入');
        if (status.dirty) parts.push('有未备份的新数据');
        if (status.lastWriteError) parts.push('最近错误：' + status.lastWriteError);
        return parts.join(' · ');
    }

    function notify(message, type) {
        if (typeof global.showMessage === 'function') {
            global.showMessage(message, type || 'info');
        } else if (global.console && console.log) {
            console.log('[ExternalBackup v2] ' + message);
        }
    }

    function makeButton(id, label) {
        var button = global.document.createElement('button');
        button.type = 'button';
        button.id = id;
        button.className = 'btn data-mgmt-btn';
        button.textContent = label;
        return button;
    }

    function getModal() {
        return global.document ? global.document.getElementById(MODAL_ID) : null;
    }

    function ensureModalDom() {
        if (!global.document || !global.document.body) return null;
        var existing = getModal();
        if (existing) return existing;

        var modal = global.document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'theme-modal external-backup-modal shui-secondary-modal shui-secondary-modal--sm';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'external-backup-title');

        var content = global.document.createElement('div');
        content.className = 'theme-modal-content external-backup-modal__content shui-secondary-modal__content';
        var header = global.document.createElement('div');
        header.className = 'theme-modal-header external-backup-modal__header shui-secondary-modal__header';
        var title = global.document.createElement('h3');
        title.id = 'external-backup-title';
        title.textContent = '本地磁盘备份';
        var closeButton = global.document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'theme-modal-close';
        closeButton.setAttribute('aria-label', '关闭');
        closeButton.innerHTML = '&times;';
        header.appendChild(title);
        header.appendChild(closeButton);

        var body = global.document.createElement('div');
        body.className = 'theme-modal-body external-backup-modal__body shui-secondary-modal__body';
        var panel = global.document.createElement('div');
        panel.id = 'external-backup-panel';
        panel.className = 'external-backup-panel external-backup-panel--modal';
        var description = global.document.createElement('p');
        description.className = 'external-backup-panel__desc';
        description.textContent = '绑定本地文件夹后，IELTS Atlas 会写入完整的 v2 数据快照。磁盘文件不会因清理浏览器站点数据而删除；后台写入不会主动请求权限。';
        var statusCard = global.document.createElement('div');
        statusCard.className = 'external-backup-status-card';
        var statusLabel = global.document.createElement('div');
        statusLabel.className = 'external-backup-status-card__label';
        statusLabel.textContent = '当前状态';
        var statusText = global.document.createElement('div');
        statusText.id = 'external-backup-status';
        statusText.className = 'external-backup-panel__status';
        statusText.textContent = '状态加载中…';
        statusCard.appendChild(statusLabel);
        statusCard.appendChild(statusText);

        var tips = global.document.createElement('ul');
        tips.className = 'external-backup-panel__tips';
        [
            '支持 Chrome / Edge 的安全上下文；其他环境继续使用手动导出',
            '备份文件包含练习、设置、词汇、题库配置等可迁移数据',
            '磁盘 JSON 为明文文件，请妥善保管'
        ].forEach(function (text) {
            var item = global.document.createElement('li');
            item.textContent = text;
            tips.appendChild(item);
        });

        var actions = global.document.createElement('div');
        actions.className = 'external-backup-panel__actions';
        var bindButton = makeButton('external-backup-bind-btn', '📁 绑定备份文件夹');
        var writeButton = makeButton('external-backup-write-btn', '💾 立即写入备份');
        var restoreButton = makeButton('external-backup-restore-btn', '♻️ 从文件夹恢复');
        var unbindButton = makeButton('external-backup-unbind-btn', '🔓 解除绑定');
        unbindButton.classList.add('external-backup-btn--ghost');
        actions.appendChild(bindButton);
        actions.appendChild(writeButton);
        actions.appendChild(restoreButton);
        actions.appendChild(unbindButton);

        panel.appendChild(description);
        panel.appendChild(statusCard);
        panel.appendChild(tips);
        panel.appendChild(actions);
        body.appendChild(panel);
        content.appendChild(header);
        content.appendChild(body);
        modal.appendChild(content);
        global.document.body.appendChild(modal);

        closeButton.addEventListener('click', closeModal);
        modal.addEventListener('click', function (event) {
            if (event.target === modal) closeModal();
        });
        bindButton.addEventListener('click', async function () {
            try {
                var bound = await bindDirectory({ writeNow: true });
                if (bound.existingBackupFound) {
                    notify('已绑定并检测到现有备份；为防止覆盖，请先从文件夹恢复', 'warning');
                } else if (bound.writeResult && !bound.writeResult.success) {
                    notify('文件夹已绑定，但首次写入失败', 'warning');
                } else {
                    notify('已绑定并写入：' + bound.directoryName, 'success');
                }
            } catch (error) {
                notify(error && error.name === 'AbortError' ? '已取消选择文件夹' : (error.message || '绑定失败'), error && error.name === 'AbortError' ? 'info' : 'error');
            }
            refreshPanel();
        });
        writeButton.addEventListener('click', async function () {
            var result = await writeToBoundDirectory({ interactive: true, force: true });
            if (result.success) notify(result.skipped ? '备份内容无变化' : '已写入 ' + result.filename, 'success');
            else if (result.reason === 'unbound') notify('请先绑定备份文件夹', 'warning');
            else if (result.reason === 'restore_required') notify('检测到现有备份，请先从文件夹恢复，避免覆盖', 'warning');
            else if (result.reason === 'permission_denied') notify('需要允许文件夹访问权限', 'warning');
            else notify('写入失败：' + (result.error && result.error.message || result.reason), 'error');
        });
        restoreButton.addEventListener('click', async function () {
            try {
                var restored = await restoreFromLatest();
                if (restored.success) {
                    notify('已从本地磁盘备份恢复', 'success');
                    if (typeof global.syncPracticeRecords === 'function') {
                        Promise.resolve(global.syncPracticeRecords({ forceRender: true })).catch(function () {});
                    }
                } else if (restored.reason === 'cancelled') {
                    notify('已取消恢复', 'info');
                }
            } catch (error) {
                notify(error && error.message ? error.message : '恢复失败', 'error');
            }
        });
        unbindButton.addEventListener('click', async function () {
            var confirmed = true;
            try {
                confirmed = global.confirm('解除绑定后将停止自动写入；磁盘上的 JSON 文件不会删除。确定？');
            } catch (_) { /* ignore */ }
            if (!confirmed) return;
            try {
                await unbindDirectory();
                notify('已解除本地备份文件夹绑定', 'info');
            } catch (error) {
                notify(error && error.message ? error.message : '解除绑定失败', 'error');
            }
        });
        return modal;
    }

    function refreshPanel() {
        if (!global.document) return;
        var status = getStatus();
        var statusElement = global.document.getElementById('external-backup-status');
        if (statusElement) {
            statusElement.textContent = formatStatusText(status);
            statusElement.dataset.state = !status.supported ? 'unsupported'
                : !status.bound ? 'unbound'
                    : !status.permissionGranted ? 'need-auth'
                        : status.dirty ? 'stale' : 'ok';
        }
        var entry = global.document.getElementById(ENTRY_ID);
        if (entry) {
            entry.textContent = !status.bound ? '📁 本地磁盘备份'
                : !status.permissionGranted ? '📁 本地备份 · 需授权'
                    : status.dirty ? '📁 本地备份 · 待更新' : '📁 本地备份 · 已就绪';
            entry.dataset.state = statusElement && statusElement.dataset.state || 'unbound';
        }
        var bindButton = global.document.getElementById('external-backup-bind-btn');
        var writeButton = global.document.getElementById('external-backup-write-btn');
        var restoreButton = global.document.getElementById('external-backup-restore-btn');
        var unbindButton = global.document.getElementById('external-backup-unbind-btn');
        if (bindButton) bindButton.disabled = !status.supported || status.writing;
        if (writeButton) writeButton.disabled = !status.bound || status.writing;
        if (restoreButton) restoreButton.disabled = !status.bound || status.writing;
        if (unbindButton) unbindButton.disabled = !status.bound || status.writing;
    }

    function openModal() {
        var modal = ensureModalDom();
        if (modal) modal.classList.add('show');
        ensureReady().then(async function () {
            if (state.directoryHandle) state.permission = await queryPermission(state.directoryHandle, 'readwrite');
            refreshPanel();
        }).catch(function (error) {
            if (global.console && console.warn) console.warn('[ExternalBackup v2] initialization failed:', error);
            refreshPanel();
        });
    }

    function closeModal() {
        var modal = getModal();
        if (modal) modal.classList.remove('show');
    }

    async function ensureReady() {
        if (state.ready) return true;
        if (state.readyPromise) return state.readyPromise;
        state.readyPromise = (async function () {
            if (global.AppData && global.AppData.ready) await global.AppData.ready;
            if (state.suspended) {
                state.ready = true;
                return false;
            }
            if (supportsFileSystemAccess()) {
                try {
                    var stored = await Promise.all([
                        readStoredValue(HANDLE_KEY),
                        readStoredValue(META_KEY)
                    ]);
                    state.directoryHandle = stored[0] || null;
                    state.meta = cloneMeta(stored[1]);
                    if (state.directoryHandle) {
                        state.permission = await queryPermission(state.directoryHandle, 'readwrite');
                        if (!state.meta.directoryName) {
                            state.meta.directoryName = state.directoryHandle.name || 'backup';
                        }
                    }
                } catch (error) {
                    if (global.console && console.warn) console.warn('[ExternalBackup v2] binding load failed:', error);
                }
            }
            var backups = global.AppData && global.AppData.backups;
            if (backups && typeof backups.onDataCommitted === 'function' && !state.unsubscribeCommitted) {
                state.unsubscribeCommitted = backups.onDataCommitted(markDirty);
            }
            if (state.directoryHandle && backups && typeof backups.export === 'function') {
                try {
                    var currentSnapshot = await backups.export();
                    if (!currentSnapshot || currentSnapshot.checksum !== state.meta.lastChecksum) {
                        state.dirty = true;
                        state.dirtyGeneration += 1;
                    }
                } catch (error) {
                    if (global.console && console.warn) console.warn('[ExternalBackup v2] freshness check failed:', error);
                }
            }
            state.ready = true;
            if (state.dirty && state.permission === 'granted') scheduleSilentFlush();
            refreshPanel();
            return true;
        })();
        return state.readyPromise;
    }

    async function init() {
        await ensureReady();
        if (state.suspended) return false;
        ensureModalDom();
        refreshPanel();
        if (global.document && !state.initialized) {
            state.visibilityHandler = function () {
                if (state.suspended) return;
                if (global.document.visibilityState === 'hidden') {
                    flushSilentlyIfPermitted().catch(function () {});
                } else if (state.directoryHandle) {
                    queryPermission(state.directoryHandle, 'readwrite').then(function (permission) {
                        state.permission = permission;
                        if (permission === 'granted' && state.dirty) scheduleSilentFlush();
                        refreshPanel();
                    });
                }
            };
            global.document.addEventListener('visibilitychange', state.visibilityHandler);
        }
        state.initialized = true;
        return true;
    }

    global.ExternalBackupService = Object.freeze({
        __v2: true,
        LATEST_FILENAME: LATEST_FILENAME,
        supportsFileSystemAccess: supportsFileSystemAccess,
        ensureReady: ensureReady,
        init: init,
        openModal: openModal,
        closeModal: closeModal,
        bindDirectory: bindDirectory,
        unbindDirectory: unbindDirectory,
        prepareForFullReset: prepareForFullReset,
        writeNow: function (options) {
            return writeToBoundDirectory(Object.assign({ interactive: true, force: true }, options || {}));
        },
        restoreFromLatest: restoreFromLatest,
        restorePayload: restorePayload,
        getStatus: getStatus,
        markDirty: markDirty,
        flushSilentlyIfPermitted: flushSilentlyIfPermitted,
        refreshPanel: refreshPanel,
        requestPersistentStorage: requestPersistentStorage
    });

    function boot() {
        init().catch(function (error) {
            if (global.console && console.warn) console.warn('[ExternalBackup v2] boot failed:', error);
        });
    }

    if (global.document && global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(typeof window !== 'undefined' ? window : globalThis);
