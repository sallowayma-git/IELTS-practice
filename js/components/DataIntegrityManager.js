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
