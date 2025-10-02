/**
 * 数据完整性管理器 (优化版)
 * 负责数据备份、验证、修复和导入导出功能
 * 集成了新的数据访问层和缓存策略
 */
class DataIntegrityManager {
    constructor() {
        this.backupInterval = 600000; // 10分钟自动备份
        this.maxBackups = 5; // 最多保留5个备份（减少占用）
        this.dataVersion = '1.0.0';
        this.backupTimer = null;
        this.validationRules = new Map();
        this.dataAccessLayer = null;
        this.repositoryFactory = null;
        this.isInitialized = false;

        // 注册默认验证规则
        this.registerDefaultValidationRules();

        // 延迟初始化，等待数据访问层就绪
        this.initializeWhenReady();

        console.log('[DataIntegrityManager] 数据完整性管理器已创建');
    }

    /**
     * 当数据访问层就绪时初始化
     */
    async initializeWhenReady() {
        try {
            // 等待数据访问层初始化
            if (window.dataAccessLayer) {
                await window.dataAccessLayer.initialize();
                this.dataAccessLayer = window.dataAccessLayer;
                this.repositoryFactory = this.dataAccessLayer.repositoryFactory;

                // 启动自动备份
                this.startAutoBackup();

                // 尝试立即清理旧备份，防止一启动就触发配额
                try { this.cleanupOldBackups(); } catch (_) {}

                this.isInitialized = true;
                console.log('[DataIntegrityManager] 数据完整性管理器已初始化');
            } else {
                // 如果数据访问层尚未就绪，延迟重试
                setTimeout(() => this.initializeWhenReady(), 1000);
            }
        } catch (error) {
            console.error('[DataIntegrityManager] 初始化失败:', error);
            // 降级使用传统方式
            this.startAutoBackup();
            this.isInitialized = true;
        }
    }

    /**
     * 确保已初始化
     */
    _ensureInitialized() {
        if (!this.isInitialized) {
            console.warn('[DataIntegrityManager] 尚未完全初始化，使用降级模式');
        }
    }

    /**
     * 注册默认验证规则
     */
    registerDefaultValidationRules() {
        // 练习记录验证规则
        this.validationRules.set('practice_records', {
            required: ['id', 'startTime'],
            types: {
                id: 'string',
                startTime: 'string',
                endTime: 'string',
                date: 'string', // Allow 'date' as well
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

        // 系统设置验证规则
        this.validationRules.set('system_settings', {
            types: {
                theme: 'string',
                language: 'string',
                autoSave: 'boolean',
                notifications: 'boolean'
            }
        });
    }

    /**
     * 启动自动备份
     */
    startAutoBackup() {
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
        }

        this.backupTimer = setInterval(() => {
            this.performAutoBackup();
        }, this.backupInterval);

        console.log(`[DataIntegrityManager] 自动备份已启动 (${this.backupInterval / 1000}秒间隔)`);
    }

    /**
     * 停止自动备份
     */
    stopAutoBackup() {
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
            this.backupTimer = null;
            console.log('[DataIntegrityManager] 自动备份已停止');
        }
    }

    /**
     * 执行自动备份 (优化版)
     */
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

    /**
     * 获取关键数据 (优化版)
     */
    async getCriticalData() {
        this._ensureInitialized();

        try {
            const data = {};

            // 使用新的数据访问层获取数据
            if (this.repositoryFactory) {
                try {
                    // 获取练习记录
                    const practiceRepo = this.repositoryFactory.getPracticeRecordRepository();
                    const practiceRecords = await practiceRepo.getAll({ limit: 1000 }); // 限制数量避免过大
                    if (practiceRecords.length > 0) {
                        data.practice_records = practiceRecords;
                    }

                    // 获取用户设置
                    const settingsRepo = this.repositoryFactory.getUserSettingsRepository();
                    const userSettings = await settingsRepo.getAll();
                    if (Object.keys(userSettings).length > 0) {
                        data.user_settings = userSettings;
                    }

                    console.log(`[DataIntegrityManager] 通过新数据访问层获取到关键数据: ${Object.keys(data).length} 项`);
                } catch (repoError) {
                    console.warn('[DataIntegrityManager] 新数据访问层获取失败，降级到传统方式:', repoError);
                    return this._getCriticalDataLegacy();
                }
            } else {
                // 降级到传统方式
                return this._getCriticalDataLegacy();
            }

            return data;
        } catch (error) {
            console.error('[DataIntegrityManager] 获取关键数据失败:', error);
            return this._getCriticalDataLegacy();
        }
    }

    /**
     * 传统方式获取关键数据 (降级方案)
     */
    _getCriticalDataLegacy() {
        const criticalKeys = [
            'practice_records',
            'system_settings',
            'user_preferences',
            'exam_progress'
        ];

        const data = {};
        criticalKeys.forEach(key => {
            try {
                let value;
                if (window.storage) {
                    // 使用存储管理器
                    value = window.storage.get(key);
                } else {
                    // 直接使用localStorage
                    value = localStorage.getItem(key);
                    if (value) {
                        value = JSON.parse(value);
                    }
                }

                if (value && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0)) {
                    data[key] = value;
                }
            } catch (error) {
                console.warn(`[DataIntegrityManager] 读取 ${key} 失败:`, error);
            }
        });

        console.log(`[DataIntegrityManager] 通过传统方式获取到关键数据: ${Object.keys(data).length} 项`);
        return data;
    }

    /**
     * 创建备份
     */
    async createBackup(data = null, type = 'manual') {
        try {
            const backupData = data || this.getCriticalData();
            
            const backup = {
                id: this.generateBackupId(),
                timestamp: new Date().toISOString(),
                type: type,
                version: this.dataVersion,
                data: backupData,
                checksum: this.calculateChecksum(backupData)
            };

            const backupKey = `backup_${backup.id}`;
            const backupStr = JSON.stringify(backup);

            // 如果备份体积过大，直接导出文件，避免占满localStorage
            const approxSizeKB = Math.round(backupStr.length / 1024);
            if (approxSizeKB > 4500) { // ~4.5MB 阈值（多数浏览器配额约5MB）
                console.warn('[DataIntegrityManager] 备份体积过大，改为文件下载备份:', approxSizeKB, 'KB');
                this.downloadBackupFile(backup);
                this.safeUpdateBackupIndex({
                    id: backup.id,
                    timestamp: backup.timestamp,
                    type: `${type}_file_large`,
                    version: backup.version,
                    size: backupStr.length,
                    location: 'download'
                });
                this.notifyUser('备份体积过大，已直接下载到本地文件', 'warning');
                return { ...backup, external: true, large: true };
            }

            // 首先尝试存储，如果空间不足则逐步清理旧备份后重试
            const stored = this.tryStoreBackupWithEviction(backupKey, backupStr);

            if (!stored) {
                // 仍然无法存储，触发下载备份到本地文件并记录提示
                console.warn('[DataIntegrityManager] 本地空间不足，切换为文件下载备份');
                this.downloadBackupFile(backup);
                this.safeUpdateBackupIndex({
                    id: backup.id,
                    timestamp: backup.timestamp,
                    type: `${type}_file`,
                    version: backup.version,
                    size: backupStr.length,
                    location: 'download'
                });
                this.notifyUser('本地存储空间不足，已将备份下载为文件', 'warning');
                return { ...backup, external: true };
            }

            // 更新备份索引（带有健壮的配额处理）
            this.safeUpdateBackupIndex({
                id: backup.id,
                timestamp: backup.timestamp,
                type: backup.type,
                version: backup.version,
                size: backupStr.length,
                location: 'localStorage'
            });

            // 清理超过上限的旧备份
            this.cleanupOldBackups();

            console.log(`[DataIntegrityManager] 备份已创建: ${backup.id} (${type})`);
            return backup;

        } catch (error) {
            console.error('[DataIntegrityManager] 创建备份失败:', error);
            // 如果是配额问题，在此层提供最终保底方案：导出为文件并不抛出异常
            if (this.isQuotaExceeded(error)) {
                try {
                    this.exportData();
                    this.notifyUser('本地空间不足：已导出数据为文件', 'warning');
                } catch (e2) {
                    console.error('[DataIntegrityManager] 保底导出失败:', e2);
                    this.notifyUser('本地空间不足且导出失败，请清理浏览器存储空间后重试', 'error');
                }
                return { external: true, exported: true, error: error?.message };
            }
            throw error;
        }
    }

    /**
     * 更新备份索引
     */
    updateBackupIndex(backup) {
        try {
            // 保持向后兼容，但推荐使用 safeUpdateBackupIndex
            const index = JSON.parse(localStorage.getItem('backup_index') || '[]');
            index.push({
                id: backup.id,
                timestamp: backup.timestamp,
                type: backup.type,
                version: backup.version,
                size: JSON.stringify(backup).length
            });
            index.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            localStorage.setItem('backup_index', JSON.stringify(index));
        } catch (error) {
            console.error('[DataIntegrityManager] 更新备份索引失败:', error);
        }
    }

    safeUpdateBackupIndex(entry) {
        try {
            const index = JSON.parse(localStorage.getItem('backup_index') || '[]');
            index.push(entry);
            index.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            try {
                localStorage.setItem('backup_index', JSON.stringify(index));
            } catch (e) {
                // 如果索引写入也超限，移除最旧项再试
                while (index.length > 0) {
                    index.pop();
                    try {
                        localStorage.setItem('backup_index', JSON.stringify(index));
                        console.warn('[DataIntegrityManager] 备份索引空间不足，已丢弃部分索引条目');
                        break;
                    } catch (_) {
                        continue;
                    }
                }
            }
        } catch (error) {
            console.error('[DataIntegrityManager] 安全更新备份索引失败:', error);
        }
    }

    tryStoreBackupWithEviction(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            if (!this.isQuotaExceeded(e)) throw e;
            // 更积极的清理：持续删除最旧备份直到成功或没有可删项
            let index;
            try {
                index = JSON.parse(localStorage.getItem('backup_index') || '[]');
            } catch (_) {
                index = [];
            }
            // 仅考虑本地备份
            index = index.filter(entry => entry.location !== 'download');
            while (index.length > 0) {
                const last = index[index.length - 1];
                try { localStorage.removeItem(`backup_${last.id}`); } catch (_) {}
                index.pop();
                try { localStorage.setItem('backup_index', JSON.stringify(index)); } catch (_) {}
                try {
                    localStorage.setItem(key, value);
                    return true;
                } catch (e2) {
                    if (!this.isQuotaExceeded(e2)) throw e2;
                    // 继续清理
                }
            }
            // 无可清理仍然失败
            return false;
        }
    }

    isQuotaExceeded(e) {
        return e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    }

    downloadBackupFile(backup) {
        try {
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ielts_backup_${backup.id}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('[DataIntegrityManager] 下载备份文件失败:', error);
        }
    }

    notifyUser(message, type = 'info') {
        if (window.showMessage) {
            window.showMessage(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    /**
     * 清理旧备份
     */
    cleanupOldBackups() {
        try {
            let index = JSON.parse(localStorage.getItem('backup_index') || '[]');

            // 只保留存储在localStorage的备份（忽略 location='download' 记录）
            index = index.filter(entry => entry.location !== 'download');
            if (index.length > this.maxBackups) {
                const toDelete = index.slice(this.maxBackups);
                toDelete.forEach(backup => {
                    try { localStorage.removeItem(`backup_${backup.id}`); } catch (_) {}
                });
                const newIndex = index.slice(0, this.maxBackups);
                localStorage.setItem('backup_index', JSON.stringify(newIndex));
                console.log(`[DataIntegrityManager] 已清理 ${toDelete.length} 个旧备份`);
            } else {
                // 写回过滤后的索引
                localStorage.setItem('backup_index', JSON.stringify(index));
            }
        } catch (error) {
            console.error('[DataIntegrityManager] 清理旧备份失败:', error);
        }
    }

    /**
     * 获取备份列表
     */
    getBackupList() {
        try {
            return JSON.parse(localStorage.getItem('backup_index') || '[]');
        } catch (error) {
            console.error('[DataIntegrityManager] 获取备份列表失败:', error);
            return [];
        }
    }

    /**
     * 恢复备份
     */
    async restoreBackup(backupId) {
        try {
            const backupData = localStorage.getItem(`backup_${backupId}`);
            if (!backupData) {
                throw new Error(`备份不存在: ${backupId}`);
            }

            const backup = JSON.parse(backupData);
            
            // 验证备份完整性
            const calculatedChecksum = this.calculateChecksum(backup.data);
            if (calculatedChecksum !== backup.checksum) {
                throw new Error('备份数据校验失败，可能已损坏');
            }

            // 创建当前数据的备份
            await this.createBackup(null, 'pre_restore');

            // 恢复数据
            Object.entries(backup.data).forEach(([key, value]) => {
                try {
                    localStorage.setItem(key, JSON.stringify(value));
                } catch (error) {
                    console.error(`[DataIntegrityManager] 恢复 ${key} 失败:`, error);
                }
            });

            console.log(`[DataIntegrityManager] 备份恢复完成: ${backupId}`);

            // 尝试通知主应用刷新
            if (window.syncPracticeRecords) {
                console.log('[DataIntegrityManager] Notifying main window to sync records after restore...');
                window.syncPracticeRecords();
            }
            
            return true;

        } catch (error) {
            console.error('[DataIntegrityManager] 恢复备份失败:', error);
            throw error;
        }
    }

    /**
     * 验证数据完整性
     */
    validateData(key, data) {
        const rules = this.validationRules.get(key);
        if (!rules) {
            return { valid: true, errors: [] };
        }

        const errors = [];

        // 检查必需字段
        if (rules.required && Array.isArray(data)) {
            data.forEach((item, index) => {
                rules.required.forEach(field => {
                    if (!(field in item)) {
                        errors.push(`项目 ${index}: 缺少必需字段 '${field}'`);
                    }
                });
            });
        }

        // 检查数据类型
        if (rules.types && Array.isArray(data)) {
            data.forEach((item, index) => {
                Object.entries(rules.types).forEach(([field, expectedType]) => {
                    if (field in item) {
                        const actualType = typeof item[field];
                        if (actualType !== expectedType) {
                            errors.push(`项目 ${index}: 字段 '${field}' 类型错误，期望 ${expectedType}，实际 ${actualType}`);
                        }
                    }
                });
            });
        }

        // 执行自定义验证器
        if (rules.validators && Array.isArray(data)) {
            data.forEach((item, index) => {
                Object.entries(rules.validators).forEach(([field, validator]) => {
                    if (field in item) {
                        try {
                            if (!validator(item[field])) {
                                errors.push(`项目 ${index}: 字段 '${field}' 验证失败`);
                            }
                        } catch (error) {
                            errors.push(`项目 ${index}: 字段 '${field}' 验证器执行失败: ${error.message}`);
                        }
                    }
                });
            });
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * 修复数据
     */
    repairData(key, data) {
        const rules = this.validationRules.get(key);
        if (!rules || !Array.isArray(data)) {
            return data;
        }

        const repairedData = data.map(item => {
            const newItem = { ...item };
            // Compatibility fix: If 'startTime' is missing but 'date' exists, use 'date'.
            if (!newItem.startTime && newItem.date) {
                newItem.startTime = newItem.date;
            }
            return newItem;
        }).filter(item => {
            // 检查必需字段
            if (rules.required) {
                for (const field of rules.required) {
                    if (!(field in item)) {
                        console.warn(`[DataIntegrityManager] 移除缺少必需字段的项目:`, item);
                        return false;
                    }
                }
            }

            // 修复数据类型
            if (rules.types) {
                Object.entries(rules.types).forEach(([field, expectedType]) => {
                    if (field in item) {
                        const actualType = typeof item[field];
                        if (actualType !== expectedType) {
                            try {
                                // 尝试类型转换
                                if (expectedType === 'number' && actualType === 'string') {
                                    const num = parseFloat(item[field]);
                                    if (!isNaN(num)) {
                                        item[field] = num;
                                    }
                                } else if (expectedType === 'string' && actualType !== 'string') {
                                    item[field] = String(item[field]);
                                } else if (expectedType === 'boolean' && actualType !== 'boolean') {
                                    item[field] = Boolean(item[field]);
                                }
                            } catch (error) {
                                console.warn(`[DataIntegrityManager] 类型转换失败:`, field, error);
                            }
                        }
                    }
                });
            }

            return true;
        });

        if (repairedData.length !== data.length) {
            console.log(`[DataIntegrityManager] 数据修复完成: ${key}, 移除了 ${data.length - repairedData.length} 个无效项目`);
        }

        return repairedData;
    }

    /**
     * 导出数据
     */
    exportData(keys = null) {
        try {
            const keysToExport = keys || Object.keys(localStorage).filter(key => 
                !key.startsWith('backup_') && !key.startsWith('_')
            );

            const exportData = {
                exportId: this.generateBackupId(),
                timestamp: new Date().toISOString(),
                version: this.dataVersion,
                data: {}
            };

            keysToExport.forEach(key => {
                try {
                    const value = localStorage.getItem(key);
                    if (value == null) return;
                    const trimmed = value.trim();
                    // 仅当看起来是JSON时才解析，否则按原始字符串导出，避免噪音告警
                    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                        exportData.data[key] = JSON.parse(value);
                    } else {
                        exportData.data[key] = value; // 原样导出简单字符串（如 theme/light 等）
                    }
                } catch (error) {
                    // 解析失败时，降级为原始字符串，不再打警告
                    try { exportData.data[key] = localStorage.getItem(key); } catch(_) {}
                }
            });

            // 兼容层：确保导出包含扁平 practice_records 和 user_stats，便于旧版系统直接导入
            try {
                const prefix = (window.storage && window.storage.prefix) ? window.storage.prefix : 'exam_system_';
                if (!Array.isArray(exportData.data.practice_records)) {
                    const wrappedRecs = exportData.data[`${prefix}practice_records`];
                    if (wrappedRecs && Array.isArray(wrappedRecs.data)) {
                        exportData.data.practice_records = wrappedRecs.data;
                    } else if (window.storage && window.storage.get) {
                        exportData.data.practice_records = window.storage.get('practice_records', []);
                    } else {
                        exportData.data.practice_records = [];
                    }
                }
                if (!exportData.data.user_stats || typeof exportData.data.user_stats !== 'object') {
                    const wrappedStats = exportData.data[`${prefix}user_stats`];
                    if (wrappedStats && wrappedStats.data) {
                        exportData.data.user_stats = wrappedStats.data;
                    } else if (window.storage && window.storage.get) {
                        exportData.data.user_stats = window.storage.get('user_stats', {});
                    } else {
                        exportData.data.user_stats = {};
                    }
                }
            } catch (e) {
                console.warn('[DataIntegrityManager] 导出兼容层处理失败:', e);
            }

            exportData.checksum = this.calculateChecksum(exportData.data);

            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Use local system date (YYYY-MM-DD) for filename
            (function(){
                try {
                    const d = new Date();
                    const pad = (n) => String(n).padStart(2, '0');
                    const localDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
                    a.download = `ielts_data_export_${localDate}.json`;
                } catch (_) {
                    a.download = `ielts_data_export_${new Date().toISOString().split('T')[0]}.json`;
                }
            })();
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('[DataIntegrityManager] 数据导出完成');
            return exportData;

        } catch (error) {
            console.error('[DataIntegrityManager] 数据导出失败:', error);
            throw error;
        }
    }

    /**
     * 导入数据
     */
    async importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (event) => {
                try {
                    // Prefer delegating to DataBackupManager for robust import (handles large files and shapes)
                    try {
                        const raw = event.target.result;
                        const mgr = (window.__dataBackupManagerInstance || (window.__dataBackupManagerInstance = new (window.DataBackupManager || DataBackupManager)()));
                        const result = await mgr.importPracticeData(raw, {
                            mergeMode: 'merge',
                            validateData: true,
                            createBackup: true,
                            preserveIds: true
                        });
                        if (typeof window.syncPracticeRecords === 'function') {
                            try { window.syncPracticeRecords(); } catch (_) {}
                        }
                        console.log('[DataIntegrityManager] Delegated import done:', result);
                        resolve({
                            importedCount: result.importedCount || 0,
                            updatedCount: result.updatedCount || 0,
                            skippedCount: result.skippedCount || 0,
                            finalCount: result.finalCount || 0
                        });
                        return; // stop here if delegation succeeded
                    } catch (__delegateErr) {
                        // fall back to legacy compatibility logic below
                    }
                    const importFileContent = JSON.parse(event.target.result);

                    // 兼容层（新旧导出格式）：优先处理 exam_system_* 包装结构，避免双重前缀与嵌套
                    try {
                        const prefix = (window.storage && window.storage.prefix) ? window.storage.prefix : 'exam_system_';
                        const dataSection = importFileContent && importFileContent.data ? importFileContent.data : null;
                        if (!dataSection) throw new Error('NO_DATA_SECTION');

                        // 提取练习记录（优先非空来源，避免空的 practice_records 覆盖真实数据）
                        let recordsToImport = [];
                        // exam_system_practice_records 包装（优先）
                        if (dataSection[`${prefix}practice_records`] && Array.isArray(dataSection[`${prefix}practice_records`].data) && dataSection[`${prefix}practice_records`].data.length) {
                            recordsToImport = dataSection[`${prefix}practice_records`].data;
                        }
                        // 顶层 practice_records（仅在非空时覆盖）
                        if (Array.isArray(dataSection.practice_records) && dataSection.practice_records.length) {
                            recordsToImport = dataSection.practice_records;
                        }
                        // 其它旧命名
                        if (!recordsToImport.length && Array.isArray(importFileContent.records)) {
                            recordsToImport = importFileContent.records;
                        }
                        if (!recordsToImport.length && Array.isArray(importFileContent.practiceRecords)) {
                            recordsToImport = importFileContent.practiceRecords;
                        }
                        // 根级 exam_system_practice_records.data（兜底）
                        if (!recordsToImport.length && importFileContent[`${prefix}practice_records`] && Array.isArray(importFileContent[`${prefix}practice_records`].data)) {
                            recordsToImport = importFileContent[`${prefix}practice_records`].data;
                        }

                        // 提取用户统计（可选）
                        let userStatsToImport = null;
                        if (dataSection.user_stats && typeof dataSection.user_stats === 'object') {
                            userStatsToImport = dataSection.user_stats;
                        } else if (dataSection[`${prefix}user_stats`] && dataSection[`${prefix}user_stats`].data) {
                            userStatsToImport = dataSection[`${prefix}user_stats`].data;
                        } else if (importFileContent.userStats) {
                            userStatsToImport = importFileContent.userStats;
                        }

                        // 写入关键数据：仅当有记录时覆盖，避免用空数组清空
                        if (Array.isArray(recordsToImport) && recordsToImport.length) {
                            if (window.storage) {
                                storage.set('practice_records', recordsToImport);
                            } else {
                                localStorage.setItem('practice_records', JSON.stringify(recordsToImport));
                            }
                        }
                        if (userStatsToImport) {
                            if (window.storage) {
                                storage.set('user_stats', userStatsToImport);
                            } else {
                                localStorage.setItem('user_stats', JSON.stringify(userStatsToImport));
                            }
                        }

                        // 其余数据键：去前缀并解包 data
                        Object.entries(dataSection).forEach(([key, value]) => {
                            try {
                                // 跳过已处理的关键键，以及其带前缀的等价键
                                const cleanKey = key.startsWith(prefix) ? key.slice(prefix.length) : key;
                                if (cleanKey === 'practice_records' || cleanKey === 'user_stats') return;
                                const unwrapped = (value && typeof value === 'object' && 'data' in value) ? value.data : value;
                                if (window.storage) {
                                    storage.set(cleanKey, unwrapped);
                                } else {
                                    localStorage.setItem(cleanKey, JSON.stringify(unwrapped));
                                }
                            } catch (e) {
                                console.error(`[DataIntegrityManager] 导入 ${key} 失败:`, e);
                            }
                        });

                        if (window.syncPracticeRecords) {
                            console.log('[DataIntegrityManager] 通知主窗口同步记录..');
                            window.syncPracticeRecords();
                        }
                        resolve({ importedCount: Array.isArray(recordsToImport) ? recordsToImport.length : 0 });
                        return; // 避免落入旧逻辑
                    } catch (__compatErr) {
                        // 回退到旧逻辑
                    }

                    // 核心逻辑: 只关心 'practice_records'
                    if (importFileContent && importFileContent.data && Array.isArray(importFileContent.data.practice_records)) {
                        const recordsToImport = importFileContent.data.practice_records;
                        
                        // 直接、无条件地覆盖localStorage
                        // 使用已有的 storage 辅助函数
                        if (window.storage) {
                           storage.set('practice_records', recordsToImport);
                        } else {
                           localStorage.setItem('practice_records', JSON.stringify(recordsToImport));
                        }
                        
                        console.log(`[DataIntegrityManager] 强制写入 ${recordsToImport.length} 条练习记录到 localStorage.`);

                        // 通知主窗口同步
                        if (window.syncPracticeRecords) {
                            console.log('[DataIntegrityManager] 通知主窗口同步记录...');
                            window.syncPracticeRecords();
                        }
                        
                        resolve({ importedCount: recordsToImport.length });

                    } else {
                        // 也许用户导入了其他数据, 我们只关心练习记录
                        if (importFileContent && importFileContent.data) {
                             Object.entries(importFileContent.data).forEach(([key, value]) => {
                                try {
                                    const prefix = (window.storage && window.storage.prefix) ? window.storage.prefix : 'exam_system_';
                                    const cleanKey = key.startsWith(prefix) ? key.slice(prefix.length) : key;
                                    const unwrapped = (value && typeof value === 'object' && 'data' in value) ? value.data : value;
                                    if (window.storage) {
                                        storage.set(cleanKey, unwrapped);
                                    } else {
                                        localStorage.setItem(cleanKey, JSON.stringify(unwrapped));
                                    }
                                } catch (error) {
                                    console.error(`[DataIntegrityManager] 导入 ${key} 失败:`, error);
                                }
                            });
                            console.log('[DataIntegrityManager] 导入文件不包含练习记录，但已尝试导入其他数据。');
                            
                            if (window.syncPracticeRecords) {
                                console.log('[DataIntegrityManager] 通知主窗口同步记录...');
                                window.syncPracticeRecords();
                            }
                            resolve({ importedCount: Object.keys(importFileContent.data).length });
                        } else {
                             throw new Error('导入文件格式不正确，未找到 "data" 对象。');
                        }
                    }
                } catch (error) {
                    console.error('[DataIntegrityManager] 导入失败:', error);
                    reject(error);
                }
            };

            reader.onerror = () => {
                reject(new Error('文件读取失败'));
            };

            reader.readAsText(file);
        });
    }

    /**
     * 检查数据兼容性
     */
    checkDataCompatibility() {
        try {
            const currentVersion = this.dataVersion;
            const storedVersion = localStorage.getItem('data_version') || '1.0.0';

            if (this.compareVersions(currentVersion, storedVersion) > 0) {
                console.log(`[DataIntegrityManager] 检测到版本升级: ${storedVersion} -> ${currentVersion}`);
                return this.performDataMigration(storedVersion, currentVersion);
            }

            return { compatible: true, migrated: false };
        } catch (error) {
            console.error('[DataIntegrityManager] 兼容性检查失败:', error);
            return { compatible: false, error: error.message };
        }
    }

    /**
     * 执行数据迁移
     */
    performDataMigration(fromVersion, toVersion) {
        try {
            console.log(`[DataIntegrityManager] 开始数据迁移: ${fromVersion} -> ${toVersion}`);

            // 创建迁移前备份
            this.createBackup(null, 'pre_migration');

            // 这里可以添加具体的迁移逻辑
            // 例如：字段重命名、数据格式转换等

            // 更新版本号
            localStorage.setItem('data_version', toVersion);

            console.log('[DataIntegrityManager] 数据迁移完成');
            return { compatible: true, migrated: true };

        } catch (error) {
            console.error('[DataIntegrityManager] 数据迁移失败:', error);
            return { compatible: false, migrated: false, error: error.message };
        }
    }

    /**
     * 比较版本号
     */
    compareVersions(version1, version2) {
        const v1Parts = version1.split('.').map(Number);
        const v2Parts = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            
            if (v1Part > v2Part) return 1;
            if (v1Part < v2Part) return -1;
        }
        
        return 0;
    }

    /**
     * 计算校验和
     */
    calculateChecksum(data) {
        const str = JSON.stringify(data);
        let hash = 0;
        
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        
        return hash.toString(16);
    }

    /**
     * 生成备份ID
     */
    generateBackupId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取数据完整性报告
     */
    getIntegrityReport() {
        const report = {
            timestamp: new Date().toISOString(),
            dataVersion: this.dataVersion,
            backups: this.getBackupList(),
            validation: {}
        };

        // 验证所有关键数据
        const criticalData = this.getCriticalData();
        Object.entries(criticalData).forEach(([key, value]) => {
            report.validation[key] = this.validateData(key, value);
        });

        return report;
    }

    /**
     * 清理资源
     */
    cleanup() {
        console.log('[DataIntegrityManager] 清理资源');
        this.stopAutoBackup();
        this.validationRules.clear();
    }
}

// 导出类
window.DataIntegrityManager = DataIntegrityManager;

// Export override: ensure flattened fields come from StorageManager snapshot
(function() {
  try {
    const proto = DataIntegrityManager && DataIntegrityManager.prototype;
    if (!proto || typeof proto.exportData !== 'function') return;
    const originalExport = proto.exportData;
    proto.exportData = function(keys = null) {
      const result = originalExport.call(this, keys);
      try {
        if (window && window.storage && typeof window.storage.get === 'function' && result && result.data) {
          // Force flattened fields from StorageManager
          result.data.practice_records = window.storage.get('practice_records', []);
          result.data.user_stats = window.storage.get('user_stats', {});
          if (typeof this.calculateChecksum === 'function') {
            result.checksum = this.calculateChecksum(result.data);
          }
        }
      } catch (e) {
        try { console.warn('[DataIntegrityManager] export override failed:', e); } catch(_) {}
      }
      return result;
    };
  } catch (e) {
    try { console.warn('[DataIntegrityManager] export override install failed:', e); } catch(_) {}
  }
})();

// Strong override: export data in 09-21 schema using StorageManager snapshot (async-aware)
(function() {
  try {
    const proto = DataIntegrityManager && DataIntegrityManager.prototype;
    if (!proto) return;
    proto.exportData = function(keys = null) {
      const buildAndDownload = async () => {
        const out = {
          exportId: this.generateBackupId ? this.generateBackupId() : (Date.now()+"_"+Math.random().toString(36).slice(2,11)),
          timestamp: new Date().toISOString(),
          version: this.dataVersion || '1.0.0',
          data: {}
        };
        const prefix = (window.storage && window.storage.prefix) ? window.storage.prefix : 'exam_system_';

        // Prefer StorageManager snapshot (await Promise)
        let snapshot = null;
        try {
          if (window.storage && typeof window.storage.exportData === 'function') {
            snapshot = await window.storage.exportData();
          }
        } catch(_) {}

        if (snapshot && snapshot.data && typeof snapshot.data === 'object') {
          try {
            Object.entries(snapshot.data).forEach(([cleanKey, wrapped]) => {
              out.data[`${prefix}${cleanKey}`] = wrapped;
            });
          } catch(_) {}
        } else {
          // Fallback to prefixed localStorage keys only
          try {
            const keysToExport = keys || Object.keys(localStorage).filter(k => k.startsWith(prefix));
            keysToExport.forEach(k => {
              try {
                const v = localStorage.getItem(k);
                if (v == null) return;
                const t = v.trim();
                if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
                  out.data[k] = JSON.parse(v);
                } else {
                  out.data[k] = { data: v, timestamp: Date.now(), version: this.dataVersion || '1.0.0' };
                }
              } catch(__) {}
            });
          } catch(__) {}
        }

        // Flatten fields from wrapped keys to maintain 09-21 compatibility
        try {
          const wrappedRecs = out.data[`${prefix}practice_records`];
          const wrappedStats = out.data[`${prefix}user_stats`];
          out.data.practice_records = (wrappedRecs && Array.isArray(wrappedRecs.data)) ? wrappedRecs.data : [];
          out.data.user_stats = (wrappedStats && wrappedStats.data && typeof wrappedStats.data === 'object') ? wrappedStats.data : {};
        } catch(e) {
          try { console.warn('[DataIntegrityManager] flatten fields failed:', e); } catch(_) {}
          if (!Array.isArray(out.data.practice_records)) out.data.practice_records = [];
          if (!out.data.user_stats || typeof out.data.user_stats !== 'object') out.data.user_stats = {};
        }

        try { if (typeof this.calculateChecksum === 'function') out.checksum = this.calculateChecksum(out.data); } catch(_){ }

        const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        try {
          const d = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const localDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
          a.download = `ielts_data_export_${localDate}.json`;
        } catch(_) { a.download = `ielts_data_export_${new Date().toISOString().split('T')[0]}.json`; }
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return out;
      };

      try {
        return buildAndDownload(); // returns a Promise; callers may ignore
      } catch (err) {
        try { console.error('[DataIntegrityManager] export override (09-21 schema) failed:', err); } catch(_) {}
        return { exportId: Date.now(), timestamp: new Date().toISOString(), version: this.dataVersion||'1.0.0', data: {} };
      }
    };
  } catch (e) {
    try { console.warn('[DataIntegrityManager] strong export override install failed:', e); } catch(_) {}
  }
})();
