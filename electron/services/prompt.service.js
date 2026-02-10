const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PromptsDAO = require('../db/dao/prompts.dao');
const logger = require('../utils/logger');

/**
 * 提示词服务
 * 
 * 负责:
 * - 提示词版本管理
 * - 导入/导出
 * - 默认提示词初始化
 */
class PromptService {
    constructor(db) {
        this.dao = new PromptsDAO(db);
    }

    /**
     * 初始化默认提示词 (首次启动时)
     */
    async initializeDefaults() {
        try {
            // 检查是否已有激活的提示词
            const task1Active = this.dao.getActive('task1');
            const task2Active = this.dao.getActive('task2');

            if (task1Active && task2Active) {
                logger.info('Default prompts already initialized');
                return;
            }

            // 加载默认提示词
            const defaultPromptsPath = path.join(__dirname, '../resources/prompts-default.json');

            if (!fs.existsSync(defaultPromptsPath)) {
                logger.warn('Default prompts file not found, skipping initialization');
                return;
            }

            const defaultPrompts = JSON.parse(fs.readFileSync(defaultPromptsPath, 'utf-8'));

            // 导入并激活
            for (const [taskType, prompt] of Object.entries(defaultPrompts)) {
                const existing = this.dao.getByVersion(prompt.version, taskType);

                if (!existing) {
                    const id = this.dao.create({
                        version: prompt.version,
                        task_type: taskType,
                        system_prompt: prompt.system_prompt,
                        scoring_criteria: prompt.scoring_criteria,
                        output_format_example: prompt.output_format_example
                    });

                    // 激活
                    this.dao.activate(id);

                    logger.info(`Initialized default prompt for ${taskType}: ${prompt.version}`);
                } else if (!this.dao.getActive(taskType)) {
                    // 如果存在但未激活,则激活
                    this.dao.activate(existing.id);
                    logger.info(`Activated existing prompt for ${taskType}: ${prompt.version}`);
                }
            }

            logger.info('Default prompts initialization completed');
        } catch (error) {
            logger.error('Failed to initialize default prompts', error);
            // 不抛出错误,允许应用继续启动
        }
    }

    /**
     * 获取激活的提示词
     */
    async getActive(task_type) {
        try {
            if (!['task1', 'task2'].includes(task_type)) {
                throw new Error(`无效的 task_type: ${task_type}`);
            }

            const prompt = this.dao.getActive(task_type);

            if (!prompt) {
                throw new Error(`未找到 ${task_type} 的激活提示词`);
            }

            return prompt;
        } catch (error) {
            logger.error(`Failed to get active prompt: ${task_type}`, error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 运行时编译提示词（按 language/provider/model 注入覆盖）
     */
    compilePrompt(prompt, context = {}) {
        const language = context.language || 'zh-CN';
        const provider = context.provider || null;
        const model = context.model || null;
        const overrides = prompt.overrides || {};

        const injectedParts = [];
        if (overrides.language && overrides.language[language]) {
            injectedParts.push(overrides.language[language]);
        }
        if (provider && overrides.provider && overrides.provider[provider]) {
            injectedParts.push(overrides.provider[provider]);
        }
        if (model && overrides.model && overrides.model[model]) {
            injectedParts.push(overrides.model[model]);
        }

        return {
            ...prompt,
            system_prompt: injectedParts.length > 0
                ? `${injectedParts.join('\n')}\n\n${prompt.system_prompt}`
                : prompt.system_prompt
        };
    }

    /**
     * 导入提示词
     */
    async import(jsonData) {
        try {
            // 兼容双格式并标准化
            const { prompts, metadata } = this._normalizeImportData(jsonData);
            this._validateImportData(prompts);

            // 批量导入
            this.dao.importBatch(prompts);

            // 聚合模板默认激活该版本
            if (metadata?.source === 'aggregate' && metadata.version) {
                for (const prompt of prompts) {
                    const imported = this.dao.getByVersion(prompt.version, prompt.task_type);
                    if (imported) {
                        this.dao.activate(imported.id);
                    }
                }
            }

            // 审计日志
            this._audit('import', null, null, metadata?.version || null, this._checksum(prompts), {
                source: metadata?.source || 'flat',
                count: prompts.length
            });

            logger.info(`Imported ${prompts.length} prompts`);

            return {
                success: true,
                count: prompts.length,
                message: `成功导入 ${prompts.length} 个提示词`
            };
        } catch (error) {
            logger.error('Failed to import prompts', error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 导出当前激活的提示词
     */
    async exportActive() {
        try {
            const task1 = this.dao.getActive('task1');
            const task2 = this.dao.getActive('task2');

            const exported = {};

            if (task1) {
                exported.task1 = this._cleanPromptForExport(task1);
            }

            if (task2) {
                exported.task2 = this._cleanPromptForExport(task2);
            }

            logger.info('Exported active prompts');

            return exported;
        } catch (error) {
            logger.error('Failed to export prompts', error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 获取所有提示词版本列表
     */
    async listAll(task_type = null) {
        try {
            const prompts = this.dao.listAll(task_type);
            return prompts;
        } catch (error) {
            logger.error('Failed to list prompts', error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 激活指定提示词
     */
    async activate(id) {
        try {
            this.dao.activate(id);
            const activated = this.dao.listAll().find((item) => item.id === id);
            this._audit(
                'activate',
                id,
                activated?.task_type || null,
                activated?.version || null,
                activated ? this._checksum(activated) : null,
                null
            );

            logger.info(`Activated prompt: ${id}`);

            return { success: true };
        } catch (error) {
            logger.error(`Failed to activate prompt: ${id}`, error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 删除提示词
     */
    async delete(id) {
        try {
            const deleting = this.dao.listAll().find((item) => item.id === id);
            this.dao.delete(id);
            this._audit(
                'delete',
                id,
                deleting?.task_type || null,
                deleting?.version || null,
                deleting ? this._checksum(deleting) : null,
                null
            );

            logger.info(`Deleted prompt: ${id}`);

            return { success: true };
        } catch (error) {
            logger.error(`Failed to delete prompt: ${id}`, error);
            throw this._normalizeError(error);
        }
    }

    /**
     * 验证导入数据
     */
    _validateImportData(prompts) {
        if (prompts.length === 0) {
            throw new Error('导入数据不能为空');
        }

        for (const prompt of prompts) {
            const requiredFields = [
                'version',
                'task_type',
                'system_prompt',
                'scoring_criteria',
                'output_format_example'
            ];

            for (const field of requiredFields) {
                if (!prompt[field]) {
                    throw new Error(`缺少必填字段: ${field}`);
                }
            }

            if (!['task1', 'task2'].includes(prompt.task_type)) {
                throw new Error(`无效的 task_type: ${prompt.task_type}`);
            }

            // 验证大小限制 (10MB)
            const jsonStr = JSON.stringify(prompt);
            if (jsonStr.length > 10 * 1024 * 1024) {
                throw new Error(`提示词数据过大 (超过 10MB): ${prompt.version}`);
            }
        }
    }

    /**
     * 清理提示词数据用于导出
     */
    _cleanPromptForExport(prompt) {
        return {
            version: prompt.version,
            task_type: prompt.task_type,
            system_prompt: prompt.system_prompt,
            scoring_criteria: prompt.scoring_criteria,
            output_format_example: prompt.output_format_example,
            overrides: prompt.overrides || null
        };
    }

    /**
     * 标准化导入格式:
     * 1) 平铺格式: [{ task_type, ... }, ...] / { task_type, ... }
     * 2) 聚合格式: { version, task1: {...}, task2: {...} }
     */
    _normalizeImportData(data) {
        if (!data) {
            throw new Error('导入数据不能为空');
        }

        // 聚合格式
        if (!Array.isArray(data) && data.version && data.task1 && data.task2) {
            const prompts = ['task1', 'task2'].map((taskType) => {
                const item = data[taskType];
                return {
                    version: data.version,
                    task_type: taskType,
                    system_prompt: item.system_prompt,
                    scoring_criteria: item.scoring_criteria,
                    output_format_example: item.output_format_example,
                    overrides: item.overrides || {}
                };
            });
            return {
                prompts,
                metadata: {
                    source: 'aggregate',
                    version: data.version
                }
            };
        }

        // 平铺格式
        const prompts = (Array.isArray(data) ? data : [data]).map((item) => ({
            version: item.version,
            task_type: item.task_type,
            system_prompt: item.system_prompt,
            scoring_criteria: item.scoring_criteria,
            output_format_example: item.output_format_example,
            overrides: item.overrides || {}
        }));
        return {
            prompts,
            metadata: {
                source: 'flat',
                version: prompts[0]?.version || null
            }
        };
    }

    _checksum(value) {
        return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    }

    _audit(action, promptId, taskType, version, checksum, detailObj) {
        try {
            this.dao.db.prepare(`
                INSERT INTO prompt_audit_logs
                    (action, prompt_id, task_type, version, checksum, detail_json)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                action,
                promptId,
                taskType,
                version,
                checksum,
                detailObj ? JSON.stringify(detailObj) : null
            );
        } catch (error) {
            logger.warn('Prompt audit write failed', null, { action, error: error.message });
        }
    }

    /**
     * 标准化错误
     */
    _normalizeError(error) {
        return {
            code: 'prompt_error',
            message: error.message
        };
    }
}

module.exports = PromptService;
