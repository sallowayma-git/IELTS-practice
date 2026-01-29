const logger = require('../../utils/logger');

/**
 * 提示词 DAO
 */
class PromptsDAO {
    constructor(db) {
        this.db = db;
    }

    /**
     * 获取激活的提示词
     */
    getActive(task_type) {
        try {
            const prompt = this.db.prepare(`
        SELECT * FROM prompts 
        WHERE task_type = ? AND is_active = 1
        LIMIT 1
      `).get(task_type);

            return prompt || null;
        } catch (error) {
            logger.error(`Failed to get active prompt for ${task_type}`, error);
            throw error;
        }
    }

    /**
     * 获取所有提示词版本
     */
    listAll(task_type = null) {
        try {
            let sql = 'SELECT * FROM prompts';
            const params = [];

            if (task_type) {
                sql += ' WHERE task_type = ?';
                params.push(task_type);
            }

            sql += ' ORDER BY created_at DESC';

            const prompts = this.db.prepare(sql).all(...params);
            return prompts;
        } catch (error) {
            logger.error('Failed to list prompts', error);
            throw error;
        }
    }

    /**
     * 根据版本和任务类型获取提示词
     */
    getByVersion(version, task_type) {
        try {
            const prompt = this.db.prepare(`
        SELECT * FROM prompts 
        WHERE version = ? AND task_type = ?
      `).get(version, task_type);

            return prompt || null;
        } catch (error) {
            logger.error(`Failed to get prompt: ${version}, ${task_type}`, error);
            throw error;
        }
    }

    /**
     * 创建新提示词
     */
    create({ version, task_type, system_prompt, scoring_criteria, output_format_example }) {
        try {
            const result = this.db.prepare(`
        INSERT INTO prompts 
          (version, task_type, system_prompt, scoring_criteria, output_format_example)
        VALUES (?, ?, ?, ?, ?)
      `).run(version, task_type, system_prompt, scoring_criteria, output_format_example);

            logger.info(`Created prompt: ${version} for ${task_type} (id: ${result.lastInsertRowid})`);
            return result.lastInsertRowid;
        } catch (error) {
            logger.error(`Failed to create prompt: ${version}, ${task_type}`, error);
            throw error;
        }
    }

    /**
     * 激活指定提示词 (确保同一 task_type 只有一个激活)
     */
    activate(id) {
        try {
            const setActive = this.db.transaction(() => {
                // 1. 获取要激活的提示词的 task_type
                const target = this.db.prepare('SELECT task_type FROM prompts WHERE id = ?').get(id);

                if (!target) {
                    throw new Error(`Prompt with id ${id} not found`);
                }

                // 2. 取消该 task_type 的所有激活
                this.db.prepare(`
          UPDATE prompts 
          SET is_active = 0 
          WHERE task_type = ?
        `).run(target.task_type);

                // 3. 激活目标提示词
                this.db.prepare(`
          UPDATE prompts 
          SET is_active = 1 
          WHERE id = ?
        `).run(id);
            });

            setActive();
            logger.info(`Activated prompt id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to activate prompt id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 删除提示词
     */
    delete(id) {
        try {
            // 检查是否为激活状态
            const prompt = this.db.prepare('SELECT is_active FROM prompts WHERE id = ?').get(id);

            if (!prompt) {
                throw new Error(`Prompt with id ${id} not found`);
            }

            if (prompt.is_active === 1) {
                throw new Error('Cannot delete active prompt. Please activate another version first.');
            }

            const result = this.db.prepare('DELETE FROM prompts WHERE id = ?').run(id);

            logger.info(`Deleted prompt id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to delete prompt id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 批量导入提示词
     */
    importBatch(prompts) {
        try {
            const importPrompts = this.db.transaction(() => {
                const insertStmt = this.db.prepare(`
          INSERT INTO prompts 
            (version, task_type, system_prompt, scoring_criteria, output_format_example)
          VALUES (?, ?, ?, ?, ?)
        `);

                for (const prompt of prompts) {
                    // 检查是否已存在相同版本
                    const existing = this.getByVersion(prompt.version, prompt.task_type);

                    if (existing) {
                        logger.warn(`Skipping duplicate prompt: ${prompt.version} for ${prompt.task_type}`);
                        continue;
                    }

                    insertStmt.run(
                        prompt.version,
                        prompt.task_type,
                        prompt.system_prompt,
                        prompt.scoring_criteria,
                        prompt.output_format_example
                    );
                }
            });

            importPrompts();
            logger.info(`Imported ${prompts.length} prompts`);
            return true;
        } catch (error) {
            logger.error('Failed to import prompts', error);
            throw error;
        }
    }
}

module.exports = PromptsDAO;
