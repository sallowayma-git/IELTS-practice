/**
 * 数据备份和恢复管理器
 * 提供完整的数据导入导出、备份恢复和数据清理功能
 */
class DataBackupManager {
    constructor() {
        this.storageKeys = {
            backupSettings: 'backup_settings',
            exportHistory: 'export_history',
            importHistory: 'import_history'
        };
        
        this.supportedFormats = ['json', 'csv'];
        this.maxBackupHistory = 20;
        this.maxExportHistory = 50;
        
        this.initialize();
    }

    /**
     * 初始化备份管理器
     */
    async initialize() {
        console.log('DataBackupManager initialized');
        
        // 初始化设置
        await this.initializeSettings();
        
        // 设置定期清理
        this.setupPeriodicCleanup();
    }

    /**
     * 初始化备份设置
     */
    async initializeSettings() {
        const defaultSettings = {
            autoBackup: true,
            backupInterval: 24, // 小时
            maxBackups: 10,
            compressionEnabled: false,
            encryptionEnabled: false,
            lastAutoBackup: null
        };
        
        const settings = await storage.get(this.storageKeys.backupSettings, defaultSettings);
        await storage.set(this.storageKeys.backupSettings, settings);
    }

    /**
     * 导出练习记录数据
     */
    async exportPracticeRecords(options = {}) {
        try {
            const {
                format = 'json',
                includeStats = true,
                includeBackups = false,
                dateRange = null,
                categories = null,
                compression = false
            } = options;

            // 验证格式
            if (!this.supportedFormats.includes(format.toLowerCase())) {
                throw new Error(`Unsupported export format: ${format}`);
            }

            // 获取练习记录
            let practiceRecords = [];
            if (window.practiceRecorder) {
                practiceRecords = window.practiceRecorder.getPracticeRecords();
            } else {
                practiceRecords = await storage.get('practice_records', []);
            }

            // 应用筛选条件
            if (dateRange) {
                practiceRecords = this.filterByDateRange(practiceRecords, dateRange);
            }

            if (categories && categories.length > 0) {
                practiceRecords = practiceRecords.filter(record => 
                    categories.includes(record.metadata?.category)
                );
            }

            // 构建导出数据
            const exportData = {
                exportInfo: {
                    timestamp: new Date().toISOString(),
                    version: '1.0.0',
                    format: format,
                    recordCount: practiceRecords.length,
                    options: options
                },
                practiceRecords: practiceRecords
            };

            // 包含用户统计
            if (includeStats) {
                if (window.practiceRecorder) {
                    exportData.userStats = window.practiceRecorder.getUserStats();
                } else {
                    exportData.userStats = await storage.get('user_stats', {});
                }
            }

            // 包含备份数据
            if (includeBackups && window.practiceRecorder) {
                exportData.backups = window.practiceRecorder.getBackups();
            }

            // 记录导出历史
            await this.recordExportHistory(exportData.exportInfo);

            // 根据格式返回数据
            switch (format.toLowerCase()) {
                case 'json':
                    return this.exportAsJSON(exportData, compression);
                case 'csv':
                    return this.exportAsCSV(exportData);
                default:
                    throw new Error(`Format ${format} not implemented`);
            }

        } catch (error) {
            console.error('Export failed:', error);
            throw new Error(`导出失败: ${error.message}`);
        }
    }

    /**
     * 导出为JSON格式
     */
    exportAsJSON(data, compression = false) {
        const jsonString = JSON.stringify(data, null, compression ? 0 : 2);
        
        return {
            data: jsonString,
            filename: `practice_records_${this.getTimestamp()}.json`,
            mimeType: 'application/json',
            size: jsonString.length
        };
    }

    /**
     * 导出为CSV格式
     */
    exportAsCSV(data) {
        const records = data.practiceRecords;
        
        if (records.length === 0) {
            return {
                data: '',
                filename: `practice_records_${this.getTimestamp()}.csv`,
                mimeType: 'text/csv',
                size: 0
            };
        }

        // CSV头部
        const headers = [
            '记录ID', '考试ID', '开始时间', '结束时间', '用时(分钟)', 
            '状态', '得分', '总题数', '正确数', '准确率(%)', 
            '分类', '频率', '题目标题', '创建时间'
        ];

        // 转换记录为CSV行
        const rows = records.map(record => [
            record.id || '',
            record.examId || '',
            record.startTime || '',
            record.endTime || '',
            record.duration ? Math.round(record.duration / 60) : 0,
            record.status || '',
            record.score || 0,
            record.totalQuestions || 0,
            record.correctAnswers || 0,
            record.accuracy ? Math.round(record.accuracy * 100) : 0,
            record.metadata?.category || '',
            record.metadata?.frequency || '',
            record.metadata?.examTitle || '',
            record.createdAt || ''
        ]);

        // 生成CSV内容
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
     * 从文件导入练习记录
     */
    async importPracticeRecords(filePath, options = {}) {
        try {
            const sourceLabel = typeof source === 'string' ? source : '[binary]';
            console.log(`[DataBackupManager] 开始导入数据源: ${sourceLabel}`);

            const payload = await this.parseImportSource(source, { allowFetch: true });
            const result = await this.processImportPayload(payload, options);

            if (window.showMessage && result.importedCount > 0) {
                window.showMessage(`成功导入 ${result.importedCount} 条练习记录`);
            }

            return result;
        } catch (error) {
            console.error('[DataBackupManager] 导入练习记录失败:', error);

            await this.recordImportHistory({
                timestamp: new Date().toISOString(),
                error: error.message,
                success: false
            });

            if (window.showMessage) {
                window.showMessage(`导入失败: ${error.message}`, 'error');
            }

            throw error;
        }
    }


    /**
     * 导入练习数据
     */
    async importPracticeData(source, options = {}) {
        try {
            const payload = await this.parseImportSource(source);
            return await this.processImportPayload(payload, options);
        } catch (error) {
            console.error('Import failed:', error);

            await this.recordImportHistory({
                timestamp: new Date().toISOString(),
                error: error.message,
                success: false
            });

            throw new Error(`导入失败: ${error.message}`);
        }
    }

    /**
     * 解析导入数据源
     */
    async parseImportSource(source, { allowFetch = false } = {}) {
        if (source === undefined || source === null) {
            throw new Error('未提供导入数据');
        }

        if (typeof File !== 'undefined' && source instanceof File) {
            return this.parseImportSource(await source.text());
        }

        if (typeof Blob !== 'undefined' && source instanceof Blob) {
            return this.parseImportSource(await source.text());
        }

        if (typeof source === 'string') {
            const trimmed = source.trim();
            if (!trimmed) {
                throw new Error('导入数据为空');
            }

            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    return JSON.parse(trimmed);
                } catch (error) {
                    throw new Error('导入数据不是有效的 JSON 格式');
                }
            }

            if (allowFetch) {
                const response = await fetch(source);
                if (!response.ok) {
                    throw new Error(`文件加载失败: ${source} (${response.status})`);
                }
                return await response.json();
            }

            throw new Error('导入字符串不是有效的 JSON 数据');
        }

        if (Array.isArray(source) || this.isPlainObject(source)) {
            return source;
        }

        throw new Error('不支持的导入数据类型');
    }

    /**
     * 处理导入有效负载
     */
    async processImportPayload(rawPayload, options = {}) {
        const {
            mergeMode = 'merge',
            validateData = true,
            createBackup = true,
            preserveIds = true
        } = options;

        const normalized = this.normalizeImportPayload(rawPayload, { preserveIds });

        if (!normalized.practiceRecords.length) {
            throw new Error('导入文件中未发现练习记录数据');
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
                    console.error('Failed to restore backup after import error:', restoreError);
                }
            }
            throw error;
        }

        await this.recordImportHistory({
            timestamp: new Date().toISOString(),
            recordCount: mergeResult.importedCount,
            mergeMode,
            backupId,
            sources: normalized.sources || [],
            success: true
        });

        return {
            success: true,
            ...mergeResult,
            backupId,
            statsImported: Boolean(normalized.userStats),
            sources: normalized.sources || []
        };
    }

    validateNormalizedRecords(records) {
        records.forEach((record, index) => {
            if (!record.id) {
                throw new Error(`记录 ${index + 1} 缺少 id 字段`);
            }
            if (!record.examId) {
                throw new Error(`记录 ${index + 1} 缺少 examId 字段`);
            }
            if (!record.startTime) {
                throw new Error(`记录 ${index + 1} 缺少 startTime 字段`);
            }

            if (Number.isNaN(new Date(record.startTime).getTime())) {
                throw new Error(`记录 ${index + 1} 的 startTime 无效`);
            }
        });
    }

    async mergePracticeRecords(newRecords, mergeMode = 'merge') {
        const existingRaw = await storage.get('practice_records', []);
        const existingRecords = Array.isArray(existingRaw) ? existingRaw.slice() : [];
        const indexMap = new Map();

        existingRecords.forEach((record, index) => {
            if (!record || typeof record !== 'object') {
                return;
            }
            const recordId = record.id || `legacy_${index}`;
            indexMap.set(recordId, { record, index });
        });

        if (mergeMode === 'replace') {
            await storage.set('practice_records', newRecords);
            return {
                importedCount: newRecords.length,
                updatedCount: existingRecords.length ? existingRecords.length : 0,
                skippedCount: 0,
                finalCount: newRecords.length
            };
        }

        let importedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        const mergedRecords = existingRecords.slice();

        for (const record of newRecords) {
            if (!record || !record.id) {
                continue;
            }

            const existing = indexMap.get(record.id);

            if (!existing) {
                mergedRecords.push(record);
                indexMap.set(record.id, { record, index: mergedRecords.length - 1 });
                importedCount++;
                continue;
            }

            if (mergeMode === 'skip') {
                skippedCount++;
                continue;
            }

            const existingTimestamp = this.getRecordTimestamp(existing.record);
            const incomingTimestamp = this.getRecordTimestamp(record);

            if (incomingTimestamp >= existingTimestamp) {
                const merged = this.mergeRecordDetails(existing.record, record);
                mergedRecords[existing.index] = merged;
                indexMap.set(record.id, { record: merged, index: existing.index });
                updatedCount++;
            } else {
                skippedCount++;
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

            if (typeof value === 'number' && typeof existing[key] === 'number') {
                merged[key] = Math.max(value, existing[key]);
                continue;
            }

            if (this.isPlainObject(value) && this.isPlainObject(existing[key])) {
                merged[key] = { ...existing[key], ...value };
                continue;
            }

            if (existing[key] === undefined) {
                merged[key] = value;
                continue;
            }

            merged[key] = value;
        }

        await storage.set('user_stats', merged);
    }

    normalizeImportPayload(payload, { preserveIds = true } = {}) {
        if (payload === undefined || payload === null) {
            throw new Error('导入数据为空');
        }

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
                if (node.length && node.every(item => this.isPlainObject(item)) && this.looksLikePracticeRecordArray(node)) {
                    const normalized = node
                        .map((record, index) => this.normalizeRecord(record, {
                            preserveIds,
                            fallbackIdPrefix: path.join('.') || 'record',
                            index
                        }))
                        .filter(Boolean);

                    if (normalized.length) {
                        practiceRecords.push(...normalized);
                        sources.push({
                            path: path.join('.') || '(root array)',
                            count: normalized.length
                        });
                    }
                    return;
                }

                node.forEach((item, index) => visit(item, path.concat(index)));
                return;
            }

            if (!userStats && this.looksLikeUserStatsKey(path[path.length - 1])) {
                userStats = this.extractUserStats(node) || userStats;
            }

            for (const [key, value] of Object.entries(node)) {
                if (!value || typeof value !== 'object') {
                    continue;
                }

                const nextPath = path.concat(key);

                if (Array.isArray(value)) {
                    if (value.length && value.every(item => this.isPlainObject(item)) && this.looksLikePracticeRecordArray(value)) {
                        const normalized = value
                            .map((record, index) => this.normalizeRecord(record, {
                                preserveIds,
                                fallbackIdPrefix: nextPath.join('.'),
                                index
                            }))
                            .filter(Boolean);

                        if (normalized.length) {
                            practiceRecords.push(...normalized);
                            sources.push({
                                path: nextPath.join('.'),
                                count: normalized.length
                            });
                            continue;
                        }
                    }
                } else if (!userStats) {
                    const candidateStats = this.extractUserStats(value);
                    if (candidateStats) {
                        userStats = candidateStats;
                    }
                }

                visit(value, nextPath);
            }

            if (!userStats) {
                const directStats = this.extractUserStats(node);
                if (directStats) {
                    userStats = directStats;
                }
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

    looksLikePracticeRecordArray(items) {
        if (!Array.isArray(items) || !items.length) {
            return false;
        }

        const sample = items.slice(0, Math.min(items.length, 5));
        const matches = sample.filter(item => this.looksLikePracticeRecord(item)).length;

        return matches >= Math.ceil(sample.length / 2);
    }

    looksLikePracticeRecord(record) {
        if (!this.isPlainObject(record)) {
            return false;
        }

        const keys = Object.keys(record);
        if (!keys.length) {
            return false;
        }

        const signals = [
            'id', 'practiceId', 'practice_id', 'recordId', 'record_id',
            'examId', 'exam_id', 'examID', 'examName', 'exam_name',
            'title', 'score', 'percentage', 'accuracy', 'status',
            'startTime', 'start_time', 'createdAt', 'timestamp',
            'realData', 'duration', 'questionCount', 'totalQuestions'
        ];

        const lowerKeys = keys.map(key => key.toLowerCase());

        return signals.some(signal => lowerKeys.includes(signal.toLowerCase()));
    }

    looksLikeUserStatsKey(key) {
        if (typeof key !== 'string') {
            return false;
        }

        const normalized = key.toLowerCase();
        return [
            'userstats',
            'user_stats',
            'stats',
            'statistics',
            'practicestats',
            'practice_stats',
            'practice_statistics',
            'userstatistics'
        ].includes(normalized);
    }

    extractUserStats(candidate) {
        if (!this.isPlainObject(candidate)) {
            return null;
        }

        const keys = Object.keys(candidate);
        if (!keys.length) {
            return null;
        }

        const signalKeys = [
            'totalpractices',
            'total_practices',
            'totaltimespent',
            'total_time_spent',
            'averagescore',
            'average_score',
            'bestscore',
            'best_score',
            'sessions',
            'records',
            'practicecount',
            'practice_count'
        ];

        const hasSignal = keys.some(key => signalKeys.includes(key.toLowerCase()));
        if (!hasSignal) {
            return null;
        }

        const normalized = {};

        for (const [key, value] of Object.entries(candidate)) {
            normalized[this.toCamelCaseKey(key)] = value;
        }

        return normalized;
    }

    toCamelCaseKey(key) {
        const str = String(key);
        return str
            .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, group) => group.toUpperCase())
            .replace(/^[A-Z]/, match => match.toLowerCase());
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
        normalized.title = record.title ?? record.examTitle ?? record.examName ?? record.name ?? '练习记录';
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

        if (this.isPlainObject(record.metadata)) {
            normalized.metadata = { ...record.metadata };
        } else {
            normalized.metadata = {};
        }

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
            if (normalized.accuracy <= 1 && normalized.accuracy >= 0) {
                normalized.accuracy = Number((normalized.accuracy * 100).toFixed(2));
            } else {
                normalized.accuracy = Number(normalized.accuracy);
            }
            if (Number.isFinite(normalized.accuracy)) {
                normalized.accuracy = Math.min(Math.max(normalized.accuracy, 0), 100);
            } else {
                delete normalized.accuracy;
            }
        }

        if (normalized.score !== undefined && normalized.score !== null) {
            normalized.score = Number(normalized.score);
            if (!Number.isFinite(normalized.score)) {
                delete normalized.score;
            } else if (normalized.score <= 1 && normalized.score >= 0) {
                normalized.score = Number((normalized.score * 100).toFixed(2));
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
                    const ms = trimmed.length > 10 ? numeric : numeric * 1000;
                    return new Date(ms).toISOString();
                }
            }

            const date = new Date(trimmed);
            if (!Number.isNaN(date.getTime())) {
                return date.toISOString();
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

    mergeRecordDetails(existing, incoming) {
        const merged = { ...existing, ...incoming };

        if (this.isPlainObject(existing.metadata) || this.isPlainObject(incoming.metadata)) {
            merged.metadata = {
                ...(this.isPlainObject(existing.metadata) ? existing.metadata : {}),
                ...(this.isPlainObject(incoming.metadata) ? incoming.metadata : {})
            };
        }

        if (this.isPlainObject(existing.realData) || this.isPlainObject(incoming.realData)) {
            merged.realData = {
                ...(this.isPlainObject(existing.realData) ? existing.realData : {}),
                ...(this.isPlainObject(incoming.realData) ? incoming.realData : {})
            };
        }

        merged.startTime = this.normalizeDateValue(merged.startTime || incoming.startTime || existing.startTime) || merged.startTime;
        merged.endTime = this.normalizeDateValue(merged.endTime || incoming.endTime || existing.endTime) || merged.endTime;
        merged.createdAt = this.normalizeDateValue(merged.createdAt || incoming.createdAt || existing.createdAt) || merged.createdAt;
        merged.updatedAt = this.normalizeDateValue(merged.updatedAt || incoming.updatedAt || existing.updatedAt) || merged.updatedAt;

        if (!merged.duration && merged.startTime && merged.endTime) {
            const duration = (new Date(merged.endTime).getTime() - new Date(merged.startTime).getTime()) / 1000;
            if (Number.isFinite(duration) && duration > 0) {
                merged.duration = Math.round(duration);
            }
        }

        return merged;
    }

    deduplicateRecords(records) {
        const map = new Map();

        for (const record of records) {
            if (!record || !record.id) {
                continue;
            }

            const timestamp = this.getRecordTimestamp(record);
            const existing = map.get(record.id);

            if (!existing || timestamp >= existing.timestamp) {
                map.set(record.id, { record, timestamp });
            }
        }

        return Array.from(map.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(entry => entry.record);
    }

    isPlainObject(value) {
        return Object.prototype.toString.call(value) === '[object Object]';
    }

    /**
     * 创建导入前备份
     */
    async createPreImportBackup() {
        try {
            if (window.practiceRecorder) {
                return window.practiceRecorder.createBackup('pre_import_backup');
            } else {
                // 降级处理：手动创建备份
                const backupData = {
                    id: `pre_import_${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    data: {
                        practice_records: await storage.get('practice_records', []),
                        user_stats: await storage.get('user_stats', {}),
                        exam_index: await storage.get('exam_index', [])
                    }
                };
                
                const backups = await storage.get('manual_backups', []);
                backups.push(backupData);
                
                // 保持最近10个备份
                if (backups.length > 10) {
                    backups.splice(0, backups.length - 10);
                }
                
                await storage.set('manual_backups', backups);
                return backupData.id;
            }
        } catch (error) {
            console.error('Failed to create pre-import backup:', error);
            return null;
        }
    }

    /**
     * 数据清理和重置选项
     */
    async clearData(options = {}) {
        const {
            clearPracticeRecords = false,
            clearUserStats = false,
            clearBackups = false,
            clearSettings = false,
            createBackup = true
        } = options;

        try {
            // 创建清理前备份
            let backupId = null;
            if (createBackup) {
                backupId = await this.createPreImportBackup();
            }

            const clearedItems = [];

            // 清理练习记录
            if (clearPracticeRecords) {
                storage.remove('practice_records');
                clearedItems.push('练习记录');
            }

            // 清理用户统计
            if (clearUserStats) {
                storage.remove('user_stats');
                clearedItems.push('用户统计');
            }

            // 清理备份数据
            if (clearBackups) {
                storage.remove('backup_data');
                storage.remove('manual_backups');
                clearedItems.push('备份数据');
            }

            // 清理设置
            if (clearSettings) {
                storage.remove('settings');
                storage.remove(this.storageKeys.backupSettings);
                clearedItems.push('系统设置');
            }

            // 重新初始化默认数据
            if (clearPracticeRecords || clearUserStats) {
                await storage.initializeDefaultData();
            }

            console.log('Data cleared:', clearedItems);

            return {
                success: true,
                clearedItems,
                backupId
            };

        } catch (error) {
            console.error('Data clearing failed:', error);
            throw new Error(`数据清理失败: ${error.message}`);
        }
    }

    /**
     * 按日期范围筛选记录
     */
    filterByDateRange(records, dateRange) {
        const { startDate, endDate } = dateRange;
        
        return records.filter(record => {
            const recordDate = new Date(record.startTime);
            
            if (startDate && recordDate < new Date(startDate)) {
                return false;
            }
            
            if (endDate && recordDate > new Date(endDate)) {
                return false;
            }
            
            return true;
        });
    }

    /**
     * 记录导出历史
     */
    async recordExportHistory(exportInfo) {
        const history = await storage.get(this.storageKeys.exportHistory, []);
        
        history.push({
            ...exportInfo,
            id: `export_${Date.now()}`
        });

        // 保持最近的导出记录
        if (history.length > this.maxExportHistory) {
            history.splice(0, history.length - this.maxExportHistory);
        }

        await storage.set(this.storageKeys.exportHistory, history);
    }

    /**
     * 璁板綍瀵煎叆鍘嗗彶
     */
    async recordImportHistory(importInfo) {
        const history = await storage.get(this.storageKeys.importHistory, []);
        
        history.push({
            ...importInfo,
            id: `import_${Date.now()}`
        });

        // 保持最近的导入记录
        if (history.length > this.maxExportHistory) {
            history.splice(0, history.length - this.maxExportHistory);
        }

        await storage.set(this.storageKeys.importHistory, history);
    }

    /**
     * 获取导出历史
     */
    async getExportHistory() {
        const history = await storage.get(this.storageKeys.exportHistory, []);
        return history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    /**
     * 获取导入历史
     */
    async getImportHistory() {
        const history = await storage.get(this.storageKeys.importHistory, []);
        return history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    /**
     * 恢复备份
     */
    async restoreBackup(backupId) {
        try {
            if (window.practiceRecorder) {
                return window.practiceRecorder.restoreBackup(backupId);
            } else {
                // 降级处理：从手动备份恢复
                const backups = await storage.get('manual_backups', []);
                const backup = backups.find(b => b.id === backupId);
                
                if (!backup) {
                    throw new Error(`备份不存在: ${backupId}`);
                }
                
                // 恢复数据
                for (const [key, value] of Object.entries(backup.data)) {
                    await storage.set(key, value);
                }
                
                return true;
            }
        } catch (error) {
            console.error('Backup restore failed:', error);
            throw new Error(`备份恢复失败: ${error.message}`);
        }
    }

    /**
     * 获取时间戳字符串
     */
    getTimestamp() {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    }

    /**
     * 设置定期清理
     */
    setupPeriodicCleanup() {
        // 每天清理一次过期数据
        setInterval(async () => {
            await this.cleanupExpiredData();
        }, 24 * 60 * 60 * 1000);
    }

    /**
     * 清理过期数据
     */
    async cleanupExpiredData() {
        try {
            // 清理过期的导出历史
            const exportHistory = await storage.get(this.storageKeys.exportHistory, []);
            const validExports = exportHistory.filter(item => {
                const age = Date.now() - new Date(item.timestamp).getTime();
                return age < (30 * 24 * 60 * 60 * 1000); // 保留30天
            });
            
            if (validExports.length !== exportHistory.length) {
                await storage.set(this.storageKeys.exportHistory, validExports);
            }

            // 清理过期的导入历史
            const importHistory = await storage.get(this.storageKeys.importHistory, []);
            const validImports = importHistory.filter(item => {
                const age = Date.now() - new Date(item.timestamp).getTime();
                return age < (30 * 24 * 60 * 60 * 1000); // 保留30天
            });
            
            if (validImports.length !== importHistory.length) {
                await storage.set(this.storageKeys.importHistory, validImports);
            }

            console.log('Expired data cleaned up');
            
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    
        /**
         * 规范化记录数据
         * @param {Object} record - 原始记录
         * @returns {Object} 规范化后的记录
         */
        normalizeRecord(record) {
            if (!record) return record;
            
            const normalized = { ...record };
            
            // 标准化日期格式
            if (normalized.startTime) {
                normalized.startTime = new Date(normalized.startTime).toISOString();
            }
            if (normalized.endTime) {
                normalized.endTime = new Date(normalized.endTime).toISOString();
            }
            if (normalized.createdAt) {
                normalized.createdAt = new Date(normalized.createdAt).toISOString();
            }
            
            // 确保必需字段存在
            normalized.id = normalized.id || `record_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            normalized.examId = normalized.examId || 'unknown';
            normalized.status = normalized.status || 'completed';
            
            // 标准化数值字段
            normalized.score = parseFloat(normalized.score) || 0;
            normalized.totalQuestions = parseInt(normalized.totalQuestions) || 0;
            normalized.correctAnswers = parseInt(normalized.correctAnswers) || 0;
            normalized.accuracy = parseFloat(normalized.accuracy) || 0;
            
            // 清理无效数据
            if (normalized.metadata) {
                normalized.metadata.category = normalized.metadata.category || 'general';
                normalized.metadata.frequency = parseInt(normalized.metadata.frequency) || 1;
            }
            
            return normalized;
        }
    }

    /**
    /**
     * 合并记录，按 ID 去重，保留最新 timestamp 的记录
     * @param {Array} oldRecords - 现有记录
     * @param {Array} newRecords - 新记录
     * @returns {Array} 合并后的记录
     */
    mergeRecords(oldRecords, newRecords) {
        const mergedMap = new Map();
        
        // 处理所有记录，保留每个 ID 的最新版本
        [...oldRecords, ...newRecords].forEach(record => {
            const recordTime = new Date(record.createdAt || record.startTime || 0).getTime();
            const current = mergedMap.get(record.id);
            
            if (!current || recordTime > current.time) {
                mergedMap.set(record.id, { ...record, time: recordTime });
            }
        });
        
        // 移除临时 time 字段
        return Array.from(mergedMap.values()).map(({ time, ...record }) => record);
    }
     * 获取数据统计信息
     */
    async getDataStats() {
        try {
            const practiceRecords = await storage.get('practice_records', []);
            const userStats = await storage.get('user_stats', {});
            const exportHistory = await this.getExportHistory();
            const importHistory = await this.getImportHistory();

            return {
                practiceRecords: {
                    count: practiceRecords.length,
                    oldestRecord: practiceRecords.length > 0 ? practiceRecords[0]?.startTime : null,
                    newestRecord: practiceRecords.length > 0 ? practiceRecords[practiceRecords.length - 1]?.startTime : null
                },
                userStats: {
                    totalPractices: userStats.totalPractices || 0,
                    totalTimeSpent: userStats.totalTimeSpent || 0,
                    averageScore: userStats.averageScore || 0
                },
                exportHistory: {
                    count: exportHistory.length,
                    lastExport: exportHistory.length > 0 ? exportHistory[0].timestamp : null
                },
                importHistory: {
                    count: importHistory.length,
                    lastImport: importHistory.length > 0 ? importHistory[0].timestamp : null
                },
                storage: await storage.getStorageInfo()
            };
        } catch (error) {
            console.error('Failed to get data stats:', error);
            return null;
        }
    }
}

// 确保全局可用
window.DataBackupManager = DataBackupManager;