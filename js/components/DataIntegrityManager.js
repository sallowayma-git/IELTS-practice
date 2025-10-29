/**
 * 数据完整性管理器 (仓库驱动版)
 * 负责数据备份、验证、修复和导入导出功能
 * 基于统一的数据仓库接口执行原子操作
 */
class DataIntegrityManager {
    constructor(options = {}) {
        this.backupInterval = 600000; // 10分钟自动备份
        this.maxBackups = 5; // 最多保留5个备份（减少占用）
        this.dataVersion = '1.0.0';
        this.backupTimer = null;
        this.validationRules = new Map();
        this.repositories = null;
        this.consistencyReport = null;
        this.isInitialized = false;
        this.registry = options.registry || window.StorageProviderRegistry || null;
        this._unsubscribe = null;

        this.registerDefaultValidationRules();
        this.connectToProviders();

        console.log('[DataIntegrityManager] 数据完整性管理器已创建');
    }

    connectToProviders() {
        const registry = this.registry;
        if (registry && typeof registry.onProvidersReady === 'function') {
            this._unsubscribe = registry.onProvidersReady(({ repositories }) => {
                this.attachRepositories(repositories);
            });
            const current = registry.getCurrentProviders && registry.getCurrentProviders();
            if (current && current.repositories) {
                this.attachRepositories(current.repositories);
            }
            return;
        }

        if (window.dataRepositories) {
            this.attachRepositories(window.dataRepositories);
            return;
        }

        console.warn('[DataIntegrityManager] 未检测到数据仓库注册表，等待外部注入');
    }

    async attachRepositories(repositories) {
        if (!repositories) {
            return;
        }
        if (this.repositories === repositories && this.isInitialized) {
            return;
        }

        this.repositories = repositories;
        console.log('[DataIntegrityManager] 已绑定数据仓库接口');

        try {
            await this.initializeWithRepositories();
        } catch (error) {
            console.error('[DataIntegrityManager] 初始化失败:', error);
            this.startAutoBackup();
            this.isInitialized = true;
        }
    }

    async initializeWithRepositories() {
        try {
            if (!this.repositories) {
                throw new Error('数据仓库不可用');
            }

            try {
                this.consistencyReport = await this.repositories.runConsistencyChecks();
                console.log('[DataIntegrityManager] 初始一致性检查完成', this.consistencyReport);
            } catch (reportError) {
                console.warn('[DataIntegrityManager] 初始一致性检查失败:', reportError);
            }

            this.startAutoBackup();
            try { await this.cleanupOldBackups(); } catch (_) {}

            this.isInitialized = true;
            console.log('[DataIntegrityManager] 数据完整性管理器已初始化');
        } catch (error) {
            throw error;
        }
    }

    _ensureInitialized() {
        if (!this.isInitialized) {
            console.warn('[DataIntegrityManager] 尚未完全初始化，使用降级模式');
        }
    }

    async cleanupOldBackups() {
        try {
            if (!this.repositories) return;
            const backups = await this.repositories.backups.list();
            if (backups.length <= this.maxBackups) return;
            await this.repositories.backups.prune(this.maxBackups);
            console.log('[DataIntegrityManager] 已执行备份裁剪');
        } catch (error) {
            console.error('[DataIntegrityManager] 清理旧备份失败:', error);
        }
    }

    async createBackup(providedData, type = 'manual') {
        let data = null;
        try {
            if (!this.repositories) {
                throw new Error('数据仓库不可用');
            }
            data = providedData || await this.getCriticalData();
            if (Object.keys(data).length === 0) {
                throw new Error('无数据可备份');
            }
            const id = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const timestamp = new Date().toISOString();
            const backupObj = {
                id,
                timestamp,
                data,
                version: this.dataVersion,
                type,
                size: JSON.stringify(data).length
            };
            await this.repositories.backups.add(backupObj);
            console.log(`[DataIntegrityManager] ${type} 备份创建成功: ${id}`);
            return backupObj;
        } catch (error) {
            console.error('[DataIntegrityManager] 创建备份失败:', error);
            if (error.name === 'QuotaExceededError' && data) {
                this.exportDataAsFallback(data);
            }
            throw error;
        }
    }

    exportDataAsFallback(exportData) {
        try {
            const exportObj = {
                exportDate: new Date().toISOString(),
                version: this.dataVersion,
                data: exportData,
                note: 'Storage quota exceeded - manual backup'
            };
            const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ielts-data-backup-quota-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log('[DataIntegrityManager] 配额溢出备份已下载');
        } catch (fallbackError) {
            console.error('[DataIntegrityManager] fallback 导出失败:', fallbackError);
        }
    }

    registerDefaultValidationRules() {
        this.validationRules.set('practice_records', {
            required: ['id', 'startTime'],
            types: {
                id: 'string',
                startTime: 'string',
                endTime: 'string',
                date: 'string',
                duration: 'number',
                examId: 'string',
                examTitle: 'string',
                scoreInfo: 'object'
            },
            validators: {
                startTime: (value) => !isNaN(new Date(value).getTime()),
                date: (value) => !value || !isNaN(new Date(value).getTime()),
                endTime: (value) => !value || !isNaN(new Date(value).getTime()),
                duration: (value) => typeof value === 'number' && value >= 0,
                id: (value) => typeof value === 'string' && value.length > 0
            }
        });

        this.validationRules.set('system_settings', {
            types: {
                theme: 'string',
                language: 'string',
                autoSave: 'boolean',
                notifications: 'boolean'
            }
        });
    }

    startAutoBackup() {
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
        }
        this.backupTimer = setInterval(() => {
            this.performAutoBackup();
        }, this.backupInterval);
        console.log(`[DataIntegrityManager] 自动备份已启动 (${this.backupInterval / 1000}秒间隔)`);
    }

    stopAutoBackup() {
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
            this.backupTimer = null;
            console.log('[DataIntegrityManager] 自动备份已停止');
        }
    }

    async performAutoBackup() {
        try {
            const criticalData = await this.getCriticalData();
            if (Object.keys(criticalData).length > 0) {
                await this.createBackup(criticalData, 'auto');
                console.log('[DataIntegrityManager] 自动备份完成');
            } else {
                console.log('[DataIntegrityManager] 无关键数据需要备份');
            }
        } catch (error) {
            console.error('[DataIntegrityManager] 自动备份失败:', error);
        }
    }

    async getBackupList() {
        try {
            if (!this.repositories) return [];
            const backups = await this.repositories.backups.list();
            return backups.map(b => ({
                id: b.id,
                timestamp: b.timestamp,
                type: b.type,
                version: b.version,
                size: b.size
            }));
        } catch (error) {
            console.error('[DataIntegrityManager] 获取备份列表失败:', error);
            return [];
        }
    }

    async restoreBackup(backupId) {
        try {
            if (!this.repositories) {
                throw new Error('数据仓库不可用');
            }
            const backup = await this.repositories.backups.getById(backupId);
            if (!backup) {
                throw new Error('备份不存在');
            }
            const data = backup.data || {};
            await this.repositories.transaction(['practice', 'settings'], async (repos, tx) => {
                await repos.practice.overwrite(data.practice_records || [], { transaction: tx });
                const currentSettings = await repos.settings.getAll({ transaction: tx });
                const restoredSettings = { ...currentSettings, ...(data.system_settings || {}) };
                await repos.settings.saveAll(restoredSettings, { transaction: tx });
            });
            console.log(`[DataIntegrityManager] 备份 ${backupId} 恢复成功`);
        } catch (error) {
            console.error('[DataIntegrityManager] 恢复备份失败:', error);
            throw error;
        }
    }

    async exportData() {
        try {
            const data = await this.getCriticalData();
            const exportObj = {
                exportDate: new Date().toISOString(),
                version: this.dataVersion,
                data
            };
            const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ielts-data-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log('[DataIntegrityManager] 数据导出成功');
        } catch (error) {
            console.error('[DataIntegrityManager] 导出数据失败:', error);
            throw error;
        }
    }

    async importData(source, options = {}) {
        this._ensureInitialized();
        if (!this.repositories) {
            throw new Error('数据仓库不可用');
        }

        let payload;
        let backup = null;
        try {
            payload = await this._normalizeImportPayload(source);
        } catch (error) {
            console.error('[DataIntegrityManager] 解析导入源失败:', error);
            throw new Error(error?.message || '导入文件格式无效');
        }

        const hasPracticeSection = Array.isArray(payload.practice_records);
        const hasSettingsSection = payload.system_settings && typeof payload.system_settings === 'object';
        const practiceRecords = hasPracticeSection ? this._preparePracticeRecords(payload.practice_records) : null;
        const systemSettings = hasSettingsSection ? this._prepareSystemSettings(payload.system_settings) : {};

        if (!hasPracticeSection && !hasSettingsSection) {
            throw new Error('导入文件缺少可用的数据');
        }

        try {
            backup = await this.createBackup(null, 'pre_import');
        } catch (error) {
            console.warn('[DataIntegrityManager] 导入前创建备份失败:', error);
        }

        try {
            await this.repositories.transaction(['practice', 'settings'], async (repos, tx) => {
                if (hasPracticeSection) {
                    await repos.practice.overwrite(practiceRecords || [], { transaction: tx });
                }

                if (hasSettingsSection && Object.keys(systemSettings).length > 0) {
                    const current = await repos.settings.getAll({ transaction: tx });
                    const next = { ...current, ...systemSettings };
                    await repos.settings.saveAll(next, { transaction: tx });
                }
            });
        } catch (error) {
            console.error('[DataIntegrityManager] 导入数据失败:', error);
            throw new Error(error?.message || '导入数据失败');
        }

        return {
            importedCount: practiceRecords ? practiceRecords.length : 0,
            backupId: backup?.id || null,
            version: payload.version || this.dataVersion
        };
    }

    async getCriticalData() {
        this._ensureInitialized();
        try {
            if (!this.repositories) {
                return {};
            }
            const data = {};
            try {
                const practiceRecords = await this.repositories.practice.list();
                data.practice_records = practiceRecords || [];
            } catch (recordsError) {
                console.warn('[DataIntegrityManager] 获取练习记录失败:', recordsError);
                data.practice_records = [];
            }

            try {
                const allSettings = await this.repositories.settings.getAll();
                const systemSettings = {
                    theme: allSettings.theme,
                    language: allSettings.language,
                    autoSave: allSettings.autoSave,
                    notifications: allSettings.notifications
                };
                data.system_settings = systemSettings;
            } catch (settingsError) {
                console.warn('[DataIntegrityManager] 获取系统设置失败:', settingsError);
                data.system_settings = {};
            }

            return data;
        } catch (error) {
            console.error('[DataIntegrityManager] 获取关键数据失败:', error);
            return {};
        }
    }

    async _normalizeImportPayload(source) {
        const raw = await this._resolveImportSource(source);
        const container = this._unwrapDataSection(raw);
        return {
            practice_records: this._extractField(container, ['practice_records', 'practiceRecords', 'practice']),
            system_settings: this._extractField(container, ['system_settings', 'systemSettings', 'settings']),
            version: typeof raw?.version === 'string' ? raw.version : null
        };
    }

    async _resolveImportSource(source) {
        if (!source) {
            throw new Error('未提供导入数据源');
        }
        if (typeof source === 'string') {
            return JSON.parse(source);
        }
        if (source instanceof Blob && typeof source.text === 'function') {
            const text = await source.text();
            return JSON.parse(text);
        }
        if (typeof File !== 'undefined' && source instanceof File) {
            const text = await source.text();
            return JSON.parse(text);
        }
        if (source instanceof ArrayBuffer) {
            const text = new TextDecoder('utf-8').decode(source);
            return JSON.parse(text);
        }
        if (typeof source === 'object') {
            return source;
        }
        throw new Error('不支持的导入数据类型');
    }

    _unwrapDataSection(raw) {
        if (!raw || typeof raw !== 'object') {
            throw new Error('导入文件格式无效');
        }
        if (raw.data && typeof raw.data === 'object') {
            return raw.data;
        }
        return raw;
    }

    _extractField(container, variants) {
        if (!container || typeof container !== 'object') {
            return undefined;
        }
        const lookup = this._buildKeyLookup(container);
        for (const variant of variants) {
            if (lookup.has(variant.toLowerCase())) {
                return lookup.get(variant.toLowerCase());
            }
        }
        return undefined;
    }

    _buildKeyLookup(container) {
        const map = new Map();
        Object.keys(container).forEach((key) => {
            map.set(key.toLowerCase(), container[key]);
        });
        return map;
    }

    _preparePracticeRecords(list) {
        if (!Array.isArray(list)) {
            return [];
        }
        const prepared = [];
        for (const entry of list) {
            const normalized = this._normalizePracticeRecord(entry);
            if (normalized) {
                prepared.push(normalized);
            }
        }
        return prepared;
    }

    _normalizePracticeRecord(record) {
        if (!record || typeof record !== 'object') {
            return null;
        }
        const normalized = { ...record };
        const now = new Date().toISOString();

        normalized.id = this._stringify(record.id) || `imported_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        normalized.examId = this._stringify(record.examId) || this._stringify(record.sessionId) || 'imported_exam';
        normalized.title = this._stringify(record.title) || this._stringify(record.examTitle) || normalized.examId;
        normalized.type = this._pickString([record.type, record.category, record.mode, record.section, 'practice']);
        normalized.date = this._normalizeDate(record.date || record.startTime || record.createdAt || now) || now;
        normalized.startTime = this._normalizeDate(record.startTime || record.date || record.createdAt) || normalized.date;
        normalized.endTime = this._normalizeDate(record.endTime || record.completedAt || record.finishTime) || normalized.startTime;
        normalized.duration = this._pickDuration([
            record.duration,
            record.realData?.duration,
            record.realData?.durationSeconds,
            record.realData?.elapsedSeconds
        ], normalized.startTime, normalized.endTime);
        normalized.score = this._pickNumber([
            record.score,
            record.realData?.score,
            record.realData?.percentage,
            record.percentage,
            record.accuracy
        ], 0);
        normalized.totalQuestions = this._pickInteger([
            record.totalQuestions,
            record.questionCount,
            record.realData?.totalQuestions,
            record.realData?.questionCount
        ], 0);
        normalized.correctAnswers = this._pickInteger([
            record.correctAnswers,
            record.correct,
            record.realData?.correctAnswers,
            record.realData?.correct
        ], 0);

        if (normalized.accuracy === undefined) {
            const accuracy = this._pickNumber([record.accuracy, record.realData?.accuracy]);
            if (accuracy !== null) {
                normalized.accuracy = accuracy;
            }
        }

        if (record.realData && typeof record.realData === 'object') {
            normalized.realData = { ...record.realData };
        }

        return normalized;
    }

    _prepareSystemSettings(settings) {
        if (!settings || typeof settings !== 'object') {
            return {};
        }
        const allowed = ['theme', 'language', 'autoSave', 'notifications'];
        const prepared = {};
        for (const key of allowed) {
            if (settings[key] !== undefined) {
                prepared[key] = settings[key];
            }
        }
        return prepared;
    }

    _stringify(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }

    _pickString(values) {
        for (const value of values) {
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
        return 'practice';
    }

    _pickNumber(values, fallback = null) {
        for (const value of values) {
            const number = Number(value);
            if (Number.isFinite(number)) {
                return number;
            }
        }
        return fallback;
    }

    _pickInteger(values, fallback = 0) {
        for (const value of values) {
            const number = Number(value);
            if (Number.isInteger(number)) {
                return number;
            }
        }
        return fallback;
    }

    _normalizeDate(value) {
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
                    const millis = trimmed.length > 10 ? numeric : numeric * 1000;
                    return new Date(millis).toISOString();
                }
            }
            const date = new Date(trimmed);
            if (!Number.isNaN(date.getTime())) {
                return date.toISOString();
            }
        }
        return null;
    }

    _pickDuration(values, start, end) {
        for (const value of values) {
            const number = Number(value);
            if (Number.isFinite(number) && number >= 0) {
                return number;
            }
        }
        const startTime = start ? new Date(start).getTime() : NaN;
        const endTime = end ? new Date(end).getTime() : NaN;
        if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
            return Math.round((endTime - startTime) / 1000);
        }
        return 0;
    }
}

let dataIntegrityManagerInstance = null;

function getDataIntegrityManager() {
    if (!dataIntegrityManagerInstance) {
        dataIntegrityManagerInstance = new DataIntegrityManager();
    }
    return dataIntegrityManagerInstance;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataIntegrityManager, getDataIntegrityManager };
} else {
    window.DataIntegrityManager = DataIntegrityManager;
    window.getDataIntegrityManager = getDataIntegrityManager;
}
