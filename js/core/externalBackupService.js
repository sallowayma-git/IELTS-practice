/**
 * External disk backup via File System Access API.
 * Browser-internal backups (manual_backups) cannot survive site-data clears;
 * this service writes JSON into a user-chosen local folder.
 *
 * Policy:
 * - Silent write only when a directory handle already has granted permission.
 * - Daily reminder at most once per calendar day (permission / bind / stale write).
 * - Download export is never auto-triggered; only after explicit user click.
 */
(function initExternalBackupService(global) {
    'use strict';

    if (global.ExternalBackupService && global.ExternalBackupService.__stable === true) {
        return;
    }

    var META_KEY = 'exam_system_external_backup_meta';
    var DB_NAME = 'ExamSystemExternalBackup';
    var DB_VERSION = 1;
    var STORE_NAME = 'handles';
    var HANDLE_KEY = 'backup_directory';
    var LATEST_FILENAME = 'practice-backup-latest.json';
    var DAY_MS = 24 * 60 * 60 * 1000;
    var STALE_WRITE_MS = DAY_MS;
    var REMIND_BANNER_ID = 'external-backup-remind-banner';
    var VERSION = '0.6.2-fix';

    var state = {
        ready: false,
        readyPromise: null,
        directoryHandle: null,
        meta: null,
        dirty: false,
        writing: false,
        lastSnapshotHash: null,
        silentFlushTimer: null
    };

    function nowIso() {
        return new Date().toISOString();
    }

    function dayKey(date) {
        var d = date instanceof Date ? date : new Date(date || Date.now());
        if (Number.isNaN(d.getTime())) {
            d = new Date();
        }
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function isPlainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    function notify(message, type) {
        if (typeof global.showMessage === 'function') {
            global.showMessage(message, type || 'info');
        }
    }

    function defaultMeta() {
        return {
            enabled: false,
            directoryName: null,
            lastWriteAt: null,
            lastWriteOk: false,
            lastWriteError: null,
            lastRemindDay: null,
            lastPermissionOk: false,
            lastRestorePromptDay: null,
            recordCountAtLastWrite: 0,
            createdAt: nowIso(),
            updatedAt: nowIso()
        };
    }

    function readMeta() {
        try {
            var raw = global.localStorage && global.localStorage.getItem(META_KEY);
            if (!raw) {
                return defaultMeta();
            }
            var parsed = JSON.parse(raw);
            return Object.assign(defaultMeta(), isPlainObject(parsed) ? parsed : {});
        } catch (_) {
            return defaultMeta();
        }
    }

    function writeMeta(patch) {
        var next = Object.assign({}, state.meta || readMeta(), isPlainObject(patch) ? patch : {}, {
            updatedAt: nowIso()
        });
        state.meta = next;
        try {
            if (global.localStorage) {
                global.localStorage.setItem(META_KEY, JSON.stringify(next));
            }
        } catch (error) {
            console.warn('[ExternalBackup] meta write failed:', error);
        }
        dispatchStatus();
        return next;
    }

    function dispatchStatus() {
        try {
            global.dispatchEvent(new CustomEvent('external-backup-status', {
                detail: getStatus()
            }));
        } catch (_) { /* ignore */ }
    }

    function supportsFileSystemAccess() {
        return !!(
            global.showDirectoryPicker &&
            typeof global.showDirectoryPicker === 'function' &&
            global.isSecureContext !== false
        );
    }

    function supportsFilePickerRead() {
        return !!(global.showOpenFilePicker && typeof global.showOpenFilePicker === 'function');
    }

    function openHandleDb() {
        return new Promise(function (resolve, reject) {
            if (!global.indexedDB) {
                reject(new Error('IndexedDB unavailable'));
                return;
            }
            var request = global.indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = function () {
                reject(request.error || new Error('Failed to open external backup DB'));
            };
            request.onupgradeneeded = function (event) {
                var db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = function () {
                resolve(request.result);
            };
        });
    }

    function idbRequest(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    async function saveDirectoryHandle(handle) {
        var db = await openHandleDb();
        try {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            await idbRequest(store.put(handle, HANDLE_KEY));
        } finally {
            try { db.close(); } catch (_) { /* ignore */ }
        }
    }

    async function loadDirectoryHandle() {
        var db = await openHandleDb();
        try {
            var tx = db.transaction(STORE_NAME, 'readonly');
            var store = tx.objectStore(STORE_NAME);
            return await idbRequest(store.get(HANDLE_KEY));
        } finally {
            try { db.close(); } catch (_) { /* ignore */ }
        }
    }

    async function clearDirectoryHandle() {
        var db = await openHandleDb();
        try {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            await idbRequest(store.delete(HANDLE_KEY));
        } finally {
            try { db.close(); } catch (_) { /* ignore */ }
        }
    }

    async function queryHandlePermission(handle, mode) {
        if (!handle) {
            return 'denied';
        }
        try {
            if (typeof handle.queryPermission === 'function') {
                return await handle.queryPermission({ mode: mode || 'readwrite' });
            }
        } catch (_) { /* ignore */ }
        return 'prompt';
    }

    async function requestHandlePermission(handle, mode) {
        if (!handle) {
            return 'denied';
        }
        try {
            if (typeof handle.requestPermission === 'function') {
                return await handle.requestPermission({ mode: mode || 'readwrite' });
            }
        } catch (_) { /* ignore */ }
        // Some Chromium builds treat existing handles as usable without requestPermission.
        return await queryHandlePermission(handle, mode);
    }

    async function ensurePermission(handle, interactive) {
        if (!handle) {
            return false;
        }
        var current = await queryHandlePermission(handle, 'readwrite');
        if (current === 'granted') {
            writeMeta({ lastPermissionOk: true });
            return true;
        }
        if (!interactive) {
            writeMeta({ lastPermissionOk: false });
            return false;
        }
        var next = await requestHandlePermission(handle, 'readwrite');
        var ok = next === 'granted';
        writeMeta({ lastPermissionOk: ok });
        return ok;
    }

    async function requestPersistentStorage() {
        try {
            if (!global.navigator || !global.navigator.storage || typeof global.navigator.storage.persist !== 'function') {
                return false;
            }
            var already = typeof global.navigator.storage.persisted === 'function'
                ? await global.navigator.storage.persisted()
                : false;
            if (already) {
                return true;
            }
            return await global.navigator.storage.persist();
        } catch (error) {
            console.warn('[ExternalBackup] persist() failed:', error);
            return false;
        }
    }

    async function captureSnapshot() {
        if (global.BackupAPI && typeof global.BackupAPI.captureSnapshot === 'function') {
            var snapshot = await global.BackupAPI.captureSnapshot();
            return global.BackupAPI.normalizePayload
                ? global.BackupAPI.normalizePayload(snapshot)
                : snapshot;
        }

        var practiceRecords = [];
        var userStats = null;
        if (global.PracticeRecordAPI && typeof global.PracticeRecordAPI.list === 'function') {
            var listed = await global.PracticeRecordAPI.list();
            practiceRecords = Array.isArray(listed) ? listed : [];
        }
        if (global.PracticeRecordAPI && typeof global.PracticeRecordAPI.readStats === 'function') {
            userStats = await global.PracticeRecordAPI.readStats();
        }

        var examIndex = [];
        var storageVersion = null;
        try {
            if (global.storage && typeof global.storage.get === 'function') {
                examIndex = await global.storage.get('exam_index', []);
                storageVersion = await global.storage.get('storage_version', null);
            }
        } catch (_) { /* ignore */ }

        return {
            practice_records: practiceRecords,
            practiceRecords: practiceRecords,
            user_stats: userStats,
            userStats: userStats,
            exam_index: Array.isArray(examIndex) ? examIndex : [],
            examIndex: Array.isArray(examIndex) ? examIndex : [],
            storage_version: storageVersion,
            storageVersion: storageVersion
        };
    }

    function buildExportDocument(snapshot) {
        return {
            exportDate: nowIso(),
            version: VERSION,
            source: 'external-backup-service',
            note: 'Disk backup for IELTS Atlas. Survives browser cache clears. Import via 设置 → 导入数据.',
            data: snapshot
        };
    }

    function stableHash(payload) {
        try {
            var text = JSON.stringify(payload);
            var hash = 0;
            for (var i = 0; i < text.length; i += 1) {
                hash = ((hash << 5) - hash) + text.charCodeAt(i);
                hash |= 0;
            }
            return String(hash);
        } catch (_) {
            return String(Date.now());
        }
    }

    async function writeTextFile(directoryHandle, filename, text) {
        var fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
        var writable = await fileHandle.createWritable();
        try {
            await writable.write(text);
            await writable.close();
        } catch (error) {
            try { await writable.abort(); } catch (_) { /* ignore */ }
            throw error;
        }
    }

    async function readTextFile(directoryHandle, filename) {
        var fileHandle = await directoryHandle.getFileHandle(filename, { create: false });
        var file = await fileHandle.getFile();
        return await file.text();
    }

    async function writeToBoundDirectory(options) {
        var opts = options || {};
        if (state.writing) {
            return { success: false, reason: 'busy' };
        }
        if (!state.directoryHandle) {
            return { success: false, reason: 'unbound' };
        }

        state.writing = true;
        try {
            var interactive = opts.interactive === true;
            var permitted = await ensurePermission(state.directoryHandle, interactive);
            if (!permitted) {
                writeMeta({ lastWriteOk: false, lastWriteError: 'permission_denied' });
                return { success: false, reason: 'permission_denied' };
            }

            var snapshot = await captureSnapshot();
            var doc = buildExportDocument(snapshot);
            var text = JSON.stringify(doc, null, 2);
            var hash = stableHash(doc.data);

            if (!opts.force && hash === state.lastSnapshotHash && state.meta && state.meta.lastWriteOk) {
                return { success: true, reason: 'unchanged', skipped: true };
            }

            await writeTextFile(state.directoryHandle, LATEST_FILENAME, text);

            if (opts.datedCopy !== false) {
                try {
                    var dated = 'practice-backup-' + dayKey(new Date()) + '.json';
                    await writeTextFile(state.directoryHandle, dated, text);
                } catch (datedError) {
                    console.warn('[ExternalBackup] dated copy failed:', datedError);
                }
            }

            var recordCount = Array.isArray(snapshot.practice_records)
                ? snapshot.practice_records.length
                : (Array.isArray(snapshot.practiceRecords) ? snapshot.practiceRecords.length : 0);

            state.lastSnapshotHash = hash;
            state.dirty = false;
            writeMeta({
                enabled: true,
                lastWriteAt: nowIso(),
                lastWriteOk: true,
                lastWriteError: null,
                lastPermissionOk: true,
                recordCountAtLastWrite: recordCount
            });

            return {
                success: true,
                reason: 'written',
                filename: LATEST_FILENAME,
                recordCount: recordCount,
                bytes: text.length
            };
        } catch (error) {
            console.error('[ExternalBackup] write failed:', error);
            writeMeta({
                lastWriteOk: false,
                lastWriteError: error && error.message ? error.message : String(error)
            });
            return {
                success: false,
                reason: 'write_error',
                error: error
            };
        } finally {
            state.writing = false;
        }
    }

    async function bindDirectory(options) {
        if (!supportsFileSystemAccess()) {
            throw new Error('当前浏览器不支持绑定本地文件夹（需要 Chrome/Edge，且非 file:// 打开）');
        }

        var handle = await global.showDirectoryPicker({
            id: 'ielts-atlas-external-backup',
            mode: 'readwrite',
            startIn: 'documents'
        });

        if (!handle) {
            throw new Error('未选择文件夹');
        }

        var permitted = await ensurePermission(handle, true);
        if (!permitted) {
            throw new Error('未获得文件夹读写权限');
        }

        await saveDirectoryHandle(handle);
        state.directoryHandle = handle;
        writeMeta({
            enabled: true,
            directoryName: handle.name || 'backup',
            lastPermissionOk: true,
            lastWriteError: null
        });

        var writeNow = !options || options.writeNow !== false;
        var writeResult = null;
        if (writeNow) {
            writeResult = await writeToBoundDirectory({ interactive: true, force: true });
        }

        await requestPersistentStorage();
        return {
            directoryName: handle.name || 'backup',
            writeResult: writeResult
        };
    }

    async function unbindDirectory() {
        state.directoryHandle = null;
        state.lastSnapshotHash = null;
        try {
            await clearDirectoryHandle();
        } catch (error) {
            console.warn('[ExternalBackup] clear handle failed:', error);
        }
        writeMeta({
            enabled: false,
            directoryName: null,
            lastPermissionOk: false,
            lastWriteError: null
        });
        return true;
    }

    async function restoreFromLatest(options) {
        var opts = options || {};
        if (!state.directoryHandle) {
            throw new Error('尚未绑定备份文件夹');
        }
        var permitted = await ensurePermission(state.directoryHandle, opts.interactive !== false);
        if (!permitted) {
            throw new Error('需要文件夹读取权限才能恢复');
        }

        var text = await readTextFile(state.directoryHandle, LATEST_FILENAME);
        var payload = JSON.parse(text);
        var data = payload && payload.data ? payload.data : payload;

        if (global.BackupAPI && typeof global.BackupAPI.restorePayload === 'function') {
            await global.BackupAPI.restorePayload(data, opts);
        } else if (global.DataBackupManager || global.dataBackupManager) {
            throw new Error('请使用设置页「导入数据」选择备份文件完成恢复');
        } else {
            throw new Error('恢复 API 未就绪');
        }

        writeMeta({ lastRestorePromptDay: dayKey(new Date()) });
        return true;
    }

    async function pickAndRestoreFile() {
        if (supportsFilePickerRead()) {
            var handles = await global.showOpenFilePicker({
                multiple: false,
                types: [{
                    description: 'IELTS Atlas backup JSON',
                    accept: { 'application/json': ['.json'] }
                }]
            });
            var fileHandle = handles && handles[0];
            if (!fileHandle) {
                throw new Error('未选择文件');
            }
            var file = await fileHandle.getFile();
            var text = await file.text();
            var payload = JSON.parse(text);
            var data = payload && payload.data ? payload.data : payload;
            if (global.BackupAPI && typeof global.BackupAPI.restorePayload === 'function') {
                await global.BackupAPI.restorePayload(data);
                return true;
            }
            throw new Error('恢复 API 未就绪');
        }

        // Fallback: reuse existing import flow
        if (typeof global.importData === 'function') {
            global.importData();
            return false;
        }
        throw new Error('当前环境不支持文件选择器，请使用「导入数据」');
    }

    async function countPracticeRecords() {
        try {
            if (global.PracticeRecordAPI && typeof global.PracticeRecordAPI.list === 'function') {
                var list = await global.PracticeRecordAPI.list();
                return Array.isArray(list) ? list.length : 0;
            }
        } catch (_) { /* ignore */ }
        return 0;
    }

    async function hasReadableLatestBackup() {
        if (!state.directoryHandle) {
            return false;
        }
        try {
            var permitted = await ensurePermission(state.directoryHandle, false);
            if (!permitted) {
                return false;
            }
            await state.directoryHandle.getFileHandle(LATEST_FILENAME, { create: false });
            return true;
        } catch (_) {
            return false;
        }
    }

    function buildReminder(status) {
        if (!status) {
            return null;
        }

        if (!status.supported) {
            return null;
        }

        if (!status.bound) {
            return {
                level: 'info',
                code: 'bind',
                title: '建议绑定本地备份文件夹',
                message: '练习数据只存在浏览器内，清缓存会丢失。绑定文件夹后可一键写入磁盘备份。',
                primaryAction: 'bind',
                primaryLabel: '绑定文件夹',
                secondaryAction: null,
                secondaryLabel: null
            };
        }

        if (!status.permissionGranted) {
            return {
                level: 'warning',
                code: 'permission',
                title: '本地备份需要重新授权',
                message: '已绑定「' + (status.directoryName || '备份文件夹') + '」，但当前没有写入权限。',
                primaryAction: 'reauth',
                primaryLabel: '重新授权并写入',
                secondaryAction: 'unbind',
                secondaryLabel: '解除绑定'
            };
        }

        if (status.staleWrite || status.dirty) {
            return {
                level: 'info',
                code: 'write',
                title: '本地备份可更新',
                message: status.lastWriteAt
                    ? ('距上次写入已超过一天或有新练习数据（上次：' + formatTime(status.lastWriteAt) + '）。')
                    : '尚未写入磁盘备份，建议现在写入。',
                primaryAction: 'write',
                primaryLabel: '立即写入备份',
                secondaryAction: null,
                secondaryLabel: null
            };
        }

        return null;
    }

    function formatTime(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString();
        } catch (_) {
            return String(iso);
        }
    }

    function shouldShowDailyReminder(reminder) {
        if (!reminder) {
            return false;
        }
        var meta = state.meta || readMeta();
        var today = dayKey(new Date());
        if (meta.lastRemindDay === today) {
            return false;
        }
        return true;
    }

    function markReminded() {
        writeMeta({ lastRemindDay: dayKey(new Date()) });
    }

    function removeRemindBanner() {
        var el = global.document && global.document.getElementById(REMIND_BANNER_ID);
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function renderRemindBanner(reminder) {
        if (!global.document || !global.document.body || !reminder) {
            return;
        }

        removeRemindBanner();

        var banner = global.document.createElement('div');
        banner.id = REMIND_BANNER_ID;
        banner.className = 'external-backup-banner external-backup-banner--' + (reminder.level || 'info');
        banner.setAttribute('role', 'status');

        var glass = global.document.createElement('div');
        glass.className = 'external-backup-banner__glass';

        var text = global.document.createElement('div');
        text.className = 'external-backup-banner__text';
        var title = global.document.createElement('strong');
        title.textContent = reminder.title;
        var msg = global.document.createElement('span');
        msg.textContent = reminder.message;
        text.appendChild(title);
        text.appendChild(msg);

        var actions = global.document.createElement('div');
        actions.className = 'external-backup-banner__actions';

        function makeBtn(label, action, primary) {
            var btn = global.document.createElement('button');
            btn.type = 'button';
            btn.className = primary
                ? 'btn external-backup-banner__btn external-backup-banner__btn--primary'
                : 'btn external-backup-banner__btn external-backup-banner__btn--ghost';
            btn.textContent = label;
            btn.addEventListener('click', function () {
                handleReminderAction(action);
            });
            return btn;
        }

        if (reminder.primaryAction) {
            actions.appendChild(makeBtn(reminder.primaryLabel || '确定', reminder.primaryAction, true));
        }
        if (reminder.secondaryAction) {
            actions.appendChild(makeBtn(reminder.secondaryLabel || '取消', reminder.secondaryAction, false));
        }

        var dismiss = global.document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'external-backup-banner__dismiss';
        dismiss.setAttribute('aria-label', '关闭提醒');
        dismiss.textContent = '×';
        dismiss.addEventListener('click', function () {
            markReminded();
            removeRemindBanner();
        });

        glass.appendChild(text);
        glass.appendChild(actions);
        glass.appendChild(dismiss);
        banner.appendChild(glass);
        global.document.body.appendChild(banner);
        markReminded();
    }

    async function handleReminderAction(action) {
        try {
            if (action === 'bind') {
                var bound = await bindDirectory({ writeNow: true });
                removeRemindBanner();
                if (bound.writeResult && bound.writeResult.success) {
                    notify('已绑定并写入本地备份：' + (bound.directoryName || ''), 'success');
                } else {
                    notify('已绑定文件夹：' + (bound.directoryName || '') + '，请点击「立即写入备份」', 'info');
                }
                refreshUi();
                return;
            }
            if (action === 'reauth' || action === 'write') {
                var result = await writeToBoundDirectory({ interactive: true, force: true });
                removeRemindBanner();
                if (result.success) {
                    notify(result.skipped ? '备份已是最新' : '本地备份已写入', 'success');
                } else if (result.reason === 'permission_denied') {
                    notify('仍未获得文件夹权限，请在浏览器弹窗中允许访问', 'warning');
                } else if (result.reason === 'unbound') {
                    notify('尚未绑定备份文件夹', 'warning');
                } else {
                    notify('写入失败：' + (result.error && result.error.message ? result.error.message : result.reason), 'error');
                }
                refreshUi();
                return;
            }
            if (action === 'unbind') {
                await unbindDirectory();
                removeRemindBanner();
                notify('已解除本地备份文件夹绑定', 'info');
                refreshUi();
            }
        } catch (error) {
            if (error && error.name === 'AbortError') {
                notify('已取消', 'info');
                return;
            }
            console.error('[ExternalBackup] reminder action failed:', error);
            notify(error && error.message ? error.message : '操作失败', 'error');
        }
    }

    function getStatus() {
        var meta = state.meta || readMeta();
        var lastWriteAt = meta.lastWriteAt || null;
        var lastWriteAge = lastWriteAt ? (Date.now() - new Date(lastWriteAt).getTime()) : Infinity;
        var staleWrite = !lastWriteAt || !Number.isFinite(lastWriteAge) || lastWriteAge >= STALE_WRITE_MS;
        var permissionGranted = !!(state.directoryHandle && meta.lastPermissionOk);

        return {
            supported: supportsFileSystemAccess(),
            secureContext: global.isSecureContext !== false,
            bound: !!(state.directoryHandle && meta.enabled),
            directoryName: meta.directoryName || null,
            permissionGranted: permissionGranted,
            lastWriteAt: lastWriteAt,
            lastWriteOk: !!meta.lastWriteOk,
            lastWriteError: meta.lastWriteError || null,
            lastWriteAgeMs: Number.isFinite(lastWriteAge) ? lastWriteAge : null,
            staleWrite: staleWrite,
            dirty: !!state.dirty,
            writing: !!state.writing,
            recordCountAtLastWrite: meta.recordCountAtLastWrite || 0,
            latestFilename: LATEST_FILENAME,
            lastRemindDay: meta.lastRemindDay || null
        };
    }

    async function refreshPermissionFlag() {
        if (!state.directoryHandle) {
            writeMeta({ lastPermissionOk: false });
            return false;
        }
        var ok = await ensurePermission(state.directoryHandle, false);
        return ok;
    }

    async function maybeShowDailyReminder(options) {
        var opts = options || {};
        await ensureReady();
        await refreshPermissionFlag();
        var status = getStatus();
        var reminder = buildReminder(status);
        if (!reminder) {
            if (opts.force) {
                removeRemindBanner();
            }
            return null;
        }
        if (opts.force || shouldShowDailyReminder(reminder)) {
            if (opts.render !== false) {
                renderRemindBanner(reminder);
            }
            return reminder;
        }
        return null;
    }

    async function maybePromptEmptyStoreRecovery() {
        await ensureReady();
        var count = await countPracticeRecords();
        if (count > 0) {
            return false;
        }
        var readable = await hasReadableLatestBackup();
        if (!readable) {
            return false;
        }

        var meta = state.meta || readMeta();
        var today = dayKey(new Date());
        if (meta.lastRestorePromptDay === today) {
            return false;
        }
        writeMeta({ lastRestorePromptDay: today });

        var dirName = (state.meta && state.meta.directoryName) || '备份文件夹';
        var ok = false;
        try {
            ok = global.confirm(
                '检测到浏览器内练习记录为空，但本地备份文件夹「' + dirName +
                '」中有 ' + LATEST_FILENAME + '。是否立即恢复？'
            );
        } catch (_) {
            ok = false;
        }
        if (!ok) {
            return false;
        }
        try {
            await restoreFromLatest({ interactive: true });
            notify('已从本地备份文件夹恢复数据', 'success');
            try {
                if (typeof global.updateOverview === 'function') {
                    global.updateOverview();
                }
            } catch (_) { /* ignore */ }
            try {
                global.dispatchEvent(new CustomEvent('practiceRecordsUpdated', {
                    detail: { source: 'external-backup-restore' }
                }));
            } catch (_) { /* ignore */ }
            return true;
        } catch (error) {
            console.error('[ExternalBackup] restore failed:', error);
            notify('恢复失败：' + (error && error.message ? error.message : error), 'error');
            return false;
        }
    }

    function markDirty() {
        state.dirty = true;
        dispatchStatus();
        scheduleSilentFlush();
    }

    /**
     * When folder permission is already granted, write silently after data changes.
     * Never auto-downloads; never prompts for permission here.
     */
    function scheduleSilentFlush() {
        if (state.silentFlushTimer) {
            global.clearTimeout(state.silentFlushTimer);
        }
        state.silentFlushTimer = global.setTimeout(function () {
            state.silentFlushTimer = null;
            flushSilentlyIfPermitted().catch(function (error) {
                console.warn('[ExternalBackup] silent flush failed:', error);
            });
        }, 8000);
    }

    async function flushSilentlyIfPermitted() {
        await ensureReady();
        if (!state.directoryHandle || !state.dirty || state.writing) {
            return { success: false, reason: 'skip' };
        }
        var permitted = await ensurePermission(state.directoryHandle, false);
        if (!permitted) {
            // Permission missing: daily banner handles re-auth; do not prompt here.
            return { success: false, reason: 'permission_denied' };
        }
        return writeToBoundDirectory({ interactive: false, force: false });
    }

    function refreshUi() {
        try {
            if (typeof global.refreshExternalBackupPanel === 'function') {
                global.refreshExternalBackupPanel();
            }
        } catch (_) { /* ignore */ }
        dispatchStatus();
    }

    function formatStatusText(status) {
        if (!status.supported) {
            return '当前环境不支持文件夹绑定（请用 Chrome/Edge 通过 http(s) 打开；file:// 下请用「导出到下载」）。';
        }
        if (!status.bound) {
            return '未绑定本地备份文件夹。绑定后可一键写入磁盘，避免清缓存丢数据。';
        }
        var parts = [];
        parts.push('已绑定：' + (status.directoryName || '文件夹'));
        if (!status.permissionGranted) {
            parts.push('权限失效，需重新授权');
        } else if (status.lastWriteAt) {
            parts.push('上次写入 ' + formatTime(status.lastWriteAt));
            if (status.lastWriteOk === false) {
                parts.push('最近一次写入失败');
            }
        } else {
            parts.push('尚未写入');
        }
        if (status.dirty) {
            parts.push('有未备份的新数据');
        }
        return parts.join(' · ');
    }

    function formatEntryLabel(status) {
        if (!status.supported) {
            return '📁 本地磁盘备份';
        }
        if (!status.bound) {
            return '📁 本地磁盘备份';
        }
        if (!status.permissionGranted) {
            return '📁 本地备份 · 需授权';
        }
        if (status.staleWrite || status.dirty) {
            return '📁 本地备份 · 待更新';
        }
        return '📁 本地备份 · 已就绪';
    }

    var ENTRY_ID = 'external-backup-entry-btn';
    var MODAL_ID = 'external-backup-modal';
    var modalBound = false;

    function getModal() {
        return global.document ? global.document.getElementById(MODAL_ID) : null;
    }

    function openModal() {
        ensureModalDom();
        var modal = getModal();
        if (modal) {
            modal.classList.add('show');
            refreshExternalBackupPanel();
        }
    }

    function closeModal() {
        var modal = getModal();
        if (modal) {
            modal.classList.remove('show');
        }
    }

    function makeActionButton(id, label) {
        var btn = global.document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn data-mgmt-btn';
        btn.id = id;
        btn.textContent = label;
        return btn;
    }

    function ensureEntryButton() {
        var panel = global.document && global.document.querySelector('#settings-view .data-management-panel');
        if (!panel) {
            return null;
        }
        var entry = global.document.getElementById(ENTRY_ID);
        if (entry) {
            return entry;
        }

        var actions = panel.querySelector('.hero-settings-actions');
        if (!actions) {
            return null;
        }

        entry = global.document.createElement('button');
        entry.type = 'button';
        entry.className = 'btn data-mgmt-btn';
        entry.id = ENTRY_ID;
        entry.textContent = '📁 本地磁盘备份';

        // Prefer leading position so the recommended action is easy to find.
        if (actions.firstChild) {
            actions.insertBefore(entry, actions.firstChild);
        } else {
            actions.appendChild(entry);
        }
        return entry;
    }

    function ensureModalDom() {
        if (!global.document || !global.document.body) {
            return null;
        }

        var modal = getModal();
        if (modal) {
            if (!modalBound) {
                bindModalEvents(modal);
            }
            return modal;
        }

        modal = global.document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'theme-modal external-backup-modal shui-secondary-modal shui-secondary-modal--sm';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'external-backup-title');

        var content = global.document.createElement('div');
        content.className = 'theme-modal-content external-backup-modal__content shui-secondary-modal__content';

        var header = global.document.createElement('div');
        header.className = 'theme-modal-header external-backup-modal__header shui-secondary-modal__header';

        var titleGroup = global.document.createElement('div');
        titleGroup.className = 'external-backup-modal__title-group shui-secondary-modal__title-group';

        var eyebrow = global.document.createElement('div');
        eyebrow.className = 'external-backup-modal__eyebrow shui-secondary-modal__eyebrow';
        eyebrow.textContent = 'DISK BACKUP';

        var title = global.document.createElement('h3');
        title.id = 'external-backup-title';
        title.textContent = '本地磁盘备份';

        titleGroup.appendChild(eyebrow);
        titleGroup.appendChild(title);

        var closeBtn = global.document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'theme-modal-close';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.innerHTML = '&times;';

        header.appendChild(titleGroup);
        header.appendChild(closeBtn);

        var body = global.document.createElement('div');
        body.className = 'theme-modal-body external-backup-modal__body shui-secondary-modal__body';

        var host = global.document.createElement('div');
        host.id = 'external-backup-panel';
        host.className = 'external-backup-panel external-backup-panel--modal';

        var desc = global.document.createElement('p');
        desc.className = 'external-backup-panel__desc';
        desc.textContent = '绑定本地文件夹后，可把练习数据写入磁盘 JSON。清浏览器缓存不会删除该文件夹中的文件；已授权时可在后台静默更新；每天最多提醒一次，且不会自动下载。';

        var statusCard = global.document.createElement('div');
        statusCard.className = 'external-backup-status-card';

        var statusLabel = global.document.createElement('div');
        statusLabel.className = 'external-backup-status-card__label';
        statusLabel.textContent = '当前状态';

        var status = global.document.createElement('div');
        status.id = 'external-backup-status';
        status.className = 'external-backup-panel__status';
        status.textContent = '状态加载中…';

        statusCard.appendChild(statusLabel);
        statusCard.appendChild(status);

        var tips = global.document.createElement('ul');
        tips.className = 'external-backup-panel__tips';
        [
            '推荐使用 Chrome / Edge，通过 http(s) 或 localhost 打开',
            'file:// 环境通常无法绑定文件夹，请改用「导出到下载」',
            '应用内备份只防导入误操作，防不了清缓存'
        ].forEach(function (line) {
            var li = global.document.createElement('li');
            li.textContent = line;
            tips.appendChild(li);
        });

        var actions = global.document.createElement('div');
        actions.className = 'external-backup-panel__actions';

        var bindBtn = makeActionButton('external-backup-bind-btn', '📁 绑定备份文件夹');
        var writeBtn = makeActionButton('external-backup-write-btn', '💾 立即写入备份');
        var restoreBtn = makeActionButton('external-backup-restore-btn', '♻️ 从文件夹恢复');
        var unbindBtn = makeActionButton('external-backup-unbind-btn', '🔓 解除绑定');
        unbindBtn.classList.add('external-backup-btn--ghost');

        actions.appendChild(bindBtn);
        actions.appendChild(writeBtn);
        actions.appendChild(restoreBtn);
        actions.appendChild(unbindBtn);

        host.appendChild(desc);
        host.appendChild(statusCard);
        host.appendChild(tips);
        host.appendChild(actions);
        body.appendChild(host);

        content.appendChild(header);
        content.appendChild(body);
        modal.appendChild(content);
        global.document.body.appendChild(modal);

        bindBtn.addEventListener('click', async function () {
            try {
                await ensureReady();
                var result = await bindDirectory({ writeNow: true });
                if (result.writeResult && result.writeResult.success) {
                    notify('已绑定并写入：' + result.directoryName, 'success');
                } else {
                    notify('已绑定：' + result.directoryName, 'success');
                }
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    notify('已取消选择文件夹', 'info');
                } else {
                    notify(error && error.message ? error.message : '绑定失败', 'error');
                }
            } finally {
                refreshExternalBackupPanel();
            }
        });

        writeBtn.addEventListener('click', async function () {
            try {
                await ensureReady();
                var result = await writeToBoundDirectory({ interactive: true, force: true });
                if (result.success) {
                    notify(result.skipped ? '备份内容无变化' : ('已写入 ' + (result.filename || LATEST_FILENAME)), 'success');
                } else if (result.reason === 'unbound') {
                    notify('请先绑定备份文件夹', 'warning');
                } else if (result.reason === 'permission_denied') {
                    notify('需要允许文件夹访问权限', 'warning');
                } else {
                    notify('写入失败：' + (result.error && result.error.message ? result.error.message : result.reason), 'error');
                }
            } catch (error) {
                notify(error && error.message ? error.message : '写入失败', 'error');
            } finally {
                refreshExternalBackupPanel();
            }
        });

        restoreBtn.addEventListener('click', async function () {
            try {
                await ensureReady();
                var statusNow = getStatus();
                if (!statusNow.bound) {
                    await pickAndRestoreFile();
                    notify('已从文件恢复（或已打开导入流程）', 'success');
                    return;
                }
                var ok = true;
                try {
                    ok = global.confirm('将用文件夹中的 ' + LATEST_FILENAME + ' 覆盖/恢复练习数据，是否继续？');
                } catch (_) { /* ignore */ }
                if (!ok) {
                    return;
                }
                await restoreFromLatest({ interactive: true });
                notify('已从本地备份文件夹恢复', 'success');
                try {
                    if (typeof global.updateOverview === 'function') {
                        global.updateOverview();
                    }
                } catch (_) { /* ignore */ }
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    notify('已取消', 'info');
                } else {
                    notify(error && error.message ? error.message : '恢复失败', 'error');
                }
            } finally {
                refreshExternalBackupPanel();
            }
        });

        unbindBtn.addEventListener('click', async function () {
            try {
                await ensureReady();
                var ok = true;
                try {
                    ok = global.confirm('解除绑定后将不再写入该文件夹（磁盘上的备份文件仍保留）。确定？');
                } catch (_) { /* ignore */ }
                if (!ok) {
                    return;
                }
                await unbindDirectory();
                notify('已解除绑定', 'info');
            } catch (error) {
                notify(error && error.message ? error.message : '解除绑定失败', 'error');
            } finally {
                refreshExternalBackupPanel();
            }
        });

        bindModalEvents(modal);
        return modal;
    }

    function bindModalEvents(modal) {
        if (!modal || modalBound) {
            return;
        }
        modalBound = true;

        var closeBtn = modal.querySelector('.theme-modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        modal.addEventListener('click', function (event) {
            if (event.target === modal) {
                closeModal();
            }
        });
        global.document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && modal.classList.contains('show')) {
                closeModal();
            }
        });

        var entry = ensureEntryButton();
        if (entry && !entry.__externalBackupBound) {
            entry.__externalBackupBound = true;
            entry.addEventListener('click', function (event) {
                event.preventDefault();
                openModal();
            });
        }
    }

    function ensurePanelDom() {
        // Compact entry on settings page + secondary modal body.
        ensureEntryButton();
        var modal = ensureModalDom();
        return modal ? modal.querySelector('#external-backup-panel') : null;
    }

    function refreshExternalBackupPanel() {
        var host = ensurePanelDom();
        var status = getStatus();

        var entry = global.document && global.document.getElementById(ENTRY_ID);
        if (entry) {
            entry.textContent = formatEntryLabel(status);
            entry.dataset.state = status.bound
                ? (status.permissionGranted ? (status.staleWrite || status.dirty ? 'stale' : 'ok') : 'need-auth')
                : (status.supported ? 'unbound' : 'unsupported');
            entry.title = formatStatusText(status);
        }

        if (!host) {
            return;
        }

        var statusEl = host.querySelector('#external-backup-status');
        if (statusEl) {
            statusEl.textContent = formatStatusText(status);
            statusEl.dataset.state = status.bound
                ? (status.permissionGranted ? (status.staleWrite || status.dirty ? 'stale' : 'ok') : 'need-auth')
                : (status.supported ? 'unbound' : 'unsupported');
        }

        var writeBtn = host.querySelector('#external-backup-write-btn');
        var unbindBtn = host.querySelector('#external-backup-unbind-btn');
        var restoreBtn = host.querySelector('#external-backup-restore-btn');
        var bindBtn = host.querySelector('#external-backup-bind-btn');

        if (bindBtn) {
            bindBtn.disabled = !status.supported;
            bindBtn.textContent = status.bound ? '📁 更换备份文件夹' : '📁 绑定备份文件夹';
        }
        if (writeBtn) {
            writeBtn.disabled = !status.bound || status.writing;
        }
        if (unbindBtn) {
            unbindBtn.disabled = !status.bound;
        }
        if (restoreBtn) {
            restoreBtn.disabled = false;
        }
    }

    function onStorageSync(event) {
        var key = event && event.detail ? event.detail.key : null;
        if (!key || key === '*' || key === 'practice_records' || key === 'user_stats' ||
            String(key).indexOf('practice') !== -1 || String(key).indexOf('vocab') !== -1) {
            markDirty();
        }
    }

    async function ensureReady() {
        if (state.ready) {
            return true;
        }
        if (state.readyPromise) {
            return state.readyPromise;
        }
        state.readyPromise = (async function () {
            state.meta = readMeta();
            try {
                var handle = await loadDirectoryHandle();
                if (handle) {
                    state.directoryHandle = handle;
                    var ok = await ensurePermission(handle, false);
                    writeMeta({
                        enabled: true,
                        directoryName: handle.name || state.meta.directoryName || 'backup',
                        lastPermissionOk: ok
                    });
                }
            } catch (error) {
                console.warn('[ExternalBackup] load handle failed:', error);
            }
            state.ready = true;
            return true;
        })();
        return state.readyPromise;
    }

    async function init() {
        await ensureReady();
        ensurePanelDom();
        refreshExternalBackupPanel();
        await requestPersistentStorage();

        // Daily reminder + empty-store recovery (deferred so PracticeRecordAPI can boot)
        global.setTimeout(function () {
            maybeShowDailyReminder({ render: true }).catch(function (error) {
                console.warn('[ExternalBackup] daily reminder failed:', error);
            });
            maybePromptEmptyStoreRecovery().catch(function (error) {
                console.warn('[ExternalBackup] recovery prompt failed:', error);
            });
        }, 1800);

        // Re-check when user returns to the tab (still at most once/day)
        if (global.document) {
            global.document.addEventListener('visibilitychange', function () {
                if (global.document.visibilityState === 'visible') {
                    maybeShowDailyReminder({ render: true }).catch(function () { /* ignore */ });
                    refreshExternalBackupPanel();
                } else if (global.document.visibilityState === 'hidden') {
                    // Best-effort silent write when leaving the tab (no permission prompt)
                    flushSilentlyIfPermitted().catch(function () { /* ignore */ });
                }
            });
        }
    }

    // Listen for data changes early
    try {
        global.addEventListener('storage-sync', onStorageSync);
        global.addEventListener('practiceRecordsUpdated', markDirty);
    } catch (_) { /* ignore */ }

    global.ExternalBackupService = {
        __stable: true,
        LATEST_FILENAME: LATEST_FILENAME,
        supportsFileSystemAccess: supportsFileSystemAccess,
        ensureReady: ensureReady,
        init: init,
        openModal: openModal,
        closeModal: closeModal,
        bindDirectory: bindDirectory,
        unbindDirectory: unbindDirectory,
        writeNow: function (options) {
            return writeToBoundDirectory(Object.assign({ interactive: true, force: true }, options || {}));
        },
        restoreFromLatest: restoreFromLatest,
        pickAndRestoreFile: pickAndRestoreFile,
        getStatus: getStatus,
        formatStatusText: formatStatusText,
        maybeShowDailyReminder: maybeShowDailyReminder,
        maybePromptEmptyStoreRecovery: maybePromptEmptyStoreRecovery,
        markDirty: markDirty,
        flushSilentlyIfPermitted: flushSilentlyIfPermitted,
        refreshPanel: refreshExternalBackupPanel,
        requestPersistentStorage: requestPersistentStorage
    };

    global.refreshExternalBackupPanel = refreshExternalBackupPanel;

    function boot() {
        init().catch(function (error) {
            console.warn('[ExternalBackup] init failed:', error);
        });
    }

    if (global.document && global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(typeof window !== 'undefined' ? window : globalThis);
