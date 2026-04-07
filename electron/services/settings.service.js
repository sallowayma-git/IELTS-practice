const SettingsDAO = require('../db/dao/settings.dao');
const logger = require('../utils/logger');

const DEFAULT_TEMPERATURE = 0.5;
const TEMPERATURE_PRESETS = Object.freeze({
    precise: Object.freeze({ task1: 0.3, task2: 0.3 }),
    balanced: Object.freeze({ task1: 0.5, task2: 0.5 }),
    creative: Object.freeze({ task1: 0.8, task2: 0.8 })
});

function normalizeTemperatureValue(value, fallback = DEFAULT_TEMPERATURE) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

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
            const preset = TEMPERATURE_PRESETS[mode];

            if (preset && Object.prototype.hasOwnProperty.call(preset, taskType)) {
                return preset[taskType];
            }

            if (mode === 'custom') {
                const key = `temperature_${taskType}`;
                const value = this.dao.get(key);
                return normalizeTemperatureValue(value);
            }

            return DEFAULT_TEMPERATURE;
        } catch (error) {
            logger.error('SettingsService.getTemperature failed', error);
            return DEFAULT_TEMPERATURE;
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
