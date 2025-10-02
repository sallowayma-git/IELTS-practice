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
        this.simpleStorage = null;
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
            // 使用简单存储包装器替代复杂的数据访问层
            if (window.simpleStorageWrapper) {
                this.simpleStorage = window.simpleStorageWrapper;
                console.log('[DataIntegrityManager] 使用简单存储包装器');

                // 启动自动备份
                this.startAutoBackup();

                // 尝试立即清理旧备份，防止一启动就触发配额
                try { await this.cleanupOldBackups(); } catch (_) {}

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
     * 清理旧备份
     */
    async cleanupOldBackups() {
        try {
            const backups = await this.simpleStorage.getBackups();
            if (backups.length <= this.maxBackups) return; // 无需清理
            // 按时间排序，删除最早的
            const sorted = backups.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const toDelete = sorted.slice(0, sorted.length - this.maxBackups);
            for (const backup of toDelete) {
                await this.simpleStorage.deleteBackup(backup.id);
            }
            console.log(`[DataIntegrityManager] 已清理 ${toDelete.length} 个旧备份`);
        } catch (error) {
            console.error('[DataIntegrityManager] 清理旧备份失败:', error);
        }
    }

    /**
     * 创建备份
     */
    async createBackup(providedData, type = 'manual') {
        let data = null;
        try {
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
            await this.simpleStorage.addBackup(backupObj);
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

    /**
     * 配额溢出时导出数据
     */
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
     * 获取备份列表
     */
    async getBackupList() {
        try {
            const backups = await this.simpleStorage.getBackups();
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

    /**
     * 恢复备份
     */
    async restoreBackup(backupId) {
        try {
            const backups = await this.simpleStorage.getBackups();
            const backup = backups.find(b => b.id === backupId);
            if (!backup) {
                throw new Error('备份不存在');
            }
            const data = backup.data;
            // 恢复 practice_records
            await this.simpleStorage.savePracticeRecords(data.practice_records || []);
            // 恢复 system_settings（合并到 user_settings）
            const currentSettings = await this.simpleStorage.getUserSettings();
            const restoredSettings = { ...currentSettings, ...data.system_settings };
            await this.simpleStorage.saveUserSettings(restoredSettings);
            console.log(`[DataIntegrityManager] 备份 ${backupId} 恢复成功`);
        } catch (error) {
            console.error('[DataIntegrityManager] 恢复备份失败:', error);
            throw error;
        }
    }

    /**
     * 导出数据
     */
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

    /**
     * 获取关键数据 (优化版)
     */
    async getCriticalData() {
        this._ensureInitialized();

        try {
            const data = {};

            // 使用简单存储包装器获取数据
            if (this.simpleStorage) {
                try {
                    // 获取练习记录 (异步操作)
                    const practiceRecords = await this.simpleStorage.getPracticeRecords();
                    data.practice_records = practiceRecords || [];

                    // 获取系统设置
                    const allSettings = await this.simpleStorage.getUserSettings();
                    const systemSettings = {
                        theme: allSettings.theme,
                        language: allSettings.language,
                        autoSave: allSettings.autoSave,
                        notifications: allSettings.notifications
                    };
                    data.system_settings = systemSettings;
                } catch (storageError) {
                    console.warn('[DataIntegrityManager] 存储访问错误:', storageError);
                    data.practice_records = [];
                    data.system_settings = {};
                }
            }

            return data;
        } catch (error) {
            console.error('[DataIntegrityManager] 获取关键数据失败:', error);
            return {};
        }
    }
}

let dataIntegrityManagerInstance = null;

/**
 * 获取或创建数据完整性管理器单例
 */
function getDataIntegrityManager() {
    if (!dataIntegrityManagerInstance) {
        dataIntegrityManagerInstance = new DataIntegrityManager();
    }
    return dataIntegrityManagerInstance;
}

// 导出（如果使用模块）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DataIntegrityManager, getDataIntegrityManager };
} else {
    // 全局暴露
    window.DataIntegrityManager = DataIntegrityManager;
    window.getDataIntegrityManager = getDataIntegrityManager;
}
