/**
 * Data backup and recovery manager.
 * Provides export/import/cleanup functionality for the shared storage layer.
 */
let dataBackupFallbackIdCounter = 0;
const DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_IMPORT_RECORDS = 5000;
const MAX_BACKUP_IMPORT_NODES = 50000;
const MAX_BACKUP_IMPORT_DEPTH = 40;
const MAX_BACKUP_RECORD_CLONE_DEPTH = 16;
const MAX_BACKUP_RECORD_ARRAY_ITEMS = 500;
const MAX_BACKUP_RECORD_OBJECT_KEYS = 200;
const MAX_BACKUP_RECORD_TEXT_LENGTH = 5000;
const MAX_BACKUP_RECORD_ID_LENGTH = 512;
const MAX_BACKUP_RECORD_TITLE_LENGTH = 500;
const MAX_BACKUP_RECORD_STATUS_LENGTH = 64;
const MAX_BACKUP_HISTORY_CLONE_DEPTH = 4;
const MAX_BACKUP_HISTORY_ARRAY_ITEMS = 50;
const MAX_BACKUP_HISTORY_OBJECT_KEYS = 50;
const MAX_BACKUP_HISTORY_TEXT_LENGTH = 1000;
const MAX_BACKUP_HISTORY_ID_LENGTH = 160;
const MAX_BACKUP_INTERVAL_HOURS = 24 * 365;
const MAX_BACKUP_SETTING_COUNT = 100;
const BACKUP_IMPORT_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const BACKUP_IMPORT_SENSITIVE_KEYS = new Set([
    'password',
    'passwordhash',
    'password_hash',
    'currentpassword',
    'newpassword',
    'secret',
    'secretkey',
    'csrf',
    'csrftoken',
    'csrf_token',
    'totp',
    'totpsecret',
    'totp_secret',
    'recoverycode',
    'recovery_code',
    'recoverycodes',
    'recovery_codes',
    'authorization',
    'cookie',
    'apikey',
    'api_key',
    'privatekey',
    'private_key',
    'authtoken',
    'auth_token',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token'
]);

function createDataBackupId(prefix) {
    const cryptoObj = window.crypto || window.msCrypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        return `${prefix}_${Date.now()}_${cryptoObj.randomUUID()}`;
    }
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoObj.getRandomValues(bytes);
        const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${prefix}_${Date.now()}_${suffix}`;
    }
    dataBackupFallbackIdCounter += 1;
    return `${prefix}_${Date.now()}_fallback_${dataBackupFallbackIdCounter.toString(36)}`;
}

function formatCsvCell(value) {
    let cell = value == null ? '' : String(value);
    if (/^\s*[=+\-@]/.test(cell) || /^[\t\r\n]/.test(cell)) {
        cell = `'${cell}`;
    }
    return `"${cell.replace(/"/g, '""')}"`;
}

function resolveTrustedImportFetchUrl(rawUrl) {
    try {
        const baseHref = (typeof window !== 'undefined' && window.location && window.location.href)
            ? window.location.href
            : 'http://localhost/';
        const resolved = new URL(String(rawUrl), baseHref);
        const currentOrigin = (typeof window !== 'undefined' && window.location && window.location.origin)
            ? window.location.origin
            : new URL(baseHref).origin;
        if ((resolved.protocol === 'http:' || resolved.protocol === 'https:') && resolved.origin === currentOrigin) {
            return resolved.href;
        }
    } catch (_) {
        return null;
    }
    return null;
}

function getBackupTextByteLength(value) {
    const text = String(value ?? '');
    if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(text).byteLength;
    }
    if (typeof Blob === 'function') {
        return new Blob([text]).size;
    }
    return text.length;
}

function describeBackupImportSourceLength(source) {
    if (Array.isArray(source)) {
        return source.length;
    }
    if (typeof source === 'string' || source instanceof String) {
        return source.length;
    }
    if (source && typeof source === 'object') {
        const candidates = [
            source.practiceRecords,
            source.practice_records,
            source.records,
            source.data && source.data.practiceRecords,
            source.data && source.data.practice_records
        ];
        const match = candidates.find(Array.isArray);
        if (match) {
            return match.length;
        }
        if (Number.isFinite(source.size)) {
            return source.size;
        }
    }
    return undefined;
}

function isDataBackupDebugEnabled() {
    return Boolean(
        typeof window !== 'undefined'
        && (window.__IELTS_DEBUG_IMPORTS__ === true || window.__IELTS_DEBUG_BACKUP__ === true)
    );
}

function dataBackupDebugLog(...args) {
    if (isDataBackupDebugEnabled()) {
        console.log(...args);
    }
}

function createImportLimitError(message) {
    const error = new Error(message);
    error.name = 'ImportLimitError';
    return error;
}

function summarizeDataBackupErrorForLog(error) {
    const summary = {
        name: error && typeof error.name === 'string' ? error.name : 'Error'
    };
    if (error && typeof error.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code)) {
        summary.code = error.code;
    }
    return summary;
}

function getSafeDataBackupImportHistoryError(error) {
    if (error && error.name === 'ImportLimitError') {
        return 'Import data exceeds the supported safety limits.';
    }

    const message = error && typeof error.message === 'string' ? error.message : '';
    const safeMessages = new Set([
        'All records were invalid after validation.',
        'Import file does not contain any practice records.'
    ]);
    if (safeMessages.has(message)) {
        return message;
    }

    return 'Import failed while saving records.';
}

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
            console.error('[DataBackupManager] failed to initialize settings', summarizeDataBackupErrorForLog(error));
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
            await storage.set(this.storageKeys.backupSettings, this.normalizeBackupSettings(stored, defaults));
        } catch (error) {
            console.error('[DataBackupManager] unable to persist settings', summarizeDataBackupErrorForLog(error));
        }
    }

    normalizeBackupSettings(stored, defaults) {
        const normalized = { ...defaults };
        const source = this.isPlainObject(stored) ? stored : {};

        if (typeof source.autoBackup === 'boolean') {
            normalized.autoBackup = source.autoBackup;
        }
        if (typeof source.compressionEnabled === 'boolean') {
            normalized.compressionEnabled = source.compressionEnabled;
        }
        if (typeof source.encryptionEnabled === 'boolean') {
            normalized.encryptionEnabled = source.encryptionEnabled;
        }

        const backupInterval = Number(source.backupInterval);
        if (Number.isFinite(backupInterval) && backupInterval > 0) {
            normalized.backupInterval = Math.min(MAX_BACKUP_INTERVAL_HOURS, Math.max(1, Math.floor(backupInterval)));
        }

        const maxBackups = Number(source.maxBackups);
        if (Number.isFinite(maxBackups) && maxBackups > 0) {
            normalized.maxBackups = Math.min(MAX_BACKUP_SETTING_COUNT, Math.max(1, Math.floor(maxBackups)));
        }

        normalized.lastAutoBackup = this.normalizeDateValue(source.lastAutoBackup) || null;
        return normalized;
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
            const maybe = window.practiceRecorder.getPracticeRecords();
            practiceRecords = typeof maybe?.then === 'function' ? await maybe : maybe;
        } else {
            practiceRecords = await storage.get('practice_records', []);
        }

        practiceRecords = this.normalizeExportRecords(practiceRecords);

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
                options: this.normalizeExportOptions({ format, includeStats, includeBackups, dateRange, categories })
            },
            practiceRecords
        };

        if (includeStats) {
            let userStats = {};
            if (window.practiceRecorder && typeof window.practiceRecorder.getUserStats === 'function') {
                userStats = window.practiceRecorder.getUserStats();
            } else {
                userStats = await storage.get('user_stats', {});
            }
            exportPayload.userStats = this.normalizeExportStats(userStats);
        }

        if (includeBackups && window.practiceRecorder && typeof window.practiceRecorder.getBackups === 'function') {
            exportPayload.backups = this.normalizeExportBackups(window.practiceRecorder.getBackups());
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
            .map(row => row.map(formatCsvCell).join(','))
            .join('\n');

        return {
            data: csvContent,
            filename: `practice_records_${this.getTimestamp()}.csv`,
            mimeType: 'text/csv',
            size: csvContent.length
        };
    }

    normalizeExportRecords(records) {
        if (!Array.isArray(records)) {
            return [];
        }
        return records
            .slice(0, MAX_BACKUP_IMPORT_RECORDS)
            .map((record, index) => this.normalizeRecord(this.sanitizeRecord(record), {
                preserveIds: true,
                fallbackIdPrefix: 'export',
                index
            }))
            .filter(Boolean);
    }

    normalizeExportStats(stats) {
        return this.cloneSafePlainObject(stats, {
            maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
            maxArrayItems: MAX_BACKUP_RECORD_ARRAY_ITEMS,
            maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
            maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
        });
    }

    normalizeExportBackups(backups) {
        const cloned = this.cloneSafeValue(backups, {
            maxDepth: MAX_BACKUP_HISTORY_CLONE_DEPTH,
            maxArrayItems: MAX_BACKUP_HISTORY_ARRAY_ITEMS,
            maxObjectKeys: MAX_BACKUP_HISTORY_OBJECT_KEYS,
            maxTextLength: MAX_BACKUP_HISTORY_TEXT_LENGTH
        });
        return Array.isArray(cloned) ? cloned : [];
    }

    normalizeExportOptions(options) {
        return this.cloneSafePlainObject(options, {
            maxDepth: 3,
            maxArrayItems: MAX_BACKUP_HISTORY_ARRAY_ITEMS,
            maxObjectKeys: MAX_BACKUP_HISTORY_OBJECT_KEYS,
            maxTextLength: MAX_BACKUP_HISTORY_TEXT_LENGTH
        });
    }
    /**
     * Legacy-friendly wrapper.
     */
    async importPracticeRecords(source, options = {}) {
        return this.importPracticeData(source, options);
    }

    async importPracticeData(source, options = {}) {
        dataBackupDebugLog('[DataBackupManager] importPracticeData called, source type:', typeof source, 'length:', describeBackupImportSourceLength(source));
        const {
            mergeMode = 'merge',
            validateData = true,
            createBackup = true,
            preserveIds = true,
            allowFetch = false
        } = options;

        let payload;
        try {
            payload = await this.parseImportSource(source, { allowFetch: Boolean(allowFetch) });
        } catch (error) {
            const importError = new Error('Failed to read import source.');
            importError.cause = summarizeDataBackupErrorForLog(error);
            throw importError;
        }

        const normalized = this.normalizeImportPayload(payload, { preserveIds });
        dataBackupDebugLog('[DataBackupManager] Normalized records:', normalized.practiceRecords.length);

        // 优先使用标准化提取结果，必要时再回退到原始载荷路径
        let practiceRecords = Array.isArray(normalized.practiceRecords) ? normalized.practiceRecords : [];
        let recordsNeedNormalization = false;

        if (!practiceRecords.length) {
            if (Array.isArray(payload)) {
                practiceRecords = payload;
            } else {
                practiceRecords = payload.practiceRecords
                    || payload.practice_records
                    || (payload.data && payload.data.practice_records)
                    || (payload.data && payload.data.practiceRecords)
                    || (payload.data && payload.data.exam_system_practice_records && payload.data.exam_system_practice_records.data)
                    || (payload.exam_system_practice_records && payload.exam_system_practice_records.data)
                    || payload.records
                    || [];
            }
            recordsNeedNormalization = true;
        }

        if (!practiceRecords.length) {
            throw new Error('Import file does not contain any practice records.');
        }

        if (practiceRecords.length > MAX_BACKUP_IMPORT_RECORDS) {
            throw createImportLimitError(`Import contains too many practice records. Maximum supported count is ${MAX_BACKUP_IMPORT_RECORDS}.`);
        }

        practiceRecords = practiceRecords
            .map((record, index) => {
                const sanitized = this.sanitizeRecord(record);
                if (!recordsNeedNormalization) {
                    return sanitized;
                }
                return this.normalizeRecord(sanitized, {
                    preserveIds,
                    fallbackIdPrefix: 'import',
                    index
                });
            })
            .filter(Boolean);
        normalized.practiceRecords = practiceRecords;
        dataBackupDebugLog('[DataBackupManager] After sanitize, records:', normalized.practiceRecords.length);

        const originalLength = normalized.practiceRecords.length;
        if (validateData) {
            this.validateNormalizedRecords(normalized.practiceRecords);
        }
        const validatedLength = normalized.practiceRecords.length;
        const skippedCount = originalLength - validatedLength;
        dataBackupDebugLog('[DataBackupManager] Validated records:', validatedLength, 'skipped:', skippedCount);

        let backupId = null;
        if (createBackup) {
            backupId = await this.createPreImportBackup();
            dataBackupDebugLog('[DataBackupManager] Pre-import backup created');
        }

        let mergeResult;
        try {
            mergeResult = await this.mergeWithScoreStorageIfAvailable(normalized.practiceRecords, normalized.userStats, mergeMode);
            if (!mergeResult) {
                dataBackupDebugLog('[DataBackupManager] Fallback to legacy storage merge');
                mergeResult = await this.mergePracticeRecords(normalized.practiceRecords, mergeMode);
                dataBackupDebugLog('[DataBackupManager] Saving to storage');

                if (normalized.userStats) {
                    await this.mergeUserStats(normalized.userStats, mergeMode);
                }
            }
        } catch (error) {
            if (backupId) {
                try {
                    await this.restoreBackup(backupId);
                } catch (restoreError) {
                    console.error('[DataBackupManager] failed to restore backup after import error', summarizeDataBackupErrorForLog(restoreError));
                }
            }

            await this.recordImportHistory({
                timestamp: new Date().toISOString(),
                mergeMode,
                backupId,
                success: false,
                error: getSafeDataBackupImportHistoryError(error)
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
            if (Number.isFinite(source.size) && source.size > DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES) {
                throw createImportLimitError(`Import source is too large. Maximum supported size is ${DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES} bytes.`);
            }
            return this.parseImportSource(await source.text(), { allowFetch });
        }

        if (typeof Blob !== 'undefined' && source instanceof Blob) {
            if (Number.isFinite(source.size) && source.size > DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES) {
                throw createImportLimitError(`Import source is too large. Maximum supported size is ${DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES} bytes.`);
            }
            return this.parseImportSource(await source.text(), { allowFetch });
        }

        if (typeof source === 'string') {
            const trimmed = source.trim();
            if (!trimmed) {
                throw new Error('Import source string is empty.');
            }

            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                if (getBackupTextByteLength(trimmed) > DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES) {
                    throw createImportLimitError(`Import source is too large. Maximum supported size is ${DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES} bytes.`);
                }
                try {
                    return JSON.parse(trimmed);
                } catch (error) {
                    throw new Error('Import string is not valid JSON.');
                }
            }

            if (!allowFetch) {
                throw new Error('Import string is neither JSON nor a fetchable path.');
            }

            const fetchUrl = resolveTrustedImportFetchUrl(trimmed);
            if (!fetchUrl) {
                throw new Error('Import fetch URL is invalid or untrusted.');
            }
            const response = await fetch(fetchUrl, { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Failed to fetch import file: ${response.status}`);
            }
            const contentLength = response.headers && typeof response.headers.get === 'function'
                ? Number(response.headers.get('content-length'))
                : 0;
            if (Number.isFinite(contentLength) && contentLength > DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES) {
                throw createImportLimitError(`Import source is too large. Maximum supported size is ${DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES} bytes.`);
            }
            if (typeof response.text !== 'function') {
                throw new Error('Fetched import response cannot be read safely.');
            }
            const body = await response.text();
            if (getBackupTextByteLength(body) > DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES) {
                throw createImportLimitError(`Import source is too large. Maximum supported size is ${DEFAULT_MAX_BACKUP_IMPORT_SOURCE_BYTES} bytes.`);
            }
            try {
                return JSON.parse(body);
            } catch (_) {
                throw new Error('Fetched import file is not valid JSON.');
            }
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
        const visited = new WeakSet();
        const collectedArrays = new WeakSet();
        let visitedNodes = 0;

        const assertRecordBudget = (records) => {
            if (practiceRecords.length + records.length > MAX_BACKUP_IMPORT_RECORDS) {
                throw createImportLimitError(`Import contains too many practice records. Maximum supported count is ${MAX_BACKUP_IMPORT_RECORDS}.`);
            }
        };

        const collectRecords = (records, originPath) => {
            if (!Array.isArray(records) || !records.length) {
                return;
            }
            if (collectedArrays.has(records)) {
                return;
            }

            const pathString = originPath ? originPath : '';
            const rootCollection = pathString === '(root array)' || pathString === '(direct)';
            if (!rootCollection && !this.isPracticeRecordPath(pathString)) {
                return;
            }
            assertRecordBudget(records);
            collectedArrays.add(records);

            const normalizedRecords = records
                .map((record, index) => this.normalizeRecord(record, {
                    preserveIds,
                    fallbackIdPrefix: pathString || 'record',
                    index
                }))
                .filter(Boolean);

            if (!normalizedRecords.length) {
                return;
            }

            practiceRecords.push(...normalizedRecords);
            sources.push({ path: pathString || '(root array)', count: normalizedRecords.length });
        };

        // Fast-path: extract from common shapes (avoids deep traversal misses)
        try {
            const direct = this.extractRecordsFromCommonShapes(payload);
            if (direct.records && direct.records.length) {
                collectRecords(direct.records, direct.source || '(direct)');
            }
        } catch (error) {
            if (error && error.name === 'ImportLimitError') {
                throw error;
            }
            // ignore and continue with generic traversal
        }

        const visit = (node, pathSegments = []) => {
            if (!node || typeof node !== 'object') {
                return;
            }

            if (visited.has(node)) {
                return;
            }
            visited.add(node);
            if (pathSegments.length > MAX_BACKUP_IMPORT_DEPTH) {
                throw createImportLimitError(`Import structure is too deeply nested. Maximum supported depth is ${MAX_BACKUP_IMPORT_DEPTH}.`);
            }
            visitedNodes += 1;
            if (visitedNodes > MAX_BACKUP_IMPORT_NODES) {
                throw createImportLimitError(`Import structure is too large to scan safely. Maximum supported node count is ${MAX_BACKUP_IMPORT_NODES}.`);
            }

            if (Array.isArray(node)) {
                if (this.isRecordArray(node)) {
                    collectRecords(node, pathSegments.join('.'));
                    return;
                }

                node.forEach((item, index) => visit(item, pathSegments.concat(index)));
                return;
            }

            if (!this.isPlainObject(node)) {
                return;
            }

            if (!userStats && this.looksLikeUserStats(node)) {
                userStats = this.extractUserStats(node);
            }

            for (const [key, value] of this.safeEntries(node)) {
                const nextPath = pathSegments.concat(String(key));

                if (Array.isArray(value)) {
                    if (this.isRecordArray(value)) {
                        collectRecords(value, nextPath.join('.'));
                        continue;
                    }
                } else if (this.isPlainObject(value)) {
                    if (Array.isArray(value.data) && this.isRecordArray(value.data)) {
                        const nestedPath = nextPath.join('.') + '.data';
                        collectRecords(value.data, nestedPath);
                        continue;
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

    isPracticeRecordPath(pathString) {
        if (!pathString) {
            return false;
        }

        const normalized = pathString.toLowerCase();
        return (
            normalized.includes('practice_records') ||
            normalized.includes('practicerecords') ||
            normalized.includes('exam_system_practice_records') ||
            normalized.includes('mymelodypracticerecords') ||
            normalized.includes('my_melody_practice_records')
        );
    }

    validateNormalizedRecords(records) {
        const now = new Date().toISOString();
        const missingFieldsLog = [];
        let skippedCount = 0;

        for (let index = 0; index < records.length; index++) {
            const record = records[index];
            const missingFields = [];
            let isValid = true;

            // 检查并修复缺失字段
            if (!record.id) {
                record.id = createDataBackupId('imported');
            }
            if (!record.examId) {
                record.examId = 'imported_ielts';
            }
            if (!record.startTime) {
                record.startTime = now;
            } else if (Number.isNaN(new Date(record.startTime).getTime())) {
                record.startTime = now;
            }
            if (!record.endTime) {
                record.endTime = now;
            } else if (Number.isNaN(new Date(record.endTime).getTime())) {
                record.endTime = now;
            }
            if (typeof record.duration !== 'number' || isNaN(record.duration)) {
                record.duration = 0;
            }
            if (typeof record.score !== 'number' || isNaN(record.score)) {
                record.score = 0;
            }

            // 如果基本字段仍无效，标记为跳过
            if (!record.id || !record.examId || Number.isNaN(new Date(record.startTime).getTime())) {
                isValid = false;
                missingFields.push('id', 'examId', 'startTime');
            }

            if (!isValid) {
                missingFieldsLog.push({ index, missingFields });
                skippedCount++;
                records.splice(index, 1);
                index--; // 调整索引
                dataBackupDebugLog('[DataBackupManager] Skipped invalid record during validation');
            }
        }

        if (skippedCount > 0) {
            dataBackupDebugLog(`[DataBackupManager] Skipped ${skippedCount} invalid records during validation.`);
        }

        if (records.length === 0 && skippedCount > 0) {
            throw new Error('All records were invalid after validation.');
        }
    }

    getScoreStorageInstance() {
        return window.app?.components?.practiceRecorder?.scoreStorage
            || window.practiceRecorder?.scoreStorage
            || window.scoreStorage
            || null;
    }

    async mergeWithScoreStorageIfAvailable(records, userStats, mergeMode = 'merge') {
        const scoreStorage = this.getScoreStorageInstance();
        if (!scoreStorage || typeof scoreStorage.importData !== 'function') {
            return null;
        }

        try {
            dataBackupDebugLog('[DataBackupManager] Using ScoreStorage import path, mode:', mergeMode, 'records:', Array.isArray(records) ? records.length : 0);
            const existingList = (typeof scoreStorage.getPracticeRecords === 'function')
                ? await scoreStorage.getPracticeRecords({})
                : [];
            const existing = Array.isArray(existingList) ? existingList : [];
            const existingMap = new Map(
                existing
                    .filter(record => record && record.id)
                    .map(record => [String(record.id), record])
            );

            let incoming = Array.isArray(records) ? records.slice() : [];
            const originalLength = incoming.length;

            if (mergeMode === 'skip' && incoming.length) {
                incoming = incoming.filter(record => record && !existingMap.has(String(record.id)));
            }

            if (mergeMode === 'skip' && incoming.length === 0) {
                return {
                    importedCount: 0,
                    updatedCount: 0,
                    skippedCount: originalLength,
                    finalCount: existing.length
                };
            }

            const payload = { practiceRecords: incoming };
            if (userStats) {
                payload.userStats = userStats;
            }

            await scoreStorage.importData(payload, { merge: mergeMode !== 'replace' });

            const finalRecords = (typeof scoreStorage.getPracticeRecords === 'function')
                ? await scoreStorage.getPracticeRecords({})
                : [];
            const finalCount = Array.isArray(finalRecords) ? finalRecords.length : incoming.length;

            const importedCount = mergeMode === 'replace'
                ? incoming.length
                : incoming.filter(record => record && !existingMap.has(String(record.id))).length;
            const updatedCount = mergeMode === 'replace'
                ? existingMap.size
                : (mergeMode === 'skip' ? 0 : incoming.length - importedCount);
            const skippedCount = mergeMode === 'skip' ? (originalLength - incoming.length) : 0;

            dataBackupDebugLog('[DataBackupManager] ScoreStorage import finished', {
                mergeMode,
                importedCount,
                updatedCount,
                skippedCount,
                finalCount
            });

            return { importedCount, updatedCount, skippedCount, finalCount };
        } catch (error) {
            console.warn('[DataBackupManager] ScoreStorage import failed, fallback to storage', summarizeDataBackupErrorForLog(error));
            return null;
        }
    }

    async mergePracticeRecords(newRecords, mergeMode = 'merge') {
        const practiceStore = window.PracticeCore && window.PracticeCore.store;
        const existingRaw = practiceStore && typeof practiceStore.listPracticeRecords === 'function'
            ? await practiceStore.listPracticeRecords()
            : await storage.get('practice_records', []);
        const existingRecords = Array.isArray(existingRaw) ? existingRaw.slice() : [];

        if (mergeMode === 'replace') {
            if (practiceStore && typeof practiceStore.replacePracticeRecords === 'function') {
                await practiceStore.replacePracticeRecords(newRecords);
            } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.savePracticeRecords === 'function') {
                await window.simpleStorageWrapper.savePracticeRecords(newRecords);
            } else {
                const practiceKey = ['practice', 'records'].join('_');
                await storage.set(practiceKey, newRecords);
            }
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

        if (practiceStore && typeof practiceStore.replacePracticeRecords === 'function') {
            await practiceStore.replacePracticeRecords(mergedRecords);
        } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.savePracticeRecords === 'function') {
            await window.simpleStorageWrapper.savePracticeRecords(mergedRecords);
        } else {
            const practiceKey = ['practice', 'records'].join('_');
            await storage.set(practiceKey, mergedRecords);
        }

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

        const cloneOptions = {
            maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
            maxArrayItems: MAX_BACKUP_RECORD_ARRAY_ITEMS,
            maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
            maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
        };
        const incomingStats = this.cloneSafePlainObject(stats, cloneOptions);

        if (mergeMode === 'replace') {
            await storage.set('user_stats', incomingStats);
            return;
        }

        const existing = this.cloneSafePlainObject(await storage.get('user_stats', {}) || {}, cloneOptions);
        const merged = this.cloneSafePlainObject(existing, cloneOptions);

        for (const [key, value] of this.safeEntries(incomingStats)) {
            if (value === undefined || value === null) {
                continue;
            }

            if (!Object.prototype.hasOwnProperty.call(merged, key) && Object.keys(merged).length >= MAX_BACKUP_RECORD_OBJECT_KEYS) {
                continue;
            }

            const current = existing[key];
            if (typeof value === 'number' && typeof current === 'number') {
                merged[key] = Math.max(value, current);
                continue;
            }

            if (this.isPlainObject(value) && this.isPlainObject(current)) {
                merged[key] = this.mergeSafePlainObjects(current, value);
                continue;
            }

            if (current === undefined) {
                const safeValue = this.cloneSafeValue(value, cloneOptions);
                if (safeValue !== undefined) {
                    merged[key] = safeValue;
                }
                continue;
            }

            const safeValue = this.cloneSafeValue(value, cloneOptions);
            if (safeValue !== undefined) {
                merged[key] = safeValue;
            }
        }

        await storage.set('user_stats', merged);
    }

    mergeRecordDetails(existing, incoming) {
        const merged = this.mergeSafePlainObjects(existing, incoming);

        if (this.isPlainObject(existing?.metadata) || this.isPlainObject(incoming?.metadata)) {
            merged.metadata = this.mergeSafePlainObjects(
                this.isPlainObject(existing?.metadata) ? existing.metadata : {},
                this.isPlainObject(incoming?.metadata) ? incoming.metadata : {}
            );
        }

        if (this.isPlainObject(existing?.realData) || this.isPlainObject(incoming?.realData)) {
            merged.realData = this.mergeSafePlainObjects(
                this.isPlainObject(existing?.realData) ? existing.realData : {},
                this.isPlainObject(incoming?.realData) ? incoming.realData : {}
            );
        }

        merged.startTime = this.normalizeDateValue(merged.startTime || incoming.startTime || existing.startTime) || merged.startTime;
        merged.endTime = this.normalizeDateValue(merged.endTime || incoming.endTime || existing.endTime) || merged.endTime;
        merged.createdAt = this.normalizeDateValue(merged.createdAt || incoming.createdAt || existing.createdAt) || merged.createdAt;
        merged.updatedAt = this.normalizeDateValue(merged.updatedAt || incoming.updatedAt || existing.updatedAt) || merged.updatedAt;

        if ((!merged.duration || merged.duration <= 0) && merged.startTime && merged.endTime) {
            const start = new Date(merged.startTime).getTime();
            const end = new Date(merged.endTime).getTime();
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
                merged.duration = Math.round((end - start) / 1000);
            }
        }
        if (!merged.duration || merged.duration <= 0) {
            const rd = merged.realData || {};
            if (typeof rd.duration === 'number' && rd.duration > 0) {
                merged.duration = rd.duration;
            } else if (Array.isArray(rd.interactions) && rd.interactions.length) {
                try {
                    const ts = rd.interactions.map(x => x && Number(x.timestamp)).filter(n => Number.isFinite(n));
                    if (ts.length) {
                        const span = Math.max(...ts) - Math.min(...ts);
                        if (Number.isFinite(span) && span > 0) merged.duration = Math.floor(span / 1000);
                    }
                } catch(_) {}
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
        const keySet = new Set(keys);

        const identitySignals = [
            'id', 'practiceid', 'practice_id', 'recordid', 'record_id',
            'examid', 'exam_id', 'examname', 'title'
        ];
        const timeSignals = ['starttime', 'start_time', 'createdat', 'timestamp', 'endtime'];
        const statusSignals = ['status', 'realdata', 'duration'];

        const hasIdentity = identitySignals.some(signal => keySet.has(signal));
        if (!hasIdentity) {
            return false;
        }

        const hasTime = timeSignals.some(signal => keySet.has(signal));
        const hasStatus = statusSignals.some(signal => keySet.has(signal));
        return hasStatus || hasTime;
    }

    // Heuristic extractor for common export structures
    extractRecordsFromCommonShapes(payload) {
        // default empty result
        const empty = { records: [], source: null };
        try {
            if (Array.isArray(payload)) {
                return { records: payload, source: '(root array)' };
            }
            if (!this.isPlainObject(payload)) {
                return empty;
            }

            // Top-level practice_records
            if (Array.isArray(payload.practice_records)) {
                return { records: payload.practice_records, source: 'practice_records' };
            }

            // Nested under data
            const data = payload.data || {};
            if (Array.isArray(data.practice_records)) {
                return { records: data.practice_records, source: 'data.practice_records' };
            }
            if (this.isPlainObject(data.practice_records) && Array.isArray(data.practice_records.data)) {
                return { records: data.practice_records.data, source: 'data.practice_records.data' };
            }

            // Our exported wrapper key
            if (this.isPlainObject(data.exam_system_practice_records) && Array.isArray(data.exam_system_practice_records.data)) {
                return { records: data.exam_system_practice_records.data, source: 'data.exam_system_practice_records.data' };
            }
            if (this.isPlainObject(payload.exam_system_practice_records) && Array.isArray(payload.exam_system_practice_records.data)) {
                return { records: payload.exam_system_practice_records.data, source: 'exam_system_practice_records.data' };
            }

            return empty;
        } catch (_) {
            return empty;
        }
    }

    looksLikeUserStats(candidate) {
        if (!this.isPlainObject(candidate)) {
            return false;
        }

        const keys = Object.keys(candidate).map(key => key.toLowerCase());
        const recordContainerKeys = new Set([
            'practicerecords',
            'practice_records',
            'exam_system_practice_records',
            'mymelodypracticerecords',
            'my_melody_practice_records'
        ]);
        if (keys.some(key => recordContainerKeys.has(key))) {
            return false;
        }
        return keys.some(key => key.includes('stats') || key.includes('practicecount') || key.includes('totalpractice') || key.includes('total_practice'));
    }

    extractUserStats(candidate) {
        if (!this.isPlainObject(candidate)) {
            return null;
        }

        const normalized = {};
        const cloneOptions = {
            maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
            maxArrayItems: MAX_BACKUP_RECORD_ARRAY_ITEMS,
            maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
            maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
        };
        for (const [key, value] of this.safeEntries(candidate)) {
            const safeKey = this.normalizeText(this.toCamelCaseKey(key), MAX_BACKUP_RECORD_ID_LENGTH);
            if (!safeKey || this.isUnsafeImportKey(safeKey)) {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(normalized, safeKey) && Object.keys(normalized).length >= MAX_BACKUP_RECORD_OBJECT_KEYS) {
                continue;
            }
            const safeValue = this.cloneSafeValue(value, cloneOptions);
            if (safeValue !== undefined) {
                normalized[safeKey] = safeValue;
            }
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

        let id = preserveIds && sourceId ? this.normalizeText(sourceId, MAX_BACKUP_RECORD_ID_LENGTH) : '';
        if (!id) {
            id = `${safePrefix}_${Date.now()}_${index}_${createDataBackupId('normalized')}`;
        }

        const examId = record.examId ?? record.exam_id ?? record.examID ?? record.examName ?? record.title ?? record.name;

        const normalized = this.cloneSafePlainObject(record, {
            maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
            maxArrayItems: MAX_BACKUP_RECORD_ARRAY_ITEMS,
            maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
            maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
        });
        normalized.id = id;
        normalized.examId = examId ? this.normalizeText(examId, MAX_BACKUP_RECORD_ID_LENGTH) : id;
        normalized.title = this.normalizeText(record.title ?? record.examTitle ?? record.examName ?? record.name ?? 'Practice record', MAX_BACKUP_RECORD_TITLE_LENGTH) || 'Practice record';
        normalized.status = this.normalizeText(record.status ?? record.recordStatus ?? 'completed', MAX_BACKUP_RECORD_STATUS_LENGTH) || 'completed';

        const startTimeRaw = record.startTime ?? record.start_time ?? record.startedAt ?? record.createdAt ?? record.timestamp ?? record.date;
        const endTimeRaw = record.endTime ?? record.end_time ?? record.finishedAt ?? record.completedAt;

        normalized.startTime = this.normalizeDateValue(startTimeRaw) ?? new Date().toISOString();
        normalized.endTime = this.normalizeDateValue(endTimeRaw) || normalized.endTime;
        normalized.createdAt = this.normalizeDateValue(record.createdAt ?? startTimeRaw ?? endTimeRaw) ?? normalized.startTime;
        normalized.updatedAt = this.normalizeDateValue(record.updatedAt ?? endTimeRaw) || normalized.updatedAt;

        // Prefer a positive duration; avoid locking in 0 when a better value exists
        (function(){
            const sInfo = record && (record.scoreInfo || (record.realData && record.realData.scoreInfo)) || {};
            const rd = record && record.realData || {};
            const candidates = [
                record.duration, rd.duration,
                record.durationSeconds, record.duration_seconds,
                record.elapsedSeconds, record.elapsed_seconds,
                record.timeSpent, record.time_spent,
                rd.durationSeconds, rd.elapsedSeconds, rd.timeSpent,
                sInfo.duration, sInfo.timeSpent
            ];
            let picked = undefined;
            // pick first positive
            for (const v of candidates) { const n = Number(v); if (Number.isFinite(n) && n > 0) { picked = n; break; } }
            // else allow zero if nothing else
            if (picked === undefined) { for (const v of candidates) { const n = Number(v); if (Number.isFinite(n)) { picked = n; break; } } }
            if (picked !== undefined) normalized.duration = picked;
        })();
        normalized.score = this.parseNumber(record.score ?? record.finalScore ?? record.realData?.score ?? record.percentage ?? record.realData?.percentage) ?? normalized.score;
        normalized.totalQuestions = this.parseInteger(record.totalQuestions ?? record.questionCount ?? record.questions ?? record.realData?.totalQuestions) ?? normalized.totalQuestions;
        normalized.correctAnswers = this.parseInteger(record.correctAnswers ?? record.correctCount ?? record.realData?.correctAnswers ?? record.realData?.correct) ?? normalized.correctAnswers;
        normalized.accuracy = this.parseNumber(record.accuracy ?? record.realData?.accuracy ?? record.percentage) ?? normalized.accuracy;

        normalized.metadata = this.isPlainObject(record.metadata)
            ? this.cloneSafePlainObject(record.metadata, {
                maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
                maxArrayItems: MAX_BACKUP_RECORD_ARRAY_ITEMS,
                maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
                maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
            })
            : {};
        const category = record.category ?? record.examCategory ?? record.section ?? record.mode;
        if (category && !normalized.metadata.category) {
            normalized.metadata.category = this.normalizeText(category, MAX_BACKUP_RECORD_TEXT_LENGTH);
        }
        if (record.frequency !== undefined && normalized.metadata.frequency === undefined) {
            normalized.metadata.frequency = this.normalizeText(record.frequency, MAX_BACKUP_RECORD_TEXT_LENGTH);
        }

        if (this.isPlainObject(record.realData)) {
            normalized.realData = this.cloneSafePlainObject(record.realData, {
                maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
                maxArrayItems: MAX_BACKUP_RECORD_ARRAY_ITEMS,
                maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
                maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
            });
        } else if (this.isPlainObject(record.details)) {
            normalized.realData = this.cloneSafePlainObject(record.details, {
                maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
                maxArrayItems: MAX_BACKUP_RECORD_ARRAY_ITEMS,
                maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
                maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
            });
        }

        normalized.source = this.normalizeText(record.source ?? record.dataSource ?? normalized.source ?? 'imported', MAX_BACKUP_RECORD_TEXT_LENGTH) || 'imported';

        if ((!normalized.duration || normalized.duration <= 0) && normalized.startTime && normalized.endTime) {
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
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
                    const parsed = new Date(milliseconds);
                    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
            console.warn('[DataBackupManager] compression failed', summarizeDataBackupErrorForLog(error));
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
            console.error('[DataBackupManager] failed to create backup', summarizeDataBackupErrorForLog(error));
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

            // 返回备份对象，让调用者决定如何处理数据
            if (!this.isPlainObject(backup.data)) {
                throw new Error(`Backup ${backupId} does not contain restorable data.`);
            }

            const restored = {};

            const practiceRecordSource = Array.isArray(backup.data.practice_records)
                ? backup.data.practice_records
                : (Array.isArray(backup.data.practiceRecords) ? backup.data.practiceRecords : null);
            if (practiceRecordSource) {
                if (practiceRecordSource.length > MAX_BACKUP_IMPORT_RECORDS) {
                    throw createImportLimitError(`Backup contains too many practice records. Maximum supported count is ${MAX_BACKUP_IMPORT_RECORDS}.`);
                }
                const normalizedRecords = practiceRecordSource
                    .map((record, index) => this.normalizeRecord(record, {
                        preserveIds: true,
                        fallbackIdPrefix: 'backup',
                        index
                    }))
                    .filter(Boolean);
                if (window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.replacePracticeRecords === 'function') {
                    await window.PracticeCore.store.replacePracticeRecords(normalizedRecords);
                } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.savePracticeRecords === 'function') {
                    await window.simpleStorageWrapper.savePracticeRecords(normalizedRecords);
                } else {
                    const practiceKey = ['practice', 'records'].join('_');
                    await storage.set(practiceKey, normalizedRecords);
                }
                restored.practiceRecords = normalizedRecords.length;
            }

            const userStatsSource = this.isPlainObject(backup.data.user_stats)
                ? backup.data.user_stats
                : (this.isPlainObject(backup.data.userStats) ? backup.data.userStats : null);
            if (userStatsSource) {
                const userStats = this.cloneSafePlainObject(userStatsSource, {
                    maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
                    maxArrayItems: MAX_BACKUP_RECORD_ARRAY_ITEMS,
                    maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
                    maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
                });
                await storage.set('user_stats', userStats);
                restored.userStats = Object.keys(userStats).length;
            }

            const examIndexSource = Array.isArray(backup.data.exam_index)
                ? backup.data.exam_index
                : (Array.isArray(backup.data.examIndex) ? backup.data.examIndex : null);
            if (examIndexSource) {
                const examIndex = this.cloneSafeValue(examIndexSource, {
                    maxDepth: MAX_BACKUP_RECORD_CLONE_DEPTH,
                    maxArrayItems: MAX_BACKUP_IMPORT_RECORDS,
                    maxObjectKeys: MAX_BACKUP_RECORD_OBJECT_KEYS,
                    maxTextLength: MAX_BACKUP_RECORD_TEXT_LENGTH
                }) || [];
                await storage.set('exam_index', Array.isArray(examIndex) ? examIndex : []);
                restored.examIndex = Array.isArray(examIndex) ? examIndex.length : 0;
            }

            const storageVersion = backup.data.storage_version ?? backup.data.storageVersion;
            if (typeof storageVersion === 'string' && storageVersion.trim()) {
                await storage.set('storage_version', this.normalizeText(storageVersion, MAX_BACKUP_RECORD_ID_LENGTH));
                restored.storageVersion = true;
            }

            return {
                success: true,
                backupId,
                restored
            };
        } catch (error) {
            console.error('[DataBackupManager] backup restore failed', summarizeDataBackupErrorForLog(error));
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
            if (window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.replacePracticeRecords === 'function') {
                await window.PracticeCore.store.replacePracticeRecords([]);
            } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.savePracticeRecords === 'function') {
                await window.simpleStorageWrapper.savePracticeRecords([]);
            } else {
                const practiceKey = ['practice', 'records'].join('_');
                await storage.set(practiceKey, []);
            }
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

    getMaxHistoryEntries() {
        return Number.isInteger(this.maxExportHistory) && this.maxExportHistory > 0
            ? this.maxExportHistory
            : 50;
    }

    getHistoryCloneOptions() {
        return {
            maxDepth: MAX_BACKUP_HISTORY_CLONE_DEPTH,
            maxArrayItems: MAX_BACKUP_HISTORY_ARRAY_ITEMS,
            maxObjectKeys: MAX_BACKUP_HISTORY_OBJECT_KEYS,
            maxTextLength: MAX_BACKUP_HISTORY_TEXT_LENGTH
        };
    }

    normalizeHistoryEntry(entry, prefix, options = {}) {
        const { requireTimestamp = false, fallbackTimestamp = null } = options;
        if (!this.isPlainObject(entry)) {
            return null;
        }

        const normalized = this.cloneSafePlainObject(entry, this.getHistoryCloneOptions());
        if (!this.isPlainObject(normalized)) {
            return null;
        }

        const timestamp = this.normalizeDateValue(normalized.timestamp)
            || this.normalizeDateValue(fallbackTimestamp);
        if (!timestamp && requireTimestamp) {
            return null;
        }
        normalized.timestamp = timestamp || new Date().toISOString();

        const id = this.normalizeText(normalized.id, MAX_BACKUP_HISTORY_ID_LENGTH);
        normalized.id = id || createDataBackupId(prefix);
        return normalized;
    }

    normalizeHistoryList(history, prefix) {
        if (!Array.isArray(history)) {
            return [];
        }

        const maxEntries = this.getMaxHistoryEntries();
        return history
            .slice(-maxEntries * 2)
            .map((entry) => this.normalizeHistoryEntry(entry, prefix, { requireTimestamp: true }))
            .filter(Boolean)
            .slice(-maxEntries);
    }

    async readHistory(storageKey, prefix) {
        return this.normalizeHistoryList(await storage.get(storageKey, []), prefix);
    }

    async writeHistory(storageKey, prefix, history) {
        const normalized = this.normalizeHistoryList(history, prefix);
        await storage.set(storageKey, normalized);
        return normalized;
    }

    sortHistoryByTimestamp(history) {
        return [...history].sort((a, b) => {
            const left = new Date(a.timestamp).getTime();
            const right = new Date(b.timestamp).getTime();
            return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
        });
    }

    async recordExportHistory(info) {
        const history = await this.readHistory(this.storageKeys.exportHistory, 'export');
        const source = this.isPlainObject(info) ? info : {};
        const entry = this.normalizeHistoryEntry({
            ...source,
            id: createDataBackupId('export'),
            timestamp: source.timestamp || new Date().toISOString()
        }, 'export');
        if (entry) {
            history.push(entry);
        }
        await this.writeHistory(this.storageKeys.exportHistory, 'export', history);
    }

    async recordImportHistory(info) {
        const history = await this.readHistory(this.storageKeys.importHistory, 'import');
        const source = this.isPlainObject(info) ? info : {};
        const entry = this.normalizeHistoryEntry({
            ...source,
            id: createDataBackupId('import'),
            timestamp: source.timestamp || new Date().toISOString()
        }, 'import');
        if (entry) {
            history.push(entry);
        }
        await this.writeHistory(this.storageKeys.importHistory, 'import', history);
    }

    async getExportHistory() {
        return this.sortHistoryByTimestamp(await this.readHistory(this.storageKeys.exportHistory, 'export'));
    }

    async getImportHistory() {
        return this.sortHistoryByTimestamp(await this.readHistory(this.storageKeys.importHistory, 'import'));
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
            console.error('[DataBackupManager] failed to collect stats', summarizeDataBackupErrorForLog(error));
            return null;
        }
    }

    setupPeriodicCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }

        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredData().catch(error => console.error('[DataBackupManager] cleanup failed', summarizeDataBackupErrorForLog(error)));
        }, 24 * 60 * 60 * 1000);
    }

    async cleanupExpiredData() {
        try {
            const limit = 30 * 24 * 60 * 60 * 1000;
            const now = Date.now();

            const exportHistory = await this.readHistory(this.storageKeys.exportHistory, 'export');
            const freshExports = exportHistory.filter(item => now - new Date(item.timestamp).getTime() < limit);
            if (freshExports.length !== exportHistory.length) {
                await this.writeHistory(this.storageKeys.exportHistory, 'export', freshExports);
            }

            const importHistory = await this.readHistory(this.storageKeys.importHistory, 'import');
            const freshImports = importHistory.filter(item => now - new Date(item.timestamp).getTime() < limit);
            if (freshImports.length !== importHistory.length) {
                await this.writeHistory(this.storageKeys.importHistory, 'import', freshImports);
            }
        } catch (error) {
            console.error('[DataBackupManager] cleanup error', summarizeDataBackupErrorForLog(error));
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

    isUnsafeImportKey(key) {
        const normalized = String(key || '').trim().toLowerCase();
        return BACKUP_IMPORT_POLLUTION_KEYS.has(normalized)
            || BACKUP_IMPORT_SENSITIVE_KEYS.has(normalized);
    }

    safeEntries(value) {
        if (!this.isPlainObject(value)) {
            return [];
        }
        return Object.entries(value).filter(([key]) => !this.isUnsafeImportKey(key));
    }

    normalizeText(value, maxLength = MAX_BACKUP_RECORD_TEXT_LENGTH) {
        if (value === undefined || value === null) {
            return '';
        }
        const text = String(value)
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .trim();
        if (text.length <= maxLength) {
            return text;
        }
        const truncated = text.slice(0, maxLength);
        return /[\uD800-\uDBFF]$/.test(truncated)
            ? truncated.slice(0, -1)
            : truncated;
    }

    cloneSafeValue(value, options = {}, depth = 0, seen = null) {
        const {
            maxDepth = MAX_BACKUP_RECORD_CLONE_DEPTH,
            maxArrayItems = MAX_BACKUP_RECORD_ARRAY_ITEMS,
            maxObjectKeys = MAX_BACKUP_RECORD_OBJECT_KEYS,
            maxTextLength = MAX_BACKUP_RECORD_TEXT_LENGTH
        } = options;

        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === 'string') {
            return this.normalizeText(value, maxTextLength);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value.toISOString();
        }
        if (typeof value !== 'object') {
            return undefined;
        }
        if (depth >= maxDepth) {
            return undefined;
        }

        const scanState = seen || new WeakSet();
        if (scanState.has(value)) {
            return undefined;
        }
        scanState.add(value);

        if (Array.isArray(value)) {
            return value
                .slice(0, maxArrayItems)
                .map((item) => this.cloneSafeValue(item, options, depth + 1, scanState))
                .filter((item) => item !== undefined);
        }

        if (!this.isPlainObject(value)) {
            return this.normalizeText(value, maxTextLength);
        }

        const clone = {};
        this.safeEntries(value)
            .slice(0, maxObjectKeys)
            .forEach(([key, item]) => {
                const safeKey = this.normalizeText(key, MAX_BACKUP_RECORD_ID_LENGTH);
                if (!safeKey || this.isUnsafeImportKey(safeKey)) {
                    return;
                }
                const safeValue = this.cloneSafeValue(item, options, depth + 1, scanState);
                if (safeValue !== undefined) {
                    clone[safeKey] = safeValue;
                }
            });
        return clone;
    }

    cloneSafePlainObject(value, options = {}) {
        const {
            maxObjectKeys = MAX_BACKUP_RECORD_OBJECT_KEYS
        } = options;
        const clone = {};
        const scanState = new WeakSet();
        if (value && typeof value === 'object') {
            scanState.add(value);
        }
        for (const [key, item] of this.safeEntries(value)) {
            const safeKey = this.normalizeText(key, MAX_BACKUP_RECORD_ID_LENGTH);
            if (!safeKey || this.isUnsafeImportKey(safeKey)) {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(clone, safeKey) && Object.keys(clone).length >= maxObjectKeys) {
                continue;
            }
            const safeValue = this.cloneSafeValue(item, options, 0, scanState);
            if (safeValue !== undefined) {
                clone[safeKey] = safeValue;
            }
        }
        return clone;
    }

    mergeSafePlainObjects(...objects) {
        const merged = {};
        objects.forEach((object) => {
            const scanState = new WeakSet();
            if (object && typeof object === 'object') {
                scanState.add(object);
            }
            for (const [key, value] of this.safeEntries(object)) {
                const safeKey = this.normalizeText(key, MAX_BACKUP_RECORD_ID_LENGTH);
                if (!safeKey || this.isUnsafeImportKey(safeKey)) {
                    continue;
                }
                if (!Object.prototype.hasOwnProperty.call(merged, safeKey) && Object.keys(merged).length >= MAX_BACKUP_RECORD_OBJECT_KEYS) {
                    continue;
                }
                const safeValue = this.cloneSafeValue(value, {}, 0, scanState);
                if (safeValue !== undefined) {
                    merged[safeKey] = safeValue;
                }
            }
        });
        return merged;
    }

    isPlainObject(value) {
        return Object.prototype.toString.call(value) === '[object Object]';
    }
}

window.DataBackupManager = DataBackupManager;
