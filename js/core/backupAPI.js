(function initBackupAPI(global) {
    'use strict';

    if (global.BackupAPI && global.BackupAPI.__stable === true) {
        return;
    }

    const DEFAULT_VERSION = '0.6.2-form';
    const DEFAULT_MAX_BACKUPS = 20;

    function isPlainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    function cloneJson(value) {
        if (value == null) return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function getStorageFacade() {
        if (global.storage && typeof global.storage.get === 'function') {
            return global.storage;
        }
        // Some boot paths / VM tests expose bare global storage without attaching to window
        try {
            if (typeof storage !== 'undefined' && storage && typeof storage.get === 'function') {
                return storage;
            }
        } catch (_) { /* ignore ReferenceError in strict scopes */ }
        return null;
    }

    function getRepositories() {
        if (global.dataRepositories && global.dataRepositories.backups) {
            return global.dataRepositories;
        }
        const registry = global.StorageProviderRegistry;
        if (registry && typeof registry.getCurrentProviders === 'function') {
            const current = registry.getCurrentProviders();
            if (current && current.repositories && current.repositories.backups) {
                return current.repositories;
            }
        }
        if (global.simpleStorageWrapper && global.simpleStorageWrapper.backupRepo) {
            return {
                backups: global.simpleStorageWrapper.backupRepo,
                meta: global.simpleStorageWrapper.metaRepo || null,
                settings: global.simpleStorageWrapper.settingsRepo || null
            };
        }
        return null;
    }

    function getBackupRepo() {
        const repos = getRepositories();
        return repos && repos.backups ? repos.backups : null;
    }

    function getMetaRepo() {
        const repos = getRepositories();
        return repos && repos.meta ? repos.meta : null;
    }

    async function readMeta(key, fallback = null) {
        const meta = getMetaRepo();
        if (meta && typeof meta.get === 'function') {
            return await meta.get(key, fallback);
        }
        const storageFacade = getStorageFacade();
        if (storageFacade) {
            return await storageFacade.get(key, fallback);
        }
        return fallback;
    }

    async function writeMeta(key, value) {
        const meta = getMetaRepo();
        if (meta && typeof meta.set === 'function') {
            await meta.set(key, value);
            return true;
        }
        const storageFacade = getStorageFacade();
        if (storageFacade) {
            await storageFacade.set(key, value);
            return true;
        }
        throw new Error('BackupAPI: meta store not ready');
    }

    function resolvePracticeRecords(data) {
        if (!data || typeof data !== 'object') return null;
        if (Array.isArray(data.practice_records)) return data.practice_records;
        if (Array.isArray(data.practiceRecords)) return data.practiceRecords;
        return null;
    }

    function resolveUserStats(data) {
        if (!data || typeof data !== 'object') return null;
        if (isPlainObject(data.user_stats)) return data.user_stats;
        if (isPlainObject(data.userStats)) return data.userStats;
        return null;
    }

    function resolveExamIndex(data) {
        if (!data || typeof data !== 'object') return null;
        if (Array.isArray(data.exam_index)) return data.exam_index;
        if (Array.isArray(data.examIndex)) return data.examIndex;
        return null;
    }

    function resolveStorageVersion(data) {
        if (!data || typeof data !== 'object') return null;
        if (data.storage_version != null) return data.storage_version;
        if (data.storageVersion != null) return data.storageVersion;
        return null;
    }

    /**
     * Canonical dual-schema payload so any legacy restore path can read snake or camel keys.
     */
    function normalizePayload(data = {}) {
        const source = isPlainObject(data) ? data : {};
        const records = resolvePracticeRecords(source);
        const stats = resolveUserStats(source);
        const examIndex = resolveExamIndex(source);
        const storageVersion = resolveStorageVersion(source);
        const payload = { ...source };

        if (records) {
            payload.practice_records = records;
            payload.practiceRecords = records;
        }
        if (stats) {
            payload.user_stats = stats;
            payload.userStats = stats;
        }
        if (examIndex) {
            payload.exam_index = examIndex;
            payload.examIndex = examIndex;
        }
        if (storageVersion != null) {
            payload.storage_version = storageVersion;
            payload.storageVersion = storageVersion;
        }
        return payload;
    }

    async function captureSnapshot(extra = {}) {
        let practiceRecords = [];
        let userStats = null;

        if (global.PracticeRecordAPI && typeof global.PracticeRecordAPI.list === 'function') {
            const listed = await global.PracticeRecordAPI.list();
            practiceRecords = Array.isArray(listed) ? listed : [];
        }
        if (global.PracticeRecordAPI && typeof global.PracticeRecordAPI.readStats === 'function') {
            userStats = await global.PracticeRecordAPI.readStats();
        }

        const examIndex = await readMeta('exam_index', []);
        const storageVersion = await readMeta('storage_version', null);

        return normalizePayload({
            practice_records: practiceRecords,
            user_stats: userStats,
            exam_index: Array.isArray(examIndex) ? examIndex : [],
            storage_version: storageVersion,
            ...(isPlainObject(extra) ? extra : {})
        });
    }

    async function list(options = {}) {
        const repo = getBackupRepo();
        if (repo && typeof repo.list === 'function') {
            const backups = await repo.list(options);
            return Array.isArray(backups) ? backups : [];
        }
        const storageFacade = getStorageFacade();
        if (storageFacade) {
            const backups = await storageFacade.get('manual_backups', []);
            return Array.isArray(backups) ? backups : [];
        }
        throw new Error('BackupAPI.list: backup repository not ready');
    }

    async function getById(id, options = {}) {
        if (!id) return null;
        const repo = getBackupRepo();
        if (repo && typeof repo.getById === 'function') {
            return await repo.getById(id, options);
        }
        const backups = await list(options);
        return backups.find((item) => item && String(item.id) === String(id)) || null;
    }

    async function add(backup, options = {}) {
        const repo = getBackupRepo();
        const normalizedData = normalizePayload(backup && backup.data ? backup.data : {});
        const entry = {
            ...(backup && typeof backup === 'object' ? backup : {}),
            id: (backup && backup.id) || `backup_${Date.now()}`,
            timestamp: (backup && backup.timestamp) || new Date().toISOString(),
            type: (backup && backup.type) || 'manual',
            version: (backup && backup.version) || DEFAULT_VERSION,
            data: normalizedData
        };
        entry.size = entry.size || JSON.stringify(entry.data).length;

        if (repo && typeof repo.add === 'function') {
            return await repo.add(entry, options);
        }

        // Fallback: raw storage (tests / early boot)
        const storageFacade = getStorageFacade();
        if (storageFacade) {
            const backups = await storageFacade.get('manual_backups', []);
            const list = Array.isArray(backups) ? backups.slice() : [];
            list.unshift(entry);
            const max = options.maxBackups || DEFAULT_MAX_BACKUPS;
            while (list.length > max) {
                list.pop();
            }
            await storageFacade.set('manual_backups', list);
            return entry;
        }

        throw new Error('BackupAPI.add: backup repository not ready');
    }

    async function create(options = {}) {
        const {
            id = null,
            type = 'manual',
            data = null,
            extra = null,
            version = DEFAULT_VERSION
        } = options;

        const snapshot = data != null
            ? normalizePayload(data)
            : await captureSnapshot(extra || {});

        const backupId = id || `backup_${Date.now()}`;
        const entry = await add({
            id: backupId,
            timestamp: new Date().toISOString(),
            type,
            version,
            data: snapshot
        });

        return entry && entry.id ? entry.id : backupId;
    }

    async function restorePayload(data, options = {}) {
        const payload = normalizePayload(data || {});
        const records = resolvePracticeRecords(payload);
        const stats = resolveUserStats(payload);
        const examIndex = resolveExamIndex(payload);
        const storageVersion = resolveStorageVersion(payload);
        const restoreRecords = options.restoreRecords !== false;
        const restoreExamIndex = options.restoreExamIndex !== false;
        const restoreStorageVersion = options.restoreStorageVersion !== false;

        if (restoreRecords && records != null) {
            if (global.PracticeRecordAPI && typeof global.PracticeRecordAPI.restoreRecords === 'function') {
                await global.PracticeRecordAPI.restoreRecords(records, {
                    stats: isPlainObject(stats) ? stats : null,
                    updateStats: true
                });
            } else {
                throw new Error('BackupAPI.restore: PracticeRecordAPI.restoreRecords not ready');
            }
        } else if (isPlainObject(stats) && global.PracticeRecordAPI && typeof global.PracticeRecordAPI.resetStats === 'function') {
            await global.PracticeRecordAPI.resetStats(stats);
        }

        if (restoreExamIndex && examIndex) {
            await writeMeta('exam_index', examIndex);
        }

        if (restoreStorageVersion && storageVersion != null) {
            await writeMeta('storage_version', storageVersion);
        }

        // Optional system settings (DataIntegrityManager snapshots)
        if (isPlainObject(payload.system_settings)) {
            const repos = getRepositories();
            if (repos && repos.settings && typeof repos.settings.getAll === 'function') {
                const current = await repos.settings.getAll();
                await repos.settings.saveAll({ ...current, ...payload.system_settings });
            }
        }

        return {
            restoredRecords: records != null,
            restoredStats: isPlainObject(stats),
            restoredExamIndex: Boolean(restoreExamIndex && examIndex),
            restoredStorageVersion: Boolean(restoreStorageVersion && storageVersion != null)
        };
    }

    async function restore(backupId, options = {}) {
        if (!backupId) {
            throw new Error('BackupAPI.restore: invalid backup id');
        }
        const backup = await getById(backupId);
        if (!backup) {
            throw new Error(`BackupAPI.restore: backup ${backupId} not found`);
        }
        const result = await restorePayload(backup.data || {}, options);
        return { backup, ...result };
    }

    async function clear(options = {}) {
        const repo = getBackupRepo();
        if (repo && typeof repo.clear === 'function') {
            await repo.clear(options);
            return true;
        }
        const storageFacade = getStorageFacade();
        if (storageFacade) {
            await storageFacade.set('manual_backups', []);
            return true;
        }
        throw new Error('BackupAPI.clear: backup repository not ready');
    }

    async function remove(id, options = {}) {
        const repo = getBackupRepo();
        if (repo && typeof repo.delete === 'function') {
            return await repo.delete(id, options);
        }
        const backups = await list();
        const next = backups.filter((item) => item && String(item.id) !== String(id));
        if (next.length === backups.length) return false;
        if (repo && typeof repo.saveAll === 'function') {
            await repo.saveAll(next, options);
            return true;
        }
        const storageFacade = getStorageFacade();
        if (storageFacade) {
            await storageFacade.set('manual_backups', next);
            return true;
        }
        return false;
    }

    async function prune(limit, options = {}) {
        const repo = getBackupRepo();
        if (repo && typeof repo.prune === 'function') {
            return await repo.prune(limit, options);
        }
        const max = typeof limit === 'number' && limit > 0 ? limit : DEFAULT_MAX_BACKUPS;
        const backups = await list();
        if (backups.length <= max) return backups.length;
        const next = backups.slice(0, max);
        if (repo && typeof repo.saveAll === 'function') {
            await repo.saveAll(next, options);
        } else {
            const storageFacade = getStorageFacade();
            if (storageFacade) {
                await storageFacade.set('manual_backups', next);
            }
        }
        return next.length;
    }

    global.BackupAPI = {
        __stable: true,
        version: DEFAULT_VERSION,
        list,
        getById,
        add,
        create,
        captureSnapshot,
        normalizePayload,
        restore,
        restorePayload,
        clear,
        remove,
        prune,
        resolvePracticeRecords,
        resolveUserStats,
        resolveExamIndex,
        resolveStorageVersion
    };
})(typeof window !== 'undefined' ? window : globalThis);
