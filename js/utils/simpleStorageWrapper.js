/**
 * 简单存储包装器
 * 替代复杂的Repository模式，提供直接同步访问localStorage的简单接口
 */

class SimpleStorageWrapper {
    constructor() {
        this.storage = window.storage;
        if (!this.storage) {
            throw new Error('storage对象未找到，请确保storage.js已加载');
        }
    }

    // === 练习记录相关 ===

    /**
     * 获取所有练习记录 (异步)
     */
    async getPracticeRecords() {
        try {
            return await this.storage.get('practice_records', []);
        } catch (error) {
            console.error('[SimpleStorageWrapper] 获取练习记录失败:', error);
            return [];
        }
    }

    /**
     * 保存练习记录 (异步)
     */
    async savePracticeRecords(records) {
        try {
            await this.storage.set('practice_records', records);
            return true;
        } catch (error) {
            console.error('[SimpleStorageWrapper] 保存练习记录失败:', error);
            throw error;
        }
    }

    /**
     * 添加单个练习记录 (异步)
     */
    async addPracticeRecord(record) {
        const records = await this.getPracticeRecords();
        records.push(record);
        return await this.savePracticeRecords(records);
    }

    /**
     * 删除练习记录 (异步)
     */
    async deletePracticeRecord(recordId) {
        const records = await this.getPracticeRecords();
        const filteredRecords = records.filter(r => r.id !== recordId);
        return await this.savePracticeRecords(filteredRecords);
    }

    /**
     * 批量删除练习记录 (异步)
     */
    async deletePracticeRecords(recordIds) {
        const records = await this.getPracticeRecords();
        const filteredRecords = records.filter(r => !recordIds.includes(r.id));
        return await this.savePracticeRecords(filteredRecords);
    }

    /**
     * 获取练习记录数量 (异步)
     */
    async getPracticeRecordsCount() {
        const records = await this.getPracticeRecords();
        return records.length;
    }

    // === 用户设置相关 ===

    /**
     * 获取用户设置 (异步)
     */
    async getUserSettings() {
        try {
            return await this.storage.get('user_settings', {});
        } catch (error) {
            console.error('[SimpleStorageWrapper] 获取用户设置失败:', error);
            return {};
        }
    }

    /**
     * 保存用户设置 (异步)
     */
    async saveUserSettings(settings) {
        try {
            await this.storage.set('user_settings', settings);
            return true;
        } catch (error) {
            console.error('[SimpleStorageWrapper] 保存用户设置失败:', error);
            throw error;
        }
    }

    /**
     * 获取单个用户设置项 (异步)
     */
    async getUserSetting(key, defaultValue = null) {
        const settings = await this.getUserSettings();
        return settings.hasOwnProperty(key) ? settings[key] : defaultValue;
    }

    /**
     * 设置单个用户设置项 (异步)
     */
    async setUserSetting(key, value) {
        const settings = await this.getUserSettings();
        settings[key] = value;
        return await this.saveUserSettings(settings);
    }

    // === 备份相关 ===

    /**
     * 获取所有备份 (异步)
     */
    async getBackups() {
        try {
            return await this.storage.get('manual_backups', []);
        } catch (error) {
            console.error('[SimpleStorageWrapper] 获取备份失败:', error);
            return [];
        }
    }

    /**
     * 保存备份列表 (异步)
     */
    async saveBackups(backups) {
        try {
            await this.storage.set('manual_backups', backups);
            return true;
        } catch (error) {
            console.error('[SimpleStorageWrapper] 保存备份失败:', error);
            throw error;
        }
    }

    /**
     * 添加备份 (异步)
     */
    async addBackup(backup) {
        const backups = await this.getBackups();
        backups.unshift(backup);

        // 限制备份数量
        if (backups.length > 20) {
            backups.splice(20);
        }

        return await this.saveBackups(backups);
    }

    /**
     * 删除备份 (异步)
     */
    async deleteBackup(backupId) {
        const backups = await this.getBackups();
        const filteredBackups = backups.filter(b => b.id !== backupId);
        return await this.saveBackups(filteredBackups);
    }

    // === 通用数据访问 ===

    /**
     * 获取任意数据 (异步)
     */
    async getData(key, defaultValue = null) {
        try {
            return await this.storage.get(key, defaultValue);
        } catch (error) {
            console.error(`[SimpleStorageWrapper] 获取数据失败 ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * 设置任意数据 (异步)
     */
    async setData(key, value) {
        try {
            await this.storage.set(key, value);
            return true;
        } catch (error) {
            console.error(`[SimpleStorageWrapper] 设置数据失败 ${key}:`, error);
            throw error;
        }
    }

    /**
     * 删除数据 (异步)
     */
    async removeData(key) {
        try {
            await this.storage.remove(key);
            return true;
        } catch (error) {
            console.error(`[SimpleStorageWrapper] 删除数据失败 ${key}:`, error);
            throw error;
        }
    }

    /**
     * 检查数据是否存在 (异步)
     */
    async hasData(key) {
        try {
            const value = await this.storage.get(key, null);
            return value !== null;
        } catch (error) {
            console.error(`[SimpleStorageWrapper] 检查数据失败 ${key}:`, error);
            return false;
        }
    }

    // === 存储统计 ===

    /**
     * 获取存储使用统计 (异步)
     */
    async getStorageStats() {
        try {
            const [practiceRecordsCount, backups, userSettings] = await Promise.all([
                this.getPracticeRecordsCount(),
                this.getBackups(),
                this.getUserSettings()
            ]);

            const stats = {
                practiceRecordsCount,
                backupsCount: backups.length,
                userSettingsCount: Object.keys(userSettings).length,
                totalKeys: 0
            };

            // 计算总的存储键数量
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) stats.totalKeys++;
            }

            return stats;
        } catch (error) {
            console.error('[SimpleStorageWrapper] 获取存储统计失败:', error);
            return {
                practiceRecordsCount: 0,
                backupsCount: 0,
                userSettingsCount: 0,
                totalKeys: 0
            };
        }
    }

    // === 数据验证 ===

    /**
     * 验证练习记录数据结构
     */
    validatePracticeRecord(record) {
        const requiredFields = ['id', 'score', 'type', 'date'];
        const missingFields = requiredFields.filter(field => !record.hasOwnProperty(field));

        return {
            isValid: missingFields.length === 0,
            missingFields,
            record
        };
    }

    /**
     * 清理无效的练习记录 (异步)
     */
    async cleanupInvalidPracticeRecords() {
        const records = await this.getPracticeRecords();
        const validRecords = records.filter(record => {
            const validation = this.validatePracticeRecord(record);
            if (!validation.isValid) {
                console.warn('[SimpleStorageWrapper] 发现无效记录，将被清理:', validation);
            }
            return validation.isValid;
        });

        if (validRecords.length !== records.length) {
            await this.savePracticeRecords(validRecords);
            console.log(`[SimpleStorageWrapper] 清理了 ${records.length - validRecords.length} 条无效记录`);
        }

        return validRecords.length;
    }

    // === 兼容性方法 (用于替代复杂的Repository接口) ===

    /**
     * 模拟Repository的getAll方法 (异步)
     */
    async getAll(options = {}) {
        const records = await this.getPracticeRecords();

        if (options.limit && options.limit > 0) {
            return records.slice(0, options.limit);
        }

        return records;
    }

    /**
     * 模拟Repository的getById方法 (异步)
     */
    async getById(id) {
        const records = await this.getPracticeRecords();
        return records.find(r => r.id === id) || null;
    }

    /**
     * 模拟Repository的create方法 (异步)
     */
    async create(data) {
        if (!data.id) {
            data.id = 'record_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }

        if (!data.date) {
            data.date = new Date().toISOString().split('T')[0];
        }

        return await this.addPracticeRecord(data);
    }

    /**
     * 模拟Repository的update方法 (异步)
     */
    async update(id, data) {
        const records = await this.getPracticeRecords();
        const index = records.findIndex(r => r.id === id);

        if (index === -1) {
            return false;
        }

        records[index] = { ...records[index], ...data };
        return await this.savePracticeRecords(records);
    }

    /**
     * 模拟Repository的delete方法 (异步)
     */
    async delete(id) {
        return await this.deletePracticeRecord(id);
    }
}

// 创建全局实例
window.simpleStorageWrapper = new SimpleStorageWrapper();

// 导出供使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimpleStorageWrapper;
}