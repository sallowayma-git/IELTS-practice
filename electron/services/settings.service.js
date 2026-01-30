const SettingsDAO = require('../db/dao/settings.dao');
const logger = require('../utils/logger');

/**
 * Settings Service
 * 应用设置管理业务逻辑层
 */
class SettingsService {
    constructor(db) {
        this.dao = new SettingsDAO(db);
    }

    /**
     * 获取所有设置
     */
    async getAll() {
        try {
            return this.dao.getAll();
        } catch (error) {
            logger.error('SettingsService.getAll failed', error);
            throw error;
        }
    }

    /**
     * 获取单个设置
     */
    async get(key) {
        try {
            return this.dao.get(key);
        } catch (error) {
            logger.error(`SettingsService.get failed (key: ${key})`, error);
            throw error;
        }
    }

    /**
     * 更新设置（带验证）
     */
    async update(updates) {
        try {
            // 验证设置值
            this._validateSettings(updates);

            // 批量更新
            this.dao.setMultiple(updates);
            logger.info('Settings updated successfully');
            return true;
        } catch (error) {
            logger.error('SettingsService.update failed', error);
            throw error;
        }
    }

    /**
     * 重置为默认设置
     */
    async reset() {
        try {
            this.dao.reset();
            logger.info('Settings reset to defaults');
            return true;
        } catch (error) {
            logger.error('SettingsService.reset failed', error);
            throw error;
        }
    }

    /**
     * 获取 Temperature 值（根据模式计算）
     * @param {string} taskType - 'task1' | 'task2'
     * @returns {number} Temperature 值
     */
    async getTemperature(taskType) {
        try {
            const mode = this.dao.get('temperature_mode');

            // 如果是自定义模式，从对应的 task 设置获取
            if (mode === 'custom' || mode === 'balanced') {
                const key = `temperature_${taskType}`;
                const value = this.dao.get(key);
                return parseFloat(value) || 0.5;
            }

            // 预设模式
            const presets = {
                precise: 0.3,
                balanced: 0.5,
                creative: 0.8
            };

            return presets[mode] || 0.5;
        } catch (error) {
            logger.error('SettingsService.getTemperature failed', error);
            return 0.5; // 默认值
        }
    }

    /**
     * 验证设置值
     * @private
     */
    _validateSettings(updates) {
        for (const [key, value] of Object.entries(updates)) {
            switch (key) {
                case 'language':
                    if (!['zh-CN', 'en'].includes(value)) {
                        throw new Error('Invalid language: must be zh-CN or en');
                    }
                    break;

                case 'temperature_mode':
                    if (!['precise', 'balanced', 'creative', 'custom'].includes(value)) {
                        throw new Error('Invalid temperature_mode');
                    }
                    break;

                case 'temperature_task1':
                case 'temperature_task2':
                    const temp = parseFloat(value);
                    if (isNaN(temp) || temp < 0 || temp > 2) {
                        throw new Error(`Invalid ${key}: must be between 0 and 2`);
                    }
                    break;

                case 'max_tokens':
                    const tokens = parseInt(value);
                    if (isNaN(tokens) || tokens < 100 || tokens > 32000) {
                        throw new Error('Invalid max_tokens: must be between 100 and 32000');
                    }
                    break;

                case 'history_limit':
                    const limit = parseInt(value);
                    if (isNaN(limit) || limit < 0 || limit > 10000) {
                        throw new Error('Invalid history_limit: must be between 0 and 10000');
                    }
                    break;

                case 'auto_save_interval':
                    const interval = parseInt(value);
                    if (isNaN(interval) || interval < 1000 || interval > 60000) {
                        throw new Error('Invalid auto_save_interval: must be between 1000 and 60000 ms');
                    }
                    break;

                case 'theme':
                    if (!['light', 'dark', 'auto'].includes(value)) {
                        throw new Error('Invalid theme: must be light, dark, or auto');
                    }
                    break;

                default:
                    // 允许自定义设置，不验证
                    break;
            }
        }
    }
}

module.exports = SettingsService;
