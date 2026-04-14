const logger = require('../../utils/logger');

/**
 * Settings DAO
 * 应用设置数据访问层
 */
class SettingsDAO {
    constructor(db) {
        this.db = db;
    }

    /**
     * 获取单个设置值
     * @param {string} key - 设置键名
     * @returns {any} - 解析后的值（自动JSON反序列化）
     */
    get(key) {
        try {
            const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);

            if (!row) {
                return null;
            }

            // 尝试解析 JSON
            try {
                return JSON.parse(row.value);
            } catch {
                // 如果不是 JSON，直接返回字符串
                return row.value;
            }
        } catch (error) {
            logger.error(`Failed to get setting: ${key}`, error);
            throw error;
        }
    }

    /**
     * 获取所有设置（返回对象）
     * @returns {Object} - 所有设置的键值对
     */
    getAll() {
        try {
            const rows = this.db.prepare('SELECT key, value FROM app_settings').all();

            const settings = {};
            for (const row of rows) {
                try {
                    settings[row.key] = JSON.parse(row.value);
                } catch {
                    settings[row.key] = row.value;
                }
            }

            return settings;
        } catch (error) {
            logger.error('Failed to get all settings', error);
            throw error;
        }
    }

    /**
     * 设置单个值
     * @param {string} key - 设置键名
     * @param {any} value - 值（自动JSON序列化）
     */
    set(key, value) {
        try {
            // JSON 序列化
            const jsonValue = typeof value === 'string' && !value.startsWith('"')
                ? JSON.stringify(value)
                : (typeof value === 'object' ? JSON.stringify(value) : String(value));

            this.db.prepare(`
                INSERT INTO app_settings (key, value) 
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(key, jsonValue);

            logger.debug(`Set setting: ${key}`);
        } catch (error) {
            logger.error(`Failed to set setting: ${key}`, error);
            throw error;
        }
    }

    /**
     * 批量设置多个值
     * @param {Object} updates - 键值对对象
     */
    setMultiple(updates) {
        try {
            const setMultiple = this.db.transaction((settingsObj) => {
                for (const [key, value] of Object.entries(settingsObj)) {
                    this.set(key, value);
                }
            });

            setMultiple(updates);
            logger.info(`Set multiple settings: ${Object.keys(updates).join(', ')}`);
        } catch (error) {
            logger.error('Failed to set multiple settings', error);
            throw error;
        }
    }

    /**
     * 删除设置项
     * @param {string} key - 设置键名
     */
    delete(key) {
        try {
            const result = this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);

            if (result.changes === 0) {
                logger.warn(`Setting key not found: ${key}`);
                return false;
            }

            logger.info(`Deleted setting: ${key}`);
            return true;
        } catch (error) {
            logger.error(`Failed to delete setting: ${key}`, error);
            throw error;
        }
    }

    /**
     * 重置为默认设置（慎用）
     */
    reset() {
        try {
            const resetDefaults = this.db.transaction(() => {
                // 清空现有设置
                this.db.prepare('DELETE FROM app_settings').run();

                // 插入默认值
                const defaults = [
                    ['language', '"zh-CN"'],
                    ['temperature_mode', '"balanced"'],
                    ['temperature_task1', '0.3'],
                    ['temperature_task2', '0.5'],
                    ['max_tokens', '4096'],
                    ['history_limit', '100'],
                    ['auto_save_interval', '10000'],
                    ['theme', '"light"']
                ];

                const stmt = this.db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
                for (const [key, value] of defaults) {
                    stmt.run(key, value);
                }
            });

            resetDefaults();
            logger.info('Reset all settings to defaults');
        } catch (error) {
            logger.error('Failed to reset settings', error);
            throw error;
        }
    }
}

module.exports = SettingsDAO;
