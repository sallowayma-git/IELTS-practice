const { safeStorage } = require('electron');
const ConfigsDAO = require('../db/dao/configs.dao');
const logger = require('../utils/logger');
const LLMProvider = require('./llm-provider');

/**
 * API 配置服务
 * 
 * 负责:
 * - API 配置 CRUD
 * - API Key 加密/解密 (safeStorage)
 * - 连接测试
 */
class ConfigService {
    constructor(db) {
        this.dao = new ConfigsDAO(db);
    }

    /**
     * 获取配置列表 (脱敏)
     */
    async list() {
        try {
            const configs = this.dao.list();

            // 脱敏 API Key (显示为 sk-***)
            return configs.map(config => ({
                ...config,
                api_key: this._maskApiKey(config.provider)
            }));
        } catch (error) {
            logger.error('Failed to list configs', error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 创建配置
     */
    async create({ config_name, provider, base_url, api_key, default_model, priority = 100, max_retries = 2 }) {
        try {
            // 验证参数
            this._validateConfig({ config_name, provider, base_url, api_key, default_model, priority, max_retries });

            // 加密 API Key
            if (!safeStorage.isEncryptionAvailable()) {
                throw new Error('系统加密不可用,无法安全存储 API Key');
            }

            const api_key_encrypted = safeStorage.encryptString(api_key);

            // 保存到数据库
            const id = this.dao.create({
                config_name,
                provider,
                base_url,
                api_key_encrypted,
                default_model,
                priority,
                max_retries
            });

            logger.info(`Config created: ${config_name}`, null, { id, provider });

            return { id, success: true };
        } catch (error) {
            logger.error('Failed to create config', error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 更新配置
     */
    async update(id, updates) {
        try {
            const updateData = { ...updates };

            // 如果更新 API Key,需要加密
            if (updates.api_key) {
                if (!safeStorage.isEncryptionAvailable()) {
                    throw new Error('系统加密不可用,无法安全存储 API Key');
                }
                updateData.api_key_encrypted = safeStorage.encryptString(updates.api_key);
                delete updateData.api_key;
            }

            this.dao.update(id, updateData);

            logger.info(`Config updated: id ${id}`);

            return { success: true };
        } catch (error) {
            logger.error(`Failed to update config: ${id}`, error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 删除配置
     */
    async delete(id) {
        try {
            this.dao.delete(id);

            logger.info(`Config deleted: id ${id}`);

            return { success: true };
        } catch (error) {
            logger.error(`Failed to delete config: ${id}`, error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 设置默认配置
     */
    async setDefault(id) {
        try {
            this.dao.setDefault(id);

            logger.info(`Set default config: id ${id}`);

            return { success: true };
        } catch (error) {
            logger.error(`Failed to set default config: ${id}`, error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 切换启用状态
     */
    async toggleEnabled(id) {
        try {
            this.dao.toggleEnabled(id);

            logger.info(`Toggled enabled for config: id ${id}`);

            return { success: true };
        } catch (error) {
            logger.error(`Failed to toggle enabled: ${id}`, error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 测试连接
     * 
     * 【IPC 合约】成功返回 { latency, message }，失败抛出错误
     * 由 IPC 层统一包装为 { success: true/false, data/error }
     */
    async test(id) {
        const startTime = Date.now();

        // 获取配置
        const config = this.dao.getById(id);

        if (!config) {
            const error = new Error(`配置不存在: id ${id}`);
            error.code = 'config_not_found';
            throw error;
        }

        if (!config.is_enabled) {
            const error = new Error('配置已禁用,无法测试');
            error.code = 'config_disabled';
            throw error;
        }

        try {
            // 解密 API Key
            const api_key = safeStorage.decryptString(config.api_key_encrypted);

            // 创建 provider 并测试
            const provider = new LLMProvider({
                provider: config.provider,
                base_url: config.base_url,
                api_key,
                model: config.default_model
            });

            await provider.testConnection();

            const latency = Date.now() - startTime;

            logger.info(`Config test successful: id ${id}`, null, { latency });

            // 【统一返回】成功只返回业务数据,不返回 success 字段
            return { latency, message: '连接成功' };

        } catch (error) {
            const latency = Date.now() - startTime;

            logger.error(`Config test failed: id ${id}`, error, null, { latency });

            // 【统一抛出】失败抛出错误,附带 code 和 latency
            const wrappedError = new Error(error.message);
            wrappedError.code = this._getErrorCode(error);
            wrappedError.latency = latency;
            throw wrappedError;
        }
    }

    /**
     * 获取默认配置 (解密 API Key)
     * 仅供内部服务使用,不暴露给渲染进程
     */
    async getDefaultConfigDecrypted() {
        try {
            const config = this.dao.getDefault();

            if (!config) {
                throw new Error('未配置默认 API,请先在设置中添加并设为默认');
            }

            if (!config.is_enabled) {
                throw new Error('默认 API 配置已禁用,请启用或选择其他配置');
            }

            // 解密 API Key
            const api_key = safeStorage.decryptString(config.api_key_encrypted);

            return {
                ...config,
                api_key // 明文 API Key,仅在主进程使用
            };
        } catch (error) {
            logger.error('Failed to get default config', error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 根据 ID 获取配置 (解密 API Key)
     * 仅供内部服务使用
     */
    async getConfigByIdDecrypted(id) {
        try {
            const config = this.dao.getById(id);

            if (!config) {
                throw new Error(`配置不存在: id ${id}`);
            }

            if (!config.is_enabled) {
                throw new Error(`配置已禁用: id ${id}`);
            }

            // 解密 API Key
            const api_key = safeStorage.decryptString(config.api_key_encrypted);

            // 更新最后使用时间
            this.dao.updateLastUsed(id);

            return {
                ...config,
                api_key
            };
        } catch (error) {
            logger.error(`Failed to get config: ${id}`, error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 获取全部可用配置（解密后，按默认 + 优先级排序）
     */
    async getDecryptedEnabledConfigs() {
        try {
            const configs = this.dao.listEnabledOrdered();
            return configs
                .map((config) => {
                    try {
                        return {
                            ...config,
                            api_key: safeStorage.decryptString(config.api_key_encrypted)
                        };
                    } catch (error) {
                        logger.warn(`Skip config due to decrypt failure: ${config.id}`, null, {
                            error: error.message
                        });
                        return null;
                    }
                })
                .filter(Boolean);
        } catch (error) {
            logger.error('Failed to list decrypted configs', error);
            throw this._normalizeError(error);
        }
    }

    markSuccess(id) {
        this.dao.markSuccess(id);
    }

    markFailure(id, cooldownUntil = null) {
        this.dao.markFailure(id, cooldownUntil);
    }

    /**
     * 验证配置参数
     */
    _validateConfig({ config_name, provider, base_url, api_key, default_model, priority, max_retries }) {
        const errors = [];

        if (!config_name || config_name.trim().length === 0) {
            errors.push('配置名称不能为空');
        }

        if (!['openai', 'openrouter', 'deepseek'].includes(provider)) {
            errors.push('无效的 provider,仅支持: openai, openrouter, deepseek');
        }

        if (!base_url || !base_url.startsWith('http')) {
            errors.push('base_url 必须是有效的 HTTP(S) URL');
        }

        if (!api_key || api_key.trim().length === 0) {
            errors.push('API Key 不能为空');
        }

        if (!default_model || default_model.trim().length === 0) {
            errors.push('默认模型不能为空');
        }

        if (priority !== undefined && (Number.isNaN(Number(priority)) || Number(priority) < 1)) {
            errors.push('priority 必须是大于 0 的整数');
        }

        if (max_retries !== undefined && (Number.isNaN(Number(max_retries)) || Number(max_retries) < 0 || Number(max_retries) > 5)) {
            errors.push('max_retries 必须在 0-5 之间');
        }

        if (errors.length > 0) {
            throw new Error(`参数验证失败: ${errors.join(', ')}`);
        }
    }

    /**
     * 脱敏 API Key
     */
    _maskApiKey(provider) {
        const prefixes = {
            openai: 'sk-',
            openrouter: 'sk-or-',
            deepseek: 'sk-'
        };

        const prefix = prefixes[provider] || 'sk-';
        return `${prefix}***`;
    }

    /**
     * 标准化错误
     */
    _normalizeError(error) {
        return {
            code: this._getErrorCode(error),
            message: error.message
        };
    }

    /**
     * 获取错误码
     */
    _getErrorCode(error) {
        if (error.message.includes('API Key') || error.message.includes('Unauthorized')) {
            return 'invalid_api_key';
        }
        if (error.message.includes('Network') || error.message.includes('timeout')) {
            return 'network_error';
        }
        if (error.message.includes('rate limit')) {
            return 'rate_limited';
        }
        return 'unknown_error';
    }
}

module.exports = ConfigService;
