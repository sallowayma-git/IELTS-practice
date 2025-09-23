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

        let practiceRecords = [];
        if (window.practiceRecorder && typeof window.practiceRecorder.getPracticeRecords === 'function') {
            practiceRecords = window.practiceRecorder.getPracticeRecords();
        } else {
            practiceRecords = await storage.get('practice_records', []);
        }

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
            if (window.practiceRecorder && typeof window.practiceRecorder.getUserStats === 'function') {
                exportPayload.userStats = window.practiceRecorder.getUserStats();
            } else {
                exportPayload.userStats = await storage.get('user_stats', {});
            }
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
        const {
            mergeMode = 'merge',
            validateData = true,
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

        if (!normalized.practiceRecords.length) {
            throw new Error('Import file does not contain any practice records.');
        }

        if (validateData) {
            this.validateNormalizedRecords(normalized.practiceRecords);
        }

        let backupId = null;
        if (createBackup) {
            backupId = await this.createPreImportBackup();
        }

        let mergeResult;
        try {
            mergeResult = await this.mergePracticeRecords(normalized.practiceRecords, mergeMode);
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
        const practiceRecords = [];
        const sources = [];
        let userStats = null;
        const visited = new WeakSet();

        const visit = (node, path = []) => {
            if (!node || typeof node !== 'object') {
                return;
            }

            if (visited.has(node)) {
                return;
            }
            visited.add(node);

            if (Array.isArray(node)) {
                if (this.isRecordArray(node)) {
                    const normalized = node
                        .map((record, index) => this.normalizeRecord(record, { preserveIds, fallbackIdPrefix: path.join('.') || 'record', index }))
                        .filter(Boolean);

                    if (normalized.length) {
                        practiceRecords.push(...normalized);
                        sources.push({ path: path.length ? path.join('.') : '(root array)', count: normalized.length });
                    }
                    return;
                }

                node.forEach((item, index) => visit(item, path.concat(index)));
                return;
            }

            if (!this.isPlainObject(node)) {
                return;
            }

            if (!userStats && this.looksLikeUserStats(node)) {
                userStats = this.extractUserStats(node);
            }

            for (const [key, value] of Object.entries(node)) {
                const nextPath = path.concat(String(key));

                if (Array.isArray(value) && this.isRecordArray(value)) {
                    const normalized = value
                        .map((record, index) => this.normalizeRecord(record, { preserveIds, fallbackIdPrefix: nextPath.join('.'), index }))
                        .filter(Boolean);
                    if (normalized.length) {
                        practiceRecords.push(...normalized);
                        sources.push({ path: nextPath.join('.'), count: normalized.length });
                        continue;
                    }
                }

                if (this.isPlainObject(value)) {
                    if (Array.isArray(value.data) && this.isRecordArray(value.data)) {
                        const normalized = value.data
                            .map((record, index) => this.normalizeRecord(record, { preserveIds, fallbackIdPrefix: nextPath.join('.') + '.data', index }))
                            .filter(Boolean);
                        if (normalized.length) {
                            practiceRecords.push(...normalized);
                            sources.push({ path: nextPath.join('.') + '.data', count: normalized.length });
                            continue;
                        }
                    }

                    if (!userStats && this.looksLikeUserStats(value)) {
                        userStats = this.extractUserStats(value);
                    }
                }

                visit(value, nextPath);
            }
        };

        visit(payload, []);

        const deduplicated = this.deduplicateRecords(practiceRecords);

        return {
            practiceRecords: deduplicated,
            userStats,
            sources
        };
    }

    validateNormalizedRecords(records) {
        records.forEach((record, index) => {
            if (!record.id) {
                throw new Error(`Record ${index + 1} is missing an id.`);
            }
            if (!record.examId) {
                throw new Error(`Record ${index + 1} is missing an examId.`);
            }
            if (!record.startTime) {
                throw new Error(`Record ${index + 1} is missing a startTime.`);
            }
            if (Number.isNaN(new Date(record.startTime).getTime())) {
                throw new Error(`Record ${index + 1} has an invalid startTime.`);
            }
        });
    }

    async mergePracticeRecords(newRecords, mergeMode = 'merge') {
        const existingRaw = await storage.get('practice_records', []);
        const existingRecords = Array.isArray(existingRaw) ? existingRaw.slice() : [];

        if (mergeMode === 'replace') {
            await storage.set('practice_records', newRecords);
            return {
                importedCount: newRecords.length,
                updatedCount: existingRecords.length,
                skippedCount: 0,
                finalCount: newRecords.length
            };
        }

        const indexMap = new Map();
        existingRecords.forEach((record, index) => {
            if (record && record.id !== undefined && record.id !== null) {
                indexMap.set(String(record.id), { record, index });
            }
        });

        let importedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        const mergedRecords = existingRecords.slice();

        for (const record of newRecords) {
            if (!record || record.id === undefined || record.id === null) {
                continue;
            }

            const key = String(record.id);
            const existing = indexMap.get(key);

            if (!existing) {
                mergedRecords.push(record);
                indexMap.set(key, { record, index: mergedRecords.length - 1 });
                importedCount += 1;
                continue;
            }

            if (mergeMode === 'skip') {
                skippedCount += 1;
                continue;
            }

            const existingTimestamp = this.getRecordTimestamp(existing.record);
            const incomingTimestamp = this.getRecordTimestamp(record);

            if (incomingTimestamp >= existingTimestamp) {
                const merged = this.mergeRecordDetails(existing.record, record);
                mergedRecords[existing.index] = merged;
                indexMap.set(key, { record: merged, index: existing.index });
                updatedCount += 1;
            } else {
                skippedCount += 1;
            }
        }

        mergedRecords.sort((a, b) => this.getRecordTimestamp(a) - this.getRecordTimestamp(b));

        await storage.set('practice_records', mergedRecords);

        return {
            importedCount,
            updatedCount,
            skippedCount,
            finalCount: mergedRecords.length
        };
    }
    async mergeUserStats(stats, mergeMode = 'merge') {
        if (!this.isPlainObject(stats)) {
            return;
        }

        if (mergeMode === 'replace') {
            await storage.set('user_stats', stats);
            return;
        }

        const existing = await storage.get('user_stats', {}) || {};
        const merged = { ...existing };

        for (const [key, value] of Object.entries(stats)) {
            if (value === undefined || value === null) {
                continue;
            }

            const current = existing[key];
            if (typeof value === 'number' && typeof current === 'number') {
                merged[key] = Math.max(value, current);
                continue;
            }

            if (this.isPlainObject(value) && this.isPlainObject(current)) {
                merged[key] = { ...current, ...value };
                continue;
            }

            if (current === undefined) {
                merged[key] = value;
                continue;
            }

            merged[key] = value;
        }

        await storage.set('user_stats', merged);
    }

    mergeRecordDetails(existing, incoming) {
        const merged = { ...existing, ...incoming };

        if (this.isPlainObject(existing?.metadata) || this.isPlainObject(incoming?.metadata)) {
            merged.metadata = {
                ...(this.isPlainObject(existing?.metadata) ? existing.metadata : {}),
                ...(this.isPlainObject(incoming?.metadata) ? incoming.metadata : {})
            };
        }

        if (this.isPlainObject(existing?.realData) || this.isPlainObject(incoming?.realData)) {
            merged.realData = {
                ...(this.isPlainObject(existing?.realData) ? existing.realData : {}),
                ...(this.isPlainObject(incoming?.realData) ? incoming.realData : {})
            };
        }

        merged.startTime = this.normalizeDateValue(merged.startTime || incoming.startTime || existing.startTime) || merged.startTime;
        merged.endTime = this.normalizeDateValue(merged.endTime || incoming.endTime || existing.endTime) || merged.endTime;
        merged.createdAt = this.normalizeDateValue(merged.createdAt || incoming.createdAt || existing.createdAt) || merged.createdAt;
        merged.updatedAt = this.normalizeDateValue(merged.updatedAt || incoming.updatedAt || existing.updatedAt) || merged.updatedAt;

        if (!merged.duration && merged.startTime && merged.endTime) {
            const start = new Date(merged.startTime).getTime();
            const end = new Date(merged.endTime).getTime();
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
                merged.duration = Math.round((end - start) / 1000);
            }
        }

        return merged;
    }

    deduplicateRecords(records) {
        const map = new Map();

        records.forEach(record => {
            if (!record || record.id === undefined || record.id === null) {
                return;
            }

            const key = String(record.id);
            const timestamp = this.getRecordTimestamp(record);
            const existing = map.get(key);

            if (!existing || timestamp >= existing.timestamp) {
                map.set(key, { record, timestamp });
            }
        });

        return Array.from(map.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(entry => entry.record);
    }

    isRecordArray(items) {
        if (!Array.isArray(items) || !items.length) {
            return false;
        }

        const sampleSize = Math.min(items.length, 5);
        let matches = 0;
        for (let index = 0; index < sampleSize; index += 1) {
            if (this.looksLikePracticeRecord(items[index])) {
                matches += 1;
            }
        }

        return matches >= Math.ceil(sampleSize / 2);
    }

    looksLikePracticeRecord(record) {
        if (!this.isPlainObject(record)) {
            return false;
        }

        const keys = Object.keys(record).map(key => key.toLowerCase());
        const signals = [
            'id',
            'practiceid',
            'practice_id',
            'recordid',
            'record_id',
            'examid',
            'exam_id',
            'examname',
            'title',
            'score',
            'percentage',
            'accuracy',
            'starttime',
            'createdat',
            'timestamp',
            'realdata',
            'duration'
        ];

        return signals.some(signal => keys.includes(signal));
    }

    looksLikeUserStats(candidate) {
        if (!this.isPlainObject(candidate)) {
            return false;
        }

        const keys = Object.keys(candidate).map(key => key.toLowerCase());
        return keys.some(key => key.includes('stats') || key.includes('practicecount') || key.includes('totalpractice') || key.includes('total_practice'));
    }

    extractUserStats(candidate) {
        if (!this.isPlainObject(candidate)) {
            return null;
        }

        const normalized = {};
        for (const [key, value] of Object.entries(candidate)) {
            normalized[this.toCamelCaseKey(key)] = value;
        }
        return normalized;
    }
    normalizeRecord(record, options = {}) {
        const {
            preserveIds = true,
            fallbackIdPrefix = 'record',
            index = 0
        } = options;

        if (!this.isPlainObject(record)) {
            return null;
        }

        const safePrefix = fallbackIdPrefix || 'record';
        const sourceId = record.id ?? record.recordId ?? record.practiceId ?? record.sessionId ?? record.timestamp ?? record.uuid;

        let id = preserveIds && sourceId ? String(sourceId).trim() : '';
        if (!id) {
            id = `${safePrefix}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
        }

        const examId = record.examId ?? record.exam_id ?? record.examID ?? record.examName ?? record.title ?? record.name;

        const normalized = { ...record };
        normalized.id = id;
        normalized.examId = examId ? String(examId) : id;
        normalized.title = record.title ?? record.examTitle ?? record.examName ?? record.name ?? 'Practice record';
        normalized.status = record.status ?? record.recordStatus ?? 'completed';

        const startTimeRaw = record.startTime ?? record.start_time ?? record.startedAt ?? record.createdAt ?? record.timestamp ?? record.date;
        const endTimeRaw = record.endTime ?? record.end_time ?? record.finishedAt ?? record.completedAt;

        normalized.startTime = this.normalizeDateValue(startTimeRaw) ?? new Date().toISOString();
        normalized.endTime = this.normalizeDateValue(endTimeRaw) || normalized.endTime;
        normalized.createdAt = this.normalizeDateValue(record.createdAt ?? startTimeRaw ?? endTimeRaw) ?? normalized.startTime;
        normalized.updatedAt = this.normalizeDateValue(record.updatedAt ?? endTimeRaw) || normalized.updatedAt;

        normalized.duration = this.parseInteger(record.duration ?? record.realData?.duration ?? record.elapsedSeconds) ?? normalized.duration;
        normalized.score = this.parseNumber(record.score ?? record.finalScore ?? record.realData?.score ?? record.percentage ?? record.realData?.percentage) ?? normalized.score;
        normalized.totalQuestions = this.parseInteger(record.totalQuestions ?? record.questionCount ?? record.questions ?? record.realData?.totalQuestions) ?? normalized.totalQuestions;
        normalized.correctAnswers = this.parseInteger(record.correctAnswers ?? record.correctCount ?? record.realData?.correctAnswers ?? record.realData?.correct) ?? normalized.correctAnswers;
        normalized.accuracy = this.parseNumber(record.accuracy ?? record.realData?.accuracy ?? record.percentage) ?? normalized.accuracy;

        normalized.metadata = this.isPlainObject(record.metadata) ? { ...record.metadata } : {};
        const category = record.category ?? record.examCategory ?? record.section ?? record.mode;
        if (category && !normalized.metadata.category) {
            normalized.metadata.category = category;
        }
        if (record.frequency !== undefined && normalized.metadata.frequency === undefined) {
            normalized.metadata.frequency = record.frequency;
        }

        if (this.isPlainObject(record.realData)) {
            normalized.realData = { ...record.realData };
        } else if (this.isPlainObject(record.details)) {
            normalized.realData = { ...record.details };
        }

        normalized.source = record.source ?? record.dataSource ?? normalized.source ?? 'imported';

        if (!normalized.duration && normalized.startTime && normalized.endTime) {
            const start = new Date(normalized.startTime).getTime();
            const end = new Date(normalized.endTime).getTime();
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
                normalized.duration = Math.round((end - start) / 1000);
            }
        }

        if (normalized.accuracy !== undefined && normalized.accuracy !== null) {
            const value = Number(normalized.accuracy);
            if (Number.isFinite(value)) {
                normalized.accuracy = value <= 1 && value >= 0 ? Number((value * 100).toFixed(2)) : value;
                normalized.accuracy = Math.min(Math.max(normalized.accuracy, 0), 100);
            } else {
                delete normalized.accuracy;
            }
        }

        if (normalized.score !== undefined && normalized.score !== null) {
            const value = Number(normalized.score);
            if (Number.isFinite(value)) {
                normalized.score = value <= 1 && value >= 0 ? Number((value * 100).toFixed(2)) : value;
            } else {
                delete normalized.score;
            }
        }

        return normalized;
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

    parseNumber(value) {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        const num = Number(value);
        return Number.isFinite(num) ? num : undefined;
    }

    parseInteger(value) {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        const num = parseInt(value, 10);
        return Number.isFinite(num) ? num : undefined;
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
            if (window.practiceRecorder && typeof window.practiceRecorder.createBackup === 'function') {
                return await window.practiceRecorder.createBackup('pre_import_backup');
            }

            const backup = {
                id: `pre_import_${Date.now()}`,
                timestamp: new Date().toISOString(),
                data: {
                    practice_records: await storage.get('practice_records', []),
                    user_stats: await storage.get('user_stats', {}),
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
            if (window.practiceRecorder && typeof window.practiceRecorder.restoreBackup === 'function') {
                return await window.practiceRecorder.restoreBackup(backupId);
            }

            const backups = await storage.get(this.storageKeys.manualBackups, []);
            const backup = backups.find(item => item.id === backupId);
            if (!backup) {
                throw new Error(`Backup ${backupId} not found.`);
            }

            for (const [key, value] of Object.entries(backup.data || {})) {
                await storage.set(key, value);
            }
            return true;
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
            await storage.set('practice_records', []);
            clearedItems.push('practice_records');
        }

        if (clearUserStats) {
            await storage.set('user_stats', {});
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
            const practiceRecords = await storage.get('practice_records', []);
            const userStats = await storage.get('user_stats', {});
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
