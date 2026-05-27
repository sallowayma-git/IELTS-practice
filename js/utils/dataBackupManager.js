/**
 * Data backup and recovery manager.
 * Provides export/import/cleanup functionality for the shared storage layer.
 */
class DataBackupManager {
    constructor() {
        this.storageKeys = {
            backupSettings: 'backup_settings',
            exportHistory: 'export_history',
            importHistory: 'import_history',
            manualBackups: 'manual_backups'
        };

        this.supportedFormats = ['json', 'csv'];
        this.maxBackupHistory = 20;
        this.maxExportHistory = 50;

        this.initialize();
    }

    sanitizeExamTitle(title) {
        if (!title) return '';
        const str = String(title).trim();
        if (!str) return '';
        const pattern = /ielts\s+listening\s+practice\s*-\s*part\s*\d+\s*[:\-]?\s*(.+)$/i;
        const match = str.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
        if (str.includes(' - ')) {
            const segments = str.split(' - ').map((s) => s.trim()).filter(Boolean);
            if (segments.length > 1) {
                return segments[segments.length - 1];
            }
        }
        return str;
    }

    sanitizeRecord(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        const clone = { ...record };
        const metadata = (clone.metadata && typeof clone.metadata === 'object') ? { ...clone.metadata } : {};
        const baseTitle = metadata.examTitle || metadata.title || clone.title || clone.examTitle;
        const cleanedTitle = this.sanitizeExamTitle(baseTitle);
        if (cleanedTitle) {
            metadata.examTitle = cleanedTitle;
            metadata.title = metadata.title || cleanedTitle;
            clone.title = cleanedTitle;
            if (!clone.examTitle) {
                clone.examTitle = cleanedTitle;
            }
            clone.metadata = metadata;
        }
        return clone;
    }

    async initialize() {
        try {
            await this.initializeSettings();
        } catch (error) {
            console.error('[DataBackupManager] failed to initialize settings', error);
        }

        this.setupPeriodicCleanup();
    }

    async initializeSettings() {
        const defaults = {
            autoBackup: true,
            backupInterval: 24,
            maxBackups: 10,
            compressionEnabled: false,
            encryptionEnabled: false,
            lastAutoBackup: null
        };

        try {
            const stored = await storage.get(this.storageKeys.backupSettings, defaults);
            await storage.set(this.storageKeys.backupSettings, { ...defaults, ...stored });
        } catch (error) {
            console.error('[DataBackupManager] unable to persist settings', error);
        }
    }

    async listPracticeRecords() {
        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.list === 'function') {
            return await window.PracticeRecordAPI.list();
        }

        throw new Error('统一练习记录存储未就绪');
    }

    async replacePracticeRecords(records, options = {}) {
        const normalizedRecords = Array.isArray(records) ? records : [];

        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.replace === 'function') {
            await window.PracticeRecordAPI.replace(normalizedRecords, options);
            return true;
        }

        throw new Error('统一练习记录存储未就绪');
    }

    async restorePracticeRecords(records, stats = null) {
        const normalizedRecords = Array.isArray(records) ? records : [];

        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.restoreRecords === 'function') {
            return await window.PracticeRecordAPI.restoreRecords(normalizedRecords, {
                stats: this.isPlainObject(stats) ? stats : null,
                updateStats: true
            });
        }

        throw new Error('统一练习记录恢复 API 未就绪');
    }

    async readUserStats() {
        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.readStats === 'function') {
            return await window.PracticeRecordAPI.readStats();
        }

        throw new Error('统一练习统计 API 未就绪');
    }

    async mergeUserStats(stats, mergeMode = 'merge') {
        if (!this.isPlainObject(stats)) {
            return await this.readUserStats();
        }

        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.mergeStats === 'function') {
            return await window.PracticeRecordAPI.mergeStats(stats, { mergeMode });
        }

        throw new Error('统一练习统计 API 未就绪');
    }

    async resetUserStats(stats = null) {
        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.resetStats === 'function') {
            return await window.PracticeRecordAPI.resetStats(stats);
        }

        throw new Error('统一练习统计 API 未就绪');
    }

    async createBackup(backupName = null, type = 'manual') {
        const backup = {
            id: backupName || `backup_${Date.now()}`,
            timestamp: new Date().toISOString(),
            type,
            data: {
                practice_records: await this.listPracticeRecords(),
                user_stats: await this.readUserStats(),
                exam_index: await storage.get('exam_index', [])
            }
        };

        const backups = await storage.get(this.storageKeys.manualBackups, []);
        backups.unshift(backup);
        while (backups.length > this.maxBackupHistory) {
            backups.pop();
        }
        await storage.set(this.storageKeys.manualBackups, backups);
        return backup.id;
    }

    async exportPracticeRecords(options = {}) {
        const {
            format = 'json',
            includeStats = true,
            includeBackups = false,
            dateRange = null,
            categories = null,
            compression = false
        } = options;

        const normalizedFormat = String(format).toLowerCase();
        if (!this.supportedFormats.includes(normalizedFormat)) {
            throw new Error(`Unsupported export format: ${format}`);
        }

        let practiceRecords = await this.listPracticeRecords();
        practiceRecords = Array.isArray(practiceRecords) ? practiceRecords : [];

        if (dateRange) {
            practiceRecords = this.filterByDateRange(practiceRecords, dateRange);
        }

        if (Array.isArray(categories) && categories.length) {
            practiceRecords = practiceRecords.filter(record => categories.includes(record?.metadata?.category));
        }

        const exportPayload = {
            exportInfo: {
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                format: normalizedFormat,
                recordCount: practiceRecords.length,
                options: { format, includeStats, includeBackups, dateRange, categories }
            },
            practiceRecords
        };

        if (includeStats) {
            exportPayload.userStats = await this.readUserStats();
        }

        if (includeBackups && window.practiceRecorder && typeof window.practiceRecorder.getBackups === 'function') {
            exportPayload.backups = window.practiceRecorder.getBackups();
        }

        await this.recordExportHistory(exportPayload.exportInfo);

        switch (normalizedFormat) {
            case 'json':
                return this.exportAsJSON(exportPayload, compression);
            case 'csv':
                return this.exportAsCSV(exportPayload);
            default:
                throw new Error(`Format ${format} not implemented`);
        }
    }

    exportAsJSON(data, compressionEnabled = false) {
        const raw = JSON.stringify(data, null, 2);
        const payload = compressionEnabled ? this.compressData(raw) : raw;

        return {
            data: payload,
            filename: `practice_records_${this.getTimestamp()}.json`,
            mimeType: 'application/json',
            size: payload.length,
            compressed: compressionEnabled
        };
    }

    exportAsCSV(data) {
        const records = Array.isArray(data.practiceRecords) ? data.practiceRecords : [];
        const headers = [
            'record_id',
            'exam_id',
            'title',
            'status',
            'score',
            'accuracy',
            'duration_seconds',
            'start_time',
            'end_time',
            'category',
            'frequency',
            'created_at'
        ];

        const rows = records.map(record => {
            const metadata = record?.metadata || {};
            return [
                record?.id ?? '',
                record?.examId ?? '',
                record?.title ?? '',
                record?.status ?? '',
                record?.score ?? '',
                record?.accuracy ?? '',
                record?.duration ?? '',
                record?.startTime ?? '',
                record?.endTime ?? '',
                metadata.category ?? '',
                metadata.frequency ?? '',
                record?.createdAt ?? ''
            ];
        });

        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');

        return {
            data: csvContent,
            filename: `practice_records_${this.getTimestamp()}.csv`,
            mimeType: 'text/csv',
            size: csvContent.length
        };
    }
    /**
     * Legacy-friendly wrapper.
     */
    async importPracticeRecords(source, options = {}) {
        return this.importPracticeData(source, options);
    }

    async importPracticeData(source, options = {}) {
        console.log('[DataBackupManager] importPracticeData called, source type:', typeof source, 'length:', Array.isArray(source) ? source.length : source.practiceRecords?.length);
        const {
            mergeMode = 'merge',
            createBackup = true,
            preserveIds = true
        } = options;

        let payload;
        try {
            payload = await this.parseImportSource(source, { allowFetch: true });
        } catch (error) {
            throw new Error(`Failed to read import source: ${error.message}`);
        }

        const normalized = this.normalizeImportPayload(payload, { preserveIds });
        console.log('[DataBackupManager] Normalized records:', normalized.practiceRecords.length);

        let practiceRecords = Array.isArray(normalized.practiceRecords) ? normalized.practiceRecords : [];

        if (!practiceRecords.length) {
            throw new Error('Import file does not contain any practice records.');
        }

        practiceRecords = practiceRecords.map((r) => this.sanitizeRecord(r));
        normalized.practiceRecords = practiceRecords;
        console.log('[DataBackupManager] After sanitize, records:', normalized.practiceRecords.length);

        let backupId = null;
        if (createBackup) {
            backupId = await this.createPreImportBackup();
            console.log('[DataBackupManager] Pre-import backup created:', backupId);
        }

        let mergeResult;
        try {
            mergeResult = await this.mergePracticeRecords(normalized.practiceRecords, mergeMode);
            console.log('[DataBackupManager] Practice records imported through PracticeRecordAPI');

            if (normalized.userStats) {
                await this.mergeUserStats(normalized.userStats, mergeMode);
            }
        } catch (error) {
            if (backupId) {
                try {
                    await this.restoreBackup(backupId);
                } catch (restoreError) {
                    console.error('[DataBackupManager] failed to restore backup after import error', restoreError);
                }
            }

            await this.recordImportHistory({
                timestamp: new Date().toISOString(),
                mergeMode,
                backupId,
                success: false,
                error: error.message
            });
            throw error;
        }

        await this.recordImportHistory({
            timestamp: new Date().toISOString(),
            recordCount: mergeResult.importedCount,
            mergeMode,
            backupId,
            sources: normalized.sources,
            success: true
        });

        return {
            success: true,
            ...mergeResult,
            backupId,
            statsImported: Boolean(normalized.userStats),
            sources: normalized.sources
        };
    }

    async parseImportSource(source, { allowFetch = false } = {}) {
        if (source === undefined || source === null) {
            throw new Error('Import source is empty.');
        }

        if (typeof File !== 'undefined' && source instanceof File) {
            return this.parseImportSource(await source.text(), { allowFetch });
        }

        if (typeof Blob !== 'undefined' && source instanceof Blob) {
            return this.parseImportSource(await source.text(), { allowFetch });
        }

        if (typeof source === 'string') {
            const trimmed = source.trim();
            if (!trimmed) {
                throw new Error('Import source string is empty.');
            }

            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    return JSON.parse(trimmed);
                } catch (error) {
                    throw new Error('Import string is not valid JSON.');
                }
            }

            if (!allowFetch) {
                throw new Error('Import string is neither JSON nor a fetchable path.');
            }

            const response = await fetch(trimmed);
            if (!response.ok) {
                throw new Error(`Failed to fetch import file: ${response.status}`);
            }
            return await response.json();
        }

        if (Array.isArray(source) || this.isPlainObject(source)) {
            return source;
        }

        throw new Error('Unsupported import source type.');
    }

    normalizeImportPayload(payload, { preserveIds = true } = {}) {
        if (payload === undefined || payload === null) {
            throw new Error('Import data is empty.');
        }

        const practiceRecords = [];
        const sources = [];
        let userStats = null;

        if (this.isPlainObject(payload)) {
            const directStats = payload.user_stats
                ?? payload.userStats
                ?? payload.stats
                ?? payload.data?.user_stats
                ?? payload.data?.userStats
                ?? payload.data?.stats;
            if (this.isPlainObject(directStats)) {
                userStats = this.prepareUserStats(directStats);
            }
        }

        this.extractRecordSources(payload).forEach(({ records, source }) => {
            const normalizedRecords = records
                .map((record, index) => this.normalizeRecord(record, {
                    preserveIds,
                    fallbackIdPrefix: source || 'record',
                    index
                }))
                .filter(Boolean);

            if (normalizedRecords.length) {
                practiceRecords.push(...normalizedRecords);
                sources.push({ path: source || '(root array)', count: normalizedRecords.length });
            }
        });

        return {
            practiceRecords,
            userStats,
            sources
        };
    }

    extractRecordSources(payload) {
        const sources = [];
        const add = (source, records) => {
            if (Array.isArray(records) && records.some(item => this.isPlainObject(item))) {
                sources.push({ source, records });
            }
        };

        if (Array.isArray(payload)) {
            add('(root array)', payload);
            return sources;
        }
        if (!this.isPlainObject(payload)) {
            return sources;
        }

        add('practice_records', payload.practice_records);
        add('practiceRecords', payload.practiceRecords);

        const data = this.isPlainObject(payload.data) ? payload.data : {};
        add('data.practice_records', data.practice_records);
        add('data.practiceRecords', data.practiceRecords);
        if (this.isPlainObject(data.practice_records)) {
            add('data.practice_records.data', data.practice_records.data);
        }
        if (this.isPlainObject(data.exam_system_practice_records)) {
            add('data.exam_system_practice_records.data', data.exam_system_practice_records.data);
        }
        if (this.isPlainObject(payload.exam_system_practice_records)) {
            add('exam_system_practice_records.data', payload.exam_system_practice_records.data);
        }

        return sources;
    }

    async mergePracticeRecords(newRecords, mergeMode = 'merge') {
        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.mergeRecords === 'function') {
            return await window.PracticeRecordAPI.mergeRecords(
                Array.isArray(newRecords) ? newRecords : [],
                { mergeMode, updateStats: true }
            );
        }

        throw new Error('统一练习记录导入 API 未就绪');
    }

    prepareUserStats(candidate) {
        if (!this.isPlainObject(candidate)) {
            return null;
        }
        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.prepareStats === 'function') {
            return window.PracticeRecordAPI.prepareStats(candidate);
        }
        throw new Error('统一练习统计 API 未就绪');
    }

    normalizeRecord(record, options = {}) {
        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.normalizeRecord === 'function') {
            return window.PracticeRecordAPI.normalizeRecord(record, options);
        }
        throw new Error('统一练习记录标准化 API 未就绪');
    }
    normalizeDateValue(value) {
        if (!value) {
            return null;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString();
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            return new Date(value).toISOString();
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }

            if (/^\d+$/.test(trimmed)) {
                const numeric = Number(trimmed);
                if (Number.isFinite(numeric)) {
                    const milliseconds = trimmed.length > 10 ? numeric : numeric * 1000;
                    return new Date(milliseconds).toISOString();
                }
            }

            const parsed = new Date(trimmed);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }

        return null;
    }

    getRecordTimestamp(record) {
        if (!record) {
            return 0;
        }

        const candidates = [
            record.updatedAt,
            record.createdAt,
            record.endTime,
            record.startTime,
            record.timestamp,
            record.date
        ];

        for (const candidate of candidates) {
            const iso = this.normalizeDateValue(candidate);
            if (iso) {
                const time = new Date(iso).getTime();
                if (Number.isFinite(time)) {
                    return time;
                }
            }
        }

        return 0;
    }

    filterByDateRange(records, dateRange) {
        const { startDate, endDate } = dateRange;
        return (records || []).filter(record => {
            const value = this.normalizeDateValue(record?.startTime ?? record?.createdAt ?? record?.timestamp);
            if (!value) {
                return false;
            }

            const recordDate = new Date(value);
            if (startDate && recordDate < new Date(startDate)) {
                return false;
            }
            if (endDate && recordDate > new Date(endDate)) {
                return false;
            }
            return true;
        });
    }

    compressData(data) {
        try {
            if (window.pako && typeof window.pako.gzip === 'function') {
                return window.pako.gzip(data, { to: 'string' });
            }
        } catch (error) {
            console.warn('[DataBackupManager] compression failed', error);
        }
        return data;
    }
    async createPreImportBackup() {
        try {
            const backup = {
                id: `pre_import_${Date.now()}`,
                timestamp: new Date().toISOString(),
                type: 'pre_import',
                data: {
                    practice_records: await this.listPracticeRecords(),
                    user_stats: await this.readUserStats(),
                    exam_index: await storage.get('exam_index', [])
                }
            };

            const backups = await storage.get(this.storageKeys.manualBackups, []);
            backups.push(backup);
            while (backups.length > this.maxBackupHistory) {
                backups.shift();
            }
            await storage.set(this.storageKeys.manualBackups, backups);
            return backup.id;
        } catch (error) {
            console.error('[DataBackupManager] failed to create backup', error);
            return null;
        }
    }

    async restoreBackup(backupId) {
        if (!backupId) {
            throw new Error('Invalid backup id.');
        }

        try {
            const backups = await storage.get(this.storageKeys.manualBackups, []);
            const backup = backups.find(item => item.id === backupId);
            if (!backup) {
                throw new Error(`Backup ${backupId} not found.`);
            }

            const data = backup.data || {};
            const records = Array.isArray(data.practice_records)
                ? data.practice_records
                : (Array.isArray(data.practiceRecords) ? data.practiceRecords : []);
            const stats = this.isPlainObject(data.user_stats)
                ? data.user_stats
                : (this.isPlainObject(data.userStats) ? data.userStats : null);

            await this.restorePracticeRecords(records, stats);

            return backup;
        } catch (error) {
            console.error('[DataBackupManager] backup restore failed', error);
            throw error;
        }
    }

    async clearData(options = {}) {
        const {
            clearPracticeRecords = false,
            clearUserStats = false,
            clearBackups = false,
            clearSettings = false,
            createBackup = true
        } = options;

        let backupId = null;
        if (createBackup) {
            backupId = await this.createPreImportBackup();
        }

        const clearedItems = [];

        if (clearPracticeRecords) {
            await this.replacePracticeRecords([], { updateStats: !clearUserStats });
            clearedItems.push('practice_records');
            if (!clearUserStats) {
                clearedItems.push('user_stats');
            }
        }

        if (clearUserStats) {
            await this.resetUserStats();
            clearedItems.push('user_stats');
        }

        if (clearBackups) {
            await storage.set(this.storageKeys.manualBackups, []);
            if (typeof storage.remove === 'function') {
                await storage.remove('backup_data');
            }
            clearedItems.push('backups');
        }

        if (clearSettings) {
            await storage.remove('settings');
            await storage.remove(this.storageKeys.backupSettings);
            clearedItems.push('settings');
        }

        return {
            success: true,
            clearedItems,
            backupId
        };
    }

    async recordExportHistory(info) {
        const history = await storage.get(this.storageKeys.exportHistory, []);
        history.push({ ...info, id: `export_${Date.now()}` });
        while (history.length > this.maxExportHistory) {
            history.shift();
        }
        await storage.set(this.storageKeys.exportHistory, history);
    }

    async recordImportHistory(info) {
        const history = await storage.get(this.storageKeys.importHistory, []);
        history.push({ ...info, id: `import_${Date.now()}` });
        while (history.length > this.maxExportHistory) {
            history.shift();
        }
        await storage.set(this.storageKeys.importHistory, history);
    }

    async getExportHistory() {
        const history = await storage.get(this.storageKeys.exportHistory, []);
        return history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    async getImportHistory() {
        const history = await storage.get(this.storageKeys.importHistory, []);
        return history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    async getDataStats() {
        try {
            const practiceRecords = await this.listPracticeRecords();
            const userStats = await this.readUserStats();
            const exportHistory = await this.getExportHistory();
            const importHistory = await this.getImportHistory();
            const storageInfo = typeof storage.getStorageInfo === 'function' ? await storage.getStorageInfo() : null;

            const recordsArray = Array.isArray(practiceRecords) ? practiceRecords : [];

            return {
                practiceRecords: {
                    count: recordsArray.length,
                    oldestRecord: recordsArray.length ? recordsArray[0]?.startTime : null,
                    newestRecord: recordsArray.length ? recordsArray[recordsArray.length - 1]?.startTime : null
                },
                userStats: {
                    totalPractices: userStats?.totalPractices ?? 0,
                    totalTimeSpent: userStats?.totalTimeSpent ?? 0,
                    averageScore: userStats?.averageScore ?? 0
                },
                exportHistory: {
                    count: exportHistory.length,
                    lastExport: exportHistory.length ? exportHistory[0].timestamp : null
                },
                importHistory: {
                    count: importHistory.length,
                    lastImport: importHistory.length ? importHistory[0].timestamp : null
                },
                storage: storageInfo
            };
        } catch (error) {
            console.error('[DataBackupManager] failed to collect stats', error);
            return null;
        }
    }

    setupPeriodicCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }

        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredData().catch(error => console.error('[DataBackupManager] cleanup failed', error));
        }, 24 * 60 * 60 * 1000);
    }

    async cleanupExpiredData() {
        try {
            const limit = 30 * 24 * 60 * 60 * 1000;
            const now = Date.now();

            const exportHistory = await storage.get(this.storageKeys.exportHistory, []);
            const freshExports = exportHistory.filter(item => now - new Date(item.timestamp).getTime() < limit);
            if (freshExports.length !== exportHistory.length) {
                await storage.set(this.storageKeys.exportHistory, freshExports);
            }

            const importHistory = await storage.get(this.storageKeys.importHistory, []);
            const freshImports = importHistory.filter(item => now - new Date(item.timestamp).getTime() < limit);
            if (freshImports.length !== importHistory.length) {
                await storage.set(this.storageKeys.importHistory, freshImports);
            }
        } catch (error) {
            console.error('[DataBackupManager] cleanup error', error);
        }
    }

    getTimestamp() {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    }

    toCamelCaseKey(key) {
        return String(key)
            .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, group) => group.toUpperCase())
            .replace(/^[A-Z]/, match => match.toLowerCase());
    }

    isPlainObject(value) {
        return Object.prototype.toString.call(value) === '[object Object]';
    }
}

window.DataBackupManager = DataBackupManager;
