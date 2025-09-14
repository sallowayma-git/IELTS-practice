/**
 * 数据完整性管理器
 * 负责数据备份、验证、修复和导入导出功能
 */
class DataIntegrityManager {
    constructor() {
        this.backupInterval = 600000; // 10分钟自动备份
        this.maxBackups = 5; // 最多保留5个备份（减少占用）
        this.dataVersion = '1.0.0';
        this.backupTimer = null;
        this.validationRules = new Map();
        
        // 注册默认验证规则
        this.registerDefaultValidationRules();
        
        // 启动自动备份
        this.startAutoBackup();
        
        // 尝试立即清理旧备份，防止一启动就触发配额
        try { this.cleanupOldBackups(); } catch (_) {}
        
        console.log('[DataIntegrityManager] 数据完整性管理器已初始化');
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
     * 执行自动备份
     */
    async performAutoBackup() {
        try {
            const criticalData = this.getCriticalData();
            if (Object.keys(criticalData).length > 0) {
                await this.createBackup(criticalData, 'auto');
                console.log('[DataIntegrityManager] 自动备份完成');
            }
        } catch (error) {
            console.error('[DataIntegrityManager] 自动备份失败:', error);
        }
    }

    /**
     * 获取关键数据
     */
    getCriticalData() {
        const criticalKeys = [
            'practice_records',
            'system_settings',
            'user_preferences',
            'exam_progress'
        ];

        const data = {};
        criticalKeys.forEach(key => {
            try {
                const value = localStorage.getItem(key);
                if (value) {
                    data[key] = JSON.parse(value);
                }
            } catch (error) {
                console.warn(`[DataIntegrityManager] 读取 ${key} 失败:`, error);
            }
        });

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
                    if (value) {
                        exportData.data[key] = JSON.parse(value);
                    }
                } catch (error) {
                    console.warn(`[DataIntegrityManager] 导出 ${key} 失败:`, error);
                }
            });

            exportData.checksum = this.calculateChecksum(exportData.data);

            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ielts_data_export_${new Date().toISOString().split('T')[0]}.json`;
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
                    const importFileContent = JSON.parse(event.target.result);

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
                                    if (window.storage) {
                                        storage.set(key, value);
                                    } else {
                                        localStorage.setItem(key, JSON.stringify(value));
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