const logger = require('../../utils/logger');

/**
 * API 配置 DAO
 */
class ConfigsDAO {
    constructor(db) {
        this.db = db;
    }

    /**
     * 获取所有配置列表 (不包含解密后的 API Key)
     */
    list() {
        try {
            const configs = this.db.prepare(`
        SELECT 
          id, config_name, provider, base_url, 
          default_model, priority, max_retries, cooldown_until, failure_count,
          is_enabled, is_default, 
          last_used_at, created_at, updated_at
        FROM api_configs
        ORDER BY is_default DESC, priority ASC, created_at DESC
      `).all();

            return configs;
        } catch (error) {
            logger.error('Failed to list API configs', error);
            throw error;
        }
    }

    /**
     * 根据 ID 获取配置 (包含加密的 API Key)
     */
    getById(id) {
        try {
            const config = this.db.prepare(`
        SELECT * FROM api_configs WHERE id = ?
      `).get(id);

            return config || null;
        } catch (error) {
            logger.error(`Failed to get config by id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 获取默认配置
     */
    getDefault() {
        try {
            const config = this.db.prepare(`
        SELECT * FROM api_configs WHERE is_default = 1 LIMIT 1
      `).get();

            return config || null;
        } catch (error) {
            logger.error('Failed to get default config', error);
            throw error;
        }
    }

    /**
     * 创建新配置
     */
    create({ config_name, provider, base_url, api_key_encrypted, default_model, priority = 100, max_retries = 2 }) {
        try {
            const result = this.db.prepare(`
        INSERT INTO api_configs 
          (config_name, provider, base_url, api_key_encrypted, default_model, priority, max_retries)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(config_name, provider, base_url, api_key_encrypted, default_model, priority, max_retries);

            logger.info(`Created API config: ${config_name} (id: ${result.lastInsertRowid})`);
            return result.lastInsertRowid;
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error(`配置名称 "${config_name}" 已存在`);
            }
            logger.error(`Failed to create config: ${config_name}`, error);
            throw error;
        }
    }

    /**
     * 更新配置
     */
    update(id, updates) {
        try {
            const allowedFields = [
                'config_name', 'provider', 'base_url',
                'api_key_encrypted', 'default_model', 'is_enabled',
                'priority', 'max_retries', 'cooldown_until', 'failure_count'
            ];

            const setClauses = [];
            const values = [];

            for (const [key, value] of Object.entries(updates)) {
                if (allowedFields.includes(key)) {
                    setClauses.push(`${key} = ?`);
                    values.push(value);
                }
            }

            if (setClauses.length === 0) {
                throw new Error('No valid fields to update');
            }

            // 添加 updated_at
            setClauses.push('updated_at = CURRENT_TIMESTAMP');
            values.push(id);

            const sql = `
        UPDATE api_configs 
        SET ${setClauses.join(', ')}
        WHERE id = ?
      `;

            const result = this.db.prepare(sql).run(...values);

            if (result.changes === 0) {
                throw new Error(`Config with id ${id} not found`);
            }

            logger.info(`Updated API config id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to update config id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 删除配置
     */
    delete(id) {
        try {
            const result = this.db.prepare('DELETE FROM api_configs WHERE id = ?').run(id);

            if (result.changes === 0) {
                throw new Error(`Config with id ${id} not found`);
            }

            logger.info(`Deleted API config id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to delete config id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 设置默认配置 (确保只有一个默认)
     */
    setDefault(id) {
        try {
            const setDefault = this.db.transaction(() => {
                // 1. 取消所有默认
                this.db.prepare('UPDATE api_configs SET is_default = 0').run();

                // 2. 设置新默认
                const result = this.db.prepare(`
          UPDATE api_configs 
          SET is_default = 1, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(id);

                if (result.changes === 0) {
                    throw new Error(`Config with id ${id} not found`);
                }
            });

            setDefault();
            logger.info(`Set default API config to id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to set default config id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 切换启用状态
     */
    toggleEnabled(id) {
        try {
            const result = this.db.prepare(`
        UPDATE api_configs 
        SET is_enabled = 1 - is_enabled, 
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(id);

            if (result.changes === 0) {
                throw new Error(`Config with id ${id} not found`);
            }

            logger.info(`Toggled enabled status for config id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to toggle enabled for config id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 更新最后使用时间
     */
    updateLastUsed(id) {
        try {
            this.db.prepare(`
        UPDATE api_configs 
        SET last_used_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(id);
        } catch (error) {
            logger.error(`Failed to update last_used_at for config id: ${id}`, error);
            // 不抛出错误，这是非关键操作
        }
    }

    /**
     * 获取启用配置（按默认 + 优先级排序）
     */
    listEnabledOrdered() {
        try {
            return this.db.prepare(`
                SELECT * FROM api_configs
                WHERE is_enabled = 1
                ORDER BY is_default DESC, priority ASC, id ASC
            `).all();
        } catch (error) {
            logger.error('Failed to list enabled configs', error);
            throw error;
        }
    }

    /**
     * 记录配置成功调用，清空失败计数与冷却
     */
    markSuccess(id) {
        try {
            this.db.prepare(`
                UPDATE api_configs
                SET failure_count = 0,
                    cooldown_until = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(id);
        } catch (error) {
            logger.error(`Failed to mark config success id: ${id}`, error);
        }
    }

    /**
     * 记录配置失败并可选进入冷却
     */
    markFailure(id, cooldownUntil = null) {
        try {
            this.db.prepare(`
                UPDATE api_configs
                SET failure_count = COALESCE(failure_count, 0) + 1,
                    cooldown_until = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(cooldownUntil, id);
        } catch (error) {
            logger.error(`Failed to mark config failure id: ${id}`, error);
        }
    }
}

module.exports = ConfigsDAO;
